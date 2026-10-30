import { NextRequest } from 'next/server';
import { guard, LIMITS } from '@/lib/rate-limit';
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
 * Every call goes through the shared guard (src/lib/rate-limit.ts): cross-site browser requests get 403, an oversized
 * body 413, and each client address 30 calls a minute (429). The address is the socket address that server.mjs stamps,
 * or the first X-Forwarded-For entry only when TRUST_PROXY=true, so a caller cannot get a fresh bucket by forging the
 * header. The limit is a guard against hammering, not security: the security is the key, which the server never has.
 * The number of stored proposals is capped too (see vault-store.ts), so a flood cannot fill the disk.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function PUT(req: NextRequest) {
  const blocked = guard(req, LIMITS.vault);
  if (blocked) return blocked;
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
    if (result === 'full') return json({ error: 'The vault is full right now. Your draft is still saved in this browser.' }, 503);
    if (result === 'forbidden') return json({ error: 'A copy with this code already exists and cannot be replaced from here' }, 403);
    return json({ ok: true, status: result });
  } catch (err: any) {
    console.error('[vault] save failed:', err?.code || err?.message || 'error'); // never the body
    return json({ error: 'The vault could not save this right now' }, 500);
  }
}

export async function GET(req: NextRequest) {
  const blocked = guard(req, LIMITS.vault);
  if (blocked) return blocked;
  const blob = getBlob(req.nextUrl.searchParams.get('id') || '');
  return blob ? json(blob) : json({ error: 'No saved proposal with that code' }, 404);
}

export async function DELETE(req: NextRequest) {
  const blocked = guard(req, LIMITS.vault);
  if (blocked) return blocked;
  const result = deleteBlob(req.nextUrl.searchParams.get('id') || '', req.headers.get('x-vault-auth') ?? undefined);
  if (result === 'deleted') return json({ ok: true });
  return result === 'forbidden' ? json({ error: 'Not allowed' }, 403) : json({ error: 'No saved proposal with that code' }, 404);
}
