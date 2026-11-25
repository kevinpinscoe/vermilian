// Correcting the Markdown import preview's grouping (VERM-103): pure rules,
// unit-tested. The view is RunwayMarkdownImport.tsx; the first proposal and
// the row builder are importPreview.ts.
//
// Corrections are kept in memory as an ordered list, replayed over the
// groups as first proposed. Undo drops the last one; Reset drops them all,
// restoring the grouping, mappings and unticked References as first opened.
// Nothing is written: Apply is VERM-104.
//
//   rename      a proposed new workspace only; an existing workspace's name is
//               read-only. A collision is only reported (nameCollisions); Map
//               to workspace or Merge into is the user's explicit choice.
//   map         to an existing workspace (checked on its own connection) or
//               back to New workspace (the active workspace's connection by
//               default). The unnamed group has no New workspace.
//   connection  Check tickets using, for a new or ambiguous workspace.
//   merge       the source's rows go to the end of the target, its heading
//               kept as a section at the join; the target keeps its workspace
//               and connection. Preview order decides which occurrence of a
//               ticket is numbered; every row keeps its file line.
//   split       a top-level `###` (not a merge join) becomes a new proposed
//               workspace right after its group, named after the section, with
//               its rows and References; deeper headings move up one level. It
//               keeps the group's checking connection, or waits if it waited.
//   skip        collapses the group, keeping its edits for Include again.
//   tick        schedules a matched Reference at its source position; an
//               untick reverses it (buildWorkingPreview applies the rules).
//
// The session checks only what a correction affected: each group's lookup is
// keyed by its connection and the exact candidates sent, so rename, skip and
// ticking send nothing, and a merge, split, mapping or connection change
// rechecks the groups whose key changed. A skipped group's lookup in flight is
// dropped, so it cannot fill the group with a stale answer later.

import type { ParsedSchedule } from '../../../shared/runwaySchedule';
import type { RunwayImportMatchArgs, RunwayImportMatchResult } from '../../../shared/runwayImport';
import {
  buildWorkingPreview,
  proposeGroups,
  segmentCandidates,
  segmentOf,
  type GroupCheck,
  type GroupPreview,
  type ImportWorkspaceList,
  type ImportWorkspaceOption,
  type ProposedTarget,
  type Segment,
} from './importPreview';

export const MAX_GROUP_NAME = 200;

export interface WorkingGroup {
  groupKey: string;
  /** The proposed name: the `##` heading, a split section, or a rename. Null for the unnamed group. */
  name: string | null;
  /** The file line of the heading the group started from. */
  line: number;
  target: ProposedTarget;
  chooseConnection: boolean;
  connectionId: string | null;
  skipped: boolean;
  segments: Segment[];
  /** IDs of ticked References. */
  ticked: string[];
}

export type Correction =
  | { op: 'rename'; groupKey: string; name: string }
  | { op: 'map'; groupKey: string; workspaceId: string | null }
  | { op: 'connection'; groupKey: string; workspaceId: string }
  | { op: 'merge'; source: string; target: string }
  | { op: 'split'; groupKey: string; segment: number; line: number }
  | { op: 'skip'; groupKey: string; skipped: boolean }
  | { op: 'tick'; groupKey: string; refId: string; ticked: boolean };

export interface CorrectionContext {
  workspaces: readonly ImportWorkspaceOption[];
  activeId: string;
}

const fold = (name: string) => name.trim().toLowerCase();

/** The groups as first proposed, one segment each. */
export function workingGroups(parsed: ParsedSchedule, ctx: CorrectionContext): WorkingGroup[] {
  return proposeGroups(parsed, ctx.workspaces, ctx.activeId).map((p) => ({
    groupKey: p.groupKey,
    name: p.name,
    line: p.line,
    target: p.target,
    chooseConnection: p.chooseConnection,
    connectionId: p.connectionId,
    skipped: false,
    segments: [segmentOf(p.group, p.groupKey)],
    ticked: [],
  }));
}

/** The name shown for a group: an existing workspace's own name, or the proposed one. */
export function displayName(g: WorkingGroup): string {
  if (g.target.kind === 'existing' || g.target.kind === 'active') return g.target.workspaceName.trim();
  return g.name?.trim() ?? 'Before the first heading';
}

