"""Speech synthesis: ElevenLabs (if keyed), then Google, then the fixed-phrase cache."""

import base64
import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Literal

import httpx
from google.cloud import texttospeech
from google.oauth2 import service_account

from config import PHRASES, env

log = logging.getLogger(__name__)


class TTSUnavailable(RuntimeError):
    """Neither synthesis nor a cached phrase is available."""


def _mulaw_encode(sample: int) -> int:
    sign = 0x80 if sample < 0 else 0
    magnitude = min(abs(sample), 32635) + 132
    exponent = max(0, magnitude.bit_length() - 8)
    mantissa = (magnitude >> (exponent + 3)) & 0x0F
    return (~(sign | (exponent << 4) | mantissa)) & 0xFF


ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream"


class TTS:
    def __init__(self, *, client=None, http=None):
        self._client = client
        self._http = http
        self._cache: dict[str, bytes] = {}
        self.force_fail = False
        self.last_first_chunk_at: datetime | None = None

    def _get_client(self):
        if self._client is None:
            encoded = env("GOOGLE_APPLICATION_CREDENTIALS_JSON")
            credentials = None
            if encoded:
                info = json.loads(base64.b64decode(encoded, validate=True))
                credentials = service_account.Credentials.from_service_account_info(info)
            self._client = texttospeech.TextToSpeechAsyncClient(credentials=credentials)
        return self._client

    async def startup(self) -> None:
        for key, text in PHRASES.items():
            try:
                audio = b"".join([chunk async for chunk in self.speak(text)])
            except TTSUnavailable:
                continue
            if audio:
                self._cache[key] = self._cache[text] = audio

    def cached(self, phrase_key: str) -> bytes | None:
        return self._cache.get(phrase_key)

    def _google_enabled(self) -> bool:
        # With ElevenLabs keyed, Google is only a fallback when it has explicit credentials.
        return (self._client is not None or bool(env("GOOGLE_APPLICATION_CREDENTIALS_JSON"))
                or not env("ELEVENLABS_API_KEY"))

    async def _elevenlabs(self, text: str) -> AsyncIterator[bytes]:
        """Streams raw PCM16 24 kHz mono, the same format as the Google path."""
        voice = env("ELEVENLABS_VOICE_ID")
        if not voice:
            raise TTSUnavailable("ELEVENLABS_VOICE_ID not set")
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0))
        async with self._http.stream(
            "POST",
            ELEVENLABS_URL.format(voice=voice),
            params={"output_format": "pcm_24000"},
            headers={"xi-api-key": env("ELEVENLABS_API_KEY")},
            json={"text": text, "model_id": env("ELEVENLABS_MODEL", "eleven_flash_v2_5"),
                  "language_code": "id"},
        ) as response:
            response.raise_for_status()
            odd = b""  # keep chunks sample-aligned (2 bytes) for the PCM player
            async for chunk in response.aiter_bytes():
                chunk = odd + chunk
                cut = len(chunk) - len(chunk) % 2
                odd = chunk[cut:]
                if cut:
                    yield chunk[:cut]

    async def _pcm(self, text: str) -> AsyncIterator[bytes]:
        if not self.force_fail and env("ELEVENLABS_API_KEY"):
            received = False
            try:
                async for chunk in self._elevenlabs(text):
                    received = True
                    yield chunk
            except Exception as e:
                log.warning("tts: elevenlabs failed: %s: %s", type(e).__name__, e)
                if received:  # mid-stream failure: don't replay the start in another voice
                    raise TTSUnavailable("ElevenLabs stream interrupted") from None
            if received:
                return

        if not self.force_fail and self._google_enabled():
            received = False
            try:
                async def requests():
                    yield texttospeech.StreamingSynthesizeRequest(
                        streaming_config=texttospeech.StreamingSynthesizeConfig(
                            voice=texttospeech.VoiceSelectionParams(
                                language_code="id-ID",
                                name=env("TTS_VOICE", "id-ID-Chirp3-HD-Kore"),
                            ),
                            streaming_audio_config=texttospeech.StreamingAudioConfig(
                                audio_encoding=texttospeech.AudioEncoding.PCM,
                                sample_rate_hertz=24000,
                            ),
                        )
                    )
                    yield texttospeech.StreamingSynthesizeRequest(
                        input=texttospeech.StreamingSynthesisInput(text=text)
                    )

                responses = await self._get_client().streaming_synthesize(requests=requests())
                async for response in responses:
                    if response.audio_content:
                        received = True
                        yield response.audio_content
                if received:
                    return
            except Exception as e:
                log.warning("tts: google streaming failed: %s: %s", type(e).__name__, e)
                if received:  # mid-stream failure: don't replay the start in another voice
                    raise TTSUnavailable("Google TTS stream interrupted") from None
            try:
                response = await self._get_client().synthesize_speech(
                    input=texttospeech.SynthesisInput(text=text),
                    voice=texttospeech.VoiceSelectionParams(
                        language_code="id-ID",
                        name=env("TTS_FALLBACK_VOICE", "id-ID-Wavenet-A"),
                    ),
                    audio_config=texttospeech.AudioConfig(
                        audio_encoding=texttospeech.AudioEncoding.LINEAR16,
                        sample_rate_hertz=24000,
                    ),
                )
                audio = response.audio_content[44:]
                if audio:
                    for offset in range(0, len(audio), 4800):
                        yield audio[offset:offset + 4800]
                    return
            except Exception:
                pass

        if text in PHRASES.values():
            audio = self._cache.get(text)
            if audio:
                yield audio
                return
        raise TTSUnavailable("Sintesis suara dan cache frasa tidak tersedia.")

    async def speak(
        self, text: str, fmt: Literal["pcm24k", "mulaw8k"] = "pcm24k"
    ) -> AsyncIterator[bytes]:
        self.last_first_chunk_at = None
        if fmt not in ("pcm24k", "mulaw8k"):
            raise ValueError("Unsupported audio format")
        pending = b""
        async for chunk in self._pcm(text):
            if self.last_first_chunk_at is None:
                self.last_first_chunk_at = datetime.now(timezone.utc)
            if fmt == "pcm24k":
                yield chunk
                continue
            pending += chunk
            end = len(pending) - len(pending) % 6
            output = bytearray()
            for offset in range(0, end, 6):
                samples = [int.from_bytes(pending[i:i + 2], "little", signed=True)
                           for i in range(offset, offset + 6, 2)]
                output.append(_mulaw_encode(sum(samples) // 3))
            pending = pending[end:]
            if output:
                yield bytes(output)
        # shortcut: discard the final incomplete 3-sample group; use a resampler for higher fidelity.


tts = TTS()
