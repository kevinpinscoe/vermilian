import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectCloudId,
  searchJql,
  searchMyOpenIssues,
  MY_OPEN_ISSUES_JQL,
  SEARCH_PAGE_SIZE,
  gatewayApiBase,
  getMyself,
  probeJiraToken,
  siteApiBase,
  JIRA_GATEWAY,
} from './jira';
import type { JiraProfile } from '../../shared/jiraProfile';

const SITE = 'https://example.atlassian.net';
const CLOUD_ID = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'me@example.com';
const CLASSIC = 'classic-token';
const SCOPED = 'scoped-token';

const ME = { accountId: 'acc-1', displayName: 'Example User', emailAddress: EMAIL };

function profile(overrides: Partial<JiraProfile> = {}): JiraProfile {
  return { siteUrl: SITE, email: EMAIL, cloudId: '', ...overrides };
}

function basic(token: string): string {
  return `Basic ${Buffer.from(`${EMAIL}:${token}`).toString('base64')}`;
}

// ─── fake Jira ──────────────────────────────────────────────────────────────
// Routes fetch by URL the way Jira Cloud does: tenant_info is public; the site
// URL accepts only the classic token; the gateway accepts both kinds for the
// right cloudId. Flags break individual routes.

interface FakeJira {
  tenantInfo: 'ok' | 'missing' | '404' | 'network';
  site: 'ok' | '500' | 'network';
  gateway: 'ok' | '500';
}

let fake: FakeJira;
let fetchMock: ReturnType<typeof vi.fn>;

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `HTTP ${status}`,
    json: async () => body,
  };
}

