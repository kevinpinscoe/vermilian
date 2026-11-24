import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getProjects,
  getIssues,
  getCurrentUser,
  getWorklogTypes,
  getIssuesForStandup,
  STANDUP_PAGE_SIZE,
  patchIssue,
  createIssue,
  findMasterPlanArticle,
  getIssuesForRecommendation,
  postComment,
  getIssuesByIds,
  getBoardIssue,
  getProjectFieldMetadata,
  getPriorityOrder,
} from './youtrack';
import { rejectInvalidStandupQuery } from './fakeYouTrack';
import { buildStandupPlan, buildStandupQuery } from '../../shared/youtrackStandup';
import { parseYouTrackProjectFields } from '../../shared/youtrackProjectFields';

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
  it('requests link wording, direction and linked resolution, and maps Depend links (VERM-94)', async () => {
    const DEPEND = { name: 'Depend', sourceToTarget: 'is required for', targetToSource: 'depends on', directed: true };
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '2-14', idReadable: 'READ-14', summary: 'Sync read state', resolved: null, customFields: [],
          links: [
            { direction: 'INWARD', linkType: DEPEND, issues: [{ id: '2-3', idReadable: 'SYNC-3', summary: 'Merge library', resolved: 1_790_000_000_000, customFields: [{ name: 'Status', value: { name: 'Done' } }] }] },
            { direction: 'OUTWARD', linkType: DEPEND, issues: [{ id: '2-41', idReadable: 'PLAT-41', summary: 'Token service', resolved: null, customFields: [] }] },
          ],
        },
      ]),
    );
    const [issue] = await getIssues(URL, TOKEN, 'READ');
    const requested = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(requested).toContain('links(direction,linkType(name,sourceToTarget,targetToSource,directed),issues(id,idReadable,summary,resolved,');
    expect(issue.links).toEqual([
      { type: 'Depend', directed: true, direction: 'inward', verb: 'depends on', issue: { id: '2-3', key: 'SYNC-3', summary: 'Merge library', resolved: true, status: 'Done' } },
      { type: 'Depend', directed: true, direction: 'outward', verb: 'is required for', issue: { id: '2-41', key: 'PLAT-41', summary: 'Token service', resolved: false, status: null } },
    ]);
  });

  it('leaves links absent (not read) when the response carries none, and [] when it carries empty buckets (VERM-94)', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([
      { id: '1', idReadable: 'TST-1', summary: 'A', resolved: null, customFields: [] },
      { id: '2', idReadable: 'TST-2', summary: 'B', resolved: null, customFields: [], links: [{ direction: 'BOTH', linkType: { name: 'Relates' }, issues: [] }] },
    ]));
    const [a, b] = await getIssues(URL, TOKEN, 'TST');
    expect(a.links).toBeUndefined();
    expect(b.links).toEqual([]);
  });

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
          issueDomain: null,
          editHost: null,
          affectedHost: null,
          focus: null,
          focusRank: null,
          whyNow: null,
        },
        parentEpic: null,
        isEpic: false,
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

  it('resolves the parent Epic from the expected INWARD Subtask-link bucket', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1', idReadable: 'TST-1', summary: 'Hello', resolved: null, customFields: [],
          links: [
            {
              direction: 'INWARD',
              linkType: { name: 'Subtask' },
              issues: [
                {
                  id: 'epic-1', idReadable: 'TST-100', summary: 'The Epic',
                  customFields: [{ name: 'Type', value: { name: 'Epic' } }],
                },
              ],
            },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].parentEpic).toEqual({ id: 'epic-1', idReadable: 'TST-100', summary: 'The Epic' });
  });

  it('resolves the parent Epic even when the Subtask link was authored in reverse (OUTWARD)', async () => {
    // Real-data finding (VERM-7, 2026-09-16): VERM-4 (Type Task) carries an
    // OUTWARD "Subtask" link to its Epic VERM-3, backwards from every other
    // subtask of that Epic. Resolution must key off the linked issue's own
    // Type being "Epic", not off which direction bucket it landed in.
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1', idReadable: 'TST-1', summary: 'Hello', resolved: null, customFields: [],
          links: [
            {
              direction: 'OUTWARD',
              linkType: { name: 'Subtask' },
              issues: [
                {
                  id: 'epic-1', idReadable: 'TST-100', summary: 'The Epic',
                  customFields: [{ name: 'Type', value: { name: 'Epic' } }],
                },
              ],
            },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].parentEpic).toEqual({ id: 'epic-1', idReadable: 'TST-100', summary: 'The Epic' });
  });

  it('does not treat a Subtask link to a non-Epic issue as a parent Epic', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1', idReadable: 'TST-1', summary: 'Hello', resolved: null, customFields: [],
          links: [
            {
              direction: 'OUTWARD',
              linkType: { name: 'Subtask' },
              issues: [
                {
                  id: 'child-1', idReadable: 'TST-2', summary: 'A child task',
                  customFields: [{ name: 'Type', value: { name: 'Task' } }],
                },
              ],
            },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].parentEpic).toBeNull();
  });

  it('leaves parentEpic null for an issue with no links field at all', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([{ id: '1', idReadable: 'TST-1', summary: 'Hello', resolved: null, customFields: [] }]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].parentEpic).toBeNull();
  });

  it('does not crash and leaves parentEpic null when a linked issue has no customFields at all', async () => {
    // Malformed/partial API response — the linked issue's Type is simply
    // unreadable, not "confirmed non-Epic".
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1', idReadable: 'TST-1', summary: 'Hello', resolved: null, customFields: [],
          links: [
            {
              direction: 'INWARD',
              linkType: { name: 'Subtask' },
              issues: [{ id: 'epic-1', idReadable: 'TST-100', summary: 'The Epic' }],
            },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].parentEpic).toBeNull();
  });

  it('does not crash and leaves parentEpic null when the linked issue\'s Type value is malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1', idReadable: 'TST-1', summary: 'Hello', resolved: null, customFields: [],
          links: [
            {
              direction: 'INWARD',
              linkType: { name: 'Subtask' },
              issues: [
                {
                  id: 'epic-1', idReadable: 'TST-100', summary: 'The Epic',
                  customFields: [{ name: 'Type', value: null }],
                },
              ],
            },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].parentEpic).toBeNull();
  });

  it('resolves deterministically to the lowest idReadable when more than one Epic-typed parent is linked', async () => {
    // The Subtask link type does not forbid an issue carrying more than one
    // such link — resolution must not depend on which bucket (here, INWARD
    // vs OUTWARD) happened to be returned first.
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1', idReadable: 'TST-1', summary: 'Hello', resolved: null, customFields: [],
          links: [
            {
              direction: 'OUTWARD',
              linkType: { name: 'Subtask' },
              issues: [
                {
                  id: 'epic-9', idReadable: 'TST-900', summary: 'Epic Nine',
                  customFields: [{ name: 'Type', value: { name: 'Epic' } }],
                },
              ],
            },
            {
              direction: 'INWARD',
              linkType: { name: 'Subtask' },
              issues: [
                {
                  id: 'epic-1', idReadable: 'TST-100', summary: 'Epic One',
                  customFields: [{ name: 'Type', value: { name: 'Epic' } }],
                },
              ],
            },
          ],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].parentEpic).toEqual({ id: 'epic-1', idReadable: 'TST-100', summary: 'Epic One' });
  });

  it('marks an issue isEpic when its own Type is Epic', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        {
          id: '1', idReadable: 'TST-1', summary: 'An Epic', resolved: null,
          customFields: [{ name: 'Type', $type: 'SingleEnumIssueCustomField', value: { name: 'Epic' } }],
        },
      ]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].isEpic).toBe(true);
  });

  it('leaves isEpic false when the Type field is absent or not Epic', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([{ id: '1', idReadable: 'TST-1', summary: 'Hello', resolved: null, customFields: [] }]),
    );
    const issues = await getIssues(URL, TOKEN, 'TST');
    expect(issues[0].isEpic).toBe(false);
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

