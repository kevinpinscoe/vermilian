// Migration from the shared _vermilian-config article (and the VERM-18 Jira
// profile article) to per-workspace `_vermilian-ws-<id>` articles (VERM-44,
// ADR-0011 §11). The result types every layer shares, and the pure step that
// turns the source articles into the workspace documents migration writes.
//
// Rules (Kevin, 2026-11-13):
//
// - Each workspace in _vermilian-config becomes its own article with the same
//   ID, name, order, folders and projects, the board configuration of its own
//   projects and its own dismissals. Its backend is YouTrack on the current
//   server, with credential reference `youtrack-1`; its Anthropic reference is
//   `anthropic-1`, so today's single key keeps serving every migrated workspace.
// - A Jira profile becomes a separate, new Jira-backed workspace only when the
//   caller supplies its name. Its ID is derived from the profile article's ID,
//   so a second run finds it instead of creating another. It has credential
//   reference `jira-1`, no Anthropic reference (a new workspace has none) and
//   no projects (chosen later, VERM-33). Without a name the profile is
//   reported as unassigned and left alone. No existing workspace is converted.
// - The source articles are never written. Nothing here runs on its own:
//   VERM-46 runs migration when it activates per-workspace storage.
// - Anything the new schema does not carry is reported by path, never dropped
//   silently; values are never reported.
//
// Pure TypeScript: no Electron, no React.

import { ARTICLE_CONFIG_VERSION, type BoardConfig, type Dismissals } from './boardConfig';
import { normaliseJiraProfile, type JiraProfile } from './jiraProfile';
import {
  WORKSPACE_SCHEMA_VERSION,
  isValidWorkspaceId,
  parseWorkspaceDocument,
  validateWorkspaceDocument,
  type WorkspaceDocument,
  type WorkspaceValidationError,
} from './workspaceSchema';

export const CONFIG_ARTICLE_TITLE = '_vermilian-config';
export const JIRA_PROFILE_ARTICLE_TITLE = '_vermilian-jira-overlay';

export const MIGRATED_YOUTRACK_CREDENTIAL_REF = 'youtrack-1';
export const MIGRATED_ANTHROPIC_CREDENTIAL_REF = 'anthropic-1';
export const MIGRATED_JIRA_CREDENTIAL_REF = 'jira-1';

export interface WorkspaceMigrationOptions {
  /** Name for a new Jira-backed workspace holding the Jira profile. Omit to leave the profile unassigned. */
  jiraWorkspaceName?: string | null;
}

export type WorkspaceMigrationAction =
  | 'create' // plan: the workspace has no article yet; apply will create it
  | 'created' // apply: created, and rediscovery confirmed it is the workspace's one article
  | 'unchanged' // the article already holds exactly what migration would write
  | 'conflict' // the article exists with different content; nothing was written
  | 'ambiguous' // more than one article carries the title; nothing was written
  | 'invalid-remote' // the existing article cannot be read; nothing was written
  | 'invalid-source' // the source workspace does not make a valid document; nothing was written
  | 'failed'; // apply: the create failed or could not be verified

export interface WorkspaceMigrationItem {
  workspaceId: string;
  name: string;
  backend: 'youtrack' | 'jira';
  action: WorkspaceMigrationAction;
  message: string;
  document?: WorkspaceDocument; // what migration writes (or would write)
  articleId?: string;
  articleIds?: string[];
  differences?: string[]; // top-level fields where the existing article differs
  errors?: WorkspaceValidationError[];
  notCarried?: string[]; // source paths the workspace schema has no place for
}

export type JiraProfileMigration =
  | { status: 'none'; articleId?: string } // no profile article, or one holding no profile
  | { status: 'unassigned'; articleId: string; message: string }
  | { status: 'assigned'; articleId: string; workspaceId: string }
  | { status: 'invalid'; articleId: string; message: string }
  | { status: 'ambiguous'; articleIds: string[]; message: string };

export interface WorkspaceMigrationReport {
  ok: true;
  mode: 'plan' | 'apply';
  // Every workspace's article exists and holds what migration writes. Only a
  // complete apply may be followed by switching storage (VERM-46).
  complete: boolean;
  items: WorkspaceMigrationItem[];
  jiraProfile: JiraProfileMigration;
  // In _vermilian-config but belonging to no migrated workspace: left there.
  notMigrated: { boards: string[]; dismissals: string[] };
  configArticleId: string;
}

export interface WorkspaceMigrationFailure {
  ok: false;
  reason:
    | 'not-configured'
    | 'discovery-error'
    | 'discovery-incomplete'
    | 'source-missing'
    | 'source-ambiguous'
    | 'source-invalid'
    | 'source-unsupported';
  message: string;
  articleIds?: string[];
}

