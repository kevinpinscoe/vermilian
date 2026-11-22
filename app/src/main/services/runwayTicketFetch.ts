// Reads a workspace's Runway tickets from its tracker (VERM-84), on that
// workspace's own connection and no other.
//
// Kept free of Electron so the rules run under vitest; main/ipc.ts registers
// the handler and supplies the dependencies.
//
// The read, per workspace:
//   1. The workspace is resolved from the workspace configuration in the main
//      process; an unknown one is refused. Like runwayItemsList, any
//      configured workspace may be read — it is read-only.
//   2. Its ticket rows come from its own Runway. Sections and notes are not
//      tickets and are not read.
//   3. One reader is opened for the workspace, on its own connection. A
//      reader that cannot be opened (no credential, refused) fails the whole
//      read; nothing falls back to the Settings token or another workspace's
//      credential.
//   4. The tickets are read in batches. A batch that fails for any reason but
//      authentication or the network (YouTrack answers 400 for a whole query
//      if one ID in it does not exist) is not an answer about any ticket: its
//      tickets, and any a successful batch did not return, are read one at a
//      time on the same reader, so the readable ones still load.
//   5. One ticket's answer: 404 → missing-or-unreadable (deleted and
//      unreadable look the same); 403 → not-readable; 410 → missing.
//   6. A 401 — on a batch or a single read — is one workspace-level
//      'unauthorized' error, and the remaining single reads are skipped. A
//      network failure or a server error is one 'refresh-failed' error.
//
// Nothing here writes runway_item: every row keeps its place whatever its
// tracker says, so a later refresh can restore its details.

import { decodeIssueId, type TrackerKind } from '../../shared/tracker';
import { runwayWorkspaceTracker, type RunwayItem } from '../../shared/runwayItem';
import type { RunwayTicketRead, RunwayTicketsErrorCode, RunwayTicketsResult } from '../../shared/runwayTicket';
import type { BoardIssue } from '../../shared/workspace';
import type { RunwayWorkspaces } from './runwayItemIpc';
import type { YouTrackProvider } from '../providers/youtrackProvider';
import type { JiraProvider } from '../providers/jiraProvider';
import { jiraWorkspaceAdmits, type JiraAdmissionScope } from '../providers/jiraAdmission';

/** Tickets per batch read. */
export const RUNWAY_BATCH_SIZE = 50;
/** Single reads in flight at once, after a batch falls back. */
export const RUNWAY_SINGLE_READ_CONCURRENCY = 4;

/** One workspace's tracker, bound to that workspace's own connection. */
export interface RunwayTicketReader {
  /** The issues the tracker returns for these local IDs; may omit some. */
  batch(localIds: readonly string[]): Promise<BoardIssue[]>;
  /** One issue by local ID; rejects with the tracker's error ({ status }). */
  one(localId: string): Promise<BoardIssue>;
  /**
   * Whether the workspace may read the ticket under `localId` when the
   * tracker answers a read with a different key (a moved Jira issue). Absent
   * means every answer is admitted (YouTrack has no such gate).
   */
  admits?(localId: string): Promise<boolean>;
}

export type RunwayReaderResult =
  | { ok: true; reader: RunwayTicketReader }
  | { ok: false; code: 'unauthorized' | 'credential' | 'refresh-failed'; error: string };

export interface RunwayTicketFetchDeps {
  /** Reads the workspace configuration (legacy or per-workspace storage). */
  workspaces: () => Promise<RunwayWorkspaces>;
  /** The workspace's Runway rows. */
  items: (workspaceId: string) => RunwayItem[];
  /** Opens a reader on this workspace's own connection, for its tracker. */
  reader: (workspaceId: string, tracker: TrackerKind) => Promise<RunwayReaderResult>;
}

class WorkspaceFailure extends Error {
  constructor(
    readonly code: RunwayTicketsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunwayTicketsFailure';
  }
}

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function messageOf(err: unknown, fallback: string): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/** A failure that is about the whole connection, never about one ticket. */
function workspaceFailureOf(err: unknown): WorkspaceFailure | null {
  const status = statusOf(err);
  if (status === 401) {
    return new WorkspaceFailure('unauthorized', `The tracker refused this workspace's credential: ${messageOf(err, 'HTTP 401')}`);
  }
  // No status: fetch itself failed (offline, DNS, TLS). 5xx and 429: the
  // tracker could not answer. Neither says anything about a ticket.
  if (status === undefined || status >= 500 || status === 429) {
    return new WorkspaceFailure('refresh-failed', `The Runway could not be refreshed: ${messageOf(err, 'the tracker could not be reached')}`);
  }
  return null;
}

/** One ticket's state from its single-read error; throws a workspace failure. */
function singleReadState(itemId: string, err: unknown): RunwayTicketRead {
  const failure = workspaceFailureOf(err);
  if (failure) throw failure;
  const status = statusOf(err);
  if (status === 403) return { itemId, state: 'not-readable', reason: messageOf(err, 'HTTP 403') };
  if (status === 410) return { itemId, state: 'missing' };
  return { itemId, state: 'missing-or-unreadable' };
}

/**
 * The local ID an issue came back under: its readable ID (a YouTrack ID or a
 * Jira key). A row stored under another form of ID (a YouTrack entity ID) or
 * a moved issue does not match, so it is read again on its own.
 */
