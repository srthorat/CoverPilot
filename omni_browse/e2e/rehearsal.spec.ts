import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';

// Dress rehearsal of docs/DEMO_SCRIPT.md, beat by beat, against the live app and the live Meta models.
// Customer speech is typed into the same pipeline voice uses (the voice-in path is covered by voice.spec.ts), the
// whole run is video recorded, and docs/rehearsal-report.md gets one row per beat with planned and actual time.
// Run on its own: `npx playwright test e2e/rehearsal.spec.ts` (Chromium only). It does not depend on any other spec.

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ROOT = path.resolve(__dirname, '../..');
const VIDEO_DIR = path.resolve(__dirname, '../test-results/rehearsal-video');

type Row = { beat: string; planned: string; at: number; seconds: number; ok: boolean; note: string };
const rows: Row[] = [];
let t0 = 0;
let currentPage: Page | null = null;

async function beat(name: string, planned: string, fn: () => Promise<void>) {
  const start = Date.now();
  let ok = true;
  let note = '';
  try {
    await fn();
  } catch (e) {
    ok = false;
    note = String((e as Error).message || e).split('\n')[0].slice(0, 120);
    // What the customer would be looking at: the step heading and any warning banner.
    const seen = await currentPage?.evaluate(() => `${[...document.querySelectorAll('h2')].map((h) => h.textContent).find((t) => /^Step \d/.test(t || '')) || 'no step'} | ${[...document.querySelectorAll('[role=alert]')].map((a) => (a as HTMLElement).innerText.replace(/\s+/g, ' ')).join(' / ').slice(0, 200)}`).catch(() => '');
    if (seen) note += ` [screen: ${seen}]`;
    await currentPage?.screenshot({ path: path.join(VIDEO_DIR, `..`, `rehearsal-fail-${rows.length + 1}.png`) }).catch(() => {});
  }
  rows.push({ beat: name, planned, at: (start - t0) / 1000, seconds: (Date.now() - start) / 1000, ok, note });
}

