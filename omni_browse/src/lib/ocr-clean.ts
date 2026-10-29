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
export const cleanAddress = (v: unknown) => text(v, /^[\p{L}\p{M}\p{N} ,.'’/#()-]{1,160}$/u);

export function cleanGender(v: unknown): 'Male' | 'Female' | null {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return t === 'male' ? 'Male' : t === 'female' ? 'Female' : null;
}
