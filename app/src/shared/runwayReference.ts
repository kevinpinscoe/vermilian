// What the Runway view's Add box was given (VERM-86): a ticket key, or a
// ticket URL on the workspace's own tracker. Pure — no Electron, no React —
// and run in the main process before any request is made, so a URL from
// another host never reaches a tracker.
//
// Accepted:
//   key       READ-12. A YouTrack key as typed; a Jira key uppercased, as
//             Jira compares keys.
//   YouTrack  <workspace server>/issue/READ-12, optionally with the title
//             slug YouTrack appends (/issue/READ-12/cache-articles-locally).
//   Jira      <workspace site>/browse/OPS-7, or any page on the site with
//             ?selectedIssue=OPS-7 (a board with the issue open).
// The URL's host must be the workspace's configured tracker host, and its
// path must sit under the configured server path (YouTrack under /youtrack,
// for example). Anything else is refused with a reason.

import { isValidLocalId, type TrackerKind } from './tracker';

export type RunwayReferenceRefusal = 'empty' | 'not-a-reference' | 'foreign-host' | 'not-a-ticket-url';

export type RunwayReference =
  | { ok: true; localId: string; from: 'key' | 'url' }
  | { ok: false; code: RunwayReferenceRefusal; message: string };

const trackerName = (tracker: TrackerKind) => (tracker === 'jira' ? 'Jira' : 'YouTrack');

/** A key for `tracker`, normalised as that tracker compares keys; null if it is not one. */
export function runwayKeyOf(tracker: TrackerKind, text: string): string | null {
  const t = text.trim();
  const key = tracker === 'jira' ? t.toUpperCase() : t;
  return /^[A-Za-z][A-Za-z0-9_]*-[0-9]+$/.test(key) && isValidLocalId(tracker, key) ? key : null;
}

function parseUrl(text: string): URL | null {
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** The configured server path, without a trailing slash ('' for the root). */
const basePath = (base: URL) => base.pathname.replace(/\/+$/, '');

/**
 * Parses the Add box's text for a workspace on `tracker` whose tracker is at
 * `trackerBaseUrl` (the YouTrack server URL, or the Jira site URL).
 */
export function parseRunwayReference(text: string, tracker: TrackerKind, trackerBaseUrl: string): RunwayReference {
  const input = text.trim();
  if (!input) return { ok: false, code: 'empty', message: 'Enter a ticket key or link.' };

  const key = runwayKeyOf(tracker, input);
  if (key) return { ok: true, localId: key, from: 'key' };

  const url = parseUrl(input);
  if (!url) {
    return { ok: false, code: 'not-a-reference', message: `“${input}” is not a ${trackerName(tracker)} ticket key or link.` };
  }

  const base = parseUrl(trackerBaseUrl.trim());
  if (!base || url.host.toLowerCase() !== base.host.toLowerCase()) {
    const where = base ? base.host : 'this workspace’s tracker';
    return {
      ok: false,
      code: 'foreign-host',
      message: `That link is not on this workspace’s tracker. Only ${trackerName(tracker)} links on ${where} can be added.`,
    };
  }

  const prefix = basePath(base);
  const path = url.pathname;
  const underBase = prefix === '' || path === prefix || path.startsWith(`${prefix}/`);
  const rest = underBase ? path.slice(prefix.length) : '';
  let candidate: string | null = null;
  if (underBase) {
    if (tracker === 'youtrack') {
      candidate = /^\/issue\/([^/]+)(?:\/[^/]*)?\/?$/.exec(rest)?.[1] ?? null;
    } else {
      candidate = /^\/browse\/([^/]+)\/?$/.exec(rest)?.[1] ?? url.searchParams.get('selectedIssue');
    }
  }
  const linked = candidate ? runwayKeyOf(tracker, decodeURIComponent(candidate)) : null;
  if (!linked) {
    return { ok: false, code: 'not-a-ticket-url', message: `That link does not point at a ${trackerName(tracker)} ticket.` };
  }
  return { ok: true, localId: linked, from: 'url' };
}

/** Whether the text should be treated as a key or link rather than as search terms. */
export function looksLikeRunwayReference(text: string, tracker: TrackerKind): boolean {
  const t = text.trim();
  return runwayKeyOf(tracker, t) !== null || /^https?:\/\//i.test(t);
}
