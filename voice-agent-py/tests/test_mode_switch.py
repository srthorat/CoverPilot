"""set_mode: the Guardian answers with Muse Spark Open only, the switch is refused without it, and no ack is spoken in the Guardian's turns."""

import asyncio
import os
from types import SimpleNamespace

import pytest
from pipecat.pipeline.llm_switcher import LLMSwitcher
from pipecat.pipeline.service_switcher import ManuallySwitchServiceFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.openai.llm import OpenAILLMService

from coverpilot import processors
from coverpilot.modes import GUARDIAN_NEEDS_OPEN, plan_mode_switch
from coverpilot.processors import AckProcessor
from coverpilot.session import LANGS, SessionState, normalise_lang

SPARK, OPEN = "muse-spark-1.3", "meta-models/muse-spark-open-1026"


def make_llms(with_open: bool = True):
    spark = OpenAILLMService(api_key="test", base_url="https://example.invalid/v1", settings=OpenAILLMService.Settings(model=SPARK))
    open_ = OpenAILLMService(api_key="test", base_url="https://example.invalid/v1", settings=OpenAILLMService.Settings(model=OPEN)) if with_open else None
    switcher = LLMSwitcher(llms=[spark] + ([open_] if open_ else []))
    switcher.spark_service, switcher.open_service = spark, open_
    return switcher


def test_guardian_without_spark_open_is_refused_and_the_session_is_untouched():
    llm = make_llms(with_open=False)
    session = SessionState()
    session.llm_model = SPARK
    with pytest.raises(RuntimeError) as e:
        plan_mode_switch("guardian", spark_service=llm.spark_service, open_service=llm.open_service, spark_model=SPARK, guardian_model=OPEN)
    assert str(e.value) == GUARDIAN_NEEDS_OPEN and "GUARDIAN_OPEN_BASE_URL" in str(e.value)
    assert session.role == "cobrowse" and session.llm_model == SPARK  # bot.py changes the session only after the plan succeeds
    # The co-browse agent still works on the same session.
    assert plan_mode_switch("cobrowse", spark_service=llm.spark_service, open_service=None, spark_model=SPARK, guardian_model=OPEN) == (SPARK, llm.spark_service)


def test_guardian_switches_to_spark_open_and_cobrowse_switches_back():
    llm = make_llms()
    assert llm.active_llm is llm.spark_service

    async def main():
        for mode, model, service in (("guardian", OPEN, llm.open_service), ("cobrowse", SPARK, llm.spark_service), ("guardian", OPEN, llm.open_service)):
            planned_model, planned = plan_mode_switch(mode, spark_service=llm.spark_service, open_service=llm.open_service, spark_model=SPARK, guardian_model=OPEN)
            assert (planned_model, planned) == (model, service)
            # The frame bot.py queues is accepted by the real switcher and makes that service the active one.
            switched = await llm.strategy.handle_frame(ManuallySwitchServiceFrame(service=planned), FrameDirection.DOWNSTREAM)
            assert switched is service and llm.active_llm is service

    asyncio.run(main())


def test_the_switcher_only_accepts_its_own_services():
    llm = make_llms()
    stranger = OpenAILLMService(api_key="test", base_url="https://example.invalid/v1", settings=OpenAILLMService.Settings(model="other"))

    async def main():
        assert await llm.strategy.handle_frame(ManuallySwitchServiceFrame(service=stranger), FrameDirection.DOWNSTREAM) is None
        assert llm.active_llm is llm.spark_service

    asyncio.run(main())


def _run_ack(session: SessionState) -> int:
    """Push one context frame through the AckProcessor and count the ack calls it started (the call itself is replaced)."""
    started = []

    async def noop(self, frame, direction):
        return None

    async def fake_ack(self, text):
        started.append(text)

    original, original_ack = processors.FrameProcessor.process_frame, AckProcessor._ack
    processors.FrameProcessor.process_frame, AckProcessor._ack = noop, fake_ack
    try:
        async def main():
            ack = AckProcessor(session, SimpleNamespace(spark_model=SPARK, meta_base_url="", meta_api_key=""))

            async def record(frame, direction=FrameDirection.DOWNSTREAM):
                return None

            ack.push_frame = record
            await ack.process_frame(LLMContextFrame(LLMContext([])), FrameDirection.DOWNSTREAM)
            await asyncio.sleep(0)
            ack._cancel()

        asyncio.run(main())
    finally:
        processors.FrameProcessor.process_frame, AckProcessor._ack = original, original_ack
    return len(started)


def test_no_ack_in_the_guardians_turns_or_on_a_language_reask():
    session = SessionState()
    session.last_user_text = "what does clause four say"
    assert _run_ack(session) == 1  # the co-browse agent acknowledges
    session.role = "guardian"
    assert _run_ack(session) == 0  # the Guardian speaks with Muse Spark Open only
    session.role = "cobrowse"
    session.retry_turn = True
    assert _run_ack(session) == 0  # the same turn run again in the right language is not acknowledged twice
    session.retry_turn = False
    session.last_user_text = "   "
    assert _run_ack(session) == 0


def test_offer_language_falls_back_to_english():
    assert normalise_lang("hi") == "hi" and normalise_lang("mr", "en") == "mr"
    assert normalise_lang(None, "hi") == "hi"
    assert normalise_lang("fr") == "en" and normalise_lang(["hi"], "xx") == "en" and normalise_lang(None, None) == "en"
    assert set(LANGS) == {"en", "hi", "mr"}


def test_bot_turns_loguru_diagnose_off_before_importing_it(monkeypatch):
    import bot

    assert os.environ.get("LOGURU_DIAGNOSE") == "False"


def test_guardian_provider_spark_runs_the_guardian_on_spark_without_spark_open():
    # The same explicit switch the web review uses: no Modal endpoint, both agents on Muse Spark.
    spark = object()
    assert plan_mode_switch("guardian", spark_service=spark, open_service=None, spark_model=SPARK, guardian_model=OPEN, provider="spark") == (SPARK, spark)
    assert plan_mode_switch("cobrowse", spark_service=spark, open_service=None, spark_model=SPARK, guardian_model=OPEN, provider="spark") == (SPARK, spark)
    # With the default provider the same call is still refused.
    with pytest.raises(RuntimeError, match="Muse Spark Open"):
        plan_mode_switch("guardian", spark_service=spark, open_service=None, spark_model=SPARK, guardian_model=OPEN)
