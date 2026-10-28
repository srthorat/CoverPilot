'use client';

import React from 'react';
import type { KbChunk } from '@/lib/voice-client';

export interface SessionStats {
  interrupts: number;
  approve: number;
  amend: number;
  reject: number;
  error: number;
}

export interface TurnMarks {
  speechEnd?: number;
  ack?: number;
  firstToken?: number;
  firstAudio?: number;
  verified?: number;
}

export interface TurnRecord {
  turnId: number;
  userText: string;
  source: 'voice' | 'text';
  kbChunks?: KbChunk[];
  marks?: TurnMarks;
  memoryAdded?: string[];
  agentText?: string;
  ttftMs?: number | null;
  totalMs?: number | null;
  wonder?: {
    status: 'pending' | 'approve' | 'amend' | 'reject' | 'error';
    actionTitle: string;
    reason?: string;
    ms?: number;
  };
  ackMs?: number | null;
  actions?: string[];
}

export function describeFieldAction(a: Record<string, any>): string {
  switch (a.type) {
    case 'fill':
      return `fill ${a.field} = "${a.value}"`;
    case 'select':
      return `${a.value ? 'select' : 'deselect'} ${a.field}`;
    case 'ladder':
      return `ladder ${a.field} → ${String(a.value)}`;
    case 'navigate':
      return `navigate → step ${a.step}`;
    case 'cover':
      return `base cover → ${a.value}`;
    case 'ui':
      return `ui: ${a.action}`;
    case 'nominate':
      return `nominate ${Object.entries(a)
        .filter(([k]) => k !== 'type')
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`;
    default:
      return JSON.stringify(a).slice(0, 80);
  }
}

interface Props {
  turns: TurnRecord[];
  memoryFacts: string[];
  agentState: 'listening' | 'thinking' | 'speaking';
  stats: SessionStats;
}

const TIMELINE: Array<{ key: keyof TurnMarks; label: string; color: string }> = [
  { key: 'ack', label: 'Ack', color: 'bg-yellow-400' },
  { key: 'firstToken', label: 'First token', color: 'bg-green-400' },
  { key: 'firstAudio', label: 'First audio', color: 'bg-blue-400' },
  { key: 'verified', label: 'Wonder verified', color: 'bg-purple-400' },
];

