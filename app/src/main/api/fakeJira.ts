// In-memory Jira stand-in for the e2e harness (VERMILIAN_E2E=1). Mirrors the
// surface of ./jira so jiraClient.ts can swap it in; no network access.
// Any token is accepted as classic except FAKE_JIRA_BAD_TOKEN, which both
// routes reject, so a spec can exercise the failure path.

import type { JiraProfile } from '../../shared/jiraProfile';
import { isValidProjectKey, siteApiBase, type JiraAccount, type JiraComment, type JiraEditMeta, type JiraProbeResult, type JiraProject, type ProjectSearchOptions } from './jira';
import { isValidLocalId } from '../../shared/tracker';
import type { JiraSearchIssue } from '../../shared/jiraIssue';

export {
  JIRA_GATEWAY,
  siteApiBase,
  gatewayApiBase,
  MY_OPEN_ISSUES_JQL,
  SEARCH_PAGE_SIZE,
  SEARCH_MAX_PAGES,
  PROJECT_PAGE_SIZE,
  PROJECT_MAX_PAGES,
  COMMENT_PAGE_SIZE,
  COMMENT_MAX_PAGES,
  isValidProjectKey,
  projectIssuesJql,
} from './jira';
export type {
  JiraError,
  JiraTokenKind,
  JiraAccount,
  JiraProbeResult,
  JiraProject,
  JiraEditMeta,
  JiraComment,
  ProjectSearchOptions,
} from './jira';

export const FAKE_JIRA_CLOUD_ID = 'e2e00000-0000-4000-8000-000000000000';
export const FAKE_JIRA_BAD_TOKEN = 'e2e-bad-jira-token';

const ACCOUNT: JiraAccount = {
  accountId: 'e2e-account',
  displayName: 'E2E Jira User',
  emailAddress: 'e2e@example.com',
};

export async function detectCloudId(_siteUrl: string): Promise<string | null> {
  return FAKE_JIRA_CLOUD_ID;
}

export async function getMyself(_base: string, _email: string, token: string): Promise<JiraAccount> {
  if (token === FAKE_JIRA_BAD_TOKEN) throw { status: 401, message: 'Client must be authenticated' };
  return { ...ACCOUNT };
}

export async function probeJiraToken(profile: JiraProfile, token: string): Promise<JiraProbeResult> {
  const cloudId = profile.cloudId || FAKE_JIRA_CLOUD_ID;
  if (token === FAKE_JIRA_BAD_TOKEN) {
    return {
      ok: false,
      reason: 'unauthorized',
      cloudId,
      message: 'Jira rejected the token at both the site URL and the scoped-token gateway — it is wrong, expired or revoked, or the email does not match it.',
      status: 401,
    };
  }
  return { ok: true, kind: 'classic', cloudId, account: { ...ACCOUNT } };
}

// Deterministic issues for the read-only list (VERM-21). One has no priority
// field, as on a project whose scheme omits it.
export const FAKE_JIRA_ISSUES: JiraSearchIssue[] = [
  {
    id: '10001',
    key: 'DEMO-101',
    fields: {
      summary: 'Rotate the staging database credentials',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'High' },
      updated: '2026-11-09T14:00:00.000+0000',
    },
  },
  {
    id: '10002',
    key: 'DEMO-102',
    fields: {
      summary: 'Document the on-call handover',
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: { name: 'Medium' },
      updated: '2026-11-08T09:30:00.000+0000',
    },
  },
  {
    id: '10003',
    key: 'OPS-7',
    fields: {
      summary: 'Review alert thresholds',
      status: { name: 'Waiting', statusCategory: { key: 'indeterminate' } },
      priority: null,
      updated: '2026-11-07T16:45:00.000+0000',
    },
  },
];

export async function searchJql(
  _base: string,
  _email: string,
  token: string,
  _jql: string,
  _fields: readonly string[],
  _maxPages?: number,
): Promise<JiraSearchIssue[]> {
  if (token === FAKE_JIRA_BAD_TOKEN) throw { status: 401, message: 'Client must be authenticated' };
  return FAKE_JIRA_ISSUES.map((i) => ({ ...i, fields: { ...i.fields } }));
}

export async function searchMyOpenIssues(_profile: JiraProfile, token: string): Promise<JiraSearchIssue[]> {
  return searchJql('', '', token, '', []);
}

