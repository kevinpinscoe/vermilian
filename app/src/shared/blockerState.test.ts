import { describe, expect, it } from 'vitest';
import type { BoardIssue, BoardIssueFields, StatusRole } from './workspace';
import { FIELD_KEYS, type FieldKey } from './fields';
import {
  JIRA_DEFAULT_PREREQUISITE_LINK_TYPES,
  YOUTRACK_DEFAULT_PREREQUISITE_LINK_TYPES,
  type IssueLink,
} from './issueLink';
import {
  LINKS_NOT_READ,
  blockerStateOf,
  describeBlockerReport,
  describeOrderConflict,
  describePrerequisite,
  describeStatusBlock,
  type BlockerContext,
  type RunwayPlace,
} from './blockerState';

// Synthetic keys only, as the proposal's worked example: READ-14 depends on
// SYNC-3 (on the Runway) and on PLAT-40 (another team's, external).

const EMPTY_FIELDS = Object.fromEntries(FIELD_KEYS.map((k): [FieldKey, null] => [k, null])) as BoardIssueFields;

interface IssueOpts {
  status?: string;
  resolved?: number | null;
  statusRole?: StatusRole | null;
  links?: IssueLink[] | undefined;
}

function issue(key: string, opts: IssueOpts = {}): BoardIssue {
  const i: BoardIssue = {
    id: `2-${key}`,
    idReadable: key,
    summary: `${key} summary`,
    resolved: opts.resolved ?? null,
    fields: { ...EMPTY_FIELDS, status: opts.status ?? 'To do' },
    parentEpic: null,
    isEpic: false,
  };
  if ('links' in opts) i.links = opts.links;
  else i.links = [];
  if (opts.statusRole !== undefined) i.statusRole = opts.statusRole;
  return i;
}

/** A link from the ticket's side; inward Depend means "depends on" the linked ticket. */
function link(
  key: string,
  resolved: boolean | null,
  { type = 'Depend', direction = 'inward', status, id }: { type?: string; direction?: 'inward' | 'outward' | 'both'; status?: string | null; id?: string } = {},
): IssueLink {
  return {
    type,
    directed: direction !== 'both',
    direction,
    verb: direction === 'inward' ? 'depends on' : 'is required for',
    issue: { id: id ?? `2-${key}`, key, summary: `${key} summary`, resolved, ...(status !== undefined ? { status } : {}) },
  };
}

const place = (runwayNumber: number, i: BoardIssue | null, localId = i?.id ?? 'unread'): RunwayPlace => ({ localId, runwayNumber, issue: i });

const yt = (runway: RunwayPlace[] = []): BlockerContext => ({ prerequisiteTypes: YOUTRACK_DEFAULT_PREREQUISITE_LINK_TYPES, runway });

describe('blockerStateOf: the four states (VERM-97)', () => {
  it('Done: a resolved ticket, whatever its links or status say', () => {
    const r = blockerStateOf(issue('READ-14', { resolved: 1, status: 'BLOCKED', links: [link('SYNC-3', false)] }), yt());
    expect(r.state).toBe('done');
    expect(r.blockers).toEqual([]);
    expect(r.statusBlock).toBeNull();
    expect(describeBlockerReport(r)).toBe('Done');
  });

  it('Done: a Jira ticket whose status maps to done', () => {
    expect(blockerStateOf(issue('OPS-956', { statusRole: 'done' }), yt()).state).toBe('done');
  });

  it('Ready: links read and every prerequisite resolved', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('SYNC-3', true), link('PLAT-41', false, { direction: 'outward' })] }), yt());
    expect(r.state).toBe('ready');
    expect(describeBlockerReport(r)).toBe('Ready');
  });

  it('Ready: links read and none of a prerequisite type', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('READ-9', false, { type: 'Relates', direction: 'both' }), link('READ-1', false, { type: 'Subtask' })] }), yt());
    expect(r.state).toBe('ready');
  });

  it('Blocked: a prerequisite known to be open', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('SYNC-3', false), link('SYNC-2', true)] }), yt());
    expect(r.state).toBe('blocked');
    expect(r.blockers.map((b) => b.key)).toEqual(['SYNC-3']);
    expect(r.statusBlock).toBeNull();
  });

  it('Unknown: the links were not read', () => {
    const r = blockerStateOf(issue('READ-14', { links: undefined }), yt());
    expect(r.state).toBe('unknown');
    expect(r.linksUnreadable).toBe(LINKS_NOT_READ);
    expect(describeBlockerReport(r)).toBe('Unknown: Links were not read');
  });

  it('Unknown: the caller says the links cannot be trusted (offline, stale), even though they were read', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('SYNC-3', false)] }), yt(), { linksUnavailable: 'Offline' });
    expect(r.state).toBe('unknown');
    expect(r.blockers).toEqual([]);
    expect(r.linksUnreadable).toBe('Offline');
  });

  it('Unknown: nothing open is known and a prerequisite\'s state was not reported', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('SYNC-2', true), link('SYNC-5', null)] }), yt());
    expect(r.state).toBe('unknown');
    expect(r.unknownPrerequisites.map((p) => p.key)).toEqual(['SYNC-5']);
    expect(describeBlockerReport(r)).toBe('Unknown: status unknown for SYNC-5');
  });
});

