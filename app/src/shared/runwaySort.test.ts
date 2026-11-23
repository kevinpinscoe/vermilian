import { describe, expect, it } from 'vitest';
import { FIELD_DEFS } from './fields';
import { compareTicketIds, priorityRank, runwaySortComparator, sortByRunwaySort, type RunwaySort, type SortableTicket } from './runwaySort';

// Synthetic keys and names only.
// YouTrack's one Priority bundle, most urgent first.
const YT = FIELD_DEFS.priority.options as readonly string[];
const DEMO = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const OPS = ['P1', 'P2', 'P3'];

function t(key: string, runwayNumber: number | null = null, priority: string | null = null, priorityOrder: readonly string[] | null = YT): SortableTicket {
  return { key, runwayNumber, priority, priorityOrder };
}
const keys = (list: SortableTicket[], sort: RunwaySort) => sortByRunwaySort(list, sort, (x) => x).map((x) => x.key);
const asc = (key: RunwaySort['key']): RunwaySort => ({ key, direction: 'asc' });
const desc = (key: RunwaySort['key']): RunwaySort => ({ key, direction: 'desc' });

describe('ticket ID sort (VERM-91)', () => {
  it('is code-unit order, not numeric: OPS-4089 before OPS-956 before OPS-96 ascending', () => {
    const list = [t('OPS-96'), t('OPS-956'), t('OPS-4089')];
    expect(keys(list, asc('ticketId'))).toEqual(['OPS-4089', 'OPS-956', 'OPS-96']);
    expect(keys(list, desc('ticketId'))).toEqual(['OPS-96', 'OPS-956', 'OPS-4089']);
  });

  it('compares code units, so case and punctuation follow their code points', () => {
    expect(compareTicketIds('OPS-4089', 'OPS-956')).toBeLessThan(0);
    expect(compareTicketIds('Ab-1', 'aB-1')).toBeLessThan(0); // 'A' (65) < 'a' (97)
    expect(compareTicketIds('A-1', 'A-1')).toBe(0);
  });

  it("matches the spec's worked example", () => {
    const list = [t('READ-12', 1), t('SYNC-3', 2), t('READ-14', 3), t('SYNC-7', 4), t('READ-20', 5)];
    expect(keys(list, asc('ticketId'))).toEqual(['READ-12', 'READ-14', 'READ-20', 'SYNC-3', 'SYNC-7']);
  });
});

describe('Runway # sort (VERM-91)', () => {
  const list = [t('SYNC-3', 2), t('PLAT-40'), t('READ-20', 5), t('READ-12', 1), t('INB-1'), t('SYNC-7', 4), t('READ-14', 3)];

  it('ascending: by position, then the unnumbered last by ticket ID ascending', () => {
    expect(keys(list, asc('runwayNumber'))).toEqual(['READ-12', 'SYNC-3', 'READ-14', 'SYNC-7', 'READ-20', 'INB-1', 'PLAT-40']);
  });

  it("descending (the spec's example): by position reversed, the unnumbered still last, still by ID ascending", () => {
    expect(keys(list, desc('runwayNumber'))).toEqual(['READ-20', 'SYNC-7', 'READ-14', 'SYNC-3', 'READ-12', 'INB-1', 'PLAT-40']);
  });

  it('with no ticket numbered, it is ticket ID ascending in both directions', () => {
    const none = [t('B-2'), t('A-10'), t('A-9')];
    expect(keys(none, asc('runwayNumber'))).toEqual(['A-10', 'A-9', 'B-2']);
    expect(keys(none, desc('runwayNumber'))).toEqual(['A-10', 'A-9', 'B-2']);
  });
});

