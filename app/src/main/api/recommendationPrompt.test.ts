import { describe, it, expect } from 'vitest';
import {
  buildRecommendationTool,
  buildRecommendationPrompt,
  parseRecommendationToolInput,
  type RecommendationRawInput,
  type RecommendationRawItem,
} from './recommendationPrompt';
import type { RecommendationIssue } from './youtrack';
import type { RecommendationCandidateContext } from '../../shared/ipc';
import type { Outcome } from '../../shared/masterPlan';

function issue(over: Partial<RecommendationIssue> = {}): RecommendationIssue {
  return {
    id: 'p-1',
    idReadable: 'TEST-1',
    summary: 'Fix the thing',
    description: 'Some detail.',
    status: 'To do',
    priority: 'Normal',
    links: [],
    ...over,
  };
}

const outcome: Outcome = {
  name: 'Ship the desk',
  activeEpics: ['TEST-3'],
  successMeasure: 'Trusted workflow',
  targetWindow: '2026 Q3',
  risks: 'none',
};

function rawItem(over: Partial<RecommendationRawItem> = {}): RecommendationRawItem {
  return {
    issue_id: 'p-1',
    outcome_contribution: 'Advances it directly.',
    dependency_readiness: 'No blockers.',
    urgency: 'Due soon.',
    effort: 'Small.',
    risk: 'Low.',
    ...over,
  };
}

describe('buildRecommendationTool', () => {
  it('constrains issue_id to exactly the given candidate ids', () => {
    const tool = buildRecommendationTool(['p-1', 'p-2']);
    const schema = tool.input_schema as { properties: { ranked: { items: { properties: { issue_id: { enum: string[] } } } } } };
    expect(schema.properties.ranked.items.properties.issue_id.enum).toEqual(['p-1', 'p-2']);
  });

  it('every evidence field is typed as a free-text string — never numeric', () => {
    const tool = buildRecommendationTool(['p-1']);
    const schema = tool.input_schema as {
      properties: { ranked: { items: { properties: Record<string, { type: string }> } } };
    };
    const props = schema.properties.ranked.items.properties;
    for (const key of ['outcome_contribution', 'dependency_readiness', 'urgency', 'effort', 'risk']) {
      expect(props[key].type).toBe('string');
    }
  });
});

describe('buildRecommendationPrompt', () => {
  it('includes only the given candidates and the selected outcome — nothing else', () => {
    const prompt = buildRecommendationPrompt([issue({ id: 'p-1', idReadable: 'TEST-1' })], [], outcome);
    expect(prompt).toContain('TEST-1');
    expect(prompt).toContain('Ship the desk');
    expect(prompt).toContain('2026 Q3');
  });

  it('carries the resolved epic→outcome context for a candidate, not a re-derivation', () => {
    const context: RecommendationCandidateContext[] = [
      { issueId: 'p-1', epicOutcomeContext: 'matches-selected-outcome', parentEpicIdReadable: 'TEST-3' },
    ];
    const prompt = buildRecommendationPrompt([issue({ id: 'p-1' })], context, outcome);
    expect(prompt).toContain('TEST-3');
    expect(prompt).toContain('matches-selected-outcome');
  });

  it('a candidate with no parent epic states so plainly', () => {
    const context: RecommendationCandidateContext[] = [
      { issueId: 'p-1', epicOutcomeContext: 'no-parent-epic', parentEpicIdReadable: null },
    ];
    const prompt = buildRecommendationPrompt([issue({ id: 'p-1' })], context, outcome);
    expect(prompt).toContain('Parent Epic: none');
  });
});

describe('parseRecommendationToolInput', () => {
  const issues = [issue({ id: 'p-1', idReadable: 'TEST-1' }), issue({ id: 'p-2', idReadable: 'TEST-2' })];

  it('parses a ranked result with alternates, resolving idReadable/summary from ground truth', () => {
    const raw: RecommendationRawInput = {
      clarification_needed: null,
      ranked: [rawItem({ issue_id: 'p-1' })],
      alternates: [rawItem({ issue_id: 'p-2' })],
    };
    const result = parseRecommendationToolInput(raw, issues);
    expect(result.kind).toBe('ranked');
    if (result.kind !== 'ranked') throw new Error('expected ranked');
    expect(result.ranked).toEqual([
      { issueId: 'p-1', idReadable: 'TEST-1', summary: 'Fix the thing', evidence: {
        outcomeContribution: 'Advances it directly.', dependencyReadiness: 'No blockers.',
        urgency: 'Due soon.', effort: 'Small.', risk: 'Low.',
      } },
    ]);
    expect(result.alternates).toHaveLength(1);
    expect(result.alternates[0].idReadable).toBe('TEST-2');
  });

  it('parses a clarification-only shape with no ranked/alternates', () => {
    const raw: RecommendationRawInput = {
      clarification_needed: 'Which of these matters more to you right now?',
      ranked: [],
      alternates: [],
    };
    const result = parseRecommendationToolInput(raw, issues);
    expect(result).toEqual({ kind: 'clarification', question: 'Which of these matters more to you right now?' });
  });

  it('clarification_needed wins even if the model also populated ranked/alternates', () => {
    const raw: RecommendationRawInput = {
      clarification_needed: 'Not enough signal.',
      ranked: [rawItem({ issue_id: 'p-1' })],
      alternates: [],
    };
    const result = parseRecommendationToolInput(raw, issues);
    expect(result.kind).toBe('clarification');
  });

  it('drops a ranked item whose issue_id is not one of the fetched issues, defensively', () => {
    const raw: RecommendationRawInput = {
      clarification_needed: null,
      ranked: [rawItem({ issue_id: 'p-1' }), rawItem({ issue_id: 'not-a-real-id' })],
      alternates: [],
    };
    const result = parseRecommendationToolInput(raw, issues);
    expect(result.kind).toBe('ranked');
    if (result.kind !== 'ranked') throw new Error('expected ranked');
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].issueId).toBe('p-1');
  });

  it('falls back to a clarification result when every ranked item is invalid', () => {
    const raw: RecommendationRawInput = {
      clarification_needed: null,
      ranked: [rawItem({ issue_id: 'not-a-real-id' })],
      alternates: [],
    };
    const result = parseRecommendationToolInput(raw, issues);
    expect(result.kind).toBe('clarification');
  });
});
