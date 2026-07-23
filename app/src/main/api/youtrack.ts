// YouTrack REST client (main process). Modern `/api` namespace only (ADR-0005).
// Custom-field payload shapes per the hosted scripts:
//   enum   → SingleEnumIssueCustomField  value: { name }
//   status → StateIssueCustomField       value: { name }
//   date   → DateIssueCustomField        value: <ms-epoch>  (number, not object)
//   text   → SimpleIssueCustomField      value: <string>

export interface YouTrackError {
  status?: number;
  message: string;
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

async function request<T>(
  url: string,
  token: string,
  pathAndQuery: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${normalizeBase(url)}${pathAndQuery}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error_description?: string;
        error?: string;
        message?: string;
        description?: string;
        error_children?: Array<{ message?: string; description?: string }>;
      };
      // YouTrack returns the most useful message in different fields depending on version/endpoint
      const candidate =
        body.error_description ||
        body.message ||
        body.description ||
        body.error_children?.[0]?.description ||
        body.error_children?.[0]?.message ||
        body.error ||
        message;
      if (candidate) message = candidate;
    } catch {
      // non-JSON error body; keep statusText
    }
    const err: YouTrackError = { status: res.status, message };
    throw err;
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

interface MeResponse {
  login: string;
  name?: string;
  fullName?: string;
}

export async function getCurrentUser(url: string, token: string): Promise<string> {
  const me = await request<MeResponse>(
    url,
    token,
    '/api/users/me?fields=login,name,fullName',
  );
  return me.fullName || me.name || me.login;
}

interface WorkItemType {
  id: string;
  name: string;
}

export async function getWorklogTypes(url: string, token: string): Promise<string[]> {
  try {
    const types = await request<WorkItemType[]>(
      url,
      token,
      '/api/admin/timeTrackingSettings/workItemTypes?fields=id,name',
    );
    const names = types.map((t) => t.name).filter((n): n is string => Boolean(n));
    return names.length ? names : ['Development'];
  } catch {
    return ['Development'];
  }
}

// --- Projects ---

export interface YouTrackProject {
  id: string;
  name: string;
  shortName: string;
}

export async function getProjects(url: string, token: string): Promise<YouTrackProject[]> {
  const projects = await request<Array<YouTrackProject & { archived?: boolean }>>(
    url,
    token,
    '/api/admin/projects?fields=id,name,shortName,archived&$top=1000',
  );
  // Archived projects still appear via /api/admin/projects but cannot be used in a
  // `project:` search query — YouTrack rejects them with a 400 ("isn't used for the
  // project field"). Exclude them so they never reach a board, workspace assignment,
  // or issue query. (Templates remain — they are queryable.)
  return projects
    .filter((p) => !p.archived)
    .map(({ id, name, shortName }) => ({ id, name, shortName }));
}

// --- Issues ---

interface RawCustomField {
  name: string;
  $type: string;
  value: unknown;
}

interface RawIssue {
  id: string;
  idReadable: string;
  summary: string;
  resolved: number | null;
  customFields: RawCustomField[];
}

import type { BoardIssue, IssueDetail } from '../../shared/workspace';
import { buildIssueSearchQuery } from '../../shared/search';
import {
  FIELD_DEFS,
  FIELD_KEYS,
  CREATABLE_FIELD_DEFS,
  getFieldDef,
  toYouTrackValue,
  type FieldDef,
  type FieldKey,
  type BoardIssueFields,
} from '../../shared/fields';

const ISSUE_FIELDS =
  'id,idReadable,summary,resolved,customFields(name,$type,value(name,isResolved,login))';

function parseFieldStringValue(field: RawCustomField): string | null {
  if (field.value === null || field.value === undefined) return null;
  if (typeof field.value === 'string') return field.value;
  if (typeof field.value === 'object') {
    const obj = field.value as Record<string, unknown>;
    const n = obj['name'];
    if (typeof n === 'string') return n;
    const t = obj['text'];
    if (typeof t === 'string') return t;
  }
  return null;
}

function parseFieldNumberValue(field: RawCustomField): number | null {
  if (typeof field.value === 'number') return field.value;
  return null;
}

