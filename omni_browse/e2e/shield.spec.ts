// Privacy shield on layouts other than the three bundled samples (own-file upload, PNG, JPEG and PDF).
//
//   SHIELD_TAG=baseline BASE_URL=http://localhost:3015 npx playwright test e2e/shield.spec.ts
//
// Needs an image built with NEXT_PUBLIC_ALLOW_OWN_FILES=true, the cards from support/tools/id-cards/build.mjs, and the
// Meta key in .env.local (a second, independent reading of every redacted image uses it; the key is never printed).
// Spends live model calls: roughly 13 per photo card, 5 per salary slip, plus one read per card. SHIELD_ONLY=a,b limits
// the cards. Writes support/tools/id-cards/results/<tag>.json and the redacted images next to it.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const CARDS = path.resolve(__dirname, '../../support/tools/id-cards/out');
const RESULTS = path.resolve(__dirname, '../../support/tools/id-cards/results');
const TAG = process.env.SHIELD_TAG || 'run';
const ONLY = (process.env.SHIELD_ONLY || '').split(',').filter(Boolean);

type Card = { file: string; name: string; type: 'pan' | 'aadhaar' | 'salary-slip'; id: string; kind: string };
const manifest: Card[] = fs.existsSync(path.join(CARDS, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(CARDS, 'manifest.json'), 'utf8')) : [];
const cards = manifest.filter((c) => !ONLY.length || ONLY.includes(c.name));

function envValue(key: string): string {
  const text = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
  const m = new RegExp(`^${key}=(?:"([^"]*)"|'([^']*)'|(\\S*))`, 'm').exec(text);
  return m ? m[1] ?? m[2] ?? m[3] ?? '' : '';
}

/** Independent reader: the app's own OCR framing (the one Spark answers; a bare "list the ID numbers" request is
 *  refused), with one change that makes it stricter as a test: partly readable values are returned with ? for the
 *  unreadable characters, so a partial leak is visible and not just a full one. */
const PARTIAL = ' If a value is only partly readable, give the characters you can read and write ? for each one you cannot.';
async function readIds(dataUrl: string, type: Card['type']): Promise<string[]> {
  const base = (envValue('META_MODEL_BASE_URL') || 'https://api.meta.ai/v1').replace(/\/$/, '');
  const system =
    type === 'salary-slip'
      ? 'You are an income-proof OCR engine. Read the salary slip image and return ONLY a JSON object with these keys: documentType ("salary-slip"), fullName (employee name), employerName, payPeriod, monthlyGross (gross monthly earnings, digits only), annualIncome, bankAccountNumber (digits only or null), uan (digits only or null), idNumber (PAN if printed, else null). Return null for anything not clearly readable; never guess.' + PARTIAL + ' Do not add commentary.'
      : 'You are a KYC document OCR engine. Read the identity document image and return ONLY a JSON object with these keys: documentType ("pan" or "aadhaar"), fullName, dob (DD/MM/YYYY), gender ("Male"/"Female"/null), idNumber (the PAN or Aadhaar number exactly as printed, digits/letters only), fatherName, address, pincode (6 digits or null). Parts of the image may be pixelated or blacked out for privacy: return null for any field you cannot read clearly and never guess or reconstruct redacted characters.' + PARTIAL + ' Do not add commentary.';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${envValue('META_MODEL_API_KEY')}` },
    body: JSON.stringify({
      model: envValue('META_MODEL_SPARK') || 'muse-spark-1.3',
      temperature: 0,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [{ type: 'text', text: `Extract the fields from this ${type === 'salary-slip' ? 'salary slip' : 'identity document'}.` }, { type: 'image_url', image_url: { url: dataUrl } }] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`reader HTTP ${res.status}`);
  const content: string = (await res.json()).choices?.[0]?.message?.content ?? '';
  const m = /\{[\s\S]*\}/.exec(content);
  try {
    const o = JSON.parse(m ? m[0] : '{}');
    return [o.idNumber, o.uan, o.bankAccountNumber].filter((v) => v !== null && v !== undefined).map(String);
  } catch {
    return [];
  }
}

/** Longest run of characters of `id` that appears, in order, in one of the strings read from the image. */
export function leakedRun(id: string, strings: string[]): number {
  const compact = strings.map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  let best = 0;
  for (let i = 0; i < id.length; i++)
    for (let j = i + best + 1; j <= id.length; j++) {
      const part = id.slice(i, j);
      if (compact.some((s) => s.includes(part))) best = part.length;
      else break;
    }
  return best;
}

async function openUpload(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: /Start a new policy/ }).click();
  await expect(page.getByLabel('Document type')).toBeVisible({ timeout: 30_000 });
}

// No model calls: these PDFs are refused in the browser, so no request to the shield routes may be made.
for (const edge of [
  { file: 'edge-password.pdf', say: /password-protected/ },
  { file: 'edge-two-pages.pdf', say: /more than one page/ },
]) {
  test(`edge: ${edge.file} is refused with a clear message and nothing is sent`, async ({ page }) => {
    test.skip(!fs.existsSync(path.join(CARDS, edge.file)), 'run support/tools/id-cards/make-edge-pdfs.py first');
    const sent: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/(sam|locate-ids|ocr)/.test(r.url())) sent.push(r.url());
    });
    await openUpload(page);
    await page.locator('input[type=file][accept*="pdf"]').setInputFiles(path.join(CARDS, edge.file));
    await expect(page.getByText(edge.say).first()).toBeVisible({ timeout: 30_000 });
    expect(sent).toEqual([]);
  });
}

test.describe.configure({ mode: 'serial' });
const rows: Array<Record<string, unknown>> = [];

// Positive control: on the original, unredacted images the independent reader must find the numbers, otherwise a
// "clean" verdict on a redacted image would mean nothing.
test('control: the reader finds the numbers on unredacted cards', async () => {
  test.setTimeout(120_000);
  for (const name of ['ad-bilingual', 'pn-new-qr', 'sl-table']) {
    const card = manifest.find((c) => c.name === name);
    if (!card) continue;
    const url = `data:image/png;base64,${fs.readFileSync(path.join(CARDS, card.file)).toString('base64')}`;
    const run = leakedRun(card.id.toUpperCase(), await readIds(url, card.type));
    console.log('SHIELD-CONTROL', name, 'run', run, 'of', card.id.length);
    expect(run, `${name}: the reader should read the unredacted number`).toBeGreaterThanOrEqual(card.id.length);
  }
});

// The bundled samples are the demo path: the changes above must not make them worse. Each is scanned twice with the
// sample buttons; the redacted image must read clean and the scan must complete (a refusal here would be a regression).
const SAMPLES: Array<{ button: string; type: Card['type']; ids: string[] }> = [
  { button: 'Masked Aadhaar', type: 'aadhaar', ids: ['432187659012'] },
  { button: 'Sample PAN Card', type: 'pan', ids: ['ABCPS1234K'] },
  { button: 'Salary Slip', type: 'salary-slip', ids: ['100987654321', 'ABCPS1234K', '002301548790'] },
];
for (const sample of SAMPLES) {
  for (const run of [1, 2]) {
    test(`sample: ${sample.button} #${run}`, async ({ page }) => {
      test.setTimeout(240_000);
      await openUpload(page);
      await page.getByRole('button', { name: sample.button, exact: true }).click();
      const header = page.getByRole('button', { name: /Privacy shield/ });
      await expect(header).toContainText(/Done|Warning|Failed/, { timeout: 200_000 });
      const status = ((await header.textContent()) || '').replace(/\s+/g, ' ').trim();
      const src = (await page.getByAltText('Redacted document sent to OCR').getAttribute('src')) || '';
      const strings = await readIds(src, sample.type);
      const runs = sample.ids.map((id) => leakedRun(id, strings));
      const verdict = sample.ids.some((id, i) => runs[i] >= id.length) ? 'LEAK (full)' : Math.max(...runs) >= 5 ? 'LEAK (partial)' : 'clean';
      const row = { card: `sample ${sample.button} #${run}`, type: sample.type, kind: 'bundled sample', status, verdict, run: Math.max(...runs), regions: [] as string[] };
      console.log('SHIELD', JSON.stringify(row));
      rows.push(row);
      expect(status, 'the sample scan must complete').toMatch(/Done/);
      expect(verdict).toBe('clean');
    });
  }
}

