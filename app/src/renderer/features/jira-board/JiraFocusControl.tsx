// The Focus star + rank badge for a Jira issue (VERM-38). It looks and
// behaves like project-board/FocusControl (same styles, same rules: a rank
// implies the star, unstarring clears the rank, taking a held rank asks
// first and leaves the old holder starred), but it reads and writes the
// workspace's local Runway store instead of YouTrack fields. Nothing is
// written to Jira, and Jira's own Rank is never touched.
import React, { useState } from 'react';
import { Button, Text } from '@vibe/core';
import { Favorite } from '@vibe/icons';
import type { RunwayRank } from '../../../shared/runway';
import { decideJiraRank, runwayEntryFor, useJiraRunway, useJiraRunwayMutations } from './jiraRunway';
import styles from '../project-board/FocusControl.module.css';

interface JiraFocusControlProps {
  workspaceId: string;
  issueKey: string;
  /** The live summary of another issue, for the move-rank question. */
  summaryOf?: (issueKey: string) => string | undefined;
  size?: 'small' | 'medium';
}

export function JiraFocusControl({ workspaceId, issueKey, summaryOf, size = 'small' }: JiraFocusControlProps) {
  const { index, isLoading } = useJiraRunway(workspaceId);
  const { update, moveRank } = useJiraRunwayMutations(workspaceId);
  const [rankMenuOpen, setRankMenuOpen] = useState(false);
  const [conflict, setConflict] = useState<{ rank: RunwayRank; holderKey: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const entry = runwayEntryFor(index, issueKey);
  const focused = entry.focus;
  const rank = entry.focusRank;

  async function runBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch {
      // useJiraRunwayMutations already toasted the error.
    } finally {
      setBusy(false);
    }
  }

  function pickRank(candidate: RunwayRank) {
    setRankMenuOpen(false);
    const decision = decideJiraRank(index, candidate, issueKey);
    if (decision.kind === 'unchanged') return;
    if (decision.kind === 'confirm') {
      setConflict({ rank: candidate, holderKey: decision.holderKey });
      return;
    }
    void runBusy(() => moveRank(issueKey, candidate));
  }

  function confirmMove() {
    if (!conflict) return;
    const { rank: candidate, holderKey } = conflict;
    setConflict(null);
    void runBusy(() => moveRank(issueKey, candidate, holderKey));
  }

  const holderSummary = conflict ? summaryOf?.(conflict.holderKey) : undefined;

  return (
    <span
      className={styles.focusControl}
      data-testid={`jira-focus-control-${issueKey}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`${styles.star} ${size === 'medium' ? styles.starMedium : ''} ${focused ? styles.starActive : ''}`}
        aria-label={focused ? `Remove ${issueKey} from Focus` : `Add ${issueKey} to Focus`}
        aria-pressed={focused}
        onClick={() => void runBusy(() => update(issueKey, { focus: !focused }))}
        disabled={busy || isLoading}
        data-testid={`jira-focus-star-${issueKey}`}
      >
        <Favorite size={size === 'medium' ? 18 : 14} />
      </button>

      {focused && (
        <span className={styles.rankWrap}>
          <button
            type="button"
            className={styles.rankBadge}
            onClick={() => setRankMenuOpen((v) => !v)}
            aria-label={rank ? `Focus rank ${rank}, click to change` : 'Set Focus rank'}
            data-testid={`jira-focus-rank-badge-${issueKey}`}
            disabled={busy}
          >
            {rank ?? '–'}
          </button>

          {rankMenuOpen && (
            <>
              <button
                type="button"
                className={styles.rankMenuBackdrop}
                aria-label="Close rank picker"
                onClick={() => setRankMenuOpen(false)}
              />
              <div className={styles.rankMenu} data-testid={`jira-focus-rank-menu-${issueKey}`}>
                {([1, 2, 3] as const).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={styles.rankMenuItem}
                    onClick={() => pickRank(candidate)}
                    data-testid={`jira-focus-rank-option-${issueKey}-${candidate}`}
                  >
                    {candidate}{candidate === rank ? ' (current)' : ''}
                  </button>
                ))}
                {rank !== null && (
                  <button
                    type="button"
                    className={styles.rankMenuItem}
                    onClick={() => { setRankMenuOpen(false); void runBusy(() => update(issueKey, { focusRank: null })); }}
                    data-testid={`jira-focus-rank-clear-${issueKey}`}
                  >
                    Clear rank
                  </button>
                )}
              </div>
            </>
          )}
        </span>
      )}

      {conflict && (
        <div className={styles.dialogOverlay} data-testid="jira-focus-rank-conflict-dialog">
          <div className={styles.dialog}>
            <Text type="text1" weight="bold">Focus rank {conflict.rank} is already taken</Text>
            <Text type="text2" element="p">
              {conflict.holderKey}{holderSummary ? <> — &ldquo;{holderSummary}&rdquo; —</> : null}
              {' '}currently holds rank {conflict.rank}. Move it to {issueKey} instead?
              {' '}{conflict.holderKey} will become unranked — it stays starred.
            </Text>
            <div className={styles.dialogActions}>
              <Button kind="secondary" onClick={() => setConflict(null)} data-testid="jira-focus-rank-conflict-keep">
                Keep {conflict.holderKey}
              </Button>
              <Button onClick={confirmMove} data-testid="jira-focus-rank-conflict-move">Move rank here</Button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
