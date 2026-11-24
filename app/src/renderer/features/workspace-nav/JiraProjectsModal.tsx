import React, { useEffect, useState } from 'react';
import { Modal, ModalContent, ModalBasicLayout, ModalHeader, Button, Loader } from '@vibe/core';
import { useQuery } from '@tanstack/react-query';
import type { WorkspaceDocument, WorkspaceJiraBoard } from '../../../shared/workspaceSchema';
import { workspaceBoardIds, workspaceProjectIds } from '../../../shared/workspaceSchema';
import { withJiraBoards, withJiraProjects } from '../../../shared/workspaceSetup';
import styles from './AddProjectsModal.module.css';
import modalLayout from '../../components/ModalLayout.module.css';

interface JiraProjectsModalProps {
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}

export const workspaceJiraProjectsQueryKey = (workspaceId: string) => ['workspace', 'jira-projects', workspaceId] as const;
export const workspaceJiraBoardsQueryKey = (workspaceId: string) => ['workspace', 'jira-boards', workspaceId] as const;

/**
 * Chooses a Jira workspace's projects (VERM-33) and boards (VERM-59). Both
 * lists come from Jira through the workspace's own connection and credential;
 * the selection is saved to the workspace's own article. Nothing is written
 * to Jira. When the boards cannot be listed (a scoped token without the board
 * scope, say), projects can still be saved and the chosen boards are kept.
 */
export function JiraProjectsModal({ workspaceId, onClose, onSaved }: JiraProjectsModalProps) {
  const [base, setBase] = useState<WorkspaceDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedBoards, setSelectedBoards] = useState<Set<number>>(new Set());
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
        setSelectedBoards(new Set(workspaceBoardIds(r.entry.document)));
      }
    });
    return () => { live = false; };
  }, [workspaceId]);

  const projects = useQuery({
    queryKey: workspaceJiraProjectsQueryKey(workspaceId),
    queryFn: () => window.vermilian.listWorkspaceJiraProjects(workspaceId),
    staleTime: 5 * 60 * 1000,
  });

  const boardsQuery = useQuery({
    queryKey: workspaceJiraBoardsQueryKey(workspaceId),
    queryFn: () => window.vermilian.listWorkspaceJiraBoards(workspaceId),
    staleTime: 5 * 60 * 1000,
  });

  function toggleBoard(id: number) {
    setSelectedBoards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    // Boards likewise, in Jira's order; unlisted chosen ones are kept with
    // their saved names. With no board list, the chosen boards stay as saved.
    let chosenBoards: WorkspaceJiraBoard[] = base.jiraBoards ?? [];
    if (boardsQuery.data?.ok) {
      const listedBoards = boardsQuery.data.boards;
      chosenBoards = [
        ...listedBoards.filter((b) => selectedBoards.has(b.id)).map((b) => ({ id: b.id, name: b.name })),
        ...(base.jiraBoards ?? []).filter((b) => selectedBoards.has(b.id) && !listedBoards.some((l) => l.id === b.id)),
      ];
    }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await window.vermilian.updateWorkspaceArticle(base, withJiraBoards(withJiraProjects(base, keys), chosenBoards));
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
  const boardList = boardsQuery.data?.ok ? boardsQuery.data.boards : [];
  const boardError = boardsQuery.data && !boardsQuery.data.ok ? boardsQuery.data.message : null;
  const missingBoards = base && boardsQuery.data?.ok ? (base.jiraBoards ?? []).filter((b) => !boardList.some((l) => l.id === b.id)) : [];

  return (
    <Modal id="jira-projects-modal" show onClose={onClose} size="medium">
      <ModalBasicLayout className={modalLayout.layout}>
        <ModalHeader title={base ? `Jira projects and boards for “${base.name}”` : 'Jira projects and boards'} />
        <ModalContent>
          <div className={styles.intro}>
            Choose which Jira projects and boards this workspace shows. A board shows the issues its own filter picks,
            from any project. Only what your Jira account can see is listed. Nothing is changed in Jira.
          </div>

          <div className={styles.sectionLabel}>Projects</div>

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

          <div className={styles.sectionLabel}>Boards</div>
          {boardError ? (
            <div className={styles.empty} role="alert" data-testid="jira-boards-error">
              {boardError} Your chosen boards are kept as they are.
            </div>
          ) : !base || boardsQuery.isLoading ? (
            <Loader size="small" />
          ) : boardList.length === 0 && missingBoards.length === 0 ? (
            <div className={styles.empty}>Your Jira account cannot see any boards.</div>
          ) : (
            <div className={styles.list} data-testid="jira-boards-list">
              {boardList.map((b) => (
                <label key={b.id} className={styles.row} data-testid="jira-boards-row" data-board-id={b.id}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={selectedBoards.has(b.id)}
                    onChange={() => toggleBoard(b.id)}
                    aria-label={b.name}
                  />
                  <span className={styles.projectName}>{b.name}</span>
                  <span className={styles.origin}>{[b.type, b.projectKey].filter(Boolean).join(' · ')}</span>
                </label>
              ))}
              {missingBoards.map((b) => (
                <label key={b.id} className={styles.row} data-testid="jira-boards-row" data-board-id={b.id}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={selectedBoards.has(b.id)}
                    onChange={() => toggleBoard(b.id)}
                    aria-label={b.name}
                  />
                  <span className={styles.projectName}>{b.name}</span>
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
      </ModalBasicLayout>
    </Modal>
  );
}
