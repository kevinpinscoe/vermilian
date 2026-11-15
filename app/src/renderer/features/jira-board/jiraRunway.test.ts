import { describe, expect, it } from 'vitest';
import type { RunwayEntry } from '../../../shared/runway';
import type { NamespacedIssueId } from '../../../shared/tracker';
import { decideJiraRank, indexJiraRunway, jiraKeyOf, jiraRunwayId, runwayEntryFor } from './jiraRunway';

function entry(issueId: string, over: Partial<RunwayEntry> = {}): RunwayEntry {
  return { issueId: issueId as NamespacedIssueId, focus: false, focusRank: null, whyNow: null, ...over };
}

describe('jira Runway IDs', () => {
  it('namespaces a Jira key and reads it back', () => {
    expect(jiraRunwayId('DEMO-101')).toBe('jira:DEMO-101');
    expect(jiraKeyOf('jira:DEMO-101')).toBe('DEMO-101');
    expect(jiraKeyOf('yt:2-1')).toBeNull();
  });
});

describe('indexJiraRunway', () => {
  const index = indexJiraRunway([
    entry('jira:DEMO-101', { focus: true, focusRank: 1, whyNow: 'Due Friday' }),
    entry('jira:DEMO-102', { focus: true }),
    entry('yt:2-1', { focus: true, focusRank: 2 }), // never a Jira entry
  ]);

  it('indexes Jira entries by key and rank, ignoring other providers', () => {
    expect([...index.byKey.keys()]).toEqual(['DEMO-101', 'DEMO-102']);
    expect([...index.byRank.entries()]).toEqual([[1, 'DEMO-101']]);
  });

  it('gives an issue with no entry the empty state', () => {
    expect(runwayEntryFor(index, 'OPS-7')).toEqual(entry('jira:OPS-7'));
    expect(runwayEntryFor(index, 'DEMO-101').whyNow).toBe('Due Friday');
  });
});

describe('decideJiraRank', () => {
  const index = indexJiraRunway([entry('jira:DEMO-101', { focus: true, focusRank: 1 })]);

  it('assigns a free rank directly', () => {
    expect(decideJiraRank(index, 2, 'DEMO-102')).toEqual({ kind: 'direct' });
  });

  it('asks before moving a rank another issue holds', () => {
    expect(decideJiraRank(index, 1, 'DEMO-102')).toEqual({ kind: 'confirm', holderKey: 'DEMO-101' });
  });

  it('does nothing for the rank the issue already holds', () => {
    expect(decideJiraRank(index, 1, 'DEMO-101')).toEqual({ kind: 'unchanged' });
  });
});
