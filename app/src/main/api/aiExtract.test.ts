import { describe, it, expect } from 'vitest';
import { matchProjectByName } from './aiExtract';

const PROJECTS = [
  { id: '0-1', name: 'Operations' },
  { id: '0-2', name: 'Company Admin' },
  { id: '0-3', name: 'Inbox' },
];

describe('matchProjectByName', () => {
  it('matches case-insensitively on an exact name', () => {
    expect(matchProjectByName('operations', PROJECTS)).toEqual({ projectId: '0-1', projectMatchError: false });
  });

  it('matches when the project name contains the query', () => {
    expect(matchProjectByName('admin', PROJECTS)).toEqual({ projectId: '0-2', projectMatchError: false });
  });

  it('matches when the query contains the project name', () => {
    expect(matchProjectByName('the Inbox project', PROJECTS)).toEqual({ projectId: '0-3', projectMatchError: false });
  });

  it('trims surrounding whitespace before matching', () => {
    expect(matchProjectByName('  Operations  ', PROJECTS)).toEqual({ projectId: '0-1', projectMatchError: false });
  });

  it('flags a match error when a non-empty name matches nothing', () => {
    expect(matchProjectByName('Marketing', PROJECTS)).toEqual({ projectId: null, projectMatchError: true });
  });

  it('is not an error when no name is given', () => {
    expect(matchProjectByName(null, PROJECTS)).toEqual({ projectId: null, projectMatchError: false });
    expect(matchProjectByName(undefined, PROJECTS)).toEqual({ projectId: null, projectMatchError: false });
    expect(matchProjectByName('   ', PROJECTS)).toEqual({ projectId: null, projectMatchError: false });
  });

  it('returns the first project when several match', () => {
    const projects = [
      { id: 'a', name: 'Web' },
      { id: 'b', name: 'Web App' },
    ];
    expect(matchProjectByName('web', projects).projectId).toBe('a');
  });
});
