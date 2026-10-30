import { NextRequest } from 'next/server';
import { deleteBlob, getBlob, MAX_BLOB_BYTES, saveBlob } from '@/lib/vault-store';

/**
 * Proposal vault: stores an encrypted draft that only the holder of its resume key can open (see
 * src/lib/vault.ts). The server sees ciphertext and a hash of an auth token, never the key or any
 * plaintext, and never logs a request body.
 *
 *   PUT    save a blob; replacing an existing one needs the X-Vault-Auth token
 *   GET    ?id=NXP-XXXXXXXX  the blob (404 when there is none)
 *   DELETE ?id=NXP-XXXXXXXX  needs the X-Vault-Auth token
 *
 * Calls are limited to 30 a minute per client address. The address comes from X-Forwarded-For, which is
 * only trustworthy behind a proxy that sets it (Caddy's reverse_proxy, used in deploy/, adds it), so treat the limit as
 * a guard against casual hammering, not as security: the security is the key, which the server never has.
 */

const WINDOW_MS = 60_000;
const LIMIT = 30;
const hits = new Map<string, number[]>();

function limited(req: NextRequest): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return recent.length > LIMIT;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const tooMany = () => json({ error: 'Too many requests, wait a minute' }, 429);

export async function PUT(req: NextRequest) {
  if (limited(req)) return tooMany();
  const text = await req.text();
  if (text.length > MAX_BLOB_BYTES + 2048) return json({ error: 'Too large' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  try {
    const result = saveBlob(body, req.headers.get('x-vault-auth') ?? undefined);
    if (result === 'invalid') return json({ error: 'Invalid request' }, 400);
    if (result === 'too_large') return json({ error: 'Too large' }, 413);
    if (result === 'forbidden') return json({ error: 'A copy with this code already exists and cannot be replaced from here' }, 403);
    return json({ ok: true, status: result });
  } catch (err: any) {
    console.error('[vault] save failed:', err?.code || err?.message || 'error'); // never the body
    return json({ error: 'The vault could not save this right now' }, 500);
  }
}

export async function GET(req: NextRequest) {
  if (limited(req)) return tooMany();
  const blob = getBlob(req.nextUrl.searchParams.get('id') || '');
  return blob ? json(blob) : json({ error: 'No saved proposal with that code' }, 404);
}

export async function DELETE(req: NextRequest) {
  if (limited(req)) return tooMany();
  const result = deleteBlob(req.nextUrl.searchParams.get('id') || '', req.headers.get('x-vault-auth') ?? undefined);
  if (result === 'deleted') return json({ ok: true });
  return result === 'forbidden' ? json({ error: 'Not allowed' }, 403) : json({ error: 'No saved proposal with that code' }, 404);
}
