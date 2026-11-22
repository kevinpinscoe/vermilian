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
// The visible Runway # counts tickets only (VERM-81): `runwayNumber` is
// computed in the list query, never stored, so a section or note never uses up
// a number and nothing has to be renumbered to keep it right. `position` stays
// the row's place in the Runway view; `addIssueAtNumber` and `moveToNumber`
// take a Runway # and translate it to a row position. Callers serialize writes
// through RunwayWriteGate (VERM-82).
//
// Section and note rows (VERM-81) carry text and a depth of 0..4; they are
// added at a row position like any other row and moved, moved up/down and
// removed by their `sec:` / `note:` item ID.
//
// A positive whole number past the end means "last": with five rows, moving a
// row to #99 puts it fifth and adding a ticket at #99 puts it sixth. Zero,
// negatives and fractions are refused.
//
// Adding a ticket writes this table only. It never changes a workspace's
// projects or folders and never writes to the tracker.
//
// No Electron import: callers pass the open database, so this runs under vitest.

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { decodeIssueId, type NamespacedIssueId } from '../../shared/tracker';

export type RunwayItemKind = 'issue' | 'section' | 'note';

export interface RunwayItem {
  workspaceId: string;
  /** Namespaced ticket ID (`yt:…`, `jira:…`), or `sec:`/`note:` + ID. */
  itemId: string;
  kind: RunwayItemKind;
  /** Stored row position, 1..N within the workspace, sections and notes included. */
  position: number;
  /** Runway #: 1..T counting ticket rows only; null for a section or note. */
  runwayNumber: number | null;
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
  | 'invalid-workspace' // empty workspace ID
  | 'invalid-depth' // section/note: depth is not a whole number 0..4
  | 'invalid-text' // section/note: empty or whitespace-only text
  | 'not-a-ticket'; // moveToNumber: the row is a section or note, which has no Runway #

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
  /**
   * Adds a ticket so that its Runway # is `runwayNumber` (default: the end of
   * the Runway). It goes immediately before the ticket that holds that number
   * now; past the last ticket it goes immediately after the last ticket, and
   * on a Runway with no tickets, at the end. Returns the new order.
   */
  addIssueAtNumber(workspaceId: string, issueId: NamespacedIssueId | string, runwayNumber?: number): RunwayItem[];
  /** Adds a section row at row `position` (default: the end). Returns the new order. */
  addSection(workspaceId: string, text: string, options?: StructuralRowOptions): RunwayItem[];
  /** Adds a note row at row `position` (default: the end). Returns the new order. */
  addNote(workspaceId: string, text: string, options?: StructuralRowOptions): RunwayItem[];
  /** Removes a row of any kind and closes the gap. Returns the new order. */
  remove(workspaceId: string, itemId: string): RunwayItem[];
  /** Moves a row of any kind to `position`. Returns the new order. */
  move(workspaceId: string, itemId: string, position: number): RunwayItem[];
  /**
   * Moves a ticket so that its Runway # becomes `runwayNumber` (past the end:
   * last). Moving up, it goes immediately before the ticket that held that
   * number; moving down, immediately after the ticket that will precede it.
   * Section and note rows keep their places. Returns the new order.
   */
  moveToNumber(workspaceId: string, itemId: string, runwayNumber: number): RunwayItem[];
  /** Swaps a row with the one above; the first row stays put. */
  moveUp(workspaceId: string, itemId: string): RunwayItem[];
  /** Swaps a row with the one below; the last row stays put. */
  moveDown(workspaceId: string, itemId: string): RunwayItem[];
}

export interface StructuralRowOptions {
  /** Indent level, 0..4 (default 0). */
  depth?: number;
  /** Row position, sections and notes included (default: the end). */
  position?: number;
}

/** Deepest indent a row may have: the CHECK on runway_item.depth. */
export const RUNWAY_MAX_DEPTH = 4;

interface ItemRow {
  item_id: string;
  kind: RunwayItemKind;
  position: number;
  runway_number: number | null;
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
    runwayNumber: row.runway_number === null ? null : Number(row.runway_number),
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

function requireDepth(depth: number): void {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > RUNWAY_MAX_DEPTH) {
    throw new RunwayItemStoreError(
      'invalid-depth',
      `Runway row depth must be a whole number 0..${RUNWAY_MAX_DEPTH}, got ${String(depth)}`,
    );
  }
}

function requireText(text: string): void {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new RunwayItemStoreError('invalid-text', 'A section or note needs some text');
  }
}

/** One row to insert as part of a mutation. */
interface NewRow {
  id: string;
  kind: RunwayItemKind;
  depth: number;
  text: string | null;
}

function requireTicketId(issueId: string): void {
  const kind = decodeIssueId(issueId)?.kind;
  if (kind !== 'youtrack' && kind !== 'jira') {
    throw new RunwayItemStoreError('invalid-issue-id', `Not a YouTrack or Jira ticket ID: ${JSON.stringify(issueId)}`);
  }
}

