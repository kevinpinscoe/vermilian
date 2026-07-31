import React, { useState } from 'react';
import { Modal, ModalContent, ModalHeader, Button } from '@vibe/core';
import type { VermilianConfig, Workspace } from '../../../shared/workspace';
import { setWorkspaceProjects } from '../../../shared/workspace';
import styles from './ManageWorkspacesModal.module.css';

// Sentinel destination: leave the projects in no workspace at all. They keep
// existing and resurface under "Unassigned" in the rail.
const UNASSIGNED = '__unassigned__';

// ─── Pure config transforms ───────────────────────────────────────────────────

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function projectIdsIn(ws: Workspace): string[] {
  return ws.folders.flatMap((f) => f.projectIds);
}

function projectCount(ws: Workspace): number {
  return projectIdsIn(ws).length;
}

function renameWorkspace(config: VermilianConfig, wsId: string, name: string): VermilianConfig {
  return {
    ...config,
    workspaces: config.workspaces.map((w) => (w.id === wsId ? { ...w, name } : w)),
  };
}

function reorderWorkspaces(config: VermilianConfig, fromIndex: number, toIndex: number): VermilianConfig {
  // fromIndex / toIndex are positions in the order-sorted list. Renormalize `order`
  // so the change survives a reload (workspaces are always rendered sorted by order).
  const sorted = config.workspaces.slice().sort((a, b) => a.order - b.order);
  const moved = move(sorted, fromIndex, toIndex);
  return { ...config, workspaces: moved.map((w, i) => ({ ...w, order: i })) };
}

