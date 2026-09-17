// Priority Desk Daily Review (VERM-9, docs/requirements.md § Priority Desk).
// Blocked-focused work and focused-but-unranked ("needs attention") items are
// both derived from the same board data Now mode already fetches — no second
// query shape, no new field. The pure derivation functions below are
// unit-tested directly (see boardData.test.ts), the same convention
// project-board/focus.ts uses for holdersOfRank/decideRankAssignment.
import { useQueries } from '@tanstack/react-query';
import type { BoardIssue } from '../../../shared/workspace';
import { isFocusRank, useActiveWorkspaceProjectShortNames } from '../project-board/focus';

/** Focus rank 1-3 AND Status is BLOCKED — a slot the desk shows, stalled. */
export function deriveBlockedFocused(issues: BoardIssue[]): BoardIssue[] {
  return issues.filter((i) => isFocusRank(i.fields.focusRank) && i.fields.status === 'BLOCKED');
}

/** Starred (Focus = Yes) but never assigned a Focus rank — a decision left
 * half-made (PLAN.md "Focus items needing attention"). */
export function deriveNeedsAttention(issues: BoardIssue[]): BoardIssue[] {
  return issues.filter((i) => i.fields.focus === 'Yes' && !isFocusRank(i.fields.focusRank));
}

/**
 * Every unresolved issue in the active workspace, across all its projects.
 * Rides the exact same `['youtrack','issues',shortName]` query key and
 * `getIssues` call `useWorkspaceFocusRankHolders` uses, so mounting Daily
 * Review alongside Priority Desk's Now mode costs no extra requests.
 *
 * An errored project query is terminal, not pending — same rule as
 * priority-desk/candidates.ts's candidateSetReadiness, for the same reason:
 * treating a still-failing query as "this project has zero issues" would
 * silently under-report blocked/needs-attention work.
 */
export function useActiveWorkspaceIssues(): {
  issues: BoardIssue[];
  isLoading: boolean;
  isError: boolean;
} {
  const projectShortNames = useActiveWorkspaceProjectShortNames();
  const results = useQueries({
    queries: projectShortNames.map((sn) => ({
      queryKey: ['youtrack', 'issues', sn],
      queryFn: () => window.vermilian.getIssues({ projectShortName: sn, includeResolved: false }),
      staleTime: 60_000,
    })),
  });

  const isError = results.some((r) => r.isError);
  const issues = results.flatMap((r) => (r.data as BoardIssue[] | undefined) ?? []);

  return {
    issues,
    isLoading: !isError && projectShortNames.length > 0 && results.some((r) => !r.data),
    isError,
  };
}
