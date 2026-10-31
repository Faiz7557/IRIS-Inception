import asyncio
import base64
import importlib
import json
import struct
from types import SimpleNamespace

import httpx
import pytest
from google.cloud import texttospeech

from config import PHRASES
from relay.tts import TTS, TTSUnavailable, _mulaw_encode


class FakeClient:
    def __init__(self, chunks=(b"\0\0" * 6,), primary_error=False, fallback_error=False):
        self.chunks = chunks
        self.primary_error = primary_error
        self.fallback_error = fallback_error
        self.requests = []
        self.fallback_calls = []
        self.fallback_pcm = b"\x01\x02" * 5000

    async def streaming_synthesize(self, *, requests):
        self.requests.extend([request async for request in requests])
        if self.primary_error:
            raise RuntimeError("primary unavailable")

        async def responses():
            for chunk in self.chunks:
                yield SimpleNamespace(audio_content=chunk)

        return responses()

    async def synthesize_speech(self, **kwargs):
        self.fallback_calls.append(kwargs)
        if self.fallback_error:
            raise RuntimeError("fallback unavailable")
        return SimpleNamespace(audio_content=b"H" * 44 + self.fallback_pcm)


@pytest.fixture(autouse=True)
def _no_elevenlabs(monkeypatch):
    """Keep Google-path tests hermetic even if ElevenLabs is set in the shell."""
    for name in ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL"):
        monkeypatch.delenv(name, raising=False)


async def collect(tts, text="Halo.", fmt="pcm24k"):
    return [chunk async for chunk in tts.speak(text, fmt)]


def test_primary(monkeypatch):
    monkeypatch.setenv("TTS_VOICE", "id-ID-Chirp3-HD-Kore")
    client = FakeClient(chunks=(b"", b"\x01\x02", b"\x03\x04"))
    tts = TTS(client=client)
    assert asyncio.run(collect(tts)) == [b"\x01\x02", b"\x03\x04"]
    config, text = client.requests
    assert config.streaming_config.voice.name == "id-ID-Chirp3-HD-Kore"
    assert config.streaming_config.voice.language_code == "id-ID"
    audio = config.streaming_config.streaming_audio_config
    assert audio.audio_encoding == texttospeech.AudioEncoding.PCM
    assert audio.sample_rate_hertz == 24000
    assert not config.input.text
    assert text.input.text == "Halo."
    assert not text.streaming_config.voice.name
    assert not client.fallback_calls
    assert tts.last_first_chunk_at is not None
    assert tts.last_first_chunk_at.tzinfo is not None


def test_fallback(monkeypatch):
    monkeypatch.setenv("TTS_FALLBACK_VOICE", "id-ID-Wavenet-A")
    client = FakeClient(primary_error=True)
    chunks = asyncio.run(collect(TTS(client=client)))
    assert [len(chunk) for chunk in chunks] == [4800, 4800, 400]
    assert b"".join(chunks) == client.fallback_pcm
    request = client.fallback_calls[0]
    assert request["input"].text == "Halo."
    assert request["voice"].name == "id-ID-Wavenet-A"
    assert request["voice"].language_code == "id-ID"
    assert request["audio_config"].sample_rate_hertz == 24000
    assert request["audio_config"].audio_encoding == texttospeech.AudioEncoding.LINEAR16


def test_startup_cache_and_last_resort():
    client = FakeClient()
    tts = TTS(client=client)
    asyncio.run(tts.startup())
    for key, text in PHRASES.items():
        assert tts.cached(key) == b"".join(client.chunks)
        assert tts._cache[text] == tts.cached(key)
    client.primary_error = client.fallback_error = True
    assert asyncio.run(collect(tts, PHRASES["P_YES"])) == [tts.cached("P_YES")]
    tts.force_fail = True
    client.requests.clear()
    client.fallback_calls.clear()
    assert asyncio.run(collect(tts, PHRASES["P_NO"])) == [tts.cached("P_NO")]
    assert not client.requests and not client.fallback_calls
    assert tts.last_first_chunk_at is not None
    assert tts.cached("missing") is None


@pytest.mark.parametrize("force_fail", [False, True])
def test_unavailable(force_fail):
    client = FakeClient(primary_error=True, fallback_error=True)
    tts = TTS(client=client)
    tts.force_fail = force_fail
    for text in ("No cached arbitrary text", PHRASES["P_YES"]):
        with pytest.raises(TTSUnavailable):
            asyncio.run(collect(tts, text))
        assert tts.last_first_chunk_at is None


def test_startup_tolerates_failures():
    client = FakeClient(primary_error=True, fallback_error=True)
    tts = TTS(client=client)
    asyncio.run(tts.startup())
    assert not tts._cache
    assert len(client.fallback_calls) == len(PHRASES)


@pytest.mark.parametrize("sample, expected", [(0, 0xFF), (32767, 0x80), (-32768, 0x00)])
def test_mulaw_encoder(sample, expected):
    assert _mulaw_encode(sample) == expected


