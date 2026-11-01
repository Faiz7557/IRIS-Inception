"""Operator utterance -> short button cards (TRD §6.3). Any failure degrades to L1 (TRD §7)."""

import asyncio
import hashlib
import json
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import anthropic
import httpx
from pydantic import ValidationError

from config import INCIDENTS, LLM_TIMEOUT_S, PHRASES, env
from protocol import Card, LlmCard, LlmOutput, Option

log = logging.getLogger(__name__)

SKEMA_KARTU = {
    "type": "object",
    "additionalProperties": False,
    "required": ["kartu"],
    "properties": {
        "kartu": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["pertanyaan_pendek", "jenis", "opsi"],
                "properties": {
                    "pertanyaan_pendek": {"type": "string"},
                    "jenis": {"type": "string",
                              "enum": ["ya_tidak", "angka", "lokasi", "pilihan", "terbuka", "instruksi"]},
                    "opsi": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["label", "ucapan"],
                            "properties": {"label": {"type": "string"}, "ucapan": {"type": "string"}},
                        },
                    },
                },
            },
        }
    },
}


def _ex(utterance: str, kartu: list) -> str:
    return f"Ucapan operator: {utterance}\nKeluaran: {json.dumps({'kartu': kartu}, ensure_ascii=False)}"


def _c(q: str, kind: str, *opts: tuple[str, str]) -> dict:
    return {"pertanyaan_pendek": q, "jenis": kind, "opsi": [{"label": l, "ucapan": u} for l, u in opts]}


_TT = ("Tidak tahu", "Saya tidak tahu.")
CONTOH = [
    _ex("Korbannya masih sadar, Bu? Bisa diajak bicara?",
        [_c("Korban sadar?", "ya_tidak", ("Ya", "Ya, korban sadar."), ("Tidak", "Tidak, korban tidak sadar."), _TT)]),
    _ex("Ada berapa orang yang terluka?",
        [_c("Berapa terluka?", "angka", ("1", "Satu orang terluka."), ("2", "Dua orang terluka."),
            ("3+", "Tiga orang atau lebih terluka."), _TT)]),
    _ex("Lokasi persisnya di mana, dekat apa?",
        [_c("Lokasi tepat?", "lokasi", ("Kirim GPS", "Saya kirim lokasi GPS."),
            ("Tulis patokan", "Saya tulis patokannya."), _TT)]),
    _ex("Yang tabrakan mobil atau motor?",
        [_c("Mobil atau motor?", "pilihan", ("Mobil", "Mobil."), ("Motor", "Motor."), _TT)]),
    _ex("Coba ceritakan kejadiannya gimana.",
        [_c("Apa yang terjadi?", "terbuka", ("Ketik singkat", "Saya ketik singkat."), _TT)]),
    _ex("Ibu keluar dulu dari rumah ya, jangan masuk lagi.",
        [_c("Keluar dari rumah", "instruksi", ("Mengerti", "Baik, saya mengerti."),
            ("Ulangi", "Mohon ulangi arahannya."))]),
    _ex("Masih napas nggak? Ada pendarahan?",
        [_c("Korban bernapas?", "ya_tidak", ("Ya", "Ya, korban bernapas."),
            ("Tidak", "Tidak, korban tidak bernapas."), _TT),
         _c("Ada pendarahan?", "ya_tidak", ("Ya", "Ya, ada pendarahan."),
            ("Tidak", "Tidak, tidak ada pendarahan."), _TT)]),
    _ex("Baik, sebentar ya Bu.", []),
]

