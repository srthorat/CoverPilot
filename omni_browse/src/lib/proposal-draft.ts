// Saving a proposal in progress so the customer can pause it and resume it later.
//
// Drafts live in this browser's localStorage only; nothing about a draft is sent to a server. They
// never contain identity numbers (Aadhaar, PAN, mobile), the e-signature or the payment: the
// customer types the numbers again and signs again after resuming.

export const CURRENT_KEY = 'nexasure.currentProposal';
const INDEX_KEY = 'nexasure.proposals';
const DRAFT_PREFIX = 'nexasure.draft.';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L, easy to read out loud

export interface DraftMeta {
  id: string;
  savedAt: number;
  step: number;
}

/** A unique code such as NXP-7KQ2M9XD (32^8 combinations, from the browser's secure random source). */
export function newDraftId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'NXP-' + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function readIndex(): DraftMeta[] {
  const list = readJson<DraftMeta[]>(INDEX_KEY);
  return Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'string') : [];
}

export function loadDraft<T = Record<string, unknown>>(id: string): T | null {
  return readJson<T>(DRAFT_PREFIX + id);
}

export function saveDraft(id: string, data: unknown, step: number): boolean {
  try {
    window.localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify(data));
    window.localStorage.setItem(CURRENT_KEY, id);
    const rest = readIndex().filter((m) => m.id !== id);
    const next = [{ id, savedAt: Date.now(), step }, ...rest].slice(0, 10);
    for (const dropped of rest.slice(9)) window.localStorage.removeItem(DRAFT_PREFIX + dropped.id);
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function deleteDraft(id: string): void {
  try {
    window.localStorage.removeItem(DRAFT_PREFIX + id);
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((m) => m.id !== id)));
    if (window.localStorage.getItem(CURRENT_KEY) === id) window.localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function setCurrent(id: string): void {
  try {
    window.localStorage.setItem(CURRENT_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export function currentId(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}
