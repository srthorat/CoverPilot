# Browsers, phones and accessibility: what is tested

Run against the Docker image with the live Meta models. Reports: `docs/acceptance-report-<browser>.md`, `docs/extra-checks-report-<browser>.md`, `docs/accessibility-report.md` (and `-before.md` for the first scan), `docs/mobile-layout-findings.txt`.

| Area | How | Result on the last run |
|---|---|---|
| Chromium | full acceptance suite (`scripts/run-acceptance.sh`) | 22 of 22 |
| Firefox | `BROWSER=firefox scripts/run-acceptance.sh` | 22 of 22 |
| WebKit (the Safari engine) | `BROWSER=webkit scripts/run-acceptance.sh` | 5 pass, 17 skipped: they need a live voice session and WebKit in Playwright has no fake microphone |
| Engine checks without a microphone (`e2e/crossbrowser.spec.ts`) | scan a sample card (privacy shield), type the whole application, download the draft PDF and read it back with pdf.js, step gate | 3 of 3 in each engine |
| Phones (`e2e/mobile.spec.ts`) | iPhone 13 (WebKit) and Pixel 7 (Chromium) emulation through the choice screen, Step 1, step gate, Step 2, Guardian review; fails on any sideways overflow | 2 of 2 |
| Accessibility (`e2e/a11y.spec.ts`) | axe-core WCAG 2.0/2.1 A and AA scan of every screen, keyboard-only Step 1, Resume session banner and Confirm/Undo card by keyboard | 0 serious or critical groups (19 at the first scan) |

## What this does not show
- Voice in Safari. A real Safari asks for the microphone each time; nothing here exercises mobile Safari's audio, the on-screen keyboard, or a real phone's camera. Emulation covers layout and touch only.
- The WebKit run skips every check that talks to the agent. The review, privacy shield, PDF and resume paths do run there.
- An automated scan finds only part of the real accessibility problems. This is not an audit and not a claim of WCAG conformance. Screen readers were not used.
- The demo is built desktop first. On a phone the page now scrolls normally instead of trapping the form in a small window, but the layout is functional, not designed for a phone.
