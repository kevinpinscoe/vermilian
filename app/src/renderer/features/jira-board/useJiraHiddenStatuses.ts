// The workspace's hidden status columns (VERM-60), switched from the board's
// Status filter (VERM-67). The choice is saved to the workspace's own article,
// so it follows the workspace to every computer; nothing is written to Jira.
import { useCallback, useEffect, useState } from 'react';
import { withJiraHiddenStatuses } from '../../../shared/workspaceSetup';
import { toggleHiddenStatus } from './jiraBoard';

/** Saves the hidden list; returns what went wrong, or null. */
export async function saveJiraHiddenStatuses(workspaceId: string, hidden: string[]): Promise<string | null> {
  // The document the edit starts from: the base of the save's three-way merge.
  const read = await window.vermilian.readWorkspaceArticle(workspaceId);
  if (!read.ok) return read.message;
  if (read.entry.status !== 'ok') return read.entry.message;
  const base = read.entry.document;
  const r = await window.vermilian.updateWorkspaceArticle(base, withJiraHiddenStatuses(base, hidden));
  return r.ok ? null : r.message;
}

export function useJiraHiddenStatuses(workspaceId: string, saved: string[], onSaved: () => void) {
  // What was just chosen, shown until the reloaded workspace carries it.
  const [pending, setPending] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedKey = JSON.stringify(saved);

  useEffect(() => { setPending(null); }, [savedKey, workspaceId]);

  const hidden = pending ?? saved;

  const toggle = useCallback(async (status: string) => {
    const next = toggleHiddenStatus(hidden, status);
    setPending(next);
    setSaving(true);
    setError(null);
    try {
      const problem = await saveJiraHiddenStatuses(workspaceId, next);
      if (problem) {
        setPending(null);
        setError(problem);
      } else {
        onSaved();
      }
    } catch (e) {
      setPending(null);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [hidden, onSaved, workspaceId]);

  return { hidden, saving, error, toggle };
}
