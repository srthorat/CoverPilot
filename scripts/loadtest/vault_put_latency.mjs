// Times vault PUTs (and the page load, to see whether the whole server stalls) while the vault folder is full.
// Uses distinct forged X-Forwarded-For addresses so the per-address limit does not get in the way on a build that
// still trusts the header; on the fixed build set RATE_OK=1 and it paces itself instead.
//
//   BASE_URL=http://localhost:3014 PUTS=20 node scripts/loadtest/vault_put_latency.mjs
import { randomBytes } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3014';
const PUTS = Number(process.env.PUTS || 20);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newId = () => 'NXP-' + Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
const blob = () => ({ v: 1, id: newId(), salt: randomBytes(16).toString('base64'), iv: randomBytes(12).toString('base64'), ciphertext: randomBytes(1500).toString('base64'), savedAt: Date.now(), step: 2, authVerifier: randomBytes(32).toString('hex') });

const lat = [];
const statuses = {};
for (let i = 0; i < PUTS; i++) {
  const t = performance.now();
  const r = await fetch(`${BASE}/api/vault`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.${i}.1` }, body: JSON.stringify(blob()) });
  await r.text();
  lat.push(performance.now() - t);
  statuses[r.status] = (statuses[r.status] || 0) + 1;
  if (process.env.RATE_OK) await new Promise((res) => setTimeout(res, 2100));
}
lat.sort((a, b) => a - b);
console.log(`vault PUT x${PUTS}: statuses ${JSON.stringify(statuses)}; p50 ${lat[Math.floor(lat.length / 2)].toFixed(0)} ms, max ${lat[lat.length - 1].toFixed(0)} ms`);

// While PUTs sweep the folder, does the rest of the server answer?
const pageLat = [];
const writers = Array.from({ length: 8 }, async (_, k) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${BASE}/api/vault`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.8.${k}.${i}` }, body: JSON.stringify(blob()) });
    await r.text();
  }
});
const pages = (async () => {
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    await (await fetch(`${BASE}/`)).text();
    pageLat.push(performance.now() - t);
  }
})();
await Promise.all([...writers, pages]);
pageLat.sort((a, b) => a - b);
console.log(`GET / while 32 vault PUTs run: p50 ${pageLat[Math.floor(pageLat.length / 2)].toFixed(0)} ms, max ${pageLat[pageLat.length - 1].toFixed(0)} ms`);
