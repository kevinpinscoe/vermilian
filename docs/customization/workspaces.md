# Workspaces & Folders

Workspaces and folders are client-side concepts — they exist only in Vermilian and are stored in the `_vermilian-config` YouTrack Knowledge Base Article so they sync across machines.

## Workspaces

A workspace is the top-level grouping. You can have multiple workspaces (e.g. "Work", "Personal") and switch between them using the workspace switcher at the top of the left rail.

- **Add workspace** — click the `+` button in the workspace switcher dropdown.
- **Rename workspace** — double-click the workspace name in the switcher.
- **Reorder workspaces** — drag the workspace rows in the switcher.
- **Delete workspace** — removes the workspace and its folder structure; YouTrack projects are not affected.

## Folders

Each workspace contains folders. Folders group related projects together in the left rail.

- **Add folder** — click `+ Add folder` at the bottom of the left rail.
- **Rename folder** — double-click the folder name in the left rail.
- **Reorder folders and projects** — drag the folder or project row to a new position within the rail.
- **Delete folder** — removes the folder; projects inside are moved to the top level of the workspace.

## Assigning projects to folders

Projects are assigned to folders via drag and drop in the left rail, or through the workspace settings panel. A project can only belong to one folder within a workspace.

Cross-workspace project moves are not supported — a project is always associated with one YouTrack instance and appears in all workspaces by default until explicitly assigned.

## Sync

All workspace and folder state is written to the `_vermilian-config` article in YouTrack on every change. If two clients modify the config simultaneously the last write wins. A future version will add conflict detection.
