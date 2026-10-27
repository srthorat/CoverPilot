import { NextRequest } from 'next/server';

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
  // Same-origin only: the credentials are for this app's own voice sessions.
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.nextUrl.host) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  return Response.json(
    { iceServers: buildIceServers(), ttl: 3600 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
