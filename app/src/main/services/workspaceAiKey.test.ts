import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '../../shared/config';
import type { WorkspaceChoice } from '../../shared/activeWorkspace';
import { AI_NOT_SELECTED_MESSAGE, refFromE2eFakeAnthropicKey } from '../../shared/workspaceAi';
import type { CredentialSourceIO } from './credentialResolver';
import {
  AI_LEGACY_NO_KEY_MESSAGE,
  AI_WORKSPACE_CHANGED_MESSAGE,
  beginWorkspaceAiOperation,
  resolveWorkspaceAiKey,
  type WorkspaceAiKeyRequest,
} from './workspaceAiKey';

// Fictional values only. Each "key" is a marker the tests look for.
const KEY_HOME = 'fictional-home-key-111';
const KEY_WORK = 'fictional-work-key-222';
const KEY_SETTINGS = 'fictional-settings-key-333';

function io(host: { commands?: Record<string, string | 'fail'>; files?: Record<string, string | 'fail'>; blobs?: Record<string, string> }) {
  const calls: string[] = [];
  const fake: CredentialSourceIO = {
    async runCommand(c) {
      calls.push(`command:${c}`);
      const v = host.commands?.[c];
      return v === undefined || v === 'fail' ? { ok: false } : { ok: true, stdout: v };
    },
    async readFile(f) {
      calls.push(`file:${f}`);
      const v = host.files?.[f];
      return v === undefined || v === 'fail' ? { ok: false } : { ok: true, content: v };
    },
    async blobPresent(name) {
      calls.push(`blobPresent:${name}`);
      return name in (host.blobs ?? {});
    },
    async readBlob(name) {
      calls.push(`readBlob:${name}`);
      const v = host.blobs?.[name];
      return v === undefined ? { ok: false } : { ok: true, value: v };
    },
  };
  return { fake, calls };
}

const choice = (id: string, aiCredentialRef: string | null): WorkspaceChoice => ({
  id,
  name: id,
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'https://yt.example.com', credentialRef: 'youtrack-1' },
  aiCredentialRef,
});

const CHOICES = [choice('ws-home', 'anthropic-home'), choice('ws-work', 'anthropic-work'), choice('ws-none', null), choice('ws-legacyref', 'anthropic-1')];

const CFG: AppConfig = {
  ...DEFAULT_CONFIG,
  claudeKeyCommand: 'show settings key',
  credentialSources: {
    'anthropic-home': { command: 'show home', file: '' },
    'anthropic-work': { command: '', file: '/fictional/work.key' },
    'anthropic-broken': { command: 'show broken', file: '/fictional/broken.key' },
  },
};

function request(over: Partial<WorkspaceAiKeyRequest>, host = io({
  commands: { 'show home': KEY_HOME, 'show broken': 'fail', 'show settings key': KEY_SETTINGS },
  files: { '/fictional/work.key': KEY_WORK, '/fictional/broken.key': 'should-never-be-read' },
  blobs: { 'claude.key.bin': 'legacy-blob-key' },
})) {
  const loadLegacyKey = vi.fn(async (_cfg: AppConfig): Promise<string | null> => KEY_SETTINGS);
  const req: WorkspaceAiKeyRequest = {
    storage: 'per-workspace',
    activeId: 'ws-home',
    choices: CHOICES,
    requestedWorkspaceId: undefined,
    cfg: CFG,
    io: host.fake,
    loadLegacyKey,
    e2e: false,
    ...over,
  };
  return { req, calls: host.calls, loadLegacyKey };
}

