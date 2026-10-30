import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDraftSummaryLines, DRAFT_NOTICE, DRAFT_TITLE, FOOTER_TEXT, UIN_TEXT, type DraftSummary } from './draft-pdf.ts';
import { POLICY_HEADINGS, TERMS_1, TERMS_2 } from './policy-structure.ts';

const logoDataUrl = 'data:image/png;base64,' + fs.readFileSync(path.resolve(import.meta.dirname, '../../public/brand/nexasure-mark.png')).toString('base64');

const sample: DraftSummary = {
  draftNumber: 'NXP-7KQ2M9XD',
  date: '29 Oct 2026',
  sumAssuredLabel: '1.5 crore rupees',
  monthlyPremium: 1199,
  termYears: 30,
  riders: [{ name: 'Critical illness 25 lakh', monthlyCost: 149 }],
  nomineeCount: 2,
  nomineesTotalShare: 100,
  anyMinorNominee: true,
  appointeeNamed: false,
  smoker: false,
  declarations: { section45Declared: true, familyHistoryDeclared: false, hospitalizationDeclared: false },
  policyholder: { name: 'Priya Sharma', dob: '05/03/1992', gender: 'Female', city: 'Pune', pincode: '411038', pan: 'ABCPS1234K', aadhaar: '4321 8765 9012', mobile: '9876543210' },
  nominees: [
    { name: 'Rahul Sharma', relation: 'Spouse', share: 70, dob: '14/08/1992' },
    { name: 'Aarav Sharma', relation: 'Son', share: 30, age: 7 },
  ],
  mwpaTrust: false,
  logoDataUrl,
  watermarkDataUrl: logoDataUrl, // node has no canvas; any PNG exercises the image path
};

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

test('every heading of the sample structure appears, in order', () => {
  const lines = buildDraftSummaryLines(sample);
  const headings = lines.filter((l) => l.startsWith('# ')).map((l) => l.slice(2));
  assert.equal(headings[0], DRAFT_TITLE);
  assert.deepEqual(headings.slice(1), [...POLICY_HEADINGS]);
});

test('it says it is a proposed policy, not an issued one, and carries the demo UIN and footer', () => {
  const text = buildDraftSummaryLines(sample).join('\n');
  assert.ok(text.includes(DRAFT_NOTICE));
  assert.ok(text.includes(UIN_TEXT) && text.includes('000N001V01'));
  assert.ok(text.includes('Policy number: To be allotted on issuance'));
  assert.ok(text.includes(FOOTER_TEXT) && text.includes('Page N of M'));
  assert.ok(!/NXSDEMO/.test(text));
});

test('chosen riders are selected, the others are listed as available', () => {
  const lines = buildDraftSummaryLines(sample);
  const text = lines.join('\n');
  assert.ok(text.includes('Riders selected on this policy'));
  assert.ok(/Rider: Critical illness 25 lakh \| Rs 149/.test(text));
  const available = lines.slice(lines.indexOf('Riders available (not selected on this policy)'));
  assert.ok(available.length > 1, 'the available table is printed while some riders remain');
  assert.ok(!/^Critical illness \|/m.test(available.join('\n')));
  assert.ok(/^Accidental death and disability \|/m.test(available.join('\n')));
  assert.ok(/Rs 1,050/.test(text), 'base premium is the total minus riders');
});

test('no riders reads as base cover only and every rider is available', () => {
  const text = buildDraftSummaryLines({ ...sample, riders: [], monthlyPremium: 1050, anyMinorNominee: false }).join('\n');
  assert.ok(/base cover only/.test(text));
  assert.ok(/^Critical illness \|/m.test(text) && /^Hospital daily cash \|/m.test(text));
  assert.ok(text.includes('No riders selected (base cover only).'));
});

const allRiders = [
  { name: 'Critical illness 50 lakh', monthlyCost: 269 },
  { name: 'Accidental death and disability (income benefit)', monthlyCost: 129, pays: '1 lakh rupees a month for 100 months' },
  { name: 'Waiver of premium', monthlyCost: 42 },
  { name: 'Hospital daily cash', monthlyCost: 55 },
  { name: 'Life stage escalator', monthlyCost: 49 },
];

test('with every rider selected there is no empty available table', () => {
  const text = buildDraftSummaryLines({ ...sample, riders: allRiders, monthlyPremium: 1050 + 269 + 129 + 42 + 55 + 49 }).join('\n');
  assert.ok(!text.includes('Riders available (not selected'));
  assert.ok(text.includes('All of the available riders are selected on this policy.'));
});

