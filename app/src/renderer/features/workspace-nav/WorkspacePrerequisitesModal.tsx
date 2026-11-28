import React, { useEffect, useState } from 'react';
import { useUnsavedDraft } from '../quit/useUnsavedDraft';
import { Modal, ModalContent, ModalBasicLayout, ModalHeader, Button, Loader } from '@vibe/core';
import type { PrerequisiteSide } from '../../../shared/issueLink';
import type { WorkspaceDocument } from '../../../shared/workspaceSchema';
import {
  describePrerequisiteLinkTypes,
  entriesFromRows,
  prerequisiteLinkTypesOf,
  prerequisiteRows,
  withPrerequisiteLinkTypes,
  type PrerequisiteRow,
  usesDefaultPrerequisiteLinkTypes,
  type TrackerLinkType,
} from '../../../shared/workspacePrerequisites';
import styles from './AddProjectsModal.module.css';
import modalLayout from '../../components/ModalLayout.module.css';

interface WorkspacePrerequisitesModalProps {
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Chooses which link types make a linked ticket a prerequisite in this
 * workspace (VERM-96), from the link types the workspace's own tracker
 * defines: for each, the wording that answers "what am I waiting on?" —
 * "depends on" in YouTrack, "is blocked by" in Jira. Subtask and undirected
 * types are shown but can't be chosen. Saved through the workspace's own
 * article, leaving every other setting as it is. When the tracker can't be
 * read, the saved choice is shown and can't be edited; closing keeps it, and
 * an explicit Reset to default still removes it (it needs no tracker read).
 */
export function WorkspacePrerequisitesModal({ workspaceId, onClose, onSaved }: WorkspacePrerequisitesModalProps) {
  const [base, setBase] = useState<WorkspaceDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [types, setTypes] = useState<TrackerLinkType[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [rows, setRows] = useState<PrerequisiteRow[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The document the edit starts from (the base of the save's three-way
  // merge), and the tracker's link types, read side by side.
  useEffect(() => {
    let live = true;
    void Promise.all([
      window.vermilian.readWorkspaceArticle(workspaceId),
      window.vermilian.workspaceLinkTypes(workspaceId).catch((e: unknown) => ({ ok: false as const, message: (e as Error).message })),
    ]).then(([doc, linkTypes]) => {
      if (!live) return;
      if (!doc.ok) { setLoadError(doc.message); return; }
      if (doc.entry.status !== 'ok') { setLoadError(doc.entry.message); return; }
      setBase(doc.entry.document);
      if (linkTypes.ok) {
        setTypes(linkTypes.types);
        setRows(prerequisiteRows(linkTypes.types, prerequisiteLinkTypesOf(doc.entry.document)));
      } else {
        setTypesError(linkTypes.message);
      }
    });
    return () => { live = false; };
  }, [workspaceId]);

  // Quitting asks about prerequisite choices not yet saved (VERM-123).
  const prerequisitesDirty = base && types
    ? JSON.stringify(entriesFromRows(rows)) !==
      JSON.stringify(entriesFromRows(prerequisiteRows(types, prerequisiteLinkTypesOf(base))))
    : false;
  useUnsavedDraft(
    `workspace-prerequisites-${workspaceId}`, `Prerequisites for “${base?.name ?? 'workspace'}”`,
    prerequisitesDirty, () => save(false),
  );

  async function save(reset: boolean): Promise<boolean> {
    if (!base) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const next = withPrerequisiteLinkTypes(base, reset ? null : entriesFromRows(rows));
      const r = await window.vermilian.updateWorkspaceArticle(base, next);
      if (!r.ok) { setSaveError(r.message); return false; }
      onSaved();
      onClose();
      return true;
    } catch (e) {
      setSaveError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const choose = (type: string, side: PrerequisiteSide | null) =>
    setRows((rs) => rs.map((r) => (r.type === type ? { ...r, side } : r)));

  const tracker = base?.backend.kind === 'jira' ? 'Jira' : 'YouTrack';
  const editable = Boolean(base && types);
  // Reset needs only the workspace article, so it stays available while the
  // tracker can't be read — when there is a saved choice to reset.
  const saved = Boolean(base && !usesDefaultPrerequisiteLinkTypes(base));
  const canReset = editable || saved;

  return (
    <Modal id="workspace-prerequisites-modal" show onClose={onClose} size="medium">
      <ModalBasicLayout className={modalLayout.layout}>
        <ModalHeader title={base ? `Prerequisites for “${base.name}”` : 'Prerequisites'} />
        <ModalContent>
          <div className={styles.intro}>
            Which links mean a ticket is waiting on another. For each link type, choose the wording that answers
            &ldquo;What am I waiting on?&rdquo; &mdash; for example &ldquo;depends on&rdquo; in YouTrack or
            &ldquo;is blocked by&rdquo; in Jira. Read from this workspace&apos;s own {tracker} connection; nothing is
            written to {tracker}.
          </div>

          {loadError ? (
            <div className={styles.empty} role="alert" data-testid="workspace-prerequisites-error">{loadError}</div>
          ) : !base ? (
            <Loader size="small" />
          ) : (
            <>
              <div data-testid="workspace-prerequisites-current">
                Current: {describePrerequisiteLinkTypes(base, types ?? [])}
              </div>
              {typesError ? (
                <div className={styles.moveNotice} role="alert" data-testid="workspace-prerequisites-types-error">
                  {tracker}&apos;s link types could not be read: {typesError} Your saved choice is kept and can&apos;t be
                  edited until {tracker} can be reached.{saved ? ' You can still reset it to the default.' : ''}
                </div>
              ) : !types ? (
                <Loader size="small" />
              ) : (
                <div className={styles.list} data-testid="workspace-prerequisites-list">
                  {rows.map((r) => (
                    <PrerequisiteRowView key={r.type} row={r} onChoose={(side) => choose(r.type, side)} />
                  ))}
                </div>
              )}
              {saveError && <div className={styles.moveNotice} role="alert" data-testid="workspace-prerequisites-save-error">{saveError}</div>}
            </>
          )}

          <div className={styles.footer}>
            <Button kind="tertiary" data-testid="workspace-prerequisites-close" onClick={onClose}>{editable ? 'Cancel' : 'Close'}</Button>
            {canReset && (
              <Button kind="secondary" data-testid="workspace-prerequisites-reset" disabled={saving} onClick={() => void save(true)}>
                Reset to default
              </Button>
            )}
            {editable && (
              <Button data-testid="workspace-prerequisites-save" disabled={saving} onClick={() => void save(false)}>
                Save
              </Button>
            )}
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}

function PrerequisiteRowView({ row, onChoose }: { row: PrerequisiteRow; onChoose: (side: PrerequisiteSide | null) => void }) {
  const name = `prereq-${row.type}`;
  const option = (side: PrerequisiteSide | null, label: string) => (
    <label key={side ?? 'none'} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
      <input
        type="radio"
        name={name}
        checked={row.side === side}
        disabled={Boolean(row.problem)}
        onChange={() => onChoose(side)}
        data-testid="workspace-prerequisites-option"
        data-side={side ?? 'none'}
      />{' '}
      {label}
    </label>
  );
  // A saved type the tracker no longer lists has no wordings to offer: it
  // can be kept as saved or cleared.
  const sides: Array<[PrerequisiteSide, string]> = row.onTracker
    ? [['inward', `This ticket ${row.inward} it`], ['outward', `This ticket ${row.outward} it`]]
    : row.side ? [[row.side, `As saved (${row.side} side)`]] : [];
  return (
    <div className={styles.row} data-testid="workspace-prerequisites-row" data-link-type={row.type} title={row.problem ?? undefined}>
      <span className={styles.projectName}>{row.type}</span>
      {row.problem ? (
        <span className={styles.origin} data-testid="workspace-prerequisites-disabled">{row.problem}</span>
      ) : (
        <span>
          {option(null, 'Not a prerequisite')}
          {sides.map(([side, label]) => option(side, label))}
          {!row.onTracker && <span className={styles.origin}>Not on this tracker</span>}
        </span>
      )}
    </div>
  );
}
