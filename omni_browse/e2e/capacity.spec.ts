import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';

// What a visitor sees when the voice agent is already carrying its limit of conversations (MAX_SESSIONS, default 8):
// a plain "busy, try again" message, and a normal session once someone leaves. Eight sessions are held open by the
// load client (support/scripts/loadtest/voice_client.py) in a throwaway container from the same image.
//
//   CLIENT_IMAGE=coverpilot:local BASE_URL=http://localhost:3000 npx playwright test e2e/capacity.spec.ts
//
// Needs docker on the machine running the test, and the app running with the default limit of 8 (no other visitors).

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const IMAGE = process.env.CLIENT_IMAGE || 'coverpilot:local';
const LIMIT = Number(process.env.EXPECTED_LIMIT || 8);
const HOLD_SECONDS = 50;
const NAME = 'lt-capacity-hold';
const loadtestDir = path.resolve(__dirname, '../../support/scripts/loadtest');

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' });
}

test('CAP-01 A visitor is told the assistant is busy when it is full, and gets in once there is room', async () => {
  test.setTimeout(240_000);
  const port = new URL(BASE).port || '80';
  try { docker('rm', '-f', NAME); } catch { /* none left over */ }
  docker(
    'run', '-d', '--name', NAME, '--add-host', 'host.docker.internal:host-gateway', '-v', `${loadtestDir}:/lt:ro`,
    '--entrypoint', '/app/voice-agent-py/.venv/bin/python', IMAGE, '/lt/voice_client.py',
    '--base', `http://host.docker.internal:${port}`, '--sessions', String(LIMIT), '--turns', '0', '--hold', String(HOLD_SECONDS),
  );
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 860 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text().slice(0, 160)}`));
  try {
    // Wait until the held sessions have connected, so the agent is really at its limit.
    await expect.poll(() => docker('logs', NAME).includes(`CONNECTED ${LIMIT}`), { timeout: 60_000, intervals: [1000] }).toBe(true);

    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE);
    await page.getByRole('button', { name: /Start a new policy/ }).click();
    await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
    try {
      await expect(page.getByText(/voice assistant is busy with other visitors/i).first()).toBeVisible({ timeout: 45_000 });
    } catch (e) {
      const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      await page.screenshot({ path: path.resolve(__dirname, '../test-results/capacity-busy-failure.png') }).catch(() => {});
      const hit = text.search(/error|could not|failed|disconnected|reconnecting/i);
      throw new Error(`The busy message did not appear. Page says: ${hit >= 0 ? text.slice(Math.max(0, hit - 60), hit + 260) : '(no error text at all)'}. Console: ${consoleLines.slice(-8).join(' | ')}`);
    }

    // When the held sessions leave, the same visitor can start a session.
    await expect.poll(() => docker('ps', '-q', '--filter', `name=${NAME}`).trim() === '', { timeout: 90_000, intervals: [2000] }).toBe(true);
    await page.waitForTimeout(3000);
    await page.reload();
    await page.getByRole('button', { name: /Start a new policy/ }).click();
    await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
    await expect(page.getByText(/Live session connected/)).toBeVisible({ timeout: 60_000 });
  } finally {
    await ctx.close();
    await browser.close();
    try { docker('rm', '-f', NAME); } catch { /* already gone */ }
  }
});
