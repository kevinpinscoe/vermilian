// Pure (de)serialisation for the _vermilian-jira-overlay Article, which holds
// the shared, non-secret Jira connection profile (site URL, account email,
// cloudId) so every machine sees the same connection. The Jira API token is
// never stored here — each host loads its own through the credential chain
// (jiraTokenCommand → jiraTokenFile → safeStorage, see credentials.ts).
//
// The profile lives in its own Article rather than in _vermilian-config: a
// client that predates Jira support rewrites _vermilian-config from its own
// cache and would silently drop a field it does not know about.

export const JIRA_ARTICLE_VERSION = 1;

export interface JiraProfile {
  siteUrl: string; // e.g. https://example.atlassian.net — no trailing slash
  email: string; // Atlassian account email used for Basic auth
  cloudId: string; // '' until detected or entered by hand
}

export interface JiraArticle {
  version: number;
  profile: JiraProfile | null;
}

export function emptyJiraArticle(): JiraArticle {
  return { version: JIRA_ARTICLE_VERSION, profile: null };
}

// Lowercases the host, drops any path, query or trailing slash, and requires
// https. Returns null when the value is not a usable site URL.
export function normaliseSiteUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname) return null;
  return `https://${u.host.toLowerCase()}`;
}

// Validates and normalises a profile. Returns null if any required part is
// missing or malformed; cloudId is optional (it can be detected later).
export function normaliseJiraProfile(p: Partial<JiraProfile> | null | undefined): JiraProfile | null {
  if (!p) return null;
  const siteUrl = typeof p.siteUrl === 'string' ? normaliseSiteUrl(p.siteUrl) : null;
  const email = typeof p.email === 'string' ? p.email.trim() : '';
  const cloudId = typeof p.cloudId === 'string' ? p.cloudId.trim() : '';
  if (!siteUrl || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return { siteUrl, email, cloudId };
}

// Tolerates a ```json fence like parseArticleConfig, and falls back to an
// empty article on malformed content. Only the known profile fields are
// kept, so a token pasted into the Article by hand is never read back.
export function parseJiraArticle(raw: string): JiraArticle {
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(stripped) as Partial<JiraArticle>;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : JIRA_ARTICLE_VERSION,
      profile: normaliseJiraProfile(parsed.profile),
    };
  } catch {
    return emptyJiraArticle();
  }
}

export function serialiseJiraArticle(a: JiraArticle): string {
  const profile = a.profile
    ? { siteUrl: a.profile.siteUrl, email: a.profile.email, cloudId: a.profile.cloudId }
    : null;
  return JSON.stringify({ version: a.version, profile }, null, 2);
}
