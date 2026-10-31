"""Raw Deepgram streaming adaptor; callbacks run on the event loop."""

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import json
from time import monotonic
from typing import Awaitable, Callable, Literal
from urllib.parse import urlencode

import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from config import env


@dataclass
class Utterance:
    text: str
    confidence: float | None
    speech_end_at: datetime
    final_at: datetime


class DeepgramStream:
    def __init__(
        self,
        codec: Literal["pcm16_16k", "mulaw_8k"],
        on_final: Callable[[Utterance], Awaitable[None]],
        on_partial: Callable[[str], Awaitable[None]],
        on_error: Callable[[Exception], Awaitable[None]],
        *,
        keepalive_interval: float = 4.0,
        partial_interval: float = 0.25,
    ):
        if codec not in ("pcm16_16k", "mulaw_8k"):
            raise ValueError("Unsupported audio codec")
        if keepalive_interval <= 0 or partial_interval < 0:
            raise ValueError("Invalid STT intervals")
        self.codec = codec
        self.on_final, self.on_partial, self.on_error = on_final, on_partial, on_error
        self._keepalive_interval = keepalive_interval
        self._partial_interval = partial_interval
        self._ws = None
        self._receiver = None
        self._keeper = None
        self._closed = False
        self._muted = False
        self._reconnected = False
        self._segments: list[str] = []
        self._confidences: list[float] = []
        self._last_word_end: float | None = None
        self._last_partial = float("-inf")
        self._stream_start = datetime.now(UTC)
        # TODO(integrator): microphone-level speech signal is needed for the 10 s no-results watchdog.

    async def _connect(self) -> None:
        key = env("DEEPGRAM_API_KEY")
        if not key:
            raise ValueError("DEEPGRAM_API_KEY is required")
        pcm = self.codec == "pcm16_16k"
        params = {
            "model": env("DEEPGRAM_MODEL", "nova-3"), "language": "id",
            "encoding": "linear16" if pcm else "mulaw",
            "sample_rate": 16000 if pcm else 8000, "channels": 1,
            "interim_results": "true", "endpointing": 400,
            "utterance_end_ms": 1000, "vad_events": "true",
            "smart_format": "true", "punctuate": "true",
        }
        self._ws = await websockets.connect(
            "wss://api.deepgram.com/v1/listen?" + urlencode(params),
            additional_headers={"Authorization": f"Token {key}"},
        )
        self._stream_start = datetime.now(UTC)
        self._clear_buffer()

    async def start(self) -> None:
        if self._closed or self._receiver is not None:
            return
        try:
            await self._connect()
        except (OSError, WebSocketException, TimeoutError) as exc:
            if not await self._recover(exc):
                return
        except ValueError as exc:
            await self.on_error(exc)
            return
        self._receiver = asyncio.create_task(self._receive())
        self._keeper = asyncio.create_task(self._keepalive())

    async def _recover(self, error: Exception) -> bool:
        if self._closed:
            return False
        old_ws, self._ws = self._ws, None
        if old_ws is not None:
            with suppress(OSError, ConnectionClosed):
                await old_ws.close()
        if not self._reconnected:
            self._reconnected = True
            try:
                await self._connect()
                return True
            except Exception as exc:
                error = exc
        self._closed = True
        await self.on_error(error)
        return False

    async def _receive(self) -> None:
        while not self._closed:
            try:
                async for raw in self._ws:
                    await self._parse(json.loads(raw))
                raise ConnectionError("Deepgram stream closed unexpectedly")
            except (OSError, WebSocketException, TimeoutError) as exc:
                if not await self._recover(exc):
                    return
            except (ValueError, KeyError, TypeError) as exc:
                self._closed = True
                await self.on_error(exc)
                return

    async def _parse(self, message: dict) -> None:
        kind = message.get("type")
        if kind == "UtteranceEnd":
            await self._finalize()
        elif kind == "SpeechStarted":
            return
        elif kind == "Results":
            alternative = message["channel"]["alternatives"][0]
            text = alternative.get("transcript", "").strip()
            if message.get("is_final"):
                if text:
                    self._segments.append(text)
                    confidence = alternative.get("confidence")
                    if confidence is not None:
                        self._confidences.append(confidence)
                    words = alternative.get("words", [])
                    if words:
                        self._last_word_end = words[-1]["end"]
            elif text:
                now = monotonic()
                if now - self._last_partial >= self._partial_interval:
                    self._last_partial = now
                    await self.on_partial(" ".join([*self._segments, text]))
            if message.get("speech_final"):
                await self._finalize()

    def _clear_buffer(self) -> None:
        self._segments.clear()
        self._confidences.clear()
        self._last_word_end = None

    async def _finalize(self) -> None:
        text = " ".join(self._segments).strip()
        final_at = datetime.now(UTC)
        end_at = (self._stream_start + timedelta(seconds=self._last_word_end)
                  if self._last_word_end is not None else final_at)
        confidence = (sum(self._confidences) / len(self._confidences)
                      if self._confidences else None)
        self._clear_buffer()
        if len(text) >= 2:
            await self.on_final(Utterance(text, confidence, end_at, final_at))

    async def send_audio(self, frame: bytes) -> None:
        if not self._closed and not self._muted and self._ws is not None:
            try:
                await self._ws.send(frame)
            except (OSError, ConnectionClosed):
                await self._ws.close()  # Receiver owns the single reconnect attempt.

    def mute(self, muted: bool) -> None:
        self._muted = muted

    async def _keepalive(self) -> None:
        while not self._closed:
            await asyncio.sleep(self._keepalive_interval)
            if self._muted and not self._closed and self._ws is not None:
                try:
                    await self._ws.send(json.dumps({"type": "KeepAlive"}))
                except (OSError, ConnectionClosed):
                    await self._ws.close()

    async def close(self) -> None:
        self._closed = True
        current = asyncio.current_task()
        for task in (self._receiver, self._keeper):
            if task is not None and task is not current:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        if self._ws is not None:
            try:
                with suppress(OSError, ConnectionClosed):
                    await self._ws.send(json.dumps({"type": "CloseStream"}))
            finally:
                await self._ws.close()