describe('tracker priority sort (VERM-91)', () => {
  it('follows the YouTrack bundle order, never alphabetical, over the whole list, numbered or not', () => {
    // Alphabetical would put Critical, Major, Minor, Normal, Show-stopper.
    const list = [t('A-1', 1, 'Minor'), t('A-2', null, 'Show-stopper'), t('A-3', 2, 'Normal'), t('A-4', null, 'Critical'), t('A-5', 3, 'Major')];
    expect(YT).toEqual(['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor']);
    expect(keys(list, asc('priority'))).toEqual(['A-2', 'A-4', 'A-5', 'A-3', 'A-1']);
    expect(keys(list, desc('priority'))).toEqual(['A-1', 'A-3', 'A-5', 'A-4', 'A-2']);
  });

  it("follows each Jira project's own editmeta order; equal ranks across schemes tie, broken by ticket ID", () => {
    const list = [
      t('OPS-9', null, 'P2', OPS),
      t('DEMO-105', null, 'Low', DEMO),
      t('OPS-7', null, 'P1', OPS),
      t('DEMO-102', null, 'High', DEMO),
      t('DEMO-101', null, 'Highest', DEMO),
      t('OPS-12', null, 'P3', OPS),
    ];
    expect(keys(list, asc('priority'))).toEqual(['DEMO-101', 'OPS-7', 'DEMO-102', 'OPS-9', 'OPS-12', 'DEMO-105']);
    // Descending reverses the ranks; ties still break by ticket ID ascending.
    expect(keys(list, desc('priority'))).toEqual(['DEMO-105', 'OPS-12', 'DEMO-102', 'OPS-9', 'DEMO-101', 'OPS-7']);
  });

  it('a missing priority is last in both directions', () => {
    const list = [t('A-3', null, null), t('A-1', null, 'Minor'), t('A-2', null, ''), t('A-4', null, 'Critical')];
    expect(keys(list, asc('priority'))).toEqual(['A-4', 'A-1', 'A-2', 'A-3']);
    expect(keys(list, desc('priority'))).toEqual(['A-1', 'A-4', 'A-2', 'A-3']);
  });

  it('a value its order does not list ranks after every listed rank and flips with the direction; missing stays last', () => {
    const list = [t('OPS-1', null, 'Blocker', OPS), t('OPS-2', null, 'P3', OPS), t('X-1', null, 'Urgent', null), t('OPS-3', null, null, OPS)];
    expect(keys(list, asc('priority'))).toEqual(['OPS-2', 'OPS-1', 'X-1', 'OPS-3']);
    expect(keys(list, desc('priority'))).toEqual(['OPS-1', 'X-1', 'OPS-2', 'OPS-3']);
  });

  it('priorityRank: index, unlisted after every index, none null', () => {
    expect(priorityRank('P2', OPS)).toBe(1);
    expect(priorityRank('P9', OPS)).toBe(Number.POSITIVE_INFINITY);
    expect(priorityRank('P1', null)).toBe(Number.POSITIVE_INFINITY);
    expect(priorityRank(null, OPS)).toBeNull();
    expect(priorityRank('', OPS)).toBeNull();
  });
});

describe('ties and determinism (VERM-91)', () => {
  it('every sort breaks ties by ticket ID ascending, whatever its direction', () => {
    const tied = [t('OPS-96', 1, 'Major'), t('OPS-4089', 1, 'Major'), t('OPS-956', 1, 'Major')];
    for (const sort of [asc('runwayNumber'), desc('runwayNumber'), asc('priority'), desc('priority')]) {
      expect(keys(tied, sort), `${sort.key} ${sort.direction}`).toEqual(['OPS-4089', 'OPS-956', 'OPS-96']);
    }
  });

  it('the result does not depend on the input order', () => {
    const list = [t('B-1', 2, 'Minor'), t('A-1', null, 'Major'), t('C-1', 1, null), t('A-2', null, null), t('D-1', 3, 'Critical')];
    for (const sort of [asc('runwayNumber'), desc('runwayNumber'), asc('priority'), desc('priority'), asc('ticketId'), desc('ticketId')]) {
      const expected = keys(list, sort);
      expect(keys([...list].reverse(), sort)).toEqual(expected);
      expect(keys([list[2], list[0], list[4], list[1], list[3]], sort)).toEqual(expected);
    }
  });

  it('sorting reads only: a copy is returned and the input and its tickets are unchanged', () => {
    const list = [t('B-1', 2), t('A-1', 1)];
    const before = JSON.stringify(list);
    const sorted = sortByRunwaySort(list, asc('ticketId'), (x) => x);
    expect(sorted).not.toBe(list);
    expect(JSON.stringify(list)).toBe(before);
  });

  it('runwaySortComparator is antisymmetric', () => {
    const cmp = runwaySortComparator(desc('priority'));
    const a = t('A-1', null, 'Minor');
    const b = t('B-1', null, null);
    expect(Math.sign(cmp(a, b))).toBe(-Math.sign(cmp(b, a)));
  });
});
