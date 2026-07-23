import { useQuery } from '@tanstack/react-query';
import type { BoardIssue } from '../../../shared/workspace';

// Minimum characters before a search fires — avoids a request per keystroke and
// keeps single-letter noise out of the results dropdown.
export const SEARCH_MIN_CHARS = 2;

export function issueSearchQueryKey(projectShortName: string | null, query: string) {
  return ['youtrack', 'search', projectShortName, query] as const;
}

// Scoped issue search for the active project. `query` should already be
// debounced by the caller — the hook itself only gates on length + scope.
export function useIssueSearch(projectShortName: string | null, query: string) {
  const terms = query.trim();
  return useQuery<BoardIssue[]>({
    queryKey: issueSearchQueryKey(projectShortName, terms),
    queryFn: () =>
      window.vermilian.searchIssues({
        projectShortName: projectShortName as string,
        query: terms,
      }),
    enabled: Boolean(projectShortName) && terms.length >= SEARCH_MIN_CHARS,
    staleTime: 30 * 1000,
  });
}
