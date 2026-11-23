import { describe, expect, it } from 'vitest';
import type { BoardIssue } from '../../../shared/workspace';
import type { RunwaySort } from '../../../shared/runwaySort';
import { isRunwaySort, sanitiseRunwaySorts, withRunwaySort } from '../../../shared/runwaySort';
import {
  activeAllTasksSort, allTasksSortAction, headerSortDirection, sortAllTasksFlat,
  projectIssuesKey, projectsOfTickets, youtrackProjectOf, type AllTasksSortState,
} from './allTasksSort';
import { FIELD_DEFS } from '../../../shared/fields';

// The built-in list, used here as each project's bundle where a test does not
// configure its own.
const BUILT_IN = FIELD_DEFS.priority.options as readonly string[];

// Synthetic keys and names only.
function issue(idReadable: string, priority: string | null, status = 'To do'): BoardIssue {
  return {
    id: `2-${idReadable}`, idReadable, summary: idReadable, resolved: null,
    fields: { priority, status } as BoardIssue['fields'], parentEpic: null, isEpic: false,
  };
}
const RN = (key: RunwaySort['key'], direction: RunwaySort['direction'] = 'asc'): RunwaySort => ({ key, direction });
const none: AllTasksSortState = { saved: null, temp: null };

describe('All tasks sort state (VERM-92)', () => {
  it('shows the remembered sort, a temporary header sort over it, or nothing', () => {
    expect(activeAllTasksSort(none)).toBeNull();
    expect(activeAllTasksSort({ saved: RN('priority'), temp: null })).toEqual({ kind: 'runway', sort: RN('priority') });
    const temp = { field: 'summary' as const, direction: 'asc' as const };
    expect(activeAllTasksSort({ saved: RN('priority'), temp })).toEqual({ kind: 'header', sort: temp });
  });

  it('choosing a key saves it ascending; the same key keeps its direction', () => {
    expect(allTasksSortAction(none, { type: 'chooseKey', key: 'ticketId' })).toEqual({ temp: null, save: RN('ticketId') });
    const saved = { saved: RN('runwayNumber', 'desc'), temp: null };
    expect(allTasksSortAction(saved, { type: 'chooseKey', key: 'priority' })).toEqual({ temp: null, save: RN('priority') });
    // Already on screen and remembered: nothing to write.
    expect(allTasksSortAction(saved, { type: 'chooseKey', key: 'runwayNumber' })).toEqual({ temp: null, save: undefined });
  });

  it('choosing a key over a temporary header sort ends it and saves', () => {
    const state = { saved: RN('ticketId'), temp: { field: 'status' as const, direction: 'asc' as const } };
    expect(allTasksSortAction(state, { type: 'chooseKey', key: 'ticketId' })).toEqual({ temp: null, save: RN('ticketId') });
  });

  it('the direction applies to the active Runway sort and saves it; with none it does nothing', () => {
    expect(allTasksSortAction({ saved: RN('priority'), temp: null }, { type: 'chooseDirection', direction: 'desc' }))
      .toEqual({ temp: null, save: RN('priority', 'desc') });
    expect(allTasksSortAction(none, { type: 'chooseDirection', direction: 'desc' })).toEqual({ temp: null, save: undefined });
  });

  it('the Runway # and Priority headers choose and save their Runway sort; a second click reverses it', () => {
    expect(allTasksSortAction(none, { type: 'header', field: 'runwayNumber' })).toEqual({ temp: null, save: RN('runwayNumber') });
    expect(allTasksSortAction(none, { type: 'header', field: 'priority' })).toEqual({ temp: null, save: RN('priority') });
    expect(allTasksSortAction({ saved: RN('priority'), temp: null }, { type: 'header', field: 'priority' }))
      .toEqual({ temp: null, save: RN('priority', 'desc') });
    expect(allTasksSortAction({ saved: RN('priority', 'desc'), temp: null }, { type: 'header', field: 'priority' }))
      .toEqual({ temp: null, save: RN('priority') });
  });

  it('the other headers are temporary: they toggle and never write the remembered sort', () => {
    const saved = { saved: RN('ticketId'), temp: null };
    const first = allTasksSortAction(saved, { type: 'header', field: 'summary' });
    expect(first).toEqual({ temp: { field: 'summary', direction: 'asc' }, save: undefined });
    const second = allTasksSortAction({ saved: RN('ticketId'), temp: first.temp }, { type: 'header', field: 'summary' });
    expect(second).toEqual({ temp: { field: 'summary', direction: 'desc' }, save: undefined });
    expect(allTasksSortAction(saved, { type: 'header', field: 'dueDate' }).save).toBeUndefined();
  });

  it('clear removes only a remembered entry, and writes nothing when there is none', () => {
    expect(allTasksSortAction({ saved: RN('ticketId'), temp: null }, { type: 'clear' })).toEqual({ temp: null, save: null });
    expect(allTasksSortAction({ saved: null, temp: { field: 'status', direction: 'asc' } }, { type: 'clear' }))
      .toEqual({ temp: null, save: undefined });
  });

  it('a header shows its own direction only', () => {
    const runway = activeAllTasksSort({ saved: RN('priority', 'desc'), temp: null });
    expect(headerSortDirection(runway, 'priority')).toBe('desc');
    expect(headerSortDirection(runway, 'runwayNumber')).toBeNull();
    expect(headerSortDirection(activeAllTasksSort({ saved: RN('ticketId'), temp: null }), 'priority')).toBeNull();
    const header = activeAllTasksSort({ saved: null, temp: { field: 'status', direction: 'asc' } });
    expect(headerSortDirection(header, 'status')).toBe('asc');
    expect(headerSortDirection(header, 'priority')).toBeNull();
    expect(headerSortDirection(null, 'status')).toBeNull();
  });
});

