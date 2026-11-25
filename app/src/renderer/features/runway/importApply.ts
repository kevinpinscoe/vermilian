// Applying the Markdown import preview (VERM-104): which groups are ready,
// and the plan sent to runwayMarkdownApply. Pure, unit-tested. The main
// process checks everything again (main/services/runwayMarkdownApply.ts).
//
// A group is applied when it is included (not skipped). Apply is offered only
// when every included group:
//   - has a destination: not ambiguous, and a new workspace has a name that
//     no existing workspace or other included group uses (trimmed,
//     case-folded);
//   - is not one of two groups going to the same existing workspace;
//   - goes to an existing workspace only if that workspace's Runway is empty
//     (adding to a Runway is VERM-105);
//   - has been checked successfully on its current connection, nothing
//     pending, waiting or failed.
//
// The plan's rows are the preview's, in preview order: numbered tickets
// (scheduled or ticked) by stored ID with the text they were written as;
// sections (a merged heading too); notes; and each unmatched or duplicate
// scheduled ticket as a note with its text. Untouched References are left
// out. A note deeper than the store's limit is kept at that limit.

import type { RunwayImportApplyArgs, RunwayImportApplyGroup, RunwayImportApplyRow } from '../../../shared/runwayImport';
import { groupPreview, type WorkingGroup } from './importCorrections';
import type { GroupCheck, ImportWorkspaceOption } from './importPreview';

/** The store's deepest indent (runwayItemStore RUNWAY_MAX_DEPTH). */
const MAX_DEPTH = 4;

const fold = (name: string) => name.trim().toLowerCase();

export type ApplyBlocker =
  | 'choose-workspace'
  | 'needs-name'
  | 'name-taken'
  | 'same-destination'
  | 'runway-not-empty'
  | 'runway-unknown'
  | 'waiting'
  | 'checking'
  | 'check-failed';

export const BLOCKER_MESSAGE: Record<ApplyBlocker, string> = {
  'choose-workspace': 'Choose a workspace for this group.',
  'needs-name': 'Name this new workspace.',
  'name-taken': 'This name is already used. Rename it, map it, or merge it.',
  'same-destination': 'Another group also goes to this workspace. Merge them, or skip one.',
  'runway-not-empty': 'This workspace already has a Runway. Adding to it arrives in a later step; skip this group or map it elsewhere.',
  'runway-unknown': 'Checking whether this workspace’s Runway is empty…',
  waiting: 'Choose a workspace to check these tickets.',
  checking: 'Waiting for the tickets to be checked.',
  'check-failed': 'The tickets could not be checked. Retry, or choose another connection.',
};

/** The existing workspace a group goes to, if any. */
export function destinationOf(g: WorkingGroup): string | null {
  return g.target.kind === 'existing' || g.target.kind === 'active' ? g.target.workspaceId : null;
}

/**
 * Why each included group cannot be applied yet. `runwayRows` is the number of
 * rows on each existing destination's Runway (undefined while unknown).
 */
export function applyBlockers(
  groups: readonly WorkingGroup[],
  checks: Readonly<Record<string, GroupCheck | undefined>>,
  workspaces: readonly ImportWorkspaceOption[],
  runwayRows: Readonly<Record<string, number | undefined>>,
): Record<string, ApplyBlocker[]> {
  const included = groups.filter((g) => !g.skipped);
  const destinations = new Map<string, number>();
  for (const g of included) {
    const d = destinationOf(g);
    if (d) destinations.set(d, (destinations.get(d) ?? 0) + 1);
  }
  const names = new Map<string, number>();
  for (const g of included) if (g.target.kind === 'new' && g.name !== null) names.set(fold(g.name), (names.get(fold(g.name)) ?? 0) + 1);

  return Object.fromEntries(
    included.map((g) => {
      const out: ApplyBlocker[] = [];
      const d = destinationOf(g);
      if (g.target.kind === 'ambiguous' || g.target.kind === 'unassigned') out.push('choose-workspace');
      if (g.target.kind === 'new') {
        if (g.name === null) out.push('needs-name');
        else if (workspaces.some((w) => fold(w.name) === fold(g.name as string)) || (names.get(fold(g.name)) ?? 0) > 1) out.push('name-taken');
      }
      if (d && (destinations.get(d) ?? 0) > 1) out.push('same-destination');
      if (d) {
        const rows = runwayRows[d];
        if (rows === undefined) out.push('runway-unknown');
        else if (rows > 0) out.push('runway-not-empty');
      }
      const check = checks[g.groupKey];
      if (g.connectionId === null) out.push('waiting');
      else if (!check || check.state === 'pending') out.push('checking');
      else if (check.state === 'failed' || !check.match.ok || !check.match.connectionKey) out.push('check-failed');
      return [g.groupKey, out];
    }),
  );
}

