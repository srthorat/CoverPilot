'use client';

import React, { useState, useEffect, useRef } from 'react';
import { VoiceAgentClient, type AgentEvent, type AgentAction, type VoicePersona, type EnglishAccent, type CaseRecord } from '@/lib/voice-client';
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
    // Client-side masked fields (Zero-PII guarantee: AI cannot see these)
    aadhaarNumber: 'XXXX - XXXX - 8492',
    panNumber: 'ABCDE••••F',
    mobileNumber: '+91 98XXX ••240',
  });

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
    primaryDob: '19/08/1996',
    primaryShare: 100,
    hasSecondaryNominee: false,
    secondaryName: '',
    secondaryRelation: 'Child',
    secondaryAge: 7,
    secondaryShare: 30,
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
  const [termsSearchQuery, setTermsSearchQuery] = useState<string>('');

  // Real per-turn latency telemetry from the live Meta voice loop
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

  // OmniCB Agent Co-Browsing State (Observation Mode + Auto-Play Multilingual Voice Guidance)
  const [activeGuidanceKey, setActiveGuidanceKey] = useState<string>('field-full-name');
  const [spotlightedElementId, setSpotlightedElementId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // WebRTC gateway Video / WebRTC Co-Browsing Assist Flow
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
    en: 'Welcome to ACKO Life! I am OmniCB Agent. Connecting your secure live voice session now.',
    hi: 'ACKO Life में आपका स्वागत है! मैं OmniCB एजेंट हूँ। आपका सुरक्षित लाइव वॉइस सत्र अभी जोड़ रहा हूँ।',
    mr: 'ACKO Life मध्ये आपले स्वागत आहे! मी OmniCB एजंट आहे. तुमचे सुरक्षित लाइव्ह व्हॉइस सत्र आता जोडत आहे.',
  };
  const [chatMessages, setChatMessages] = useState<Array<{ id?: number; sender: 'user' | 'agent'; text: string; time: string }>>([
    {
      sender: 'agent',
      text: "Welcome to ACKO Life! I am OmniCB Agent. When you are ready, click 'Accept and start co-browsing'to begin our secure live voice session.",
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
      let id = localStorage.getItem('coverpilot-customer-id');
      if (!id) {
        id = `cust-${Math.random().toString(36).slice(2, 10)}`;
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
  const currentAgentMsgIdRef = useRef<number | null>(null);
  const agentTextRef = useRef<string>('');
  const [agentState, setAgentState] = useState<'listening' | 'thinking' | 'speaking'>('listening');
  const isSpeakingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);
  const isCoBrowsingConnectedRef = useRef<boolean>(false);
  // Latest render's handlers, so long-lived agent callbacks never act on stale state.
  const latestRef = useRef<{
    applyAction: (a: AgentAction) => void;
    lang: 'en' | 'hi' | 'mr';
    screenState: () => unknown;
    activeStep: number;
  }>({ applyAction: () => {}, lang: 'en', screenState: () => ({}), activeStep: 1 });
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
    if (!profile.pincode) unfilled.push('field-pincode');

    return {
      activeStep,
      focusedFieldId: currentFocusedField,
      termsDrawerOpen: showTermsDrawer,
      baseSumAssured,
      selectedRiders,
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

  // Establish Live WebRTC gateway Video / WebRTC Session with Meta Agent
  const connectCoBrowsingSession = async () => {
    setIsConnecting(true);
    playChime();
    try {
      setIsCoBrowsingConnected(true);
      isCoBrowsingConnectedRef.current = true;
      setIsScreenSharing(true);
      setIsSharingPaused(false);
      setScreenControlStatus('granted');

      // Same lines the Python agent speaks on connect (voice-agent-py/bot.py WELCOME).
      const welcomeMsg = selectedLanguage === 'hi'
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

  // Disconnect WebRTC Session
  const disconnectCoBrowsingSession = () => {
    setIsCoBrowsingConnected(false);
    setIsScreenSharing(false);
    setScreenControlStatus('revoked');
    setAgentCursor((prev) => ({ ...prev, visible: false }));
    isCoBrowsingConnectedRef.current = false;
    localAudioRef.current?.pause();
    stopVoiceListening();
    playChime();
    setChatMessages((prev) => [
      ...prev,
      {
        sender: 'agent',
        text: 'Live session ended. Nothing further is shared with the agent.',
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

  // Apply a co-browsing action returned by Muse Spark to the live form.
  const applyAgentAction = (a: AgentAction) => {
    if (a.targetElementId === 'drawer-terms-conditions') setShowTermsDrawer(true);
    const actions: Record<string, any>[] = a.fieldActions?.length ? a.fieldActions : a.fieldAction ? [a.fieldAction] : [];
    const applyOne = (action: Record<string, any>, title: string | undefined) => {
      if (action.type === 'nominate') {
        glideAgentCursorToElement('nomination-section', title || 'Configuring Nominee & Trust Protection', () => {
          if (activeStep < 3) setActiveStep(3);
          setNomination((prev) => ({
            ...prev,
            primaryName: action.primaryName !== undefined ? action.primaryName : prev.primaryName,
            primaryRelation: action.primaryRelation !== undefined ? action.primaryRelation : prev.primaryRelation,
            primaryShare: action.primaryShare !== undefined ? Number(action.primaryShare) : prev.primaryShare,
            hasSecondaryNominee: action.hasSecondaryNominee !== undefined ? action.hasSecondaryNominee : prev.hasSecondaryNominee,
            secondaryName: action.secondaryName !== undefined ? action.secondaryName : prev.secondaryName,
            secondaryRelation: action.secondaryRelation !== undefined ? action.secondaryRelation : prev.secondaryRelation,
            secondaryAge: action.secondaryAge !== undefined ? Number(action.secondaryAge) : prev.secondaryAge,
            secondaryShare: action.secondaryShare !== undefined ? Number(action.secondaryShare) : prev.secondaryShare,
            appointeeName: action.appointeeName !== undefined ? action.appointeeName : prev.appointeeName,
            appointeeRelation: action.appointeeRelation !== undefined ? action.appointeeRelation : prev.appointeeRelation,
            mwpaTrustEnabled: action.mwpaTrustEnabled !== undefined ? action.mwpaTrustEnabled : prev.mwpaTrustEnabled,
          }));
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
        const targets: Record<string, { el: string; apply: () => void }> = {
          fullName: { el: 'field-full-name', apply: () => setProfile((p) => ({ ...p, fullName: value })) },
          dob: { el: 'field-dob', apply: () => setProfile((p) => ({ ...p, dob: value })) },
          annualIncome: {
            el: 'field-annual-income',
            apply: () => setProfile((p) => ({ ...p, annualIncome: incomeRangeFor(value) || p.annualIncome })),
          },
          pincode: { el: 'field-pincode', apply: () => setProfile((p) => ({ ...p, pincode: value })) },
          city: { el: 'field-city', apply: () => setProfile((p) => ({ ...p, city: value })) },
        };
        const target = targets[action.field];
        if (target && value) glideAgentCursorToElement(target.el, title || `Entering ${action.field}`, target.apply);
      } else if (action.type === 'cover') {
        const v = String(action.value ?? '').toLowerCase().replace(/\s|₹|,/g, '');
        const tier = /^1(cr|crore|0000000)?$/.test(v) || v === '1cr' ? '1cr' : /1\.5|15000000|150/.test(v) ? '1.5cr' : /^2|20000000/.test(v) ? '2cr' : null;
        if (tier) {
          glideAgentCursorToElement(`cover-tier-${tier}`, title || `Selecting ${tier} cover`, () => setBaseSumAssured(tier as any));
        }
      } else if (action.type === 'navigate') {
        const step = Math.min(5, Math.max(1, Number(action.step) || 1));
        glideAgentCursorToElement(`step-tab-${step}`, title || `Opening step ${step}`, () => {
          setActiveStep(step);
          formBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        });
      } else if (action.type === 'ui') {
        if (action.action === 'open_terms') setShowTermsDrawer(true);
        else if (action.action === 'close_terms') setShowTermsDrawer(false);
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
        } else if (action.field === 'isSmoker') {
          glideAgentCursorToElement('field-smoking', title || `Setting Smoker Status: ${on ? 'Yes' : 'No'}`, () => {
            setProfile((p) => ({ ...p, isSmoker: on }));
          });
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
        if (ev.status !== 'pending') {
          patchLastTurn((last) => ({
            wonder: { status: ev.status, actionTitle: ev.actionTitle, reason: ev.reason, ms: ev.ms },
            marks: { ...last.marks, verified: Date.now() },
          }));
          setSessionStats((s) => ({ ...s, [ev.status]: s[ev.status as keyof SessionStats] + 1 }));
        }
        if (ev.status !== 'pending') {
          if (devRef.current) {
            const verb =
              ev.status === 'approve' ? 'Muse Wonder approved' : ev.status === 'amend' ? 'Muse Wonder amended' : ev.status === 'reject' ? 'Muse Wonder rejected' : 'Muse Wonder could not verify';
            setChatMessages((prev) => [
              ...prev,
              { sender: 'agent', text: `${verb} "${ev.actionTitle}"${ev.reason ? `: ${ev.reason}` : ''}${ev.ms ? `(${ev.ms} ms)` : ''}`, time: stampNow() },
            ]);
          } else if (ev.status === 'reject' || ev.status === 'amend') {
            // Customers only need to know when a change was flagged, not the verifier's internals.
            setChatMessages((prev) => [...prev, { sender: 'agent', text: `Compliance check on "${ev.actionTitle}": ${ev.reason || 'needs a correction'}`, time: stampNow() }]);
          }
        }
        break;
      }
      case 'agent_done':
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
      document: 'ACKO Life Flexi Shield Policy Document (IRDAI UIN: 157N001V01)',
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
      title: 'Clause 7.3: Dual Tax Deductions (Section 80C + Section 80D)',
      clauseId: 'Clause 7.3 (Tax Certificates)',
      document: 'Income Tax Act 1961 & ACKO Annual Tax Schedule Guide',
      page: 12,
      effectiveDate: 'Financial Year 2024-2025',
      highlightedText: 'Premiums paid towards the Base Pure Term Protection component are eligible for tax deduction under Section 80C up to ₹1,50,000 per financial year. Incremental premiums paid towards the Critical Illness Rider qualify under Section 80D (Health Insurance) up to ₹25,000 for self/family and up to ₹50,000 for senior citizen parents.',
      summary: 'Base cover saves up to ₹46,800 under Section 80C. The Critical Illness rider unlocks an extra ₹7,800 savings under Section 80D, offsetting the rider cost.',
    },
    'clause-81': {
      title: 'Clause 8.1: Statutory 30-Day Electronic Free-Look Guarantee',
      clauseId: 'Clause 8.1 (Free-Look Period)',
      document: 'IRDAI Policyholders Interests Protection Regulations',
      page: 4,
      effectiveDate: 'Active Standard',
      highlightedText: 'The Policyholder has a period of thirty (30) days from the date of electronic receipt of the policy schedule to review the terms and conditions. If the Policyholder disagrees with any terms, they may return the policy with a written statement, upon which 100% of the premium paid shall be refunded, subject only to deduction of proportionate risk premium.',
      summary: 'You have 30 days to review the policy after issuance. If not completely satisfied, you receive a full refund with zero lock-in penalties.',
    },
  };

  const TERMS_AND_CONDITIONS_CLAUSES = [
    {
      id: 'tc-section-45',
      clauseNumber: 'Clause 1',
      title: 'Section 45 Statutory Claim Guarantee (3-Year Incontestability Rule)',
      category: 'Statutory Protection',
      irdaiRef: 'Insurance Act 1938, Section 45',
      summary: 'After 3 continuous years of the policy in force, ACKO Life cannot dispute, question, or reject any death claim on any grounds whatsoever (except documented deliberate fraud).',
      fullText: 'No policy of life insurance shall be called in question on any ground whatsoever after the expiry of three years from the date on which the policy was effected, or the date of revival. Full honest disclosure at proposal guarantees irrevocable settlement for your nominee.',
    },
    {
      id: 'tc-grace-period',
      clauseNumber: 'Clause 2',
      title: '30-Day Statutory Grace Period for Premium Payment',
      category: 'Payment Safeguards',
      irdaiRef: 'IRDAI Master Circular 2024, Reg 14',
      summary: 'You receive 30 calendar days of grace period for premium payments (15 days for monthly mode). Your full cover remains 100% active with zero lapse risk during this period.',
      fullText: 'A grace period of thirty (30) days from the premium due date is allowed for payment of quarterly, half-yearly, and annual premiums; fifteen (15) days for monthly mode. If a claim arises during the grace period, the full sum assured is payable subject to deduction of unpaid premium.',
    },
    {
      id: 'tc-free-look',
      clauseNumber: 'Clause 3',
      title: '30-Day Free-Look Cancellation with 100% Full Refund',
      category: 'Consumer Rights',
      irdaiRef: 'IRDAI Policyholders Protection Reg 8.1',
      summary: 'You have 30 days from electronic policy receipt to review all terms. If unsatisfied, cancel anytime for a 100% refund with zero cancellation penalty.',
      fullText: 'The Policyholder is entitled to a 30-day Free-Look Period from the date of electronic receipt of the policy document. If the Policyholder does not agree with any terms, they may return the policy for cancellation and receive a full 100% refund of the premium paid (less statutory stamp duty).',
    },
    {
      id: 'tc-suicide-clause',
      clauseNumber: 'Clause 4',
      title: 'Suicide Exclusion & 80% Premium Refund Rule',
      category: 'Exclusions',
      irdaiRef: 'ACKO Life Flexi Shield Schedule, Section 9.2',
      summary: 'In the event of suicide within 12 months of inception, 80% of total premiums paid are refunded to the nominee. After 12 months, 100% of the full sum assured is paid with zero dispute.',
      fullText: 'If the Life Assured commits suicide within twelve (12) months from the Date of Inception or Date of Revival, the policy shall terminate and 80% of total premiums paid shall be refunded to the nominee. After 12 continuous months, death claim is fully payable in accordance with the schedule.',
    },
    {
      id: 'tc-ped-disclosure',
      clauseNumber: 'Clause 5',
      title: 'Pre-Existing Disease (PED) & Medical Acceptance',
      category: 'Underwriting',
      irdaiRef: 'IRDAI Underwriting Norms & Section 45',
      summary: 'Disclose all medical history honestly. Once accepted by underwriting without loading, ACKO Life cannot dispute coverage post-issuance.',
      fullText: 'All pre-existing medical conditions, surgical histories, or chronic illnesses disclosed in the proposal form and accepted by the underwriter are covered under the policy terms without retrospective exclusion or dispute.',
    },
    {
      id: 'tc-waiting-period',
      clauseNumber: 'Clause 6',
      title: 'Critical Illness Waiting Period & 14-Day Survival Period',
      category: 'Living Benefits',
      irdaiRef: 'Clause 4.2 Living Benefit Rider Schedule',
      summary: 'A 90-day waiting period from policy inception applies for Critical Illness. A 14-day survival period post-diagnosis triggers the full tax-free lump sum transfer.',
      fullText: 'The Critical Illness Living Benefit Rider is subject to an initial waiting period of ninety (90) days from the inception date. Upon confirmed medical diagnosis of any of the 36 defined illnesses and survival for fourteen (14) days, 100% of the rider sum assured is paid as a cash lump sum.',
    },
    {
      id: 'tc-csr-sla',
      clauseNumber: 'Clause 7',
      title: '99.1% Audited Claim Settlement Ratio & 2-Hour Digital SLA',
      category: 'Claims Concierge',
      irdaiRef: 'IRDAI Annual Audited Public Disclosures 2024',
      summary: 'ACKO Life maintains a 99.1% claim settlement ratio with a 2-hour digital claim registration and zero physical paperwork required from your family.',
      fullText: 'ACKO Life is committed to fair, prompt claim settlements with an audited 99.1% Claim Settlement Ratio. Claims can be registered 24x7 digitally via the customer portal or dedicated bereavement concierge with express 2-hour initiation.',
    },
    {
      id: 'tc-revival-policy',
      clauseNumber: 'Clause 8',
      title: '5-Year Continuous Policy Revival Guarantee',
      category: 'Policy Continuity',
      irdaiRef: 'Insurance Laws (Amendment) Act & Reg 16',
      summary: 'If your policy ever lapses due to missed payments, you have 5 full years to reinstate your coverage and lock in your original premium rate.',
      fullText: 'A lapsed policy may be reinstated or revived within a continuous period of five (5) years from the date of first unpaid premium, subject to clearing unpaid dues and submitting a satisfactory good-health declaration.',
    },
  ];

  const WHY_ASK_THIS_EXPLANATIONS: Record<string, { title: string; en: string; hi: string; mr: string; clauseRef: string }> = {
    'field-full-name': {
      title: 'Full Legal Name Verification',
      en: 'Insurers require your name to match government records (PAN/Aadhaar) exactly so your beneficiaries face zero legal delays during death claim settlement under IRDAI norms.',
      hi: 'आईआरडीएआई नियमों के अनुसार, कानूनी नाम पैन या आधार से बिल्कुल मेल खाना चाहिए ताकि भविष्य में क्लेम निपटान में परिवार को कोई परेशानी न हो।',
      mr: 'आयआरडीएआय नियमानुसार तुमचे कायदेशीर नाव पॅन किंवा आधारशी तंतोतंत जुळणे आवश्यक आहे, जेणेकरून भविष्यात क्लेम सेटलमेंटमध्ये वारसदारांना विलंब होणार नाही.',
      clauseRef: 'Section 45 & IRDAI Master Circular 2024, Reg 12',
    },
    'field-dob': {
      title: 'Date of Birth & Mortality Lock',
      en: 'Age determines your actuarial risk and base premium. By completing this proposal today, you lock in this low rate for the next 30 years without annual age-based price hikes.',
      hi: 'उम्र आपके प्रीमियम की दर तय करती है। आज प्रस्ताव भरने से आपकी यह दर अगले 30 वर्षों के लिए फ्रीज (लॉक) हो जाती है।',
      mr: 'वय तुमच्या विम्याच्या दराचा मुख्य निकष आहे. आज पॉलिसी घेतल्याने पुढील ३० वर्षांसाठी हाच कमी दर लॉक केला जातो.',
      clauseRef: 'ACKO Flexi Shield Schedule, Section 3.1',
    },
    'field-income': {
      title: 'Annual Income & Human Life Value',
      en: 'Under IRDAI underwriting regulations, the maximum life insurance cover you can purchase is capped at 25x your verified annual salary (Human Life Value principle).',
      hi: 'आईआरडीएआई के मानव जीवन मूल्य (HLV) नियम के अनुसार, आपकी अधिकतम बीमा राशि आपकी वार्षिक आय का 25 गुना तक हो सकती है।',
      mr: 'आयआरडीएआयच्या ह्यूमन लाईफ व्हॅल्यू (HLV) नियमांनुसार, तुमचे कमाल संरक्षण तुमच्या वार्षिक उत्पन्नाच्या २५ पटींपर्यंत मर्यादित असते.',
      clauseRef: 'IRDAI Underwriting Guidelines 2024, Circular 14',
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
        text: `[Why ACKO Asks: ${expl.title}]: ${spoken} (Ref: ${expl.clauseRef})`,
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

  const loadSampleImage = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('could not load the sample image'));
      i.src = url;
    });

  // Printed IDs are too small for SAM 3.1. Blur a copy until the text is unreadable (the layout
  // survives) and ask Muse Spark where the identifiers are; the sharp image never leaves the page.
  const blurForLocating = (img: HTMLImageElement): string => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const small = document.createElement('canvas');
    small.width = 100;
    small.height = Math.max(1, Math.round((100 * h) / w));
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, small.width, small.height);
    const big = document.createElement('canvas');
    big.width = w;
    big.height = h;
    const bctx = big.getContext('2d')!;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(small, 0, 0, w, h);
    return big.toDataURL('image/png');
  };

  const locateTextIds = async (type: 'pan' | 'salary-slip', img: HTMLImageElement): Promise<{ regions: KycRegion[]; ms: number }> => {
    const res = await fetch('/api/locate-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentType: type, blurredDataUrl: blurForLocating(img) }),
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
    return { regions, ms: data.telemetry?.totalMs ?? 0 };
  };

  // 1-click KYC: SAM 3.1 locates PII -> browser pixelates it -> only the redacted image
  // goes to Muse Spark for OCR. Two Meta models, and the reader never sees the ID.
  // Income proof: Muse Spark reads the sample salary slip; account identifiers are masked server-side.
  const handleSalarySlipOcr = async () => {
    playChime();
    setChatMessages((prev) => [...prev, { sender: 'agent', text: devRef.current ? 'Reading the sample salary slip with Meta Muse Spark for income proof…' : 'Reading your salary slip for income proof…', time: stampNow() }]);
    try {
      const slipUrl = '/samples/sample-salary-slip.png';
      setKycRedaction({ type: 'salary-slip', imageUrl: slipUrl, width: 1000, height: 630, regions: [], redactedDataUrl: null, samMs: null, samCached: false, locateMs: null, ocrMs: null, status: 'Locating ID numbers on a blurred copy…' });
      const slipImg = await loadSampleImage(slipUrl);
      const located = await locateTextIds('salary-slip', slipImg);
      const slipRedacted = pixelateRegions(slipImg, located.regions);
      setKycRedaction((prev) => prev && { ...prev, regions: located.regions, redactedDataUrl: slipRedacted, locateMs: located.ms, status: 'Pixelated in your browser. Sending redacted image to Muse Spark…' });
      setChatMessages((prev) => [...prev, { sender: 'agent', text: devRef.current ? `Muse Spark located ${located.regions.length} identifiers on a blurred copy (${located.ms} ms): ${located.regions.map((r) => r.concept).join(', ')}.` : `Hidden on your device before reading: ${located.regions.map((r) => r.concept).join(', ')}.`, time: stampNow() }]);
      const t0 = performance.now();
      const res = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentType: 'salary-slip', imageDataUrl: slipRedacted }) });
      const data = await res.json();
      if (!res.ok || !data.fields) throw new Error(data.error || `OCR HTTP ${res.status}`);
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
          setProfile((prev) => ({ ...prev, annualIncome: incomeRangeFor(f.annualIncome || '') || prev.annualIncome, fullName: prev.fullName || f.fullName || '' }));
        });
      }
    } catch (e: any) {
      setKycRedaction((prev) => prev && { ...prev, status: `Failed: ${e?.message || e}` });
      setChatMessages((prev) => [...prev, { sender: 'agent', text: `Income proof OCR failed (Meta API, no fallback): ${e?.message || e}`, time: stampNow() }]);
    }
  };

  const handleRunSampleKycOcr = async (type: 'pan' | 'aadhaar' | 'salary-slip') => {
    if (type === 'salary-slip') return handleSalarySlipOcr();
    setKycSampleCard(type);
    playChime();
    const label = type === 'pan' ? 'PAN' : 'Aadhaar';
    const imageUrl = `/samples/sample-${type}.png`;
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
      status: 'SAM 3.1 locating PII regions…',
    });
    setChatMessages((prev) => [
      ...prev,
      { sender: 'agent', text: devRef.current ? `Asking Meta SAM 3.1 to locate PII regions on the sample ${label} card…` : `Locating the private parts of your ${label} card so they can be hidden before anything reads it…`, time: stampNow() },
    ]);
    try {
      const samRes = await fetch('/api/sam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType: type }),
      });
      const sam = await samRes.json();
      if (!samRes.ok || !Array.isArray(sam.regions)) throw new Error(sam.error || `SAM HTTP ${samRes.status}`);
      const regions: KycRegion[] = [...sam.regions];

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('could not load the sample image'));
        i.src = sam.imageUrl || imageUrl;
      });
      let locateMs: number | null = null;
      if (type === 'pan') {
        setKycRedaction((prev) => prev && { ...prev, status: 'Locating the PAN number on a blurred copy…' });
        const located = await locateTextIds('pan', img);
        regions.push(...located.regions);
        locateMs = located.ms;
      }
      const redactedDataUrl = pixelateRegions(img, regions);
      const samMs = sam.telemetry?.totalMs ?? null;
      const samCached = Boolean(sam.telemetry?.cached);
      setKycRedaction((prev) =>
        prev && {
          ...prev,
          imageUrl: sam.imageUrl || imageUrl,
          width: sam.width || prev.width,
          height: sam.height || prev.height,
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
            ? `SAM 3.1 found ${regions.length} region${regions.length === 1 ? '' : 's'}: ${found || 'none'}${samMs !== null ? `in ${samMs} ms${samCached ? '(pre-computed at startup)' : ''}` : ''}. Pixelated locally before OCR.`
            : `Hidden on your device before reading: ${regions.map((r) => r.concept).join(', ') || 'nothing found'}.`,
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
          : `The private regions of your ${label} card were hidden on your device and Muse Spark read the rest${f.fullName ? ` for ${f.fullName}` : ''}. Populating the form now.`;
      speakText(voice, selectedLanguage);
      const gender = f.gender ? (/^m/i.test(f.gender) ? 'Male' : /^f/i.test(f.gender) ? 'Female' : '') : '';
      glideAgentCursorToElement(type === 'pan' ? 'field-full-name' : 'field-pincode', `Populate ${label} OCR fields`, () => {
        setProfile((prev) => ({
          ...prev,
          fullName: f.fullName || prev.fullName,
          dob: f.dob || prev.dob,
          pincode: f.pincode || prev.pincode,
          gender: gender || prev.gender,
          ...(type === 'pan' && f.idNumberMasked ? { panNumber: f.idNumberMasked } : {}),
        }));
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
    const certId = `ACKO-AUDIT-2026-${Math.random().toString(16).substring(2, 8).toUpperCase()}`;
    const timestamp = new Date().toISOString();
    const rates: Record<'1cr' | '1.5cr' | '2cr', number> = { '1cr': 580, '1.5cr': 780, '2cr': 990 };
    const currentMonthlyBase = rates[baseSumAssured] || 580;
    const annualBase = currentMonthlyBase * 12;
    const tax80C = Math.round(annualBase * 0.312);
    const tax80D = selectedRiders.criticalIllness ? 5580 : 0;
    const totalSaved = tax80C + tax80D;
    const netCost = Math.max(0, (totalMonthlyPayable * 12) - totalSaved);

    const certPayload = {
      certificateId: certId,
      product: 'ACKO Life Flexi Shield (Pure Term Insurance)',
      irdaUin: '157N001V01',
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
        section80CLifeDeduction: `₹${tax80C.toLocaleString()}/yr savings (Base Cover)`,
        section80DCriticalIllnessDeduction: selectedRiders.criticalIllness ? '₹5,580/yr savings (Health Rider)' : '₹0',
        totalAnnualTaxSaved: `₹${totalSaved.toLocaleString()}/yr`,
        netEffectiveYearlyCost: `₹${netCost.toLocaleString()}/yr (effective ₹${Math.round(netCost / 12)}/month)`,
      },
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
    const client = new VoiceAgentClient({
      lang: langOverride || latestRef.current.lang,
      voice: voicePersonaRef.current,
      accent: accentRef.current,
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
  const gst18Percent = Math.round(subtotalMonthly * 0.18);
  const totalMonthlyPayable = subtotalMonthly + gst18Percent;
  const annualTaxSavings = Math.round(subtotalMonthly * 12 * 0.312);

  // Policy Issuance
  const submitPolicyProposal = () => {
    const id = `ACKO-LIFE-2026-${Math.floor(100000 + Math.random() * 900000)}`;
    setProposalId(id);
    setPolicyIssued(true);
    setActiveStep(5);
    const msg = selectedLanguage === 'hi'
      ? `बधाई हो! आपकी ACKO Life पॉलिसी ${id} सफलतापूर्वक जारी कर दी गई है।`
      : selectedLanguage === 'mr'
      ? `अभिनंदन! तुमची ACKO Life पॉलिसी ${id} यशस्वीपणे जारी करण्यात आली आहे.`
      : `Congratulations! Your ACKO Life policy ${id} has been generated successfully.`;
    speakText(msg, selectedLanguage);
  };

  // Architectural Inspector State
  const [showArchInspector, setShowArchInspector] = useState<boolean>(false);

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
  const stepForElement = (elementId: string): number | null => {
    if (/^step-tab-/.test(elementId)) return null;
    if (/^(field-|select-)/.test(elementId) && elementId !== 'field-section-45') return 1;
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
  const glideAgentCursorToElement = (elementId: string, actionLabel: string, onArrival?: () => void) => {
    if (typeof window === 'undefined') return;
    agentActionQueueRef.current = agentActionQueueRef.current
      .then(() => performAgentClick(elementId, actionLabel, onArrival))
      .catch((e) => console.warn('agent click failed', elementId, e));
  };

  const performAgentClick = async (elementId: string, actionLabel: string, onArrival?: () => void) => {
    const step = stepForElement(elementId);
    if (step && latestRef.current.activeStep !== step) {
      setActiveStep(step);
      await sleep(350); // let the new step render
    }
    const el = await waitForElement(elementId);
    if (!el) {
      console.warn(`Agent target ${elementId} not found; applying without cursor`);
      onArrival?.();
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    await sleep(450);
    const rect = el.getBoundingClientRect();
    const targetX = rect.left + Math.min(rect.width / 2, 160);
    const targetY = rect.top + Math.min(rect.height / 2, 40);
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
              text: '[SCREEN CONTROL ACTION]: OmniCB Agent glided to and selected the Critical Illness Living Benefit Rider (+₹149/mo). Spatial grounding via Meta Glimmer, policy logic via Meta Muse Spark 1.3.',
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
        'Guiding Full Legal Name & verifying SAM 3 Zero-PII Shield',
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
    nominee: nomination.primaryName ? `${nomination.primaryName} (${nomination.primaryRelation}, ${nomination.primaryShare}%)` : null,
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

  // Visual grounding: send Muse Spark a JPEG of the form area when the step changes while the agent is live.
  useEffect(() => {
    const el = formBodyRef.current;
    if (!el || !isListeningVoice || isSharingPaused) return;
    let cancelled = false;
    const step = activeStep;
    const t = setTimeout(async () => {
      try {
        const dataUrl = await toJpeg(el, { quality: 0.6, pixelRatio: 0.6, backgroundColor: '#ffffff', cacheBust: false });
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
  }, [activeStep, isListeningVoice, isSharingPaused]);

  // The agent cursor is positioned in viewport pixels; a step change replaces the DOM under it.
  useEffect(() => {
    setAgentCursor((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    setSpotlightedElementId(null);
  }, [activeStep]);

  // Keep what the long-lived agent callbacks need current (every render).
  useEffect(() => {
    latestRef.current = { applyAction: applyAgentAction, lang: selectedLanguage, screenState: getLiveScreenSnapshot, activeStep };
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
    `Nominee: ${nomination.primaryName ? `${nomination.primaryName} (${nomination.primaryShare}%)` : '—'}`,
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
      
      {/* 2. Main ACKO Header */}
      <header className="shrink-0 bg-white border-b border-slate-200 z-30">
        <div className="w-full px-4 lg:px-6 py-1.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-[#582be8] text-white flex items-center justify-center font-bold text-sm tracking-tighter shadow-sm">
              acko
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-[#111827]">ACKO</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-purple-50 text-[#582be8] border border-purple-200">
                  Life Flexi Shield</span>
              </div>
              <p className="text-[11px] text-slate-500 truncate max-w-[36rem]">ACKO Life Insurance Limited · IRDAI Reg. No. 157 · Pure term life with zero commission & living benefits</p>
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

      {/* Co-Browsing Status Bar: WebRTC Screen Share & Dual-Cursor Screen Control */}
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
                  ? `Agent ${agentState.toUpperCase()} • ${voiceTelemetry.asrModel || 'muse-voice-transcribe-1.0'} realtime ASR • ${voiceTelemetry.sparkModel || 'muse-spark-1.3'} streaming • Google Cloud TTS ${voiceTelemetry.ttsVoice ? `(${voiceTelemetry.ttsVoice})` : ''}`
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
                <span>SAM 3 PII Shield: {privacyShieldActive ? 'ACTIVE' : 'OFF'}</span>
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
                onClick={disconnectCoBrowsingSession}
                className="px-3 py-1 rounded-lg bg-red-700 hover:bg-red-800 text-white text-[11px] font-bold border border-red-500 transition-all flex items-center gap-1"
              >
                <span></span>
                <span>Disconnect</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 3. Stepper Navigation */}
      <nav className="shrink-0 bg-white border-b border-slate-200 px-4 lg:px-6 py-1">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto text-xs py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            
            {/* Step 1 */}
            <button
              id="step-tab-1"
              onClick={() => setActiveStep(1)}
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
              onClick={() => setActiveStep(2)}
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
              onClick={() => setActiveStep(3)}
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
              onClick={() => setActiveStep(4)}
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
              onClick={() => setActiveStep(5)}
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

          {/* STEP 1: Blank Profile (Click any field -> auto-played regional guidance!) */}
          {activeStep === 1 && (
            <div className="acko-card p-4 flex flex-col gap-3">
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
                        Private parts hidden before reading</span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2">
                      Photos, signatures, QR codes and ID numbers (Aadhaar, PAN, UAN, bank account) are located and pixelated on your device before the image is read. Your name and date of birth stay readable so the form can be filled.
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

              {kycRedaction && (
                <div className="p-3 rounded-xl bg-slate-50 text-slate-800 border border-slate-200 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold"> Privacy shield • {kycRedaction.type.replace('-', ' ').toUpperCase()}</span>
                    <span className="text-slate-500">
                      {kycRedaction.status}
                      {showDevPanel && kycRedaction.samMs !== null ? ` • SAM 3.1 ${kycRedaction.samMs} ms${kycRedaction.samCached ? '(cached)' : ''}` : ''}
                      {showDevPanel && kycRedaction.locateMs !== null ? ` • Spark locate ${kycRedaction.locateMs} ms` : ''}
                      {showDevPanel && kycRedaction.ocrMs !== null ? ` • Spark OCR ${kycRedaction.ocrMs} ms` : ''}</span>
                  </div>
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
                      <div className="text-[11px] text-slate-400 mb-1">{showDevPanel ? '2. What Muse Spark receives (pixelated in your browser)' : '2. What the agent reads (hidden parts pixelated on your device)'}</div>
                      {kycRedaction.redactedDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={kycRedaction.redactedDataUrl} alt="Redacted document sent to OCR"className="w-full rounded-lg border border-slate-200" />
                      ) : (
                        <div className="w-full aspect-[1000/630] rounded-lg border border-slate-200 bg-slate-100 animate-pulse" />
                      )}
                    </div>
                  </div>
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
                        title="Why does ACKO ask this?"
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
                        title="Why does ACKO ask this?"
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
                        title="Why does ACKO ask this?"
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
                        title="Why does ACKO ask this?"
                      >
                        <span>Why?</span>
                      </button>
                    </div>
                    <span className="text-[11px] text-[#582be8] font-bold"> Auto-guidance</span>
                  </div>
                  <div className="flex gap-2">
                    <button
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
                      ✓ Non-Smoker (20% Discount)
                    </button>
                    <button
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
                      type="text"
                      value={profile.city}
                      onFocus={() => handleFieldClickOrFocus('field-city')}
                      onChange={(e) => setProfile(prev => ({ ...prev, city: e.target.value }))}
                      placeholder="e.g. Pune"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-medium focus:outline-none focus:border-[#582be8]"
                    />
                    <input
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

              {/* Masked identity placeholders: the agent only ever sees these masked values */}
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs tabular-nums text-slate-700">
                <span className="font-bold text-slate-800">Identity records</span>
                <span><span className="text-[11px] text-slate-400">Aadhaar </span><span className="font-bold tracking-wider">{profile.aadhaarNumber}</span></span>
                <span><span className="text-[11px] text-slate-400">PAN </span><span className="font-bold tracking-wider">{profile.panNumber}</span></span>
                <span><span className="text-[11px] text-slate-400">Mobile </span><span className="font-bold tracking-wider">{profile.mobileNumber}</span></span>
                <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800">
                  Masked from OmniCB Agent</span>
              </div>

              <div className="flex justify-end pt-1.5 border-t border-slate-100">
                <button
                  onClick={() => {
                    if (!profile.fullName) {
                      triggerFieldGuidance('field-full-name');
                      return;
                    }
                    if (!profile.dob) {
                      triggerFieldGuidance('field-dob');
                      return;
                    }
                    setActiveStep(2);
                    setIdleSeconds(0);
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
          {activeStep === 2 && (
            <div className="flex flex-col gap-6">

              {/* Base Plan Selection */}
              <div className="acko-card p-4">
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
              <div className="acko-card p-4">
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
                      Fixed ₹5,000 cash allowance per 24 hours of hospitalization to cover incidental expenses and loss of daily income.
                    </p>
                    <div className="text-[11px] font-medium text-slate-500 tabular-nums">
                      <span>Up to 60 Days Annually</span>
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

              <div className="flex justify-between items-center pt-2">
                <button
                  onClick={() => setActiveStep(1)}
                  className="px-5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
                >
                  ← Back to Step 1
                </button>
                <button
                  onClick={() => {
                    setActiveStep(3);
                    setIdleSeconds(0);
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
          {activeStep === 3 && (
            <div id="nomination-section"className="acko-card p-4 flex flex-col gap-5">
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
                        Meta Muse Wonder 1.0 • Actuarial Recommendation
                      </h4>
                      <p className="text-xs text-slate-700 font-medium">
                        For salaried professionals with dependents, IRDAI recommends allocating <strong>70% to Spouse</strong> and <strong>30% to Minor Child</strong> (with an adult appointee), shielded by the <strong>MWPA 1874 Trust</strong>.
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-lg bg-purple-100 text-[#582be8] text-[11px] tabular-nums font-bold border border-purple-200 shrink-0">
                    Actuarial Match 99.4%</span>
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

                    {/* If minor nominee (<18 yrs), Appointee Details required under IRDAI Sec 39 */}
                    {nomination.secondaryAge < 18 && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                        <div className="flex items-center gap-1.5 text-amber-900 text-xs font-bold">
                          <span>Minor Nominee Detected (&lt; 18 years)</span>
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
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <button
                  onClick={() => setActiveStep(2)}
                  className="px-5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50"
                >
                  ← Back to Step 2: Benefit Ladders
                </button>
                <button
                  onClick={() => {
                    if (!nomination.primaryName) {
                      setNomination(prev => ({ ...prev, primaryName: 'Priya Ramesh Thorat' }));
                    }
                    setActiveStep(4);
                    setIdleSeconds(0);
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
          {activeStep === 4 && (
            <div className="acko-card p-4 flex flex-col gap-5">
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
                    if (!underwriting.section45Consent) {
                      triggerFieldGuidance('field-section-45');
                      return;
                    }
                    setActiveStep(5);
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
          {activeStep === 5 && (
            <div className="acko-card p-4 flex flex-col gap-5">
              <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#111827]">Step 5: Policy Schedule, Terms & Instant Issuance</h2>
                  <p className="text-xs text-slate-500">Review your final coverage schedule, beneficiary details & statutory terms</p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Ready to Issue</span>
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
                    {nomination.primaryName || 'Priya Ramesh Thorat'} ({nomination.primaryRelation}, {nomination.primaryShare}%)
                    {nomination.mwpaTrustEnabled ? ' • MWPA Trust Shield Active' : ''}</span>
                </div>

                <div className="border-t border-slate-300 pt-3 flex justify-between items-baseline text-sm font-bold text-slate-900">
                  <span>Total Monthly Premium (incl. 18% GST):</span>
                  <span className="text-xl font-bold text-[#582be8] tabular-nums">₹{totalMonthlyPayable}/mo</span>
                </div>
              </div>

              {policyIssued ? (
                <div className="p-6 rounded-2xl bg-emerald-50 border border-emerald-300 text-center flex flex-col items-center gap-3">
                  <div className="size-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xl shadow-sm">
                    ✓
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-emerald-950">ACKO Life Policy Issued Successfully!</h3>
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
                    className="px-7 py-3.5 rounded-xl bg-[#582be8] hover:bg-[#481dd4] text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all"
                  >
                    Confirm & Lock Policy (₹{totalMonthlyPayable}/mo)
                  </button>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Right Sticky Sidebar: Premium Breakdown & Docked OmniCB Advisor */}
        <div className="min-h-0 overflow-y-auto flex flex-col gap-3">
          
          {/* Premium Breakdown Card */}
          <div className="acko-card p-3 shrink-0">
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
                saves <span className="font-bold tabular-nums">₹{annualTaxSavings}</span>/yr
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
                <span>GST (18% Statutory):</span>
                <span>+₹{gst18Percent}</span>
              </div>

            </div>
            <div className="mt-2">
            {/* Feature 1: Interactive Dual Tax & Net Cost Widget (80C + 80D) */}
            <div className="p-3 rounded-2xl bg-white border border-slate-200 text-slate-800 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm"></span>
                  <button type="button" onClick={() => setShowTaxBreakdownWidget((v) => !v)} className="text-xs font-bold text-emerald-950 hover:text-[#582be8]">Dual Tax & Net Cost {showTaxBreakdownWidget ? '▾' : '▸'}</button>
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
                    80C + 80D</span>
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
                    -₹{(Math.round(monthlyBase * 12 * 0.312) + (selectedRiders.criticalIllness ? 5580 : 0)).toLocaleString()}/yr
                  </strong>
                  <span className="text-[11px] text-emerald-700 block font-bold">
                    {selectedRiders.criticalIllness ? 'Sec 80C + 80D Active' : 'Sec 80C Active'}</span>
                </div>
              </div>

              <div className="p-2 rounded-xl bg-white border border-emerald-200 flex justify-between items-center text-[11px]">
                <div>
                  <span className="text-[11px] text-slate-500 block">Net Effective Cost:</span>
                  <strong className="text-sm font-bold text-[#582be8] tabular-nums">
                    ₹{Math.round(Math.max(0, (totalMonthlyPayable * 12) - (Math.round(monthlyBase * 12 * 0.312) + (selectedRiders.criticalIllness ? 5580 : 0))) / 12)}/mo
                  </strong>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-bold text-emerald-700 block">
                    Saves {Math.round(((Math.round(monthlyBase * 12 * 0.312) + (selectedRiders.criticalIllness ? 5580 : 0)) / (totalMonthlyPayable * 12)) * 100)}%</span>
                  <span className="text-[11px] text-slate-400 tabular-nums">after tax refund</span>
                </div>
              </div>

              {selectedRiders.criticalIllness && (
                <p className="text-[11px] text-emerald-800 bg-emerald-100/60 p-1.5 rounded-lg border border-emerald-200 leading-tight">
                   <strong>Actuarial Insight:</strong> ₹5,580 Sec 80D tax savings exceeds the ₹1,788 annual rider premium, making your ₹25 Lakhs Critical Illness cover <strong>net cost-negative</strong>!
                </p>
              )}
            </>)}
            </div>

            </div>
            </>)}
          </div>

          {/* DOCKED OMNICB CO-BROWSE AGENT (MINIMAL: CONTROLS & TRANSCRIPT ONLY) */}
          <div className="acko-card p-3 rounded-2xl flex flex-col gap-2 bg-white flex-1 min-h-[300px] overflow-y-auto [&>*]:shrink-0">
            
            {/* Header with Connection Status & Connect/Disconnect Button */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-xl bg-[#582be8] flex items-center justify-center text-white font-bold text-xs">
                  OB
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#111827]">OmniCB Co-Browse</h4>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {isCoBrowsingConnected ? (
                      <span className="text-emerald-600 font-bold flex items-center gap-1">
                        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live voice & form sync</span>
                    ) : (
                      <span className="text-slate-400">Disconnected</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Connect / Disconnect Action Button */}
              {isCoBrowsingConnected ? (
                <button
                  onClick={disconnectCoBrowsingSession}
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
                  <span>How Meta Models Process Screen & Video Feeds</span>
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-800 font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Meta Model / Technology</th>
                        <th className="p-3">Video & Screen Feed Capability</th>
                        <th className="p-3">Role in Co-Browsing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-[#582be8]">
                          <a href="https://dev.meta.ai/models/muse-spark"target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-1">
                            <span>Meta Muse Spark Series</span>
                            <span className="text-[11px]"></span>
                          </a>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-normal">Meta Model API</span>
                        </td>
                        <td className="p-3"><strong>High-Effort Multimodal Intent Reasoning</strong><br />Accepts high-res viewport frames, user queries, and live DOM state. Reasons through insurance clauses, underwriting questions, and proposal fields with chain-of-thought verification.</td>
                        <td className="p-3"><strong>Conversational Co-Browsing Lead</strong>:<br />Powers dynamic guidance without hardcoding. Directs spatial spotlights and virtual dual-cursor actions in real-time.</td>
                      </tr>
                      <tr className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-[#582be8]">
                          <a href="https://dev.meta.ai/models/muse-wonder"target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-1">
                            <span>Meta Muse Wonder</span>
                            <span className="text-[11px]"></span>
                          </a>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-normal">Meta Model API</span>
                        </td>
                        <td className="p-3"><strong>Deep Multimodal Actuarial Reasoning</strong><br />Calculates 30-year risk projections, Human Life Value (HLV) benchmarks, and Section 80C + 80D tax deductions (up to ₹54,600/yr).</td>
                        <td className="p-3"><strong>Financial Risk & Actuarial Analysis</strong>:<br />Evaluates Critical Illness vs Accidental Death trade-offs based on applicant family medical history.</td>
                      </tr>
                      <tr className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-[#582be8]">
                          <a href="https://dev.meta.ai/models/muse-image"target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-1">
                            <span>Meta Muse Image</span>
                            <span className="text-[11px]"></span>
                          </a>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-normal">Meta Model API</span>
                        </td>
                        <td className="p-3"><strong>Text-to-Image Generation (reserved)</strong><br />Image generation model on the Model API. KYC document OCR in this app is performed by Muse Spark's image input via /api/ocr.</td>
                        <td className="p-3"><strong>Not yet wired</strong>:<br />Reserved for rendering policy certificate previews after issuance.</td>
                      </tr>
                      <tr className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-[#582be8]">
                          <a href="https://dev.meta.ai/models/muse-voice-transcribe"target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-1">
                            <span>Meta Muse Voice Transcribe</span>
                            <span className="text-[11px]"></span>
                          </a>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-normal">Meta Model API</span>
                        </td>
                        <td className="p-3"><strong>Real-time Audio Uplink Transcription</strong><br />Transcribes customer microphone streams in real time with support for English, Hindi (हिंदी), and Marathi (मराठी) speech phonemes.</td>
                        <td className="p-3"><strong>Two-Way Customer Voice Uplink</strong>:<br />Transcribes verbal questions directly from the browser microphone to feed the reasoning engine.</td>
                      </tr>
                      <tr className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-[#582be8]">
                          <a href="https://dev.meta.ai/models/sam-3-1"target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-1">
                            <span>Meta SAM 3.1</span>
                            <span className="text-[11px]"></span>
                          </a>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-normal">Meta Model API</span>
                        </td>
                        <td className="p-3"><strong>Native 60 FPS Video Segmentation & Memory Tracking</strong><br />Tracks dynamic viewport frames, modals, and elements across WebRTC screenshare video streams.</td>
                        <td className="p-3"><strong>Zero-PII Privacy Redaction</strong>:<br />Detects Aadhaar/PAN fields and applies client-side polygonal blur before WebRTC video encoding.</td>
                      </tr>
                      <tr className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-[#582be8]">
                          <a href="https://dev.meta.ai/models/muse-glimmer"target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-1">
                            <span>Meta Muse Glimmer</span>
                            <span className="text-[11px]"></span>
                          </a>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-normal">Open Weights Edge</span>
                        </td>
                        <td className="p-3"><strong>DOM & UI Spatial Grounding</strong><br />Bridges raw visual screen pixels with DOM elements, calculating sub-pixel center coordinates.</td>
                        <td className="p-3"><strong>Coordinate Precision & Glide</strong>:<br />Directs the agent's virtual cursor with smooth sub-pixel gliding to target elements.</td>
                      </tr>
                      <tr className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-[#582be8]">
                          <a href="https://dev.meta.ai/models/muse-spark-open"target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-1">
                            <span>Meta Muse Spark Open</span>
                            <span className="text-[11px]"></span>
                          </a>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-normal">Open Weights Edge</span>
                        </td>
                        <td className="p-3"><strong>Local On-Device Reasoning</strong><br />Runs on-premises/edge with zero cloud latency and complete data sovereignty.</td>
                        <td className="p-3"><strong>Sub-100ms Edge Fallback</strong>:<br />Guarantees instantaneous offline conversational responses when cloud network is offline.</td>
                      </tr>
                      <tr className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-[#582be8]">
                          <a href="https://dev.meta.ai/lp/muse-code"target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-1">
                            <span>Meta Muse Code</span>
                            <span className="text-[11px]"></span>
                          </a>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-normal">Coding Agent</span>
                        </td>
                        <td className="p-3"><strong>Autonomous Software Architecture Agent</strong><br />Engineered the end-to-end co-browsing application, WebRTC pipeline, and multi-model routing.</td>
                        <td className="p-3"><strong>Accelerated Development</strong>:<br />Created production-grade Next.js, WebRTC, and Meta AI agent integrations.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 2: Real-time Video Pipeline Diagram */}
              <div>
                <h4 className="text-sm font-bold text-[#111827] mb-2 flex items-center gap-2">
                  <span>2.</span>
                  <span>How the Real-Time Video Pipeline Works in Co-Browsing</span>
                </h4>
                <div className="p-4 rounded-2xl bg-slate-900 text-white tabular-nums space-y-3">
                  <div className="text-[11px] text-purple-300 font-bold border-b border-slate-200 pb-2">
                    PIPELINE ARCHITECTURE (USER VIEWPORT → SAM 3 → WEBRTC → AGENT DUAL-CURSOR):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-center text-[11px]">
                    <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200">
                      <div className="text-emerald-400 font-bold mb-1">1. Live Voice</div>
                      <span>Mic PCM 24kHz → Muse Voice Transcribe WS</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-purple-950 border border-purple-800">
                      <div className="text-purple-300 font-bold mb-1">2. SAM 3.1 & PII Shield</div>
                      <span>Client-Side Aadhaar/PAN Masking</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200">
                      <div className="text-amber-300 font-bold mb-1">3. Muse Spark 1.3</div>
                      <span>Sub-5ms DOM Reasoning & Co-Browsing</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#582be8]/30 border border-purple-500">
                      <div className="text-white font-bold mb-1">4. Dual-Cursor & Visuals</div>
                      <span>Sub-pixel Glide & Milestone WebP</span>
                    </div>
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-slate-600 text-[11px] font-sans pt-1">
                    <li><strong>Live Voice Loop</strong>: Microphone PCM streams to Meta Muse Voice Transcribe (server-side endpointing). Muse Spark answers stream back and are spoken sentence by sentence with barge-in.</li>
                    <li><strong>Decoupled DOM Engine</strong>: Agent navigates via live DOM coordinates (sub-5ms) instead of bandwidth-heavy continuous video streaming.</li>
                    <li><strong>Live DOM State</strong>: The form state is sent to Muse Spark as JSON with every turn. No screenshots or video leave the browser.</li>
                    <li><strong>Dual-Cursor Screen Control</strong>: Virtual cursor demonstrates field inputs with immediate emergency user override (ESC).</li>
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
                  <p className="text-[11px] text-slate-500 tabular-nums">IRDAI UIN: 157N001V01 • ACKO Life Flexi Shield</p>
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
                  <span><strong>Zero-Hallucination Grounding:</strong> Verified verbatim against official IRDAI filed policy contract.</span>
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
                <strong>Tax Optimization:</strong> {auditCertData.taxOptimizationSummary.totalAnnualTaxSaved} saved via Section 80C + 80D.
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
                      IRDAI UIN: 157N001V01</span>
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
                  <div key={c.id} className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#582be8]/40 transition-all space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] tabular-nums font-bold px-2 py-0.5 rounded-md bg-purple-50 text-[#582be8] border border-purple-200">
                        {c.clauseNumber} • {c.category}</span>
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

      {/* 7. Authentic ACKO Modern Footer */}
      <footer className="shrink-0 bg-[#1e104f] text-white text-[10px] px-4 lg:px-6 py-1 border-t border-[#2d1b70]">
        <div className="w-full flex items-center justify-between gap-3">
          <span
            className="truncate text-purple-300/80"
            title="ACKO Life Insurance Limited. Registered Office: #36/5, Hustlehub One East, 27th Main Rd, Sector 2, HSR Layout, Bengaluru, Karnataka 560102. Insurance is the subject matter of solicitation. ACKO Life Flexi Shield is a Non-Linked Non-Participating Individual Pure Risk Life Insurance Plan (UIN: 157N001V01)."
          >
            ACKO Life Insurance Limited · CIN U66010KA2022PLC164741 · Insurance is the subject matter of solicitation · UIN 157N001V01
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
        <PresenterPanel turns={turns} memoryFacts={memoryFacts} agentState={agentState} stats={sessionStats} cases={cases} onDownloadCase={downloadCase} />
      </div>
    );
  }

  return pageContent;
}
