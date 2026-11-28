// Quitting with unsaved changes (VERM-123).
//
// The renderer reports what it holds that a quit would lose: editors with
// changes not yet submitted (`drafts`, by label) and saves still in flight
// (`saving`). The main process asks before quitting when either is non-empty,
// after the running-timer prompt and before the final flush of the debounced
// _vermilian-config write; a flush that fails also asks, instead of quitting.
//
// Pure TypeScript: no Electron, no React.

export interface UnsavedState {
  /** Labels of editors holding unsubmitted changes, e.g. "Settings". */
  drafts: string[];
  /** How many saves are still in flight. */
  saving: number;
}

export const EMPTY_UNSAVED_STATE: UnsavedState = { drafts: [], saving: 0 };

/**
 * What the prompt is about: quitting the app, or only closing its window
 * (macOS, where the app keeps running without a window). An answer to a
 * `window` prompt closes the window and never quits the app.
 */
export type QuitScope = 'quit' | 'window';

/** Why the main process is asking the renderer before quitting or closing. */
export type UnsavedQuitRequest =
  | { kind: 'unsaved'; scope: QuitScope; state: UnsavedState }
  | { kind: 'save-failed'; scope: QuitScope; message: string };

/** What the user chose; `save` flushes pending writes first, `discard` does not. */
export type QuitChoice = 'save' | 'discard';

const MAX_DRAFTS = 20;
const MAX_LABEL = 120;

/** The renderer's report, validated: it crosses the process boundary. */
export function normaliseUnsavedState(raw: unknown): UnsavedState {
  if (!raw || typeof raw !== 'object') return EMPTY_UNSAVED_STATE;
  const r = raw as { drafts?: unknown; saving?: unknown };
  if (!Array.isArray(r.drafts) || typeof r.saving !== 'number' || !Number.isFinite(r.saving) || r.saving < 0) {
    return EMPTY_UNSAVED_STATE;
  }
  const drafts = r.drafts
    .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
    .slice(0, MAX_DRAFTS)
    .map((d) => d.slice(0, MAX_LABEL));
  return { drafts, saving: Math.floor(r.saving) };
}

export function hasUnsaved(s: UnsavedState): boolean {
  return s.drafts.length > 0 || s.saving > 0;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** The prompt's sentence for `s`. */
export function unsavedQuitMessage(s: UnsavedState): string {
  const parts: string[] = [];
  if (s.drafts.length) parts.push(`You have unsaved changes in ${joinLabels(s.drafts)}.`);
  if (s.saving === 1) parts.push('A change is still being saved.');
  else if (s.saving > 1) parts.push(`${s.saving} changes are still being saved.`);
  return parts.join(' ');
}

/** What the quit pipeline (main/window.ts) does next. */
export type QuitStep = 'ask-timer' | 'ask-unsaved' | 'flush' | 'quit';

/**
 * The order is fixed: a running timer is asked about first (its own prompt
 * logs or keeps the time), then unsaved changes, then pending automatic
 * writes are flushed. An answer to the unsaved prompt skips that prompt:
 * `save` still flushes, `discard` quits without writing.
 */
export function nextQuitStep(a: { timerProtected: boolean; choice: QuitChoice | null; state: UnsavedState }): QuitStep {
  if (a.timerProtected) return 'ask-timer';
  if (a.choice === 'discard') return 'quit';
  if (a.choice === 'save') return 'flush';
  return hasUnsaved(a.state) ? 'ask-unsaved' : 'flush';
}
