// Task creation against the selected project's own field configuration
// (VERM-115), for New task, AI create and the board's quick add alike.
//
// Two operations, both on the active workspace's own YouTrack connection and
// nothing else (ADR-0011, VERM-47):
//
//   - getOptions: the project's Status/Priority/Category values and defaults,
//     read with VERM-114's metadata reader, for the form to offer.
//   - create: the main-process recheck. The requested workspace must still be
//     the active one, the project must be readable on that connection, and
//     every submitted value must be one the project offers — otherwise
//     nothing is sent. Empty fields are omitted so YouTrack applies its own
//     defaults. A server refusal is explained by field and value where the
//     response or a fresh read identifies them.
//
// Dependencies are injected so the whole decision is unit-tested without
// Electron (createTask.test.ts).

import type { CreateFieldOptionsResult, CreateIssueArgs, CreateIssueResult } from '../../shared/ipc';
import {
  createFieldOptionsFromMetadata,
  explainCreateError,
  invalidCreateValues,
  rejectedValueMessage,
  type CreateFieldOptions,
} from '../../shared/createFieldOptions';
import type { YouTrackProjectMetadata } from '../../shared/youtrackProjectFields';
import type { CreateIssuePayload, CreateIssueResult as YouTrackCreateResult } from '../api/youtrack';

export const CREATE_WORKSPACE_CHANGED_MESSAGE =
  'The active workspace changed before the task was created, so nothing was sent. Check the form and try again.';

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
  /** The workspace switch counter, read before and after the checks. */
  generation: () => number;
  /** The active workspace's own YouTrack connection, with no fallback. */
  connection: () => Promise<CreateTaskConnection>;
}

function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : fallback;
}

/** The workspace the renderer asked from, refused if it is no longer active. Absent means "the active one". */
function workspaceMismatch(requested: unknown, active: string): boolean {
  return typeof requested === 'string' && requested !== '' && requested !== active;
}

export function createTaskService(deps: CreateTaskDeps) {
  async function readOptions(projectId: string): Promise<{ ok: true; options: CreateFieldOptions } | { ok: false; error: string }> {
    const conn = await deps.connection();
    if (!conn.ok) return { ok: false, error: conn.error };
    try {
      return { ok: true, options: createFieldOptionsFromMetadata(await conn.readMetadata(projectId)) };
    } catch (e) {
      return { ok: false, error: errorMessage(e, "Could not read the project's fields.") };
    }
  }

  async function getOptions(args: unknown): Promise<CreateFieldOptionsResult> {
    const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
    const projectId = typeof a.projectId === 'string' ? a.projectId : '';
    const workspaceId = typeof a.workspaceId === 'string' ? a.workspaceId : '';
    if (!projectId) return { ok: false, workspaceId, projectId, error: 'A project is required.' };
    const start = deps.generation();
    if (workspaceMismatch(a.workspaceId, await deps.activeWorkspaceId())) {
      return { ok: false, workspaceId, projectId, error: CREATE_WORKSPACE_CHANGED_MESSAGE, refused: 'not-active' };
    }
    const r = await readOptions(projectId);
    if (deps.generation() !== start) {
      return { ok: false, workspaceId, projectId, error: CREATE_WORKSPACE_CHANGED_MESSAGE, refused: 'not-active' };
    }
    if (!r.ok) return { ok: false, workspaceId, projectId, error: r.error };
    return { ok: true, workspaceId, projectId, options: r.options };
  }

  async function create(args: CreateIssueArgs): Promise<CreateIssueResult> {
    const start = deps.generation();
    if (workspaceMismatch(args.workspaceId, await deps.activeWorkspaceId())) {
      return { ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE };
    }
    const conn = await deps.connection();
    if (!conn.ok) return { ok: false, error: conn.error };

    // The selected project, read on this connection, and its current options.
    let options: CreateFieldOptions;
    try {
      options = createFieldOptionsFromMetadata(await conn.readMetadata(args.projectId));
    } catch (e) {
      return {
        ok: false,
        error: `Could not check the project's fields, so nothing was created: ${errorMessage(e, 'read failed')}`,
        refreshOptions: true,
      };
    }

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
    if (deps.generation() !== start) return { ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE };

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
    };
    try {
      const result = await conn.create(payload);
      return { ok: true, id: result.id, idReadable: result.idReadable };
    } catch (e) {
      const raw = errorMessage(e, 'Create failed');
      // A fresh read can show which sent value the project no longer offers.
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

  return { getOptions, create, readOptions };
}
