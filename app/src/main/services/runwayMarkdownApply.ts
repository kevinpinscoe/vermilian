// Applying the Markdown import preview (VERM-104): the main-process side of
// runwayMarkdownApply. Electron-free, so the rules run under vitest; main/ipc.ts
// registers it and supplies the dependencies for the storage mode in use.
//
// The renderer sends the plan it shows. In order:
//   1. The plan is checked field by field.
//   2. The group's connection must be the one the preview checked: the
//      workspace supplying it (the existing destination, or the chosen one for
//      a new workspace) must still have the same tracker, server or site,
//      email and credential reference (its connectionKey). Every numbered
//      ticket is then read again on it, through the same matcher as the
//      preview (VERM-101), and the read must report the same connection. A
//      changed connection, a ticket that no longer reads as the same ticket,
//      or a connection that is gone, sends the group back to the preview.
//      Nothing is written. Two Jira sites can both have OPS-7, so a matching
//      stored ID alone proves nothing.
//      For an existing destination, the tickets already on its Runway are
//      read on that same connection too (identify), each answering with every
//      ID it goes by, and the read must report the same connection (VERM-105).
//   3. Under the Runway write gate: each group's connection is compared
//      again, and destinations are checked — an existing workspace must still
//      exist, two groups may not share one, and a new workspace's name
//      (trimmed, case-folded, as in the preview) may not match an existing
//      workspace or another new group. An existing destination's rows must be
//      exactly the ones the preview compared (ID, kind, stored text and depth,
//      in order); what to append is then worked out again
//      (shared/runwayImportAppend.ts) and must be what the preview showed, and
//      no saved ticket may leave a new one's identity uncertain. When every
//      group would add nothing, Apply is refused before the backup. Any
//      problem sends the group back; nothing is written.
//   4. The Runway database is backed up (verified). If that fails, nothing
//      changes.
//   5. The new workspaces are created, each copying only its connection
//      workspace's tracker connection and credential reference — and only if
//      that connection is still the one checked (create is given its key). If
//      one fails, the ones this Apply created are removed (including one whose
//      ID was allocated before it failed) and no rows are written.
//   6. Every destination's new rows are appended in one transaction, which
//      first checks again that each destination's rows are still the ones
//      compared — a new workspace's still none. If any is not, that edit is
//      kept, nothing is written, and the group goes back to the preview. No
//      existing row moves, so no Runway # changes. On any failure here, the
//      workspaces this Apply created are removed.
// Cleanup removes only the workspaces this attempt created, by ID. When some
// cannot be removed, the result names them with the backup path.

import {
  RUNWAY_IMPORT_MAX_APPLY_ROWS,
  RUNWAY_IMPORT_MAX_COMPARED_ROWS,
  RUNWAY_IMPORT_MAX_GROUPS,
  RUNWAY_IMPORT_MAX_TEXT,
  type RunwayImportApplyArgs,
  type RunwayImportApplyGroup,
  type RunwayImportApplyProblem,
  type RunwayImportApplyRemaining,
  type RunwayImportApplyResult,
  type RunwayImportApplyRow,
  type RunwayImportIdentifyArgs,
  type RunwayImportIdentifyResult,
  type RunwayImportMatchArgs,
  type RunwayImportMatchResult,
} from '../../shared/runwayImport';
import { destinationRows, planRunwayAppend, sameDestinationRows, type RunwayDestinationRow, type RunwaySavedIdentity } from '../../shared/runwayImportAppend';
import { RUNWAY_MAX_DEPTH, RunwayItemStoreError, type RunwayAppend, type RunwayItemStore } from './runwayItemStore';

export interface ApplyWorkspace {
  id: string;
  name: string;
}

/** The workspace configuration, for the storage mode in use. */
export interface ApplyWorkspaceStore {
  list(): Promise<ApplyWorkspace[]>;
  /**
   * Creates a workspace copying `connectionWorkspaceId`'s tracker connection
   * and credential reference, refusing when that connection's key is no
   * longer `expectedKey`. A failure that had already allocated the new
   * workspace's ID returns it, with any article it is known to have written
   * (per-workspace storage), so it can be cleaned up exactly.
   */
  create(
    name: string,
    connectionWorkspaceId: string,
    expectedKey: string,
  ): Promise<{ ok: true; workspaceId: string; articleIds?: string[] } | { ok: false; error: string; workspaceId?: string; articleIds?: string[] }>;
  /**
   * Removes a workspace this Apply created, including exactly the articles
   * given; a failure names the articles it could not confirm removed.
   */
  remove(workspaceId: string, articleIds: string[]): Promise<{ ok: true } | { ok: false; error: string; articleIds?: string[]; inspectArticleIds?: string[] }>;
}