/** Whether Apply can be offered: at least one included group, and none blocked. */
export function canApply(groups: readonly WorkingGroup[], blockers: Readonly<Record<string, ApplyBlocker[]>>): boolean {
  const included = groups.filter((g) => !g.skipped);
  return included.length > 0 && included.every((g) => (blockers[g.groupKey] ?? []).length === 0);
}

const ticketNote = (text: string, hint: string | null) => (hint ? `${text} ${hint}` : text);

/** The plan for every included group, from its preview; null for a group not ready. */
export function applyPlan(groups: readonly WorkingGroup[], checks: Readonly<Record<string, GroupCheck | undefined>>): RunwayImportApplyArgs | null {
  const out: RunwayImportApplyGroup[] = [];
  for (const g of groups) {
    if (g.skipped) continue;
    const check = checks[g.groupKey];
    if (!check || check.state !== 'done' || !check.match.ok || g.connectionId === null || !check.match.connectionKey) return null;
    const connectionKey = check.match.connectionKey;
    const preview = groupPreview(g, check.match.candidates);
    const rows: RunwayImportApplyRow[] = [];
    for (const r of preview.rows) {
      switch (r.kind) {
        case 'ticket':
          rows.push({ kind: 'ticket', issueId: r.issueId, text: r.text, line: r.line });
          break;
        case 'unmatched':
        case 'duplicate':
          rows.push({ kind: 'note', text: ticketNote(r.text, r.titleHint), depth: 0, line: r.line });
          break;
        case 'unchecked':
          return null;
        case 'section':
          rows.push({ kind: 'section', text: r.text, depth: Math.min(r.depth, MAX_DEPTH), line: r.line });
          break;
        case 'note':
          if (r.text.trim() !== '') rows.push({ kind: 'note', text: r.text, depth: Math.min(r.depth, MAX_DEPTH), line: r.line });
          break;
      }
    }
    const d = destinationOf(g);
    // The connection the preview checked travels with the plan; Apply requires the same one.
    if (d) out.push({ groupKey: g.groupKey, target: { kind: 'existing', workspaceId: d }, connectionKey, rows });
    else if (g.target.kind === 'new' && g.name !== null) out.push({ groupKey: g.groupKey, target: { kind: 'new', name: g.name, connectionWorkspaceId: g.connectionId }, connectionKey, rows });
    else return null;
  }
  return out.length > 0 ? { groups: out } : null;
}

/** A short line for the confirmation after Apply. */
export function appliedSummary(workspaces: readonly { name: string; created: boolean }[]): string {
  const created = workspaces.filter((w) => w.created).map((w) => w.name);
  const filled = workspaces.filter((w) => !w.created).map((w) => w.name);
  const parts = [];
  if (created.length > 0) parts.push(`created ${created.join(', ')}`);
  if (filled.length > 0) parts.push(`filled the Runway of ${filled.join(', ')}`);
  return parts.length > 0 ? `Import applied: ${parts.join('; ')}.` : 'Import applied.';
}

