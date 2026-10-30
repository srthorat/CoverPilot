// Resuming a paused proposal on another browser, with no accounts and no server that can read it.
//
// At Pause the browser makes a RESUME KEY (10 characters, shown once), stretches it with PBKDF2 into a
// master secret, and from that derives two unrelated values with HMAC labels:
//   - an AES-GCM key that encrypts the draft in the browser, and
//   - an auth token that lets the owner overwrite or delete the stored copy. The server keeps only
//     SHA-256 of that token, so it can check the owner without being able to decrypt anything.
// The proposal code is the public reference; the key is the identity proof. The ciphertext is bound to
// the proposal code (as AES-GCM additional data), so a stored blob cannot be moved to another code.
// Identity numbers, the e-signature and the payment are never part of a draft (see proposal-draft.ts).

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 unambiguous characters, about 4.95 bits each
export const KEY_LENGTH = 10; // about 49.5 bits
const PBKDF2_ITERATIONS = 250_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class VaultKeyError extends Error {
  constructor() {
    super('That key does not match this proposal');
    this.name = 'VaultKeyError';
  }
}

export interface VaultBlob {
  v: 1;
  id: string;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  savedAt: number;
  step: number;
  authVerifier: string; // hex, SHA-256 of the auth token
}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes as ArrayBuffer), (b) => b.toString(16).padStart(2, '0')).join('');

/** A fresh resume key such as 7KQ2M-9XDPA, drawn without modulo bias from the secure random source. */
export function generateResumeKey(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // reject bytes at or above this
  let out = '';
  while (out.length < KEY_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && out.length < KEY_LENGTH) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** The key as the customer types it (any case, with or without the dash); null when it is not a valid key. */
export function normalizeResumeKey(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]+/g, '');
  return raw.length === KEY_LENGTH && [...raw].every((c) => ALPHABET.includes(c)) ? raw : null;
}

async function derive(key: string, salt: Uint8Array): Promise<{ aes: CryptoKey; authToken: string }> {
  const raw = normalizeResumeKey(key);
  if (!raw) throw new VaultKeyError();
  const material = await crypto.subtle.importKey('raw', enc.encode(raw), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS }, material, 256);
  const hmacKey = await crypto.subtle.importKey('raw', master, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const encBytes = await crypto.subtle.sign('HMAC', hmacKey, enc.encode('nexasure-vault-encrypt-v1'));
  const authBytes = await crypto.subtle.sign('HMAC', hmacKey, enc.encode('nexasure-vault-auth-v1'));
  return { aes: await crypto.subtle.importKey('raw', encBytes, 'AES-GCM', false, ['encrypt', 'decrypt']), authToken: hex(authBytes) };
}

export async function authVerifierOf(authToken: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(authToken)));
}

/** Encrypt a draft for upload. Returns the blob for the server and the auth token to keep in this browser. */
export async function encryptDraft(draft: unknown, key: string, id: string, step: number): Promise<{ blob: VaultBlob; authToken: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const { aes, authToken } = await derive(key, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, aes, enc.encode(JSON.stringify(draft)));
  return {
    authToken,
    blob: { v: 1, id, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)), savedAt: Date.now(), step, authVerifier: await authVerifierOf(authToken) },
  };
}

/** Decrypt a downloaded blob. A wrong key, a changed ciphertext or a blob for another code all fail the same way. */
export async function decryptDraft<T = unknown>(blob: Pick<VaultBlob, 'id' | 'salt' | 'iv' | 'ciphertext'>, key: string, id: string): Promise<{ draft: T; authToken: string }> {
  try {
    const { aes, authToken } = await derive(key, unb64(blob.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource, additionalData: enc.encode(id) }, aes, unb64(blob.ciphertext) as BufferSource);
    return { draft: JSON.parse(dec.decode(pt)) as T, authToken };
  } catch {
    throw new VaultKeyError();
  }
}

// The auth token is kept only in the browser that created or resumed the draft, so that browser can
// replace or delete the stored copy later. It cannot decrypt anything.
const AUTH_PREFIX = 'nexasure.vaultAuth.';
export function storedAuth(id: string): string | null {
  try {
    return window.localStorage.getItem(AUTH_PREFIX + id);
  } catch {
    return null;
  }
}
export function storeAuth(id: string, token: string): void {
  try {
    window.localStorage.setItem(AUTH_PREFIX + id, token);
  } catch {
    /* storage blocked: this browser will not be able to replace the stored copy without the key */
  }
}
