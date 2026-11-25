// Creating and removing a workspace for the Markdown import's Apply
// (VERM-104), under either storage mode. Electron-free, so it runs under
// vitest; main/ipc.ts supplies the article client (behind the storage guard),
// the legacy configuration edits and the ID generator.
//
// Per-workspace create copies only the source workspace's tracker connection
// and credential reference, and only while that connection is still the one
// checked. Ownership is what this attempt's own create call returned: the
// client's create is wrapped, so Apply knows whether it reached YouTrack and
// which article it made. A save that found an article already holding the
// generated ID (createWorkspaceArticle's update path, created: false) is not
// this import's: Apply refuses that destination and leaves it out of
// rollback. The generated ID is also checked absent before anything is
// written.
//
// Remove is the cleanup of such a create. It deletes only the articles this
// attempt's create call returned, and only while they still hold the
// generated ID's title. Absence is confirmed, never assumed: a read that
// fails is not "gone". The final listing is checked for every article under
// the title, known or not. What remains is reported in two kinds: this
// import's own articles not confirmed removed (articleIds, to remove by
// hand), and articles it did not create or cannot confirm creating, left in
// place deliberately (inspectArticleIds, to inspect).

import { buildWorkspaceDocument, nextWorkspaceOrder } from '../../shared/workspaceSetup';
import { workspaceArticleTitle } from '../../shared/workspaceArticle';
import type { WorkspaceDocument } from '../../shared/workspaceSchema';
import * as workspaceArticles from './workspaceArticles';
import type { ArticleLookupClient, WorkspaceArticleClient } from './workspaceArticles';
import { trackerConnectionKey, type ApplyWorkspaceStore } from './runwayMarkdownApply';
import { addLegacyWorkspace, removeLegacyWorkspace, type LegacyWorkspaceEditDeps } from './legacyWorkspaceEdit';

export type ApplyArticleClient = WorkspaceArticleClient & ArticleLookupClient;

export interface PerWorkspaceApplyDeps {
  /** The article client when per-workspace writes are allowed; otherwise why not. */
  client(): Promise<ApplyArticleClient | string>;
  generateWorkspaceId(): string;
}

const messageOf = (err: unknown, fallback: string) => {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
};

