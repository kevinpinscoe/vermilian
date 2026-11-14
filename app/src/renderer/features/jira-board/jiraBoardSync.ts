// Keeping a Jira workspace board fresh (VERM-39). The pure rules live in
// shared/jiraPoll.ts; this file binds them to the React Query cache.
//
// Each board project has two queries, both keyed by workspace:
//
//   ['workspace', 'jira-issues', ws, project, showDone]  the issue list the
//       board renders. Its queryFn is the full, authoritative read, run on
//       mount, every JIRA_FULL_REFRESH_MS, and when the poll chain breaks.
//   ['workspace', 'jira-poll', ws, project, showDone]    the incremental poll,
//       every JIRA_POLL_INTERVAL_MS. It holds no issues; it merges what changed
//       into the list above.
//
// Isolation: every read and every write is addressed by its own workspace's
// keys, so a late answer for a workspace the user has left lands in that
// workspace's cache, never the active board. The board unmounting cancels its
// in-flight reads (each queryFn takes the query's AbortSignal), and an aborted
// read changes nothing. React Query runs at most one fetch per key, and both
// intervals pause while the window is hidden (refetchIntervalInBackground is
// false; React Query's focusManager follows document visibility).

import type { QueryClient } from '@tanstack/react-query';
import type { BoardIssue, IssueDetail } from '../../../shared/workspace';
import type { GetWorkspaceJiraIssuesResult } from '../../../shared/ipc';
import { needsJiraReconnect } from '../../../shared/jiraConnection';
import { mergeRecentlyUpdated, needsFullRefresh, reconcileFullRefresh, type JiraMergeScope } from '../../../shared/jiraPoll';

export const workspaceJiraIssuesQueryKey = (workspaceId: string, projectKey: string, includeResolved: boolean) =>
  ['workspace', 'jira-issues', workspaceId, projectKey, includeResolved] as const;

export const workspaceJiraPollQueryKey = (workspaceId: string, projectKey: string, includeResolved: boolean) =>
  ['workspace', 'jira-poll', workspaceId, projectKey, includeResolved] as const;

/** Every board issue list of one workspace, whichever project or Show done setting. */
export const workspaceJiraIssuesPrefix = (workspaceId: string) => ['workspace', 'jira-issues', workspaceId] as const;

// When the last successful sync of each board query *started*, and when its
// last full read started. Keyed by the issues query's key.
interface SyncState {
  lastSyncStartedAt: number | null;
  lastFullStartedAt: number | null;
}
const syncStates = new Map<string, SyncState>();

function syncState(key: readonly unknown[]): SyncState {
  const id = JSON.stringify(key);
  let s = syncStates.get(id);
  if (!s) {
    s = { lastSyncStartedAt: null, lastFullStartedAt: null };
    syncStates.set(id, s);
  }
  return s;
}

/** For unit tests only. */
export function resetJiraSyncStateForTests(): void {
  syncStates.clear();
}

function markSynced(s: SyncState, startedAt: number): void {
  s.lastSyncStartedAt = Math.max(s.lastSyncStartedAt ?? startedAt, startedAt);
}

/**
 * The full read of one project, reconciled into what is cached: the result
 * decides which issues exist, and a newer cached copy of an issue is kept
 * over an older one from the search.
 */
export async function fetchFullJiraIssues(
  queryClient: QueryClient,
  workspaceId: string,
  projectKey: string,
  includeResolved: boolean,
  signal?: AbortSignal,
): Promise<GetWorkspaceJiraIssuesResult> {
  const key = workspaceJiraIssuesQueryKey(workspaceId, projectKey, includeResolved);
  const s = syncState(key);
  const startedAt = Date.now();
  s.lastFullStartedAt = startedAt;
  const res = await window.vermilian.getWorkspaceJiraIssues({ workspaceId, projectKey, includeResolved });
  if (!res.ok) return res;
  const prev = queryClient.getQueryData<GetWorkspaceJiraIssuesResult>(key);
  const issues = reconcileFullRefresh(prev?.ok ? prev.issues : undefined, res.issues, { projectKey, includeResolved });
  if (!signal?.aborted) markSynced(s, startedAt);
  return { ...res, issues };
}

/**
 * Merges recently updated or directly read issues into every cached board
 * list of one workspace. An issue that moved between two of the workspace's
 * projects leaves one list and joins the other.
 */
export function applyJiraUpdates(queryClient: QueryClient, workspaceId: string, updates: readonly BoardIssue[]): void {
  if (updates.length === 0) return;
  for (const [key, data] of queryClient.getQueriesData<GetWorkspaceJiraIssuesResult>({ queryKey: workspaceJiraIssuesPrefix(workspaceId) })) {
    if (!data || !data.ok) continue;
    const list: JiraIssuesOk = data;
    const scope: JiraMergeScope = { projectKey: String(key[3]), includeResolved: key[4] === true };
    const merged = mergeRecentlyUpdated(list.issues, updates, scope);
    if (merged !== list.issues) {
      const next: JiraIssuesOk = { ...list, issues: merged };
      queryClient.setQueryData<GetWorkspaceJiraIssuesResult>(key, next);
    }
  }
}

type JiraIssuesOk = Extract<GetWorkspaceJiraIssuesResult, { ok: true }>;

export type JiraPollOutcome = 'merged' | 'full-refresh' | 'skipped';

/**
 * One incremental poll of one project. Skips when a full read of it is
 * already running or it has no list yet; runs a full read instead when the
 * chain is broken (needsFullRefresh: first sync, sleep, a hidden window, a
 * missed window); otherwise merges what changed in the lookback window.
 * Throws when Jira refuses, so the failed poll does not count as a sync; a
 * rejected credential also refreshes the list, which shows the reconnect
 * state (VERM-40).
 */
export async function pollJiraProject(
  queryClient: QueryClient,
  workspaceId: string,
  projectKey: string,
  includeResolved: boolean,
  signal?: AbortSignal,
): Promise<JiraPollOutcome> {
  const listKey = workspaceJiraIssuesQueryKey(workspaceId, projectKey, includeResolved);
  if (queryClient.isFetching({ queryKey: listKey, exact: true }) > 0) return 'skipped';
  if (!queryClient.getQueryData(listKey)) return 'skipped';

  const s = syncState(listKey);
  const startedAt = Date.now();
  if (needsFullRefresh(startedAt, s.lastSyncStartedAt)) {
    await queryClient.refetchQueries({ queryKey: listKey, exact: true });
    return 'full-refresh';
  }

  const res = await window.vermilian.getWorkspaceJiraRecentlyUpdated({ workspaceId, projectKey });
  if (signal?.aborted) return 'skipped';
  if (!res.ok) {
    if (needsJiraReconnect(res)) void queryClient.refetchQueries({ queryKey: listKey, exact: true });
    throw new Error(res.message);
  }
  // A full read that started after this poll is at least as current; this
  // answer could only bring back an issue it removed.
  if ((s.lastFullStartedAt ?? 0) > startedAt) return 'skipped';
  applyJiraUpdates(queryClient, workspaceId, res.issues);
  markSynced(s, startedAt);
  return 'merged';
}

/** The board-list shape of an issue the detail panel read directly. */
export function boardIssueOf(detail: IssueDetail): BoardIssue {
  const { project: _project, ...issue } = detail;
  return issue;
}
