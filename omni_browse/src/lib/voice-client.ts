// Browser side of the CoverPilot voice agent.
//
// Audio travels over WebRTC (Pipecat SmallWebRTC transport): the microphone goes
// to the Python agent in voice-agent-py, which runs Meta Muse Voice Transcribe,
// Silero VAD + Smart Turn end-of-turn detection, Muse Spark, Muse Wonder and
// Google TTS, and the bot's voice comes back as a remote audio track. Browser
// echo cancellation plus server-side VAD give real barge-in. Everything else
// (form state, screenshots, typed questions, voice/language changes) is small
// JSON on the WebRTC data channel using the RTVI message protocol.

import { PipecatClient, type BotReadyData, type TranscriptData, type Participant, type RTVIMessage } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';

export type AgentState = 'listening' | 'thinking' | 'speaking';

export type AgentEvent =
  | { type: 'hello'; lang: string; sttModel: string; llmModel: string; reasoningEffort: string; ttsVoice?: string; about?: Record<string, any> }
  | { type: 'ready'; sttModel: string; lang: string }
  | { type: 'state'; state: AgentState }
  | { type: 'level'; rms: number; gated: boolean }
  | { type: 'user_transcript'; text: string; final: boolean; turnId: number | null }
  | { type: 'user_turn'; text: string; turnId: number; source: 'voice' | 'text'; asrTurnMs: number | null; kbChunks?: KbChunk[] }
  | { type: 'agent_start'; turnId: number }
  | { type: 'agent_text'; delta: string }
  | { type: 'agent_ack'; text: string; ms?: number }
  | { type: 'agent_sentence'; index: number; text: string; local?: boolean }
  | { type: 'agent_audio_meta'; index: number; text: string; ttsMs: number; cached: boolean; voice: string | null; local?: boolean }
  | { type: 'agent_local_done'; index: number }
  | { type: 'action'; targetElementId: string | null; actionTitle: string; fieldAction: Record<string, any> | null; fieldActions?: Record<string, any>[] }
  | { type: 'agent_done'; text: string; telemetry: AgentTelemetry }
  | { type: 'agent_prefetch'; reason: string; step: number | null; ms: number; questions: string[] }
  | {
      type: 'action_verification';
      id: string;
      status: 'pending' | 'approve' | 'amend' | 'reject' | 'ask' | 'error';
      model: string;
      actionTitle: string;
      reason?: string;
      clause?: string | null;
      amendedAction?: Record<string, any> | null;
      ms?: number;
      usage?: { promptTokens?: number | null; completionTokens?: number | null };
    }
  | { type: 'policy_doc_ready'; ok: boolean; name?: string; pages?: number; passages?: number; error?: string }
  | { type: 'agent_role'; role: 'cobrowse' | 'guardian'; name?: string }
  | { type: 'usage'; promptTokens?: number | null; completionTokens?: number | null }
  | { type: 'memory'; facts: string[]; summary: string; updated_at?: number | null }
  | { type: 'memory_updated'; added: number; facts: string[]; summary?: string | null }
  | { type: 'interrupt' }
  | { type: 'case_created'; case: CaseRecord }
  | { type: 'error'; message: string }
  | { type: 'closed'; code: number; reason: string };

export type AgentAction = Extract<AgentEvent, { type: 'action' }>;

export interface CaseRecord {
  caseId: string;
  createdAt: string;
  reason: 'medical' | 'override' | 'other';
  reasonLabel: string;
  language: string;
  question: string;
  advisorReply: string;
  screen: Record<string, any>;
  knowledge: Array<{ label: string | null; score: number | null }>;
  underwriterNote: string | null;
  summaryError: string | null;
  status: 'open';
}

export interface KbChunk {
  label: string;
  score: number;
  terms?: string[];
  doc?: boolean; // from the customer's uploaded policy rather than the built-in knowledge base
  excerpt?: string;
}

export interface AgentTelemetry {
  sttModel?: string;
  llmModel?: string;
  reasoningEffort?: string;
  asrTurnMs?: number | null;
  servedFrom?: string;
  matchedQuestion?: string;
  ackMs?: number | null;
  screenshotAttached?: boolean;
  ttftMs?: number | null;
  totalMs?: number;
  usage?: any;
  error?: string;
}

