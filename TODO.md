# TODO

This file tracks planned public work for Vermilian. Items here are intentionally high level until
they are promoted into a full feature spec, issue, or pull request.

## Planned features

### Task effort estimating

Add first-class effort estimates to tasks so Vermilian can show planned work beside actual worklog
time from the timer.

- [ ] Identify the YouTrack field strategy for estimates.
  - Preferred: use an existing YouTrack custom field when available.
  - Fallback: document the expected field name and type for new installs.
- [ ] Add estimate display to task rows, cards, and the task detail panel.
- [ ] Support inline editing for task estimates from the main table view.
- [ ] Show estimate vs. logged time in task detail.
- [ ] Add validation for empty, zero, and unusually large estimates.
- [ ] Preserve YouTrack as the source of truth; Vermilian should not maintain a separate estimate
      store unless YouTrack lacks a compatible field.
- [ ] Add tests for parsing, formatting, optimistic update, rollback, and display states.

Acceptance criteria:

- [ ] A user can view and edit a task estimate without leaving Vermilian.
- [ ] Estimate changes are written back to YouTrack and survive refresh/restart.
- [ ] Logged focus time and planned estimate are visible together on a task.
- [ ] API failures keep the previous estimate and show a clear error.

### Bento effort view for projects

Add a project-level effort dashboard using a Bento-style layout: compact tiles that summarize
estimate, logged time, remaining work, and risk signals for the selected project.

- [ ] Add an `Effort` view tab beside the existing project board views.
- [ ] Design responsive Bento tiles for the primary effort metrics:
  - Total estimated effort.
  - Total logged time.
  - Remaining estimated effort.
  - Over-estimate / under-estimate variance.
  - Tasks without estimates.
  - High-priority remaining work.
- [ ] Add grouped breakdowns by Status, Priority, Category, and Due Date bucket.
- [ ] Add task drill-down from each tile to the filtered board view.
- [ ] Include an empty state for projects without tasks or without estimates.
- [ ] Make the view work with cached issue data and refresh when the project board refreshes.
- [ ] Add tests for aggregation, filtering handoff, empty states, and responsive layout.

Acceptance criteria:

- [ ] A user can open a project and understand total planned effort at a glance.
- [ ] Tiles use the current project's task data only.
- [ ] Clicking a tile takes the user to the relevant task subset.
- [ ] The layout remains readable on desktop and narrow windows.
- [ ] Missing estimates are visible enough to support cleanup before planning.

### File → About menu with version

Add a `File → About` application menu item that opens an About dialog showing the current app
version. The displayed version must match the released git tag for the running build.

- [ ] Add an `About Vermilian` item under the `File` menu in the main-process menu template.
- [ ] Open an About window/dialog from the menu handler (route through the IPC boundary — the
      renderer cannot read Electron/Node APIs directly).
- [ ] Source the version from `app.getVersion()` (which reads `app/package.json` `"version"`), so
      it always matches the tagged release per the release checklist.
- [ ] Present app name, version, and a short attribution/links block (repo, license) in the dialog.
- [ ] Match the existing modal-overlay styling used by `AppShell` dialogs.
- [ ] Add a test asserting the About payload version equals `package.json` `"version"`.

Acceptance criteria:

- [ ] `File → About` is present and opens an About dialog.
- [ ] The version shown equals the tagged release version (e.g. `v1.1.0` → `1.1.0`).
- [ ] The dialog matches Vermilian's existing modal look and is dismissible.

### Issue search

Add a search function to locate YouTrack issues. A search bar appears at the top of the main
display and returns matching issues from YouTrack.

- [ ] Add a search bar to the top bar of the main display (`AppShell` top chrome).
- [ ] Add a YouTrack search IPC channel + handler that queries the REST client with a user query
      string (extend `src/shared/ipc.ts` contract, register in `src/main/ipc.ts`).
- [ ] Support YouTrack query syntax (issue id, summary text, and common fields) with sensible
      defaults; debounce input to avoid excessive requests.
- [ ] Show results in a dropdown/panel; selecting a result opens the issue / navigates the board.
- [ ] Scope search appropriately (active project vs. all accessible projects) with a clear default.
- [ ] Handle empty query, no results, and API failure states with clear messaging.
- [ ] Back the fake YouTrack e2e stub so search is testable without network calls.
- [ ] Add unit tests for query building and result transforms, plus an e2e test for the search flow.

Acceptance criteria:

- [ ] A user can type in the top search bar and find YouTrack issues.
- [ ] Selecting a result navigates to or opens the matching issue.
- [ ] YouTrack remains the source of truth — no separate local index.
- [ ] Empty, no-result, and error states are handled gracefully.

## Follow-up specs

- [ ] Create `spec/features/task-effort-estimates.md`.
- [ ] Create `spec/features/project-effort-bento-view.md`.
- [ ] Add matching design wireframes under `docs/design/`.
- [ ] Update `README.md` highlights after the features ship.
- [ ] Add screenshots after the views are implemented.

## Notes for contributors

- Keep YouTrack as the backend and source of truth.
- Match the existing monday.com-style density and Vibe component usage.
- Prefer focused pull requests: estimate storage/editing first, project aggregation second, visual
  polish after the data path is proven.