export type WorkspaceMigrationResult = WorkspaceMigrationReport | WorkspaceMigrationFailure;

// ─── Source parsing (strict: never an empty fallback) ───────────────────────

const stripFence = (raw: string) => raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface LegacyConfig {
  workspaces: unknown[];
  boards: Record<string, unknown>;
  dismissals: Record<string, unknown>;
}

export function parseLegacyConfig(
  raw: string,
): { ok: true; config: LegacyConfig } | { ok: false; reason: 'source-invalid' | 'source-unsupported'; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { ok: false, reason: 'source-invalid', message: `${CONFIG_ARTICLE_TITLE} is not valid JSON; nothing was migrated.` };
  }
  if (!isObject(parsed)) {
    return { ok: false, reason: 'source-invalid', message: `${CONFIG_ARTICLE_TITLE} is not a JSON object; nothing was migrated.` };
  }
  const version = parsed.version ?? ARTICLE_CONFIG_VERSION;
  if (typeof version !== 'number' || version > ARTICLE_CONFIG_VERSION) {
    return {
      ok: false,
      reason: 'source-unsupported',
      message: `${CONFIG_ARTICLE_TITLE} has version ${String(version)}; this version of Vermilian migrates version ${ARTICLE_CONFIG_VERSION} only.`,
    };
  }
  const { workspaces = [], boards = {}, dismissals = {} } = parsed;
  if (!Array.isArray(workspaces) || !isObject(boards) || !isObject(dismissals)) {
    return {
      ok: false,
      reason: 'source-invalid',
      message: `${CONFIG_ARTICLE_TITLE} has workspaces, boards or dismissals of the wrong type; nothing was migrated.`,
    };
  }
  return { ok: true, config: { workspaces, boards, dismissals } };
}

export type JiraProfileSource =
  | { kind: 'none' }
  | { kind: 'empty'; articleId: string }
  | { kind: 'invalid'; articleId: string; message: string }
  | { kind: 'profile'; articleId: string; profile: JiraProfile };

export function parseJiraProfileSource(articleId: string, raw: string): JiraProfileSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { kind: 'invalid', articleId, message: `The Jira profile article (${articleId}) is not valid JSON.` };
  }
  if (!isObject(parsed)) {
    return { kind: 'invalid', articleId, message: `The Jira profile article (${articleId}) is not a JSON object.` };
  }
  if (parsed.profile === null || parsed.profile === undefined) return { kind: 'empty', articleId };
  const profile = isObject(parsed.profile) ? normaliseJiraProfile(parsed.profile as Partial<JiraProfile>) : null;
  if (!profile) {
    return { kind: 'invalid', articleId, message: `The Jira profile in article ${articleId} has no valid site URL and email.` };
  }
  return { kind: 'profile', articleId, profile };
}

/** The stable ID of the Jira workspace migrated from profile article `articleId`, or null. */
export function jiraWorkspaceIdFor(articleId: string): string | null {
  const id = 'ws-jira-' + articleId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return isValidWorkspaceId(id) ? id : null;
}

// ─── Building the documents ─────────────────────────────────────────────────

/** Paths present in `src` but not in `kept` — what the schema did not carry. */
function droppedPaths(src: unknown, kept: unknown, path: string, out: string[]): void {
  if (Array.isArray(src)) {
    if (!Array.isArray(kept)) return;
    src.forEach((v, i) => droppedPaths(v, kept[i], `${path}[${i}]`, out));
    return;
  }
  if (!isObject(src) || !isObject(kept)) return;
  for (const [k, v] of Object.entries(src)) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in kept)) out.push(p);
    else droppedPaths(v, kept[k], p, out);
  }
}

export type MigrationTarget =
  | { kind: 'doc'; document: WorkspaceDocument; notCarried: string[] }
  | { kind: 'invalid'; item: WorkspaceMigrationItem };

export interface MigrationTargets {
  targets: MigrationTarget[];
  notMigrated: { boards: string[]; dismissals: string[] };
}

function invalidTarget(
  workspaceId: string,
  name: string,
  backend: 'youtrack' | 'jira',
  errors: WorkspaceValidationError[],
): MigrationTarget {
  // A field that is itself secret-shaped is not echoed back.
  const secret = (path: string) => errors.some((e) => e.code === 'secret' && e.path === path);
  if (secret('workspaceId')) workspaceId = '';
  return {
    kind: 'invalid',
    item: {
      workspaceId,
      name: secret('name') ? '' : name,
      backend,
      action: 'invalid-source',
      errors,
      message:
        `Workspace ${workspaceId || '(no ID)'} cannot be migrated: ${errors.map((e) => e.message).join(' ')} ` +
        'Nothing was written for it; it stays in the original configuration.',
    },
  };
}

