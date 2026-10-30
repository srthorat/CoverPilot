import assert from 'node:assert/strict';
import test from 'node:test';
import { checkReplyLanguage, devanagariShare, guessIndicLanguage } from './script-check.ts';

test('English text is not Devanagari', () => {
  assert.equal(devanagariShare('The grace period is thirty days.'), 0);
  assert.equal(checkReplyLanguage('The grace period is thirty days.', 'hi').ok, false);
});

test('product words in English letters do not count against a Hindi answer', () => {
  const r = 'आपका premium हर महीने पंद्रह दिन के grace period के साथ चलता है।';
  assert.ok(devanagariShare(r) > 0.6);
  // A short line with English nouns is still Hindi (this is how the agent speaks)
  assert.equal(checkReplyLanguage('hospital cash rider details अभी निकाल रहा हूँ।', 'hi').ok, true);
  assert.equal(checkReplyLanguage('Opening the hospital cash rider details now, one moment please.', 'hi').ok, false);
  assert.equal(checkReplyLanguage(r, 'hi').ok, true);
});

test('Hindi and Marathi are told apart by their common words', () => {
  assert.equal(guessIndicLanguage('आपका ग्रेस पीरियड तीस दिन का है और पॉलिसी चालू रहती है'), 'hi');
  assert.equal(guessIndicLanguage('तुमचा ग्रेस पीरियड तीस दिवसांचा आहे आणि पॉलिसी सुरू राहते'), 'mr');
  assert.equal(guessIndicLanguage('ग्रेस पीरियड'), 'unknown');
});

test('a Marathi reply to a Hindi setting fails, and the reverse', () => {
  assert.equal(checkReplyLanguage('तुमचा ग्रेस पीरियड तीस दिवसांचा आहे.', 'hi').ok, false);
  assert.equal(checkReplyLanguage('आपका ग्रेस पीरियड तीस दिन का है।', 'mr').ok, false);
  assert.equal(checkReplyLanguage('तुमचा ग्रेस पीरियड तीस दिवसांचा आहे.', 'mr').ok, true);
});

test('empty replies fail', () => {
  assert.equal(checkReplyLanguage('  ', 'hi').ok, false);
});
