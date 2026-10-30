'use client';

import { blurCopy } from '@/lib/kyc-blur';
import { ALLOW_OWN_FILES } from '@/lib/flags';
import { decryptDraft, encryptDraft, generateResumeKey, normalizeResumeKey, storedAuth, storeAuth, VaultKeyError } from '@/lib/vault';
import { extractPolicyPages, type PolicyPage } from '@/lib/pdf-text';
import { GuardianView, type GuardianReviewState } from '@/components/GuardianView';
import { runChecks, countIssues } from '@/lib/guardian-checks';
import { buildDraftSummaryPdf, type DraftSummary } from '@/lib/draft-pdf';
import { parseNomineeDob } from '@/lib/nominee-dob';
import type { GuardianResponse, ProposalFacts } from '@/lib/guardian-types';
import type { ModelUsage } from '@/components/PresenterPanel';
import { currentId, deleteDraft, loadDraft, newDraftId, normalizeCode, readIndex, saveDraft, setCurrent, type DraftMeta } from '@/lib/proposal-draft';
import { openIds, sealIds, type IdNumbers } from '@/lib/id-seal';
import { CLIENT_REVIEW_TIMEOUT_MS, reviewFailureMessage } from '@/lib/guardian-timing';

const IDLE_DISCONNECT_MS = 180_000; // the live voice session ends after 3 minutes without speech, a click or a key press
import React, { useState, useEffect, useRef } from 'react';
import { VoiceAgentClient, type AgentEvent, type AgentAction, type VoicePersona, type EnglishAccent, type CaseRecord } from '@/lib/voice-client';
import { MaskedIdField, maskAadhaar, maskPan, maskMobile } from '@/components/MaskedIdField';
import { PresenterPanel, describeFieldAction, type SessionStats, type TurnRecord, type TurnMarks } from '@/components/PresenterPanel';
import { toJpeg } from 'html-to-image';

// A PII region found by Meta SAM 3.1 (see /api/sam)
type KycRegion = {
  concept: string;
  box: { left: number; top: number; right: number; bottom: number };
  confidence: number | null;
  masks: Array<{ path: string; left: number; top: number }>;
  members: number;
};

// The privacy shield hides the ID number from the model, so after a sample scan the masked display
// uses the bundled sample card's known number. It is shown on this device only and never sent.
const SAMPLE_IDS = { aadhaar: '432187659012', pan: 'ABCPS1234K' } as const;

// Multilingual Guidance Knowledge Base (English, Hindi, Marathi)
const GUIDANCE_CONTENT: Record<
  string,
  {
    title: { en: string; hi: string; mr: string };
    advice: { en: string; hi: string; mr: string };
    spotlightId: string;
  }
> = {
  'field-full-name': {
    title: {
      en: 'Full Legal Name Guidance',
      hi: 'पूरा कानूनी नाम सहायता',
      mr: 'पूर्ण कायदेशीर नाव मार्गदर्शन',
    },
    advice: {
      en: 'Please enter your full legal name exactly as printed on your Aadhaar or PAN card. This guarantees a smooth, dispute-free claim settlement for your family.',
      hi: 'कृपया अपना पूरा कानूनी नाम दर्ज करें जैसा कि आपके आधार या पैन कार्ड पर लिखा है। इससे आपके परिवार को क्लेम सेटलमेंट के समय कोई परेशानी नहीं होगी।',
      mr: 'कृपया तुमचे पूर्ण कायदेशीर नाव टाका जसे ते तुमच्या आधार किंवा पॅन कार्डवर नोंदवले आहे. यामुळे भविष्यात क्लेम सेटलमेंटच्या वेळी कोणतीही अडचण येणार नाही.',
    },
    spotlightId: 'input-full-name',
  },
  'field-dob': {
    title: {
      en: 'Date of Birth (DD/MM/YYYY) Format',
      hi: 'जन्म तिथि (DD/MM/YYYY) प्रारूप सहायता',
      mr: 'जन्मतारीख (DD/MM/YYYY) फॉरमॅट मदत',
    },
    advice: {
      en: 'Date format can be confusing! Please enter your birth date in DD/MM/YYYY format, for example: 14/05/1994, exactly as shown on your PAN or school certificate.',
      hi: 'तारीख का प्रारूप DD/MM/YYYY (दिन/महीना/साल) में दर्ज करें, जैसे कि 14/05/1994, जैसा आपके पैन कार्ड या स्कूल प्रमाणपत्र पर है।',
      mr: 'जन्मतारीख टाकताना DD/MM/YYYY (दिवस/महिना/वर्ष) या फॉरमॅटमध्ये टाका, उदाहरणार्थ: 14/05/1994, जसे ते तुमच्या पॅन कार्डवर आहे.',
    },
    spotlightId: 'input-dob',
  },
  'field-gender': {
    title: {
      en: 'Gender Selection Guidance',
      hi: 'लिंग चयन सहायता',
      mr: 'लिंग निवड मार्गदर्शन',
    },
    advice: {
      en: 'Select your legal gender as per government records. Female policyholders receive an additional 15% discount on term life insurance rates.',
      hi: 'सरकारी दस्तावेजों के अनुसार अपना लिंग चुनें। महिला पॉलिसीधारकों को टर्म लाइफ इंश्योरेंस दरों पर 15% की अतिरिक्त छूट मिलती है।',
      mr: 'शासकीय कागदपत्रांनुसार तुमचे लिंग निवडा. महिला पॉलिसीधारकांना प्रीमियम दरांमध्ये 15% अतिरिक्त सवलत मिळते.',
    },
    spotlightId: 'field-gender',
  },
  'field-annual-income': {
    title: {
      en: 'Annual Income Tier Guidance',
      hi: 'वार्षिक आय श्रेणी सहायता',
      mr: 'वार्षिक उत्पन्न श्रेणी मार्गदर्शन',
    },
    advice: {
      en: 'Select your gross annual income before taxes from Form 16 or your latest ITR. Selecting ₹15L - ₹20L qualifies you for up to ₹2.00 Crore cover without physical medical checkups.',
      hi: 'फॉर्म 16 या ITR के अनुसार अपनी कुल वार्षिक आय चुनें। 15 लाख से 20 लाख चुनने पर बिना किसी मेडिकल टेस्ट के 2 करोड़ तक का कवर मिलता है।',
      mr: 'फॉर्म 16 किंवा ITR नुसार तुमचे वार्षिक उत्पन्न निवडा. 15 ते 20 लाख निवडल्यास कोणत्याही मेडिकल टेस्टशिवाय 2 कोटी रुपयांपर्यंतचे कव्हर मिळते.',
    },
    spotlightId: 'select-annual-income',
  },
  'field-smoking': {
    title: {
      en: 'Smoking / Tobacco Habit Guidance',
      hi: 'धूम्रपान / तंबाकू आदत सहायता',
      mr: 'धूम्रपान / तंबाखू सवय मार्गदर्शन',
    },
    advice: {
      en: 'If you have not consumed cigarettes, beedis, or nicotine products in the last 12 months, choose "Non-Smoker"to unlock an instant 20% health discount for your entire policy tenure.',
      hi: 'यदि आपने पिछले 12 महीनों में सिगरेट, बीड़ी या निकोटीन का सेवन नहीं किया है, तो "Non-Smoker"चुनें और पूरे 30 साल के लिए 20% की सीधी छूट पाएं।',
      mr: 'जर तुम्ही मागील 12 महिन्यांत सिगारेट, विडी किंवा तंबाखूचे सेवन केले नसेल, तर "Non-Smoker"निवडा आणि संपूर्ण पॉलिसीसाठी 20% थेट सूट मिळवा.',
    },
    spotlightId: 'field-smoking',
  },
  'field-city': {
    title: {
      en: 'City & PIN Code Guidance',
      hi: 'शहर और पिन कोड सहायता',
      mr: 'शहर आणि पिन कोड मार्गदर्शन',
    },
    advice: {
      en: 'Enter your residential city and 6-digit PIN code. This enables instant verification with local cashless partner hospital networks.',
      hi: 'अपना शहर और 6 अंकों का पिन कोड दर्ज करें। इससे आपके नजदीकी कैशलेस पार्टनर अस्पतालों की सूची तुरंत सत्यापित हो जाती है।',
      mr: 'तुमचे शहर आणि 6 अंकी पिन कोड टाका. यामुळे तुमच्या परिसरातील कॅशलेस हॉस्पिटल नेटवर्कची माहिती लगेच पडताळली जाते.',
    },
    spotlightId: 'field-city',
  },
  'card-critical-illness': {
    title: {
      en: 'Critical Illness Living Benefit Rider',
      hi: 'क्रिटिकल इलनेस राइडर सहायता',
      mr: 'क्रिटिकल इलनेस रायडर मार्गदर्शन',
    },
    advice: {
      en: 'Regular term insurance only pays upon death. The Critical Illness Rider pays ₹25,00,000 cash directly to your bank account upon diagnosis of 36 conditions like heart attack, cancer, or stroke while you recover.',
      hi: 'साधारण टर्म प्लान केवल मृत्यु पर पैसा देता है। क्रिटिकल इलनेस राइडर हार्ट अटैक, कैंसर या स्ट्रोक जैसी 36 बीमारियों के इलाज के लिए ₹25 लाख सीधे बैंक खाते में देता है।',
      mr: 'साधा टर्म इन्शुरन्स केवळ निधनानंतर पैसे देतो. क्रिटिकल इलनेस रायडर हार्ट अटॅक किंवा कॅन्सरसारख्या 36 आजारांच्या उपचारासाठी 25 लाख रुपये थेट बँकेत देतो.',
    },
    spotlightId: 'card-critical-illness',
  },
  'card-waiver-premium': {
    title: {
      en: 'Waiver of Premium (WOP) Rider',
      hi: 'वेवर ऑफ प्रीमियम राइडर सहायता',
      mr: 'वेव्हर ऑफ प्रीमियम रायडर मार्गदर्शन',
    },
    advice: {
      en: 'For just ₹42/month, if an accidental disability occurs, you never have to pay another rupee for the entire 30 years, and your full ₹1.5 Crore cover stays active for your family.',
      hi: 'मात्र ₹42/माह में, यदि कोई विकलांगता होती है, तो अगले 30 वर्षों तक आपको एक रुपया भी नहीं देना होगा और आपकी ₹1.5 करोड़ की पॉलिसी सक्रिय रहेगी।',
      mr: 'फक्त ₹42/महिना दराने, जर अपघाती अपंगत्व आले तर पुढील 30 वर्षे तुम्हाला एक रुपयाही भरावा लागणार नाही आणि कुटुंबाचे ₹1.5 कोटींचे कव्हर सुरू राहील.',
    },
    spotlightId: 'card-waiver-premium',
  },
  'field-section-45': {
    title: {
      en: 'Section 45 Statutory Claim Guarantee',
      hi: 'धारा 45 वैधानिक क्लेम गारंटी',
      mr: 'कलम 45 वैधानिक क्लेम हमी',
    },
    advice: {
      en: 'Under Section 45 of the Insurance Act, always disclose known health conditions like family cardiac history. Once your policy completes 3 continuous years, the law prohibits insurers from disputing claims.',
      hi: 'बीमा अधिनियम की धारा 45 के तहत, परिवार की स्वास्थ्य जानकारी पूरी ईमानदारी से दें। 3 साल पूरे होने के बाद बीमा कंपनी आपके क्लेम पर कोई सवाल नहीं उठा सकती।',
      mr: 'विमा कायदा कलम 45 नुसार, कुटुंबातील आजारांची माहिती प्रामाणिकपणे द्या. 3 वर्षे पूर्ण झाल्यानंतर विमा कंपनी तुमच्या क्लेमवर कोणताही आक्षेप घेऊ शकत नाही.',
    },
    spotlightId: 'field-section-45',
  },
};

