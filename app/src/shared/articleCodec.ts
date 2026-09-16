// Pure (de)serialisation and merge for the _vermilian-config Article payload.
// Extracted from main/services/articleConfig.ts so it can be unit-tested
// without pulling in Electron.

import type { ArticleFullConfig } from './boardConfig';
import { emptyArticleConfig, ARTICLE_CONFIG_VERSION } from './boardConfig';

// Parse the Article body into a full config. Tolerates a ```json … ``` code
// fence (YouTrack's Markdown editor may add one) and falls back to an empty
// config on any malformed content rather than throwing.
export function parseArticleConfig(raw: string): ArticleFullConfig {
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(stripped) as Partial<ArticleFullConfig>;
    return {
      version: parsed.version ?? ARTICLE_CONFIG_VERSION,
      workspaces: parsed.workspaces ?? [],
      activeWorkspaceId: parsed.activeWorkspaceId ?? '',
      boards: parsed.boards ?? {},
      dismissals: parsed.dismissals ?? {},
    };
  } catch {
    return emptyArticleConfig();
  }
}

export function serialiseArticleConfig(cfg: ArticleFullConfig): string {
  return JSON.stringify(cfg, null, 2);
}

// Stale-write merge: another machine wrote a newer Article. Take the remote as
// the base (version / workspaces / activeWorkspaceId) and overlay our local
// board edits and dismissals on top (local wins per key in both cases).
export function mergeRemoteConfig(
  remote: ArticleFullConfig,
  local: ArticleFullConfig,
): ArticleFullConfig {
  return {
    ...remote,
    boards: { ...remote.boards, ...local.boards },
    dismissals: { ...remote.dismissals, ...local.dismissals },
  };
}
