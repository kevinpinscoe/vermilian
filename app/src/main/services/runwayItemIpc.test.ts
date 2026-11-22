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
// Jira workspace explicitly configured as Jira while storage is still shared.
const JIRA_SHARED = 'ws-jira-shared';
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

beforeEach(() => {
  tick = 0;
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
      return config;
    },
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

  it('a Jira workspace configured explicitly on shared storage takes Jira tickets from any project', async () => {
    config.activeId = JIRA_SHARED;
    await handlers.addIssue({ workspaceId: JIRA_SHARED, issueId: jira('OPS-956') });
    const result = await handlers.addIssueAtNumber({ workspaceId: JIRA_SHARED, issueId: jira('PLAT-40'), runwayNumber: 1 });
    expect(ids(result)).toEqual([jira('PLAT-40'), jira('OPS-956')]);
  });

  it('a Jira workspace configured explicitly on shared storage refuses a YouTrack ticket before any write', async () => {
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
