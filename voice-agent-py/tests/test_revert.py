"""Unit tests for undoing actions that Muse Wonder rejected."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from coverpilot.revert import inverse_actions  # noqa: E402
from coverpilot.session import SessionState  # noqa: E402

BEFORE = {
    "activeStep": 1,
    "termsDrawerOpen": False,
    "baseSumAssured": "1.5cr",
    "selectedRiders": {"criticalIllness": False, "accidentalDeath": True, "waiverOfPremium": False, "hospitalCash": False},
    "ciTier": "tier2",
    "atpdOption": "lump",
    "lifeStageEscalator": False,
    "nominationValues": {"primaryName": "Priya", "primaryRelation": "Spouse", "primaryShare": 100, "hasSecondaryNominee": False},
    "formValues": {"fullName": "Ravi", "dob": "", "city": "Mumbai", "pincode": "400001", "isSmoker": False},
}


def test_fill_restores_previous_value_and_empty_for_unset():
    undo = inverse_actions([{"type": "fill", "field": "city", "value": "Pune"}, {"type": "fill", "field": "dob", "value": "14/05/1994"}], BEFORE)
    assert {"type": "fill", "field": "city", "value": "Mumbai"} in undo
    assert {"type": "fill", "field": "dob", "value": ""} in undo


def test_select_rider_restores_previous_state():
    undo = inverse_actions([{"type": "select", "field": "criticalIllness", "value": True}], BEFORE)
    assert undo == [{"type": "select", "field": "criticalIllness", "value": False}]


def test_smoker_restored_only_when_previous_value_was_known():
    action = [{"type": "select", "field": "isSmoker", "value": True}]
    assert inverse_actions(action, BEFORE) == [{"type": "select", "field": "isSmoker", "value": False}]
    unknown = {**BEFORE, "formValues": {}}
    assert inverse_actions(action, unknown) == []


def test_ladder_restores_tier_and_the_rider_it_switched_on():
    undo = inverse_actions([{"type": "ladder", "field": "ciTier", "value": "tier3"}], BEFORE)
    assert undo == [
        {"type": "ladder", "field": "ciTier", "value": "tier2"},
        {"type": "select", "field": "criticalIllness", "value": False},
    ]


def test_cover_and_navigate_restore():
    assert inverse_actions([{"type": "cover", "value": "2cr"}], BEFORE) == [{"type": "cover", "value": "1.5cr"}]
    assert inverse_actions([{"type": "navigate", "step": 2}], BEFORE) == [{"type": "navigate", "step": 1}]


def test_terms_drawer_is_closed_again_only_if_it_was_closed():
    assert inverse_actions([{"type": "ui", "action": "open_terms"}], BEFORE) == [{"type": "ui", "action": "close_terms"}]
    assert inverse_actions([{"type": "ui", "action": "open_terms"}], {**BEFORE, "termsDrawerOpen": True}) == []


def test_nominate_restores_only_the_changed_keys():
    undo = inverse_actions([{"type": "nominate", "primaryName": "Meera", "primaryShare": 70}], BEFORE)
    assert undo == [{"type": "nominate", "primaryName": "Priya", "primaryShare": 100}]


def test_unknown_or_empty_state_changes_nothing():
    assert inverse_actions([{"type": "cover", "value": "2cr"}], {}) == []
    assert inverse_actions([{"type": "mystery"}, "junk"], BEFORE) == []
    assert inverse_actions([], None) == []


def test_refresh_records_the_last_three_user_turns():
    from types import SimpleNamespace

    from coverpilot.processors import ScreenStateInjector

    session = SessionState()
    settings = SimpleNamespace(spark_model="muse-spark-1.3")
    injector = ScreenStateInjector(session, settings, kb=None)
    for text in ["yeah we can move to the next thing", "why we still are in this thing only", "hello", "city is Pune"]:
        context = SimpleNamespace(messages=[{"role": "user", "content": text}])
        injector._refresh(context)
    assert session.user_turns == ["why we still are in this thing only", "hello", "city is Pune"]
    assert session.last_user_text == "city is Pune"


def test_an_amendment_that_matches_no_applied_action_leaves_the_action_standing():
    from coverpilot.processors import settle_verdict

    applied = [{"type": "fill", "field": "city", "value": "Pune"}]
    # Wonder suggested a different change (an invalid shape): do not reject, so nothing is reverted.
    assert settle_verdict("amend", {"type": "field", "field": "section45Consent", "value": True}, applied) == ("approve", None)
    # A real correction of the applied field is kept.
    fix = {"type": "fill", "field": "city", "value": "Mumbai"}
    assert settle_verdict("amend", fix, applied) == ("amend", fix)
    # Other verdicts pass through untouched.
    assert settle_verdict("reject", None, applied) == ("reject", None)
    assert settle_verdict("approve", None, applied) == ("approve", None)


def test_ask_verdict_keeps_the_action_and_the_verifier_is_told_when_to_use_it():
    from coverpilot.processors import settle_verdict
    from coverpilot.prompt import VERIFIER_SYSTEM_PROMPT

    applied = [{"type": "nominate", "primaryName": "Priya"}]
    assert settle_verdict("ask", None, applied) == ("ask", None)  # only a reject is ever reverted
    assert '"ask"' in VERIFIER_SYSTEM_PROMPT and "appointee" in VERIFIER_SYSTEM_PROMPT
