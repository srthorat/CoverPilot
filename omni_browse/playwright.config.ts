import { defineConfig } from '@playwright/test';

// End-to-end checks against a running build (the Docker image on :3000 by default):
//   BASE_URL=http://localhost:3000 pnpm e2e            Chromium
//   BROWSER=firefox pnpm e2e                           Firefox
// They talk to the real Meta models, so they need the app's API key and take a few minutes.
const browser = (process.env.BROWSER || 'chromium') as 'chromium' | 'firefox';

// `pnpm e2e` runs the acceptance suite only. The voice-in smoke test and the dress rehearsal run when they are
// named: `npx playwright test e2e/voice.spec.ts` or `e2e/rehearsal.spec.ts` (they launch their own Chromium).
const named = process.argv.join(' ');
const testMatch = /voice\.spec|rehearsal\.spec|language\.spec|speech-hi-mr\.spec/.test(named) ? /(voice|rehearsal|language|speech-hi-mr)\.spec\.ts/ : /acceptance\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  testMatch,
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
