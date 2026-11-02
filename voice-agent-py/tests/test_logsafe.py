"""Default logs carry no customer text; DEBUG_LOG_TRANSCRIPTS=1 brings it back for local debugging."""

import asyncio
import json
from types import SimpleNamespace

from loguru import logger
from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame, LLMTextFrame
from pipecat.processors.frame_processor import FrameDirection

from coverpilot import logsafe, processors
from coverpilot.logsafe import _patch, install_log_patcher, mask_numbers, safe_action, safe_keys, safe_reason, safe_text
from coverpilot.processors import ActionMarkerFilter, ScreenStateInjector
from coverpilot.session import SessionState

SAID = "my name is Priya Sharma, PIN 411038, PAN ABCDE1234F"
SECRETS = ("Priya", "Sharma", "411038", "ABCDE1234F")


def capture():
    install_log_patcher()
    lines: list[str] = []
    handler = logger.add(lambda m: lines.append(m.record["message"]), level="DEBUG", format="{message}")
    return lines, handler


def run_turn_and_action():
    """One customer turn through the injector and one agent reply with a fill action through the marker filter."""
    session = SessionState()
    session.screen_state = {"formValues": {"fullName": "Priya Sharma", "pincode": "411038"}}
    injector = ScreenStateInjector(session, SimpleNamespace(spark_model="muse-spark-1.3"), kb=None)
    ctx = SimpleNamespace(messages=[{"role": "system", "content": "x"}, {"role": "user", "content": SAID}])
    injector._refresh(ctx)

    async def noop(self, frame, direction):
        return None

    original = processors.FrameProcessor.process_frame
    processors.FrameProcessor.process_frame = noop
    try:
        async def main():
            f = ActionMarkerFilter(session)

            async def record(frame, direction=FrameDirection.DOWNSTREAM):
                return None

            f.push_frame = record
            await f.process_frame(LLMFullResponseStartFrame(), FrameDirection.DOWNSTREAM)
            action = {"targetElementId": "field-full-name", "actionTitle": "Fill name", "fieldAction": {"type": "fill", "field": "fullName", "value": "Priya Sharma"}, "fieldActions": [{"type": "fill", "field": "fullName", "value": "Priya Sharma"}]}
            await f.process_frame(LLMTextFrame("Done, Priya Sharma. <<ACTION>> " + json.dumps(action)), FrameDirection.DOWNSTREAM)
            await f.process_frame(LLMFullResponseEndFrame(), FrameDirection.DOWNSTREAM)

        asyncio.run(main())
    finally:
        processors.FrameProcessor.process_frame = original


def test_default_logs_have_no_customer_text(monkeypatch):
    monkeypatch.delenv("DEBUG_LOG_TRANSCRIPTS", raising=False)
    lines, handler = capture()
    try:
        run_turn_and_action()
    finally:
        logger.remove(handler)
    text = "\n".join(lines)
    assert "[turn]" in text and "[action]" in text  # the tags existing greps rely on are still there
    for secret in SECRETS:
        assert secret not in text, f"{secret!r} leaked into the default log:\n{text}"
    assert "fill:fullName" in text  # the action type and field name are still logged


def test_debug_switch_restores_the_text(monkeypatch):
    monkeypatch.setenv("DEBUG_LOG_TRANSCRIPTS", "1")
    lines, handler = capture()
    try:
        run_turn_and_action()
    finally:
        logger.remove(handler)
    text = "\n".join(lines)
    assert "Priya Sharma, PIN 411038, PAN ABCDE1234F" in text  # the turn
    assert '"value": "Priya Sharma"' in text  # the action value


def test_safe_helpers_hide_values_and_keep_metadata(monkeypatch):
    monkeypatch.delenv("DEBUG_LOG_TRANSCRIPTS", raising=False)
    assert "Priya" not in safe_text(SAID) and "chars=" in safe_text(SAID)
    assert safe_text(SAID) == safe_text(SAID)  # the same words give the same short reference
    assert "411038" not in safe_reason("Pincode 411038 entered as you provided") and "reason_chars=" in safe_reason("x")
    assert "Priya" not in safe_keys({"text": "Priya", "lang": "en"}) and "keys=lang,text" == safe_keys({"text": "Priya", "lang": "en"})
    assert safe_action(None) == "none"
    n = safe_action({"fieldActions": [{"type": "nominate", "primaryName": "Priya", "primaryShare": 100}]})
    assert "Priya" not in n and "primaryName" in n


def test_patcher_masks_numbers_and_cuts_pipecat_payload_lines(monkeypatch):
    monkeypatch.delenv("DEBUG_LOG_TRANSCRIPTS", raising=False)
    rec = {"message": "call me on +91 98765 43210, PAN ABCDE1234F, a/c 123456789012", "name": "coverpilot.x", "level": SimpleNamespace(no=20)}
    _patch(rec)
    assert "98765" not in rec["message"] and "ABCDE1234F" not in rec["message"] and "123456789012" not in rec["message"]
    rec = {"message": "OpenAILLMService#1: Generating LLM response [{'content': 'my name is Priya Sharma'}]", "name": "pipecat.services.openai.base_llm", "level": SimpleNamespace(no=10)}
    _patch(rec)
    assert rec["message"] == "OpenAILLMService#1: Generating LLM response […]"
    keep = {"message": "Pipecat started", "name": "pipecat.runner", "level": SimpleNamespace(no=10)}
    _patch(keep)
    assert keep["message"] == "Pipecat started"
    # A warning or error from inside Pipecat that prints a frame is cut the same way as a DEBUG line.
    for level in (30, 40):
        warn = {"message": "GoogleRestTTSService#0 send failed: TTSSpeakFrame(text='my name is Priya Sharma')", "name": "pipecat.services.tts_service", "level": SimpleNamespace(no=level)}
        _patch(warn)
        assert "Priya" not in warn["message"] and warn["message"].endswith("[…]"), warn
    ours = {"message": "[turn] user (voice): 'Priya'", "name": "coverpilot.processors", "level": SimpleNamespace(no=30)}
    _patch(ours)
    assert ours["message"] == "[turn] user (voice): 'Priya'"  # our own lines are already safe and are not cut
    monkeypatch.setenv("DEBUG_LOG_TRANSCRIPTS", "1")
    dbg = {"message": "Generating LLM response [Priya]", "name": "pipecat.services.x", "level": SimpleNamespace(no=10)}
    _patch(dbg)
    assert "Priya" in dbg["message"]


def test_mask_numbers_masks_any_long_digit_run():
    assert "411038" not in mask_numbers("pin 411038") and "7" * 7 not in mask_numbers("ref 7777777")
    assert mask_numbers("page 4 of 5, 30 days") == "page 4 of 5, 30 days"
