// The Markdown import preview (VERM-102): pure rules, unit-tested. The view
// is RunwayMarkdownImport.tsx.
//
// A parsed schedule (shared/runwaySchedule.ts) becomes one proposed
// workspace per `##` group:
//   - a heading whose name matches exactly one existing workspace, after
//     trimming and case-folding, maps to it and is checked on its own
//     connection;
//   - a heading that matches two or more is ambiguous, left for VERM-103 to
//     correct; its tickets are not checked until a workspace is chosen in
//     Check tickets using, so no third workspace's tracker sees them;
//   - any other heading proposes a new workspace, checked by default on the
//     active workspace's connection (Check tickets using);
//   - the unnamed group before the first `##` maps to the active workspace.
// With no active workspace in the list, the new and unnamed groups also wait
// for a choice. Nothing is mapped or checked until the workspace list has
// been read (createImportSession, importCorrections.ts): a heading naming an existing workspace
// must never be mistaken for a new one while the list is loading or failed.
//
// Each group's outline is built from the parser's rows in file order and
// VERM-101's result for each occurrence:
//   - only a matched scheduled ticket is numbered, #1..N;
//   - a scheduled ticket with its own unmatched result becomes a note, with
//     the reason;
//   - a confirmed duplicate stays a note in place and is listed under
//     References as Already scheduled as #N;
//   - a line the parser set aside as a duplicate that the matcher accepts
//     (the earlier link was refused) is numbered there, exactly once;
//   - before a result arrives, or when the group's connection failed, the
//     outline stays with its tickets unchecked and unnumbered.
// References are listed read-only and unticked, with their line, reason or
// cue, and match result. Nothing here writes anything.

import { parseRunwaySchedule, type ParsedSchedule, type ScheduleCheckbox, type ScheduleGroup, type ScheduleNoteSource, type ScheduleReference, type ScheduleReferenceCue, type ScheduleReferenceReason, type ScheduleRow } from '../../../shared/runwaySchedule';
import { scheduleCandidates, type RunwayImportCandidate, type RunwayImportCandidateMatch, type RunwayImportGroupMatch, type RunwayImportUnmatchedCode } from '../../../shared/runwayImport';

export interface ImportWorkspaceOption {
  id: string;
  name: string;
}

export type ProposedTarget =
  | { kind: 'existing'; workspaceId: string; workspaceName: string }
  | { kind: 'ambiguous'; workspaceIds: string[]; workspaceNames: string[] }
  | { kind: 'new' }
  | { kind: 'active'; workspaceId: string; workspaceName: string }
  /** The unnamed group when no active workspace is in the list. */
  | { kind: 'unassigned' };

export interface ProposedGroup {
  /** Stable within one preview: the group's index in the file. */
  groupKey: string;
  /** The `##` heading text; null for the unnamed group before the first `##`. */
  name: string | null;
  line: number;
  target: ProposedTarget;
  /** True when the user chooses the connection (a new or ambiguous workspace). */
  chooseConnection: boolean;
  /** The workspace whose connection checks the group's tickets at first; null waits for a choice. */
  connectionId: string | null;
  group: ScheduleGroup;
  candidates: RunwayImportCandidate[];
}

const fold = (name: string) => name.trim().toLowerCase();

/** One proposed workspace per group, mapped and given its connection. */
export function proposeGroups(parsed: ParsedSchedule, workspaces: readonly ImportWorkspaceOption[], activeId: string): ProposedGroup[] {
  // No fallback: an active ID missing from the list means no default connection.
  const active = workspaces.find((w) => w.id === activeId);
  const activeConn = active?.id ?? null;
  return parsed.groups.map((group, i): ProposedGroup => {
    const base = { groupKey: `g${i}`, name: group.name, line: group.line, group, candidates: scheduleCandidates(group) };
    if (group.name === null) {
      if (!active) return { ...base, target: { kind: 'unassigned' }, chooseConnection: true, connectionId: null };
      return { ...base, target: { kind: 'active', workspaceId: active.id, workspaceName: active.name }, chooseConnection: false, connectionId: active.id };
    }
    const wanted = fold(group.name);
    const matches = workspaces.filter((w) => fold(w.name) === wanted);
    if (matches.length === 1) {
      const [w] = matches;
      return { ...base, target: { kind: 'existing', workspaceId: w.id, workspaceName: w.name }, chooseConnection: false, connectionId: w.id };
    }
    if (matches.length > 1) {
      const target: ProposedTarget = { kind: 'ambiguous', workspaceIds: matches.map((w) => w.id), workspaceNames: matches.map((w) => w.name) };
      return { ...base, target, chooseConnection: true, connectionId: null };
    }
    return { ...base, target: { kind: 'new' }, chooseConnection: true, connectionId: activeConn };
  });
}

