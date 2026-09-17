// Priority Desk "Ask for recommendation" (VERM-8) — request-payload
// construction and the two IPC calls. Payload construction is pure
// (buildCandidateContext), so it is unit-testable independent of React
// Query/IPC (CHECKPOINT.md Workflow 5, "Bounded-payload construction").
//
// epicOutcomeContextFor reuses the existing shared/masterPlan.ts
// resolveEpicOutcome — never re-derives Epic→outcome matching (PLAN.md
// constraint 1).
import { useMutation } from '@tanstack/react-query';
import { resolveEpicOutcome, type Outcome } from '../../../shared/masterPlan';
import type {
  ConfirmationAction,
  EpicOutcomeContext,
  GetRecommendationResult,
  PostRecommendationAuditResult,
  RecommendationCandidateContext,
  RecommendationItem,
  RecommendationResult,
} from '../../../shared/ipc';
import type { Candidate } from './candidates';
import type { FocusRank } from '../project-board/focus';

function epicOutcomeContextFor(
  candidate: Candidate,
  outcomes: Outcome[],
  selectedOutcome: Outcome,
): EpicOutcomeContext {
  const epic = candidate.issue.parentEpic;
  if (!epic) return 'no-parent-epic';

  const resolution = resolveEpicOutcome(outcomes, epic.idReadable);
  if (resolution.kind === 'none') return 'no-outcome-association';
  if (resolution.kind === 'conflict') {
    return resolution.outcomes.some((o) => o.name === selectedOutcome.name)
      ? 'matches-selected-outcome'
      : 'different-outcome';
  }
  return resolution.outcome.name === selectedOutcome.name ? 'matches-selected-outcome' : 'different-outcome';
}

/**
 * Builds the per-candidate Epic→outcome context sent alongside the request —
 * bounded strictly to the given candidates (never a wider set). Each
 * candidate's context is resolved via resolveEpicOutcome, not re-derived.
 */
export function buildCandidateContext(
  candidates: Candidate[],
  outcomes: Outcome[],
  selectedOutcome: Outcome,
): RecommendationCandidateContext[] {
  return candidates.map((c) => ({
    issueId: c.issue.id,
    epicOutcomeContext: epicOutcomeContextFor(c, outcomes, selectedOutcome),
    parentEpicIdReadable: c.issue.parentEpic?.idReadable ?? null,
  }));
}

// ─── Confirmation-action field-write planning (pure) ───────────────────────
// What each confirmation action writes, and nothing more (PLAN.md
// "Confirmation actions and field writes"). Deliberately data, not
// execution: RecommendationPanel still runs conflict detection
// (decideRankAssignment, focus.ts) against 'setRank' writes and executes
// each write through the existing useFocusMutations() before calling this
// — the plan itself is unit-testable independent of both.

export type ConfirmationFieldWrite =
  | { kind: 'setRank'; issueId: string; rank: FocusRank }
  | { kind: 'toggleFocusOn'; issueId: string };

/**
 * Only the top three ranked items are ever written to, regardless of action
 * — alternates are never touched. 'keep-my-order' always plans zero writes.
 * 'star-only' skips any item that is already Focus=Yes, per PLAN.md
 * ("Star only — ... on each of the top three not already Focus=Yes").
 */
export function planConfirmationWrites(
  ranked: RecommendationItem[],
  action: ConfirmationAction,
  isAlreadyFocused: (issueId: string) => boolean,
): ConfirmationFieldWrite[] {
  const top3 = ranked.slice(0, 3);
  switch (action) {
    case 'apply-to-desk':
      return top3.map((item, i) => ({ kind: 'setRank', issueId: item.issueId, rank: (i + 1) as FocusRank }));
    case 'star-only':
      return top3
        .filter((item) => !isAlreadyFocused(item.issueId))
        .map((item) => ({ kind: 'toggleFocusOn', issueId: item.issueId }));
    case 'keep-my-order':
      return [];
    default:
      return [];
  }
}

export interface GetRecommendationVars {
  issueIds: string[];
  candidateContext: RecommendationCandidateContext[];
  outcome: Outcome;
}

export function useGetRecommendation() {
  return useMutation<GetRecommendationResult, Error, GetRecommendationVars>({
    mutationFn: (args) => window.vermilian.getRecommendation(args),
  });
}

export interface PostRecommendationAuditVars {
  result: RecommendationResult;
  action: ConfirmationAction;
}

export function usePostRecommendationAudit() {
  return useMutation<PostRecommendationAuditResult, Error, PostRecommendationAuditVars>({
    mutationFn: (args) => window.vermilian.postRecommendationAudit(args),
  });
}
