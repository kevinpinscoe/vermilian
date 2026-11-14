import { describe, expect, it } from 'vitest';
import type { BoardIssue } from './workspace';
import { FIELD_KEYS, type BoardIssueFields } from './fields';
import {
  JIRA_DIRECT_READ_GRACE_MS,
  JIRA_FULL_REFRESH_MS,
  JIRA_POLL_GAP_LIMIT_MS,
  JIRA_POLL_INTERVAL_MS,
  JIRA_POLL_WINDOW_MINUTES,
  JIRA_POLL_WINDOW_MS,
  compareUpdated,
  mergeRecentlyUpdated,
  needsFullRefresh,
  reconcileFullRefresh,
  validUpdated,
} from './jiraPoll';

const T0 = Date.parse('2026-11-14T12:00:00.000Z');

function issue(id: string, key: string, over: Partial<BoardIssue> = {}): BoardIssue {
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, null])) as unknown as BoardIssueFields;
  fields.status = 'To Do';
  return {
    id,
    idReadable: key,
    summary: `Summary of ${key}`,
    resolved: null,
    fields,
    parentEpic: null,
    isEpic: false,
    statusRole: 'todo',
    updated: T0,
    ...over,
  };
}

const done = (i: BoardIssue, at = (i.updated ?? T0) + 1000): BoardIssue => ({
  ...i,
  resolved: at,
  statusRole: 'done',
  fields: { ...i.fields, status: 'Done' },
  updated: at,
});

const DEMO = { projectKey: 'DEMO', includeResolved: false };
const ids = (list: BoardIssue[]) => list.map((i) => i.idReadable);

describe('poll constants', () => {
  it('polls every 60 s over a 5 min lookback, with a full refresh every 10 min', () => {
    expect(JIRA_POLL_INTERVAL_MS).toBe(60_000);
    expect(JIRA_POLL_WINDOW_MINUTES).toBe(5);
    expect(JIRA_POLL_WINDOW_MS).toBe(5 * 60_000);
    expect(JIRA_FULL_REFRESH_MS).toBe(10 * 60_000);
  });

  it('protects a directly read issue from search-index lag for five minutes', () => {
    expect(JIRA_DIRECT_READ_GRACE_MS).toBe(5 * 60_000);
    expect(JIRA_DIRECT_READ_GRACE_MS).toBeLessThan(JIRA_FULL_REFRESH_MS);
  });

  it('leaves one poll interval of margin inside the lookback window', () => {
    expect(JIRA_POLL_GAP_LIMIT_MS).toBe(JIRA_POLL_WINDOW_MS - JIRA_POLL_INTERVAL_MS);
    expect(JIRA_POLL_GAP_LIMIT_MS).toBeGreaterThan(JIRA_POLL_INTERVAL_MS);
  });
});

describe('validUpdated', () => {
  it('accepts a finite positive epoch ms', () => {
    expect(validUpdated(T0)).toBe(T0);
  });

  it.each([undefined, null, NaN, Infinity, -1, 0, '2026-11-14', {}])('rejects %p', (v) => {
    expect(validUpdated(v)).toBeNull();
  });
});

describe('compareUpdated', () => {
  const a = issue('1', 'DEMO-1');
  it('orders two valid timestamps', () => {
    expect(compareUpdated({ ...a, updated: T0 + 1 }, a)).toBe('newer');
    expect(compareUpdated({ ...a, updated: T0 - 1 }, a)).toBe('older');
    expect(compareUpdated({ ...a }, a)).toBe('equal');
  });

  it('is unknown when either timestamp is missing or invalid — never "older"', () => {
    expect(compareUpdated({ ...a, updated: null }, a)).toBe('unknown');
    expect(compareUpdated(a, { ...a, updated: undefined })).toBe('unknown');
    expect(compareUpdated({ ...a, updated: NaN }, a)).toBe('unknown');
    expect(compareUpdated({ ...a, updated: null }, { ...a, updated: null })).toBe('unknown');
  });
});

