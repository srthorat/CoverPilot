// Concurrent Integrity Guardian reviews of the planted-issues sample, at 1, 3 and 6 at once.
// Needs pdftotext (poppler). Uses the live review model (GUARDIAN_PROVIDER in the container's .env.local), so each
// review is one real model call: LEVELS=1,3,6 is 10 calls. The route allows 6 a minute per client address, so the
// script waits for the bucket to refill between levels instead of reading a 429 as a failure.
//
//   BASE_URL=http://localhost:3014 LEVELS=1,3,6 node scripts/loadtest/guardian_load.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://localhost:3014';
const LEVELS = (process.env.LEVELS || '1,3,6').split(',').map(Number);
const PER_MINUTE = 6;
const here = path.dirname(fileURLToPath(import.meta.url));
const pdf = path.resolve(here, '../../omni_browse/public/samples/sample-policy-with-issues.pdf');

const pages = [];
for (let p = 1; p <= 4; p++) {
  const text = execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), pdf, '-'], { encoding: 'utf8' }).trim();
  pages.push({ page: p, text });
}
const body = JSON.stringify({
  pages,
  proposal: { sumAssured: '1.5cr', monthlyPremium: 1050, termYears: 30, riders: [], nomineeCount: 1, nomineesTotalShare: 100, anyMinorNominee: false, smoker: false },
});

async function review() {
  const t = performance.now();
  try {
    const res = await fetch(`${BASE}/api/guardian`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const text = await res.text();
    let sections = null;
    try {
      sections = JSON.parse(text)?.review?.sections?.length ?? null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, s: (performance.now() - t) / 1000, sections, error: res.ok ? null : text.slice(0, 120) };
  } catch (e) {
    return { status: 0, s: (performance.now() - t) / 1000, sections: null, error: String(e).slice(0, 120) };
  }
}

const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
let tokens = PER_MINUTE;
let last = Date.now();
const refill = () => {
  const now = Date.now();
  tokens = Math.min(PER_MINUTE, tokens + ((now - last) / 60000) * PER_MINUTE);
  last = now;
};

const out = [];
for (const n of LEVELS) {
  refill();
  while (tokens < n) {
    const wait = Math.ceil(((n - tokens) / PER_MINUTE) * 60) + 1;
    console.log(`  waiting ${wait}s for the per-minute limit to refill...`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    refill();
  }
  tokens -= n;
  const results = await Promise.all(Array.from({ length: n }, review));
  const ok = results.filter((r) => r.status === 200 && r.sections > 0);
  const lat = ok.map((r) => r.s);
  const row = { concurrent: n, ok: `${ok.length}/${n}`, statuses: [...new Set(results.map((r) => r.status))].join(','), p50_s: lat.length ? +pct(lat, 50).toFixed(1) : null, max_s: lat.length ? +Math.max(...lat).toFixed(1) : null, errors: [...new Set(results.filter((r) => r.error).map((r) => r.error))].slice(0, 2) };
  console.log(JSON.stringify(row));
  out.push(row);
}
process.exit(out.every((r) => r.ok.split('/')[0] === r.ok.split('/')[1]) ? 0 : 1);
