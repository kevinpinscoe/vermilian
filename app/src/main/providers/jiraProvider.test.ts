import { describe, expect, it, vi } from 'vitest';
import type * as JiraClient from '../api/jira';
import { boardIssuesJql, boardRecentlyUpdatedJql, isValidBoardId, isValidProjectKey, projectIssuesJql } from '../api/jira';
import { createJiraProvider } from './jiraProvider';
import { isWritableTracker } from '../../shared/tracker';
import { jiraBoardFields, jiraDetailFields } from '../../shared/jiraBoardIssue';

// Fictional values only (ADR-0011 §10).
const CONN = { base: 'https://example.atlassian.net', email: 'user@example.com', token: 'fictional-token' };
const AUTH = [CONN.base, CONN.email, CONN.token];

const ISSUE = {
  id: '10001',
  key: 'DEMO-1',
  fields: {
    summary: 'Rotate credentials',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: { name: 'High' },
    duedate: '2026-11-20',
    project: { id: '10000', key: 'DEMO', name: 'Demo' },
  },
};

function stubClient(overrides: Partial<Record<keyof typeof JiraClient, unknown>> = {}) {
  const client = {
    isValidProjectKey,
    getMyself: vi.fn(async () => ({ accountId: 'a-1', displayName: 'Example User', emailAddress: '' })),
    listProjects: vi.fn(async () => [{ id: '10000', key: 'DEMO', name: 'Demo' }]),
    searchProjectIssues: vi.fn(async () => [ISSUE]),
    searchProjectRecentlyUpdated: vi.fn(async () => [ISSUE]),
    searchJql: vi.fn(async () => [ISSUE]),
    getIssue: vi.fn(async () => ISSUE),
    projectIssuesJql,
    isValidBoardId,
    boardIssuesJql,
    boardRecentlyUpdatedJql,
    listProjectStatuses: vi.fn(async () => ['To Do', 'In Progress']),
    listBoards: vi.fn(async () => [{ id: 12, name: 'Planned', type: 'scrum', projectKey: 'DEMO' }]),
    searchBoardIssues: vi.fn(async () => [ISSUE]),
    isIssueOnBoard: vi.fn(async () => false),
    getIssueComments: vi.fn(async () => []),
    getEditMeta: vi.fn(async () => ({
      fields: { priority: { name: 'Priority', allowedValues: ['Critical', 'Highest', 'High', 'None'].map((name, i) => ({ id: String(i), name })) } },
    })),
    ...overrides,
  };
  return client as unknown as typeof JiraClient & typeof client;
}

