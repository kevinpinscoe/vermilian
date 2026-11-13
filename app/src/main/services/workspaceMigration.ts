// Migration to per-workspace configuration articles (VERM-44, ADR-0011 §11):
// plan (a dry run that writes nothing) and apply.
//
// No Electron import: YouTrack comes through a WorkspaceMigrationClient so unit
// tests can drive this with an in-memory client.
//
// - Nothing calls this on startup. VERM-46 runs it when it activates
//   per-workspace storage, and _vermilian-config stays authoritative until then.
// - apply re-reads the source articles itself, so it always migrates current
//   data, never an earlier plan.
// - The source articles are only read. Workspace articles are written only
//   through createWorkspaceArticle (VERM-43), which never overwrites: an
//   article that already exists with different content is a conflict, and a
//   create is reported as done only after rediscovery confirms it.
// - Idempotent: a second run finds every article and reports it unchanged.

import {
  CONFIG_ARTICLE_TITLE,
  JIRA_PROFILE_ARTICLE_TITLE,
  buildMigrationTargets,
  documentDifferences,
  jiraWorkspaceIdFor,
  parseJiraProfileSource,
  parseLegacyConfig,
  type JiraProfileMigration,
  type JiraProfileSource,
  type WorkspaceMigrationFailure,
  type WorkspaceMigrationItem,
  type WorkspaceMigrationOptions,
  type WorkspaceMigrationResult,
} from '../../shared/workspaceMigration';
import { stableStringify } from '../../shared/workspaceMerge';
import type { WorkspaceArticleEntry } from '../../shared/workspaceArticle';
import {
  createWorkspaceArticle,
  listWorkspaceArticles,
  type WorkspaceArticleClient,
  type WorkspaceArticleListing,
} from './workspaceArticles';

export interface WorkspaceMigrationClient extends WorkspaceArticleClient {
  /** The VERM project's articles titled _vermilian-config or _vermilian-jira-overlay — all pages. */
  listSources(): Promise<WorkspaceArticleListing>;
}

const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

function discoveryFailure(reason: 'fetch-error' | 'incomplete', what: string): WorkspaceMigrationFailure {
  return reason === 'fetch-error'
    ? { ok: false, reason: 'discovery-error', message: `YouTrack did not return the ${what}; nothing was migrated.` }
    : {
        ok: false,
        reason: 'discovery-incomplete',
        message: `There are too many articles in the VERM project to be sure every ${what} was found; nothing was migrated.`,
      };
}

// The item for a workspace whose article discovery found, compared with what
// migration would write.
function compare(item: WorkspaceMigrationItem, entry: WorkspaceArticleEntry | undefined): WorkspaceMigrationItem {
  const doc = item.document!;
  if (!entry) {
    return { ...item, action: 'create', message: `Workspace ${doc.workspaceId} has no article yet; migration creates it.` };
  }
  if (entry.status === 'ambiguous') {
    return { ...item, action: 'ambiguous', articleIds: entry.articleIds, message: entry.message };
  }
  if (entry.status === 'invalid') {
    return { ...item, action: 'invalid-remote', articleId: entry.articleId, errors: entry.errors, message: entry.message };
  }
  const differences = documentDifferences(doc, entry.document, same);
  if (differences.length === 0) {
    return { ...item, action: 'unchanged', articleId: entry.articleId, message: `Workspace ${doc.workspaceId} is already migrated.` };
  }
  return {
    ...item,
    action: 'conflict',
    articleId: entry.articleId,
    differences,
    message:
      `Workspace ${doc.workspaceId} already has an article (${entry.articleId}) that differs from the original ` +
      `configuration (${differences.join(', ')}). Migration does not overwrite it.`,
  };
}

