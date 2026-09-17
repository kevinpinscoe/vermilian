// Priority Desk "Ask for recommendation" — audit comment construction (VERM-8,
// docs/requirements.md § Priority Desk, "Ask for recommendation" → "Audit
// record"). Pure, no Electron/network dependency — unit-tested directly
// (PLAN.md "Audit comment").
//
// The gating rule lives here, not in the IPC handler or the UI: an audit
// comment exists only after (1) a ranked recommendation has actually been
// presented — RecommendationResult.kind === 'ranked' — and (2) the user has
// made one of the three confirmation choices. maybeBuildAuditComment is the
// single choke point that enforces both; a 'clarification' result or a null
// action always yields null, by construction, never by caller discipline
// alone.
import type {
  ConfirmationAction,
  RecommendationItem,
  RecommendationResult,
} from './ipc';

const ACTION_LABEL: Record<ConfirmationAction, string> = {
  'apply-to-desk': 'Apply to desk — Focus rank 1/2/3 assigned to the ranked recommendation.',
  'star-only': 'Star only — Focus set to Yes on the ranked recommendation, no rank assigned.',
  'keep-my-order': 'Keep my order — no fields changed.',
};

function formatItem(item: RecommendationItem, position: number): string {
  const { evidence } = item;
  return [
    `${position}. ${item.idReadable} — ${item.summary}`,
    `   Outcome contribution: ${evidence.outcomeContribution}`,
    `   Dependency readiness: ${evidence.dependencyReadiness}`,
    `   Urgency: ${evidence.urgency}`,
    `   Effort: ${evidence.effort}`,
    `   Risk: ${evidence.risk}`,
  ].join('\n');
}

/**
 * Builds the audit comment text for a ranked recommendation and the user's
 * chosen action. Always produces text — callers only reach this once both
 * gating conditions already hold (see maybeBuildAuditComment below).
 */
export function buildAuditComment(
  result: { ranked: RecommendationItem[]; alternates: RecommendationItem[] },
  action: ConfirmationAction,
): string {
  const lines: string[] = ['Priority Desk recommendation'];
  lines.push('', 'Ranked:');
  result.ranked.forEach((item, i) => lines.push(formatItem(item, i + 1)));
  if (result.alternates.length > 0) {
    lines.push('', 'Alternates:');
    result.alternates.forEach((item, i) => lines.push(formatItem(item, i + 1)));
  }
  lines.push('', `Choice: ${ACTION_LABEL[action]}`);
  return lines.join('\n');
}

/**
 * The single gate: returns the audit comment text only when both conditions
 * hold (a ranked result AND a chosen action), otherwise null. A
 * 'clarification' result always returns null regardless of `action` — there
 * is nothing to confirm, so there is nothing to audit (docs/requirements.md
 * § Priority Desk, "Ask for recommendation" → "Audit record").
 */
export function maybeBuildAuditComment(
  result: RecommendationResult,
  action: ConfirmationAction | null,
): string | null {
  if (!action) return null;
  if (result.kind !== 'ranked') return null;
  return buildAuditComment(result, action);
}
