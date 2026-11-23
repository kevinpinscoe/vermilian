import { describe, expect, it } from 'vitest';
import type { RunwayTicketRead } from '../../../shared/runwayTicket';
import type { BoardIssue } from '../../../shared/workspace';
import { ALL_HIDDEN_BY_FILTER, RUNWAY_LOOKUP_FAILED, allTasksEmptyNotice, runwayHasTickets, savedRunwayTicketIds, withRunwayTickets } from './allTasks';
import { unreadTicket } from './api';

// Synthetic keys and names only.
function issue(idReadable: string, id: string, resolved: number | null = null): BoardIssue {
  return { id, idReadable, summary: idReadable, resolved, fields: {} as BoardIssue['fields'], parentEpic: null, isEpic: false };
}
const ok = (itemId: string, i: BoardIssue): RunwayTicketRead => ({ itemId, state: 'resolved', issue: i });

describe('withRunwayTickets (VERM-89)', () => {
  const read12 = issue('READ-12', '2-12');
  const sync3 = issue('SYNC-3', '2-103');
  const plat40 = issue('PLAT-40', '2-240');

  it('adds Runway tickets from outside the projects after the project issues, in Runway order', () => {
    const r = withRunwayTickets([read12], [ok('yt:PLAT-40', plat40), ok('yt:SYNC-3', sync3)], false);
    expect(r.issues.map((i) => i.idReadable)).toEqual(['READ-12', 'PLAT-40', 'SYNC-3']);
    expect([...r.runwayOnlyIds]).toEqual(['2-240', '2-103']);
    expect(r.hiddenResolved).toBe(0);
  });

  it('a ticket both in a project and on the Runway appears once, as its project row', () => {
    const fromProject = { ...read12, summary: 'project copy' };
    const r = withRunwayTickets([fromProject], [ok('yt:READ-12', read12)], false);
    expect(r.issues).toEqual([fromProject]);
    expect(r.runwayOnlyIds.size).toBe(0);
  });

  it('matches by entity ID too: a row saved under 2-12 is the project ticket READ-12', () => {
    const r = withRunwayTickets([read12], [ok('yt:2-12', read12)], false);
    expect(r.issues).toHaveLength(1);
  });

  it('two Runway rows that read as the same ticket (a moved Jira key) give one row', () => {
    const moved = issue('DEMO-150', '10042');
    const r = withRunwayTickets([], [ok('jira:DEMO-101', moved), ok('jira:DEMO-150', moved)], false);
    expect(r.issues.map((i) => i.idReadable)).toEqual(['DEMO-150']);
  });

  it('a zero-project workspace lists each Runway ticket exactly once', () => {
    const r = withRunwayTickets([], [ok('yt:READ-12', read12), ok('yt:SYNC-3', sync3), ok('yt:PLAT-40', plat40)], false);
    expect(r.issues.map((i) => i.idReadable)).toEqual(['READ-12', 'SYNC-3', 'PLAT-40']);
  });

  it('a resolved Runway ticket follows the toggle, and those hidden are counted', () => {
    const done = issue('SYNC-7', '2-107', 1_700_000_000_000);
    const reads = [ok('yt:SYNC-7', done), ok('yt:PLAT-40', plat40)];
    const hidden = withRunwayTickets([], reads, false);
    expect(hidden.issues.map((i) => i.idReadable)).toEqual(['PLAT-40']);
    expect(hidden.hiddenResolved).toBe(1);
    const shown = withRunwayTickets([], reads, true);
    expect(shown.issues.map((i) => i.idReadable)).toEqual(['SYNC-7', 'PLAT-40']);
    expect(shown.hiddenResolved).toBe(0);
  });

  it('omits Runway rows without ticket data, and a failed lookup leaves the project issues', () => {
    const reads: RunwayTicketRead[] = [
      { itemId: 'yt:READ-30', state: 'missing-or-unreadable' },
      { itemId: 'yt:READ-31', state: 'not-readable' },
      { itemId: 'yt:READ-32', state: 'missing' },
      { itemId: 'jira:OPS-7', state: 'wrong-tracker', reason: 'x' },
    ];
    expect(withRunwayTickets([read12], reads, false).issues).toEqual([read12]);
    expect(withRunwayTickets([read12], null, false).issues).toEqual([read12]);
  });
});

