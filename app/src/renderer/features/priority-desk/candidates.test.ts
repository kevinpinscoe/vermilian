import { describe, it, expect } from 'vitest';
import {
  computeCandidates, compareCandidates, candidateSetReadiness, deriveEpicFilterOptions, deriveStatusFilterOptions, MAX_CANDIDATES,
  type Candidate, type QueryStatus,
} from './candidates';
import { parseYouTrackProjectFields } from '../../../shared/youtrackProjectFields';
import { projectFieldValuesFromMetadata } from '../../../shared/projectFieldValues';
import type { BoardIssue, BoardIssueFields, ParentEpic } from '../../../shared/workspace';
import type { Dismissals } from '../../../shared/boardConfig';

interface IssueOverrides {
  id?: string;
  idReadable?: string;
  summary?: string;
  resolved?: number | null;
  fields?: Partial<BoardIssueFields>;
  parentEpic?: ParentEpic | null;
  isEpic?: boolean;
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
    resolved: over.resolved ?? null, fields, parentEpic: over.parentEpic ?? null,
    isEpic: over.isEpic ?? false,
  };
}

const PRIORITIES = ['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor'];

function candidate(over: IssueOverrides, projectShortName = 'TEST', priorityOrder: string[] = PRIORITIES): Candidate {
  return { issue: issue(over), projectShortName, priorityOrder };
}

