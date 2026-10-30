import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { devanagariShare, checkReplyLanguage, type IndicLang } from '../src/lib/script-check';

// Hindi and Marathi SPOKEN to the agent. Each question is synthesised with Google Cloud Text-to-Speech (the key is in
// .env.local and never printed), written as a 16 kHz mono WAV with silence around it, and played into Chromium as the
// microphone. The audio goes through Muse Voice Transcribe, the agent and back as a reply. For every question this
// reports what the speech recogniser heard (word error against what was said) and whether the reply was in the
// right language. Synthetic speech is clearer than most people, so these numbers are a best case, not a field result.
// Run on its own: SPEECH_TAG=after npx playwright test e2e/speech-hi-mr.spec.ts   (Chromium only; 5 questions each).

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TAG = process.env.SPEECH_TAG || 'run';
const COUNT = Number(process.env.SPEECH_COUNT || 5);
const OUT = process.env.SPEECH_RESULTS || path.join(os.tmpdir(), `speech-results-${TAG}.json`);
const ASSETS = path.join(os.tmpdir(), 'coverpilot-speech-hi-mr');

const QUESTIONS: Record<IndicLang, { id: string; text: string }[]> = {
  hi: [
    { id: 'hi1', text: 'मासिक प्रीमियम के लिए ग्रेस पीरियड कितना होता है' },
    { id: 'hi2', text: 'फ्री लुक पीरियड क्या है' },
    { id: 'hi3', text: 'नॉमिनी कौन बन सकता है' },
    { id: 'hi4', text: 'पॉलिसी लैप्स हो जाए तो क्या होता है' },
    { id: 'hi5', text: 'अस्पताल का रोज़ का कैश राइडर कितना है' },
  ],
  mr: [
    { id: 'mr1', text: 'मासिक प्रीमियमसाठी ग्रेस पीरियड किती असतो' },
    { id: 'mr2', text: 'फ्री लुक पीरियड म्हणजे काय' },
    { id: 'mr3', text: 'नॉमिनी कोण होऊ शकतो' },
    { id: 'mr4', text: 'पॉलिसी लॅप्स झाली तर काय होते' },
    { id: 'mr5', text: 'रुग्णालयातील दैनिक रोख रायडर किती आहे' },
  ],
};

const CODE: Record<IndicLang, string> = { hi: 'hi-IN', mr: 'mr-IN' };

function googleKey(): string {
  const env = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
  const m = env.match(/^GOOGLE_TTS_API_KEY=(?:"([^"]*)"|'([^']*)'|(\S+))/m);
  const key = m?.[1] || m?.[2] || m?.[3] || '';
  if (!key) throw new Error('GOOGLE_TTS_API_KEY is not set in omni_browse/.env.local');
  return key;
}

