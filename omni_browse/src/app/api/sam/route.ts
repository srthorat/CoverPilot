import { NextRequest } from 'next/server';
import { parseImageStream, recordsOfKind, decodeMaskToSVGPath } from '@meta-sam/parser';
import { metaEnv, MetaApiError } from '@/lib/meta';

/**
 * Locates the photo, signature and QR code on an ID card with Meta SAM 3.1 (Model API,
 * POST /v1/responses).
 *
 * SAM never receives the document itself. The browser blurs it until printed text is unreadable
 * (a few tens of pixels wide, measured: the Aadhaar number is still readable at 72 px, not at 66)
 * and sends only those copies. Photos, signatures and QR codes survive that blur, so SAM can
 * still find them; its boxes are in pixels of the image it was sent, which the browser draws on
 * the sharp image. Each concept is asked on every copy and the boxes are merged; a concept that
 * is not found on any copy fails the request, so nothing is read from an unprotected card.
 * The ID numbers are located separately (/api/locate-ids).
 */

// What SAM must find on each document. The PAN and Aadhaar numbers are not SAM's job: it does not
// see small printed IDs, and on a blurred copy it cannot see the digits at all.
const CONCEPTS: Record<string, string[]> = {
  aadhaar: ['QR code', 'photo'],
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

function iou(a: SamRegion['box'], b: SamRegion['box']): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter);
}

/** Merge the boxes several blurred copies found for one concept: overlapping boxes become their union. */
function mergeBoxes(concept: string, items: Awaited<ReturnType<typeof segmentConcept>>['items']): SamRegion[] {
  const groups: Array<typeof items> = [];
  for (const it of items) {
    const g = groups.find((grp) => grp.some((o) => iou(o.box, it.box) >= 0.3));
    if (g) g.push(it);
    else groups.push([it]);
  }
  return groups.map((g) => ({
    concept,
    box: {
      left: Math.min(...g.map((i) => i.box.left)),
      top: Math.min(...g.map((i) => i.box.top)),
      right: Math.max(...g.map((i) => i.box.right)),
      bottom: Math.max(...g.map((i) => i.box.bottom)),
    },
    confidence: g.reduce((m, i) => Math.max(m, i.confidence ?? 0), 0) || null,
    masks: g.flatMap((i) => (i.mask ? [i.mask] : [])).slice(0, 1),
    members: g.length,
  }));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const documentType = String(body.documentType || '');
  const concepts = CONCEPTS[documentType];
  if (!concepts) return Response.json({ error: 'documentType must be "pan" or "aadhaar"' }, { status: 400 });
  const variants: string[] = Array.isArray(body.blurredDataUrls) ? body.blurredDataUrls : [];
  if (
    variants.length < 1 ||
    variants.length > 3 ||
    !variants.every((v) => typeof v === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 3_000_000)
  ) {
    return Response.json({ error: 'blurredDataUrls must be 1 to 3 PNG/JPEG data URLs, each under 3 MB' }, { status: 400 });
  }
  const t0 = Date.now();
  try {
    const jobs = concepts.flatMap((c) => variants.map((v) => segmentConcept(v, c)));
    const results = await Promise.all(jobs);
    const regions = concepts.flatMap((c) => mergeBoxes(c, results.filter((r) => r.concept === c).flatMap((r) => r.items)));
    for (const c of concepts) {
      if (!regions.some((r) => r.concept === c)) {
        throw new Error(`Could not find the ${c} on the card; nothing was sent for reading`);
      }
    }
    return Response.json({ model: SAM_MODEL, regions, telemetry: { model: SAM_MODEL, totalMs: Date.now() - t0, copies: variants.length } });
  } catch (err: any) {
    const message = err instanceof MetaApiError ? err.message : `SAM request failed: ${err?.message || err}`;
    console.error('[sam]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}