/** A project's own Status values (VERM-117); `resolved` lists those that resolve an issue. */
function projectValues(status: string[], resolved: string[], priority: string[] = []) {
  return projectFieldValuesFromMetadata(parseYouTrackProjectFields([
    { field: { name: 'Status' }, $type: 'StateProjectCustomField', bundle: { values: status.map((name, ordinal) => ({ name, ordinal, isResolved: resolved.includes(name) })) } },
    ...(priority.length ? [{ field: { name: 'Priority' }, $type: 'EnumProjectCustomField', bundle: { values: priority.map((name, ordinal) => ({ name, ordinal })) } }] : []),
  ]));
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

  it("ranks Priority by each issue's own project order, not a fixed list", () => {
    // P1/P2 are not in the old fixed list; each candidate carries its project's order.
    const p2 = candidate({ id: 'a', idReadable: 'OPS-1', fields: { dueDate: 1000, priority: 'P2' } }, 'OPS', ['P1', 'P2']);
    const p1 = candidate({ id: 'b', idReadable: 'OPS-2', fields: { dueDate: 1000, priority: 'P1' } }, 'OPS', ['P1', 'P2']);
    expect([p2, p1].sort(compareCandidates).map((c) => c.issue.id)).toEqual(['b', 'a']);
  });

  it('sorts a Priority its project order does not list last, like no Priority', () => {
    const unknown = candidate({ id: 'a', idReadable: 'TEST-1', fields: { dueDate: 1000, priority: 'Show-stopper' } }, 'TEST', []);
    const minor = candidate({ id: 'b', idReadable: 'TEST-2', fields: { dueDate: 1000, priority: 'Minor' } });
    expect([unknown, minor].sort(compareCandidates).map((c) => c.issue.id)).toEqual(['b', 'a']);
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

  it("excludes issues whose Status their project marks resolved — Done, Wont do and Fixed alike", () => {
    const issues = [
      issue({ id: 'a', fields: { status: 'Done' } }),
      issue({ id: 'b', fields: { status: 'To do' } }),
      issue({ id: 'c', fields: { status: 'Wont do' } }),
      issue({ id: 'd', fields: { status: 'Fixed' } }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: null,
      fieldValuesByProject: new Map([['TEST', projectValues(['To do', 'Done', 'Wont do', 'Fixed'], ['Done', 'Wont do', 'Fixed'])]]),
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('excludes a ticket YouTrack has resolved, whatever its Status is called', () => {
    const issues = [issue({ id: 'a', resolved: 1_700_000_000_000, fields: { status: 'Shipped' } }), issue({ id: 'b' })];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null, epicFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('treats one Status name as resolved in one project and open in another', () => {
    const { candidates } = computeCandidates({
      issuesByProject: new Map([
        ['OPEN', [issue({ id: 'open-consider', idReadable: 'OPEN-1', fields: { status: 'Consider' } })]],
        ['SHUT', [issue({ id: 'shut-consider', idReadable: 'SHUT-1', fields: { status: 'Consider' } })]],
      ]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: 'Consider', epicFilter: null,
      fieldValuesByProject: new Map([
        ['OPEN', projectValues(['To do', 'Consider', 'Done'], ['Done'])],
        ['SHUT', projectValues(['To do', 'Consider', 'Done'], ['Consider', 'Done'])],
      ]),
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['open-consider']);
  });

  it('excludes an issue that already holds Focus rank 1-3 — it belongs in Now mode instead', () => {
    const issues = [
      issue({ id: 'a', fields: { focus: 'Yes', focusRank: 2 } }),
      issue({ id: 'b', fields: { focus: 'Yes', focusRank: null } }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('keeps a Focus=Yes, unranked issue eligible (it appears starred, not excluded)', () => {
    const issues = [issue({ id: 'a', fields: { focus: 'Yes', focusRank: null } })];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['a']);
  });

  it('excludes an issue dismissed for the current week', () => {
    const issues = [issue({ id: 'a' })];
    const dismissals: Dismissals = { 'ws-1:a': { workspace: 'ws-1', issueId: 'a', dismissedWeekOf: '2026-09-14' } };
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null, epicFilter: null,
    });
    expect(candidates).toHaveLength(0);
  });

  it('re-includes an issue once the dismissal week has passed — expiration needs no cleanup step', () => {
    const issues = [issue({ id: 'a' })];
    const dismissals: Dismissals = { 'ws-1:a': { workspace: 'ws-1', issueId: 'a', dismissedWeekOf: '2026-09-07' } };
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null, epicFilter: null,
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
      epicFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('caps the displayed set at MAX_CANDIDATES but reports the true eligible count', () => {
    const issues = Array.from({ length: 10 }, (_, i) => issue({ id: `i${i}`, idReadable: `TEST-${i}` }));
    const { candidates, totalEligible } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: null,
    });
    expect(candidates).toHaveLength(MAX_CANDIDATES);
    expect(totalEligible).toBe(10);
  });

  it('scopes strictly to the projects passed in — a different workspace never leaks issues', () => {
    const issues = [issue({ id: 'a' })];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['OTHER', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: null,
    });
    expect(candidates.map((c) => c.projectShortName)).toEqual(['OTHER']);
    // (Workspace isolation itself is enforced by the caller only ever passing
    // that workspace's own projects in — see useChooseNextCandidates, which
    // reuses useActiveWorkspaceProjectShortNames exactly as focus.ts does.)
  });

  // ─── VERM-7: active-Epic filter ───────────────────────────────────────────

  const EPIC_A: ParentEpic = { id: 'epic-a', idReadable: 'TEST-100', summary: 'Epic A' };
  const EPIC_B: ParentEpic = { id: 'epic-b', idReadable: 'TEST-200', summary: 'Epic B' };

  it('restricts candidates to issues linked beneath the selected Epic', () => {
    const issues = [
      issue({ id: 'a', parentEpic: EPIC_A }),
      issue({ id: 'b', parentEpic: EPIC_B }),
      issue({ id: 'c', parentEpic: null }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: EPIC_A.id,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['a']);
  });

  it('applies no Epic-membership restriction when no Epic is selected', () => {
    const issues = [issue({ id: 'a', parentEpic: EPIC_A }), issue({ id: 'b', parentEpic: null })];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['a', 'b']);
  });

  it('applies the Status and Epic filters conjunctively', () => {
    const issues = [
      issue({ id: 'a', fields: { status: 'To do' }, parentEpic: EPIC_A }),
      issue({ id: 'b', fields: { status: 'In Progress' }, parentEpic: EPIC_A }),
      issue({ id: 'c', fields: { status: 'To do' }, parentEpic: EPIC_B }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: 'To do',
      epicFilter: EPIC_A.id,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['a']);
  });

  it('still excludes a ranked issue under an Epic filter', () => {
    const issues = [
      issue({ id: 'a', fields: { focus: 'Yes', focusRank: 1 }, parentEpic: EPIC_A }),
      issue({ id: 'b', parentEpic: EPIC_A }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: EPIC_A.id,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('still excludes a dismissed-this-week issue under an Epic filter', () => {
    const issues = [issue({ id: 'a', parentEpic: EPIC_A }), issue({ id: 'b', parentEpic: EPIC_A })];
    const dismissals: Dismissals = { 'ws-1:a': { workspace: 'ws-1', issueId: 'a', dismissedWeekOf: '2026-09-14' } };
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null, epicFilter: EPIC_A.id,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b']);
  });

  it('keeps deterministic Due Date/Priority/idReadable ordering unchanged after Epic filtering', () => {
    const issues = [
      issue({ id: 'a', idReadable: 'TEST-2', fields: { dueDate: 2000 }, parentEpic: EPIC_A }),
      issue({ id: 'b', idReadable: 'TEST-1', fields: { dueDate: 1000 }, parentEpic: EPIC_A }),
      issue({ id: 'c', idReadable: 'TEST-3', fields: { dueDate: 1500 }, parentEpic: EPIC_B }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: EPIC_A.id,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['b', 'a']);
  });

  it('keeps the seven-item cap unchanged after Epic filtering', () => {
    const issues = Array.from({ length: 10 }, (_, i) =>
      issue({ id: `i${i}`, idReadable: `TEST-${i}`, parentEpic: EPIC_A }));
    const { candidates, totalEligible } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: EPIC_A.id,
    });
    expect(candidates).toHaveLength(MAX_CANDIDATES);
    expect(totalEligible).toBe(10);
  });

  // ─── VERM-7 review finding: an Epic is a container, never a candidate ─────

  it('never presents an Epic issue itself as a Choose-next candidate', () => {
    const issues = [
      issue({ id: 'epic', idReadable: 'TEST-3', isEpic: true }),
      issue({ id: 'task', idReadable: 'TEST-1' }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: null,
      epicFilter: null,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['task']);
  });

  it('excludes an Epic issue even when it would otherwise match every other filter', () => {
    const issues = [
      issue({ id: 'epic', idReadable: 'TEST-3', fields: { status: 'To do' }, parentEpic: EPIC_A, isEpic: true }),
      issue({ id: 'task', idReadable: 'TEST-1', fields: { status: 'To do' }, parentEpic: EPIC_A }),
    ];
    const { candidates } = computeCandidates({
      issuesByProject: new Map([['TEST', issues]]),
      dismissals: noDismissals, workspaceId: 'ws-1', weekOf: '2026-09-14', statusFilter: 'To do',
      epicFilter: EPIC_A.id,
    });
    expect(candidates.map((c) => c.issue.id)).toEqual(['task']);
  });
});

describe('deriveEpicFilterOptions', () => {
  const EPIC_A: ParentEpic = { id: 'epic-a', idReadable: 'TEST-100', summary: 'Epic A' };
  const EPIC_B: ParentEpic = { id: 'epic-b', idReadable: 'TEST-200', summary: 'Epic B' };

  it('returns the distinct parent Epics across all fetched issues, sorted by idReadable', () => {
    const issues = [
      issue({ id: 'a', parentEpic: EPIC_B }),
      issue({ id: 'b', parentEpic: EPIC_A }),
      issue({ id: 'c', parentEpic: EPIC_A }),
      issue({ id: 'd', parentEpic: null }),
    ];
    expect(deriveEpicFilterOptions(new Map([['TEST', issues]]))).toEqual([EPIC_A, EPIC_B]);
  });

  it('is not affected by Status, rank, or dismissal — an Epic option persists even if its only child is otherwise ineligible', () => {
    const issues = [issue({ id: 'a', fields: { status: 'Done' }, parentEpic: EPIC_A })];
    expect(deriveEpicFilterOptions(new Map([['TEST', issues]]))).toEqual([EPIC_A]);
  });

  it('returns an empty list when no issue has a resolvable parent Epic', () => {
    const issues = [issue({ id: 'a', parentEpic: null })];
    expect(deriveEpicFilterOptions(new Map([['TEST', issues]]))).toEqual([]);
  });

  it('dedupes the same Epic when it is referenced from issues in different projects', () => {
    // Epic ids are globally unique in YouTrack regardless of which project an
    // issue linking to them lives in — the Map key is the Epic's own id, so
    // this can never double-count or collide with a different Epic.
    const issuesByProject = new Map([
      ['TEST', [issue({ id: 'a', idReadable: 'TEST-1', parentEpic: EPIC_A })]],
      ['TST2', [issue({ id: 'b', idReadable: 'TST2-1', parentEpic: EPIC_A })]],
    ]);
    expect(deriveEpicFilterOptions(issuesByProject)).toEqual([EPIC_A]);
  });
});

describe('deriveStatusFilterOptions (VERM-117)', () => {
  it('offers a Status that is open work in at least one project, in the projects\' own order', () => {
    const values = new Map([
      ['OPEN', projectValues(['Not yet started', 'Consider', 'Done', 'Wont do'], ['Done', 'Wont do'])],
      ['SHUT', projectValues(['Triage', 'Consider', 'Fixed'], ['Consider', 'Fixed'])],
    ]);
    // Consider: open in OPEN, resolved in SHUT — still offered. Done, Wont do, Fixed: resolved everywhere.
    expect(deriveStatusFilterOptions(['OPEN', 'SHUT'], values)).toEqual(['Not yet started', 'Consider', 'Triage']);
  });

  it('offers nothing for a project whose values are not known', () => {
    expect(deriveStatusFilterOptions(['TEST'], new Map())).toEqual([]);
  });
});