describe('sortAllTasksFlat (VERM-92)', () => {
  // READ-1 #2 Open, SYNC-3 #1 In Progress, READ-12 #3 Open, PLAT-40 and READ-9 unnumbered.
  const list = [
    issue('READ-12', 'Minor'), issue('PLAT-40', 'Critical', 'In Progress'), issue('SYNC-3', 'Normal', 'In Progress'),
    issue('READ-9', null), issue('READ-1', 'Show-stopper'),
  ];
  const numbers: Record<string, number> = { 'SYNC-3': 1, 'READ-1': 2, 'READ-12': 3 };
  const numberOf = (i: BoardIssue) => numbers[i.idReadable] ?? null;
  const builtIn = { READ: BUILT_IN, SYNC: BUILT_IN, PLAT: BUILT_IN };
  const keys = (sort: RunwaySort) => sortAllTasksFlat(list, sort, numberOf, builtIn).map((i) => i.idReadable);

  it('Runway # reads straight down across statuses, unnumbered last both ways', () => {
    expect(keys(RN('runwayNumber'))).toEqual(['SYNC-3', 'READ-1', 'READ-12', 'PLAT-40', 'READ-9']);
    expect(keys(RN('runwayNumber', 'desc'))).toEqual(['READ-12', 'READ-1', 'SYNC-3', 'PLAT-40', 'READ-9']);
  });

  it('Tracker priority follows the YouTrack Priority bundle, no priority last both ways', () => {
    expect(keys(RN('priority'))).toEqual(['READ-1', 'PLAT-40', 'SYNC-3', 'READ-12', 'READ-9']);
    expect(keys(RN('priority', 'desc'))).toEqual(['READ-12', 'SYNC-3', 'PLAT-40', 'READ-1', 'READ-9']);
  });

  it('Ticket ID orders the prefix as text and the number numerically', () => {
    expect(keys(RN('ticketId'))).toEqual(['PLAT-40', 'READ-1', 'READ-9', 'READ-12', 'SYNC-3']);
    expect(keys(RN('ticketId', 'desc'))).toEqual(['SYNC-3', 'READ-12', 'READ-9', 'READ-1', 'PLAT-40']);
  });

  it('returns a copy and leaves the input order alone', () => {
    const before = list.map((i) => i.idReadable);
    sortAllTasksFlat(list, RN('ticketId'), numberOf, builtIn);
    expect(list.map((i) => i.idReadable)).toEqual(before);
  });
});

