# Feature: Daily Stand-Up Report

## Description

The stand-up report feature generates a concise daily stand-up summary from the user's current YouTrack task state. The user triggers it with a button or keyboard shortcut; the app fetches relevant tasks, sends them to the Claude API, and renders the resulting markdown report in a panel. The report is divided into three standard stand-up sections: Done (completed since yesterday), In Progress (active today), and Blocked. The user can copy the report to the clipboard for pasting into Slack, email, or a daily log. This feature requires a Claude API key.

## Acceptance criteria

### Entry point and gating

- [ ] A **Stand-up** button (clock or calendar icon, labelled "Stand-up") is in the main toolbar at the top of the window, visible from all views.
- [ ] If no Claude API key is configured, the button is disabled. Hovering shows a Vibe `Tooltip`: "Configure a Claude API key in Settings to generate stand-up reports."
- [ ] The keyboard shortcut **S** (when no text input is focused and AI is configured) triggers the report.

### Scope and window selector

- [ ] When the Stand-up button is clicked, a Vibe `Menu` / popover appears with two controls:
  - **Scope** — radio group: `All tasks in workspace` (default), `Active workspace` (active workspace's projects only), `Custom workspace…` (opens a checklist of all workspaces to multi-select). Scope is computed against the **active workspace** by default — the previous `Personal` / `Work` hard-coded options are removed in favour of the workspace model (see `workspace-navigation.md`).
  - **Window** — segmented control: `24h` / `48h` (default) / `7d` / `Custom…`. The Window value controls how far back the "Done" candidates extend.
- [ ] Both Scope and Window default to the user's previously-selected values (persisted across app restarts in local app data).
- [ ] A `Generate` button at the bottom of the popover triggers the fetch + Claude call.

### Task fetch

- [ ] After scope + window selection, the app fetches issues from the YouTrack REST API filtered to the scoped projects.
- [ ] The fetch retrieves: `id`, `idReadable`, `summary`, `customFields` (Priority, Status, Category, Due Date, Notes), `updated` (YouTrack's last-updated timestamp), and `timeTracking` work items for today (so reported time spent can be included in the prompt — see `task-timer.md`).
- [ ] All tasks with Status = **Done** updated within the selected window (24h / 48h / 7d / custom) are included as "Done" candidates.
- [ ] All tasks with Status = **In Progress** are included as "In Progress" candidates.
- [ ] All tasks with Status = **BLOCKED** are included as "Blocked" candidates.
- [ ] Tasks with all other statuses are not sent to Claude (they are not included in the report).

### Claude API call

- [ ] The task data is sent to the Claude API from the Electron main process.
- [ ] The system prompt instructs Claude to generate a concise stand-up report in markdown with three sections: `## Done`, `## In Progress`, `## Blocked`.
- [ ] Each section is a bullet list. Each bullet is **prefixed with the YouTrack readable ID** followed by an em dash and a short summary: `- KP-42 — Refactor the API client to use TanStack Query`. Claude may lightly rephrase the summary text for readability but must preserve the issue ID verbatim.
- [ ] If a section has no tasks, Claude omits it from the report (no empty sections).
- [ ] If today's logged work-item duration (via the timer feature) is available for a task, Claude may append `(1h 25m today)` to that bullet. Tasks with no logged time get no parenthetical.
- [ ] The Claude model used for stand-up reports is configurable via Settings under **Model for stand-up reports**; the default is `claude-sonnet-4-6` (see [ADR-0006](../../docs/adr/0006-claude-model-selection.md)). This is a **separate** setting from the model used for AI task creation.
- [ ] While the API call is in flight, a loading state is shown in the report panel (spinner + "Generating report…").

### Report panel

- [ ] The report renders in a Vibe `Modal` or a right-side panel, depending on available space (modal on narrower windows).
- [ ] The markdown is rendered as formatted HTML — headings, bullet lists — not raw markdown text.
- [ ] The panel header shows "Daily Stand-Up" and the current date (`MMMM D, YYYY` format).
- [ ] A **Copy to clipboard** button copies the raw markdown text (not HTML) to the clipboard. After copying, the button label changes to "Copied ✓" for 2 seconds.
- [ ] A **Save to daily notes** button writes the markdown to `<daily-notes folder>/standup-<YYYY-MM-DD>.md` (folder configured in Settings — see `settings.md`). Behaviour:
  - If the folder is not configured in Settings, the button is disabled with a tooltip: *"Configure a daily-notes folder in Settings to save reports."*
  - If today's file does not exist, the file is created with the report as its content.
  - If today's file exists, the report is **appended** to the existing file separated by a `---` divider and a `## Stand-up (HH:MM)` heading using local time.
  - On success: button label briefly changes to "Saved ✓" for 2 seconds.
  - On filesystem error: Vibe `Toast` (danger) with the error message; the file is not partially written.
- [ ] A **Regenerate** button re-fetches tasks and re-calls Claude, replacing the current report. It shows a loading state while in flight.
- [ ] A **Close** button (or Escape) dismisses the panel.

### Error handling

- [ ] If the YouTrack task fetch fails, a Vibe `Banner` (danger) is shown in the panel: "Could not load tasks — check your connection." A **Retry** button re-attempts the fetch.
- [ ] If the Claude API call fails, a `Banner` (danger) is shown: "Report generation failed." with the error message and a **Retry** button.
- [ ] If the task fetch succeeds but returns zero eligible tasks (none Done in last 48 h, none In Progress, none Blocked), a `Banner` (info) is shown: "No recent activity to report. Try expanding the scope or check that tasks are up to date in YouTrack."

## Wireframe

See: `docs/design/screen-standup-report.d2`

## Open questions

<!-- Resolved questions (kept here for traceability):
- Window configurable: resolved — per-generation picker (24h / 48h / 7d / Custom) in the scope popover.
- Save to file: resolved — Save to daily notes button writes to a configurable folder, appends if today's file exists.
- Include issue IDs: resolved — yes, prefix each bullet with the readable ID (e.g., `- KP-42 — …`).
-->

- [ ] Should saved stand-ups be linkable back into Vermilian (clicking an ID in a saved file opens the task)? Defer — depends on whether Vermilian registers a `vermilian://` URL scheme.
- [ ] Should the report optionally include a `## Plan for today` section based on To do tasks? MVP says no; consider for v0.2.
