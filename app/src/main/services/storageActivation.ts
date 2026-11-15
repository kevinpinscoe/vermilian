// Activation of per-workspace configuration storage, and the safe return to
// legacy storage (VERM-53, ADR-0011 §11; Kevin's decisions 2026-11-15).
//
// No Electron import: YouTrack, the local state file, the backup files and
// credential checks all come through ActivationDeps, so unit tests can run two
// "machines" against one in-memory YouTrack.
//
// Activation, in order — any failure stops it with _vermilian-config still
// authoritative and this machine's gate off:
//
//   1. This machine must be on legacy storage and the marker must be readable.
//      An active marker means another machine already activated: this machine
//      joins that activation instead (no migration; see joinActivation).
//   2. Read the sources (_vermilian-config, the Jira profile article) now.
//   3. Write a timestamped backup of both and verify it by reading it back.
//   4. Dry-run the migration. A conflict, ambiguity or invalid article stops
//      activation before anything is written.
//   5. Resolve every credential reference the migrated workspaces name, with
//      checkWorkspaceCredential — an actual resolution, never only source
//      discovery. Nothing is written before every one passes.
//   6. Apply the migration (VERM-44); it must report `complete: true`.
//   7. Re-read the sources: if either changed since the backup, stop.
//   8. Record every workspace article's stamp, then write the shared marker
//      (state active, a new generation) and verify it by reading it back.
//   9. Only then switch this machine's local state to per-workspace.
//
// Return to legacy storage is allowed only when nothing has changed since
// activation; otherwise it is refused and nothing changes (decision 4).

import {
  LEGACY_LOCAL_STATE,
  LOCAL_STORAGE_STATE_SCHEMA,
  STORAGE_MARKER_KIND,
  STORAGE_MARKER_SCHEMA,
  changesSinceActivation,
  describeChange,
  legacyChangedSinceActivation,
  markerFromArticles,
  parseStorageMarker,
  serialiseStorageMarker,
  storageWriteGuard,
  type ArticleStamp,
  type ConfigurationChange,
  type CurrentArticles,
  type LocalStorageState,
  type MarkerRead,
  type StorageGuard,
  type StorageMarker,
  type WorkspaceStorageMode,
  type ActivationResult,
  type RollbackResult,
} from '../../shared/storageActivation';
export type { ActivationResult, RollbackResult } from '../../shared/storageActivation';
import {
  CONFIG_ARTICLE_TITLE,
  JIRA_PROFILE_ARTICLE_TITLE,
  type WorkspaceMigrationOptions,
} from '../../shared/workspaceMigration';
import type { WorkspaceCredentialCheck } from '../../shared/ipc';
import type { WorkspaceDocument } from '../../shared/workspaceSchema';
import { listWorkspaceArticles, type WorkspaceArticleListing, type WorkspaceArticleRecord } from './workspaceArticles';
import { applyWorkspaceMigration, planWorkspaceMigration, type WorkspaceMigrationClient } from './workspaceMigration';

export interface StorageActivationClient extends WorkspaceMigrationClient {
  /** Every VERM article titled _vermilian-storage-activation — all pages. */
  listMarkers(): Promise<WorkspaceArticleListing>;
  createMarker(content: string): Promise<WorkspaceArticleRecord | null>;
}

export interface LocalStateIO {
  read(): Promise<{ state: LocalStorageState; corrupt: boolean }>;
  write(state: LocalStorageState): Promise<void>;
}

export interface BackupIO {
  /** Writes a new private file; returns its path, or null on failure. Never overwrites. */
  write(fileName: string, content: string): Promise<string | null>;
  read(filePath: string): Promise<string | null>;
}

export interface ActivationDeps {
  client: StorageActivationClient;
  serverUrl: string;
  local: LocalStateIO;
  backup: BackupIO;
  checkCredential(workspaceId: string, credentialRef: string): Promise<WorkspaceCredentialCheck>;
  now(): Date;
  newGeneration(): string;
}

