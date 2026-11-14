import { describe, expect, it } from 'vitest';
import {
  isMasterPlanArticleId,
  masterPlanArticleIdOf,
  parseMasterPlanArticleIdInput,
  withMasterPlanArticle,
} from './workspaceMasterPlan';
import { WORKSPACE_SCHEMA_VERSION, parseWorkspaceDocument, serialiseNewWorkspaceDocument, validateWorkspaceDocument, type WorkspaceDocument } from './workspaceSchema';
import { WorkspaceSetupError } from './workspaceSetup';

// Fictional values only (ADR-0011 §10).
const YT: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-a1b2c3d4e5f6',
  name: 'Home',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'https://yt.example.com', credentialRef: 'youtrack-1' },
  ai: { credentialRef: 'anthropic-1' },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-1'] }],
  boards: {},
  dismissals: {},
};
const JIRA: WorkspaceDocument = {
  ...YT,
  workspaceId: 'ws-0f0f0f0f0f0f',
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
  jiraProjects: { DEMO: { dueDateField: 'customfield_10042' } },
};

describe('isMasterPlanArticleId', () => {
  it('accepts a readable YouTrack article ID', () => {
    for (const id of ['VERM-A-1', 'VERM-A-123', 'K2_X-A-7']) expect(isMasterPlanArticleId(id)).toBe(true);
  });

  it.each(['', 'verm-a-1', 'VERM-1', 'VERM-A-0', 'VERM-A-01', '161-12', '_vermilian-master-plan', 'VERM-A-1 ', null, 7])('rejects %p', (v) => {
    expect(isMasterPlanArticleId(v)).toBe(false);
  });
});

describe('masterPlanArticleIdOf', () => {
  it('is null when the field is absent or None, the ID otherwise', () => {
    expect(masterPlanArticleIdOf(YT)).toBeNull();
    expect(masterPlanArticleIdOf({ ...YT, masterPlan: { articleId: null } })).toBeNull();
    expect(masterPlanArticleIdOf({ ...YT, masterPlan: { articleId: 'VERM-A-5' } })).toBe('VERM-A-5');
  });
});

describe('parseMasterPlanArticleIdInput', () => {
  it('empty is None; an ID is trimmed and uppercased', () => {
    expect(parseMasterPlanArticleIdInput('  ')).toEqual({ ok: true, articleId: null });
    expect(parseMasterPlanArticleIdInput(' verm-a-12 ')).toEqual({ ok: true, articleId: 'VERM-A-12' });
  });

  it('refuses a title or a URL with a hint, never a guess', () => {
    for (const raw of ['_vermilian-master-plan', 'https://yt.example.com/articles/VERM-A-1', 'VERM-12']) {
      const r = parseMasterPlanArticleIdInput(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/article ID/);
    }
  });
});

describe('withMasterPlanArticle', () => {
  it('sets, changes and clears the reference, leaving everything else alone', () => {
    const set = withMasterPlanArticle(YT, 'VERM-A-5');
    expect(set.masterPlan).toEqual({ articleId: 'VERM-A-5' });
    const { masterPlan: _m, ...rest } = set;
    expect(rest).toEqual(YT);
    expect(withMasterPlanArticle(set, 'VERM-A-6').masterPlan?.articleId).toBe('VERM-A-6');
    expect(withMasterPlanArticle(set, null).masterPlan).toEqual({ articleId: null });
    expect(YT.masterPlan).toBeUndefined();
  });

  it('refuses a malformed ID, and any master plan on a Jira workspace', () => {
    expect(() => withMasterPlanArticle(YT, 'nope')).toThrow(WorkspaceSetupError);
    expect(() => withMasterPlanArticle(JIRA, 'VERM-A-5')).toThrow(/YouTrack workspaces/);
    expect(withMasterPlanArticle(JIRA, null).masterPlan).toEqual({ articleId: null });
  });
});

describe('the schema', () => {
  it('accepts the field absent, None, or an article ID, and round-trips it', () => {
    for (const mp of [undefined, { articleId: null }, { articleId: 'VERM-A-5' }]) {
      const doc = mp === undefined ? YT : { ...YT, masterPlan: mp };
      expect(validateWorkspaceDocument(doc)).toEqual([]);
      const back = parseWorkspaceDocument(serialiseNewWorkspaceDocument(doc));
      expect(back.ok && back.document.masterPlan).toEqual(mp ?? undefined);
    }
  });

  it('rejects a malformed reference and a master plan on a Jira workspace', () => {
    expect(validateWorkspaceDocument({ ...YT, masterPlan: { articleId: 'not-an-id' } }).map((e) => e.path)).toContain('masterPlan.articleId');
    expect(validateWorkspaceDocument({ ...JIRA, masterPlan: { articleId: 'VERM-A-5' } }).map((e) => e.path)).toContain('masterPlan');
    expect(validateWorkspaceDocument({ ...JIRA, masterPlan: { articleId: null } })).toEqual([]);
  });
});
