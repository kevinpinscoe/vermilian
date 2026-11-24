// The blocker state engine (VERM-97): whether a ticket is Done, Blocked,
// Ready or Unknown, which prerequisites block it — on this workspace's Runway
// or external — and which prerequisites are scheduled after it. Pure
// TypeScript — no Electron, no React — and a pure function of the ticket, its
// links, the workspace's prerequisite link types and the Runway order. It
// never writes anything and never reorders: the Runway order is Kevin's, and
// a conflict is only reported, with "Move prerequisite above" left to him.
//
// The rules (proposal §4.4, decision E and Kevin's VERM-97 decisions,
// 2026-11-23), in precedence order:
//
//   done     the ticket is resolved.
//   blocked  a prerequisite is known to be open, or the ticket's own status
//            is blocked — YouTrack's BLOCKED, or a Jira status mapped to
//            blocked — whether or not it has prerequisite links, and even
//            when every one of them is resolved. Known open blockers win
//            over unknown ones: Blocked lists the open blockers and, beside
//            them, any prerequisite whose state is unknown.
//   unknown  nothing open is known, but something can't be judged: the
//            ticket's links were not read (or the caller says they can't be
//            trusted — offline, stale), or a prerequisite's state was not
//            reported.
//   ready    links read, every prerequisite known and resolved.
//
// A prerequisite's resolved state is the link's (the tracker's answer when
// the link was read). When the link did not say and the prerequisite's own
// Runway row was read, that row's state is used — and a row with no
// resolution and no usable status role is unknown, never open. Runway rows
// are matched by entity ID or key, so a row whose read failed still counts. Its status name is the
// row's for a prerequisite on this Runway, else the one supplied with the
// link, else none; the name is display only and never decides a state.

import { prerequisitesOf, type IssueLink, type PrerequisiteLinkType } from './issueLink';
import type { BoardIssue } from './workspace';

export type BlockerState = 'done' | 'blocked' | 'ready' | 'unknown';

/** One ticket row on this workspace's Runway, as the engine needs it. */
export interface RunwayPlace {
  /** The tracker's own ID — the Runway row's itemId without its `yt:`/`jira:` prefix. */
  localId: string;
  /** Runway #: 1..T over ticket rows. */
  runwayNumber: number;
  /** The row's tracker read; null when it could not be read (missing, not readable). */
  issue: BoardIssue | null;
}

export interface BlockerContext {
  /** The workspace's prerequisite link types (workspacePrerequisites.ts prerequisiteLinkTypesOf). */
  prerequisiteTypes: readonly PrerequisiteLinkType[];
  /** This workspace's Runway ticket rows; [] when the ticket is not judged against a Runway. */
  runway: readonly RunwayPlace[];
}

export interface BlockerOptions {
  /**
   * Why the ticket's links can't be trusted even though it was read — the
   * tracker is offline, the read is stale. The ticket is then judged as if
   * its links were not read (its own status still counts).
   */
  linksUnavailable?: string;
}

/** A prerequisite, as shown beside a dependent. */
export interface Prerequisite {
  key: string;
  summary: string;
  /** Its Runway # here; null when it is not on this Runway (external). */
  runwayNumber: number | null;
  /** Its status name for display; null when none is known. */
  status: string | null;
}

/** A prerequisite scheduled after its dependent on this Runway. */
export interface OrderConflict {
  key: string;
  /** The prerequisite's Runway #, after the dependent's. */
  prerequisiteNumber: number;
  /** The dependent's own Runway #. */
  dependentNumber: number;
  /**
   * true when both tickets are known to be open: an order conflict.
   * false when either one's state is unknown: shown as uncertainty, not a
   * conflict (Kevin, VERM-97 review).
   */
  certain: boolean;
}

/** Why a ticket is blocked by its own status, when it is. */
export type StatusBlock =
  /** No prerequisite links (decision E). */
  | 'no-link'
  /** Every linked prerequisite is resolved (Kevin's clarification of decision E). */
  | 'links-resolved'
  /** Some prerequisites, or the links themselves, can't be judged; none is known open. */
  | 'links-unknown'
  /** Known open prerequisites block it as well. */
  | 'with-blockers';

