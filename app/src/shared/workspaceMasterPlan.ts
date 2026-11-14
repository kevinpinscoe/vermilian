// Which master-plan article a workspace's Priority Desk uses (VERM-48,
// ADR-0011, proposal decision C5).
//
//   legacy storage        the one global `_vermilian-master-plan` article,
//                         found by title, exactly as before VERM-53.
//   per-workspace storage the workspace's own `masterPlan.articleId` — a
//                         readable YouTrack article ID — read through the
//                         workspace's own YouTrack connection and credential.
//                         None (absent or null) means no master plan. There is
//                         no fallback to the global article, to a title
//                         search, or to another workspace's connection.
//
// Jira workspaces have no YouTrack connection, so they never have one.
//
// Pure TypeScript: no Electron, no React.

import { isMasterPlanArticleId, type WorkspaceDocument } from './workspaceSchema';
import { WorkspaceSetupError } from './workspaceSetup';

export { isMasterPlanArticleId };

/** The workspace's master-plan article ID, or null for None. */
export function masterPlanArticleIdOf(doc: Pick<WorkspaceDocument, 'masterPlan'>): string | null {
  return doc.masterPlan?.articleId ?? null;
}

export type MasterPlanArticleIdInput = { ok: true; articleId: string | null } | { ok: false; message: string };

/** An article ID typed by the user. Empty means None; letters are uppercased. */
export function parseMasterPlanArticleIdInput(raw: string): MasterPlanArticleIdInput {
  const v = raw.trim().toUpperCase();
  if (v === '') return { ok: true, articleId: null };
  if (isMasterPlanArticleId(v)) return { ok: true, articleId: v };
  return {
    ok: false,
    message: 'Enter the article ID shown in YouTrack, such as VERM-A-12 — not its title or URL. Leave it empty for None.',
  };
}

/**
 * The workspace with its master-plan reference set, changed or cleared
 * (null). Everything else is kept. Throws WorkspaceSetupError for a
 * malformed ID, or for a master plan on a Jira workspace.
 */
export function withMasterPlanArticle(doc: WorkspaceDocument, articleId: string | null): WorkspaceDocument {
  if (articleId !== null) {
    if (!isMasterPlanArticleId(articleId)) throw new WorkspaceSetupError('That is not a YouTrack article ID.');
    if (doc.backend.kind !== 'youtrack') throw new WorkspaceSetupError('A master plan is for YouTrack workspaces only.');
  }
  return { ...doc, masterPlan: { ...doc.masterPlan, articleId } };
}
