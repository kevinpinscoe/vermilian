// The Runway view's rows (VERM-85): the saved order from runwayItemsList,
// joined with each ticket's tracker read from runwayItemsResolve (VERM-84).
// Pure — no React, no IPC — so the rules run under vitest.
//
// Every stored row is shown, in stored order, whatever its tracker says:
// sections and notes as they were saved, and a ticket that did not resolve
// in its place with its Runway # and the reason it shows no details.

import { decodeIssueId, encodeIssueId, isValidLocalId, type TrackerKind } from '../../../shared/tracker';
import type { RunwayItem } from '../../../shared/runwayItem';
import type { RunwayTicketRead } from '../../../shared/runwayTicket';
import type { BoardIssue } from '../../../shared/workspace';

/**
 * A ticket row's display state: a tracker read state, 'loading' while the
 * first read is in flight, or 'not-refreshed' when the whole read failed.
 */
export type RunwayTicketDisplayState = RunwayTicketRead['state'] | 'loading' | 'not-refreshed';

export type RunwayRow =
  | { kind: 'section' | 'note'; itemId: string; depth: number; text: string }
  | {
      kind: 'ticket';
      itemId: string;
      depth: number;
      /** Runway #: 1..T over ticket rows only. */
      runwayNumber: number;
      /**
       * The ID shown: once resolved, the key the tracker answered with
       * (issue.idReadable — READ-12, even for a row stored under a YouTrack
       * entity ID such as 2-45, or a moved Jira ticket's new key); until then,
       * the stored ID, which is all there is.
       */
      ticketId: string;
      state: RunwayTicketDisplayState;
      /** Present only when state is 'resolved'. */
      issue: BoardIssue | null;
      /** Why the row shows no details; null when resolved or loading. */
      reason: string | null;
    };

const MISSING_OR_UNREADABLE =
  'Missing or not readable: the tracker answered 404, so the ticket was deleted or this workspace’s credential cannot see it.';
const MISSING = 'Missing: the tracker says this ticket is gone.';

function readReason(read: RunwayTicketRead): string | null {
  switch (read.state) {
    case 'resolved':
      return null;
    case 'missing-or-unreadable':
      return MISSING_OR_UNREADABLE;
    case 'not-readable':
      return `Not readable with this workspace’s credential${read.reason ? `: ${read.reason}` : '.'}`;
    case 'missing':
      return MISSING;
    case 'wrong-tracker':
      return `Wrong tracker: ${read.reason}`;
  }
}

/**
 * The view's rows. `reads` is null while the tracker read has not answered;
 * `readError` is the whole read's error, when it failed.
 */
export function buildRunwayRows(
  items: readonly RunwayItem[],
  reads: readonly RunwayTicketRead[] | null,
  readError: string | null = null,
): RunwayRow[] {
  const byItem = new Map((reads ?? []).map((r) => [r.itemId, r]));
  const ordered = [...items].sort((a, b) => a.position - b.position);
  let runwayNumber = 0;
  return ordered.map((item): RunwayRow => {
    if (item.kind !== 'issue') {
      return { kind: item.kind, itemId: item.itemId, depth: item.depth, text: item.text ?? '' };
    }
    runwayNumber += 1;
    const ticketId = decodeIssueId(item.itemId)?.localId ?? item.itemId;
    const base = { kind: 'ticket' as const, itemId: item.itemId, depth: item.depth, runwayNumber, ticketId };
    if (readError !== null) {
      return { ...base, state: 'not-refreshed', issue: null, reason: `Not refreshed: ${readError}` };
    }
    const read = byItem.get(item.itemId);
    if (!read) return { ...base, state: 'loading', issue: null, reason: null };
    if (read.state === 'resolved') return { ...base, ticketId: read.issue.idReadable, state: 'resolved', issue: read.issue, reason: null };
    return { ...base, state: read.state, issue: null, reason: readReason(read) };
  });
}

/** Short badge text per display state; null for a resolved ticket. */
export function ticketStateBadge(state: RunwayTicketDisplayState): string | null {
  switch (state) {
    case 'resolved':
      return null;
    case 'loading':
      return 'Loading…';
    case 'missing-or-unreadable':
      return 'Missing or not readable';
    case 'not-readable':
      return 'Not readable';
    case 'missing':
      return 'Missing';
    case 'wrong-tracker':
      return 'Wrong tracker';
    case 'not-refreshed':
      return 'Not refreshed';
  }
}

/**
 * The Jira keys on a Runway: the detail panel opens for these as well as for
 * the workspace's projects and boards, matching the main process's admission
 * rule (VERM-83).
 */
export function jiraRunwayKeys(items: readonly RunwayItem[] | null | undefined): string[] {
  return (items ?? []).flatMap((item) => {
    if (item.kind !== 'issue') return [];
    const decoded = decodeIssueId(item.itemId);
    return decoded?.kind === 'jira' ? [decoded.localId] : [];
  });
}

