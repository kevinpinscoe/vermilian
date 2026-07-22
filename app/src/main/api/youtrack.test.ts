import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getProjects,
  getIssues,
  getCurrentUser,
  getWorklogTypes,
  getIssuesForStandup,
  patchIssue,
  createIssue,
} from './youtrack';

const URL = 'https://yt.example.com/';
const TOKEN = 'tok';

// ─── fetch stub ─────────────────────────────────────────────────────────────

interface ResInit {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
}

function jsonRes(body: unknown, init: ResInit = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Convenience: the last fetch call's [url, init].
function lastCall(): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
}

// ─── getProjects ──────────────────────────────────────────────────────────────

describe('getProjects', () => {
  it('excludes archived projects and strips the archived flag', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        { id: '0-0', name: 'Demo', shortName: 'DEMO', archived: true },
        { id: '0-1', name: 'Test', shortName: 'TST', archived: false },
        { id: '0-2', name: 'Work', shortName: 'WRK' },
      ]),
    );
    const projects = await getProjects(URL, TOKEN);
    expect(projects).toEqual([
      { id: '0-1', name: 'Test', shortName: 'TST' },
      { id: '0-2', name: 'Work', shortName: 'WRK' },
    ]);
  });

  it('sends the auth header and normalizes the trailing slash in the base URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await getProjects(URL, TOKEN);
    const [calledUrl, init] = lastCall();
    expect(calledUrl).toBe('https://yt.example.com/api/admin/projects?fields=id,name,shortName,archived&$top=1000');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});

// ─── getIssues ──────────────────────────────────────────────────────────────

describe('getIssues', () => {
  it('transforms YouTrack custom fields into the flat board shape', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1',
          idReadable: 'TST-1',
          summary: 'Hello',
          resolved: null,
          customFields: [
            { name: 'Status', $type: 'StateIssueCustomField', value: { name: 'In Progress' } },
            { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Critical' } },
            { name: 'Due Date', $type: 'DateIssueCustomField', value: 1700000000000 },
            { name: 'Ticket', $type: 'SimpleIssueCustomField', value: 'JIRA-9' },
            { name: 'Notes', $type: 'SimpleIssueCustomField', value: 'a note' },
            { name: 'Assignee', $type: 'SingleUserIssueCustomField', value: { login: 'kevin' } },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues).toEqual([
      {
        id: '1',
        idReadable: 'TST-1',
        summary: 'Hello',
        resolved: null,
        fields: {
          status: 'In Progress',
          priority: 'Critical',
          category: null,
          dueDate: 1700000000000,
          ticket: 'JIRA-9',
          ticketLink: null,
          relatedLink: null,
          notes: 'a note',
          dateTimeEntered: null,
          assignee: 'kevin',
          ghosttyTabName: null,
          repoUrl: null,
          workingBranch: null,
          trackingFileUrl: null,
          todoFileUrl: null,
          projectHealth: null,
          progressPercent: null,
          nextStatusDue: null,
          reportingCadence: null,
          baseBranch: null,
          pullRequestUrl: null,
          artifactUrl: null,
          lastReportedCommit: null,
        },
      },
    ]);
  });

  it('resolves the right field when two custom fields share a display name but differ by $type', async () => {
    // The live instance carries duplicate "Status" prototypes: one StateIssueCustomField
    // (the one actually in use, attached to every project) and one orphaned text
    // prototype attached to nothing. Extraction must resolve by name AND $type together.
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1',
          idReadable: 'TST-1',
          summary: 'Hello',
          resolved: null,
          customFields: [
            { name: 'Status', $type: 'TextIssueCustomField', value: { text: 'stale orphaned value' } },
            { name: 'Status', $type: 'StateIssueCustomField', value: { name: 'In Progress' } },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].fields.status).toBe('In Progress');
  });

  it('extracts a raw numeric custom field (Progress percent) as a number, not null', async () => {
    // Regression: parseFieldStringValue only matches typeof === 'string', so a
    // raw numeric value would silently extract as null without the integer wire.
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1',
          idReadable: 'TST-1',
          summary: 'Hello',
          resolved: null,
          customFields: [
            { name: 'Progress percent', $type: 'SimpleIssueCustomField', value: 10 },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].fields.progressPercent).toBe(10);
  });

  it('URL-encodes the project query', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await getIssues(URL, TOKEN, 'TST');
    expect(lastCall()[0]).toContain('query=project%3A%20TST');
  });

  it('short-circuits an empty/whitespace short name without a network call', async () => {
    const out = await getIssues(URL, TOKEN, '   ');
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── getCurrentUser ───────────────────────────────────────────────────────────

describe('getCurrentUser', () => {
  it('prefers fullName, then name, then login', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ login: 'k', name: 'Kev', fullName: 'Ada Lovelace' }));
    expect(await getCurrentUser(URL, TOKEN)).toBe('Ada Lovelace');

    fetchMock.mockResolvedValueOnce(jsonRes({ login: 'k', name: 'Kev' }));
    expect(await getCurrentUser(URL, TOKEN)).toBe('Kev');

    fetchMock.mockResolvedValueOnce(jsonRes({ login: 'k' }));
    expect(await getCurrentUser(URL, TOKEN)).toBe('k');
  });
});