describe('getIssuesForStandup (VERM-114)', () => {
  // Two projects with different workflows. BETA has no "In Progress", no
  // "BLOCKED" and no "Done"; ALPHA has none of BETA's names.
  const field = (values: Array<[string, boolean]>, priority: string[] = []) => [
    { field: { name: 'Priority' }, $type: 'EnumProjectCustomField', bundle: { values: priority.map((name, ordinal) => ({ name, ordinal })) } },
    { field: { name: 'Status' }, $type: 'StateProjectCustomField', bundle: { values: values.map(([name, isResolved], ordinal) => ({ name, isResolved, ordinal })) } },
  ];
  const ALPHA = field([['To do', false], ['In Progress', false], ['Waiting for IT', false], ['BLOCKED', false], ['Done', true], ['Wont do', true]], ['Critical', 'Normal']);
  const BETA = field([['Open', false], ['Doing', false], ['Stuck', false], ['Fixed', true], ['Duplicate', true]]);
  const BUNDLES: Record<string, string[]> = {
    ALPHA: ['To do', 'In Progress', 'Waiting for IT', 'BLOCKED', 'Done', 'Wont do'],
    BETA: ['Open', 'Doing', 'Stuck', 'Fixed', 'Duplicate'],
  };
  const plan = () =>
    buildStandupPlan(
      [
        { shortName: 'ALPHA', metadata: parseYouTrackProjectFields(ALPHA) },
        { shortName: 'BETA', metadata: parseYouTrackProjectFields(BETA) },
      ],
      // BETA names its own blocked state.
      { BETA: { statusRoles: { Stuck: 'blocked' } } },
    );
  const emittedQuery = () => new globalThis.URL(lastCall()[0]).searchParams.get('query') ?? '';
  const issue = (key: string, project: string, status: string, updated = 9) => ({
    id: key, idReadable: key, summary: key, updated, project: { shortName: project },
    customFields: [{ name: 'Status', $type: 'StateIssueCustomField', value: { name: status } }],
  });

  it('returns empty buckets without a network call when the plan has no projects', async () => {
    const out = await getIssuesForStandup(URL, TOKEN, { projects: [] }, 0);
    expect(out).toEqual({ done: [], inProgress: [], blocked: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emits one clause per project naming only that project\'s own discovered values', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await getIssuesForStandup(URL, TOKEN, plan(), 0);
    expect(emittedQuery()).toBe(
      '(project: {ALPHA} and {Status}: {In Progress},{Waiting for IT},{BLOCKED},{Done})' +
        ' or (project: {BETA} and {Status}: {Doing},{Stuck},{Fixed},{Duplicate})',
    );
    expect(emittedQuery()).not.toMatch(/Working on it/);
    // The fake applies the live server's rule to the emitted text and accepts it.
    expect(() => rejectInvalidStandupQuery(emittedQuery(), (p) => BUNDLES[p] ?? [])).not.toThrow();
  });

  it('the fake rejects a value that belongs only to the other project, as the live server does', () => {
    const wrong = plan();
    // Put BETA's "Fixed" into ALPHA's clause.
    wrong.projects[0].groups.Fixed = 'done';
    expect(() => rejectInvalidStandupQuery(buildStandupQuery(wrong), (p) => BUNDLES[p] ?? [])).toThrow(
      expect.objectContaining({ status: 400, message: expect.stringMatching(/"Fixed" isn't used for the Status field/) }),
    );
  });

  it('groups each issue by its own project\'s mapping and drops done issues older than the cutoff', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        issue('ALPHA-1', 'ALPHA', 'Done', 2000),
        issue('ALPHA-2', 'ALPHA', 'Done', 500),
        issue('ALPHA-3', 'ALPHA', 'In Progress'),
        issue('ALPHA-4', 'ALPHA', 'Waiting for IT'),
        issue('ALPHA-5', 'ALPHA', 'BLOCKED'),
        issue('ALPHA-6', 'ALPHA', 'Wont do', 2000),
        issue('BETA-1', 'BETA', 'Fixed', 2000),
        issue('BETA-2', 'BETA', 'Doing'),
        issue('BETA-3', 'BETA', 'Stuck'),
        issue('BETA-4', 'BETA', 'Duplicate', 2000),
      ]),
    );
    const out = await getIssuesForStandup(URL, TOKEN, plan(), 1000);
    // Wont do is the only default exclusion; BETA's Duplicate counts as done.
    expect(out.done.map((t) => t.idReadable)).toEqual(['ALPHA-1', 'BETA-1', 'BETA-4']);
    expect(out.inProgress.map((t) => t.idReadable)).toEqual(['ALPHA-3', 'ALPHA-4', 'BETA-2']);
    expect(out.blocked.map((t) => t.idReadable)).toEqual(['ALPHA-5', 'BETA-3']);
  });
});

describe('getIssuesForStandup paging (VERM-114 review)', () => {
  const plan = buildStandupPlan(
    [{ shortName: 'ALPHA', metadata: parseYouTrackProjectFields([
      { field: { name: 'Status' }, $type: 'StateProjectCustomField', bundle: { values: [['In Progress', false], ['BLOCKED', false], ['Done', true]].map(([name, isResolved], ordinal) => ({ name, isResolved, ordinal })) } },
    ]) }],
    undefined,
  );
  const issue = (n: number, status: string, updated = 9) => ({
    id: `ALPHA-${n}`, idReadable: `ALPHA-${n}`, summary: `ALPHA-${n}`, updated, project: { shortName: 'ALPHA' },
    customFields: [{ name: 'Status', $type: 'StateIssueCustomField', value: { name: status } }],
  });
  const fullPage = (from: number, status = 'In Progress') =>
    Array.from({ length: STANDUP_PAGE_SIZE }, (_, i) => issue(from + i, status));
  const skips = () => fetchMock.mock.calls.map(([u]) => new globalThis.URL(String(u)).searchParams.get('$skip'));

  it('reads every page, so a blocked ticket on page two is reported, exactly once', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes(fullPage(1)))
      // Page two repeats page one's last issue (results shifted between
      // requests) and carries the blocked ticket.
      .mockResolvedValueOnce(jsonRes([issue(STANDUP_PAGE_SIZE, 'In Progress'), issue(900, 'BLOCKED')]));
    const out = await getIssuesForStandup(URL, TOKEN, plan, 0);
    expect(skips()).toEqual(['0', String(STANDUP_PAGE_SIZE)]);
    expect(out.blocked.map((t) => t.idReadable)).toEqual(['ALPHA-900']);
    expect(out.inProgress).toHaveLength(STANDUP_PAGE_SIZE);
    expect(new Set(out.inProgress.map((t) => t.idReadable)).size).toBe(STANDUP_PAGE_SIZE);
  });

  it('a full last page is followed by one more request, and stops at the empty page', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(fullPage(1))).mockResolvedValueOnce(jsonRes([]));
    const out = await getIssuesForStandup(URL, TOKEN, plan, 0);
    expect(skips()).toEqual(['0', String(STANDUP_PAGE_SIZE)]);
    expect(out.inProgress).toHaveLength(STANDUP_PAGE_SIZE);
  });

  it('keeps the completed-work cutoff on every page', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes([...fullPage(1, 'Done').map((i) => ({ ...i, updated: 500 }))]))
      .mockResolvedValueOnce(jsonRes([issue(901, 'Done', 2000), issue(902, 'Done', 500)]));
    const out = await getIssuesForStandup(URL, TOKEN, plan, 1000);
    expect(out.done.map((t) => t.idReadable)).toEqual(['ALPHA-901']);
  });

  // No fixed cap (VERM-114 review, round 2): the read ends only at a short
  // page, however many issues match.
  const pagesOf = (total: number, statusAt: (n: number) => string = () => 'In Progress') => {
    const pages: ReturnType<typeof issue>[][] = [];
    for (let from = 1; from <= total; from += STANDUP_PAGE_SIZE) {
      pages.push(Array.from({ length: Math.min(STANDUP_PAGE_SIZE, total - from + 1) }, (_, i) => issue(from + i, statusAt(from + i))));
    }
    if (total % STANDUP_PAGE_SIZE === 0) pages.push([]);
    return pages;
  };
  const serve = (pages: ReturnType<typeof issue>[][]) =>
    fetchMock.mockImplementation(async (u: string) => {
      const skip = Number(new globalThis.URL(u).searchParams.get('$skip'));
      return jsonRes(pages[skip / STANDUP_PAGE_SIZE] ?? []);
    });

  it('exactly 5,000 matches: every one is read, ending at the empty page after the fiftieth', async () => {
    serve(pagesOf(5000));
    const out = await getIssuesForStandup(URL, TOKEN, plan, 0);
    expect(out.inProgress).toHaveLength(5000);
    expect(new Set(out.inProgress.map((t) => t.idReadable)).size).toBe(5000);
    expect(fetchMock).toHaveBeenCalledTimes(51);
  });

  it('a blocked ticket at match 5,001 is reported, exactly once', async () => {
    serve(pagesOf(5001, (n) => (n === 5001 ? 'BLOCKED' : 'In Progress')));
    const out = await getIssuesForStandup(URL, TOKEN, plan, 0);
    expect(out.blocked.map((t) => t.idReadable)).toEqual(['ALPHA-5001']);
    expect(out.inProgress).toHaveLength(5000);
    expect(fetchMock).toHaveBeenCalledTimes(51);
  });

  it('old completed tickets beyond 5,000 do not stop a small report', async () => {
    // Years of history: 6,000 old Done tickets, then today's one blocked ticket.
    serve(pagesOf(6001, (n) => (n === 6001 ? 'BLOCKED' : 'Done')).map((p) => p.map((i) => ({ ...i, updated: 500 }))));
    const out = await getIssuesForStandup(URL, TOKEN, plan, 1000);
    expect(out.done).toEqual([]);
    expect(out.blocked.map((t) => t.idReadable)).toEqual(['ALPHA-6001']);
  });

  it('stops with a clear error when YouTrack keeps returning the same page', async () => {
    fetchMock.mockImplementation(async () => jsonRes(fullPage(1)));
    await expect(getIssuesForStandup(URL, TOKEN, plan, 0)).rejects.toMatchObject({
      message: expect.stringMatching(/returned the same page of results again/),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getProjectFieldMetadata / getPriorityOrder (VERM-114, VERM-92)', () => {
  it('reads the project\'s fields once, and the Priority order comes from the same read', async () => {
    fetchMock.mockResolvedValue(
      jsonRes([
        { field: { name: 'Priority' }, $type: 'EnumProjectCustomField', bundle: { values: [{ name: 'Minor', ordinal: 2 }, { name: 'Major', ordinal: 0 }] } },
        { field: { name: 'Status' }, $type: 'StateProjectCustomField', canBeEmpty: false, defaultValues: [{ name: 'Open' }], bundle: { values: [{ name: 'Open', isResolved: false, ordinal: 0 }, { name: 'Fixed', isResolved: true, ordinal: 1 }] } },
      ]),
    );
    const meta = await getProjectFieldMetadata(URL, TOKEN, 'BETA');
    expect(lastCall()[0]).toContain('/api/admin/projects/BETA/customFields?fields=');
    expect(lastCall()[0]).toContain('bundle(values(name,isResolved,ordinal,archived))');
    expect(meta.fields.find((f) => f.name === 'Status')).toEqual({
      name: 'Status', type: 'StateProjectCustomField', canBeEmpty: false, defaults: ['Open'],
      values: [{ name: 'Open', isResolved: false, archived: false }, { name: 'Fixed', isResolved: true, archived: false }],
    });
    await expect(getPriorityOrder(URL, TOKEN, 'BETA')).resolves.toEqual(['Major', 'Minor']);
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

// ─── findMasterPlanArticle ───────────────────────────────────────────────────

function fillerArticles(n: number, startId = 0): { id: string; summary: string; content: string; updated: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `filler-${startId + i}`,
    summary: `_not-master-plan-${startId + i}`,
    content: '',
    updated: 0,
  }));
}

describe('findMasterPlanArticle', () => {
  it('uses the project-scoped articles endpoint, not the global one', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await findMasterPlanArticle(URL, TOKEN);
    const [calledUrl] = lastCall();
    expect(calledUrl).toBe(
      'https://yt.example.com/api/admin/projects/VERM/articles?fields=id,idReadable,summary,content,updated&$top=100&$skip=0',
    );
  });

  it('returns none when a complete (single-page) search finds no match', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(fillerArticles(3)));
    const result = await findMasterPlanArticle(URL, TOKEN);
    expect(result).toEqual({ status: 'none' });
  });

  it('returns found for exactly one match', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        ...fillerArticles(2),
        { id: '183-6', summary: '_vermilian-master-plan', content: '## Outcome\n', updated: 111 },
      ]),
    );
    const result = await findMasterPlanArticle(URL, TOKEN);
    expect(result).toEqual({
      status: 'found',
      article: { id: '183-6', content: '## Outcome\n', updated: 111 },
    });
  });

  it('returns ambiguous — never picking one — when more than one article matches', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        { id: 'a1', summary: '_vermilian-master-plan', content: 'A', updated: 1 },
        { id: 'a2', summary: '_vermilian-master-plan', content: 'B', updated: 2 },
      ]),
    );
    const result = await findMasterPlanArticle(URL, TOKEN);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.articles.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    }
  });

  it('pages to completion — a match on a later page is still found, not lost to a bounded first page', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes(fillerArticles(100))) // a full page — must page again
      .mockResolvedValueOnce(
        jsonRes([{ id: '183-6', summary: '_vermilian-master-plan', content: 'C', updated: 5 }]),
      );
    const result = await findMasterPlanArticle(URL, TOKEN);
    expect(result).toEqual({ status: 'found', article: { id: '183-6', content: 'C', updated: 5 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toContain('$skip=100');
  });

  it('returns discovery-error rather than none when a page request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const result = await findMasterPlanArticle(URL, TOKEN);
    expect(result).toEqual({ status: 'discovery-error' });
  });

  it('returns discovery-incomplete — not none, not found — when pagination cannot reach completeness', async () => {
    // Every page comes back full (100 items), so the loop never sees a
    // short page and must exhaust the safety cap instead of concluding
    // the search is complete.
    fetchMock.mockImplementation(() => Promise.resolve(jsonRes(fillerArticles(100))));
    const result = await findMasterPlanArticle(URL, TOKEN);
    expect(result).toEqual({ status: 'discovery-incomplete' });
  });
});

