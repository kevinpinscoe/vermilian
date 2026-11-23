// In-memory Jira stand-in for the e2e harness (VERMILIAN_E2E=1). Mirrors the
// surface of ./jira so jiraClient.ts can swap it in; no network access.
// Any token is accepted as classic except FAKE_JIRA_BAD_TOKEN, which both
// routes reject, so a spec can exercise the failure path.

import type { JiraProfile } from '../../shared/jiraProfile';
import { isValidBoardId, isValidProjectKey, JIRA_BOARD_SCOPE, projectRecentlyUpdatedJql, siteApiBase, type JiraBoard, type BoardIssueOptions, type JiraAccount, type JiraComment, type JiraEditMeta, type JiraProbeResult, type JiraProject, type ProjectSearchOptions, type RecentlyUpdatedOptions } from './jira';
import { JIRA_POLL_WINDOW_MINUTES } from '../../shared/jiraPoll';
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
  projectRecentlyUpdatedJql,
  BOARD_PAGE_SIZE,
  BOARD_MAX_PAGES,
  isValidBoardId,
  boardIssuesJql,
  boardRecentlyUpdatedJql,
  JIRA_WORK_SCOPE,
  JIRA_BOARD_SCOPE,
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
  RecentlyUpdatedOptions,
  JiraBoard,
  BoardIssueOptions,
} from './jira';

export const FAKE_JIRA_CLOUD_ID = 'e2e00000-0000-4000-8000-000000000000';
export const FAKE_JIRA_BAD_TOKEN = 'e2e-bad-jira-token';

const ACCOUNT: JiraAccount = {
  accountId: 'e2e-account',
  displayName: 'E2E Jira User',
  emailAddress: 'e2e@example.com',
};

// ── e2e observation (VERM-39) ────────────────────────────────────────────────
// Every call into this fake is logged, so a spec can see how often the board
// polled, which reads it made, and that it made nothing but reads. A search
// can be held back for a while to put a poll "in flight".

export interface FakeJiraCall {
  fn: string;
  projectKey?: string;
  key?: string;
  jql?: string;
  boardId?: number;
  at: number;
}

const calls: FakeJiraCall[] = [];
let searchDelayMs = 0;
// Holds back a single-issue read (getIssue), so a test can act while one is
// in flight — the Runway add's exact-key check (VERM-86).
let getIssueDelayMs = 0;
// Issue ids no search lists (simulated index lag); getIssue still finds them.
const unindexed = new Set<string>();
// Keys issues were moved from (VERM-88): like Jira, a read by an old key
// still answers with the moved issue, under its new key.
const movedFrom = new Map<string, string>();
// VERM-88 test hooks: failing key-list reads, and a held getIssue.
let keyReadsFail = false;
let movedKeysHidden = false;
let getIssueHold: Promise<void> | null = null;
let releaseGetIssueHold: (() => void) | null = null;

/** The issue a key names now: by its own key, or by a key it was moved from. */
function issueByKey(key: string): JiraSearchIssue | undefined {
  const direct = FAKE_JIRA_ISSUES.find((i) => i.key === key);
  if (direct) return direct;
  const id = movedKeysHidden ? undefined : movedFrom.get(key);
  return id === undefined ? undefined : FAKE_JIRA_ISSUES.find((i) => i.id === id);
}

function logCall(fn: string, detail: Omit<FakeJiraCall, 'fn' | 'at'> = {}): void {
  calls.push({ fn, ...detail, at: Date.now() });
}

async function searchDelay(): Promise<void> {
  if (searchDelayMs > 0) await new Promise((r) => setTimeout(r, searchDelayMs));
}

export async function detectCloudId(_siteUrl: string): Promise<string | null> {
  logCall('detectCloudId');
  return FAKE_JIRA_CLOUD_ID;
}

export async function getMyself(_base: string, _email: string, token: string): Promise<JiraAccount> {
  logCall('getMyself');
  if (token === FAKE_JIRA_BAD_TOKEN) throw { status: 401, message: 'Client must be authenticated' };
  return { ...ACCOUNT };
}

