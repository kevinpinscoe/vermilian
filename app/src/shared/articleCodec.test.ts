import { describe, it, expect } from 'vitest';
import {
  parseArticleConfig,
  serialiseArticleConfig,
  mergeRemoteConfig,
} from './articleCodec';
import {
  ARTICLE_CONFIG_VERSION,
  emptyArticleConfig,
  defaultBoardConfig,
  type ArticleFullConfig,
} from './boardConfig';

describe('parseArticleConfig', () => {
  it('parses a well-formed config body', () => {
    const cfg: ArticleFullConfig = {
      version: 1,
      workspaces: [],
      activeWorkspaceId: 'ws-1',
      boards: { 'p-1': defaultBoardConfig('p-1') },
      dismissals: { 'ws-1:ISS-1': { workspace: 'ws-1', issueId: 'ISS-1', dismissedWeekOf: '2026-09-14' } },
    };
    expect(parseArticleConfig(JSON.stringify(cfg))).toEqual(cfg);
  });

  it('strips a ```json code fence before parsing', () => {
    const body = '```json\n{"version":1,"activeWorkspaceId":"ws-2"}\n```';
    const out = parseArticleConfig(body);
    expect(out.activeWorkspaceId).toBe('ws-2');
    expect(out.version).toBe(1);
  });

  it('strips a bare ``` code fence', () => {
    const out = parseArticleConfig('```\n{"activeWorkspaceId":"ws-3"}\n```');
    expect(out.activeWorkspaceId).toBe('ws-3');
  });

  it('fills defaults for missing fields', () => {
    const out = parseArticleConfig('{}');
    expect(out).toEqual({
      version: ARTICLE_CONFIG_VERSION,
      workspaces: [],
      activeWorkspaceId: '',
      boards: {},
      dismissals: {},
    });
  });

  it('falls back to an empty config on malformed JSON', () => {
    expect(parseArticleConfig('not json at all')).toEqual(emptyArticleConfig());
    expect(parseArticleConfig('')).toEqual(emptyArticleConfig());
  });
});

describe('serialiseArticleConfig', () => {
  it('round-trips through parse', () => {
    const cfg = emptyArticleConfig();
    expect(parseArticleConfig(serialiseArticleConfig(cfg))).toEqual(cfg);
  });

  it('pretty-prints with two-space indentation', () => {
    expect(serialiseArticleConfig(emptyArticleConfig())).toContain('\n  "version"');
  });
});

describe('mergeRemoteConfig', () => {
  const remote: ArticleFullConfig = {
    version: 1,
    workspaces: [{ id: 'r-ws', name: 'Remote', order: 0, folders: [] }],
    activeWorkspaceId: 'r-ws',
    boards: {
      shared: { boardId: 'shared', views: [], activeViewId: 'a', colors: { Status: { x: '#111' } } },
      'remote-only': { boardId: 'remote-only', views: [], activeViewId: 'a', colors: {} },
    },
    dismissals: {
      'r-ws:ISS-SHARED': { workspace: 'r-ws', issueId: 'ISS-SHARED', dismissedWeekOf: '2026-09-07' },
      'r-ws:ISS-REMOTE': { workspace: 'r-ws', issueId: 'ISS-REMOTE', dismissedWeekOf: '2026-09-07' },
    },
  };
  const local: ArticleFullConfig = {
    version: 1,
    workspaces: [{ id: 'l-ws', name: 'Local', order: 0, folders: [] }],
    activeWorkspaceId: 'l-ws',
    boards: {
      shared: { boardId: 'shared', views: [], activeViewId: 'b', colors: { Status: { x: '#999' } } },
      'local-only': { boardId: 'local-only', views: [], activeViewId: 'a', colors: {} },
    },
    dismissals: {
      'r-ws:ISS-SHARED': { workspace: 'r-ws', issueId: 'ISS-SHARED', dismissedWeekOf: '2026-09-14' },
      'l-ws:ISS-LOCAL': { workspace: 'l-ws', issueId: 'ISS-LOCAL', dismissedWeekOf: '2026-09-14' },
    },
  };

  it('takes workspaces and activeWorkspaceId from the remote (base)', () => {
    const merged = mergeRemoteConfig(remote, local);
    expect(merged.activeWorkspaceId).toBe('r-ws');
    expect(merged.workspaces).toEqual(remote.workspaces);
  });

  it('overlays local boards on top of remote boards (local wins per key)', () => {
    const merged = mergeRemoteConfig(remote, local);
    expect(Object.keys(merged.boards).sort()).toEqual(['local-only', 'remote-only', 'shared']);
    expect(merged.boards.shared.activeViewId).toBe('b'); // local wins
    expect(merged.boards['remote-only']).toBeDefined(); // remote-only preserved
  });

  it('overlays local dismissals on top of remote dismissals (local wins per key)', () => {
    const merged = mergeRemoteConfig(remote, local);
    expect(Object.keys(merged.dismissals).sort()).toEqual(['l-ws:ISS-LOCAL', 'r-ws:ISS-REMOTE', 'r-ws:ISS-SHARED']);
    expect(merged.dismissals['r-ws:ISS-SHARED'].dismissedWeekOf).toBe('2026-09-14'); // local wins
    expect(merged.dismissals['r-ws:ISS-REMOTE']).toBeDefined(); // remote-only preserved
  });

  it('does not mutate either input', () => {
    const remoteKeys = Object.keys(remote.boards).length;
    const localKeys = Object.keys(local.boards).length;
    mergeRemoteConfig(remote, local);
    expect(Object.keys(remote.boards)).toHaveLength(remoteKeys);
    expect(Object.keys(local.boards)).toHaveLength(localKeys);
  });
});
