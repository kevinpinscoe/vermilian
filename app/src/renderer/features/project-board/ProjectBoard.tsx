import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  pointerWithin, useDraggable, useDroppable,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, horizontalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Loader, Text, Heading, AttentionBox, Button, Tooltip } from '@vibe/core';
import { Wand, Play, Settings } from '@vibe/icons';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { PRIORITY_OPTIONS, CATEGORY_OPTIONS } from '../../../shared/workspace';
import { getFieldDef, type ColumnFieldKey } from '../../../shared/fields';
import type { BoardColumnConfig, BoardColors, BoardSortConfig, ColumnField } from '../../../shared/boardConfig';
import { COLUMN_LABELS, defaultBoardConfig, defaultBoardView, defaultKanbanView } from '../../../shared/boardConfig';
import { useTimerStore, fmtMs, getTotalWorkMs } from '../../stores/timer';
import { useBoardDragStore } from '../../stores/boardDrag';
import { STATUS_COLORS, PRIORITY_COLORS, CATEGORY_COLORS } from './colors';
import { useIssues, usePatchIssueOnBoard, useCreateIssueOnBoard } from './api';
import { useBoardConfig, useSaveBoardConfig, useResetBoardConfig } from './boardConfigApi';
import { ColumnsPanel } from './ColumnsPanel';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import {
  ChipCell, EffectiveColors, formatDate, KanbanView,
} from './KanbanView';
import {
  STATUS_ORDER, GROUP_FIELD_MAP, groupIssues, getGroupColorMap,
  applyFilter, filterCount, sortIssues, applyManualOrder, orderedUnique,
  EMPTY_FILTER, type FilterState, type DueDateMode,
} from './grouping';
import styles from './ProjectBoard.module.css';

interface FilterSectionProps {
  label: string;
  values: string[];
  active: string[];
  colorMap: Record<string, string>;
  onToggle: (value: string) => void;
}

function FilterSection({ label, values, active, colorMap, onToggle }: FilterSectionProps) {
  if (values.length === 0) return null;
  const hasActive = active.length > 0;
  return (
    <div className={styles.filterSection}>
      <span className={styles.filterLabel}>{label}</span>
      {values.map((val) => {
        const bg = colorMap[val] ?? '#C4C4C4';
        const isActive = active.includes(val);
        return (
          <button
            key={val}
            type="button"
            data-testid="filter-pill"
            data-value={val}
            className={`${styles.filterPill} ${isActive ? styles.filterPillActive : ''} ${hasActive && !isActive ? styles.filterPillDim : ''}`}
            style={{ backgroundColor: bg, color: '#fff' }}
            onClick={() => onToggle(val)}
            title={isActive ? `Remove ${val} filter` : `Filter by ${val}`}
          >
            {val}
          </button>
        );
      })}
    </div>
  );
}

interface FilterBarProps {
  issues: BoardIssue[];
  filter: FilterState;
  colors: EffectiveColors;
  onChange: (f: FilterState) => void;
  searchRef?: React.Ref<HTMLInputElement>;
}

function FilterBar({ issues, filter, colors, onChange, searchRef }: FilterBarProps) {
  const statusVals   = orderedUnique(issues.map((i) => i.fields.status),   STATUS_ORDER);
  const priorityVals = orderedUnique(issues.map((i) => i.fields.priority), PRIORITY_OPTIONS);
  const categoryVals = orderedUnique(issues.map((i) => i.fields.category), CATEGORY_OPTIONS);

  const hasFilters = filterCount(filter) > 0;

  function toggle(field: 'status' | 'priority' | 'category', value: string) {
    const cur = filter[field];
    onChange({
      ...filter,
      [field]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    });
  }

  return (
    <div className={styles.filterBar} data-testid="filter-bar">
      <input
        ref={searchRef}
        type="search"
        data-testid="filter-search"
        className={styles.filterSearch}
        placeholder="Search summary or ID…"
        value={filter.search}
        onChange={(e) => onChange({ ...filter, search: e.target.value })}
      />
      {statusVals.length > 0 && <span className={styles.filterSep} />}
      <FilterSection label="Status"   values={statusVals}   active={filter.status}   colorMap={colors.Status}   onToggle={(v) => toggle('status', v)} />
      {statusVals.length > 0 && priorityVals.length > 0 && <span className={styles.filterSep} />}
      <FilterSection label="Priority" values={priorityVals} active={filter.priority} colorMap={colors.Priority} onToggle={(v) => toggle('priority', v)} />
      {priorityVals.length > 0 && categoryVals.length > 0 && <span className={styles.filterSep} />}
      <FilterSection label="Category" values={categoryVals} active={filter.category} colorMap={colors.Category} onToggle={(v) => toggle('category', v)} />
      <span className={styles.filterSep} />
      <div className={styles.filterSection} data-testid="filter-due">
        <span className={styles.filterLabel}>Due</span>
        <select
          data-testid="filter-due-mode"
          className={styles.filterDueSelect}
          value={filter.dueMode}
          onChange={(e) => {
            const dueMode = e.target.value as DueDateMode;
            // Clear the upper bound when leaving range mode so the count is accurate.
            onChange({ ...filter, dueMode, dueTo: dueMode === 'range' ? filter.dueTo : null });
          }}
        >
          <option value="any">Any</option>
          <option value="before">Before</option>
          <option value="on">On</option>
          <option value="after">After</option>
          <option value="range">Range</option>
        </select>
        {filter.dueMode !== 'any' && (
          <input
            type="date"
            data-testid="filter-due-from"
            aria-label={filter.dueMode === 'range' ? 'Due from' : 'Due date'}
            className={styles.filterDateInput}
            value={filter.dueFrom ?? ''}
            onChange={(e) => onChange({ ...filter, dueFrom: e.target.value || null })}
          />
        )}
        {filter.dueMode === 'range' && (
          <>
            <span className={styles.filterLabel}>to</span>
            <input
              type="date"
              data-testid="filter-due-to"
              aria-label="Due to"
              className={styles.filterDateInput}
              value={filter.dueTo ?? ''}
              onChange={(e) => onChange({ ...filter, dueTo: e.target.value || null })}
            />
          </>
        )}
      </div>
      {hasFilters && (
        <button type="button" className={styles.filterClear} onClick={() => onChange(EMPTY_FILTER)}>
          Clear all
        </button>
      )}
    </div>
  );
}

