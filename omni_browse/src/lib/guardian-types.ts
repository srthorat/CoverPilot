// Shared shapes for Integrity Guardian: the independent review of a proposed-policy document.
// The model only reads and explains; every pass/fail decision against the proposal or the rules is
// deterministic (guardian-checks.ts) so a finding always says which kind of check produced it.

export interface GuardianPage {
  page: number;
  text: string; // identity numbers already masked in the browser
}

/** What the customer has entered in the application (no identity numbers, no names). */
export interface ProposalFacts {
  sumAssured: '1cr' | '1.5cr' | '2cr';
  monthlyPremium: number; // rupees, no GST
  termYears: number;
  riders: string[]; // e.g. ['Critical illness 25 lakh']
  nomineeCount: number;
  nomineesTotalShare: number;
  anyMinorNominee: boolean;
  smoker: boolean | null;
}

export type FindingKind = 'ok' | 'missing' | 'inconsistent' | 'risk' | 'question';

export interface GuardianFinding {
  kind: FindingKind;
  text: string; // plain language, a potential issue, never an accusation
  page?: number; // the page the evidence is on
  source: 'model' | 'check'; // model reading vs deterministic comparison
  fixStep?: 1 | 2 | 3 | 4 | 5; // application step where the customer can change it
}

export interface GuardianSection {
  id: string;
  title: string; // e.g. "Policy schedule and premium"
  pages: number[];
  summary: string; // what the document says, in plain words
  coverage: string[];
  exclusions: string[];
  findings: GuardianFinding[];
  suggestedQuestions: string[]; // questions to put to the insurer
}

/** Facts the model read out of the document; null means the document does not say. */
export interface DocumentFacts {
  sumAssuredRupees: number | null;
  monthlyPremium: number | null;
  termYears: number | null;
  graceDaysMonthly: number | null;
  graceDaysOther: number | null;
  freeLookDays: number | null;
  suicideExclusionMonths: number | null;
  suicideRefundPercent: number | null; // minimum share of premiums refunded, if stated
  revivalYears: number | null;
  contestabilityYears: number | null;
  nomineeSectionPresent: boolean | null;
  riders: string[];
  pageOf: Partial<Record<'sumAssured' | 'premium' | 'term' | 'grace' | 'freeLook' | 'suicide' | 'revival' | 'contestability' | 'nominee', number>>;
}

export interface GuardianReview {
  documentKind: 'proposed policy' | 'policy illustration' | 'policy summary' | 'other';
  sections: GuardianSection[];
  facts: DocumentFacts;
  overall: string; // two or three sentences, plain language
}

export interface GuardianResponse {
  provider: 'spark' | 'spark-open';
  model: string;
  ms: number;
  usage?: { promptTokens: number | null; completionTokens: number | null };
  review: GuardianReview;
}
