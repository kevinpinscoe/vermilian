import React, { useEffect, useRef, useState } from 'react';
import { IconButton, Loader, Text, Divider, AttentionBox } from '@vibe/core';
import { Settings, Inbox, Menu as MenuIcon, Favorite, Numbers } from '@vibe/icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { VermilianConfig, Workspace, WorkspaceFolder, YouTrackProject, BoardIssue } from '../../../shared/workspace';
import { makeInitialConfig, allAssignedProjectIds } from '../../../shared/workspace';
import { useWorkspaceStore } from '../../stores/workspace';
import { useBoardDragStore } from '../../stores/boardDrag';
import { useProjects, useWorkspaceConfig, useSaveWorkspaceConfig, useActiveWorkspace, WORKSPACE_CONFIG_QUERY_KEY, ACTIVE_WORKSPACE_QUERY_KEY } from './api';
import { useConfig } from '../settings/api';
import type { WorkspaceStorageMode } from '../../../shared/activeWorkspace';
import { generateWorkspaceId } from '../../../shared/workspaceSchema';
import { buildWorkspaceDocument, nextWorkspaceOrder, type NewWorkspaceBackend } from '../../../shared/workspaceSetup';
import { parseAiCredentialRefInput } from '../../../shared/workspaceAi';
import { WorkspaceAiCredentialModal } from './WorkspaceAiCredentialModal';
import { WorkspaceMasterPlanModal } from './WorkspaceMasterPlanModal';
import { WorkspacePrerequisitesModal } from './WorkspacePrerequisitesModal';
import { MASTER_PLAN_QUERY_KEY } from '../priority-desk/masterPlanApi';
import { ManageWorkspacesModal } from './ManageWorkspacesModal';
import { AddProjectsModal } from './AddProjectsModal';
import styles from './WorkspaceNav.module.css';

interface WorkspaceNavProps {
  onOpenSettings: () => void;
  // Switching goes through AppShell, which owns the running timer and asks
  // "Stop timer or Cancel" first (VERM-46). Resolves true once switched.
  onRequestSwitchWorkspace: (workspaceId: string) => Promise<boolean>;
  // Switch without the timer prompt: the active workspace is being deleted,
  // so staying on it is not an option.
  onForceSwitchWorkspace: (workspaceId: string) => Promise<boolean>;
  // Set only while the active workspace is a Jira one: the rail's project
  // button then opens the Jira picker instead of the YouTrack one (VERM-58).
  onChooseJiraProjects?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function isInbox(projectName: string): boolean {
  return projectName.toLowerCase().includes('inbox');
}

// ─── Project assignment helpers ───────────────────────────────────────────────

function moveProjectToWorkspace(
  config: VermilianConfig,
  projectId: string,
  targetWorkspaceId: string,
): VermilianConfig {
  // Remove from every folder in every workspace
  const stripped = config.workspaces.map((ws) => ({
    ...ws,
    folders: ws.folders.map((f) => ({
      ...f,
      projectIds: f.projectIds.filter((id) => id !== projectId),
    })),
  }));

  // Add to target workspace: first existing folder, or create a "Projects" folder
  const updated = stripped.map((ws) => {
    if (ws.id !== targetWorkspaceId) return ws;
    if (ws.folders.length > 0) {
      return {
        ...ws,
        folders: ws.folders.map((f, i) =>
          i === 0 ? { ...f, projectIds: [...f.projectIds, projectId] } : f,
        ),
      };
    }
    return {
      ...ws,
      folders: [{
        id: `folder-${Date.now()}`,
        name: 'Projects',
        order: 0,
        parentId: null,
        projectIds: [projectId],
      }],
    };
  });

  return { ...config, workspaces: updated };
}

function reorderProjectInFolder(
  config: VermilianConfig,
  folderId: string,
  fromIndex: number,
  toIndex: number,
): VermilianConfig {
  const workspaces = config.workspaces.map((ws) => ({
    ...ws,
    folders: ws.folders.map((f) => {
      if (f.id !== folderId) return f;
      return { ...f, projectIds: arrayMove(f.projectIds, fromIndex, toIndex) };
    }),
  }));
  return { ...config, workspaces };
}

function reorderFolders(
  config: VermilianConfig,
  workspaceId: string,
  fromIndex: number,
  toIndex: number,
): VermilianConfig {
  // fromIndex / toIndex are positions in the order-sorted folder list (the list the
  // user sees). Move within that order, then renormalize `order` to the new positions
  // so the change survives a reload (folders are always rendered sorted by `order`).
  const workspaces = config.workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const sorted = ws.folders.slice().sort((a, b) => a.order - b.order);
    const moved = arrayMove(sorted, fromIndex, toIndex);
    return { ...ws, folders: moved.map((f, i) => ({ ...f, order: i })) };
  });
  return { ...config, workspaces };
}

function moveProjectToFolder(
  config: VermilianConfig,
  projectId: string,
  targetFolderId: string,
): VermilianConfig {
  // Remove from its current folder then add to the target folder (same workspace)
  const workspaces = config.workspaces.map((ws) => ({
    ...ws,
    folders: ws.folders.map((f) => {
      if (f.id === targetFolderId) {
        return { ...f, projectIds: [...f.projectIds.filter((id) => id !== projectId), projectId] };
      }
      return { ...f, projectIds: f.projectIds.filter((id) => id !== projectId) };
    }),
  }));
  return { ...config, workspaces };
}

function createFolder(
  config: VermilianConfig,
  workspaceId: string,
  name: string,
): VermilianConfig {
  const workspaces = config.workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    return {
      ...ws,
      folders: [
        ...ws.folders,
        {
          id: `folder-${Date.now()}`,
          name,
          order: ws.folders.length,
          parentId: null,
          projectIds: [] as string[],
        },
      ],
    };
  });
  return { ...config, workspaces };
}

