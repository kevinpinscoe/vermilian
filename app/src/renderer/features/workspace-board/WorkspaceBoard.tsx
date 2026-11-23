import React, { useEffect, useState, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Loader, Text, Heading, Button, Tooltip } from '@vibe/core';
import { Wand, Play } from '@vibe/icons';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { STATUS_OPTIONS, PRIORITY_OPTIONS, CATEGORY_OPTIONS } from '../../../shared/workspace';
import type { BoardSortConfig, ColumnField } from '../../../shared/boardConfig';
import { COLUMN_LABELS } from '../../../shared/boardConfig';
import { STATUS_COLORS, PRIORITY_COLORS, CATEGORY_COLORS } from '../project-board/colors';
import { ChipCell, EffectiveColors, formatDate } from '../project-board/KanbanView';
import { usePatchIssueOnBoard } from '../project-board/api';
import {
  ASSIGNEE_ME, EMPTY_FILTER, applyFilter, filterCount, type FilterState,
} from '../project-board/grouping';
import { FilterPills, AssigneePills, DefaultAssigneePill } from '../project-board/FilterPills';
import { DefaultAssigneeBar, useDefaultAssignee } from '../project-board/DefaultAssigneeBar';
import { defaultAssigneeFilter } from '../project-board/defaultAssignee';
import { BoardSearch } from '../search/BoardSearch';
import { useTimerStore, fmtMs, getTotalWorkMs } from '../../stores/timer';
import { RUNWAY_TICKETS_QUERY_KEY, useRunwayItems, useRunwayTickets } from '../runway/api';
import { allTasksEmptyNotice, savedRunwayTicketIds, withRunwayTickets } from '../runway/allTasks';
import { useWorkspaceStore } from '../../stores/workspace';
import { RunwayNumberCell } from '../runway/RunwayNumberCell';
import { useRememberedSort } from '../runway/rememberedSort';
import { useRunwayNumberOf } from '../runway/useRunwayNumberOf';
import { useYouTrackPriorityOrders } from '../runway/usePriorityOrders';
import { RunwaySortControl } from '../runway/RunwaySortControl';
import {
  activeAllTasksSort, allTasksSortAction, headerSortDirection, projectIssuesKey, projectsOfTickets, sortAllTasksFlat,
  type AllTasksSortAction,
} from './allTasksSort';
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
// The project board's FilterState and applyFilter (VERM-62): status, priority,
// category, assignee and the board search's text (VERM-61). Due date stays
// 'any' here — this board has no due-date control.

// ─── Issue row ────────────────────────────────────────────────────────────────

const VISIBLE_COLS: ColumnField[] = ['status', 'priority', 'category', 'dueDate'];

