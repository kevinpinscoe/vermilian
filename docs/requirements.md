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

### Priority Desk

A cross-project decision surface, above "All tasks" in the left rail, that answers one
question — *what should I work on now* — from a small ranked set rather than a scrolling
text file. YouTrack remains the source of truth for issues, epics, fields, comments, and
links; the desk is a curated view onto it, never a second store. See
[ADR-0007](adr/0007-priority-desk-field-model.md) for the field-model decision and
`docs/design/screen-priority-desk-*.d2` / `flow-priority-desk.mmd` for the wireframes.

- Three shared, optional custom fields, added to every active project:
  - `Focus` — YouTrack `enum[1]`, single-value, whose only defined enum value is `Yes`.
    Unset/null means not focused. There is no `empty` enum value — absence of a value
    **is** the "not focused" state, not a value to select.
  - `Focus rank` — YouTrack `integer`. Application-valid values are `1`, `2`, or `3`;
    unset/null means unranked. Setting a rank implies `Focus = Yes`. YouTrack's schema
    does not constrain the range or prevent two issues sharing a rank — Vermilian
    enforces both; see "Focus-rank invariant" below.
  - `Why now` — YouTrack `string` (not `text`): a short, human-authored reason shown on
    the card.

  Clearing `Focus` clears the rank but preserves `Why now` for later reconsideration.
- `Focus` is a low-friction toggle wherever a task is shown: board rows, Kanban cards, and
  the task detail panel.
- **Focus-rank invariant**: within the active workspace, at most one issue may hold each
  of rank `1`, `2`, and `3` at a time. Normal UI operations preserve this — dragging a
  card onto an occupied slot, or setting a fourth rank while all three are already full,
  asks which issue keeps the slot rather than silently overwriting or evicting one. If
  Vermilian ever discovers two or more issues sharing a rank in the active workspace —
  stale local state, a partial write, a change made by another client or another machine,
  or an edit made directly in the YouTrack web UI — it does not pick a winner on its own.
  It surfaces a repair state naming every issue holding the disputed rank and requires the
  user to choose which one keeps the slot; the others are cleared to unranked (`Focus`
  stays `Yes`, `Why now` is preserved) rather than silently reassigned to a different rank.
- **Now mode**: at most three ranked cards (Now / Next / Then) showing issue ID, summary,
  project, parent epic, priority, a blocker/dependency warning, and the `Why now` note.
  Empty slots are intentional and never forced to fill. "Now" has a `Start focus` action
  that starts the existing per-task timer.
- **Choose next mode**: no more than seven eligible candidates in a quiet comparison grid
  (see "Choose-next eligibility" below for what qualifies and how ties beyond seven are
  broken). Cards can be starred, opened, or dragged into a Now/Next/Then slot. A "Not this
  week" dismissal removes a candidate from the decision surface until the dismissal
  expires (see "'Not this week' expiration" below), without changing its YouTrack
  `Priority`. Filters are limited to workspace, status, and active epic — full search
  stays on the existing All-tasks table.
- **Choose-next eligibility**: an issue is an eligible candidate only if all of the
  following hold:
  - it belongs to a project assigned to a folder in the **active workspace**;
  - its `Status` is not `Done`;
  - it does not already carry a `Focus rank` (ranked issues show in Now mode instead of
    the candidate grid — an issue with `Focus = Yes` and no rank still appears here,
    starred);
  - it is not currently dismissed under an unexpired "Not this week" entry;
  - it matches the user's selected Status filter, when one is set;
  - it matches the user's selected active-Epic filter, when one is set.

  When more than seven issues are eligible, the grid shows the top seven under a fixed,
  deterministic sort — never a hidden numerical priority score:
  1. `Due Date` ascending (soonest first; issues with no `Due Date` sort last);
  2. `Priority`'s own ordinal, descending (`Show-stopper` > `Critical` > `Major` >
     `Normal` > `Minor`);
  3. `idReadable` ascending, as the final, always-unique tiebreak.

  Every step reads an existing field's own value or ordinal directly; there is no
  blended or weighted score behind the ordering.
