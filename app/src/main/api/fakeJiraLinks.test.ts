import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapJiraIssue } from '../../shared/jiraBoardIssue';
import { linkRole, prerequisitesOf } from '../../shared/issueLink';

// The fake reads VERMILIAN_E2E_JIRA_RUNWAY_FIXTURES when it loads, so each
// case loads a fresh copy.
async function loadFake(flag: string | undefined) {
  vi.resetModules();
  if (flag === undefined) delete process.env.VERMILIAN_E2E_JIRA_RUNWAY_FIXTURES;
  else process.env.VERMILIAN_E2E_JIRA_RUNWAY_FIXTURES = flag;
  return import('./fakeJira');
}

afterEach(() => {
  delete process.env.VERMILIAN_E2E_JIRA_RUNWAY_FIXTURES;
});

const TOKEN = 'e2e-fake-jira-token';

describe('fake Jira links (VERM-95)', () => {
  it('without the flag, has no OPS-956 or OPS-4089 and no issuelinks', async () => {
    const fake = await loadFake(undefined);
    expect(fake.FAKE_JIRA_ISSUES.map((i) => i.key)).not.toContain('OPS-956');
    const issue = await fake.getIssue('', '', TOKEN, 'DEMO-102');
    expect((issue.fields as Record<string, unknown>).issuelinks).toBeUndefined();
  });

  it('with the flag, carries Blocks links in both directions and a Relates link', async () => {
    const fake = await loadFake('1');
    const ops956 = mapJiraIssue(await fake.getIssue('', '', TOKEN, 'OPS-956'));
    expect(prerequisitesOf(ops956.links ?? []).map((l) => [l.issue.key, l.verb, l.issue.resolved])).toEqual([['OPS-4089', 'is blocked by', false]]);
    expect((ops956.links ?? []).map((l) => [l.type, l.issue.key, linkRole(l)])).toEqual([['Blocks', 'OPS-4089', 'prerequisite'], ['Relates', 'DEMO-102', null]]);

    const ops4089 = mapJiraIssue(await fake.getIssue('', '', TOKEN, 'OPS-4089'));
    expect((ops4089.links ?? []).map((l) => [l.issue.key, l.direction, l.verb, linkRole(l)])).toEqual([['OPS-956', 'outward', 'blocks', 'dependent']]);

    // The batch key read carries them too, with each linked status read now.
    expect(fake.applyChangeForTests({ op: 'edit', key: 'OPS-4089', status: { name: 'Done', category: 'done' } })).toBe(true);
    const [again] = await fake.searchJql('', '', TOKEN, 'key in ("OPS-956")', []);
    expect(prerequisitesOf(mapJiraIssue(again).links ?? []).map((l) => l.issue.resolved)).toEqual([true]);
  });
});
