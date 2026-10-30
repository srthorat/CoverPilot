"""CoverPilot voice agent (Pipecat).

Pipeline:
  transport.input -> RTVI -> Meta Muse Voice Transcribe (STT)
    -> user aggregator (Silero VAD + Smart Turn v3 end-of-turn)
    -> ScreenStateInjector -> Muse Spark (OpenAI-compatible, streamed)
    -> ActionMarkerFilter -> WonderVerifier -> Google TTS -> transport.output
    -> assistant aggregator

Run locally (serves the WebRTC offer endpoint and a prebuilt test UI on :7860):
  uv run bot.py -t webrtc
"""

from __future__ import annotations

import asyncio
import json
import os
import re

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import InterruptionWorkerFrame, LLMMessagesAppendFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi.observer import RTVIObserver, RTVIObserverParams
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame
from pipecat.processors.frameworks.rtvi.processor import RTVIProcessor
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams

from coverpilot import cases
from coverpilot.capacity import CapMiddleware, SessionCap, max_sessions_from_env
from coverpilot.diag import install_diag_signal, schedule_release, start_memory_trim
from coverpilot.config import Settings
from coverpilot.google_tts import GoogleRestTTSService
from coverpilot.mms_tts import MetaMmsTTSService
from coverpilot.knowledge import Chunk, KnowledgeBase
from coverpilot.logsafe import debug_transcripts, install_log_patcher, safe_keys
from coverpilot.memory import MemoryStore, MemoryWriter, customer_ref, valid_customer_id
from coverpilot.meta_stt import MetaRealtimeSTTService
from coverpilot.processors import AckProcessor, ActionMarkerFilter, ScreenStateInjector, WonderVerifier
from coverpilot.prompt import build_system_prompt
from coverpilot.session import ACCENTS, AGENT_NAMES, LANGS, LANGUAGE_BIAS, PERSONAS, SessionState, render_prior_turns, voice_for

AUDIO_IN_RATE = 16000  # Silero + Smart Turn need 16 kHz
AUDIO_OUT_RATE = 24000

install_log_patcher()  # mask numbers and cut Pipecat's payload-printing debug lines (see coverpilot/logsafe.py)
KNOWLEDGE = KnowledgeBase(exclude_prefix=("guardian-",))  # the co-browsing agent's: every shared file and its own cobrowse-* files, loaded once per process
# Integrity Guardian's own knowledge base: the rules and terms needed to read a policy document, without
# the files about using the application (faq, process-and-payment).
KNOWLEDGE_GUARDIAN = KnowledgeBase(
    include={
        "policy-terms",
        "claims-and-grievance",
        "nomination-and-trust",
        "benefit-ladders-tax-underwriting",
        "disclosure-consequences",
        "choosing-cover-and-riders",
    },
    include_prefix=("guardian-",),  # plus the guardian-* files written only for the reviewer
)
MEMORY = MemoryStore()

WELCOME = {
    "en": "Welcome! Your secure live session is connected. I can see your proposal form. Start with your full legal name, or ask me anything.",
    "hi": "नमस्ते! सुरक्षित लाइव सत्र जुड़ गया है। मैं आपका फॉर्म देख रहा हूँ। कृपया अपना पूरा नाम बताएं, या कोई भी प्रश्न पूछें।",
    "mr": "नमस्कार! सुरक्षित लाइव्ह सत्र सुरू झाले आहे. मी तुमचा अर्ज पाहत आहे. कृपया तुमचे पूर्ण नाव सांगा किंवा कोणताही प्रश्न विचारा.",
}


