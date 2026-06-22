import React, { useState } from 'react';
import { Heading, Button, AttentionBox } from '@vibe/core';
import styles from '../SettingsView.module.css';

interface Props {
  onReset: () => Promise<void>;
}

export function AdvancedSection({ onReset }: Props) {
  const [confirming, setConfirming] = useState(false);

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
    </section>
  );
}
