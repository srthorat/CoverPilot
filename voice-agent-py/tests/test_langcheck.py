"""The Hindi and Marathi language check and the per-turn expected language."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from coverpilot.langcheck import (  # noqa: E402
    check_reply,
    devanagari_share,
    expected_reply_language,
    guess_language,
)

HINDI = "आपका ग्रेस पीरियड तीस दिन का है और पॉलिसी चालू रहती है।"
MARATHI = "तुमचा ग्रेस पीरियड तीस दिवसांचा आहे आणि पॉलिसी सुरू राहते."


def test_english_is_not_devanagari():
    assert devanagari_share("The grace period is thirty days for you.") == 0.0
    assert check_reply("The grace period is thirty days for you.", "hi")[0] is False


def test_product_words_in_english_letters_do_not_count_against_hindi():
    reply = "आपका premium हर महीने पंद्रह दिन के grace period के साथ चलता है।"
    assert devanagari_share(reply) > 0.6
    assert check_reply(reply, "hi")[0] is True


def test_english_nouns_inside_hindi_are_fine_a_full_english_sentence_is_not():
    assert check_reply("hospital cash rider details अभी निकाल रहा हूँ।", "hi")[0] is True
    assert check_reply("Opening the hospital cash rider details now, one moment please.", "hi")[0] is False


def test_hindi_and_marathi_are_told_apart():
    assert guess_language(HINDI) == "hi"
    assert guess_language(MARATHI) == "mr"
    assert guess_language("ग्रेस पीरियड") == "unknown"
    assert check_reply(MARATHI, "hi") == (False, "wrong language (mr)")
    assert check_reply(HINDI, "mr") == (False, "wrong language (hi)")
    assert check_reply(HINDI, "hi")[0] is True
    assert check_reply(MARATHI, "mr")[0] is True


def test_very_short_text_is_never_judged():
    assert check_reply("Sure.", "hi")[0] is True
    assert check_reply("", "mr")[0] is True


@pytest.mark.parametrize(
    "screen, text, expected",
    [
        ("hi", "मासिक प्रीमियम के लिए ग्रेस पीरियड कितना होता है?", "hi"),
        ("hi", "What is the grace period?", "hi"),  # the screen language wins for typed English
        ("mr", "फ्री लुक पीरियड म्हणजे काय?", "mr"),
        ("hi", "तुम्ही मला सांगा, हे आहे का आणि किती आहे", "mr"),  # clearly Marathi on a Hindi screen
        ("mr", "आप मुझे बताइए और यह नहीं है", "hi"),  # clearly Hindi on a Marathi screen
        ("mr", "आपण सांगा आणि ग्रेस पीरियड कितना", "mr"),  # one stray word is not enough to switch
        ("en", "What is the grace period?", None),
        ("en", "ग्रेस पीरियड कितना है", "hi"),
        ("en", "ग्रेस पीरियड किती आहे आणि तुम्ही सांगा", "mr"),
    ],
)
def test_expected_reply_language(screen, text, expected):
    assert expected_reply_language(screen, text) == expected
