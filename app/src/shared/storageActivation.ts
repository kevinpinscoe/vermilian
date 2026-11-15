// Activation of per-workspace configuration storage (VERM-53, ADR-0011 §11):
// the shared activation marker, this machine's local storage state, the write
// guard both storage modes obey, and the rollback-safety rule.
//
// Two pieces of state decide where configuration is read and written:
//
//   local state   userData/workspace-storage.json, per machine. Says whether
//                 this machine reads the legacy _vermilian-config article or
//                 the per-workspace _vermilian-ws-<id> articles, and which
//                 activation (generation) it joined.
//   marker        the _vermilian-storage-activation article in the VERM
//                 project, shared by every machine. Says whether per-workspace
//                 storage is active, under which generation, and what the
//                 sources and workspace articles looked like at activation.
//
// _vermilian-config is never written by activation or rollback (ADR-0011
// §11), so the marker is a separate article. Vermilian v1.2.10 and older
// never read the marker and cannot be stopped by it: their writes to
// _vermilian-config are detected afterwards (legacyChangedSinceActivation),
// not prevented.
//
// Every write to configuration — legacy or per-workspace — asks
// storageWriteGuard first. Anything it cannot verify is refused: it fails
// closed (Kevin, 2026-11-15).
//
// Pure TypeScript: no Electron, no React.

import { findSecretShapedValues } from './workspaceSchema';
import type { WorkspaceMigrationReport } from './workspaceMigration';
import type { WorkspaceCredentialCheck } from './ipc';

export const STORAGE_MARKER_TITLE = '_vermilian-storage-activation';
export const STORAGE_MARKER_KIND = 'vermilian-storage-activation';
export const STORAGE_MARKER_SCHEMA = 1;
export const LOCAL_STORAGE_STATE_SCHEMA = 1;

export type WorkspaceStorageMode = 'legacy' | 'per-workspace';

/** An article's identity and version at one moment. */
export interface ArticleStamp {
  articleId: string;
  updated: number;
}

export interface StorageMarker {
  schema: typeof STORAGE_MARKER_SCHEMA;
  kind: typeof STORAGE_MARKER_KIND;
  state: 'active' | 'retired';
  // A fresh random ID for every activation. A machine that joined an older
  // generation is superseded when a newer one is written.
  generation: string;
  // Bumped on every marker write, so a concurrent write is detectable even
  // within one generation.
  sequence: number;
  activatedAt: string; // ISO 8601
  retiredAt: string | null;
  // The sources as activation re-read them just before switching.
  sources: { config: ArticleStamp; jiraProfile: ArticleStamp | null };
  // Every workspace article as it stood when activation finished, keyed by
  // workspace ID. Rollback compares against this.
  workspaces: Record<string, ArticleStamp>;
}

export interface LocalStorageState {
  schema: typeof LOCAL_STORAGE_STATE_SCHEMA;
  mode: WorkspaceStorageMode;
  generation: string | null; // the activation this machine joined; null in legacy mode
  changedAt: string | null; // ISO 8601
  backupFile: string | null; // the activation backup this machine wrote, if any
}

export const LEGACY_LOCAL_STATE: LocalStorageState = {
  schema: LOCAL_STORAGE_STATE_SCHEMA,
  mode: 'legacy',
  generation: null,
  changedAt: null,
  backupFile: null,
};

// ─── Parsing ─────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is ArticleStamp =>
  isObject(v) && typeof v.articleId === 'string' && v.articleId !== '' && typeof v.updated === 'number' && Number.isFinite(v.updated);
const GENERATION_RE = /^[A-Za-z0-9-]{8,64}$/;

export function isGeneration(v: unknown): v is string {
  return typeof v === 'string' && GENERATION_RE.test(v);
}

const stripFence = (raw: string) => raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

export type MarkerParseResult = { ok: true; marker: StorageMarker } | { ok: false; message: string };

