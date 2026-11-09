import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  youtrack: {
    findJiraArticle: vi.fn(),
    createJiraArticle: vi.fn(),
    updateVermilianArticle: vi.fn(),
  },
}));

vi.mock('./credentials', () => ({
  FILES: { jiraToken: 'jira.token.bin' },
  loadSecretWithSources: vi.fn(),
  hasSecretWithSources: vi.fn(),
}));

import { youtrack } from '../api/client';
import { loadSecretWithSources, hasSecretWithSources } from './credentials';
import { getJiraProfile, saveJiraProfile, loadJiraToken, hasJiraToken } from './jiraProfile';

const yt = youtrack as unknown as Record<string, ReturnType<typeof vi.fn>>;
const URL = 'https://youtrack.example.com';
const TOKEN = 'yt-token';
const PROFILE = { siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '' };

beforeEach(() => vi.resetAllMocks());

describe('getJiraProfile', () => {
  it('returns null when the article does not exist', async () => {
    yt.findJiraArticle.mockResolvedValue(null);
    expect(await getJiraProfile(URL, TOKEN)).toBeNull();
  });

  it('returns the parsed profile', async () => {
    yt.findJiraArticle.mockResolvedValue({ id: 'a1', content: JSON.stringify({ version: 1, profile: PROFILE }), updated: 1 });
    expect(await getJiraProfile(URL, TOKEN)).toEqual(PROFILE);
  });
});

describe('saveJiraProfile', () => {
  it('creates the article on first save', async () => {
    yt.findJiraArticle.mockResolvedValue(null);
    yt.createJiraArticle.mockResolvedValue({ id: 'a1', content: '', updated: 1 });
    await saveJiraProfile(URL, TOKEN, { ...PROFILE, siteUrl: 'https://example.atlassian.net/' });
    const content = yt.createJiraArticle.mock.calls[0][2] as string;
    expect(JSON.parse(content).profile).toEqual(PROFILE);
  });

  it('updates the existing article in place', async () => {
    yt.findJiraArticle.mockResolvedValue({ id: 'a1', content: '{}', updated: 1 });
    yt.updateVermilianArticle.mockResolvedValue({ updated: 2 });
    await saveJiraProfile(URL, TOKEN, { ...PROFILE, cloudId: 'abc' });
    expect(yt.updateVermilianArticle).toHaveBeenCalledWith(URL, TOKEN, 'a1', expect.stringContaining('"cloudId": "abc"'));
    expect(yt.createJiraArticle).not.toHaveBeenCalled();
  });

  it('never writes a token into the article', async () => {
    yt.findJiraArticle.mockResolvedValue(null);
    yt.createJiraArticle.mockResolvedValue({ id: 'a1', content: '', updated: 1 });
    await saveJiraProfile(URL, TOKEN, { ...PROFILE, token: 'jira-secret' } as typeof PROFILE);
    expect(yt.createJiraArticle.mock.calls[0][2]).not.toContain('jira-secret');
  });

  it('rejects an invalid profile without writing', async () => {
    await expect(saveJiraProfile(URL, TOKEN, { siteUrl: 'http://x', email: 'user@example.com' })).rejects.toThrow(
      'JIRA_PROFILE_INVALID',
    );
    expect(yt.findJiraArticle).not.toHaveBeenCalled();
  });

  it('throws when the update fails', async () => {
    yt.findJiraArticle.mockResolvedValue({ id: 'a1', content: '{}', updated: 1 });
    yt.updateVermilianArticle.mockResolvedValue(null);
    await expect(saveJiraProfile(URL, TOKEN, PROFILE)).rejects.toThrow('JIRA_PROFILE_WRITE_FAILED');
  });
});

describe('Jira token', () => {
  it('loads through the command → file → safeStorage chain', async () => {
    (loadSecretWithSources as ReturnType<typeof vi.fn>).mockResolvedValue('jira-token');
    const cfg = { jiraTokenCommand: 'pass show jira', jiraTokenFile: '/run/jira' };
    expect(await loadJiraToken(cfg)).toBe('jira-token');
    expect(loadSecretWithSources).toHaveBeenCalledWith('jira.token.bin', 'pass show jira', '/run/jira');
  });

  it('reports availability through the same chain', async () => {
    (hasSecretWithSources as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    expect(await hasJiraToken({ jiraTokenCommand: '', jiraTokenFile: '' })).toBe(false);
    expect(hasSecretWithSources).toHaveBeenCalledWith('jira.token.bin', '', '');
  });
});
