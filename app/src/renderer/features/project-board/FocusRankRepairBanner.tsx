// Repair state for a Focus rank shared by two or more issues in the active
// workspace — stale local state, a partial write, another client, or an edit
// made directly in the YouTrack web UI (docs/requirements.md § Priority Desk,
// "Focus-rank invariant"). Never auto-resolved: the user picks which issue
// keeps the slot; the rest are cleared to unranked (Focus stays Yes, Why now
// is preserved).
import React, { useState } from 'react';
import { AttentionBox, Button } from '@vibe/core';
import {
  useWorkspaceFocusRankHolders,
  useFocusMutations,
  findDuplicateRanks,
  type FocusRank,
  type FocusRankHolder,
} from './focus';
import styles from './FocusRankRepairBanner.module.css';

export function FocusRankRepairBanner() {
  const { byRank } = useWorkspaceFocusRankHolders();
  const { clearRank } = useFocusMutations();
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null);

  const duplicates = findDuplicateRanks(byRank);
  if (duplicates.length === 0) return null;

  async function keep(rank: FocusRank, keepIssueId: string, holders: FocusRankHolder[]) {
    for (const h of holders) {
      if (h.issue.id === keepIssueId) continue;
      setBusyIssueId(h.issue.id);
      try {
        await clearRank(h.issue.id, h.projectShortName);
      } finally {
        setBusyIssueId(null);
      }
    }
  }

  return (
    <div className={styles.wrap} data-testid="focus-rank-repair-banner">
      {duplicates.map(({ rank, holders }) => (
        <div key={rank} data-testid={`focus-rank-repair-${rank}`}>
          <AttentionBox
            type="warning"
            title={`Focus rank ${rank} is held by ${holders.length} issues`}
            text="Choose which one keeps this rank — the others become unranked (they stay starred, and Why now is kept)."
          />
          <div className={styles.actions}>
            {holders.map((h) => (
              <Button
                key={h.issue.id}
                size="small"
                kind="secondary"
                loading={busyIssueId === h.issue.id}
                disabled={busyIssueId !== null && busyIssueId !== h.issue.id}
                onClick={() => void keep(rank, h.issue.id, holders)}
                data-testid={`focus-rank-repair-keep-${h.issue.id}`}
              >
                Keep {h.issue.idReadable} at rank {rank}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
