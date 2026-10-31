"""Call orchestrator (TRD §5): one CallSession per call, one event queue, one consumer task.

Every state change happens only inside the consumer (`CallSession._run`). Timers, TTS playback,
LLM calls and STT callbacks are tasks that *post events*; they never touch `state`.
Sibling modules (stt, simplifier, tts, opener, dispatch, geocode, notify, db) are resolved lazily
through `dep()` so tests can inject fakes via `DEPS`.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import logging
import math
from array import array
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, WebSocket
from pydantic import TypeAdapter, ValidationError

import auth
import config
from config import INCIDENTS, PHRASES
from protocol import CallState as S
from protocol import Card, ConsoleToServer, CreateCall, UserToServer, card_for_client

log = logging.getLogger("jembatan112.orchestrator")
router = APIRouter()

DEPS: dict[str, object] = {}  # module name -> fake (tests); empty = real modules
if config.env("J112_FAKE_PROVIDERS") == "1":  # dev/smoke: no Deepgram/Anthropic/Google/Nominatim
    import fakes
    DEPS.update(fakes.DEPS)


def dep(name: str):
    return DEPS.get(name) or importlib.import_module(name)


ACTIVE = {S.PEMBUKA, S.MENDENGAR, S.MENYEDERHANAKAN, S.MENUNGGU_JAWABAN, S.MEMBACAKAN}
REPLAY = 200
RMS_THRESHOLD = 500.0  # L2 operator_speaking; ponytail: fixed threshold, calibrate per mic if noisy
PCM24K_BPS = 48_000  # bytes/s of LINEAR16 24 kHz mono, used to wait out playback
USER_ADAPTER = TypeAdapter(UserToServer)
CONSOLE_ADAPTER = TypeAdapter(ConsoleToServer)
USER_EVENTS = {"tap": "user_tap", "gps": "user_gps", "text": "user_text", "repeat": "user_repeat",
               "cancel": "user_cancel", "retry": "retry_requested", "card_shown": "card_shown"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _phrase_key(text: str) -> str | None:
    return next((k for k, v in PHRASES.items() if v == text), None)


def _ulaw(b: int) -> int:
    b = ~b & 0xFF
    t = (((b & 0x0F) << 3) + 0x84) << ((b & 0x70) >> 4)
    return 0x84 - t if b & 0x80 else t - 0x84


def frame_rms(frame: bytes, codec: str) -> float:
    if codec == "mulaw_8k":
        samples = [_ulaw(b) for b in frame]
    else:
        samples = array("h")
        samples.frombytes(frame[: len(frame) // 2 * 2])
    return math.sqrt(sum(x * x for x in samples) / len(samples)) if len(samples) else 0.0


class Channel:
    """Outbound seq numbers + replay buffer for one socket role. Acks are recorded, never awaited."""

    def __init__(self, call_id: UUID | None):
        self.call_id, self.seq, self.acked = call_id, 0, 0
        self.buf: deque[dict] = deque(maxlen=REPLAY)
        self.ws: WebSocket | None = None
        self.offset = None  # server - client clock (TRD §6.5)

    async def send(self, type_: str, data: dict, call_id: UUID | None = None) -> None:
        self.seq += 1
        msg = {"v": 1, "type": type_, "seq": self.seq, "call_id": str(call_id or self.call_id),
               "ts": iso(now()), "data": data}
        self.buf.append(msg)
        await self._push(msg)

    async def _push(self, msg: dict) -> None:
        if self.ws is not None:
            try:
                await self.ws.send_json(msg)
            except Exception:
                pass  # socket dying; resume replays from buf

    async def send_bytes(self, b: bytes) -> None:
        if self.ws is not None:
            try:
                await self.ws.send_bytes(b)
            except Exception:
                pass

    async def resume(self, last_seq: int) -> None:
        for msg in list(self.buf):
            if msg["seq"] > last_seq:
                await self._push(msg)

    def ping(self, client_ts: datetime) -> None:
        # ponytail: one-way offset (recv - client_ts); half-RTT needs a client echo, add if skew matters
        self.offset = now() - _aware(client_ts)

    def to_server(self, client_ts: datetime | None) -> datetime:
        if client_ts is None or self.offset is None:
            return now()
        return _aware(client_ts) + self.offset


class ConsoleHub:
    def __init__(self):
        self.chans: list[Channel] = []

    async def send(self, type_: str, data: dict, call_id: UUID) -> None:
        for ch in list(self.chans):
            await ch.send(type_, data, call_id)


HUB = ConsoleHub()
SESSIONS: dict[UUID, "CallSession"] = {}
ENDED: set[UUID] = set()
_starting: set[UUID] = set()


@dataclass
class Entry:
    card: Card
    turn_no: int
    index: int
    total: int
    utt: dict
    llm: dict
    answered: bool = False
    repeat: bool = False
    answer: dict = field(default_factory=dict)
    t: dict = field(default_factory=dict)  # timing columns of call_turns


class CallSession:
    def __init__(self, call_id: UUID, user_id: UUID, req: CreateCall, profile: dict | None,
                 opener_text: str, address: str | None):
        self.call_id, self.user_id, self.profile = call_id, user_id, profile or {}
        self.incident, self.mode, self.location = req.incident, req.mode, req.location
        self.opener_text, self.address = opener_text, address
        self.state = S.SIAGA
        self.attempt = self.total = self.turn_no = self.ev_seq = self.inflight = 0
        self.degradation_max = self.contacts_notified = 0
        self.user, self.op = Channel(call_id), Channel(call_id)
        self.q: asyncio.Queue = asyncio.Queue()
        self.timers: dict[str, asyncio.Task] = {}
        self._tok: dict[str, object] = {}
        self.link_timer: asyncio.Task | None = None
        self.cards: deque[Entry] = deque()
        self.active: Entry | None = None
        self.speaking: Entry | None = None
        self.last_spoken: Entry | None = None
        self.pending: list[dict] = []
        self.history: list[dict] = []
        self.flags = {"llm": False, "stt": False, "tts": False}
        self.stt = None
        self.codec = "pcm16_16k"
        self.stt_failed = self.muted = self.op_speaking = self.fallback_notified = False
        self._play_task: asyncio.Task | None = None
        self._play_gen = 0
        self._last_partial = 0.0
        self.ts: dict[str, datetime] = {"sos_confirmed_at": now()}
        self.end_reason: str | None = None
        self._tasks: set[asyncio.Task] = set()
        self._dbq: asyncio.Queue = asyncio.Queue()
        self._dbw = asyncio.create_task(self._db_writer())
        self.task = asyncio.create_task(self._run())

    # ---------- plumbing ----------
    def post(self, event: str, **data) -> None:
        self.q.put_nowait((event, data))

    async def _run(self) -> None:
        while self.state is not S.SELESAI:
            ev, data = await self.q.get()
            try:
                await self._handle(ev, data)
            except Exception:
                log.exception("orchestrator: %s failed in %s", ev, self.state)

    async def _handle(self, ev: str, data: dict) -> None:
        tok, name = data.pop("_tok", None), data.pop("_timer", None)
        if tok is not None and self._tok.get(name) is not tok:
            return self._log(ev, self.state, self.state, ignored=True, stale_timer=True)
        fn = getattr(self, f"_on_{ev}", None)
        if fn is None or await fn(**data) is False:
            self._log(ev, self.state, self.state, ignored=True)

    def _bg(self, coro) -> asyncio.Task:
        t = asyncio.create_task(self._safe(coro))
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    @staticmethod
    async def _safe(coro):
        try:
            return await coro
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("orchestrator: background task failed")

    def _db(self, fn: str, *args, **kw) -> None:
        self._dbq.put_nowait((fn, args, kw))

    async def _db_writer(self) -> None:  # serialised so upserts of one card never reorder
        while True:
            fn, args, kw = await self._dbq.get()
            try:
                await getattr(dep("db"), fn)(*args, **kw)
            except Exception as e:
                log.warning("orchestrator: db.%s failed: %s", fn, type(e).__name__)
            self._dbq.task_done()

    def _log(self, ev: str, frm, to, ignored: bool = False, **payload) -> None:
        self.ev_seq += 1  # payload: counters/codes only, never transcripts or PII
        dep("db").log_event(self.call_id, self.ev_seq, ev, frm, to, ignored=ignored, payload=payload or None)

    def _set_ts(self, **kw) -> None:
        self.ts.update(kw)
        self._db("update_call", self.call_id, **kw)

    def _timer(self, name: str, delay: float, ev: str) -> None:
        if t := self.timers.pop(name, None):
            t.cancel()
        tok = self._tok[name] = object()

        async def fire():
            await asyncio.sleep(delay)
            self.post(ev, _timer=name, _tok=tok)
        self.timers[name] = asyncio.create_task(fire())

    def _cancel_timers(self) -> None:
        for t in self.timers.values():
            t.cancel()
        self.timers.clear()
        self._tok.clear()

    async def _go(self, to: S, ev: str, **payload) -> None:
        frm = self.state
        self.state = to
        self._log(ev, frm, to, **payload)
        if to is not frm:
            self._cancel_timers()
            self._db("update_call", self.call_id, state=str(to))
            await self._send_state()
            self._contact({"type": "state", "data": {"state": str(to)}})

    async def _send_state(self) -> None:
        await self.user.send("state", {"state": str(self.state), "attempt": self.attempt,
                                       "max_attempts": config.MAX_ATTEMPTS})
        await self.op.send("state", {"state": str(self.state), "attempt": self.attempt})

    def _contact(self, msg: dict) -> None:
        if self.mode == "latihan":  # practice calls never reach real contacts
            return
        msg = {**msg, "data": {**msg["data"], "call_id": str(self.call_id)}}
        self._bg(dep("notify").contact_hub.broadcast(self.user_id, msg))

    def _notify(self, trigger: str):
        return dep("notify").notify_contacts(self.call_id, self.user_id, trigger=trigger, mode=self.mode)

    async def _timeline(self) -> None:
        await self.user.send("timeline", {k: iso(self.ts.get(k)) for k in
                                          ("answered_at", "location_confirmed_at", "dispatched_at",
                                           "contacts_notified_at")})

    async def _degrade(self, level: int, reason: str) -> None:
        self.degradation_max = max(self.degradation_max, level)
        self._log("degradation", self.state, self.state, degradation=level, reason=reason)
        await self.user.send("degradation", {"level": level, "reason": reason})

    def incoming(self) -> dict:
        return {"call_id": str(self.call_id), "incident": self.incident, "mode": self.mode,
                "attempt": self.attempt}

    # ---------- half-duplex TTS ----------
    def _set_mute(self, muted: bool) -> None:
        if muted == self.muted:
            return
        self.muted = muted
        if self.stt is not None:
            self.stt.mute(muted)
        self._bg(self.op.send("half_duplex", {"muted": muted}))

    def _play(self, text, done: str | None = None, entry: Entry | None = None) -> asyncio.Task:
        """text: str or awaitable -> str. Posts `done` after playback (not if cancelled)."""
        if self._play_task:
            self._play_task.cancel()
        self._play_gen += 1
        self._set_mute(True)
        self._play_task = asyncio.create_task(self._speak(text, done, entry, self._play_gen))
        return self._play_task

    async def _speak(self, text, done, entry, gen) -> None:
        ok = True
        try:
            if not isinstance(text, str):
                text = await text
            if entry is not None:
                entry.answer["spoken"] = text
            tts = dep("relay.tts").tts
            loop = asyncio.get_running_loop()
            t0, n = None, 0
            try:
                if self.flags["tts"]:  # forced L3 for this session only; shared singleton untouched
                    raise RuntimeError("tts forced down")
                async for chunk in tts.speak(text):
                    if t0 is None:
                        t0 = loop.time()
                        if entry is not None:
                            entry.t["tts_first_chunk_at"] = now()
                    n += len(chunk)
                    await self.op.send_bytes(b"\x01" + chunk)
            except Exception:
                if n == 0:  # L3: phrase cache only
                    key = _phrase_key(text)
                    audio = tts.cached(key) if key else None
                    if audio:
                        self.post("tts_degraded")
                        t0, n = loop.time(), len(audio)
                        if entry is not None:
                            entry.t["tts_first_chunk_at"] = now()
                        await self.op.send_bytes(b"\x01" + audio)
                    else:
                        ok = False
                        self.post("tts_degraded")
            await self.op.send_bytes(b"\x02")
            if t0 is not None:
                await asyncio.sleep(max(0.0, t0 + n / PCM24K_BPS - loop.time()))
        except Exception:
            log.exception("orchestrator: playback failed")
            ok = False
        finally:
            self._bg(self._unmute_later(gen))
        if done:
            self.post(done, ok=ok)

    async def _unmute_later(self, gen: int) -> None:
        await asyncio.sleep(config.HALF_DUPLEX_TAIL_S)
        if gen == self._play_gen and (self._play_task is None or self._play_task.done()):
            self._set_mute(False)

    # ---------- STT / audio ----------
    def _start_stt(self, codec: str) -> None:
        if self.stt is not None:
            return
        self.codec = codec
        self.stt = dep("relay.stt").DeepgramStream(codec, on_final=self._stt_final,
                                                     on_partial=self._stt_partial, on_error=self._stt_error)

        async def start():
            try:
                await self.stt.start()
            except Exception:
                self.post("stt_failed")
        self._bg(start())

    async def _stt_final(self, utt) -> None:
        self.post("utterance_final", text=utt.text, confidence=utt.confidence,
                  speech_end_at=utt.speech_end_at, final_at=utt.final_at)

    async def _stt_partial(self, p) -> None:
        loop_t = asyncio.get_running_loop().time()
        if self.state in ACTIVE and loop_t - self._last_partial >= 0.25:  # max 4/s
            self._last_partial = loop_t
            await self.user.send("transcript_partial", {"text": getattr(p, "text", p)})

    async def _stt_error(self, *_a) -> None:
        self.post("stt_failed")

    async def on_audio(self, frame: bytes) -> None:
        if self.flags["stt"] or self.stt_failed:  # L2: level meter instead of words
            if self.muted:
                return
            active = frame_rms(frame, self.codec) > RMS_THRESHOLD
            if active != self.op_speaking:
                self.op_speaking = active
                await self.user.send("operator_speaking", {"active": active})
        elif self.stt is not None:
            await self.stt.send_audio(frame)

    # ---------- inbound messages ----------
    async def on_user_msg(self, raw) -> None:
        try:
            m = USER_ADAPTER.validate_python(raw)
        except ValidationError:
            return self._log("invalid_message", self.state, self.state, ignored=True, channel="user")
        d = m.data
        if m.type == "ack":
            self.user.acked = max(self.user.acked, d.seq)
        elif m.type == "resume":
            await self.user.resume(d.last_seq)
        elif m.type == "ping":
            self.user.ping(d.client_ts)
            await self.user.send("pong", {"client_ts": iso(_aware(d.client_ts)), "server_ts": iso(now())})
        else:
            self.post(USER_EVENTS[m.type], **d.model_dump())

    async def on_console_msg(self, raw) -> None:
        try:
            m = CONSOLE_ADAPTER.validate_python(raw)
        except ValidationError:
            return self._log("invalid_message", self.state, self.state, ignored=True, channel="console")
        d = m.data
        match m.type:
            case "answer":
                self.post("operator_answered", codec=d.codec)
            case "reject":
                self.post("ring_timeout", source="console")
            case "operator_text":
                t = now()
                self.post("utterance_final", text=d.text, confidence=None, speech_end_at=t, final_at=t)
            case "dispatch":
                self.post("dispatch_confirmed", source="console")
            case "hangup":
                self.post("operator_hangup")
            case "audio_started":
                self.post("audio_started", client_ts=d.client_ts)
            case "force_degradation":
                self.post("force_degradation", **d.model_dump())

    def user_connected(self, ws: WebSocket) -> None:
        self.user.ws = ws
        if self.link_timer:
            self.link_timer.cancel()
            self.link_timer = None

    def user_disconnected(self) -> None:
        if self.state is S.SELESAI:
            return

        async def lost():
            await asyncio.sleep(config.USER_LINK_LOST_S)
            self.post("user_link_lost")
        self.link_timer = asyncio.create_task(lost())

    # ---------- transitions (TRD §5.4); return False = ignored ----------
    async def _on_sos_confirmed(self):
        if self.state is not S.SIAGA:
            return False
        await self._ring("sos_confirmed")

    async def _ring(self, ev: str) -> None:
        self.attempt += 1
        self.total += 1
        if "first_ring_at" not in self.ts:
            self._set_ts(first_ring_at=now())
        self._db("update_call", self.call_id, attempt_count=self.total)
        same = self.state is S.MEMANGGIL
        await self._go(S.MEMANGGIL, ev, attempt=self.attempt)
        if same:
            await self._send_state()
        await HUB.send("incoming_call", self.incoming(), self.call_id)
        self._timer("ring", config.RING_TIMEOUT_S, "ring_timeout")

    async def _on_ring_timeout(self, source: str | None = None):
        if self.state is not S.MEMANGGIL:
            return False
        if self.attempt < config.MAX_ATTEMPTS:
            await self._ring("ring_timeout")
        else:
            await self._fallback("no_answer", "ring_timeout")

    async def _on_operator_answered(self, codec: str = "pcm16_16k"):
        if self.state not in (S.MEMANGGIL, S.FALLBACK):
            return False
        if "answered_at" not in self.ts:
            self._set_ts(answered_at=now())
        self._start_stt(codec)
        await self._go(S.PEMBUKA, "operator_answered")
        await HUB.send("call_removed", {"call_id": str(self.call_id)}, self.call_id)
        await self._timeline()
        await self._open()

    async def _open(self) -> None:
        await self.user.send("opener", {"text": self.opener_text, "speaking": True})
        await self.op.send("log", {"who": "sistem", "text": self.opener_text, "turn_no": 0,
                                   "latency_a_ms": None, "latency_b_ms": None})
        self._play(self.opener_text, done="opener_done")

    async def _on_opener_done(self, ok: bool = True):
        if self.state is not S.PEMBUKA:
            return False
        if "opener_done_at" not in self.ts:
            t = now()
            self._set_ts(opener_done_at=t)
            if self.location and self.location.accuracy_m <= 50 and "location_confirmed_at" not in self.ts:
                self._set_ts(location_confirmed_at=t)
                await self._timeline()
        await self.user.send("opener", {"speaking": False})
        await self._go(S.MENDENGAR, "opener_done")

    async def _on_utterance_final(self, text: str, confidence=None, speech_end_at=None, final_at=None):
        if self.state not in ACTIVE:
            return False
        text = (text or "").strip()
        dsp = dep("dispatch")
        if text and dsp.is_dispatch(text):
            await self._dispatch("keyword")
        if self.state is S.PEMBUKA or self.state is S.MEMBACAKAN or len(text) < 2:
            return False  # half-duplex / too short
        utt = {"text": text, "confidence": confidence, "speech_end_at": speech_end_at,
               "final_at": final_at or now()}
        await self.op.send("log", {"who": "operator", "text": text, "turn_no": self.turn_no + 1,
                                   "latency_a_ms": None, "latency_b_ms": None})
        if self.state is S.MENDENGAR:
            if dsp.is_repeat_opener(text):
                await self._go(S.PEMBUKA, "utterance_final", reason="repeat_opener")
                return await self._open()
            self._simplify(utt)
            await self._go(S.MENYEDERHANAKAN, "utterance_final")
        elif self.state is S.MENYEDERHANAKAN:
            self.pending.append(utt)
            await self._go(S.MENYEDERHANAKAN, "utterance_final", pending=len(self.pending))
        else:  # MENUNGGU_JAWABAN: simplify in background, cards queue behind the active one
            self._simplify(utt)
            await self._go(S.MENUNGGU_JAWABAN, "utterance_final", background=True)

    def _simplify(self, utt: dict) -> None:
        self.turn_no += 1
        turn = self.turn_no
        self.inflight += 1

        async def run():
            sm = dep("relay.simplifier")
            start = now()
            try:
                r = await asyncio.wait_for(
                    sm.simplify(utt["text"], self.incident, self.history[-6:], force_fail=self.flags["llm"]),
                    config.LLM_TIMEOUT_S + 1.0)
                cards, deg = list(r.cards), r.degradation
                status = "skipped" if r.llm_status == "forced" else r.llm_status  # DB enum has no "forced"
                llm = {"llm_status": status, "llm_input_tokens": r.input_tokens,
                       "llm_output_tokens": r.output_tokens, "llm_cache_read_tokens": r.cache_read_tokens,
                       "llm_start_at": r.llm_start_at, "llm_end_at": r.llm_end_at}
            except Exception as e:  # L1
                cards, deg = [sm.generic_card(utt["text"])], 1
                llm = {"llm_status": "timeout" if isinstance(e, TimeoutError) else "api_error",
                       "llm_start_at": start, "llm_end_at": now()}
            self.post("cards_ready", turn=turn, utt=utt, cards=cards, llm=llm, degradation=deg)
        self._bg(run())

    async def _on_cards_ready(self, turn: int, utt: dict, cards: list, llm: dict, degradation: int = 0):
        self.inflight -= 1
        if self.state not in (S.MENYEDERHANAKAN, S.MENUNGGU_JAWABAN, S.MEMBACAKAN):
            return False
        if degradation:
            await self._degrade(degradation, llm.get("llm_status", "llm_error"))
        if not cards:  # info, no question (App Flow §6.3)
            await self.user.send("info", {"turn_no": turn, "transcript": utt["text"]})
            self._save_turn(Entry(card=None, turn_no=turn, index=0, total=0, utt=utt, llm=llm))
            if self.state is S.MENYEDERHANAKAN:
                return await self._after_turn("cards_ready")
            return await self._go(self.state, "cards_ready", cards=0)
        entries = [Entry(card=c, turn_no=turn, index=i, total=len(cards), utt=utt, llm=llm)
                   for i, c in enumerate(cards)]
        a = self.active
        if a is not None and not a.answered:  # operator repeated the same question (App Flow §6.2)
            dup = [e for e in entries if e.card.question == a.card.question]
            if dup:
                a.card.transcript = utt["text"]
                entries = [e for e in entries if e not in dup]
        for e in entries:
            self.cards.append(e)
            self._save_turn(e)
        if self.state is S.MENYEDERHANAKAN and self.cards:
            await self._show_next("cards_ready")
        elif self.state is S.MENYEDERHANAKAN:
            await self._after_turn("cards_ready")
        else:
            await self._go(self.state, "cards_ready", cards=len(entries), queued=len(self.cards))

    async def _show_next(self, ev: str) -> None:
        e = self.active = self.cards.popleft()
        e.t["card_sent_at"] = now()
        await self._go(S.MENUNGGU_JAWABAN, ev, degradation=e.card.degradation, queued=len(self.cards))
        meta = {"turn_no": e.turn_no, "index": e.index, "total": e.total}
        await self.user.send("card", {**card_for_client(e.card), **meta})
        await self.op.send("card_preview", {**e.card.model_dump(mode="json"), **meta})
        self._save_turn(e)
        self._timer("wait", config.WAIT_TICK_S, "wait_tick")

    async def _after_turn(self, ev: str) -> None:
        if self.cards:
            await self._show_next(ev)
        elif self.pending:
            p, self.pending = self.pending, []
            utt = {**p[-1], "text": " ".join(u["text"] for u in p)}
            self._simplify(utt)
            await self._go(S.MENYEDERHANAKAN, ev, pending=len(p))
        elif self.inflight > 0:  # background simplification still running
            await self._go(S.MENYEDERHANAKAN, ev, inflight=self.inflight)
        else:
            await self._go(S.MENDENGAR, ev)

    async def _on_wait_tick(self):
        if self.state is not S.MENUNGGU_JAWABAN:
            return False
        self._play(PHRASES["P_WAIT"])
        self._timer("wait", config.WAIT_TICK_S, "wait_tick")
        await self._go(S.MENUNGGU_JAWABAN, "wait_tick")

    def _card_ok(self, card_id) -> Entry | None:
        e = self.active
        if self.state is S.MENUNGGU_JAWABAN and e and not e.answered and str(e.card.card_id) == str(card_id):
            return e
        return None

    async def _on_user_tap(self, card_id, option_index: int, client_ts=None):
        return await self._answer("user_tap", ("ucap", "kirim_gps", "ulangi"), card_id, option_index, client_ts)

    async def _on_user_gps(self, card_id, option_index: int, lat: float, lng: float, accuracy_m: float,
                           client_ts=None):
        return await self._answer("user_gps", ("kirim_gps",), card_id, option_index, client_ts,
                                  gps=(lat, lng, accuracy_m))

    async def _on_user_text(self, card_id, option_index: int, text: str, client_ts=None):
        return await self._answer("user_text", ("ketik",), card_id, option_index, client_ts, text=text)

    async def _answer(self, ev, allowed, card_id, idx, client_ts, gps=None, text=None):
        e = self._card_ok(card_id)
        if e is None or idx >= len(e.card.options) or e.card.options[idx].action not in allowed:
            return False
        opt = e.card.options[idx]
        e.answered = True
        e.t["user_tap_at"] = self.user.to_server(client_ts)
        e.t["tap_received_at"] = now()
        e.answer = {"answer_option_index": idx, "answer_label": opt.label, "answer_action": opt.action}
        if opt.action == "ulangi":
            e.repeat = True
            spoken = opt.spoken or PHRASES["P_REPEAT"]
        elif opt.action == "ketik":
            spoken = f"{PHRASES['P_TYPED_PREFIX']} {text}"
        elif opt.action == "kirim_gps":
            spoken = self._gps_text(gps)
        else:
            spoken = opt.spoken
        if e.card.kind == "lokasi" and "location_confirmed_at" not in self.ts:
            self._set_ts(location_confirmed_at=e.t["tap_received_at"])
            await self._timeline()
        await self._speak_answer(ev, e, spoken, idx)

    async def _speak_answer(self, ev, e: Entry, spoken, idx) -> None:
        self.speaking = e
        await self._go(S.MEMBACAKAN, ev, option_index=idx)
        if idx is not None:
            await self.user.send("answer_status", {"card_id": str(e.card.card_id), "option_index": idx,
                                                   "status": "speaking"})
        self._play(spoken, done="tts_done", entry=e)

    async def _gps_text(self, gps) -> str:
        if gps is None and self.location is not None:
            gps = (self.location.lat, self.location.lng, self.location.accuracy_m)
        if gps is None:  # E6
            addr = self.profile.get("address")
            return "Lokasi GPS tidak tersedia." + (f" Alamat saya: {addr}." if addr else "")
        lat, lng, acc = gps
        try:
            addr = await asyncio.wait_for(dep("geocode").reverse_geocode(lat, lng), 2)
        except Exception:
            addr = None
        return dep("opener").gps_utterance(addr, lat, lng, acc)

    async def _on_user_repeat(self, card_id, client_ts=None):
        e = self._card_ok(card_id)
        if e is None:
            return False
        e.answered = e.repeat = True  # active card dropped; operator will ask again
        e.t["tap_received_at"] = now()
        await self._speak_answer("user_repeat", e, PHRASES["P_REPEAT"], None)

    async def _on_tts_done(self, ok: bool = True):
        if self.state is not S.MEMBACAKAN:
            return False
        e, self.speaking = self.speaking, None
        if e is not None and not ok:  # no audio reached the operator: unlock so the same card can be answered again
            log.warning("orchestrator: tts failed, unlocking card turn=%s", e.turn_no)
            if "answer_option_index" in e.answer:
                await self.user.send("answer_status", {"card_id": str(e.card.card_id),
                                                       "option_index": e.answer["answer_option_index"],
                                                       "status": "failed"})
            e.answered = e.repeat = False
            e.answer = {}
            await self._go(S.MENUNGGU_JAWABAN, "tts_done", ok=False)
            self._timer("wait", config.WAIT_TICK_S, "wait_tick")
            return
        if e is not None:
            self.last_spoken = e
            if "answer_option_index" in e.answer:
                await self.user.send("answer_status", {"card_id": str(e.card.card_id),
                                                       "option_index": e.answer["answer_option_index"],
                                                       "status": "spoken"})
            if not e.repeat:  # TRD §6.3.2: short question + button label; free text / GPS masked
                act = e.answer.get("answer_action")
                self.history.append({"operator": e.card.question, "action": act, "jawaban":
                                     "[jawaban teks]" if act == "ketik" else
                                     "[lokasi dikirim]" if act == "kirim_gps" else e.answer.get("answer_label")})
            self._save_turn(e)
        await self._after_turn("tts_done")

    async def _dispatch(self, source: str):
        if "dispatched_at" in self.ts:
            return False
        t = now()
        self._set_ts(dispatched_at=t, dispatch_source=source)
        self._log("dispatch_confirmed", self.state, self.state, source=source)
        data = {"dispatched_at": iso(t), "source": source}
        await self.user.send("dispatch", data)
        await self.op.send("log", {"who": "sistem", "text": "Petugas dikirim", "turn_no": self.turn_no,
                                   "latency_a_ms": None, "latency_b_ms": None})
        self._contact({"type": "dispatch", "data": data})
        self._bg(self._notify("dispatch"))
        await self._timeline()

    async def _on_dispatch_confirmed(self, source: str = "console"):
        if self.state not in ACTIVE:
            return False
        return await self._dispatch(source)

    async def _on_operator_hangup(self):
        if self.state not in ACTIVE:
            return False
        await self._end("operator_hangup", "operator_hangup")

    async def _on_user_cancel(self, confirm: bool = True):
        if self.state is S.MEMANGGIL:
            await self._end("user_cancel", "user_cancel")
        elif self.state in ACTIVE:
            await self._end("user_cancel", "user_cancel", after=self._play(PHRASES["P_CANCEL"]))
        elif self.state is S.FALLBACK:
            exhausted = self.total >= config.MAX_TOTAL_ATTEMPTS
            await self._end("user_cancel", "fallback_exhausted" if exhausted else "user_cancel")
        else:
            return False

    async def _on_user_link_lost(self):
        if self.state not in ACTIVE:
            return False
        self._play(PHRASES["P_USER_LOST"])
        await self._fallback("user_link_lost", "user_link_lost")

    async def _on_retry_requested(self):
        if self.state is not S.FALLBACK or self.total >= config.MAX_TOTAL_ATTEMPTS:
            return False
        self.attempt = 0
        await self._ring("retry_requested")

    async def _fallback(self, reason: str, ev: str) -> None:
        await self._go(S.FALLBACK, ev, reason=reason, attempt=self.total)
        first, self.fallback_notified = not self.fallback_notified, True
        self._bg(self._fallback_notice(reason, first))

    async def _fallback_notice(self, reason: str, notify: bool) -> None:
        if notify:  # first FALLBACK only (App Flow §8)
            try:
                self.contacts_notified = int(await asyncio.wait_for(self._notify("fallback"), 5) or 0)
            except Exception as e:
                log.warning("orchestrator: notify fallback failed: %s", type(e).__name__)
            if self.contacts_notified and "contacts_notified_at" not in self.ts:
                self._set_ts(contacts_notified_at=now())
                await self._timeline()
        data = {"reason": reason, "contacts_notified": self.contacts_notified,
                "can_retry": self.total < config.MAX_TOTAL_ATTEMPTS}
        await self.user.send("fallback", {**data, "sms_text": self._sms_text()})
        self._contact({"type": "fallback", "data": data})

    def _sms_text(self) -> str:
        p, loc = self.profile, self.location
        label = INCIDENTS.get(self.incident, INCIDENTS["umum"])["label"].upper()
        where = f"Lokasi: {self.address or p.get('address') or 'belum diketahui'}."
        if loc is not None:
            where += f" GPS: https://maps.google.com/?q={loc.lat},{loc.lng}"
        return (f"DARURAT {label}. Saya {p.get('display_name') or 'pengguna'}, tuli, tidak bisa menelepon.\n"
                f"{where}\nTolong hubungi 112 untuk saya. (Jembatan 112)")

    async def _end(self, ev: str, reason: str, after: asyncio.Task | None = None) -> None:
        self.end_reason = reason
        t = now()
        await self._go(S.SELESAI, ev, reason=reason)
        data = {"reason": reason, "duration_s": int((t - self.ts["sos_confirmed_at"]).total_seconds())}
        await self.user.send("ended", data)
        await self.op.send("ended", data)
        await HUB.send("call_removed", {"call_id": str(self.call_id)}, self.call_id)
        self._contact({"type": "ended", "data": data})
        self._bg(self._notify("selesai"))
        fields = {"ended_at": t, "end_reason": reason, "attempt_count": self.total,
                  "degradation_max": self.degradation_max}
        if self.location is not None:  # coarsen at rest (Schema §2.5)
            fields |= {"lat": round(self.location.lat, 3), "lng": round(self.location.lng, 3)}
        self._set_ts(**fields)
        if self.link_timer:
            self.link_timer.cancel()
        self._bg(self._teardown(after))

    async def _teardown(self, after: asyncio.Task | None) -> None:
        if after is not None:
            await asyncio.wait({after}, timeout=15)
        if self.stt is not None:
            try:
                await self.stt.close()
            except Exception:
                pass
        for ch in (self.user, self.op):
            if ch.ws is not None:
                try:
                    await ch.ws.close(code=1000)
                except Exception:
                    pass
        await self._dbq.join()
        self._dbw.cancel()
        SESSIONS.pop(self.call_id, None)
        ENDED.add(self.call_id)

    # ---------- side events (no state change) ----------
    def _entry(self, card_id) -> Entry | None:
        for e in (self.active, self.speaking, self.last_spoken):
            if e is not None and e.card is not None and str(e.card.card_id) == str(card_id):
                return e
        return None

    async def _on_card_shown(self, card_id, client_ts=None):
        e = self._entry(card_id)
        if e is None or "card_shown_at" in e.t:
            return False
        e.t["card_shown_at"] = self.user.to_server(client_ts)
        end = e.utt.get("speech_end_at")
        if end:
            ms = int((e.t["card_shown_at"] - _aware(end)).total_seconds() * 1000)
            self._log("card_shown", self.state, self.state, latency_ms=ms)
            await self.op.send("log", {"who": "sistem", "text": e.card.question, "turn_no": e.turn_no,
                                       "latency_a_ms": ms, "latency_b_ms": None})
        self._save_turn(e)

    async def _on_audio_started(self, client_ts=None):
        e = self.speaking or self.last_spoken
        if e is None or "tts_first_audio_at" in e.t:
            return False
        e.t["tts_first_audio_at"] = now()  # console has no ping, so server receive time
        tap = e.t.get("user_tap_at")
        if tap:
            ms = int((e.t["tts_first_audio_at"] - tap).total_seconds() * 1000)
            self._log("audio_started", self.state, self.state, latency_ms=ms)
            await self.op.send("log", {"who": "sistem", "text": e.answer.get("spoken") or "",
                                       "turn_no": e.turn_no, "latency_a_ms": None, "latency_b_ms": ms})
        self._save_turn(e)

    async def _on_force_degradation(self, llm: bool, stt: bool, tts: bool):
        self.flags = {"llm": llm, "stt": stt, "tts": tts}
        self._log("force_degradation", self.state, self.state, llm=llm, stt=stt, tts=tts)
        if stt:
            await self._degrade(2, "forced")

    async def _on_stt_failed(self):
        if self.stt_failed:
            return
        self.stt_failed = True
        await self._degrade(2, "stt_failed")

    async def _on_tts_degraded(self):
        await self._degrade(3, "tts_failed")

    def _save_turn(self, e: Entry) -> None:
        c = e.card
        f = {"call_id": self.call_id, "turn_no": e.turn_no, "card_index": e.index,
             "card_id": c.card_id if c else uuid4(), "operator_transcript": e.utt["text"],
             "stt_confidence": e.utt.get("confidence"), "kind": c.kind if c else "info",
             "card": json.dumps(c.model_dump(mode="json")) if c else None,
             "degradation_level": c.degradation if c else 0,
             "operator_speech_end_at": e.utt.get("speech_end_at"), "utterance_final_at": e.utt.get("final_at"),
             "repeat_requested": e.repeat, **e.llm, **e.t,
             **{k: v for k, v in e.answer.items() if k.startswith("answer_")}}
        if "spoken" in e.answer:
            f["answer_spoken"] = e.answer["spoken"]
        f.setdefault("llm_status", "skipped")
        self._db("upsert_turn", **f)


# ---------- public API ----------
async def _sms_sink(call_id: UUID, msg: dict) -> None:
    s = SESSIONS.get(call_id)
    if s is not None and s.op.ws is not None:
        await s.op.send("sms_simulated", msg)
    else:
        await HUB.send("sms_simulated", msg, call_id)


async def start_call(user_id: UUID, device_id: UUID | None, req: CreateCall, profile: dict | None) -> dict:
    """Creates the session (SIAGA -> MEMANGGIL). Raises ValueError("CONFLICT") on a second active call."""
    if user_id in _starting or any(s.user_id == user_id and s.state is not S.SELESAI for s in SESSIONS.values()):
        raise ValueError("CONFLICT")
    _starting.add(user_id)
    try:
        loc, address = req.location, None
        if loc is not None and loc.accuracy_m <= 100:
            try:
                address = await asyncio.wait_for(dep("geocode").reverse_geocode(loc.lat, loc.lng), 2)
            except Exception:
                address = None
        opener_text = dep("opener").build_opener(profile, req.incident,
                                                 loc.model_dump(mode="json") if loc else None, address)
        call_id, sos = uuid4(), now()
        source = "gps" if loc else ("profil" if (profile or {}).get("address") else "tidak_ada")
        await dep("db").insert_call(
            id=call_id, user_id=user_id, device_id=device_id, mode=req.mode, incident=req.incident,
            state=str(S.SIAGA), lat=loc.lat if loc else None, lng=loc.lng if loc else None,
            gps_accuracy_m=loc.accuracy_m if loc else None, location_source=source,
            sos_confirmed_at=sos)
        s = CallSession(call_id, user_id, req, profile, opener_text, address)
        s.ts["sos_confirmed_at"] = sos
        SESSIONS[call_id] = s
    finally:
        _starting.discard(user_id)
    s.post("sos_confirmed")
    n = dep("notify")
    n.console_sms_sink = _sms_sink
    s._bg(s._notify("panggilan_dibuat"))
    return {"call_id": str(call_id), "state": str(S.MEMANGGIL), "ws_url": user_ws_url(call_id),
            "ws_ticket": auth.issue_ws_ticket(call_id, user_id, "user"), "opener_text": opener_text,
            "practice": req.mode == "latihan"}


def user_ws_url(call_id: UUID) -> str:
    base = config.env("PUBLIC_WS_URL") or config.env("NEXT_PUBLIC_WS_URL") or "ws://localhost:8000"
    return f"{base.rstrip('/')}/ws/calls/{call_id}/user"


def active_call_id(user_id: UUID) -> UUID | None:
    return next((s.call_id for s in SESSIONS.values() if s.user_id == user_id and s.state is not S.SELESAI), None)


async def active_calls() -> list[dict]:
    return [{**s.incoming(), "state": str(s.state), "sos_confirmed_at": iso(s.ts["sos_confirmed_at"])}
            for s in SESSIONS.values() if s.state is not S.SELESAI]


# ---------- WebSocket routes ----------
async def _lookup(ws: WebSocket, call_id: UUID) -> CallSession | None:
    s = SESSIONS.get(call_id)
    if s is None or s.state is S.SELESAI:
        await ws.close(code=4410 if (call_id in ENDED or s is not None) else 4404)
        return None
    return s


@router.websocket("/ws/calls/{call_id}/user")
async def ws_user(ws: WebSocket, call_id: UUID, ticket: str = ""):
    await ws.accept()
    try:
        uid = auth.verify_ws_ticket(ticket, call_id)
    except PermissionError:
        return await ws.close(code=4401)
    # tickets are single use; reconnects fetch a fresh one via POST /v1/calls/{id}/ticket (routes.py)
    s = await _lookup(ws, call_id)
    if s is None:
        return
    if uid != s.user_id:
        return await ws.close(code=4401)
    if s.user.ws is not None:
        return await ws.close(code=4409)
    s.user_connected(ws)
    try:
        while True:
            await s.on_user_msg(await ws.receive_json())
    except Exception:
        pass
    finally:
        if s.user.ws is ws:
            s.user.ws = None
            s.user_disconnected()


@router.websocket("/ws/calls/{call_id}/operator")
async def ws_operator(ws: WebSocket, call_id: UUID, token: str = ""):
    await ws.accept()
    try:
        auth.verify_console_jwt(token)
    except PermissionError:
        return await ws.close(code=4401)
    s = await _lookup(ws, call_id)
    if s is None:
        return
    if s.op.ws is not None:
        return await ws.close(code=4409)
    s.op.ws = ws
    try:
        while True:
            m = await ws.receive()
            if m["type"] == "websocket.disconnect":
                break
            if m.get("bytes"):
                await s.on_audio(m["bytes"])
            elif m.get("text"):
                await s.on_console_msg(json.loads(m["text"]))
    except Exception:
        pass
    finally:
        if s.op.ws is ws:
            s.op.ws = None
            s.post("operator_hangup")


@router.websocket("/ws/console")
async def ws_console(ws: WebSocket, token: str = ""):
    await ws.accept()
    try:
        auth.verify_console_jwt(token)
    except PermissionError:
        return await ws.close(code=4401)
    ch = Channel(None)
    ch.ws = ws
    HUB.chans.append(ch)
    try:
        for s in list(SESSIONS.values()):
            if s.state is S.MEMANGGIL:
                await ch.send("incoming_call", s.incoming(), s.call_id)
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "resume":
                await ch.resume(int(msg.get("data", {}).get("last_seq", 0)))
    except Exception:
        pass
    finally:
        HUB.chans.remove(ch)
