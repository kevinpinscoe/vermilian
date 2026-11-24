// `Date time entered` is sent only when the selected project defines it as a
// compatible date field (VERM-115 review). Exercises the real YouTrack client
// end to end — the service decides from the project's metadata, and the test
// reads the JSON body the client actually POSTs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskService } from './createTask';
import { createIssue, getProjectFieldMetadata } from '../api/youtrack';
import type { CreateIssueArgs } from '../../shared/ipc';

const URL = 'https://yt.example.com';
const TOKEN = 'tok';

const STATUS = {
  field: { name: 'Status', fieldType: { id: 'state[1]' } },
  $type: 'StateProjectCustomField',
  canBeEmpty: false,
  defaultValues: [{ name: 'Open' }],
  bundle: { values: [{ name: 'Open', ordinal: 0 }, { name: 'Closed', ordinal: 1 }] },
};
const dateTimeEntered = (fieldType: string) => ({
  field: { name: 'Date time entered', fieldType: { id: fieldType } },
  $type: 'SimpleProjectCustomField',
  canBeEmpty: true,
});

let fetchMock: ReturnType<typeof vi.fn>;
let posted: Array<Record<string, unknown>>;

function serve(projectFields: unknown[]) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const json = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => body });
    if (String(url).includes('/api/admin/projects/')) return json(projectFields);
    if (init.method === 'POST' && String(url).includes('/api/issues')) {
      posted.push(JSON.parse(init.body as string));
      return json({ id: '2-9', idReadable: 'P-9' });
    }
    throw new Error(`unexpected request ${url}`);
  });
}

const service = () =>
  createTaskService({
    activeWorkspaceId: async () => 'ws-a',
    generation: () => 1,
    connection: async () => ({
      ok: true,
      readMetadata: (projectId: string) => getProjectFieldMetadata(URL, TOKEN, projectId),
      create: (payload) => createIssue(URL, TOKEN, payload),
    }),
  });

const ARGS: CreateIssueArgs = {
  workspaceId: 'ws-a', projectId: 'P', summary: 'S', status: 'Open', priority: null, category: null,
  dueDate: null, ticket: null, ticketLink: null, relatedLink: null, notes: null, repoUrl: null,
};

const names = (body: Record<string, unknown>) => (body.customFields as Array<{ name: string }>).map((f) => f.name);

beforeEach(() => {
  fetchMock = vi.fn();
  posted = [];
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const stampOf = (body: Record<string, unknown>) =>
  (body.customFields as Array<{ name: string; $type: string; value: unknown }>).find((f) => f.name === 'Date time entered');

describe('Date time entered on create (VERM-115)', () => {
  // The $type each project field type takes, as the live instance reports it
  // on issues (2026-11-24): `date and time` → SimpleIssueCustomField,
  // `date` → DateIssueCustomField.
  it("is sent as SimpleIssueCustomField when the project's field is date and time", async () => {
    serve([STATUS, dateTimeEntered('date and time')]);
    const before = Date.now();
    expect((await service().create(ARGS)).ok).toBe(true);
    expect(posted).toHaveLength(1);
    const stamp = stampOf(posted[0]);
    expect(stamp).toEqual({ name: 'Date time entered', $type: 'SimpleIssueCustomField', value: expect.any(Number) });
    expect(stamp?.value as number).toBeGreaterThanOrEqual(before);
  });

  it("is sent as DateIssueCustomField when the project's field is date", async () => {
    serve([STATUS, dateTimeEntered('date')]);
    expect((await service().create(ARGS)).ok).toBe(true);
    expect(stampOf(posted[0])).toEqual({ name: 'Date time entered', $type: 'DateIssueCustomField', value: expect.any(Number) });
  });

  it('is omitted when the project has no such field', async () => {
    serve([STATUS]);
    expect((await service().create(ARGS)).ok).toBe(true);
    expect(posted).toHaveLength(1);
    expect(names(posted[0])).toEqual(['Status']);
  });

  it('is omitted when the field exists with an incompatible type', async () => {
    serve([STATUS, dateTimeEntered('string')]);
    expect((await service().create(ARGS)).ok).toBe(true);
    expect(names(posted[0])).toEqual(['Status']);
  });
});