export interface BlockerReport {
  state: BlockerState;
  /** Prerequisites known to be open, in link order. */
  blockers: Prerequisite[];
  /** Prerequisites whose resolved state is unknown, in link order. */
  unknownPrerequisites: Prerequisite[];
  /** Set when the ticket's own status says blocked (and it is not done). */
  statusBlock: StatusBlock | null;
  /** Why the links couldn't be read or trusted; null when they were. */
  linksUnreadable: string | null;
  /** Prerequisites scheduled after this ticket on this Runway, open or unknown. */
  orderConflicts: OrderConflict[];
}

/** The reason shown when a ticket's links were not read at all. */
export const LINKS_NOT_READ = 'Links were not read';

/** Whether a board issue is resolved: a resolved time, or a status meaning done. */
export function isIssueDone(issue: BoardIssue): boolean {
  return issue.resolved !== null || issue.statusRole === 'done';
}

/**
 * A board issue's resolution as three states: true when resolved, false when
 * known to be open, null when unknown. A YouTrack issue (no statusRole) with
 * no resolved time is open. A Jira issue whose status has no usable role
 * (statusRole null) and no resolution time is unknown — never assumed open
 * (Kevin, VERM-97 review).
 */
export function issueResolution(issue: BoardIssue): boolean | null {
  if (isIssueDone(issue)) return true;
  return issue.statusRole === null ? null : false;
}

/**
 * Whether the ticket's own status says it is blocked: a Jira status mapped to
 * blocked (statusRole), or — for YouTrack, which carries no statusRole and
 * whose shared status vocabulary is read by name — the BLOCKED status.
 */
export function isStatusBlocked(issue: BoardIssue): boolean {
  if (issue.statusRole !== undefined) return issue.statusRole === 'blocked';
  return issue.fields.status === 'BLOCKED';
}

/**
 * The Runway row for a ticket, by entity ID or by key: a row's localId may be
 * either (a Jira row can be saved under its key), and a row whose tracker
 * read failed has no issue to compare, so its localId is matched against
 * both (Kevin, VERM-97 review).
 */
function placeFor(id: string | null, key: string, runway: readonly RunwayPlace[]): RunwayPlace | null {
  return (
    runway.find((p) => (id !== null && p.localId === id) || p.localId === key) ??
    runway.find((p) => p.issue !== null && (p.issue.idReadable === key || (id !== null && p.issue.id === id))) ??
    null
  );
}

function resolvedOf(link: IssueLink, place: RunwayPlace | null): boolean | null {
  if (link.issue.resolved !== null) return link.issue.resolved;
  return place?.issue ? issueResolution(place.issue) : null;
}

/**
 * The ticket's blocker state against this workspace's prerequisite link
 * types and Runway. A ticket that is itself on the Runway gets its order
 * conflicts; one that is not (All tasks) gets none.
 */
