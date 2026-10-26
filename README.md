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
| **🎙️ Two-Way Regional Voice** | Speak naturally in English, Hindi, or Marathi. Powered by Meta Muse Voice Transcribe + low-latency neural synthesis. |
| **🖱️ Pure Dual-Cursor Co-Browsing** | Agent glides a visible remote pointer, highlights form fields, and demonstrates inputs while the applicant retains instant override (ESC / click anywhere). |
| **📜 Policy Evidence Drawer** | Grounded in verbatim policy wordings. Slide-out drawer with highlighted clauses for Section 45 Incontestability, Critical Illness (Clause 4.2), Grace Periods, and IRDAI compliance stamps. |
| **🪪 1-Click KYC Document OCR** | Multimodal ingestion of PAN / Aadhaar cards powered by Meta Muse Image + SAM 3.1 with client-side 8-digit masking and cursor autofill. |
| **💰 "What-If" Dual Tax & Net Cost Engine** | Real-time calculation of statutory deductions under Section 80C (Life Cover) and Section 80D (Health/Critical Illness). Demonstrates how tax savings make ₹25L Critical Illness cover net cost-negative. |
| **ℹ️ "Why Does ACKO Ask This?"** | Contextual explainer chips next to sensitive inputs (Income, Smoker status) explaining underwriting risk rationale in layman's terms. |
| **🛡️ Application Guardian Audit Certificate** | Generates a cryptographically hashed, downloadable compliance audit certificate (`.json`) guaranteeing Section 45 full disclosure acknowledgment. |

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
│ • Muse Voice          │             │ • Meta Muse Image     │
│   Transcribe          │             │   (KYC Document OCR)  │
│ • Meta Muse Spark 1.3 │             │ • SAM 3.1             │
│   (Session Reasoner)  │             │   (Bounding Boxes)    │
│ • DOM Mutation Tree   │             │ • Glimmer             │
│   (Sub-5ms telemetry) │             │   (Risk Underwriting) │
└───────────────────────┘             └───────────────────────┘
```

For the complete architectural design and evaluation, see [coverpilot_video_understanding_architecture.md](./coverpilot_video_understanding_architecture.md).

---

## 🤖 Meta Model Fleet

1. **Meta Muse Spark 1.3** — Real-time co-browsing session orchestrator, tool caller, and conversational reasoning core.
2. **Meta Muse Voice Transcribe** — Low-latency streaming speech-to-text with code-switching support (Hindi/Marathi/English).
3. **SAM 3.1 (Segment Anything)** — High-precision UI element and document bounding-box segmentation.
4. **Meta Muse Image** — Multimodal KYC document extraction for PAN and Aadhaar identity verification.
5. **Glimmer** — Edge-deployed underwriting risk scoring and disclosure verification.
6. **Meta Muse Code** — Dynamic in-browser DOM element selector synthesis and validation.
7. **Segment Anything 2 (SAM 2)** — Temporal tracking of animated UI components and error tooltips.
8. **SeamlessM4T v2** — Cross-lingual semantic alignment and regional dialect normalization.

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
