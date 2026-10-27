"""Offline end-to-end check of the Pipecat pipeline without WebRTC.

Feeds a 24 kHz WAV through the real services (Meta STT, Silero VAD + Smart Turn,
Muse Spark, Google TTS) at real-time pace and prints what happens.

  uv run tests/harness_offline.py path/to/utterance.wav [more.wav ...] [--lang hi]
"""

from __future__ import annotations

import argparse
import asyncio
import audioop
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndFrame,
    ErrorFrame,
    Frame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    StartFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    TextFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame

from bot import AUDIO_IN_RATE, AUDIO_OUT_RATE, build_processors, load_customer_memory
from coverpilot.config import Settings
from coverpilot.session import SessionState

T0 = time.time()


def log(msg: str):
    print(f"[{time.time() - T0:6.2f}s] {msg}", flush=True)


def read_wav_16k(path: str) -> bytes:
    with wave.open(path, "rb") as w:
        rate, pcm = w.getframerate(), w.readframes(w.getnframes())
    if rate != AUDIO_IN_RATE:
        pcm, _ = audioop.ratecv(pcm, 2, 1, rate, AUDIO_IN_RATE, None)
    return pcm


class WavSource(FrameProcessor):
    """Plays the WAVs as microphone audio at real-time pace, then silence."""

    def __init__(self, clips: list[bytes], gap_s: float, tail_s: float, **kwargs):
        super().__init__(**kwargs)
        self._clips = clips
        self._gap_s = gap_s
        self._tail_s = tail_s
        self._task = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, StartFrame) and not self._task:
            self._task = self.create_task(self._stream())
        await self.push_frame(frame, direction)

    async def _stream(self):
        frame_bytes = AUDIO_IN_RATE * 2 // 50  # 20 ms
        silence = b"\x00" * frame_bytes

        async def emit(pcm: bytes):
            for i in range(0, len(pcm), frame_bytes):
                chunk = pcm[i : i + frame_bytes]
                if len(chunk) < frame_bytes:
                    chunk += b"\x00" * (frame_bytes - len(chunk))
                await self.push_frame(InputAudioRawFrame(audio=chunk, sample_rate=AUDIO_IN_RATE, num_channels=1))
                await asyncio.sleep(0.02)

        await asyncio.sleep(1.5)  # let Meta's handshake finish
        for n, clip in enumerate(self._clips):
            log(f"🎤 playing clip {n + 1}/{len(self._clips)} ({len(clip) / (AUDIO_IN_RATE * 2):.1f} s)")
            await emit(clip)
            await emit(silence * int(self._gap_s * 50))
        await emit(silence * int(self._tail_s * 50))
        log("source finished; ending pipeline")
        await self.push_frame(EndFrame())


class Tap(FrameProcessor):
    """Pass-through logger placed between stages."""

    def __init__(self, label: str, **kwargs):
        super().__init__(**kwargs)
        self._label = label
        self._first_text_logged = False
        self._last_interim = ""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterimTranscriptionFrame) and frame.text != self._last_interim:
            self._last_interim = frame.text
            log(f"   [{self._label}] … {frame.text!r}")
        elif isinstance(frame, TranscriptionFrame):
            log(f"📝 [{self._label}] FINAL: {frame.text!r}")
        elif isinstance(frame, LLMFullResponseStartFrame):
            self._first_text_logged = False
        elif isinstance(frame, LLMTextFrame) and not self._first_text_logged:
            self._first_text_logged = True
            log(f"🧠 [{self._label}] first token: {frame.text!r}")
        elif isinstance(frame, ErrorFrame):
            log(f"❌ [{self._label}] error: {frame.error}")
        await self.push_frame(frame, direction)


