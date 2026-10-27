// Server-side helpers for the Meta Model API (https://api.meta.ai/v1).
//
// Every model name comes from the environment so .env.local is the single
// source of truth. There are deliberately no offline fallbacks here: if the API
// is unreachable or returns an error, callers get a thrown MetaApiError and the
// route surfaces it to the user.

export class MetaApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    // Client-safe message; the provider's response body is kept for server logs only.
    super(`Meta API request failed (HTTP ${status})`);
    this.status = status;
    this.body = body;
    console.error(`[meta] HTTP ${status}: ${body.slice(0, 400)}`);
  }
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface MetaEnv {
  apiKey: string;
  baseUrl: string;
  sparkModel: string;
  transcribeModel: string;
  reasoningEffort: ReasoningEffort;
  timeoutMs: number;
}

export function metaEnv(): MetaEnv {
  const apiKey = process.env.META_MODEL_API_KEY || process.env.META_API_KEY || '';
  if (!apiKey || apiKey.length < 6) {
    throw new MetaApiError(500, 'META_MODEL_API_KEY is not configured');
  }
  const effort = (process.env.META_REASONING_EFFORT || 'low') as ReasoningEffort;
  return {
    apiKey,
    baseUrl: (process.env.META_MODEL_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, ''),
    sparkModel: process.env.META_MODEL_SPARK || process.env.META_MODEL_NAME || 'muse-spark-1.3',
    transcribeModel: process.env.META_MODEL_VOICE_TRANSCRIBE || 'muse-voice-transcribe-1.0',
    reasoningEffort: effort,
    timeoutMs: parseInt(process.env.META_API_TIMEOUT_MS || '30000', 10),
  };
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

interface ChatOptions {
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  maxTokens?: number;
}

function chatRequest(env: MetaEnv, messages: ChatMessage[], stream: boolean, opts: ChatOptions) {
  return fetch(`${env.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: opts.signal ?? AbortSignal.timeout(env.timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.apiKey}`,
    },
    body: JSON.stringify({
      model: env.sparkModel,
      stream,
      temperature: opts.temperature ?? 0.2,
      reasoning_effort: opts.reasoningEffort ?? env.reasoningEffort,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      messages,
    }),
  });
}

/** Streams Muse Spark content deltas as they arrive. */
export async function* streamSparkText(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<{ delta?: string; usage?: unknown }, void, void> {
  const env = metaEnv();
  const res = await chatRequest(env, messages, true, opts);
  if (!res.ok || !res.body) {
    throw new MetaApiError(res.status, await res.text());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) yield { delta };
      if (json.usage) yield { usage: json.usage };
    }
  }
}

/** Non-streaming Muse Spark call that expects a JSON object back. */
export async function sparkJson<T = unknown>(messages: ChatMessage[], opts: ChatOptions = {}): Promise<{
  data: T;
  raw: string;
  usage: unknown;
  model: string;
}> {
  const env = metaEnv();
  const res = await chatRequest(env, messages, false, opts);
  if (!res.ok) {
    throw new MetaApiError(res.status, await res.text());
  }
  const json: any = await res.json();
  const raw: string = json.choices?.[0]?.message?.content ?? '';
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new MetaApiError(502, `Model did not return JSON: ${raw}`);
  }
  const data = JSON.parse(cleaned.slice(start, end + 1)) as T;
  return { data, raw, usage: json.usage, model: json.model ?? env.sparkModel };
}
