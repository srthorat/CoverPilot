"""Is a reply in the language the customer chose? A cheap, offline check used to keep Hindi and Marathi answers in
Devanagari and in the right one of the two. Hindi and Marathi share the script, so a few common words that only one of
them uses tell them apart. Mirrors omni_browse/src/lib/script-check.ts (the browser tests use that copy)."""

from __future__ import annotations

import re

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_LATIN = re.compile(r"[A-Za-z]")

# Product words and names that stay in English letters in a Hindi or Marathi answer.
_KEEP_ENGLISH = re.compile(
    r"\b(rider|riders|premium|free[- ]?look|section|irdai|nexasure|omnicb|mwpa|pan|aadhaar|kyc|nominee|appointee|ok|"
    r"guardian|integrity|ci|atpd|upi|otp|pin|gst|uin)\b",
    re.IGNORECASE,
)

_HINDI_WORDS = {
    "है", "हैं", "आप", "आपका", "आपकी", "आपके", "नहीं", "सकते", "सकता", "सकती", "और", "यह", "लिए", "करें", "कीजिए",
    "होगा", "होगी", "हूँ", "हूं", "मैं", "था", "थी",
}
_MARATHI_WORDS = {
    "आहे", "आहेत", "आणि", "तुम्ही", "तुमचा", "तुमची", "तुमचे", "तुमच्या", "नाही", "शकता", "मध्ये", "साठी", "करा",
    "होईल", "मी", "होते", "तुम्हाला", "आपल्या", "आपण",
}
_SPLIT = re.compile(r"[\s,.!?;:()\"'।|/-]+")

# Too short to judge ("Sure." or a bare number); never retried.
MIN_LETTERS = 12

# Spoken Hindi and Marathi mix in English nouns on purpose ("hospital cash rider details अभी निकाल रहा हूँ" is about 45%
# Devanagari), so the line is drawn well below that: an English sentence is 0%, and a few English words are not a failure.
MIN_SHARE = 0.35

REMINDER = {
    "hi": (
        "[Reply language for this answer: Hindi in Devanagari script, even though the knowledge notes above are in English. "
        "Do not answer in English or Marathi; only product words such as rider, premium and free look stay in English letters. "
        "Keep the same length limit.]"
    ),
    "mr": (
        "[Reply language for this answer: Marathi in Devanagari script, even though the knowledge notes above are in English. "
        "Do not answer in English or Hindi; only product words such as rider, premium and free look stay in English letters. "
        "Keep the same length limit.]"
    ),
}

RETRY_REMINDER = {
    "hi": "[Your previous draft was not in Hindi. Answer again, entirely in Hindi in Devanagari script.]",
    "mr": "[Your previous draft was not in Marathi. Answer again, entirely in Marathi in Devanagari script.]",
}


def devanagari_share(text: str) -> float:
    cleaned = _KEEP_ENGLISH.sub(" ", text)
    dev = len(_DEVANAGARI.findall(cleaned))
    lat = len(_LATIN.findall(cleaned))
    return 0.0 if dev + lat == 0 else dev / (dev + lat)


def marker_counts(text: str) -> tuple[int, int]:
    """(Hindi marker words, Marathi marker words) found in the text."""
    hi = mr = 0
    for token in _SPLIT.split(text):
        if token in _HINDI_WORDS:
            hi += 1
        if token in _MARATHI_WORDS:
            mr += 1
    return hi, mr


def guess_language(text: str) -> str:
    """'hi', 'mr' or 'unknown' from words only one of the two languages uses."""
    hi, mr = marker_counts(text)
    if hi == mr:
        return "unknown"
    return "hi" if hi > mr else "mr"


def check_reply(text: str, expected: str) -> tuple[bool, str]:
    """(ok, why). A reply passes when it is mostly Devanagari and the other language's words do not outnumber the expected one's."""
    t = text.strip()
    letters = len(_DEVANAGARI.findall(t)) + len(_LATIN.findall(t))
    if letters < MIN_LETTERS:
        return True, "too short to judge"
    share = devanagari_share(t)
    if share < MIN_SHARE:
        return False, f"script {round(share * 100)}% Devanagari"
    guess = guess_language(t)
    if guess not in ("unknown", expected):
        return False, f"wrong language ({guess})"
    return True, "ok"


def expected_reply_language(screen_lang: str, user_text: str) -> str | None:
    """Which Indian language the answer must be in, or None when no check applies.

    The screen language decides (Hindi or Marathi). A customer whose Devanagari clearly is the other one (two or more
    of its marker words, and more than the screen language's) gets the other one. Devanagari on an English screen is
    answered in the language it is in (Hindi when unclear). English text on an English screen has no requirement."""
    hi, mr = marker_counts(user_text)
    if screen_lang in ("hi", "mr"):
        other, own, other_n, own_n = ("mr", "hi", mr, hi) if screen_lang == "hi" else ("hi", "mr", hi, mr)
        return other if other_n >= 2 and other_n > own_n else screen_lang
    if _DEVANAGARI.search(user_text):
        return "mr" if mr > hi else "hi"
    return None
