import { describe, expect, it } from 'vitest';
import { mapJiraLinks } from './jiraLinks';
import { linkRole, prerequisitesOf } from './issueLink';

// Synthetic keys only. Link and type shapes as Jira Cloud's issuelinks field
// returns them.
const BLOCKS = { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
const RELATES = { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' };
const status = (name: string, category?: string) => ({ name, ...(category ? { statusCategory: { key: category } } : {}) });
const issue = (key: string, s: ReturnType<typeof status> | null | undefined) => ({
  id: `1${key.replace(/\D/g, '')}`, key, fields: { summary: `${key} summary`, ...(s === undefined ? {} : { status: s }) },
});

describe('mapJiraLinks (VERM-95)', () => {
  // OPS-956 is blocked by OPS-4089 (In Progress) and OPS-12 (Done), blocks
  // DEMO-7, and relates to DEMO-102.
  const raw = [
    { id: '1', type: BLOCKS, inwardIssue: issue('OPS-4089', status('In Progress', 'indeterminate')) },
    { id: '2', type: BLOCKS, inwardIssue: issue('OPS-12', status('Done', 'done')) },
    { id: '3', type: BLOCKS, outwardIssue: issue('DEMO-7', status('To Do', 'new')) },
    { id: '4', type: RELATES, outwardIssue: issue('DEMO-102', status('To Do', 'new')) },
  ];
  const links = mapJiraLinks(raw)!;

  it('maps Blocks links to prerequisite and dependent with the linked issue\'s status category', () => {
    expect(links.slice(0, 3)).toEqual([
      { type: 'Blocks', directed: true, direction: 'inward', verb: 'is blocked by', issue: { id: '14089', key: 'OPS-4089', summary: 'OPS-4089 summary', resolved: false } },
      { type: 'Blocks', directed: true, direction: 'inward', verb: 'is blocked by', issue: { id: '112', key: 'OPS-12', summary: 'OPS-12 summary', resolved: true } },
      { type: 'Blocks', directed: true, direction: 'outward', verb: 'blocks', issue: { id: '17', key: 'DEMO-7', summary: 'DEMO-7 summary', resolved: false } },
    ]);
    expect(links.map((l) => [l.issue.key, linkRole(l)])).toEqual([
      ['OPS-4089', 'prerequisite'], ['OPS-12', 'prerequisite'], ['DEMO-7', 'dependent'], ['DEMO-102', null],
    ]);
    expect(prerequisitesOf(links).map((l) => [l.issue.key, l.issue.resolved])).toEqual([['OPS-4089', false], ['OPS-12', true]]);
  });

  it('maps a type whose two wordings match as undirected, both ways', () => {
    expect(links[3]).toMatchObject({ type: 'Relates', directed: false, direction: 'both', verb: 'relates to' });
  });

  it("judges done by the linked issue's own project mapping first, then the status category", () => {
    // OPS maps "Shipped" (an in-progress category) to done, and "Closed" (a done category) to waiting.
    const statusRolesFor = (projectKey: string) =>
      projectKey === 'OPS' ? ({ Shipped: 'done', Closed: 'waiting' } as const) : undefined;
    const mapped = mapJiraLinks([
      { type: BLOCKS, inwardIssue: issue('OPS-1', status('Shipped', 'indeterminate')) },
      { type: BLOCKS, inwardIssue: issue('OPS-2', status('Closed', 'done')) },
      // DEMO has no mapping: its category decides.
      { type: BLOCKS, inwardIssue: issue('DEMO-3', status('Shipped', 'indeterminate')) },
    ], statusRolesFor)!;
    expect(mapped.map((l) => [l.issue.key, l.issue.resolved])).toEqual([['OPS-1', true], ['OPS-2', false], ['DEMO-3', false]]);
  });

  it('keeps an unreadable status unknown, never open', () => {
    const mapped = mapJiraLinks([
      { type: BLOCKS, inwardIssue: issue('OPS-1', undefined) }, // no status field
      { type: BLOCKS, inwardIssue: issue('OPS-2', null) }, // status null
      { type: BLOCKS, inwardIssue: issue('OPS-3', status('Custom')) }, // no category, no mapping
    ])!;
    expect(mapped.map((l) => [l.issue.key, l.issue.resolved])).toEqual([['OPS-1', null], ['OPS-2', null], ['OPS-3', null]]);
    expect(linkRole(mapped[0])).toBe('prerequisite');
  });

  it("uses the type's name, never the other direction's wording, when a direction has none", () => {
    const [inward, outward] = mapJiraLinks([
      { type: { name: 'Blocks', inward: '', outward: 'blocks' }, inwardIssue: issue('OPS-1', status('To Do', 'new')) },
      { type: { name: 'Blocks', inward: 'is blocked by' }, outwardIssue: issue('OPS-2', status('To Do', 'new')) },
    ])!;
    expect(inward).toMatchObject({ direction: 'inward', verb: 'Blocks' });
    expect(linkRole(inward)).toBe('prerequisite');
    expect(outward).toMatchObject({ direction: 'outward', verb: 'Blocks' });
  });

  it('is undefined when issuelinks was not returned, [] when empty, and skips a link with no type or key', () => {
    expect(mapJiraLinks(undefined)).toBeUndefined();
    expect(mapJiraLinks(null)).toBeUndefined();
    expect(mapJiraLinks([])).toEqual([]);
    expect(mapJiraLinks([
      { type: { inward: 'x', outward: 'y' }, inwardIssue: issue('OPS-1', null) },
      { type: BLOCKS, inwardIssue: { id: '1', fields: {} } },
      { type: BLOCKS },
      null,
    ])).toEqual([]);
  });
});