export function createRunwayItemStore(
  db: DatabaseSync,
  now: () => Date = () => new Date(),
  newId: () => string = randomUUID,
): RunwayItemStore {
  // The Runway # is a running count of ticket rows in position order, taken
  // after the WHERE, so it is per workspace; sections and notes get NULL.
  const selectAll = db.prepare(
    `SELECT item_id, kind, position,
            CASE WHEN kind = 'issue' THEN
              SUM(CASE WHEN kind = 'issue' THEN 1 ELSE 0 END)
                OVER (ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
            END AS runway_number,
            depth, text, added_at, updated_at
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const remove = db.prepare(`DELETE FROM runway_item WHERE workspace_id = ? AND item_id = ?`);

  const rows = (workspaceId: string) => selectAll.all(workspaceId) as unknown as ItemRow[];

  /**
   * Runs `plan` on the workspace's current order inside one transaction and
   * writes the order it returns. `plan` returns the new item-ID order and may
   * name one new row to insert, or return null to leave everything as is.
   */
  function mutate(
    workspaceId: string,
    plan: (current: ItemRow[]) => { order: string[]; added?: NewRow; removed?: string } | null,
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
          .filter(({ id, position }) => id !== next.added?.id && stored.get(id) !== position);
        // Clear of both the old and the new range.
        const offset = Math.max(current.length, next.order.length) + 1;
        for (const { id } of changed) lift.run(offset, workspaceId, id);
        for (const { id, position } of changed) place.run(position, stamp, workspaceId, id);
        if (next.added !== undefined) {
          const { id, kind, depth, text } = next.added;
          insert.run(workspaceId, id, kind, next.order.indexOf(id) + 1, depth, text, stamp, stamp);
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

  function refuseDuplicate(workspaceId: string, current: ItemRow[], issueId: string): void {
    if (current.some((r) => r.item_id === issueId)) {
      throw new RunwayItemStoreError('already-on-runway', `${issueId} is already on workspace ${workspaceId}'s Runway`);
    }
  }

  const ticketRow = (id: string): NewRow => ({ id, kind: 'issue', depth: 0, text: null });

  function addStructural(
    workspaceId: string,
    kind: 'section' | 'note',
    text: string,
    options: StructuralRowOptions = {},
  ): RunwayItem[] {
    requireText(text);
    const depth = options.depth ?? 0;
    requireDepth(depth);
    if (options.position !== undefined) requirePosition(options.position);
    const id = `${kind === 'section' ? 'sec' : 'note'}:${newId()}`;
    return mutate(workspaceId, (current) => {
      const order = current.map((r) => r.item_id);
      const at = Math.min(options.position ?? order.length + 1, order.length + 1);
      order.splice(at - 1, 0, id);
      return { order, added: { id, kind, depth, text } };
    });
  }

  const store: RunwayItemStore = {
    list(workspaceId) {
      return rows(workspaceId).map((r) => toItem(workspaceId, r));
    },

    addIssue(workspaceId, issueId, position) {
      requireTicketId(issueId);
      if (position !== undefined) requirePosition(position);
      return mutate(workspaceId, (current) => {
        refuseDuplicate(workspaceId, current, issueId);
        const order = current.map((r) => r.item_id);
        const at = Math.min(position ?? order.length + 1, order.length + 1);
        order.splice(at - 1, 0, issueId);
        return { order, added: ticketRow(issueId) };
      });
    },

    addIssueAtNumber(workspaceId, issueId, runwayNumber) {
      requireTicketId(issueId);
      if (runwayNumber !== undefined) requirePosition(runwayNumber);
      return mutate(workspaceId, (current) => {
        refuseDuplicate(workspaceId, current, issueId);
        const order = current.map((r) => r.item_id);
        const tickets = current.filter((r) => r.kind === 'issue').map((r) => r.item_id);
        let at: number; // 0-based insertion index
        if (runwayNumber !== undefined && runwayNumber <= tickets.length) {
          at = order.indexOf(tickets[runwayNumber - 1]);
        } else if (runwayNumber !== undefined && tickets.length > 0) {
          at = order.indexOf(tickets[tickets.length - 1]) + 1;
        } else {
          at = order.length;
        }
        order.splice(at, 0, issueId);
        return { order, added: ticketRow(issueId) };
      });
    },

    addSection(workspaceId, text, options) {
      return addStructural(workspaceId, 'section', text, options);
    },

    addNote(workspaceId, text, options) {
      return addStructural(workspaceId, 'note', text, options);
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

    moveToNumber(workspaceId, itemId, runwayNumber) {
      requirePosition(runwayNumber);
      return mutate(workspaceId, (current) => {
        const from = indexOrThrow(workspaceId, current, itemId);
        if (current[from].kind !== 'issue') {
          throw new RunwayItemStoreError('not-a-ticket', `${itemId} is a ${current[from].kind}, which has no Runway #`);
        }
        const tickets = current.filter((r) => r.kind === 'issue').map((r) => r.item_id);
        const was = tickets.indexOf(itemId) + 1;
        const target = Math.min(runwayNumber, tickets.length);
        if (target === was) return null;
        const order = current.map((r) => r.item_id);
        order.splice(from, 1);
        const others = tickets.filter((id) => id !== itemId);
        // Up: before the ticket that held the number. Down: after the one that will precede it.
        const at = target < was ? order.indexOf(others[target - 1]) : order.indexOf(others[target - 2]) + 1;
        order.splice(at, 0, itemId);
        return { order };
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