/**
 * The Runway # typed in the Add box's "at #" field (VERM-86): undefined when
 * empty (add at the end), null when it is not a whole number of 1 or more.
 */
export function parseRunwayNumber(text: string): number | undefined | null {
  const t = text.trim();
  if (t === '') return undefined;
  return /^[0-9]+$/.test(t) && Number(t) >= 1 ? Number(t) : null;
}

// ── Row actions (VERM-87) ──────────────────────────────────────────────────

const PROMPT_TEXT_MAX = 80;

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > PROMPT_TEXT_MAX ? `${t.slice(0, PROMPT_TEXT_MAX - 1)}…` : t;
}

/**
 * The inline Remove confirmation for a row: the ticket's key, or a heading's
 * or note's own text, so the row being removed is unmistakable.
 */
export function removePrompt(row: RunwayRow): string {
  if (row.kind === 'ticket') return `Remove ${row.ticketId} from this Runway?`;
  const what = row.kind === 'section' ? 'heading' : 'note';
  return `Remove the ${what} “${clip(row.text)}” from this Runway?`;
}

/**
 * Where a drag of `activeId` dropped on `overId` puts it: the 1-based row
 * position (sections and notes included) for runwayItemsMove, which takes
 * the row out and puts it back at that position — so it lands where `overId`
 * was. Null when the drop changes nothing or names a row that is not there.
 */
export function dropPosition(rows: readonly Pick<RunwayRow, 'itemId'>[], activeId: string, overId: string | null): number | null {
  if (overId === null || overId === activeId) return null;
  const from = rows.findIndex((r) => r.itemId === activeId);
  const to = rows.findIndex((r) => r.itemId === overId);
  return from < 0 || to < 0 ? null : to + 1;
}

/**
 * The stored rows with `itemId` moved to row `position` (as the store does
 * it), renumbered 1..N and, over tickets only, 1..T. Shown while the move is
 * being written, so a dropped row does not jump back for a moment; the
 * store's answer then replaces it.
 */
export function movedItems(items: readonly RunwayItem[], itemId: string, position: number): RunwayItem[] {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const from = ordered.findIndex((i) => i.itemId === itemId);
  if (from < 0) return ordered;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(Math.min(Math.max(position, 1), ordered.length + 1) - 1, 0, moved);
  let runwayNumber = 0;
  return ordered.map((item, i) => ({
    ...item,
    position: i + 1,
    runwayNumber: item.kind === 'issue' ? ++runwayNumber : null,
  }));
}

// ── The ticket detail panel's Runway # control (VERM-88) ────────────────────

/** A ticket as the detail panel knows it: every ID it goes by. */
export interface PanelTicket {
  tracker: TrackerKind;
  /**
   * Its readable keys: the key the tracker answered with and, for Jira, the
   * key the panel was opened by (a moved ticket's old key).
   */
  keys: readonly string[];
  /** The YouTrack entity ID (2-45); null when unknown or for Jira. */
  entityId: string | null;
}

/** Every namespaced ID the panel's ticket goes by, invalid ones dropped. */
export function panelTicketIds(ticket: PanelTicket): string[] {
  const local = [...ticket.keys, ...(ticket.entityId ? [ticket.entityId] : [])];
  return [...new Set(local.filter((id) => id && isValidLocalId(ticket.tracker, id)).map((id) => encodeIssueId(ticket.tracker, id)))];
}

/** The panel ticket's Runway row: its stored ID, which Move and Remove use. */
export interface PanelRunwayRow {
  itemId: string;
  runwayNumber: number;
}

/**
 * The saved Runway row that holds the panel's ticket, or null when none
 * does. A row matches when its stored ID is any ID the ticket goes by (a
 * YouTrack ticket saved under its entity ID included), or when the tracker
 * read of that row resolved to this ticket — which is how a Jira ticket
 * saved under a key it has since moved from is found.
 */
export function panelRunwayRow(
  items: readonly RunwayItem[],
  reads: readonly RunwayTicketRead[] | null,
  ticket: PanelTicket,
): PanelRunwayRow | null {
  const ids = new Set(panelTicketIds(ticket));
  const keys = new Set(ticket.keys);
  const resolvedHere = new Set(
    (reads ?? []).flatMap((r) =>
      r.state === 'resolved' && (keys.has(r.issue.idReadable) || (ticket.entityId !== null && r.issue.id === ticket.entityId))
        ? [r.itemId]
        : [],
    ),
  );
  for (const row of buildRunwayRows(items, null)) {
    if (row.kind === 'ticket' && (ids.has(row.itemId) || resolvedHere.has(row.itemId))) {
      return { itemId: row.itemId, runwayNumber: row.runwayNumber };
    }
  }
  return null;
}
