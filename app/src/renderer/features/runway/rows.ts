// The Runway view's rows (VERM-85): the saved order from runwayItemsList,
// joined with each ticket's tracker read from runwayItemsResolve (VERM-84).
// Pure — no React, no IPC — so the rules run under vitest.
//
// Every stored row is shown, in stored order, whatever its tracker says:
// sections and notes as they were saved, and a ticket that did not resolve
// in its place with its Runway # and the reason it shows no details.

import { decodeIssueId } from '../../../shared/tracker';
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
