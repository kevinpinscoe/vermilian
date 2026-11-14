// The Jira read client (VERM-28) against recorded responses: the bodies below
// follow the shapes Jira Cloud returns for these endpoints (REST v3), with
// fictional values (ADR-0011 §10).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getIssue,
  isValidProjectKey,
  listProjects,
  projectIssuesJql,
  searchProjectIssues,
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
