import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';

// Voice-in smoke test: every other check types its questions. This one SPEAKS to the agent: Chromium feeds a WAV
// file to the page as the microphone, so the audio goes through Muse Voice Transcribe, the agent and a form action
// with nobody typing. Run it on its own: `npx playwright test e2e/voice.spec.ts` (Chromium only).
//
// The file e2e/assets/priya-sharma.wav was made on macOS with:
//   say -v Rishi -o name.aiff "My full name is Priya Sharma"
//   afconvert -f WAVE -d LEI16@16000 -c 1 name.aiff name16.wav
//   then padded with 1.5 s of leading silence and 6 s of trailing silence (python wave module), 16 kHz mono 16-bit
// Chromium loops the file for the whole session, so the sentence can be heard more than once: the assertions allow that.

const WAV = path.resolve(__dirname, 'assets/priya-sharma.wav');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

test('VOICE-01 Spoken words reach the agent and fill the form with nobody typing', async () => {
  test.setTimeout(240_000);
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
  });
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 860 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE);

    // Can this browser deliver the file as a microphone? Listen to it for a few seconds before involving the app.
    const heard = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const analyser = ac.createAnalyser();
      ac.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let peak = 0;
      const end = Date.now() + 6000;
      while (Date.now() < end) {
        analyser.getFloatTimeDomainData(buf);
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        await new Promise((r) => setTimeout(r, 50));
      }
      stream.getTracks().forEach((t) => t.stop());
      await ac.close();
      return peak;
    });
    test.skip(heard < 0.01, `Chromium did not play the fake audio file as a microphone here (peak level ${heard.toFixed(4)}), so there is nothing to speak`);

    await page.getByRole('button', { name: /Start a new policy/ }).click();
    await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
    await expect(page.getByText(/Live session connected/)).toBeVisible({ timeout: 60_000 });

    // Microphone -> Voice Transcribe -> agent -> fill action -> the field.
    const name = page.locator('#field-full-name input');
    await expect(name).toHaveValue(/Priya/i, { timeout: 90_000 });
    await expect(name).toHaveValue(/Sharma/i);

    // The customer turn is in the transcript, and it came from voice (the app prefixes what it heard with "You").
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).toMatch(/You[\s\S]{0,80}Priya/i);
  } finally {
    await browser.close();
  }
});
