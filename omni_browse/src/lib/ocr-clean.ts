// A document is untrusted input. Whatever text a card or slip contains, the model reading it can
// be talked into returning more than a value (for example a name that is really an instruction).
// Every field that reaches the form, and from there the voice agent's context, therefore has to
// match the shape of the thing it claims to be; anything else becomes null.

const WORDS = /^[\p{L}\p{M}][\p{L}\p{M} .'’&-]{0,79}$/u;

const text = (v: unknown, pattern: RegExp): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return pattern.test(t) ? t : null;
};

// A real name is a few short words; a sentence is not. This cannot stop a short instruction made of
// letters only (that case is handled by the agent prompt, the approval step and the step gate), but it
// removes the room an attacker needs for a long one.
export const cleanName = (v: unknown) => {
  const t = text(v, WORDS);
  return t && t.split(' ').length <= 5 && t.split(' ').every((w) => w.length <= 24) ? t : null;
};
export const cleanDob = (v: unknown) => text(v, /^\d{2}\/\d{2}\/\d{4}$/);
export const cleanPincode = (v: unknown) => text(v, /^\d{6}$/);
export const cleanPayPeriod = (v: unknown) => text(v, /^[A-Za-z0-9][A-Za-z0-9 /-]{0,29}$/);
export const cleanCity = (v: unknown) => text(v, /^[\p{L}\p{M} .'’-]{2,40}$/u);
/** The city from an Indian address that ends "..., <city>, <state> - <PIN>": the part before the state. Null if it cannot be told. */
export function cityFromAddress(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null; // too short to tell a city from a street
  const last = parts[parts.length - 1];
  const hasState = /[A-Za-z]/.test(last) && (/\d{6}/.test(last) || parts.length > 3);
  const candidate = hasState ? parts[parts.length - 2] : parts[parts.length - 1];
  return cleanCity(candidate.replace(/\b\d{6}\b/g, '').trim());
}
export const cleanAddress = (v: unknown) => text(v, /^[\p{L}\p{M}\p{N} ,.'’/#()-]{1,160}$/u);

export function cleanGender(v: unknown): 'Male' | 'Female' | null {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return t === 'male' ? 'Male' : t === 'female' ? 'Female' : null;
}

/**
 * A rupee amount the model read from a document, as whole rupees. Thousands separators, the rupee sign,
 * 'Rs.' and 'INR' are removed and one decimal point is kept, so '50,000.50' is 50001 and '50000.00' is
 * 50000 (stripping every non-digit used to turn the latter into 5000000). Anything that is not a plain
 * non-negative number after that is null, never a guess.
 */
export function parseRupees(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const t = v.replace(/₹|\brs\b\.?|\binr\b|\brupees?\b/gi, '').replace(/[,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    n = Number(t);
  } else return null;
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000_000 ? Math.round(n) : null;
}
