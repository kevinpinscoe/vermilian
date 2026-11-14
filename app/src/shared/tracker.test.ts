import { describe, expect, it } from 'vitest';
import {
  TRACKER_KINDS,
  decodeIssueId,
  encodeIssueId,
  isNamespacedIssueId,
  isTrackerKind,
  isWritableTracker,
  parseIssueId,
  trackerKindOf,
  type TrackerKind,
  type TrackerProvider,
} from './tracker';

describe('TrackerKind', () => {
  it('lists exactly youtrack and jira', () => {
    expect([...TRACKER_KINDS]).toEqual(['youtrack', 'jira']);
  });

  it('recognises only known kinds', () => {
    expect(isTrackerKind('youtrack')).toBe(true);
    expect(isTrackerKind('jira')).toBe(true);
    expect(isTrackerKind('yt')).toBe(false);
    expect(isTrackerKind('Jira')).toBe(false);
    expect(isTrackerKind(undefined)).toBe(false);
  });
});

describe('encodeIssueId', () => {
  it('prefixes YouTrack IDs with yt:', () => {
    expect(encodeIssueId('youtrack', 'DEMO-123')).toBe('yt:DEMO-123');
    expect(encodeIssueId('youtrack', 'Demo_2-7')).toBe('yt:Demo_2-7');
    expect(encodeIssueId('youtrack', '2-45')).toBe('yt:2-45');
  });

  it('prefixes Jira keys with jira:', () => {
    expect(encodeIssueId('jira', 'DEMO-123')).toBe('jira:DEMO-123');
    expect(encodeIssueId('jira', 'AB_1-9')).toBe('jira:AB_1-9');
  });

  it.each<[TrackerKind, string]>([
    ['jira', ''],
    ['jira', 'DEMO'],
    ['jira', 'demo-1'],
    ['jira', 'DEMO-0'],
    ['jira', 'DEMO-01'],
    ['jira', '1DEMO-1'],
    ['jira', 'DEMO-1 '],
    ['jira', 'jira:DEMO-1'],
    ['jira', '2-45'],
    ['youtrack', ''],
    ['youtrack', 'DEMO'],
    ['youtrack', '-1'],
    ['youtrack', 'DEMO-1-2'],
    ['youtrack', 'yt:DEMO-1'],
    ['youtrack', 'DEMO 1'],
  ])('rejects malformed %s ID %j', (kind, localId) => {
    expect(() => encodeIssueId(kind, localId)).toThrow(/Invalid/);
  });

  it('rejects an unknown kind', () => {
    expect(() => encodeIssueId('github' as TrackerKind, 'DEMO-1')).toThrow(/Unknown tracker kind/);
  });
});

describe('decodeIssueId', () => {
  it('decodes both kinds', () => {
    expect(decodeIssueId('yt:DEMO-123')).toEqual({ kind: 'youtrack', localId: 'DEMO-123' });
    expect(decodeIssueId('yt:2-45')).toEqual({ kind: 'youtrack', localId: '2-45' });
    expect(decodeIssueId('jira:DEMO-123')).toEqual({ kind: 'jira', localId: 'DEMO-123' });
  });

  it.each([
    'DEMO-123', // bare, un-namespaced
    '2-45',
    ':DEMO-1',
    'yt:',
    'jira:',
    'gh:DEMO-1',
    'YT:DEMO-1',
    'youtrack:DEMO-1',
    'jira:demo-1',
    'jira:2-45', // a YouTrack entity ID is not a Jira key
    'jira:DEMO-1:x',
    ' jira:DEMO-1',
    '',
  ])('rejects %j', (id) => {
    expect(decodeIssueId(id)).toBeNull();
    expect(isNamespacedIssueId(id)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 42, {}, ['jira:DEMO-1']]) {
      expect(decodeIssueId(v)).toBeNull();
    }
  });
});

describe('round trip', () => {
  it.each<[TrackerKind, string]>([
    ['youtrack', 'DEMO-123'],
    ['youtrack', '2-45'],
    ['jira', 'DEMO-123'],
    ['jira', 'X9-1000'],
  ])('%s %s survives encode then decode', (kind, localId) => {
    const id = encodeIssueId(kind, localId);
    expect(isNamespacedIssueId(id)).toBe(true);
    expect(decodeIssueId(id)).toEqual({ kind, localId });
    expect(trackerKindOf(id)).toBe(kind);
  });

  it('keeps the same local ID distinct across trackers', () => {
    expect(encodeIssueId('youtrack', 'DEMO-1')).not.toBe(encodeIssueId('jira', 'DEMO-1'));
  });
});

describe('parseIssueId', () => {
  it('returns the decoded ID', () => {
    expect(parseIssueId('jira:DEMO-5')).toEqual({ kind: 'jira', localId: 'DEMO-5' });
  });

  it('throws on a malformed ID', () => {
    expect(() => parseIssueId('DEMO-5')).toThrow(/Malformed namespaced issue ID/);
  });
});

describe('isWritableTracker', () => {
  const reader: TrackerProvider = {
    kind: 'jira',
    getCurrentUser: async () => 'User',
    getProjects: async () => [],
    getIssues: async () => [],
    searchIssues: async () => [],
    getIssueDetail: async () => {
      throw new Error('not used');
    },
  };
  const noop = async () => undefined;

  it('is false for a read-only provider', () => {
    expect(isWritableTracker(reader)).toBe(false);
  });

  it('is false when any write operation is missing', () => {
    const partial = { ...reader, patchIssue: noop, postComment: noop, moveIssue: noop, deleteIssue: noop };
    expect(isWritableTracker(partial)).toBe(false);
  });

  it('is true when every write operation is present', () => {
    const full = { ...reader, patchIssue: noop, postComment: noop, moveIssue: noop, deleteIssue: noop, postWorklog: noop };
    expect(isWritableTracker(full)).toBe(true);
  });
});
