import { describe, expect, it } from 'vitest';
import { looksLikeRunwayReference, parseRunwayReference, runwayKeyOf } from './runwayReference';

// Synthetic hosts and keys only.
const YT = 'https://yt.example.test';
const YT_SUBPATH = 'https://tools.example.test/youtrack/';
const JIRA = 'https://site.example.test';

describe('runwayKeyOf', () => {
  it('keeps a YouTrack key as typed and uppercases a Jira key', () => {
    expect(runwayKeyOf('youtrack', ' READ-12 ')).toBe('READ-12');
    expect(runwayKeyOf('jira', 'ops-7')).toBe('OPS-7');
  });
  it('refuses what is not a key', () => {
    expect(runwayKeyOf('youtrack', 'READ 12')).toBeNull();
    expect(runwayKeyOf('jira', 'OPS-0')).toBeNull();
    expect(runwayKeyOf('youtrack', '2-45')).toBeNull(); // an entity ID is not something you type
  });
});

describe('parseRunwayReference', () => {
  it('a key', () => {
    expect(parseRunwayReference('READ-12', 'youtrack', YT)).toEqual({ ok: true, localId: 'READ-12', from: 'key' });
    expect(parseRunwayReference('ops-7', 'jira', JIRA)).toEqual({ ok: true, localId: 'OPS-7', from: 'key' });
  });

  it.each([
    [`${YT}/issue/READ-12`, 'READ-12'],
    [`${YT}/issue/READ-12/cache-articles-locally`, 'READ-12'],
    [`${YT}/issue/READ-12?tab=comments`, 'READ-12'],
    ['HTTPS://YT.EXAMPLE.TEST/issue/READ-12', 'READ-12'],
    // The project view's links (review of PR 197).
    [`${YT}/projects/READ/issues/READ-12`, 'READ-12'],
    [`${YT}/projects/READ/issues/READ-12/cache-articles-locally`, 'READ-12'],
    [`${YT}/projects/0-7/issues/READ-12?tab=history`, 'READ-12'],
  ])('a YouTrack link %s', (url, key) => {
    expect(parseRunwayReference(url, 'youtrack', YT)).toEqual({ ok: true, localId: key, from: 'url' });
  });

  it('a project-view link on another host is refused before any request', () => {
    expect(parseRunwayReference('https://other.example.test/projects/READ/issues/READ-12', 'youtrack', YT)).toMatchObject({ ok: false, code: 'foreign-host' });
  });

  it('a project-view link that names no ticket is refused', () => {
    expect(parseRunwayReference(`${YT}/projects/READ/issues`, 'youtrack', YT)).toMatchObject({ ok: false, code: 'not-a-ticket-url' });
    expect(parseRunwayReference(`${YT}/projects/READ/issues/not-a-key`, 'youtrack', YT)).toMatchObject({ ok: false, code: 'not-a-ticket-url' });
    // A Jira link shape on the YouTrack host is not a YouTrack ticket link.
    expect(parseRunwayReference(`${YT}/browse/READ-12`, 'youtrack', YT)).toMatchObject({ ok: false, code: 'not-a-ticket-url' });
    // A malformed percent-escape is refused, not thrown (PR 229 review).
    expect(parseRunwayReference(`${YT}/issue/%ZZ`, 'youtrack', YT)).toMatchObject({ ok: false, code: 'not-a-ticket-url' });
    expect(parseRunwayReference(`${YT}/issue/READ-%E0%A4%A`, 'youtrack', YT)).toMatchObject({ ok: false, code: 'not-a-ticket-url' });
    expect(parseRunwayReference(`${JIRA}/browse/OPS-%ZZ`, 'jira', JIRA)).toMatchObject({ ok: false, code: 'not-a-ticket-url' });
  });

  it('a project-view link under the configured server path', () => {
    expect(parseRunwayReference('https://tools.example.test/youtrack/projects/READ/issues/READ-12', 'youtrack', YT_SUBPATH)).toMatchObject({ ok: true, localId: 'READ-12' });
  });

  it('a YouTrack link under the configured server path, and not outside it', () => {
    expect(parseRunwayReference('https://tools.example.test/youtrack/issue/READ-12', 'youtrack', YT_SUBPATH)).toMatchObject({ ok: true, localId: 'READ-12' });
    expect(parseRunwayReference('https://tools.example.test/issue/READ-12', 'youtrack', YT_SUBPATH)).toMatchObject({ ok: false, code: 'not-a-ticket-url' });
  });

  it.each([
    [`${JIRA}/browse/OPS-7`, 'OPS-7'],
    [`${JIRA}/browse/ops-7`, 'OPS-7'],
    [`${JIRA}/jira/software/projects/OPS/boards/1?selectedIssue=OPS-7`, 'OPS-7'],
  ])('a Jira link %s', (url, key) => {
    expect(parseRunwayReference(url, 'jira', JIRA)).toEqual({ ok: true, localId: key, from: 'url' });
  });

  it.each([
    ['another Jira site', 'https://other.example.test/browse/OPS-7', 'jira', JIRA],
    ['the other tracker', `${YT}/issue/READ-12`, 'jira', JIRA],
    ['a Jira link in a YouTrack workspace', `${JIRA}/browse/OPS-7`, 'youtrack', YT],
    ['a look-alike host', 'https://site.example.test.attacker.test/browse/OPS-7', 'jira', JIRA],
    ['another port', 'https://site.example.test:8443/browse/OPS-7', 'jira', JIRA],
  ] as const)('refuses %s as a foreign host, naming the workspace host', (_label, url, tracker, base) => {
    const r = parseRunwayReference(url, tracker, base);
    expect(r).toMatchObject({ ok: false, code: 'foreign-host' });
    if (!r.ok) expect(r.message).toContain(new URL(base).host);
  });

  it.each([
    [`${YT}/projects/READ`, 'youtrack', YT],
    [`${YT}/issue/`, 'youtrack', YT],
    [`${JIRA}/browse/`, 'jira', JIRA],
    [`${JIRA}/wiki/spaces/OPS`, 'jira', JIRA],
  ] as const)('refuses a link on the right host that is not a ticket: %s', (url, tracker, base) => {
    expect(parseRunwayReference(url, tracker, base)).toMatchObject({ ok: false, code: 'not-a-ticket-url' });
  });

  it('refuses empty text and text that is neither a key nor a link', () => {
    expect(parseRunwayReference('   ', 'youtrack', YT)).toMatchObject({ ok: false, code: 'empty' });
    expect(parseRunwayReference('cache articles', 'youtrack', YT)).toMatchObject({ ok: false, code: 'not-a-reference' });
    expect(parseRunwayReference('ftp://yt.example.test/issue/READ-12', 'youtrack', YT)).toMatchObject({ ok: false, code: 'not-a-reference' });
  });

  it('refuses a link when the workspace has no tracker address', () => {
    expect(parseRunwayReference(`${JIRA}/browse/OPS-7`, 'jira', '')).toMatchObject({ ok: false, code: 'foreign-host' });
  });
});

describe('looksLikeRunwayReference', () => {
  it('a key or a link is a reference; other text is a search', () => {
    expect(looksLikeRunwayReference('READ-12', 'youtrack')).toBe(true);
    expect(looksLikeRunwayReference('https://anything.example.test/x', 'jira')).toBe(true);
    expect(looksLikeRunwayReference('cache articles', 'youtrack')).toBe(false);
  });
});
