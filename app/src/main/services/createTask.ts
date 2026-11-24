// Task creation against the selected project's own field configuration
// (VERM-115), for New task, AI create and the board's quick add alike.
//
// Every read and write is bound to the workspace that started the request
// (ADR-0011, VERM-47): `connection(workspaceId)` resolves that workspace's
// own YouTrack connection, never the active one at the moment of the call,
// and each step first confirms that workspace is still active and that no
// switch has happened since the request began. If the user has moved to
// another workspace, the step is cancelled before any request is made.
//
//   - getOptions: the project's Status/Priority/Category values and defaults,
//     read with VERM-114's metadata reader, for the form to offer.
//   - create: the main-process recheck. The requested workspace must still be
//     the active one, the project must be readable on its connection, and
//     every submitted value must be one the project offers — otherwise
//     nothing is sent. Empty fields are omitted so YouTrack applies its own
//     defaults, and `Date time entered` is stamped only when the project
//     defines it as a compatible date field.
//   - aiCreate: AI extraction with the known project's allowed values, then
//     validation against the project Claude chose — both reads on the
//     originating workspace's connection, and the second cancelled if the
//     user switched workspace while Claude was answering.
//
// Dependencies are injected so the whole decision is unit-tested without
// Electron (createTask.test.ts).

import type { AiCreateTaskResult, CreateFieldOptionsResult, CreateIssueArgs, CreateIssueResult } from '../../shared/ipc';
import {
  createFieldOptionsFromMetadata,
  explainCreateError,
  invalidCreateValues,
  rejectedValueMessage,
  sanitizeCreateSuggestions,
  type CreateFieldOptions,
} from '../../shared/createFieldOptions';
import { acceptsDateTimeEntered, type YouTrackProjectMetadata } from '../../shared/youtrackProjectFields';
import type { CreateIssuePayload, CreateIssueResult as YouTrackCreateResult } from '../api/youtrack';

export const CREATE_WORKSPACE_CHANGED_MESSAGE =
  'The active workspace changed before the task was created, so nothing was sent. Check the form and try again.';
export const AI_CREATE_WORKSPACE_CHANGED_MESSAGE =
  'The active workspace changed while the AI was answering, so its suggestion was discarded. Try again.';

export type CreateTaskConnection =
  | {
      ok: true;
      readMetadata: (projectId: string) => Promise<YouTrackProjectMetadata>;
      create: (payload: CreateIssuePayload) => Promise<YouTrackCreateResult>;
    }
  | { ok: false; error: string };

export interface CreateTaskDeps {
  /** The active workspace on this machine ('' when there is none). */
  activeWorkspaceId: () => Promise<string>;
  /** The workspace switch counter, read before and after each step. */
  generation: () => number;
  /** The named workspace's own YouTrack connection, with no fallback. */
  connection: (workspaceId: string) => Promise<CreateTaskConnection>;
}

/** The workspace a request is bound to, and the switch counter when it began. */
export interface CreateTaskOrigin {
  workspaceId: string;
  generation: number;
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string; cancelled?: true; noConnection?: true };

function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : fallback;
}

