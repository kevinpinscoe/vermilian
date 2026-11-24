import React, { useEffect, useState } from 'react';
import { Modal, ModalContent, ModalBasicLayout, ModalHeader, Button, Loader } from '@vibe/core';
import type { WorkspaceDocument } from '../../../shared/workspaceSchema';
import { parseAiCredentialRefInput, withAiCredentialRef } from '../../../shared/workspaceAi';
import styles from './AddProjectsModal.module.css';
import modalLayout from '../../components/ModalLayout.module.css';

interface WorkspaceAiCredentialModalProps {
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Sets, changes or clears which Anthropic credential reference a workspace's
 * AI features use (VERM-47). It edits the reference only — the name of a
 * credential, whose value each machine configures in Settings — and saves
 * through the workspace's own article, leaving every other setting as it is.
 * Works the same for YouTrack and Jira workspaces.
 */
export function WorkspaceAiCredentialModal({ workspaceId, onClose, onSaved }: WorkspaceAiCredentialModalProps) {
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
        setDraft(r.entry.document.ai.credentialRef ?? '');
      }
    });
    return () => { live = false; };
  }, [workspaceId]);

  async function save(raw: string) {
    if (!base) return;
    const parsed = parseAiCredentialRefInput(raw);
    if (!parsed.ok) { setSaveError(parsed.message); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await window.vermilian.updateWorkspaceArticle(base, withAiCredentialRef(base, parsed.credentialRef));
      if (!r.ok) { setSaveError(r.message); return; }
      onSaved();
      onClose();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const current = base?.ai.credentialRef ?? null;

  return (
    <Modal id="workspace-ai-credential-modal" show onClose={onClose} size="small">
      <ModalBasicLayout className={modalLayout.layout}>
        <ModalHeader title={base ? `AI credential for “${base.name}”` : 'AI credential'} />
        <ModalContent>
          <div className={styles.intro}>
            The Anthropic credential reference this workspace&apos;s AI features use. Enter the reference&apos;s name,
            not a key — each machine sets its value in Settings. With None, AI is off for this workspace.
          </div>

          {loadError ? (
            <div className={styles.empty} role="alert" data-testid="workspace-ai-error">{loadError}</div>
          ) : !base ? (
            <Loader size="small" />
          ) : (
            <>
              <div data-testid="workspace-ai-current">Current: {current ?? 'None'}</div>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void save(draft); }}
                placeholder="e.g. anthropic-1"
                aria-label="Anthropic credential reference"
                data-testid="workspace-ai-input"
                autoComplete="off"
                spellCheck={false}
              />
              {saveError && <div className={styles.empty} role="alert" data-testid="workspace-ai-save-error">{saveError}</div>}
            </>
          )}

          <div className={styles.footer}>
            <Button kind="tertiary" onClick={onClose}>Cancel</Button>
            <Button kind="secondary" data-testid="workspace-ai-none" disabled={!base || saving} onClick={() => void save('')}>
              Set to None
            </Button>
            <Button data-testid="workspace-ai-save" disabled={!base || saving} onClick={() => void save(draft)}>
              Save
            </Button>
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}
