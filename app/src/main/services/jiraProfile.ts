// Reads and writes the shared Jira connection profile in the
// _vermilian-jira-overlay Article, and loads this host's Jira API token.
//
// The profile is shared through YouTrack so both machines see one connection;
// the token never leaves the host (see shared/jiraProfile.ts).

import type { AppConfig } from '../../shared/config';
import {
  emptyJiraArticle,
  normaliseJiraProfile,
  parseJiraArticle,
  serialiseJiraArticle,
  type JiraProfile,
} from '../../shared/jiraProfile';
import { youtrack as yt } from '../api/client';
import { FILES, hasSecretWithSources, loadSecretWithSources } from './credentials';

export async function getJiraProfile(url: string, token: string): Promise<JiraProfile | null> {
  const article = await yt.findJiraArticle(url, token);
  return article ? parseJiraArticle(article.content).profile : null;
}

// Validates before writing anything; throws on an invalid profile or a failed
// write so the caller can show the reason instead of silently losing the edit.
export async function saveJiraProfile(
  url: string,
  token: string,
  input: Partial<JiraProfile>,
): Promise<JiraProfile> {
  const profile = normaliseJiraProfile(input);
  if (!profile) throw new Error('JIRA_PROFILE_INVALID');

  const existing = await yt.findJiraArticle(url, token);
  const next = { ...(existing ? parseJiraArticle(existing.content) : emptyJiraArticle()), profile };
  const content = serialiseJiraArticle(next);

  if (existing) {
    const result = await yt.updateVermilianArticle(url, token, existing.id, content);
    if (!result) throw new Error('JIRA_PROFILE_WRITE_FAILED');
  } else {
    await yt.createJiraArticle(url, token, content);
  }
  return profile;
}

type JiraTokenSources = Pick<AppConfig, 'jiraTokenCommand' | 'jiraTokenFile'>;

export function loadJiraToken(c: JiraTokenSources): Promise<string | null> {
  return loadSecretWithSources(FILES.jiraToken, c.jiraTokenCommand, c.jiraTokenFile);
}

export function hasJiraToken(c: JiraTokenSources): Promise<boolean> {
  return hasSecretWithSources(FILES.jiraToken, c.jiraTokenCommand, c.jiraTokenFile);
}