export async function probeJiraToken(profile: JiraProfile, token: string): Promise<JiraProbeResult> {
  logCall('probeJiraToken');
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
      assignee: { accountId: 'e2e-account', displayName: 'E2E Jira User' },
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
      assignee: { accountId: 'e2e-account-dana', displayName: 'Dana Ops' },
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
  // Done, so it is off the board while Show done is off and the board search
  // must reach the backend to find it (VERM-61). Every other read path that
  // lists open issues leaves it out.
  {
    id: '10009',
    key: 'DEMO-109',
    fields: {
      summary: 'Archive the legacy runbook',
      status: { name: 'Done', statusCategory: { key: 'done' } },
      priority: { name: 'Low' },
      updated: '2026-11-01T10:00:00.000+0000',
    },
  },
];

// The board search's text JQL (shared/jiraBoardIssue.ts jiraSearchJql):
// `project in ("A", "B") AND text ~ "term" ORDER BY …`. The fake honours just
// that shape — project list and a case-insensitive summary match — so a spec
// can tell a backend search from a local filter (VERM-61).
function fakeTextSearch(jql: string): JiraSearchIssue[] | null {
  const text = /text ~ "((?:[^"\\]|\\.)*)"/.exec(jql);
  if (!text) return null;
  const term = text[1].replace(/\\(.)/g, '$1').toLowerCase();
  const projects = [...(/project in \(([^)]*)\)/.exec(jql)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return FAKE_JIRA_ISSUES.filter(
    (i) =>
      !unindexed.has(i.id) &&
      projects.some((k) => i.key.startsWith(`${k}-`)) &&
      (i.fields?.summary ?? '').toLowerCase().includes(term),
  );
}

export async function searchJql(
  _base: string,
  _email: string,
  token: string,
  _jql: string,
  _fields: readonly string[],
  _maxPages?: number,
): Promise<JiraSearchIssue[]> {
  logCall('searchJql', { jql: _jql });
  if (token === FAKE_JIRA_BAD_TOKEN) throw { status: 401, message: 'Client must be authenticated' };
  // `key in ("A", "B")` (VERM-84): like Jira, one unknown key fails the whole query.
  const keyList = /^key in \(([^)]*)\)$/.exec(_jql);
  if (keyList) {
    if (keyReadsFail) throw { status: 503, message: 'Service Unavailable' };
    const keys = [...keyList[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const hits = keys.map((k) => issueByKey(k));
    if (hits.some((i) => !i)) throw { status: 400, message: "An issue with key does not exist for field 'key'." };
    return (hits as JiraSearchIssue[]).map((i) => ({ ...i, fields: { ...i.fields } }));
  }
  const found = fakeTextSearch(_jql) ?? FAKE_JIRA_ISSUES.filter((i) => i.fields?.status?.statusCategory?.key !== 'done');
  return found.map((i) => ({ ...i, fields: { ...i.fields } }));
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
  logCall('jiraApiBase');
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
  logCall('getIssue', { key });
  if (getIssueDelayMs > 0) await new Promise((r) => setTimeout(r, getIssueDelayMs));
  if (getIssueHold) await getIssueHold;
  rejectBadToken(token);
  if (!isValidLocalId('jira', key)) throw { message: `Invalid Jira issue key: ${JSON.stringify(key)}` };
  const issue = issueByKey(key);
  if (!issue) throw { status: 404, message: 'Issue does not exist or you do not have permission to see it.' };
  // The detail panel's extra fields (VERM-35): project, due date, description.
  const project = FAKE_JIRA_PROJECTS.find((p) => issue.key.startsWith(`${p.key}-`));
  const extra: Record<string, unknown> = { ...(FAKE_JIRA_DETAIL_FIELDS[issue.key] ?? FAKE_JIRA_DETAIL_FIELDS[key]) };
  if (project) extra.project = { ...project };
  return { ...issue, fields: { ...issue.fields, ...extra } as JiraSearchIssue['fields'] };
}

// ── Issue detail (VERM-35) ───────────────────────────────────────────────────
// DEMO-101 carries an ADF description exercising headings, lists, code, a safe
// link and an unsafe one (which must render as text); DEMO-102 has none.
export const FAKE_JIRA_DETAIL_FIELDS: Record<string, Record<string, unknown>> = {
  'DEMO-101': {
    duedate: '2026-12-01',
    description: {
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Generate a new credential' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Update the ' }, { type: 'text', text: 'staging', marks: [{ type: 'strong' }] }, { type: 'text', text: ' secret' }] }] },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Runbook', marks: [{ type: 'link', attrs: { href: 'https://example.com/runbook' } }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'not a link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            { type: 'text', text: ' <b>raw html</b>' },
          ],
        },
      ],
    },
  },
};

