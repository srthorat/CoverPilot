// A stricter second look at an already-redacted ID image, for files the customer uploads themselves.
//
// The normal OCR step notices a leak only when a whole number comes back. A box that sits half a row off leaves part of a
// number readable, and that goes unnoticed. So one more reading asks for whatever is partly legible, with ? for the rest,
// and any value with five or more readable characters counts as a leak. The reader is told it is checking a redaction; it
// is the same kind of model call as the OCR step and the image is the same redacted one (nothing new leaves the page).

import type { ShieldDocType } from './shield-safeguards.ts';

export function leakProbeMessages(documentType: ShieldDocType, imageDataUrl: string) {
  const partial = ' If a value is only partly readable, give the characters you can read and write ? for each one you cannot.';
  const system =
    documentType === 'salary-slip'
      ? 'You are an income-proof OCR engine. Read the salary slip image and return ONLY a JSON object with these keys: idNumber (PAN if printed, else null), uan (digits only or null), bankAccountNumber (digits only or null). Return null for anything not readable; never guess.' + partial + ' Do not add commentary.'
      : 'You are a KYC document OCR engine. Read the identity document image and return ONLY a JSON object with the key idNumber (the PAN or Aadhaar number exactly as printed, digits and letters only). Parts of the image may be pixelated or blacked out for privacy: return null when nothing is readable and never guess or reconstruct redacted characters.' + partial + ' Do not add commentary.';
  return [
    { role: 'system' as const, content: system },
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: `Extract the fields from this ${documentType === 'salary-slip' ? 'salary slip' : 'identity document'}.` },
        { type: 'image_url' as const, image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

/** Characters that count as readable: letters and digits, not the ? placeholder and not X, which is the usual mask letter. */
function readableChars(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return (String(value).toUpperCase().match(/[A-WYZ0-9]/g) || []).length;
}

/** Which numbers still show five or more characters in the probe's answer. */
export function partialLeaks(documentType: ShieldDocType, answer: Record<string, unknown> | null | undefined): string[] {
  if (!answer || typeof answer !== 'object') return [];
  const out: string[] = [];
  if (readableChars(answer.idNumber) >= 5) out.push(documentType === 'aadhaar' ? 'Aadhaar number' : 'PAN number');
  if (documentType === 'salary-slip') {
    if (readableChars(answer.uan) >= 5) out.push('UAN');
    if (readableChars(answer.bankAccountNumber) >= 5) out.push('Bank account number');
  }
  return out;
}
