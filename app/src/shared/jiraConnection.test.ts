import { describe, expect, it } from 'vitest';
import type { CredentialRefStatus } from './credentialRefs';
import { isJiraUnauthorized, jiraReconnectAdvice, needsJiraReconnect } from './jiraConnection';

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

describe('jiraReconnectAdvice', () => {
  it('offers token entry only when no command or file source outranks a stored token', () => {
    expect(jiraReconnectAdvice(status(), 'jira-1').canEnterToken).toBe(true);
    expect(jiraReconnectAdvice(status({ blobPresent: true, selected: 'safeStorage' }), 'jira-1').canEnterToken).toBe(true);
    expect(jiraReconnectAdvice(null, 'jira-1').canEnterToken).toBe(true);
    const cmd = jiraReconnectAdvice(status({ commandConfigured: true, blobPresent: true }), 'jira-1');
    expect(cmd.canEnterToken).toBe(false);
    expect(cmd.text).toMatch(/command/);
    const file = jiraReconnectAdvice(status({ fileConfigured: true }), 'jira-1');
    expect(file.canEnterToken).toBe(false);
    expect(file.text).toMatch(/file/);
  });

  it('sends a legacy or missing reference elsewhere', () => {
    expect(jiraReconnectAdvice(status({ legacy: true }), 'jira-1')).toMatchObject({ canEnterToken: false, text: expect.stringContaining('Settings') });
    expect(jiraReconnectAdvice(null, null)).toMatchObject({ canEnterToken: false });
  });

  it('names the reference, never a value', () => {
    expect(jiraReconnectAdvice(status(), 'jira-2').text).toContain('"jira-2"');
  });
});
