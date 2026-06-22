import React, { useEffect, useRef, useState } from 'react';
import { Text } from '@vibe/core';
import { Play } from '@vibe/icons';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  pointerWithin, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { STATUS_OPTIONS, PRIORITY_OPTIONS, CATEGORY_OPTIONS } from '../../../shared/workspace';
import { getContrastColor } from './colors';
import { useTimerStore, fmtMs, getTotalWorkMs } from '../../stores/timer';
import { useBoardDragStore } from '../../stores/boardDrag';
import styles from './KanbanView.module.css';

// ─── Shared types / helpers (also used by ProjectBoard) ───────────────────────

export interface EffectiveColors {
  Status: Record<string, string>;
  Priority: Record<string, string>;
  Category: Record<string, string>;
}

export function formatDate(epochMs: number | null): string {
  if (!epochMs) return '—';
  return new Date(epochMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const FIELD_OPTIONS: Partial<Record<keyof BoardIssueFields, readonly string[]>> = {
  status: STATUS_OPTIONS,
  priority: PRIORITY_OPTIONS,
  category: CATEGORY_OPTIONS,
};

// ─── ChipCell ─────────────────────────────────────────────────────────────────

export interface ChipCellProps {
  value: string | null;
  colorMap: Record<string, string>;
  field?: keyof BoardIssueFields;
  onEdit?: (value: string) => void;
}

export function ChipCell({ value, colorMap, field, onEdit }: ChipCellProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLUListElement>(null);
  const options = field ? FIELD_OPTIONS[field] : undefined;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const bg = value ? (colorMap[value] ?? '#C4C4C4') : '#C4C4C4';
  const fg = getContrastColor(bg);

  if (!onEdit || !options) {
    return value
      ? <span className={styles.chip} style={{ background: bg, color: fg }}>{value}</span>
      : <span className={styles.emptyChip}>—</span>;
  }

  return (
    <>
      <button
        type="button"
        data-testid="chip-cell"
        data-field={field}
        className={`${styles.chip} ${styles.chipEditable}`}
        style={{ background: bg, color: fg }}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setPos({ top: rect.bottom + 4, left: rect.left });
          setOpen((s) => !s);
        }}
        title="Click to edit"
      >
        {value ?? '—'}
      </button>
      {open && (
        <ul ref={dropdownRef} data-testid="chip-dropdown" className={styles.chipDropdown} style={{ top: pos.top, left: pos.left }}>
          {options.map((opt) => {
            const oBg = colorMap[opt] ?? '#C4C4C4';
            const oFg = getContrastColor(oBg);
            return (
              <li key={opt}>
                <button
                  type="button"
                  data-testid="chip-option"
                  data-value={opt}
                  className={styles.chipDropdownOption}
                  onClick={(e) => { e.stopPropagation(); onEdit(opt); setOpen(false); }}
                >
                  <span className={styles.chip} style={{ background: oBg, color: oFg }}>{opt}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ─── AddKanbanCard ────────────────────────────────────────────────────────────

function AddKanbanCard({ onAdd }: { onAdd: (summary: string) => void }) {
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
      <button type="button" className={styles.addCard} onClick={() => setEditing(true)}>
        + Add task
      </button>
    );
  }

  return (
    <div className={styles.addCardForm}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') { setValue(''); setEditing(false); }
        }}
        placeholder="Task name..."
        className={styles.addCardInput}
      />
      <div className={styles.addCardActions}>
        <button type="button" className={styles.addCardSubmit} onClick={submit}>Add</button>
        <button type="button" className={styles.addCardCancel}
          onClick={() => { setValue(''); setEditing(false); }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── KanbanCard ───────────────────────────────────────────────────────────────

interface KanbanCardInnerProps {
  issue: BoardIssue;
  colors: EffectiveColors;
  onClick: () => void;
  onPatch: (issueId: string, field: string, value: string | number | null) => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  isActiveTimer: boolean;
  timerDisplay: string;
  isDragOverlay?: boolean;
}

function KanbanCardInner({
  issue, colors, onClick, onPatch, onStartTimer, isActiveTimer, timerDisplay, isDragOverlay,
}: KanbanCardInnerProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`${styles.card} ${isDragOverlay ? styles.cardDragOverlay : ''}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardId}>{issue.idReadable}</span>
        {isActiveTimer ? (
          <span className={styles.cardTimerBadge}>▶ {timerDisplay}</span>
        ) : (
          <button
            type="button"
            className={`${styles.cardPlayBtn} ${hovered ? styles.cardPlayBtnVisible : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onStartTimer(issue.id, issue.idReadable, issue.summary);
            }}
            title="Start timer"
          >
            <Play size={12} />
          </button>
        )}
      </div>
      <div className={styles.cardSummary}>{issue.summary}</div>
      {(issue.fields.priority || issue.fields.category) && (
        <div className={styles.cardChips}>
          {issue.fields.priority && (
            <ChipCell
              value={issue.fields.priority}
              colorMap={colors.Priority}
              field="priority"
              onEdit={(v) => onPatch(issue.id, 'priority', v)}
            />
          )}
          {issue.fields.category && (
            <ChipCell
              value={issue.fields.category}
              colorMap={colors.Category}
              field="category"
              onEdit={(v) => onPatch(issue.id, 'category', v)}
            />
          )}
        </div>
      )}
      {issue.fields.dueDate ? (
        <div className={styles.cardDueDate}>{formatDate(issue.fields.dueDate)}</div>
      ) : null}
    </div>
  );
}

function KanbanCard(props: KanbanCardInnerProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.issue.id,
    data: { issue: props.issue },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className={styles.draggableWrapper}
    >
      <KanbanCardInner {...props} />
    </div>
  );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

function KanbanColumn({
  title, issues, colorDot, colors, onSelectIssue, onPatch, onStartTimer, onAdd,
}: {
  title: string;
  issues: BoardIssue[];
  colorDot: string;
  colors: EffectiveColors;
  onSelectIssue: (id: string) => void;
  onPatch: (issueId: string, field: string, value: string | number | null) => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  onAdd: (summary: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(title === 'Done');
  const timer = useTimerStore((s) => s.timer);
  const [tick, setTick] = useState(0);
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: title });

  useEffect(() => {
    if (!timer?.phaseStartedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timer?.issueId, timer?.phaseStartedAt]);
  void tick;

  return (
    <div
      ref={setDropRef}
      className={`${styles.column} ${isOver ? styles.columnDropTarget : ''}`}
    >
      <div className={styles.columnHeader}>
        <button
          type="button"
          className={styles.columnHeaderBtn}
          onClick={() => setCollapsed((s) => !s)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={styles.columnDot} style={{ background: colorDot }} />
          <span className={styles.columnTitle}>{title}</span>
          <span className={styles.columnCount}>{issues.length}</span>
        </button>
      </div>
      {!collapsed && (
        <div className={styles.columnCards}>
          {issues.map((issue) => {
            const isActiveTimer = timer?.issueId === issue.id;
            return (
              <KanbanCard
                key={issue.id}
                issue={issue}
                colors={colors}
                onClick={() => onSelectIssue(issue.id)}
                onPatch={onPatch}
                onStartTimer={onStartTimer}
                isActiveTimer={isActiveTimer}
                timerDisplay={isActiveTimer && timer ? fmtMs(getTotalWorkMs(timer)) : ''}
              />
            );
          })}
          <AddKanbanCard onAdd={onAdd} />
        </div>
      )}
    </div>
  );
}

// ─── KanbanView ───────────────────────────────────────────────────────────────

export interface KanbanViewProps {
  groups: Array<[string, BoardIssue[]]>;
  groupColorMap: Record<string, string>;
  colors: EffectiveColors;
  groupByField: string; // e.g. 'status', 'priority', 'category' — field to patch on drop
  onSelectIssue: (issueId: string) => void;
  onPatch: (issueId: string, field: string, value: string | number | null) => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  onAddTask: (summary: string, groupValue: string) => void;
  onCrossBoardDrop?: (issue: BoardIssue, targetProjectId: string, targetProjectName: string) => void;
}

export function KanbanView({
  groups, groupColorMap, colors, groupByField,
  onSelectIssue, onPatch, onStartTimer, onAddTask, onCrossBoardDrop,
}: KanbanViewProps) {
  const [draggingIssue, setDraggingIssue] = useState<BoardIssue | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const setBoardDragIssue = useBoardDragStore((s) => s.setDraggingIssue);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  function trackMouse(e: MouseEvent) {
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }

  function handleDragStart(e: DragStartEvent) {
    const issue = (e.active.data.current as { issue: BoardIssue } | undefined)?.issue ?? null;
    setDraggingIssue(issue);
    setBoardDragIssue(issue);
    document.addEventListener('mousemove', trackMouse);
  }

  function handleDragEnd(e: DragEndEvent) {
    document.removeEventListener('mousemove', trackMouse);
    const { active, over } = e;
    const issue = (active.data.current as { issue: BoardIssue } | undefined)?.issue;
    setDraggingIssue(null);
    setBoardDragIssue(null);

    if (!over && issue && onCrossBoardDrop) {
      const { x, y } = lastMouseRef.current;
      for (const el of document.elementsFromPoint(x, y)) {
        const projectId = (el as HTMLElement).dataset?.navProjectId;
        const projectName = (el as HTMLElement).dataset?.navProjectName;
        if (projectId && projectName) {
          onCrossBoardDrop(issue, projectId, projectName);
          return;
        }
      }
      return;
    }

    if (!over || !issue) return;
    const targetColumn = over.id as string;
    const currentColumn = groups.find(([, iss]) => iss.some((i) => i.id === issue.id))?.[0];
    if (!currentColumn || currentColumn === targetColumn) return;
    onPatch(issue.id, groupByField, targetColumn);
  }

  if (groups.length === 0) {
    return (
      <div className={styles.empty}>
        <Text>No tasks in this project yet.</Text>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div data-testid="kanban-board" className={styles.board}>
        {groups.map(([groupVal, issues]) => (
          <KanbanColumn
            key={groupVal}
            title={groupVal}
            issues={issues}
            colorDot={groupColorMap[groupVal] ?? '#C4C4C4'}
            colors={colors}
            onSelectIssue={onSelectIssue}
            onPatch={onPatch}
            onStartTimer={onStartTimer}
            onAdd={(summary) => onAddTask(summary, groupVal)}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingIssue && (
          <KanbanCardInner
            issue={draggingIssue}
            colors={colors}
            onClick={() => {}}
            onPatch={() => {}}
            onStartTimer={() => {}}
            isActiveTimer={false}
            timerDisplay=""
            isDragOverlay
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