/** Why a proposed name is refused; null when it is acceptable. */
export function nameProblem(name: string): string | null {
  const t = name.trim();
  if (t === '') return 'A workspace needs a name.';
  if (t.length > MAX_GROUP_NAME) return `A workspace name can be at most ${MAX_GROUP_NAME} characters.`;
  return null;
}

/** For a proposed new workspace: the existing workspaces and other groups with the same name. */
export function nameCollisions(g: WorkingGroup, groups: readonly WorkingGroup[], workspaces: readonly ImportWorkspaceOption[]) {
  if (g.target.kind !== 'new' || g.name === null) return { workspaces: [], groups: [] };
  const wanted = fold(g.name);
  return {
    workspaces: workspaces.filter((w) => fold(w.name) === wanted),
    groups: groups.filter((o) => o.groupKey !== g.groupKey && !o.skipped && fold(displayName(o)) === wanted),
  };
}

/** The group's matcher candidates, in preview order. */
export function groupCandidates(g: WorkingGroup) {
  return segmentCandidates(g.segments);
}

export function groupPreview(g: WorkingGroup, results: Parameters<typeof buildWorkingPreview>[1]): GroupPreview {
  return buildWorkingPreview(g.segments, results, new Set(g.ticked));
}

/** One correction applied; null when it does not apply (nothing changes, nothing to undo). */
export function applyCorrection(groups: readonly WorkingGroup[], c: Correction, ctx: CorrectionContext): WorkingGroup[] | null {
  const at = (key: string) => groups.findIndex((g) => g.groupKey === key);
  const replace = (i: number, g: WorkingGroup) => groups.map((x, j) => (j === i ? g : x));
  const workspace = (id: string) => ctx.workspaces.find((w) => w.id === id);

  switch (c.op) {
    case 'rename': {
      const i = at(c.groupKey);
      const g = groups[i];
      if (!g || g.target.kind !== 'new' || nameProblem(c.name) !== null || g.name === c.name.trim()) return null;
      return replace(i, { ...g, name: c.name.trim() });
    }
    case 'map': {
      const i = at(c.groupKey);
      const g = groups[i];
      if (!g) return null;
      if (c.workspaceId === null) {
        if (g.name === null || g.target.kind === 'new') return null;
        const active = workspace(ctx.activeId);
        return replace(i, { ...g, target: { kind: 'new' }, chooseConnection: true, connectionId: active?.id ?? null });
      }
      const w = workspace(c.workspaceId);
      if (!w || (g.target.kind === 'existing' && g.target.workspaceId === w.id)) return null;
      return replace(i, { ...g, target: { kind: 'existing', workspaceId: w.id, workspaceName: w.name }, chooseConnection: false, connectionId: w.id });
    }
    case 'connection': {
      const i = at(c.groupKey);
      const g = groups[i];
      if (!g || !g.chooseConnection || !workspace(c.workspaceId) || g.connectionId === c.workspaceId) return null;
      return replace(i, { ...g, connectionId: c.workspaceId });
    }
    case 'merge': {
      const si = at(c.source);
      const ti = at(c.target);
      const source = groups[si];
      const target = groups[ti];
      if (!source || !target || si === ti || source.skipped || target.skipped) return null;
      const moved = source.segments.map((seg, k) =>
        k === 0 && source.name !== null ? { ...seg, join: { text: source.name, line: source.line } } : seg,
      );
      const merged: WorkingGroup = { ...target, segments: [...target.segments, ...moved], ticked: [...target.ticked, ...source.ticked] };
      return groups.flatMap((g, j) => (j === si ? [] : j === ti ? [merged] : [g]));
    }
    case 'split': {
      const i = at(c.groupKey);
      const g = groups[i];
      const seg = g?.segments[c.segment];
      if (!g || g.skipped || !seg) return null;
      const start = seg.rows.findIndex((r) => r.kind === 'section' && r.depth === 0 && r.line === c.line);
      if (start < 0) return null;
      const heading = seg.rows[start];
      if (heading.kind !== 'section') return null;
      let end = seg.rows.findIndex((r, k) => k > start && r.kind === 'section' && r.depth === 0);
      if (end < 0) end = seg.rows.length;
      const endLine = end < seg.rows.length ? seg.rows[end].line : Number.POSITIVE_INFINITY;
      const inside = (line: number) => line >= heading.line && line < endLine;
      const movedRows = seg.rows.slice(start + 1, end).map((r) => (r.kind === 'section' ? { ...r, depth: Math.max(0, r.depth - 1) } : r));
      const movedRefs = seg.references.filter((r) => inside(r.ref.line));
      const movedIds = new Set(movedRefs.map((r) => r.id));
      const parent: WorkingGroup = {
        ...g,
        segments: g.segments.map((s, k) =>
          k === c.segment
            ? { ...s, rows: [...s.rows.slice(0, start), ...s.rows.slice(end)], references: s.references.filter((r) => !movedIds.has(r.id)) }
            : s,
        ),
        ticked: g.ticked.filter((id) => !movedIds.has(id)),
      };
      const split: WorkingGroup = {
        groupKey: `${seg.origin}>${heading.line}`,
        name: heading.text,
        line: heading.line,
        target: { kind: 'new' },
        chooseConnection: true,
        // The parent's checking connection, or waiting if it waited.
        connectionId: g.connectionId,
        skipped: false,
        segments: [{ origin: seg.origin, join: null, rows: movedRows, references: movedRefs }],
        ticked: g.ticked.filter((id) => movedIds.has(id)),
      };
      return [...groups.slice(0, i), parent, split, ...groups.slice(i + 1)];
    }
    case 'skip': {
      const i = at(c.groupKey);
      const g = groups[i];
      if (!g || g.skipped === c.skipped) return null;
      return replace(i, { ...g, skipped: c.skipped });
    }
    case 'tick': {
      const i = at(c.groupKey);
      const g = groups[i];
      if (!g || g.skipped || !g.segments.some((s) => s.references.some((r) => r.id === c.refId))) return null;
      if (g.ticked.includes(c.refId) === c.ticked) return null;
      return replace(i, { ...g, ticked: c.ticked ? [...g.ticked, c.refId] : g.ticked.filter((id) => id !== c.refId) });
    }
  }
}

