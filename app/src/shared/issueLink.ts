// A ticket's links to other tickets, provider-neutral (VERM-94): the facts the
// blocker states (VERM-97) are computed from, YouTrack now and Jira with
// VERM-95. Pure TypeScript — no Electron, no React.
//
// An IssueLink records only what the tracker says. Whether a link makes the
// linked ticket a prerequisite of this one is decided by linkRole(), from the
// link's type and direction and the workspace's prerequisite link types
// (configurable per workspace with VERM-96), so changing that setting never
// requires re-reading or re-mapping links.
//
// Direction is as this ticket sees it. For a directed link type the tracker
// keeps two buckets: YouTrack's Depend reads "depends on" in the INWARD bucket
// and "is required for" in the OUTWARD one — VERM-94 depends on VERM-84 and
// lists VERM-84 under INWARD (checked against the live server, 2026-11-23) —
// and Jira's Blocks reads "is blocked by" inward and "blocks" outward. In both,
// an inward link of a prerequisite type makes the linked ticket a
// prerequisite of this one, and an outward link makes it a dependent.

export type IssueLinkDirection = 'inward' | 'outward' | 'both';

export interface LinkedTicket {
  /** The tracker's entity ID (YouTrack 2-45); null when the tracker gives none. */
  id: string | null;
  /** The readable key (READ-14, OPS-956). */
  key: string;
  summary: string;
  /** Whether the linked ticket is resolved (YouTrack `resolved`, Jira status category Done). */
  resolved: boolean;
}

export interface IssueLink {
  /** The tracker's link type name: YouTrack "Depend", Jira "Blocks". */
  type: string;
  /** Whether the link type has two distinct ends. */
  directed: boolean;
  /** As this ticket sees it; 'both' for an undirected link. */
  direction: IssueLinkDirection;
  /** The link's wording from this ticket's side: "depends on", "is required for", "relates to". */
  verb: string;
  issue: LinkedTicket;
}

/** The prerequisite link types when a workspace has set none (VERM-96 makes them configurable). */
export const DEFAULT_PREREQUISITE_LINK_TYPES: readonly string[] = ['Depend', 'Blocks'];

/** Link types that are never prerequisites, whatever a workspace configures: parent and child. */
export const NEVER_PREREQUISITE_LINK_TYPES: readonly string[] = ['Subtask'];

export type LinkRole = 'prerequisite' | 'dependent' | null;

/**
 * What the linked ticket is to this one: 'prerequisite' (this ticket depends
 * on it), 'dependent' (it depends on this ticket), or null when the link is
 * not of a prerequisite type, is undirected, or is a parent/child link.
 * Link type names compare exactly, as the tracker spells them.
 */
export function linkRole(link: IssueLink, prerequisiteTypes: readonly string[] = DEFAULT_PREREQUISITE_LINK_TYPES): LinkRole {
  if (NEVER_PREREQUISITE_LINK_TYPES.includes(link.type)) return null;
  if (!prerequisiteTypes.includes(link.type) || !link.directed) return null;
  if (link.direction === 'inward') return 'prerequisite';
  if (link.direction === 'outward') return 'dependent';
  return null;
}

/** This ticket's prerequisites among its links, in link order. */
export function prerequisitesOf(links: readonly IssueLink[], prerequisiteTypes?: readonly string[]): IssueLink[] {
  return links.filter((l) => linkRole(l, prerequisiteTypes) === 'prerequisite');
}