function fakeJira(url: string, init?: RequestInit) {
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;

  if (url === `${SITE}/_edge/tenant_info`) {
    if (fake.tenantInfo === 'network') return Promise.reject(new TypeError('fetch failed'));
    if (fake.tenantInfo === '404') return Promise.resolve(res(404, {}));
    return Promise.resolve(res(200, fake.tenantInfo === 'ok' ? { cloudId: CLOUD_ID } : {}));
  }
  if (url === `${SITE}/rest/api/3/myself`) {
    if (fake.site === 'network') return Promise.reject(new TypeError('fetch failed'));
    if (fake.site === '500') return Promise.resolve(res(500, { errorMessages: ['Internal error'] }));
    return Promise.resolve(
      auth === basic(CLASSIC) ? res(200, ME) : res(401, { errorMessages: ['Client must be authenticated'] }),
    );
  }
  if (url === `${JIRA_GATEWAY}/ex/jira/${CLOUD_ID}/rest/api/3/myself`) {
    if (fake.gateway === '500') return Promise.resolve(res(500, { message: 'Gateway error' }));
    return Promise.resolve(
      auth === basic(CLASSIC) || auth === basic(SCOPED) ? res(200, ME) : res(401, { message: 'Unauthorized' }),
    );
  }
  return Promise.resolve(res(404, { message: `no route: ${url}` }));
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  fake = { tenantInfo: 'ok', site: 'ok', gateway: 'ok' };
  fetchMock = vi.fn(fakeJira);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── bases ──────────────────────────────────────────────────────────────────

describe('API bases', () => {
  it('uses the site URL without a trailing slash', () => {
    expect(siteApiBase(`${SITE}/`)).toBe(SITE);
  });

  it('routes the gateway by cloudId', () => {
    expect(gatewayApiBase(CLOUD_ID)).toBe(`https://api.atlassian.com/ex/jira/${CLOUD_ID}`);
  });
});

// ─── detectCloudId ──────────────────────────────────────────────────────────

describe('detectCloudId', () => {
  it('reads the cloudId from /_edge/tenant_info without auth', async () => {
    expect(await detectCloudId(SITE)).toBe(CLOUD_ID);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SITE}/_edge/tenant_info`);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('returns null when the response has no cloudId', async () => {
    fake.tenantInfo = 'missing';
    expect(await detectCloudId(SITE)).toBeNull();
  });

  it('returns null on an HTTP error', async () => {
    fake.tenantInfo = '404';
    expect(await detectCloudId(SITE)).toBeNull();
  });

  it('returns null instead of throwing on a network failure', async () => {
    fake.tenantInfo = 'network';
    expect(await detectCloudId(SITE)).toBeNull();
  });
});

// ─── getMyself ──────────────────────────────────────────────────────────────

describe('getMyself', () => {
  it('succeeds via the site URL with a classic token, using Basic auth', async () => {
    expect(await getMyself(siteApiBase(SITE), EMAIL, CLASSIC)).toEqual(ME);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(basic(CLASSIC));
  });

  it('succeeds via the scoped-token gateway with a scoped token', async () => {
    expect(await getMyself(gatewayApiBase(CLOUD_ID), EMAIL, SCOPED)).toEqual(ME);
  });

  it('throws a JiraError carrying the status and Jira message on rejection', async () => {
    await expect(getMyself(siteApiBase(SITE), EMAIL, SCOPED)).rejects.toEqual({
      status: 401,
      message: 'Client must be authenticated',
    });
  });

  it('defaults a hidden email address to empty', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { accountId: 'acc-2', displayName: 'Hidden' }));
    expect(await getMyself(siteApiBase(SITE), EMAIL, CLASSIC)).toEqual({
      accountId: 'acc-2',
      displayName: 'Hidden',
      emailAddress: '',
    });
  });
});

// ─── probeJiraToken ─────────────────────────────────────────────────────────

describe('probeJiraToken', () => {
  it('classifies a token the site URL accepts as classic', async () => {
    const r = await probeJiraToken(profile({ cloudId: CLOUD_ID }), CLASSIC);
    expect(r).toEqual({ ok: true, kind: 'classic', cloudId: CLOUD_ID, account: ME });
    expect(calledUrls().some((u) => u.startsWith(JIRA_GATEWAY))).toBe(false);
  });

  it('classifies a token only the gateway accepts as scoped', async () => {
    const r = await probeJiraToken(profile({ cloudId: CLOUD_ID }), SCOPED);
    expect(r).toEqual({ ok: true, kind: 'scoped', cloudId: CLOUD_ID, account: ME });
  });

  it('detects the cloudId when the profile has none, and returns it', async () => {
    const r = await probeJiraToken(profile(), SCOPED);
    expect(r).toMatchObject({ ok: true, kind: 'scoped', cloudId: CLOUD_ID });
    expect(calledUrls()[0]).toBe(`${SITE}/_edge/tenant_info`);
  });

  it('does not call tenant_info when the profile already has a cloudId', async () => {
    await probeJiraToken(profile({ cloudId: CLOUD_ID }), CLASSIC);
    expect(calledUrls()).not.toContain(`${SITE}/_edge/tenant_info`);
  });

  it('still classifies a classic token when cloudId detection fails', async () => {
    fake.tenantInfo = '404';
    const r = await probeJiraToken(profile(), CLASSIC);
    expect(r).toEqual({ ok: true, kind: 'classic', cloudId: '', account: ME });
  });

  it('reports cloudid-unavailable when the site rejects the token and no cloudId is known', async () => {
    fake.tenantInfo = 'missing';
    const r = await probeJiraToken(profile(), SCOPED);
    expect(r).toMatchObject({ ok: false, reason: 'cloudid-unavailable', cloudId: '', status: 401 });
  });

  it('reports unauthorized when both routes reject the token', async () => {
    const r = await probeJiraToken(profile({ cloudId: CLOUD_ID }), 'wrong-token');
    expect(r).toMatchObject({ ok: false, reason: 'unauthorized', cloudId: CLOUD_ID, status: 401 });
  });

  it('reports a site network failure as an error, without trying the gateway', async () => {
    fake.site = 'network';
    const r = await probeJiraToken(profile({ cloudId: CLOUD_ID }), SCOPED);
    expect(r).toMatchObject({ ok: false, reason: 'error', message: 'fetch failed' });
    expect(calledUrls().some((u) => u.startsWith(JIRA_GATEWAY))).toBe(false);
  });

  it('reports a site 5xx as an error with its status', async () => {
    fake.site = '500';
    const r = await probeJiraToken(profile({ cloudId: CLOUD_ID }), CLASSIC);
    expect(r).toMatchObject({ ok: false, reason: 'error', status: 500, message: 'Internal error' });
  });

  it('reports a gateway 5xx as an error, not as unauthorized', async () => {
    fake.gateway = '500';
    const r = await probeJiraToken(profile({ cloudId: CLOUD_ID }), SCOPED);
    expect(r).toMatchObject({ ok: false, reason: 'error', status: 500, message: 'Gateway error' });
  });

  it('never throws', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('boom')));
    await expect(probeJiraToken(profile(), CLASSIC)).resolves.toMatchObject({ ok: false, reason: 'error' });
  });
});

// ─── searchJql / searchMyOpenIssues (VERM-21) ───────────────────────────────

function searchIssue(n: number) {
  return { id: String(n), key: `DEMO-${n}`, fields: { summary: `Issue ${n}` } };
}

function searchBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter((c) => (c[0] as string).endsWith('/rest/api/3/search/jql'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>);
}

describe('searchJql', () => {
  it('POSTs the JQL, fields and page size, with Basic auth', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { issues: [searchIssue(1)], isLast: true }));
    await searchJql(SITE, EMAIL, CLASSIC, 'project = DEMO', ['summary']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SITE}/rest/api/3/search/jql`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(basic(CLASSIC));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(searchBodies()[0]).toEqual({ jql: 'project = DEMO', fields: ['summary'], maxResults: SEARCH_PAGE_SIZE });
  });

  it('follows nextPageToken until isLast, in order', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { issues: [searchIssue(1), searchIssue(2)], nextPageToken: 'p2', isLast: false }))
      .mockResolvedValueOnce(res(200, { issues: [searchIssue(3)], nextPageToken: 'p3', isLast: false }))
      .mockResolvedValueOnce(res(200, { issues: [searchIssue(4)], isLast: true }));
    const issues = await searchJql(SITE, EMAIL, CLASSIC, 'x', ['summary']);
    expect(issues.map((i) => i.key)).toEqual(['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4']);
    const bodies = searchBodies();
    expect(bodies.map((b) => b.nextPageToken)).toEqual([undefined, 'p2', 'p3']);
  });

  it('stops when a page has no nextPageToken even if isLast is missing', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { issues: [searchIssue(1)] }));
    const issues = await searchJql(SITE, EMAIL, CLASSIC, 'x', ['summary']);
    expect(issues).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after maxPages even if Jira keeps returning tokens', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(res(200, { issues: [searchIssue(1)], nextPageToken: 'again', isLast: false })),
    );
    const issues = await searchJql(SITE, EMAIL, CLASSIC, 'x', ['summary'], 3);
    expect(issues).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats a page with no issues array as empty', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { isLast: true }));
    expect(await searchJql(SITE, EMAIL, CLASSIC, 'x', ['summary'])).toEqual([]);
  });

  it('throws a JiraError on a rejected search', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { errorMessages: ["The value 'NOPE' does not exist for the field 'project'."] }));
    await expect(searchJql(SITE, EMAIL, CLASSIC, 'project = NOPE', ['summary'])).rejects.toEqual({
      status: 400,
      message: "The value 'NOPE' does not exist for the field 'project'.",
    });
  });
});

