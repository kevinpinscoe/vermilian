/**
 * Two independent YouTrack clients.
 *
 * - The **verifier** prepares fixtures and checks server state. It never runs
 *   inside the application and never sees a raw token: requests go through
 *   `parzival exec … -- curl -K "$YOUTRACK_CURL_CONFIG"`, so the credential
 *   stays inside parzival's rendered curl config.
 * - The **app identity** client uses the same token command the application
 *   under test is given. The preflight uses it only to prove *who* the app
 *   will act as and *what it can see* — before anything is mutated.
 *
 * Neither client logs request headers. Every error message passes through
 * `redact()` before it can reach a report.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import type { LiveSettings } from './settings';

/** A failure of the harness itself (setup, network, permissions), as opposed to an application defect. */
export class HarnessError extends Error {
  constructor(message: string) {
    super(`[harness] ${redact(message)}`);
    this.name = 'HarnessError';
  }
}

export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/perm[-:][A-Za-z0-9._=:-]+/g, '[REDACTED]')
    .replace(/(token|password|secret)(["'\s:=]+)[^\s"',}]+/gi, '$1$2[REDACTED]');
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export interface Client {
  label: string;
  request<T = unknown>(method: string, apiPath: string, body?: unknown): Promise<ApiResponse<T>>;
}

function run(cmd: string, args: string[], input: string | null, timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new HarnessError(`${cmd} timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new HarnessError(`${cmd}: ${e.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    child.stdin.end(input ?? '');
  });
}

const STATUS_MARK = '\n__VLH_HTTP_STATUS__';

function parseBody(raw: string): unknown {
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export function verifierClient(s: LiveSettings): Client {
  // $1 method, $2 URL, $3 "1" when a body is piped on stdin.
  const script =
    'if [ "$3" = 1 ]; then set -- "$1" "$2" --data-binary @-; else set -- "$1" "$2"; fi; ' +
    'm="$1"; u="$2"; shift 2; ' +
    `exec curl -sS -K "$YOUTRACK_CURL_CONFIG" -X "$m" -H 'Accept: application/json' -H 'Content-Type: application/json' "$@" -w '${STATUS_MARK}%{http_code}' "$u"`;
  return {
    label: `verifier (parzival ${s.verifierProfile})`,
    async request<T>(method: string, apiPath: string, body?: unknown) {
      const url = `${s.verifierUrl}${apiPath}`;
      const hasBody = body !== undefined;
      const res = await run(
        'parzival',
        ['exec', '--as', s.verifierAs, s.verifierProfile, '--', 'sh', '-c', script, 'sh', method, url, hasBody ? '1' : '0'],
        hasBody ? JSON.stringify(body) : null,
      );
      const at = res.stdout.lastIndexOf(STATUS_MARK);
      if (res.code !== 0 || at < 0) {
        throw new HarnessError(`verifier ${method} ${apiPath} failed (exit ${res.code}): ${res.stderr.slice(0, 400)}`);
      }
      const status = Number(res.stdout.slice(at + STATUS_MARK.length).trim());
      return { status, body: parseBody(res.stdout.slice(0, at)) as T };
    },
  };
}

export function appIdentityClient(s: LiveSettings): Client {
  let token: string | null = null;
  async function getToken(): Promise<string> {
    if (token) return token;
    if (s.appTokenFile) {
      let value: string;
      try { value = fs.readFileSync(s.appTokenFile, 'utf-8').trim(); } catch (e) {
        throw new HarnessError(`the application token file is not readable: ${(e as Error).message}`);
      }
      if (!value) throw new HarnessError('the application token file is empty');
      token = value;
      return token;
    }
    const res = await run('sh', ['-c', s.appTokenCommand], null);
    const value = res.stdout.trim();
    if (res.code !== 0 || !value) {
      throw new HarnessError(`the application token command exited ${res.code} with ${value ? 'output' : 'no output'}: ${res.stderr.slice(0, 300)}`);
    }
    token = value;
    return token;
  }
  return {
    label: 'application identity',
    async request<T>(method: string, apiPath: string, body?: unknown) {
      const t = await getToken();
      let res: Response;
      try {
        res = await fetch(`${s.appUrl}${apiPath}`, {
          method,
          headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        throw new HarnessError(`application identity ${method} ${apiPath}: ${(e as Error).message}`);
      }
      return { status: res.status, body: parseBody(await res.text()) as T };
    },
  };
}

/** Throws a HarnessError unless the response is 2xx. */
export async function ok<T>(client: Client, method: string, apiPath: string, body?: unknown): Promise<T> {
  const res = await client.request<T>(method, apiPath, body);
  if (res.status < 200 || res.status >= 300) {
    throw new HarnessError(`${client.label} ${method} ${apiPath} returned HTTP ${res.status}: ${redact(JSON.stringify(res.body)).slice(0, 300)}`);
  }
  return res.body;
}
