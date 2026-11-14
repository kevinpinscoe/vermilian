// The Jira read client (VERM-28) against recorded responses: the bodies below
// follow the shapes Jira Cloud returns for these endpoints (REST v3), with
// fictional values (ADR-0011 §10).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEditMeta,
  getIssue,
  getIssueComments,
  COMMENT_PAGE_SIZE,
  isValidProjectKey,
  listProjects,
  projectIssuesJql,
  searchProjectIssues,
  searchProjectRecentlyUpdated,
  projectRecentlyUpdatedJql,
  PROJECT_PAGE_SIZE,
} from './jira';
import { JIRA_LIST_FIELDS } from '../../shared/jiraIssue';

const BASE = 'https://example.atlassian.net';
const EMAIL = 'user@example.com';
const TOKEN = 'fictional-token';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

// GET /rest/api/3/project/search — two pages.
const PROJECT_PAGE_1 = {
  self: `${BASE}/rest/api/3/project/search?startAt=0&maxResults=2`,
  maxResults: 2,
  startAt: 0,
  total: 3,
  isLast: false,
  values: [
    { expand: 'description,lead', self: `${BASE}/rest/api/3/project/10000`, id: '10000', key: 'DEMO', name: 'Demo', projectTypeKey: 'software', simplified: false },
    { expand: 'description,lead', self: `${BASE}/rest/api/3/project/10010`, id: '10010', key: 'OPS', name: 'Operations', projectTypeKey: 'software', simplified: true },
  ],
};
const PROJECT_PAGE_2 = {
  maxResults: 2,
  startAt: 2,
  total: 3,
  isLast: true,
  values: [{ id: '10020', key: 'WEB', name: 'Website', projectTypeKey: 'business' }],
};

