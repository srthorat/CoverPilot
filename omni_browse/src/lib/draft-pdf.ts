// The proposed policy the customer can download before issuance and hand to Integrity Guardian.
//
// It is built to look and read like the sample policy PDFs (same letterhead, identifier block, sections in
// the same order, same static clause text from policy-structure.ts); only the numbers, names and the
// riders come from the application. It is a draft: it says so in a boxed notice on the first page and in
// the footer of every page, and it carries no policy number until issuance.

import {
  CI_RIDER_NOTE,
  DECLARATION_TEXT,
  DEATH_BENEFIT,
  GRIEVANCE_LADDER,
  GST_NOTE,
  NO_MATURITY_BENEFIT,
  POLICY_HEADINGS,
  RIDER_CATALOG,
  TERMS_1,
  TERMS_2,
} from './policy-structure.ts';

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
  // Optional detail from the application (this file is made in the customer's own browser).
  policyholder?: { name: string; dob: string; gender: string; city: string; pincode: string; pan?: string; aadhaar?: string; mobile?: string; email?: string };
  nominees?: Array<{ name: string; relation: string; share: number }>;
  appointeeName?: string;
  sumAssuredRupees?: number;
  logoDataUrl?: string; // PNG data URL; fetched from /brand/nexasure-mark.png in the browser when absent
}

export const DRAFT_TITLE = 'Proposed Policy Document (draft)';
export const DRAFT_NOTICE = 'This is a proposed policy document generated from your application. It is not an issued policy and is not proof of insurance.';
export const FOOTER_TEXT = 'NexaSure Flexi Shield · SAMPLE DOCUMENT FOR DEMONSTRATION · fictional insurer, not an issued policy';
export const UIN_TEXT = '000N001V01 (demo product, not registered with IRDAI)';
const SUBTITLE = 'NexaSure Flexi Shield · individual pure term life insurance · SAMPLE DOCUMENT FOR DEMONSTRATION, fictional insurer, not an issued policy';

type Block =
  | { t: 'h1'; text: string }
  | { t: 'sub'; text: string }
  | { t: 'notice'; text: string }
  | { t: 'h2'; text: string }
  | { t: 'h3'; text: string }
  | { t: 'p'; text: string }
  | { t: 'note'; text: string }
  | { t: 'kv'; rows: Array<[string, string]> }
  | { t: 'kv4'; rows: Array<[string, string, string, string]> }
  | { t: 'table'; head: string[]; rows: string[][]; widths: number[] }
  | { t: 'list'; items: string[] }
  | { t: 'sig'; left: string[]; right: string[] };

const money = (n: number) => `Rs ${n.toLocaleString('en-IN')}`;
const RUPEES: Record<string, number> = { '1 crore rupees': 10_000_000, '1.5 crore rupees': 15_000_000, '2 crore rupees': 20_000_000 };

