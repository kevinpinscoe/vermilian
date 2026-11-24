import { describe, expect, it } from 'vitest';
import { createTaskService, AI_CREATE_WORKSPACE_CHANGED_MESSAGE, CREATE_WORKSPACE_CHANGED_MESSAGE, type CreateTaskDeps } from './createTask';
import { parseYouTrackProjectFields, type YouTrackProjectMetadata } from '../../shared/youtrackProjectFields';
import type { AiCreateTaskResult, CreateIssueArgs } from '../../shared/ipc';
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
  /** Runs when the create request arrives, before it fails or succeeds. */
  onCreate?: () => void;
  /** Bump the workspace generation during the metadata read. */
  switchDuringRead?: boolean;
  connectionError?: string;
} = {}) {
  let generation = 1;
  let active = opts.active ?? 'ws-a';
  const creates: CreateIssuePayload[] = [];
  const reads: string[] = [];
  /** Each metadata read, with the workspace whose connection made it. */
  const readsBy: Array<{ workspaceId: string; projectId: string }> = [];
  const projects = opts.projects ?? { 'p-1': metadata(['Triage', 'Doing', 'Shipped'], 'Triage') };
  const deps: CreateTaskDeps = {
    activeWorkspaceId: async () => active,
    generation: () => generation,
    async connection(workspaceId) {
      if (opts.connectionError) return { ok: false, error: opts.connectionError };
      return {
        ok: true,
        async readMetadata(projectId) {
          reads.push(projectId);
          readsBy.push({ workspaceId, projectId });
          if (opts.switchDuringRead) generation++;
          const m = projects[projectId];
          if (!m) throw { status: 404, message: `Entity with id ${projectId} not found` };
          return m;
        },
        async create(payload) {
          creates.push(payload);
          opts.onCreate?.();
          if (opts.createError) throw opts.createError;
          return { id: '2-1', idReadable: 'P-1' };
        },
      };
    },
  };
  /** The user switches the active workspace. */
  const switchTo = (id: string) => { active = id; generation++; };
  return { svc: createTaskService(deps), creates, reads, readsBy, switchTo };
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
    expect(r.error).toBe('YouTrack rejected the request but did not identify the field.');
    expect(r.refreshOptions).toBe(true);
    expect(r.rejected).toBeUndefined();
  });

  // Regression (VERM-115 review): a submitted Status of "Open" and an
  // Open-type ({1}) refusal do not identify the field while the project
  // still offers Open.
  it('does not name Status "Open" from an Open-type ({1}) refusal when fresh metadata still offers Open', async () => {
    const h = harness({ projects: { 'p-1': metadata(['Open', 'Closed']) }, createError: { status: 400, message: RECORDED } });
    const r = await h.svc.create(args({ status: 'Open' }));
    expect(r).toEqual({ ok: false, error: 'YouTrack rejected the request but did not identify the field.', refreshOptions: true });
  });

  it('names the field when fresh metadata confirms the sent value is no longer offered', async () => {
    const projects = { 'p-1': metadata(['Open', 'Closed']) };
    // The bundle changes between the check and the create.
    const h = harness({ projects, createError: { status: 400, message: RECORDED }, onCreate: () => { projects['p-1'] = metadata(['Closed']); } });
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

describe('createTaskService.create — bound to the originating workspace', () => {
  it("reads and creates on the origin workspace's own connection", async () => {
    const h = harness();
    await h.svc.create(args({ status: 'Doing' }));
    expect(h.readsBy).toEqual([{ workspaceId: 'ws-a', projectId: 'p-1' }]);
    expect(h.creates).toHaveLength(1);
  });

  it('quick add (no workspace named) binds to the active workspace', async () => {
    const h = harness({ active: 'ws-q' });
    await h.svc.create(args({ workspaceId: undefined }));
    expect(h.readsBy.map((r) => r.workspaceId)).toEqual(['ws-q']);
  });
});

describe('createTaskService.aiCreate (VERM-115)', () => {
  const answer = (fields: Partial<NonNullable<AiCreateTaskResult['fields']>>): AiCreateTaskResult => ({
    ok: true,
    fields: {
      summary: 'S', projectId: null, priority: null, status: null, category: null, dueDate: null,
      ticket: null, notes: null, projectMatchError: false, clarificationNeeded: null, ...fields,
    },
  });
  const projects = { 'p-1': metadata(['Triage', 'Doing'], 'Triage'), 'p-2': metadata(['Backlog', 'Active']) };

  it("gives Claude the known project's values and validates the project Claude chose, on the origin's connection", async () => {
    const h = harness({ projects });
    const origin = await h.svc.origin('ws-a');
    if (!origin.ok) throw new Error('origin');
    let allowed: string[] | null = null;
    const r = await h.svc.aiCreate(origin.origin, 'p-1', async (a) => {
      allowed = a ? a.status.values : null;
      return { ok: true, value: answer({ projectId: 'p-2', status: 'Doing' }) };
    });
    expect(allowed).toEqual(['Triage', 'Doing']);
    expect(r.fields?.status).toBeNull();
    expect(r.fields?.clearedSuggestions).toEqual([{ field: 'Status', value: 'Doing' }]);
    expect(h.readsBy).toEqual([{ workspaceId: 'ws-a', projectId: 'p-1' }, { workspaceId: 'ws-a', projectId: 'p-2' }]);
  });

  // Regression (VERM-115 review): the user moves from A to B while Claude is
  // answering A's request. The lookup for the project Claude chose is
  // cancelled: B's connection receives no metadata request for A's task.
  it('cancels the post-Claude lookup when the user switches workspace during extraction', async () => {
    const h = harness({ projects });
    const origin = await h.svc.origin('ws-a');
    if (!origin.ok) throw new Error('origin');
    const r = await h.svc.aiCreate(origin.origin, '', async () => {
      h.switchTo('ws-b');
      return { ok: true, value: answer({ projectId: 'p-2', status: 'Backlog' }) };
    });
    expect(r).toEqual({ ok: false, error: AI_CREATE_WORKSPACE_CHANGED_MESSAGE });
    expect(h.readsBy).toEqual([]);
    expect(h.creates).toEqual([]);
  });

  it('cancels before the known-project read when the switch happened first', async () => {
    const h = harness({ projects });
    const origin = await h.svc.origin('ws-a');
    if (!origin.ok) throw new Error('origin');
    h.switchTo('ws-b');
    let extracted = false;
    const r = await h.svc.aiCreate(origin.origin, 'p-1', async () => { extracted = true; return { ok: true, value: answer({}) }; });
    expect(r).toEqual({ ok: false, error: AI_CREATE_WORKSPACE_CHANGED_MESSAGE });
    expect(extracted).toBe(false);
    expect(h.readsBy).toEqual([]);
  });
});
