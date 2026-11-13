// The real source reads (credentialSourceIO) and the per-reference blob store
// against a temporary directory, with safeStorage replaced by a reversible
// fake. VERM-45.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ userData: '', encryptionAvailable: true }));

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  safeStorage: {
    isEncryptionAvailable: () => state.encryptionAvailable,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => {
      const s = b.toString();
      if (!s.startsWith('enc:')) throw new Error('cannot decrypt');
      return s.slice(4);
    },
  },
}));

import {
  credentialSourceIO as io,
  saveCredentialRefSecret,
  clearCredentialRefSecret,
  listCredentialRefBlobs,
} from './credentials';
import { resolveWorkspaceCredential } from './credentialResolver';
import { DEFAULT_CONFIG } from '../../shared/config';

let credDir: string;

beforeEach(() => {
  state.userData = mkdtempSync(path.join(tmpdir(), 'verm45-'));
  state.encryptionAvailable = true;
  credDir = path.join(state.userData, 'credentials');
  mkdirSync(credDir, { recursive: true });
});

afterEach(() => rmSync(state.userData, { recursive: true, force: true }));

describe('credentialSourceIO', () => {
  it('runs a command and reports failure without output', async () => {
    expect(await io.runCommand('printf tok-1')).toEqual({ ok: true, stdout: 'tok-1' });
    expect(await io.runCommand('echo leaked-output; exit 3')).toEqual({ ok: false });
  });

  it('reads a file and reports a missing one as a failure', async () => {
    const f = path.join(state.userData, 'key.txt');
    writeFileSync(f, 'file-tok\n');
    expect(await io.readFile(f)).toEqual({ ok: true, content: 'file-tok\n' });
    expect(await io.readFile(path.join(state.userData, 'missing'))).toEqual({ ok: false });
  });

  it('decrypts a blob and fails on an undecryptable one', async () => {
    writeFileSync(path.join(credDir, 'ref-ai-2.bin'), 'enc:blob-tok');
    writeFileSync(path.join(credDir, 'ref-ai-3.bin'), 'garbage');
    expect(await io.readBlob('ref-ai-2.bin', false)).toEqual({ ok: true, value: 'blob-tok' });
    expect(await io.readBlob('ref-ai-3.bin', false)).toEqual({ ok: false });
  });

  it('a legacy reference may use its plain-text fallback file, a custom one never', async () => {
    writeFileSync(path.join(credDir, 'claude.key.txt'), 'plain-legacy');
    writeFileSync(path.join(credDir, 'ref-ai-4.txt'), 'plain-custom');
    expect(await io.blobPresent('claude.key.bin', true)).toBe(true);
    expect(await io.readBlob('claude.key.bin', true)).toEqual({ ok: true, value: 'plain-legacy' });
    expect(await io.blobPresent('ref-ai-4.bin', false)).toBe(false);
    expect(await io.readBlob('ref-ai-4.bin', false)).toEqual({ ok: false });
  });

  it('an undecryptable legacy blob fails instead of falling back to its plain-text file', async () => {
    writeFileSync(path.join(credDir, 'claude.key.bin'), 'garbage');
    writeFileSync(path.join(credDir, 'claude.key.txt'), 'plain-legacy');
    expect(await io.readBlob('claude.key.bin', true)).toEqual({ ok: false });
  });
});

describe('per-reference blob store', () => {
  it('saves an encrypted blob that the resolver then uses, and lists it', async () => {
    expect(await saveCredentialRefSecret('anthropic-2', '  new-key  ')).toEqual({ ok: true });
    expect(readFileSync(path.join(credDir, 'ref-anthropic-2.bin'), 'utf8')).toBe('enc:new-key');
    expect(await listCredentialRefBlobs()).toEqual(['anthropic-2']);
    const r = await resolveWorkspaceCredential({ workspaceId: 'ws-a', credentialRef: 'anthropic-2' }, DEFAULT_CONFIG, io);
    expect(r).toEqual({ ok: true, value: 'new-key', credentialRef: 'anthropic-2', source: 'safeStorage' });
  });

  it('refuses legacy references and leaves their files untouched', async () => {
    writeFileSync(path.join(credDir, 'claude.key.bin'), 'enc:legacy');
    expect(await saveCredentialRefSecret('anthropic-1', 'other')).toEqual({ ok: false, reason: 'legacy-reference' });
    expect(await clearCredentialRefSecret('anthropic-1')).toEqual({ ok: false, reason: 'legacy-reference' });
    expect(readFileSync(path.join(credDir, 'claude.key.bin'), 'utf8')).toBe('enc:legacy');
    expect(readdirSync(credDir)).toEqual(['claude.key.bin']);
  });

  it('refuses malformed references and values', async () => {
    expect(await saveCredentialRefSecret('../claude.key', 'x')).toEqual({ ok: false, reason: 'invalid-reference' });
    expect(await saveCredentialRefSecret('ai-5', '')).toEqual({ ok: false, reason: 'invalid-value' });
    expect(await saveCredentialRefSecret('ai-5', 'two\nlines')).toEqual({ ok: false, reason: 'invalid-value' });
    expect(readdirSync(credDir)).toEqual([]);
  });

  it('never writes plain text when safeStorage cannot encrypt', async () => {
    state.encryptionAvailable = false;
    expect(await saveCredentialRefSecret('ai-6', 'k')).toEqual({ ok: false, reason: 'encryption-unavailable' });
    expect(readdirSync(credDir)).toEqual([]);
  });

  it('clears only the named reference’s blob', async () => {
    await saveCredentialRefSecret('ai-7', 'k7');
    await saveCredentialRefSecret('ai-8', 'k8');
    expect(await clearCredentialRefSecret('ai-7')).toEqual({ ok: true });
    expect(await clearCredentialRefSecret('ai-7')).toEqual({ ok: true }); // already absent
    expect(existsSync(path.join(credDir, 'ref-ai-7.bin'))).toBe(false);
    expect(existsSync(path.join(credDir, 'ref-ai-8.bin'))).toBe(true);
  });
});
