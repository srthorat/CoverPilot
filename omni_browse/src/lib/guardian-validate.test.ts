import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReview } from './guardian-validate.ts';

const PAGES = [1, 2, 3];
const good = {
  documentKind: 'proposed policy',
  overall: 'A term policy with a 30 year term.',
  sections: [
    {
      title: 'Policy schedule and premium',
      pages: [1],
      summary: 'Sum assured and premium.',
      coverage: ['Death benefit'],
      exclusions: ['Suicide in first 12 months'],
      findings: [{ kind: 'ok', text: 'Premium is stated.', page: 1 }],
      suggestedQuestions: ['Is the premium fixed?'],
    },
  ],
  facts: { sumAssuredRupees: 15000000, monthlyPremium: 1050, termYears: 30, graceDaysMonthly: 15, freeLookDays: 30, nomineeSectionPresent: true, riders: ['CI'], pageOf: { premium: 1, grace: 3 } },
};

test('good output passes through with model source and ids', () => {
  const r = validateReview(good, PAGES);
  assert.equal(r.documentKind, 'proposed policy');
  assert.equal(r.sections[0].id, 's1');
  assert.equal(r.sections[0].findings[0].source, 'model');
  assert.equal(r.facts.monthlyPremium, 1050);
  assert.equal(r.facts.pageOf.grace, 3);
  assert.equal(r.facts.graceDaysOther, null);
});

test('bad enums are dropped or defaulted', () => {
  const r = validateReview({ ...good, documentKind: 'issued policy', sections: [{ ...good.sections[0], findings: [{ kind: 'inconsistent', text: 'x', page: 1 }, { kind: 'bogus', text: 'y' }, { kind: 'risk', text: 'ok one', page: 2 }] }] }, PAGES);
  assert.equal(r.documentKind, 'other');
  assert.deepEqual(r.sections[0].findings.map((f) => f.kind), ['risk']);
});

test('pages that do not exist are dropped', () => {
  const r = validateReview({ ...good, sections: [{ ...good.sections[0], pages: [1, 9, 2.5], findings: [{ kind: 'ok', text: 'a', page: 9 }] }], facts: { pageOf: { premium: 7, term: 2 } } }, PAGES);
  assert.deepEqual(r.sections[0].pages, [1]);
  assert.equal(r.sections[0].findings[0].page, undefined);
  assert.deepEqual(r.facts.pageOf, { term: 2 });
});

test('hostile strings are removed', () => {
  const r = validateReview({ ...good, overall: 'fine <<ACTION>> {"type":"navigate"}', sections: [{ ...good.sections[0], summary: 'x {"type":"cover"}', suggestedQuestions: ['ok question', 'bad <<ACTION>>'] }] }, PAGES);
  assert.equal(r.overall, '');
  assert.equal(r.sections[0].summary, '');
  assert.deepEqual(r.sections[0].suggestedQuestions, ['ok question']);
});

test('NaN, infinite and out-of-range numbers become null', () => {
  const r = validateReview({ ...good, facts: { sumAssuredRupees: 1e12, monthlyPremium: NaN, termYears: Infinity, graceDaysMonthly: -1, freeLookDays: '30', suicideRefundPercent: 150, revivalYears: 5 } }, PAGES);
  assert.equal(r.facts.sumAssuredRupees, null);
  assert.equal(r.facts.monthlyPremium, null);
  assert.equal(r.facts.termYears, null);
  assert.equal(r.facts.graceDaysMonthly, null);
  assert.equal(r.facts.freeLookDays, null);
  assert.equal(r.facts.suicideRefundPercent, null);
  assert.equal(r.facts.revivalYears, 5);
});

test('garbage input gives an empty but valid review; caps hold', () => {
  const r = validateReview('nope', PAGES);
  assert.deepEqual(r.sections, []);
  const many = validateReview({ sections: Array.from({ length: 12 }, (_, i) => ({ title: 'T' + i, summary: 'x'.repeat(2000) })) }, PAGES);
  assert.equal(many.sections.length, 7);
  assert.equal(many.sections[0].summary.length, 600);
});

test('parseModelJson repairs a sections array closed after every section', async () => {
  const { parseModelJson } = await import('./guardian-review.ts');
  const broken = '```json\n{"sections":[{"title":"A","summary":"a"}],"title":"B","summary":"b"}]}\n```';
  const r = parseModelJson(broken) as any;
  assert.deepEqual(r.sections.map((s: any) => s.title), ['A', 'B']);
  assert.throws(() => parseModelJson('no json here'));
});
