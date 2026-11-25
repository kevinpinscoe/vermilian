// Applying the Markdown import preview (VERM-104, VERM-105): which groups are
// ready, what each adds, and the plan sent to runwayMarkdownApply. Pure,
// unit-tested. The main process checks everything again
// (main/services/runwayMarkdownApply.ts).
//
// A group is applied when it is included (not skipped). Apply is offered only
// when every included group:
//   - has a destination: not ambiguous, and a new workspace has a name that
//     no existing workspace or other included group uses (trimmed,
//     case-folded);
//   - is not one of two groups going to the same existing workspace;
//   - going to an existing workspace, has its Runway read and the tickets
//     already on it read on that workspace's connection, with no saved
//     ticket leaving a new one's identity uncertain (Unable to verify);
//   - has been checked successfully on its current connection, nothing
//     pending, waiting or failed;
// and at least one included group adds something: a new workspace, or a row
// its existing Runway does not have. Otherwise it is Nothing new to add.
//
// What a group adds is shared/runwayImportAppend.ts: append-only, so every
// row already on the Runway keeps its place and Runway #.
//
// The plan's rows are the preview's, in preview order: numbered tickets
// (scheduled or ticked) by stored ID with the text they were written as;
// sections (a merged heading too); notes; and each unmatched or duplicate
// scheduled ticket as a note with its text. Untouched References are left
// out. A note deeper than the store's limit is kept at that limit. An
// existing destination's plan also carries the rows it was compared with and
// which rows it appends, so Apply can refuse when either has changed.

import type { RunwayImportApplyArgs, RunwayImportApplyGroup, RunwayImportApplyRow } from '../../../shared/runwayImport';
import { planRunwayAppend, type RunwayAppendPlan, type RunwayDestinationRow, type RunwaySavedIdentity } from '../../../shared/runwayImportAppend';
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
  | 'runway-unknown'
  | 'runway-failed'
  | 'identity-checking'
  | 'identity-failed'
  | 'unable-to-verify'
  | 'waiting'
  | 'checking'
  | 'check-failed';

export const BLOCKER_MESSAGE: Record<ApplyBlocker, string> = {
  'choose-workspace': 'Choose a workspace for this group.',
  'needs-name': 'Name this new workspace.',
  'name-taken': 'This name is already used. Rename it, map it, or merge it.',
  'same-destination': 'Another group also goes to this workspace. Merge them, or skip one.',
  'runway-unknown': 'Reading this workspace’s Runway…',
  'runway-failed': 'This workspace’s Runway could not be read.',
  'identity-checking': 'Checking the tickets already on this Runway…',
  'identity-failed': 'The tickets already on this Runway could not be checked. Retry, or check this workspace’s connection.',
  'unable-to-verify': 'Unable to verify: some tickets already on this Runway could not be read, so a new ticket might be one of them. Nothing can be added until they can be read.',
  waiting: 'Choose a workspace to check these tickets.',
  checking: 'Waiting for the tickets to be checked.',
  'check-failed': 'The tickets could not be checked. Retry, or choose another connection.',
};

/** The existing workspace a group goes to, if any. */
export function destinationOf(g: WorkingGroup): string | null {
  return g.target.kind === 'existing' || g.target.kind === 'active' ? g.target.workspaceId : null;
}

/** An existing destination as the preview knows it: its rows, then its saved tickets' identities. */
export type DestinationView =
  | { state: 'loading' }
  | { state: 'failed'; error: string }
  | {
      state: 'ready';
      rows: RunwayDestinationRow[];
      identity:
        | { state: 'loading' }
        | { state: 'failed'; error: string }
        | { state: 'ready'; connectionKey: string; items: Record<string, RunwaySavedIdentity> };
    };

/** The plan's rows for a group, each with the index of the preview row it came from; null when not ready. */
export function planRows(g: WorkingGroup, check: GroupCheck | undefined): { rows: RunwayImportApplyRow[]; aliases: (string[] | undefined)[]; previewIndex: number[] } | null {
  if (!check || check.state !== 'done' || !check.match.ok) return null;
  const preview = groupPreview(g, check.match.candidates);
  const aliasOf = new Map<string, string[]>();
  for (const c of check.match.candidates) if (c.status === 'matched' && c.ticket.aliases) aliasOf.set(c.ticket.issueId, c.ticket.aliases);
  const rows: RunwayImportApplyRow[] = [];
  const aliases: (string[] | undefined)[] = [];
  const previewIndex: number[] = [];
  const push = (r: RunwayImportApplyRow, i: number) => {
    rows.push(r);
    aliases.push(r.kind === 'ticket' ? aliasOf.get(r.issueId) : undefined);
    previewIndex.push(i);
  };
  for (const [i, r] of preview.rows.entries()) {
    switch (r.kind) {
      case 'ticket':
        push({ kind: 'ticket', issueId: r.issueId, text: r.text, line: r.line }, i);
        break;
      case 'unmatched':
      case 'duplicate':
        push({ kind: 'note', text: ticketNote(r.text, r.titleHint), depth: 0, line: r.line }, i);
        break;
      case 'unchecked':
        return null;
      case 'section':
        push({ kind: 'section', text: r.text, depth: Math.min(r.depth, MAX_DEPTH), line: r.line }, i);
        break;
      case 'note':
        if (r.text.trim() !== '') push({ kind: 'note', text: r.text, depth: Math.min(r.depth, MAX_DEPTH), line: r.line }, i);
        break;
    }
  }
  return { rows, aliases, previewIndex };
}

