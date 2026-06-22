# Feature: Create Task (Standard Form)

## Description

The standard task creation form lets the user create a new YouTrack issue by filling in a structured form. It opens as a Vibe `Modal` dialog over the project board when the user clicks the **New task** button or presses the keyboard shortcut. The form pre-populates the Project field from the current board's project (or the currently selected project if invoked from the workspace `All tasks` virtual entry), and Priority and Status with sensible defaults. On successful submission the new task appears in the active board immediately without requiring a manual refresh.

A lighter **inline quick-add** path also exists at the bottom of each group on the project board (see `project-board.md`). The inline path covers most "I just need to capture a task fast" cases; the modal in this spec is for tasks that need fields beyond Summary up front.

## Acceptance criteria

### Opening the form

- [ ] The **New task** button (`+`) in the top-left of the left rail opens the form.
- [ ] The keyboard shortcut **N** (when no text input is focused) also opens the form.
- [ ] The form opens as a Vibe `Modal` dialog centred in the window.
- [ ] Pressing **Escape** or clicking the modal backdrop dismisses the form without creating a task.

### Form fields

- [ ] The form contains all task fields in a single-column layout:

  | Field | Required? | Default | Input type |
  |---|---|---|---|
  | Summary | Yes | — | Single-line text input (auto-focused on open) |
  | Project | Yes | Currently selected project in left rail; falls back to first project if "All" is selected | Dropdown of all available projects |
  | Priority | No | Normal | Dropdown (Show-stopper / Critical / Major / Normal / Minor) |
  | Status | No | To do | Dropdown (all valid status values) |
  | Category | No | — (blank) | Dropdown (all category values) |
  | Due Date | No | — (blank) | Date picker |
  | Ticket | No | — | Single-line text input |
  | Ticket link | No | — | URL input |
  | Tracking link | No | — | URL input |
  | Notes | No | — | Multi-line text area |

- [ ] `Date time entered` is **not** shown in the form — it is auto-set to the current client timestamp on submission and sent as a custom field in the API payload.

### Validation

- [ ] The **Create** button is disabled while Summary is empty.
- [ ] If Summary is cleared after typing, the button disables again and a Vibe inline error message appears under the field: "Summary is required."
- [ ] If a URL field contains a value that does not begin with `http://` or `https://`, an inline error is shown: "Must be a valid URL."
- [ ] Validation errors are shown inline below the relevant field, not as a dialog or toast.

### Submission

- [ ] Clicking **Create** (or pressing **Enter** while Summary is focused and valid) submits the form.
- [ ] The Create button shows a loading state (disabled + spinner) while the API call is in flight.
- [ ] The API call is: `POST /api/issues` with the full field payload including all custom fields and `Date time entered` set to `Date.now()` (milliseconds since epoch, as the YouTrack API expects).
- [ ] On success:
  - The modal closes.
  - The new task is prepended to the current task list without requiring a full refetch.
  - A Vibe `Toast` (positive, auto-dismiss 3 s) appears: "Task created — KP-XX" where KP-XX is the new issue's readable ID.
- [ ] On API failure:
  - The modal remains open with the form data intact.
  - A Vibe `Banner` (danger) appears at the top of the modal with the error message.
  - The Create button returns to its normal enabled state so the user can retry.

### Project context

- [ ] When the user changes the Project dropdown, the form does not reset any other field values, with one exception: if the new project is an Inbox project (name contains `Inbox`, case-insensitive) and the Category field is still empty, Category pre-fills to `INBOX`. Conversely, switching away from an Inbox project does **not** clear a previously-auto-set INBOX Category — the user is in control once a value is shown.
- [ ] The Project dropdown lists all projects from the YouTrack API, grouped by the **workspace folder structure** (see `workspace-navigation.md`). Within each folder, projects are listed alphabetically. Projects not in the active workspace are shown in a collapsed section at the bottom labelled `Other workspaces`.

### Inbox default category

- [ ] If the selected Project's name contains `Inbox` (case-insensitive) and the Category field has not been manually set in this form session, Category pre-fills to `INBOX`.
- [ ] An inline note appears beneath the Category dropdown: *"Auto-set because this is an Inbox project."* The user can change Category like any other field; the note disappears once changed.

## Wireframe

See: `docs/design/screen-create-task.d2`

## Open questions

<!-- Resolved questions (kept here for traceability):
- Modal vs inline panel: resolved — modal (this spec) is the full form; inline quick-add lives on the project board.
- INBOX default category: resolved — yes, see Inbox default category section above.
-->

- [ ] Should the modal support attaching a related-issue link (YouTrack `links` field) at create time? Defer.
