// Priority Desk Choose-next — candidate eligibility and deterministic ordering
// (VERM-6, docs/requirements.md § Priority Desk "Choose-next eligibility").
// Pure logic here (unit-tested in candidates.test.ts); the hook wraps it,
// reusing the same active-workspace project scoping and ['youtrack','issues',
// shortName] query key as focus.ts's useWorkspaceFocusRankHolders (VERM-4/
// VERM-5), so Now mode, Choose next, and the boards all share one cache
// instead of each firing their own requests.
//
// VERM-7 adds the active-Epic filter this ticket's VERM-6 delivery step
// deferred: options are the distinct BoardIssue.parentEpic values already
// present in the fetched, pre-filter issue set (no hard-coded list, no extra
// query), and the filter itself is conjunctive with every other eligibility
// rule below.
import { useQueries } from '@tanstack/react-query';
import type { BoardIssue, ParentEpic } from '../../../shared/workspace';
import { fieldChoices, isResolvedStatus, type ProjectFieldValues } from '../../../shared/projectFieldValues';
import { useProjectFieldValues } from '../project-fields/useProjectFieldValues';
import type { Dismissals } from '../../../shared/boardConfig';
import { useWorkspaceStore } from '../../stores/workspace';
import { isFocusRank, useActiveWorkspaceProjectShortNames } from '../project-board/focus';
import { currentWeekMonday, isDismissedThisWeek, useDismissals } from './dismissals';

export const MAX_CANDIDATES = 7;

export interface Candidate {
  issue: BoardIssue;
  projectShortName: string;
  /** Its project's own Priority values, most urgent first (VERM-117); [] when unknown. */
  priorityOrder?: readonly string[];
}

// ─── Pure logic ─────────────────────────────────────────────────────────────

/** A priority's rank in its own project's order; none, or one not in it, sorts last. */
function priorityOrdinal(priority: string | null, order: readonly string[] = []): number {
  const idx = priority ? order.indexOf(priority) : -1;
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

/**
 * Deterministic ordering used only when more than seven issues are eligible —
 * never a blended or weighted score. Every step reads an existing field's own
 * value or ordinal directly:
 *   1. Due Date ascending (no Due Date sorts last);
 *   2. Priority's ordinal in the issue's own project, most urgent first
 *      (VERM-117: each project's own order, not a fixed list);
 *   3. idReadable ascending, the final, always-unique tiebreak.
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const aDue = a.issue.fields.dueDate;
  const bDue = b.issue.fields.dueDate;
  if (aDue === null && bDue !== null) return 1;
  if (aDue !== null && bDue === null) return -1;
  if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;

  const aPriority = priorityOrdinal(a.issue.fields.priority, a.priorityOrder);
  const bPriority = priorityOrdinal(b.issue.fields.priority, b.priorityOrder);
  if (aPriority !== bPriority) return aPriority - bPriority;

  if (a.issue.idReadable < b.issue.idReadable) return -1;
  if (a.issue.idReadable > b.issue.idReadable) return 1;
  return 0;
}

export interface ComputeCandidatesArgs {
  issuesByProject: ReadonlyMap<string, readonly BoardIssue[]>; // projectShortName -> issues
  dismissals: Dismissals;
  workspaceId: string;
  weekOf: string;
  statusFilter: string | null;
  epicFilter: string | null; // parentEpic.id; null = no Epic-membership restriction
  /** Each project's select-field values (VERM-117): resolution and Priority order. */
  fieldValuesByProject?: ReadonlyMap<string, ProjectFieldValues | undefined>;
}

export interface ComputeCandidatesResult {
  candidates: Candidate[]; // deterministically ordered, capped at MAX_CANDIDATES
  totalEligible: number; // count before the cap
}

/**
 * Choose-next eligibility (docs/requirements.md § Priority Desk,
 * "Choose-next eligibility"): belongs to a project in the active workspace
 * (enforced by the caller only ever passing that workspace's projects), is
 * not itself an Epic (VERM-7 review finding, 2026-09-16 — an Epic is a
 * container, never a single actionable task), not resolved — by YouTrack's
 * own resolution of the ticket, or because its project marks its Status as
 * resolving (VERM-117; so Wont do and Fixed count, and the same name may be
 * open in one project and resolved in another) — no
 * existing Focus rank 1-3 (a ranked issue shows in Now mode instead), not
 * under an unexpired "Not this week" dismissal, matches the selected Status
 * filter when one is set, and matches the selected active-Epic filter when
 * one is set (VERM-7) — conjunctive with the Status filter, never a side
 * effect on Priority or Focus. A Focus=Yes issue with no rank remains
 * eligible and appears starred — Focus itself is not an eligibility
 * criterion.
 */
export function computeCandidates(args: ComputeCandidatesArgs): ComputeCandidatesResult {
  const { issuesByProject, dismissals, workspaceId, weekOf, statusFilter, epicFilter, fieldValuesByProject } = args;
  const eligible: Candidate[] = [];

  for (const [projectShortName, issues] of issuesByProject) {
    const values = fieldValuesByProject?.get(projectShortName);
    const priorityOrder = values?.priorityOrder ?? [];
    for (const issue of issues) {
      if (issue.isEpic) continue;
      if (issue.resolved != null || isResolvedStatus(values, issue.fields.status)) continue;
      if (isFocusRank(issue.fields.focusRank)) continue;
      if (isDismissedThisWeek(dismissals, workspaceId, issue.id, weekOf)) continue;
      if (statusFilter && issue.fields.status !== statusFilter) continue;
      if (epicFilter && issue.parentEpic?.id !== epicFilter) continue;
      eligible.push({ issue, projectShortName, priorityOrder });
    }
  }

  eligible.sort(compareCandidates);
  return { candidates: eligible.slice(0, MAX_CANDIDATES), totalEligible: eligible.length };
}

