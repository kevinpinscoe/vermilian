/**
 * Writes the run's acceptance evidence: manifest.json (build and environment
 * identity), results.json, and results.md — one row per checklist ID with
 * Pass / Fail / Blocked / Not run, expected and observed behavior, and the
 * evidence files.
 *
 * Classification:
 * - Pass     — the test passed.
 * - Fail     — an assertion about the application failed: a candidate defect.
 * - Blocked  — a prerequisite was missing (preflight) or the harness itself
 *              failed (HarnessError). Not evidence about the application.
 * - Not run  — skipped or interrupted.
 *
 * These reports are supporting evidence only. VERM-10's comments remain the
 * acceptance record, and nothing here constitutes Kevin's acceptance.
 */

import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import fs from 'fs';
import path from 'path';
import { redact } from './clients';
import { runIdentity, RunIdentity } from './identity';
import { liveEnv } from './app';
import { loadSettings } from './settings';

type Status = 'Pass' | 'Fail' | 'Blocked' | 'Not run';

interface Row {
  checklistId: string;
  title: string;
  status: Status;
  category: string;
  expected: string[];
  observed: unknown;
  pendingDecision: string[];
  blockedReason: string | null;
  error: string | null;
  durationMs: number;
  attachments: Array<{ name: string; path: string }>;
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (t: string) => t.replace(/\u001b\[[0-9;]*m/g, '');

function checklistId(title: string): string {
  const m = title.match(/^([A-Z]+[0-9]+(?:\/[A-Z]+[0-9]+)*)/);
  return m ? m[1] : title.split(' ')[0];
}

function classify(test: TestCase, result: TestResult): { status: Status; category: string; blockedReason: string | null } {
  const blocked = test.annotations.find((a) => a.type === 'blocked');
  const message = result.errors.map((e) => e.message ?? '').join('\n');
  const isSelfTest = test.title.startsWith('HARNESS');
  if (result.status === 'passed') return { status: 'Pass', category: isSelfTest ? 'harness self-test passed' : 'acceptance assertion held', blockedReason: null };
  if (result.status === 'skipped' || result.status === 'interrupted') return { status: 'Not run', category: result.status, blockedReason: null };
  if (blocked) return { status: 'Blocked', category: 'missing prerequisite', blockedReason: blocked.description ?? null };
  if (message.includes('[harness]')) return { status: 'Blocked', category: 'harness failure (not an application result)', blockedReason: redact(stripAnsi(message).split('\n')[0]) };
  if (isSelfTest) return { status: 'Fail', category: 'harness self-test failure (not an application result)', blockedReason: null };
  // Only a failed expect() is evidence about the application. Anything else —
  // an action timing out, an exception in test code — could be either, and is
  // reported as a failure that needs a human to classify it.
  if (/expect\(|toBe|toHave|toContain|toMatch/.test(message)) return { status: 'Fail', category: 'candidate application defect (assertion failed)', blockedReason: null };
  return { status: 'Fail', category: 'unclassified error: application or harness, needs review', blockedReason: null };
}

export default class LiveAcceptanceReporter implements Reporter {
  private rows: Row[] = [];
  private identity!: RunIdentity;
  private dir!: string;

  onBegin(_config: FullConfig, _suite: Suite) {
    const s = loadSettings();
    this.dir = s.evidenceDir;
    this.identity = runIdentity(s.executable, liveEnv().removed);
    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify({
      note: 'Supporting evidence only. VERM-10 comments are the authoritative acceptance record.',
      identity: this.identity,
      settings: { ...s, appTokenCommand: s.appTokenCommand ? '[set — not recorded]' : '', appTokenFile: s.appTokenFile ? '[set — not recorded]' : '' },
    }, null, 2));
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const c = classify(test, result);
    const observedFile = result.attachments.find((a) => a.name === 'observed' && a.path)?.path;
    let observed: unknown = null;
    if (observedFile) { try { observed = JSON.parse(fs.readFileSync(observedFile, 'utf-8')); } catch { /* left null */ } }
    this.rows.push({
      checklistId: checklistId(test.title),
      title: test.title,
      status: c.status,
      category: c.category,
      expected: test.annotations.filter((a) => a.type === 'expected').map((a) => a.description ?? ''),
      observed,
      pendingDecision: test.annotations.filter((a) => a.type === 'pending-decision').map((a) => a.description ?? ''),
      blockedReason: c.blockedReason,
      error: result.error ? redact(stripAnsi(result.error.message ?? '')).slice(0, 2000) : null,
      durationMs: result.duration,
      attachments: result.attachments.filter((a) => a.path).map((a) => ({ name: a.name, path: path.relative(this.dir, a.path!) })),
    });
  }

  onEnd(result: FullResult) {
    fs.writeFileSync(path.join(this.dir, 'results.json'), JSON.stringify({ overall: result.status, identity: this.identity, results: this.rows }, null, 2));
    const b = this.identity.build;
    const lines = [
      '# Vermilian live acceptance harness — run results',
      '',
      '> Supporting evidence only. **VERM-10 comments are the authoritative acceptance record**; this report',
      '> is not Kevin\'s acceptance and approves nothing.',
      '',
      '## Build and environment',
      '',
      '| Item | Value |',
      '| --- | --- |',
      `| Build kind | **${b.kind === 'pinned-acceptance' ? 'Pinned acceptance build' : b.kind === 'development' ? 'Development build (not the acceptance build)' : 'Unknown'}** |`,
      `| Source commit | ${b.sourceCommit ?? 'unknown'} (${b.sourceCommitBasis}) |`,
      `| Executable | \`${b.executable}\` |`,
      `| app.asar SHA-256 | \`${b.asarSha256 ?? 'not found'}\` |`,
      `| Harness commit | ${this.identity.harnessCommit ?? 'unknown'}${this.identity.harnessDirty ? ' (with uncommitted changes)' : ''} |`,
      `| OS | ${this.identity.os} (${this.identity.kernel}) |`,
      `| Time zone | ${this.identity.timeZone} (UTC${this.identity.utcOffsetMinutes >= 0 ? '+' : ''}${this.identity.utcOffsetMinutes / 60}) |`,
      `| Launch flags | \`${this.identity.launchFlags.join(' ')}\` |`,
      `| Fake-service variables removed | ${this.identity.fakeServiceEnvRemoved.join(', ') || 'none present'} |`,
      `| Started | ${this.identity.startedAt} |`,
      `| Overall | ${result.status} |`,
      '',
      '## Results',
      '',
      '| ID | Result | Category | Scenario |',
      '| --- | --- | --- | --- |',
      ...this.rows.map((r) => `| ${r.checklistId} | **${r.status}** | ${r.category} | ${r.title.replace(/\|/g, '\\|')} |`),
      '',
    ];
    for (const r of this.rows) {
      lines.push(`### ${r.title}`, '', `- **Result:** ${r.status} — ${r.category}`);
      if (r.blockedReason) lines.push(`- **Blocked because:** ${r.blockedReason}`);
      for (const e of r.expected) lines.push(`- **Expected:** ${e}`);
      for (const p of r.pendingDecision) lines.push(`- **Pending decision (observed, not asserted):** ${p}`);
      if (r.observed && Object.keys(r.observed as object).length) {
        lines.push('- **Observed:**', '', '```json', JSON.stringify(r.observed, null, 2), '```', '');
      }
      if (r.error && r.status !== 'Blocked') lines.push('- **Failure:**', '', '```text', r.error, '```', '');
      if (r.attachments.length) lines.push(`- **Evidence:** ${r.attachments.map((a) => `[${a.name}](${a.path})`).join(', ')}`);
      lines.push('');
    }
    fs.writeFileSync(path.join(this.dir, 'results.md'), lines.join('\n'));
    process.stdout.write(`\nLive acceptance evidence: ${this.dir}\n  results.md, results.json, manifest.json, html/ (npx playwright show-report "${path.join(this.dir, 'html')}")\n`);
  }
}