describe('blockerStateOf: Blocked wins over unknown (Kevin, VERM-97)', () => {
  it('lists the known open blockers and identifies the prerequisites whose state is unknown', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('SYNC-5', null), link('SYNC-3', false)] }), yt());
    expect(r.state).toBe('blocked');
    expect(r.blockers.map((b) => b.key)).toEqual(['SYNC-3']);
    expect(r.unknownPrerequisites.map((p) => p.key)).toEqual(['SYNC-5']);
    expect(describeBlockerReport(r)).toBe('Blocked by SYNC-3 (external). Status unknown for SYNC-5 (external).');
  });
});

describe('blockerStateOf: blocked by the ticket\'s own status (decision E and its VERM-97 clarification)', () => {
  it('a YouTrack BLOCKED status with no link is Blocked', () => {
    const r = blockerStateOf(issue('READ-14', { status: 'BLOCKED' }), yt());
    expect(r.state).toBe('blocked');
    expect(r.statusBlock).toBe('no-link');
    expect(r.blockers).toEqual([]);
    expect(describeStatusBlock(r.statusBlock)).toBe('Blocked by status, no linked prerequisite.');
  });

  it('a BLOCKED status stays Blocked when every linked prerequisite is resolved', () => {
    const r = blockerStateOf(issue('READ-14', { status: 'BLOCKED', links: [link('SYNC-3', true)] }), yt());
    expect(r.state).toBe('blocked');
    expect(r.statusBlock).toBe('links-resolved');
    expect(describeStatusBlock(r.statusBlock)).toBe('Blocked by status. All linked prerequisites are resolved.');
  });

  it('a non-prerequisite link does not turn "no linked prerequisite" into "all resolved"', () => {
    const r = blockerStateOf(issue('READ-14', { status: 'BLOCKED', links: [link('READ-9', false, { type: 'Relates', direction: 'both' })] }), yt());
    expect(r.statusBlock).toBe('no-link');
  });

  it('a BLOCKED status with unread links is Blocked, not Unknown, and says the links are unknown', () => {
    const r = blockerStateOf(issue('READ-14', { status: 'BLOCKED', links: undefined }), yt());
    expect(r.state).toBe('blocked');
    expect(r.statusBlock).toBe('links-unknown');
    expect(describeBlockerReport(r)).toBe('Blocked by status. Links unknown: Links were not read.');
  });

  it('a BLOCKED status alongside an open prerequisite lists the blocker', () => {
    const r = blockerStateOf(issue('READ-14', { status: 'BLOCKED', links: [link('SYNC-3', false)] }), yt());
    expect(r.statusBlock).toBe('with-blockers');
    expect(r.blockers.map((b) => b.key)).toEqual(['SYNC-3']);
  });

  it('a Jira status mapped to blocked counts; a Jira status named BLOCKED but mapped otherwise does not', () => {
    const jira: BlockerContext = { prerequisiteTypes: JIRA_DEFAULT_PREREQUISITE_LINK_TYPES, runway: [] };
    expect(blockerStateOf(issue('OPS-956', { status: 'Impeded', statusRole: 'blocked' }), jira).statusBlock).toBe('no-link');
    expect(blockerStateOf(issue('OPS-956', { status: 'BLOCKED', statusRole: 'inProgress' }), jira).state).toBe('ready');
  });
});

describe('regression: the no-link status wording reads the same for both trackers (Kevin, VERM-97 review)', () => {
  const WORDING = 'Blocked by status, no linked prerequisite.';

  it('YouTrack BLOCKED with no prerequisite link', () => {
    const r = blockerStateOf(issue('READ-14', { status: 'BLOCKED' }), yt());
    expect(r.state).toBe('blocked');
    expect(r.statusBlock).toBe('no-link');
    expect(describeStatusBlock(r.statusBlock)).toBe(WORDING);
    expect(describeBlockerReport(r)).toBe(WORDING);
  });

  it('a Jira status such as Impeded, mapped to blocked, with no prerequisite link', () => {
    const jira: BlockerContext = { prerequisiteTypes: JIRA_DEFAULT_PREREQUISITE_LINK_TYPES, runway: [] };
    const r = blockerStateOf(issue('OPS-956', { status: 'Impeded', statusRole: 'blocked' }), jira);
    expect(r.state).toBe('blocked');
    expect(r.statusBlock).toBe('no-link');
    expect(describeStatusBlock(r.statusBlock)).toBe(WORDING);
    expect(describeBlockerReport(r)).toBe(WORDING);
  });
});

