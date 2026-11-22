import { describe, it, expect } from 'vitest';
import { buildIssueIdsQuery, buildIssueSearchQuery } from './search';

describe('buildIssueSearchQuery', () => {
  it('scopes a single project and appends the free-text terms', () => {
    expect(buildIssueSearchQuery(['TEST'], 'login page')).toBe('project: {TEST} login page');
  });

  it('joins multiple projects with commas (workspace scope)', () => {
    expect(buildIssueSearchQuery(['TEST', 'TST2', 'INB'], 'bug')).toBe(
      'project: {TEST},{TST2},{INB} bug',
    );
  });

  it('trims and collapses internal whitespace in the query', () => {
    expect(buildIssueSearchQuery(['TEST'], '  login   page  ')).toBe('project: {TEST} login page');
  });

  it('trims and drops blank project short names', () => {
    expect(buildIssueSearchQuery(['  TEST  ', '', '  '], 'x')).toBe('project: {TEST} x');
  });

  it('preserves an issue-id-like term verbatim', () => {
    expect(buildIssueSearchQuery(['TEST'], 'TEST-42')).toBe('project: {TEST} TEST-42');
  });

  it('returns null when there are no projects in scope', () => {
    expect(buildIssueSearchQuery(null, 'login')).toBeNull();
    expect(buildIssueSearchQuery(undefined, 'login')).toBeNull();
    expect(buildIssueSearchQuery([], 'login')).toBeNull();
    expect(buildIssueSearchQuery(['', '   '], 'login')).toBeNull();
  });

  it('returns null when the query is empty after trimming', () => {
    expect(buildIssueSearchQuery(['TEST'], '')).toBeNull();
    expect(buildIssueSearchQuery(['TEST'], '   ')).toBeNull();
  });
});

describe('buildIssueIdsQuery (VERM-84)', () => {
  it('lists the IDs in one issue id: clause', () => {
    expect(buildIssueIdsQuery(['READ-12', 'SYNC-3'])).toBe('issue id: READ-12, SYNC-3');
  });
  it('drops anything that is not a YouTrack ID, so nothing can change the query', () => {
    expect(buildIssueIdsQuery(['READ-12', 'READ-1 or project: OPS', ''])).toBe('issue id: READ-12');
    expect(buildIssueIdsQuery(['not an id'])).toBeNull();
    expect(buildIssueIdsQuery([])).toBeNull();
  });
});
