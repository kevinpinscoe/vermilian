// The workspace's Default assignee (VERM-68): with one set, All tasks opens
// showing only that person's issues until the user asks to see everyone.
//
// Pure TypeScript: unit-tested without React.

import type { BoardIssue } from '../../../shared/workspace';
import { ASSIGNEE_ME, type FilterState } from './grouping';

export type DefaultAssigneeMode =
  | 'off' // no default assignee is set
  | 'mine' // showing only the default assignee's issues
  | 'all' // the user asked to see everyone
  | 'unmatched'; // no loaded issue carries the saved identity, so everyone is shown

export interface DefaultAssigneeView {
  mode: DefaultAssigneeMode;
  value: string; // the Assignee filter value: the Me token when it is the current user
}

export function defaultAssigneeView(
  defaultAssignee: string,
  showAll: boolean,
  issues: readonly BoardIssue[],
  myId: string,
): DefaultAssigneeView {
  const saved = defaultAssignee.trim();
  if (!saved) return { mode: 'off', value: '' };
  const value = saved === myId ? ASSIGNEE_ME : saved;
  if (showAll) return { mode: 'all', value };
  // A stale identity must not leave an empty board with no explanation.
  if (issues.length > 0 && !issues.some((i) => i.fields.assignee === saved)) return { mode: 'unmatched', value };
  return { mode: 'mine', value };
}

/** The filter the board applies: the user's own, narrowed while showing only the default assignee. */
export function defaultAssigneeFilter(filter: FilterState, view: DefaultAssigneeView): FilterState {
  return view.mode === 'mine' ? { ...filter, assignee: [view.value] } : filter;
}

/** The saved map with one workspace's value set, or removed when blank. */
export function withDefaultAssignee(
  saved: Readonly<Record<string, string>>,
  workspaceId: string,
  value: string,
): Record<string, string> {
  const next = { ...saved };
  const trimmed = value.trim();
  if (trimmed) next[workspaceId] = trimmed;
  else delete next[workspaceId];
  return next;
}
