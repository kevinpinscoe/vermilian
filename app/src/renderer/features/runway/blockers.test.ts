import { describe, expect, it } from 'vitest';
import type { RunwayItem } from '../../../shared/runwayItem';
import type { RunwayTicketRead } from '../../../shared/runwayTicket';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import type { IssueLink } from '../../../shared/issueLink';
import { FIELD_KEYS, type FieldKey } from '../../../shared/fields';
import { buildRunwayRows } from './rows';
import {
  blockerBadge,
  blockerAliases,
  blockerIssueId,
  issueBlockers,
  linkedEntityId,
  prerequisiteTypesFor,
  rowForKey,
  runwayBlockers,
  runwayPlaces,
} from './blockers';

// Synthetic keys only: the proposal's worked example. Runway, in order:
// a section, READ-12 (#1), SYNC-3 (#2), READ-14 (#3, depends on SYNC-3),
// SYNC-7 (#4, depends on PLAT-40, not on the Runway), READ-20 (#5).
const WS = 'ws-3f9a1c2b7d01';
// Entity IDs shaped as YouTrack's: READ-14 is 2-14, SYNC-3 is 2-103, PLAT-40 is 2-240.
const ENTITY: Record<string, string> = { 'READ-12': '2-12', 'SYNC-3': '2-103', 'READ-14': '2-14', 'SYNC-7': '2-107', 'READ-20': '2-20', 'PLAT-40': '2-240' };
const eid = (key: string) => ENTITY[key] ?? `2-9${key.replace(/\D/g, '')}`;
const EMPTY = Object.fromEntries(FIELD_KEYS.map((k): [FieldKey, null] => [k, null])) as BoardIssueFields;

function item(itemId: string, kind: RunwayItem['kind'], position: number): RunwayItem {
  return { workspaceId: WS, itemId, kind, position, runwayNumber: null, depth: 0, text: kind === 'issue' ? null : 'Offline', addedAt: '', updatedAt: '' };
}

const dependsOn = (key: string, resolved: boolean | null, status: string | null = null): IssueLink => ({
  type: 'Depend', directed: true, direction: 'inward', verb: 'depends on',
  issue: { id: eid(key), key, summary: key, resolved, status },
});

function issue(key: string, opts: { resolved?: number | null; status?: string; links?: IssueLink[] } = {}): BoardIssue {
  return {
    id: eid(key), idReadable: key, summary: key, resolved: opts.resolved ?? null,
    fields: { ...EMPTY, status: opts.status ?? 'To do' }, parentEpic: null, isEpic: false, links: opts.links ?? [],
  };
}

const ITEMS = [
  item('sec:1', 'section', 1),
  item('yt:2-12', 'issue', 2),
  item('yt:2-103', 'issue', 3),
  item('yt:2-14', 'issue', 4),
  item('yt:2-107', 'issue', 5),
  item('yt:2-20', 'issue', 6),
];

function reads(sync3Resolved: number | null = null): RunwayTicketRead[] {
  const sync3Open = sync3Resolved === null;
  return [
    { itemId: 'yt:2-12', state: 'resolved', issue: issue('READ-12') },
    { itemId: 'yt:2-103', state: 'resolved', issue: issue('SYNC-3', { resolved: sync3Resolved, status: sync3Open ? 'In Progress' : 'Done' }) },
    { itemId: 'yt:2-14', state: 'resolved', issue: issue('READ-14', { links: [dependsOn('SYNC-3', !sync3Open)] }) },
    { itemId: 'yt:2-107', state: 'resolved', issue: issue('SYNC-7', { links: [dependsOn('PLAT-40', false, 'In Progress')] }) },
    { itemId: 'yt:2-20', state: 'resolved', issue: issue('READ-20') },
  ];
}

const YT = prerequisiteTypesFor(null, 'youtrack');

describe('prerequisiteTypesFor', () => {
  it('is the workspace\'s choice, the tracker\'s default when it has none, and keeps an empty choice', () => {
    expect(prerequisiteTypesFor(null, 'youtrack')).toEqual([{ type: 'Depend', side: 'inward' }]);
    expect(prerequisiteTypesFor({}, 'jira')).toEqual([{ type: 'Blocks', side: 'inward' }]);
    expect(prerequisiteTypesFor({ prerequisiteLinkTypes: [] }, 'youtrack')).toEqual([]);
  });
});

describe('runwayBlockers: the worked example', () => {
  const rows = buildRunwayRows(ITEMS, reads());
  const reports = runwayBlockers(rows, YT);

  it('READ-14 is Blocked by SYNC-3, #2 here; the rest are Ready', () => {
    expect(reports.get('yt:2-14')?.state).toBe('blocked');
    expect(reports.get('yt:2-14')?.blockers).toEqual([{ key: 'SYNC-3', summary: 'SYNC-3', runwayNumber: 2, status: 'In Progress' }]);
    expect(reports.get('yt:2-12')?.state).toBe('ready');
    expect(reports.get('yt:2-20')?.state).toBe('ready');
  });

  it('SYNC-7 is Blocked by PLAT-40, external, In Progress', () => {
    expect(reports.get('yt:2-107')?.blockers).toEqual([{ key: 'PLAT-40', summary: 'PLAT-40', runwayNumber: null, status: 'In Progress' }]);
  });

  it('resolving SYNC-3 turns READ-14 Ready on the next read; the rows keep their order', () => {
    const after = buildRunwayRows(ITEMS, reads(9));
    expect(runwayBlockers(after, YT).get('yt:2-14')?.state).toBe('ready');
    expect(after.map((r) => r.itemId)).toEqual(rows.map((r) => r.itemId));
  });

  it('a row the tracker did not read has no report', () => {
    const partial = buildRunwayRows(ITEMS, [...reads().slice(0, 2), { itemId: 'yt:2-14', state: 'missing' }]);
    expect(runwayBlockers(partial, YT).has('yt:2-14')).toBe(false);
  });

  it('places carry each ticket row\'s stored ID and Runway #, read or not', () => {
    expect(runwayPlaces(rows).map((p) => [p.localId, p.runwayNumber])).toEqual([
      ['2-12', 1], ['2-103', 2], ['2-14', 3], ['2-107', 4], ['2-20', 5],
    ]);
  });
});

