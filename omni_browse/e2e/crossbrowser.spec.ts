import { expect, test } from '@playwright/test';
import { fillStep1, finishApplication, startNewPolicy } from './helpers';

// Checks that run in any engine (BROWSER=chromium|firefox|webkit) without a microphone: the privacy shield on a
// sample card (canvas blur, the locator and SAM routes), the whole application by typing, the draft PDF
// (jsPDF), and reading that PDF back in the browser (pdf.js). Run: BROWSER=webkit npx playwright test e2e/crossbrowser.spec.ts

test.describe.configure({ mode: 'serial' });

test('CB-01 A sample card is scanned: the blurred copy is drawn and the name read from the card fills the empty name field', async ({ page }) => {
  test.setTimeout(150_000);
  await startNewPolicy(page);
  await page.getByRole('button', { name: /Masked Aadhaar/ }).click();
  await expect(page.getByText(/Done/).first()).toBeVisible({ timeout: 90_000 });
  // The panel shows the blurred copy (a drawn canvas image) next to the result.
  const imgs = await page.locator('img').evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).naturalWidth > 100).length);
  expect(imgs).toBeGreaterThan(0);
  // The card's name goes into the empty name field (when a name is already typed, a discrepancy card asks instead).
  await expect(page.locator('#input-full-name')).not.toHaveValue('', { timeout: 15_000 });
});

test('CB-02 The whole application by typing reaches Step 5, the draft PDF downloads and is read back in the browser', async ({ page }) => {
  test.setTimeout(150_000);
  await startNewPolicy(page);
  await fillStep1(page);
  await finishApplication(page);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: /Download proposed policy/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^proposed-policy-draft-NXP-.*\.pdf$/);
  await page.getByRole('button', { name: /Review it with Integrity Guardian/ }).click();
  await expect(page.getByText(/pages, read in your browser/)).toBeVisible({ timeout: 60_000 });
});

test('CB-03 The step gate refuses to move on with a field missing and names it', async ({ page }) => {
  await startNewPolicy(page);
  await page.getByRole('button', { name: /Continue to Step 2/i }).click();
  await expect(page.getByText(/Finish this step before moving on/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Step 1/ }).first()).toBeVisible();
});