/** Strict: anything not exactly a marker this version understands is refused. */
export function parseStorageMarker(raw: string): MarkerParseResult {
  let v: unknown;
  try {
    v = JSON.parse(stripFence(raw));
  } catch {
    return { ok: false, message: 'The storage activation marker is not valid JSON.' };
  }
  if (!isObject(v) || v.kind !== STORAGE_MARKER_KIND) {
    return { ok: false, message: 'The storage activation marker is not a Vermilian marker.' };
  }
  if (v.schema !== STORAGE_MARKER_SCHEMA) {
    return { ok: false, message: `The storage activation marker has schema ${String(v.schema)}; this version reads schema ${STORAGE_MARKER_SCHEMA} only.` };
  }
  if (findSecretShapedValues(v).length > 0) {
    return { ok: false, message: 'The storage activation marker contains a secret-shaped value and cannot be used.' };
  }
  const sources = v.sources;
  const workspaces = v.workspaces;
  const ok =
    (v.state === 'active' || v.state === 'retired') &&
    isGeneration(v.generation) &&
    typeof v.sequence === 'number' && Number.isInteger(v.sequence) && v.sequence >= 1 &&
    typeof v.activatedAt === 'string' &&
    (v.retiredAt === null || typeof v.retiredAt === 'string') &&
    isObject(sources) && isStamp(sources.config) && (sources.jiraProfile === null || isStamp(sources.jiraProfile)) &&
    isObject(workspaces) && Object.values(workspaces).every(isStamp);
  if (!ok) return { ok: false, message: 'The storage activation marker is malformed.' };
  return {
    ok: true,
    marker: {
      schema: STORAGE_MARKER_SCHEMA,
      kind: STORAGE_MARKER_KIND,
      state: v.state as StorageMarker['state'],
      generation: v.generation as string,
      sequence: v.sequence as number,
      activatedAt: v.activatedAt as string,
      retiredAt: v.retiredAt as string | null,
      sources: {
        config: { ...(sources as { config: ArticleStamp }).config },
        jiraProfile: (sources as { jiraProfile: ArticleStamp | null }).jiraProfile
          ? { ...(sources as { jiraProfile: ArticleStamp }).jiraProfile }
          : null,
      },
      workspaces: Object.fromEntries(Object.entries(workspaces as Record<string, ArticleStamp>).map(([k, s]) => [k, { articleId: s.articleId, updated: s.updated }])),
    },
  };
}

export function serialiseStorageMarker(m: StorageMarker): string {
  return '```json\n' + JSON.stringify(m, null, 2) + '\n```';
}

/** A missing, unreadable or malformed file is legacy; `corrupt` says which. */
export function parseLocalStorageState(raw: string | null): { state: LocalStorageState; corrupt: boolean } {
  if (raw === null) return { state: LEGACY_LOCAL_STATE, corrupt: false };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { state: LEGACY_LOCAL_STATE, corrupt: true };
  }
  if (!isObject(v) || v.schema !== LOCAL_STORAGE_STATE_SCHEMA) return { state: LEGACY_LOCAL_STATE, corrupt: true };
  if (v.mode === 'legacy') {
    return { state: { ...LEGACY_LOCAL_STATE, changedAt: typeof v.changedAt === 'string' ? v.changedAt : null }, corrupt: false };
  }
  if (v.mode === 'per-workspace' && isGeneration(v.generation)) {
    return {
      state: {
        schema: LOCAL_STORAGE_STATE_SCHEMA,
        mode: 'per-workspace',
        generation: v.generation,
        changedAt: typeof v.changedAt === 'string' ? v.changedAt : null,
        backupFile: typeof v.backupFile === 'string' ? v.backupFile : null,
      },
      corrupt: false,
    };
  }
  return { state: LEGACY_LOCAL_STATE, corrupt: true };
}

// ─── Reading the marker ──────────────────────────────────────────────────────

/** What a read of the marker article found. Only `none` and `ok` are verified. */
export type MarkerRead =
  | { status: 'none' }
  | { status: 'ok'; articleId: string; updated: number; marker: StorageMarker }
  | { status: 'ambiguous'; articleIds: string[] }
  | { status: 'invalid'; articleId: string; message: string }
  | { status: 'error'; message: string };

