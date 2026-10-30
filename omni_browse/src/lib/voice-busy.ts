// The voice agent refuses a new session with HTTP 503 when it is already carrying its limit of conversations
// (voice-agent-py/coverpilot/capacity.py). The voice library hides the status (it throws "Offer request failed:
// [object Response]"), so the client asks the agent's capacity endpoint instead, before it connects and again after
// a failed offer, and says "busy, try again" plainly rather than a generic connection error.

export const VOICE_BUSY_MESSAGE = 'The voice assistant is busy with other visitors right now. Please try again in a minute.';

/** The agent's capacity endpoint, next to its offer endpoint (`.../api/offer` -> `.../api/capacity`). */
export function capacityUrl(offerUrl: string): string {
  return offerUrl.replace(/\/api\/offer\/?$/, '/api/capacity');
}

/** True when the agent is at its session limit. Any failure to ask (an older agent, a network error) means "not busy". */
export async function agentIsBusy(offerUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(capacityUrl(offerUrl), { cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as { busy?: unknown };
    return body.busy === true;
  } catch {
    return false;
  }
}

/** True when an error already says the agent is busy (HTTP 503, or the agent's own busy message). */
export function isBusyError(err: unknown): boolean {
  const text = `${(err as { message?: string })?.message ?? ''} ${(err as { name?: string })?.name ?? ''} ${String(err)}`;
  return /\b503\b|voice assistant is busy/i.test(text);
}
