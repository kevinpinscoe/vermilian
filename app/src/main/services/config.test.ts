// Per-reference credential sources are sanitised whenever app-config.json is
// read or written (VERM-45).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }));

import { readConfig, writeConfig } from './config';

beforeEach(() => {
  state.userData = mkdtempSync(path.join(tmpdir(), 'verm45-cfg-'));
});
afterEach(() => rmSync(state.userData, { recursive: true, force: true }));

const file = () => path.join(state.userData, 'app-config.json');

describe('credentialSources in app-config.json', () => {
  it('defaults to an empty map', async () => {
    expect((await readConfig()).credentialSources).toEqual({});
  });

  it('drops legacy, malformed and empty entries on read, and keeps the legacy fields', async () => {
    writeFileSync(
      file(),
      JSON.stringify({
        claudeKeyCommand: 'show legacy',
        credentialSources: {
          'anthropic-2': { command: 'show two', file: '' },
          'anthropic-1': { command: 'must not shadow legacy', file: '' },
          'Bad Ref': { command: 'x', file: '' },
          'empty-1': { command: '', file: '' },
        },
      }),
    );
    const cfg = await readConfig();
    expect(cfg.credentialSources).toEqual({ 'anthropic-2': { command: 'show two', file: '' } });
    expect(cfg.claudeKeyCommand).toBe('show legacy');
  });

  it('writes only sanitised entries, and other settings survive', async () => {
    await writeConfig({ claudeKeyFile: '/legacy/path' });
    await writeConfig({
      credentialSources: {
        'jira-2': { command: '', file: '/x' },
        'jira-1': { command: 'nope', file: '' },
      },
    });
    const saved = JSON.parse(readFileSync(file(), 'utf8'));
    expect(saved.credentialSources).toEqual({ 'jira-2': { command: '', file: '/x' } });
    expect(saved.claudeKeyFile).toBe('/legacy/path');
  });
});
