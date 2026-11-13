// Workspace schema v2 (ADR-0011): one self-contained document per workspace.
//
// A workspace is the isolation boundary. Each one names its own ticketing
// backend (YouTrack or Jira) with non-secret connection details, opaque
// credential references for that backend and for Anthropic, and the
// configuration it already had in the shared _vermilian-config article:
// folders and their projects, board settings and "Not this week" dismissals.
//
// This module is the schema and its validation only. Reading and writing the
// per-workspace articles is VERM-43; migrating _vermilian-config is VERM-44;
// resolving a credential reference to a key is VERM-45.
//
// Design rules:
//
// - **Reuse, don't remodel.** Folders, board settings and dismissals are the
//   existing WorkspaceFolder, BoardConfig and Dismissals types, and board
//   columns are validated against ALL_COLUMN_FIELDS, which derives from
//   FIELD_DEFS. The Jira connection reuses the JiraProfile rules. Per-issue
//   Runway metadata (Focus, Focus rank, Why now) is deliberately absent: for a
//   YouTrack workspace it stays in YouTrack custom fields (ADR-0007), and for a
//   Jira workspace it lives in the local Runway store (VERM-36/37).
// - **Credential references, never secrets.** Any secret-shaped string anywhere
//   in a document — known field or not — makes it invalid. Errors name the
//   field and never contain the value.
// - **Lossless.** Unknown fields never reach the typed document, so nothing
//   reads them, but parse returns the original JSON as `source`, and
//   serialising with that source writes every unknown field back. A schema
//   version this code does not know is rejected, never guessed at.
//
// Pure TypeScript: no Electron, no React. Safe in either process and in tests.

import {
  ALL_COLUMN_FIELDS,
  dismissalKey,
  type BoardConfig,
  type Dismissals,
} from './boardConfig';
import { normaliseSiteUrl, type JiraProfile } from './jiraProfile';
import { isTrackerKind } from './tracker';
import type { WorkspaceFolder } from './workspace';

export const WORKSPACE_SCHEMA_VERSION = 2;

// ─── Types ───────────────────────────────────────────────────────────────────

/** An opaque name such as `anthropic-1` or `jira-1`, resolved per host. */
export type CredentialRef = string;

export interface YouTrackBackend {
  kind: 'youtrack';
  serverUrl: string;
  credentialRef: CredentialRef | null;
}

export interface JiraBackend extends JiraProfile {
  kind: 'jira';
  credentialRef: CredentialRef | null;
}

export type WorkspaceBackend = YouTrackBackend | JiraBackend;

export interface WorkspaceAiConfig {
  /** null = no Anthropic account selected; AI features are unavailable. */
  credentialRef: CredentialRef | null;
}

export interface WorkspaceDocument {
  schema: typeof WORKSPACE_SCHEMA_VERSION;
  workspaceId: string;
  name: string;
  order: number;
  backend: WorkspaceBackend;
  ai: WorkspaceAiConfig;
  folders: WorkspaceFolder[];
  boards: Record<string, BoardConfig>; // keyed by boardId (project ID or key)
  dismissals: Dismissals; // keyed by dismissalKey(workspaceId, issueId)
}

export type WorkspaceValidationCode = 'invalid' | 'duplicate' | 'secret' | 'unsupported-schema' | 'malformed';

export interface WorkspaceValidationError {
  path: string; // e.g. `backend.siteUrl`, `boards["0-12"].views[0].type`; '' = the whole document
  code: WorkspaceValidationCode;
  message: string; // never contains the offending value when it may be a secret
}

export type WorkspaceParseResult =
  | { ok: true; document: WorkspaceDocument; source: Record<string, unknown> }
  | { ok: false; errors: WorkspaceValidationError[] };

// ─── Identifiers ─────────────────────────────────────────────────────────────

// Lowercase words joined by single hyphens. Every ID Vermilian has created so
// far fits (`workspace-default`, `workspace-<ms>`), and the shape is safe in an
// article title (`_vermilian-ws-<id>`, ADR-0011 §4).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;

export function isValidWorkspaceId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= MAX_ID_LENGTH && SLUG_RE.test(id);
}

