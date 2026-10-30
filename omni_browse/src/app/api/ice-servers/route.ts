import { NextRequest } from 'next/server';
import { guard, LIMITS } from '@/lib/rate-limit';

/**
 * ICE servers for the browser side of the WebRTC voice session.
 *
 * STUN is public. TURN credentials come from the server environment (TURN_URLS,
 * TURN_USERNAME, TURN_CREDENTIAL) so they never sit in the JavaScript bundle; the
 * Python agent receives the same list as PIPECAT_ICE_SERVERS. Relays such as
 * ExpressTURN (static credentials) or Cloudflare Realtime / coturn (short-lived
 * credentials minted here) plug in without touching the client.
 *
 * With CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN set, every browser request mints its own Cloudflare
 * Realtime TURN credential that lives 2 hours, so a leaked one dies quickly and nothing is shared between visitors.
 * The Python agent mints its own credential at start-up (bot.py) and never goes through this route. Requests that
 * are not from a browser (no Sec-Fetch-Site header, such as the container healthcheck) never mint.
 * Emergency: revoke one credential or the whole key in the Cloudflare dashboard (Realtime, TURN Server, the key).
 */
const CF_BROWSER_TTL_SECONDS = 7200;

async function cloudflareIceServers(): Promise<RTCIceServer[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return null;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: CF_BROWSER_TTL_SECONDS }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    // Browsers block port 53; Cloudflare's list does not use it, but keep the same rule as the static path.
    const servers = (data.iceServers || []).map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
    }));
    if (!servers.length) throw new Error('empty ice server list');
    return servers;
  } catch (err: any) {
    console.error('[ice-servers] Cloudflare TURN credentials failed:', err?.message || err);
    return null; // fall back to STUN and any static TURN_* values; the call still works on a direct path
  }
}

export function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const urls = (process.env.TURN_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u && !/:53(\?|$)/.test(u)); // browsers block port 53
  if (urls.length) {
    const entry: RTCIceServer = { urls };
    if (process.env.TURN_USERNAME) entry.username = process.env.TURN_USERNAME;
    if (process.env.TURN_CREDENTIAL) entry.credential = process.env.TURN_CREDENTIAL;
    servers.push(entry);
  }
  return servers;
}

export async function GET(req: NextRequest) {
  // Meant for this app's own voice sessions: cross-site browser requests and a malformed Origin (such as the
  // literal 'null', which used to throw and return a 500) get a 403, and callers are rate limited. A request
  // with no browser headers at all, like the container healthcheck, is served. These TURN credentials are
  // visible to anyone who opens the site, so the limits only slow abuse; use a relay account with its own quota.
  const blocked = guard(req, LIMITS.iceServers);
  if (blocked) return blocked;
  const fromBrowser = Boolean(req.headers.get('sec-fetch-site'));
  const minted = fromBrowser ? await cloudflareIceServers() : null;
  const iceServers = minted ? [{ urls: 'stun:stun.l.google.com:19302' }, ...minted] : buildIceServers();
  return Response.json(
    { iceServers, ttl: CF_BROWSER_TTL_SECONDS / 2 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
