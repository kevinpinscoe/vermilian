import React, { useState } from 'react';
import { Heading, Text, TextField, Button, AttentionBox } from '@vibe/core';
import type { SettingsDraft, UpdateDraft, TestState } from '../types';
import styles from '../SettingsView.module.css';

interface Props {
  draft: SettingsDraft;
  update: UpdateDraft;
  hasKey: boolean;
  onTest: () => void;
  test: TestState;
}

export function AISection({ draft, update, hasKey, onTest, test }: Props) {
  const [showKey, setShowKey] = useState(false);

  const anySourceConfigured =
    Boolean(draft.claudeKeyCommand.trim()) ||
    Boolean(draft.claudeKeyFile.trim()) ||
    hasKey;

  return (
    <section className={styles.card}>
      <Heading>AI (Claude)</Heading>

      {/* Credential source — priority 1 */}
      <div className={styles.field}>
        <Text weight="bold">Claude API Key — Source 1: Shell command</Text>
        <Text>
          Stdout is used as the key. Checked first. Leave blank to skip.
        </Text>
        <TextField
          placeholder='op read "op://Personal/Anthropic/api-key"'
          value={draft.claudeKeyCommand}
          onChange={(v) => update({ claudeKeyCommand: v })}
        />
        <Text className={styles.hint}>
          Examples: <code>op read "op://…"</code> (1Password) · <code>bao kv get -field=key secret/claude</code> (OpenBao)
        </Text>
      </div>

      {/* Credential source — priority 2 */}
      <div className={styles.field}>
        <Text weight="bold">Source 2: File path</Text>
        <Text>
          File content (trimmed) is used as the key. Checked if Source 1 is blank or fails.
        </Text>
        <TextField
          placeholder="/run/secrets/claude-api-key"
          value={draft.claudeKeyFile}
          onChange={(v) => update({ claudeKeyFile: v })}
        />
      </div>

      {/* Credential source — priority 3 */}
      <div className={styles.field}>
        <Text weight="bold">Source 3: Paste key (saved to OS keyring)</Text>
        <Text>
          Used only if Sources 1 and 2 are blank or fail. Leave blank to disable AI features.
          {!anySourceConfigured && ' No key configured — AI features disabled.'}
        </Text>
        <div className={styles.inline}>
          <span className={styles.grow}>
            <TextField
              type={draft.claudeKey && !showKey ? 'password' : 'text'}
              placeholder={hasKey ? 'Key saved — paste to replace' : 'sk-ant-...'}
              value={draft.claudeKey}
              onChange={(v) => update({ claudeKey: v })}
            />
          </span>
          {draft.claudeKey && (
            <Button kind="tertiary" onClick={() => setShowKey((s) => !s)}>
              {showKey ? 'Hide' : 'Show'}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <Text weight="bold">Model for task creation</Text>
        <TextField
          value={draft.modelForCreate}
          onChange={(v) => update({ modelForCreate: v })}
        />
      </div>

      <div className={styles.field}>
        <Text weight="bold">Model for stand-up reports</Text>
        <TextField
          value={draft.modelForStandup}
          onChange={(v) => update({ modelForStandup: v })}
        />
      </div>

      <div>
        <Button kind="secondary" loading={test.status === 'testing'} onClick={onTest}>
          Test connection
        </Button>
      </div>

      {test.status === 'success' && (
        <AttentionBox type="positive" title="Key valid" text={test.message} />
      )}
      {test.status === 'error' && (
        <AttentionBox type="negative" title="Key check failed" text={test.message} />
      )}
    </section>
  );
}
