import asyncio
import json
from types import SimpleNamespace

import httpx
import anthropic
import pytest

from config import INCIDENTS, PHRASES
from relay import simplifier as s


class FakeMessages:
    def __init__(self, response=None, exc=None, delay=0.0):
        self.response, self.exc, self.delay, self.calls = response, exc, delay, []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.exc:
            raise self.exc
        return self.response


def resp(body, stop_reason="end_turn"):
    text = body if isinstance(body, str) else json.dumps(body)
    return SimpleNamespace(
        stop_reason=stop_reason,
        content=[SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=900, output_tokens=60, cache_read_input_tokens=800),
    )


@pytest.fixture
def fake(monkeypatch):
    s._CACHE.clear()

    def install(**kw):
        msgs = FakeMessages(**kw)
        monkeypatch.setattr(s, "_client", SimpleNamespace(messages=msgs))
        return msgs
    return install


def card(q="Korban sadar?", kind="ya_tidak", opts=(("Ya", "Ya, sadar."), ("Tidak", "Tidak sadar."),
                                                  ("Tidak tahu", "Saya tidak tahu."))):
    return {"pertanyaan_pendek": q, "jenis": kind, "opsi": [{"label": l, "ucapan": u} for l, u in opts]}


# ---------- validator ----------

def test_validator_accepts_all_examples():
    for ex in s.CONTOH:
        s.validate_output(json.loads(ex.split("Keluaran: ", 1)[1]))


@pytest.mark.parametrize("bad", [
    {"kartu": [card()] * 4},                                         # > 3 cards
    {"kartu": [card(q="")]},                                         # empty question
    {"kartu": [card(q="satu dua tiga empat lima enam tujuh")]},      # > 6 words
    {"kartu": [card(q="x" * 41)]},                                   # > 40 chars
    {"kartu": [card(opts=(("Tidak tahu", "Saya tidak tahu."),))]},   # < 2 options
    {"kartu": [card(opts=tuple((f"O{i}", "u") for i in range(5)) + (("Tidak tahu", "u"),))]},  # > 5
    {"kartu": [card(opts=(("", "u"), ("Tidak tahu", "u")))]},        # empty label
    {"kartu": [card(opts=(("satu dua tiga empat", "u"), ("Tidak tahu", "u")))]},  # > 3 words
    {"kartu": [card(opts=(("x" * 21, "u"), ("Tidak tahu", "u")))]},  # > 20 chars
    {"kartu": [card(opts=(("Ya", "u"), ("ya", "u"), ("Tidak tahu", "u")))]},  # duplicate label
    {"kartu": [card(opts=(("Ya", ""), ("Tidak tahu", "u")))]},       # empty ucapan
    {"kartu": [card(opts=(("Ya", " ".join(["kata"] * 16)), ("Tidak tahu", "u")))]},  # > 15 words
    {"kartu": [card(opts=(("Ya", "u"), ("Tidak", "u")))]},           # missing Tidak tahu
    {"kartu": [card(kind="instruksi", opts=(("Mengerti", "u"), ("Tidak tahu", "u")))]},  # missing Ulangi
    {"kartu": [dict(card(), extra=1)]},                              # extra field
    {"kartu": [card(kind="aneh")]},                                  # bad kind
    {"cards": []},                                                   # wrong root
])
def test_validator_rejects(bad):
    with pytest.raises(s.InvalidOutput):
        s.validate_output(bad)


def test_validator_case_insensitive_tidak_tahu():
    s.validate_output({"kartu": [card(opts=(("Ya", "u"), ("TIDAK TAHU", "u")))]})


# ---------- post-processing ----------

def labels(c):
    return [o.label for o in c.options]


async def run(fake, kartu, incident="kebakaran", transcript="ucapan operator"):
    fake(response=resp({"kartu": kartu}))
    return await s.simplify(transcript, incident, [])


async def test_ya_tidak_order_and_spoken_guard(fake):
    r = await run(fake, [card(opts=(("Tidak tahu", "x"), ("Tidak", "Korban pingsan."), ("Ya", "Ya, korban sadar.")))])
    c = r.cards[0]
    assert r.llm_status == "ok" and r.degradation == 0
    assert labels(c) == ["Ya", "Tidak", "Tidak tahu"]
    assert [o.spoken for o in c.options] == ["Ya, korban sadar.", PHRASES["P_NO"], PHRASES["P_DONTKNOW"]]
    assert all(o.action == "ucap" for o in c.options)
    assert c.transcript == "ucapan operator"


async def test_angka_max4_plus_dontknow(fake):
    opts = tuple((str(i), f"{i} orang.") for i in range(1, 5)) + (("Tidak tahu", "x"),)
    c = (await run(fake, [card(q="Berapa terluka?", kind="angka", opts=opts)])).cards[0]
    assert labels(c) == ["1", "2", "3", "4", "Tidak tahu"]
    assert c.options[-1].spoken == PHRASES["P_DONTKNOW"]


async def test_lokasi_replaced(fake):
    c = (await run(fake, [card(q="Lokasi tepat?", kind="lokasi")])).cards[0]
    assert labels(c) == ["Kirim GPS", "Tulis patokan", "Tidak tahu"]
    assert [o.action for o in c.options] == ["kirim_gps", "ketik", "ucap"]


async def test_pilihan_dontknow_last(fake):
    opts = (("Tidak tahu", "x"), ("Mobil", "Mobil."), ("Motor", "Motor."))
    c = (await run(fake, [card(q="Mobil atau motor?", kind="pilihan", opts=opts)])).cards[0]
    assert labels(c) == ["Mobil", "Motor", "Tidak tahu"]
    assert c.options[-1].spoken == PHRASES["P_DONTKNOW"]