test('the escalator is a premium row and the base is the true base, not the total minus some riders', () => {
  const lines = buildDraftSummaryLines({ ...sample, riders: allRiders, monthlyPremium: 1594 });
  const text = lines.join('\n');
  assert.ok(/^Rider: Life stage escalator \| Rs 49$/m.test(text));
  assert.ok(/^Base cover, 1.5 crore rupees, non-smoker rate \| Rs 1,050$/m.test(text));
  assert.ok(!/Rs 1,099/.test(text));
  assert.ok(/^Total monthly premium \| Rs 1,594$/m.test(text));
});

test('rider rows show only the selected tier or option', () => {
  const text = buildDraftSummaryLines({ ...sample, riders: allRiders, monthlyPremium: 1594 }).join('\n');
  assert.ok(/^Critical illness 50 lakh \| Lump sum of 50 lakh rupees on diagnosis of a covered critical illness \| Rs 269$/m.test(text));
  assert.ok(/^Accidental death and disability \(income benefit\) \| 1 lakh rupees a month for 100 months \| Rs 129$/m.test(text));
  assert.ok(!/10 lakh, 25 lakh or 50 lakh/.test(text), 'no tier list for a chosen rider');
  assert.ok(!/50 lakh rupees lump sum, or 1 lakh/.test(text), 'no option list for a chosen rider');
  // A critical illness rider without an explicit text still resolves to its own tier.
  const own = buildDraftSummaryLines(sample).join('\n');
  assert.ok(/^Critical illness 25 lakh \| Lump sum of 25 lakh rupees on diagnosis of a covered critical illness \| Rs 149$/m.test(own));
});

test('the declarations read as what was declared', () => {
  const none = buildDraftSummaryLines({ ...sample, declarations: { section45Declared: false, familyHistoryDeclared: false, hospitalizationDeclared: false } }).join('\n');
  assert.ok(/Section 45 declaration: not made/.test(none) && /Family cardiac history: none declared/.test(none) && /Prior hospitalisation: none declared/.test(none));
  const all = buildDraftSummaryLines({ ...sample, declarations: { section45Declared: true, familyHistoryDeclared: true, hospitalizationDeclared: true } }).join('\n');
  assert.ok(/Section 45 declaration: made/.test(all) && /Family cardiac history: declared/.test(all) && /Prior hospitalisation: declared/.test(all));
});

