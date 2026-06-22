import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fmtMs,
  getPhaseElapsed,
  getTotalWorkMs,
  useTimerStore,
  type TimerEntry,
} from './timer';

// ─── fmtMs (pure, no clock) ────────────────────────────────────────────────────

describe('fmtMs', () => {
  it('formats whole minutes and seconds, zero-padded', () => {
    expect(fmtMs(0)).toBe('00:00');
    expect(fmtMs(1000)).toBe('00:01');
    expect(fmtMs(59_000)).toBe('00:59');
    expect(fmtMs(60_000)).toBe('01:00');
    expect(fmtMs(90_000)).toBe('01:30');
    expect(fmtMs(25 * 60_000)).toBe('25:00');
  });

  it('floors sub-second remainders', () => {
    expect(fmtMs(1999)).toBe('00:01');
    expect(fmtMs(59_999)).toBe('00:59');
  });

  it('clamps negative input to zero', () => {
    expect(fmtMs(-5000)).toBe('00:00');
  });

  it('does not truncate minutes past 99', () => {
    expect(fmtMs(100 * 60_000)).toBe('100:00');
  });
});

// ─── clock-dependent math ──────────────────────────────────────────────────────

const T0 = 1_700_000_000_000;

function entry(over: Partial<TimerEntry> = {}): TimerEntry {
  return {
    issueId: '1',
    issueReadableId: 'T-1',
    summary: 's',
    mode: 'pomodoro',
    worklogType: 'Development',
    startedAt: T0,
    blockCount: 0,
    totalWorkMs: 0,
    phase: 'work',
    phaseStartedAt: T0,
    phaseElapsedMs: 0,
    ...over,
  };
}

describe('getPhaseElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('returns the stored elapsed when paused (phaseStartedAt null)', () => {
    expect(getPhaseElapsed(entry({ phaseStartedAt: null, phaseElapsedMs: 12_000 }))).toBe(12_000);
  });

  it('adds wall-clock time since phaseStartedAt when running', () => {
    vi.setSystemTime(T0 + 5000);
    expect(getPhaseElapsed(entry({ phaseStartedAt: T0, phaseElapsedMs: 0 }))).toBe(5000);
  });

  it('adds wall-clock time on top of previously accumulated elapsed', () => {
    vi.setSystemTime(T0 + 3000);
    expect(getPhaseElapsed(entry({ phaseStartedAt: T0, phaseElapsedMs: 10_000 }))).toBe(13_000);
  });
});

describe('getTotalWorkMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 4000);
  });
  afterEach(() => vi.useRealTimers());

  it('adds the live work-phase elapsed to accumulated work', () => {
    expect(getTotalWorkMs(entry({ phase: 'work', totalWorkMs: 60_000, phaseStartedAt: T0 }))).toBe(64_000);
  });

  it('ignores the current phase elapsed during a break', () => {
    expect(getTotalWorkMs(entry({ phase: 'short-break', totalWorkMs: 60_000, phaseStartedAt: T0 }))).toBe(60_000);
    expect(getTotalWorkMs(entry({ phase: 'long-break', totalWorkMs: 60_000, phaseStartedAt: T0 }))).toBe(60_000);
  });
});

// ─── store state machine ───────────────────────────────────────────────────────

describe('useTimerStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    useTimerStore.setState({ timer: null });
  });
  afterEach(() => vi.useRealTimers());

  const store = () => useTimerStore.getState();

  it('startTimer begins a fresh work phase', () => {
    store().startTimer('1', 'T-1', 'Fix bug', 'pomodoro', 'Development');
    const t = store().timer!;
    expect(t).toMatchObject({
      issueId: '1',
      phase: 'work',
      blockCount: 0,
      totalWorkMs: 0,
      phaseElapsedMs: 0,
      startedAt: T0,
      phaseStartedAt: T0,
    });
  });

  it('pauseTimer captures elapsed and nulls phaseStartedAt; resumeTimer restarts it', () => {
    store().startTimer('1', 'T-1', 's', 'pomodoro', 'Development');
    vi.setSystemTime(T0 + 7000);
    store().pauseTimer();
    expect(store().timer).toMatchObject({ phaseStartedAt: null, phaseElapsedMs: 7000 });

    vi.setSystemTime(T0 + 10_000);
    store().resumeTimer();
    expect(store().timer).toMatchObject({ phaseStartedAt: T0 + 10_000, phaseElapsedMs: 7000 });
  });

  it('resumeTimer is a no-op while already running', () => {
    store().startTimer('1', 'T-1', 's', 'pomodoro', 'Development');
    vi.setSystemTime(T0 + 5000);
    store().resumeTimer();
    expect(store().timer!.phaseStartedAt).toBe(T0); // unchanged
  });

  it('advanceToBreak banks the work elapsed, bumps blockCount, and switches phase', () => {
    store().startTimer('1', 'T-1', 's', 'pomodoro', 'Development');
    vi.setSystemTime(T0 + 25 * 60_000);
    store().advanceToBreak(false);
    expect(store().timer).toMatchObject({
      blockCount: 1,
      totalWorkMs: 25 * 60_000,
      phase: 'short-break',
      phaseStartedAt: T0 + 25 * 60_000,
      phaseElapsedMs: 0,
    });
  });

  it('advanceToBreak(true) selects the long break', () => {
    store().startTimer('1', 'T-1', 's', 'pomodoro', 'Development');
    store().advanceToBreak(true);
    expect(store().timer!.phase).toBe('long-break');
  });

  it('advanceToWork resets to a running work phase', () => {
    store().startTimer('1', 'T-1', 's', 'pomodoro', 'Development');
    store().advanceToBreak(false);
    vi.setSystemTime(T0 + 30 * 60_000);
    store().advanceToWork();
    expect(store().timer).toMatchObject({
      phase: 'work',
      phaseStartedAt: T0 + 30 * 60_000,
      phaseElapsedMs: 0,
    });
  });

  it('clearTimer and restoreTimer manage the whole entry', () => {
    store().startTimer('1', 'T-1', 's', 'pomodoro', 'Development');
    store().clearTimer();
    expect(store().timer).toBeNull();

    const saved = entry({ blockCount: 3, totalWorkMs: 99 });
    store().restoreTimer(saved);
    expect(store().timer).toEqual(saved);
  });

  it('mutating actions are no-ops when no timer is active', () => {
    store().pauseTimer();
    store().advanceToBreak(false);
    store().advanceToWork();
    expect(store().timer).toBeNull();
  });
});
