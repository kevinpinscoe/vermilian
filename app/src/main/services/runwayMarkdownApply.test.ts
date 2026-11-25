import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunwayImportApplyGroup, RunwayImportMatchArgs, RunwayImportMatchResult } from '../../shared/runwayImport';
import { openRunwayDb } from './runwayDb';
import { createRunwayItemStore, type RunwayItemStore } from './runwayItemStore';
import { createRunwayMarkdownApply, validateApplyArgs, type ApplyWorkspace, type RunwayMarkdownApplyDeps } from './runwayMarkdownApply';
import type { VermilianConfig } from '../../shared/workspace';
import type { LegacyWorkspaceEditDeps } from './legacyWorkspaceEdit';
import { createLegacyApplyWorkspaces } from './runwayApplyWorkspaces';

// Synthetic keys, names and hosts only.
let dir: string;
let db: DatabaseSync;
let store: RunwayItemStore;

beforeEach(() => {
  connections = { 'ws-a': 'youtrack https://yt.example.test youtrack-1', 'ws-b': 'youtrack https://yt.example.test youtrack-1', 'ws-c': 'jira https://site-a.example.test jira-1' };
  dir = mkdtempSync(join(tmpdir(), 'vermilian-apply-'));
  db = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
  store = createRunwayItemStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const keyOf = (text: string) => /([A-Z][A-Z0-9_]*-\d+)$/.exec(text)?.[1] ?? text;

/** Each workspace's tracker connection, as the matcher and Apply see it now. */
let connections: Record<string, string>;

/** Every key reads as yt:<key>, except those listed as changed (they read as another ticket). */
function matcher(changed: Record<string, string> = {}) {
  const calls: RunwayImportMatchArgs['groups'] = [];
  const match = async (args: RunwayImportMatchArgs): Promise<RunwayImportMatchResult> => {
    calls.push(...args.groups);
    return {
      ok: true,
      groups: args.groups.map((g) => ({
        groupKey: g.groupKey,
        workspaceId: g.workspaceId,
        ok: true as const,
        connectionKey: connections[g.workspaceId],
        candidates: g.candidates.map((c) => {
          const key = changed[`${g.workspaceId} ${keyOf(c.text)}`] ?? keyOf(c.text);
          return key === 'GONE'
            ? { ...c, status: 'unmatched' as const, code: 'not-readable' as const, message: 'Not readable.' }
            : { ...c, status: 'matched' as const, ticket: { issueId: `yt:${key}`, key, summary: key } };
        }),
      })),
    };
  };
  return { match, calls };
}

interface Harness {
  deps: RunwayMarkdownApplyDeps;
  workspaces: ApplyWorkspace[];
  events: string[];
  removed: string[];
}

function harness(
  over: Partial<RunwayMarkdownApplyDeps> = {},
  opts: { failCreate?: string; failCreateAllocated?: string; failRemove?: string; onCreate?: () => void } = {},
): Harness {
  const workspaces: ApplyWorkspace[] = [
    { id: 'ws-a', name: 'Inbox' },
    { id: 'ws-b', name: 'Reader App' },
    { id: 'ws-c', name: 'Platform' },
  ];
  const events: string[] = [];
  const removed: string[] = [];
  let n = 0;
  const h: Harness = {
    workspaces,
    events,
    removed,
    deps: {
      workspaces: {
        list: async () => workspaces.map((w) => ({ ...w })),
        create: async (name, connectionWorkspaceId, expectedKey) => {
          events.push(`create ${name} from ${connectionWorkspaceId}`);
          if (connections[connectionWorkspaceId] !== expectedKey) return { ok: false, error: 'the connection changed' };
          if (name === opts.failCreate) return { ok: false, error: 'the tracker refused the article' };
          if (name === opts.failCreateAllocated) {
            // Partly written: the ID was allocated before the failure.
            const id = `ws-new-${++n}`;
            workspaces.push({ id, name });
            return { ok: false, error: 'the shared configuration refused the change', workspaceId: id, articleIds: [`art-${id}`] };
          }
          opts.onCreate?.();
          const id = `ws-new-${++n}`;
          workspaces.push({ id, name });
          return { ok: true, workspaceId: id, articleIds: [`art-${id}`] };
        },
        remove: async (id, articleIds) => {
          events.push(`remove ${id} [${articleIds.join(' ')}]`);
          if (id === opts.failRemove) return { ok: false, error: 'offline', articleIds };
          removed.push(id);
          const i = workspaces.findIndex((w) => w.id === id);
          if (i >= 0) workspaces.splice(i, 1);
          return { ok: true };
        },
      },
      match: matcher().match,
      connectionKey: async (id) => connections[id] ?? null,
      gate: { run: async (op) => op() },
      store: () => store,
      backup: async () => {
        events.push('backup');
        return join(dir, 'runway-before-import-1.sqlite');
      },
      ...over,
    },
  };
  return h;
}

const ticket = (key: string, line: number) => ({ kind: 'ticket' as const, issueId: `yt:${key}`, text: key, line });
const section = (text: string, line: number, depth = 0) => ({ kind: 'section' as const, text, depth, line });
const note = (text: string, line: number, depth = 0) => ({ kind: 'note' as const, text, depth, line });

const NEW_GROUP: RunwayImportApplyGroup = {
  groupKey: 'g0',
  target: { kind: 'new', name: 'Ship the offline reader', connectionWorkspaceId: 'ws-a' },
  connectionKey: 'youtrack https://yt.example.test youtrack-1',
  rows: [note('Readers lose their place on the train.', 3), ticket('READ-12', 5), ticket('SYNC-3', 6), section('Later', 11), note('- Look at READ-9 again', 13)],
};
const EXISTING_GROUP: RunwayImportApplyGroup = {
  groupKey: 'g1',
  target: { kind: 'existing', workspaceId: 'ws-b' },
  connectionKey: 'youtrack https://yt.example.test youtrack-1',
  rows: [ticket('READ-1', 16)],
};

const shape = (workspaceId: string) => store.list(workspaceId).map((i) => `${i.kind}${i.runwayNumber ? ` #${i.runwayNumber}` : ''} ${i.text ?? i.itemId}${i.depth ? ` @${i.depth}` : ''}`);

describe('runwayMarkdownApply', () => {
  it('backs up, creates the new workspace, and fills both Runways in order', async () => {
    const h = harness();
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP, EXISTING_GROUP] });
    expect(r).toMatchObject({
      ok: true,
      backupPath: join(dir, 'runway-before-import-1.sqlite'),
      workspaces: [
        { groupKey: 'g0', workspaceId: 'ws-new-1', name: 'Ship the offline reader', created: true, rows: 5 },
        { groupKey: 'g1', workspaceId: 'ws-b', name: 'Reader App', created: false, rows: 1 },
      ],
    });
    expect(h.events).toEqual(['backup', 'create Ship the offline reader from ws-a']);
    expect(shape('ws-new-1')).toEqual(['note Readers lose their place on the train.', 'issue #1 yt:READ-12', 'issue #2 yt:SYNC-3', 'section Later', 'note - Look at READ-9 again']);
    expect(shape('ws-b')).toEqual(['issue #1 yt:READ-1']);
  });

  it('reads every numbered ticket again on the group’s own connection: the new group’s chosen one, the existing destination’s own', async () => {
    const m = matcher();
    const h = harness({ match: m.match });
    await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP, EXISTING_GROUP] });
    expect(m.calls.map((c) => [c.groupKey, c.workspaceId, c.candidates.map((x) => x.text)])).toEqual([
      ['g0', 'ws-a', ['READ-12', 'SYNC-3']],
      ['g1', 'ws-b', ['READ-1']],
    ]);
  });

  it('a ticket that no longer reads as previewed sends the group back; nothing is backed up, created or written', async () => {
    const h = harness({ match: matcher({ 'ws-a SYNC-3': 'GONE' }).match });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP, EXISTING_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ groupKey: 'g0', reason: 'tickets-changed' }], backupPath: null });
    expect(h.events).toEqual([]);
    expect(store.list('ws-b')).toEqual([]);
  });

  it('a ticket now reading as a different ticket (a renderer-supplied ID it cannot prove) is refused', async () => {
    const h = harness({ match: matcher({ 'ws-a READ-12': 'READ-99' }).match });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ groupKey: 'g0', reason: 'tickets-changed' }] });
  });

  it('a missing connection or destination workspace sends the group back', async () => {
    const h = harness();
    const r = await createRunwayMarkdownApply(h.deps)({
      groups: [
        { ...NEW_GROUP, target: { kind: 'new', name: 'X', connectionWorkspaceId: 'ws-gone' } },
        { ...EXISTING_GROUP, target: { kind: 'existing', workspaceId: 'ws-gone' } },
      ],
    });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ reason: 'connection-missing' }, { reason: 'workspace-missing' }] });
    expect(h.events).toEqual([]);
  });

  it('a lookup that fails sends the group back as check-failed', async () => {
    const h = harness({ match: async () => ({ ok: false, code: 'workspace-unavailable', error: 'unreadable' }) });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ reason: 'check-failed' }] });
  });

  it('names are compared trimmed and case-folded, against existing workspaces and other new groups', async () => {
    const h = harness();
    const r = await createRunwayMarkdownApply(h.deps)({
      groups: [
        { ...NEW_GROUP, groupKey: 'g0', target: { kind: 'new', name: '  reader app ', connectionWorkspaceId: 'ws-a' } },
        { ...NEW_GROUP, groupKey: 'g1', target: { kind: 'new', name: 'Twin', connectionWorkspaceId: 'ws-a' } },
        { ...NEW_GROUP, groupKey: 'g2', target: { kind: 'new', name: 'TWIN ', connectionWorkspaceId: 'ws-a' } },
      ],
    });
    expect(r).toMatchObject({
      ok: false,
      code: 'review',
      problems: [
        { groupKey: 'g0', reason: 'name-taken' },
        { groupKey: 'g1', reason: 'name-taken' },
        { groupKey: 'g2', reason: 'name-taken' },
      ],
    });
    expect(h.events).toEqual([]);
  });

  it('two groups going to one existing workspace are both sent back, to merge or skip', async () => {
    const h = harness();
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [EXISTING_GROUP, { ...EXISTING_GROUP, groupKey: 'g2', rows: [ticket('READ-2', 20)] }] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ groupKey: 'g1', reason: 'same-destination' }, { groupKey: 'g2', reason: 'same-destination' }] });
    expect(r.ok ? '' : r.problems[0].message).toMatch(/Merge them, or skip one/);
  });

  it('an existing Runway filled after the preview: that edit is kept and the group goes back; nothing is created', async () => {
    store.addIssue('ws-b', 'yt:READ-77');
    const h = harness();
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP, EXISTING_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ groupKey: 'g1', reason: 'runway-not-empty' }] });
    expect(shape('ws-b')).toEqual(['issue #1 yt:READ-77']);
    expect(h.events).toEqual([]);
  });

  it('a destination filled at the transaction boundary: the edit is kept, nothing is written, and only this Apply’s workspace is removed', async () => {
    // Another edit lands while the new workspace is being created.
    const h = harness({}, { onCreate: () => store.addIssue('ws-b', 'yt:READ-77') });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP, EXISTING_GROUP] });
    expect(r).toMatchObject({
      ok: false,
      code: 'review',
      problems: [{ groupKey: 'g1', reason: 'runway-not-empty' }],
      backupPath: join(dir, 'runway-before-import-1.sqlite'),
      remaining: [],
    });
    expect(shape('ws-b')).toEqual(['issue #1 yt:READ-77']);
    expect(store.list('ws-new-1')).toEqual([]);
    expect(h.removed).toEqual(['ws-new-1']);
    expect(h.workspaces.map((w) => w.id)).toEqual(['ws-a', 'ws-b', 'ws-c']);
  });

  it('a workspace that cannot be created: the ones this Apply created are removed, and no rows are written', async () => {
    const h = harness({}, { failCreate: 'Second' });
    const r = await createRunwayMarkdownApply(h.deps)({
      groups: [NEW_GROUP, { ...NEW_GROUP, groupKey: 'g2', target: { kind: 'new', name: 'Second', connectionWorkspaceId: 'ws-a' }, rows: [ticket('READ-30', 30)] }],
    });
    expect(r).toMatchObject({ ok: false, code: 'create-failed', remaining: [], backupPath: join(dir, 'runway-before-import-1.sqlite') });
    expect(h.events).toEqual(['backup', 'create Ship the offline reader from ws-a', 'create Second from ws-a', 'remove ws-new-1 [art-ws-new-1]']);
    expect(store.list('ws-new-1')).toEqual([]);
  });

  it('an incomplete cleanup names what remains, with the backup', async () => {
    const h = harness({}, { failCreate: 'Second', failRemove: 'ws-new-1' });
    const r = await createRunwayMarkdownApply(h.deps)({
      groups: [NEW_GROUP, { ...NEW_GROUP, groupKey: 'g2', target: { kind: 'new', name: 'Second', connectionWorkspaceId: 'ws-a' }, rows: [] }],
    });
    expect(r).toMatchObject({ ok: false, code: 'create-failed', remaining: [{ workspaceId: 'ws-new-1', name: 'Ship the offline reader', articleIds: ['art-ws-new-1'] }], backupPath: join(dir, 'runway-before-import-1.sqlite') });
  });

  it('a creation that reached the tracker but could not be verified: cleanup is given its exact article, and reports it if the removal is not confirmed', async () => {
    const h = harness({}, { failCreateAllocated: 'Ship the offline reader', failRemove: 'ws-new-1' });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(h.events).toContain('remove ws-new-1 [art-ws-new-1]');
    expect(r).toMatchObject({ ok: false, code: 'create-failed', remaining: [{ workspaceId: 'ws-new-1', name: 'Ship the offline reader', articleIds: ['art-ws-new-1'] }] });
  });

  it('a failed row write rolls back and removes this Apply’s workspaces only', async () => {
    const h = harness({
      store: () => ({
        list: store.list,
        fillEmpty: () => {
          throw new Error('disk full');
        },
      }),
    });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP, EXISTING_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'write-failed', remaining: [] });
    expect(h.removed).toEqual(['ws-new-1']);
    expect(store.list('ws-b')).toEqual([]);
  });

  it('a failed backup changes nothing', async () => {
    const h = harness({
      backup: async () => {
        throw new Error('no space');
      },
    });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'backup-failed', backupPath: null, remaining: [] });
    expect(h.workspaces).toHaveLength(3);
  });

  it('everything after the ticket check happens inside the write gate', async () => {
    const order: string[] = [];
    const h = harness({
      gate: {
        run: async (op) => {
          order.push('gate in');
          const v = await op();
          order.push('gate out');
          return v;
        },
      },
      backup: async () => {
        order.push('backup');
        return 'b';
      },
    });
    await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(order).toEqual(['gate in', 'backup', 'gate out']);
  });
});

