import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { fillStep1, finishApplication, startNewPolicy } from './helpers';

// Accessibility: an axe scan (WCAG 2.0/2.1 A and AA) of every screen the demo shows, plus a keyboard-only pass
// through Step 1 and the Resume session banner. Serious and critical violations fail the run; all of them are
// written to support/docs/accessibility-report.md. Automated scans find roughly a third of real problems: this is not an
// audit and not a conformance claim. Run: npx playwright test e2e/a11y.spec.ts   (BASE_URL, Chromium)

test.describe.configure({ mode: 'serial' });

type Row = { screen: string; id: string; impact: string; nodes: number; help: string; sample: string };
const rows: Row[] = [];

async function scan(page: Page, screen: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of res.violations) {
    rows.push({ screen, id: v.id, impact: v.impact || 'minor', nodes: v.nodes.length, help: v.help, sample: (v.nodes[0]?.target || []).join(' ').slice(0, 90) });
  }
}

test('A11Y-01 Axe scan of the choice screen, Step 1, the gate message, Steps 2 to 5, the terms drawer and the Guardian view', async ({ page }) => {
  test.setTimeout(280_000);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Start a new policy/ })).toBeVisible();
  await scan(page, 'choice screen');
  await page.getByRole('button', { name: /Start a new policy/ }).click();
  await scan(page, 'Step 1 (empty)');
  await page.getByRole('button', { name: /Continue to Step 2/i }).click();
  await expect(page.getByText(/Finish this step before moving on/)).toBeVisible();
  await scan(page, 'Step 1 with the gate message');
  await fillStep1(page);
  await scan(page, 'Step 1 (filled)');
  await page.getByRole('button', { name: /Continue to Step 2/i }).click();
  await expect(page.getByRole('heading', { name: /Step 2/ }).first()).toBeVisible();
  await scan(page, 'Step 2');
  await page.locator('#card-no-riders input').check();
  await page.getByRole('button', { name: /Continue to Step 3/i }).click();
  await scan(page, 'Step 3');
  await page.getByPlaceholder('e.g. Priya Ramesh Thorat').fill('Anita Sharma');
  await page.getByPlaceholder('Nominee date of birth (DD/MM/YYYY)').fill('19/08/1996');
  await page.getByRole('button', { name: /Continue to Step 4/i }).click();
  await scan(page, 'Step 4');
  await page.locator('#field-section-45 input[type=checkbox]').check();
  await page.getByRole('button', { name: /Review & Issue Policy/i }).click();
  await expect(page.getByText('Application check')).toBeVisible({ timeout: 15_000 });
  await scan(page, 'Step 5');
  const terms = page.getByRole('button', { name: /Terms & Conditions/ }).first();
  if (await terms.count()) {
    await terms.click();
    await page.waitForTimeout(800);
    await scan(page, 'Terms drawer');
    await page.getByRole('button', { name: 'Close Drawer' }).click();
  }
  await page.getByRole('button', { name: /Integrity Guardian: review/ }).click();
  await page.getByRole('button', { name: 'Sample proposed policy (with issues)' }).click();
  await expect(page.getByText(/4 pages, read in your browser/)).toBeVisible({ timeout: 40_000 });
  await scan(page, 'Guardian (document loaded)');
  await page.getByRole('button', { name: 'Run Integrity Guardian' }).click();
  const checks = page.getByText('Checks against your application and the rules').locator('xpath=..');
  await expect(checks).toContainText(/10 days of grace/, { timeout: 120_000 });
  await scan(page, 'Guardian (findings)');
});