SYSTEM_PROMPT = """Kamu adalah penyederhana pertanyaan di sistem relay panggilan darurat 112 untuk warga tuli.
Masukan adalah transkrip ucapan operator 112 (bisa tidak baku dan mengandung salah dengar).
Tugasmu HANYA mengubah bentuk ucapan operator menjadi kartu pertanyaan pendek bertombol.

Aturan:
1. Jangan pernah menjawab atas nama pengguna dan jangan menebak jawaban.
2. Ringkas setiap pertanyaan menjadi paling banyak lima kata dalam bahasa Indonesia sederhana.
3. Label tombol paling banyak tiga kata.
4. Selalu sertakan opsi "Tidak tahu". Untuk jenis instruksi, sertakan "Mengerti" dan "Ulangi".
5. Pecah pertanyaan majemuk menjadi beberapa kartu, satu pertanyaan per kartu, paling banyak tiga kartu.
6. "ucapan" adalah kalimat pendek orang pertama yang akan dibacakan ke operator bila tombol itu diketuk.
   Ucapan harus setia pada label dan pertanyaan; jangan menambah fakta baru.
7. Pilih jenis: ya_tidak, angka, lokasi, pilihan, terbuka, atau instruksi.
8. Jika ucapan operator tidak berisi pertanyaan atau arahan (misalnya salam, "baik", "sebentar"),
   kembalikan daftar kartu kosong.

Contoh:
""" + "\n\n".join(CONTOH)

GPS_SPOKEN_TEMPLATE = ("Lokasi saya sesuai GPS: {alamat_singkat}. Koordinat {lat}, {lng}. "
                       "Akurasi sekitar {acc} meter.")  # filled by orchestrator (opener.gps_utterance)


@dataclass
class SimplifyResult:
    cards: list[Card]
    llm_status: str
    degradation: int
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None
    llm_start_at: datetime
    llm_end_at: datetime


class InvalidOutput(ValueError):
    pass


class OpenAIMessagesAdapter:
    """Adapts OpenAI-compatible /chat/completions (e.g. 9router) to messages.create interface."""
    def __init__(self, base_url: str, api_key: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or ""
        self._http: httpx.AsyncClient | None = None

    async def create(self, *, model: str, messages: list[dict], system: list[dict] | None = None, **kwargs):
        sys_text = ""
        if system:
            for s in system:
                if isinstance(s, dict) and s.get("type") == "text":
                    sys_text += s.get("text", "")
        chat_msgs = []
        if sys_text:
            chat_msgs.append({"role": "system", "content": sys_text})
        for m in messages:
            chat_msgs.append({"role": m["role"], "content": m["content"]})

        url = f"{self.base_url}/chat/completions" if not self.base_url.endswith("/chat/completions") else self.base_url
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        body = {
            "model": model,
            "stream": False,
            "messages": chat_msgs,
            "response_format": {"type": "json_object"},
        }
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=float(env("LLM_TIMEOUT_S") or 4.0))
        resp = await self._http.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if "```" in content:
            content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.MULTILINE).strip()
        u = data.get("usage", {})
        return SimpleNamespace(
            stop_reason="end_turn",
            content=[SimpleNamespace(type="text", text=content)],
            usage=SimpleNamespace(
                input_tokens=u.get("prompt_tokens"),
                output_tokens=u.get("completion_tokens"),
                cache_read_input_tokens=0,
            ),
        )


_client: anthropic.AsyncAnthropic | SimpleNamespace | None = None


def _get_client():
    global _client
    if _client is None:
        base_url = env("LLM_BASE_URL") or env("OPENAI_BASE_URL")
        if base_url:
            api_key = env("LLM_API_KEY") or env("OPENAI_API_KEY") or env("ANTHROPIC_API_KEY")
            _client = SimpleNamespace(messages=OpenAIMessagesAdapter(base_url, api_key))
        else:
            _client = anthropic.AsyncAnthropic(max_retries=0, timeout=float(env("LLM_TIMEOUT_S") or 2.0))
    return _client


def _now() -> datetime:
    return datetime.now(UTC)


# ---------- input ----------

