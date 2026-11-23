// YouTrack issue links to provider-neutral IssueLinks (VERM-94). Pure: no
// network, so the mapping is unit-tested without a server. The raw shapes are
// what api/youtrack.ts's ISSUE_FIELDS links(...) embed returns.

import type { IssueLink } from '../../shared/issueLink';

/** A linked issue inside a links() bucket (typed as before VERM-94: api/youtrack.ts reads its Type). */
export interface RawLinkedIssue {
  id: string;
  idReadable: string;
  summary: string;
  resolved?: number | null;
  customFields: Array<{ name: string; $type: string; value: unknown }>;
}

export interface RawIssueLink {
  direction: 'OUTWARD' | 'INWARD' | 'BOTH';
  linkType: { name: string; sourceToTarget?: string | null; targetToSource?: string | null; directed?: boolean | null };
  issues: RawLinkedIssue[];
}

/**
 * A YouTrack issue's links as provider-neutral IssueLinks (VERM-94), one per
 * linked issue, every link type kept (Subtask included: linkRole decides what
 * a link means). Direction is as this issue sees it: an INWARD link reads
 * with the type's targetToSource wording ("depends on"), an OUTWARD one with
 * sourceToTarget ("is required for"); an undirected link (BOTH) reads
 * sourceToTarget ("relates to"). A link without a type name is skipped.
 */
export function mapYouTrackLinks(links: readonly RawIssueLink[] | undefined): IssueLink[] {
  const out: IssueLink[] = [];
  for (const link of links ?? []) {
    const type = link.linkType?.name;
    if (!type) continue;
    const directed = link.linkType.directed === true;
    const direction = link.direction === 'INWARD' ? 'inward' : link.direction === 'OUTWARD' ? 'outward' : 'both';
    const wording = direction === 'inward' ? link.linkType.targetToSource : link.linkType.sourceToTarget;
    const verb = wording || link.linkType.sourceToTarget || type;
    for (const linked of link.issues ?? []) {
      out.push({
        type,
        directed,
        direction,
        verb,
        issue: {
          id: linked.id ?? null,
          key: linked.idReadable,
          summary: linked.summary ?? '',
          resolved: linked.resolved !== null && linked.resolved !== undefined,
        },
      });
    }
  }
  return out;
}

