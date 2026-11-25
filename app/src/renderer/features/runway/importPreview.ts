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
// been read (createImportSession): a heading naming an existing workspace
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

import { parseRunwaySchedule, type ParsedSchedule, type ScheduleCheckbox, type ScheduleGroup, type ScheduleNoteSource, type ScheduleReferenceCue, type ScheduleReferenceReason } from '../../../shared/runwaySchedule';
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

interface TicketText {
  /** The ticket as written: its key or link. */
  text: string;
  titleHint: string | null;
  checkbox: ScheduleCheckbox | null;
  line: number;
}

export type PreviewRow =
  | (TicketText & { kind: 'ticket'; number: number; key: string; summary: string })
  /** Matching has not answered for this group, or its connection failed. */
  | (TicketText & { kind: 'unchecked' })
  /** Becomes a note: this occurrence's own result was unmatched. */
  | (TicketText & { kind: 'unmatched'; code: RunwayImportUnmatchedCode; message: string })
  /** Stays a note in place; listed under References too. */
  | (TicketText & { kind: 'duplicate'; ofNumber: number | null })
  | { kind: 'section'; text: string; depth: number; line: number }
  | { kind: 'note'; text: string; depth: number; source: ScheduleNoteSource; line: number };

export type PreviewReference = {
  text: string;
  line: number;
  reason: ScheduleReferenceReason;
  cue: ScheduleReferenceCue | null;
} & (
  | { status: 'unchecked' }
  | { status: 'matched'; key: string; summary: string }
  | { status: 'unmatched'; code: RunwayImportUnmatchedCode; message: string }
  | { status: 'duplicate'; key: string; ofNumber: number | null }
);

export interface GroupPreview {
  rows: PreviewRow[];
  references: PreviewReference[];
  /** How many tickets are numbered. */
  scheduledCount: number;
}

/** A parser-duplicate item's own checkbox and title hint, read from its first line. */
function itemTicketText(noteText: string, written: string, line: number): TicketText {
  const first = noteText.split('\n')[0];
  const row = parseRunwaySchedule(first).groups[0]?.rows[0];
  if (row?.kind === 'ticket') return { text: written, titleHint: row.titleHint, checkbox: row.checkbox, line };
  return { text: written, titleHint: null, checkbox: null, line };
}

/**
 * One group's outline and References. `results` is VERM-101's answer for the
 * group's candidates, in the order they were sent; null while it is pending
 * or when the group's connection failed.
 */
export function buildGroupPreview(group: ScheduleGroup, candidates: readonly RunwayImportCandidate[], results: readonly RunwayImportCandidateMatch[] | null): GroupPreview {
  const usable = results && results.length === candidates.length ? results : null;
  // A line leads with at most one scheduled ticket.
  const scheduledAt = new Map<number, number>();
  candidates.forEach((c, i) => {
    if (c.role === 'scheduled' && !scheduledAt.has(c.line)) scheduledAt.set(c.line, i);
  });
  const parserDuplicateLines = new Set(group.references.filter((r) => r.reason === 'duplicate').map((r) => r.line));

  const numberAt = new Map<number, number>();
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
        numberAt.set(ticket.line, n);
        rows.push({ ...ticket, kind: 'ticket', number: n, key: r.ticket.key, summary: r.ticket.summary });
        return;
      case 'duplicate':
        rows.push({ ...ticket, kind: 'duplicate', ofNumber: numberAt.get(r.duplicateOfLine) ?? null });
        duplicates.push({ index, ticket });
        return;
      case 'unmatched':
        rows.push({ ...ticket, kind: 'unmatched', code: r.code, message: r.message });
        return;
    }
  };

  for (const row of group.rows) {
    if (row.kind === 'ticket') {
      const ticket: TicketText = { text: row.ticket.url ?? row.ticket.key, titleHint: row.titleHint, checkbox: row.checkbox, line: row.line };
      const index = scheduledAt.get(row.line);
      if (index === undefined) rows.push({ ...ticket, kind: 'unchecked' });
      else place(index, ticket, { ...ticket, kind: 'unchecked' });
    } else if (row.kind === 'note' && row.source === 'item' && parserDuplicateLines.has(row.line) && scheduledAt.has(row.line)) {
      // The parser set this item aside as a duplicate; the matcher decides.
      const index = scheduledAt.get(row.line) as number;
      place(index, itemTicketText(row.text, candidates[index].text, row.line), row);
    } else {
      rows.push(row);
    }
  }

  // References: the parser's, read-only, with their cue; then confirmed duplicates.
  const cues = new Map<number, (typeof group.references)[number][]>();
  for (const r of group.references) {
    if (r.reason === 'duplicate') continue;
    cues.set(r.line, [...(cues.get(r.line) ?? []), r]);
  }
  const references: PreviewReference[] = [];
  candidates.forEach((c, i) => {
    if (c.role !== 'reference') return;
    const parsed = cues.get(c.line)?.shift();
    const base = { text: c.text, line: c.line, reason: (c.reason ?? parsed?.reason ?? 'prose') as ScheduleReferenceReason, cue: parsed?.cue ?? null };
    const r = usable?.[i];
    if (!r) references.push({ ...base, status: 'unchecked' });
    else if (r.status === 'unmatched') references.push({ ...base, status: 'unmatched', code: r.code, message: r.message });
    else references.push({ ...base, status: 'matched', key: r.ticket.key, summary: r.ticket.summary });
  });
  for (const { index, ticket } of duplicates) {
    const r = usable?.[index];
    if (r?.status !== 'duplicate') continue;
    references.push({
      text: ticket.text,
      line: ticket.line,
      reason: 'duplicate',
      cue: null,
      status: 'duplicate',
      key: r.ticket.key,
      ofNumber: numberAt.get(r.duplicateOfLine) ?? null,
    });
  }
  references.sort((a, b) => a.line - b.line);

  return { rows, references, scheduledCount: n };
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
// One preview's session: the workspace list, the mapping and the checks.