export interface RunwayMarkdownApplyDeps {
  workspaces: ApplyWorkspaceStore;
  /** The preview's matcher (createRunwayImportMatch, given connectionKey), read-only. */
  match: (args: RunwayImportMatchArgs) => Promise<RunwayImportMatchResult>;
  /** A workspace's tracker connection as a key (trackerConnectionKey); null when it is gone. */
  connectionKey: (workspaceId: string) => Promise<string | null>;
  /** The destination's saved tickets read on its own connection (createRunwayImportIdentify), read-only. */
  identify: (args: RunwayImportIdentifyArgs) => Promise<RunwayImportIdentifyResult>;
  /** e2e only: runs before the tickets are verified. */
  beforeVerify?: () => Promise<void>;
  gate: { run<T>(operation: () => T | Promise<T>): Promise<T> };
  store: () => Pick<RunwayItemStore, 'list' | 'appendImport'>;
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
  // Imported rows and the rows they are compared with are counted apart, so the order of the groups never matters.
  let total = 0;
  let compared = 0;
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
    if (typeof g.connectionKey !== 'string' || g.connectionKey === '') return 'Each group needs the connection it was checked on';
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
    let destination: RunwayImportApplyGroup['destination'];
    if (target.kind === 'existing') {
      const d = g.destination;
      if (!isRecord(d) || !Array.isArray(d.rows) || !Array.isArray(d.append)) return 'An existing destination needs the rows the preview compared and what it appends';
      compared += d.rows.length;
      if (compared > RUNWAY_IMPORT_MAX_COMPARED_ROWS) return `At most ${RUNWAY_IMPORT_MAX_COMPARED_ROWS} existing Runway rows can be compared at once`;
      const saved: RunwayDestinationRow[] = [];
      for (const r of d.rows) {
        if (!isRecord(r) || typeof r.itemId !== 'string' || r.itemId === '' || (r.kind !== 'issue' && r.kind !== 'section' && r.kind !== 'note')) return 'Each compared row needs its ID and kind';
        if (!(r.text === null || typeof r.text === 'string') || !Number.isInteger(r.depth)) return 'Each compared row needs its text and depth';
        saved.push({ itemId: r.itemId, kind: r.kind, text: r.text as string | null, depth: r.depth as number });
      }
      const append = d.append as unknown[];
      if (!append.every((i, n) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < rows.length && (n === 0 || (i as number) > (append[n - 1] as number)))) {
        return 'What the preview appends must be rows of the group, in order';
      }
      destination = { rows: saved, append: append as number[] };
    } else if (g.destination !== undefined) return 'A new workspace has no destination rows to compare';
    groups.push({ groupKey: g.groupKey, target, connectionKey: g.connectionKey, rows, ...(destination ? { destination } : {}) });
  }
  return { groups };
}

const NOTHING_NEW = 'Nothing new to add: every ticket, section and note in this import is already on its Runway.';
const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const connectionOf = (g: RunwayImportApplyGroup) => (g.target.kind === 'existing' ? g.target.workspaceId : g.target.connectionWorkspaceId);

const problem = (groupKey: string, reason: RunwayImportApplyProblem['reason'], message: string): RunwayImportApplyProblem => ({ groupKey, reason, message });

const CONNECTION_CHANGED =
  'The tracker connection that checked these tickets has changed since the preview (its site, server, email or credential). The preview has been checked again; review it, then Apply.';

/**
 * A workspace's tracker connection as a comparable key: tracker, server or
 * site, email and credential reference. Two workspaces with the same key
 * read tickets the same way.
 */
export function trackerConnectionKey(backend: { kind: string; serverUrl?: string; siteUrl?: string; email?: string; credentialRef?: string | null }): string {
  const url = (backend.kind === 'jira' ? backend.siteUrl : backend.serverUrl) ?? '';
  return JSON.stringify([backend.kind, url.trim().replace(/\/+$/, '').toLowerCase(), (backend.email ?? '').trim().toLowerCase(), backend.credentialRef ?? null]);
}

