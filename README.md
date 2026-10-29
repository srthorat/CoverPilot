<p align="center"><img src="omni_browse/public/brand/nexasure-logo.png" alt="NexaSure logo" width="360"></p>

> **Demo build:** the demo works on the bundled sample documents only. Reading a file the customer picks is implemented and tested but its controls are hidden unless the image is built with `NEXT_PUBLIC_ALLOW_OWN_FILES=true`.


# 🛡️ CoverPilot (OmniBrowse)

> **Autonomous Multimodal Co-Browsing & Voice Agent for Regulated Digital Insurance**  
> *Meta Hackathon 2026 — Track 1: Indie Developer Track*
>
> *Demo brand: **NexaSure**, a fictional AI-first digital insurance company. It is not a real insurer, and nothing in this project is an offer of insurance.*

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
| **⚖️ Statutory Terms & Conditions Drawer** | Interactive slide-over drawer with 8 IRDAI clauses (Section 45 incontestability, 30-day grace, 30-day free-look refund net of deductions, suicide clause, revival, digital claims targets). |
| **Integrity Guardian (second capability)** | The page opens on a choice: start a new policy (co-browse) or review a policy. Guardian reviews the proposed policy document your insurer gives you (or the draft proposal summary the app builds for you before issuance, clearly labelled as not a policy): the PDF is read in your browser, personal numbers are hidden with black bars and shown that way on screen, then a Meta model explains the document section by section with page references while deterministic checks compare it with your application (cover, premium, term, riders, nominees) and with fixed rules (grace period, suicide clause, free-look, Section 45). Findings are worded as possible issues, each with a page and, where it applies, a button back to the right application step. The agent can walk through the sections by voice, answers any question from the document passages, suggests questions to put to the insurer, and a readiness report (downloadable) lists what was reviewed and what is still open. It never changes the application and never says whether a claim would be paid. Review versions are tracked so you can fix, regenerate and review again. |
| **🪪 1-Click KYC with a blur-first PII shield** | A bundled fictional sample or a PNG/JPEG the customer picks is loaded **in the browser only**; the sharp original is never uploaded or stored. The browser blurs it until printed text is unreadable and sends only those copies through the app server to Meta: **SAM 3.1** finds the photo, signature and QR code on 60 and 66 px wide copies, and **Muse Spark** finds the ID numbers from the layout alone (Aadhaar number on 54, 60 and 63 px copies, PAN, UAN and bank account on 105 to 125 px copies; boxes are kept only where at least two copies agree, and a missing photo, signature, QR code or number fails the request so nothing is read). The browser then **pixelates those boxes on the sharp image**, and only that redacted image goes to **Muse Spark** for OCR, so the reader never sees the photo, signature, QR code or an ID number. Measured: Muse Spark could not read the Aadhaar number on copies up to 66 px wide, read part of it at 72 px and all of it at 90 px, which is why the copies are that blurry. Name, date of birth, address and PIN stay readable on the redacted image and do go to Meta, because the form is filled from them. A number read from an uploaded card is never returned, so the customer types Aadhaar and PAN themselves. If the reader can still return a full ID, the app warns. Limits: tuned on the three bundled layouts (8 of 8 sample runs clean, JPEG re-uploads of the PAN and Aadhaar samples worked); real cards vary, a rare correlated miss is possible, PDFs are not supported, and Meta's retention of API inputs is not verified. |
| **💰 "What-If" Tax & Net Cost Estimate** | Illustrative old-regime tax estimate (31.2% slab, ₹1.5 lakh cap, not tax advice); premiums carry no GST. |
| **ℹ️ "Why Does NexaSure Ask This?"** | Contextual explainer chips next to sensitive inputs explaining underwriting risk rationale in layman's terms with statutory citations. |
| **📜 Application Guardian Audit Certificate** | Downloadable compliance certificate (`.json`) with an independent auditor's narrative written by **Meta Muse Wonder** from the certificate payload. |
| **🖼️ Policy summary card** | Personalised policy card rendered by **Meta Muse Image 1.0**, pre-generated in the background on the last step so it is ready at issuance. |
| **💼 Income proof OCR** | Sample salary slip goes through the same shield (PAN, UAN and bank account number pixelated first), then is read by Muse Spark; annual income is autofilled. |
| **Confirm or Undo for material answers** | Income, smoking status and nominees entered by the agent show a Confirm / Undo card and block the step until the customer clicks; a spoken yes does not count, because speech recognition can be wrong. Values the customer types or picks need no approval. |
| **Documents never overwrite typed answers** | A scanned card or slip fills only empty fields. If it differs from what was typed, a card shows both values (Keep mine / Use the document's) and the step stays blocked until resolved. Step 5 has an Application check listing each check and what is still open. |
| **Policy or CIS PDF with page-cited answers** | The customer picks a PDF (or the sample at `/samples/sample-policy.pdf`). Text is read in the browser with pdf.js, Aadhaar, PAN, mobile, account and email patterns are masked there, and the agent's session keeps it in memory only. Each question retrieves the best few passages, the agent answers with the page, and the transcript shows the quoted source. Scanned PDFs (no selectable text) are not supported. |
| **Untrusted-document defences** | OCR output is validated field by field (`omni_browse/src/lib/ocr-clean.ts`: name, date of birth, PIN, gender and address must look like what they claim to be, long sentences become null); the agent prompt treats screen state, documents and excerpts as data, not instructions. A live test (`voice-agent-py/tests/integration/test_injection_live.py`) passed 9 of 9, but the same 9 also passed with the prompt rule removed, so the rule is defence in depth and the model already resisted these payloads. A short instruction made only of letters can still pass the field shape check. |
| **Model usage and failure handling** | The presenter panel shows per-session model usage: calls, average and maximum latency, and tokens where the API reports them. No dollar cost is claimed because prices are not configured. If the Wonder verifier fails, the customer is told the change was not verified. |
| **Pause and resume** | Every proposal has a unique code (`NXP-` plus 8 characters). Progress autosaves in this browser only, never including Aadhaar, PAN, mobile, signature or payment. Pause saves and ends the live session; Resume lists saved proposals. It does not resume on another device. |

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
| **SAM 3.1** `sam-3.1` | Text-prompted detection of the photo, signature and QR code on blurred copies of an ID card (boxes + masks); never sees the sharp image | `src/app/api/sam/route.ts`, warm-up in `server.mjs` |
| **Muse Wonder 1.0** `muse-wonder-1.0` | Asynchronous compliance verifier for every applied form action (4–9 s, off the spoken path); auditor's narrative for the certificate | `server/processors.mjs` → `WonderVerifier`, `src/app/api/audit/route.ts` |
| **Muse Spark** (ID locator) | Finds the PAN number, Aadhaar number, UAN and bank account number on blurred copies of the document (it never sees the numbers); asked at three blur levels, keeps only agreed positions and refuses if none agree; boxes are padded by the measured error before the browser pixelates them | `src/app/api/locate-ids/route.ts` |
| **Muse Image 1.0** `muse-image-1.0` | Policy summary card at issuance (pre-generated on the last step, ~15 s, cached); also generated the sample-card portrait and signature | `src/app/api/policy-card/route.ts`, `public/samples/` |

All five Model API models are therefore live in the product. Muse Spark Open is wired as an optional provider for the Guardian document review (set GUARDIAN_PROVIDER=spark-open with an OpenAI-compatible endpoint such as Fireworks or Baseten; it has not been tested without credentials, and a missing setting is an error, not a silent switch to Spark). Muse Glimmer (open weights) is on the roadmap only; Spark's native tool calling was evaluated and found inconsistent (one of two answers skipped the call), so form actions use a strict `<<ACTION>>` JSON marker instead. Muse Spark Open and Muse Glimmer are open-weights downloads, not Model API endpoints.

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

## Testing

- **Unit tests:** `cd voice-agent-py && uv run --with pytest python -m pytest -q tests/ --ignore=tests/harness_offline.py --ignore=tests/integration` and `cd omni_browse && pnpm test:unit`.
- **Live injection test (uses the Meta API key):** `uv run --with pytest python -m pytest -q tests/integration -s`.
- **Acceptance run:** `scripts/run-acceptance.sh` runs the Playwright suite in `omni_browse/e2e` (the 13-item acceptance scenario plus a prompt-injection check) against the Docker image on :3000, and a failure check (a failing model call changes no data) against a second instance started with an invalid key. Set `BROWSER=firefox` for Firefox. It talks to the live Meta models, and questions are typed into the same pipeline that voice uses. Reports are written to `docs/acceptance-report-<browser>.md`.
- Latest results: see docs/acceptance-report-chromium.md and docs/acceptance-report-firefox.md.


## 📄 License
MIT License. Built for the **Meta Hackathon 2026**.