for (const card of cards) {
  test(`shield: ${card.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    const shieldLogs: string[] = [];
    page.on('console', (m) => {
      if (m.text().startsWith('[shield]')) shieldLogs.push(m.text());
    });
    await openUpload(page);
    await page.getByLabel('Document type').selectOption(card.type);
    await page.locator('input[type=file][accept*="pdf"]').setInputFiles(path.join(CARDS, card.file));
    const header = page.getByRole('button', { name: /Privacy shield/ });
    const row: Record<string, unknown> = { card: card.name, type: card.type, kind: card.kind };
    try {
      await expect(header).toContainText(/Done|Warning|Failed/, { timeout: 200_000 });
    } catch {
      /* no status within the time: recorded below as it stands */
    }
    row.status = ((await header.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const concepts = await page.locator('svg text').allTextContents().catch(() => []);
    row.regions = [...new Set(concepts.map((t) => t.trim()).filter(Boolean))];
    const img = page.getByAltText('Redacted document sent to OCR');
    if (await img.count()) {
      const src = (await img.getAttribute('src')) || '';
      if (src.startsWith('data:image')) {
        fs.mkdirSync(RESULTS, { recursive: true });
        fs.writeFileSync(path.join(RESULTS, `${TAG}-${card.name}-redacted.png`), Buffer.from(src.split(',')[1], 'base64'));
        const strings = await readIds(src, card.type);
        // A salary slip carries three numbers (PAN, UAN, bank account); the others carry one.
        const ids = card.type === 'salary-slip' ? [card.id, 'BKQPN7392R', '431002987654'] : [card.id];
        const runs = ids.map((id) => leakedRun(id.toUpperCase(), strings));
        const full = ids.some((id, i) => runs[i] >= id.length);
        row.run = Math.max(...runs);
        row.verdict = full ? 'LEAK (full)' : (row.run as number) >= 5 ? 'LEAK (partial)' : 'clean';
        row.read = strings.length; // how many strings the reader produced (the strings themselves are not kept)
      }
    }
    if (!row.verdict) row.verdict = /Failed/.test(String(row.status)) ? 'refused (only blurred copies were sent)' : 'no image';
    if (shieldLogs.length) row.log = shieldLogs[0].slice(0, 500);
    rows.push(row);
    console.log('SHIELD', JSON.stringify(row));
  });
}

test.afterAll(() => {
  if (!rows.length) return;
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `${TAG}.json`), JSON.stringify(rows, null, 2));
});
