// Creating and removing a workspace under per-workspace storage for the
// Markdown import's Apply (VERM-104). Electron-free, so it runs under vitest;
// main/ipc.ts supplies the article client (behind the storage guard) and the
// ID generator.
//
// Create copies only the source workspace's tracker connection and credential
// reference, and only while that connection is still the one checked. Its
// identity is kept from the moment the ID is generated: a create that reached
// YouTrack but could not be verified (createWorkspaceArticle's
// create-unverified, invalid-remote or ambiguous outcomes) still returns the
// generated workspace ID and the article its own create call returned — never
// the other articles discovery found under the title, which this attempt
// cannot confirm it made.
//
// Remove is the cleanup of such a create. It deletes only the articles whose
// creation this attempt confirmed (the IDs it is given), and only while they
// hold the generated ID's title. Any other article under that title is never
// deleted: it is reported by ID for inspection by hand. Each removal is
// confirmed by reading the article again; whatever cannot be confirmed gone
// is reported by ID.

import { buildWorkspaceDocument, nextWorkspaceOrder } from '../../shared/workspaceSetup';
import { workspaceArticleTitle } from '../../shared/workspaceArticle';
import type { WorkspaceDocument } from '../../shared/workspaceSchema';
import * as workspaceArticles from './workspaceArticles';
import type { WorkspaceArticleClient } from './workspaceArticles';
import { trackerConnectionKey, type ApplyWorkspaceStore } from './runwayMarkdownApply';
import { addLegacyWorkspace, removeLegacyWorkspace, type LegacyWorkspaceEditDeps } from './legacyWorkspaceEdit';

export interface PerWorkspaceApplyDeps {
  /** The article client when per-workspace writes are allowed; otherwise why not. */
  client(): Promise<WorkspaceArticleClient | string>;
  generateWorkspaceId(): string;
}

type Create = ApplyWorkspaceStore['create'];
type Remove = ApplyWorkspaceStore['remove'];

/** The article this attempt's own create call returned, when it got that far. */
function writtenArticles(saved: Awaited<ReturnType<typeof workspaceArticles.createWorkspaceArticle>>): string[] {
  if (saved.ok) return [saved.articleId];
  if (saved.reason === 'create-unverified') return [saved.articleId];
  if ((saved.reason === 'ambiguous' || saved.reason === 'invalid-remote') && saved.createdArticleId) return [saved.createdArticleId];
  return [];
}

