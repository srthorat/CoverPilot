import { NextRequest } from 'next/server';
import { sparkJson, MetaApiError, ChatMessage } from '@/lib/meta';

/**
 * Locates printed identifiers (PAN number, UAN, bank account number) with Meta Muse Spark.
 *
 * SAM 3.1 segments objects (photo, QR code, signature, large digits) but does not find small
 * printed IDs. The browser therefore blurs the document until the text is unreadable and sends
 * only that blurred copy here: the model sees the layout, never the numbers. It returns where each
 * identifier is printed, and the browser pixelates those boxes on the sharp image before anything
 * reads it. Boxes are padded because a located box can be off by a few percent.
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
  pan: 'an Indian PAN card. Locate the 10-character permanent account number value (not its label)',
  'salary-slip': 'a salary slip. Locate the PAN value, the UAN value and the bank account number value (not their labels)',
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const documentType = String(body.documentType || '');
  const fields = FIELDS[documentType];
  if (!fields) {
    return Response.json({ error: 'documentType must be "pan" or "salary-slip"' }, { status: 400 });
  }
  const blurred = typeof body.blurredDataUrl === 'string' ? body.blurredDataUrl : '';
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(blurred) || blurred.length > 3_000_000) {
    return Response.json({ error: 'blurredDataUrl must be a PNG/JPEG data URL under 3 MB' }, { status: 400 });
  }

  const shape = `{${fields.map((f) => `"${f.key}":{"left":0,"top":0,"right":0,"bottom":0}`).join(',')}}`;
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `This is a heavily blurred image of ${DOCUMENT[documentType]}. The text is unreadable on purpose, but the layout is visible. Return ONLY JSON with normalized coordinates (fractions 0-1 of the image width and height) giving a tight box around each value: ${shape}`,
        },
        { type: 'image_url', image_url: { url: blurred } },
      ],
    },
  ];

  const startedAt = Date.now();
  try {
    const { data, model } = await sparkJson<Record<string, unknown>>(messages, { reasoningEffort: 'low', temperature: 0 });
    const regions = [];
    for (const f of fields) {
      const box = data[f.key];
      // An unusable box means the identifier is not covered; fail loudly rather than skip it.
      if (!validBox(box)) throw new Error(`Muse Spark did not return a usable box for the ${f.label}`);
      regions.push({ concept: f.label, box: pad(box) });
    }
    return Response.json({ regions, telemetry: { model, totalMs: Date.now() - startedAt } });
  } catch (err: any) {
    const message = err instanceof MetaApiError ? err.message : `Locating IDs failed: ${err?.message || err}`;
    console.error('[locate-ids]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}
