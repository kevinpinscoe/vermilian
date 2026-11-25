// Applying the Markdown import preview (VERM-104): the main-process side of
// runwayMarkdownApply. Electron-free, so the rules run under vitest; main/ipc.ts
// registers it and supplies the dependencies for the storage mode in use.
//
// The renderer sends the plan it shows. In order:
//   1. The plan is checked field by field.
//   2. Every numbered ticket is read again, on the connection the group was
//      previewed on (the existing destination's own, or the chosen workspace
//      for a new one), through the same matcher as the preview (VERM-101). A
//      ticket that no longer reads as the same ticket, or a connection that is
//      gone, sends the group back to the preview. Nothing is written.
//   3. Under the Runway write gate: destinations are checked — an existing
//      workspace must still exist and have an empty Runway, two groups may not
//      share one, and a new workspace's name (trimmed, case-folded, as in the
//      preview) may not match an existing workspace or another new group. Any
//      problem sends the group back; nothing is written.
//   4. The Runway database is backed up (verified). If that fails, nothing
//      changes.
//   5. The new workspaces are created, each copying only its connection
//      workspace's tracker connection and credential reference. If one fails,
//      the ones this Apply created are removed and no rows are written.
//   6. Every destination's rows are written in one transaction, which checks
//      again that each destination is empty. If it is not — another edit
//      filled it — that edit is kept, nothing is written, and the group goes
//      back for correction. On any failure here, the workspaces this Apply
//      created are removed.
// Cleanup removes only the workspaces this attempt created, by ID. When some
// cannot be removed, the result names them with the backup path.

import {
  RUNWAY_IMPORT_MAX_APPLY_ROWS,
  RUNWAY_IMPORT_MAX_GROUPS,
  RUNWAY_IMPORT_MAX_TEXT,
  type RunwayImportApplyArgs,
  type RunwayImportApplyGroup,
  type RunwayImportApplyProblem,
  type RunwayImportApplyResult,
  type RunwayImportApplyRow,
  type RunwayImportMatchArgs,
  type RunwayImportMatchResult,
} from '../../shared/runwayImport';
import { RUNWAY_MAX_DEPTH, RunwayItemStoreError, type RunwayFill, type RunwayItemStore } from './runwayItemStore';

export interface ApplyWorkspace {
  id: string;
  name: string;
}