def build_processors(settings: Settings, session: SessionState, *, sample_rate_in: int = AUDIO_IN_RATE, sample_rate_out: int = AUDIO_OUT_RATE, tts_provider: str = "google"):
    """Create the services and processors shared by the runner bot and the offline harness."""
    stt = MetaRealtimeSTTService(
        api_key=settings.meta_api_key,
        model=settings.transcribe_model,
        url=settings.meta_asr_url,
        language_bias=LANGUAGE_BIAS[session.lang],
        sample_rate=sample_rate_in,
    )
    llm = OpenAILLMService(
        api_key=settings.meta_api_key,
        base_url=settings.meta_base_url,
        settings=OpenAILLMService.Settings(
            model=settings.spark_model,
            temperature=0.2,
            extra={"reasoning_effort": settings.reasoning_effort},
        ),
    )
    lang_code, voice = voice_for(session.active_persona(), session.lang, session.accent)
    if tts_provider == "meta-mms":  # experimental, chosen by the customer in the app; Google is the default
        tts = MetaMmsTTSService(language_code=lang_code, sample_rate=sample_rate_out)
    else:
        tts = GoogleRestTTSService(api_key=settings.google_tts_api_key, voice=voice, language_code=lang_code, sample_rate=sample_rate_out)

    context = LLMContext([{"role": "system", "content": build_system_prompt(session.lang, session.accent, settings.spark_model)}])
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            # Silero VAD on 16 kHz input; end-of-turn is decided by Pipecat's default
            # Smart Turn v3 strategy (UserTurnStrategies default), not by a fixed silence.
            # start_secs 0.4: an interruption needs ~400 ms of confident speech, so short
            # echo blips of the bot's own voice from the speakers do not barge in.
            vad_analyzer=SileroVADAnalyzer(params=VADParams(confidence=0.8, start_secs=0.4, stop_secs=0.2, min_volume=0.6)),
            # If Smart Turn keeps judging the turn incomplete, hand it over after this much silence.
            user_turn_stop_timeout=2.0,
            # A turn with no transcript (echo, cough, click) is dropped instead of asking Spark to
            # answer nothing, which produced "Sorry, I missed that" loops.
            empty_user_turn=None,
        ),
    )
    verifier = WonderVerifier(session, settings)
    memory_writer = MemoryWriter(MEMORY, api_key=settings.meta_api_key, base_url=settings.meta_base_url, model=settings.spark_model)
    session.memory_writer = memory_writer

    async def on_turn_complete(spoken: str):
        async def on_saved(added, facts, summary):
            session.memory_text = MemoryStore.render(MEMORY.load(session.customer_id)) if session.customer_id else ""
            await actions.push_frame(RTVIServerMessageFrame(data={"type": "memory_updated", "added": added, "facts": facts, "summary": summary}))

        memory_writer.schedule(session.customer_id, session.last_user_text, spoken, on_saved)

    case_tasks: set[asyncio.Task] = set()

    async def open_case(reason: str, spoken: str):
        question, screen, kb_chunks, lang = session.last_user_text, dict(session.screen_state or {}), list(session.last_kb_chunks), session.lang
        summary, summary_error = await cases.summarize(question, spoken, api_key=settings.meta_api_key, base_url=settings.meta_base_url, model=settings.spark_model)
        case = cases.build_case(
            reason=reason, language=lang, question=question, reply=spoken, screen=screen,
            kb_chunks=kb_chunks, summary=summary, summary_error=summary_error,
        )
        cases.store_case(case)
        await actions.push_frame(RTVIServerMessageFrame(data={"type": "case_created", "case": case}))

    async def on_escalate(reason: str, spoken: str):
        task = asyncio.create_task(open_case(reason, spoken))
        case_tasks.add(task)
        task.add_done_callback(case_tasks.discard)

    actions = ActionMarkerFilter(session, on_action=verifier.verify, on_turn_complete=on_turn_complete, on_escalate=on_escalate)
    injector = ScreenStateInjector(session, settings, kb=KNOWLEDGE, guardian_kb=KNOWLEDGE_GUARDIAN)
    ack = AckProcessor(session, settings, downstream=actions)
    return stt, llm, tts, context, aggregators, injector, ack, actions, verifier


