import { describe, it, expect } from 'vitest';
import { buildAuditComment, maybeBuildAuditComment } from './recommendationAudit';
import type { RecommendationItem, RecommendationResult } from './ipc';

function item(over: Partial<RecommendationItem> = {}): RecommendationItem {
  return {
    issueId: 'p-1',
    idReadable: 'TEST-1',
    summary: 'Do the thing',
    evidence: {
      outcomeContribution: 'Directly advances it.',
      dependencyReadiness: 'No blockers.',
      urgency: 'Due soon.',
      effort: 'Small.',
      risk: 'Low.',
    },
    ...over,
  };
}

const rankedResult = (over: Partial<Extract<RecommendationResult, { kind: 'ranked' }>> = {}): RecommendationResult => ({
  kind: 'ranked',
  ranked: [item()],
  alternates: [],
  ...over,
});

describe('buildAuditComment', () => {
  it('lists every ranked item with its evidence', () => {
    const text = buildAuditComment({ ranked: [item({ idReadable: 'TEST-1' }), item({ idReadable: 'TEST-2' })], alternates: [] }, 'apply-to-desk');
    expect(text).toContain('TEST-1');
    expect(text).toContain('TEST-2');
    expect(text).toContain('Outcome contribution: Directly advances it.');
    expect(text).toContain('Dependency readiness: No blockers.');
  });

  it('includes alternates only when present', () => {
    const withoutAlternates = buildAuditComment({ ranked: [item()], alternates: [] }, 'keep-my-order');
    expect(withoutAlternates).not.toContain('Alternates:');

    const withAlternates = buildAuditComment(
      { ranked: [item()], alternates: [item({ idReadable: 'TEST-9' })] },
      'keep-my-order',
    );
    expect(withAlternates).toContain('Alternates:');
    expect(withAlternates).toContain('TEST-9');
  });

  it('states the chosen action, distinctly per action', () => {
    const apply = buildAuditComment({ ranked: [item()], alternates: [] }, 'apply-to-desk');
    const star = buildAuditComment({ ranked: [item()], alternates: [] }, 'star-only');
    const keep = buildAuditComment({ ranked: [item()], alternates: [] }, 'keep-my-order');
    expect(apply).toContain('Apply to desk');
    expect(star).toContain('Star only');
    expect(keep).toContain('Keep my order');
    expect(keep).toContain('no fields changed');
  });
});

describe('maybeBuildAuditComment — gating', () => {
  it('returns null with no action chosen, even for a ranked result', () => {
    expect(maybeBuildAuditComment(rankedResult(), null)).toBeNull();
  });

  it('returns null for a clarification-only result, regardless of action', () => {
    const clarification: RecommendationResult = { kind: 'clarification', question: 'Which matters more?' };
    expect(maybeBuildAuditComment(clarification, 'apply-to-desk')).toBeNull();
    expect(maybeBuildAuditComment(clarification, 'star-only')).toBeNull();
    expect(maybeBuildAuditComment(clarification, 'keep-my-order')).toBeNull();
  });

  it('builds a comment only when both a ranked result AND an action are present', () => {
    const text = maybeBuildAuditComment(rankedResult(), 'apply-to-desk');
    expect(text).not.toBeNull();
    expect(text).toContain('TEST-1');
  });
});
