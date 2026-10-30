// Does the vault rate limit hold when a caller forges X-Forwarded-For, and is one visitor's flood felt by another?
// Run against a container that is NOT behind a trusted proxy (the plain `docker run -p` setup).
//
//   BASE_URL=http://localhost:3014 node scripts/loadtest/vault_limiter.mjs
//
// Exits 0 when forged addresses do not get a fresh bucket each (the limit holds), 1 when they do.
const BASE = process.env.BASE_URL || 'http://localhost:3014';
const tally = (rows) => rows.reduce((o, s) => ({ ...o, [s]: (o[s] || 0) + 1 }), {});

const forged = [];
for (let i = 0; i < 60; i++) {
  const r = await fetch(`${BASE}/api/vault?id=NXP-AAAAAAAA`, { headers: { 'X-Forwarded-For': `10.9.${i}.1` } });
  forged.push(r.status);
}
console.log('60 GETs, each with a different forged X-Forwarded-For:', JSON.stringify(tally(forged)));

const plain = [];
for (let i = 0; i < 40; i++) plain.push((await fetch(`${BASE}/api/vault?id=NXP-AAAAAAAA`)).status);
console.log('40 GETs with no header:', JSON.stringify(tally(plain)));

const bypassed = !forged.includes(429);
console.log(bypassed ? 'FAIL: forged addresses bypass the vault limit' : 'PASS: the vault limit holds against forged addresses');
process.exit(bypassed ? 1 : 0);
