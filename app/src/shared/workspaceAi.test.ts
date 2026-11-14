import { describe, expect, it } from 'vitest';
import {
  AI_NOT_SELECTED_MESSAGE,
  aiAvailability,
  aiCredentialRefOf,
  e2eFakeAnthropicKey,
  e2eFakeAnthropicKeyAllowed,
  parseAiCredentialRefInput,
  refFromE2eFakeAnthropicKey,
  withAiCredentialRef,
} from './workspaceAi';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from './workspaceSchema';
import { WorkspaceSetupError } from './workspaceSetup';

// Fictional values only (ADR-0011 §10).
const YT_DOC: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-a1b2c3d4e5f6',
  name: 'Home',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'https://yt.example.com', credentialRef: 'youtrack-1' },
  ai: { credentialRef: null },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-1'] }],
  boards: { '0-1': { columns: ['summary'] } as never },
  dismissals: {},
};

const JIRA_DOC: WorkspaceDocument = {
  ...YT_DOC,
  workspaceId: 'ws-0f0f0f0f0f0f',
  name: 'Work',
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
  jiraProjects: { DEMO: { dueDateField: 'customfield_10042' } },
};

describe('aiCredentialRefOf', () => {
  it('is anthropic-1 for every workspace under legacy storage, as before VERM-53', () => {
    expect(aiCredentialRefOf('legacy', null)).toBe('anthropic-1');
    expect(aiCredentialRefOf('legacy', { ...YT_DOC, ai: { credentialRef: 'anthropic-work' } })).toBe('anthropic-1');
  });

  it("is the workspace's own reference under per-workspace storage, and never a default", () => {
    expect(aiCredentialRefOf('per-workspace', { ...YT_DOC, ai: { credentialRef: 'anthropic-work' } })).toBe('anthropic-work');
    expect(aiCredentialRefOf('per-workspace', YT_DOC)).toBeNull();
    expect(aiCredentialRefOf('per-workspace', null)).toBeNull();
  });
});

describe('aiAvailability', () => {
  it('distinguishes none selected, selected but unavailable here, and available', () => {
    expect(aiAvailability(null, false)).toEqual({ state: 'not-selected', credentialRef: null, message: AI_NOT_SELECTED_MESSAGE });
    const missing = aiAvailability('anthropic-work', false);
    expect(missing.state).toBe('unavailable');
    expect(missing.message).toMatch(/anthropic-work/);
    expect(missing.message).toMatch(/this machine/);
    expect(aiAvailability('anthropic-work', true)).toEqual({ state: 'available', credentialRef: 'anthropic-work', message: null });
  });

  it('a reference with no source never counts as available', () => {
    expect(aiAvailability(null, true).state).toBe('not-selected');
  });
});

describe('parseAiCredentialRefInput', () => {
  it('treats empty input as None', () => {
    expect(parseAiCredentialRefInput('')).toEqual({ ok: true, credentialRef: null });
    expect(parseAiCredentialRefInput('   ')).toEqual({ ok: true, credentialRef: null });
  });

  it('accepts a well-formed reference, trimmed', () => {
    expect(parseAiCredentialRefInput(' anthropic-work ')).toEqual({ ok: true, credentialRef: 'anthropic-work' });
  });

  it.each(['Anthropic', 'anthropic_1', 'sk-FICTIONAL_pasted-Key', 'a b', '-x', 'x-'])(
    'refuses %p without echoing it',
    (raw) => {
      const r = parseAiCredentialRefInput(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).not.toContain(raw.trim());
    },
  );
});

describe('withAiCredentialRef', () => {
  it('sets, changes and clears the reference on a YouTrack workspace, leaving everything else alone', () => {
    const set = withAiCredentialRef(YT_DOC, 'anthropic-work');
    expect(set.ai.credentialRef).toBe('anthropic-work');
    expect({ ...set, ai: YT_DOC.ai }).toEqual(YT_DOC);
    expect(withAiCredentialRef(set, 'anthropic-2').ai.credentialRef).toBe('anthropic-2');
    expect(withAiCredentialRef(set, null).ai.credentialRef).toBeNull();
    expect(YT_DOC.ai.credentialRef).toBeNull(); // input not mutated
  });

  it('does the same on a Jira workspace, keeping its Jira project settings', () => {
    const set = withAiCredentialRef(JIRA_DOC, 'anthropic-work');
    expect(set.ai.credentialRef).toBe('anthropic-work');
    expect(set.jiraProjects).toEqual(JIRA_DOC.jiraProjects);
    expect(set.backend).toEqual(JIRA_DOC.backend);
  });

  it('keeps any other ai fields a newer client wrote', () => {
    const doc = { ...YT_DOC, ai: { credentialRef: null, futureField: 1 } } as unknown as WorkspaceDocument;
    expect((withAiCredentialRef(doc, 'anthropic-1').ai as unknown as Record<string, unknown>).futureField).toBe(1);
  });

  it('refuses a malformed reference', () => {
    expect(() => withAiCredentialRef(YT_DOC, 'Not OK')).toThrow(WorkspaceSetupError);
  });
});

describe('e2e fake Anthropic key', () => {
  it('names the reference it stands for, and round-trips', () => {
    expect(refFromE2eFakeAnthropicKey(e2eFakeAnthropicKey('anthropic-work'))).toBe('anthropic-work');
    expect(refFromE2eFakeAnthropicKey('sk-something-else')).toBeNull();
  });

  it('is allowed only for a reference with nothing configured, never for an e2e-missing one', () => {
    expect(e2eFakeAnthropicKeyAllowed('anthropic-work', 'no-source')).toBe(true);
    expect(e2eFakeAnthropicKeyAllowed('e2e-missing-1', 'no-source')).toBe(false);
    expect(e2eFakeAnthropicKeyAllowed('anthropic-work', 'file-unreadable')).toBe(false);
    expect(e2eFakeAnthropicKeyAllowed('anthropic-work', 'command-failed')).toBe(false);
  });
});
