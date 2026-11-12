import { describe, expect, it } from 'vitest';
import {
  EMPTY_RUNWAY_METADATA,
  applyRunwayPatch,
  isEmptyRunwayMetadata,
  planYouTrackWrites,
  type RunwayMetadata,
  type RunwayRank,
} from './runway';

const empty: RunwayMetadata = { ...EMPTY_RUNWAY_METADATA };
const ranked = (rank: RunwayRank, whyNow: string | null = null): RunwayMetadata => ({
  focus: true,
  focusRank: rank,
  whyNow,
});

describe('applyRunwayPatch (ADR-0007 rules)', () => {
  it('setting a rank also sets Focus', () => {
    expect(applyRunwayPatch(empty, { focusRank: 2 })).toEqual(ranked(2));
  });

  it('clearing Focus clears the rank and keeps Why now', () => {
    expect(applyRunwayPatch(ranked(1, 'Due Friday'), { focus: false })).toEqual({
      focus: false,
      focusRank: null,
      whyNow: 'Due Friday',
    });
  });

  it('clearing only the rank keeps Focus', () => {
    expect(applyRunwayPatch(ranked(3), { focusRank: null })).toEqual({ focus: true, focusRank: null, whyNow: null });
  });

  it('starring keeps any existing rank and Why now', () => {
    expect(applyRunwayPatch(ranked(1, 'x'), { focus: true })).toEqual(ranked(1, 'x'));
  });

  it('sets and clears Why now; an empty string is no Why now', () => {
    expect(applyRunwayPatch(empty, { whyNow: 'Blocks release' }).whyNow).toBe('Blocks release');
    expect(applyRunwayPatch(ranked(1, 'x'), { whyNow: '' }).whyNow).toBeNull();
    expect(applyRunwayPatch(ranked(1, 'x'), { whyNow: null }).whyNow).toBeNull();
  });

  it('leaves omitted keys unchanged', () => {
    expect(applyRunwayPatch(ranked(2, 'x'), {})).toEqual(ranked(2, 'x'));
  });

  it('refuses a rank outside 1–3', () => {
    expect(() => applyRunwayPatch(empty, { focusRank: 4 as RunwayRank })).toThrow(/1, 2 or 3/);
    expect(() => applyRunwayPatch(empty, { focusRank: 0 as RunwayRank })).toThrow(/1, 2 or 3/);
  });

  it('refuses clearing Focus while setting a rank', () => {
    expect(() => applyRunwayPatch(empty, { focus: false, focusRank: 1 })).toThrow(/cannot clear Focus/);
  });

  it('does not mutate its input', () => {
    const current = ranked(1, 'x');
    applyRunwayPatch(current, { focus: false });
    expect(current).toEqual(ranked(1, 'x'));
  });
});

describe('isEmptyRunwayMetadata', () => {
  it('is true only with no Focus, rank or Why now', () => {
    expect(isEmptyRunwayMetadata(empty)).toBe(true);
    expect(isEmptyRunwayMetadata({ ...empty, whyNow: 'x' })).toBe(false);
    expect(isEmptyRunwayMetadata({ ...empty, focus: true })).toBe(false);
  });
});

describe('planYouTrackWrites', () => {
  it('turns Focus on before setting a rank', () => {
    expect(planYouTrackWrites(empty, ranked(1))).toEqual([
      { field: 'focus', value: 'Yes' },
      { field: 'focusRank', value: 1 },
    ]);
  });

  it('clears the rank before turning Focus off', () => {
    expect(planYouTrackWrites(ranked(2, 'x'), { focus: false, focusRank: null, whyNow: 'x' })).toEqual([
      { field: 'focusRank', value: null },
      { field: 'focus', value: null },
    ]);
  });

  it('writes only what changed', () => {
    expect(planYouTrackWrites(ranked(1), ranked(1))).toEqual([]);
    expect(planYouTrackWrites(ranked(1), ranked(3))).toEqual([{ field: 'focusRank', value: 3 }]);
    expect(planYouTrackWrites(ranked(1), ranked(1, 'why'))).toEqual([{ field: 'whyNow', value: 'why' }]);
  });

  it('uses the existing YouTrack field keys and values', () => {
    const fields = planYouTrackWrites(empty, ranked(2, 'w')).map((w) => w.field);
    expect(fields).toEqual(['focus', 'focusRank', 'whyNow']);
  });
});
