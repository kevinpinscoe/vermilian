import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeIssueId } from '../../shared/tracker';
import { openRunwayDb } from './runwayDb';
import {
  RunwayItemStoreError,
  createRunwayItemStore,
  type RunwayItem,
  type RunwayItemStore,
} from './runwayItemStore';

// Synthetic keys only: this is a public repository.
const jira = (key: string) => encodeIssueId('jira', key);
const yt = (id: string) => encodeIssueId('youtrack', id);

function expectStoreError(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(RunwayItemStoreError);
  expect(thrown).toMatchObject({ code });
}

const ids = (items: RunwayItem[]) => items.map((i) => i.itemId);

let dir: string;
let db: DatabaseSync;
let store: RunwayItemStore;
let tick: number;
// Every call returns a later instant, so a rewritten timestamp is always visible.
const clock = () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000);

beforeEach(() => {
  tick = 0;
  dir = mkdtempSync(join(tmpdir(), 'vermilian-runway-items-'));
  db = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
  store = createRunwayItemStore(db, clock);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Raw rows straight from the table, bypassing the store. */
function rawRows(workspaceId: string) {
  return db
    .prepare(
      `SELECT item_id, kind, position, depth, text, added_at, updated_at
       FROM runway_item WHERE workspace_id = ? ORDER BY position`,
    )
    .all(workspaceId) as Array<{
    item_id: string;
    kind: string;
    position: number;
    depth: number;
    text: string | null;
    added_at: string;
    updated_at: string;
  }>;
}

function expectDense(workspaceId: string): void {
  const positions = rawRows(workspaceId).map((r) => Number(r.position));
  expect(positions).toEqual(positions.map((_, i) => i + 1));
}

function timestamps(workspaceId: string): Record<string, string> {
  return Object.fromEntries(rawRows(workspaceId).map((r) => [r.item_id, r.updated_at]));
}

/** Seeds `keys` as Jira tickets at the end, in order. */
function seed(workspaceId: string, keys: string[]): void {
  for (const k of keys) store.addIssue(workspaceId, jira(k));
}

describe('list', () => {
  it('is empty for a workspace with no Runway', () => {
    expect(store.list('ws-a')).toEqual([]);
  });

  it('returns rows in position order with their stored fields', () => {
    store.addIssue('ws-a', jira('DEMO-1'));
    store.addIssue('ws-a', yt('2-7'));
    const items = store.list('ws-a');
    expect(items).toEqual([
      {
        workspaceId: 'ws-a',
        itemId: 'jira:DEMO-1',
        kind: 'issue',
        position: 1,
        runwayNumber: 1,
        depth: 0,
        text: null,
        addedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        workspaceId: 'ws-a',
        itemId: 'yt:2-7',
        kind: 'issue',
        position: 2,
        runwayNumber: 2,
        depth: 0,
        text: null,
        addedAt: '2026-01-01T00:00:01.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
      },
    ]);
  });

  it('is read-only: it writes nothing and leaves no transaction open', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    const changesBefore = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = rawRows('ws-a');
    store.list('ws-a');
    store.list('ws-b');
    expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(changesBefore);
    expect(rawRows('ws-a')).toEqual(before);
    expect(db.isTransaction).toBe(false);
  });
});

describe('addIssue', () => {
  it('adds at the end by default', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    store.addIssue('ws-a', jira('DEMO-3'));
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-1', 'jira:DEMO-2', 'jira:DEMO-3']);
    expectDense('ws-a');
  });

  it('adds at #N and shifts the rows from N down by one', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    store.addIssue('ws-a', jira('DEMO-9'), 2);
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-1', 'jira:DEMO-9', 'jira:DEMO-2', 'jira:DEMO-3']);
    expectDense('ws-a');
  });

  it('adds at #1 to the top', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    store.addIssue('ws-a', jira('DEMO-9'), 1);
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-9', 'jira:DEMO-1', 'jira:DEMO-2']);
  });

  it('treats a number past the end as last: #99 with five rows puts the new ticket sixth', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5']);
    store.addIssue('ws-a', jira('DEMO-9'), 99);
    const items = store.list('ws-a');
    expect(items.at(-1)).toMatchObject({ itemId: 'jira:DEMO-9', position: 6 });
    expectDense('ws-a');
  });

  it('returns the workspace order after the change', () => {
    seed('ws-a', ['DEMO-1']);
    expect(ids(store.addIssue('ws-a', jira('DEMO-2'), 1))).toEqual(['jira:DEMO-2', 'jira:DEMO-1']);
  });

  it('accepts YouTrack and Jira ticket IDs', () => {
    store.addIssue('ws-a', yt('2-1'));
    store.addIssue('ws-b', jira('DEMO-1'));
    expect(store.list('ws-a')[0]).toMatchObject({ itemId: 'yt:2-1', kind: 'issue', text: null, depth: 0 });
    expect(store.list('ws-b')[0]).toMatchObject({ itemId: 'jira:DEMO-1', kind: 'issue' });
  });

  it('refuses a ticket already on that Runway and leaves the order alone', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    const before = rawRows('ws-a');
    expectStoreError(() => store.addIssue('ws-a', jira('DEMO-2'), 1), 'already-on-runway');
    expect(rawRows('ws-a')).toEqual(before);
  });

  it.each([
    ['a bare key', 'DEMO-1'],
    ['an unknown prefix', 'gh:DEMO-1'],
    ['a section ID', 'sec:0b4e'],
    ['an empty string', ''],
  ])('refuses %s as a ticket ID', (_label, id) => {
    expectStoreError(() => store.addIssue('ws-a', id), 'invalid-issue-id');
    expect(store.list('ws-a')).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses position %s', (pos) => {
    seed('ws-a', ['DEMO-1']);
    expectStoreError(() => store.addIssue('ws-a', jira('DEMO-2'), pos), 'invalid-position');
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-1']);
  });

  it('refuses an empty workspace ID', () => {
    expectStoreError(() => store.addIssue('', jira('DEMO-1')), 'invalid-workspace');
  });

  it('touches only runway_item: no Desk entry, no other table', () => {
    store.addIssue('ws-a', jira('DEMO-1'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM runway_entry').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM dismissal').get()).toEqual({ n: 0 });
  });

  it('stamps only the new row and the rows it moves down', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    const before = timestamps('ws-a');
    store.addIssue('ws-a', jira('DEMO-9'), 3);
    const after = timestamps('ws-a');
    expect(after['jira:DEMO-1']).toBe(before['jira:DEMO-1']);
    expect(after['jira:DEMO-2']).toBe(before['jira:DEMO-2']);
    expect(after['jira:DEMO-3']).not.toBe(before['jira:DEMO-3']);
    expect(after['jira:DEMO-9']).toBeDefined();
  });
});

