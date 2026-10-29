from bot import KNOWLEDGE, KNOWLEDGE_GUARDIAN
from coverpilot.prompt import build_system_prompt, parse_action
from coverpilot.session import SessionState, voice_for

MODEL = "muse-spark-1.3"


def test_guardian_prompt_is_a_separate_reviewer_with_no_form_actions():
    p = build_system_prompt("en", "in", MODEL, "guardian")
    assert "Integrity Guardian" in p
    assert "DOCUMENT CITATIONS" in p and "UNTRUSTED CONTENT" in p
    for banned in ('"type":"fill"', "nominate", "STEP 1 ORDER", "STEP GATE", "APPROVAL:"):
        assert banned not in p, banned
    assert "guardian.possibleIssues" in p and "guardian_next" in p and "open_cobrowse" in p
    assert "MEDICAL BOUNDARY" in p and "<<ACTION>>" in p


def test_cobrowse_prompt_hands_review_off_to_the_guardian():
    p = build_system_prompt("en", "in", MODEL)
    assert p == build_system_prompt("en", "in", MODEL, "cobrowse")
    assert '"type":"fill"' in p and "REVIEW HAND-OFF" in p and "open_guardian" in p
    for banned in ("DOCUMENT CITATIONS", "guardian.possibleIssues", "guardian_next", "TWO MODES"):
        assert banned not in p, banned


def test_both_prompts_share_the_same_medical_boundary_text():
    g = build_system_prompt("en", "in", MODEL, "guardian")
    c = build_system_prompt("en", "in", MODEL, "cobrowse")
    line = next(l for l in c.splitlines() if l.startswith("MEDICAL BOUNDARY:"))
    assert line in g


def test_language_follows_the_customer_in_both_prompts():
    for role in ("cobrowse", "guardian"):
        assert "Hindi (Devanagari" in build_system_prompt("hi", "in", MODEL, role)


def test_each_agent_has_its_own_knowledge_base():
    guardian_sources = {c.source for c in KNOWLEDGE_GUARDIAN.chunks}
    all_sources = {c.source for c in KNOWLEDGE.chunks}
    assert "Policy Terms" in guardian_sources
    assert "Faq" not in guardian_sources and "Process And Payment" not in guardian_sources
    assert {"Faq", "Process And Payment", "Policy Terms"} <= all_sources
    assert len(KNOWLEDGE_GUARDIAN.chunks) < len(KNOWLEDGE.chunks)


def test_the_two_agents_speak_in_different_voices():
    s = SessionState()
    cobrowse = voice_for(s.active_persona(), s.lang, s.accent)
    s.role = "guardian"
    guardian = voice_for(s.active_persona(), s.lang, s.accent)
    assert cobrowse != guardian
    s.persona = "nova"  # the customer's choice only changes the co-browsing agent
    assert voice_for(s.active_persona(), s.lang, s.accent) == guardian


def test_actions_parse_for_both_agents():
    assert parse_action('{"targetElementId": null, "actionTitle": "Next section", "fieldAction": {"type":"ui","action":"guardian_next"}}')["fieldAction"]["action"] == "guardian_next"
    assert parse_action('{"targetElementId": "field-city", "actionTitle": "Enter city", "fieldAction": {"type":"fill","field":"city","value":"Pune"}}')["fieldAction"]["field"] == "city"
