"""Post-ASR term correction for domain-specific product names.

Meta Realtime Transcribe has no custom vocabulary, so common mishears of
NexaSure product terms are corrected here before the text reaches Spark.
Corrections are simple whole-word case-insensitive replacements.
"""

from __future__ import annotations

import re

_CORRECTIONS: list[tuple[re.Pattern[str], str]] = [
    # Rider names
    (re.compile(r"\bhospitality\s+daily\s+cash\b", re.I), "hospital daily cash"),
    (re.compile(r"\bhospital\s+daily\s+cost\b", re.I), "hospital daily cash"),
    (re.compile(r"\bhospital\s+daily\s+catch\b", re.I), "hospital daily cash"),
    (re.compile(r"\bcritical\s+illness\s+cover\b", re.I), "critical illness rider"),
    (re.compile(r"\bwaiver\s+of\s+premium\s+rider\b", re.I), "waiver of premium"),
    (re.compile(r"\baccidental\s+death\s+cover\b", re.I), "accidental death rider"),
    # Policy terms
    (re.compile(r"\bfree\s+look\s+period\b", re.I), "free look period"),
    (re.compile(r"\bsection\s+45\b", re.I), "Section 45"),
    (re.compile(r"\birdai\b", re.I), "IRDAI"),
    (re.compile(r"\bnex(?:a|us|o)\s*(?:sure|shore|sher)\b", re.I), "NexaSure"),
    (re.compile(r"\bflexible\s+shield\b", re.I), "Flexi Shield"),
    (re.compile(r"\bflexy\s+shield\b", re.I), "Flexi Shield"),
    # Marathi: the recogniser wrote रोक (stop) or रोग (disease) for रोख (cash) before the word रायडर, heard on spoken tests
    (re.compile(r"(?<![\u0900-\u097F])(?:रोक|रोग)(?=\s+रायडर)"), "रोख"),
    # Amount misreads
    (re.compile(r"\bone\s+and\s+a\s+half\s+crore\b", re.I), "one and a half crore"),
    (re.compile(r"\bone\s+half\s+crore\b", re.I), "one and a half crore"),
    (re.compile(r"\b1\.5\s+crore\b", re.I), "one and a half crore"),
]


def correct(text: str) -> str:
    for pattern, replacement in _CORRECTIONS:
        text = pattern.sub(replacement, text)
    return text
