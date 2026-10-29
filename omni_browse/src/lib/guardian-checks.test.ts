import assert from 'node:assert/strict';
import test from 'node:test';
import { countIssues, runChecks } from './guardian-checks.ts';
import type { DocumentFacts, ProposalFacts } from './guardian-types.ts';

const proposal: ProposalFacts = { sumAssured: '1.5cr', monthlyPremium: 1050, termYears: 30, riders: ['Critical illness 25 lakh'], nomineeCount: 1, nomineesTotalShare: 100, anyMinorNominee: false, smoker: false };
const good: DocumentFacts = {
  sumAssuredRupees: 15_000_000, monthlyPremium: 1050, termYears: 30, graceDaysMonthly: 15, graceDaysOther: 30, freeLookDays: 30,
  suicideExclusionMonths: 12, suicideRefundPercent: 80, revivalYears: 5, contestabilityYears: 3, nomineeSectionPresent: true,
  riders: ['Critical illness rider'], pageOf: { sumAssured: 1, premium: 1 },
};

test('a consistent document has no issues', () => {
  assert.equal(countIssues(runChecks(good, proposal)), 0);
});

test('mismatches against the application are inconsistencies with a page and a step to fix', () => {
  const f = runChecks({ ...good, sumAssuredRupees: 10_000_000, monthlyPremium: 1180 }, proposal);
  const bad = f.filter((x) => x.kind === 'inconsistent');
  assert.equal(bad.length, 2);
  assert.ok(bad.every((x) => x.source === 'check' && x.page === 1 && x.fixStep === 2));
});

test('rule breaches are flagged as risks, not accusations', () => {
  const f = runChecks({ ...good, graceDaysMonthly: 10, suicideExclusionMonths: 24, suicideRefundPercent: 0, contestabilityYears: 2 }, proposal);
  assert.equal(f.filter((x) => x.kind === 'risk').length, 4);
  assert.ok(f.every((x) => !/fraud|illegal|violat/i.test(x.text)));
});

test('missing nomination section and omitted rider are reported', () => {
  const f = runChecks({ ...good, nomineeSectionPresent: false, riders: [] }, { ...proposal, anyMinorNominee: true });
  assert.ok(f.some((x) => x.kind === 'missing' && x.fixStep === 3));
  assert.ok(f.some((x) => x.kind === 'question'));
  assert.ok(f.some((x) => x.kind === 'inconsistent' && /rider/.test(x.text)));
});

test('facts the document does not state become missing, never guessed', () => {
  const f = runChecks({ ...good, sumAssuredRupees: null, monthlyPremium: null }, proposal);
  assert.equal(f.filter((x) => x.kind === 'missing').length, 2);
});

test('with no application started only the fixed rules are checked', () => {
  const f = runChecks({ ...good, sumAssuredRupees: 10_000_000, monthlyPremium: 1180, graceDaysMonthly: 10 }, proposal, { compareApplication: false });
  assert.equal(f.filter((x) => x.kind === 'inconsistent').length, 0);
  assert.equal(f.filter((x) => x.kind === 'risk').length, 1);
});
