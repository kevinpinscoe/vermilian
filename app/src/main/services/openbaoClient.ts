// OpenBao HTTP client for the credential backend (VERM-64). Main process only:
// tokens and secret values stay here and in the resolver.
//
// Each scope logs in for itself and keeps its token in memory only, so nothing
// a scope holds can be used for another. Failures are reported as a reason
// code, never with a response body, which could echo a secret.

import {
  checkOpenBaoConnection,
  isOpenBaoField,
  isOpenBaoPath,
  type OpenBaoAuthConfig,
  type OpenBaoBinding,
  type OpenBaoConnection,
  type OpenBaoFailureReason,
  type OpenBaoResult,
  type OpenBaoTestResult,
  describeOpenBaoTest,
} from '../../shared/openbao';
import { checkCredentialValue } from '../../shared/credentialRefs';
import type { CredentialRef } from '../../shared/workspaceSchema';

const REQUEST_TIMEOUT_MS = 10_000;
// A token method's value has no known lifetime here, so its command is re-run
// after this long rather than trusting it indefinitely.
const TOKEN_METHOD_CACHE_MS = 5 * 60_000;
const CONNECTION_PROBE = 'vermilian-connection-test';

export interface OpenBaoClientDeps {
  fetch: typeof fetch;
  readAuthSecret(auth: OpenBaoAuthConfig): Promise<string | null>;
  now?: () => number;
}

export interface OpenBaoStoreOptions {
  /** Replace a different existing value. Migration leaves this off. */
  overwrite: boolean;
}

export interface OpenBaoClient {
  readField(scopeId: string, conn: OpenBaoConnection, binding: OpenBaoBinding): Promise<OpenBaoResult<string>>;
  /** Writes, reads back and compares. Other fields in the secret are preserved. */
  storeVerified(
    scopeId: string,
    conn: OpenBaoConnection,
    binding: OpenBaoBinding,
    value: string,
    options: OpenBaoStoreOptions,
  ): Promise<OpenBaoResult<'written' | 'unchanged'>>;
  /** Removes one field; a secret left with no fields is soft-deleted (recoverable). */
  deleteField(scopeId: string, conn: OpenBaoConnection, binding: OpenBaoBinding): Promise<OpenBaoResult<null>>;
  test(
    scopeId: string,
    conn: OpenBaoConnection,
    bindings: Array<{ credentialRef: CredentialRef; binding: OpenBaoBinding }>,
  ): Promise<OpenBaoTestResult>;
  /** Discards the scope's in-memory token. */
  forget(scopeId: string): void;
}

interface CachedToken {
  fingerprint: string;
  token: string;
  expiresAt: number;
}

interface KvSecret {
  data: Record<string, unknown>;
  /** Current version for check-and-set; 0 when the secret has never existed. */
  version: number;
}

type Reply = { status: number; body: unknown };

