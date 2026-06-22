import React, { useRef, useEffect, useState } from 'react';
import { Text } from '@vibe/core';
import type { YouTrackProject } from '../../../shared/workspace';
import { STATUS_OPTIONS, PRIORITY_OPTIONS, CATEGORY_OPTIONS } from '../../../shared/workspace';
import styles from './CreateTaskModal.module.css';

export interface FormState {
  summary: string;
  projectId: string;
  status: string;
  priority: string;
  category: string;
  dueDate: string;
  ticket: string;
  ticketLink: string;
  trackingLink: string;
  notes: string;
}

function isInboxProject(projects: YouTrackProject[], projectId: string): boolean {
  const p = projects.find((pr) => pr.id === projectId);
  return Boolean(p && p.name.toLowerCase().includes('inbox'));
}

function isValidUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export function makeDefaultFormState(
  projects: YouTrackProject[],
  defaultProjectId: string | null,
): FormState {
  const pid =
    defaultProjectId && projects.find((p) => p.id === defaultProjectId)
      ? defaultProjectId
      : (projects[0]?.id ?? '');
  const inbox = isInboxProject(projects, pid);
  return {
    summary: '',
    projectId: pid,
    status: 'To do',
    priority: 'Normal',
    category: inbox ? 'INBOX' : '',
    dueDate: '',
    ticket: '',
    ticketLink: '',
    trackingLink: '',
    notes: '',
  };
}

export function validateForm(form: FormState) {
  return {
    summaryEmpty: !form.summary.trim(),
    ticketLinkInvalid: Boolean(form.ticketLink && !isValidUrl(form.ticketLink)),
    trackingLinkInvalid: Boolean(form.trackingLink && !isValidUrl(form.trackingLink)),
  };
}

interface TaskFormProps {
  form: FormState;
  onChange: (form: FormState) => void;
  projects: YouTrackProject[];
  loading?: boolean;
  apiError?: string | null;
  projectMatchError?: boolean;
  autoFocusSummary?: boolean;
}

export function TaskForm({
  form,
  onChange,
  projects,
  loading,
  apiError,
  projectMatchError,
  autoFocusSummary,
}: TaskFormProps) {
  const summaryRef = useRef<HTMLInputElement>(null);
  const [inboxCategoryNote, setInboxCategoryNote] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);

  const { summaryEmpty, ticketLinkInvalid, trackingLinkInvalid } = validateForm(form);

  useEffect(() => {
    if (autoFocusSummary) summaryRef.current?.focus();
  }, [autoFocusSummary]);

  function set(field: keyof FormState, value: string) {
    onChange({ ...form, [field]: value });
  }

  function handleProjectChange(projectId: string) {
    const inbox = isInboxProject(projects, projectId);
    let category = form.category;
    if (inbox && !categoryTouched && !category) {
      category = 'INBOX';
      setInboxCategoryNote(true);
    } else {
      setInboxCategoryNote(false);
    }
    onChange({ ...form, projectId, category });
  }

  function handleCategoryChange(category: string) {
    setCategoryTouched(true);
    setInboxCategoryNote(false);
    onChange({ ...form, category });
  }

  const projectsSorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {apiError && (
        <div className={styles.apiError}>
          <Text type="text2" style={{ color: 'var(--negative-color, #e2445c)' }}>
            {apiError}
          </Text>
        </div>
      )}

      {/* Summary */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="ct-summary">
          Summary <span className={styles.required}>*</span>
        </label>
        <input
          ref={summaryRef}
          id="ct-summary"
          type="text"
          className={styles.input}
          value={form.summary}
          onChange={(e) => set('summary', e.target.value)}
          placeholder="What needs to be done?"
          disabled={loading}
        />
        {summaryEmpty && form.summary !== '' && (
          <span className={styles.fieldError}>Summary is required.</span>
        )}
      </div>

      {/* Project */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="ct-project">
          Project <span className={styles.required}>*</span>
        </label>
        <select
          id="ct-project"
          className={styles.select}
          value={form.projectId}
          onChange={(e) => handleProjectChange(e.target.value)}
          disabled={loading}
        >
          {projectsSorted.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {projectMatchError && (
          <span className={styles.fieldError}>
            Could not match a project — please select one.
          </span>
        )}
      </div>

      {/* Priority + Status */}
      <div className={styles.row2}>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="ct-priority">
            Priority
          </label>
          <select
            id="ct-priority"
            className={styles.select}
            value={form.priority}
            onChange={(e) => set('priority', e.target.value)}
            disabled={loading}
          >
            <option value="">—</option>
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="ct-status">
            Status
          </label>
          <select
            id="ct-status"
            className={styles.select}
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
            disabled={loading}
          >
            <option value="">—</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Category + Due Date */}
      <div className={styles.row2}>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="ct-category">
            Category
          </label>
          <select
            id="ct-category"
            className={styles.select}
            value={form.category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            disabled={loading}
          >
            <option value="">—</option>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {inboxCategoryNote && (
            <span className={styles.fieldNote}>Auto-set because this is an Inbox project.</span>
          )}
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="ct-due">
            Due Date
          </label>
          <input
            id="ct-due"
            type="date"
            className={styles.input}
            value={form.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
            disabled={loading}
          />
        </div>
      </div>

      {/* Ticket */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="ct-ticket">
          Ticket #
        </label>
        <input
          id="ct-ticket"
          type="text"
          className={styles.input}
          value={form.ticket}
          onChange={(e) => set('ticket', e.target.value)}
          placeholder="JIRA-123"
          disabled={loading}
        />
      </div>

      {/* Ticket link */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="ct-ticket-link">
          Ticket link
        </label>
        <input
          id="ct-ticket-link"
          type="url"
          className={`${styles.input} ${ticketLinkInvalid ? styles.inputError : ''}`}
          value={form.ticketLink}
          onChange={(e) => set('ticketLink', e.target.value)}
          placeholder="https://..."
          disabled={loading}
        />
        {ticketLinkInvalid && <span className={styles.fieldError}>Must be a valid URL.</span>}
      </div>

      {/* Tracking link */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="ct-tracking-link">
          Tracking link
        </label>
        <input
          id="ct-tracking-link"
          type="url"
          className={`${styles.input} ${trackingLinkInvalid ? styles.inputError : ''}`}
          value={form.trackingLink}
          onChange={(e) => set('trackingLink', e.target.value)}
          placeholder="https://..."
          disabled={loading}
        />
        {trackingLinkInvalid && <span className={styles.fieldError}>Must be a valid URL.</span>}
      </div>

      {/* Notes */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="ct-notes">
          Notes
        </label>
        <textarea
          id="ct-notes"
          className={styles.textarea}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          disabled={loading}
        />
      </div>
    </>
  );
}
