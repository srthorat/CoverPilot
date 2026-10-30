"""Unit tests for ASR post-correction and <<ACTION>> parsing (pure functions)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from coverpilot.asr_corrections import correct  # noqa: E402
from coverpilot.prompt import ACTION_MARKER, parse_action  # noqa: E402


@pytest.mark.parametrize(
    "heard, expected",
    [
        ("hospitality daily cash rider", "hospital daily cash rider"),
        ("hospital daily cost", "hospital daily cash"),
        ("hospital daily catch", "hospital daily cash"),
        ("critical illness cover", "critical illness rider"),
        ("1.5 crore", "one and a half crore"),
        ("welcome to nexa sure", "welcome to NexaSure"),
        ("Nexus Sure insurance", "NexaSure insurance"),
        ("nexasure rider", "NexaSure rider"),
    ],
)
def test_known_misrecognitions_are_corrected(heard: str, expected: str):
    assert correct(heard) == expected


def test_marathi_cash_rider_mishear_is_corrected_and_hindi_rok_is_left_alone():
    assert correct("रुग्णालयातील दैनिक रोक रायडर किती आहे?") == "रुग्णालयातील दैनिक रोख रायडर किती आहे?"
    assert correct("रुग्णालयातील दैनिक रोग रायडर किती आहे?") == "रुग्णालयातील दैनिक रोख रायडर किती आहे?"
    assert correct("गाड़ी रोक दीजिए") == "गाड़ी रोक दीजिए"
    assert correct("रोख रायडर") == "रोख रायडर"


def test_correction_is_case_insensitive():
    assert correct("HOSPITALITY DAILY CASH") == "hospital daily cash"


def test_unrelated_text_is_unchanged():
    text = "please nominate my son Rohan"
    assert correct(text) == text


def test_correct_is_idempotent():
    once = correct("hospitality daily cash and 1.5 crore")
    assert correct(once) == once


def test_parse_action_extracts_json_tail():
    raw = (
        '{"targetElementId":"card-hospital-cash",'
        '"fieldActions":[{"type":"select","field":"hospitalCash","value":true}]}'
    )
    action = parse_action(raw)
    assert action is not None
    assert action["targetElementId"] == "card-hospital-cash"
    assert action["fieldActions"] == [{"type": "select", "field": "hospitalCash", "value": True}]


def test_parse_action_builds_single_fieldaction_alias():
    raw = '{"fieldActions":[{"type":"ladder","field":"ciTier","value":"tier3"}]}'
    action = parse_action(raw)
    assert action["fieldAction"] == action["fieldActions"][0]


def test_parse_action_ignores_non_dict_entries():
    raw = '{"fieldActions":["junk",{"type":"navigate","step":2}]}'
    action = parse_action(raw)
    assert action["fieldActions"] == [{"type": "navigate", "step": 2}]


def test_parse_action_returns_none_for_garbage():
    assert parse_action("not json at all") is None


def test_action_marker_constant():
    assert ACTION_MARKER == "<<ACTION>>"


def test_system_prompt_carries_medical_boundary():
    from coverpilot.prompt import build_system_prompt

    prompt = build_system_prompt("en", "in", "muse-spark-1.3")
    assert "MEDICAL BOUNDARY" in prompt
    assert "not a doctor" in prompt


def test_prompt_supports_extra_nominees_clause_highlight_and_customer_only_payment():
    from coverpilot.prompt import VERIFIER_SYSTEM_PROMPT, build_system_prompt

    prompt = build_system_prompt("en", "in", "muse-spark-1.3")
    assert "additionalNominees" in prompt
    assert '"clause"?' in prompt and "highlighted" in prompt
    assert "never say that you paid, signed or submitted" in prompt
    assert "additionalNominees" in VERIFIER_SYSTEM_PROMPT
