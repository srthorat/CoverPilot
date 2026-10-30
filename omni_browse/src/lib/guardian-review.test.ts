import assert from 'node:assert/strict';
import test from 'node:test';
import { GuardianModelOutputError, attemptTimeoutMs, failureKind, parseModelJson, reviewDocument } from './guardian-review.ts';
import { CLIENT_REVIEW_TIMEOUT_MS, SLOW_NOTICE_MS, elapsedSeconds, reviewFailureMessage } from './guardian-timing.ts';
import { MetaApiError } from './meta.ts';

const SECRET = 'Priya Sharma lives at 12 Sample Road Pune 411001';
const INPUT = {
  pages: [{ page: 1, text: `Policyholder ${SECRET}. Sum assured 1 crore.` }],
  proposal: { sumAssured: '1.5cr' as const, monthlyPremium: 1050, termYears: 30, riders: [], nomineeCount: 1, nomineesTotalShare: 100, anyMinorNominee: false, smoker: false },
};
const GOOD = JSON.stringify({ documentKind: 'proposed policy', overall: 'ok', sections: [], facts: {} });

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  process.env.GUARDIAN_PROVIDER = 'spark-open';
  process.env.GUARDIAN_OPEN_BASE_URL = 'http://modal.invalid/v1';
  process.env.GUARDIAN_OPEN_API_KEY = 'test-key-value';
  delete process.env.GUARDIAN_ATTEMPT_TIMEOUT_MS;
  return fn().finally(() => {
    process.env = saved;
  });
}

function mockFetch(steps: Array<'timeout' | 'network' | { status: number; body: string } | { content: string }>) {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    const step = steps[Math.min(calls++, steps.length - 1)];
    if (step === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (step === 'network') throw new TypeError('fetch failed');
    if ('status' in step) return new Response(step.body, { status: step.status });
    return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: step.content } }] }), { status: 200 });
  }) as typeof fetch;
  return { calls: () => calls, restore: () => (globalThis.fetch = real) };
}

function captureLogs() {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.join(' '));
  console.error = (...a: unknown[]) => void lines.push(a.join(' '));
  return { lines, restore: () => ((console.log = log), (console.error = err)) };
}

test('unreadable model output errors carry sizes, never the model text', () => {
  const echoed = `{"overall":"${SECRET}" broken`;
  for (const raw of [`no json here ${SECRET}`, echoed]) {
    try {
      parseModelJson(raw);
      assert.fail('should throw');
    } catch (e) {
      assert.ok(e instanceof GuardianModelOutputError);
      assert.ok(!String((e as Error).message).includes('Priya'));
      assert.ok(!(e as GuardianModelOutputError).detail.includes('Priya'));
      assert.ok(!(e as GuardianModelOutputError).detail.includes('Sample Road'));
    }
  }
});

test('failureKind names the failure without text', () => {
  assert.equal(failureKind(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(failureKind(Object.assign(new Error('x'), { name: 'AbortError' })), 'timeout');
  assert.equal(failureKind(new GuardianModelOutputError('d')), 'bad-output');
  assert.equal(failureKind(new TypeError('fetch failed')), 'network');
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(failureKind(new MetaApiError(429, 'plan credits')), 'http-429');
  } finally {
    console.error = quiet;
  }
});

test('attempt timeouts fit inside the browser limit, twice, and can be overridden', async () => {
  assert.ok(attemptTimeoutMs('spark-open') * 2 < CLIENT_REVIEW_TIMEOUT_MS);
  assert.ok(attemptTimeoutMs('spark') * 2 < CLIENT_REVIEW_TIMEOUT_MS);
  process.env.GUARDIAN_ATTEMPT_TIMEOUT_MS = '5000';
  assert.equal(attemptTimeoutMs('spark-open'), 5000);
  process.env.GUARDIAN_ATTEMPT_TIMEOUT_MS = 'abc';
  assert.equal(attemptTimeoutMs('spark-open'), 130_000);
  delete process.env.GUARDIAN_ATTEMPT_TIMEOUT_MS;
});

test('a timeout on the first attempt is retried once and the second answer is used', () =>
  withEnv(async () => {
    const f = mockFetch(['timeout', { content: GOOD }]);
    const logs = captureLogs();
    try {
      const r = await reviewDocument(INPUT);
      assert.equal(r.provider, 'spark-open');
      assert.equal(f.calls(), 2);
      assert.ok(logs.lines.some((l) => /attempt 1\/2 .*FAILED kind=timeout/.test(l)));
      assert.ok(logs.lines.some((l) => /attempt 2\/2 .* ok/.test(l)));
    } finally {
      logs.restore();
      f.restore();
    }
  }));

test('unreadable JSON on the first attempt is retried once', () =>
  withEnv(async () => {
    const f = mockFetch([{ content: 'sorry, here is prose' }, { content: GOOD }]);
    const logs = captureLogs();
    try {
      await reviewDocument(INPUT);
      assert.equal(f.calls(), 2);
      assert.ok(logs.lines.some((l) => /kind=bad-output/.test(l)));
    } finally {
      logs.restore();
      f.restore();
    }
  }));

test('two failures are reported, and nothing in the logs contains document text', () =>
  withEnv(async () => {
    const f = mockFetch([{ content: `prose that echoes ${SECRET}` }, 'timeout']);
    const logs = captureLogs();
    try {
      await assert.rejects(reviewDocument(INPUT), (e: unknown) => failureKind(e) === 'timeout');
      assert.equal(f.calls(), 2);
      const all = logs.lines.join('\n');
      assert.ok(/attempt 1\/2 .*kind=bad-output/.test(all) && /attempt 2\/2 .*kind=timeout/.test(all));
      assert.ok(!all.includes('Priya') && !all.includes('Sample Road') && !all.includes('411001'));
    } finally {
      logs.restore();
      f.restore();
    }
  }));

test('a provider error status is logged by kind and the second attempt can succeed', () =>
  withEnv(async () => {
    const f = mockFetch([{ status: 503, body: 'upstream busy' }, { content: GOOD }]);
    const logs = captureLogs();
    try {
      await reviewDocument(INPUT);
      assert.ok(logs.lines.some((l) => /kind=http-503/.test(l)));
    } finally {
      logs.restore();
      f.restore();
    }
  }));

test('review failure wording is plain and never exposes provider text', () => {
  assert.match(reviewFailureMessage({ timedOut: true }), /took too long/);
  assert.match(reviewFailureMessage({ status: 429 }), /Too many reviews/);
  assert.match(reviewFailureMessage({ status: 503 }), /not set up/);
  assert.equal(reviewFailureMessage({ status: 400, error: 'pages must be 1 to 120 items' }), 'pages must be 1 to 120 items');
  assert.match(reviewFailureMessage({ status: 502, error: 'The review model did not answer in time' }), /did not answer in time.*Try again/);
  assert.match(reviewFailureMessage({}), /no answer/);
});

test('timing helpers', () => {
  assert.equal(SLOW_NOTICE_MS, 30_000);
  assert.equal(elapsedSeconds(undefined, 5000), 0);
  assert.equal(elapsedSeconds(1000, 31_400), 30);
  assert.equal(elapsedSeconds(5000, 1000), 0);
});