// Validate, then keep only the known fields — the document as it will read back.
function finishDoc(doc: WorkspaceDocument, backend: 'youtrack' | 'jira'): MigrationTarget {
  const errors = validateWorkspaceDocument(doc);
  if (errors.length > 0) return invalidTarget(doc.workspaceId, String(doc.name ?? ''), backend, errors);
  const parsed = parseWorkspaceDocument(doc);
  if (!parsed.ok) return invalidTarget(doc.workspaceId, String(doc.name ?? ''), backend, parsed.errors);
  return { kind: 'doc', document: parsed.document, notCarried: [] };
}

/**
 * The workspace documents migration writes, from the parsed sources.
 * `serverUrl` is the configuration YouTrack (main settings).
 */
export function buildMigrationTargets(
  config: LegacyConfig,
  jira: JiraProfileSource,
  serverUrl: string,
  options: WorkspaceMigrationOptions,
): MigrationTargets {
  const targets: MigrationTarget[] = [];
  const migratedIds = new Set<string>();
  const usedBoards = new Set<string>();
  const seen = new Set<string>();

  for (const ws of config.workspaces) {
    const src = isObject(ws) ? ws : {};
    const id = typeof src.id === 'string' ? src.id : '';
    const name = typeof src.name === 'string' ? src.name : '';
    if (seen.has(id)) {
      targets.push(invalidTarget(id, name, 'youtrack', [{ path: 'workspaceId', code: 'duplicate', message: 'Another workspace in the configuration has the same ID.' }]));
      continue;
    }
    seen.add(id);

    const folders = Array.isArray(src.folders) ? src.folders : [];
    const projectIds = folders.flatMap((f) => (isObject(f) && Array.isArray(f.projectIds) ? f.projectIds : []));
    const boards: Record<string, BoardConfig> = {};
    for (const p of projectIds) {
      if (typeof p === 'string' && Object.prototype.hasOwnProperty.call(config.boards, p)) {
        boards[p] = config.boards[p] as BoardConfig;
      }
    }
    const dismissals: Dismissals = {};
    for (const [key, d] of Object.entries(config.dismissals)) {
      if (isObject(d) && d.workspace === id) dismissals[key] = d as unknown as Dismissals[string];
    }

    const doc = {
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId: id,
      name: src.name,
      order: src.order,
      backend: { kind: 'youtrack', serverUrl, credentialRef: MIGRATED_YOUTRACK_CREDENTIAL_REF },
      ai: { credentialRef: MIGRATED_ANTHROPIC_CREDENTIAL_REF },
      folders: src.folders,
      boards,
      dismissals,
    } as WorkspaceDocument;

    const target = finishDoc(doc, 'youtrack');
    if (target.kind === 'doc') {
      const d = target.document;
      const out: string[] = [];
      droppedPaths(src, { id: d.workspaceId, name: d.name, order: d.order, folders: d.folders }, '', out);
      for (const k of Object.keys(boards)) droppedPaths(config.boards[k], d.boards[k], `boards["${k}"]`, out);
      for (const k of Object.keys(dismissals)) droppedPaths(config.dismissals[k], d.dismissals[k], `dismissals["${k}"]`, out);
      target.notCarried = out;
      migratedIds.add(id);
      Object.keys(boards).forEach((k) => usedBoards.add(k));
    }
    targets.push(target);
  }

  if (jira.kind === 'profile' && typeof options.jiraWorkspaceName === 'string') {
    const workspaceId = jiraWorkspaceIdFor(jira.articleId) ?? '';
    const orders = targets.flatMap((t) => (t.kind === 'doc' ? [t.document.order] : []));
    const doc: WorkspaceDocument = {
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId,
      name: options.jiraWorkspaceName.trim(),
      order: orders.length ? Math.max(...orders) + 1 : 0,
      backend: { kind: 'jira', ...jira.profile, credentialRef: MIGRATED_JIRA_CREDENTIAL_REF },
      ai: { credentialRef: null },
      folders: [],
      boards: {},
      dismissals: {},
    };
    targets.push(finishDoc(doc, 'jira'));
  }

  return {
    targets,
    notMigrated: {
      boards: Object.keys(config.boards).filter((k) => !usedBoards.has(k)).sort(),
      dismissals: Object.entries(config.dismissals)
        .filter(([, d]) => !(isObject(d) && typeof d.workspace === 'string' && migratedIds.has(d.workspace)))
        .map(([k]) => k)
        .sort(),
    },
  };
}

/** Top-level fields where two documents differ. */
export function documentDifferences(a: WorkspaceDocument, b: WorkspaceDocument, eq: (x: unknown, y: unknown) => boolean): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof WorkspaceDocument>;
  return [...keys].filter((k) => !eq(a[k], b[k])).sort();
}
