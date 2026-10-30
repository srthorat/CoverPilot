// Timing and wording for a document review that can be slow. The review model is a large open-weights model on a
// serverless GPU, so after a quiet spell the first call may spend a while waking it up. The page must never wait
// without saying so, and must never wait forever.

/** Show "still working" once a review has taken this long. */
export const SLOW_NOTICE_MS = 30_000;

/** The browser gives up on a review after this long (the server tries at most twice, see guardian-review.ts). */
export const CLIENT_REVIEW_TIMEOUT_MS = 270_000;

export function elapsedSeconds(startedAt: number | undefined, now: number): number {
  return startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
}

/** What the customer reads when a review fails. Never exposes provider bodies or document text. */
export function reviewFailureMessage(input: { status?: number; error?: unknown; timedOut?: boolean }): string {
  if (input.timedOut) return 'The review took too long and was stopped. The review model may be waking up; try again.';
  if (input.status === 429) return 'Too many reviews in a short time. Wait a few seconds and try again.';
  if (input.status === 503) return 'The review service is not set up on this server.';
  if (input.status === 400) return typeof input.error === 'string' && input.error ? input.error : 'The document could not be sent for review.';
  const detail = typeof input.error === 'string' && input.error ? input.error : input.status ? `HTTP ${input.status}` : 'no answer';
  return `The review could not be completed (${detail}). Nothing was changed. Try again.`;
}
