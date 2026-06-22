import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Loader, Text, Heading, Button, Tooltip } from '@vibe/core';
import { Wand, Play } from '@vibe/icons';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { STATUS_OPTIONS, PRIORITY_OPTIONS, CATEGORY_OPTIONS } from '../../../shared/workspace';
import type { BoardSortConfig, ColumnField } from '../../../shared/boardConfig';
import { COLUMN_LABELS } from '../../../shared/boardConfig';
import { STATUS_COLORS, PRIORITY_COLORS, CATEGORY_COLORS } from '../project-board/colors';
import { ChipCell, EffectiveColors, formatDate } from '../project-board/KanbanView';
import { usePatchIssueOnBoard } from '../project-board/api';
import { useTimerStore, fmtMs, getTotalWorkMs } from '../../stores/timer';
import pbStyles from '../project-board/ProjectBoard.module.css';
import styles from './WorkspaceBoard.module.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_ORDER = [
  'To do', 'In Progress', 'Working on it', 'Waiting for IT', 'BLOCKED',
  'Waiting for approval', 'Waiting for customer', 'Waiting on external resource', 'Done',
];

const COLORS: EffectiveColors = {
  Status:   STATUS_COLORS,
  Priority: PRIORITY_COLORS,
  Category: CATEGORY_COLORS,
};

function projectPrefix(idReadable: string): string {
  return idReadable.replace(/-\d+$/, '');
}

function groupByStatus(issues: BoardIssue[]): Array<[string, BoardIssue[]]> {
  const map = new Map<string, BoardIssue[]>();
  for (const issue of issues) {
    const key = issue.fields.status ?? '(No status)';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(issue);
  }
  const result: Array<[string, BoardIssue[]]> = [];
  for (const s of STATUS_ORDER) {
    if (map.has(s)) result.push([s, map.get(s)!]);
  }
  for (const [s, g] of map) {
    if (!STATUS_ORDER.includes(s)) result.push([s, g]);
  }
  return result;
}

