// Adding a ticket to the Runway by key or link (VERM-86): the main-process
// side of runwayItemsAddByReference. Electron-free, so the rules run under
// vitest; main/ipc.ts registers it and supplies the dependencies.
//
// The steps, in order — every refusal before the last step leaves the
// Runway exactly as it was:
//   1. The arguments name a workspace, a reference and, optionally, a #N.
//   2. The workspace is configured and is the active one.
//   3. The reference is parsed against the workspace's own tracker host. A
//      link to any other host is refused here, before any request is made.
//   4. A ticket already on this Runway is refused, with no request.
//   5. The exact key is read once, on the workspace's own connection, and on
//      no other. This read is the add's own check: it does not widen the
//      search or detail admission rules (VERM-83), which are unchanged.
//      It is bounded by a timeout; a timeout, no answer, 429 or 5xx is a
//      retryable error.
//   6. If the active workspace changed while the read was in flight, the add
//      is cancelled.
//   7. The ticket is added once, under the key the tracker answered with,
//      through the Runway write handlers — which check the workspace again
//      inside RunwayWriteGate, immediately before the write.

import { encodeIssueId, type TrackerKind } from '../../shared/tracker';
import { runwayWorkspaceTracker, type RunwayItem } from '../../shared/runwayItem';
import { parseRunwayReference, runwayKeyOf } from '../../shared/runwayReference';
import { RUNWAY_ADD_MISSING_MESSAGE, type RunwayAddResult } from '../../shared/runwayAdd';
import type { RunwayItemsResult } from '../../shared/ipc';
import type { RunwayWorkspaces } from './runwayItemIpc';
import { classifyTicketReadError, type RunwayReaderResult } from './runwayTicketFetch';

/** How long the exact-key check waits for the tracker. */
export const RUNWAY_ADD_CHECK_TIMEOUT_MS = 15_000;

export interface RunwayAddByReferenceDeps {
  workspaces: () => Promise<RunwayWorkspaces>;
  /** The workspace's own tracker address: its YouTrack server URL or Jira site URL. */
  trackerBaseUrl: (workspaceId: string, tracker: TrackerKind) => Promise<string>;
  items: (workspaceId: string) => RunwayItem[];
  reader: (workspaceId: string, tracker: TrackerKind) => Promise<RunwayReaderResult>;
  addIssue: (args: { workspaceId: string; issueId: string }) => Promise<RunwayItemsResult>;
  addIssueAtNumber: (args: { workspaceId: string; issueId: string; runwayNumber: number }) => Promise<RunwayItemsResult>;
  /** Defaults to RUNWAY_ADD_CHECK_TIMEOUT_MS. */
  timeoutMs?: number;
}

const CANCELLED = 'The add was cancelled because the active workspace changed while the ticket was being checked.';

