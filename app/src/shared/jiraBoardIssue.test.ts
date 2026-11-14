import { describe, expect, it } from 'vitest';
import {
  jiraBoardFields,
  jiraDateToEpochMs,
  jiraDetailFields,
  jqlTextClause,
  mapJiraIssue,
  mapJiraIssueDetail,
  type JiraIssue,
} from './jiraBoardIssue';
import { FIELD_KEYS } from './fields';

// Fictional values only (ADR-0011 §10). Shapes follow Jira Cloud REST v3.
const EPIC_TYPE = { name: 'Epic', hierarchyLevel: 1 };
const TASK_TYPE = { name: 'Task', hierarchyLevel: 0 };
const SUBTASK_TYPE = { name: 'Sub-task', hierarchyLevel: -1 };

function jira(fields: Record<string, unknown> | null | undefined, key = 'DEMO-12', id = '10012'): JiraIssue {
  return { id, key, fields };
}

const noon = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);

describe('mapJiraIssue — identity and summary', () => {
  it('uses the Jira id and key as local IDs', () => {
    const b = mapJiraIssue(jira({ summary: 'Rotate credentials' }));
    expect(b.id).toBe('10012');
    expect(b.idReadable).toBe('DEMO-12');
    expect(b.summary).toBe('Rotate credentials');
  });

  it('survives a response with no fields at all', () => {
    for (const f of [undefined, null, {}]) {
      const b = mapJiraIssue(jira(f));
      expect(b.summary).toBe('');
      expect(b.resolved).toBeNull();
      expect(b.parentEpic).toBeNull();
      expect(b.isEpic).toBe(false);
      expect(Object.values(b.fields).every((v) => v === null)).toBe(true);
    }
  });

  it('leaves every YouTrack-only field null', () => {
    const b = mapJiraIssue(
      jira({ summary: 'x', status: { name: 'To Do', statusCategory: { key: 'new' } }, priority: { name: 'High' }, duedate: '2026-11-20' }),
    );
    const set = FIELD_KEYS.filter((k) => b.fields[k] !== null);
    expect(set.sort()).toEqual(['dueDate', 'priority', 'status']);
  });
});

describe('mapJiraIssue — status category', () => {
  it('keeps the workflow status name and leaves an open issue unresolved', () => {
    for (const key of ['new', 'indeterminate']) {
      const b = mapJiraIssue(jira({ status: { name: 'Waiting for review', statusCategory: { key } }, updated: '2026-11-10T09:00:00.000+0000' }));
      expect(b.fields.status).toBe('Waiting for review');
      expect(b.resolved).toBeNull();
    }
  });

  it('resolves a Done-category issue at its resolutiondate', () => {
    const b = mapJiraIssue(
      jira({
        status: { name: 'Shipped', statusCategory: { key: 'done' } },
        resolutiondate: '2026-11-09T15:30:00.000+0000',
        updated: '2026-11-10T09:00:00.000+0000',
      }),
    );
    expect(b.fields.status).toBe('Shipped');
    expect(b.resolved).toBe(Date.parse('2026-11-09T15:30:00.000Z'));
  });

  it('falls back to updated, then to a truthy "time unknown", when resolutiondate is hidden', () => {
    const viaUpdated = mapJiraIssue(jira({ status: { name: 'Done', statusCategory: { key: 'done' } }, updated: '2026-11-10T09:00:00.000+0000' }));
    expect(viaUpdated.resolved).toBe(Date.parse('2026-11-10T09:00:00.000Z'));
    const unknown = mapJiraIssue(jira({ status: { name: 'Done', statusCategory: { key: 'done' } } }));
    expect(unknown.resolved).toBeTruthy();
  });

  it('treats a missing status or category as unresolved', () => {
    expect(mapJiraIssue(jira({ status: null })).fields.status).toBeNull();
    expect(mapJiraIssue(jira({ status: null })).resolved).toBeNull();
    const noCategory = mapJiraIssue(jira({ status: { name: 'Custom' }, resolutiondate: '2026-11-09T15:30:00.000+0000' }));
    expect(noCategory.fields.status).toBe('Custom');
    expect(noCategory.resolved).toBeNull();
  });
});

describe('mapJiraIssue — priority', () => {
  it('uses the scheme value name as-is', () => {
    expect(mapJiraIssue(jira({ priority: { name: 'Highest', id: '1' } })).fields.priority).toBe('Highest');
    expect(mapJiraIssue(jira({ priority: { name: 'None', id: '10000' } })).fields.priority).toBe('None');
  });

  it('is null when the project has no priority field or it is hidden', () => {
    expect(mapJiraIssue(jira({ priority: null })).fields.priority).toBeNull();
    expect(mapJiraIssue(jira({})).fields.priority).toBeNull();
    expect(mapJiraIssue(jira({ priority: {} })).fields.priority).toBeNull();
  });
});

