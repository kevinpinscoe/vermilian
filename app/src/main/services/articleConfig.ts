// Singleton service that owns the _vermilian-config Article.
// Reads on first use; writes are debounced 1.5s.  Falls back to local
// workspace-config.json if the Article is unavailable.

import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArticleFullConfig, BoardConfig, Dismissals, NotThisWeekDismissal } from '../../shared/boardConfig';
import {
  emptyArticleConfig,
  ARTICLE_CONFIG_VERSION,
  defaultBoardConfig,
  dismissalKey,
} from '../../shared/boardConfig';
import {
  parseArticleConfig,
  serialiseArticleConfig,
  mergeRemoteConfig,
} from '../../shared/articleCodec';
import type { VermilianConfig } from '../../shared/workspace';
import type { ConfigSyncStatus } from '../../shared/ipc';
import { youtrack as yt } from '../api/client';
import type { VermilianArticle } from '../api/youtrack';

// ─── Status notifier (set by ipc.ts to broadcast to renderer windows) ─────────

type StatusNotifier = (status: ConfigSyncStatus) => void;
let notify: StatusNotifier = () => { /* no-op until wired */ };

export function setStatusNotifier(fn: StatusNotifier): void {
  notify = fn;
}

// ─── Storage guard (VERM-53) ─────────────────────────────────────────────────
// Every remote write of _vermilian-config asks first. The guard refuses when
// this machine uses per-workspace storage, when per-workspace storage is
// active elsewhere, or when the activation marker cannot be verified. A
// refused write is not sent and not retried; the edit stays in the local
// cache only, and the renderer is told why.

export type LegacyWriteGuard = () => Promise<{ allowed: boolean; message: string }>;
let writeGuard: LegacyWriteGuard = async () => ({ allowed: false, message: 'Configuration storage has not been checked yet.' });

export function setWriteGuard(fn: LegacyWriteGuard): void {
  writeGuard = fn;
}

// ─── Persistent article ID cache ─────────────────────────────────────────────

function articleIdFile(): string {
  return path.join(app.getPath('userData'), 'article-config-id.txt');
}

async function loadCachedArticleId(): Promise<string | null> {
  try {
    return (await fs.readFile(articleIdFile(), 'utf-8')).trim() || null;
  } catch {
    return null;
  }
}

async function saveCachedArticleId(id: string): Promise<void> {
  await fs.writeFile(articleIdFile(), id, 'utf-8');
}

// ─── Module-level state (singleton in main process) ──────────────────────────

let cache: ArticleFullConfig | null = null;
let articleId: string | null = null;
let lastReadUpdated = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let loadPromise: Promise<void> | null = null;

// Write-failure backoff state. A failed remote write retries with exponential
// backoff (2s → 30s cap) until it succeeds; the renderer is told once on the
// first failure and once on recovery so it can show / clear a single toast.
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 0;
let writeHadFailure = false;

// Unsaved-edit tracking (VERM-53 review). Every local edit bumps `revision`;
// `savedRevision` is the newest revision a write has *verified* in YouTrack
// (written, then read back identical). The cache has unsaved edits exactly
// when the two differ — whether a save is debounced, retrying, in flight or
// was refused.
let revision = 0;
let savedRevision = 0;
const hasUnsavedEdits = () => revision !== savedRevision;

// Writes run one at a time, in order: an overlapping save waits for the one
// in flight instead of interleaving with it.
let writeChain: Promise<unknown> = Promise.resolve();

// While activation of per-workspace storage runs, edits to the shared article
// are refused and no save or retry is started, so nothing can change
// _vermilian-config after the final verified flush (VERM-53 review).
let frozen = false;
export const ACTIVATION_IN_PROGRESS_MESSAGE =
  'Per-workspace storage is being activated; configuration changes are paused until it finishes.';

export function isFrozenForActivation(): boolean {
  return frozen;
}

// Parse / serialise / merge live in shared/articleCodec.ts so they can be
// unit-tested without Electron.

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function load(url: string, token: string): Promise<void> {
  if (loadPromise) { await loadPromise; return; }
  loadPromise = _load(url, token).finally(() => { loadPromise = null; });
  await loadPromise;
}

async function _load(url: string, token: string): Promise<void> {
  if (!url || !token) return;

  // Try cached ID first — avoids listing all articles on every startup.
  articleId = await loadCachedArticleId();

  let article: VermilianArticle | null = null;

  if (articleId) {
    article = await yt.getVermilianArticle(url, token, articleId);
    if (!article) {
      // Article was deleted or ID is stale; clear and re-search.
      articleId = null;
    }
  }

  if (!article) {
    article = await yt.findVermilianArticle(url, token);
  }

  if (!article && (await writeGuard()).allowed) {
    // First run — create the Article (never once per-workspace storage is in play).
    article = await yt.createVermilianArticle(url, token, serialiseArticleConfig(emptyArticleConfig()));
  }

  if (!article) return; // YouTrack Articles API unavailable — run with local cache only

  articleId = article.id;
  lastReadUpdated = article.updated;
  await saveCachedArticleId(articleId);

  const parsed = parseArticleConfig(article.content);

  // Version guard
  if (parsed.version > ARTICLE_CONFIG_VERSION) {
    // Refuse to cache a config newer than this client understands, and tell the
    // renderer so it can warn the user. (Caller also receives the throw.)
    cache = null;
    notify({ kind: 'version-too-high', version: parsed.version });
    throw new Error(`CONFIG_VERSION_TOO_HIGH:${parsed.version}`);
  }

  cache = parsed;
  savedRevision = revision; // what was just read is what YouTrack holds
}

