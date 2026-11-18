import { describe, it, expect, beforeEach } from 'vitest';
import { createOpenBaoClient, type OpenBaoClient } from './openbaoClient';
import { DEFAULT_OPENBAO_CONNECTION, type OpenBaoBinding, type OpenBaoConnection } from '../../shared/openbao';

// Fictional values only. An in-memory stand-in for the parts of the OpenBao API
// the client uses, so failure paths can be forced precisely.
const SECRET_ID = 'fake-secret-id-111';
const STORED = 'fake-stored-value-222';

interface Version { data: Record<string, unknown>; deleted: boolean }

class FakeBao {
  kv = new Map<string, Version[]>();
  validTokens = new Set<string>();
  logins = 0;
  sealed = false;
  down = false;
  denyPaths = new Set<string>();
  requests: Array<{ url: string; headers: Record<string, string>; redirect?: string }> = [];

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    this.requests.push({ url: url.href, headers, redirect: init?.redirect });
    if (this.down) throw new Error('connect ECONNREFUSED');
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (this.sealed) return reply(503, { errors: ['sealed'] });
    const path = url.pathname.replace(/^\/v1\//, '');
    const method = init?.method ?? 'GET';
    const payload = init?.body ? JSON.parse(String(init.body)) : {};

    if (path === 'sys/health') return reply(200, {});
    if (path === 'auth/approle/login') {
      if (payload.secret_id !== SECRET_ID) return reply(400, { errors: ['invalid role or secret ID'] });
      this.logins += 1;
      const token = `fake-token-${this.logins}`;
      this.validTokens.add(token);
      return reply(200, { auth: { client_token: token, lease_duration: 3600 } });
    }
    if (!this.validTokens.has(headers['X-Vault-Token'])) return reply(403, { errors: ['permission denied'] });
    if (path === 'auth/token/lookup-self') return reply(200, { data: {} });
    if (path === 'sys/capabilities-self') {
      const out: Record<string, string[]> = {};
      for (const p of payload.paths as string[]) out[p] = this.denyPaths.has(p) ? ['deny'] : ['read', 'create', 'update'];
      return reply(200, out);
    }
    if (this.denyPaths.has(path)) return reply(403, { errors: ['permission denied'] });

    const versions = this.kv.get(path) ?? [];
    const version = versions.length;
    const latest = versions[version - 1];
    if (method === 'GET') {
      if (!latest || latest.deleted) return reply(404, { data: { data: null, metadata: { version } } });
      return reply(200, { data: { data: latest.data, metadata: { version } } });
    }
    if (method === 'POST') {
      if (payload.options.cas !== version) return reply(400, { errors: ['check-and-set mismatch'] });
      this.kv.set(path, [...versions, { data: payload.data, deleted: false }]);
      return reply(200, { data: { version: version + 1 } });
    }
    if (method === 'DELETE' && latest) latest.deleted = true;
    return reply(204);
  }) as typeof fetch;
}

const CONN: OpenBaoConnection = {
  ...DEFAULT_OPENBAO_CONNECTION,
  url: 'https://bao.example.test',
  auth: { ...DEFAULT_OPENBAO_CONNECTION.auth, roleId: 'role-a', secretFile: '/fake/secret-id' },
};
const BINDING: OpenBaoBinding = { path: 'jira-1', field: 'token' };
const KV_PATH = 'secret/data/vermilian/jira-1';

let bao: FakeBao;
let secretSource: string | null;
let client: OpenBaoClient;

beforeEach(() => {
  bao = new FakeBao();
  secretSource = SECRET_ID;
  client = createOpenBaoClient({ fetch: bao.fetch, readAuthSecret: async () => secretSource });
});

describe('reading and writing', () => {
  it('stores a value, verifies it and reads it back', async () => {
    expect(await client.storeVerified('ws-a', CONN, BINDING, STORED, { overwrite: false })).toEqual({ ok: true, value: 'written' });
    expect(await client.readField('ws-a', CONN, BINDING)).toEqual({ ok: true, value: STORED });
  });

  it('keeps the other fields of a shared secret', async () => {
    bao.kv.set(KV_PATH, [{ data: { other: 'keep-me' }, deleted: false }]);
    await client.storeVerified('ws-a', CONN, BINDING, STORED, { overwrite: false });
    expect(bao.kv.get(KV_PATH)?.at(-1)?.data).toEqual({ other: 'keep-me', token: STORED });
  });

  it('accepts a retry that finds the same value, without writing again', async () => {
    await client.storeVerified('ws-a', CONN, BINDING, STORED, { overwrite: false });
    expect(await client.storeVerified('ws-a', CONN, BINDING, STORED, { overwrite: false })).toEqual({ ok: true, value: 'unchanged' });
    expect(bao.kv.get(KV_PATH)).toHaveLength(1);
  });

  it('refuses to replace a different value unless told to', async () => {
    bao.kv.set(KV_PATH, [{ data: { token: 'someone-elses' }, deleted: false }]);
    expect(await client.storeVerified('ws-a', CONN, BINDING, STORED, { overwrite: false })).toEqual({ ok: false, reason: 'conflict' });
    expect(bao.kv.get(KV_PATH)?.at(-1)?.data).toEqual({ token: 'someone-elses' });
    expect((await client.storeVerified('ws-a', CONN, BINDING, STORED, { overwrite: true })).ok).toBe(true);
  });

  it('removes only the named field while others remain', async () => {
    bao.kv.set(KV_PATH, [{ data: { token: STORED, other: 'keep-me' }, deleted: false }]);
    expect((await client.deleteField('ws-a', CONN, BINDING)).ok).toBe(true);
    expect(bao.kv.get(KV_PATH)?.at(-1)).toEqual({ data: { other: 'keep-me' }, deleted: false });
  });

  it('soft-deletes a secret left with no fields, and can write it again', async () => {
    bao.kv.set(KV_PATH, [{ data: { token: STORED }, deleted: false }]);
    expect((await client.deleteField('ws-a', CONN, BINDING)).ok).toBe(true);
    expect(await client.readField('ws-a', CONN, BINDING)).toEqual({ ok: false, reason: 'not-found' });
    expect((await client.storeVerified('ws-a', CONN, BINDING, STORED, { overwrite: false })).ok).toBe(true);
  });
});