describe('the previewed connection (PR 232 review)', () => {
  const JIRA_GROUP: RunwayImportApplyGroup = {
    groupKey: 'g0',
    target: { kind: 'new', name: 'Ops', connectionWorkspaceId: 'ws-c' },
    connectionKey: 'jira https://site-a.example.test jira-1',
    rows: [ticket('OPS-7', 2)],
  };

  it('two Jira sites both resolve OPS-7: a switch of site after the preview sends the group back, though the stored ID is the same', async () => {
    connections['ws-c'] = 'jira https://site-b.example.test jira-1';
    const h = harness();
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [JIRA_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ groupKey: 'g0', reason: 'connection-changed' }] });
    expect(h.events).toEqual([]);
  });

  it('a switch of site while Apply waits at the write gate: nothing is backed up, created or written', async () => {
    const h = harness({
      gate: {
        run: async (op) => {
          connections['ws-c'] = 'jira https://site-b.example.test jira-1';
          return op();
        },
      },
    });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [JIRA_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ groupKey: 'g0', reason: 'connection-changed' }] });
    expect(h.events).toEqual([]);
  });

  it('a credential reference change counts too, for an existing destination', async () => {
    connections['ws-b'] = 'youtrack https://yt.example.test youtrack-2';
    const h = harness();
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [EXISTING_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ groupKey: 'g1', reason: 'connection-changed' }] });
  });

  it('a read that answers on another connection than the preview is refused', async () => {
    const m = matcher();
    const h = harness({
      match: async (args) => {
        const r = await m.match(args);
        return r.ok ? { ...r, groups: r.groups.map((g) => (g.ok ? { ...g, connectionKey: 'jira https://site-b.example.test jira-1' } : g)) } : r;
      },
    });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [JIRA_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'review', problems: [{ reason: 'connection-changed' }] });
  });

  it('creation is told the connection checked, and copies only that one', async () => {
    let seen = '';
    const h = harness();
    const create = h.deps.workspaces.create;
    h.deps.workspaces.create = async (name, conn, key) => {
      seen = key;
      return create(name, conn, key);
    };
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [JIRA_GROUP] });
    expect(r.ok).toBe(true);
    expect(seen).toBe('jira https://site-a.example.test jira-1');
  });

  it('a creation that fails after allocating its ID is still cleaned up', async () => {
    const h = harness({}, { failCreateAllocated: 'Ship the offline reader' });
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'create-failed', remaining: [] });
    expect(h.removed).toEqual(['ws-new-1']);
    expect(h.workspaces.map((w) => w.id)).toEqual(['ws-a', 'ws-b', 'ws-c']);
  });
});

