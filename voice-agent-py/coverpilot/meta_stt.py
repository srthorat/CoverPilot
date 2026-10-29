"""Meta Muse Voice Transcribe as a Pipecat STT service.

Streams PCM16 to wss://api.meta.ai/v1/asr/realtime in ENDPOINTING mode and
turns Meta's events into Pipecat frames:

  transcript (partial)  -> InterimTranscriptionFrame
  speechComplete        -> TranscriptionFrame

Turn-taking itself is decided by Pipecat (Silero VAD + Smart Turn in the user
aggregator); Meta's endpointing only shapes where the final transcripts land.
Meta needs continuous real-time audio, which the transport provides, and ends a
session at its maximum duration (close 1011), after which we reconnect.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncGenerator

from loguru import logger
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
)
from pipecat.processors.frame_processor import FrameProcessorSetup
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import WebsocketSTTService
from pipecat.utils.time import time_now_iso8601
from websockets.exceptions import ConnectionClosed
from websockets.protocol import State

# Meta ends a session after 60 minutes (close 1008 "Max session duration reached"). Rather than
# let it die mid-sentence, the stream is reopened between utterances shortly before that.
SESSION_LIMIT_S = 60 * 60
ROTATE_AFTER_S = 55 * 60
QUIET_BEFORE_ROTATE_S = 1.5


def should_rotate(session_age_s: float, quiet_s: float) -> bool:
    """Reopen the Meta session when it is close to its limit and nobody is mid-utterance."""
    if session_age_s >= SESSION_LIMIT_S - 15:
        return True  # last chance, even mid-utterance, before Meta cuts the stream
    return session_age_s >= ROTATE_AFTER_S and quiet_s >= QUIET_BEFORE_ROTATE_S


class MetaRealtimeSTTService(WebsocketSTTService):
    def __init__(
        self,
        *,
        api_key: str,
        model: str = "muse-voice-transcribe-1.0",
        url: str = "wss://api.meta.ai/v1/asr/realtime",
        language_bias: list[str] | None = None,
        sample_rate: int | None = None,
        **kwargs,
    ):
        super().__init__(sample_rate=sample_rate, settings=STTSettings(model=model, language=None), **kwargs)
        self._api_key = api_key
        self._model = model
        self._url = url
        self._language_bias = language_bias or ["English", "Hindi"]
        self._websocket = None
        self._receive_task = None
        self._ready = False
        self._pending: list[bytes] = []
        self._disconnecting = False
        self._last_send = 0.0
        self._keepalive_task = None
        self._session_started = 0.0  # monotonic time the current Meta session became ready
        self._sent_seconds = 0.0  # audio seconds sent in the current Meta session
        self._keepalive_logged = False
        self._last_transcript = 0.0  # monotonic time of the last transcript event from Meta

    def can_generate_metrics(self) -> bool:
        return True

    # ------------------------------------------------------------ lifecycle
    async def setup(self, setup: FrameProcessorSetup):
        await super().setup(setup)
        await self._connect()

    async def stop(self, frame: EndFrame):
        await super().stop(frame)
        await self._disconnect()

    async def cancel(self, frame: CancelFrame):
        await super().cancel(frame)
        await self._disconnect()

    async def set_language_bias(self, bias: list[str]):
        """Meta fixes languageBias per session, so a language change reopens the socket."""
        if bias == self._language_bias:
            return
        self._language_bias = bias
        await self._disconnect_websocket()
        await self._connect_websocket()

    # ------------------------------------------------------------ audio in
    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        ws = self._websocket
        if self._ready and ws and ws.state is State.OPEN:
            await ws.send(audio)
            self._last_send = time.monotonic()
            self._sent_seconds += len(audio) / 2 / self.sample_rate
        elif len(self._pending) < 150:  # ~3 s while the handshake completes
            self._pending.append(audio)
        yield None

    # ------------------------------------------------------------ websocket
    async def _connect(self):
        await super()._connect()
        self._disconnecting = False
        await self._connect_websocket()
        if not self._receive_task:
            self._receive_task = self.create_task(self._receive_task_handler(self._report_error))
        if not self._keepalive_task:
            self._keepalive_task = self.create_task(self._keepalive())

    async def _disconnect(self):
        self._disconnecting = True
        await super()._disconnect()
        if self._keepalive_task:
            await self.cancel_task(self._keepalive_task, timeout=1.0)
            self._keepalive_task = None
        if self._receive_task:
            await self.cancel_task(self._receive_task, timeout=1.0)
            self._receive_task = None
        await self._disconnect_websocket()

    async def _keepalive(self):
        """Meta closes the stream (1008 "Ingress below real-time") when the audio it has
        received falls behind wall-clock time, e.g. before the WebRTC track is up or while
        the tab is muted. When no real audio has arrived recently, top the stream up with
        silence so the sent duration stays slightly ahead of elapsed time. Silence is never
        added while real audio is flowing, so speech timing is untouched."""
        tick = 0.1
        while True:
            await asyncio.sleep(tick)
            ws = self._websocket
            if not (self._ready and ws and ws.state is State.OPEN):
                continue
            now = time.monotonic()
            if should_rotate(now - self._session_started, now - self._last_transcript):
                logger.info(f"{self}: reopening the Meta ASR session before its time limit")
                self._pending.clear()
                await self._disconnect_websocket()
                await self._connect_websocket()
                continue
            if now - self._last_send < tick * 1.5:
                continue  # real audio is flowing
            deficit = (now - self._session_started) - self._sent_seconds + 0.3
            if deficit <= 0:
                continue
            n = int(self.sample_rate * min(deficit, 2.0))
            try:
                await ws.send(b"\x00\x00" * n)
                self._sent_seconds += n / self.sample_rate
                self._last_send = now
                if not self._keepalive_logged:
                    self._keepalive_logged = True
                    logger.debug(f"{self}: sending silence to keep the Meta ASR stream at real-time")
            except Exception:
                pass

    async def _connect_websocket(self):
        try:
            if self._websocket and self._websocket.state is State.OPEN:
                return
            self._ready = False
            encoding = "PCM_16KHZ" if self.sample_rate == 16000 else "PCM_24KHZ"
            self._websocket = await self._websocket_connect(self._url)
            await self._websocket.send(
                json.dumps(
                    {
                        "authorization": {"accessToken": f"Bearer {self._api_key}"},
                        "audioEncoding": encoding,
                        "model": self._model,
                        "mode": "ENDPOINTING",
                        "partialMode": "CUMULATIVE",
                        "emitAudioProgress": False,
                        "languageBias": self._language_bias,
                    }
                )
            )
            await self._call_event_handler("on_connected")
        except Exception as e:
            await self.push_error(error_msg=f"Error connecting to Meta ASR: {e}", exception=e)
            self._websocket = None

    async def _disconnect_websocket(self):
        try:
            ws = self._websocket
            if ws and ws.state is State.OPEN:
                try:
                    await ws.send(json.dumps({"type": "endStream"}))
                except Exception:
                    pass
                await ws.close()
        except Exception as e:
            await self.push_error(error_msg=f"Error disconnecting Meta ASR: {e}", exception=e)
        finally:
            self._websocket = None
            self._ready = False
            await self._call_event_handler("on_disconnected")

    def _get_websocket(self):
        if self._websocket:
            return self._websocket
        raise Exception("Websocket not connected")

    async def _receive_messages(self):
        while not self._disconnecting:
            ws = self._websocket
            if not ws:
                await self._connect_websocket()
                ws = self._websocket
                if not ws:
                    raise Exception("Meta ASR websocket unavailable")
            try:
                async for message in ws:
                    if isinstance(message, bytes):
                        continue
                    try:
                        msg = json.loads(message)
                    except json.JSONDecodeError:
                        continue
                    await self._handle_meta_event(msg)
            except ConnectionClosed:
                pass  # a close with an error code is handled below, the same as a clean one
            # Meta closed the session (max duration or policy). Reopen unless we are stopping.
            close_code = getattr(ws, "close_code", None)
            self._websocket = None
            self._ready = False
            if self._disconnecting:
                break
            logger.info(f"Meta ASR session closed ({close_code}); reconnecting")
            await self._connect_websocket()

    async def _handle_meta_event(self, msg: dict):
        if not self._ready and msg.get("sessionId") and not msg.get("type"):
            self._ready = True
            self._session_started = time.monotonic()
            self._sent_seconds = 0.0
            self._keepalive_logged = False
            ws = self._websocket
            if ws:
                for chunk in self._pending:
                    await ws.send(chunk)
                    self._sent_seconds += len(chunk) / 2 / self.sample_rate
            self._pending.clear()
            return
        kind = msg.get("type")
        if kind in ("transcript", "speechComplete"):
            self._last_transcript = time.monotonic()
        if kind == "transcript":
            text = (msg.get("transcript") or "").strip()
            if text:
                await self.push_frame(InterimTranscriptionFrame(text=text, user_id="", timestamp=time_now_iso8601()))
        elif kind == "speechComplete":
            text = (msg.get("transcript") or "").strip()
            if text:
                await self.stop_ttfb_metrics()
                await self.stop_processing_metrics()
                await self.push_frame(TranscriptionFrame(text=text, user_id="", timestamp=time_now_iso8601()))
        elif kind == "error":
            if "max session duration" in str(msg.get("message") or "").lower():
                logger.info("Meta ASR session reached its time limit; reopening")
                return  # the close that follows is handled by the receive loop
            await self.push_error(error_msg=f"Meta ASR: {msg.get('message') or 'unknown error'}")