// ─── getIssuesForRecommendation (VERM-8) ───────────────────────────────────

describe('getIssuesForRecommendation', () => {
  it('returns an empty array with no request made for an empty id list', async () => {
    const result = await getIssuesForRecommendation(URL, TOKEN, []);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches exactly one request per given id — never a project-wide query', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({
        id: 'p-1', idReadable: 'TEST-1', summary: 'First', description: 'Detail one', resolved: null,
        customFields: [{ name: 'Status', $type: 'StateIssueCustomField', value: { name: 'To do' } }],
        links: [],
      }))
      .mockResolvedValueOnce(jsonRes({
        id: 'p-2', idReadable: 'TEST-2', summary: 'Second', description: null, resolved: null,
        customFields: [{ name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Critical' } }],
        links: [],
      }));

    const result = await getIssuesForRecommendation(URL, TOKEN, ['p-1', 'p-2']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([u]) => u as string);
    expect(urls[0]).toContain('/api/issues/p-1');
    expect(urls[1]).toContain('/api/issues/p-2');
    // Never a bounded/project-wide query string like getIssues uses.
    expect(urls.every((u) => !u.includes('query='))).toBe(true);

    expect(result).toEqual([
      { id: 'p-1', idReadable: 'TEST-1', summary: 'First', description: 'Detail one', status: 'To do', priority: null, links: [] },
      { id: 'p-2', idReadable: 'TEST-2', summary: 'Second', description: null, status: null, priority: 'Critical', links: [] },
    ]);
  });

  it('carries full link-type/direction/linked-issue data, not just Subtask buckets', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({
      id: 'p-1', idReadable: 'TEST-1', summary: 'First', description: null, resolved: null,
      customFields: [],
      links: [
        {
          direction: 'OUTWARD', linkType: { name: 'Depends on' },
          issues: [{ id: 'p-9', idReadable: 'TEST-9', summary: 'Blocker', customFields: [{ name: 'Status', value: { name: 'In Progress' } }] }],
        },
      ],
    }));

    const [result] = await getIssuesForRecommendation(URL, TOKEN, ['p-1']);
    expect(result.links).toEqual([
      { linkType: 'Depends on', direction: 'OUTWARD', issues: [{ idReadable: 'TEST-9', summary: 'Blocker', status: 'In Progress' }] },
    ]);
  });
});

