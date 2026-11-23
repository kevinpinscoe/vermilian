import { describe, expect, it } from 'vitest';
import { mapYouTrackLinks, type RawIssueLink } from './youtrackLinks';
import { linkRole, prerequisitesOf } from '../../shared/issueLink';

// Synthetic keys only. Link type shapes as the live server returns them
// (/api/issueLinkTypes, checked 2026-11-23).
const DEPEND = { name: 'Depend', sourceToTarget: 'is required for', targetToSource: 'depends on', directed: true };
const RELATES = { name: 'Relates', sourceToTarget: 'relates to', targetToSource: '', directed: false };
const SUBTASK = { name: 'Subtask', sourceToTarget: 'parent for', targetToSource: 'subtask of', directed: true };
const linked = (key: string, resolved: number | null = null) => ({ id: `2-${key}`, idReadable: key, summary: `${key} summary`, resolved, customFields: [] });

// READ-14 depends on SYNC-3 (open) and SYNC-2 (resolved); PLAT-41 depends on READ-14.
const READ_14: RawIssueLink[] = [
  { direction: 'INWARD', linkType: DEPEND, issues: [linked('SYNC-3'), linked('SYNC-2', 1_790_000_000_000)] },
  { direction: 'OUTWARD', linkType: DEPEND, issues: [linked('PLAT-41')] },
  { direction: 'BOTH', linkType: RELATES, issues: [linked('READ-9')] },
  { direction: 'INWARD', linkType: SUBTASK, issues: [linked('READ-12')] },
  // Empty buckets, as the server sends for every type with no links.
  { direction: 'OUTWARD', linkType: SUBTASK, issues: [] },
];

describe('mapYouTrackLinks (VERM-94)', () => {
  const links = mapYouTrackLinks(READ_14);

  it('maps a Depend link in each direction, with the wording from this side and the linked resolved state', () => {
    expect(links.slice(0, 3)).toEqual([
      { type: 'Depend', directed: true, direction: 'inward', verb: 'depends on', issue: { id: '2-SYNC-3', key: 'SYNC-3', summary: 'SYNC-3 summary', resolved: false } },
      { type: 'Depend', directed: true, direction: 'inward', verb: 'depends on', issue: { id: '2-SYNC-2', key: 'SYNC-2', summary: 'SYNC-2 summary', resolved: true } },
      { type: 'Depend', directed: true, direction: 'outward', verb: 'is required for', issue: { id: '2-PLAT-41', key: 'PLAT-41', summary: 'PLAT-41 summary', resolved: false } },
    ]);
  });

  it('keeps other link types, an undirected one as both', () => {
    expect(links.slice(3).map((l) => [l.type, l.direction, l.verb, l.issue.key])).toEqual([
      ['Relates', 'both', 'relates to', 'READ-9'],
      ['Subtask', 'inward', 'subtask of', 'READ-12'],
    ]);
  });

  it('gives Depend links prerequisite and dependent roles, and none to the rest', () => {
    expect(links.map((l) => [l.issue.key, linkRole(l)])).toEqual([
      ['SYNC-3', 'prerequisite'], ['SYNC-2', 'prerequisite'], ['PLAT-41', 'dependent'], ['READ-9', null], ['READ-12', null],
    ]);
    expect(prerequisitesOf(links).map((l) => [l.issue.key, l.issue.resolved])).toEqual([['SYNC-3', false], ['SYNC-2', true]]);
  });

  it('is [] with no links, and skips a link with no type name', () => {
    expect(mapYouTrackLinks(undefined)).toEqual([]);
    expect(mapYouTrackLinks([])).toEqual([]);
    expect(mapYouTrackLinks([{ direction: 'INWARD', linkType: { name: '' }, issues: [linked('SYNC-3')] }])).toEqual([]);
  });

  it('falls back to the other wording, then the type name, when a side has none', () => {
    const [l] = mapYouTrackLinks([{ direction: 'INWARD', linkType: { name: 'Custom', sourceToTarget: 'feeds', targetToSource: '', directed: true }, issues: [linked('SYNC-3')] }]);
    expect(l.verb).toBe('feeds');
    const [m] = mapYouTrackLinks([{ direction: 'OUTWARD', linkType: { name: 'Custom' }, issues: [linked('SYNC-3')] }]);
    expect(m).toMatchObject({ verb: 'Custom', directed: false });
  });
});
