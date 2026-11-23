import { describe, expect, it } from 'vitest';
import { linkRole, type IssueLink } from './issueLink';

// Synthetic keys only.
function link(type: string, direction: IssueLink['direction'], directed = true): IssueLink {
  return { type, directed, direction, verb: '', issue: { id: null, key: 'SYNC-3', summary: '', resolved: false } };
}

describe('linkRole (VERM-94)', () => {
  it('reads Depend and Blocks by default: inward is a prerequisite, outward a dependent', () => {
    expect(linkRole(link('Depend', 'inward'))).toBe('prerequisite');
    expect(linkRole(link('Depend', 'outward'))).toBe('dependent');
    expect(linkRole(link('Blocks', 'inward'))).toBe('prerequisite');
    expect(linkRole(link('Blocks', 'outward'))).toBe('dependent');
  });

  it('gives no role to other types, undirected links or a both-way link', () => {
    expect(linkRole(link('Relates', 'both', false))).toBeNull();
    expect(linkRole(link('Duplicate', 'inward'))).toBeNull();
    expect(linkRole(link('Depend', 'inward', false))).toBeNull();
    expect(linkRole(link('Depend', 'both'))).toBeNull();
  });

  it('follows the given prerequisite types, compared exactly', () => {
    expect(linkRole(link('Needs', 'inward'), ['Needs'])).toBe('prerequisite');
    expect(linkRole(link('Depend', 'inward'), ['Needs'])).toBeNull();
    expect(linkRole(link('depend', 'inward'))).toBeNull();
  });

  it('never treats a parent/child link as a prerequisite, even when configured', () => {
    expect(linkRole(link('Subtask', 'inward'), ['Subtask', 'Depend'])).toBeNull();
  });
});
