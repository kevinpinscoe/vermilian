import { describe, expect, it } from 'vitest';
import type { CredentialRefStatus } from './credentialRefs';
import { e2eFakeJiraTokenAllowed, isJiraUnauthorized, jiraReconnectAdvice, needsJiraReconnect } from './jiraConnection';

const status = (over: Partial<CredentialRefStatus> = {}): CredentialRefStatus =>
  ({ credentialRef: 'jira-1', legacy: false, commandConfigured: false, fileConfigured: false, blobPresent: false, selected: null, ...over }) as CredentialRefStatus;

describe('isJiraUnauthorized', () => {
  it('is true only for a 401', () => {
    expect(isJiraUnauthorized({ status: 401, message: 'x' })).toBe(true);
    for (const e of [{ status: 403 }, { status: 404 }, { message: 'x' }, null, undefined, 'x', 401]) {
      expect(isJiraUnauthorized(e)).toBe(false);
    }
  });
});

describe('needsJiraReconnect', () => {
  it('is true for an unauthorized or unresolved credential, false otherwise', () => {
    expect(needsJiraReconnect({ ok: false, reason: 'unauthorized' })).toBe(true);
    expect(needsJiraReconnect({ ok: false, reason: 'credential' })).toBe(true);
    expect(needsJiraReconnect({ ok: false, reason: 'error' })).toBe(false);
    expect(needsJiraReconnect({ ok: false })).toBe(false);
    expect(needsJiraReconnect({ ok: true, reason: 'unauthorized' })).toBe(false);
    expect(needsJiraReconnect(null)).toBe(false);
    expect(needsJiraReconnect(undefined)).toBe(false);
  });
});

const ready = (over: Partial<CredentialRefStatus> = {}) => ({ state: 'ready' as const, status: status(over) });

describe('e2eFakeJiraTokenAllowed', () => {
  it('allows the fake token only when nothing is configured', () => {
    expect(e2eFakeJiraTokenAllowed({ reason: 'no-source' })).toBe(true);
    for (const reason of ['command-failed', 'file-unreadable', 'blob-unreadable', 'empty', 'invalid', 'not-selected', 'invalid-reference'] as const) {
      expect(e2eFakeJiraTokenAllowed({ reason })).toBe(false);
    }
  });
});

describe('jiraReconnectAdvice', () => {
  it('offers nothing while the status is loading', () => {
    const a = jiraReconnectAdvice({ state: 'loading' }, 'jira-2');
    expect(a).toMatchObject({ canEnterToken: false, statusUnavailable: false });
    expect(a.text).toMatch(/Checking/);
  });

  it('a failed status read offers checking again, never token entry', () => {
    const a = jiraReconnectAdvice({ state: 'error', message: 'Config unreadable.' }, 'jira-2');
    expect(a).toMatchObject({ canEnterToken: false, statusUnavailable: true });
    expect(a.text).toContain('Config unreadable.');
  });

  it("a status for another reference does not establish this one's", () => {
    expect(jiraReconnectAdvice(ready({ credentialRef: 'jira-3' as CredentialRefStatus['credentialRef'] }), 'jira-2')).toMatchObject({
      canEnterToken: false,
      statusUnavailable: true,
    });
  });

  it('offers token entry for a confirmed non-legacy reference with no command or file source', () => {
    const fresh = jiraReconnectAdvice(ready({ credentialRef: 'jira-2' as CredentialRefStatus['credentialRef'] }), 'jira-2');
    expect(fresh).toMatchObject({ canEnterToken: true, statusUnavailable: false });
    expect(fresh.text).toContain('"jira-2"');
    expect(jiraReconnectAdvice(ready({ blobPresent: true, selected: 'safeStorage' }), 'jira-1').canEnterToken).toBe(true);
  });

  it('a command or file source is updated where it is, not typed in', () => {
    const cmd = jiraReconnectAdvice(ready({ commandConfigured: true, blobPresent: true }), 'jira-1');
    expect(cmd).toMatchObject({ canEnterToken: false, statusUnavailable: false });
    expect(cmd.text).toMatch(/command/);
    const file = jiraReconnectAdvice(ready({ fileConfigured: true }), 'jira-1');
    expect(file.canEnterToken).toBe(false);
    expect(file.text).toMatch(/file/);
  });

  it('sends the legacy reference to Settings, and a missing reference to the workspace', () => {
    expect(jiraReconnectAdvice(ready({ legacy: true }), 'jira-1')).toMatchObject({ canEnterToken: false, text: expect.stringContaining('Settings') });
    expect(jiraReconnectAdvice({ state: 'loading' }, null)).toMatchObject({ canEnterToken: false });
  });
});
