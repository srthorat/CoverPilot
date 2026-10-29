// The model's review is untrusted output: it is rebuilt field by field here, so only well-formed,
// capped, on-schema values reach the browser. Anything else becomes null or is dropped.

import type { DocumentFacts, FindingKind, GuardianFinding, GuardianReview, GuardianSection } from './guardian-types.ts';

const KINDS: FindingKind[] = ['ok', 'missing', 'risk', 'question']; // 'inconsistent' is the app's own check, never the model's
const DOC_KINDS: GuardianReview['documentKind'][] = ['proposed policy', 'policy illustration', 'policy summary', 'other'];
const PAGE_KEYS = ['sumAssured', 'premium', 'term', 'grace', 'freeLook', 'suicide', 'revival', 'contestability', 'nominee'] as const;

const hostile = (s: string) => s.includes('<<ACTION>>') || s.includes('{"type"');

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\s+/g, ' ').trim();
  return t && !hostile(t) ? t.slice(0, max) : '';
}

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function list(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, max)).filter(Boolean).slice(0, 8);
}

function pageIn(v: unknown, pages: number[]): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && pages.includes(v) ? v : undefined;
}

export function validateReview(raw: unknown, pageNumbers: number[]): GuardianReview {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;

  const sections: GuardianSection[] = (Array.isArray(r.sections) ? r.sections : [])
    .slice(0, 7)
    .map((s: any, i: number): GuardianSection | null => {
      if (!s || typeof s !== 'object') return null;
      const title = str(s.title, 80);
      if (!title) return null;
      const findings: GuardianFinding[] = (Array.isArray(s.findings) ? s.findings : [])
        .slice(0, 8)
        .map((f: any): GuardianFinding | null => {
          const text = str(f?.text, 300);
          if (!text || !KINDS.includes(f?.kind)) return null;
          const page = pageIn(f?.page, pageNumbers);
          return { kind: f.kind, text, ...(page !== undefined ? { page } : {}), source: 'model' };
        })
        .filter((f: GuardianFinding | null): f is GuardianFinding => f !== null);
      return {
        id: `s${i + 1}`,
        title,
        pages: (Array.isArray(s.pages) ? s.pages : []).map((p: unknown) => pageIn(p, pageNumbers)).filter((p: number | undefined): p is number => p !== undefined).slice(0, 8),
        summary: str(s.summary, 600),
        coverage: list(s.coverage, 200),
        exclusions: list(s.exclusions, 200),
        findings,
        suggestedQuestions: list(s.suggestedQuestions, 200),
      };
    })
    .filter((s: GuardianSection | null): s is GuardianSection => s !== null);

  const f = (r.facts && typeof r.facts === 'object' ? r.facts : {}) as Record<string, any>;
  const pageOf: DocumentFacts['pageOf'] = {};
  for (const k of PAGE_KEYS) {
    const p = pageIn(f.pageOf?.[k], pageNumbers);
    if (p !== undefined) pageOf[k] = p;
  }
  const facts: DocumentFacts = {
    sumAssuredRupees: num(f.sumAssuredRupees, 0, 1e10),
    monthlyPremium: num(f.monthlyPremium, 0, 1e10),
    termYears: num(f.termYears, 0, 100),
    graceDaysMonthly: num(f.graceDaysMonthly, 0, 3650),
    graceDaysOther: num(f.graceDaysOther, 0, 3650),
    freeLookDays: num(f.freeLookDays, 0, 3650),
    suicideExclusionMonths: num(f.suicideExclusionMonths, 0, 600),
    suicideRefundPercent: num(f.suicideRefundPercent, 0, 100),
    revivalYears: num(f.revivalYears, 0, 100),
    contestabilityYears: num(f.contestabilityYears, 0, 100),
    nomineeSectionPresent: typeof f.nomineeSectionPresent === 'boolean' ? f.nomineeSectionPresent : null,
    riders: list(f.riders, 120),
    pageOf,
  };

  return {
    documentKind: DOC_KINDS.includes(r.documentKind) ? r.documentKind : 'other',
    sections,
    facts,
    overall: str(r.overall, 600),
  };
}
