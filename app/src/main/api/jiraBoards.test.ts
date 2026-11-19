// The Jira board reads (VERM-59) against recorded Agile API response shapes,
// with fictional values (ADR-0011 §10).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_PAGE_SIZE,
  JIRA_BOARD_SCOPE,
  JIRA_WORK_SCOPE,
  boardIssuesJql,
  boardRecentlyUpdatedJql,
  isIssueOnBoard,
  isValidBoardId,
  listBoards,
  listProjectStatuses,
  missingJiraScopes,
  searchBoardIssues,
} from './jira';

const BASE = 'https://example.atlassian.net';
const EMAIL = 'user@example.com';
const TOKEN = 'fictional-token';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// GET /rest/agile/1.0/board — two pages.
const BOARD_PAGE_1 = {
  maxResults: 2,
  startAt: 0,
  total: 3,
  isLast: false,
  values: [
    { id: 12, self: `${BASE}/rest/agile/1.0/board/12`, name: 'SRE planned work', type: 'scrum', location: { projectId: 10000, projectKey: 'SRE', displayName: 'SRE (SRE)' } },
    { id: 13, self: `${BASE}/rest/agile/1.0/board/13`, name: 'SRE ops', type: 'kanban', location: { projectKey: 'SRE' } },
  ],
};
const BOARD_PAGE_2 = { maxResults: 2, startAt: 2, total: 3, isLast: true, values: [{ id: 20, name: 'Cross-team', type: 'simple' }] };

function issue(id: string, key: string) {
  return { id, key, fields: { summary: key, status: { name: 'To Do', statusCategory: { key: 'new' } } } };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('listProjectStatuses (VERM-67)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns each status name once across issue types', async () => {
    const fetchMock = vi.fn(async () => json(200, [
      { name: 'Task', statuses: [{ name: 'To Do' }, { name: 'In Progress' }] },
      { name: 'Bug', statuses: [{ name: 'In Progress' }, { name: 'Done' }, {}] },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listProjectStatuses(BASE, EMAIL, TOKEN, 'SRE')).resolves.toEqual(['To Do', 'In Progress', 'Done']);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${BASE}/rest/api/3/project/SRE/statuses`);
  });

  it('refuses an invalid project key before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(listProjectStatuses(BASE, EMAIL, TOKEN, '../x')).rejects.toThrow('Invalid Jira project key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listBoards', () => {
  it('pages by startAt until isLast and keeps the location project', async () => {
    fetchMock.mockResolvedValueOnce(json(200, BOARD_PAGE_1)).mockResolvedValueOnce(json(200, BOARD_PAGE_2));
    expect(await listBoards(BASE, EMAIL, TOKEN)).toEqual([
      { id: 12, name: 'SRE planned work', type: 'scrum', projectKey: 'SRE' },
      { id: 13, name: 'SRE ops', type: 'kanban', projectKey: 'SRE' },
      { id: 20, name: 'Cross-team', type: 'simple', projectKey: '' },
    ]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/rest/agile/1.0/board?startAt=0&maxResults=${BOARD_PAGE_SIZE}`,
      `${BASE}/rest/agile/1.0/board?startAt=2&maxResults=${BOARD_PAGE_SIZE}`,
    ]);
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit).method === 'GET')).toBe(true);
  });

  it('skips entries without a valid ID and stops at the page guard', async () => {
    fetchMock.mockImplementation(async () => json(200, { isLast: false, values: [{ id: 'x', name: 'bad' }, { id: 5, name: '' }] }));
    const boards = await listBoards(BASE, EMAIL, TOKEN, 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(boards).toEqual([
      { id: 5, name: 'Board 5', type: '', projectKey: '' },
      { id: 5, name: 'Board 5', type: '', projectKey: '' },
    ]);
  });
});