export interface StorageStatus {
  local: LocalStorageState;
  localCorrupt: boolean;
  marker: MarkerRead;
  guard: StorageGuard;
  // Per-workspace mode with a verified marker: did _vermilian-config move
  // after activation (an older client may have written it)? null otherwise.
  legacyChangedSinceActivation: boolean | null;
}

const KEEP_LEGACY = ' _vermilian-config is still the configuration this machine uses.';

// ─── Shared reads ────────────────────────────────────────────────────────────

export async function readMarker(client: Pick<StorageActivationClient, 'listMarkers'>): Promise<MarkerRead> {
  const listing = await client.listMarkers();
  if (!listing.ok) {
    return {
      status: 'error',
      message: listing.reason === 'fetch-error'
        ? 'YouTrack did not return the storage activation marker.'
        : 'There are too many articles in the VERM project to be sure the storage activation marker was found.',
    };
  }
  return markerFromArticles(listing.articles);
}

interface SourceSnapshot {
  config: WorkspaceArticleRecord;
  jiraProfile: WorkspaceArticleRecord | null;
}

async function readSources(client: StorageActivationClient): Promise<{ ok: true; sources: SourceSnapshot } | { ok: false; message: string }> {
  const listing = await client.listSources();
  if (!listing.ok) return { ok: false, message: 'YouTrack did not return the configuration articles.' };
  const configs = listing.articles.filter((a) => a.summary === CONFIG_ARTICLE_TITLE);
  const jiras = listing.articles.filter((a) => a.summary === JIRA_PROFILE_ARTICLE_TITLE);
  if (configs.length !== 1) return { ok: false, message: `Expected exactly one ${CONFIG_ARTICLE_TITLE} article, found ${configs.length}.` };
  if (jiras.length > 1) return { ok: false, message: `Expected at most one Jira profile article, found ${jiras.length}.` };
  return { ok: true, sources: { config: configs[0], jiraProfile: jiras[0] ?? null } };
}

const stampOf = (r: WorkspaceArticleRecord): ArticleStamp => ({ articleId: r.id, updated: r.updated });
const sameRecord = (a: WorkspaceArticleRecord | null, b: WorkspaceArticleRecord | null) =>
  a === null || b === null ? a === b : a.id === b.id && a.updated === b.updated && a.content === b.content;

async function currentArticles(client: StorageActivationClient): Promise<{ ok: true; now: CurrentArticles } | { ok: false; message: string }> {
  const src = await client.listSources();
  if (!src.ok) return { ok: false, message: 'YouTrack did not return the configuration articles.' };
  const configs = src.articles.filter((a) => a.summary === CONFIG_ARTICLE_TITLE);
  const jiras = src.articles.filter((a) => a.summary === JIRA_PROFILE_ARTICLE_TITLE);
  const listed = await listWorkspaceArticles(client);
  if (!listed.ok) return { ok: false, message: listed.message };
  const workspaces: CurrentArticles['workspaces'] = {};
  for (const e of listed.workspaces) workspaces[e.workspaceId] = e.status === 'ok' ? { articleId: e.articleId, updated: e.updated } : null;
  return {
    ok: true,
    now: {
      config: configs.length === 1 ? stampOf(configs[0]) : null,
      jiraProfile: jiras.length === 1 ? stampOf(jiras[0]) : null,
      workspaces,
    },
  };
}

// ─── Write authorization ─────────────────────────────────────────────────────

/**
 * May this machine write configuration for `mode` right now?
 *
 * The marker is read from YouTrack on **every** call; nothing cached ever
 * authorizes a write (Kevin, 2026-11-15). A write for the other storage mode,
 * no configuration YouTrack, an unreadable local state file, and a marker that
 * is missing when it should exist, unreadable, duplicated, malformed, retired
 * or of another generation are all refused.
 *
 * Limitation: YouTrack has no compare-and-swap, so a marker change that lands
 * between this check and the write that follows it is not seen by that write.
 * The window is one YouTrack round trip; the next write is refused.
 */
