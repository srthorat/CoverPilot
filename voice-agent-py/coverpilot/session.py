"""Per-connection state shared by the processors."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

PERSONAS = ("veena", "rishi", "nova", "aura")
ACCENTS = ("in", "us")
LANGS = ("en", "hi", "mr")

# Same Chirp 3 HD voice family in every locale, with the same genders.
_PERSONA_VOICE = {
    "veena": "Chirp3-HD-Aoede",
    "rishi": "Chirp3-HD-Charon",
    "nova": "Chirp3-HD-Kore",
    "aura": "Chirp3-HD-Puck",
}
_LANG_CODE = {"hi": "hi-IN", "mr": "mr-IN"}
LANGUAGE_BIAS = {
    "en": ["English", "Hindi"],
    "hi": ["Hindi", "English"],
    "mr": ["Marathi", "Hindi", "English"],
}


def voice_for(persona: str, lang: str, accent: str) -> tuple[str, str]:
    """Return (language_code, voice_name) for Google Cloud TTS."""
    code = ("en-US" if accent == "us" else "en-IN") if lang == "en" else _LANG_CODE.get(lang, "en-IN")
    return code, f"{code}-{_PERSONA_VOICE.get(persona, _PERSONA_VOICE['veena'])}"


@dataclass
class SessionState:
    lang: str = "en"
    persona: str = "veena"
    accent: str = "in"
    screen_state: dict[str, Any] = field(default_factory=dict)
    screenshot_data_url: str | None = None
    screenshot_at: float = 0.0
    last_user_text: str = ""
    user_turns: list[str] = field(default_factory=list)  # last few user turns, oldest first
    customer_id: str | None = None
    memory_text: str = ""  # rendered CUSTOMER MEMORY block
    main_started: bool = False  # Spark started streaming the current answer
    turn_started_at: float = 0.0  # when the current user turn was handed to Spark
    turn_source: str = "voice"  # "voice" or "text" for the next user turn
    screenshot_chunks: dict[str, Any] = field(default_factory=dict)  # id -> {total, parts}
    last_kb_chunks: list[dict] = field(default_factory=list)  # [{label, score}] for current turn

    def set_screenshot(self, data_url: str) -> None:
        self.screenshot_data_url = data_url
        self.screenshot_at = time.time()

    def fresh_screenshot(self, max_age_s: float = 90.0) -> str | None:
        if self.screenshot_data_url and time.time() - self.screenshot_at < max_age_s:
            return self.screenshot_data_url
        return None
