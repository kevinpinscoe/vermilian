import { describe, expect, it } from 'vitest';
import { defaultPrerequisiteLinkTypes, linkRole, prerequisitesOf, type IssueLink } from './issueLink';

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
    expect(linkRole(link('Needs', 'inward'), [{ type: 'Needs', side: 'inward' }])).toBe('prerequisite');
    expect(linkRole(link('Depend', 'inward'), [{ type: 'Needs', side: 'inward' }])).toBeNull();
    expect(linkRole(link('depend', 'inward'))).toBeNull();
  });

  it('never treats a parent/child link as a prerequisite, even when configured', () => {
    expect(linkRole(link('Subtask', 'inward'), [{ type: 'Subtask', side: 'inward' }, { type: 'Depend', side: 'inward' }])).toBeNull();
  });
});

describe('linkRole with configured sides (VERM-96)', () => {
  it('reads a type worded the other way when its outward side is the prerequisite', () => {
    const requiredBy = [{ type: 'Required by', side: 'outward' as const }];
    expect(linkRole(link('Required by', 'outward'), requiredBy)).toBe('prerequisite');
    expect(linkRole(link('Required by', 'inward'), requiredBy)).toBe('dependent');
  });

  it('defaults per tracker: YouTrack Depend, Jira Blocks, both inward', () => {
    expect(defaultPrerequisiteLinkTypes('youtrack')).toEqual([{ type: 'Depend', side: 'inward' }]);
    expect(defaultPrerequisiteLinkTypes('jira')).toEqual([{ type: 'Blocks', side: 'inward' }]);
    expect(linkRole(link('Blocks', 'inward'), defaultPrerequisiteLinkTypes('youtrack'))).toBeNull();
  });

  it('finds no prerequisites when a workspace has chosen none', () => {
    expect(prerequisitesOf([link('Depend', 'inward'), link('Blocks', 'inward')], [])).toEqual([]);
  });
});
