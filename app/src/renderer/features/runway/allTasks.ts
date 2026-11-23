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
//     its position and the reason.

import type { RunwayTicketRead } from '../../../shared/runwayTicket';
import type { BoardIssue } from '../../../shared/workspace';

export interface RunwayAllTasks {
  /** Project issues first, as given, then the Runway's extra tickets in Runway order. */
  issues: BoardIssue[];
  /** The Runway extras within `issues`, by entity ID (their cache is the Runway's). */
  runwayOnlyIds: Set<string>;
  /** Runway extras the toggle hides because they are resolved. */
  hiddenResolved: number;
}

export function withRunwayTickets(
  projectIssues: readonly BoardIssue[],
  reads: readonly RunwayTicketRead[] | null | undefined,
  includeResolved: boolean,
): RunwayAllTasks {
  const issues = [...projectIssues];
  const seen = new Set<string>();
  for (const issue of projectIssues) {
    seen.add(`id:${issue.id}`);
    seen.add(`key:${issue.idReadable}`);
  }
  const runwayOnlyIds = new Set<string>();
  let hiddenResolved = 0;
  for (const read of reads ?? []) {
    if (read.state !== 'resolved') continue;
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
  return { issues, runwayOnlyIds, hiddenResolved };
}

/** Whether the workspace's Runway holds any ticket (sections and notes do not count). */
export function runwayHasTickets(items: readonly { kind: string }[] | null | undefined): boolean {
  return (items ?? []).some((i) => i.kind === 'issue');
}

/** Shown when every ticket All tasks has is hidden by Show closed / Show done. */
export const ALL_HIDDEN_BY_FILTER = 'All tickets are hidden by the current filter';
