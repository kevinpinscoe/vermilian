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
//                    "Highest" and OPS "P1" share rank 1. Only known ranks
//                    follow the direction. A priority whose rank is unknown —
//                    a value its order does not list (a scheme changed since
//                    it was read), or a project whose order is unknown — comes
//                    after every ranked ticket in both directions, and a
//                    missing priority after those.
//   Ticket ID        The project prefix as text (code unit by code unit, no
//                    locale), then the final number numerically: VERM-90 <
//                    VERM-101 and OPS-96 < OPS-956 < OPS-4089. Descending
//                    reverses it. (jiraBoard.ts's localeCompare is not reused:
//                    its order depends on the locale.)
//
// Runway # and tracker priority break ties by that same ascending ticket ID
// order, even when they are descending, so the order is fully deterministic.
// Sorting reads only: it never writes a Runway position or a tracker field.

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

/** Text order, code unit by code unit, with no locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Splits a ticket key into its project prefix and final number: `OPS-956`
 * gives `OPS-` and 956. A key with no final number is all prefix.
 */
function splitTicketId(key: string): { prefix: string; number: bigint | null } {
  const m = /^(.*?)(\d+)$/.exec(key);
  return m ? { prefix: m[1], number: BigInt(m[2]) } : { prefix: key, number: null };
}

/**
 * Ascending ticket ID order: the project prefix as text, then the final
 * number numerically (VERM-90 < VERM-101; OPS-96 < OPS-956 < OPS-4089). A key
 * with no number comes before the numbered keys of its prefix; keys equal by
 * both (OPS-007 and OPS-7) fall back to plain text, so distinct keys never
 * compare equal.
 */
export function compareTicketIds(a: string, b: string): number {
  const x = splitTicketId(a);
  const y = splitTicketId(b);
  const p = compareText(x.prefix, y.prefix);
  if (p !== 0) return p;
  if (x.number !== y.number) {
    if (x.number === null) return -1;
    if (y.number === null) return 1;
    return x.number < y.number ? -1 : 1;
  }
  return compareText(a, b);
}

/** A ticket's place under the priority sort, before the direction. */
export type PriorityRank = number | 'unknown' | 'none';

/**
 * Its index in its own order (a known rank); 'unknown' for a value the order
 * does not list, or when the order is unknown; 'none' for no priority.
 */
export function priorityRank(priority: string | null | undefined, order: PriorityOrder | null): PriorityRank {
  if (!priority) return 'none';
  const idx = order ? order.indexOf(priority) : -1;
  return idx === -1 ? 'unknown' : idx;
}

/**
 * Only known numbers follow the direction: they come first, ascending or
 * descending; then 'unknown'; then 'none' or null — in both directions.
 */
function compareRanked(a: PriorityRank | null, b: PriorityRank | null, direction: SortDirection): number {
  const tier = (v: PriorityRank | null) => (typeof v === 'number' ? 0 : v === 'unknown' ? 1 : 2);
  const t = tier(a) - tier(b);
  if (t !== 0) return t;
  if (typeof a !== 'number' || typeof b !== 'number' || a === b) return 0;
  const d = a < b ? -1 : 1;
  return direction === 'asc' ? d : -d;
}

/** The comparator for `sort`. Runway # and priority break ties by ascending ticket ID. */
export function runwaySortComparator(sort: RunwaySort): (a: SortableTicket, b: SortableTicket) => number {
  return (a, b) => {
    let d = 0;
    switch (sort.key) {
      case 'runwayNumber':
        d = compareRanked(a.runwayNumber, b.runwayNumber, sort.direction);
        break;
      case 'priority':
        d = compareRanked(priorityRank(a.priority, a.priorityOrder), priorityRank(b.priority, b.priorityOrder), sort.direction);
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