/** Each group's connection compared with the one previewed. */
async function checkConnections(deps: RunwayMarkdownApplyDeps, groups: readonly RunwayImportApplyGroup[]): Promise<RunwayImportApplyProblem[]> {
  const problems: RunwayImportApplyProblem[] = [];
  for (const g of groups) {
    const now = await deps.connectionKey(connectionOf(g));
    if (now === null) {
      problems.push(
        g.target.kind === 'existing'
          ? problem(g.groupKey, 'workspace-missing', 'This workspace no longer exists. Choose another destination.')
          : problem(g.groupKey, 'connection-missing', 'The workspace whose connection checked these tickets no longer exists. Choose another in Check tickets using.'),
      );
    } else if (now !== g.connectionKey) {
      problems.push(problem(g.groupKey, 'connection-changed', CONNECTION_CHANGED));
    }
  }
  return problems;
}

function refused(
  code: Exclude<RunwayImportApplyResult, { ok: true }>['code'],
  error: string,
  extra: { problems?: RunwayImportApplyProblem[]; backupPath?: string | null; remaining?: RunwayImportApplyRemaining[] } = {},
): RunwayImportApplyResult {
  return { ok: false, code, error, problems: extra.problems ?? [], backupPath: extra.backupPath ?? null, remaining: extra.remaining ?? [] };
}

/** Step 2: each numbered ticket read again on its group's connection, through the preview's matcher. */
type Aliases = Map<string, (string[] | undefined)[]>;

async function verifyTickets(
  deps: RunwayMarkdownApplyDeps,
  groups: readonly RunwayImportApplyGroup[],
  known: ReadonlySet<string>,
): Promise<{ problems: RunwayImportApplyProblem[]; aliases: Aliases }> {
  const problems: RunwayImportApplyProblem[] = [];
  // Per group, per row: every ID the row's ticket answered to now (VERM-105).
  const aliases: Aliases = new Map();
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
    if (answer.connectionKey !== g.connectionKey) {
      problems.push(problem(g.groupKey, 'connection-changed', CONNECTION_CHANGED));
      continue;
    }
    const changed = tickets.filter((t, i) => {
      const r = answer.candidates[i];
      return !r || r.status !== 'matched' || r.ticket.issueId !== t.issueId;
    });
    let n = 0;
    aliases.set(
      g.groupKey,
      g.rows.map((r) => {
        if (r.kind !== 'ticket') return undefined;
        const c = answer.candidates[n++];
        return c && c.status === 'matched' ? (c.ticket.aliases ?? [c.ticket.issueId]) : undefined;
      }),
    );
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
  return { problems, aliases };
}

/** Step 2, existing destinations: the tickets already on each Runway, read on its own connection. */
async function identifySaved(
  deps: RunwayMarkdownApplyDeps,
  groups: readonly RunwayImportApplyGroup[],
): Promise<{ problems: RunwayImportApplyProblem[]; identities: Map<string, Record<string, RunwaySavedIdentity>> }> {
  const problems: RunwayImportApplyProblem[] = [];
  const identities = new Map<string, Record<string, RunwaySavedIdentity>>();
  for (const g of groups) {
    if (g.target.kind !== 'existing' || !g.destination) continue;
    const itemIds = g.destination.rows.filter((r) => r.kind === 'issue').map((r) => r.itemId);
    let r: RunwayImportIdentifyResult;
    try {
      r = await deps.identify({ workspaceId: g.target.workspaceId, itemIds });
    } catch (err) {
      r = { ok: false, code: 'refresh-failed', error: messageOf(err, 'no answer'), retryable: true };
    }
    if (!r.ok) {
      problems.push(problem(g.groupKey, 'check-failed', `The tickets already on this Runway could not be checked again: ${r.error}`));
    } else if (r.connectionKey !== g.connectionKey) {
      problems.push(problem(g.groupKey, 'connection-changed', CONNECTION_CHANGED));
    } else {
      identities.set(g.groupKey, Object.fromEntries(r.items.map((i) => [i.itemId, i])));
    }
  }
  return { problems, identities };
}