export type VoicePersona = 'veena' | 'rishi' | 'nova' | 'aura';

export type EnglishAccent = 'in' | 'us';

export interface VoiceAgentClientOptions {
  lang: 'en' | 'hi' | 'mr';
  /** Google Cloud TTS persona (server maps it to a Chirp 3 HD voice in the session language). */
  voice: VoicePersona;
  /** Indian or American English; ignored for Hindi/Marathi. */
  accent: EnglishAccent;
  /** Spoken-output engine for this session: Google Cloud TTS (default) or Meta MMS (experimental, local server). */
  ttsProvider?: 'google' | 'meta-mms';
  /** The last few turns of this conversation, so a session started after an idle pause or a drop keeps its context. */
  priorTurns?: Array<{ role: 'user' | 'agent'; text: string }>;
  /** Stable id for cross-session memory; omit for a session with no memory. */
  customerId?: string | null;
  /** Let the agent speak its welcome as soon as it is ready (default true). */
  autoWelcome?: boolean;
  onEvent: (event: AgentEvent) => void;
  /** Bot audio actually playing or not. */
  onSpeaking?: (speaking: boolean) => void;
}

/** The Pipecat runner's offer endpoint, proxied by next.config (`/voice-agent/*` -> VOICE_AGENT_URL). */
export const VOICE_AGENT_OFFER_URL = process.env.NEXT_PUBLIC_VOICE_AGENT_OFFER_URL || '/voice-agent/api/offer';

// SCTP data-channel messages are capped at 64 KB by the Python peer; screenshots are split.
const SCREENSHOT_CHUNK_CHARS = 12_000;

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** STUN + TURN from the server (`/api/ice-servers`); public STUN alone if that fails. */
async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch('/api/ice-servers', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data?.iceServers) && data.iceServers.length) return data.iceServers as RTCIceServer[];
  } catch (e) {
    console.warn('ICE server lookup failed, using public STUN only', e);
  }
  return DEFAULT_ICE_SERVERS;
}

/* ------------------------------------------------------------------------ */

export class VoiceAgentClient {
  private opts: VoiceAgentClientOptions;
  private client: PipecatClient | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private stopped = false;
  private ready = false;
  private turnCounter = 0;
  private speaking = false;
  private connecting = false;
  lang: 'en' | 'hi' | 'mr';

  constructor(opts: VoiceAgentClientOptions) {
    this.opts = opts;
    this.lang = opts.lang;
  }

  get isOpen(): boolean {
    return !!this.client && this.client.connected && this.ready;
  }

  setVoice(persona: VoicePersona, accent: EnglishAccent = this.opts.accent) {
    this.opts.voice = persona;
    this.opts.accent = accent;
    this.send('set_voice', { persona, accent });
  }

