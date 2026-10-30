// Checks the non-model routes under load: the page, /api/ice-servers, /api/vault, the size caps and the origin checks.
// No call here reaches a Meta model or Google. /api/ice-servers with a browser header mints a Cloudflare TURN
// credential, so that is limited to ICE_MINTS calls (default 3).
//
//   BASE_URL=http://localhost:3014 node scripts/loadtest/http_routes.mjs
//
// Prints one line per check and exits 1 if any check fails. A 5xx anywhere is a failure.
import { randomBytes } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3014';
const ICE_MINTS = Number(process.env.ICE_MINTS || 3);
const results = [];
let serverErrors = 0;

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newId = () => 'NXP-' + Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
const b64 = (n) => randomBytes(n).toString('base64');
const hex = (n) => randomBytes(n).toString('hex');

async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const t = performance.now();
  const res = await fetch(BASE + path, { method, headers, body });
  const text = await res.text();
  if (res.status >= 500) serverErrors++;
  return { status: res.status, ms: performance.now() - t, text, headers: res.headers };
}

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function burst(n, fn) {
  const out = await Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  return out;
}

function blob(id, extra = {}) {
  return { v: 1, id, salt: b64(16), iv: b64(12), ciphertext: b64(600), savedAt: Date.now(), step: 2, authVerifier: hex(32), ...extra };
}

// 1. The page under concurrency ------------------------------------------------------------------------------
for (const n of [20, 100]) {
  const t = performance.now();
  const rs = await burst(n, () => call('/'));
  const wall = performance.now() - t;
  const ok = rs.every((r) => r.status === 200);
  const lat = rs.map((r) => r.ms);
  check(`GET / x${n} concurrent all 200`, ok, `p50 ${pct(lat, 50).toFixed(0)} ms, p95 ${pct(lat, 95).toFixed(0)} ms, ${(n / (wall / 1000)).toFixed(0)} req/s`);
}

// 1b. The agent's capacity endpoint (through the web app's /voice-agent proxy) ------------------------------------
{
  const r = await call('/voice-agent/api/capacity');
  let body = {};
  try {
    body = JSON.parse(r.text);
  } catch {
    /* checked below */
  }
  check('capacity endpoint answers with the limit and whether the agent is busy', r.status === 200 && Number.isInteger(body.limit) && typeof body.busy === 'boolean', `${r.status} ${r.text.slice(0, 80)}`);
}

