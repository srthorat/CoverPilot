import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { devanagariShare } from '../src/lib/script-check';
import { LANG_QUESTIONS, classifyReply, type Lang } from './language-helpers';

// Language reliability: how often does each agent answer in the language of the screen setting (Hindi or Marathi,
// in Devanagari)? Questions are typed into the same pipeline voice uses. Both agents (co-browse and Integrity
// Guardian) and both languages are measured, and the spoken acknowledgement line is checked separately from the
// final answer because both are spoken. Results go to LANG_RESULTS (default <tmp>/language-results.json) and the
// summary is printed. Run on its own: LANG_TAG=after npx playwright test e2e/language.spec.ts   (Chromium)
//   LANG_COUNT=20 questions per language and agent by default (set a smaller number for a quick run).

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const COUNT = Number(process.env.LANG_COUNT || 20);
const TAG = process.env.LANG_TAG || 'run';
const OUT = process.env.LANG_RESULTS || path.join(os.tmpdir(), `language-results-${TAG}.json`);

interface Row {
  scenario: string;
  agent: 'cobrowse' | 'guardian';
  lang: Lang;
  question: string;
  ack: string | null;
  reply: string;
  replyMs: number;
  replyOk: boolean;
  replyWhy: string;
  devShare: number;
  ackOk: boolean | null;
}

let page: Page;

const agentLines = async () => [...(await page.evaluate(() => document.body.innerText)).matchAll(/^OmniCB: (.+)$/gm)].map((m) => m[1]);

async function closeDrawer() {
  const close = page.getByRole('button', { name: 'Close Drawer' });
  for (let i = 0; i < 3 && (await close.isVisible().catch(() => false)); i++) {
    await close.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

/** Ask once; return every new agent line (acknowledgement first, final answer last) once the text has settled. */
async function ask(text: string): Promise<{ lines: string[]; ms: number }> {
  await closeDrawer();
  const before = (await agentLines()).length;
  const t0 = Date.now();
  await page.getByTestId('ask-input').fill(text);
  await page.getByTestId('ask-button').click();
  let lines: string[] = [];
  let firstAt = 0;
  let last = '';
  let stable = 0;
  let listening = 0;
  let stateSeen = false;
  // Done when the agent is back to LISTENING for 3 s after speaking (the status line in the session header); if that
  // line is not on screen, fall back to "the text has not changed for 6 s".
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(1000);
    lines = (await agentLines()).slice(before);
    if (lines.length && !firstAt) firstAt = Date.now() - t0;
    const joined = lines.join('\n');
    if (joined === last) stable++;
    else {
      last = joined;
      stable = 0;
    }
    const state = (await page.evaluate(() => document.body.innerText)).match(/Agent (LISTENING|THINKING|SPEAKING)/)?.[1];
    if (state) stateSeen = true;
    listening = state === 'LISTENING' ? listening + 1 : 0;
    // Six quiet seconds: a short acknowledgement arrives first and the answer can follow several seconds later.
    if (firstAt && ((stateSeen && listening >= 6 && stable >= 6) || (!stateSeen && stable >= 8))) break;
  }
  return { lines, ms: firstAt };
}

const CHUNK = 5; // questions per fresh browser: a long run in one page was once lost to a browser crash

// screen    the language chosen on screen before the questions (the normal case)
// english   the screen stays English and the customer asks in Hindi or Marathi anyway
// switch    the screen starts English, the customer switches language and asks at once (no waiting for the switch)
type Scenario = 'screen' | 'english' | 'switch';

async function runChunk(browser: import('@playwright/test').Browser, scenario: Scenario, agent: 'cobrowse' | 'guardian', lang: Lang, questions: string[]) {
  page = await browser.newPage();
  try {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE);
    await page.getByRole('button', { name: /Start a new policy/ }).click();
    if (scenario === 'screen') await page.getByRole('button', { name: lang === 'hi' ? 'हिंदी' : 'मराठी' }).first().click(); // the session starts in this language
    await page.getByRole('button', { name: /Accept and start co-browsing/ }).click();
    await expect(page.getByText(/Live session connected/)).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(4000);
    if (agent === 'guardian') await page.getByRole('button', { name: /Integrity Guardian: review/ }).click();
    await page.waitForTimeout(6000);
    if (scenario === 'switch') {
      await page.getByRole('button', { name: lang === 'hi' ? 'हिंदी' : 'मराठी' }).first().click();
      await page.waitForTimeout(300);
    } else if (scenario === 'screen') {
      await page.getByRole('button', { name: lang === 'hi' ? 'हिंदी' : 'मराठी' }).first().click();
      await page.waitForTimeout(5000);
    }
    for (const q of questions) {
      const { lines, ms } = await ask(q);
      const reply = lines.length ? lines[lines.length - 1] : '';
      const ack = lines.length > 1 ? lines[0] : null;
      const r = classifyReply(reply, lang);
      const a = ack ? classifyReply(ack, lang) : null;
      const row: Row = { scenario, agent, lang, question: q, ack, reply, replyMs: ms, replyOk: r.ok, replyWhy: r.why, devShare: Math.round(devanagariShare(reply) * 100) / 100, ackOk: a ? a.ok : null };
      // Append to the file as each question finishes.
      const prior: Row[] = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
      fs.writeFileSync(OUT, JSON.stringify([...prior, row], null, 1));
      console.log(`LANGROW ${TAG} ${scenario} ${agent} ${lang} ${row.replyOk ? 'ok' : 'MISS ' + row.replyWhy} share=${row.devShare} ms=${ms} Q: ${q} -> ${reply.slice(0, 90)}`);
      if (scenario === 'switch') await page.waitForTimeout(300); // the switch is the thing under test, keep asking soon after it
    }
  } finally {
    await page.close().catch(() => {});
  }
}

for (const agent of ['cobrowse', 'guardian'] as const) {
  for (const lang of ['hi', 'mr'] as const) {
    for (let start = 0; start < COUNT; start += CHUNK) {
      test(`LANG ${agent} ${lang} ${start + 1}-${Math.min(COUNT, start + CHUNK)}: replies are in the screen language`, async ({ browser }) => {
        test.setTimeout(900_000);
        await runChunk(browser, 'screen', agent, lang, LANG_QUESTIONS[lang].slice(start, Math.min(COUNT, start + CHUNK)));
      });
    }
  }
}

for (const scenario of ['english', 'switch'] as const) {
  for (const lang of ['hi', 'mr'] as const) {
    test(`LANGX ${scenario} ${lang}: Hindi or Marathi questions get Hindi or Marathi answers`, async ({ browser }) => {
      test.setTimeout(900_000);
      await runChunk(browser, scenario, 'cobrowse', lang, LANG_QUESTIONS[lang].slice(0, 5));
    });
  }
}
