// Validation of the primary nominee's date of birth (DD/MM/YYYY): a real calendar date, not in the future.
// The age it gives decides whether an adult appointee is needed. Nothing is ever filled in for the customer.

export interface NomineeDob {
  age: number | null;
  error: string | null;
}

export function parseNomineeDob(text: string, now: Date = new Date()): NomineeDob {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  const ask = "Enter the primary nominee's date of birth as DD/MM/YYYY.";
  if (!m) return { age: null, error: ask };
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(year, month - 1, day);
  if (year < 1900 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { age: null, error: "The primary nominee's date of birth is not a real date. Use DD/MM/YYYY." };
  }
  if (date.getTime() > now.getTime()) return { age: null, error: "The primary nominee's date of birth cannot be in the future." };
  let age = now.getFullYear() - year;
  if (now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day)) age -= 1;
  return { age, error: null };
}
