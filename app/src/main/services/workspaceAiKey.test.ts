import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '../../shared/config';
import type { WorkspaceChoice } from '../../shared/activeWorkspace';
import { AI_NOT_SELECTED_MESSAGE, refFromE2eFakeAnthropicKey } from '../../shared/workspaceAi';
import type { CredentialSourceIO } from './credentialResolver';
import {
  AI_LEGACY_NO_KEY_MESSAGE,
  AI_WORKSPACE_CHANGED_MESSAGE,
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