function sortIssues(issues: BoardIssue[], sort: BoardSortConfig | undefined): BoardIssue[] {
  if (!sort) return issues;
  const { field, direction } = sort;
  return [...issues].sort((a, b) => {
    const av: string | number | null =
      field === 'summary' ? a.summary
      : field === 'dueDate' || field === 'dateTimeEntered' ? a.fields[field]
      : (a.fields[field as keyof BoardIssueFields] as string | null);
    const bv: string | number | null =
      field === 'summary' ? b.summary
      : field === 'dueDate' || field === 'dateTimeEntered' ? b.fields[field]
      : (b.fields[field as keyof BoardIssueFields] as string | null);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return direction === 'asc' ? cmp : -cmp;
  });
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface WsFilter {
  status: string[];
  priority: string[];
  category: string[];
  assignedToMe: boolean;
}
const EMPTY_FILTER: WsFilter = { status: [], priority: [], category: [], assignedToMe: false };

function FilterPills({
  label, values, active, colorMap, onToggle,
}: { label: string; values: string[]; active: string[]; colorMap: Record<string, string>; onToggle: (v: string) => void }) {
  if (!values.length) return null;
  const hasActive = active.length > 0;
  return (
    <div className={pbStyles.filterSection}>
      <span className={pbStyles.filterLabel}>{label}</span>
      {values.map((v) => {
        const bg = colorMap[v] ?? '#C4C4C4';
        return (
          <button key={v} type="button"
            className={`${pbStyles.filterPill} ${active.includes(v) ? pbStyles.filterPillActive : ''} ${hasActive && !active.includes(v) ? pbStyles.filterPillDim : ''}`}
            style={{ backgroundColor: bg, color: '#fff' }}
            onClick={() => onToggle(v)}
          >{v}</button>
        );
      })}
    </div>
  );
}

// ─── Issue row ────────────────────────────────────────────────────────────────

const VISIBLE_COLS: ColumnField[] = ['status', 'priority', 'category', 'dueDate'];

function IssueRow({
  issue, onClick, onStartTimer, isActiveTimer, timerDisplay, onPatch,
}: {
  issue: BoardIssue; onClick: () => void;
  onStartTimer: (id: string, readable: string, summary: string) => void;
  isActiveTimer: boolean; timerDisplay: string;
  onPatch: (issueId: string, field: string, value: string | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr className={pbStyles.issueRow} onClick={onClick} style={{ cursor: 'pointer' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <td className={`${pbStyles.cell} ${pbStyles.cellTask}`}>
        {isActiveTimer ? (
          <span className={pbStyles.timerBadge}>▶ {timerDisplay}</span>
        ) : (
          <button type="button"
            className={`${pbStyles.playBtn} ${hovered ? pbStyles.playBtnVisible : ''}`}
            onClick={(e) => { e.stopPropagation(); onStartTimer(issue.id, issue.idReadable, issue.summary); }}
            title="Start timer"
          ><Play size={12} /></button>
        )}
        <span className={pbStyles.issueId}>{issue.idReadable}</span>
        <Text type="text2" className={pbStyles.issueSummary}>{issue.summary}</Text>
      </td>
      <td className={pbStyles.cell}>
        <ChipCell value={issue.fields.status} colorMap={COLORS.Status} field="status"
          onEdit={(v) => onPatch(issue.id, 'status', v)} />
      </td>
      <td className={pbStyles.cell}>
        <ChipCell value={issue.fields.priority} colorMap={COLORS.Priority} field="priority"
          onEdit={(v) => onPatch(issue.id, 'priority', v)} />
      </td>
      <td className={pbStyles.cell}>
        <ChipCell value={issue.fields.category} colorMap={COLORS.Category} field="category"
          onEdit={(v) => onPatch(issue.id, 'category', v)} />
      </td>
      <td className={pbStyles.cell}>
        <Text type="text2" className={pbStyles.dateCell}>{formatDate(issue.fields.dueDate)}</Text>
      </td>
    </tr>
  );
}

// ─── Group header ─────────────────────────────────────────────────────────────

function GroupHeader({ label, count, colSpan, expanded, onToggle, color }: {
  label: string; count: number; colSpan: number; expanded: boolean;
  onToggle: () => void; color: string;
}) {
  return (
    <tr className={pbStyles.groupHeaderRow}>
      <td colSpan={colSpan}>
        <button type="button" className={pbStyles.groupHeaderButton} onClick={onToggle}>
          <svg width="10" height="10" viewBox="0 0 10 10"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, color: 'var(--secondary-text-color, #444444)' }}>
            <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={pbStyles.groupDot} style={{ backgroundColor: color }} />
          <Text type="text1" weight="medium">{label}</Text>
          <span className={pbStyles.groupCount}>{count}</span>
        </button>
      </td>
    </tr>
  );
}

// ─── WorkspaceBoard ───────────────────────────────────────────────────────────

interface WorkspaceBoardProps {
  workspaceName: string;
  projectShortNames: string[];
  youtrackLogin: string;
  onSelectIssue: (issueId: string) => void;
  onNewTask: () => void;
  onAiCreate: () => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  hasClaudeKey: boolean;
}

export function WorkspaceBoard({
  workspaceName, projectShortNames, youtrackLogin,
  onSelectIssue, onNewTask, onAiCreate, onStartTimer, hasClaudeKey,
}: WorkspaceBoardProps) {
  const patchMutation = usePatchIssueOnBoard(null);
  const [filter, setFilter] = useState<WsFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<BoardSortConfig | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const timer = useTimerStore((s) => s.timer);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!timer?.phaseStartedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timer?.issueId, timer?.phaseStartedAt]);

  const [showClosed, setShowClosed] = useState(false);

  const results = useQueries({
    queries: projectShortNames.map((sn) => ({
      queryKey: showClosed ? ['youtrack', 'issues', sn, 'all'] : ['youtrack', 'issues', sn],
      queryFn: () => window.vermilian.getIssues({ projectShortName: sn, includeResolved: showClosed }),
      staleTime: 60_000,
    })),
  });

  const isLoading = results.some((r) => r.isLoading) && results.every((r) => !r.data);
  const allIssues: BoardIssue[] = useMemo(() =>
    results.flatMap((r) => r.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results.map((r) => r.dataUpdatedAt).join(',')],
  );

  const filteredIssues = useMemo(() => {
    let items = allIssues; // server already applied #Unresolved when showClosed=false
    if (filter.status.length) items = items.filter((i) => filter.status.includes(i.fields.status ?? ''));
    if (filter.priority.length) items = items.filter((i) => filter.priority.includes(i.fields.priority ?? ''));
    if (filter.category.length) items = items.filter((i) => filter.category.includes(i.fields.category ?? ''));
    if (filter.assignedToMe && youtrackLogin) {
      items = items.filter((i) => i.fields.assignee === youtrackLogin);
    }
    return items;
  }, [allIssues, filter, youtrackLogin, showClosed]);

  const groups = useMemo(() => groupByStatus(filteredIssues), [filteredIssues]);

  function handlePatch(issueId: string, field: string, value: string | null) {
    patchMutation.mutate({ issueId, field, value });
  }

  function handleSort(field: ColumnField) {
    setSort((cur) =>
      cur?.field === field
        ? { field, direction: cur.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' },
    );
  }

  function toggle(field: keyof Omit<WsFilter, 'assignedToMe'>, value: string) {
    const cur = filter[field];
    setFilter((f) => ({
      ...f,
      [field]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    }));
  }

  function SortTh({ field, label, className }: { field: ColumnField; label: string; className?: string }) {
    const active = sort?.field === field;
    return (
      <th className={`${pbStyles.th} ${pbStyles.thSortable} ${className ?? ''}`} onClick={() => handleSort(field)}>
        {label}<span className={pbStyles.sortIcon}>{active ? (sort!.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
      </th>
    );
  }

  const statusVals = [...new Set(allIssues.map((i) => i.fields.status).filter(Boolean) as string[])];
  const priorityVals = [...new Set(allIssues.map((i) => i.fields.priority).filter(Boolean) as string[])];
  const categoryVals = [...new Set(allIssues.map((i) => i.fields.category).filter(Boolean) as string[])];
  const hasFilters = filter.status.length > 0 || filter.priority.length > 0 || filter.category.length > 0 || filter.assignedToMe;
  const colSpan = 1 + VISIBLE_COLS.length;

  return (
    <div className={pbStyles.board} style={{ position: 'relative' }}>
      {/* Header */}
      <div className={pbStyles.boardHeader}>
        <div className={pbStyles.boardTitleRow}>
          <Heading type="h3" weight="bold" className={pbStyles.boardTitle}>
            {workspaceName} — All tasks
          </Heading>
        </div>
      </div>

      {/* Toolbar */}
      <div className={pbStyles.toolbar}>
        <Button size="small" onClick={onNewTask}>New task</Button>
        <Tooltip content={hasClaudeKey ? 'AI create task' : 'Configure a Claude API key in Settings to use AI task creation.'}>
          <Button size="small" kind="secondary" onClick={onAiCreate} disabled={!hasClaudeKey} leftIcon={Wand}>
            AI create
          </Button>
        </Tooltip>
        <div className={pbStyles.toolbarSpacer} />
        {youtrackLogin && (
          <button
            type="button"
            className={`${styles.assignedBtn} ${filter.assignedToMe ? styles.assignedBtnActive : ''}`}
            onClick={() => setFilter((f) => ({ ...f, assignedToMe: !f.assignedToMe }))}
            title={`Show only tasks assigned to ${youtrackLogin}`}
          >
            Assigned to me
          </button>
        )}
        <button
          type="button"
          className={`${styles.assignedBtn} ${showClosed ? styles.assignedBtnActive : ''}`}
          onClick={() => setShowClosed((s) => !s)}
          title={showClosed ? 'Hide closed issues' : 'Show closed issues'}
        >
          {showClosed ? 'Hide closed' : 'Show closed'}
        </button>
        <Text type="text2" className={styles.issueCount}>
          {filteredIssues.length} {showClosed ? 'issues' : 'open'}
        </Text>
      </div>

      {/* Filter bar */}
      {(statusVals.length > 0 || priorityVals.length > 0 || categoryVals.length > 0) && (
        <div className={pbStyles.filterBar}>
          <FilterPills label="Status"   values={statusVals.filter((v) => STATUS_OPTIONS.includes(v as never))} active={filter.status}   colorMap={COLORS.Status}   onToggle={(v) => toggle('status', v)} />
          {statusVals.length > 0 && priorityVals.length > 0 && <span className={pbStyles.filterSep} />}
          <FilterPills label="Priority" values={priorityVals.filter((v) => PRIORITY_OPTIONS.includes(v as never))} active={filter.priority} colorMap={COLORS.Priority} onToggle={(v) => toggle('priority', v)} />
          {priorityVals.length > 0 && categoryVals.length > 0 && <span className={pbStyles.filterSep} />}
          <FilterPills label="Category" values={categoryVals.filter((v) => CATEGORY_OPTIONS.includes(v as never))} active={filter.category} colorMap={COLORS.Category} onToggle={(v) => toggle('category', v)} />
          {hasFilters && (
            <button type="button" className={pbStyles.filterClear} onClick={() => setFilter(EMPTY_FILTER)}>Clear</button>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && <div className={pbStyles.loaderWrap}><Loader size={40} /></div>}

      {/* Table */}
      {!isLoading && (
        <div className={pbStyles.tableWrapper}>
          {groups.length === 0 ? (
            <div className={pbStyles.emptyState}>
              <Text>{projectShortNames.length === 0 ? 'No projects in this workspace.' : 'No open tasks.'}</Text>
            </div>
          ) : (
            <table className={pbStyles.table}>
              <thead>
                <tr className={pbStyles.headerRow}>
                  <SortTh field="summary"  label={COLUMN_LABELS.summary}  className={pbStyles.thTask} />
                  <SortTh field="status"   label={COLUMN_LABELS.status} />
                  <SortTh field="priority" label={COLUMN_LABELS.priority} />
                  <SortTh field="category" label={COLUMN_LABELS.category} />
                  <SortTh field="dueDate"  label={COLUMN_LABELS.dueDate} />
                </tr>
              </thead>
              <tbody>
                {groups.map(([status, groupIssues]) => {
                  const exp = !collapsed.has(status);
                  const sorted = sortIssues(groupIssues, sort);
                  return (
                    <React.Fragment key={status}>
                      <GroupHeader
                        label={status} count={groupIssues.length} colSpan={colSpan}
                        expanded={exp} onToggle={() => setCollapsed((s) => { const n = new Set(s); n.has(status) ? n.delete(status) : n.add(status); return n; })}
                        color={COLORS.Status[status] ?? '#C4C4C4'}
                      />
                      {exp && sorted.map((issue) => {
                        const isActive = timer?.issueId === issue.id;
                        return (
                          <IssueRow
                            key={issue.id} issue={issue}
                            onClick={() => onSelectIssue(issue.id)}
                            onStartTimer={onStartTimer}
                            isActiveTimer={isActive}
                            timerDisplay={isActive && timer ? fmtMs(getTotalWorkMs(timer)) : ''}
                            onPatch={handlePatch}
                          />
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