export function createTaskService(deps: CreateTaskDeps) {
  /**
   * Bind a request to its workspace: the one it names (refused if that is no
   * longer active), or the active one when it names none (quick add).
   */
  async function origin(requested: unknown): Promise<{ ok: true; origin: CreateTaskOrigin } | { ok: false }> {
    const generation = deps.generation();
    const active = await deps.activeWorkspaceId();
    if (typeof requested === 'string' && requested !== '' && requested !== active) return { ok: false };
    return { ok: true, origin: { workspaceId: typeof requested === 'string' && requested ? requested : active, generation } };
  }

  /** Still the same workspace, with no switch since the request began. */
  async function stillCurrent(o: CreateTaskOrigin): Promise<boolean> {
    return deps.generation() === o.generation && (await deps.activeWorkspaceId()) === o.workspaceId;
  }

  /**
   * Read one project's metadata on the origin workspace's connection. Cancelled,
   * with no request made, if the user has switched workspace since the origin.
   */
  async function readMetadata(o: CreateTaskOrigin, projectId: string): Promise<Read<{ meta: YouTrackProjectMetadata; conn: Extract<CreateTaskConnection, { ok: true }> }>> {
    if (!(await stillCurrent(o))) return { ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE, cancelled: true };
    const conn = await deps.connection(o.workspaceId);
    if (!conn.ok) return { ok: false, error: conn.error, noConnection: true };
    if (!(await stillCurrent(o))) return { ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE, cancelled: true };
    try {
      return { ok: true, value: { meta: await conn.readMetadata(projectId), conn } };
    } catch (e) {
      return { ok: false, error: errorMessage(e, "Could not read the project's fields.") };
    }
  }

  async function readOptions(o: CreateTaskOrigin, projectId: string): Promise<Read<CreateFieldOptions>> {
    const r = await readMetadata(o, projectId);
    return r.ok ? { ok: true, value: createFieldOptionsFromMetadata(r.value.meta) } : r;
  }

  async function getOptions(args: unknown): Promise<CreateFieldOptionsResult> {
    const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
    const projectId = typeof a.projectId === 'string' ? a.projectId : '';
    const workspaceId = typeof a.workspaceId === 'string' ? a.workspaceId : '';
    if (!projectId) return { ok: false, workspaceId, projectId, error: 'A project is required.' };
    const b = await origin(a.workspaceId);
    if (!b.ok) return { ok: false, workspaceId, projectId, error: CREATE_WORKSPACE_CHANGED_MESSAGE, refused: 'not-active' };
    const r = await readOptions(b.origin, projectId);
    if (!r.ok) return { ok: false, workspaceId, projectId, error: r.error, ...(r.cancelled ? { refused: 'not-active' as const } : {}) };
    if (!(await stillCurrent(b.origin))) return { ok: false, workspaceId, projectId, error: CREATE_WORKSPACE_CHANGED_MESSAGE, refused: 'not-active' };
    return { ok: true, workspaceId, projectId, options: r.value };
  }

  async function create(args: CreateIssueArgs): Promise<CreateIssueResult> {
    const b = await origin(args.workspaceId);
    if (!b.ok) return { ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE };
    const o = b.origin;

    // The selected project, read on the origin workspace's connection.
    const read = await readMetadata(o, args.projectId);
    if (!read.ok) {
      if (read.cancelled) return { ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE };
      // No fallback to another connection, and nothing to refresh.
      if (read.noConnection) return { ok: false, error: read.error };
      return { ok: false, error: `Could not check the project's fields, so nothing was created: ${read.error}`, refreshOptions: true };
    }
    const { meta, conn } = read.value;
    const options = createFieldOptionsFromMetadata(meta);

    const sent = { status: args.status, priority: args.priority, category: args.category };
    const invalid = invalidCreateValues(options, sent);
    if (invalid.length > 0) {
      return {
        ok: false,
        error: `${invalid.map((r) => rejectedValueMessage(r)).join(' ')} Nothing was created.`,
        rejected: invalid.map(({ field, value }) => ({ field, value })),
        refreshOptions: true,
      };
    }
    if (!(await stillCurrent(o))) return { ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE };

    const payload: CreateIssuePayload = {
      projectId: args.projectId,
      summary: args.summary,
      status: args.status || null,
      priority: args.priority || null,
      category: args.category || null,
      dueDate: args.dueDate,
      ticket: args.ticket,
      ticketLink: args.ticketLink,
      relatedLink: args.relatedLink,
      notes: args.notes,
      repoUrl: args.repoUrl,
      // Only where the project defines a compatible date field.
      dateTimeEntered: acceptsDateTimeEntered(meta),
    };
    try {
      const result = await conn.create(payload);
      return { ok: true, id: result.id, idReadable: result.idReadable };
    } catch (e) {
      const raw = errorMessage(e, 'Create failed');
      // A fresh read can confirm which sent value the project no longer offers.
      let fresh: CreateFieldOptions | null = null;
      try {
        fresh = createFieldOptionsFromMetadata(await conn.readMetadata(args.projectId));
      } catch { /* explained without it */ }
      const explained = explainCreateError(raw, sent, fresh);
      return {
        ok: false,
        error: explained.message,
        ...(explained.rejected.length > 0 ? { rejected: explained.rejected.map(({ field, value }) => ({ field, value })) } : {}),
        ...(explained.ambiguous || explained.rejected.length > 0 ? { refreshOptions: true } : {}),
      };
    }
  }

  /**
   * AI create, bound to the workspace the AI operation began in. `extract`
   * makes the single Anthropic request (with that workspace's key) and is
   * given the known project's allowed values, if any.
   */
  async function aiCreate(
    o: CreateTaskOrigin,
    knownProjectId: string,
    extract: (allowed: CreateFieldOptions | null) => Promise<{ ok: true; value: AiCreateTaskResult } | { ok: false; error: string }>,
  ): Promise<AiCreateTaskResult> {
    // A failed read here is not fatal: the answer is still checked against
    // the matched project below, and again on Create.
    const knownRead = knownProjectId ? await readOptions(o, knownProjectId) : null;
    if (knownRead && !knownRead.ok && knownRead.cancelled) return { ok: false, error: AI_CREATE_WORKSPACE_CHANGED_MESSAGE };
    const allowed = knownRead?.ok ? knownRead.value : null;

    const sent = await extract(allowed);
    if (!sent.ok) return { ok: false, error: sent.error };
    const result = sent.value;
    if (!result.ok || !result.fields || result.fields.clarificationNeeded) return result;

    // Validate against the project the review form will open on — on the
    // origin workspace's connection, and only if the user is still there.
    const target = result.fields.projectId ?? knownProjectId;
    if (!(await stillCurrent(o))) return { ok: false, error: AI_CREATE_WORKSPACE_CHANGED_MESSAGE };
    if (!target) return result;
    const read = target === knownProjectId && knownRead?.ok ? knownRead : await readOptions(o, target);
    if (!read.ok) {
      if (read.cancelled) return { ok: false, error: AI_CREATE_WORKSPACE_CHANGED_MESSAGE };
      return result; // the review form reads the options itself and offers Retry
    }
    const { fields, cleared } = sanitizeCreateSuggestions(result.fields, read.value);
    return {
      ok: true,
      fields: cleared.length > 0 ? { ...fields, clearedSuggestions: cleared.map(({ field, value }) => ({ field, value })) } : fields,
    };
  }

  return { getOptions, create, aiCreate, origin };
}
