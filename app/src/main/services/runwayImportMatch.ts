// Matching a Markdown schedule's tickets to workspaces (VERM-101): the
// main-process side of runwayImportMatch. Electron-free, so the rules run
// under vitest; main/ipc.ts registers it and supplies the dependencies.
//
// Read-only. Nothing here writes a Runway row, a workspace or a project:
// the dependencies offer no write at all.
//
// Per group, in order:
//   1. The group names the existing workspace chosen to supply its
//      connection. An unknown one fails the group.
//   2. Every candidate is validated on its own, as written, against that
//      workspace's own tracker and host (parseRunwayReference). A link to
//      another host keeps its refusal even when its key also appears as a
//      valid bare key. Candidates are combined only after this.
//   3. The distinct valid keys are read once each, on that workspace's own
//      connection and no other (readRunwayTickets: batches, then single
//      reads; 403, 404 and 410 are ticket states). Scheduled tickets and
//      references share the one lookup. When no candidate is valid, no
//      connection is opened.
//   4. A failure of the whole connection — 401, no credential, no answer, a
//      timeout, a server error — is one error for the group, and no
//      candidate is classified. A timeout or server error is retryable at
//      once; a 401 or a missing credential says what to correct first.
//   5. A reference the parser marked as a duplicate was written as a
//      scheduled line; it is matched as scheduled, since the parser compared
//      host and key only and the line it deferred to may be refused here.
//      Within the group, the first scheduled occurrence of a matched ticket
//      keeps its place, in file order. A later scheduled occurrence of the
//      same ticket — by any ID it answered under, so a Jira issue read under
//      an old and a current key is one ticket — is a duplicate. References
//      never take a scheduled ticket's place; each keeps its own line,
//      reason and role, with the shared lookup's result.
//
// Two groups are independent: each is matched through its own workspace's
// connection and keeps its own result, even for the same key.

import { encodeIssueId, isValidLocalId, type TrackerKind } from '../../shared/tracker';
import { runwayWorkspaceTracker } from '../../shared/runwayItem';
import { parseRunwayReference, runwayKeyOf } from '../../shared/runwayReference';
import { RUNWAY_ADD_MISSING_MESSAGE } from '../../shared/runwayAdd';
import type { ScheduleReferenceReason } from '../../shared/runwaySchedule';
import {
  RUNWAY_IMPORT_MAX_CANDIDATES,
  RUNWAY_IMPORT_MAX_GROUPS,
  RUNWAY_IMPORT_MAX_TEXT,
  type RunwayImportCandidate,
  type RunwayImportCandidateMatch,
  type RunwayImportGroupArgs,
  type RunwayImportGroupMatch,
  type RunwayImportMatchArgs,
  type RunwayImportMatchResult,
  type RunwayImportTicket,
} from '../../shared/runwayImport';
import type { RunwayWorkspaces } from './runwayItemIpc';
import { readRunwayTickets, runwayReadFailure, type RunwayReaderResult, type RunwayTicketReader } from './runwayTicketFetch';

/** How long one tracker request of the match may take. */
export const RUNWAY_IMPORT_READ_TIMEOUT_MS = 15_000;

export interface RunwayImportMatchDeps {
  /** Reads the workspace configuration (legacy or per-workspace storage). */
  workspaces: () => Promise<RunwayWorkspaces>;
  /** The workspace's own tracker address: its YouTrack server URL or Jira site URL. */
  trackerBaseUrl: (workspaceId: string, tracker: TrackerKind) => Promise<string>;
  /** Opens a reader on this workspace's own connection, for its tracker. */
  reader: (workspaceId: string, tracker: TrackerKind) => Promise<RunwayReaderResult>;
  /** Defaults to RUNWAY_IMPORT_READ_TIMEOUT_MS. */
  timeoutMs?: number;
}