def load_policy_document(session: SessionState, raw: str) -> dict:
    """Index an uploaded policy (JSON {name, pages: [{page, text}]}) for this session only."""
    try:
        doc = json.loads(raw)
        pages = [p for p in doc.get("pages", []) if isinstance(p, dict) and isinstance(p.get("text"), str)][:150]
        name = str(doc.get("name") or "policy.pdf")[:80]
    except Exception:
        return {"ok": False, "error": "could not read the document"}
    chunks: list[Chunk] = []
    for p in pages:
        page = int(p.get("page") or 0)
        text = re.sub(r"[ \t]+", " ", p["text"]).strip()
        # About 900 characters per passage, cut at sentence ends, so a retrieved passage stays short.
        buf = ""
        for sentence in re.split(r"(?<=[.;:])\s+", text):
            if buf and len(buf) + len(sentence) > 900:
                chunks.append(Chunk(source=f"Your policy ({name})", heading=f"page {page}", text=buf.strip()))
                buf = ""
            buf += sentence + " "
        if buf.strip():
            chunks.append(Chunk(source=f"Your policy ({name})", heading=f"page {page}", text=buf.strip()))
    if not chunks:
        return {"ok": False, "error": "the document had no readable text"}
    session.policy_doc = KnowledgeBase.from_chunks(chunks)
    session.policy_name = name
    logger.info(f"[policy] loaded a document: {len(pages)} pages, {len(chunks)} passages (kept in memory only)")
    return {"ok": True, "name": name, "pages": len(pages), "passages": len(chunks)}