/** What a group adds: its plan rows and the append plan against its destination; null until that can be known. */
export function groupAppend(
  g: WorkingGroup,
  check: GroupCheck | undefined,
  destinations: Readonly<Record<string, DestinationView | undefined>>,
): { rows: RunwayImportApplyRow[]; previewIndex: number[]; plan: RunwayAppendPlan; destination: RunwayDestinationRow[] | null } | null {
  const built = planRows(g, check);
  if (!built) return null;
  const d = destinationOf(g);
  if (!d) return { ...built, plan: planRunwayAppend(built.rows, built.aliases, [], {}), destination: null };
  const view = destinations[d];
  if (view?.state !== 'ready' || view.identity.state !== 'ready') return null;
  return { ...built, plan: planRunwayAppend(built.rows, built.aliases, view.rows, view.identity.items), destination: view.rows };
}

/**
 * Why each included group cannot be applied yet. `destinations` holds each
 * existing destination's rows and saved-ticket identities as read so far.
 */
export function applyBlockers(
  groups: readonly WorkingGroup[],
  checks: Readonly<Record<string, GroupCheck | undefined>>,
  workspaces: readonly ImportWorkspaceOption[],
  destinations: Readonly<Record<string, DestinationView | undefined>>,
): Record<string, ApplyBlocker[]> {
  const included = groups.filter((g) => !g.skipped);
  const shared = new Map<string, number>();
  for (const g of included) {
    const d = destinationOf(g);
    if (d) shared.set(d, (shared.get(d) ?? 0) + 1);
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
      if (d && (shared.get(d) ?? 0) > 1) out.push('same-destination');
      const check = checks[g.groupKey];
      if (d) {
        const view = destinations[d];
        if (!view || view.state === 'loading') out.push('runway-unknown');
        else if (view.state === 'failed') out.push('runway-failed');
        else if (view.identity.state === 'loading') out.push('identity-checking');
        else if (view.identity.state === 'failed') out.push('identity-failed');
        // Read on another connection than the preview's (it is read again): not yet comparable.
        else if (check?.state === 'done' && check.match.ok && view.identity.connectionKey !== check.match.connectionKey) out.push('identity-checking');
        else if (groupAppend(g, check, destinations)?.plan.unableToVerify) out.push('unable-to-verify');
      }
      if (g.connectionId === null) out.push('waiting');
      else if (!check || check.state === 'pending') out.push('checking');
      else if (check.state === 'failed' || !check.match.ok || !check.match.connectionKey) out.push('check-failed');
      return [g.groupKey, out];
    }),
  );
}

/** Whether a ready group adds nothing: an existing destination that already has every row. */
export function addsNothing(g: WorkingGroup, check: GroupCheck | undefined, destinations: Readonly<Record<string, DestinationView | undefined>>): boolean {
  if (!destinationOf(g)) return false;
  const a = groupAppend(g, check, destinations);
  return a !== null && a.plan.append.length === 0;
}

/**
 * Whether Apply can be offered: at least one included group, none blocked,
 * and at least one that adds something (otherwise it is Nothing new to add).
 */
export function canApply(
  groups: readonly WorkingGroup[],
  blockers: Readonly<Record<string, ApplyBlocker[]>>,
  checks: Readonly<Record<string, GroupCheck | undefined>> = {},
  destinations: Readonly<Record<string, DestinationView | undefined>> = {},
): boolean {
  const included = groups.filter((g) => !g.skipped);
  if (included.length === 0 || !included.every((g) => (blockers[g.groupKey] ?? []).length === 0)) return false;
  return included.some((g) => !addsNothing(g, checks[g.groupKey], destinations));
}

const ticketNote = (text: string, hint: string | null) => (hint ? `${text} ${hint}` : text);

/** The plan for every included group, from its preview; null for a group not ready. */
export function applyPlan(
  groups: readonly WorkingGroup[],
  checks: Readonly<Record<string, GroupCheck | undefined>>,
  destinations: Readonly<Record<string, DestinationView | undefined>> = {},
): RunwayImportApplyArgs | null {
  const out: RunwayImportApplyGroup[] = [];
  for (const g of groups) {
    if (g.skipped) continue;
    const check = checks[g.groupKey];
    if (!check || check.state !== 'done' || !check.match.ok || g.connectionId === null || !check.match.connectionKey) return null;
    // The connection the preview checked travels with the plan; Apply requires the same one.
    const connectionKey = check.match.connectionKey;
    const d = destinationOf(g);
    if (d) {
      const a = groupAppend(g, check, destinations);
      if (!a || !a.destination) return null;
      out.push({ groupKey: g.groupKey, target: { kind: 'existing', workspaceId: d }, connectionKey, rows: a.rows, destination: { rows: a.destination, append: a.plan.append } });
    } else if (g.target.kind === 'new' && g.name !== null) {
      const built = planRows(g, check);
      if (!built) return null;
      out.push({ groupKey: g.groupKey, target: { kind: 'new', name: g.name, connectionWorkspaceId: g.connectionId }, connectionKey, rows: built.rows });
    } else return null;
  }
  return out.length > 0 ? { groups: out } : null;
}

/** A short line for the confirmation after Apply. */
export function appliedSummary(workspaces: readonly { name: string; created: boolean }[]): string {
  const created = workspaces.filter((w) => w.created).map((w) => w.name);
  const filled = workspaces.filter((w) => !w.created).map((w) => w.name);
  const parts = [];
  if (created.length > 0) parts.push(`created ${created.join(', ')}`);
  if (filled.length > 0) parts.push(`added to the Runway of ${filled.join(', ')}`);
  return parts.length > 0 ? `Import applied: ${parts.join('; ')}.` : 'Import applied.';
}