function wav16k(pcm: Buffer, leadSeconds: number, tailSeconds: number): Buffer {
  const lead = Buffer.alloc(Math.round(16000 * leadSeconds) * 2);
  const tail = Buffer.alloc(Math.round(16000 * tailSeconds) * 2);
  const data = Buffer.concat([lead, pcm, tail]);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function synthesize(text: string, lang: IndicLang, file: string) {
  if (fs.existsSync(file)) return;
  const voice = `${CODE[lang]}-Chirp3-HD-Charon`; // a male voice, so it is not the agent's own voice back at it
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { text }, voice: { languageCode: CODE[lang], name: voice }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 16000 } }),
  });
  if (!res.ok) throw new Error(`Google TTS failed (HTTP ${res.status})`);
  const body = (await res.json()) as { audioContent: string };
  const raw = Buffer.from(body.audioContent, 'base64');
  // Google returns a WAV: skip to the data chunk.
  let off = 12;
  let pcm = raw;
  while (off + 8 <= raw.length) {
    const id = raw.toString('ascii', off, off + 4);
    const size = raw.readUInt32LE(off + 4);
    if (id === 'data') {
      pcm = raw.subarray(off + 8, off + 8 + size);
      break;
    }
    off += 8 + size + (size % 2);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 2 s of silence before (the session connects meanwhile) and 14 s after: the browser loops the file, and the gap keeps
  // one question from being repeated while the answer is being read.
  fs.writeFileSync(file, wav16k(Buffer.from(pcm), 2, 14));
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[?।.,!]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Word error rate: word-level edit distance divided by the number of words said. */
function wer(said: string, heard: string): number {
  const a = words(said);
  const b = words(heard);
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return a.length ? d[a.length][b.length] / a.length : 0;
}

interface Row {
  id: string;
  lang: IndicLang;
  said: string;
  heard: string | null;
  wer: number | null;
  heardScriptShare: number | null;
  reply: string | null;
  replyOk: boolean;
  replyWhy: string;
}
const rows: Row[] = [];

for (const lang of ['hi', 'mr'] as const) {
  for (const q of QUESTIONS[lang].slice(0, COUNT)) {
    test(`SPEECH ${q.id}: ${lang === 'hi' ? 'Hindi' : 'Marathi'} spoken question is heard and answered in the same language`, async () => {
      test.setTimeout(240_000);
      const file = path.join(ASSETS, `${q.id}.wav`);
      await synthesize(q.text, lang, file);
      const browser = await chromium.launch({
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${file}`],
      });
      const ctx = await browser.newContext({ viewport: { width: 1512, height: 860 }, permissions: ['microphone'] });
      const page = await ctx.newPage();
      const row: Row = { id: q.id, lang, said: q.text, heard: null, wer: null, heardScriptShare: null, reply: null, replyOk: false, replyWhy: 'no reply' };
      rows.push(row);
      try {
        await page.goto(BASE);
        await page.evaluate(() => localStorage.clear());
        await page.goto(BASE);
        await page.getByRole('button', { name: /Start a new policy/ }).click();
        await page.getByRole('button', { name: lang === 'hi' ? 'हिंदी' : 'मराठी' }).click();
        await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
        await expect(page.getByText(/Live session connected/)).toBeVisible({ timeout: 60_000 });

        const transcripts = async () => [...(await page.evaluate(() => document.body.innerText)).matchAll(/You[^\n"]*"([^"\n]+)"/g)].map((m) => m[1]);
        const replies = async () => [...(await page.evaluate(() => document.body.innerText)).matchAll(/^OmniCB: (.+)$/gm)].map((m) => m[1]);
        const baseline = (await replies()).length;

        let heard: string[] = [];
        for (let i = 0; i < 90 && !heard.length; i++) {
          await page.waitForTimeout(1000);
          heard = await transcripts();
        }
        row.heard = heard[0] ?? null;
        if (row.heard) {
          row.wer = Math.round(wer(q.text, row.heard) * 100) / 100;
          row.heardScriptShare = Math.round(devanagariShare(row.heard) * 100) / 100;
        }

        let reply = '';
        let stable = 0;
        for (let i = 0; i < 70 && stable < 4; i++) {
          await page.waitForTimeout(1000);
          const now = (await replies()).slice(baseline)[0] || '';
          if (now && now === reply) stable++;
          else {
            reply = now;
            stable = 0;
          }
        }
        row.reply = reply || null;
        const check = reply ? checkReplyLanguage(reply, lang) : { ok: false, why: 'no reply' };
        row.replyOk = check.ok;
        row.replyWhy = check.why;
      } finally {
        fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
        console.log(`SPEECHROW ${TAG} ${q.id} WER=${row.wer} script=${row.heardScriptShare} reply=${row.replyOk ? 'ok' : 'MISS ' + row.replyWhy} heard="${row.heard ?? ''}"`);
        await browser.close();
      }
      expect(row.heard, 'the recogniser heard nothing').toBeTruthy();
      expect(row.heardScriptShare ?? 0, 'what was heard is in Devanagari').toBeGreaterThanOrEqual(0.6);
      expect(row.replyOk, `reply language: ${row.replyWhy}`).toBe(true);
    });
  }
}
