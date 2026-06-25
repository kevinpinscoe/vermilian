/**
 * Regression test for the safeStorage persistence bug:
 *   If safeStorage.encryptString() throws (e.g. macOS Keychain access denied
 *   on unsigned/dev builds or macOS 26+), saveSecret was propagating the
 *   exception instead of returning { ok: false }. The caller (handleSave) had
 *   no try-catch, so the save silently aborted and the token was never written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-user-data' },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  },
}));

vi.mock('node:fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    access: vi.fn(),
  },
}));

// Dynamic import after mocks are hoisted
const getModule = () => import('./credentials');

describe('saveSecret', () => {
  let electron: typeof import('electron');
  let fs: { promises: Record<string, ReturnType<typeof vi.fn>> };

  beforeEach(async () => {
    vi.resetAllMocks();
    electron = await import('electron');
    const fsModule = await import('node:fs');
    fs = fsModule as unknown as typeof fs;

    // Default: encryption available, all fs ops succeed
    (electron.safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.promises.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.promises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.promises.rename as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('returns { ok: false } instead of throwing when encryptString throws', async () => {
    (electron.safeStorage.encryptString as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('errSecMissingEntitlement: Keychain access denied');
    });

    const { saveSecret } = await getModule();
    // Must NOT throw — must return { ok: false }
    const result = await saveSecret('test.bin', 'my-token');
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } when isEncryptionAvailable returns false', async () => {
    (electron.safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { saveSecret } = await getModule();
    const result = await saveSecret('test.bin', 'my-token');
    expect(result.ok).toBe(false);
  });

  it('returns { ok: true } when encryption and file write succeed', async () => {
    const fakeBuffer = Buffer.from('encrypted-data');
    (electron.safeStorage.encryptString as ReturnType<typeof vi.fn>).mockReturnValue(fakeBuffer);

    const { saveSecret } = await getModule();
    const result = await saveSecret('test.bin', 'my-token');
    expect(result).toEqual({ ok: true });
  });
});
