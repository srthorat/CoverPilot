CoverPilot v2.0 — Complete must-have feature checklist
For an Indian term-life insurance copilot, I would define the requirements across co-browsing, real-time voice, insurance intelligence, IRDAI-related policy checks, secure document handling, agentic execution, and production reliability.

The core product principle is: CoverPilot understands the customer's goal, understands the current insurance application, explains using evidence, acts with permission, and verifies the result.

Not every feature below is a literal IRDAI mandate. Regulatory requirements must be mapped to the applicable IRDAI regulations, circulars, and the specific insurer's policy wording.
1. In-page co-browsing and visual assistance









CB-01 — Zero-install assistance

An embedded invitation such as “Start CoverPilot assistance” on a supported insurance portal, with a clear consent step before sharing begins.











CB-02 — Live page awareness

Detect labels, field types, required status, instructions, validation errors, selected options, and current section through the DOM and accessibility tree.











CB-03 — Screenshot and visual understanding

Analyze screenshots when the layout is ambiguous, the DOM is insufficient, or a visual error needs explanation. Match the result against the live page before acting.



Must-have technical behavior:
- Stable field references and invalidation when the page changes.
- Visible cursor movement and field highlighting when the agent acts.
- Current-page and current-session context.
- Pause screen sharing and immediately revoke agent control.
- Detect navigation, dynamic form changes, timeouts, and stale targets.
- Support only websites where the integration is authorized and technically permitted.
2. Real-time, human-like conversational experience

VOICE-01 — Two-way voice

Streaming speech-to-text, spoken responses, interruption handling, voice activity detection, and natural turn-taking.




VOICE-02 — Multilingual conversation

English, Hindi, and Marathi; code-switching; insurance terminology; language selection; and transcript correction. Test language quality before claiming full support.




VOICE-03 — Low-latency responses

Stream partial transcripts and audio where supported, use brief acknowledgements during complex work, cancel obsolete requests, and avoid waiting for a complete long response before beginning playback.




VOICE-04 — Conversational continuity

Remember the current task, completed sections, confirmed answers, unresolved questions, and user-selected language within the session.



Additional requirements:
- Push-to-talk and mute controls.
- Live transcript and microphone activity indicator.
- Clear listening, thinking, speaking, and acting states.
- User can interrupt speech or change their request at any time.
- Text fallback when microphone, network, transcription, or speech synthesis fails.
- Never treat an uncertain transcription as confirmation of a material insurance declaration.
3. Agentic task execution
The agent must do more than explain the screen. It must be able to complete a goal through controlled, verifiable steps.
ID	Must-have capability	Required behavior
AG-01	Goal understanding	Identify what the customer wants to accomplish.
AG-02	Task planning	Break a multi-step task into actions and dependencies.
AG-03	Tool selection	Choose browser, retrieval, document, or calculation tools as appropriate.
AG-04	Action proposal	Show the proposed change and its meaning before a consequential action.
AG-05	Human approval	Require explicit approval for material field changes and declarations.
AG-06	Execution	Use a typed, allowlisted browser-action executor, not arbitrary model-generated JavaScript.
AG-07	Verification	Check the actual resulting field value and page state.
AG-08	Recovery	Stop, explain, and recover safely from failed or stale actions.
AG-09	Progress tracking	Show completed, pending, blocked, and failed steps.
AG-10	Final submission protection	The customer reviews and performs final declarations, submission, and payment.

Essential rule: A model response saying “done” is not proof of success. The browser state must confirm the action.
4. Indian term-insurance policy intelligence
CoverPilot should identify and explain the following sections when they apply to the particular policy.
ID	Policy area	What the agent should understand
POL-01	Insurer and product identity	Insurer, product name, UIN and document version
POL-02	Policy schedule	Policy number, policyholder, life assured, commencement and term
POL-03	Sum assured and benefits	Death benefit, payout options, and product-specific benefits
POL-04	Premium conditions	Amount, frequency, due dates, grace period and non-payment consequences
POL-05	Exclusions	Exact exclusions, exceptions and conditions
POL-06	Suicide clause	Applicable product wording and benefit treatment
POL-07	Lapse and revival	Eligibility, time limits, outstanding premiums and underwriting conditions
POL-08	Free-look and cancellation	Applicable rights, deadlines and refund conditions
POL-09	Nomination	Nominee details, changes, minor nominee provisions and applicable legal requirements
POL-10	Assignment	Policy assignment provisions where applicable
POL-11	Riders	Attached riders, benefits, premiums, limitations and exclusions
POL-12	Claim process	Notification, documents, claim procedure and settlement provisions
POL-13	Customer Information Sheet	Cross-check the CIS against the policy and explain it simply
POL-14	Benefit illustration	Explain and cross-check the applicable illustration
POL-15	Proposal and disclosures	Explain health, occupation, income and lifestyle questions without inventing answers
POL-16	Grievance redressal	Insurer complaint process and relevant escalation channels
POL-17	Section 45	Explain the applicable statutory rules, conditions and exceptions
POL-18	Tax treatment	Explain applicable tax provisions using the current rules and relevant eligibility conditions

