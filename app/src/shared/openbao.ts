// OpenBao as a credential backend (VERM-64).
//
// A scope is one independent OpenBao configuration: either a workspace, keyed
// by its workspace ID, or this machine's Settings credentials (the YouTrack
// token that loads the workspace list, and the Claude and Jira keys), keyed by
// SETTINGS_SCOPE_ID. Scopes share nothing: not a server, a login or a token.
//
// Only connection details and references are stored here. The AppRole SecretID
// or short-lived token comes from a command or file at login, and is never
// written to Vermilian's configuration.
//
// Pure: no Electron, no Node. Safe in either process and in unit tests.

import { isCredentialRef, type CredentialRef } from './workspaceSchema';

/** Cannot collide with a workspace ID, which never contains an underscore. */
export const SETTINGS_SCOPE_ID = '_settings';

/** What the renderer may ask for. The main process decides which workspace is meant. */
export type OpenBaoScope = 'settings' | 'workspace';

export type OpenBaoAuthMethod = 'approle' | 'token';

export interface OpenBaoAuthConfig {
  method: OpenBaoAuthMethod;
  /** AppRole auth mount; unused by the token method. */
  approleMount: string;
  /** AppRole RoleID; unused by the token method. */
  roleId: string;
  /** Prints the SecretID (approle) or a short-lived token (token). */
  secretCommand: string;
  /** Holds the SecretID (approle) or a short-lived token (token). */
  secretFile: string;
}

export interface OpenBaoConnection {
  url: string;
  namespace: string;
  kvMount: string;
  pathPrefix: string;
  auth: OpenBaoAuthConfig;
}

/** Where one credential lives, relative to the scope's path prefix. */
export interface OpenBaoBinding {
  path: string;
  field: string;
}

export interface OpenBaoScopeConfig extends OpenBaoConnection {
  /** The references this scope reads from OpenBao. Absent means not switched over. */
  credentials: Record<CredentialRef, OpenBaoBinding>;
}

export type OpenBaoFailureReason =
  | 'incomplete' // the configuration is missing or malformed
  | 'unreachable'
  | 'sealed'
  | 'auth-source-failed' // the SecretID or token command or file produced nothing usable
  | 'auth-rejected' // login refused, or the token expired or was revoked
  | 'forbidden' // authenticated, but policy does not allow this path
  | 'not-found'
  | 'conflict' // a different value is already stored, or the secret changed mid-write
  | 'invalid-response';

export type OpenBaoResult<T> = { ok: true; value: T } | { ok: false; reason: OpenBaoFailureReason };

export const OPENBAO_REASON_TEXT: Record<OpenBaoFailureReason, string> = {
  incomplete: 'The OpenBao configuration is incomplete.',
  unreachable: 'The OpenBao server could not be reached.',
  sealed: 'The OpenBao server is sealed or not initialized.',
  'auth-source-failed': 'The command or file that supplies the OpenBao login secret did not produce one.',
  'auth-rejected': 'OpenBao rejected the login, or the token has expired or been revoked.',
  forbidden: 'OpenBao policy does not allow access to this path.',
  'not-found': 'The secret was not found in OpenBao.',
  conflict: 'OpenBao already holds a different value at this location, so nothing was overwritten.',
  'invalid-response': 'OpenBao returned a response Vermilian could not read.',
};

export const DEFAULT_OPENBAO_CONNECTION: OpenBaoConnection = {
  url: '',
  namespace: '',
  kvMount: 'secret',
  pathPrefix: 'vermilian',
  auth: { method: 'approle', approleMount: 'approle', roleId: '', secretCommand: '', secretFile: '' },
};

export function defaultOpenBaoBinding(ref: CredentialRef): OpenBaoBinding {
  return { path: ref, field: 'token' };
}

const PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;
const FIELD_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const SCOPE_ID_RE = /^(?:_settings|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal']);

/** The server's origin, or null. Plain http is accepted only for this machine. */
export function normaliseOpenBaoUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null;
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)) return u.origin;
  return null;
}

export function isOpenBaoPath(value: string): boolean {
  return PATH_RE.test(value);
}

export function isOpenBaoField(value: string): boolean {
  return FIELD_RE.test(value);
}

export type OpenBaoConnectionCheck =
  | { ok: true; connection: OpenBaoConnection }
  | { ok: false; problems: string[] };

