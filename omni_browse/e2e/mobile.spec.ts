import { chromium, devices, expect, test, webkit, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import { fillStep1, startNewPolicy } from './helpers';

// Phone emulation through the core flow with no microphone: the choice screen, Step 1 by typing, the step gate,
// Step 2, and the Guardian tab with a sample document. Each screen is checked for sideways scrolling and for
// controls that sit outside the viewport. Emulation is not a real device: it covers layout and touch, not
// mobile Safari's audio or camera behaviour. Run: BASE_URL=... npx playwright test e2e/mobile.spec.ts

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PHONES = [
  { name: 'iPhone 13 (WebKit)', device: devices['iPhone 13'], engine: webkit },
  { name: 'Pixel 7 (Chromium)', device: devices['Pixel 7'], engine: chromium },
] as const;

/** Elements wider than the screen that are not inside a scroll container of their own. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrolls = (el: Element | null) => {
      for (let e = el?.parentElement ?? null; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (o === 'auto' || o === 'scroll') return true; // a container the customer can scroll; clipped content (hidden) still counts
      }
      return false;
    };
    const bad: string[] = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + 1 && !scrolls(el)) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} right=${Math.round(r.right)} vw=${vw}`);
    });
    return { pageScrollsSideways: document.documentElement.scrollWidth > vw + 1, scrollWidth: document.documentElement.scrollWidth, vw, offenders: bad.slice(0, 8) };
  });
}

const findings: string[] = [];

for (const phone of PHONES) {
  test(`MB ${phone.name}: choice screen, Step 1, step gate, Step 2 and the Guardian tab fit the screen`, async () => {
    test.setTimeout(100_000); // both phones take about 22 s
    const browser: Browser = await phone.engine.launch();
    const ctx = await browser.newContext({ ...phone.device, baseURL: BASE, permissions: [] });
    const page = await ctx.newPage();
    const note = async (where: string) => {
      const o = await overflow(page);
      if (o.pageScrollsSideways || o.offenders.length) findings.push(`${phone.name} / ${where}: scrollWidth ${o.scrollWidth} vs ${o.vw}; ${o.offenders.join('; ')}`);
      return o;
    };
    try {
      await page.goto('/');
      await expect(page.getByRole('button', { name: /Start a new policy/ })).toBeVisible();
      await note('choice screen');
      await startNewPolicy(page);
      await note('Step 1');
      // The primary buttons can be reached by scrolling and are inside the screen sideways.
      const gateBtn = page.getByRole('button', { name: /Continue to Step 2/i });
      await gateBtn.scrollIntoViewIfNeeded();
      const box = await gateBtn.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= (page.viewportSize()?.width ?? 0) + 1, 'Continue button is inside the screen').toBeTruthy();
      await gateBtn.click();
      await expect(page.getByText(/Finish this step before moving on/)).toBeVisible();
      await fillStep1(page);
      await note('Step 1 filled');
      await gateBtn.scrollIntoViewIfNeeded();
      await gateBtn.click();
      await expect(page.getByRole('heading', { name: /Step 2/ }).first()).toBeVisible({ timeout: 15_000 });
      await note('Step 2');
      await page.getByRole('button', { name: /Integrity Guardian: review/ }).click();
      await page.getByRole('button', { name: 'Sample proposed policy (with issues)' }).click();
      await expect(page.getByText(/4 pages, read in your browser/)).toBeVisible({ timeout: 40_000 });
      await note('Guardian before review');
      await page.getByRole('button', { name: 'Run Integrity Guardian' }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Run Integrity Guardian' }).click();
      const checks = page.getByText('Checks against your application and the rules').locator('xpath=..');
      await expect(checks).toContainText(/10 days of grace/, { timeout: 120_000 });
      await note('Guardian findings');
    } finally {
      await ctx.close();
      await browser.close();
    }
    expect(findings.filter((f) => f.startsWith(phone.name)), 'no sideways overflow on any screen').toEqual([]);
  });
}

test.afterAll(() => {
  fs.mkdirSync('../support/docs', { recursive: true });
  fs.writeFileSync('../support/docs/mobile-layout-findings.txt', findings.length ? findings.join('\n') + '\n' : 'No sideways overflow or off-screen offenders found.\n');
});