export async function listProjects(_base: string, _email: string, token: string, _maxPages?: number): Promise<JiraProject[]> {
  logCall('listProjects');
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
  logCall('searchProjectIssues', { projectKey, jql: isValidProjectKey(projectKey) ? projectIssuesJqlFor(projectKey, options.includeResolved) : undefined });
  rejectBadToken(token);
  if (!isValidProjectKey(projectKey)) throw { message: `Invalid Jira project key: ${JSON.stringify(projectKey)}` };
  await searchDelay();
  return FAKE_JIRA_ISSUES.filter(
    (i) =>
      !unindexed.has(i.id) &&
      i.key.startsWith(`${projectKey}-`) &&
      (options.includeResolved || i.fields?.status?.statusCategory?.key !== 'done'),
  ).map((i) => ({ ...i, fields: { ...i.fields } }));
}

// ── Workflow statuses (VERM-67) ──────────────────────────────────────────────
// Fictional workflows. In Review and Done have no open fixture issue.
export const FAKE_JIRA_STATUSES: Record<string, string[]> = {
  DEMO: ['To Do', 'In Progress', 'In Review', 'Done'],
  OPS: ['Waiting', 'Done'],
};
let statusReadsFail = false;

export async function listProjectStatuses(_base: string, _email: string, token: string, projectKey: string): Promise<string[]> {
  logCall('listProjectStatuses', { projectKey });
  rejectBadToken(token);
  if (statusReadsFail) throw { status: 403, message: 'Unauthorized; scope does not match' };
  return [...(FAKE_JIRA_STATUSES[projectKey] ?? [])];
}

// ── Priority schemes (VERM-30) ───────────────────────────────────────────────
// Fictional schemes, most urgent first. DEMO deliberately differs from the
// YouTrack list; OPS has no priority field on its screens.
export const FAKE_JIRA_PRIORITY_SCHEMES: Record<string, string[]> = {
  DEMO: ['Highest', 'High', 'Medium', 'Low', 'Lowest', 'None'],
};

export async function getEditMeta(_base: string, _email: string, token: string, key: string): Promise<JiraEditMeta> {
  logCall('getEditMeta');
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
  'DEMO-101': [
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
    {
      id: '30002',
      author: { displayName: 'Fictional Reviewer' },
      created: '2026-11-11T10:00:00.000+0000',
      updated: '2026-11-11T11:30:00.000+0000',
      body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verified, thanks.' }] }] },
    },
  ],
};

export async function getIssueComments(_base: string, _email: string, token: string, key: string, _maxPages?: number): Promise<JiraComment[]> {
  logCall('getIssueComments');
  rejectBadToken(token);
  if (!isValidLocalId('jira', key)) throw { message: `Invalid Jira issue key: ${JSON.stringify(key)}` };
  if (!FAKE_JIRA_ISSUES.some((i) => i.key === key)) throw { status: 404, message: 'Issue does not exist or you do not have permission to see it.' };
  return (FAKE_JIRA_COMMENTS[key] ?? []).map((c) => ({ ...c }));
}

// ── Recently updated issues (VERM-39) ────────────────────────────────────────
// The same bounded window the real client asks Jira for, evaluated against
// this process's clock: an issue counts when its `updated` is within the last
// windowMinutes. Resolved issues are included, as the real JQL includes them.

function projectIssuesJqlFor(projectKey: string, includeResolved?: boolean): string {
  return `project = "${projectKey}"${includeResolved ? '' : ' AND statusCategory != Done'} ORDER BY updated DESC`;
}

