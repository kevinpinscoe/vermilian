// Pure (de)serialisation and merge for the _vermilian-config Article payload.
// Extracted from main/services/articleConfig.ts so it can be unit-tested
// without pulling in Electron.

import type { ArticleFullConfig, Dismissals } from './boardConfig';
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

// Dismissals are not board config: `dismissedWeekOf` (an ISO Monday date) is
// itself a recency marker, so a plain "local wins per key" overlay (the
// board-config rule below) can resurrect a stale dismissal. If machine A last
// saw the entry at week 2026-09-07 and machine B dismissed the same issue
// again in 2026-09-14, a later stale-write merge on A must not overlay its
// own older 2026-09-07 entry back on top of B's newer one — that would make
// the issue eligible again mid-week on every machine once A's write lands.
// Per key, the entry with the later `dismissedWeekOf` wins; a key present on
// only one side is preserved unchanged. Ties (equal `dismissedWeekOf`) fall
// to local, the same bias the board merge below uses — review finding on
// VERM-6's PR (2026-09-16).
function mergeDismissals(remote: Dismissals, local: Dismissals): Dismissals {
  const merged: Dismissals = { ...remote };
  for (const [key, localEntry] of Object.entries(local)) {
    const remoteEntry = merged[key];
    if (!remoteEntry || localEntry.dismissedWeekOf >= remoteEntry.dismissedWeekOf) {
      merged[key] = localEntry;
    }
  }
  return merged;
}

// Stale-write merge: another machine wrote a newer Article. Take the remote as
// the base (version / workspaces / activeWorkspaceId) and overlay our local
// board edits on top (local wins per key — ordinary "last local edit wins"
// config, with no recency marker of its own to compare against). Dismissals
// merge by recency instead — see mergeDismissals above.
export function mergeRemoteConfig(
  remote: ArticleFullConfig,
  local: ArticleFullConfig,
): ArticleFullConfig {
  return {
    ...remote,
    boards: { ...remote.boards, ...local.boards },
    dismissals: mergeDismissals(remote.dismissals, local.dismissals),
  };
}
