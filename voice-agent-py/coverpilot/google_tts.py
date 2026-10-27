"""Google Cloud Text-to-Speech over REST with an API key, as a Pipecat TTS service.

The Meta Model API has no text-to-speech model, so this is the one non-Meta
model in the loop. Chirp 3 HD voices, LINEAR16 at the pipeline's output rate.
Results are cached per (voice, text) so repeated guidance lines are instant.
"""

from __future__ import annotations

import base64
from collections import OrderedDict
from collections.abc import AsyncGenerator

import aiohttp
from loguru import logger
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    ErrorFrame,
    Frame,
    StartFrame,
    TTSAudioRawFrame,
)
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService

_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"


def _strip_wav(wav: bytes) -> bytes:
    if len(wav) >= 12 and wav[:4] == b"RIFF":
        off = 12
        while off + 8 <= len(wav):
            cid = wav[off : off + 4]
            size = int.from_bytes(wav[off + 4 : off + 8], "little")
            if cid == b"data":
                return wav[off + 8 : off + 8 + size]
            off += 8 + size + (size % 2)
    return wav


class GoogleRestTTSService(TTSService):
    def __init__(
        self,
        *,
        api_key: str,
        voice: str = "en-IN-Chirp3-HD-Aoede",
        language_code: str = "en-IN",
        sample_rate: int | None = None,
        cache_size: int = 400,
        **kwargs,
    ):
        super().__init__(
            sample_rate=sample_rate,
            push_start_frame=True,  # base class opens the audio context + TTSStartedFrame
            push_stop_frames=True,
            settings=TTSSettings(model=None, voice=voice, language=language_code),
            **kwargs,
        )
        if not api_key:
            raise ValueError("GOOGLE_TTS_API_KEY is not configured")
        self._api_key = api_key
        self.voice = voice
        self.language_code = language_code
        self._session: aiohttp.ClientSession | None = None
        self._cache: OrderedDict[tuple[str, str], bytes] = OrderedDict()
        self._cache_size = cache_size

    def can_generate_metrics(self) -> bool:
        return True

    def set_voice(self, language_code: str, voice: str) -> None:
        self.language_code = language_code
        self.voice = voice
        self._settings.voice = voice
        self._settings.language = language_code
        logger.info(f"Google TTS voice -> {voice}")

    async def start(self, frame: StartFrame):
        await super().start(frame)
        if not self._session:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))

    async def stop(self, frame: EndFrame):
        await super().stop(frame)
        await self._close()

    async def cancel(self, frame: CancelFrame):
        await super().cancel(frame)
        await self._close()

    async def _close(self):
        if self._session:
            await self._session.close()
            self._session = None

    async def _synthesize(self, text: str) -> bytes:
        key = (self.voice, text)
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            return hit
        if not self._session:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        body = {
            "input": {"text": text},
            "voice": {"languageCode": self.language_code, "name": self.voice},
            "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": self.sample_rate},
        }
        async with self._session.post(_TTS_URL, params={"key": self._api_key}, json=body) as res:
            if res.status != 200:
                detail = (await res.text())[:300]
                logger.error(f"[google-tts] HTTP {res.status}: {detail}")
                raise RuntimeError(f"Google TTS request failed (HTTP {res.status})")
            data = await res.json()
        pcm = _strip_wav(base64.b64decode(data["audioContent"]))
        self._cache[key] = pcm
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return pcm

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        logger.debug(f"[google-tts] synthesize ({self.voice} @ {self.sample_rate} Hz): {text!r}")
        try:
            await self.start_ttfb_metrics()
            pcm = await self._synthesize(text)
            await self.start_tts_usage_metrics(text)
            chunk_size = self.chunk_size
            first = True
            for i in range(0, len(pcm), chunk_size):
                chunk = pcm[i : i + chunk_size]
                if not chunk:
                    break
                if first:
                    await self.stop_ttfb_metrics()
                    first = False
                yield TTSAudioRawFrame(chunk, self.sample_rate, 1, context_id=context_id)
        except Exception as e:
            yield ErrorFrame(error=f"Google TTS error: {e}")
