// Workspace Runway order store (VERM-80): the `runway_item` table added by
// schema v2 (runwayDb.ts, VERM-78).
//
// Each workspace's rows are numbered 1..N by `position`, with no gaps and no
// duplicates. Every mutation is one `BEGIN IMMEDIATE` transaction that
// computes the new order in memory and renumbers the workspace, so the order
// is dense again when it commits — and a failure part-way rolls back to the
// order it started from. `updated_at` changes only on rows whose final
// position differs from their stored one, so a no-op (moving the first row up,
// the last row down, or a row to where it already is) writes nothing; the
// snapshot import's "newer local changes" warning (VERM-79) reads that column.
//
// Positions here are *stored row positions*, counting section and note rows.
// The visible Runway # counts tickets only; translating between the two is
// VERM-81. Callers serialize writes through RunwayWriteGate (VERM-82).
//
// A positive whole number past the end means "last": with five rows, moving a
// row to #99 puts it fifth and adding a ticket at #99 puts it sixth. Zero,
// negatives and fractions are refused.
//
// Adding a ticket writes this table only. It never changes a workspace's
// projects or folders and never writes to the tracker.
//
// No Electron import: callers pass the open database, so this runs under vitest.

import type { DatabaseSync } from 'node:sqlite';
import { decodeIssueId, type NamespacedIssueId } from '../../shared/tracker';

export type RunwayItemKind = 'issue' | 'section' | 'note';

export interface RunwayItem {
  workspaceId: string;
  /** Namespaced ticket ID (`yt:…`, `jira:…`), or `sec:`/`note:` + ID. */
  itemId: string;
  kind: RunwayItemKind;
  /** Stored row position, 1..N within the workspace. */
  position: number;
  depth: number;
  /** Section title or note body; null for a ticket. */
  text: string | null;
  /** ISO 8601. */
  addedAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

export type RunwayItemStoreErrorCode =
  | 'already-on-runway' // add: the ticket is already on this workspace's Runway
  | 'not-on-runway' // remove/move: no such row on this workspace's Runway
  | 'invalid-position' // not a positive whole number
  | 'invalid-issue-id' // add: not a namespaced YouTrack or Jira ticket ID
  | 'invalid-workspace'; // empty workspace ID

export class RunwayItemStoreError extends Error {
  constructor(
    readonly code: RunwayItemStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunwayItemStoreError';
  }
}

export interface RunwayItemStore {
  /** The workspace's rows in position order. Read-only. */
  list(workspaceId: string): RunwayItem[];
  /** Adds a ticket at `position` (default: the end). Returns the new order. */
  addIssue(workspaceId: string, issueId: NamespacedIssueId | string, position?: number): RunwayItem[];
  /** Removes a row of any kind and closes the gap. Returns the new order. */
  remove(workspaceId: string, itemId: string): RunwayItem[];
  /** Moves a row of any kind to `position`. Returns the new order. */
  move(workspaceId: string, itemId: string, position: number): RunwayItem[];
  /** Swaps a row with the one above; the first row stays put. */
  moveUp(workspaceId: string, itemId: string): RunwayItem[];
  /** Swaps a row with the one below; the last row stays put. */
  moveDown(workspaceId: string, itemId: string): RunwayItem[];
}

interface ItemRow {
  item_id: string;
  kind: RunwayItemKind;
  position: number;
  depth: number;
  text: string | null;
  added_at: string;
  updated_at: string;
}

function toItem(workspaceId: string, row: ItemRow): RunwayItem {
  return {
    workspaceId,
    itemId: row.item_id,
    kind: row.kind,
    position: Number(row.position),
    depth: Number(row.depth),
    text: row.text,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  };
}

function requireWorkspace(workspaceId: string): void {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new RunwayItemStoreError('invalid-workspace', 'Workspace ID must be a non-empty string');
  }
}

function requirePosition(position: number): void {
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new RunwayItemStoreError(
      'invalid-position',
      `Runway position must be a positive whole number, got ${String(position)}`,
    );
  }
}

function requireTicketId(issueId: string): void {
  const kind = decodeIssueId(issueId)?.kind;
  if (kind !== 'youtrack' && kind !== 'jira') {
    throw new RunwayItemStoreError('invalid-issue-id', `Not a YouTrack or Jira ticket ID: ${JSON.stringify(issueId)}`);
  }
}

