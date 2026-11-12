import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeIssueId, type NamespacedIssueId } from '../../shared/tracker';
import { openRunwayDb } from './runwayDb';
import {
  RunwayStoreError,
  createJiraRunwayStore,
  createYouTrackRunwayStore,
  storeForIssue,
  type RunwayMetadataStore,
  type YouTrackFocusFields,
} from './runwayStore';

const jira = (key: string) => encodeIssueId('jira', key);
const yt = (id: string) => encodeIssueId('youtrack', id);

async function expectStoreError(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(RunwayStoreError);
  await expect(p).rejects.toMatchObject({ code });
}

// ─── YouTrack ──────────────────────────────────────────────────────────────

function fakeYouTrack(initial: Record<string, YouTrackFocusFields>) {
  const issues: Record<string, YouTrackFocusFields> = structuredClone(initial);
  const writes: Array<{ issueId: string; field: string; value: string | number | null }> = [];
  let failOnWrite = -1;
  const store = createYouTrackRunwayStore({
    async readFields(issueId) {
      if (!issues[issueId]) throw new Error(`no issue ${issueId}`);
      return { ...issues[issueId] };
    },
    async patch(issueId, field, value) {
      if (writes.length === failOnWrite) throw new Error('network down');
      writes.push({ issueId, field, value });
      (issues[issueId] as Record<string, unknown>)[field] = value;
    },
  });
  return { store, issues, writes, failAt: (n: number) => (failOnWrite = n) };
}

describe('YouTrack Runway store: existing custom fields, unchanged', () => {
  it('reads Focus, Focus rank and Why now from the issue fields', async () => {
    const { store } = fakeYouTrack({ '2-1': { focus: 'Yes', focusRank: 2, whyNow: 'Due Friday' } });
    await expect(store.get('ws-a', yt('2-1'))).resolves.toEqual({
      issueId: 'yt:2-1',
      focus: true,
      focusRank: 2,
      whyNow: 'Due Friday',
    });
  });

  it('reads unset fields as the empty state', async () => {
    const { store } = fakeYouTrack({ '2-1': { focus: null, focusRank: null, whyNow: null } });
    await expect(store.get('ws-a', yt('2-1'))).resolves.toMatchObject({ focus: false, focusRank: null, whyNow: null });
  });

  it('writes the existing focus / focusRank / whyNow fields with their existing values', async () => {
    const { store, writes, issues } = fakeYouTrack({ '2-1': { focus: null, focusRank: null, whyNow: null } });
    const entry = await store.update('ws-a', yt('2-1'), { focusRank: 1, whyNow: 'Blocks release' });
    expect(entry).toEqual({ issueId: 'yt:2-1', focus: true, focusRank: 1, whyNow: 'Blocks release' });
    expect(writes).toEqual([
      { issueId: '2-1', field: 'focus', value: 'Yes' },
      { issueId: '2-1', field: 'focusRank', value: 1 },
      { issueId: '2-1', field: 'whyNow', value: 'Blocks release' },
    ]);
    expect(issues['2-1']).toEqual({ focus: 'Yes', focusRank: 1, whyNow: 'Blocks release' });
  });

  it('clears the rank before Focus, keeps Why now, and stops on a failed write', async () => {
    const { store, writes, issues, failAt } = fakeYouTrack({ '2-1': { focus: 'Yes', focusRank: 3, whyNow: 'w' } });
    failAt(1); // the second write (Focus off) fails
    await expect(store.update('ws-a', yt('2-1'), { focus: false })).rejects.toThrow('network down');
    expect(writes).toEqual([{ issueId: '2-1', field: 'focusRank', value: null }]);
    // Left focused-but-unranked: never a rank without Focus.
    expect(issues['2-1']).toEqual({ focus: 'Yes', focusRank: null, whyNow: 'w' });
  });

  it('writes nothing for a no-op patch', async () => {
    const { store, writes } = fakeYouTrack({ '2-1': { focus: 'Yes', focusRank: 1, whyNow: null } });
    await store.update('ws-a', yt('2-1'), { focus: true });
    expect(writes).toEqual([]);
  });

  it('works with readable IDs too', async () => {
    const { store, writes } = fakeYouTrack({ 'DEMO-7': { focus: null, focusRank: null, whyNow: null } });
    await store.update('ws-a', yt('DEMO-7'), { focus: true });
    expect(writes).toEqual([{ issueId: 'DEMO-7', field: 'focus', value: 'Yes' }]);
  });

  it('refuses a Jira issue and an invalid patch without writing', async () => {
    const { store, writes } = fakeYouTrack({ '2-1': { focus: null, focusRank: null, whyNow: null } });
    await expectStoreError(store.get('ws-a', jira('DEMO-1')), 'wrong-provider');
    await expectStoreError(store.update('ws-a', yt('2-1'), { focus: false, focusRank: 1 }), 'invalid-patch');
    expect(writes).toEqual([]);
  });
});

// ─── Jira (SQLite) ─────────────────────────────────────────────────────────

