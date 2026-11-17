import { describe, expect, it } from 'vitest';
import {
  isJiraIssueKey,
  jiraBoardFields,
  jiraDateToEpochMs,
  jiraDetailFields,
  jqlTextClause,
  jqlString,
  jiraSearchJql,
  jiraSearchKey,
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

describe('mapJiraIssue — last updated (VERM-39)', () => {
  it("carries Jira's updated as epoch ms", () => {
    expect(mapJiraIssue(jira({ updated: '2026-11-10T09:00:00.000+0000' })).updated).toBe(Date.parse('2026-11-10T09:00:00.000Z'));
  });

  it('is null, never invented, when updated is absent or unparseable', () => {
    expect(mapJiraIssue(jira({})).updated).toBeNull();
    expect(mapJiraIssue(jira({ updated: 'not a date' })).updated).toBeNull();
    expect(mapJiraIssue(jira({ updated: 42 })).updated).toBeNull();
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

describe('mapJiraIssue — the project status mapping (VERM-31)', () => {
  const statusRoles = { Impeded: 'blocked', "Closed - won't fix": 'done', 'Deployed to staging': 'inProgress' } as const;

  it('sets statusRole from the category when the project has no mapping', () => {
    expect(mapJiraIssue(jira({ status: { name: 'In Review', statusCategory: { key: 'indeterminate' } } })).statusRole).toBe('inProgress');
    expect(mapJiraIssue(jira({ status: { name: 'Backlog', statusCategory: { key: 'new' } } })).statusRole).toBe('todo');
    expect(mapJiraIssue(jira({})).statusRole).toBeNull();
  });

  it('sets statusRole from the mapping and keeps the workflow name for display', () => {
    const b = mapJiraIssue(jira({ status: { name: 'Impeded', statusCategory: { key: 'indeterminate' } } }), { statusRoles });
    expect(b.statusRole).toBe('blocked');
    expect(b.fields.status).toBe('Impeded');
    expect(b.resolved).toBeNull();
  });

  it('resolves a status the mapping marks done, outside the Done category', () => {
    const b = mapJiraIssue(
      jira({ status: { name: "Closed - won't fix", statusCategory: { key: 'indeterminate' } }, updated: '2026-11-10T09:00:00.000+0000' }),
      { statusRoles },
    );
    expect(b.statusRole).toBe('done');
    expect(b.resolved).toBe(Date.parse('2026-11-10T09:00:00.000Z'));
  });

  it('leaves unresolved a Done-category status the mapping keeps open', () => {
    const b = mapJiraIssue(
      jira({ status: { name: 'Deployed to staging', statusCategory: { key: 'done' } }, resolutiondate: '2026-11-09T15:30:00.000+0000' }),
      { statusRoles },
    );
    expect(b.statusRole).toBe('inProgress');
    expect(b.resolved).toBeNull();
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

describe('isJiraIssueKey', () => {
  it('accepts a project key, a hyphen and a positive number', () => {
    for (const k of ['DEMO-1', 'OPS_2-7', 'A1-1234']) expect(isJiraIssueKey(k)).toBe(true);
  });
  it('refuses anything else', () => {
    for (const k of ['', 'DEMO', 'demo-1', 'DEMO-0', 'DEMO-01', '1DEMO-1', 'DEMO-1 ', 'DEMO-1/../x', 'DE MO-1', 7, null, undefined]) {
      expect(isJiraIssueKey(k)).toBe(false);
    }
    expect(isJiraIssueKey(`${'A'.repeat(260)}-1`)).toBe(false);
  });
});

// ─── Board search (VERM-61) and assignee (VERM-62) ───────────────────────────

describe('jqlString', () => {
  it('quotes and escapes so the value can never leave the string', () => {
    expect(jqlString('plain')).toBe('"plain"');
    expect(jqlString('a" OR project = "X')).toBe('"a\\" OR project = \\"X"');
    expect(jqlString('back\\slash')).toBe('"back\\\\slash"');
    expect(jqlString('tab\tand\nnewline')).toBe('"tab and newline"');
  });
});

describe('jiraSearchJql', () => {
  it('searches the given projects by text, with no resolution filter', () => {
    const jql = jiraSearchJql(['DEMO', 'OPS'], '  db creds ');
    expect(jql).toBe('project in ("DEMO", "OPS") AND text ~ "db creds" ORDER BY updated DESC');
    expect(jql).not.toMatch(/resolution|statusCategory/i);
  });

  it('escapes the term', () => {
    expect(jiraSearchJql(['DEMO'], 'x" OR key = "Y')).toBe(
      'project in ("DEMO") AND text ~ "x\\" OR key = \\"Y" ORDER BY updated DESC',
    );
  });

  it('is null for an empty term or no projects', () => {
    expect(jiraSearchJql(['DEMO'], '   ')).toBeNull();
    expect(jiraSearchJql([], 'x')).toBeNull();
  });
});

describe('jiraSearchKey', () => {
  it('detects a key, uppercasing it as Jira compares keys', () => {
    expect(jiraSearchKey(['DEMO', 'OPS_2'], ' demo-101 ')).toBe('DEMO-101');
    expect(jiraSearchKey(['DEMO', 'OPS_2'], 'OPS_2-7')).toBe('OPS_2-7');
  });

  it('ignores terms that are not keys', () => {
    expect(jiraSearchKey(['DEMO'], 'DEMO')).toBeNull();
    expect(jiraSearchKey(['DEMO'], 'DEMO-0')).toBeNull();
    expect(jiraSearchKey(['DEMO'], 'rotate DEMO-1')).toBeNull();
  });

  it('never names a key outside the given projects', () => {
    expect(jiraSearchKey(['DEMO'], 'SRE-4640')).toBeNull();
  });
});

describe('mapJiraIssue assignee', () => {
  it('keeps the accountId as the value and the display name alongside', () => {
    const i = mapJiraIssue({ id: '1', key: 'DEMO-1', fields: { assignee: { accountId: 'acc-1', displayName: 'Dana' } } });
    expect(i.fields.assignee).toBe('acc-1');
    expect(i.assigneeName).toBe('Dana');
  });

  it('falls back to the accountId when no display name is visible', () => {
    const i = mapJiraIssue({ id: '1', key: 'DEMO-1', fields: { assignee: { accountId: 'acc-1' } } });
    expect(i.assigneeName).toBe('acc-1');
  });

  it('maps an unassigned issue to null', () => {
    const i = mapJiraIssue({ id: '1', key: 'DEMO-1', fields: { assignee: null } });
    expect(i.fields.assignee).toBeNull();
    expect(i.assigneeName).toBeNull();
  });
});