describe('createJiraProvider', () => {
  it('is a read-only jira provider', () => {
    const p = createJiraProvider(stubClient(), CONN);
    expect(p.kind).toBe('jira');
    expect(isWritableTracker(p)).toBe(false);
  });

  it('reports the account display name', async () => {
    const client = stubClient();
    await expect(createJiraProvider(client, CONN).getCurrentUser()).resolves.toBe('Example User');
    expect(client.getMyself).toHaveBeenCalledWith(...AUTH);
  });

  it('lists projects with the key as the short name', async () => {
    await expect(createJiraProvider(stubClient(), CONN).getProjects()).resolves.toEqual([
      { id: '10000', name: 'Demo', shortName: 'DEMO' },
    ]);
  });

  it('maps a project board through the mapper, requesting the board fields', async () => {
    const client = stubClient();
    const issues = await createJiraProvider(client, CONN).getIssues('DEMO', true);
    expect(client.searchProjectIssues).toHaveBeenCalledWith(...AUTH, 'DEMO', {
      includeResolved: true,
      fields: jiraBoardFields(),
    });
    expect(issues[0]).toMatchObject({ idReadable: 'DEMO-1', summary: 'Rotate credentials', statusRole: 'inProgress' });
    expect(issues[0].fields.status).toBe('In Progress');
    expect(issues[0].fields.dueDate).toBe(Date.UTC(2026, 10, 20, 12));
  });

  it('reads recently updated issues through the bounded search, mapped with the project settings (VERM-39)', async () => {
    const moved = { id: '10002', key: 'OPS-9', fields: { status: { name: 'Impeded', statusCategory: { key: 'indeterminate' } }, updated: '2026-11-14T12:00:00.000+0000' } };
    const client = stubClient({ searchProjectRecentlyUpdated: vi.fn(async () => [ISSUE, moved]) });
    const settings = { DEMO: { dueDateField: 'customfield_10042' }, OPS: { statusRoles: { Impeded: 'blocked' as const } } };
    const issues = await createJiraProvider(client, CONN, settings).getRecentlyUpdatedIssues('DEMO');
    expect(client.searchProjectRecentlyUpdated).toHaveBeenCalledWith(...AUTH, 'DEMO', {
      windowMinutes: 5,
      fields: jiraBoardFields(settings.DEMO),
    });
    // An issue that moved away since takes its new project's settings.
    expect(issues.map((i) => [i.idReadable, i.statusRole])).toEqual([['DEMO-1', 'inProgress'], ['OPS-9', 'blocked']]);
    expect(issues[1].updated).toBe(Date.parse('2026-11-14T12:00:00.000Z'));
  });

  it("applies the board project's own settings: due-date field and status mapping", async () => {
    const issue = { ...ISSUE, fields: { ...ISSUE.fields, customfield_10042: '2026-12-01' } };
    const client = stubClient({ searchProjectIssues: vi.fn(async () => [issue]) });
    const settings = { DEMO: { dueDateField: 'customfield_10042', statusRoles: { 'In Progress': 'blocked' as const } } };
    const [b] = await createJiraProvider(client, CONN, settings).getIssues('DEMO', false);
    expect(client.searchProjectIssues).toHaveBeenCalledWith(...AUTH, 'DEMO', {
      includeResolved: false,
      fields: jiraBoardFields(settings.DEMO),
    });
    expect(b.fields.dueDate).toBe(Date.UTC(2026, 11, 1, 12));
    expect(b.statusRole).toBe('blocked');
  });

  it("does not apply one project's settings to another project", async () => {
    const client = stubClient();
    const [b] = await createJiraProvider(client, CONN, { OPS: { dueDateField: 'customfield_10042' } }).getIssues('DEMO', false);
    expect(b.fields.dueDate).toBe(Date.UTC(2026, 10, 20, 12));
  });

  it('search requests every project\'s fields and maps each issue with its own project\'s settings', async () => {
    const ops = { id: '20001', key: 'OPS-4', fields: { status: { name: 'Impeded', statusCategory: { key: 'indeterminate' } }, customfield_10050: '2026-12-24' } };
    const client = stubClient({ searchJql: vi.fn(async () => [ISSUE, ops]) });
    const settings = { OPS: { dueDateField: 'customfield_10050', statusRoles: { Impeded: 'blocked' as const } } };
    const [demo, opsIssue] = await createJiraProvider(client, CONN, settings).searchIssues(['DEMO', 'OPS'], 'thresholds');
    const fields = vi.mocked(client.searchJql).mock.calls[0][4] as string[];
    expect(fields).toEqual(expect.arrayContaining(['duedate', 'customfield_10050']));
    expect(new Set(fields).size).toBe(fields.length);
    expect(demo).toMatchObject({ statusRole: 'inProgress' });
    expect(demo.fields.dueDate).toBe(Date.UTC(2026, 10, 20, 12));
    expect(opsIssue).toMatchObject({ statusRole: 'blocked' });
    expect(opsIssue.fields.dueDate).toBe(Date.UTC(2026, 11, 24, 12));
  });

  it('searches across projects with escaped free text', async () => {
    const client = stubClient();
    await createJiraProvider(client, CONN).searchIssues(['DEMO', 'OPS'], ' db "creds" ');
    expect(client.searchJql).toHaveBeenCalledWith(
      ...AUTH,
      'project in ("DEMO", "OPS") AND text ~ "db \\"creds\\"" ORDER BY updated DESC',
      jiraBoardFields(),
      1,
    );
    // Not a key, so nothing is looked up by key.
    expect(client.getIssue).not.toHaveBeenCalled();
  });

  it('returns nothing, and asks Jira nothing, for an empty query or no projects', async () => {
    const client = stubClient();
    const p = createJiraProvider(client, CONN);
    await expect(p.searchIssues(['DEMO'], '   ')).resolves.toEqual([]);
    await expect(p.searchIssues([], 'x')).resolves.toEqual([]);
    expect(client.searchJql).not.toHaveBeenCalled();
  });

  // VERM-61: an exact key is fetched directly, because JQL's key = "X" fails
  // the whole query when X does not exist.
  it('looks up an exact key in a workspace project and lists it first, once', async () => {
    const other = { ...ISSUE, id: '10099', key: 'DEMO-9' };
    const client = stubClient({ searchJql: vi.fn(async () => [other, ISSUE]) });
    const found = await createJiraProvider(client, CONN).searchIssues(['DEMO'], 'demo-1');
    expect(client.getIssue).toHaveBeenCalledWith(...AUTH, 'DEMO-1', jiraBoardFields());
    expect(found.map((i) => i.idReadable)).toEqual(['DEMO-1', 'DEMO-9']);
  });

  it('treats a 404 on the key as no match and still returns the text matches', async () => {
    const client = stubClient({ getIssue: vi.fn(async () => Promise.reject({ status: 404, message: 'gone' })) });
    const found = await createJiraProvider(client, CONN).searchIssues(['DEMO'], 'DEMO-404');
    expect(found.map((i) => i.idReadable)).toEqual(['DEMO-1']);
  });

  it('surfaces a 401 from the key lookup rather than hiding it', async () => {
    const err = { status: 401, message: 'Client must be authenticated' };
    const client = stubClient({ getIssue: vi.fn(async () => Promise.reject(err)) });
    await expect(createJiraProvider(client, CONN).searchIssues(['DEMO'], 'DEMO-1')).rejects.toBe(err);
  });

  it('never looks up a key outside the given projects', async () => {
    const client = stubClient();
    await createJiraProvider(client, CONN).searchIssues(['DEMO'], 'SECRET-1');
    expect(client.getIssue).not.toHaveBeenCalled();
  });

  it('drops a key that has moved to a project outside the given ones', async () => {
    const moved = { ...ISSUE, id: '10500', key: 'ELSEWHERE-3' };
    const client = stubClient({ getIssue: vi.fn(async () => moved), searchJql: vi.fn(async () => []) });
    await expect(createJiraProvider(client, CONN).searchIssues(['DEMO'], 'DEMO-3')).resolves.toEqual([]);
  });

  it('refuses a project key that could alter the JQL', async () => {
    const client = stubClient();
    await expect(createJiraProvider(client, CONN).searchIssues(['DEMO", "X'], 'x')).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid Jira project key/),
    });
    expect(client.searchJql).not.toHaveBeenCalled();
  });

  it('returns issue detail with the project', async () => {
    const client = stubClient();
    const d = await createJiraProvider(client, CONN).getIssueDetail('DEMO-1');
    expect(client.getIssue).toHaveBeenCalledWith(...AUTH, 'DEMO-1', jiraDetailFields());
    expect(d.project).toEqual({ id: '10000', name: 'Demo', shortName: 'DEMO' });
    expect(d.fields.dueDate).toBe(Date.UTC(2026, 10, 20, 12));
  });

  it("issue detail requests and maps with the issue's project settings", async () => {
    const issue = { ...ISSUE, fields: { ...ISSUE.fields, customfield_10042: '2026-12-01' } };
    const client = stubClient({ getIssue: vi.fn(async () => issue) });
    const settings = { DEMO: { dueDateField: 'customfield_10042' } };
    const d = await createJiraProvider(client, CONN, settings).getIssueDetail('DEMO-1');
    expect(client.getIssue).toHaveBeenCalledWith(...AUTH, 'DEMO-1', jiraDetailFields(settings.DEMO));
    expect(d.fields.dueDate).toBe(Date.UTC(2026, 11, 1, 12));
  });

  it('propagates client errors unchanged', async () => {
    const err = { status: 401, message: 'Client must be authenticated' };
    const client = stubClient({ listProjects: vi.fn(async () => Promise.reject(err)) });
    await expect(createJiraProvider(client, CONN).getProjects()).rejects.toBe(err);
  });
});

