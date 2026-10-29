from coverpilot.stepgate import drop_blocked_navigation, gate_note

STATE = {"activeStep": 1, "stepGate": {"furthestStepAllowed": 1, "missingOnThisStep": ["Enter your 6-digit PIN code."]}}
OPEN = {"activeStep": 1, "stepGate": {"furthestStepAllowed": 5, "missingOnThisStep": []}}


def test_note_when_moving_on_with_missing_items():
    assert "PIN code" in gate_note("ok next section please", STATE)
    assert "PIN code" in gate_note("अगला", STATE)


def test_no_note_without_advance_intent_or_missing_items():
    assert gate_note("what is the grace period", STATE) == ""
    assert gate_note("next", OPEN) == ""


def test_forward_navigation_dropped_but_back_and_fills_kept():
    nav = {"type": "navigate", "step": 2}
    fill = {"type": "fill", "field": "pincode", "value": "411038"}
    act = {"fieldAction": nav, "fieldActions": [fill, nav]}
    out = drop_blocked_navigation(act, STATE)
    assert out["fieldActions"] == [fill] and out["fieldAction"] == fill
    back = {"fieldAction": {"type": "navigate", "step": 1}, "fieldActions": [{"type": "navigate", "step": 1}]}
    assert drop_blocked_navigation(back, STATE) == back
    assert drop_blocked_navigation(act, OPEN) == act