// ─── getWorklogTypes ──────────────────────────────────────────────────────────

describe('getWorklogTypes', () => {
  it('returns the work-item type names', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([{ id: '1', name: 'Development' }, { id: '2', name: 'Testing' }]));
    expect(await getWorklogTypes(URL, TOKEN)).toEqual(['Development', 'Testing']);
  });

  it('falls back to ["Development"] when the list is empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    expect(await getWorklogTypes(URL, TOKEN)).toEqual(['Development']);
  });

  it('falls back to ["Development"] when the request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'nope' }, { ok: false, status: 500 }));
    expect(await getWorklogTypes(URL, TOKEN)).toEqual(['Development']);
  });
});

// ─── error parsing ────────────────────────────────────────────────────────────

describe('request error handling', () => {
  it('throws a YouTrackError with status and the richest message field', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({ error_description: 'Token expired', error: 'invalid_token' }, { ok: false, status: 401 }),
    );
    await expect(getCurrentUser(URL, TOKEN)).rejects.toMatchObject({
      status: 401,
      message: 'Token expired',
    });
  });

  it('keeps the statusText when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: { get: (): string | null => null },
      json: async (): Promise<unknown> => {
        throw new Error('not json');
      },
    });
    await expect(getCurrentUser(URL, TOKEN)).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
  });
});

// ─── getIssuesForStandup ──────────────────────────────────────────────────────

