import { describe, it, expect } from 'vitest';
import {
  computeCandidates, compareCandidates, candidateSetReadiness, MAX_CANDIDATES,
  type Candidate, type QueryStatus,
} from './candidates';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import type { Dismissals } from '../../../shared/boardConfig';

interface IssueOverrides {
  id?: string;
  idReadable?: string;
  summary?: string;
  resolved?: number | null;
  fields?: Partial<BoardIssueFields>;
}

function issue(over: IssueOverrides): BoardIssue {
  const fields = {
    status: 'To do', priority: null, category: null, dueDate: null, ticket: null,
    ticketLink: null, relatedLink: null, notes: null, dateTimeEntered: null, assignee: null,
    ghosttyTabName: null, repoUrl: null, workingBranch: null, trackingFileUrl: null,
    todoFileUrl: null, projectHealth: null, progressPercent: null, nextStatusDue: null,
    reportingCadence: null, baseBranch: null, pullRequestUrl: null, artifactUrl: null,
    lastReportedCommit: null, issueDomain: null, editHost: null, affectedHost: null,
    focus: null, focusRank: null, whyNow: null,
    ...over.fields,
  } as BoardIssueFields;
  return {
    id: over.id ?? 'p-1', idReadable: over.idReadable ?? 'TEST-1', summary: over.summary ?? 'Summary',
    resolved: over.resolved ?? null, fields,
  };
}

function candidate(over: IssueOverrides, projectShortName = 'TEST'): Candidate {
  return { issue: issue(over), projectShortName };
}

describe('compareCandidates', () => {
  it('sorts by Due Date ascending', () => {
    const a = candidate({ id: 'a', idReadable: 'TEST-1', fields: { dueDate: 2000 } });
    const b = candidate({ id: 'b', idReadable: 'TEST-2', fields: { dueDate: 1000 } });
    expect([a, b].sort(compareCandidates).map((c) => c.issue.id)).toEqual(['b', 'a']);
  });

  it('sorts issues with no Due Date last', () => {
    const withDate = candidate({ id: 'a', idReadable: 'TEST-1', fields: { dueDate: 1000 } });
    const noDate = candidate({ id: 'b', idReadable: 'TEST-2', fields: { dueDate: null } });
    expect([noDate, withDate].sort(compareCandidates).map((c) => c.issue.id)).toEqual(['a', 'b']);
  });

  it('breaks a Due Date tie by Priority ordinal, most urgent first', () => {
    const normal = candidate({ id: 'a', idReadable: 'TEST-1', fields: { dueDate: 1000, priority: 'Normal' } });
    const showStopper = candidate({ id: 'b', idReadable: 'TEST-2', fields: { dueDate: 1000, priority: 'Show-stopper' } });
    expect([normal, showStopper].sort(compareCandidates).map((c) => c.issue.id)).toEqual(['b', 'a']);
  });

  it('sorts a missing Priority after every named Priority', () => {
    const noPriority = candidate({ id: 'a', idReadable: 'TEST-1', fields: { dueDate: 1000, priority: null } });
    const minor = candidate({ id: 'b', idReadable: 'TEST-2', fields: { dueDate: 1000, priority: 'Minor' } });
    expect([noPriority, minor].sort(compareCandidates).map((c) => c.issue.id)).toEqual(['b', 'a']);
  });

  it('breaks a Due Date + Priority tie by idReadable ascending, the final tiebreak', () => {
    const two = candidate({ id: 'a', idReadable: 'TEST-2', fields: { dueDate: 1000, priority: 'Major' } });
    const one = candidate({ id: 'b', idReadable: 'TEST-1', fields: { dueDate: 1000, priority: 'Major' } });
    expect([two, one].sort(compareCandidates).map((c) => c.issue.idReadable)).toEqual(['TEST-1', 'TEST-2']);
  });
});

describe('candidateSetReadiness', () => {
  const loaded: QueryStatus = { hasData: true, isError: false };
  const pending: QueryStatus = { hasData: false, isError: false };
  const errored: QueryStatus = { hasData: false, isError: true };

  it('is not loading and not errored once every project and dismissals query has data', () => {
    expect(candidateSetReadiness([loaded, loaded], loaded)).toEqual({ isLoading: false, isError: false });
  });

  it('is loading while any one project query is still pending, even if others already have data', () => {
    expect(candidateSetReadiness([loaded, pending], loaded)).toEqual({ isLoading: true, isError: false });
  });

  it('is loading while the dismissals query is pending, even if every project has data', () => {
    expect(candidateSetReadiness([loaded, loaded], pending)).toEqual({ isLoading: true, isError: false });
  });

  it('is an error, not "loading", when a project query errors — never treated as an empty project', () => {
    expect(candidateSetReadiness([loaded, errored], loaded)).toEqual({ isLoading: false, isError: true });
  });

  it('is an error when the dismissals query errors', () => {
    expect(candidateSetReadiness([loaded, loaded], errored)).toEqual({ isLoading: false, isError: true });
  });

  it('reports no pending or error state for a workspace with no projects', () => {
    expect(candidateSetReadiness([], loaded)).toEqual({ isLoading: false, isError: false });
  });
});

describe('computeCandidates', () => {
  const noDismissals: Dismissals = {};

  it('excludes issues whose Status is Done', () => {
    const issues = [issue({ id: 'a', fields: { status: 'Done' } }), issue({ id: 'b', fields: { status: 'To do' } })];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('excludes an issue that already holds Focus rank 1-3 — it belongs in Now mode instead', () => {
    const issues = [
      issue({ id: 'a', fields: { focus: 'Yes', focusRank: 2 } }),
      issue({ id: 'b', fields: { focus: 'Yes', focusRank: null } }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('keeps a Focus=Yes, unranked issue eligible (it appears starred, not excluded)', () => {
    const issues = [issue({ id: 'a', fields: { focus: 'Yes', focusRank: null } })];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['a']);
  });

  it('excludes an issue dismissed for the current week', () => {
    const issues = [issue({ id: 'a' })];
    const dismissals: Dismissals = { 'ws-1:a': { workspace: 'ws-1', issueId: 'a', dismissedWeekOf: '2026-09-14' } };
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
    });
    expect(candidates).toHaveLength(0);
  });

  it('re-includes an issue once the dismissal week has passed — expiration needs no cleanup step', () => {
    const issues = [issue({ id: 'a' })];
    const dismissals: Dismissals = { 'ws-1:a': { workspace: 'ws-1', issueId: 'a', dismissedWeekOf: '2026-09-07' } };
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['a']);
  });

  it('applies the Status filter when one is set', () => {
    const issues = [
      issue({ id: 'a', fields: { status: 'To do' } }),
      issue({ id: 'b', fields: { status: 'In Progress' } }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: 'In Progress',
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('caps the displayed set at MAX_CANDIDATES but reports the true eligible count', () => {
    const issues = Array.from({ length: 10 }, (_, i) => issue({ id: `i${i}`, idReadable: `TEST-${i}` }));
    const { candidates, totalEligible } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
    });
    expect(candidates).toHaveLength(MAX_CANDIDATES);
    expect(totalEligible).toBe(10);
  });

  it('scopes strictly to the projects passed in — a different workspace never leaks issues', () => {
    const issues = [issue({ id: 'a' })];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['OTHER', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
    });
    expect(candidates.map((c) => c.projectShortName)).toEqual(['OTHER']);
    // (Workspace isolation itself is enforced by the caller only ever passing
    // that workspace's own projects in — see useChooseNextCandidates, which
    // reuses useActiveWorkspaceProjectShortNames exactly as focus.ts does.)
  });
});
