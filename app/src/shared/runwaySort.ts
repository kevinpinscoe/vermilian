// The All tasks sorts (VERM-91): Runway #, tracker priority and ticket ID,
// each ascending or descending. Pure TypeScript — no Electron, no React — so
// the rules run under vitest; VERM-92 puts them behind the sort control.
//
//   Runway #         By Runway position. Tickets with no position come last
//                    in both directions, among themselves by ticket ID
//                    ascending.
//   Tracker priority The tracker's own order, never alphabetical, over the
//                    whole list. Ascending is the order the tracker lists,
//                    most urgent first. Each ticket ranks by its position in
//                    its own project's order (YouTrack's one Priority bundle;
//                    each Jira project's scheme from editmeta), so DEMO
//                    "Highest" and OPS "P1" share rank 1. A value its order
//                    does not list — a scheme changed since it was read, or a
//                    project whose order is unknown — ranks after every listed
//                    rank, and flips with the direction. A missing priority is
//                    last in both directions.
//   Ticket ID        Plain text order of the displayed key, code unit by code
//                    unit, with no numeric awareness: OPS-4089 < OPS-956 <
//                    OPS-96. Never localeCompare (jiraBoard.ts's numeric
//                    compare is deliberately not reused).
//
// Every sort breaks ties by ticket ID ascending, whatever its direction, so
// the order is fully deterministic. Sorting reads only: it never writes a
// Runway position or a tracker field.

import type { PriorityOrder } from './priority';

export type RunwaySortKey = 'runwayNumber' | 'priority' | 'ticketId';
export type SortDirection = 'asc' | 'desc';

export interface RunwaySort {
  key: RunwaySortKey;
  direction: SortDirection;
}

/** What the sorts read of a ticket. */
export interface SortableTicket {
  /** The displayed key (idReadable). */
  key: string;
  /** Its Runway # on the active workspace's Runway; null when it has none. */
  runwayNumber: number | null;
  /** Its priority value; null or '' when it has none. */
  priority: string | null;
  /** Its own project's priority order, most urgent first; null when unknown. */
  priorityOrder: PriorityOrder | null;
}

/** Code unit by code unit; no locale, no numeric awareness. */
export function compareTicketIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A ticket's place under the priority sort, before the direction: its index
 * in its own order, `order.length`-or-more for a value the order does not
 * list (Infinity when the order is unknown), or null for no priority.
 */
export function priorityRank(priority: string | null | undefined, order: PriorityOrder | null): number | null {
  if (!priority) return null;
  const idx = order ? order.indexOf(priority) : -1;
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

/**
 * Compares two values where null means "has none": nulls last in both
 * directions; otherwise ascending or descending.
 */
function compareNullsLast(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
  if (a === b) return 0;
  const d = a < b ? -1 : 1;
  return direction === 'asc' ? d : -d;
}

/** The comparator for `sort`, ties broken by ticket ID ascending. */
export function runwaySortComparator(sort: RunwaySort): (a: SortableTicket, b: SortableTicket) => number {
  return (a, b) => {
    let d = 0;
    switch (sort.key) {
      case 'runwayNumber':
        d = compareNullsLast(a.runwayNumber, b.runwayNumber, sort.direction);
        break;
      case 'priority':
        d = compareNullsLast(priorityRank(a.priority, a.priorityOrder), priorityRank(b.priority, b.priorityOrder), sort.direction);
        break;
      case 'ticketId': {
        const c = compareTicketIds(a.key, b.key);
        return sort.direction === 'asc' ? c : -c;
      }
    }
    return d !== 0 ? d : compareTicketIds(a.key, b.key);
  };
}

/** A sorted copy of `items`; `ticketOf` gives what the sort reads of each. */
export function sortByRunwaySort<T>(items: readonly T[], sort: RunwaySort, ticketOf: (item: T) => SortableTicket): T[] {
  const compare = runwaySortComparator(sort);
  return items
    .map((item) => ({ item, ticket: ticketOf(item) }))
    .sort((x, y) => compare(x.ticket, y.ticket))
    .map((x) => x.item);
}
