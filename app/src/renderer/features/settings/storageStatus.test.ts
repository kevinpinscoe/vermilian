import { describe, expect, it } from 'vitest';
import type { StorageStatusView } from '../../../shared/storageActivation';
import { previewAllowsActivation, previewLines, storageSummary } from './storageStatus';

const base: StorageStatusView = {
  mode: 'legacy',
  generation: null,
  localCorrupt: false,
  backupFile: null,
  marker: 'none',
  markerGeneration: null,
  activatedAt: null,
  guard: { allowed: true, reason: 'ok', message: '' },
  legacyChangedSinceActivation: null,
};

describe('storageSummary', () => {
  it('a blocked guard wins, with its own message', () => {
    const s = storageSummary({ ...base, guard: { allowed: false, reason: 'activated-elsewhere', message: 'Activated on another machine.' } });
    expect(s).toEqual({ tone: 'negative', title: 'Configuration changes are not being saved', text: 'Activated on another machine.' });
  });
  it('legacy, per-workspace, and per-workspace with older-client activity', () => {
    expect(storageSummary(base).tone).toBe('primary');
    const pw = { ...base, mode: 'per-workspace' as const, marker: 'active' as const, activatedAt: '2026-11-15T12:00:00.000Z', legacyChangedSinceActivation: false };
    expect(storageSummary(pw)).toMatchObject({ tone: 'positive', title: 'Per-workspace storage since 2026-11-15' });
    expect(storageSummary({ ...pw, legacyChangedSinceActivation: true }).text).toMatch(/older Vermilian/);
  });
});

describe('preview', () => {
  const report = (actions: string[], jira = 'none') =>
    ({
      ok: true, mode: 'plan', complete: false, notMigrated: { boards: [], dismissals: [] }, configArticleId: 'a', masterPlanArticleId: null,
      jiraProfile: { status: jira, articleId: 'j', message: '' },
      items: actions.map((action, n) => ({ workspaceId: `w${n}`, name: `Workspace ${n}`, backend: 'youtrack', action, message: '' })),
    }) as never;
  it('allows activation only when every workspace can be created or is already migrated', () => {
    expect(previewAllowsActivation(report(['create', 'unchanged']))).toBe(true);
    expect(previewAllowsActivation(report(['create', 'conflict']))).toBe(false);
    expect(previewAllowsActivation(report(['create'], 'ambiguous'))).toBe(false);
    expect(previewAllowsActivation({ ok: false, reason: 'source-missing', message: 'none' })).toBe(false);
  });
  it('names each workspace and its outcome', () => {
    expect(previewLines(report(['create', 'conflict'], 'unassigned'))).toEqual([
      'Workspace 0 (youtrack): will be created',
      'Workspace 1 (youtrack): CONFLICT — an existing article differs',
      'Jira profile: not migrated (no name given for a new Jira workspace)',
    ]);
  });
});