Every answer about a policy should include the source document and clause/page where available. When evidence is missing, the agent should explicitly say so.
5. Document upload, extraction and verification
Supported document categories
- Policy PDFs, policy schedules, CIS and brochures.
- Proposal forms and benefit illustrations.
- PAN, Aadhaar and other insurer-requested identity documents.
- Income and salary documents where required.
- Medical or health documents only when necessary and explicitly authorized.

Required features:
- PDF, image and document upload with file-type and size validation.
- OCR and structured field extraction.
- Page-level citations and source text.
- Compare extracted names, dates of birth and other relevant fields against user-confirmed form values.
- Flag discrepancies for the user to resolve; never silently overwrite a declaration.
- Distinguish unreadable, missing, conflicting and verified information.
- Protect documents in transit and at rest, with limited retention and access.
- Treat uploaded documents as untrusted input; ignore instructions embedded in them that attempt to control the agent.
KYC verification should not be represented as official identity authentication unless the required authorized verification process is actually integrated.
6. Privacy, consent and security
These should be part of the core design, not optional enhancements.
ID	Must-have feature	Requirement
SEC-01	Explicit consent	Explain what is shared and what the agent can do before starting.
SEC-02	Session controls	Pause sharing, mute audio, revoke control and end the session.
SEC-03	Sensitive-data masking	Detect and mask sensitive fields before screen data is transmitted wherever possible.
SEC-04	Data minimization	Share only the DOM nodes, document extracts or screenshots required for the task.
SEC-05	Secure transport	Encrypt audio, video, API requests and document transfers in transit.
SEC-06	Access control	Authenticate users and authorize agent, support, and administrative actions.
SEC-07	Tenant isolation	Prevent one customer's documents, session state or policy information from leaking into another tenant.
SEC-08	Secrets management	Keep provider API keys and service credentials out of browser code and logs.
SEC-09	Retention controls	Define retention, deletion, audit and backup policies for personal information.
SEC-10	Prompt-injection protection	Treat web pages, PDFs and tool results as untrusted content.
SEC-11	Audit trail	Record consent, approvals, proposed actions, execution results and relevant evidence without unnecessarily logging sensitive data.
SEC-12	Safe failure	Stop actions when permissions, identity, target or evidence are ambiguous.

For sensitive-field protection, use deterministic detection and masking where feasible, and evaluate SAM 3.1 as an additional visual segmentation component. Do not rely on a vision model alone to guarantee zero exposure of personal data.
7. Insurance-specific validation and application guardian
CoverPilot needs a deterministic validation layer alongside its AI models.
- Required and optional field detection.
- Field-format validation for dates, phone numbers, amounts and other structured inputs.
- Cross-field consistency checks.
- Missing declaration and incomplete-section detection.
- Proposal-form and document discrepancy warnings.
- Rider eligibility checks only where authoritative rules are available.
- Premium and tax calculations using validated inputs and versioned rules.
- Confirmation before changing a nominee, health declaration, income, smoking status or other material answer.
- A final checklist showing unresolved issues, possible inconsistencies and completed checks.
- No automatic invention of health history, income, beneficiaries or other personal information.
For example, if a user declares they are a non-smoker but another answer suggests smoking, CoverPilot should ask for clarification. It should not conclude that either answer is false without confirmation.
8. Model orchestration and performance
Use the Meta models according to their verified capabilities.
Component	Responsibility
Muse Spark 1.3	Primary conversational agent and tool selection
Muse Wonder	Complex, multi-step workflow reasoning
Muse Voice Transcribe	Speech-to-text and turn detection
SAM 3.1	Optional visual segmentation and tracking
Muse Spark Open	Optional self-hosted inference path
Muse Glimmer	Experimental local agent and tool-use workflows
Separate TTS provider	Streaming spoken responses
Deterministic services	Field validation, tax calculations, authorization and action verification