describe('createJiraProvider — priority values from editmeta (VERM-30)', () => {
  const ISSUES = [{ id: '1', key: 'DEMO-3' }, { id: '2', key: 'DEMO-2' }, { id: '3', key: 'DEMO-1' }, { id: '4', key: 'DEMO-0' }];

  it("returns the project's allowedValues in scheme order, read from one open issue", async () => {
    const client = stubClient({ searchJql: vi.fn(async () => ISSUES) });
    await expect(createJiraProvider(client, CONN).getPriorityValues('DEMO')).resolves.toEqual(['Critical', 'Highest', 'High', 'None']);
    expect(client.searchJql).toHaveBeenCalledWith(...AUTH, 'project = "DEMO" AND statusCategory != Done ORDER BY updated DESC', ['summary'], 1);
    expect(client.getEditMeta).toHaveBeenCalledTimes(1);
    expect(client.getEditMeta).toHaveBeenCalledWith(...AUTH, 'DEMO-3');
  });

  it('tries the next issue when the user cannot edit the first, up to three', async () => {
    const getEditMeta = vi
      .fn()
      .mockResolvedValueOnce({ fields: {} })
      .mockResolvedValueOnce({ fields: { priority: { allowedValues: [{ name: 'P1' }, { name: 'P2' }] } } });
    const client = stubClient({ searchJql: vi.fn(async () => ISSUES), getEditMeta });
    await expect(createJiraProvider(client, CONN).getPriorityValues('DEMO')).resolves.toEqual(['P1', 'P2']);
    expect(getEditMeta.mock.calls.map((c) => c[3])).toEqual(['DEMO-3', 'DEMO-2']);

    const none = vi.fn(async () => ({ fields: {} }));
    const c2 = stubClient({ searchJql: vi.fn(async () => ISSUES), getEditMeta: none });
    await expect(createJiraProvider(c2, CONN).getPriorityValues('DEMO')).resolves.toEqual([]);
    expect(none).toHaveBeenCalledTimes(3);
  });

  it('returns [] for a project with no open issues', async () => {
    const client = stubClient({ searchJql: vi.fn(async () => []) });
    await expect(createJiraProvider(client, CONN).getPriorityValues('DEMO')).resolves.toEqual([]);
    expect(client.getEditMeta).not.toHaveBeenCalled();
  });

  it('reads each project once, and retries after a failure', async () => {
    const searchJql = vi.fn().mockRejectedValueOnce({ status: 503, message: 'busy' }).mockResolvedValue(ISSUES);
    const client = stubClient({ searchJql });
    const p = createJiraProvider(client, CONN);
    await expect(p.getPriorityValues('DEMO')).rejects.toMatchObject({ status: 503 });
    const first = await p.getPriorityValues('DEMO');
    first.push('mutated');
    await expect(p.getPriorityValues('DEMO')).resolves.toEqual(['Critical', 'Highest', 'High', 'None']);
    expect(searchJql).toHaveBeenCalledTimes(2);
    expect(client.getEditMeta).toHaveBeenCalledTimes(1);
  });

  it('refuses an invalid project key before any request', async () => {
    const client = stubClient();
    await expect(createJiraProvider(client, CONN).getPriorityValues('demo"')).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid Jira project key/),
    });
    expect(client.searchJql).not.toHaveBeenCalled();
  });
});

