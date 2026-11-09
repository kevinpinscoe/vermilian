import { describe, it, expect } from 'vitest';
import { toJiraIssueRow, type JiraSearchIssue } from './jiraIssue';

const SITE = 'https://example.atlassian.net';

function issue(overrides: Partial<JiraSearchIssue> = {}): JiraSearchIssue {
  return {
    id: '10001',
    key: 'DEMO-1',
    fields: {
      summary: 'Do the thing',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'High' },
      updated: '2026-11-09T14:00:00.000+0000',
    },
    ...overrides,
  };
}

describe('toJiraIssueRow', () => {
  it('maps key, summary, status, category, priority, updated and the browse URL', () => {
    expect(toJiraIssueRow(issue(), SITE)).toEqual({
      key: 'DEMO-1',
      summary: 'Do the thing',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      priority: 'High',
      updated: '2026-11-09T14:00:00.000+0000',
      url: 'https://example.atlassian.net/browse/DEMO-1',
    });
  });

  it('tolerates a trailing slash on the site URL', () => {
    expect(toJiraIssueRow(issue(), `${SITE}/`).url).toBe(`${SITE}/browse/DEMO-1`);
  });

  it('defaults a missing priority (no priority field on the project) to empty', () => {
    const r = toJiraIssueRow(issue({ fields: { summary: 'x', priority: null } }), SITE);
    expect(r.priority).toBe('');
  });

  it('defaults every field when fields is absent', () => {
    expect(toJiraIssueRow({ id: '1', key: 'X-1' }, SITE)).toEqual({
      key: 'X-1',
      summary: '',
      status: '',
      statusCategory: '',
      priority: '',
      updated: '',
      url: `${SITE}/browse/X-1`,
    });
  });
});
