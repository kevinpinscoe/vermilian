import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader, Text, AttentionBox, Button, IconButton } from '@vibe/core';
import { CloseSmall, Delete, Play } from '@vibe/icons';
import type { IssueDetail } from '../../../shared/workspace';
import type { BoardIssueFields } from '../../../shared/workspace';
import { STATUS_OPTIONS, PRIORITY_OPTIONS, CATEGORY_OPTIONS } from '../../../shared/workspace';
import { STATUS_COLORS, PRIORITY_COLORS, CATEGORY_COLORS, getContrastColor } from '../project-board/colors';
import { useIssueDetail, usePatchIssue, useDeleteIssue } from './api';
import { useTimerStore, fmtMs, getTotalWorkMs } from '../../stores/timer';
import { useQueryClient } from '@tanstack/react-query';
import styles from './TaskDetailPanel.module.css';

// ─── Shared option lists ──────────────────────────────────────────────────────

const STATUS_LIST = [...STATUS_OPTIONS];
const PRIORITY_LIST = [...PRIORITY_OPTIONS];
const CATEGORY_LIST = [...CATEGORY_OPTIONS];

// Field advance order for Enter-key navigation
const ADVANCE_ORDER = [
  'summary', 'status', 'priority', 'category', 'dueDate',
  'ticket', 'ticketLink', 'trackingLink', 'notes',
];

// ─── Inline field editors ─────────────────────────────────────────────────────

interface TextFieldProps {
  value: string | null;
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
  onSave: (v: string | null) => void;
  onEnter?: () => void;
}

