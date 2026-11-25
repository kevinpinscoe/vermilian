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
// generated workspace ID and the article it created, so the cleanup can find
// it.
//
// Remove is the cleanup of such a create. It removes exactly the articles
// this attempt made: the article IDs it was told about, and any article under
// the generated ID's title (the ID was generated for this attempt and found
// absent just before the create, so no one else holds it). An article given
// by ID that does not hold that title is never deleted. Each removal is
// confirmed by reading the article again; whatever cannot be confirmed gone
// is reported by ID.

import { buildWorkspaceDocument, nextWorkspaceOrder } from '../../shared/workspaceSetup';
import { workspaceArticleTitle } from '../../shared/workspaceArticle';
import type { WorkspaceDocument } from '../../shared/workspaceSchema';
import * as workspaceArticles from './workspaceArticles';
import type { WorkspaceArticleClient } from './workspaceArticles';
import { trackerConnectionKey, type ApplyWorkspaceStore } from './runwayMarkdownApply';

export interface PerWorkspaceApplyDeps {
  /** The article client when per-workspace writes are allowed; otherwise why not. */
  client(): Promise<WorkspaceArticleClient | string>;
  generateWorkspaceId(): string;
}

type Create = ApplyWorkspaceStore['create'];
type Remove = ApplyWorkspaceStore['remove'];

/** The article IDs a failed save says were written. */
function writtenArticles(saved: Awaited<ReturnType<typeof workspaceArticles.createWorkspaceArticle>>): string[] {
  if (saved.ok) return [saved.articleId];
  if (saved.reason === 'create-unverified' || saved.reason === 'invalid-remote') return [saved.articleId];
  if (saved.reason === 'ambiguous') return [...saved.articleIds];
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

    const listing = await client.list();
    const targets = [...new Set([...known, ...(listing.ok ? listing.articles.filter((a) => a.summary === title).map((a) => a.id) : [])])];
    const refused: string[] = [];
    for (const id of targets) {
      const record = await client.get(id);
      if (!record) continue;
      if (record.summary !== title) {
        refused.push(id);
        continue;
      }
      await client.delete(id);
    }

    // Confirm: each target read again, and nothing left under the title.
    const left = new Set(refused);
    for (const id of targets) if (!left.has(id) && (await client.get(id))) left.add(id);
    const recheck = await client.list();
    if (recheck.ok) for (const a of recheck.articles) if (a.summary === title) left.add(a.id);
    const remaining = [...left];
    if (remaining.length > 0) {
      return { ok: false, error: `Workspace ${workspaceId} could not be confirmed removed: article ${remaining.join(', ')} is still there.`, articleIds: remaining };
    }
    if (!listing.ok || !recheck.ok) {
      return { ok: false, error: `Workspace ${workspaceId}: YouTrack did not list the workspace articles, so its removal could not be confirmed.`, articleIds: known };
    }
    return { ok: true };
  };

  return { create, remove };
}
