"""A Hindi or Marathi answer that starts in the wrong language is dropped quietly and asked for once more."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame, LLMTextFrame  # noqa: E402
from pipecat.processors.frame_processor import FrameDirection  # noqa: E402
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame  # noqa: E402

from coverpilot import processors  # noqa: E402
from coverpilot.processors import ActionMarkerFilter, ScreenStateInjector  # noqa: E402
from coverpilot.session import SessionState  # noqa: E402

ENGLISH = "The grace period is thirty days and your policy stays in force. Pay within it."
HINDI = "आपका ग्रेस पीरियड तीस दिन का है और पॉलिसी चालू रहती है। इस दौरान प्रीमियम भर दीजिए।"


def _run(monkeypatch, session, drafts):
    """Feed each draft (list of text chunks) through a fresh response; return the frames pushed and retry calls."""

    async def noop(self, frame, direction):
        return None

    monkeypatch.setattr(processors.FrameProcessor, "process_frame", noop)
    pushed: list = []
    retries: list = []

    async def on_retry():
        retries.append(1)

    async def main():
        f = ActionMarkerFilter(session, on_language_retry=on_retry)

        async def record(frame, direction=FrameDirection.DOWNSTREAM):
            pushed.append(frame)

        f.push_frame = record
        for chunks in drafts:
            await f.process_frame(LLMFullResponseStartFrame(), FrameDirection.DOWNSTREAM)
            for c in chunks:
                await f.process_frame(LLMTextFrame(c), FrameDirection.DOWNSTREAM)
            await f.process_frame(LLMFullResponseEndFrame(), FrameDirection.DOWNSTREAM)

    asyncio.run(main())
    return pushed, retries


def _types(pushed):
    return [f.data.get("type") for f in pushed if isinstance(f, RTVIServerMessageFrame)]


def test_wrong_language_draft_is_dropped_and_asked_again_once(monkeypatch):
    session = SessionState(lang="hi")
    session.reply_lang = "hi"
    pushed, retries = _run(monkeypatch, session, [[ENGLISH[:30], ENGLISH[30:]]])
    assert retries == [1]
    assert session.language_retry is True and session.retries_done == 1
    # Nothing of the English draft was spoken or shown, and no agent_done was sent for it.
    assert not any(isinstance(f, LLMTextFrame) for f in pushed)
    assert _types(pushed) == ["agent_start"]


def test_the_re_ask_continues_the_same_message_and_a_good_answer_flows(monkeypatch):
    session = SessionState(lang="hi")
    session.reply_lang = "hi"
    pushed, retries = _run(monkeypatch, session, [[ENGLISH], [HINDI[:25], HINDI[25:]]])
    assert retries == [1]
    types = _types(pushed)
    assert types.count("agent_start") == 1  # the second response does not open a second message
    assert "agent_done" in types
    spoken = "".join(f.text for f in pushed if isinstance(f, LLMTextFrame))
    assert spoken == HINDI


def test_a_second_wrong_draft_is_used_not_retried_forever(monkeypatch):
    session = SessionState(lang="hi")
    session.reply_lang = "hi"
    pushed, retries = _run(monkeypatch, session, [[ENGLISH], [ENGLISH]])
    assert retries == [1]
    spoken = "".join(f.text for f in pushed if isinstance(f, LLMTextFrame))
    assert spoken == ENGLISH


def test_no_check_when_no_indian_language_is_required(monkeypatch):
    session = SessionState(lang="en")
    session.reply_lang = None
    pushed, retries = _run(monkeypatch, session, [[ENGLISH]])
    assert retries == []
    assert "".join(f.text for f in pushed if isinstance(f, LLMTextFrame)) == ENGLISH


def test_a_correct_first_sentence_is_released_at_its_end(monkeypatch):
    session = SessionState(lang="hi")
    session.reply_lang = "hi"
    pushed, retries = _run(monkeypatch, session, [["आपका ग्रेस पीरियड तीस दिन का है।", " और बाकी बात"]])
    assert retries == []
    assert "".join(f.text for f in pushed if isinstance(f, LLMTextFrame)).startswith("आपका ग्रेस पीरियड")


def test_injector_adds_the_language_line_and_a_retry_starts_from_plain_text():
    session = SessionState(lang="hi")
    injector = ScreenStateInjector(session, SimpleNamespace(spark_model="muse-spark-1.3"), kb=None)
    user = {"role": "user", "content": "ग्रेस पीरियड कितना होता है?"}
    context = SimpleNamespace(messages=[user])
    injector._refresh(context)
    assert session.reply_lang == "hi"
    assert user["content"].endswith("Keep the same length limit.]")
    assert "[Reply language for this answer: Hindi" in user["content"]
    # A re-ask: the same customer turn again, decorated once, with the stronger line.
    session.language_retry = True
    injector._refresh(context)
    assert session.retry_turn is True
    assert user["content"].count("[Reply language for this answer:") == 1
    assert "Your previous draft was not in Hindi" in user["content"]
    assert session.user_turns == ["ग्रेस पीरियड कितना होता है?"]  # the re-ask is not a second customer turn
    # The next real customer turn is not a retry.
    context.messages.append({"role": "assistant", "content": "ठीक है"})
    context.messages.append({"role": "user", "content": "फ्री लुक क्या है?"})
    injector._refresh(context)
    assert session.retry_turn is False and session.retries_done == 0
    assert "Your previous draft" not in context.messages[-1]["content"]