function renameFolder(
  config: VermilianConfig,
  folderId: string,
  newName: string,
): VermilianConfig {
  const workspaces = config.workspaces.map((ws) => ({
    ...ws,
    folders: ws.folders.map((f) => (f.id === folderId ? { ...f, name: newName } : f)),
  }));
  return { ...config, workspaces };
}

function deleteFolder(
  config: VermilianConfig,
  folderId: string,
): VermilianConfig {
  const workspaces = config.workspaces.map((ws) => ({
    ...ws,
    folders: ws.folders.filter((f) => f.id !== folderId),
  }));
  return { ...config, workspaces };
}

// ─── Project context menu ─────────────────────────────────────────────────────

function ContextMenuBase({
  x, y, onClose, children,
}: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={styles.contextMenu}
      style={{
        position: 'fixed',
        top: Math.min(y, window.innerHeight - 220),
        left: Math.min(x, window.innerWidth - 220),
        zIndex: 200,
      }}
    >
      {children}
    </div>
  );
}

interface ProjectContextMenuProps {
  x: number;
  y: number;
  projectName: string;
  workspaces: Workspace[];
  currentWorkspaceId: string;
  currentFolderId: string;
  workspaceFolders: WorkspaceFolder[];
  onMoveToWorkspace: (targetWorkspaceId: string) => void;
  onMoveToFolder: (targetFolderId: string) => void;
  onClose: () => void;
}

function ProjectContextMenu({
  x, y, projectName, workspaces, currentWorkspaceId, currentFolderId,
  workspaceFolders, onMoveToWorkspace, onMoveToFolder, onClose,
}: ProjectContextMenuProps) {
  return (
    <ContextMenuBase x={x} y={y} onClose={onClose}>
      <div className={styles.contextMenuHeader}>{projectName}</div>
      {workspaceFolders.length > 1 && (
        <>
          <div className={styles.contextMenuSection}>Move to folder</div>
          {workspaceFolders.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`${styles.contextMenuItem} ${f.id === currentFolderId ? styles.contextMenuItemCurrent : ''}`}
              onClick={() => { onMoveToFolder(f.id); onClose(); }}
            >
              <span className={styles.contextMenuFolderIcon}>▸</span>
              <span>{f.name}</span>
              {f.id === currentFolderId && <span className={styles.contextMenuCheck}>✓</span>}
            </button>
          ))}
        </>
      )}
      <div className={styles.contextMenuSection}>Move to workspace</div>
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          type="button"
          className={`${styles.contextMenuItem} ${ws.id === currentWorkspaceId ? styles.contextMenuItemCurrent : ''}`}
          onClick={() => { onMoveToWorkspace(ws.id); onClose(); }}
        >
          <span className={styles.contextMenuInitial}>{initial(ws.name)}</span>
          <span>{ws.name}</span>
          {ws.id === currentWorkspaceId && <span className={styles.contextMenuCheck}>✓</span>}
        </button>
      ))}
    </ContextMenuBase>
  );
}

// ─── Folder context menu ──────────────────────────────────────────────────────

