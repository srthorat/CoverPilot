"""Unit tests for underwriter handoff cases (no network)."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from coverpilot import cases  # noqa: E402
from coverpilot.prompt import parse_action  # noqa: E402


def test_parse_action_extracts_escalation_without_screen_action():
    action = parse_action('{"actionTitle":"Routing to underwriter","fieldActions":[{"type":"escalate","reason":"medical"}]}')
    assert action["escalate"] == {"reason": "medical"}
    assert action["fieldActions"] == []
    assert action["fieldAction"] is None


def test_parse_action_escalation_keeps_other_screen_actions():
    raw = '{"fieldActions":[{"type":"escalate","reason":"override"},{"type":"navigate","step":2}]}'
    action = parse_action(raw)
    assert action["escalate"] == {"reason": "override"}
    assert action["fieldActions"] == [{"type": "navigate", "step": 2}]


def test_parse_action_unknown_reason_falls_back_to_other():
    action = parse_action('{"fieldAction":{"type":"escalate","reason":"banana"}}')
    assert action["escalate"] == {"reason": "other"}


def test_parse_action_without_escalation_has_none():
    assert parse_action('{"fieldAction":{"type":"cover","value":"1cr"}}')["escalate"] is None


def test_case_excludes_identity_health_and_contact_fields():
    screen = {
        "activeStep": 1,
        "baseSumAssured": "1.5cr",
        "formValues": {"fullName": "Ramesh Shankar Thorat", "dob": "14/05/1994", "pincode": "411038", "isSmoker": True, "section45Consent": True},
        "underwriting": {"diabetes": True, "bp": "high"},
        "nominationValues": {"primaryName": "Priya Thorat", "primaryRelation": "Spouse", "primaryShare": 100},
        "mobile": "+91 98765 43210",
    }
    case = cases.build_case(
        reason="medical", language="en", question="is my diabetes serious", reply="I can't advise on that.",
        screen=screen, kb_chunks=[], summary="note", summary_error=None,
    )
    blob = json.dumps(case, ensure_ascii=False)
    for forbidden in ["Ramesh", "Thorat", "Priya", "14/05/1994", "411038", "98765", '"diabetes"', "isSmoker", "section45Consent", "formValues"]:
        assert forbidden not in blob, forbidden
    assert case["screen"]["baseSumAssured"] == "1.5cr"
    assert case["screen"]["nominee"] == {"relation": "Spouse", "sharePercent": 100}


def test_case_id_and_defaults():
    case = cases.build_case(
        reason="weird", language="hi", question="q", reply="r", screen=None, kb_chunks=[],
        summary=None, summary_error="boom", now=0,
    )
    assert case["caseId"].startswith("UW-") and len(case["caseId"]) == 11
    assert case["reason"] == "other"
    assert case["createdAt"] == "1970-01-01T00:00:00Z"
    assert case["underwriterNote"] is None
    assert case["summaryError"] == "boom"
    assert case["status"] == "open"


def test_knowledge_keeps_only_label_and_score():
    case = cases.build_case(
        reason="other", language="en", question="q", reply="r", screen={},
        kb_chunks=[{"label": "Policy Terms › Clause 5", "score": 9.1, "terms": ["secret"]}],
        summary="n", summary_error=None,
    )
    assert case["knowledge"] == [{"label": "Policy Terms › Clause 5", "score": 9.1}]


def test_summary_failure_is_reported_not_replaced(monkeypatch):
    class Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("network down")

    monkeypatch.setattr(cases.aiohttp, "ClientSession", Boom)
    text, error = asyncio.run(cases.summarize("q", "r", api_key="k", base_url="http://x", model="m"))
    assert text is None
    assert "network down" in error


def test_store_and_load_roundtrip(tmp_path: Path):
    path = tmp_path / "cases.jsonl"
    first = cases.build_case(reason="medical", language="en", question="a", reply="b", screen={}, kb_chunks=[], summary="n", summary_error=None)
    second = cases.build_case(reason="override", language="mr", question="c", reply="d", screen={}, kb_chunks=[], summary=None, summary_error="x")
    cases.store_case(first, path)
    cases.store_case(second, path)
    loaded = cases.load_cases(path)
    assert [c["caseId"] for c in loaded] == [first["caseId"], second["caseId"]]


def test_load_missing_file_returns_empty(tmp_path: Path):
    assert cases.load_cases(tmp_path / "none.jsonl") == []
