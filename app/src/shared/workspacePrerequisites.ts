// A workspace's prerequisite link types (VERM-96, proposal decision E): the
// link types whose linked ticket is something this ticket waits on, each with
// the side that reads that way. Stored in the workspace's own article as
// `prerequisiteLinkTypes`:
//
//   absent  the backend's default — YouTrack Depend ("depends on"), Jira
//           Blocks ("is blocked by"), both the inward side;
//   []      no link type is a prerequisite;
//   [...]   exactly these types and sides.
//
// The choice is made against the tracker's own link types (TrackerLinkType),
// so a misspelt name can't silently hide blockers. Subtask is a parent/child
// link and never a prerequisite. Pure TypeScript: no Electron, no React.

import {
  NEVER_PREREQUISITE_LINK_TYPES,
  defaultPrerequisiteLinkTypes,
  type PrerequisiteLinkType,
  type PrerequisiteSide,
} from './issueLink';
import type { WorkspaceDocument } from './workspaceSchema';
import { WorkspaceSetupError } from './workspaceSetup';

/**
 * A link type as the tracker defines it, for choosing prerequisites: its
 * name and the wording each side reads with. A side with no wording of its
 * own reads as the type's name, never the other side's wording. An
 * undirected type (Relates) has one wording and no sides to choose between.
 */
export interface TrackerLinkType {
  name: string;
  directed: boolean;
  inward: string;
  outward: string;
}

export type TrackerLinkTypesResult = { ok: true; types: TrackerLinkType[] } | { ok: false; message: string };

/** The workspace's prerequisite link types: its saved choice, else its backend's default. */
export function prerequisiteLinkTypesOf(doc: Pick<WorkspaceDocument, 'backend' | 'prerequisiteLinkTypes'>): readonly PrerequisiteLinkType[] {
  return doc.prerequisiteLinkTypes ?? defaultPrerequisiteLinkTypes(doc.backend.kind);
}

/** Whether the workspace uses its backend's default (has no saved choice). */
export function usesDefaultPrerequisiteLinkTypes(doc: Pick<WorkspaceDocument, 'prerequisiteLinkTypes'>): boolean {
  return doc.prerequisiteLinkTypes === undefined;
}

/** Why this tracker link type can't be chosen as a prerequisite, or null when it can. */
export function prerequisiteChoiceProblem(t: TrackerLinkType): string | null {
  if (NEVER_PREREQUISITE_LINK_TYPES.includes(t.name)) return 'A parent/child link is never a prerequisite.';
  if (!t.directed) return 'This link reads the same both ways, so neither side is waited on.';
  return null;
}

/** The wording a tracker link type reads with on this side. */
export function sideWording(t: TrackerLinkType, side: PrerequisiteSide): string {
  return side === 'inward' ? t.inward : t.outward;
}

/**
 * The workspace with these prerequisite link types, or with none saved
 * (null: back to the backend's default). Duplicated types keep their first
 * side; names are kept exactly as given. Everything else is kept.
 *
 * Throws WorkspaceSetupError for a parent/child link type or a blank name.
 */
export function withPrerequisiteLinkTypes(doc: WorkspaceDocument, entries: readonly PrerequisiteLinkType[] | null): WorkspaceDocument {
  const { prerequisiteLinkTypes: _old, ...rest } = doc;
  if (entries === null) return rest;
  const seen = new Set<string>();
  const kept: PrerequisiteLinkType[] = [];
  for (const e of entries) {
    if (typeof e.type !== 'string' || e.type === '') throw new WorkspaceSetupError('A prerequisite link type needs a name.');
    if (NEVER_PREREQUISITE_LINK_TYPES.includes(e.type)) throw new WorkspaceSetupError(`${e.type} is a parent/child link, which is never a prerequisite.`);
    if (e.side !== 'inward' && e.side !== 'outward') throw new WorkspaceSetupError(`Choose which side of ${e.type} is the prerequisite.`);
    if (seen.has(e.type)) continue;
    seen.add(e.type);
    kept.push({ type: e.type, side: e.side });
  }
  return { ...rest, prerequisiteLinkTypes: kept };
}

