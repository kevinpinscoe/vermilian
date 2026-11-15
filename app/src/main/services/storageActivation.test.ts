import { beforeEach, describe, expect, it } from 'vitest';
import { defaultBoardConfig, dismissalKey } from '../../shared/boardConfig';
import { WORKSPACE_ARTICLE_PREFIX, workspaceArticleTitle } from '../../shared/workspaceArticle';
import { CONFIG_ARTICLE_TITLE, JIRA_PROFILE_ARTICLE_TITLE } from '../../shared/workspaceMigration';
import { parseWorkspaceDocument, serialiseUpdatedWorkspaceDocument, type WorkspaceDocument } from '../../shared/workspaceSchema';
import {
  LEGACY_LOCAL_STATE,
  STORAGE_MARKER_TITLE,
  parseLocalStorageState,
  parseStorageMarker,
  storageWriteGuard,
  type LocalStorageState,
} from '../../shared/storageActivation';
import type { WorkspaceCredentialCheck } from '../../shared/ipc';
import type { WorkspaceArticleRecord } from './workspaceArticles';
import {
  activateWorkspaceStorage,
  authorizeConfigWrite,
  parseActivationBackup,
  readMarker,
  returnToLegacyStorage,
  storageStatus,
  type ActivationDeps,
  type StorageActivationClient,
} from './storageActivation';

// ─── One YouTrack, shared by every simulated machine ─────────────────────────

class FakeYouTrack implements StorageActivationClient {
  articles = new Map<string, WorkspaceArticleRecord>();
  failMarkerList = false;
  failMarkerCreate = false;
  failSources = false;
  // Runs once, right after the Nth workspace-article create — "another
  // machine" acting in the middle of a migration.
  onCreate: ((n: number) => void) | null = null;
  private creates = 0;
  private seq = 0;
  private clock = 1_000;

  put(summary: string, content: string): WorkspaceArticleRecord {
    const a = { id: `art-${++this.seq}`, summary, content, updated: ++this.clock };
    this.articles.set(a.id, a);
    return a;
  }
  rewrite(id: string, content: string) {
    const a = this.articles.get(id)!;
    a.content = content;
    a.updated = ++this.clock;
  }
  private all(pred: (a: WorkspaceArticleRecord) => boolean) {
    return [...this.articles.values()].filter(pred).map((a) => ({ ...a }));
  }
  byTitle(t: string) {
    return this.all((a) => a.summary === t);
  }

  async listSources() {
    if (this.failSources) return { ok: false as const, reason: 'fetch-error' as const };
    return { ok: true as const, articles: this.all((a) => a.summary === CONFIG_ARTICLE_TITLE || a.summary === JIRA_PROFILE_ARTICLE_TITLE) };
  }
  async list() {
    return { ok: true as const, articles: this.all((a) => a.summary.startsWith(WORKSPACE_ARTICLE_PREFIX)) };
  }
  async listMarkers() {
    if (this.failMarkerList) return { ok: false as const, reason: 'fetch-error' as const };
    return { ok: true as const, articles: this.byTitle(STORAGE_MARKER_TITLE) };
  }
  async get(id: string) {
    const a = this.articles.get(id);
    return a ? { ...a } : null;
  }
  failCreateAfter: number | null = null;
  async create(workspaceId: string, content: string) {
    if (this.failCreateAfter !== null && this.creates >= this.failCreateAfter) return null;
    const a = this.put(workspaceArticleTitle(workspaceId), content);
    this.creates++;
    this.onCreate?.(this.creates);
    return { ...a };
  }
  async createMarker(content: string) {
    if (this.failMarkerCreate) return null;
    return { ...this.put(STORAGE_MARKER_TITLE, content) };
  }
  async update(id: string, content: string) {
    if (!this.articles.has(id)) return null;
    this.rewrite(id, content);
    return { updated: this.articles.get(id)!.updated };
  }
  workspaceDoc(workspaceId: string): { record: WorkspaceArticleRecord; doc: WorkspaceDocument } {
    const [record] = this.byTitle(workspaceArticleTitle(workspaceId));
    const parsed = parseWorkspaceDocument(record.content);
    if (!parsed.ok) throw new Error('bad doc');
    return { record, doc: parsed.document };
  }
  /** Another machine edits a workspace article (unknown fields kept). */
  editWorkspace(workspaceId: string, edit: (d: WorkspaceDocument) => WorkspaceDocument) {
    const { record } = this.workspaceDoc(workspaceId);
    const parsed = parseWorkspaceDocument(record.content);
    if (!parsed.ok) throw new Error('bad doc');
    this.rewrite(record.id, serialiseUpdatedWorkspaceDocument(parsed.source, edit(parsed.document)));
  }
}

