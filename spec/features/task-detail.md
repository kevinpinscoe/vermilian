# Feature: Task Detail

## Description

The task detail panel opens when the user clicks a task in the task list. It slides in as a right-side panel over the task list (the list remains visible and scrollable behind it), displaying the full field set for the selected YouTrack issue. Every field is inline-editable — the user clicks a field value to edit it in place and the change is saved to YouTrack on blur. There is no separate edit mode; reading and editing are the same view.

## Acceptance criteria

### Panel layout and behaviour

- [ ] The panel slides in from the right edge of the window when a task row is clicked, and slides out when closed. It does not navigate away from or unmount the task list.
- [ ] The panel width is fixed at approximately one-third of the window width (minimum 380 px).
- [ ] A **Close** button (×) in the panel header closes the panel. Pressing **Escape** also closes it.
- [ ] While the panel is open, clicking a different task row in the list loads that task into the panel without closing it.
- [ ] The panel header shows the YouTrack issue ID (e.g., `KP-42`) and the project name.

### Field display and inline editing

- [ ] All task fields are displayed in a two-column layout (field label on the left, value on the right):

  | Field | Editable? | Input type |
  |---|---|---|
  | Summary | Yes | Single-line text input |
  | Priority | Yes | Dropdown (Show-stopper / Critical / Major / Normal / Minor) |
  | Status | Yes | Dropdown (all valid status values) |
  | Category | Yes | Dropdown (all valid category values) |
  | Due Date | Yes | Date picker |
  | Ticket | Yes | Single-line text input |
  | Ticket link | Yes | URL input |
  | Tracking link | Yes | URL input |
  | Notes | Yes | Multi-line text area |
  | Date time entered | No | Read-only formatted datetime |

- [ ] Clicking a field value activates an inline editor for that field. The editor renders in place without a modal or separate form.
- [ ] Clicking outside a field's inline editor (blur) saves the change immediately via a YouTrack REST API PATCH call: `POST /api/issues/<id>?fields=id,summary,customFields(name,value(name))`.
- [ ] While a save is in flight, the field shows a saving indicator (Vibe `Loader` — small, inline).
- [ ] If the save fails, the field reverts to its pre-edit value and a Vibe `Toast` (type: `danger`) appears with the error. The user can retry by re-editing the field.
- [ ] A successful save shows a brief Vibe `Toast` (type: `positive`, auto-dismiss after 2 s): "Saved."
- [ ] Priority and Status values are displayed as Vibe `Chip` components with the same semantic colours as in the task list.

### Links

- [ ] Ticket link and Tracking link values, when set, render as clickable hyperlinks that open in the operating system's default browser via Electron's `shell.openExternal()`. The raw URL is shown as the link text.
- [ ] When a URL field is empty and not in edit mode, an "Add link" placeholder is shown in muted text.

### Keyboard navigation

- [ ] **Tab** advances focus to the next inline-editable field (visual top-to-bottom order). **Shift+Tab** moves to the previous field.
- [ ] **Enter** in a single-line editor commits and advances to the next field (same as Tab).
- [ ] **Enter** in the multi-line Notes textarea inserts a newline; **Ctrl+Enter** (Linux/Windows) / **Cmd+Enter** (macOS) commits and moves to the next field.
- [ ] **Esc** while editing a field reverts that field's value and exits the editor without saving.

### Status changes

- [ ] The Status dropdown lists **all** valid Status values (`To do`, `In Progress`, `Done`, `Waiting for IT`, `BLOCKED`, `Waiting for approval`, `Waiting for customer`, `Waiting on external resource`). The client does not pre-filter to YouTrack workflow-allowed transitions in MVP.
- [ ] If YouTrack rejects a Status change (e.g., a workflow rule blocks the transition), the field reverts to its pre-edit value and a Vibe `Toast` (danger) shows the API error message verbatim.

### Timer integration

- [ ] The panel header includes a `▶ Start timer` button next to the Delete button (see `task-timer.md` for full behaviour).
- [ ] If this task is the currently-timed task, the button is replaced with `⏹ Stop timer (mm:ss)`, live-updated.

### Task deletion

- [ ] A **Delete** button (trash icon) is in the panel header or a footer action bar.
- [ ] Clicking Delete shows a Vibe `AlertDialog` confirmation: "Delete this task? This cannot be undone."
- [ ] Confirming deletion calls `DELETE /api/issues/<id>` and, on success: closes the panel, removes the task from the task list, and shows a Vibe `Toast`: "Task deleted."
- [ ] If deletion fails, the dialog closes, the task remains in the list, and a `Toast` (danger) shows the error.

### Loading and error states

- [ ] When the panel first opens (or when switching between tasks), a Vibe `Loader` is shown until the full issue details are loaded from the API.
- [ ] If the detail fetch fails, a `Banner` (danger) is shown inside the panel with a **Retry** button.

## Wireframe

See: `docs/design/screen-task-detail.d2`

## Open questions

<!-- Resolved questions (kept here for traceability):
- Keyboard navigation: resolved — Tab/Shift+Tab/Enter/Esc as specified above.
- Status workflow constraint: resolved — no client-side constraint; surface YouTrack rejections as Toasts.
-->

- [ ] Should the panel offer a "previous / next task" pair of buttons or shortcuts so the user can step through the current board's filtered list without closing the panel? Defer.