describe('mergeRecentlyUpdated', () => {
  it('replaces an issue by its stable id with a newer version', () => {
    const cur = [issue('1', 'DEMO-1'), issue('2', 'DEMO-2')];
    const upd = issue('1', 'DEMO-1', { summary: 'Edited', updated: T0 + 60_000 });
    const out = mergeRecentlyUpdated(cur, [upd], DEMO);
    expect(ids(out)).toEqual(['DEMO-1', 'DEMO-2']);
    expect(out[0].summary).toBe('Edited');
  });

  it('matches by id, not by key, so a renamed key replaces rather than duplicates', () => {
    const cur = [issue('1', 'DEMO-1')];
    const out = mergeRecentlyUpdated(cur, [issue('1', 'DEMO-9', { updated: T0 + 1 })], DEMO);
    expect(ids(out)).toEqual(['DEMO-9']);
  });

  it('never lets an older search result overwrite a newer issue read directly', () => {
    const direct = issue('1', 'DEMO-1', { summary: 'From the detail panel', updated: T0 + 120_000 });
    const staleSearch = issue('1', 'DEMO-1', { summary: 'Lagging search index', updated: T0 });
    const out = mergeRecentlyUpdated([direct], [staleSearch], DEMO);
    expect(out[0]).toBe(direct);
  });

  it('an older result cannot remove a newer issue either (resolved or moved)', () => {
    const direct = issue('1', 'DEMO-1', { updated: T0 + 120_000 });
    expect(mergeRecentlyUpdated([direct], [done(issue('1', 'DEMO-1'), T0)], DEMO)).toEqual([direct]);
    expect(mergeRecentlyUpdated([direct], [issue('1', 'OPS-3', { updated: T0 })], DEMO)).toEqual([direct]);
  });

  it('takes the incoming copy on equal timestamps (same version, latest observation)', () => {
    const cur = [issue('1', 'DEMO-1', { summary: 'old object' })];
    const upd = issue('1', 'DEMO-1', { summary: 'new object' });
    expect(mergeRecentlyUpdated(cur, [upd], DEMO)[0].summary).toBe('new object');
  });

  it('takes the incoming copy when either timestamp is missing, rather than guessing which is older', () => {
    const cur = [issue('1', 'DEMO-1', { summary: 'had a timestamp' })];
    const noTs = issue('1', 'DEMO-1', { summary: 'no timestamp', updated: null });
    expect(mergeRecentlyUpdated(cur, [noTs], DEMO)[0].summary).toBe('no timestamp');

    const curNoTs = [issue('1', 'DEMO-1', { summary: 'no timestamp', updated: null })];
    const withTs = issue('1', 'DEMO-1', { summary: 'has one', updated: T0 - 999_999 });
    expect(mergeRecentlyUpdated(curNoTs, [withTs], DEMO)[0].summary).toBe('has one');
  });

  it('never invents a timestamp', () => {
    const out = mergeRecentlyUpdated([], [issue('5', 'DEMO-5', { updated: null })], DEMO);
    expect(out[0].updated).toBeNull();
  });

  it('adds newly discovered issues, newest first, ahead of the existing ones', () => {
    const cur = [issue('1', 'DEMO-1')];
    const out = mergeRecentlyUpdated(cur, [issue('7', 'DEMO-7', { updated: T0 + 5 })], DEMO);
    expect(ids(out)).toEqual(['DEMO-7', 'DEMO-1']);
  });

  it('drops an issue that became resolved when Show done is off', () => {
    const one = issue('1', 'DEMO-1');
    const out = mergeRecentlyUpdated([one, issue('2', 'DEMO-2')], [done(one)], DEMO);
    expect(ids(out)).toEqual(['DEMO-2']);
  });

  it('keeps it, resolved, when Show done is on', () => {
    const one = issue('1', 'DEMO-1');
    const out = mergeRecentlyUpdated([one], [done(one)], { projectKey: 'DEMO', includeResolved: true });
    expect(out[0].statusRole).toBe('done');
  });

  it('does not add a newly seen resolved issue when Show done is off', () => {
    expect(mergeRecentlyUpdated([], [done(issue('9', 'DEMO-9'))], DEMO)).toEqual([]);
  });

  it('drops an issue known to have moved to another project, and never adds one from another project', () => {
    const cur = [issue('1', 'DEMO-1'), issue('2', 'DEMO-2')];
    const moved = issue('1', 'OPS-12', { updated: T0 + 1 });
    expect(ids(mergeRecentlyUpdated(cur, [moved, issue('3', 'OPS-13')], DEMO))).toEqual(['DEMO-2']);
  });

  it('reopening a resolved issue brings it back', () => {
    const one = issue('1', 'DEMO-1');
    const reopened = { ...one, updated: T0 + 9000 };
    expect(ids(mergeRecentlyUpdated([], [reopened], DEMO))).toEqual(['DEMO-1']);
  });

  it('returns the same array when nothing changes, and never mutates its input', () => {
    const cur = Object.freeze([issue('1', 'DEMO-1', { updated: T0 + 10 })]) as BoardIssue[];
    expect(mergeRecentlyUpdated(cur, [], DEMO)).toBe(cur);
    expect(mergeRecentlyUpdated(cur, [issue('1', 'DEMO-1')], DEMO)).toBe(cur);
  });

  it('applies duplicate updates of one issue in order, newest still winning', () => {
    const newer = issue('1', 'DEMO-1', { summary: 'newer', updated: T0 + 2 });
    const older = issue('1', 'DEMO-1', { summary: 'older', updated: T0 + 1 });
    expect(mergeRecentlyUpdated([], [newer, older], DEMO)[0].summary).toBe('newer');
  });
});

