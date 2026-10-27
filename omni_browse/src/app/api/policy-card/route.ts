import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { metaEnv, MetaApiError } from '@/lib/meta';

/**
 * Personalised policy summary card rendered by Meta Muse Image 1.0.
 *
 * The browser requests it in the background as soon as the customer reaches the
 * final step (session-worker prefetch), so the image is ready at issuance.
 * Generation takes 10–20 s; results are cached by the policy details.
 */

const MODEL = process.env.META_MODEL_IMAGE || 'muse-image-1.0';
const cache = new Map<string, { dataUrl: string; ms: number }>();

interface PolicyInput {
  policyholder: string;
  sumAssured: string;
  term: string;
  riders: string[];
  monthlyPremium: string;
  nominee?: string | null;
  policyId?: string | null;
}

function buildPrompt(p: PolicyInput): string {
  const riders = p.riders.length ? p.riders.join(', ') : 'none';
  return (
    `A clean, premium insurance policy summary card for "ACKO Life Flexi Shield", pure term life insurance, India. ` +
    `Flat modern design, deep purple (#582be8) and white, subtle rounded card on a soft gradient background, a small shield icon, no people, no photos. ` +
    `The card must show this exact text, clearly legible, in this order:\n` +
    `Title: ACKO Life Flexi Shield\n` +
    `Policyholder: ${p.policyholder}\n` +
    `Sum Assured: ${p.sumAssured}\n` +
    `Policy Term: ${p.term}\n` +
    `Riders: ${riders}\n` +
    `Premium: ${p.monthlyPremium} per month\n` +
    (p.nominee ? `Nominee: ${p.nominee}\n` : '') +
    (p.policyId ? `Policy No: ${p.policyId}\n` : '') +
    `Footer small text: IRDAI UIN 157N001V01 · 30-day free look · Section 45 protection after 3 years.\n` +
    `No other text. No spelling changes. Landscape composition centred in the frame.`
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const p = body.policy as PolicyInput | undefined;
  if (!p || typeof p.policyholder !== 'string' || typeof p.sumAssured !== 'string') {
    return Response.json({ error: 'policy {policyholder, sumAssured, term, riders[], monthlyPremium} is required' }, { status: 400 });
  }
  const input: PolicyInput = {
    policyholder: p.policyholder.slice(0, 60),
    sumAssured: p.sumAssured.slice(0, 30),
    term: String(p.term || '30 years').slice(0, 30),
    riders: Array.isArray(p.riders) ? p.riders.map((r) => String(r).slice(0, 40)).slice(0, 5) : [],
    monthlyPremium: String(p.monthlyPremium || '').slice(0, 30),
    nominee: p.nominee ? String(p.nominee).slice(0, 60) : null,
    policyId: p.policyId ? String(p.policyId).slice(0, 40) : null,
  };
  const prompt = buildPrompt(input);
  const key = createHash('sha1').update(prompt).digest('hex');
  const hit = cache.get(key);
  if (hit) return Response.json({ ...hit, cached: true, model: MODEL });

  const t0 = Date.now();
  try {
    const env = metaEnv();
    const res = await fetch(`${env.baseUrl}/images/generations`, {
      method: 'POST',
      signal: AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({ model: MODEL, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
    });
    if (!res.ok) throw new MetaApiError(res.status, await res.text());
    const json: any = await res.json();
    const item = json.data?.[0];
    if (!item?.b64_json) throw new MetaApiError(502, 'Muse Image returned no image data');
    const format = String(json.output_format || 'webp').toLowerCase();
    const mime = format === 'png' ? 'image/png' : format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/webp';
    const out = { dataUrl: `data:${mime};base64,${item.b64_json}`, ms: Date.now() - t0 };
    cache.set(key, out);
    return Response.json({ ...out, cached: false, model: MODEL });
  } catch (err: any) {
    const message = err instanceof MetaApiError ? err.message : `Policy card generation failed: ${err?.message || err}`;
    console.error('[policy-card]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}