/** Validates and normalises a connection. Problems never quote the values. */
export function checkOpenBaoConnection(input: OpenBaoConnection): OpenBaoConnectionCheck {
  const problems: string[] = [];
  const url = normaliseOpenBaoUrl(input.url);
  if (url === null) problems.push('Enter an https:// server address (http:// is allowed only for this machine).');
  const namespace = input.namespace.trim();
  if (namespace && !isOpenBaoPath(namespace)) problems.push('The namespace is not valid.');
  const kvMount = input.kvMount.trim();
  if (!isOpenBaoPath(kvMount)) problems.push('The KV mount is not valid.');
  const pathPrefix = input.pathPrefix.trim();
  if (!isOpenBaoPath(pathPrefix)) problems.push('The secret path is not valid.');

  const a = input.auth;
  const method: OpenBaoAuthMethod = a.method === 'token' ? 'token' : 'approle';
  const approleMount = a.approleMount.trim();
  const roleId = a.roleId.trim();
  const secretCommand = a.secretCommand.trim();
  const secretFile = a.secretFile.trim();
  if (method === 'approle') {
    if (!isOpenBaoPath(approleMount)) problems.push('The AppRole mount is not valid.');
    if (!roleId) problems.push('Enter the AppRole RoleID.');
  }
  if (Boolean(secretCommand) === Boolean(secretFile)) {
    problems.push('Set either a command or a file for the login secret, not both.');
  }
  if (problems.length > 0 || url === null) return { ok: false, problems };
  return {
    ok: true,
    connection: {
      url,
      namespace,
      kvMount,
      pathPrefix,
      auth: { method, approleMount, roleId, secretCommand, secretFile },
    },
  };
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Keeps only the known fields, so a hand-edited file cannot carry a token into
 * the configuration. A malformed scope is kept rather than dropped: dropping it
 * would silently move its credentials onto another source, whereas keeping it
 * makes resolution fail with 'incomplete'.
 */
export function sanitiseOpenBaoScopes(input: unknown): Record<string, OpenBaoScopeConfig> {
  const out: Record<string, OpenBaoScopeConfig> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!SCOPE_ID_RE.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const s = raw as Record<string, unknown>;
    const a = (s.auth && typeof s.auth === 'object' ? s.auth : {}) as Record<string, unknown>;
    const credentials: Record<CredentialRef, OpenBaoBinding> = {};
    if (s.credentials && typeof s.credentials === 'object' && !Array.isArray(s.credentials)) {
      for (const [ref, b] of Object.entries(s.credentials as Record<string, unknown>)) {
        if (!isCredentialRef(ref) || !b || typeof b !== 'object') continue;
        const binding = b as Record<string, unknown>;
        credentials[ref] = { path: text(binding.path), field: text(binding.field) };
      }
    }
    out[id] = {
      url: text(s.url),
      namespace: text(s.namespace),
      kvMount: text(s.kvMount),
      pathPrefix: text(s.pathPrefix),
      auth: {
        method: a.method === 'token' ? 'token' : 'approle',
        approleMount: text(a.approleMount),
        roleId: text(a.roleId),
        secretCommand: text(a.secretCommand),
        secretFile: text(a.secretFile),
      },
      credentials,
    };
  }
  return out;
}

// ─── What crosses IPC ────────────────────────────────────────────────────────

export interface OpenBaoReferenceState {
  credentialRef: CredentialRef;
  active: boolean;
  binding: OpenBaoBinding;
  /** The source this reference has without OpenBao, or null when it has none. */
  original: 'command' | 'file' | 'safeStorage' | null;
}

export interface OpenBaoScopeState {
  scope: OpenBaoScope;
  available: boolean;
  label: string;
  connection: OpenBaoConnection | null;
  references: OpenBaoReferenceState[];
}

export type OpenBaoTestStatus = 'connected' | OpenBaoFailureReason;

export interface OpenBaoTestResult {
  status: OpenBaoTestStatus;
  message: string;
  references: Array<{ credentialRef: CredentialRef; status: 'ok' | OpenBaoFailureReason }>;
}

export type OpenBaoWriteResult = { ok: true; message: string } | { ok: false; message: string };

export type OpenBaoMigrationStep = 'verified' | 'already-active' | 'failed' | 'not-attempted';

export interface OpenBaoMigrationResult {
  ok: boolean;
  /** True only when every reference verified and the scope was switched over. */
  activated: boolean;
  message: string;
  references: Array<{ credentialRef: CredentialRef; step: OpenBaoMigrationStep; message: string }>;
}

export function describeOpenBaoTest(status: OpenBaoTestStatus): string {
  return status === 'connected' ? 'Connected and authenticated.' : OPENBAO_REASON_TEXT[status];
}