const fail = (code: Extract<RunwayAddResult, { ok: false }>['code'], error: string, retryable?: boolean): RunwayAddResult =>
  retryable === undefined ? { ok: false, code, error } : { ok: false, code, error, retryable };

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject({ name: 'TimeoutError', message: 'The tracker did not answer in time' }), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function createRunwayAddByReference(deps: RunwayAddByReferenceDeps) {
  const timeoutMs = deps.timeoutMs ?? RUNWAY_ADD_CHECK_TIMEOUT_MS;

  async function activeId(): Promise<string> {
    return (await deps.workspaces()).activeId;
  }

  return async function addByReference(args: unknown): Promise<RunwayAddResult> {
    // 1. Arguments.
    if (typeof args !== 'object' || args === null) return fail('invalid-args', 'Runway request arguments are missing');
    const { workspaceId, reference, runwayNumber } = args as { workspaceId?: unknown; reference?: unknown; runwayNumber?: unknown };
    if (typeof workspaceId !== 'string' || workspaceId === '') return fail('invalid-workspace', 'Workspace ID must be a non-empty string');
    if (typeof reference !== 'string') return fail('invalid-args', 'The ticket key or link must be text');
    if (runwayNumber !== undefined && !(Number.isInteger(runwayNumber) && (runwayNumber as number) >= 1)) {
      return fail('invalid-position', 'The Runway # must be a whole number of 1 or more');
    }

    try {
      // 2. The workspace.
      let config: RunwayWorkspaces;
      try {
        config = await deps.workspaces();
      } catch (err) {
        const message = (err as { message?: unknown } | null)?.message;
        return fail('workspace-unavailable', `The workspace configuration could not be read${typeof message === 'string' ? `: ${message}` : ''}`);
      }
      const workspace = config.workspaces.find((w) => w.id === workspaceId);
      if (!workspace) return fail('unknown-workspace', `No workspace ${workspaceId} is configured`);
      if (config.activeId !== workspaceId) return fail('not-active-workspace', `Workspace ${workspaceId} is not the active workspace`);
      const tracker = runwayWorkspaceTracker(workspace);

      // 3. The reference, against the workspace's own tracker host.
      const parsed = parseRunwayReference(reference, tracker, await deps.trackerBaseUrl(workspaceId, tracker));
      if (!parsed.ok) return fail(parsed.code, parsed.message);

      // 4. Already on this Runway: no request.
      const onRunway = (key: string) =>
        deps.items(workspaceId).some((item) => item.kind === 'issue' && item.itemId === encodeIssueId(tracker, key));
      if (onRunway(parsed.localId)) return fail('already-on-runway', `${parsed.localId} is already on this Runway.`);

      // 5. The exact key, on the workspace's own connection only.
      const opened = await deps.reader(workspaceId, tracker);
      if (!opened.ok) return fail(opened.code, opened.error, opened.code === 'refresh-failed' ? true : undefined);
      let answered: string;
      try {
        const issue = await withTimeout(opened.reader.one(parsed.localId), timeoutMs);
        answered = runwayKeyOf(tracker, issue.idReadable) ?? parsed.localId;
      } catch (err) {
        const failure = classifyTicketReadError(err);
        if (failure.scope === 'workspace') {
          if (failure.code === 'unauthorized') return fail('unauthorized', failure.message);
          const error = failure.timeout
            ? 'The tracker did not answer in time. The Runway is unchanged; try again.'
            : `${failure.message.replace('The Runway could not be refreshed: ', 'The ticket could not be checked: ')}. The Runway is unchanged; try again.`;
          return fail('refresh-failed', error, true);
        }
        if (failure.state === 'missing-or-unreadable') return fail('missing-or-unreadable', RUNWAY_ADD_MISSING_MESSAGE);
        if (failure.state === 'missing') return fail('missing', 'Ticket missing: the tracker says it is gone.');
        return fail('not-readable', `Ticket not readable with this workspace’s credential${failure.reason ? `: ${failure.reason}` : '.'}`);
      }

      // 6. A switch while the check was in flight cancels the add.
      if ((await activeId()) !== workspaceId) return fail('cancelled', CANCELLED);
      // A moved ticket answers under its new key, which may already be here.
      if (answered !== parsed.localId && onRunway(answered)) return fail('already-on-runway', `${answered} is already on this Runway.`);

      // 7. Once, through the write handlers and their gate.
      const issueId = encodeIssueId(tracker, answered);
      const r =
        runwayNumber === undefined
          ? await deps.addIssue({ workspaceId, issueId })
          : await deps.addIssueAtNumber({ workspaceId, issueId, runwayNumber: runwayNumber as number });
      if (r.ok) return { ok: true, items: r.items, itemId: issueId };
      if (r.code === 'not-active-workspace') return fail('cancelled', CANCELLED);
      return fail(r.code ?? 'invalid-args', r.error);
    } catch (err) {
      const message = (err as { message?: unknown } | null)?.message;
      return fail('refresh-failed', `${typeof message === 'string' ? message : 'The ticket could not be added'}. The Runway is unchanged; try again.`, true);
    }
  };
}