interface FolderContextMenuProps {
  x: number;
  y: number;
  folderName: string;
  isEmpty: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function FolderContextMenu({
  x, y, folderName, isEmpty, canMoveUp, canMoveDown,
  onRename, onMoveUp, onMoveDown, onDelete, onClose,
}: FolderContextMenuProps) {
  return (
    <ContextMenuBase x={x} y={y} onClose={onClose}>
      <div className={styles.contextMenuHeader}>{folderName}</div>
      <button type="button" data-testid="folder-menu-rename" className={styles.contextMenuItem} onClick={() => { onRename(); onClose(); }}>
        Rename
      </button>
      <button
        type="button"
        data-testid="folder-menu-move-up"
        className={`${styles.contextMenuItem} ${!canMoveUp ? styles.contextMenuItemDisabled : ''}`}
        disabled={!canMoveUp}
        onClick={() => { if (canMoveUp) { onMoveUp(); onClose(); } }}
      >
        Move up
      </button>
      <button
        type="button"
        data-testid="folder-menu-move-down"
        className={`${styles.contextMenuItem} ${!canMoveDown ? styles.contextMenuItemDisabled : ''}`}
        disabled={!canMoveDown}
        onClick={() => { if (canMoveDown) { onMoveDown(); onClose(); } }}
      >
        Move down
      </button>
      <button
        type="button"
        data-testid="folder-menu-delete"
        className={`${styles.contextMenuItem} ${!isEmpty ? styles.contextMenuItemDisabled : styles.contextMenuItemDanger}`}
        disabled={!isEmpty}
        onClick={() => { if (isEmpty) { onDelete(); onClose(); } }}
        title={!isEmpty ? 'Move all projects out of this folder before deleting' : undefined}
      >
        Delete folder
      </button>
    </ContextMenuBase>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ProjectRowProps {
  project: YouTrackProject;
  active: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  collapsed: boolean;
  isDragOverlay?: boolean;
}

function ProjectRow({ project, active, onSelect, onContextMenu, collapsed, isDragOverlay }: ProjectRowProps) {
  const qc = useQueryClient();
  const cached = qc.getQueryData<BoardIssue[]>(['youtrack', 'issues', project.shortName]);
  const openCount = cached ? cached.filter((i) => !i.resolved).length : null;
  const isBoardDragging = useBoardDragStore((s) => s.draggingIssue !== null);

  return (
    <button
      type="button"
      data-testid="nav-project"
      data-drop-target={isBoardDragging ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      className={`${styles.projectRow} ${active ? styles.projectRowActive : ''} ${isDragOverlay ? styles.projectRowDragging : ''} ${isBoardDragging ? styles.projectRowCrossBoardTarget : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={collapsed ? project.name : undefined}
      data-nav-project-id={project.id}
      data-nav-project-name={project.name}
    >
      {isInbox(project.name) && (
        <span className={styles.inboxDot} aria-label="Inbox project" />
      )}
      {!collapsed && (
        <>
          <Text type="text2" className={styles.projectName} ellipsis>
            {project.name}
          </Text>
          {openCount !== null && openCount > 0 && (
            <span className={styles.issueCount}>{openCount}</span>
          )}
        </>
      )}
      {collapsed && (
        <span className={styles.collapsedProjectInitial}>{initial(project.name)}</span>
      )}
    </button>
  );
}

function SortableProjectRow(props: ProjectRowProps & { id: string }) {
  const { id, ...rest } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: 'project' },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={styles.sortableRow}>
      <ProjectRow {...rest} />
    </div>
  );
}

interface FolderRowProps {
  folder: WorkspaceFolder;
  projects: YouTrackProject[];
  activeProjectId: string | null;
  onSelectProject: (p: YouTrackProject) => void;
  onProjectContextMenu: (e: React.MouseEvent, p: YouTrackProject) => void;
  onFolderContextMenu: (e: React.MouseEvent, folder: WorkspaceFolder) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  startRename: boolean;
  onRenameComplete: () => void;
  expanded: boolean;
  onToggle: () => void;
  collapsed: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
}

function FolderSection({
  folder, projects, activeProjectId, onSelectProject, onProjectContextMenu,
  onFolderContextMenu, onRenameFolder, startRename, onRenameComplete,
  expanded, onToggle, collapsed, dragHandleProps,
}: FolderRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (startRename && !renaming) { setRenaming(true); }
  }, [startRename]);

  useEffect(() => {
    if (renaming) { setDraft(folder.name); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0); }
  }, [renaming]);

  const folderProjects = folder.projectIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is YouTrackProject => Boolean(p));

  function commitRename() {
    setRenaming(false);
    onRenameComplete();
    if (draft.trim() && draft.trim() !== folder.name) onRenameFolder(folder.id, draft.trim());
  }

  return (
    <div className={styles.folder}>
      {!collapsed && (
        <div
          className={styles.folderHeader}
          onContextMenu={(e) => { e.preventDefault(); onFolderContextMenu(e, folder); }}
        >
          <button type="button" className={styles.folderToggle} onClick={onToggle}>
            <span className={styles.folderChevron} {...(dragHandleProps ?? {})} title="Drag to reorder">
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          {renaming ? (
            <input
              ref={inputRef}
              data-testid="folder-rename-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
              className={styles.folderRenameInput}
            />
          ) : (
            <button type="button" className={styles.folderNameBtn} onClick={onToggle}
              onDoubleClick={() => setRenaming(true)}>
              <Text type="text2" weight="medium" className={styles.folderName} data-testid="folder-name">{folder.name}</Text>
            </button>
          )}
        </div>
      )}
      {(expanded || collapsed) && (
        <SortableContext items={folder.projectIds} strategy={verticalListSortingStrategy}>
          {folderProjects.map((p) => (
            <SortableProjectRow
              key={p.id}
              id={p.id}
              project={p}
              active={activeProjectId === p.id}
              onSelect={() => onSelectProject(p)}
              onContextMenu={(e) => { e.preventDefault(); onProjectContextMenu(e, p); }}
              collapsed={collapsed}
            />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

// ─── Sortable folder wrapper ──────────────────────────────────────────────────

function SortableFolderSection(props: FolderRowProps & { id: string }) {
  const { id, ...rest } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: 'folder' },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <FolderSection {...rest} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

// ─── Add folder row ───────────────────────────────────────────────────────────

function AddFolderRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function submit() {
    if (name.trim()) onAdd(name.trim());
    setName('');
    setEditing(false);
  }

  if (!editing) {
    return (
      <button type="button" data-testid="add-folder-btn" className={styles.addFolderBtn} onClick={() => setEditing(true)}>
        + Add folder
      </button>
    );
  }

  return (
    <div className={styles.addFolderForm}>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (!name.trim()) setEditing(false); else submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setName(''); setEditing(false); } }}
        placeholder="Folder name"
        data-testid="add-folder-input"
        className={styles.addFolderInput}
      />
    </div>
  );
}

// ─── Workspace switcher dropdown ──────────────────────────────────────────────

export interface NewWorkspaceRequest {
  name: string;
  backend: NewWorkspaceBackend;
  /** Anthropic credential reference for AI; None (null) unless chosen (VERM-47). */
  aiCredentialRef: string | null;
}

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeId: string;
  onSwitch: (id: string) => void;
  /** Resolves to an error message to show, or null once the workspace exists. */
  onNewWorkspace: (req: NewWorkspaceRequest) => Promise<string | null>;
  onManage: () => void;
  collapsed: boolean;
  // Which store new workspaces go to. Only per-workspace storage can hold a
  // Jira workspace or a YouTrack workspace on another server (ADR-0011).
  storage: WorkspaceStorageMode;
  defaultYouTrackUrl: string;
}

type BackendChoice = 'youtrack' | 'jira' | null;

function WorkspaceSwitcher({
  workspaces, activeId, onSwitch, onNewWorkspace, onManage, collapsed, storage, defaultYouTrackUrl,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // No default backend: the user picks one before Create is enabled (VERM-33).
  const [backend, setBackend] = useState<BackendChoice>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [email, setEmail] = useState('');
  const [credentialRef, setCredentialRef] = useState('');
  const [aiCredentialRef, setAiCredentialRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const newNameRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const perWorkspace = storage === 'per-workspace';

  useEffect(() => {
    if (!open) {
      setCreating(false); setNewName(''); setBackend(null); setError(null);
      setServerUrl(''); setSiteUrl(''); setEmail(''); setCredentialRef(''); setAiCredentialRef('');
    }
  }, [open]);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function chooseBackend(kind: 'youtrack' | 'jira') {
    setBackend(kind);
    setError(null);
    if (kind === 'youtrack' && !serverUrl) setServerUrl(defaultYouTrackUrl);
    setCredentialRef((r) => (r === '' || r === 'youtrack-1' || r === 'jira-1' ? `${kind}-1` : r));
  }

  const ready =
    !!newName.trim() &&
    backend !== null &&
    (!perWorkspace ||
      (backend === 'youtrack' ? !!serverUrl.trim() : !!siteUrl.trim() && !!email.trim()));

  async function handleCreate() {
    if (!ready || submitting || backend === null) return;
    const ref = credentialRef.trim() || null;
    const ai = parseAiCredentialRefInput(aiCredentialRef);
    if (!ai.ok) { setError(ai.message); return; }
    const req: NewWorkspaceRequest = {
      aiCredentialRef: ai.credentialRef,
      name: newName.trim(),
      backend:
        backend === 'youtrack'
          ? { kind: 'youtrack', serverUrl: perWorkspace ? serverUrl : defaultYouTrackUrl, credentialRef: ref }
          : { kind: 'jira', siteUrl, email, credentialRef: ref },
    };
    setSubmitting(true);
    const problem = await onNewWorkspace(req);
    setSubmitting(false);
    if (problem) setError(problem);
    else setOpen(false);
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleCreate();
    if (e.key === 'Escape') setCreating(false);
  };

  return (
    <div ref={ref} className={styles.switcher}>
      <button
        type="button"
        data-testid="workspace-switcher"
        className={styles.switcherButton}
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? (active?.name ?? 'Workspace') : undefined}
      >
        {collapsed ? (
          <span className={styles.workspaceInitial}>{initial(active?.name ?? 'W')}</span>
        ) : (
          <>
            <span className={styles.switcherLabel}>{active?.name ?? 'Workspace'}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }}>
              <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div className={styles.switcherMenu}>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              data-testid="workspace-menu-item"
              data-ws-name={ws.name}
              className={`${styles.switcherMenuItem} ${ws.id === activeId ? styles.switcherMenuItemActive : ''}`}
              onClick={() => { onSwitch(ws.id); setOpen(false); }}
            >
              <span className={styles.workspaceInitialSmall}>{initial(ws.name)}</span>
              <span>{ws.name}</span>
            </button>
          ))}

          <div className={styles.switcherDivider} />

          {!creating ? (
            <button
              type="button"
              data-testid="new-workspace-btn"
              className={styles.switcherNewBtn}
              onClick={() => setCreating(true)}
            >
              + New workspace
            </button>
          ) : (
            <div className={styles.switcherCreateForm} data-testid="new-workspace-form">
              <input
                ref={newNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={onKey}
                placeholder="Workspace name"
                data-testid="new-workspace-input"
                className={styles.switcherCreateInput}
              />
              <div className={styles.switcherBackendChoice} role="radiogroup" aria-label="Backend">
                <span className={styles.switcherFieldLabel}>Backend</span>
                <button
                  type="button"
                  role="radio"
                  aria-checked={backend === 'youtrack'}
                  data-testid="new-workspace-backend-youtrack"
                  className={`${styles.switcherBackendBtn} ${backend === 'youtrack' ? styles.switcherBackendBtnActive : ''}`}
                  onClick={() => chooseBackend('youtrack')}
                >
                  YouTrack
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={backend === 'jira'}
                  data-testid="new-workspace-backend-jira"
                  className={`${styles.switcherBackendBtn} ${backend === 'jira' ? styles.switcherBackendBtnActive : ''}`}
                  onClick={() => chooseBackend('jira')}
                  disabled={!perWorkspace}
                  title={perWorkspace ? undefined : 'Jira workspaces need per-workspace storage, which is not activated on this machine yet.'}
                >
                  Jira
                </button>
              </div>
              {perWorkspace && backend === 'youtrack' && (
                <input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="YouTrack server URL"
                  aria-label="YouTrack server URL"
                  data-testid="new-workspace-server-url"
                  className={styles.switcherCreateInput}
                />
              )}
              {perWorkspace && backend === 'jira' && (
                <>
                  <input
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                    onKeyDown={onKey}
                    placeholder="https://your-site.atlassian.net"
                    aria-label="Jira site URL"
                    data-testid="new-workspace-site-url"
                    className={styles.switcherCreateInput}
                  />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={onKey}
                    placeholder="Atlassian account email"
                    aria-label="Atlassian account email"
                    data-testid="new-workspace-email"
                    className={styles.switcherCreateInput}
                  />
                </>
              )}
              {perWorkspace && backend !== null && (
                <input
                  value={credentialRef}
                  onChange={(e) => setCredentialRef(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="Credential reference, e.g. jira-1"
                  aria-label="Credential reference"
                  title="The name of the credential this workspace uses on each machine. Set its value in Settings → Credentials."
                  data-testid="new-workspace-credential-ref"
                  className={styles.switcherCreateInput}
                />
              )}
              {perWorkspace && backend !== null && (
                <input
                  value={aiCredentialRef}
                  onChange={(e) => setAiCredentialRef(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="AI credential reference (optional)"
                  aria-label="Anthropic credential reference"
                  title="The Anthropic credential this workspace's AI features use, e.g. anthropic-1. Leave empty for None: AI stays off until one is chosen."
                  data-testid="new-workspace-ai-credential-ref"
                  className={styles.switcherCreateInput}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
              {error && (
                <div className={styles.switcherCreateError} role="alert" data-testid="new-workspace-error">
                  {error}
                </div>
              )}
              <button
                type="button"
                data-testid="new-workspace-submit"
                className={styles.switcherCreateSubmit}
                onClick={() => void handleCreate()}
                disabled={!ready || submitting}
              >
                Create
              </button>
            </div>
          )}

          <button
            type="button"
            data-testid="manage-workspaces-btn"
            className={styles.switcherManageBtn}
            onClick={() => { setOpen(false); onManage(); }}
          >
            Manage workspaces…
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkspaceNav({
  onOpenSettings,
  onRequestSwitchWorkspace,
  onForceSwitchWorkspace,
  onChooseJiraProjects,
}: WorkspaceNavProps) {
  const projects = useProjects();
  const workspaceConfig = useWorkspaceConfig();
  const activeContext = useActiveWorkspace();
  const saveConfig = useSaveWorkspaceConfig();
  const appConfig = useConfig();
  const queryClient = useQueryClient();
  const storage: WorkspaceStorageMode = activeContext.data?.storage ?? 'legacy';

  const {
    activeWorkspaceId,
    activeProjectId,
    priorityDeskActive,
    runwayActive,
    railCollapsed,
    expandedFolderIds,
    expandedHydrated,
    setActiveWorkspace,
    setActiveProject,
    openPriorityDesk,
    openRunway,
    toggleRail,
    toggleFolder,
    expandFolder,
  } = useWorkspaceStore();

  // When the rail is collapsed, hovering it pops out the full tree as an overlay
  // (does not push board content). `contentCollapsed` drives the icon-only vs full
  // rendering; the narrow strip width is driven separately by `railCollapsed`.
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const contentCollapsed = railCollapsed && !flyoutOpen;
  const [showManage, setShowManage] = useState(false);
  // The workspace whose AI credential reference is being edited (VERM-47).
  const [aiCredentialFor, setAiCredentialFor] = useState<string | null>(null);
  // The workspace whose master-plan reference is being edited (VERM-48).
  const [masterPlanFor, setMasterPlanFor] = useState<string | null>(null);
  const [prerequisitesFor, setPrerequisitesFor] = useState<string | null>(null);
  const [showAddProjects, setShowAddProjects] = useState(false);

  // ── On fresh install: auto-create default workspace config ──────────────────
  // Legacy storage only: per-workspace storage also reports null when its
  // articles cannot be listed, and a layout save cannot create an article.
  useEffect(() => {
    if (
      activeContext.data?.storage === 'legacy' &&
      workspaceConfig.data !== undefined &&
      workspaceConfig.data === null &&
      projects.data &&
      projects.data.length > 0
    ) {
      const config = makeInitialConfig(projects.data.map((p) => p.id));
      saveConfig.mutate(config);
    }
  }, [activeContext.data?.storage, workspaceConfig.data, projects.data]);

  // ── Sync activeWorkspaceId from this machine's local choice (VERM-46) ─────
  // Follows every answer, not only the first: a start-up answer can be a
  // tentative fallback, and latching it once showed the wrong workspace until
  // the next click persisted it (VERM-123). A user's switch writes the store
  // and this query's data together (AppShell.performWorkspaceSwitch), so the
  // two agree and following cannot undo a choice.
  const activeContextId = activeContext.data?.workspaceId;
  const activeContextTentative = activeContext.data?.tentative;
  const wasTentative = useRef(false);
  useEffect(() => {
    if (activeContextId && activeContextId !== activeWorkspaceId) setActiveWorkspace(activeContextId);
    // Settled after a tentative answer: the rail's list may be a stale null
    // from the same failed listing, so read it again once.
    if (activeContextTentative === false && wasTentative.current) {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
    }
    wasTentative.current = activeContextTentative === true;
    // activeWorkspaceId is left out on purpose: this runs when the answer
    // changes, never because the user switched.
  }, [activeContextId, activeContextTentative, setActiveWorkspace, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cfg = workspaceConfig.data;
    if (!cfg) return;
    // Expand all folders only on the very first launch (no persisted expand state).
    // Afterwards the user's per-folder collapse choices are restored from storage.
    if (!expandedHydrated) {
      const ws = cfg.workspaces.find((w) => w.id === (activeWorkspaceId || cfg.activeWorkspaceId));
      if (ws) ws.folders.forEach((f) => expandFolder(f.id));
    }
  }, [workspaceConfig.data]);

  const [draggedProject, setDraggedProject] = useState<YouTrackProject | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; project: YouTrackProject;
  } | null>(null);
  const [folderCtxMenu, setFolderCtxMenu] = useState<{
    x: number; y: number; folder: WorkspaceFolder;
  } | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  // Onboarding banner dismissal is per-machine UI state (localStorage, not the Article).
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem('vermilian:onboarding-dismissed') === '1'; } catch { return false; }
  });
  function dismissBanner() {
    setBannerDismissed(true);
    try { localStorage.setItem('vermilian:onboarding-dismissed', '1'); } catch { /* ignore */ }
  }

  const isLoading = projects.isLoading || workspaceConfig.isLoading;

  const config: VermilianConfig | null = workspaceConfig.data ?? null;
  const allProjects = projects.data ?? [];

  const activeWorkspace =
    config?.workspaces.find((w) => w.id === activeWorkspaceId) ??
    config?.workspaces[0];

  // Drives the empty hint: a workspace can hold folders and still show no
  // projects, so count projects rather than folders.
  // A Jira workspace's chosen boards count too (VERM-59).
  const workspaceProjectCount =
    (activeWorkspace?.folders.reduce((n, f) => n + f.projectIds.length, 0) ?? 0) +
    (activeWorkspace?.jiraBoards?.length ?? 0);

  // Projects in YouTrack but not assigned to any folder
  const assignedIds = config ? allAssignedProjectIds(config) : new Set<string>();
  const unassignedProjects = allProjects.filter((p) => !assignedIds.has(p.id));

  function handleSelectProject(p: YouTrackProject) {
    setActiveProject(p.id, p.shortName);
  }

  // The choice is stored locally by AppShell; nothing is written to the
  // shared configuration article.
  function handleSwitchWorkspace(id: string) {
    void onRequestSwitchWorkspace(id);
  }

  function handleProjectContextMenu(e: React.MouseEvent, project: YouTrackProject) {
    setCtxMenu({ x: e.clientX, y: e.clientY, project });
  }

  function handleMoveProject(projectId: string, targetWorkspaceId: string) {
    if (!config) return;
    const updated = moveProjectToWorkspace(config, projectId, targetWorkspaceId);
    void saveConfig.mutateAsync(updated).then(() => onRequestSwitchWorkspace(targetWorkspaceId)).catch(() => undefined);
  }

  function handleMoveProjectToFolder(projectId: string, targetFolderId: string) {
    if (!config) return;
    saveConfig.mutate(moveProjectToFolder(config, projectId, targetFolderId));
  }

  function handleCreateFolder(name: string) {
    if (!config || !activeWorkspace) return;
    saveConfig.mutate(createFolder(config, activeWorkspace.id, name));
  }

  function handleRenameFolder(folderId: string, name: string) {
    if (!config) return;
    saveConfig.mutate(renameFolder(config, folderId, name));
  }

  function handleDeleteFolder(folderId: string) {
    if (!config) return;
    saveConfig.mutate(deleteFolder(config, folderId));
  }

  function handleMoveFolder(folderId: string, direction: -1 | 1) {
    if (!config || !activeWorkspace) return;
    const sorted = activeWorkspace.folders.slice().sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === folderId);
    const target = idx + direction;
    if (idx === -1 || target < 0 || target >= sorted.length) return;
    saveConfig.mutate(reorderFolders(config, activeWorkspace.id, idx, target));
  }

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    if (active.data.current?.type === 'project') {
      const project = allProjects.find((p) => p.id === active.id);
      setDraggedProject(project ?? null);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedProject(null);
    if (!config || !activeWorkspace) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    if (activeType === 'folder' && overType === 'folder') {
      // Reorder folders — indices are positions in the order-sorted list (what's rendered)
      const sorted = activeWorkspace.folders.slice().sort((a, b) => a.order - b.order);
      const fromIdx = sorted.findIndex((f) => f.id === active.id);
      const toIdx = sorted.findIndex((f) => f.id === over.id);
      if (fromIdx !== -1 && toIdx !== -1) {
        saveConfig.mutate(reorderFolders(config, activeWorkspace.id, fromIdx, toIdx));
      }
      return;
    }

    if (activeType === 'project') {
      // Find source and destination folders
      const sourceFolderId = activeWorkspace.folders.find((f) =>
        f.projectIds.includes(active.id as string),
      )?.id;
      const destFolderId = activeWorkspace.folders.find((f) =>
        f.projectIds.includes(over.id as string) || f.id === over.id,
      )?.id;

      if (!sourceFolderId || !destFolderId) return;

      if (sourceFolderId === destFolderId) {
        // Reorder within the same folder
        const folder = activeWorkspace.folders.find((f) => f.id === sourceFolderId)!;
        const fromIdx = folder.projectIds.indexOf(active.id as string);
        const toIdx = folder.projectIds.indexOf(over.id as string);
        if (fromIdx !== -1 && toIdx !== -1) {
          saveConfig.mutate(reorderProjectInFolder(config, sourceFolderId, fromIdx, toIdx));
        }
      } else {
        // Move to a different folder
        saveConfig.mutate(moveProjectToFolder(config, active.id as string, destFolderId));
      }
    }
  }

  async function handleNewWorkspace(req: NewWorkspaceRequest): Promise<string | null> {
    if (storage === 'per-workspace') return createPerWorkspace(req);
    // Legacy storage: every workspace is on the one configured YouTrack
    // server, so YouTrack is the only backend the form offers here.
    if (req.backend.kind !== 'youtrack') return 'Jira workspaces need per-workspace storage, which is not activated yet.';
    const id = `workspace-${Date.now()}`;
    const newWorkspace: Workspace = {
      id,
      name: req.name,
      order: (config?.workspaces.length ?? 0),
      folders: [],
    };
    const base = config ?? {
      version: 1 as const,
      workspaces: [],
      activeWorkspaceId: '',
    };
    const updated = {
      ...base,
      workspaces: [...base.workspaces, newWorkspace],
      activeWorkspaceId: id,
    };
    void saveConfig.mutateAsync(updated).then(() => onRequestSwitchWorkspace(id)).catch(() => undefined);
    return null;
  }

  // Per-workspace storage: the new workspace is its own article, carrying the
  // backend the user chose (VERM-33).
  async function createPerWorkspace(req: NewWorkspaceRequest): Promise<string | null> {
    const listed = await window.vermilian.listWorkspaceArticles();
    if (!listed.ok) return listed.message;
    const existing = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
    const built = buildWorkspaceDocument({
      workspaceId: generateWorkspaceId(),
      name: req.name,
      order: nextWorkspaceOrder(existing),
      backend: req.backend,
      aiCredentialRef: req.aiCredentialRef,
    });
    if (!built.ok) return built.errors.map((e) => e.message).join(' ');
    const saved = await window.vermilian.createWorkspaceArticle(built.document);
    if (!saved.ok) return saved.message;
    await queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ACTIVE_WORKSPACE_QUERY_KEY });
    onRequestSwitchWorkspace(built.document.workspaceId);
    return null;
  }

  // Per-workspace storage: the active workspace moves only after the delete
  // has succeeded (VERM-72). Resolves to an error message, or null.
  async function deletePerWorkspace(workspaceId: string, destinationId: string | null): Promise<string | null> {
    const result = await window.vermilian.deleteWorkspace(workspaceId, destinationId);
    if (!result.ok) return result.error ?? 'The workspace could not be deleted.';
    if (config && workspaceId === (activeWorkspaceId || config.activeWorkspaceId)) {
      const next = config.workspaces.filter((w) => w.id !== workspaceId).sort((a, b) => a.order - b.order)[0];
      if (next) await onForceSwitchWorkspace(next.id);
    }
    await queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ACTIVE_WORKSPACE_QUERY_KEY });
    return null;
  }

  return (
    <div className={`${styles.railSlot} ${railCollapsed ? styles.railSlotCollapsed : ''}`}>
    <nav
      className={`${styles.rail} ${railCollapsed ? styles.railCollapsed : ''} ${flyoutOpen ? styles.railFlyout : ''}`}
      onMouseEnter={() => { if (railCollapsed) setFlyoutOpen(true); }}
      onMouseLeave={() => setFlyoutOpen(false)}
    >
      {/* Hamburger toggle */}
      <div className={styles.railToggle}>
        <IconButton
          icon={MenuIcon}
          size="small"
          kind="tertiary"
          onClick={toggleRail}
          aria-label={railCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        />
      </div>

      {/* Workspace switcher */}
      {config && (
        <WorkspaceSwitcher
          workspaces={config.workspaces}
          activeId={activeWorkspaceId || config.activeWorkspaceId}
          onSwitch={handleSwitchWorkspace}
          onNewWorkspace={handleNewWorkspace}
          onManage={() => setShowManage(true)}
          collapsed={contentCollapsed}
          storage={storage}
          defaultYouTrackUrl={appConfig.data?.youtrackUrl ?? ''}
        />
      )}

      {/* Tree body */}
      <div className={styles.treeBody}>
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {isLoading && (
          <div className={styles.loaderWrap}>
            <Loader size={20} />
          </div>
        )}

        {!isLoading && activeWorkspace && (
          <>
            {/* Fresh-install onboarding prompt — shown until the user organizes projects
                into folders, or dismisses it (dismissal persists per-machine). */}
            {!contentCollapsed && !bannerDismissed && activeWorkspace.folders.length <= 1 && (
              <div className={styles.onboardingBanner}>
                <AttentionBox
                  type="primary"
                  title="Organize your projects"
                  text="Create folders and drag projects into them, or right-click a folder to manage it."
                  onClose={dismissBanner}
                  closeButtonAriaLabel="Dismiss onboarding tip"
                />
              </div>
            )}

            {/* Priority Desk — first-class entry above All tasks (VERM-5) */}
            <button
              type="button"
              data-testid="nav-priority-desk"
              aria-current={priorityDeskActive ? 'true' : undefined}
              className={`${styles.allTasksRow} ${priorityDeskActive ? styles.allTasksRowActive : ''}`}
              onClick={openPriorityDesk}
              title={contentCollapsed ? 'Priority Desk' : undefined}
            >
              <Favorite size={14} />
              {!contentCollapsed && (
                <Text type="text2" className={styles.allTasksLabel}>Priority Desk</Text>
              )}
            </button>

            {/* Runway — the workspace's ordered plan, between the Desk and
                All tasks (VERM-85). Every workspace has one, with or without
                board projects. */}
            <button
              type="button"
              data-testid="nav-runway"
              aria-current={runwayActive ? 'true' : undefined}
              className={`${styles.allTasksRow} ${runwayActive ? styles.allTasksRowActive : ''}`}
              onClick={openRunway}
              title={contentCollapsed ? 'Runway' : undefined}
            >
              <Numbers size={14} />
              {!contentCollapsed && (
                <Text type="text2" className={styles.allTasksLabel}>Runway</Text>
              )}
            </button>

            {/* All tasks virtual entry */}
            <button
              type="button"
              data-testid="nav-all-tasks"
              className={styles.allTasksRow}
              onClick={() => setActiveProject(null, null)}
            >
              {!contentCollapsed && (
                <Text type="text2" className={styles.allTasksLabel}>All tasks</Text>
              )}
            </button>

            {/* Folders — sortable */}
            {(() => {
              const sorted = activeWorkspace.folders.slice().sort((a, b) => a.order - b.order);
              return (
                <SortableContext items={sorted.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                  {sorted.map((folder) => (
                    <SortableFolderSection
                      key={folder.id}
                      id={folder.id}
                      folder={folder}
                      projects={allProjects}
                      activeProjectId={activeProjectId}
                      onSelectProject={handleSelectProject}
                      onProjectContextMenu={handleProjectContextMenu}
                      onFolderContextMenu={(e, f) => { setFolderCtxMenu({ x: e.clientX, y: e.clientY, folder: f }); }}
                      onRenameFolder={handleRenameFolder}
                      startRename={renamingFolderId === folder.id}
                      onRenameComplete={() => setRenamingFolderId(null)}
                      expanded={expandedFolderIds.has(folder.id)}
                      onToggle={() => toggleFolder(folder.id)}
                      collapsed={contentCollapsed}
                    />
                  ))}
                </SortableContext>
              );
            })()}

            {/* Empty workspace hint — a workspace with no projects has no rail row
                to right-click, so point at the picker rather than the context menu. */}
            {!contentCollapsed && workspaceProjectCount === 0 && (
              <div className={styles.emptyWorkspaceHint}>
                <Text type="text2">
                  No projects in this workspace yet.
                </Text>
              </div>
            )}

            {/* Add projects / Add folder */}
            {!contentCollapsed && (
              <>
                {onChooseJiraProjects ? (
                  <button
                    type="button"
                    data-testid="rail-choose-jira-projects-btn"
                    className={styles.addFolderBtn}
                    onClick={onChooseJiraProjects}
                  >
                    + Choose Jira projects or boards
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="add-projects-btn"
                    className={styles.addFolderBtn}
                    onClick={() => setShowAddProjects(true)}
                  >
                    + Add projects
                  </button>
                )}
                <AddFolderRow onAdd={handleCreateFolder} />
              </>
            )}

            {/* Unassigned projects — not yet in any workspace folder */}
            {unassignedProjects.length > 0 && (
              <div className={styles.folder}>
                {!contentCollapsed && (
                  <Text type="text2" weight="medium" className={styles.unassignedLabel}>
                    Unassigned
                  </Text>
                )}
                {unassignedProjects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    active={activeProjectId === p.id}
                    onSelect={() => handleSelectProject(p)}
                    onContextMenu={(e) => { e.preventDefault(); handleProjectContextMenu(e, p); }}
                    collapsed={contentCollapsed}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!isLoading && !config && !workspaceConfig.isLoading && (
          <div className={styles.emptyHint}>
            {!contentCollapsed && (
              <Text type="text2" style={{ color: 'var(--color-text-secondary)', padding: '8px 12px' }}>
                Connect to YouTrack in Settings to get started.
              </Text>
            )}
          </div>
        )}

        {/* Drag overlay — rendered at portal level, shows while dragging */}
        <DragOverlay>
          {draggedProject && (
            <ProjectRow
              project={draggedProject}
              active={false}
              onSelect={() => {}}
              onContextMenu={() => {}}
              collapsed={contentCollapsed}
              isDragOverlay
            />
          )}
        </DragOverlay>
      </DndContext>
      </div>

      {/* Footer */}
      <div className={styles.navFooter}>
        <Divider />
        <div className={styles.footerButtons}>
          <IconButton
            data-testid="rail-settings-btn"
            icon={Settings}
            size="small"
            kind="tertiary"
            onClick={onOpenSettings}
            aria-label="Open Settings"
          />
          <IconButton
            icon={Inbox}
            size="small"
            kind="tertiary"
            onClick={() => {
              const inboxProject = allProjects.find((p) => isInbox(p.name));
              if (inboxProject) handleSelectProject(inboxProject);
            }}
            aria-label="Jump to Inbox"
          />
        </div>
      </div>

      {/* Project context menu */}
      {ctxMenu && config && (() => {
        const currentWs = config.workspaces.find((ws) =>
          ws.folders.some((f) => f.projectIds.includes(ctxMenu.project.id))
        );
        const currentFolder = currentWs?.folders.find((f) =>
          f.projectIds.includes(ctxMenu.project.id)
        );
        return (
          <ProjectContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            projectName={ctxMenu.project.name}
            workspaces={config.workspaces}
            currentWorkspaceId={currentWs?.id ?? ''}
            currentFolderId={currentFolder?.id ?? ''}
            workspaceFolders={currentWs?.folders ?? []}
            onMoveToWorkspace={(targetId) => { handleMoveProject(ctxMenu.project.id, targetId); setCtxMenu(null); }}
            onMoveToFolder={(targetFolderId) => { handleMoveProjectToFolder(ctxMenu.project.id, targetFolderId); setCtxMenu(null); }}
            onClose={() => setCtxMenu(null)}
          />
        );
      })()}

      {/* Folder context menu */}
      {folderCtxMenu && config && activeWorkspace && (() => {
        const sorted = activeWorkspace.folders.slice().sort((a, b) => a.order - b.order);
        const idx = sorted.findIndex((f) => f.id === folderCtxMenu.folder.id);
        return (
          <FolderContextMenu
            x={folderCtxMenu.x}
            y={folderCtxMenu.y}
            folderName={folderCtxMenu.folder.name}
            isEmpty={folderCtxMenu.folder.projectIds.length === 0}
            canMoveUp={idx > 0}
            canMoveDown={idx >= 0 && idx < sorted.length - 1}
            onRename={() => { setRenamingFolderId(folderCtxMenu.folder.id); }}
            onMoveUp={() => handleMoveFolder(folderCtxMenu.folder.id, -1)}
            onMoveDown={() => handleMoveFolder(folderCtxMenu.folder.id, 1)}
            onDelete={() => handleDeleteFolder(folderCtxMenu.folder.id)}
            onClose={() => setFolderCtxMenu(null)}
          />
        );
      })()}

      {/* Add projects picker */}
      {showAddProjects && config && activeWorkspace && (
        <AddProjectsModal
          config={config}
          workspaceId={activeWorkspace.id}
          workspaceName={activeWorkspace.name}
          allProjects={allProjects}
          onClose={() => setShowAddProjects(false)}
          onSave={(updated) => {
            saveConfig.mutate(updated);
            // A folder the picker just created — or an existing one the user had
            // collapsed — would otherwise swallow the projects they just added,
            // leaving the rail looking exactly as empty as before the save.
            updated.workspaces
              .find((w) => w.id === activeWorkspace.id)
              ?.folders.forEach((f) => { if (f.projectIds.length > 0) expandFolder(f.id); });
          }}
        />
      )}

      {/* Manage workspaces modal */}
      {showManage && config && (
        <ManageWorkspacesModal
          config={config}
          onClose={() => setShowManage(false)}
          onSave={(updated) => saveConfig.mutate(updated)}
          onActiveWorkspaceChanged={(id) => { void onForceSwitchWorkspace(id); }}
          storage={storage}
          onEditAiCredential={(id) => { setShowManage(false); setAiCredentialFor(id); }}
          onEditMasterPlan={(id) => { setShowManage(false); setMasterPlanFor(id); }}
          onEditPrerequisites={(id) => { setShowManage(false); setPrerequisitesFor(id); }}
          onDeletePerWorkspace={deletePerWorkspace}
        />
      )}
      {prerequisitesFor && (
        <WorkspacePrerequisitesModal
          workspaceId={prerequisitesFor}
          onClose={() => setPrerequisitesFor(null)}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY }); }}
        />
      )}
      {masterPlanFor && (
        <WorkspaceMasterPlanModal
          workspaceId={masterPlanFor}
          onClose={() => setMasterPlanFor(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: MASTER_PLAN_QUERY_KEY });
          }}
        />
      )}
      {aiCredentialFor && (
        <WorkspaceAiCredentialModal
          workspaceId={aiCredentialFor}
          onClose={() => setAiCredentialFor(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: ACTIVE_WORKSPACE_QUERY_KEY });
          }}
        />
      )}
    </nav>
    </div>
  );
}
