// Server side of the proposal vault: it stores encrypted blobs it cannot read, one file per proposal code.
// It never receives the resume key or any plaintext, only the ciphertext and SHA-256 of an auth token
// (see vault.ts). Overwriting or deleting an existing blob needs the auth token itself.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ID_PATTERN = /^NXP-[A-HJKMNP-Z2-9]{8}$/;
export const MAX_BLOB_BYTES = 200 * 1024;
export const EXPIRY_MS = 14 * 24 * 3600 * 1000;
// A full vault refuses new codes (503) instead of growing without bound: 2000 proposals is at most about 400 MB at the
// size cap and a few MB of real drafts. Replacing an existing proposal is still allowed.
export const MAX_BLOBS = 2000;

export interface StoredBlob {
  v: 1;
  id: string;
  salt: string;
  iv: string;
  ciphertext: string;
  savedAt: number;
  step: number;
  authVerifier: string;
}

export type SaveResult = 'created' | 'updated' | 'forbidden' | 'invalid' | 'too_large' | 'full';

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function vaultDir(): string {
  if (process.env.VAULT_DIR) return process.env.VAULT_DIR;
  return fs.existsSync('/app/voice-agent-py/data') ? '/app/voice-agent-py/data/vault' : path.resolve('./data/vault');
}

function file(dir: string, id: string) {
  return path.join(dir, `${id}.json`);
}

/** Check the shape of a blob from the network. Returns it without surprises, or null. */
export function parseBlob(raw: unknown): StoredBlob | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const str = (v: unknown, re: RegExp, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && re.test(v);
  if (b.v !== 1 || !str(b.id, ID_PATTERN, 12)) return null;
  if (!str(b.salt, B64, 64) || !str(b.iv, B64, 64) || !str(b.ciphertext, B64, MAX_BLOB_BYTES)) return null;
  if (!str(b.authVerifier, /^[0-9a-f]{64}$/, 64)) return null;
  if (typeof b.savedAt !== 'number' || !Number.isFinite(b.savedAt) || typeof b.step !== 'number' || !Number.isInteger(b.step) || b.step < 1 || b.step > 5) return null;
  return { v: 1, id: b.id as string, salt: b.salt as string, iv: b.iv as string, ciphertext: b.ciphertext as string, savedAt: b.savedAt, step: b.step, authVerifier: b.authVerifier as string };
}

function tokenMatches(authToken: string | undefined, verifier: string): boolean {
  if (!authToken || !/^[0-9a-f]{64}$/.test(authToken)) return false;
  const a = Buffer.from(createHash('sha256').update(authToken).digest('hex'));
  const b = Buffer.from(verifier);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Removes expired proposals and returns how many remain. */
function sweep(dir: string, now: number): number {
  let live = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const p = path.join(dir, name);
      if (now - fs.statSync(p).mtimeMs > EXPIRY_MS) fs.rmSync(p, { force: true });
      else live++;
    } catch {
      /* another request got there first */
    }
  }
  return live;
}

function read(dir: string, id: string, now: number): StoredBlob | null {
  try {
    const p = file(dir, id);
    if (now - fs.statSync(p).mtimeMs > EXPIRY_MS) {
      fs.rmSync(p, { force: true });
      return null;
    }
    return parseBlob(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    return null;
  }
}

export function saveBlob(raw: unknown, authToken?: string, opts: { dir?: string; now?: number; maxBlobs?: number } = {}): SaveResult {
  const dir = opts.dir ?? vaultDir();
  const now = opts.now ?? Date.now();
  const blob = parseBlob(raw);
  if (!blob) return 'invalid';
  const text = JSON.stringify(blob);
  if (Buffer.byteLength(text) > MAX_BLOB_BYTES) return 'too_large';
  fs.mkdirSync(dir, { recursive: true });
  const live = sweep(dir, now);
  const existing = read(dir, blob.id, now);
  if (existing && !tokenMatches(authToken, existing.authVerifier)) return 'forbidden';
  if (!existing && live >= (opts.maxBlobs ?? MAX_BLOBS)) return 'full';
  const tmp = path.join(dir, `.${blob.id}.${randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file(dir, blob.id)); // atomic: a reader sees the old or the new file, never half of one
  return existing ? 'updated' : 'created';
}

/** The blob without its auth verifier (the client does not need it). */
export function getBlob(id: string, opts: { dir?: string; now?: number } = {}): Omit<StoredBlob, 'authVerifier'> | null {
  if (!ID_PATTERN.test(id)) return null;
  const b = read(opts.dir ?? vaultDir(), id, opts.now ?? Date.now());
  if (!b) return null;
  const { authVerifier: _omit, ...rest } = b;
  return rest;
}

export function deleteBlob(id: string, authToken: string | undefined, opts: { dir?: string; now?: number } = {}): 'deleted' | 'not_found' | 'forbidden' {
  if (!ID_PATTERN.test(id)) return 'not_found';
  const dir = opts.dir ?? vaultDir();
  const existing = read(dir, id, opts.now ?? Date.now());
  if (!existing) return 'not_found';
  if (!tokenMatches(authToken, existing.authVerifier)) return 'forbidden';
  fs.rmSync(file(dir, id), { force: true });
  return 'deleted';
}