const REASONS: readonly ScheduleReferenceReason[] = ['prose', 'heading', 'nested', 'table', 'code', 'trailing', 'duplicate'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The request, checked field by field; a string says why it was refused. */
export function validateImportMatchArgs(args: unknown): RunwayImportMatchArgs | string {
  if (!isRecord(args) || !Array.isArray(args.groups)) return 'Import match arguments are missing';
  if (args.groups.length > RUNWAY_IMPORT_MAX_GROUPS) return `At most ${RUNWAY_IMPORT_MAX_GROUPS} groups can be matched at once`;
  let total = 0;
  const groups: RunwayImportGroupArgs[] = [];
  for (const g of args.groups) {
    if (!isRecord(g)) return 'Each group must be an object';
    if (typeof g.groupKey !== 'string' || g.groupKey.length > 200) return 'Each group needs a groupKey of at most 200 characters';
    if (typeof g.workspaceId !== 'string' || g.workspaceId === '') return 'Each group needs a workspace ID';
    if (!Array.isArray(g.candidates)) return 'Each group needs a list of candidates';
    total += g.candidates.length;
    if (total > RUNWAY_IMPORT_MAX_CANDIDATES) return `At most ${RUNWAY_IMPORT_MAX_CANDIDATES} candidates can be matched at once`;
    const candidates: RunwayImportCandidate[] = [];
    for (const c of g.candidates) {
      if (!isRecord(c)) return 'Each candidate must be an object';
      if (typeof c.text !== 'string' || c.text.length > RUNWAY_IMPORT_MAX_TEXT) {
        return `Each candidate needs its text, at most ${RUNWAY_IMPORT_MAX_TEXT} characters`;
      }
      if (!Number.isInteger(c.line) || (c.line as number) < 1) return 'Each candidate needs a line number of 1 or more';
      if (c.role !== 'scheduled' && c.role !== 'reference') return 'Each candidate’s role must be scheduled or reference';
      const reason = c.reason ?? null;
      if (c.role === 'scheduled' && reason !== null) return 'A scheduled candidate has no reference reason';
      if (c.role === 'reference' && !REASONS.includes(reason as ScheduleReferenceReason)) return 'A reference needs a known reason';
      candidates.push({ text: c.text, line: c.line as number, role: c.role, reason: reason as ScheduleReferenceReason | null });
    }
    groups.push({ groupKey: g.groupKey, workspaceId: g.workspaceId, candidates });
  }
  return { groups };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject({ name: 'TimeoutError', message: 'the tracker did not answer in time' }), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The reader with every tracker request bounded by `ms`. */
function timed(reader: RunwayTicketReader, ms: number): RunwayTicketReader {
  const admits = reader.admits;
  return {
    batch: (ids) => withTimeout(reader.batch(ids), ms),
    one: (id) => withTimeout(reader.one(id), ms),
    // A moved key's admission check can ask the tracker too (Jira board membership).
    ...(admits ? { admits: (key: string) => withTimeout(admits.call(reader, key), ms) } : {}),
  };
}

type GroupFailure = Extract<RunwayImportGroupMatch, { ok: false }>;

function connectionFailure(group: RunwayImportGroupArgs, code: 'unauthorized' | 'credential' | 'refresh-failed', message: string): GroupFailure {
  const base = { groupKey: group.groupKey, workspaceId: group.workspaceId, ok: false as const };
  switch (code) {
    case 'unauthorized':
      return {
        ...base,
        code,
        retryable: false,
        error: `${message}. Correct this workspace’s tracker credential in Settings, then match again.`,
      };
    case 'credential':
      return {
        ...base,
        code,
        retryable: false,
        error: `This workspace’s tracker credential could not be read: ${message}. Set it in Settings, then match again.`,
      };
    case 'refresh-failed':
      return {
        ...base,
        code,
        retryable: true,
        error: `${message.replace('The Runway could not be refreshed: ', 'The tickets could not be checked: ')}. Nothing was matched; try again.`,
      };
  }
}

/** Every ID the answered ticket goes by on this Runway: its key, the key asked for, and (YouTrack) its entity ID. */
function aliasesOf(tracker: TrackerKind, asked: string, issue: { id: string; idReadable: string }): string[] {
  const answered = runwayKeyOf(tracker, issue.idReadable) ?? asked;
  const ids = [encodeIssueId(tracker, answered), encodeIssueId(tracker, asked)];
  if (tracker === 'youtrack' && isValidLocalId('youtrack', issue.id)) ids.push(encodeIssueId(tracker, issue.id));
  return [...new Set(ids)];
}

async function matchGroup(deps: RunwayImportMatchDeps, config: RunwayWorkspaces, group: RunwayImportGroupArgs): Promise<RunwayImportGroupMatch> {
  const workspace = config.workspaces.find((w) => w.id === group.workspaceId);
  if (!workspace) {
    return {
      groupKey: group.groupKey,
      workspaceId: group.workspaceId,
      ok: false,
      code: 'unknown-workspace',
      retryable: false,
      error: `No workspace ${group.workspaceId} is configured. Choose another workspace to supply this group’s connection.`,
    };
  }
  const tracker = runwayWorkspaceTracker(workspace);
  const baseUrl = await deps.trackerBaseUrl(group.workspaceId, tracker);
  // A parser duplicate keeps its scheduling intent until validated (step 5).
  const candidates = group.candidates.map(
    (c): RunwayImportCandidate => (c.role === 'reference' && c.reason === 'duplicate' ? { ...c, role: 'scheduled', reason: null } : c),
  );

  // 2. Each candidate on its own, as written.
  const parsed = candidates.map((c) => parseRunwayReference(c.text, tracker, baseUrl));
  const localIds = [...new Set(parsed.flatMap((p) => (p.ok ? [p.localId] : [])))];

  // 3. One lookup per distinct key, on this workspace's own connection.
  const reads = new Map<string, Awaited<ReturnType<typeof readRunwayTickets>>[number]>();
  if (localIds.length > 0) {
    const opened = await deps.reader(group.workspaceId, tracker);
    if (!opened.ok) return connectionFailure(group, opened.code, opened.error);
    try {
      const itemIds = localIds.map((id) => encodeIssueId(tracker, id));
      const results = await readRunwayTickets(tracker, timed(opened.reader, deps.timeoutMs ?? RUNWAY_IMPORT_READ_TIMEOUT_MS), itemIds);
      results.forEach((read) => reads.set(read.itemId, read));
    } catch (err) {
      const failure = runwayReadFailure(err);
      if (failure && (failure.code === 'unauthorized' || failure.code === 'refresh-failed')) {
        return connectionFailure(group, failure.code, failure.message);
      }
      const message = (err as { message?: unknown } | null)?.message;
      return connectionFailure(group, 'refresh-failed', typeof message === 'string' && message ? message : 'the tracker could not be reached');
    }
  }

  // 4. Each candidate's own result, from the shared lookup.
  const aliases: (string[] | null)[] = [];
  const results: RunwayImportCandidateMatch[] = candidates.map((c, i): RunwayImportCandidateMatch => {
    const base = { text: c.text, line: c.line, role: c.role, reason: c.reason };
    aliases.push(null);
    const p = parsed[i];
    if (!p.ok) return { ...base, status: 'unmatched', code: p.code, message: p.message };
    const read = reads.get(encodeIssueId(tracker, p.localId));
    switch (read?.state) {
      case 'resolved': {
        const ids = aliasesOf(tracker, p.localId, read.issue);
        aliases[i] = ids;
        const ticket: RunwayImportTicket = { issueId: ids[0], key: read.issue.idReadable, summary: read.issue.summary };
        return { ...base, status: 'matched', ticket };
      }
      case 'not-readable':
        return {
          ...base,
          status: 'unmatched',
          code: 'not-readable',
          message: `Ticket not readable with this workspace’s credential${read.reason ? `: ${read.reason}` : '.'}`,
        };
      case 'missing':
        return { ...base, status: 'unmatched', code: 'missing', message: 'Ticket missing: the tracker says it is gone.' };
      default:
        // missing-or-unreadable; an unread key is treated the same way.
        return { ...base, status: 'unmatched', code: 'missing-or-unreadable', message: RUNWAY_ADD_MISSING_MESSAGE };
    }
  });

  // 5. The first scheduled occurrence of a matched ticket keeps its place.
  const order = candidates.map((c, i) => ({ c, i })).sort((a, b) => a.c.line - b.c.line || a.i - b.i);
  const firstLine = new Map<string, number>();
  for (const { c, i } of order) {
    const r = results[i];
    const ids = aliases[i];
    if (c.role !== 'scheduled' || r.status !== 'matched' || !ids) continue;
    const earlier = ids.map((id) => firstLine.get(id)).find((line) => line !== undefined);
    if (earlier !== undefined) {
      results[i] = { ...r, status: 'duplicate', duplicateOfLine: earlier };
    } else {
      for (const id of ids) firstLine.set(id, c.line);
    }
  }

  return { groupKey: group.groupKey, workspaceId: group.workspaceId, ok: true, candidates: results };
}

export function createRunwayImportMatch(deps: RunwayImportMatchDeps) {
  return async function match(args: unknown): Promise<RunwayImportMatchResult> {
    const request = validateImportMatchArgs(args);
    if (typeof request === 'string') return { ok: false, code: 'invalid-args', error: request };

    let config: RunwayWorkspaces;
    try {
      config = await deps.workspaces();
    } catch (err) {
      const message = (err as { message?: unknown } | null)?.message;
      return {
        ok: false,
        code: 'workspace-unavailable',
        error: `The workspace configuration could not be read${typeof message === 'string' ? `: ${message}` : ''}`,
      };
    }

    // Groups are matched one after another, each on its own workspace's connection.
    const groups: RunwayImportGroupMatch[] = [];
    for (const group of request.groups) {
      try {
        groups.push(await matchGroup(deps, config, group));
      } catch (err) {
        const message = (err as { message?: unknown } | null)?.message;
        groups.push(connectionFailure(group, 'refresh-failed', typeof message === 'string' && message ? message : 'the tracker could not be reached'));
      }
    }
    return { ok: true, groups };
  };
}
