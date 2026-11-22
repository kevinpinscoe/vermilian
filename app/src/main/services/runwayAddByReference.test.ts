import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUNWAY_ADD_MISSING_MESSAGE } from '../../shared/runwayAdd';
import type { BoardIssue } from '../../shared/workspace';
import { openRunwayDb } from './runwayDb';
import { RunwayWriteGate } from './runwayImport';
import { createRunwayAddByReference } from './runwayAddByReference';
import { createRunwayItemHandlers, type RunwayWorkspaces } from './runwayItemIpc';
import { createRunwayItemStore, type RunwayItemStore } from './runwayItemStore';
import type { RunwayReaderResult } from './runwayTicketFetch';

// Synthetic keys, names and hosts only. The store, the write handlers and the
// write gate are the real ones, on a real database in a temporary directory:
// only the tracker is faked.
const JIRA_WS = 'ws-0f1e2d3c4b5a'; // a Jira workspace with no projects and no boards
const YT_WS = 'ws-a1b2c3d4e5f6';
const JIRA_SITE = 'https://site.example.test';
const YT_SERVER = 'https://yt.example.test';

function issue(idReadable: string, id = `id-${idReadable}`): BoardIssue {
  return { id, idReadable, summary: idReadable, resolved: null, fields: {} as BoardIssue['fields'], parentEpic: null, isEpic: false };
}

type Answer = BoardIssue | { status?: number; name?: string; message: string } | 'hang' | ((key: string) => Promise<BoardIssue>);

let dir: string;
let db: DatabaseSync;
let store: RunwayItemStore;
let gate: RunwayWriteGate;
let activeId: string;
let generation: number;

/** A switch, as main/services/activeWorkspace.ts records it: the ID, and one more generation. */
function switchTo(id: string) {
  activeId = id;
  generation += 1;
}

