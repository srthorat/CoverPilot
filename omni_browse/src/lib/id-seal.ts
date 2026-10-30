// Identity numbers (Aadhaar, PAN, mobile) in a saved proposal.
//
// The local draft in localStorage never holds them in plain text. They are sealed with AES-GCM using a key
// that is created once per browser and kept in IndexedDB as a non-extractable CryptoKey, so the stored text
// cannot be read from localStorage and the key cannot be exported. The copy for other devices does not use
// this: it is encrypted as a whole with the resume key (see vault.ts), so the server only sees ciphertext.

export interface IdNumbers {
  aadhaarNumber: string;
  panNumber: string;
  mobileNumber: string;
  fromSample: { aadhaar: boolean; pan: boolean };
}

export interface SealedIds {
  iv: string;
  ct: string;
}

const DB = 'nexasure-seal';
const STORE = 'keys';
const KEY_ID = 'draft-ids-v1';

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getKey(): Promise<CryptoKey> {
  const db = await openDb();
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(KEY_ID);
    r.onsuccess = () => resolve(r.result as CryptoKey | undefined);
    r.onerror = () => reject(r.error);
  });
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return key;
}

export async function sealIds(ids: IdNumbers): Promise<SealedIds | null> {
  try {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(ids)));
    return { iv: b64(iv), ct: b64(ct) };
  } catch {
    return null; // storage or WebCrypto unavailable: the numbers are simply not saved
  }
}

export async function openIds(sealed: SealedIds | null | undefined): Promise<IdNumbers | null> {
  if (!sealed || typeof sealed.iv !== 'string' || typeof sealed.ct !== 'string') return null;
  try {
    const key = await getKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, key, unb64(sealed.ct));
    const o = JSON.parse(new TextDecoder().decode(plain));
    return {
      aadhaarNumber: String(o.aadhaarNumber || ''),
      panNumber: String(o.panNumber || ''),
      mobileNumber: String(o.mobileNumber || ''),
      fromSample: { aadhaar: Boolean(o.fromSample?.aadhaar), pan: Boolean(o.fromSample?.pan) },
    };
  } catch {
    return null; // sealed in another browser or the key was cleared: the customer types them again
  }
}