// ---------------------------------------------------------------------------
// Rows and References, from a group's segments in preview order.

interface TicketText {
  /** The ticket as written: its key or link. */
  text: string;
  titleHint: string | null;
  checkbox: ScheduleCheckbox | null;
  /** Its line in the Markdown file, whatever the preview order. */
  line: number;
}

export type PreviewRow =
  /** Numbered. `refId` is set when a ticked Reference was scheduled here (VERM-103). */
  | (TicketText & { kind: 'ticket'; number: number; key: string; summary: string; issueId: string; refId?: string })
  /** Matching has not answered for this group, or its connection failed. */
  | (TicketText & { kind: 'unchecked' })
  /** Becomes a note: this occurrence's own result was unmatched. */
  | (TicketText & { kind: 'unmatched'; code: RunwayImportUnmatchedCode; message: string })
  /** Stays a note in place; listed under References too. */
  | (TicketText & { kind: 'duplicate'; ofNumber: number | null })
  /**
   * A heading row. `segment` is its segment's index in the group; `join` marks
   * a merged group's heading kept at the join; only a top-level `###` from the
   * file can be split into its own workspace.
   */
  | { kind: 'section'; text: string; depth: number; line: number; segment: number; join: boolean; splittable: boolean }
  | { kind: 'note'; text: string; depth: number; source: ScheduleNoteSource; line: number };

export type PreviewReference = {
  /** The reference's identity within the preview (null for a listed duplicate). */
  id: string | null;
  text: string;
  line: number;
  reason: ScheduleReferenceReason;
  cue: ScheduleReferenceCue | null;
  /** Ticked to schedule it (VERM-103). */
  ticked: boolean;
  /** Whether its box can be changed: matched, and not already scheduled under another occurrence. */
  tickable: boolean;
  /** Its number when its tick is in effect. */
  scheduledAs: number | null;
  /** The number of the occurrence already scheduled for the same ticket. */
  alreadyAs: number | null;
} & (
  | { status: 'unchecked' }
  | { status: 'matched'; key: string; summary: string; issueId: string }
  | { status: 'unmatched'; code: RunwayImportUnmatchedCode; message: string }
  | { status: 'duplicate'; key: string; ofNumber: number | null }
);

export interface GroupPreview {
  rows: PreviewRow[];
  references: PreviewReference[];
  /** How many tickets are numbered. */
  scheduledCount: number;
}

/**
 * A run of one file group's rows inside a proposed workspace. A group starts
 * as one segment; a merge appends the source's segments (VERM-103), the first
 * one carrying the source's heading as `join`; a split takes rows out.
 */
export interface Segment {
  /** The file group it came from (its base groupKey). */
  origin: string;
  /** A merged group's `##` heading, kept as a section where it joins. */
  join: { text: string; line: number } | null;
  rows: ScheduleRow[];
  references: { id: string; ref: ScheduleReference }[];
}

export function segmentOf(group: ScheduleGroup, origin: string): Segment {
  return { origin, join: null, rows: group.rows, references: group.references.map((ref, i) => ({ id: `${origin}#${i}`, ref })) };
}

export interface CandidateMeta {
  segment: number;
  /** The candidate's line in the file. */
  line: number;
  refId: string | null;
}

