import React, { useEffect, useRef, useState } from 'react';
import { IconButton, Loader, Text, Divider, AttentionBox } from '@vibe/core';
import { Settings, Inbox, Menu as MenuIcon } from '@vibe/icons';
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
import { useProjects, useWorkspaceConfig, useSaveWorkspaceConfig } from './api';
import { ManageWorkspacesModal } from './ManageWorkspacesModal';
import styles from './WorkspaceNav.module.css';

interface WorkspaceNavProps {
  onOpenSettings: () => void;
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

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeId: string;
  onSwitch: (id: string) => void;
  onNewWorkspace: (name: string) => void;
  onManage: () => void;
  collapsed: boolean;
}

function WorkspaceSwitcher({ workspaces, activeId, onSwitch, onNewWorkspace, onManage, collapsed }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newNameRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  useEffect(() => {
    if (!open) { setCreating(false); setNewName(''); }
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

  function handleCreate() {
    if (!newName.trim()) return;
    onNewWorkspace(newName.trim());
    setOpen(false);
  }

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
            <div className={styles.switcherCreateForm}>
              <input
                ref={newNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') setCreating(false);
                }}
                placeholder="Workspace name"
                data-testid="new-workspace-input"
                className={styles.switcherCreateInput}
              />
              <button
                type="button"
                data-testid="new-workspace-submit"
                className={styles.switcherCreateSubmit}
                onClick={handleCreate}
                disabled={!newName.trim()}
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

export function WorkspaceNav({ onOpenSettings }: WorkspaceNavProps) {
  const projects = useProjects();
  const workspaceConfig = useWorkspaceConfig();
  const saveConfig = useSaveWorkspaceConfig();

  const {
    activeWorkspaceId,
    activeProjectId,
    railCollapsed,
    expandedFolderIds,
    expandedHydrated,
    setActiveWorkspace,
    setActiveProject,
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

  // ── On fresh install: auto-create default workspace config ──────────────────
  useEffect(() => {
    if (
      workspaceConfig.data !== undefined &&
      workspaceConfig.data === null &&
      projects.data &&
      projects.data.length > 0
    ) {
      const config = makeInitialConfig(projects.data.map((p) => p.id));
      saveConfig.mutate(config);
    }
  }, [workspaceConfig.data, projects.data]);

  // ── Sync activeWorkspaceId from config ──────────────────────────────────────
  useEffect(() => {
    const cfg = workspaceConfig.data;
    if (!cfg) return;
    if (!activeWorkspaceId && cfg.activeWorkspaceId) {
      setActiveWorkspace(cfg.activeWorkspaceId);
    }
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

  // Projects in YouTrack but not assigned to any folder
  const assignedIds = config ? allAssignedProjectIds(config) : new Set<string>();
  const unassignedProjects = allProjects.filter((p) => !assignedIds.has(p.id));

  function handleSelectProject(p: YouTrackProject) {
    setActiveProject(p.id, p.shortName);
  }

  function handleSwitchWorkspace(id: string) {
    setActiveWorkspace(id);
    if (config) {
      saveConfig.mutate({ ...config, activeWorkspaceId: id });
    }
  }

  function handleProjectContextMenu(e: React.MouseEvent, project: YouTrackProject) {
    setCtxMenu({ x: e.clientX, y: e.clientY, project });
  }

  function handleMoveProject(projectId: string, targetWorkspaceId: string) {
    if (!config) return;
    const updated = moveProjectToWorkspace(config, projectId, targetWorkspaceId);
    saveConfig.mutate(updated);
    setActiveWorkspace(targetWorkspaceId);
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

  function handleNewWorkspace(name: string) {
    const id = `workspace-${Date.now()}`;
    const newWorkspace: Workspace = {
      id,
      name,
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
    saveConfig.mutate(updated);
    setActiveWorkspace(id);
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

            {/* All tasks virtual entry */}
            <button
              type="button"
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

            {/* Empty workspace hint */}
            {activeWorkspace.folders.length === 0 && !contentCollapsed && (
              <div className={styles.emptyWorkspaceHint}>
                <Text type="text2">
                  Right-click a project in another workspace to move it here.
                </Text>
              </div>
            )}

            {/* Add folder */}
            {!contentCollapsed && (
              <AddFolderRow onAdd={handleCreateFolder} />
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

      {/* Manage workspaces modal */}
      {showManage && config && (
        <ManageWorkspacesModal
          config={config}
          onClose={() => setShowManage(false)}
          onSave={(updated) => saveConfig.mutate(updated)}
          onActiveWorkspaceChanged={(id) => setActiveWorkspace(id)}
        />
      )}
    </nav>
    </div>
  );
}
