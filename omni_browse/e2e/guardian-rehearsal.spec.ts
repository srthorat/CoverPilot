import { chromium, expect, test } from '@playwright/test';

// Repeats the Guardian part of the demo (sample document with issues, Run Integrity Guardian) many times in a
// fresh page each time and records, for every run, what the customer saw: the /api/guardian status and time, whether
// the findings panel appeared, and the review panel text when it did not. It exists to catch the rare stall the
// dress rehearsal showed once. Run on its own: `GUARDIAN_LOOPS=15 npx playwright test e2e/guardian-rehearsal.spec.ts`.
// WITH_SESSION=1 connects the live voice session first (as the rehearsal does).

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const LOOPS = Number(process.env.GUARDIAN_LOOPS || 10);
const WITH_SESSION = process.env.WITH_SESSION === '1';
const WAIT_MS = Number(process.env.GUARDIAN_WAIT_MS || 60_000);
// The route allows 6 reviews a minute per visitor; stay under it so a 429 is never the thing being measured.
const MIN_GAP_MS = 11_000;

test('GUARDIAN loop: every run shows its findings, or says clearly why not', async () => {
  test.setTimeout(LOOPS * (WAIT_MS + 60_000));
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const outcomes: string[] = [];
  let lastStart = 0;
  for (let i = 0; i < LOOPS; i++) {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['microphone'] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(25_000);
    const net: string[] = [];
    const consoleErrors: string[] = [];
    page.on('response', async (r) => {
      if (r.url().includes('/api/guardian')) net.push(`${r.status()} @${((Date.now() - lastStart) / 1000).toFixed(1)}s`);
    });
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 120)));
    page.on('pageerror', (e) => consoleErrors.push(`pageerror ${String(e).slice(0, 120)}`));
    let outcome = '';
    try {
      await page.goto(BASE);
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE);
      await page.getByRole('button', { name: /Start a new policy/ }).click();
      if (WITH_SESSION) {
        await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
        await expect(page.getByText(/Live session connected/)).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(2000);
      }
      await page.locator('#field-full-name input').fill('Priya Sharma'); // gives the application content, so it is compared
      await page.getByRole('button', { name: /Integrity Guardian: review/ }).click();
      await page.getByRole('button', { name: 'Sample proposed policy (with issues)' }).click();
      await expect(page.getByText(/4 pages, read in your browser/)).toBeVisible({ timeout: 30_000 });
      const clickedAt = Date.now();
      await page.getByRole('button', { name: 'Run Integrity Guardian' }).click();
      const deadline = clickedAt + WAIT_MS;
      while (Date.now() < deadline) {
        const text = await page.evaluate(() => document.body.innerText);
        const panel = await page.getByText('Checks against your application and the rules').locator('xpath=..').innerText({ timeout: 500 }).catch(() => '');
        if (/sum assured of/.test(panel)) {
          outcome = `ok findings after ${((Date.now() - clickedAt) / 1000).toFixed(1)}s`;
          break;
        }
        if (/Review failed/.test(text)) {
          outcome = `ERROR shown after ${((Date.now() - clickedAt) / 1000).toFixed(1)}s: ${(text.match(/Review failed[^\n]*/) || [''])[0].slice(0, 160)}`;
          break;
        }
        await page.waitForTimeout(500);
      }
      if (!outcome) {
        const text = await page.evaluate(() => document.body.innerText);
        const panel = (text.split('Document to review:')[1] || '').replace(/\s+/g, ' ').slice(0, 900);
        outcome = `STALL no findings and no error after ${WAIT_MS / 1000}s; reviewed-by shown=${/Reviewed by/.test(text)}; running=${/Reading|Running|Reviewing/.test(text)}; panel: ${panel}`;
      }
    } catch (e) {
      outcome = `HARNESS ${String((e as Error).message).split('\n')[0].slice(0, 160)}`;
    }
    const line = `loop ${String(i + 1).padStart(2, '0')}: ${outcome} | /api/guardian: ${net.join(', ') || 'no request'}${consoleErrors.length ? ` | console: ${consoleErrors.slice(0, 3).join(' ; ')}` : ''}`;
    outcomes.push(line);
    console.log(line);
    await ctx.close();
  }
  await browser.close();
  const bad = outcomes.filter((l) => !/: ok findings/.test(l));
  console.log(`SUMMARY ${LOOPS - bad.length}/${LOOPS} showed findings`);
  expect(bad, bad.join('\n')).toEqual([]);
});
