import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  backoffMs,
  jiraRequest,
  parseRetryAfter,
} from './jiraHttp';

// Fictional values only (ADR-0011 §10).
const BASE = 'https://example.atlassian.net';
const EMAIL = 'user@example.com';
const TOKEN = 'fictional-token';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// A 429 as Jira Cloud sends it (rate-limiting docs): Retry-After in seconds.
function tooMany(retryAfter?: string): Response {
  return json(429, { errorMessages: ['Rate limit exceeded.'] }, retryAfter === undefined ? {} : { 'Retry-After': retryAfter });
}

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfter('7', now)).toBe(7_000);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
  });

  it('reads an HTTP date, and a past date as zero', () => {
    expect(parseRetryAfter('Sat, 14 Nov 2026 12:00:05 GMT', now)).toBe(5_000);
    expect(parseRetryAfter('Sat, 14 Nov 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('is null when absent or unparseable', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('-3', now)).toBeNull();
  });
});

describe('backoffMs', () => {
  it('doubles per attempt with ±30% jitter', () => {
    expect(backoffMs(0, () => 0)).toBe(Math.round(BASE_BACKOFF_MS * 0.7));
    expect(backoffMs(0, () => 1)).toBe(Math.round(BASE_BACKOFF_MS * 1.3));
    expect(backoffMs(2, () => 0.5)).toBe(BASE_BACKOFF_MS * 4);
  });

  it('is capped', () => {
    expect(backoffMs(20, () => 0.5)).toBe(MAX_BACKOFF_MS);
  });
});

describe('jiraRequest', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // no jitter on Retry-After
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends Basic auth and returns the JSON body', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(jiraRequest(BASE, EMAIL, TOKEN, '/rest/api/3/myself')).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/rest/api/3/myself`);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`,
    );
  });

  it('honours Retry-After on a 429 before retrying a GET', async () => {
    fetchMock.mockResolvedValueOnce(tooMany('3')).mockResolvedValueOnce(json(200, { ok: 1 }));
    const p = jiraRequest(BASE, EMAIL, TOKEN, '/rest/api/3/project/search');

    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still waiting out Retry-After
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially when a 429 has no Retry-After', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // backoff = exact base
    fetchMock
      .mockResolvedValueOnce(tooMany())
      .mockResolvedValueOnce(tooMany())
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    const p = jiraRequest(BASE, EMAIL, TOKEN, '/rest/api/3/issue/DEMO-1');

    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 2);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it(`gives up after ${MAX_RETRIES} retries and throws the 429`, async () => {
    fetchMock.mockImplementation(async () => tooMany('1'));
    const p = jiraRequest(BASE, EMAIL, TOKEN, '/rest/api/3/myself');
    const settled = expect(p).rejects.toEqual({ status: 429, message: 'Rate limit exceeded.' });
    await vi.advanceTimersByTimeAsync(1_000 * (MAX_RETRIES + 1));
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('does not wait out a Retry-After longer than the cap', async () => {
    fetchMock.mockResolvedValueOnce(tooMany(String(MAX_RETRY_AFTER_MS / 1000 + 1)));
    await expect(jiraRequest(BASE, EMAIL, TOKEN, '/rest/api/3/myself')).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a non-idempotent POST', async () => {
    fetchMock.mockResolvedValueOnce(tooMany('1')).mockResolvedValueOnce(json(201, { id: '1' }));
    await expect(
      jiraRequest(BASE, EMAIL, TOKEN, '/rest/api/3/issue/DEMO-1/comment', { body: { body: 'x' } }),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('retries a POST marked idempotent (a read sent as POST)', async () => {
    fetchMock.mockResolvedValueOnce(tooMany('1')).mockResolvedValueOnce(json(200, { issues: [] }));
    const p = jiraRequest(BASE, EMAIL, TOKEN, '/rest/api/3/search/jql', { body: { jql: 'x' }, idempotent: true });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(p).resolves.toEqual({ issues: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { errorMessages: ['Internal error'] }));
    await expect(jiraRequest(BASE, EMAIL, TOKEN, '/rest/api/3/myself')).rejects.toEqual({
      status: 500,
      message: 'Internal error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