function TextField({ value, placeholder, multiline, readOnly, onSave, onEnter }: TextFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  function commit() {
    setEditing(false);
    onSave(draft.trim() || null);
  }

  function revert() {
    setEditing(false);
    setDraft(value ?? '');
  }

  if (readOnly) {
    return <span className={styles.fieldValue}>{value ?? '—'}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`${styles.fieldValue} ${styles.fieldValueEditable}`}
        onClick={() => { setDraft(value ?? ''); setEditing(true); }}
      >
        {value || <span className={styles.fieldPlaceholder}>{placeholder ?? 'Click to edit'}</span>}
      </button>
    );
  }

  if (multiline) {
    return (
      <textarea
        className={`${styles.fieldInput} ${styles.fieldInputMultiline}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') revert();
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { commit(); onEnter?.(); }
        }}
        autoFocus
      />
    );
  }

  return (
    <input
      type="text"
      className={styles.fieldInput}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); onEnter?.(); }
        if (e.key === 'Escape') revert();
      }}
      autoFocus
    />
  );
}

interface SelectFieldProps {
  value: string | null;
  options: string[];
  colorMap?: Record<string, string>;
  onSave: (v: string | null) => void;
  onEnter?: () => void;
}

function SelectField({ value, options, colorMap, onSave, onEnter }: SelectFieldProps) {
  const [editing, setEditing] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value || null;
    setEditing(false);
    onSave(v);
    onEnter?.();
  }

  const bg = colorMap && value ? (colorMap[value] ?? '#C4C4C4') : undefined;
  const color = bg ? getContrastColor(bg) : undefined;

  if (!editing) {
    return (
      <button
        type="button"
        className={`${styles.fieldValue} ${styles.fieldValueEditable} ${bg ? styles.chip : ''}`}
        style={bg ? { backgroundColor: bg, color } : undefined}
        onClick={() => setEditing(true)}
      >
        {value || <span className={styles.fieldPlaceholder}>—</span>}
      </button>
    );
  }

  return (
    <select
      className={styles.fieldSelect}
      value={value ?? ''}
      onChange={handleChange}
      onBlur={() => setEditing(false)}
      autoFocus
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

interface DateFieldProps {
  value: number | null;
  onSave: (v: number | null) => void;
  onEnter?: () => void;
}

function DateField({ value, onSave, onEnter }: DateFieldProps) {
  const [editing, setEditing] = useState(false);

  function toInputValue(epochMs: number | null): string {
    if (!epochMs) return '';
    const d = new Date(epochMs);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function fromInputValue(s: string): number | null {
    if (!s) return null;
    return new Date(s).getTime();
  }

  function formatDisplay(epochMs: number | null): string {
    if (!epochMs) return '—';
    return new Date(epochMs).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`${styles.fieldValue} ${styles.fieldValueEditable}`}
        onClick={() => setEditing(true)}
      >
        {value ? formatDisplay(value) : <span className={styles.fieldPlaceholder}>No date</span>}
      </button>
    );
  }

  return (
    <input
      type="date"
      className={styles.fieldInput}
      defaultValue={toInputValue(value)}
      onChange={(e) => {
        onSave(fromInputValue(e.target.value));
        setEditing(false);
        onEnter?.();
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
      autoFocus
    />
  );
}

interface LinkFieldProps {
  value: string | null;
  onSave: (v: string | null) => void;
  onEnter?: () => void;
}

function LinkField({ value, onSave, onEnter }: LinkFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  function commit() {
    setEditing(false);
    onSave(draft.trim() || null);
  }

  if (!editing) {
    if (value) {
      return (
        <span className={styles.fieldValue}>
          <button
            type="button"
            className={styles.linkValue}
            onClick={() => void window.vermilian.openExternalUrl(value)}
          >
            {value}
          </button>
          <button
            type="button"
            className={styles.editLinkBtn}
            onClick={() => { setDraft(value); setEditing(true); }}
          >
            Edit
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        className={`${styles.fieldValue} ${styles.fieldValueEditable}`}
        onClick={() => { setDraft(''); setEditing(true); }}
      >
        <span className={styles.fieldPlaceholder}>Add link</span>
      </button>
    );
  }

  return (
    <input
      type="url"
      className={styles.fieldInput}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); onEnter?.(); }
        if (e.key === 'Escape') setEditing(false);
      }}
      placeholder="https://..."
      autoFocus
    />
  );
}

// ─── Field row ────────────────────────────────────────────────────────────────

interface FieldRowProps {
  label: string;
  fieldName?: string;
  children: React.ReactNode;
}

function FieldRow({ label, fieldName, children }: FieldRowProps) {
  return (
    <div className={styles.fieldRow} data-field={fieldName}>
      <Text type="text2" weight="medium" className={styles.fieldLabel}>{label}</Text>
      <div className={styles.fieldValueWrap}>{children}</div>
    </div>
  );
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className={styles.deleteConfirm} data-testid="delete-confirm">
      <Text type="text2">Delete this task? This cannot be undone.</Text>
      <div className={styles.deleteActions}>
        <Button size="small" kind="secondary" onClick={onCancel}>Cancel</Button>
        <Button size="small" color="negative" onClick={onConfirm} data-testid="delete-confirm-btn">Delete</Button>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface TaskDetailPanelProps {
  issueId: string;
  projectShortName: string | null;
  onClose: () => void;
  onDeleted: () => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
  onStopAndLog: () => Promise<void>;
}

export function TaskDetailPanel({
  issueId,
  projectShortName,
  onClose,
  onDeleted,
  onStartTimer,
  onStopAndLog,
}: TaskDetailPanelProps) {
  const { data: issue, isLoading, isError, error, refetch } = useIssueDetail(issueId);
  const patchMutation = usePatchIssue(issueId, projectShortName);
  const deleteMutation = useDeleteIssue(projectShortName);
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stoppingTimer, setStoppingTimer] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useTimerStore((s) => s.timer);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (timer?.issueId !== issueId || timer.phaseStartedAt === null) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timer?.issueId, timer?.phaseStartedAt, issueId]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Optimistic update: immediately apply the change to the cache so the field
  // doesn't snap back to the old value while the API call is in flight.
  // On failure, the snapshot is restored and usePatchIssue shows an error toast.
  const patch = useCallback(
    (field: string, value: string | number | null) => {
      const snapshot = queryClient.getQueryData<IssueDetail>(['youtrack', 'issue', issueId]);
      if (snapshot) {
        const optimistic: IssueDetail = field === 'summary'
          ? { ...snapshot, summary: (value as string) ?? '' }
          : { ...snapshot, fields: { ...snapshot.fields, [field]: value } };
        queryClient.setQueryData(['youtrack', 'issue', issueId], optimistic);
      }
      patchMutation.mutate({ field, value }, {
        onError: () => {
          if (snapshot) queryClient.setQueryData(['youtrack', 'issue', issueId], snapshot);
        },
      });
    },
    [patchMutation, queryClient, issueId],
  );

  // Advance focus to the next field when Enter is pressed in a single-line editor.
  const advanceField = useCallback((fromField: string) => {
    const idx = ADVANCE_ORDER.indexOf(fromField);
    if (idx < 0 || idx >= ADVANCE_ORDER.length - 1) return;
    const next = ADVANCE_ORDER[idx + 1];
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-field="${next}"] button`);
    el?.click();
  }, []);

  function handleDelete() {
    deleteMutation.mutate(issueId, {
      onSuccess: (result) => {
        if (result.ok) onDeleted();
        setConfirmDelete(false);
      },
    });
  }

  function renderFields(f: BoardIssueFields) {
    return (
      <>
        <FieldRow label="Status" fieldName="status">
          <SelectField
            value={f.status}
            options={STATUS_LIST}
            colorMap={STATUS_COLORS}
            onSave={(v) => patch('status', v)}
            onEnter={() => advanceField('status')}
          />
        </FieldRow>
        <FieldRow label="Priority" fieldName="priority">
          <SelectField
            value={f.priority}
            options={PRIORITY_LIST}
            colorMap={PRIORITY_COLORS}
            onSave={(v) => patch('priority', v)}
            onEnter={() => advanceField('priority')}
          />
        </FieldRow>
        <FieldRow label="Category" fieldName="category">
          <SelectField
            value={f.category}
            options={CATEGORY_LIST}
            colorMap={CATEGORY_COLORS}
            onSave={(v) => patch('category', v)}
            onEnter={() => advanceField('category')}
          />
        </FieldRow>
        <FieldRow label="Due Date" fieldName="dueDate">
          <DateField
            value={f.dueDate}
            onSave={(v) => patch('dueDate', v)}
            onEnter={() => advanceField('dueDate')}
          />
        </FieldRow>
        <FieldRow label="Ticket" fieldName="ticket">
          <TextField
            value={f.ticket}
            placeholder="—"
            onSave={(v) => patch('ticket', v)}
            onEnter={() => advanceField('ticket')}
          />
        </FieldRow>
        <FieldRow label="Ticket link" fieldName="ticketLink">
          <LinkField
            value={f.ticketLink}
            onSave={(v) => patch('ticketLink', v)}
            onEnter={() => advanceField('ticketLink')}
          />
        </FieldRow>
        <FieldRow label="Tracking link" fieldName="trackingLink">
          <LinkField
            value={f.trackingLink}
            onSave={(v) => patch('trackingLink', v)}
            onEnter={() => advanceField('trackingLink')}
          />
        </FieldRow>
        <FieldRow label="Notes" fieldName="notes">
          <TextField
            value={f.notes}
            placeholder="Add notes…"
            multiline
            onSave={(v) => patch('notes', v)}
          />
        </FieldRow>
        <FieldRow label="Date entered">
          <TextField
            value={f.dateTimeEntered ? new Date(f.dateTimeEntered).toLocaleString() : null}
            readOnly
            onSave={() => { /* read-only */ }}
          />
        </FieldRow>
      </>
    );
  }

  return (
    <div ref={panelRef} data-testid="task-detail-panel" className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIdRow}>
            <Text type="text2" weight="medium" className={styles.issueId}>
              <span data-testid="detail-issue-id">{issue?.idReadable ?? issueId}</span>
            </Text>
            {patchMutation.isPending && (
              <span className={styles.savingBadge}>
                <Loader size={16} />
              </span>
            )}
          </div>
          {issue?.project && (
            <Text type="text2" className={styles.projectName}>
              <span data-testid="detail-project">{issue.project.name}</span>
            </Text>
          )}
        </div>
        <div className={styles.headerActions}>
          {timer?.issueId === issueId ? (
            <Button
              size="small"
              color="negative"
              onClick={async () => { setStoppingTimer(true); await onStopAndLog(); setStoppingTimer(false); }}
              loading={stoppingTimer}
            >
              ⏹ Stop ({fmtMs(getTotalWorkMs(timer))})
            </Button>
          ) : (
            <Button
              size="small"
              kind="secondary"
              leftIcon={Play}
              onClick={() => issue && onStartTimer(issueId, issue.idReadable, issue.summary)}
              disabled={!issue}
            >
              Start timer
            </Button>
          )}
          <IconButton
            icon={Delete}
            size="small"
            kind="tertiary"
            aria-label="Delete task"
            onClick={() => setConfirmDelete(true)}
          />
          <IconButton
            icon={CloseSmall}
            size="small"
            kind="tertiary"
            aria-label="Close panel"
            onClick={onClose}
          />
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <DeleteConfirm
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className={styles.loaderWrap}>
          <Loader size={32} />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className={styles.errorWrap}>
          <AttentionBox
            type="negative"
            title="Failed to load issue"
            text={(error as Error)?.message ?? 'An error occurred.'}
            onClose={() => refetch()}
          />
        </div>
      )}

      {/* Content */}
      {issue && !isLoading && (
        <div className={styles.body}>
          {/* Summary */}
          <div className={styles.summaryWrap} data-field="summary">
            <TextField
              value={issue.summary}
              placeholder="Summary"
              onSave={(v) => patch('summary', v ?? '')}
              onEnter={() => advanceField('summary')}
            />
          </div>

          <div className={styles.fields}>
            {renderFields(issue.fields)}
          </div>
        </div>
      )}
    </div>
  );
}
