# Feature: Project Board

## Description

The project board is the primary working surface in Vermilian. Each YouTrack project gets its own board (a per-project saved view of issues), and each board can render its tasks in one of two view modes — **Main table** (high-density rows grouped by a chosen field) and **Board** (Kanban columns by Status). The look-and-feel mirrors monday.com Work Management: configurable columns, colour-coded chips, group headers with task counts, inline `+ Add task` at the bottom of each group, drag-and-drop between groups, and drag-and-drop between project boards within the same workspace to move an issue to a different YouTrack project.

A board's column choices, colour palette overrides, group-by selection, and active view are stored centrally in the `_vermilian-config` YouTrack Knowledge Base Article so that configuration syncs across machines. This spec covers the board's behaviour; layout and color-editor mechanics live in `board-configuration.md`; the left-rail / workspace switcher lives in `workspace-navigation.md`.

## Acceptance criteria

### Board entry and identity

- [ ] Selecting a project in the left-rail folder tree (see `workspace-navigation.md`) opens that project's board in the main content area.
- [ ] A board belongs to exactly one project (1:1). There is no cross-project aggregate board in MVP.
- [ ] The board header shows the project name (the YouTrack project's `name` field) and a `View tabs` row beneath it.
- [ ] **View tabs**: a horizontal row of saved views for this board. MVP ships two built-in views: **Main table** and **Board**. A `+` button at the end adds a new saved view (per `board-configuration.md`).
- [ ] The active view is persisted per board in the `_vermilian-config` Article and restored on next launch.

### Toolbar

- [x] The toolbar sits directly below the view tabs and contains, left to right: `New task` (blue primary button), `AI create`, `Search`, `Filter`, `Sort`, `Hide`, `Group by`, `Settings`, `Refresh`. The `Search` button opens the filter bar and focuses its free-text search input. **`Person` is descoped from MVP** — this is a single-user YouTrack instance where every issue is assigned to the same person, so an assignee/person filter adds no practical value. Revisit if multi-user assignment is ever introduced.
- [ ] `New task` opens the create-task modal (see `create-task.md`), pre-filled with this board's project and (if the project is an Inbox project) `Category = INBOX`.
- [ ] `Group by` is a dropdown listing groupable fields: `Status`, `Category`, `Priority`, `Due Date` (buckets: Overdue / Today / This week / Later / No date), `None`. The selection is per-board and persists in the config Article. Default group-by is `Status`.
- [ ] `Hide` opens a side panel of show/hide checkboxes for every available column (see `board-configuration.md`).
- [x] `Filter` (toolbar button, shows an active-filter count) toggles the filter bar (described under **Filtering** below); the bar stays open while any filter is active.
- [x] `Sort` opens a sort menu listing the visible columns, each with ascending/descending buttons and a `Clear sort` option. Sort applies within each group; group order is determined by the group-by field's natural order. (Column-header click also toggles sort, per the row below.)

### Main table view

- [ ] Tasks are displayed in a Vibe `Table` with **sticky column headers**.
- [ ] **Group rows**: a coloured group header divides each group, showing the group label, task count badge, and a chevron to collapse/expand the group.
- [ ] Default visible columns when group-by is `Status`: **Task** (Summary), **Ticket Num** (the `Ticket` custom field), **Status**, **Category** (rendered as `Label`-style chip), **Priority**, **Ticket link**, **Tracking link**, **Due Date**.
- [ ] Column header order, visibility, and width are per-board and stored in the config Article.
- [ ] Column reorder: drag a column header left or right. A vertical drop indicator shows the insertion point. Release commits the new order.
- [ ] Column resize: drag the right edge of a column header. Width snaps to the nearest 8 px and persists on release.
- [ ] Chip-rendered fields (Status, Priority, Category): rendered as Vibe `Chip` components with the per-board colour mapping defined in `board-configuration.md`. New chip colours not in the workspace default palette appear immediately when overridden via the Board settings panel.
- [ ] Clicking a column header (excluding chip headers) toggles sort by that column (ascending first, then descending). An arrow indicator shows active sort direction.
- [ ] Clicking a task row opens the task-detail panel (see `task-detail.md`) without unmounting the board.
- [ ] Rows show a hover highlight and a `▶` quick-start-timer icon at the start of the row on hover (see `task-timer.md`).

### Board (Kanban) view

- [ ] One column per Status value, in the order: `To do` → `In Progress` → `Waiting for IT` → `BLOCKED` → `Waiting for approval` → `Waiting for customer` → `Waiting on external resource` → `Done`.
- [ ] Each task is a card showing Summary, Priority chip, and any visible-column chips configured for the board.
- [ ] `Done` column is collapsed by default with a count badge; clicking expands it.
- [ ] The board view is forced to `Group by = Status` regardless of the board's main-table group-by setting (Kanban is, by definition, grouped by Status).
- [ ] Drag-and-drop between columns updates the issue's Status field via the YouTrack API (optimistic update + rollback on failure, per `task-detail.md` mutation pattern).

### Inline `+ Add task` (quick-add)

- [ ] Every group renders a `+ Add task` row at the bottom of the group (table) or the bottom of the column (board).
- [ ] Clicking `+ Add task` reveals an inline single-line input for the Summary, focused immediately.
- [ ] **Enter** creates the task with: `Project = current board's project`, `Summary = typed text`, the group-by field set to the current group's value (e.g., Group by Status + group `To do` → new task has `Status = To do`), and all other fields blank or default.
- [ ] **Esc** cancels and removes the inline row without creating a task.
- [ ] An `Open full form ↗` link appears at the right edge of the inline row. Clicking it discards the inline state and opens the full create-task modal with the same pre-population (`Project`, group field) plus any text already typed copied into the Summary input.
- [ ] On successful inline create, the new task appears at the bottom of the group and the inline input clears for another entry (does not auto-close). Pressing Esc closes it.

### Inline editing

- [ ] Clicking a chip cell (Status, Priority, Category) opens an inline dropdown selector; selecting a value PATCHes the issue. Save and error UX matches `task-detail.md`.
- [ ] Clicking a text cell (Summary, Ticket, Ticket link, Tracking link) opens an inline text input. Blur saves; Esc reverts.
- [ ] Clicking the Due Date cell opens a Vibe `DatePicker`.
- [ ] Inline edits use TanStack Query mutations with optimistic update + rollback on error, surfacing a Vibe `Toast` (danger) on failure.

### Drag-and-drop — within board

- [ ] Tasks can be dragged between groups in either view mode. Release on a group updates the group-by field on the issue (e.g., group-by `Status` → drop on `In Progress` group → `Status = In Progress`).
- [ ] Tasks can be reordered vertically within the same group. Order persists as a per-board array of issue IDs in the config Article (YouTrack has no native issue-order field).
- [ ] A visible drop indicator (a 2 px Vibe-tokened line) shows the insertion point during drag.
- [ ] On API failure for a between-group drag, the task animates back to its original group and a Vibe `Toast` (danger) shows the error.

### Drag-and-drop — cross-board within workspace

- [ ] A task can be dragged from the board area onto a different project entry in the left-rail folder tree (within the same workspace).
- [ ] On drop, a Vibe `AlertDialog` confirmation appears: *"Move 'KP-42: Refactor API client' to project 'Work — Fulfillment'?"* with `Move` and `Cancel` actions.
- [ ] On confirm, the issue's `project` field is updated via `POST /api/issues/{id}` with the new project ID. On success, the task disappears from this board and is invalidated from the source query cache; the destination board's cache is invalidated so it appears on next view.
- [ ] On API failure, the task remains in the source board and a `Toast` (danger) shows the error.
- [ ] Cross-workspace moves are **not supported** in MVP — the drop target only highlights when hovering over a project in the same workspace as the source board.

### Filtering

- [x] A filter bar appears between the toolbar and the table/board when `Filter` is active.
- [x] Available filter controls: Priority (multi-select), Status (multi-select), Category (multi-select) — done as colour-coded pills; text search over Summary — done (also matches `idReadable`); Due Date control (Before / On / After / Range) — done.
- [x] Active filters show as toggled pills; a `Clear all` button removes them.
- [x] Filters apply instantly (no submit button) and are local to the current session — filter state is not persisted to the config Article.

### Data loading

- [ ] On opening a board, issues are fetched via TanStack Query (`useQuery`) with key `['issues', projectId]` from `GET /api/issues?fields=…&project={id}&$top=500`. The `fields=` selector is centralized in the API client module.
- [ ] A Vibe `Loader` spinner is shown in the main content area while the first fetch is in progress.
- [ ] A `Refresh` button in the overflow menu triggers a re-fetch (`queryClient.invalidateQueries`). The button shows a loading state while in flight.
- [ ] If the API call fails, a Vibe `Banner` (danger) is shown with the error message and a `Retry` button. The existing task list (if cached) remains visible beneath it.
- [x] Empty states:
  - Project has no tasks at all: "No tasks in this project yet." — **done.**
  - Project has tasks but the active filter excludes all: "No tasks match your filters." — **done** (with a `Clear all filters` action).

### Inbox indicator

- [ ] If the board's project name contains `Inbox` (case-insensitive), the board header displays an Inbox icon next to the project name.
- [ ] Newly-created tasks in an Inbox project default `Category = INBOX` (see `create-task.md`).

## Wireframe

See: `docs/design/screen-project-board.d2` (to be drawn — references the monday.com screenshot in `docs/design/inspiration-monday.png`)

## Open questions

- [ ] Should pagination be visible to the user once a project exceeds the `$top=500` cap, or should we silently scroll-load? Defer to first time it bites.
- [ ] Should the `Search` toolbar button search the current board only, or all boards in the workspace? MVP: current board only.