- **"Not this week" expiration**: a dismissal is not an indefinite hide. It excludes the
  issue from the Choose-next candidate set only through the end of the local calendar
  week (Monday–Sunday, evaluated in the device's local timezone) in which it was made.
  `_vermilian-config` stores one entry per dismissed issue as
  `{ workspace, issueId, dismissedWeekOf }`, where `dismissedWeekOf` is the ISO date
  (`YYYY-MM-DD`) of the Monday that starts the local week the dismissal happened in. At
  eligibility time, Vermilian computes the Monday date of the *current* local week; the
  issue is excluded only while its stored `dismissedWeekOf` equals that value. Once the
  current week's Monday has moved past it, the issue is eligible again automatically —
  no separate cleanup step. A stale entry left in `_vermilian-config` past its week never
  suppresses eligibility; entries may be pruned opportunistically the next time the
  article is rewritten. This, and other transient desk preferences, persist in the
  existing `_vermilian-config` YouTrack Knowledge Base Article, keyed by workspace and
  issue ID — no new local task database.
- Reads native YouTrack Epic → Subtask issue links to show the parent epic and outcome name
  on a card. Creating or restructuring those links, and full portfolio management, are out
  of scope for the desk itself.
- **Master Plan**: a single Master Plan article — a YouTrack Knowledge Base article, exact
  summary `_vermilian-master-plan`, owned by project `VERM`, top-level (a sibling of
  `_vermilian-config`, never its child) — see [ADR-0008](adr/0008-master-plan-storage.md).
  It defines the outcomes the desk and the AI recommendation reason against:

  `Outcome/theme → active epics → success measure → target window → risks/dependencies`

  The article is **human-maintained**: Kevin authors and edits it by hand in YouTrack.
  Vermilian **finds, reads, parses, and displays** it — deterministically matching both
  the exact summary and the owning project, never treating a bounded/incomplete search as
  proof of absence or uniqueness — but **never creates, overwrites, or automatically
  repairs** it. A task's parent Epic (native YouTrack relationship, above) resolves to a
  Master Plan outcome when that Epic's `idReadable` appears in the outcome's `Active
  epics` list; the Epic identifier shown anywhere in the UI is always the native
  `idReadable`, never anything read from the article. No match, more than one matching
  article, an unreachable/incomplete discovery, or malformed/partial article content are
  all distinct, surfaced states — none of them silently choose a default or break Priority
  Desk or ordinary task display; a persistent, dismissible diagnostic banner names the
  problem when one exists. An Epic listed under more than one outcome is itself an
  ambiguous association (no outcome shown for it, folded into the same diagnostic) rather
  than a first-match guess. Full authoring workflow and per-epic "next milestone" tracking
  remain Epic-context delivery-step scope beyond this minimum.

  Selecting an outcome for a recommendation call means selecting one Master Plan entry;
  its active epics and their own descriptions are the planning context bounded into that
  call, subject to the data-scope rule below.
- **Ask for recommendation** (built only once the manual desk is trusted): evaluates the
  bounded candidate set against a selected Master Plan outcome and returns a ranked
  top-three-plus-alternates proposal with qualitative evidence (outcome contribution,
  dependency readiness, urgency, effort, risk) — or a concrete question when it cannot make
  a sound recommendation. It never writes a field, rank, status, or epic link itself; the
  confirmation UI offers **Apply to desk**, **Star only**, and **Keep my order**.
  - **Data scope**: a recommendation call sends only the explicitly selected, bounded
    issue summaries, descriptions, relevant issue links, and the selected Master Plan
    excerpt needed for that call. It never silently sends all comments, credentials,
    unrelated projects, or any other unselected YouTrack data.
  - **Audit record**: the recommendation shown and the user's resulting choice (Apply to
    desk / Star only / Keep my order) are recorded as a YouTrack comment on the
    top-ranked recommended issue — the canonical audit record. A Master Plan article is a
    planning document Kevin edits by hand (see "Master Plan" above); it is not a target
    for automated writes.
- **Daily Review**: reuses the existing Daily Stand-up capability to surface completed
  work, active focus slots, blocked focus work, and agent work awaiting a human decision.
  AI agents stay executors throughout — they can propose work and report results, never
  select priorities or close accepted work on their own.

Delivery is phased — Foundation → Manual desk → Epic context → AI recommendation → Daily
Review — tracked in `TODO.md` and
[VERM-3](https://youtrack.kevininscoe.com/issue/VERM-3).

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
- [x] Priority Desk field model → dedicated `Focus` / `Focus rank` / `Why now` fields, not an overload of `Priority` — see [ADR-0007](adr/0007-priority-desk-field-model.md)

All Phase 1 open questions are resolved. New design questions surfaced during implementation should be raised as ADRs.
