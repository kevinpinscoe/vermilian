// Per-workspace configuration articles (VERM-43): discovery, read, create and
// update of `_vermilian-ws-<workspaceId>` articles.
//
// No Electron import: the YouTrack calls come through a WorkspaceArticleClient,
// so unit tests drive this module with an in-memory client that can play
// "another machine" between any two steps.
//
// ─── What YouTrack does and does not guarantee ───────────────────────────────
//
// An article update is unconditional: there is no If-Match, version check or
// compare-and-swap. Titles are not unique either, so two machines can each
// create `_vermilian-ws-<id>`. Everything below is therefore best-effort
// protection, not a guarantee:
//
// - Every write re-reads the article in the same operation, merges the edit
//   into what is there now (shared/workspaceMerge.ts) and writes through the
//   source handle from that read, so unknown fields are always carried.
// - Just before writing, the article is fetched once more; if it moved, the
//   attempt starts again rather than overwriting.
// - After writing, the article is read back. If it no longer holds what was
//   written, another writer landed in between, and the attempt starts again.
//   If our own write is what overwrote theirs, *their* read-back fails the
//   same way and they re-apply their edit on top of ours — so a lost known-
//   field edit is recovered as long as both writers run this code to the end.
// - Attempts are bounded. A race that never settles is reported as
//   'race-unresolved', never as success.
//
// What remains: a write by a client that does not run this loop (an older
// Vermilian, a hand edit in YouTrack) landing in the gap between our last
// check and our write can still be overwritten, and simultaneous creates can
// still produce two articles — which discovery then reports as ambiguous.

import {
  parseWorkspaceDocument,
  serialiseNewWorkspaceDocument,
  serialiseUpdatedWorkspaceDocument,
  isValidWorkspaceId,
  validateWorkspaceDocument,
  type WorkspaceDocument,
  type WorkspaceSource,
  type WorkspaceValidationError,
} from '../../shared/workspaceSchema';
import { mergeWorkspaceEdit, stableStringify } from '../../shared/workspaceMerge';
import {
  WORKSPACE_ARTICLE_PREFIX,
  type ListWorkspaceArticlesResult,
  type ReadWorkspaceArticleResult,
  type SaveWorkspaceArticleResult,
  type WorkspaceArticleEntry,
  type WorkspaceDiscoveryFailure,
} from '../../shared/workspaceArticle';

export interface WorkspaceArticleRecord {
  id: string;
  summary: string;
  content: string;
  updated: number;
}

export type WorkspaceArticleListing =
  | { ok: true; articles: WorkspaceArticleRecord[] }
  | { ok: false; reason: 'fetch-error' | 'incomplete' };

/** The four YouTrack calls this module needs. A null result means the call failed. */
export interface WorkspaceArticleClient {
  /** Every article in the VERM project whose title starts with the prefix — all pages. */
  list(): Promise<WorkspaceArticleListing>;
  get(articleId: string): Promise<WorkspaceArticleRecord | null>;
  create(workspaceId: string, content: string): Promise<WorkspaceArticleRecord | null>;
  update(articleId: string, content: string): Promise<{ updated: number } | null>;
}

export const MAX_WRITE_ATTEMPTS = 3;

// ─── Discovery ───────────────────────────────────────────────────────────────

function discoveryFailure(reason: 'fetch-error' | 'incomplete'): WorkspaceDiscoveryFailure {
  return reason === 'fetch-error'
    ? { ok: false, reason: 'discovery-error', message: 'YouTrack did not return the workspace articles.' }
    : {
        ok: false,
        reason: 'discovery-incomplete',
        message: 'There are too many articles in the VERM project to be sure every workspace was found.',
      };
}

function describeErrors(errors: WorkspaceValidationError[]): string {
  return errors.map((e) => e.message).join(' ');
}

function ambiguous(workspaceId: string, articleIds: string[]) {
  return {
    message:
      `Workspace ${workspaceId} has ${articleIds.length} configuration articles (${articleIds.join(', ')}). ` +
      'Vermilian will not read or change it until exactly one remains — delete the extra article in YouTrack.',
  };
}

type Parsed =
  | {
      kind: 'ok';
      entry: Extract<WorkspaceArticleEntry, { status: 'ok' }>;
      record: WorkspaceArticleRecord;
      source: WorkspaceSource; // never leaves this module's single operation
    }
  | { kind: 'other'; entry: WorkspaceArticleEntry };

