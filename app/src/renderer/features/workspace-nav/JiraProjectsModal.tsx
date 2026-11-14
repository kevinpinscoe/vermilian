import React, { useEffect, useState } from 'react';
import { Modal, ModalContent, ModalHeader, Button, Loader } from '@vibe/core';
import { useQuery } from '@tanstack/react-query';
import type { WorkspaceDocument } from '../../../shared/workspaceSchema';
import { workspaceProjectIds } from '../../../shared/workspaceSchema';
import { withJiraProjects } from '../../../shared/workspaceSetup';
import styles from './AddProjectsModal.module.css';

interface JiraProjectsModalProps {
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}

export const workspaceJiraProjectsQueryKey = (workspaceId: string) => ['workspace', 'jira-projects', workspaceId] as const;

/**
 * Chooses a Jira workspace's projects (VERM-33). The list comes from Jira
 * through the workspace's own connection and credential; the selection is
 * saved to the workspace's own article. Nothing is written to Jira.
 */
export function JiraProjectsModal({ workspaceId, onClose, onSaved }: JiraProjectsModalProps) {
  const [base, setBase] = useState<WorkspaceDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The document the edit starts from: the base of the save's three-way merge.
  useEffect(() => {
    let live = true;
    void window.vermilian.readWorkspaceArticle(workspaceId).then((r) => {
      if (!live) return;
      if (!r.ok) setLoadError(r.message);
      else if (r.entry.status !== 'ok') setLoadError(r.entry.message);
      else {
        setBase(r.entry.document);
        setSelected(new Set(workspaceProjectIds(r.entry.document)));
      }
    });
    return () => { live = false; };
  }, [workspaceId]);

  const projects = useQuery({
    queryKey: workspaceJiraProjectsQueryKey(workspaceId),
    queryFn: () => window.vermilian.listWorkspaceJiraProjects(workspaceId),
    staleTime: 5 * 60 * 1000,
  });

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    if (!base || !projects.data?.ok) return;
    // Jira's own project order, then any selected key Jira no longer lists
    // (kept rather than silently dropped).
    const listed = projects.data.projects.map((p) => p.shortName);
    const keys = [...listed.filter((k) => selected.has(k)), ...[...selected].filter((k) => !listed.includes(k))];
    setSaving(true);
    setSaveError(null);
    try {
      const r = await window.vermilian.updateWorkspaceArticle(base, withJiraProjects(base, keys));
      if (!r.ok) { setSaveError(r.message); return; }
      onSaved();
      onClose();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const list = projects.data?.ok ? projects.data.projects : [];
  const missing = base ? workspaceProjectIds(base).filter((k) => !list.some((p) => p.shortName === k)) : [];
  const error = loadError ?? (projects.data && !projects.data.ok ? projects.data.message : null);

  return (
    <Modal id="jira-projects-modal" show onClose={onClose} size="medium">
      <ModalHeader title={base ? `Jira projects for “${base.name}”` : 'Jira projects'} />
      <ModalContent>
        <div className={styles.intro}>
          Choose which Jira projects this workspace shows. Only projects your Jira account can browse are listed.
          Nothing is changed in Jira.
        </div>

        {error ? (
          <div className={styles.empty} role="alert" data-testid="jira-projects-error">{error}</div>
        ) : !base || projects.isLoading ? (
          <Loader size="small" />
        ) : list.length === 0 && missing.length === 0 ? (
          <div className={styles.empty}>Your Jira account cannot browse any projects.</div>
        ) : (
          <div className={styles.list} data-testid="jira-projects-list">
            {list.map((p) => (
              <label key={p.id} className={styles.row} data-testid="jira-projects-row" data-project-key={p.shortName}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={selected.has(p.shortName)}
                  onChange={() => toggle(p.shortName)}
                  aria-label={`${p.name} (${p.shortName})`}
                />
                <span className={styles.projectName}>{p.name}</span>
                <span className={styles.origin}>{p.shortName}</span>
              </label>
            ))}
            {missing.map((k) => (
              <label key={k} className={styles.row} data-testid="jira-projects-row" data-project-key={k}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={selected.has(k)}
                  onChange={() => toggle(k)}
                  aria-label={k}
                />
                <span className={styles.projectName}>{k}</span>
                <span className={`${styles.origin} ${styles.originUnassigned}`}>not listed by Jira</span>
              </label>
            ))}
          </div>
        )}

        {saveError && <div className={styles.moveNotice} role="alert" data-testid="jira-projects-save-error">{saveError}</div>}

        <div className={styles.footer}>
          <Button kind="tertiary" onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
            data-testid="jira-projects-save"
            onClick={() => void handleSave()}
            disabled={!base || !projects.data?.ok || saving}
          >
            Save
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
}
