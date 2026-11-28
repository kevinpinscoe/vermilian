import { describe, expect, it } from 'vitest';
import { EMPTY_UNSAVED_STATE, hasUnsaved, nextQuitStep, normaliseUnsavedState, unsavedQuitMessage } from './quitGuard';

describe('normaliseUnsavedState (VERM-123)', () => {
  it('accepts labels and a saving count', () => {
    expect(normaliseUnsavedState({ drafts: ['Settings'], saving: 2 })).toEqual({ drafts: ['Settings'], saving: 2 });
  });

  it('drops anything malformed rather than trusting the renderer', () => {
    expect(normaliseUnsavedState(null)).toEqual(EMPTY_UNSAVED_STATE);
    expect(normaliseUnsavedState({ drafts: 'Settings', saving: -1 })).toEqual(EMPTY_UNSAVED_STATE);
    expect(normaliseUnsavedState({ drafts: ['', 3, 'Settings'], saving: 1.5 })).toEqual({ drafts: ['Settings'], saving: 1 });
  });

  it('bounds what it keeps', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Draft ${i}`);
    const s = normaliseUnsavedState({ drafts: many, saving: 0 });
    expect(s.drafts).toHaveLength(20);
    expect(normaliseUnsavedState({ drafts: ['x'.repeat(500)], saving: 0 }).drafts[0]).toHaveLength(120);
  });
});

describe('hasUnsaved', () => {
  it('is false only when nothing is open or saving', () => {
    expect(hasUnsaved(EMPTY_UNSAVED_STATE)).toBe(false);
    expect(hasUnsaved({ drafts: ['Settings'], saving: 0 })).toBe(true);
    expect(hasUnsaved({ drafts: [], saving: 1 })).toBe(true);
  });
});

describe('unsavedQuitMessage', () => {
  it('names the unsaved editors', () => {
    expect(unsavedQuitMessage({ drafts: ['Settings', 'Add projects to “Kevin”'], saving: 0 }))
      .toBe('You have unsaved changes in Settings and Add projects to “Kevin”.');
    expect(unsavedQuitMessage({ drafts: ['A', 'B', 'C'], saving: 0 })).toBe('You have unsaved changes in A, B and C.');
  });

  it('describes saves still in progress', () => {
    expect(unsavedQuitMessage({ drafts: [], saving: 1 })).toBe('A change is still being saved.');
    expect(unsavedQuitMessage({ drafts: ['Settings'], saving: 3 }))
      .toBe('You have unsaved changes in Settings. 3 changes are still being saved.');
  });
});

describe('nextQuitStep', () => {
  const dirty = { drafts: ['Settings'], saving: 0 };

  it('asks about a running timer before anything else', () => {
    expect(nextQuitStep({ timerProtected: true, choice: null, state: dirty })).toBe('ask-timer');
    expect(nextQuitStep({ timerProtected: true, choice: 'discard', state: dirty })).toBe('ask-timer');
  });

  it('asks about unsaved changes, then flushes when there are none', () => {
    expect(nextQuitStep({ timerProtected: false, choice: null, state: dirty })).toBe('ask-unsaved');
    expect(nextQuitStep({ timerProtected: false, choice: null, state: { drafts: [], saving: 1 } })).toBe('ask-unsaved');
    expect(nextQuitStep({ timerProtected: false, choice: null, state: EMPTY_UNSAVED_STATE })).toBe('flush');
  });

  it('follows the answer without asking again', () => {
    expect(nextQuitStep({ timerProtected: false, choice: 'save', state: dirty })).toBe('flush');
    expect(nextQuitStep({ timerProtected: false, choice: 'discard', state: dirty })).toBe('quit');
  });
});
