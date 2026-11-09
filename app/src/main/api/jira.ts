// Jira Cloud REST client (main process). Basic auth with the account email and
// an API token, which may be either kind Atlassian issues:
//   classic (unscoped) → works against the site URL, https://<site>.atlassian.net
//   scoped             → works only through the gateway,
//                        https://api.atlassian.com/ex/jira/<cloudId>
// A token's kind cannot be read from the token itself, so probeJiraToken()
// tries the site URL first and falls back to the gateway (proposal §4 B3).
//
// The cloudId comes from <site>/_edge/tenant_info, which needs no auth. It is
// documented in an Atlassian KB but not as a supported API, so callers keep a
// hand-entered cloudId as the fallback when detection fails.

import type { JiraProfile } from '../../shared/jiraProfile';
import { JIRA_LIST_FIELDS, type JiraSearchIssue } from '../../shared/jiraIssue';

export const JIRA_GATEWAY = 'https://api.atlassian.com';

export interface JiraError {
  status?: number;
  message: string;
}

export type JiraTokenKind = 'classic' | 'scoped';

export interface JiraAccount {
  accountId: string;
  displayName: string;
  emailAddress: string; // '' when the user's privacy settings hide it
}

export type JiraProbeResult =
  | { ok: true; kind: JiraTokenKind; cloudId: string; account: JiraAccount }
  | {
      ok: false;
      // unauthorized: neither the site URL nor the gateway accepted the token.
      // cloudid-unavailable: the site URL rejected it, and without a cloudId
      //   the gateway (the only route a scoped token has) cannot be tried.
      // error: network failure or an unexpected HTTP status.
      reason: 'unauthorized' | 'cloudid-unavailable' | 'error';
      cloudId: string;
      message: string;
      status?: number;
    };

export function siteApiBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

export function gatewayApiBase(cloudId: string): string {
  return `${JIRA_GATEWAY}/ex/jira/${encodeURIComponent(cloudId)}`;
}

function basicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}`;
}

async function toError(res: Response): Promise<JiraError> {
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    // Jira REST errors: { errorMessages: [...], errors: {...} }; the gateway
    // and _edge endpoints use { message } instead.
    const body = (await res.json()) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
      message?: string;
    };
    const candidate =
      body.errorMessages?.[0] || Object.values(body.errors ?? {})[0] || body.message;
    if (candidate) message = candidate;
  } catch {
    // non-JSON error body; keep statusText
  }
  return { status: res.status, message };
}

async function request<T>(
  base: string,
  email: string,
  token: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: basicAuth(email, token),
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

function isAuthFailure(e: unknown): boolean {
  const status = (e as JiraError | undefined)?.status;
  return status === 401 || status === 403;
}

// Returns the site's cloudId, or null when the endpoint is unreachable, errors,
// or answers without one. Never throws: the caller falls back to a manual entry.
export async function detectCloudId(siteUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${siteApiBase(siteUrl)}/_edge/tenant_info`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { cloudId?: unknown };
    return typeof body.cloudId === 'string' && body.cloudId.trim() ? body.cloudId.trim() : null;
  } catch {
    return null;
  }
}

interface MyselfResponse {
  accountId: string;
  displayName?: string;
  emailAddress?: string;
}

// GET /rest/api/3/myself against either API base. Throws JiraError.
export async function getMyself(base: string, email: string, token: string): Promise<JiraAccount> {
  const me = await request<MyselfResponse>(base, email, token, '/rest/api/3/myself');
  return {
    accountId: me.accountId,
    displayName: me.displayName ?? '',
    emailAddress: me.emailAddress ?? '',
  };
}

// Classifies the token by which route accepts it: the site URL means classic,
// the gateway after a 401/403 at the site URL means scoped. Detects the
// cloudId when the profile has none; the result carries the cloudId (detected
// or as given) so the caller can save it back to the profile. Never throws.
export async function probeJiraToken(profile: JiraProfile, token: string): Promise<JiraProbeResult> {
  const cloudId = profile.cloudId || (await detectCloudId(profile.siteUrl)) || '';

  let siteFailure: unknown;
  try {
    const account = await getMyself(siteApiBase(profile.siteUrl), profile.email, token);
    return { ok: true, kind: 'classic', cloudId, account };
  } catch (e) {
    siteFailure = e;
  }

  // Only an auth rejection at the site URL suggests a scoped token; a network
  // failure or unexpected status there is reported as itself.
  if (!isAuthFailure(siteFailure)) {
    return { ok: false, reason: 'error', cloudId, message: errorMessage(siteFailure), status: (siteFailure as JiraError)?.status };
  }
  if (!cloudId) {
    return {
      ok: false,
      reason: 'cloudid-unavailable',
      cloudId,
      message: 'The site URL rejected the token, and the cloudId needed to try the scoped-token gateway could not be detected. Enter the cloudId by hand.',
      status: (siteFailure as JiraError).status,
    };
  }

  try {
    const account = await getMyself(gatewayApiBase(cloudId), profile.email, token);
    return { ok: true, kind: 'scoped', cloudId, account };
  } catch (e) {
    if (isAuthFailure(e)) {
      return {
        ok: false,
        reason: 'unauthorized',
        cloudId,
        message: 'Jira rejected the token at both the site URL and the scoped-token gateway — it is wrong, expired or revoked, or the email does not match it.',
        status: (e as JiraError).status,
      };
    }
    return { ok: false, reason: 'error', cloudId, message: errorMessage(e), status: (e as JiraError)?.status };
  }
}

// --- Issue search (VERM-21) ---

// Unresolved issues assigned to the token's user, most recently updated first.
export const MY_OPEN_ISSUES_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';

export const SEARCH_PAGE_SIZE = 100;
// A runaway guard, not a feature limit: 10 pages is 1,000 issues.
export const SEARCH_MAX_PAGES = 10;

interface SearchJqlResponse {
  issues?: JiraSearchIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

// POST /rest/api/3/search/jql, following nextPageToken until isLast (the
// endpoint reports no total, CHANGE-2046). Stops after maxPages. Throws JiraError.
export async function searchJql(
  base: string,
  email: string,
  token: string,
  jql: string,
  fields: readonly string[],
  maxPages = SEARCH_MAX_PAGES,
): Promise<JiraSearchIssue[]> {
  const issues: JiraSearchIssue[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await request<SearchJqlResponse>(base, email, token, '/rest/api/3/search/jql', {
      jql,
      fields,
      maxResults: SEARCH_PAGE_SIZE,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    issues.push(...(res.issues ?? []));
    if (res.isLast !== false || !res.nextPageToken) break;
    nextPageToken = res.nextPageToken;
  }
  return issues;
}

// The read-only Jira list: probes first to learn which route this token works
// through (site URL or gateway), then searches there. Throws JiraError when
// the probe fails, carrying the probe's explanation.
export async function searchMyOpenIssues(profile: JiraProfile, token: string): Promise<JiraSearchIssue[]> {
  const probe = await probeJiraToken(profile, token);
  if (!probe.ok) {
    const err: JiraError = { status: probe.status, message: probe.message };
    throw err;
  }
  const base = probe.kind === 'classic' ? siteApiBase(profile.siteUrl) : gatewayApiBase(probe.cloudId);
  return searchJql(base, profile.email, token, MY_OPEN_ISSUES_JQL, JIRA_LIST_FIELDS);
}
