import { NextRequest } from 'next/server';
import { guard, LIMITS, readJsonLimited } from '@/lib/rate-limit';
// Plain JS module shared with the custom server (server/google-tts.mjs)
import { synthesizePcm, pcmToWav, PERSONAS, ACCENTS } from '../../../../server/google-tts.mjs';

/**
 * Google Cloud Text-to-Speech over HTTP, used only before the voice-agent
 * session exists (for example the "test audio" button). Once the session is
 * open, speech travels over the agent WebSocket as PCM frames instead.
 */
export async function POST(req: NextRequest) {
  const limited = guard(req, LIMITS.tts);
  if (limited) return limited;
  const read = await readJsonLimited(req, LIMITS.tts.maxBodyBytes, {});
  if (!read.ok) return read.response;
  const body = read.body ?? {};
  const text = String(body.text || '').trim().slice(0, 1200);
  const lang = ['en', 'hi', 'mr'].includes(body.lang) ? body.lang : 'en';
  const persona = PERSONAS.includes(body.persona) ? body.persona : 'veena';
  const accent = ACCENTS.includes(body.accent) ? body.accent : 'in';
  if (!text) return Response.json({ error: 'text is required' }, { status: 400 });
  try {
    const t0 = Date.now();
    const { pcm, sampleRate, voice, cached } = await synthesizePcm(text, { persona, lang, accent });
    const wav = pcmToWav(pcm, sampleRate);
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'no-store',
        'X-TTS-Voice': voice,
        'X-TTS-Ms': String(Date.now() - t0),
        'X-TTS-Cached': cached ? '1' : '0',
      },
    });
  } catch (err: any) {
    console.error('[tts]', err?.message || err);
    return Response.json({ error: `Google TTS failed: ${err?.message || err}` }, { status: 502 });
  }
}
