'use client';

import React, { useEffect, useRef } from 'react';
import type { GuardianFinding, GuardianPage, GuardianResponse } from '@/lib/guardian-types';

export interface GuardianDoc {
  name: string;
  pages: GuardianPage[];
  masked: number;
  status: 'reading' | 'ready' | 'sent' | 'error';
  error?: string;
}

export interface GuardianReviewState {
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  response?: GuardianResponse;
  checks: GuardianFinding[];
  history: Array<{ at: number; issues: number; model: string }>;
}

interface Props {
  doc: GuardianDoc | null;
  review: GuardianReviewState;
  currentSection: number;
  reviewedSections: number[];
  askedQuestions: string[];
  canUseDraft: boolean;
  allowOwnFile: boolean; // hidden in the demo build, which uses sample documents only
  comparing: boolean; // false when no application has been started, so only the fixed rules are checked
  onFile: (file: File) => void;
  onSample: (which: 'sample' | 'issues' | 'draft') => void;
  onClear: () => void;
  onRun: () => void;
  onSection: (i: number) => void;
  onVoiceReview: () => void;
  onAsk: (q: string) => void;
  onFix: (step: 1 | 2 | 3 | 4 | 5) => void;
  onDownloadReport: () => void;
}

const MASK = /(\[(?:aadhaar|PAN|mobile|email|account or card) masked\])/g;
const IS_MASK = /^\[(?:aadhaar|PAN|mobile|email|account or card) masked\]$/;

