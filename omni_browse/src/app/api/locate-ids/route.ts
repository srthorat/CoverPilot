import { NextRequest } from 'next/server';
import { guard, LIMITS, readJsonLimited } from '@/lib/rate-limit';
import { agreed, type Box } from '@/lib/box-agreement';
import { sparkJson, MetaApiError, ChatMessage } from '@/lib/meta';

/**
 * Locates printed identifiers (PAN number, UAN, bank account number) with Meta Muse Spark.
 *
 * SAM 3.1 segments objects (photo, QR code, signature, large digits) but does not find small
 * printed IDs. The browser therefore blurs the document until the text is unreadable and sends
 * only blurred copies here: the model sees the layout, never the numbers. It returns where each
 * identifier is printed, and the browser pixelates those boxes on the sharp image before anything
 * reads it. A single answer is not trusted: the document arrives blurred at several levels, each is
 * asked independently, and only boxes that at least two of them agree on are kept (their union is
 * masked). If no two agree, the request fails and nothing is read. Boxes are also padded because a
 * located box can be off by several percent.
 */

const FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  aadhaar: [{ key: 'aadhaarNumber', label: 'Aadhaar number' }],
  pan: [{ key: 'panNumber', label: 'PAN number' }],
  'salary-slip': [
    { key: 'pan', label: 'PAN number' },
    { key: 'uan', label: 'UAN' },
    { key: 'bankAccount', label: 'Bank account number' },
  ],
};

const DOCUMENT: Record<string, string> = {
  aadhaar:
    'an Indian Aadhaar card. A photo is on the left, a QR code on the top right, and the 12-digit Aadhaar number is printed in large digits in one row near the bottom of the card, below the name and date of birth. Locate that row of digits (not its label)',
  pan: 'an Indian PAN card. The permanent account number is the 10-character value (five letters, four digits, one letter) printed with the label "Permanent Account Number", normally directly below that label; the photo can be on the left or the right and the card may be tilted. Locate that value (not its label, not the name or the date of birth below it)',
  'salary-slip':
    'a salary slip or pay slip. The PAN (ten characters: five letters, four digits, one letter), the UAN (twelve digits) and the bank account number (a long digit string) can be anywhere on the page: in a header block of label and value rows, in a bordered table, or in a footer line at the bottom. Each sits right next to or under a label such as PAN, UAN, A/c or Bank account. In a two-column header the left column usually holds the employee name, id, designation and the bank account and the right column holds the PAN, UAN and pay period. Locate the PAN value, the UAN value and the bank account number value (not their labels, and not salary amounts)',
};

// Measured over 30 runs on the sample cards: the model's raw box can miss the real text by up to
// 2.8% on the left, 0.8% on top, 5.8% on the right (it under-estimates how wide a digit string is)
// and 2% on the bottom. The padding is that error plus margin.
const PAD = { left: 0.05, top: 0.02, right: 0.09, bottom: 0.035 };
// The Aadhaar number must be located on a much blurrier copy (its digits are large, so they stay
// readable down to about 63 px wide). Measured over 6 runs at each of 48, 50 and 54 px wide: the
// box missed the real digits by up to 4.4% on the left and up to 4.9% on top, and nothing on the
// right and bottom.
const PAD_AADHAAR = { left: 0.07, top: 0.06, right: 0.04, bottom: 0.04 };
const MAX_WIDTH = 0.6;
const MAX_HEIGHT = 0.12;

function validBox(b: unknown): b is Box {
  if (!b || typeof b !== 'object') return false;
  const { left, top, right, bottom } = b as Record<string, unknown>;
  const nums = [left, top, right, bottom];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return false;
  const [l, t, r, bt] = nums as number[];
  return r > l && bt > t && r - l <= MAX_WIDTH && bt - t <= MAX_HEIGHT;
}

function pad(b: Box, p = PAD): Box {
  return {
    left: Math.max(0, b.left - p.left),
    top: Math.max(0, b.top - p.top),
    right: Math.min(1, b.right + p.right),
    bottom: Math.min(1, b.bottom + p.bottom),
  };
}

export async function POST(req: NextRequest) {
  const limited = guard(req, LIMITS.locateIds);
  if (limited) return limited;
  const read = await readJsonLimited(req, LIMITS.locateIds.maxBodyBytes, {});
  if (!read.ok) return read.response;
  const body = read.body ?? {};
  const documentType = String(body.documentType || '');
  const fields = FIELDS[documentType];
  if (!fields) {
    return Response.json({ error: 'documentType must be "pan", "aadhaar" or "salary-slip"' }, { status: 400 });
  }
  const variants: string[] = Array.isArray(body.blurredDataUrls) ? body.blurredDataUrls : [];
  if (
    variants.length < 2 ||
    variants.length > 4 ||
    !variants.every((v) => typeof v === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 3_000_000)
  ) {
    return Response.json({ error: 'blurredDataUrls must be 2 to 4 PNG/JPEG data URLs, each under 3 MB' }, { status: 400 });
  }

  const shape = `{${fields.map((f) => `"${f.key}":{"left":0,"top":0,"right":0,"bottom":0}`).join(',')}}`;
  const prompt = `This is a heavily blurred image of ${DOCUMENT[documentType]}. The text is unreadable on purpose, but the layout is visible. Return ONLY JSON with normalized coordinates (fractions 0-1 of the image width and height) giving a tight box around each value: ${shape}`;
  const ask = (url: string): ChatMessage[] => [
    { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] },
  ];

  const startedAt = Date.now();
  try {
    // One extra round if the answers disagreed: a region is still only accepted when two answers agree.
    let model = '';
    let answerCount = 0;
    let regions: { concept: string; box: Box }[] = [];
    let unconfirmed: string | null = null;
    for (let round = 0; round < 2; round++) {
      const settled = await Promise.allSettled(variants.map((v) => sparkJson<Record<string, unknown>>(ask(v), { reasoningEffort: 'low', temperature: 0 })));
      const answers = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      if (answers.length < 2) {
        const failure = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
        throw failure?.reason ?? new Error('Muse Spark returned fewer than two answers');
      }
      model = answers[0].model;
      answerCount = answers.length;
      regions = [];
      unconfirmed = null;
      for (const f of fields) {
        const confirmed = agreed(answers.map((a) => a.data[f.key]).filter(validBox), { neighbours: documentType === 'salary-slip' });
        if (!confirmed) {
          unconfirmed = f.label;
          break;
        }
        regions.push({ concept: f.label, box: pad(confirmed, documentType === 'aadhaar' ? PAD_AADHAAR : PAD) });
      }
      if (!unconfirmed) break;
    }
    // No two answers agree: the position is unconfirmed, so nothing may be read.
    if (unconfirmed) throw new Error(`Could not confirm where the ${unconfirmed} is (the answers disagreed); nothing was sent`);
    return Response.json({ regions, telemetry: { model, totalMs: Date.now() - startedAt, answers: answerCount } });
  } catch (err: any) {
    const message = err instanceof MetaApiError ? err.message : `Locating IDs failed: ${err?.message || err}`;
    console.error('[locate-ids]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}