describe('blockerStateOf: external prerequisites', () => {
  it('a prerequisite not on this Runway is external, with the status supplied with the link', () => {
    const read14 = issue('READ-14', { links: [link('PLAT-40', false, { status: 'In Progress' })] });
    const r = blockerStateOf(read14, yt([place(3, read14)]));
    expect(r.blockers).toEqual([{ key: 'PLAT-40', summary: 'PLAT-40 summary', runwayNumber: null, status: 'In Progress' }]);
    expect(describePrerequisite(r.blockers[0])).toBe('PLAT-40 (external, In Progress)');
    expect(r.orderConflicts).toEqual([]);
  });

  it('known open with no status name reads "(external)"', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('PLAT-40', false)] }), yt());
    expect(describePrerequisite(r.blockers[0])).toBe('PLAT-40 (external)');
  });

  it('a prerequisite on this Runway shows its Runway # and uses its row\'s status', () => {
    const sync3 = issue('SYNC-3', { status: 'In Progress' });
    const read14 = issue('READ-14', { links: [link('SYNC-3', false, { status: 'stale name' })] });
    const r = blockerStateOf(read14, yt([place(2, sync3), place(3, read14)]));
    expect(r.blockers).toEqual([{ key: 'SYNC-3', summary: 'SYNC-3 summary', runwayNumber: 2, status: 'In Progress' }]);
    expect(describeBlockerReport(r)).toBe('Blocked by SYNC-3 (#2 here).');
  });

  it('a Runway row that could not be read is still matched by its ID, keeping the link\'s status', () => {
    const read14 = issue('READ-14', { links: [link('SYNC-3', false, { status: 'To do' })] });
    const r = blockerStateOf(read14, yt([place(2, null, '2-SYNC-3'), place(3, read14)]));
    expect(r.blockers[0]).toMatchObject({ runwayNumber: 2, status: 'To do' });
  });

  it('when the link did not report resolution, the prerequisite\'s own Runway row decides', () => {
    const sync3done = issue('SYNC-3', { resolved: 5 });
    const read14 = issue('READ-14', { links: [link('SYNC-3', null)] });
    expect(blockerStateOf(read14, yt([place(1, sync3done), place(2, read14)])).state).toBe('ready');
  });

  it('a prerequisite linked twice is listed once', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('SYNC-3', false), link('SYNC-3', false)] }), yt());
    expect(r.blockers).toHaveLength(1);
  });
});

describe('blockerStateOf: prerequisites scheduled after their dependent', () => {
  const read14 = issue('READ-14', { links: [link('SYNC-3', false)] });

  it('an open prerequisite below its open dependent is an order conflict', () => {
    const sync3 = issue('SYNC-3');
    const r = blockerStateOf(read14, yt([place(2, read14), place(5, sync3)]));
    expect(r.state).toBe('blocked');
    expect(r.orderConflicts).toEqual([{ key: 'SYNC-3', prerequisiteNumber: 5, dependentNumber: 2, certain: true }]);
    expect(describeOrderConflict(r.orderConflicts[0])).toBe('Order conflict — SYNC-3 is #5, after this (#2)');
  });

  it('a prerequisite above its dependent is no conflict', () => {
    expect(blockerStateOf(read14, yt([place(1, issue('SYNC-3')), place(2, read14)])).orderConflicts).toEqual([]);
  });

  it('a resolved prerequisite below its dependent is no conflict', () => {
    const done = issue('READ-14', { links: [link('SYNC-3', true)] });
    expect(blockerStateOf(done, yt([place(2, done), place(5, issue('SYNC-3', { resolved: 9 }))])).orderConflicts).toEqual([]);
  });

  it('a done dependent has no conflicts', () => {
    const done = issue('READ-14', { resolved: 9, links: [link('SYNC-3', false)] });
    expect(blockerStateOf(done, yt([place(2, done), place(5, issue('SYNC-3'))])).orderConflicts).toEqual([]);
  });

  it('a prerequisite of unknown state below its dependent is shown as uncertainty, not a conflict', () => {
    const r14 = issue('READ-14', { links: [link('SYNC-3', null)] });
    const r = blockerStateOf(r14, yt([place(2, r14), place(5, null, '2-SYNC-3')]));
    expect(r.orderConflicts).toEqual([{ key: 'SYNC-3', prerequisiteNumber: 5, dependentNumber: 2, certain: false }]);
    expect(describeOrderConflict(r.orderConflicts[0])).toBe('Possible order conflict — SYNC-3 is #5, after this (#2); not both known to be open');
  });

  it('a ticket that is not on the Runway (All tasks) gets no order conflicts', () => {
    expect(blockerStateOf(read14, yt([place(5, issue('SYNC-3'))])).orderConflicts).toEqual([]);
  });
});