const answeredIdOf = (issue: BoardIssue): string => issue.idReadable;

/**
 * Reads the given ticket rows with one reader. Returns a state for every
 * ticket row, in the rows' order, or throws WorkspaceFailure.
 */
export async function readRunwayTickets(
  tracker: TrackerKind,
  reader: RunwayTicketReader,
  itemIds: readonly string[],
): Promise<RunwayTicketRead[]> {
  const localIds = new Map<string, string>(); // local ID → item ID
  for (const itemId of itemIds) {
    const decoded = decodeIssueId(itemId);
    if (decoded && decoded.kind === tracker) localIds.set(decoded.localId, itemId);
  }
  const reads = new Map<string, RunwayTicketRead>();

  const pending = [...localIds.keys()];
  for (let i = 0; i < pending.length; i += RUNWAY_BATCH_SIZE) {
    const chunk = pending.slice(i, i + RUNWAY_BATCH_SIZE);
    let issues: BoardIssue[];
    try {
      issues = await reader.batch(chunk);
    } catch (err) {
      const failure = workspaceFailureOf(err);
      if (failure) throw failure;
      continue; // retried one at a time below
    }
    const asked = new Set(chunk);
    for (const issue of issues) {
      const localId = answeredIdOf(issue);
      if (asked.has(localId)) {
        const itemId = localIds.get(localId) as string;
        reads.set(itemId, { itemId, state: 'resolved', issue });
      }
    }
  }

  const singles = pending.filter((id) => !reads.has(localIds.get(id) as string));
  let next = 0;
  let stopped: WorkspaceFailure | null = null;
  const worker = async () => {
    while (!stopped && next < singles.length) {
      const localId = singles[next++];
      const itemId = localIds.get(localId) as string;
      try {
        const issue = await reader.one(localId);
        const answered = answeredIdOf(issue);
        if (answered !== localId && reader.admits && !(await reader.admits(answered))) {
          reads.set(itemId, { itemId, state: 'not-readable', reason: `${localId} has moved to ${answered}, which this workspace may not read.` });
        } else {
          reads.set(itemId, { itemId, state: 'resolved', issue });
        }
      } catch (err) {
        try {
          reads.set(itemId, singleReadState(itemId, err));
        } catch (failure) {
          stopped ??= failure as WorkspaceFailure;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(RUNWAY_SINGLE_READ_CONCURRENCY, singles.length) }, worker));
  if (stopped) throw stopped;

  return itemIds.flatMap((itemId) => reads.get(itemId) ?? []);
}

function workspaceIdOf(args: unknown): string {
  if (typeof args !== 'object' || args === null) {
    throw new WorkspaceFailure('invalid-args', 'Runway request arguments are missing');
  }
  const id = (args as { workspaceId?: unknown }).workspaceId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new WorkspaceFailure('invalid-workspace', 'Workspace ID must be a non-empty string');
  }
  return id;
}

export function createRunwayTicketFetch(deps: RunwayTicketFetchDeps) {
  return async function resolve(args: unknown): Promise<RunwayTicketsResult> {
    try {
      const workspaceId = workspaceIdOf(args);
      let config: RunwayWorkspaces;
      try {
        config = await deps.workspaces();
      } catch (err) {
        throw new WorkspaceFailure('workspace-unavailable', `The workspace configuration could not be read: ${messageOf(err, 'unknown error')}`);
      }
      const workspace = config.workspaces.find((w) => w.id === workspaceId);
      if (!workspace) throw new WorkspaceFailure('unknown-workspace', `No workspace ${workspaceId} is configured`);
      const tracker = runwayWorkspaceTracker(workspace);

      const itemIds = deps.items(workspaceId).filter((item) => item.kind === 'issue').map((item) => item.itemId);
      if (itemIds.length === 0) return { ok: true, tickets: [] };

      const opened = await deps.reader(workspaceId, tracker);
      if (!opened.ok) return { ok: false, error: opened.error, code: opened.code };
      return { ok: true, tickets: await readRunwayTickets(tracker, opened.reader, itemIds) };
    } catch (err) {
      if (err instanceof WorkspaceFailure) return { ok: false, error: err.message, code: err.code };
      return { ok: false, error: messageOf(err, 'The Runway could not be refreshed'), code: 'refresh-failed' };
    }
  };
}

/** A Runway reader on a workspace's own YouTrack provider. */
export function youtrackRunwayReader(provider: Pick<YouTrackProvider, 'getIssuesByIds' | 'getBoardIssue'>): RunwayTicketReader {
  return {
    batch: (ids) => provider.getIssuesByIds(ids),
    one: (id) => provider.getBoardIssue(id),
  };
}

/**
 * A Runway reader on a workspace's own Jira provider. A ticket that answers
 * under a new key (moved) is shown only if the workspace admits the new key
 * by the same rule as every other Jira read (jiraWorkspaceAdmits).
 */
export function jiraRunwayReader(
  provider: Pick<JiraProvider, 'getIssuesByKeys' | 'getBoardIssue'>,
  scope: JiraAdmissionScope,
): RunwayTicketReader {
  return {
    batch: (keys) => provider.getIssuesByKeys(keys),
    one: (key) => provider.getBoardIssue(key),
    admits: (key) => jiraWorkspaceAdmits(scope, key),
  };
}