class Sink(FrameProcessor):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.audio_bytes = 0
        self.bot_text = ""
        self.last_interim = ""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterimTranscriptionFrame):
            if frame.text != self.last_interim:
                self.last_interim = frame.text
                log(f"   … {frame.text!r}")
        elif isinstance(frame, TranscriptionFrame):
            log(f"📝 FINAL: {frame.text!r}")
        elif isinstance(frame, UserStartedSpeakingFrame):
            log("👤 user turn started")
        elif isinstance(frame, UserStoppedSpeakingFrame):
            log("👤 user turn ended (VAD + Smart Turn)")
        elif isinstance(frame, LLMFullResponseStartFrame):
            self.bot_text = ""
            log("🧠 Spark response start")
        elif isinstance(frame, LLMTextFrame):
            self.bot_text += frame.text
        elif isinstance(frame, TextFrame) and not isinstance(frame, (TranscriptionFrame, InterimTranscriptionFrame)):
            self.bot_text += frame.text
        elif isinstance(frame, LLMFullResponseEndFrame):
            log(f"🧠 Spark response end: {self.bot_text.strip()!r}")
        elif isinstance(frame, TTSSpeakFrame):
            log(f"🔈 speak: {frame.text!r}")
        elif isinstance(frame, TTSStartedFrame):
            log("🔉 TTS audio started")
        elif isinstance(frame, TTSAudioRawFrame):
            self.audio_bytes += len(frame.audio)
        elif isinstance(frame, TTSStoppedFrame):
            log(f"🔉 TTS audio stopped ({self.audio_bytes / (AUDIO_OUT_RATE * 2):.1f} s so far)")
        elif isinstance(frame, BotStartedSpeakingFrame):
            log("🤖 bot started speaking")
        elif isinstance(frame, BotStoppedSpeakingFrame):
            log("🤖 bot stopped speaking")
        elif isinstance(frame, InterruptionFrame):
            log("✋ interruption")
        elif isinstance(frame, RTVIServerMessageFrame):
            log(f"📨 server message: {frame.data}")
        elif isinstance(frame, ErrorFrame):
            log(f"❌ error: {frame.error}")
        # Terminal sink: only control frames continue.
        if isinstance(frame, (StartFrame, EndFrame, InterruptionFrame)):
            await self.push_frame(frame, direction)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wavs", nargs="+")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--gap", type=float, default=6.0, help="silence between clips (lets the bot answer)")
    ap.add_argument("--tail", type=float, default=14.0)
    ap.add_argument("--log", default="WARNING")
    ap.add_argument("--customer", default=None, help="customer id to exercise memory")
    args = ap.parse_args()
    logger.remove()
    logger.add(sys.stderr, level=args.log, filter=lambda r: args.log != "WARNING" or r["level"].no >= 30)

    settings = Settings.load()
    session = SessionState(lang=args.lang)
    session.screen_state = {"activeStep": 2, "baseSumAssured": "1.5cr", "selectedRiders": {"criticalIllness": False}, "formValues": {"fullName": "Rahul Sharma"}}
    memory = load_customer_memory(session, args.customer)
    if memory.get("facts"):
        log(f"🧠 memory loaded for {args.customer}: {memory['facts']}")
    stt, llm, tts, context, aggregators, injector, ack, actions, verifier = build_processors(settings, session)

    orig_build = llm.build_chat_completion_params

    def _logged_build(params_from_context):
        p = orig_build(params_from_context)
        log(f"🧠 request params: model={p.get('model')} reasoning_effort={p.get('reasoning_effort')} extra_body={p.get('extra_body')} temperature={p.get('temperature')} messages={len(p.get('messages', []))}")
        return p

    llm.build_chat_completion_params = _logged_build

    source = WavSource([read_wav_16k(p) for p in args.wavs], gap_s=args.gap, tail_s=args.tail)
    sink = Sink()
    pipeline = Pipeline([source, stt, Tap('stt'), aggregators.user(), injector, ack, llm, Tap('llm'), actions, verifier, tts, sink, aggregators.assistant()])
    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True, enable_metrics=False, audio_in_sample_rate=AUDIO_IN_RATE, audio_out_sample_rate=AUDIO_OUT_RATE),
    )
    async def watchdog():
        await asyncio.sleep(args.tail + 40)
        log("⏰ watchdog: pipeline still running; live tasks:")
        for t in asyncio.all_tasks():
            if t is not asyncio.current_task():
                log(f"   - {t.get_name()} :: {t.get_coro()}")
        log("⏰ cancelling pipeline task")
        await task.cancel()

    wd = asyncio.create_task(watchdog())
    await PipelineRunner(handle_sigint=False).run(task)
    wd.cancel()
    await asyncio.sleep(0.5)
    log(f"done. bot audio total {sink.audio_bytes / (AUDIO_OUT_RATE * 2):.1f} s; history turns: {len(context.messages) - 1}")


if __name__ == "__main__":
    asyncio.run(main())
