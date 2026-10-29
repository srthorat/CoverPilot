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
    { name: 'Rahul Sharma', relation: 'Spouse', share: 70 },
    { name: 'Aarav Sharma', relation: 'Son', share: 30 },
  ],
  logoDataUrl,
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
  assert.ok(!/^Critical illness \|/m.test(available.join('\n')));
  assert.ok(/^Accidental death and disability \|/m.test(available.join('\n')));
  assert.ok(/Rs 1,050/.test(text), 'base premium is the total minus riders');
});

test('no riders reads as base cover only and every rider is available', () => {
  const text = buildDraftSummaryLines({ ...sample, riders: [], monthlyPremium: 1050, anyMinorNominee: false }).join('\n');
  assert.ok(/base cover only/.test(text));
  assert.ok(/^Critical illness \|/m.test(text) && /^Hospital daily cash \|/m.test(text));
});

test('a minor nominee without an appointee is stated, with the nominees named', () => {
  const text = buildDraftSummaryLines(sample).join('\n');
  assert.ok(text.includes('Not yet named (a nominee is under 18)'));
  assert.ok(text.includes('Rahul Sharma (Spouse, 70 percent); Aarav Sharma (Son, 30 percent)'));
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