describe('mapJiraIssue — due date', () => {
  it('reads the system duedate by default, at 12:00 UTC on the day', () => {
    expect(mapJiraIssue(jira({ duedate: '2026-11-20' })).fields.dueDate).toBe(noon(2026, 11, 20));
  });

  it('reads a custom due-date field when the project uses one', () => {
    const f = { duedate: '2026-11-20', customfield_10042: '2026-12-01' };
    expect(mapJiraIssue(jira(f), { dueDateField: 'customfield_10042' }).fields.dueDate).toBe(noon(2026, 12, 1));
  });

  it('takes the calendar day of a date-time custom field', () => {
    const f = { customfield_10042: '2026-12-01T23:30:00.000-0500' };
    expect(mapJiraIssue(jira(f), { dueDateField: 'customfield_10042' }).fields.dueDate).toBe(noon(2026, 12, 1));
  });

  it('is null when absent, hidden or malformed', () => {
    expect(mapJiraIssue(jira({})).fields.dueDate).toBeNull();
    expect(mapJiraIssue(jira({ duedate: null })).fields.dueDate).toBeNull();
    expect(mapJiraIssue(jira({ duedate: 'soon' })).fields.dueDate).toBeNull();
    expect(mapJiraIssue(jira({ duedate: '2026-02-30' })).fields.dueDate).toBeNull();
    // The custom field is configured but hidden: the system field is not used instead.
    expect(mapJiraIssue(jira({ duedate: '2026-11-20' }), { dueDateField: 'customfield_10042' }).fields.dueDate).toBeNull();
  });

  it('jiraDateToEpochMs rejects non-strings', () => {
    expect(jiraDateToEpochMs(20261120)).toBeNull();
    expect(jiraDateToEpochMs(undefined)).toBeNull();
  });
});

describe('mapJiraIssue — parent epic', () => {
  const epicParent = { id: '10001', key: 'DEMO-1', fields: { summary: 'Q4 hardening', issuetype: EPIC_TYPE } };

  it('takes an Epic parent', () => {
    expect(mapJiraIssue(jira({ parent: epicParent })).parentEpic).toEqual({ id: '10001', idReadable: 'DEMO-1', summary: 'Q4 hardening' });
  });

  it('recognises an Epic by name when the hierarchy level is absent', () => {
    const parent = { id: '10001', key: 'DEMO-1', fields: { summary: 'Q4', issuetype: { name: 'Epic' } } };
    expect(mapJiraIssue(jira({ parent })).parentEpic?.idReadable).toBe('DEMO-1');
  });

  it("ignores a sub-task's parent, which is a standard issue", () => {
    const parent = { id: '10011', key: 'DEMO-11', fields: { summary: 'Story', issuetype: TASK_TYPE } };
    expect(mapJiraIssue(jira({ parent, issuetype: SUBTASK_TYPE })).parentEpic).toBeNull();
  });

  it('tolerates a parent with hidden fields', () => {
    expect(mapJiraIssue(jira({ parent: { id: '10001', key: 'DEMO-1' } })).parentEpic).toBeNull();
    const epicNoSummary = { id: '10001', key: 'DEMO-1', fields: { issuetype: EPIC_TYPE } };
    expect(mapJiraIssue(jira({ parent: epicNoSummary })).parentEpic).toEqual({ id: '10001', idReadable: 'DEMO-1', summary: '' });
  });

  it('falls back to the legacy Epic Link field only when configured and there is no Epic parent', () => {
    const f = { customfield_10014: 'DEMO-2' };
    expect(mapJiraIssue(jira(f)).parentEpic).toBeNull();
    expect(mapJiraIssue(jira(f), { epicLinkField: 'customfield_10014' }).parentEpic).toEqual({
      id: 'DEMO-2',
      idReadable: 'DEMO-2',
      summary: '',
    });
    expect(mapJiraIssue(jira({ ...f, parent: epicParent }), { epicLinkField: 'customfield_10014' }).parentEpic?.idReadable).toBe('DEMO-1');
  });
});

describe('mapJiraIssue — isEpic', () => {
  it('is true only for an Epic-level issue type', () => {
    expect(mapJiraIssue(jira({ issuetype: EPIC_TYPE })).isEpic).toBe(true);
    expect(mapJiraIssue(jira({ issuetype: TASK_TYPE })).isEpic).toBe(false);
    expect(mapJiraIssue(jira({ issuetype: { name: 'Initiative', hierarchyLevel: 2 } })).isEpic).toBe(false);
    expect(mapJiraIssue(jira({ issuetype: null })).isEpic).toBe(false);
  });
});

describe('mapJiraIssueDetail', () => {
  it('adds the project', () => {
    const d = mapJiraIssueDetail(jira({ summary: 'x', project: { id: '10000', key: 'DEMO', name: 'Demo' } }));
    expect(d.project).toEqual({ id: '10000', name: 'Demo', shortName: 'DEMO' });
  });

  it('derives the project key from the issue key when project is hidden', () => {
    expect(mapJiraIssueDetail(jira({ summary: 'x' }, 'OPS_2-7')).project).toEqual({ id: '', name: 'OPS_2', shortName: 'OPS_2' });
  });
});

describe('field lists', () => {
  it('requests what the mapper reads, with the chosen due-date and Epic Link fields', () => {
    expect(jiraBoardFields()).toContain('duedate');
    const f = jiraBoardFields({ dueDateField: 'customfield_10042', epicLinkField: 'customfield_10014' });
    expect(f).toEqual(expect.arrayContaining(['summary', 'status', 'priority', 'issuetype', 'parent', 'resolutiondate', 'updated', 'customfield_10042', 'customfield_10014']));
    expect(f).not.toContain('duedate');
    expect(new Set(f).size).toBe(f.length);
    expect(jiraDetailFields()).toContain('project');
  });
});

describe('jqlTextClause', () => {
  it('quotes and escapes the query so it cannot leave the string', () => {
    expect(jqlTextClause('db creds')).toBe('text ~ "db creds"');
    expect(jqlTextClause('a" OR project = "X')).toBe('text ~ "a\\" OR project = \\"X"');
    expect(jqlTextClause('back\\slash')).toBe('text ~ "back\\\\slash"');
    expect(jqlTextClause('two\nlines')).toBe('text ~ "two lines"');
  });
});