describe('resolveWorkspaceAiKey — per-workspace storage', () => {
  it('two workspaces with different references each get their own key', async () => {
    await expect(resolveWorkspaceAiKey(request({ activeId: 'ws-home' }).req)).resolves.toEqual({ ok: true, key: KEY_HOME });
    await expect(resolveWorkspaceAiKey(request({ activeId: 'ws-work' }).req)).resolves.toEqual({ ok: true, key: KEY_WORK });
  });

  it('a workspace with none selected is refused without any source being touched', async () => {
    const { req, calls, loadLegacyKey } = request({ activeId: 'ws-none' });
    await expect(resolveWorkspaceAiKey(req)).resolves.toEqual({ ok: false, error: AI_NOT_SELECTED_MESSAGE });
    expect(calls).toEqual([]);
    expect(loadLegacyKey).not.toHaveBeenCalled();
  });

  it('a failing configured source stops it: no lower source, no Settings key, no other workspace', async () => {
    const choices = [...CHOICES, choice('ws-broken', 'anthropic-broken')];
    const { req, calls, loadLegacyKey } = request({ activeId: 'ws-broken', choices });
    const r = await resolveWorkspaceAiKey(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/^AI is unavailable: /);
      expect(r.error).toMatch(/anthropic-broken/);
      for (const secret of [KEY_HOME, KEY_WORK, KEY_SETTINGS, 'show broken', '/fictional/']) expect(r.error).not.toContain(secret);
    }
    expect(calls).toEqual(['command:show broken']);
    expect(loadLegacyKey).not.toHaveBeenCalled();
  });

  it('a selected reference with nothing configured here fails closed', async () => {
    const choices = [choice('ws-x', 'anthropic-elsewhere')];
    const r = await resolveWorkspaceAiKey(request({ activeId: 'ws-x', choices }).req);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/no source configured on this machine/);
  });

  it('anthropic-1 chosen explicitly resolves through its own legacy sources, not the Settings loader', async () => {
    const { req, loadLegacyKey } = request({ activeId: 'ws-legacyref' });
    await expect(resolveWorkspaceAiKey(req)).resolves.toEqual({ ok: true, key: KEY_SETTINGS });
    expect(loadLegacyKey).not.toHaveBeenCalled();
  });

  it('refuses a request made from a workspace that is no longer active, before resolving anything', async () => {
    const { req, calls } = request({ activeId: 'ws-work', requestedWorkspaceId: 'ws-home' });
    await expect(resolveWorkspaceAiKey(req)).resolves.toEqual({ ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE });
    expect(calls).toEqual([]);
  });

  it('e2e: an unconfigured reference gets a fictional key naming it; a failing one never does', async () => {
    const choices = [choice('ws-e', 'anthropic-e2e'), choice('ws-missing', 'e2e-missing-1'), choice('ws-broken', 'anthropic-broken')];
    const ok = await resolveWorkspaceAiKey(request({ activeId: 'ws-e', choices, e2e: true }).req);
    expect(ok.ok && refFromE2eFakeAnthropicKey(ok.key)).toBe('anthropic-e2e');
    expect((await resolveWorkspaceAiKey(request({ activeId: 'ws-missing', choices, e2e: true }).req)).ok).toBe(false);
    expect((await resolveWorkspaceAiKey(request({ activeId: 'ws-broken', choices, e2e: true }).req)).ok).toBe(false);
  });
});

describe('resolveWorkspaceAiKey — legacy storage (before VERM-53)', () => {
  it('uses the Settings key loader unchanged, whatever a workspace names', async () => {
    const { req, calls, loadLegacyKey } = request({ storage: 'legacy', activeId: 'ws-none' });
    await expect(resolveWorkspaceAiKey(req)).resolves.toEqual({ ok: true, key: KEY_SETTINGS });
    expect(loadLegacyKey).toHaveBeenCalledWith(CFG);
    expect(calls).toEqual([]);
  });

  it('reports a missing Settings key as before', async () => {
    const { req, loadLegacyKey } = request({ storage: 'legacy' });
    loadLegacyKey.mockResolvedValueOnce(null);
    await expect(resolveWorkspaceAiKey(req)).resolves.toEqual({ ok: false, error: AI_LEGACY_NO_KEY_MESSAGE });
  });

  it('still refuses a request from a workspace that is no longer active', async () => {
    const { req, loadLegacyKey } = request({ storage: 'legacy', activeId: 'ws-work', requestedWorkspaceId: 'ws-home' });
    await expect(resolveWorkspaceAiKey(req)).resolves.toEqual({ ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE });
    expect(loadLegacyKey).not.toHaveBeenCalled();
  });
});

// ─── The final check immediately before Anthropic is contacted ──────────────
// A controlled fixture: a credential source that resolves only when the test
// lets it, and a switch counter the test bumps, as setActiveWorkspace does.

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function slowWorkspace() {
  let generation = 0;
  const gate = deferred<void>();
  const host = io({ files: { '/fictional/slow.key': 'fictional-slow-key-444' } });
  const slowIo: CredentialSourceIO = {
    ...host.fake,
    async readFile(f) {
      await gate.promise; // credential resolution held here
      return host.fake.readFile(f);
    },
  };
  const choices = [choice('ws-a', 'anthropic-slow'), choice('ws-b', 'anthropic-home')];
  const cfg: AppConfig = { ...CFG, credentialSources: { ...CFG.credentialSources, 'anthropic-slow': { command: '', file: '/fictional/slow.key' } } };
  const base = request({ activeId: 'ws-a', choices, cfg, io: slowIo, requestedWorkspaceId: 'ws-a' }, host).req;
  return {
    begin: (over: Partial<WorkspaceAiKeyRequest> = {}) =>
      beginWorkspaceAiOperation({ ...base, ...over, startGeneration: generation, currentGeneration: () => generation }),
    switchWorkspace: () => { generation += 1; },
    release: () => gate.resolve(),
    calls: host.calls,
  };
}

