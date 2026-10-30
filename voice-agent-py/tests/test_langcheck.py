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
        # The screen language always wins: the recogniser writes Marathi speech with Hindi words now and then
        # (measured: "नॉमिनी कौन हो सकता हो?" for a Marathi question), and that must not flip the answer to Hindi.
        ("hi", "तुम्ही मला सांगा, हे आहे का आणि किती आहे", "hi"),
        ("mr", "आप मुझे बताइए और यह नहीं है", "mr"),
        ("mr", "नॉमिनी कौन हो सकता हो?", "mr"),
        ("en", "What is the grace period?", None),
        ("en", "ग्रेस पीरियड कितना है", "hi"),
        ("en", "ग्रेस पीरियड किती आहे आणि तुम्ही सांगा", "mr"),
    ],
)
def test_expected_reply_language(screen, text, expected):
    assert expected_reply_language(screen, text) == expected


HINDI_QUESTIONS = [
    "मासिक प्रीमियम के लिए ग्रेस पीरियड कितना होता है?", "फ्री लुक पीरियड क्या है?", "क्रिटिकल इलनेस राइडर में क्या कवर होता है?",
    "नॉमिनी कौन बन सकता है?", "सेक्शन 45 का क्या मतलब है?", "आत्महत्या वाली क्लॉज़ कितने महीने की होती है?", "मुझे कितना कवर लेना चाहिए?",
    "पॉलिसी लैप्स हो जाए तो क्या होता है?", "मेरी सालाना आमदनी का क्या असर पड़ेगा?", "तंबाकू न लेने पर छूट कितनी मिलती है?",
    "अस्पताल का रोज़ का कैश राइडर कितना है?", "क्या मैं बाद में पॉलिसी रिवाइव कर सकता हूँ?", "प्रीमियम पर टैक्स में छूट मिलती है क्या?",
    "नाबालिग नॉमिनी के लिए क्या करना होता है?", "इस फॉर्म में आधार नंबर क्यों माँगा जा रहा है?", "अगर मैं पेमेंट भूल जाऊँ तो क्या होगा?",
    "मेरी उम्र के हिसाब से प्रीमियम कितना बनेगा?", "क्लेम कैसे किया जाता है?", "धन्यवाद, आप क्या कर सकते हैं?", "मुझे अगला सवाल बताइए।",
]
MARATHI_QUESTIONS = [
    "मासिक प्रीमियमसाठी ग्रेस पीरियड किती असतो?", "फ्री लुक पीरियड म्हणजे काय?", "क्रिटिकल इलनेस रायडरमध्ये काय कव्हर होते?",
    "नॉमिनी कोण होऊ शकतो?", "सेक्शन ४५ चा अर्थ काय आहे?", "आत्महत्येची क्लॉज किती महिन्यांची असते?", "मला किती कव्हर घ्यावे?",
    "पॉलिसी लॅप्स झाली तर काय होते?", "माझ्या वार्षिक उत्पन्नाचा काय परिणाम होतो?", "तंबाखू न घेतल्यास सूट किती मिळते?",
    "रुग्णालयातील दैनिक रोख रायडर किती आहे?", "मी नंतर पॉलिसी पुन्हा सुरू करू शकतो का?", "प्रीमियमवर कर सवलत मिळते का?",
    "अल्पवयीन नॉमिनीसाठी काय करावे लागते?", "या फॉर्ममध्ये आधार क्रमांक का विचारला जात आहे?", "मी पेमेंट विसरलो तर काय होईल?",
    "माझ्या वयानुसार प्रीमियम किती येईल?", "क्लेम कसा करायचा?", "धन्यवाद, तुम्ही काय करू शकता?", "मला पुढचा प्रश्न सांगा.",
]


def test_every_test_question_is_recognised_on_an_english_screen():
    wrong = [q for q in HINDI_QUESTIONS if expected_reply_language("en", q) != "hi"]
    wrong += [q for q in MARATHI_QUESTIONS if expected_reply_language("en", q) != "mr"]
    assert wrong == []


def test_every_test_question_keeps_its_own_screen_language():
    assert [q for q in HINDI_QUESTIONS if expected_reply_language("hi", q) != "hi"] == []
    assert [q for q in MARATHI_QUESTIONS if expected_reply_language("mr", q) != "mr"] == []