export function applyCorrections(base: readonly WorkingGroup[], corrections: readonly Correction[], ctx: CorrectionContext): WorkingGroup[] {
  let groups = [...base];
  for (const c of corrections) groups = applyCorrection(groups, c, ctx) ?? groups;
  return groups;
}

// ---------------------------------------------------------------------------
// The preview's session: the workspace list, the corrections and the checks.

type MatchFn = (args: RunwayImportMatchArgs) => Promise<RunwayImportMatchResult>;

export interface ImportSessionState {
  workspaces: ImportWorkspaceList;
  /** Null until the workspace list has been read. */
  groups: WorkingGroup[] | null;
  corrections: Correction[];
  /** Each group's selected connection; null waits for a choice. */
  connections: Record<string, string | null>;
  /** Each group's check for its current connection and candidates. */
  checks: Record<string, GroupCheck | undefined>;
}

export interface ImportSession {
  state(): ImportSessionState;
  /**
   * The workspace list as read. Headings are mapped, and groups checked, only
   * once a non-empty list has been read; the first one is kept.
   */
  setWorkspaces(list: ImportWorkspaceList): void;
  /** Applies a correction; false when it does not apply. */
  apply(c: Correction): boolean;
  /** Check tickets using: shorthand for a connection correction. */
  choose(groupKey: string, workspaceId: string): void;
  undo(): void;
  reset(): void;
  /** Checks the group again on its selected connection. */
  retry(groupKey: string): void;
  dispose(): void;
}

const EMPTY_LIST = 'No workspaces were found.';

/** What a group's lookup depends on: its connection and the candidates sent. */
function lookupKey(g: WorkingGroup): string | null {
  if (g.connectionId === null) return null;
  return JSON.stringify([g.connectionId, groupCandidates(g).candidates.map((c) => [c.text, c.line, c.role, c.reason])]);
}

