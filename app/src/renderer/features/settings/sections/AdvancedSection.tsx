import React, { useState } from 'react';
import { Heading, Button, AttentionBox, Modal, ModalContent, ModalHeader } from '@vibe/core';
import { useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../../../stores/toast';
import type { RunwayImportPreview } from '../../../../shared/ipc';
import { importPreviewRows, importSuccessMessage, importWarningTexts } from '../runwayImport';
import styles from '../SettingsView.module.css';

interface Props {
  onReset: () => Promise<void>;
}

export function AdvancedSection({ onReset }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importPreview, setImportPreview] = useState<RunwayImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  async function handleForceResync() {
    setResyncing(true);
    try {
      const result = await window.vermilian.forceResyncWorkspaceConfig();
      if (result.ok) {
        await qc.invalidateQueries({ queryKey: ['workspace', 'config'] });
        await qc.invalidateQueries({ queryKey: ['board-config'] });
        await qc.invalidateQueries({ queryKey: ['youtrack', 'projects'] });
        showToast('positive', 'Resynced workspace configuration from YouTrack.');
      } else {
        showToast('negative', result.error ?? 'Resync failed.');
      }
    } finally {
      setResyncing(false);
    }
  }

  async function handleExportRunway() {
    setExporting(true);
    try {
      const result = await window.vermilian.runwayExportSnapshot();
      if (!result.ok) {
        showToast('negative', `Runway snapshot not exported: ${result.error}`);
      } else if (!result.canceled) {
        const { runway_entry = 0, dismissal = 0 } = result.snapshot.rowCounts;
        showToast(
          'positive',
          `Exported Runway snapshot (${runway_entry} entries, ${dismissal} dismissals) to ${result.snapshot.path}`,
        );
      }
    } finally {
      setExporting(false);
    }
  }

  async function handlePreviewImport() {
    setPreviewing(true);
    try {
      const result = await window.vermilian.runwayImportPreview();
      if (!result.ok) {
        showToast('negative', `Runway snapshot not imported: ${result.error}`);
      } else if (!result.canceled) {
        setImportPreview(result.preview);
      }
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCancelImport() {
    const preview = importPreview;
    setImportPreview(null);
    if (preview) await window.vermilian.runwayImportCancel({ token: preview.token });
  }

  async function handleConfirmImport() {
    if (!importPreview) return;
    setImporting(true);
    try {
      const result = await window.vermilian.runwayImportConfirm({ token: importPreview.token });
      setImportPreview(null);
      if (result.ok) {
        // Every Jira workspace's Runway list: cards, desk, ranks and Why now.
        await qc.invalidateQueries({ queryKey: ['workspace', 'jira-runway'] });
        showToast('positive', importSuccessMessage(result.result), 8000);
        if (result.result.pruneWarning) showToast('warning', result.result.pruneWarning);
      } else {
        const backup = result.backupPath ? ` Backup: ${result.backupPath}` : '';
        showToast('negative', `Runway snapshot not imported: ${result.error}${backup}`);
        await qc.invalidateQueries({ queryKey: ['workspace', 'jira-runway'] });
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className={styles.card}>
      <Heading>Advanced</Heading>

      {!confirming ? (
        <div>
          <Button kind="secondary" onClick={() => setConfirming(true)}>
            Reset to defaults
          </Button>
        </div>
      ) : (
        <>
          <AttentionBox
            type="warning"
            title="Reset settings?"
            text="Reset all non-credential settings to their defaults? Your YouTrack token and Claude API key will be kept."
          />
          <div className={styles.inline}>
            <Button
              kind="primary"
              onClick={async () => {
                await onReset();
                setConfirming(false);
              }}
            >
              Reset
            </Button>
            <Button kind="tertiary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}

      <div>
        <Button kind="tertiary" onClick={() => window.vermilian.openUserData()}>
          Open config folder
        </Button>
      </div>

      <div>
        <Button
          data-testid="force-resync-btn"
          kind="tertiary"
          loading={resyncing}
          onClick={() => void handleForceResync()}
        >
          Force resync from server
        </Button>
        <p className={styles.hint}>
          Discards the cached workspace/project layout and re-fetches it from YouTrack,
          dropping any project assignments that no longer exist. Use this if projects or
          workspaces look empty or wrong on every machine, not just this one.
        </p>
      </div>

      <div>
        <Button
          data-testid="runway-export-btn"
          kind="tertiary"
          loading={exporting}
          onClick={() => void handleExportRunway()}
        >
          Export Runway snapshot…
        </Button>
        <p className={styles.hint}>
          Saves a copy of the local Runway database — Focus, rank, Why now and
          dismissals for Jira issues in every workspace — to a file you choose. It is
          a consistent snapshot taken while Vermilian keeps running, and it never
          replaces an existing file.
        </p>
      </div>

      <div>
        <Button
          data-testid="runway-import-btn"
          kind="tertiary"
          loading={previewing}
          onClick={() => void handlePreviewImport()}
        >
          Import Runway snapshot…
        </Button>
        <p className={styles.hint}>
          Replaces the local Runway database with a snapshot exported by Vermilian —
          for every workspace at once. You see what will change and confirm first, and
          the current data is backed up automatically before anything is replaced.
          Nothing is sent to Jira or YouTrack.
        </p>
      </div>

      {importPreview && (
        <Modal
          id="runway-import-modal"
          data-testid="runway-import-modal"
          show
          onClose={() => { if (!importing) void handleCancelImport(); }}
          size="medium"
        >
          <ModalHeader title="Replace all Runway metadata?" />
          <ModalContent>
            <AttentionBox
              className={styles.importWarning}
              type="warning"
              title="This replaces Runway data for every workspace"
              text="The Runway order of every workspace, and Focus, rank, Why now and dismissals for Jira issues in all workspaces on this computer, will be replaced by the snapshot. Records not in the snapshot are removed."
            />
            {importPreview.warnings.length > 0 && (
              <div data-testid="runway-import-replace-warning">
                {importWarningTexts(importPreview).map((text) => (
                  <AttentionBox
                    key={text}
                    className={styles.importWarning}
                    type="negative"
                    title="Local Runway changes may be lost"
                    text={text}
                  />
                ))}
              </div>
            )}
            <dl className={styles.importPreview}>
              {importPreviewRows(importPreview).map((row) => (
                <React.Fragment key={row.testId}>
                  <dt>{row.label}</dt>
                  <dd data-testid={row.testId}>{row.value}</dd>
                </React.Fragment>
              ))}
            </dl>
            <div className={styles.inline}>
              <Button
                data-testid="runway-import-confirm"
                kind="primary"
                loading={importing}
                onClick={() => void handleConfirmImport()}
              >
                Replace Runway data
              </Button>
              <Button
                data-testid="runway-import-cancel"
                kind="tertiary"
                disabled={importing}
                onClick={() => void handleCancelImport()}
              >
                Cancel
              </Button>
            </div>
          </ModalContent>
        </Modal>
      )}
    </section>
  );
}
