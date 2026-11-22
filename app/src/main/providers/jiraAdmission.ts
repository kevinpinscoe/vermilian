// Which Jira tickets a workspace may read (VERM-59, VERM-83).
//
// A Jira workspace reads only its own tickets: one in one of its projects, one
// on its own Runway, or one on one of its boards by that board's own filter.
// Every Jira read that names a single ticket — the detail panel, the
// moved-issue recheck, and an exact-key search — asks this one function, so
// the rule cannot drift between them.
//
// The checks run cheapest first and stop at the first yes: the project key is
// a string comparison, the Runway is a local database read, and each board is
// a call to Jira. A board call is made only for a ticket that is neither in a
// project nor on the Runway.
//
// The caller supplies `isOnBoard` from the workspace's own Jira connection and
// `isOnRunway` for this workspace's Runway only, so admission never consults
// another workspace's Runway or another credential.
//
// No Electron import: this runs under vitest.

import { jiraProjectKeyOf } from '../../shared/jiraBoardIssue';
import { encodeIssueId } from '../../shared/tracker';
import type { RunwayItem } from '../../shared/runwayItem';

export interface JiraAdmissionScope {
  /** The workspace's Jira project keys. */
  projectKeys: readonly string[];
  /** The workspace's Jira board IDs. */
  boardIds: readonly number[];
  /** Whether the ticket is on one board, asked on the workspace's own Jira connection. */
  isOnBoard(boardId: number, key: string): Promise<boolean>;
  /** Whether the ticket is on this workspace's own Runway. */
  isOnRunway(key: string): boolean;
}

/** Whether the workspace may read the Jira ticket `key`. */
export async function jiraWorkspaceAdmits(scope: JiraAdmissionScope, key: string): Promise<boolean> {
  if (scope.projectKeys.includes(jiraProjectKeyOf(key))) return true;
  if (scope.isOnRunway(key)) return true;
  for (const id of scope.boardIds) {
    if (await scope.isOnBoard(id, key)) return true;
  }
  return false;
}

/**
 * `isOnRunway` for one workspace: whether the Jira ticket is a row on that
 * workspace's Runway, and on no other's. A Runway that cannot be read admits
 * nothing, so a storage failure narrows reads rather than widening them.
 */
export function jiraRunwayLookup(
  store: () => { list(workspaceId: string): RunwayItem[] },
  workspaceId: string,
): (key: string) => boolean {
  return (key) => {
    try {
      const itemId = encodeIssueId('jira', key);
      return store().list(workspaceId).some((item) => item.kind === 'issue' && item.itemId === itemId);
    } catch {
      return false;
    }
  };
}

export type JiraAdmittedRead<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Reads one ticket only if the workspace admits it, and re-checks the key Jira
 * answers with: Jira answers a moved issue's old key with the issue under its
 * new key and project, which the workspace may not admit. `read` must use the
 * workspace's own Jira connection; `keyOf` names the key the read came back
 * under.
 */
export async function readAdmittedJiraIssue<T>(
  scope: JiraAdmissionScope,
  issueKey: string,
  read: (key: string) => Promise<T>,
  keyOf: (value: T) => string,
): Promise<JiraAdmittedRead<T>> {
  if (!(await jiraWorkspaceAdmits(scope, issueKey))) {
    return { ok: false, message: `${issueKey} is not in one of this workspace's Jira projects, boards or Runway.` };
  }
  const value = await read(issueKey);
  const actual = keyOf(value);
  if (actual !== issueKey && !(await jiraWorkspaceAdmits(scope, actual))) {
    return { ok: false, message: `${issueKey} has moved to ${actual}, outside this workspace's Jira projects, boards and Runway.` };
  }
  return { ok: true, value };
}