describe('legacy Apply through the production adapter (VERM-104)', () => {
  /** The shared configuration in memory; the local write fails once; the shared update refuses from its second call while `refuse` says so. */
  function legacy(refuse: (call: number) => boolean) {
    let shared: VermilianConfig = {
      version: 1,
      activeWorkspaceId: 'ws-a',
      workspaces: [
        { id: 'ws-a', name: 'Inbox', order: 0, folders: [] },
        { id: 'ws-b', name: 'Reader App', order: 1, folders: [] },
      ],
    } as VermilianConfig;
    let updates = 0;
    let localWrites = 0;
    const edit: LegacyWorkspaceEditDeps = {
      read: async () => JSON.parse(JSON.stringify(shared)) as VermilianConfig,
      updateShared: (c) => {
        if (refuse(++updates)) return false;
        shared = c;
        return true;
      },
      writeLocal: async () => {
        if (++localWrites === 1) throw new Error('disk full');
      },
      scheduleShared: () => undefined,
      refusedMessage: 'Per-workspace storage is being activated.',
    };
    const h = harness();
    h.deps.workspaces = createLegacyApplyWorkspaces({ edit, connectionKey: h.deps.connectionKey, generateWorkspaceId: () => 'workspace-new-1' });
    return { h, shared: () => shared };
  }

  it('a failed local write whose rollback is refused: the workspace is cleaned up once the configuration accepts again', async () => {
    // Call 1 adds, call 2 (the rollback) is refused, call 3 (Apply's cleanup) is accepted.
    const { h, shared } = legacy((n) => n === 2);
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'create-failed', remaining: [], backupPath: join(dir, 'runway-before-import-1.sqlite') });
    expect(shared().workspaces.map((w) => w.id)).toEqual(['ws-a', 'ws-b']);
  });

  it('a failed local write whose rollback is refused, and the cleanup too: the workspace is reported by name and ID with the backup', async () => {
    const { h, shared } = legacy((n) => n >= 2);
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(r).toMatchObject({
      ok: false,
      code: 'create-failed',
      remaining: [{ workspaceId: 'workspace-new-1', name: 'Ship the offline reader', articleIds: [] }],
      backupPath: join(dir, 'runway-before-import-1.sqlite'),
    });
    expect(shared().workspaces.map((w) => w.id)).toEqual(['ws-a', 'ws-b', 'workspace-new-1']);
  });

  it('a refusal before anything was added reports no workspace', async () => {
    const { h, shared } = legacy(() => true);
    const r = await createRunwayMarkdownApply(h.deps)({ groups: [NEW_GROUP] });
    expect(r).toMatchObject({ ok: false, code: 'create-failed', remaining: [] });
    expect(h.events.filter((e) => e.startsWith('remove'))).toEqual([]);
    expect(shared().workspaces.map((w) => w.id)).toEqual(['ws-a', 'ws-b']);
  });
});

