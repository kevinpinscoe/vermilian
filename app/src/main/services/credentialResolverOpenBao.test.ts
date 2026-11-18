import { describe, it, expect, vi } from 'vitest';
import { credentialRefStatus, resolveWorkspaceCredential, type CredentialSourceIO } from './credentialResolver';
import { DEFAULT_CONFIG, type AppConfig } from '../../shared/config';
import {
  DEFAULT_OPENBAO_CONNECTION,
  SETTINGS_SCOPE_ID,
  type OpenBaoFailureReason,
  type OpenBaoScopeConfig,
} from '../../shared/openbao';

// Fictional values only.
const BAO_VALUE = 'bao-secret-value-111';
const LOCAL_VALUE = 'local-secret-value-222';

function scope(url: string, refs: string[]): OpenBaoScopeConfig {
  return {
    ...DEFAULT_OPENBAO_CONNECTION,
    url,
    credentials: Object.fromEntries(refs.map((r) => [r, { path: r, field: 'token' }])),
  };
}

function io(result: { ok: true; value: string } | { ok: false; reason: OpenBaoFailureReason } = { ok: true, value: BAO_VALUE }) {
  return {
    runCommand: vi.fn(async () => ({ ok: true as const, stdout: LOCAL_VALUE })),
    readFile: vi.fn(async () => ({ ok: true as const, content: LOCAL_VALUE })),
    blobPresent: vi.fn(async () => true),
    readBlob: vi.fn(async () => ({ ok: true as const, value: LOCAL_VALUE })),
    readOpenBao: vi.fn(async () => result),
  } satisfies CredentialSourceIO;
}

function cfg(over: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    credentialSources: { 'jira-2': { command: 'print-local-token', file: '' } },
    ...over,
  };
}

describe('resolving through OpenBao', () => {
  it('reads OpenBao without touching a local source or the keychain', async () => {
    const fake = io();
    const r = await resolveWorkspaceCredential(
      { workspaceId: 'ws-a', credentialRef: 'jira-2' },
      cfg({ openbaoScopes: { 'ws-a': scope('https://a.test', ['jira-2']) } }),
      fake,
    );
    expect(r).toMatchObject({ ok: true, value: BAO_VALUE, source: 'openbao' });
    expect(fake.runCommand).not.toHaveBeenCalled();
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(fake.blobPresent).not.toHaveBeenCalled();
    expect(fake.readBlob).not.toHaveBeenCalled();
  });

  it.each<OpenBaoFailureReason>(['unreachable', 'sealed', 'auth-rejected', 'forbidden', 'not-found'])(
    'fails on %s instead of falling back to a local source',
    async (reason) => {
      const fake = io({ ok: false, reason });
      const r = await resolveWorkspaceCredential(
        { workspaceId: 'ws-a', credentialRef: 'jira-2' },
        cfg({ openbaoScopes: { 'ws-a': scope('https://a.test', ['jira-2']) } }),
        fake,
      );
      expect(r).toMatchObject({ ok: false, source: 'openbao', reason: `openbao-${reason}` });
      expect(fake.runCommand).not.toHaveBeenCalled();
      expect(fake.readBlob).not.toHaveBeenCalled();
      expect(JSON.stringify(r)).not.toContain(LOCAL_VALUE);
    },
  );

  it('refuses a value that is not a single credential', async () => {
    const r = await resolveWorkspaceCredential(
      { workspaceId: 'ws-a', credentialRef: 'jira-2' },
      cfg({ openbaoScopes: { 'ws-a': scope('https://a.test', ['jira-2']) } }),
      io({ ok: true, value: 'two words' }),
    );
    expect(r).toMatchObject({ ok: false, source: 'openbao', reason: 'invalid' });
  });
});

describe('workspace isolation', () => {
  it('uses only the requesting workspace’s own server', async () => {
    const fake = io();
    await resolveWorkspaceCredential(
      { workspaceId: 'ws-b', credentialRef: 'jira-2' },
      cfg({ openbaoScopes: { 'ws-a': scope('https://a.test', ['jira-2']), 'ws-b': scope('https://b.test', ['jira-2']) } }),
      fake,
    );
    expect(fake.readOpenBao).toHaveBeenCalledTimes(1);
    expect(fake.readOpenBao.mock.calls[0]).toEqual(
      expect.arrayContaining(['ws-b', expect.objectContaining({ url: 'https://b.test' })]),
    );
  });

  it('never reads another workspace’s OpenBao for the same reference', async () => {
    const fake = io();
    const r = await resolveWorkspaceCredential(
      { workspaceId: 'ws-b', credentialRef: 'jira-2' },
      cfg({ openbaoScopes: { 'ws-a': scope('https://a.test', ['jira-2']) } }),
      fake,
    );
    expect(fake.readOpenBao).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, source: 'command' });
  });

  it('does not let a workspace borrow a non-Settings reference from the Settings scope', async () => {
    const fake = io();
    await resolveWorkspaceCredential(
      { workspaceId: 'ws-a', credentialRef: 'jira-2' },
      cfg({ openbaoScopes: { [SETTINGS_SCOPE_ID]: scope('https://s.test', ['jira-2']) } }),
      fake,
    );
    expect(fake.readOpenBao).not.toHaveBeenCalled();
  });

  it('lets a Settings reference follow the Settings scope, its own home', async () => {
    const fake = io();
    const r = await resolveWorkspaceCredential(
      { workspaceId: 'ws-a', credentialRef: 'youtrack-1' },
      cfg({ openbaoScopes: { [SETTINGS_SCOPE_ID]: scope('https://s.test', ['youtrack-1']) } }),
      fake,
    );
    expect(r).toMatchObject({ ok: true, source: 'openbao' });
    expect(fake.readOpenBao.mock.calls[0]).toEqual(expect.arrayContaining([SETTINGS_SCOPE_ID]));
  });
});

describe('credentialRefStatus', () => {
  it('reports OpenBao only for the workspace that uses it', async () => {
    const c = cfg({ openbaoScopes: { 'ws-a': scope('https://a.test', ['jira-2']) } });
    expect((await credentialRefStatus('jira-2', c, io(), 'ws-a')).selected).toBe('openbao');
    expect((await credentialRefStatus('jira-2', c, io(), 'ws-b')).selected).toBe('command');
  });
});