export function createImportSession(parsed: ParsedSchedule, activeId: string, match: MatchFn, onChange: (state: ImportSessionState) => void): ImportSession {
  let workspaces: ImportWorkspaceList = { state: 'loading' };
  let ctx: CorrectionContext = { workspaces: [], activeId };
  let base: WorkingGroup[] | null = null;
  let corrections: Correction[] = [];
  let groups: WorkingGroup[] | null = null;
  const results = new Map<string, GroupCheck>();
  // The lookup each group has in flight, so a skip can drop it.
  const inFlight = new Map<string, { token: number; key: string }>();
  let seq = 0;
  let disposed = false;
  let state: ImportSessionState = { workspaces, groups: null, corrections: [], connections: {}, checks: {} };

  const publish = () => {
    state = {
      workspaces,
      groups,
      corrections: [...corrections],
      connections: Object.fromEntries((groups ?? []).map((g) => [g.groupKey, g.connectionId])),
      checks: Object.fromEntries(
        (groups ?? []).map((g) => {
          const key = lookupKey(g);
          return [g.groupKey, key === null ? undefined : results.get(key)];
        }),
      ),
    };
    if (!disposed) onChange(state);
  };

  const request = (g: WorkingGroup, key: string) => {
    const connectionId = g.connectionId as string;
    const { candidates } = groupCandidates(g);
    if (candidates.length === 0) {
      results.set(key, { state: 'done', connectionId, match: { groupKey: g.groupKey, workspaceId: connectionId, ok: true, candidates: [] } });
      return;
    }
    const token = ++seq;
    inFlight.set(g.groupKey, { token, key });
    results.set(key, { state: 'pending', connectionId });
    const live = () => !disposed && inFlight.get(g.groupKey)?.token === token;
    const settle = (check: GroupCheck) => {
      if (!live()) return;
      inFlight.delete(g.groupKey);
      results.set(key, check);
      publish();
    };
    match({ groups: [{ groupKey: g.groupKey, workspaceId: connectionId, candidates }] }).then(
      (result) => {
        if (!result.ok) settle({ state: 'failed', connectionId, error: result.error, retryable: result.code === 'workspace-unavailable' });
        else if (!result.groups[0]) settle({ state: 'failed', connectionId, error: 'The tickets could not be checked.', retryable: true });
        else settle({ state: 'done', connectionId, match: result.groups[0] });
      },
      (err: unknown) => {
        const message = (err as { message?: unknown } | null)?.message;
        settle({ state: 'failed', connectionId, error: typeof message === 'string' && message ? message : 'The tickets could not be checked.', retryable: true });
      },
    );
  };

  /** Checks every included group whose lookup key has no answer yet; drops a skipped group's lookup. */
  const sync = () => {
    for (const g of groups ?? []) {
      const flying = inFlight.get(g.groupKey);
      if (g.skipped) {
        if (flying) {
          inFlight.delete(g.groupKey);
          if (results.get(flying.key)?.state === 'pending') results.delete(flying.key);
        }
        continue;
      }
      const key = lookupKey(g);
      if (key === null) continue;
      // A lookup in flight for this group's old key is superseded: its answer is dropped.
      if (flying && flying.key !== key) {
        inFlight.delete(g.groupKey);
        if (results.get(flying.key)?.state === 'pending') results.delete(flying.key);
      }
      if (!results.has(key)) request(g, key);
    }
  };

  const recompute = () => {
    groups = base ? applyCorrections(base, corrections, ctx) : null;
    sync();
    publish();
  };

  function apply(c: Correction): boolean {
    if (disposed || !groups) return false;
    if (!applyCorrection(groups, c, ctx)) return false;
    corrections = [...corrections, c];
    recompute();
    return true;
  }

  return {
    state: () => state,
    setWorkspaces(list) {
      if (disposed || workspaces.state === 'ready') return;
      if (list.state === 'ready' && list.workspaces.length === 0) list = { state: 'failed', error: EMPTY_LIST };
      workspaces = list;
      if (list.state === 'ready') {
        ctx = { workspaces: list.workspaces, activeId };
        base = workingGroups(parsed, ctx);
      }
      recompute();
    },
    apply,
    choose(groupKey, workspaceId) {
      apply({ op: 'connection', groupKey, workspaceId });
    },
    undo() {
      if (disposed || corrections.length === 0) return;
      corrections = corrections.slice(0, -1);
      recompute();
    },
    reset() {
      if (disposed || corrections.length === 0) return;
      corrections = [];
      recompute();
    },
    retry(groupKey) {
      const g = groups?.find((x) => x.groupKey === groupKey);
      const key = g ? lookupKey(g) : null;
      if (disposed || !g || g.skipped || key === null) return;
      results.delete(key);
      request(g, key);
      publish();
    },
    dispose() {
      disposed = true;
      inFlight.clear();
    },
  };
}