// ─── Sort menu ─────────────────────────────────────────────────────────────────

interface SortMenuProps {
  columns: BoardColumnConfig[];
  sort: BoardSortConfig | undefined;
  onChange: (sort: BoardSortConfig | undefined) => void;
  onClose: () => void;
}

function SortMenu({ columns, sort, onChange, onClose }: SortMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className={styles.sortMenu} data-testid="sort-menu">
      {columns.map((col) => {
        const active = sort?.field === col.field;
        return (
          <div key={col.field} className={styles.sortMenuRow} data-testid="sort-row" data-col={col.field}>
            <span className={styles.sortMenuLabel}>{COLUMN_LABELS[col.field]}</span>
            <button
              type="button"
              data-testid="sort-dir" data-col={col.field} data-dir="asc"
              className={`${styles.sortDirBtn} ${active && sort?.direction === 'asc' ? styles.sortDirActive : ''}`}
              onClick={() => onChange({ field: col.field, direction: 'asc' })}
              title="Ascending"
            >↑</button>
            <button
              type="button"
              data-testid="sort-dir" data-col={col.field} data-dir="desc"
              className={`${styles.sortDirBtn} ${active && sort?.direction === 'desc' ? styles.sortDirActive : ''}`}
              onClick={() => onChange({ field: col.field, direction: 'desc' })}
              title="Descending"
            >↓</button>
          </div>
        );
      })}
      {sort && (
        <button type="button" data-testid="sort-clear" className={styles.sortClear} onClick={() => onChange(undefined)}>
          Clear sort
        </button>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mergeColors(boardColors: BoardColors): EffectiveColors {
  return {
    Status:   { ...STATUS_COLORS,   ...(boardColors['Status']   ?? {}) },
    Priority: { ...PRIORITY_COLORS, ...(boardColors['Priority'] ?? {}) },
    Category: { ...CATEGORY_COLORS, ...(boardColors['Category'] ?? {}) },
  };
}

// ─── Inline text cell ─────────────────────────────────────────────────────────

function InlineTextCell({
  value, onSave, asLink,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  asLink?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function start(e: React.MouseEvent) { e.stopPropagation(); setDraft(value ?? ''); setEditing(true); }
  function commit() {
    const v = draft.trim() || null;
    if (v !== (value ?? null)) onSave(v);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.inlineInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  if (!value) return <span className={`${styles.emptyCell} ${styles.cellEditable}`} onClick={start}>—</span>;
  if (asLink) {
    return (
      <a href={value} target="_blank" rel="noreferrer"
        className={`${styles.link} ${styles.cellEditable}`}
        onClick={(e) => { e.preventDefault(); start(e); }}>
        {value}
      </a>
    );
  }
  return <span className={styles.cellEditable} onClick={start}>{value}</span>;
}

// ─── Inline date cell ─────────────────────────────────────────────────────────

function epochToDateStr(ms: number | null): string {
  if (!ms) return '';
  return new Date(ms).toISOString().slice(0, 10);
}
function dateStrToEpoch(s: string): number | null {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d.getTime();
}

function InlineDateCell({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);

  useEffect(() => { if (editing) { savedRef.current = false; inputRef.current?.focus(); } }, [editing]);

  function start(e: React.MouseEvent) { e.stopPropagation(); setEditing(true); }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        data-testid="due-date-input"
        className={styles.inlineDateInput}
        defaultValue={epochToDateStr(value)}
        onChange={(e) => { onSave(dateStrToEpoch(e.target.value)); savedRef.current = true; setEditing(false); }}
        onBlur={(e) => { if (!savedRef.current) onSave(dateStrToEpoch(e.target.value)); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } e.stopPropagation(); }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <span data-testid="due-date-cell" className={`${styles.dateCell} ${styles.cellEditable}`} onClick={start}>
      {formatDate(value)}
    </span>
  );
}

// ─── Inline number cell ───────────────────────────────────────────────────────

function clampPercent(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : Math.max(0, Math.min(100, Math.round(n)));
}

function InlineNumberCell({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function start(e: React.MouseEvent) { e.stopPropagation(); setDraft(value === null ? '' : String(value)); setEditing(true); }
  function commit() { onSave(clampPercent(draft)); setEditing(false); }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={100}
        step={1}
        className={styles.inlineDateInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <span className={`${styles.dateCell} ${styles.cellEditable}`} onClick={start}>
      {value === null ? '—' : `${value}%`}
    </span>
  );
}

// ─── Render cell ──────────────────────────────────────────────────────────────

// Only fields with editor: 'select' are chip-rendered today (status/priority/category);
// each needs its own colour map from EffectiveColors, keyed by the field's YouTrack label.
const CHIP_COLOR_KEY: Partial<Record<ColumnFieldKey, keyof EffectiveColors>> = {
  status: 'Status',
  priority: 'Priority',
  category: 'Category',
};

function renderCell(
  issue: BoardIssue,
  field: ColumnField,
  colors: EffectiveColors,
  onPatch?: (issueId: string, field: string, value: string | number | null) => void,
): React.ReactNode {
  if (field === 'summary') return <span className={styles.emptyCell}>—</span>; // handled by IssueRow instead
  const def = getFieldDef(field);
  const value = issue.fields[field];
  const save = (v: string | number | null) => onPatch?.(issue.id, field, v);

  switch (def.editor) {
    case 'select': {
      const colorKey = CHIP_COLOR_KEY[field];
      return (
        <ChipCell
          value={value as string | null}
          colorMap={colorKey ? colors[colorKey] : {}}
          field={field}
          onEdit={onPatch ? (v) => save(v) : undefined}
        />
      );
    }
    case 'date':
      return <InlineDateCell value={value as number | null} onSave={(v) => save(v)} />;
    case 'number':
      return <InlineNumberCell value={value as number | null} onSave={(v) => save(v)} />;
    case 'link':
      return <InlineTextCell value={value as string | null} onSave={(v) => save(v)} asLink />;
    case 'text':
      return <InlineTextCell value={value as string | null} onSave={(v) => save(v)} />;
    case 'readonly':
      return <Text type="text2" className={styles.dateCell}>{formatDate(value as number | null)}</Text>;
    default:
      return <span className={styles.emptyCell}>—</span>;
  }
}

// ─── Group header ─────────────────────────────────────────────────────────────

function GroupHeader({
  label, count, colSpan, expanded, onToggle, colorMap, isDropTarget,
}: {
  label: string; count: number; colSpan: number; expanded: boolean;
  onToggle: () => void; colorMap: Record<string, string>; isDropTarget?: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `group::${label}`, data: { groupVal: label } });
  const bg = colorMap[label] ?? '#C4C4C4';
  return (
    <tr data-testid="group-header" className={`${styles.groupHeaderRow} ${isDropTarget ? styles.groupHeaderRowDropTarget : ''}`}>
      <td colSpan={colSpan} ref={setNodeRef}>
        <button type="button" className={styles.groupHeaderButton} onClick={onToggle}>
          <svg width="10" height="10" viewBox="0 0 10 10"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, color: 'var(--secondary-text-color, #444444)' }}>
            <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={styles.groupDot} style={{ backgroundColor: bg }} />
          <Text type="text1" weight="medium">{label}</Text>
          <span className={styles.groupCount}>{count}</span>
        </button>
      </td>
    </tr>
  );
}

// ─── Add task row ─────────────────────────────────────────────────────────────

function AddTaskRow({
  colSpan,
  onAdd,
}: {
  colSpan: number;
  onAdd: (summary: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function submit() {
    if (value.trim()) onAdd(value.trim());
    setValue('');
    setEditing(false);
  }

  if (!editing) {
    return (
      <tr className={styles.addTaskRow}>
        <td colSpan={colSpan}>
          <button type="button" data-testid="add-task-btn" className={styles.addTaskButton} onClick={() => setEditing(true)}>
            + Add task
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className={styles.addTaskRow}>
      <td colSpan={colSpan} className={styles.addTaskEditCell}>
        <input
          ref={inputRef}
          data-testid="add-task-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') { setValue(''); setEditing(false); }
          }}
          placeholder="Task name..."
          className={styles.addTaskInput}
        />
        <button type="button" className={styles.addTaskSubmit} onClick={submit}>Add</button>
        <button type="button" className={styles.addTaskCancel}
          onClick={() => { setValue(''); setEditing(false); }}>Cancel</button>
      </td>
    </tr>
  );
}

// ─── Issue row ────────────────────────────────────────────────────────────────

interface IssueRowProps {
  issue: BoardIssue;
  groupVal: string;
  visibleColumns: BoardColumnConfig[];
  colors: EffectiveColors;
  onClick?: () => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  isActiveTimer: boolean;
  timerDisplay: string;
  onPatch: (issueId: string, field: string, value: string | number | null) => void;
  liveColumnWidths?: Partial<Record<ColumnField, number>>;
}

function IssueRow({
  issue, groupVal, visibleColumns, colors, onClick, onStartTimer, isActiveTimer, timerDisplay, onPatch,
  liveColumnWidths,
}: IssueRowProps) {
  const [hovered, setHovered] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const summaryInputRef = useRef<HTMLInputElement>(null);
  const nonSummaryCols = visibleColumns.filter((c) => c.field !== 'summary');

  useEffect(() => { if (editingSummary) summaryInputRef.current?.focus(); }, [editingSummary]);

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: issue.id,
    data: { issue, groupVal },
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: `row::${issue.id}`,
    data: { groupVal },
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setRef = useCallback((node: HTMLTableRowElement | null) => {
    setDragRef(node); setDropRef(node);
  }, []);

  return (
    <tr
      ref={setRef}
      data-testid="task-row"
      data-task-id={issue.id}
      className={styles.issueRow}
      onClick={onClick}
      style={{ cursor: isDragging ? 'grabbing' : 'pointer', opacity: isDragging ? 0.4 : 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <td className={`${styles.cell} ${styles.cellTask}`}>
        <div
          {...attributes}
          {...listeners}
          data-testid="drag-handle"
          className={`${styles.dragHandle} ${hovered ? styles.dragHandleVisible : ''}`}
          onClick={(e) => e.stopPropagation()}
          title="Drag to move to another group"
        >
          ⠿
        </div>
        {isActiveTimer ? (
          <span data-testid="timer-badge" className={styles.timerBadge}>▶ {timerDisplay}</span>
        ) : (
          <button
            type="button"
            data-testid="row-start-timer"
            className={`${styles.playBtn} ${hovered ? styles.playBtnVisible : ''}`}
            onClick={(e) => { e.stopPropagation(); onStartTimer(issue.id, issue.idReadable, issue.summary); }}
            title="Start timer"
          >
            <Play size={12} />
          </button>
        )}
        <span data-testid="issue-id" className={styles.issueId}>{issue.idReadable}</span>
        {editingSummary ? (
          <input
            ref={summaryInputRef}
            data-testid="summary-input"
            className={`${styles.inlineInput} ${styles.summaryInput}`}
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
            onBlur={() => {
              const v = summaryDraft.trim();
              if (v && v !== issue.summary) onPatch(issue.id, 'summary', v);
              setEditingSummary(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); summaryInputRef.current?.blur(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditingSummary(false); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            data-testid="summary-cell"
            className={`${styles.issueSummary} ${styles.cellEditable}`}
            onClick={(e) => { e.stopPropagation(); setSummaryDraft(issue.summary); setEditingSummary(true); }}
          >
            {issue.summary}
          </span>
        )}
      </td>
      {nonSummaryCols.map((col) => {
        const w = liveColumnWidths?.[col.field] ?? col.width;
        return (
          <td
            key={col.field}
            className={styles.cell}
            style={w ? { width: w, minWidth: w } : undefined}
          >
            {renderCell(issue, col.field, colors, onPatch)}
          </td>
        );
      })}
    </tr>
  );
}

// ─── Main table view ──────────────────────────────────────────────────────────

interface MainTableViewProps {
  issues: BoardIssue[];
  groupBy: string;
  sort: BoardSortConfig | undefined;
  onSort: (field: ColumnField) => void;
  visibleColumns: BoardColumnConfig[];
  colors: EffectiveColors;
  onSelectIssue: (issueId: string) => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  onPatch: (issueId: string, field: string, value: string | number | null) => void;
  onAddTask: (summary: string, groupByField: keyof BoardIssueFields | null, groupValue: string) => void;
  issueOrderByGroup?: Record<string, string[]>;
  onReorder: (groupVal: string, orderedIds: string[]) => void;
  onColumnReorder: (newColumns: BoardColumnConfig[]) => void;
  onColumnWidthChange: (field: ColumnField, width: number) => void;
  onCrossBoardDrop: (issue: BoardIssue, targetProjectId: string, targetProjectName: string) => void;
}

// ─── Sortable column header ────────────────────────────────────────────────────

interface SortableColHeaderProps {
  col: BoardColumnConfig;
  label: string;
  isActive: boolean;
  sortDir: 'asc' | 'desc' | undefined;
  onSort: () => void;
  liveWidth: number | undefined;
  activeColIdx: number;
  myIdx: number;
  onResizeStart: (e: React.MouseEvent, field: ColumnField, currentWidth: number) => void;
}

function SortableColHeader({
  col, label, isActive, sortDir, onSort, liveWidth, activeColIdx, myIdx, onResizeStart,
}: SortableColHeaderProps) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging, isOver,
  } = useSortable({ id: col.field });

  const width = liveWidth ?? col.width;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(width ? { width, minWidth: width } : {}),
    position: 'relative',
  };

  // Show the vertical drop indicator on the side where the dragged col will land
  const dropLeft = isOver && !isDragging && myIdx > activeColIdx;
  const dropRight = isOver && !isDragging && myIdx <= activeColIdx;

  return (
    <th
      ref={setNodeRef}
      data-testid="col-header"
      data-col={col.field}
      style={style}
      className={`${styles.th} ${styles.thSortable} ${dropLeft ? styles.thDropLeft : ''} ${dropRight ? styles.thDropRight : ''}`}
      onClick={onSort}
      title={`Sort by ${label}`}
    >
      <span
        {...attributes}
        {...listeners}
        data-testid="col-header-drag-handle"
        className={styles.colDragHandle}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder column"
      >
        ⠿
      </span>
      {label}
      <span data-testid="sort-indicator" className={styles.sortIcon}>
        {isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
      </span>
      <div
        data-testid="col-resize-handle"
        className={styles.resizeHandle}
        onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, col.field, width ?? 120); }}
        onClick={(e) => e.stopPropagation()}
        title="Drag to resize"
      />
    </th>
  );
}

// ─── Main table view ──────────────────────────────────────────────────────────

function MainTableView({
  issues, groupBy, sort, onSort, visibleColumns, colors, onSelectIssue, onStartTimer,
  onPatch, onAddTask, issueOrderByGroup, onReorder, onColumnReorder, onColumnWidthChange,
  onCrossBoardDrop,
}: MainTableViewProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [draggingIssue, setDraggingIssue] = useState<BoardIssue | null>(null);
  const [overGroupId, setOverGroupId] = useState<string | null>(null);
  const [overRowId, setOverRowId] = useState<string | null>(null);
  const [resizeState, setResizeState] = useState<{ field: ColumnField; startX: number; startWidth: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<Partial<Record<ColumnField, number>>>({});
  const [colSortActiveIdx, setColSortActiveIdx] = useState(-1);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const timer = useTimerStore((s) => s.timer);
  const [tick, setTick] = useState(0);
  const setBoardDragIssue = useBoardDragStore((s) => s.setDraggingIssue);
  const rowSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const colSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!timer || !timer.phaseStartedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timer?.issueId, timer?.phaseStartedAt]);
  void tick;

  // ── Column resize mouse tracking ─────────────────────────────────────────────
  useEffect(() => {
    if (!resizeState) return;
    function onMove(e: MouseEvent) {
      const delta = e.clientX - resizeState!.startX;
      const raw = resizeState!.startWidth + delta;
      const snapped = Math.max(40, Math.round(raw / 8) * 8);
      setLiveWidth({ [resizeState!.field]: snapped });
    }
    function onUp(e: MouseEvent) {
      const delta = e.clientX - resizeState!.startX;
      const raw = resizeState!.startWidth + delta;
      const snapped = Math.max(40, Math.round(raw / 8) * 8);
      onColumnWidthChange(resizeState!.field, snapped);
      setResizeState(null);
      setLiveWidth({});
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizeState]);

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  // ── Row drag handlers ────────────────────────────────────────────────────────

  function handleRowDragStart(e: DragStartEvent) {
    const data = e.active.data.current as { issue: BoardIssue } | undefined;
    const issue = data?.issue ?? null;
    setDraggingIssue(issue);
    setBoardDragIssue(issue); // signal nav to show cross-board targets
    document.addEventListener('mousemove', trackMouse);
  }

  function trackMouse(e: MouseEvent) {
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }

  function handleRowDragOver(e: DragOverEvent) {
    const srcGroup = (e.active.data.current as { groupVal?: string } | undefined)?.groupVal;
    const tgtGroup = (e.over?.data.current as { groupVal?: string } | undefined)?.groupVal;
    if (tgtGroup && tgtGroup !== srcGroup) {
      setOverGroupId(tgtGroup);
      setOverRowId(null);
    } else if (tgtGroup && tgtGroup === srcGroup) {
      setOverGroupId(null);
      const overId = e.over?.id as string | undefined;
      setOverRowId(overId?.startsWith('row::') ? overId.slice(6) : null);
    } else {
      setOverGroupId(null);
      setOverRowId(null);
    }
  }

  function handleRowDragEnd(e: DragEndEvent) {
    document.removeEventListener('mousemove', trackMouse);
    const { active, over } = e;
    const issue = (active.data.current as { issue: BoardIssue; groupVal: string } | undefined)?.issue;
    const srcGroup = (active.data.current as { groupVal: string } | undefined)?.groupVal;

    setDraggingIssue(null);
    setOverGroupId(null);
    setOverRowId(null);
    setBoardDragIssue(null);

    // Cross-board drop: pointer is over the nav rail (no dnd-kit droppable registered)
    if (!over && issue) {
      const { x, y } = lastMouseRef.current;
      const els = document.elementsFromPoint(x, y);
      for (const el of els) {
        const projectId = (el as HTMLElement).dataset?.navProjectId;
        const projectName = (el as HTMLElement).dataset?.navProjectName;
        if (projectId && projectName) {
          onCrossBoardDrop(issue, projectId, projectName);
          return;
        }
      }
      return;
    }

    if (!over || !issue || !srcGroup) return;
    const tgtGroup = (over.data.current as { groupVal?: string } | undefined)?.groupVal;
    if (!tgtGroup) return;

    if (srcGroup !== tgtGroup) {
      // Between-group move: update the groupBy field
      const fieldKey = GROUP_FIELD_MAP[groupBy]?.key;
      if (!fieldKey) return;
      onPatch(issue.id, fieldKey as string, tgtGroup);
    } else {
      // Same-group: reorder
      const overId = over.id as string;
      if (!overId.startsWith('row::')) return;
      const overIssueId = overId.slice(6);
      if (overIssueId === issue.id) return;

      const groupIssuesArr = issues.filter((i) => {
        const mapping = GROUP_FIELD_MAP[groupBy];
        if (!mapping) return false;
        const val = (i.fields[mapping.key] as string | null) ?? '(No value)';
        return val === srcGroup;
      });

      const manualOrder = issueOrderByGroup?.[srcGroup];
      const currentOrder = manualOrder
        ? applyManualOrder(groupIssuesArr, manualOrder).map((i) => i.id)
        : groupIssuesArr.map((i) => i.id);

      const fromIdx = currentOrder.indexOf(issue.id);
      const toIdx = currentOrder.indexOf(overIssueId);
      if (fromIdx === -1 || toIdx === -1) return;
      onReorder(srcGroup, arrayMove(currentOrder, fromIdx, toIdx));
    }
  }

  // ── Column drag handlers ─────────────────────────────────────────────────────

  function handleColDragStart(e: DragStartEvent) {
    const idx = visibleColumns.findIndex((c) => c.field === e.active.id);
    setColSortActiveIdx(idx);
  }

  function handleColDragEnd(e: DragEndEvent) {
    setColSortActiveIdx(-1);
    if (!e.over || e.active.id === e.over.id) return;
    const fromIdx = visibleColumns.findIndex((c) => c.field === e.active.id);
    const toIdx = visibleColumns.findIndex((c) => c.field === e.over!.id);
    if (fromIdx === -1 || toIdx === -1) return;
    onColumnReorder(arrayMove(visibleColumns, fromIdx, toIdx));
  }

  const groups = groupIssues(issues, groupBy);
  const groupColorMap = getGroupColorMap(groupBy, colors);
  const groupByField = GROUP_FIELD_MAP[groupBy]?.key ?? null;
  const nonSummaryCols = visibleColumns.filter((c) => c.field !== 'summary');
  const colSpan = 1 + nonSummaryCols.length;

  if (groups.length === 0) {
    return <div className={styles.emptyState}><Text>No tasks in this project yet.</Text></div>;
  }

  return (
    <DndContext
      sensors={rowSensors}
      collisionDetection={pointerWithin}
      onDragStart={handleRowDragStart}
      onDragOver={handleRowDragOver}
      onDragEnd={handleRowDragEnd}
    >
      <div className={styles.tableWrapper}>
        <table data-testid="main-table" className={styles.table}>
          <thead>
            <tr className={styles.headerRow}>
              {/* Summary column — not sortable by column-reorder DnD, not resizable */}
              <th
                data-testid="col-header"
                data-col="summary"
                className={`${styles.th} ${styles.thTask} ${styles.thSortable}`}
                onClick={() => onSort('summary')}
                title="Sort by Summary"
              >
                {COLUMN_LABELS['summary']}
                <span data-testid="sort-indicator" className={styles.sortIcon}>
                  {sort?.field === 'summary' ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                </span>
              </th>
              {/* Non-summary columns — sortable by column-reorder DnD, resizable */}
              <DndContext
                sensors={colSensors}
                onDragStart={handleColDragStart}
                onDragEnd={handleColDragEnd}
              >
                <SortableContext
                  items={nonSummaryCols.map((c) => c.field)}
                  strategy={horizontalListSortingStrategy}
                >
                  {nonSummaryCols.map((col, i) => (
                    <SortableColHeader
                      key={col.field}
                      col={col}
                      label={COLUMN_LABELS[col.field] ?? col.field}
                      isActive={sort?.field === col.field}
                      sortDir={sort?.field === col.field ? sort.direction : undefined}
                      onSort={() => onSort(col.field)}
                      liveWidth={liveWidth[col.field]}
                      activeColIdx={colSortActiveIdx}
                      myIdx={i}
                      onResizeStart={(e, field, w) => setResizeState({ field, startX: e.clientX, startWidth: w })}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </tr>
          </thead>
          {groups.map(([groupVal, groupIssues]) => {
              const expanded = !collapsedGroups.has(groupVal);
              const manualOrder = issueOrderByGroup?.[groupVal];
              const sortedIssues = manualOrder
                ? applyManualOrder(groupIssues, manualOrder)
                : sortIssues(groupIssues, sort);
              const isDropTarget = overGroupId === groupVal;
              // Track whether the active drag source is from this group (for same-group indicator)
              const isDraggingThisGroup = draggingIssue !== null && groupIssues.some((i) => i.id === draggingIssue.id);
              return (
                <tbody key={groupVal} data-testid="task-group" data-group-val={groupVal}>
                  <GroupHeader
                    label={groupVal}
                    count={groupIssues.length}
                    colSpan={colSpan}
                    expanded={expanded}
                    onToggle={() => toggleGroup(groupVal)}
                    colorMap={groupColorMap}
                    isDropTarget={isDropTarget}
                  />
                  {isDropTarget && (
                    <tr className={styles.dropIndicatorRow}>
                      <td colSpan={colSpan}><div data-testid="drop-indicator" className={styles.dropIndicatorLine} /></td>
                    </tr>
                  )}
                  {expanded && (
                    <>
                      {sortedIssues.map((issue) => {
                        const isActiveTimer = timer?.issueId === issue.id;
                        const showRowIndicator = isDraggingThisGroup && overRowId === issue.id;
                        return (
                          <React.Fragment key={issue.id}>
                            {showRowIndicator && (
                              <tr className={styles.dropIndicatorRow}>
                                <td colSpan={colSpan}><div data-testid="drop-indicator" className={styles.dropIndicatorLine} /></td>
                              </tr>
                            )}
                            <IssueRow
                              issue={issue}
                              groupVal={groupVal}
                              visibleColumns={visibleColumns}
                              colors={colors}
                              onClick={() => onSelectIssue(issue.id)}
                              onStartTimer={onStartTimer}
                              isActiveTimer={isActiveTimer}
                              timerDisplay={isActiveTimer && timer ? fmtMs(getTotalWorkMs(timer)) : ''}
                              onPatch={onPatch}
                              liveColumnWidths={liveWidth}
                            />
                          </React.Fragment>
                        );
                      })}
                      <AddTaskRow
                        colSpan={colSpan}
                        onAdd={(summary) => onAddTask(summary, groupByField, groupVal)}
                      />
                    </>
                  )}
                </tbody>
              );
            })}
        </table>
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingIssue && (
          <div className={styles.dragOverlayCard}>
            <span className={styles.dragOverlayId}>{draggingIssue.idReadable}</span>
            <span className={styles.dragOverlayText}>{draggingIssue.summary}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ─── ProjectBoard ─────────────────────────────────────────────────────────────

interface ProjectBoardProps {
  projectId: string;
  projectName: string;
  projectShortName: string;
  onSelectIssue: (issueId: string) => void;
  onNewTask: () => void;
  onAiCreate: () => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  hasClaudeKey: boolean;
  onCrossBoardDrop?: (issue: BoardIssue, targetProjectId: string, targetProjectName: string) => void;
}

export function ProjectBoard({
  projectId, projectName, projectShortName, onSelectIssue, onNewTask, onAiCreate,
  onStartTimer, hasClaudeKey, onCrossBoardDrop,
}: ProjectBoardProps) {
  const [showColumns, setShowColumns] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  // The Search toolbar button opens the filter bar and focuses its search input;
  // the input lives in the FilterBar child, so focus is deferred until it mounts.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [localOrderByGroup, setLocalOrderByGroup] = useState<Record<string, string[]> | null>(null);

  useEffect(() => {
    if (showFilter && pendingSearchFocus) {
      searchInputRef.current?.focus();
      setPendingSearchFocus(false);
    }
  }, [showFilter, pendingSearchFocus]);

  const { data: issues, isLoading, isError, error, refetch } = useIssues(projectShortName, showClosed);
  const { data: boardConfig } = useBoardConfig(projectId);
  const saveBoardConfig = useSaveBoardConfig();
  const resetBoardConfig = useResetBoardConfig();
  const patchMutation = usePatchIssueOnBoard(projectShortName);
  const createMutation = useCreateIssueOnBoard(projectShortName);

  const isInbox = projectName.toLowerCase().includes('inbox');

  const rawConfig = boardConfig ?? defaultBoardConfig(projectId);
  // Migrate saved configs that predate the Kanban view being added
  const config = rawConfig.views.some(v => v.type === 'kanban')
    ? rawConfig
    : { ...rawConfig, views: [...rawConfig.views, defaultKanbanView()] };
  const activeView =
    config.views.find((v) => v.id === config.activeViewId) ?? defaultBoardView();
  const visibleColumns = activeView.columns.filter((c) => c.visible);
  const colors = mergeColors(config.colors);

  function handlePatch(issueId: string, field: string, value: string | number | null) {
    patchMutation.mutate({ issueId, field, value });
  }

  function handleAddTask(
    summary: string,
    groupByField: keyof BoardIssueFields | null,
    groupValue: string,
  ) {
    createMutation.mutate({
      projectId,
      summary,
      status:   groupByField === 'status'   ? groupValue : null,
      priority: groupByField === 'priority' ? groupValue : null,
      category: groupByField === 'category' ? groupValue : null,
      dueDate: null,
      ticket: null,
      ticketLink: null,
      relatedLink: null,
      notes: null,
      repoUrl: null,
    });
  }

  function handleReorder(groupVal: string, orderedIds: string[]) {
    const updatedOrder = {
      ...(activeView.issueOrderByGroup ?? {}),
      [groupVal]: orderedIds,
    };
    setLocalOrderByGroup(updatedOrder);
    saveBoardConfig.mutate(
      {
        ...config,
        views: config.views.map((v) =>
          v.id === activeView.id ? { ...v, issueOrderByGroup: updatedOrder } : v,
        ),
      },
      { onSettled: () => setLocalOrderByGroup(null) },
    );
  }

  function handleColumnReorder(newColumns: BoardColumnConfig[]) {
    // newColumns contains only visible columns; merge back with the hidden ones
    const hiddenCols = activeView.columns.filter((c) => !c.visible);
    const merged = [...newColumns, ...hiddenCols];
    const updatedView = { ...activeView, columns: merged };
    saveBoardConfig.mutate({
      ...config,
      views: config.views.map((v) => (v.id === activeView.id ? updatedView : v)),
    });
  }

  function handleColumnWidthChange(field: ColumnField, width: number) {
    const updatedCols = activeView.columns.map((c) => (c.field === field ? { ...c, width } : c));
    const updatedView = { ...activeView, columns: updatedCols };
    saveBoardConfig.mutate({
      ...config,
      views: config.views.map((v) => (v.id === activeView.id ? updatedView : v)),
    });
  }

  function handleAddTaskKanban(summary: string, groupValue: string) {
    const groupByField = GROUP_FIELD_MAP[activeView.groupBy]?.key ?? null;
    handleAddTask(summary, groupByField, groupValue);
  }

  function handleColumnsChange(cols: BoardColumnConfig[]) {
    const updatedView = { ...activeView, columns: cols };
    saveBoardConfig.mutate({
      ...config,
      views: config.views.map((v) => (v.id === activeView.id ? updatedView : v)),
    });
  }

  function handleSwitchView(viewId: string) {
    saveBoardConfig.mutate({ ...config, activeViewId: viewId });
  }

  function handleSort(field: ColumnField) {
    const current = activeView.sort;
    const next: BoardSortConfig = current?.field === field
      ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { field, direction: 'asc' };
    const updatedView = { ...activeView, sort: next };
    saveBoardConfig.mutate({
      ...config,
      views: config.views.map((v) => (v.id === activeView.id ? updatedView : v)),
    });
  }

  function handleSetSort(sort: BoardSortConfig | undefined) {
    const updatedView = { ...activeView, sort };
    saveBoardConfig.mutate({
      ...config,
      views: config.views.map((v) => (v.id === activeView.id ? updatedView : v)),
    });
  }

  function handleGroupByChange(groupBy: string) {
    const updatedView = { ...activeView, groupBy };
    saveBoardConfig.mutate({
      ...config,
      views: config.views.map((v) => (v.id === activeView.id ? updatedView : v)),
    });
  }

  function handleSettingsSave(updated: typeof config) {
    saveBoardConfig.mutate(updated);
  }

  function handleReset() {
    resetBoardConfig.mutate(projectId);
    setShowSettings(false);
  }

  const isKanban = activeView.type === 'kanban';
  const effectiveGroupBy = isKanban ? 'Status' : activeView.groupBy;
  const filteredIssues = applyFilter(issues ?? [], filter);
  const activeFilterCount = filterCount(filter);
  // All issues filtered out by active filters (vs. a genuinely empty board).
  const filteredEmpty = (issues?.length ?? 0) > 0 && filteredIssues.length === 0;
  const projectEmpty = !!issues && issues.length === 0;
  const groups = groupIssues(filteredIssues, effectiveGroupBy);
  const groupColorMap = getGroupColorMap(effectiveGroupBy, colors);

  return (
    <div className={styles.board} style={{ position: 'relative' }}>
      {/* Header */}
      <div className={styles.boardHeader}>
        <div className={styles.boardTitleRow}>
          {isInbox && <span data-testid="board-inbox-badge" className={styles.inboxBadge} title="Inbox project" />}
          <Heading type="h3" weight="bold" className={styles.boardTitle} data-testid="board-title">{projectName}</Heading>
        </div>
        <div className={styles.viewTabs}>
          {config.views.map((view) => (
            <button
              key={view.id}
              type="button"
              data-testid="view-tab"
              data-view-type={view.type}
              className={`${styles.viewTab} ${view.id === config.activeViewId ? styles.viewTabActive : ''}`}
              onClick={() => handleSwitchView(view.id)}
            >
              {view.name}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <button type="button" data-testid="new-task-btn" className={styles.newTaskBtn} onClick={onNewTask}>New task</button>
        <Tooltip content={hasClaudeKey ? 'AI create task' : 'Configure a Claude API key in Settings to use AI task creation.'}>
          <Button data-testid="ai-create-btn" size="small" kind="secondary" onClick={onAiCreate} disabled={!hasClaudeKey} leftIcon={Wand}>
            AI create
          </Button>
        </Tooltip>
        <div className={styles.toolbarSpacer} />

        {/* Search — opens the filter bar and focuses its free-text search input */}
        <Button
          data-testid="search-btn"
          size="small"
          kind="tertiary"
          onClick={() => { setShowFilter(true); setShowSort(false); setPendingSearchFocus(true); }}
        >
          Search
        </Button>

        {/* Filter toggle */}
        <Button
          data-testid="filter-btn"
          size="small"
          kind={showFilter || activeFilterCount > 0 ? 'secondary' : 'tertiary'}
          onClick={() => { setShowFilter((s) => !s); setShowSort(false); }}
        >
          {activeFilterCount > 0 ? `Filter (${activeFilterCount})` : 'Filter'}
        </Button>

        {/* Sort menu */}
        <div className={styles.sortWrap}>
          <Button
            data-testid="sort-btn"
            size="small"
            kind={activeView.sort ? 'secondary' : 'tertiary'}
            onClick={() => { setShowSort((s) => !s); setShowFilter(false); }}
          >
            Sort
          </Button>
          {showSort && (
            <SortMenu
              columns={visibleColumns}
              sort={activeView.sort}
              onChange={(sort) => handleSetSort(sort)}
              onClose={() => setShowSort(false)}
            />
          )}
        </div>

        {/* Hide/show closed */}
        <button
          type="button"
          className={`${styles.closedToggle} ${showClosed ? styles.closedToggleActive : ''}`}
          onClick={() => setShowClosed((s) => !s)}
          title={showClosed ? 'Hide closed issues' : 'Show closed issues'}
        >
          {showClosed ? 'Hide closed' : 'Show closed'}
        </button>

        {/* Group-by selector — hidden in Kanban (always Status) */}
        {!isKanban && (
          <label className={styles.groupByWrap}>
            <span className={styles.groupByLabel}>Group by</span>
            <select
              data-testid="group-by-select"
              className={styles.groupBySelect}
              value={activeView.groupBy}
              onChange={(e) => handleGroupByChange(e.target.value)}
            >
              <option value="Status">Status</option>
              <option value="Priority">Priority</option>
              <option value="Category">Category</option>
            </select>
          </label>
        )}
        {activeView.type === 'table' && (
          <Button
            data-testid="hide-columns-btn"
            size="small"
            kind="tertiary"
            onClick={() => { setShowColumns((s) => !s); setShowSettings(false); }}
          >
            Hide
          </Button>
        )}
        <Tooltip content="Board settings">
          <Button
            size="small"
            kind="tertiary"
            leftIcon={Settings}
            onClick={() => { setShowSettings((s) => !s); setShowColumns(false); }}
          >
            Settings
          </Button>
        </Tooltip>
        <Button size="small" kind="tertiary" onClick={() => refetch()}>Refresh</Button>
      </div>

      {/* Filter bar — toggled by the Filter button; stays open while filters are active */}
      {!isLoading && !isError && issues && (showFilter || activeFilterCount > 0) && (
        <FilterBar issues={issues} filter={filter} colors={colors} onChange={setFilter} searchRef={searchInputRef} />
      )}

      {/* Content */}
      {isLoading && <div className={styles.loaderWrap}><Loader size={40} /></div>}

      {isError && (
        <div className={styles.errorWrap}>
          <AttentionBox
            type="negative"
            title="Failed to load issues"
            text={(error as Error)?.message ?? 'An error occurred.'}
            onClose={() => refetch()}
          />
        </div>
      )}

      {/* Empty state when the project has no tasks at all */}
      {!isLoading && !isError && projectEmpty && (
        <div className={styles.filteredEmpty} data-testid="project-empty">
          <AttentionBox
            type="primary"
            compact
            text="No tasks in this project yet."
          />
        </div>
      )}

      {/* Empty state when active filters exclude every task */}
      {!isLoading && !isError && filteredEmpty && (
        <div className={styles.filteredEmpty} data-testid="filtered-empty">
          <AttentionBox
            type="primary"
            compact
            text="No tasks match your filters."
          />
          <button type="button" className={styles.filterClear} onClick={() => setFilter(EMPTY_FILTER)}>
            Clear all filters
          </button>
        </div>
      )}

      {!isLoading && !isError && issues && !isKanban && !filteredEmpty && !projectEmpty && (
        <MainTableView
          issues={filteredIssues}
          groupBy={effectiveGroupBy}
          sort={activeView.sort}
          onSort={handleSort}
          visibleColumns={visibleColumns}
          colors={colors}
          onSelectIssue={onSelectIssue}
          onStartTimer={onStartTimer}
          onPatch={handlePatch}
          onAddTask={handleAddTask}
          issueOrderByGroup={localOrderByGroup ?? activeView.issueOrderByGroup}
          onReorder={handleReorder}
          onColumnReorder={handleColumnReorder}
          onColumnWidthChange={handleColumnWidthChange}
          onCrossBoardDrop={onCrossBoardDrop ?? (() => {})}
        />
      )}

      {!isLoading && !isError && issues && isKanban && !filteredEmpty && !projectEmpty && (
        <KanbanView
          groups={groups}
          groupColorMap={groupColorMap}
          colors={colors}
          groupByField={GROUP_FIELD_MAP[effectiveGroupBy]?.key ?? 'status'}
          onSelectIssue={onSelectIssue}
          onPatch={handlePatch}
          onStartTimer={onStartTimer}
          onAddTask={handleAddTaskKanban}
          onCrossBoardDrop={onCrossBoardDrop}
        />
      )}

      {/* Columns panel */}
      {showColumns && (
        <ColumnsPanel
          columns={activeView.columns}
          onChange={handleColumnsChange}
          onClose={() => setShowColumns(false)}
        />
      )}

      {/* Board settings panel */}
      {showSettings && (
        <BoardSettingsPanel
          config={config}
          projectName={projectName}
          onSave={handleSettingsSave}
          onReset={handleReset}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
