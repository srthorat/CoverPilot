"""Undo form actions that Muse Wonder rejected.

Actions reach the browser before Wonder has checked them (the spoken path never
waits on verification), so a reject must put the form back. ``before`` is the
screen state captured just before the action was sent; it holds the previous
value of every field the agent can change. Anything whose previous value is
unknown is left alone rather than guessed.
"""

from __future__ import annotations

from typing import Any

_FILL_FIELDS = ("fullName", "dob", "gender", "annualIncome", "city", "pincode")
_RIDERS = ("criticalIllness", "accidentalDeath", "waiverOfPremium", "hospitalCash")
# A tier or option change also switches its rider on, so undoing it restores the rider too.
_LADDER_RIDER = {"ciTier": "criticalIllness", "atpdOption": "accidentalDeath"}


def inverse_actions(applied: list[dict[str, Any]], before: dict[str, Any] | None) -> list[dict[str, Any]]:
    before = before or {}
    form = before.get("formValues") or {}
    riders = before.get("selectedRiders") or {}
    nomination = before.get("nominationValues") or {}
    out: list[dict[str, Any]] = []

    for a in reversed([x for x in applied if isinstance(x, dict)]):
        kind, field = a.get("type"), a.get("field")
        if kind == "fill" and field in _FILL_FIELDS:
            previous = form.get(field)
            out.append({"type": "fill", "field": field, "value": "" if previous is None else str(previous)})
        elif kind == "select":
            if field in _RIDERS and isinstance(riders.get(field), bool):
                out.append({"type": "select", "field": field, "value": riders[field]})
            elif field == "isSmoker" and isinstance(form.get("isSmoker"), bool):
                out.append({"type": "select", "field": "isSmoker", "value": form["isSmoker"]})
        elif kind == "ladder":
            if field in _LADDER_RIDER and before.get(field):
                out.append({"type": "ladder", "field": field, "value": before[field]})
                rider = _LADDER_RIDER[field]
                if isinstance(riders.get(rider), bool):
                    out.append({"type": "select", "field": rider, "value": riders[rider]})
            elif field == "lifeStageEscalator" and isinstance(before.get("lifeStageEscalator"), bool):
                out.append({"type": "ladder", "field": "lifeStageEscalator", "value": before["lifeStageEscalator"]})
        elif kind == "cover" and before.get("baseSumAssured"):
            out.append({"type": "cover", "value": before["baseSumAssured"]})
        elif kind == "navigate" and isinstance(before.get("activeStep"), int):
            out.append({"type": "navigate", "step": before["activeStep"]})
        elif kind == "ui":
            was_open = before.get("termsDrawerOpen")
            if a.get("action") == "open_terms" and was_open is False:
                out.append({"type": "ui", "action": "close_terms"})
            elif a.get("action") == "close_terms" and was_open is True:
                out.append({"type": "ui", "action": "open_terms"})
        elif kind == "nominate":
            previous = {k: nomination[k] for k in a if k != "type" and k in nomination}
            if previous:
                out.append({"type": "nominate", **previous})
    return out