def build_payload(transcript: str, incident: str, history: list[dict]) -> dict:
    turns = []
    for h in history[-2:]:
        action = h.get("action")
        jawaban = ("[jawaban teks]" if action == "ketik"
                   else "[lokasi dikirim]" if action == "kirim_gps" else h.get("jawaban", ""))
        turns.append({"operator": h.get("operator", ""), "jawaban": jawaban})
    return {"jenis_kejadian": incident, "putaran_sebelumnya": turns, "ucapan_operator": transcript}


# ---------- validator (§6.3.4) ----------

def _words(s: str) -> int:
    return len(s.split())


def _has(card: LlmCard, label: str) -> bool:
    return any(o.label.strip().lower() == label for o in card.opsi)


def validate_output(raw: dict) -> LlmOutput:
    try:
        out = LlmOutput.model_validate(raw)
    except ValidationError as e:
        raise InvalidOutput(f"schema: {e.error_count()} errors") from e
    if len(out.kartu) > 3:
        raise InvalidOutput("too many cards")
    for card in out.kartu:
        q = card.pertanyaan_pendek.strip()
        if not q or _words(q) > 6 or len(q) > 40:
            raise InvalidOutput("pertanyaan_pendek")
        if not 2 <= len(card.opsi) <= 5:
            raise InvalidOutput("option count")
        labels = [o.label.strip().lower() for o in card.opsi]
        if len(set(labels)) != len(labels):
            raise InvalidOutput("duplicate label")
        for o in card.opsi:
            lab = o.label.strip()
            if not lab or _words(lab) > 3 or len(lab) > 20:
                raise InvalidOutput("label")
            if not o.ucapan.strip() or _words(o.ucapan) > 15:
                raise InvalidOutput("ucapan")
        # instruksi uses Mengerti/Ulangi instead of Tidak tahu (prompt rule 4, example 6)
        required = "ulangi" if card.jenis == "instruksi" else "tidak tahu"
        if not _has(card, required):
            raise InvalidOutput(f"missing {required}")
    return out


# ---------- post-processing (§6.3.5) ----------

def _opt(label: str, spoken: str, action: str = "ucap") -> Option:
    return Option(label=label, action=action, spoken=spoken)


def _dont_know() -> Option:
    return _opt("Tidak tahu", PHRASES["P_DONTKNOW"])


def _first_word(s: str) -> str:
    parts = s.split()
    return parts[0].strip(",.!?").lower() if parts else ""


def _options(card: LlmCard, incident: str) -> list[Option]:
    kind = card.jenis
    if kind == "ya_tidak":
        by_label = {o.label.strip().lower(): o.ucapan.strip() for o in card.opsi}
        result = []
        for label, word, fallback in (("Ya", "ya", "P_YES"), ("Tidak", "tidak", "P_NO")):
            spoken = by_label.get(word, "")
            if _first_word(spoken) != word or spoken.lower().startswith("tidak tahu"):
                spoken = PHRASES[fallback]
            result.append(_opt(label, spoken))
        return result + [_dont_know()]
    if kind == "lokasi":
        return [_opt("Kirim GPS", GPS_SPOKEN_TEMPLATE, "kirim_gps"),
                _opt("Tulis patokan", PHRASES["P_TYPED_PREFIX"], "ketik"), _dont_know()]
    if kind == "terbuka":
        phrases = INCIDENTS.get(incident, INCIDENTS["umum"])["ready_phrases"]
        return ([_opt(p, p.rstrip(".") + ".") for p in phrases]
                + [_opt("Ketik singkat", PHRASES["P_TYPED_PREFIX"], "ketik"), _dont_know()])
    if kind == "instruksi":
        return [_opt("Mengerti", PHRASES["P_UNDERSTOOD"]), _opt("Ulangi", PHRASES["P_REPEAT_INSTR"])]
    # angka / pilihan: LLM options (Tidak tahu moved to the end with the fixed phrase)
    keep = [_opt(o.label.strip(), o.ucapan.strip()) for o in card.opsi if o.label.strip().lower() != "tidak tahu"]
    if kind == "angka":
        keep = keep[:4]
    return keep + [_dont_know()]