/** Step 3: destinations, under the write gate. */
function checkDestinations(groups: readonly RunwayImportApplyGroup[], workspaces: readonly ApplyWorkspace[]): RunwayImportApplyProblem[] {
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
    } else {
      const wanted = fold(g.target.name);
      const taken = workspaces.find((w) => fold(w.name) === wanted);
      if (taken) problems.push(problem(g.groupKey, 'name-taken', `A workspace called ${taken.name.trim()} already exists. Rename this one, or map it to that workspace.`));
      else if ((newNames.get(wanted)?.length ?? 0) > 1) problems.push(problem(g.groupKey, 'name-taken', `Another new workspace is also called ${g.target.name}. Rename one, or merge them.`));
    }
  }
  return problems;
}

type Created = { groupKey: string; workspaceId: string; name: string; articleIds: string[] };

/** Removes the workspaces this Apply created; returns the ones that remain, with their articles. */
async function cleanup(deps: RunwayMarkdownApplyDeps, created: readonly Created[]): Promise<RunwayImportApplyRemaining[]> {
  const remaining: RunwayImportApplyRemaining[] = [];
  for (const c of created) {
    const left = (articleIds: string[] = c.articleIds, inspectArticleIds: string[] = []) =>
      remaining.push({ workspaceId: c.workspaceId, name: c.name, articleIds, inspectArticleIds });
    try {
      const r = await deps.workspaces.remove(c.workspaceId, c.articleIds);
      if (!r.ok) left(r.articleIds, r.inspectArticleIds);
    } catch {
      left();
    }
  }
  return remaining;
}

