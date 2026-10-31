# CoverPilot demo script (3:00)

One story, one customer, one loop: **build the application by voice, get the draft policy, have an independent agent review it, fix what it finds, ship a readiness report.** Two different agents, each with its own prompt, knowledge base and voice.

Customer: Priya, first-time buyer, speaks Hindi and English, wants a 1.5 crore term plan. Browser: Chrome, 1512x860, mic checked, session already connected, sample documents ready.

Rules for the take: only show features built from Oct 27 on (the opening choice, Guardian, approvals, discrepancy card, step gate, pause and resume, PDF review, model usage table). Keep a "Built during the hackathon" caption in the corner for the whole video. Never show an API key, a real ID or a real policy.

| Time | What the viewer sees | What is said | Proof point for judges |
|---|---|---|---|
| 0:00-0:12 | Opening screen: **Start a new policy / Review a policy**. Caption: "Two agents on one Meta-powered runtime". Click Start a new policy, then Accept and start co-browsing. | Voice-over: "Insurance proposals are long, confusing, and people sign what they don't understand. CoverPilot fixes both ends." | Clear product, clear problem |
| 0:12-0:50 | Hands-free co-browse. Second cursor glides to each field. Priya: "My name is Priya Sharma, born fifth March nineteen ninety-two, female, I earn about eighteen lakhs, I don't smoke." Fields fill, the **Confirm / Undo** card appears for smoking status and income; Priya clicks Confirm. Interrupt the agent once mid-sentence. | Agent explains why each question is asked. | Voice (Voice Transcribe), actions with a visible cursor, **human approval** for material answers, barge-in |
| 0:50-1:05 | Priya scans the sample Aadhaar. Show the panel: "what the model sees" (blurred) against the redacted result. A **discrepancy card** appears because the name on the card differs from the one she typed; she picks. Caption: "Original never leaves the browser." | "Documents never overwrite what you said." | Blur-first privacy, SAM 3.1 + Spark locator, no silent overwrite |
| 1:05-1:20 | Asks in Hindi: "ग्रेस पीरियड कितना है?" The terms drawer opens on **Clause 2**, highlighted. Skip ahead: the step gate refuses to move on with a field missing and the agent says what is missing. | Agent answers in Hindi, cites the clause. | Multilingual, grounded in a source, safe stopping point |
| 1:20-1:35 | Step 5: **Application check** all green. Click **Download draft proposal summary** (caption: "a draft, not a policy"). Click **Review it with Integrity Guardian**. The voice changes: "I'm Integrity Guardian, the independent reviewer." | Guardian introduces itself. | A second, separate agent (own prompt, KB, voice) |
| 1:35-2:25 | Load **Sample proposed policy (with issues)**. The document appears with **black bars** over personal numbers. Run Guardian (about 20 s; talk over it with the model usage table in the corner). Findings appear with pages: sum assured 1 crore vs 1.5 crore, premium 1,180 vs 1,050, grace 10 days, suicide 24 months with no refund, Section 45 as two years, no nomination section. Priya asks by voice: "What happens if I miss a payment in month two?" Guardian answers from page 3 and flags that the grace period is below the rule. | "Possible issues, with the page, from a comparison, not a guess." | Document grounding with page citations, deterministic checks next to the model, not basic RAG |
| 2:25-2:45 | Click **Fix in the application** on the premium mismatch: the app returns to Step 2 and the co-browsing agent takes over, explains the field, Priya approves the correction. Back to Guardian: **Review again**; history shows "#1 7 issues, #2 5 issues". | "Review, resolve, review again." | The loop, versioned reviews |
| 2:45-3:00 | **Readiness report**: sections reviewed, issues still open, questions for the insurer. Caption: "You decide. Declarations, signature and payment stay with you." Final card: the five Meta models and what each does, plus the repo link. | "Voice, vision and reasoning on Meta models, with a human in control." | Meta tooling, trust and safety |

## Before recording
- Run `scripts/run-acceptance.sh` and check `docs/acceptance-report-chromium.md`; do not record on a build where a check fails.
- One full rehearsal with the real microphone in a quiet room; keep the second take as a backup.
- Clear localStorage so the opening choice shows; start a fresh session so no old transcript is visible.
- Pre-warm: open the app, accept the session, ask one throwaway question so the first real answer is fast.
- Record in Chrome only. If a model call stalls, cut to the backup take rather than waiting.

## Cut line if time runs long
Keep: voice co-browse, Confirm/Undo, Guardian findings with pages, Fix and Review again, readiness report.
Cut first: the Hindi beat, the privacy panel close-up, pause and resume.

## Claims to keep honest on screen and in voice-over
- Say "blurred copies go to Meta, the original stays in your browser", never "no data reaches Meta" (name, date of birth, address and PIN on the redacted image do).
- Say "possible issue", never "illegal" or "wrong". Never say a claim will or will not be paid.
- Say the insurer documents and product are fictional and the payment is a demo.

## Narration with the Meta models named (use this wording for the voice-over)

Naming: the first agent is **OmniCB Agent**, the co-browsing voice agent (say the full phrase once, then "OmniCB Agent"). The second is **Integrity Guardian**. Say each model where the viewer sees it work, not all at once.

| Clip | Models to say, and where |
|---|---|
| 1 Landing (about 28 s) | Card 1: "OmniCB Agent, our co-browsing voice agent, hears you with Muse Voice Transcribe, answers with Muse Spark and fills your application with you. Declarations, signature and payment stay yours." Card 2: "a second, independent agent, Integrity Guardian, reviews a proposed policy with Muse Spark Open." Strip: "Six Meta models in one runtime. First, a new policy." |
| 2 Voice fills the form | "Muse Voice Transcribe hears it, Muse Spark decides what to fill, and Muse Wonder checks each change before you confirm." |
| 3 Document and privacy | "SAM 3.1 finds the photo and signature on a blurred copy; Muse Spark reads only the redacted copy." |
| 4 Hindi and the step gate | "Muse Spark answers in Hindi and points to the clause." |
| 5 Step 5 | "OmniCB Agent checks that nothing is missing before the proposed policy is made." |
| 6 Guardian review | "Muse Spark Open, an open-weights model, reads the document, and fixed rules check it next to the model." |
| 7 Fix and review again | no new model; say "Review, resolve, review again." |
| 8 Readiness report | "Muse Image draws the policy card" only if the card is on screen; otherwise leave it for the end card. |
| End card | List all six with one line each, and say plainly: "Google Cloud text-to-speech is the one non-Meta part: the voice." |

Models and what each does in this build: Muse Spark (agent replies, reads the redacted ID, finds the number box, case notes), Muse Spark Open (Guardian review only), Muse Voice Transcribe (speech to text), Muse Wonder (checks each action the agent wants to make, and writes the audit note), SAM 3.1 (photo, signature and QR regions on a blurred copy), Muse Image (the policy card).
