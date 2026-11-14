// The stand-up flow with every dependency faked (VERM-48): which workspace's
// projects, YouTrack connection and Anthropic key each stand-up uses.

import { describe, expect, it, vi } from 'vitest';
import type { StandupIssues } from '../api/youtrack';
import { AI_WORKSPACE_CHANGED_MESSAGE, type WorkspaceAiOperation } from './workspaceAiKey';
import type { WorkspaceYouTrackConnection } from './workspaceYouTrack';
import { generateWorkspaceStandup, type WorkspaceStandupDeps } from './workspaceStandup';
import type { StandupWorkspace } from '../../shared/standup';
import { JIRA_STANDUP_UNSUPPORTED_MESSAGE } from '../../shared/standup';

// Fictional values only. Tokens are markers the tests look for.
const PROJECTS = [
  { id: '0-1', shortName: 'HOME' },
  { id: '0-2', shortName: 'WORK' },
];
const ISSUES: StandupIssues = {
  done: [{ idReadable: 'HOME-1', summary: 'x', status: 'Done', priority: null, notes: null, updatedMs: 0, loggedMinutesToday: 0 }],
  inProgress: [],
  blocked: [],
};
const WORKSPACES: Record<string, StandupWorkspace> = {
  'ws-home': { id: 'ws-home', backend: { kind: 'youtrack', serverUrl: 'https://yt.example.com', credentialRef: 'youtrack-home' }, folders: [{ projectIds: ['0-1'] }] },
  'ws-work': { id: 'ws-work', backend: { kind: 'youtrack', serverUrl: 'https://yt.example.com', credentialRef: 'youtrack-work' }, folders: [{ projectIds: ['0-2'] }] },
  'ws-jira': { id: 'ws-jira', backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', credentialRef: 'jira-1' }, folders: [{ projectIds: ['DEMO'] }] },
  'ws-broken': { id: 'ws-broken', backend: { kind: 'youtrack', serverUrl: 'https://yt.example.com', credentialRef: 'youtrack-broken' }, folders: [{ projectIds: ['0-1'] }] },
};
const TOKENS: Record<string, WorkspaceYouTrackConnection> = {
  'ws-home': { ok: true, url: 'https://yt.example.com', token: 'fictional-home-token' },
  'ws-work': { ok: true, url: 'https://yt.example.com', token: 'fictional-work-token' },
  'ws-broken': { ok: false, error: 'YouTrack is unavailable for this workspace: The command for credential youtrack-broken (workspace ws-broken) failed to run or exited with an error.' },
};

function deps(activeId: string, over: Partial<WorkspaceStandupDeps> = {}) {
  const reads: Array<{ token: string; what: string; arg?: unknown }> = [];
  const anthropic = vi.fn(async (_key: string, _issues: StandupIssues) => 'report');
  let switched = false;
  const op: WorkspaceAiOperation = {
    ok: true,
    workspaceId: activeId,
    send: async (request) => (switched ? { ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE } : { ok: true, value: await request('fictional-anthropic-key') }),
  };
  const d: WorkspaceStandupDeps = {
    storage: 'per-workspace',
    beginAi: async () => op,
    loadWorkspace: async (id) => WORKSPACES[id] ?? null,
    connectWorkspace: async (id) => TOKENS[id] ?? { ok: false, error: 'not found' },
    legacyConnection: async () => ({ ok: true, url: 'https://yt.example.com', token: 'fictional-settings-token' }),
    tracker: (_url, token) => ({
      getProjects: async () => { reads.push({ token, what: 'projects' }); return PROJECTS; },
      getIssuesForStandup: async (names) => { reads.push({ token, what: 'issues', arg: names }); return ISSUES; },
    }),
    generate: anthropic,
    cutoffMs: 0,
    ...over,
  };
  return { d, reads, anthropic, switchNow: () => { switched = true; } };
}

describe('generateWorkspaceStandup — per-workspace storage', () => {
  it('two workspaces on the same server use only their own credential and projects', async () => {
    for (const [id, token, names] of [['ws-home', 'fictional-home-token', ['HOME']], ['ws-work', 'fictional-work-token', ['WORK']]] as const) {
      const { d, reads } = deps(id);
      await expect(generateWorkspaceStandup(d)).resolves.toMatchObject({ ok: true, markdown: 'report' });
      expect(new Set(reads.map((r) => r.token))).toEqual(new Set([token]));
      expect(reads.find((r) => r.what === 'issues')?.arg).toEqual(names);
    }
  });

  it('a credential that cannot resolve stops before any YouTrack read, with no fallback to the Settings token', async () => {
    const legacyConnection = vi.fn();
    const { d, reads, anthropic } = deps('ws-broken', { legacyConnection });
    const r = await generateWorkspaceStandup(d);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/youtrack-broken/);
    expect(reads).toEqual([]);
    expect(legacyConnection).not.toHaveBeenCalled();
    expect(anthropic).not.toHaveBeenCalled();
  });

  it('a Jira or missing workspace is refused before any connection or read', async () => {
    for (const id of ['ws-jira', 'ws-gone']) {
      const connectWorkspace = vi.fn();
      const { d, reads } = deps(id, { connectWorkspace });
      const r = await generateWorkspaceStandup(d);
      expect(r.ok).toBe(false);
      if (id === 'ws-jira') expect(r.error).toBe(JIRA_STANDUP_UNSUPPORTED_MESSAGE);
      expect(connectWorkspace).not.toHaveBeenCalled();
      expect(reads).toEqual([]);
    }
  });

  it('every read uses the workspace the AI operation resolved its key for', async () => {
    const loadWorkspace = vi.fn(async (id: string) => WORKSPACES[id] ?? null);
    const connectWorkspace = vi.fn(async (id: string) => TOKENS[id]);
    const { d } = deps('ws-work', { loadWorkspace, connectWorkspace });
    await generateWorkspaceStandup(d);
    expect(loadWorkspace).toHaveBeenCalledWith('ws-work');
    expect(connectWorkspace).toHaveBeenCalledWith('ws-work');
  });

  it('a switch while issues load is refused before Anthropic, and no stale report is returned', async () => {
    const box = deps('ws-home');
    box.d.tracker = (_url, token) => ({
      getProjects: async () => PROJECTS,
      getIssuesForStandup: async () => { box.switchNow(); void token; return ISSUES; },
    });
    await expect(generateWorkspaceStandup(box.d)).resolves.toEqual({ ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE });
    expect(box.anthropic).not.toHaveBeenCalled();
  });

  it('no credential value appears in any result', async () => {
    for (const id of ['ws-home', 'ws-broken', 'ws-jira']) {
      const r = await generateWorkspaceStandup(deps(id).d);
      expect(JSON.stringify(r)).not.toMatch(/fictional-.*-token|fictional-anthropic-key/);
    }
  });
});

describe('generateWorkspaceStandup — legacy storage (before VERM-53)', () => {
  it('uses the global connection and the active legacy workspace\'s projects, never a workspace credential', async () => {
    const connectWorkspace = vi.fn();
    const { d, reads } = deps('ws-work', { storage: 'legacy', connectWorkspace, loadWorkspace: async () => ({ id: 'ws-work', backend: null, folders: [{ projectIds: ['0-2'] }] }) });
    await expect(generateWorkspaceStandup(d)).resolves.toMatchObject({ ok: true });
    expect(new Set(reads.map((r) => r.token))).toEqual(new Set(['fictional-settings-token']));
    expect(reads.find((r) => r.what === 'issues')?.arg).toEqual(['WORK']);
    expect(connectWorkspace).not.toHaveBeenCalled();
  });

  it('is refused when YouTrack is not configured', async () => {
    const { d } = deps('ws-work', { storage: 'legacy', legacyConnection: async () => ({ ok: false, error: 'YouTrack not configured.' }) });
    await expect(generateWorkspaceStandup(d)).resolves.toEqual({ ok: false, error: 'YouTrack not configured.' });
  });
});