export function isCredentialRef(ref: unknown): ref is CredentialRef {
  return typeof ref === 'string' && ref.length <= MAX_ID_LENGTH && SLUG_RE.test(ref);
}

/** A new stable workspace ID, `ws-` plus 12 random hex digits. */
export function generateWorkspaceId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return 'ws-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Secret detection ────────────────────────────────────────────────────────

const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Atlassian API token', /\bATATT[A-Za-z0-9_=-]{20,}/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{16,}/],
  ['API key', /\bsk-[A-Za-z0-9]{32,}/],
  ['YouTrack permanent token', /\bperm[:-][A-Za-z0-9+/=_-]{4,}\.[A-Za-z0-9+/=_-]{2,}\.[A-Za-z0-9+/=_-]{10,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['authorization header', /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/i],
];

// Words that, as a key, mean "this value is a credential". Matched against the
// key split into words, so `apiToken` and `jira_password` match but
// `tokenized` and `credentialRef` (the sanctioned reference) do not.
const SECRET_KEY_WORDS = new Set(['token', 'secret', 'password', 'passwd', 'passphrase', 'apikey', 'privatekey']);
const SECRET_KEY_PAIRS = new Set(['api key', 'private key', 'access key', 'client secret']);
const SECRET_QUERY_WORDS = new Set([...SECRET_KEY_WORDS, 'key', 'sig', 'signature', 'auth']);

function keyWords(key: string): string[] {
  return key
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function isSecretKeyName(key: string, words = SECRET_KEY_WORDS): boolean {
  const w = keyWords(key);
  if (w.some((x) => words.has(x))) return true;
  for (let i = 0; i + 1 < w.length; i++) if (SECRET_KEY_PAIRS.has(`${w[i]} ${w[i + 1]}`)) return true;
  return false;
}

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// A long run of token characters mixing upper case, lower case and digits with
// high entropy. UUIDs, hex hashes, slugs and URLs never qualify: they lack
// upper case or contain characters outside the token alphabet.
function isHighEntropyToken(token: string): boolean {
  return (
    token.length >= 32 &&
    /^[A-Za-z0-9+/=_-]+$/.test(token) &&
    /[A-Z]/.test(token) &&
    /[a-z]/.test(token) &&
    /[0-9]/.test(token) &&
    shannonEntropy(token) >= 3.5
  );
}

function urlCredentialKind(value: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.password) return 'URL with an embedded password';
  for (const name of u.searchParams.keys()) {
    if (isSecretKeyName(name, SECRET_QUERY_WORDS)) return 'URL with a credential in its query string';
  }
  return null;
}

/** What kind of secret a string looks like, or null if it looks like none. */
function secretKind(value: string): string | null {
  for (const [label, re] of SECRET_PATTERNS) if (re.test(value)) return label;
  const inUrl = urlCredentialKind(value);
  if (inUrl) return inUrl;
  if (value.split(/\s+/).some(isHighEntropyToken)) return 'high-entropy token';
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function joinKey(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
}

function secretError(path: string, kind: string): WorkspaceValidationError {
  return {
    path,
    code: 'secret',
    message:
      `${path || 'The document'} looks like a credential (${kind}). ` +
      'Store an opaque credential reference instead; secrets never belong in workspace configuration.',
  };
}

/**
 * Every string anywhere in `value` (object keys included) that looks like a
 * secret, by path. A secret-shaped key is redacted from the path itself.
 */
export function findSecretShapedValues(value: unknown, path = ''): WorkspaceValidationError[] {
  const found: WorkspaceValidationError[] = [];
  const walk = (v: unknown, p: string, parentKey: string | null) => {
    if (typeof v === 'string') {
      const kind = secretKind(v);
      if (kind) found.push(secretError(p, kind));
      else if (parentKey !== null && v !== '' && isSecretKeyName(parentKey)) {
        found.push(secretError(p, `a value under the credential-named key "${parentKey}"`));
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`, parentKey));
    } else if (isPlainObject(v)) {
      for (const [k, child] of Object.entries(v)) {
        const keyKind = secretKind(k);
        if (keyKind) {
          const redacted = `${p}[redacted key]`;
          found.push(secretError(redacted, keyKind));
          walk(child, redacted, null);
        } else {
          walk(child, joinKey(p, k), k);
        }
      }
    }
  };
  walk(value, path, null);
  return found;
}

// ─── Structural validation ───────────────────────────────────────────────────

const recordPath = (path: string, key: string) => `${path}[${JSON.stringify(key)}]`;

const JIRA_PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/; // the JiraProfile rule
const VIEW_TYPES = ['table', 'kanban'] as const;
const SORT_DIRECTIONS = ['asc', 'desc'] as const;
const COLUMN_FIELDS: readonly string[] = ALL_COLUMN_FIELDS;

class Collector {
  readonly errors: WorkspaceValidationError[] = [];

  add(path: string, message: string, code: WorkspaceValidationCode = 'invalid') {
    this.errors.push({ path, code, message });
  }

  object(v: unknown, path: string): v is Record<string, unknown> {
    if (isPlainObject(v)) return true;
    this.add(path, `${path} must be an object.`);
    return false;
  }

  array(v: unknown, path: string): v is unknown[] {
    if (Array.isArray(v)) return true;
    this.add(path, `${path} must be an array.`);
    return false;
  }

  string(v: unknown, path: string, { nonEmpty = false } = {}): v is string {
    if (typeof v === 'string' && (!nonEmpty || v.trim() !== '')) return true;
    this.add(path, nonEmpty ? `${path} must be a non-empty string.` : `${path} must be a string.`);
    return false;
  }

  boolean(v: unknown, path: string) {
    if (typeof v !== 'boolean') this.add(path, `${path} must be true or false.`);
  }

  order(v: unknown, path: string) {
    if (!Number.isInteger(v) || (v as number) < 0) this.add(path, `${path} must be a whole number, 0 or more.`);
  }

  oneOf(v: unknown, allowed: readonly string[], path: string) {
    if (typeof v !== 'string' || !allowed.includes(v)) {
      this.add(path, `${path} must be one of: ${allowed.join(', ')}.`);
    }
  }

  credentialRef(v: unknown, path: string) {
    if (v !== null && !isCredentialRef(v)) {
      this.add(path, `${path} must be null or a credential reference such as "account-1" (lowercase words and hyphens).`);
    }
  }
}

function validateBackend(c: Collector, backend: unknown) {
  if (!c.object(backend, 'backend')) return;
  const kind = backend.kind;
  if (!isTrackerKind(kind)) {
    c.add('backend.kind', 'backend.kind must be "youtrack" or "jira".');
    return;
  }
  c.credentialRef(backend.credentialRef, 'backend.credentialRef');

  if (kind === 'youtrack') {
    const url = backend.serverUrl;
    let ok = false;
    if (typeof url === 'string') {
      try {
        const u = new URL(url);
        ok = (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname && !u.username && !u.password && !u.search && !u.hash;
      } catch {
        ok = false;
      }
    }
    if (!ok) c.add('backend.serverUrl', 'backend.serverUrl must be an http(s) URL with no credentials, query or fragment.');
    return;
  }

  // Jira: the same rules as the VERM-18 Jira profile, stored in canonical form.
  const { siteUrl, email, cloudId } = backend;
  if (typeof siteUrl !== 'string' || normaliseSiteUrl(siteUrl) !== siteUrl) {
    c.add('backend.siteUrl', 'backend.siteUrl must be an https site URL in canonical form, e.g. https://example.atlassian.net.');
  }
  if (typeof email !== 'string' || email !== email.trim() || !EMAIL_RE.test(email)) {
    c.add('backend.email', 'backend.email must be an email address.');
  }
  if (typeof cloudId !== 'string' || cloudId !== cloudId.trim()) {
    c.add('backend.cloudId', 'backend.cloudId must be a string ("" until detected).');
  }
}

function validateFolders(c: Collector, folders: unknown, backendKind: unknown) {
  if (!c.array(folders, 'folders')) return;
  const seen = new Set<string>();
  folders.forEach((f, i) => {
    const p = `folders[${i}]`;
    if (!c.object(f, p)) return;
    if (c.string(f.id, `${p}.id`, { nonEmpty: true })) {
      if (seen.has(f.id)) c.add(`${p}.id`, `${p}.id duplicates another folder's ID.`, 'duplicate');
      seen.add(f.id);
    }
    c.string(f.name, `${p}.name`);
    c.order(f.order, `${p}.order`);
    if (f.parentId !== null && typeof f.parentId !== 'string') c.add(`${p}.parentId`, `${p}.parentId must be null or a string.`);
    if (!c.array(f.projectIds, `${p}.projectIds`)) return;
    f.projectIds.forEach((id, j) => {
      const pp = `${p}.projectIds[${j}]`;
      if (!c.string(id, pp, { nonEmpty: true })) return;
      if (backendKind === 'jira' && !JIRA_PROJECT_KEY_RE.test(id)) c.add(pp, `${pp} must be a Jira project key, e.g. DEMO.`);
    });
  });
}

function validateView(c: Collector, view: unknown, p: string) {
  if (!c.object(view, p)) return;
  c.string(view.name, `${p}.name`);
  c.oneOf(view.type, VIEW_TYPES, `${p}.type`);
  c.string(view.groupBy, `${p}.groupBy`);
  if (c.array(view.columns, `${p}.columns`)) {
    view.columns.forEach((col, k) => {
      const cp = `${p}.columns[${k}]`;
      if (!c.object(col, cp)) return;
      c.oneOf(col.field, COLUMN_FIELDS, `${cp}.field`);
      if (typeof col.width !== 'number' || !Number.isFinite(col.width) || col.width <= 0) {
        c.add(`${cp}.width`, `${cp}.width must be a positive number.`);
      }
      c.boolean(col.visible, `${cp}.visible`);
    });
  }
  if (view.sort !== undefined && c.object(view.sort, `${p}.sort`)) {
    c.oneOf(view.sort.field, COLUMN_FIELDS, `${p}.sort.field`);
    c.oneOf(view.sort.direction, SORT_DIRECTIONS, `${p}.sort.direction`);
  }
  if (view.issueOrderByGroup !== undefined && c.object(view.issueOrderByGroup, `${p}.issueOrderByGroup`)) {
    for (const [group, ids] of Object.entries(view.issueOrderByGroup)) {
      const gp = recordPath(`${p}.issueOrderByGroup`, group);
      if (c.array(ids, gp)) ids.forEach((id, n) => c.string(id, `${gp}[${n}]`));
    }
  }
}

function validateBoards(c: Collector, boards: unknown) {
  if (!c.object(boards, 'boards')) return;
  for (const [key, board] of Object.entries(boards)) {
    const p = recordPath('boards', key);
    if (!c.object(board, p)) continue;
    if (board.boardId !== key) c.add(`${p}.boardId`, `${p}.boardId must equal the key it is stored under.`);
    c.string(board.activeViewId, `${p}.activeViewId`);
    if (c.array(board.views, `${p}.views`)) {
      const seen = new Set<string>();
      board.views.forEach((view, i) => {
        const vp = `${p}.views[${i}]`;
        validateView(c, view, vp);
        if (isPlainObject(view) && c.string(view.id, `${vp}.id`, { nonEmpty: true })) {
          if (seen.has(view.id)) c.add(`${vp}.id`, `${vp}.id duplicates another view's ID.`, 'duplicate');
          seen.add(view.id);
        }
      });
    }
    if (c.object(board.colors, `${p}.colors`)) {
      for (const [field, map] of Object.entries(board.colors)) {
        const fp = recordPath(`${p}.colors`, field);
        if (c.object(map, fp)) for (const [value, color] of Object.entries(map)) c.string(color, recordPath(fp, value));
      }
    }
  }
}

function isIsoDate(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validateDismissals(c: Collector, dismissals: unknown, workspaceId: unknown) {
  if (!c.object(dismissals, 'dismissals')) return;
  for (const [key, d] of Object.entries(dismissals)) {
    const p = recordPath('dismissals', key);
    if (!c.object(d, p)) continue;
    if (d.workspace !== workspaceId) c.add(`${p}.workspace`, `${p}.workspace must be this workspace's ID.`);
    const idOk = c.string(d.issueId, `${p}.issueId`, { nonEmpty: true });
    if (idOk && typeof d.workspace === 'string' && key !== dismissalKey(d.workspace, d.issueId as string)) {
      c.add(p, `${p} must be keyed "<workspace>:<issueId>", as dismissalKey builds it.`);
    }
    if (!isIsoDate(d.dismissedWeekOf)) c.add(`${p}.dismissedWeekOf`, `${p}.dismissedWeekOf must be an ISO date (YYYY-MM-DD).`);
  }
}

/**
 * Every problem with `input` as a workspace document, or [] if it is valid.
 * Secret-shaped values are reported wherever they are, unknown fields included.
 */
export function validateWorkspaceDocument(input: unknown): WorkspaceValidationError[] {
  if (!isPlainObject(input)) {
    return [{ path: '', code: 'invalid', message: 'A workspace must be a JSON object.' }];
  }
  const secrets = findSecretShapedValues(input);
  if (input.schema !== WORKSPACE_SCHEMA_VERSION) {
    const found = typeof input.schema === 'number' ? `schema ${input.schema}` : 'a missing or non-numeric schema';
    return [
      {
        path: 'schema',
        code: 'unsupported-schema',
        message: `This workspace has ${found}; this version of Vermilian reads schema ${WORKSPACE_SCHEMA_VERSION} only.`,
      },
      ...secrets,
    ];
  }

  const c = new Collector();
  if (!isValidWorkspaceId(input.workspaceId)) {
    c.add('workspaceId', 'workspaceId must be lowercase words joined by hyphens, at most 64 characters.');
  }
  c.string(input.name, 'name', { nonEmpty: true });
  c.order(input.order, 'order');
  validateBackend(c, input.backend);
  if (c.object(input.ai, 'ai')) c.credentialRef(input.ai.credentialRef, 'ai.credentialRef');
  validateFolders(c, input.folders, isPlainObject(input.backend) ? input.backend.kind : undefined);
  validateBoards(c, input.boards);
  validateDismissals(c, input.dismissals, input.workspaceId);
  return [...c.errors, ...secrets];
}

// ─── Shape: which fields are known, and how unknown ones are carried ─────────

type Shape =
  | { t: 'leaf' }
  | { t: 'struct'; fields: Record<string, Shape> }
  | { t: 'record'; of: Shape }
  | { t: 'array'; of: Shape; key?: string }
  | { t: 'backend'; variants: Record<string, Shape> };

const LEAF: Shape = { t: 'leaf' };
const struct = (fields: Record<string, Shape>): Shape => ({ t: 'struct', fields });

const COLUMN_SHAPE = struct({ field: LEAF, width: LEAF, visible: LEAF });
const VIEW_SHAPE = struct({
  id: LEAF,
  name: LEAF,
  type: LEAF,
  groupBy: LEAF,
  columns: { t: 'array', of: COLUMN_SHAPE, key: 'field' },
  sort: struct({ field: LEAF, direction: LEAF }),
  issueOrderByGroup: { t: 'record', of: LEAF },
});

const DOCUMENT_SHAPE = struct({
  schema: LEAF,
  workspaceId: LEAF,
  name: LEAF,
  order: LEAF,
  backend: {
    t: 'backend',
    variants: {
      youtrack: struct({ kind: LEAF, serverUrl: LEAF, credentialRef: LEAF }),
      jira: struct({ kind: LEAF, siteUrl: LEAF, email: LEAF, cloudId: LEAF, credentialRef: LEAF }),
    },
  },
  ai: struct({ credentialRef: LEAF }),
  folders: {
    t: 'array',
    key: 'id',
    of: struct({ id: LEAF, name: LEAF, order: LEAF, parentId: LEAF, projectIds: LEAF }),
  },
  boards: {
    t: 'record',
    of: struct({
      boardId: LEAF,
      views: { t: 'array', of: VIEW_SHAPE, key: 'id' },
      activeViewId: LEAF,
      colors: { t: 'record', of: { t: 'record', of: LEAF } },
    }),
  },
  dismissals: { t: 'record', of: struct({ workspace: LEAF, issueId: LEAF, dismissedWeekOf: LEAF }) },
});

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

// Known fields only — what the typed document holds.
function project(shape: Shape, v: unknown): unknown {
  switch (shape.t) {
    case 'leaf':
      return clone(v);
    case 'struct': {
      const out: Record<string, unknown> = {};
      const src = v as Record<string, unknown>;
      for (const [k, s] of Object.entries(shape.fields)) if (src[k] !== undefined) out[k] = project(s, src[k]);
      return out;
    }
    case 'record':
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, project(shape.of, x)]));
    case 'array':
      return (v as unknown[]).map((x) => project(shape.of, x));
    case 'backend':
      return project(shape.variants[(v as { kind: string }).kind], v);
  }
}