describe('blockerBadge (All tasks)', () => {
  const rows = buildRunwayRows(ITEMS, reads());

  it('only Blocked and Unknown get a badge, with the full reason', () => {
    expect(blockerBadge(issueBlockers(issue('READ-14', { links: [dependsOn('SYNC-3', false)] }), rows, YT)))
      .toEqual({ label: 'Blocked', reason: 'Blocked by SYNC-3 (#2 here).' });
    expect(blockerBadge(issueBlockers({ ...issue('READ-9'), links: undefined }, rows, YT)))
      .toEqual({ label: 'Unknown', reason: 'Unknown: Links were not read' });
    expect(blockerBadge(issueBlockers(issue('READ-12'), rows, YT))).toBeNull();
    expect(blockerBadge(issueBlockers(issue('READ-1', { resolved: 3, links: [dependsOn('SYNC-3', false)] }), rows, YT))).toBeNull();
    expect(blockerBadge(null)).toBeNull();
  });

  it('a project ticket that is not on the Runway still sees a Runway prerequisite as #N here', () => {
    const r = issueBlockers(issue('READ-30', { links: [dependsOn('SYNC-3', false)] }), rows, YT);
    expect(r.blockers[0].runwayNumber).toBe(2);
    expect(r.orderConflicts).toEqual([]);
  });
});

describe('Add to Runway: the IDs the blocker goes by', () => {
  it('names a YouTrack blocker by the entity ID its link carries, else its key; a Jira blocker by its key', () => {
    expect(blockerIssueId('youtrack', 'PLAT-40', '2-77')).toBe('yt:2-77');
    expect(blockerIssueId('youtrack', 'PLAT-40', null)).toBe('yt:PLAT-40');
    expect(blockerIssueId('jira', 'OPS-4089', '14089')).toBe('jira:OPS-4089');
    expect(blockerIssueId('jira', 'not a key', null)).toBeNull();
  });

  it('aliases: the ID it is added under first, then every other ID it goes by, so the gate can refuse a duplicate', () => {
    expect(blockerAliases('youtrack', 'PLAT-40', '2-240')).toEqual(['yt:2-240', 'yt:PLAT-40']);
    expect(blockerAliases('youtrack', 'PLAT-40', null)).toEqual(['yt:PLAT-40']);
    expect(blockerAliases('jira', 'OPS-4089', '14089')).toEqual(['jira:OPS-4089']);
    expect(blockerAliases('jira', 'not a key', null)).toEqual([]);
  });

  it('reads the blocker\'s entity ID off the dependent\'s links', () => {
    expect(linkedEntityId(issue('SYNC-7', { links: [dependsOn('PLAT-40', false)] }), 'PLAT-40')).toBe('2-240');
    expect(linkedEntityId(issue('SYNC-7'), 'PLAT-40')).toBeNull();
  });
});

describe('Move prerequisite above: the conflict is reported, and the prerequisite\'s row is found', () => {
  // SYNC-3 moved below READ-14: READ-14 is #2, SYNC-3 is #4.
  const conflicted = [
    item('sec:1', 'section', 1),
    item('yt:2-12', 'issue', 2),
    item('yt:2-14', 'issue', 3),
    item('yt:2-107', 'issue', 4),
    item('yt:2-103', 'issue', 5),
    item('yt:2-20', 'issue', 6),
  ];

  it('the order conflict is reported; nothing here plans a write', () => {
    const rows = buildRunwayRows(conflicted, reads());
    const report = runwayBlockers(rows, YT).get('yt:2-14');
    expect(report?.orderConflicts).toEqual([{ key: 'SYNC-3', prerequisiteNumber: 4, dependentNumber: 2, certain: true }]);
    expect(rowForKey(rows, 'SYNC-3')?.itemId).toBe('yt:2-103');
  });
});

describe('rowForKey', () => {
  it('finds a row by read key, stored key, or the link\'s entity ID — even when its read failed', () => {
    const items = [item('jira:OPS-2', 'issue', 1), item('yt:2-9', 'issue', 2)];
    const rows = buildRunwayRows(items, [{ itemId: 'jira:OPS-2', state: 'missing' }, { itemId: 'yt:2-9', state: 'not-readable' }]);
    expect(rowForKey(rows, 'OPS-2')?.itemId).toBe('jira:OPS-2');
    expect(rowForKey(rows, 'READ-9', '2-9')?.itemId).toBe('yt:2-9');
    expect(rowForKey(rows, 'READ-9')).toBeNull();
  });
});