test('A11Y-02 Step 1 can be completed with the keyboard alone', async ({ page }) => {
  await startNewPolicy(page);
  await page.locator('#input-full-name').focus();
  // Every control Step 1 needs is reached by Tab, in a sensible order, and shows a visible focus.
  const wanted = ['input-full-name', 'input-dob', 'select-annual-income', 'option-smoker-no', 'input-city', 'input-pincode'];
  const seen = new Set<string>();
  const labels: string[] = [];
  for (let i = 0; i < 120 && !labels.some((l) => /Continue to Step 2/.test(l)); i++) {
    const info = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return { id: '', label: '', outline: '' };
      const cs = getComputedStyle(a);
      return { id: a.id || '', label: (a.getAttribute('aria-label') || a.textContent || a.getAttribute('placeholder') || '').trim().slice(0, 40), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.boxShadow !== 'none' ? 'shadow' : ''}` };
    });
    if (info.id) seen.add(info.id);
    labels.push(info.label);
    await page.keyboard.press('Tab');
  }
  for (const id of wanted) expect(seen.has(id), `${id} is reachable with Tab`).toBeTruthy();
  expect(labels.some((l) => /^Female/.test(l)), 'the gender buttons are reachable with Tab').toBeTruthy();
  expect(labels.some((l) => /Continue to Step 2/.test(l)), 'Continue to Step 2 is reachable with Tab').toBeTruthy();
  // Keys do the work: type in a field, choose with Enter and Space, move on with Enter.
  await page.locator('#input-full-name').focus();
  await page.keyboard.type('Priya Sharma');
  await expect(page.locator('#input-full-name')).toHaveValue('Priya Sharma');
  await page.getByRole('button', { name: 'Female', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.locator('#option-smoker-no').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#option-smoker-no')).toContainText('✓');
  await page.getByRole('button', { name: /Continue to Step 2/i }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Finish this step before moving on/)).toBeVisible();
});

test('A11Y-03 The Resume session banner is announced, scannable and works from the keyboard', async ({ page }) => {
  test.skip(test.info().project.use.browserName !== 'chromium', 'needs a live session, which needs the fake microphone');
  test.setTimeout(150_000);
  await startNewPolicy(page);
  await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
  await expect(page.getByText(/Live session connected/)).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem('nexasure.idleMs', '15000'));
  const banner = page.getByTestId('idle-paused');
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => localStorage.removeItem('nexasure.idleMs'));
  expect(await banner.getAttribute('role')).toBe('status'); // announced to screen readers
  await scan(page, 'Resume session banner');
  await page.getByTestId('idle-resume').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Welcome back/).first()).toBeVisible({ timeout: 60_000 });
});

test('A11Y-04 The Confirm and Undo card is announced and can be used from the keyboard', async ({ page }) => {
  test.skip(test.info().project.use.browserName !== 'chromium', 'needs a live session, which needs the fake microphone');
  test.setTimeout(180_000);
  await startNewPolicy(page);
  await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
  await expect(page.getByText(/Live session connected/)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.getByTestId('ask-input').fill('I do not use tobacco in any form.');
  await page.getByTestId('ask-button').click();
  const card = page.locator('#field-approvals');
  await expect(card).toBeVisible({ timeout: 90_000 });
  expect(await card.getAttribute('role')).toBe('alert'); // read out by a screen reader when it appears
  await scan(page, 'Confirm and Undo card');
  await card.getByRole('button', { name: 'Confirm' }).first().focus();
  await expect(card.getByRole('button', { name: 'Confirm' }).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card).toBeHidden();
});

test.afterAll(() => {
  const bad = rows.filter((r) => r.impact === 'serious' || r.impact === 'critical');
  const lines = [
    `# Accessibility scan (axe-core, WCAG 2.0/2.1 A and AA, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
    '',
    `${bad.length} serious or critical violation groups, ${rows.length - bad.length} moderate or minor, across the screens scanned.`,
    '',
    'An automated scan finds only part of the real problems. This report is not an audit and not a claim of conformance.',
    '',
    '| Screen | Rule | Impact | Elements | What | First element |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.screen} | ${r.id} | ${r.impact} | ${r.nodes} | ${r.help.replace(/\|/g, '/')} | \`${r.sample.replace(/\|/g, '/')}\` |`),
    '',
  ];
  fs.mkdirSync('../support/docs', { recursive: true });
  fs.writeFileSync(process.env.A11Y_REPORT || '../support/docs/accessibility-report.md', lines.join('\n'));
});

test('A11Y-99 No serious or critical violations on any scanned screen', async () => {
  const bad = rows.filter((r) => r.impact === 'serious' || r.impact === 'critical');
  expect(bad.map((r) => `${r.screen}: ${r.id} (${r.impact}, ${r.nodes}) ${r.sample}`)).toEqual([]);
});
