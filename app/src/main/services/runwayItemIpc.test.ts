import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunwayItemsResult } from '../../shared/ipc';
import { runwayTicketRefusal, runwayWorkspaceTracker, type RunwayItem } from '../../shared/runwayItem';
import { encodeIssueId } from '../../shared/tracker';
import { openRunwayDb } from './runwayDb';
import { RunwayWriteGate } from './runwayImport';
import { createRunwayItemHandlers, type RunwayItemHandlers, type RunwayWorkspaces } from './runwayItemIpc';
import { createRunwayItemStore, type RunwayItemStore } from './runwayItemStore';

// Synthetic keys and IDs only: this is a public repository.
const jira = (key: string) => encodeIssueId('jira', key);
const yt = (id: string) => encodeIssueId('youtrack', id);

// YouTrack workspace from legacy shared storage: no backend setting at all.
const YT_LEGACY = 'ws-yt-legacy';
// A workspace explicitly configured as Jira.
const JIRA_SHARED = 'ws-jira';
// A second YouTrack workspace, configured explicitly, never active.
const YT_OTHER = 'ws-yt-other';

let dir: string;
let db: DatabaseSync;
let store: RunwayItemStore;
let gate: RunwayWriteGate;
let gateRuns: number;
let storeCalls: number;
let config: RunwayWorkspaces;
let configError: Error | null;
let handlers: RunwayItemHandlers;
let tick: number;
/** The workspace-switch generation; switchTo() bumps it as writeStoredActiveWorkspaceId does. */
let generation: number;
/** Runs during every workspace-configuration read, when set. */
let onWorkspacesRead: (() => void) | null;

function switchTo(id: string): void {
  config.activeId = id;
  generation++;
}