Required platform features:
- Per-model timeouts, retries, cancellation and rate-limit handling.
- Fallback behavior when a model or provider is unavailable.
- Session-state management and safe resumption.
- Request tracing across voice, reasoning, retrieval and browser actions.
- Model-cost tracking per session.
- Latency monitoring and concurrency tests.
- A clear distinction between verified capabilities and experimental ones.
Do not route every interaction through all six models. The fast path should handle common actions, while specialist models run only when needed.
9. Production readiness and operational requirements
Area	Must-have features
Backend APIs	Versioned APIs, schema validation, rate limiting, authentication and authorization
Real-time media	WebRTC connection management, reconnect behavior, audio quality monitoring and session termination
Browser integration	Supported-site validation, safe origin checks, stale-target detection and navigation handling
Observability	Structured logs, metrics, traces, error reporting and session-level correlation IDs
Reliability	Timeouts, retries with limits, idempotency where appropriate, graceful degradation and recovery
Scalability	Concurrent session testing, resource limits, backpressure and capacity planning
Testing	Unit, integration, browser automation, security, privacy, multilingual and load testing
Evaluation	Grounded-answer accuracy, transcription quality, action success, verification rate, latency and failure handling
Deployment	CI/CD, secret management, dependency scanning, environment separation, rollback and disaster recovery
Accessibility	Keyboard navigation, captions/transcripts, readable text and non-voice alternatives

10. The complete end-to-end acceptance test
CoverPilot should pass this scenario before the core MVP is considered ready:
MVP acceptance checklist
0 of 13



[ ] Customer explicitly accepts the co-browsing invitation.
[ ] Customer asks a question in Hindi or Marathi and receives an understandable spoken response.
[ ] Agent identifies the current field from live page context.
[ ] Policy explanation includes the actual source and clause/page where available.
[ ] Customer uploads a policy document and CoverPilot extracts relevant evidence.
[ ] A screenshot can be analyzed when DOM context is insufficient.
[ ] Agent proposes a material form change and waits for explicit approval.
[ ] The action executes only on the verified intended target.
[ ] The browser confirms the resulting value and detects validation errors.
[ ] Application guardian flags missing answers and possible inconsistencies.
[ ] Pause-sharing and revoke-control actions work immediately.
[ ] The agent handles a network or model failure without silently changing data.
[ ] Customer can review the application and personally perform final submission.
Reset checklistCopy checklist

Recommended implementation order
Phase	Scope
P0 — Core MVP	Co-browsing consent, DOM awareness, voice conversation, policy-grounded explanations, approval-based actions, verification, and secure session controls
P1 — Insurance intelligence	Document extraction, rider comparison, application guardian, multilingual quality, and screenshot analysis
P2 — Advanced agent	Complex workflow orchestration, proactive assistance, optional SAM visual processing, and self-hosted/local-agent experiments
P3 — Production hardening	Full security assessment, load testing, disaster recovery, comprehensive observability, and supported-site integrations

My recommendation: Treat P0 as the minimum viable product, but design the architecture so every section above can be added without rebuilding the system. For an Indian insurance product, the most important combination is reliable co-browsing, natural conversation, authoritative policy evidence, privacy protection, and human-controlled actions—not simply having the largest number of AI features.
















Pasted text(20261029-150738).txtDocument
check for below hakthan map feature with meta models












Worked for 18s
Analysis paused


Inspected hackathon map feature requirements





Mapped hackathon features


Inspected pasted hackathon guide contents





Searched 1 website













Hackathon fit: CoverPilot v2.0
The participant guide explicitly requires projects to incorporate Meta models through the Meta Model API or Meta open-weight models, and it warns against basic RAG applications and simple image analyzers. CoverPilot should therefore demonstrate an interactive, verifiable, multimodal agent, rather than just policy-document question answering. Pasted text.txt
 Pasted text.txt


