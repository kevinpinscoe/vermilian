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
import { isValidLocalId } from '../../shared/tracker';
import { JIRA_POLL_WINDOW_MINUTES } from '../../shared/jiraPoll';
import { jiraRequest, type JiraError } from './jiraHttp';

export const JIRA_GATEWAY = 'https://api.atlassian.com';

export type { JiraError } from './jiraHttp';

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
  const me = await jiraRequest<MyselfResponse>(base, email, token, '/rest/api/3/myself');
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
    // search/jql is a read sent as POST, so a 429 may be retried.
    const res = await jiraRequest<SearchJqlResponse>(base, email, token, '/rest/api/3/search/jql', {
      body: {
        jql,
        fields,
        maxResults: SEARCH_PAGE_SIZE,
        ...(nextPageToken ? { nextPageToken } : {}),
      },
      idempotent: true,
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
  const base = await jiraApiBase(profile, token);
  return searchJql(base, profile.email, token, MY_OPEN_ISSUES_JQL, JIRA_LIST_FIELDS);
}

// The API base this token works through: the site URL for a classic token,
// the gateway for a scoped one, learned by probing. Throws JiraError when the
// probe fails, carrying the probe's explanation.
export async function jiraApiBase(profile: JiraProfile, token: string): Promise<string> {
  const probe = await probeJiraToken(profile, token);
  if (!probe.ok) {
    const err: JiraError = { status: probe.status, message: probe.message };
    throw err;
  }
  return probe.kind === 'classic' ? siteApiBase(profile.siteUrl) : gatewayApiBase(probe.cloudId);
}

// --- Read client (VERM-28) ---
// Everything below only reads. Nothing in Phase 1 writes to Jira.

function invalid(message: string): JiraError {
  return { message };
}

// GET /rest/api/3/issue/{key}. The key is validated first, so nothing but a
// well-formed Jira key reaches the URL. Throws JiraError (404 when the issue
// does not exist or is hidden from the user).
export async function getIssue(
  base: string,
  email: string,
  token: string,
  key: string,
  fields: readonly string[] = JIRA_LIST_FIELDS,
): Promise<JiraSearchIssue> {
  if (!isValidLocalId('jira', key)) throw invalid(`Invalid Jira issue key: ${JSON.stringify(key)}`);
  const query = fields.length ? `?fields=${encodeURIComponent(fields.join(','))}` : '';
  return jiraRequest<JiraSearchIssue>(base, email, token, `/rest/api/3/issue/${key}${query}`);
}

/** GET /issue/{key}/editmeta: the fields the user may edit, with allowed values. */
export interface JiraEditMeta {
  fields?: Record<string, { name?: string; allowedValues?: Array<{ id?: string; name?: string }> }>;
}

// GET /rest/api/3/issue/{key}/editmeta — read-only despite the name: it
// describes the edit screen and changes nothing. Fields the user cannot edit
// are omitted, so an issue they cannot edit returns no fields at all. The key
// is validated first. Throws JiraError.
export async function getEditMeta(base: string, email: string, token: string, key: string): Promise<JiraEditMeta> {
  if (!isValidLocalId('jira', key)) throw invalid(`Invalid Jira issue key: ${JSON.stringify(key)}`);
  return jiraRequest<JiraEditMeta>(base, email, token, `/rest/api/3/issue/${key}/editmeta`);
}

/** One comment as GET /issue/{key}/comment returns it; the body is ADF. */
export interface JiraComment {
  id: string;
  author?: { displayName?: string } | null;
  body?: unknown;
  created?: string;
  updated?: string;
}

interface CommentPageResponse {
  comments?: JiraComment[];
  startAt?: number;
  maxResults?: number;
  total?: number;
}

export const COMMENT_PAGE_SIZE = 100;
// A runaway guard: 10 pages is 1,000 comments.
export const COMMENT_MAX_PAGES = 10;

// GET /rest/api/3/issue/{key}/comment, oldest first, paged by startAt until
// total is reached. The key is validated first. Throws JiraError.
export async function getIssueComments(
  base: string,
  email: string,
  token: string,
  key: string,
  maxPages = COMMENT_MAX_PAGES,
): Promise<JiraComment[]> {
  if (!isValidLocalId('jira', key)) throw invalid(`Invalid Jira issue key: ${JSON.stringify(key)}`);
  const comments: JiraComment[] = [];
  let startAt = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await jiraRequest<CommentPageResponse>(
      base,
      email,
      token,
      `/rest/api/3/issue/${key}/comment?startAt=${startAt}&maxResults=${COMMENT_PAGE_SIZE}&orderBy=created`,
    );
    const got = res.comments ?? [];
    comments.push(...got);
    startAt += got.length;
    if (got.length === 0 || typeof res.total !== 'number' || startAt >= res.total) break;
  }
  return comments;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export const PROJECT_PAGE_SIZE = 50;
// A runaway guard, not a feature limit: 20 pages is 1,000 projects.
export const PROJECT_MAX_PAGES = 20;

interface ProjectSearchResponse {
  values?: Array<{ id?: string; key?: string; name?: string }>;
  isLast?: boolean;
}

// GET /rest/api/3/project/search, paged by startAt until isLast. Only the
// projects the token's user can browse are returned. Throws JiraError.
export async function listProjects(
  base: string,
  email: string,
  token: string,
  maxPages = PROJECT_MAX_PAGES,
): Promise<JiraProject[]> {
  const projects: JiraProject[] = [];
  let startAt = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await jiraRequest<ProjectSearchResponse>(
      base,
      email,
      token,
      `/rest/api/3/project/search?startAt=${startAt}&maxResults=${PROJECT_PAGE_SIZE}&orderBy=key`,
    );
    const values = res.values ?? [];
    for (const v of values) {
      if (v.id && v.key) projects.push({ id: v.id, key: v.key, name: v.name ?? v.key });
    }
    if (res.isLast !== false || values.length === 0) break;
    startAt += values.length;
  }
  return projects;
}