describe('remove', () => {
  it('removes the row and closes the gap', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    expect(ids(store.remove('ws-a', jira('DEMO-2')))).toEqual(['jira:DEMO-1', 'jira:DEMO-3']);
    expectDense('ws-a');
  });

  it('stamps only the rows that move up', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4']);
    const before = timestamps('ws-a');
    store.remove('ws-a', jira('DEMO-3'));
    const after = timestamps('ws-a');
    expect(after['jira:DEMO-1']).toBe(before['jira:DEMO-1']);
    expect(after['jira:DEMO-2']).toBe(before['jira:DEMO-2']);
    expect(after['jira:DEMO-4']).not.toBe(before['jira:DEMO-4']);
  });

  it('removing the last row changes no other timestamp', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    const before = timestamps('ws-a');
    store.remove('ws-a', jira('DEMO-2'));
    expect(timestamps('ws-a')).toEqual({ 'jira:DEMO-1': before['jira:DEMO-1'] });
  });

  it('refuses an item that is not on that Runway', () => {
    seed('ws-a', ['DEMO-1']);
    expectStoreError(() => store.remove('ws-a', jira('DEMO-2')), 'not-on-runway');
    expectStoreError(() => store.remove('ws-b', jira('DEMO-1')), 'not-on-runway');
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-1']);
  });
});