/**
 * The matcher's candidates, in preview order: segment by segment, and within
 * a segment by line, scheduled before references. Each candidate's `line` is
 * its preview position (1..N), so the matcher's first-occurrence rule follows
 * the preview order after a merge; `meta` keeps the file line.
 */
export function segmentCandidates(segments: readonly Segment[]): { candidates: RunwayImportCandidate[]; meta: CandidateMeta[] } {
  const all: (RunwayImportCandidate & { meta: CandidateMeta })[] = [];
  segments.forEach((seg, si) => {
    const scheduled = seg.rows.flatMap((r): (RunwayImportCandidate & { meta: CandidateMeta })[] =>
      r.kind === 'ticket' ? [{ text: r.ticket.url ?? r.ticket.key, line: r.line, role: 'scheduled', reason: null, meta: { segment: si, line: r.line, refId: null } }] : [],
    );
    // A line the parser set aside as a duplicate was written as a scheduled item (VERM-101).
    const refs = seg.references.map(({ id, ref }): RunwayImportCandidate & { meta: CandidateMeta } => ({
      text: ref.ticket.url ?? ref.ticket.key,
      line: ref.line,
      role: ref.reason === 'duplicate' ? 'scheduled' : 'reference',
      reason: ref.reason === 'duplicate' ? null : ref.reason,
      meta: { segment: si, line: ref.line, refId: ref.reason === 'duplicate' ? null : id },
    }));
    all.push(...[...scheduled, ...refs].sort((a, b) => a.line - b.line));
  });
  return {
    candidates: all.map((c, i) => ({ text: c.text, line: i + 1, role: c.role, reason: c.reason })),
    meta: all.map((c) => c.meta),
  };
}

/** A parser-duplicate item's own checkbox and title hint, read from its first line. */
function itemTicketText(noteText: string, written: string, line: number): TicketText {
  const first = noteText.split('\n')[0];
  const row = parseRunwaySchedule(first).groups[0]?.rows[0];
  if (row?.kind === 'ticket') return { text: written, titleHint: row.titleHint, checkbox: row.checkbox, line };
  return { text: written, titleHint: null, checkbox: null, line };
}

/**
 * One proposed workspace's outline and References. `results` is VERM-101's
 * answer for segmentCandidates(segments), in that order; null while it is
 * pending or when the group's connection failed. `ticked` holds the ticked
 * References' IDs.
 *
 * A ticked Reference is numbered at its source position — after the row its
 * line belongs to, so after a scheduled ticket on the same line — only when
 * its own result matched and no scheduled occurrence, or earlier ticked one,
 * has the same ticket (the matcher's ticket identity, so another mention or a
 * moved Jira issue's old key cannot add a second copy).
 */