export function markerFromArticles(articles: ReadonlyArray<{ id: string; summary: string; content: string; updated: number }>): MarkerRead {
  const found = articles.filter((a) => a.summary === STORAGE_MARKER_TITLE);
  if (found.length === 0) return { status: 'none' };
  if (found.length > 1) return { status: 'ambiguous', articleIds: found.map((a) => a.id).sort() };
  const parsed = parseStorageMarker(found[0].content);
  if (!parsed.ok) return { status: 'invalid', articleId: found[0].id, message: parsed.message };
  return { status: 'ok', articleId: found[0].id, updated: found[0].updated, marker: parsed.marker };
}

// ─── The write guard ─────────────────────────────────────────────────────────

export type StorageGuardReason =
  | 'ok'
  | 'marker-unverified' // the marker could not be read, is ambiguous or is malformed
  | 'local-state-corrupt' // this machine's storage file could not be read
  | 'activated-elsewhere' // legacy here, but per-workspace storage is active
  | 'retired-elsewhere' // per-workspace here, but the activation was retired
  | 'superseded' // per-workspace here, under an older generation
  | 'mode-mismatch' // a write for the other storage mode than this machine uses
  | 'not-configured'; // no configuration YouTrack to check the marker against

export interface StorageGuard {
  allowed: boolean;
  reason: StorageGuardReason;
  message: string;
}

const MARKER_UNVERIFIED =
  'Vermilian could not verify which configuration storage is active, so configuration changes are not being saved. ';

/** May this machine write configuration in its current storage mode? */
export function storageWriteGuard(local: LocalStorageState, read: MarkerRead, localCorrupt = false): StorageGuard {
  if (localCorrupt) {
    return {
      allowed: false,
      reason: 'local-state-corrupt',
      message: 'This machine\'s workspace storage setting (workspace-storage.json) cannot be read, so configuration changes are not being saved. See the RUNBOOK recovery steps.',
    };
  }
  if (read.status === 'error') return { allowed: false, reason: 'marker-unverified', message: MARKER_UNVERIFIED + read.message };
  if (read.status === 'ambiguous') {
    return {
      allowed: false,
      reason: 'marker-unverified',
      message: MARKER_UNVERIFIED + `There are ${read.articleIds.length} ${STORAGE_MARKER_TITLE} articles (${read.articleIds.join(', ')}).`,
    };
  }
  if (read.status === 'invalid') return { allowed: false, reason: 'marker-unverified', message: MARKER_UNVERIFIED + read.message };

  const marker = read.status === 'ok' ? read.marker : null;
  const active = marker?.state === 'active';

  if (local.mode === 'legacy') {
    if (!active) return { allowed: true, reason: 'ok', message: '' };
    return {
      allowed: false,
      reason: 'activated-elsewhere',
      message:
        'Per-workspace configuration storage has been activated on another machine. This machine still uses the old shared ' +
        'configuration, so its configuration changes are not being saved. Activate per-workspace storage on this machine in Settings.',
    };
  }

  if (!marker || marker.state === 'retired') {
    return {
      allowed: false,
      reason: 'retired-elsewhere',
      message:
        'Per-workspace configuration storage was returned to the old shared configuration on another machine. Configuration ' +
        'changes on this machine are not being saved until it is returned too, in Settings.',
    };
  }
  if (marker.generation !== local.generation) {
    return {
      allowed: false,
      reason: 'superseded',
      message:
        'Per-workspace configuration storage was activated again on another machine since this machine joined. Configuration ' +
        'changes on this machine are not being saved until it is reconciled in Settings.',
    };
  }
  return { allowed: true, reason: 'ok', message: '' };
}

// ─── Changes since activation ────────────────────────────────────────────────

/** Whether the legacy article moved after activation — an older client may have written it. */
export function legacyChangedSinceActivation(marker: StorageMarker, current: ArticleStamp | null): boolean {
  if (!current) return true;
  return current.articleId !== marker.sources.config.articleId || current.updated !== marker.sources.config.updated;
}

export interface ConfigurationChange {
  kind: 'workspace-changed' | 'workspace-added' | 'workspace-removed' | 'workspace-unreadable' | 'legacy-changed' | 'jira-profile-changed';
  workspaceId?: string;
  articleId?: string;
}

export interface CurrentArticles {
  config: ArticleStamp | null;
  jiraProfile: ArticleStamp | null;
  // Every workspace ID discovery found; null stamp when its article is
  // ambiguous or unreadable.
  workspaces: Record<string, ArticleStamp | null>;
}

