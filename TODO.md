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
