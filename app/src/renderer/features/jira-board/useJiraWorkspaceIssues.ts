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

// `sources` are the workspace's project keys and boards' "board:<id>"
// (shared/jiraSource.ts, VERM-59); `sourceNames` labels failures by name.
export function useJiraWorkspaceIssues(
  workspaceId: string,
  sources: readonly string[],
  showDone: boolean,
  sourceNames: Readonly<Record<string, string>> = {},
) {
  const queryClient = useQueryClient();
  // The full, authoritative read of each project, refreshed every
  // JIRA_FULL_REFRESH_MS so deleted and moved-away issues eventually
  // disappear (VERM-39, shared/jiraPoll.ts).
  const results = useQueries({
    queries: sources.map((source) => ({
      queryKey: workspaceJiraIssuesQueryKey(workspaceId, source, showDone),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchFullJiraIssues(queryClient, workspaceId, source, showDone, signal),
      staleTime: 60 * 1000,
      refetchInterval: JIRA_FULL_REFRESH_MS,
      refetchIntervalInBackground: false,
    })),
  });

  // A rejected token or unresolvable credential fails every project alike, so
  // one such failure puts the whole view in the reconnect state (VERM-40).
  const reconnect = results.map((r) => r.data).find((d): d is WorkspaceJiraFailure => needsJiraReconnect(d)) ?? null;
  const loading = results.some((r) => r.isLoading);
  const labelOf = (i: number) => sourceNames[sources[i]] ?? sources[i];
  const failures = results.flatMap((r, i) => (r.data && !r.data.ok ? [`${labelOf(i)}: ${r.data.message}`] : r.error ? [`${labelOf(i)}: ${(r.error as Error).message}`] : []));

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
        // Priority orders are per project: a board brings one per project
        // its issues come from (VERM-59).
        if (r.data.prioritiesByProject) Object.assign(prio, r.data.prioritiesByProject);
        else prio[sources[i]] = r.data.priorities;
      }
    });
    return { issues: all, priorities: prio };
  }, [results, sources]);

  return { results, issues, priorities, loading, failures, reconnect };
}