def test_mulaw_conversion_preserves_chunk_boundaries():
    pcm = struct.pack("<9h", 0, 0, 0, 32767, 32767, 32767, -32768, -32768, -32768)
    client = FakeClient(chunks=(pcm[:1], pcm[1:7], pcm[7:13], pcm[13:]))
    assert b"".join(asyncio.run(collect(TTS(client=client), fmt="mulaw8k"))) == b"\xff\x80\x00"


def test_mulaw_averages_before_decimation():
    pcm = struct.pack("<6h", 3000, 0, -3000, 3000, 0, 0)
    client = FakeClient(chunks=(pcm,))
    assert b"".join(asyncio.run(collect(TTS(client=client), fmt="mulaw8k"))) == bytes(
        [0xFF, _mulaw_encode(1000)]
    )


def test_empty_primary_uses_fallback():
    client = FakeClient(chunks=())
    assert b"".join(asyncio.run(collect(TTS(client=client)))) == client.fallback_pcm


def test_invalid_format():
    client = FakeClient()
    with pytest.raises(ValueError):
        asyncio.run(collect(TTS(client=client), fmt="mp3"))
    assert not client.requests


@pytest.mark.parametrize("encoded", [False, True])
def test_credentials(monkeypatch, encoded):
    module = importlib.import_module("relay.tts")
    info = {"type": "service_account", "project_id": "offline-test"}
    credentials = object()
    client = FakeClient()
    seen = {}

    def credentials_from_info(value):
        assert value == info
        return credentials

    def make_client(**kwargs):
        seen.update(kwargs)
        return client

    monkeypatch.setattr(module.service_account.Credentials, "from_service_account_info", credentials_from_info)
    monkeypatch.setattr(module.texttospeech, "TextToSpeechAsyncClient", make_client)
    if encoded:
        monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", base64.b64encode(json.dumps(info).encode()).decode())
    else:
        monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", raising=False)
    tts = TTS()
    assert asyncio.run(collect(tts)) == list(client.chunks)
    assert seen == {"credentials": credentials if encoded else None}


def eleven_http(chunks=(b"\x01\x02",), status=200, seen=None):
    async def stream():
        for chunk in chunks:
            yield chunk

    def handler(request):
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, content=stream())

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture
def eleven_env(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice123")
    monkeypatch.delenv("ELEVENLABS_MODEL", raising=False)


def test_elevenlabs_primary(eleven_env):
    seen = []
    client = FakeClient()
    tts = TTS(client=client, http=eleven_http(chunks=(b"\x01", b"\x02\x03", b"\x04"), seen=seen))
    assert b"".join(asyncio.run(collect(tts))) == b"\x01\x02\x03\x04"
    request = seen[0]
    assert request.url.path == "/v1/text-to-speech/voice123/stream"
    assert request.url.params["output_format"] == "pcm_24000"
    assert request.headers["xi-api-key"] == "test-key"
    body = json.loads(request.content)
    assert body == {"text": "Halo.", "model_id": "eleven_flash_v2_5", "language_code": "id"}
    assert not client.requests and not client.fallback_calls


def test_elevenlabs_chunks_stay_sample_aligned(eleven_env):
    tts = TTS(client=FakeClient(), http=eleven_http(chunks=(b"\x01", b"\x02\x03", b"\x04\x05\x06")))
    assert all(len(c) % 2 == 0 for c in asyncio.run(collect(tts)))


def test_elevenlabs_error_falls_back_to_google(eleven_env):
    client = FakeClient()
    tts = TTS(client=client, http=eleven_http(status=401))
    assert asyncio.run(collect(tts)) == list(client.chunks)


def test_elevenlabs_skips_google_without_credentials(eleven_env, monkeypatch):
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", raising=False)
    tts = TTS(http=eleven_http(status=500))
    with pytest.raises(TTSUnavailable):
        asyncio.run(collect(tts, "No cached arbitrary text"))
    assert tts._client is None  # Google never constructed


def test_elevenlabs_force_fail_uses_cache_only(eleven_env):
    seen = []
    tts = TTS(client=FakeClient(), http=eleven_http(seen=seen))
    tts._cache[PHRASES["P_YES"]] = b"cached"
    tts.force_fail = True
    assert asyncio.run(collect(tts, PHRASES["P_YES"])) == [b"cached"]
    assert not seen


def test_google_midstream_failure_does_not_replay_fallback():
    class MidstreamErrorClient:
        def __init__(self):
            self.fallback_called = False

        async def streaming_synthesize(self, *, requests):
            async def responses():
                yield SimpleNamespace(audio_content=b"\x01\x02")
                raise RuntimeError("network dropped mid-stream")

            return responses()

        async def synthesize_speech(self, **kwargs):
            self.fallback_called = True
            return SimpleNamespace(audio_content=b"H" * 44 + b"\x09\x09" * 100)

    client = MidstreamErrorClient()
    tts = TTS(client=client)
    with pytest.raises(TTSUnavailable):
        asyncio.run(collect(tts, "Teks arbitrary panjang."))
    assert not client.fallback_called
