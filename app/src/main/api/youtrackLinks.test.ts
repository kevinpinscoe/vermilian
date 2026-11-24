import { describe, expect, it } from 'vitest';
import { mapYouTrackLinks, type RawIssueLink } from './youtrackLinks';
import { linkRole, prerequisitesOf } from '../../shared/issueLink';

// Synthetic keys only. Link type shapes as the live server returns them
// (/api/issueLinkTypes, checked 2026-11-23).
const DEPEND = { name: 'Depend', sourceToTarget: 'is required for', targetToSource: 'depends on', directed: true };
const RELATES = { name: 'Relates', sourceToTarget: 'relates to', targetToSource: '', directed: false };
const SUBTASK = { name: 'Subtask', sourceToTarget: 'parent for', targetToSource: 'subtask of', directed: true };
const linked = (key: string, resolved: number | null = null) => ({ id: `2-${key}`, idReadable: key, summary: `${key} summary`, resolved, customFields: [] });
/** A linked issue whose response omits `resolved` altogether. */
const linkedNoResolved = (key: string) => ({ id: `2-${key}`, idReadable: key, summary: `${key} summary`, customFields: [] });

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

  it('carries the linked issue\'s Status name, passing over a text prototype, null when none (VERM-97)', () => {
    const [named, none] = mapYouTrackLinks([{
      direction: 'INWARD',
      linkType: DEPEND,
      issues: [
        { ...linked('PLAT-40'), customFields: [{ name: 'Type', $type: 'x', value: { name: 'Task' } }, { name: 'Status', $type: 'x', value: 'orphan' }, { name: 'Status', $type: 'x', value: { name: 'In Progress' } }] },
        linked('PLAT-42'),
      ],
    }]);
    expect(named.issue.status).toBe('In Progress');
    expect(none.issue.status).toBeNull();
  });

  it('maps a Depend link in each direction, with the wording from this side and the linked resolved state', () => {
    expect(links.slice(0, 3)).toEqual([
      { type: 'Depend', directed: true, direction: 'inward', verb: 'depends on', issue: { id: '2-SYNC-3', key: 'SYNC-3', summary: 'SYNC-3 summary', resolved: false, status: null } },
      { type: 'Depend', directed: true, direction: 'inward', verb: 'depends on', issue: { id: '2-SYNC-2', key: 'SYNC-2', summary: 'SYNC-2 summary', resolved: true, status: null } },
      { type: 'Depend', directed: true, direction: 'outward', verb: 'is required for', issue: { id: '2-PLAT-41', key: 'PLAT-41', summary: 'PLAT-41 summary', resolved: false, status: null } },
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

  it('keeps the three resolution states apart: omitted is unknown, null is open, a time is resolved', () => {
    const [omitted, open, resolved] = mapYouTrackLinks([
      { direction: 'INWARD', linkType: DEPEND, issues: [linkedNoResolved('SYNC-1'), linked('SYNC-3', null), linked('SYNC-2', 1_790_000_000_000)] },
    ]);
    expect([omitted.issue.key, omitted.issue.resolved]).toEqual(['SYNC-1', null]);
    expect([open.issue.key, open.issue.resolved]).toEqual(['SYNC-3', false]);
    expect([resolved.issue.key, resolved.issue.resolved]).toEqual(['SYNC-2', true]);
    // An unknown resolution is still a prerequisite; it is just not known to be done.
    expect(linkRole(omitted)).toBe('prerequisite');
  });

  it("uses the type name, never the other direction's wording, when a direction has none", () => {
    // Inward with no targetToSource: the prerequisite must not read "is required for".
    const [inward] = mapYouTrackLinks([{ direction: 'INWARD', linkType: { name: 'Depend', sourceToTarget: 'is required for', targetToSource: '', directed: true }, issues: [linked('SYNC-3')] }]);
    expect(inward).toMatchObject({ direction: 'inward', verb: 'Depend' });
    expect(linkRole(inward)).toBe('prerequisite');
    // Outward with no sourceToTarget: likewise never the inward wording.
    const [outward] = mapYouTrackLinks([{ direction: 'OUTWARD', linkType: { name: 'Depend', sourceToTarget: null, targetToSource: 'depends on', directed: true }, issues: [linked('PLAT-41')] }]);
    expect(outward).toMatchObject({ direction: 'outward', verb: 'Depend' });
    // Undirected with no wording, and no type wording at all.
    const [both] = mapYouTrackLinks([{ direction: 'BOTH', linkType: { name: 'Relates', sourceToTarget: '', directed: false }, issues: [linked('READ-9')] }]);
    expect(both).toMatchObject({ direction: 'both', verb: 'Relates' });
    const [bare] = mapYouTrackLinks([{ direction: 'OUTWARD', linkType: { name: 'Custom' }, issues: [linked('SYNC-3')] }]);
    expect(bare).toMatchObject({ verb: 'Custom', directed: false });
  });
});
