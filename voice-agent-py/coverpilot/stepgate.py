"""Server-side check that the agent does not move the customer past an incomplete step.

The form already refuses to open a later step (the browser is the authority); this keeps the
agent's words and actions in line with it: before the model answers, a request to move on is
paired with what is missing, and a navigate action that would skip ahead is dropped.
"""

from __future__ import annotations

import re
from typing import Any

_ADVANCE = re.compile(
    r"\b(next|continue|proceed|move on|go ahead|forward|submit|issue|complete|finish|done|step\s*[2-5]|section\s*[2-5])\b"
    r"|आगे|अगला|अगली|पुढे|पुढील|आगे बढ़",
    re.IGNORECASE,
)


def missing_on_step(screen_state: dict[str, Any] | None) -> list[str]:
    gate = (screen_state or {}).get("stepGate") or {}
    missing = gate.get("missingOnThisStep")
    return [str(m) for m in missing] if isinstance(missing, list) else []


def gate_note(user_text: str, screen_state: dict[str, Any] | None) -> str:
    """A note for the model when the customer asks to move on but the step is incomplete."""
    missing = missing_on_step(screen_state)
    if not missing or not _ADVANCE.search(user_text or ""):
        return ""
    return (
        "[Form check] The form will not open the next step yet. Still missing on this step: "
        + " ".join(missing)
        + " Do not say you are moving on and do not output a navigate action. Tell the customer "
        "what is missing and ask for the first item."
    )


def drop_blocked_navigation(action: dict[str, Any] | None, screen_state: dict[str, Any] | None) -> dict[str, Any] | None:
    """Remove navigate actions that jump past the current step while it still has missing items."""
    if not action or not missing_on_step(screen_state):
        return action
    current = (screen_state or {}).get("activeStep")
    if not isinstance(current, int):
        return action

    def blocked(a: Any) -> bool:
        return isinstance(a, dict) and a.get("type") == "navigate" and isinstance(a.get("step"), int) and a["step"] > current

    out = dict(action)
    steps = [a for a in (action.get("fieldActions") or []) if not blocked(a)]
    out["fieldActions"] = steps
    single = action.get("fieldAction")
    out["fieldAction"] = None if blocked(single) else single
    if not out["fieldAction"] and steps:
        out["fieldAction"] = steps[0]
    return out
