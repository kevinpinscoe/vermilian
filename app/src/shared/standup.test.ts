import { describe, expect, it } from 'vitest';
import {
  JIRA_STANDUP_UNSUPPORTED_MESSAGE,
  standupAvailability,
  standupProjectShortNames,
  type StandupWorkspace,
} from './standup';

// Fictional values only.
const YT = 'https://yt.example.com';
const ALL = [
  { id: '0-1', shortName: 'HOME' },
  { id: '0-2', shortName: 'WORK' },
  { id: '0-3', shortName: 'SIDE' },
];
const ws = (id: string, projectIds: string[][], backend: StandupWorkspace['backend'] = { kind: 'youtrack', serverUrl: YT, credentialRef: 'youtrack-1' }): StandupWorkspace => ({
  id,
  backend,
  folders: projectIds.map((p) => ({ projectIds: p })),
});

describe('standupProjectShortNames', () => {
  it("covers exactly the workspace's own projects, across its folders", () => {
    expect(standupProjectShortNames(ws('a', [['0-1'], ['0-3']]), ALL)).toEqual({ ok: true, shortNames: ['HOME', 'SIDE'] });
  });

  it("two workspaces each get only their own projects — never the other's", () => {
    expect(standupProjectShortNames(ws('a', [['0-1']]), ALL)).toEqual({ ok: true, shortNames: ['HOME'] });
    expect(standupProjectShortNames(ws('b', [['0-2']]), ALL)).toEqual({ ok: true, shortNames: ['WORK'] });
  });

  it('a workspace with no projects covers none, never all of them', () => {
    expect(standupProjectShortNames(ws('a', []), ALL)).toEqual({ ok: true, shortNames: [] });
  });

  it('a legacy workspace (no backend recorded) is the configured server', () => {
    expect(standupProjectShortNames(ws('a', [['0-2']], null), ALL)).toEqual({ ok: true, shortNames: ['WORK'] });
  });

  it('refuses a Jira workspace and no workspace at all', () => {
    expect(standupProjectShortNames(ws('j', [['DEMO']], { kind: 'jira', siteUrl: 'https://example.atlassian.net', credentialRef: 'jira-1' }), ALL))
      .toEqual({ ok: false, error: JIRA_STANDUP_UNSUPPORTED_MESSAGE });
    expect(standupProjectShortNames(null, ALL).ok).toBe(false);
  });

  it('a YouTrack workspace on another server is fine: it reads through its own connection', () => {
    expect(standupProjectShortNames(ws('o', [['0-1']], { kind: 'youtrack', serverUrl: 'https://other.example.com', credentialRef: 'youtrack-2' }), ALL))
      .toEqual({ ok: true, shortNames: ['HOME'] });
  });
});

describe('standupAvailability', () => {
  it('is available for a YouTrack workspace on the configured server, and for legacy', () => {
    expect(standupAvailability({ kind: 'youtrack', serverUrl: `${YT}/`, credentialRef: null }).available).toBe(true);
    expect(standupAvailability(null).available).toBe(true);
  });

  it('is unavailable, with the Phase 1 reason, for a Jira workspace', () => {
    expect(standupAvailability({ kind: 'jira', siteUrl: 'https://example.atlassian.net', credentialRef: 'jira-1' })).toEqual({
      available: false,
      reason: JIRA_STANDUP_UNSUPPORTED_MESSAGE,
    });
  });
});
