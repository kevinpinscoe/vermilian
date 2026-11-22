import { describe, expect, it } from 'vitest';
import type { RunwayItem } from '../../../shared/runwayItem';
import type { RunwayTicketRead } from '../../../shared/runwayTicket';
import type { BoardIssue } from '../../../shared/workspace';
import { RUNWAY_ITEMS_QUERY_KEY, RUNWAY_TICKETS_QUERY_KEY } from './api';
import {
  buildRunwayRows,
  dropPosition,
  jiraRunwayKeys,
  movedItems,
  panelRunwayRow,
  panelTicketIds,
  parseRunwayNumber,
  removePrompt,
  ticketStateBadge,
} from './rows';

// Synthetic keys and names only.
const WS = 'ws-3f9a1c2b7d01';

function item(itemId: string, kind: RunwayItem['kind'], position: number, text: string | null = null, depth = 0): RunwayItem {
  return {
    workspaceId: WS,
    itemId,
    kind,
    position,
    runwayNumber: null,
    depth,
    text,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function issue(idReadable: string, summary: string): BoardIssue {
  return { id: `2-${idReadable.length}`, idReadable, summary, resolved: null, fields: {} as BoardIssue['fields'], parentEpic: null, isEpic: false };
}

// The spec's example: a note, five tickets, a section and a note.
const ITEMS: RunwayItem[] = [
  item('yt:READ-20', 'issue', 6),
  item('note:n1', 'note', 1, 'Readers lose their place on the train.'),
  item('yt:READ-12', 'issue', 2),
  item('yt:SYNC-3', 'issue', 3),
  item('sec:later', 'section', 7, 'Later'),
  item('yt:READ-14', 'issue', 4),
  item('yt:SYNC-7', 'issue', 5),
  item('note:n2', 'note', 8, 'Look at READ-9 again.', 1),
];

describe('buildRunwayRows', () => {
  it('shows every row in stored order, numbering tickets only', () => {
    const rows = buildRunwayRows(ITEMS, null);
    expect(rows.map((r) => [r.itemId, r.kind === 'ticket' ? r.runwayNumber : null])).toEqual([
      ['note:n1', null],
      ['yt:READ-12', 1],
      ['yt:SYNC-3', 2],
      ['yt:READ-14', 3],
      ['yt:SYNC-7', 4],
      ['yt:READ-20', 5],
      ['sec:later', null],
      ['note:n2', null],
    ]);
  });

  it('keeps section and note text and depth', () => {
    const rows = buildRunwayRows(ITEMS, null);
    expect(rows.find((r) => r.itemId === 'sec:later')).toEqual({ kind: 'section', itemId: 'sec:later', depth: 0, text: 'Later' });
    expect(rows.find((r) => r.itemId === 'note:n2')).toEqual({ kind: 'note', itemId: 'note:n2', depth: 1, text: 'Look at READ-9 again.' });
  });

  it('shows tickets as loading, with their IDs, until the tracker answers', () => {
    const row = buildRunwayRows(ITEMS, null).find((r) => r.itemId === 'yt:READ-12');
    expect(row).toMatchObject({ kind: 'ticket', ticketId: 'READ-12', state: 'loading', issue: null, reason: null });
  });

  it('joins each ticket with its read and keeps unresolved tickets in place with a reason', () => {
    const reads: RunwayTicketRead[] = [
      { itemId: 'yt:READ-12', state: 'resolved', issue: issue('READ-12', 'Cache articles locally') },
      { itemId: 'yt:SYNC-3', state: 'missing-or-unreadable' },
      { itemId: 'yt:READ-14', state: 'not-readable', reason: 'No access to READ-14' },
      { itemId: 'yt:SYNC-7', state: 'missing' },
      { itemId: 'yt:READ-20', state: 'wrong-tracker', reason: 'READ-20 is a Jira ticket; this workspace reads YouTrack only.' },
    ];
    const tickets = buildRunwayRows(ITEMS, reads).filter((r) => r.kind === 'ticket');
    expect(tickets.map((r) => (r.kind === 'ticket' ? [r.runwayNumber, r.ticketId, r.state, r.issue?.summary ?? null, r.reason] : null))).toEqual([
      [1, 'READ-12', 'resolved', 'Cache articles locally', null],
      [2, 'SYNC-3', 'missing-or-unreadable', null, expect.stringMatching(/^Missing or not readable: the tracker answered 404/)],
      [3, 'READ-14', 'not-readable', null, 'Not readable with this workspace’s credential: No access to READ-14'],
      [4, 'SYNC-7', 'missing', null, 'Missing: the tracker says this ticket is gone.'],
      [5, 'READ-20', 'wrong-tracker', null, 'Wrong tracker: READ-20 is a Jira ticket; this workspace reads YouTrack only.'],
    ]);
  });

  it('a resolved row shows the tracker key, not the stored ID', () => {
    // Stored under the YouTrack entity ID; the tracker answers with the readable key.
    const resolved = { ...issue('READ-12', 'Cache articles locally'), id: '2-45' };
    const rows = buildRunwayRows([item('yt:2-45', 'issue', 1), item('yt:2-46', 'issue', 2)], [
      { itemId: 'yt:2-45', state: 'resolved', issue: resolved },
      { itemId: 'yt:2-46', state: 'missing-or-unreadable' },
    ]);
    expect(rows.map((r) => (r.kind === 'ticket' ? [r.itemId, r.ticketId, r.state] : null))).toEqual([
      ['yt:2-45', 'READ-12', 'resolved'],
      // Unresolved, there is no key to show: the stored ID is all there is.
      ['yt:2-46', '2-46', 'missing-or-unreadable'],
    ]);
  });

  it('a moved Jira ticket shows the key the tracker answered with', () => {
    const rows = buildRunwayRows([item('jira:DEMO-5', 'issue', 1)], [
      { itemId: 'jira:DEMO-5', state: 'resolved', issue: issue('PLAT-40', 'Moved ticket') },
    ]);
    expect(rows[0]).toMatchObject({ itemId: 'jira:DEMO-5', ticketId: 'PLAT-40' });
  });

  it('a failed read keeps every row, marked not refreshed with the error', () => {
    const rows = buildRunwayRows(ITEMS, null, 'The tracker refused this workspace’s credential: HTTP 401');
    expect(rows).toHaveLength(ITEMS.length);
    const row = rows.find((r) => r.itemId === 'yt:SYNC-3');
    expect(row).toMatchObject({
      state: 'not-refreshed',
      runwayNumber: 2,
      reason: 'Not refreshed: The tracker refused this workspace’s credential: HTTP 401',
    });
  });

  it('a Jira Runway works the same way, including a workspace with no board projects', () => {
    const rows = buildRunwayRows([item('jira:OPS-7', 'issue', 1), item('jira:DEMO-101', 'issue', 2)], [
      { itemId: 'jira:OPS-7', state: 'resolved', issue: issue('OPS-7', 'Rotate the on-call schedule') },
      { itemId: 'jira:DEMO-101', state: 'resolved', issue: issue('DEMO-101', 'Ship the demo') },
    ]);
    expect(rows.map((r) => (r.kind === 'ticket' ? [r.runwayNumber, r.ticketId, r.state] : null))).toEqual([
      [1, 'OPS-7', 'resolved'],
      [2, 'DEMO-101', 'resolved'],
    ]);
  });

  it('an empty Runway has no rows', () => {
    expect(buildRunwayRows([], [])).toEqual([]);
  });
});

describe('ticketStateBadge', () => {
  it('labels every unresolved state and none for a resolved ticket', () => {
    expect(ticketStateBadge('resolved')).toBeNull();
    expect(ticketStateBadge('missing-or-unreadable')).toBe('Missing or not readable');
    expect(ticketStateBadge('not-readable')).toBe('Not readable');
    expect(ticketStateBadge('missing')).toBe('Missing');
    expect(ticketStateBadge('wrong-tracker')).toBe('Wrong tracker');
    expect(ticketStateBadge('not-refreshed')).toBe('Not refreshed');
    expect(ticketStateBadge('loading')).toBe('Loading…');
  });
});

describe('jiraRunwayKeys', () => {
  it('lists the Jira ticket keys only', () => {
    expect(jiraRunwayKeys([item('jira:OPS-7', 'issue', 1), item('sec:a', 'section', 2, 'A'), item('yt:READ-12', 'issue', 3)])).toEqual(['OPS-7']);
    expect(jiraRunwayKeys(undefined)).toEqual([]);
  });
});

describe('Runway query keys', () => {
  it('are per workspace', () => {
    expect(RUNWAY_ITEMS_QUERY_KEY(WS)).toEqual(['runway-items', WS]);
    expect(RUNWAY_TICKETS_QUERY_KEY(WS)).toEqual(['runway-tickets', WS]);
  });
});

describe('parseRunwayNumber (Add box "at #", VERM-86)', () => {
  it('empty means the end; a whole number of 1 or more is a position', () => {
    expect(parseRunwayNumber('')).toBeUndefined();
    expect(parseRunwayNumber('  ')).toBeUndefined();
    expect(parseRunwayNumber('1')).toBe(1);
    expect(parseRunwayNumber(' 12 ')).toBe(12);
  });
  it.each(['0', '-1', '1.5', 'two', '1e2'])('refuses %s', (text) => {
    expect(parseRunwayNumber(text)).toBeNull();
  });
});

describe('removePrompt (VERM-87)', () => {
  it('names a ticket by the key shown on its row', () => {
    const [row] = buildRunwayRows([item('yt:2-45', 'issue', 1)], [{ itemId: 'yt:2-45', state: 'resolved', issue: issue('READ-12', 'Cache') }]);
    expect(removePrompt(row)).toBe('Remove READ-12 from this Runway?');
  });
  it('shows a heading’s or note’s own text, clipped when long', () => {
    const [section, note] = buildRunwayRows([item('sec:a', 'section', 1, 'Week 1'), item('note:b', 'note', 2, `Check ${'x'.repeat(100)}`)], []);
    expect(removePrompt(section)).toBe('Remove the heading “Week 1” from this Runway?');
    const p = removePrompt(note);
    expect(p.startsWith('Remove the note “Check xxx')).toBe(true);
    expect(p).toContain('…” from this Runway?');
    expect(p.length).toBeLessThan(130);
  });
});

describe('dropPosition (VERM-87)', () => {
  const rows = ['a', 'b', 'c', 'd'].map((itemId) => ({ itemId }));
  it('puts the dragged row where the row it was dropped on was', () => {
    expect(dropPosition(rows, 'a', 'c')).toBe(3);
    expect(dropPosition(rows, 'd', 'a')).toBe(1);
  });
  it('is null when nothing changes or a row is unknown', () => {
    expect(dropPosition(rows, 'b', 'b')).toBeNull();
    expect(dropPosition(rows, 'b', null)).toBeNull();
    expect(dropPosition(rows, 'x', 'a')).toBeNull();
    expect(dropPosition(rows, 'a', 'x')).toBeNull();
  });
});

describe('movedItems (VERM-87)', () => {
  const items = [item('yt:A-1', 'issue', 1), item('sec:s', 'section', 2, 'S'), item('yt:A-2', 'issue', 3), item('yt:A-3', 'issue', 4)];
  const shape = (xs: RunwayItem[]) => xs.map((x) => [x.itemId, x.position, x.runwayNumber]);
  it('moves a row and keeps positions and Runway # dense', () => {
    expect(shape(movedItems(items, 'yt:A-3', 1))).toEqual([
      ['yt:A-3', 1, 1],
      ['yt:A-1', 2, 2],
      ['sec:s', 3, null],
      ['yt:A-2', 4, 3],
    ]);
    expect(shape(movedItems(items, 'sec:s', 4))).toEqual([
      ['yt:A-1', 1, 1],
      ['yt:A-2', 2, 2],
      ['yt:A-3', 3, 3],
      ['sec:s', 4, null],
    ]);
  });
  it('clamps past the end and leaves an unknown row alone', () => {
    expect(shape(movedItems(items, 'yt:A-1', 99)).at(-1)).toEqual(['yt:A-1', 4, 3]);
    expect(shape(movedItems(items, 'yt:X-9', 1))).toEqual(shape(items));
  });
});

describe('panelRunwayRow (detail panel Runway #, VERM-88)', () => {
  const yt = (keys: string[], entityId: string | null = null) => ({ tracker: 'youtrack' as const, keys, entityId });

  it('finds the row by the readable key and gives its stored ID and Runway #', () => {
    expect(panelRunwayRow(ITEMS, null, yt(['READ-14'], '2-77'))).toEqual({ itemId: 'yt:READ-14', runwayNumber: 3 });
  });

  it('finds a YouTrack ticket saved under its entity ID, and returns that stored ID', () => {
    const items = [item('yt:READ-12', 'issue', 1), item('yt:2-45', 'issue', 2)];
    expect(panelRunwayRow(items, null, yt(['READ-30'], '2-45'))).toEqual({ itemId: 'yt:2-45', runwayNumber: 2 });
  });

  it('finds a Jira ticket saved under a key it has since moved from, by the row’s tracker read', () => {
    const items = [item('jira:OPS-7', 'issue', 1), item('note:n', 'note', 2, 'x'), item('jira:OLD-3', 'issue', 3)];
    const moved: BoardIssue = { ...issue('OPS-956', 'Moved'), id: '10042' };
    const reads: RunwayTicketRead[] = [{ itemId: 'jira:OLD-3', state: 'resolved', issue: moved }];
    const ticket = { tracker: 'jira' as const, keys: ['OPS-956'], entityId: null };
    expect(panelRunwayRow(items, null, ticket)).toBeNull();
    expect(panelRunwayRow(items, reads, ticket)).toEqual({ itemId: 'jira:OLD-3', runwayNumber: 2 });
  });

  it('finds a Jira row by the old key the panel was opened with', () => {
    const items = [item('jira:OLD-3', 'issue', 1)];
    const ticket = { tracker: 'jira' as const, keys: ['OPS-956', 'OLD-3'], entityId: null };
    expect(panelRunwayRow(items, null, ticket)).toEqual({ itemId: 'jira:OLD-3', runwayNumber: 1 });
  });

  it('is null for a ticket not on the Runway, and never matches a section or note', () => {
    expect(panelRunwayRow(ITEMS, null, yt(['READ-9']))).toBeNull();
    expect(panelRunwayRow([item('sec:later', 'section', 1, 'Later')], null, yt(['READ-9']))).toBeNull();
  });

  it('ignores a resolved read for another ticket and unresolved reads', () => {
    const reads: RunwayTicketRead[] = [
      { itemId: 'yt:READ-12', state: 'resolved', issue: issue('READ-12', 'x') },
      { itemId: 'yt:SYNC-3', state: 'missing' },
    ];
    expect(panelRunwayRow(ITEMS, reads, yt(['READ-9']))).toBeNull();
  });

  it('panelTicketIds namespaces every valid ID once and drops invalid ones', () => {
    expect(panelTicketIds(yt(['READ-12', 'READ-12'], '2-45'))).toEqual(['yt:READ-12', 'yt:2-45']);
    expect(panelTicketIds({ tracker: 'jira', keys: ['OPS-7', ''], entityId: '10042' })).toEqual(['jira:OPS-7']);
  });
});
