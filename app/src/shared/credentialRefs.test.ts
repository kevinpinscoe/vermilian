import { describe, it, expect } from 'vitest';
import {
  LEGACY_CREDENTIAL_REFS,
  blobFilenameFor,
  checkCredentialValue,
  credentialFailure,
  refFromBlobFilename,
  sanitiseCredentialSources,
  selectSource,
  sourcesFor,
} from './credentialRefs';
import { DEFAULT_CONFIG } from './config';

describe('legacy references', () => {
  it('are exactly youtrack-1, anthropic-1 and jira-1, mapped to the legacy blobs', () => {
    expect(Object.keys(LEGACY_CREDENTIAL_REFS).sort()).toEqual(['anthropic-1', 'jira-1', 'youtrack-1']);
    expect(blobFilenameFor('youtrack-1')).toBe('youtrack.token.bin');
    expect(blobFilenameFor('anthropic-1')).toBe('claude.key.bin');
    expect(blobFilenameFor('jira-1')).toBe('jira.token.bin');
  });

  it('do not treat inherited object keys as legacy', () => {
    expect(blobFilenameFor('constructor')).toBe('ref-constructor.bin');
    expect(sourcesFor('constructor', DEFAULT_CONFIG)).toEqual({ command: '', file: '' });
  });
});

describe('per-reference blob filenames', () => {
  it('round-trip for custom references and never for legacy files', () => {
    expect(blobFilenameFor('anthropic-2')).toBe('ref-anthropic-2.bin');
    expect(refFromBlobFilename('ref-anthropic-2.bin')).toBe('anthropic-2');
    expect(refFromBlobFilename('claude.key.bin')).toBeNull();
    expect(refFromBlobFilename('ref-anthropic-1.bin')).toBeNull(); // legacy refs have no per-ref blob
    expect(refFromBlobFilename('ref-Bad Name.bin')).toBeNull();
    expect(refFromBlobFilename('ref-x.bin.tmp')).toBeNull();
  });
});

describe('selectSource', () => {
  it('picks the highest-priority configured source and skips only unconfigured ones', () => {
    expect(selectSource({ command: 'c', file: 'f' }, true)).toBe('command');
    expect(selectSource({ command: ' ', file: 'f' }, true)).toBe('file');
    expect(selectSource({ command: '', file: '' }, true)).toBe('safeStorage');
    expect(selectSource({ command: '', file: '' }, false)).toBeNull();
  });
});

describe('checkCredentialValue', () => {
  it('accepts one token and refuses empty, multi-line or oversized values', () => {
    expect(checkCredentialValue('perm:abc.def==')).toBe('ok');
    expect(checkCredentialValue('')).toBe('empty');
    expect(checkCredentialValue('a\nb')).toBe('invalid');
    expect(checkCredentialValue('a b')).toBe('invalid');
    expect(checkCredentialValue('y'.repeat(4097))).toBe('invalid');
  });
});

describe('credentialFailure', () => {
  it('names the workspace, the reference and the source kind', () => {
    const f = credentialFailure('workspace-a', 'anthropic-2', 'safeStorage', 'blob-unreadable');
    expect(f).toEqual({
      workspaceId: 'workspace-a',
      credentialRef: 'anthropic-2',
      source: 'safeStorage',
      reason: 'blob-unreadable',
      message: 'The saved (safeStorage) credential for credential anthropic-2 (workspace workspace-a) could not be read or decrypted.',
    });
  });

  it('does not echo malformed input that could carry a secret', () => {
    const f = credentialFailure('ws sk-ant-secret', 'sk-ant-secret-ref with space', 'command', 'command-failed');
    expect(JSON.stringify(f)).not.toContain('sk-ant');
    expect(f.reason).toBe('invalid-reference');
  });
});

describe('sanitiseCredentialSources', () => {
  it('keeps well-formed custom references and drops legacy, malformed and empty entries', () => {
    expect(
      sanitiseCredentialSources({
        'anthropic-2': { command: ' show x ', file: '' },
        'anthropic-1': { command: 'legacy is not configured here', file: '' },
        'Bad Ref': { command: 'x', file: '' },
        'empty-1': { command: '', file: '  ' },
        'weird-1': { command: 42, file: ['x'] },
        'arr-1': ['x'],
      }),
    ).toEqual({ 'anthropic-2': { command: 'show x', file: '' } });
  });

  it('returns an empty map for anything that is not an object', () => {
    expect(sanitiseCredentialSources(undefined)).toEqual({});
    expect(sanitiseCredentialSources('x')).toEqual({});
    expect(sanitiseCredentialSources([])).toEqual({});
  });
});
