// Pure prompt assembly + tool-schema + response parsing for the Priority
// Desk "Ask for recommendation" Claude call (VERM-8). Extracted from
// claude.ts, like standupPrompt.ts/aiExtract.ts, so this can be unit-tested
// without the Anthropic SDK.
//
// No numeric score anywhere (PLAN.md "No numeric score") — every evidence
// field is free text, both in the tool schema below and in the parsed
// RecommendationItem shape.

import type { Outcome } from '../../shared/masterPlan';
import type {
  RecommendationCandidateContext,
  RecommendationEvidence,
  RecommendationItem,
  RecommendationResult,
} from '../../shared/ipc';
import type { RecommendationIssue } from './youtrack';

// ─── Tool schema ────────────────────────────────────────────────────────────
// A minimal local shape (not Anthropic.Tool) so this file stays SDK-free;
// claude.ts passes the result straight through to `tools: [...]` — the
// Anthropic SDK's tool_use request accepts any object matching this shape.
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const EVIDENCE_ITEM_PROPERTIES = {
  outcome_contribution: {
    type: 'string',
    description: 'Free text: how this issue advances the selected Outcome. Never a numeric score.',
  },
  dependency_readiness: {
    type: 'string',
    description: 'Free text: whether this issue is blocked on, or blocks, other work — based on its issue links.',
  },
  urgency: { type: 'string', description: 'Free text: why this is (or is not) time-sensitive.' },
  effort: { type: 'string', description: 'Free text: a rough sense of the work involved.' },
  risk: { type: 'string', description: 'Free text: what could go wrong or what is uncertain.' },
};

/**
 * Builds the tool schema for one recommendation call. `issueIds` constrains
 * every `issue_id` the model can return to an `enum` of the exact candidate
 * ids given — the model can never invent, guess, or widen the candidate set
 * (PLAN.md "Use only the bounded candidate set"). Built fresh per call since
 * the candidate id list varies by request.
 */
export function buildRecommendationTool(issueIds: string[]): ToolSchema {
  const itemSchema = {
    type: 'object',
    properties: {
      issue_id: { type: 'string', enum: issueIds, description: 'One of the given candidate issue ids.' },
      ...EVIDENCE_ITEM_PROPERTIES,
    },
    required: ['issue_id', 'outcome_contribution', 'dependency_readiness', 'urgency', 'effort', 'risk'],
  };

  return {
    name: 'recommend_priority',
    description:
      'Return a ranked top three (plus 0-2 alternates) of the given candidate issues against ' +
      'the selected Outcome, each with qualitative evidence — or, when the candidate set and ' +
      'Outcome context are not enough to make a sound recommendation, a clarification question ' +
      'instead. Never invent an issue id outside the given candidates. Never return a numeric ' +
      'score anywhere.',
    input_schema: {
      type: 'object',
      properties: {
        clarification_needed: {
          type: ['string', 'null'],
          description:
            'A concrete question, if the candidate set and Outcome context are not enough to ' +
            'make a sound recommendation. Otherwise null. When set, ranked and alternates must ' +
            'both be empty arrays.',
        },
        ranked: {
          type: 'array',
          minItems: 0,
          maxItems: 3,
          items: itemSchema,
          description: 'The ranked top three, most important first. Empty only when clarification_needed is set.',
        },
        alternates: {
          type: 'array',
          minItems: 0,
          maxItems: 2,
          items: itemSchema,
          description: 'Zero to two runner-up candidates, not part of the ranked top three.',
        },
      },
      required: ['clarification_needed', 'ranked', 'alternates'],
    },
  };
}

// ─── Prompt text ────────────────────────────────────────────────────────────

function formatLinks(issue: RecommendationIssue): string {
  if (issue.links.length === 0) return '  Links: none';
  const lines = issue.links.map((link) => {
    const linked = link.issues
      .map((li) => `${li.idReadable} (${li.status ?? 'no status'}) "${li.summary}"`)
      .join(', ');
    return `  - ${link.linkType} [${link.direction}]: ${linked}`;
  });
  return `  Links:\n${lines.join('\n')}`;
}

function formatCandidate(issue: RecommendationIssue, context: RecommendationCandidateContext | undefined): string {
  const epicLine =
    !context || context.epicOutcomeContext === 'no-parent-epic'
      ? '  Parent Epic: none'
      : `  Parent Epic: ${context.parentEpicIdReadable ?? 'unknown'} (${context.epicOutcomeContext})`;
  return [
    `${issue.idReadable} — "${issue.summary}"`,
    `  Status: ${issue.status ?? 'unset'} | Priority: ${issue.priority ?? 'unset'}`,
    epicLine,
    `  Description: ${issue.description?.trim() || '(none)'}`,
    formatLinks(issue),
  ].join('\n');
}