/** The document as ordered blocks; pure, so the structure can be tested without a PDF library. */
export function buildPolicyBlocks(d: DraftSummary): Block[] {
  const rupees = d.sumAssuredRupees ?? RUPEES[d.sumAssuredLabel];
  const sumText = rupees ? `${d.sumAssuredLabel} (${money(rupees)})` : d.sumAssuredLabel;
  const riderTotal = d.riders.reduce((s, r) => s + r.monthlyCost, 0);
  const base = d.monthlyPremium - riderTotal;
  const ph = d.policyholder;
  const catalogue = RIDER_CATALOG.map((r) => ({ ...r }));
  const chosenNames = d.riders.map((r) => r.name.toLowerCase());
  const isChosen = (name: string) => chosenNames.some((n) => n.startsWith(name.toLowerCase().split(' ')[0]));
  const nomineeText = d.nominees?.length
    ? d.nominees.map((n) => `${n.name} (${n.relation}, ${n.share} percent)`).join('; ')
    : `${d.nomineeCount} nominee${d.nomineeCount === 1 ? '' : 's'}, shares add up to ${d.nomineesTotalShare} percent`;
  const appointee = d.anyMinorNominee
    ? d.appointeeNamed
      ? `${d.appointeeName?.trim() || 'Named'} (adult appointee for a nominee under 18)`
      : 'Not yet named (a nominee is under 18)'
    : 'Not applicable (nominee is an adult)';

  return [
    { t: 'h1', text: DRAFT_TITLE },
    { t: 'sub', text: SUBTITLE },
    { t: 'notice', text: DRAFT_NOTICE },
    {
      t: 'kv',
      rows: [
        ['Insurer', 'NexaSure, an AI-first digital insurance company (fictional demo insurer)'],
        ['Product', 'NexaSure Flexi Shield, individual pure term life insurance'],
        ['UIN', UIN_TEXT],
        ['IRDAI registration / CIN', 'Not applicable, fictional demo insurer / Not applicable (fictional)'],
        ['Registered office', 'NexaSure Demo Tower, 1 Sample Road, Pune 411000 (fictional address)'],
        ['Customer care', '1800-000-0000 (demo) · care@nexasure.example · nexasure.example'],
      ],
    },
    { t: 'h2', text: POLICY_HEADINGS[0] },
    {
      t: 'kv4',
      rows: [
        ['Policyholder and life assured', ph?.name || 'Not provided', 'Date of birth', ph?.dob || 'Not provided'],
        ['Gender', ph?.gender || 'Not provided', 'PAN', ph?.pan || 'Not provided'],
        ['Aadhaar', ph?.aadhaar || 'Not provided', 'Mobile', ph?.mobile || 'Not provided'],
        ['City and PIN code', ph ? `${ph.city}, ${ph.pincode}` : 'Not provided', 'Tobacco use', d.smoker === null ? 'Not answered' : d.smoker ? 'Yes' : 'No (non-smoker)'],
      ],
    },
    { t: 'h2', text: POLICY_HEADINGS[1] },
    {
      t: 'kv4',
      rows: [
        ['Policy number', 'To be allotted on issuance', 'Proposal number', d.draftNumber],
        ['Date of proposal', d.date, 'Date of issue', 'On issuance'],
        ['Policy commencement', 'On issuance', 'Policy term', `${d.termYears} years`],
        ['Policy expiry', `${d.termYears} years from commencement`, 'Premium payment term', `${d.termYears} years`],
        ['Sum assured', sumText, 'Premium payment mode', 'Monthly'],
        ['Premium due date', '5th of every month', 'Grace period', '15 days (monthly), 30 days (other modes)'],
        ['Nominee and share', nomineeText, 'Appointee', appointee],
      ],
    },
    {
      t: 'note',
      text: 'This proposed policy becomes a policy only after NexaSure issues it. Please read the whole document, including the terms and conditions below, and tell us within the free-look period if anything is not as you expected.',
    },
    { t: 'h2', text: POLICY_HEADINGS[2] },
    {
      t: 'table',
      head: ['Item', 'Monthly amount'],
      widths: [0.74, 0.26],
      rows: [
        [`Base cover, ${d.sumAssuredLabel}, ${d.smoker === true ? 'smoker' : 'non-smoker'} rate`, money(base)],
        ...(d.riders.length ? d.riders.map((r) => [`Rider: ${r.name}`, money(r.monthlyCost)]) : [['Riders selected', 'None (base cover only)']]),
        ['Total monthly premium', money(d.monthlyPremium)],
      ],
    },
    { t: 'p', text: GST_NOTE },
    { t: 'h2', text: POLICY_HEADINGS[3] },
    { t: 'h3', text: 'Death benefit' },
    { t: 'p', text: DEATH_BENEFIT.replace('{sumAssured}', d.sumAssuredLabel) },
    { t: 'h3', text: 'No maturity benefit' },
    { t: 'p', text: NO_MATURITY_BENEFIT },
    { t: 'h2', text: POLICY_HEADINGS[4] },
    ...(d.riders.length
      ? ([
          { t: 'h3', text: 'Riders selected on this policy' },
          {
            t: 'table',
            head: ['Rider', 'What it pays', 'Cost a month'],
            widths: [0.26, 0.54, 0.2],
            rows: d.riders.map((r) => {
              const entry = catalogue.find((c) => isChosen(c.name) && r.name.toLowerCase().startsWith(c.name.toLowerCase().split(' ')[0]));
              return [r.name, entry?.pays ?? '', money(r.monthlyCost)];
            }),
          },
        ] as Block[])
      : ([{ t: 'p', text: 'No riders selected (base cover only).' }] as Block[])),
    { t: 'h3', text: 'Riders available (not selected on this policy)' },
    {
      t: 'table',
      head: ['Rider', 'What it pays', 'Cost a month'],
      widths: [0.26, 0.54, 0.2],
      rows: catalogue.filter((c) => !isChosen(c.name)).map((c) => [c.name, c.pays, c.price]),
    },
    { t: 'p', text: CI_RIDER_NOTE },
    { t: 'h2', text: POLICY_HEADINGS[5] },
    ...TERMS_1.flatMap(([title, text]): Block[] => [
      { t: 'h3', text: title },
      { t: 'p', text },
    ]),
    { t: 'h2', text: POLICY_HEADINGS[6] },
    ...TERMS_2.flatMap(([title, text]): Block[] => [
      { t: 'h3', text: title },
      { t: 'p', text },
    ]),
    { t: 'h2', text: POLICY_HEADINGS[7] },
    {
      t: 'table',
      head: ['Item', 'What this policy says'],
      widths: [0.28, 0.72],
      rows: [
        ['Product UIN', UIN_TEXT],
        ['What it is', 'Pure term life cover, no maturity benefit'],
        ['Sum assured / term', `${d.sumAssuredLabel} / ${d.termYears} years`],
        ['Premium', `${money(d.monthlyPremium)} a month, fixed, no GST`],
        ['If you miss a payment', '15 days of grace (monthly), then the policy lapses; revival within five years (demo term)'],
        ['Cancelling', 'Thirty days free-look, refund net of risk premium, medical cost and stamp duty'],
        ['Suicide', 'First twelve months: at least 80 percent of premiums or surrender value'],
        ['Contestability', 'Three years under section 45'],
      ],
    },
    { t: 'h2', text: POLICY_HEADINGS[8] },
    { t: 'list', items: GRIEVANCE_LADDER },
    { t: 'h2', text: POLICY_HEADINGS[9] },
    { t: 'p', text: DECLARATION_TEXT },
    {
      t: 'p',
      text: `Declarations in this application: Section 45 declaration ${d.declarations.section45Declared ? 'made' : 'not yet made'}; family history declaration ${
        d.declarations.familyHistoryDeclared ? 'made' : 'not made'
      }; prior hospitalisation declaration ${d.declarations.hospitalizationDeclared ? 'made' : 'not made'}. The first premium is paid by the customer at issuance (demo payment, no money moves).`,
    },
    {
      t: 'sig',
      left: ['A. Menon', 'For NexaSure, Authorised Signatory', 'Fictional signatory, demo document'],
      right: ['Proposer signature: to be given at issuance', 'Place: Pune', `Date: ${d.date}`],
    },
  ];
}