export async function searchProjectRecentlyUpdated(
  _base: string,
  _email: string,
  token: string,
  projectKey: string,
  options: RecentlyUpdatedOptions = {},
): Promise<JiraSearchIssue[]> {
  const windowMinutes = options.windowMinutes ?? JIRA_POLL_WINDOW_MINUTES;
  // Validates the key and window exactly as the real client does.
  const jql = projectRecentlyUpdatedJql(projectKey, windowMinutes);
  logCall('searchProjectRecentlyUpdated', { projectKey, jql });
  rejectBadToken(token);
  await searchDelay();
  const since = Date.now() - windowMinutes * 60_000;
  return FAKE_JIRA_ISSUES.filter((i) => {
    const at = Date.parse(String(i.fields?.updated ?? ''));
    return !unindexed.has(i.id) && i.key.startsWith(`${projectKey}-`) && !Number.isNaN(at) && at >= since;
  }).map((i) => ({ ...i, fields: { ...i.fields } }));
}

// ── Test hooks (VERMILIAN_E2E only; registered in main/ipc.ts) ───────────────
// Change the fake's issues as someone editing them in Jira would. Every
// change stamps `updated` with this process's current time.

export type FakeJiraChange =
  | { op: 'edit'; key: string; summary?: string; status?: { name: string; category: 'new' | 'indeterminate' | 'done' } }
  | { op: 'create'; id: string; key: string; summary: string }
  | { op: 'delete'; key: string }
  | { op: 'move'; key: string; toKey: string; touch?: boolean }
  // Search-index lag: the issue stays readable by key but no search lists it.
  | { op: 'unindex'; key: string }
  // A token that cannot read workflow statuses (VERM-67).
  | { op: 'failStatusReads' }
  // Reads by key list (`key in (…)`, the Runway's batch read) answer 503
  // until restored (VERM-88).
  | { op: 'failKeyReads' }
  | { op: 'restoreKeyReads' }
  // getIssue waits until released: a check held mid-flight (VERM-88).
  | { op: 'holdGetIssue' }
  | { op: 'releaseGetIssue' }
  // A read by a moved issue's old key answers 404 (single read) or fails the
  // key list (batch) until shown again, as when Jira will not say where an
  // issue went (VERM-88).
  | { op: 'hideMovedKeys' }
  | { op: 'showMovedKeys' };

function stampNow(): string {
  return new Date().toISOString();
}

export function applyChangeForTests(change: FakeJiraChange): boolean {
  if (change.op === 'failStatusReads') {
    statusReadsFail = true;
    return true;
  }
  if (change.op === 'failKeyReads' || change.op === 'restoreKeyReads') {
    keyReadsFail = change.op === 'failKeyReads';
    return true;
  }
  if (change.op === 'hideMovedKeys' || change.op === 'showMovedKeys') {
    movedKeysHidden = change.op === 'hideMovedKeys';
    return true;
  }
  if (change.op === 'holdGetIssue') {
    if (!getIssueHold) getIssueHold = new Promise<void>((resolve) => (releaseGetIssueHold = resolve));
    return true;
  }
  if (change.op === 'releaseGetIssue') {
    releaseGetIssueHold?.();
    getIssueHold = null;
    releaseGetIssueHold = null;
    return true;
  }
  if (change.op === 'create') {
    if (FAKE_JIRA_ISSUES.some((i) => i.key === change.key || i.id === change.id)) return false;
    FAKE_JIRA_ISSUES.push({
      id: change.id,
      key: change.key,
      fields: { summary: change.summary, status: { name: 'To Do', statusCategory: { key: 'new' } }, priority: { name: 'Medium' }, updated: stampNow() },
    });
    return true;
  }
  const at = FAKE_JIRA_ISSUES.findIndex((i) => i.key === change.key);
  if (at < 0) return false;
  const issue = FAKE_JIRA_ISSUES[at];
  if (change.op === 'unindex') {
    unindexed.add(issue.id);
  } else if (change.op === 'delete') {
    FAKE_JIRA_ISSUES.splice(at, 1);
  } else if (change.op === 'move') {
    // Jira gives a moved issue a new key and keeps its id. A move it does not
    // touch leaves `updated` alone, so only a full read can notice it.
    movedFrom.set(issue.key, issue.id);
    FAKE_JIRA_ISSUES[at] = { ...issue, key: change.toKey, fields: { ...issue.fields, ...(change.touch ? { updated: stampNow() } : {}) } };
  } else {
    const fields = { ...issue.fields, updated: stampNow() };
    if (change.summary !== undefined) fields.summary = change.summary;
    if (change.status) fields.status = { name: change.status.name, statusCategory: { key: change.status.category } };
    FAKE_JIRA_ISSUES[at] = { ...issue, fields };
  }
  return true;
}

