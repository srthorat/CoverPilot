# 🛡️ CoverPilot (OmniBrowse)

> **Autonomous Multimodal Co-Browsing & Voice Agent for Regulated Digital Insurance**  
> *Meta Hackathon 2026 — Track 1: Indie Developer Track*

---

## 📌 Executive Summary
Digital term life insurance conversion suffers from a **78% drop-off rate** in India due to complex actuarial jargon, underwriting fear (Section 45 of Insurance Act 1938), and rigid forms. 

**CoverPilot** is an autonomous, multimodal co-browsing copilot built for regulated insurance. Instead of an isolated chatbot, CoverPilot operates directly alongside the applicant via **WebRTC 1080p screen-sharing**, a visible **dual-cursor remote control**, and low-latency **two-way voice in English, Hindi (हिंदी), and Marathi (मराठी)**.

---

## ✨ Key Capabilities

| Capability | User & Regulatory Outcome |
|---|---|
| **🎙️ Live Regional Voice Agent** | Speak naturally in English, Hindi, or Marathi with barge-in interruption. A Pipecat-style server pipeline streams the mic to **Meta Muse Voice Transcribe** (realtime WebSocket, server-side endpointing) and streams **Meta Muse Spark 1.3** answers back sentence by sentence. |
| **🖱️ Pure Dual-Cursor Co-Browsing** | Agent glides a visible remote pointer, highlights form fields, and performs inputs in real time while applicant retains instant override. |
| **🪜 Complex Living Benefit Ladders** | 3-tier Critical Illness cover (Silver ₹10L / Gold ₹25L / Platinum ₹50L), ATPD 100-month salary replacement ladder, and Life Stage Cover Escalator. |
| **🛡️ Nomination & MWPA 1874 Trust Shield** | Nominee split, minor-appointee rules and the Section 6 Married Women's Property Act creditor shield, explained by Muse Spark and **verified by Meta Muse Wonder** after every applied form action (approve / amend / reject, spoken back to the customer). |
| **⚖️ Statutory Terms & Conditions Drawer** | Interactive slide-over drawer with 8 IRDAI clauses (Section 45 incontestability, 30-day grace, 30-day free-look 100% refund, suicide 80% refund, 99.1% CSR). |
| **🪪 1-Click KYC with a real PII shield** | **Meta SAM 3.1** locates the photo, signature, QR code and the 12-digit Aadhaar number (one text-prompted request per concept, pixel masks returned). SAM cannot find small printed IDs, so for the PAN number, UAN and bank account number the browser blurs a copy until the text is unreadable and **Muse Spark** locates the fields from the layout alone. The **browser pixelates all of those regions** on the sharp image, and only the redacted image goes to **Muse Spark** for OCR, so the model that reads the document never sees the photo, signature or any ID number. Name and date of birth stay readable on purpose, because the form is filled from them. If the reader can still return a full ID, the app warns. Results for SAM on the sample cards are pre-computed at server start. |
| **💰 "What-If" Dual Tax & Net Cost Engine** | Real-time calculation of statutory deductions under Section 80C (Life Cover) and Section 80D (Health/Critical Illness). |
| **ℹ️ "Why Does ACKO Ask This?"** | Contextual explainer chips next to sensitive inputs explaining underwriting risk rationale in layman's terms with statutory citations. |
| **📜 Application Guardian Audit Certificate** | Downloadable compliance certificate (`.json`) with an independent auditor's narrative written by **Meta Muse Wonder** from the certificate payload. |
| **🖼️ Policy summary card** | Personalised policy card rendered by **Meta Muse Image 1.0**, pre-generated in the background on the last step so it is ready at issuance. |
| **💼 Income proof OCR** | Sample salary slip goes through the same shield (PAN, UAN and bank account number pixelated first), then is read by Muse Spark; annual income is autofilled. |

---

## 📅 Today's Work & Engineering Log

Detailed work history, architecture decisions, and tomorrow's roadmap are documented in:
👉 **[TODAYS_WORK_HISTORY_AND_NEXT_STEPS.md](./TODAYS_WORK_HISTORY_AND_NEXT_STEPS.md)**

---

## 🏛️ System Architecture

The voice experience is a **server-side agent pipeline** (Pipecat / LiveKit-Agents style). The browser is only a transport: it streams the microphone and plays the sentences it is told to speak. Every turn-taking decision, interruption and Meta model call happens in `omni_browse/server/`.