export function buildWorkingPreview(segments: readonly Segment[], results: readonly RunwayImportCandidateMatch[] | null, ticked: ReadonlySet<string>): GroupPreview {
  const { candidates, meta } = segmentCandidates(segments);
  const usable = results && results.length === candidates.length ? results : null;

  // Which ticks are in effect: scheduled tickets come first, then ticks in preview order.
  const scheduledIds = new Set<string>();
  candidates.forEach((c, i) => {
    const r = usable?.[i];
    if (c.role === 'scheduled' && r?.status === 'matched') scheduledIds.add(r.ticket.issueId);
  });
  const effective = new Set<string>();
  const tickedIds = new Set<string>();
  candidates.forEach((c, i) => {
    const r = usable?.[i];
    const id = meta[i].refId;
    if (c.role !== 'reference' || !id || !ticked.has(id) || r?.status !== 'matched') return;
    if (scheduledIds.has(r.ticket.issueId) || tickedIds.has(r.ticket.issueId)) return;
    effective.add(id);
    tickedIds.add(r.ticket.issueId);
  });

  const numberAtRank = new Map<number, number>();
  const numberOfIssue = new Map<string, number>();
  const duplicates: { index: number; ticket: TicketText }[] = [];
  const rows: PreviewRow[] = [];
  let n = 0;

  const place = (index: number, ticket: TicketText, fallback: PreviewRow) => {
    const r = usable?.[index];
    if (!r) {
      rows.push(fallback);
      return;
    }
    switch (r.status) {
      case 'matched':
        n += 1;
        numberAtRank.set(index + 1, n);
        if (!numberOfIssue.has(r.ticket.issueId)) numberOfIssue.set(r.ticket.issueId, n);
        rows.push({ ...ticket, kind: 'ticket', number: n, key: r.ticket.key, summary: r.ticket.summary, issueId: r.ticket.issueId });
        return;
      case 'duplicate':
        rows.push({ ...ticket, kind: 'duplicate', ofNumber: numberAtRank.get(r.duplicateOfLine) ?? null });
        duplicates.push({ index, ticket });
        return;
      case 'unmatched':
        rows.push({ ...ticket, kind: 'unmatched', code: r.code, message: r.message });
        return;
    }
  };

  const placeTicked = (index: number) => {
    const r = usable?.[index];
    if (r?.status !== 'matched') return;
    n += 1;
    numberAtRank.set(index + 1, n);
    numberOfIssue.set(r.ticket.issueId, n);
    rows.push({
      kind: 'ticket',
      number: n,
      key: r.ticket.key,
      summary: r.ticket.summary,
      issueId: r.ticket.issueId,
      text: candidates[index].text,
      titleHint: null,
      checkbox: null,
      line: meta[index].line,
      refId: meta[index].refId as string,
    });
  };

  segments.forEach((seg, si) => {
    const scheduledAt = new Map<number, number>();
    const tickedAt = new Map<number, number[]>(); // anchor row index → candidate indexes
    const parserDuplicateLines = new Set(seg.references.filter((r) => r.ref.reason === 'duplicate').map((r) => r.ref.line));
    candidates.forEach((c, i) => {
      if (meta[i].segment !== si) return;
      if (c.role === 'scheduled' && !scheduledAt.has(meta[i].line)) scheduledAt.set(meta[i].line, i);
      const id = meta[i].refId;
      if (c.role === 'reference' && id && effective.has(id)) {
        let anchor = -1;
        seg.rows.forEach((row, ri) => {
          if (row.line <= meta[i].line) anchor = ri;
        });
        tickedAt.set(anchor, [...(tickedAt.get(anchor) ?? []), i]);
      }
    });

    if (seg.join) rows.push({ kind: 'section', text: seg.join.text, depth: 0, line: seg.join.line, segment: si, join: true, splittable: false });
    for (const i of tickedAt.get(-1) ?? []) placeTicked(i);
    seg.rows.forEach((row, ri) => {
      if (row.kind === 'ticket') {
        const ticket: TicketText = { text: row.ticket.url ?? row.ticket.key, titleHint: row.titleHint, checkbox: row.checkbox, line: row.line };
        const index = scheduledAt.get(row.line);
        if (index === undefined) rows.push({ ...ticket, kind: 'unchecked' });
        else place(index, ticket, { ...ticket, kind: 'unchecked' });
      } else if (row.kind === 'note' && row.source === 'item' && parserDuplicateLines.has(row.line) && scheduledAt.has(row.line)) {
        // The parser set this item aside as a duplicate; the matcher decides.
        const index = scheduledAt.get(row.line) as number;
        place(index, itemTicketText(row.text, candidates[index].text, row.line), row);
      } else if (row.kind === 'section') {
        rows.push({ kind: 'section', text: row.text, depth: row.depth, line: row.line, segment: si, join: false, splittable: row.depth === 0 });
      } else {
        rows.push(row);
      }
      for (const i of tickedAt.get(ri) ?? []) placeTicked(i);
    });
  });

  // References, in preview order: the parser's, with their cue; then confirmed duplicates.
  const listed: { rank: number; ref: PreviewReference }[] = [];
  candidates.forEach((c, i) => {
    if (c.role !== 'reference') return;
    const id = meta[i].refId as string;
    const parsed = segments[meta[i].segment].references.find((r) => r.id === id)?.ref;
    const isTicked = ticked.has(id);
    const base = {
      id,
      text: c.text,
      line: meta[i].line,
      reason: (c.reason ?? parsed?.reason ?? 'prose') as ScheduleReferenceReason,
      cue: parsed?.cue ?? null,
      ticked: isTicked,
      scheduledAs: null,
      alreadyAs: null,
      // An existing tick can always be cleared, whatever its lookup says.
      tickable: isTicked,
    };
    const r = usable?.[i];
    if (!r) listed.push({ rank: i, ref: { ...base, status: 'unchecked' } });
    else if (r.status === 'unmatched') listed.push({ rank: i, ref: { ...base, status: 'unmatched', code: r.code, message: r.message } });
    else {
      const inEffect = effective.has(id);
      const already = inEffect ? null : (numberOfIssue.get(r.ticket.issueId) ?? null);
      listed.push({
        rank: i,
        ref: {
          ...base,
          status: 'matched',
          key: r.ticket.key,
          summary: r.ticket.summary,
          issueId: r.ticket.issueId,
          scheduledAs: inEffect ? (numberAtRank.get(i + 1) ?? null) : null,
          alreadyAs: already,
          // A tick can always be taken back; a new one only when nothing else schedules this ticket.
          tickable: inEffect || isTicked || already === null,
        },
      });
    }
  });
  for (const { index, ticket } of duplicates) {
    const r = usable?.[index];
    if (r?.status !== 'duplicate') continue;
    listed.push({
      rank: index,
      ref: {
        id: null,
        text: ticket.text,
        line: ticket.line,
        reason: 'duplicate',
        cue: null,
        ticked: false,
        tickable: false,
        scheduledAs: null,
        alreadyAs: numberAtRank.get(r.duplicateOfLine) ?? null,
        status: 'duplicate',
        key: r.ticket.key,
        ofNumber: numberAtRank.get(r.duplicateOfLine) ?? null,
      },
    });
  }
  listed.sort((a, b) => a.rank - b.rank);

  return { rows, references: listed.map((l) => l.ref), scheduledCount: n };
}