describe('move', () => {
  it('moves a row down and closes up behind it', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4']);
    store.move('ws-a', jira('DEMO-1'), 3);
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-2', 'jira:DEMO-3', 'jira:DEMO-1', 'jira:DEMO-4']);
    expectDense('ws-a');
  });

  it('moves a row up and shifts the rows it passes', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4']);
    store.move('ws-a', jira('DEMO-4'), 2);
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-1', 'jira:DEMO-4', 'jira:DEMO-2', 'jira:DEMO-3']);
    expectDense('ws-a');
  });

  it('treats a number past the end as last: #99 with five rows puts the ticket fifth', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5']);
    store.move('ws-a', jira('DEMO-2'), 99);
    const items = store.list('ws-a');
    expect(items).toHaveLength(5);
    expect(items[4]).toMatchObject({ itemId: 'jira:DEMO-2', position: 5 });
    expectDense('ws-a');
  });

  it('stamps only rows whose final position changes', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5']);
    const before = timestamps('ws-a');
    store.move('ws-a', jira('DEMO-2'), 4); // 1 3 4 2 5
    const after = timestamps('ws-a');
    for (const unchanged of ['DEMO-1', 'DEMO-5']) {
      expect(after[`jira:${unchanged}`]).toBe(before[`jira:${unchanged}`]);
    }
    for (const changed of ['DEMO-2', 'DEMO-3', 'DEMO-4']) {
      expect(after[`jira:${changed}`]).not.toBe(before[`jira:${changed}`]);
    }
  });

  it('a move to the current position writes nothing', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    const before = rawRows('ws-a');
    store.move('ws-a', jira('DEMO-2'), 2);
    store.move('ws-a', jira('DEMO-3'), 99);
    expect(rawRows('ws-a')).toEqual(before);
  });

  it.each([0, -3, 2.5])('refuses position %s and leaves the order alone', (pos) => {
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    const before = rawRows('ws-a');
    expectStoreError(() => store.move('ws-a', jira('DEMO-1'), pos), 'invalid-position');
    expect(rawRows('ws-a')).toEqual(before);
  });

  it('refuses an item that is not on that Runway', () => {
    seed('ws-a', ['DEMO-1']);
    expectStoreError(() => store.move('ws-a', jira('DEMO-9'), 1), 'not-on-runway');
  });
});

describe('moveUp and moveDown', () => {
  it('swap a row with its neighbour', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    store.moveUp('ws-a', jira('DEMO-3'));
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-1', 'jira:DEMO-3', 'jira:DEMO-2']);
    store.moveDown('ws-a', jira('DEMO-1'));
    expect(ids(store.list('ws-a'))).toEqual(['jira:DEMO-3', 'jira:DEMO-1', 'jira:DEMO-2']);
    expectDense('ws-a');
  });

  it('moving the first row up preserves every row and timestamp', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    const before = rawRows('ws-a');
    store.moveUp('ws-a', jira('DEMO-1'));
    expect(rawRows('ws-a')).toEqual(before);
  });

  it('moving the last row down preserves every row and timestamp', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    const before = rawRows('ws-a');
    store.moveDown('ws-a', jira('DEMO-3'));
    expect(rawRows('ws-a')).toEqual(before);
  });

  it('refuse an item that is not on that Runway', () => {
    expectStoreError(() => store.moveUp('ws-a', jira('DEMO-1')), 'not-on-runway');
    expectStoreError(() => store.moveDown('ws-a', jira('DEMO-1')), 'not-on-runway');
  });
});

