import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Heading, Text } from '@vibe/core';
import type { CredentialRefWriteResult } from '../../../shared/ipc';
import { jiraReconnectAdvice, type WorkspaceJiraFailure } from '../../../shared/jiraConnection';
import styles from './JiraWorkspaceBoard.module.css';

export const CREDENTIAL_REFS_QUERY_KEY = ['credential-refs'] as const;

const WRITE_FAILURES: Record<Exclude<CredentialRefWriteResult, { ok: true }>['reason'], string> = {
  'invalid-reference': 'The credential reference is not valid.',
  'legacy-reference': 'A legacy credential is replaced in Settings.',
  'invalid-value': 'That does not look like a single token. Paste just the token.',
  'encryption-unavailable': 'Encrypted storage is not available on this host. Configure a command or file source for the reference instead.',
  'write-failed': 'The token could not be saved.',
};

interface JiraReconnectProps {
  workspaceName: string;
  failure: WorkspaceJiraFailure;
  onRetry: () => void;
  onOpenSettings: () => void;
}

/**
 * The reconnect state of a Jira workspace whose token Jira rejected, or whose
 * credential no longer resolves here (VERM-40). It replaces the board, names
 * the credential reference (never its value), says where that reference
 * reads its token on this host, and offers to store a new one when nothing
 * outranks a stored token. The top-bar Settings gear stays reachable.
 */
export function JiraReconnect({ workspaceName, failure, onRetry, onOpenSettings }: JiraReconnectProps) {
  const { credentialRef } = failure;
  const refs = useQuery({ queryKey: CREDENTIAL_REFS_QUERY_KEY, queryFn: () => window.vermilian.listCredentialRefs() });
  const status = refs.data?.find((r) => r.credentialRef === credentialRef) ?? null;
  const advice = jiraReconnectAdvice(status, credentialRef);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    if (!credentialRef || !token.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await window.vermilian.saveCredentialRefSecret(credentialRef, token);
      if (r.ok) {
        setToken('');
        void refs.refetch();
        onRetry();
      } else {
        setSaveError(WRITE_FAILURES[r.reason]);
      }
    } finally {
      setSaving(false);
    }
  }

  const title = failure.reason === 'unauthorized' ? 'Jira rejected this workspace’s token' : 'This workspace’s Jira token is not available here';
  const why =
    failure.reason === 'unauthorized'
      ? 'It may have been revoked or have expired, or it may belong to another account.'
      : 'Its credential reference did not resolve on this host.';

  return (
    <div className={styles.reconnect} data-testid="jira-reconnect" data-reason={failure.reason} role="alert">
      <Heading type="h3" weight="bold">Reconnect Jira</Heading>
      <Text type="text1" weight="bold">{title}</Text>
      <Text type="text2">
        {why} Nothing from “{workspaceName}” is shown until it reconnects; your other workspaces are unaffected.
      </Text>
      <div className={styles.reconnectDetail} data-testid="jira-reconnect-message">{failure.message}</div>
      {credentialRef && (
        <Text type="text2">
          Credential reference: <code data-testid="jira-reconnect-ref">{credentialRef}</code>
        </Text>
      )}
      <Text type="text2" data-testid="jira-reconnect-advice">{advice.text}</Text>
      {advice.canEnterToken && (
        <form
          className={styles.reconnectForm}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="New Jira API token"
            aria-label="New Jira API token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            data-testid="jira-reconnect-token"
            className={styles.reconnectInput}
          />
          <Button type="submit" size="small" disabled={!token.trim()} loading={saving} data-testid="jira-reconnect-save">
            Save and reconnect
          </Button>
        </form>
      )}
      {saveError && <div className={styles.error} role="alert" data-testid="jira-reconnect-save-error">{saveError}</div>}
      <div className={styles.reconnectForm}>
        {status?.legacy && (
          <Button size="small" onClick={onOpenSettings} data-testid="jira-reconnect-open-settings">Open Settings</Button>
        )}
        <Button kind="secondary" size="small" onClick={onRetry} data-testid="jira-reconnect-retry">Try again</Button>
      </div>
    </div>
  );
}