describe('reconcileFullRefresh', () => {
  it('makes the full result authoritative: issues it no longer lists disappear', () => {
    const cur = [issue('1', 'DEMO-1'), issue('2', 'DEMO-2'), issue('3', 'DEMO-3')];
    // DEMO-2 was deleted, DEMO-3 moved to a project the workspace does not poll.
    const full = [issue('1', 'DEMO-1'), issue('4', 'DEMO-4')];
    expect(ids(reconcileFullRefresh(cur, full, DEMO))).toEqual(['DEMO-1', 'DEMO-4']);
  });

  it('still keeps a newer directly read copy over an older full-search copy', () => {
    const direct = issue('1', 'DEMO-1', { summary: 'direct', updated: T0 + 60_000 });
    const out = reconcileFullRefresh([direct], [issue('1', 'DEMO-1', { summary: 'search' })], DEMO);
    expect(out[0]).toBe(direct);
  });

  it('drops a newer direct copy that is resolved when Show done is off', () => {
    const direct = done(issue('1', 'DEMO-1'), T0 + 60_000);
    expect(reconcileFullRefresh([direct], [issue('1', 'DEMO-1')], DEMO)).toEqual([]);
  });

  describe('issues protected by a recent direct read (search-index lag)', () => {
    it('keeps a protected issue the full result omits, after the listed ones', () => {
      const cur = [issue('1', 'DEMO-1'), issue('7', 'DEMO-7', { summary: 'just read directly' })];
      const out = reconcileFullRefresh(cur, [issue('1', 'DEMO-1')], DEMO, new Set(['7']));
      expect(ids(out)).toEqual(['DEMO-1', 'DEMO-7']);
      expect(out[1]).toBe(cur[1]);
    });

    it('still removes an omitted issue that is not protected', () => {
      const cur = [issue('1', 'DEMO-1'), issue('2', 'DEMO-2'), issue('7', 'DEMO-7')];
      expect(ids(reconcileFullRefresh(cur, [issue('1', 'DEMO-1')], DEMO, new Set(['7'])))).toEqual(['DEMO-1', 'DEMO-7']);
    });

    it('does not keep a protected issue whose cached copy is resolved (Show done off) or in another project', () => {
      const cur = [done(issue('7', 'DEMO-7')), issue('8', 'OPS-8')];
      expect(reconcileFullRefresh(cur, [], DEMO, new Set(['7', '8']))).toEqual([]);
    });

    it('a protected issue the full result does list reconciles normally, newest copy winning', () => {
      const direct = issue('7', 'DEMO-7', { summary: 'direct', updated: T0 + 60_000 });
      const out = reconcileFullRefresh([direct], [issue('7', 'DEMO-7', { summary: 'search', updated: T0 })], DEMO, new Set(['7']));
      expect(out).toEqual([direct]);
      const newer = issue('7', 'DEMO-7', { summary: 'search, newer', updated: T0 + 120_000 });
      expect(reconcileFullRefresh([direct], [newer], DEMO, new Set(['7']))[0].summary).toBe('search, newer');
    });

    it('protects nothing that is not already cached, and never alters a timestamp', () => {
      const cur = [issue('7', 'DEMO-7', { updated: null })];
      const out = reconcileFullRefresh(cur, [], DEMO, new Set(['7', '9']));
      expect(ids(out)).toEqual(['DEMO-7']);
      expect(out[0].updated).toBeNull();
    });
  });

  it('with no earlier data is the full result, in scope', () => {
    const full = [issue('1', 'DEMO-1'), issue('2', 'OPS-2')];
    expect(ids(reconcileFullRefresh(undefined, full, DEMO))).toEqual(['DEMO-1']);
  });
});

describe('needsFullRefresh', () => {
  it('is true with no earlier sync', () => {
    expect(needsFullRefresh(T0, null)).toBe(true);
  });

  it('is false while the last sync started within the gap limit', () => {
    expect(needsFullRefresh(T0 + JIRA_POLL_INTERVAL_MS, T0)).toBe(false);
    expect(needsFullRefresh(T0 + JIRA_POLL_GAP_LIMIT_MS, T0)).toBe(false);
  });

  it('is true after a gap longer than that (sleep, offline, a missed poll window)', () => {
    expect(needsFullRefresh(T0 + JIRA_POLL_GAP_LIMIT_MS + 1, T0)).toBe(true);
    expect(needsFullRefresh(T0 + 60 * 60_000, T0)).toBe(true);
  });

  it('is true when the clock went backwards, since the window can no longer be trusted', () => {
    expect(needsFullRefresh(T0 - 1, T0)).toBe(true);
  });
});
