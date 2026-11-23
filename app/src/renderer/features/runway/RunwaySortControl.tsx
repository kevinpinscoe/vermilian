// The sort control (VERM-92/93): Runway #, Tracker priority or Ticket ID,
// ascending or descending, and Clear sort. Used by YouTrack's All tasks
// table, Jira's All tasks board and the Kanban view of YouTrack project
// boards; each caller decides what the sort applies to and where it is
// remembered.

import React from 'react';
import type { RunwaySort, RunwaySortKey, SortDirection } from '../../../shared/runwaySort';
import styles from './RunwaySortControl.module.css';

export const RUNWAY_SORT_LABELS: Record<RunwaySortKey, string> = {
  runwayNumber: 'Runway #',
  priority: 'Tracker priority',
  ticketId: 'Ticket ID',
};

export interface RunwaySortControlProps {
  /** The Runway sort on screen; null when none is. */
  selected: RunwaySort | null;
  /** The first option's label, shown when no Runway sort is on screen. */
  noneLabel: string;
  /** Whether Clear sort is offered. */
  clearable: boolean;
  /** Test id prefix: `<prefix>-control`, `-select`, `-direction`, `-clear`. */
  testIdPrefix: string;
  onChooseKey: (key: RunwaySortKey) => void;
  onChooseDirection: (direction: SortDirection) => void;
  onClear: () => void;
}

export function RunwaySortControl({
  selected, noneLabel, clearable, testIdPrefix, onChooseKey, onChooseDirection, onClear,
}: RunwaySortControlProps) {
  return (
    <div className={styles.sortControl} data-testid={`${testIdPrefix}-control`}>
      <label className={styles.sortLabel}>
        Sort
        <select
          className={styles.sortSelect}
          data-testid={`${testIdPrefix}-select`}
          value={selected ? selected.key : ''}
          onChange={(e) => (e.target.value ? onChooseKey(e.target.value as RunwaySortKey) : onClear())}
        >
          <option value="">{noneLabel}</option>
          {(Object.keys(RUNWAY_SORT_LABELS) as RunwaySortKey[]).map((k) => (
            <option key={k} value={k}>{RUNWAY_SORT_LABELS[k]}</option>
          ))}
        </select>
      </label>
      {selected && (
        <button
          type="button"
          className={styles.sortButton}
          data-testid={`${testIdPrefix}-direction`}
          data-direction={selected.direction}
          onClick={() => onChooseDirection(selected.direction === 'asc' ? 'desc' : 'asc')}
          title={selected.direction === 'asc' ? 'Ascending: click for descending' : 'Descending: click for ascending'}
        >
          {selected.direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
        </button>
      )}
      {clearable && (
        <button type="button" className={styles.sortButton} data-testid={`${testIdPrefix}-clear`} onClick={onClear}>
          Clear sort
        </button>
      )}
    </div>
  );
}
