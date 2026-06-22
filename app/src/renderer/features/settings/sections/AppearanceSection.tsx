import React from 'react';
import { Heading, Text, ButtonGroup } from '@vibe/core';
import type { ThemeSetting } from '../../../../shared/config';
import { useThemeStore } from '../../../stores/theme';
import styles from '../SettingsView.module.css';

const OPTIONS = [
  { value: 'light', text: 'Light' },
  { value: 'dark', text: 'Dark' },
  { value: 'system', text: 'System' },
];

export function AppearanceSection() {
  const setting = useThemeStore((s) => s.setting);
  const setSetting = useThemeStore((s) => s.setSetting);

  return (
    <section className={styles.card}>
      <Heading>Appearance</Heading>
      <div className={styles.field}>
        <Text>Theme</Text>
        <ButtonGroup
          options={OPTIONS}
          value={setting}
          onSelect={(v) => setSetting(v as ThemeSetting)}
        />
        <Text>Applies immediately — no Save needed.</Text>
      </div>
    </section>
  );
}
