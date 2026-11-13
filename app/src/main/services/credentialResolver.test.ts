import { describe, it, expect } from 'vitest';
import { resolveWorkspaceCredential, credentialRefStatus, type CredentialSourceIO } from './credentialResolver';
import { DEFAULT_CONFIG, type AppConfig } from '../../shared/config';

// Fictional values only. Every "secret" is a marker string the tests look for
// in failure output, to prove it never appears there.
const SECRET_CMD = 'cmd-secret-value-111';
const SECRET_FILE = 'file-secret-value-222';
const SECRET_BLOB = 'blob-secret-value-333';

type Outcome<T> = T | 'fail';

interface FakeHost {
  commands?: Record<string, Outcome<string>>;
  files?: Record<string, Outcome<string>>;
  /** filename → value or 'fail' (present but undecryptable). */
  blobs?: Record<string, Outcome<string>>;
  /** Blobs reported present but gone by the time they are read. */
  vanishing?: string[];
}

class FakeIO implements CredentialSourceIO {
  calls: string[] = [];
  constructor(private host: FakeHost) {}
  async runCommand(command: string) {
    this.calls.push(`command:${command}`);
    const v = this.host.commands?.[command];
    return v === undefined || v === 'fail' ? { ok: false as const } : { ok: true as const, stdout: v };
  }
  async readFile(filePath: string) {
    this.calls.push(`file:${filePath}`);
    const v = this.host.files?.[filePath];
    return v === undefined || v === 'fail' ? { ok: false as const } : { ok: true as const, content: v };
  }
  async blobPresent(filename: string) {
    this.calls.push(`blobPresent:${filename}`);
    return filename in (this.host.blobs ?? {}) || (this.host.vanishing ?? []).includes(filename);
  }
  async readBlob(filename: string) {
    this.calls.push(`readBlob:${filename}`);
    const v = this.host.blobs?.[filename];
    return v === undefined || v === 'fail' ? { ok: false as const } : { ok: true as const, value: v };
  }
}

function cfg(over: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, ...over };
}

const WS_A = 'workspace-a';
const WS_B = 'workspace-b';

function expectNoSecret(result: unknown) {
  const text = JSON.stringify(result);
  for (const s of [SECRET_CMD, SECRET_FILE, SECRET_BLOB, 'show-secret', '/secrets/']) {
    expect(text).not.toContain(s);
  }
}

describe('resolveWorkspaceCredential: each source', () => {
  const custom = (command = '', file = '') => cfg({ credentialSources: { 'ai-1': { command, file } } });

  it('uses a configured command', async () => {
    const io = new FakeIO({ commands: { 'show-secret ai': `${SECRET_CMD}\n` } });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, custom('show-secret ai'), io);
    expect(r).toEqual({ ok: true, value: SECRET_CMD, credentialRef: 'ai-1', source: 'command' });
  });

  it('stops when the command fails, naming workspace, reference and source', async () => {
    const io = new FakeIO({ commands: { 'show-secret ai': 'fail' } });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, custom('show-secret ai'), io);
    expect(r).toMatchObject({ ok: false, workspaceId: WS_A, credentialRef: 'ai-1', source: 'command', reason: 'command-failed' });
    if (!r.ok) {
      expect(r.message).toContain(WS_A);
      expect(r.message).toContain('ai-1');
      expect(r.message).toContain('command');
    }
    expectNoSecret(r);
  });

  it('uses a configured file', async () => {
    const io = new FakeIO({ files: { '/secrets/ai': `  ${SECRET_FILE}  \n` } });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, custom('', '/secrets/ai'), io);
    expect(r).toEqual({ ok: true, value: SECRET_FILE, credentialRef: 'ai-1', source: 'file' });
  });

  it('stops when the file cannot be read', async () => {
    const io = new FakeIO({});
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, custom('', '/secrets/ai'), io);
    expect(r).toMatchObject({ ok: false, source: 'file', reason: 'file-unreadable' });
    expectNoSecret(r);
  });

  it('uses the reference’s own safeStorage blob when nothing else is configured', async () => {
    const io = new FakeIO({ blobs: { 'ref-ai-1.bin': SECRET_BLOB } });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, cfg(), io);
    expect(r).toEqual({ ok: true, value: SECRET_BLOB, credentialRef: 'ai-1', source: 'safeStorage' });
  });

  it('stops when the blob cannot be decrypted', async () => {
    const io = new FakeIO({ blobs: { 'ref-ai-1.bin': 'fail' } });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, cfg(), io);
    expect(r).toMatchObject({ ok: false, source: 'safeStorage', reason: 'blob-unreadable' });
  });

  it('stops when the blob disappears between the check and the read', async () => {
    const io = new FakeIO({ vanishing: ['ref-ai-1.bin'] });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, cfg(), io);
    expect(r).toMatchObject({ ok: false, source: 'safeStorage', reason: 'blob-unreadable' });
  });

  it('stops with no-source when nothing is configured for the reference', async () => {
    const io = new FakeIO({});
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, cfg(), io);
    expect(r).toMatchObject({ ok: false, workspaceId: WS_A, credentialRef: 'ai-1', source: null, reason: 'no-source' });
  });
});

