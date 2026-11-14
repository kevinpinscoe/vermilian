// Jira Cloud HTTP layer (main process): Basic auth, error decoding, and 429
// backoff (VERM-28, proposal §B9).
//
// Rate limiting: Jira answers 429 with a Retry-After header (seconds, or an
// HTTP date). A retryable request waits that long plus a little jitter; with
// no usable header it backs off exponentially with jitter. It gives up — and
// throws the 429 — after MAX_RETRIES retries, or at once when the server asks
// for a wait longer than MAX_RETRY_AFTER_MS, so a long throttle never hangs
// the app.
//
// Only idempotent requests are retried: every GET, and a POST only when the
// caller marks it idempotent (search/jql is a read sent as POST). Any other
// POST is never retried, because a 429 does not prove the write was not
// applied.

export interface JiraError {
  status?: number;
  message: string;
}

export const MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;
export const MAX_RETRY_AFTER_MS = 60_000;
// Spread out clients that were all told the same Retry-After.
export const RETRY_AFTER_JITTER_MS = 500;

export interface JiraRequestOptions {
  /** A POST body; its presence makes the request a POST. */
  body?: unknown;
  /** Mark a POST safe to repeat (a read sent as POST). GETs always are. */
  idempotent?: boolean;
}

function basicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}`;
}

export async function toJiraError(res: Response): Promise<JiraError> {
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    // Jira REST errors: { errorMessages: [...], errors: {...} }; the gateway
    // and _edge endpoints use { message } instead.
    const body = (await res.json()) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
      message?: string;
    };
    const candidate =
      body.errorMessages?.[0] || Object.values(body.errors ?? {})[0] || body.message;
    if (candidate) message = candidate;
  } catch {
    // non-JSON error body; keep statusText
  }
  return { status: res.status, message };
}

/**
 * Retry-After as milliseconds: delta-seconds or an HTTP date. Null when the
 * header is absent or unparseable. A date in the past is 0.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (value == null) return null;
  const v = value.trim();
  if (v === '') return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  // An HTTP date names a weekday and month; without letters, Date.parse would
  // accept things like "-3" as a year.
  if (!/[A-Za-z]/.test(v)) return null;
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/** Exponential backoff with ±30% jitter, capped at MAX_BACKOFF_MS. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(base * (0.7 + 0.6 * random()));
}

function headerOf(res: Response, name: string): string | null {
  // Test doubles may omit headers; a real Response always has them.
  return typeof res.headers?.get === 'function' ? res.headers.get(name) : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One Jira REST call. Throws JiraError on a non-2xx answer. */
export async function jiraRequest<T>(
  base: string,
  email: string,
  token: string,
  path: string,
  options: JiraRequestOptions = {},
): Promise<T> {
  const isPost = options.body !== undefined;
  const retryable = !isPost || options.idempotent === true;
  const init: RequestInit = {
    method: isPost ? 'POST' : 'GET',
    headers: {
      Authorization: basicAuth(email, token),
      Accept: 'application/json',
      ...(isPost ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(isPost ? { body: JSON.stringify(options.body) } : {}),
  };

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}${path}`, init);
    if (res.ok) return (await res.json()) as T;

    if (res.status === 429 && retryable && attempt < MAX_RETRIES) {
      const retryAfter = parseRetryAfter(headerOf(res, 'Retry-After'));
      if (retryAfter === null || retryAfter <= MAX_RETRY_AFTER_MS) {
        const wait =
          retryAfter === null
            ? backoffMs(attempt)
            : retryAfter + Math.round(Math.random() * RETRY_AFTER_JITTER_MS);
        await sleep(wait);
        continue;
      }
    }
    throw await toJiraError(res);
  }
}
