import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The Python voice agent (voice-agent-py, Pipecat runner) serves the WebRTC offer
  // endpoint; proxying it keeps the browser same-origin (no CORS, works behind HTTPS).
  async rewrites() {
    const target = (process.env.VOICE_AGENT_URL || "http://127.0.0.1:7860").replace(/\/$/, "");
    return [{ source: "/voice-agent/:path*", destination: `${target}/:path*` }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
