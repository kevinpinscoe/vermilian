import { describe, expect, it } from 'vitest';
import { compareTicketIds, priorityRank, runwaySortComparator, sortByRunwaySort, type RunwaySort, type SortableTicket } from './runwaySort';

// Synthetic keys and names only.
// YouTrack's one Priority bundle, most urgent first.
// A YouTrack Priority order as fixture data (no app constant since VERM-117).
const YT: readonly string[] = ['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor'];
const DEMO = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const OPS = ['P1', 'P2', 'P3'];

function t(key: string, runwayNumber: number | null = null, priority: string | null = null, priorityOrder: readonly string[] | null = YT): SortableTicket {
  return { key, runwayNumber, priority, priorityOrder };
}
const keys = (list: SortableTicket[], sort: RunwaySort) => sortByRunwaySort(list, sort, (x) => x).map((x) => x.key);
const asc = (key: RunwaySort['key']): RunwaySort => ({ key, direction: 'asc' });
const desc = (key: RunwaySort['key']): RunwaySort => ({ key, direction: 'desc' });

describe('ticket ID sort (VERM-91)', () => {
  it('compares the project prefix as text and the final number numerically', () => {
    expect(keys([t('VERM-101'), t('VERM-90')], asc('ticketId'))).toEqual(['VERM-90', 'VERM-101']);
    const ops = [t('OPS-4089'), t('OPS-96'), t('OPS-956')];
    expect(keys(ops, asc('ticketId'))).toEqual(['OPS-96', 'OPS-956', 'OPS-4089']);
  });

  it('descending reverses each sequence', () => {
    expect(keys([t('VERM-90'), t('VERM-101')], desc('ticketId'))).toEqual(['VERM-101', 'VERM-90']);
    expect(keys([t('OPS-96'), t('OPS-4089'), t('OPS-956')], desc('ticketId'))).toEqual(['OPS-4089', 'OPS-956', 'OPS-96']);
  });

  it('orders prefixes as text first, then numbers within a prefix', () => {
    const list = [t('VERM-101'), t('OPS-4089'), t('VERM-90'), t('OPS-96'), t('INB-7')];
    expect(keys(list, asc('ticketId'))).toEqual(['INB-7', 'OPS-96', 'OPS-4089', 'VERM-90', 'VERM-101']);
    expect(keys(list, desc('ticketId'))).toEqual(['VERM-101', 'VERM-90', 'OPS-4089', 'OPS-96', 'INB-7']);
  });

  it('compares prefixes by code unit, with no locale', () => {
    expect(compareTicketIds('Ab-1', 'aB-1')).toBeLessThan(0); // 'A' (65) < 'a' (97)
    expect(compareTicketIds('OPS-1', 'OPS2-1')).toBeLessThan(0); // '-' (45) < '2' (50)
  });

  it('numbers past the float range still compare exactly; equal keys compare 0', () => {
    expect(compareTicketIds('A-9007199254740993', 'A-9007199254740992')).toBeGreaterThan(0);
    expect(compareTicketIds('A-1', 'A-1')).toBe(0);
  });

  it('a key with no number comes before its prefix\'s numbered keys; leading zeros fall back to text', () => {
    expect(compareTicketIds('NOTE', 'NOTE1')).toBeLessThan(0);
    expect(compareTicketIds('OPS-007', 'OPS-7')).toBeLessThan(0); // equal numbers: '0' < '7'
    expect(compareTicketIds('OPS-7', 'OPS-007')).toBeGreaterThan(0);
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
    expect(keys(none, asc('runwayNumber'))).toEqual(['A-9', 'A-10', 'B-2']);
    expect(keys(none, desc('runwayNumber'))).toEqual(['A-9', 'A-10', 'B-2']);
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

  it('an unknown rank is after every ranked ticket in both directions, before no priority; only known ranks reverse', () => {
    const list = [
      t('OPS-3', null, null, OPS),
      t('X-1', null, 'Urgent', null), // its project's order is unknown
      t('OPS-2', null, 'P3', OPS),
      t('OPS-1', null, 'Blocker', OPS), // a value OPS's order does not list
      t('OPS-4', null, 'P1', OPS),
    ];
    expect(keys(list, asc('priority'))).toEqual(['OPS-4', 'OPS-2', 'OPS-1', 'X-1', 'OPS-3']);
    expect(keys(list, desc('priority'))).toEqual(['OPS-2', 'OPS-4', 'OPS-1', 'X-1', 'OPS-3']);
  });

  it('priorityRank: a known index, unknown, or none', () => {
    expect(priorityRank('P2', OPS)).toBe(1);
    expect(priorityRank('P9', OPS)).toBe('unknown');
    expect(priorityRank('P1', null)).toBe('unknown');
    expect(priorityRank(null, OPS)).toBe('none');
    expect(priorityRank('', OPS)).toBe('none');
  });
});

describe('ties and determinism (VERM-91)', () => {
  it('Runway # and priority break ties by ascending ticket ID (prefix as text, number numerically), even descending', () => {
    const tied = [t('VERM-101', 1, 'Major'), t('OPS-4089', 1, 'Major'), t('VERM-90', 1, 'Major'), t('OPS-96', 1, 'Major'), t('OPS-956', 1, 'Major')];
    for (const sort of [asc('runwayNumber'), desc('runwayNumber'), asc('priority'), desc('priority')]) {
      expect(keys(tied, sort), `${sort.key} ${sort.direction}`).toEqual(['OPS-96', 'OPS-956', 'OPS-4089', 'VERM-90', 'VERM-101']);
    }
    // The same for the unnumbered, unknown and missing tiers.
    const tails = [t('OPS-956', null, 'Blocker', OPS), t('OPS-96', null, 'Blocker', OPS), t('OPS-4089', null, null, OPS), t('OPS-100', null, null, OPS)];
    for (const sort of [asc('priority'), desc('priority')]) {
      expect(keys(tails, sort), sort.direction).toEqual(['OPS-96', 'OPS-956', 'OPS-100', 'OPS-4089']);
    }
    for (const sort of [asc('runwayNumber'), desc('runwayNumber')]) {
      expect(keys(tails, sort), sort.direction).toEqual(['OPS-96', 'OPS-100', 'OPS-956', 'OPS-4089']);
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
