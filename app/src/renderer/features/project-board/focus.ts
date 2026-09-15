// Priority Desk Foundation (VERM-4, ADR-0007) — the Focus toggle and the
// Focus-rank invariant (at most one issue per rank per active workspace).
//
// Split deliberately: the decision logic below (holdersOfRank,
// decideRankAssignment, findDuplicateRanks) is pure and unit-testable per
// this project's convention (vitest, plain Node, no DOM — see
// focus.test.ts); the hooks that fetch data and commit changes wrap it for
// the React components (FocusControl, FocusRankRepairBanner).
import { useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BoardIssue } from '../../../shared/workspace';
import { useWorkspaceStore } from '../../stores/workspace';
import { useToastStore } from '../../stores/toast';
import { useProjects, useWorkspaceConfig } from '../workspace-nav/api';

export type FocusRank = 1 | 2 | 3;

export function isFocusRank(v: number | null | undefined): v is FocusRank {
  return v === 1 || v === 2 || v === 3;
}

export interface FocusRankHolder {
  issue: BoardIssue;
  projectShortName: string;
}

// ─── Pure decision logic ───────────────────────────────────────────────────

/** Every OTHER issue currently holding `rank`, excluding `excludeIssueId`. */
export function holdersOfRank(
  byRank: ReadonlyMap<FocusRank, readonly FocusRankHolder[]>,
  rank: FocusRank,
  excludeIssueId?: string,
): FocusRankHolder[] {
  return (byRank.get(rank) ?? []).filter((h) => h.issue.id !== excludeIssueId);
}

export type RankAssignDecision =
  // No one else holds this rank — safe to assign directly.
  | { kind: 'direct' }
  // Exactly one other issue holds it — a normal conflict; ask which issue
  // keeps the slot rather than silently overwriting it (docs/requirements.md
  // § Priority Desk, "Focus-rank invariant").
  | { kind: 'confirm'; holder: FocusRankHolder }
  // Two or more other issues already share this rank — a pre-existing
  // duplicate (stale state / an external edit). The picker refuses to add a
  // third claimant; the repair banner is the only path to fix this.
  | { kind: 'blocked'; holders: FocusRankHolder[] };

export function decideRankAssignment(
  byRank: ReadonlyMap<FocusRank, readonly FocusRankHolder[]>,
  rank: FocusRank,
  targetIssueId: string,
): RankAssignDecision {
  const others = holdersOfRank(byRank, rank, targetIssueId);
  if (others.length === 0) return { kind: 'direct' };
  if (others.length === 1) return { kind: 'confirm', holder: others[0] };
  return { kind: 'blocked', holders: others };
}

export interface DuplicateRank {
  rank: FocusRank;
  holders: FocusRankHolder[];
}

/** Every rank (1-3) currently held by more than one issue — the repair state. */
export function findDuplicateRanks(
  byRank: ReadonlyMap<FocusRank, readonly FocusRankHolder[]>,
): DuplicateRank[] {
  const dups: DuplicateRank[] = [];
  for (const rank of [1, 2, 3] as const) {
    const holders = byRank.get(rank) ?? [];
    if (holders.length > 1) dups.push({ rank, holders: [...holders] });
  }
  return dups;
}

// ─── Data hooks ─────────────────────────────────────────────────────────────

/**
 * Project short names in the active workspace. Mirrors AppShell's own
 * workspaceShortNames computation (falls back to the first workspace when
 * none is active yet) so every surface agrees on what "the active workspace"
 * means without threading the list through props.
 */
export function useActiveWorkspaceProjectShortNames(): string[] {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const projects = useProjects();
  const workspaceConfig = useWorkspaceConfig();
  const activeWorkspace =
    workspaceConfig.data?.workspaces.find((w) => w.id === activeWorkspaceId) ??
    workspaceConfig.data?.workspaces[0];
  const workspaceProjectIds = new Set(
    activeWorkspace?.folders.flatMap((f) => f.projectIds) ?? [],
  );
  return (projects.data ?? [])
    .filter((p) => workspaceProjectIds.has(p.id))
    .map((p) => p.shortName);
}

/**
 * Every issue in the active workspace currently holding a Focus rank,
 * grouped by rank. Reuses the same ['youtrack','issues',shortName] query key
 * as the project board and "All tasks" workspace board, so this rides their
 * cache instead of firing extra requests when either is already mounted.
 */
export function useWorkspaceFocusRankHolders(): {
  byRank: Map<FocusRank, FocusRankHolder[]>;
  isLoading: boolean;
} {
  const projectShortNames = useActiveWorkspaceProjectShortNames();
  const results = useQueries({
    queries: projectShortNames.map((sn) => ({
      queryKey: ['youtrack', 'issues', sn],
      queryFn: () => window.vermilian.getIssues({ projectShortName: sn, includeResolved: false }),
      staleTime: 60_000,
    })),
  });

  const byRank = new Map<FocusRank, FocusRankHolder[]>();
  results.forEach((r, i) => {
    const projectShortName = projectShortNames[i];
    for (const issue of (r.data as BoardIssue[] | undefined) ?? []) {
      const rank = issue.fields.focusRank;
      if (isFocusRank(rank)) {
        const list = byRank.get(rank) ?? [];
        list.push({ issue, projectShortName });
        byRank.set(rank, list);
      }
    }
  });

  return {
    byRank,
    isLoading: projectShortNames.length > 0 && results.every((r) => !r.data),
  };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

function invalidateIssueQueries(qc: QueryClient, shortNames: Iterable<string>) {
  for (const sn of new Set(shortNames)) {
    void qc.invalidateQueries({ queryKey: ['youtrack', 'issues', sn] });
  }
}

export function useFocusMutations() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  async function patch(issueId: string, field: string, value: string | number | null) {
    const result = await window.vermilian.patchIssue({ issueId, field, value });
    if (!result.ok) {
      showToast('negative', result.error ?? 'Save failed');
      throw new Error(result.error ?? 'Save failed');
    }
  }

  /**
   * Toggle Focus on/off. Turning off clears Focus rank too, but Why now is
   * left untouched so a deferred item's reasoning survives for later
   * reconsideration (ADR-0007).
   */
  async function toggleFocus(issueId: string, projectShortName: string, currentlyFocused: boolean) {
    if (currentlyFocused) {
      await patch(issueId, 'focus', null);
      await patch(issueId, 'focusRank', null);
    } else {
      await patch(issueId, 'focus', 'Yes');
    }
    invalidateIssueQueries(qc, [projectShortName]);
  }

  /** Clear just the rank — used both as a standalone "Unrank" action and to
   * displace the previous holder when resolving a conflict. Focus itself is
   * left alone (still Yes, now unranked and starred in Choose-next). */
  async function clearRank(issueId: string, projectShortName: string) {
    await patch(issueId, 'focusRank', null);
    invalidateIssueQueries(qc, [projectShortName]);
  }

  /** Assign `rank` to the target issue, always implying Focus = Yes. Pass
   * `displace` when a conflict was confirmed, so the previous holder is
   * cleared first — never leaving two issues sharing a rank. */
  async function setRank(
    target: { issueId: string; projectShortName: string },
    rank: FocusRank,
    displace?: FocusRankHolder,
  ) {
    if (displace) {
      await patch(displace.issue.id, 'focusRank', null);
    }
    await patch(target.issueId, 'focus', 'Yes');
    await patch(target.issueId, 'focusRank', rank);
    invalidateIssueQueries(
      qc,
      [target.projectShortName, displace?.projectShortName].filter(Boolean) as string[],
    );
  }

  return { toggleFocus, clearRank, setRank };
}
