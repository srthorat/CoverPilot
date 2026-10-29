import fs from 'node:fs';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

// Writes docs/acceptance-report.md: one row per acceptance item, with the real outcome of the run.
export default class AcceptanceReport implements Reporter {
  private rows: Array<{ id: string; title: string; status: string; ms: number; note: string }> = [];

  onTestEnd(test: TestCase, result: TestResult) {
    const m = /^(AC-\d+|EX-\d+)\s+(.*)$/.exec(test.title);
    if (!m) return;
    const note = result.status === 'passed' ? '' : (result.error?.message || '').split('\n')[0].slice(0, 160);
    this.rows.push({ id: m[1], title: m[2], status: result.status === 'passed' ? 'pass' : result.status === 'skipped' ? 'skipped' : 'FAIL', ms: result.duration, note });
  }

  onEnd(_result: FullResult) {
    const browser = process.env.BROWSER || 'chromium';
    const pass = this.rows.filter((r) => r.status === 'pass').length;
    const lines = [
      `# Acceptance report (${browser}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
      '',
      `${pass} of ${this.rows.length} checks passed against the running app with the live Meta models.`,
      '',
      '| ID | Check | Result | Seconds | Note |',
      '|---|---|---|---|---|',
      ...this.rows.map((r) => `| ${r.id} | ${r.title} | ${r.status} | ${(r.ms / 1000).toFixed(1)} | ${r.note.replace(/\|/g, '/')} |`),
      '',
    ];
    fs.mkdirSync('../docs', { recursive: true });
    fs.writeFileSync(`../docs/acceptance-report-${browser}.md`, lines.join('\n'));
  }
}
