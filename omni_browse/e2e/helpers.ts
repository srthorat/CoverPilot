import { expect, type Page } from '@playwright/test';

// Shared by the accessibility and mobile specs. Nothing here needs a live voice session or a microphone:
// the application is filled by typing, the way a customer without a microphone would.

const input = (page: Page, id: string) => page.locator(`#${id} input, input#${id}`).first();

/** Open the app on a clean browser profile and start a new policy (the choice screen is skipped). */
export async function startNewPolicy(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Start a new policy/ })).toBeVisible();
  await page.getByRole('button', { name: /Start a new policy/ }).click();
}

/** Step 1 by typing: every required field. The ID numbers are typed, not scanned. */
export async function fillStep1(page: Page) {
  await input(page, 'input-full-name').fill('Priya Sharma');
  await input(page, 'input-dob').fill('05/03/1992');
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.locator('#select-annual-income').selectOption({ index: 3 });
  await page.locator('#option-smoker-no').click();
  await input(page, 'input-city').fill('Pune');
  await input(page, 'input-pincode').fill('411038');
  await page.getByPlaceholder('12 digits').fill('234123412346');
  await page.getByPlaceholder('ABCDE1234F').fill('ABCPS1234K');
  await page.getByPlaceholder('10 digits').fill('9876543210');
}

/** Steps 2 to 5 after Step 1 is filled; stops on Step 5 (the application check). */
export async function finishApplication(page: Page) {
  await page.getByRole('button', { name: /Continue to Step 2/i }).click();
  await page.locator('#card-no-riders input').check();
  await page.getByRole('button', { name: /Continue to Step 3/i }).click();
  await page.getByPlaceholder('e.g. Priya Ramesh Thorat').fill('Anita Sharma');
  await page.getByPlaceholder('Nominee date of birth (DD/MM/YYYY)').fill('19/08/1996');
  await page.getByRole('button', { name: /Continue to Step 4/i }).click();
  await page.locator('#field-section-45 input[type=checkbox]').check();
  await page.getByRole('button', { name: /Review & Issue Policy/i }).click();
  await expect(page.getByText('Application check')).toBeVisible({ timeout: 15_000 });
}
