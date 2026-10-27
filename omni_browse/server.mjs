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

const server = createServer((req, res) => handle(req, res));
server.on('upgrade', (req, socket, head) => nextUpgrade(req, socket, head)); // Next.js dev HMR

server.listen(port, () => {
  console.log(`> OmniBrowse ready on http://${hostname}:${port}  (voice agent: ${process.env.VOICE_AGENT_URL || 'http://127.0.0.1:7860'} via /voice-agent)`);
  warmSamCache();
});

// Session-worker style pre-computation: segment the bundled sample ID cards with
// SAM 3.1 once at boot so the KYC demo shows masks instantly instead of after ~2.5 s.
function warmSamCache() {
  if (!process.env.META_MODEL_API_KEY && !process.env.META_API_KEY) return;
  setTimeout(async () => {
    for (const documentType of ['aadhaar', 'pan']) {
      try {
        const t0 = Date.now();
        const res = await fetch(`http://${hostname}:${port}/api/sam?documentType=${documentType}`);
        const json = await res.json().catch(() => ({}));
        console.log(`> SAM 3.1 cache warm: ${documentType} -> ${res.status}, ${json.regions?.length ?? 0} regions in ${Date.now() - t0} ms`);
      } catch (err) {
        console.warn(`> SAM 3.1 cache warm failed for ${documentType}:`, err?.message || err);
      }
    }
  }, dev ? 4000 : 500);
}