// Personal numbers were replaced in the browser; show them as black bars so the customer can see exactly what was hidden.
function Redacted({ text }: { text: string }) {
  return (
    <>
      {text.split(MASK).map((part, i) =>
        IS_MASK.test(part) ? (
          <span key={i} title={`${part.slice(1, -1)}: hidden in your browser before anything was shared`} className="inline-block align-baseline bg-slate-900 text-slate-900 rounded-sm select-none px-3 mx-0.5 text-[10px] leading-4">
            ████████
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

const KIND: Record<GuardianFinding['kind'], { label: string; cls: string }> = {
  ok: { label: 'Matches', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  missing: { label: 'Missing', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  inconsistent: { label: 'Possible mismatch', cls: 'bg-red-50 text-red-800 border-red-200' },
  risk: { label: 'Worth querying', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  question: { label: 'Ask the insurer', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
};

export function GuardianView(p: Props) {
  const viewer = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const goToPage = (n?: number) => {
    if (!n) return;
    viewer.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const res = p.review.response?.review;
  const section = res?.sections[p.currentSection];
  useEffect(() => {
    if (section?.pages[0]) goToPage(section.pages[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.currentSection, res]);

  const allFindings: GuardianFinding[] = [...p.review.checks, ...(res?.sections.flatMap((s) => s.findings) ?? [])];
  const issues = p.review.checks.filter((f) => f.kind === 'inconsistent' || f.kind === 'risk' || f.kind === 'missing');
  const questions = Array.from(new Set(res?.sections.flatMap((s) => s.suggestedQuestions) ?? []));
  const unasked = questions.filter((q) => !p.askedQuestions.includes(q));

  return (
    <div className="nx-card p-4 flex flex-col gap-3" id="guardian-view">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
        <div>
          <h2 className="text-base font-bold text-[#111827]">Integrity Guardian: independent review of your proposed policy</h2>
          <p className="text-xs text-slate-500">
            It explains what the document says and flags possible issues with page references. It never changes your application and cannot say whether a claim would be paid.
          </p>
        </div>
        {p.review.response && (
          <span className="text-[11px] px-2 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200" title="The model that read the document">
            Reviewed by {p.review.response.model}
            {p.review.response.provider === 'spark-open' ? ' (open weights)' : ''} · {Math.round(p.review.response.ms / 100) / 10}s
          </span>
        )}
      </div>

      {/* 1. The document */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
        <span className="font-semibold text-slate-700">Document to review:</span>
        {p.allowOwnFile && <button onClick={() => fileInput.current?.click()} className="px-3 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 font-semibold">Choose a PDF</button>}
        <button disabled={!p.canUseDraft} onClick={() => p.onSample('draft')} title={p.canUseDraft ? 'The proposed policy generated from your application' : 'Complete the application first'} className="px-3 py-1 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-50 border border-slate-300 font-semibold">My proposed policy (draft)</button>
        <button onClick={() => p.onSample('issues')} className="px-3 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 font-semibold">Sample proposed policy (with issues)</button>
        <button onClick={() => p.onSample('sample')} className="px-3 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 font-semibold">Sample policy</button>
        <input ref={fileInput} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onFile(f); }} />
        {p.doc && p.doc.status !== 'reading' && p.doc.status !== 'error' && (
          <span className="text-slate-500">
            {p.doc.name}: {p.doc.pages.length} pages, read in your browser{p.doc.masked ? `; ${p.doc.masked} personal number${p.doc.masked === 1 ? '' : 's'} hidden (black bars)` : ''}.
            <button onClick={p.onClear} className="ml-2 underline">Remove</button>
          </span>
        )}
        {p.doc?.status === 'reading' && <span className="text-slate-500">Reading the PDF in your browser…</span>}
        {p.doc?.status === 'error' && <span className="text-red-600">{p.doc.error}</span>}
      </div>

      {!p.doc || p.doc.status === 'reading' || p.doc.status === 'error' ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
          Pick a sample proposed policy or your draft proposal summary above. Aadhaar, PAN, mobile, email and account numbers in the document are hidden in your browser before the text is used anywhere.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 min-h-0">
          {/* Redacted document, as the reviewer sees it */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 flex flex-col min-h-0">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 border-b border-slate-200 flex items-center justify-between">
              <span>The document as the reviewer sees it</span>
              <span className="font-normal text-slate-400">black bars = hidden in your browser</span>
            </div>
            <div ref={viewer} className="overflow-y-auto max-h-[52vh] p-3 space-y-3 text-[12px] leading-relaxed text-slate-800">
              {p.doc.pages.map((pg) => (
                <div key={pg.page} data-page={pg.page} className="bg-white rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-bold text-slate-400 mb-1">PAGE {pg.page}</div>
                  <div className="whitespace-pre-line">
                    <Redacted text={pg.text} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Review */}
          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={p.onRun}
                disabled={p.review.status === 'running'}
                className="px-4 py-1.5 rounded-lg bg-[#582be8] hover:bg-[#481dd4] disabled:opacity-60 text-white text-xs font-bold"
              >
                {p.review.status === 'running' ? 'Reviewing…' : p.review.response ? 'Review again' : 'Run Integrity Guardian'}
              </button>
              {res && (
                <button onClick={p.onVoiceReview} className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold" title="The agent walks through each section by voice">
                  Walk me through it by voice
                </button>
              )}
              {p.review.history.length > 1 && (
                <span className="text-[11px] text-slate-500">
                  Reviews: {p.review.history.map((h, i) => `#${i + 1} ${h.issues} issue${h.issues === 1 ? '' : 's'}`).join(' → ')}
                </span>
              )}
            </div>
            {p.review.status === 'error' && <div className="text-xs text-red-600">{p.review.error}</div>}
            {p.review.status === 'running' && <div className="text-xs text-slate-500">Reading every page and comparing it with your application. This takes about half a minute.</div>}

            {res && (
              <div className="overflow-y-auto max-h-[52vh] flex flex-col gap-2 pr-1">
                <div className="rounded-xl bg-purple-50 border border-purple-200 p-2.5 text-xs text-purple-950">
                  <strong>Overall:</strong> {res.overall}
                  <div className="mt-1 text-[11px] text-purple-800">
                    Document type: {res.documentKind}. {issues.length} possible issue{issues.length === 1 ? '' : 's'} found by comparing the document with your application and with fixed rules.
                  </div>
                </div>

                {/* Deterministic checks first: these are comparisons, not model opinions */}
                <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                  <div className="text-xs font-bold text-slate-900 mb-1">Checks against your application and the rules</div>
                  {!p.comparing && (
                    <div className="mb-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                      No application has been started in this session, so the document is checked against the fixed rules only. Build an application in Co-browse to compare cover, premium, riders and nominees.
                    </div>
                  )}
                  <ul className="flex flex-col gap-1.5">
                    {p.review.checks.map((f, i) => (
                      <li key={i} className="text-xs flex flex-wrap items-start gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${KIND[f.kind].cls}`}>{KIND[f.kind].label}</span>
                        <span className="flex-1 min-w-[12rem] text-slate-700">{f.text}</span>
                        {f.page && <button onClick={() => goToPage(f.page)} className="underline text-[#582be8]">page {f.page}</button>}
                        {f.fixStep && f.kind !== 'ok' && (
                          <button onClick={() => p.onFix(f.fixStep!)} className="px-2 py-0.5 rounded-lg bg-white border border-slate-300 font-semibold">
                            Fix in the application
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 text-[10px] text-slate-400">Nothing is changed for you: fixing means going back to that step and choosing the value yourself.</div>
                </div>

                {/* Sections */}
                {res.sections.map((s, i) => (
                  <div key={s.id} className={`rounded-xl border p-2.5 ${i === p.currentSection ? 'border-[#582be8] bg-white' : 'border-slate-200 bg-white'}`}>
                    <button onClick={() => p.onSection(i)} className="w-full text-left flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        {i + 1}. {s.title} {p.reviewedSections.includes(i) && <span className="text-emerald-600 font-normal">· reviewed</span>}
                      </span>
                      <span className="text-[11px] text-slate-500">{s.pages.length ? `page${s.pages.length > 1 ? 's' : ''} ${s.pages.join(', ')}` : ''}</span>
                    </button>
                    {i === p.currentSection && (
                      <div className="mt-1.5 text-xs text-slate-700 flex flex-col gap-1.5">
                        <p>{s.summary}</p>
                        {s.coverage.length > 0 && <p><strong>Covers:</strong> {s.coverage.join('; ')}</p>}
                        {s.exclusions.length > 0 && <p><strong>Does not cover or limits:</strong> {s.exclusions.join('; ')}</p>}
                        {s.findings.map((f, k) => (
                          <p key={k} className="flex flex-wrap gap-1.5 items-start">
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${KIND[f.kind].cls}`}>{KIND[f.kind].label}</span>
                            <span className="flex-1 min-w-[12rem]">{f.text}</span>
                            {f.page && <button onClick={() => goToPage(f.page)} className="underline text-[#582be8]">page {f.page}</button>}
                          </p>
                        ))}
                        {s.suggestedQuestions.length > 0 && (
                          <div>
                            <div className="font-semibold">Questions to put to the insurer</div>
                            <ul className="list-disc pl-4">
                              {s.suggestedQuestions.map((q) => (
                                <li key={q}>
                                  {q} <button onClick={() => p.onAsk(q)} className="ml-1 underline text-[#582be8]">ask Guardian</button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Readiness report */}
                <div className="rounded-xl border-2 border-slate-300 bg-white p-2.5 text-xs" id="guardian-report">
                  <div className="font-bold text-slate-900 mb-1">Readiness report</div>
                  <ul className="flex flex-col gap-0.5 text-slate-700">
                    <li>Sections reviewed with you: {p.reviewedSections.length} of {res.sections.length}</li>
                    <li>Possible issues still open: {issues.length}</li>
                    <li>Questions for the insurer not yet asked: {unasked.length} of {questions.length}</li>
                    <li>Checks that match your application: {p.review.checks.filter((f) => f.kind === 'ok').length}</li>
                  </ul>
                  <p className="mt-1 text-[11px] text-slate-500">
                    You are responsible for your declarations, consent, payment and the decision to proceed. This review is not legal or financial advice and does not predict any claim decision.
                  </p>
                  <button onClick={p.onDownloadReport} className="mt-1.5 px-3 py-1 rounded-lg bg-white border border-slate-300 font-semibold">Download the report</button>
                </div>
                {allFindings.length === 0 && <div className="text-xs text-slate-500">No findings.</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
