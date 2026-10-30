"""Underwriter handoff cases.

When the customer asks something the advisor must not answer (a health question
beyond the form, or a request to bypass a statutory rule), the model emits an
``escalate`` action. A case records the question, the reply, the product choices
on screen, the knowledge retrieved and a three-line factual note for an
underwriter. The form's own values (name, date of birth, pincode, nominee names)
are never copied in. Identity numbers (Aadhaar, PAN), mobile numbers, emails and
account or card numbers are masked inside the stored question and reply, and
each is cut to 300 characters. The question itself is kept because the
underwriter has to see what was asked, so it can still describe a health matter
the customer raised; the case never carries a health declaration from the form.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

import aiohttp
from loguru import logger

_CASES_PATH = Path(__file__).resolve().parent.parent / "data" / "cases.jsonl"

# Product choices only. Anything not listed here is left out of the case.
_SCREEN_FIELDS = (
    "activeStep",
    "baseSumAssured",
    "selectedRiders",
    "ciTier",
    "atpdOption",
    "lifeStageEscalator",
    "terminalIllnessCover",
    "termsDrawerOpen",
)

REASONS = {
    "medical": "Health question beyond the form",
    "override": "Request to bypass a statutory rule",
    "other": "Needs a human underwriter",
}

_SUMMARY_PROMPT = """You write a three-line case note for a human underwriter at an insurance company.
Input: the customer's question and the advisor's reply.
Output exactly three short lines in English, no markdown:
1. What the customer asked.
2. What the advisor replied.
3. What the underwriter needs to review.
Do not assess any health condition, symptom, risk, medical seriousness or acceptance. Do not give advice. Do not add facts that are not in the input."""


# Masking is by pattern, never by a model. Order matters: a 16-digit card (4-4-4-4) goes first so its first
# twelve digits are not taken for an Aadhaar, then Aadhaar, before the looser mobile and account patterns
# can match part of one.
_MASKS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?<!\d)\d{4}(?:[ -]\d{4}){3}(?!\d)"), "[account or card masked]"),
    (re.compile(r"(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?![ -]?\d)"), "[aadhaar masked]"),
    (re.compile(r"\b[A-Za-z]{5}\d{4}[A-Za-z]\b"), "[PAN masked]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email masked]"),
    (re.compile(r"(?<!\d)(?:\+91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)"), "[mobile masked]"),
    (re.compile(r"(?<!\d)\d{9,18}(?!\d)"), "[account or card masked]"),
]


def mask_text(text: str | None, limit: int = 300) -> str:
    """Mask identity, phone, email and account numbers, then cut to `limit` characters."""
    out = text or ""
    for pattern, label in _MASKS:
        out = pattern.sub(label, out)
    return out[:limit]


def sanitize_screen(screen: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(screen, dict):
        return {}
    out = {k: screen[k] for k in _SCREEN_FIELDS if k in screen}
    nomination = screen.get("nominationValues")
    if isinstance(nomination, dict):
        out["nominee"] = {"relation": nomination.get("primaryRelation"), "sharePercent": nomination.get("primaryShare")}
    return out


def build_case(
    *,
    reason: str,
    language: str,
    question: str,
    reply: str,
    screen: dict[str, Any] | None,
    kb_chunks: list[dict[str, Any]],
    summary: str | None,
    summary_error: str | None,
    now: float | None = None,
) -> dict[str, Any]:
    created = now if now is not None else time.time()
    return {
        "caseId": f"UW-{uuid.uuid4().hex[:8].upper()}",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(created)),
        "reason": reason if reason in REASONS else "other",
        "reasonLabel": REASONS.get(reason, REASONS["other"]),
        "language": language,
        "question": mask_text(question),
        "advisorReply": mask_text(reply),
        "screen": sanitize_screen(screen),
        "knowledge": [{"label": c.get("label"), "score": c.get("score")} for c in kb_chunks],
        "underwriterNote": summary,
        "summaryError": summary_error,
        "status": "open",
    }


async def summarize(question: str, reply: str, *, api_key: str, base_url: str, model: str) -> tuple[str | None, str | None]:
    """Three factual lines from Muse Spark, or the error. No canned text is ever substituted."""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as http:
            async with http.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "temperature": 0,
                    "reasoning_effort": "minimal",
                    "messages": [
                        {"role": "system", "content": _SUMMARY_PROMPT},
                        {"role": "user", "content": f"CUSTOMER QUESTION: {mask_text(question)}\nADVISOR REPLY: {mask_text(reply)}"},
                    ],
                },
            ) as res:
                if res.status != 200:
                    return None, f"Meta API request failed (HTTP {res.status})"
                data = await res.json()
        text = ((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "").strip()
        return (text or None), (None if text else "empty summary")
    except Exception as e:  # the case is still recorded; the note is marked unavailable
        return None, str(e)


def store_case(case: dict[str, Any], path: Path = _CASES_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(case, ensure_ascii=False) + "\n")
    logger.info(f"[case] {case['caseId']} {case['reason']} stored")


def load_cases(path: Path = _CASES_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
