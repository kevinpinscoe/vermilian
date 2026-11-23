// The YouTrack All tasks sort control (VERM-92). Pure TypeScript — no React,
// no Electron — so the rules run under vitest.
//
// One sort is active at a time:
//
//   - a Runway sort (Runway #, Tracker priority or Ticket ID, each ascending
//     or descending; shared/runwaySort.ts) — chosen from the toolbar control
//     or by clicking the Runway # or Priority column header. It lists every
//     visible ticket as one flat list, with no status sections, and it is
//     remembered for the workspace on this computer (AppConfig.allTasksSorts).
//   - a header sort (Task, Status, Category or Due date) — a temporary,
//     session-only sort inside the usual status sections, as before. It
//     leaves the remembered sort alone, and it shows over it until a Runway
//     sort is chosen or the sort is cleared.
//
// Clear sort returns to the usual status sections and removes only this
// workspace's remembered entry. Saving the remembered sort is the only write
// a sort change ever makes: sorting reads tickets and never writes a Runway
// position or a tracker field.

import type { BoardIssue } from '../../../shared/workspace';
import { PRIORITY_OPTIONS } from '../../../shared/workspace';
import type { BoardSortConfig, ColumnField } from '../../../shared/boardConfig';
import { sortByRunwaySort, type RunwaySort, type RunwaySortKey, type SortDirection } from '../../../shared/runwaySort';

/** What is on screen. */
export type ActiveAllTasksSort =
  | { kind: 'runway'; sort: RunwaySort }
  | { kind: 'header'; sort: BoardSortConfig }
  | null;

export interface AllTasksSortState {
  /** This workspace's remembered sort; null when it has none. */
  saved: RunwaySort | null;
  /** A temporary header sort, this session only; null when none. */
  temp: BoardSortConfig | null;
}

export type AllTasksSortAction =
  | { type: 'chooseKey'; key: RunwaySortKey }
  | { type: 'chooseDirection'; direction: SortDirection }
  | { type: 'header'; field: ColumnField | 'runwayNumber' }
  | { type: 'clear' };

export interface AllTasksSortResult {
  temp: BoardSortConfig | null;
  /**
   * The remembered sort to save: a sort, null to remove this workspace's
   * entry, or undefined to write nothing.
   */
  save: RunwaySort | null | undefined;
}

export const RUNWAY_SORT_LABELS: Record<RunwaySortKey, string> = {
  runwayNumber: 'Runway #',
  priority: 'Tracker priority',
  ticketId: 'Ticket ID',
};

/** The column headers that choose a Runway sort instead of a header sort. */
const HEADER_RUNWAY_KEYS: Partial<Record<ColumnField | 'runwayNumber', RunwaySortKey>> = {
  runwayNumber: 'runwayNumber',
  priority: 'priority',
};

export function activeAllTasksSort(state: AllTasksSortState): ActiveAllTasksSort {
  if (state.temp) return { kind: 'header', sort: state.temp };
  if (state.saved) return { kind: 'runway', sort: state.saved };
  return null;
}

function sameSort(a: RunwaySort | null, b: RunwaySort): boolean {
  return a !== null && a.key === b.key && a.direction === b.direction;
}

/** Saves `next` unless it is what is already on screen and remembered. */
function choose(state: AllTasksSortState, next: RunwaySort): AllTasksSortResult {
  return { temp: null, save: !state.temp && sameSort(state.saved, next) ? undefined : next };
}

export function allTasksSortAction(state: AllTasksSortState, action: AllTasksSortAction): AllTasksSortResult {
  const active = activeAllTasksSort(state);
  switch (action.type) {
    case 'chooseKey': {
      // The same key keeps its direction; a new key starts ascending.
      const direction = active?.kind === 'runway' && active.sort.key === action.key ? active.sort.direction : 'asc';
      return choose(state, { key: action.key, direction });
    }
    case 'chooseDirection': {
      if (active?.kind !== 'runway') return { temp: state.temp, save: undefined };
      return choose(state, { key: active.sort.key, direction: action.direction });
    }
    case 'header': {
      const key = HEADER_RUNWAY_KEYS[action.field];
      if (key) {
        // A second click on the active one reverses it.
        const direction =
          active?.kind === 'runway' && active.sort.key === key && active.sort.direction === 'asc' ? 'desc' : 'asc';
        return choose(state, { key, direction });
      }
      const field = action.field as ColumnField;
      const direction = active?.kind === 'header' && active.sort.field === field && active.sort.direction === 'asc' ? 'desc' : 'asc';
      return { temp: { field, direction }, save: undefined };
    }
    case 'clear':
      return { temp: null, save: state.saved ? null : undefined };
  }
}

/** The arrow a column header shows: its own sort's direction, else null. */
export function headerSortDirection(active: ActiveAllTasksSort, field: ColumnField | 'runwayNumber'): SortDirection | null {
  if (!active) return null;
  if (active.kind === 'runway') return HEADER_RUNWAY_KEYS[field] === active.sort.key ? active.sort.direction : null;
  return active.sort.field === field ? active.sort.direction : null;
}

/**
 * The visible tickets as one flat list in `sort`'s order. YouTrack has one
 * shared Priority bundle, so every ticket ranks by its order. `runwayNumberOf`
 * gives a ticket's Runway # on this workspace's Runway, null when it has none
 * or its position cannot be verified (both sort last). Returns a copy.
 */
export function sortAllTasksFlat(
  issues: readonly BoardIssue[],
  sort: RunwaySort,
  runwayNumberOf: (issue: BoardIssue) => number | null,
): BoardIssue[] {
  return sortByRunwaySort(issues, sort, (issue) => ({
    key: issue.idReadable,
    runwayNumber: runwayNumberOf(issue),
    priority: issue.fields.priority ?? null,
    priorityOrder: PRIORITY_OPTIONS,
  }));
}

/**
 * The key All tasks memoises its project issues on: each project's name, the
 * closed-issue mode and its data's time. Two projects' reads can finish in the
 * same millisecond, so keyed on the times alone, switching workspace kept the
 * previous workspace's issues on screen (found by VERM-92's restart test).
 */
export function projectIssuesKey(projectShortNames: readonly string[], showClosed: boolean, dataUpdatedAt: readonly number[]): string {
  return dataUpdatedAt.map((t, i) => `${projectShortNames[i] ?? ''}:${showClosed ? 'all' : 'open'}:${t}`).join(',');
}
