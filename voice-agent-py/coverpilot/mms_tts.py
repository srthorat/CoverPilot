"""Meta MMS text-to-speech over a local OpenAI-style endpoint, as a Pipecat TTS service (experimental).

Selected per session with ``ttsProvider: "meta-mms"``; Google Cloud TTS stays the default. The server
(``MMS_TTS_URL``, default http://host.docker.internal:8003) returns raw 16 kHz mono PCM for the whole
text at once (it does not stream), one voice per language (mms_eng, mms_hin, mms_mar), so the two
agents share a voice in this mode. There is no fallback: if the server is down the error is surfaced.
"""

from __future__ import annotations

import os

import aiohttp
from loguru import logger
from pipecat.audio.utils import create_stream_resampler

from .google_tts import GoogleRestTTSService

MMS_SAMPLE_RATE = 16000
_VOICE_BY_LANG = {"en": "mms_eng", "hi": "mms_hin", "mr": "mms_mar"}


class MetaMmsTTSService(GoogleRestTTSService):
    def __init__(self, *, base_url: str | None = None, language_code: str = "en-IN", sample_rate: int | None = None, **kwargs):
        super().__init__(api_key="unused", voice=self._voice(language_code), language_code=language_code, sample_rate=sample_rate, **kwargs)
        self._url = (base_url or os.getenv("MMS_TTS_URL") or "http://host.docker.internal:8003").rstrip("/") + "/v1/audio/speech"
        self._resampler = create_stream_resampler()

    @staticmethod
    def _voice(language_code: str) -> str:
        return _VOICE_BY_LANG.get(language_code.split("-")[0].lower(), "mms_eng")

    def set_voice(self, language_code: str, voice: str) -> None:  # the persona voice name is Google's; MMS picks by language
        super().set_voice(language_code, self._voice(language_code))
        logger.info(f"Meta MMS voice -> {self.voice}")

    async def _synthesize(self, text: str) -> bytes:
        key = (self.voice, text)
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            return hit
        if not self._session:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60))
        async with self._session.post(self._url, json={"input": text, "voice": self.voice}) as res:
            if res.status != 200:
                logger.error(f"[meta-mms] HTTP {res.status}: {(await res.text())[:200]}")
                raise RuntimeError(f"Meta MMS TTS request failed (HTTP {res.status})")
            raw = await res.read()
        pcm = await self._resampler.resample(raw, MMS_SAMPLE_RATE, self.sample_rate) if self.sample_rate != MMS_SAMPLE_RATE else raw
        self._cache[key] = pcm
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return pcm
