import { describe, expect, it } from 'vitest';
import { createTaskService, CREATE_WORKSPACE_CHANGED_MESSAGE, type CreateTaskDeps } from './createTask';
import { parseYouTrackProjectFields, type YouTrackProjectMetadata } from '../../shared/youtrackProjectFields';
import type { CreateIssueArgs } from '../../shared/ipc';
import type { CreateIssuePayload } from '../api/youtrack';

const RECORDED = 'An Open-type entity with the specified name ({1}) was not found';

function metadata(status: string[], statusDefault: string | null = null): YouTrackProjectMetadata {
  return parseYouTrackProjectFields([
    {
      field: { name: 'Status' },
      $type: 'StateProjectCustomField',
      canBeEmpty: false,
      defaultValues: statusDefault ? [{ name: statusDefault }] : [],
      bundle: { values: status.map((name, ordinal) => ({ name, ordinal })) },
    },
    { field: { name: 'Priority' }, $type: 'EnumProjectCustomField', canBeEmpty: true, bundle: { values: [{ name: 'High', ordinal: 0 }, { name: 'Low', ordinal: 1 }] } },
  ]);
}

function harness(opts: {
  active?: string;
  projects?: Record<string, YouTrackProjectMetadata>;
  createError?: unknown;
  /** Bump the workspace generation during the metadata read. */
  switchDuringRead?: boolean;
  connectionError?: string;
} = {}) {
  let generation = 1;
  const creates: CreateIssuePayload[] = [];
  const reads: string[] = [];
  const projects = opts.projects ?? { 'p-1': metadata(['Triage', 'Doing', 'Shipped'], 'Triage') };
  const deps: CreateTaskDeps = {
    activeWorkspaceId: async () => opts.active ?? 'ws-a',
    generation: () => generation,
    async connection() {
      if (opts.connectionError) return { ok: false, error: opts.connectionError };
      return {
        ok: true,
        async readMetadata(projectId) {
          reads.push(projectId);
          if (opts.switchDuringRead) generation++;
          const m = projects[projectId];
          if (!m) throw { status: 404, message: `Entity with id ${projectId} not found` };
          return m;
        },
        async create(payload) {
          creates.push(payload);
          if (opts.createError) throw opts.createError;
          return { id: '2-1', idReadable: 'P-1' };
        },
      };
    },
  };
  return { svc: createTaskService(deps), creates, reads };
}

function args(over: Partial<CreateIssueArgs> = {}): CreateIssueArgs {
  return {
    workspaceId: 'ws-a', projectId: 'p-1', summary: 'S', status: null, priority: null, category: null,
    dueDate: null, ticket: null, ticketLink: null, relatedLink: null, notes: null, repoUrl: null, ...over,
  };
}

