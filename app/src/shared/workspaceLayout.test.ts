import { describe, expect, it } from 'vitest';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from './workspaceSchema';
import type { WorkspaceArticleEntry } from './workspaceArticle';
import { planLayoutWrites } from './workspaceLayout';

// Fictional values only.
const docA: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'workspace-1700000000001',
  name: 'Workspace A',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'https://youtrack.example.com', credentialRef: 'youtrack-1' },
  ai: { credentialRef: 'anthropic-1' },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-12'] }],
  boards: {},
  dismissals: {},
};
const docB: WorkspaceDocument = { ...docA, workspaceId: 'workspace-1700000000002', name: 'Workspace B', order: 1, folders: [] };
const entry = (d: WorkspaceDocument): WorkspaceArticleEntry => ({ workspaceId: d.workspaceId, status: 'ok', articleId: `art-${d.order}`, updated: 1, document: d });
const existing = new Map([docA, docB].map((d) => [d.workspaceId, entry(d)]));
const layout = (ws: Array<Pick<WorkspaceDocument, 'workspaceId' | 'name' | 'order' | 'folders'>>) => ({
  version: 1 as const,
  activeWorkspaceId: '',
  workspaces: ws.map((w) => ({ id: w.workspaceId, name: w.name, order: w.order, folders: w.folders })),
});

describe('planLayoutWrites', () => {
  it('writes only the workspaces that changed, keeping their backend, credentials and boards', () => {
    const plan = planLayoutWrites(layout([{ ...docA, name: 'Renamed' }, docB]), existing);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].base).toBe(docA);
    expect(plan.writes[0].edited).toEqual({ ...docA, name: 'Renamed' });
  });

  it('an unchanged layout writes nothing', () => {
    expect(planLayoutWrites(layout([docA, docB]), existing)).toEqual({ ok: true, writes: [] });
  });

  it('refuses to remove a workspace, and a workspace with no article', () => {
    expect(planLayoutWrites(layout([docA]), existing)).toMatchObject({ ok: false });
    expect(planLayoutWrites(layout([docA, docB, { ...docB, workspaceId: 'workspace-1700000000003' }]), existing)).toMatchObject({ ok: false });
  });

  it('refuses when an article is ambiguous', () => {
    const amb = new Map(existing);
    amb.set(docB.workspaceId, { workspaceId: docB.workspaceId, status: 'ambiguous', articleIds: ['x', 'y'], message: 'two articles' });
    expect(planLayoutWrites(layout([docA, docB]), amb)).toEqual({ ok: false, error: 'two articles' });
  });
});
