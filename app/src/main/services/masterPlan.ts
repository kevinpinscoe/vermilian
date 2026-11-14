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
import { isMasterPlanArticleId, type WorkspaceDocument } from '../../shared/workspaceSchema';
import { masterPlanArticleIdOf } from '../../shared/workspaceMasterPlan';
import type { WorkspaceYouTrackConnection } from './workspaceYouTrack';

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

// ─── Only the active workspace's plan (VERM-48 correction) ──────────────────

export interface ActiveMasterPlanDeps {
  /** The workspace the renderer asked for; ignored when absent. */
  requestedWorkspaceId: unknown;
  /** The active workspace on this machine, resolved in the main process. */
  activeId: string;
  /** The active-workspace switch counter, read before anything else. */
  startGeneration: number;
  currentGeneration(): number;
  loadDoc(workspaceId: string): Promise<WorkspaceDocument | null>;
  connect(doc: WorkspaceDocument): Promise<WorkspaceYouTrackConnection>;
  fetchArticle(url: string, token: string, articleId: string): Promise<ArticleFetch>;
}

/**
 * The master plan for the active workspace, under per-workspace storage.
 * A request naming any other workspace is refused before anything is read
 * ('workspace-not-active'), so a caller-supplied ID can never reach another
 * workspace's plan or credential. A switch at any point — before the article
 * is read (YouTrack is then not contacted) or while it is read (the answer is
 * discarded) — turns the result into 'workspace-not-active' too, never the
 * previous workspace's plan.
 */
export async function getActiveWorkspaceMasterPlan(d: ActiveMasterPlanDeps): Promise<MasterPlanState> {
  const asked = d.requestedWorkspaceId;
  if (typeof asked === 'string' && asked !== '' && asked !== d.activeId) return { kind: 'workspace-not-active' };
  const switched = () => d.currentGeneration() !== d.startGeneration;

  const doc = await d.loadDoc(d.activeId);
  if (switched()) return { kind: 'workspace-not-active' };
  if (!doc) return { kind: 'none' };
  const articleId = masterPlanArticleIdOf(doc);
  if (doc.backend.kind !== 'youtrack') return articleId ? { kind: 'reference-unsupported' } : { kind: 'none' };

  const state = await getWorkspaceMasterPlanState(articleId, async (id) => {
    const conn = await d.connect(doc);
    if (!conn.ok) return { ok: false }; // reference-error; the resolver's details stay in main
    if (switched()) return { ok: false }; // superseded below; YouTrack is not contacted
    return d.fetchArticle(conn.url, conn.token, id);
  });
  return switched() ? { kind: 'workspace-not-active' } : state;
}
