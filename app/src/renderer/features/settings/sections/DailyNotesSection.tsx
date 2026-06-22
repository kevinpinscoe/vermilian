import React from 'react';
import { Heading, Text, TextField, Button } from '@vibe/core';
import type { SettingsDraft, UpdateDraft } from '../types';
import styles from '../SettingsView.module.css';

interface Props {
  draft: SettingsDraft;
  update: UpdateDraft;
}

export function DailyNotesSection({ draft, update }: Props) {
  async function browse() {
    const folder = await window.vermilian.pickFolder();
    if (folder) update({ dailyNotesFolder: folder });
  }

  return (
    <section className={styles.card}>
      <Heading>Daily notes</Heading>
      <div className={styles.field}>
        <Text>Daily notes folder</Text>
        <div className={styles.inline}>
          <span className={styles.grow}>
            <TextField
              readonly
              placeholder="No folder selected"
              value={draft.dailyNotesFolder}
              onChange={() => undefined}
            />
          </span>
          <Button kind="secondary" onClick={browse}>
            Browse…
          </Button>
          {draft.dailyNotesFolder && (
            <Button kind="tertiary" onClick={() => update({ dailyNotesFolder: '' })}>
              Clear
            </Button>
          )}
        </div>
        <Text>Used by the stand-up report&apos;s &ldquo;Save to daily notes&rdquo;.</Text>
      </div>
    </section>
  );
}