export function InsuranceApp({ initialPresenter = false }: { initialPresenter?: boolean }) {
  // Current Step in the Insurance Purchase Journey (1 to 4)
  const [activeStep, setActiveStep] = useState<number>(1);

  // Preferred Language: English | Hindi (हिंदी) | Marathi (मराठी)
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'hi' | 'mr'>('en');

  // Voice personas, rendered by Google Cloud TTS (Chirp 3 HD, en-IN): veena & nova female, rishi & aura male.
  // The Meta Model API has no text-to-speech model; everything upstream of playback is Meta.
  const [selectedVoicePersona, setSelectedVoicePersona] = useState<VoicePersona>('veena');
  const [englishAccent, setEnglishAccent] = useState<EnglishAccent>('in');

  // Step 1: Blank initial form (NO prefilled data)
  const [profile, setProfile] = useState({
    fullName: '',
    dob: '', // DD/MM/YYYY format
    gender: '',
    annualIncome: '',
    isSmoker: null as boolean | null,
    city: '',
    pincode: '',
    // Identity numbers stay in the browser: they are not part of the screen state sent to the agent,
    // are shown masked unless the field has focus, and their fields are left out of form screenshots.
    aadhaarNumber: '',
    panNumber: '',
    mobileNumber: '',
  });
  // Where a value came from, so a sample scan is labelled as such (typing replaces it)
  const [idFromSample, setIdFromSample] = useState<{ aadhaar: boolean; pan: boolean }>({ aadhaar: false, pan: false });

  // Step 2: Plan & Rider Customization
  const [baseSumAssured, setBaseSumAssured] = useState<'1cr' | '1.5cr' | '2cr'>('1.5cr');
  const [selectedRiders, setSelectedRiders] = useState<{
    criticalIllness: boolean;
    accidentalDeath: boolean;
    waiverOfPremium: boolean;
    hospitalCash: boolean;
  }>({
    criticalIllness: false,
    accidentalDeath: false,
    waiverOfPremium: false,
    hospitalCash: false,
  });

  // Step 3: Nomination & Beneficiary Allocation (IRDAI Section 39 & MWPA 1874)
  const [nomination, setNomination] = useState({
    primaryName: '',
    primaryRelation: 'Spouse',
    primaryDob: '',
    primaryShare: 100,
    hasSecondaryNominee: false,
    secondaryName: '',
    secondaryRelation: 'Child',
    secondaryAge: 7,
    secondaryShare: 30,
    // Third and fourth nominees (the secondary nominee above is the second)
    additionalNominees: [] as Array<{ name: string; relation: string; age: number; share: number }>,
    appointeeName: '',
    appointeeRelation: 'Grandparent',
    mwpaTrustEnabled: false,
  });

  // Step 2: Complex Benefit Ladders & Living Benefit Tiers
  const [ciTier, setCiTier] = useState<'tier1' | 'tier2' | 'tier3'>('tier2'); // Silver 10L (₹89), Gold 25L (₹149), Platinum 50L (₹269)
  const [atpdOption, setAtpdOption] = useState<'lump' | 'income'>('lump'); // Lump 50L (+₹79) or Income Replacement 1L/mo x 100 mo (+₹129)
  const [lifeStageEscalator, setLifeStageEscalator] = useState<boolean>(false); // +₹49/mo
  const [terminalIllnessCover, setTerminalIllnessCover] = useState<boolean>(true); // Built-in ₹0

  // Statutory Terms & Conditions Interactive Drawer
  const [showTermsDrawer, setShowTermsDrawer] = useState<boolean>(false);
  // The clause the agent is explaining: highlighted and scrolled into view in the terms drawer
  const [highlightedClause, setHighlightedClause] = useState<string | null>(null);
  const [termsSearchQuery, setTermsSearchQuery] = useState<string>('');

  // Real per-turn latency telemetry from the live Meta voice loop
  const voiceTelemetryRef = useRef<{ sparkModel?: string | null }>({});
  const modeRef = useRef<'cobrowse' | 'guardian'>('cobrowse');
  const guardianSectionRef = useRef(0);
  const [voiceTelemetry, setVoiceTelemetry] = useState<{
    asrModel: string | null;
    asrSessionId: string | null;
    asrTurnMs: number | null; // speechEnd -> speechComplete (Meta endpointing + final transcript)
    sparkModel: string | null;
    sparkTtftMs: number | null; // request -> first streamed token
    sparkTotalMs: number | null;
    reasoningEffort: string | null;
    ttsVoice: string | null;
    ttsMs: number | null; // Google TTS latency for the first sentence of the last answer
    lastError: string | null;
  }>({
    asrModel: null,
    asrSessionId: null,
    asrTurnMs: null,
    sparkModel: null,
    sparkTtftMs: null,
    sparkTotalMs: null,
    reasoningEffort: null,
    ttsVoice: null,
    ttsMs: null,
    lastError: null,
  });

  // Step 4: Medical & Underwriting Disclosures
  const [underwriting, setUnderwriting] = useState({
    familyCardiacHistory: false,
    priorHospitalization: false,
    substanceUse: false,
    section45Consent: false,
  });

  // Step 5: Proposal Binding & Receipt
  const [proposalId, setProposalId] = useState<string>('');
  const [policyIssued, setPolicyIssued] = useState<boolean>(false);
  // Checkout: the customer signs the proposal, then pays the first premium. Both are demos and both are
  // customer-only: nothing the agent does can sign or pay.
  const [esign, setEsign] = useState<{ typedName: string; consent: boolean; signedAt: string | null; hash: string | null; fingerprint: string | null; error: string | null }>({
    typedName: '',
    consent: false,
    signedAt: null,
    hash: null,
    fingerprint: null,
    error: null,
  });
  const [payment, setPayment] = useState<{ mode: 'upi' | 'card' | 'netbanking' | 'autopay'; status: 'idle' | 'processing' | 'paid'; txnId: string | null; paidAt: string | null; amount: number | null }>({
    mode: 'upi',
    status: 'idle',
    txnId: null,
    paidAt: null,
    amount: null,
  });

  // OmniCB Agent Co-Browsing State (Observation Mode + Auto-Play Multilingual Voice Guidance)
  const [activeGuidanceKey, setActiveGuidanceKey] = useState<string>('field-full-name');
  const [spotlightedElementId, setSpotlightedElementId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // WebRTC co-browsing session state
  const [isCoBrowsingConnected, setIsCoBrowsingConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [dismissOffer, setDismissOffer] = useState<boolean>(false);

  // Pure Co-Browsing: Screen Share & Screen Control States
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isSharingPaused, setIsSharingPaused] = useState<boolean>(false);
  const [privacyShieldActive, setPrivacyShieldActive] = useState<boolean>(true);
  const [screenControlStatus, setScreenControlStatus] = useState<'granted' | 'revoked' | 'requesting'>('revoked');
  const [agentCursor, setAgentCursor] = useState<{
    visible: boolean;
    x: number;
    y: number;
    clicking: boolean;
    label: string;
    actionDesc: string;
  }>({
    visible: false,
    x: 500,
    y: 350,
    clicking: false,
    label: 'OmniCB Agent',
    actionDesc: 'Screen Control Ready',
  });
  const [clickIndicators, setClickIndicators] = useState<Array<{ id: number; x: number; y: number }>>([]);
  
  const GREETING_TEXT: Record<'en' | 'hi' | 'mr', string> = {
    en: 'Welcome to NexaSure! I am OmniCB Agent. Connecting your secure live voice session now.',
    hi: 'NexaSure में आपका स्वागत है! मैं OmniCB एजेंट हूँ। आपका सुरक्षित लाइव वॉइस सत्र अभी जोड़ रहा हूँ।',
    mr: 'NexaSure मध्ये आपले स्वागत आहे! मी OmniCB एजंट आहे. तुमचे सुरक्षित लाइव्ह व्हॉइस सत्र आता जोडत आहे.',
  };
  const [chatMessages, setChatMessages] = useState<Array<{ id?: number; sender: 'user' | 'agent'; text: string; time: string }>>([
    {
      sender: 'agent',
      text: "Welcome to NexaSure! I am OmniCB Agent. When you are ready, click 'Accept and start co-browsing'to begin our secure live voice session.",
      time: 'Just now',
    },
  ]);
  const [userQuery, setUserQuery] = useState<string>('');

  // Live two-way voice: mic -> Meta Muse Voice Transcribe (realtime WS) -> Muse Spark (streamed) -> Google Cloud TTS (PCM over the socket)
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [voiceTranscriptLive, setVoiceTranscriptLive] = useState<string>('');
  const [voiceThinking, setVoiceThinking] = useState<boolean>(false);
  const micDecibelBarRef = useRef<HTMLDivElement | null>(null);
  const micDecibelTextRef = useRef<HTMLSpanElement | null>(null);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const agentRef = useRef<VoiceAgentClient | null>(null);
  const welcomeRef = useRef<{ text: string; lang: 'en' | 'hi' | 'mr'; greetingDone: boolean; ready: boolean; spoken: boolean }>({ text: '', lang: 'en', greetingDone: false, ready: false, spoken: false });
  const maybeSpeakAgentWelcome = () => {
    const w = welcomeRef.current;
    if (w.spoken || !w.greetingDone || !w.ready || !w.text) return;
    w.spoken = true;
    agentRef.current?.speakLocal(w.text, w.lang);
  };
  const lastGuidanceRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const [memoryFacts, setMemoryFacts] = useState<string[]>([]);
  // Stable per-browser id so the agent can remember a returning customer (demo only).
  const getCustomerId = () => {
    try {
      // The id is the only proof of whose memory this is, so it is a random 128-bit UUID, never a guessable value.
      // An older short id is replaced (the server refuses anything that is not a UUID or 32+ hex characters).
      let id = localStorage.getItem('coverpilot-customer-id');
      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        id = crypto.randomUUID();
        localStorage.setItem('coverpilot-customer-id', id);
      }
      return id;
    } catch {
      return null;
    }
  };
  const localAudioRef = useRef<HTMLAudioElement | null>(null); // pre-session speech via /api/tts
  const voicePersonaRef = useRef<VoicePersona>('veena');
  const accentRef = useRef<EnglishAccent>('in');
  const [ttsProvider, setTtsProvider] = useState<'google' | 'meta-mms'>('google'); // applies to the next voice session
  const ttsProviderRef = useRef<'google' | 'meta-mms'>('google');
  const [sessionTts, setSessionTts] = useState<'google' | 'meta-mms'>('google'); // engine of the live session
  const currentAgentMsgIdRef = useRef<number | null>(null);
  const agentTextRef = useRef<string>('');
  const [agentState, setAgentState] = useState<'listening' | 'thinking' | 'speaking'>('listening');
  const isSpeakingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);
  const isCoBrowsingConnectedRef = useRef<boolean>(false);
  const lastActivityRef = useRef<number>(0); // set in effects and handlers, never read the clock during prerender
  const [idlePaused, setIdlePaused] = useState(false);
  const chatRef = useRef<Array<{ sender: 'user' | 'agent'; text: string }>>([]);
  // Latest render's handlers, so long-lived agent callbacks never act on stale state.
  const latestRef = useRef<{
    applyAction: (a: AgentAction) => void;
    lang: 'en' | 'hi' | 'mr';
    screenState: () => unknown;
    activeStep: number;
  }>({ applyAction: () => {}, lang: 'en', screenState: () => ({}), activeStep: 1 });
  // A step may only be left once it is valid; this holds what the customer was told when blocked.
  // Customer-picked document: the original stays in this browser (see handleRunSampleKycOcr).
  const [uploadDocType, setUploadDocType] = useState<'pan' | 'aadhaar' | 'salary-slip'>('pan');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // Step 2 needs a decision: at least one rider, or an explicit "no riders".
  const [noRiders, setNoRiders] = useState(false);
  // A document never overwrites what the customer typed: a difference is shown and the customer picks.
  type DocDiscrepancy = { field: 'fullName' | 'dob' | 'pincode' | 'gender' | 'annualIncome'; label: string; typed: string; fromDocument: string; source: string };
  // Material answers the agent entered (income, smoking status, nominees) wait for the customer's click:
  // Confirm keeps them, Undo restores the previous value. A spoken "yes" never counts, because speech
  // recognition can be wrong. Typing or choosing the value yourself needs no approval.
  type PendingApproval = { key: 'annualIncome' | 'isSmoker' | 'nominee'; label: string; undo: () => void; applied?: string };
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  // What each Meta model has been asked this session: calls, latency and tokens where the API reports them.
  const [modelUsage, setModelUsage] = useState<Record<string, ModelUsage>>({});
  const recordModel = (model: string | undefined, role: string, ms?: number | null, tokens?: { promptTokens?: number | null; completionTokens?: number | null }) => {
    if (!model) return;
    setModelUsage((prev) => {
      const cur = prev[model] ?? { role, calls: 0, totalMs: 0, maxMs: 0, promptTokens: 0, completionTokens: 0 };
      return {
        ...prev,
        [model]: {
          ...cur,
          calls: cur.calls + (ms !== undefined ? 1 : 0),
          totalMs: cur.totalMs + (ms ?? 0),
          maxMs: Math.max(cur.maxMs, ms ?? 0),
          promptTokens: cur.promptTokens + (tokens?.promptTokens ?? 0),
          completionTokens: cur.completionTokens + (tokens?.completionTokens ?? 0),
        },
      };
    });
  };
  // The customer's own policy or CIS: read and masked in this browser; the agent gets only matching passages.
  const [policyDoc, setPolicyDoc] = useState<{ name: string; pages: PolicyPage[]; masked: number; status: 'reading' | 'ready' | 'sent' | 'error'; error?: string } | null>(null);
  // Two capabilities on one agent: build the application (co-browse), then review the proposed policy (Guardian).
  const [mode, setMode] = useState<'cobrowse' | 'guardian'>('cobrowse');
  // On opening the page the customer chooses: a new policy (co-browse) or a review of a policy they already have.
  const [entry, setEntry] = useState<'choose' | 'done'>('choose');
  // Two distinct agents on the server: the one that fills the application and the one that reviews a policy.
  const [agentRole, setAgentRole] = useState<'cobrowse' | 'guardian'>('cobrowse');
  const [agentName, setAgentName] = useState('OmniCB co-browsing agent');
  const introducedModeRef = useRef<'cobrowse' | 'guardian' | null>(null);
  const [guardianReview, setGuardianReview] = useState<GuardianReviewState>({ status: 'idle', checks: [], history: [] });
  // Bumped whenever the document changes or a run is cancelled, so a late answer for an earlier document is dropped.
  const guardianRunRef = useRef(0);
  const guardianAbortRef = useRef<AbortController | null>(null);
  const resetGuardian = () => {
    guardianRunRef.current += 1;
    guardianAbortRef.current?.abort();
    setGuardianReview((r) => ({ status: 'idle', checks: [], history: r.history }));
  };
  const [guardianSection, setGuardianSection] = useState(0);
  const [reviewedSections, setReviewedSections] = useState<number[]>([]);
  const [askedQuestions, setAskedQuestions] = useState<string[]>([]);
  const [docDiscrepancies, setDocDiscrepancies] = useState<DocDiscrepancy[]>([]);
  // Pause and resume: every proposal in progress has its own code, saved in this browser only.
  const [draftId, setDraftId] = useState('');
  const [draftReady, setDraftReady] = useState(false); // autosave waits until the customer has chosen resume or new
  const [pendingResume, setPendingResume] = useState<DraftMeta | null>(null);
  const [showResumePanel, setShowResumePanel] = useState(false);
  const [savedProposals, setSavedProposals] = useState<DraftMeta[]>([]);
  const [resumeCode, setResumeCode] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [pausedNote, setPausedNote] = useState<string | null>(null);
  // Resuming on another device: the proposal code names the draft, the resume key (shown once at Pause) proves it is yours.
  const [pausedKey, setPausedKey] = useState<string | null>(null);
  const [remoteId, setRemoteId] = useState('');
  const [remoteKey, setRemoteKey] = useState('');
  const [remoteError, setRemoteError] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [stepNotice, setStepNotice] = useState<{ step: number; issues: string[] } | null>(null);
  const stepGateRef = useRef<{ issues: Record<number, Array<{ id: string; msg: string }>>; maxReachable: number }>({
    issues: {},
    maxReachable: 1,
  });
  voiceTelemetryRef.current = voiceTelemetry;
  modeRef.current = mode;
  guardianSectionRef.current = guardianSection;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const nominationRef = useRef<any>(null);
  const stampNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Observation Timer & Focused Field Tracking
  const [currentFocusedField, setCurrentFocusedField] = useState<string | null>(null);
  const [idleSeconds, setIdleSeconds] = useState<number>(0);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 5 High-Impact Value Differentiator States
  const [showEvidenceDrawer, setShowEvidenceDrawer] = useState<boolean>(false);
  const [selectedEvidenceClause, setSelectedEvidenceClause] = useState<string>('clause-42');
  const [showAuditCertModal, setShowAuditCertModal] = useState<boolean>(false);
  const [auditCertData, setAuditCertData] = useState<any>(null);
  const [kycSampleCard, setKycSampleCard] = useState<'pan' | 'aadhaar' | null>(null);
  // SAM 3.1 PII shield: regions found, the locally redacted image, and timings
  const [kycRedaction, setKycRedaction] = useState<{
    type: 'pan' | 'aadhaar' | 'salary-slip';
    imageUrl: string;
    width: number;
    height: number;
    regions: KycRegion[];
    redactedDataUrl: string | null;
    samMs: number | null;
    samCached: boolean;
    locateMs: number | null;
    ocrMs: number | null;
    status: string;
  } | null>(null);
  // The shield panel shows the redacted document while it works, then folds itself away once the form
  // is filled. A warning or a failure keeps it open, and the header toggles it by hand.
  const [kycPanelOpen, setKycPanelOpen] = useState<boolean>(true);
  const kycCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (kycCollapseTimer.current) clearTimeout(kycCollapseTimer.current);
    if (kycRedaction?.status === 'Done') {
      kycCollapseTimer.current = setTimeout(() => setKycPanelOpen(false), 6000);
    }
    return () => {
      if (kycCollapseTimer.current) clearTimeout(kycCollapseTimer.current);
    };
  }, [kycRedaction?.status, kycRedaction?.type]);
  // Session-worker telemetry: Muse Wonder verdicts and Spark pre-answered questions
  const [verifications, setVerifications] = useState<
    Array<{ id: string; status: string; actionTitle: string; reason?: string; clause?: string | null; ms?: number; model: string }>
  >([]);
  const [prefetchInfo, setPrefetchInfo] = useState<{ questions: string[]; ms: number; step: number | null } | null>(null);
  // Muse Image policy card, pre-generated on the last step
  const [policyCard, setPolicyCard] = useState<{ status: 'idle' | 'generating' | 'ready' | 'error'; dataUrl: string | null; ms: number | null; error?: string }>({
    status: 'idle',
    dataUrl: null,
    ms: null,
  });
  const policyCardKeyRef = useRef<string>('');
  const formBodyRef = useRef<HTMLDivElement | null>(null);
  // Customer-facing by default; model names, timings and internals only when this is on.
  const [showDevPanel, setShowDevPanel] = useState<boolean>(false);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats>({ interrupts: 0, approve: 0, amend: 0, reject: 0, error: 0 });
  const speechEndRef = useRef<number | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [presenterMode] = useState<boolean>(initialPresenter);
  const devRef = useRef<boolean>(false);
  // "What the agent sees": the last frame + state actually sent to Muse Spark.
  const [agentView, setAgentView] = useState<{ frameDataUrl: string | null; sentAt: number | null; step: number | null }>({
    frameDataUrl: null,
    sentAt: null,
    step: null,
  });
  const [showAgentView, setShowAgentView] = useState<boolean>(false);
  const [showAgentFrameModal, setShowAgentFrameModal] = useState<boolean>(false);
  const [showTaxBreakdownWidget, setShowTaxBreakdownWidget] = useState<boolean>(true);
  const [showPremiumDetail, setShowPremiumDetail] = useState<boolean>(false);
  const [showSessionControls, setShowSessionControls] = useState<boolean>(false);
  const [activeWhyAskField, setActiveWhyAskField] = useState<string | null>(null);

  // Web Audio chime to ensure immediate audible feedback on modern browsers
  const playChime = () => {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 note
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5 note
      
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
    } catch (e) {
      console.log('Audio chime error:', e);
    }
  };

  // Sanitize text for ultra-natural spoken prosody (zero asterisks, emojis, or punctuation glitches)
  const cleanSpokenText = (raw: string): string => {
    return raw
      .replace(/[*_#`~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/₹\s*([0-9,]+)/g, 'Rupees $1')
      .replace(/[✓•]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const setSpeakingState = (speaking: boolean) => {
    setIsSpeaking(speaking);
    isSpeakingRef.current = speaking;
  };

  // Spoken output is Google Cloud TTS everywhere. While the agent session is live, client
  // lines (welcome, field guidance) go through the agent's audio queue so the server knows
  // the bot is talking and mutes the mic; before the session exists they use /api/tts.
  const speakText = (text: string, lang: 'en' | 'hi' | 'mr', onEnd?: () => void) => {
    if (typeof window === 'undefined') return;
    const clean = cleanSpokenText(text);
    if (!clean) {
      onEnd?.();
      return;
    }
    const agent = agentRef.current;
    if (agent && agent.isOpen) {
      agent.speakLocal(clean, lang);
      onEnd?.();
      return;
    }
    void (async () => {
      try {
        localAudioRef.current?.pause();
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, lang, persona: voicePersonaRef.current, accent: accentRef.current }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        localAudioRef.current = audio;
        audio.onplay = () => setSpeakingState(true);
        audio.onended = () => {
          setSpeakingState(false);
          URL.revokeObjectURL(url);
          onEnd?.();
        };
        audio.onerror = () => {
          setSpeakingState(false);
          onEnd?.();
        };
        await audio.play();
      } catch (e: any) {
        setChatMessages((prev) => [...prev, { sender: 'agent', text: `Google TTS failed (no fallback): ${e?.message || e}`, time: stampNow() }]);
        onEnd?.();
      }
    })();
  };

  const cancelAgentSpeech = () => {
    localAudioRef.current?.pause();
    agentRef.current?.interrupt();
  };

  // Dynamic Real-time Screen Reader for Meta Multimodal Models (Zero Hardcoded logic)
  const getLiveScreenSnapshot = () => {
    const unfilled: string[] = [];
    if (!profile.fullName) unfilled.push('field-full-name');
    if (!profile.dob) unfilled.push('field-dob');
    if (!profile.gender) unfilled.push('field-gender');
    if (!profile.annualIncome) unfilled.push('field-annual-income');
    if (profile.isSmoker === null) unfilled.push('field-smoking');
    if (!profile.city) unfilled.push('field-city');
    if (!profile.pincode) unfilled.push('field-city');

    return {
      activeStep,
      proposalCode: draftId,
      mode,
      guardian:
        mode === 'guardian' && guardianReview.response
          ? {
              sections: guardianReview.response.review.sections.map((s, i) => `${i + 1}. ${s.title}`),
              currentSection: guardianSection + 1,
              possibleIssues: guardianReview.checks.filter((f) => f.kind !== 'ok').map((f) => `${f.text}${f.page ? ` (page ${f.page})` : ''}`).slice(0, 10),
              suggestedQuestions: Array.from(new Set(guardianReview.response.review.sections.flatMap((s) => s.suggestedQuestions))).slice(0, 10),
              reviewedSections: reviewedSections.length,
            }
          : mode === 'guardian'
          ? { note: 'No review has been run yet.' }
          : undefined,
      documentDiscrepancies: docDiscrepancies,
      pendingApprovals: pendingApprovals.map((a) => ({ item: a.label, value: approvalSummary(a.key) })),
      stepGate: {
        furthestStepAllowed: stepGateRef.current.maxReachable,
        missingOnThisStep: (stepGateRef.current.issues[activeStep] || []).map((i) => i.msg),
      },
      focusedFieldId: currentFocusedField,
      checkout: { eSigned: esignValid, paid: paymentValid },
      termsDrawerOpen: showTermsDrawer,
      termsHighlightedClause: highlightedClause ? TERMS_AND_CONDITIONS_CLAUSES.find((c) => c.id === highlightedClause)?.clauseNumber ?? null : null,
      baseSumAssured,
      selectedRiders,
      noRiders: noRiders && !Object.values(selectedRiders).some(Boolean) && !lifeStageEscalator,
      ciTier,
      atpdOption,
      lifeStageEscalator,
      terminalIllnessCover,
      nominationValues: nomination,
      underwriting,
      formValues: {
        fullName: profile.fullName,
        dob: profile.dob,
        gender: profile.gender,
        annualIncome: profile.annualIncome,
        isSmoker: profile.isSmoker ?? undefined,
        city: profile.city,
        pincode: profile.pincode,
        section45Consent: underwriting.section45Consent,
      },
      unfilledRequiredFields: unfilled,
    };
  };

  // Clicks, key presses and touches count as activity; so does the customer speaking (see handleAgentEvent).
  useEffect(() => {
    const mark = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, mark));
  }, []);

  // End the live voice session after 3 minutes with no speech and no click, so it does not run on unattended.
  // The conversation stays on screen and is handed to the next session when the customer clicks Resume session.
  useEffect(() => {
    if (!isCoBrowsingConnected) return;
    lastActivityRef.current = Date.now();
    const timer = setInterval(() => {
      let limit = IDLE_DISCONNECT_MS;
      try {
        const o = Number(window.localStorage.getItem('nexasure.idleMs')); // lets the test suite shorten the wait
        if (o >= 5000 && o < limit) limit = o;
      } catch {
        /* storage unavailable */
      }
      if (Date.now() - lastActivityRef.current >= limit && isCoBrowsingConnectedRef.current) disconnectCoBrowsingSession('idle');
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoBrowsingConnected]);

  // Establish the live WebRTC session with the voice agent
  const connectCoBrowsingSession = async () => {
    const resuming = idlePaused;
    setIdlePaused(false);
    lastActivityRef.current = Date.now();
    setIsConnecting(true);
    playChime();
    try {
      setIsCoBrowsingConnected(true);
      isCoBrowsingConnectedRef.current = true;
      setIsScreenSharing(true);
      setIsSharingPaused(false);
      setScreenControlStatus('granted');

      // Same lines the Python agent speaks on connect (voice-agent-py/bot.py WELCOME).
      const welcomeMsg = resuming
        ? selectedLanguage === 'hi'
          ? 'वापसी पर स्वागत है। हमारी अब तक की बातचीत मेरे पास है। जहाँ रुके थे, वहीं से आगे बढ़ते हैं।'
          : selectedLanguage === 'mr'
          ? 'पुन्हा स्वागत! आतापर्यंतचे आपले संभाषण माझ्याकडे आहे. जिथे थांबलो होतो तिथून पुढे जाऊया.'
          : 'Welcome back. I have our conversation so far, so we can carry on where we stopped.'
        : selectedLanguage === 'hi'
        ? 'नमस्ते! सुरक्षित लाइव सत्र जुड़ गया है। मैं आपका फॉर्म देख रहा हूँ। कृपया अपना पूरा नाम बताएं, या कोई भी प्रश्न पूछें।'
        : selectedLanguage === 'mr'
        ? 'नमस्कार! सुरक्षित लाइव्ह सत्र सुरू झाले आहे. मी तुमचा अर्ज पाहत आहे. कृपया तुमचे पूर्ण नाव सांगा किंवा कोणताही प्रश्न विचारा.'
        : 'Welcome! Your secure live session is connected. I can see your proposal form. Start with your full legal name, or ask me anything.';

      // Two greetings, in order: the host line plays at once through /api/tts (the click is the
      // user gesture), and the agent's own welcome follows once it has ended and the WebRTC
      // session is ready. The agent is told not to greet on its own (autoWelcome: false).
      welcomeRef.current = { text: welcomeMsg, lang: selectedLanguage, greetingDone: false, ready: false, spoken: false };
      speakText(GREETING_TEXT[selectedLanguage], selectedLanguage, () => {
        welcomeRef.current.greetingDone = true;
        maybeSpeakAgentWelcome();
      });
      await startVoiceListening(selectedLanguage);
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'agent',
          text: `Live session connected: ${welcomeMsg}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (e) {
      console.error('Failed to start the live session:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  chatRef.current = chatMessages;

  // Last few turns of the conversation (only once the customer has said something), handed to a new voice session
  // so a resume after an idle pause or a dropped connection keeps its context.
  const recentTurns = () => {
    const turns = chatRef.current
      .filter((m) => m.text && !/^(Live session|Welcome to NexaSure|Meta API error|Voice agent)/.test(m.text))
      .slice(-12)
      .map((m) => ({ role: m.sender, text: m.text.slice(0, 400) }));
    return turns.some((t) => t.role === 'user') ? turns : [];
  };

  // Disconnect the WebRTC session
  const disconnectCoBrowsingSession = (reason?: 'idle') => {
    setIsCoBrowsingConnected(false);
    setIsScreenSharing(false);
    setScreenControlStatus('revoked');
    setAgentCursor((prev) => ({ ...prev, visible: false }));
    isCoBrowsingConnectedRef.current = false;
    localAudioRef.current?.pause();
    stopVoiceListening();
    setIdlePaused(reason === 'idle');
    playChime();
    setChatMessages((prev) => [
      ...prev,
      {
        sender: 'agent',
        text: reason === 'idle' ? 'Session paused after 3 minutes of inactivity. Nothing is shared with the agent. Click Resume session to continue where you left off.' : 'Live session ended. Nothing further is shared with the agent.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  // Test sound function to unlock audio on first user click
  const testAndUnmuteAudio = () => {
    playChime();
    const testMsg =
      selectedLanguage === 'hi'
        ? "ऑडियो चालू है। मैं आपका OmniCB एजेंट हूँ, आपकी सहायता के लिए तैयार हूँ।"
        : selectedLanguage === 'mr'
        ? "ऑडिओ सुरू झाला आहे. मी तुमचा OmniCB एजंट आहे, मदतीसाठी सज्ज आहे."
        : "Voice guidance is now active and unmuted. I am OmniCB Agent, ready to assist you.";
    speakText(testMsg, selectedLanguage);
  };

  // Auto-scroll chat
  useEffect(() => {
    // Pin only the transcript list to the newest message. Instant, not smooth: a smooth scroll falls
    // behind while an answer streams in. scrollIntoView would also scroll the page and hide the form.
    const el = chatBottomRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [chatMessages]);

  // Main Guidance Trigger: Spotlights field, speaks voice guidance directly without any popups
  const triggerFieldGuidance = (fieldKey: string, langOverride?: 'en' | 'hi' | 'mr') => {
    if (!isCoBrowsingConnected) return;
    const lang = langOverride || selectedLanguage;
    const item = GUIDANCE_CONTENT[fieldKey];
    if (!item) return;
    // Click + focus (and OCR auto-fill) can fire this several times for one field; speak it once.
    const now = Date.now();
    if (lastGuidanceRef.current.key === `${fieldKey}:${lang}` && now - lastGuidanceRef.current.at < 10000) return;
    lastGuidanceRef.current = { key: `${fieldKey}:${lang}`, at: now };

    setActiveGuidanceKey(fieldKey);
    setSpotlightedElementId(item.spotlightId);
    setIdleSeconds(0);

    const spokenText = item.advice[lang];
    speakText(spokenText, lang);

    setChatMessages((prev) => [
      ...prev,
      {
        sender: 'agent',
        text: `[${lang.toUpperCase()}] ${spokenText}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);

    // Keep spotlight active for 7 seconds so user sees which field is active
    setTimeout(() => {
      setSpotlightedElementId(null);
    }, 7000);
  };

  // Re-play guidance when language is changed
  const handleLanguageChange = (newLang: 'en' | 'hi' | 'mr') => {
    setSelectedLanguage(newLang);
    if (isCoBrowsingConnected) {
      triggerFieldGuidance(activeGuidanceKey, newLang);
      // The agent restarts its Meta ASR session with the new language bias.
      agentRef.current?.setLanguage(newLang);
    }
  };

  // User Interaction Trigger: Guidance is dispatched on-demand when user clicks, changes language, or speaks

  // When user clicks / focuses on ANY field -> auto-play guidance for that field!
  const handleFieldClickOrFocus = (fieldKey: string) => {
    setCurrentFocusedField(fieldKey);
    if (isCoBrowsingConnected) {
      triggerFieldGuidance(fieldKey);
    }
  };

  // The annual income field is a range dropdown; map an exact figure (OCR or spoken) onto it.
  const incomeRangeFor = (raw: string): string => {
    const known = ['5L-10L', '10L-15L', '15L-20L', '20L-35L', '35L+'];
    if (known.includes(raw)) return raw;
    const n = Number(String(raw).replace(/[^0-9.]/g, ''));
    if (!n) return '';
    const amt = n < 1000 ? n * 100000 : n; // "18" or "18.5" spoken as lakhs
    if (amt < 1000000) return '5L-10L';
    if (amt < 1500000) return '10L-15L';
    if (amt < 2000000) return '15L-20L';
    if (amt < 3500000) return '20L-35L';
    return '35L+';
  };

  // Relation words from speech ("son", "daughter") map to the options the form offers.
  const normalizeRelation = (r: unknown): string => {
    const v = String(r ?? '').trim();
    if (/^(son|daughter|kid|child|children)$/i.test(v)) return 'Child';
    if (/^(wife|husband|spouse)$/i.test(v)) return 'Spouse';
    if (/^(father|mother|parent|parents)$/i.test(v)) return 'Parent';
    if (/^(brother|sister|sibling)$/i.test(v)) return 'Sibling';
    return v || 'Child';
  };

  // "clause": 1 to 8, "Clause 3" or a clause id; returns the clause id or null.
  const resolveClauseId = (clause: unknown): string | null => {
    if (clause === undefined || clause === null || clause === '') return null;
    const asText = String(clause);
    const byId = TERMS_AND_CONDITIONS_CLAUSES.find((c) => c.id === asText);
    if (byId) return byId.id;
    const n = parseInt(asText.replace(/\D/g, ''), 10);
    return TERMS_AND_CONDITIONS_CLAUSES.find((c) => c.clauseNumber === `Clause ${n}`)?.id ?? null;
  };

  // Apply a co-browsing action returned by Muse Spark to the live form.
  const applyAgentAction = (a: AgentAction) => {
    if (a.targetElementId === 'drawer-terms-conditions') setShowTermsDrawer(true);
    const actions: Record<string, any>[] = a.fieldActions?.length ? a.fieldActions : a.fieldAction ? [a.fieldAction] : [];
    const applyOne = (action: Record<string, any>, title: string | undefined) => {
      if (action.type === 'nominate') {
        glideAgentCursorToElement('nomination-section', title || 'Configuring Nominee & Trust Protection', () => {
          if (latestRef.current.activeStep < 3) goToStep(3);
          const before = nominationRef.current;
          if (before) requestApproval('nominee', 'Nominees', () => setNomination(before));
          setNomination((prev) => {
            const next = {
              ...prev,
              primaryName: action.primaryName !== undefined ? action.primaryName : prev.primaryName,
              primaryRelation: action.primaryRelation !== undefined ? normalizeRelation(action.primaryRelation) : prev.primaryRelation,
              primaryDob: action.primaryDob !== undefined ? String(action.primaryDob) : prev.primaryDob,
              primaryShare: action.primaryShare !== undefined ? Number(action.primaryShare) : prev.primaryShare,
              hasSecondaryNominee: action.hasSecondaryNominee !== undefined ? action.hasSecondaryNominee : prev.hasSecondaryNominee,
              secondaryName: action.secondaryName !== undefined ? action.secondaryName : prev.secondaryName,
              secondaryRelation: action.secondaryRelation !== undefined ? normalizeRelation(action.secondaryRelation) : prev.secondaryRelation,
              secondaryAge: action.secondaryAge !== undefined ? Number(action.secondaryAge) : prev.secondaryAge,
              secondaryShare: action.secondaryShare !== undefined ? Number(action.secondaryShare) : prev.secondaryShare,
              appointeeName: action.appointeeName !== undefined ? action.appointeeName : prev.appointeeName,
              appointeeRelation: action.appointeeRelation !== undefined ? action.appointeeRelation : prev.appointeeRelation,
              mwpaTrustEnabled: action.mwpaTrustEnabled !== undefined ? action.mwpaTrustEnabled : prev.mwpaTrustEnabled,
            };
            if (Array.isArray(action.additionalNominees)) {
              let list = action.additionalNominees
                .filter((n: unknown) => n && typeof n === 'object')
                .slice(0, 3)
                .map((n: Record<string, unknown>) => ({
                  name: String(n.name ?? ''),
                  relation: normalizeRelation(n.relation),
                  age: Number(n.age) || 7,
                  share: Number(n.share) || 0,
                }));
              // Additional nominees only exist after a secondary one: promote the first if there is none yet.
              if (!next.hasSecondaryNominee && list.length) {
                const [first, ...rest] = list;
                next.hasSecondaryNominee = true;
                next.secondaryName = first.name;
                next.secondaryRelation = first.relation;
                next.secondaryAge = first.age;
                next.secondaryShare = first.share;
                list = rest;
              }
              next.additionalNominees = list.slice(0, 2);
            }
            return next;
          });
        });
      } else if (action.type === 'ladder') {
        glideAgentCursorToElement('card-benefit-ladders', title || 'Configuring Benefit Ladder', () => {
          if (action.field === 'ciTier') {
            setSelectedRiders((r) => ({ ...r, criticalIllness: true }));
            setCiTier(action.value);
          } else if (action.field === 'atpdOption') {
            setSelectedRiders((r) => ({ ...r, accidentalDeath: true }));
            setAtpdOption(action.value);
          } else if (action.field === 'lifeStageEscalator') {
            setLifeStageEscalator(Boolean(action.value));
          }
        });
      } else if (action.type === 'fill') {
        const value = String(action.value ?? '').trim();
        const targets: Record<string, { el: string; aim?: string; apply: () => void }> = {
          fullName: { el: 'field-full-name', apply: () => setProfile((p) => ({ ...p, fullName: value })) },
          dob: { el: 'field-dob', apply: () => setProfile((p) => ({ ...p, dob: value })) },
          annualIncome: {
            el: 'field-annual-income',
            aim: 'select-annual-income',
            apply: () => {
              const before = profileRef.current.annualIncome;
              const next = incomeRangeFor(value);
              if (next && next !== before) requestApproval('annualIncome', 'Annual income', () => setProfile((p) => ({ ...p, annualIncome: before })));
              setProfile((p) => ({ ...p, annualIncome: next || p.annualIncome }));
            },
          },
          gender: {
            el: 'field-gender',
            aim: /^f/i.test(value) ? 'option-gender-female' : 'option-gender-male',
            apply: () => setProfile((p) => ({ ...p, gender: /^f/i.test(value) ? 'Female' : /^m/i.test(value) ? 'Male' : p.gender })),
          },
          pincode: { el: 'field-city', aim: 'input-pincode', apply: () => setProfile((p) => ({ ...p, pincode: value })) },
          city: { el: 'field-city', aim: 'input-city', apply: () => setProfile((p) => ({ ...p, city: value })) },
        };
        const target = targets[action.field];
        if (target && value) glideAgentCursorToElement(target.el, title || `Entering ${action.field}`, target.apply, target.aim);
      } else if (action.type === 'cover') {
        const v = String(action.value ?? '').toLowerCase().replace(/\s|₹|,/g, '');
        const tier = /^1(cr|crore|0000000)?$/.test(v) || v === '1cr' ? '1cr' : /1\.5|15000000|150/.test(v) ? '1.5cr' : /^2|20000000/.test(v) ? '2cr' : null;
        if (tier) {
          glideAgentCursorToElement(`cover-tier-${tier}`, title || `Selecting ${tier} cover`, () => setBaseSumAssured(tier as any));
        }
      } else if (action.type === 'navigate') {
        const step = Math.min(5, Math.max(1, Number(action.step) || 1));
        if (modeRef.current !== 'cobrowse') setMode('cobrowse');
        glideAgentCursorToElement(`step-tab-${step}`, title || `Opening step ${step}`, () => {
          if (goToStep(step)) formBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        });
      } else if (action.type === 'ui') {
        if (action.action === 'open_terms') {
          const id = resolveClauseId(action.clause);
          if (id) {
            setTermsSearchQuery('');
            setHighlightedClause(id);
          }
          setShowTermsDrawer(true);
        } else if (action.action === 'close_terms') setShowTermsDrawer(false);
        else if (action.action === 'pause_proposal') window.setTimeout(() => pauseProposal(), 1500);
        else if (action.action === 'open_guardian') setMode('guardian');
        else if (action.action === 'open_cobrowse') setMode('cobrowse');
        else if (action.action === 'guardian_next') openGuardianSection(guardianSectionRef.current + 1, true);
        else if (action.action === 'guardian_prev') openGuardianSection(guardianSectionRef.current - 1, true);
        else if (action.action === 'guardian_section') openGuardianSection(Math.max(0, Number(action.section) - 1), true);
      } else if (action.type === 'select') {
        const on = Boolean(action.value);
        if (action.field === 'criticalIllness') {
          glideAgentCursorToElement('card-critical-illness', title || 'Selecting Critical Illness Rider', () => {
            setSelectedRiders((r) => ({ ...r, criticalIllness: on }));
          });
        } else if (action.field === 'accidentalDeath') {
          glideAgentCursorToElement('card-accidental-death', title || 'Selecting Accidental Cover Rider', () => {
            setSelectedRiders((r) => ({ ...r, accidentalDeath: on }));
          });
        } else if (action.field === 'waiverOfPremium') {
          glideAgentCursorToElement('card-waiver-premium', title || 'Selecting Premium Waiver Rider', () => {
            setSelectedRiders((r) => ({ ...r, waiverOfPremium: on }));
          });
        } else if (action.field === 'hospitalCash') {
          glideAgentCursorToElement('card-hospital-cash', title || 'Selecting Hospital Daily Cash Rider', () => {
            setSelectedRiders((r) => ({ ...r, hospitalCash: on }));
          });
        } else if (action.field === 'noRiders') {
          glideAgentCursorToElement('card-no-riders', title || 'Choosing base cover only', () => {
            if (on) {
              setSelectedRiders({ criticalIllness: false, accidentalDeath: false, waiverOfPremium: false, hospitalCash: false });
              setLifeStageEscalator(false);
            }
            setNoRiders(on);
          });
        } else if (action.field === 'isSmoker') {
          glideAgentCursorToElement('field-smoking', title || `Setting Smoker Status: ${on ? 'Yes' : 'No'}`, () => {
            const before = profileRef.current.isSmoker;
            if (before !== on) requestApproval('isSmoker', 'Smoking status', () => setProfile((p) => ({ ...p, isSmoker: before })));
            setProfile((p) => ({ ...p, isSmoker: on }));
          }, on ? 'option-smoker-yes' : 'option-smoker-no');
        }
      }
    };
    if (actions.length) {
      actions.forEach((act, idx) => applyOne(act, idx === 0 ? a.actionTitle : `${a.actionTitle} (${idx + 1}/${actions.length})`));
      return;
    }
    if (a.targetElementId) {
      setSpotlightedElementId(a.targetElementId);
      glideAgentCursorToElement(a.targetElementId, a.actionTitle || 'Pointing to Relevant Feature');
      setTimeout(() => setSpotlightedElementId(null), 6000);
    }
  };

  const upsertAgentMessage = (text: string) => {
    const id = currentAgentMsgIdRef.current;
    if (id === null) return;
    setChatMessages((prev) => {
      const i = prev.findIndex((m) => m.id === id);
      if (i < 0) return [...prev, { id, sender: 'agent', text, time: stampNow() }];
      const next = [...prev];
      next[i] = { ...next[i], text };
      return next;
    });
  };

  // Typed questions go through the same server-side pipeline as spoken turns.
  const processUserSpokenQuestion = (query: string) => {
    const text = query.trim();
    if (!text) return;
    const agent = agentRef.current;
    if (!agent || !agent.isOpen) {
      setChatMessages((prev) => [
        ...prev,
        { sender: 'agent', text: 'Voice agent session is not connected. Click "Accept and start co-browsing"first.', time: stampNow() },
      ]);
      return;
    }
    agent.sendText(text);
  };

  // Events from the Python voice agent (voice-agent-py/bot.py) over the WebRTC data channel.
  const patchLastTurn = (patch: (last: TurnRecord) => Partial<TurnRecord>) =>
    setTurns((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      return [...prev.slice(0, -1), { ...last, ...patch(last) }];
    });
  const markLastTurn = (key: keyof TurnMarks) =>
    patchLastTurn((last) => (last.marks?.[key] != null ? {} : { marks: { ...last.marks, [key]: Date.now() } }));

  const handleAgentEvent = (ev: AgentEvent) => {
    if (ev.type === 'user_transcript' || ev.type === 'user_turn' || ev.type === 'interrupt') lastActivityRef.current = Date.now();
    switch (ev.type) {
      case 'hello':
        setVoiceTelemetry((t) => ({
          ...t,
          asrModel: ev.sttModel,
          sparkModel: ev.llmModel,
          reasoningEffort: ev.reasoningEffort,
          ttsVoice: ev.ttsVoice ?? t.ttsVoice,
          lastError: null,
        }));
        break;
      case 'agent_audio_meta':
        if (ev.index <= 0) setVoiceTelemetry((t) => ({ ...t, ttsMs: ev.ttsMs, ttsVoice: ev.voice ?? t.ttsVoice }));
        break;
      case 'agent_local_done':
        break;
      case 'ready':
        setVoiceTelemetry((t) => ({ ...t, asrModel: ev.sttModel, lastError: null }));
        agentRef.current?.sendScreenState(latestRef.current.screenState());
        welcomeRef.current.ready = true;
        maybeSpeakAgentWelcome();
        break;
      case 'state':
        setAgentState(ev.state);
        setVoiceThinking(ev.state === 'thinking');
        if (ev.state === 'thinking') speechEndRef.current = Date.now();
        if (ev.state === 'speaking') markLastTurn('firstAudio');
        break;
      case 'level':
        updateMicMeter(ev.rms, ev.gated);
        break;
      case 'user_transcript':
        if (!ev.final && ev.text) setVoiceTranscriptLive(ev.text);
        break;
      case 'user_turn':
        if (ev.kbChunks?.some((c) => c.doc)) {
          const src = ev.kbChunks.filter((c) => c.doc).map((c) => `${c.label.replace('Your policy › ', '')}: "${(c.excerpt || '').replace(/\s+/g, ' ').slice(0, 110)}…"`).join('  •  ');
          setChatMessages((prev) => [...prev, { sender: 'agent', text: `Looking in your policy: ${src}`, time: stampNow() }]);
        }
        setVoiceTranscriptLive('');
        setVoiceTelemetry((t) => ({ ...t, asrTurnMs: ev.asrTurnMs }));
        setTurns((prev) => [
          ...prev.slice(-19),
          { turnId: ev.turnId, userText: ev.text, source: ev.source, kbChunks: ev.kbChunks, marks: { speechEnd: speechEndRef.current ?? Date.now() } },
        ]);
        setChatMessages((prev) => [
          ...prev,
          {
            sender: 'user',
            text: devRef.current
              ? ev.source === 'voice' ? `[You • Muse Voice Transcribe]: "${ev.text}"` : `[You]: "${ev.text}"`
              : `${ev.source === 'voice' ? '' : ''} You: "${ev.text}"`,
            time: stampNow(),
          },
        ]);
        break;
      case 'agent_start':
        currentAgentMsgIdRef.current = Date.now() + Math.random();
        agentTextRef.current = '';
        break;
      case 'agent_ack':
        agentTextRef.current = `${ev.text} `;
        upsertAgentMessage(`${devRef.current ? '[OmniCB • Muse Spark]' : 'OmniCB'}: ${agentTextRef.current}`);
        patchLastTurn((last) => ({ ackMs: ev.ms ?? null, marks: { ...last.marks, ack: Date.now() } }));
        break;
      case 'agent_text':
        if (!agentTextRef.current) markLastTurn('firstToken');
        agentTextRef.current += ev.delta;
        upsertAgentMessage(`${devRef.current ? '[OmniCB • Muse Spark]' : 'OmniCB'}: ${agentTextRef.current}`);
        break;
      case 'action': {
        latestRef.current.applyAction(ev);
        const raw = ev.fieldActions?.length ? ev.fieldActions : ev.fieldAction ? [ev.fieldAction] : [];
        if (raw.length) {
          const prefix = ev.actionTitle?.startsWith('Amended') ? 'amended → ' : ev.actionTitle?.startsWith('Reverted') ? 'reverted → ' : '';
          const list = raw.map((a) => prefix + describeFieldAction(a));
          setTurns((prev) => {
            if (!prev.length) return prev;
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), { ...last, actions: [...(last.actions ?? []), ...list] }];
          });
        }
        break;
      }
      case 'agent_prefetch':
        setPrefetchInfo({ questions: ev.questions, ms: ev.ms, step: ev.step });
        break;
      case 'action_verification': {
        setVerifications((prev) => {
          const entry = { id: ev.id, status: ev.status, actionTitle: ev.actionTitle, reason: ev.reason, clause: ev.clause ?? null, ms: ev.ms, model: ev.model };
          const i = prev.findIndex((v) => v.id === ev.id);
          return (i < 0 ? [...prev, entry] : prev.map((v, k) => (k === i ? entry : v))).slice(-6);
        });
        if (ev.status !== 'pending') recordModel(ev.model, 'verifier', ev.ms ?? 0, ev.usage);
        if (ev.status === 'error') {
          // The change stands (nothing is rolled back without a reason) but it was not double-checked.
          setChatMessages((prev) => [...prev, { sender: 'agent', text: `Could not double-check "${ev.actionTitle}" with Muse Wonder (${ev.reason || 'request failed'}). The change was not verified, so please check it yourself.`, time: stampNow() }]);
        }
        if (ev.status !== 'pending') {
          patchLastTurn((last) => ({
            wonder: { status: ev.status, actionTitle: ev.actionTitle, reason: ev.reason, ms: ev.ms },
            marks: { ...last.marks, verified: Date.now() },
          }));
          // An "ask" keeps the action and only wants one more detail, so it counts as an approval.
          const bucket = (ev.status === 'ask' ? 'approve' : ev.status) as keyof SessionStats;
          setSessionStats((s) => ({ ...s, [bucket]: s[bucket] + 1 }));
        }
        if (ev.status !== 'pending') {
          if (devRef.current) {
            const verb =
              ev.status === 'approve' ? 'Muse Wonder approved' : ev.status === 'amend' ? 'Muse Wonder amended' : ev.status === 'reject' ? 'Muse Wonder rejected' : ev.status === 'ask' ? 'Muse Wonder asks for more' : 'Muse Wonder could not verify';
            setChatMessages((prev) => [
              ...prev,
              { sender: 'agent', text: `${verb} "${ev.actionTitle}"${ev.reason ? `: ${ev.reason}` : ''}${ev.ms ? `(${ev.ms} ms)` : ''}`, time: stampNow() },
            ]);
          } else if (ev.status === 'ask') {
            setChatMessages((prev) => [...prev, { sender: 'agent', text: `One more detail needed for "${ev.actionTitle}": ${ev.reason || 'please add the missing information'}`, time: stampNow() }]);
          } else if (ev.status === 'reject' || ev.status === 'amend') {
            // Customers only need to know when a change was flagged, not the verifier's internals.
            setChatMessages((prev) => [...prev, { sender: 'agent', text: `Compliance check on "${ev.actionTitle}": ${ev.reason || 'needs a correction'}`, time: stampNow() }]);
          }
        }
        break;
      }
      case 'agent_role':
        setAgentRole(ev.role);
        setAgentName(ev.name || (ev.role === 'guardian' ? 'Integrity Guardian' : 'OmniCB co-browsing agent'));
        break;
      case 'policy_doc_ready':
        setPolicyDoc((p) => (p ? { ...p, status: ev.ok ? 'sent' : 'error', error: ev.ok ? undefined : ev.error } : p));
        if (ev.ok)
          setChatMessages((prev) => [...prev, { sender: 'agent', text: `Your policy "${ev.name}" is loaded (${ev.pages} pages). Ask me about it and I will tell you which page the answer is on.`, time: stampNow() }]);
        break;
      case 'usage':
        recordModel(voiceTelemetryRef.current.sparkModel || 'Muse Spark', 'agent', undefined, ev);
        break;
      case 'agent_done':
        recordModel(ev.telemetry?.llmModel || voiceTelemetryRef.current.sparkModel || 'Muse Spark', 'agent', ev.telemetry?.totalMs ?? 0);
        if (ev.text)
          upsertAgentMessage(
            devRef.current
              ? `[OmniCB • ${ev.telemetry?.llmModel || 'Muse Spark'}${ev.telemetry?.servedFrom?.startsWith('prediction') ? ' • pre-answered' : ''}]: ${ev.text}`
              : `OmniCB: ${ev.text}`
          );
        setVoiceTelemetry((t) => ({
          ...t,
          sparkModel: ev.telemetry?.llmModel ?? t.sparkModel,
          sparkTtftMs: ev.telemetry?.ttftMs ?? null,
          sparkTotalMs: ev.telemetry?.totalMs ?? null,
          reasoningEffort: ev.telemetry?.reasoningEffort ?? t.reasoningEffort,
          lastError: ev.telemetry?.error ?? null,
        }));
        setTurns((prev) => {
          if (!prev.length) return prev;
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, agentText: ev.text || last.agentText, ttftMs: ev.telemetry?.ttftMs ?? null, totalMs: ev.telemetry?.totalMs ?? null }];
        });
        break;
      case 'memory':
        setMemoryFacts(ev.facts || []);
        if (ev.facts?.length)
          setChatMessages((prev) => [
            ...prev,
            { sender: 'agent', text: devRef.current ? `[Memory] ${ev.facts.length} facts from earlier sessions loaded: ${ev.facts.slice(-3).join(' ')}` : `Welcome back. I remember where we left off${ev.summary ? `: ${ev.summary}` : '.'}`, time: stampNow() },
          ]);
        break;
      case 'memory_updated':
        if (ev.facts?.length) setMemoryFacts((prev) => Array.from(new Set([...prev, ...ev.facts])).slice(-25));
        if (ev.facts?.length) patchLastTurn((last) => ({ memoryAdded: [...(last.memoryAdded ?? []), ...ev.facts] }));
        if (devRef.current && ev.added > 0)
          setChatMessages((prev) => [...prev, { sender: 'agent', text: `[Memory • Muse Spark] saved ${ev.added} new fact${ev.added === 1 ? '' : 's'}: ${ev.facts.join(' ')}`, time: stampNow() }]);
        break;
      case 'case_created':
        setCases((prev) => [...prev, ev.case].slice(-5));
        setChatMessages((prev) => [
          ...prev,
          {
            sender: 'agent',
            text: `I can't advise on that myself, so I've passed it to an underwriter as case ${ev.case.caseId}. They will review it with you.`,
            time: stampNow(),
          },
        ]);
        break;
      case 'interrupt':
        setSessionStats((s) => ({ ...s, interrupts: s.interrupts + 1 }));
        if (agentTextRef.current) upsertAgentMessage(`${devRef.current ? '[OmniCB • Muse Spark]' : 'OmniCB'}: ${agentTextRef.current} (interrupted)`);
        break;
      case 'error':
        setVoiceTelemetry((t) => ({ ...t, lastError: ev.message }));
        setChatMessages((prev) => [
          ...prev,
          { sender: 'agent', text: `Meta API error (no fallback configured): ${ev.message}`, time: stampNow() },
        ]);
        break;
      case 'closed':
        setIsListeningVoice(false);
        isListeningRef.current = false;
        agentRef.current?.stop();
        agentRef.current = null;
        setSpeakingState(false);
        setVoiceThinking(false);
        if (isCoBrowsingConnectedRef.current) {
          setMicPermissionError(`Voice agent disconnected (${ev.code}). Reconnecting…`);
          setTimeout(() => {
            if (isCoBrowsingConnectedRef.current && !isListeningRef.current) void startVoiceListening();
          }, 1000);
        }
        break;
    }
  };

  // 5 High-Impact Value Differentiators: Explanations & Policy Evidence Data
  const POLICY_EVIDENCE_CLAUSES: Record<string, {
    title: string;
    clauseId: string;
    document: string;
    page: number;
    effectiveDate: string;
    highlightedText: string;
    summary: string;
  }> = {
    'clause-42': {
      title: 'Clause 4.2: Critical Illness 100% Lump Sum Living Benefit',
      clauseId: 'Clause 4.2 (Living Benefits)',
      document: 'NexaSure Flexi Shield Policy Document (demo product)',
      page: 7,
      effectiveDate: 'April 2024 (IRDAI Master Circular)',
      highlightedText: 'Upon first diagnosis of any of the 36 defined Critical Illnesses (including Acute Myocardial Infarction, Stroke Resulting in Permanent Symptoms, Open Chest CABG, and Cancer of Specified Severity), 100% of the Critical Illness Sum Assured (₹25,00,000) shall be paid immediately as a tax-free lump sum, irrespective of actual hospital medical expenses incurred.',
      summary: 'Pays ₹25 Lakhs directly to your bank account upon diagnosis of 36 critical conditions. Unlike regular health insurance, this is an unrestricted cash payout.',
    },
    'clause-111': {
      title: 'Clause 11.1: Section 45 Non-Contestability Protection',
      clauseId: 'Clause 11.1 (Statutory Protection)',
      document: 'Insurance Act 1938, Section 45 & Policy Incontestability Schedule',
      page: 19,
      effectiveDate: 'Statutory Law of India',
      highlightedText: 'No policy of life insurance shall be called in question on any ground whatsoever, including misstatement or fraudulent suppression of a fact, after the expiry of three continuous years from the date of issuance of the policy or the date of revival. Full disclosure at inception guarantees irreversible settlement after 36 months.',
      summary: 'After 3 continuous years, the insurance company cannot legally reject or dispute any death claim. Full disclosure today guarantees lifetime claim peace of mind.',
    },
    'clause-73': {
      title: 'Clause 7.3: Tax Treatment of Premium (illustrative)',
      clauseId: 'Clause 7.3 (Tax Certificates)',
      document: 'Income-tax Act 2025 & NexaSure Annual Tax Schedule Guide',
      page: 12,
      effectiveDate: 'Financial Year 2024-2025',
      highlightedText: 'Under the old tax regime, life insurance premiums can qualify for a deduction under sections 123 and 126 of the Income-tax Act 2025, subject to the limits and conditions there, including the ₹1,50,000 overall cap. The new regime does not allow it. Death benefits are generally tax free under section 10(10D) subject to its conditions. This is general information, not tax advice.',
      summary: 'Premiums may reduce tax under the old regime (up to the ₹1.5 lakh cap); the new regime gives no such deduction. Illustrative only, not tax advice.',
    },
    'clause-81': {
      title: 'Clause 8.1: Statutory 30-Day Electronic Free-Look Guarantee',
      clauseId: 'Clause 8.1 (Free-Look Period)',
      document: 'IRDAI Policyholders Interests Protection Regulations',
      page: 4,
      effectiveDate: 'Active Standard',
      highlightedText: 'The Policyholder has a period of thirty (30) days from the date of electronic receipt of the policy schedule to review the terms and conditions. If the Policyholder disagrees with any terms, they may return the policy with a written statement, upon which the premium paid shall be refunded after deducting a proportionate risk premium, the medical examination cost and the stamp duty.',
      summary: 'You have 30 days to review the policy after issuance. If not satisfied, you get a refund net of the proportionate risk premium, medical examination cost and stamp duty.',
    },
  };

  const TERMS_AND_CONDITIONS_CLAUSES = [
    {
      id: 'tc-section-45',
      clauseNumber: 'Clause 1',
      title: 'Section 45 Statutory Claim Guarantee (3-Year Incontestability Rule)',
      category: 'Statutory Protection',
      irdaiRef: 'Insurance Act 1938, Section 45',
      summary: 'After 3 years, a life policy cannot be questioned on any ground. Within 3 years the insurer can question it only for fraud or a hidden fact that matters, and must give written grounds.',
      fullText: 'No life insurance policy can be called in question on any ground after three years from the latest of the issue date, the date risk began, the revival date or the rider date. Within those three years it can be questioned only for fraud, or for a wrong or hidden fact that matters to life expectancy, and the insurer must give the grounds in writing. If a claim is rejected for a misstatement, the premiums collected are returned within ninety days.',
    },
    {
      id: 'tc-grace-period',
      clauseNumber: 'Clause 2',
      title: '30-Day Statutory Grace Period for Premium Payment',
      category: 'Payment Safeguards',
      irdaiRef: 'IRDAI Master Circular on Life Insurance Products 2024, para 8',
      summary: 'You receive 30 calendar days of grace period for premium payments (15 days for monthly mode). Cover continues without a break and there is no late fee during this period.',
      fullText: 'A grace period of thirty (30) days from the premium due date is allowed for payment of quarterly, half-yearly, and annual premiums; fifteen (15) days for monthly mode. Single premium policies have no grace period. The policy stays in force during the grace period.',
    },
    {
      id: 'tc-free-look',
      clauseNumber: 'Clause 3',
      title: '30-Day Free-Look Cancellation',
      category: 'Consumer Rights',
      irdaiRef: 'IRDAI Master Circular on Life Insurance Products 2024, para 5',
      summary: 'You have 30 days from electronic policy receipt to review all terms. If unsatisfied, cancel and get the premium back minus a proportionate risk premium, medical examination cost and stamp duty.',
      fullText: 'The Policyholder is entitled to a 30-day Free-Look Period from the date of electronic receipt of the policy document. If the Policyholder does not agree with any terms, they may return the policy for cancellation and receive the premium paid minus a proportionate risk premium for the time covered, the medical examination cost and the stamp duty. It is not always a full refund.',
    },
    {
      id: 'tc-suicide-clause',
      clauseNumber: 'Clause 4',
      title: 'Suicide Exclusion and Minimum Refund',
      category: 'Exclusions',
      irdaiRef: 'IRDAI Master Circular on Life Insurance Products 2024, para 21',
      summary: 'In the event of suicide within 12 months of inception, the nominee gets at least 80% of the premiums paid or the surrender value, whichever is higher. Death after 12 months is not excluded for this reason.',
      fullText: 'If the Life Assured commits suicide within twelve (12) months from the Date of Inception or Date of Revival, the nominee receives at least eighty percent of the premiums paid or the surrender value, whichever is higher, provided the policy is in force. Death after twelve months is not excluded for this reason.',
    },
    {
      id: 'tc-ped-disclosure',
      clauseNumber: 'Clause 5',
      title: 'Pre-Existing Disease (PED) & Medical Acceptance',
      category: 'Underwriting',
      irdaiRef: 'IRDAI Protection of Policyholders Interests 2024 & Section 45',
      summary: 'Disclose all medical history honestly. Once the insurer accepts your declarations, a fact you disclosed cannot later be used against you.',
      fullText: 'All pre-existing medical conditions, surgical histories, or chronic illnesses disclosed in the proposal form and accepted by the underwriter cannot later be used against you. Answer every question truthfully, because the proposal is the basis of the policy.',
    },
    {
      id: 'tc-waiting-period',
      clauseNumber: 'Clause 6',
      title: 'Critical Illness Waiting Period & 14-Day Survival Period',
      category: 'Living Benefits',
      irdaiRef: 'Clause 4.2 Living Benefit Rider Schedule',
      summary: 'A 90-day waiting period from policy inception applies for Critical Illness. A 14-day survival period after diagnosis applies before the lump sum is paid. These are NexaSure demo terms, not an IRDAI rule.',
      fullText: 'The Critical Illness Living Benefit Rider is subject to an initial waiting period of ninety (90) days from the inception date. Upon confirmed medical diagnosis of any of the 36 defined illnesses and survival for fourteen (14) days, 100% of the rider sum assured is paid as a cash lump sum.',
    },
    {
      id: 'tc-csr-sla',
      clauseNumber: 'Clause 7',
      title: 'Digital Claims & 2-Hour Response Target (demo figures)',
      category: 'Claims Concierge',
      irdaiRef: 'NexaSure Service Standards (demo targets, not audited results)',
      summary: 'NexaSure registers claims digitally with a 2-hour response target and no physical paperwork required from your family. These are demo targets, not audited results.',
      fullText: 'NexaSure is committed to fair, prompt claim settlements. Claims can be registered 24x7 digitally via the customer portal or dedicated bereavement concierge with a 2-hour response target. The figures in this demo are targets, not audited results.',
    },
    {
      id: 'tc-revival-policy',
      clauseNumber: 'Clause 8',
      title: 'Policy Revival',
      category: 'Policy Continuity',
      irdaiRef: 'IRDAI Protection of Policyholders Interests 2024, lapse and revival',
      summary: 'If your policy ever lapses due to missed payments, you can revive it within five years from the first unpaid premium, as IRDAI\'s Regulations 2024 define the revival period for non-linked policies, by paying unpaid premiums with interest. A health declaration may be needed. Riders lapse and revive with the base policy (a NexaSure demo term; IRDAI sets no rule for riders of a term plan).',
      fullText: 'A lapsed policy may be revived within five years from the first unpaid premium, as IRDAI\'s Regulations 2024 define the revival period for non-linked policies, on paying the unpaid premiums with interest or a late fee, and possibly a health declaration or medical examination. As a NexaSure demo term (IRDAI sets no rule for riders of a term plan), riders lapse when the base policy lapses and are restored with it if the policy is revived within five years of the first unpaid premium, subject to the same health declaration or medical examination. This demo product has no surrender value and no paid-up value.',
    },
  ];

  const WHY_ASK_THIS_EXPLANATIONS: Record<string, { title: string; en: string; hi: string; mr: string; clauseRef: string }> = {
    'field-full-name': {
      title: 'Full Legal Name Verification',
      en: 'Insurers require your name to match government records (PAN/Aadhaar) exactly so your beneficiaries face zero legal delays during death claim settlement under IRDAI norms.',
      hi: 'आईआरडीएआई नियमों के अनुसार, कानूनी नाम पैन या आधार से बिल्कुल मेल खाना चाहिए ताकि भविष्य में क्लेम निपटान में परिवार को कोई परेशानी न हो।',
      mr: 'आयआरडीएआय नियमानुसार तुमचे कायदेशीर नाव पॅन किंवा आधारशी तंतोतंत जुळणे आवश्यक आहे, जेणेकरून भविष्यात क्लेम सेटलमेंटमध्ये वारसदारांना विलंब होणार नाही.',
      clauseRef: 'Section 45 & IRDAI Master Circular on Life Insurance Products 2024',
    },
    'field-dob': {
      title: 'Date of Birth & Mortality Lock',
      en: 'Age determines your actuarial risk and base premium. By completing this proposal today, you lock in this low rate for the next 30 years without annual age-based price hikes.',
      hi: 'उम्र आपके प्रीमियम की दर तय करती है। आज प्रस्ताव भरने से आपकी यह दर अगले 30 वर्षों के लिए फ्रीज (लॉक) हो जाती है।',
      mr: 'वय तुमच्या विम्याच्या दराचा मुख्य निकष आहे. आज पॉलिसी घेतल्याने पुढील ३० वर्षांसाठी हाच कमी दर लॉक केला जातो.',
      clauseRef: 'NexaSure Flexi Shield Schedule, Section 3.1',
    },
    'field-income': {
      title: 'Annual Income & Human Life Value',
      en: 'Insurers decide how much cover your income supports and may ask for income proof. IRDAI sets no fixed multiple; insurers commonly offer about 15 to 25 times annual income when you are young, and less as you get older.',
      hi: 'आपकी आय के आधार पर बीमा कंपनी तय करती है कि कितना कवर मिलेगा और आय का प्रमाण मांग सकती है। आईआरडीएआई ने कोई तय गुणक नहीं रखा है; कम उम्र में बीमा कंपनियां आम तौर पर आय का लगभग 15 से 25 गुना कवर देती हैं।',
      mr: 'तुमच्या उत्पन्नावरून विमा कंपनी किती कव्हर द्यायचे ते ठरवते आणि उत्पन्नाचा पुरावा मागू शकते. आयआरडीएआयने कोणताही ठराविक गुणक ठरवलेला नाही; तरुण वयात विमा कंपन्या साधारणपणे उत्पन्नाच्या सुमारे १५ ते २५ पट कव्हर देतात.',
      clauseRef: 'Insurer underwriting policy (IRDAI sets no income multiple)',
    },
    'field-smoker': {
      title: 'Tobacco Disclosure & Section 45',
      en: 'Non-smokers receive a lifetime 20% discount. Accurate disclosure is vital: under Section 45, full truthfulness guarantees that your claim cannot be contested after 3 years.',
      hi: 'गैर-धूम्रपान करने वालों को 20% की लाइफटाइम छूट मिलती है। सही जानकारी देना जरूरी है ताकि सेक्शन 45 के तहत 3 साल बाद क्लेम कभी खारिज न हो सके।',
      mr: 'तंबाखूचे सेवन न करणाऱ्यांना २०% आजीवन सवलत मिळते. संपूर्ण सत्य माहिती दिल्यास कलम ४५ नुसार ३ वर्षांनंतर क्लेम कधीही फेटाळला जात नाही.',
      clauseRef: 'Section 45, Insurance Act 1938 & Clause 11.1',
    },
    'field-section45': {
      title: 'Statutory Section 45 Legal Declaration',
      en: 'Section 45 of the Insurance Act 1938 is the strongest consumer protection law in India. Once 3 years pass from policy issuance, the insurer can never legally dispute a claim.',
      hi: 'बीमा अधिनियम 1938 की धारा 45 भारत में सबसे मजबूत उपभोक्ता सुरक्षा कानून है। पॉलिसी जारी होने के 3 साल बाद बीमा कंपनी क्लेम पर कोई सवाल नहीं उठा सकती।',
      mr: 'विमा कायदा १९३८ चे कलम ४५ हा भारतातील सर्वात मोठा ग्राहक संरक्षण नियम आहे. पॉलिसी सुरू होऊन ३ वर्षे पूर्ण झाल्यानंतर कंपनी क्लेम नाकारू शकत नाही.',
      clauseRef: 'Insurance Act 1938, Section 45',
    },
  };

  const handleWhyAskThis = (fieldKey: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setActiveWhyAskField(fieldKey);
    const expl = WHY_ASK_THIS_EXPLANATIONS[fieldKey];
    if (!expl) return;

    playChime();
    const spoken = expl[selectedLanguage] || expl.en;
    speakText(spoken, selectedLanguage);

    setChatMessages((prev) => [
      ...prev,
      {
        sender: 'agent',
        text: `[Why NexaSure Asks: ${expl.title}]: ${spoken} (Ref: ${expl.clauseRef})`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  // Pixelate the SAM regions on a canvas. Runs in the browser: the un-redacted
  // image never leaves the page once SAM has located the PII.
  const pixelateRegions = (img: HTMLImageElement, regions: KycRegion[]): string => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    for (const r of regions) {
      const pad = 6;
      const x = Math.max(0, Math.floor(r.box.left - pad));
      const y = Math.max(0, Math.floor(r.box.top - pad));
      const w = Math.min(canvas.width - x, Math.ceil(r.box.right - r.box.left + pad * 2));
      const h = Math.min(canvas.height - y, Math.ceil(r.box.bottom - r.box.top + pad * 2));
      if (w <= 0 || h <= 0) continue;
      const factor = 16;
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(w / factor));
      small.height = Math.max(1, Math.round(h / factor));
      small.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    }
    return canvas.toDataURL('image/png');
  };

  // Loads a bundled sample or a file the customer picked and redraws it at a working size (at most
  // 1000 px wide and 1400 px tall) so a phone photo does not become a multi-megabyte upload. All
  // later steps (blur, locate, pixelate, read) use this working copy; the original stays in the page.
  const loadSampleImage = async (url: string): Promise<HTMLImageElement> => {
    const raw = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('could not load the image (use a PNG or JPEG)'));
      i.src = url;
    });
    const scale = Math.min(1, 1000 / raw.naturalWidth, 1400 / raw.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(raw.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(raw.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(raw, 0, 0, canvas.width, canvas.height);
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('could not prepare the image'));
      i.src = canvas.toDataURL('image/png');
    });
  };

  // Printed IDs are too small for SAM 3.1, so copies are blurred until text is unreadable (the layout
  // survives) and only those copies leave the page. The blur is computed by hand in kyc-blur.ts so
  // it is the same in every browser (Firefox's canvas downscale left a sharp, aliased picture).
  const blurForLocating = blurCopy;

  const locateTextIds = async (type: 'pan' | 'aadhaar' | 'salary-slip', img: HTMLImageElement): Promise<{ regions: KycRegion[]; ms: number }> => {
    const res = await fetch('/api/locate-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Three blur levels, so the server can keep only the positions that agree.
      body: JSON.stringify({
        documentType: type,
        // Measured with this blur: the Aadhaar number is partly readable at 63 px and 72 px wide
        // and fully at 80 px, so it is located on 48 to 54 px copies. The PAN number is unreadable
        // up to 100 px and leaks at 130 px, but below 85 px the locator often picks the wrong line,
        // so the PAN card uses 85 to 95 px; the salary slip IDs were unreadable at 105 px.
        blurredDataUrls: (type === 'aadhaar' ? [48, 50, 54] : type === 'pan' ? [85, 90, 95] : [70, 80, 90]).map((width) => blurForLocating(img, width)),
      }),
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.regions)) throw new Error(data.error || `Locate HTTP ${res.status}`);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const regions: KycRegion[] = data.regions.map((r: { concept: string; box: { left: number; top: number; right: number; bottom: number } }) => ({
      concept: r.concept,
      box: { left: r.box.left * W, top: r.box.top * H, right: r.box.right * W, bottom: r.box.bottom * H },
      confidence: null,
      masks: [],
      members: 1,
    }));
    recordModel(data.telemetry?.model, 'ID locator', data.telemetry?.totalMs ?? 0);
    return { regions, ms: data.telemetry?.totalMs ?? 0 };
  };

  const loadPolicyFile = async (file: File) => {
    setPolicyDoc({ name: file.name, pages: [], masked: 0, status: 'reading' });
    try {
      const { pages, masked } = await extractPolicyPages(file);
      setPolicyDoc({ name: file.name, pages, masked, status: 'ready' });
    } catch (e: any) {
      setPolicyDoc({ name: file.name, pages: [], masked: 0, status: 'error', error: e?.message || String(e) });
    }
  };
  const loadSamplePolicy = async () => {
    try {
      const res = await fetch('/samples/sample-policy.pdf');
      await loadPolicyFile(new File([await res.blob()], 'sample-nexasure-policy.pdf', { type: 'application/pdf' }));
    } catch (e: any) {
      setPolicyDoc({ name: 'sample policy', pages: [], masked: 0, status: 'error', error: e?.message || String(e) });
    }
  };
  // Share the text with the agent once a session is live (and again after a reconnect).
  useEffect(() => {
    if (policyDoc?.status !== 'ready' || !isListeningVoice || !agentRef.current) return;
    try {
      agentRef.current.sendPolicyDoc(policyDoc.name, policyDoc.pages);
    } catch (e: any) {
      setPolicyDoc((p) => p && { ...p, status: 'error', error: e?.message || String(e) });
    }
  }, [policyDoc?.status, policyDoc?.name, isListeningVoice]);

  // ---- Integrity Guardian ----
  const proposalFacts = (): ProposalFacts => ({
    sumAssured: baseSumAssured,
    monthlyPremium: totalMonthlyPayable,
    termYears: 30,
    riders: [
      ...(selectedRiders.criticalIllness ? [`Critical illness ${ciTier === 'tier1' ? '10' : ciTier === 'tier3' ? '50' : '25'} lakh`] : []),
      ...(selectedRiders.accidentalDeath ? ['Accidental death and disability'] : []),
      ...(selectedRiders.waiverOfPremium ? ['Waiver of premium'] : []),
      ...(selectedRiders.hospitalCash ? ['Hospital daily cash'] : []),
    ],
    nomineeCount: allNominees.length,
    nomineesTotalShare: nomineeTotalShare,
    anyMinorNominee,
    smoker: profile.isSmoker,
  });

  const draftSummary = (): DraftSummary => ({
    draftNumber: draftId || 'NXP-DRAFT',
    date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    sumAssuredLabel: baseSumAssured === '1cr' ? '1 crore rupees' : baseSumAssured === '1.5cr' ? '1.5 crore rupees' : '2 crore rupees',
    monthlyPremium: totalMonthlyPayable,
    termYears: 30,
    riders: [
      ...(selectedRiders.criticalIllness
        ? (() => {
            const lakh = ciTier === 'tier1' ? '10' : ciTier === 'tier3' ? '50' : '25';
            return [{ name: `Critical illness ${lakh} lakh`, monthlyCost: riderRates.criticalIllness, pays: `Lump sum of ${lakh} lakh rupees on diagnosis of a covered critical illness` }];
          })()
        : []),
      ...(selectedRiders.accidentalDeath
        ? [
            {
              name: `Accidental death and disability (${atpdOption === 'income' ? 'income benefit' : 'lump sum'})`,
              monthlyCost: riderRates.accidentalDeath,
              pays: atpdOption === 'income' ? '1 lakh rupees a month for 100 months' : '50 lakh rupees lump sum',
            },
          ]
        : []),
      ...(selectedRiders.waiverOfPremium ? [{ name: 'Waiver of premium', monthlyCost: riderRates.waiverOfPremium }] : []),
      ...(selectedRiders.hospitalCash ? [{ name: 'Hospital daily cash', monthlyCost: riderRates.hospitalCash }] : []),
      ...(lifeStageEscalator ? [{ name: 'Life stage escalator', monthlyCost: riderRates.lifeStageEscalator }] : []),
    ],
    nomineeCount: allNominees.length,
    nomineesTotalShare: nomineeTotalShare,
    anyMinorNominee,
    appointeeNamed: Boolean(nomination.appointeeName.trim()),
    smoker: profile.isSmoker,
    policyholder: {
      name: profile.fullName.trim(),
      dob: profile.dob.trim(),
      gender: profile.gender,
      city: profile.city.trim(),
      pincode: profile.pincode.trim(),
      pan: profile.panNumber || undefined,
      aadhaar: profile.aadhaarNumber ? profile.aadhaarNumber.replace(/(\d{4})(?=\d)/g, '$1 ') : undefined,
      mobile: profile.mobileNumber || undefined,
    },
    nominees: allNominees.map((n, i) => ({
      name: n.name,
      relation: n.relation,
      share: Number(n.share) || 0,
      ...(i === 0 ? { dob: nomination.primaryDob.trim() || undefined } : { age: n.age }),
    })),
    appointeeName: nomination.appointeeName.trim() || undefined,
    appointeeRelation: nomination.appointeeName.trim() ? nomination.appointeeRelation : undefined,
    mwpaTrust: nomination.mwpaTrustEnabled,
    declarations: { section45Declared: underwriting.section45Consent, familyHistoryDeclared: underwriting.familyCardiacHistory, hospitalizationDeclared: underwriting.priorHospitalization },
  });

  const loadGuardianDoc = async (which: 'sample' | 'issues' | 'draft') => {
    try {
      let blob: Blob;
      let name: string;
      if (which === 'draft') {
        blob = await buildDraftSummaryPdf(draftSummary());
        name = `proposed-policy-draft-${draftId}.pdf`;
      } else {
        const file = which === 'issues' ? 'sample-policy-with-issues.pdf' : 'sample-policy.pdf';
        blob = await (await fetch(`/samples/${file}`)).blob();
        name = file;
      }
      resetGuardian();
      await loadPolicyFile(new File([blob], name, { type: 'application/pdf' }));
    } catch (e: any) {
      setPolicyDoc({ name: 'document', pages: [], masked: 0, status: 'error', error: e?.message || String(e) });
    }
  };

  const downloadDraftSummary = async () => {
    const blob = await buildDraftSummaryPdf(draftSummary());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `proposed-policy-draft-${draftId}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const runGuardian = async () => {
    if (!policyDoc || !policyDoc.pages.length) return;
    const runId = ++guardianRunRef.current;
    guardianAbortRef.current?.abort();
    const abort = new AbortController();
    guardianAbortRef.current = abort;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, CLIENT_REVIEW_TIMEOUT_MS);
    setGuardianReview((r) => ({ ...r, status: 'running', error: undefined, startedAt: Date.now() }));
    try {
      const facts = proposalFacts();
      // The review model has a limited call budget: the same document with the same application numbers
      // reuses the earlier review, and only a changed application (after a fix) or document asks again.
      const cacheKey = (() => {
        const text = JSON.stringify([policyDoc.pages.map((p) => p.text), facts]);
        let h = 5381;
        for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
        return `nexasure.review.${h}.${text.length}`;
      })();
      let cached: GuardianResponse | null = null;
      try {
        const raw = window.sessionStorage.getItem(cacheKey);
        cached = raw ? (JSON.parse(raw) as GuardianResponse) : null;
      } catch {
        cached = null;
      }
      const res = cached
        ? ({ ok: true, status: 200, json: async () => cached } as unknown as Response)
        : await fetch('/api/guardian', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pages: policyDoc.pages, proposal: facts }),
            signal: abort.signal,
          });
      const data = await res.json().catch(() => ({}));
      if (runId !== guardianRunRef.current) return; // the document changed or the run was cancelled meanwhile
      if (!res.ok || !data.review) throw Object.assign(new Error(data.error || `Guardian HTTP ${res.status}`), { status: res.status, serverError: data.error });
      const response = data as GuardianResponse;
      if (!cached) {
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(response));
        } catch {
          /* storage full or blocked: the review still works, it just is not remembered */
        }
      }
      const checks = runChecks(response.review.facts, facts, { compareApplication: draftHasContent });
      if (!cached) recordModel(response.model, 'document review', response.ms); // a reused review made no model call
      setGuardianSection(0);
      setReviewedSections([]);
      setGuardianReview((r) => ({ status: 'done', response, checks, history: [...r.history, { at: Date.now(), issues: countIssues(checks), model: response.model }] }));
    } catch (e: any) {
      if (runId !== guardianRunRef.current) return;
      const message = reviewFailureMessage({ status: e?.status, error: e?.serverError ?? (e?.status ? undefined : e?.message), timedOut });
      setGuardianReview((r) => ({ ...r, status: 'error', error: `Review failed (no fallback): ${message}` }));
    } finally {
      clearTimeout(timer);
      if (guardianAbortRef.current === abort) guardianAbortRef.current = null;
    }
  };

  // The agent reads one section aloud: what the document says, what to watch, one question to put to the insurer.
  const sectionScript = (i: number): string => {
    const r = guardianReview.response?.review;
    const sec = r?.sections[i];
    if (!r || !sec) return '';
    const watch = [...sec.findings.filter((f) => f.kind !== 'ok').map((f) => f.text), ...(i === 0 ? guardianReview.checks.filter((f) => f.kind !== 'ok').map((f) => f.text) : [])].slice(0, 3);
    return [
      `Section ${i + 1} of ${r.sections.length}: ${sec.title}.`,
      sec.summary,
      watch.length ? `Worth noting: ${watch.join(' ')}` : 'I found nothing in this section that needs attention.',
      sec.suggestedQuestions[0] ? `You could ask the insurer: ${sec.suggestedQuestions[0]}` : '',
      'Ask me anything about this section, or say next section.',
    ].filter(Boolean).join(' ');
  };
  const openGuardianSection = (i: number, speak: boolean) => {
    const n = guardianReview.response?.review.sections.length ?? 0;
    if (!n) return;
    const idx = Math.min(n - 1, Math.max(0, i));
    setGuardianSection(idx);
    setReviewedSections((prev) => (prev.includes(idx) ? prev : [...prev, idx]));
    if (speak) speakText(sectionScript(idx), selectedLanguage);
  };
  const askGuardian = (q: string) => {
    setAskedQuestions((prev) => (prev.includes(q) ? prev : [...prev, q]));
    processUserSpokenQuestion(q);
  };
  const fixInApplication = (step: 1 | 2 | 3 | 4 | 5) => {
    setMode('cobrowse');
    window.setTimeout(() => goToStep(step), 50);
  };
  const downloadGuardianReport = () => {
    const r = guardianReview.response?.review;
    if (!r) return;
    const issues = guardianReview.checks.filter((f) => f.kind !== 'ok');
    const lines = [
      `# Integrity Guardian readiness report`,
      `Proposal ${draftId} · reviewed ${new Date().toLocaleString()} · ${guardianReview.response?.model}`,
      ``,
      `This is not legal or financial advice and does not predict any claim decision. You decide whether to proceed.`,
      ``,
      `## Possible issues (${issues.length})`,
      ...(issues.length ? issues.map((f) => `- ${f.text}${f.page ? ` (page ${f.page})` : ''}`) : ['- none found']),
      ``,
      `## Sections reviewed with you: ${reviewedSections.length} of ${r.sections.length}`,
      ...r.sections.map((s, i) => `- ${reviewedSections.includes(i) ? '[x]' : '[ ]'} ${s.title}`),
      ``,
      `## Questions to put to the insurer`,
      ...Array.from(new Set(r.sections.flatMap((s) => s.suggestedQuestions))).map((q) => `- [${askedQuestions.includes(q) ? 'x' : ' '}] ${q}`),
    ];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }));
    a.download = `guardian-report-${draftId}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const requestApproval = (key: PendingApproval['key'], label: string, undo: () => void) => {
    setPendingApprovals((prev) => (prev.some((a) => a.key === key) ? prev : [...prev, { key, label, undo }]));
  };
  const currentValueOf = (key: PendingApproval['key']): string =>
    key === 'annualIncome' ? profile.annualIncome : key === 'isSmoker' ? String(profile.isSmoker) : JSON.stringify(nomination);
  const approvalSummary = (key: PendingApproval['key']): string =>
    key === 'annualIncome'
      ? profile.annualIncome || 'not set'
      : key === 'isSmoker'
      ? profile.isSmoker === null ? 'not set' : profile.isSmoker ? 'Smoker / tobacco user' : 'Non-smoker'
      : nomineeSummary;
  // First render after the agent's change records the value it set; any later difference means the
  // customer edited it themselves (or an undo ran), so the approval is no longer needed.
  useEffect(() => {
    setPendingApprovals((prev) => {
      let changed = false;
      const next: PendingApproval[] = [];
      for (const a of prev) {
        const now = currentValueOf(a.key);
        if (a.applied === undefined) {
          changed = true;
          next.push({ ...a, applied: now });
        } else if (a.applied !== now) changed = true;
        else next.push(a);
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.annualIncome, profile.isSmoker, nomination]);

  // Put what a document says into the form without overwriting anything the customer typed.
  // Empty fields are filled; a field that already holds a different value becomes a discrepancy
  // for the customer to resolve (features: never silently overwrite a declaration).
  const reconcileDocument = (source: string, incoming: Partial<Record<DocDiscrepancy['field'], string>>) => {
    const cur = profileRef.current as Record<string, any>;
    const norm = (field: string, v: string) =>
      field === 'fullName' ? v.toUpperCase().replace(/[^A-Z]/g, '') : field === 'gender' ? v.trim().charAt(0).toUpperCase() : v.replace(/\W/g, '').toUpperCase();
    const labels: Record<string, string> = { fullName: 'Name', dob: 'Date of birth', pincode: 'PIN code', gender: 'Gender', annualIncome: 'Annual income' };
    const patch: Record<string, string> = {};
    const found: DocDiscrepancy[] = [];
    for (const [field, value] of Object.entries(incoming)) {
      if (!value) continue;
      const typed = String(cur[field] ?? '');
      if (!typed.trim()) patch[field] = value;
      else if (norm(field, typed) !== norm(field, value)) found.push({ field: field as DocDiscrepancy['field'], label: labels[field], typed, fromDocument: value, source });
    }
    if (Object.keys(patch).length) setProfile((prev) => ({ ...prev, ...patch }));
    setDocDiscrepancies((prev) => [...prev.filter((d) => !(d.source === source && found.some((f) => f.field === d.field))), ...found]);
    return found;
  };

  const resolveDiscrepancy = (d: DocDiscrepancy, useDocument: boolean) => {
    if (useDocument) setProfile((prev) => ({ ...prev, [d.field]: d.fromDocument }));
    setDocDiscrepancies((prev) => prev.filter((x) => !(x.field === d.field && x.source === d.source)));
  };

  // 1-click KYC: SAM 3.1 locates PII -> browser pixelates it -> only the redacted image
  // goes to Muse Spark for OCR. Two Meta models, and the reader never sees the ID.
  // Income proof: Muse Spark reads the sample salary slip; account identifiers are masked server-side.
  const handleSalarySlipOcr = async (uploadUrl?: string) => {
    playChime();
    setChatMessages((prev) => [...prev, { sender: 'agent', text: devRef.current ? 'Reading the sample salary slip with Meta Muse Spark for income proof…' : 'Reading your salary slip for income proof…', time: stampNow() }]);
    try {
      const slipUrl = uploadUrl || '/samples/sample-salary-slip.png';
      setKycPanelOpen(true);
      setKycRedaction({ type: 'salary-slip', imageUrl: slipUrl, width: 1000, height: 630, regions: [], redactedDataUrl: null, samMs: null, samCached: false, locateMs: null, ocrMs: null, status: 'Locating ID numbers on a blurred copy…' });
      const slipImg = await loadSampleImage(slipUrl);
      const located = await locateTextIds('salary-slip', slipImg);
      const slipRedacted = pixelateRegions(slipImg, located.regions);
      setKycRedaction((prev) => prev && { ...prev, regions: located.regions, redactedDataUrl: slipRedacted, locateMs: located.ms, status: 'Pixelated in your browser. Sending redacted image to Muse Spark…' });
      setChatMessages((prev) => [...prev, { sender: 'agent', text: devRef.current ? `Muse Spark located ${located.regions.length} identifiers on a blurred copy (${located.ms} ms): ${located.regions.map((r) => r.concept).join(', ')}.` : `Hidden in your browser before the reader model: ${located.regions.map((r) => r.concept).join(', ')}.`, time: stampNow() }]);
      const t0 = performance.now();
      const res = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentType: 'salary-slip', imageDataUrl: slipRedacted }) });
      const data = await res.json();
      if (!res.ok || !data.fields) throw new Error(data.error || `OCR HTTP ${res.status}`);
      recordModel(data.telemetry?.model, 'document reader', data.telemetry?.totalMs ?? 0);
      const slipLeaks: string[] = Array.isArray(data.redactionLeaks) ? data.redactionLeaks : [];
      setKycRedaction((prev) => prev && { ...prev, ocrMs: Math.round(performance.now() - t0), status: slipLeaks.length ? `Warning: ${slipLeaks.join(', ')} still readable after redaction` : 'Done' });
      if (slipLeaks.length) setChatMessages((prev) => [...prev, { sender: 'agent', text: `Warning: the shield missed the ${slipLeaks.join(', ')}; it was still readable in the redacted image.`, time: stampNow() }]);
      const f = data.fields as { fullName: string | null; employerName: string | null; monthlyGross: string | null; annualIncome: string | null; payPeriod: string | null; bankAccountMasked: string | null };
      const ms = Math.round(performance.now() - t0);
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'agent',
          text: `${devRef.current ? `Muse Spark read the salary slip (${ms} ms)` : 'Read your salary slip'}: ${[f.employerName && `Employer: ${f.employerName}`, f.monthlyGross && `Gross: ₹${Number(f.monthlyGross).toLocaleString('en-IN')}/mo`, f.annualIncome && `Annual: ₹${Number(f.annualIncome).toLocaleString('en-IN')}`, f.bankAccountMasked && `A/c ${f.bankAccountMasked}`].filter(Boolean).join(' • ')}. Filling annual income.`,
          time: stampNow(),
        },
      ]);
      if (f.annualIncome) {
        speakText(`Your salary slip shows an annual income of ${Number(f.annualIncome).toLocaleString('en-IN')} rupees. I am filling it in now.`, selectedLanguage);
        glideAgentCursorToElement('field-annual-income', 'Populate annual income from salary slip', () => {
          reconcileDocument('salary slip', { annualIncome: incomeRangeFor(f.annualIncome || ''), fullName: f.fullName || '' });
        });
      }
    } catch (e: any) {
      setKycRedaction((prev) => prev && { ...prev, status: `Failed: ${e?.message || e}` });
      setChatMessages((prev) => [...prev, { sender: 'agent', text: `Income proof OCR failed (Meta API, no fallback): ${e?.message || e}`, time: stampNow() }]);
    }
  };

  // uploadUrl: an object URL for a file the customer picked; without it a bundled fictional sample is used.
  const handleRunSampleKycOcr = async (type: 'pan' | 'aadhaar' | 'salary-slip', uploadUrl?: string) => {
    if (type === 'salary-slip') return handleSalarySlipOcr(uploadUrl);
    setKycSampleCard(type);
    setKycPanelOpen(true);
    playChime();
    const label = type === 'pan' ? 'PAN' : 'Aadhaar';
    const imageUrl = uploadUrl || `/samples/sample-${type}.png`;
    setKycRedaction({
      type,
      imageUrl,
      width: 1000,
      height: 630,
      regions: [],
      redactedDataUrl: null,
      samMs: null,
      samCached: false,
      locateMs: null,
      ocrMs: null,
      status: 'Blurring a copy in your browser…',
    });
    setChatMessages((prev) => [
      ...prev,
      { sender: 'agent', text: devRef.current ? `Sending only blurred copies of the ${uploadUrl ? 'uploaded' : 'sample'} ${label} card to Meta SAM 3.1 to locate the photo, signature and QR code…` : `Locating the private parts of your ${label} card so they can be hidden before anything reads it…`, time: stampNow() },
    ]);
    try {
      // Only blurred copies leave the browser: SAM sees layout (photo, signature, QR code), never text.
      const img = await loadSampleImage(imageUrl);
      setKycRedaction((prev) => prev && { ...prev, width: img.naturalWidth, height: img.naturalHeight, status: 'SAM 3.1 locating the photo, signature and QR code on a blurred copy…' });
      const samRes = await fetch('/api/sam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Same measured limits as the locator: 48 to 54 px for the Aadhaar card, 70 to 90 px for the PAN card.
        body: JSON.stringify({ documentType: type, blurredDataUrls: (type === 'aadhaar' ? [48, 50, 54] : [70, 80, 90]).map((width) => blurForLocating(img, width)) }),
      });
      const sam = await samRes.json();
      if (!samRes.ok || !Array.isArray(sam.regions)) throw new Error(sam.error || `SAM HTTP ${samRes.status}`);
      recordModel(sam.telemetry?.model, 'photo, signature, QR', sam.telemetry?.totalMs ?? 0);
      const regions: KycRegion[] = [...sam.regions];
      let locateMs: number | null = null;
      {
        setKycRedaction((prev) => prev && { ...prev, status: `Locating the ${type === 'pan' ? 'PAN' : 'Aadhaar'} number on a blurred copy…` });
        const located = await locateTextIds(type, img);
        regions.push(...located.regions);
        locateMs = located.ms;
      }
      const redactedDataUrl = pixelateRegions(img, regions);
      const samMs = sam.telemetry?.totalMs ?? null;
      const samCached = false;
      setKycRedaction((prev) =>
        prev && {
          ...prev,
          imageUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
          regions,
          redactedDataUrl,
          samMs,
          samCached,
          locateMs,
          status: 'Pixelated in your browser. Sending redacted image to Muse Spark…',
        }
      );
      const found = regions.map((r) => (r.members > 1 ? `${r.concept} (${r.members} glyphs)` : r.concept)).join(', ');
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'agent',
          text: devRef.current
            ? `SAM 3.1 found ${regions.length} region${regions.length === 1 ? '' : 's'}: ${found || 'none'}${samMs !== null ? ` in ${samMs} ms` : ''}. Pixelated in the browser before OCR.`
            : `Hidden in your browser before the reader model: ${regions.map((r) => r.concept).join(', ') || 'nothing found'}.`,
          time: stampNow(),
        },
      ]);

      const t0 = performance.now();
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType: type, imageDataUrl: redactedDataUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.fields) throw new Error(data.error || `OCR HTTP ${res.status}`);
      recordModel(data.telemetry?.model, 'document reader', data.telemetry?.totalMs ?? 0);
      const ocrMs = Math.round(performance.now() - t0);
      const leaks: string[] = Array.isArray(data.redactionLeaks) ? data.redactionLeaks : [];
      setKycRedaction((prev) => prev && { ...prev, ocrMs, status: leaks.length ? `Warning: ${leaks.join(', ')} still readable after redaction` : 'Done' });
      if (leaks.length) setChatMessages((prev) => [...prev, { sender: 'agent', text: `Warning: the shield missed the ${leaks.join(', ')}; it was still readable in the redacted image.`, time: stampNow() }]);
      const f = data.fields as {
        fullName: string | null;
        dob: string | null;
        gender: string | null;
        pincode: string | null;
        idNumberMasked: string | null;
      };
      const summary = [
        f.fullName && `Name: ${f.fullName}`,
        f.dob && `DOB: ${f.dob}`,
        f.pincode && `Pincode: ${f.pincode}`,
        f.idNumberMasked ? `ID: ${f.idNumberMasked}` : `ID number: hidden before reading`,
      ]
        .filter(Boolean)
        .join(' • ');
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'agent',
          text: devRef.current
            ? `Muse Spark OCR on the redacted image (${data.telemetry?.model}, ${data.telemetry?.totalMs} ms): ${summary}. Populating the form.`
            : `Read your ${label} card: ${summary}. Filling the form.`,
          time: stampNow(),
        },
      ]);
      const voice =
        selectedLanguage === 'hi'
          ? `आपके ${type === 'pan' ? 'पैन' : 'आधार'} कार्ड की निजी जानकारी आपके डिवाइस पर छिपा दी गई और म्यूज़ स्पार्क ने बाकी विवरण पढ़ लिया है। मैं फॉर्म भर रहा हूँ।`
          : `The private regions of your ${label} card were hidden in your browser before Muse Spark read the rest${f.fullName ? ` for ${f.fullName}` : ''}. Populating the form now.${uploadUrl ? ` Please type your ${label} number in Identity records, it was hidden before reading.` : ''}`;
      speakText(voice, selectedLanguage);
      const gender = f.gender ? (/^m/i.test(f.gender) ? 'Male' : /^f/i.test(f.gender) ? 'Female' : '') : '';
      glideAgentCursorToElement(type === 'pan' ? 'field-full-name' : 'field-city', `Populate ${label} OCR fields`, () => {
        // A sample's ID number is known to the app; a real upload's number was hidden before reading,
        // so the customer types it into Identity records.
        if (!uploadUrl) setIdFromSample((prev) => ({ ...prev, [type]: true }));
        reconcileDocument(`${label} card`, { fullName: f.fullName || '', dob: f.dob || '', pincode: f.pincode || '', gender });
        if (!uploadUrl) setProfile((prev) => ({ ...prev, ...(type === 'pan' ? { panNumber: SAMPLE_IDS.pan } : { aadhaarNumber: SAMPLE_IDS.aadhaar }) }));
      });
    } catch (e: any) {
      setKycRedaction((prev) => prev && { ...prev, status: `Failed: ${e?.message || e}` });
      setChatMessages((prev) => [
        ...prev,
        { sender: 'agent', text: `KYC pipeline failed (Meta API, no fallback): ${e?.message || e}`, time: stampNow() },
      ]);
    }
  };

  const handleDownloadAuditCertificate = async () => {
    const certId = `NEXA-AUDIT-2026-${Math.random().toString(16).substring(2, 8).toUpperCase()}`;
    const timestamp = new Date().toISOString();
    const currentMonthlyBase = monthlyBase;
    const totalSaved = annualTaxSavings;
    const netCost = Math.max(0, (totalMonthlyPayable * 12) - totalSaved);

    const certPayload = {
      certificateId: certId,
      product: 'NexaSure Flexi Shield (Pure Term Insurance)',
      irdaUin: 'Not applicable (demo product, not a registered plan)',
      generatedAt: timestamp,
      coBrowsingEngine: 'OmniCB voice agent (Meta Muse Voice Transcribe 1.0 + Muse Spark 1.3 + SAM 3.1 + Muse Wonder 1.0)',
      applicant: {
        legalName: profile.fullName || 'Rahul Shankar Sharma',
        dateOfBirth: profile.dob || '14/08/1992',
        annualIncome: profile.annualIncome ? `₹${Number(profile.annualIncome).toLocaleString()}` : '₹18,00,000',
        tobaccoUser: profile.isSmoker ? 'Yes' : 'No (20% Lifetime Non-Smoker Discount Active)',
      },
      coverageSchedule: {
        baseSumAssured: baseSumAssured === '1cr' ? '₹1.00 Crore' : baseSumAssured === '1.5cr' ? '₹1.50 Crore' : '₹2.00 Crore',
        monthlyBasePremium: `₹${currentMonthlyBase}`,
        criticalIllnessRider: selectedRiders.criticalIllness ? 'Active (₹25,00,000 cover, Clause 4.2)' : 'Not Opted',
        waiverOfPremiumRider: selectedRiders.waiverOfPremium ? 'Active (30-year premium waiver, Clause 6.1)' : 'Not Opted',
        totalMonthlyPayable: `₹${totalMonthlyPayable}/month`,
      },
      statutoryCompliance: {
        section45InsuranceAct1938: 'ACKNOWLEDGED_FULL_DISCLOSURE (3-year statutory incontestability active)',
        section39Nomination: 'VERIFIED_DIRECT_BENEFICIARY',
        freeLookPeriod: '30-Day Statutory Electronic Free-Look Cancellation Period Guaranteed',
      },
      taxOptimizationSummary: {
        basis: 'Illustrative estimate: 31.2% slab, old tax regime only, deduction capped at ₹1.5 lakh (sections 123/126 of the Income-tax Act 2025). Not tax advice.',
        totalAnnualTaxSaved: `about ₹${totalSaved.toLocaleString()}/yr (estimate)`,
        netEffectiveYearlyCost: `₹${netCost.toLocaleString()}/yr (effective ₹${Math.round(netCost / 12)}/month)`,
      },
      eSignature: esignValid
        ? { signedBy: esign.typedName.trim(), signedAt: esign.signedAt, signatureHash: esign.hash, note: 'Demo e-sign: typed name and consent only, no Aadhaar OTP, not legally binding' }
        : { status: 'not signed' },
      firstPremiumPayment: paymentValid
        ? { transactionId: payment.txnId, amount: `₹${payment.amount}`, mode: payment.mode, paidAt: payment.paidAt, note: 'Demo checkout: no real money moved' }
        : { status: 'not paid' },
      auditNonRepudiation: {
        zeroAutonomousFinalSubmission: true,
        humanInTheLoopConfirmed: true,
        sha256VerificationHash: ''as string,
      },
    };
    // Real SHA-256 of the certificate content (computed in the browser with Web Crypto).
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...certPayload, auditNonRepudiation: { ...certPayload.auditNonRepudiation, sha256VerificationHash: '' } })));
      certPayload.auditNonRepudiation.sha256VerificationHash = `0x${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      certPayload.auditNonRepudiation.sha256VerificationHash = 'unavailable';
    }

    setAuditCertData(certPayload);
    setShowAuditCertModal(true);

    // Independent auditor's narrative from Meta Muse Wonder (5–10 s; this is a download, not the voice path)
    setChatMessages((prev) => [...prev, { sender: 'agent', text: devRef.current ? 'Muse Wonder is writing the independent audit narrative for your certificate…' : 'Preparing the independent audit summary for your certificate…', time: stampNow() }]);
    let finalPayload: Record<string, unknown> = certPayload;
    try {
      const res = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ certificate: certPayload }) });
      const data = await res.json();
      if (!res.ok || !data.narrative) throw new Error(data.error || `HTTP ${res.status}`);
      finalPayload = { ...certPayload, auditorNarrative: { model: data.telemetry?.model, generatedInMs: data.telemetry?.totalMs, ...data.narrative } };
      setAuditCertData(finalPayload);
      setChatMessages((prev) => [...prev, { sender: 'agent', text: devRef.current ? `Muse Wonder audit narrative added (${data.telemetry?.totalMs} ms): ${data.narrative.summary}` : `Independent audit summary: ${data.narrative.summary}`, time: stampNow() }]);
    } catch (e: any) {
      setChatMessages((prev) => [...prev, { sender: 'agent', text: `Audit narrative failed (Meta API, no fallback): ${e?.message || e}. Downloading the certificate without it.`, time: stampNow() }]);
    }

    const blob = new Blob([JSON.stringify(finalPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${certId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setChatMessages((prev) => [
      ...prev,
      {
        sender: 'agent',
        text: `Application Guardian Audit Certificate [${certId}] generated and downloaded. Complete legal audit trail for underwriting archived.`,
        time: 'Just now',
      },
    ]);
  };

  const updateMicMeter = (rms: number, gated: boolean) => {
    const pct = Math.min(100, Math.round(rms * 400));
    if (micDecibelBarRef.current) micDecibelBarRef.current.style.width = `${gated ? 4 : Math.max(4, pct)}%`;
    if (micDecibelTextRef.current) micDecibelTextRef.current.textContent = gated ? 'muted while agent speaks' : `${pct}%`;
  };

  const startVoiceListening = async (langOverride?: 'en' | 'hi' | 'mr') => {
    if (typeof window === 'undefined' || isListeningRef.current) return;
    setMicPermissionError(null);
    setVoiceTranscriptLive('');
    setSessionTts(ttsProviderRef.current);
    const client = new VoiceAgentClient({
      lang: langOverride || latestRef.current.lang,
      voice: voicePersonaRef.current,
      accent: accentRef.current,
      ttsProvider: ttsProviderRef.current,
      priorTurns: recentTurns(),
      customerId: getCustomerId(),
      autoWelcome: false,
      onEvent: handleAgentEvent,
      onSpeaking: setSpeakingState,
    });
    agentRef.current = client;
    isListeningRef.current = true;
    try {
      await client.start();
      setIsListeningVoice(true);
      playChime();
    } catch (err: any) {
      isListeningRef.current = false;
      agentRef.current = null;
      client.stop();
      const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      setMicPermissionError(
        denied
          ? 'Microphone permission was denied. Please allow microphone access in your browser URL bar.'
          : `Could not start the voice agent: ${err?.message || err}`
      );
    }
  };

  const stopVoiceListening = () => {
    isListeningRef.current = false;
    agentRef.current?.stop();
    agentRef.current = null;
    setIsListeningVoice(false);
    setVoiceTranscriptLive('');
    setVoiceThinking(false);
    setAgentState('listening');
    setSpeakingState(false);
    if (micDecibelBarRef.current) micDecibelBarRef.current.style.width = '0%';
    if (micDecibelTextRef.current) micDecibelTextRef.current.textContent = '0%';
  };

  const toggleVoiceListening = () => {
    if (!isCoBrowsingConnected) {
      void connectCoBrowsingSession();
      return;
    }
    if (isSpeakingRef.current && agentRef.current) {
      agentRef.current.interrupt(); // stop talking, keep listening
      return;
    }
    if (isListeningVoice) {
      stopVoiceListening();
    } else {
      void startVoiceListening();
    }
  };

  // Direct user question via typed input
  const handleAskAgent = async () => {
    if (!userQuery.trim()) return;
    const q = userQuery;
    setUserQuery('');
    if (!isCoBrowsingConnected) {
      await connectCoBrowsingSession();
    }
    processUserSpokenQuestion(q);
  };

  // Premium Calculations
  const baseRates = { '1cr': 790, '1.5cr': 1050, '2cr': 1380 };
  const riderRates = {
    criticalIllness: ciTier === 'tier1' ? 89 : ciTier === 'tier3' ? 269 : 149,
    accidentalDeath: atpdOption === 'income' ? 129 : 79,
    waiverOfPremium: 42,
    hospitalCash: 55,
    lifeStageEscalator: 49,
  };

  const monthlyBase = baseRates[baseSumAssured];
  const monthlyRiders =
    (selectedRiders.criticalIllness ? riderRates.criticalIllness : 0) +
    (selectedRiders.accidentalDeath ? riderRates.accidentalDeath : 0) +
    (selectedRiders.waiverOfPremium ? riderRates.waiverOfPremium : 0) +
    (selectedRiders.hospitalCash ? riderRates.hospitalCash : 0) +
    (lifeStageEscalator ? riderRates.lifeStageEscalator : 0);

  const subtotalMonthly = monthlyBase + monthlyRiders;
  // Individual life insurance premiums are exempt from GST (from 22 Sep 2025), so none is added.
  const totalMonthlyPayable = subtotalMonthly;
  // Illustrative only: 31.2% slab, old tax regime, deduction capped at ₹1.5 lakh, not tax advice.
  const annualTaxSavings = Math.round(Math.min(subtotalMonthly * 12, 150000) * 0.312);

  // ---- Pause and resume ----
  // The e-signature and the payment are never saved. Identity numbers are kept out of the plain draft: the local
  // copy seals them (id-seal.ts) and the copy for other devices carries them inside its resume-key encryption.
  const idNumbers = (): IdNumbers => ({ aadhaarNumber: profile.aadhaarNumber, panNumber: profile.panNumber, mobileNumber: profile.mobileNumber, fromSample: idFromSample });
  const draftSnapshot = () => ({
    v: 1,
    profile: { ...profile, aadhaarNumber: '', panNumber: '', mobileNumber: '' },
    baseSumAssured,
    selectedRiders,
    noRiders,
    ciTier,
    atpdOption,
    lifeStageEscalator,
    nomination,
    underwriting,
    activeStep,
    lang: selectedLanguage,
  });
  const draftHasContent = Boolean(profile.fullName || profile.dob || profile.city || nomination.primaryName || activeStep > 1);

  useEffect(() => {
    const cur = currentId();
    const existing = cur ? readIndex().find((m) => m.id === cur) : null;
    if (cur && existing && loadDraft(cur)) {
      setDraftId(cur);
      setPendingResume(existing);
    } else {
      const id = newDraftId();
      setDraftId(id);
      setCurrent(id);
      setDraftReady(true);
    }
    setSavedProposals(readIndex());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftId || !draftReady || policyIssued || !draftHasContent) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const idsSealed = await sealIds(idNumbers());
      if (!cancelled) saveDraft(draftId, { ...draftSnapshot(), idsSealed }, activeStep);
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draftReady, policyIssued, profile, idFromSample, baseSumAssured, selectedRiders, noRiders, ciTier, atpdOption, lifeStageEscalator, nomination, underwriting, activeStep]);

  const applyDraft = async (id: string): Promise<boolean> => {
    const d = loadDraft<any>(id);
    if (!d || d.v !== 1) return false;
    // Identity numbers are sealed in this browser's copy (a cross-device copy is sealed on arrival, see resumeRemote).
    const ids = await openIds(d.idsSealed);
    setProfile((p) => ({ ...p, ...d.profile, aadhaarNumber: ids?.aadhaarNumber || '', panNumber: ids?.panNumber || '', mobileNumber: ids?.mobileNumber || '' }));
    setIdFromSample({ aadhaar: Boolean(ids?.fromSample?.aadhaar), pan: Boolean(ids?.fromSample?.pan) });
    if (d.baseSumAssured) setBaseSumAssured(d.baseSumAssured);
    if (d.selectedRiders) setSelectedRiders(d.selectedRiders);
    setNoRiders(Boolean(d.noRiders));
    if (d.ciTier) setCiTier(d.ciTier);
    if (d.atpdOption) setAtpdOption(d.atpdOption);
    setLifeStageEscalator(Boolean(d.lifeStageEscalator));
    if (d.nomination) setNomination((n) => ({ ...n, ...d.nomination }));
    if (d.underwriting) setUnderwriting((u) => ({ ...u, ...d.underwriting }));
    setEsign({ typedName: '', consent: false, signedAt: null, hash: null, fingerprint: null, error: null });
    setPayment({ mode: 'upi', status: 'idle', txnId: null, paidAt: null, amount: null });
    setActiveStep(Math.min(5, Math.max(1, Number(d.activeStep) || 1)));
    setDraftId(id);
    setCurrent(id);
    setDraftReady(true);
    setPendingResume(null);
    setShowResumePanel(false);
    setPausedNote(null);
    setPausedKey(null);
    setStepNotice(null);
    setMode('cobrowse');
    setEntry('done');
    return true;
  };

  const startNewProposal = () => {
    if (draftId && pendingResume) deleteDraft(draftId);
    const id = newDraftId();
    setCurrent(id);
    window.location.reload();
  };

  const pauseProposal = async () => {
    if (!draftId) return;
    const saved = draftHasContent ? saveDraft(draftId, { ...draftSnapshot(), idsSealed: await sealIds(idNumbers()) }, activeStep) : true;
    setDraftReady(true);
    setSavedProposals(readIndex());
    if (isCoBrowsingConnectedRef.current) disconnectCoBrowsingSession();
    setPausedKey(null);
    if (!draftHasContent) {
      setPausedNote(`Proposal ${draftId} has nothing to save yet.`);
      return;
    }
    setPausedNote(saved ? `Proposal ${draftId} is saved in this browser. Saving an encrypted copy for other devices…` : `Could not save in this browser (storage is blocked). Proposal ${draftId} was not saved here.`);
    try {
      // The draft is encrypted here, in the browser, with a key made now; the server only ever holds ciphertext.
      const key = generateResumeKey();
      const { blob, authToken } = await encryptDraft({ ...draftSnapshot(), ids: idNumbers() }, key, draftId, activeStep);
      const old = storedAuth(draftId);
      const res = await fetch('/api/vault', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(old ? { 'X-Vault-Auth': old } : {}) },
        body: JSON.stringify(blob),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(res.status === 403 ? 'a copy with this code was saved from another browser; open it there or resume it here with its key first' : d.error || `HTTP ${res.status}`);
      }
      storeAuth(draftId, authToken);
      setPausedKey(key);
      setPausedNote(`Proposal ${draftId} is paused. It is saved in this browser, and an encrypted copy can be opened on any device with this code and the resume key below. Your signature and payment are never saved, so you will sign and pay again. Your Aadhaar, PAN and mobile number travel inside the encrypted copy and come back when you resume.`);
    } catch (e: any) {
      setPausedNote(`Proposal ${draftId} is saved in this browser only. The encrypted copy for other devices could not be uploaded (${e?.message || e}), so it cannot be resumed on another device yet. Your copy in this browser is safe.`);
    }
  };

  const resumeRemote = async () => {
    const id = normalizeCode(remoteId);
    const key = normalizeResumeKey(remoteKey);
    if (!/^NXP-[A-HJKMNP-Z2-9]{8}$/.test(id)) return setRemoteError('Enter the proposal code, like NXP-7KQ2M9XD.');
    if (!key) return setRemoteError('Enter the 10-character resume key, like 7KQ2M-9XDPA.');
    setRemoteBusy(true);
    setRemoteError('');
    try {
      const res = await fetch(`/api/vault?id=${encodeURIComponent(id)}`);
      if (res.status === 404) return setRemoteError('No saved proposal with that code.');
      if (!res.ok) return setRemoteError(res.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Could not reach the vault. Try again.');
      const { draft, authToken } = await decryptDraft<any>(await res.json(), key, id);
      if (!draft || draft.v !== 1) return setRemoteError('That saved copy could not be read.');
      // A local copy, so resuming in this browser needs no key next time. The identity numbers are sealed for this
      // browser before they touch localStorage (sealIds returns null if that is unavailable, and they are retyped).
      const { ids: arrivedIds, ...rest } = draft;
      saveDraft(id, { ...rest, idsSealed: arrivedIds ? await sealIds(arrivedIds as IdNumbers) : null }, Number(draft.activeStep) || 1);
      storeAuth(id, authToken);
      if (await applyDraft(id)) {
        setRemoteId('');
        setRemoteKey('');
      }
    } catch (e) {
      setRemoteError(e instanceof VaultKeyError ? 'That key does not match this proposal.' : 'Something went wrong resuming this proposal.');
    } finally {
      setRemoteBusy(false);
    }
  };

  const resumeByCode = async () => {
    const id = normalizeCode(resumeCode);
    if (!id) return;
    if (!(await applyDraft(id))) setResumeError('No saved proposal with that code in this browser.');
    else setResumeError('');
  };

  // Policy Issuance
  const submitPolicyProposal = () => {
    if (maxReachableStep < 5 || !esignValid || !paymentValid) return;
    const id = `NEXA-LIFE-2026-${Math.floor(100000 + Math.random() * 900000)}`;
    setProposalId(id);
    setPolicyIssued(true);
    if (draftId) deleteDraft(draftId);
    setActiveStep(5);
    const msg = selectedLanguage === 'hi'
      ? `बधाई हो! आपकी NexaSure पॉलिसी ${id} सफलतापूर्वक जारी कर दी गई है।`
      : selectedLanguage === 'mr'
      ? `अभिनंदन! तुमची NexaSure पॉलिसी ${id} यशस्वीपणे जारी करण्यात आली आहे.`
      : `Congratulations! Your NexaSure policy ${id} has been generated successfully.`;
    speakText(msg, selectedLanguage);
  };

  // Architectural Inspector State
  const [showArchInspector, setShowArchInspector] = useState<boolean>(false);

  // Bring the clause the agent is explaining into view once the drawer has slid in; forget it on close.
  useEffect(() => {
    if (!showTermsDrawer) {
      setHighlightedClause(null);
      return;
    }
    if (!highlightedClause) return;
    const t = setTimeout(() => {
      document.getElementById(`clause-${highlightedClause}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    return () => clearTimeout(t);
  }, [showTermsDrawer, highlightedClause]);

  // Keyboard shortcut listener: ESC to instantly reclaim screen control
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && screenControlStatus === 'granted') {
        revokeScreenControl();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screenControlStatus]);

  // Glide Agent Virtual Cursor smoothly across viewport to target element
  // Which step renders each clickable target, so the agent can switch screens before clicking.
  // Move to a step only if every step before it is valid; otherwise stop at the first incomplete one
  // and say what is missing. Going back is always allowed.
  const goToStep = (target: number): boolean => {
    const { issues, maxReachable } = stepGateRef.current;
    if (target <= maxReachable) {
      setStepNotice(null);
      setActiveStep(target);
      return true;
    }
    setActiveStep(maxReachable);
    setStepNotice({ step: maxReachable, issues: issues[maxReachable].map((i) => i.msg) });
    const first = issues[maxReachable][0];
    if (first) {
      window.setTimeout(() => {
        const el = document.getElementById(first.id);
        el?.scrollIntoView({ block: 'center' });
        (el as HTMLElement | null)?.focus?.();
      }, 120);
    }
    return false;
  };

  const stepForElement = (elementId: string): number | null => {
    if (/^step-tab-/.test(elementId)) return null;
    if (/^(field-|select-|input-|option-)/.test(elementId) && elementId !== 'field-section-45') return 1;
    if (elementId === 'card-esign' || elementId === 'card-payment') return 5;
    if (/^(cover-tier-|card-)/.test(elementId) && elementId !== 'card-premium-summary') return 2;
    if (elementId === 'nomination-section') return 3;
    if (elementId === 'field-section-45') return 4;
    if (elementId === 'card-premium-summary') return 5;
    return null;
  };

  const waitForElement = (elementId: string, timeoutMs = 2500): Promise<HTMLElement | null> =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const el = document.getElementById(elementId);
        if (el) return resolve(el);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(tick, 100);
      };
      tick();
    });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // Agent clicks run one at a time, in order: switch step if needed, wait for the element,
  // scroll it into view, measure it after layout settles, move the cursor, click, apply.
  const agentActionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const glideAgentCursorToElement = (elementId: string, actionLabel: string, onArrival?: () => void, aimId?: string) => {
    if (typeof window === 'undefined') return;
    agentActionQueueRef.current = agentActionQueueRef.current
      .then(() => performAgentClick(elementId, actionLabel, onArrival, aimId))
      .catch((e) => console.warn('agent click failed', elementId, e));
  };

  const performAgentClick = async (elementId: string, actionLabel: string, onArrival?: () => void, aimId?: string) => {
    const step = stepForElement(elementId);
    if (step && latestRef.current.activeStep !== step) {
      goToStep(step);
      await sleep(350); // let the new step render
    }
    const el = await waitForElement(elementId);
    if (!el) {
      console.warn(`Agent target ${elementId} not found; applying without cursor`);
      onArrival?.();
      return;
    }
    // Aim at the control itself (the exact input or select), not the label block around it.
    const aimEl: HTMLElement =
      (aimId ? document.getElementById(aimId) : null) ||
      (/^field-/.test(elementId) ? (el.querySelector('input:not([type=hidden]),select,textarea') as HTMLElement | null) : null) ||
      el;
    const isControl = aimEl !== el || /^(INPUT|SELECT|TEXTAREA)$/.test(aimEl.tagName);
    aimEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    // Measure only once the element has stopped moving (smooth scroll and step changes shift it).
    let rect = aimEl.getBoundingClientRect();
    for (let i = 0; i < 20; i++) {
      await sleep(80);
      const next = aimEl.getBoundingClientRect();
      const still = Math.abs(next.top - rect.top) < 0.5 && Math.abs(next.left - rect.left) < 0.5;
      rect = next;
      if (still && i >= 3) break;
    }
    const targetX = isControl ? rect.left + Math.min(rect.width / 2, 120) : rect.left + Math.min(rect.width / 2, 160);
    const targetY = isControl ? rect.top + rect.height / 2 : rect.top + Math.min(rect.height / 2, 40);
    setSpotlightedElementId(elementId);
    setAgentCursor({ visible: true, x: targetX, y: targetY, clicking: false, label: 'OmniCB Agent (Screen Control Active)', actionDesc: actionLabel });
    await sleep(700); // cursor glide transition
    const clickId = Date.now();
    setClickIndicators((prev) => [...prev, { id: clickId, x: targetX, y: targetY }]);
    setAgentCursor((prev) => ({ ...prev, clicking: true }));
    playChime();
    await sleep(300);
    setAgentCursor((prev) => ({ ...prev, clicking: false }));
    setClickIndicators((prev) => prev.filter((c) => c.id !== clickId));
    onArrival?.();
    await sleep(400); // brief pause before the next queued click
  };

  // Co-Control Demonstration: Critical Illness Rider
  const demonstrateRiderSelection = () => {
    if (screenControlStatus !== 'granted') {
      setScreenControlStatus('granted');
    }
    setActiveStep(2);
    setSpotlightedElementId('card-critical-illness');

    setTimeout(() => {
      glideAgentCursorToElement(
        'card-critical-illness',
        'Selecting Critical Illness Living Benefit Rider (+₹149/mo)',
        () => {
          setSelectedRiders((prev) => ({ ...prev, criticalIllness: true }));
          triggerFieldGuidance('card-critical-illness');
          setChatMessages((prev) => [
            ...prev,
            {
              sender: 'agent',
              text: '[SCREEN CONTROL ACTION]: OmniCB Agent moved its cursor to the Critical Illness Living Benefit Rider card and selected it (+₹149/mo). Nothing is saved until you confirm.',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
      );
    }, 200);
  };

  // Co-Control Demonstration: Full Legal Name Guidance
  const demonstrateNameGuidance = () => {
    if (screenControlStatus !== 'granted') {
      setScreenControlStatus('granted');
    }
    setActiveStep(1);
    setSpotlightedElementId('input-full-name');

    setTimeout(() => {
      glideAgentCursorToElement(
        'field-full-name',
        'Guiding Full Legal Name & verifying the ID privacy shield',
        () => {
          const inputEl = document.getElementById('input-full-name') as HTMLInputElement | null;
          if (inputEl) inputEl.focus();
          triggerFieldGuidance('field-full-name');
          setChatMessages((prev) => [
            ...prev,
            {
              sender: 'agent',
              text: '[SCREEN CONTROL ACTION]: OmniCB Agent focused the Full Legal Name field. Verified SAM 3 client-side video redaction on Aadhaar & PAN.',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
      );
    }, 200);
  };

  // Co-Control Demonstration: DOB format
  const demonstrateDobFormat = () => {
    if (screenControlStatus !== 'granted') {
      setScreenControlStatus('granted');
    }
    setActiveStep(1);
    setSpotlightedElementId('input-dob');

    setTimeout(() => {
      glideAgentCursorToElement(
        'input-dob',
        'Guiding DD/MM/YYYY birth date format (e.g. 14/05/1994)',
        () => {
          const inputEl = document.getElementById('input-dob') as HTMLInputElement | null;
          if (inputEl) {
            inputEl.focus();
            if (!profile.dob) {
              setProfile((prev) => ({ ...prev, dob: '14/05/1994' }));
            }
          }
          triggerFieldGuidance('field-dob');
          setChatMessages((prev) => [
            ...prev,
            {
              sender: 'agent',
              text: '[SCREEN CONTROL ACTION]: OmniCB Agent demonstrated entering valid DD/MM/YYYY date format.',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
      );
    }, 200);
  };

  // Emergency Revoke Screen Control
  const revokeScreenControl = () => {
    setScreenControlStatus('revoked');
    setAgentCursor((prev) => ({ ...prev, visible: false }));
    playChime();
    setChatMessages((prev) => [
      ...prev,
      {
        sender: 'agent',
        text: '[CONTROL REVOKED]: Screen control returned exclusively to you. OmniCB Agent has reverted to passive observation mode.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  // Grant Screen Control
  const grantScreenControl = () => {
    setScreenControlStatus('granted');
    playChime();
    setChatMessages((prev) => [
      ...prev,
      {
        sender: 'agent',
        text: '[SCREEN CONTROL GRANTED]: Dual-cursor collaboration active. You can revoke control anytime by clicking Revoke or pressing ESC.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const nomineeDob = parseNomineeDob(nomination.primaryDob);
  const allNominees = [
    // The primary nominee's age comes from the date of birth; until it is a real date the step is blocked, so 99 is only a placeholder.
    { name: nomination.primaryName || 'Nominee 1', relation: nomination.primaryRelation, share: nomination.primaryShare, age: nomineeDob.age ?? 99 },
    ...(nomination.hasSecondaryNominee ? [{ name: nomination.secondaryName || 'Nominee 2', relation: nomination.secondaryRelation, share: nomination.secondaryShare, age: nomination.secondaryAge }] : []),
    ...(nomination.hasSecondaryNominee ? nomination.additionalNominees.map((n, i) => ({ name: n.name || `Nominee ${i + 3}`, relation: n.relation, share: n.share, age: n.age })) : []),
  ];
  const nomineeTotalShare = allNominees.reduce((sum, n) => sum + (Number(n.share) || 0), 0);
  const anyMinorNominee = allNominees.some((n) => n.age < 18);
  nominationRef.current = nomination;
  const nomineeSummary = allNominees.map((n) => `${n.name} (${n.relation}, ${n.share}%)`).join(', ');

  // Per-step validation. A step is complete only when every item below is clean.
  const dobMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(profile.dob.trim());
  const dobDate = dobMatch ? new Date(Number(dobMatch[3]), Number(dobMatch[2]) - 1, Number(dobMatch[1])) : null;
  const dobReal = !!dobDate && dobDate.getDate() === Number(dobMatch![1]) && dobDate.getMonth() === Number(dobMatch![2]) - 1;
  const applicantAge = dobReal && dobDate ? Math.floor((Date.now() - dobDate.getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  const anyRiderSelected = Object.values(selectedRiders).some(Boolean) || lifeStageEscalator;
  const noRidersEffective = noRiders && !anyRiderSelected;
  const stepIssues: Record<number, Array<{ id: string; msg: string }>> = {
    1: [
      ...(profile.fullName.trim().length < 2 ? [{ id: 'field-full-name', msg: 'Enter your full legal name.' }] : []),
      ...(applicantAge === null ? [{ id: 'field-dob', msg: 'Enter your date of birth as DD/MM/YYYY.' }]
        : applicantAge < 18 || applicantAge > 65 ? [{ id: 'field-dob', msg: 'This demo product covers ages 18 to 65.' }] : []),
      ...(!profile.gender ? [{ id: 'field-gender', msg: 'Choose your gender.' }] : []),
      ...(!profile.annualIncome ? [{ id: 'field-annual-income', msg: 'Enter your annual income.' }] : []),
      ...(profile.isSmoker === null ? [{ id: 'field-smoking', msg: 'Say whether you use tobacco.' }] : []),
      ...(!profile.city.trim() ? [{ id: 'input-city', msg: 'Enter your city.' }] : []),
      ...(!/^\d{6}$/.test(profile.pincode.trim()) ? [{ id: 'input-pincode', msg: 'Enter your 6-digit PIN code.' }] : []),
      ...pendingApprovals
        .filter((a) => a.key !== 'nominee')
        .map((a) => ({ id: 'field-approvals', msg: `Confirm or undo what the agent entered: ${a.label} = ${approvalSummary(a.key)}.` })),
      ...docDiscrepancies.map((d) => ({
        id: 'field-discrepancies',
        msg: `${d.label} differs: you typed "${d.typed}", the ${d.source} shows "${d.fromDocument}". Choose which is correct.`,
      })),
      ...(!/^\d{12}$/.test(profile.aadhaarNumber) ? [{ id: 'field-identity', msg: 'Enter your 12-digit Aadhaar number (type it, or scan a sample document).' }] : []),
      ...(!/^[A-Z]{5}\d{4}[A-Z]$/.test(profile.panNumber) ? [{ id: 'field-identity', msg: 'Enter your PAN (like ABCDE1234F).' }] : []),
      ...(!/^[6-9]\d{9}$/.test(profile.mobileNumber) ? [{ id: 'field-identity', msg: 'Enter your 10-digit mobile number.' }] : []),
    ],
    2: !anyRiderSelected && !noRidersEffective
      ? [{ id: 'card-no-riders', msg: 'Choose at least one rider, or tick "I do not want any riders".' }]
      : [],
    3: [
      ...pendingApprovals
        .filter((a) => a.key === 'nominee')
        .map((a) => ({ id: 'nomination-section', msg: `Confirm or undo what the agent entered: ${a.label} = ${approvalSummary(a.key)}.` })),
      ...(!nomination.primaryName.trim() ? [{ id: 'nomination-section', msg: 'Name your primary nominee.' }] : []),
      ...(nomineeDob.error ? [{ id: 'input-nominee-dob', msg: nomineeDob.error }] : []),
      ...(nomination.hasSecondaryNominee && !nomination.secondaryName.trim() ? [{ id: 'nomination-section', msg: 'Name the second nominee.' }] : []),
      ...(nomination.hasSecondaryNominee && nomination.additionalNominees.some((n) => !n.name.trim()) ? [{ id: 'nomination-section', msg: 'Name every additional nominee.' }] : []),
      ...(nomineeTotalShare !== 100 ? [{ id: 'nomination-section', msg: `Nominee shares add up to ${nomineeTotalShare}%; they must total 100%.` }] : []),
      ...(anyMinorNominee && !nomination.appointeeName.trim() ? [{ id: 'nomination-section', msg: 'A nominee under 18 needs an adult appointee.' }] : []),
    ],
    4: [...(!underwriting.section45Consent ? [{ id: 'field-section-45', msg: 'Tick the Section 45 declaration.' }] : [])],
  };
  const maxReachableStep = [1, 2, 3, 4].find((n) => stepIssues[n].length > 0) ?? 5;
  stepGateRef.current = { issues: stepIssues, maxReachable: maxReachableStep };

  // What the signature covers: change any of it after signing and the signature no longer counts.
  const proposalFingerprint = JSON.stringify({
    name: profile.fullName,
    dob: profile.dob,
    income: profile.annualIncome,
    smoker: profile.isSmoker,
    cover: baseSumAssured,
    riders: selectedRiders,
    ciTier,
    atpdOption,
    lifeStageEscalator,
    nominees: nomineeSummary,
    mwpa: nomination.mwpaTrustEnabled,
    premium: totalMonthlyPayable,
  });
  const esignValid = Boolean(esign.signedAt) && esign.fingerprint === proposalFingerprint;
  const paymentValid = payment.status === 'paid' && payment.amount === totalMonthlyPayable;

  const sha256Hex = async (text: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const signProposal = async () => {
    const typed = esign.typedName.trim().replace(/\s+/g, ' ');
    const expected = (profile.fullName || '').trim().replace(/\s+/g, ' ');
    const fail = (error: string) => setEsign((e) => ({ ...e, error }));
    if (!esign.consent) return fail('Please tick the declaration first.');
    if (!expected) return fail('Add your full name in Step 1 first.');
    if (typed.toLowerCase() !== expected.toLowerCase()) return fail(`Type your name exactly as it is on the form: ${expected}`);
    const signedAt = new Date().toISOString();
    try {
      const hash = await sha256Hex(`${proposalFingerprint}|${typed}|${signedAt}`);
      setEsign((e) => ({ ...e, signedAt, hash, fingerprint: proposalFingerprint, error: null }));
      setChatMessages((prev) => [...prev, { sender: 'agent', text: `Proposal e-signed by ${typed} (demo e-sign: no Aadhaar OTP, not legally binding). You can pay the first premium now.`, time: stampNow() }]);
    } catch {
      fail('Signing needs a secure (HTTPS) page. Open the app over HTTPS or on localhost.');
    }
  };

  const payFirstPremium = () => {
    if (!esignValid || payment.status === 'processing') return;
    const amount = totalMonthlyPayable;
    setPayment((p) => ({ ...p, status: 'processing' }));
    setTimeout(() => {
      const txnId = `NEXA-TXN-${Math.floor(100000000 + Math.random() * 900000000)}`;
      setPayment((p) => ({ ...p, status: 'paid', txnId, paidAt: new Date().toISOString(), amount }));
      setChatMessages((prev) => [...prev, { sender: 'agent', text: `First premium of ₹${amount} received (demo checkout: no real money moved). Transaction ${txnId}. You can issue your policy now.`, time: stampNow() }]);
    }, 1500);
  };

  const buildPolicyCardInput = () => ({
    policyholder: profile.fullName || 'Rahul Shankar Sharma',
    sumAssured: baseSumAssured === '1cr' ? 'Rs 1 Crore' : baseSumAssured === '1.5cr' ? 'Rs 1.5 Crore' : 'Rs 2 Crore',
    term: '30 years',
    riders: [
      selectedRiders.criticalIllness && `Critical Illness ${ciTier === 'tier1' ? 'Rs 10 Lakh' : ciTier === 'tier3' ? 'Rs 50 Lakh' : 'Rs 25 Lakh'}`,
      selectedRiders.accidentalDeath && 'Accidental Cover',
      selectedRiders.waiverOfPremium && 'Waiver of Premium',
    ].filter(Boolean) as string[],
    monthlyPremium: `Rs ${totalMonthlyPayable}`,
    nominee: nomination.primaryName ? nomineeSummary : null,
  });

  // Session-worker prefetch: Muse Image renders the policy card while the customer is still on the last step,
  // so it is already there at issuance instead of 10–20 s later.
  useEffect(() => {
    if (activeStep < 4) return;
    const policy = buildPolicyCardInput();
    const key = JSON.stringify(policy);
    if (policyCardKeyRef.current === key) return;
    policyCardKeyRef.current = key;
    let cancelled = false;
    setPolicyCard({ status: 'generating', dataUrl: null, ms: null });
    (async () => {
      try {
        const res = await fetch('/api/policy-card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy }) });
        const data = await res.json();
        if (!res.ok || !data.dataUrl) throw new Error(data.error || `HTTP ${res.status}`);
        if (!cancelled) setPolicyCard({ status: 'ready', dataUrl: data.dataUrl, ms: data.ms });
      } catch (e: any) {
        if (!cancelled) setPolicyCard({ status: 'error', dataUrl: null, ms: null, error: e?.message || String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, profile.fullName, baseSumAssured, selectedRiders, ciTier, totalMonthlyPayable, nomination.primaryName, nomination.primaryRelation, nomination.primaryShare]);

  // The server runs a different agent per tab (own prompt, knowledge base and voice), so keep it matching the
  // visible tab: on connect, and whenever the customer switches. A switch during a live session is introduced once.
  useEffect(() => {
    const agent = agentRef.current;
    if (!isListeningVoice || !agent || !agent.isOpen) {
      introducedModeRef.current = null;
      return;
    }
    agent.setMode(mode);
    if (introducedModeRef.current !== null && introducedModeRef.current !== mode) {
      const line =
        mode === 'guardian'
          ? "I'm Integrity Guardian, the independent reviewer. I explain your policy document and flag anything worth querying. I never change your application."
          : 'Back with the co-browsing agent. Tell me what to fill in next.';
      setChatMessages((prev) => [...prev, { sender: 'agent', text: line, time: stampNow() }]);
      speakText(line, selectedLanguage);
    }
    introducedModeRef.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isListeningVoice]);

  // Refresh the picture every 45 s while a session is live, so it is never older than the agent's 90 s limit.
  const [shotTick, setShotTick] = useState(0);
  useEffect(() => {
    if (!isListeningVoice) return;
    const id = window.setInterval(() => setShotTick((n) => n + 1), 45_000);
    return () => window.clearInterval(id);
  }, [isListeningVoice]);

  // Visual grounding: send Muse Spark a JPEG of the form area when the step changes while the agent is live.
  useEffect(() => {
    const el = formBodyRef.current;
    if (!el || !isListeningVoice || isSharingPaused || mode === 'guardian') return; // the reviewer never receives form pictures
    let cancelled = false;
    const step = activeStep;
    const t = setTimeout(async () => {
      try {
        // Identity-number fields (data-sensitive) are left out of the picture, even if one has focus.
        const dataUrl = await toJpeg(el, {
          quality: 0.6,
          pixelRatio: 0.6,
          backgroundColor: '#ffffff',
          cacheBust: false,
          // Embedding web fonts fails in Firefox (the picture then never reaches the agent); the system font is fine for the agent.
          skipFonts: true,
          filter: (node) => !(node instanceof HTMLElement && node.dataset.sensitive === 'true'),
        });
        if (!cancelled && dataUrl.length < 1_800_000) {
          agentRef.current?.sendScreenshot(dataUrl);
          setAgentView({ frameDataUrl: dataUrl, sentAt: Date.now(), step });
        }
      } catch (e) {
        console.warn('viewport screenshot failed', e);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeStep, isListeningVoice, isSharingPaused, shotTick, mode]);

  // The agent cursor is positioned in viewport pixels; a step change replaces the DOM under it.
  useEffect(() => {
    setAgentCursor((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    setSpotlightedElementId(null);
  }, [activeStep]);

  // Keep what the long-lived agent callbacks need current (every render).
  useEffect(() => {
    latestRef.current = { applyAction: applyAgentAction, lang: selectedLanguage, screenState: getLiveScreenSnapshot, activeStep };
    // Dev only: lets a browser test drive the agent cursor without a live voice session.
    if (process.env.NODE_ENV !== 'production') (window as any).__coverpilot = latestRef;
    voicePersonaRef.current = selectedVoicePersona;
    accentRef.current = englishAccent;
    devRef.current = showDevPanel;
  });

  // Persona or accent change -> the server switches the Google voice for the next sentence.
  useEffect(() => {
    agentRef.current?.setVoice(selectedVoicePersona, englishAccent);
  }, [selectedVoicePersona, englishAccent]);

  // The live form state is part of the LLM prompt: push it to the agent whenever it changes,
  // unless the customer paused sharing.
  useEffect(() => {
    if (isSharingPaused) return;
    agentRef.current?.sendScreenState(getLiveScreenSnapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, profile, baseSumAssured, selectedRiders, underwriting, currentFocusedField, nomination, ciTier, atpdOption, lifeStageEscalator, terminalIllnessCover, isSharingPaused]);

  // Tear the live session down if the component unmounts.
  useEffect(() => {
    return () => {
      agentRef.current?.stop();
      localAudioRef.current?.pause();
    };
  }, []);

  const currentGuidanceItem = GUIDANCE_CONTENT[activeGuidanceKey] || GUIDANCE_CONTENT['field-full-name'];

  // Exactly which form details go to Muse Spark (shown in the sidebar widget and the full-size frame modal).
  const agentDetailLines = [
    `Step ${activeStep} of 5`,
    `Cover: ${baseSumAssured === '1cr' ? '₹1 Cr' : baseSumAssured === '1.5cr' ? '₹1.5 Cr' : '₹2 Cr'}`,
    `Riders: ${[selectedRiders.criticalIllness && 'Critical Illness', selectedRiders.accidentalDeath && 'Accidental', selectedRiders.waiverOfPremium && 'Waiver', selectedRiders.hospitalCash && 'Hospital Cash'].filter(Boolean).join(', ') || 'none'}`,
    `Name: ${profile.fullName || '—'} · DOB: ${profile.dob || '—'}`,
    `Income: ${profile.annualIncome ? `₹${Number(profile.annualIncome).toLocaleString('en-IN')}` : '—'} · Pincode: ${profile.pincode || '—'}`,
    `Nominees: ${nomination.primaryName ? nomineeSummary : '—'}`,
  ];
  const agentFrameLabel = isSharingPaused
    ? 'paused'
    : agentView.sentAt
    ? `updated ${new Date(agentView.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'nothing sent yet';

  const downloadCase = (c: CaseRecord) => {
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${c.caseId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const pageContent = (
    <div className="h-screen overflow-hidden bg-[#f8fafc] text-[#0f172a] flex flex-col font-sans">
      
      {entry === 'choose' && (
        <div className="fixed inset-0 z-[60] bg-[#f8fafc] overflow-y-auto" id="entry-chooser">
          <div className="min-h-full flex flex-col items-center justify-center gap-6 px-4 py-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/nexasure-mark.png" alt="NexaSure" className="w-48 rounded-2xl shadow-sm" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-[#111827]">What would you like to do?</h1>
              <p className="text-sm text-slate-500">One voice assistant, two ways to help. Demo product, not a real insurer.</p>
            </div>
            {pendingResume && (
              <div className="rounded-xl border border-purple-300 bg-purple-50 px-3 py-2 text-xs text-purple-900 flex flex-wrap items-center gap-2">
                <span>
                  You have a saved proposal <strong className="font-mono">{pendingResume.id}</strong> (step {pendingResume.step}).
                </span>
                <button
                  onClick={async () => {
                    if (await applyDraft(pendingResume.id)) {
                      setMode('cobrowse');
                      setEntry('done');
                    }
                  }}
                  className="px-3 py-1 rounded-lg bg-[#582be8] text-white font-semibold"
                >
                  Resume it
                </button>
              </div>
            )}
            <button
              id="entry-resume-other"
              onClick={() => {
                setResumeError('');
                setRemoteError('');
                setSavedProposals(readIndex());
                setShowResumePanel(true);
              }}
              className="text-xs font-semibold text-[#582be8] underline"
            >
              Resume a saved proposal (on this or another device)
            </button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-3xl">
              <button
                id="entry-new-policy"
                onClick={() => {
                  setMode('cobrowse');
                  setEntry('done');
                }}
                className="text-left rounded-2xl border-2 border-slate-200 hover:border-[#582be8] bg-white p-5 shadow-sm transition-colors"
              >
                <div className="text-base font-bold text-[#111827]">Start a new policy</div>
                <p className="mt-1 text-sm text-slate-600">
                  The voice assistant explains each question and fills your application with you, step by step. You only click where a declaration, signature or payment is yours to make.
                </p>
                <span className="mt-3 inline-block text-sm font-semibold text-[#582be8]">Co-browse my application →</span>
              </button>
              <button
                id="entry-review-policy"
                onClick={() => {
                  setMode('guardian');
                  setEntry('done');
                }}
                className="text-left rounded-2xl border-2 border-slate-200 hover:border-[#582be8] bg-white p-5 shadow-sm transition-colors"
              >
                <div className="text-base font-bold text-[#111827]">Review a policy</div>
                <p className="mt-1 text-sm text-slate-600">
                  Review a proposed policy (this demo uses sample documents). Integrity Guardian explains it section by section, checks it against your application and the rules, and answers every question with page references.
                </p>
                <span className="mt-3 inline-block text-sm font-semibold text-[#582be8]">Review my policy →</span>
              </button>
            </div>
            <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-500">
              <div className="font-semibold text-slate-700">Shared Meta-powered agent runtime</div>
              Muse Spark · Muse Spark Open · Muse Voice Transcribe · Muse Wonder · SAM 3.1 · Muse Image
              <div className="mt-1 text-slate-600">Review → Resolve → Regenerate → Review again</div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Main NexaSure Header */}
      <header className="shrink-0 bg-white border-b border-slate-200 z-30">
        <div className="w-full px-4 lg:px-6 py-1.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/nexasure-mark.png" alt="NexaSure logo" width={54} height={44} className="h-11 w-auto rounded-lg shadow-sm" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-[#111827]">NexaSure</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-purple-50 text-[#582be8] border border-purple-200">
                  Life Flexi Shield</span>
              </div>
              <p className="text-[11px] text-slate-500 truncate max-w-[36rem]">AI-first digital insurance company · Demo product, not a real insurer</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Language switcher */}
            <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              {([['en', 'English'], ['hi', 'हिंदी'], ['mr', 'मराठी']] as const).map(([l, label]) => (
                <button
                  key={l}
                  onClick={() => handleLanguageChange(l)}
                  className={`px-2 py-1 rounded text-[11px] font-bold transition-all ${
                    selectedLanguage === l ? 'bg-[#582be8] text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Audio Unmute & Test Button */}
            <button
              onClick={testAndUnmuteAudio}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors border border-slate-200"
              title="Click to enable sound and test voice"
            >
              <span>Test audio</span>
            </button>

            {/* Policy Evidence Drawer Toggle */}
            <button
              onClick={() => setShowEvidenceDrawer(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors border border-slate-200"
              title="View verbatim IRDAI policy clauses & verified citations"
            >
              <span>Policy Evidence</span>
            </button>

            {/* Statutory Terms & Conditions Drawer Toggle */}
            <button
              id="btn-terms-conditions"
              onClick={() => setShowTermsDrawer(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors border border-slate-200"
              title="View statutory Terms and Conditions & IRDAI consumer protections"
            >
              <span>Terms & Conditions</span>
            </button>

            {/* Pause and resume: each proposal has its own code */}
            <span
              className="hidden xl:inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-mono border border-slate-200"
              title="This proposal's unique code"
            >
              {draftId || '…'}
            </span>
            <button
              onClick={pauseProposal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors border border-slate-200"
              title="Save this proposal and stop the live session"
            >
              <span>Pause</span>
            </button>
            <button
              onClick={() => {
                setSavedProposals(readIndex());
                setResumeError('');
                setShowResumePanel(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors border border-slate-200"
              title="Continue a paused proposal"
            >
              <span>Resume</span>
            </button>

            {/* Application Guardian Audit Certificate */}
            <button
              onClick={handleDownloadAuditCertificate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors border border-slate-200"
              title="Download verified compliance and disclosure audit certificate"
            >
              <span>Audit Certificate</span>
            </button>

          </div>
        </div>
      </header>

      {idlePaused && !isCoBrowsingConnected && (
        <div role="status" data-testid="idle-paused" className="shrink-0 mx-4 lg:mx-6 mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex flex-wrap items-center gap-2">
          <span>Session paused after 3 minutes of inactivity. Your conversation and form are kept.</span>
          <button data-testid="idle-resume" onClick={() => void connectCoBrowsingSession()} className="px-3 py-1 rounded-lg bg-[#582be8] text-white font-semibold">
            Resume session
          </button>
        </div>
      )}

      {pendingResume && (
        <div role="alert" className="shrink-0 mx-4 lg:mx-6 mt-2 rounded-xl border border-purple-300 bg-purple-50 px-3 py-2 text-xs text-purple-900 flex flex-wrap items-center gap-2">
          <span>
            You have a saved proposal <strong className="font-mono">{pendingResume.id}</strong> (step {pendingResume.step}, saved {new Date(pendingResume.savedAt).toLocaleString()}).
          </span>
          <button onClick={() => applyDraft(pendingResume.id)} className="px-3 py-1 rounded-lg bg-[#582be8] text-white font-semibold">Resume it</button>
          <button onClick={startNewProposal} className="px-3 py-1 rounded-lg bg-white border border-purple-300 font-semibold">Start a new proposal</button>
        </div>
      )}

      {(showResumePanel || pausedNote) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => { if (pausedKey) return; setShowResumePanel(false); setPausedNote(null); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl text-sm text-slate-800" onClick={(e) => e.stopPropagation()}>
            {pausedNote ? (
              <>
                <h3 className="font-bold text-base mb-1">Proposal paused</h3>
                <p className="text-xs text-slate-600 mb-3">{pausedNote}</p>
                <div className="flex items-center justify-between gap-2">
                  <span data-testid="vault-id" className="font-mono text-base font-bold tracking-wider">{draftId}</span>
                  <button
                    onClick={() => navigator.clipboard?.writeText(draftId).catch(() => {})}
                    className="px-3 py-1 rounded-lg border border-slate-300 text-xs font-semibold"
                  >
                    Copy code
                  </button>
                </div>
                {pausedKey && (
                  <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-2.5">
                    <div className="text-xs font-semibold text-amber-900">Resume key (shown once)</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span data-testid="vault-key" className="font-mono text-base font-bold tracking-wider text-amber-950">{pausedKey}</span>
                      <button
                        onClick={() => navigator.clipboard?.writeText(pausedKey).catch(() => {})}
                        className="px-3 py-1 rounded-lg border border-amber-400 bg-white text-xs font-semibold"
                      >
                        Copy key
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-amber-900">
                      Saved encrypted: we cannot read it. This key cannot be recovered. Anyone with both the code and the key can open this draft, so keep the key private.
                    </p>
                  </div>
                )}
                <div className="mt-4 text-right">
                  <button
                    onClick={() => {
                      setPausedNote(null);
                      setPausedKey(null);
                    }}
                    className="px-4 py-1.5 rounded-lg bg-[#582be8] text-white text-xs font-semibold"
                  >
                    {pausedKey ? 'I have saved the key' : 'Close'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-bold text-base mb-1">Resume a proposal</h3>
                <p className="text-xs text-slate-600 mb-2">Proposals paused in this browser. Your ID numbers are kept sealed in this browser; signature and payment are never saved.</p>
                <ul className="mb-3 max-h-40 overflow-y-auto divide-y divide-slate-100">
                  {savedProposals.length === 0 && <li className="py-2 text-xs text-slate-500">Nothing saved yet.</li>}
                  {savedProposals.map((m) => (
                    <li key={m.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                      <span>
                        <span className="font-mono font-bold">{m.id}</span>
                        <span className="text-slate-500"> · step {m.step} · {new Date(m.savedAt).toLocaleString()}</span>
                      </span>
                      <span className="flex gap-1.5">
                        <button onClick={() => applyDraft(m.id)} className="px-2 py-0.5 rounded-lg bg-[#582be8] text-white font-semibold">Resume</button>
                        <button
                          onClick={() => {
                            deleteDraft(m.id);
                            setSavedProposals(readIndex());
                          }}
                          className="px-2 py-0.5 rounded-lg border border-slate-300"
                        >
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <input
                    value={resumeCode}
                    onChange={(e) => setResumeCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && resumeByCode()}
                    placeholder="Code, e.g. NXP-7KQ2M9XD"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                  <button onClick={resumeByCode} className="px-3 py-1.5 rounded-lg bg-[#582be8] text-white text-xs font-semibold">Resume</button>
                </div>
                {resumeError && <p className="mt-1 text-xs text-red-600">{resumeError}</p>}
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <h4 className="text-sm font-bold">Resume on another device</h4>
                  <p className="text-xs text-slate-600 mb-2">Enter the proposal code and the resume key you were shown when you paused. The draft is decrypted in this browser; the server cannot read it.</p>
                  <div className="flex flex-col gap-2">
                    <input
                      data-testid="vault-resume-id"
                      value={remoteId}
                      onChange={(e) => setRemoteId(e.target.value)}
                      placeholder="Proposal code, e.g. NXP-7KQ2M9XD"
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                    <input
                      data-testid="vault-resume-key"
                      value={remoteKey}
                      onChange={(e) => setRemoteKey(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && resumeRemote()}
                      placeholder="Resume key, e.g. 7KQ2M-9XDPA"
                      autoComplete="off"
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                    <button
                      data-testid="vault-resume-button"
                      onClick={resumeRemote}
                      disabled={remoteBusy}
                      className="px-3 py-1.5 rounded-lg bg-[#582be8] disabled:opacity-60 text-white text-xs font-semibold"
                    >
                      {remoteBusy ? 'Opening…' : 'Resume on another device'}
                    </button>
                    {remoteError && <p data-testid="vault-error" className="text-xs text-red-600">{remoteError}</p>}
                  </div>
                </div>
                <div className="mt-3 text-right">
                  <button onClick={() => setShowResumePanel(false)} className="px-3 py-1 rounded-lg border border-slate-300 text-xs">Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Co-Browsing Status Bar: session controls and dual-cursor screen control */}
      {isCoBrowsingConnected && (
        <div className={`shrink-0 bg-gradient-to-r from-[#180d40] via-[#24135e] to-[#180d40] text-white px-4 lg:px-6 py-1.5 border-b border-purple-800/40 transition-all ${
          isScreenSharing && !isSharingPaused ? 'screen-share-active-border' : ''
        }`}>
          <div className="w-full flex flex-wrap items-center justify-between gap-3 text-xs">
            
            {/* Left: Stream Telemetry */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${
                  !isScreenSharing || isSharingPaused ? 'bg-amber-400' : 'bg-red-500 animate-pulse'
                }`} />
                <span className="font-bold tracking-wide">
                  {isSharingPaused
                    ? 'Sharing paused'
                    : isScreenSharing
                    ? 'Live session'
                    : 'Not connected'}</span>
              </div>
              <span className="text-purple-400 hidden md:inline">|</span>
              <span className="text-[11px] tabular-nums text-purple-200 hidden md:inline">
                {showDevPanel
                  ? `Agent ${agentState.toUpperCase()} • ${voiceTelemetry.asrModel || 'muse-voice-transcribe-1.0'} realtime ASR • ${voiceTelemetry.sparkModel || 'muse-spark-1.3'} streaming • ${sessionTts === 'meta-mms' ? 'Meta MMS TTS (experimental)' : 'Google Cloud TTS'} ${voiceTelemetry.ttsVoice ? `(${voiceTelemetry.ttsVoice})` : ''}`
                  : `Agent ${agentState === 'listening' ? 'listening' : agentState === 'thinking' ? 'thinking' : 'speaking'} • ${isSharingPaused ? 'sharing paused' : 'sharing this form'}`}</span>
            </div>

            {/* Right: Screen Control & Privacy Badges + Actions */}
            <div className="flex flex-wrap items-center gap-2">
              
              {/* Two-Way WebRTC Voice Track Badge & Push-to-Talk Toggle */}
              <button
                onClick={toggleVoiceListening}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1.5 ${
                  isListeningVoice
                    ? 'bg-red-950 text-red-300 border-red-500 animate-pulse ring-2 ring-red-400'
                    : isSpeaking
                    ? 'bg-purple-950 text-purple-200 border-purple-400 ring-2 ring-purple-400/50'
                    : 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 hover:bg-emerald-900/80'
                }`}
                title="Start or stop listening"
              >
                <span className={`size-2 rounded-full ${isListeningVoice ? 'bg-red-400 animate-ping' : isSpeaking ? 'bg-purple-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
                <span>{isListeningVoice
                    ? 'Listening'
                    : isSpeaking
                    ? 'Assistant speaking'
                    : 'Voice off'}</span>
              </button>

              {/* Zero-PII Privacy Filter Toggle */}
              <button
                onClick={() => setPrivacyShieldActive(!privacyShieldActive)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1.5 ${
                  privacyShieldActive
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
                    : 'bg-red-950/80 text-red-300 border-red-500/50'
                }`}
                title="Meta SAM 3 Real-time Video Privacy Filter (Blinds Aadhaar/PAN)"
              >
                <span>{privacyShieldActive ? '' : ''}</span>
                <span>ID privacy shield: {privacyShieldActive ? 'ACTIVE' : 'OFF'}</span>
              </button>

              {/* Screen Control Status Pill */}
              <div className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border flex items-center gap-1.5 ${
                screenControlStatus === 'granted'
                  ? 'bg-purple-900/80 text-purple-200 border-purple-400/50'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                <span></span>
                <span>Control: {screenControlStatus === 'granted' ? 'OmniCB Agent Active' : 'User Exclusive'}</span>
              </div>

              {/* Pause / Resume Button */}
              <button
                onClick={() => setIsSharingPaused(!isSharingPaused)}
                className="px-2.5 py-1 rounded-lg bg-purple-900/60 hover:bg-purple-800 text-purple-200 text-[11px] font-medium border border-purple-500/30 transition-all"
              >
                {isSharingPaused ? 'Resume sharing' : 'Pause sharing'}
              </button>

              {/* Grant / Revoke Screen Control */}
              {screenControlStatus === 'granted' ? (
                <button
                  onClick={revokeScreenControl}
                  title="The agent can demonstrate field navigation. Click here or press ESC to reclaim control at any time."
                  className="px-3 py-1 rounded-lg bg-red-600/90 hover:bg-red-600 text-white text-[11px] font-bold border border-red-400/40 transition-all flex items-center gap-1"
                >
                  <span></span>
                  <span>Revoke Control</span>
                </button>
              ) : (
                <button
                  onClick={grantScreenControl}
                  className="px-3 py-1 rounded-lg bg-[#582be8] hover:bg-[#481dd4] text-white text-[11px] font-bold border border-purple-400/40 transition-all flex items-center gap-1"
                >
                  <span></span>
                  <span>Grant Control</span>
                </button>
              )}

              {/* Disconnect Button */}
              <button
                onClick={() => disconnectCoBrowsingSession()}
                className="px-3 py-1 rounded-lg bg-red-700 hover:bg-red-800 text-white text-[11px] font-bold border border-red-500 transition-all flex items-center gap-1"
              >
                <span></span>
                <span>Disconnect</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Two capabilities, one agent */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 lg:px-6 pt-1.5 flex items-center gap-1.5 text-xs">
        {(
          [
            ['cobrowse', '1. Co-browse your application'],
            ['guardian', '2. Integrity Guardian: review your proposed policy'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            id={`mode-tab-${m}`}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-t-lg font-semibold border border-b-0 ${mode === m ? 'bg-white text-[#582be8] border-slate-300' : 'bg-slate-100 text-slate-500 border-transparent hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 3. Stepper Navigation */}
      <nav hidden={mode !== 'cobrowse'} className="shrink-0 bg-white border-b border-slate-200 px-4 lg:px-6 py-1">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto text-xs py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            
            {/* Step 1 */}
            <button
              id="step-tab-1"
              onClick={() => goToStep(1)}
              className={`flex items-center gap-2 transition-all whitespace-nowrap ${
                activeStep === 1 ? 'text-[#582be8] font-bold' : activeStep > 1 ? 'text-emerald-700 font-semibold' : 'text-slate-400'
              }`}
            >
              <span className={`size-6 rounded-full flex items-center justify-center text-xs font-bold ${
                activeStep > 1 ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : activeStep === 1 ? 'bg-[#582be8] text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}>
                {activeStep > 1 ? '✓' : '1'}</span>
              <span>1. Profile & Eligibility</span>
            </button>

            <span className="text-slate-600">→</span>

            {/* Step 2 */}
            <button
              id="step-tab-2"
              onClick={() => goToStep(2)}
              className={`flex items-center gap-2 transition-all whitespace-nowrap ${
                activeStep === 2 ? 'text-[#582be8] font-bold' : activeStep > 2 ? 'text-emerald-700 font-semibold' : 'text-slate-400'
              }`}
            >
              <span className={`size-6 rounded-full flex items-center justify-center text-xs font-bold ${
                activeStep > 2 ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : activeStep === 2 ? 'bg-[#582be8] text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}>
                {activeStep > 2 ? '✓' : '2'}</span>
              <span>2. Cover & Riders</span>
            </button>

            <span className="text-slate-600">→</span>

            {/* Step 3 */}
            <button
              id="step-tab-3"
              onClick={() => goToStep(3)}
              className={`flex items-center gap-2 transition-all whitespace-nowrap ${
                activeStep === 3 ? 'text-[#582be8] font-bold' : activeStep > 3 ? 'text-emerald-700 font-semibold' : 'text-slate-400'
              }`}
            >
              <span className={`size-6 rounded-full flex items-center justify-center text-xs font-bold ${
                activeStep > 3 ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : activeStep === 3 ? 'bg-[#582be8] text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}>
                {activeStep > 3 ? '✓' : '3'}</span>
              <span>3. Beneficiary & MWPA Trust</span>
            </button>

            <span className="text-slate-600">→</span>

            {/* Step 4 */}
            <button
              id="step-tab-4"
              onClick={() => goToStep(4)}
              className={`flex items-center gap-2 transition-all whitespace-nowrap ${
                activeStep === 4 ? 'text-[#582be8] font-bold' : activeStep > 4 ? 'text-emerald-700 font-semibold' : 'text-slate-400'
              }`}
            >
              <span className={`size-6 rounded-full flex items-center justify-center text-xs font-bold ${
                activeStep > 4 ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : activeStep === 4 ? 'bg-[#582be8] text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}>
                {activeStep > 4 ? '✓' : '4'}</span>
              <span>4. Underwriting & Declarations</span>
            </button>

            <span className="text-slate-600">→</span>

            {/* Step 5 */}
            <button
              id="step-tab-5"
              onClick={() => goToStep(5)}
              className={`flex items-center gap-2 transition-all whitespace-nowrap ${
                activeStep === 5 ? 'text-[#582be8] font-bold' : 'text-slate-400'
              }`}
            >
              <span className={`size-6 rounded-full flex items-center justify-center text-xs font-bold ${
                activeStep === 5 ? 'bg-[#582be8] text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}>
                5</span>
              <span>5. Policy Schedule & Terms</span>
            </button>

          </div>

          <div className="hidden xl:block text-xs text-slate-500 shrink-0 ml-8 pl-6 border-l border-slate-200">
            {profile.fullName ? (
              <span>Applicant: <strong className="text-slate-800">{profile.fullName}</strong></span>
            ) : presenterMode ? null : (
              <span className="text-slate-400">Select a field to hear guidance</span>
            )}
          </div>
        </div>
      </nav>

      {/* 4. Main Page Layout */}
      <main className="flex-1 min-h-0 w-full px-4 lg:px-6 py-2 flex flex-col gap-2 relative overflow-hidden">

        {/* Co-Browsing Assist Invitation Banner */}
        {!isCoBrowsingConnected && !dismissOffer && (
          <div className="shrink-0 px-3 py-2 rounded-xl bg-gradient-to-r from-[#180d40] via-[#2d1b70] to-[#180d40] text-white flex items-center justify-between gap-3 shadow-sm border border-purple-400/40 animate-fade-in">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-8 rounded-lg bg-white/10 flex items-center justify-center text-[11px] font-bold border border-white/15 shrink-0">
                OB
              </div>
              <h3 className="text-sm font-bold tracking-tight text-white shrink-0">Need assistance with your proposal?</h3>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/10 text-purple-100 font-medium border border-white/15 shrink-0">
                Live voice assistant</span>
              <p
                className="text-xs text-purple-200 truncate hidden xl:block"
                title="Talk to the assistant while you fill in the form. It explains riders, income tiers and clauses, and can fill fields for you with your consent."
              >
                Talk to the assistant while you fill in the form. It explains riders, income tiers and clauses, and can fill fields for you with your consent.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={connectCoBrowsingSession}
                disabled={isConnecting}
                className="px-4 py-1.5 rounded-lg bg-white hover:bg-purple-50 text-[#2d1b70] font-semibold text-xs transition-colors flex items-center gap-2"
              >
                <span>Accept and start co-browsing</span>
              </button>
              <button
                onClick={() => setDismissOffer(true)}
                className="px-3 py-1.5 rounded-lg bg-transparent hover:bg-white/10 text-purple-100 font-medium text-xs border border-white/20 transition-colors"
              >
                Fill manually
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_clamp(340px,30%,440px)] gap-3">
        {/* Form Body (8 Columns): scrolls on its own */}
        <div ref={formBodyRef} className="@container min-h-0 overflow-y-auto pr-2 flex flex-col gap-4">

          {stepNotice && stepNotice.step === activeStep && stepIssues[activeStep]?.length > 0 && (
            <div role="alert" className="shrink-0 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Finish this step before moving on:</strong>
              <ul className="list-disc pl-4 mt-1">
                {stepIssues[activeStep].map((i) => (
                  <li key={i.msg}>{i.msg}</li>
                ))}
              </ul>
            </div>
          )}

          {pendingApprovals.length > 0 && (
            <div id="field-approvals" role="alert" className="shrink-0 rounded-xl border border-purple-300 bg-purple-50 px-3 py-2 text-xs text-purple-900 flex flex-col gap-1.5">
              <strong>The agent entered this for you. Please confirm it is right:</strong>
              {pendingApprovals.map((a) => (
                <div key={a.key} className="flex flex-wrap items-center gap-2">
                  <span>
                    {a.label}: <strong>{approvalSummary(a.key)}</strong>
                  </span>
                  <button
                    onClick={() => setPendingApprovals((prev) => prev.filter((x) => x.key !== a.key))}
                    className="px-2.5 py-0.5 rounded-lg bg-[#582be8] text-white font-semibold"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => {
                      a.undo();
                      setPendingApprovals((prev) => prev.filter((x) => x.key !== a.key));
                    }}
                    className="px-2.5 py-0.5 rounded-lg bg-white border border-purple-300 font-semibold"
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          )}

          {mode === 'guardian' && (
            <GuardianView
              doc={policyDoc}
              review={guardianReview}
              currentSection={guardianSection}
              reviewedSections={reviewedSections}
              askedQuestions={askedQuestions}
              comparing={draftHasContent}
              allowOwnFile={ALLOW_OWN_FILES}
              canUseDraft={maxReachableStep >= 5 || stepIssues[1].length === 0}
              onFile={(f) => { resetGuardian(); loadPolicyFile(f); }}
              onSample={loadGuardianDoc}
              onClear={() => { setPolicyDoc(null); agentRef.current?.clearPolicyDoc(); resetGuardian(); }}
              onRun={runGuardian}
              onSection={(i) => openGuardianSection(i, isListeningVoice)}
              onVoiceReview={() => openGuardianSection(0, true)}
              onAsk={askGuardian}
              onFix={fixInApplication}
              onDownloadReport={downloadGuardianReport}
            />
          )}

          {/* STEP 1: Blank Profile (Click any field -> auto-played regional guidance!) */}
          {mode === 'cobrowse' && activeStep === 1 && (
            <div className="nx-card p-4 flex flex-col gap-3">
              <div className="pb-2 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#111827]">Step 1: Applicant Profile & Eligibility</h2>
                  <p className="text-xs text-slate-500">
                    Select a field to hear guidance in <strong>{selectedLanguage === 'hi' ? 'हिंदी' : selectedLanguage === 'mr' ? 'मराठी' : 'English'}</strong>.
                  </p>
                </div>
              </div>

              {/* Feature 3: 1-Click Sample KYC Document Ingestion (Meta Muse Image OCR Demo) */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="text-2xl"></span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900">Read a sample document</span>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white text-slate-600 border border-slate-200">
                        Original stays in your browser</span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2">
                      Only blurred copies, where text is unreadable, go to Meta's locator models. Photo, signature, QR code and ID numbers are then pixelated in your browser, so the reading model never sees them. Name and date of birth stay readable.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRunSampleKycOcr('pan')}
                    className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span></span>
                    <span>Sample PAN Card</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunSampleKycOcr('aadhaar')}
                    className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span></span>
                    <span>Masked Aadhaar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunSampleKycOcr('salary-slip')}
                    className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span></span>
                    <span>Salary Slip</span>
                  </button>
                </div>
              </div>

              {ALLOW_OWN_FILES && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 -mt-1">
                <span className="font-semibold text-slate-700">Or use your own file:</span>
                <select
                  aria-label="Document type"
                  value={uploadDocType}
                  onChange={(e) => setUploadDocType(e.target.value as 'pan' | 'aadhaar' | 'salary-slip')}
                  className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-slate-800 text-[11px]"
                >
                  <option value="pan">PAN card</option>
                  <option value="aadhaar">Aadhaar card</option>
                  <option value="salary-slip">Salary slip</option>
                </select>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="px-3 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-semibold text-[11px]"
                >
                  Choose a PNG or JPEG
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 15 * 1024 * 1024) {
                      setChatMessages((prev) => [...prev, { sender: 'agent', text: 'Please choose a PNG or JPEG image under 15 MB.', time: stampNow() }]);
                      return;
                    }
                    handleRunSampleKycOcr(uploadDocType, URL.createObjectURL(file));
                  }}
                />
                <span className="text-slate-500">Your original is never uploaded.</span>
              </div>
              )}


              {kycRedaction && (
                <div className={`${kycPanelOpen ? 'p-3' : 'px-3 py-1'} rounded-xl bg-slate-50 text-slate-800 border border-slate-200 flex flex-col gap-2`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (kycCollapseTimer.current) clearTimeout(kycCollapseTimer.current);
                      setKycPanelOpen((v) => !v);
                    }}
                    className="flex flex-wrap items-center justify-between gap-2 text-[11px] w-full text-left"
                    title={kycPanelOpen ? 'Hide the documents' : 'Show the documents'}
                  >
                    <span className="font-bold"> Privacy shield • {kycRedaction.type.replace('-', ' ').toUpperCase()}</span>
                    <span className={kycRedaction.status.startsWith('Warning') || kycRedaction.status.startsWith('Failed') ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                      {kycRedaction.status}
                      {showDevPanel && kycRedaction.samMs !== null ? ` • SAM 3.1 ${kycRedaction.samMs} ms${kycRedaction.samCached ? '(cached)' : ''}` : ''}
                      {showDevPanel && kycRedaction.locateMs !== null ? ` • Spark locate ${kycRedaction.locateMs} ms` : ''}
                      {showDevPanel && kycRedaction.ocrMs !== null ? ` • Spark OCR ${kycRedaction.ocrMs} ms` : ''}
                      {kycRedaction.status === 'Done' ? ' ✓' : ''} {kycPanelOpen ? '▾' : '▸'}</span>
                  </button>
                  {kycPanelOpen && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">{showDevPanel ? '1. SAM 3.1 boxes + pixel masks (one request per concept)' : '1. Private regions found on your card'}</div>
                      <svg viewBox={`0 0 ${kycRedaction.width} ${kycRedaction.height}`} className="w-full rounded-lg border border-slate-200 bg-white">
                        <image href={kycRedaction.imageUrl} width={kycRedaction.width} height={kycRedaction.height} />
                        {kycRedaction.regions.map((r, i) => (
                          <g key={i}>
                            {r.masks.map((m, k) => (
                              <path key={k} d={m.path} transform={`translate(${m.left} ${m.top})`} fill="rgba(244,63,94,0.5)" />
                            ))}
                            <rect
                              x={r.box.left}
                              y={r.box.top}
                              width={r.box.right - r.box.left}
                              height={r.box.bottom - r.box.top}
                              fill="none"
                              stroke="#f43f5e"
                              strokeWidth={3}
                            />
                            <text x={r.box.left} y={Math.max(16, r.box.top - 6)} fill="#be123c"fontSize={18} fontWeight={700}>
                              {r.concept}
                              {showDevPanel && r.confidence !== null ? ` ${(r.confidence * 100).toFixed(0)}%` : ''}
                            </text>
                          </g>
                        ))}
                      </svg>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">{showDevPanel ? '2. What Muse Spark receives (pixelated in your browser)' : '2. What the agent reads (hidden parts pixelated in your browser)'}</div>
                      {kycRedaction.redactedDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={kycRedaction.redactedDataUrl} alt="Redacted document sent to OCR"className="w-full rounded-lg border border-slate-200" />
                      ) : (
                        <div className="w-full aspect-[1000/630] rounded-lg border border-slate-200 bg-slate-100 animate-pulse" />
                      )}
                    </div>
                  </div>
                  )}
                </div>
              )}

              {/* Input Fields */}
              <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3 gap-x-3 gap-y-0 text-xs">
                
                {/* 1. Full Legal Name (Auto-Play on Click/Focus) */}
                <div
                  id="field-full-name"
                  onClick={() => handleFieldClickOrFocus('field-full-name')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    spotlightedElementId === 'input-full-name'
                      ? 'co-browse-spotlight'
                      : 'border-transparent hover:border-purple-200 hover:bg-purple-50/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <label className="text-slate-700 font-semibold">
                        Full Legal Name <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={(e) => handleWhyAskThis('field-full-name', e)}
                        className="text-[11px] text-slate-500 hover:text-[#582be8] font-medium transition-colors flex items-center gap-1"
                        title="Why does NexaSure ask this?"
                      >
                        <span>Why?</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerFieldGuidance('field-full-name');
                      }}
                      className="text-[11px] text-[#582be8] hover:underline font-semibold transition-colors flex items-center gap-1"
                    >
                      <span>Hear guidance</span>
                    </button>
                  </div>
                  <input
                    id="input-full-name"
                    type="text"
                    value={profile.fullName}
                    onFocus={() => handleFieldClickOrFocus('field-full-name')}
                    onChange={(e) => {
                      setProfile(prev => ({ ...prev, fullName: e.target.value }));
                      setIdleSeconds(0);
                    }}
                    placeholder="e.g. Ramesh Shankar Thorat (as on Aadhaar/PAN)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-medium focus:outline-none focus:border-[#582be8] focus:ring-2 focus:ring-purple-100"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Refer to your Aadhaar or PAN card. Use Hear guidance for spoken advice.</span>
                </div>

                {/* 2. Date of Birth (Auto-Play DD/MM/YYYY explanation on click) */}
                <div
                  id="field-dob"
                  onClick={() => handleFieldClickOrFocus('field-dob')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    spotlightedElementId === 'input-dob'
                      ? 'co-browse-spotlight'
                      : 'border-transparent hover:border-purple-200 hover:bg-purple-50/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <label className="text-slate-700 font-semibold">
                        Date of Birth (DD/MM/YYYY) <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={(e) => handleWhyAskThis('field-dob', e)}
                        className="text-[11px] text-slate-500 hover:text-[#582be8] font-medium transition-colors flex items-center gap-1"
                        title="Why does NexaSure ask this?"
                      >
                        <span>Why?</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerFieldGuidance('field-dob');
                      }}
                      className="text-[11px] text-[#582be8] hover:underline font-semibold transition-colors flex items-center gap-1"
                    >
                      <span>Hear guidance</span>
                    </button>
                  </div>
                  <input
                    id="input-dob"
                    type="text"
                    value={profile.dob}
                    onFocus={() => handleFieldClickOrFocus('field-dob')}
                    onChange={(e) => {
                      setProfile(prev => ({ ...prev, dob: e.target.value }));
                      setIdleSeconds(0);
                    }}
                    placeholder="DD/MM/YYYY (e.g. 14/05/1994)"
                    maxLength={10}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-medium focus:outline-none focus:border-[#582be8] focus:ring-2 focus:ring-purple-100"
                  />
                  <span className="text-[11px] text-purple-700 mt-1 block font-medium">
                    Day/Month/Year format. Use Hear guidance for a spoken explanation.</span>
                </div>

                {/* 3. Gender */}
                <div
                  id="field-gender"
                  onClick={() => handleFieldClickOrFocus('field-gender')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    spotlightedElementId === 'field-gender' ? 'co-browse-spotlight' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-slate-700 font-semibold">
                      Gender <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerFieldGuidance('field-gender');
                      }}
                      className="text-[11px] text-[#582be8] hover:underline font-semibold transition-colors flex items-center gap-1"
                    >
                      <span>Hear guidance</span>
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {['Male', 'Female'].map((g) => (
                      <button
                        key={g}
                        id={`option-gender-${g.toLowerCase()}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProfile(prev => ({ ...prev, gender: g }));
                          handleFieldClickOrFocus('field-gender');
                        }}
                        className={`flex-1 py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all ${
                          profile.gender === g
                            ? 'border-[#582be8] bg-purple-50 text-[#582be8] ring-2 ring-purple-200'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. Annual Income */}
                <div
                  id="field-annual-income"
                  onClick={() => handleFieldClickOrFocus('field-annual-income')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    spotlightedElementId === 'select-annual-income' ? 'co-browse-spotlight' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <label className="text-slate-700 font-semibold">
                        Annual Income (Gross) <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={(e) => handleWhyAskThis('field-income', e)}
                        className="text-[11px] text-slate-500 hover:text-[#582be8] font-medium transition-colors flex items-center gap-1"
                        title="Why does NexaSure ask this?"
                      >
                        <span>Why?</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerFieldGuidance('field-annual-income');
                      }}
                      className="text-[11px] text-[#582be8] hover:underline font-semibold transition-colors flex items-center gap-1"
                    >
                      <span>Hear guidance</span>
                    </button>
                  </div>
                  <select
                    id="select-annual-income"
                    value={profile.annualIncome}
                    onFocus={() => handleFieldClickOrFocus('field-annual-income')}
                    onChange={(e) => {
                      setProfile(prev => ({ ...prev, annualIncome: e.target.value }));
                      setIdleSeconds(0);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-medium bg-white focus:outline-none focus:border-[#582be8] focus:ring-2 focus:ring-purple-100"
                  >
                    <option value="">-- Select Annual Income Range --</option>
                    <option value="5L-10L">₹5,00,000 - ₹10,00,000</option>
                    <option value="10L-15L">₹10,00,000 - ₹15,00,000</option>
                    <option value="15L-20L">₹15,00,000 - ₹20,00,000 (Recommended)</option>
                    <option value="20L-35L">₹20,00,000 - ₹35,00,000</option>
                    <option value="35L+">Above ₹35,00,000</option>
                  </select>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Gross income before taxes as per Form 16 / ITR</span>
                </div>

                {/* 5. Tobacco / Smoking Status */}
                <div
                  id="field-smoking"
                  onClick={() => handleFieldClickOrFocus('field-smoking')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    spotlightedElementId === 'field-smoking' ? 'co-browse-spotlight' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <label className="text-slate-700 font-semibold">
                        Tobacco / Smoking Habit <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={(e) => handleWhyAskThis('field-smoker', e)}
                        className="text-[11px] text-slate-500 hover:text-[#582be8] font-medium transition-colors flex items-center gap-1"
                        title="Why does NexaSure ask this?"
                      >
                        <span>Why?</span>
                      </button>
                    </div>
                    <span className="text-[11px] text-[#582be8] font-bold"> Auto-guidance</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      id="option-smoker-no"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProfile(prev => ({ ...prev, isSmoker: false }));
                        handleFieldClickOrFocus('field-smoking');
                      }}
                      className={`flex-1 py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all ${
                        profile.isSmoker === false
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-200'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {profile.isSmoker === false ? '✓ ' : ''}Non-Smoker (20% Discount)
                    </button>
                    <button
                      id="option-smoker-yes"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProfile(prev => ({ ...prev, isSmoker: true }));
                        handleFieldClickOrFocus('field-smoking');
                      }}
                      className={`flex-1 py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all ${
                        profile.isSmoker === true
                          ? 'border-orange-500 bg-orange-50 text-orange-800 ring-2 ring-orange-200'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      Smoker / Tobacco
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    No tobacco consumption in last 12 months</span>
                </div>

                {/* 6. City & Pincode */}
                <div
                  id="field-city"
                  onClick={() => handleFieldClickOrFocus('field-city')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    spotlightedElementId === 'field-city' ? 'co-browse-spotlight' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-slate-700 font-semibold">City & PIN Code</label>
                    <span className="text-[11px] text-[#582be8] font-bold"> Auto-guidance</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      id="input-city"
                      type="text"
                      value={profile.city}
                      onFocus={() => handleFieldClickOrFocus('field-city')}
                      onChange={(e) => setProfile(prev => ({ ...prev, city: e.target.value }))}
                      placeholder="e.g. Pune"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-medium focus:outline-none focus:border-[#582be8]"
                    />
                    <input
                      id="input-pincode"
                      type="text"
                      value={profile.pincode}
                      onFocus={() => handleFieldClickOrFocus('field-city')}
                      onChange={(e) => setProfile(prev => ({ ...prev, pincode: e.target.value }))}
                      placeholder="e.g. 411038"
                      maxLength={6}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-medium focus:outline-none focus:border-[#582be8]"
                    />
                  </div>
                </div>

              </div>

              {docDiscrepancies.length > 0 && (
                <div id="field-discrepancies" className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 flex flex-col gap-1.5">
                  <strong>A document does not match what you typed. Pick the correct value:</strong>
                  {docDiscrepancies.map((d) => (
                    <div key={`${d.source}-${d.field}`} className="flex flex-wrap items-center gap-2">
                      <span>
                        {d.label}: you typed <strong>{d.typed}</strong>, {d.source} shows <strong>{d.fromDocument}</strong>
                      </span>
                      <button onClick={() => resolveDiscrepancy(d, false)} className="px-2 py-0.5 rounded-lg bg-white border border-amber-300 font-semibold">Keep mine</button>
                      <button onClick={() => resolveDiscrepancy(d, true)} className="px-2 py-0.5 rounded-lg bg-white border border-amber-300 font-semibold">Use the document's</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Identity records: filled by a sample scan or typed by the user; kept on this device, shown masked */}
              <div id="field-identity" className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                <span
                  className="font-bold text-slate-800 shrink-0"
                  title="Required. Scan a sample document above or enter your own numbers. They stay on this device and the agent only ever sees them masked."
                >
                  Identity records <span className="text-red-500">*</span>
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1 min-w-[18rem]">
                  <MaskedIdField
                    label="Aadhaar"
                    value={profile.aadhaarNumber}
                    placeholder="12 digits"
                    inputMode="numeric"
                    mask={maskAadhaar}
                    sanitize={(r) => r.replace(/\D/g, '').slice(0, 12)}
                    valid={(v) => /^\d{12}$/.test(v)}
                    fromSample={idFromSample.aadhaar}
                    onChange={(v) => {
                      setIdFromSample((p) => ({ ...p, aadhaar: false }));
                      setProfile((p) => ({ ...p, aadhaarNumber: v }));
                    }}
                  />
                  <MaskedIdField
                    label="PAN"
                    value={profile.panNumber}
                    placeholder="ABCDE1234F"
                    mask={maskPan}
                    sanitize={(r) => r.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}
                    valid={(v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(v)}
                    fromSample={idFromSample.pan}
                    onChange={(v) => {
                      setIdFromSample((p) => ({ ...p, pan: false }));
                      setProfile((p) => ({ ...p, panNumber: v }));
                    }}
                  />
                  <MaskedIdField
                    label="Mobile"
                    value={profile.mobileNumber}
                    placeholder="10 digits"
                    inputMode="numeric"
                    mask={maskMobile}
                    sanitize={(r) => r.replace(/\D/g, '').slice(0, 10)}
                    valid={(v) => /^[6-9]\d{9}$/.test(v)}
                    onChange={(v) => setProfile((p) => ({ ...p, mobileNumber: v }))}
                  />
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 shrink-0">
                  Masked from OmniCB Agent</span>
              </div>

              <div className="flex justify-end pt-1.5 border-t border-slate-100">
                <button
                  onClick={() => {
                    if (goToStep(2)) setIdleSeconds(0);
                    else {
                      const first = stepIssues[1][0];
                      if (first) triggerFieldGuidance(first.id);
                    }
                  }}
                  className="px-5 py-2 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2"
                >
                  <span>Continue to Step 2: Cover & Riders</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Cover & Rider Selection */}
          {mode === 'cobrowse' && activeStep === 2 && (
            <div className="flex flex-col gap-6">

              {/* Base Plan Selection */}
              <div className="nx-card p-4">
                <div className="pb-3 border-b border-slate-100 mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-[#111827]">Step 2.1: Base Life Protection Cover</h2>
                    <p className="text-xs text-slate-500">Guaranteed tax-free lump sum payout to family under Section 10(10D)</p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">
                    30-Year Rate Guarantee</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  {[
                    { id: '1cr', title: '₹1.00 Crore', sub: 'Essential Family Protection', rate: 790 },
                    { id: '1.5cr', title: '₹1.50 Crore', sub: 'Recommended for Income > 15L', rate: 1050, badge: 'Recommended' },
                    { id: '2cr', title: '₹2.00 Crore', sub: 'High Net Worth Security', rate: 1380 },
                  ].map((tier) => (
                    <div
                      key={tier.id}
                      id={`cover-tier-${tier.id}`}
                      onClick={() => setBaseSumAssured(tier.id as any)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                        baseSumAssured === tier.id
                          ? 'border-[#582be8] bg-purple-50/50 ring-2 ring-[#582be8]/20'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      {tier.badge && (
                        <span className="absolute -top-2.5 right-3 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-[#582be8] text-white">
                          {tier.badge}</span>
                      )}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-[#111827]">{tier.title}</span>
                          {baseSumAssured === tier.id && (
                            <span className="size-5 rounded-full bg-[#582be8] text-white flex items-center justify-center text-xs font-bold">
                              ✓</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 leading-tight">{tier.sub}</p>
                      </div>
                      <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-baseline justify-between tabular-nums">
                        <span className="text-base font-bold text-[#582be8]">₹{tier.rate}</span>
                        <span className="text-[11px] text-slate-500">/month</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add-on Riders (Clicking auto-plays guidance) */}
              <div className="nx-card p-4">
                <div className="pb-3 border-b border-slate-100 mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-[#111827] flex items-center gap-2">
                      <span>Step 2.2: Optional Riders</span>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-purple-100 text-[#582be8]">
                        Riders</span>
                    </h2>
                    <p className="text-xs text-slate-500">Click any card to add/remove and hear auto-played guidance.</p>
                  </div>
                  <button
                    onClick={() => triggerFieldGuidance('card-critical-illness')}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-[#582be8] border border-purple-200 transition-colors flex items-center gap-1"
                  >
                    <span>Hear Rider Advice</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-4 gap-3">
                  
                  {/* Rider 1: Critical Illness */}
                  <div
                    id="card-critical-illness"
                    onClick={() => {
                      setSelectedRiders(prev => ({ ...prev, criticalIllness: !prev.criticalIllness }));
                      triggerFieldGuidance('card-critical-illness');
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                      spotlightedElementId === 'card-critical-illness'
                        ? 'co-browse-spotlight shadow-sm'
                        : selectedRiders.criticalIllness
                        ? 'border-[#582be8] bg-purple-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {selectedRiders.criticalIllness && (
                      <span className="absolute top-3.5 right-3.5 size-5 rounded-full bg-[#582be8] text-white flex items-center justify-center text-xs font-bold">
                        ✓</span>
                    )}
                    <div className="flex items-baseline justify-between mb-1 pr-6">
                      <h3 className="text-sm font-bold text-[#111827]">Critical Illness Cover</h3>
                      <span className="text-xs tabular-nums font-bold text-[#582be8] whitespace-nowrap shrink-0">+₹149/mo</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-2.5">
                      ₹25,00,000 cash lump sum paid on first diagnosis of 36 critical illnesses including Heart Attack, Cancer, and Stroke.
                    </p>
                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 tabular-nums">
                      <span className="px-2 py-0.5 rounded bg-purple-50 text-[#582be8] border border-purple-100">Surviving Illness Benefit</span>
                      <span className="text-[#582be8] font-bold"> Click for Advice</span>
                    </div>
                  </div>

                  {/* Rider 2: Accidental Death */}
                  <div
                    id="card-accidental-death"
                    onClick={() => {
                      setSelectedRiders(prev => ({ ...prev, accidentalDeath: !prev.accidentalDeath }));
                      setIdleSeconds(0);
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                      selectedRiders.accidentalDeath
                        ? 'border-[#582be8] bg-purple-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {selectedRiders.accidentalDeath && (
                      <span className="absolute top-3.5 right-3.5 size-5 rounded-full bg-[#582be8] text-white flex items-center justify-center text-xs font-bold">
                        ✓</span>
                    )}
                    <div className="flex items-baseline justify-between mb-1 pr-6">
                      <h3 className="text-sm font-bold text-[#111827]">Accidental Death Cover</h3>
                      <span className="text-xs tabular-nums font-bold text-[#582be8] whitespace-nowrap shrink-0">+₹79/mo</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-2.5">
                      Doubles total payout (additional ₹1.00 Crore) in case of accidental demise or permanent occupational disability.
                    </p>
                    <div className="text-[11px] font-medium text-slate-500 tabular-nums">
                      <span>Transit & Occupational Protection</span>
                    </div>
                  </div>

                  {/* Rider 3: Waiver of Premium */}
                  <div
                    id="card-waiver-premium"
                    onClick={() => {
                      setSelectedRiders(prev => ({ ...prev, waiverOfPremium: !prev.waiverOfPremium }));
                      triggerFieldGuidance('card-waiver-premium');
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                      spotlightedElementId === 'card-waiver-premium'
                        ? 'co-browse-spotlight shadow-sm'
                        : selectedRiders.waiverOfPremium
                        ? 'border-[#582be8] bg-purple-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {selectedRiders.waiverOfPremium && (
                      <span className="absolute top-3.5 right-3.5 size-5 rounded-full bg-[#582be8] text-white flex items-center justify-center text-xs font-bold">
                        ✓</span>
                    )}
                    <div className="flex items-baseline justify-between mb-1 pr-6">
                      <h3 className="text-sm font-bold text-[#111827]">Waiver of Premium (WOP)</h3>
                      <span className="text-xs tabular-nums font-bold text-[#582be8] whitespace-nowrap shrink-0">+₹42/mo</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-2.5">
                      If you suffer permanent disability, all future premiums for the next 30 years are 100% waived; policy stays active.
                    </p>
                    <div className="flex items-center justify-between text-[11px] font-medium text-emerald-600 tabular-nums">
                      <span>Policy Continuity Guarantee</span>
                      <span className="text-[#582be8] font-bold"> Click for Advice</span>
                    </div>
                  </div>

                  {/* Rider 4: Hospital Daily Cash */}
                  <div
                    id="card-hospital-cash"
                    onClick={() => {
                      setSelectedRiders(prev => ({ ...prev, hospitalCash: !prev.hospitalCash }));
                      setIdleSeconds(0);
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                      selectedRiders.hospitalCash
                        ? 'border-[#582be8] bg-purple-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {selectedRiders.hospitalCash && (
                      <span className="absolute top-3.5 right-3.5 size-5 rounded-full bg-[#582be8] text-white flex items-center justify-center text-xs font-bold">
                        ✓</span>
                    )}
                    <div className="flex items-baseline justify-between mb-1 pr-6">
                      <h3 className="text-sm font-bold text-[#111827]">Hospital Daily Cash Allowance</h3>
                      <span className="text-xs tabular-nums font-bold text-[#582be8] whitespace-nowrap shrink-0">+₹55/mo</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-2.5">
                      Pays ₹2,000 for each day of hospitalisation, to cover incidental expenses and loss of daily income.
                    </p>
                    <div className="text-[11px] font-medium text-slate-500 tabular-nums">
                      <span>Demo rider terms</span>
                    </div>
                  </div>

                </div>

                {/* Complex Benefit Ladders & Tiered Protection */}
                <div id="card-benefit-ladders"className="mt-5 p-5 rounded-2xl bg-gradient-to-br from-purple-50 via-indigo-50/40 to-white border border-purple-200/80 space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-purple-100">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[#582be8] flex items-center gap-1.5">
                        <span>Meta Muse Wonder • Rider Payout Options</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-lg bg-purple-100 text-purple-800 tabular-nums">
                          Actuarial Dynamic Tiers</span>
                      </h3>
                      <p className="text-[11px] text-slate-600">Select living benefit ladders and milestone-based coverage escalators.</p>
                    </div>
                  </div>

                  {/* 1. Critical Illness Coverage Tier Ladder */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-semibold text-slate-800">
                      <span>1. Critical Illness Living Benefit Tier Ladder:</span>
                      <span className="text-[11px] tabular-nums text-[#582be8] font-bold">
                        {ciTier === 'tier1' ? '₹10 Lakhs (+₹89/mo)' : ciTier === 'tier3' ? '₹50 Lakhs (+₹269/mo)' : '₹25 Lakhs (+₹149/mo) [Recommended]'}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      {[
                        { tier: 'tier1'as const, name: 'Tier 1: Silver', cover: '₹10,00,000', illnesses: '10 Major Conditions', price: '+₹89/mo' },
                        { tier: 'tier2'as const, name: 'Tier 2: Gold (Rec.)', cover: '₹25,00,000', illnesses: '36 Critical Conditions', price: '+₹149/mo' },
                        { tier: 'tier3'as const, name: 'Tier 3: Platinum', cover: '₹50,00,000', illnesses: '64 Conditions + 2nd Opinion', price: '+₹269/mo' },
                      ].map((t) => (
                        <div
                          key={t.tier}
                          onClick={() => {
                            setSelectedRiders(prev => ({ ...prev, criticalIllness: true }));
                            setCiTier(t.tier);
                          }}
                          className={`p-3 rounded-xl border cursor-pointer transition-all ${
                            selectedRiders.criticalIllness && ciTier === t.tier
                              ? 'border-[#582be8] bg-purple-50 ring-1 ring-[#582be8]'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="font-bold text-slate-900 text-xs">{t.name}</span>
                            <span className="tabular-nums text-[#582be8] font-bold text-[11px]">{t.price}</span>
                          </div>
                          <strong className="text-sm font-bold text-slate-800 block">{t.cover}</strong>
                          <span className="text-[11px] text-slate-500 block">{t.illnesses}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2. Accidental Total & Permanent Disability (ATPD) Income Ladder */}
                  <div className="space-y-2 pt-2 border-t border-purple-100">
                    <div className="flex justify-between items-center text-xs font-semibold text-slate-800">
                      <span>2. Accidental Disability Payout Structure Ladder:</span>
                      <span className="text-[11px] tabular-nums text-[#582be8] font-bold">
                        {atpdOption === 'income' ? '₹1 Lakh/mo for 100 Months (+₹129/mo)' : '₹50 Lakhs Lump Sum (+₹79/mo)'}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div
                        onClick={() => {
                          setSelectedRiders(prev => ({ ...prev, accidentalDeath: true }));
                          setAtpdOption('lump');
                        }}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          selectedRiders.accidentalDeath && atpdOption === 'lump'
                            ? 'border-[#582be8] bg-purple-50 ring-1 ring-[#582be8]'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="font-bold text-slate-900">Option A: Lump Sum Cash</span>
                          <span className="tabular-nums text-[#582be8] font-bold text-[11px]">+₹79/mo</span>
                        </div>
                        <p className="text-[11px] text-slate-600">Immediate ₹50,00,000 cash transfer upon accidental disability.</p>
                      </div>

                      <div
                        onClick={() => {
                          setSelectedRiders(prev => ({ ...prev, accidentalDeath: true }));
                          setAtpdOption('income');
                        }}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          selectedRiders.accidentalDeath && atpdOption === 'income'
                            ? 'border-[#582be8] bg-purple-50 ring-1 ring-[#582be8]'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="font-bold text-slate-900">Option B: Salary Replacement Ladder</span>
                          <span className="tabular-nums text-[#582be8] font-bold text-[11px]">+₹129/mo</span>
                        </div>
                        <p className="text-[11px] text-slate-600">₹1,00,000/month regular income for 100 continuous months (₹1.00 Cr total).</p>
                      </div>
                    </div>
                  </div>

                  {/* 3. Life Stage Cover Escalator & Terminal Illness */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-purple-100 text-xs">
                    <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-slate-200 cursor-pointer hover:border-purple-300 transition-all">
                      <input
                        type="checkbox"
                        checked={lifeStageEscalator}
                        onChange={(e) => setLifeStageEscalator(e.target.checked)}
                        className="mt-0.5 size-4 rounded text-[#582be8] focus:ring-[#582be8]"
                      />
                      <div>
                        <div className="flex justify-between items-baseline">
                          <span className="font-bold text-slate-900">Life Stage Cover Escalator</span>
                          <span className="tabular-nums text-[#582be8] font-bold text-[11px]">+₹49/mo</span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                          Auto-boost cover by 10% annually or 50% on marriage / 25% on child birth with zero medical re-tests.
                        </p>
                      </div>
                    </label>

                    <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-start gap-2">
                      <span className="text-emerald-700 text-base"></span>
                      <div>
                        <div className="flex justify-between items-baseline">
                          <span className="font-bold text-emerald-950">Terminal Illness Accelerated Payout</span>
                          <span className="tabular-nums text-emerald-800 font-bold text-[11px]">Built-in (₹0)</span>
                        </div>
                        <p className="text-[11px] text-emerald-800 leading-tight mt-0.5">
                          100% of sum assured paid immediately upon medical diagnosis of terminal illness (&lt; 6 months).
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <label
                id="card-no-riders"
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs cursor-pointer ${
                  spotlightedElementId === 'card-no-riders' ? 'co-browse-spotlight' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={noRidersEffective}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedRiders({ criticalIllness: false, accidentalDeath: false, waiverOfPremium: false, hospitalCash: false });
                      setLifeStageEscalator(false);
                    }
                    setNoRiders(e.target.checked);
                  }}
                  className="size-4 rounded text-[#582be8] border-slate-300"
                />
                <span className="text-slate-700">I do not want any riders (base cover only)</span>
              </label>

              <div className="flex justify-between items-center pt-2">
                <button
                  onClick={() => setActiveStep(1)}
                  className="px-5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
                >
                  ← Back to Step 1
                </button>
                <button
                  onClick={() => {
                    if (goToStep(3)) setIdleSeconds(0);
                  }}
                  className="px-6 py-3 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2"
                >
                  <span>Continue to Step 3: Beneficiary & MWPA Trust</span>
                  <span>→</span>
                </button>
              </div>

            </div>
          )}

          {/* STEP 3: Beneficiary Nomination & Statutory Trust (IRDAI Section 39 & MWPA 1874) */}
          {mode === 'cobrowse' && activeStep === 3 && (
            <div id="nomination-section"className="nx-card p-4 flex flex-col gap-5">
              <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#111827] flex items-center gap-2">
                    <span>Step 3: Beneficiary Nomination & Statutory MWPA Trust</span>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-purple-100 text-[#582be8]">
                      IRDAI Section 39</span>
                  </h2>
                  <p className="text-xs text-slate-500">Designate legal beneficiaries and protect claim proceeds under Married Women's Property Act</p>
                </div>
                <button
                  type="button"
                  onClick={() => triggerFieldGuidance('nomination-section')}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-[#582be8] border border-purple-200 transition-colors flex items-center gap-1"
                >
                  <span>Hear Nomination Advice</span>
                </button>
              </div>

              {/* Meta Muse Wonder AI Recommendation Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-900/10 via-indigo-900/10 to-blue-900/10 border border-purple-300 text-slate-800 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl"></span>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#582be8]">
                        Meta Muse Wonder 1.0 • Suggested split (not a rule)
                      </h4>
                      <p className="text-xs text-slate-700 font-medium">
                        One common split for a family with a minor child is <strong>70% to Spouse</strong> and <strong>30% to Minor Child</strong> with an adult appointee. It is a suggestion, not an IRDAI rule, and you can choose any split totalling 100%.
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-lg bg-purple-100 text-[#582be8] text-[11px] tabular-nums font-bold border border-purple-200 shrink-0">
                    Suggestion</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-purple-200/60">
                  <button
                    type="button"
                    onClick={() => {
                      setNomination({
                        primaryName: 'Priya Ramesh Thorat',
                        primaryRelation: 'Spouse',
                        primaryDob: '19/08/1996',
                        primaryShare: 70,
                        hasSecondaryNominee: true,
                        secondaryName: 'Aarav Ramesh Thorat',
                        secondaryRelation: 'Child',
                        secondaryAge: 7,
                        secondaryShare: 30,
                        appointeeName: 'Shankar Thorat',
                        appointeeRelation: 'Grandparent',
                        additionalNominees: [],
                        mwpaTrustEnabled: true,
                      });
                      speakText(
                        selectedLanguage === 'hi'
                          ? 'मेटा म्यूज वंडर ने 70% पत्नी और 30% बच्चे के विभाजन के साथ MWPA ट्रस्ट शील्ड लागू कर दी है।'
                          : selectedLanguage === 'mr'
                          ? 'मेटा म्यूज वंडरने ७०% पत्नी आणि ३०% मुलाच्या वाट्यासह MWPA ट्रस्ट शील्ड लागू केले आहे.'
                          : 'Applied recommended 70/30 nomination split with Married Women\'s Property Act Trust Shield.',
                        selectedLanguage
                      );
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <span>Apply Recommended 70/30 Split</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setNomination(prev => ({ ...prev, mwpaTrustEnabled: !prev.mwpaTrustEnabled }));
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                      nomination.mwpaTrustEnabled
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span>{nomination.mwpaTrustEnabled ? '' : ''}</span>
                    <span>MWPA Sec 6 Creditor Shield: {nomination.mwpaTrustEnabled ? 'ACTIVE (Irrevocable Trust)' : 'ENABLE'}</span>
                  </button>
                </div>
              </div>

              {/* Primary Nominee Form */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-[#582be8]" />
                    <span>Primary Nominee (Direct Claimant)</span>
                  </h3>
                  <span className="text-[11px] tabular-nums text-slate-500 font-bold">Share: {nomination.primaryShare}%</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">Full Legal Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Priya Ramesh Thorat"
                      value={nomination.primaryName}
                      onChange={(e) => setNomination(prev => ({ ...prev, primaryName: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-medium focus:ring-2 focus:ring-[#582be8] focus:border-[#582be8]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">Relationship</label>
                    <select
                      value={nomination.primaryRelation}
                      onChange={(e) => setNomination(prev => ({ ...prev, primaryRelation: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-medium focus:ring-2 focus:ring-[#582be8] focus:border-[#582be8]"
                    >
                      <option value="Spouse">Spouse (Wife / Husband)</option>
                      <option value="Son">Son</option>
                      <option value="Daughter">Daughter</option>
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Sibling">Brother / Sister</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">Date of birth</label>
                    <input
                      id="input-nominee-dob"
                      data-testid="input-nominee-dob"
                      type="text"
                      inputMode="numeric"
                      placeholder="Nominee date of birth (DD/MM/YYYY)"
                      value={nomination.primaryDob}
                      onChange={(e) => setNomination(prev => ({ ...prev, primaryDob: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-medium focus:ring-2 focus:ring-[#582be8] focus:border-[#582be8]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">Share Allocation %</label>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      value={nomination.primaryShare}
                      onChange={(e) => setNomination(prev => ({ ...prev, primaryShare: parseInt(e.target.value, 10) || 100 }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 tabular-nums font-bold focus:ring-2 focus:ring-[#582be8] focus:border-[#582be8]"
                    />
                  </div>
                </div>
              </div>

              {/* Secondary / Minor Nominee Toggle */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={nomination.hasSecondaryNominee}
                      onChange={(e) => setNomination(prev => ({ ...prev, hasSecondaryNominee: e.target.checked }))}
                      className="size-4 rounded text-[#582be8] focus:ring-[#582be8]"
                    />
                    <span className="text-xs font-bold text-slate-900">Add Contingent / Minor Nominee (IRDAI Section 39)</span>
                  </label>
                  {nomination.hasSecondaryNominee && (
                    <span className="text-[11px] tabular-nums text-slate-500 font-bold">Share: {nomination.secondaryShare}%</span>
                  )}
                </div>

                {nomination.hasSecondaryNominee && (
                  <div className="space-y-3 pt-2 border-t border-slate-200">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">Nominee Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Aarav Ramesh Thorat"
                          value={nomination.secondaryName}
                          onChange={(e) => setNomination(prev => ({ ...prev, secondaryName: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-medium"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">Relationship</label>
                        <select
                          value={nomination.secondaryRelation}
                          onChange={(e) => setNomination(prev => ({ ...prev, secondaryRelation: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-medium"
                        >
                          <option value="Child">Child (Minor Son/Daughter)</option>
                          <option value="Spouse">Spouse</option>
                          <option value="Parent">Parent</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">Age (Years)</label>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={nomination.secondaryAge}
                          onChange={(e) => setNomination(prev => ({ ...prev, secondaryAge: parseInt(e.target.value, 10) || 7 }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 tabular-nums font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">Share %</label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={nomination.secondaryShare}
                          onChange={(e) => setNomination(prev => ({ ...prev, secondaryShare: parseInt(e.target.value, 10) || 30 }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 tabular-nums font-bold"
                        />
                      </div>
                    </div>

                  </div>
                )}
              </div>

              {/* Third and fourth nominees, for example a second child */}
              {nomination.hasSecondaryNominee && (
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">More nominees <span className="font-normal text-slate-500">(up to 4 in total)</span></span>
                    <button
                      type="button"
                      disabled={nomination.additionalNominees.length >= 2}
                      onClick={() =>
                        setNomination((prev) => ({
                          ...prev,
                          additionalNominees: [...prev.additionalNominees, { name: '', relation: 'Child', age: 5, share: 0 }].slice(0, 2),
                        }))
                      }
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-[#582be8] hover:bg-purple-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + Add another nominee
                    </button>
                  </div>
                  {nomination.additionalNominees.map((n, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_9rem_5rem_5rem_auto] gap-3 items-end pt-2 border-t border-slate-200">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">Nominee {i + 3} name</label>
                        <input
                          type="text"
                          placeholder="e.g. Anaya Thorat"
                          value={n.name}
                          onChange={(e) => setNomination((prev) => ({ ...prev, additionalNominees: prev.additionalNominees.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-medium"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">Relationship</label>
                        <select
                          value={n.relation}
                          onChange={(e) => setNomination((prev) => ({ ...prev, additionalNominees: prev.additionalNominees.map((x, k) => (k === i ? { ...x, relation: e.target.value } : x)) }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-medium"
                        >
                          <option value="Child">Child</option>
                          <option value="Spouse">Spouse</option>
                          <option value="Parent">Parent</option>
                          <option value="Sibling">Sibling</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">Age</label>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={n.age}
                          onChange={(e) => setNomination((prev) => ({ ...prev, additionalNominees: prev.additionalNominees.map((x, k) => (k === i ? { ...x, age: parseInt(e.target.value, 10) || 0 } : x)) }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 tabular-nums font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">Share %</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={n.share}
                          onChange={(e) => setNomination((prev) => ({ ...prev, additionalNominees: prev.additionalNominees.map((x, k) => (k === i ? { ...x, share: parseInt(e.target.value, 10) || 0 } : x)) }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 tabular-nums font-bold"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setNomination((prev) => ({ ...prev, additionalNominees: prev.additionalNominees.filter((_, k) => k !== i) }))}
                        className="px-2.5 py-2 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-red-600 hover:bg-red-50"
                        title="Remove this nominee"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Shares must total 100 across every nominee */}
              <div
                className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${
                  nomineeTotalShare === 100 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                <span>
                  {nomineeTotalShare === 100
                    ? `Total share 100% across ${allNominees.length} nominee${allNominees.length === 1 ? '' : 's'}`
                    : `Shares add up to ${nomineeTotalShare}%. They must total 100% before you continue.`}
                </span>
                {allNominees.length > 1 && nomineeTotalShare !== 100 && (
                  <button
                    type="button"
                    onClick={() =>
                      setNomination((prev) => {
                        const n = 1 + (prev.hasSecondaryNominee ? 1 + prev.additionalNominees.length : 0);
                        const each = Math.floor(100 / n);
                        return {
                          ...prev,
                          primaryShare: 100 - each * (n - 1),
                          secondaryShare: each,
                          additionalNominees: prev.additionalNominees.map((x) => ({ ...x, share: each })),
                        };
                      })
                    }
                    className="px-3 py-1 rounded-lg bg-white border border-red-300 text-red-700 hover:bg-red-100"
                  >
                    Split equally
                  </button>
                )}
              </div>

              {/* A minor nominee needs an adult appointee (Insurance Act section 39) */}
            {/* If minor nominee (<18 yrs), Appointee Details required under IRDAI Sec 39 */}
            {anyMinorNominee && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                <div className="flex items-center gap-1.5 text-amber-900 text-xs font-bold">
                  <span>Minor nominee detected (under 18 years)</span>
                  <span className="text-[11px] tabular-nums bg-amber-100 px-2 py-0.5 rounded text-amber-800">
                    IRDAI Section 39 Requirement: Adult Appointee Mandated</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-amber-900 block mb-1">Appointee Full Legal Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Shankar Thorat"
                      value={nomination.appointeeName}
                      onChange={(e) => setNomination(prev => ({ ...prev, appointeeName: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-lg border border-amber-300 text-xs text-slate-900 font-medium"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-amber-900 block mb-1">Relationship to Minor</label>
                    <input
                      type="text"
                      placeholder="e.g. Paternal Grandfather"
                      value={nomination.appointeeRelation}
                      onChange={(e) => setNomination(prev => ({ ...prev, appointeeRelation: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-lg border border-amber-300 text-xs text-slate-900 font-medium"
                    />
                  </div>
                </div>
              </div>
            )}

              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <button
                  onClick={() => setActiveStep(2)}
                  className="px-5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50"
                >
                  ← Back to Step 2: Benefit Ladders
                </button>
                <button
                  onClick={() => {
                    if (goToStep(4)) setIdleSeconds(0);
                  }}
                  className="px-6 py-3 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2"
                >
                  <span>Continue to Step 4: Medical Disclosures</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Medical Disclosures */}
          {mode === 'cobrowse' && activeStep === 4 && (
            <div className="nx-card p-4 flex flex-col gap-5">
              <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#111827]">Step 4: Medical & Underwriting Disclosures</h2>
                  <p className="text-xs text-slate-500">Statutory health declarations required under Section 45 of Insurance Act 1938</p>
                  <p className="text-[11px] text-slate-500 mt-1">This assistant explains the form, not your health. For any medical question, please speak to your doctor. Underwriting decides medical acceptance.</p>
                </div>
                <button
                  onClick={() => triggerFieldGuidance('field-section-45')}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-[#582be8] border border-purple-200 transition-colors flex items-center gap-1"
                >
                  <span>Why declare health history?</span>
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                
                {/* Family History */}
                <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={underwriting.familyCardiacHistory}
                    onChange={(e) => setUnderwriting(prev => ({ ...prev, familyCardiacHistory: e.target.checked }))}
                    className="mt-0.5 size-4 rounded text-[#582be8] border-slate-300 focus:ring-[#582be8]"
                  />
                  <div className="text-slate-700">
                    <span className="font-bold text-[#111827] block mb-0.5">Family Cardiac & Chronic Disease History</span>
                    <span>Father, mother, or siblings diagnosed with heart attack, coronary bypass surgery, or stroke before age 60.</span>
                  </div>
                </label>

                {/* Prior Hospitalization */}
                <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={underwriting.priorHospitalization}
                    onChange={(e) => setUnderwriting(prev => ({ ...prev, priorHospitalization: e.target.checked }))}
                    className="mt-0.5 size-4 rounded text-[#582be8] border-slate-300 focus:ring-[#582be8]"
                  />
                  <div className="text-slate-700">
                    <span className="font-bold text-[#111827] block mb-0.5">Prior Hospitalization or Major Surgery</span>
                    <span>Any inpatient medical treatment or specialized medication lasting longer than 48 hours in the past 5 years.</span>
                  </div>
                </label>

                {/* Section 45 Declaration (Click triggers guidance) */}
                <label
                  id="field-section-45"
                  onClick={() => triggerFieldGuidance('field-section-45')}
                  className={`flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer ${
                    spotlightedElementId === 'field-section-45'
                      ? 'co-browse-spotlight'
                      : underwriting.section45Consent
                      ? 'border-[#582be8] bg-purple-50/60 ring-1 ring-[#582be8]/20'
                      : 'border-slate-200 bg-slate-50 hover:border-purple-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={underwriting.section45Consent}
                    onChange={(e) => setUnderwriting(prev => ({ ...prev, section45Consent: e.target.checked }))}
                    className="mt-0.5 size-4 rounded text-[#582be8] border-slate-300 focus:ring-[#582be8]"
                  />
                  <div className="text-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#111827] block mb-0.5">Section 45 Statutory Declaration & Claim Guarantee</span>
                      <span className="text-[11px] text-[#582be8] font-bold"> Auto-guidance</span>
                    </div>
                    <span>I declare that all health disclosures are authentic. After 3 continuous policy years, Section 45 protects against claim rejection.</span>
                  </div>
                </label>

              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <button
                  onClick={() => setActiveStep(3)}
                  className="px-5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50"
                >
                  ← Back to Step 3: Beneficiary & MWPA
                </button>
                <button
                  onClick={() => {
                    if (!goToStep(5)) triggerFieldGuidance('field-section-45');
                  }}
                  className="px-6 py-3 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2"
                >
                  <span>Review & Issue Policy (Step 5)</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: Summary & Issuance */}
          {mode === 'cobrowse' && activeStep === 5 && (
            <div className="nx-card p-4 flex flex-col gap-5">
              <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#111827]">Step 5: Policy Schedule, Terms & Instant Issuance</h2>
                  <p className="text-xs text-slate-500">Review your final coverage schedule, beneficiary details & statutory terms</p>
                </div>
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${
                    maxReachableStep >= 5 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {maxReachableStep >= 5 ? 'Checks passed' : 'Checks need attention'}
                </span>
              </div>

              {/* Application guardian: every check the proposal has to pass, and what is still open */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <div className="font-bold text-slate-900 mb-1.5">Application check</div>
                <ul className="flex flex-col gap-1">
                  {[
                    { label: 'Applicant profile complete, matches your documents', issues: stepIssues[1].map((i) => i.msg) },
                    { label: 'Cover and riders chosen', issues: stepIssues[2].map((i) => i.msg) },
                    { label: 'Nominees valid (shares total 100%, any minor has an appointee)', issues: stepIssues[3].map((i) => i.msg) },
                    { label: 'Health and Section 45 declarations made by you', issues: stepIssues[4].map((i) => i.msg) },
                    { label: 'You signed the proposal (demo e-sign)', issues: esignValid ? [] : ['Not signed yet.'] },
                    { label: 'First premium paid (demo payment)', issues: paymentValid ? [] : ['Not paid yet.'] },
                  ].map((c) => (
                    <li key={c.label} className="flex items-start gap-2">
                      <span className={c.issues.length ? 'text-amber-600' : 'text-emerald-600'}>{c.issues.length ? '!' : '✓'}</span>
                      <span className="text-slate-700">
                        {c.label}
                        {c.issues.map((m) => (
                          <span key={m} className="block text-amber-700">{m}</span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-slate-500">Nothing here is decided for you: you make the declarations, sign and pay.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button onClick={downloadDraftSummary} className="px-3 py-1 rounded-lg bg-white border border-slate-300 font-semibold">
                    Download proposed policy (draft)
                  </button>
                  <button
                    onClick={async () => {
                      setMode('guardian');
                      await loadGuardianDoc('draft');
                    }}
                    className="px-3 py-1 rounded-lg bg-[#582be8] text-white font-semibold"
                  >
                    Review it with Integrity Guardian
                  </button>
                  <span className="text-[11px] text-slate-500">A proposed policy generated from your application, not an issued policy and not proof of insurance.</span>
                </div>
              </div>

              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs text-slate-700">
                <div className="flex justify-between pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Policyholder Name:</span>
                  <span className="font-bold text-slate-900">{profile.fullName || 'Ramesh Shankar Thorat'}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Date of Birth:</span>
                  <span className="font-bold text-slate-900">{profile.dob || '14/05/1994'}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Base Life Protection Cover:</span>
                  <span className="font-bold text-slate-900">
                    {baseSumAssured === '1cr' ? '₹1.00 Crore' : baseSumAssured === '1.5cr' ? '₹1.50 Crore' : '₹2.00 Crore'}</span>
                </div>
                {selectedRiders.criticalIllness && (
                  <div className="flex justify-between text-[#582be8] font-medium pb-2 border-b border-slate-200">
                    <span>+ Critical Illness Cover:</span>
                    <span>{ciTier === 'tier1' ? '₹10,00,000 (Tier 1 Silver)' : ciTier === 'tier3' ? '₹50,00,000 (Tier 3 Platinum)' : '₹25,00,000 (Tier 2 Gold)'}</span>
                  </div>
                )}
                {selectedRiders.accidentalDeath && (
                  <div className="flex justify-between text-[#582be8] font-medium pb-2 border-b border-slate-200">
                    <span>+ Accidental Disability Cover:</span>
                    <span>{atpdOption === 'income' ? '₹1 Lakh/mo for 100 Months (Salary Replacement)' : '₹50,00,000 Lump Sum'}</span>
                  </div>
                )}
                {lifeStageEscalator && (
                  <div className="flex justify-between text-[#582be8] font-medium pb-2 border-b border-slate-200">
                    <span>+ Life Stage Cover Escalator:</span>
                    <span>Active (+10% Annual Cover Boost)</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-700 pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Designated Nominee & Trust:</span>
                  <span className="font-bold text-slate-900">
                    {nomination.primaryName ? nomineeSummary : `Priya Ramesh Thorat (${nomination.primaryRelation}, ${nomination.primaryShare}%)`}
                    {nomination.mwpaTrustEnabled ? ' • MWPA Trust Shield Active' : ''}</span>
                </div>

                <div className="border-t border-slate-300 pt-3 flex justify-between items-baseline text-sm font-bold text-slate-900">
                  <span>Total Monthly Premium (no GST on life cover):</span>
                  <span className="text-xl font-bold text-[#582be8] tabular-nums">₹{totalMonthlyPayable}/mo</span>
                </div>
              </div>

              {policyIssued ? (
                <div className="p-6 rounded-2xl bg-emerald-50 border border-emerald-300 text-center flex flex-col items-center gap-3">
                  <div className="size-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xl shadow-sm">
                    ✓
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-emerald-950">NexaSure Policy Issued Successfully!</h3>
                    <p className="text-xs tabular-nums text-emerald-800 mt-1">
                      Policy Certificate ID: <strong className="text-slate-900 font-bold">{proposalId}</strong>
                    </p>
                  </div>
                  <p className="text-xs text-slate-600 max-w-md">
                    Your lifelong rate of ₹{totalMonthlyPayable}/month is locked. Official policy certificate dispatched to your registered email.
                  </p>
                  {policyCard.status === 'ready' && policyCard.dataUrl ? (
                    <div className="w-full max-w-md flex flex-col items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={policyCard.dataUrl} alt="Policy summary card generated by Meta Muse Image"className="w-full rounded-xl border border-emerald-200 shadow-sm" />
                      <span className="text-[11px] tabular-nums text-emerald-700">
                        Policy card rendered by Meta Muse Image 1.0 in {policyCard.ms} ms (pre-generated on the last step)</span>
                      <a
                        href={policyCard.dataUrl}
                        download={`${proposalId || 'policy'}-card`}
                        className="mt-1 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all shadow-sm"
                      >
                         Download Policy Card
                      </a>
                    </div>
                  ) : policyCard.status === 'generating' ? (
                    <div className="w-full max-w-md aspect-square rounded-xl border border-emerald-200 bg-white/60 animate-pulse flex items-center justify-center text-xs text-emerald-800">
                      Meta Muse Image is rendering your policy card…
                    </div>
                  ) : policyCard.status === 'error' ? (
                    <p className="text-[11px] text-red-700">Policy card failed (Meta API, no fallback): {policyCard.error}</p>
                  ) : null}
                  <button
                    onClick={handleDownloadAuditCertificate}
                    className="mt-1 px-5 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <span></span>
                    <span>Download Application Guardian Audit Certificate</span>
                  </button>
                </div>
              ) : (
                <>
                {/* 1. E-sign the proposal */}
                <div id="card-esign" className={`p-4 rounded-xl border space-y-3 ${esignValid ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">1. E-sign your proposal {esignValid ? '✓' : ''}</h3>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">Demo e-sign: no Aadhaar OTP, not legally binding</span>
                  </div>
                  {esignValid ? (
                    <div className="text-xs text-emerald-900 space-y-1">
                      <div className="font-bold">Signed by {esign.typedName.trim()} on {esign.signedAt ? new Date(esign.signedAt).toLocaleString() : ''}</div>
                      <div className="font-mono text-[11px] break-all text-slate-500">Signature hash: {esign.hash}</div>
                      <button type="button" onClick={() => setEsign((e) => ({ ...e, signedAt: null, hash: null, fingerprint: null }))} className="underline text-[11px]">Sign again</button>
                    </div>
                  ) : (
                    <>
                      {esign.signedAt && <p className="text-xs font-semibold text-amber-700">Your details changed after you signed, so please sign again.</p>}
                      <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={esign.consent} onChange={(e) => setEsign((s2) => ({ ...s2, consent: e.target.checked, error: null }))} className="mt-0.5 size-4 rounded text-[#582be8]" />
                        <span>I declare that the information in this proposal is true and complete, and I understand that wrong or hidden facts can let the insurer reject a claim (Insurance Act section 45). I agree to sign electronically.</span>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                        <div>
                          <label className="text-[11px] font-semibold text-slate-700 block mb-1">Type your full name to sign</label>
                          <input
                            type="text"
                            value={esign.typedName}
                            onChange={(e) => setEsign((s2) => ({ ...s2, typedName: e.target.value, error: null }))}
                            placeholder={profile.fullName || 'Your full name'}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-medium"
                          />
                          {esign.typedName && (
                            <div className="mt-1 text-xl text-slate-800" style={{ fontFamily: '"Snell Roundhand","Brush Script MT",cursive' }}>{esign.typedName}</div>
                          )}
                        </div>
                        <button type="button" onClick={signProposal} className="px-5 py-2.5 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs">Sign (demo)</button>
                      </div>
                      {esign.error && <p className="text-xs text-red-600 font-medium">{esign.error}</p>}
                    </>
                  )}
                </div>

                {/* 2. Pay the first premium */}
                <div id="card-payment" className={`p-4 rounded-xl border space-y-3 ${paymentValid ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-white'} ${esignValid ? '' : 'opacity-60'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">2. Pay your first premium {paymentValid ? '✓' : ''}</h3>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">Demo checkout: no real money is taken</span>
                  </div>
                  {paymentValid ? (
                    <div className="text-xs text-emerald-900 space-y-0.5">
                      <div className="font-bold">₹{payment.amount} received · transaction {payment.txnId}</div>
                      <div className="text-slate-500">{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : ''} · {payment.mode === 'upi' ? 'UPI' : payment.mode === 'card' ? 'Card' : payment.mode === 'netbanking' ? 'Net banking' : 'Monthly auto-pay'}</div>
                    </div>
                  ) : (
                    <>
                      {payment.status === 'paid' && <p className="text-xs font-semibold text-amber-700">The premium changed after you paid, so please pay again.</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        {([['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Net banking'], ['autopay', 'Monthly auto-pay']] as const).map(([m, label]) => (
                          <button
                            key={m}
                            type="button"
                            disabled={!esignValid}
                            onClick={() => setPayment((pm) => ({ ...pm, mode: m }))}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${payment.mode === m ? 'bg-[#582be8] border-[#582be8] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-slate-600">First month's premium: <strong className="text-slate-900 tabular-nums">₹{totalMonthlyPayable}</strong>. Your cover starts once the first premium is received.</span>
                        <button
                          type="button"
                          disabled={!esignValid || payment.status === 'processing'}
                          onClick={payFirstPremium}
                          className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {payment.status === 'processing' ? 'Processing…' : `Pay ₹${totalMonthlyPayable} (demo)`}
                        </button>
                      </div>
                      {!esignValid && <p className="text-[11px] text-slate-500">Sign the proposal first.</p>}
                    </>
                  )}
                </div>

                <div className="flex flex-wrap justify-between items-center gap-3 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveStep(4)}
                      className="px-5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50"
                    >
                      ← Back to Step 4: Medical
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTermsDrawer(true)}
                      className="px-4 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-300 font-bold text-xs flex items-center gap-1.5 transition-all"
                      title="Review all statutory Terms & Conditions before binding"
                    >
                      <span>Review Terms (T&C)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadAuditCertificate}
                      className="px-4 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold text-xs flex items-center gap-1.5 transition-all"
                      title="Download Application Guardian Audit Certificate"
                    >
                      <span>Audit Certificate</span>
                    </button>
                  </div>
                  <button
                    onClick={submitPolicyProposal}
                    disabled={!esignValid || !paymentValid}
                    title={!esignValid || !paymentValid ? 'Sign the proposal and pay the first premium first' : undefined}
                    className="px-7 py-3.5 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm & Lock Policy (₹{totalMonthlyPayable}/mo)
                  </button>
                </div>
                </>
              )}
            </div>
          )}

        </div>

        {/* Right Sticky Sidebar: Premium Breakdown & Docked OmniCB Advisor */}
        <div className="min-h-0 overflow-y-auto flex flex-col gap-3">
          
          {/* Premium Breakdown Card */}
          <div className="nx-card p-3 shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Premium Summary</h3>
              <button
                type="button"
                onClick={() => setShowPremiumDetail((v) => !v)}
                className="text-[11px] text-slate-500 hover:text-[#582be8]"
              >
                {showPremiumDetail ? 'Hide breakdown ▾' : 'Breakdown ▸'}
              </button>
            </div>
            <div className="flex items-baseline justify-between mt-0.5 font-sans">
              <span className="flex items-baseline gap-2">
                <span className="font-bold text-sm text-[#111827]">Monthly Payable:</span>
                <span className="text-2xl font-bold text-[#582be8] tabular-nums">₹{totalMonthlyPayable}</span>
              </span>
              <span className="text-[11px] text-emerald-700">
                est. tax saving <span className="font-bold tabular-nums">₹{annualTaxSavings}</span>/yr
              </span>
            </div>
            {showPremiumDetail && (<>
            <div className="space-y-2 text-xs tabular-nums text-slate-600 mt-2 pt-2 border-t border-slate-100">
              <div className="flex justify-between">
                <span>Base Cover ({baseSumAssured === '1cr' ? '₹1 Cr' : baseSumAssured === '1.5cr' ? '₹1.5 Cr' : '₹2 Cr'}):</span>
                <span className="text-slate-900 font-semibold">₹{monthlyBase}</span>
              </div>

              {selectedRiders.criticalIllness && (
                <div className="flex justify-between text-[#582be8]">
                  <span>+ Critical Illness (₹25L):</span>
                  <span>+₹149</span>
                </div>
              )}

              {selectedRiders.accidentalDeath && (
                <div className="flex justify-between text-[#582be8]">
                  <span>+ Accidental Cover:</span>
                  <span>+₹79</span>
                </div>
              )}

              {selectedRiders.waiverOfPremium && (
                <div className="flex justify-between text-[#582be8]">
                  <span>+ Premium Waiver:</span>
                  <span>+₹42</span>
                </div>
              )}

              {selectedRiders.hospitalCash && (
                <div className="flex justify-between text-[#582be8]">
                  <span>+ Hospital Cash:</span>
                  <span>+₹55</span>
                </div>
              )}

              <div className="flex justify-between text-slate-500 pt-2 border-t border-slate-100">
                <span>Subtotal:</span>
                <span>₹{subtotalMonthly}</span>
              </div>

              <div className="flex justify-between text-slate-500">
                <span>GST on individual life cover:</span>
                <span>Exempt</span>
              </div>

            </div>
            <div className="mt-2">
            {/* Feature 1: Illustrative tax & net cost widget */}
            <div className="p-3 rounded-2xl bg-white border border-slate-200 text-slate-800 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm"></span>
                  <button type="button" onClick={() => setShowTaxBreakdownWidget((v) => !v)} className="text-xs font-bold text-emerald-950 hover:text-[#582be8]">Tax & Net Cost (estimate) {showTaxBreakdownWidget ? '▾' : '▸'}</button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowEvidenceDrawer(true)}
                    className="text-[11px] text-[#582be8] hover:underline font-bold"
                  >
                    View Clause 7.3 
                  </button>
                  <span className="text-[11px] tabular-nums font-bold px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Illustrative</span>
                </div>
              </div>

              {showTaxBreakdownWidget && (<>
              <div className="grid grid-cols-2 gap-2 text-[11px] pt-0.5">
                <div className="p-2 rounded-xl bg-white/90 border border-emerald-100">
                  <span className="text-[11px] text-slate-500 block">Gross Premium:</span>
                  <strong className="text-xs text-slate-900 font-bold tabular-nums">₹{totalMonthlyPayable}/mo</strong>
                  <span className="text-[11px] text-slate-400 block tabular-nums">(₹{(totalMonthlyPayable * 12).toLocaleString()}/yr)</span>
                </div>
                <div className="p-2 rounded-xl bg-emerald-100/70 border border-emerald-200">
                  <span className="text-[11px] text-emerald-700 block font-semibold">Total Tax Saved:</span>
                  <strong className="text-xs text-emerald-900 font-bold tabular-nums">
                    -₹{annualTaxSavings.toLocaleString()}/yr
                  </strong>
                  <span className="text-[11px] text-emerald-700 block font-bold">
                    Old regime, 31.2% slab</span>
                </div>
              </div>

              <div className="p-2 rounded-xl bg-white border border-emerald-200 flex justify-between items-center text-[11px]">
                <div>
                  <span className="text-[11px] text-slate-500 block">Net Effective Cost:</span>
                  <strong className="text-sm font-bold text-[#582be8] tabular-nums">
                    ₹{Math.round(Math.max(0, (totalMonthlyPayable * 12) - annualTaxSavings) / 12)}/mo
                  </strong>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-bold text-emerald-700 block">
                    Saves about {Math.round((annualTaxSavings / (totalMonthlyPayable * 12)) * 100)}%</span>
                  <span className="text-[11px] text-slate-400 tabular-nums">after tax refund</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 leading-tight">
                Illustrative only. Applies to the old tax regime; rider tax treatment depends on the rider terms. Not tax advice.
              </p>
            </>)}
            </div>

            </div>
            </>)}
          </div>

          {/* DOCKED OMNICB CO-BROWSE AGENT (MINIMAL: CONTROLS & TRANSCRIPT ONLY) */}
          <div className="nx-card p-3 rounded-2xl flex flex-col gap-2 bg-white flex-1 min-h-[300px] overflow-y-auto [&>*]:shrink-0">
            
            {/* Header with Connection Status & Connect/Disconnect Button */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className={`size-9 rounded-xl flex items-center justify-center text-white font-bold text-xs ${mode === 'guardian' ? 'bg-teal-700' : 'bg-[#582be8]'}`}>
                  {mode === 'guardian' ? 'IG' : 'OB'}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#111827]" data-agent-role={agentRole}>{mode === 'guardian' ? 'Integrity Guardian' : 'OmniCB Co-Browse'}</h4>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {isCoBrowsingConnected ? (
                      <span className="text-emerald-600 font-bold flex items-center gap-1">
                        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {mode === 'guardian' ? 'Live voice & document review' : 'Live voice & form sync'}</span>
                    ) : (
                      <span className="text-slate-400">Disconnected</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Connect / Disconnect Action Button */}
              {isCoBrowsingConnected ? (
                <button
                  onClick={() => disconnectCoBrowsingSession()}
                  className="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs border border-red-200 transition-all flex items-center gap-1.5"
                >
                  <span></span>
                  <span>Disconnect</span>
                </button>
              ) : (
                <button
                  onClick={connectCoBrowsingSession}
                  disabled={isConnecting}
                  className="px-3 py-1.5 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <span></span>
                  <span>{isConnecting ? 'Connecting...' : 'Connect'}</span>
                </button>
              )}
            </div>

            {/* Collapsible session controls: sharing, control, language, voice, accent */}
            <button
              type="button"
              onClick={() => setShowSessionControls((v) => !v)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] transition-all"
            >
              <span className="font-bold text-slate-700">Session controls</span>
              <span className="flex items-center gap-2 text-slate-500">
                <span className="truncate">
                  {selectedLanguage === 'en' ? 'English' : selectedLanguage === 'hi' ? 'हिंदी' : 'मराठी'} · {selectedVoicePersona.charAt(0).toUpperCase() + selectedVoicePersona.slice(1)}
                  {selectedLanguage === 'en' ? ` · ${englishAccent === 'us' ? 'US' : 'Indian'}` : ''}
                  {isSharingPaused ? ' · sharing paused' : ''}
                  {screenControlStatus === 'granted' ? ' · control on' : ''}
                </span>
                <span>{showSessionControls ? '▾' : '▸'}</span>
              </span>
            </button>

            {showSessionControls && (
            <div className="flex flex-col gap-2">
            {/* Essential Screen Controls Row */}
            <div className="grid grid-cols-2 gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px]">
              {/* Screen Share Toggle */}
              <button
                onClick={() => setIsSharingPaused(!isSharingPaused)}
                disabled={!isCoBrowsingConnected}
                className={`p-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all ${
                  !isCoBrowsingConnected
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : isSharingPaused
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-white hover:bg-purple-100 text-slate-800 border border-purple-200'
                }`}
              >
                <span>{isSharingPaused ? 'Resume sharing' : 'Pause sharing'}</span>
              </button>

              {/* Remote Control Toggle */}
              <button
                onClick={() => {
                  if (screenControlStatus === 'granted') {
                    revokeScreenControl();
                  } else {
                    grantScreenControl();
                  }
                }}
                disabled={!isCoBrowsingConnected}
                className={`p-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all ${
                  !isCoBrowsingConnected
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : screenControlStatus === 'granted'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white hover:bg-purple-100 text-slate-800 border border-purple-200'
                }`}
              >
                <span>{screenControlStatus === 'granted' ? 'Control Active' : 'Grant Control'}</span>
              </button>
            </div>

            {/* Language Selection */}
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px]">
              <span className="text-slate-600 font-medium">Language:</span>
              <div className="flex gap-1">
                {(['en', 'hi', 'mr'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => handleLanguageChange(l)}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                      selectedLanguage === l
                        ? 'bg-[#582be8] text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {l === 'en' ? 'English' : l === 'hi' ? 'हिंदी' : 'मराठी'}
                  </button>
                ))}
              </div>
            </div>

            {/* Curated Best Neural Voices */}
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px]">
              <span className="text-slate-600 font-medium">Voice:</span>
              <div className="flex gap-1">
                {[
                  { id: 'veena', label: 'Veena', sub: 'Female Indian Accent Advisor' },
                  { id: 'rishi', label: 'Rishi', sub: 'Male Indian Accent Advisor' },
                  { id: 'nova', label: 'Nova', sub: 'Warm Natural Advisor' },
                  { id: 'aura', label: 'Aura', sub: 'Executive AI Tone' },
                ].map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setSelectedVoicePersona(v.id as any);
                      playChime();
                    }}
                    title={v.sub}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                      selectedVoicePersona === v.id
                        ? 'bg-[#582be8] text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Spoken-output engine. Google is the default; Meta MMS is experimental (local server, slower, one voice per language). */}
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px]">
              <span className="text-slate-600 font-medium">TTS:</span>
              <div className="flex gap-1">
                {([
                  ['google', 'Google'],
                  ['meta-mms', 'Meta MMS (Experimental)'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={id === 'meta-mms'}
                    aria-disabled={id === 'meta-mms'}
                    title={id === 'meta-mms' ? 'Experimental and not enabled in this demo: voice is Google Cloud TTS' : 'Google Cloud TTS'}
                    onClick={() => {
                      if (id === 'meta-mms') return;
                      setTtsProvider(id);
                      ttsProviderRef.current = id;
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                      id === 'meta-mms'
                        ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                        : ttsProvider === id ? 'bg-[#582be8] text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* English accent (Hindi / Marathi use their own hi-IN / mr-IN voices) */}
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px]">
              <span className="text-slate-600 font-medium">English accent:</span>
              <div className="flex gap-1">
                {([
                  ['in', 'Indian'],
                  ['us', 'US'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setEnglishAccent(id);
                      playChime();
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                      englishAccent === id ? 'bg-[#582be8] text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {/* What the agent sees: exactly what is sent to Muse Spark, with a pause control */}
            <div className="rounded-xl bg-slate-50 text-slate-800 border border-slate-200 overflow-hidden">
              <button type="button"onClick={() => setShowAgentView((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold">
                <span>What the agent sees</span>
                <span className="font-normal text-slate-400">{agentFrameLabel} {showAgentView ? '▾' : '▸'}</span>
              </button>
              {showAgentView && (
                <div className="px-3 pb-3 flex flex-col gap-2 text-[11px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-slate-400 mb-1">Last frame sent{agentView.step ? `(step ${agentView.step})` : ''}</div>
                      {agentView.frameDataUrl ? (
                        <button
                          type="button"
                          onClick={() => setShowAgentFrameModal(true)}
                          title="Open full size"
                          className="group relative w-full rounded-lg border border-slate-200 bg-white overflow-hidden cursor-zoom-in"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={agentView.frameDataUrl} alt="The reduced-size frame of this form last sent to the agent" className="w-full block" />
                          <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-bold py-1 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                            Click to view full size
                          </span>
                        </button>
                      ) : (
                        <div className="w-full aspect-[4/3] rounded-lg border border-dashed border-slate-200 flex items-center justify-center text-slate-500">
                          {isCoBrowsingConnected ? 'Sent on step changes' : 'Not connected'}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-slate-400 mb-1">Form details sent</div>
                      <ul className="space-y-0.5 text-slate-700">
                        {agentDetailLines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                        <li className="text-slate-400">Not sent: Aadhaar, PAN and mobile numbers (masked placeholders only)</li>
                      </ul>
                    </div>
                  </div>
                  {kycRedaction?.redactedDataUrl && (
                    <div className="text-slate-400">Document read by the agent: the version shown in the privacy shield above, with photos, signatures, QR codes and ID numbers pixelated.</div>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setIsSharingPaused((p) => !p)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${isSharingPaused ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-slate-900'}`}
                    >
                      {isSharingPaused ? 'Resume sharing' : 'Pause sharing'}
                    </button>
                    <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
                      <input type="checkbox"checked={showDevPanel} onChange={(e) => setShowDevPanel(e.target.checked)} className="accent-[#582be8]" />
                      Under the hood (models, timings)
                    </label>
                  </div>
                  <p className="text-slate-500 leading-tight">Frames are reduced-size snapshots taken when you change steps, not a video stream. Pausing stops frames and form details from being sent; voice stays on.</p>
                </div>
              )}
            </div>

            </div>
            )}

            {/* Two-Way Conversational Voice Mic Button */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={toggleVoiceListening}
                className={`w-full py-3 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2.5 shadow-sm ${
                  !isCoBrowsingConnected
                    ? 'bg-slate-100 hover:bg-purple-50 text-slate-700 border border-purple-200'
                    : isListeningVoice
                    ? 'bg-red-600 hover:bg-red-700 text-white ring-4 ring-red-400/40 animate-pulse'
                    : voiceThinking
                    ? 'bg-amber-600 text-white animate-pulse'
                    : isSpeaking
                    ? 'bg-purple-700 text-white ring-2 ring-purple-300'
                    : 'bg-[#582be8] hover:bg-[#481dd4] text-white'
                }`}
              >
                {(isListeningVoice || isSpeaking) && (
                  <div className="flex items-center gap-1 h-3.5">
                    <span className="w-1 bg-white rounded-full eq-bar-1" />
                    <span className="w-1 bg-white rounded-full eq-bar-2" />
                    <span className="w-1 bg-white rounded-full eq-bar-3" />
                  </div>
                )}
                <span>{!isCoBrowsingConnected
                    ? 'Start a session to talk'
                    : isListeningVoice
                    ? 'Listening hands-free (click to stop)'
                    : voiceThinking
                    ? 'Meta Muse Spark Reasoning...'
                    : isSpeaking
                    ? 'Agent Speaking… (click to interrupt)'
                    : 'Start Live Voice (Meta ASR)'}</span>
              </button>

              {micPermissionError && (
                <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px]"> {micPermissionError}</div>
              )}

              {showDevPanel && (prefetchInfo || verifications.length > 0 || memoryFacts.length > 0) && (
                <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700 flex flex-col gap-1">
                  {memoryFacts.length > 0 && (
                    <div>
                      <span className="font-bold">Customer memory</span> <span className="text-slate-400">({memoryFacts.length} facts, SQLite, extracted by Muse Spark)</span>
                      <ul className="list-disc pl-4">
                        {memoryFacts.slice(-3).map((f, i) => (
                          <li key={i} className="truncate">{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {prefetchInfo && (
                    <div>
                      <span className="font-bold"> Pre-answered by Muse Spark</span> <span className="text-slate-400">({prefetchInfo.ms} ms, step {prefetchInfo.step ?? '?'})</span>
                      <ul className="list-disc pl-4">
                        {prefetchInfo.questions.map((q, i) => (
                          <li key={i} className="truncate">{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {verifications.slice(-2).map((v) => (
                    <div key={v.id} className="truncate">
                      <span className="font-bold"> Muse Wonder</span> {v.status === 'pending' ? 'verifying…' : v.status} · {v.actionTitle}
                      {v.reason ? ` — ${v.reason}` : ''}
                    </div>
                  ))}
                </div>
              )}

              {/* Dynamic Mic Decibel Level & Transcript */}
              {isListeningVoice && (
                <div className="px-2 py-1 rounded-xl bg-red-50 border border-red-200 text-red-950 text-[11px] flex flex-col gap-0.5">
                  <div className="flex items-center gap-2 text-[11px] text-red-700 tabular-nums font-bold">
                    <span className="size-1.5 rounded-full bg-red-500 animate-ping" />
                    <span>MIC</span>
                    <div className="flex-1 h-1.5 rounded-full bg-red-200 overflow-hidden">
                      <div
                        ref={micDecibelBarRef}
                        className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-600 transition-all duration-75"
                        style={{ width: '10%' }}
                      />
                    </div>
                    <span ref={micDecibelTextRef}>0%</span>
                  </div>
                  <p className="text-[11px] text-red-900 truncate">
                    {voiceTranscriptLive ? `"${voiceTranscriptLive}"` : 'Listening to your voice now...'}
                  </p>
                  {showDevPanel && (
                  <p className="text-[11px] text-red-700/80 tabular-nums leading-tight">
                    ASR {voiceTelemetry.asrModel || '…'}
                    {voiceTelemetry.sparkTtftMs !== null
                      ? ` • Spark first token ${voiceTelemetry.sparkTtftMs} ms, total ${voiceTelemetry.sparkTotalMs} ms (${voiceTelemetry.reasoningEffort})`
                      : ''}
                    {voiceTelemetry.ttsMs !== null ? ` • Google TTS ${voiceTelemetry.ttsMs} ms (${voiceTelemetry.ttsVoice})` : ''}
                  </p>
                  )}
                </div>
              )}
            </div>

            {/* Live Conversation Transcript */}
            <div className="flex flex-col flex-1 min-h-[90px]">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 pb-1.5 border-b border-slate-100">
                <span>Conversation Transcript</span>
                <span className="text-[11px] font-normal text-slate-400">{chatMessages.length} entries</span>
              </div>
              
              <div ref={chatBottomRef} className="flex-1 min-h-0 overflow-y-auto space-y-2 py-2 pr-1 text-xs">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-xl leading-relaxed ${
                      msg.sender === 'agent'
                        ? 'bg-slate-50 text-slate-800 border border-slate-200'
                        : 'bg-purple-50/60 text-slate-900 ml-6 border border-purple-100'
                    }`}
                  >
                    <div className="flex justify-between text-[11px] text-slate-400 tabular-nums mb-1">
                      <span className="font-bold">{msg.sender === 'agent' ? 'OmniCB Agent' : 'You'}</span>
                      <span>{msg.time}</span>
                    </div>
                    <p>{msg.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Ask Question Input with Mic Button */}
            <div className="pt-2 border-t border-slate-100 flex gap-2 items-center">
              <div className="relative flex-1">
                <input
                  data-testid="ask-input"
                  type="text"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAskAgent();
                  }}
                  placeholder={
                    selectedLanguage === 'hi'
                      ? 'माइक से बोलें या प्रश्न लिखें...'
                      : selectedLanguage === 'mr'
                      ? 'माईक द्वारे बोला किंवा प्रश्न टाईप करा...'
                      : 'Ask a question or speak via mic...'
                  }
                  className="w-full pl-3 pr-9 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#582be8]"
                />
                <button
                  type="button"
                  onClick={toggleVoiceListening}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full transition-all ${
                    isListeningVoice ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-[#582be8]'
                  }`}
                  title="Speak your question using microphone"
                >
                  
                </button>
              </div>

              <button
                data-testid="ask-button"
                onClick={handleAskAgent}
                disabled={!userQuery.trim()}
                className="px-3.5 py-2 rounded-xl bg-[#582be8] hover:bg-[#481dd4] disabled:opacity-50 text-white font-bold text-xs transition-all flex items-center gap-1"
              >
                <span>Ask</span>
              </button>
            </div>

          </div>

        </div>
        </div>
      </main>

      {/* 5. Pure Co-Browsing: Agent Remote Virtual Cursor */}
      {agentCursor.visible && (
        <div
          className="agent-cursor"
          style={{ left: `${agentCursor.x}px`, top: `${agentCursor.y}px` }}
        >
          <div className="relative">
            {/* Sleek SVG Cursor Pointer */}
            <svg
              className={`w-7 h-7 text-[#582be8] filter drop- shadow-sm transition-transform duration-150 ${
                agentCursor.clicking ? 'scale-75' : 'scale-100'
              }`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M4 0l16 12.279-6.951 1.17 4.325 8.817-3.596 1.734-4.35-8.879-5.428 5.428v-20.549z" />
            </svg>
            {/* Agent Avatar Badge & Action Tooltip */}
            <div className="absolute left-6 top-3 bg-[#1e104f] text-white text-[11px] font-sans px-2.5 py-1.5 rounded-lg shadow-sm border border-purple-400 whitespace-nowrap flex flex-col gap-0.5">
              <span className="font-bold flex items-center gap-1.5 text-purple-300">
                <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
                <span>{agentCursor.label}</span></span>
              <span className="text-[11px] text-white font-medium">{agentCursor.actionDesc}</span>
            </div>
          </div>
        </div>
      )}

      {/* Click Ripple Indicators */}
      {clickIndicators.map((ind) => (
        <div
          key={ind.id}
          className="agent-click-indicator"
          style={{ left: `${ind.x}px`, top: `${ind.y}px` }}
        />
      ))}

      {/* 6. Meta Multimodal Architecture & Video Pipeline Inspector Modal */}
      {showArchInspector && (
        <div className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-sm border border-purple-200 flex flex-col">
            
            {/* Modal Header */}
            <div className="p-6 bg-[#180d40] text-white rounded-t-3xl flex items-center justify-between border-b border-purple-900">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-2xl bg-[#582be8] flex items-center justify-center font-bold text-base shadow-sm">
                  OB
                </div>
                <div>
                  <h3 className="text-base font-bold">Meta AI Multimodal Co-Browsing Architecture</h3>
                  <p className="text-xs text-purple-300">Real-Time Screen/Video Feed Perception & Dual-Cursor Pipeline</p>
                </div>
              </div>
              <button
                onClick={() => setShowArchInspector(false)}
                className="size-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-bold text-sm transition-all"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 text-xs text-slate-700">
              
              {/* Section 1: Meta Models Table */}
              <div>
                <h4 className="text-sm font-bold text-[#111827] mb-2 flex items-center gap-2">
                  <span>1.</span>
                  <span>Which model does what</span>
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-800 font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Meta Model / Technology</th>
                        <th className="p-3">What it does here</th>
                        <th className="p-3">Where it is used</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        { name: 'Muse Spark 1.3', tag: 'Meta Model API', does: 'Reads the form state, a screenshot of the form and the passages found for the question, answers in English, Hindi or Marathi and returns one allowed action.', role: 'Replies for both agents; reads documents after the private parts are hidden; finds ID numbers on blurred copies; writes underwriter case notes.' },
                        { name: 'Muse Spark Open', tag: 'Open weights, served on Modal', does: 'Reads a whole masked policy document in one call and returns its sections, coverage, exclusions, the facts it states and questions to put to the insurer.', role: 'Integrity Guardian document review only. It is not on the live voice path, and if it is unavailable the review shows an error.' },
                        { name: 'Muse Wonder', tag: 'Meta Model API', does: 'Checks each action the agent took against what the customer said: approve, amend, reject, or ask for one more detail. Rejected actions are reverted.', role: 'Action verifier, and the narrative in the audit certificate.' },
                        { name: 'Muse Voice Transcribe', tag: 'Meta Model API', does: 'Real-time speech to text for English, Hindi and Marathi from the customer microphone.', role: 'Customer voice in. The session is reopened before its 60 minute limit.' },
                        { name: 'SAM 3.1', tag: 'Meta Model API', does: 'Finds the photo, signature and QR code on heavily blurred copies of an ID card.', role: 'Privacy shield: the original image stays in the browser and the browser hides those areas before anything reads the card.' },
                        { name: 'Muse Image', tag: 'Meta Model API', does: 'Generates the personalised policy summary card.', role: 'Policy card at the end of the application.' },
                        { name: 'Google Cloud Text-to-Speech', tag: 'Not a Meta model', does: 'Speaks the agents\' replies. Meta has no text-to-speech model, so this is the one outside voice service.', role: 'Voice out. The two agents use different voices.' },
                        { name: 'Muse Glimmer and Muse Code', tag: 'Not used', does: 'Muse Glimmer (open weights for local agents) is not part of this product. Muse Code is a coding tool and is not part of the product either.', role: 'None.' },
                      ].map((r) => (
                        <tr key={r.name} className="hover:bg-slate-50/50 align-top">
                          <td className="p-3 font-bold text-[#582be8]">
                            <span>{r.name}</span>
                            <div><span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-normal">{r.tag}</span></div>
                          </td>
                          <td className="p-3">{r.does}</td>
                          <td className="p-3">{r.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 2: How a turn works */}
              <div>
                <h4 className="text-sm font-bold text-[#111827] mb-2 flex items-center gap-2">
                  <span>2.</span>
                  <span>What happens on each turn</span>
                </h4>
                <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-center text-[11px]">
                    <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-900">
                      <div className="text-emerald-700 font-bold mb-1">1. Voice in</div>
                      <span>Microphone audio goes over WebRTC to the agent; Muse Voice Transcribe turns it into text.</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-900">
                      <div className="text-amber-700 font-bold mb-1">2. Reason</div>
                      <span>Muse Spark gets the form state, a screenshot and a few retrieved passages, and replies with one allowed action.</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-900">
                      <div className="text-purple-700 font-bold mb-1">3. Check</div>
                      <span>The step gate and Muse Wonder check the action; material answers wait for your Confirm.</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#582be8]/30 border border-purple-500">
                      <div className="text-white font-bold mb-1">4. Act and speak</div>
                      <span>The form is updated with a visible second cursor and the reply is spoken by Google text-to-speech.</span>
                    </div>
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-slate-300 text-[11px] font-sans pt-1">
                    <li><strong>What the model receives:</strong> the form values as JSON, a reduced-size picture of the form (identity-number fields left out), and only the passages that match your question. Aadhaar, PAN and mobile numbers you type are never sent.</li>
                    <li><strong>Documents:</strong> the original stays in your browser. Only heavily blurred copies, where text cannot be read, go to Meta's locator models; the reader then gets the image with those areas pixelated. Name, date of birth, address and PIN stay readable on that image and do go to Meta.</li>
                    <li><strong>Two agents:</strong> the co-browsing agent fills the application; Integrity Guardian reviews the proposed policy with its own prompt, knowledge base and voice and never changes the application.</li>
                    <li><strong>Your control:</strong> pause sharing or revoke control at any time (ESC); you make the declarations, sign and pay yourself.</li>
                  </ul>
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 rounded-b-3xl border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowArchInspector(false)}
                className="px-5 py-2 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs transition-all"
              >
                Close Inspector
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Feature 2: Interactive Policy Evidence Drawer (Visual Grounding Proof) */}
      {showEvidenceDrawer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end transition-opacity">
          <div className="w-full max-w-xl bg-white h-full shadow-sm flex flex-col p-6 overflow-y-auto animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl"></span>
                <div>
                  <h3 className="text-sm font-bold text-slate-950">Official Policy Evidence Viewer</h3>
                  <p className="text-[11px] text-slate-500 tabular-nums">Demo product, not a registered plan • NexaSure Flexi Shield</p>
                </div>
              </div>
              <button
                onClick={() => setShowEvidenceDrawer(false)}
                className="size-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center transition-all"
              >
                ✕
              </button>
            </div>

            {/* Clause Selector Tabs */}
            <div className="flex gap-1.5 my-3 overflow-x-auto pb-1 text-xs">
              {Object.entries(POLICY_EVIDENCE_CLAUSES).map(([key, item]) => (
                <button
                  key={key}
                  onClick={() => setSelectedEvidenceClause(key)}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all text-[11px] ${
                    selectedEvidenceClause === key
                      ? 'bg-[#582be8] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {item.clauseId}
                </button>
              ))}
            </div>

            {/* Rendered Document View */}
            {POLICY_EVIDENCE_CLAUSES[selectedEvidenceClause] && (
              <div className="flex-1 flex flex-col gap-4">
                <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 flex flex-col gap-2">
                  <div className="flex justify-between items-center text-[11px] text-amber-900 tabular-nums">
                    <span className="font-bold">{POLICY_EVIDENCE_CLAUSES[selectedEvidenceClause].document}</span>
                    <span>Page {POLICY_EVIDENCE_CLAUSES[selectedEvidenceClause].page}</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900">{POLICY_EVIDENCE_CLAUSES[selectedEvidenceClause].title}</h4>
                  
                  {/* Highlighted Yellow Text Excerpt */}
                  <div className="p-3.5 rounded-xl bg-amber-100/90 border-l-4 border-amber-500 text-xs text-slate-950 leading-relaxed font-serif">
                    "{POLICY_EVIDENCE_CLAUSES[selectedEvidenceClause].highlightedText}"
                  </div>

                  <p className="text-[11px] text-amber-950 font-medium">
                     <strong>Plain English Explanation:</strong> {POLICY_EVIDENCE_CLAUSES[selectedEvidenceClause].summary}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-center gap-2">
                  <span className="text-base"></span>
                  <span><strong>Source:</strong> wording follows IRDAI's master circulars. NexaSure is a fictional demo product, so this is not a filed policy contract.</span>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowEvidenceDrawer(false)}
                className="px-5 py-2 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs"
              >
                Close Evidence Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feature 5: Application Guardian Audit Certificate Modal */}
      {/* Full-size view of the last frame sent to Muse Spark */}
      {showAgentFrameModal && (
        <div
          className="fixed inset-0 z-[99998] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowAgentFrameModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900">What the agent sees</h3>
                <p className="text-[11px] text-slate-500">
                  Reduced-size frame sent to Muse Spark{agentView.step ? ` on step ${agentView.step}` : ''} · {agentFrameLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAgentFrameModal(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold"
              >
                Close
              </button>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_280px]">
              <div className="min-h-0 overflow-auto bg-slate-100 p-3 flex items-start justify-center">
                {agentView.frameDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={agentView.frameDataUrl} alt="Full-size view of the frame last sent to the agent" className="max-w-full h-auto rounded-lg border border-slate-200 bg-white shadow" />
                ) : (
                  <div className="text-slate-500 text-sm py-20">No frame has been sent yet.</div>
                )}
              </div>
              <div className="border-t lg:border-t-0 lg:border-l border-slate-200 p-4 text-[12px] overflow-auto">
                <div className="text-slate-400 font-bold uppercase tracking-wider text-[10px] mb-2">Form details sent</div>
                <ul className="space-y-1 text-slate-700">
                  {agentDetailLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="mt-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] leading-snug">
                  Form details and screenshots contain only masked placeholders for Aadhaar, PAN and mobile numbers. A document you choose to scan is read separately, with photos, signatures, QR codes and ID numbers pixelated first.
                </div>
                <p className="mt-3 text-slate-500 text-[11px] leading-snug">
                  Frames are taken when you change steps, not streamed. Pause sharing stops frames and form details; voice stays on.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAuditCertModal && auditCertData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-sm border border-slate-200 p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl"></span>
                <div>
                  <h3 className="text-base font-bold text-slate-950">Application Guardian Audit Certificate</h3>
                  <p className="text-xs text-slate-500 tabular-nums">Legal Non-Repudiation & Transparency Record</p>
                </div>
              </div>
              <button
                onClick={() => setShowAuditCertModal(false)}
                className="size-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center transition-all"
              >
                ✕
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="flex justify-between items-center text-[11px] pb-2 border-b border-slate-200">
                <span className="text-slate-500 tabular-nums">Certificate Hash:</span>
                <span className="font-bold text-purple-700 tabular-nums">{auditCertData.certificateId}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Applicant:</span>
                  <strong className="text-slate-900">{auditCertData.applicant.legalName}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Date of Birth:</span>
                  <strong className="text-slate-900">{auditCertData.applicant.dateOfBirth}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Sum Assured:</span>
                  <strong className="text-slate-900">{auditCertData.coverageSchedule.baseSumAssured}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Total Monthly Payable:</span>
                  <strong className="text-[#582be8]">{auditCertData.coverageSchedule.totalMonthlyPayable}</strong>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-purple-50/80 border border-purple-200 text-[11px] text-purple-950">
                <strong>Statutory Compliance Check:</strong> {auditCertData.statutoryCompliance.section45InsuranceAct1938}
              </div>

              <div className="p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200 text-[11px] text-emerald-950">
                <strong>Tax Optimization:</strong> {auditCertData.taxOptimizationSummary.totalAnnualTaxSaved}, illustrative, old regime only. Not tax advice.
              </div>

              <div className="p-2 rounded-lg bg-slate-100 text-[11px] text-slate-600 tabular-nums">
                SHA-256 Non-Repudiation Hash: {auditCertData.auditNonRepudiation.sha256VerificationHash}
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-emerald-700 font-bold flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                Certificate File Saved to Downloads</span>
              <button
                onClick={() => setShowAuditCertModal(false)}
                className="px-5 py-2 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs"
              >
                Close Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feature 6: Statutory Terms & Conditions Interactive Drawer */}
      {showTermsDrawer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end transition-opacity">
          <div className="w-full max-w-2xl bg-white h-full shadow-sm flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-blue-900 via-indigo-900 to-[#180d40] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-xl bg-blue-600/80 flex items-center justify-center text-lg shadow-sm border border-blue-400/30">
                  
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Statutory Terms & Conditions (T&C)</span>
                    <span className="text-[11px] tabular-nums px-2 py-0.5 rounded-lg bg-blue-500/30 text-blue-200 border border-blue-400/40">
                      Demo product</span>
                  </h3>
                  <p className="text-[11px] text-blue-200/80">Verbatim legal clauses, exclusions, grace periods, and incontestability rules</p>
                </div>
              </div>
              <button
                onClick={() => setShowTermsDrawer(false)}
                className="size-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold transition-all"
              >
                ✕
              </button>
            </div>

            {/* Search & Quick Filter */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col gap-2.5">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search clauses (e.g. Section 45, Grace Period, Suicide, Free-Look, PED)..."
                  value={termsSearchQuery}
                  onChange={(e) => setTermsSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#582be8] focus:border-[#582be8] bg-white"
                />
                <span className="absolute left-3 top-2.5 text-xs text-slate-400"></span>
                {termsSearchQuery && (
                  <button
                    onClick={() => setTermsSearchQuery('')}
                    className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Quick Voice Question Prompts */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Ask OmniCB:</span>
                {[
                  'What is the 30-day Free-Look?',
                  'What is Section 45?',
                  'What is the Grace Period?',
                  'What is the Suicide Clause?',
                ].map((prompt, pIdx) => (
                  <button
                    key={pIdx}
                    type="button"
                    onClick={() => {
                      setUserQuery(prompt);
                      processUserSpokenQuestion(prompt);
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-white hover:bg-purple-50 text-[#582be8] border border-purple-200 font-semibold transition-all"
                  >
                     {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Clauses List */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
              {TERMS_AND_CONDITIONS_CLAUSES
                .filter(
                  (c) =>
                    c.title.toLowerCase().includes(termsSearchQuery.toLowerCase()) ||
                    c.summary.toLowerCase().includes(termsSearchQuery.toLowerCase()) ||
                    c.fullText.toLowerCase().includes(termsSearchQuery.toLowerCase()) ||
                    c.category.toLowerCase().includes(termsSearchQuery.toLowerCase())
                )
                .map((c) => (
                  <div
                    key={c.id}
                    id={`clause-${c.id}`}
                    className={`p-4 rounded-xl border transition-all space-y-2 ${
                      highlightedClause === c.id
                        ? 'border-[#582be8] ring-2 ring-[#582be8]/60 bg-purple-50/60 shadow-md'
                        : 'border-slate-200 bg-white hover:border-[#582be8]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] tabular-nums font-bold px-2 py-0.5 rounded-md bg-purple-50 text-[#582be8] border border-purple-200">
                        {c.clauseNumber} • {c.category}</span>
                      {highlightedClause === c.id && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#582be8] text-white">Being explained</span>
                      )}
                      <span className="text-[11px] tabular-nums text-slate-400">{c.irdaiRef}</span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-900">{c.title}</h4>
                    <p className="text-xs text-slate-600 leading-relaxed font-medium bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      {c.summary}
                    </p>
                    <div className="text-[11px] text-slate-500 italic border-l-2 border-[#582be8] pl-3 py-0.5">
                      "{c.fullText}"
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const askQuery = `Please explain ${c.title} in simple terms.`;
                        processUserSpokenQuestion(askQuery);
                      }}
                      className="text-[11px] font-bold text-[#582be8] hover:underline flex items-center gap-1 pt-1"
                    >
                      <span>Hear OmniCB Voice Explanation</span>
                      <span>→</span>
                    </button>
                  </div>
                ))}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Statutory Compliance: Insurance Regulatory & Development Authority of India (IRDAI)</span>
              <button
                onClick={() => setShowTermsDrawer(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-900 text-white text-xs font-bold transition-all"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Footer */}
      <footer className="shrink-0 bg-[#1e104f] text-white text-[10px] px-4 lg:px-6 py-1 border-t border-[#2d1b70]">
        <div className="w-full flex items-center justify-between gap-3">
          <span
            className="truncate text-purple-300/80"
            title="NexaSure is a fictional AI-first digital insurance company created for a hackathon demo. NexaSure Flexi Shield is a sample term life product, not a registered insurance plan, and nothing here is an offer of insurance. Insurance is the subject matter of solicitation."
          >
            NexaSure · AI-first digital insurance company · Demo product, not a real insurer or offer · Insurance is the subject matter of solicitation
          </span>
          <span className="shrink-0 text-purple-300">Powered by Meta Model API</span>
        </div>
      </footer>

    </div>
  );

  if (presenterMode) {
    return (
      <div className="flex h-screen overflow-hidden bg-[#0d0921]">
        <div className="flex-1 min-w-0 overflow-hidden">{pageContent}</div>
        <PresenterPanel turns={turns} memoryFacts={memoryFacts} agentState={agentState} stats={sessionStats} usage={modelUsage} cases={cases} onDownloadCase={downloadCase} />
      </div>
    );
  }

  return pageContent;
}
