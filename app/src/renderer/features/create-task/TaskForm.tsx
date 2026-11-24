import React, { useRef, useEffect } from 'react';
import { Text } from '@vibe/core';
import type { YouTrackProject } from '../../../shared/workspace';
import { CREATABLE_FIELD_DEFS } from '../../../shared/fields';
import type { CreateFieldKey } from '../../../shared/createFieldOptions';
import type { TaskFormOptions } from './useTaskFormOptions';
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
  relatedLink: string;
  notes: string;
  repoUrl: string;
}

export function makeDefaultFormState(
  projects: YouTrackProject[],
  defaultProjectId: string | null,
): FormState {
  // Only trust an explicit, verified active project. Guessing a fallback
  // (e.g. the first project in YouTrack's unsorted /api/admin/projects
  // response) risks silently landing on an unconfigured/demo project whose
  // Status or Category bundle doesn't match ours — better to make the user
  // choose explicitly than fail with a confusing YouTrack API error.
  const pid =
    defaultProjectId && projects.find((p) => p.id === defaultProjectId) ? defaultProjectId : '';
  // Every field starts empty. Status, Priority and Category take the
  // selected project's own defaults once its options are read (VERM-115);
  // nothing assumes a value such as "To do" exists.
  const base = Object.fromEntries(
    CREATABLE_FIELD_DEFS.map((d) => [d.key, '']),
  ) as Omit<FormState, 'summary' | 'projectId'>;
  return { ...base, summary: '', projectId: pid };
}

export function validateForm(form: FormState): {
  summaryEmpty: boolean;
  projectEmpty: boolean;
  ticketLinkInvalid: boolean;
  relatedLinkInvalid: boolean;
  repoUrlInvalid: boolean;
} {
  const formValues = form as unknown as Record<string, string>;
  const result: Record<string, boolean> = {
    summaryEmpty: !form.summary.trim(),
    projectEmpty: !form.projectId,
  };
  for (const def of CREATABLE_FIELD_DEFS) {
    if (!def.validate) continue;
    const value = formValues[def.key];
    result[`${def.key}Invalid`] = Boolean(value && def.validate(value));
  }
  return result as {
    summaryEmpty: boolean; projectEmpty: boolean; ticketLinkInvalid: boolean;
    relatedLinkInvalid: boolean; repoUrlInvalid: boolean;
  };
}

interface TaskFormProps {
  form: FormState;
  onChange: (form: FormState) => void;
  projects: YouTrackProject[];
  /** The selected project's options, from useTaskFormOptions (VERM-115). */
  fieldOptions: TaskFormOptions;
  loading?: boolean;
  apiError?: string | null;
  /** Offer to refresh the project's options beside the API error. */
  apiErrorRefresh?: boolean;
  projectMatchError?: boolean;
  autoFocusSummary?: boolean;
}

function OptionSelect({
  fieldKey,
  value,
  fieldOptions,
  disabled,
  onChange,
}: {
  fieldKey: CreateFieldKey;
  value: string;
  fieldOptions: TaskFormOptions;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const opt = fieldOptions.options?.[fieldKey];
  const absent = Boolean(opt && !opt.present);
  const flag = fieldOptions.flags[fieldKey];
  return (
    <>
      <select
        id={`ct-${fieldKey}`}
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || !fieldOptions.ready || absent}
      >
        {!fieldOptions.ready ? (
          <option value={value}>{fieldOptions.loading ? 'Loading…' : '—'}</option>
        ) : absent ? (
          <option value="">Not used in this project</option>
        ) : (
          <>
            <option value="">—</option>
            {opt?.values.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </>
        )}
      </select>
      {flag && (
        <span className={styles.fieldError} data-testid={`ct-flag-${fieldKey}`}>
          {flag}
        </span>
      )}
    </>
  );
}

export function TaskForm({
  form,
  onChange,
  projects,
  fieldOptions,
  loading,
  apiError,
  apiErrorRefresh,
  projectMatchError,
  autoFocusSummary,
}: TaskFormProps) {
  const summaryRef = useRef<HTMLInputElement>(null);

  const { summaryEmpty, ticketLinkInvalid, relatedLinkInvalid, repoUrlInvalid } = validateForm(form);

  useEffect(() => {
    if (autoFocusSummary) summaryRef.current?.focus();
  }, [autoFocusSummary]);

  function set(field: keyof FormState, value: string) {
    onChange({ ...form, [field]: value });
  }

  // Status/Priority/Category are re-derived from the new project's options
  // when they arrive (useTaskFormOptions).
  function handleProjectChange(projectId: string) {
    onChange({ ...form, projectId });
  }

  function handleOptionChange(key: CreateFieldKey, value: string) {
    fieldOptions.touch(key);
    set(key, value);
  }

  const projectsSorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {apiError && (
        <div className={styles.apiError}>
          <Text type="text2" style={{ color: 'var(--negative-color, #e2445c)' }}>
            {apiError}
          </Text>
          {apiErrorRefresh && (
            <button
              type="button"
              className={styles.inlineAction}
              data-testid="ct-refresh-options"
              onClick={fieldOptions.refresh}
              disabled={loading}
            >
              Refresh project options
            </button>
          )}
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
          {!form.projectId && <option value="">Select a project…</option>}
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
        {fieldOptions.error && (
          <span className={styles.fieldError} data-testid="ct-options-error">
            Could not load this project&apos;s fields: {fieldOptions.error}{' '}
            <button
              type="button"
              className={styles.inlineAction}
              data-testid="ct-options-retry"
              onClick={fieldOptions.retry}
            >
              Retry
            </button>
          </span>
        )}
      </div>

      {/* Priority + Status */}
      <div className={styles.row2}>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="ct-priority">
            Priority
          </label>
          <OptionSelect fieldKey="priority" value={form.priority} fieldOptions={fieldOptions} disabled={loading} onChange={(v) => handleOptionChange('priority', v)} />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="ct-status">
            Status
          </label>
          <OptionSelect fieldKey="status" value={form.status} fieldOptions={fieldOptions} disabled={loading} onChange={(v) => handleOptionChange('status', v)} />
        </div>
      </div>

      {/* Category + Due Date */}
      <div className={styles.row2}>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="ct-category">
            Category
          </label>
          <OptionSelect fieldKey="category" value={form.category} fieldOptions={fieldOptions} disabled={loading} onChange={(v) => handleOptionChange('category', v)} />
          {fieldOptions.inboxNote && (
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

      {/* Related link */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="ct-related-link">
          Related link
        </label>
        <input
          id="ct-related-link"
          type="url"
          className={`${styles.input} ${relatedLinkInvalid ? styles.inputError : ''}`}
          value={form.relatedLink}
          onChange={(e) => set('relatedLink', e.target.value)}
          placeholder="https://..."
          disabled={loading}
        />
        {relatedLinkInvalid && <span className={styles.fieldError}>Must be a valid URL.</span>}
      </div>

      {/* Repo URL */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="ct-repo-url">
          Repo URL
        </label>
        <input
          id="ct-repo-url"
          type="url"
          className={`${styles.input} ${repoUrlInvalid ? styles.inputError : ''}`}
          value={form.repoUrl}
          onChange={(e) => set('repoUrl', e.target.value)}
          placeholder="https://..."
          disabled={loading}
        />
        {repoUrlInvalid && <span className={styles.fieldError}>Must be a valid URL.</span>}
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
