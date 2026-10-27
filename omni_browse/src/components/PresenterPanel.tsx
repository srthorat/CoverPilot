'use client';

import React from 'react';

export interface TurnRecord {
  turnId: number;
  userText: string;
  source: 'voice' | 'text';
  kbChunks?: Array<{ label: string; score: number }>;
  agentText?: string;
  ttftMs?: number | null;
  totalMs?: number | null;
  wonder?: {
    status: 'pending' | 'approve' | 'amend' | 'reject' | 'error';
    actionTitle: string;
    reason?: string;
    ms?: number;
  };
}

interface Props {
  turns: TurnRecord[];
  memoryFacts: string[];
  agentState: 'listening' | 'thinking' | 'speaking';
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

export function PresenterPanel({ turns, memoryFacts, agentState }: Props) {
  const latest = turns[turns.length - 1] ?? null;
  const older = turns.slice(-6, -1).reverse();

  return (
    <div className="w-[400px] shrink-0 bg-[#0d0921] text-white flex flex-col overflow-hidden border-l border-purple-900/40 font-mono text-xs">
      {/* Header */}
      <div className="px-4 py-3 bg-[#1a0f42] border-b border-purple-900/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <span className="font-bold text-purple-200 text-[11px] uppercase tracking-widest">Agent Internals</span>
        </div>
        <div
          className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
            agentState === 'speaking'
              ? 'bg-purple-600 text-white'
              : agentState === 'thinking'
              ? 'bg-yellow-600/80 text-yellow-100'
              : 'bg-slate-700 text-slate-300'
          }`}
        >
          {agentState === 'speaking' ? '🔊 Speaking' : agentState === 'thinking' ? '⚙ Thinking' : '🎙 Listening'}
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
                    <div key={i} className="bg-[#1a1035] rounded px-2 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-slate-300 text-[11px] truncate">{chunk.label}</span>
                      <span className="text-purple-400 text-[10px] font-bold shrink-0">score {chunk.score.toFixed(2)}</span>
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

            {/* Latency tiles */}
            {(latest.ttftMs != null || latest.totalMs != null) && (
              <div className="flex gap-2 mb-2">
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
