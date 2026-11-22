// Workspace Runway order handlers (VERM-82): the main-process side of the
// runwayItems* IPC channels, over the runway_item store (VERM-80/81).
//
// Kept free of Electron so the rules run under vitest; main/ipc.ts only
// registers these on ipcMain and supplies the dependencies.
//
// The rules, in the order they are checked — every refusal happens before
// any write, so a refused call leaves the Runway exactly as it was:
//   1. The arguments are an object naming a workspace.
//   2. The workspace is resolved from the workspace configuration in the main
//      process (never trusted from the renderer); an unknown one is refused.
//   3. A write must target the active workspace. Listing may read any
//      configured workspace and is read-only.
//   4. A ticket being added must be on the workspace's own tracker — any
//      project on it — as its configuration names it; a workspace with no
//      backend setting (legacy shared storage) is YouTrack.
//   5. The store call runs inside RunwayWriteGate, so it is serialized with
//      the snapshot import and every other Runway write.

import type {
  RunwayItemsAddIssueArgs,
  RunwayItemsAddIssueAtNumberArgs,
  RunwayItemsAddStructuralArgs,
  RunwayItemsErrorCode,
  RunwayItemsItemArgs,
  RunwayItemsListArgs,
  RunwayItemsMoveArgs,
  RunwayItemsMoveToNumberArgs,
  RunwayItemsResult,
} from '../../shared/ipc';
import { runwayTicketRefusal, runwayWorkspaceTracker, type RunwayItem } from '../../shared/runwayItem';
import type { ActiveBackendContext } from '../../shared/activeWorkspace';
import type { TrackerKind } from '../../shared/tracker';
import { RunwayItemStoreError, type RunwayItemStore } from './runwayItemStore';

/** A configured workspace as far as the Runway needs it. */
export interface RunwayWorkspace {
  id: string;
  /** Its configured backend; absent or null means YouTrack (legacy). */
  backend?: Pick<ActiveBackendContext, 'kind'> | null;
}

export interface RunwayWorkspaces {
  /** The active workspace's ID on this computer; '' when there is none. */
  activeId: string;
  workspaces: readonly RunwayWorkspace[];
}

export interface RunwayItemIpcDeps {
  /** The open store; called only once the request has passed every check. */
  store: () => RunwayItemStore;
  /** Serializes writes with the snapshot import (RunwayWriteGate). */
  gate: { run<T>(operation: () => T | Promise<T>): Promise<T> };
  /** Reads the workspace configuration (legacy or per-workspace storage). */
  workspaces: () => Promise<RunwayWorkspaces>;
}

export interface RunwayItemHandlers {
  list(args: RunwayItemsListArgs): Promise<RunwayItemsResult>;
  addIssue(args: RunwayItemsAddIssueArgs): Promise<RunwayItemsResult>;
  addIssueAtNumber(args: RunwayItemsAddIssueAtNumberArgs): Promise<RunwayItemsResult>;
  addSection(args: RunwayItemsAddStructuralArgs): Promise<RunwayItemsResult>;
  addNote(args: RunwayItemsAddStructuralArgs): Promise<RunwayItemsResult>;
  remove(args: RunwayItemsItemArgs): Promise<RunwayItemsResult>;
  move(args: RunwayItemsMoveArgs): Promise<RunwayItemsResult>;
  moveToNumber(args: RunwayItemsMoveToNumberArgs): Promise<RunwayItemsResult>;
  moveUp(args: RunwayItemsItemArgs): Promise<RunwayItemsResult>;
  moveDown(args: RunwayItemsItemArgs): Promise<RunwayItemsResult>;
}

class Refusal extends Error {
  constructor(
    readonly code: RunwayItemsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunwayItemsRefusal';
  }
}

function failure(err: unknown): RunwayItemsResult {
  if (err instanceof Refusal || err instanceof RunwayItemStoreError) {
    return { ok: false, error: err.message, code: err.code };
  }
  const message = (err as { message?: unknown } | null)?.message;
  return { ok: false, error: typeof message === 'string' ? message : 'Runway request failed' };
}

