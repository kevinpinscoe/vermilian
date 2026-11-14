import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '../../shared/config';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../../shared/workspaceSchema';
import { refFromE2eFakeYouTrackToken } from '../../shared/e2eFakeCredentials';
import type { CredentialSourceIO } from './credentialResolver';
import { JIRA_NO_YOUTRACK_MESSAGE, NO_WORKSPACE_MESSAGE, resolveWorkspaceYouTrackConnection } from './workspaceYouTrack';

// Fictional values only.
const doc = (credentialRef: string | null, serverUrl = 'https://yt.example.com'): WorkspaceDocument => ({
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-a1b2c3d4e5f6',
  name: 'Home',
  order: 0,
  backend: { kind: 'youtrack', serverUrl, credentialRef },
  ai: { credentialRef: null },
  folders: [],
  boards: {},
  dismissals: {},
});

const CFG: AppConfig = {
  ...DEFAULT_CONFIG,
  youtrackTokenCommand: 'show settings token',
  credentialSources: {
    'youtrack-home': { command: 'show home', file: '' },
    'youtrack-broken': { command: 'show broken', file: '/fictional/fallback.token' },
  },
};

function io() {
  const calls: string[] = [];
  const fake: CredentialSourceIO = {
    async runCommand(c) { calls.push(`command:${c}`); return c === 'show home' ? { ok: true, stdout: 'fictional-home-token\n' } : c === 'show settings token' ? { ok: true, stdout: 'fictional-settings-token' } : { ok: false }; },
    async readFile(f) { calls.push(`file:${f}`); return { ok: true, content: 'fictional-fallback-token' }; },
    async blobPresent() { return false; },
    async readBlob() { return { ok: false }; },
  };
  return { fake, calls };
}

describe('resolveWorkspaceYouTrackConnection', () => {
  it("uses the workspace's own server and reference", async () => {
    const h = io();
    await expect(resolveWorkspaceYouTrackConnection(doc('youtrack-home', 'https://other.example.com'), CFG, h.fake, false))
      .resolves.toEqual({ ok: true, url: 'https://other.example.com', token: 'fictional-home-token' });
    expect(h.calls).toEqual(['command:show home']);
  });

  it('a failing source stops: no lower source, no Settings token', async () => {
    const h = io();
    const r = await resolveWorkspaceYouTrackConnection(doc('youtrack-broken'), CFG, h.fake, false);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/youtrack-broken/);
      expect(r.error).not.toMatch(/fictional|show broken|\/fictional\//);
    }
    expect(h.calls).toEqual(['command:show broken']);
  });

  it('refuses no reference, a missing workspace and a Jira workspace', async () => {
    const h = io();
    expect((await resolveWorkspaceYouTrackConnection(doc(null), CFG, h.fake, false)).ok).toBe(false);
    expect(await resolveWorkspaceYouTrackConnection(null, CFG, h.fake, false)).toEqual({ ok: false, error: NO_WORKSPACE_MESSAGE });
    const jira = { ...doc(null), backend: { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', email: 'u@example.com', cloudId: '', credentialRef: 'jira-1' } };
    expect(await resolveWorkspaceYouTrackConnection(jira, CFG, h.fake, false)).toEqual({ ok: false, error: JIRA_NO_YOUTRACK_MESSAGE });
    expect(h.calls).toEqual([]);
  });

  it('e2e: an unconfigured reference gets a fictional token naming it; e2e-missing ones do not', async () => {
    const h = io();
    const ok = await resolveWorkspaceYouTrackConnection(doc('youtrack-e2e'), CFG, h.fake, true);
    expect(ok.ok && refFromE2eFakeYouTrackToken(ok.token)).toBe('youtrack-e2e');
    expect((await resolveWorkspaceYouTrackConnection(doc('e2e-missing-yt'), CFG, h.fake, true)).ok).toBe(false);
  });
});
