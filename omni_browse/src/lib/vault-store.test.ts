import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deleteBlob, EXPIRY_MS, MAX_BLOBS, getBlob, MAX_BLOB_BYTES, parseBlob, saveBlob } from './vault-store.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const blob = (over: Record<string, unknown> = {}) => ({
  v: 1, id: 'NXP-7KQ2M9XD', salt: 'c2FsdHNhbHRzYWx0c2E=', iv: 'aXZpdml2aXZpdg==', ciphertext: 'Y2lwaGVydGV4dA==', savedAt: Date.now(), step: 3, authVerifier: sha(TOKEN), ...over,
});

test('save, read back without the verifier, and the file holds only what was sent', () => {
  assert.equal(saveBlob(blob(), undefined, { dir }), 'created');
  const got = getBlob('NXP-7KQ2M9XD', { dir })!;
  assert.equal(got.ciphertext, 'Y2lwaGVydGV4dA==');
  assert.equal('authVerifier' in got, false);
  const onDisk = fs.readFileSync(path.join(dir, 'NXP-7KQ2M9XD.json'), 'utf8');
  assert.ok(!/Priya|resume|key/i.test(onDisk));
});

test('overwrite needs the auth token; a wrong or missing token is forbidden', () => {
  assert.equal(saveBlob(blob({ step: 4 }), undefined, { dir }), 'forbidden');
  assert.equal(saveBlob(blob({ step: 4 }), OTHER, { dir }), 'forbidden');
  assert.equal(saveBlob(blob({ step: 4 }), 'not hex', { dir }), 'forbidden');
  assert.equal(getBlob('NXP-7KQ2M9XD', { dir })!.step, 3, 'a refused overwrite changes nothing');
  assert.equal(saveBlob(blob({ step: 4, authVerifier: sha(OTHER) }), TOKEN, { dir }), 'updated');
  assert.equal(getBlob('NXP-7KQ2M9XD', { dir })!.step, 4);
});

test('delete needs the auth token that matches the latest verifier', () => {
  assert.equal(deleteBlob('NXP-7KQ2M9XD', TOKEN, { dir }), 'forbidden'); // the verifier now belongs to OTHER
  assert.equal(deleteBlob('NXP-7KQ2M9XD', undefined, { dir }), 'forbidden');
  assert.equal(deleteBlob('NXP-7KQ2M9XD', OTHER, { dir }), 'deleted');
  assert.equal(getBlob('NXP-7KQ2M9XD', { dir }), null);
  assert.equal(deleteBlob('NXP-7KQ2M9XD', OTHER, { dir }), 'not_found');
});

test('bad ids and bad shapes are refused', () => {
  assert.equal(getBlob('../../etc/passwd', { dir }), null);
  assert.equal(getBlob('NXP-7KQ2M9XI', { dir }), null); // I is not in the alphabet
  assert.equal(saveBlob(blob({ id: '../x' }), undefined, { dir }), 'invalid');
  assert.equal(saveBlob(blob({ step: 9 }), undefined, { dir }), 'invalid');
  assert.equal(saveBlob(blob({ ciphertext: 'not base64!' }), undefined, { dir }), 'invalid');
  assert.equal(saveBlob(blob({ authVerifier: 'xyz' }), undefined, { dir }), 'invalid');
  assert.equal(parseBlob(null), null);
});

test('a blob over 200 KB is refused', () => {
  assert.equal(saveBlob(blob({ id: 'NXP-AAAAAAAA', ciphertext: 'A'.repeat(MAX_BLOB_BYTES + 1) }), undefined, { dir }), 'invalid');
  assert.equal(saveBlob(blob({ id: 'NXP-AAAAAAAA', ciphertext: 'A'.repeat(MAX_BLOB_BYTES - 600) }), undefined, { dir }), 'created');
});

test('copies older than 14 days are gone, on read and on the next write', () => {
  assert.equal(saveBlob(blob({ id: 'NXP-BBBBBBBB' }), undefined, { dir }), 'created');
  const later = Date.now() + EXPIRY_MS + 60_000;
  assert.equal(getBlob('NXP-BBBBBBBB', { dir, now: later }), null);
  assert.equal(fs.existsSync(path.join(dir, 'NXP-BBBBBBBB.json')), false);
  assert.equal(saveBlob(blob({ id: 'NXP-CCCCCCCC' }), undefined, { dir }), 'created');
  const p = path.join(dir, 'NXP-CCCCCCCC.json');
  fs.utimesSync(p, new Date(Date.now() - EXPIRY_MS - 60_000), new Date(Date.now() - EXPIRY_MS - 60_000));
  assert.equal(saveBlob(blob({ id: 'NXP-DDDDDDDD' }), undefined, { dir }), 'created'); // the sweep removes the stale file
  assert.equal(fs.existsSync(p), false);
});

test('a full vault refuses new codes but still lets an existing one be replaced, and expired files make room', () => {
  const full = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-full-'));
  const ids = ['NXP-AAAAAAA2', 'NXP-AAAAAAA3', 'NXP-AAAAAAA4'];
  const t0 = Date.now();
  for (const id of ids.slice(0, 2)) assert.equal(saveBlob(blob({ id }), undefined, { dir: full, now: t0, maxBlobs: 2 }), 'created');
  assert.equal(saveBlob(blob({ id: ids[2] }), undefined, { dir: full, now: t0, maxBlobs: 2 }), 'full');
  assert.equal(getBlob(ids[2], { dir: full }), null, 'nothing was written for the refused code');
  assert.equal(saveBlob(blob({ id: ids[0], step: 5 }), TOKEN, { dir: full, now: t0, maxBlobs: 2 }), 'updated', 'replacing an existing proposal is not blocked');
  // Once the two have expired the sweep frees the space.
  assert.equal(saveBlob(blob({ id: ids[2] }), undefined, { dir: full, now: t0 + EXPIRY_MS + 60_000, maxBlobs: 2 }), 'created');
  assert.ok(MAX_BLOBS >= 1000 && MAX_BLOBS <= 10_000);
});