export type ImportWorkspaceList =
  | { state: 'loading' }
  | { state: 'failed'; error: string }
  | { state: 'ready'; workspaces: readonly ImportWorkspaceOption[] };

export interface ImportSessionState {
  workspaces: ImportWorkspaceList;
  /** Null until the workspace list has been read. */
  groups: ProposedGroup[] | null;
  /** Each group's selected connection; null waits for a choice. */
  connections: Record<string, string | null>;
  checks: Record<string, GroupCheck>;
}

export interface ImportSession {
  state(): ImportSessionState;
  /**
   * The workspace list as read. Headings are mapped, and groups checked, only
   * once a list has been read; the first one read is kept, so a later
   * refetch neither remaps nor rechecks.
   */
  setWorkspaces(list: ImportWorkspaceList): void;
  /** Checks the group on the chosen workspace's connection. */
  choose(groupKey: string, workspaceId: string): void;
  /** Checks the group again on its selected connection. */
  retry(groupKey: string): void;
  dispose(): void;
}

export function createImportSession(parsed: ParsedSchedule, activeId: string, match: MatchFn, onChange: (state: ImportSessionState) => void): ImportSession {
  let state: ImportSessionState = { workspaces: { state: 'loading' }, groups: null, connections: {}, checks: {} };
  let disposed = false;
  const set = (next: ImportSessionState) => {
    state = next;
    if (!disposed) onChange(state);
  };
  const checker = createGroupChecker(match, (groupKey, check) => set({ ...state, checks: { ...state.checks, [groupKey]: check } }));
  const groupOf = (key: string) => state.groups?.find((g) => g.groupKey === key);

  return {
    state: () => state,
    setWorkspaces(list) {
      if (disposed || state.workspaces.state === 'ready') return;
      if (list.state !== 'ready') {
        set({ ...state, workspaces: list });
        return;
      }
      const groups = proposeGroups(parsed, list.workspaces, activeId);
      set({ ...state, workspaces: list, groups, connections: Object.fromEntries(groups.map((g) => [g.groupKey, g.connectionId])) });
      for (const g of groups) if (g.connectionId !== null) checker.check(g, g.connectionId);
    },
    choose(groupKey, workspaceId) {
      const g = groupOf(groupKey);
      if (disposed || !g || !g.chooseConnection) return;
      set({ ...state, connections: { ...state.connections, [groupKey]: workspaceId } });
      checker.check(g, workspaceId);
    },
    retry(groupKey) {
      const g = groupOf(groupKey);
      const conn = state.connections[groupKey];
      if (disposed || !g || !conn) return;
      checker.check(g, conn);
    },
    dispose() {
      disposed = true;
      checker.dispose();
    },
  };
}
