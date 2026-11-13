import { describe, expect, it } from 'vitest';
import {
  backendContextOf,
  boardAvailability,
  buildActiveContext,
  resolveActiveWorkspaceId,
  workspacesFromDocuments,
  type WorkspaceChoice,
} from './activeWorkspace';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from './workspaceSchema';

// Fictional values only (ADR-0011 §10).
const YT = 'https://youtrack.example.com';

function choice(id: string, order: number, backend?: WorkspaceChoice['backend']): WorkspaceChoice {
  return {
    id,
    name: `Workspace ${id}`,
    order,
    backend: backend ?? { kind: 'youtrack', serverUrl: YT, credentialRef: 'youtrack-1' },
  };
}

function doc(workspaceId: string, order: number, backend: WorkspaceDocument['backend']): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId,
    name: `Workspace ${workspaceId}`,
    order,
    backend,
    ai: { credentialRef: null },
    folders: [{ id: 'f1', name: 'Projects', order: 0, parentId: null, projectIds: [] }],
    boards: {},
    dismissals: {},
  };
}

describe('resolveActiveWorkspaceId', () => {
  const choices = [choice('ws-b', 1), choice('ws-a', 0), choice('ws-c', 2)];

  it('uses the locally stored choice when it still exists', () => {
    expect(resolveActiveWorkspaceId(choices, 'ws-c', 'ws-b')).toBe('ws-c');
  });

  it('falls back to the legacy hint when the stored choice is gone', () => {
    expect(resolveActiveWorkspaceId(choices, 'ws-deleted', 'ws-b')).toBe('ws-b');
  });

  it('falls back to the first workspace in display order otherwise', () => {
    expect(resolveActiveWorkspaceId(choices, '', 'ws-gone')).toBe('ws-a');
  });

  it('is empty when there are no workspaces', () => {
    expect(resolveActiveWorkspaceId([], 'ws-a', 'ws-b')).toBe('');
  });
});

describe('boardAvailability', () => {
  it('shows a YouTrack board on the configured server, ignoring case and trailing slashes', () => {
    const r = boardAvailability({ kind: 'youtrack', serverUrl: `${YT}/`, credentialRef: null }, YT.toUpperCase());
    expect(r).toEqual({ available: true, reason: null });
  });

  it('withholds a YouTrack board on a different server', () => {
    const r = boardAvailability(
      { kind: 'youtrack', serverUrl: 'https://other.example.com', credentialRef: 'youtrack-2' },
      YT,
    );
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/different YouTrack server/);
  });

  it('withholds a Jira board: live Jira boards are not claimed', () => {
    const r = boardAvailability(
      { kind: 'jira', siteUrl: 'https://example.atlassian.net', credentialRef: 'jira-1' },
      YT,
    );
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/Jira boards are not available/);
  });

  it('treats no backend (no workspaces yet) as available', () => {
    expect(boardAvailability(null, YT).available).toBe(true);
  });
});

describe('buildActiveContext', () => {
  it('carries the backend context of the chosen workspace and no secret', () => {
    const jira = { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', credentialRef: 'jira-1' };
    const ctx = buildActiveContext('per-workspace', [choice('ws-a', 0), choice('ws-j', 1, jira)], 'ws-j', YT);
    expect(ctx).toEqual({
      storage: 'per-workspace',
      workspaceId: 'ws-j',
      workspaceName: 'Workspace ws-j',
      backend: jira,
      boardAvailable: false,
      boardUnavailableReason: expect.stringMatching(/Jira/),
    });
  });

  it('is empty for an unknown id', () => {
    const ctx = buildActiveContext('legacy', [choice('ws-a', 0)], 'ws-x', YT);
    expect(ctx.workspaceId).toBe('');
    expect(ctx.backend).toBeNull();
  });
});

describe('per-workspace documents', () => {
  const docs = [
    doc('ws-j', 1, { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' }),
    doc('ws-y', 0, { kind: 'youtrack', serverUrl: YT, credentialRef: 'youtrack-1' }),
  ];

  it('reduce to the rail shape in display order', () => {
    expect(workspacesFromDocuments(docs).map((w) => w.id)).toEqual(['ws-y', 'ws-j']);
  });

  it('keep only non-secret backend fields in the context', () => {
    expect(backendContextOf(docs[0])).toEqual({
      kind: 'jira',
      siteUrl: 'https://example.atlassian.net',
      credentialRef: 'jira-1',
    });
  });
});
