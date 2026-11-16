import { describe, it, expect, vi, beforeEach } from 'vitest';

// An in-memory credentials directory. safeStorage "encrypts" by prefixing, and
// refuses to decrypt anything without the prefix (a blob from another key).
const files = vi.hoisted(() => new Map<string, Buffer>());

vi.mock('electron', () => ({
  app: { getPath: () => '/ud' },
  safeStorage: {
    isEncryptionAvailable: vi.fn(),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    getSelectedStorageBackend: vi.fn(),
  },
}));

vi.mock('node:fs', () => {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    promises: {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (p: string, d: Buffer) => void files.set(p, Buffer.from(d))),
      rename: vi.fn(async (a: string, b: string) => {
        const d = files.get(a);
        if (!d) throw enoent();
        files.set(b, d);
        files.delete(a);
      }),
      readFile: vi.fn(async (p: string, enc?: string) => {
        const d = files.get(p);
        if (!d) throw enoent();
        return enc ? d.toString('utf-8') : d;
      }),
      access: vi.fn(async (p: string) => {
        if (!files.has(p)) throw enoent();
      }),
      unlink: vi.fn(async (p: string) => {
        if (!files.delete(p)) throw enoent();
      }),
      readdir: vi.fn(async () => [...files.keys()].map((k) => k.split('/').pop())),
    },
  };
});

vi.mock('node:child_process', () => ({
  // promisify(exec) — fail every command.
  exec: (_cmd: string, _opts: unknown, cb: (e: Error | null, r?: unknown) => void) => cb(new Error('exit 1')),
}));

import { safeStorage } from 'electron';
import {
  saveSecret,
  loadSecret,
  loadSecretWithSources,
  resolveLegacySecret,
  legacySecretStorage,
  encryptPlaintextSecrets,
} from './credentials';

const BIN = '/ud/credentials/youtrack.token.bin';
const TXT = '/ud/credentials/youtrack.token.txt';
const enc = (s: string) => Buffer.from(`enc:${s}`);
const mocked = vi.mocked(safeStorage);

function encryptionWorks(works: boolean) {
  mocked.isEncryptionAvailable.mockReturnValue(works);
  mocked.encryptString.mockImplementation((s: string) => {
    if (!works) throw new Error('errSecMissingEntitlement');
    return enc(s);
  });
}

beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
  mocked.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
  mocked.decryptString.mockImplementation((b: Buffer) => {
    const s = b.toString('utf-8');
    if (!s.startsWith('enc:')) throw new Error('decrypt failed');
    return s.slice(4);
  });
  encryptionWorks(true);
});

describe('saveSecret', () => {
  it('writes the encrypted blob and removes any plain-text copy', async () => {
    files.set(TXT, Buffer.from('old-plain'));
    expect(await saveSecret('youtrack.token.bin', ' new-token ')).toMatchObject({ ok: true });
    expect(files.get(BIN)).toEqual(enc('new-token'));
    expect(files.has(TXT)).toBe(false);
  });

  it('refuses the save, writing nothing, when encryptString throws', async () => {
    mocked.encryptString.mockImplementation(() => {
      throw new Error('errSecMissingEntitlement');
    });
    files.set(BIN, enc('old-token'));
    expect((await saveSecret('youtrack.token.bin', 'new-token')).ok).toBe(false);
    expect(files.has(TXT)).toBe(false);
    expect(files.get(BIN)).toEqual(enc('old-token'));
  });

  it('refuses the save when encryption is unavailable', async () => {
    encryptionWorks(false);
    expect((await saveSecret('youtrack.token.bin', 'new-token')).ok).toBe(false);
    expect(files.size).toBe(0);
  });
});

