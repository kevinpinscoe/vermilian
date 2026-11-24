// Jira issue links to provider-neutral IssueLinks (VERM-95), the Jira half of
// VERM-94. Pure TypeScript — no Electron, no React — so it is unit-tested
// without a site.
//
// Jira's `issuelinks` field lists each link once from this issue's side: its
// type carries both wordings (Blocks: inward "is blocked by", outward
// "blocks"), and the other issue sits under `inwardIssue` when the inward
// wording describes this issue ("this issue is blocked by inwardIssue") or
// under `outwardIssue` when the outward one does. So an inward Blocks link
// makes the linked issue a prerequisite — the same rule as YouTrack's Depend
// (shared/issueLink.ts linkRole).
//
// A link type whose two wordings are the same (Relates: "relates to" both
// ways) has no distinct ends and maps as undirected, direction 'both'. The
// verb is the wording for this link's own direction, else the type's name —
// never the other direction's wording.
//
// Whether the linked issue is done follows the linked issue's own project's
// status mapping (VERM-31) when Vermilian has one, else Jira's status
// category (Kevin, 2026-11-23): so a prerequisite counts as done exactly when
// Vermilian shows that issue as done elsewhere. With no readable status the
// state is unknown (null), never assumed open.

import type { IssueLink } from './issueLink';
import type { StatusRole } from './workspace';
import { jiraStatusRole, type JiraStatusValue } from './jiraProjectSettings';

/** A project's status mapping (JiraProjectSettings.statusRoles), by project key; undefined when it has none. */
export type JiraStatusRolesFor = (projectKey: string) => Record<string, StatusRole> | undefined;

interface RawJiraLinkType {
  name?: unknown;
  inward?: unknown;
  outward?: unknown;
}

interface RawJiraLinkedIssue {
  id?: unknown;
  key?: unknown;
  fields?: { summary?: unknown; status?: JiraStatusValue | null } | null;
}

interface RawJiraIssueLink {
  type?: RawJiraLinkType | null;
  inwardIssue?: RawJiraLinkedIssue | null;
  outwardIssue?: RawJiraLinkedIssue | null;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The project key of an issue key: `OPS_2-7` → `OPS_2`. */
const projectOf = (key: string): string => key.replace(/-\d+$/, '');

/** Done → true, any other known meaning → false, no readable status → null. */
function resolvedOf(issue: RawJiraLinkedIssue, key: string, statusRolesFor: JiraStatusRolesFor): boolean | null {
  const role = jiraStatusRole(issue.fields?.status ?? null, statusRolesFor(projectOf(key)));
  return role === null ? null : role === 'done';
}

/**
 * The issue's links as IssueLinks, one per link, every type kept. undefined
 * when the response carried no `issuelinks` array (not read — the blocker
 * states treat that as Unknown); [] when it carried an empty one. A link
 * with no type name, or no linked issue key, is skipped.
 */
export function mapJiraLinks(raw: unknown, statusRolesFor: JiraStatusRolesFor = () => undefined): IssueLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: IssueLink[] = [];
  for (const link of raw as Array<RawJiraIssueLink | null>) {
    const type = text(link?.type?.name);
    if (!link || !type) continue;
    const inwardWording = text(link.type?.inward);
    const outwardWording = text(link.type?.outward);
    const directed = !(inwardWording && inwardWording === outwardWording);
    const side = link.inwardIssue ? 'inward' : link.outwardIssue ? 'outward' : null;
    const other = link.inwardIssue ?? link.outwardIssue;
    const key = text(other?.key);
    if (!side || !other || !key) continue;
    const direction = directed ? side : 'both';
    const wording = side === 'inward' ? inwardWording : outwardWording;
    out.push({
      type,
      directed,
      direction,
      verb: wording || type,
      issue: {
        id: text(other.id) || null,
        key,
        summary: text(other.fields?.summary),
        resolved: resolvedOf(other, key, statusRolesFor),
        status: text(other.fields?.status?.name) || null,
      },
    });
  }
  return out;
}
