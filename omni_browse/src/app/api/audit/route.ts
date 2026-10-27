import { NextRequest } from 'next/server';
import { metaEnv, MetaApiError } from '@/lib/meta';

/**
 * Audit narrative for the Application Guardian certificate, written by
 * Meta Muse Wonder from the certificate payload. Called when the customer
 * downloads the certificate, so its 5–10 s latency is off the voice path.
 */

const SYSTEM = `You are Muse Wonder acting as the independent compliance auditor for an Indian term-life proposal completed through a voice co-browsing agent. You receive the audit certificate payload (applicant, coverage, statutory acknowledgements, tax summary, conversation summary). Write the auditor's narrative. Reply ONLY with JSON:
{"summary":"<3 sentences, plain English, for the policyholder>",
 "complianceFindings":[{"item":"<what was checked>","status":"compliant"|"attention"|"non-compliant","note":"<one sentence>"}],
 "riskNotes":["<one sentence each, max 3>"],
 "recommendation":"<one sentence>",
 "clausesCited":["<e.g. Insurance Act 1938 s.45>"]}
Base every statement on the payload; do not invent facts or amounts. Do not give medical advice.`;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const certificate = body.certificate;
  if (!certificate || typeof certificate !== 'object') {
    return Response.json({ error: 'certificate payload is required' }, { status: 400 });
  }
  const model = process.env.META_MODEL_WONDER || 'muse-wonder-1.0';
  const t0 = Date.now();
  try {
    const env = metaEnv();
    const res = await fetch(`${env.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(40000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `CERTIFICATE PAYLOAD:\n${JSON.stringify(certificate, null, 2)}` },
        ],
      }),
    });
    if (!res.ok) throw new MetaApiError(res.status, await res.text());
    const json: any = await res.json();
    const raw: string = json.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s < 0 || e < s) throw new MetaApiError(502, `Wonder did not return JSON: ${raw.slice(0, 200)}`);
    const narrative = JSON.parse(cleaned.slice(s, e + 1));
    return Response.json({
      narrative,
      telemetry: { model, totalMs: Date.now() - t0 },
    });
  } catch (err: any) {
    const message = err instanceof MetaApiError ? err.message : `Audit narrative failed: ${err?.message || err}`;
    console.error('[audit]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}
