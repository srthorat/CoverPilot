// Guard for the API routes that spend the server's Meta or Google keys.
//
// Every one of those routes is reachable by anyone who can open the site, so each handler starts with
// guard(): it refuses cross-site browser requests, caps the body size, and applies a token bucket per
// client. This slows abuse and accidental loops; it is not authentication. In particular, anything a
// route returns to an ordinary visitor (the TURN credentials from /api/ice-servers, for example) is
// visible to every visitor, with or without these checks.
//
// Who the client is: server.mjs stamps every request with x-nexasure-client (the socket address,
// overwriting anything the caller sent). Behind a reverse proxy that sets X-Forwarded-For (deploy/
// does) set TRUST_PROXY=true so the first forwarded address is used instead. With neither, every
// caller shares the key 'unknown', which still bounds the total spend.

export interface GuardOptions {
  name: string; // the bucket name, one per route
  perMinute: number; // bucket size and refill per minute
  maxBodyBytes?: number; // refuse a declared or read body larger than this
}

export interface GuardDeps {
  now?: () => number; // injectable clock for tests
  env?: Record<string, string | undefined>;
}

type Bucket = { tokens: number; at: number };
const buckets = new Map<string, Bucket>();

export function resetLimiter(): void {
  buckets.clear();
}

export function clientKey(req: Request, env: Record<string, string | undefined> = process.env): string {
  const stamped = req.headers.get('x-nexasure-client')?.trim();
  if (env.TRUST_PROXY === 'true') {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return stamped || 'unknown';
}

export type OriginVerdict = 'ok' | 'cross-site' | 'bad-origin';

/**
 * Browsers label their own requests: Sec-Fetch-Site is 'cross-site' for another site, and Origin names
 * the page that made a POST. Requests with neither header (curl, the container healthcheck) pass here
 * and are held back only by the rate limit.
 */
export function originDecision(h: { secFetchSite?: string | null; origin?: string | null; host?: string | null }): OriginVerdict {
  if (h.secFetchSite === 'cross-site') return 'cross-site';
  if (h.origin) {
    let originHost: string;
    try {
      originHost = new URL(h.origin).host; // throws on the literal Origin 'null' and on junk
    } catch {
      return 'bad-origin';
    }
    if (!h.host || originHost.toLowerCase() !== h.host.toLowerCase()) return 'bad-origin';
  }
  return 'ok';
}

function requestHost(req: Request, env: Record<string, string | undefined>): string | null {
  if (env.TRUST_PROXY === 'true') {
    const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.headers.get('host');
}

const reply = (status: number, error: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

/** null when the request may go ahead, otherwise the Response to return (403, 413 or 429). */
export function guard(req: Request, opts: GuardOptions, deps: GuardDeps = {}): Response | null {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? Date.now)();

  const verdict = originDecision({
    secFetchSite: req.headers.get('sec-fetch-site'),
    origin: req.headers.get('origin'),
    host: requestHost(req, env),
  });
  if (verdict !== 'ok') return reply(403, 'forbidden');

  if (opts.maxBodyBytes !== undefined) {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > opts.maxBodyBytes) return reply(413, 'Request too large');
  }

  const key = `${opts.name}:${clientKey(req, env)}`;
  const b = buckets.get(key) ?? { tokens: opts.perMinute, at: now };
  b.tokens = Math.min(opts.perMinute, b.tokens + ((now - b.at) / 60_000) * opts.perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    const wait = Math.max(1, Math.ceil(((1 - b.tokens) / opts.perMinute) * 60));
    return reply(429, 'Too many requests, wait a moment', { 'Retry-After': String(wait) });
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.at > 120_000) buckets.delete(k);
  return null;
}

/** Reads a JSON body without trusting Content-Length: 413 past maxBytes, otherwise the parsed value (or the fallback if it is not JSON). */
export async function readJsonLimited(
  req: Request,
  maxBytes: number,
  fallback: any = {}
): Promise<{ ok: true; body: any } | { ok: false; response: Response }> {
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, response: reply(413, 'Request too large') };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: true, body: fallback };
  }
}

// Per-route limits (requests a minute) and body caps, in one place.
export const LIMITS = {
  tts: { name: 'tts', perMinute: 60, maxBodyBytes: 20_000 },
  ocr: { name: 'ocr', perMinute: 20, maxBodyBytes: 12_000_000 },
  locateIds: { name: 'locate-ids', perMinute: 20, maxBodyBytes: 12_000_000 },
  sam: { name: 'sam', perMinute: 20, maxBodyBytes: 12_000_000 },
  guardian: { name: 'guardian', perMinute: 6, maxBodyBytes: 1_000_000 },
  audit: { name: 'audit', perMinute: 6, maxBodyBytes: 200_000 },
  policyCard: { name: 'policy-card', perMinute: 6, maxBodyBytes: 20_000 },
  vault: { name: 'vault', perMinute: 30, maxBodyBytes: 210_000 }, // blobs are at most 200 KB (vault-store.ts)
  iceServers: { name: 'ice-servers', perMinute: 5 }, // a session needs one call; each one mints a credential
} as const;
