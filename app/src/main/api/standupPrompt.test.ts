import { describe, it, expect } from 'vitest';
import { formatDuration, buildStandupPromptSection, buildStandupSections } from './standupPrompt';
import type { StandupTask, StandupIssues } from './youtrack';

function task(over: Partial<StandupTask> = {}): StandupTask {
  return {
    idReadable: 'T-1',
    summary: 'Do the thing',
    status: 'In Progress',
    priority: null,
    notes: null,
    updatedMs: 0,
    loggedMinutesToday: 0,
    ...over,
  };
}

describe('formatDuration', () => {
  it('formats minutes under an hour', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(25)).toBe('25m');
  });

  it('formats whole hours without trailing minutes', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
  });

  it('formats mixed hours and minutes', () => {
    expect(formatDuration(85)).toBe('1h 25m');
    expect(formatDuration(150)).toBe('2h 30m');
  });
});

describe('buildStandupPromptSection', () => {
  it('returns an empty string for no tasks', () => {
    expect(buildStandupPromptSection('Done', [])).toBe('');
  });

  it('renders a titled bullet list with id and summary', () => {
    const out = buildStandupPromptSection('Done', [task({ idReadable: 'KP-1', summary: 'Ship it' })]);
    expect(out).toBe('Done:\n- KP-1: "Ship it"');
  });

  it('appends priority and logged time only when present', () => {
    const out = buildStandupPromptSection('In Progress', [
      task({ idReadable: 'KP-2', summary: 'Work', priority: 'Critical', loggedMinutesToday: 85 }),
    ]);
    expect(out).toBe('In Progress:\n- KP-2: "Work" | Priority: Critical | Logged today: 1h 25m');
  });

  it('omits the logged-time suffix when zero', () => {
    const out = buildStandupPromptSection('In Progress', [task({ loggedMinutesToday: 0 })]);
    expect(out).not.toContain('Logged today');
  });
});

describe('buildStandupSections', () => {
  it('joins only the non-empty sections with blank lines', () => {
    const issues: StandupIssues = {
      done: [task({ idReadable: 'D-1', summary: 'done one' })],
      inProgress: [],
      blocked: [task({ idReadable: 'B-1', summary: 'blocked one' })],
    };
    const out = buildStandupSections(issues);
    expect(out).toBe(
      'Done (completed recently):\n- D-1: "done one"\n\nBlocked:\n- B-1: "blocked one"',
    );
    expect(out).not.toContain('In Progress');
  });

  it('returns an empty string when there are no tasks at all', () => {
    expect(buildStandupSections({ done: [], inProgress: [], blocked: [] })).toBe('');
  });
});