describe('getIssuesForStandup', () => {
  it('returns empty buckets without a network call when no projects are given', async () => {
    const out = await getIssuesForStandup(URL, TOKEN, [], 0);
    expect(out).toEqual({ done: [], inProgress: [], blocked: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('buckets issues by status and drops Done issues older than the cutoff', async () => {
    const cutoff = 1000;
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        { id: '1', idReadable: 'T-1', summary: 'recent done', updated: 2000, customFields: [{ name: 'Status', $type: 'StateIssueCustomField', value: { name: 'Done' } }] },
        { id: '2', idReadable: 'T-2', summary: 'stale done', updated: 500, customFields: [{ name: 'Status', $type: 'StateIssueCustomField', value: { name: 'Done' } }] },
        { id: '3', idReadable: 'T-3', summary: 'wip', updated: 9, customFields: [{ name: 'Status', $type: 'StateIssueCustomField', value: { name: 'In Progress' } }] },
        { id: '4', idReadable: 'T-4', summary: 'blocked', updated: 9, customFields: [{ name: 'Status', $type: 'StateIssueCustomField', value: { name: 'BLOCKED' } }] },
        { id: '5', idReadable: 'T-5', summary: 'waiting', updated: 9, customFields: [{ name: 'Status', $type: 'StateIssueCustomField', value: { name: 'Waiting for IT' } }] },
      ]),
    );
    const out = await getIssuesForStandup(URL, TOKEN, ['TST'], cutoff);
    expect(out.done.map((t) => t.idReadable)).toEqual(['T-1']);
    expect(out.inProgress.map((t) => t.idReadable)).toEqual(['T-3', 'T-5']);
    expect(out.blocked.map((t) => t.idReadable)).toEqual(['T-4']);
  });
});

// ─── patchIssue ───────────────────────────────────────────────────────────────

describe('patchIssue', () => {
  it('patches summary via the top-level field, not customFields', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '1' }));
    await patchIssue(URL, TOKEN, '1', 'summary', 'New title');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ summary: 'New title' });
  });

  it('wraps enum/state values in { name }', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '1' }));
    await patchIssue(URL, TOKEN, '1', 'priority', 'Critical');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      customFields: [{ name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Critical' } }],
    });
  });

  it('sends a raw unwrapped integer for Progress percent', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '1' }));
    await patchIssue(URL, TOKEN, '1', 'progressPercent', 42);
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      customFields: [{ name: 'Progress percent', $type: 'SimpleIssueCustomField', value: 42 }],
    });
  });

  it('sends notes as a raw string, not the old { text } wrapper', async () => {
    // BUG-005: notes is a SimpleIssueCustomField on the live instance, not
    // TextIssueCustomField — the { text } wrapper was a type mismatch.
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '1' }));
    await patchIssue(URL, TOKEN, '1', 'notes', 'hello');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      customFields: [{ name: 'Notes', $type: 'SimpleIssueCustomField', value: 'hello' }],
    });
  });

  it('sends category as a state value ({ name }), not the old enum shape', async () => {
    // BUG-005: category is a StateIssueCustomField on the live instance, not
    // SingleEnumIssueCustomField.
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '1' }));
    await patchIssue(URL, TOKEN, '1', 'category', 'TASK');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      customFields: [{ name: 'Category', $type: 'StateIssueCustomField', value: { name: 'TASK' } }],
    });
  });

  it('patches relatedLink under its renamed field, Related link', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '1' }));
    await patchIssue(URL, TOKEN, '1', 'relatedLink', 'https://example.com');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      customFields: [{ name: 'Related link', $type: 'SimpleIssueCustomField', value: 'https://example.com' }],
    });
  });

  it('sends a raw number for date fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '1' }));
    await patchIssue(URL, TOKEN, '1', 'dueDate', 1700000000000);
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      customFields: [{ name: 'Due Date', $type: 'DateIssueCustomField', value: 1700000000000 }],
    });
  });

  it('sends null (not a wrapper) when clearing an enum field', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '1' }));
    await patchIssue(URL, TOKEN, '1', 'priority', null);
    expect(JSON.parse(lastCall()[1].body as string).customFields[0].value).toBeNull();
  });

  it('throws on an unknown field', async () => {
    await expect(patchIssue(URL, TOKEN, '1', 'bogus', 'x')).rejects.toThrow('Unknown field: bogus');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── createIssue ──────────────────────────────────────────────────────────────

describe('createIssue', () => {
  it('omits null custom fields but always stamps Date time entered', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '5', idReadable: 'TST-5' }));
    const result = await createIssue(URL, TOKEN, {
      projectId: '0-1',
      summary: 'New task',
      status: 'To do',
      priority: null,
      category: null,
      dueDate: null,
      ticket: null,
      ticketLink: null,
      relatedLink: null,
      notes: 'note body',
      repoUrl: null,
    });
    expect(result).toEqual({ id: '5', idReadable: 'TST-5' });

    const body = JSON.parse(lastCall()[1].body as string);
    expect(body.summary).toBe('New task');
    expect(body.project).toEqual({ id: '0-1' });
    const names = body.customFields.map((f: { name: string }) => f.name);
    expect(names).toContain('Status');
    expect(names).toContain('Notes');
    expect(names).toContain('Date time entered');
    expect(names).not.toContain('Priority');
    expect(names).not.toContain('Category');
  });

  it('sends notes as a raw string in the create payload too', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '5', idReadable: 'TST-5' }));
    await createIssue(URL, TOKEN, {
      projectId: '0-1',
      summary: 'New task',
      status: null,
      priority: null,
      category: null,
      dueDate: null,
      ticket: null,
      ticketLink: null,
      relatedLink: null,
      notes: 'note body',
      repoUrl: null,
    });
    const body = JSON.parse(lastCall()[1].body as string);
    const notesField = body.customFields.find((f: { name: string }) => f.name === 'Notes');
    expect(notesField).toEqual({ name: 'Notes', $type: 'SimpleIssueCustomField', value: 'note body' });
  });

  it('sends category as a state value in the create payload too', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '5', idReadable: 'TST-5' }));
    await createIssue(URL, TOKEN, {
      projectId: '0-1',
      summary: 'New task',
      status: null,
      priority: null,
      category: 'TASK',
      dueDate: null,
      ticket: null,
      ticketLink: null,
      relatedLink: null,
      notes: null,
      repoUrl: null,
    });
    const body = JSON.parse(lastCall()[1].body as string);
    const categoryField = body.customFields.find((f: { name: string }) => f.name === 'Category');
    expect(categoryField).toEqual({ name: 'Category', $type: 'StateIssueCustomField', value: { name: 'TASK' } });
  });

  it('includes Repo URL when set — the only creatable field among the 13 added later', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: '5', idReadable: 'TST-5' }));
    await createIssue(URL, TOKEN, {
      projectId: '0-1',
      summary: 'New task',
      status: null,
      priority: null,
      category: null,
      dueDate: null,
      ticket: null,
      ticketLink: null,
      relatedLink: null,
      notes: null,
      repoUrl: 'https://git.example.com/kinscoe/vermilian',
    });
    const body = JSON.parse(lastCall()[1].body as string);
    const repoUrlField = body.customFields.find((f: { name: string }) => f.name === 'Repo URL');
    expect(repoUrlField).toEqual({
      name: 'Repo URL', $type: 'SimpleIssueCustomField', value: 'https://git.example.com/kinscoe/vermilian',
    });
  });
});
