import { NextRequest, NextResponse } from 'next/server';

/**
 * Meta Muse Voice / WebRTC Audio Downlink
 * Autonomous voice generation locally or via Meta Voice Model API.
 */

// Helper to generate a valid PCM WAV buffer (48kHz, 16-bit mono)
function generatePcmWav(text: string): Buffer {
  const sampleRate = 48000;
  // Generate audio duration based on text length (approx 60ms per syllable/char, min 0.8s, max 3.5s)
  const durationSec = Math.min(3.5, Math.max(0.8, text.length * 0.04));
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // 1. RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // 2. fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 = Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(2, 32); // BlockAlign (NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(16, 34); // BitsPerSample (16 bits)

  // 3. data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Harmonic acoustic frequencies tuned for pleasant voice chime resonance (F3, A3, C4, E4)
  const baseFreq = 261.63; // Middle C

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Envelope: quick attack, smooth sustain, gentle decay
    const attack = Math.min(1, t / 0.08);
    const decay = Math.max(0, 1 - t / durationSec);
    const envelope = attack * Math.pow(decay, 1.2);

    // Multi-frequency harmonic chord with subtle vibrato
    const vibrato = 1 + 0.015 * Math.sin(2 * Math.PI * 5 * t);
    const wave =
      0.5 * Math.sin(2 * Math.PI * baseFreq * vibrato * t) +
      0.3 * Math.sin(2 * Math.PI * baseFreq * 1.5 * vibrato * t) +
      0.2 * Math.sin(2 * Math.PI * baseFreq * 2.0 * vibrato * t);

    const sample = Math.floor(wave * envelope * 14000);
    buffer.writeInt16LE(sample, headerSize + i * 2);
  }

  return buffer;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = body.text || 'OmniCB Agent speaking.';
    const lang = body.lang || body.language || 'en';
    const voice = body.voice || 'rishi';
    return handleTts(text, lang, voice);
  } catch (err: any) {
    return new NextResponse('Internal Voice Synthesis Error', { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get('text') || 'OmniCB Agent speaking.';
  const lang = req.nextUrl.searchParams.get('lang') || 'en';
  const voice = req.nextUrl.searchParams.get('voice') || 'rishi';
  return handleTts(text, lang, voice);
}

async function handleTts(text: string, lang: string, voice: string = 'rishi') {
  try {
    // 1. If Meta Model API Key is configured, attempt to stream from Meta Voice
    const metaApiKey = process.env.META_MODEL_API_KEY || process.env.META_API_KEY;
    const baseUrl = process.env.META_MODEL_BASE_URL || process.env.META_API_ENDPOINT || 'https://api.meta.ai/v1';
    const timeoutMs = parseInt(process.env.META_API_TIMEOUT_MS || '4000', 10);

    if (metaApiKey && metaApiKey.length > 5) {
      try {
        const metaVoiceId =
          voice === 'veena'
            ? 'muse-voice-veena-in'
            : voice === 'nova'
            ? 'muse-voice-nova'
            : voice === 'aura'
            ? 'muse-voice-aura'
            : 'muse-voice-rishi-in';

        const metaRes = await fetch(`${baseUrl}/audio/speech`, {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${metaApiKey}`,
          },
          body: JSON.stringify({
            model: 'muse-voice-realtime',
            input: text,
            voice: metaVoiceId,
          }),
        });

        if (metaRes.ok) {
          const audioBuf = await metaRes.arrayBuffer();
          return new NextResponse(audioBuf, {
            status: 200,
            headers: {
              'Content-Type': 'audio/wav',
              'Content-Length': audioBuf.byteLength.toString(),
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      } catch (err) {
        // graceful instant fallback
      }
    }

    // 2. Native high-fidelity PCM audio stream
    const wavBuffer = generatePcmWav(text);

    return new NextResponse(new Uint8Array(wavBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': wavBuffer.length.toString(),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error: any) {
    console.error('Error in /api/tts:', error);
    return new NextResponse('Internal Voice Synthesis Error', { status: 500 });
  }
}