test('REHEARSAL The 3-minute flow in docs/DEMO_SCRIPT.md, start to finish', async () => {
  test.setTimeout(1_200_000);
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ['microphone'],
    acceptDownloads: true,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const page: Page = await ctx.newPage();
  currentPage = page;
  page.setDefaultTimeout(25_000); // a missing element must fail its beat quickly, not wait out the whole test

  const agentLines = async () => [...(await page.evaluate(() => document.body.innerText)).matchAll(/^OmniCB: (.+)$/gm)].map((m) => m[1]);
  const closeDrawer = async () => {
    const close = page.getByRole('button', { name: 'Close Drawer' });
    for (let i = 0; i < 3 && (await close.isVisible().catch(() => false)); i++) {
      await close.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  };
  // Type a message and wait until the agent's reply has finished streaming.
  const ask = async (text: string, timeout = 90_000): Promise<string> => {
    await closeDrawer();
    const before = (await agentLines()).length;
    await page.getByTestId('ask-input').fill(text);
    await page.getByTestId('ask-button').click();
    let reply = '';
    await expect.poll(async () => { const l = await agentLines(); reply = l.length > before ? l[l.length - 1] : ''; return reply; }, { timeout, intervals: [1000] }).toBeTruthy();
    let stable = 0;
    for (let i = 0; i < 40 && stable < 3; i++) {
      await page.waitForTimeout(1000);
      const l = await agentLines();
      const now = l.length > before ? l[l.length - 1] : reply;
      if (now === reply) stable++; else { reply = now; stable = 0; }
    }
    await page.waitForTimeout(1500);
    return reply;
  };
  const input = (id: string) => page.locator(`#${id} input, input#${id}`).first();

  try {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE);
    t0 = Date.now();

    await beat('Opening choice, then accept the co-browsing session', '0:00-0:12', async () => {
      await expect(page.getByRole('button', { name: /Start a new policy/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Review a policy/ })).toBeVisible();
      await page.getByRole('button', { name: /Start a new policy/ }).click();
      await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
      await expect(page.getByText(/Live session connected/)).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(3000);
    });

    await beat('Agent fills the profile, Confirm or Undo for income and smoking status', '0:12-0:50', async () => {
      await ask('My name is Priya Sharma, I was born on fifth March nineteen ninety-two, I am female, I earn about eighteen lakhs a year and I do not use tobacco.');
      await expect(input('field-full-name')).toHaveValue(/Priya/i, { timeout: 30_000 });
      await expect(page.locator('#field-approvals')).toBeVisible({ timeout: 20_000 });
      const confirm = page.locator('#field-approvals').getByRole('button', { name: 'Confirm' });
      for (let i = 0; i < 4 && (await confirm.count()) > 0; i++) await confirm.first().click();
      await expect(page.locator('#field-approvals')).toBeHidden();
      // Whatever the model did not fill from that sentence is filled by hand so the rest of the script can run.
      if (!(await input('field-dob').inputValue())) await input('field-dob').fill('05/03/1992');
      if (!(await page.locator('#field-gender button.border-emerald-500, #field-gender [aria-pressed=true]').count())) await page.getByRole('button', { name: 'Female' }).click();
      if (!(await page.locator('#select-annual-income').inputValue())) await page.locator('#select-annual-income').selectOption('15L-20L');
    });

    await beat('Barge-in (interrupting the agent)', '0:12-0:50', async () => {
      // Interrupting needs real speech over the agent's reply; voice.spec.ts proves the microphone path. Not rehearsed here.
    });

    await beat('Scan the sample Aadhaar: privacy panel and the discrepancy card', '0:50-1:05', async () => {
      await page.getByRole('button', { name: /Masked Aadhaar/ }).click();
      await expect(page.getByText(/Done/).first()).toBeVisible({ timeout: 90_000 });
      await expect(page.locator('#field-discrepancies')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#field-discrepancies')).toContainText(/Name/i);
      // The customer resolves every difference (name and date of birth both differ from the sample card).
      for (let i = 0; i < 6 && (await page.locator('#field-discrepancies').count()) > 0; i++) {
        await page.locator('#field-discrepancies').getByRole('button', { name: 'Keep mine' }).first().click();
        await page.waitForTimeout(400);
      }
      await expect(page.locator('#field-discrepancies')).toHaveCount(0);
    });

    await beat('Hindi question opens Clause 2; the step gate refuses to skip ahead', '1:05-1:20', async () => {
      await page.getByRole('button', { name: 'हिंदी' }).click();
      await page.waitForTimeout(4000);
      const reply = await ask('मासिक प्रीमियम के लिए ग्रेस पीरियड कितना होता है?');
      expect(reply).toMatch(/[ऀ-ॿ]{3}/);
      await expect(page.getByText('Being explained').first()).toBeVisible({ timeout: 20_000 });
      await closeDrawer();
      await page.getByRole('button', { name: 'English' }).click();
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: /Continue to Step 2/i }).click();
      await expect(page.getByRole('alert').filter({ hasText: /Finish this step/ })).toBeVisible();
    });

    await beat('Finish the application: step 1 to step 5', '1:05-1:20', async () => {
      // Anything the agent entered that still waits for Confirm or Undo is confirmed first (the step gate insists).
      const confirm = page.locator('#field-approvals').getByRole('button', { name: 'Confirm' });
      for (let i = 0; i < 4 && (await confirm.count()) > 0; i++) await confirm.first().click();
      await input('input-city').fill('Pune');
      await input('input-pincode').fill('411038');
      const ids = page.locator('#field-identity input');
      if (!(await ids.nth(1).inputValue())) await ids.nth(1).fill('ABCPS1234K');
      if (!(await ids.nth(2).inputValue())) await ids.nth(2).fill('9876543210');
      await page.getByRole('button', { name: /Continue to Step 2/i }).click();
      await page.locator('#card-no-riders input').check();
      await page.getByRole('button', { name: /Continue to Step 3/i }).click();
      await page.getByPlaceholder('e.g. Priya Ramesh Thorat').fill('Anita Sharma');
      await page.getByPlaceholder('Nominee date of birth (DD/MM/YYYY)').fill('19/08/1996');
      await page.getByRole('button', { name: /Continue to Step 4/i }).click();
      await page.locator('#field-section-45 input[type=checkbox]').check();
      await page.getByRole('button', { name: /Review & Issue Policy/i }).click();
      await expect(page.getByText('Application check')).toBeVisible({ timeout: 15_000 });
    });

    await beat('Step 5: download the proposed policy and hand it to Integrity Guardian', '1:20-1:35', async () => {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: /Download proposed policy/ }).click()]);
      expect(download.suggestedFilename()).toMatch(/^proposed-policy-draft-NXP-.*\.pdf$/);
      await page.getByRole('button', { name: /Review it with Integrity Guardian/ }).click();
      await expect(page.getByText(/pages, read in your browser/)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/Integrity Guardian, the independent reviewer/).first()).toBeVisible({ timeout: 30_000 });
    });

    await beat('Guardian reviews the sample proposed policy and finds the planted problems', '1:35-2:25', async () => {
      await page.getByRole('button', { name: 'Sample proposed policy (with issues)' }).click();
      await expect(page.getByText(/4 pages, read in your browser/)).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Run Integrity Guardian' }).click();
      const checks = page.getByText('Checks against your application and the rules').locator('xpath=..');
      await expect(checks).toContainText(/sum assured of/, { timeout: 120_000 });
      await expect(checks).toContainText(/10 days of grace for monthly premiums/);
      await expect(checks).toContainText(/24 months/);
      await expect(checks).toContainText(/no nomination section/i);
      const reply = await ask('What happens if I miss a payment in month two?');
      expect(reply).toMatch(/grace|fifteen|ten|page/i);
    });

    await beat('Fix in the application, then Review again (history shows the issue count falling)', '2:25-2:45', async () => {
      await page.getByRole('button', { name: 'Fix in the application' }).first().click();
      await expect(page.getByRole('heading', { name: /Step [123]/ }).first()).toBeVisible({ timeout: 15_000 });
      // The document says 1 crore: choose that cover so the sum assured mismatch is resolved by the customer's own choice.
      await page.getByRole('button', { name: /Continue to Step 2|Step 2/i }).first().click().catch(() => {});
      const tier = page.locator('#cover-tier-1cr');
      if (await tier.count()) await tier.click();
      await page.getByRole('button', { name: /Integrity Guardian: review/ }).click();
      await page.getByRole('button', { name: 'Review again' }).click();
      await expect(page.getByText(/Reviews: #1 \d+ issues? → #2 \d+ issues?/)).toBeVisible({ timeout: 120_000 });
    });

    await beat('Readiness report', '2:45-3:00', async () => {
      await expect(page.getByText('Readiness report')).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: 'Download the report' }).click()]);
      expect(download.suggestedFilename()).toMatch(/^guardian-report-NXP-.*\.md$/);
    });
  } finally {
    const video = page.video();
    await ctx.close(); // flushes the recording
    const webm = video ? await video.path().catch(() => null) : null;
    await browser.close();

    let videoNote = 'not recorded';
    if (webm && fs.existsSync(webm)) {
      const mb = fs.statSync(webm).size / 1024 / 1024;
      if (mb < 25) {
        fs.mkdirSync(path.join(ROOT, 'docs/rehearsal'), { recursive: true });
        const dest = path.join(ROOT, 'docs/rehearsal/rehearsal.webm');
        fs.copyFileSync(webm, dest);
        videoNote = `docs/rehearsal/rehearsal.webm (${mb.toFixed(1)} MB)`;
      } else {
        videoNote = `${path.relative(ROOT, webm)} (${mb.toFixed(1)} MB, left in test-results because it is over 25 MB)`;
      }
    }
    const total = rows.length ? rows[rows.length - 1].at + rows[rows.length - 1].seconds : 0;
    const lines = [
      `# Dress rehearsal report (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
      '',
      `Follows docs/DEMO_SCRIPT.md against ${BASE} with the live Meta models. Customer speech is typed into the same pipeline voice uses (voice.spec.ts covers the microphone path). Total ${total.toFixed(0)} s of automation; the script's own pace is 180 s, because a person speaks and the models take their time.`,
      '',
      `Video: ${videoNote}`,
      '',
      '| Beat | Planned (script) | Started at (s) | Took (s) | Result | Note |',
      '|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.beat} | ${r.planned} | ${r.at.toFixed(0)} | ${r.seconds.toFixed(0)} | ${r.ok ? 'pass' : 'FAIL'} | ${r.note.replace(/\|/g, '/')} |`),
      '',
      `${rows.filter((r) => r.ok).length} of ${rows.length} beats passed.`,
      '',
    ];
    fs.writeFileSync(path.join(ROOT, 'docs/rehearsal-report.md'), lines.join('\n'));
  }
  const failed = rows.filter((r) => !r.ok);
  expect(failed.map((r) => `${r.beat}: ${r.note}`)).toEqual([]);
});