export function createPerWorkspaceApplyWorkspaces(deps: PerWorkspaceApplyDeps): { create: Create; remove: Remove } {
  const create: Create = async (name, connectionWorkspaceId, expectedKey) => {
    const client = await deps.client();
    if (typeof client === 'string') return { ok: false, error: client };
    const listed = await workspaceArticles.listWorkspaceArticles(client);
    if (!listed.ok) return { ok: false, error: listed.message };
    const docs = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
    const source = docs.find((d) => d.workspaceId === connectionWorkspaceId);
    if (!source) return { ok: false, error: 'The workspace supplying the connection no longer exists.' };
    // Copy only the connection that was checked: the very settings read here must match it.
    if (trackerConnectionKey(source.backend) !== expectedKey) return { ok: false, error: 'The connection changed after it was checked.' };
    const b = source.backend;
    const workspaceId = deps.generateWorkspaceId();
    const built = buildWorkspaceDocument({
      workspaceId,
      name,
      order: nextWorkspaceOrder(docs),
      backend: b.kind === 'jira' ? { kind: 'jira', siteUrl: b.siteUrl, email: b.email, credentialRef: b.credentialRef } : { kind: 'youtrack', serverUrl: b.serverUrl, credentialRef: b.credentialRef },
      aiCredentialRef: null,
    });
    if (!built.ok) return { ok: false, error: built.errors.map((e) => e.message).join(' ') };
    const doc: WorkspaceDocument = { ...built.document, backend: { ...b } };
    // From here on the identity is kept, whatever happens.
    let saved: Awaited<ReturnType<typeof workspaceArticles.createWorkspaceArticle>>;
    try {
      saved = await workspaceArticles.createWorkspaceArticle(client, doc);
    } catch (err) {
      const message = (err as { message?: unknown } | null)?.message;
      return { ok: false, error: typeof message === 'string' && message ? message : 'The workspace could not be created.', workspaceId, articleIds: [] };
    }
    const articleIds = writtenArticles(saved);
    if (!saved.ok) return { ok: false, error: saved.message, workspaceId, articleIds };
    return { ok: true, workspaceId, articleIds };
  };

  const remove: Remove = async (workspaceId, articleIds) => {
    const known = [...new Set(articleIds)];
    const client = await deps.client();
    if (typeof client === 'string') return { ok: false, error: client, articleIds: known };
    const title = workspaceArticleTitle(workspaceId);

    // Only the confirmed articles are deleted, and only while they hold the title.
    const refused: string[] = [];
    for (const id of known) {
      const record = await client.get(id);
      if (!record) continue;
      if (record.summary !== title) {
        refused.push(id);
        continue;
      }
      await client.delete(id);
    }

    // Confirm: each one read again. Any other article under the title is left alone and reported.
    const stillThere: string[] = [...refused];
    for (const id of known) if (!refused.includes(id) && (await client.get(id))) stillThere.push(id);
    const recheck = await client.list();
    const uncertain = recheck.ok ? recheck.articles.filter((a) => a.summary === title && !known.includes(a.id)).map((a) => a.id) : [];
    const problems: string[] = [];
    if (stillThere.length > 0) problems.push(`article ${stillThere.join(', ')} could not be confirmed removed`);
    if (uncertain.length > 0) problems.push(`article ${uncertain.join(', ')} also holds its title but was not created by this import, so it was left; inspect it by hand`);
    if (!recheck.ok) problems.push('YouTrack did not list the workspace articles, so nothing else under its title could be checked');
    if (problems.length > 0) {
      const articleIds = [...new Set([...stillThere, ...uncertain, ...(recheck.ok ? [] : known)])];
      return { ok: false, error: `Workspace ${workspaceId}: ${problems.join('; ')}.`, articleIds };
    }
    return { ok: true };
  };

  return { create, remove };
}

// ─── Legacy storage ──────────────────────────────────────────────────────────
// Every workspace is on the one configured YouTrack; edits go through
// legacyWorkspaceEdit.ts, which changes only the one workspace.

export interface LegacyApplyDeps {
  edit: LegacyWorkspaceEditDeps;
  /** A workspace's tracker connection as a key; null when it is gone. */
  connectionKey(workspaceId: string): Promise<string | null>;
  generateWorkspaceId(): string;
}

export function createLegacyApplyWorkspaces(deps: LegacyApplyDeps): ApplyWorkspaceStore {
  return {
    async list() {
      const config = await deps.edit.read();
      return (config?.workspaces ?? []).map((w) => ({ id: w.id, name: w.name }));
    },
    async create(name, connectionWorkspaceId, expectedKey) {
      if ((await deps.connectionKey(connectionWorkspaceId)) !== expectedKey) return { ok: false, error: 'The connection changed after it was checked.' };
      const config = await deps.edit.read();
      if (!config) return { ok: false, error: 'The workspace configuration could not be read.' };
      const id = deps.generateWorkspaceId();
      const order = config.workspaces.reduce((m, w) => Math.max(m, w.order + 1), 0);
      const added = await addLegacyWorkspace(deps.edit, { id, name, order, folders: [] });
      if (added.ok) return { ok: true, workspaceId: id };
      // The addition may have survived a failed rollback: keep its ID so Apply can remove it, or report it.
      return added.mayRemain ? { ok: false, error: added.error, workspaceId: id } : { ok: false, error: added.error };
    },
    async remove(workspaceId) {
      return removeLegacyWorkspace(deps.edit, workspaceId);
    },
  };
}