describe('resolveWorkspaceCredential: priority, and no fall-through', () => {
  const all = cfg({ credentialSources: { 'ai-1': { command: 'show-secret ai', file: '/secrets/ai' } } });
  const everything: FakeHost = {
    commands: { 'show-secret ai': SECRET_CMD },
    files: { '/secrets/ai': SECRET_FILE },
    blobs: { 'ref-ai-1.bin': SECRET_BLOB },
  };

  it('prefers the command over the file and the blob', async () => {
    const io = new FakeIO(everything);
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, all, io);
    expect(r).toMatchObject({ ok: true, source: 'command', value: SECRET_CMD });
    expect(io.calls).toEqual(['command:show-secret ai']);
  });

  it('prefers the file over the blob, and skips a genuinely unconfigured command', async () => {
    const io = new FakeIO(everything);
    const r = await resolveWorkspaceCredential(
      { workspaceId: WS_A, credentialRef: 'ai-1' },
      cfg({ credentialSources: { 'ai-1': { command: '   ', file: '/secrets/ai' } } }),
      io,
    );
    expect(r).toMatchObject({ ok: true, source: 'file', value: SECRET_FILE });
    expect(io.calls).toEqual(['file:/secrets/ai']);
  });

  it('a failed command never falls through to a working file or blob', async () => {
    const io = new FakeIO({ ...everything, commands: { 'show-secret ai': 'fail' } });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, all, io);
    expect(r).toMatchObject({ ok: false, source: 'command', reason: 'command-failed' });
    expect(io.calls).toEqual(['command:show-secret ai']);
    expectNoSecret(r);
  });

  it('a failed file never falls through to a working blob', async () => {
    const io = new FakeIO({ ...everything, files: {} });
    const r = await resolveWorkspaceCredential(
      { workspaceId: WS_A, credentialRef: 'ai-1' },
      cfg({ credentialSources: { 'ai-1': { command: '', file: '/secrets/ai' } } }),
      io,
    );
    expect(r).toMatchObject({ ok: false, source: 'file', reason: 'file-unreadable' });
    expect(io.calls).toEqual(['file:/secrets/ai']);
  });

  it('an empty command result stops rather than falling through', async () => {
    const io = new FakeIO({ ...everything, commands: { 'show-secret ai': '  \n' } });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, all, io);
    expect(r).toMatchObject({ ok: false, source: 'command', reason: 'empty' });
    expect(io.calls).toEqual(['command:show-secret ai']);
  });
});

