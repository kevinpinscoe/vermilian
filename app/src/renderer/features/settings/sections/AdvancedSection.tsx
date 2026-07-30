import React, { useState } from 'react';
import { Heading, Button, AttentionBox } from '@vibe/core';
import { useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../../../stores/toast';
import styles from '../SettingsView.module.css';

interface Props {
  onReset: () => Promise<void>;
}

export function AdvancedSection({ onReset }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  async function handleForceResync() {
    setResyncing(true);
    try {
      const result = await window.vermilian.forceResyncWorkspaceConfig();
      if (result.ok) {
        await qc.invalidateQueries({ queryKey: ['workspace', 'config'] });
        await qc.invalidateQueries({ queryKey: ['board-config'] });
        await qc.invalidateQueries({ queryKey: ['youtrack', 'projects'] });
        showToast('positive', 'Resynced workspace configuration from YouTrack.');
      } else {
        showToast('negative', result.error ?? 'Resync failed.');
      }
    } finally {
      setResyncing(false);
    }
  }

  return (
    <section className={styles.card}>
      <Heading>Advanced</Heading>

      {!confirming ? (
        <div>
          <Button kind="secondary" onClick={() => setConfirming(true)}>
            Reset to defaults
          </Button>
        </div>
      ) : (
        <>
          <AttentionBox
            type="warning"
            title="Reset settings?"
            text="Reset all non-credential settings to their defaults? Your YouTrack token and Claude API key will be kept."
          />
          <div className={styles.inline}>
            <Button
              kind="primary"
              onClick={async () => {
                await onReset();
                setConfirming(false);
              }}
            >
              Reset
            </Button>
            <Button kind="tertiary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}

      <div>
        <Button kind="tertiary" onClick={() => window.vermilian.openUserData()}>
          Open config folder
        </Button>
      </div>

      <div>
        <Button
          data-testid="force-resync-btn"
          kind="tertiary"
          loading={resyncing}
          onClick={() => void handleForceResync()}
        >
          Force resync from server
        </Button>
        <p className={styles.hint}>
          Discards the cached workspace/project layout and re-fetches it from YouTrack,
          dropping any project assignments that no longer exist. Use this if projects or
          workspaces look empty or wrong on every machine, not just this one.
        </p>
      </div>
    </section>
  );
}
