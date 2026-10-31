"""Orchestrator state machine with fake STT/LLM/TTS/notify/db; tiny timeouts, no network."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import config
import orchestrator as orch
from config import PHRASES
from protocol import CallState as S, Card, CreateCall, Option


def now():
    return datetime.now(timezone.utc)


def ya_tidak(q, t, deg=0):
    return Card(card_id=uuid4(), kind="ya_tidak", question=q, transcript=t, degradation=deg, options=[
        Option(label="Ya", action="ucap", spoken="Ya."), Option(label="Tidak", action="ucap", spoken="Tidak."),
        Option(label="Tidak tahu", action="ucap", spoken=PHRASES["P_DONTKNOW"])])


def lokasi(t):
    return Card(card_id=uuid4(), kind="lokasi", question="Di mana?", transcript=t, options=[
        Option(label="Kirim GPS", action="kirim_gps", spoken=""),
        Option(label="Tulis patokan", action="ketik", spoken=""),
        Option(label="Tidak tahu", action="ucap", spoken=PHRASES["P_DONTKNOW"])])


class FakeDB:
    def __init__(self):
        self.events, self.calls, self.updates, self.turns = [], [], [], {}

    def log_event(self, call_id, seq, event, from_state, to_state, ignored=False, payload=None):
        self.events.append(SimpleNamespace(seq=seq, event=event, frm=from_state, to=to_state,
                                           ignored=ignored, payload=payload or {}))

    async def insert_call(self, **f):
        self.calls.append(f)
        return f["id"]

    async def update_call(self, call_id, **f):
        self.updates.append(f)

    async def upsert_turn(self, **f):
        self.turns.setdefault(f["card_id"], {}).update(f)


class FakeTTS:
    def __init__(self):
        self.force_fail, self.spoken = False, []

    async def speak(self, text, fmt="pcm24k"):
        if self.force_fail:
            raise RuntimeError("tts down")
        self.spoken.append(text)
        yield b"\x00" * 480  # 10 ms

    def cached(self, key):
        return b"\x00" * 48


async def fake_simplify(transcript, incident, history, force_fail=False):
    if force_fail or transcript.startswith("FAIL"):
        raise RuntimeError("llm down")
    if transcript.startswith("Baik"):
        cards = []
    elif "lokasi" in transcript.lower():
        cards = [lokasi(transcript)]
    else:
        cards = [ya_tidak(q.strip(), transcript) for q in transcript.split("&")]
    t = now()
    return SimpleNamespace(cards=cards, llm_status="ok", degradation=0, input_tokens=10, output_tokens=5,
                           cache_read_tokens=0, llm_start_at=t, llm_end_at=t)


class FakeStream:
    def __init__(self, codec, on_final, on_partial, on_error):
        self.codec, self.mutes, self.frames = codec, [], []

    async def start(self):
        pass

    async def send_audio(self, frame):
        self.frames.append(frame)

    def mute(self, muted):
        self.mutes.append(muted)

    async def close(self):
        pass


class FakeWS:
    def __init__(self):
        self.sent, self.bytes, self.closed = [], [], None

    async def send_json(self, m):
        self.sent.append(m)

    async def send_bytes(self, b):
        self.bytes.append(b)

    async def close(self, code=1000):
        self.closed = code

    def of(self, type_):
        return [m["data"] for m in self.sent if m["type"] == type_]


@pytest.fixture
async def f(monkeypatch):
    for k, v in {"RING_TIMEOUT_S": 5, "WAIT_TICK_S": 5, "HALF_DUPLEX_TAIL_S": 0,
                 "USER_LINK_LOST_S": 0.05, "LLM_TIMEOUT_S": 0.2}.items():
        monkeypatch.setattr(config, k, v)
    ns = SimpleNamespace(db=FakeDB(), tts=FakeTTS(), notified=[], broadcasts=[])

    async def notify_contacts(call_id, user_id, trigger, mode):
        ns.notified.append(trigger)
        return 2

    async def broadcast(user_id, msg):
        ns.broadcasts.append(msg)

    async def reverse_geocode(lat, lng):
        return "Jl. Mawar"

    monkeypatch.setattr(orch, "DEPS", {
        "db": ns.db,
        "relay.tts": SimpleNamespace(tts=ns.tts),
        "relay.stt": SimpleNamespace(DeepgramStream=FakeStream),
        "relay.simplifier": SimpleNamespace(simplify=fake_simplify,
                                            generic_card=lambda t: ya_tidak(t[:80], t, deg=1)),
        "opener": SimpleNamespace(build_opener=lambda p, i, loc, addr: f"OPENER {i} {addr}",
                                  gps_utterance=lambda addr, lat, lng, acc: f"GPS {addr} {lat} {lng} {acc}"),
        "dispatch": SimpleNamespace(is_dispatch=lambda t: "dikirim" in t.lower(),
                                    is_repeat_opener=lambda t: "ulang" in t and "alamat" in t),
        "geocode": SimpleNamespace(reverse_geocode=reverse_geocode),
        "notify": SimpleNamespace(notify_contacts=notify_contacts, console_sms_sink=None,
                                  contact_hub=SimpleNamespace(broadcast=broadcast)),
    })
    orch.SESSIONS.clear()
    hub = orch.Channel(None)
    hub.ws = FakeWS()
    monkeypatch.setattr(orch.HUB, "chans", [hub])
    ns.hub = hub.ws
    yield ns
    for s in list(orch.SESSIONS.values()):
        s.task.cancel()
        s._dbw.cancel()
        s._cancel_timers()
    orch.SESSIONS.clear()


async def until(pred, timeout=2.0):
    for _ in range(int(timeout / 0.005)):
        if pred():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("condition not reached")


async def settle(s):
    await until(lambda: s.q.empty())
    await asyncio.sleep(0.03)


async def new_call(location=True, user=None):
    loc = {"lat": -7.257525, "lng": 112.752134, "accuracy_m": 8, "captured_at": now()} if location else None
    req = CreateCall(incident="kebakaran", mode="simulasi", device_key=uuid4(), location=loc, client_ts=now())
    body = await orch.start_call(user or uuid4(), None, req, {"display_name": "Rina", "address": "Jl. Mawar 12"})
    s = orch.SESSIONS[UUID(body["call_id"])]
    s.user.ws, s.op.ws = FakeWS(), FakeWS()
    await until(lambda: s.state is S.MEMANGGIL)
    return s, body


async def answer(s):
    s.post("operator_answered", codec="pcm16_16k")
    await until(lambda: s.state is S.MENDENGAR)


async def ask(s, text, state=S.MENUNGGU_JAWABAN):
    s.post("utterance_final", text=text, confidence=0.9, speech_end_at=now(), final_at=now())
    await until(lambda: s.state is state)


def tap(s, idx=0, card_id=None, **kw):
    ev = {"gps": "user_gps", "text": "user_text"}.get(kw.pop("kind", None), "user_tap")
    s.post(ev, card_id=card_id or s.active.card.card_id, option_index=idx, client_ts=now(), **kw)


def ignored(f, event):
    return [e for e in f.db.events if e.event == event and e.ignored]


TABLE = [
    (S.MEMANGGIL, "operator_answered", {"codec": "pcm16_16k"}, S.PEMBUKA, False),
    (S.MEMANGGIL, "user_cancel", {}, S.SELESAI, False),
    (S.MEMANGGIL, "opener_done", {}, S.MEMANGGIL, True),
    (S.PEMBUKA, "utterance_final", {"text": "Halo, ada apa?"}, S.PEMBUKA, True),
    (S.PEMBUKA, "opener_done", {}, S.MENDENGAR, False),
    (S.MENDENGAR, "utterance_final", {"text": "a"}, S.MENDENGAR, True),
    (S.MENDENGAR, "utterance_final", {"text": "Korban sadar?"}, S.MENUNGGU_JAWABAN, False),
    (S.MENDENGAR, "utterance_final", {"text": "Baik, sebentar"}, S.MENDENGAR, False),
    (S.MENDENGAR, "operator_hangup", {}, S.SELESAI, False),
    (S.MENDENGAR, "user_link_lost", {}, S.FALLBACK, False),
    (S.MENDENGAR, "retry_requested", {}, S.MENDENGAR, True),
    (S.FALLBACK, "retry_requested", {}, S.MEMANGGIL, False),
    (S.FALLBACK, "operator_answered", {"codec": "mulaw_8k"}, S.PEMBUKA, False),
    (S.FALLBACK, "user_cancel", {}, S.SELESAI, False),
    (S.FALLBACK, "operator_hangup", {}, S.FALLBACK, True),
]


@pytest.mark.parametrize("start,event,data,expected,is_ignored", TABLE)
async def test_transition_table(f, start, event, data, expected, is_ignored):
    s, _ = await new_call()
    if start is S.MENDENGAR:
        await answer(s)
    elif start is not S.MEMANGGIL:
        s._cancel_timers()
        s.state = start
    n = len(f.db.events)
    s.post(event, **data)
    await settle(s)
    if is_ignored:
        assert s.state is expected and ignored(f, event)
    else:  # state may move on (e.g. opener finishes); the log proves the transition happened
        assert expected in [e.to for e in f.db.events[n:] if not e.ignored] and not ignored(f, event)


async def test_start_call_response_and_conflict(f):
    uid = uuid4()
    s, body = await new_call(user=uid)
    assert body["state"] == "MEMANGGIL" and body["ws_ticket"] and body["practice"] is False
    assert body["opener_text"] == "OPENER kebakaran Jl. Mawar"  # geocoded: accuracy 8 m <= 100
    assert body["ws_url"].endswith(f"/ws/calls/{body['call_id']}/user")
    assert f.db.calls[0]["state"] == "SIAGA" and f.db.calls[0]["location_source"] == "gps"
    assert f.hub.of("incoming_call")[0]["attempt"] == 1
    with pytest.raises(ValueError, match="CONFLICT"):
        await new_call(user=uid)
    assert [c["call_id"] for c in await orch.active_calls()] == [body["call_id"]]
    await settle(s)
    assert f.notified == ["panggilan_dibuat"]


async def test_ring_timeout_three_times_fallback_notifies_once(f, monkeypatch):
    monkeypatch.setattr(config, "RING_TIMEOUT_S", 0.02)
    s, _ = await new_call()
    await until(lambda: s.state is S.FALLBACK)
    await settle(s)
    assert [d["attempt"] for d in f.hub.of("incoming_call")] == [1, 2, 3]
    assert f.notified.count("fallback") == 1
    fb = s.user.ws.of("fallback")[0]
    assert fb["contacts_notified"] == 2 and fb["can_retry"] and fb["sms_text"].startswith("DARURAT KEBAKARAN")
    s.post("retry_requested")  # round 2: attempts 4..6
    await until(lambda: s.total == 6 and s.state is S.FALLBACK)
    await settle(s)
    assert f.notified.count("fallback") == 1
    assert s.user.ws.of("fallback")[-1]["can_retry"] is False
    s.post("retry_requested")
    await settle(s)
    assert s.state is S.FALLBACK and ignored(f, "retry_requested")
    s.post("user_cancel", confirm=True)
    await until(lambda: s.state is S.SELESAI)
    assert s.end_reason == "fallback_exhausted"


async def test_console_reject_counts_as_ring_timeout(f):
    s, _ = await new_call()
    await s.on_console_msg({"type": "reject", "data": {}})
    await until(lambda: s.attempt == 2)
    assert s.state is S.MEMANGGIL


async def test_wait_tick_plays_p_wait(f, monkeypatch):
    monkeypatch.setattr(config, "WAIT_TICK_S", 0.03)
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Korban sadar?")
    await until(lambda: f.tts.spoken.count(PHRASES["P_WAIT"]) >= 2)
    assert s.state is S.MENUNGGU_JAWABAN


async def test_compound_question_shows_card_two_after_card_one(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Masih napas? & Ada pendarahan?")
    cards = s.user.ws.of("card")
    assert len(cards) == 1 and cards[0]["question"] == "Masih napas?" and cards[0]["total"] == 2
    assert "spoken" not in cards[0]["options"][0]
    tap(s, 0)
    await until(lambda: len(s.user.ws.of("card")) == 2)
    card2 = s.user.ws.of("card")[1]
    assert card2["question"] == "Ada pendarahan?" and card2["index"] == 1
    assert s.state is S.MENUNGGU_JAWABAN
    tap(s, 1)
    await until(lambda: s.state is S.MENDENGAR)
    assert f.tts.spoken[-2:] == ["Ya.", "Tidak."]
    await settle(s)
    turn = f.db.turns[UUID(card2["card_id"])]
    assert turn["answer_spoken"] == "Tidak." and turn["tts_first_chunk_at"] and turn["card_sent_at"]
    for e in f.db.events:  # no transcripts in audit log
        assert "napas" not in str(e.payload) and "pendarahan" not in str(e.payload)


async def test_tap_on_stale_card_ignored(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Korban sadar?")
    tap(s, 0, card_id=uuid4())
    await settle(s)
    assert s.state is S.MENUNGGU_JAWABAN and ignored(f, "user_tap")
    assert f.tts.spoken == ["OPENER kebakaran Jl. Mawar"]


async def test_double_tap_ignored(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Korban sadar?")
    cid = s.active.card.card_id
    tap(s, 0, card_id=cid)
    tap(s, 1, card_id=cid)
    await until(lambda: s.state is S.MENDENGAR)
    assert f.tts.spoken[1:] == ["Ya."] and len(ignored(f, "user_tap")) == 1


async def test_llm_failure_gives_l1_generic_card(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "FAIL korbannya bagaimana?")
    card = s.user.ws.of("card")[0]
    assert card["degradation"] == 1 and card["question"] == "FAIL korbannya bagaimana?"
    assert s.user.ws.of("degradation")[0]["level"] == 1 and s.degradation_max == 1


async def test_forced_llm_degradation(f):
    s, _ = await new_call()
    await answer(s)
    await s.on_console_msg({"type": "force_degradation", "data": {"llm": True, "stt": False, "tts": False}})
    await ask(s, "Korban sadar?")
    assert s.user.ws.of("card")[0]["degradation"] == 1


async def test_cancel_after_answer_plays_p_cancel(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Korban sadar?")
    tap(s, 0)
    await until(lambda: s.state is S.MENDENGAR)
    s.post("user_cancel", confirm=True)
    await until(lambda: s.call_id not in orch.SESSIONS)
    assert f.tts.spoken[-1] == PHRASES["P_CANCEL"]
    assert s.end_reason == "user_cancel" and s.user.ws.of("ended")[0]["reason"] == "user_cancel"
    end = next(u for u in f.db.updates if "ended_at" in u)
    assert end["lat"] == -7.258 and end["lng"] == 112.752 and s.user.ws.closed == 1000


async def test_user_link_lost_goes_fallback(f):
    s, _ = await new_call()
    await answer(s)
    s.user_disconnected()
    await until(lambda: s.state is S.FALLBACK)
    await settle(s)
    assert PHRASES["P_USER_LOST"] in f.tts.spoken and f.notified.count("fallback") == 1
    assert s.user.ws.of("fallback")[0]["reason"] == "user_link_lost"


async def test_user_reconnect_cancels_link_lost(f):
    s, _ = await new_call()
    await answer(s)
    s.user_disconnected()
    s.user_connected(FakeWS())
    await asyncio.sleep(0.1)
    assert s.state is S.MENDENGAR


async def test_dispatch_keyword_sets_dispatched_at_once(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Ambulans sudah dikirim ya")
    s.post("dispatch_confirmed", source="console")
    await settle(s)
    tap(s, 0)
    await until(lambda: s.state is S.MENDENGAR)
    await ask(s, "Petugas dikirim, tunggu")
    await settle(s)
    assert len(s.user.ws.of("dispatch")) == 1 and s.user.ws.of("dispatch")[0]["source"] == "keyword"
    assert len([u for u in f.db.updates if "dispatched_at" in u]) == 1
    assert f.notified.count("dispatch") == 1
    assert [m["type"] for m in f.broadcasts].count("dispatch") == 1


async def test_gps_and_typed_answers_spoken_text(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Lokasinya di mana?")
    tap(s, 0, kind="gps", lat=-7.1, lng=112.2, accuracy_m=12)
    await until(lambda: s.state is S.MENDENGAR)
    assert f.tts.spoken[-1] == "GPS Jl. Mawar -7.1 112.2 12"
    assert "location_confirmed_at" in s.ts
    await ask(s, "Lokasinya di mana?")
    tap(s, 1, kind="text", text="Depan masjid")
    await until(lambda: s.state is S.MENDENGAR)
    assert f.tts.spoken[-1] == f"{PHRASES['P_TYPED_PREFIX']} Depan masjid"


async def test_repeat_plays_p_repeat_and_drops_card(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Korban sadar?")
    s.post("user_repeat", card_id=s.active.card.card_id, client_ts=now())
    await until(lambda: s.state is S.MENDENGAR)
    assert f.tts.spoken[-1] == PHRASES["P_REPEAT"]


async def test_utterance_while_simplifying_is_pending(f):
    s, _ = await new_call()
    await answer(s)
    s._cancel_timers()
    s.state = S.MENYEDERHANAKAN
    s.inflight = 0
    s.post("utterance_final", text="Ada korban?")
    await settle(s)
    assert s.pending and s.state is S.MENYEDERHANAKAN
    s.post("cards_ready", turn=1, utt={"text": "Baik"}, cards=[], llm={"llm_status": "ok"})
    await until(lambda: s.state is S.MENUNGGU_JAWABAN)
    assert s.user.ws.of("card")[0]["question"] == "Ada korban?"


async def test_tts_failure_falls_back_to_phrase_cache(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Korban sadar?")
    await s.on_console_msg({"type": "force_degradation", "data": {"llm": False, "stt": False, "tts": True}})
    tap(s, 0)
    await until(lambda: s.state is S.MENDENGAR)
    assert s.degradation_max == 3
    assert s.user.ws.of("answer_status")[-1]["status"] == "spoken"
    assert s.op.ws.bytes[-2][0] == 1 and s.op.ws.bytes[-1] == b"\x02"


async def test_history_is_short_question_and_label_masked(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Korban sadar? Tolong jawab cepat ya Bu")
    tap(s, 0)
    await until(lambda: s.state is S.MENDENGAR)
    await ask(s, "Lokasinya di mana?")
    tap(s, 1, kind="text", text="Depan masjid Al-Falah")
    await until(lambda: s.state is S.MENDENGAR)
    await ask(s, "Lokasinya di mana?")
    tap(s, 0, kind="gps", lat=-7.1, lng=112.2, accuracy_m=12)
    await until(lambda: s.state is S.MENDENGAR)
    assert s.history == [
        {"operator": "Korban sadar? Tolong jawab cepat ya Bu", "action": "ucap", "jawaban": "Ya"},
        {"operator": "Di mana?", "action": "ketik", "jawaban": "[jawaban teks]"},
        {"operator": "Di mana?", "action": "kirim_gps", "jawaban": "[lokasi dikirim]"}]
    assert "masjid" not in str(s.history) and "Mawar" not in str(s.history)


async def test_forced_tts_is_per_session_not_singleton(f):
    s, _ = await new_call()
    await answer(s)
    await s.on_console_msg({"type": "force_degradation", "data": {"llm": False, "stt": False, "tts": True}})
    assert f.tts.force_fail is False
    await ask(s, "Korban sadar?")
    n = len(f.tts.spoken)
    tap(s, 0)
    await until(lambda: s.state is S.MENDENGAR)
    assert len(f.tts.spoken) == n and s.degradation_max == 3  # tts.speak skipped, cache path used


async def test_tts_failure_without_cache_unlocks_card(f):
    s, _ = await new_call()
    await answer(s)
    await ask(s, "Korban sadar?")
    f.tts.force_fail = True  # "Ya." is cached; use a non-phrase answer to hit the no-cache path
    s.active.card.options[0].spoken = "Korbannya sadar penuh."
    cid = s.active.card.card_id
    tap(s, 0)
    await until(lambda: [m["status"] for m in s.user.ws.of("answer_status")][-1:] == ["failed"])
    await until(lambda: s.state is S.MENUNGGU_JAWABAN)
    assert s.history == [] and not s.active.answered
    f.tts.force_fail = False
    tap(s, 0, card_id=cid)
    await until(lambda: s.state is S.MENDENGAR)
    assert s.user.ws.of("answer_status")[-1]["status"] == "spoken" and f.tts.spoken[-1] == "Korbannya sadar penuh."


async def test_latihan_skips_contact_broadcasts(f):
    loc = {"lat": -7.2, "lng": 112.7, "accuracy_m": 8, "captured_at": now()}
    req = CreateCall(incident="kebakaran", mode="latihan", device_key=uuid4(), location=loc, client_ts=now())
    body = await orch.start_call(uuid4(), None, req, {})
    s = orch.SESSIONS[UUID(body["call_id"])]
    s.user.ws, s.op.ws = FakeWS(), FakeWS()
    await answer_when_ringing(s)
    await settle(s)
    assert f.broadcasts == []


async def answer_when_ringing(s):
    await until(lambda: s.state is S.MEMANGGIL)
    await answer(s)


async def test_l2_stt_forced_sends_operator_speaking_from_rms(f):
    s, _ = await new_call()
    await answer(s)
    await s.on_console_msg({"type": "force_degradation", "data": {"llm": False, "stt": True, "tts": False}})
    await settle(s)
    loud = (8000).to_bytes(2, "little", signed=True) * 1600
    await s.on_audio(loud)
    await s.on_audio(b"\x00\x00" * 1600)
    assert s.user.ws.of("operator_speaking") == [{"active": True}, {"active": False}]
    assert s.stt.frames == []


async def test_half_duplex_mutes_stt_during_tts(f):
    s, _ = await new_call()
    await answer(s)
    await settle(s)
    assert s.stt.mutes[:2] == [True, False] and s.muted is False
    assert s.op.ws.of("half_duplex") == [{"muted": True}, {"muted": False}]


async def test_resume_replays_after_last_seq(f):
    s, _ = await new_call()
    await answer(s)
    ws = FakeWS()
    s.user.ws = ws
    await s.on_user_msg({"type": "resume", "data": {"last_seq": 1}})
    assert [m["seq"] for m in ws.sent] == list(range(2, s.user.seq + 1))


def test_ws_close_codes():
    app = FastAPI()
    app.include_router(orch.router)
    import auth
    with TestClient(app) as c:
        with c.websocket_connect(f"/ws/calls/{uuid4()}/operator?token=bad") as ws:
            assert ws.receive()["code"] == 4401
        with c.websocket_connect(f"/ws/calls/{uuid4()}/operator?token={auth.issue_console_jwt()}") as ws:
            assert ws.receive()["code"] == 4404
        with c.websocket_connect(f"/ws/console?token=bad") as ws:
            assert ws.receive()["code"] == 4401
