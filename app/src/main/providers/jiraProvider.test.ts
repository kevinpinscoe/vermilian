import { describe, expect, it, vi } from 'vitest';
import type * as JiraClient from '../api/jira';
import { isValidProjectKey } from '../api/jira';
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
    searchJql: vi.fn(async () => [ISSUE]),
    getIssue: vi.fn(async () => ISSUE),
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
    const opts = { dueDateField: 'customfield_10042' };
    const issues = await createJiraProvider(client, CONN, opts).getIssues('DEMO', true);
    expect(client.searchProjectIssues).toHaveBeenCalledWith(...AUTH, 'DEMO', {
      includeResolved: true,
      fields: jiraBoardFields(opts),
    });
    expect(issues[0]).toMatchObject({ idReadable: 'DEMO-1', summary: 'Rotate credentials' });
    expect(issues[0].fields.status).toBe('In Progress');
  });

  it('searches across projects with escaped free text', async () => {
    const client = stubClient();
    await createJiraProvider(client, CONN).searchIssues(['DEMO', 'OPS'], ' db "creds" ');
    expect(client.searchJql).toHaveBeenCalledWith(
      ...AUTH,
      'project in ("DEMO", "OPS") AND text ~ "db \\"creds\\"" ORDER BY updated DESC',
      jiraBoardFields(),
    );
  });

  it('omits the text clause for an empty query and returns nothing for no projects', async () => {
    const client = stubClient();
    const p = createJiraProvider(client, CONN);
    await p.searchIssues(['DEMO'], '   ');
    expect(vi.mocked(client.searchJql).mock.calls[0][3]).toBe('project in ("DEMO") ORDER BY updated DESC');
    await expect(p.searchIssues([], 'x')).resolves.toEqual([]);
    expect(client.searchJql).toHaveBeenCalledTimes(1);
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

  it('propagates client errors unchanged', async () => {
    const err = { status: 401, message: 'Client must be authenticated' };
    const client = stubClient({ listProjects: vi.fn(async () => Promise.reject(err)) });
    await expect(createJiraProvider(client, CONN).getProjects()).rejects.toBe(err);
  });
});
