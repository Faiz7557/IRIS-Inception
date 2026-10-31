import asyncio
from datetime import timedelta
import json
from urllib.parse import parse_qs, urlsplit

import pytest

from relay import stt


class FakeWebSocket:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.sent = []
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        value = await self.incoming.get()
        if value is None:
            raise StopAsyncIteration
        return json.dumps(value)

    async def send(self, value):
        self.sent.append(value)

    async def close(self):
        self.closed = True
        self.incoming.put_nowait(None)


def result(text, *, final=True, speech_final=False, end=1.25):
    return {
        "type": "Results", "is_final": final, "speech_final": speech_final,
        "channel": {"alternatives": [{
            "transcript": text, "confidence": 0.9,
            "words": [{"word": text, "end": end}] if text else [],
        }]},
    }


async def eventually(predicate):
    async with asyncio.timeout(1):
        while not predicate():
            await asyncio.sleep(0.001)


@pytest.fixture
def setup_stream(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-key")
    monkeypatch.delenv("DEEPGRAM_MODEL", raising=False)
    sockets, connects, finals, partials, errors = [], [], [], [], []

    async def connect(url, **kwargs):
        connects.append((url, kwargs))
        ws = FakeWebSocket()
        sockets.append(ws)
        return ws

    async def on_final(value):
        finals.append(value)

    async def on_partial(value):
        partials.append(value)

    async def on_error(value):
        errors.append(value)

    monkeypatch.setattr(stt.websockets, "connect", connect)

    def make(codec="pcm16_16k", **kwargs):
        return stt.DeepgramStream(codec, on_final, on_partial, on_error, **kwargs)

    return make, sockets, connects, finals, partials, errors


@pytest.mark.parametrize("codec,encoding,rate", [
    ("pcm16_16k", "linear16", "16000"), ("mulaw_8k", "mulaw", "8000"),
])
async def test_connection_parameters(setup_stream, monkeypatch, codec, encoding, rate):
    make, sockets, connects, *_ = setup_stream
    if codec == "mulaw_8k":
        monkeypatch.setenv("DEEPGRAM_MODEL", "custom-model")
    stream = make(codec)
    await stream.start()
    try:
        url, kwargs = connects[0]
        assert url.startswith("wss://api.deepgram.com/v1/listen?")
        assert parse_qs(urlsplit(url).query) == {
            "model": ["custom-model" if codec == "mulaw_8k" else "nova-3"],
            "language": ["id"], "encoding": [encoding], "sample_rate": [rate],
            "channels": ["1"], "interim_results": ["true"], "endpointing": ["400"],
            "utterance_end_ms": ["1000"], "vad_events": ["true"],
            "smart_format": ["true"], "punctuate": ["true"],
        }
        assert kwargs["additional_headers"] == {"Authorization": "Token test-key"}
    finally:
        await stream.close()
    assert json.loads(sockets[0].sent[-1]) == {"type": "CloseStream"}
    assert sockets[0].closed


async def test_speech_final_assembles_once_and_timestamps(setup_stream):
    make, sockets, _, finals, _, errors = setup_stream
    stream = make()
    await stream.start()
    try:
        ws = sockets[0]
        for message in [
            {"type": "SpeechStarted", "timestamp": 0.1},
            result("Ada api", end=0.7),
            result("di dapur.", speech_final=True),
            {"type": "UtteranceEnd", "last_word_end": 1.25},
        ]:
            ws.incoming.put_nowait(message)
        await eventually(lambda: bool(finals))
        assert len(finals) == 1
        assert finals[0].text == "Ada api di dapur."
        assert finals[0].confidence == pytest.approx(0.9)
        assert finals[0].speech_end_at == stream._stream_start + timedelta(seconds=1.25)
        assert finals[0].final_at.tzinfo is not None
        assert not errors
    finally:
        await stream.close()


async def test_utterance_end_fallback_and_empty_speech_final(setup_stream):
    make, sockets, _, finals, *_ = setup_stream
    stream = make()
    await stream.start()
    try:
        for message in [result("Tolong"), {"type": "UtteranceEnd"},
                        result("", speech_final=True), result("Korban sadar", speech_final=True)]:
            sockets[0].incoming.put_nowait(message)
        await eventually(lambda: len(finals) == 2)
        assert [u.text for u in finals] == ["Tolong", "Korban sadar"]
    finally:
        await stream.close()


async def test_short_text_ignored_and_buffer_cleared(setup_stream):
    make, sockets, _, finals, *_ = setup_stream
    stream = make()
    await stream.start()
    try:
        for message in [result(" x ", speech_final=True), result("  ", speech_final=True),
                        {"type": "UtteranceEnd"}, result("Ya", speech_final=True)]:
            sockets[0].incoming.put_nowait(message)
        await eventually(lambda: bool(finals))
        assert [u.text for u in finals] == ["Ya"]
    finally:
        await stream.close()


async def test_partial_throttle(setup_stream, monkeypatch):
    make, sockets, _, finals, partials, _ = setup_stream
    stream = make()
    await stream.start()
    try:
        times = iter([10, 10.1, 10.249, 10.25, 10.49, 10.5])
        monkeypatch.setattr(stt, "monotonic", lambda: next(times))
        for text in ["Satu", "Dua", "Tiga", "Empat", "Lima", "Enam"]:
            sockets[0].incoming.put_nowait(result(text, final=False))
        sockets[0].incoming.put_nowait(result("Selesai", speech_final=True))
        await eventually(lambda: bool(finals))
        assert partials == ["Satu", "Empat", "Enam"]
    finally:
        await stream.close()


async def test_mute_drops_audio_and_sends_keepalive(setup_stream):
    make, sockets, *_ = setup_stream
    stream = make(keepalive_interval=0.005)
    stream.mute(True)
    await stream.start()
    try:
        ws = sockets[0]
        await stream.send_audio(b"muted")
        await eventually(lambda: len(ws.sent) >= 2)
        assert all(json.loads(value) == {"type": "KeepAlive"} for value in ws.sent)
        stream.mute(False)
        await stream.send_audio(b"audible")
        assert ws.sent[-1] == b"audible"
        count = len(ws.sent)
        await asyncio.sleep(0.015)
        assert len(ws.sent) == count
    finally:
        await stream.close()
    assert stream._receiver.done() and stream._keeper.done()


async def test_unexpected_close_reconnects_once(setup_stream):
    make, sockets, connects, finals, _, errors = setup_stream
    stream = make()
    await stream.start()
    try:
        sockets[0].incoming.put_nowait(result("Old buffer"))
        sockets[0].incoming.put_nowait(None)
        await eventually(lambda: len(sockets) == 2)
        sockets[1].incoming.put_nowait(result("New stream", speech_final=True))
        sockets[1].incoming.put_nowait(None)
        await eventually(lambda: bool(errors))
        assert len(connects) == 2
        assert len(errors) == 1
        assert [u.text for u in finals] == ["New stream"]
    finally:
        await stream.close()


async def test_open_failure_retries_once(setup_stream, monkeypatch):
    make, _, _, _, _, errors = setup_stream
    attempts = []

    async def fail(*args, **kwargs):
        attempts.append(1)
        raise OSError("offline")

    monkeypatch.setattr(stt.websockets, "connect", fail)
    stream = make()
    await stream.start()
    assert len(attempts) == 2
    assert len(errors) == 1
    await stream.close()
