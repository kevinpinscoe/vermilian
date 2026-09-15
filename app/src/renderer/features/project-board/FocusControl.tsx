// The Focus star + rank badge — the "low-friction editable toggle" required
// by docs/requirements.md § Priority Desk (VERM-4, ADR-0007). One component,
// reused as-is in board rows (ProjectBoard.tsx), Kanban cards (KanbanView.tsx),
// and the task detail panel (TaskDetailPanel.tsx) so the three surfaces can
// never drift on how Focus/Focus rank are edited or how the rank invariant is
// enforced.
import React, { useState } from 'react';
import { Text, Button } from '@vibe/core';
import { Favorite } from '@vibe/icons';
import type { BoardIssue } from '../../../shared/workspace';
import {
  useWorkspaceFocusRankHolders,
  useFocusMutations,
  decideRankAssignment,
  type FocusRank,
  type FocusRankHolder,
} from './focus';
import styles from './FocusControl.module.css';

interface FocusControlProps {
  issue: BoardIssue;
  projectShortName: string;
  size?: 'small' | 'medium';
}

export function FocusControl({ issue, projectShortName, size = 'small' }: FocusControlProps) {
  const { byRank } = useWorkspaceFocusRankHolders();
  const { toggleFocus, setRank, clearRank } = useFocusMutations();
  const [rankMenuOpen, setRankMenuOpen] = useState(false);
  const [conflict, setConflict] = useState<{ rank: FocusRank; holder: FocusRankHolder } | null>(null);
  const [busy, setBusy] = useState(false);

  const focused = issue.fields.focus === 'Yes';
  const rank = issue.fields.focusRank as FocusRank | null;

  async function runBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch {
      // useFocusMutations already toasted the error; nothing further to do.
    } finally {
      setBusy(false);
    }
  }

  function handleStarClick(e: React.MouseEvent) {
    e.stopPropagation();
    void runBusy(() => toggleFocus(issue.id, projectShortName, focused));
  }

  function handleRankBadgeClick(e: React.MouseEvent) {
    e.stopPropagation();
    setRankMenuOpen((v) => !v);
  }

  function pickRank(candidate: FocusRank) {
    setRankMenuOpen(false);
    const decision = decideRankAssignment(byRank, candidate, issue.id);
    if (decision.kind === 'blocked') return; // menu item is disabled for this case
    if (decision.kind === 'confirm') {
      setConflict({ rank: candidate, holder: decision.holder });
      return;
    }
    void runBusy(() => setRank({ issueId: issue.id, projectShortName }, candidate));
  }

  function confirmDisplace() {
    if (!conflict) return;
    const { rank: candidate, holder } = conflict;
    setConflict(null);
    void runBusy(() => setRank({ issueId: issue.id, projectShortName }, candidate, holder));
  }

  function handleClearRank(e: React.MouseEvent) {
    e.stopPropagation();
    setRankMenuOpen(false);
    void runBusy(() => clearRank(issue.id, projectShortName));
  }

  return (
    <span className={styles.focusControl} data-testid={`focus-control-${issue.id}`}>
      <button
        type="button"
        className={`${styles.star} ${size === 'medium' ? styles.starMedium : ''} ${focused ? styles.starActive : ''}`}
        aria-label={focused ? `Remove ${issue.idReadable} from Focus` : `Add ${issue.idReadable} to Focus`}
        aria-pressed={focused}
        onClick={handleStarClick}
        disabled={busy}
        data-testid={`focus-star-${issue.id}`}
      >
        <Favorite size={size === 'medium' ? 18 : 14} />
      </button>

      {focused && (
        <span className={styles.rankWrap}>
          <button
            type="button"
            className={styles.rankBadge}
            onClick={handleRankBadgeClick}
            aria-label={rank ? `Focus rank ${rank}, click to change` : 'Set Focus rank'}
            data-testid={`focus-rank-badge-${issue.id}`}
            disabled={busy}
          >
            {rank ?? '–'}
          </button>

          {rankMenuOpen && (
            <>
              {/* Click-outside dismiss — a plain backdrop rather than a
                  document listener, consistent with the rest of the app's
                  inline-edit popovers (see TaskDetailPanel's onBlur pattern). */}
              <button
                type="button"
                className={styles.rankMenuBackdrop}
                aria-label="Close rank picker"
                onClick={(e) => { e.stopPropagation(); setRankMenuOpen(false); }}
              />
              <div className={styles.rankMenu} data-testid={`focus-rank-menu-${issue.id}`}>
                {([1, 2, 3] as const).map((candidate) => {
                  const decision = decideRankAssignment(byRank, candidate, issue.id);
                  const blocked = decision.kind === 'blocked';
                  return (
                    <button
                      key={candidate}
                      type="button"
                      className={styles.rankMenuItem}
                      disabled={blocked}
                      title={blocked
                        ? 'Two or more issues already share this rank — use the repair banner above the board'
                        : undefined}
                      onClick={(e) => { e.stopPropagation(); pickRank(candidate); }}
                      data-testid={`focus-rank-option-${issue.id}-${candidate}`}
                    >
                      {candidate}{candidate === rank ? ' (current)' : ''}
                    </button>
                  );
                })}
                {rank !== null && (
                  <button
                    type="button"
                    className={styles.rankMenuItem}
                    onClick={handleClearRank}
                    data-testid={`focus-rank-clear-${issue.id}`}
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
        <div className={styles.dialogOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.dialog}>
            <Text type="text1" weight="bold">Focus rank {conflict.rank} is already taken</Text>
            <Text type="text2">
              {conflict.holder.issue.idReadable} — &ldquo;{conflict.holder.issue.summary}&rdquo; — currently
              holds rank {conflict.rank}. Give this rank to {issue.idReadable} instead? {conflict.holder.issue.idReadable}
              {' '}will become unranked (it stays starred).
            </Text>
            <div className={styles.dialogActions}>
              <Button kind="secondary" onClick={() => setConflict(null)}>Keep {conflict.holder.issue.idReadable}</Button>
              <Button onClick={confirmDisplace}>Move rank here</Button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