describe('imported sections and notes', () => {
  // Rows as a snapshot import (VERM-79) leaves them: written directly, not by the store.
  function importRows(workspaceId: string): void {
    const insert = db.prepare(
      `INSERT INTO runway_item (workspace_id, item_id, kind, position, depth, text, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const t = '2025-06-01T12:00:00.000Z';
    const rows: Array<[string, string, number, string | null]> = [
      ['sec:aaaa', 'section', 0, 'Phase one'],
      ['jira:DEMO-1', 'issue', 1, null],
      ['note:bbbb', 'note', 1, 'Wait for the vendor reply'],
      ['jira:DEMO-2', 'issue', 1, null],
      ['sec:cccc', 'section', 0, 'Phase two'],
      ['jira:DEMO-3', 'issue', 1, null],
      ['note:dddd', 'note', 2, 'Synthetic follow-up'],
    ];
    rows.forEach(([id, kind, depth, text], i) => insert.run(workspaceId, id, kind, i + 1, depth, text, t, t));
  }

  it('moving a ticket keeps section and note text, depth and relative order', () => {
    importRows('ws-a');
    const before = rawRows('ws-a');
    const structural = (rows: typeof before) =>
      rows.filter((r) => r.kind !== 'issue').map(({ item_id, kind, depth, text }) => ({ item_id, kind, depth, text }));

    store.move('ws-a', jira('DEMO-3'), 2);

    const after = rawRows('ws-a');
    expect(after.map((r) => r.item_id)).toEqual([
      'sec:aaaa',
      'jira:DEMO-3',
      'jira:DEMO-1',
      'note:bbbb',
      'jira:DEMO-2',
      'sec:cccc',
      'note:dddd',
    ]);
    expect(structural(after)).toEqual(structural(before));
    expectDense('ws-a');
    // The first section did not move, so its timestamp is untouched.
    expect(after[0].updated_at).toBe(before[0].updated_at);
    // Every ticket row keeps depth and null text.
    expect(after.filter((r) => r.kind === 'issue').every((r) => r.text === null)).toBe(true);
  });

  it('adding and removing tickets keeps section and note order', () => {
    importRows('ws-a');
    store.addIssue('ws-a', yt('2-1'), 1);
    store.remove('ws-a', jira('DEMO-2'));
    const order = ids(store.list('ws-a')).filter((id) => !id.includes(':DEMO') && !id.startsWith('yt:'));
    expect(order).toEqual(['sec:aaaa', 'note:bbbb', 'sec:cccc', 'note:dddd']);
    expect(store.list('ws-a').find((i) => i.itemId === 'note:bbbb')).toMatchObject({
      kind: 'note',
      depth: 1,
      text: 'Wait for the vendor reply',
    });
    expectDense('ws-a');
  });

  it('a section row can be moved and removed by its ID', () => {
    importRows('ws-a');
    store.move('ws-a', 'sec:cccc', 1);
    expect(store.list('ws-a')[0]).toMatchObject({ itemId: 'sec:cccc', kind: 'section', text: 'Phase two' });
    store.remove('ws-a', 'sec:cccc');
    expect(ids(store.list('ws-a'))).not.toContain('sec:cccc');
    expectDense('ws-a');
  });
});

describe('section and note rows (VERM-81)', () => {
  let n: number;
  const numbered = () => {
    n = 0;
    return createRunwayItemStore(db, clock, () => `id${++n}`);
  };
  /** [itemId, Runway #] per row, in row order. */
  const numbers = (workspaceId: string, s: RunwayItemStore = store) =>
    s.list(workspaceId).map((i) => [i.itemId, i.runwayNumber]);

  it('adds a section and a note with text and depth at the end', () => {
    const s = numbered();
    s.addIssue('ws-a', jira('DEMO-1'));
    s.addSection('ws-a', 'Later', { depth: 1 });
    s.addNote('ws-a', 'Look at DEMO-9 again', { depth: 2 });
    expect(s.list('ws-a').map(({ itemId, kind, position, depth, text }) => ({ itemId, kind, position, depth, text })))
      .toEqual([
        { itemId: 'jira:DEMO-1', kind: 'issue', position: 1, depth: 0, text: null },
        { itemId: 'sec:id1', kind: 'section', position: 2, depth: 1, text: 'Later' },
        { itemId: 'note:id2', kind: 'note', position: 3, depth: 2, text: 'Look at DEMO-9 again' },
      ]);
    expectDense('ws-a');
  });

  it('generates distinct sec: and note: IDs by default', () => {
    store.addSection('ws-a', 'Later');
    store.addSection('ws-a', 'Later');
    store.addNote('ws-a', 'Same text');
    store.addNote('ws-a', 'Same text');
    const got = ids(store.list('ws-a'));
    expect(new Set(got).size).toBe(4);
    expect(got.filter((id) => /^sec:[0-9a-f-]{36}$/.test(id))).toHaveLength(2);
    expect(got.filter((id) => /^note:[0-9a-f-]{36}$/.test(id))).toHaveLength(2);
  });

  it('adds a section or note at a row position, shifting later rows', () => {
    const s = numbered();
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    s.addSection('ws-a', 'Phase two', { position: 2 });
    s.addNote('ws-a', 'Intro', { position: 1 });
    s.addNote('ws-a', 'Tail', { position: 99 });
    expect(ids(s.list('ws-a'))).toEqual(['note:id2', 'jira:DEMO-1', 'sec:id1', 'jira:DEMO-2', 'note:id3']);
    expectDense('ws-a');
  });

  it('refuses bad text, depth and position and writes nothing', () => {
    seed('ws-a', ['DEMO-1']);
    const before = rawRows('ws-a');
    expectStoreError(() => store.addSection('ws-a', ''), 'invalid-text');
    expectStoreError(() => store.addNote('ws-a', '   \n'), 'invalid-text');
    for (const depth of [-1, 5, 1.5, Number.NaN]) {
      expectStoreError(() => store.addSection('ws-a', 'X', { depth }), 'invalid-depth');
    }
    for (const position of [0, -2, 2.5]) {
      expectStoreError(() => store.addNote('ws-a', 'X', { position }), 'invalid-position');
    }
    expectStoreError(() => store.addSection('', 'X'), 'invalid-workspace');
    expect(rawRows('ws-a')).toEqual(before);
  });

  it('section and note rows keep their position and depth as tickets come and go', () => {
    const s = numbered();
    s.addSection('ws-a', 'Phase one');
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    s.addNote('ws-a', 'Indented', { depth: 3 });
    s.addIssue('ws-a', jira('DEMO-3'));
    s.addIssueAtNumber('ws-a', jira('DEMO-10'), 1);
    s.remove('ws-a', jira('DEMO-2'));
    s.moveToNumber('ws-a', jira('DEMO-3'), 1);
    const structural = s.list('ws-a').filter((i) => i.kind !== 'issue');
    expect(structural.map(({ itemId, depth, text }) => ({ itemId, depth, text }))).toEqual([
      { itemId: 'sec:id1', depth: 0, text: 'Phase one' },
      { itemId: 'note:id2', depth: 3, text: 'Indented' },
    ]);
    expect(ids(s.list('ws-a'))).toEqual(['sec:id1', 'jira:DEMO-3', 'jira:DEMO-10', 'jira:DEMO-1', 'note:id2']);
    expectDense('ws-a');
  });

  it('Runway # counts ticket rows only, and is null on sections and notes', () => {
    // The synthetic worked example in spec/features/workspace-runway.md.
    const s = numbered();
    s.addNote('ws-a', 'Readers lose their place on the train.');
    for (const id of ['2-12', '3-3', '2-14', '3-7', '2-20']) s.addIssue('ws-a', yt(id));
    s.addSection('ws-a', 'Later');
    s.addNote('ws-a', 'Look at READ-9 again', { depth: 1 });
    expect(numbers('ws-a', s)).toEqual([
      ['note:id1', null],
      ['yt:2-12', 1],
      ['yt:3-3', 2],
      ['yt:2-14', 3],
      ['yt:3-7', 4],
      ['yt:2-20', 5],
      ['sec:id2', null],
      ['note:id3', null],
    ]);
    // Stored positions still count every row.
    expect(s.list('ws-a').map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('Runway # is per workspace', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    store.addSection('ws-b', 'Top');
    seed('ws-b', ['DEMO-2']);
    expect(numbers('ws-a').map(([, k]) => k)).toEqual([1, 2]);
    expect(numbers('ws-b').map(([, k]) => k)).toEqual([null, 1]);
  });

  it('Runway # is never stored: the table has no column for it', () => {
    const columns = (db.prepare(`PRAGMA table_info(runway_item)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).not.toContain('runway_number');
  });

  describe('addIssueAtNumber', () => {
    // Row order: S1, DEMO-1 (#1), N1, DEMO-2 (#2), S2
    beforeEach(() => {
      const s = numbered();
      s.addSection('ws-a', 'S1');
      s.addIssue('ws-a', jira('DEMO-1'));
      s.addNote('ws-a', 'N1');
      s.addIssue('ws-a', jira('DEMO-2'));
      s.addSection('ws-a', 'S2');
    });

    it('goes immediately before the ticket that holds the number', () => {
      store.addIssueAtNumber('ws-a', jira('NEW-1'), 2);
      expect(numbers('ws-a')).toEqual([
        ['sec:id1', null],
        ['jira:DEMO-1', 1],
        ['note:id2', null],
        ['jira:NEW-1', 2],
        ['jira:DEMO-2', 3],
        ['sec:id3', null],
      ]);
      expectDense('ws-a');
    });

    it('#1 goes before the first ticket, after a leading section', () => {
      store.addIssueAtNumber('ws-a', jira('NEW-1'), 1);
      expect(ids(store.list('ws-a')).slice(0, 2)).toEqual(['sec:id1', 'jira:NEW-1']);
    });

    it('past the last ticket goes immediately after it, before trailing structure', () => {
      store.addIssueAtNumber('ws-a', jira('NEW-1'), 99);
      expect(numbers('ws-a').slice(-2)).toEqual([
        ['jira:NEW-1', 3],
        ['sec:id3', null],
      ]);
    });

    it('with no number goes at the very end', () => {
      store.addIssueAtNumber('ws-a', jira('NEW-1'));
      expect(numbers('ws-a').at(-1)).toEqual(['jira:NEW-1', 3]);
    });

    it('on a Runway with no tickets goes at the end', () => {
      store.addSection('ws-b', 'Only');
      store.addIssueAtNumber('ws-b', jira('NEW-1'), 3);
      expect(numbers('ws-b')).toEqual([
        [expect.stringMatching(/^sec:/), null],
        ['jira:NEW-1', 1],
      ]);
    });

    it('refuses a duplicate, a bad ID and a bad number', () => {
      const before = rawRows('ws-a');
      expectStoreError(() => store.addIssueAtNumber('ws-a', jira('DEMO-1'), 1), 'already-on-runway');
      expectStoreError(() => store.addIssueAtNumber('ws-a', 'sec:x', 1), 'invalid-issue-id');
      expectStoreError(() => store.addIssueAtNumber('ws-a', jira('NEW-1'), 0), 'invalid-position');
      expect(rawRows('ws-a')).toEqual(before);
    });
  });

  describe('moveToNumber', () => {
    // Row order: DEMO-1 (#1), S1, DEMO-2 (#2), N1, DEMO-3 (#3), S2
    beforeEach(() => {
      const s = numbered();
      s.addIssue('ws-a', jira('DEMO-1'));
      s.addSection('ws-a', 'S1');
      s.addIssue('ws-a', jira('DEMO-2'));
      s.addNote('ws-a', 'N1');
      s.addIssue('ws-a', jira('DEMO-3'));
      s.addSection('ws-a', 'S2');
    });

    it('moving up goes immediately before the ticket that held the number', () => {
      store.moveToNumber('ws-a', jira('DEMO-3'), 2);
      expect(numbers('ws-a')).toEqual([
        ['jira:DEMO-1', 1],
        ['sec:id1', null],
        ['jira:DEMO-3', 2],
        ['jira:DEMO-2', 3],
        ['note:id2', null],
        ['sec:id3', null],
      ]);
      expectDense('ws-a');
    });

    it('moving down goes immediately after the ticket that will precede it', () => {
      store.moveToNumber('ws-a', jira('DEMO-1'), 2);
      expect(numbers('ws-a')).toEqual([
        ['sec:id1', null],
        ['jira:DEMO-2', 1],
        ['jira:DEMO-1', 2],
        ['note:id2', null],
        ['jira:DEMO-3', 3],
        ['sec:id3', null],
      ]);
      expectDense('ws-a');
    });

    it('past the end means last, still before trailing structure', () => {
      store.moveToNumber('ws-a', jira('DEMO-1'), 99);
      expect(numbers('ws-a').slice(-2)).toEqual([
        ['jira:DEMO-1', 3],
        ['sec:id3', null],
      ]);
    });

    it('to its own number writes nothing', () => {
      const before = timestamps('ws-a');
      store.moveToNumber('ws-a', jira('DEMO-2'), 2);
      store.moveToNumber('ws-a', jira('DEMO-3'), 99);
      expect(timestamps('ws-a')).toEqual(before);
    });

    it('every target number lands the ticket on that number', () => {
      for (const from of ['DEMO-1', 'DEMO-2', 'DEMO-3']) {
        for (const to of [1, 2, 3]) {
          store.moveToNumber('ws-a', jira(from), to);
          expect(store.list('ws-a').find((i) => i.itemId === jira(from))?.runwayNumber).toBe(to);
          expect(store.list('ws-a').filter((i) => i.kind !== 'issue').map((i) => i.itemId)).toEqual([
            'sec:id1',
            'note:id2',
            'sec:id3',
          ]);
          expectDense('ws-a');
        }
      }
    });

    it('refuses a section or note, a missing row and a bad number', () => {
      const before = rawRows('ws-a');
      expectStoreError(() => store.moveToNumber('ws-a', 'sec:id1', 1), 'not-a-ticket');
      expectStoreError(() => store.moveToNumber('ws-a', 'note:id2', 1), 'not-a-ticket');
      expectStoreError(() => store.moveToNumber('ws-a', jira('NOPE-1'), 1), 'not-on-runway');
      expectStoreError(() => store.moveToNumber('ws-a', jira('DEMO-1'), 0), 'invalid-position');
      expect(rawRows('ws-a')).toEqual(before);
    });
  });
});

