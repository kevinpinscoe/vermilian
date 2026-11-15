// A Jira workspace's issue lists, one full read per project (VERM-34/39),
// merged into one card per issue. Shared by the board and the Jira Priority
// Desk (VERM-38): both use the same query keys, so they share one cache and
// opening the desk never fires a second set of reads.
import { useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { BoardIssue } from '../../../shared/workspace';
import { needsJiraReconnect, type WorkspaceJiraFailure } from '../../../shared/jiraConnection';
import { JIRA_FULL_REFRESH_MS } from '../../../shared/jiraPoll';
import { fetchFullJiraIssues, workspaceJiraIssuesQueryKey } from './jiraBoardSync';

export function useJiraWorkspaceIssues(workspaceId: string, projectKeys: readonly string[], showDone: boolean) {
  const queryClient = useQueryClient();
  // The full, authoritative read of each project, refreshed every
  // JIRA_FULL_REFRESH_MS so deleted and moved-away issues eventually
  // disappear (VERM-39, shared/jiraPoll.ts).
  const results = useQueries({
    queries: projectKeys.map((projectKey) => ({
      queryKey: workspaceJiraIssuesQueryKey(workspaceId, projectKey, showDone),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchFullJiraIssues(queryClient, workspaceId, projectKey, showDone, signal),
      staleTime: 60 * 1000,
      refetchInterval: JIRA_FULL_REFRESH_MS,
      refetchIntervalInBackground: false,
    })),
  });

  // A rejected token or unresolvable credential fails every project alike, so
  // one such failure puts the whole view in the reconnect state (VERM-40).
  const reconnect = results.map((r) => r.data).find((d): d is WorkspaceJiraFailure => needsJiraReconnect(d)) ?? null;
  const loading = results.some((r) => r.isLoading);
  const failures = results.flatMap((r, i) => (r.data && !r.data.ok ? [`${projectKeys[i]}: ${r.data.message}`] : r.error ? [`${projectKeys[i]}: ${(r.error as Error).message}`] : []));

  const { issues, priorities } = useMemo(() => {
    const all: BoardIssue[] = [];
    const seen = new Set<string>();
    const prio: Record<string, string[]> = {};
    results.forEach((r, i) => {
      if (r.data?.ok) {
        // One card per issue, even mid-move between two of the projects.
        for (const issue of r.data.issues) {
          if (!seen.has(issue.id)) {
            seen.add(issue.id);
            all.push(issue);
          }
        }
        prio[projectKeys[i]] = r.data.priorities;
      }
    });
    return { issues: all, priorities: prio };
  }, [results, projectKeys]);

  return { results, issues, priorities, loading, failures, reconnect };
}
