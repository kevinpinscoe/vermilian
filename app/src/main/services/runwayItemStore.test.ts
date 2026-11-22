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