/** Everything that differs from the state recorded at activation. Empty means no change. */
export function changesSinceActivation(marker: StorageMarker, now: CurrentArticles): ConfigurationChange[] {
  const out: ConfigurationChange[] = [];
  for (const [workspaceId, was] of Object.entries(marker.workspaces)) {
    if (!(workspaceId in now.workspaces)) {
      out.push({ kind: 'workspace-removed', workspaceId, articleId: was.articleId });
      continue;
    }
    const is = now.workspaces[workspaceId];
    if (!is) out.push({ kind: 'workspace-unreadable', workspaceId });
    else if (is.articleId !== was.articleId || is.updated !== was.updated) out.push({ kind: 'workspace-changed', workspaceId, articleId: is.articleId });
  }
  for (const [workspaceId, is] of Object.entries(now.workspaces)) {
    if (!(workspaceId in marker.workspaces)) out.push({ kind: 'workspace-added', workspaceId, ...(is ? { articleId: is.articleId } : {}) });
  }
  if (legacyChangedSinceActivation(marker, now.config)) out.push({ kind: 'legacy-changed', ...(now.config ? { articleId: now.config.articleId } : {}) });
  const wasJira = marker.sources.jiraProfile;
  const isJira = now.jiraProfile;
  if ((wasJira === null) !== (isJira === null) || (wasJira && isJira && (wasJira.articleId !== isJira.articleId || wasJira.updated !== isJira.updated))) {
    out.push({ kind: 'jira-profile-changed', ...(isJira ? { articleId: isJira.articleId } : {}) });
  }
  return out;
}

export function describeChange(c: ConfigurationChange): string {
  switch (c.kind) {
    case 'workspace-changed':
      return `workspace ${c.workspaceId} was changed`;
    case 'workspace-added':
      return `workspace ${c.workspaceId} was added`;
    case 'workspace-removed':
      return `workspace ${c.workspaceId}'s article is gone`;
    case 'workspace-unreadable':
      return `workspace ${c.workspaceId}'s article cannot be read`;
    case 'legacy-changed':
      return 'the old shared configuration (_vermilian-config) was changed, possibly by an older Vermilian';
    case 'jira-profile-changed':
      return 'the Jira profile article was changed';
  }
}

// ─── Results (cross IPC; plain data, no secrets) ─────────────────────────────

export type ActivationFailureReason =
  | 'not-confirmed'
  | 'already-active'
  | 'local-state-corrupt'
  | 'marker-unverified'
  | 'source-unreadable'
  | 'backup-failed'
  | 'migration-blocked'
  | 'credential-failed'
  | 'migration-incomplete'
  | 'source-changed'
  | 'workspaces-unverified'
  | 'marker-write-failed'
  | 'local-write-failed';

export type ActivationResult =
  | {
      ok: true;
      outcome: 'activated' | 'joined';
      generation: string;
      backupFile: string | null;
      report: WorkspaceMigrationReport | null;
      message: string;
    }
  | {
      ok: false;
      reason: ActivationFailureReason;
      message: string;
      backupFile?: string;
      report?: WorkspaceMigrationReport;
      credentialFailures?: WorkspaceCredentialCheck[];
    };

export type RollbackFailureReason =
  | 'not-confirmed'
  | 'not-active'
  | 'local-state-corrupt'
  | 'marker-unverified'
  | 'unsafe'
  | 'marker-write-failed'
  | 'local-write-failed';

export type RollbackResult =
  | { ok: true; outcome: 'returned' | 'local-only'; message: string }
  | { ok: false; reason: RollbackFailureReason; message: string; changes?: ConfigurationChange[] };


/** What Settings shows about configuration storage on this machine. */
export interface StorageStatusView {
  mode: WorkspaceStorageMode;
  generation: string | null;
  localCorrupt: boolean;
  backupFile: string | null;
  marker: 'none' | 'active' | 'retired' | 'unverified';
  markerGeneration: string | null;
  activatedAt: string | null;
  guard: StorageGuard;
  legacyChangedSinceActivation: boolean | null;
}