// 2. /api/ice-servers --------------------------------------------------------------------------------------------
{
  // A request without browser headers is served STUN only (no credential minted), and the bucket is 5 a minute.
  const rs = [];
  for (let i = 0; i < 8; i++) rs.push(await call('/api/ice-servers'));
  const statuses = rs.map((r) => r.status);
  check('ice-servers (no browser header): first 5 are 200 and mint nothing', statuses.slice(0, 5).every((s) => s === 200) && rs.slice(0, 5).every((r) => !/username/.test(r.text)), `statuses ${statuses.join(' ')}`);
  check('ice-servers: 6th to 8th request in a minute get 429', statuses.slice(5).every((s) => s === 429), '');
  check('ice-servers 429 carries Retry-After', Boolean(rs[7].headers.get('retry-after')));
}
{
  // Wait for the bucket to refill one token per 12 s is slow; use a distinct client key through X-Forwarded-For only if
  // TRUST_PROXY is on. Here: just check cross-site and origin handling, which do not use the bucket.
  const cross = await call('/api/ice-servers', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  check('ice-servers cross-site is 403', cross.status === 403, `got ${cross.status}`);
  const evil = await call('/api/ice-servers', { headers: { Origin: 'https://evil.example' } });
  check('ice-servers foreign Origin is 403', evil.status === 403, `got ${evil.status}`);
  const nul = await call('/api/ice-servers', { headers: { Origin: 'null' } });
  check('ice-servers Origin "null" is 403, not 500', nul.status === 403, `got ${nul.status}`);
}
if (ICE_MINTS > 0) {
  // Distinct callers: the limiter is per client key, so wait for a token (12 s) between browser-style calls.
  let minted = 0;
  let last = null;
  for (let i = 0; i < ICE_MINTS; i++) {
    for (let tries = 0; tries < 8; tries++) {
      last = await call('/api/ice-servers', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
      if (last.status !== 429) break;
      await new Promise((r) => setTimeout(r, 13_000));
    }
    if (last.status === 200 && /username/.test(last.text)) minted++;
  }
  check(`ice-servers (browser header): ${ICE_MINTS} calls minted a TURN credential`, minted === ICE_MINTS, `minted ${minted}, last status ${last?.status}`);
}

// 3. /api/vault --------------------------------------------------------------------------------------------------
// The vault has its own bucket (30 a minute per address), so the checks run in order and count their calls.
{
  const id = newId();
  const first = blob(id);
  const put = await call('/api/vault', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(first) });
  check('vault PUT valid blob -> 200 created', put.status === 200 && /created/.test(put.text), `got ${put.status}`);
  const get = await call(`/api/vault?id=${id}`);
  check('vault GET returns the blob without the auth verifier', get.status === 200 && !/authVerifier/.test(get.text) && /ciphertext/.test(get.text), `got ${get.status}`);
  const again = await call('/api/vault', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(blob(id)) });
  check('vault PUT over an existing code without the auth token -> 403', again.status === 403, `got ${again.status}`);
  const bad = await call('/api/vault', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  check('vault PUT invalid JSON -> 400', bad.status === 400, `got ${bad.status}`);
  const shape = await call('/api/vault', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...first, id: 'NXP-00000000' }) });
  check('vault PUT with an id outside the alphabet -> 400', shape.status === 400, `got ${shape.status}`);
  const big = await call('/api/vault', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(blob(newId(), { ciphertext: b64(300 * 1024) })) });
  check('vault PUT over the size cap -> 413', big.status === 413, `got ${big.status}`);
  const missing = await call(`/api/vault?id=${newId()}`);
  check('vault GET unknown code -> 404', missing.status === 404, `got ${missing.status}`);
  const junk = await call('/api/vault?id=../../etc/passwd');
  check('vault GET with a path in the id -> 404, not a file read', junk.status === 404, `got ${junk.status}`);
  const del = await call(`/api/vault?id=${id}`, { method: 'DELETE' });
  check('vault DELETE without the auth token -> 403', del.status === 403, `got ${del.status}`);
  // Spend the rest of the bucket, then expect 429.
  const flood = [];
  for (let i = 0; i < 30; i++) flood.push((await call(`/api/vault?id=${newId()}`)).status);
  check('vault: the bucket runs out and returns 429', flood.includes(429), `statuses ${[...new Set(flood)].join(',')}`);
}

// 4. Size caps on the model routes (rejected before any model call) ------------------------------------------------
{
  const mk = (n) => 'x'.repeat(n);
  const g = await call('/api/guardian', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mk(1_100_000) });
  check('guardian body over 1 MB -> 413', g.status === 413, `got ${g.status}`);
  const o = await call('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mk(12_100_000) });
  check('ocr body over 12 MB -> 413', o.status === 413, `got ${o.status}`);
  const t = await call('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mk(21_000) });
  check('tts body over 20 KB -> 413', t.status === 413, `got ${t.status}`);
  const s = await call('/api/sam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mk(12_100_000) });
  check('sam body over 12 MB -> 413', s.status === 413, `got ${s.status}`);
  const xs = await call('/api/guardian', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: '{}' });
  check('guardian cross-site POST -> 403', xs.status === 403, `got ${xs.status}`);
}

// 5. Garbage bodies never become 5xx -------------------------------------------------------------------------------
{
  const bodies = ['', 'null', '[]', '{"pages":"x"}', '{"pages":[{"page":1,"text":5}]}', '\u0000\u0001', '{"a":'.repeat(1000)];
  const seen = new Set();
  for (const b of bodies) {
    const r = await call('/api/guardian', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b });
    seen.add(r.status);
    await new Promise((r2) => setTimeout(r2, 100));
  }
  const bad = [...seen].filter((s) => s >= 500);
  check('guardian garbage bodies give 4xx (or 429), never 5xx', bad.length === 0, `statuses ${[...seen].join(',')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed; server errors (5xx) seen: ${serverErrors}`);
process.exit(failed.length || serverErrors ? 1 : 0);
