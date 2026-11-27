# E2E acceptance-criteria coverage (PLAN 3.3)

Maps each `spec/features/*.md` acceptance-criteria section to how it is verified.
Legend:

- ✅ **E2E** — automated Playwright test (file noted)
- 🧪 **Unit** — Vitest covers the underlying logic (not the rendered flow)
- ✋ **Manual** — documented in `TESTING.md` (DnD reorder Playwright can't drive — see fixmes)
- ⬜ **Gap** — e2e-testable against the current fake-YouTrack harness, not yet written
- 🚫 **Out of harness** — needs Claude/OS dialogs/keyring/real network; not reachable in the fake harness today

The fake harness (`src/main/api/fakeYouTrack.ts`) serves projects, board issues, issue
detail, patch, move, create, delete, and the config Article — so board, detail, workspace,
and config flows are reachable. It does **not** mock Claude, OS file dialogs, the OS keyring,
notifications, or the timer worklog round-trip.

---

## workspace-navigation.md
| Section | Status | Where |
|---|---|---|
| Left-rail layout (project rows, count badge, active state) | ⬜ Gap | nav rows asserted indirectly in `workspace-nav.spec.ts` |
| Folder collapse/expand persistence | 🧪 Unit-ish | manual; localStorage |
| Collapsible rail (hamburger collapse / re-expand) | ✅ E2E | `workspace-folders.spec.ts` |
| Workspace switcher — create / Manage | ✅ E2E | `workspace-nav.spec.ts` (create workspace, Manage lists + blocks delete) |
| Folder management — add folder | ✅ E2E | `workspace-nav.spec.ts` (add folder) |
| Folder management — rename / delete | ✅ E2E | `workspace-folders.spec.ts` |
| Folder management — move up/down | ✅ E2E | `workspace-folders.spec.ts` |
| Project assignment (drag between folders / across workspaces) | ✋ Manual | dnd-kit drag; `TESTING.md` |
| Add projects picker — membership, search, short names, ranking, refetch on open | ✅ E2E | `add-projects.spec.ts`, `add-projects-short-names.spec.ts` (VERM-120); ranking in `workspace.test.ts` |
| Empty-state / onboarding banner | ✅ E2E | `workspace-nav.spec.ts` (fresh-install banner) |

## project-board.md
| Section | Status | Where |
|---|---|---|
| Board entry, header project name, view tabs | ✅ E2E | `board-header.spec.ts` (name), `board-interactions.spec.ts` (kanban tab) |
| Toolbar buttons present; New task opens modal | ✅ E2E | `board-toolbar-groups.spec.ts`, `create-task.spec.ts` |
| Search button opens filter bar + focuses search (Person descoped from MVP) | ✅ E2E | `board-filter-sort.spec.ts` |
| Group by (regroup + options) | ✅ E2E | `board-interactions.spec.ts` (regroup) |
| Main table — group headers, count badge | ✅ E2E | implied by `group-header` assertions |
| Main table — group collapse/expand chevron | ✅ E2E | `board-toolbar-groups.spec.ts` |
| Column reorder / resize / hide | ✅ E2E | `dnd.spec.ts` (reorder, resize, show/hide) |
| Column-header click sort + arrow | ✅ E2E | `dnd.spec.ts` (sort after reorder), `board-filter-sort.spec.ts` |
| Click row opens detail | ✅ E2E | `board-interactions.spec.ts`, `detail-panel.spec.ts` |
| Inline edit — summary text cell | ✅ E2E | `board-interactions.spec.ts` |
| Inline edit — chip cells (Status/Priority/Category) | ✅ E2E | `inline-chip-edit.spec.ts` |
| Inline edit — Due Date picker | ✅ E2E | `board-interactions.spec.ts` (sets a date on an undated task) |
| Quick-add `+ Add task` (Enter creates, Esc cancels) | ✅ E2E | `quick-add.spec.ts` |
| Kanban view render + columns | ✅ E2E | `board-interactions.spec.ts` |
| Kanban drag between columns | ✋ Manual | `TESTING.md` |
| DnD between groups | ✅ E2E | `dnd.spec.ts` (between-group) |
| DnD reorder within group | ✋ Manual | `dnd.spec.ts` fixmes + `TESTING.md` |
| DnD cross-board (highlight, confirm, cancel, same-project no-op) | ✅ E2E | `dnd.spec.ts` (cross-board) |
| Filtering (bar, pills, search, clear, empty state) | ✅ E2E | `board-filter-sort.spec.ts` |
| Empty state — project has no tasks ("No tasks in this project yet") | ✅ E2E | `empty-state.spec.ts` (Empty Project fixture) |
| Due Date range filter (Before / On / After / Range) | ✅ E2E | `board-filter-sort.spec.ts` (dated TEST fixtures) |
| Assignee filter (Me / Unassigned / named, All tasks + project board + Jira board) | ✅ E2E | `assignee-filter.spec.ts`, `board-search.spec.ts` (assigned TEST/TST2 and DEMO fixtures) |
| Board search — instant filter, backend search incl. Done, result opens detail, `/` shortcut, Jira top-bar scope, 401 message | ✅ E2E | `board-search.spec.ts` (fake Jira DEMO-109 Done fixture) |
| Data loading — Loader / Refresh / error Banner | ⬜ Gap | — |
| Inbox indicator (board header) | ✅ E2E | `board-header.spec.ts` (Team Inbox fixture) |

## task-detail.md
| Section | Status | Where |
|---|---|---|
| Panel opens on row click | ✅ E2E | `detail-panel.spec.ts`, `board-interactions.spec.ts` |
| Close via × and Escape | ✅ E2E | `detail-panel.spec.ts` |
| Switch task while open | ✅ E2E | `detail-panel.spec.ts` |
| Header shows issue ID + project | ✅ E2E | `detail-panel.spec.ts` |
| Inline field edit (Enter saves / Esc reverts) | ✅ E2E | `detail-field-edit.spec.ts` |
| Links open via shell.openExternal | 🚫 Out of harness | — |
| Keyboard nav (Tab / Enter / Esc) | ⬜ Gap | — |
| Status change reverts on API reject | 🚫 Out of harness | fake never rejects |
| Timer integration (Start/Stop button) | 🚫 Out of harness | timer worklog |
| Delete + confirm dialog + remove | ✅ E2E | `detail-panel.spec.ts` |
| Loading / error states | 🚫 Out of harness | fake never fails |

## board-configuration.md
| Section | Status | Where |
|---|---|---|
| Storage & sync (Article load/create, debounce, retry, merge, version guard) | 🧪 Unit | `articleCodec.test.ts`, `youtrack.test.ts` |
| Column editor (Hide panel show/hide/reorder/width) | ✅ E2E (show/hide) / ⬜ Gap (width input, reset link) | `dnd.spec.ts` |
| Colour editor (Board settings → Colours) | ⬜ Gap | — |
| Views tab (rename/duplicate/delete/new) | ⬜ Gap | — |
| Danger zone — reset board | ⬜ Gap | — |
| Default new-board behaviour (lazy write) | 🧪 Unit | `boardConfig.test.ts` (defaults) |
| Migration (version too high / too low) | 🧪 Unit | `articleCodec.test.ts` |

## settings.md
| Section | Status | Where |
|---|---|---|
| Access — open from rail gear | ✅ E2E | `settings.spec.ts` |
| Layout (sections, Save/Cancel footer) | ✅ E2E | `settings.spec.ts` |
| Connection — Test connection | 🧪 Unit | `youtrack.test.ts` (getCurrentUser), `errors.test.ts` |
| AI — keys / model fields / test | 🧪 Unit | `errors.test.ts` |
| Jira — profile fields, Test connection, Save to YouTrack (VERM-20) | ✅ E2E | `jira-settings.spec.ts` (fake Jira: classic probe result + detected cloudId, rejected token, invalid profile, seeded profile); probe logic 🧪 `jira.test.ts` |
| Jira — read-only list of my open issues (VERM-21) | ✅ E2E | `jira-list.spec.ts` (key, summary, status, priority from fake Jira; not-set-up state → Settings); paging + transform 🧪 `jira.test.ts`, `jiraIssue.test.ts` |
| Runway metadata store — Jira Focus / rank / Why now in local SQLite (VERM-37) | ✅ E2E | `runway-store.spec.ts` (Jira entry survives relaunch; duplicate rank and bare ID refused, via IPC); stores and rules 🧪 `runwayStore.test.ts`, `runway.test.ts`, `runwayDb.test.ts` |
| Runway snapshot export — whole database via SQLite online backup, Settings → Advanced (VERM-50) | ✅ E2E | `runway-snapshot.spec.ts` (stubbed save dialog; snapshot passes integrity_check, application_id, schema version, row counts across two workspaces; cancel writes nothing; existing file refused and untouched); service 🧪 `runwaySnapshot.test.ts` (consistency under concurrent writes, no overwrite, symlink/live-db refusal, failure cleanup) |
| Runway snapshot import — preview, confirm, automatic backup, transactional replace, Settings → Advanced (VERM-51) | ✅ E2E | `runway-snapshot-import.spec.ts` (stubbed open dialog; preview shows export time as not recorded, file mtime labelled as file metadata, schema version, snapshot vs current counts, backup folder; confirm restores both workspaces and writes one verified backup; cancel changes nothing; non-snapshot refused; file changed after preview refused; overlapping preview/confirm/cancel during a held import refused and its staged copy kept); lifecycle 🧪 `runwayImportSession.test.ts` (race reproduction, second preview/window, duplicate confirm, cancel, failure cleanup); service 🧪 `runwayImport.test.ts` (corrupt/foreign/newer/mismatched schemas refused, live constraints enforced, mid-replace failure rolls back, failed backup aborts, backup restorable, live change after backup refused, busy, post-commit verification failure, retention of newest 10 and safe pruning, write gate ordering) |
| Per-workspace configuration articles — `_vermilian-ws-<id>` discovery, read, create, update (VERM-43) | ✅ E2E | `workspace-articles.spec.ts` (two workspaces independently, two-machine merge and same-field conflict, unknown fields kept, duplicates refused and left alone, via IPC); merge, stale-write retries and create race 🧪 `workspaceMerge.test.ts`, `workspaceArticles.test.ts` |
| Migration from `_vermilian-config` and the Jira profile article to per-workspace articles (VERM-44), run only inside activation (VERM-53) | ✅ E2E | `workspace-storage-activation.spec.ts` (startup migrates nothing, preview writes nothing, Jira workspace only when named, originals unchanged); conflicts, duplicates, invalid sources, secrets and current-source reads 🧪 `workspaceMigration.test.ts` |
| Per-workspace storage activation and return to legacy storage (VERM-53) | ✅ E2E | `workspace-storage-activation.spec.ts` (Settings activation after confirmation, verified private backup, an unsaved legacy edit saved and verified first or activation refused, incomplete migration and unresolvable credential leave legacy authoritative, a legacy machine blocked after another activated, board settings and dismissals isolated per workspace, return refused after a change or an older client's write, allowed without one); two-machine generations, fresh marker check on every write, races and every failure path 🧪 `storageActivation.test.ts`; pending, failed, retrying, unverified and overlapping legacy saves 🧪 `articleConfig.test.ts` |
| Per-reference credentials: configure, check, fail closed, legacy references untouched (VERM-45) | ✅ E2E | `credential-refs.spec.ts` (status lists legacy refs and reports sources as booleans only — no command text or path, file source resolves without returning the value, broken source stops, no reference is unavailable, legacy refs and `saveConfig` cannot change per-reference sources, via IPC); command/file/blob success and failure, no fall-through, value checks, isolation, safe messages and status/check never disclosing source details 🧪 `credentialResolver.test.ts`, `credentialSources.test.ts`, `credentialRefs.test.ts`, `config.test.ts` |
| One active workspace per machine; switching with a running timer asks Stop timer or Cancel (VERM-46) | ✅ E2E | `workspace-switch.spec.ts` (switching changes the board; the choice is stored locally in `active-workspace.json` and survives a relaunch, never written to `_vermilian-config`; Cancel keeps the workspace and the timer; Stop timer logs then switches; per-workspace storage behind the e2e-only gate switches the backend context, YouTrack board shown, Jira board reported unavailable); resolution order, board availability and non-secret backend context 🧪 `activeWorkspace.test.ts` |
| Timer & Pomodoro inputs | ⬜ Gap | — |
| Daily notes folder (Browse picker) | 🚫 Out of harness | OS dialog |
| Appearance — theme switch | ✅ E2E | `theme.spec.ts` (dark toggle) |
| Advanced — reset to defaults / open config folder | ⬜ Gap / 🚫 (open folder) | — |
| Cancel returns to board + discard-unsaved-credentials guard | ✅ E2E | `settings.spec.ts` |
| Save persists config + returns to board | ✅ E2E | `settings.spec.ts` (change → Save → reopen; "Settings saved" toast flashes before close → manual) |
| Credential storage (safeStorage, fail-closed) | 🚫 Out of harness | keyring |
| Friendly error messages | 🧪 Unit | `errors.test.ts` |

## workspace-runway.md — end-to-end acceptance scenarios (VERM-75)

Each scenario of the spec's *End-to-end acceptance* list, and the test that asserts it. ⚠ **Partial**
marks a scenario only part of which an automated test asserts; the rest is named. Scenarios 6, 7
and 14 are mapped elsewhere (6 and 7 in `all-tasks-sort.spec.ts` and `kanban-sort.spec.ts`; 14
below).

| # | Scenario | Status | How |
| --- | --- | --- | --- |
| 1 | Import: the example gives a workspace with #1..5 in file order, the section and notes in place, READ-9 unscheduled, no project moved; Cancel leaves the database byte-identical | ✅ E2E | `runway-markdown-import.spec.ts` "the section 5 example: a proposed workspace with #1..5, its section and notes, READ-9 unticked; Cancel writes nothing" (byte-identical database); `runway-markdown-apply.spec.ts` "per-workspace storage: the section 5 example is applied after a backup…; no project moves" and "legacy storage: the example is applied as a new workspace…" |
| 2 | Repeat import: after moving READ-20 to #1 and adding a key, existing positions stay, the new key is offered at the end, nothing is removed | ✅ E2E | `runway-markdown-apply.spec.ts` "spec 2: … the whole earlier sequence stays a prefix and only the new key is appended" (also every *Already scheduled as* label says #1) |
| 3 | Reorder: dense 1..N after up, down, *Move to #N*, typed #, drag, remove, re-add, from the Runway view, All tasks or the detail panel; a randomized unit test | ✅ E2E + 🧪 | `runway-reorder.spec.ts` "a YouTrack Runway: up, down, Move to #N, typed #, drag and Remove keep it dense…"; `runway-number-cell.spec.ts` "YouTrack: the column shows each Runway #… the popover adds, moves and removes" (All tasks); `runway-detail.spec.ts` "YouTrack: add at #N, move, remove and add at end from the panel…" (re-add); 🧪 `runwayItemStore.test.ts` "randomized sequence" |
| 4 | Membership: READ-14 at #3 and #1 in two workspaces, each keeps its own position, project ownership unchanged | ⚠ Partial | 🧪 Unit only for the two positions: `runwayItemStore.test.ts` "one ticket holds different positions in two workspaces". No e2e puts one ticket on two workspaces' Runways. Projects unchanged by an import: `runway-markdown-apply.spec.ts` (section 5 tests) |
| 5 | Sorts: Runway # puts unnumbered last both ways; priority follows tracker order across the list; ID sort across the list | ⚠ Partial | `all-tasks-sort.spec.ts` "each sort in both directions orders All tasks as one flat list…" and "Tracker priority follows each project's configured bundle…" (YouTrack); `kanban-sort.spec.ts` "each sort orders the cards within each column by the All tasks sort, priority by each project's own scheme" (Jira). The `OPS-956` → `OPS-4089` ascending order (and its reverse) is 🧪 unit only: `runwaySort.test.ts` "compares the project prefix as text and the final number numerically" and "descending reverses each sequence" |
| 8 | Blockers: resolving SYNC-3 turns READ-14 Ready without reordering; PLAT-40 stays external on SYNC-7 | ✅ E2E | `runway-blockers.spec.ts` "blocked, external, resolved after Refresh with the order unchanged" |
| 9 | Order conflict: SYNC-3 below READ-14 is flagged; nothing moves without a click | ✅ E2E | `runway-blockers.spec.ts` "an order conflict is flagged, nothing moves until Move prerequisite above is clicked" |
| 10 | Desk unchanged: existing Desk specs pass unmodified; promoting never changes a position | ⚠ Partial | `runway-desk.spec.ts` "Desk cards and Choose next candidates show the Runway #; promoting and demoting never move it". "Unmodified" is a property of the diffs, not a test: the existing `priority-desk*.spec.ts` and `jira-priority-desk.spec.ts` pass in the full suite |
| 11 | Credentials: refused shows *Not readable*, 404 shows *Missing or not readable*, no other credential is used | ⚠ Partial | `runway-view.spec.ts` "a YouTrack Runway: stored order, ticket states…" (*Missing or not readable*). *Not readable* and "no other credential" are 🧪 unit only: `runwayTicketFetch.test.ts` "an unreadable ticket yields Not readable, and no other credential is resolved or used" |
| 12 | Restart: order, sections, notes and remembered sort identical after quit and relaunch | ✅ E2E | `runway-reorder.spec.ts` and `runway-view.spec.ts` (order, sections and notes across a relaunch); `all-tasks-sort.spec.ts` "each workspace remembers its own sort across a relaunch…" |
| 13 | Snapshot restore: an exported snapshot restores the order exactly, a version 1 snapshot is accepted, a backup is written first | ✅ E2E | `runway-snapshot-import.spec.ts` "previews, backs up, and restores every workspace" and "migrates a live v1 database, then imports a v1 snapshot with the cannot-tell warning" |
| 15 | Zero-project All tasks: five Runway tickets listed once each, sorted correctly by Runway #, tracker priority and ticket ID, both directions | ⚠ Partial | `runway-all-tasks.spec.ts` "YouTrack, no projects: … each once in All tasks" and "Jira, no projects or boards: the Runway tickets show once…" (listing). Sorting a zero-project workspace is not e2e-tested; the sort rules are 🧪 `runwaySort.test.ts` |
| 16 | Repeat import of an unchanged file adds nothing and changes no Runway # | ✅ E2E | `runway-markdown-apply.spec.ts` "spec 16: … Nothing new to add, Apply disabled, rows and backups unchanged" |
| 17 | Transfer warning: an older snapshot shows the exporting computer and the newer-local-changes warning; a version 1 snapshot shows *Version 1 — will be upgraded*, *Not recorded (version 1 snapshot)* and the cannot-tell warning | ✅ E2E | `runway-snapshot-import.spec.ts` "restores a populated v2 snapshot from another computer, warning first about newer local changes" and "migrates a live v1 database, then imports a v1 snapshot with the cannot-tell warning" |
| 18 | Repeated headings and notes: two `### Later` sections each with the same note import as two of each; a second import adds nothing | ✅ E2E | `runway-markdown-apply.spec.ts` "spec 18: two Later sections each holding the same note import as two of each, and a second import adds nothing" |

## workspace-runway.md — ConTower boundary (VERM-106, spec e2e 14)

| Criterion | Status | How |
| --- | --- | --- |
| Runway, sort and import actions start no agent, send no input to tmux and never invoke ConTower; a shell-command credential still reads tickets | ✅ E2E | `runway-process-boundary.spec.ts`: the e2e-only recorder (`main/e2eProcessRecorder.ts`) sees every process launch and every `openPath`/`openExternal`; only the configured credential command is allowed, matched by its SHA-256. No command text is recorded: a shell-string launch is labelled `shell`, a direct launch by its plain basename only. The recorder and its debug methods exist only in a package built with `VERMILIAN_E2E_BUILD=1`, which `pnpm test:e2e` always packages (`e2e/package-e2e-build.sh`); a release package contains neither, even when launched with `VERMILIAN_E2E=1` — checked by `release-recorder-isolation.spec.ts` through `pnpm test:release-isolation`. The fake YouTrack accepts ticket reads only with the token that command prints (`VERMILIAN_E2E_YT_REQUIRE_TOKEN`), so a fresh read in the observation window proves the command ran, the tracker accepted its token and the summary appeared. Each step waits for its action, then fails on any other launch. Only the credential resolver and the recorder may load `child_process` 🧪 `processBoundary.test.ts`, which also proves the recorder is inert outside e2e and records no command text |

Each handler and the step of `runway-process-boundary.spec.ts` that exercises it:

| Handler (IPC) | Step |
| --- | --- |
| `runwayItemsAddByReference` | 1. fresh ticket read (the Runway's Add box), and 2. `runwayItemsAddByReference` (a link) |
| `runwayItemsResolve` | 1. fresh ticket read, and 2. `runwayItemsResolve` |
| `runwayItemsList` | 2. `runwayItemsList` |
| `runwayItemsAddIssue` | 2. `runwayItemsAddIssue`, and 4b. `runwayItemsAddIssue (Jira, outside its projects)` |
| `runwayItemsAddIssueAtNumber` | 2. `runwayItemsAddIssueAtNumber` |
| `runwayItemsAddSection` | 2. `runwayItemsAddSection` |
| `runwayItemsAddNote` | 2. `runwayItemsAddNote` |
| `runwayItemsMove` | 2. `runwayItemsMove` |
| `runwayItemsMoveToNumber` | 2. `runwayItemsMoveToNumber` |
| `runwayItemsMoveUp` | 2. `runwayItemsMoveUp` |
| `runwayItemsMoveDown` | 2. `runwayItemsMoveDown` |
| `runwayItemsAddIssueAbove` — the blocker's **Add to Runway** | 2. `runwayItemsAddIssueAbove (Add to Runway)` |
| `runwayItemsMoveAbove` — **Move prerequisite above** | 2. `runwayItemsMoveAbove (Move prerequisite above)` |
| `runwayItemsRemove` | 2. `runwayItemsRemove` |
| `youtrackPriorityOrders` | 3. `youtrackPriorityOrders` (asserts READ's own order), and the All tasks Tracker priority sort |
| `jiraPriorityOrders` — a Runway card from outside the Jira workspace's projects | 4b. `jiraPriorityOrders, from the Jira All tasks board’s Tracker priority sort`, and `jiraPriorityOrders, called directly` (asserts PLAT's P1, P2, P3) |
| All tasks sort (Runway #, Tracker priority, Ticket ID, direction, clear; remembered locally) | 3. All tasks sort |
| `runwayMarkdownOpen`, `runwayImportMatch`, `runwayMarkdownApply` (new workspace) | 4. `runwayMarkdownOpen, runwayImportMatch, runwayMarkdownApply (new workspace)` |
| `runwayImportIdentify`, `runwayMarkdownApply` (repeat import into a Runway with rows) | 4. `runwayImportIdentify and runwayMarkdownApply (repeat import …)` |
| `runwayImportMatch`, `runwayImportIdentify` (called directly) | 4. `runwayImportMatch and runwayImportIdentify, called directly` |
| `runwayExportSnapshot` | 5. `runwayExportSnapshot` |
| `runwayImportPreview`, `runwayImportCancel` | 5. `runwayImportPreview and runwayImportCancel` |
| `runwayImportPreview`, `runwayImportConfirm` | 5. `runwayImportPreview and runwayImportConfirm` |

The `runway:get` / `runway:update` / `runway:list` handlers are the Jira Priority Desk's `runway_entry` (VERM-37), not the Workspace Runway, and are outside this criterion.

## create-task.md
| Section | Status | Where |
|---|---|---|
| Open form (New task button / modal / Esc dismiss) | ✅ E2E | `create-task.spec.ts` |
| Validation — Summary required (Create disabled) | ✅ E2E | `create-task.spec.ts` |
| Validation — URL format | ✅ E2E | `create-task.spec.ts` (bad Ticket link blocks Create) |
| Submission — happy-path create | ✅ E2E | `create-task.spec.ts` |
| Per-project Status/Priority/Category options and defaults; no assumed "To do"; blank omitted from POST (VERM-115) | ✅ E2E | `create-task-field-discovery.spec.ts`; derivation 🧪 `createFieldOptions.test.ts`, `formOptions.test.ts` |
| Project switch — choices kept or cleared and flagged; late answer for the previous project ignored | ✅ E2E | `create-task-field-discovery.spec.ts` |
| Field read failure keeps the draft and offers Retry | ✅ E2E | `create-task-field-discovery.spec.ts` |
| Main-process recheck — invalid value, absent field, other workspace: zero create requests | ✅ E2E | `create-task-field-discovery.spec.ts`; 🧪 `createTask.test.ts` |
| Ambiguous `({1})` refusal explained, Refresh project options | ✅ E2E | `create-task-field-discovery.spec.ts`; 🧪 `createFieldOptions.test.ts` |
| Inbox default category | 🧪 Unit | `formOptions.test.ts` (only when the project offers INBOX) |
| Date time entered auto-stamp, only for a compatible project field (VERM-115) | 🧪 Unit | `createTaskDateTimeEntered.test.ts` (client JSON body: date-and-time, date, absent, incompatible); `youtrack.test.ts` |
| Bound to the originating workspace — a switch during AI extraction cancels the matched-project read; no create (VERM-115) | ✅ E2E | `create-task-field-discovery.spec.ts` (per-workspace, two YouTrack references); 🧪 `createTask.test.ts` |

## create-task-ai.md
| Section | Status | Where |
|---|---|---|
| Entry point / gating (disabled without key) | ⬜ Gap (gating) | — (e2e always seeds a key) |
| Input → Generate → review → create (happy path) | ✅ E2E | `ai-create.spec.ts` (fake Claude) |
| Clarification path (too-vague input) | ✅ E2E | `ai-create.spec.ts` |
| Known project's values given to Claude; invalid suggestion cleared and flagged; identified project validated before review (VERM-115) | ✅ E2E | `create-task-field-discovery.spec.ts`; schema 🧪 `extractTool.test.ts` |
| Claude API call + JSON extraction | 🧪 Unit | `aiExtract.test.ts` (project match) |
| Error handling | 🚫 Out of harness | real-API failures |

## task-timer.md
| Section | Status | Where |
|---|---|---|
| Timer math (elapsed, total, format) | 🧪 Unit | `timer.test.ts` |
| Store state machine (start/pause/resume/advance/clear) | 🧪 Unit | `timer.test.ts` |
| Start (detail + row ▶) → focus overlay + countdown | ✅ E2E | `timer.spec.ts` |
| Pause / resume (PAUSED badge) | ✅ E2E | `timer.spec.ts` |
| Skip to break → break banner → skip break → back to work | ✅ E2E | `timer.spec.ts` |
| Stop & log (clears timer, "Logged N min" toast) | ✅ E2E | `timer.spec.ts` (fake worklog) |
| Auto phase completion on elapsed (time-based) | 🧪 Unit | `timer.test.ts` (driven by skip in e2e) |
| Worklog POST to YouTrack | 🚫 Out of harness | real worklog API |
| Quit protection / forced-exit recovery | 🚫 Out of harness | Electron lifecycle (exercised indirectly in afterEach) |
| Active-timer row badge | ✅ E2E | `timer.spec.ts` (▶ badge replaces play button) |

## standup-report.md
| Section | Status | Where |
|---|---|---|
| Task fetch + status bucketing/cutoff | 🧪 Unit | `youtrack.test.ts` (getIssuesForStandup) |
| Prompt assembly (sections, duration, omit-empty) | 🧪 Unit | `standupPrompt.test.ts` |
| Config → Generate → report render | ✅ E2E | `standup.spec.ts` (fake Claude) |
| Scope/window selectors, copy, save-to-file | 🚫 Out of harness | OS clipboard / file dialog |

---

## Remaining e2e-testable gaps (roadmap for the rest of 3.3)
Ordered by value. Each is reachable with the current fake harness (may need a `data-testid`).

1. ~~Quick-add task~~ — ✅ done (`quick-add.spec.ts`). (The spec's "Open full form ↗" link is not implemented yet, so it is not covered.)
2. ~~Inline chip-cell edit~~ — ✅ done (`inline-chip-edit.spec.ts`).
3. ~~Detail-panel inline field edit~~ — ✅ done (`detail-field-edit.spec.ts`).
4. ~~Create-task modal~~ — ✅ done (`create-task.spec.ts`). (URL-format validation still uncovered.)
5. ~~Group collapse/expand~~ — ✅ done (`board-toolbar-groups.spec.ts`).
6. ~~Toolbar presence~~ — ✅ done (`board-toolbar-groups.spec.ts`).
7. ~~Workspace folder rename / delete + rail collapse~~ — ✅ done (`workspace-folders.spec.ts`). (Folder move up/down still uncovered.)
8. ~~Settings view~~ — ✅ done (`settings.spec.ts`): open, sections, Cancel-to-board, discard guard. (Save→toast still uncovered — needs the E2E config-save path verified.)
9. ~~Board header project name + Inbox indicator~~ — ✅ done (`board-header.spec.ts`; added a "Team Inbox" fixture project).

**All roadmap gaps are filled**, and the previously-noted minor leftovers
(folder move up/down, settings Save persistence, create-task URL-format
validation, inline Due-Date picker, active-timer row badge) are now ✅ E2E.
The remaining ⬜ in the tables above (left-rail layout assertions, data-loading
Loader/Refresh/error banner, keyboard nav, column width input / colour editor /
views-tab / reset-board, Timer&Pomodoro inputs, Advanced reset, Inbox default
category, AI gating-without-key) are lower-value or out-of-harness — pick up
opportunistically.

The AI-create and stand-up happy paths now run against an in-memory **fake Claude**
(`src/main/api/fakeClaude.ts`, swapped in by `claudeClient.ts` under `VERMILIAN_E2E=1`),
so they are E2E-covered. The timer flow (start → pause/resume → skip to break → skip
break → stop & log) is E2E too — phase transitions are driven by the explicit Skip
controls, since the real durations are minutes long. Remaining out-of-harness criteria
(OS dialogs, keyring, the real worklog POST, real-API failures) are covered at the unit
level where the logic is pure, and otherwise belong to manual verification (`TESTING.md`)
until the fake harness grows fault-injection.
