// Per-workspace configuration articles (VERM-43, ADR-0011 §4): the result
// types every layer shares — main-process service, IPC, preload, renderer.
//
// Each workspace is one YouTrack article titled `_vermilian-ws-<workspaceId>`
// in the VERM project, found by listing that project and matching the prefix.
// The article body is a WorkspaceDocument (shared/workspaceSchema.ts).
//
// Nothing here crosses IPC except plain data. The opaque source handle that
// parseWorkspaceDocument returns stays in the main process, inside the single
// operation that read the article.
//
// Pure TypeScript: no Electron, no React.

import type { WorkspaceDocument, WorkspaceValidationError } from './workspaceSchema';
import type { WorkspaceMergeConflict } from './workspaceMerge';

export const WORKSPACE_ARTICLE_PREFIX = '_vermilian-ws-';

export function workspaceArticleTitle(workspaceId: string): string {
  return WORKSPACE_ARTICLE_PREFIX + workspaceId;
}

/** One workspace as discovery found it. */
export type WorkspaceArticleEntry =
  | { workspaceId: string; status: 'ok'; articleId: string; updated: number; document: WorkspaceDocument }
  // More than one article carries this workspace's title. Vermilian picks
  // neither and changes neither: the workspace is refused until exactly one
  // remains (Kevin, 2026-11-13).
  | { workspaceId: string; status: 'ambiguous'; articleIds: string[]; message: string }
  // The article exists but cannot be used: malformed JSON, a schema this
  // version does not read, a secret-shaped value, a title whose suffix is not
  // a valid workspace ID, or a body whose workspaceId differs from its title.
  | { workspaceId: string; status: 'invalid'; articleId: string; errors: WorkspaceValidationError[]; message: string };

/** Why the workspace articles could not be listed at all. */
export interface WorkspaceDiscoveryFailure {
  ok: false;
  reason: 'not-configured' | 'discovery-error' | 'discovery-incomplete';
  message: string;
}

export type ListWorkspaceArticlesResult =
  | { ok: true; workspaces: WorkspaceArticleEntry[] }
  | WorkspaceDiscoveryFailure;

export type ReadWorkspaceArticleResult =
  | { ok: true; entry: WorkspaceArticleEntry }
  | WorkspaceDiscoveryFailure
  | { ok: false; reason: 'not-found'; message: string };

export type SaveWorkspaceArticleResult =
  | {
      ok: true;
      document: WorkspaceDocument; // what the article now holds (known fields)
      articleId: string;
      updated: number;
      created: boolean; // a new article was written
      unchanged: boolean; // the article already held this; nothing was written
    }
  // Both sides changed the same field differently — or a create found the
  // workspace's article already exists with different content, which goes
  // through the update path with no base. Nothing was written; the
  // caller still has its edit, and `remote` is what the article holds now.
  | { ok: false; reason: 'conflict'; conflicts: WorkspaceMergeConflict[]; remote: WorkspaceDocument; message: string }
  | { ok: false; reason: 'ambiguous'; articleIds: string[]; message: string }
  | { ok: false; reason: 'invalid-remote'; articleId: string; errors: WorkspaceValidationError[]; message: string }
  | { ok: false; reason: 'invalid-edit'; errors: WorkspaceValidationError[]; message: string }
  | { ok: false; reason: 'not-found'; message: string }
  // Another writer kept changing the article between our read and our
  // read-back for every attempt. Nothing is claimed; the edit is not known to
  // have landed.
  | { ok: false; reason: 'race-unresolved'; attempts: number; message: string }
  | { ok: false; reason: 'write-failed'; message: string }
  // A create was accepted (article `articleId`), but discovery afterwards
  // could not confirm it is the workspace's one article: the listing failed or
  // was incomplete, the article was not found, or a different article holds
  // the title. The article may well exist; it is left exactly as written.
  | { ok: false; reason: 'create-unverified'; articleId: string; message: string }
  | WorkspaceDiscoveryFailure;
