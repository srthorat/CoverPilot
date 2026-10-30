"""Realistic customer questions must surface the right chunk in the top three hits."""
import pytest

from coverpilot.knowledge import KnowledgeBase


@pytest.fixture(scope="module")
def kb() -> KnowledgeBase:
    return KnowledgeBase(exclude_prefix=("guardian-",))


# (question, substring that must appear in a top-3 heading, case-insensitive)
CASES = [
    ("can I add a second child as nominee", "second child"),
    ("how do I add another nominee", "another nominee"),
    ("can I nominate my brother", "nominee eligibility"),
    ("can I change my nominee", "change my nominee"),
    ("what happens to the nominee if the child is a minor", "minor nominees"),
    ("what is the married women's property act", "married women"),
    ("what is the grace period", "grace period"),
    ("how long do I have to cancel after buying", "free-look"),
    ("what if the life assured commits suicide in the first year", "suicide"),
    ("what is section 45", "section 45"),
    ("can the insurer reject my claim after three years", "claims get rejected"),
    ("can I revive a lapsed policy", "revival"),
    ("how do I pay the premium", "paying the premium"),
    ("how does esign work", "electronic signature"),
    ("how do I sign the policy", "electronic signature"),
    ("is there GST on term insurance", "gst"),
    ("what documents are needed for KYC", "kyc"),
    ("how long does a death claim take", "how long a claim takes"),
    ("what documents does the nominee need for a death claim", "documents for a death claim"),
    ("how do I complain about my insurer", "complaint"),
    ("what is the insurance ombudsman", "ombudsman"),
    ("how much cover do I need", "how much cover"),
    ("do I need a medical test", "medical test"),
    ("what is a rider", "rider"),
    ("what is the difference between term and endowment", "term insurance versus"),
    ("I lied about smoking what happens", "smoking status"),
    ("what if I give the wrong date of birth", "date of birth"),
    ("what is the tax benefit on premium", "tax benefits"),
    ("is the death benefit taxable", "tax benefits"),
    ("what is the critical illness waiting period", "critical illness"),
    ("tell me about the hospital daily cash rider", "hospital daily cash"),
    ("how many policies can I buy", "more than one policy"),
    ("what term should I pick", "what term"),
    ("is this a real insurance offer", "real insurance offer"),
    ("what is the claim settlement ratio", "money safe"),
    ("what do you see on my screen", "co-browsing"),
    ("what are the sample documents", "sample documents"),
    ("शिकायत कैसे करें", "complaint"),
    ("भुगतान कैसे करें", "paying the premium"),
    ("मृत्यू दावा कागदपत्रे", "documents for a death claim"),
]


@pytest.mark.parametrize("question,expected", CASES)
def test_question_reaches_the_right_chunk(kb: KnowledgeBase, question: str, expected: str):
    headings = [c.heading.lower() for _, c in kb.search(question, k=3)]
    assert any(expected in h for h in headings), f"{question!r} -> {headings}"


def test_at_least_thirty_cases():
    assert len(CASES) >= 30


def test_sources_file_adds_no_chunks(kb: KnowledgeBase):
    assert not any(c.source.lower() == "sources" for c in kb.chunks)


def test_every_chunk_names_its_source(kb: KnowledgeBase):
    missing = [c.label for c in kb.chunks if "Source:" not in c.text]
    assert not missing, missing


def test_no_chunk_states_a_settlement_ratio_or_registration_number(kb: KnowledgeBase):
    for c in kb.chunks:
        assert "99.1" not in c.text, c.label
        assert "UIN" not in c.text and "CIN" not in c.text, c.label