beforeEach(() => {
  tick = 0;
  generation = 0;
  onWorkspacesRead = null;
  dir = mkdtempSync(join(tmpdir(), 'vermilian-runway-ipc-'));
  db = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
  store = createRunwayItemStore(db, () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000));
  gate = new RunwayWriteGate();
  gateRuns = 0;
  storeCalls = 0;
  configError = null;
  config = {
    activeId: YT_LEGACY,
    workspaces: [
      { id: YT_LEGACY },
      { id: JIRA_SHARED, backend: { kind: 'jira' } },
      { id: YT_OTHER, backend: { kind: 'youtrack' } },
    ],
  };
  handlers = createRunwayItemHandlers({
    store: () => {
      storeCalls++;
      return store;
    },
    gate: {
      run: (op) => {
        gateRuns++;
        return gate.run(op);
      },
    },
    workspaces: async () => {
      if (configError) throw configError;
      onWorkspacesRead?.();
      return config;
    },
    generation: () => generation,
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Every runway_item row, every workspace, straight from the table. */
function snapshot() {
  return db.prepare(`SELECT * FROM runway_item ORDER BY workspace_id, position`).all();
}

function items(result: RunwayItemsResult): RunwayItem[] {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
  return result.items;
}

const ids = (result: RunwayItemsResult) => items(result).map((i) => i.itemId);

function expectRefused(result: RunwayItemsResult, code: string): void {
  expect(result).toMatchObject({ ok: false, code });
}

describe('workspace tracker rules (shared)', () => {
  it('a workspace with no backend setting is YouTrack', () => {
    expect(runwayWorkspaceTracker({})).toBe('youtrack');
    expect(runwayWorkspaceTracker({ backend: null })).toBe('youtrack');
  });

  it('follows the configured backend', () => {
    expect(runwayWorkspaceTracker({ backend: { kind: 'jira' } })).toBe('jira');
    expect(runwayWorkspaceTracker({ backend: { kind: 'youtrack' } })).toBe('youtrack');
  });

  it('allows any project on the same tracker and refuses the other tracker', () => {
    expect(runwayTicketRefusal('youtrack', yt('2-45'))).toBeNull();
    expect(runwayTicketRefusal('youtrack', yt('7-1'))).toBeNull();
    expect(runwayTicketRefusal('jira', jira('OPS-956'))).toBeNull();
    expect(runwayTicketRefusal('jira', jira('PLAT-40'))).toBeNull();
    expect(runwayTicketRefusal('youtrack', jira('OPS-956'))).toBe('wrong-tracker');
    expect(runwayTicketRefusal('jira', yt('2-45'))).toBe('wrong-tracker');
    expect(runwayTicketRefusal('jira', 'OPS-956')).toBe('invalid-issue-id');
    expect(runwayTicketRefusal('jira', 42)).toBe('invalid-issue-id');
  });
});

describe('adding tickets', () => {
  it('allows a same-tracker ticket from another project', async () => {
    await handlers.addIssue({ workspaceId: YT_LEGACY, issueId: yt('2-45') });
    const result = await handlers.addIssue({ workspaceId: YT_LEGACY, issueId: yt('7-1') });
    expect(ids(result)).toEqual([yt('2-45'), yt('7-1')]);
    expect(items(result).map((i) => i.runwayNumber)).toEqual([1, 2]);
  });

  it('an explicitly configured Jira workspace takes Jira tickets from any project', async () => {
    config.activeId = JIRA_SHARED;
    await handlers.addIssue({ workspaceId: JIRA_SHARED, issueId: jira('OPS-956') });
    const result = await handlers.addIssueAtNumber({ workspaceId: JIRA_SHARED, issueId: jira('PLAT-40'), runwayNumber: 1 });
    expect(ids(result)).toEqual([jira('PLAT-40'), jira('OPS-956')]);
  });

  it('an explicitly configured Jira workspace refuses a YouTrack ticket before any write', async () => {
    config.activeId = JIRA_SHARED;
    await handlers.addIssue({ workspaceId: JIRA_SHARED, issueId: jira('OPS-956') });
    const before = snapshot();
    const [runs, calls] = [gateRuns, storeCalls];

    expectRefused(await handlers.addIssue({ workspaceId: JIRA_SHARED, issueId: yt('2-45') }), 'wrong-tracker');
    expectRefused(await handlers.addIssueAtNumber({ workspaceId: JIRA_SHARED, issueId: yt('2-45') }), 'wrong-tracker');

    expect(snapshot()).toEqual(before);
    expect(gateRuns).toBe(runs); // never queued
    expect(storeCalls).toBe(calls); // the store was never touched
  });

  it('a legacy workspace with no tracker setting refuses a Jira ticket before any write', async () => {
    await handlers.addIssue({ workspaceId: YT_LEGACY, issueId: yt('2-45') });
    const before = snapshot();
    const [runs, calls] = [gateRuns, storeCalls];

    const result = await handlers.addIssue({ workspaceId: YT_LEGACY, issueId: jira('OPS-956') });
    expectRefused(result, 'wrong-tracker');
    expect(result.ok ? '' : result.error).toContain('YouTrack tickets only');

    expect(snapshot()).toEqual(before);
    expect([gateRuns, storeCalls]).toEqual([runs, calls]);
  });

  it('refuses a malformed ticket ID before any write', async () => {
    const before = snapshot();
    expectRefused(await handlers.addIssue({ workspaceId: YT_LEGACY, issueId: 'DEMO-1' }), 'invalid-issue-id');
    expect(snapshot()).toEqual(before);
    expect(gateRuns).toBe(0);
  });
});

describe('workspace resolution', () => {
  it('refuses an unknown workspace for reads and writes, before any write', async () => {
    expectRefused(await handlers.list({ workspaceId: 'ws-nope' }), 'unknown-workspace');
    expectRefused(await handlers.addIssue({ workspaceId: 'ws-nope', issueId: yt('2-45') }), 'unknown-workspace');
    expectRefused(await handlers.addSection({ workspaceId: 'ws-nope', text: 'Later' }), 'unknown-workspace');
    expect(snapshot()).toEqual([]);
    expect([gateRuns, storeCalls]).toEqual([0, 0]);
  });

  it('refuses a write to a configured workspace that is not the active one', async () => {
    expectRefused(await handlers.addIssue({ workspaceId: YT_OTHER, issueId: yt('2-45') }), 'not-active-workspace');
    expectRefused(await handlers.addNote({ workspaceId: YT_OTHER, text: 'n' }), 'not-active-workspace');
    expect(snapshot()).toEqual([]);
    expect(gateRuns).toBe(0);
  });

  it('lists a configured workspace that is not the active one', async () => {
    store.addIssue(YT_OTHER, yt('3-3'));
    expect(ids(await handlers.list({ workspaceId: YT_OTHER }))).toEqual([yt('3-3')]);
  });

  it('refuses when the workspace configuration cannot be read', async () => {
    configError = new Error('YouTrack unreachable');
    const result = await handlers.addIssue({ workspaceId: YT_LEGACY, issueId: yt('2-45') });
    expectRefused(result, 'workspace-unavailable');
    expect(result.ok ? '' : result.error).toContain('YouTrack unreachable');
    expect(snapshot()).toEqual([]);
    expect(gateRuns).toBe(0);
  });

  it('refuses missing arguments and an empty workspace ID', async () => {
    expectRefused(await handlers.list(null as never), 'invalid-args');
    expectRefused(await handlers.addIssue(undefined as never), 'invalid-args');
    expectRefused(await handlers.addIssue({ workspaceId: '', issueId: yt('2-45') }), 'invalid-workspace');
    expect(gateRuns).toBe(0);
  });
});

describe('listing', () => {
  it('is read-only and does not use the write gate', async () => {
    store.addIssue(YT_LEGACY, yt('2-45'));
    store.addSection(YT_LEGACY, 'Later');
    const before = snapshot();
    const result = await handlers.list({ workspaceId: YT_LEGACY });
    expect(ids(result)).toHaveLength(2);
    expect(snapshot()).toEqual(before);
    expect(gateRuns).toBe(0);
  });
});

describe('writes', () => {
  it('every mutation goes through the write gate and returns the new order', async () => {
    const ws = YT_LEGACY;
    expect(ids(await handlers.addIssue({ workspaceId: ws, issueId: yt('2-1') }))).toEqual([yt('2-1')]);
    expect(ids(await handlers.addIssue({ workspaceId: ws, issueId: yt('2-2') }))).toEqual([yt('2-1'), yt('2-2')]);
    let result = await handlers.addIssueAtNumber({ workspaceId: ws, issueId: yt('2-3'), runwayNumber: 1 });
    expect(ids(result)).toEqual([yt('2-3'), yt('2-1'), yt('2-2')]);

    result = await handlers.addSection({ workspaceId: ws, text: 'Later', depth: 1, position: 2 });
    const section = items(result)[1];
    expect(section).toMatchObject({ kind: 'section', text: 'Later', depth: 1, runwayNumber: null });
    result = await handlers.addNote({ workspaceId: ws, text: 'after the freeze' });
    const note = items(result)[4];
    expect(note).toMatchObject({ kind: 'note', position: 5 });

    result = await handlers.move({ workspaceId: ws, itemId: note.itemId, position: 1 });
    expect(ids(result)[0]).toBe(note.itemId);
    result = await handlers.moveToNumber({ workspaceId: ws, itemId: yt('2-2'), runwayNumber: 1 });
    expect(items(result).find((i) => i.itemId === yt('2-2'))?.runwayNumber).toBe(1);
    result = await handlers.moveDown({ workspaceId: ws, itemId: note.itemId });
    expect(ids(result)[1]).toBe(note.itemId);
    result = await handlers.moveUp({ workspaceId: ws, itemId: note.itemId });
    expect(ids(result)[0]).toBe(note.itemId);
    result = await handlers.remove({ workspaceId: ws, itemId: section.itemId });
    expect(ids(result)).not.toContain(section.itemId);

    const positions = items(result).map((i) => i.position);
    expect(positions).toEqual(positions.map((_, i) => i + 1)); // dense 1..N
    expect(gateRuns).toBe(10);
  });

  it('a write the store refuses leaves the Runway untouched', async () => {
    const ws = YT_LEGACY;
    await handlers.addIssue({ workspaceId: ws, issueId: yt('2-1') });
    await handlers.addNote({ workspaceId: ws, text: 'n' });
    const noteId = ids(await handlers.list({ workspaceId: ws }))[1];
    const before = snapshot();

    expectRefused(await handlers.addIssue({ workspaceId: ws, issueId: yt('2-1') }), 'already-on-runway');
    expectRefused(await handlers.move({ workspaceId: ws, itemId: yt('2-1'), position: 0 }), 'invalid-position');
    expectRefused(await handlers.move({ workspaceId: ws, itemId: yt('2-1'), position: '2' as never }), 'invalid-position');
    expectRefused(await handlers.moveToNumber({ workspaceId: ws, itemId: noteId, runwayNumber: 1 }), 'not-a-ticket');
    expectRefused(await handlers.remove({ workspaceId: ws, itemId: yt('9-9') }), 'not-on-runway');
    expectRefused(await handlers.addSection({ workspaceId: ws, text: '   ' }), 'invalid-text');
    expectRefused(await handlers.addNote({ workspaceId: ws, text: 'x', depth: 5 }), 'invalid-depth');

    expect(snapshot()).toEqual(before);
  });

  it('a write blocked behind the gate leaves the Runway untouched until the gate frees', async () => {
    const ws = YT_LEGACY;
    await handlers.addIssue({ workspaceId: ws, issueId: yt('2-1') });
    const before = snapshot();

    // Something else (the snapshot import) holds the gate.
    let release!: () => void;
    const held = gate.run(() => new Promise<void>((resolve) => (release = resolve)));

    let settled = false;
    const pending = handlers.addIssue({ workspaceId: ws, issueId: yt('2-2') }).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(snapshot()).toEqual(before);

    release();
    await held;
    expect(ids(await pending)).toEqual([yt('2-1'), yt('2-2')]);
  });

  it('a write queued for A while the active workspace switches to B is refused, and both Runways keep their rows', async () => {
    const A = YT_LEGACY;
    const B = YT_OTHER;
    store.addIssue(A, yt('2-1'));
    store.addNote(A, 'a note');
    store.addIssue(B, yt('3-1'));
    const before = snapshot();
    const beforeA = ids(await handlers.list({ workspaceId: A }));
    const beforeB = ids(await handlers.list({ workspaceId: B }));

    // Something else (the snapshot import) holds the gate.
    let release!: () => void;
    const held = gate.run(() => new Promise<void>((resolve) => (release = resolve)));

    // A is active on arrival, so the early checks pass and the edit queues.
    const pending = Promise.all([
      handlers.addIssue({ workspaceId: A, issueId: yt('2-2') }),
      handlers.moveDown({ workspaceId: A, itemId: yt('2-1') }),
      handlers.remove({ workspaceId: A, itemId: yt('2-1') }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    config.activeId = B; // the user switches workspace while the edits wait
    release();
    await held;

    for (const result of await pending) expectRefused(result, 'not-active-workspace');
    expect(ids(await handlers.list({ workspaceId: A }))).toEqual(beforeA);
    expect(ids(await handlers.list({ workspaceId: B }))).toEqual(beforeB);
    expect(snapshot()).toEqual(before);
  });

  describe('Remove and every Move: the workspace-switch generation (VERM-87)', () => {
    const A = YT_LEGACY;
    const B = YT_OTHER;
    let noteId: string;

    beforeEach(() => {
      store.addIssue(A, yt('2-1'));
      noteId = store.addNote(A, 'a note').find((i) => i.kind === 'note')!.itemId;
      store.addIssue(A, yt('2-2'));
      store.addIssue(A, yt('2-3'));
      store.addIssue(B, yt('3-1'));
      store.addIssue(B, yt('3-2'));
    });

    /** Remove and all four Moves for A, queued in this order. */
    const edits = () => [
      handlers.moveDown({ workspaceId: A, itemId: yt('2-1') }),
      handlers.moveUp({ workspaceId: A, itemId: yt('2-3') }),
      handlers.moveToNumber({ workspaceId: A, itemId: yt('2-2'), runwayNumber: 1 }),
      handlers.move({ workspaceId: A, itemId: noteId, position: 4 }),
      handlers.remove({ workspaceId: A, itemId: yt('2-1') }),
    ];

    function holdGate() {
      let release!: () => void;
      const held = gate.run(() => new Promise<void>((resolve) => (release = resolve)));
      return { held, release: () => release() };
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('A → B → A while the edits wait behind a held gate cancels every one; both Runways keep their rows and order', async () => {
      const before = snapshot();
      const beforeA = ids(await handlers.list({ workspaceId: A }));
      const beforeB = ids(await handlers.list({ workspaceId: B }));
      expect(beforeA).toEqual([yt('2-1'), noteId, yt('2-2'), yt('2-3')]);

      const gateHeld = holdGate();
      // A is active on arrival: the early checks pass and every edit queues.
      const pending = Promise.all(edits());
      await settle();
      expect(snapshot()).toEqual(before);

      switchTo(B);
      switchTo(A); // back to A: the active ID alone would let the edits through
      gateHeld.release();
      await gateHeld.held;

      const results = await pending;
      expect(results).toHaveLength(5);
      for (const result of results) expectRefused(result, 'cancelled');
      expect(ids(await handlers.list({ workspaceId: A }))).toEqual(beforeA);
      expect(ids(await handlers.list({ workspaceId: B }))).toEqual(beforeB);
      expect(snapshot()).toEqual(before);
    });

    it('control: staying in A, the same queued edits all go through once the gate frees', async () => {
      const beforeB = ids(await handlers.list({ workspaceId: B }));
      const gateHeld = holdGate();
      const pending = Promise.all(edits());
      await settle();
      gateHeld.release();
      await gateHeld.held;

      const results = await pending;
      for (const result of results) expect(result.ok, JSON.stringify(result)).toBe(true);
      // moveDown 2-1, moveUp 2-3, 2-2 to #1, the note to row 4, remove 2-1 — in queue order.
      const after = items(await handlers.list({ workspaceId: A }));
      expect(after.map((i) => i.itemId)).toEqual([yt('2-2'), yt('2-3'), noteId]);
      expect(after.map((i) => i.position)).toEqual([1, 2, 3]);
      expect(after.map((i) => i.runwayNumber)).toEqual([1, 2, null]);
      expect(ids(await handlers.list({ workspaceId: B }))).toEqual(beforeB);
    });

    it('a round trip during the in-gate validation itself is caught: the check runs after the last await', async () => {
      const before = snapshot();
      const gateHeld = holdGate();
      const pending = handlers.moveDown({ workspaceId: A, itemId: yt('2-1') });
      await settle();
      // The next configuration read is the one inside the gate.
      onWorkspacesRead = () => {
        onWorkspacesRead = null;
        switchTo(B);
        switchTo(A);
      };
      gateHeld.release();
      await gateHeld.held;
      expectRefused(await pending, 'cancelled');
      expect(snapshot()).toEqual(before);
    });

    it('a switch before the request arrives does not cancel it', async () => {
      switchTo(B);
      switchTo(A);
      expect(ids(await handlers.moveDown({ workspaceId: A, itemId: yt('2-1') }))).toEqual([noteId, yt('2-1'), yt('2-2'), yt('2-3')]);
    });
  });

  it("a ticket addition queued before the workspace's tracker changes is refused as wrong-tracker", async () => {
    const before = snapshot();
    let release!: () => void;
    const held = gate.run(() => new Promise<void>((resolve) => (release = resolve)));

    const pending = handlers.addIssue({ workspaceId: YT_LEGACY, issueId: yt('2-1') });
    await new Promise((resolve) => setTimeout(resolve, 20));
    config.workspaces = config.workspaces.map((w) => (w.id === YT_LEGACY ? { ...w, backend: { kind: 'jira' } } : w));
    release();
    await held;

    expectRefused(await pending, 'wrong-tracker');
    expect(snapshot()).toEqual(before);
  });

  it('a workspace removed while a write is queued is refused as unknown-workspace', async () => {
    store.addIssue(YT_LEGACY, yt('2-1'));
    const before = snapshot();
    let release!: () => void;
    const held = gate.run(() => new Promise<void>((resolve) => (release = resolve)));

    const pending = handlers.remove({ workspaceId: YT_LEGACY, itemId: yt('2-1') });
    await new Promise((resolve) => setTimeout(resolve, 20));
    config.workspaces = config.workspaces.filter((w) => w.id !== YT_LEGACY);
    release();
    await held;

    expectRefused(await pending, 'unknown-workspace');
    expect(snapshot()).toEqual(before);
  });

  it('a failed write does not jam the gate for the next one', async () => {
    const ws = YT_LEGACY;
    expectRefused(await handlers.remove({ workspaceId: ws, itemId: yt('2-1') }), 'not-on-runway');
    expect(ids(await handlers.addIssue({ workspaceId: ws, issueId: yt('2-1') }))).toEqual([yt('2-1')]);
  });

  it('keeps each workspace separate: the same ticket in two workspaces', async () => {
    config.workspaces = [...config.workspaces, { id: 'ws-yt-two' }];
    await handlers.addIssue({ workspaceId: YT_LEGACY, issueId: yt('2-1') });
    await handlers.addIssue({ workspaceId: YT_LEGACY, issueId: yt('2-2') });
    config.activeId = 'ws-yt-two';
    await handlers.addIssue({ workspaceId: 'ws-yt-two', issueId: yt('2-2') });
    await handlers.addIssue({ workspaceId: 'ws-yt-two', issueId: yt('2-1') });
    expect(ids(await handlers.list({ workspaceId: YT_LEGACY }))).toEqual([yt('2-1'), yt('2-2')]);
    expect(ids(await handlers.list({ workspaceId: 'ws-yt-two' }))).toEqual([yt('2-2'), yt('2-1')]);
  });
});

describe('blocker actions: Add to Runway above a dependent, Move prerequisite above (VERM-98 review)', () => {
  const A = YT_LEGACY;
  const B = YT_OTHER;
  // A's Runway: READ-12 (2-12), SYNC-3 (2-103), READ-14 (2-14), SYNC-7 (2-107), READ-20 (2-20).
  const [r12, s3, r14, s7, r20] = ['2-12', '2-103', '2-14', '2-107', '2-20'].map((id) => yt(id));
  // PLAT-40, the external blocker, by entity ID and by readable key.
  const platId = yt('2-240');
  const platKey = yt('PLAT-40');
  const addPlat = () => handlers.addIssueAbove({ workspaceId: A, issueId: platId, aliases: [platId, platKey], dependentItemId: s7 });

  beforeEach(() => {
    for (const id of [r12, s3, r14, s7, r20]) store.addIssue(A, id);
    store.addIssue(B, yt('3-1'));
  });

  function holdGate() {
    let release!: () => void;
    const held = gate.run(() => new Promise<void>((resolve) => (release = resolve)));
    return { held, release: () => release() };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('adds the blocker immediately above its dependent; every existing row keeps its relative order', async () => {
    expect(ids(await addPlat())).toEqual([r12, s3, r14, platId, s7, r20]);
  });

  it('A → B → A while a queued add waits cancels it; both Runways are untouched', async () => {
    const before = snapshot();
    const gateHeld = holdGate();
    const pending = addPlat();
    await settle();
    switchTo(B);
    switchTo(A);
    gateHeld.release();
    await gateHeld.held;
    expectRefused(await pending, 'cancelled');
    expect(snapshot()).toEqual(before);
  });

  it('A → B → A while a queued Move prerequisite above waits cancels it', async () => {
    store.move(A, s3, 4); // SYNC-3 below READ-14
    const before = snapshot();
    const gateHeld = holdGate();
    const pending = handlers.moveAbove({ workspaceId: A, itemId: s3, dependentItemId: r14 });
    await settle();
    switchTo(B);
    switchTo(A);
    gateHeld.release();
    await gateHeld.held;
    expectRefused(await pending, 'cancelled');
    expect(snapshot()).toEqual(before);
  });

  it('refuses inside the gate a ticket already on the Runway under its readable key', async () => {
    const gateHeld = holdGate();
    const pending = addPlat();
    await settle();
    // While the add waits, the same ticket arrives by key (e.g. from the Add box).
    store.addIssue(A, platKey);
    const before = snapshot();
    gateHeld.release();
    await gateHeld.held;
    expectRefused(await pending, 'already-on-runway');
    expect(snapshot()).toEqual(before);
  });

  it('refuses inside the gate a ticket already on the Runway under its tracker ID', async () => {
    const gateHeld = holdGate();
    const pending = handlers.addIssueAbove({ workspaceId: A, issueId: platKey, aliases: [platKey, platId], dependentItemId: s7 });
    await settle();
    store.addIssue(A, platId);
    const before = snapshot();
    gateHeld.release();
    await gateHeld.held;
    expectRefused(await pending, 'already-on-runway');
    expect(snapshot()).toEqual(before);
  });

  it('two queued adds of the same ticket: the first goes in, the second is refused', async () => {
    const gateHeld = holdGate();
    const first = addPlat();
    const second = handlers.addIssueAbove({ workspaceId: A, issueId: platKey, aliases: [platKey, platId], dependentItemId: s7 });
    await settle();
    gateHeld.release();
    await gateHeld.held;
    expect((await first).ok).toBe(true);
    expectRefused(await second, 'already-on-runway');
    expect(ids(await handlers.list({ workspaceId: A }))).toEqual([r12, s3, r14, platId, s7, r20]);
  });

  it('the dependent moved while the add waited: the blocker still goes immediately above it', async () => {
    const gateHeld = holdGate();
    const pending = addPlat();
    await settle();
    store.move(A, s7, 1); // SYNC-7 moved to the top
    gateHeld.release();
    await gateHeld.held;
    expect(ids(await pending)).toEqual([platId, s7, r12, s3, r14, r20]);
  });

  it('the dependent was removed while the add waited: the Runway is untouched', async () => {
    const gateHeld = holdGate();
    const pending = addPlat();
    await settle();
    store.remove(A, s7);
    const before = snapshot();
    gateHeld.release();
    await gateHeld.held;
    expectRefused(await pending, 'dependent-not-on-runway');
    expect(snapshot()).toEqual(before);
  });

  it('moves the prerequisite immediately above its dependent; every other row keeps its relative order', async () => {
    store.move(A, s3, 5); // READ-12, READ-14, SYNC-7, READ-20, SYNC-3
    expect(ids(await handlers.moveAbove({ workspaceId: A, itemId: s3, dependentItemId: r14 }))).toEqual([r12, s3, r14, s7, r20]);
  });

  it('the dependent moved while the move waited: the prerequisite goes immediately above it where it is now', async () => {
    store.move(A, s3, 5);
    const gateHeld = holdGate();
    const pending = handlers.moveAbove({ workspaceId: A, itemId: s3, dependentItemId: r14 });
    await settle();
    store.move(A, r14, 4); // READ-12, SYNC-7, READ-20, READ-14, SYNC-3
    gateHeld.release();
    await gateHeld.held;
    expect(ids(await pending)).toEqual([r12, s7, r20, s3, r14]);
  });

  it('the dependent was removed while the move waited: the Runway is untouched', async () => {
    store.move(A, s3, 5);
    const gateHeld = holdGate();
    const pending = handlers.moveAbove({ workspaceId: A, itemId: s3, dependentItemId: r14 });
    await settle();
    store.remove(A, r14);
    const before = snapshot();
    gateHeld.release();
    await gateHeld.held;
    expectRefused(await pending, 'dependent-not-on-runway');
    expect(snapshot()).toEqual(before);
  });

  it('a prerequisite already immediately above its dependent stays put', async () => {
    const before = snapshot();
    expect(ids(await handlers.moveAbove({ workspaceId: A, itemId: s3, dependentItemId: r14 }))).toEqual([r12, s3, r14, s7, r20]);
    expect(snapshot()).toEqual(before);
  });

  it('a prerequisite above but not adjacent moves down to immediately above its dependent', async () => {
    store.move(A, s3, 1); // SYNC-3, READ-12, READ-14, SYNC-7, READ-20
    expect(ids(await handlers.moveAbove({ workspaceId: A, itemId: s3, dependentItemId: r14 }))).toEqual([r12, s3, r14, s7, r20]);
  });

  it('refuses the other tracker\'s ticket among the aliases before any write', async () => {
    const before = snapshot();
    expectRefused(await handlers.addIssueAbove({ workspaceId: A, issueId: platId, aliases: [platId, jira('PLAT-40')], dependentItemId: s7 }), 'wrong-tracker');
    expect(snapshot()).toEqual(before);
  });
});