/** The workspace configuration, for the storage mode in use. */
export interface ApplyWorkspaceStore {
  list(): Promise<ApplyWorkspace[]>;
  /** Creates a workspace copying `connectionWorkspaceId`'s tracker connection and credential reference. */
  create(name: string, connectionWorkspaceId: string): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string }>;
  /** Removes a workspace this Apply created. */
  remove(workspaceId: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface RunwayMarkdownApplyDeps {
  workspaces: ApplyWorkspaceStore;
  /** The preview's matcher (createRunwayImportMatch), read-only. */
  match: (args: RunwayImportMatchArgs) => Promise<RunwayImportMatchResult>;
  gate: { run<T>(operation: () => T | Promise<T>): Promise<T> };
  store: () => Pick<RunwayItemStore, 'list' | 'fillEmpty'>;
  /** Writes a verified backup of the Runway database and returns its path. */
  backup: () => Promise<string>;
}

const fold = (name: string) => name.trim().toLowerCase();
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const messageOf = (err: unknown, fallback: string) => {
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : fallback;
};

/** The plan, checked field by field; a string says why it was refused. */
export function validateApplyArgs(args: unknown): RunwayImportApplyArgs | string {
  if (!isRecord(args) || !Array.isArray(args.groups)) return 'Import apply arguments are missing';
  if (args.groups.length === 0) return 'Nothing to apply';
  if (args.groups.length > RUNWAY_IMPORT_MAX_GROUPS) return `At most ${RUNWAY_IMPORT_MAX_GROUPS} groups can be applied at once`;
  const keys = new Set<string>();
  let total = 0;
  const groups: RunwayImportApplyGroup[] = [];
  for (const g of args.groups) {
    if (!isRecord(g) || typeof g.groupKey !== 'string' || g.groupKey === '' || g.groupKey.length > 200) return 'Each group needs a groupKey';
    if (keys.has(g.groupKey)) return 'Each group must appear once';
    keys.add(g.groupKey);
    const t = g.target;
    if (!isRecord(t)) return 'Each group needs a target';
    let target: RunwayImportApplyGroup['target'];
    if (t.kind === 'existing' && typeof t.workspaceId === 'string' && t.workspaceId !== '') target = { kind: 'existing', workspaceId: t.workspaceId };
    else if (t.kind === 'new' && typeof t.name === 'string' && typeof t.connectionWorkspaceId === 'string' && t.connectionWorkspaceId !== '') {
      const name = t.name.trim();
      if (name === '' || name.length > 200) return 'A new workspace needs a name of 1 to 200 characters';
      target = { kind: 'new', name, connectionWorkspaceId: t.connectionWorkspaceId };
    } else return 'Each group needs an existing workspace or a new workspace with a name and a connection';
    if (!Array.isArray(g.rows)) return 'Each group needs its rows';
    total += g.rows.length;
    if (total > RUNWAY_IMPORT_MAX_APPLY_ROWS) return `At most ${RUNWAY_IMPORT_MAX_APPLY_ROWS} rows can be applied at once`;
    const rows: RunwayImportApplyRow[] = [];
    for (const r of g.rows) {
      if (!isRecord(r) || typeof r.text !== 'string' || r.text.length > RUNWAY_IMPORT_MAX_TEXT * 8) return 'Each row needs its text';
      if (!Number.isInteger(r.line) || (r.line as number) < 1) return 'Each row needs its line';
      const line = r.line as number;
      if (r.kind === 'ticket') {
        if (typeof r.issueId !== 'string' || r.issueId === '' || r.text.trim() === '') return 'Each ticket row needs its ID and the text it was written as';
        rows.push({ kind: 'ticket', issueId: r.issueId, text: r.text, line });
      } else if (r.kind === 'section' || r.kind === 'note') {
        if (r.text.trim() === '' || !Number.isInteger(r.depth) || (r.depth as number) < 0 || (r.depth as number) > RUNWAY_MAX_DEPTH) {
          return `Each section and note needs text and a depth of 0 to ${RUNWAY_MAX_DEPTH}`;
        }
        rows.push({ kind: r.kind, text: r.text, depth: r.depth as number, line });
      } else return 'Each row must be a ticket, a section or a note';
    }
    groups.push({ groupKey: g.groupKey, target, rows });
  }
  return { groups };
}

const connectionOf = (g: RunwayImportApplyGroup) => (g.target.kind === 'existing' ? g.target.workspaceId : g.target.connectionWorkspaceId);

const problem = (groupKey: string, reason: RunwayImportApplyProblem['reason'], message: string): RunwayImportApplyProblem => ({ groupKey, reason, message });

function refused(
  code: Exclude<RunwayImportApplyResult, { ok: true }>['code'],
  error: string,
  extra: { problems?: RunwayImportApplyProblem[]; backupPath?: string | null; remaining?: { workspaceId: string; name: string }[] } = {},
): RunwayImportApplyResult {
  return { ok: false, code, error, problems: extra.problems ?? [], backupPath: extra.backupPath ?? null, remaining: extra.remaining ?? [] };
}

/** Step 2: each numbered ticket read again on its group's connection, through the preview's matcher. */
async function verifyTickets(deps: RunwayMarkdownApplyDeps, groups: readonly RunwayImportApplyGroup[], known: ReadonlySet<string>): Promise<RunwayImportApplyProblem[]> {
  const problems: RunwayImportApplyProblem[] = [];
  for (const g of groups) {
    const conn = connectionOf(g);
    if (!known.has(conn)) {
      problems.push(
        g.target.kind === 'existing'
          ? problem(g.groupKey, 'workspace-missing', 'This workspace no longer exists. Choose another destination.')
          : problem(g.groupKey, 'connection-missing', 'The workspace whose connection checked these tickets no longer exists. Choose another in Check tickets using.'),
      );
      continue;
    }
    const tickets = g.rows.filter((r): r is Extract<RunwayImportApplyRow, { kind: 'ticket' }> => r.kind === 'ticket');
    if (tickets.length === 0) continue;
    let result: RunwayImportMatchResult;
    try {
      result = await deps.match({
        groups: [{ groupKey: g.groupKey, workspaceId: conn, candidates: tickets.map((t, i) => ({ text: t.text, line: i + 1, role: 'scheduled', reason: null })) }],
      });
    } catch (err) {
      problems.push(problem(g.groupKey, 'check-failed', `The tickets could not be checked again: ${messageOf(err, 'no answer')}.`));
      continue;
    }
    const answer = result.ok ? result.groups[0] : undefined;
    if (!result.ok || !answer || !answer.ok) {
      const why = !result.ok ? result.error : answer && !answer.ok ? answer.error : 'no answer';
      problems.push(problem(g.groupKey, 'check-failed', `The tickets could not be checked again: ${why}`));
      continue;
    }
    const changed = tickets.filter((t, i) => {
      const r = answer.candidates[i];
      return !r || r.status !== 'matched' || r.ticket.issueId !== t.issueId;
    });
    if (changed.length > 0) {
      problems.push(
        problem(
          g.groupKey,
          'tickets-changed',
          `${changed.map((t) => t.text).join(', ')} no longer ${changed.length === 1 ? 'reads' : 'read'} as previewed on this connection. The preview has been checked again; review the order, then Apply.`,
        ),
      );
    }
  }
  return problems;
}

/** Step 3: destinations, under the write gate. */
function checkDestinations(groups: readonly RunwayImportApplyGroup[], workspaces: readonly ApplyWorkspace[], store: Pick<RunwayItemStore, 'list'>): RunwayImportApplyProblem[] {
  const problems: RunwayImportApplyProblem[] = [];
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const destinations = new Map<string, string[]>();
  for (const g of groups) {
    if (g.target.kind !== 'existing') continue;
    destinations.set(g.target.workspaceId, [...(destinations.get(g.target.workspaceId) ?? []), g.groupKey]);
  }
  const newNames = new Map<string, string[]>();
  for (const g of groups) {
    if (g.target.kind === 'new') newNames.set(fold(g.target.name), [...(newNames.get(fold(g.target.name)) ?? []), g.groupKey]);
  }
  for (const g of groups) {
    if (g.target.kind === 'existing') {
      const w = byId.get(g.target.workspaceId);
      if (!w) {
        problems.push(problem(g.groupKey, 'workspace-missing', 'This workspace no longer exists. Choose another destination.'));
        continue;
      }
      if ((destinations.get(w.id)?.length ?? 0) > 1) {
        problems.push(problem(g.groupKey, 'same-destination', `Another group also goes to ${w.name.trim()}. Merge them, or skip one.`));
        continue;
      }
      if (store.list(w.id).length > 0) {
        problems.push(problem(g.groupKey, 'runway-not-empty', `${w.name.trim()}’s Runway already has rows. Adding to a Runway arrives in a later step; skip this group or map it elsewhere.`));
      }
    } else {
      const wanted = fold(g.target.name);
      const taken = workspaces.find((w) => fold(w.name) === wanted);
      if (taken) problems.push(problem(g.groupKey, 'name-taken', `A workspace called ${taken.name.trim()} already exists. Rename this one, or map it to that workspace.`));
      else if ((newNames.get(wanted)?.length ?? 0) > 1) problems.push(problem(g.groupKey, 'name-taken', `Another new workspace is also called ${g.target.name}. Rename one, or merge them.`));
    }
  }
  return problems;
}

/** Removes the workspaces this Apply created; returns the ones that remain. */
async function cleanup(deps: RunwayMarkdownApplyDeps, created: readonly { workspaceId: string; name: string }[]) {
  const remaining: { workspaceId: string; name: string }[] = [];
  for (const c of created) {
    try {
      const r = await deps.workspaces.remove(c.workspaceId);
      if (!r.ok) remaining.push(c);
    } catch {
      remaining.push(c);
    }
  }
  return remaining;
}

export function createRunwayMarkdownApply(deps: RunwayMarkdownApplyDeps) {
  return async function apply(args: unknown): Promise<RunwayImportApplyResult> {
    const plan = validateApplyArgs(args);
    if (typeof plan === 'string') return refused('invalid-args', plan);

    let before: ApplyWorkspace[];
    try {
      before = await deps.workspaces.list();
    } catch (err) {
      return refused('workspace-unavailable', `The workspace configuration could not be read: ${messageOf(err, 'unknown error')}`);
    }

    // 2. The tickets as previewed, on each group's own connection.
    const verify = await verifyTickets(deps, plan.groups, new Set(before.map((w) => w.id)));
    if (verify.length > 0) return refused('review', 'Some groups changed since the preview. Nothing was written.', { problems: verify });

    return deps.gate.run(async (): Promise<RunwayImportApplyResult> => {
      let workspaces: ApplyWorkspace[];
      try {
        workspaces = await deps.workspaces.list();
      } catch (err) {
        return refused('workspace-unavailable', `The workspace configuration could not be read: ${messageOf(err, 'unknown error')}`);
      }
      const store = deps.store();

      // 3. Destinations.
      const destinations = checkDestinations(plan.groups, workspaces, store);
      if (destinations.length > 0) return refused('review', 'Some groups need correcting. Nothing was written.', { problems: destinations });

      // 4. The backup.
      let backupPath: string;
      try {
        backupPath = await deps.backup();
      } catch (err) {
        return refused('backup-failed', `The Runway database could not be backed up, so nothing was changed: ${messageOf(err, 'unknown error')}`);
      }

      // 5. The new workspaces.
      const created: { groupKey: string; workspaceId: string; name: string }[] = [];
      for (const g of plan.groups) {
        if (g.target.kind !== 'new') continue;
        let r: Awaited<ReturnType<ApplyWorkspaceStore['create']>>;
        try {
          r = await deps.workspaces.create(g.target.name, g.target.connectionWorkspaceId);
        } catch (err) {
          r = { ok: false, error: messageOf(err, 'unknown error') };
        }
        if (!r.ok) {
          const remaining = await cleanup(deps, created);
          return refused('create-failed', `The workspace ${g.target.name} could not be created, so no rows were written: ${r.error}`, { backupPath, remaining });
        }
        created.push({ groupKey: g.groupKey, workspaceId: r.workspaceId, name: g.target.name });
      }

      // 6. All the rows, in one transaction that checks each destination is still empty.
      const idOf = (g: RunwayImportApplyGroup) => (g.target.kind === 'existing' ? g.target.workspaceId : (created.find((c) => c.groupKey === g.groupKey)?.workspaceId as string));
      const fills: RunwayFill[] = plan.groups.map((g) => ({
        workspaceId: idOf(g),
        rows: g.rows.map((r) => (r.kind === 'ticket' ? { kind: 'issue' as const, issueId: r.issueId } : { kind: r.kind, text: r.text, depth: r.depth })),
      }));
      try {
        store.fillEmpty(fills);
      } catch (err) {
        const remaining = await cleanup(deps, created);
        if (err instanceof RunwayItemStoreError && err.code === 'runway-not-empty') {
          const problems = plan.groups
            .filter((g) => g.target.kind === 'existing' && err.workspaceIds.includes(g.target.workspaceId))
            .map((g) => {
              const name = workspaces.find((w) => w.id === idOf(g))?.name.trim() ?? idOf(g);
              return problem(g.groupKey, 'runway-not-empty', `${name}’s Runway gained rows just now; they were kept. Skip this group or map it elsewhere.`);
            });
          return refused('review', 'A destination Runway changed. Nothing was written.', { problems, backupPath, remaining });
        }
        return refused('write-failed', `The Runway rows could not be written, so none were: ${messageOf(err, 'unknown error')}`, { backupPath, remaining });
      }

      return {
        ok: true,
        backupPath,
        workspaces: plan.groups.map((g) => {
          const made = created.find((c) => c.groupKey === g.groupKey);
          const id = idOf(g);
          return {
            groupKey: g.groupKey,
            workspaceId: id,
            name: made ? made.name : (workspaces.find((w) => w.id === id)?.name ?? id),
            created: Boolean(made),
            rows: g.rows.length,
          };
        }),
      };
    });
  };
}