export function createRunwayItemStore(db: DatabaseSync, now: () => Date = () => new Date()): RunwayItemStore {
  const selectAll = db.prepare(
    `SELECT item_id, kind, position, depth, text, added_at, updated_at
     FROM runway_item WHERE workspace_id = ? ORDER BY position`,
  );
  // Phase 1 of a renumber: lifts a row clear of every final position, so the
  // UNIQUE (workspace_id, position) index never sees two rows on one number.
  const lift = db.prepare(
    `UPDATE runway_item SET position = position + ? WHERE workspace_id = ? AND item_id = ?`,
  );
  // Phase 2: the row's final position.
  const place = db.prepare(
    `UPDATE runway_item SET position = ?, updated_at = ? WHERE workspace_id = ? AND item_id = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO runway_item (workspace_id, item_id, kind, position, depth, text, added_at, updated_at)
     VALUES (?, ?, 'issue', ?, 0, NULL, ?, ?)`,
  );
  const remove = db.prepare(`DELETE FROM runway_item WHERE workspace_id = ? AND item_id = ?`);

  const rows = (workspaceId: string) => selectAll.all(workspaceId) as unknown as ItemRow[];

  /**
   * Runs `plan` on the workspace's current order inside one transaction and
   * writes the order it returns. `plan` returns the new item-ID order and may
   * name one new ticket to insert, or return null to leave everything as is.
   */
  function mutate(
    workspaceId: string,
    plan: (current: ItemRow[]) => { order: string[]; added?: string; removed?: string } | null,
  ): RunwayItem[] {
    requireWorkspace(workspaceId);
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = rows(workspaceId);
      const next = plan(current);
      if (next) {
        const stamp = now().toISOString();
        if (next.removed !== undefined) remove.run(workspaceId, next.removed);
        const stored = new Map(current.map((r) => [r.item_id, Number(r.position)]));
        const changed = next.order
          .map((id, i) => ({ id, position: i + 1 }))
          .filter(({ id, position }) => id !== next.added && stored.get(id) !== position);
        // Clear of both the old and the new range.
        const offset = Math.max(current.length, next.order.length) + 1;
        for (const { id } of changed) lift.run(offset, workspaceId, id);
        for (const { id, position } of changed) place.run(position, stamp, workspaceId, id);
        if (next.added !== undefined) {
          insert.run(workspaceId, next.added, next.order.indexOf(next.added) + 1, stamp, stamp);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return rows(workspaceId).map((r) => toItem(workspaceId, r));
  }

  function indexOrThrow(workspaceId: string, current: ItemRow[], itemId: string): number {
    const index = current.findIndex((r) => r.item_id === itemId);
    if (index < 0) {
      throw new RunwayItemStoreError('not-on-runway', `${itemId} is not on workspace ${workspaceId}'s Runway`);
    }
    return index;
  }

  /** The new order with the row at `from` moved to 0-based `to`, or null if it stays. */
  function reorder(current: ItemRow[], from: number, to: number) {
    if (from === to) return null;
    const order = current.map((r) => r.item_id);
    const [id] = order.splice(from, 1);
    order.splice(to, 0, id);
    return { order };
  }

  const store: RunwayItemStore = {
    list(workspaceId) {
      return rows(workspaceId).map((r) => toItem(workspaceId, r));
    },

    addIssue(workspaceId, issueId, position) {
      requireTicketId(issueId);
      if (position !== undefined) requirePosition(position);
      return mutate(workspaceId, (current) => {
        if (current.some((r) => r.item_id === issueId)) {
          throw new RunwayItemStoreError('already-on-runway', `${issueId} is already on workspace ${workspaceId}'s Runway`);
        }
        const order = current.map((r) => r.item_id);
        const at = Math.min(position ?? order.length + 1, order.length + 1);
        order.splice(at - 1, 0, issueId);
        return { order, added: issueId };
      });
    },

    remove(workspaceId, itemId) {
      return mutate(workspaceId, (current) => {
        const index = indexOrThrow(workspaceId, current, itemId);
        const order = current.map((r) => r.item_id);
        order.splice(index, 1);
        return { order, removed: itemId };
      });
    },

    move(workspaceId, itemId, position) {
      requirePosition(position);
      return mutate(workspaceId, (current) => {
        const from = indexOrThrow(workspaceId, current, itemId);
        return reorder(current, from, Math.min(position, current.length) - 1);
      });
    },

    moveUp(workspaceId, itemId) {
      return mutate(workspaceId, (current) => {
        const from = indexOrThrow(workspaceId, current, itemId);
        return reorder(current, from, Math.max(from - 1, 0));
      });
    },

    moveDown(workspaceId, itemId) {
      return mutate(workspaceId, (current) => {
        const from = indexOrThrow(workspaceId, current, itemId);
        return reorder(current, from, Math.min(from + 1, current.length - 1));
      });
    },
  };
  return store;
}
