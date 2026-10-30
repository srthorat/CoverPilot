import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { clientKey, guard, LIMITS, originDecision, readJsonLimited, resetLimiter } from './rate-limit.ts';

beforeEach(() => resetLimiter());

const req = (headers: Record<string, string> = {}, method = 'POST') =>
  new Request('http://localhost:3000/api/x', { method, headers: { host: 'localhost:3000', ...headers } });

test('a burst is allowed, then 429 with Retry-After, then the bucket refills', () => {
  let t = 1_000_000;
  const deps = { now: () => t, env: {} };
  const opts = { name: 'a', perMinute: 6 };
  for (let i = 0; i < 6; i++) assert.equal(guard(req(), opts, deps), null, `call ${i + 1}`);
  const blocked = guard(req(), opts, deps);
  assert.equal(blocked?.status, 429);
  assert.ok(Number(blocked?.headers.get('retry-after')) >= 1);
  t += 10_000; // 6 a minute refills one token every 10 s
  assert.equal(guard(req(), opts, deps), null);
  assert.equal(guard(req(), opts, deps)?.status, 429);
  t += 60_000; // a full minute refills the whole bucket, no more
  for (let i = 0; i < 6; i++) assert.equal(guard(req(), opts, deps), null);
  assert.equal(guard(req(), opts, deps)?.status, 429);
});

test('routes and clients have separate buckets', () => {
  const deps = { now: () => 5, env: {} };
  assert.equal(guard(req(), { name: 'x', perMinute: 1 }, deps), null);
  assert.equal(guard(req(), { name: 'x', perMinute: 1 }, deps)?.status, 429);
  assert.equal(guard(req(), { name: 'y', perMinute: 1 }, deps), null); // another route
  assert.equal(guard(req({ 'x-nexasure-client': '10.0.0.9' }), { name: 'x', perMinute: 1 }, deps), null); // another client
});

test('client key: stamped address by default, X-Forwarded-For only when the proxy is trusted', () => {
  const h = { 'x-nexasure-client': '10.0.0.1', 'x-forwarded-for': '203.0.113.7, 10.1.1.1' };
  assert.equal(clientKey(req(h), {}), '10.0.0.1'); // a caller-supplied X-Forwarded-For is ignored
  assert.equal(clientKey(req(h), { TRUST_PROXY: 'true' }), '203.0.113.7');
  assert.equal(clientKey(req(), {}), 'unknown');
});

test('origin rules', () => {
  assert.equal(originDecision({ host: 'localhost:3000' }), 'ok'); // curl, healthcheck
  assert.equal(originDecision({ secFetchSite: 'same-origin', host: 'localhost:3000' }), 'ok');
  assert.equal(originDecision({ origin: 'http://localhost:3000', host: 'localhost:3000' }), 'ok');
  assert.equal(originDecision({ secFetchSite: 'cross-site', host: 'localhost:3000' }), 'cross-site');
  assert.equal(originDecision({ origin: 'https://evil.example', host: 'localhost:3000' }), 'bad-origin');
  assert.equal(originDecision({ origin: 'null', host: 'localhost:3000' }), 'bad-origin'); // used to throw
  assert.equal(originDecision({ origin: 'not a url', host: 'localhost:3000' }), 'bad-origin');
  assert.equal(originDecision({ origin: 'http://localhost:3000', host: null }), 'bad-origin');
});

test('guard answers 403 for a cross-site or malformed origin and never throws', () => {
  const deps = { now: () => 1, env: {} };
  assert.equal(guard(req({ origin: 'null' }), { name: 'o', perMinute: 5 }, deps)?.status, 403);
  assert.equal(guard(req({ 'sec-fetch-site': 'cross-site' }), { name: 'o', perMinute: 5 }, deps)?.status, 403);
  assert.equal(guard(req({ origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }), { name: 'o', perMinute: 5 }, deps), null);
});

test('behind a trusted proxy the forwarded host is the one the origin is compared with', () => {
  const deps = { now: () => 1, env: { TRUST_PROXY: 'true' } };
  const r = new Request('http://127.0.0.1:3000/api/x', { method: 'POST', headers: { host: '127.0.0.1:3000', 'x-forwarded-host': 'demo.example', origin: 'https://demo.example' } });
  assert.equal(guard(r, { name: 'p', perMinute: 5 }, deps), null);
});

test('size cap: a declared length over the limit is 413, and a body read past the limit is 413', async () => {
  const deps = { now: () => 1, env: {} };
  assert.equal(guard(req({ 'content-length': '300000' }), { name: 's', perMinute: 5, maxBodyBytes: 200_000 }, deps)?.status, 413);
  assert.equal(guard(req({ 'content-length': '1000' }), { name: 's2', perMinute: 5, maxBodyBytes: 200_000 }, deps), null);
  const big = new Request('http://localhost:3000/api/x', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(300) }) });
  const r = await readJsonLimited(big, 100);
  assert.equal(r.ok, false);
  assert.equal((r as { response: Response }).response.status, 413);
  const ok = await readJsonLimited(new Request('http://localhost:3000/api/x', { method: 'POST', body: '{"a":1}' }), 100);
  assert.deepEqual(ok.ok && ok.body, { a: 1 });
  const bad = await readJsonLimited(new Request('http://localhost:3000/api/x', { method: 'POST', body: 'not json' }), 100, null);
  assert.deepEqual(bad.ok && bad.body, null);
});

test('limits table matches the agreed defaults', () => {
  assert.deepEqual(
    [LIMITS.tts.perMinute, LIMITS.ocr.perMinute, LIMITS.locateIds.perMinute, LIMITS.sam.perMinute, LIMITS.guardian.perMinute, LIMITS.audit.perMinute, LIMITS.policyCard.perMinute, LIMITS.iceServers.perMinute],
    [60, 20, 20, 20, 6, 6, 6, 5]
  );
  assert.equal(LIMITS.audit.maxBodyBytes, 200_000);
});
