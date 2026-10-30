# Hindi and Marathi reliability: what was measured

Two measuring specs, run against the Docker image with the live Meta models (Chromium):

- `omni_browse/e2e/language.spec.ts`: 20 typed questions per language and agent (co-browse and Integrity Guardian, Hindi and
  Marathi = 80), plus two harder cases: the screen stays English while the customer asks in Hindi or Marathi, and the customer
  switches language and asks at once (5 questions each, both languages = 20). Summary: `python3 omni_browse/e2e/summarize-language.py <results.json>`.
- `omni_browse/e2e/speech-hi-mr.spec.ts`: 5 Hindi and 5 Marathi questions made with Google Cloud TTS, played into Chromium as the
  microphone, so they go through Muse Voice Transcribe, the agent and back. It reports word error rate against what was said.

A reply counts as "in the right language" when at least 35% of its letters are Devanagari (spoken Hindi and Marathi mix in English
product nouns such as "hospital cash rider", on purpose) and the other language's common words do not outnumber the right one's.
The same check runs in the agent (`voice-agent-py/coverpilot/langcheck.py`).

## Before and after

| Case | Before | After |
|---|---|---|
| Language chosen on screen, 4 groups of 20 typed questions | 80 of 80 | 80 of 80 |
| Switch language and ask at once (10) | 10 of 10 | 10 of 10 |
| English screen, customer asks in Hindi or Marathi (10) | 7 of 10 (three English "Sure, ..." lines) | 10 of 10 |
| Median time to the first line of text | about 4.1 s | about 3.1 s (no slower) |

The weak case was the English screen: the prompt said "reply only in English" at the top and "reply in the customer's language" at the
bottom, and the acknowledgement line always used the screen language. Now one rule applies, the customer's message ends with a line that names
the language of the answer (Hindi or Marathi in Devanagari), and the acknowledgement follows it.

A safety net sits behind that: the first sentence of a Hindi or Marathi answer is checked, and if it is not in the right language it
is dropped quietly (nothing spoken or shown) and the same question is asked once more with a stronger line. In 100 live questions
on the final build it never had to fire, so it is covered by unit tests only (`tests/test_language_guard.py`).

## Spoken questions (synthetic voice, a best case)

All 10 spoken questions were answered in the right language, in two runs (20 utterances).

| | Hindi (10 utterances) | Marathi (10 utterances) |
|---|---|---|
| Average word error rate | about 1% | about 34% |

The recogniser varies between runs on the same audio (the same Marathi sentence came back as "पॉलिसी लॅब सालीतर" once and "Policy labs
चालीतर" once). Typical Marathi slips: a Hindi word for a Marathi one ("कौन हो सकता हो" for "कोण होऊ शकतो"), "रोक" or "रोग" for "रोख", a
space inside "प्रीमियमसाठी". One safe correction was added (`रोक`/`रोग` before `रायडर` becomes `रोख`); nothing else was patched because the
other slips are not stable enough to correct without damaging real speech.

Because the recogniser can write Marathi with Hindi words, the screen language always decides the language of the answer on a Hindi or
Marathi screen; the words heard do not flip it.

## What this does not show

- Synthetic speech is clearer than most people. Real Hindi and Marathi voices, accents and noise have not been tested.
- Typed and spoken tests use Chromium only (the fake microphone is Chromium-only).
- Marathi speech recognition is clearly weaker than Hindi. A customer who speaks Marathi may see a misheard line on screen even when the answer is in Marathi.