// GET /rest/api/3/project/{key}/statuses: every status of every issue type in
// the project, each name once (VERM-67). Throws JiraError.
export async function listProjectStatuses(base: string, email: string, token: string, projectKey: string): Promise<string[]> {
  if (!isValidProjectKey(projectKey)) throw new Error(`Invalid Jira project key: ${JSON.stringify(projectKey)}`);
  const res = await jiraRequest<Array<{ statuses?: Array<{ name?: string }> }>>(
    base,
    email,
    token,
    `/rest/api/3/project/${projectKey}/statuses`,
  );
  const names = (Array.isArray(res) ? res : []).flatMap((t) => (t.statuses ?? []).flatMap((s) => (s.name ? [s.name] : [])));
  return [...new Set(names)];
}

// Jira project keys: an uppercase letter, then uppercase letters, digits or
// underscores. Anything else is refused before it reaches JQL.
const JIRA_PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export function isValidProjectKey(key: string): boolean {
  return typeof key === 'string' && JIRA_PROJECT_KEY_RE.test(key);
}

// JQL for one project's issues, most recently updated first; unresolved only
// unless includeResolved. Throws on an invalid key, so no caller text is ever
// spliced into JQL unchecked.
export function projectIssuesJql(projectKey: string, includeResolved = false): string {
  if (!isValidProjectKey(projectKey)) throw invalid(`Invalid Jira project key: ${JSON.stringify(projectKey)}`);
  const open = includeResolved ? '' : ' AND statusCategory != Done';
  return `project = "${projectKey}"${open} ORDER BY updated DESC`;
}

export interface ProjectSearchOptions {
  includeResolved?: boolean;
  fields?: readonly string[];
  maxPages?: number;
}

// One project's issues through search/jql, paged until isLast. Throws JiraError.
export async function searchProjectIssues(
  base: string,
  email: string,
  token: string,
  projectKey: string,
  options: ProjectSearchOptions = {},
): Promise<JiraSearchIssue[]> {
  const jql = projectIssuesJql(projectKey, options.includeResolved);
  return searchJql(base, email, token, jql, options.fields ?? JIRA_LIST_FIELDS, options.maxPages);
}

// --- Recently updated issues (VERM-39) ---
// The incremental poll that keeps a Jira board fresh: a token cannot register
// webhooks, so the board asks for what changed lately (shared/jiraPoll.ts).

