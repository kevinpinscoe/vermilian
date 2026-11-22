import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as JiraClient from '../api/jira';
import { isValidBoardId, isValidProjectKey } from '../api/jira';
import { openRunwayDb } from '../services/runwayDb';
import { createRunwayItemStore, type RunwayItemStore } from '../services/runwayItemStore';
import { jiraRunwayLookup, jiraWorkspaceAdmits, readAdmittedJiraIssue, type JiraAdmissionScope } from './jiraAdmission';
import { createJiraProvider } from './jiraProvider';

// Synthetic keys and hosts only (ADR-0011 §10).

function scope(overrides: Partial<JiraAdmissionScope> = {}): JiraAdmissionScope {
  return {
    projectKeys: ['READ'],
    boardIds: [12],
    isOnBoard: vi.fn(async () => false),
    isOnRunway: vi.fn(() => false),
    ...overrides,
  };
}

describe('jiraWorkspaceAdmits', () => {
  it('admits a ticket in one of the projects without asking the Runway or any board', async () => {
    const s = scope();
    expect(await jiraWorkspaceAdmits(s, 'READ-9')).toBe(true);
    expect(s.isOnRunway).not.toHaveBeenCalled();
    expect(s.isOnBoard).not.toHaveBeenCalled();
  });

  it('admits a Runway ticket from outside the projects and boards, without asking a board', async () => {
    const s = scope({ isOnRunway: vi.fn((key: string) => key === 'OPS-4089') });
    expect(await jiraWorkspaceAdmits(s, 'OPS-4089')).toBe(true);
    expect(s.isOnRunway).toHaveBeenCalledWith('OPS-4089');
    expect(s.isOnBoard).not.toHaveBeenCalled();
  });

  it('asks the boards only after the projects and the Runway, and stops at the first yes', async () => {
    const order: string[] = [];
    const s = scope({
      boardIds: [12, 14, 16],
      isOnRunway: vi.fn(() => (order.push('runway'), false)),
      isOnBoard: vi.fn(async (id: number) => (order.push(`board ${id}`), id === 14)),
    });
    expect(await jiraWorkspaceAdmits(s, 'OPS-956')).toBe(true);
    expect(order).toEqual(['runway', 'board 12', 'board 14']);
  });

  it('refuses a ticket that is neither in scope nor on the Runway', async () => {
    const s = scope({ boardIds: [12, 14] });
    expect(await jiraWorkspaceAdmits(s, 'OPS-956')).toBe(false);
    expect(s.isOnBoard).toHaveBeenCalledTimes(2);
  });
});

describe('readAdmittedJiraIssue', () => {
  const issue = (key: string) => ({ idReadable: key });

  it('refuses before reading a ticket the workspace does not admit', async () => {
    const read = vi.fn(async (key: string) => issue(key));
    const result = await readAdmittedJiraIssue(scope(), 'OPS-956', read, (i) => i.idReadable);
    expect(result).toEqual({ ok: false, message: expect.stringContaining('OPS-956 is not in') });
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a Runway ticket that moved to a key the workspace does not admit', async () => {
    const s = scope({ isOnRunway: (key) => key === 'OPS-956' });
    const result = await readAdmittedJiraIssue(s, 'OPS-956', async () => issue('PLAT-40'), (i) => i.idReadable);
    expect(result).toEqual({ ok: false, message: expect.stringContaining('moved to PLAT-40') });
  });

  it('admits a moved ticket whose new key is on the Runway', async () => {
    const s = scope({ isOnRunway: (key) => key === 'PLAT-40' });
    const result = await readAdmittedJiraIssue(s, 'READ-9', async () => issue('PLAT-40'), (i) => i.idReadable);
    expect(result).toEqual({ ok: true, value: issue('PLAT-40') });
  });
});

