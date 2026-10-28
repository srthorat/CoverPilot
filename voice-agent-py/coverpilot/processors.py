"""Custom frame processors for the CoverPilot pipeline.

ScreenStateInjector  – appends the live form state (and a fresh screenshot) to the
                       prompt right before each Muse Spark run; cacheable prefix first.
ActionMarkerFilter   – strips the <<ACTION>> JSON tail from the streamed answer so it
                       is never spoken, and emits the parsed action to the browser.
WonderVerifier       – asks Muse Wonder to check every applied action, off the spoken
                       path; speaks a short correction when it rejects or amends.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

import aiohttp
from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InterruptionFrame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TTSSpeakFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame

from .asr_corrections import correct as asr_correct
from .config import Settings
from .knowledge import KnowledgeBase
from .prompt import ACTION_MARKER, VERIFIER_SYSTEM_PROMPT, build_system_prompt, parse_action
from .session import SessionState

ACK_SYSTEM_PROMPT = (
    "You are the voice of an insurance advisor co-browsing a term-life proposal form with a customer. "
    "The customer just said something. Reply with ONE short, natural sentence in {language} (maximum 10 words) "
    "that shows you understood the topic and are acting on it right now. Do not answer the question itself and do not invent facts. "
    'Examples: "Sure, pulling up the free-look clause now." "Adding the critical illness rider for you." '
    "If the customer only greeted you, greet them back briefly."
)


class ScreenStateInjector(FrameProcessor):
    def __init__(self, session: SessionState, settings: Settings, kb: KnowledgeBase | None = None, **kwargs):
        super().__init__(**kwargs)
        self._session = session
        self._settings = settings
        self._kb = kb
        self._decorated: dict[int, str] = {}  # id(message) -> original plain content

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMContextFrame):
            self._refresh(frame.context)
            await self.push_frame(frame, direction)
            if self._session.last_user_text:
                source, self._session.turn_source = self._session.turn_source, "voice"
                await self.push_frame(RTVIServerMessageFrame(data={
                    "type": "user_turn",
                    "text": self._session.last_user_text,
                    "source": source,
                    "kbChunks": self._session.last_kb_chunks,
                }))
            return
        await self.push_frame(frame, direction)

    def _refresh(self, context) -> None:
        s = self._session
        messages = context.messages
        # Older turns go back to their plain text (no knowledge snippets, no screenshots in history).
        for m in messages[:-1]:
            orig = self._decorated.pop(id(m), None)
            if orig is not None:
                m["content"] = orig
        # System prompt: static (cacheable) part first, then memory and the live form state.
        static = build_system_prompt(s.lang, s.accent, self._settings.spark_model)
        tail = []
        if s.memory_text:
            tail.append(s.memory_text)
        tail.append(f"LIVE SCREEN STATE (JSON): {json.dumps(s.screen_state or {}, ensure_ascii=False)}")
        system = static + "\n\n" + "\n\n".join(tail)
        if messages and messages[0].get("role") == "system":
            messages[0]["content"] = system
        else:
            messages.insert(0, {"role": "system", "content": system})
        if not messages or messages[-1].get("role") != "user" or not isinstance(messages[-1].get("content"), str):
            return
        last = messages[-1]
        text = asr_correct(last["content"])
        last["content"] = text
        s.last_user_text = text
        s.main_started = False
        s.turn_started_at = time.time()
        logger.info(f"[turn] user ({s.turn_source}): {text!r}")
        self._decorated[id(last)] = text
        # Knowledge retrieved for this turn only.
        hits = self._kb.search(text, k=4) if self._kb else []
        kb_ctx = self._kb.hits_to_context(hits) if hits else ""
        s.last_kb_chunks = [
            {"label": chunk.label, "score": round(score, 2), "terms": self._kb.matched_terms(text, chunk)}
            for score, chunk in hits
        ]
        decorated = f"{text}\n\n[Relevant knowledge]\n{kb_ctx}" if kb_ctx else text
        shot = s.fresh_screenshot()
        if shot:
            last["content"] = [
                {"type": "text", "text": f"{decorated}\n\n(A screenshot of the customer's current screen is attached.)"},
                {"type": "image_url", "image_url": {"url": shot}},
            ]
        else:
            last["content"] = decorated


ActionCallback = Callable[[dict[str, Any]], Awaitable[None]]


TurnCallback = Callable[[str], Awaitable[None]]


class ActionMarkerFilter(FrameProcessor):
    def __init__(self, session: SessionState, on_action: ActionCallback | None = None, on_turn_complete: TurnCallback | None = None, **kwargs):
        super().__init__(**kwargs)
        self._session = session
        self._on_action = on_action
        self._on_turn_complete = on_turn_complete
        self._pending = ""
        self._action_raw = ""
        self._marker_seen = False
        self._in_response = False
        self._spoken = ""
        self._first_text_at = 0.0
        self._bot_speaking = False

    def _reset(self):
        self._pending = ""
        self._action_raw = ""
        self._marker_seen = False
        self._spoken = ""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMFullResponseStartFrame):
            self._reset()
            self._in_response = True
            self._first_text_at = 0.0
            await self.push_frame(frame, direction)
            await self.push_frame(RTVIServerMessageFrame(data={"type": "agent_start"}))
        elif isinstance(frame, InterruptionFrame):
            # Only a real barge-in counts: Spark still streaming, or the bot still talking.
            interrupted = self._in_response or self._bot_speaking
            self._reset()
            self._in_response = False
            await self.push_frame(frame, direction)
            if interrupted:
                await self.push_frame(RTVIServerMessageFrame(data={"type": "interrupt"}))
        elif isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
            await self.push_frame(frame, direction)
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
            await self.push_frame(frame, direction)
        elif isinstance(frame, LLMTextFrame) and self._in_response:
            if self._marker_seen:
                self._action_raw += frame.text
                return
            self._pending += frame.text
            await self._drain(final=False)
        elif isinstance(frame, LLMFullResponseEndFrame):
            await self._drain(final=True)
            action = parse_action(self._action_raw) if self._marker_seen else None
            self._in_response = False
            spoken = self._spoken.strip()
            await self.push_frame(frame, direction)
            now = time.time()
            t0 = self._session.turn_started_at or now
            await self.push_frame(
                RTVIServerMessageFrame(
                    data={
                        "type": "agent_done",
                        "text": spoken,
                        "telemetry": {
                            "ttftMs": int((self._first_text_at - t0) * 1000) if self._first_text_at else None,
                            "totalMs": int((now - t0) * 1000),
                        },
                    }
                )
            )
            if action:
                logger.info(f"[action] {json.dumps(action, ensure_ascii=False)[:400]}")
                await self.push_frame(RTVIServerMessageFrame(data={"type": "action", **action}))
                if self._on_action and (action.get("fieldActions") or action.get("fieldAction")):
                    await self._on_action(action)
            if self._on_turn_complete and spoken:
                await self._on_turn_complete(spoken)
        else:
            await self.push_frame(frame, direction)

    async def _drain(self, final: bool):
        if self._marker_seen:
            return
        idx = self._pending.find(ACTION_MARKER)
        if idx >= 0:
            self._marker_seen = True
            text, self._action_raw, self._pending = self._pending[:idx], self._pending[idx + len(ACTION_MARKER) :], ""
            if text:
                await self._emit_text(text)
            return
        keep = 0 if final else min(len(self._pending), len(ACTION_MARKER) - 1)
        text = self._pending[: len(self._pending) - keep]
        self._pending = self._pending[len(self._pending) - keep :]
        if text:
            await self._emit_text(text)

    async def _emit_text(self, text: str):
        if not self._first_text_at:
            self._first_text_at = time.time()
        self._session.main_started = True
        self._spoken += text
        await self.push_frame(LLMTextFrame(text=text))
        await self.push_frame(RTVIServerMessageFrame(data={"type": "agent_text", "delta": text}))


class WonderVerifier(FrameProcessor):
    def __init__(self, session: SessionState, settings: Settings, **kwargs):
        super().__init__(**kwargs)
        self._session = session
        self._settings = settings
        self._counter = 0
        self._tasks: set[asyncio.Task] = set()

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)

    async def verify(self, action: dict[str, Any]) -> None:
        task = asyncio.create_task(self._verify(action, self._session.last_user_text))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _verify(self, action: dict[str, Any], user_text: str) -> None:
        self._counter += 1
        vid = f"v{self._counter}"
        model = self._settings.wonder_model
        t0 = time.time()
        title = action.get("actionTitle") or "form action"
        actions = action.get("fieldActions") or [action.get("fieldAction")]
        await self.push_frame(RTVIServerMessageFrame(data={"type": "action_verification", "id": vid, "status": "pending", "model": model, "actionTitle": title}))
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as http:
                async with http.post(
                    f"{self._settings.meta_base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self._settings.meta_api_key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "temperature": 0,
                        "reasoning_effort": "low",
                        "messages": [
                            {"role": "system", "content": VERIFIER_SYSTEM_PROMPT},
                            {
                                "role": "user",
                                "content": f"CUSTOMER REQUEST: {user_text}\nLIVE SCREEN STATE: {json.dumps(self._session.screen_state or {}, ensure_ascii=False)}\nAPPLIED ACTIONS: {json.dumps(actions, ensure_ascii=False)}",
                            },
                        ],
                    },
                ) as res:
                    if res.status != 200:
                        logger.error(f"[wonder] HTTP {res.status}: {(await res.text())[:300]}")
                        raise RuntimeError(f"Meta API request failed (HTTP {res.status})")
                    data = await res.json()
            raw = (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
            cleaned = re.sub(r"```(?:json)?", "", raw, flags=re.I).replace("```", "").strip()
            s, e = cleaned.find("{"), cleaned.rfind("}")
            verdict = json.loads(cleaned[s : e + 1]) if s >= 0 and e > s else {"verdict": "approve", "reason": raw[:120]}
            status = verdict.get("verdict") if verdict.get("verdict") in ("approve", "amend", "reject") else "approve"
            reason = str(verdict.get("reason") or "").strip()
            amended = verdict.get("amendedAction")
            if status == "amend":
                # An amendment may only correct an action that was applied (same type and field);
                # anything else would be a new, unrequested change, so it is treated as a reject.
                applied = [a for a in actions if isinstance(a, dict)]
                same = isinstance(amended, dict) and any(
                    a.get("type") == amended.get("type") and a.get("field") == amended.get("field") for a in applied
                )
                if not same:
                    logger.warning(f"[wonder] amendment ignored (does not match an applied action): {amended}")
                    status, amended = "reject", None
                    verdict["amendedAction"] = None
            logger.info(f"[wonder] {status}: {reason} | clause={verdict.get('clause')} | amended={amended}")
            await self.push_frame(
                RTVIServerMessageFrame(
                    data={
                        "type": "action_verification",
                        "id": vid,
                        "status": status,
                        "model": model,
                        "actionTitle": title,
                        "reason": reason,
                        "clause": verdict.get("clause"),
                        "amendedAction": verdict.get("amendedAction"),
                        "ms": int((time.time() - t0) * 1000),
                    }
                )
            )
            if status != "approve" and reason:
                await self.push_frame(TTSSpeakFrame(text=reason))
                if status == "amend" and isinstance(amended, dict):
                    await self.push_frame(
                        RTVIServerMessageFrame(
                            data={"type": "action", "targetElementId": action.get("targetElementId"), "actionTitle": f"Amended: {title}", "fieldAction": amended, "fieldActions": [amended], "verified": True}
                        )
                    )
        except Exception as e:  # verification is advisory; never breaks the conversation
            await self.push_frame(RTVIServerMessageFrame(data={"type": "action_verification", "id": vid, "status": "error", "model": model, "actionTitle": title, "reason": str(e), "ms": int((time.time() - t0) * 1000)}))


class AckProcessor(FrameProcessor):
    """Fast lane: a tiny parallel Spark call speaks one acknowledgement sentence
    (~2 s) while the full answer is still being composed. Skipped if the answer
    arrives first; cancelled on interruption. Nothing canned is ever spoken."""

    def __init__(self, session: SessionState, settings: Settings, downstream: FrameProcessor | None = None, **kwargs):
        super().__init__(**kwargs)
        self._session = session
        self._settings = settings
        # The LLM service handles frames one at a time and is busy for the whole Spark
        # stream, so an ack pushed from here would only be spoken after the answer.
        # It is injected downstream of the LLM instead (ActionMarkerFilter).
        self._downstream = downstream
        self._task: asyncio.Task | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterruptionFrame):
            self._cancel()
        elif isinstance(frame, LLMContextFrame):
            self._cancel()
            text = self._session.last_user_text.strip()
            if text:
                self._task = asyncio.create_task(self._ack(text))
        await self.push_frame(frame, direction)

    def _cancel(self):
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None

    async def _ack(self, user_text: str):
        from .prompt import language_label

        t0 = time.time()
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as http:
                async with http.post(
                    f"{self._settings.meta_base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self._settings.meta_api_key}", "Content-Type": "application/json"},
                    json={
                        "model": self._settings.spark_model,
                        "temperature": 0.3,
                        "reasoning_effort": "minimal",
                        "messages": [
                            {"role": "system", "content": ACK_SYSTEM_PROMPT.format(language=language_label(self._session.lang, self._session.accent))},
                            {"role": "user", "content": user_text},
                        ],
                    },
                ) as res:
                    if res.status != 200:
                        return
                    data = await res.json()
            text = ((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "").strip()
            if not text or self._session.main_started:
                return  # the real answer beat us: do not interject
            target = self._downstream or self
            await target.push_frame(RTVIServerMessageFrame(data={"type": "agent_ack", "text": text, "ms": int((time.time() - t0) * 1000)}))
            await target.push_frame(TTSSpeakFrame(text=text, append_to_context=False))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"[ack] skipped: {e}")
