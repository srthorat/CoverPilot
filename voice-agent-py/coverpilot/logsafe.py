"""Logs that never carry what the customer said or typed.

By default only metadata is logged: who answered, how the turn arrived, how long the text was and a short hash
(so two log lines about the same turn can be matched), action types and field names but never their values,
and verifier verdicts without their free text. Set DEBUG_LOG_TRANSCRIPTS=1 to get the full text back while
debugging on your own machine. The switch is read on every call, so tests can flip it.

A loguru patcher is also installed as defence in depth: every message has Aadhaar, PAN, mobile, email and
account numbers masked, and Pipecat's own lines up to ERROR (which print whole LLM requests, TTS text and frames) are cut
at their first bracket or quote so the payload never reaches the log. bot.py also turns loguru's
"diagnose" off before loguru is imported, so a traceback from inside Pipecat does not print the local
variables that hold the transcript.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any

from loguru import logger

from .cases import _MASKS

_DIGIT_RUN = re.compile(r"\d{6,}")


def debug_transcripts() -> bool:
    return os.getenv("DEBUG_LOG_TRANSCRIPTS", "").strip() in ("1", "true", "yes")


def short_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:8]


def safe_text(text: str | None) -> str:
    """The customer's words, or just their length and a short hash."""
    t = text or ""
    if debug_transcripts():
        return repr(t)
    return f"chars={len(t)} ref={short_hash(t)}"


def mask_numbers(text: str) -> str:
    """Mask identity, phone, email and account numbers and any other run of six or more digits (no truncation)."""
    out = text
    for pattern, label in _MASKS:
        out = pattern.sub(label, out)
    return _DIGIT_RUN.sub("[digits masked]", out)


def safe_action(action: dict[str, Any] | None) -> str:
    """Action types and field names, never the values that were filled in."""
    if not action:
        return "none"
    if debug_transcripts():
        return json.dumps(action, ensure_ascii=False)[:400]
    steps = action.get("fieldActions") or ([action["fieldAction"]] if action.get("fieldAction") else [])
    parts = []
    for a in steps:
        if not isinstance(a, dict):
            continue
        what = str(a.get("type"))
        if a.get("field"):
            what += f":{a['field']}"
        elif a.get("action"):
            what += f":{a['action']}"
        elif a.get("type") == "navigate":
            what += f":step{a.get('step')}"
        elif a.get("type") == "nominate":
            what += ":" + ",".join(sorted(k for k in a if k != "type"))
        parts.append(what)
    esc = (action.get("escalate") or {}).get("reason") if isinstance(action.get("escalate"), dict) else action.get("escalate")
    return f"actions={parts or 'none'} target={action.get('targetElementId')} escalate={esc}"


def safe_reason(reason: str | None) -> str:
    """A verifier's free text is shown only while debugging; otherwise just its length."""
    r = reason or ""
    return repr(r) if debug_transcripts() else f"reason_chars={len(r)}"


def safe_keys(data: Any) -> str:
    if debug_transcripts():
        return str(data)[:120]
    return "keys=" + ",".join(sorted(data)) if isinstance(data, dict) else "keys=-"


_CUT = re.compile(r"[\[\"'{]")


def _patch(record: dict) -> None:
    if debug_transcripts():
        return
    msg = record["message"]
    # Pipecat logs frame contents at WARNING and ERROR too (a failed send prints the frame), not only at DEBUG.
    if str(record["name"]).startswith("pipecat") and record["level"].no <= 40:
        m = _CUT.search(msg)
        if m:
            msg = msg[: m.start()] + "[…]"
    record["message"] = mask_numbers(msg)


def install_log_patcher() -> None:
    """Idempotent. The patcher is part of loguru's core, so it survives the Pipecat runner replacing the handlers."""
    logger.configure(patcher=_patch)
