import { describe, expect, it, vi } from 'vitest';
import type { RunwayItem } from '../../shared/runwayItem';
import { RUNWAY_ADD_MISSING_MESSAGE } from '../../shared/runwayAdd';
import type { BoardIssue } from '../../shared/workspace';
import { createRunwayAddByReference, type RunwayAddByReferenceDeps } from './runwayAddByReference';
import type { RunwayReaderResult } from './runwayTicketFetch';

// Synthetic keys, names and hosts only.
const JIRA_WS = 'ws-0f1e2d3c4b5a'; // a Jira workspace with no projects and no boards
const YT_WS = 'ws-a1b2c3d4e5f6';
const JIRA_SITE = 'https://site.example.test';
const YT_SERVER = 'https://yt.example.test';

function issue(idReadable: string): BoardIssue {
  return { id: `id-${idReadable}`, idReadable, summary: idReadable, resolved: null, fields: {} as BoardIssue['fields'], parentEpic: null, isEpic: false };
}

function onRunway(workspaceId: string, itemId: string): RunwayItem {
  return { workspaceId, itemId, kind: 'issue', position: 1, runwayNumber: 1, depth: 0, text: null, addedAt: '', updatedAt: '' };
}

type Answer = BoardIssue | { status?: number; name?: string; message: string } | 'hang';

function harness(opts: {
  active?: string | string[];
  answers?: Record<string, Answer>;
  items?: RunwayItem[];
  reader?: RunwayReaderResult;
  addCode?: 'not-active-workspace';
} = {}) {
  const actives = Array.isArray(opts.active) ? [...opts.active] : [opts.active ?? JIRA_WS];
  const workspaces = vi.fn(async () => ({
    activeId: actives.length > 1 ? (actives.shift() as string) : actives[0],
    workspaces: [{ id: JIRA_WS, backend: { kind: 'jira' as const } }, { id: YT_WS, backend: { kind: 'youtrack' as const } }],
  }));
  const one = vi.fn(async (key: string) => {
    const a = opts.answers?.[key];
    if (a === 'hang') return new Promise<BoardIssue>(() => {});
    if (a === undefined) throw { status: 404, message: 'Issue does not exist or you do not have permission to see it.' };
    if ('idReadable' in a) return a;
    throw a;
  });
  const reader = vi.fn(async (_workspaceId: string, _tracker: string) => opts.reader ?? ({ ok: true, reader: { batch: vi.fn(), one } } as RunwayReaderResult));
  const added = (issueId: string) => ({ ok: true as const, items: [onRunway(JIRA_WS, issueId)] });
  const addIssue = vi.fn(async (a: { workspaceId: string; issueId: string }) =>
    opts.addCode ? { ok: false as const, error: 'not active', code: opts.addCode } : added(a.issueId),
  );
  const addIssueAtNumber = vi.fn(async (a: { workspaceId: string; issueId: string; runwayNumber: number }) => added(a.issueId));
  const deps: RunwayAddByReferenceDeps = {
    workspaces,
    trackerBaseUrl: async (_ws, tracker) => (tracker === 'jira' ? JIRA_SITE : YT_SERVER),
    items: () => opts.items ?? [],
    reader,
    addIssue,
    addIssueAtNumber,
    timeoutMs: 20,
  };
  return { add: createRunwayAddByReference(deps), one, reader, addIssue, addIssueAtNumber, workspaces };
}