// Resolves by name AND $type, not name alone — the live instance carries
// duplicate-name prototypes (e.g. two "Status" fields, one StateIssueCustomField
// attached everywhere and one orphaned text prototype attached to nothing).
function extractFieldValue(fields: RawCustomField[], def: FieldDef): string | number | null {
  const raw =
    fields.find((f) => f.name === def.ytName && f.$type === def.$type) ??
    { name: def.ytName, $type: def.$type, value: null };
  if (def.wire === 'user') {
    const val = raw.value as Record<string, unknown> | null;
    return typeof val?.['login'] === 'string' ? (val['login'] as string) : null;
  }
  if (def.wire === 'date' || def.wire === 'integer') return parseFieldNumberValue(raw);
  return parseFieldStringValue(raw);
}

function extractFields(fields: RawCustomField[]): BoardIssueFields {
  const result = {} as Record<FieldKey, string | number | null>;
  for (const key of FIELD_KEYS) {
    result[key] = extractFieldValue(fields, getFieldDef(key));
  }
  return result as unknown as BoardIssueFields;
}

function rawToBoardIssue(issue: RawIssue): BoardIssue {
  return {
    id: issue.id,
    idReadable: issue.idReadable,
    summary: issue.summary,
    resolved: issue.resolved ?? null,
    fields: extractFields(issue.customFields ?? []),
  };
}

export async function getIssues(
  url: string,
  token: string,
  projectShortName: string,
  _includeResolved = false, // reserved for future server-side filtering
): Promise<BoardIssue[]> {
  // An empty/whitespace short name would produce `project: ` — a query YouTrack
  // can't parse (400). Guard it rather than round-trip a guaranteed failure.
  if (!projectShortName?.trim()) return [];
  const query = encodeURIComponent(`project: ${projectShortName}`);
  const raw = await request<RawIssue[]>(
    url,
    token,
    `/api/issues?fields=${ISSUE_FIELDS}&query=${query}&$top=1000`,
  );
  return raw.map(rawToBoardIssue);
}

// Free-text issue search, scoped to a single project. Returns at most 50
// matches (ranked by YouTrack relevance) so the results dropdown stays bounded.
export async function searchIssues(
  url: string,
  token: string,
  projectShortName: string,
  userQuery: string,
): Promise<BoardIssue[]> {
  const q = buildIssueSearchQuery(projectShortName, userQuery);
  if (!q) return [];
  const query = encodeURIComponent(q);
  const raw = await request<RawIssue[]>(
    url,
    token,
    `/api/issues?fields=${ISSUE_FIELDS}&query=${query}&$top=50`,
  );
  return raw.map(rawToBoardIssue);
}

// --- Issue detail (all fields including Notes, Date time entered) ---

const DETAIL_FIELDS =
  'id,idReadable,summary,resolved,project(id,name,shortName),' +
  'customFields(name,$type,value(name,isResolved,text,login))';

interface RawIssueDetail extends RawIssue {
  project: { id: string; name: string; shortName: string };
}

export async function getIssueDetail(
  url: string,
  token: string,
  issueId: string,
): Promise<IssueDetail> {
  const raw = await request<RawIssueDetail>(
    url,
    token,
    `/api/issues/${issueId}?fields=${DETAIL_FIELDS}`,
  );
  return {
    id: raw.id,
    idReadable: raw.idReadable,
    summary: raw.summary,
    resolved: raw.resolved ?? null,
    project: raw.project,
    fields: extractFields(raw.customFields ?? []),
  };
}

// --- Patch a single field on an issue ---

export async function patchIssue(
  url: string,
  token: string,
  issueId: string,
  field: string,
  value: string | number | null,
): Promise<void> {
  if (field === 'summary') {
    await request(url, token, `/api/issues/${issueId}?fields=id`, {
      method: 'POST',
      body: JSON.stringify({ summary: value }),
    });
    return;
  }

  const def = FIELD_DEFS[field as FieldKey];
  if (!def) throw new Error(`Unknown field: ${field}`);

  await request(url, token, `/api/issues/${issueId}?fields=id`, {
    method: 'POST',
    body: JSON.stringify({
      customFields: [{ name: def.ytName, $type: def.$type, value: toYouTrackValue(def, value) }],
    }),
  });
}

// --- Move issue to another project ---