// ─── postComment (VERM-8) ───────────────────────────────────────────────────

describe('postComment', () => {
  it('POSTs the comment text to the issue\'s comments endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: 'c-1' }));
    await postComment(URL, TOKEN, 'p-1', 'Priority Desk recommendation\n\nRanked:\n1. TEST-1');

    const [url, init] = lastCall();
    expect(url).toContain('/api/issues/p-1/comments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Priority Desk recommendation\n\nRanked:\n1. TEST-1' });
  });
});

// ─── Runway tickets by ID (VERM-84) ─────────────────────────────────────────

describe('getIssuesByIds / getBoardIssue', () => {
  it('reads a batch with one issue id: query', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([{ id: '2-1', idReadable: 'READ-12', summary: 'Cache articles locally', customFields: [] }]));
    const issues = await getIssuesByIds(URL, TOKEN, ['READ-12', 'SYNC-3']);
    const [calledUrl] = lastCall();
    expect(decodeURIComponent(calledUrl)).toContain('query=issue id: READ-12, SYNC-3');
    expect(issues.map((i) => i.idReadable)).toEqual(['READ-12']);
  });

  it('makes no request when no valid ID is left', async () => {
    await expect(getIssuesByIds(URL, TOKEN, ['not an id'])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a single read 404 with its status', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Not Found', error_description: 'Entity with id GONE-1 not found' }, { ok: false, status: 404, statusText: 'Not Found' }));
    await expect(getBoardIssue(URL, TOKEN, 'GONE-1')).rejects.toEqual({ status: 404, message: 'Entity with id GONE-1 not found' });
  });

  it('refuses an invalid ID without a request', async () => {
    await expect(getBoardIssue(URL, TOKEN, '../admin')).rejects.toMatchObject({ message: expect.stringMatching(/Invalid YouTrack issue ID/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