describe('createJiraProvider — description and comments (VERM-32)', () => {
  const adf = (text: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  it('fetches the description and comments and returns them as Markdown', async () => {
    const client = stubClient({
      getIssue: vi.fn(async () => ({ id: '10001', key: 'DEMO-1', fields: { description: adf('Rotate **all** keys') } })),
      getIssueComments: vi.fn(async () => [{ id: '1', author: { displayName: 'Example User' }, body: adf('done'), created: '2026-11-10T09:00:00.000+0000' }]),
    });
    const content = await createJiraProvider(client, CONN).getIssueContent('DEMO-1');
    expect(client.getIssue).toHaveBeenCalledWith(...AUTH, 'DEMO-1', ['description']);
    expect(client.getIssueComments).toHaveBeenCalledWith(...AUTH, 'DEMO-1');
    expect(content.description).toBe('Rotate \\*\\*all\\*\\* keys');
    expect(content.comments).toEqual([
      { id: '1', author: 'Example User', created: Date.parse('2026-11-10T09:00:00.000Z'), updated: null, markdown: 'done' },
    ]);
  });

  it('propagates a failure from either request', async () => {
    const err = { status: 404, message: 'Issue does not exist or you do not have permission to see it.' };
    const client = stubClient({ getIssueComments: vi.fn(async () => Promise.reject(err)) });
    await expect(createJiraProvider(client, CONN).getIssueContent('DEMO-1')).rejects.toBe(err);
  });
});

// ─── Boards (VERM-59) ─────────────────────────────────────────────────────────

describe('createJiraProvider boards', () => {
  const OPS = { id: '20002', key: 'OPS-4', fields: { status: { name: 'Impeded', statusCategory: { key: 'indeterminate' } }, customfield_10050: '2026-12-24' } };

  it("reads a board's issues from the board, mapping each with its own project's settings", async () => {
    const client = stubClient({ searchBoardIssues: vi.fn(async () => [ISSUE, OPS]) });
    const settings = { OPS: { dueDateField: 'customfield_10050', statusRoles: { Impeded: 'blocked' as const } } };
    const { issues: [demo, ops], truncated } = await createJiraProvider(client, CONN, settings).getBoardIssues(12, false);
    expect(truncated).toBe(false);
    const [, , , boardId, options] = vi.mocked(client.searchBoardIssues).mock.calls[0] as unknown as [string, string, string, number, { jql: string; fields: string[] }];
    expect(boardId).toBe(12);
    expect(options.jql).toBe('statusCategory != Done ORDER BY updated DESC');
    expect(options.fields).toEqual(expect.arrayContaining(['duedate', 'customfield_10050']));
    expect(demo.statusRole).toBe('inProgress');
    expect(ops).toMatchObject({ statusRole: 'blocked' });
    expect(ops.fields.dueDate).toBe(Date.UTC(2026, 11, 24, 12));
  });

  it('reports a board list cut at the page guard', async () => {
    const client = stubClient({
      searchBoardIssues: vi.fn(async (...args: unknown[]) => {
        (args[4] as { onTruncated?: () => void }).onTruncated?.();
        return [ISSUE];
      }),
    });
    expect((await createJiraProvider(client, CONN).getBoardIssues(12, true)).truncated).toBe(true);
  });

  it('polls a board over the poll window, resolved included', async () => {
    const client = stubClient();
    await createJiraProvider(client, CONN).getBoardRecentlyUpdatedIssues(12);
    const options = vi.mocked(client.searchBoardIssues).mock.calls[0][4] as { jql: string };
    expect(options.jql).toBe('updated >= -5m ORDER BY updated DESC');
  });

  it('lists boards and checks membership through the client', async () => {
    const client = stubClient({ isIssueOnBoard: vi.fn(async () => true) });
    const p = createJiraProvider(client, CONN);
    expect(await p.getBoards()).toEqual([{ id: 12, name: 'Planned', type: 'scrum', projectKey: 'DEMO' }]);
    expect(await p.isOnBoard(12, 'OPS-4')).toBe(true);
    expect(client.isIssueOnBoard).toHaveBeenCalledWith(...AUTH, 12, 'OPS-4');
  });

  it('searchWorkspace searches the projects and each board by the same text', async () => {
    const client = stubClient({ searchJql: vi.fn(async () => [ISSUE]), searchBoardIssues: vi.fn(async () => [OPS, ISSUE]) });
    const found = await createJiraProvider(client, CONN).searchWorkspace({ projectKeys: ['DEMO'], boardIds: [12] }, 'rotate');
    expect(vi.mocked(client.searchJql).mock.calls[0][3]).toBe('project in ("DEMO") AND text ~ "rotate" ORDER BY updated DESC');
    expect((vi.mocked(client.searchBoardIssues).mock.calls[0][4] as { jql: string }).jql).toBe('text ~ "rotate" ORDER BY updated DESC');
    // One result per issue, whichever source found it.
    expect(found.map((i) => i.idReadable)).toEqual(['DEMO-1', 'OPS-4']);
  });

  it('searchWorkspace finds an exact key outside the projects only when it is on a board', async () => {
    const onBoard = stubClient({ getIssue: vi.fn(async () => OPS), searchJql: vi.fn(async () => []), searchBoardIssues: vi.fn(async () => []), isIssueOnBoard: vi.fn(async () => true) });
    expect((await createJiraProvider(onBoard, CONN).searchWorkspace({ projectKeys: ['DEMO'], boardIds: [12] }, 'ops-4')).map((i) => i.idReadable)).toEqual(['OPS-4']);

    const offBoard = stubClient({ getIssue: vi.fn(async () => OPS), searchJql: vi.fn(async () => []), searchBoardIssues: vi.fn(async () => []) });
    expect(await createJiraProvider(offBoard, CONN).searchWorkspace({ projectKeys: ['DEMO'], boardIds: [12] }, 'OPS-4')).toEqual([]);
  });

  it('searchWorkspace with no boards never looks a key up beyond the projects', async () => {
    const client = stubClient({ getIssue: vi.fn(async () => OPS), searchJql: vi.fn(async () => []) });
    expect(await createJiraProvider(client, CONN).searchWorkspace({ projectKeys: ['DEMO'], boardIds: [] }, 'OPS-4')).toEqual([]);
    expect(client.isIssueOnBoard).not.toHaveBeenCalled();
  });

  it('searchWorkspace refuses an invalid board ID and asks nothing for an empty term', async () => {
    const client = stubClient();
    const p = createJiraProvider(client, CONN);
    await expect(p.searchWorkspace({ projectKeys: [], boardIds: [0] }, 'x')).rejects.toMatchObject({ message: expect.stringMatching(/Invalid Jira board ID/) });
    await expect(p.searchWorkspace({ projectKeys: ['DEMO'], boardIds: [12] }, '  ')).resolves.toEqual([]);
    expect(client.searchJql).not.toHaveBeenCalled();
    expect(client.searchBoardIssues).not.toHaveBeenCalled();
  });
});
