// The All tasks blocker badge (VERM-98): beside a ticket's Runway #, in the
// list and on Kanban cards, shown only when the ticket is Blocked or Unknown.
// The full reason shows on hover and on keyboard focus (the badge is
// focusable, and the reason is also its accessible description). It never
// opens the row: its clicks and keys stay with it.

import React, { useId, useMemo } from 'react';
import type { BoardIssue } from '../../../shared/workspace';
import type { TrackerKind } from '../../../shared/tracker';
import { blockerBadge, issueBlockers } from './blockers';
import { usePrerequisiteTypes, useRunwayRows } from './useBlockers';
import styles from './RunwayBlockerBadge.module.css';

export interface RunwayBlockerBadgeProps {
  workspaceId: string;
  tracker: TrackerKind;
  issue: BoardIssue;
}

export function RunwayBlockerBadge({ workspaceId, tracker, issue }: RunwayBlockerBadgeProps) {
  const prerequisiteTypes = usePrerequisiteTypes(workspaceId, tracker);
  const rows = useRunwayRows(workspaceId);
  const badge = useMemo(() => blockerBadge(issueBlockers(issue, rows, prerequisiteTypes)), [issue, rows, prerequisiteTypes]);
  const reasonId = useId();
  if (!badge) return null;
  return (
    <span
      className={`${styles.badge} ${badge.label === 'Blocked' ? styles.blocked : styles.unknown}`}
      tabIndex={0}
      aria-label={badge.label}
      aria-describedby={reasonId}
      data-testid="blocker-badge"
      data-blocker-state={badge.label === 'Blocked' ? 'blocked' : 'unknown'}
      data-issue-id={issue.idReadable}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {badge.label}
      <span role="tooltip" id={reasonId} className={styles.reason} data-testid="blocker-badge-reason">
        {badge.reason}
      </span>
    </span>
  );
}
