import React, { useEffect, useState } from 'react';
import { Modal, ModalContent, ModalBasicLayout, ModalHeader, Button, Loader } from '@vibe/core';
import type { WorkspaceDocument } from '../../../shared/workspaceSchema';
import { masterPlanArticleIdOf, parseMasterPlanArticleIdInput, withMasterPlanArticle } from '../../../shared/workspaceMasterPlan';
import styles from './AddProjectsModal.module.css';
import modalLayout from '../../components/ModalLayout.module.css';

interface WorkspaceMasterPlanModalProps {
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Sets, changes or clears which YouTrack article a workspace's Priority Desk
 * uses as its master plan (VERM-48). It edits the article ID only — it never
 * creates, copies or changes an article — and saves through the workspace's
 * own article, leaving every other setting as it is. A Jira workspace has no
 * YouTrack connection, so it has no master plan.
 */
export function WorkspaceMasterPlanModal({ workspaceId, onClose, onSaved }: WorkspaceMasterPlanModalProps) {
  const [base, setBase] = useState<WorkspaceDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
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
        setDraft(masterPlanArticleIdOf(r.entry.document) ?? '');
      }
    });
    return () => { live = false; };
  }, [workspaceId]);

  async function save(raw: string) {
    if (!base) return;
    const parsed = parseMasterPlanArticleIdInput(raw);
    if (!parsed.ok) { setSaveError(parsed.message); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await window.vermilian.updateWorkspaceArticle(base, withMasterPlanArticle(base, parsed.articleId));
      if (!r.ok) { setSaveError(r.message); return; }
      onSaved();
      onClose();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const jira = base?.backend.kind === 'jira';
  const current = base ? masterPlanArticleIdOf(base) : null;

  return (
    <Modal id="workspace-master-plan-modal" show onClose={onClose} size="small">
      <ModalBasicLayout className={modalLayout.layout}>
        <ModalHeader title={base ? `Master plan for “${base.name}”` : 'Master plan'} />
        <ModalContent>
          <div className={styles.intro}>
            The YouTrack article this workspace&apos;s Priority Desk reads as its master plan, by article ID (shown
            in the article&apos;s URL, such as VERM-A-12). It is read through this workspace&apos;s own YouTrack
            connection. With None, the workspace has no master plan.
          </div>

          {loadError ? (
            <div className={styles.empty} role="alert" data-testid="workspace-master-plan-error">{loadError}</div>
          ) : !base ? (
            <Loader size="small" />
          ) : jira ? (
            <div className={styles.empty} data-testid="workspace-master-plan-jira">
              A Jira workspace has no YouTrack connection, so it cannot have a master plan.
            </div>
          ) : (
            <>
              <div data-testid="workspace-master-plan-current">Current: {current ?? 'None'}</div>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void save(draft); }}
                placeholder="e.g. VERM-A-12"
                aria-label="Master plan article ID"
                data-testid="workspace-master-plan-input"
                autoComplete="off"
                spellCheck={false}
              />
              {saveError && <div className={styles.empty} role="alert" data-testid="workspace-master-plan-save-error">{saveError}</div>}
            </>
          )}

          <div className={styles.footer}>
            <Button kind="tertiary" onClick={onClose}>{jira ? 'Close' : 'Cancel'}</Button>
            {!jira && (
              <>
                <Button kind="secondary" data-testid="workspace-master-plan-none" disabled={!base || saving} onClick={() => void save('')}>
                  Set to None
                </Button>
                <Button data-testid="workspace-master-plan-save" disabled={!base || saving} onClick={() => void save(draft)}>
                  Save
                </Button>
              </>
            )}
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}