beforeEach(() => {
  let tick = 0;
  dir = mkdtempSync(join(tmpdir(), 'vermilian-runway-add-'));
  db = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
  store = createRunwayItemStore(db, () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000));
  gate = new RunwayWriteGate();
  activeId = JIRA_WS;
  generation = 0;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function harness(opts: { answers?: Record<string, Answer>; reader?: RunwayReaderResult } = {}) {
  const workspaces = async (): Promise<RunwayWorkspaces> => ({
    activeId,
    workspaces: [{ id: JIRA_WS, backend: { kind: 'jira' } }, { id: YT_WS, backend: { kind: 'youtrack' } }],
  });
  const one = vi.fn(async (key: string) => {
    const a = opts.answers?.[key];
    if (a === 'hang') return new Promise<BoardIssue>(() => {});
    if (typeof a === 'function') return a(key);
    if (a === undefined) throw { status: 404, message: 'Issue does not exist or you do not have permission to see it.' };
    if ('idReadable' in a) return a;
    throw a;
  });
  const reader = vi.fn(async (_workspaceId: string, _tracker: string) => opts.reader ?? ({ ok: true, reader: { batch: vi.fn(), one } } as RunwayReaderResult));
  const handlers = createRunwayItemHandlers({ store: () => store, gate, workspaces });
  const addIssueOnce = vi.fn(handlers.addIssueOnce);
  const add = createRunwayAddByReference({
    workspaces,
    trackerBaseUrl: async (_ws, tracker) => (tracker === 'jira' ? JIRA_SITE : YT_SERVER),
    items: (ws) => store.list(ws),
    reader,
    generation: () => generation,
    addIssueOnce,
    timeoutMs: 20,
  });
  return { add, one, reader, addIssueOnce };
}

/** Each workspace's rows as [itemId, Runway #]. */
const runway = (ws: string) => store.list(ws).map((i) => [i.itemId, i.runwayNumber]);

/** A promise and the function that settles it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('Runway add by key or link', () => {
  it('the first add in a Jira workspace with no projects or boards: checks the exact key once, then adds it at the end', async () => {
    const h = harness({ answers: { 'OPS-7': issue('OPS-7') } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'ops-7' })).resolves.toMatchObject({ ok: true, itemId: 'jira:OPS-7' });
    expect(h.reader.mock.calls).toEqual([[JIRA_WS, 'jira']]);
    expect(h.one.mock.calls).toEqual([['OPS-7']]);
    expect(runway(JIRA_WS)).toEqual([['jira:OPS-7', 1]]);
  });

  it('a link on the workspace site, at a chosen #N', async () => {
    store.addIssue(JIRA_WS, 'jira:OPS-7');
    const h = harness({ answers: { 'DEMO-101': issue('DEMO-101') } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: `${JIRA_SITE}/browse/DEMO-101`, runwayNumber: 1 })).resolves.toMatchObject({ ok: true });
    expect(runway(JIRA_WS)).toEqual([['jira:DEMO-101', 1], ['jira:OPS-7', 2]]);
  });

  it('a YouTrack workspace: a key, an issue link and a project-view link', async () => {
    switchTo(YT_WS);
    const h = harness({ answers: { 'READ-12': issue('READ-12', '2-12'), 'SYNC-3': issue('SYNC-3', '2-3'), 'READ-20': issue('READ-20', '2-20') } });
    await expect(h.add({ workspaceId: YT_WS, reference: 'READ-12' })).resolves.toMatchObject({ ok: true, itemId: 'yt:READ-12' });
    await expect(h.add({ workspaceId: YT_WS, reference: `${YT_SERVER}/issue/SYNC-3/conflict-free-merge` })).resolves.toMatchObject({ ok: true });
    await expect(h.add({ workspaceId: YT_WS, reference: `${YT_SERVER}/projects/READ/issues/READ-20` })).resolves.toMatchObject({ ok: true });
    expect(runway(YT_WS)).toEqual([['yt:READ-12', 1], ['yt:SYNC-3', 2], ['yt:READ-20', 3]]);
    expect(h.reader.mock.calls.every(([ws, tracker]) => ws === YT_WS && tracker === 'youtrack')).toBe(true);
  });

  it('a typo: 404 is refused with the agreed message, and nothing is added', async () => {
    const h = harness();
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'DEMO-9999' })).resolves.toEqual({
      ok: false,
      code: 'missing-or-unreadable',
      error: RUNWAY_ADD_MISSING_MESSAGE,
    });
    expect(RUNWAY_ADD_MISSING_MESSAGE).toBe('Ticket missing or not readable with this workspace’s credential.');
    expect(runway(JIRA_WS)).toEqual([]);
  });

  it.each([
    ['another Jira site', 'https://other.example.test/browse/DEMO-102'],
    ['the other tracker', `${YT_SERVER}/issue/READ-12`],
    ['the other tracker’s project view', `${YT_SERVER}/projects/READ/issues/READ-12`],
  ])('a link to %s is refused before any request: no reader, no read', async (_label, url) => {
    const h = harness();
    const r = await h.add({ workspaceId: JIRA_WS, reference: url });
    expect(r).toMatchObject({ ok: false, code: 'foreign-host' });
    if (!r.ok) expect(r.error).toContain('site.example.test');
    expect(h.reader).not.toHaveBeenCalled();
    expect(h.one).not.toHaveBeenCalled();
  });

  it('text that is neither a key nor a link is refused before any request', async () => {
    const h = harness();
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'rotate the on-call' })).resolves.toMatchObject({ ok: false, code: 'not-a-reference' });
    expect(h.reader).not.toHaveBeenCalled();
  });

  it('a ticket already on the Runway under the same key is refused with no request', async () => {
    store.addIssue(JIRA_WS, 'jira:OPS-7');
    const h = harness();
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toEqual({
      ok: false,
      code: 'already-on-runway',
      error: 'OPS-7 is already on this Runway as #1.',
    });
    expect(h.reader).not.toHaveBeenCalled();
    expect(runway(JIRA_WS)).toEqual([['jira:OPS-7', 1]]);
  });

  it('a request for a workspace that is not active is refused before any request', async () => {
    switchTo(YT_WS);
    const h = harness();
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toMatchObject({ ok: false, code: 'not-active-workspace' });
    expect(h.reader).not.toHaveBeenCalled();
  });

  it('a timeout is a retryable error, and nothing is added', async () => {
    const h = harness({ answers: { 'OPS-7': 'hang' } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toEqual({
      ok: false,
      code: 'refresh-failed',
      error: 'The tracker did not answer in time. The Runway is unchanged; try again.',
      retryable: true,
    });
    expect(runway(JIRA_WS)).toEqual([]);
  });

  it.each([
    [{ status: 503, message: 'Service Unavailable' }],
    [{ status: 429, message: 'Too Many Requests' }],
    [{ name: 'TypeError', message: 'fetch failed' }],
  ])('a network or server failure %j is retryable', async (failure) => {
    const h = harness({ answers: { 'OPS-7': failure } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toMatchObject({ ok: false, code: 'refresh-failed', retryable: true });
    expect(runway(JIRA_WS)).toEqual([]);
  });

  it('401 is unauthorized and not retryable; 403 is not readable', async () => {
    const r401 = await harness({ answers: { 'OPS-7': { status: 401, message: 'Unauthorized' } } }).add({ workspaceId: JIRA_WS, reference: 'OPS-7' });
    expect(r401).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(r401).not.toHaveProperty('retryable');
    await expect(harness({ answers: { 'OPS-7': { status: 403, message: 'No access' } } }).add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toEqual({
      ok: false,
      code: 'not-readable',
      error: 'Ticket not readable with this workspace’s credential: No access',
    });
  });

  it("a credential that cannot be resolved stops the add: the reader is the workspace's own, with no other tried", async () => {
    const h = harness({ reader: { ok: false, code: 'credential', error: 'jira-1 did not resolve' } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toEqual({ ok: false, code: 'credential', error: 'jira-1 did not resolve' });
    expect(h.reader).toHaveBeenCalledTimes(1);
    expect(h.addIssueOnce).not.toHaveBeenCalled();
  });

  it('a moved Jira ticket is added under the key the tracker answered with', async () => {
    const h = harness({ answers: { 'DEMO-5': issue('PLAT-40', '10040') } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'DEMO-5' })).resolves.toMatchObject({ ok: true, itemId: 'jira:PLAT-40' });
    expect(runway(JIRA_WS)).toEqual([['jira:PLAT-40', 1]]);
  });

  it.each([
    [undefined, 'invalid-args'],
    [{ reference: 'OPS-7' }, 'invalid-workspace'],
    [{ workspaceId: JIRA_WS }, 'invalid-args'],
    [{ workspaceId: JIRA_WS, reference: 'OPS-7', runwayNumber: 0 }, 'invalid-position'],
    [{ workspaceId: 'ws-000000000000', reference: 'OPS-7' }, 'unknown-workspace'],
  ])('refuses %j', async (args, code) => {
    const h = harness();
    await expect(h.add(args)).resolves.toMatchObject({ ok: false, code });
    expect(h.reader).not.toHaveBeenCalled();
  });
});

describe('duplicates are found by every ID the ticket goes by, inside the gated write (PR 197 review)', () => {
  it('a YouTrack row stored under the entity ID refuses the same ticket by key, and keeps its number', async () => {
    switchTo(YT_WS);
    store.addIssue(YT_WS, 'yt:SYNC-3');
    store.addIssue(YT_WS, 'yt:2-45'); // READ-12, stored under its entity ID, at #2
    store.addIssue(YT_WS, 'yt:SYNC-7');
    const before = runway(YT_WS);
    const h = harness({ answers: { 'READ-12': issue('READ-12', '2-45') } });

    const r = await h.add({ workspaceId: YT_WS, reference: 'READ-12', runwayNumber: 1 });
    expect(r).toEqual({ ok: false, code: 'already-on-runway', error: 'READ-12 is already on this Runway as #2.' });
    expect(h.one).toHaveBeenCalledTimes(1);
    expect(runway(YT_WS)).toEqual(before);
    expect(runway(YT_WS)).toEqual([['yt:SYNC-3', 1], ['yt:2-45', 2], ['yt:SYNC-7', 3]]);
  });

  it('the same for a project-view link to that ticket', async () => {
    switchTo(YT_WS);
    store.addIssue(YT_WS, 'yt:2-45');
    const h = harness({ answers: { 'READ-12': issue('READ-12', '2-45') } });
    await expect(h.add({ workspaceId: YT_WS, reference: `${YT_SERVER}/projects/READ/issues/READ-12` })).resolves.toMatchObject({
      ok: false,
      code: 'already-on-runway',
    });
    expect(runway(YT_WS)).toEqual([['yt:2-45', 1]]);
  });

  it('a moved Jira ticket whose new key is already here is refused, and that row keeps its number', async () => {
    store.addIssue(JIRA_WS, 'jira:OPS-7');
    store.addIssue(JIRA_WS, 'jira:PLAT-40');
    const h = harness({ answers: { 'DEMO-5': issue('PLAT-40', '10040') } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'DEMO-5', runwayNumber: 1 })).resolves.toEqual({
      ok: false,
      code: 'already-on-runway',
      error: 'PLAT-40 is already on this Runway as #2.',
    });
    expect(runway(JIRA_WS)).toEqual([['jira:OPS-7', 1], ['jira:PLAT-40', 2]]);
  });

  it('two adds of one ticket by different IDs race: the gate lets one in, the second is refused, and the first keeps its number', async () => {
    switchTo(YT_WS);
    store.addIssue(YT_WS, 'yt:SYNC-3');
    // Both checks answer only once both are in flight, so neither sees the other's row before the gate.
    const both = deferred<void>();
    let started = 0;
    const answer = async () => {
      started += 1;
      if (started === 2) both.resolve();
      await both.promise;
      return issue('READ-12', '2-45');
    };
    const h = harness({ answers: { 'READ-12': answer } });
    const [first, second] = await Promise.all([
      h.add({ workspaceId: YT_WS, reference: 'READ-12' }),
      h.add({ workspaceId: YT_WS, reference: `${YT_SERVER}/projects/READ/issues/READ-12`, runwayNumber: 1 }),
    ]);
    expect(first).toMatchObject({ ok: true, itemId: 'yt:READ-12' });
    expect(second).toEqual({ ok: false, code: 'already-on-runway', error: 'READ-12 is already on this Runway as #2.' });
    expect(runway(YT_WS)).toEqual([['yt:SYNC-3', 1], ['yt:READ-12', 2]]);
  });
});

describe('a workspace switch cancels an outstanding add, by generation (PR 197 review)', () => {
  beforeEach(() => {
    store.addIssue(JIRA_WS, 'jira:OPS-7');
    store.addIssue(YT_WS, 'yt:SYNC-3');
  });

  it('A → B while the check is in flight', async () => {
    const before = { a: runway(JIRA_WS), b: runway(YT_WS) };
    const answer = async () => {
      switchTo(YT_WS);
      return issue('DEMO-101');
    };
    const h = harness({ answers: { 'DEMO-101': answer } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'DEMO-101' })).resolves.toMatchObject({ ok: false, code: 'cancelled' });
    expect(h.addIssueOnce).not.toHaveBeenCalled();
    expect({ a: runway(JIRA_WS), b: runway(YT_WS) }).toEqual(before);
  });

  it('A → B → A while the check is in flight: back on A, the add is still cancelled', async () => {
    const before = { a: runway(JIRA_WS), b: runway(YT_WS) };
    const answer = async () => {
      switchTo(YT_WS);
      switchTo(JIRA_WS); // the same workspace is active again
      return issue('DEMO-101');
    };
    const h = harness({ answers: { 'DEMO-101': answer } });
    const r = await h.add({ workspaceId: JIRA_WS, reference: 'DEMO-101' });
    expect(activeId).toBe(JIRA_WS);
    expect(r).toEqual({
      ok: false,
      code: 'cancelled',
      error: 'The add was cancelled because the active workspace was switched while the ticket was being checked.',
    });
    expect(h.addIssueOnce).not.toHaveBeenCalled();
    expect({ a: runway(JIRA_WS), b: runway(YT_WS) }).toEqual(before);
  });

  it('A → B → A while the add waits for the gate: cancelled inside the gate, before the write', async () => {
    const before = { a: runway(JIRA_WS), b: runway(YT_WS) };
    // Something else holds the gate (an import, another write).
    const hold = deferred<void>();
    const held = gate.run(() => hold.promise);
    const h = harness({ answers: { 'DEMO-101': issue('DEMO-101') } });

    const pending = h.add({ workspaceId: JIRA_WS, reference: 'DEMO-101' });
    // The check has passed and the add is queued behind the held gate.
    await vi.waitFor(() => expect(h.addIssueOnce).toHaveBeenCalledTimes(1));
    switchTo(YT_WS);
    switchTo(JIRA_WS);
    hold.resolve();
    await held;

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'cancelled' });
    expect({ a: runway(JIRA_WS), b: runway(YT_WS) }).toEqual(before);
  });

  it('with no switch, the same queued add goes through once the gate frees', async () => {
    const hold = deferred<void>();
    const held = gate.run(() => hold.promise);
    const h = harness({ answers: { 'DEMO-101': issue('DEMO-101') } });
    const pending = h.add({ workspaceId: JIRA_WS, reference: 'DEMO-101' });
    await vi.waitFor(() => expect(h.addIssueOnce).toHaveBeenCalledTimes(1));
    hold.resolve();
    await held;
    await expect(pending).resolves.toMatchObject({ ok: true, itemId: 'jira:DEMO-101' });
    expect(runway(JIRA_WS)).toEqual([['jira:OPS-7', 1], ['jira:DEMO-101', 2]]);
    expect(runway(YT_WS)).toEqual([['yt:SYNC-3', 1]]);
  });
});
