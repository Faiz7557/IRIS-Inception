"""Laporan evaluasi Jembatan 112 (TRD 12.4) -> eval/REPORT.md.

Pakai:
  python eval/report.py --run NAME     # baca results_NAME.csv + ratings + utterances
  python eval/report.py --selfcheck    # uji rumus Wilson dan nearest-rank
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
CONDITIONS = [("bersih", "Bersih"), ("bising", "Bising jalan"), ("kodek8k", "Kodek 8 kHz")]
MISSING = "belum dinilai"
Z = 1.96


def read_csv(path: Path) -> list[dict] | None:
    if not path.exists():
        return None
    with path.open(encoding="utf-8-sig", newline="") as f:  # utf-8-sig: tahan BOM dari Excel/PowerShell
        return list(csv.DictReader(f))


def wilson(k: int, n: int, z: float = Z) -> tuple[float, float]:
    """Interval Wilson (TRD 12.4)."""
    p = k / n
    z2 = z * z
    centre = p + z2 / (2 * n)
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    denom = 1 + z2 / n
    return (centre - half) / denom, (centre + half) / denom


def nearest_rank(values: list[float], pct: int) -> float:
    """Nearest-rank: sorted[ceil(pct/100 * n) - 1]."""
    s = sorted(values)
    rank = -(-pct * len(s) // 100)  # ceil dengan integer
    return s[rank - 1]


def card_question(cards_json: str) -> str:
    try:
        data = json.loads(cards_json)
    except (TypeError, ValueError):
        return "-"
    cards = data.get("cards", []) if isinstance(data, dict) else data
    if isinstance(cards, list) and cards and isinstance(cards[0], dict):
        return str(cards[0].get("question", "-"))
    return "-"


def cell(text: object) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ") if text not in (None, "") else "-"


def load_ratings(name: str) -> dict[str, int] | None:
    rows = read_csv(EVAL_DIR / name)
    if rows is None:
        return None
    ratings = {r["utterance_id"]: int(r["correct"]) for r in rows if (r.get("correct") or "").strip()}
    return ratings or None


def corpus_wer(rows: list[dict]) -> float | None:
    n = sum(int(float(r["n_ref"])) for r in rows)
    if n == 0:
        return None
    errs = sum(int(float(r["subs"])) + int(float(r["dels"])) + int(float(r["ins"])) for r in rows)
    return errs / n


def build_report(run: str) -> str:
    results_path = EVAL_DIR / f"results_{run}.csv"
    results = read_csv(results_path)
    if results is None:
        sys.exit(f"Berkas hasil tidak ada: {results_path}")
    utter = {r["utterance_id"]: r for r in (read_csv(EVAL_DIR / "utterances.csv") or [])}
    r1 = load_ratings("ratings_r1.csv")
    r2 = load_ratings("ratings_r2.csv")
    lines: list[str] = [
        f"# Laporan evaluasi Jembatan 112: run `{run}`",
        "",
        f"Dibuat: {datetime.now().isoformat(timespec='seconds')}. Sumber: `results_{run}.csv`, "
        "`ratings_r1.csv`, `ratings_r2.csv`, `utterances.csv`.",
        "",
        "## 1. WER STT",
        "",
        "WER korpus = sum(S+D+I) / sum(N) per kondisi dan keseluruhan (bukan rata-rata baris).",
        "",
        "| Kondisi | N | S | D | I | WER |",
        "|---|---|---|---|---|---|",
    ]
    wer_by_cond: dict[str, float | None] = {}
    for key, label in CONDITIONS + [("semua", "Keseluruhan")]:
        rows = results if key == "semua" else [r for r in results if r["condition"] == key]
        if not rows:
            lines.append(f"| {label} | 0 | - | - | - | {MISSING} |")
            wer_by_cond[key] = None
            continue
        n = sum(int(float(r["n_ref"])) for r in rows)
        s, d, i = (sum(int(float(r[c])) for r in rows) for c in ("subs", "dels", "ins"))
        wer = corpus_wer(rows)
        wer_by_cond[key] = wer
        lines.append(f"| {label} | {n} | {s} | {d} | {i} | {wer * 100:.1f}% |")

    lines += ["", "## 2. Ketepatan tombol dan kesepakatan", ""]
    if r1:
        k, n = sum(r1.values()), len(r1)
        p = k / n
        lo, hi = wilson(k, n)
        button_acc = p
        lines.append(
            f"- Ketepatan tombol (rata-rata `correct` penilai 1): {p * 100:.1f}% "
            f"({k}/{n}), Wilson 95%: {lo * 100:.1f}%-{hi * 100:.1f}%."
        )
    else:
        button_acc = None
        lines.append(f"- Ketepatan tombol: {MISSING} (`ratings_r1.csv` kosong atau tidak ada).")

    common = sorted(set(r1 or {}) & set(r2 or {}))
    if common:
        from sklearn.metrics import cohen_kappa_score

        kappa = cohen_kappa_score([r1[u] for u in common], [r2[u] for u in common])
        kappa_txt = "n/a" if math.isnan(kappa) else f"{kappa:.3f}"
        both = sum(1 for u in common if r1[u] == 1 and r2[u] == 1)
        blo, bhi = wilson(both, len(common))
        lines.append(f"- Cohen's kappa penilai 1 vs 2 (n = {len(common)}): {kappa_txt}.")
        lines.append(
            f"- Ketepatan bila kedua penilai sama-sama tepat: {both / len(common) * 100:.1f}% "
            f"({both}/{len(common)}), Wilson 95%: {blo * 100:.1f}%-{bhi * 100:.1f}%."
        )
    else:
        lines.append(f"- Cohen's kappa: {MISSING} (butuh `ratings_r1.csv` dan `ratings_r2.csv`).")
        lines.append(f"- Ketepatan bila kedua penilai sama-sama tepat: {MISSING}.")

    lines += ["", "## 3. Latensi putaran A (detik)", "", "| Kondisi | N | Median | p90 |", "|---|---|---|---|"]
    lat_by_cond: dict[str, tuple[float, float] | None] = {}
    for key, label in CONDITIONS + [("semua", "Keseluruhan")]:
        vals = [float(r["latency_a_ms"]) / 1000 for r in results
                if r.get("latency_a_ms") and (key == "semua" or r["condition"] == key)]
        if not vals:
            lines.append(f"| {label} | 0 | {MISSING} | {MISSING} |")
            lat_by_cond[key] = None
            continue
        med, p90 = statistics.median(vals), nearest_rank(vals, 90)
        lat_by_cond[key] = (med, p90)
        lines.append(f"| {label} | {len(vals)} | {med:.2f} | {p90:.2f} |")

    lines += ["", "## 4. Distribusi llm_status", "", "| llm_status | Jumlah | Persen |", "|---|---|---|"]
    status = Counter(r.get("llm_status") or "-" for r in results)
    for st, cnt in status.most_common():
        lines.append(f"| {cell(st)} | {cnt} | {cnt / len(results) * 100:.1f}% |")

    lines += ["", "## 5. Perbandingan dengan target PRD §9.2", "",
              "| Metrik | Target | Hasil | Status |", "|---|---|---|---|"]

    def row(metric: str, target: str, value: float | None, fmt, ok_fn) -> None:
        if value is None:
            lines.append(f"| {metric} | {target} | {MISSING} | - |")
        else:
            lines.append(f"| {metric} | {target} | {fmt(value)} | {'✓' if ok_fn(value) else '✗'} |")

    pct = lambda v: f"{v * 100:.1f}%"  # noqa: E731
    sec = lambda v: f"{v:.2f} dtk"  # noqa: E731
    row("WER STT, audio bersih", "≤ 15%", wer_by_cond.get("bersih"), pct, lambda v: v <= 0.15)
    row("WER STT, kodek telepon", "≤ 25%", wer_by_cond.get("kodek8k"), pct, lambda v: v <= 0.25)
    row("Ketepatan tombol", "≥ 90%", button_acc, pct, lambda v: v >= 0.90)
    row("Latensi putaran A median", "≤ 3 dtk", (lat_by_cond.get("semua") or (None,))[0], sec, lambda v: v <= 3)
    row("Latensi putaran A p90", "≤ 4,5 dtk", (lat_by_cond.get("semua") or (None, None))[1], sec, lambda v: v <= 4.5)
    lines.append("| Latensi putaran B median | ≤ 1 dtk | tidak diukur di run ini | - |")
    lines.append("| Tugas selesai tanpa bantuan | ≥ 80% | tidak diukur di run ini | - |")
    lines.append("| Skor SUS | ≥ 68 | tidak diukur di run ini | - |")
    lines.append("")
    lines.append("Setiap proporsi memakai interval Wilson 95% (bagian 2).")

    lines += ["", "## 6. Kasus gagal", ""]
    failed = []
    for r in results:
        uid = r["utterance_id"]
        c1 = r1.get(uid) if r1 else None
        wer = float(r["wer"])
        reasons = []
        if c1 == 0:
            reasons.append("penilai 1: tidak tepat")
        if wer > 0.5:
            reasons.append(f"WER {wer:.2f}")
        if reasons:
            failed.append((r, "; ".join(reasons)))
    if not failed:
        lines.append("Tidak ada kasus gagal.")
    else:
        lines += ["| utterance_id | condition | reference | hypothesis | pertanyaan kartu | alasan |",
                  "|---|---|---|---|---|---|"]
        for r, reason in failed:
            ref = utter.get(r["utterance_id"], {}).get("reference_text")
            lines.append(
                f"| {cell(r['utterance_id'])} | {cell(r['condition'])} | {cell(ref)} | "
                f"{cell(r.get('hypothesis_text'))} | {cell(card_question(r.get('cards_json', '')))} | {reason} |"
            )
    return "\n".join(lines) + "\n"


def _selfcheck() -> None:
    lo, hi = wilson(54, 60)
    assert (round(lo, 3), round(hi, 3)) == (0.799, 0.953), (lo, hi)
    assert nearest_rank(list(range(1, 11)), 90) == 9
    print("selfcheck ok: wilson(54,60) =", round(lo, 3), round(hi, 3), "| p90 [1..10] = 9")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", help="nama run: membaca eval/results_NAME.csv")
    ap.add_argument("--selfcheck", action="store_true", help="jalankan uji kewarasan rumus")
    args = ap.parse_args()
    if args.selfcheck:
        _selfcheck()
        return
    if not args.run:
        ap.error("--run NAME atau --selfcheck wajib")
    out = EVAL_DIR / "REPORT.md"
    out.write_text(build_report(args.run), encoding="utf-8")
    print(f"ditulis: {out}")


if __name__ == "__main__":
    main()
