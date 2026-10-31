"""Offline stand-ins for paid providers, used when J112_FAKE_PROVIDERS=1 (dev + smoke test only).

STT ignores audio (drive turns with the console's `operator_text`), the simplifier returns one canned
ya/tidak card, TTS streams 0.1 s of silence, reverse geocoding returns None. No network calls.
"""
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import auth
from config import PHRASES

if not auth.dev_mode():  # second lock behind main.check_dev_flags: never fake providers in prod
    raise RuntimeError("fakes.py imported but J112_ENV is not dev/test")
from protocol import Card, Option
from relay.simplifier import SimplifyResult, generic_card

SILENCE = b"\x00\x00" * 2400  # 0.1 s of PCM16 24 kHz


class FakeStream:
    def __init__(self, codec, on_final, on_partial, on_error):
        self.codec = codec

    async def start(self) -> None: ...
    async def send_audio(self, frame: bytes) -> None: ...
    def mute(self, muted: bool) -> None: ...
    async def close(self) -> None: ...


class FakeTTS:
    force_fail = False

    async def startup(self) -> None: ...

    async def speak(self, text: str, fmt: str = "pcm24k"):
        yield SILENCE

    def cached(self, phrase_key: str) -> bytes | None:
        return SILENCE


async def simplify(transcript: str, incident: str, history: list[dict], force_fail: bool = False) -> SimplifyResult:
    t = datetime.now(UTC)
    if force_fail:
        return SimplifyResult([generic_card(transcript)], "forced", 1, None, None, None, t, t)
    card = Card(card_id=uuid4(), kind="ya_tidak", question="Korban sadar?", transcript=transcript,
                options=[Option(label="Ya", action="ucap", spoken="Ya, korban sadar."),
                         Option(label="Tidak", action="ucap", spoken="Tidak, korban tidak sadar."),
                         Option(label="Tidak tahu", action="ucap", spoken=PHRASES["P_DONTKNOW"])])
    return SimplifyResult([card], "ok", 0, None, None, None, t, t)


async def reverse_geocode(lat: float, lng: float) -> str | None:
    return None


DEPS = {
    "relay.stt": SimpleNamespace(DeepgramStream=FakeStream),
    "relay.simplifier": SimpleNamespace(simplify=simplify, generic_card=generic_card),
    "relay.tts": SimpleNamespace(tts=FakeTTS()),
    "geocode": SimpleNamespace(reverse_geocode=reverse_geocode),
}
if auth.real_tts():  # J112_REAL_TTS=1: hear the real voice while the rest stays offline
    del DEPS["relay.tts"]
