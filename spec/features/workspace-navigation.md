# Feature: Workspace navigation

## Description

Vermilian organizes work into **workspaces** — top-level contexts such as `Work`, `Personal`, or a future client/customer name. Each workspace contains a manually-defined **folder tree**, and the user assigns each YouTrack project to exactly one folder inside one workspace. Only one workspace is "active" at a time; a monday-style dropdown chip at the top of the left rail switches between them. The folder tree below the switcher reveals the active workspace's project structure.

Workspaces, folders, and project assignments are stored in the same `_vermilian-config` YouTrack Article as per-board configuration (see `board-configuration.md`) so the same multi-machine sync covers organizational structure and presentation together.

This spec covers the left-rail UI and the storage shape for workspace/folder data. The board itself is specified in `project-board.md`; per-board configuration in `board-configuration.md`.

## Acceptance criteria

### Configuration model

- [ ] The `_vermilian-config` Article's `workspaces` array is the source of truth:

  ```jsonc
  {
    "version": 1,
    "workspaces": [
      {
        "id": "work",
        "name": "Work",
        "order": 0,
        "folders": [
          {
            "id": "folder-fulfillment",
            "name": "Fulfillment",
            "order": 0,
            "parentId": null,
            "projectIds": ["youtrack-proj-id-1", "youtrack-proj-id-2"]
          },
          {
            "id": "folder-merch",
            "name": "Merch Hub",
            "order": 1,
            "parentId": null,
            "projectIds": []
          }
        ]
      },
      { "id": "personal", "name": "Personal", "order": 1, "folders": [/* … */] }
    ],
    "activeWorkspaceId": "work",
    "defaults": {
      "boardColumns": [/* default column set for new boards */],
      "palette": {
        "Status": { "To do": "#C4C4C4", "Working on it": "#00C875", "Done": "#00C875" /* … */ },
        "Priority": { /* … */ },
        "Category": { /* … */ }
      }
    },
    "boards": { /* per-board overrides; see board-configuration.md */ }
  }
  ```

- [ ] Folders are not nested in MVP (`parentId` is always `null`). The field is included to allow nested folders in a future minor version without a schema migration.
- [ ] A YouTrack project ID appears in **exactly one** folder across the entire `workspaces` array. The client enforces this invariant on every write.
- [ ] On startup, the client fetches all projects from `GET /api/admin/projects?fields=id,name,shortName`, then reconciles against `workspaces`:
  - Projects present in `workspaces` but no longer in YouTrack: a warning indicator on the folder entry; user can `Remove` or `Restore`.
  - Projects present in YouTrack but not in any workspace: appear in a special **"Unassigned"** section at the bottom of the active workspace's tree until the user drags them into a folder (or into a different workspace).

### Left-rail layout

- [ ] The left rail has three vertical sections, top to bottom:
  1. **Workspace switcher**: a Vibe `Dropdown`-styled chip showing the active workspace's name and an Inbox indicator if the workspace contains an Inbox project. Clicking opens a menu: list of all workspaces (active marked), `+ New workspace`, `Manage workspaces…`.
  2. **Folder tree**: the active workspace's folders, each containing its assigned projects.
  3. **Footer**: a `Settings` (gear) icon and an `Inbox` quick-jump.
- [ ] Each project row in the tree shows: an Inbox indicator if the project name contains `Inbox` (case-insensitive), the project name, and a small count badge showing the number of non-`Done` issues. The active project is highlighted using Vibe's `NavigationItem` active state.
- [x] Each folder row is collapsible (chevron). The collapsed/expanded state is persisted per folder in local app data — `localStorage` key `vermilian:expanded-folders` (not in the Article — this is per-machine UI state). All folders auto-expand on the very first launch only.
- [ ] The first item in the active workspace's tree (above all folders) is `All tasks in workspace` — a virtual entry that opens a cross-project view. (Note: this is the only cross-project view in MVP; per-project boards remain the primary surface.)

### Collapsible rail

