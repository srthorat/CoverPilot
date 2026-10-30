"""After a barge-in, text that was already queued must not reach the voice or the assistant context."""

import asyncio

from pipecat.frames.frames import InterruptionFrame, LLMFullResponseStartFrame, LLMTextFrame, TTSSpeakFrame
from pipecat.processors.frame_processor import FrameDirection

from coverpilot import processors
from coverpilot.processors import ActionMarkerFilter
from coverpilot.session import SessionState


def test_stale_text_after_an_interruption_is_dropped(monkeypatch):
    async def noop(self, frame, direction):
        return None

    monkeypatch.setattr(processors.FrameProcessor, "process_frame", noop)

    async def main():
        f = ActionMarkerFilter(SessionState())
        pushed = []

        async def record(frame, direction=FrameDirection.DOWNSTREAM):
            pushed.append(frame)

        f.push_frame = record
        await f.process_frame(LLMFullResponseStartFrame(), FrameDirection.DOWNSTREAM)
        await f.process_frame(InterruptionFrame(), FrameDirection.DOWNSTREAM)
        pushed.clear()
        await f.process_frame(LLMTextFrame('<<ACTION>> {"fieldAction":{"type":"navigate","step":5}}'), FrameDirection.DOWNSTREAM)
        await f.process_frame(LLMTextFrame("Sure, moving on."), FrameDirection.DOWNSTREAM)
        assert pushed == [], [type(x).__name__ for x in pushed]
        assert not any(isinstance(x, (LLMTextFrame, TTSSpeakFrame)) for x in pushed)

    asyncio.run(main())