describe('failures are reported, never hidden', () => {
  it.each([
    ['unreachable', () => { bao.down = true; }],
    ['sealed', () => { bao.sealed = true; }],
    ['auth-source-failed', () => { secretSource = null; }],
    ['auth-rejected', () => { secretSource = 'wrong-secret-id'; }],
    ['forbidden', () => { bao.denyPaths.add(KV_PATH); }],
  ])('%s', async (reason, arrange) => {
    arrange();
    expect(await client.readField('ws-a', CONN, BINDING)).toEqual({ ok: false, reason });
  });

  it('reports a missing secret', async () => {
    expect(await client.readField('ws-a', CONN, BINDING)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses an incomplete connection without contacting the server', async () => {
    const r = await client.readField('ws-a', { ...CONN, url: 'http://bao.example.test' }, BINDING);
    expect(r).toEqual({ ok: false, reason: 'incomplete' });
    expect(bao.requests).toHaveLength(0);
  });

  it('refuses a binding that would escape the configured path', async () => {
    const r = await client.readField('ws-a', CONN, { path: '../../sys/seal', field: 'token' });
    expect(r).toEqual({ ok: false, reason: 'incomplete' });
    expect(bao.requests).toHaveLength(0);
  });

  it('logs in again when a remembered token has been revoked', async () => {
    bao.kv.set(KV_PATH, [{ data: { token: STORED }, deleted: false }]);
    await client.readField('ws-a', CONN, BINDING);
    bao.validTokens.clear();
    expect(await client.readField('ws-a', CONN, BINDING)).toEqual({ ok: true, value: STORED });
    expect(bao.logins).toBe(2);
  });

  it('reports rejection when a revoked login cannot be renewed', async () => {
    await client.readField('ws-a', CONN, BINDING);
    bao.validTokens.clear();
    secretSource = 'revoked-secret-id';
    expect(await client.readField('ws-a', CONN, BINDING)).toEqual({ ok: false, reason: 'auth-rejected' });
  });
});

describe('isolation and transport', () => {
  it('never shares a login between scopes, even with identical settings', async () => {
    await client.readField('ws-a', CONN, BINDING);
    await client.readField('ws-b', CONN, BINDING);
    expect(bao.logins).toBe(2);
    const used = bao.requests.filter((r) => r.url.includes('/secret/data/')).map((r) => r.headers['X-Vault-Token']);
    expect(new Set(used).size).toBe(2);
  });

  it('refuses redirects, which would carry the token elsewhere', async () => {
    await client.readField('ws-a', CONN, BINDING);
    expect(bao.requests.every((r) => r.redirect === 'error')).toBe(true);
  });
});

describe('test connection', () => {
  it('reports connected, with each reference', async () => {
    bao.kv.set(KV_PATH, [{ data: { token: STORED }, deleted: false }]);
    const r = await client.test('ws-a', CONN, [{ credentialRef: 'jira-1', binding: BINDING }]);
    expect(r.status).toBe('connected');
    expect(r.references).toEqual([{ credentialRef: 'jira-1', status: 'ok' }]);
    expect(JSON.stringify(r)).not.toContain(STORED);
  });

  it.each([
    ['unreachable', () => { bao.down = true; }],
    ['sealed', () => { bao.sealed = true; }],
    ['auth-rejected', () => { secretSource = 'wrong-secret-id'; }],
    ['forbidden', () => { bao.denyPaths.add(KV_PATH); }],
  ])('reports %s', async (status, arrange) => {
    arrange();
    expect((await client.test('ws-a', CONN, [{ credentialRef: 'jira-1', binding: BINDING }])).status).toBe(status);
  });

  it('reports a missing secret and an incomplete configuration', async () => {
    expect((await client.test('ws-a', CONN, [{ credentialRef: 'jira-1', binding: BINDING }])).status).toBe('not-found');
    expect((await client.test('ws-a', { ...CONN, url: '' }, [])).status).toBe('incomplete');
  });
});
