// Settings → Workspace storage (VERM-53): this machine's configuration
// storage, a migration preview, activation and the return to legacy storage.
// Both changes ask for explicit confirmation in a dialog; nothing here runs
// on its own.

import { useState } from 'react';
import { Heading, Button, AttentionBox, Modal, ModalContent, ModalHeader, TextField } from '@vibe/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceMigrationResult } from '../../../../shared/workspaceMigration';
import { ACTIVE_WORKSPACE_QUERY_KEY, WORKSPACE_CONFIG_QUERY_KEY } from '../../workspace-nav/api';
import { STORAGE_STATUS_QUERY_KEY, previewAllowsActivation, previewLines, storageSummary } from '../storageStatus';
import styles from '../SettingsView.module.css';

type Outcome = { tone: 'positive' | 'negative'; title: string; text: string } | null;

export function WorkspaceStorageSection() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: STORAGE_STATUS_QUERY_KEY, queryFn: () => window.vermilian.getStorageStatus() });
  const [preview, setPreview] = useState<WorkspaceMigrationResult | null>(null);
  const [jiraName, setJiraName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'activate' | 'return' | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const jiraOption = () => (jiraName.trim() ? { jiraWorkspaceName: jiraName.trim() } : {});

  async function refreshAll() {
    await qc.invalidateQueries({ queryKey: STORAGE_STATUS_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: ACTIVE_WORKSPACE_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: ['board-config'] });
  }

  async function handlePreview() {
    setBusy(true);
    setOutcome(null);
    try {
      setPreview(await window.vermilian.planWorkspaceMigration(jiraOption()));
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate() {
    setBusy(true);
    try {
      const r = await window.vermilian.activateWorkspaceStorage({ confirmed: true, ...jiraOption() });
      setConfirm(null);
      setPreview(null);
      setOutcome(
        r.ok
          ? { tone: 'positive', title: r.outcome === 'joined' ? 'Joined per-workspace storage' : 'Per-workspace storage activated', text: r.message }
          : { tone: 'negative', title: 'Not activated', text: r.message + (r.backupFile ? ` Backup: ${r.backupFile}` : '') },
      );
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn() {
    setBusy(true);
    try {
      const r = await window.vermilian.returnToLegacyStorage({ confirmed: true });
      setConfirm(null);
      setOutcome(r.ok ? { tone: 'positive', title: 'Back on the shared configuration', text: r.message } : { tone: 'negative', title: 'Not returned', text: r.message });
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  const v = status.data;
  const summary = v ? storageSummary(v) : null;
  // A legacy machine blocked because another machine activated may join.
  const canActivate = v && v.mode === 'legacy' && !v.localCorrupt && (v.guard.allowed || v.guard.reason === 'activated-elsewhere');
  const joining = v?.marker === 'active';
  const canReturn = v && v.mode === 'per-workspace' && !v.localCorrupt;

  return (
    <section className={styles.card} data-testid="storage-section">
      <Heading>Workspace storage</Heading>

      {summary && (
        <AttentionBox data-testid="storage-summary" type={summary.tone} title={summary.title} text={summary.text} />
      )}
      {outcome && <AttentionBox data-testid="storage-outcome" type={outcome.tone} title={outcome.title} text={outcome.text} />}

      {canActivate && !joining && (
        <>
          <div>
            <TextField
              data-testid="storage-jira-name"
              placeholder="Name for a Jira workspace (optional)"
              value={jiraName}
              onChange={(x) => setJiraName(x)}
            />
            <p className={styles.hint}>
              Only if a Jira profile is set up: it becomes a new Jira workspace with this name. Leave empty to keep the profile as it is.
            </p>
          </div>
          <div className={styles.inline}>
            <Button data-testid="storage-preview-btn" kind="tertiary" loading={busy && confirm === null} onClick={() => void handlePreview()}>
              Preview migration
            </Button>
            <Button
              data-testid="storage-activate-btn"
              kind="secondary"
              disabled={!preview || !previewAllowsActivation(preview) || busy}
              onClick={() => setConfirm('activate')}
            >
              Activate per-workspace storage…
            </Button>
          </div>
          {preview && (
            <ul data-testid="storage-preview" className={styles.hint}>
              {previewLines(preview).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>
            Activation backs up the shared configuration on this computer, copies each workspace into its own article, checks that
            every credential reference works here, and only then switches. _vermilian-config is never changed or deleted.
          </p>
        </>
      )}

      {canActivate && joining && (
        <div>
          <Button data-testid="storage-activate-btn" kind="secondary" disabled={busy} onClick={() => setConfirm('activate')}>
            Use per-workspace storage on this computer…
          </Button>
          <p className={styles.hint}>
            Another computer already activated per-workspace storage. This computer joins it after checking that every workspace
            and credential reference works here. Nothing is migrated again.
          </p>
        </div>
      )}

      {canReturn && (
        <div>
          <Button data-testid="storage-return-btn" kind="tertiary" disabled={busy} onClick={() => setConfirm('return')}>
            Return to the shared configuration…
          </Button>
          <p className={styles.hint}>
            Allowed only while no configuration has changed since activation. Otherwise it is refused, because it would hide the
            newer configuration; see the RUNBOOK for manual reconciliation.
          </p>
        </div>
      )}

      {confirm && (
        <Modal id="storage-confirm-modal" data-testid="storage-confirm-modal" show onClose={() => { if (!busy) setConfirm(null); }} size="medium">
          <ModalHeader title={confirm === 'activate' ? 'Activate per-workspace storage?' : 'Return to the shared configuration?'} />
          <ModalContent>
            <AttentionBox
              type="warning"
              title={confirm === 'activate' ? 'This changes where configuration is stored' : 'Other computers will stop saving configuration'}
              text={
                confirm === 'activate'
                  ? 'After activation every computer still on the shared configuration stops saving configuration until it is activated too. Vermilian v1.2.10 and older cannot see this and keep writing _vermilian-config, which is then ignored.'
                  : 'Per-workspace storage is retired for every computer. Computers still using it block configuration changes until they return too. The workspace articles are kept.'
              }
            />
            <div className={styles.inline}>
              <Button
                data-testid="storage-confirm-btn"
                kind="primary"
                loading={busy}
                onClick={() => void (confirm === 'activate' ? handleActivate() : handleReturn())}
              >
                {confirm === 'activate' ? 'Activate' : 'Return'}
              </Button>
              <Button data-testid="storage-cancel-btn" kind="tertiary" disabled={busy} onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </ModalContent>
        </Modal>
      )}
    </section>
  );
}

