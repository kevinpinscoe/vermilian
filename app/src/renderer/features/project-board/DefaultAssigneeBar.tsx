import React, { useEffect, useMemo } from 'react';
import { useDefaultAssigneeStore } from '../../stores/defaultAssignee';
import type { BoardIssue } from '../../../shared/workspace';
import { defaultAssigneeView, type DefaultAssigneeView } from './defaultAssignee';
import styles from './DefaultAssigneeBar.module.css';

/** The board's Default assignee view (VERM-68), and the toggle that widens it. */
export function useDefaultAssignee(workspaceId: string, defaultAssignee: string, issues: readonly BoardIssue[], myId: string) {
  const showAllFor = useDefaultAssigneeStore((s) => s.showAllFor);
  const setShowAllFor = useDefaultAssigneeStore((s) => s.setShowAllFor);

  // Switching workspace returns to the Default assignee.
  useEffect(() => {
    if (showAllFor !== null && showAllFor !== workspaceId) setShowAllFor(null);
  }, [showAllFor, setShowAllFor, workspaceId]);

  const showAll = showAllFor === workspaceId;
  const view = useMemo(
    () => defaultAssigneeView(defaultAssignee, showAll, issues, myId),
    [defaultAssignee, showAll, issues, myId],
  );
  return { view, toggleShowAll: () => setShowAllFor(showAll ? null : workspaceId) };
}

export function DefaultAssigneeBar({ view, onToggle }: { view: DefaultAssigneeView; onToggle: () => void }) {
  if (view.mode === 'off') return null;
  if (view.mode === 'unmatched') {
    return (
      <div className={styles.bar} role="status" data-testid="default-assignee-unmatched">
        No loaded issue is assigned to your Default assignee, so everyone&apos;s issues are shown. Check it in Settings.
      </div>
    );
  }
  const mine = view.mode === 'mine';
  return (
    <div className={styles.bar} data-testid="default-assignee-bar">
      {mine && <span data-testid="default-assignee-note">Showing only your issues.</span>}
      <button type="button" className={styles.toggle} aria-pressed={!mine} onClick={onToggle} data-testid="default-assignee-toggle">
        {mine ? 'Show all assignees' : 'Show only my issues'}
      </button>
    </div>
  );
}