describe('Jira Runway store: local SQLite', () => {
  let dir: string;
  let db: DatabaseSync;
  let store: RunwayMetadataStore;
  const clock = () => new Date('2026-01-05T09:00:00.000Z');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vermilian-runway-store-'));
    db = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
    store = createJiraRunwayStore(db, clock);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const rowCount = () => (db.prepare('SELECT count(*) AS n FROM runway_entry').get() as { n: number }).n;

  it('returns the empty state for an issue with no entry', async () => {
    await expect(store.get('ws-a', jira('DEMO-1'))).resolves.toEqual({
      issueId: 'jira:DEMO-1',
      focus: false,
      focusRank: null,
      whyNow: null,
    });
    expect(rowCount()).toBe(0);
  });

  it('round-trips an entry through SQLite', async () => {
    await store.update('ws-a', jira('DEMO-1'), { focusRank: 1, whyNow: 'Due Friday' });
    await expect(store.get('ws-a', jira('DEMO-1'))).resolves.toEqual({
      issueId: 'jira:DEMO-1',
      focus: true,
      focusRank: 1,
      whyNow: 'Due Friday',
    });
    const row = db.prepare('SELECT * FROM runway_entry').get();
    expect(row).toMatchObject({ workspace_id: 'ws-a', issue_id: 'jira:DEMO-1', updated_at: '2026-01-05T09:00:00.000Z' });
  });

  it('keeps workspaces apart for the same Jira key', async () => {
    await store.update('ws-a', jira('DEMO-1'), { focusRank: 1 });
    await store.update('ws-b', jira('DEMO-1'), { whyNow: 'Other workspace' });
    await expect(store.get('ws-a', jira('DEMO-1'))).resolves.toMatchObject({ focusRank: 1, whyNow: null });
    await expect(store.get('ws-b', jira('DEMO-1'))).resolves.toMatchObject({ focus: false, whyNow: 'Other workspace' });
  });

  it('refuses a rank another issue holds, leaving both unchanged', async () => {
    await store.update('ws-a', jira('DEMO-1'), { focusRank: 1 });
    await store.update('ws-a', jira('DEMO-2'), { whyNow: 'kept' });
    await expectStoreError(store.update('ws-a', jira('DEMO-2'), { focusRank: 1 }), 'rank-taken');
    await expect(store.get('ws-a', jira('DEMO-1'))).resolves.toMatchObject({ focusRank: 1 });
    await expect(store.get('ws-a', jira('DEMO-2'))).resolves.toMatchObject({ focus: false, focusRank: null, whyNow: 'kept' });
    // The transaction was rolled back: the store still accepts writes.
    await store.update('ws-a', jira('DEMO-2'), { focusRank: 2 });
    await expect(store.get('ws-a', jira('DEMO-2'))).resolves.toMatchObject({ focusRank: 2 });
  });

  it('applies the ADR-0007 rules: clearing Focus clears the rank, keeps Why now', async () => {
    await store.update('ws-a', jira('DEMO-1'), { focusRank: 3, whyNow: 'w' });
    await expect(store.update('ws-a', jira('DEMO-1'), { focus: false })).resolves.toMatchObject({
      focus: false,
      focusRank: null,
      whyNow: 'w',
    });
  });

  it('removes an entry once nothing is left to remember', async () => {
    await store.update('ws-a', jira('DEMO-1'), { focus: true });
    expect(rowCount()).toBe(1);
    await store.update('ws-a', jira('DEMO-1'), { focus: false });
    expect(rowCount()).toBe(0);
  });

  it('keeps a deferred entry even when Focus, rank and Why now are cleared', async () => {
    await store.update('ws-a', jira('DEMO-1'), { focus: true });
    db.prepare(`UPDATE runway_entry SET deferred = 1`).run();
    await store.update('ws-a', jira('DEMO-1'), { focus: false });
    expect(db.prepare('SELECT focus, deferred FROM runway_entry').get()).toEqual({ focus: 0, deferred: 1 });
  });

  it('refuses a YouTrack issue and an invalid patch', async () => {
    await expectStoreError(store.get('ws-a', yt('2-1')), 'wrong-provider');
    await expectStoreError(store.update('ws-a', jira('DEMO-1'), { focus: false, focusRank: 2 }), 'invalid-patch');
    expect(rowCount()).toBe(0);
  });
});

// ─── Routing ───────────────────────────────────────────────────────────────

describe('storeForIssue', () => {
  const stores = {
    youtrack: { kind: 'youtrack' } as RunwayMetadataStore,
    jira: { kind: 'jira' } as RunwayMetadataStore,
  };

  it('routes by provider prefix', () => {
    expect(storeForIssue(stores, 'yt:2-1').kind).toBe('youtrack');
    expect(storeForIssue(stores, 'jira:DEMO-1').kind).toBe('jira');
  });

  it('refuses bare and malformed IDs', () => {
    expect(() => storeForIssue(stores, 'DEMO-1')).toThrow(/Malformed/);
    expect(() => storeForIssue(stores, 'jira:demo-1' as NamespacedIssueId)).toThrow(/Malformed/);
  });
});
