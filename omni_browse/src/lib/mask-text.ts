// Deterministic masking of identity numbers in text taken from an uploaded document, done in the
// browser before any of it is sent anywhere. A model is not asked to find these: patterns are.

const RULES: Array<[RegExp, string]> = [
  [/\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g, '[aadhaar masked]'], // 12-digit Aadhaar, spaced or not
  [/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g, '[PAN masked]'],
  [/(?:\+91[ -]?|\b0)?\b[6-9]\d{9}\b/g, '[mobile masked]'],
  [/\b\d{13,19}\b/g, '[account or card masked]'],
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