/** The text of the document, one entry per line; '# ' marks a heading. Same order as the rendered PDF. */
export function buildDraftSummaryLines(d: DraftSummary): string[] {
  const out: string[] = [];
  for (const b of buildPolicyBlocks(d)) {
    switch (b.t) {
      case 'h1':
      case 'h2':
        out.push(`# ${b.text}`);
        break;
      case 'h3':
        out.push(b.text);
        break;
      case 'sub':
      case 'notice':
      case 'p':
      case 'note':
        out.push(b.text);
        break;
      case 'kv':
        out.push(...b.rows.map(([k, v]) => `${k}: ${v}`));
        break;
      case 'kv4':
        out.push(...b.rows.map(([k1, v1, k2, v2]) => `${k1}: ${v1} | ${k2}: ${v2}`));
        break;
      case 'table':
        out.push(b.head.join(' | '), ...b.rows.map((r) => r.join(' | ')));
        break;
      case 'list':
        out.push(...b.items.map((x, i) => `${i + 1}. ${x}`));
        break;
      case 'sig':
        out.push(...b.left, ...b.right);
        break;
    }
  }
  out.push(`${FOOTER_TEXT} · Page N of M`);
  return out;
}

async function loadLogo(d: DraftSummary): Promise<string> {
  if (d.logoDataUrl) return d.logoDataUrl;
  const res = await fetch('/brand/nexasure-mark.png');
  if (!res.ok) throw new Error('Could not load the NexaSure logo for the document.');
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Could not read the NexaSure logo.'));
    fr.readAsDataURL(blob);
  });
}

