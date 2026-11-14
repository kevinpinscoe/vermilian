// Composes _vermilian-master-plan discovery (api/youtrack.ts) and parsing
// (shared/masterPlan.ts) into a single renderer-facing MasterPlanState.
//
// Deliberately no persistent cache, unlike articleConfig.ts's
// _vermilian-config singleton: the article is edited by hand in YouTrack at
// any time, so a stale in-memory copy would hide those edits indefinitely.
// Every call here re-fetches. Staleness/refresh cadence is instead governed
// by the renderer's own React Query `staleTime` on the ['youtrack',
// 'master-plan'] key — the same lifecycle Priority Desk's own issue queries
// already use (candidates.ts, `staleTime: 60_000`) — so an edit shows up on
// the next ordinary Priority Desk refresh with no separate "reload Master
// Plan" action needed.

import { youtrack as yt } from '../api/client';
import { parseMasterPlan } from '../../shared/masterPlan';
import type { MasterPlanState } from '../../shared/masterPlan';
import { isMasterPlanArticleId } from '../../shared/workspaceSchema';

export async function getMasterPlanState(url: string, token: string): Promise<MasterPlanState> {
  if (!url || !token) return { kind: 'none' };

  const discovery = await yt.findMasterPlanArticle(url, token);

  switch (discovery.status) {
    case 'none':
      return { kind: 'none' };
    case 'discovery-error':
      return { kind: 'discovery-error' };
    case 'discovery-incomplete':
      return { kind: 'discovery-incomplete' };
    case 'ambiguous':
      return { kind: 'ambiguous-articles', articleIds: discovery.articles.map((a) => a.id) };
    case 'found': {
      const parsed = parseMasterPlan(discovery.article.content);
      return {
        kind: 'loaded',
        articleId: discovery.article.id,
        updated: discovery.article.updated,
        outcomes: parsed.outcomes,
        diagnostics: parsed.diagnostics,
        parseStatus: parsed.status,
      };
    }
    default:
      return { kind: 'none' };
  }
}

// ─── A workspace's own master plan, by article ID (VERM-48) ──────────────────

/** One article read by ID; `status` is the HTTP status of a refusal, when known. */
export type ArticleFetch =
  | { ok: true; article: { id: string; content: string; updated: number } }
  | { ok: false; status?: number };

/**
 * The master plan a per-workspace-storage workspace names. `fetchArticle`
 * reads through that workspace's own YouTrack connection and credential.
 * null is None: nothing is fetched. Exactly the referenced article is read;
 * a missing or unreadable one is reported as such, and never replaced by the
 * global `_vermilian-master-plan` article or a title search.
 */
export async function getWorkspaceMasterPlanState(
  articleId: string | null,
  fetchArticle: (articleId: string) => Promise<ArticleFetch>,
): Promise<MasterPlanState> {
  if (articleId === null) return { kind: 'none' };
  if (!isMasterPlanArticleId(articleId)) return { kind: 'reference-error', articleId: '' };
  const r = await fetchArticle(articleId);
  if (!r.ok) {
    if (r.status === 404) return { kind: 'reference-not-found', articleId };
    if (r.status === 401 || r.status === 403) return { kind: 'reference-inaccessible', articleId };
    return { kind: 'reference-error', articleId };
  }
  const parsed = parseMasterPlan(r.article.content);
  return {
    kind: 'loaded',
    articleId,
    updated: r.article.updated,
    outcomes: parsed.outcomes,
    diagnostics: parsed.diagnostics,
    parseStatus: parsed.status,
  };
}