/**
 * One file group's outline and References, as first proposed (VERM-102).
 * `results` answers `candidates` (scheduleCandidates(group), file lines) in
 * that order; a duplicate's `duplicateOfLine` is a file line here.
 */
export function buildGroupPreview(group: ScheduleGroup, candidates: readonly RunwayImportCandidate[], results: readonly RunwayImportCandidateMatch[] | null): GroupPreview {
  const usable = results && results.length === candidates.length ? results : null;
  // Same order as segmentCandidates; translate file lines to preview positions.
  const rankOfLine = new Map<number, number>();
  candidates.forEach((c, i) => {
    if (c.role === 'scheduled' && !rankOfLine.has(c.line)) rankOfLine.set(c.line, i + 1);
  });
  const ranked = usable?.map((r) => (r.status === 'duplicate' ? { ...r, duplicateOfLine: rankOfLine.get(r.duplicateOfLine) ?? r.duplicateOfLine } : r)) ?? null;
  return buildWorkingPreview([segmentOf(group, 'g')], ranked, new Set());
}

// ---------------------------------------------------------------------------
// Checking a group on its connection, latest selection wins.

export type GroupCheck =
  | { state: 'pending'; connectionId: string }
  | { state: 'done'; connectionId: string; match: RunwayImportGroupMatch }
  | { state: 'failed'; connectionId: string; error: string; retryable: boolean };

export interface GroupChecker {
  /** Checks one group on `connectionId`; any earlier check of that group is superseded. */
  check(group: ProposedGroup, connectionId: string): void;
  /** Stops reporting; results that arrive afterwards are dropped. */
  dispose(): void;
}

type MatchFn = (args: import('../../../shared/runwayImport').RunwayImportMatchArgs) => Promise<import('../../../shared/runwayImport').RunwayImportMatchResult>;

/**
 * Runs each group's check and reports only the latest one per group: when a
 * slow first lookup returns after its replacement, its result is dropped, so
 * the preview keeps the result for the connection currently selected.
 */