/** Builds the PDF in the browser (jsPDF is loaded on demand, so server rendering never sees it). */
export async function buildDraftSummaryPdf(d: DraftSummary): Promise<Blob> {
  const logo = await loadLogo(d);
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `NexaSure Flexi Shield - ${DRAFT_TITLE}`, subject: 'Proposed policy document generated from the application, not an issued policy', author: 'NexaSure (fictional)' });

  const L = 15;
  const W = 180;
  const BOTTOM = 276;
  const PURPLE: [number, number, number] = [88, 43, 232];
  const INK: [number, number, number] = [27, 31, 51];
  const GREY: [number, number, number] = [90, 95, 122];
  const RULE: [number, number, number] = [201, 198, 216];
  let y = 0;
  let page = 1;

  const setInk = () => doc.setTextColor(...INK);
  const lineH = (size: number) => (size * 0.3528) * 1.38;
  const wrap = (text: string, width: number, size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    return doc.splitTextToSize(text, width) as string[];
  };

  const letterhead = (first: boolean) => {
    const w = first ? 22 : 15;
    const h = first ? 18 : 12.3;
    doc.addImage(logo, 'PNG', L, 9, w, h);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(first ? 19 : 13);
    doc.setTextColor(19, 10, 58);
    doc.text('NexaSure', L + w + 3, first ? 17 : 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    if (first) doc.text('AI-first digital insurance company', L + w + 3, 22);
    doc.setFontSize(first ? 7.6 : 7.4);
    const meta = first ? [`Proposal no. ${d.draftNumber}`, 'Policy no. to be allotted on issuance', 'UIN 000N001V01 (demo)'] : [`Proposal no. ${d.draftNumber} · Flexi Shield · UIN 000N001V01 (demo)`];
    meta.forEach((m, i) => doc.text(m, L + W, 13 + i * 3.6, { align: 'right' }));
    doc.setDrawColor(...PURPLE);
    doc.setLineWidth(0.6);
    const ly = first ? 29 : 23;
    doc.line(L, ly, L + W, ly);
    y = ly + 5;
  };
  const newPage = () => {
    doc.addPage();
    page += 1;
    letterhead(false);
  };
  const need = (h: number) => {
    if (y + h > BOTTOM) newPage();
  };

  letterhead(true);

  const drawCell = (text: string, x: number, top: number, width: number, size: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    setInk();
    const lines = doc.splitTextToSize(text, width - 3) as string[];
    lines.forEach((ln, i) => doc.text(ln, x + 1.5, top + 3.4 + i * lineH(size)));
  };
  const rowHeight = (cells: Array<[string, number]>, size: number, style: 'normal' | 'bold' = 'normal') => {
    let max = 1;
    for (const [t, w] of cells) max = Math.max(max, wrap(t, w - 3, size, style).length);
    return max * lineH(size) + 2.4;
  };

  // Height a table or key/value block needs, so a heading is never left alone at the foot of a page.
  const KV_COLS4 = [0.19, 0.31, 0.19, 0.31];
  const KV_COLS2 = [0.28, 0.72];
  const measure = (blk: Block | undefined): number => {
    if (!blk) return 0;
    if (blk.t === 'kv' || blk.t === 'kv4') {
      const cols = blk.t === 'kv4' ? KV_COLS4 : KV_COLS2;
      return (blk.rows as string[][]).reduce(
        (sum, row) => sum + Math.max(...row.map((t, i) => rowHeight([[t, cols[i] * W]], 8.8, i % 2 === 0 ? 'bold' : 'normal'))),
        3
      );
    }
    if (blk.t === 'table') {
      const widths = blk.widths.map((f) => f * W);
      return rowHeight(blk.head.map((t, i) => [t, widths[i]] as [string, number]), 8.8, 'bold') + blk.rows.reduce((sum, row) => sum + rowHeight(row.map((t, i) => [t, widths[i]] as [string, number]), 8.8), 3);
    }
    return 0;
  };

  const blocks = buildPolicyBlocks(d);
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    switch (b.t) {
      case 'h1': {
        need(14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15.5);
        doc.setTextColor(19, 10, 58);
        doc.text(b.text, L, y + 4);
        y += 8;
        break;
      }
      case 'sub': {
        const lines = wrap(b.text, W, 8.2);
        doc.setTextColor(...GREY);
        doc.text(lines, L, y + 1);
        y += lines.length * lineH(8.2) + 3;
        break;
      }
      case 'notice': {
        const lines = wrap(b.text, W - 6, 9, 'bold');
        const h = lines.length * lineH(9) + 4;
        need(h + 2);
        doc.setFillColor(244, 240, 255);
        doc.setDrawColor(205, 189, 255);
        doc.setLineWidth(0.3);
        doc.rect(L, y, W, h, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(36, 19, 94);
        doc.text(lines, L + 3, y + 5);
        y += h + 3;
        break;
      }
      case 'h2': {
        const next = measure(blocks[bi + 1]);
        need(next && next < 90 ? 12 + next : 24);
        y += 2;
        doc.setFillColor(239, 234, 255);
        doc.rect(L, y, W, 6.4, 'F');
        doc.setFillColor(...PURPLE);
        doc.rect(L, y, 0.9, 6.4, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.4);
        doc.setTextColor(36, 19, 94);
        doc.text(b.text, L + 3, y + 4.5);
        y += 9;
        break;
      }
      case 'h3': {
        const nextH = measure(blocks[bi + 1]);
        need(nextH && nextH < 90 ? 8 + nextH : 14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.4);
        doc.setTextColor(36, 19, 94);
        doc.text(b.text, L, y + 3);
        y += 5;
        break;
      }
      case 'p': {
        const lines = wrap(b.text, W, 9);
        const per = lineH(9);
        for (let i = 0; i < lines.length; ) {
          const fit = Math.max(1, Math.floor((BOTTOM - y) / per));
          if (BOTTOM - y < per * 2) {
            newPage();
            continue;
          }
          const chunk = lines.slice(i, i + fit);
          setInk();
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.text(chunk, L, y + 3);
          y += chunk.length * per;
          i += chunk.length;
        }
        y += 2;
        break;
      }
      case 'note': {
        const lines = wrap(b.text, W - 6, 8.6);
        const h = lines.length * lineH(8.6) + 3.4;
        need(h + 2);
        doc.setFillColor(244, 240, 255);
        doc.setDrawColor(205, 189, 255);
        doc.rect(L, y, W, h, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.6);
        setInk();
        doc.text(lines, L + 3, y + 4.2);
        y += h + 3;
        break;
      }
      case 'kv':
      case 'kv4': {
        const four = b.t === 'kv4';
        const cols = four ? KV_COLS4 : KV_COLS2;
        for (const row of b.rows) {
          const cells = row.map((t, i) => [t, cols[i] * W] as [string, number]);
          // Key cells are bold and so wider: measure them with the style they are drawn in.
          let h = 1;
          cells.forEach(([t, w], i) => {
            h = Math.max(h, rowHeight([[t, w]], 8.8, i % 2 === 0 ? 'bold' : 'normal'));
          });
          need(h);
          let x = L;
          cells.forEach(([t, w], i) => {
            const key = i % 2 === 0;
            if (key) {
              doc.setFillColor(251, 250, 255);
              doc.rect(x, y, w, h, 'F');
            }
            doc.setDrawColor(...RULE);
            doc.setLineWidth(0.2);
            doc.rect(x, y, w, h);
            drawCell(t, x, y, w, 8.8, key ? 'bold' : 'normal');
            x += w;
          });
          y += h;
        }
        y += 3;
        break;
      }
      case 'table': {
        const widths = b.widths.map((f) => f * W);
        const headH = rowHeight(b.head.map((t, i) => [t, widths[i]] as [string, number]), 8.8, 'bold');
        const total = headH + b.rows.reduce((sum, row) => sum + rowHeight(row.map((t, i) => [t, widths[i]] as [string, number]), 8.8), 0);
        need(total < 80 ? total + 3 : headH + 6); // a short table stays on one page
        let x = L;
        b.head.forEach((t, i) => {
          doc.setFillColor(244, 241, 255);
          doc.rect(x, y, widths[i], headH, 'F');
          doc.setDrawColor(...RULE);
          doc.rect(x, y, widths[i], headH);
          drawCell(t, x, y, widths[i], 8.8, 'bold');
          x += widths[i];
        });
        y += headH;
        b.rows.forEach((row, ri) => {
          const last = ri === b.rows.length - 1 && /^total/i.test(row[0]);
          const h = rowHeight(row.map((t, i) => [t, widths[i]] as [string, number]), 8.8, last ? 'bold' : 'normal');
          need(h);
          let cx = L;
          row.forEach((t, i) => {
            doc.setDrawColor(...RULE);
            doc.rect(cx, y, widths[i], h);
            drawCell(t, cx, y, widths[i], 8.8, last ? 'bold' : 'normal');
            cx += widths[i];
          });
          y += h;
        });
        y += 3;
        break;
      }
      case 'list': {
        b.items.forEach((item, i) => {
          const lines = wrap(`${i + 1}. ${item}`, W - 4, 9);
          need(lines.length * lineH(9) + 1);
          setInk();
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.text(lines, L + 3, y + 3);
          y += lines.length * lineH(9) + 1;
        });
        y += 2;
        break;
      }
      case 'sig': {
        need(30);
        y += 4;
        doc.setFont('times', 'italic');
        doc.setFontSize(20);
        doc.setTextColor(31, 58, 138);
        doc.text(b.left[0], L, y + 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        setInk();
        doc.text(b.left[1], L, y + 12);
        doc.setFontSize(8);
        doc.setTextColor(123, 45, 0);
        doc.text(b.left[2], L, y + 16);
        setInk();
        doc.setFontSize(9);
        b.right.forEach((line, i) => doc.text(line, L + W, y + 6 + i * 5, { align: 'right' }));
        y += 22;
        break;
      }
    }
  }

  // Footer, page numbers and a faint SAMPLE watermark on every page.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(L, 287, L + W, 287);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(...GREY);
    doc.text(FOOTER_TEXT, L, 291);
    doc.text(`Page ${p} of ${total}`, L + W, 291, { align: 'right' });
    doc.saveGraphicsState();
    const GState = (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
    doc.setGState(new GState({ opacity: 0.07 }) as never);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(110);
    doc.setTextColor(...PURPLE);
    doc.text('SAMPLE', 105, 165, { angle: 30, align: 'center' });
    doc.restoreGraphicsState();
  }
  return doc.output('blob');
}