describe('searchMyOpenIssues', () => {
  function withSearch(base: string) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === `${base}/rest/api/3/search/jql`
        ? Promise.resolve(res(200, { issues: [searchIssue(9)], isLast: true }))
        : fakeJira(url, init),
    );
  }

  it('searches through the site URL for a classic token, with the my-open-issues JQL', async () => {
    withSearch(SITE);
    const issues = await searchMyOpenIssues(profile({ cloudId: CLOUD_ID }), CLASSIC);
    expect(issues.map((i) => i.key)).toEqual(['DEMO-9']);
    expect(searchBodies()[0]).toMatchObject({ jql: MY_OPEN_ISSUES_JQL, fields: ['summary', 'status', 'priority', 'updated'] });
  });

  it('searches through the gateway for a scoped token', async () => {
    const gateway = `${JIRA_GATEWAY}/ex/jira/${CLOUD_ID}`;
    withSearch(gateway);
    const issues = await searchMyOpenIssues(profile({ cloudId: CLOUD_ID }), SCOPED);
    expect(issues.map((i) => i.key)).toEqual(['DEMO-9']);
    expect(calledUrls()).toContain(`${gateway}/rest/api/3/search/jql`);
  });

  it('throws the probe explanation when the token is rejected', async () => {
    await expect(searchMyOpenIssues(profile({ cloudId: CLOUD_ID }), 'wrong-token')).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('rejected the token'),
    });
  });
});
