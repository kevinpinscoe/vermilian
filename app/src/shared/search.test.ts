import { describe, it, expect } from 'vitest';
import { buildIssueSearchQuery } from './search';

describe('buildIssueSearchQuery', () => {
  it('combines project scope with the free-text terms', () => {
    expect(buildIssueSearchQuery('TEST', 'login page')).toBe('project: TEST login page');
  });

  it('trims and collapses internal whitespace in the query', () => {
    expect(buildIssueSearchQuery('TEST', '  login   page  ')).toBe('project: TEST login page');
  });

  it('trims the project short name', () => {
    expect(buildIssueSearchQuery('  TEST  ', 'x')).toBe('project: TEST x');
  });

  it('preserves an issue-id-like term verbatim', () => {
    expect(buildIssueSearchQuery('TEST', 'TEST-42')).toBe('project: TEST TEST-42');
  });

  it('returns null when the project short name is missing', () => {
    expect(buildIssueSearchQuery(null, 'login')).toBeNull();
    expect(buildIssueSearchQuery(undefined, 'login')).toBeNull();
    expect(buildIssueSearchQuery('', 'login')).toBeNull();
    expect(buildIssueSearchQuery('   ', 'login')).toBeNull();
  });

  it('returns null when the query is empty after trimming', () => {
    expect(buildIssueSearchQuery('TEST', '')).toBeNull();
    expect(buildIssueSearchQuery('TEST', '   ')).toBeNull();
  });
});