function Timeline({ marks }: { marks: TurnMarks }) {
  const origin = marks.speechEnd;
  if (origin == null) return null;
  const offsets = TIMELINE.map((s) => ({ ...s, ms: marks[s.key] != null ? (marks[s.key] as number) - origin : null }));
  const scale = Math.max(1000, ...offsets.map((o) => o.ms ?? 0));
  return (
    <div className="bg-[#1a1035] rounded-lg p-2.5 mb-2">
      <div className="text-[10px] text-slate-400 mb-1.5">Turn timeline (from end of speech)</div>
      <div className="space-y-1.5">
        {offsets.map((o) => (
          <div key={o.key} className="flex items-center gap-2 text-[10px]">
            <span className="w-24 shrink-0 text-slate-300">{o.label}</span>
            <div className="flex-1 h-2 rounded bg-[#0d0921] overflow-hidden">
              {o.ms != null && <div className={`h-full ${o.color}`} style={{ width: `${Math.min(100, (o.ms / scale) * 100)}%` }} />}
            </div>
            <span className="w-14 shrink-0 text-right tabular-nums text-slate-200">{o.ms != null ? `${o.ms} ms` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const WONDER_COLOR: Record<string, string> = {
  pending: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  approve: 'text-green-400 bg-green-400/10 border-green-400/30',
  amend: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  reject: 'text-red-400 bg-red-400/10 border-red-400/30',
  error: 'text-slate-400 bg-slate-400/10 border-slate-400/30',
};

const WONDER_LABEL: Record<string, string> = {
  pending: '⏳ Verifying',
  approve: '✓ Approved',
  amend: '✎ Amended',
  reject: '✗ Rejected',
  error: '! Error',
};

export function PresenterPanel({ turns, memoryFacts, agentState, stats }: Props) {
  const latest = turns[turns.length - 1] ?? null;
  const older = turns.slice(-6, -1).reverse();
  const verdicts = stats.approve + stats.amend + stats.reject + stats.error;

  return (
    <div className="w-[400px] shrink-0 bg-[#0d0921] text-white flex flex-col overflow-hidden border-l border-purple-900/40 font-mono text-xs">
      {/* Header */}
      <div className="px-4 py-3 bg-[#1a0f42] border-b border-purple-900/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            <span className="font-bold text-purple-200 text-[11px] uppercase tracking-widest">Agent Internals</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                agentState === 'speaking'
                  ? 'bg-purple-600 text-white'
                  : agentState === 'thinking'
                  ? 'bg-yellow-600/80 text-yellow-100'
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              {agentState === 'speaking' ? '🔊 Speaking' : agentState === 'thinking' ? '⚙ Thinking' : '🎙 Listening'}
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px]">
          <span className="px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 font-sans font-bold whitespace-nowrap">
            🔒 PII never sent to the model
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
          <span className="px-1.5 py-0.5 rounded bg-[#1a1035] text-slate-300">⛔ {stats.interrupts} barge-in{stats.interrupts === 1 ? '' : 's'}</span>
          <span className="px-1.5 py-0.5 rounded bg-green-400/10 text-green-400">✓ {stats.approve}</span>
          <span className="px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400">✎ {stats.amend}</span>
          <span className="px-1.5 py-0.5 rounded bg-red-400/10 text-red-400">✗ {stats.reject}</span>
          <span className="text-slate-500 ml-auto">{verdicts} verdicts</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Current turn */}
        {latest && (
          <section>
            <div className="text-[10px] text-purple-400 font-bold uppercase tracking-wider mb-1.5">
              Turn #{latest.turnId}
            </div>

            {/* User text */}
            <div className="bg-[#1a1035] rounded-lg p-2.5 mb-2">
              <div className="text-[10px] text-slate-400 mb-1">
                {latest.source === 'voice' ? '🎙 Muse Voice Transcribe 1.0' : '⌨ Text input'}
              </div>
              <div className="text-white text-[12px] leading-relaxed">"{latest.userText}"</div>
            </div>

            {/* KB chunks */}
            {latest.kbChunks && latest.kbChunks.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] text-purple-400 mb-1">📚 KB chunks (BM25, {latest.kbChunks.length} retrieved)</div>
                <div className="space-y-1">
                  {latest.kbChunks.map((chunk, i) => (
                    <div key={i} className="bg-[#1a1035] rounded px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-300 text-[11px] truncate">{chunk.label}</span>
                        <span className="text-purple-400 text-[10px] font-bold shrink-0">score {chunk.score.toFixed(2)}</span>
                      </div>
                      {chunk.terms && chunk.terms.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {chunk.terms.map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0 rounded bg-purple-900/60 text-purple-200 font-sans">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agent response */}
            {latest.agentText && (
              <div className="bg-[#0f1a2e] border border-blue-900/50 rounded-lg p-2.5 mb-2">
                <div className="text-[10px] text-blue-400 mb-1">🤖 Muse Spark 1.3</div>
                <div className="text-slate-200 text-[11px] leading-relaxed">{latest.agentText}</div>
              </div>
            )}

            {/* Form actions the agent executed */}
            {latest.actions && latest.actions.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] text-emerald-400 mb-1">⚡ Form actions executed ({latest.actions.length})</div>
                <div className="space-y-1">
                  {latest.actions.map((a, i) => (
                    <div key={i} className="bg-[#0f2a1e] border border-emerald-900/50 rounded px-2 py-1 text-[11px] text-emerald-200">
                      {a}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {latest.marks && <Timeline marks={latest.marks} />}

            {latest.memoryAdded && latest.memoryAdded.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] text-purple-400 mb-1">🧠 Remembered this turn ({latest.memoryAdded.length})</div>
                <div className="space-y-1">
                  {latest.memoryAdded.map((f, i) => (
                    <div key={i} className="bg-[#1a1035] rounded px-2 py-1 text-[10px] text-slate-200 leading-relaxed">+ {f}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Latency tiles */}
            {(latest.ackMs != null || latest.ttftMs != null || latest.totalMs != null) && (
              <div className="flex gap-2 mb-2">
                {latest.ackMs != null && (
                  <div className="bg-[#1a1035] rounded px-2 py-1.5 flex-1 text-center">
                    <div className="text-[9px] text-slate-400 uppercase">Ack</div>
                    <div className="text-[15px] font-bold text-yellow-400">{latest.ackMs}</div>
                    <div className="text-[9px] text-slate-500">ms</div>
                  </div>
                )}
                {latest.ttftMs != null && (
                  <div className="bg-[#1a1035] rounded px-2 py-1.5 flex-1 text-center">
                    <div className="text-[9px] text-slate-400 uppercase">TTFT</div>
                    <div className="text-[15px] font-bold text-green-400">{latest.ttftMs}</div>
                    <div className="text-[9px] text-slate-500">ms</div>
                  </div>
                )}
                {latest.totalMs != null && (
                  <div className="bg-[#1a1035] rounded px-2 py-1.5 flex-1 text-center">
                    <div className="text-[9px] text-slate-400 uppercase">Total</div>
                    <div className="text-[15px] font-bold text-blue-400">{latest.totalMs}</div>
                    <div className="text-[9px] text-slate-500">ms</div>
                  </div>
                )}
              </div>
            )}

            {/* Wonder verdict */}
            {latest.wonder && (
              <div className={`rounded-lg p-2.5 border ${WONDER_COLOR[latest.wonder.status] ?? 'bg-slate-800 border-slate-700'}`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-bold">⚖ Muse Wonder 1.0</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold">{WONDER_LABEL[latest.wonder.status] ?? latest.wonder.status}</span>
                    {latest.wonder.ms != null && (
                      <span className="text-[9px] opacity-60">{latest.wonder.ms} ms</span>
                    )}
                  </div>
                </div>
                <div className="text-[11px] opacity-80">"{latest.wonder.actionTitle}"</div>
                {latest.wonder.reason && (
                  <div className="text-[10px] mt-0.5 opacity-60">{latest.wonder.reason}</div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Memory facts */}
        {memoryFacts.length > 0 && (
          <section>
            <div className="text-[10px] text-purple-400 font-bold uppercase tracking-wider mb-1.5">
              🧠 Customer Memory ({memoryFacts.length} facts · SQLite)
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {memoryFacts.slice(-8).map((fact, i) => (
                <div key={i} className="bg-[#1a1035] rounded px-2 py-1 text-[10px] text-slate-300 leading-relaxed">
                  {fact}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Turn history */}
        {older.length > 0 && (
          <section>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">
              Recent turns
            </div>
            <div className="space-y-1">
              {older.map((t) => (
                <div key={t.turnId} className="bg-[#1a1035]/60 rounded px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">
                      #{t.turnId} {t.source === 'voice' ? '🎙' : '⌨'}
                    </span>
                    {t.totalMs != null && (
                      <span className="text-[9px] text-slate-500">{t.totalMs} ms</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-300 truncate">"{t.userText}"</div>
                  {t.wonder && (
                    <span className={`text-[9px] font-bold ${(WONDER_COLOR[t.wonder.status] ?? '').split(' ')[0]}`}>
                      {WONDER_LABEL[t.wonder.status] ?? t.wonder.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {!latest && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-4xl mb-3">🤖</div>
            <div className="text-slate-400 text-[12px] font-sans">Waiting for first turn…</div>
            <div className="text-slate-600 text-[11px] mt-1 font-sans">Connect the voice agent to begin</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 bg-[#1a0f42] border-t border-purple-900/40 text-[9px] text-purple-400/60 text-center">
        Muse Spark 1.3 · Voice Transcribe 1.0 · Wonder 1.0 · Pipecat 1.14.0
      </div>
    </div>
  );
}