export function createGroupChecker(match: MatchFn, report: (groupKey: string, check: GroupCheck) => void): GroupChecker {
  const latest = new Map<string, number>();
  let seq = 0;
  let disposed = false;
  return {
    check(group, connectionId) {
      const token = ++seq;
      latest.set(group.groupKey, token);
      const current = () => !disposed && latest.get(group.groupKey) === token;
      if (group.candidates.length === 0) {
        report(group.groupKey, { state: 'done', connectionId, match: { groupKey: group.groupKey, workspaceId: connectionId, ok: true, candidates: [] } });
        return;
      }
      report(group.groupKey, { state: 'pending', connectionId });
      match({ groups: [{ groupKey: group.groupKey, workspaceId: connectionId, candidates: group.candidates }] }).then(
        (result) => {
          if (!current()) return;
          if (!result.ok) {
            report(group.groupKey, { state: 'failed', connectionId, error: result.error, retryable: result.code === 'workspace-unavailable' });
            return;
          }
          const g = result.groups[0];
          if (!g) report(group.groupKey, { state: 'failed', connectionId, error: 'The tickets could not be checked.', retryable: true });
          else report(group.groupKey, { state: 'done', connectionId, match: g });
        },
        (err: unknown) => {
          if (!current()) return;
          const message = (err as { message?: unknown } | null)?.message;
          report(group.groupKey, { state: 'failed', connectionId, error: typeof message === 'string' && message ? message : 'The tickets could not be checked.', retryable: true });
        },
      );
    },
    dispose() {
      disposed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// The workspace list (the session is in importCorrections.ts).

export type ImportWorkspaceList =
  | { state: 'loading' }
  | { state: 'failed'; error: string }
  | { state: 'ready'; workspaces: readonly ImportWorkspaceOption[] };

// ---------------------------------------------------------------------------
// The workspace list as RunwayView reads it.

const EMPTY_LIST = 'No workspaces were found.';

/** The parts of the workspace-config query the preview depends on. */
export interface WorkspaceQueryState {
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isSuccess: boolean;
  data: import('../../../shared/workspace').VermilianConfig | null | undefined;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

/**
 * The preview's list from the workspace-config query. `openedAt` is when the
 * file was chosen; RunwayView reads the list again then. Only an answer from
 * that read or later counts: a read in flight is loading even when a cached
 * list exists, and so is a cached list from before. A missing configuration
 * or an empty list is a failed read, with Retry.
 */
export function workspaceListFromQuery(q: WorkspaceQueryState, openedAt: number): ImportWorkspaceList {
  if (q.isFetching) return { state: 'loading' };
  if (q.isError && q.errorUpdatedAt >= openedAt) {
    const message = (q.error as { message?: unknown } | null)?.message;
    return { state: 'failed', error: typeof message === 'string' && message ? message : 'The workspace configuration could not be read.' };
  }
  if (!q.isSuccess || q.dataUpdatedAt < openedAt) return { state: 'loading' };
  if (!q.data) return { state: 'failed', error: 'The workspace configuration could not be read.' };
  if (q.data.workspaces.length === 0) return { state: 'failed', error: EMPTY_LIST };
  return {
    state: 'ready',
    workspaces: q.data.workspaces
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((w) => ({ id: w.id, name: w.name })),
  };
}

/**
 * What Check tickets using shows for each workspace: its name, and for names
 * that collide (after trimming and case-folding) its position in the rail
 * and its ID, so two workspaces called Platform can be told apart.
 */
export function workspaceOptionLabels(workspaces: readonly ImportWorkspaceOption[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const w of workspaces) counts.set(fold(w.name), (counts.get(fold(w.name)) ?? 0) + 1);
  return new Map(
    workspaces.map((w, i) => [w.id, (counts.get(fold(w.name)) ?? 0) > 1 ? `${w.name.trim()} — rail position ${i + 1}, ID ${w.id}` : w.name.trim()]),
  );
}
