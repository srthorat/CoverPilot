// Deterministic comparison of what a proposed-policy document says against what the customer entered
// in the application and against fixed rules. No model is involved here, so every finding can say
// exactly which two things disagree. Wording stays hedged: these are possible issues to confirm
// with the insurer, never a verdict on whether a claim would be paid.

import type { DocumentFacts, GuardianFinding, ProposalFacts } from './guardian-types.ts';

const RUPEES: Record<ProposalFacts['sumAssured'], number> = { '1cr': 10_000_000, '1.5cr': 15_000_000, '2cr': 20_000_000 };
const LABEL: Record<ProposalFacts['sumAssured'], string> = { '1cr': '1 crore', '1.5cr': '1.5 crore', '2cr': '2 crore' };
const RIDER_WORDS: Array<[RegExp, RegExp]> = [
  [/critical/i, /critical/i],
  [/accident/i, /accident|disab/i],
  [/waiver/i, /waiver/i],
  [/hospital/i, /hospital/i],
];

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function runChecks(doc: DocumentFacts, p: ProposalFacts, opts: { compareApplication?: boolean } = {}): GuardianFinding[] {
  const compare = opts.compareApplication !== false;
  const out: GuardianFinding[] = [];
  const add = (kind: GuardianFinding['kind'], text: string, page?: number, fixStep?: GuardianFinding['fixStep']) =>
    out.push({ kind, text, page, fixStep, source: 'check' });

  if (compare) {
  // Cover and premium: document against application.
    if (doc.sumAssuredRupees === null) add('missing', 'The document does not state one clear sum assured, so it cannot be compared with the cover you chose.', doc.pageOf.sumAssured, 2);
    else if (doc.sumAssuredRupees !== RUPEES[p.sumAssured])
      add('inconsistent', `Possible mismatch: the document shows a sum assured of ${money(doc.sumAssuredRupees)} but your application has ${LABEL[p.sumAssured]}.`, doc.pageOf.sumAssured, 2);
    else add('ok', `Sum assured matches your application (${LABEL[p.sumAssured]}).`, doc.pageOf.sumAssured);
  
    if (doc.monthlyPremium === null) add('missing', 'The document does not state a monthly premium to compare with the one in your application.', doc.pageOf.premium, 2);
    else if (doc.monthlyPremium !== p.monthlyPremium)
      add('inconsistent', `Possible mismatch: the document shows a monthly premium of ${money(doc.monthlyPremium)} but your application shows ${money(p.monthlyPremium)}.`, doc.pageOf.premium, 2);
    else add('ok', `Monthly premium matches your application (${money(p.monthlyPremium)}).`, doc.pageOf.premium);
  
    if (doc.termYears !== null && doc.termYears !== p.termYears)
      add('inconsistent', `Possible mismatch: the document shows a ${doc.termYears}-year term but your application is for ${p.termYears} years. The term is set by the insurer, so ask them which is right.`, doc.pageOf.term);
  
    // Riders the customer chose against the riders the document lists.
    for (const chosen of p.riders) {
      const rule = RIDER_WORDS.find(([chosenRe]) => chosenRe.test(chosen));
      if (rule && !doc.riders.some((r) => rule[1].test(r)))
        add('inconsistent', `Possible omission: you chose "${chosen}" but the document does not list that rider as included.`, doc.pageOf.premium, 2);
    }
  }

  // Fixed rules (IRDAI master circulars and the Insurance Act), stated as possible issues.
  if (doc.graceDaysMonthly !== null && doc.graceDaysMonthly < 15)
    add('risk', `The document gives ${doc.graceDaysMonthly} days of grace for monthly premiums. IRDAI's rule is at least 15 days for monthly premiums, so this is worth querying.`, doc.pageOf.grace);
  if (doc.graceDaysOther !== null && doc.graceDaysOther < 30)
    add('risk', `The document gives ${doc.graceDaysOther} days of grace for other premium modes. IRDAI's rule is at least 30 days, so this is worth querying.`, doc.pageOf.grace);
  if (doc.suicideExclusionMonths !== null && doc.suicideExclusionMonths > 12)
    add('risk', `The document excludes suicide for ${doc.suicideExclusionMonths} months. The IRDAI minimum treatment applies to the first 12 months, so ask the insurer why it is longer.`, doc.pageOf.suicide);
  if (doc.suicideRefundPercent !== null && doc.suicideRefundPercent < 80)
    add('risk', `The document returns ${doc.suicideRefundPercent}% of premiums on suicide in the exclusion period. IRDAI requires at least 80% of premiums paid or the surrender value, whichever is higher.`, doc.pageOf.suicide);
  if (doc.freeLookDays !== null && doc.freeLookDays < 30)
    add('risk', `The document gives ${doc.freeLookDays} days of free-look. The IRDAI master circular allows thirty days for policies of a year or more, so confirm which applies.`, doc.pageOf.freeLook);
  if (doc.contestabilityYears !== null && doc.contestabilityYears !== 3)
    add('risk', `The document says a policy can be questioned for ${doc.contestabilityYears} years. Section 45 of the Insurance Act says three years, so ask the insurer to confirm.`, doc.pageOf.contestability);

  // Nomination.
  if (compare && doc.nomineeSectionPresent === false) {
    add('missing', `The document has no nomination section, although your application names ${p.nomineeCount} nominee${p.nomineeCount === 1 ? '' : 's'}. Ask the insurer where nominees are recorded.`, doc.pageOf.nominee, 3);
    if (p.anyMinorNominee) add('question', 'You named a nominee under 18; the document does not mention an appointee. Ask how the insurer records the appointee.', doc.pageOf.nominee, 3);
  }
  if (compare && p.nomineesTotalShare !== 100) add('inconsistent', `Your nominee shares total ${p.nomineesTotalShare}%, not 100%.`, undefined, 3);

  return out;
}

export function countIssues(findings: GuardianFinding[]): number {
  return findings.filter((f) => f.kind === 'inconsistent' || f.kind === 'risk' || f.kind === 'missing').length;
}
