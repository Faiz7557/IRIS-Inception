"""Google speech synthesis with a fixed-phrase offline fallback."""

import base64
import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Literal

from google.cloud import texttospeech
from google.oauth2 import service_account

from config import PHRASES, env


class TTSUnavailable(RuntimeError):
    """Neither synthesis nor a cached phrase is available."""


def _mulaw_encode(sample: int) -> int:
    sign = 0x80 if sample < 0 else 0
    magnitude = min(abs(sample), 32635) + 132
    exponent = max(0, magnitude.bit_length() - 8)
    mantissa = (magnitude >> (exponent + 3)) & 0x0F
    return (~(sign | (exponent << 4) | mantissa)) & 0xFF


class TTS:
    def __init__(self, *, client=None):
        self._client = client
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

    async def _pcm(self, text: str) -> AsyncIterator[bytes]:
        if not self.force_fail:
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
                received = False
                async for response in responses:
                    if response.audio_content:
                        received = True
                        yield response.audio_content
                if received:
                    return
            except Exception:
                pass  # Any provider/credential failure advances to the next source.

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