export function createPerWorkspaceApplyWorkspaces(deps: PerWorkspaceApplyDeps): ApplyWorkspaceStore {
  const list: ApplyWorkspaceStore['list'] = async () => {
    const client = await deps.client();
    if (typeof client === 'string') throw new Error(client);
    const listed = await workspaceArticles.listWorkspaceArticles(client);
    if (!listed.ok) throw new Error(listed.message);
    return listed.workspaces.flatMap((e) => (e.status === 'ok' ? [{ id: e.document.workspaceId, name: e.document.name }] : []));
  };

  const create: ApplyWorkspaceStore['create'] = async (name, connectionWorkspaceId, expectedKey) => {
    const client = await deps.client();
    if (typeof client === 'string') return { ok: false, error: client };
    const listed = await workspaceArticles.listWorkspaceArticles(client);
    if (!listed.ok) return { ok: false, error: listed.message };
    const docs = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
    const source = docs.find((d) => d.workspaceId === connectionWorkspaceId);
    if (!source) return { ok: false, error: 'The workspace supplying the connection no longer exists.' };
    // Copy only the connection that was checked: the very settings read here must match it.
    if (trackerConnectionKey(source.backend) !== expectedKey) return { ok: false, error: 'The connection changed after it was checked.' };
    const workspaceId = deps.generateWorkspaceId();
    const taken = (id: string) => `An article already holds workspace ID ${id}; it was left untouched and this workspace was not created. Apply again.`;
    if (listed.workspaces.some((e) => e.workspaceId === workspaceId)) return { ok: false, error: taken(workspaceId) };
    const b = source.backend;
    const built = buildWorkspaceDocument({
      workspaceId,
      name,
      order: nextWorkspaceOrder(docs),
      backend: b.kind === 'jira' ? { kind: 'jira', siteUrl: b.siteUrl, email: b.email, credentialRef: b.credentialRef } : { kind: 'youtrack', serverUrl: b.serverUrl, credentialRef: b.credentialRef },
      aiCredentialRef: null,
    });
    if (!built.ok) return { ok: false, error: built.errors.map((e) => e.message).join(' ') };
    const doc: WorkspaceDocument = { ...built.document, backend: { ...b } };

    // What this attempt's own create call did: whether it ran, and the article it returned.
    let called = false;
    let createdId: string | null = null;
    const tracked: WorkspaceArticleClient = {
      list: () => client.list(),
      get: (id) => client.get(id),
      update: (id, content) => client.update(id, content),
      delete: (id) => client.delete(id),
      async create(id, content) {
        called = true;
        const r = await client.create(id, content);
        createdId = r?.id ?? null;
        return r;
      },
    };
    let saved: Awaited<ReturnType<typeof workspaceArticles.createWorkspaceArticle>> | null = null;
    let thrown: string | null = null;
    try {
      saved = await workspaceArticles.createWorkspaceArticle(tracked, doc);
    } catch (err) {
      thrown = messageOf(err, 'The workspace could not be created.');
    }
    const owned: string[] = createdId ? [createdId] : [];
    if (!called) {
      // Nothing was created by this attempt; an article that already held the ID (created: false) is not ours.
      if (saved?.ok) return { ok: false, error: taken(workspaceId) };
      return { ok: false, error: thrown ?? saved?.message ?? 'The workspace could not be created.' };
    }
    // The create call ran: keep the identity whatever the outcome, so cleanup can reconcile it.
    if (thrown !== null) return { ok: false, error: thrown, workspaceId, articleIds: owned };
    if (!saved || !saved.ok) return { ok: false, error: saved?.message ?? 'The workspace could not be created.', workspaceId, articleIds: owned };
    if (saved.articleId !== createdId) return { ok: false, error: `Workspace ${workspaceId} resolved to article ${saved.articleId}, which this import did not create.`, workspaceId, articleIds: owned };
    return { ok: true, workspaceId, articleIds: owned };
  };

  const remove: ApplyWorkspaceStore['remove'] = async (workspaceId, articleIds) => {
    const known = [...new Set(articleIds)];
    const client = await deps.client();
    if (typeof client === 'string') return { ok: false, error: client, articleIds: known, inspectArticleIds: [] };
    const title = workspaceArticleTitle(workspaceId);
    const leftovers = new Set<string>();
    const inspect = new Set<string>();
    const notes: string[] = [];

    // Delete only this attempt's own articles, and only while they hold the title.
    for (const id of known) {
      const found = await client.lookup(id);
      if (found.state === 'failed') {
        leftovers.add(id);
        notes.push(`article ${id} could not be read (${found.message})`);
      } else if (found.state === 'found' && found.article.summary !== title) {
        inspect.add(id);
        notes.push(`article ${id} no longer holds its title, so it was left`);
      } else if (found.state === 'found') {
        const deleted = await client.delete(id).catch(() => false);
        if (!deleted) {
          leftovers.add(id);
          notes.push(`YouTrack did not delete article ${id}`);
        }
      }
    }

    // Confirm each one gone: a failed read is not absence.
    for (const id of known) {
      if (leftovers.has(id) || inspect.has(id)) continue;
      const again = await client.lookup(id);
      if (again.state === 'absent') continue;
      leftovers.add(id);
      notes.push(again.state === 'found' ? `article ${id} is still there` : `article ${id} could not be confirmed removed (${again.message})`);
    }

    // The final listing: every article under the title, known or not.
    const recheck = await client.list();
    if (!recheck.ok) {
      for (const id of known) if (!inspect.has(id)) leftovers.add(id);
      notes.push('YouTrack did not list the workspace articles, so the removal could not be confirmed');
    } else {
      for (const a of recheck.articles) {
        if (a.summary !== title) continue;
        if (known.includes(a.id)) {
          if (!inspect.has(a.id) && !leftovers.has(a.id)) {
            leftovers.add(a.id);
            notes.push(`article ${a.id} is still listed`);
          }
        } else if (!inspect.has(a.id)) {
          inspect.add(a.id);
          notes.push(`article ${a.id} also holds its title but was not created by this import, so it was left in place for inspection`);
        }
      }
    }

    if (leftovers.size === 0 && inspect.size === 0 && recheck.ok) return { ok: true };
    return { ok: false, error: `Workspace ${workspaceId}: ${notes.join('; ')}.`, articleIds: [...leftovers], inspectArticleIds: [...inspect] };
  };

  return { list, create, remove };
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