describe("Tracker priority uses each project's configured bundle (VERM-92)", () => {
  // READ's bundle puts Minor above Critical — unlike the built-in list. READ-2
  // (Critical) has the smaller ID but is the LESS urgent ticket here, so
  // neither the built-in list nor ticket ID order can produce the right answer.
  const READ_BUNDLE = ['Minor', 'Show-stopper', 'Critical', 'Major', 'Normal'];
  const read2 = issue('READ-2', 'Critical');
  const read3 = issue('READ-3', 'Minor');
  const none = () => null;
  const keys = (list: BoardIssue[], sort: RunwaySort, orders: Record<string, readonly string[]>) =>
    sortAllTasksFlat(list, sort, none, orders).map((i) => i.idReadable);

  it('ascending puts the more urgent ticket first; descending reverses it', () => {
    expect(READ_BUNDLE).not.toEqual(BUILT_IN);
    expect(keys([read2, read3], RN('priority'), { READ: READ_BUNDLE })).toEqual(['READ-3', 'READ-2']);
    expect(keys([read2, read3], RN('priority', 'desc'), { READ: READ_BUNDLE })).toEqual(['READ-2', 'READ-3']);
    // The built-in list would have given the opposite.
    expect(keys([read2, read3], RN('priority'), { READ: BUILT_IN })).toEqual(['READ-2', 'READ-3']);
  });

  it('ranks a ticket from outside the workspace projects by its own project\'s bundle', () => {
    // PLAT's bundle puts Major fourth (rank 3), where the built-in list has it third.
    const PLAT_BUNDLE = ['Show-stopper', 'Critical', 'Normal', 'Major', 'Minor'];
    const list = [issue('READ-1', 'Normal'), read2, read3, issue('READ-4', 'Major'), issue('PLAT-40', 'Major')];
    const orders = { READ: READ_BUNDLE, PLAT: PLAT_BUNDLE };
    expect(keys(list, RN('priority'), orders)).toEqual(['READ-3', 'READ-2', 'PLAT-40', 'READ-4', 'READ-1']);
    expect(keys(list, RN('priority', 'desc'), orders)).toEqual(['READ-1', 'PLAT-40', 'READ-4', 'READ-2', 'READ-3']);
  });

  it("a project whose order is not known ranks its tickets as unknown, after every ranked one", () => {
    const list = [issue('SYNC-1', 'Show-stopper'), read2, read3];
    expect(keys(list, RN('priority'), { READ: READ_BUNDLE })).toEqual(['READ-3', 'READ-2', 'SYNC-1']);
    expect(keys(list, RN('priority', 'desc'), { READ: READ_BUNDLE })).toEqual(['READ-2', 'READ-3', 'SYNC-1']);
  });

  it('finds each ticket\'s project from its key', () => {
    expect(youtrackProjectOf('READ-12')).toBe('READ');
    expect(youtrackProjectOf('TST2-2')).toBe('TST2');
    expect(projectsOfTickets([issue('SYNC-3', null), read2, issue('PLAT-40', null), read3])).toEqual(['PLAT', 'READ', 'SYNC']);
  });
});

describe('remembered sorts in app-config.json (VERM-92)', () => {
  it('keeps only well-formed entries', () => {
    expect(isRunwaySort(RN('priority'))).toBe(true);
    expect(isRunwaySort({ key: 'summary', direction: 'asc' })).toBe(false);
    expect(isRunwaySort({ key: 'priority', direction: 'up' })).toBe(false);
    expect(sanitiseRunwaySorts({
      'ws-a': RN('priority', 'desc'), 'ws-b': { key: 'bogus', direction: 'asc' }, 'ws-c': 'ticketId',
      'ws-d': { key: 'ticketId', direction: 'asc', extra: 1 },
    })).toEqual({ 'ws-a': RN('priority', 'desc'), 'ws-d': RN('ticketId') });
    expect(sanitiseRunwaySorts(null)).toEqual({});
    expect(sanitiseRunwaySorts([RN('priority')])).toEqual({});
  });

  it('sets or removes one workspace entry and leaves the others alone', () => {
    const sorts = { 'ws-a': RN('priority'), 'ws-b': RN('ticketId', 'desc') };
    expect(withRunwaySort(sorts, 'ws-a', RN('runwayNumber'))).toEqual({ 'ws-a': RN('runwayNumber'), 'ws-b': RN('ticketId', 'desc') });
    expect(withRunwaySort(sorts, 'ws-a', null)).toEqual({ 'ws-b': RN('ticketId', 'desc') });
    expect(sorts).toEqual({ 'ws-a': RN('priority'), 'ws-b': RN('ticketId', 'desc') });
  });
});

describe('projectIssuesKey', () => {
  it('differs between workspaces whose project reads finished in the same millisecond', () => {
    // The old key was the times alone: '1700000000000' for both.
    expect(projectIssuesKey(['TST2'], false, [1_700_000_000_000])).not.toBe(projectIssuesKey(['TEST'], false, [1_700_000_000_000]));
  });

  it('differs between open and all issues of the same project at the same time', () => {
    expect(projectIssuesKey(['TEST'], false, [5])).not.toBe(projectIssuesKey(['TEST'], true, [5]));
  });

  it('is stable for the same projects, mode and times', () => {
    expect(projectIssuesKey(['TEST', 'TST2'], false, [5, 6])).toBe(projectIssuesKey(['TEST', 'TST2'], false, [5, 6]));
  });
});
