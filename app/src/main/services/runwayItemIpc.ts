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
//      the snapshot import and every other Runway write. Rules 2–4 are
//      checked again inside the gate, immediately before the write: a write
//      queued for workspace A that finds B active by then is refused.
//   6. Remove and every Move (VERM-87) also capture the workspace-switch
//      generation when the request arrives. Inside the gate, after the last
//      awaited validation and immediately before the write — with no await
//      in between — a changed generation cancels the edit. Any switch counts,
//      so a round trip A → B → A while the edit waits cancels it too, where
//      rule 3 alone would let it through.
//   7. The blocker actions (VERM-98) — Add to Runway above a dependent, and
//      Move prerequisite above — follow rule 6 too, so a round trip A → B → A
//      while one waits cancels it. Each names the dependent by its stored ID,
//      and the store finds the dependent's position inside its transaction:
//      a dependent that moved still gets the row immediately above it, and
//      one that was removed leaves the Runway untouched. The add is refused
//      inside the gate when a row already holds the ticket under any of its
//      IDs — its readable key or its tracker ID.

import type {
  RunwayItemsAddIssueAboveArgs,
  RunwayItemsAddIssueArgs,
  RunwayItemsAddIssueAtNumberArgs,
  RunwayItemsAddStructuralArgs,
  RunwayItemsErrorCode,
  RunwayItemsItemArgs,
  RunwayItemsListArgs,
  RunwayItemsMoveAboveArgs,
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
  /**
   * The workspace-switch generation (activeWorkspaceGeneration): bumped on
   * every switch of the active workspace, including back to the same one.
   */
  generation: () => number;
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
  /** Add to Runway for an external blocker: immediately above its dependent (rule 7). */
  addIssueAbove(args: RunwayItemsAddIssueAboveArgs): Promise<RunwayItemsResult>;
  /** Move prerequisite above: immediately above its dependent (rule 7). */
  moveAbove(args: RunwayItemsMoveAboveArgs): Promise<RunwayItemsResult>;
  /**
   * Adds a ticket once (VERM-86), for an add that checked the ticket first:
   * not an IPC channel of its own. Inside the write gate, immediately before
   * the write, it refuses the add if `stillCurrent()` is false (the active
   * workspace was switched since the request began — any switch, including
   * a round trip back to the same workspace), or if a row already holds any
   * of `aliases` — every namespaced ID the ticket goes by (its readable key
   * and its YouTrack entity ID) — which keeps that row and its number.
   */
  addIssueOnce(args: RunwayItemsAddOnceArgs): Promise<RunwayItemsResult>;
}

export interface RunwayItemsAddOnceArgs {
  workspaceId: string;
  /** The ID the new row is stored under. */
  issueId: string;
  /** Every namespaced ID the ticket goes by, `issueId` included. */
  aliases: readonly string[];
  /** Add at this Runway #; absent means the end. */
  runwayNumber?: number;
  /** False once the request is stale: the active workspace was switched. */
  stillCurrent(): boolean;
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

  /**
   * Resolves the workspace for a write and runs `check` twice: once on
   * arrival, so a bad request is refused without waiting for the gate, and
   * again inside the gate immediately before the write, because a write can
   * wait there behind the import or other writes while the active workspace
   * is switched or the workspace's tracker changes.
   */
  function write<A>(
    check: ((tracker: TrackerKind, workspaceId: string, args: A) => void) | null,
    op: (store: RunwayItemStore, workspaceId: string, args: A) => RunwayItem[],
    { cancelOnSwitch = false }: { cancelOnSwitch?: boolean } = {},
  ) {
    const validate = async (workspaceId: string, args: A) => {
      const tracker = await resolve(workspaceId, true);
      check?.(tracker, workspaceId, args);
    };
    return async (args: A): Promise<RunwayItemsResult> => {
      // Captured on arrival, before anything is awaited (rule 6).
      const startGeneration = deps.generation();
      try {
        const workspaceId = workspaceIdOf(args);
        await validate(workspaceId, args);
        const items = await deps.gate.run(async () => {
          await validate(workspaceId, args);
          // After the last await, immediately before the write: nothing can
          // switch the workspace between this check and the store call.
          if (cancelOnSwitch && deps.generation() !== startGeneration) {
            throw new Refusal('cancelled', 'The edit was cancelled because the active workspace was switched while it was waiting.');
          }
          return op(deps.store(), workspaceId, args);
        });
        return { ok: true, items };
      } catch (err) {
        return failure(err);
      }
    };
  }

  /** Remove and the Moves: cancelled by any workspace switch while they wait (rule 6). */
  const edit = { cancelOnSwitch: true };

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
    remove: write<RunwayItemsItemArgs>(null, (s, ws, a) => s.remove(ws, a.itemId), edit),
    move: write<RunwayItemsMoveArgs>(null, (s, ws, a) => s.move(ws, a.itemId, a.position), edit),
    moveToNumber: write<RunwayItemsMoveToNumberArgs>(null, (s, ws, a) => s.moveToNumber(ws, a.itemId, a.runwayNumber), edit),
    moveUp: write<RunwayItemsItemArgs>(null, (s, ws, a) => s.moveUp(ws, a.itemId), edit),
    moveDown: write<RunwayItemsItemArgs>(null, (s, ws, a) => s.moveDown(ws, a.itemId), edit),
    addIssueAbove: write<RunwayItemsAddIssueAboveArgs>(
      (tracker, ws, a) => {
        if (!Array.isArray(a.aliases) || typeof a.dependentItemId !== 'string') {
          throw new Refusal('invalid-args', 'Add above needs the ticket\'s IDs and its dependent\'s row');
        }
        for (const id of [a.issueId, ...a.aliases]) refuseTicket(tracker, ws, id);
      },
      (s, ws, a) => s.addIssueAbove(ws, a.issueId, a.dependentItemId, a.aliases),
      edit,
    ),
    moveAbove: write<RunwayItemsMoveAboveArgs>(
      (_tracker, _ws, a) => {
        if (typeof a.itemId !== 'string' || typeof a.dependentItemId !== 'string') {
          throw new Refusal('invalid-args', 'Move above needs the row and its dependent\'s row');
        }
      },
      (s, ws, a) => s.moveAbove(ws, a.itemId, a.dependentItemId),
      edit,
    ),

    async addIssueOnce(args) {
      const cancelled = () => new Refusal('cancelled', 'The add was cancelled because the active workspace was switched while the ticket was being checked.');
      try {
        const workspaceId = workspaceIdOf(args);
        const check = async () => {
          if (!args.stillCurrent()) throw cancelled();
          refuseTicket(await resolve(workspaceId, true), workspaceId, args.issueId);
        };
        await check();
        const items = await deps.gate.run(async () => {
          // Inside the gate, immediately before the write: the request may
          // have waited here behind the import or other writes.
          await check();
          const store = deps.store();
          const aliases = new Set(args.aliases);
          const existing = store.list(workspaceId).find((item) => item.kind === 'issue' && aliases.has(item.itemId));
          if (existing) {
            const key = args.issueId.slice(args.issueId.indexOf(':') + 1);
            throw new Refusal('already-on-runway', `${key} is already on this Runway as #${existing.runwayNumber}.`);
          }
          return args.runwayNumber === undefined
            ? store.addIssue(workspaceId, args.issueId)
            : store.addIssueAtNumber(workspaceId, args.issueId, args.runwayNumber);
        });
        return { ok: true, items };
      } catch (err) {
        return failure(err);
      }
    },
  };
}