def load_customer_memory(session: SessionState, customer_id: str | None) -> dict:
    """Load a returning customer's memory. The id is the only proof of ownership, so it must be an
    unguessable secret (a UUID or 32 or more hex characters); anything else loads nothing and is refused."""
    if customer_id and not valid_customer_id(customer_id):
        logger.warning(f"[memory] refused a customer id that is not a 128-bit secret (ref {customer_ref(customer_id)})")
        session.customer_id = None
        session.memory_text = ""
        return {"facts": [], "summary": "", "rejected": True}
    session.customer_id = customer_id or None
    memory = MEMORY.load(customer_id) if customer_id else {"facts": [], "summary": ""}
    session.memory_text = MemoryStore.render(memory)
    return memory


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments | None = None, *, lang: str = "en", persona: str = "veena", accent: str = "in", customer_id: str | None = None, auto_welcome: bool = True, tts_provider: str = "google", prior_turns=None):
    settings = Settings.load()
    session = SessionState(lang=lang, persona=persona, accent=accent)
    session.prior_turns_text = render_prior_turns(prior_turns)
    memory = load_customer_memory(session, customer_id)
    stt, llm, tts, context, aggregators, injector, ack, actions, verifier = build_processors(settings, session, tts_provider=tts_provider)
    rtvi = RTVIProcessor()

    pipeline = Pipeline(
        [
            transport.input(),
            rtvi,
            stt,
            aggregators.user(),
            injector,
            ack,
            llm,
            actions,
            verifier,
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
            audio_in_sample_rate=AUDIO_IN_RATE,
            audio_out_sample_rate=AUDIO_OUT_RATE,
        ),
        # A quiet minute during a demo must not end the session or stop the runner.
        idle_timeout_secs=1800,
        cancel_runner_on_idle_timeout=False,
        # Raw LLM text is not sent: ActionMarkerFilter sends the cleaned text (no <<ACTION>> tail)
        # as agent_start/agent_text/agent_done server messages instead.
        observers=[RTVIObserver(rtvi, params=RTVIObserverParams(bot_llm_enabled=False))],
    )

    async def ask_again_in_language():
        # The first draft was in the wrong language: run the same customer turn once more (see ScreenStateInjector).
        await task.queue_frames([LLMMessagesAppendFrame(messages=[], run_llm=True)])

    actions._on_language_retry = ask_again_in_language

    @rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi_proc):
        await rtvi_proc.set_bot_ready(
            about={
                "sttModel": settings.transcribe_model,
                "llmModel": settings.spark_model,
                "reasoningEffort": settings.reasoning_effort,
                "ttsVoice": tts.voice,
                "turnDetection": "pipecat-smart-turn-v3",
                "vad": "silero",
                "knowledgeChunks": len(KNOWLEDGE.chunks),
                "guardianKnowledgeChunks": len(KNOWLEDGE_GUARDIAN.chunks),
                "memoryFacts": len(memory.get("facts", [])),
            }
        )
        if memory.get("facts") or memory.get("summary"):
            await rtvi_proc.send_server_message({"type": "memory", **memory})
        await rtvi_proc.send_server_message({"type": "agent_role", "role": session.role, "name": AGENT_NAMES[session.role]})
        if auto_welcome:  # the web app may sequence its own greeting first and then ask via "speak"
            await task.queue_frames([TTSSpeakFrame(text=WELCOME.get(session.lang, WELCOME["en"]))])

    @rtvi.event_handler("on_client_message")
    async def on_client_message(rtvi_proc, msg):
        kind = msg.type
        data = msg.data if isinstance(msg.data, dict) else {}
        if kind not in ("screen_state", "screenshot_chunk"):
            logger.debug(f"[client] {kind}: {safe_keys(data)}")
        try:
            if kind == "screen_state":
                state = data.get("state")
                if isinstance(state, dict) and len(json.dumps(state)) <= 20000:
                    session.screen_state = state
            elif kind == "screenshot":
                url = data.get("dataUrl")
                if isinstance(url, str) and url.startswith("data:image/") and len(url) < 2_000_000:
                    session.set_screenshot(url)
            elif kind == "screenshot_chunk":
                # The WebRTC data channel caps a message at 64 KB, so the browser sends the JPEG
                # data URL in pieces: {id, index, total, data}.
                sid, idx, total, part = str(data.get("id") or ""), int(data.get("index", -1)), int(data.get("total", 0)), data.get("data")
                if sid and 0 <= idx < total <= 400 and isinstance(part, str) and len(part) <= 65536:
                    entry = session.screenshot_chunks.setdefault(sid, {"total": total, "parts": {}})
                    entry["parts"][idx] = part
                    if len(entry["parts"]) == total:
                        url = "".join(entry["parts"][i] for i in range(total))
                        session.screenshot_chunks.clear()
                        if url.startswith("data:image/") and len(url) < 2_000_000:
                            session.set_screenshot(url)
                    elif len(session.screenshot_chunks) > 3:
                        session.screenshot_chunks.pop(next(iter(session.screenshot_chunks)))
            elif kind == "policy_doc_chunk":
                # The customer's uploaded policy arrives as text already extracted in the browser, with
                # identity-number patterns masked there, in 64 KB pieces: {id, index, total, data}.
                sid, idx, total, part = str(data.get("id") or ""), int(data.get("index", -1)), int(data.get("total", 0)), data.get("data")
                if sid and 0 <= idx < total <= 40 and isinstance(part, str) and len(part) <= 65536:
                    entry = session.policy_chunks.setdefault(sid, {"total": total, "parts": {}})
                    entry["parts"][idx] = part
                    if len(entry["parts"]) == total:
                        raw = "".join(entry["parts"][i] for i in range(total))
                        session.policy_chunks.clear()
                        info = load_policy_document(session, raw)
                        await rtvi_proc.send_server_message({"type": "policy_doc_ready", **info})
                    elif len(session.policy_chunks) > 2:
                        session.policy_chunks.pop(next(iter(session.policy_chunks)))
            elif kind == "policy_doc_clear":
                session.policy_doc, session.policy_name = None, ""
            elif kind == "interrupt":
                await task.queue_frames([InterruptionWorkerFrame()])
            elif kind == "text":
                text = str(data.get("text") or "").strip()
                if text:
                    session.turn_source = "text"
                    await task.queue_frames([LLMMessagesAppendFrame(messages=[{"role": "user", "content": text}], run_llm=True)])
            elif kind == "speak":
                text = str(data.get("text") or "").strip()
                if text:
                    await task.queue_frames([TTSSpeakFrame(text=text[:1200])])
            elif kind == "set_voice":
                if data.get("persona") in PERSONAS:
                    session.persona = data["persona"]
                if data.get("accent") in ACCENTS:
                    session.accent = data["accent"]
                tts.set_voice(*voice_for(session.active_persona(), session.lang, session.accent))
            elif kind == "set_mode":
                # Two different agents share the session: switch the role (prompt, knowledge base, voice).
                mode = data.get("mode")
                if mode in AGENT_NAMES:
                    session.role = mode
                    session.last_kb_chunks = []
                    tts.set_voice(*voice_for(session.active_persona(), session.lang, session.accent))
                    new_system = build_system_prompt(session.lang, session.accent, settings.spark_model, session.role)
                    if context.messages and context.messages[0].get("role") == "system":
                        context.messages[0]["content"] = new_system
                    else:
                        context.messages.insert(0, {"role": "system", "content": new_system})
                    await rtvi_proc.send_server_message({"type": "agent_role", "role": mode, "name": AGENT_NAMES[mode]})
            elif kind == "set_customer":
                mem = load_customer_memory(session, str(data.get("customerId") or "").strip()[:64] or None)
                payload = {"type": "memory", **mem}
                if mem.get("rejected"):
                    payload["error"] = "Memory needs a long random customer id (a UUID); this one was not accepted, so nothing was loaded."
                await rtvi_proc.send_server_message(payload)
            elif kind == "forget_me":
                # Only the session's own validated id can be forgotten; in-flight extraction is cancelled first.
                if session.customer_id:
                    if session.memory_writer is not None:
                        session.memory_writer.forget(session.customer_id)
                    else:
                        MEMORY.forget(session.customer_id)
                    session.memory_text = ""
                await rtvi_proc.send_server_message({"type": "memory", "facts": [], "summary": ""})
            elif kind == "set_language":
                if data.get("lang") in LANGS:
                    session.lang = data["lang"]
                    tts.set_voice(*voice_for(session.active_persona(), session.lang, session.accent))
                    await stt.set_language_bias(LANGUAGE_BIAS[session.lang])
                    # Refresh the system prompt immediately so Spark replies in the new language
                    # on this very turn rather than the next one.
                    new_system = build_system_prompt(session.lang, session.accent, settings.spark_model, session.role)
                    if context.messages and context.messages[0].get("role") == "system":
                        context.messages[0]["content"] = new_system
                    else:
                        context.messages.insert(0, {"role": "system", "content": new_system})
            await rtvi_proc.send_server_response(msg, {"ok": True})
        except Exception as e:  # keep the session alive on bad client messages
            if debug_transcripts():
                logger.exception("client message failed")
            else:  # a full traceback prints local variables, which can hold what the customer said
                logger.error(f"client message failed: {type(e).__name__}")
            await rtvi_proc.send_error_response(msg, str(e))

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint if runner_args else False)
    await runner.run(task)


