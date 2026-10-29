import { NextRequest } from 'next/server';
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
  pan: [{ key: 'panNumber', label: 'PAN number' }],
  'salary-slip': [
    { key: 'pan', label: 'PAN number' },
    { key: 'uan', label: 'UAN' },
    { key: 'bankAccount', label: 'Bank account number' },
  ],
};

const DOCUMENT: Record<string, string> = {
  pan: 'an Indian PAN card with a photo on the left. The permanent account number is the 10-character value on the line directly below the label "Permanent Account Number", to the right of the photo. Locate that value (not its label)',
  'salary-slip':
    'a salary slip. Its header is two columns of label and value rows. The LEFT column holds, top to bottom: Employee Name, Employee ID, Designation and Bank A/c (the bank account number is the value in the left column, in the fourth and last row). The RIGHT column holds, top to bottom: PAN, UAN and Pay Period. Locate the PAN value, the UAN value and the bank account number value (not their labels)',
};

// Measured over 30 runs on the sample cards: the model's raw box can miss the real text by up to
// 2.8% on the left, 0.8% on top, 5.8% on the right (it under-estimates how wide a digit string is)
// and 2% on the bottom. The padding is that error plus margin.
const PAD = { left: 0.05, top: 0.02, right: 0.09, bottom: 0.035 };
const MAX_WIDTH = 0.6;
const MAX_HEIGHT = 0.12;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function validBox(b: unknown): b is Box {
  if (!b || typeof b !== 'object') return false;
  const { left, top, right, bottom } = b as Record<string, unknown>;
  const nums = [left, top, right, bottom];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return false;
  const [l, t, r, bt] = nums as number[];
  return r > l && bt > t && r - l <= MAX_WIDTH && bt - t <= MAX_HEIGHT;
}

function pad(b: Box): Box {
  return {
    left: Math.max(0, b.left - PAD.left),
    top: Math.max(0, b.top - PAD.top),
    right: Math.min(1, b.right + PAD.right),
    bottom: Math.min(1, b.bottom + PAD.bottom),
  };
}

function iou(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const total = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return inter / total;
}

function union(boxes: Box[]): Box {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

// Keep the boxes that overlap at least one other answer's box, and merge them. Fewer than two
// agreeing answers means the position is unconfirmed.
function agreed(boxes: Box[]): Box | null {
  const keep = boxes.filter((b, i) => boxes.some((o, j) => j !== i && iou(b, o) >= 0.3));
  return keep.length >= 2 ? union(keep) : null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const documentType = String(body.documentType || '');
  const fields = FIELDS[documentType];
  if (!fields) {
    return Response.json({ error: 'documentType must be "pan" or "salary-slip"' }, { status: 400 });
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
    const settled = await Promise.allSettled(variants.map((v) => sparkJson<Record<string, unknown>>(ask(v), { reasoningEffort: 'low', temperature: 0 })));
    const answers = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (answers.length < 2) {
      const failure = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      throw failure?.reason ?? new Error('Muse Spark returned fewer than two answers');
    }
    const model = answers[0].model;
    const regions = [];
    for (const f of fields) {
      const boxes = answers.map((a) => a.data[f.key]).filter(validBox);
      const confirmed = agreed(boxes);
      // No two answers agree: the position is unconfirmed, so nothing may be read.
      if (!confirmed) throw new Error(`Could not confirm where the ${f.label} is (the answers disagreed); nothing was sent`);
      regions.push({ concept: f.label, box: pad(confirmed) });
    }
    return Response.json({ regions, telemetry: { model, totalMs: Date.now() - startedAt, answers: answers.length } });
  } catch (err: any) {
    const message = err instanceof MetaApiError ? err.message : `Locating IDs failed: ${err?.message || err}`;
    console.error('[locate-ids]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}
