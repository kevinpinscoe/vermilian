import { describe, it, expect } from 'vitest';
import { buildCandidateContext, planConfirmationWrites } from './recommendationApi';
import type { Candidate } from './candidates';
import type { BoardIssue, BoardIssueFields, ParentEpic } from '../../../shared/workspace';
import type { Outcome } from '../../../shared/masterPlan';
import type { RecommendationItem } from '../../../shared/ipc';

interface IssueOverrides {
  id?: string;
  idReadable?: string;
  parentEpic?: ParentEpic | null;
}

function issue(over: IssueOverrides = {}): BoardIssue {
  const fields = {
    status: 'To do', priority: null, category: null, dueDate: null, ticket: null,
    ticketLink: null, relatedLink: null, notes: null, dateTimeEntered: null, assignee: null,
    ghosttyTabName: null, repoUrl: null, workingBranch: null, trackingFileUrl: null,
    todoFileUrl: null, projectHealth: null, progressPercent: null, nextStatusDue: null,
    reportingCadence: null, baseBranch: null, pullRequestUrl: null, artifactUrl: null,
    lastReportedCommit: null, issueDomain: null, editHost: null, affectedHost: null,
    focus: null, focusRank: null, whyNow: null,
  } as BoardIssueFields;
  return {
    id: over.id ?? 'p-1', idReadable: over.idReadable ?? 'TEST-1', summary: 'Summary',
    resolved: null, fields, parentEpic: over.parentEpic ?? null, isEpic: false,
  };
}

function candidate(over: IssueOverrides = {}, projectShortName = 'TEST'): Candidate {
  return { issue: issue(over), projectShortName };
}

const EPIC_3: ParentEpic = { id: 'e-3', idReadable: 'TEST-3', summary: 'Epic three' };
const EPIC_4: ParentEpic = { id: 'e-4', idReadable: 'TEST-4', summary: 'Epic four' };

const outcomeA: Outcome = {
  name: 'Outcome A', activeEpics: ['TEST-3'], successMeasure: null, targetWindow: null, risks: null,
};
const outcomeB: Outcome = {
  name: 'Outcome B', activeEpics: ['TEST-4'], successMeasure: null, targetWindow: null, risks: null,
};

describe('buildCandidateContext', () => {
  it('is bounded to exactly the given candidates — one context entry per candidate, same ids', () => {
    const candidates = [candidate({ id: 'a' }), candidate({ id: 'b' })];
    const context = buildCandidateContext(candidates, [outcomeA], outcomeA);
    expect(context.map((c) => c.issueId).sort()).toEqual(['a', 'b']);
    expect(context).toHaveLength(candidates.length);
  });

  it('marks a candidate with no parent epic as no-parent-epic', () => {
    const context = buildCandidateContext([candidate({ parentEpic: null })], [outcomeA], outcomeA);
    expect(context[0]).toEqual({ issueId: 'p-1', epicOutcomeContext: 'no-parent-epic', parentEpicIdReadable: null });
  });

  it('marks a candidate whose epic matches the selected outcome as matches-selected-outcome', () => {
    const context = buildCandidateContext([candidate({ parentEpic: EPIC_3 })], [outcomeA, outcomeB], outcomeA);
    expect(context[0].epicOutcomeContext).toBe('matches-selected-outcome');
    expect(context[0].parentEpicIdReadable).toBe('TEST-3');
  });

  it('marks a candidate whose epic matches a different outcome as different-outcome', () => {
    const context = buildCandidateContext([candidate({ parentEpic: EPIC_4 })], [outcomeA, outcomeB], outcomeA);
    expect(context[0].epicOutcomeContext).toBe('different-outcome');
  });

  it('marks a candidate whose epic matches no outcome at all as no-outcome-association', () => {
    const unlinkedEpic: ParentEpic = { id: 'e-9', idReadable: 'TEST-9', summary: 'Unlinked' };
    const context = buildCandidateContext([candidate({ parentEpic: unlinkedEpic })], [outcomeA, outcomeB], outcomeA);
    expect(context[0].epicOutcomeContext).toBe('no-outcome-association');
  });

  it('never re-derives the association — reuses resolveEpicOutcome (a conflict resolves the same way here)', () => {
    // Same epic idReadable listed under two outcomes — resolveEpicOutcome
    // reports 'conflict'; buildCandidateContext still classifies it against
    // the *selected* outcome specifically, using that same resolution.
    const conflictingA: Outcome = { ...outcomeA, activeEpics: ['TEST-3'] };
    const conflictingB: Outcome = { ...outcomeB, activeEpics: ['TEST-3'] };
    const context = buildCandidateContext([candidate({ parentEpic: EPIC_3 })], [conflictingA, conflictingB], conflictingA);
    expect(context[0].epicOutcomeContext).toBe('matches-selected-outcome');
  });
});

function recItem(issueId: string): RecommendationItem {
  return {
    issueId,
    idReadable: issueId.toUpperCase(),
    summary: 'Summary',
    evidence: { outcomeContribution: '', dependencyReadiness: '', urgency: '', effort: '', risk: '' },
  };
}

describe('planConfirmationWrites — each action writes exactly what is documented, nothing more', () => {
  const ranked = [recItem('a'), recItem('b'), recItem('c'), recItem('d')]; // 4th (alternate-ish) never touched
  const noneFocused = () => false;

  it('apply-to-desk plans setRank 1/2/3 on the top three only, never touching a 4th item', () => {
    const writes = planConfirmationWrites(ranked, 'apply-to-desk', noneFocused);
    expect(writes).toEqual([
      { kind: 'setRank', issueId: 'a', rank: 1 },
      { kind: 'setRank', issueId: 'b', rank: 2 },
      { kind: 'setRank', issueId: 'c', rank: 3 },
    ]);
  });

  it('star-only plans toggleFocusOn only for top-three items not already focused', () => {
    const alreadyFocused = (id: string) => id === 'b';
    const writes = planConfirmationWrites(ranked, 'star-only', alreadyFocused);
    expect(writes).toEqual([
      { kind: 'toggleFocusOn', issueId: 'a' },
      { kind: 'toggleFocusOn', issueId: 'c' },
    ]);
  });

  it('star-only plans no writes at all when the top three are already focused', () => {
    const writes = planConfirmationWrites(ranked.slice(0, 3), 'star-only', () => true);
    expect(writes).toEqual([]);
  });

  it('keep-my-order plans no writes at all', () => {
    expect(planConfirmationWrites(ranked, 'keep-my-order', noneFocused)).toEqual([]);
  });

  it('never plans a write for anything beyond the top three, even with more ranked items', () => {
    const five = [...ranked, recItem('e')];
    const writes = planConfirmationWrites(five, 'apply-to-desk', noneFocused);
    expect(writes.map((w) => w.issueId)).toEqual(['a', 'b', 'c']);
  });
});
