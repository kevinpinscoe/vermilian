import { describe, expect, it } from 'vitest';
import {
  backendContextOf,
  boardAvailability,
  buildActiveContext,
  resolveActiveWorkspace,
  resolveActiveWorkspaceId,
  workspacesFromDocuments,
  type WorkspaceChoice,
} from './activeWorkspace';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from './workspaceSchema';
import { AI_NOT_SELECTED_MESSAGE } from './workspaceAi';

// Fictional values only (ADR-0011 §10).
const YT = 'https://youtrack.example.com';

function choice(id: string, order: number, backend?: WorkspaceChoice['backend']): WorkspaceChoice {
  return {
    id,
    name: `Workspace ${id}`,
    order,
    backend: backend ?? { kind: 'youtrack', serverUrl: YT, credentialRef: 'youtrack-1' },
    aiCredentialRef: null,
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

  it('uses the legacy hint only when this machine has never stored a choice', () => {
    expect(resolveActiveWorkspaceId(choices, '', 'ws-b')).toBe('ws-b');
  });

  // VERM-123: a stored choice that is missing from the list is not replaced
  // by the legacy hint, which is frozen at whatever the shared article held
  // before this machine first chose (on the FLDW, days before the upgrade).
  it('never lets the legacy hint override a stored choice that is missing', () => {
    expect(resolveActiveWorkspaceId(choices, 'ws-deleted', 'ws-b')).toBe('ws-a');
  });

  it('falls back to the first workspace in display order otherwise', () => {
    expect(resolveActiveWorkspaceId(choices, '', 'ws-gone')).toBe('ws-a');
  });

  it('is empty when there are no workspaces', () => {
    expect(resolveActiveWorkspaceId([], 'ws-a', 'ws-b')).toBe('');
  });
});

describe('resolveActiveWorkspace (VERM-123)', () => {
  const choices = [choice('ws-b', 1), choice('ws-a', 0), choice('ws-c', 2)];

  it('is settled when the stored choice is listed', () => {
    expect(resolveActiveWorkspace(choices, 'ws-c', 'ws-b')).toEqual({ id: 'ws-c', source: 'stored', tentative: false });
  });

  it('is tentative when the stored choice is missing, so the caller re-checks rather than latching the fallback', () => {
    expect(resolveActiveWorkspace(choices, 'ws-budget', 'ws-b')).toEqual({ id: 'ws-a', source: 'first', tentative: true });
  });

  it('is tentative when the listing failed, even with nothing stored', () => {
    expect(resolveActiveWorkspace([], 'ws-c', 'ws-b', false)).toEqual({ id: '', source: 'none', tentative: true });
    expect(resolveActiveWorkspace([], '', '', false)).toEqual({ id: '', source: 'none', tentative: true });
  });

  it('is settled for a first resolution from the legacy hint or display order', () => {
    expect(resolveActiveWorkspace(choices, '', 'ws-b')).toEqual({ id: 'ws-b', source: 'legacy-hint', tentative: false });
    expect(resolveActiveWorkspace(choices, '', '')).toEqual({ id: 'ws-a', source: 'first', tentative: false });
  });

  it('is settled and empty when the listing worked and there are no workspaces', () => {
    expect(resolveActiveWorkspace([], '', '')).toEqual({ id: '', source: 'none', tentative: false });
  });
});

describe('boardAvailability', () => {
  it('shows a YouTrack board on the configured server, ignoring case and trailing slashes', () => {
    const r = boardAvailability({ kind: 'youtrack', serverUrl: `${YT}/`, credentialRef: null }, YT.toUpperCase());
    expect(r).toEqual({ available: true, reason: null });
  });

  it('shows a YouTrack board on a different server, through its own connection (VERM-53)', () => {
    const r = boardAvailability(
      { kind: 'youtrack', serverUrl: 'https://other.example.com', credentialRef: 'youtrack-2' },
      YT,
    );
    expect(r).toEqual({ available: true, reason: null });
  });

  it('offers a Jira board, read-only through its own connection (VERM-34)', () => {
    const r = boardAvailability(
      { kind: 'jira', siteUrl: 'https://example.atlassian.net', credentialRef: 'jira-1' },
      YT,
    );
    expect(r).toEqual({ available: true, reason: null });
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
      boardAvailable: true,
      boardUnavailableReason: null,
      ai: { state: 'not-selected', credentialRef: null, message: AI_NOT_SELECTED_MESSAGE },
      tentative: false,
    });
  });

  it('carries whether the choice is tentative (VERM-123)', () => {
    expect(buildActiveContext('per-workspace', [choice('ws-a', 0)], 'ws-a', YT, false, true).tentative).toBe(true);
  });

  it("reports the chosen workspace's AI availability, by reference only (VERM-47)", () => {
    const withRef = { ...choice('ws-b', 1), aiCredentialRef: 'anthropic-work' };
    const choices = [choice('ws-a', 0), withRef];
    expect(buildActiveContext('per-workspace', choices, 'ws-b', YT, true).ai).toEqual({ state: 'available', credentialRef: 'anthropic-work', message: null });
    expect(buildActiveContext('per-workspace', choices, 'ws-b', YT, false).ai.state).toBe('unavailable');
    // Switching to the other workspace switches the availability with it.
    expect(buildActiveContext('per-workspace', choices, 'ws-a', YT, true).ai.state).toBe('not-selected');
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

  it("carry a Jira workspace's chosen boards, and nothing for others (VERM-59)", () => {
    const withBoards = [{ ...docs[0], jiraBoards: [{ id: 12, name: 'Planned' }], jiraHiddenStatuses: ['Blocked'] }, docs[1]];
    const [yt, j] = workspacesFromDocuments(withBoards);
    expect(j.jiraBoards).toEqual([{ id: 12, name: 'Planned' }]);
    expect(j.jiraHiddenStatuses).toEqual(['Blocked']);
    expect('jiraHiddenStatuses' in yt).toBe(false);
    expect('jiraBoards' in yt).toBe(false);
  });

  it('keep only non-secret backend fields in the context', () => {
    expect(backendContextOf(docs[0])).toEqual({
      kind: 'jira',
      siteUrl: 'https://example.atlassian.net',
      credentialRef: 'jira-1',
    });
  });
});