export async function moveIssue(
  url: string,
  token: string,
  issueId: string,
  targetProjectId: string,
): Promise<void> {
  await request(url, token, `/api/issues/${issueId}?fields=id`, {
    method: 'POST',
    body: JSON.stringify({ project: { id: targetProjectId } }),
  });
}

// --- Create issue ---

export interface CreateIssuePayload {
  projectId: string;
  summary: string;
  status: string | null;
  priority: string | null;
  category: string | null;
  dueDate: number | null;
  ticket: string | null;
  ticketLink: string | null;
  relatedLink: string | null;
  notes: string | null;
  repoUrl: string | null;
}

export interface CreateIssueResult {
  id: string;
  idReadable: string;
}

export async function createIssue(
  url: string,
  token: string,
  payload: CreateIssuePayload,
): Promise<CreateIssueResult> {
  // Only include fields with actual values — sending null with a mismatched $type triggers
  // a YouTrack "type mismatch" error even when the value is null. Date fields use an explicit
  // null/undefined check (0 would be a legitimate, if unlikely, epoch value); every other
  // creatable field uses a truthy check, matching the payload's own empty-string-means-unset
  // convention.
  const payloadValues = payload as unknown as Record<string, string | number | null>;
  const customFields: Array<{ name: string; $type: string; value: unknown }> = [];

  for (const def of CREATABLE_FIELD_DEFS) {
    const value = payloadValues[def.key];
    const include = def.wire === 'date' ? value !== null && value !== undefined : Boolean(value);
    if (!include) continue;
    customFields.push({ name: def.ytName, $type: def.$type, value: toYouTrackValue(def, value) });
  }
  customFields.push({ name: 'Date time entered', $type: 'DateIssueCustomField', value: Date.now() });

  return request<CreateIssueResult>(url, token, '/api/issues?fields=id,idReadable', {
    method: 'POST',
    body: JSON.stringify({
      summary: payload.summary,
      project: { id: payload.projectId },
      customFields,
    }),
  });
}

// --- Delete issue ---

export async function deleteIssue(url: string, token: string, issueId: string): Promise<void> {
  await request<unknown>(url, token, `/api/issues/${issueId}`, { method: 'DELETE' });
}

// --- Worklog ---

export async function postWorklog(
  url: string,
  token: string,
  issueId: string,
  minutes: number,
  worklogType: string,
): Promise<void> {
  // Unlike other bundle-backed fields, this instance's timeTracking/workItems
  // endpoint rejects a name-only { name } reference: "YouTrack is unable to
  // locate an WorkItemType-type entity unless its ID is also provided." Resolve
  // the configured type name to its id first.
  const types = await request<WorkItemType[]>(
    url,
    token,
    '/api/admin/timeTrackingSettings/workItemTypes?fields=id,name',
  );
  const type = types.find((t) => t.name === worklogType);

  await request<unknown>(
    url,
    token,
    `/api/issues/${issueId}/timeTracking/workItems?fields=id`,
    {
      method: 'POST',
      body: JSON.stringify({
        duration: { minutes },
        date: Date.now(),
        type: type ? { id: type.id } : { name: worklogType },
      }),
    },
  );
}

// --- Stand-up issue fetch ---

export interface StandupTask {
  idReadable: string;
  summary: string;
  status: string;
  priority: string | null;
  notes: string | null;
  updatedMs: number;
  loggedMinutesToday: number;
}

interface StandupRawIssue {
  id: string;
  idReadable: string;
  summary: string;
  updated: number;
  customFields: RawCustomField[];
  timeTracking?: {
    workItems?: Array<{
      date: number;
      duration: { minutes: number };
    }>;
  };
}

const STANDUP_FIELDS =
  'id,idReadable,summary,updated,' +
  'customFields(name,$type,value(name,isResolved)),' +
  'timeTracking(workItems(date,duration(minutes)))';

export interface StandupIssues {
  done: StandupTask[];
  inProgress: StandupTask[];
  blocked: StandupTask[];
}

