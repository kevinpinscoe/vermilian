// Acceptance tests against a real, disposable OpenBao dev server (VERM-64).
// Skipped unless VERMILIAN_OPENBAO_TEST_ADDR and VERMILIAN_OPENBAO_TEST_ROOT
// name such a server: this suite creates policies and AppRoles and seals the
// server at the end, so it must never be pointed at a real instance.

import { describe, it, expect, beforeAll } from 'vitest';
import { createOpenBaoClient, type OpenBaoClient } from './openbaoClient';
import { migrateToOpenBao } from './openbaoMigration';
import { DEFAULT_OPENBAO_CONNECTION, type OpenBaoBinding, type OpenBaoConnection } from '../../shared/openbao';

const ADDR = process.env.VERMILIAN_OPENBAO_TEST_ADDR ?? '';
const ROOT = process.env.VERMILIAN_OPENBAO_TEST_ROOT ?? '';

async function admin(method: string, path: string, body?: unknown): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${ADDR}/v1/${path}`, {
    method,
    headers: { 'X-Vault-Token': ROOT, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

interface Role { roleId: string; secretId: string; accessor: string }

async function makeRole(name: string, prefix: string): Promise<Role> {
  await admin('PUT', `sys/policies/acl/${name}`, {
    policy: `path "secret/data/${prefix}/*" { capabilities = ["create", "read", "update", "delete"] }`,
  });
  await admin('POST', `auth/approle/role/${name}`, { token_policies: [name], token_ttl: '10m' });
  const roleId = (await admin('GET', `auth/approle/role/${name}/role-id`)).data.role_id as string;
  const sid = (await admin('POST', `auth/approle/role/${name}/secret-id`)).data;
  return { roleId, secretId: sid.secret_id as string, accessor: sid.secret_id_accessor as string };
}

function connection(prefix: string, role: Role): OpenBaoConnection {
  return {
    ...DEFAULT_OPENBAO_CONNECTION,
    url: ADDR,
    pathPrefix: prefix,
    auth: { ...DEFAULT_OPENBAO_CONNECTION.auth, roleId: role.roleId, secretFile: '/unused-in-this-test' },
  };
}

function clientFor(secretId: string): OpenBaoClient {
  return createOpenBaoClient({ fetch, readAuthSecret: async () => secretId });
}

const BINDING: OpenBaoBinding = { path: 'jira-1', field: 'token' };

describe.skipIf(!ADDR || !ROOT)('real OpenBao server', () => {
  let work: Role;
  let home: Role;

  beforeAll(async () => {
    await admin('POST', 'sys/auth/approle', { type: 'approle' });
    work = await makeRole('vermilian-work', 'work');
    home = await makeRole('vermilian-home', 'home');
  });

  it('stores, verifies and reads a credential', async () => {
    const c = clientFor(work.secretId);
    expect((await c.storeVerified('ws-work', connection('work', work), BINDING, 'disposable-value-1', { overwrite: false })).ok).toBe(true);
    expect(await c.readField('ws-work', connection('work', work), BINDING)).toEqual({ ok: true, value: 'disposable-value-1' });
  });

  it('still reads it from a new client, as after a restart or upgrade', async () => {
    expect(await clientFor(work.secretId).readField('ws-work', connection('work', work), BINDING))
      .toEqual({ ok: true, value: 'disposable-value-1' });
  });

  it('passes Test Connection with a least-privilege policy', async () => {
    const r = await clientFor(work.secretId).test('ws-work', connection('work', work), [{ credentialRef: 'jira-1', binding: BINDING }]);
    expect(r.status).toBe('connected');
  });

  it('stops one workspace’s role reading another workspace’s path', async () => {
    const crossed = await clientFor(home.secretId).readField('ws-home', connection('work', home), BINDING);
    expect(crossed).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('reports a missing secret', async () => {
    const r = await clientFor(work.secretId).readField('ws-work', connection('work', work), { path: 'absent', field: 'token' });
    expect(r).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses to overwrite a different value during migration, then succeeds when it matches', async () => {
    const c = clientFor(work.secretId);
    const conn = connection('work', work);
    const attempt = (value: string) => migrateToOpenBao({
      references: [{ credentialRef: 'jira-1', binding: BINDING, active: false }],
      readOriginal: async () => ({ ok: true, value }),
      store: (b, v) => c.storeVerified('ws-work', conn, b, v, { overwrite: false }),
      activate: async () => true,
    });
    expect((await attempt('a-different-value')).activated).toBe(false);
    expect(await c.readField('ws-work', conn, BINDING)).toEqual({ ok: true, value: 'disposable-value-1' });
    expect((await attempt('disposable-value-1')).activated).toBe(true);
  });

  it('soft-deletes, and the secret version can be recovered by an administrator', async () => {
    const c = clientFor(work.secretId);
    const conn = connection('work', work);
    const binding = { path: 'to-delete', field: 'token' };
    await c.storeVerified('ws-work', conn, binding, 'disposable-value-2', { overwrite: false });
    expect((await c.deleteField('ws-work', conn, binding)).ok).toBe(true);
    expect(await c.readField('ws-work', conn, binding)).toEqual({ ok: false, reason: 'not-found' });
    await admin('POST', 'secret/undelete/work/to-delete', { versions: [1] });
    expect(await c.readField('ws-work', conn, binding)).toEqual({ ok: true, value: 'disposable-value-2' });
  });

  it('recovers from a revoked token by logging in again', async () => {
    const c = clientFor(work.secretId);
    const conn = connection('work', work);
    await c.readField('ws-work', conn, BINDING);
    await admin('POST', 'sys/leases/revoke-prefix/auth/approle/login', {});
    expect(await c.readField('ws-work', conn, BINDING)).toEqual({ ok: true, value: 'disposable-value-1' });
  });

  it('fails safely once the SecretID and its tokens are revoked', async () => {
    const c = clientFor(home.secretId);
    const conn = connection('home', home);
    await c.readField('ws-home', conn, BINDING);
    await admin('POST', 'auth/approle/role/vermilian-home/secret-id-accessor/destroy', { secret_id_accessor: home.accessor });
    await admin('POST', 'sys/leases/revoke-prefix/auth/approle/login', {});
    expect(await c.readField('ws-home', conn, BINDING)).toEqual({ ok: false, reason: 'auth-rejected' });
  });

  it('reports an unreachable server', async () => {
    const r = await clientFor(work.secretId).readField('ws-work', { ...connection('work', work), url: 'http://127.0.0.1:9' }, BINDING);
    expect(r).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('reports a sealed server', async () => {
    await admin('PUT', 'sys/seal');
    const r = await clientFor(work.secretId).test('ws-work', connection('work', work), []);
    expect(r.status).toBe('sealed');
  });
});