// ─── Get helpers ─────────────────────────────────────────────────────────────

export function getCachedConfig(): ArticleFullConfig | null {
  return cache;
}

export function getBoardConfig(projectId: string): BoardConfig {
  return cache?.boards[projectId] ?? defaultBoardConfig(projectId);
}

export function getWorkspaceConfig(): VermilianConfig | null {
  if (!cache || !cache.workspaces.length) return null;
  return {
    version: 1,
    workspaces: cache.workspaces,
    activeWorkspaceId: cache.activeWorkspaceId,
  };
}

export function getDismissals(): Dismissals {
  return cache?.dismissals ?? {};
}

// ─── Wait / force-reload ─────────────────────────────────────────────────────

// Blocks until the Article has loaded (or a bounded timeout elapses) instead
// of letting a caller read a not-yet-hydrated `cache` and fall back to a
// possibly-stale local file. Serving that stale fallback to the renderer is
// what let one machine's pre-rebuild project ids get echoed back through a
// later save and clobber the shared Article — see RUNBOOK.md.
export async function waitForLoad(url: string, token: string, timeoutMs = 5000): Promise<void> {
  if (cache) return;
  await Promise.race([
    load(url, token),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

// Discards the in-memory cache and article-id and re-fetches from scratch.
// Used by the "Force resync from server" Settings action to recover from a
// corrupted Article without requiring manual API surgery.
export async function forceReload(url: string, token: string): Promise<VermilianConfig | null> {
  cache = null;
  articleId = null;
  lastReadUpdated = 0;
  savedRevision = revision; // local edits are discarded on purpose
  await load(url, token);
  return getWorkspaceConfig();
}

// ─── Update helpers ──────────────────────────────────────────────────────────

// Each edit returns false, changing nothing, while activation is in progress.

export function updateBoardConfig(config: BoardConfig): boolean {
  if (frozen) return false;
  if (!cache) cache = emptyArticleConfig();
  cache = { ...cache, boards: { ...cache.boards, [config.boardId]: config } };
  revision++;
  return true;
}

export function removeBoardConfig(projectId: string): boolean {
  if (frozen) return false;
  if (!cache) return true;
  const boards = { ...cache.boards };
  delete boards[projectId];
  cache = { ...cache, boards };
  revision++;
  return true;
}

// The active workspace is per-machine (VERM-46, ADR-0011 §2) and lives in
// userData/active-workspace.json. The article's activeWorkspaceId is kept as
// it is — never taken from the caller — so switching on one machine cannot
// move another, and older clients still find the value they expect.
export function updateWorkspaceConfig(wsConfig: VermilianConfig): boolean {
  if (frozen) return false;
  if (!cache) cache = emptyArticleConfig();
  cache = {
    ...cache,
    workspaces: wsConfig.workspaces,
  };
  revision++;
  return true;
}

export function setDismissal(entry: NotThisWeekDismissal): boolean {
  if (frozen) return false;
  if (!cache) cache = emptyArticleConfig();
  const key = dismissalKey(entry.workspace, entry.issueId);
  cache = { ...cache, dismissals: { ...cache.dismissals, [key]: entry } };
  revision++;
  return true;
}

// ─── Debounced write ─────────────────────────────────────────────────────────

export function scheduleSave(url: string, token: string): void {
  if (frozen) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void _write(url, token);
  }, 1500);
}

export type WriteOutcome =
  | { kind: 'written' } // sent and read back identical
  | { kind: 'clean' } // no unsaved edits: nothing sent
  | { kind: 'blocked'; message: string } // the storage guard refused it
  | { kind: 'failed'; message: string }; // not accepted, or not verified

// Queue a write behind any write already running.
function _write(url: string, token: string): Promise<WriteOutcome> {
  const next = writeChain.then(() => doWrite(url, token));
  writeChain = next.catch(() => undefined);
  return next;
}

// Same document, ignoring formatting: YouTrack may store whitespace differently.
function sameContent(a: string, b: string): boolean {
  if (a === b) return true;
  const strip = (x: string) => x.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.stringify(JSON.parse(strip(a))) === JSON.stringify(JSON.parse(strip(b)));
  } catch {
    return false;
  }
}