async function plan(
  client: WorkspaceMigrationClient,
  serverUrl: string,
  options: WorkspaceMigrationOptions,
): Promise<WorkspaceMigrationResult> {
  const sources = await client.listSources();
  if (!sources.ok) return discoveryFailure(sources.reason, 'configuration articles');

  const configs = sources.articles.filter((a) => a.summary === CONFIG_ARTICLE_TITLE);
  const jiras = sources.articles.filter((a) => a.summary === JIRA_PROFILE_ARTICLE_TITLE);
  if (configs.length === 0) {
    return { ok: false, reason: 'source-missing', message: `There is no ${CONFIG_ARTICLE_TITLE} article to migrate.` };
  }
  if (configs.length > 1) {
    const articleIds = configs.map((a) => a.id).sort();
    return {
      ok: false,
      reason: 'source-ambiguous',
      articleIds,
      message: `There are ${configs.length} ${CONFIG_ARTICLE_TITLE} articles (${articleIds.join(', ')}); nothing was migrated.`,
    };
  }
  const parsed = parseLegacyConfig(configs[0].content);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, message: parsed.message };

  let jira: JiraProfileSource = { kind: 'none' };
  let jiraProfile: JiraProfileMigration = { status: 'none' };
  if (jiras.length > 1) {
    const articleIds = jiras.map((a) => a.id).sort();
    jiraProfile = {
      status: 'ambiguous',
      articleIds,
      message: `There are ${jiras.length} Jira profile articles (${articleIds.join(', ')}); the profile was not migrated.`,
    };
  } else if (jiras.length === 1) {
    jira = parseJiraProfileSource(jiras[0].id, jiras[0].content);
  }

  const listed = await listWorkspaceArticles(client);
  if (!listed.ok) {
    return listed.reason === 'not-configured'
      ? { ok: false, reason: 'not-configured', message: listed.message }
      : { ok: false, reason: listed.reason, message: `${listed.message} Nothing was migrated.` };
  }
  const existing = new Map(listed.workspaces.map((e) => [e.workspaceId, e]));

  const { targets, notMigrated } = buildMigrationTargets(parsed.config, jira, serverUrl, options);
  const items = targets.map((t) => {
    if (t.kind === 'invalid') return t.item;
    const d = t.document;
    const item: WorkspaceMigrationItem = {
      workspaceId: d.workspaceId,
      name: d.name,
      backend: d.backend.kind,
      action: 'create',
      message: '',
      document: d,
      ...(t.notCarried.length ? { notCarried: t.notCarried } : {}),
    };
    return compare(item, existing.get(d.workspaceId));
  });

  if (jira.kind === 'empty') jiraProfile = { status: 'none', articleId: jira.articleId };
  if (jira.kind === 'invalid') jiraProfile = { status: 'invalid', articleId: jira.articleId, message: jira.message };
  if (jira.kind === 'profile') {
    const workspaceId = jiraWorkspaceIdFor(jira.articleId);
    if (typeof options.jiraWorkspaceName === 'string' && workspaceId) {
      jiraProfile = { status: 'assigned', articleId: jira.articleId, workspaceId };
    } else if (workspaceId && existing.has(workspaceId)) {
      jiraProfile = { status: 'assigned', articleId: jira.articleId, workspaceId }; // migrated by an earlier run
    } else {
      jiraProfile = {
        status: 'unassigned',
        articleId: jira.articleId,
        message: 'The Jira profile was not migrated: name a new Jira workspace to hold it. The profile article is unchanged.',
      };
    }
  }

  return {
    ok: true,
    mode: 'plan',
    complete: items.every((i) => i.action === 'unchanged'),
    items,
    jiraProfile,
    notMigrated,
    configArticleId: configs[0].id,
  };
}

/** A dry run: what migration would do, from the articles as they are now. Writes nothing. */
export function planWorkspaceMigration(
  client: WorkspaceMigrationClient,
  serverUrl: string,
  options: WorkspaceMigrationOptions = {},
): Promise<WorkspaceMigrationResult> {
  return plan(client, serverUrl, options);
}

/**
 * Migrate: read the sources now, then create each workspace article that does
 * not exist yet. `complete` is true only when every workspace's article exists
 * and holds what migration writes.
 */
export async function applyWorkspaceMigration(
  client: WorkspaceMigrationClient,
  serverUrl: string,
  options: WorkspaceMigrationOptions = {},
): Promise<WorkspaceMigrationResult> {
  const fresh = await plan(client, serverUrl, options);
  if (!fresh.ok) return fresh;

  const items: WorkspaceMigrationItem[] = [];
  for (const item of fresh.items) {
    if (item.action !== 'create') {
      items.push(item);
      continue;
    }
    const r = await createWorkspaceArticle(client, item.document!);
    if (r.ok) {
      items.push({
        ...item,
        action: r.created ? 'created' : 'unchanged',
        articleId: r.articleId,
        message: r.created
          ? `Workspace ${item.workspaceId} was migrated to article ${r.articleId}.`
          : `Workspace ${item.workspaceId} is already migrated.`,
      });
    } else if (r.reason === 'conflict') {
      items.push({ ...item, action: 'conflict', differences: documentDifferences(item.document!, r.remote, same), message: r.message });
    } else if (r.reason === 'ambiguous') {
      items.push({ ...item, action: 'ambiguous', articleIds: r.articleIds, message: r.message });
    } else if (r.reason === 'invalid-remote') {
      items.push({ ...item, action: 'invalid-remote', articleId: r.articleId, errors: r.errors, message: r.message });
    } else {
      items.push({ ...item, action: 'failed', ...('articleId' in r ? { articleId: r.articleId } : {}), message: r.message });
    }
  }

  return {
    ...fresh,
    mode: 'apply',
    complete: items.every((i) => i.action === 'created' || i.action === 'unchanged'),
    items,
  };
}
