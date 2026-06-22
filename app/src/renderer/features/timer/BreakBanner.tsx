import React, { useEffect, useRef, useState } from 'react';
import { Button, Text } from '@vibe/core';
import type { PomodoroConfig } from '../../../shared/config';
import { useTimerStore, getPhaseElapsed, fmtMs } from '../../stores/timer';
import styles from './BreakBanner.module.css';

function fireNotification(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

interface BreakBannerProps {
  pomodoro: PomodoroConfig;
  onStopAndLog: () => Promise<void>;
}

export function BreakBanner({ pomodoro, onStopAndLog }: BreakBannerProps) {
  const timer = useTimerStore((s) => s.timer);
  const advanceToWork = useTimerStore((s) => s.advanceToWork);

  const [tick, setTick] = useState(0);
  const [stopping, setStopping] = useState(false);
  const phaseHandledRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    phaseHandledRef.current = false;
  }, [timer?.phase]);

  useEffect(() => {
    if (!timer) return;
    if (timer.phase !== 'short-break' && timer.phase !== 'long-break') return;
    if (timer.phaseStartedAt === null) return; // paused

    const breakMs =
      timer.phase === 'long-break'
        ? pomodoro.longBreak * 60 * 1000
        : pomodoro.shortBreak * 60 * 1000;
    const elapsed = getPhaseElapsed(timer);

    if (elapsed >= breakMs && !phaseHandledRef.current) {
      phaseHandledRef.current = true;
      advanceToWork();
      fireNotification(
        'Break complete',
        `Starting next 25-minute work block on '${timer.summary}'.`,
      );
    }
  
  }, [tick]);

  if (!timer || (timer.phase !== 'short-break' && timer.phase !== 'long-break')) return null;

  const breakMs =
    timer.phase === 'long-break'
      ? pomodoro.longBreak * 60 * 1000
      : pomodoro.shortBreak * 60 * 1000;
  const elapsed = getPhaseElapsed(timer);
  const remaining = Math.max(0, breakMs - elapsed);
  const isLong = timer.phase === 'long-break';

  async function handleStop() {
    setStopping(true);
    await onStopAndLog();
    setStopping(false);
  }

  return (
    <div className={styles.banner}>
      <div className={styles.left}>
        <span className={`${styles.dot} ${isLong ? styles.dotLong : styles.dotShort}`} />
        <Text type="text2" weight="medium" className={styles.label}>
          {isLong ? 'Long break' : 'Short break'} — {timer.issueReadableId}
        </Text>
        <span className={styles.countdown}>{fmtMs(remaining)}</span>
      </div>
      <div className={styles.right}>
        <Button size="small" kind="secondary" onClick={() => advanceToWork()}>
          Skip break
        </Button>
        <Button size="small" color="negative" onClick={handleStop} loading={stopping}>
          Stop &amp; log
        </Button>
      </div>
    </div>
  );
}
