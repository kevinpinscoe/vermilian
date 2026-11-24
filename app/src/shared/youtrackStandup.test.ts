import { describe, expect, it } from 'vitest';
import {
  buildStandupPlan,
  buildStandupQuery,
  defaultYouTrackStatusRole,
  standupGroupFor,
  youtrackProjectSettingsProblems,
} from './youtrackStandup';
import { parseYouTrackProjectFields, youtrackStatusField } from './youtrackProjectFields';

const meta = (values: Array<[string, boolean]>, fieldName = 'Status') =>
  parseYouTrackProjectFields([
    { field: { name: fieldName }, $type: 'StateProjectCustomField', bundle: { values: values.map(([name, isResolved], ordinal) => ({ name, isResolved, ordinal })) } },
  ]);

describe('defaultYouTrackStatusRole', () => {
  it.each([
    ['Done', true, 'done'],
    ['Fixed', true, 'done'],
    ['Wont do', true, null],
    ["Won't do", true, null],
    ['Duplicate', true, null],
    ['Obsolete', true, null],
    ['In Progress', false, 'inProgress'],
    ['Working on it', false, 'inProgress'],
    ['Waiting for customer', false, 'waiting'],
    ['BLOCKED', false, 'blocked'],
    ['To do', false, 'todo'],
    ['Not yet started', false, 'todo'],
  ] as const)('%s (resolved %s) → %s', (name, isResolved, role) => {
    expect(defaultYouTrackStatusRole({ name, isResolved })).toBe(role);
  });
});

describe('buildStandupPlan', () => {
  it('uses only the project\'s own values; a project without "Working on it" never asks for it', () => {
    const plan = buildStandupPlan([{ shortName: 'VERM', metadata: meta([['To do', false], ['In Progress', false], ['BLOCKED', false], ['Done', true], ['Wont do', true]]) }], undefined);
    expect(plan.projects).toEqual([{ shortName: 'VERM', statusField: 'Status', groups: { 'In Progress': 'inProgress', BLOCKED: 'blocked', Done: 'done' } }]);
    expect(plan.warnings.map((w) => w.message)).toEqual([]);
    expect(buildStandupQuery(plan)).toBe('(project: {VERM} and {Status}: {In Progress},{BLOCKED},{Done})');
  });

  it('names the project and the missing group, and keeps the groups that do have values', () => {
    const plan = buildStandupPlan([{ shortName: 'OPS', metadata: meta([['Open', false], ['Doing', false], ['Closed', true]]) }], undefined);
    expect(plan.projects[0].groups).toEqual({ Doing: 'inProgress', Closed: 'done' });
    expect(plan.warnings.map((w) => w.message)).toEqual(['OPS: no Status value is mapped to blocked, so blocked issues from OPS are not shown.']);
  });

  it('applies overrides, including counting Wont do as done, and warns about an override naming an unknown value', () => {
    const plan = buildStandupPlan(
      [{ shortName: 'OPS', metadata: meta([['Open', false], ['Stuck', false], ['Closed', true], ['Wont do', true]]) }],
      { OPS: { statusRoles: { Stuck: 'blocked', Open: 'inProgress', 'Wont do': 'done', 'Working on it': 'inProgress' } } },
    );
    expect(plan.projects[0].groups).toEqual({ Open: 'inProgress', Stuck: 'blocked', Closed: 'done', 'Wont do': 'done' });
    expect(plan.warnings.map((w) => w.message)).toEqual(['OPS: the status mapping names "Working on it", which is not a value of its Status field, so that entry is ignored.']);
  });

  it('reads a project\'s single state field even when it is not called Status, and queries it by its own name', () => {
    const plan = buildStandupPlan([{ shortName: 'X', metadata: meta([['Doing', false], ['Fixed', true]], 'State') }], undefined);
    expect(buildStandupQuery(plan)).toBe('(project: {X} and {State}: {Doing},{Fixed})');
  });

  it('leaves out an unreadable project, a project with no state field, and a value with a brace, saying so', () => {
    const plan = buildStandupPlan(
      [
        { shortName: 'GONE', metadata: null },
        { shortName: 'NOST', metadata: parseYouTrackProjectFields([{ field: { name: 'Priority' }, $type: 'EnumProjectCustomField', bundle: { values: [] } }]) },
        { shortName: 'BR', metadata: meta([['In {x}', false], ['In Progress', false], ['BLOCKED', false], ['Done', true]]) },
      ],
      { BR: { statusRoles: { 'In {x}': 'inProgress' } } },
    );
    expect(plan.projects.map((p) => p.shortName)).toEqual(['BR']);
    expect(plan.warnings.map((w) => w.message)).toEqual([
      'GONE: its field configuration could not be read, so it is left out of this stand-up.',
      'NOST: it has no Status field Vermilian can read, so it is left out of this stand-up.',
      'BR: the Status value "In {x}" contains a brace and cannot be queried, so it is skipped.',
    ]);
  });

  it('a project with no reported values at all is left out of the query', () => {
    const plan = buildStandupPlan([{ shortName: 'TODO', metadata: meta([['To do', false]]) }], undefined);
    expect(plan.projects).toEqual([]);
    expect(buildStandupQuery(plan)).toBe('');
    expect(plan.warnings).toHaveLength(3);
  });

  it('groups by the same mapping the query used', () => {
    const plan = buildStandupPlan([{ shortName: 'OPS', metadata: meta([['Doing', false], ['Closed', true], ['Wont do', true]]) }], undefined);
    expect(standupGroupFor(plan, 'OPS', 'Closed')).toBe('done');
    expect(standupGroupFor(plan, 'OPS', 'Wont do')).toBeNull();
    expect(standupGroupFor(plan, 'OTHER', 'Closed')).toBeNull();
  });
});

describe('youtrackStatusField', () => {
  it('prefers Status, takes a lone state field, and refuses to guess among several', () => {
    const two = parseYouTrackProjectFields([
      { field: { name: 'Stage' }, $type: 'StateProjectCustomField', bundle: { values: [{ name: 'A' }] } },
      { field: { name: 'Category' }, $type: 'StateProjectCustomField', bundle: { values: [{ name: 'B' }] } },
    ]);
    expect(youtrackStatusField(two)).toBeNull();
    expect(youtrackStatusField(meta([['A', false]]))?.name).toBe('Status');
  });
});

describe('youtrackProjectSettingsProblems', () => {
  it('accepts a valid map', () => {
    expect(youtrackProjectSettingsProblems({ VERM: { statusRoles: { 'Wont do': 'done', Stuck: 'blocked' } } })).toEqual([]);
  });

  it('rejects a bad key, an unknown setting and an unknown role', () => {
    expect(youtrackProjectSettingsProblems({ 'bad key': {}, VERM: { colour: 'red', statusRoles: { Done: 'finished' } } }).map((p) => p.path)).toEqual([
      '["bad key"]',
      '["VERM"].colour',
      '["VERM"].statusRoles["Done"]',
    ]);
  });
});