describe('Runway add by key or link', () => {
  it('the first add in a Jira workspace with no projects or boards: checks the exact key once, then adds it at the end', async () => {
    const h = harness({ answers: { 'OPS-7': issue('OPS-7') } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'ops-7' })).resolves.toEqual({
      ok: true,
      items: [onRunway(JIRA_WS, 'jira:OPS-7')],
      itemId: 'jira:OPS-7',
    });
    expect(h.reader.mock.calls).toEqual([[JIRA_WS, 'jira']]);
    expect(h.one.mock.calls).toEqual([['OPS-7']]);
    expect(h.addIssue.mock.calls).toEqual([[{ workspaceId: JIRA_WS, issueId: 'jira:OPS-7' }]]);
  });

  it('a link on the workspace site, at a chosen #N', async () => {
    const h = harness({ answers: { 'DEMO-101': issue('DEMO-101') } });
    const r = await h.add({ workspaceId: JIRA_WS, reference: `${JIRA_SITE}/browse/DEMO-101`, runwayNumber: 1 });
    expect(r).toMatchObject({ ok: true, itemId: 'jira:DEMO-101' });
    expect(h.addIssueAtNumber.mock.calls).toEqual([[{ workspaceId: JIRA_WS, issueId: 'jira:DEMO-101', runwayNumber: 1 }]]);
    expect(h.addIssue).not.toHaveBeenCalled();
  });

  it('a YouTrack workspace: key and link', async () => {
    const h = harness({ active: YT_WS, answers: { 'READ-12': issue('READ-12'), 'SYNC-3': issue('SYNC-3') } });
    await expect(h.add({ workspaceId: YT_WS, reference: 'READ-12' })).resolves.toMatchObject({ ok: true, itemId: 'yt:READ-12' });
    await expect(h.add({ workspaceId: YT_WS, reference: `${YT_SERVER}/issue/SYNC-3/conflict-free-merge` })).resolves.toMatchObject({
      ok: true,
      itemId: 'yt:SYNC-3',
    });
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
    expect(h.addIssue).not.toHaveBeenCalled();
  });

  it.each([
    ['another Jira site', 'https://other.example.test/browse/DEMO-102'],
    ['the other tracker', `${YT_SERVER}/issue/READ-12`],
  ])('a link to %s is refused before any request: no reader, no read', async (_label, url) => {
    const h = harness();
    const r = await h.add({ workspaceId: JIRA_WS, reference: url });
    expect(r).toMatchObject({ ok: false, code: 'foreign-host' });
    if (!r.ok) expect(r.error).toContain('site.example.test');
    expect(h.reader).not.toHaveBeenCalled();
    expect(h.one).not.toHaveBeenCalled();
    expect(h.addIssue).not.toHaveBeenCalled();
  });

  it('text that is neither a key nor a link is refused before any request', async () => {
    const h = harness();
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'rotate the on-call' })).resolves.toMatchObject({ ok: false, code: 'not-a-reference' });
    expect(h.reader).not.toHaveBeenCalled();
  });

  it('a ticket already on the Runway is refused with no request', async () => {
    const h = harness({ items: [onRunway(JIRA_WS, 'jira:OPS-7')] });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toMatchObject({ ok: false, code: 'already-on-runway' });
    expect(h.reader).not.toHaveBeenCalled();
  });

  it('switching workspace while the check is in flight cancels the add', async () => {
    // Active when the request arrives; another workspace by the time the check answers.
    const h = harness({ active: [JIRA_WS, YT_WS], answers: { 'OPS-7': issue('OPS-7') } });
    const r = await h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' });
    expect(r).toMatchObject({ ok: false, code: 'cancelled' });
    expect(h.one).toHaveBeenCalledTimes(1);
    expect(h.addIssue).not.toHaveBeenCalled();
  });

  it('a switch caught by the write gate itself is reported as cancelled too', async () => {
    const h = harness({ answers: { 'OPS-7': issue('OPS-7') }, addCode: 'not-active-workspace' });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toMatchObject({ ok: false, code: 'cancelled' });
  });

  it('a request for a workspace that is not active is refused before any request', async () => {
    const h = harness({ active: YT_WS });
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
    expect(h.addIssue).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 503, message: 'Service Unavailable' }],
    [{ status: 429, message: 'Too Many Requests' }],
    [{ name: 'TypeError', message: 'fetch failed' }],
  ])('a network or server failure %j is retryable', async (failure) => {
    const h = harness({ answers: { 'OPS-7': failure } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toMatchObject({ ok: false, code: 'refresh-failed', retryable: true });
    expect(h.addIssue).not.toHaveBeenCalled();
  });

  it('401 is unauthorized and not retryable; 403 is not readable', async () => {
    const h401 = harness({ answers: { 'OPS-7': { status: 401, message: 'Unauthorized' } } });
    const r401 = await h401.add({ workspaceId: JIRA_WS, reference: 'OPS-7' });
    expect(r401).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(r401).not.toHaveProperty('retryable');
    const h403 = harness({ answers: { 'OPS-7': { status: 403, message: 'No access' } } });
    await expect(h403.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toEqual({
      ok: false,
      code: 'not-readable',
      error: 'Ticket not readable with this workspace’s credential: No access',
    });
  });

  it("a credential that cannot be resolved stops the add: the reader is the workspace's own, with no other tried", async () => {
    const h = harness({ reader: { ok: false, code: 'credential', error: 'jira-1 did not resolve' } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'OPS-7' })).resolves.toEqual({ ok: false, code: 'credential', error: 'jira-1 did not resolve' });
    expect(h.reader).toHaveBeenCalledTimes(1);
    expect(h.addIssue).not.toHaveBeenCalled();
  });

  it('a moved Jira ticket is added under the key the tracker answered with, unless that key is already here', async () => {
    const h = harness({ answers: { 'DEMO-5': issue('PLAT-40') } });
    await expect(h.add({ workspaceId: JIRA_WS, reference: 'DEMO-5' })).resolves.toMatchObject({ ok: true, itemId: 'jira:PLAT-40' });
    const dup = harness({ answers: { 'DEMO-5': issue('PLAT-40') }, items: [onRunway(JIRA_WS, 'jira:PLAT-40')] });
    await expect(dup.add({ workspaceId: JIRA_WS, reference: 'DEMO-5' })).resolves.toMatchObject({ ok: false, code: 'already-on-runway' });
    expect(dup.addIssue).not.toHaveBeenCalled();
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
