import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkRole, prerequisitesOf } from '../../shared/issueLink';

// The fake reads VERMILIAN_E2E_YT_RUNWAY_FIXTURES when it loads, so each case
// loads a fresh copy.
async function loadFake(flag: string | undefined) {
  vi.resetModules();
  if (flag === undefined) delete process.env.VERMILIAN_E2E_YT_RUNWAY_FIXTURES;
  else process.env.VERMILIAN_E2E_YT_RUNWAY_FIXTURES = flag;
  return import('./fakeYouTrack');
}

afterEach(() => {
  delete process.env.VERMILIAN_E2E_YT_RUNWAY_FIXTURES;
});

describe('fake YouTrack links (VERM-94)', () => {
  it('without the flag, has no READ, SYNC or PLAT and no links', async () => {
    const fake = await loadFake(undefined);
    const shortNames = (await fake.getProjects('', '')).map((p) => p.shortName);
    expect(shortNames).toEqual(['TEST', 'TST2', 'INB', 'EMP']);
    const issues = await fake.getIssues('', '', 'TEST');
    expect(issues.every((i) => Array.isArray(i.links) && i.links.length === 0)).toBe(true);
  });

  it('with the flag, carries Depend links among READ, SYNC and PLAT in both directions', async () => {
    const fake = await loadFake('1');
    expect((await fake.getProjects('', '')).map((p) => p.shortName)).toEqual(['TEST', 'TST2', 'INB', 'EMP', 'READ', 'SYNC', 'PLAT']);

    const read14 = await fake.getBoardIssue('', '', 'READ-14');
    expect(read14.summary).toBe('Sync read state between devices');
    expect(prerequisitesOf(read14.links ?? []).map((l) => [l.issue.key, l.verb, l.issue.resolved])).toEqual([['SYNC-3', 'depends on', false]]);

    const sync3 = await fake.getBoardIssue('', '', 'SYNC-3');
    expect((sync3.links ?? []).map((l) => [l.issue.key, l.direction, l.verb, linkRole(l)])).toEqual([['READ-14', 'outward', 'is required for', 'dependent']]);

    const sync7 = await fake.getBoardIssue('', '', 'SYNC-7');
    expect(prerequisitesOf(sync7.links ?? []).map((l) => l.issue.key)).toEqual(['PLAT-40']);

    // Relates and Subtask are carried, never as prerequisites.
    const read12 = await fake.getBoardIssue('', '', 'READ-12');
    expect((read12.links ?? []).map((l) => [l.type, l.issue.key, linkRole(l)])).toEqual([['Relates', 'READ-9', null], ['Subtask', 'READ-20', null]]);
  });
});
