// Pill filter sections shared by the All tasks board and the Jira workspace
// board (VERM-62). The project board's FilterBar keeps its own FilterSection,
// whose `filter-pill` test ids its specs rely on.
import React from 'react';
import type { BoardIssue } from '../../../shared/workspace';
import { assigneeLabel, assigneeNames, assigneeOptions } from './grouping';
import pbStyles from './ProjectBoard.module.css';

// Assignee pills share one neutral colour — there is no per-person palette.
export const ASSIGNEE_PILL_COLOR = '#676879';

export function FilterPills({
  label, values, active, colorMap, onToggle, displayValue = (v) => v,
}: {
  label: string; values: string[]; active: string[]; colorMap: Record<string, string>;
  onToggle: (v: string) => void; displayValue?: (v: string) => string;
}) {
  if (!values.length) return null;
  const hasActive = active.length > 0;
  return (
    <div className={pbStyles.filterSection}>
      <span className={pbStyles.filterLabel}>{label}</span>
      {values.map((v) => {
        const bg = colorMap[v] ?? '#C4C4C4';
        return (
          <button key={v} type="button"
            data-testid="ws-filter-pill" data-section={label} data-value={v}
            className={`${pbStyles.filterPill} ${active.includes(v) ? pbStyles.filterPillActive : ''} ${hasActive && !active.includes(v) ? pbStyles.filterPillDim : ''}`}
            style={{ backgroundColor: bg, color: '#fff' }}
            onClick={() => onToggle(v)}
          >{displayValue(v)}</button>
        );
      })}
    </div>
  );
}

/** The Assignee section: Me, Unassigned, then the loaded issues' assignees. */
export function AssigneePills({
  issues, myId, active, onToggle,
}: { issues: BoardIssue[]; myId: string; active: string[]; onToggle: (v: string) => void }) {
  const values = assigneeOptions(issues, myId);
  const names = assigneeNames(issues);
  return (
    <FilterPills
      label="Assignee" values={values} active={active}
      colorMap={Object.fromEntries(values.map((v) => [v, ASSIGNEE_PILL_COLOR]))}
      onToggle={onToggle} displayValue={(v) => assigneeLabel(v, names)}
    />
  );
}