function formatOutcome(outcome: Outcome): string {
  return [
    `Outcome: ${outcome.name}`,
    `Active epics: ${outcome.activeEpics.join(', ') || 'none listed'}`,
    `Success measure: ${outcome.successMeasure ?? '(not documented)'}`,
    `Target window: ${outcome.targetWindow ?? '(not documented)'}`,
    `Risks / dependencies: ${outcome.risks ?? '(not documented)'}`,
  ].join('\n');
}

/**
 * The full user-message text sent with the tool-use call. Bounded strictly
 * to the given candidate issues and the single selected Outcome — nothing
 * else is ever included (PLAN.md "Data scope"; docs/requirements.md §
 * Priority Desk "Ask for recommendation" → "Data scope").
 */
export function buildRecommendationPrompt(
  issues: RecommendationIssue[],
  candidateContext: RecommendationCandidateContext[],
  outcome: Outcome,
): string {
  const contextById = new Map(candidateContext.map((c) => [c.issueId, c]));
  const candidateBlock = issues.map((issue) => formatCandidate(issue, contextById.get(issue.id))).join('\n\n');
  return [
    'Selected Master Plan outcome:',
    formatOutcome(outcome),
    '',
    'Candidate issues (choose only from these):',
    candidateBlock,
  ].join('\n');
}

export const RECOMMENDATION_SYSTEM_PROMPT =
  'You are a work-prioritization adviser for a YouTrack-backed task board. You are given a ' +
  'small, already-bounded set of candidate issues and one selected Master Plan outcome. ' +
  'Recommend a ranked top three (plus 0-2 alternates) of the candidates that best advance the ' +
  'selected outcome, with qualitative, free-text evidence for each — never a numeric score. ' +
  'You never write, apply, or suggest applying any field change yourself; you only ' +
  'recommend. If the candidate set or outcome context genuinely is not enough to make a sound ' +
  'call, set clarification_needed to a concrete question instead of guessing, and leave ranked ' +
  'and alternates empty. Never recommend an issue id that is not one of the given candidates.';

// ─── Response parsing ───────────────────────────────────────────────────────

export interface RecommendationRawItem {
  issue_id: string;
  outcome_contribution: string;
  dependency_readiness: string;
  urgency: string;
  effort: string;
  risk: string;
}

export interface RecommendationRawInput {
  clarification_needed: string | null;
  ranked: RecommendationRawItem[];
  alternates: RecommendationRawItem[];
}

function toEvidence(raw: RecommendationRawItem): RecommendationEvidence {
  return {
    outcomeContribution: raw.outcome_contribution,
    dependencyReadiness: raw.dependency_readiness,
    urgency: raw.urgency,
    effort: raw.effort,
    risk: raw.risk,
  };
}

/**
 * Resolves a raw tool-use item against the ground-truth fetched issue list —
 * idReadable/summary are always read from `issues`, never trusted from the
 * model's own text, so a hallucinated summary can never reach the UI or the
 * audit comment. An item whose issue_id doesn't match any fetched issue
 * (the schema's enum should prevent this, but a defensive check costs
 * nothing) is dropped rather than rendered with fabricated data.
 */
function toItem(raw: RecommendationRawItem, issuesById: Map<string, RecommendationIssue>): RecommendationItem | null {
  const issue = issuesById.get(raw.issue_id);
  if (!issue) return null;
  return { issueId: issue.id, idReadable: issue.idReadable, summary: issue.summary, evidence: toEvidence(raw) };
}

/**
 * Parses the tool_use input into a RecommendationResult. A non-empty
 * `clarification_needed` always wins and produces a 'clarification' result
 * with empty ranked/alternates ignored, regardless of what the model also
 * put in ranked/alternates — the discriminated union on the wire (PLAN.md
 * "Clarification-only path") is enforced here, at the one place raw model
 * output becomes trusted application data.
 */
export function parseRecommendationToolInput(
  raw: RecommendationRawInput,
  issues: RecommendationIssue[],
): RecommendationResult {
  const clarification = typeof raw.clarification_needed === 'string' ? raw.clarification_needed.trim() : '';
  if (clarification) return { kind: 'clarification', question: clarification };

  const issuesById = new Map(issues.map((i) => [i.id, i]));
  const ranked = raw.ranked.map((r) => toItem(r, issuesById)).filter((i): i is RecommendationItem => i !== null);
  const alternates = raw.alternates
    .map((r) => toItem(r, issuesById))
    .filter((i): i is RecommendationItem => i !== null);

  if (ranked.length === 0) {
    return { kind: 'clarification', question: 'The model did not return a usable ranked recommendation.' };
  }

  return { kind: 'ranked', ranked, alternates };
}