async def test_terbuka_ready_phrases(fake):
    c = (await run(fake, [card(q="Apa yang terjadi?", kind="terbuka")], incident="sakit")).cards[0]
    assert labels(c) == INCIDENTS["sakit"]["ready_phrases"] + ["Ketik singkat", "Tidak tahu"]
    assert [o.action for o in c.options] == ["ucap"] * 3 + ["ketik", "ucap"]


async def test_instruksi_replaced(fake):
    opts = (("Mengerti", "ok"), ("Ulangi", "ulang"))
    c = (await run(fake, [card(q="Keluar dari rumah", kind="instruksi", opts=opts)])).cards[0]
    assert [(o.label, o.spoken) for o in c.options] == [
        ("Mengerti", PHRASES["P_UNDERSTOOD"]), ("Ulangi", PHRASES["P_REPEAT_INSTR"])]


async def test_compound_two_cards_unique_ids(fake):
    r = await run(fake, [card("Korban bernapas?"), card("Ada pendarahan?")])
    assert [c.question for c in r.cards] == ["Korban bernapas?", "Ada pendarahan?"]
    assert r.cards[0].card_id != r.cards[1].card_id


async def test_empty_kartu(fake):
    r = await run(fake, [])
    assert r.cards == [] and r.llm_status == "ok" and r.degradation == 0
    assert (r.input_tokens, r.output_tokens, r.cache_read_tokens) == (900, 60, 800)


# ---------- L1 ----------

def test_generic_card():
    c = s.generic_card("x" * 100)
    assert c.question == "x" * 80 and c.degradation == 1 and c.kind == "ya_tidak"
    assert [o.spoken for o in c.options[:3]] == [PHRASES["P_YES"], PHRASES["P_NO"], PHRASES["P_DONTKNOW"]]


async def test_force_fail(fake):
    msgs = fake(response=resp({"kartu": []}))
    r = await s.simplify("Halo?", "umum", [], force_fail=True)
    assert r.degradation == 1 and r.cards[0].degradation == 1 and msgs.calls == []


async def test_timeout(fake, monkeypatch):
    monkeypatch.setattr(s, "LLM_TIMEOUT_S", 0.01)
    fake(response=resp({"kartu": []}), delay=0.5)
    r = await s.simplify("Korban sadar?", "umum", [])
    assert r.llm_status == "timeout" and r.degradation == 1 and r.cards[0].question == "Korban sadar?"


@pytest.mark.parametrize("exc", [
    anthropic.APIConnectionError(request=httpx.Request("POST", "https://x")),
    anthropic.RateLimitError("rl", response=httpx.Response(429, request=httpx.Request("POST", "https://x")), body=None),
    anthropic.InternalServerError("ise", response=httpx.Response(500, request=httpx.Request("POST", "https://x")), body=None),
])
async def test_api_errors(fake, exc):
    fake(exc=exc)
    r = await s.simplify("Korban sadar?", "umum", [])
    assert r.llm_status == "api_error" and r.degradation == 1


@pytest.mark.parametrize("response,status", [
    (resp({"kartu": []}, stop_reason="refusal"), "refusal"),
    (resp('{"kartu": [', stop_reason="max_tokens"), "invalid_json"),
    (resp("bukan json"), "invalid_json"),
    (resp({"kartu": [card(q="")]}), "invalid_schema"),
])
async def test_bad_responses(fake, response, status):
    fake(response=response)
    r = await s.simplify("Korban sadar?", "umum", [])
    assert r.llm_status == status and r.degradation == 1 and len(r.cards) == 1


# ---------- cache ----------

async def test_cache_hit_only_without_history(fake):
    msgs = fake(response=resp({"kartu": [card()]}))
    first = await s.simplify("Korban sadar, Bu?", "kebakaran", [])
    second = await s.simplify("korban   SADAR bu", "kebakaran", [])
    assert second.llm_status == "cache_hit" and len(msgs.calls) == 1
    assert second.cards[0].card_id != first.cards[0].card_id
    assert second.cards[0].transcript == "korban   SADAR bu"
    await s.simplify("Korban sadar, Bu?", "kebakaran", [{"operator": "Ada korban?", "jawaban": "Ya", "action": "ucap"}])
    assert len(msgs.calls) == 2
    await s.simplify("Korban sadar, Bu?", "kecelakaan", [])
    assert len(msgs.calls) == 3


# ---------- request shape + privacy ----------

async def test_request_shape_and_privacy(fake):
    msgs = fake(response=resp({"kartu": []}))
    history = [
        {"operator": "Ada korban?", "jawaban": "Ya", "action": "ucap"},
        {"operator": "Alamat?", "jawaban": "Jl. Melati 12 RT 3", "action": "ketik"},
        {"operator": "Lokasi?", "jawaban": "-7,25752, 112,75201", "action": "kirim_gps"},
    ]
    await s.simplify("Korban sadar?", "kebakaran", history)
    kw = msgs.calls[0]
    for banned in ("temperature", "top_p", "top_k"):
        assert banned not in kw
    assert kw["thinking"] == {"type": "disabled"} and kw["max_tokens"] == 400
    assert kw["output_config"] == {"effort": "low", "format": {"type": "json_schema", "schema": s.SKEMA_KARTU}}
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}
    payload = json.loads(kw["messages"][0]["content"])
    assert set(payload) == {"jenis_kejadian", "putaran_sebelumnya", "ucapan_operator"}
    assert payload["putaran_sebelumnya"] == [
        {"operator": "Alamat?", "jawaban": "[jawaban teks]"},
        {"operator": "Lokasi?", "jawaban": "[lokasi dikirim]"},
    ]
    raw = kw["messages"][0]["content"]
    assert "Melati" not in raw and "7,25752" not in raw
