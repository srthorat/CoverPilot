import { defineConfig } from '@playwright/test';

// End-to-end checks against a running build (the Docker image on :3000 by default):
//   BASE_URL=http://localhost:3000 pnpm e2e            Chromium
//   BROWSER=firefox pnpm e2e                           Firefox
// They talk to the real Meta models, so they need the app's API key and take a few minutes.
const browser = (process.env.BROWSER || 'chromium') as 'chromium' | 'firefox';

export default defineConfig({
  testDir: './e2e',
  timeout: 100_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['./e2e/report.ts']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    browserName: browser,
    viewport: { width: 1512, height: 860 },
    permissions: browser === 'chromium' ? ['microphone'] : [],
    launchOptions:
      browser === 'chromium'
        ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
        : { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } },
  },
});