// Known fields from `next`, laid over `src` so its unknown fields survive.
// Known fields removed from `next` are removed; source key order is kept, so
// an unchanged document serialises byte-identically.
function overlay(shape: Shape, next: unknown, src: unknown): unknown {
  switch (shape.t) {
    case 'leaf':
      return clone(next);
    case 'struct': {
      if (!isPlainObject(src)) return project(shape, next);
      const n = next as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src)) {
        const s = shape.fields[k];
        if (!s) out[k] = clone(src[k]);
        else if (n[k] !== undefined) out[k] = overlay(s, n[k], src[k]);
      }
      for (const [k, s] of Object.entries(shape.fields)) {
        if (!(k in out) && n[k] !== undefined) out[k] = project(s, n[k]);
      }
      return out;
    }
    case 'record': {
      const s = isPlainObject(src) ? src : {};
      return Object.fromEntries(
        Object.entries(next as Record<string, unknown>).map(([k, x]) => [k, overlay(shape.of, x, s[k])]),
      );
    }
    case 'array': {
      const key = shape.key;
      const pool = Array.isArray(src) ? src : [];
      return (next as unknown[]).map((x) => {
        const match =
          key && isPlainObject(x) ? pool.find((y) => isPlainObject(y) && y[key] === x[key]) : undefined;
        return match === undefined ? project(shape.of, x) : overlay(shape.of, x, match);
      });
    }
    case 'backend': {
      const kind = (next as { kind: string }).kind;
      const variant = shape.variants[kind];
      // A different backend kind starts clean: the old kind's unknown fields
      // describe a connection that no longer exists.
      return isPlainObject(src) && src.kind === kind ? overlay(variant, next, src) : project(variant, next);
    }
  }
}

