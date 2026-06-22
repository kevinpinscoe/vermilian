# vermilian — Requirements

## Scope

Vermilian is an Electron desktop client for a self-hosted JetBrains YouTrack instance. YouTrack is the backend and source of truth. Vermilian communicates with it exclusively through the YouTrack REST API.

## Functional requirements

### Task browsing and management

- View tasks across all projects in the connected YouTrack instance
- Create, read, update, and delete tasks via the YouTrack REST API
- Filter and sort tasks by Priority, Status, Category, Due Date, and Project
- Inbox → project workflow: tasks land in an inbox project and are triaged to destination projects
- Per-project boards with multiple saved views (Main table + Kanban in MVP; Gantt deferred to v0.2)
- Configurable columns (show / hide / reorder / resize) and per-board colour overrides on enum chip values
- Drag-and-drop between groups on a board (updates the group-by field) and between project boards within the same workspace (moves the issue between YouTrack projects)
- Inline `+ Add task` at the bottom of each board group for fast capture

### Workspaces and organization

- Multiple top-level workspaces (e.g., Work, Personal, future Client/Customer workspaces); one active at a time
- Manual folder tree within each workspace; each YouTrack project is assigned to exactly one folder in exactly one workspace
- Workspace structure, folder tree, project assignments, and per-board configuration sync across machines via a single YouTrack Knowledge Base Article (`_vermilian-config`)

### Task time tracking and focus

- Per-task timer with Pomodoro mode (25-minute work blocks + 5-minute breaks, configurable; long break every 4 blocks by default)
- "Focus mode" while a work block runs: a dim overlay blocks interaction with the rest of the app to support single-task attention (ADHD-aware design)
- Only one timer can run at a time, app-wide
- Stopping a timer auto-logs the elapsed work-block minutes to YouTrack as a work item (`POST /api/issues/{id}/timeTracking/workItems`)
- Quit attempts while a timer is running are intercepted with a confirmation dialog; forced exits auto-log on next launch from a checkpoint file

### Task fields

Each task must support the full YouTrack field set used on this instance:

| Field | Values |
|---|---|
| Priority | Show-stopper / Critical / Major / Normal / Minor |
| Status | To do / In Progress / Done / Waiting for IT / BLOCKED / Waiting for approval / Waiting for customer / Waiting on external resource |
| Category | OPS / COMPANY / SERVICE / PRODUCTIVITY / PROJECT / INBOX / ADMIN / RELEASE / FINOPS / SECURITY |
| Due Date | optional date |
| Ticket | optional Jira ticket number |
| Ticket link | optional URL |
| Tracking link | optional URL |
| Notes | optional free text |

### Projects

- Display personal projects (`Kevin -` prefix) and work projects (`Work -` prefix)
- Create tasks in the correct project from context

### AI integration (runtime)

- Natural-language task creation: describe a task in plain English → Claude API creates a structured YouTrack issue. Default model: Claude Haiku 4.5 (see ADR-0006)
- Daily stand-up report generated from current task state. Default model: Claude Sonnet 4.6 (ADR-0006). Configurable scope and window (24h / 48h / 7d / custom)
- Stand-up report can be copied to clipboard and / or saved to a configurable daily-notes folder
- Both AI features require an Anthropic API key configured in Settings; disabled otherwise

### Connection and authentication

- User supplies YouTrack base URL and a permanent API token
- Credentials stored in the OS keychain (not in plain files on disk)

## Non-functional requirements

- Cross-platform: Linux x86_64, macOS x86_64/ARM64, Windows 11, Raspberry Pi OS ARM64
- Electron desktop app — no server component required on the user's machine
- Credentials never committed to the repository
- App builds and packages with electron-forge

### UI and visual design

- Look and feel targets **monday.com**: colour-coded priority/status chips, left-rail project navigation, high-density board and list views, inline editing without full-page reloads
- Built with the **monday.com Vibe Design System** (`@vibe/core`) — the official React component library for monday.com-style applications; covers theming, data display, navigation, layout, inputs, popovers, feedback, and accessibility
- All colours, typography, spacing, and elevation values come from Vibe design tokens — no custom CSS overrides unless Vibe has no equivalent
- Dark / light theme via Vibe's theme provider; no custom theme implementation

## Out of scope

- Replacement of YouTrack as a backend (Vermilian is a client only)
- SaaS or cloud-vendor lock-in
- Web-hosted deployment
- CLI-only interface as the primary UI

## Open questions

<!-- Resolved questions are kept here as `[x]` with the ADR link, for traceability. -->
- [x] YouTrack REST API namespace → modern `/api` only — see [ADR-0005](adr/0005-youtrack-rest-api.md)
- [x] State management → **TanStack Query + Zustand** — see [ADR-0002](adr/0002-state-management.md)
- [x] Styling approach → **Vibe Design System** (`@vibe/core`) — see [ADR-0003](adr/0003-styling.md)
- [x] Credential storage → **Electron `safeStorage`** with Linux fail-closed check — see [ADR-0004](adr/0004-credential-storage.md)
- [x] Claude model defaults → Haiku 4.5 for AI create, Sonnet 4.6 for stand-up — see [ADR-0006](adr/0006-claude-model-selection.md)

All Phase 1 open questions are resolved. New design questions surfaced during implementation should be raised as ADRs.
