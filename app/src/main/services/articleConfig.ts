// Singleton service that owns the _vermilian-config Article.
// Reads on first use; writes are debounced 1.5s.  Falls back to local
// workspace-config.json if the Article is unavailable.

import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArticleFullConfig, BoardConfig } from '../../shared/boardConfig';
import {
  emptyArticleConfig,
  ARTICLE_CONFIG_VERSION,
  defaultBoardConfig,
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

  if (!article) {
    // First run — create the Article.
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

// ─── Update helpers ──────────────────────────────────────────────────────────

export function updateBoardConfig(config: BoardConfig): void {
  if (!cache) cache = emptyArticleConfig();
  cache = { ...cache, boards: { ...cache.boards, [config.boardId]: config } };
}

export function removeBoardConfig(projectId: string): void {
  if (!cache) return;
  const boards = { ...cache.boards };
  delete boards[projectId];
  cache = { ...cache, boards };
}

export function updateWorkspaceConfig(wsConfig: VermilianConfig): void {
  if (!cache) cache = emptyArticleConfig();
  cache = {
    ...cache,
    workspaces: wsConfig.workspaces,
    activeWorkspaceId: wsConfig.activeWorkspaceId,
  };
}

// ─── Debounced write ─────────────────────────────────────────────────────────

export function scheduleSave(url: string, token: string): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void _write(url, token);
  }, 1500);
}

async function _write(url: string, token: string): Promise<void> {
  if (!cache || !url || !token) return;

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

  let ok = false;
  if (articleId) {
    const result = await yt.updateVermilianArticle(url, token, articleId, content);
    if (result) {
      lastReadUpdated = result.updated;
      ok = true;
    }
  } else {
    const created = await yt.createVermilianArticle(url, token, content);
    if (created) {
      articleId = created.id;
      lastReadUpdated = created.updated;
      await saveCachedArticleId(articleId);
      ok = true;
    }
  }

  if (ok) {
    // Recovered after a prior failure — clear backoff and tell the renderer.
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    retryDelay = 0;
    if (writeHadFailure) {
      writeHadFailure = false;
      notify({ kind: 'write-recovered' });
    }
  } else {
    scheduleRetry(url, token);
  }
}

// Exponential backoff (2s → 30s cap). Only the local cache and file hold the
// latest edit while retrying, so no data is lost; we just keep trying to push.
function scheduleRetry(url: string, token: string): void {
  if (!writeHadFailure) {
    writeHadFailure = true;
    notify({ kind: 'write-failed' });
  }
  retryDelay = retryDelay === 0 ? RETRY_BASE_MS : Math.min(retryDelay * 2, RETRY_MAX_MS);
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void _write(url, token);
  }, retryDelay);
}

// ─── Flush (call on quit / before checkpoint) ────────────────────────────────

export async function flush(url: string, token: string): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await _write(url, token);
}
