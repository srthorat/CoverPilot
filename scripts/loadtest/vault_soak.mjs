// Steady vault traffic for a soak: save, read back and delete a proposal every few seconds, paced under the
// per-address limit. It ends with the number of calls that were not as expected, which should be 0.
//
//   BASE_URL=http://localhost:3014 SECONDS=300 node scripts/loadtest/vault_soak.mjs
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3014';
const SECONDS = Number(process.env.SECONDS || 300);
const EVERY_MS = Number(process.env.EVERY_MS || 7000); // three calls per round: 3 x 60 / 7 is about 26 a minute, under the limit of 30
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newId = () => 'NXP-' + Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

let rounds = 0;
const bad = [];
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  const id = newId();
  const token = randomBytes(32).toString('hex');
  const blob = { v: 1, id, salt: randomBytes(16).toString('base64'), iv: randomBytes(12).toString('base64'), ciphertext: randomBytes(900).toString('base64'), savedAt: Date.now(), step: 3, authVerifier: createHash('sha256').update(token).digest('hex') };
  const put = await fetch(`${BASE}/api/vault`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(blob) });
  await put.text();
  const get = await fetch(`${BASE}/api/vault?id=${id}`);
  await get.text();
  const del = await fetch(`${BASE}/api/vault?id=${id}`, { method: 'DELETE', headers: { 'X-Vault-Auth': token } });
  await del.text();
  rounds++;
  if (put.status !== 200 || get.status !== 200 || del.status !== 200) bad.push([put.status, get.status, del.status].join('/'));
  await new Promise((r) => setTimeout(r, EVERY_MS));
}
console.log(`vault soak: ${rounds} rounds of save, read and delete in ${SECONDS}s; unexpected results: ${bad.length}${bad.length ? ' (' + [...new Set(bad)].join(', ') + ')' : ''}`);
process.exit(bad.length ? 1 : 0);
