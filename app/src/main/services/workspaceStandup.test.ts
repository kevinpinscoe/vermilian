// The stand-up flow with every dependency faked (VERM-48): which workspace's
// projects, YouTrack connection and Anthropic key each stand-up uses.

import { describe, expect, it, vi } from 'vitest';
import type { StandupIssues } from '../api/youtrack';
import { AI_WORKSPACE_CHANGED_MESSAGE, type WorkspaceAiOperation } from './workspaceAiKey';
import type { WorkspaceYouTrackConnection } from './workspaceYouTrack';
import { DAILY_REVIEW_NOT_ACTIVE_MESSAGE, generateWorkspaceStandup, getWorkspaceDailyReview, type WorkspaceDailyReviewDeps, type WorkspaceStandupDeps } from './workspaceStandup';
import { parseYouTrackProjectFields } from '../../shared/youtrackProjectFields';
import type { StandupPlan } from '../../shared/youtrackStandup';
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
// Each project's Status field, as the field-configuration read returns it.
const statusField = (values: Array<[string, boolean]>) =>
  parseYouTrackProjectFields([
    { field: { name: 'Status' }, $type: 'StateProjectCustomField', bundle: { values: values.map(([name, isResolved], ordinal) => ({ name, isResolved, ordinal })) } },
  ]);
const METADATA = {
  HOME: statusField([['To do', false], ['In Progress', false], ['BLOCKED', false], ['Done', true], ['Wont do', true]]),
  WORK: statusField([['To do', false], ['In Progress', false], ['BLOCKED', false], ['Done', true]]),
} as Record<string, ReturnType<typeof statusField>>;
const shortNamesOf = (plan: Pick<StandupPlan, 'projects'>) => plan.projects.map((p) => p.shortName);

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
      getProjectFieldMetadata: async (name) => { reads.push({ token, what: 'metadata', arg: name }); return METADATA[name]; },
      getIssuesForStandup: async (plan) => { reads.push({ token, what: 'issues', arg: shortNamesOf(plan) }); return ISSUES; },
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
      getProjectFieldMetadata: async (name) => METADATA[name],
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

describe('status discovery and mapping (VERM-114)', () => {
  it('discovers each project\'s Status values on the workspace\'s own connection and returns incomplete-mapping warnings', async () => {
    const plans: Array<Pick<StandupPlan, 'projects'>> = [];
    const { d, reads } = deps('ws-home', {
      loadWorkspace: async () => ({
        ...WORKSPACES['ws-home'],
        // An override that leaves HOME with no blocked value.
        youtrackProjects: { HOME: { statusRoles: { BLOCKED: 'todo' } } },
      }),
    });
    const tracker = d.tracker;
    d.tracker = (url, token) => {
      const t = tracker(url, token);
      return { ...t, getIssuesForStandup: async (plan, cutoff) => { plans.push(plan); return t.getIssuesForStandup(plan, cutoff); } };
    };
    const r = await generateWorkspaceStandup(d);
    expect(r).toMatchObject({ ok: true, markdown: 'report' });
    expect(r.warnings).toEqual(['HOME: no Status value is mapped to blocked, so blocked issues from HOME are not shown.']);
    expect(reads.filter((x) => x.what === 'metadata').map((x) => [x.token, x.arg])).toEqual([['fictional-home-token', 'HOME']]);
    // Wont do is not an accomplishment by default; the other groups remain.
    expect(plans[0].projects[0].groups).toEqual({ 'In Progress': 'inProgress', Done: 'done' });
  });

  it('a project override can count Wont do as done', async () => {
    const plans: Array<Pick<StandupPlan, 'projects'>> = [];
    const { d } = deps('ws-home', {
      loadWorkspace: async () => ({ ...WORKSPACES['ws-home'], youtrackProjects: { HOME: { statusRoles: { 'Wont do': 'done' } } } }),
    });
    const tracker = d.tracker;
    d.tracker = (url, token) => ({ ...tracker(url, token), getIssuesForStandup: async (plan) => { plans.push(plan); return ISSUES; } });
    await generateWorkspaceStandup(d);
    expect(plans[0].projects[0].groups['Wont do']).toBe('done');
  });

  it('legacy storage ignores overrides and uses the derived defaults only', async () => {
    const plans: Array<Pick<StandupPlan, 'projects'>> = [];
    const { d } = deps('ws-home', {
      storage: 'legacy',
      loadWorkspace: async () => ({ id: 'ws-home', backend: null, folders: [{ projectIds: ['0-1'] }], youtrackProjects: { HOME: { statusRoles: { 'Wont do': 'done' } } } }),
    });
    const tracker = d.tracker;
    d.tracker = (url, token) => ({ ...tracker(url, token), getIssuesForStandup: async (plan) => { plans.push(plan); return ISSUES; } });
    await generateWorkspaceStandup(d);
    expect(plans[0].projects[0].groups['Wont do']).toBeUndefined();
  });

  it('a project whose configuration cannot be read is named and left out; the rest is still reported', async () => {
    const { d, reads } = deps('ws-home', {
      loadWorkspace: async () => ({ ...WORKSPACES['ws-home'], folders: [{ projectIds: ['0-1', '0-2'] }] }),
    });
    const tracker = d.tracker;
    d.tracker = (url, token) => {
      const t = tracker(url, token);
      return { ...t, getProjectFieldMetadata: async (name) => (name === 'WORK' ? Promise.reject(new Error('403')) : t.getProjectFieldMetadata(name)) };
    };
    const r = await generateWorkspaceStandup(d);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['WORK: its field configuration could not be read, so it is left out of this stand-up.']);
    expect(reads.find((x) => x.what === 'issues')?.arg).toEqual(['HOME']);
  });
});

