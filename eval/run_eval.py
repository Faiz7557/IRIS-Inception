"""Evaluasi relay berurutan; audio_path relatif terhadap direktori CSV.

Check normalisasi: python -m doctest eval/run_eval.py
"""

import argparse
import asyncio
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
from types import SimpleNamespace
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

FIELDS = "utterance_id condition hypothesis_text wer subs dels ins n_ref cards_json llm_status latency_a_ms stt_ms llm_ms".split()
INPUT_FIELDS = "utterance_id condition kind_ref speaker audio_path reference_text".split()
NUMBERS = "nol satu dua tiga empat lima enam tujuh delapan sembilan sepuluh".split()


def normalize(text: str) -> str:
    """Normalisasi kedua sisi WER tanpa mengubah angka di atas 10.

    >>> normalize('ADA 3 orang, 10 luka! 11?')
    'ada tiga orang sepuluh luka 11'
    >>> normalize('0 1 2 4 5 6 7 8 9')
    'nol satu dua empat lima enam tujuh delapan sembilan'
    >>> normalize('Ya—tidak?')
    'yatidak'
    """
    text = re.sub(r"\b(?:10|[0-9])\b", lambda match: NUMBERS[int(match[0])], text.lower())
    return " ".join("".join(c for c in text if not unicodedata.category(c).startswith("P")).split())


def audio_bytes(path: Path, codec: str) -> bytes:
    """Ambil payload WAV yang cocok; ffmpeg menangani format lainnya."""
    raw = path.read_bytes()
    target = (7, 1, 8000, 8) if codec == "mulaw_8k" else (1, 1, 16000, 16)
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        offset, fmt, payload = 12, None, None
        while offset + 8 <= len(raw):
            tag, size = struct.unpack_from("<4sI", raw, offset)
            offset += 8
            chunk = raw[offset:offset + size]
            if len(chunk) != size:
                raise ValueError("Berkas WAV terpotong")
            if tag == b"fmt " and size >= 16:
                encoding, channels, rate, _, _, bits = struct.unpack_from("<HHIIHH", chunk)
                fmt = (encoding, channels, rate, bits)
            elif tag == b"data":
                payload = chunk
            offset += size + size % 2
        if fmt == target and payload is not None:
            return payload
    mulaw = codec == "mulaw_8k"
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-ar",
         "8000" if mulaw else "16000", "-ac", "1", "-acodec",
         "pcm_mulaw" if mulaw else "pcm_s16le", "-f", "mulaw" if mulaw else "s16le", "pipe:1"],
        capture_output=True, check=True,
    )
    return result.stdout


def now() -> datetime:
    return datetime.now(timezone.utc)


def elapsed(end: datetime, start: datetime) -> float:
    return round((end - start).total_seconds() * 1000, 3)


async def transcribe(payload: bytes, codec: str, reference: str, dry_run: bool):
    final = asyncio.get_running_loop().create_future()

    async def on_final(utterance):
        if not final.done():
            final.set_result(utterance)

    async def on_partial(*_):
        pass

    async def on_error(error):
        if not final.done():
            final.set_exception(RuntimeError(str(error)))

    stream = None
    if not dry_run:
        from relay.stt import DeepgramStream

        stream = DeepgramStream(codec=codec, on_final=on_final,
                                on_partial=on_partial, on_error=on_error)
    frame_size = 800 if codec == "mulaw_8k" else 3200
    try:
        if stream:
            await stream.start()
        loop = asyncio.get_running_loop()
        started = loop.time()
        for offset in range(0, len(payload), frame_size):
            await asyncio.sleep(max(0, started + offset / frame_size * 0.1 - loop.time()))
            if final.done():
                break
            frame = payload[offset:offset + frame_size]
            if stream:
                await stream.send_audio(frame)
        # Account for playback of the last frame, including a partial frame.
        if not final.done():
            await asyncio.sleep(max(0, started + len(payload) / frame_size * 0.1 - loop.time()))
        if dry_run:
            stamp = now()
            await on_final(SimpleNamespace(text=reference, speech_end_at=stamp, final_at=stamp))
        return await asyncio.wait_for(final, timeout=15)
    finally:
        if stream:
            await stream.close()


