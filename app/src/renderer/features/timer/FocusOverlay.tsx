import React, { useEffect, useRef, useState } from 'react';
import { Button, Text } from '@vibe/core';
import { Pause, Play } from '@vibe/icons';
import type { PomodoroConfig } from '../../../shared/config';
import { useTimerStore, getPhaseElapsed, fmtMs } from '../../stores/timer';
import styles from './FocusOverlay.module.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // AudioContext not available or blocked
  }
}

function fireNotification(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

function CircleProgress({ progress }: { progress: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <svg width={120} height={120} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={60} cy={60} r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={6} />
      <circle
        cx={60} cy={60} r={r}
        fill="none" stroke="white" strokeWidth={6}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FocusOverlayProps {
  pomodoro: PomodoroConfig;
  soundEnabled: boolean;
  onStopAndLog: () => Promise<void>;
  onCheckpoint: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FocusOverlay({ pomodoro, soundEnabled, onStopAndLog, onCheckpoint }: FocusOverlayProps) {
  const timer = useTimerStore((s) => s.timer);
  const pauseTimer = useTimerStore((s) => s.pauseTimer);
  const resumeTimer = useTimerStore((s) => s.resumeTimer);
  const advanceToBreak = useTimerStore((s) => s.advanceToBreak);

  const [tick, setTick] = useState(0);
  const [stopping, setStopping] = useState(false);
  const lastCheckpointRef = useRef(0);
  const phaseHandledRef = useRef(false);

  const isPaused = timer?.phaseStartedAt === null;
  const workMs = pomodoro.work * 60 * 1000;

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Phase transition & checkpoint logic on each tick
  useEffect(() => {
    if (!timer || timer.phase !== 'work' || isPaused) return;

    const elapsed = getPhaseElapsed(timer);

    // Checkpoint every 5 s
    if (Date.now() - lastCheckpointRef.current > 5000) {
      lastCheckpointRef.current = Date.now();
      onCheckpoint();
    }

    // Phase complete
    if (elapsed >= workMs && !phaseHandledRef.current) {
      phaseHandledRef.current = true;
      if (soundEnabled) playBeep();
      const isLong =
        timer.mode === 'pomodoro' &&
        (timer.blockCount + 1) % pomodoro.longBreakEvery === 0;
      advanceToBreak(isLong);
      const breakLabel = isLong
        ? `${pomodoro.longBreak}-minute long break`
        : `${pomodoro.shortBreak}-minute break`;
      fireNotification('Pomodoro complete', `Time for a ${breakLabel}.`);
    }
  
  }, [tick]);

  // Reset phase-handled flag when phase changes
  useEffect(() => {
    phaseHandledRef.current = false;
  }, [timer?.phase]);

  if (!timer || timer.phase !== 'work') return null;

  const elapsed = getPhaseElapsed(timer);
  const remaining = Math.max(0, workMs - elapsed);
  const progress = Math.min(1, elapsed / workMs);
  const blockLabel =
    timer.mode === 'pomodoro'
      ? `Work block ${timer.blockCount + 1}${pomodoro.longBreakEvery > 0 ? ` · every ${pomodoro.longBreakEvery} blocks → long break` : ''}`
      : 'Open timer';

  async function handleStop() {
    setStopping(true);
    await onStopAndLog();
    setStopping(false);
  }

  function handleSkipToBreak() {
    if (timer?.mode !== 'pomodoro') return;
    const isLong = (timer.blockCount + 1) % pomodoro.longBreakEvery === 0;
    advanceToBreak(isLong);
  }

  return (
    <div className={styles.overlay} data-testid="focus-overlay">
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        {/* Task label */}
        <Text type="text2" className={styles.taskId} data-testid="focus-task-id">{timer.issueReadableId}</Text>
        <Text type="text1" weight="bold" className={styles.summary}>
          {timer.summary}
        </Text>

        {/* Ring + time display */}
        <div className={styles.ringWrap}>
          {timer.mode === 'pomodoro' && (
            <div className={styles.ringBg}>
              <CircleProgress progress={progress} />
            </div>
          )}
          <div className={styles.timeDisplay}>
            <span className={styles.elapsed} data-testid="focus-time">
              {timer.mode === 'pomodoro' ? fmtMs(remaining) : fmtMs(elapsed)}
            </span>
            {isPaused && <span className={styles.pausedBadge} data-testid="focus-paused">PAUSED</span>}
          </div>
        </div>

        {/* Phase label */}
        <Text type="text2" className={styles.phaseLabel}>{blockLabel}</Text>

        {/* Actions */}
        <div className={styles.actions}>
          <Button
            data-testid="focus-pause-btn"
            kind="secondary"
            leftIcon={isPaused ? Play : Pause}
            onClick={isPaused ? resumeTimer : pauseTimer}
            className={styles.actionBtn}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </Button>

          {timer.mode === 'pomodoro' && (
            <Button data-testid="focus-skip-break-btn" kind="secondary" onClick={handleSkipToBreak} className={styles.actionBtn}>
              Skip to break
            </Button>
          )}

          <Button
            data-testid="focus-stop-btn"
            color="negative"
            onClick={handleStop}
            loading={stopping}
            className={styles.actionBtn}
          >
            Stop &amp; log
          </Button>
        </div>
      </div>
    </div>
  );
}