// A runaway guard on the window: a day is far beyond any poll gap, which
// falls back to a full read long before that (needsFullRefresh).
const POLL_WINDOW_MAX_MINUTES = 24 * 60;

// JQL for one project's issues updated in the last `windowMinutes`, resolved
// ones included — so an issue that moved to Done is seen and leaves an open
// board. Jira evaluates the relative date against its own clock. Throws on
// an invalid key or window, so nothing unchecked is spliced into JQL.
export function projectRecentlyUpdatedJql(projectKey: string, windowMinutes = JIRA_POLL_WINDOW_MINUTES): string {
  if (!isValidProjectKey(projectKey)) throw invalid(`Invalid Jira project key: ${JSON.stringify(projectKey)}`);
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > POLL_WINDOW_MAX_MINUTES) {
    throw invalid(`Invalid poll window: ${String(windowMinutes)} minutes`);
  }
  return `project = "${projectKey}" AND updated >= -${windowMinutes}m ORDER BY updated DESC`;
}

export interface RecentlyUpdatedOptions {
  windowMinutes?: number;
  fields?: readonly string[];
  maxPages?: number;
}

// One project's recently updated issues through search/jql. Read-only.
// Throws JiraError.
export async function searchProjectRecentlyUpdated(
  base: string,
  email: string,
  token: string,
  projectKey: string,
  options: RecentlyUpdatedOptions = {},
): Promise<JiraSearchIssue[]> {
  const jql = projectRecentlyUpdatedJql(projectKey, options.windowMinutes);
  return searchJql(base, email, token, jql, options.fields ?? JIRA_LIST_FIELDS, options.maxPages);
}

// ── Boards, through the Agile API (VERM-59) ──────────────────────────────────
// Read-only. A board's issues come from the board itself, so its saved filter
// decides which issues (from any project) are on it. Scoped tokens need
// read:board-scope:jira-software and read:jira-work for these calls.

export interface JiraBoard {
  id: number;
  name: string;
  type: string; // 'scrum' | 'kanban' | 'simple', as Jira reports it
  projectKey: string; // the board's location project, '' when none
}

export const BOARD_PAGE_SIZE = 50;
// A runaway guard, not a feature limit: 20 pages is 1,000 boards or issues.
export const BOARD_MAX_PAGES = 20;

interface BoardListResponse {
  values?: Array<{ id?: number; name?: string; type?: string; location?: { projectKey?: string } }>;
  isLast?: boolean;
}

/** Whether a value is a Jira board ID: a positive integer. */
export function isValidBoardId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= Number.MAX_SAFE_INTEGER;
}

// GET /rest/agile/1.0/board, paged by startAt until isLast. Only the boards
// the token's user can see are returned. Throws JiraError.
export async function listBoards(
  base: string,
  email: string,
  token: string,
  maxPages = BOARD_MAX_PAGES,
): Promise<JiraBoard[]> {
  const boards: JiraBoard[] = [];
  let startAt = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await jiraRequest<BoardListResponse>(
      base,
      email,
      token,
      `/rest/agile/1.0/board?startAt=${startAt}&maxResults=${BOARD_PAGE_SIZE}`,
    );
    const values = res.values ?? [];
    for (const v of values) {
      if (isValidBoardId(v.id)) {
        boards.push({ id: v.id, name: v.name || `Board ${v.id}`, type: v.type ?? '', projectKey: v.location?.projectKey ?? '' });
      }
    }
    if (res.isLast !== false || values.length === 0) break;
    startAt += values.length;
  }
  return boards;
}

interface BoardIssuesResponse {
  issues?: JiraSearchIssue[];
  total?: number;
}

export interface BoardIssueOptions {
  // Narrows the board's own filter; never widens it. Built only from the
  // checked helpers below.
  jql?: string;
  fields?: readonly string[];
  maxPages?: number;
  // Called when the page guard stops the read with issues still unread, so
  // the cut is never silent. The result holds the most recently updated.
  onTruncated?: () => void;
}

