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
    unlink: vi.fn().mockResolvedValue(undefined),
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
    // resetAllMocks() above wipes the module-mock implementation, so restore it here.
    // On Linux isSecure() depends on this backend being a recognised secure one;
    // without it saveSecret takes the Linux early-return and the fallback path never runs.
    (electron.safeStorage.getSelectedStorageBackend as ReturnType<typeof vi.fn>).mockReturnValue('gnome_libsecret');
    (fs.promises.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.promises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.promises.rename as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.promises.unlink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('returns { ok: true, secure: true } when encryption succeeds', async () => {
    const fakeBuffer = Buffer.from('encrypted-data');
    (electron.safeStorage.encryptString as ReturnType<typeof vi.fn>).mockReturnValue(fakeBuffer);

    const { saveSecret } = await getModule();
    const result = await saveSecret('test.bin', 'my-token');
    expect(result).toEqual({ ok: true, secure: true });
  });

  it('falls back to plain-text file and returns { ok: true, secure: false } when encryptString throws', async () => {
    // macOS 26: encryptString() throws even though isEncryptionAvailable() may return true.
    (electron.safeStorage.encryptString as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('errSecMissingEntitlement: Keychain access denied');
    });

    const { saveSecret } = await getModule();
    const result = await saveSecret('test.bin', 'my-token');
    expect(result.ok).toBe(true);
    expect(result.secure).toBe(false);
    // Plain-text file should have been written
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('test.txt'),
      expect.any(Buffer),
      expect.objectContaining({ mode: 0o600 }),
    );
  });

  it('returns { ok: false } when both encryption and plaintext write fail', async () => {
    (electron.safeStorage.encryptString as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Encryption not available');
    });
    (fs.promises.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('EACCES'));

    const { saveSecret } = await getModule();
    const result = await saveSecret('test.bin', 'my-token');
    expect(result.ok).toBe(false);
  });
});