describe('blockerStateOf: workspace prerequisite link types', () => {
  it('follows the workspace\'s choice: an empty list makes nothing a prerequisite', () => {
    const r = blockerStateOf(issue('READ-14', { links: [link('SYNC-3', false)] }), { prerequisiteTypes: [], runway: [] });
    expect(r.state).toBe('ready');
  });

  it('a custom type on the outward side counts the outward link', () => {
    const r = blockerStateOf(
      issue('READ-14', { links: [link('SYNC-3', false, { type: 'Required by', direction: 'outward' })] }),
      { prerequisiteTypes: [{ type: 'Required by', side: 'outward' }], runway: [] },
    );
    expect(r.blockers.map((b) => b.key)).toEqual(['SYNC-3']);
  });

  it('never writes: the ticket, its links and the Runway are left as they were', () => {
    const r14 = issue('READ-14', { links: [link('SYNC-3', false)] });
    const runway = [place(2, r14), place(5, issue('SYNC-3'))];
    const before = JSON.stringify({ r14, runway });
    blockerStateOf(r14, yt(runway));
    expect(JSON.stringify({ r14, runway })).toBe(before);
  });
});

describe('regression: Kevin\'s VERM-97 review scenarios', () => {
  const jira = (runway: RunwayPlace[]): BlockerContext => ({ prerequisiteTypes: JIRA_DEFAULT_PREREQUISITE_LINK_TYPES, runway });
  /** A Jira board issue: its entity ID differs from its key. */
  const jiraIssue = (key: string, entityId: string, opts: IssueOpts) => ({ ...issue(key, opts), id: entityId });

  it('1. a saved Runway row whose tracker read failed is found by key, whatever the link\'s entity ID', () => {
    const dependent = jiraIssue('OPS-956', '10956', { statusRole: 'inProgress', links: [link('OPS-2', false, { type: 'Blocks', id: '10002' })] });
    const r = blockerStateOf(dependent, jira([place(2, dependent), { localId: 'OPS-2', runwayNumber: 5, issue: null }]));
    expect(r.state).toBe('blocked');
    expect(r.blockers).toEqual([{ key: 'OPS-2', summary: 'OPS-2 summary', runwayNumber: 5, status: null }]);
    expect(describePrerequisite(r.blockers[0])).toBe('OPS-2 (#5 here)');
    expect(r.orderConflicts).toEqual([{ key: 'OPS-2', prerequisiteNumber: 5, dependentNumber: 2, certain: true }]);
  });

  it('1b. the same saved row is found by entity ID when that is what the row holds', () => {
    const dependent = jiraIssue('OPS-956', '10956', { statusRole: 'inProgress', links: [link('OPS-2', false, { type: 'Blocks', id: '10002' })] });
    const r = blockerStateOf(dependent, jira([place(2, dependent), { localId: '10002', runwayNumber: 5, issue: null }]));
    expect(r.blockers[0].runwayNumber).toBe(5);
    expect(r.orderConflicts).toEqual([{ key: 'OPS-2', prerequisiteNumber: 5, dependentNumber: 2, certain: true }]);
  });

  it('2. unknown resolution stays unknown: the link says null and the prerequisite\'s Jira row has no resolution and no usable status role', () => {
    const dependent = jiraIssue('OPS-956', '10956', { statusRole: 'inProgress', links: [link('OPS-2', null, { type: 'Blocks', id: '10002' })] });
    const ops2 = jiraIssue('OPS-2', '10002', { status: 'Mystery', statusRole: null, resolved: null });
    const r = blockerStateOf(dependent, jira([place(2, dependent), place(5, ops2)]));
    expect(r.state).toBe('unknown');
    expect(r.blockers).toEqual([]);
    expect(r.unknownPrerequisites.map((p) => p.key)).toEqual(['OPS-2']);
    expect(r.orderConflicts).toEqual([{ key: 'OPS-2', prerequisiteNumber: 5, dependentNumber: 2, certain: false }]);
  });

  it('2b. a known-open prerequisite below a dependent whose own status is unknown is only a possible conflict', () => {
    const dependent = jiraIssue('OPS-956', '10956', { status: 'Mystery', statusRole: null, links: [link('OPS-2', false, { type: 'Blocks', id: '10002' })] });
    const ops2 = jiraIssue('OPS-2', '10002', { statusRole: 'inProgress' });
    const r = blockerStateOf(dependent, jira([place(2, dependent), place(5, ops2)]));
    expect(r.orderConflicts).toEqual([{ key: 'OPS-2', prerequisiteNumber: 5, dependentNumber: 2, certain: false }]);
  });
});
