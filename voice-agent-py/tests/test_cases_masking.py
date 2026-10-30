"""A stored case must not carry identity, phone, email or account numbers, and keeps each text short."""

from coverpilot import cases


def test_the_example_from_the_review_is_masked():
    out = cases.mask_text("my PAN is ABCDE1234F and mobile 98765 43210")
    assert "ABCDE1234F" not in out and "98765" not in out and "43210" not in out
    assert "[PAN masked]" in out and "[mobile masked]" in out


def test_each_kind_of_number_is_masked():
    t = "Aadhaar 4321 8765 9012, again 432187659012, +91 98765-43210, a@b.co, card 4111 1111 1111 1111, a/c 123456789012345"
    out = cases.mask_text(t)
    for leaked in ["4321 8765 9012", "432187659012", "98765", "a@b.co", "4111 1111", "123456789012345"]:
        assert leaked not in out, (leaked, out)
    assert out.count("[aadhaar masked]") == 2 and "[email masked]" in out and out.count("[account or card masked]") == 2


def test_ordinary_numbers_survive():
    t = "My premium is 1050 rupees for 30 years and the cover is 15000000 rupees on page 4."
    assert cases.mask_text(t) == t


def test_text_is_cut_to_300_characters_after_masking():
    assert len(cases.mask_text("word " * 200)) == 300
    assert len(cases.mask_text("x" * 1000)) == 300


def test_build_case_stores_masked_question_and_reply():
    c = cases.build_case(
        reason="medical", language="en",
        question="I had a heart attack in 2019, my PAN is ABCDE1234F, call 9876543210",
        reply="Please email me at priya@example.com or use 4321 8765 9012",
        screen={}, kb_chunks=[], summary=None, summary_error=None,
    )
    blob = c["question"] + c["advisorReply"]
    for leaked in ["ABCDE1234F", "9876543210", "priya@example.com", "4321 8765 9012"]:
        assert leaked not in blob, leaked
    assert "heart attack" in c["question"]  # the underwriter still sees what was asked
