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

export function ConnectionSection({ draft, update, hasToken, onTest, test }: Props) {
  const [showToken, setShowToken] = useState(false);

  const anySourceConfigured =
    Boolean(draft.youtrackTokenCommand.trim()) ||
    Boolean(draft.youtrackTokenFile.trim()) ||
    hasToken;

  return (
    <section className={styles.card}>
      <Heading>Connection</Heading>

      <div className={styles.field}>
        <Text>YouTrack URL</Text>
        <TextField
          placeholder="https://youtrack.example.com"
          value={draft.youtrackUrl}
          onChange={(v) => update({ youtrackUrl: v })}
        />
      </div>

      <div className={styles.field}>
        <Text>YouTrack username</Text>
        <Text>Your YouTrack login name (used to identify you in the app).</Text>
        <TextField
          placeholder="your.login"
          value={draft.youtrackLogin}
          onChange={(v) => update({ youtrackLogin: v })}
        />
      </div>

      {/* Credential source — priority 1 */}
      <div className={styles.field}>
        <Text weight="bold">API Token — Source 1: Shell command</Text>
        <Text>
          Stdout is used as the token. Checked first. Leave blank to skip.
        </Text>
        <TextField
          placeholder="op read &quot;op://Personal/YouTrack/api-token&quot;"
          value={draft.youtrackTokenCommand}
          onChange={(v) => update({ youtrackTokenCommand: v })}
        />
        <Text className={styles.hint}>
          Examples: <code>op read "op://…"</code> (1Password) · <code>bao kv get -field=token secret/youtrack</code> (OpenBao) · <code>pass show youtrack/token</code>
        </Text>
      </div>

      {/* Credential source — priority 2 */}
      <div className={styles.field}>
        <Text weight="bold">Source 2: File path</Text>
        <Text>
          File content (trimmed) is used as the token. Checked if Source 1 is blank or fails.
        </Text>
        <TextField
          placeholder="/run/secrets/youtrack-token"
          value={draft.youtrackTokenFile}
          onChange={(v) => update({ youtrackTokenFile: v })}
        />
      </div>

      {/* Credential source — priority 3 */}
      <div className={styles.field}>
        <Text weight="bold">Source 3: Paste token (saved to OS keyring)</Text>
        <Text>
          Used only if Sources 1 and 2 are blank or fail.
          {!anySourceConfigured && ' No token configured.'}
        </Text>
        <div className={styles.inline}>
          <span className={styles.grow}>
            <TextField
              type={draft.youtrackToken && !showToken ? 'password' : 'text'}
              placeholder={hasToken ? 'Token saved — paste to replace' : 'Paste your YouTrack permanent token'}
              value={draft.youtrackToken}
              onChange={(v) => update({ youtrackToken: v })}
            />
          </span>
          {draft.youtrackToken && (
            <Button kind="tertiary" onClick={() => setShowToken((s) => !s)}>
              {showToken ? 'Hide' : 'Show'}
            </Button>
          )}
        </div>
      </div>

      <div>
        <Button kind="secondary" loading={test.status === 'testing'} onClick={onTest}>
          Test connection
        </Button>
      </div>

      {test.status === 'success' && (
        <AttentionBox type="positive" title="Connected" text={test.message} />
      )}
      {test.status === 'error' && (
        <AttentionBox type="negative" title="Connection failed" text={test.message} />
      )}
    </section>
  );
}