async function doWrite(url: string, token: string): Promise<WriteOutcome> {
  if (!hasUnsavedEdits()) return { kind: 'clean' };
  if (!cache || !url || !token) return { kind: 'failed', message: 'YouTrack is not configured, so the configuration could not be saved.' };

  const guard = await writeGuard();
  if (!guard.allowed) {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    retryDelay = 0;
    notify({ kind: 'storage-blocked', message: guard.message });
    return { kind: 'blocked', message: guard.message };
  }

  // The newest edit this write carries; edits made while it runs stay unsaved.
  const writing = revision;

  // Stale-write check: if the Article was updated by another machine, refetch.
  if (articleId) {
    const current = await yt.getVermilianArticle(url, token, articleId);
    if (current && current.updated > lastReadUpdated) {
      // Another machine wrote; merge theirs as base, overlay our boards.
      const remote = parseArticleConfig(current.content);
      cache = mergeRemoteConfig(remote, cache);
      lastReadUpdated = current.updated;
      notify({ kind: 'remote-newer' });
    }
  }

  const content = serialiseArticleConfig(cache);

  let written: { id: string; updated: number } | null = null;
  if (articleId) {
    const result = await yt.updateVermilianArticle(url, token, articleId, content);
    if (result) written = { id: articleId, updated: result.updated };
  } else {
    const created = await yt.createVermilianArticle(url, token, content);
    if (created) {
      articleId = created.id;
      await saveCachedArticleId(articleId);
      written = { id: created.id, updated: created.updated };
    }
  }

  // Positive confirmation: read it back and compare.
  let verified = false;
  if (written) {
    const back = await yt.getVermilianArticle(url, token, written.id);
    verified = !!back && sameContent(back.content, content);
    if (back) lastReadUpdated = back.updated;
  }

  if (verified) {
    savedRevision = Math.max(savedRevision, writing);
    // Recovered after a prior failure — clear backoff and tell the renderer.
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    retryDelay = 0;
    if (writeHadFailure) {
      writeHadFailure = false;
      notify({ kind: 'write-recovered' });
    }
    return { kind: 'written' };
  }
  scheduleRetry(url, token);
  return {
    kind: 'failed',
    message: written
      ? 'YouTrack accepted the configuration save, but reading it back did not show it.'
      : 'YouTrack did not accept the configuration save.',
  };
}

// Exponential backoff (2s → 30s cap). Only the local cache and file hold the
// latest edit while retrying, so no data is lost; we just keep trying to push.
// No retry is started while activation holds the article frozen; unfreezing
// resumes it.
function scheduleRetry(url: string, token: string): void {
  if (!writeHadFailure) {
    writeHadFailure = true;
    notify({ kind: 'write-failed' });
  }
  if (frozen) return;
  retryDelay = retryDelay === 0 ? RETRY_BASE_MS : Math.min(retryDelay * 2, RETRY_MAX_MS);
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void _write(url, token);
  }, retryDelay);
}

// ─── Activation gate (VERM-53 review) ────────────────────────────────────────
//
// Activation calls, in order:
//   freezeForActivation()          edits refused, no new save or retry starts
//   settleForActivation(url, tok)  waits out any write in flight; if edits are
//                                  unsaved, writes them now and requires a
//                                  verified write — anything else refuses
//   … backup, migration, marker …
//   unfreezeAfterActivation(...)   in a finally; resumes any pending retry
//
// With no unsaved edits nothing is written, so a clean state never rewrites
// _vermilian-config. On refusal the unsaved edits stay in the cache and are
// retried after unfreezing, so nothing is lost.

export function freezeForActivation(): void {
  frozen = true;
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

export type SettleResult = { ok: true; wrote: boolean } | { ok: false; message: string };

export async function settleForActivation(url: string, token: string): Promise<SettleResult> {
  if (!frozen) return { ok: false, message: 'Internal error: configuration edits were not paused before activation.' };
  await writeChain; // a write already running finishes first
  if (!hasUnsavedEdits()) return { ok: true, wrote: false };
  const r = await _write(url, token);
  if (r.kind === 'written' && !hasUnsavedEdits()) return { ok: true, wrote: true };
  const why = r.kind === 'blocked' || r.kind === 'failed' ? r.message : 'The latest configuration change is still unsaved.';
  return {
    ok: false,
    message:
      `Your latest configuration change could not be saved to YouTrack (${why}). Activation did not start, so the ` +
      'migration would not use an older configuration. Nothing was migrated; the change is kept and will be retried.',
  };
}

export function unfreezeAfterActivation(url: string, token: string): void {
  frozen = false;
  if (hasUnsavedEdits() && url && token) scheduleSave(url, token);
}

// ─── Flush (call on quit / before checkpoint) ────────────────────────────────

export async function flush(url: string, token: string): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await _write(url, token);
}

// Test-only: back to a fresh module state.
export function resetForTests(): void {
  cache = null;
  articleId = null;
  lastReadUpdated = 0;
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
  retryDelay = 0;
  writeHadFailure = false;
  revision = 0;
  savedRevision = 0;
  writeChain = Promise.resolve();
  frozen = false;
}
