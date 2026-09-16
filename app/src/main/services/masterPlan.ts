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
