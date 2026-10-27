// Google Cloud Text-to-Speech for spoken output.
//
// The Meta Model API has no text-to-speech model, so this is the one non-Meta
// model in the voice loop. Indian-English Chirp 3 HD voices back the four
// personas; Hindi strings use the matching hi-IN voice. Output is 24 kHz
// PCM16, the same rate the rest of the pipeline uses. Results are cached per
// voice+text so repeated guidance lines are instant.

const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const SAMPLE_RATE = 24000;
const CACHE_MAX = 600;

// persona -> Chirp 3 HD voice (female: veena, nova; male: rishi, aura)
const PERSONA_VOICE = {
  veena: 'Chirp3-HD-Aoede',
  rishi: 'Chirp3-HD-Charon',
  nova: 'Chirp3-HD-Kore',
  aura: 'Chirp3-HD-Puck',
};
// Same Chirp 3 HD voice family exists for all four locales, with the same genders.
const LANG_CODE = { hi: 'hi-IN', mr: 'mr-IN' };
export const ACCENTS = ['in', 'us'];

export const PERSONAS = Object.keys(PERSONA_VOICE);

/** @param accent 'in' (Indian English) or 'us' (American English); only matters when lang is 'en'. */
export function voiceFor(persona = 'veena', lang = 'en', accent = 'in') {
  const languageCode = lang === 'en' ? (accent === 'us' ? 'en-US' : 'en-IN') : LANG_CODE[lang] || 'en-IN';
  const suffix = PERSONA_VOICE[persona] || PERSONA_VOICE.veena;
  return { languageCode, name: `${languageCode}-${suffix}` };
}

export function ttsConfigured() {
  return Boolean(process.env.GOOGLE_TTS_API_KEY);
}

const cache = new Map();

function stripWavHeader(wav) {
  // LINEAR16 from Google comes in a RIFF/WAVE container; find the "data" chunk.
  if (wav.length >= 12 && wav.toString('ascii', 0, 4) === 'RIFF') {
    let off = 12;
    while (off + 8 <= wav.length) {
      const id = wav.toString('ascii', off, off + 4);
      const size = wav.readUInt32LE(off + 4);
      if (id === 'data') return wav.subarray(off + 8, off + 8 + size);
      off += 8 + size + (size % 2);
    }
  }
  return wav;
}

export function pcmToWav(pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Synthesize one sentence. Returns { pcm, sampleRate, ms, voice, cached }. */
export async function synthesizePcm(text, { persona = 'veena', lang = 'en', accent = 'in', signal } = {}) {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error('GOOGLE_TTS_API_KEY is not configured');
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('empty text');
  const voice = voiceFor(persona, lang, accent);
  const cacheKey = `${voice.name}|${clean}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    cache.delete(cacheKey);
    cache.set(cacheKey, hit); // LRU touch
    return { ...hit, voice: voice.name, cached: true };
  }
  const t0 = Date.now();
  const res = await fetch(`${TTS_URL}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    signal: signal ?? AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: clean },
      voice,
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE },
    }),
  });
  if (!res.ok) {
    console.error(`[google-tts] HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    throw new Error(`Google TTS request failed (HTTP ${res.status})`);
  }
  const json = await res.json();
  if (!json.audioContent) throw new Error('Google TTS returned no audio');
  const pcm = stripWavHeader(Buffer.from(json.audioContent, 'base64'));
  const out = { pcm, sampleRate: SAMPLE_RATE, ms: Date.now() - t0 };
  cache.set(cacheKey, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return { ...out, voice: voice.name, cached: false };
}
