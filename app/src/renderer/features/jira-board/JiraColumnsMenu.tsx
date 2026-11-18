import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@vibe/core';
import { isAlwaysShownStatus } from './jiraBoard';
import { saveJiraHiddenStatuses } from './useJiraHiddenStatuses';
import styles from './JiraWorkspaceBoard.module.css';

interface JiraColumnsMenuProps {
  workspaceId: string;
  // Every status the board has a column for, in board order.
  statuses: string[];
  // The workspace's saved choice: status names currently hidden.
  hidden: string[];
  onSaved: () => void;
}

/**
 * The board header's "Columns…" menu (VERM-60): a checkbox per status column.
 * Unchecked columns are hidden. The choice is saved to the workspace's own
 * article, so it follows the workspace to every machine; nothing is written
 * to Jira. A hidden status no loaded issue is in is still listed, so it can
 * be shown again. In Progress is listed but locked on (VERM-67).
 */
export function JiraColumnsMenu({ workspaceId, statuses, hidden, onSaved }: JiraColumnsMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(hidden));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const listed = [...statuses, ...hidden.filter((s) => !statuses.includes(s))];

  function openMenu() {
    setDraft(new Set(hidden));
    setError(null);
    setOpen((o) => !o);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const problem = await saveJiraHiddenStatuses(workspaceId, listed.filter((s) => draft.has(s) && !isAlwaysShownStatus(s)));
      if (problem) { setError(problem); return; }
      onSaved();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.columnsMenu} ref={ref}>
      <Button kind="tertiary" size="small" data-testid="jira-columns-btn" onClick={openMenu} aria-expanded={open}>
        Columns…
      </Button>
      {open && (
        <div className={styles.columnsPopover} role="dialog" aria-label="Board columns" data-testid="jira-columns-menu">
          <div className={styles.columnsHint}>Unchecked columns are hidden on this workspace's board.</div>
          {listed.length === 0 && <div className={styles.columnsHint}>No columns yet.</div>}
          {listed.map((status) => (
            <label key={status} className={styles.columnsRow} title={isAlwaysShownStatus(status) ? 'In Progress is always shown.' : undefined}>
              <input
                type="checkbox"
                data-testid="jira-column-toggle"
                data-status={status}
                checked={isAlwaysShownStatus(status) || !draft.has(status)}
                disabled={isAlwaysShownStatus(status)}
                onChange={() =>
                  setDraft((prev) => {
                    const n = new Set(prev);
                    if (n.has(status)) n.delete(status);
                    else n.add(status);
                    return n;
                  })
                }
              />
              <span>{status}</span>
            </label>
          ))}
          {error && <div className={styles.error} role="alert" data-testid="jira-columns-error">{error}</div>}
          <div className={styles.columnsFooter}>
            <Button kind="tertiary" size="small" onClick={() => setOpen(false)}>Cancel</Button>
            <Button kind="primary" size="small" data-testid="jira-columns-save" onClick={() => void save()} disabled={saving}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