// ─── The trackers' link types, as TrackerLinkType ───────────────────────────

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * YouTrack's GET /api/issueLinkTypes. The inward side (the INWARD bucket)
 * reads targetToSource ("depends on"), the outward side sourceToTarget ("is
 * required for"), as in mapYouTrackLinks; an undirected type reads
 * sourceToTarget both ways. Unnamed entries are skipped.
 */
export function mapYouTrackLinkTypes(raw: unknown): TrackerLinkType[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t: { name?: unknown; directed?: unknown; sourceToTarget?: unknown; targetToSource?: unknown } | null) => {
    const name = text(t?.name);
    if (!name) return [];
    const directed = t?.directed === true;
    const outward = text(t?.sourceToTarget) || name;
    const inward = directed ? text(t?.targetToSource) || name : outward;
    return [{ name, directed, inward, outward }];
  });
}

/**
 * Jira's GET /rest/api/3/issueLinkType ({ issueLinkTypes: [...] }). A type
 * whose two wordings are the same (Relates) is undirected, as in mapJiraLinks.
 */
export function mapJiraLinkTypes(raw: unknown): TrackerLinkType[] {
  const list = (raw as { issueLinkTypes?: unknown } | null)?.issueLinkTypes;
  if (!Array.isArray(list)) return [];
  return list.flatMap((t: { name?: unknown; inward?: unknown; outward?: unknown } | null) => {
    const name = text(t?.name);
    if (!name) return [];
    const inwardWording = text(t?.inward);
    const outwardWording = text(t?.outward);
    const directed = !(inwardWording && inwardWording === outwardWording);
    return [{ name, directed, inward: inwardWording || name, outward: outwardWording || name }];
  });
}

// ─── The picker: one row per link type ──────────────────────────────────────

/**
 * One row of the prerequisite picker. `side` is the chosen side, or null
 * for "not a prerequisite". A saved type the tracker no longer lists keeps
 * its row (onTracker false) and its choice until the user clears it.
 */
export interface PrerequisiteRow {
  type: string;
  onTracker: boolean;
  inward: string;
  outward: string;
  /** Why this type can't be chosen, or null. */
  problem: string | null;
  side: PrerequisiteSide | null;
}

/** The picker's rows: the tracker's types in its order, then saved types it does not list. */
export function prerequisiteRows(types: readonly TrackerLinkType[], chosen: readonly PrerequisiteLinkType[]): PrerequisiteRow[] {
  const sideOf = new Map(chosen.map((c) => [c.type, c.side]));
  const listed = new Set(types.map((t) => t.name));
  const rows: PrerequisiteRow[] = types.map((t) => {
    const problem = prerequisiteChoiceProblem(t);
    return { type: t.name, onTracker: true, inward: t.inward, outward: t.outward, problem, side: problem ? null : sideOf.get(t.name) ?? null };
  });
  for (const c of chosen) {
    if (!listed.has(c.type)) rows.push({ type: c.type, onTracker: false, inward: c.type, outward: c.type, problem: null, side: c.side });
  }
  return rows;
}

/** The entries the picker's rows save, in row order. */
export function entriesFromRows(rows: readonly PrerequisiteRow[]): PrerequisiteLinkType[] {
  return rows.flatMap((r) => (r.side && !r.problem ? [{ type: r.type, side: r.side }] : []));
}

/**
 * A one-line summary of the workspace's prerequisite link types, worded from
 * the tracker's types when known: `Default: Depend (“depends on”)`.
 */
export function describePrerequisiteLinkTypes(
  doc: Pick<WorkspaceDocument, 'backend' | 'prerequisiteLinkTypes'>,
  types: readonly TrackerLinkType[] = [],
): string {
  const entries = prerequisiteLinkTypesOf(doc);
  const byName = new Map(types.map((t) => [t.name, t]));
  const list = entries
    .map((e) => {
      const t = byName.get(e.type);
      return t ? `${e.type} (“${sideWording(t, e.side)}”)` : `${e.type} (${e.side} side)`;
    })
    .join(', ');
  if (usesDefaultPrerequisiteLinkTypes(doc)) return `Default: ${list}`;
  return entries.length ? list : 'None: no link makes a ticket a prerequisite';
}
