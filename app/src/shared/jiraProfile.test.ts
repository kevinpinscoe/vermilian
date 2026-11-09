import { describe, it, expect } from 'vitest';
import {
  JIRA_ARTICLE_VERSION,
  emptyJiraArticle,
  normaliseJiraProfile,
  normaliseSiteUrl,
  parseJiraArticle,
  serialiseJiraArticle,
  type JiraProfile,
} from './jiraProfile';

const profile = (over: Partial<JiraProfile> = {}): JiraProfile => ({
  siteUrl: 'https://example.atlassian.net',
  email: 'user@example.com',
  cloudId: '',
  ...over,
});

describe('normaliseSiteUrl', () => {
  it('strips path, query and trailing slash and lowercases the host', () => {
    expect(normaliseSiteUrl(' https://Example.Atlassian.net/jira/software/?x=1 ')).toBe(
      'https://example.atlassian.net',
    );
  });

  it('rejects http, garbage and empty input', () => {
    expect(normaliseSiteUrl('http://example.atlassian.net')).toBeNull();
    expect(normaliseSiteUrl('example.atlassian.net')).toBeNull();
    expect(normaliseSiteUrl('')).toBeNull();
  });
});

describe('normaliseJiraProfile', () => {
  it('accepts a profile without a cloudId', () => {
    expect(normaliseJiraProfile({ siteUrl: 'https://example.atlassian.net/', email: ' user@example.com ' })).toEqual(
      profile(),
    );
  });

  it('rejects a missing site URL or a malformed email', () => {
    expect(normaliseJiraProfile({ email: 'user@example.com' })).toBeNull();
    expect(normaliseJiraProfile({ siteUrl: 'https://example.atlassian.net', email: 'nope' })).toBeNull();
    expect(normaliseJiraProfile(null)).toBeNull();
  });
});

describe('parseJiraArticle / serialiseJiraArticle', () => {
  it('round-trips a profile', () => {
    const a = { version: JIRA_ARTICLE_VERSION, profile: profile({ cloudId: 'abc-123' }) };
    expect(parseJiraArticle(serialiseJiraArticle(a))).toEqual(a);
  });

  it('round-trips an empty article', () => {
    expect(parseJiraArticle(serialiseJiraArticle(emptyJiraArticle()))).toEqual(emptyJiraArticle());
  });

  it('tolerates a ```json fence', () => {
    const body = '```json\n' + serialiseJiraArticle({ version: 1, profile: profile() }) + '\n```';
    expect(parseJiraArticle(body).profile).toEqual(profile());
  });

  it('falls back to an empty article on malformed content', () => {
    expect(parseJiraArticle('not json')).toEqual(emptyJiraArticle());
  });

  it('never reads or writes a token, even one pasted into the article', () => {
    const raw = JSON.stringify({ version: 1, profile: { ...profile(), token: 'secret', apiToken: 'secret' }, token: 'secret' });
    const parsed = parseJiraArticle(raw);
    expect(parsed.profile).toEqual(profile());
    const written = serialiseJiraArticle({ ...parsed, profile: { ...profile(), token: 'secret' } as JiraProfile });
    expect(written).not.toContain('secret');
  });
});
