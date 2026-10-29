import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDraftSummaryLines, DRAFT_NOTICE, type DraftSummary } from './draft-pdf.ts';

const sample: DraftSummary = {
  draftNumber: 'NXP-7KQ2M9XD',
  date: '29 Oct 2026',
  sumAssuredLabel: '1.5 crore rupees',
  monthlyPremium: 1050,
  termYears: 30,
  riders: [{ name: 'Critical illness 25 lakh', monthlyCost: 149 }],
  nomineeCount: 2,
  nomineesTotalShare: 100,
  anyMinorNominee: true,
  appointeeNamed: false,
  smoker: false,
  declarations: { section45Declared: true, familyHistoryDeclared: false, hospitalizationDeclared: false },
};

test('the draft says it is not a policy and holds no identifiers', () => {
  const text = buildDraftSummaryLines(sample).join('\n');
  assert.ok(text.includes(DRAFT_NOTICE));
  assert.ok(text.includes('1.5 crore rupees') && text.includes('1050 rupees') && text.includes('not yet named'));
  assert.ok(!/aadhaar/i.test(text) && !text.includes('@'));
});

test('no riders reads as base cover only', () => {
  assert.ok(buildDraftSummaryLines({ ...sample, riders: [], anyMinorNominee: false }).some((l) => /base cover only/.test(l)));
});

test('the PDF is produced in plain node', async () => {
  const { buildDraftSummaryPdf } = await import('./draft-pdf.ts');
  const blob = await buildDraftSummaryPdf(sample);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.length > 1500);
});
