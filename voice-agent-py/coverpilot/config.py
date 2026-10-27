"""Environment configuration.

Reads voice-agent-py/.env first, then falls back to ../omni_browse/.env.local so the
Python service shares the same Meta and Google keys as the Next.js app.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_HERE = Path(__file__).resolve().parent.parent
load_dotenv(_HERE / ".env", override=False)
load_dotenv(_HERE.parent / "omni_browse" / ".env.local", override=False)


@dataclass(frozen=True)
class Settings:
    meta_api_key: str
    meta_base_url: str
    meta_asr_url: str
    spark_model: str
    transcribe_model: str
    wonder_model: str
    reasoning_effort: str
    google_tts_api_key: str

    @staticmethod
    def load() -> "Settings":
        key = os.getenv("META_MODEL_API_KEY") or os.getenv("META_API_KEY") or ""
        if len(key) < 6:
            raise RuntimeError("META_MODEL_API_KEY is not configured")
        return Settings(
            meta_api_key=key,
            meta_base_url=(os.getenv("META_MODEL_BASE_URL") or "https://api.meta.ai/v1").rstrip("/"),
            meta_asr_url=os.getenv("META_ASR_REALTIME_URL") or "wss://api.meta.ai/v1/asr/realtime",
            spark_model=os.getenv("META_MODEL_SPARK") or os.getenv("META_MODEL_NAME") or "muse-spark-1.3",
            transcribe_model=os.getenv("META_MODEL_VOICE_TRANSCRIBE") or "muse-voice-transcribe-1.0",
            wonder_model=os.getenv("META_MODEL_WONDER") or "muse-wonder-1.0",
            reasoning_effort=os.getenv("META_REASONING_EFFORT") or "low",
            google_tts_api_key=os.getenv("GOOGLE_TTS_API_KEY") or "",
        )