describe('loadSecret', () => {
  it('returns the newer plain-text value, not a stale encrypted blob', async () => {
    files.set(BIN, enc('old-token'));
    files.set(TXT, Buffer.from('new-token\n'));
    expect(await loadSecret('youtrack.token.bin')).toBe('new-token');
  });

  it('returns null for a blob that cannot be decrypted', async () => {
    files.set(BIN, Buffer.from('from-another-key'));
    expect(await loadSecret('youtrack.token.bin')).toBeNull();
  });
});

describe('loadSecretWithSources — the configured source only', () => {
  it('does not fall through to the blob when the command fails', async () => {
    files.set(BIN, enc('blob-token'));
    expect(await loadSecretWithSources('youtrack.token.bin', 'op read x', '')).toBeNull();
  });

  it('does not fall through to the blob when the file is missing', async () => {
    files.set(BIN, enc('blob-token'));
    expect(await loadSecretWithSources('youtrack.token.bin', '', '/nope')).toBeNull();
  });

  it('reads the configured file', async () => {
    files.set('/tok', Buffer.from('file-token\n'));
    expect(await loadSecretWithSources('youtrack.token.bin', '', '/tok')).toBe('file-token');
  });
});

describe('resolveLegacySecret', () => {
  it('names the source that was used', async () => {
    files.set(BIN, enc('blob-token'));
    expect(await resolveLegacySecret('youtrack.token.bin', '', '')).toEqual({
      ok: true,
      value: 'blob-token',
      source: 'safeStorage',
    });
  });

  it('names the failing source without echoing the command', async () => {
    const r = await resolveLegacySecret('youtrack.token.bin', 'op read secret-path', '');
    expect(r).toMatchObject({ ok: false, source: 'command', reason: 'command-failed' });
    expect(!r.ok && r.message).not.toContain('secret-path');
  });

  it('reports an undecryptable blob', async () => {
    files.set(BIN, Buffer.from('from-another-key'));
    expect(await resolveLegacySecret('youtrack.token.bin', '', '')).toMatchObject({
      ok: false,
      source: 'safeStorage',
      reason: 'blob-unreadable',
    });
  });
});

describe('legacySecretStorage', () => {
  it.each([
    ['none', {}],
    ['encrypted', { [BIN]: enc('t') }],
    ['undecryptable', { [BIN]: Buffer.from('x') }],
    ['plaintext', { [BIN]: enc('t'), [TXT]: Buffer.from('t2') }],
  ])('%s', async (expected, seed) => {
    for (const [k, v] of Object.entries(seed)) files.set(k, v);
    expect(await legacySecretStorage('youtrack.token.bin')).toBe(expected);
  });
});

describe('encryptPlaintextSecrets', () => {
  it('replaces a stale blob with the encrypted plain-text value and deletes the .txt', async () => {
    files.set(BIN, Buffer.from('from-another-key'));
    files.set(TXT, Buffer.from('new-token\n'));
    expect(await encryptPlaintextSecrets()).toEqual({ encrypted: ['youtrack.token.bin'], failed: [] });
    expect(files.get(BIN)).toEqual(enc('new-token'));
    expect(files.has(TXT)).toBe(false);
  });

  it('leaves the .txt in place when encryption is unavailable', async () => {
    encryptionWorks(false);
    files.set(TXT, Buffer.from('new-token'));
    expect(await encryptPlaintextSecrets()).toEqual({ encrypted: [], failed: ['youtrack.token.bin'] });
    expect(files.has(TXT)).toBe(true);
  });

  it('keeps the .txt when the new blob does not decrypt back to the same value', async () => {
    mocked.decryptString.mockReturnValue('something-else');
    files.set(TXT, Buffer.from('new-token'));
    expect((await encryptPlaintextSecrets()).failed).toEqual(['youtrack.token.bin']);
    expect(files.has(TXT)).toBe(true);
  });

  it('does nothing when there is no plain-text copy', async () => {
    files.set(BIN, enc('t'));
    expect(await encryptPlaintextSecrets()).toEqual({ encrypted: [], failed: [] });
  });
});
