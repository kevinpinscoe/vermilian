import { useQuery } from '@tanstack/react-query';
import type { BoardIssue } from '../../../shared/workspace';

// Minimum characters before a search fires — avoids a request per keystroke and
// keeps single-letter noise out of the results dropdown.
export const SEARCH_MIN_CHARS = 2;

export function issueSearchQueryKey(projectShortNames: string[], query: string) {
  // Sort so the same scope produces the same key regardless of input order.
  return ['youtrack', 'search', [...projectShortNames].sort().join(','), query] as const;
}

// Scoped issue search. `projectShortNames` is the active project (one entry) or
// every project in the active workspace (many). `query` should already be
// debounced by the caller — the hook itself only gates on length + scope.
export function useIssueSearch(projectShortNames: string[], query: string) {
  const terms = query.trim();
  return useQuery<BoardIssue[]>({
    queryKey: issueSearchQueryKey(projectShortNames, terms),
    queryFn: () => window.vermilian.searchIssues({ projectShortNames, query: terms }),
    enabled: projectShortNames.length > 0 && terms.length >= SEARCH_MIN_CHARS,
    staleTime: 30 * 1000,
  });
}

// Where a search runs (VERM-61): YouTrack projects, or one Jira workspace's
// own projects through that workspace's own connection. A Jira scope never
// reaches YouTrack, and the main process never widens it past the workspace.
export type SearchScope =
  | { kind: 'youtrack'; projectShortNames: string[] }
  | { kind: 'jira'; workspaceId: string };

export function searchScopeEnabled(scope: SearchScope): boolean {
  return scope.kind === 'jira' ? scope.workspaceId !== '' : scope.projectShortNames.length > 0;
}

/** The same search, against whichever backend the scope names. */
export function useScopedIssueSearch(scope: SearchScope, query: string) {
  const terms = query.trim();
  const jiraWorkspaceId = scope.kind === 'jira' ? scope.workspaceId : '';
  const youtrack = useIssueSearch(scope.kind === 'youtrack' ? scope.projectShortNames : [], terms);
  const jira = useQuery<BoardIssue[]>({
    queryKey: ['workspace', 'jira-search', jiraWorkspaceId, terms],
    queryFn: async () => {
      const r = await window.vermilian.searchWorkspaceJiraIssues({ workspaceId: jiraWorkspaceId, query: terms });
      // Jira's own message (a 401, a missing scope) is what the user sees.
      if (!r.ok) throw new Error(r.message);
      return r.issues;
    },
    enabled: jiraWorkspaceId !== '' && terms.length >= SEARCH_MIN_CHARS,
    staleTime: 30 * 1000,
    retry: false,
  });
  return scope.kind === 'jira' ? jira : youtrack;
}