export async function authorizeConfigWrite(
  mode: WorkspaceStorageMode,
  local: { state: LocalStorageState; corrupt: boolean },
  client: Pick<StorageActivationClient, 'listMarkers'> | null,
): Promise<StorageGuard> {
  if (!local.corrupt && local.state.mode !== mode) {
    return {
      allowed: false,
      reason: 'mode-mismatch',
      message: local.state.mode === 'per-workspace'
        ? 'This machine uses per-workspace configuration storage; the old shared configuration is not written.'
        : 'This machine still uses the old shared configuration; per-workspace configuration is not written.',
    };
  }
  if (!client) return { allowed: false, reason: 'not-configured', message: 'Connect YouTrack first — configuration is stored there.' };
  return storageWriteGuard(local.state, await readMarker(client), local.corrupt);
}

// ─── Status ──────────────────────────────────────────────────────────────────

export async function storageStatus(deps: Pick<ActivationDeps, 'client' | 'local'>): Promise<StorageStatus> {
  const { state: local, corrupt } = await deps.local.read();
  const marker = await readMarker(deps.client);
  const guard = storageWriteGuard(local, marker, corrupt);
  let legacyChanged: boolean | null = null;
  if (local.mode === 'per-workspace' && marker.status === 'ok' && marker.marker.state === 'active' && marker.marker.generation === local.generation) {
    const src = await readSources(deps.client);
    legacyChanged = src.ok ? legacyChangedSinceActivation(marker.marker, stampOf(src.sources.config)) : true;
  }
  return { local, localCorrupt: corrupt, marker, guard, legacyChangedSinceActivation: legacyChanged };
}

// ─── Backup ──────────────────────────────────────────────────────────────────

export interface ActivationBackup {
  kind: 'vermilian-storage-activation-backup';
  schema: 1;
  createdAt: string;
  articles: Array<{ role: 'config' | 'jira-profile'; articleId: string; updated: number; content: string }>;
}