export function createRunwayMarkdownApply(deps: RunwayMarkdownApplyDeps) {
  return async function apply(args: unknown): Promise<RunwayImportApplyResult> {
    const plan = validateApplyArgs(args);
    if (typeof plan === 'string') return refused('invalid-args', plan);
    // Nothing new: refused before anything is read, backed up or created (checked again under the gate).
    if (plan.groups.every((g) => g.destination && g.destination.append.length === 0)) return refused('nothing-new', NOTHING_NEW);

    let before: ApplyWorkspace[];
    try {
      before = await deps.workspaces.list();
    } catch (err) {
      return refused('workspace-unavailable', `The workspace configuration could not be read: ${messageOf(err, 'unknown error')}`);
    }

    // 2. The connection and the tickets as previewed, on each group's own connection,
    //    and the tickets already on each existing destination.
    await deps.beforeVerify?.();
    const connections = await checkConnections(deps, plan.groups);
    if (connections.length > 0) return refused('review', 'Some groups changed since the preview. Nothing was written.', { problems: connections });
    const verify = await verifyTickets(deps, plan.groups, new Set(before.map((w) => w.id)));
    if (verify.problems.length > 0) return refused('review', 'Some groups changed since the preview. Nothing was written.', { problems: verify.problems });
    const saved = await identifySaved(deps, plan.groups);
    if (saved.problems.length > 0) return refused('review', 'Some groups changed since the preview. Nothing was written.', { problems: saved.problems });

    return deps.gate.run(async (): Promise<RunwayImportApplyResult> => {
      let workspaces: ApplyWorkspace[];
      try {
        workspaces = await deps.workspaces.list();
      } catch (err) {
        return refused('workspace-unavailable', `The workspace configuration could not be read: ${messageOf(err, 'unknown error')}`);
      }
      const store = deps.store();

      // 3. The connections again, now that nothing else can write, then the destinations.
      const changed = await checkConnections(deps, plan.groups);
      if (changed.length > 0) return refused('review', 'Some groups changed since the preview. Nothing was written.', { problems: changed });
      const destinations = checkDestinations(plan.groups, workspaces);
      if (destinations.length > 0) return refused('review', 'Some groups need correcting. Nothing was written.', { problems: destinations });

      // What each group appends, worked out again against its destination as it is now.
      const problems: RunwayImportApplyProblem[] = [];
      const work = plan.groups.map((g) => {
        const aliases = verify.aliases.get(g.groupKey) ?? [];
        if (g.target.kind !== 'existing' || !g.destination) {
          return { g, expected: [] as RunwayDestinationRow[], append: planRunwayAppend(g.rows, aliases, [], {}).append };
        }
        const name = workspaces.find((w) => w.id === connectionOf(g))?.name.trim() ?? connectionOf(g);
        const current = destinationRows(store.list(g.target.workspaceId));
        if (!sameDestinationRows(current, g.destination.rows)) {
          problems.push(problem(g.groupKey, 'runway-changed', `${name}’s Runway changed since the preview (a row was added, removed, moved or edited); it was kept. Review the preview again, then Apply.`));
          return { g, expected: current, append: [] };
        }
        const p = planRunwayAppend(g.rows, aliases, current, saved.identities.get(g.groupKey) ?? {});
        if (p.unableToVerify) {
          problems.push(problem(g.groupKey, 'unable-to-verify', `Unable to verify: ${p.unverified.join(', ')} on ${name}’s Runway could not be read, so a new ticket might be one of them. Nothing was added.`));
        } else if (!sameList(p.append, g.destination.append)) {
          problems.push(problem(g.groupKey, 'append-changed', `What would be added to ${name}’s Runway is not what the preview showed. Review the preview again, then Apply.`));
        }
        return { g, expected: current, append: p.append };
      });
      if (problems.length > 0) return refused('review', 'Some groups changed since the preview. Nothing was written.', { problems });
      if (work.every((w) => w.g.target.kind === 'existing' && w.append.length === 0)) return refused('nothing-new', NOTHING_NEW);

      // 4. The backup.
      let backupPath: string;
      try {
        backupPath = await deps.backup();
      } catch (err) {
        return refused('backup-failed', `The Runway database could not be backed up, so nothing was changed: ${messageOf(err, 'unknown error')}`);
      }

      // 5. The new workspaces.
      const created: Created[] = [];
      for (const g of plan.groups) {
        if (g.target.kind !== 'new') continue;
        let r: Awaited<ReturnType<ApplyWorkspaceStore['create']>>;
        try {
          r = await deps.workspaces.create(g.target.name, g.target.connectionWorkspaceId, g.connectionKey);
        } catch (err) {
          r = { ok: false, error: messageOf(err, 'unknown error') };
        }
        if (!r.ok) {
          // An ID allocated before the failure is this Apply's to remove too.
          const allocated = r.workspaceId ? [{ groupKey: g.groupKey, workspaceId: r.workspaceId, name: g.target.name, articleIds: r.articleIds ?? [] }] : [];
          const remaining = await cleanup(deps, [...created, ...allocated]);
          return refused('create-failed', `The workspace ${g.target.name} could not be created, so no rows were written: ${r.error}`, { backupPath, remaining });
        }
        created.push({ groupKey: g.groupKey, workspaceId: r.workspaceId, name: g.target.name, articleIds: r.articleIds ?? [] });
      }

      // 6. The new rows, appended in one transaction that first checks every destination is as compared.
      const idOf = (g: RunwayImportApplyGroup) => (g.target.kind === 'existing' ? g.target.workspaceId : (created.find((c) => c.groupKey === g.groupKey)?.workspaceId as string));
      const appends: RunwayAppend[] = work.map((w) => ({
        workspaceId: idOf(w.g),
        expected: w.expected,
        rows: w.append.map((i) => {
          const r = w.g.rows[i];
          return r.kind === 'ticket' ? { kind: 'issue' as const, issueId: r.issueId } : { kind: r.kind, text: r.text, depth: r.depth };
        }),
      }));
      try {
        store.appendImport(appends);
      } catch (err) {
        const remaining = await cleanup(deps, created);
        if (err instanceof RunwayItemStoreError && err.code === 'runway-changed') {
          const changedProblems = plan.groups
            .filter((g) => g.target.kind === 'existing' && err.workspaceIds.includes(g.target.workspaceId))
            .map((g) => {
              const name = workspaces.find((w) => w.id === idOf(g))?.name.trim() ?? idOf(g);
              return problem(g.groupKey, 'runway-changed', `${name}’s Runway changed just now; the change was kept. Review the preview again, then Apply.`);
            });
          return refused('review', 'A destination Runway changed. Nothing was written.', { problems: changedProblems, backupPath, remaining });
        }
        return refused('write-failed', `The Runway rows could not be written, so none were: ${messageOf(err, 'unknown error')}`, { backupPath, remaining });
      }

      return {
        ok: true,
        backupPath,
        workspaces: work.map((w) => {
          const made = created.find((c) => c.groupKey === w.g.groupKey);
          const id = idOf(w.g);
          return {
            groupKey: w.g.groupKey,
            workspaceId: id,
            name: made ? made.name : (workspaces.find((x) => x.id === id)?.name ?? id),
            created: Boolean(made),
            rows: w.append.length,
          };
        }),
      };
    });
  };
}