// ─── A simulated machine: its own local state, backups and credentials ───────

class Machine {
  state: LocalStorageState = LEGACY_LOCAL_STATE;
  corrupt = false;
  failLocalWrite = false;
  files = new Map<string, string>();
  failBackupWrite = false;
  corruptBackupRead = false;
  unresolvable = new Set<string>();
  checked: string[] = [];
  private gen = 0;

  constructor(readonly name: string, readonly yt: FakeYouTrack) {}

  deps(): ActivationDeps {
    return {
      client: this.yt,
      serverUrl: 'https://youtrack.example.com',
      local: {
        read: async () => ({ state: this.state, corrupt: this.corrupt }),
        write: async (s) => {
          if (this.failLocalWrite) throw new Error('disk full');
          this.state = s;
        },
      },
      backup: {
        write: async (name, content) => {
          if (this.failBackupWrite) return null;
          const p = `/userData/storage-activation-backups/${name}`;
          if (this.files.has(p)) return null;
          this.files.set(p, content);
          return p;
        },
        read: async (p) => (this.corruptBackupRead ? 'garbage' : this.files.get(p) ?? null),
      },
      checkCredential: async (workspaceId, credentialRef): Promise<WorkspaceCredentialCheck> => {
        this.checked.push(credentialRef);
        return this.unresolvable.has(credentialRef)
          ? { ok: false, workspaceId, credentialRef, source: 'file', reason: 'file-unreadable', message: `Credential ${credentialRef} for workspace ${workspaceId} could not be read.` }
          : { ok: true, credentialRef, source: 'command' };
      },
      now: () => new Date(Date.UTC(2026, 10, 15, 12, 0, this.gen)),
      newGeneration: () => `gen-${this.name}-${++this.gen}-0000`,
    };
  }
}

// ─── Fixtures (fictional values only) ────────────────────────────────────────

const W1 = 'workspace-1700000000001';
const W2 = 'workspace-1700000000002';