// Daily Review shares the stand-up's reader (VERM-114). Under per-workspace
// storage both callers must use the active workspace's own connection for
// discovery and the issue read: this fails if either reaches the Settings
// connection.
describe('Stand-up and Daily Review — connection isolation (VERM-114)', () => {
  function dailyDeps(activeId: string, over: Partial<WorkspaceDailyReviewDeps> = {}) {
    const { d, reads } = deps(activeId);
    const dd: WorkspaceDailyReviewDeps = { ...d, activeWorkspaceId: async () => activeId, cutoffMs: 0, ...over };
    return { d: dd, reads, id: activeId };
  }

  it('per-workspace: neither caller uses the Settings connection for any read', async () => {
    const standupLegacy = vi.fn(async () => ({ ok: true as const, url: 'https://yt.example.com', token: 'fictional-settings-token' }));
    const s = deps('ws-work', { legacyConnection: standupLegacy });
    await expect(generateWorkspaceStandup(s.d)).resolves.toMatchObject({ ok: true });

    const reviewLegacy = vi.fn(async () => ({ ok: true as const, url: 'https://yt.example.com', token: 'fictional-settings-token' }));
    const r = dailyDeps('ws-work', { legacyConnection: reviewLegacy });
    await expect(getWorkspaceDailyReview(r.d, r.id)).resolves.toEqual({
      ok: true,
      workspaceId: 'ws-work',
      completed: [{ idReadable: 'HOME-1', summary: 'x', priority: null }],
      warnings: [],
    });

    for (const [legacy, reads] of [[standupLegacy, s.reads], [reviewLegacy, r.reads]] as const) {
      expect(legacy).not.toHaveBeenCalled();
      expect(new Set(reads.map((x) => x.what))).toEqual(new Set(['projects', 'metadata', 'issues']));
      expect(new Set(reads.map((x) => x.token))).toEqual(new Set(['fictional-work-token']));
    }
  });

  it('per-workspace: Daily Review with a broken workspace credential fails without falling back', async () => {
    const legacyConnection = vi.fn();
    const r = dailyDeps('ws-broken', { legacyConnection });
    const out = await getWorkspaceDailyReview(r.d, r.id);
    expect(out.ok).toBe(false);
    expect(legacyConnection).not.toHaveBeenCalled();
    expect(r.reads).toEqual([]);
  });

  it('legacy: Daily Review keeps the configured shared connection', async () => {
    const connectWorkspace = vi.fn();
    const r = dailyDeps('ws-work', { storage: 'legacy', connectWorkspace, loadWorkspace: async () => ({ id: 'ws-work', backend: null, folders: [{ projectIds: ['0-2'] }] }) });
    await expect(getWorkspaceDailyReview(r.d, r.id)).resolves.toMatchObject({ ok: true, workspaceId: 'ws-work' });
    expect(connectWorkspace).not.toHaveBeenCalled();
    expect(new Set(r.reads.map((x) => x.token))).toEqual(new Set(['fictional-settings-token']));
  });

  it('Daily Review shows only warnings that affect completed work', async () => {
    const r = dailyDeps('ws-home', {
      loadWorkspace: async () => ({ ...WORKSPACES['ws-home'], youtrackProjects: { HOME: { statusRoles: { BLOCKED: 'todo', Done: 'todo' } } } }),
    });
    const out = await getWorkspaceDailyReview(r.d, r.id);
    expect(out.warnings).toEqual(['HOME: no Status value is mapped to done, so done issues from HOME are not shown.']);
  });

  it('Daily Review refuses a Jira workspace, no workspace, and a workspace that does not exist', async () => {
    await expect(getWorkspaceDailyReview(dailyDeps('ws-jira').d, 'ws-jira')).resolves.toEqual({ ok: false, workspaceId: 'ws-jira', error: JIRA_STANDUP_UNSUPPORTED_MESSAGE });
    await expect(getWorkspaceDailyReview(dailyDeps('').d, '')).resolves.toMatchObject({ ok: false });
    const unknown = dailyDeps('ws-home');
    await expect(getWorkspaceDailyReview(unknown.d, 'ws-gone')).resolves.toMatchObject({ ok: false, workspaceId: 'ws-gone' });
    expect(unknown.reads).toEqual([]);
  });

  // A read may only start for the active workspace (VERM-114 review, round
  // 2): while B is active, a new request naming A is refused before A's
  // workspace is loaded or its credential resolved, so A's connection is
  // never used. A read that started while A was active still finishes.
  it('Daily Review refuses a request for an inactive workspace before resolving any credential or calling the tracker', async () => {
    for (const storage of ['per-workspace', 'legacy'] as const) {
      const loadWorkspace = vi.fn(async (id: string) => WORKSPACES[id] ?? null);
      const connectWorkspace = vi.fn(async (id: string) => TOKENS[id] ?? { ok: false as const, error: 'not found' });
      const legacyConnection = vi.fn(async () => ({ ok: true as const, url: 'https://yt.example.com', token: 'fictional-settings-token' }));
      const tracker = vi.fn();
      const r = dailyDeps('ws-work', { storage, loadWorkspace, connectWorkspace, legacyConnection, tracker });
      const out = await getWorkspaceDailyReview(r.d, 'ws-home');
      expect(out).toEqual({ ok: false, workspaceId: 'ws-home', refused: 'not-active', error: DAILY_REVIEW_NOT_ACTIVE_MESSAGE });
      expect(loadWorkspace).not.toHaveBeenCalled();
      expect(connectWorkspace).not.toHaveBeenCalled();
      expect(legacyConnection).not.toHaveBeenCalled();
      expect(tracker).not.toHaveBeenCalled();
      expect(r.reads).toEqual([]);
    }
  });

  it('Daily Review checks the active workspace once, when the read starts, so a read already under way finishes', async () => {
    let active = 'ws-home';
    const r = dailyDeps('ws-home', { activeWorkspaceId: async () => active });
    const inner = r.d.loadWorkspace;
    // The user switches to B while A's workspace is being loaded.
    r.d.loadWorkspace = async (id) => { active = 'ws-work'; return inner(id); };
    await expect(getWorkspaceDailyReview(r.d, 'ws-home')).resolves.toMatchObject({ ok: true, workspaceId: 'ws-home' });
    expect(new Set(r.reads.map((x) => x.token))).toEqual(new Set(['fictional-home-token']));
  });

  // The review is bound to the workspace it was asked for (VERM-114 review):
  // it reads that workspace, whichever is active by the time it runs, and the
  // answer names it so the renderer can refuse to file it under another.
  it('Daily Review reads the workspace it was asked for, with that workspace\'s connection, and names it', async () => {
    const home = dailyDeps('ws-home');
    const work = dailyDeps('ws-work');
    const [h, w] = await Promise.all([getWorkspaceDailyReview(home.d, 'ws-home'), getWorkspaceDailyReview(work.d, 'ws-work')]);
    expect(h).toMatchObject({ ok: true, workspaceId: 'ws-home' });
    expect(w).toMatchObject({ ok: true, workspaceId: 'ws-work' });
    expect(new Set(home.reads.map((x) => x.token))).toEqual(new Set(['fictional-home-token']));
    expect(new Set(work.reads.map((x) => x.token))).toEqual(new Set(['fictional-work-token']));
  });
});