function dataPath(conn: OpenBaoConnection, binding: OpenBaoBinding): string {
  return `${conn.kvMount}/data/${conn.pathPrefix}/${binding.path}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function createOpenBaoClient(deps: OpenBaoClientDeps): OpenBaoClient {
  const now = deps.now ?? Date.now;
  const tokens = new Map<string, CachedToken>();

  async function request(
    conn: OpenBaoConnection,
    method: string,
    apiPath: string,
    token: string | null,
    payload?: unknown,
  ): Promise<OpenBaoResult<Reply>> {
    const headers: Record<string, string> = { 'X-Vault-Request': 'true' };
    if (token) headers['X-Vault-Token'] = token;
    if (conn.namespace) headers['X-Vault-Namespace'] = conn.namespace;
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await deps.fetch(`${conn.url}/v1/${apiPath}`, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        // A redirect would carry the token to another address.
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    let body: unknown;
    try {
      const raw = await res.text();
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return { ok: true, value: { status: res.status, body } };
  }

  async function login(scopeId: string, conn: OpenBaoConnection): Promise<OpenBaoResult<string>> {
    const secret = (await deps.readAuthSecret(conn.auth))?.trim() ?? '';
    if (checkCredentialValue(secret) !== 'ok') return { ok: false, reason: 'auth-source-failed' };
    const fingerprint = JSON.stringify([conn.url, conn.namespace, conn.auth]);
    if (conn.auth.method === 'token') {
      tokens.set(scopeId, { fingerprint, token: secret, expiresAt: now() + TOKEN_METHOD_CACHE_MS });
      return { ok: true, value: secret };
    }
    const r = await request(conn, 'POST', `auth/${conn.auth.approleMount}/login`, null, {
      role_id: conn.auth.roleId,
      secret_id: secret,
    });
    if (!r.ok) return r;
    if (r.value.status === 503) return { ok: false, reason: 'sealed' };
    if (r.value.status !== 200) return { ok: false, reason: 'auth-rejected' };
    const auth = isRecord(r.value.body) ? r.value.body.auth : null;
    const token = isRecord(auth) ? auth.client_token : null;
    if (typeof token !== 'string' || !token) return { ok: false, reason: 'invalid-response' };
    const lease = isRecord(auth) && typeof auth.lease_duration === 'number' ? auth.lease_duration : 0;
    tokens.set(scopeId, { fingerprint, token, expiresAt: now() + lease * 800 });
    return { ok: true, value: token };
  }

  function cachedToken(scopeId: string, conn: OpenBaoConnection): string | null {
    const c = tokens.get(scopeId);
    const fingerprint = JSON.stringify([conn.url, conn.namespace, conn.auth]);
    return c && c.fingerprint === fingerprint && c.expiresAt > now() ? c.token : null;
  }

  // Runs a call with the scope's token. A 403 on a remembered token logs in
  // once more, which recovers an expired or revoked token; a 403 on a fresh one
  // is told apart by asking OpenBao whether the token itself is still valid.
  async function authed(
    scopeId: string,
    conn: OpenBaoConnection,
    call: (token: string) => Promise<OpenBaoResult<Reply>>,
  ): Promise<OpenBaoResult<Reply>> {
    const checked = checkOpenBaoConnection(conn);
    if (!checked.ok) return { ok: false, reason: 'incomplete' };
    let token = cachedToken(scopeId, conn);
    const remembered = token !== null;
    if (token === null) {
      const l = await login(scopeId, conn);
      if (!l.ok) return l;
      token = l.value;
    }
    let r = await call(token);
    if (r.ok && r.value.status === 403 && remembered) {
      tokens.delete(scopeId);
      const l = await login(scopeId, conn);
      if (!l.ok) return l;
      token = l.value;
      r = await call(token);
    }
    if (!r.ok) return r;
    if (r.value.status === 503) return { ok: false, reason: 'sealed' };
    if (r.value.status === 403) {
      const self = await request(conn, 'GET', 'auth/token/lookup-self', token);
      if (!self.ok) return self;
      if (self.value.status !== 200) tokens.delete(scopeId);
      return { ok: false, reason: self.value.status === 200 ? 'forbidden' : 'auth-rejected' };
    }
    return r;
  }

  async function readSecret(
    scopeId: string,
    conn: OpenBaoConnection,
    binding: OpenBaoBinding,
  ): Promise<OpenBaoResult<KvSecret>> {
    if (!isOpenBaoPath(binding.path) || !isOpenBaoField(binding.field)) return { ok: false, reason: 'incomplete' };
    const r = await authed(scopeId, conn, (t) => request(conn, 'GET', dataPath(conn, binding), t));
    if (!r.ok) return r;
    const outer = isRecord(r.value.body) ? r.value.body.data : null;
    const metadata = isRecord(outer) ? outer.metadata : null;
    const version = isRecord(metadata) && typeof metadata.version === 'number' ? metadata.version : 0;
    // A deleted version answers 404 but still reports the version check-and-set needs.
    if (r.value.status === 404) return { ok: true, value: { data: {}, version } };
    if (r.value.status !== 200 || !isRecord(outer)) return { ok: false, reason: 'invalid-response' };
    return { ok: true, value: { data: isRecord(outer.data) ? outer.data : {}, version } };
  }

  async function writeSecret(
    scopeId: string,
    conn: OpenBaoConnection,
    binding: OpenBaoBinding,
    data: Record<string, unknown>,
    version: number,
  ): Promise<OpenBaoResult<null>> {
    const r = await authed(scopeId, conn, (t) =>
      request(conn, 'POST', dataPath(conn, binding), t, { options: { cas: version }, data }),
    );
    if (!r.ok) return r;
    if (r.value.status === 200 || r.value.status === 204) return { ok: true, value: null };
    return { ok: false, reason: r.value.status === 400 ? 'conflict' : 'invalid-response' };
  }

  async function readField(
    scopeId: string,
    conn: OpenBaoConnection,
    binding: OpenBaoBinding,
  ): Promise<OpenBaoResult<string>> {
    const r = await readSecret(scopeId, conn, binding);
    if (!r.ok) return r;
    const v = r.value.data[binding.field];
    return typeof v === 'string' && v ? { ok: true, value: v } : { ok: false, reason: 'not-found' };
  }

  return {
    readField,

    async storeVerified(scopeId, conn, binding, value, options) {
      const current = await readSecret(scopeId, conn, binding);
      if (!current.ok) return current;
      const existing = current.value.data[binding.field];
      if (existing === value) return { ok: true, value: 'unchanged' };
      if (existing !== undefined && !options.overwrite) return { ok: false, reason: 'conflict' };
      const written = await writeSecret(
        scopeId,
        conn,
        binding,
        { ...current.value.data, [binding.field]: value },
        current.value.version,
      );
      if (!written.ok) return written;
      const back = await readField(scopeId, conn, binding);
      if (!back.ok) return back;
      return back.value === value ? { ok: true, value: 'written' } : { ok: false, reason: 'conflict' };
    },

    async deleteField(scopeId, conn, binding) {
      const current = await readSecret(scopeId, conn, binding);
      if (!current.ok) return current;
      if (!(binding.field in current.value.data)) return { ok: false, reason: 'not-found' };
      const { [binding.field]: _removed, ...rest } = current.value.data;
      void _removed;
      if (Object.keys(rest).length > 0) return writeSecret(scopeId, conn, binding, rest, current.value.version);
      const r = await authed(scopeId, conn, (t) => request(conn, 'DELETE', dataPath(conn, binding), t));
      if (!r.ok) return r;
      return r.value.status === 204 || r.value.status === 200
        ? { ok: true, value: null }
        : { ok: false, reason: 'invalid-response' };
    },

    async test(scopeId, conn, bindings) {
      const finish = (status: OpenBaoFailureReason | 'connected', references: OpenBaoTestResult['references'] = []) => ({
        status,
        message: describeOpenBaoTest(status),
        references,
      });
      const checked = checkOpenBaoConnection(conn);
      if (!checked.ok) return finish('incomplete');
      const health = await request(conn, 'GET', 'sys/health?standbyok=true&perfstandbyok=true', null);
      if (!health.ok) return finish(health.reason);
      if (health.value.status === 503 || health.value.status === 501) return finish('sealed');

      // Always a fresh login, so the test proves the configured secret works now.
      tokens.delete(scopeId);
      const l = await login(scopeId, conn);
      if (!l.ok) return finish(l.reason);
      const self = await request(conn, 'GET', 'auth/token/lookup-self', l.value);
      if (!self.ok) return finish(self.reason);
      if (self.value.status !== 200) return finish('auth-rejected');

      const probe = `${conn.kvMount}/data/${conn.pathPrefix}/${CONNECTION_PROBE}`;
      const paths = bindings.length > 0 ? bindings.map((b) => dataPath(conn, b.binding)) : [probe];
      const caps = await request(conn, 'POST', 'sys/capabilities-self', l.value, { paths });
      if (!caps.ok) return finish(caps.reason);
      if (caps.value.status !== 200 || !isRecord(caps.value.body)) return finish('forbidden');
      const body = caps.value.body;
      const allowed = paths.every((p) => {
        const list = body[p];
        if (!Array.isArray(list)) return false;
        return list.includes('root') || (list.includes('read') && (list.includes('create') || list.includes('update')));
      });
      if (!allowed) return finish('forbidden');

      const references: OpenBaoTestResult['references'] = [];
      for (const { credentialRef, binding } of bindings) {
        const r = await readField(scopeId, conn, binding);
        references.push({ credentialRef, status: r.ok ? 'ok' : r.reason });
      }
      const failed = references.find((r) => r.status !== 'ok');
      return finish(failed && failed.status !== 'ok' ? failed.status : 'connected', references);
    },

    forget(scopeId) {
      tokens.delete(scopeId);
    },
  };
}
