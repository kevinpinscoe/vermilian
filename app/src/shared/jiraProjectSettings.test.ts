import { describe, expect, it } from 'vitest';
import {
  STATUS_ROLES,
  categoryStatusRole,
  dueDateFieldCandidates,
  isJiraDueDateField,
  jiraProjectSettingsProblems,
  jiraStatusRole,
} from './jiraProjectSettings';

// Fictional values only (ADR-0011 §10): no real site's status names or field IDs.
const st = (name: string, key?: string) => ({ name, statusCategory: key === undefined ? undefined : { key } });

describe('categoryStatusRole', () => {
  it('maps the three Jira status categories', () => {
    expect(categoryStatusRole('new')).toBe('todo');
    expect(categoryStatusRole('indeterminate')).toBe('inProgress');
    expect(categoryStatusRole('done')).toBe('done');
  });

  it('is null for an unknown or missing category', () => {
    for (const k of ['undefined', '', undefined, null, 2]) expect(categoryStatusRole(k)).toBeNull();
  });
});

describe('jiraStatusRole — the mapping table', () => {
  const table = { Impeded: 'blocked', 'On hold': 'deferred', 'Awaiting vendor': 'waiting', "Closed - won't fix": 'done' } as const;

  it('uses the table entry over the category', () => {
    expect(jiraStatusRole(st('Impeded', 'indeterminate'), table)).toBe('blocked');
    expect(jiraStatusRole(st('On hold', 'new'), table)).toBe('deferred');
    expect(jiraStatusRole(st('Awaiting vendor', 'indeterminate'), table)).toBe('waiting');
  });

  it('can mark a status done that Jira does not put in the Done category', () => {
    expect(jiraStatusRole(st("Closed - won't fix", 'indeterminate'), table)).toBe('done');
  });

  it('can take a Done-category status out of done', () => {
    expect(jiraStatusRole(st('Deployed to staging', 'done'), { 'Deployed to staging': 'inProgress' })).toBe('inProgress');
  });

  it('matches ignoring case and surrounding spaces', () => {
    expect(jiraStatusRole(st('IMPEDED', 'indeterminate'), table)).toBe('blocked');
    expect(jiraStatusRole(st(' on hold ', 'new'), table)).toBe('deferred');
  });

  it('falls back to the category for a status the table does not name', () => {
    expect(jiraStatusRole(st('In Review', 'indeterminate'), table)).toBe('inProgress');
    expect(jiraStatusRole(st('Backlog', 'new'), table)).toBe('todo');
    expect(jiraStatusRole(st('Shipped', 'done'), {})).toBe('done');
    expect(jiraStatusRole(st('Shipped', 'done'), undefined)).toBe('done');
  });

  it('ignores an invalid role in a hand-edited table', () => {
    expect(jiraStatusRole(st('Impeded', 'indeterminate'), { Impeded: 'stuck' } as never)).toBe('inProgress');
  });

  it('is null with no status, or with no mapping and no category', () => {
    expect(jiraStatusRole(null, table)).toBeNull();
    expect(jiraStatusRole(undefined, table)).toBeNull();
    expect(jiraStatusRole(st('Custom'), table)).toBeNull();
    // A hidden name still resolves through the category.
    expect(jiraStatusRole({ statusCategory: { key: 'done' } }, table)).toBe('done');
  });

  it('does not read inherited object properties as table entries', () => {
    expect(jiraStatusRole(st('constructor', 'new'), {})).toBe('todo');
  });
});

describe('jiraProjectSettingsProblems', () => {
  it('accepts empty settings and every valid part', () => {
    expect(jiraProjectSettingsProblems({})).toEqual([]);
    expect(
      jiraProjectSettingsProblems({
        statusRoles: Object.fromEntries(STATUS_ROLES.map((r, i) => [`Status ${i}`, r])),
        dueDateField: 'customfield_10042',
        epicLinkField: 'customfield_10014',
      }),
    ).toEqual([]);
    expect(jiraProjectSettingsProblems({ dueDateField: 'duedate' })).toEqual([]);
  });

  it('rejects a non-object', () => {
    for (const v of [null, [], 'x', 3]) expect(jiraProjectSettingsProblems(v)).toHaveLength(1);
  });

  it('rejects an unknown role, an empty name, and two spellings of one status', () => {
    const problems = jiraProjectSettingsProblems({ statusRoles: { Impeded: 'stuck', ' ': 'todo', Done: 'done', 'done ': 'done' } });
    expect(problems.map((p) => p.path)).toEqual(['statusRoles["Impeded"]', 'statusRoles[" "]', 'statusRoles["done "]']);
  });

  it('rejects a due-date field that is neither duedate nor a custom field id', () => {
    for (const bad of ['Due Date', 'customfield_', 'customfield_x', 'resolutiondate', 42]) {
      expect(jiraProjectSettingsProblems({ dueDateField: bad }).map((p) => p.path)).toEqual(['dueDateField']);
    }
    expect(isJiraDueDateField('duedate')).toBe(true);
  });

  it('rejects an Epic Link field that is not a custom field id', () => {
    expect(jiraProjectSettingsProblems({ epicLinkField: 'duedate' }).map((p) => p.path)).toEqual(['epicLinkField']);
    expect(jiraProjectSettingsProblems({ statusRoles: [] }).map((p) => p.path)).toEqual(['statusRoles']);
  });
});

describe('dueDateFieldCandidates', () => {
  const meta = {
    summary: { name: 'Summary', schema: { type: 'string', system: 'summary' } },
    duedate: { name: 'Due date', schema: { type: 'date', system: 'duedate' } },
    customfield_10042: { name: 'Target date', schema: { type: 'date', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:datepicker' } },
    customfield_10050: { name: 'Due Date', schema: { type: 'datetime', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:datetime' } },
    customfield_10060: { name: 'Story points', schema: { type: 'number' } },
    resolutiondate: { name: 'Resolved', schema: { type: 'datetime', system: 'resolutiondate' } },
  };

  it('lists the system due date first, then custom date fields by name', () => {
    expect(dueDateFieldCandidates(meta)).toEqual([
      { id: 'duedate', name: 'Due date', system: true },
      { id: 'customfield_10050', name: 'Due Date', system: false },
      { id: 'customfield_10042', name: 'Target date', system: false },
    ]);
  });

  it('omits the system field when the project does not have it', () => {
    const { duedate: _omit, ...noSystem } = meta;
    expect(dueDateFieldCandidates(noSystem).map((c) => c.id)).toEqual(['customfield_10050', 'customfield_10042']);
  });

  it('tolerates missing names, schemas and metadata', () => {
    expect(dueDateFieldCandidates(null)).toEqual([]);
    expect(dueDateFieldCandidates({ duedate: {}, customfield_1: { schema: { type: 'date' } }, customfield_2: { schema: null } })).toEqual([
      { id: 'duedate', name: 'Due date', system: true },
      { id: 'customfield_1', name: 'customfield_1', system: false },
    ]);
  });
});