describe('resolveWorkspaceCredential: empty and invalid values', () => {
  const fileRef = cfg({ credentialSources: { 'ai-1': { command: '', file: '/secrets/ai' } } });
  const run = (content: string) =>
    resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'ai-1' }, fileRef, new FakeIO({ files: { '/secrets/ai': content } }));

  it('rejects an empty file', async () => {
    expect(await run('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(await run(' \n\t ')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('rejects a multi-line value (a warning plus a token) without echoing it', async () => {
    const r = await run(`warning: something\n${SECRET_FILE}\n`);
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
    expectNoSecret(r);
  });

  it('rejects inner whitespace, control characters and oversized values', async () => {
    expect(await run('two words')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await run('abc\u0007def')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await run('x'.repeat(4097))).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('accepts a single token with surrounding whitespace trimmed', async () => {
    expect(await run(`\n ${SECRET_FILE} \n`)).toMatchObject({ ok: true, value: SECRET_FILE });
  });
});

describe('resolveWorkspaceCredential: workspace selection', () => {
  it('a workspace with no reference has no credential, and nothing is read', async () => {
    const io = new FakeIO({ blobs: { 'claude.key.bin': SECRET_BLOB } });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: null }, cfg(), io);
    expect(r).toMatchObject({ ok: false, workspaceId: WS_A, credentialRef: null, reason: 'not-selected' });
    expect(io.calls).toEqual([]);
  });

  it('a malformed reference is refused before any source is touched', async () => {
    for (const bad of ['', 'Has Caps', '../claude.key', 'a'.repeat(65)]) {
      const io = new FakeIO({ blobs: { 'claude.key.bin': SECRET_BLOB } });
      const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: bad }, cfg(), io);
      expect(r).toMatchObject({ ok: false, reason: 'invalid-reference', credentialRef: null });
      expect(io.calls).toEqual([]);
    }
  });

  it('a malformed workspace ID is not echoed into the message', async () => {
    const r = await resolveWorkspaceCredential({ workspaceId: `x ${SECRET_CMD}`, credentialRef: 'ai-1' }, cfg(), new FakeIO({}));
    expect(r).toMatchObject({ ok: false, reason: 'no-source' });
    expectNoSecret(r);
  });
});

describe('resolveWorkspaceCredential: legacy references (VERM-44 migrated workspaces)', () => {
  const legacy = cfg({
    youtrackTokenCommand: 'show-secret yt',
    claudeKeyFile: '/secrets/claude',
    jiraTokenCommand: '',
    jiraTokenFile: '',
  });
  const host: FakeHost = {
    commands: { 'show-secret yt': 'yt-token-1' },
    files: { '/secrets/claude': 'claude-key-1' },
    blobs: { 'jira.token.bin': 'jira-token-1', 'youtrack.token.bin': 'stale-yt', 'claude.key.bin': 'stale-claude' },
  };

  it('youtrack-1 resolves through the legacy YouTrack command', async () => {
    const io = new FakeIO(host);
    expect(await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'youtrack-1' }, legacy, io))
      .toEqual({ ok: true, value: 'yt-token-1', credentialRef: 'youtrack-1', source: 'command' });
    expect(io.calls).toEqual(['command:show-secret yt']);
  });

  it('anthropic-1 resolves through the legacy Claude file', async () => {
    const io = new FakeIO(host);
    expect(await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'anthropic-1' }, legacy, io))
      .toEqual({ ok: true, value: 'claude-key-1', credentialRef: 'anthropic-1', source: 'file' });
  });

  it('jira-1 resolves through the legacy jira.token.bin', async () => {
    const io = new FakeIO(host);
    expect(await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'jira-1' }, legacy, io))
      .toEqual({ ok: true, value: 'jira-token-1', credentialRef: 'jira-1', source: 'safeStorage' });
    expect(io.calls).toEqual(['blobPresent:jira.token.bin', 'readBlob:jira.token.bin']);
  });

  it('a broken legacy command stops; the legacy blob is not used', async () => {
    const io = new FakeIO({ ...host, commands: {} });
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'youtrack-1' }, legacy, io);
    expect(r).toMatchObject({ ok: false, credentialRef: 'youtrack-1', source: 'command', reason: 'command-failed' });
    expect(io.calls).toEqual(['command:show-secret yt']);
  });

  it('a legacy reference ignores a credentialSources entry of the same name', async () => {
    // sanitiseCredentialSources drops such entries on read; even unsanitised,
    // the resolver reads only the legacy fields.
    const io = new FakeIO(host);
    const c = { ...legacy, credentialSources: { 'anthropic-1': { command: 'show-secret other', file: '' } } };
    expect(await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'anthropic-1' }, c, io))
      .toMatchObject({ ok: true, source: 'file', value: 'claude-key-1' });
    expect(io.calls).toEqual(['file:/secrets/claude']);
  });

  it('a custom reference never reads the legacy settings or blobs', async () => {
    const io = new FakeIO(host);
    const r = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'anthropic-2' }, legacy, io);
    expect(r).toMatchObject({ ok: false, credentialRef: 'anthropic-2', reason: 'no-source' });
    expect(io.calls).toEqual(['blobPresent:ref-anthropic-2.bin']);
  });

  it('the three migrated workspaces sharing anthropic-1 all resolve the same credential', async () => {
    for (const ws of ['workspace-1700000000001', 'workspace-1700000000002', 'workspace-1700000000003']) {
      expect(await resolveWorkspaceCredential({ workspaceId: ws, credentialRef: 'anthropic-1' }, legacy, new FakeIO(host)))
        .toMatchObject({ ok: true, credentialRef: 'anthropic-1', value: 'claude-key-1' });
    }
  });
});