function IssueRow({
  issue, onClick, onStartTimer, isActiveTimer, timerDisplay, onPatch, runwayWorkspaceId,
}: {
  issue: BoardIssue; onClick: () => void;
  /** The workspace whose Runway # the row shows (VERM-90); null shows no Runway # cell. */
  runwayWorkspaceId: string | null;
  onStartTimer: (id: string, readable: string, summary: string) => void;
  isActiveTimer: boolean; timerDisplay: string;
  onPatch: (issueId: string, field: string, value: string | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr className={pbStyles.issueRow} onClick={onClick} style={{ cursor: 'pointer' }}
      data-testid="ws-issue-row" data-issue-id={issue.idReadable}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {runwayWorkspaceId && (
        <td className={`${pbStyles.cell} ${styles.runwayCell}`}>
          <RunwayNumberCell
            workspaceId={runwayWorkspaceId}
            ticket={{ tracker: 'youtrack', keys: [issue.idReadable], entityId: issue.id }}
            displayKey={issue.idReadable}
          />
        </td>
      )}
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
    <tr className={pbStyles.groupHeaderRow} data-testid="ws-group-header" data-status={label}>
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
  workspaceId: string;
  // This workspace's Default assignee on this computer (VERM-68); '' for none.
  defaultAssignee: string;
  onSelectIssue: (issueId: string) => void;
  onNewTask: () => void;
  onAiCreate: () => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  hasClaudeKey: boolean;
  // Why AI is off for the active workspace (VERM-47); shown as the tooltip.
  aiUnavailableReason?: string | null;
}

export function WorkspaceBoard({
  workspaceName, projectShortNames, youtrackLogin, workspaceId, defaultAssignee,
  onSelectIssue, onNewTask, onAiCreate, onStartTimer, hasClaudeKey, aiUnavailableReason,
}: WorkspaceBoardProps) {
  const patchMutation = usePatchIssueOnBoard(null);
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  // The sort (VERM-92): this workspace's remembered Runway sort from
  // app-config.json, and a temporary header sort for this session only.
  const [tempSort, setTempSort] = useState<{ workspaceId: string; sort: BoardSortConfig } | null>(null);
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

  // Keyed by project as well as time (projectIssuesKey): keyed on the times
  // alone, a workspace switch could keep the previous workspace's issues.
  const projectIssues: BoardIssue[] = useMemo(() =>
    results.flatMap((r) => r.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectIssuesKey(projectShortNames, showClosed, results.map((r) => r.dataUpdatedAt))],
  );

  // Plus the tickets added to this workspace's Runway from outside its
  // projects (VERM-89), read on the workspace's own connection — the Runway
  // view's own query and cache. Each ticket once; a resolved one follows
  // Show closed like a project ticket; an unreadable one is left to the
  // Runway view. A failed Runway read leaves the project issues as they are.
  // Only reads of rows still saved count, so a removed ticket leaves at once.
  const queryClient = useQueryClient();
  const runwayItems = useRunwayItems(workspaceId || null);
  const runwayTickets = useRunwayTickets(workspaceId || null);
  const runwayReads = runwayTickets.data?.ok ? runwayTickets.data.tickets : null;
  const savedIds = useMemo(
    () => savedRunwayTicketIds(runwayItems.data?.ok ? runwayItems.data.items : null),
    [runwayItems.data],
  );
  const { issues: allIssues, runwayOnlyIds, hiddenResolved, unreadable } = useMemo(
    () => withRunwayTickets(projectIssues, runwayReads, showClosed, savedIds),
    [projectIssues, runwayReads, showClosed, savedIds],
  );
  const openRunway = useWorkspaceStore((s) => s.openRunway);
  const emptyNotice = allTasksEmptyNotice({
    hiddenResolved,
    unreadable,
    lookupFailed: Boolean(savedIds && savedIds.size > 0) && runwayTickets.data?.ok === false,
    closedWord: 'closed',
  });
  const isLoading = projectShortNames.length > 0
    ? results.some((r) => r.isLoading) && results.every((r) => !r.data)
    : Boolean(workspaceId) && runwayTickets.isPending;

  // The server already applied #Unresolved when showClosed=false.
  const { view: assigneeView, toggleShowAll } = useDefaultAssignee(workspaceId, defaultAssignee, allIssues, youtrackLogin);
  const effectiveFilter = useMemo(() => defaultAssigneeFilter(filter, assigneeView), [filter, assigneeView]);
  const filteredIssues = useMemo(
    () => applyFilter(allIssues, effectiveFilter, youtrackLogin),
    [allIssues, effectiveFilter, youtrackLogin],
  );
  // How many loaded issues the search text alone matches — with none, the
  // board search asks the backend without waiting for Enter (VERM-61). Issues
  // the Default assignee hides do not count, so a search still finds them.
  const searchMatchCount = useMemo(
    () => applyFilter(allIssues, defaultAssigneeFilter({ ...EMPTY_FILTER, search: filter.search }, assigneeView), youtrackLogin).length,
    [allIssues, filter.search, assigneeView, youtrackLogin],
  );

  const groups = useMemo(() => groupByStatus(filteredIssues), [filteredIssues]);

  function handlePatch(issueId: string, field: string, value: string | null) {
    // A Runway ticket from outside the projects lives in the Runway's cache:
    // re-read it once the edit is saved, so its row shows the new value.
    const fromRunway = runwayOnlyIds.has(issueId);
    patchMutation.mutate({ issueId, field, value }, {
      onSettled: () => {
        if (fromRunway) void queryClient.invalidateQueries({ queryKey: RUNWAY_TICKETS_QUERY_KEY(workspaceId) });
      },
    });
  }

  // The remembered sort is per workspace; a temporary header sort belongs to
  // the workspace it was chosen in, so switching workspace drops it.
  const remembered = useRememberedSort(workspaceId, 'allTasksSorts');
  const savedSort = remembered.saved;
  const temp = tempSort && tempSort.workspaceId === workspaceId ? tempSort.sort : null;
  const sortState = { saved: savedSort, temp };
  const activeSort = activeAllTasksSort(sortState);

  // A sort change saves at most this workspace's entry in app-config.json —
  // never a Runway position, never a tracker field. The config cache is
  // updated first so the table follows the choice at once.
  function applySort(action: AllTasksSortAction) {
    const r = allTasksSortAction(sortState, action);
    setTempSort(r.temp ? { workspaceId, sort: r.temp } : null);
    if (r.save !== undefined) remembered.save(r.save);
  }

  // Each project's configured Priority bundle order (VERM-92), read on the
  // workspace's own connection while the Tracker priority sort is on — for
  // every project the visible tickets come from, outside Runway tickets'
  // projects included. Until it answers (or for a project it cannot read)
  // those tickets rank as unknown.
  const priorityProjects = useMemo(() => projectsOfTickets(filteredIssues), [filteredIssues]);
  const priorityOrderMap = useYouTrackPriorityOrders(
    workspaceId,
    priorityProjects,
    activeSort?.kind === 'runway' && activeSort.sort.key === 'priority',
  );

  function handleSort(field: ColumnField | 'runwayNumber') {
    applySort({ type: 'header', field });
  }

  // A ticket's Runway # on this workspace's Runway; null when it has none or
  // its position cannot be verified (both sort last).
  const runwayNumberOf = useRunwayNumberOf(workspaceId, 'youtrack');

  function toggle(field: 'status' | 'priority' | 'category' | 'assignee', value: string) {
    const cur = filter[field];
    setFilter((f) => ({
      ...f,
      [field]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    }));
  }

  function SortTh({ field, label, className, testId }: { field: ColumnField | 'runwayNumber'; label: string; className?: string; testId?: string }) {
    const direction = headerSortDirection(activeSort, field);
    return (
      <th className={`${pbStyles.th} ${pbStyles.thSortable} ${className ?? ''}`} onClick={() => handleSort(field)}
        data-testid={testId ?? `ws-sort-header-${field}`} aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}>
        {label}<span className={pbStyles.sortIcon}>{direction ? (direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
      </th>
    );
  }

  function renderRow(issue: BoardIssue) {
    const isActive = timer?.issueId === issue.id;
    return (
      <IssueRow
        key={issue.id} issue={issue}
        onClick={() => onSelectIssue(issue.id)}
        onStartTimer={onStartTimer}
        isActiveTimer={isActive}
        timerDisplay={isActive && timer ? fmtMs(getTotalWorkMs(timer)) : ''}
        onPatch={handlePatch}
        runwayWorkspaceId={workspaceId || null}
      />
    );
  }

  const statusVals = [...new Set(allIssues.map((i) => i.fields.status).filter(Boolean) as string[])];
  const priorityVals = [...new Set(allIssues.map((i) => i.fields.priority).filter(Boolean) as string[])];
  const categoryVals = [...new Set(allIssues.map((i) => i.fields.category).filter(Boolean) as string[])];
  const assignedToMe = filter.assignee.includes(ASSIGNEE_ME);
  // The search text has its own clear (Escape); Clear resets the pills only.
  const hasFilters = filterCount({ ...filter, search: '' }) > 0;
  const colSpan = (workspaceId ? 2 : 1) + VISIBLE_COLS.length;

  return (
    <div className={pbStyles.board} style={{ position: 'relative' }} data-testid="workspace-board">
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
        <Tooltip content={hasClaudeKey ? 'AI create task' : (aiUnavailableReason ?? 'Checking whether AI is available for this workspace…')}>
          <Button size="small" kind="secondary" onClick={onAiCreate} disabled={!hasClaudeKey} leftIcon={Wand}>
            AI create
          </Button>
        </Tooltip>
        <div className={pbStyles.toolbarSpacer} />
        {youtrackLogin && assigneeView.mode !== 'mine' && (
          <button
            type="button"
            className={`${styles.assignedBtn} ${assignedToMe ? styles.assignedBtnActive : ''}`}
            onClick={() => toggle('assignee', ASSIGNEE_ME)}
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
        {workspaceId && (
          <RunwaySortControl
            selected={activeSort?.kind === 'runway' ? activeSort.sort : null}
            noneLabel={activeSort?.kind === 'header' ? 'Column header' : 'Status sections'}
            clearable={activeSort !== null}
            testIdPrefix="ws-sort"
            onChooseKey={(key) => applySort({ type: 'chooseKey', key })}
            onChooseDirection={(direction) => applySort({ type: 'chooseDirection', direction })}
            onClear={() => applySort({ type: 'clear' })}
          />
        )}
        <Text type="text2" className={styles.issueCount} data-testid="ws-issue-count">
          {filteredIssues.length !== allIssues.length ? `${filteredIssues.length} of ${allIssues.length}` : filteredIssues.length} {showClosed ? 'issues' : 'open'}
        </Text>
      </div>

      {/* Board search (VERM-61) */}
      <div className={styles.searchRow}>
        <BoardSearch
          value={filter.search}
          onChange={(search) => setFilter((f) => ({ ...f, search }))}
          localMatchCount={searchMatchCount}
          scope={{ kind: 'youtrack', projectShortNames }}
          onSelectIssue={(issue) => onSelectIssue(issue.id)}
          placeholder={`Search ${workspaceName} by key or text  ( / )`}
        />
      </div>

      <DefaultAssigneeBar view={assigneeView} onToggle={toggleShowAll} />

      {/* Filter bar */}
      {allIssues.length > 0 && (
        <div className={pbStyles.filterBar} data-testid="ws-filter-bar">
          <FilterPills label="Status"   values={statusVals.filter((v) => STATUS_OPTIONS.includes(v as never))} active={filter.status}   colorMap={COLORS.Status}   onToggle={(v) => toggle('status', v)} />
          {statusVals.length > 0 && priorityVals.length > 0 && <span className={pbStyles.filterSep} />}
          <FilterPills label="Priority" values={priorityVals.filter((v) => PRIORITY_OPTIONS.includes(v as never))} active={filter.priority} colorMap={COLORS.Priority} onToggle={(v) => toggle('priority', v)} />
          {priorityVals.length > 0 && categoryVals.length > 0 && <span className={pbStyles.filterSep} />}
          <FilterPills label="Category" values={categoryVals.filter((v) => CATEGORY_OPTIONS.includes(v as never))} active={filter.category} colorMap={COLORS.Category} onToggle={(v) => toggle('category', v)} />
          <span className={pbStyles.filterSep} />
          {assigneeView.mode === 'mine' ? (
            <DefaultAssigneePill issues={allIssues} value={assigneeView.value} onToggle={toggleShowAll} />
          ) : (
            <AssigneePills issues={allIssues} myId={youtrackLogin} active={filter.assignee} onToggle={(v) => toggle('assignee', v)} />
          )}
          {hasFilters && (
            <button type="button" className={pbStyles.filterClear} onClick={() => setFilter((f) => ({ ...EMPTY_FILTER, search: f.search }))}>Clear</button>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && <div className={pbStyles.loaderWrap}><Loader size={40} /></div>}

      {/* Table */}
      {!isLoading && (
        <div className={pbStyles.tableWrapper}>
          {groups.length === 0 ? (
            <div className={pbStyles.emptyState} data-testid="ws-empty">
              {allIssues.length === 0 && emptyNotice ? (
                // Runway tickets All tasks cannot show (VERM-89): closed ones
                // the toggle hides, unreadable ones, or a failed Runway lookup,
                // each with its way out.
                <div className={styles.emptyNotice}>
                  {emptyNotice.lines.map((line) => <Text key={line}>{line}</Text>)}
                  <div className={styles.emptyActions}>
                    {emptyNotice.showToggle && (
                      <button
                        type="button"
                        className={styles.assignedBtn}
                        data-testid="ws-empty-show-closed"
                        onClick={() => setShowClosed(true)}
                      >
                        Show closed
                      </button>
                    )}
                    {emptyNotice.openRunway && (
                      <button
                        type="button"
                        className={styles.assignedBtn}
                        data-testid="ws-empty-open-runway"
                        onClick={openRunway}
                      >
                        Open Runway
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <Text>{allIssues.length > 0 ? 'No tasks match your filters.' : projectShortNames.length === 0 ? 'No projects in this workspace.' : 'No open tasks.'}</Text>
              )}
            </div>
          ) : (
            <table className={pbStyles.table}>
              <thead>
                <tr className={pbStyles.headerRow}>
                  {/* Runway # (VERM-90); a click chooses the Runway # sort (VERM-92). */}
                  {workspaceId && <SortTh field="runwayNumber" label="Runway #" className={styles.thRunway} testId="ws-runway-header" />}
                  <SortTh field="summary"  label={COLUMN_LABELS.summary}  className={pbStyles.thTask} />
                  <SortTh field="status"   label={COLUMN_LABELS.status} />
                  <SortTh field="priority" label={COLUMN_LABELS.priority} />
                  <SortTh field="category" label={COLUMN_LABELS.category} />
                  <SortTh field="dueDate"  label={COLUMN_LABELS.dueDate} />
                </tr>
              </thead>
              <tbody>
                {activeSort?.kind === 'runway' ? (
                  // A Runway sort lists every visible ticket as one flat list
                  // (VERM-92), so Runway # reads straight down across statuses.
                  sortAllTasksFlat(filteredIssues, activeSort.sort, runwayNumberOf, priorityOrderMap).map((issue) => renderRow(issue))
                ) : groups.map(([status, groupIssues]) => {
                  const exp = !collapsed.has(status);
                  const sorted = sortIssues(groupIssues, activeSort?.kind === 'header' ? activeSort.sort : undefined);
                  return (
                    <React.Fragment key={status}>
                      <GroupHeader
                        label={status} count={groupIssues.length} colSpan={colSpan}
                        expanded={exp} onToggle={() => setCollapsed((s) => { const n = new Set(s); if (n.has(status)) n.delete(status); else n.add(status); return n; })}
                        color={COLORS.Status[status] ?? '#C4C4C4'}
                      />
                      {exp && sorted.map((issue) => renderRow(issue))}
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
