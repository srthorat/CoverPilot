import assert from 'node:assert/strict';
import test from 'node:test';
import { authVerifierOf, decryptDraft, encryptDraft, generateResumeKey, KEY_LENGTH, normalizeResumeKey, storedAuth, VaultKeyError } from './vault.ts';

const ID = 'NXP-7KQ2M9XD';
const DRAFT = { v: 1, profile: { fullName: 'Priya Sharma', dob: '05/03/1992' }, activeStep: 3 };

test('resume key: format, alphabet and entropy', () => {
  const keys = new Set<string>();
  const seen = new Map<string, number>();
  for (let i = 0; i < 400; i++) {
    const k = generateResumeKey();
    assert.match(k, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    assert.equal(k.replace('-', '').length, KEY_LENGTH);
    keys.add(k);
    for (const c of k.replace('-', '')) seen.set(c, (seen.get(c) ?? 0) + 1);
  }
  assert.equal(keys.size, 400, 'no repeats in 400 draws');
  assert.equal(seen.size, 31, 'every character of the 31-letter alphabet is used');
  const counts = [...seen.values()];
  assert.ok(Math.max(...counts) / Math.min(...counts) < 1.8, 'no character is heavily favoured (no modulo bias)');
  assert.ok(Math.log2(31) * KEY_LENGTH > 49, 'about 49.5 bits');
});

test('typed keys are normalised, bad ones rejected', () => {
  assert.equal(normalizeResumeKey('7kq2m-9xdpa'), '7KQ2M9XDPA');
  assert.equal(normalizeResumeKey(' 7KQ2M 9XDPA '), '7KQ2M9XDPA');
  assert.equal(normalizeResumeKey('7KQ2M-9XDP'), null); // too short
  assert.equal(normalizeResumeKey('7KQ2M-9XDPI'), null); // I is not in the alphabet
});

test('encrypt then decrypt round trip, and the server blob holds no plaintext or key', async () => {
  const key = generateResumeKey();
  const { blob, authToken } = await encryptDraft(DRAFT, key, ID, 3);
  const text = JSON.stringify(blob);
  assert.ok(!text.includes('Priya') && !text.includes('1992') && !text.includes(key.replace('-', '')));
  assert.equal(blob.step, 3);
  const out = await decryptDraft(blob, key.toLowerCase(), ID);
  assert.deepEqual(out.draft, DRAFT);
  assert.equal(out.authToken, authToken, 'the same key re-derives the same auth token');
});

test('a wrong key fails with the key error', async () => {
  const { blob } = await encryptDraft(DRAFT, generateResumeKey(), ID, 1);
  await assert.rejects(() => decryptDraft(blob, 'AAAAA-AAAAA', ID), VaultKeyError);
  await assert.rejects(() => decryptDraft(blob, 'not a key', ID), VaultKeyError);
});

test('a tampered ciphertext, iv or another proposal code all fail', async () => {
  const key = generateResumeKey();
  const { blob } = await encryptDraft(DRAFT, key, ID, 1);
  const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  await assert.rejects(() => decryptDraft({ ...blob, ciphertext: flip(blob.ciphertext) }, key, ID), VaultKeyError);
  await assert.rejects(() => decryptDraft({ ...blob, iv: flip(blob.iv) }, key, ID), VaultKeyError);
  await assert.rejects(() => decryptDraft(blob, key, 'NXP-AAAAAAAA'), VaultKeyError);
});

test('the auth verifier cannot decrypt and the auth token is not the encryption secret', async () => {
  const key = generateResumeKey();
  const { blob, authToken } = await encryptDraft(DRAFT, key, ID, 1);
  assert.match(blob.authVerifier, /^[0-9a-f]{64}$/);
  assert.equal(blob.authVerifier, await authVerifierOf(authToken));
  assert.notEqual(blob.authVerifier, authToken);
  // Neither the verifier nor the token is accepted as a key.
  await assert.rejects(() => decryptDraft(blob, blob.authVerifier, ID), VaultKeyError);
  await assert.rejects(() => decryptDraft(blob, authToken, ID), VaultKeyError);
  // Two uploads of the same draft with the same key look unrelated (fresh salt and iv).
  const again = await encryptDraft(DRAFT, key, ID, 1);
  assert.notEqual(again.blob.ciphertext, blob.ciphertext);
  assert.notEqual(again.blob.authVerifier, blob.authVerifier);
});

test('no browser storage in node: the auth lookup just returns null', () => {
  assert.equal(storedAuth(ID), null);
});
