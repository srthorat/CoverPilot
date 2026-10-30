import { NextRequest } from 'next/server';
import { sparkJson, MetaApiError, ChatMessage } from '@/lib/meta';
import { cleanAddress, cleanDob, cleanGender, cleanName, cleanPayPeriod, cleanPincode, parseRupees } from '@/lib/ocr-clean';
import { guard, LIMITS, readJsonLimited } from '@/lib/rate-limit';

/**
 * KYC document OCR via Meta Muse Spark (multimodal image input).
 *
 * Receives an image the browser has already redacted (a bundled sample or a file the customer
 * picked), sends it to Muse Spark, and returns the extracted fields as JSON. Nothing is read from
 * disk and the image is not stored. The ID number is masked server-side before it is returned.
 *
 * Note: muse-image-1.0 is an image *generation* model on the Meta Model API;
 * document understanding is a Muse Spark capability, so that is what we call.
 */

const SAMPLES: Record<string, { file: string; label: string }> = {
  pan: { file: 'sample-pan.png', label: 'Indian PAN card' },
  aadhaar: { file: 'sample-aadhaar.png', label: 'Indian Aadhaar card' },
  'salary-slip': { file: 'sample-salary-slip.png', label: 'Indian monthly salary slip (income proof)' },
};

interface OcrFields {
  documentType: string;
  fullName: string | null;
  dob: string | null;
  gender: string | null;
  idNumber: string | null;
  address: string | null;
  pincode: string | null;
  fatherName: string | null;
  // salary slip
  employerName?: string | null;
  monthlyGross?: string | number | null;
  annualIncome?: string | number | null;
  payPeriod?: string | null;
  bankAccountNumber?: string | null;
  uan?: string | null;
}

function maskTail(v: string | number | null | undefined, keep = 4): string | null {
  if (v === null || v === undefined) return null;
  const compact = String(v).replace(/\s+/g, '');
  if (!compact) return null;
  return `${'X'.repeat(Math.max(0, compact.length - keep))}${compact.slice(-keep)}`;
}

function digitsOnly(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = String(v).replace(/[^0-9]/g, '');
  return d || null;
}

function maskId(id: string | null, type: string): string | null {
  if (!id) return null;
  const compact = id.replace(/\s+/g, '');
  if (type === 'aadhaar') {
    return `XXXX-XXXX-${compact.slice(-4)}`;
  }
  return `${compact.slice(0, 3)}XXXXX${compact.slice(-2)}`;
}

export async function POST(req: NextRequest) {
  const limited = guard(req, LIMITS.ocr);
  if (limited) return limited;
  const read = await readJsonLimited(req, LIMITS.ocr.maxBodyBytes, {});
  if (!read.ok) return read.response;
  const body = read.body ?? {};
  const documentType = String(body.documentType || 'pan');
  const sample = SAMPLES[documentType];
  if (!sample) {
    return Response.json({ error: 'documentType must be "pan", "aadhaar" or "salary-slip"' }, { status: 400 });
  }

  // The browser sends the image after pixelating the regions that were located on blurred
  // copies, so the model that reads the document never sees the ID number, photo or QR code.
  // There is no fallback to an unredacted image.
  const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : '';
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl) || imageDataUrl.length > 8_000_000) {
    return Response.json({ error: 'imageDataUrl (the redacted PNG/JPEG, under 8 MB) is required' }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        documentType === 'salary-slip'
          ? 'You are an income-proof OCR engine. Read the salary slip image and return ONLY a JSON object with these keys: documentType ("salary-slip"), fullName (employee name), employerName, payPeriod, monthlyGross (gross monthly earnings, digits only), annualIncome (annual CTC if printed, otherwise monthlyGross x 12, digits only), bankAccountNumber (digits only or null), uan (digits only or null), idNumber (PAN if printed, else null). Return null for anything not clearly readable; never guess. Do not add commentary.'
          : 'You are a KYC document OCR engine. Read the identity document image and return ONLY a JSON object with these keys: documentType ("pan" or "aadhaar"), fullName, dob (DD/MM/YYYY), gender ("Male"/"Female"/null), idNumber (the PAN or Aadhaar number exactly as printed, digits/letters only), fatherName, address, pincode (6 digits or null). Parts of the image may be pixelated or blacked out for privacy: return null for any field you cannot read clearly and never guess or reconstruct redacted characters. Do not add commentary.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Extract the fields from this ${sample.label}.` },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];

  const startedAt = Date.now();
  try {
    const { data, model } = await sparkJson<OcrFields>(messages, { reasoningEffort: 'low', temperature: 0 });
    const monthly = parseRupees(data.monthlyGross);
    const stated = parseRupees(data.annualIncome);
    const fields = {
      documentType,
      // The document is untrusted: each value must look like what it claims to be (see ocr-clean.ts).
      fullName: cleanName(data.fullName),
      dob: cleanDob(data.dob),
      gender: cleanGender(data.gender),
      fatherName: cleanName(data.fatherName),
      address: cleanAddress(data.address),
      pincode: cleanPincode(data.pincode),
      idNumberMasked: maskId(data.idNumber ?? null, documentType === 'aadhaar' ? 'aadhaar' : 'pan'),
      // income proof (salary slip); account identifiers are masked before leaving the server
      employerName: cleanName(data.employerName),
      payPeriod: cleanPayPeriod(data.payPeriod),
      // Amounts are parsed, not stripped to digits: '50000.00' is 50000 rupees, not 5000000.
      monthlyGross: monthly === null ? null : String(monthly),
      annualIncome: stated !== null ? String(stated) : monthly !== null ? String(monthly * 12) : null,
      bankAccountMasked: maskTail(data.bankAccountNumber),
      uanMasked: maskTail(data.uan),
    };
    // This route cannot tell whether the image it was sent was redacted. What it can do, always, is notice
    // when the reader still returned a full ID: the shield missed something, so say so rather than let a
    // "hidden" claim stand.
    const redactionLeaks: string[] = [];
    {
      const idCompact = String(data.idNumber ?? '').replace(/\s+/g, '').toUpperCase();
      if (documentType === 'pan' && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(idCompact)) redactionLeaks.push('PAN number');
      if (documentType === 'aadhaar' && /^[0-9]{12}$/.test(idCompact)) redactionLeaks.push('Aadhaar number');
      if (documentType === 'salary-slip') {
        if ((digitsOnly(data.uan)?.length ?? 0) >= 10) redactionLeaks.push('UAN');
        if ((digitsOnly(data.bankAccountNumber)?.length ?? 0) >= 9) redactionLeaks.push('Bank account number');
      }
      if (redactionLeaks.length) console.error(`[ocr] redaction leak in ${documentType}: ${redactionLeaks.join(', ')}`);
    }
    return Response.json({
      fields,
      redactionLeaks,
      telemetry: { model, totalMs: Date.now() - startedAt },
    });
  } catch (err: any) {
    const message = err instanceof MetaApiError ? err.message : `OCR failed: ${err?.message || err}`;
    console.error('[ocr]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}
