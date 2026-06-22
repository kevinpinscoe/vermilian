import { create } from 'zustand';

export type TimerMode = 'pomodoro' | 'open';
export type TimerPhase = 'work' | 'short-break' | 'long-break';

export interface TimerEntry {
  issueId: string;
  issueReadableId: string;
  summary: string;
  mode: TimerMode;
  worklogType: string;
  startedAt: number;          // epoch ms — when session started
  blockCount: number;         // completed work blocks (0 at start)
  totalWorkMs: number;        // accumulated ms from completed work blocks
  phase: TimerPhase;
  phaseStartedAt: number | null; // null = paused
  phaseElapsedMs: number;    // elapsed in current phase at last pause
}

// Compute current elapsed ms for the active phase.
export function getPhaseElapsed(entry: TimerEntry): number {
  const base = entry.phaseElapsedMs;
  if (!entry.phaseStartedAt) return base;
  return base + (Date.now() - entry.phaseStartedAt);
}

// Compute total work ms including current work-phase elapsed.
export function getTotalWorkMs(entry: TimerEntry): number {
  if (entry.phase === 'work') {
    return entry.totalWorkMs + getPhaseElapsed(entry);
  }
  return entry.totalWorkMs;
}

export function fmtMs(ms: number): string {
  const totalSecs = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface TimerStore {
  timer: TimerEntry | null;

  startTimer(
    issueId: string,
    issueReadableId: string,
    summary: string,
    mode: TimerMode,
    worklogType: string,
  ): void;

  pauseTimer(): void;
  resumeTimer(): void;

  advanceToBreak(isLong: boolean): void;
  advanceToWork(): void;

  clearTimer(): void;
  restoreTimer(entry: TimerEntry): void;
}

export const useTimerStore = create<TimerStore>((set) => ({
  timer: null,

  startTimer(issueId, issueReadableId, summary, mode, worklogType) {
    const now = Date.now();
    set({
      timer: {
        issueId,
        issueReadableId,
        summary,
        mode,
        worklogType,
        startedAt: now,
        blockCount: 0,
        totalWorkMs: 0,
        phase: 'work',
        phaseStartedAt: now,
        phaseElapsedMs: 0,
      },
    });
  },

  pauseTimer() {
    set((s) => {
      if (!s.timer || !s.timer.phaseStartedAt) return s;
      const elapsed = s.timer.phaseElapsedMs + (Date.now() - s.timer.phaseStartedAt);
      return { timer: { ...s.timer, phaseStartedAt: null, phaseElapsedMs: elapsed } };
    });
  },

  resumeTimer() {
    set((s) => {
      if (!s.timer || s.timer.phaseStartedAt !== null) return s;
      return { timer: { ...s.timer, phaseStartedAt: Date.now() } };
    });
  },

  advanceToBreak(isLong) {
    set((s) => {
      if (!s.timer) return s;
      const now = Date.now();
      const phaseElapsed = getPhaseElapsed(s.timer);
      return {
        timer: {
          ...s.timer,
          blockCount: s.timer.blockCount + 1,
          totalWorkMs: s.timer.totalWorkMs + phaseElapsed,
          phase: isLong ? 'long-break' : 'short-break',
          phaseStartedAt: now,
          phaseElapsedMs: 0,
        },
      };
    });
  },

  advanceToWork() {
    set((s) => {
      if (!s.timer) return s;
      return {
        timer: {
          ...s.timer,
          phase: 'work',
          phaseStartedAt: Date.now(),
          phaseElapsedMs: 0,
        },
      };
    });
  },

  clearTimer() {
    set({ timer: null });
  },

  restoreTimer(entry) {
    set({ timer: entry });
  },
}));
