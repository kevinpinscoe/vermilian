import { describe, expect, it } from 'vitest';
import { boardSourceId, jiraSourceArgs, jiraSourceIds, parseJiraSource } from './jiraSource';

describe('Jira sources (VERM-59)', () => {
  it('tells a board from a project by its prefix', () => {
    expect(parseJiraSource('DEMO')).toEqual({ kind: 'project', projectKey: 'DEMO' });
    expect(parseJiraSource('board:12')).toEqual({ kind: 'board', boardId: 12 });
    expect(boardSourceId(12)).toBe('board:12');
  });

  it('does not take a malformed board ID for a board', () => {
    expect(parseJiraSource('board:0').kind).toBe('project');
    expect(parseJiraSource('board:x').kind).toBe('project');
  });

  it('turns a source into its IPC arguments', () => {
    expect(jiraSourceArgs('OPS')).toEqual({ projectKey: 'OPS' });
    expect(jiraSourceArgs('board:7')).toEqual({ boardId: 7 });
  });

  it('lists projects first, then boards', () => {
    expect(jiraSourceIds(['DEMO', 'OPS'], [12, 13])).toEqual(['DEMO', 'OPS', 'board:12', 'board:13']);
  });
});