describe('searchBoardIssues', () => {
  it("reads the board's own issues, narrowed by JQL, paging by total", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { startAt: 0, maxResults: 50, total: 3, issues: [issue('1', 'SRE-1'), issue('2', 'OPS-4')] }))
      .mockResolvedValueOnce(json(200, { startAt: 2, maxResults: 50, total: 3, issues: [issue('3', 'SRE-9')] }));
    const found = await searchBoardIssues(BASE, EMAIL, TOKEN, 12, { jql: boardIssuesJql(false), fields: ['summary', 'status'] });
    expect(found.map((i) => i.key)).toEqual(['SRE-1', 'OPS-4', 'SRE-9']);
    const [first, second] = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(first).toBe(
      `${BASE}/rest/agile/1.0/board/12/issue?startAt=0&maxResults=${BOARD_PAGE_SIZE}` +
        `&jql=${encodeURIComponent('statusCategory != Done ORDER BY updated DESC')}&fields=${encodeURIComponent('summary,status')}`,
    );
    expect(second).toContain('startAt=2');
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit).method === 'GET')).toBe(true);
  });

  it('says so when the page guard cuts the list, and only then', async () => {
    const full = { total: 500, issues: Array.from({ length: 50 }, (_, n) => issue(String(n), `SRE-${n + 1}`)) };
    fetchMock.mockImplementation(async () => json(200, full));
    const onTruncated = vi.fn();
    const found = await searchBoardIssues(BASE, EMAIL, TOKEN, 12, { maxPages: 2, onTruncated });
    expect(found).toHaveLength(100);
    expect(onTruncated).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(json(200, { total: 50, issues: full.issues }));
    const complete = vi.fn();
    await searchBoardIssues(BASE, EMAIL, TOKEN, 12, { maxPages: 1, onTruncated: complete });
    expect(complete).not.toHaveBeenCalled();
  });

  it('refuses an invalid board ID before any request', async () => {
    for (const id of [0, -1, 1.5, Number.NaN]) {
      await expect(searchBoardIssues(BASE, EMAIL, TOKEN, id)).rejects.toMatchObject({ message: expect.stringMatching(/Invalid Jira board ID/) });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('board JQL helpers', () => {
  it('filters to open issues unless resolved ones are wanted', () => {
    expect(boardIssuesJql(false)).toBe('statusCategory != Done ORDER BY updated DESC');
    expect(boardIssuesJql(true)).toBe('ORDER BY updated DESC');
  });

  it('builds the poll window and refuses a bad one', () => {
    expect(boardRecentlyUpdatedJql(5)).toBe('updated >= -5m ORDER BY updated DESC');
    expect(() => boardRecentlyUpdatedJql(0)).toThrow(/Invalid poll window/);
    expect(() => boardRecentlyUpdatedJql(1.5)).toThrow(/Invalid poll window/);
  });

  it('validates board IDs', () => {
    expect(isValidBoardId(12)).toBe(true);
    for (const v of [0, -3, 2.5, '12', null, undefined]) expect(isValidBoardId(v)).toBe(false);
  });
});

describe('isIssueOnBoard', () => {
  it("asks the board's filter for the one key", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { total: 1, issues: [issue('2', 'OPS-4')] }));
    expect(await isIssueOnBoard(BASE, EMAIL, TOKEN, 12, 'OPS-4')).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain(`jql=${encodeURIComponent('key = "OPS-4"')}`);
  });

  it('is false when the board does not list it, or JQL rejects the key', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { total: 0, issues: [] }));
    expect(await isIssueOnBoard(BASE, EMAIL, TOKEN, 12, 'OPS-4')).toBe(false);
    fetchMock.mockResolvedValueOnce(json(400, { errorMessages: ["An issue with key 'OPS-404' does not exist for field 'key'."] }));
    expect(await isIssueOnBoard(BASE, EMAIL, TOKEN, 12, 'OPS-404')).toBe(false);
  });

  it('never splices a malformed key into JQL', async () => {
    expect(await isIssueOnBoard(BASE, EMAIL, TOKEN, 12, 'OPS-4" OR key != "X')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a refused token instead of answering "no"', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Client must be authenticated' }));
    await expect(isIssueOnBoard(BASE, EMAIL, TOKEN, 12, 'OPS-4')).rejects.toMatchObject({ status: 401 });
  });
});

describe('missingJiraScopes', () => {
  it('reports nothing when both reads succeed', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { issues: [] })).mockResolvedValueOnce(json(200, { values: [] }));
    expect(await missingJiraScopes(BASE, EMAIL, TOKEN)).toEqual([]);
    const [search, boards] = fetchMock.mock.calls;
    expect(search[0]).toBe(`${BASE}/rest/api/3/search/jql`);
    expect((search[1] as RequestInit).method).toBe('POST');
    expect(boards[0]).toBe(`${BASE}/rest/agile/1.0/board?maxResults=1`);
  });

  it('names each scope whose read is refused', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { issues: [] })).mockResolvedValueOnce(json(401, { message: 'Unauthorized; scope does not match' }));
    expect(await missingJiraScopes(BASE, EMAIL, TOKEN)).toEqual([JIRA_BOARD_SCOPE]);
    fetchMock.mockResolvedValueOnce(json(403, {})).mockResolvedValueOnce(json(403, {}));
    expect(await missingJiraScopes(BASE, EMAIL, TOKEN)).toEqual([JIRA_WORK_SCOPE, JIRA_BOARD_SCOPE]);
  });

  it('does not call another failure a missing scope', async () => {
    fetchMock.mockResolvedValueOnce(json(500, {})).mockResolvedValueOnce(json(404, {}));
    expect(await missingJiraScopes(BASE, EMAIL, TOKEN)).toEqual([]);
  });
});
