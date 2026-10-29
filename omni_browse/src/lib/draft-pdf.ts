// The "proposal summary (draft)" the customer can download before issuance and hand to Integrity
// Guardian. It is a summary of the application, not a policy: it says so on the first page, and it
// holds no names and no identity numbers.

export interface DraftSummary {
  draftNumber: string; // the proposal's unique code
  date: string; // e.g. '29 Oct 2026'
  sumAssuredLabel: string; // e.g. '1.5 crore rupees'
  monthlyPremium: number; // rupees, base cover plus riders, no GST
  termYears: number;
  riders: Array<{ name: string; monthlyCost: number }>;
  nomineeCount: number;
  nomineesTotalShare: number;
  anyMinorNominee: boolean;
  appointeeNamed: boolean;
  smoker: boolean | null;
  declarations: { section45Declared: boolean; familyHistoryDeclared: boolean; hospitalizationDeclared: boolean };
}

export const DRAFT_NOTICE = 'This is a draft summary of your application. It is not an issued policy and is not proof of insurance.';
export const DRAFT_TITLE = 'Proposal summary (draft, not a policy)';

const yn = (v: boolean) => (v ? 'declared' : 'not declared');

/** The text of the document, one entry per line; '# ' marks a heading. Pure, so it can be tested. */
export function buildDraftSummaryLines(d: DraftSummary): string[] {
  const riderTotal = d.riders.reduce((s, r) => s + r.monthlyCost, 0);
  return [
    `# ${DRAFT_TITLE}`,
    DRAFT_NOTICE,
    `Draft number: ${d.draftNumber}`,
    `Date: ${d.date}`,
    '# Cover',
    `Sum assured: ${d.sumAssuredLabel}.`,
    `Monthly premium: ${d.monthlyPremium} rupees (no GST on individual life cover).`,
    `Policy term: ${d.termYears} years.`,
    `Tobacco use declared: ${d.smoker === null ? 'not answered' : d.smoker ? 'yes' : 'no (non-smoker discount applies)'}.`,
    '# Riders',
    ...(d.riders.length
      ? [...d.riders.map((r) => `${r.name}: ${r.monthlyCost} rupees a month.`), `Riders total: ${riderTotal} rupees a month, included in the monthly premium above.`]
      : ['No riders selected (base cover only).']),
    '# Nominees',
    `Number of nominees: ${d.nomineeCount}.`,
    `Shares add up to ${d.nomineesTotalShare} percent.`,
    d.anyMinorNominee ? `A nominee is under 18; an adult appointee is ${d.appointeeNamed ? 'named' : 'not yet named'}.` : 'No nominee is under 18.',
    '# Declarations',
    `Section 45 declaration: ${yn(d.declarations.section45Declared)}.`,
    `Family history declaration: ${yn(d.declarations.familyHistoryDeclared)}.`,
    `Prior hospitalisation declaration: ${yn(d.declarations.hospitalizationDeclared)}.`,
    '# Premium notes',
    'The premium shown is for the cover and riders above and is fixed for the policy term in this demo product.',
    'Any tax effect depends on the customer\'s own situation and is not tax advice.',
    '# Conditions this demo product states',
    'Free-look: 30 days from receiving the policy document; the refund is the premium paid minus a proportionate risk premium, the medical examination cost and the stamp duty.',
    'Grace period: 15 days for monthly premiums and 30 days for quarterly, half-yearly and annual premiums.',
    'Suicide: within 12 months of the date risk started or of a revival, at least 80 percent of premiums paid or the surrender value, whichever is higher, is paid.',
    'Section 45 of the Insurance Act 1938: after three years a policy cannot be called in question on any ground.',
    'Revival: within 5 years of the first unpaid premium (a NexaSure demo term), on paying unpaid premiums with interest.',
    'NexaSure is a fictional insurer; this demo product is not a registered plan.',
  ];
}

/** Builds the PDF in the browser (jsPDF is loaded on demand, so server rendering never sees it). */
export async function buildDraftSummaryPdf(input: DraftSummary): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setProperties({ title: DRAFT_TITLE, subject: 'Draft summary, not an issued policy' });
  const left = 18;
  const width = 174;
  const bottom = 278;
  let y = 22;
  const newPage = () => {
    doc.addPage();
    y = 22;
  };
  for (const line of buildDraftSummaryLines(input)) {
    const heading = line.startsWith('# ');
    const text = heading ? line.slice(2) : line;
    const isNotice = line === DRAFT_NOTICE;
    doc.setFont('helvetica', heading || isNotice ? 'bold' : 'normal');
    doc.setFontSize(heading ? (y < 30 ? 17 : 13) : 11);
    const wrapped = doc.splitTextToSize(text, width) as string[];
    const height = wrapped.length * 5.6 + (heading ? 4 : 1.5);
    if (y + height > bottom) newPage();
    if (heading && y > 30) y += 3;
    if (isNotice) {
      doc.setFillColor(244, 240, 255);
      doc.rect(left - 2, y - 5, width + 4, wrapped.length * 5.6 + 3, 'F');
    }
    doc.text(wrapped, left, y);
    y += height;
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`NexaSure Flexi Shield · Draft summary, not an issued policy · Page ${p} of ${pages}`, left, 289);
  }
  return doc.output('blob');
}