export function blockerStateOf(issue: BoardIssue, ctx: BlockerContext, options: BlockerOptions = {}): BlockerReport {
  const report: BlockerReport = {
    state: 'ready',
    blockers: [],
    unknownPrerequisites: [],
    statusBlock: null,
    linksUnreadable: null,
    orderConflicts: [],
  };
  if (isIssueDone(issue)) {
    report.state = 'done';
    return report;
  }

  const statusBlocked = isStatusBlocked(issue);
  const linksUnreadable = options.linksUnavailable ?? (issue.links === undefined ? LINKS_NOT_READ : null);
  report.linksUnreadable = linksUnreadable;

  // Only links that were read and can be trusted name prerequisites.
  const own = placeFor(issue.id, issue.idReadable, ctx.runway);
  // A definite order conflict needs both tickets known to be open.
  const ownOpen = issueResolution(issue) === false;
  const seen = new Set<string>([issue.idReadable]);
  const prerequisites = linksUnreadable === null ? prerequisitesOf(issue.links ?? [], ctx.prerequisiteTypes) : [];
  for (const link of prerequisites) {
    if (seen.has(link.issue.key)) continue;
    seen.add(link.issue.key);
    const place = placeFor(link.issue.id, link.issue.key, ctx.runway);
    const resolved = resolvedOf(link, place);
    if (resolved === true) continue;
    const entry: Prerequisite = {
      key: link.issue.key,
      summary: link.issue.summary,
      runwayNumber: place?.runwayNumber ?? null,
      status: place?.issue?.fields.status ?? link.issue.status ?? null,
    };
    (resolved === false ? report.blockers : report.unknownPrerequisites).push(entry);
    if (own && place && place.runwayNumber > own.runwayNumber) {
      report.orderConflicts.push({
        key: entry.key,
        prerequisiteNumber: place.runwayNumber,
        dependentNumber: own.runwayNumber,
        certain: resolved === false && ownOpen,
      });
    }
  }

  if (statusBlocked) {
    report.statusBlock =
      report.blockers.length > 0 ? 'with-blockers'
        : linksUnreadable !== null || report.unknownPrerequisites.length > 0 ? 'links-unknown'
          : seen.size === 1 ? 'no-link'
            : 'links-resolved';
  }

  if (report.blockers.length > 0 || statusBlocked) report.state = 'blocked';
  else if (linksUnreadable !== null || report.unknownPrerequisites.length > 0) report.state = 'unknown';
  else report.state = 'ready';
  return report;
}

// ---- Wording, for the Runway view and the All tasks badge (VERM-98) ----

/** "SYNC-3 (#2 here)", "PLAT-40 (external, In Progress)", "PLAT-40 (external)". */
export function describePrerequisite(p: Prerequisite): string {
  if (p.runwayNumber !== null) return `${p.key} (#${p.runwayNumber} here)`;
  return p.status ? `${p.key} (external, ${p.status})` : `${p.key} (external)`;
}

/** What a status block says, or null when there is none. */
export function describeStatusBlock(block: StatusBlock | null): string | null {
  switch (block) {
    case 'no-link': return 'Blocked by status, no linked prerequisite.';
    case 'links-resolved': return 'Blocked by status. All linked prerequisites are resolved.';
    case 'links-unknown': return 'Blocked by status.';
    case 'with-blockers': return 'Blocked by status.';
    default: return null;
  }
}

/** "Order conflict — SYNC-3 is #5, after this (#2)", or the uncertain form. */
export function describeOrderConflict(c: OrderConflict): string {
  return c.certain
    ? `Order conflict — ${c.key} is #${c.prerequisiteNumber}, after this (#${c.dependentNumber})`
    : `Possible order conflict — ${c.key} is #${c.prerequisiteNumber}, after this (#${c.dependentNumber}); not both known to be open`;
}

/** The one-line summary a row shows: "Ready", "Blocked by SYNC-3 (#2 here).", "Unknown: Links were not read". */
export function describeBlockerReport(r: BlockerReport): string {
  switch (r.state) {
    case 'done': return 'Done';
    case 'ready': return 'Ready';
    case 'unknown': {
      const parts: string[] = [];
      if (r.linksUnreadable) parts.push(r.linksUnreadable);
      if (r.unknownPrerequisites.length > 0) parts.push(`status unknown for ${r.unknownPrerequisites.map((p) => p.key).join(', ')}`);
      return `Unknown: ${parts.join('; ')}`;
    }
    case 'blocked': {
      // Sentences, each ending in a full stop, so the status wording reads
      // exactly as decided: "Blocked by status, no linked prerequisite."
      const parts: string[] = [];
      if (r.blockers.length > 0) parts.push(`Blocked by ${r.blockers.map(describePrerequisite).join(', ')}.`);
      const status = describeStatusBlock(r.statusBlock);
      if (status && r.statusBlock !== 'with-blockers') parts.push(status);
      if (r.unknownPrerequisites.length > 0) parts.push(`Status unknown for ${r.unknownPrerequisites.map(describePrerequisite).join(', ')}.`);
      if (r.linksUnreadable) parts.push(`Links unknown: ${r.linksUnreadable}.`);
      return parts.join(' ');
    }
  }
}
