// Read-only Jira list (VERM-21). One IPC call; the main process probes the
// token, pages through search/jql and returns ready-to-render rows.
import { useQuery } from '@tanstack/react-query';
import type { ListJiraIssuesResult } from '../../../shared/ipc';

export const JIRA_MY_ISSUES_QUERY_KEY = ['jira', 'my-open-issues'];

export function useMyJiraIssues() {
  return useQuery<ListJiraIssuesResult>({
    queryKey: JIRA_MY_ISSUES_QUERY_KEY,
    queryFn: () => window.vermilian.listMyJiraIssues(),
    staleTime: 60_000,
  });
}