export function getCallsForTests(): FakeJiraCall[] {
  return calls.map((c) => ({ ...c }));
}

export function setSearchDelayForTests(ms: number): void {
  searchDelayMs = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 30_000) : 0;
}

export function setGetIssueDelayForTests(ms: number): void {
  getIssueDelayMs = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 30_000) : 0;
}

// ── Boards (VERM-59) ─────────────────────────────────────────────────────────
// Two fictional boards. "Ops tasks" spans two projects: its filter takes
// OPS-7 and DEMO-102, so a workspace that chose only that board must still
// open DEMO-102. Membership is by key, standing in for each board's filter.
export const FAKE_JIRA_BOARDS: Array<JiraBoard & { keys: string[] }> = [
  { id: 1, name: 'DEMO planned work', type: 'scrum', projectKey: 'DEMO', keys: ['DEMO-101', 'DEMO-109'] },
  { id: 2, name: 'Ops tasks', type: 'kanban', projectKey: 'OPS', keys: ['OPS-7', 'DEMO-102'] },
];

export async function listBoards(_base: string, _email: string, token: string, _maxPages?: number): Promise<JiraBoard[]> {
  logCall('listBoards');
  rejectBadToken(token);
  return FAKE_JIRA_BOARDS.map(({ keys: _keys, ...b }) => ({ ...b }));
}

// Honours the narrowing JQL the real callers build: statusCategory != Done,
// updated >= -Nm, key = "X" and text ~ "term".
export async function searchBoardIssues(
  _base: string,
  _email: string,
  token: string,
  boardId: number,
  options: BoardIssueOptions = {},
): Promise<JiraSearchIssue[]> {
  const jql = options.jql ?? '';
  logCall('searchBoardIssues', { boardId, jql });
  rejectBadToken(token);
  if (!isValidBoardId(boardId)) throw { message: `Invalid Jira board ID: ${JSON.stringify(boardId)}` };
  const board = FAKE_JIRA_BOARDS.find((b) => b.id === boardId);
  if (!board) throw { status: 404, message: 'The requested board cannot be viewed because it either does not exist or you do not have permission to view it.' };
  await searchDelay();
  const window = /updated >= -(\d+)m/.exec(jql);
  const since = window ? Date.now() - Number(window[1]) * 60_000 : null;
  const key = /key = "([^"]+)"/.exec(jql)?.[1] ?? null;
  const text = /text ~ "((?:[^"\\]|\\.)*)"/.exec(jql)?.[1]?.replace(/\\(.)/g, '$1').toLowerCase() ?? null;
  return FAKE_JIRA_ISSUES.filter((i) => {
    if (unindexed.has(i.id) || !board.keys.includes(i.key)) return false;
    if (jql.includes('statusCategory != Done') && i.fields?.status?.statusCategory?.key === 'done') return false;
    if (since !== null) {
      const at = Date.parse(String(i.fields?.updated ?? ''));
      if (Number.isNaN(at) || at < since) return false;
    }
    if (key !== null && i.key !== key) return false;
    if (text !== null && !(i.fields?.summary ?? '').toLowerCase().includes(text)) return false;
    return true;
  }).map((i) => ({ ...i, fields: { ...i.fields } }));
}

export async function isIssueOnBoard(base: string, email: string, token: string, boardId: number, key: string): Promise<boolean> {
  const found = await searchBoardIssues(base, email, token, boardId, { jql: `key = "${key}"`, fields: ['summary'], maxPages: 1 });
  return found.some((i) => i.key === key);
}

// VERMILIAN_E2E_JIRA_NO_BOARD_SCOPE=1 simulates a scoped token without the
// board scope, for Test connection.
export async function missingJiraScopes(_base: string, _email: string, token: string): Promise<string[]> {
  logCall('missingJiraScopes');
  rejectBadToken(token);
  return process.env.VERMILIAN_E2E_JIRA_NO_BOARD_SCOPE === '1' ? [JIRA_BOARD_SCOPE] : [];
}