```
 Browser (transport only)                 Node custom server (server.mjs)                     Meta Model API
 ───────────────────────                  ───────────────────────────────                     ──────────────
 mic ─AudioWorklet─ PCM16 24 kHz ──WS──▶  WebSocketTransportInput
                                          └▶ MetaRealtimeSTT ─────────── binary frames ─────▶ wss://api.meta.ai/v1/asr/realtime
                                               (mutes uplink while bot speaks,                 muse-voice-transcribe-1.0
                                                RMS barge-in detector)        ◀── speechStart / transcript / speechComplete
                                          └▶ TurnOrchestrator  listening ▸ thinking ▸ speaking, interrupt broadcast
                                          └▶ UserContextAggregator (history)
                                          └▶ MetaSparkLLM ────────────── chat/completions stream ─▶ muse-spark-1.3
                                               (<<ACTION>> JSON → form action)
                                          └▶ SentenceAggregator (speak as soon as a sentence completes)
 speaker ◀── PCM16 frames ◀──WS──  GoogleTTS ──▶ WebSocketTransportOutput
 (Web Audio PCM player; playback_started/finished reported back so the server can gate the mic)

 Typed questions, live form state (JSON) and language changes travel over the same socket.
 1-click KYC OCR: POST /api/ocr → sample card PNG → Muse Spark image input → masked fields.
```

**Session worker (no extra models, no GPUs).** Three background jobs per session keep the conversation feeling live: (1) the fast lane below, (2) **predicted follow-ups** — after each answer and on every step change Spark pre-answers the three most likely next questions; a matching question is served in ~0 ms (strict lexical match) or the moment the acknowledgement lands (semantic match reported by the ack call), (3) **pre-computation** — SAM masks for the sample cards at boot, the Muse Image policy card while the customer is still on the last step. Viewport screenshots (html-to-image JPEG) are sent on step changes and attached to the next Spark turn for visual grounding.

**Session fast lane.** Spark is a reasoning model, so its first token takes 3–8 s depending on load. Per turn the LLM processor therefore runs two lanes: a tiny parallel *acknowledgement* call ("Sure, pulling up the free-look clause now", ~2 s) that is spoken first, and the full answer. Both start speculatively as soon as the live transcript has been stable for 400 ms, buffered until Meta's endpointing confirms the final text; the ack is adopted on a prefix match with ≥60 % word coverage, the full answer only on an exact match. The system prompt is static so ~1,500 of its tokens hit Meta's prompt cache every turn. Nothing spoken is canned.

Pipeline files: [`server/pipeline.mjs`](./omni_browse/server/pipeline.mjs) (frames + processors), [`server/processors.mjs`](./omni_browse/server/processors.mjs) (transport, STT, orchestrator, LLM, sentences), [`server/voice-agent.mjs`](./omni_browse/server/voice-agent.mjs) (session wiring), [`src/lib/voice-client.ts`](./omni_browse/src/lib/voice-client.ts) (browser transport + speech queue).

Swapping the WebSocket transport for a WebRTC transport (LiveKit / Daily) is a transport-layer change; the processors do not know how audio arrives.

For the earlier design notes see [coverpilot_video_understanding_architecture.md](./coverpilot_video_understanding_architecture.md).

---

## 🤖 Meta Models (what the code actually calls)

| Model (ID from `GET /v1/models`) | Used for | Where |
|---|---|---|
| **Muse Voice Transcribe** `muse-voice-transcribe-1.0` | Realtime speech-to-text, server-side endpointing, Hindi / Marathi / English language bias | `server/processors.mjs` → `MetaRealtimeSTT` |
| **Muse Spark 1.3** `muse-spark-1.3` | Streamed conversational reasoning, form actions, KYC document OCR (image input) | `server/processors.mjs` → `MetaSparkLLM`, `src/app/api/ocr/route.ts` |
| **SAM 3.1** `sam-3.1` | Text-prompted PII region detection on ID cards (photo, signature, QR code, Aadhaar number; boxes + masks) before OCR; cached and warmed at boot | `src/app/api/sam/route.ts`, warm-up in `server.mjs` |
| **Muse Wonder 1.0** `muse-wonder-1.0` | Asynchronous compliance verifier for every applied form action (4–9 s, off the spoken path); auditor's narrative for the certificate | `server/processors.mjs` → `WonderVerifier`, `src/app/api/audit/route.ts` |
| **Muse Spark** (ID locator) | Finds the PAN number, UAN and bank account number on a blurred copy of the document (it never sees the numbers); the boxes are padded by the measured error before the browser pixelates them | `src/app/api/locate-ids/route.ts` |
| **Muse Image 1.0** `muse-image-1.0` | Policy summary card at issuance (pre-generated on the last step, ~15 s, cached); also generated the sample-card portrait and signature | `src/app/api/policy-card/route.ts`, `public/samples/` |

