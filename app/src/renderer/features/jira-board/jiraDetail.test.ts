import { describe, expect, it } from 'vitest';
import { FIELD_KEYS, type FieldKey } from '../../../shared/fields';
import type { IssueDetail } from '../../../shared/workspace';
import { JIRA_DETAIL_FIELD_KEYS, commentTimeLabel, formatDueDate, jiraDetailRows } from './jiraDetail';
import { mapJiraIssueDetail } from '../../../shared/jiraBoardIssue';

function detail(overrides: Partial<IssueDetail> = {}, fields: Partial<IssueDetail['fields']> = {}): IssueDetail {
  const base = Object.fromEntries(FIELD_KEYS.map((k) => [k, null])) as IssueDetail['fields'];
  return {
    id: '10001',
    idReadable: 'DEMO-1',
    summary: 'Fictional issue',
    resolved: null,
    fields: { ...base, ...fields },
    parentEpic: null,
    isEpic: false,
    statusRole: null,
    project: { id: '100', name: 'Demo', shortName: 'DEMO' },
    ...overrides,
  };
}

describe('JIRA_DETAIL_FIELD_KEYS', () => {
  it('lists exactly the fields mapJiraIssue fills; every other field is YouTrack-only', () => {
    const issue = mapJiraIssueDetail({
      id: '1',
      key: 'DEMO-1',
      fields: {
        summary: 's',
        status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
        priority: { name: 'High' },
        duedate: '2026-12-01',
        project: { id: '100', key: 'DEMO', name: 'Demo' },
      },
    });
    const filled = (Object.keys(issue.fields) as FieldKey[]).filter((k) => issue.fields[k] !== null);
    expect([...filled].sort()).toEqual([...JIRA_DETAIL_FIELD_KEYS].sort());
  });
});

describe('jiraDetailRows', () => {
  it('shows status, priority and due date, with dashes when empty', () => {
    expect(jiraDetailRows(detail())).toEqual([
      { key: 'status', label: 'Status', value: '—' },
      { key: 'priority', label: 'Priority', value: '—' },
      { key: 'dueDate', label: 'Due date', value: '—' },
    ]);
  });

  it('adds the status role when the workflow name differs from it', () => {
    const rows = jiraDetailRows(detail({ statusRole: 'waiting' }, { status: 'Awaiting Vendor' }));
    expect(rows[0].value).toBe('Awaiting Vendor (Waiting)');
  });

  it('does not repeat a role that matches the status name', () => {
    expect(jiraDetailRows(detail({ statusRole: 'done' }, { status: 'Done' }))[0].value).toBe('Done');
    expect(jiraDetailRows(detail({ statusRole: 'inProgress' }, { status: 'In Progress' }))[0].value).toBe('In Progress');
  });

  it('formats the due date with its year and shows the priority', () => {
    const due = Date.UTC(2026, 11, 1, 12);
    const rows = jiraDetailRows(detail({}, { priority: 'Highest', dueDate: due }));
    expect(rows[1].value).toBe('Highest');
    expect(rows[2].value).toBe(formatDueDate(due));
    expect(rows[2].value).toContain('2026');
  });

  it('adds the parent epic, with its summary when known', () => {
    const withSummary = jiraDetailRows(detail({ parentEpic: { id: '9', idReadable: 'DEMO-9', summary: 'Big thing' } }));
    expect(withSummary.at(-1)).toEqual({ key: 'epic', label: 'Epic', value: 'DEMO-9 — Big thing' });
    const keyOnly = jiraDetailRows(detail({ parentEpic: { id: 'DEMO-9', idReadable: 'DEMO-9', summary: '' } }));
    expect(keyOnly.at(-1)?.value).toBe('DEMO-9');
  });
});

describe('commentTimeLabel', () => {
  const t1 = Date.UTC(2026, 10, 14, 14, 5);
  const t2 = Date.UTC(2026, 10, 15, 14, 5);
  it('is empty with no times, and marks an edit', () => {
    expect(commentTimeLabel(null, null)).toBe('');
    expect(commentTimeLabel(t1, null)).not.toContain('edited');
    expect(commentTimeLabel(t1, t2)).toMatch(/^.+ \(edited .+\)$/);
    expect(commentTimeLabel(null, t2)).toMatch(/^edited /);
  });
});