async def evaluate(row: dict, csv_dir: Path, dry_run: bool) -> tuple[dict, bool]:
    import jiwer

    result = dict.fromkeys(FIELDS, "")
    result.update(utterance_id=row["utterance_id"], condition=row["condition"],
                  hypothesis_text="", cards_json="[]")
    stage = "audio"
    failed = False
    try:
        if row["condition"] not in {"bersih", "bising", "kodek8k"}:
            raise ValueError("Kondisi audio tidak dikenal")
        codec = "mulaw_8k" if row["condition"] == "kodek8k" else "pcm16_16k"
        payload = audio_bytes(csv_dir / row["audio_path"], codec)
        if not payload:
            raise ValueError("Audio kosong")
        stage = "stt"
        utterance = await transcribe(payload, codec, row["reference_text"], dry_run)
        result.update(hypothesis_text=utterance.text,
                      stt_ms=elapsed(utterance.final_at, utterance.speech_end_at))
        stage = "llm"
        if dry_run:
            stamp = now()
            simplified = SimpleNamespace(
                cards=[{"card_id": "00000000-0000-0000-0000-000000000001",
                        "kind": "ya_tidak", "question": "Butuh bantuan?",
                        "transcript": "Uji evaluasi", "options": [
                            {"label": "Ya", "action": "ucap", "spoken": "Ya."},
                            {"label": "Tidak", "action": "ucap", "spoken": "Tidak."}],
                        "degradation": 0}],
                llm_status="dry_run", llm_start_at=stamp, llm_end_at=stamp,
            )
        else:
            from relay.simplifier import simplify

            simplified = await simplify(utterance.text, incident="umum", history=[])
        produced_at = now()
        result.update(
            cards_json=json.dumps([
                card if isinstance(card, dict) else card.model_dump(mode="json")
                for card in simplified.cards
            ], ensure_ascii=False),
            llm_status=simplified.llm_status,
            latency_a_ms=elapsed(produced_at, utterance.speech_end_at) if simplified.cards else "",
            llm_ms=elapsed(simplified.llm_end_at, simplified.llm_start_at),
        )
    except Exception as error:
        failed = True
        result["llm_status"] = f"{stage}_error"
        print(f"{row['utterance_id']}: {error}", file=sys.stderr)
    reference = normalize(row["reference_text"])
    hypothesis = normalize(result["hypothesis_text"])
    alignment = jiwer.process_words(reference, hypothesis)
    result.update(wer=jiwer.wer(reference, hypothesis), subs=alignment.substitutions,
                  dels=alignment.deletions, ins=alignment.insertions,
                  n_ref=len(reference.split()))
    return result, failed


async def run(args) -> int:
    with args.csv.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not set(INPUT_FIELDS).issubset(reader.fieldnames or []):
            raise ValueError("Kolom CSV tidak sesuai skema ujaran")
        output = ROOT / "eval" / f"results_{args.run}.csv"
        # Exclusive creation protects measurements from an accidental repeated run.
        with output.open("x", encoding="utf-8", newline="") as destination:
            writer = csv.DictWriter(destination, fieldnames=FIELDS)
            writer.writeheader()
            failures = 0
            for index, row in enumerate(reader, 1):
                if args.limit is not None and index > args.limit:
                    break
                if any(row.get(field) is None for field in INPUT_FIELDS):
                    raise ValueError(f"Baris CSV {index} tidak lengkap")
                result, failed = await evaluate(row, args.csv.parent, args.dry_run)
                writer.writerow(result)
                destination.flush()
                failures += failed
                print(f"{index} {row['utterance_id']}: {result['llm_status']} WER={result['wer']:.3f}", flush=True)
    print(f"Hasil: {output}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluasi STT dan kartu Jembatan 112")
    parser.add_argument("--run", required=True, help="Nama hasil evaluasi")
    parser.add_argument("--limit", type=int, help="Batas jumlah ujaran")
    parser.add_argument("--dry-run", action="store_true", help="Uji tanpa jaringan")
    parser.add_argument("--csv", type=Path, default=ROOT / "eval" / "utterances.csv")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run):
        parser.error("Nama run hanya boleh memuat huruf, angka, garis bawah, dan tanda hubung")
    if args.limit is not None and args.limit < 1:
        parser.error("Limit harus lebih besar dari nol")
    try:
        return asyncio.run(run(args))
    except (OSError, ValueError, ImportError) as error:
        print(f"Evaluasi gagal: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