SESSION_CAP = SessionCap(max_sessions_from_env())  # new offers past MAX_SESSIONS get a 503 (coverpilot/capacity.py)


async def bot(runner_args: RunnerArguments):
    """Entry point for Pipecat's development runner (`uv run bot.py -t webrtc`)."""
    SESSION_CAP.started()
    install_diag_signal()  # kill -USR2 <pid> dumps pending tasks and thread stacks to the log (no data), see coverpilot/diag.py
    try:
        await _bot(runner_args)
    finally:
        SESSION_CAP.finished()
        schedule_release()  # collect the finished session's cyclic garbage and trim, so memory does not climb with sessions served


async def _bot(runner_args: RunnerArguments):
    transport_params = {
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=AUDIO_IN_RATE,
            audio_out_sample_rate=AUDIO_OUT_RATE,
        ),
    }
    transport = await create_transport(runner_args, transport_params)
    body = getattr(runner_args, "body", None) or {}
    logger.info(f"[session] body {safe_keys({k: v for k, v in body.items() if k != 'customerId'})} customer ref: {customer_ref(body.get('customerId')) if body.get('customerId') else None}")
    await run_bot(
        transport,
        runner_args,
        lang=body.get("lang", os.getenv("COVERPILOT_LANG", "en")),
        persona=body.get("persona", "veena"),
        accent=body.get("accent", "in"),
        customer_id=body.get("customerId"),
        auto_welcome=body.get("autoWelcome", True) is not False,
        prior_turns=body.get("priorTurns"),
        # Google only unless the experimental MMS engine is switched on in the server environment (ENABLE_MMS_TTS=1).
        tts_provider="meta-mms" if body.get("ttsProvider") == "meta-mms" and os.getenv("ENABLE_MMS_TTS") == "1" else "google",
    )


