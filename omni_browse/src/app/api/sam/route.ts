import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseImageStream, recordsOfKind, decodeMaskToSVGPath } from '@meta-sam/parser';
import { metaEnv, MetaApiError } from '@/lib/meta';

/**
 * PII region detection with Meta SAM 3.1 (Model API, POST /v1/responses).
 *
 * One request per concept (SAM takes a single noun phrase), run in parallel.
 * Returns boxes + pixel masks (as SVG paths, local to each mask's bounds) so the
 * browser can pixelate the regions *before* the image goes to Muse Spark for OCR.
 *
 * Results for the bundled sample cards are cached in memory and warmed at
 * server start (see server.mjs), so the demo shows masks instantly.
 */

const SAMPLES: Record<string, string> = {
  pan: 'sample-pan.png',
  aadhaar: 'sample-aadhaar.png',
};

// What counts as PII on each document. SAM 3.1 does not treat the PAN's
// alphanumeric ID as a "number", so that one is masked after OCR instead.
// The date of birth is left readable on both cards because the form needs it.
const CONCEPTS: Record<string, string[]> = {
  aadhaar: ['number', 'QR code', 'photo'],
  pan: ['photo', 'signature'],
};

const MIN_CONFIDENCE = 0.4;
const SAM_MODEL = process.env.META_MODEL_SAM3 || 'sam-3.1';

export interface SamRegion {
  concept: string;
  box: { left: number; top: number; right: number; bottom: number };
  confidence: number | null;
  masks: Array<{ path: string; left: number; top: number }>;
  members: number;
}

interface SamResult {
  model: string;
  imageUrl: string;
  width: number;
  height: number;
  regions: SamRegion[];
  telemetry: { model: string; totalMs: number; cached: boolean };
}

const cache = new Map<string, SamResult>();

async function* sseEvents(res: Response): AsyncGenerator<{ type: string } & Record<string, unknown>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload);
      } catch {
        /* skip malformed frame */
      }
    }
  }
}

async function segmentConcept(dataUrl: string, concept: string) {
  const env = metaEnv();
  const t0 = Date.now();
  const res = await fetch(`${env.baseUrl}/responses`, {
    method: 'POST',
    signal: AbortSignal.timeout(env.timeoutMs),
    headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model: SAM_MODEL,
      stream: true,
      metadata: { mask_encoding: 'one_bit', include_confidence: 'true' },
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: concept },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
    }),
  });
  if (!res.ok || !res.body) throw new MetaApiError(res.status, await res.text());

  const result = await parseImageStream(sseEvents(res)).finalResult;
  const boxes = recordsOfKind(result.records, 'box');
  const masks = recordsOfKind(result.records, 'mask');
  const maskById = new Map<string, (typeof masks)[number]>();
  for (const m of masks) maskById.set(m.objectId, m);

  const items = boxes
    .filter((b) => (b.confidence ?? 1) >= MIN_CONFIDENCE)
    .map((b) => {
      const m = maskById.get(b.objectId);
      let mask: { path: string; left: number; top: number } | null = null;
      if (m) {
        try {
          const p = decodeMaskToSVGPath(m.mask);
          if (p) mask = { path: p, left: m.bounds.left, top: m.bounds.top };
        } catch {
          /* unreadable mask payload: box still works */
        }
      }
      return {
        box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
        confidence: b.confidence ?? null,
        mask,
      };
    });
  return { concept, items, ms: Date.now() - t0 };
}

/** Group boxes that sit on one text line (e.g. the 12 Aadhaar digits) into one region. */
function toRegions(concept: string, items: Awaited<ReturnType<typeof segmentConcept>>['items']): SamRegion[] {
  if (items.length === 0) return [];
  const single = (it: (typeof items)[number]): SamRegion => ({
    concept,
    box: it.box,
    confidence: it.confidence,
    masks: it.mask ? [it.mask] : [],
    members: 1,
  });
  if (concept !== 'number') return items.map(single);

  // Cluster by vertical centre; keep the largest cluster (the ID line), merge it.
  const clusters: Array<typeof items> = [];
  for (const it of items) {
    const cy = (it.box.top + it.box.bottom) / 2;
    const h = it.box.bottom - it.box.top;
    const c = clusters.find((cl) => {
      const ref = cl[0];
      const rcy = (ref.box.top + ref.box.bottom) / 2;
      return Math.abs(rcy - cy) < Math.max(h, ref.box.bottom - ref.box.top) * 0.6;
    });
    if (c) c.push(it);
    else clusters.push([it]);
  }
  clusters.sort((a, b) => b.length - a.length);
  const best = clusters[0];
  if (best.length < 3) return items.map(single);
  const pad = 8;
  const box = {
    left: Math.min(...best.map((i) => i.box.left)) - pad,
    top: Math.min(...best.map((i) => i.box.top)) - pad,
    right: Math.max(...best.map((i) => i.box.right)) + pad,
    bottom: Math.max(...best.map((i) => i.box.bottom)) + pad,
  };
  const conf = best.reduce((s, i) => s + (i.confidence ?? 0), 0) / best.length;
  return [
    {
      concept,
      box,
      confidence: Number.isFinite(conf) ? conf : null,
      masks: best.flatMap((i) => (i.mask ? [i.mask] : [])),
      members: best.length,
    },
  ];
}

async function segmentDocument(documentType: string): Promise<SamResult> {
  const hit = cache.get(documentType);
  if (hit) return { ...hit, telemetry: { ...hit.telemetry, cached: true } };

  const file = SAMPLES[documentType];
  const png = await readFile(path.join(process.cwd(), 'public', 'samples', file));
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  // PNG IHDR: width/height are the 4-byte big-endian ints at offsets 16 and 20.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);

  const t0 = Date.now();
  const results = await Promise.all(CONCEPTS[documentType].map((c) => segmentConcept(dataUrl, c)));
  const regions = results.flatMap((r) => toRegions(r.concept, r.items));

  const out: SamResult = {
    model: SAM_MODEL,
    imageUrl: `/samples/${file}`,
    width,
    height,
    regions,
    telemetry: { model: SAM_MODEL, totalMs: Date.now() - t0, cached: false },
  };
  cache.set(documentType, out);
  return out;
}

async function handle(documentType: string) {
  if (!SAMPLES[documentType]) {
    return Response.json({ error: 'documentType must be "pan" or "aadhaar"' }, { status: 400 });
  }
  try {
    return Response.json(await segmentDocument(documentType));
  } catch (err: any) {
    const message = err instanceof MetaApiError ? err.message : `SAM request failed: ${err?.message || err}`;
    console.error('[sam]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(String(body.documentType || 'aadhaar'));
}

/** GET /api/sam?documentType=aadhaar — used by server.mjs to warm the cache at boot. */
export async function GET(req: NextRequest) {
  return handle(req.nextUrl.searchParams.get('documentType') || 'aadhaar');
}