  async start(): Promise<void> {
    this.stopped = false;
    const iceServers = await fetchIceServers();
    const emit = (ev: AgentEvent) => {
      if (!this.stopped) this.opts.onEvent(ev);
    };
    const setSpeaking = (on: boolean) => {
      if (this.speaking === on) return;
      this.speaking = on;
      this.opts.onSpeaking?.(on);
      emit({ type: 'state', state: on ? 'speaking' : 'listening' });
    };

    const build = () => new PipecatClient({
      transport: new SmallWebRTCTransport({ iceServers, waitForICEGathering: false }),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onBotReady: (data: BotReadyData) => {
          const about = (data.about || {}) as Record<string, any>;
          this.ready = true;
          emit({
            type: 'hello',
            lang: this.lang,
            sttModel: String(about.sttModel || ''),
            llmModel: String(about.llmModel || ''),
            reasoningEffort: String(about.reasoningEffort || ''),
            ttsVoice: about.ttsVoice ? String(about.ttsVoice) : undefined,
            about,
          });
          emit({ type: 'ready', sttModel: String(about.sttModel || ''), lang: this.lang });
        },
        onTrackStarted: (track: MediaStreamTrack, participant?: Participant) => {
          if (track.kind !== 'audio' || participant?.local) return;
          this.attachBotAudio(track);
        },
        onUserTranscript: (data: TranscriptData) => {
          emit({ type: 'user_transcript', text: data.text, final: data.final, turnId: null });
        },
        onUserStartedSpeaking: () => {
          emit({ type: 'level', rms: 0.2, gated: false });
        },
        onUserStoppedSpeaking: () => {
          emit({ type: 'state', state: 'thinking' });
        },
        onLocalAudioLevel: (level: number) => {
          emit({ type: 'level', rms: level / 4, gated: false });
        },
        onBotStartedSpeaking: () => setSpeaking(true),
        onBotStoppedSpeaking: () => setSpeaking(false),
        onServerMessage: (data: any) => {
          if (!data || typeof data.type !== 'string') return;
          switch (data.type) {
            case 'user_turn':
              this.turnCounter += 1;
              emit({ type: 'user_turn', text: String(data.text || ''), turnId: this.turnCounter, source: data.source === 'text' ? 'text' : 'voice', asrTurnMs: null, kbChunks: Array.isArray(data.kbChunks) ? data.kbChunks : undefined });
              emit({ type: 'state', state: 'thinking' });
              break;
            case 'agent_start':
              emit({ type: 'agent_start', turnId: this.turnCounter });
              break;
            case 'agent_text':
              emit({ type: 'agent_text', delta: String(data.delta || '') });
              break;
            case 'agent_done':
              emit({ type: 'agent_done', text: String(data.text || ''), telemetry: data.telemetry || {} });
              break;
            case 'agent_ack':
              emit({ type: 'agent_ack', text: String(data.text || ''), ms: data.ms });
              break;
            case 'action':
            case 'action_verification':
            case 'usage':
            case 'agent_role':
            case 'policy_doc_ready':
            case 'memory':
            case 'memory_updated':
            case 'interrupt':
            case 'case_created':
              emit(data as AgentEvent);
              break;
            default:
              break;
          }
        },
        onError: (msg: RTVIMessage) => {
          const d = msg?.data as any;
          let text: string;
          if (typeof d === 'string') text = d;
          else if (d && typeof (d.message ?? d.error) === 'string') text = d.message ?? d.error;
          else {
            try {
              text = JSON.stringify(d).slice(0, 300);
            } catch {
              text = 'Voice agent error';
            }
          }
          emit({ type: 'error', message: text });
        },
        onDisconnected: () => {
          this.ready = false;
          setSpeaking(false);
          if (!this.stopped && !this.connecting) emit({ type: 'closed', code: 1006, reason: 'disconnected' });
        },
      },
    });
    // The first connection after the agent starts cold can fail ICE once (seen in logs); a fresh peer
    // connection almost always succeeds, so try twice before reporting an error.
    const MAX_ATTEMPTS = 2;
    const CONNECT_TIMEOUT_MS = 20_000;
    const MIC_TIMEOUT_MS = 45_000;
    for (let attempt = 1; ; attempt++) {
      const client = build();
      this.client = client;
      this.connecting = true;
      try {
        // The microphone prompt can sit unanswered (Safari asks every time); do not wait for it forever.
        let micTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            client.initDevices(),
            new Promise<never>((_, reject) => {
              micTimer = setTimeout(() => reject(new Error('The browser did not give microphone access in time. Choose Allow in its prompt, then start again.')), MIC_TIMEOUT_MS);
            }),
          ]);
        } finally {
          clearTimeout(micTimer);
        }
        // Direct SmallWebRTC offer (no /start step): the body is {sdp, type, requestData},
        // and the runner hands requestData to the bot as its session body.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('The voice connection timed out')), CONNECT_TIMEOUT_MS);
        });
        try {
          await Promise.race([
            client.connect({
              webrtcRequestParams: {
                endpoint: VOICE_AGENT_OFFER_URL,
                requestData: {
                  lang: this.lang,
                  persona: this.opts.voice,
                  accent: this.opts.accent,
                  ttsProvider: this.opts.ttsProvider === 'meta-mms' ? 'meta-mms' : 'google',
                  customerId: this.opts.customerId || null,
                  priorTurns: this.opts.priorTurns || [],
                  autoWelcome: this.opts.autoWelcome !== false,
                },
              },
            }),
            timeout,
          ]);
        } finally {
          clearTimeout(timer);
        }
        this.connecting = false;
        return;
      } catch (err) {
        this.connecting = false;
        this.ready = false;
        this.client = null;
        try {
          await client.disconnect();
        } catch {
          /* already closed */
        }
        const mic = (err as { name?: string })?.name;
        const fatal = this.stopped || attempt >= MAX_ATTEMPTS || mic === 'NotAllowedError' || mic === 'PermissionDeniedError';
        if (fatal) {
          this.stop();
          throw err;
        }
        console.warn('Voice connection failed, retrying once', err);
      }
    }
  }

  private attachBotAudio(track: MediaStreamTrack) {
    if (!this.audioEl) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', 'true');
      el.style.display = 'none';
      document.body.appendChild(el);
      this.audioEl = el;
    }
    this.audioEl.srcObject = new MediaStream([track]);
    void this.audioEl.play().catch(() => {});
  }

  private send(type: string, data?: Record<string, unknown>) {
    if (this.client && this.client.connected) {
      try {
        this.client.sendClientMessage(type, data ?? {});
      } catch (e) {
        console.warn('voice agent message failed', type, e);
      }
    }
  }

  /** Typed question through the same Spark turn pipeline as speech. */
  sendText(text: string) {
    this.send('text', { text });
  }

  sendScreenState(state: unknown) {
    this.send('screen_state', { state });
  }

  /** JPEG data URL of the customer's viewport; attached to the next Spark turn for visual grounding. */
  sendScreenshot(dataUrl: string) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const total = Math.ceil(dataUrl.length / SCREENSHOT_CHUNK_CHARS);
    for (let i = 0; i < total; i++) {
      this.send('screenshot_chunk', { id, index: i, total, data: dataUrl.slice(i * SCREENSHOT_CHUNK_CHARS, (i + 1) * SCREENSHOT_CHUNK_CHARS) });
    }
  }

  // Hands the agent the text of the customer's policy (already extracted and masked in the browser).
  // Characters can take 3 bytes in a data-channel message, so pieces are kept small.
  sendPolicyDoc(name: string, pages: Array<{ page: number; text: string }>) {
    const raw = JSON.stringify({ name, pages });
    const size = 15_000;
    const total = Math.ceil(raw.length / size);
    if (total > 40) throw new Error('The document is too long to share with the assistant.');
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    for (let i = 0; i < total; i++) this.send('policy_doc_chunk', { id, index: i, total, data: raw.slice(i * size, (i + 1) * size) });
  }

  clearPolicyDoc() {
    this.send('policy_doc_clear', {});
  }

  // Which agent answers: the co-browsing agent builds the application, Integrity Guardian reviews a policy.
  setMode(mode: 'cobrowse' | 'guardian') {
    this.send('set_mode', { mode });
  }

  setLanguage(lang: 'en' | 'hi' | 'mr') {
    this.lang = lang;
    this.send('set_language', { lang });
  }

  setCustomer(customerId: string | null) {
    this.opts.customerId = customerId;
    this.send('set_customer', { customerId: customerId || '' });
  }

  forgetMe() {
    this.send('forget_me');
  }

  /**
   * Speak a client-originated line (welcome, field guidance) through the agent's
   * TTS, so the pipeline knows the bot is talking and barge-in applies to it too.
   */
  speakLocal(text: string, lang: 'en' | 'hi' | 'mr') {
    this.send('speak', { text, lang });
  }

  /** User pressed stop while the agent was talking. */
  interrupt() {
    this.send('interrupt');
  }

  stop() {
    this.stopped = true;
    this.ready = false;
    const client = this.client;
    this.client = null;
    if (client) void client.disconnect().catch(() => {});
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.srcObject = null;
        this.audioEl.remove();
      } catch {
        /* ignore */
      }
      this.audioEl = null;
    }
    if (this.speaking) {
      this.speaking = false;
      this.opts.onSpeaking?.(false);
    }
  }
}

/* ------------------------------------------------------------------------ */

/** Splits text into complete sentences, returning the unfinished tail. */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  for (;;) {
    const m = rest.match(/^([\s\S]*?[.!?।]+)\s+/);
    if (!m) break;
    const sentence = m[1].trim();
    if (sentence.length > 1) sentences.push(sentence);
    rest = rest.slice(m[0].length);
  }
  return { sentences, rest };
}
