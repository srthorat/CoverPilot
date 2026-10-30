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
 */
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
  return Response.json(
    { iceServers: buildIceServers(), ttl: 3600 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
