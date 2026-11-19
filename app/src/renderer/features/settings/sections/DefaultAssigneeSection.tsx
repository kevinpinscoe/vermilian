import React, { useState } from 'react';
import { Heading, Text, TextField, Button, AttentionBox } from '@vibe/core';
import styles from '../SettingsView.module.css';

interface Props {
  workspaceId: string;
  workspaceName: string;
  isJira: boolean;
  youtrackLogin: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * The active workspace's Default assignee (VERM-68): All tasks opens showing
 * only this person's issues. Kept on this computer, like the rest of Settings.
 */
export function DefaultAssigneeSection({ workspaceId, workspaceName, isJira, youtrackLogin, value, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);

  async function fillMyAccount() {
    setError(null);
    if (!isJira) {
      if (youtrackLogin.trim()) onChange(youtrackLogin.trim());
      else setError('Enter your YouTrack username under Connection first.');
      return;
    }
    const r = await window.vermilian.getWorkspaceJiraMyAccountId(workspaceId);
    if (r.ok) onChange(r.accountId);
    else setError(r.message);
  }

  return (
    <section className={styles.card} data-testid="default-assignee-section">
      <Heading>Default assignee</Heading>
      <div className={styles.field}>
        <Text>
          All tasks in &ldquo;{workspaceName}&rdquo; opens showing only this person&apos;s issues. Leave blank to show everyone.
        </Text>
        <div data-testid="default-assignee-field">
          <TextField
            placeholder={isJira ? 'Jira account ID' : 'YouTrack login'}
            value={value}
            onChange={(v) => onChange(v)}
          />
        </div>
        <div>
          <Button kind="secondary" size="small" onClick={() => void fillMyAccount()} data-testid="default-assignee-use-mine">
            Use my account
          </Button>
          {' '}
          <Button kind="tertiary" size="small" onClick={() => onChange('')} disabled={!value} data-testid="default-assignee-clear">
            Clear
          </Button>
        </div>
        {error && <AttentionBox type="negative" title="Account not found" text={error} data-testid="default-assignee-error" />}
      </div>
    </section>
  );
}
