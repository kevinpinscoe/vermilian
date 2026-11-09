import React, { useState } from 'react';
import { Heading, Text, TextField, Button, AttentionBox } from '@vibe/core';
import type { SettingsDraft, UpdateDraft, TestState } from '../types';
import styles from '../SettingsView.module.css';

interface Props {
  draft: SettingsDraft;
  update: UpdateDraft;
  hasToken: boolean;
  onTest: () => void;
  test: TestState;
}

export function JiraSection({ draft, update, hasToken, onTest, test }: Props) {
  const [showToken, setShowToken] = useState(false);

  return (
    <section className={styles.card} data-testid="jira-section">
      <Heading>Jira</Heading>
      <Text>
        The site URL, email and cloudId are stored in YouTrack and shared by every machine. The API
        token stays on this machine.
      </Text>

      <div className={styles.field}>
        <Text weight="bold">Site URL</Text>
        <TextField
          data-testid="jira-site-url"
          placeholder="https://your-site.atlassian.net"
          value={draft.jiraSiteUrl}
          onChange={(v) => update({ jiraSiteUrl: v })}
        />
      </div>

      <div className={styles.field}>
        <Text weight="bold">Account email</Text>
        <TextField
          data-testid="jira-email"
          placeholder="you@example.com"
          value={draft.jiraEmail}
          onChange={(v) => update({ jiraEmail: v })}
        />
      </div>

      <div className={styles.field}>
        <Text weight="bold">cloudId</Text>
        <Text>Filled in by Test connection. Enter it by hand only if detection fails.</Text>
        <TextField
          data-testid="jira-cloud-id"
          placeholder="Detected automatically"
          value={draft.jiraCloudId}
          onChange={(v) => update({ jiraCloudId: v })}
        />
      </div>

      {/* Credential source — priority 1 */}
      <div className={styles.field}>
        <Text weight="bold">Jira API Token — Source 1: Shell command</Text>
        <Text>Stdout is used as the token. Checked first. Leave blank to skip.</Text>
        <TextField
          placeholder='op read "op://Work/Jira/token"'
          value={draft.jiraTokenCommand}
          onChange={(v) => update({ jiraTokenCommand: v })}
        />
      </div>

      {/* Credential source — priority 2 */}
      <div className={styles.field}>
        <Text weight="bold">Source 2: File path</Text>
        <Text>File content (trimmed) is used as the token. Checked if Source 1 is blank or fails.</Text>
        <TextField
          placeholder="/run/secrets/jira-token"
          value={draft.jiraTokenFile}
          onChange={(v) => update({ jiraTokenFile: v })}
        />
      </div>

      {/* Credential source — priority 3 */}
      <div className={styles.field}>
        <Text weight="bold">Source 3: Paste token (saved to OS keyring)</Text>
        <Text>Used only if Sources 1 and 2 are blank or fail. A classic or scoped API token both work.</Text>
        <div className={styles.inline}>
          <span className={styles.grow}>
            <TextField
              data-testid="jira-token"
              type={draft.jiraToken && !showToken ? 'password' : 'text'}
              placeholder={hasToken ? 'Jira token saved — paste to replace' : 'Paste your Jira API token'}
              value={draft.jiraToken}
              onChange={(v) => update({ jiraToken: v })}
            />
          </span>
          {draft.jiraToken && (
            <Button kind="tertiary" onClick={() => setShowToken((s) => !s)}>
              {showToken ? 'Hide' : 'Show'}
            </Button>
          )}
        </div>
      </div>

      <div>
        <Button
          data-testid="jira-test-btn"
          kind="secondary"
          loading={test.status === 'testing'}
          onClick={onTest}
        >
          Test connection
        </Button>
      </div>

      {test.status === 'success' && (
        <AttentionBox data-testid="jira-test-result" type="positive" title="Jira connected" text={test.message} />
      )}
      {test.status === 'error' && (
        <AttentionBox data-testid="jira-test-result" type="negative" title="Jira connection failed" text={test.message} />
      )}
    </section>
  );
}