// POST /rest/api/3/search/jql — nextPageToken paging, no total.
function issue(id: string, key: string, summary: string, category: string) {
  return {
    expand: 'renderedFields,names,schema',
    id,
    self: `${BASE}/rest/api/3/issue/${id}`,
    key,
    fields: {
      summary,
      status: { name: category === 'done' ? 'Done' : 'To Do', statusCategory: { id: 2, key: category } },
      priority: { name: 'Medium', id: '3' },
      updated: '2026-11-10T09:00:00.000+0000',
    },
  };
}
const SEARCH_PAGE_1 = {
  issues: [issue('10101', 'DEMO-1', 'First', 'new'), issue('10102', 'DEMO-2', 'Second', 'indeterminate')],
  nextPageToken: 'Ch0jU3RyaW5nJlJFVk5UQT09JUludCZNakE9EAIY',
  isLast: false,
};
const SEARCH_PAGE_2 = {
  issues: [issue('10103', 'DEMO-3', 'Third', 'new')],
  isLast: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('listProjects', () => {
  it('pages by startAt until isLast', async () => {
    fetchMock.mockResolvedValueOnce(json(200, PROJECT_PAGE_1)).mockResolvedValueOnce(json(200, PROJECT_PAGE_2));
    const projects = await listProjects(BASE, EMAIL, TOKEN);
    expect(projects).toEqual([
      { id: '10000', key: 'DEMO', name: 'Demo' },
      { id: '10010', key: 'OPS', name: 'Operations' },
      { id: '10020', key: 'WEB', name: 'Website' },
    ]);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([
      `${BASE}/rest/api/3/project/search?startAt=0&maxResults=${PROJECT_PAGE_SIZE}&orderBy=key`,
      `${BASE}/rest/api/3/project/search?startAt=2&maxResults=${PROJECT_PAGE_SIZE}&orderBy=key`,
    ]);
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit).method === 'GET')).toBe(true);
  });

  it('stops at the page guard', async () => {
    fetchMock.mockImplementation(async () => json(200, PROJECT_PAGE_1));
    const projects = await listProjects(BASE, EMAIL, TOKEN, 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(projects).toHaveLength(6);
  });

  it('stops on an empty page even if isLast is false', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { isLast: false, values: [] }));
    await expect(listProjects(BASE, EMAIL, TOKEN)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('searchProjectIssues', () => {
  it('follows nextPageToken until isLast', async () => {
    fetchMock.mockResolvedValueOnce(json(200, SEARCH_PAGE_1)).mockResolvedValueOnce(json(200, SEARCH_PAGE_2));
    const issues = await searchProjectIssues(BASE, EMAIL, TOKEN, 'DEMO');
    expect(issues.map((i) => i.key)).toEqual(['DEMO-1', 'DEMO-2', 'DEMO-3']);

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies[0]).toEqual({
      jql: 'project = "DEMO" AND statusCategory != Done ORDER BY updated DESC',
      fields: [...JIRA_LIST_FIELDS],
      maxResults: 100,
    });
    expect(bodies[1].nextPageToken).toBe(SEARCH_PAGE_1.nextPageToken);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/rest/api/3/search/jql`);
  });

  it('includes resolved issues on request', async () => {
    fetchMock.mockResolvedValueOnce(json(200, SEARCH_PAGE_2));
    await searchProjectIssues(BASE, EMAIL, TOKEN, 'DEMO', { includeResolved: true });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.jql).toBe('project = "DEMO" ORDER BY updated DESC');
  });

  it('retries a throttled search page after Retry-After', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetchMock
      .mockResolvedValueOnce(json(429, { errorMessages: ['Rate limit exceeded.'] }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json(200, SEARCH_PAGE_2));
    const p = searchProjectIssues(BASE, EMAIL, TOKEN, 'DEMO');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a project key that could alter the JQL', async () => {
    await expect(searchProjectIssues(BASE, EMAIL, TOKEN, 'DEMO" OR project = "X')).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid Jira project key/),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('searchProjectRecentlyUpdated (VERM-39)', () => {
  it("asks for the project's issues updated in the last five minutes, resolved ones included", async () => {
    fetchMock.mockResolvedValueOnce(json(200, SEARCH_PAGE_2));
    const issues = await searchProjectRecentlyUpdated(BASE, EMAIL, TOKEN, 'DEMO', { fields: ['summary', 'updated'] });
    expect(issues).toHaveLength(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/rest/api/3/search/jql`);
    // search/jql is a read sent as POST; nothing else is ever sent.
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      jql: 'project = "DEMO" AND updated >= -5m ORDER BY updated DESC',
      fields: ['summary', 'updated'],
      maxResults: 100,
    });
  });

  it('takes another window in whole minutes', async () => {
    fetchMock.mockResolvedValueOnce(json(200, SEARCH_PAGE_2));
    await searchProjectRecentlyUpdated(BASE, EMAIL, TOKEN, 'DEMO', { windowMinutes: 12 });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).jql).toBe(
      'project = "DEMO" AND updated >= -12m ORDER BY updated DESC',
    );
  });

  it('refuses a key or window that could alter the JQL, before any request', async () => {
    await expect(searchProjectRecentlyUpdated(BASE, EMAIL, TOKEN, 'DEMO" OR x = "y')).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid Jira project key/),
    });
    for (const bad of [0, -5, 1.5, NaN, Infinity, 100_000]) {
      expect(() => projectRecentlyUpdatedJql('DEMO', bad)).toThrow(/Invalid poll window/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('projectIssuesJql / isValidProjectKey', () => {
  it('accepts Jira project keys only', () => {
    expect(isValidProjectKey('DEMO')).toBe(true);
    expect(isValidProjectKey('A1_B')).toBe(true);
    for (const bad of ['', 'demo', '1DEMO', 'DE MO', 'DEMO"', 'DEMO-1']) expect(isValidProjectKey(bad)).toBe(false);
    expect(() => projectIssuesJql('demo')).toThrow();
  });
});

describe('getIssue', () => {
  it('GETs the issue with the requested fields', async () => {
    fetchMock.mockResolvedValueOnce(json(200, issue('10101', 'DEMO-1', 'First', 'new')));
    const got = await getIssue(BASE, EMAIL, TOKEN, 'DEMO-1');
    expect(got.key).toBe('DEMO-1');
    expect(got.fields?.summary).toBe('First');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/rest/api/3/issue/DEMO-1?fields=${encodeURIComponent(JIRA_LIST_FIELDS.join(','))}`);
    expect(init.method).toBe('GET');
  });

  it('surfaces a 404 as a JiraError', async () => {
    fetchMock.mockResolvedValueOnce(
      json(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} }),
    );
    await expect(getIssue(BASE, EMAIL, TOKEN, 'DEMO-9')).rejects.toEqual({
      status: 404,
      message: 'Issue does not exist or you do not have permission to see it.',
    });
  });

  it('refuses a malformed key before any request', async () => {
    await expect(getIssue(BASE, EMAIL, TOKEN, '../myself')).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid Jira issue key/),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// GET /rest/api/3/issue/{key}/editmeta (VERM-30).
const EDITMETA = {
  fields: {
    summary: { required: true, schema: { type: 'string', system: 'summary' }, name: 'Summary', key: 'summary', operations: ['set'] },
    priority: {
      required: false,
      schema: { type: 'priority', system: 'priority' },
      name: 'Priority',
      key: 'priority',
      operations: ['set'],
      allowedValues: [
        { self: `${BASE}/rest/api/3/priority/1`, iconUrl: `${BASE}/images/icons/priorities/highest.svg`, name: 'Highest', id: '1' },
        { self: `${BASE}/rest/api/3/priority/3`, iconUrl: `${BASE}/images/icons/priorities/medium.svg`, name: 'Medium', id: '3' },
        { self: `${BASE}/rest/api/3/priority/5`, iconUrl: `${BASE}/images/icons/priorities/lowest.svg`, name: 'Lowest', id: '5' },
      ],
    },
  },
};

describe('getEditMeta', () => {
  it('GETs the edit metadata and returns the allowed values in order', async () => {
    fetchMock.mockResolvedValueOnce(json(200, EDITMETA));
    const meta = await getEditMeta(BASE, EMAIL, TOKEN, 'DEMO-1');
    expect(meta.fields?.priority?.allowedValues?.map((v) => v.name)).toEqual(['Highest', 'Medium', 'Lowest']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/rest/api/3/issue/DEMO-1/editmeta`);
    expect(init.method).toBe('GET');
  });

  it('returns no fields for an issue the user cannot edit', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { fields: {} }));
    await expect(getEditMeta(BASE, EMAIL, TOKEN, 'DEMO-1')).resolves.toEqual({ fields: {} });
  });

  it('refuses a malformed key before any request', async () => {
    await expect(getEditMeta(BASE, EMAIL, TOKEN, 'DEMO-1/../x')).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid Jira issue key/),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// GET /rest/api/3/issue/{key}/comment (VERM-32) — startAt paging with total.
const comment = (id: string, text: string) => ({
  self: `${BASE}/rest/api/3/issue/10101/comment/${id}`,
  id,
  author: { accountId: 'a-1', displayName: 'Example User', active: true },
  body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  created: '2026-11-10T09:00:00.000+0000',
  updated: '2026-11-10T09:00:00.000+0000',
  jsdPublic: true,
});

describe('getIssueComments', () => {
  it('pages by startAt until total, oldest first', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { startAt: 0, maxResults: 2, total: 3, comments: [comment('1', 'a'), comment('2', 'b')] }))
      .mockResolvedValueOnce(json(200, { startAt: 2, maxResults: 2, total: 3, comments: [comment('3', 'c')] }));
    const got = await getIssueComments(BASE, EMAIL, TOKEN, 'DEMO-1');
    expect(got.map((c) => c.id)).toEqual(['1', '2', '3']);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([
      `${BASE}/rest/api/3/issue/DEMO-1/comment?startAt=0&maxResults=${COMMENT_PAGE_SIZE}&orderBy=created`,
      `${BASE}/rest/api/3/issue/DEMO-1/comment?startAt=2&maxResults=${COMMENT_PAGE_SIZE}&orderBy=created`,
    ]);
  });

  it('stops on an empty page or a missing total', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { comments: [comment('1', 'a')] }));
    await expect(getIssueComments(BASE, EMAIL, TOKEN, 'DEMO-1')).resolves.toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json(200, { startAt: 0, total: 5, comments: [] }));
    await expect(getIssueComments(BASE, EMAIL, TOKEN, 'DEMO-1')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours the page guard', async () => {
    fetchMock.mockImplementation(async () => json(200, { startAt: 0, total: 1000, comments: [comment('1', 'a')] }));
    await getIssueComments(BASE, EMAIL, TOKEN, 'DEMO-1', 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a malformed key before any request', async () => {
    await expect(getIssueComments(BASE, EMAIL, TOKEN, 'DEMO-1?x=1')).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid Jira issue key/),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