I would map the product features to Meta models as follows, based on the capabilities in the model catalog you shared.
1. Feature-to-model mapping
Recommended architecture for CoverPilot v2.0, using six models from the catalog you shared. Capability descriptions are grounded in Meta's current model documentation. 
Meta Model API+5

CoverPilot feature	Primary Meta model	Supporting implementation
Real-time voice-guided insurance application	Muse Voice Transcribe	WebRTC, streaming TTS provider, session manager
Conversational insurance agent	Muse Spark 1.3	Policy retrieval, session context, tool calling
Complex multi-step co-browsing	Muse Wonder	Browser executor, action approval, state verification
Screenshot and visual page analysis	Muse Spark 1.3	Screenshot capture, DOM/accessibility context
Visual region segmentation and masking	SAM 3.1	Sensitive-field detection, deterministic masking
Document and policy understanding	Muse Spark 1.3	PDF/text extraction, OCR where needed, citations
Complex application review	Muse Wonder	Rules engine, document comparison, checklist
Private/local agent experimentation	Muse Glimmer	Local runtime, tool-use evaluation
Alternative self-hosted multimodal inference	Muse Spark Open	GPU inference infrastructure and evaluation

My recommendation: Use the first five as your primary hosted-model architecture, and select either Glimmer or Spark Open as your sixth model for a specific, demonstrable open-model use case. Both open-weight models are not required in the live request path.

Muse Spark Open has a significant deployment consideration: Meta's documentation lists 816B total parameters and 42B active parameters, so self-hosting requires substantial hardware even though only a subset of parameters is active per token. 
Meta Model API

2. Map the six models to actual user journeys
Journey A
“Guide me through my application by voice.”
1. Muse Voice Transcribe captures and transcribes the customer's speech.
2. Muse Spark 1.3 interprets the request with the current form context.
3. Muse Wonder is called only if a complex multi-step workflow is needed.
4. The TTS provider speaks the answer.
5. The browser executor performs approved changes and verifies them.


Journey B
“Explain what I see on this screen.”
1. Capture a screenshot only when visual context is needed.
2. Muse Spark 1.3 interprets the screenshot alongside DOM context.
3. SAM 3.1 segments a relevant visual region when necessary.
4. CoverPilot highlights the relevant field and explains it.
5. Any resulting browser action is independently validated.


Journey C
“Review these documents and check my application.”
1. Extract text and fields from uploaded files using an appropriate document pipeline.
2. Muse Spark 1.3 interprets the documents and compares their contents with the application.
3. Muse Wonder coordinates complex multi-document reviews.
4. Deterministic rules identify mismatches and missing answers.
5. CoverPilot presents evidence and asks the customer to resolve discrepancies.


Journey D
“Help me privately, using a locally hosted model.”
1. Evaluate Muse Glimmer or Muse Spark Open on a controlled task.
2. Measure accuracy, latency, memory consumption, and failure recovery.
3. Route suitable tasks to the local runtime only if it meets the required quality and performance thresholds.


3. What will make this competitive in the hackathon?
The participant guide specifically warns against basic RAG applications and simple image analyzers. Pasted text.txt


To make CoverPilot more than a document chatbot, demonstrate this loop:
Listen and observe

Voice + live form context

Reason with Meta models

Understand the goal and relevant evidence

Plan and propose

Select a tool and request approval

Act and verify

Visible browser action, verified outcome, safe recovery


The submission must also make your hackathon-built contributions identifiable, have a public repository, and include a three-minute demo video. Pasted text.txt
 Pasted text.txt

4. Final selection
Model	Decision
Muse Spark 1.3	Must use — primary agent
Muse Voice Transcribe	Must use — real-time voice input
Muse Wonder	Recommended — complex workflows
SAM 3.1	Recommended — meaningful visual segmentation demo
Muse Glimmer	Optional sixth — local-agent experimentation
Muse Spark Open	Alternative sixth — self-hosted multimodal inference

For the hackathon, I would prioritize the voice-guided co-browsing journey, supported by evidence-backed policy understanding and visible, verified browser actions. Add visual segmentation only if you can demonstrate its value, and keep local inference as an optional track.

This gives CoverPilot a clear Meta-model story, a real agentic interaction, and a demo that is more distinctive than basic RAG or image analysis.