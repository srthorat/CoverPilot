// Custom Next.js server.
//
// Wraps Next so the process can run session-worker style pre-computation at boot
// (SAM 3.1 mask cache for the KYC demo). The live voice session no longer runs
// here: it is the Python Pipecat agent in ../voice-agent-py, reached over WebRTC
// through the /voice-agent/* rewrite in next.config.ts. The Next dev HMR
// WebSocket is passed through via getUpgradeHandler().

import { createServer } from 'node:http';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port, turbopack: dev });
const handle = app.getRequestHandler();

await app.prepare();
const nextUpgrade = app.getUpgradeHandler();

const server = createServer((req, res) => {
  // Stamp the caller's socket address for the API rate limiter (src/lib/rate-limit.ts). It always overwrites
  // whatever the caller sent, so it cannot be spoofed; behind a proxy, TRUST_PROXY=true uses X-Forwarded-For instead.
  req.headers['x-nexasure-client'] = req.socket.remoteAddress || '';
  return handle(req, res);
});
server.on('upgrade', (req, socket, head) => nextUpgrade(req, socket, head)); // Next.js dev HMR

server.listen(port, () => {
  console.log(`> OmniBrowse ready on http://${hostname}:${port}  (voice agent: ${process.env.VOICE_AGENT_URL || 'http://127.0.0.1:7860'} via /voice-agent)`);
});