def _default_ice_servers() -> str:
    """ICE servers for the bot's own peer connection, from the shared env
    (TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL, same values /api/ice-servers
    gives the browser). Without them the bot only offers host candidates."""
    servers: list[dict] = [{"urls": "stun:stun.l.google.com:19302"}]
    key_id, token = os.getenv("CLOUDFLARE_TURN_KEY_ID"), os.getenv("CLOUDFLARE_TURN_API_TOKEN")
    if key_id and token:
        try:
            import urllib.request

            req = urllib.request.Request(
                f"https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers",
                data=json.dumps({"ttl": 86400}).encode(),
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "coverpilot-agent/1.0"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=8) as res:
                minted = json.load(res).get("iceServers") or []
            if minted:
                # Credentials last 24 h and are minted once at start-up: restart the container daily on a long run.
                return json.dumps(servers + minted)
        except Exception as e:  # noqa: BLE001 - fall back to STUN and any static TURN_* values
            logger.warning(f"[ice] Cloudflare TURN credentials failed ({type(e).__name__} {getattr(e, 'code', '')}); using STUN and any static TURN values")
    urls = [u.strip() for u in (os.getenv("TURN_URLS") or "").split(",") if u.strip()]
    if urls:
        entry: dict = {"urls": urls[0] if len(urls) == 1 else urls}
        if os.getenv("TURN_USERNAME"):
            entry["username"] = os.getenv("TURN_USERNAME")
        if os.getenv("TURN_CREDENTIAL"):
            entry["credential"] = os.getenv("TURN_CREDENTIAL")
        servers.append(entry)
    return json.dumps(servers)


def _patch_offer_request_model() -> None:
    """Pipecat 1.14's /api/offer body model is a plain dataclass, so FastAPI drops the
    camelCase ``requestData`` key that @pipecat-ai/small-webrtc-transport sends before
    the runner's snake_case shim can rename it, and the bot sees an empty body. Swap in
    a pydantic model that accepts both spellings; the handler only reads attributes."""
    from typing import Any as _Any

    from pydantic import BaseModel, ConfigDict, Field

    import pipecat.transports.smallwebrtc.request_handler as rh

    class SmallWebRTCRequest(BaseModel):
        model_config = ConfigDict(populate_by_name=True, extra="ignore")
        sdp: str
        type: str
        pc_id: str | None = None
        restart_pc: bool | None = None
        request_data: _Any | None = Field(default=None, alias="requestData")

        @classmethod
        def from_dict(cls, data: dict):
            return cls.model_validate(data)

    rh.SmallWebRTCRequest = SmallWebRTCRequest


if __name__ == "__main__":
    _patch_offer_request_model()
    from pipecat.runner.run import app as _runner_app, main

    _runner_app.add_middleware(CapMiddleware, cap=SESSION_CAP)

    @_runner_app.get("/api/capacity")
    async def capacity():
        """Lets the web app say "busy" before it opens a connection (the voice library hides the 503's status)."""
        from fastapi.responses import JSONResponse

        return JSONResponse(SESSION_CAP.status(), headers={"Cache-Control": "no-store"})

    start_memory_trim()
    logger.info(f"[capacity] at most {SESSION_CAP.limit} concurrent voice sessions (MAX_SESSIONS)")

    # coverpilot.config has already loaded .env and ../omni_browse/.env.local.
    os.environ.setdefault("PIPECAT_ICE_SERVERS", _default_ice_servers())
    main()