function backupFileName(now: Date): string {
  return `activation-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

/** Write the backup and prove it reads back byte for byte. */
export async function writeVerifiedBackup(
  io: BackupIO,
  sources: SourceSnapshot,
  now: Date,
): Promise<{ ok: true; file: string } | { ok: false; message: string }> {
  const backup: ActivationBackup = {
    kind: 'vermilian-storage-activation-backup',
    schema: 1,
    createdAt: now.toISOString(),
    articles: [
      { role: 'config', articleId: sources.config.id, updated: sources.config.updated, content: sources.config.content },
      ...(sources.jiraProfile
        ? [{ role: 'jira-profile' as const, articleId: sources.jiraProfile.id, updated: sources.jiraProfile.updated, content: sources.jiraProfile.content }]
        : []),
    ],
  };
  const content = JSON.stringify(backup, null, 2);
  // Never overwrite: a retry within the same millisecond gets a suffix.
  let file: string | null = null;
  for (let n = 0; n < 5 && !file; n++) {
    file = await io.write(backupFileName(now).replace(/\.json$/, n ? `-${n}.json` : '.json'), content);
  }
  if (!file) return { ok: false, message: 'The backup of the configuration articles could not be written.' };
  const back = await io.read(file);
  if (back !== content) return { ok: false, message: `The backup ${file} did not read back exactly as written.` };
  return { ok: true, file };
}

/** Parse a backup file, for recovery. */
export function parseActivationBackup(raw: string): ActivationBackup | null {
  try {
    const v = JSON.parse(raw) as ActivationBackup;
    if (v?.kind !== 'vermilian-storage-activation-backup' || v.schema !== 1 || !Array.isArray(v.articles)) return null;
    if (!v.articles.every((a) => (a.role === 'config' || a.role === 'jira-profile') && typeof a.articleId === 'string' && typeof a.updated === 'number' && typeof a.content === 'string')) return null;
    return v;
  } catch {
    return null;
  }
}

// ─── Activation ──────────────────────────────────────────────────────────────

function refsToCheck(docs: WorkspaceDocument[]): Array<{ workspaceId: string; credentialRef: string }> {
  const seen = new Map<string, string>();
  for (const d of docs) {
    for (const ref of [d.backend.credentialRef, d.ai.credentialRef]) {
      if (ref && !seen.has(ref)) seen.set(ref, d.workspaceId);
    }
  }
  return [...seen].map(([credentialRef, workspaceId]) => ({ workspaceId, credentialRef }));
}

async function checkCredentials(
  deps: ActivationDeps,
  docs: WorkspaceDocument[],
): Promise<{ ok: true } | { ok: false; failures: WorkspaceCredentialCheck[] }> {
  const failures: WorkspaceCredentialCheck[] = [];
  for (const { workspaceId, credentialRef } of refsToCheck(docs)) {
    const r = await deps.checkCredential(workspaceId, credentialRef);
    if (!r.ok) failures.push(r);
  }
  return failures.length ? { ok: false, failures } : { ok: true };
}

function credentialMessage(failures: WorkspaceCredentialCheck[]): string {
  return (
    'A credential reference does not resolve on this machine, so nothing was written: ' +
    failures.map((f) => (f.ok ? '' : f.message)).join(' ') +
    KEEP_LEGACY
  );
}

export async function activateWorkspaceStorage(
  deps: ActivationDeps,
  options: WorkspaceMigrationOptions & { confirmed?: boolean } = {},
): Promise<ActivationResult> {
  if (options.confirmed !== true) {
    return { ok: false, reason: 'not-confirmed', message: 'Activation was not confirmed; nothing was done.' };
  }
  const { state: local, corrupt } = await deps.local.read();
  if (corrupt) {
    return { ok: false, reason: 'local-state-corrupt', message: 'This machine\'s workspace-storage.json cannot be read; follow the RUNBOOK recovery steps before activating.' };
  }
  if (local.mode === 'per-workspace') {
    return { ok: false, reason: 'already-active', message: 'Per-workspace storage is already active on this machine.' };
  }

  // 1. The marker decides between a first activation and joining one.
  const marker = await readMarker(deps.client);
  if (marker.status === 'error' || marker.status === 'ambiguous' || marker.status === 'invalid') {
    const guard = storageWriteGuard(local, marker);
    return { ok: false, reason: 'marker-unverified', message: guard.message + KEEP_LEGACY };
  }
  if (marker.status === 'ok' && marker.marker.state === 'active') return joinActivation(deps, marker.marker);

  // 2. Sources, now.
  const before = await readSources(deps.client);
  if (!before.ok) return { ok: false, reason: 'source-unreadable', message: before.message + ' Nothing was written.' + KEEP_LEGACY };

  // 3. Verified backup.
  const backup = await writeVerifiedBackup(deps.backup, before.sources, deps.now());
  if (!backup.ok) return { ok: false, reason: 'backup-failed', message: backup.message + ' Nothing was migrated.' + KEEP_LEGACY };
  const backupFile = backup.file;

  // 4. Dry run: anything that would stop the migration stops activation now.
  const planned = await planWorkspaceMigration(deps.client, deps.serverUrl, options);
  if (!planned.ok) return { ok: false, reason: 'migration-blocked', backupFile, message: planned.message + KEEP_LEGACY };
  const blocking = planned.items.filter((i) => i.action !== 'create' && i.action !== 'unchanged');
  const jiraBlocked = ['invalid', 'ambiguous', 'failed'].includes(planned.jiraProfile.status);
  if (blocking.length || jiraBlocked) {
    const why = [
      ...blocking.map((i) => i.message),
      ...(jiraBlocked && 'message' in planned.jiraProfile ? [planned.jiraProfile.message] : []),
    ];
    return {
      ok: false,
      reason: 'migration-blocked',
      backupFile,
      report: planned,
      message: `Migration cannot complete, so nothing was written: ${why.join(' ')}` + KEEP_LEGACY,
    };
  }

  // 5. Every credential reference must actually resolve here.
  const docs = planned.items.flatMap((i) => (i.document ? [i.document] : []));
  const creds = await checkCredentials(deps, docs);
  if (!creds.ok) {
    return { ok: false, reason: 'credential-failed', backupFile, report: planned, credentialFailures: creds.failures, message: credentialMessage(creds.failures) };
  }

  // 6. Migrate. Articles a failed run created are left in place (never
  // deleted) and found as `unchanged` by the next attempt.
  const applied = await applyWorkspaceMigration(deps.client, deps.serverUrl, options);
  if (!applied.ok) return { ok: false, reason: 'migration-incomplete', backupFile, message: applied.message + KEEP_LEGACY };
  if (!applied.complete) {
    const why = applied.items.filter((i) => i.action !== 'created' && i.action !== 'unchanged').map((i) => i.message);
    return {
      ok: false,
      reason: 'migration-incomplete',
      backupFile,
      report: applied,
      message: `Migration did not complete${why.length ? `: ${why.join(' ')}` : '.'} Any workspace articles it created are kept.` + KEEP_LEGACY,
    };
  }

  // 7. The sources must be exactly what was backed up and migrated.
  const after = await readSources(deps.client);
  if (!after.ok || !sameRecord(before.sources.config, after.sources.config) || !sameRecord(before.sources.jiraProfile, after.sources.jiraProfile)) {
    return {
      ok: false,
      reason: 'source-changed',
      backupFile,
      report: applied,
      message: 'The configuration changed while it was being migrated (another machine or an older Vermilian may have saved it). ' +
        'Activation stopped; run it again to migrate the current configuration.' + KEEP_LEGACY,
    };
  }

  // 8. Record the workspace articles, then the marker.
  const listed = await listWorkspaceArticles(deps.client);
  if (!listed.ok) return { ok: false, reason: 'workspaces-unverified', backupFile, report: applied, message: listed.message + KEEP_LEGACY };
  const bad = listed.workspaces.filter((e) => e.status !== 'ok');
  const missing = applied.items.filter((i) => !listed.workspaces.some((e) => e.status === 'ok' && e.workspaceId === i.workspaceId));
  if (bad.length || missing.length) {
    return {
      ok: false,
      reason: 'workspaces-unverified',
      backupFile,
      report: applied,
      message: [...bad.map((e) => ('message' in e ? e.message : '')), ...missing.map((i) => `Workspace ${i.workspaceId} could not be verified after migration.`)].join(' ') + KEEP_LEGACY,
    };
  }
  const workspaces: Record<string, ArticleStamp> = {};
  for (const e of listed.workspaces) if (e.status === 'ok') workspaces[e.workspaceId] = { articleId: e.articleId, updated: e.updated };

  const generation = deps.newGeneration();
  const next: StorageMarker = {
    schema: STORAGE_MARKER_SCHEMA,
    kind: STORAGE_MARKER_KIND,
    state: 'active',
    generation,
    sequence: marker.status === 'ok' ? marker.marker.sequence + 1 : 1,
    activatedAt: deps.now().toISOString(),
    retiredAt: null,
    sources: { config: stampOf(after.sources.config), jiraProfile: after.sources.jiraProfile ? stampOf(after.sources.jiraProfile) : null },
    workspaces,
  };
  const written = marker.status === 'ok'
    ? await replaceMarker(deps.client, marker, next)
    : await createMarker(deps.client, next);
  if (!written.ok) return { ok: false, reason: 'marker-write-failed', backupFile, report: applied, message: written.message };

  // 9. This machine switches last.
  try {
    await deps.local.write({ schema: LOCAL_STORAGE_STATE_SCHEMA, mode: 'per-workspace', generation, changedAt: deps.now().toISOString(), backupFile });
  } catch {
    return {
      ok: false,
      reason: 'local-write-failed',
      backupFile,
      report: applied,
      message: 'Per-workspace storage was activated, but this machine could not record the switch. Run activation again on this machine; it will join the activation.',
    };
  }
  return {
    ok: true,
    outcome: 'activated',
    generation,
    backupFile,
    report: applied,
    message: `Per-workspace storage is active. ${applied.items.length} workspace(s) migrated; _vermilian-config is kept unchanged. Backup: ${backupFile}.`,
  };
}

/** Another machine already activated: verify and join, without migrating. */
async function joinActivation(deps: ActivationDeps, marker: StorageMarker): Promise<ActivationResult> {
  const listed = await listWorkspaceArticles(deps.client);
  if (!listed.ok) return { ok: false, reason: 'workspaces-unverified', message: listed.message + KEEP_LEGACY };
  const bad = listed.workspaces.filter((e) => e.status !== 'ok');
  if (bad.length || listed.workspaces.length === 0) {
    return {
      ok: false,
      reason: 'workspaces-unverified',
      message: (bad.length ? bad.map((e) => ('message' in e ? e.message : '')).join(' ') : 'No workspace articles were found.') + KEEP_LEGACY,
    };
  }
  const docs = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
  const creds = await checkCredentials(deps, docs);
  if (!creds.ok) return { ok: false, reason: 'credential-failed', credentialFailures: creds.failures, message: credentialMessage(creds.failures) };
  // The marker may have moved while this ran.
  const again = await readMarker(deps.client);
  if (again.status !== 'ok' || again.marker.state !== 'active' || again.marker.generation !== marker.generation) {
    return { ok: false, reason: 'marker-unverified', message: 'The storage activation changed while this machine was joining it; try again.' + KEEP_LEGACY };
  }
  try {
    await deps.local.write({ schema: LOCAL_STORAGE_STATE_SCHEMA, mode: 'per-workspace', generation: marker.generation, changedAt: deps.now().toISOString(), backupFile: null });
  } catch {
    return { ok: false, reason: 'local-write-failed', message: 'This machine could not record the switch to per-workspace storage.' + KEEP_LEGACY };
  }
  return {
    ok: true,
    outcome: 'joined',
    generation: marker.generation,
    backupFile: null,
    report: null,
    message: 'This machine now uses per-workspace storage, joining the activation made on another machine.',
  };
}

// ─── Marker writes (verified) ────────────────────────────────────────────────

async function createMarker(client: StorageActivationClient, next: StorageMarker): Promise<{ ok: true } | { ok: false; message: string }> {
  const created = await client.createMarker(serialiseStorageMarker(next));
  if (!created) return { ok: false, message: 'YouTrack did not create the storage activation marker. This machine stays on _vermilian-config.' };
  const check = await readMarker(client);
  if (check.status === 'ok' && check.articleId === created.id && check.marker.generation === next.generation && check.marker.state === 'active') {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      `The storage activation marker (${created.id}) was created but could not be verified` +
      (check.status === 'ambiguous' ? ` — there are now ${check.articleIds.length} marker articles` : '') +
      '. Configuration writes on every machine are blocked until it is resolved; see the RUNBOOK.',
  };
}

async function replaceMarker(
  client: StorageActivationClient,
  current: Extract<MarkerRead, { status: 'ok' }>,
  next: StorageMarker,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const latest = await client.get(current.articleId);
  if (!latest || latest.updated !== current.updated) {
    return { ok: false, message: 'The storage activation marker changed while it was being updated; nothing was changed. Try again.' };
  }
  const written = await client.update(current.articleId, serialiseStorageMarker(next));
  if (!written) return { ok: false, message: 'YouTrack did not accept the update to the storage activation marker; nothing was changed.' };
  const back = await client.get(current.articleId);
  const parsed = back ? parseStorageMarker(back.content) : null;
  if (parsed?.ok && parsed.marker.generation === next.generation && parsed.marker.sequence === next.sequence && parsed.marker.state === next.state) {
    return { ok: true };
  }
  return { ok: false, message: 'The storage activation marker could not be verified after it was written; another machine may have written it at the same time. See the RUNBOOK.' };
}

// ─── Return to legacy storage ────────────────────────────────────────────────

export async function returnToLegacyStorage(deps: ActivationDeps, options: { confirmed?: boolean } = {}): Promise<RollbackResult> {
  if (options.confirmed !== true) return { ok: false, reason: 'not-confirmed', message: 'Returning to legacy storage was not confirmed; nothing was done.' };
  const { state: local, corrupt } = await deps.local.read();
  if (corrupt) return { ok: false, reason: 'local-state-corrupt', message: 'This machine\'s workspace-storage.json cannot be read; follow the RUNBOOK recovery steps.' };
  if (local.mode !== 'per-workspace') return { ok: false, reason: 'not-active', message: 'This machine already uses _vermilian-config.' };

  const marker = await readMarker(deps.client);
  if (marker.status === 'error' || marker.status === 'ambiguous' || marker.status === 'invalid') {
    return { ok: false, reason: 'marker-unverified', message: storageWriteGuard(local, marker).message + ' Nothing was changed.' };
  }

  const toLegacy = async (outcome: 'returned' | 'local-only', message: string): Promise<RollbackResult> => {
    try {
      await deps.local.write({ ...LEGACY_LOCAL_STATE, changedAt: deps.now().toISOString() });
    } catch {
      return { ok: false, reason: 'local-write-failed', message: 'This machine could not record the return to _vermilian-config. See the RUNBOOK.' };
    }
    return { ok: true, outcome, message };
  };

  // The activation this machine joined is already retired or replaced: this
  // machine cannot write in its current mode, so returning locally hides nothing.
  if (marker.status === 'none' || marker.marker.state === 'retired' || marker.marker.generation !== local.generation) {
    const superseded = marker.status === 'ok' && marker.marker.state === 'active';
    return toLegacy(
      'local-only',
      superseded
        ? 'This machine is back on _vermilian-config. Per-workspace storage is still active from a newer activation on another machine; activate again here to join it.'
        : 'This machine is back on _vermilian-config, matching the other machines.',
    );
  }

  // The activation this machine is part of: only when nothing has changed.
  const unsafe = await rollbackChanges(deps.client, marker.marker);
  if (!unsafe.ok) return { ok: false, reason: 'marker-unverified', message: unsafe.message + ' Nothing was changed.' };
  if (unsafe.changes.length) return refuse(unsafe.changes);

  const retired: StorageMarker = { ...marker.marker, state: 'retired', sequence: marker.marker.sequence + 1, retiredAt: deps.now().toISOString() };
  const written = await replaceMarker(deps.client, marker, retired);
  if (!written.ok) return { ok: false, reason: 'marker-write-failed', message: written.message };

  // A change that slipped in between the check and the retire: put the
  // activation back exactly as it was (a newer sequence), and refuse.
  const recheck = await rollbackChanges(deps.client, marker.marker);
  if (!recheck.ok || recheck.changes.length) {
    const fresh = await readMarker(deps.client);
    if (fresh.status === 'ok') await replaceMarker(deps.client, fresh, { ...marker.marker, sequence: retired.sequence + 1 });
    return recheck.ok ? refuse(recheck.changes) : { ok: false, reason: 'marker-unverified', message: recheck.message + ' The activation was restored.' };
  }

  return toLegacy('returned', 'Per-workspace storage was retired and this machine is back on _vermilian-config. The workspace articles are kept. Other machines will block configuration changes until they are returned too.');
}

async function rollbackChanges(client: StorageActivationClient, marker: StorageMarker): Promise<{ ok: true; changes: ConfigurationChange[] } | { ok: false; message: string }> {
  const now = await currentArticles(client);
  if (!now.ok) return { ok: false, message: now.message };
  return { ok: true, changes: changesSinceActivation(marker, now.now) };
}

function refuse(changes: ConfigurationChange[]): RollbackResult {
  return {
    ok: false,
    reason: 'unsafe',
    changes,
    message:
      'Returning to _vermilian-config would hide configuration changed since activation: ' +
      changes.map(describeChange).join('; ') +
      '. Nothing was changed. Follow the manual reconciliation procedure in the RUNBOOK.',
  };
}
