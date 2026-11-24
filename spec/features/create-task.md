# Feature: Create Task (Standard Form)

## Description

The standard task creation form lets the user create a new YouTrack issue by filling in a structured form. It opens as a Vibe `Modal` dialog over the project board when the user clicks the **New task** button or presses the keyboard shortcut. The form pre-populates the Project field from the current board's project (or the currently selected project if invoked from the workspace `All tasks` virtual entry), and Status, Priority and Category from the selected project's own field configuration (VERM-115). On successful submission the new task appears in the active board immediately without requiring a manual refresh.

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
  | Priority | No | The project's configured default, else blank | Dropdown of the project's active Priority values |
  | Status | No | The project's configured default, else blank | Dropdown of the project's active Status values |
  | Category | No | The project's configured default, else blank | Dropdown of the project's active Category values; disabled ("Not used in this project") when the project has no Category field |
  | Due Date | No | — (blank) | Date picker |
  | Ticket | No | — | Single-line text input |
  | Ticket link | No | — | URL input |
  | Tracking link | No | — | URL input |
  | Notes | No | — | Multi-line text area |

- [ ] **No value list is hard-coded on the create path (VERM-115).** Status, Priority and Category are read from the selected project's field configuration (`/api/admin/projects/{id}/customFields`, VERM-114's reader) on the active workspace's own YouTrack connection. Archived values are not offered. No value, such as `To do` or `Normal`, is assumed to exist.
- [ ] A blank field is omitted from the `POST`, so YouTrack applies the project's own default.
- [ ] While the project's options load, those three dropdowns and **Create** are disabled. If the read fails, the draft is kept and the form shows the error with a **Retry** action.
- [ ] `Date time entered` is **not** shown in the form. It is set automatically to the current client timestamp on submission and sent as a custom field, **only when the selected project defines `Date time entered` as a `date` or `date and time` field** (VERM-115). When the field is absent, or has any other type, it is left out of the payload.

### Validation

- [ ] The **Create** button is disabled while Summary is empty.
- [ ] If Summary is cleared after typing, the button disables again and a Vibe inline error message appears under the field: "Summary is required."
- [ ] If a URL field contains a value that does not begin with `http://` or `https://`, an inline error is shown: "Must be a valid URL."
- [ ] Validation errors are shown inline below the relevant field, not as a dialog or toast.

### Submission

- [ ] Clicking **Create** (or pressing **Enter** while Summary is focused and valid) submits the form.
- [ ] The Create button shows a loading state (disabled + spinner) while the API call is in flight.
- [ ] The API call is: `POST /api/issues` with the non-blank custom fields and, where the project accepts it, `Date time entered` set to `Date.now()` (milliseconds since epoch, as the YouTrack API expects).
- [ ] On success:
  - The modal closes.
  - The new task is prepended to the current task list without requiring a full refetch.
  - A Vibe `Toast` (positive, auto-dismiss 3 s) appears: "Task created — KP-XX" where KP-XX is the new issue's readable ID.
- [ ] On API failure:
  - The modal remains open with the form data intact.
  - A Vibe `Banner` (danger) appears at the top of the modal with the error message.
  - The Create button returns to its normal enabled state so the user can retry.
- [ ] **Main-process recheck (VERM-115).** Before sending, the main process confirms the form's workspace is still the active one, reads the selected project on that workspace's connection, and checks every submitted value against it. Any failure sends nothing and names the field and value (e.g. `Status "To do" is not a value in this project.`).
- [ ] YouTrack's refusal of an unknown value arrives as an unfilled template (`An Open-type entity with the specified name ({1}) was not found`, recorded 2026-11-24; whether `Open` is the refused value is unconfirmed). It is never shown raw. The word in the template (`Open-type`) does not identify the field or value: a submitted Status of `Open` alongside it proves nothing. A field and value are named only when the response itself names them, or when a fresh read of the project confirms the submitted value is no longer offered. Otherwise the message is "YouTrack rejected the request but did not identify the field.", with **Refresh project options**.
- [ ] **Bound to the originating workspace (VERM-115).** The form's workspace is passed with every options read and create. Each project-field read uses that workspace's own YouTrack connection, never whichever workspace is active when the read runs. If the user has switched workspace, the read and the create are cancelled before any request is made.

### Project context

- [ ] When the user changes the Project dropdown, the new project's options are read and applied (VERM-115). A Status, Priority or Category the user has not chosen takes the new project's default (or blank). A value the user chose is kept when the new project offers it, and otherwise cleared with an inline flag naming the field and value. Other fields are never reset. An answer for a project the form has since left is ignored.
- [ ] If the new project is an Inbox project (name contains `Inbox`, case-insensitive), Category is untouched and empty, and the project offers `INBOX`, Category pre-fills to `INBOX`.
- [ ] The Project dropdown lists all projects from the YouTrack API, grouped by the **workspace folder structure** (see `workspace-navigation.md`). Within each folder, projects are listed alphabetically. Projects not in the active workspace are shown in a collapsed section at the bottom labelled `Other workspaces`.

### Inbox default category

- [ ] If the selected Project's name contains `Inbox` (case-insensitive), the Category field has not been manually set in this form session, and the project offers `INBOX`, Category pre-fills to `INBOX`.
- [ ] An inline note appears beneath the Category dropdown: *"Auto-set because this is an Inbox project."* The user can change Category like any other field; the note disappears once changed.

## Wireframe

See: `docs/design/screen-create-task.d2`

## Open questions

<!-- Resolved questions (kept here for traceability):
- Modal vs inline panel: resolved — modal (this spec) is the full form; inline quick-add lives on the project board.
- INBOX default category: resolved — yes, see Inbox default category section above.
-->

- [ ] Should the modal support attaching a related-issue link (YouTrack `links` field) at create time? Defer.
