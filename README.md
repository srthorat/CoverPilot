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
| **🎙️ Full-Duplex Regional Voice** | Speak naturally in English, Hindi, or Marathi with natural barge-in interruption. Powered by Meta Muse Spark 1.3 + Voice Transcribe. |
| **🖱️ Pure Dual-Cursor Co-Browsing** | Agent glides a visible remote pointer, highlights form fields, and performs inputs in real time while applicant retains instant override. |
| **🪜 Complex Living Benefit Ladders** | 3-tier Critical Illness cover (Silver ₹10L / Gold ₹25L / Platinum ₹50L), ATPD 100-month salary replacement ladder, and Life Stage Cover Escalator. |
| **🛡️ Nomination & MWPA 1874 Trust Shield** | Meta Muse Wonder recommendation (70% Spouse / 30% Child split), minor appointee handling, and Section 6 Married Women's Property Act irrevocable creditor shield. |
| **⚖️ Statutory Terms & Conditions Drawer** | Interactive slide-over drawer with 8 IRDAI clauses (Section 45 incontestability, 30-day grace, 30-day free-look 100% refund, suicide 80% refund, 99.1% CSR). |
| **🪪 1-Click KYC Document OCR** | Multimodal ingestion of PAN / Aadhaar cards powered by Meta SAM 3.1 with client-side Zero-PII 8-digit masking and cursor autofill. |
| **💰 "What-If" Dual Tax & Net Cost Engine** | Real-time calculation of statutory deductions under Section 80C (Life Cover) and Section 80D (Health/Critical Illness). |
| **ℹ️ "Why Does ACKO Ask This?"** | Contextual explainer chips next to sensitive inputs explaining underwriting risk rationale in layman's terms with statutory citations. |
| **📜 Application Guardian Audit Certificate** | Generates a cryptographically hashed, downloadable compliance audit certificate (`.json`) guaranteeing Section 45 disclosure acknowledgment. |

---

## 📅 Today's Work & Engineering Log

Detailed work history, architecture decisions, and tomorrow's roadmap are documented in:
👉 **[TODAYS_WORK_HISTORY_AND_NEXT_STEPS.md](./TODAYS_WORK_HISTORY_AND_NEXT_STEPS.md)**

---

## 🏛️ System Architecture

CoverPilot follows a **Dual-Stream Decoupled Architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    WEBRTC_GATEWAY WEBRTC MEDIA                      │
│      1080p User Screen Stream + Two-Way Opus Audio Channel   │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐
│ LEAN CRITICAL PATH    │             │ ON-DEMAND SPECIALISTS │
│ (Low Latency Voice)   │             │ (Triggered by Events) │
├───────────────────────┤             ├───────────────────────┤
│ • Muse Voice          │             │ • Meta Muse Wonder 1.0│
│   Transcribe          │             │   (Actuarial & MWPA)  │
│ • Meta Muse Spark 1.3 │             │ • Meta Muse Image     │
│   (Session Reasoner)  │             │   (KYC Document OCR)  │
│ • DOM Mutation Tree   │             │ • SAM 3.1             │
│   (Sub-5ms telemetry) │             │   (Zero-PII Masking)  │
└───────────────────────┘             └───────────────────────┘
```

For the complete architectural design and evaluation, see [coverpilot_video_understanding_architecture.md](./coverpilot_video_understanding_architecture.md).

---

## 🤖 Meta Model Fleet

1. **Meta Muse Spark 1.3** — Real-time co-browsing session orchestrator, tool caller, and audio-to-audio conversational brain.
2. **Meta Muse Wonder 1.0** — Deep actuarial multi-step reasoning, Benefit Ladders, and IRDAI Section 39 / MWPA 1874 nomination optimization.
3. **Meta Muse Voice Transcribe** — Low-latency streaming speech-to-text with turn detection and code-switching (Hindi / Marathi / English).
4. **Meta SAM 3 (Segment Anything 3.1)** — Client-side visual document boundary segmentation and real-time Zero-PII masking on Aadhaar & PAN.
5. **Meta Muse Image** — Multimodal KYC document visual grounding and policy certificate synthesis.
6. **Meta Muse Glimmer** — Sub-pixel DOM coordinate resolution and virtual cursor gliding.
7. **Deterministic Core** — Exact actuarial tax math (80C + 80D), IRDAI policy evidence citations, and browser DOM action execution.

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
cp .env.local.example .env.local
# Add your META_API_KEY and WEBRTC_GATEWAY credentials in .env.local

# Run the development server
pnpm dev --port 3004
```

Open [http://localhost:3004](http://localhost:3004) in your browser.

---

## 📄 License
MIT License. Built for the **Meta Hackathon 2026**.
