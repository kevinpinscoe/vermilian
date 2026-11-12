// Provider-neutral Runway metadata (Priority Desk Focus, Focus rank, Why now).
//
// ADR-0011 §6: the desk behaves the same whichever provider a workspace uses.
// YouTrack issues keep this metadata in their Focus / Focus rank / Why now
// custom fields (ADR-0007, unchanged); Jira issues keep it in the local
// SQLite database (main/services/runwayDb.ts). This module holds the shared
// types and the pure rules both stores apply. No Electron, no React.

import type { NamespacedIssueId } from './tracker';

export type RunwayRank = 1 | 2 | 3;

export interface RunwayMetadata {
  focus: boolean;
  focusRank: RunwayRank | null;
  whyNow: string | null;
}

export interface RunwayEntry extends RunwayMetadata {
  issueId: NamespacedIssueId;
}

/** A partial change. An omitted key leaves that value as it is. */
export interface RunwayPatch {
  focus?: boolean;
  focusRank?: RunwayRank | null;
  whyNow?: string | null;
}

export const EMPTY_RUNWAY_METADATA: Readonly<RunwayMetadata> = Object.freeze({
  focus: false,
  focusRank: null,
  whyNow: null,
});

export function isRunwayRank(v: unknown): v is RunwayRank {
  return v === 1 || v === 2 || v === 3;
}

export function isEmptyRunwayMetadata(m: RunwayMetadata): boolean {
  return !m.focus && m.focusRank === null && m.whyNow === null;
}

/**
 * Applies `patch` to `current` under the ADR-0007 rules:
 *   - setting a rank also sets Focus;
 *   - clearing Focus clears the rank but keeps Why now;
 *   - an empty Why now is stored as no Why now.
 * Throws on a rank outside 1–3 or a patch that clears Focus while setting a
 * rank. Rank uniqueness is the store's job, not this function's.
 */
export function applyRunwayPatch(current: RunwayMetadata, patch: RunwayPatch): RunwayMetadata {
  const next: RunwayMetadata = { ...current };

  if (patch.focusRank !== undefined && patch.focusRank !== null && !isRunwayRank(patch.focusRank)) {
    throw new Error(`Focus rank must be 1, 2 or 3, got ${JSON.stringify(patch.focusRank)}`);
  }
  if (patch.focus === false && isRunwayRank(patch.focusRank)) {
    throw new Error('A patch cannot clear Focus and set a Focus rank at once');
  }

  if (patch.focus === true) next.focus = true;
  if (patch.focus === false) {
    next.focus = false;
    next.focusRank = null;
  }
  if (patch.focusRank === null) next.focusRank = null;
  if (isRunwayRank(patch.focusRank)) {
    next.focus = true;
    next.focusRank = patch.focusRank;
  }
  if (patch.whyNow !== undefined) {
    next.whyNow = patch.whyNow === null || patch.whyNow === '' ? null : patch.whyNow;
  }
  return next;
}

/** One YouTrack custom-field write, in the shape `patchIssue` takes. */
export interface YouTrackFieldWrite {
  field: 'focus' | 'focusRank' | 'whyNow';
  value: string | number | null;
}

/**
 * The YouTrack field writes that take an issue from `current` to `next`, in a
 * safe order. Each write is a separate request, so if one fails part-way the
 * issue must never be left holding a rank without Focus (an invisible holder
 * of a rank slot): Focus is turned on before a rank is set, and a rank is
 * cleared before Focus is turned off. Same order as runToggleFocus in
 * renderer/features/project-board/focus.ts.
 */
export function planYouTrackWrites(current: RunwayMetadata, next: RunwayMetadata): YouTrackFieldWrite[] {
  const writes: YouTrackFieldWrite[] = [];
  if (next.focus && !current.focus) writes.push({ field: 'focus', value: 'Yes' });
  if (next.focusRank !== current.focusRank) {
    writes.push({ field: 'focusRank', value: next.focusRank });
  }
  if (!next.focus && current.focus) writes.push({ field: 'focus', value: null });
  if (next.whyNow !== current.whyNow) writes.push({ field: 'whyNow', value: next.whyNow });
  return writes;
}