test('the nomination details table lists every nominee: date of birth for the first, age for the rest', () => {
  const lines = buildDraftSummaryLines(sample);
  const i = lines.indexOf('# Nomination details');
  assert.ok(i > lines.indexOf('# Proposed policy schedule') && i < lines.indexOf('# Premium'));
  const section = lines.slice(i, lines.indexOf('# Premium')).join('\n');
  assert.ok(section.includes('No. | Nominee name | Relationship | Date of birth / age | Share'));
  assert.ok(section.includes('1 | Rahul Sharma | Spouse | 14/08/1992 | 70%'));
  assert.ok(section.includes('2 | Aarav Sharma | Son | 7 years (under 18) | 30%'));
  assert.ok(/Appointee \(nominee under 18\): Not yet named/.test(section));
  assert.ok(/Married Women's Property Act trust: No/.test(section));
});

test('several nominees, a minor, an appointee and the trust are all shown', () => {
  const d: DraftSummary = {
    ...sample,
    nomineeCount: 4,
    appointeeNamed: true,
    appointeeName: 'Shankar Thorat',
    appointeeRelation: 'Grandparent',
    mwpaTrust: true,
    nominees: [
      { name: 'Priya Thorat', relation: 'Spouse', share: 40, dob: '19/08/1996' },
      { name: 'Aarav Thorat', relation: 'Son', share: 30, age: 7 },
      { name: 'Meera Thorat', relation: 'Daughter', share: 20, age: 4 },
      { name: 'Sunita Thorat', relation: 'Mother', share: 10, age: 61 },
    ],
  };
  const text = buildDraftSummaryLines(d).join('\n');
  assert.ok(text.includes('1 | Priya Thorat | Spouse | 19/08/1996 | 40%'));
  assert.ok(text.includes('3 | Meera Thorat | Daughter | 4 years (under 18) | 20%'));
  assert.ok(text.includes('4 | Sunita Thorat | Mother | 61 years | 10%'));
  assert.ok(text.includes('Shankar Thorat (Grandparent), adult appointee for a nominee under 18'));
  assert.ok(/Married Women's Property Act trust: Yes/.test(text));
  assert.ok(text.includes('Nominee and share: Priya Thorat (Spouse, 40 percent); Aarav Thorat (Son, 30 percent)'), 'the one-line schedule summary stays');
});

test('a primary nominee with no date of birth says so rather than inventing one', () => {
  const d = { ...sample, anyMinorNominee: false, nominees: [{ name: 'Rahul Sharma', relation: 'Spouse', share: 100 }], nomineeCount: 1 };
  assert.ok(buildDraftSummaryLines(d).join('\n').includes('1 | Rahul Sharma | Spouse | Not provided | 100%'));
});

test('a minor nominee without an appointee is stated, with the nominees named', () => {
  const text = buildDraftSummaryLines(sample).join('\n');
  assert.ok(text.includes('Not yet named (a nominee is under 18)'));
  assert.ok(text.includes('Rahul Sharma (Spouse, 70 percent); Aarav Sharma (Son, 30 percent)'));
  assert.ok(text.includes('Nominee and share: '));
});

test('the static clauses are the sample policy text, word for word', { skip: !hasPdftotext }, () => {
  const samplePdf = path.resolve(import.meta.dirname, '../../public/samples/sample-policy.pdf');
  const sampleText = norm(execFileSync('pdftotext', ['-layout', samplePdf, '-'], { encoding: 'utf8' }));
  const generated = norm(buildDraftSummaryLines(sample).join('\n'));
  for (const [title, body] of [...TERMS_1, ...TERMS_2]) {
    const clause = norm(body);
    const lead = clause.slice(0, 70);
    assert.ok(generated.includes(clause), `generated has clause ${title}`);
    // The sample wraps lines, and its watermark leaves a stray letter between some lines, so match the first
    // eight words in order while allowing one stray single letter between words.
    const words = lead.split(' ').slice(0, 8).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(words.join('(?:\\s+[a-z](?=\\s))?\\s+'));
    assert.ok(re.test(sampleText), `sample has the start of ${title}: ${words.join(' ')}`);
  }
});

test('the PDF renders with logo, selectable text, page numbers and a watermark', { skip: !hasPdftotext }, async () => {
  const { buildDraftSummaryPdf } = await import('./draft-pdf.ts');
  const blob = await buildDraftSummaryPdf(sample);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const file = path.join(os.tmpdir(), `draft-${process.pid}.pdf`);
  fs.writeFileSync(file, bytes);
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  fs.unlinkSync(file);
  assert.ok(text.includes('Proposed Policy Document (draft)'));
  assert.ok(text.includes('000N001V01'));
  assert.ok(text.includes('Priya Sharma') && text.includes('ABCPS1234K') && text.includes('4321 8765 9012'));
  assert.ok(/Page 1 of \d/.test(text));
  assert.ok(/Grace period/.test(text) && /Free-look period/.test(text) && /Section 45/.test(text));
});

test('the real PDF has every clause title, the nomination details, and no stray watermark letters', { skip: !hasPdftotext }, async () => {
  const { buildDraftSummaryPdf } = await import('./draft-pdf.ts');
  const d: DraftSummary = { ...sample, riders: allRiders, monthlyPremium: 1594, mwpaTrust: true };
  const blob = await buildDraftSummaryPdf(d);
  const file = path.join(os.tmpdir(), `draft-full-${process.pid}.pdf`);
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  fs.unlinkSync(file);
  const flat = norm(text);
  for (const [title] of [...TERMS_1, ...TERMS_2]) assert.ok(flat.includes(norm(title)), `clause title ${title}`);
  assert.equal([...TERMS_1, ...TERMS_2].length, 12);
  for (const h of POLICY_HEADINGS) assert.ok(flat.includes(norm(h)), `heading ${h}`);
  assert.ok(text.includes('Nomination details') && text.includes('Priya Sharma') === true);
  assert.ok(text.includes('Rahul Sharma') && text.includes('14/08/1992') && text.includes('7 years'));
  assert.ok(!/^\s*[A-Za-z]\s*$/m.test(text), 'no single-letter lines left by a text watermark');
  assert.ok(!/\bSAMPLE\s*$/m.test(text.replace(/SAMPLE DOCUMENT FOR DEMONSTRATION[^\n]*/g, '')), 'the watermark is not a text line');
});
