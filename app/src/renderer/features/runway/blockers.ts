// Blockers in the Runway view and All tasks (VERM-98): the VERM-97 engine
// (shared/blockerState.ts) applied to a workspace's Runway rows, and the two
// explicit actions it offers. Pure — no React, no IPC — so the rules run
// under vitest.
//
// Kevin's decisions (VERM-98, 2026-11-23):
//   - All tasks shows a badge beside Runway #, in the list and on Kanban
//     cards, only for Blocked or Unknown; the full reason on hover and focus.
//   - Add to Runway puts an external blocker immediately above its dependent;
//     every existing row keeps its relative order.
//   - Move prerequisite above moves the prerequisite immediately above its
//     dependent in one transaction; every other row keeps its relative order.
//   - Both name the dependent by its stored itemId and leave its position to
//     the main process, which reads it inside the transaction (Kevin's
//     review): a dependent that moved still gets the row above it, and one
//     that was removed leaves the Runway untouched.
//   - A refresh only re-reads tickets: nothing here ever writes on its own.

import {
  blockerStateOf,
  describeBlockerReport,
  type BlockerReport,
  type RunwayPlace,
} from '../../../shared/blockerState';
import { defaultPrerequisiteLinkTypes, type PrerequisiteLinkType } from '../../../shared/issueLink';
import { decodeIssueId, encodeIssueId, isValidLocalId, type TrackerKind } from '../../../shared/tracker';
import type { BoardIssue, Workspace } from '../../../shared/workspace';
import type { RunwayRow } from './rows';

/** The workspace's prerequisite link types: its own choice, else its tracker's default. */
export function prerequisiteTypesFor(
  workspace: Pick<Workspace, 'prerequisiteLinkTypes'> | null | undefined,
  tracker: TrackerKind,
): readonly PrerequisiteLinkType[] {
  return workspace?.prerequisiteLinkTypes ?? defaultPrerequisiteLinkTypes(tracker);
}

type TicketRow = Extract<RunwayRow, { kind: 'ticket' }>;

/** The Runway's ticket rows as the engine's places, read or not. */
export function runwayPlaces(rows: readonly RunwayRow[]): RunwayPlace[] {
  return rows
    .filter((r): r is TicketRow => r.kind === 'ticket')
    .map((r) => ({ localId: decodeIssueId(r.itemId)?.localId ?? r.ticketId, runwayNumber: r.runwayNumber, issue: r.issue }));
}

/**
 * The blocker report of every read ticket row, by itemId. A row the tracker
 * did not read has none: it shows its own state and reason instead.
 */
export function runwayBlockers(
  rows: readonly RunwayRow[],
  prerequisiteTypes: readonly PrerequisiteLinkType[],
): Map<string, BlockerReport> {
  const ctx = { prerequisiteTypes, runway: runwayPlaces(rows) };
  const out = new Map<string, BlockerReport>();
  for (const r of rows) {
    if (r.kind === 'ticket' && r.issue) out.set(r.itemId, blockerStateOf(r.issue, ctx));
  }
  return out;
}

/** A ticket's report against the Runway, for All tasks, where it may not be on the Runway itself. */
export function issueBlockers(
  issue: BoardIssue,
  rows: readonly RunwayRow[],
  prerequisiteTypes: readonly PrerequisiteLinkType[],
): BlockerReport {
  return blockerStateOf(issue, { prerequisiteTypes, runway: runwayPlaces(rows) });
}

export interface BlockerBadge {
  label: 'Blocked' | 'Unknown';
  /** The full reason, for hover and keyboard focus. */
  reason: string;
}

/** The All tasks badge: only for Blocked or Unknown; null otherwise. */
export function blockerBadge(report: BlockerReport | null | undefined): BlockerBadge | null {
  if (!report || (report.state !== 'blocked' && report.state !== 'unknown')) return null;
  return { label: report.state === 'blocked' ? 'Blocked' : 'Unknown', reason: describeBlockerReport(report) };
}

/** The Runway view's label for each state. */
export const BLOCKER_STATE_LABEL: Record<BlockerReport['state'], string> = {
  done: 'Done',
  blocked: 'Blocked',
  ready: 'Ready',
  unknown: 'Unknown',
};

/**
 * The ticket row on this Runway for a ticket key, or null. Matched by the
 * read key, the row's stored ID, or the linked ticket's entity ID — the same
 * identity the engine uses.
 */
export function rowForKey(rows: readonly RunwayRow[], key: string, entityId: string | null = null): TicketRow | null {
  for (const r of rows) {
    if (r.kind !== 'ticket') continue;
    const local = decodeIssueId(r.itemId)?.localId ?? r.ticketId;
    if (r.issue?.idReadable === key || local === key || (entityId !== null && (local === entityId || r.issue?.id === entityId))) return r;
  }
  return null;
}

/** The linked ticket's entity ID on `issue`'s links, for a prerequisite key; null when none. */
export function linkedEntityId(issue: BoardIssue, key: string): string | null {
  return issue.links?.find((l) => l.issue.key === key)?.issue.id ?? null;
}

/**
 * The namespaced ID to add an external blocker under: a YouTrack ticket by
 * its entity ID when the link carried one (as the Add box stores it), else
 * its readable key; a Jira ticket by its key. Null when neither is valid.
 */
export function blockerIssueId(tracker: TrackerKind, key: string, entityId: string | null): string | null {
  if (tracker === 'youtrack' && entityId && isValidLocalId('youtrack', entityId)) return encodeIssueId('youtrack', entityId);
  return isValidLocalId(tracker, key) ? encodeIssueId(tracker, key) : null;
}

/**
 * Every namespaced ID a blocker ticket goes by, the one it is added under
 * first: a YouTrack ticket by its entity ID (when the link carried a valid
 * one) and its readable key; a Jira ticket by its key. The write gate refuses
 * the add when a row already holds any of them.
 */
export function blockerAliases(tracker: TrackerKind, key: string, entityId: string | null): string[] {
  const out: string[] = [];
  const first = blockerIssueId(tracker, key, entityId);
  if (first) out.push(first);
  if (isValidLocalId(tracker, key)) out.push(encodeIssueId(tracker, key));
  return [...new Set(out)];
}
