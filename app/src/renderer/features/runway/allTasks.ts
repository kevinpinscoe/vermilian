// All tasks with the workspace's Runway tickets (VERM-89): the project (or
// Jira board) issues, plus the tickets added to the Runway individually from
// outside them. Pure — no React, no IPC — so the rules run under vitest.
//
//   - A ticket appears once. One that is both in a project and on the Runway
//     keeps its project row; two Runway rows that read as the same ticket (a
//     Jira key it moved from) give one. Identity is the tracker's own: within
//     one workspace every ticket is on that workspace's tracker, so its key
//     (idReadable) and its entity ID (id) are each unique — the same identity
//     the namespaced IDs yt:/jira: encode.
//   - A resolved Runway ticket follows the view's Show closed / Show done
//     toggle, exactly as a resolved project ticket does. Those it hides are
//     counted, so the view can say why it is empty.
//   - Only resolved reads have ticket data. A Runway row that is missing, not
//     readable or not yet read is omitted here; the Runway view keeps it, with
//     its position and the reason. The unreadable ones are counted, so an
//     otherwise empty view can say so and send the user to the Runway.
//   - Only reads of rows still saved on the Runway count. The tracker reads
//     are cached apart from the saved order, so a removed row's read can
//     outlive it; filtering by the saved IDs drops it at once. A removed
//     ticket that is in a project still shows, through the project.

import type { RunwayTicketRead } from '../../../shared/runwayTicket';
import type { BoardIssue } from '../../../shared/workspace';

export interface RunwayAllTasks {
  /** Project issues first, as given, then the Runway's extra tickets in Runway order. */
  issues: BoardIssue[];
  /** The Runway extras within `issues`, by entity ID (their cache is the Runway's). */
  runwayOnlyIds: Set<string>;
  /** Runway extras the toggle hides because they are resolved. */
  hiddenResolved: number;
  /** Saved Runway tickets omitted because the tracker could not read them. */
  unreadable: number;
}

/** The saved ticket IDs of a Runway, or null while its rows are not known. */
export function savedRunwayTicketIds(
  items: readonly { kind: string; itemId: string }[] | null | undefined,
): Set<string> | null {
  if (!items) return null;
  return new Set(items.filter((i) => i.kind === 'issue').map((i) => i.itemId));
}

export function withRunwayTickets(
  projectIssues: readonly BoardIssue[],
  reads: readonly RunwayTicketRead[] | null | undefined,
  includeResolved: boolean,
  /** The IDs still saved on the Runway (savedRunwayTicketIds); null keeps every read. */
  savedTicketIds: ReadonlySet<string> | null = null,
): RunwayAllTasks {
  const issues = [...projectIssues];
  const seen = new Set<string>();
  for (const issue of projectIssues) {
    seen.add(`id:${issue.id}`);
    seen.add(`key:${issue.idReadable}`);
  }
  const runwayOnlyIds = new Set<string>();
  let hiddenResolved = 0;
  let unreadable = 0;
  for (const read of reads ?? []) {
    if (savedTicketIds && !savedTicketIds.has(read.itemId)) continue;
    if (read.state !== 'resolved') {
      // Not counted when its ID names a ticket a project already shows.
      const bare = read.itemId.replace(/^(yt|jira):/, '');
      if (!seen.has(`key:${bare}`) && !seen.has(`id:${bare}`)) unreadable += 1;
      continue;
    }
    const { issue } = read;
    if (seen.has(`id:${issue.id}`) || seen.has(`key:${issue.idReadable}`)) continue;
    seen.add(`id:${issue.id}`);
    seen.add(`key:${issue.idReadable}`);
    if (issue.resolved !== null && !includeResolved) {
      hiddenResolved += 1;
      continue;
    }
    issues.push(issue);
    runwayOnlyIds.add(issue.id);
  }
  return { issues, runwayOnlyIds, hiddenResolved, unreadable };
}

/** Whether the workspace's Runway holds any ticket (sections and notes do not count). */
export function runwayHasTickets(items: readonly { kind: string }[] | null | undefined): boolean {
  return (items ?? []).some((i) => i.kind === 'issue');
}

/** Shown when every ticket All tasks has is hidden by Show closed / Show done. */
export const ALL_HIDDEN_BY_FILTER = 'All tickets are hidden by the current filter';

/**
 * What an empty All tasks says when it has Runway tickets it cannot show
 * (VERM-89): resolved ones the toggle hides, unreadable ones, or a Runway
 * lookup that failed. Each reason is a line, and each comes with its way
 * out: the toggle for hidden tickets, Open Runway for the rest, where the
 * saved positions and the reasons are. Null when there is nothing to explain.
 */
export interface AllTasksEmptyNotice {
  lines: string[];
  /** Offer Show closed / Show done. */
  showToggle: boolean;
  /** Offer Open Runway. */
  openRunway: boolean;
}

export function allTasksEmptyNotice(args: {
  hiddenResolved: number;
  unreadable: number;
  /** The Runway's tickets could not be looked up at all. */
  lookupFailed: boolean;
  /** "closed" (YouTrack) or "Done" (Jira). */
  closedWord: string;
}): AllTasksEmptyNotice | null {
  const { hiddenResolved, unreadable, lookupFailed, closedWord } = args;
  const cannotRead = lookupFailed || unreadable > 0;
  if (hiddenResolved === 0 && !cannotRead) return null;
  const lines: string[] = [];
  if (hiddenResolved > 0) {
    lines.push(
      cannotRead
        ? `${hiddenResolved} ${closedWord} ${hiddenResolved === 1 ? 'ticket is' : 'tickets are'} hidden by the current filter.`
        : ALL_HIDDEN_BY_FILTER,
    );
  }
  if (lookupFailed) lines.push(RUNWAY_LOOKUP_FAILED);
  else if (unreadable > 0) {
    lines.push(`${unreadable} Runway ${unreadable === 1 ? 'ticket' : 'tickets'} could not be read. The Runway shows why.`);
  }
  return { lines, showToggle: hiddenResolved > 0, openRunway: cannotRead };
}

/** Shown when the Runway's tickets could not be looked up at all. */
export const RUNWAY_LOOKUP_FAILED = "This workspace's Runway tickets could not be looked up. The Runway shows why.";