function legacy() {
  return {
    version: 1,
    activeWorkspaceId: W1,
    workspaces: [
      { id: W1, name: 'Workspace A', order: 0, folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-12'] }] },
      { id: W2, name: 'Workspace B', order: 1, folders: [{ id: 'folder-b', name: 'Projects', order: 0, parentId: null, projectIds: ['0-13'] }] },
    ],
    boards: { '0-12': { ...defaultBoardConfig('0-12'), colors: { status: { Open: '#00aa00' } } }, '0-13': defaultBoardConfig('0-13') },
    dismissals: { [dismissalKey(W2, '2-1')]: { workspace: W2, issueId: '2-1', dismissedWeekOf: '2026-11-09' } },
  };
}
const JIRA = { version: 1, profile: { siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '' } };

let yt: FakeYouTrack;
let fldw: Machine;
let mac: Machine;
let configId: string;

beforeEach(() => {
  yt = new FakeYouTrack();
  configId = yt.put(CONFIG_ARTICLE_TITLE, JSON.stringify(legacy(), null, 2)).id;
  yt.put(JIRA_PROFILE_ARTICLE_TITLE, JSON.stringify(JIRA));
  fldw = new Machine('fldw', yt);
  mac = new Machine('mac', yt);
});

const activate = (m: Machine, extra: Record<string, unknown> = {}) => activateWorkspaceStorage(m.deps(), { confirmed: true, ...extra });
const rollback = (m: Machine) => returnToLegacyStorage(m.deps(), { confirmed: true });
const sourcesSnapshot = () => [...yt.articles.values()].filter((a) => a.summary === CONFIG_ARTICLE_TITLE || a.summary === JIRA_PROFILE_ARTICLE_TITLE).map((a) => ({ ...a }));

async function guardOf(m: Machine) {
  return storageWriteGuard(m.state, await readMarker(yt), m.corrupt);
}

// ─── Activation ──────────────────────────────────────────────────────────────

describe('activation', () => {
  it('runs only when confirmed', async () => {
    const r = await activateWorkspaceStorage(fldw.deps(), {});
    expect(r).toMatchObject({ ok: false, reason: 'not-confirmed' });
    expect(yt.byTitle(STORAGE_MARKER_TITLE)).toEqual([]);
    expect(fldw.files.size).toBe(0);
  });

  it('a full activation: backup, migration, marker, then the local switch; sources untouched', async () => {
    const before = sourcesSnapshot();
    const r = await activate(fldw, { jiraWorkspaceName: 'Workspace J' });
    if (!r.ok) throw new Error(r.message);
    expect(r.outcome).toBe('activated');
    expect(r.report?.complete).toBe(true);
    expect(fldw.state).toMatchObject({ mode: 'per-workspace', generation: r.generation, backupFile: r.backupFile });
    expect(sourcesSnapshot()).toEqual(before);

    const read = await readMarker(yt);
    if (read.status !== 'ok') throw new Error(read.status);
    expect(read.marker).toMatchObject({ state: 'active', generation: r.generation, sequence: 1 });
    expect(Object.keys(read.marker.workspaces).sort()).toEqual([W1, W2, 'ws-jira-art-2'].sort());
    expect(read.marker.sources.config.articleId).toBe(configId);

    // Every reference the migrated workspaces name was actually resolved.
    expect(new Set(fldw.checked)).toEqual(new Set(['youtrack-1', 'anthropic-1', 'jira-1']));
    expect(await guardOf(fldw)).toMatchObject({ allowed: true });
  });

  it('board settings and dismissals go to their own workspace only', async () => {
    const r = await activate(fldw);
    if (!r.ok) throw new Error(r.message);
    const a = yt.workspaceDoc(W1).doc;
    const b = yt.workspaceDoc(W2).doc;
    expect(Object.keys(a.boards)).toEqual(['0-12']);
    expect(a.boards['0-12'].colors).toEqual({ status: { Open: '#00aa00' } });
    expect(Object.keys(b.boards)).toEqual(['0-13']);
    expect(a.dismissals).toEqual({});
    expect(Object.keys(b.dismissals)).toEqual([dismissalKey(W2, '2-1')]);
  });

  it('writes a verified backup holding both source articles, kept after success', async () => {
    const r = await activate(fldw);
    if (!r.ok || !r.backupFile) throw new Error('no backup');
    const backup = parseActivationBackup(fldw.files.get(r.backupFile)!);
    expect(backup?.articles.map((x) => x.role)).toEqual(['config', 'jira-profile']);
    const config = backup!.articles[0];
    expect(config).toMatchObject({ articleId: configId, updated: yt.articles.get(configId)!.updated });
    expect(JSON.parse(config.content)).toEqual(legacy());
  });

  it('stops before writing anything when the backup cannot be written or verified', async () => {
    fldw.failBackupWrite = true;
    expect(await activate(fldw)).toMatchObject({ ok: false, reason: 'backup-failed' });
    fldw.failBackupWrite = false;
    fldw.corruptBackupRead = true;
    expect(await activate(fldw)).toMatchObject({ ok: false, reason: 'backup-failed' });
    expect(yt.byTitle(workspaceArticleTitle(W1))).toEqual([]);
    expect(yt.byTitle(STORAGE_MARKER_TITLE)).toEqual([]);
    expect(fldw.state.mode).toBe('legacy');
  });

  it('refuses when a credential reference does not resolve, before writing any article', async () => {
    fldw.unresolvable.add('anthropic-1');
    const r = await activate(fldw);
    expect(r).toMatchObject({ ok: false, reason: 'credential-failed' });
    if (r.ok) return;
    expect(r.message).toContain('anthropic-1');
    expect(r.backupFile).toBeTruthy(); // kept
    expect(yt.byTitle(workspaceArticleTitle(W1))).toEqual([]);
    expect(yt.byTitle(STORAGE_MARKER_TITLE)).toEqual([]);
    expect(fldw.state.mode).toBe('legacy');
  });

  it('stops before writing when an existing workspace article cannot be read', async () => {
    yt.put(workspaceArticleTitle(W2), 'not json');
    const r = await activate(fldw);
    expect(r).toMatchObject({ ok: false, reason: 'migration-blocked' });
    expect(yt.byTitle(workspaceArticleTitle(W1))).toEqual([]);
    expect(yt.byTitle(STORAGE_MARKER_TITLE)).toEqual([]);
    expect(fldw.state.mode).toBe('legacy');
  });

  it('stops on an incomplete migration (a create fails part-way), leaving legacy authoritative', async () => {
    yt.failCreateAfter = 1;
    const r = await activate(fldw);
    expect(r).toMatchObject({ ok: false, reason: 'migration-incomplete' });
    expect(yt.byTitle(STORAGE_MARKER_TITLE)).toEqual([]);
    expect(fldw.state.mode).toBe('legacy');
    expect(await guardOf(fldw)).toMatchObject({ allowed: true }); // legacy keeps working
    // Retried once the cause is gone: the article already created is found unchanged.
    yt.failCreateAfter = null;
    const again = await activate(fldw);
    expect(again).toMatchObject({ ok: true });
    if (again.ok) expect(again.report?.items.find((i) => i.workspaceId === W1)?.action).toBe('unchanged');
  });

  it('stops when the configuration changes mid-migration; the articles it created are kept', async () => {
    yt.onCreate = (n) => {
      if (n === 1) yt.rewrite(configId, JSON.stringify({ ...legacy(), activeWorkspaceId: W2 }));
    };
    const r = await activate(fldw);
    expect(r).toMatchObject({ ok: false, reason: 'source-changed' });
    expect(yt.byTitle(STORAGE_MARKER_TITLE)).toEqual([]);
    expect(fldw.state.mode).toBe('legacy');
    expect(yt.byTitle(workspaceArticleTitle(W1))).toHaveLength(1);

    // A second run migrates the current configuration and completes.
    yt.onCreate = null;
    const again = await activate(fldw);
    if (!again.ok) throw new Error(again.reason + ': ' + again.message);
    expect(again.outcome).toBe('activated');
  });

  it('refuses when the marker cannot be read, and when it is ambiguous', async () => {
    yt.failMarkerList = true;
    expect(await activate(fldw)).toMatchObject({ ok: false, reason: 'marker-unverified' });
    yt.failMarkerList = false;
    yt.put(STORAGE_MARKER_TITLE, 'not json');
    expect(await activate(fldw)).toMatchObject({ ok: false, reason: 'marker-unverified' });
    expect(yt.byTitle(workspaceArticleTitle(W1))).toEqual([]);
  });

  it('a marker that cannot be created leaves this machine on legacy storage', async () => {
    yt.failMarkerCreate = true;
    expect(await activate(fldw)).toMatchObject({ ok: false, reason: 'marker-write-failed' });
    expect(fldw.state.mode).toBe('legacy');
  });

  it('refuses a second activation on a machine that is already active', async () => {
    await activate(fldw);
    expect(await activate(fldw)).toMatchObject({ ok: false, reason: 'already-active' });
  });

  it('a corrupt local state file is refused, and blocks writes', async () => {
    fldw.corrupt = true;
    expect(await activate(fldw)).toMatchObject({ ok: false, reason: 'local-state-corrupt' });
    expect(await guardOf(fldw)).toMatchObject({ allowed: false, reason: 'local-state-corrupt' });
  });
});

// ─── Two machines ────────────────────────────────────────────────────────────

describe('two machines', () => {
  it('a machine still on legacy storage is blocked once another machine activates, and can join', async () => {
    expect(await guardOf(mac)).toMatchObject({ allowed: true });
    const r = await activate(fldw);
    if (!r.ok) throw new Error(r.message);
    expect(await guardOf(mac)).toMatchObject({ allowed: false, reason: 'activated-elsewhere' });

    const joined = await activate(mac);
    expect(joined).toMatchObject({ ok: true, outcome: 'joined', generation: r.generation });
    expect(mac.files.size).toBe(0); // joining migrates nothing
    expect(await guardOf(mac)).toMatchObject({ allowed: true });
  });

  it('joining refuses when this machine cannot resolve a reference', async () => {
    await activate(fldw);
    mac.unresolvable.add('youtrack-1');
    expect(await activate(mac)).toMatchObject({ ok: false, reason: 'credential-failed' });
    expect(mac.state.mode).toBe('legacy');
  });

  it('a machine on an older generation is superseded after a re-activation', async () => {
    await activate(fldw);
    await activate(mac); // joins generation 1
    expect((await rollback(fldw)).ok).toBe(true); // nothing changed yet: safe
    expect(await guardOf(mac)).toMatchObject({ allowed: false, reason: 'retired-elsewhere' });
    // The FLDW activates again: a new generation.
    fldw.state = LEGACY_LOCAL_STATE;
    const again = await activate(fldw);
    if (!again.ok) throw new Error(again.message);
    expect(await guardOf(mac)).toMatchObject({ allowed: false, reason: 'superseded' });
    // The Mac returns locally, then joins the new generation.
    expect(await rollback(mac)).toMatchObject({ ok: true, outcome: 'local-only' });
    expect(await activate(mac)).toMatchObject({ ok: true, outcome: 'joined', generation: again.generation });
  });
});

// ─── Write authorization: a fresh marker read every time ─────────────────────

describe('write authorization', () => {
  const auth = (m: Machine, mode: 'legacy' | 'per-workspace') => authorizeConfigWrite(mode, { state: m.state, corrupt: m.corrupt }, yt);

  it('reads the marker on every write: no grace period after another machine retires it', async () => {
    await activate(fldw);
    await activate(mac);
    let reads = 0;
    const listMarkers = yt.listMarkers.bind(yt);
    yt.listMarkers = async () => { reads++; return listMarkers(); };

    expect(await auth(mac, 'per-workspace')).toMatchObject({ allowed: true });
    expect(await auth(mac, 'per-workspace')).toMatchObject({ allowed: true });
    expect(reads).toBe(2);

    // The FLDW retires the activation; the Mac's very next write is refused.
    expect(await rollback(fldw)).toMatchObject({ ok: true, outcome: 'returned' });
    expect(await auth(mac, 'per-workspace')).toMatchObject({ allowed: false, reason: 'retired-elsewhere' });
  });

  it('refuses immediately after another machine replaces the generation', async () => {
    await activate(fldw);
    await activate(mac);
    expect(await auth(mac, 'per-workspace')).toMatchObject({ allowed: true });
    await rollback(fldw);
    await activate(fldw); // new generation
    expect(await auth(mac, 'per-workspace')).toMatchObject({ allowed: false, reason: 'superseded' });
    expect(await auth(fldw, 'per-workspace')).toMatchObject({ allowed: true });
  });

  it('refuses immediately when another machine activates while this one is on legacy storage', async () => {
    expect(await auth(mac, 'legacy')).toMatchObject({ allowed: true });
    await activate(fldw);
    expect(await auth(mac, 'legacy')).toMatchObject({ allowed: false, reason: 'activated-elsewhere' });
  });

  it('fails closed: marker unreadable, duplicated, malformed or missing; wrong mode; no YouTrack', async () => {
    await activate(fldw);
    yt.failMarkerList = true;
    expect(await auth(fldw, 'per-workspace')).toMatchObject({ allowed: false, reason: 'marker-unverified' });
    yt.failMarkerList = false;
    const [m] = yt.byTitle(STORAGE_MARKER_TITLE);
    yt.put(STORAGE_MARKER_TITLE, m.content);
    expect(await auth(fldw, 'per-workspace')).toMatchObject({ allowed: false, reason: 'marker-unverified' });
    yt.articles.clear();
    expect(await auth(fldw, 'per-workspace')).toMatchObject({ allowed: false, reason: 'retired-elsewhere' });
    yt.put(STORAGE_MARKER_TITLE, '{"kind":"vermilian-storage-activation","schema":1}');
    expect(await auth(fldw, 'per-workspace')).toMatchObject({ allowed: false, reason: 'marker-unverified' });
    expect(await auth(fldw, 'legacy')).toMatchObject({ allowed: false, reason: 'mode-mismatch' });
    expect(await authorizeConfigWrite('per-workspace', { state: fldw.state, corrupt: false }, null)).toMatchObject({ allowed: false, reason: 'not-configured' });
  });
});

// ─── Return to legacy storage ────────────────────────────────────────────────

describe('return to legacy storage', () => {
  it('is allowed when nothing changed since activation; the articles are kept and the marker retired', async () => {
    await activate(fldw);
    const articlesBefore = yt.byTitle(workspaceArticleTitle(W1));
    const r = await rollback(fldw);
    expect(r).toMatchObject({ ok: true, outcome: 'returned' });
    expect(fldw.state.mode).toBe('legacy');
    expect(yt.byTitle(workspaceArticleTitle(W1))).toEqual(articlesBefore);
    const m = await readMarker(yt);
    expect(m.status === 'ok' && m.marker.state).toBe('retired');
    expect(await guardOf(fldw)).toMatchObject({ allowed: true });
  });

  it('is refused when a workspace was changed after activation — on another machine — and nothing changes', async () => {
    await activate(fldw);
    await activate(mac);
    yt.editWorkspace(W1, (d) => ({ ...d, name: 'Workspace A renamed' }));
    const markerBefore = yt.byTitle(STORAGE_MARKER_TITLE);
    const r = await rollback(fldw);
    expect(r).toMatchObject({ ok: false, reason: 'unsafe' });
    if (r.ok) return;
    expect(r.changes).toEqual([expect.objectContaining({ kind: 'workspace-changed', workspaceId: W1 })]);
    expect(yt.byTitle(STORAGE_MARKER_TITLE)).toEqual(markerBefore);
    expect(fldw.state.mode).toBe('per-workspace');
  });

  it('is refused when a workspace was added, or the legacy article was changed by an older client', async () => {
    await activate(fldw);
    yt.rewrite(configId, JSON.stringify({ ...legacy(), workspaces: [] }));
    const r = await rollback(fldw);
    expect(r).toMatchObject({ ok: false, reason: 'unsafe' });
    if (!r.ok) expect(r.changes?.map((c) => c.kind)).toEqual(['legacy-changed']);
    expect((await storageStatus(fldw.deps())).legacyChangedSinceActivation).toBe(true);
  });

  it('refuses when the marker cannot be verified', async () => {
    await activate(fldw);
    yt.failMarkerList = true;
    expect(await rollback(fldw)).toMatchObject({ ok: false, reason: 'marker-unverified' });
    expect(fldw.state.mode).toBe('per-workspace');
  });

  it('runs only when confirmed', async () => {
    await activate(fldw);
    expect(await returnToLegacyStorage(fldw.deps(), {})).toMatchObject({ ok: false, reason: 'not-confirmed' });
  });
});

// ─── Pure parsing ────────────────────────────────────────────────────────────

describe('parsing', () => {
  it('a marker with a secret-shaped value is refused', () => {
    const m = {
      schema: 1, kind: 'vermilian-storage-activation', state: 'active', generation: 'gen-abcdefgh', sequence: 1,
      activatedAt: 'x', retiredAt: null, sources: { config: { articleId: 'a', updated: 1 }, jiraProfile: null }, workspaces: {},
      token: 'not-a-real-value',
    };
    expect(parseStorageMarker(JSON.stringify(m)).ok).toBe(false);
    expect(parseStorageMarker(JSON.stringify({ ...m, token: undefined })).ok).toBe(true);
  });

  it('a missing local state is legacy; an unreadable one is legacy and flagged corrupt', () => {
    expect(parseLocalStorageState(null)).toEqual({ state: LEGACY_LOCAL_STATE, corrupt: false });
    expect(parseLocalStorageState('{').corrupt).toBe(true);
    expect(parseLocalStorageState(JSON.stringify({ schema: 1, mode: 'per-workspace' })).corrupt).toBe(true);
  });
});