describe('withRunwayTickets: only rows still saved (VERM-89 review)', () => {
  const read12 = issue('READ-12', '2-12');
  const plat40 = issue('PLAT-40', '2-240');

  it('drops a cached read whose row was removed; an in-project ticket stays through its project', () => {
    // The cached reads still hold PLAT-40 (outside) and READ-12 (in a project);
    // both rows were removed from the Runway since.
    const reads = [ok('yt:READ-12', read12), ok('yt:PLAT-40', plat40)];
    const r = withRunwayTickets([read12], reads, false, new Set<string>());
    expect(r.issues.map((i) => i.idReadable)).toEqual(['READ-12']);
    expect(r.runwayOnlyIds.size).toBe(0);
  });

  it('keeps the reads of rows still saved, and every read while the rows are not known', () => {
    const reads = [ok('yt:PLAT-40', plat40), { itemId: 'yt:GONE-1', state: 'missing-or-unreadable' } as RunwayTicketRead];
    const saved = withRunwayTickets([], reads, false, new Set(['yt:PLAT-40']));
    expect(saved.issues.map((i) => i.idReadable)).toEqual(['PLAT-40']);
    expect(saved.unreadable).toBe(0); // GONE-1 was removed: not counted either
    const unknown = withRunwayTickets([], reads, false, null);
    expect(unknown.issues.map((i) => i.idReadable)).toEqual(['PLAT-40']);
    expect(unknown.unreadable).toBe(1);
  });

  it('counts unreadable saved tickets, but not one a project already shows', () => {
    const reads: RunwayTicketRead[] = [
      { itemId: 'jira:DEMO-101', state: 'missing-or-unreadable' },
      { itemId: 'jira:OPS-7', state: 'not-readable' },
      { itemId: 'jira:OPS-9', state: 'missing' },
    ];
    const r = withRunwayTickets([issue('DEMO-101', '10001')], reads, false, new Set(['jira:DEMO-101', 'jira:OPS-7', 'jira:OPS-9']));
    expect(r.unreadable).toBe(2);
  });

  it('savedRunwayTicketIds: ticket rows only, null while unknown', () => {
    expect(savedRunwayTicketIds(null)).toBeNull();
    expect([...(savedRunwayTicketIds([{ kind: 'issue', itemId: 'yt:A-1' }, { kind: 'section', itemId: 'sec:1' }]) ?? [])]).toEqual(['yt:A-1']);
  });
});

describe('allTasksEmptyNotice (VERM-89 review)', () => {
  const base = { hiddenResolved: 0, unreadable: 0, lookupFailed: false, closedWord: 'closed' };

  it('nothing to explain: null', () => {
    expect(allTasksEmptyNotice(base)).toBeNull();
  });

  it('only hidden by the toggle: the agreed message and the toggle, no Open Runway', () => {
    expect(allTasksEmptyNotice({ ...base, hiddenResolved: 2 })).toEqual({ lines: [ALL_HIDDEN_BY_FILTER], showToggle: true, openRunway: false });
  });

  it('only unreadable: says so and offers Open Runway', () => {
    const n = allTasksEmptyNotice({ ...base, unreadable: 2 });
    expect(n).toEqual({ lines: ['2 Runway tickets could not be read. The Runway shows why.'], showToggle: false, openRunway: true });
  });

  it('closed and unreadable: both reasons and both actions', () => {
    const n = allTasksEmptyNotice({ ...base, hiddenResolved: 1, unreadable: 1, closedWord: 'Done' });
    expect(n).toEqual({
      lines: ['1 Done ticket is hidden by the current filter.', '1 Runway ticket could not be read. The Runway shows why.'],
      showToggle: true,
      openRunway: true,
    });
  });

  it('a failed lookup explains itself and offers Open Runway', () => {
    expect(allTasksEmptyNotice({ ...base, lookupFailed: true, unreadable: 3 })).toEqual({ lines: [RUNWAY_LOOKUP_FAILED], showToggle: false, openRunway: true });
  });
});

describe('runwayHasTickets', () => {
  it('counts ticket rows only', () => {
    expect(runwayHasTickets(undefined)).toBe(false);
    expect(runwayHasTickets([{ kind: 'section' }, { kind: 'note' }])).toBe(false);
    expect(runwayHasTickets([{ kind: 'note' }, { kind: 'issue' }])).toBe(true);
  });
});

describe('unreadTicket (Runway reads kept current, VERM-89)', () => {
  const row = (itemId: string, kind: 'issue' | 'section' = 'issue') =>
    ({ workspaceId: 'ws', itemId, kind, position: 1, runwayNumber: null, depth: 0, text: null, addedAt: '', updatedAt: '' });
  it('is true only for a ticket row the reads do not cover', () => {
    expect(unreadTicket([row('yt:READ-12')], [{ itemId: 'yt:READ-12' }])).toBe(false);
    expect(unreadTicket([row('yt:READ-12'), row('yt:SYNC-3')], [{ itemId: 'yt:READ-12' }])).toBe(true);
    expect(unreadTicket([row('sec:a', 'section')], [])).toBe(false);
  });
});