function workspaceIdOf(args: unknown): string {
  if (typeof args !== 'object' || args === null) {
    throw new Refusal('invalid-args', 'Runway request arguments are missing');
  }
  const id = (args as { workspaceId?: unknown }).workspaceId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Refusal('invalid-workspace', 'Workspace ID must be a non-empty string');
  }
  return id;
}

export function createRunwayItemHandlers(deps: RunwayItemIpcDeps): RunwayItemHandlers {
  async function resolve(workspaceId: string, forWrite: boolean): Promise<TrackerKind> {
    let config: RunwayWorkspaces;
    try {
      config = await deps.workspaces();
    } catch (err) {
      const message = (err as { message?: unknown } | null)?.message;
      throw new Refusal(
        'workspace-unavailable',
        `The workspace configuration could not be read${typeof message === 'string' ? `: ${message}` : ''}`,
      );
    }
    const workspace = config.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) throw new Refusal('unknown-workspace', `No workspace ${workspaceId} is configured`);
    if (forWrite && workspaceId !== config.activeId) {
      throw new Refusal('not-active-workspace', `Workspace ${workspaceId} is not the active workspace`);
    }
    return runwayWorkspaceTracker(workspace);
  }

  function refuseTicket(tracker: TrackerKind, workspaceId: string, issueId: unknown): void {
    const refusal = runwayTicketRefusal(tracker, issueId);
    if (refusal === 'invalid-issue-id') {
      throw new Refusal(refusal, `Not a YouTrack or Jira ticket ID: ${JSON.stringify(issueId)}`);
    }
    if (refusal === 'wrong-tracker') {
      const name = tracker === 'jira' ? 'Jira' : 'YouTrack';
      throw new Refusal(refusal, `Workspace ${workspaceId}'s Runway holds ${name} tickets only`);
    }
  }

  /** Resolves the workspace for a write, runs `check`, then `write` inside the gate. */
  function write<A>(
    check: ((tracker: TrackerKind, workspaceId: string, args: A) => void) | null,
    op: (store: RunwayItemStore, workspaceId: string, args: A) => RunwayItem[],
  ) {
    return async (args: A): Promise<RunwayItemsResult> => {
      try {
        const workspaceId = workspaceIdOf(args);
        const tracker = await resolve(workspaceId, true);
        check?.(tracker, workspaceId, args);
        const items = await deps.gate.run(() => op(deps.store(), workspaceId, args));
        return { ok: true, items };
      } catch (err) {
        return failure(err);
      }
    };
  }

  const ticketCheck = (tracker: TrackerKind, workspaceId: string, args: { issueId: unknown }) =>
    refuseTicket(tracker, workspaceId, args.issueId);

  return {
    async list(args) {
      try {
        const workspaceId = workspaceIdOf(args);
        await resolve(workspaceId, false);
        return { ok: true, items: deps.store().list(workspaceId) };
      } catch (err) {
        return failure(err);
      }
    },
    addIssue: write<RunwayItemsAddIssueArgs>(ticketCheck, (s, ws, a) => s.addIssue(ws, a.issueId, a.position)),
    addIssueAtNumber: write<RunwayItemsAddIssueAtNumberArgs>(ticketCheck, (s, ws, a) =>
      s.addIssueAtNumber(ws, a.issueId, a.runwayNumber),
    ),
    addSection: write<RunwayItemsAddStructuralArgs>(null, (s, ws, a) =>
      s.addSection(ws, a.text, { depth: a.depth, position: a.position }),
    ),
    addNote: write<RunwayItemsAddStructuralArgs>(null, (s, ws, a) =>
      s.addNote(ws, a.text, { depth: a.depth, position: a.position }),
    ),
    remove: write<RunwayItemsItemArgs>(null, (s, ws, a) => s.remove(ws, a.itemId)),
    move: write<RunwayItemsMoveArgs>(null, (s, ws, a) => s.move(ws, a.itemId, a.position)),
    moveToNumber: write<RunwayItemsMoveToNumberArgs>(null, (s, ws, a) => s.moveToNumber(ws, a.itemId, a.runwayNumber)),
    moveUp: write<RunwayItemsItemArgs>(null, (s, ws, a) => s.moveUp(ws, a.itemId)),
    moveDown: write<RunwayItemsItemArgs>(null, (s, ws, a) => s.moveDown(ws, a.itemId)),
  };
}
