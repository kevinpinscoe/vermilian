import React from 'react';
import { ASSIGNEE_PILL_COLOR } from '../project-board/FilterPills';
import { isAlwaysShownStatus } from './jiraBoard';
import pbStyles from '../project-board/ProjectBoard.module.css';

interface JiraStatusPillsProps {
  // Every status the workspace offers, in board order.
  statuses: string[];
  hidden: string[];
  saving: boolean;
  onToggle: (status: string) => void;
}

/**
 * The board's Status filter (VERM-67): one pill per status, lit while its
 * column is shown. In Progress is always shown, so its pill is locked on.
 */
export function JiraStatusPills({ statuses, hidden, saving, onToggle }: JiraStatusPillsProps) {
  if (statuses.length === 0) return null;
  return (
    <div className={pbStyles.filterSection} data-testid="jira-status-filter">
      <span className={pbStyles.filterLabel}>Status</span>
      {statuses.map((status) => {
        const locked = isAlwaysShownStatus(status);
        const shown = locked || !hidden.includes(status);
        return (
          <button
            key={status}
            type="button"
            data-testid="jira-status-pill"
            data-status={status}
            aria-pressed={shown}
            disabled={locked || saving}
            title={locked ? 'In Progress is always shown.' : shown ? `Hide ${status}` : `Show ${status}`}
            className={`${pbStyles.filterPill} ${shown ? pbStyles.filterPillActive : pbStyles.filterPillDim}`}
            style={{ backgroundColor: ASSIGNEE_PILL_COLOR, color: '#fff' }}
            onClick={() => onToggle(status)}
          >
            {status}
          </button>
        );
      })}
    </div>
  );
}