function deleteWorkspace(config: VermilianConfig, wsId: string): VermilianConfig {
  const remaining = config.workspaces
    .filter((w) => w.id !== wsId)
    .sort((a, b) => a.order - b.order)
    .map((w, i) => ({ ...w, order: i }));
  const activeWorkspaceId =
    config.activeWorkspaceId === wsId ? (remaining[0]?.id ?? '') : config.activeWorkspaceId;
  return { ...config, workspaces: remaining, activeWorkspaceId };
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface ManageWorkspacesModalProps {
  config: VermilianConfig;
  onClose: () => void;
  onSave: (config: VermilianConfig) => void;
  // Called when the currently-active workspace is deleted, with the new active id,
  // so the rail can switch away from the now-gone workspace.
  onActiveWorkspaceChanged: (id: string) => void;
}

export function ManageWorkspacesModal({
  config, onClose, onSave, onActiveWorkspaceChanged,
}: ManageWorkspacesModalProps) {
  const sorted = config.workspaces.slice().sort((a, b) => a.order - b.order);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [destination, setDestination] = useState<string>(UNASSIGNED);

  function startRename(ws: Workspace) {
    setEditingId(ws.id);
    setDraft(ws.name);
  }

  function commitRename(ws: Workspace) {
    const name = draft.trim();
    setEditingId(null);
    if (name && name !== ws.name) onSave(renameWorkspace(config, ws.id, name));
  }

  function handleMove(ws: Workspace, dir: -1 | 1) {
    const idx = sorted.findIndex((w) => w.id === ws.id);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= sorted.length) return;
    onSave(reorderWorkspaces(config, idx, target));
  }

  function requestDelete(ws: Workspace) {
    // Holding projects no longer blocks deletion — the confirm step asks where
    // they should go instead, which is the only place the old warning ("move or
    // remove all projects first") could actually be acted on.
    setDeleteTarget(ws);
    setConfirmText('');
    setDestination(UNASSIGNED);
  }

  function cancelDelete() {
    setDeleteTarget(null);
    setConfirmText('');
    setDestination(UNASSIGNED);
  }

  function confirmDelete() {
    if (!deleteTarget || confirmText.trim() !== deleteTarget.name) return;

    const moving = projectIdsIn(deleteTarget);
    let next = config;

    if (moving.length > 0 && destination !== UNASSIGNED) {
      const target = config.workspaces.find((w) => w.id === destination);
      if (target) {
        next = setWorkspaceProjects(
          next,
          destination,
          [...projectIdsIn(target), ...moving],
          `folder-${Date.now()}`,
        );
      }
    }
    // Anything not moved simply leaves with the workspace and becomes
    // unassigned — the projects themselves are never deleted.
    next = deleteWorkspace(next, deleteTarget.id);

    if (config.activeWorkspaceId === deleteTarget.id) {
      onActiveWorkspaceChanged(next.activeWorkspaceId);
    }
    onSave(next);
    cancelDelete();
  }

  const onlyOne = sorted.length <= 1;

  return (
    <Modal id="manage-workspaces-modal" show onClose={onClose} size="medium">
      <ModalHeader title="Manage workspaces" />
      <ModalContent>
        <div className={styles.list}>
          {sorted.map((ws, i) => {
            const count = projectCount(ws);
            return (
              <div key={ws.id} className={styles.row} data-testid="workspace-row" data-ws-name={ws.name}>
                <div className={styles.reorder}>
                  <button
                    type="button" className={styles.iconBtn} aria-label="Move up"
                    disabled={i === 0} onClick={() => handleMove(ws, -1)}
                  >↑</button>
                  <button
                    type="button" className={styles.iconBtn} aria-label="Move down"
                    disabled={i === sorted.length - 1} onClick={() => handleMove(ws, 1)}
                  >↓</button>
                </div>

                {editingId === ws.id ? (
                  <input
                    autoFocus
                    className={styles.nameInput}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(ws)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(ws);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button type="button" className={styles.name} onClick={() => startRename(ws)} title="Click to rename">
                    <span className={styles.nameText}>{ws.name}</span>
                    {ws.id === config.activeWorkspaceId && <span className={styles.activeBadge}>active</span>}
                  </button>
                )}

                <span className={styles.count}>{count} {count === 1 ? 'project' : 'projects'}</span>

                <button
                  type="button"
                  data-testid="workspace-delete"
                  className={styles.deleteBtn}
                  disabled={onlyOne}
                  title={onlyOne ? 'At least one workspace must exist' : undefined}
                  onClick={() => requestDelete(ws)}
                >Delete</button>
              </div>
            );
          })}
        </div>

        {deleteTarget && (
          <div className={styles.confirm}>
            {projectCount(deleteTarget) > 0 && (
              <div className={styles.moveRow} data-testid="ws-delete-move">
                <label className={styles.moveLabel} htmlFor="ws-delete-destination">
                  Move its {projectCount(deleteTarget)}{' '}
                  {projectCount(deleteTarget) === 1 ? 'project' : 'projects'} to
                </label>
                <select
                  id="ws-delete-destination"
                  data-testid="ws-delete-destination"
                  className={styles.moveSelect}
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value={UNASSIGNED}>Unassigned</option>
                  {sorted
                    .filter((w) => w.id !== deleteTarget.id)
                    .map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                </select>
              </div>
            )}
            <div className={styles.confirmText}>
              Type <strong>{deleteTarget.name}</strong> to confirm deletion.
              {projectCount(deleteTarget) > 0
                ? ' The workspace is removed — its projects are kept.'
                : ' This cannot be undone.'}
            </div>
            <input
              autoFocus
              data-testid="ws-delete-confirm-input"
              className={styles.confirmInput}
              value={confirmText}
              placeholder={deleteTarget.name}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmDelete();
                if (e.key === 'Escape') cancelDelete();
              }}
            />
            <div className={styles.confirmActions}>
              <Button kind="tertiary" size="small" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button
                color="negative" size="small"
                data-testid="ws-delete-confirm"
                disabled={confirmText.trim() !== deleteTarget.name}
                onClick={confirmDelete}
              >Delete workspace</Button>
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <Button kind="primary" onClick={onClose}>Done</Button>
        </div>
      </ModalContent>
    </Modal>
  );
}
