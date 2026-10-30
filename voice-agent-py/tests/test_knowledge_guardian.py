"""The Integrity Guardian's own knowledge: customer questions find the right passage, and the two agents' bases stay separate."""
import pytest

from coverpilot.knowledge import KnowledgeBase

SHARED = {
    "policy-terms",
    "claims-and-grievance",
    "nomination-and-trust",
    "benefit-ladders-tax-underwriting",
    "disclosure-consequences",
    "choosing-cover-and-riders",
}


@pytest.fixture(scope="module")
def guardian() -> KnowledgeBase:
    return KnowledgeBase(include=SHARED, include_prefix=("guardian-",))


# (question, substring that must appear in a top-3 heading, case-insensitive)
CASES = [
    ("what is in the pack the insurer sends me with the policy", "policy document package"),
    ("where do I find the UIN on the document", "uin on a document"),
    ("what do the letters and numbers in the UIN mean", "read a uin"),
    ("is the proposal number the same as the policy number", "proposal number"),
    ("what is on the policy schedule page", "policy schedule"),
    ("when does my cover actually start", "start of cover"),
    ("difference between policy term and premium paying term", "premium paying term"),
    ("how will the sum assured be paid to my family", "sum assured and how it is paid"),
    ("does the premium table need to show GST", "gst appears"),
    ("how should my riders be shown in the document", "riders table"),
    ("what is the customer information sheet", "customer information sheet"),
    ("what is a benefit illustration and who signs it", "benefit illustration"),
    ("the document gives only ten days grace for monthly premium is that allowed", "grace period shorter"),
    ("it says suicide is excluded for 24 months", "suicide exclusion longer"),
    ("the policy says no refund on suicide in the first year", "no refund or less than eighty"),
    ("my policy says free look is fifteen days", "free-look shorter"),
    ("document says two years incontestability", "contestability period is not three"),
    ("there is no nominee section in my policy", "no nomination section"),
    ("sum assured in document is different from what I applied for", "sum assured different"),
    ("premium on the document is higher than my quote", "premium different"),
    ("I chose critical illness but it is not listed", "rider you chose is not listed"),
    ("what happens if I miss a premium and my policy lapses", "what lapse means"),
    ("how do I bring back a lapsed policy", "reviving a lapsed policy"),
    ("does my term plan give a surrender value", "surrender value on a pure term plan"),
    ("can I take a loan on my term policy", "policy loans and paid-up"),
    ("what happens to my rider if the main policy lapses", "riders if the base policy lapses"),
    ("how do I report a death and register the claim", "tell the insurer about a claim"),
    ("must the policy document list the claim documents and the website too", "documents the insurer must list"),
    ("how many days does the insurer have to pay a death claim", "settle a death claim"),
    ("does the insurer pay interest if the claim is late", "interest when a claim is late"),
    ("what must a rejection rest on and does it need evidence and written grounds", "rejection has to rest on"),
    ("how do I go to the insurance ombudsman", "insurance ombudsman"),
    ("what should I ask the insurer about my riders", "questions about riders"),
    ("what is repudiation", "repudiation"),
    ("what does contestability mean", "contestability"),
    ("how should the guardian phrase a problem it finds", "possible issue"),
    ("what should the guardian say when the document does not mention something", "document does not say"),
]


@pytest.mark.parametrize("question,expected", CASES)
def test_question_finds_the_right_passage(guardian, question, expected):
    headings = [c.heading.lower() for _s, c in guardian.search(question, k=3)]
    assert any(expected in h for h in headings), f"{question!r} -> {headings}"


def test_guardian_has_its_own_passages():
    own = KnowledgeBase(include=set(), include_prefix=("guardian-",))
    sources = {c.source for c in own.chunks}
    assert len(own.chunks) >= 40, len(own.chunks)
    assert len(sources) >= 6, sources
    assert all(c.source.startswith("Guardian") for c in own.chunks)


def test_every_passage_cites_a_source():
    own = KnowledgeBase(include=set(), include_prefix=("guardian-",))
    assert all("Source:" in c.text for c in own.chunks), [c.heading for c in own.chunks if "Source:" not in c.text]


def test_guardian_base_excludes_app_usage_files(guardian):
    sources = [c.source for c in guardian.chunks]
    assert not any("Faq" in s or "Process And Payment" in s or s.startswith("Cobrowse") for s in sources)


def test_cobrowse_base_excludes_guardian_files():
    cobrowse = KnowledgeBase(exclude_prefix=("guardian-",))
    assert not any(c.source.startswith("Guardian") for c in cobrowse.chunks)
    assert any("Faq" in c.source for c in cobrowse.chunks)