def postprocess(out: LlmOutput, transcript: str, incident: str) -> list[Card]:
    return [Card(card_id=uuid4(), kind=c.jenis, question=c.pertanyaan_pendek.strip(), transcript=transcript,
                 options=_options(c, incident)) for c in out.kartu]


def generic_card(transcript: str) -> Card:
    return Card(card_id=uuid4(), kind="ya_tidak", question=transcript.strip()[:80], transcript=transcript,
                options=[_opt("Ya", PHRASES["P_YES"]), _opt("Tidak", PHRASES["P_NO"]), _dont_know(),
                         _opt("Minta ulangi", PHRASES["P_REPEAT"], "ulangi")],  # TRD §7 L1 "+ aksi Minta ulangi"
                degradation=1)


# ---------- cache (§6.3.6) ----------

_CACHE: OrderedDict[str, LlmOutput] = OrderedDict()
_CACHE_MAX = 1000


def cache_key(incident: str, transcript: str) -> str:
    norm = " ".join(re.sub(r"[^\w\s]", " ", transcript.lower()).split())
    return hashlib.sha256(f"{incident}|{norm}".encode()).hexdigest()


def _cache_put(key: str, out: LlmOutput) -> None:
    _CACHE[key] = out
    _CACHE.move_to_end(key)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)


# ---------- main ----------

async def simplify(transcript: str, incident: str, history: list[dict], force_fail: bool = False) -> SimplifyResult:
    start = _now()
    usage: tuple[int | None, int | None, int | None] = (None, None, None)

    def result(cards: list[Card], status: str, degradation: int) -> SimplifyResult:
        return SimplifyResult(cards, status, degradation, *usage, start, _now())

    def l1(status: str) -> SimplifyResult:
        return result([generic_card(transcript)], status, 1)

    if force_fail:
        return l1("forced")

    key = cache_key(incident, transcript) if not history else None
    if key and key in _CACHE:
        _CACHE.move_to_end(key)
        return result(postprocess(_CACHE[key], transcript, incident), "cache_hit", 0)

    payload = json.dumps(build_payload(transcript, incident, history), ensure_ascii=False)
    try:
        resp = await asyncio.wait_for(
            _get_client().messages.create(
                model=env("LLM_MODEL", "ag/gemini-3.8-flash-low" if (env("LLM_BASE_URL") or env("OPENAI_BASE_URL")) else "claude-haiku-5-5"),
                max_tokens=400,
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": payload}],
                thinking={"type": "disabled"},
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": SKEMA_KARTU}},
            ),
            timeout=LLM_TIMEOUT_S,
        )
    except (TimeoutError, anthropic.APITimeoutError, httpx.TimeoutException):
        return l1("timeout")
    except (anthropic.APIConnectionError, anthropic.RateLimitError, anthropic.APIStatusError, httpx.HTTPError) as e:
        log.warning("llm api_error %s", type(e).__name__)
        return l1("api_error")
    except Exception as e:  # emergency path must never crash (e.g. missing credentials)
        log.warning("llm unexpected %s", type(e).__name__)
        return l1("api_error")

    u = getattr(resp, "usage", None)
    usage = (getattr(u, "input_tokens", None), getattr(u, "output_tokens", None),
             getattr(u, "cache_read_input_tokens", None))
    if resp.stop_reason in ("refusal", "max_tokens"):
        return l1("refusal" if resp.stop_reason == "refusal" else "invalid_json")
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), None)
    try:
        raw = json.loads(text) if text is not None else None
    except json.JSONDecodeError:
        raw = None
    if not isinstance(raw, dict):
        return l1("invalid_json")
    try:
        out = validate_output(raw)
    except InvalidOutput as e:
        log.info("llm invalid_schema %s", e)
        return l1("invalid_schema")

    if key:
        _cache_put(key, out)
    return result(postprocess(out, transcript, incident), "ok", 0)