- [x] A hamburger button at the very top of the rail (above the workspace switcher) collapses the rail to a narrow icon-only strip (~52 px wide). State persists across launches in local app data (`localStorage` key `vermilian:rail-collapsed`).
- [x] In the icon-only strip:
  - Workspace switcher → the workspace's initial letter in a tinted circle. (The full switcher menu opens on click; in the hover fly-out it appears in full.)
  - Folder tree → hovering the collapsed rail pops out the full tree as an overlay that floats over the board (does not push board content). Moving the pointer off the rail closes it. Implemented by reserving a 52 px layout slot and absolutely positioning the rail inside it, expanding to full width on hover.
- [x] Re-expanding the rail (click hamburger again) returns to the full-width view.

### Workspace switcher

- [ ] Switching workspaces:
  - Updates `activeWorkspaceId` in the config Article (debounced save).
  - Switches the left-rail tree to the new workspace.
  - Clears the main content area (loads the new workspace's `All tasks` virtual entry or the most recently active project in that workspace — TBD; pick most-recent for MVP).
- [ ] `+ New workspace` opens a Vibe `Modal`: text input `Workspace name`. On submit, creates a workspace with no folders and no projects, and switches to it.
- [x] `Manage workspaces…` (entry in the switcher menu) opens the `ManageWorkspacesModal`: list of workspaces with inline rename, reorder (`↑`/`↓` buttons — drag deferred), and delete. Deleting a workspace:
  - Refuses if the workspace contains projects (inline warning: *"Move or remove all projects from this workspace before deleting it."* — no `AlertDialog` component exists in this Vibe build, so rendered inline).
  - Once empty, requires `Type the workspace name to confirm` confirmation (Delete enabled only when the typed name matches exactly).
  - Delete is disabled when only one workspace remains (at least one must always exist). Deleting the active workspace switches the rail to the first remaining workspace.
  - (Implemented as a `Modal` launched from the rail rather than a Settings-area page — same actions, lighter integration.)

### Folder management

- [x] Right-click on a folder row opens a menu: `Rename`, `Move up`, `Move down`, `Delete folder`. (Custom positioned menu rather than the Vibe `Menu` component; `Move up`/`Move down` disabled at the ends.)
- [x] `Delete folder` is only available when the folder has zero projects. Otherwise the menu item is disabled with a tooltip: *"Move all projects out of this folder before deleting."*
- [x] A `+ Add folder` button at the bottom of the active workspace's tree (below the last folder) creates a new folder. Rename is triggered immediately (inline edit).

### Project assignment

- [ ] A project can be **dragged from one folder to another within the same workspace** (re-parented). The drag updates `folders[…].projectIds` in the config Article.
- [ ] A project can be **dragged across workspaces** in the workspace switcher: while dragging a project row, hovering over a different workspace name in the switcher menu (which auto-opens during drag) highlights it as a drop target. Releasing reassigns the project to that workspace's `Unassigned` folder.
- [ ] A task (issue) being dragged from a board to a different project entry in the tree is a **task move** (see `project-board.md`), not a project move — the two drag sources are distinguishable by drag-type.

### Empty-state and onboarding

- [x] On a fresh install (after Settings completes), if no workspaces exist, the client creates a default workspace named `Workspace` and places all YouTrack projects into a single `Unassigned` folder (`makeInitialConfig`). An info `AttentionBox` at the top of the left rail prompts the user to organize projects into folders. (Shown while the active workspace still has ≤1 folder.)
- [x] The user can dismiss the banner; dismissal is per-machine UI state (`localStorage`).

## Wireframe

See: `docs/design/screen-workspace-navigation.d2`, `docs/design/screen-workspace-switcher.d2` (to be drawn)

## Open questions

- [ ] Should the `All tasks in workspace` virtual entry render as a board (cross-project, grouped by `Project`), or as a list? Recommend: board, group-by `Project`. Confirm before implementing.
- [ ] Nested folders are deferred — confirm we're shipping flat folders in v0.1.0.
- [ ] How do we surface that a YouTrack project was deleted server-side? Current spec: warning indicator + `Remove/Restore`. May need refinement based on YouTrack soft-delete behaviour.