describe('resolveWorkspaceCredential: isolation between references and workspaces', () => {
  const two = cfg({
    credentialSources: {
      'anthropic-2': { command: 'show-secret two', file: '' },
      'anthropic-3': { command: '', file: '/secrets/three' },
    },
  });

  it('two workspaces naming one reference share it on purpose', async () => {
    const host: FakeHost = { commands: { 'show-secret two': 'key-two' } };
    const a = await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'anthropic-2' }, two, new FakeIO(host));
    const b = await resolveWorkspaceCredential({ workspaceId: WS_B, credentialRef: 'anthropic-2' }, two, new FakeIO(host));
    expect(a).toMatchObject({ ok: true, value: 'key-two' });
    expect(b).toMatchObject({ ok: true, value: 'key-two' });
  });

  it('a workspace with a different reference gets its own credential', async () => {
    const host: FakeHost = { commands: { 'show-secret two': 'key-two' }, files: { '/secrets/three': 'key-three' } };
    expect(await resolveWorkspaceCredential({ workspaceId: WS_B, credentialRef: 'anthropic-3' }, two, new FakeIO(host)))
      .toMatchObject({ ok: true, value: 'key-three', source: 'file' });
  });

  it('a failing reference is never replaced by another working one', async () => {
    const host: FakeHost = {
      commands: { 'show-secret two': 'key-two' },
      files: {},
      blobs: { 'claude.key.bin': 'legacy', 'ref-anthropic-2.bin': 'other' },
    };
    const io = new FakeIO(host);
    const r = await resolveWorkspaceCredential({ workspaceId: WS_B, credentialRef: 'anthropic-3' }, two, io);
    expect(r).toMatchObject({ ok: false, workspaceId: WS_B, credentialRef: 'anthropic-3', source: 'file', reason: 'file-unreadable' });
    expect(io.calls).toEqual(['file:/secrets/three']);
  });

  it('changing one reference’s sources leaves another reference’s resolution unchanged', async () => {
    const host: FakeHost = { commands: { 'show-secret two': 'key-two', 'show-secret new': 'key-new' }, files: { '/secrets/three': 'key-three' } };
    const changed = cfg({ credentialSources: { ...two.credentialSources, 'anthropic-2': { command: 'show-secret new', file: '' } } });
    expect(await resolveWorkspaceCredential({ workspaceId: WS_A, credentialRef: 'anthropic-2' }, changed, new FakeIO(host)))
      .toMatchObject({ value: 'key-new' });
    expect(await resolveWorkspaceCredential({ workspaceId: WS_B, credentialRef: 'anthropic-3' }, changed, new FakeIO(host)))
      .toMatchObject({ value: 'key-three' });
  });
});

describe('credentialRefStatus', () => {
  it('reports configuration without running or reading any source', async () => {
    const io = new FakeIO({ blobs: { 'ref-ai-1.bin': SECRET_BLOB } });
    const c = cfg({ credentialSources: { 'ai-1': { command: '', file: '/secrets/ai' } } });
    const s = await credentialRefStatus('ai-1', c, io);
    expect(s).toEqual({ credentialRef: 'ai-1', legacy: false, command: '', file: '/secrets/ai', blobPresent: true, selected: 'file' });
    expect(io.calls).toEqual(['blobPresent:ref-ai-1.bin']);
    expectNoSecret({ ...s, file: '' });
  });

  it('reports a legacy reference from the legacy fields', async () => {
    const s = await credentialRefStatus('anthropic-1', cfg({ claudeKeyCommand: 'show-secret c' }), new FakeIO({}));
    expect(s).toMatchObject({ legacy: true, command: 'show-secret c', selected: 'command' });
  });
});