describe('transactions', () => {
  it('a mutation that fails partway leaves the order exactly as it was', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4']);
    const before = rawRows('ws-a');
    // Fail the final renumber of one row, after others have already been rewritten.
    db.exec(`CREATE TEMP TRIGGER fail_demo_3 BEFORE UPDATE OF position ON main.runway_item
             WHEN OLD.item_id = 'jira:DEMO-3' AND NEW.position < 100
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    expect(() => store.move('ws-a', jira('DEMO-4'), 1)).toThrow(/injected failure/);
    expect(rawRows('ws-a')).toEqual(before);
    expect(db.isTransaction).toBe(false);
    db.exec('DROP TRIGGER fail_demo_3');
    store.move('ws-a', jira('DEMO-4'), 1);
    expect(ids(store.list('ws-a'))[0]).toBe('jira:DEMO-4');
  });

  it('a refused mutation leaves no transaction open', () => {
    seed('ws-a', ['DEMO-1']);
    expectStoreError(() => store.move('ws-a', jira('DEMO-9'), 1), 'not-on-runway');
    expect(db.isTransaction).toBe(false);
  });
});

describe('workspaces are independent', () => {
  it('one ticket holds different positions in two workspaces', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2', 'DEMO-3']);
    seed('ws-b', ['DEMO-3', 'DEMO-9']);
    expect(store.list('ws-a').find((i) => i.itemId === 'jira:DEMO-3')?.position).toBe(3);
    expect(store.list('ws-b').find((i) => i.itemId === 'jira:DEMO-3')?.position).toBe(1);
  });

  it('removing a ticket from one workspace leaves the other unchanged', () => {
    seed('ws-a', ['DEMO-1', 'DEMO-2']);
    seed('ws-b', ['DEMO-2', 'DEMO-1']);
    const before = rawRows('ws-b');
    store.remove('ws-a', jira('DEMO-1'));
    store.move('ws-a', jira('DEMO-2'), 1);
    expect(rawRows('ws-b')).toEqual(before);
  });
});

// ─── Randomized sequence ────────────────────────────────────────────────────

// mulberry32: small, seeded and deterministic, so a failure reproduces.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('randomized sequence', () => {
  it.each([1, 7, 42, 2026])('keeps every workspace dense 1..N and matching a reference model (seed %i)', (s) => {
    const rand = rng(s);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const workspaces = ['ws-a', 'ws-b', 'ws-c'] as const;
    // A shared pool, so the same ticket regularly sits in several workspaces at once.
    const pool = Array.from({ length: 12 }, (_, i) => jira(`DEMO-${i + 1}`));
    const model: Record<string, string[]> = { 'ws-a': [], 'ws-b': [], 'ws-c': [] };
    const clamp = (p: number, max: number) => Math.min(p, max);

    for (let step = 0; step < 400; step++) {
      const ws = pick(workspaces);
      const order = model[ws];
      const absent = pool.filter((id) => !order.includes(id));
      const op = pick(['add', 'addAt', 'remove', 'move', 'up', 'down'] as const);
      // Positions deliberately run past the end to exercise the "last" rule.
      const pos = 1 + Math.floor(rand() * (order.length + 4));

      if ((op === 'add' || op === 'addAt') && absent.length > 0) {
        const id = pick(absent);
        if (op === 'add') {
          store.addIssue(ws, id);
          order.push(id);
        } else {
          store.addIssue(ws, id, pos);
          order.splice(clamp(pos, order.length + 1) - 1, 0, id);
        }
      } else if (order.length > 0) {
        const id = pick(order);
        const from = order.indexOf(id);
        if (op === 'remove') {
          store.remove(ws, id);
          order.splice(from, 1);
        } else if (op === 'move') {
          store.move(ws, id, pos);
          order.splice(from, 1);
          order.splice(clamp(pos, order.length + 1) - 1, 0, id);
        } else if (op === 'up') {
          store.moveUp(ws, id);
          if (from > 0) [order[from - 1], order[from]] = [order[from], order[from - 1]];
        } else if (op === 'down') {
          store.moveDown(ws, id);
          if (from < order.length - 1) [order[from + 1], order[from]] = [order[from], order[from + 1]];
        }
      }

      for (const w of workspaces) {
        expect(ids(store.list(w)), `step ${step}, ${w}`).toEqual(model[w]);
        expectDense(w);
      }
    }
    // The pool really was shared: some ticket ended up in more than one workspace.
    const memberships = pool.map((id) => workspaces.filter((w) => model[w].includes(id)).length);
    expect(Math.max(...memberships)).toBeGreaterThan(1);
  });
});

describe('appendImport (Markdown import Apply, VERM-104/105)', () => {
  const now = (ws: string) => store.list(ws).map((i) => ({ itemId: i.itemId, kind: i.kind, text: i.text, depth: i.depth }));

  it('fills empty Runways at positions 1..N in one go, with Runway # counting tickets only', () => {
    const result = store.appendImport([
      {
        workspaceId: 'ws-new',
        expected: [],
        rows: [
          { kind: 'note', text: 'Readers lose their place.', depth: 0 },
          { kind: 'issue', issueId: yt('READ-12') },
          { kind: 'section', text: 'Later', depth: 0 },
          { kind: 'issue', issueId: yt('READ-14') },
          { kind: 'note', text: '- Look at READ-9 again', depth: 1 },
        ],
      },
      { workspaceId: 'ws-other', expected: [], rows: [{ kind: 'issue', issueId: jira('OPS-1') }] },
    ]);
    expect(result['ws-new'].map((i) => [i.position, i.kind, i.runwayNumber, i.depth, i.text ?? i.itemId])).toEqual([
      [1, 'note', null, 0, 'Readers lose their place.'],
      [2, 'issue', 1, 0, yt('READ-12')],
      [3, 'section', null, 0, 'Later'],
      [4, 'issue', 2, 0, yt('READ-14')],
      [5, 'note', null, 1, '- Look at READ-9 again'],
    ]);
    expect(ids(store.list('ws-other'))).toEqual([jira('OPS-1')]);
  });

  it('appends after the last row of a Runway that has rows: every existing row and Runway # stays', () => {
    store.addIssue('ws-a', yt('READ-20'));
    store.addIssue('ws-a', yt('READ-12'));
    store.addNote('ws-a', 'Kept');
    const before = rawRows('ws-a');
    const result = store.appendImport([{ workspaceId: 'ws-a', expected: now('ws-a'), rows: [{ kind: 'issue', issueId: yt('PLAT-1') }, { kind: 'section', text: 'New', depth: 0 }] }]);
    expect(result['ws-a'].map((i) => [i.position, i.runwayNumber, i.text ?? i.itemId])).toEqual([
      [1, 1, yt('READ-20')],
      [2, 2, yt('READ-12')],
      [3, null, 'Kept'],
      [4, 3, yt('PLAT-1')],
      [5, null, 'New'],
    ]);
    expect(rawRows('ws-a').slice(0, 3)).toEqual(before);
  });

  it('writes nothing at all when any destination is not as expected, and names it', () => {
    store.addIssue('ws-busy', yt('READ-1'));
    const before = rawRows('ws-busy');
    let thrown: unknown;
    try {
      store.appendImport([
        { workspaceId: 'ws-empty', expected: [], rows: [{ kind: 'issue', issueId: yt('READ-2') }] },
        { workspaceId: 'ws-busy', expected: [], rows: [{ kind: 'issue', issueId: yt('READ-3') }] },
      ]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'runway-changed', workspaceIds: ['ws-busy'] });
    expect(store.list('ws-empty')).toEqual([]);
    expect(rawRows('ws-busy')).toEqual(before);
  });

  it('a note edited in place (same ID, new text) is a change: nothing is written', () => {
    const [note] = store.addNote('ws-a', 'Look at READ-9 again');
    const expected = now('ws-a');
    // No handler edits text today; the row keeps its ID and only its text changes.
    db.prepare('UPDATE runway_item SET text = ? WHERE item_id = ?').run('Look at READ-9 again, edited', note.itemId);
    expectStoreError(() => store.appendImport([{ workspaceId: 'ws-a', expected, rows: [{ kind: 'note', text: 'More', depth: 0 }] }]), 'runway-changed');
    expect(store.list('ws-a').map((i) => i.text)).toEqual(['Look at READ-9 again, edited']);
  });

  it('a ticket already on the Runway is never appended a second time', () => {
    store.addIssue('ws-a', yt('READ-1'));
    expectStoreError(() => store.appendImport([{ workspaceId: 'ws-a', expected: now('ws-a'), rows: [{ kind: 'issue', issueId: yt('READ-1') }] }]), 'already-on-runway');
  });

  it('refuses a bad row before writing anything', () => {
    expectStoreError(() => store.appendImport([{ workspaceId: 'ws-a', expected: [], rows: [{ kind: 'issue', issueId: 'READ-1' }] }]), 'invalid-issue-id');
    expectStoreError(() => store.appendImport([{ workspaceId: 'ws-a', expected: [], rows: [{ kind: 'note', text: '  ', depth: 0 }] }]), 'invalid-text');
    expectStoreError(() => store.appendImport([{ workspaceId: 'ws-a', expected: [], rows: [{ kind: 'section', text: 'S', depth: 5 }] }]), 'invalid-depth');
    expectStoreError(
      () => store.appendImport([{ workspaceId: 'ws-a', expected: [], rows: [{ kind: 'issue', issueId: yt('READ-1') }, { kind: 'issue', issueId: yt('READ-1') }] }]),
      'already-on-runway',
    );
    expectStoreError(() => store.appendImport([{ workspaceId: 'ws-a', expected: [], rows: [] }, { workspaceId: 'ws-a', expected: [], rows: [] }]), 'invalid-workspace');
    expect(store.list('ws-a')).toEqual([]);
  });
});
