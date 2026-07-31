import React, { useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, Button } from '@vibe/core';
import type { VermilianConfig, YouTrackProject } from '../../../shared/workspace';
import { setWorkspaceProjects } from '../../../shared/workspace';
import styles from './AddProjectsModal.module.css';

interface AddProjectsModalProps {
  config: VermilianConfig;
  workspaceId: string;
  workspaceName: string;
  allProjects: YouTrackProject[];
  onClose: () => void;
  onSave: (config: VermilianConfig) => void;
}

/**
 * Picks which YouTrack projects belong to a workspace.
 *
 * This is the only route into a workspace that holds no projects: the rail's
 * right-click "Move to workspace" menu needs a visible project row to open on,
 * which an empty workspace by definition has none of.
 *
 * Membership is exclusive, so checking a project here moves it out of whatever
 * workspace it sits in today — the row shows that origin, and a notice appears
 * once any such move is staged.
 */
export function AddProjectsModal({
  config, workspaceId, workspaceName, allProjects, onClose, onSave,
}: AddProjectsModalProps) {
  // Where each project lives right now, so a row can show "in <workspace>".
  const originByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of config.workspaces) {
      for (const folder of ws.folders) {
        for (const id of folder.projectIds) map.set(id, ws.name);
      }
    }
    return map;
  }, [config]);

  const initiallyHere = useMemo(() => {
    const ws = config.workspaces.find((w) => w.id === workspaceId);
    return new Set(ws?.folders.flatMap((f) => f.projectIds) ?? []);
  }, [config, workspaceId]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(initiallyHere));

  function toggle(projectId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  // Checked projects that currently belong to a different workspace.
  const movingFromElsewhere = allProjects.filter(
    (p) => selected.has(p.id) && !initiallyHere.has(p.id) && originByProjectId.has(p.id),
  );

  function handleSave() {
    // Preserve the order projects appear in the rail rather than click order.
    const ids = allProjects.filter((p) => selected.has(p.id)).map((p) => p.id);
    onSave(setWorkspaceProjects(config, workspaceId, ids, `folder-${Date.now()}`));
    onClose();
  }

  return (
    <Modal id="add-projects-modal" show onClose={onClose} size="medium">
      <ModalHeader title={`Add projects to “${workspaceName}”`} />
      <ModalContent>
        <div className={styles.intro}>
          Projects belong to one workspace at a time. Unchecking a project leaves it
          unassigned rather than deleting it.
        </div>

        {allProjects.length === 0 ? (
          <div className={styles.empty}>No YouTrack projects available.</div>
        ) : (
          <div className={styles.list} data-testid="add-projects-list">
            {allProjects.map((p) => {
              const origin = originByProjectId.get(p.id);
              const here = initiallyHere.has(p.id);
              return (
                <label
                  key={p.id}
                  className={styles.row}
                  data-testid="add-projects-row"
                  data-project-name={p.name}
                >
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    aria-label={p.name}
                  />
                  <span className={styles.projectName}>{p.name}</span>
                  {here ? (
                    <span className={styles.origin}>in this workspace</span>
                  ) : origin ? (
                    <span className={styles.origin}>in “{origin}”</span>
                  ) : (
                    <span className={`${styles.origin} ${styles.originUnassigned}`}>unassigned</span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {movingFromElsewhere.length > 0 && (
          <div className={styles.moveNotice} data-testid="add-projects-move-notice">
            {movingFromElsewhere.length === 1
              ? `“${movingFromElsewhere[0].name}” will move out of “${originByProjectId.get(movingFromElsewhere[0].id)}”.`
              : `${movingFromElsewhere.length} projects will move out of their current workspace.`}
          </div>
        )}

        <div className={styles.footer}>
          <Button kind="tertiary" onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
            data-testid="add-projects-save"
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
}