// ── Read client (VERM-28) ────────────────────────────────────────────────────

export const FAKE_JIRA_PROJECTS: JiraProject[] = [
  { id: '10000', key: 'DEMO', name: 'Demo' },
  { id: '10010', key: 'OPS', name: 'Operations' },
];

function rejectBadToken(token: string): void {
  if (token === FAKE_JIRA_BAD_TOKEN) throw { status: 401, message: 'Client must be authenticated' };
}

export async function jiraApiBase(profile: JiraProfile, token: string): Promise<string> {
  const probe = await probeJiraToken(profile, token);
  if (!probe.ok) throw { status: probe.status, message: probe.message };
  return siteApiBase(profile.siteUrl);
}

export async function getIssue(
  _base: string,
  _email: string,
  token: string,
  key: string,
  _fields?: readonly string[],
): Promise<JiraSearchIssue> {
  rejectBadToken(token);
  if (!isValidLocalId('jira', key)) throw { message: `Invalid Jira issue key: ${JSON.stringify(key)}` };
  const issue = FAKE_JIRA_ISSUES.find((i) => i.key === key);
  if (!issue) throw { status: 404, message: 'Issue does not exist or you do not have permission to see it.' };
  return { ...issue, fields: { ...issue.fields } };
}

export async function listProjects(_base: string, _email: string, token: string, _maxPages?: number): Promise<JiraProject[]> {
  rejectBadToken(token);
  return FAKE_JIRA_PROJECTS.map((p) => ({ ...p }));
}

export async function searchProjectIssues(
  _base: string,
  _email: string,
  token: string,
  projectKey: string,
  options: ProjectSearchOptions = {},
): Promise<JiraSearchIssue[]> {
  rejectBadToken(token);
  if (!isValidProjectKey(projectKey)) throw { message: `Invalid Jira project key: ${JSON.stringify(projectKey)}` };
  return FAKE_JIRA_ISSUES.filter(
    (i) =>
      i.key.startsWith(`${projectKey}-`) &&
      (options.includeResolved || i.fields?.status?.statusCategory?.key !== 'done'),
  ).map((i) => ({ ...i, fields: { ...i.fields } }));
}

// ── Priority schemes (VERM-30) ───────────────────────────────────────────────
// Fictional schemes, most urgent first. DEMO deliberately differs from the
// YouTrack list; OPS has no priority field on its screens.
export const FAKE_JIRA_PRIORITY_SCHEMES: Record<string, string[]> = {
  DEMO: ['Highest', 'High', 'Medium', 'Low', 'Lowest', 'None'],
};

export async function getEditMeta(_base: string, _email: string, token: string, key: string): Promise<JiraEditMeta> {
  rejectBadToken(token);
  if (!isValidLocalId('jira', key)) throw { message: `Invalid Jira issue key: ${JSON.stringify(key)}` };
  if (!FAKE_JIRA_ISSUES.some((i) => i.key === key)) throw { status: 404, message: 'Issue does not exist or you do not have permission to see it.' };
  const scheme = FAKE_JIRA_PRIORITY_SCHEMES[key.replace(/-\d+$/, '')];
  const fields: NonNullable<JiraEditMeta['fields']> = { summary: { name: 'Summary' } };
  if (scheme) fields.priority = { name: 'Priority', allowedValues: scheme.map((name, i) => ({ id: String(i + 1), name })) };
  return { fields };
}

// ── Comments (VERM-32) ───────────────────────────────────────────────────────

export const FAKE_JIRA_COMMENTS: Record<string, JiraComment[]> = {
  'DEMO-1': [
    {
      id: '30001',
      author: { displayName: 'E2E Jira User' },
      created: '2026-11-10T09:00:00.000+0000',
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rotated in ' }, { type: 'text', text: 'staging', marks: [{ type: 'code' }] }] }],
      },
    },
  ],
};

export async function getIssueComments(_base: string, _email: string, token: string, key: string, _maxPages?: number): Promise<JiraComment[]> {
  rejectBadToken(token);
  if (!isValidLocalId('jira', key)) throw { message: `Invalid Jira issue key: ${JSON.stringify(key)}` };
  if (!FAKE_JIRA_ISSUES.some((i) => i.key === key)) throw { status: 404, message: 'Issue does not exist or you do not have permission to see it.' };
  return (FAKE_JIRA_COMMENTS[key] ?? []).map((c) => ({ ...c }));
}
