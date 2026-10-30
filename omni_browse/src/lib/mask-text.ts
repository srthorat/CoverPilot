// Deterministic masking of identity numbers in text taken from an uploaded document, done in the
// browser before any of it is sent anywhere. A model is not asked to find these: patterns are.

// Order matters: the longer, more specific shapes go first so that a number is masked once, as what it is.
// Digit runs are only matched when no other digit touches them, so a number inside a longer figure
// (a policy number such as NXS-DEMO-2026-000123, a care line 1800-000-0000, an amount with commas such as
// 1,00,00,000) is left alone.
const RULES: Array<[RegExp, string]> = [
  [/(?<!\d)(?:\d{4}[ -]){3}\d{4}(?!\d)/g, '[account or card masked]'], // 16-digit card, written in fours
  [/(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, '[aadhaar masked]'], // 12-digit Aadhaar, spaced or not
  [/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g, '[PAN masked]'],
  // Indian mobile: 10 digits starting 6 to 9, optionally split 5 and 5 with a space or hyphen, with an optional +91, 91, 0091 or 0 prefix
  [/(?<![\d-])(?:(?:\+91|0091|91|0)[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g, '[mobile masked]'],
  [/(?<!\d)\d{9,18}(?!\d)/g, '[account or card masked]'], // bank account (9 to 18 digits) or card, written without gaps
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email masked]'],
];

export function maskIdentityNumbers(text: string): { text: string; masked: number } {
  let masked = 0;
  let out = text;
  for (const [re, label] of RULES) {
    out = out.replace(re, () => {
      masked++;
      return label;
    });
  }
  return { text: out, masked };
}
