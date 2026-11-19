import { describe, expect, it } from 'vitest';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from './workspaceSchema';
import type { WorkspaceArticleEntry } from './workspaceArticle';
import { planLayoutWrites, planWorkspaceDelete } from './workspaceLayout';

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

describe('planWorkspaceDelete', () => {
  const board = (id: string) => ({ marker: id }) as unknown as WorkspaceDocument['boards'][string];

  it('with no destination writes nothing and names the article version to delete', () => {
    const plan = planWorkspaceDelete(docA.workspaceId, null, existing, 'folder-new');
    expect(plan).toEqual({ ok: true, destinationWrite: null, expectedUpdated: 1 });
  });

  it('moves the projects and their board settings to the destination', () => {
    const source = { ...docA, boards: { '0-12': board('from-a') } };
    const dest = { ...docB, boards: { '0-99': board('b-own') } };
    const plan = planWorkspaceDelete(source.workspaceId, dest.workspaceId, new Map([source, dest].map((d) => [d.workspaceId, entry(d)])), 'folder-new');
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.destinationWrite?.base).toBe(dest);
    expect(plan.destinationWrite?.edited.folders.flatMap((f) => f.projectIds)).toEqual(['0-12']);
    expect(plan.destinationWrite?.edited.boards).toEqual({ '0-12': board('from-a'), '0-99': board('b-own') });
  });

  it('keeps the destination\'s own board when both hold the same project', () => {
    const source = { ...docA, boards: { '0-12': board('from-a') } };
    const dest = { ...docB, boards: { '0-12': board('b-own') } };
    const plan = planWorkspaceDelete(source.workspaceId, dest.workspaceId, new Map([source, dest].map((d) => [d.workspaceId, entry(d)])), 'folder-new');
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.destinationWrite?.edited.boards['0-12']).toEqual(board('b-own'));
  });

  it('refuses to delete the last workspace', () => {
    const only = new Map([[docA.workspaceId, entry(docA)]]);
    expect(planWorkspaceDelete(docA.workspaceId, null, only, 'folder-new')).toMatchObject({ ok: false });
  });

  it('refuses a workspace with no article, or one that is ambiguous', () => {
    expect(planWorkspaceDelete('workspace-1700000000009', null, existing, 'folder-new')).toMatchObject({ ok: false });
    const amb = new Map(existing);
    amb.set(docA.workspaceId, { workspaceId: docA.workspaceId, status: 'ambiguous', articleIds: ['x', 'y'], message: 'two articles' });
    expect(planWorkspaceDelete(docA.workspaceId, null, amb, 'folder-new')).toEqual({ ok: false, error: 'two articles' });
  });

  it('refuses a destination that is missing, is the workspace itself, or uses another backend', () => {
    expect(planWorkspaceDelete(docA.workspaceId, 'workspace-1700000000009', existing, 'folder-new')).toMatchObject({ ok: false });
    expect(planWorkspaceDelete(docA.workspaceId, docA.workspaceId, existing, 'folder-new')).toMatchObject({ ok: false });
    const other: WorkspaceDocument = { ...docB, backend: { kind: 'youtrack', serverUrl: 'https://other.example.com', credentialRef: 'youtrack-2' } };
    const mixed = new Map([docA, other].map((d) => [d.workspaceId, entry(d)]));
    expect(planWorkspaceDelete(docA.workspaceId, other.workspaceId, mixed, 'folder-new')).toMatchObject({ ok: false });
  });
});