const OPERATIONS = ['extractTaskFields', 'getRecommendation', 'generateStandupReport'] as const;

describe('beginWorkspaceAiOperation — revalidated immediately before Anthropic', () => {
  it.each(OPERATIONS)('%s: a switch while the credential is still resolving refuses before any request', async () => {
    const w = slowWorkspace();
    const pending = w.begin();      // 1. workspace A begins resolving its credential
    await Promise.resolve();        // 2. resolution is held at the slow source
    w.switchWorkspace();            // 3. the user switches to workspace B
    w.release();                    // 4. A's credential finishes resolving
    const op = await pending;
    expect(op.ok).toBe(true);
    const anthropic = vi.fn(async (_key: string) => 'reply');
    const sent = op.ok ? await op.send(anthropic) : null;
    expect(sent).toEqual({ ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE }); // 5. refused
    expect(anthropic).not.toHaveBeenCalled();
  });

  it('a switch after resolution but before sending (e.g. while issues load) also refuses', async () => {
    const w = slowWorkspace();
    w.release();
    const op = await w.begin();
    w.switchWorkspace();
    const anthropic = vi.fn(async (_key: string) => 'reply');
    expect(op.ok && (await op.send(anthropic))).toEqual({ ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE });
    expect(anthropic).not.toHaveBeenCalled();
  });

  it('without a switch the request is sent once, with the workspace\'s own key', async () => {
    const w = slowWorkspace();
    w.release();
    const op = await w.begin();
    const anthropic = vi.fn(async (key: string) => `reply for ${key.length}`);
    expect(op.ok && (await op.send(anthropic))).toEqual({ ok: true, value: 'reply for 22' });
    expect(anthropic).toHaveBeenCalledTimes(1);
    expect(anthropic).toHaveBeenCalledWith('fictional-slow-key-444');
  });

  it("a switch never substitutes the new workspace's credential, and nothing is retried", async () => {
    const w = slowWorkspace();
    const pending = w.begin();
    await Promise.resolve();
    w.switchWorkspace();
    w.release();
    const op = await pending;
    const anthropic = vi.fn(async (_key: string) => 'reply');
    if (op.ok) await op.send(anthropic);
    expect(anthropic).not.toHaveBeenCalled();
    // Only workspace A's own source was ever read; B's command never ran.
    expect(w.calls).toEqual(['file:/fictional/slow.key']);
  });

  it('none selected and a failing configured source still fail before any send is possible', async () => {
    const w = slowWorkspace();
    w.release();
    const none = await w.begin({ activeId: 'ws-none', choices: CHOICES, requestedWorkspaceId: 'ws-none' });
    expect(none).toEqual({ ok: false, error: AI_NOT_SELECTED_MESSAGE });
    const broken = await w.begin({
      activeId: 'ws-broken',
      choices: [choice('ws-broken', 'anthropic-broken')],
      requestedWorkspaceId: 'ws-broken',
      io: io({ commands: { 'show broken': 'fail' } }).fake,
    });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toMatch(/^AI is unavailable: .*anthropic-broken/);
  });

  it('legacy storage: the Settings key is sent when nothing switched, and refused when something did', async () => {
    const w = slowWorkspace();
    const ok = await w.begin({ storage: 'legacy' });
    expect(ok.ok && (await ok.send(async (key) => key === KEY_SETTINGS))).toEqual({ ok: true, value: true });
    const op = await w.begin({ storage: 'legacy' });
    w.switchWorkspace();
    const anthropic = vi.fn(async (_key: string) => 'reply');
    expect(op.ok && (await op.send(anthropic))).toEqual({ ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE });
    expect(anthropic).not.toHaveBeenCalled();
  });

  it('no credential value appears in any refusal', async () => {
    const w = slowWorkspace();
    const pending = w.begin();
    await Promise.resolve();
    w.switchWorkspace();
    w.release();
    const op = await pending;
    const refusal = op.ok ? await op.send(async () => 'x') : op;
    expect(JSON.stringify(refusal)).not.toMatch(/fictional-|\/fictional\//);
    expect(JSON.stringify(op)).not.toContain('fictional-slow-key-444'); // the handle carries no visible key
  });
});