// GET /rest/agile/1.0/board/{id}/issue, paged by startAt until total.
// Read-only. Throws JiraError.
export async function searchBoardIssues(
  base: string,
  email: string,
  token: string,
  boardId: number,
  options: BoardIssueOptions = {},
): Promise<JiraSearchIssue[]> {
  if (!isValidBoardId(boardId)) throw invalid(`Invalid Jira board ID: ${JSON.stringify(boardId)}`);
  const fields = options.fields ?? JIRA_LIST_FIELDS;
  const query = [
    options.jql ? `jql=${encodeURIComponent(options.jql)}` : '',
    fields.length ? `fields=${encodeURIComponent(fields.join(','))}` : '',
  ].filter(Boolean).join('&');
  const issues: JiraSearchIssue[] = [];
  let startAt = 0;
  for (let page = 0; page < (options.maxPages ?? BOARD_MAX_PAGES); page++) {
    const res = await jiraRequest<BoardIssuesResponse>(
      base,
      email,
      token,
      `/rest/agile/1.0/board/${boardId}/issue?startAt=${startAt}&maxResults=${BOARD_PAGE_SIZE}${query ? `&${query}` : ''}`,
    );
    const batch = res.issues ?? [];
    issues.push(...batch);
    startAt += batch.length;
    if (batch.length === 0 || (typeof res.total === 'number' && startAt >= res.total)) return issues;
  }
  // The guard ran out first: more issues remain unless Jira reported none.
  options.onTruncated?.();
  return issues;
}

// The board's open issues, or all of them with includeResolved.
export function boardIssuesJql(includeResolved = false): string {
  return includeResolved ? 'ORDER BY updated DESC' : 'statusCategory != Done ORDER BY updated DESC';
}

// The board's issues updated in the last `windowMinutes`, resolved included,
// like projectRecentlyUpdatedJql. Throws on an invalid window.
export function boardRecentlyUpdatedJql(windowMinutes = JIRA_POLL_WINDOW_MINUTES): string {
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > POLL_WINDOW_MAX_MINUTES) {
    throw invalid(`Invalid poll window: ${String(windowMinutes)} minutes`);
  }
  return `updated >= -${windowMinutes}m ORDER BY updated DESC`;
}

// Whether an issue is on a board: the board's own filter, narrowed to the
// key. JQL rejects a key that does not exist with a 400, which is "no" here;
// a refused token is not hidden. Throws JiraError on 401/403.
export async function isIssueOnBoard(base: string, email: string, token: string, boardId: number, key: string): Promise<boolean> {
  if (!isValidLocalId('jira', key)) return false;
  try {
    const found = await searchBoardIssues(base, email, token, boardId, { jql: `key = "${key}"`, fields: ['summary'], maxPages: 1 });
    return found.some((i) => i.key === key);
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    if (status === 401 || status === 403) throw e;
    return false;
  }
}

// ── Scope check for Test connection (VERM-59) ────────────────────────────────

export const JIRA_WORK_SCOPE = 'read:jira-work';
export const JIRA_BOARD_SCOPE = 'read:board-scope:jira-software';

// Which of the scopes Vermilian reads with the token lacks, by one minimal
// read each: a one-issue search (read:jira-work) and a one-board listing
// (read:board-scope:jira-software). A 401 or 403 on a read counts as the
// scope missing; any other failure is not reported as a scope. Never throws.
export async function missingJiraScopes(base: string, email: string, token: string): Promise<string[]> {
  const refused = (e: unknown) => {
    const status = (e as { status?: unknown } | null)?.status;
    return status === 401 || status === 403;
  };
  const checks: Array<[string, () => Promise<unknown>]> = [
    [JIRA_WORK_SCOPE, () => jiraRequest(base, email, token, '/rest/api/3/search/jql', { body: { jql: 'ORDER BY created DESC', maxResults: 1, fields: ['summary'] }, idempotent: true })],
    [JIRA_BOARD_SCOPE, () => jiraRequest(base, email, token, '/rest/agile/1.0/board?maxResults=1')],
  ];
  const missing: string[] = [];
  for (const [scope, read] of checks) {
    try {
      await read();
    } catch (e) {
      if (refused(e)) missing.push(scope);
    }
  }
  return missing;
}