// ─── Parse and serialise ─────────────────────────────────────────────────────

/**
 * Parse an article body (or an already-parsed value). Tolerates the ```json
 * fence YouTrack's editor may add. Never falls back to an empty workspace: a
 * malformed, invalid, secret-bearing or newer-schema document is an error.
 */
export function parseWorkspaceDocument(raw: unknown): WorkspaceParseResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    } catch {
      return { ok: false, errors: [{ path: '', code: 'malformed', message: 'The workspace is not valid JSON.' }] };
    }
  }
  const errors = validateWorkspaceDocument(value);
  if (errors.length > 0) return { ok: false, errors };
  const source = clone(value) as Record<string, unknown>;
  return { ok: true, document: project(DOCUMENT_SHAPE, value) as WorkspaceDocument, source };
}

function describe(errors: WorkspaceValidationError[]): string {
  return errors.map((e) => e.message).join(' ');
}

/**
 * Serialise a workspace document. Pass the `source` that parseWorkspaceDocument
 * returned to write unknown fields back unchanged (read-modify-write). Throws on
 * an invalid document, a secret anywhere in the output, or a source whose schema
 * version this code cannot preserve.
 */
export function serialiseWorkspaceDocument(doc: WorkspaceDocument, source?: unknown): string {
  const errors = validateWorkspaceDocument(doc);
  if (errors.length > 0) throw new Error(`Invalid workspace: ${describe(errors)}`);

  let out: unknown;
  if (source === undefined) {
    out = project(DOCUMENT_SHAPE, doc);
  } else {
    if (!isPlainObject(source) || source.schema !== WORKSPACE_SCHEMA_VERSION) {
      throw new Error(
        `Cannot preserve fields from a workspace source that is not schema ${WORKSPACE_SCHEMA_VERSION}; refusing to write.`,
      );
    }
    out = overlay(DOCUMENT_SHAPE, doc, source);
  }

  const secrets = findSecretShapedValues(out);
  if (secrets.length > 0) throw new Error(`Invalid workspace: ${describe(secrets)}`);
  return JSON.stringify(out, null, 2);
}
