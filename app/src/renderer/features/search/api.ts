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