/** One workspace's articles (all carrying its title) → an entry. */
function toEntry(workspaceId: string, records: WorkspaceArticleRecord[]): Parsed {
  if (records.length > 1) {
    const articleIds = records.map((r) => r.id).sort();
    return { kind: 'other', entry: { workspaceId, status: 'ambiguous', articleIds, ...ambiguous(workspaceId, articleIds) } };
  }
  const record = records[0];
  const invalid = (errors: WorkspaceValidationError[]): Parsed => ({
    kind: 'other',
    entry: {
      workspaceId,
      status: 'invalid',
      articleId: record.id,
      errors,
      message: `The configuration article for workspace ${workspaceId} cannot be used: ${describeErrors(errors)}`,
    },
  });
  if (!isValidWorkspaceId(workspaceId)) {
    return invalid([{ path: '', code: 'invalid', message: 'The article title does not end in a valid workspace ID.' }]);
  }
  const parsed = parseWorkspaceDocument(record.content);
  if (!parsed.ok) return invalid(parsed.errors);
  if (parsed.document.workspaceId !== workspaceId) {
    return invalid([{ path: 'workspaceId', code: 'invalid', message: 'workspaceId does not match the article title.' }]);
  }
  return {
    kind: 'ok',
    record,
    source: parsed.source,
    entry: { workspaceId, status: 'ok', articleId: record.id, updated: record.updated, document: parsed.document },
  };
}

function group(articles: WorkspaceArticleRecord[]): Map<string, WorkspaceArticleRecord[]> {
  const byId = new Map<string, WorkspaceArticleRecord[]>();
  for (const a of articles) {
    if (!a.summary.startsWith(WORKSPACE_ARTICLE_PREFIX)) continue; // the client filters; be sure
    const id = a.summary.slice(WORKSPACE_ARTICLE_PREFIX.length);
    byId.set(id, [...(byId.get(id) ?? []), a]);
  }
  return byId;
}

export async function listWorkspaceArticles(client: WorkspaceArticleClient): Promise<ListWorkspaceArticlesResult> {
  const listing = await client.list();
  if (!listing.ok) return discoveryFailure(listing.reason);
  const workspaces = [...group(listing.articles)].map(([id, records]) => toEntry(id, records).entry);
  // Workspace order for valid documents, then by ID, so the list is stable.
  const rank = (e: WorkspaceArticleEntry) => (e.status === 'ok' ? e.document.order : Number.MAX_SAFE_INTEGER);
  workspaces.sort((a, b) => rank(a) - rank(b) || (a.workspaceId < b.workspaceId ? -1 : 1));
  return { ok: true, workspaces };
}

async function find(
  client: WorkspaceArticleClient,
  workspaceId: string,
): Promise<WorkspaceDiscoveryFailure | { ok: true; parsed: Parsed | null }> {
  const listing = await client.list();
  if (!listing.ok) return discoveryFailure(listing.reason);
  const records = group(listing.articles).get(workspaceId);
  return { ok: true, parsed: records ? toEntry(workspaceId, records) : null };
}

export async function readWorkspaceArticle(
  client: WorkspaceArticleClient,
  workspaceId: string,
): Promise<ReadWorkspaceArticleResult> {
  const found = await find(client, workspaceId);
  if (!found.ok) return found;
  if (!found.parsed) return notFound(workspaceId);
  return { ok: true, entry: found.parsed.entry };
}

function notFound(workspaceId: string) {
  return { ok: false as const, reason: 'not-found' as const, message: `Workspace ${workspaceId} has no configuration article.` };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

// Same document, ignoring formatting and key order. YouTrack may store an
// article body with different whitespace than was sent.
function sameContent(a: string, b: string): boolean {
  if (a === b) return true;
  const strip = (s: string) => s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return stableStringify(JSON.parse(strip(a))) === stableStringify(JSON.parse(strip(b)));
  } catch {
    return false;
  }
}

function invalidEdit(errors: WorkspaceValidationError[]): SaveWorkspaceArticleResult {
  return { ok: false, reason: 'invalid-edit', errors, message: `The workspace edit is not valid: ${describeErrors(errors)}` };
}

function refusal(entry: WorkspaceArticleEntry): SaveWorkspaceArticleResult {
  if (entry.status === 'ambiguous') {
    return { ok: false, reason: 'ambiguous', articleIds: entry.articleIds, message: entry.message };
  }
  if (entry.status === 'invalid') {
    return { ok: false, reason: 'invalid-remote', articleId: entry.articleId, errors: entry.errors, message: entry.message };
  }
  throw new Error('unreachable');
}

/**
 * Write an edit over the workspace's existing article.
 *
 * `base` is the document the edit started from. Pass null only when there is
 * no base — a create that found the article already exists: then any
 * difference from the article is a conflict, so it is never overwritten.
 */
