// Which SAM concept words find a card on a blurred copy of a photo of it? One blurred copy per image, several words.
//   cd omni_browse && node ../tools/id-cards/sam-concepts.mjs ../tools/id-cards/out/pn-phone.jpg 60 "ID card" "card" ...
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = require('@playwright/test');
const { parseImageStream, recordsOfKind } = await import(require.resolve('@meta-sam/parser'));

const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const get = (k) => {
  const m = new RegExp(`^${k}=(?:"([^"]*)"|'([^']*)'|(\\S*))`, 'm').exec(env);
  return m ? m[1] ?? m[2] ?? m[3] ?? '' : '';
};
const [file, width, ...concepts] = process.argv.slice(2);
const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
const src = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const blurred = await page.evaluate(
  async ([src, w]) => {
    const img = await new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.src = src;
    });
    const scale = Math.min(1, 1000 / img.naturalWidth);
    const W = Math.round(img.naturalWidth * scale);
    const H = Math.round(img.naturalHeight * scale);
    const small = document.createElement('canvas');
    small.width = Number(w);
    small.height = Math.round((Number(w) * H) / W);
    small.getContext('2d').drawImage(img, 0, 0, small.width, small.height);
    const big = document.createElement('canvas');
    big.width = W;
    big.height = H;
    const ctx = big.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    return big.toDataURL('image/png');
  },
  [src, width],
);
await browser.close();

async function* sse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const p = line.slice(5).trim();
      if (p === '[DONE]') return;
      try {
        yield JSON.parse(p);
      } catch {}
    }
  }
}

const base = (get('META_MODEL_BASE_URL') || 'https://api.meta.ai/v1').replace(/\/$/, '');
for (const concept of concepts) {
  const res = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${get('META_MODEL_API_KEY')}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model: get('META_MODEL_SAM3') || 'sam-3.1',
      stream: true,
      metadata: { mask_encoding: 'one_bit', include_confidence: 'true' },
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: concept }, { type: 'input_image', image_url: blurred }] }],
    }),
  });
  if (!res.ok) {
    console.log(concept, '-> HTTP', res.status);
    continue;
  }
  const result = await parseImageStream(sse(res)).finalResult;
  const boxes = recordsOfKind(result.records, 'box').map((b) => `${Math.round(b.left)},${Math.round(b.top)}-${Math.round(b.right)},${Math.round(b.bottom)} c=${(b.confidence ?? 0).toFixed(2)}`);
  console.log(JSON.stringify(concept), '->', boxes.length ? boxes.join(' | ') : 'no boxes');
}