describe('Runway admission against a real Runway store', () => {
  let dir: string;
  let db: DatabaseSync;
  let store: RunwayItemStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vermilian-jira-admission-'));
    db = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
    store = createRunwayItemStore(db);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("jiraRunwayLookup sees one workspace's ticket rows only", () => {
    store.addIssue('ws-a', 'jira:OPS-4089');
    store.addSection('ws-a', 'OPS-956');
    store.addIssue('ws-b', 'jira:OPS-956');
    const a = jiraRunwayLookup(() => store, 'ws-a');
    expect(a('OPS-4089')).toBe(true);
    // A section whose text looks like a key is not a ticket on the Runway.
    expect(a('OPS-956')).toBe(false);
    expect(jiraRunwayLookup(() => store, 'ws-b')('OPS-4089')).toBe(false);
  });

  it('jiraRunwayLookup admits nothing when the Runway cannot be read', () => {
    const broken = jiraRunwayLookup(() => {
      throw new Error('database is locked');
    }, 'ws-a');
    expect(broken('OPS-4089')).toBe(false);
  });

  // The workspace-isolation case: OPS-4089 is outside both workspaces'
  // projects and boards, and on A's Runway only.
  describe('a ticket on workspace A’s Runway only', () => {
    const OPS = {
      id: '20089',
      key: 'OPS-4089',
      fields: { summary: 'Rotate the example.test certificate', status: { name: 'To Do', statusCategory: { key: 'new' } } },
    };
    const conn = { base: 'https://jira.example.test', email: 'user@example.test', token: 'fictional-token' };

    function stubClient() {
      return {
        isValidProjectKey,
        isValidBoardId,
        getIssue: vi.fn(async () => OPS),
        searchJql: vi.fn(async () => []),
        searchBoardIssues: vi.fn(async () => []),
        isIssueOnBoard: vi.fn(async () => false),
      } as unknown as typeof JiraClient;
    }

    // Each workspace as the IPC handlers build it: its own projects, boards,
    // provider (its own connection) and Runway lookup.
    const workspaces = {
      A: { id: 'ws-a', projectKeys: ['READ'], boardIds: [12] },
      B: { id: 'ws-b', projectKeys: ['SYNC'], boardIds: [14] },
    };
    function open(name: keyof typeof workspaces) {
      const w = workspaces[name];
      const client = stubClient();
      const provider = createJiraProvider(client, conn);
      const isOnRunway = jiraRunwayLookup(() => store, w.id);
      const admission: JiraAdmissionScope = {
        projectKeys: w.projectKeys,
        boardIds: w.boardIds,
        isOnBoard: (id, key) => provider.isOnBoard(id, key),
        isOnRunway,
      };
      return {
        client,
        search: (query: string) => provider.searchWorkspace({ projectKeys: w.projectKeys, boardIds: w.boardIds, isOnRunway }, query),
        detail: (key: string) => readAdmittedJiraIssue(admission, key, (k) => provider.getIssueDetail(k), (i) => i.idReadable),
      };
    }

    beforeEach(() => {
      store.addIssue('ws-a', 'jira:OPS-4089');
    });

    it('is found by its exact key in A and refused in B', async () => {
      expect((await open('A').search('ops-4089')).map((i) => i.idReadable)).toEqual(['OPS-4089']);
      expect(await open('B').search('OPS-4089')).toEqual([]);
    });

    it('opens in A and is refused in B', async () => {
      const a = await open('A').detail('OPS-4089');
      expect(a.ok && a.value.idReadable).toBe('OPS-4089');

      const b = open('B');
      expect(await b.detail('OPS-4089')).toEqual({ ok: false, message: expect.stringContaining('OPS-4089 is not in') });
      // Refused before any read of the ticket on B's connection.
      expect(b.client.getIssue).not.toHaveBeenCalled();
    });

    it('A admits it without asking any board; B asks its own board and nothing else', async () => {
      const a = open('A');
      await a.detail('OPS-4089');
      expect(a.client.isIssueOnBoard).not.toHaveBeenCalled();

      const b = open('B');
      await b.detail('OPS-4089');
      expect(vi.mocked(b.client.isIssueOnBoard).mock.calls.map((c) => c[3])).toEqual([14]);
    });
  });
});