export async function updateWorkspaceArticle(
  client: WorkspaceArticleClient,
  base: WorkspaceDocument | null,
  edited: WorkspaceDocument,
): Promise<SaveWorkspaceArticleResult> {
  const editErrors = validateWorkspaceDocument(edited);
  if (editErrors.length > 0) return invalidEdit(editErrors);
  if (base) {
    const baseErrors = validateWorkspaceDocument(base);
    if (baseErrors.length > 0) return invalidEdit(baseErrors);
  }
  const workspaceId = edited.workspaceId;

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    // 1. Discover — every attempt, so a duplicate created meanwhile is caught.
    const found = await find(client, workspaceId);
    if (!found.ok) return found;
    if (!found.parsed) return notFound(workspaceId);
    if (found.parsed.kind !== 'ok') return refusal(found.parsed.entry);
    const { record, source, entry } = found.parsed;
    const remote = entry.document;

    // 2. Merge the edit into what the article holds now.
    const merged = mergeWorkspaceEdit(base, edited, remote);
    if (!merged.ok) {
      return {
        ok: false,
        reason: 'conflict',
        conflicts: merged.conflicts,
        remote,
        message:
          `Workspace ${workspaceId} was changed elsewhere in a way that conflicts with this edit ` +
          `(${merged.conflicts.map((c) => c.path || 'workspace').join(', ')}). Nothing was saved.`,
      };
    }
    if (stableStringify(merged.document) === stableStringify(remote)) {
      return { ok: true, document: remote, articleId: record.id, updated: record.updated, created: false, unchanged: true };
    }

    // 3. Serialise over the source from this read: unknown fields go back.
    const content = serialiseUpdatedWorkspaceDocument(source, merged.document);

    // 4. Last look before the unconditional write. If it moved, start again.
    const latest = await client.get(record.id);
    if (!latest) return { ok: false, reason: 'write-failed', message: `Could not re-read workspace ${workspaceId} before saving.` };
    if (latest.updated !== record.updated || !sameContent(latest.content, record.content)) continue;

    // 5. Write.
    const written = await client.update(record.id, content);
    if (!written) return { ok: false, reason: 'write-failed', message: `YouTrack did not accept the update to workspace ${workspaceId}.` };

    // 6. Read back. Anything other than what we wrote means another writer
    // landed after us; go round again and merge onto theirs.
    const after = await client.get(record.id);
    if (after && sameContent(after.content, content)) {
      return {
        ok: true,
        document: merged.document,
        articleId: record.id,
        updated: after.updated,
        created: false,
        unchanged: false,
      };
    }
  }
  return {
    ok: false,
    reason: 'race-unresolved',
    attempts: MAX_WRITE_ATTEMPTS,
    message:
      `Workspace ${workspaceId} kept changing while saving (${MAX_WRITE_ATTEMPTS} attempts). ` +
      'The edit is not known to have been saved; reload the workspace and try again.',
  };
}

/**
 * Create the workspace's article. If one already exists this becomes an
 * update with no base (never an overwrite); if several exist it is refused.
 */
export async function createWorkspaceArticle(
  client: WorkspaceArticleClient,
  doc: WorkspaceDocument,
): Promise<SaveWorkspaceArticleResult> {
  const errors = validateWorkspaceDocument(doc);
  if (errors.length > 0) return invalidEdit(errors);

  const found = await find(client, doc.workspaceId);
  if (!found.ok) return found;
  if (found.parsed) {
    if (found.parsed.kind !== 'ok') return refusal(found.parsed.entry);
    return updateWorkspaceArticle(client, null, doc);
  }

  const created = await client.create(doc.workspaceId, serialiseNewWorkspaceDocument(doc));
  if (!created) return { ok: false, reason: 'write-failed', message: `YouTrack did not create workspace ${doc.workspaceId}.` };

  // Verify by discovering again. Titles are not unique in YouTrack, so another
  // machine may have created the same workspace at the same moment. Success
  // only when exactly one valid article holds the title and it is ours. Any
  // other outcome is reported, and the new article is never touched: a failed
  // verification does not mean the create failed.
  const recheck = await find(client, doc.workspaceId);
  const unverified = (why: string): SaveWorkspaceArticleResult => ({
    ok: false,
    reason: 'create-unverified',
    articleId: created.id,
    message: `Workspace ${doc.workspaceId} was created as article ${created.id}, but ${why}. It may exist; check before creating it again.`,
  });
  if (!recheck.ok) return unverified(`it could not be confirmed (${recheck.message})`);
  if (!recheck.parsed) return unverified('discovery did not find it afterwards');
  if (recheck.parsed.kind !== 'ok') return refusal(recheck.parsed.entry); // ambiguous or invalid
  const { entry } = recheck.parsed;
  if (entry.articleId !== created.id) return unverified(`discovery found a different article (${entry.articleId}) under its title`);

  return {
    ok: true,
    document: entry.document,
    articleId: entry.articleId,
    updated: entry.updated,
    created: true,
    unchanged: false,
  };
}