describe('createTaskService.create — main-process recheck (VERM-115)', () => {
  it('creates with valid values, omitting empty ones so YouTrack applies its defaults', async () => {
    const h = harness();
    const r = await h.svc.create(args({ status: 'Doing', priority: '', category: '' }));
    expect(r).toEqual({ ok: true, id: '2-1', idReadable: 'P-1' });
    expect(h.creates).toHaveLength(1);
    expect(h.creates[0]).toMatchObject({ status: 'Doing', priority: null, category: null });
  });

  it('makes zero create requests for a value the project does not offer, and names it', async () => {
    const h = harness();
    const r = await h.svc.create(args({ status: 'To do', priority: 'High' }));
    expect(h.creates).toHaveLength(0);
    expect(r.ok).toBe(false);
    expect(r.rejected).toEqual([{ field: 'Status', value: 'To do' }]);
    expect(r.error).toContain('Status "To do" is not a value in this project.');
    expect(r.refreshOptions).toBe(true);
  });

  it('makes zero create requests for a field the project does not have', async () => {
    const h = harness();
    const r = await h.svc.create(args({ category: 'OPS' }));
    expect(h.creates).toHaveLength(0);
    expect(r.rejected).toEqual([{ field: 'Category', value: 'OPS' }]);
  });

  it('refuses, before any read, when the form came from another workspace', async () => {
    const h = harness({ active: 'ws-b' });
    const r = await h.svc.create(args({ workspaceId: 'ws-a', status: 'Doing' }));
    expect(r).toEqual({ ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE });
    expect(h.reads).toHaveLength(0);
    expect(h.creates).toHaveLength(0);
  });

  it('refuses when the active workspace switches during the check', async () => {
    const h = harness({ switchDuringRead: true });
    const r = await h.svc.create(args({ status: 'Doing' }));
    expect(r).toEqual({ ok: false, error: CREATE_WORKSPACE_CHANGED_MESSAGE });
    expect(h.creates).toHaveLength(0);
  });

  it('refuses when the selected project cannot be read on this connection', async () => {
    const h = harness();
    const r = await h.svc.create(args({ projectId: 'p-elsewhere' }));
    expect(h.creates).toHaveLength(0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('nothing was created');
    expect(r.refreshOptions).toBe(true);
  });

  it('does not fall back when the workspace connection is unavailable', async () => {
    const h = harness({ connectionError: 'The active workspace has no YouTrack credential.' });
    expect(await h.svc.create(args())).toEqual({ ok: false, error: 'The active workspace has no YouTrack credential.' });
  });

  it("explains YouTrack's unfilled {1} refusal as ambiguous and offers a refresh", async () => {
    const h = harness({ createError: { status: 400, message: RECORDED } });
    const r = await h.svc.create(args({ status: 'Doing', priority: 'High' }));
    expect(h.creates).toHaveLength(1);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('did not say which field');
    expect(r.error).not.toContain('{1}');
    expect(r.refreshOptions).toBe(true);
    expect(r.rejected).toBeUndefined();
  });

  it('names the field when the refused value is the one in the template', async () => {
    const h = harness({ projects: { 'p-1': metadata(['Open', 'Closed']) }, createError: { status: 400, message: RECORDED } });
    const r = await h.svc.create(args({ status: 'Open' }));
    expect(r.rejected).toEqual([{ field: 'Status', value: 'Open' }]);
    expect(r.error).toBe('YouTrack refused Status "Open": not a value in this project.');
  });

  it('passes any other server error through', async () => {
    const h = harness({ createError: { status: 403, message: 'Forbidden' } });
    expect(await h.svc.create(args())).toEqual({ ok: false, error: 'Forbidden' });
  });
});

describe('createTaskService.getOptions', () => {
  it('answers for the exact workspace and project asked, with the derived options', async () => {
    const h = harness();
    const r = await h.svc.getOptions({ workspaceId: 'ws-a', projectId: 'p-1' });
    expect(r.ok).toBe(true);
    expect(r.workspaceId).toBe('ws-a');
    expect(r.projectId).toBe('p-1');
    expect(r.options?.status).toEqual({ present: true, values: ['Triage', 'Doing', 'Shipped'], defaultValue: 'Triage', canBeEmpty: false });
    expect(r.options?.category.present).toBe(false);
  });

  it('refuses a workspace that is no longer active', async () => {
    const h = harness({ active: 'ws-b' });
    const r = await h.svc.getOptions({ workspaceId: 'ws-a', projectId: 'p-1' });
    expect(r).toMatchObject({ ok: false, refused: 'not-active', projectId: 'p-1' });
    expect(h.reads).toHaveLength(0);
  });

  it('reports a failed read so the form can offer Retry', async () => {
    const h = harness();
    const r = await h.svc.getOptions({ workspaceId: 'ws-a', projectId: 'missing' });
    expect(r).toMatchObject({ ok: false, projectId: 'missing', error: 'Entity with id missing not found' });
  });

  it('requires a project', async () => {
    expect((await harness().svc.getOptions({})).ok).toBe(false);
  });
});
