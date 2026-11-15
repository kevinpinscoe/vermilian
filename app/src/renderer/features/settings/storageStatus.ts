// What the Settings "Workspace storage" section says about this machine's
// configuration storage (VERM-53). Pure: unit-tested without a DOM.

import type { StorageStatusView } from '../../../shared/storageActivation';
import type { WorkspaceMigrationResult } from '../../../shared/workspaceMigration';

export const STORAGE_STATUS_QUERY_KEY = ['workspace', 'storage-status'] as const;

export interface StorageSummary {
  tone: 'primary' | 'positive' | 'warning' | 'negative';
  title: string;
  text: string;
}

export function storageSummary(v: StorageStatusView): StorageSummary {
  if (!v.guard.allowed) {
    return { tone: 'negative', title: 'Configuration changes are not being saved', text: v.guard.message };
  }
  if (v.mode === 'legacy') {
    return {
      tone: 'primary',
      title: 'Shared configuration (_vermilian-config)',
      text: 'Every workspace is stored in the one shared configuration article. Per-workspace storage has not been activated.',
    };
  }
  const since = v.activatedAt ? ` since ${v.activatedAt.slice(0, 10)}` : '';
  if (v.legacyChangedSinceActivation) {
    return {
      tone: 'warning',
      title: `Per-workspace storage${since}`,
      text:
        'The old shared configuration (_vermilian-config) was changed after activation — probably by an older Vermilian ' +
        '(v1.2.10 or earlier) on another machine. Those changes are not used here. Upgrade that machine and activate it.',
    };
  }
  return {
    tone: 'positive',
    title: `Per-workspace storage${since}`,
    text: 'Each workspace is stored in its own configuration article. _vermilian-config is kept unchanged.',
  };
}

/** One line per workspace for the migration preview. */
export function previewLines(r: WorkspaceMigrationResult): string[] {
  if (!r.ok) return [r.message];
  const verb: Record<string, string> = {
    create: 'will be created',
    unchanged: 'already migrated',
    conflict: 'CONFLICT — an existing article differs',
    ambiguous: 'AMBIGUOUS — more than one article',
    'invalid-remote': 'existing article cannot be read',
    'invalid-source': 'cannot be migrated',
  };
  const lines = r.items.map((i) => `${i.name || i.workspaceId} (${i.backend}): ${verb[i.action] ?? i.action}`);
  const j = r.jiraProfile;
  if (j.status === 'unassigned') lines.push('Jira profile: not migrated (no name given for a new Jira workspace)');
  else if (j.status !== 'none') lines.push(`Jira profile: ${j.status}${'message' in j && j.message ? ` — ${j.message}` : ''}`);
  return lines;
}

/** Whether the preview shows a migration activation can complete. */
export function previewAllowsActivation(r: WorkspaceMigrationResult): boolean {
  if (!r.ok) return false;
  const itemsOk = r.items.every((i) => i.action === 'create' || i.action === 'unchanged');
  return itemsOk && !['invalid', 'ambiguous', 'failed'].includes(r.jiraProfile.status);
}