describe('validateApplyArgs', () => {
  it('accepts a well-formed plan and trims a new name', () => {
    const r = validateApplyArgs({ groups: [{ ...NEW_GROUP, target: { kind: 'new', name: '  Name ', connectionWorkspaceId: 'ws-a' } }] });
    expect(typeof r === 'string' ? r : r.groups[0].target).toEqual({ kind: 'new', name: 'Name', connectionWorkspaceId: 'ws-a' });
  });

  it.each([
    [{}, /missing/],
    [{ groups: [] }, /Nothing to apply/],
    [{ groups: [NEW_GROUP, NEW_GROUP] }, /once/],
    [{ groups: [{ ...NEW_GROUP, target: { kind: 'new', name: ' ', connectionWorkspaceId: 'ws-a' } }] }, /name/],
    [{ groups: [{ ...NEW_GROUP, target: { kind: 'other' } }] }, /existing workspace or a new workspace/],
    [{ groups: [{ ...NEW_GROUP, rows: [{ kind: 'note', text: 'x', depth: 5, line: 1 }] }] }, /depth/],
    [{ groups: [{ ...NEW_GROUP, rows: [{ kind: 'ticket', issueId: '', text: 'READ-1', line: 1 }] }] }, /ID/],
    [{ groups: [{ ...NEW_GROUP, rows: [{ kind: 'mystery', text: 'x', line: 1 }] }] }, /ticket, a section or a note/],
  ])('refuses %j', (args, message) => {
    expect(validateApplyArgs(args)).toMatch(message);
  });
});
