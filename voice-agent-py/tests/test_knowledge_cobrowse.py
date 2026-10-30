"""Retrieval checks for the co-browsing agent's own knowledge (cobrowse-*.md).

Each question is typed the way a customer would ask it during the application. The passage that should
answer it must be in the top three of the co-browsing agent's search. The Integrity Guardian's file set
must contain none of these files.
"""

import pytest

from coverpilot.knowledge import KnowledgeBase

KB = KnowledgeBase(exclude_prefix=("guardian-",))

CASES = [
    # field by field
    ("how should I write my name in the form", "Step one: how to write your full legal name in the form"),
    ("what date format does the date of birth use", "Step one: date of birth format and age limits"),
    ("I am seventy years old can I apply", "Step one: date of birth format and age limits"),
    ("what are the income ranges in the dropdown", "Step one: annual income range options"),
    ("which documents prove my salary", "Income proof: which documents prove your salary"),
    ("does chewing gutkha count as tobacco use", "Step one: the tobacco question and what counts"),
    ("how many digits is the PIN code", "Step one: city and PIN code"),
    ("why can't the agent see my aadhaar and mobile number", "Step one: Aadhaar, PAN and mobile identity records"),
    ("when is PAN compulsory for insurance premium", "Why PAN is asked and when it is compulsory"),
    ("what happens when I click sample salary slip", "Sample documents versus typing it yourself"),
    ("how much does the one and a half crore cover cost per month", "Step two: choosing the cover amount and monthly price"),
    ("what are the silver gold and platinum critical illness tiers", "Step two: the critical illness rider card"),
    ("how do the two accidental disability options differ", "Step two: accidental death and disability options"),
    ("what does the waiver of premium rider cost", "Step two: the waiver of premium rider"),
    ("how much does hospital daily cash pay per day", "Step two: the hospital daily cash rider"),
    ("what does the life stage escalator do on marriage", "Step two: the life stage cover escalator"),
    ("I do not want any rider how do I skip", "Step two: you must choose riders or choose none"),
    ("how many nominees can I add and must shares be hundred", "Step three: naming nominees and their shares"),
    ("my child is nominee who gets the money", "Step three: a nominee under eighteen needs an appointee"),
    ("what is the trust switch for wife and children", "Step three: the Married Women's Property Act trust switch"),
    ("what does the section 45 tick box mean", "Step four: the Section 45 declaration box"),
    ("what does the family heart disease question ask", "Step four: the family heart and chronic disease question"),
    ("what is the hospitalisation question in step four", "Step four: the prior hospitalisation or surgery question"),
    ("what does the application check card show", "Step five: the application check card"),
    ("how do I sign the proposal and pay", "Step five: e-sign and the demo payment"),
    ("what is saved when I pause and what is not", "Pause and resume: what is not saved"),
    # common questions
    ("can you sign and pay for me", "Can you sign or pay for me"),
    ("what do the confirm and undo buttons do", "What do Confirm and Undo do"),
    ("why can I not go to the next step", "Why can I not go to the next step"),
    ("what if my voice is not heard can I type", "What if the voice does not hear me or I cannot speak"),
    ("how do I stop the agent from moving my cursor", "How do I stop the agent moving on my screen"),
    ("how is integrity guardian different from you", "What is Integrity Guardian and how is it different from you"),
    # step-gate messages
    ("the app says tick the section 45 declaration", "Message: Tick the Section 45 declaration"),
    ("it says nominee shares must total 100 percent", "Message: Nominee shares must total 100 percent"),
    ("message says enter your PAN like ABCDE1234F", "Message: Enter your PAN like ABCDE1234F"),
    # Hindi and Marathi glossary
    ("ग्रेस पीरियड क्या होता है", "Grace period in Hindi and Marathi"),
    ("नॉमिनी म्हणजे काय", "Nominee in Hindi and Marathi"),
    ("प्रीमियम माफी का मतलब क्या है", "Waiver of premium in Hindi and Marathi"),
    ("केवाईसी का मतलब", "KYC in Hindi and Marathi"),
    ("हप्ता म्हणजे काय", "Premium in Hindi and Marathi"),
]


@pytest.mark.parametrize("question,heading", CASES)
def test_expected_passage_is_in_the_top_three(question, heading):
    hits = KB.search(question, k=3)
    headings = [c.heading for _score, c in hits]
    assert heading in headings, f"{question!r} got {headings}"


def test_there_are_enough_cobrowse_passages_and_questions():
    own = [c for c in KB.chunks if c.source.startswith("Cobrowse")]
    assert len(own) >= 40
    assert len(CASES) >= 30
    assert len({c.heading for c in own}) == len(own), "duplicate headings"


def test_every_cobrowse_passage_has_a_source_line():
    for c in KB.chunks:
        if c.source.startswith("Cobrowse"):
            assert "Source:" in c.text, c.heading


def test_the_guardian_file_set_has_none_of_them():
    guardian = KnowledgeBase(include={"policy-terms"}, include_prefix=("guardian-",))
    assert not [c for c in guardian.chunks if c.source.startswith("Cobrowse")]
    assert [c for c in guardian.chunks if c.source.startswith("Policy Terms")]
