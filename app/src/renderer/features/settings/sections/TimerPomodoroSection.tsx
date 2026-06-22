import React from 'react';
import { Heading, Text, NumberField, Checkbox, Dropdown } from '@vibe/core';
import type { SettingsDraft, UpdateDraft } from '../types';
import styles from '../SettingsView.module.css';

interface Props {
  draft: SettingsDraft;
  update: UpdateDraft;
  worklogTypes: string[];
}

export function TimerPomodoroSection({ draft, update, worklogTypes }: Props) {
  const p = draft.pomodoro;
  const setP = (patch: Partial<SettingsDraft['pomodoro']>) =>
    update({ pomodoro: { ...p, ...patch } });

  const options = worklogTypes.map((t) => ({ label: t, value: t }));

  return (
    <section className={styles.card}>
      <Heading>Timer &amp; Pomodoro</Heading>

      <div className={styles.grid}>
        <div className={styles.field}>
          <Text>Work block (min)</Text>
          <NumberField
            value={p.work}
            min={5}
            max={120}
            onChange={(v) => setP({ work: v ?? p.work })}
          />
        </div>
        <div className={styles.field}>
          <Text>Short break (min)</Text>
          <NumberField
            value={p.shortBreak}
            min={1}
            max={60}
            onChange={(v) => setP({ shortBreak: v ?? p.shortBreak })}
          />
        </div>
        <div className={styles.field}>
          <Text>Long break (min)</Text>
          <NumberField
            value={p.longBreak}
            min={1}
            max={120}
            onChange={(v) => setP({ longBreak: v ?? p.longBreak })}
          />
        </div>
        <div className={styles.field}>
          <Text>Long break every (blocks)</Text>
          <NumberField
            value={p.longBreakEvery}
            min={2}
            max={10}
            onChange={(v) => setP({ longBreakEvery: v ?? p.longBreakEvery })}
          />
        </div>
      </div>

      <div className={styles.inline}>
        <Checkbox
          checked={draft.soundOnBlockEnd}
          aria-label="Sound on block end"
          onChange={() => update({ soundOnBlockEnd: !draft.soundOnBlockEnd })}
        />
        <Text>Sound on block end</Text>
      </div>
      <div className={styles.inline}>
        <Checkbox
          checked={draft.osNotifications}
          aria-label="OS notifications"
          onChange={() => update({ osNotifications: !draft.osNotifications })}
        />
        <Text>OS notifications</Text>
      </div>

      <div className={styles.field}>
        <Text>Default worklog type</Text>
        <Dropdown
          multi={false}
          options={options}
          value={options.find((o) => o.value === draft.defaultWorklogType)}
          onChange={(opt) =>
            update({ defaultWorklogType: opt?.value ?? 'Development' })
          }
        />
      </div>
    </section>
  );
}
