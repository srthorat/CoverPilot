import { NextRequest } from 'next/server';
import { MetaApiError } from '@/lib/meta';
import { GuardianConfigError, GuardianInputError, parseInput, reviewDocument } from '@/lib/guardian-review';

/**
 * Integrity Guardian: reads a proposed-policy document (text already extracted and masked in the
 * browser) and returns a structured plain-language review. The model only reads and explains; the
 * comparison with the customer's application is done in the browser (guardian-checks).
 * GUARDIAN_PROVIDER=spark (default) uses Muse Spark on the Meta Model API; GUARDIAN_PROVIDER=spark-open
 * uses Muse Spark Open on an OpenAI-compatible host. There is no silent fallback between them.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  try {
    return Response.json(await reviewDocument(parseInput(body)));
  } catch (err: any) {
    if (err instanceof GuardianInputError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof GuardianConfigError) return Response.json({ error: err.message }, { status: 503 });
    const message = err instanceof MetaApiError ? err.message : `Guardian review failed: ${err?.message || err}`;
    console.error('[guardian]', message);
    return Response.json({ error: message }, { status: err instanceof MetaApiError ? 502 : 500 });
  }
}