All five Model API models are therefore live in the product. Muse Spark Open and Muse Glimmer (open weights) are on the roadmap only; Spark's native tool calling was evaluated and found inconsistent (one of two answers skipped the call), so form actions use a strict `<<ACTION>>` JSON marker instead. Muse Spark Open and Muse Glimmer are open-weights downloads, not Model API endpoints.

**Speech output:** the Meta Model API has no text-to-speech or speech-to-speech model, so spoken replies use **Google Cloud Text-to-Speech** (Chirp 3 HD voices for the Veena/Rishi/Nova/Aura personas in Indian English, US English, Hindi and Marathi; the agent answers in the language the customer selects). Sentences are synthesised as they complete and streamed to the browser as PCM16 24 kHz over the agent socket. Everything upstream of playback is Meta. There are no simulated or keyword fallbacks: if the Meta API or Google TTS fails, the UI shows the error.

Measured with `META_REASONING_EFFORT=low`: Muse Spark's first token arrives about 3.5–5 s after the turn ends (the model's hidden reasoning), the rest of the answer within ~0.3 s; Meta's endpointing closes a turn roughly 0.5 s after the last word.

---

## 🚀 Quickstart

### Prerequisites
- Node.js v20+ / v22+
- pnpm (`npm install -g pnpm`)

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/srthorat/CoverPilot.git
cd CoverPilot/omni_browse

# Install dependencies
pnpm install

# Configure environment variables
cp .env.example .env.local
# Paste your Meta Model API key into META_MODEL_API_KEY in .env.local

# Run the custom server (Next.js + the voice-agent WebSocket on /api/voice/agent)
PORT=3004 pnpm dev
```

Open [http://localhost:3004](http://localhost:3004) in a browser with a microphone, click **Accept & Start Co-Browsing**, and talk. `pnpm dev` runs `node server.mjs`; plain `next dev` would serve the pages but not the voice agent socket.

---

## 🐳 Run with Docker (one image, both services)

One image runs the Next.js app (`omni_browse`) and the Python Pipecat voice agent (`voice-agent-py`). Only port 3000 is published; the app proxies `/voice-agent/*` to the agent inside the container. The base images are multi-architecture, so the same `Dockerfile` builds for Apple Silicon (arm64) and Linux servers (amd64).

```bash
docker build -t coverpilot .
docker run --rm -p 3000:3000 \
  -v "$PWD/omni_browse/.env.local:/app/omni_browse/.env.local:ro" \
  -v coverpilot-data:/app/voice-agent-py/data \
  coverpilot
# open http://localhost:3000  (presenter view: http://localhost:3000/presenter)
```

- **Keys are never baked into the image.** Mount the env file as above, or pass plain variables (`-e META_MODEL_API_KEY=...`, `GOOGLE_TTS_API_KEY`, `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`). Do not use `--env-file` with a file that has quoted values, because Docker keeps the quotes.
- **Data:** customer memory and underwriter cases live in the `/app/voice-agent-py/data` volume.
- **WebRTC audio is UDP.** Behind NAT, a cloud firewall or Docker Desktop on macOS, set the `TURN_*` variables so audio relays through TURN. On Linux you can instead use `--network host`.
- **Building for another architecture** (for example an amd64 server from an Apple Silicon Mac): `docker build --platform linux/amd64 -t coverpilot:amd64 .`, or publish both at once with `docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/coverpilot --push .`.
- The container exits if either process stops, so a restart policy (`--restart unless-stopped`) restarts both together. Health is reported by a built-in check on both services.

### Deploy to a public host (EC2 or any Docker host)

`deploy/` holds a production stack: CoverPilot behind Caddy, which obtains and renews the HTTPS certificate automatically (the microphone only works on an HTTPS page). One command builds the image, copies it and your keys to the host over SSH (no registry), and starts everything:

```bash
deploy/deploy.sh ubuntu@<public-ip> <public-ip>          # served at https://<public-ip>.sslip.io
deploy/deploy.sh my-ec2-alias app.example.com             # or your own domain
# PLATFORM=linux/arm64 for Graviton; SSH_OPTS="-i key.pem" for a key file
```

- **Host needs:** Docker with the compose plugin, and a security group allowing 22, 80 and 443. UDP ports are not needed because voice audio relays through the configured TURN server (`TURN_*` in the env file).
- **Only Caddy is public.** The app and the voice agent are reachable only through it.
- **Keys** are copied to `~/coverpilot/secrets/.env.local` on the host (mode 600) and mounted read-only into the container.
- Update later by running the same command again; customer memory and cases persist in a Docker volume.

## 📄 License
MIT License. Built for the **Meta Hackathon 2026**.