/**
 * The Status filter's options (VERM-117): every Status that is open work —
 * an active value its project does not mark as resolving — in at least one of
 * the workspace's projects, in the projects' own order. A name resolved in one
 * project but open in another is offered, and matches only where it is open,
 * because resolved tickets are never candidates.
 */
export function deriveStatusFilterOptions(
  projectShortNames: readonly string[],
  fieldValuesByProject: ReadonlyMap<string, ProjectFieldValues | undefined>,
): string[] {
  const out: string[] = [];
  for (const sn of projectShortNames) {
    const status = fieldChoices(fieldValuesByProject.get(sn), 'status');
    for (const v of status.values) if (!status.resolved.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The active-Epic filter's own options: every distinct parent Epic appearing
 * across the workspace's fetched issues, independent of Status/dismissal/rank
 * eligibility — so an Epic never disappears from the dropdown merely because
 * its one remaining candidate got dismissed or ranked. No hard-coded list,
 * no custom field: derived entirely from BoardIssue.parentEpic. Sorted by
 * idReadable for a stable, deterministic dropdown order.
 */
export function deriveEpicFilterOptions(
  issuesByProject: ReadonlyMap<string, readonly BoardIssue[]>,
): ParentEpic[] {
  const byId = new Map<string, ParentEpic>();
  for (const issues of issuesByProject.values()) {
    for (const issue of issues) {
      if (issue.parentEpic && !byId.has(issue.parentEpic.id)) {
        byId.set(issue.parentEpic.id, issue.parentEpic);
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => (a.idReadable < b.idReadable ? -1 : 1));
}

// ─── Readiness (pure) ───────────────────────────────────────────────────────

export interface QueryStatus {
  hasData: boolean;
  isError: boolean;
}

export interface CandidateSetReadiness {
  isLoading: boolean;
  isError: boolean;
}

/**
 * Choose next must not present an actionable candidate set — cards, the
 * seven-item cap, deterministic ordering, or the count badge — until every
 * workspace project's issue query (and the dismissals query) has settled.
 * Treating a still-pending project query as "this project has zero issues"
 * silently under-reports eligibility the moment one project's query is
 * slower than another's (review finding on VERM-6's PR, 2026-09-16). An
 * errored query is terminal, not pending — it reports `isError`, never a
 * false-empty project standing in for the rest.
 */
export function candidateSetReadiness(
  projectQueries: readonly QueryStatus[],
  dismissalsQuery: QueryStatus,
): CandidateSetReadiness {
  const isError = projectQueries.some((q) => q.isError) || dismissalsQuery.isError;
  const isLoading = !isError && (
    projectQueries.some((q) => !q.hasData) || !dismissalsQuery.hasData
  );
  return { isLoading, isError };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useChooseNextCandidates(
  statusFilter: string | null,
  epicFilter: string | null,
): ComputeCandidatesResult & CandidateSetReadiness & { epicOptions: ParentEpic[]; statusOptions: string[] } {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const projectShortNames = useActiveWorkspaceProjectShortNames();
  const dismissalsQuery = useDismissals();
  // Each project's own Status resolution and Priority order (VERM-117), on
  // the workspace's own connection. Choose next waits for them: without a
  // project's resolution data it cannot tell open work from resolved.
  const fieldValues = useProjectFieldValues(activeWorkspaceId, projectShortNames);

  const results = useQueries({
    queries: projectShortNames.map((sn) => ({
      queryKey: ['youtrack', 'issues', sn],
      queryFn: () => window.vermilian.getIssues({ projectShortName: sn, includeResolved: false }),
      staleTime: 60_000,
    })),
  });

  const { isLoading, isError } = candidateSetReadiness(
    [
      ...results.map((r) => ({ hasData: r.data !== undefined, isError: r.isError })),
      ...projectShortNames.map((sn) => ({ hasData: fieldValues.byProject.has(sn), isError: fieldValues.errors.has(sn) })),
    ],
    { hasData: dismissalsQuery.data !== undefined, isError: dismissalsQuery.isError },
  );

  if (isLoading || isError) {
    return { candidates: [], totalEligible: 0, isLoading, isError, epicOptions: [], statusOptions: [] };
  }

  const issuesByProject = new Map<string, BoardIssue[]>();
  results.forEach((r, i) => {
    issuesByProject.set(projectShortNames[i], (r.data as BoardIssue[]) ?? []);
  });

  const { candidates, totalEligible } = computeCandidates({
    issuesByProject,
    dismissals: dismissalsQuery.data ?? {},
    workspaceId: activeWorkspaceId,
    weekOf: currentWeekMonday(),
    statusFilter,
    epicFilter,
    fieldValuesByProject: fieldValues.byProject,
  });

  return {
    candidates, totalEligible, isLoading: false, isError: false,
    epicOptions: deriveEpicFilterOptions(issuesByProject),
    statusOptions: deriveStatusFilterOptions(projectShortNames, fieldValues.byProject),
  };
}
