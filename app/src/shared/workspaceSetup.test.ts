import { describe, expect, it } from 'vitest';
import { defaultBoardConfig, dismissalKey } from './boardConfig';
import {
  DEFAULT_FOLDER_ID,
  WorkspaceSetupError,
  backendChangeProblem,
  buildWorkspaceDocument,
  nextWorkspaceOrder,
  withJiraProjects,
  type NewWorkspaceInput,
} from './workspaceSetup';
import {
  parseWorkspaceDocument,
  serialiseNewWorkspaceDocument,
  validateWorkspaceDocument,
  workspaceProjectIds,
  type WorkspaceDocument,
} from './workspaceSchema';

// Fictional values only (ADR-0011 §10).
const JIRA: NewWorkspaceInput = {
  workspaceId: 'ws-jira01',
  name: '  Work  ',
  order: 2,
  backend: { kind: 'jira', siteUrl: 'HTTPS://Example.Atlassian.net/jira/', email: ' user@example.com ', credentialRef: 'jira-1' },
};
const YT: NewWorkspaceInput = {
  workspaceId: 'ws-yt0001',
  name: 'Home',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'https://youtrack.example.com/', credentialRef: 'youtrack-1' },
};

function built(input: NewWorkspaceInput): WorkspaceDocument {
  const r = buildWorkspaceDocument(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.document;
}

describe('buildWorkspaceDocument — the chosen backend, nothing defaulted', () => {
  it('builds a valid Jira workspace with its connection in canonical form', () => {
    const doc = built(JIRA);
    expect(doc.backend).toEqual({ kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' });
    expect(doc.name).toBe('Work');
    expect(doc.order).toBe(2);
    expect(doc.folders).toEqual([{ id: DEFAULT_FOLDER_ID, name: 'Projects', order: 0, parentId: null, projectIds: [] }]);
    expect(doc.ai).toEqual({ credentialRef: null });
    expect(validateWorkspaceDocument(doc)).toEqual([]);
  });

  it('builds a valid YouTrack workspace', () => {
    const doc = built(YT);
    expect(doc.backend).toEqual({ kind: 'youtrack', serverUrl: 'https://youtrack.example.com', credentialRef: 'youtrack-1' });
    expect(validateWorkspaceDocument(doc)).toEqual([]);
  });

  it('round-trips through the article format unchanged', () => {
    const doc = built(JIRA);
    const parsed = parseWorkspaceDocument(serialiseNewWorkspaceDocument(doc));
    expect(parsed.ok && parsed.document).toEqual(doc);
  });

  it('returns the problems for bad connection values instead of throwing', () => {
    const r = buildWorkspaceDocument({ ...JIRA, name: ' ', backend: { kind: 'jira', siteUrl: 'http://insecure.example', email: 'nope', credentialRef: 'Jira 1' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path).sort()).toEqual(['backend.credentialRef', 'backend.email', 'backend.siteUrl', 'name']);
    const y = buildWorkspaceDocument({ ...YT, backend: { kind: 'youtrack', serverUrl: 'not a url', credentialRef: null } });
    expect(!y.ok && y.errors.map((e) => e.path)).toEqual(['backend.serverUrl']);
  });

  it('places a new workspace after every existing one', () => {
    expect(nextWorkspaceOrder([])).toBe(0);
    expect(nextWorkspaceOrder([{ order: 0 }, { order: 4 }, { order: 1 }])).toBe(5);
  });
});

describe('withJiraProjects — choosing a Jira workspace\'s projects', () => {
  it('adds chosen projects to the first folder', () => {
    const doc = withJiraProjects(built(JIRA), ['DEMO', 'OPS']);
    expect(workspaceProjectIds(doc)).toEqual(['DEMO', 'OPS']);
    expect(validateWorkspaceDocument(doc)).toEqual([]);
  });

  it('keeps projects that stay in their folder and position, and removes deselected ones', () => {
    const doc: WorkspaceDocument = {
      ...built(JIRA),
      folders: [
        { id: 'f-a', name: 'A', order: 0, parentId: null, projectIds: ['DEMO', 'OLD'] },
        { id: 'f-b', name: 'B', order: 1, parentId: null, projectIds: ['OPS'] },
      ],
    };
    const next = withJiraProjects(doc, ['OPS', 'NEW', 'DEMO']);
    expect(next.folders.map((f) => [f.id, f.projectIds])).toEqual([
      ['f-a', ['DEMO', 'NEW']],
      ['f-b', ['OPS']],
    ]);
  });

  it('keeps board and per-project settings of a deselected project', () => {
    const doc: WorkspaceDocument = {
      ...withJiraProjects(built(JIRA), ['DEMO']),
      boards: { DEMO: defaultBoardConfig('DEMO') },
      jiraProjects: { DEMO: { dueDateField: 'customfield_10042' } },
    };
    const next = withJiraProjects(doc, []);
    expect(workspaceProjectIds(next)).toEqual([]);
    expect(next.boards.DEMO).toBeDefined();
    expect(next.jiraProjects?.DEMO).toEqual({ dueDateField: 'customfield_10042' });
  });

  it('creates a folder when the workspace has none, and ignores repeats', () => {
    const next = withJiraProjects({ ...built(JIRA), folders: [] }, ['DEMO', 'DEMO']);
    expect(next.folders).toEqual([{ id: DEFAULT_FOLDER_ID, name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }]);
  });

  it('never puts Jira projects in a YouTrack workspace', () => {
    expect(() => withJiraProjects(built(YT), ['DEMO'])).toThrow(WorkspaceSetupError);
  });

  it('refuses a value that is not a Jira project key', () => {
    for (const bad of ['demo', '0-12', 'DEMO-1', '', 'A B']) {
      expect(() => withJiraProjects(built(JIRA), [bad])).toThrow(/Not a Jira project key/);
    }
  });
});

describe('one backend per workspace', () => {
  it('a Jira workspace holds only Jira project keys', () => {
    const doc = { ...built(JIRA), folders: [{ id: 'f', name: 'P', order: 0, parentId: null, projectIds: ['0-12'] }] };
    expect(validateWorkspaceDocument(doc).map((e) => e.path)).toEqual(['folders[0].projectIds[0]']);
  });

  it('a YouTrack workspace holds no Jira project settings', () => {
    const doc = { ...built(YT), jiraProjects: { DEMO: { dueDateField: 'duedate' } } };
    expect(validateWorkspaceDocument(doc).map((e) => e.path)).toEqual(['jiraProjects']);
  });
});

describe('backendChangeProblem — a backend change never silently discards configuration', () => {
  const asYouTrack = (doc: WorkspaceDocument): WorkspaceDocument => ({ ...doc, backend: built(YT).backend });

  it('allows any change within the same backend kind', () => {
    const doc = withJiraProjects(built(JIRA), ['DEMO']);
    const moved = { ...doc, backend: { ...doc.backend, siteUrl: 'https://other.atlassian.net' } } as WorkspaceDocument;
    expect(backendChangeProblem(doc, moved)).toBeNull();
  });

  it('allows a change of kind on a workspace that holds nothing yet', () => {
    expect(backendChangeProblem(built(JIRA), asYouTrack(built(JIRA)))).toBeNull();
  });

  it('refuses a change of kind while projects are chosen', () => {
    const doc = withJiraProjects(built(JIRA), ['DEMO']);
    expect(backendChangeProblem(doc, asYouTrack(doc))).toMatch(/still has projects from Jira.*would discard them/);
  });

  it('names every kind of configuration that would be lost', () => {
    const doc: WorkspaceDocument = {
      ...built(JIRA),
      boards: { DEMO: defaultBoardConfig('DEMO') },
      jiraProjects: { DEMO: { dueDateField: 'duedate' } },
      dismissals: { [dismissalKey('ws-jira01', 'DEMO-1')]: { workspace: 'ws-jira01', issueId: 'DEMO-1', dismissedWeekOf: '2026-11-09' } },
    };
    const msg = backendChangeProblem(doc, asYouTrack(doc));
    expect(msg).toContain('board settings');
    expect(msg).toContain('Jira project settings');
    expect(msg).toContain('dismissals');
    expect(msg).toContain('Create a new YouTrack workspace instead');
  });
});
