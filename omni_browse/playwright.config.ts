import { defineConfig } from '@playwright/test';

// End-to-end checks against a running build (the Docker image on :3000 by default):
//   BASE_URL=http://localhost:3000 pnpm e2e            Chromium
//   BROWSER=firefox pnpm e2e                           Firefox
//   BROWSER=webkit pnpm e2e                            WebKit (the Safari engine; no fake microphone, see below)
// They talk to the real Meta models, so they need the app's API key and take a few minutes.
const browser = (process.env.BROWSER || 'chromium') as 'chromium' | 'firefox' | 'webkit';

// `pnpm e2e` runs the acceptance suite only. The voice-in smoke test and the dress rehearsal run when they are
// named: `npx playwright test e2e/voice.spec.ts` or `e2e/rehearsal.spec.ts` (they launch their own Chromium).
// The engine, phone and accessibility checks run the same way: `e2e/crossbrowser.spec.ts` (any BROWSER), `e2e/mobile.spec.ts`
// (launches its own WebKit and Chromium with phone descriptors) and `e2e/a11y.spec.ts` (axe, Chromium).
const named = process.argv.join(' ');
const testMatch = /voice\.spec|rehearsal\.spec/.test(named)
  ? /(voice|rehearsal)\.spec\.ts/
  : /crossbrowser\.spec|mobile\.spec|a11y\.spec/.test(named)
  ? /(crossbrowser|mobile|a11y)\.spec\.ts/
  : /acceptance\.spec\.ts/;

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
    // WebKit has no fake-microphone switch, so a live voice session cannot start there; checks that need one skip.
    launchOptions:
      browser === 'chromium'
        ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
        : browser === 'firefox'
        ? { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } }
        : {},
  },
});