export async function getIssuesForStandup(
  url: string,
  token: string,
  projectShortNames: string[],
  cutoffMs: number,
): Promise<StandupIssues> {
  if (!projectShortNames.length) return { done: [], inProgress: [], blocked: [] };

  const projectPart = projectShortNames.map((s) => `{${s}}`).join(',');
  const query = encodeURIComponent(
    `project: ${projectPart} Status: Done,{In Progress},BLOCKED,{Working on it}`,
  );

  const raw = await request<StandupRawIssue[]>(
    url,
    token,
    `/api/issues?fields=${STANDUP_FIELDS}&query=${query}&$top=500`,
  );

  const todayStart = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  })();

  function toTask(issue: StandupRawIssue): StandupTask {
    const fields = extractFields(issue.customFields ?? []);
    const workItems = issue.timeTracking?.workItems ?? [];
    const loggedMinutesToday = workItems
      .filter((wi) => wi.date >= todayStart)
      .reduce((acc, wi) => acc + (wi.duration?.minutes ?? 0), 0);
    return {
      idReadable: issue.idReadable,
      summary: issue.summary,
      status: fields.status ?? '',
      priority: fields.priority,
      notes: fields.notes,
      updatedMs: issue.updated ?? 0,
      loggedMinutesToday,
    };
  }

  const done: StandupTask[] = [];
  const inProgress: StandupTask[] = [];
  const blocked: StandupTask[] = [];

  for (const issue of raw) {
    const task = toTask(issue);
    const status = task.status.toLowerCase();
    if (status === 'done') {
      if (task.updatedMs >= cutoffMs) done.push(task);
    } else if (
      status === 'in progress' ||
      status === 'working on it' ||
      status === 'waiting for it' ||
      status === 'waiting for approval' ||
      status === 'waiting for customer' ||
      status === 'waiting on external resource'
    ) {
      inProgress.push(task);
    } else if (status === 'blocked') {
      blocked.push(task);
    }
  }

  return { done, inProgress, blocked };
}

// --- _vermilian-config Knowledge Base Article ---

const ARTICLE_SUMMARY = '_vermilian-config';
const ARTICLE_FIELDS = 'id,summary,content,updated';
// This YouTrack instance requires every Article to belong to a project.
// VERM (id 0-33) is a dedicated project created to own the config article.
const ARTICLE_PROJECT_SHORT_NAME = 'VERM';

interface RawArticle {
  id: string;
  summary: string;
  content: string;
  updated: number;
}

export interface VermilianArticle {
  id: string;
  content: string;
  updated: number;
}

export async function findVermilianArticle(
  url: string,
  token: string,
): Promise<VermilianArticle | null> {
  try {
    // Fetch up to 500 articles; filter client-side by summary.
    const articles = await request<RawArticle[]>(
      url,
      token,
      `/api/articles?fields=${ARTICLE_FIELDS}&$top=500`,
    );
    const match = articles.find((a) => a.summary === ARTICLE_SUMMARY);
    return match ? { id: match.id, content: match.content ?? '{}', updated: match.updated ?? 0 } : null;
  } catch {
    return null;
  }
}

export async function createVermilianArticle(
  url: string,
  token: string,
  content: string,
): Promise<VermilianArticle | null> {
  try {
    const result = await request<RawArticle>(
      url,
      token,
      `/api/articles?fields=${ARTICLE_FIELDS}`,
      {
        method: 'POST',
        body: JSON.stringify({
          summary: ARTICLE_SUMMARY,
          content,
          project: { shortName: ARTICLE_PROJECT_SHORT_NAME },
        }),
      },
    );
    return { id: result.id, content: result.content ?? content, updated: result.updated ?? 0 };
  } catch {
    return null;
  }
}

export async function updateVermilianArticle(
  url: string,
  token: string,
  articleId: string,
  content: string,
): Promise<{ updated: number } | null> {
  try {
    const result = await request<RawArticle>(
      url,
      token,
      `/api/articles/${articleId}?fields=${ARTICLE_FIELDS}`,
      { method: 'POST', body: JSON.stringify({ content }) },
    );
    return { updated: result.updated ?? 0 };
  } catch {
    return null;
  }
}

export async function getVermilianArticle(
  url: string,
  token: string,
  articleId: string,
): Promise<VermilianArticle | null> {
  try {
    const result = await request<RawArticle>(
      url,
      token,
      `/api/articles/${articleId}?fields=${ARTICLE_FIELDS}`,
    );
    return { id: result.id, content: result.content ?? '{}', updated: result.updated ?? 0 };
  } catch {
    return null;
  }
}
