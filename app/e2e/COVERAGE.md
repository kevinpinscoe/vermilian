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
| Folder management — move up/down | ⬜ Gap | — |
| Project assignment (drag between folders / across workspaces) | ✋ Manual | dnd-kit drag; `TESTING.md` |
| Empty-state / onboarding banner | ✅ E2E | `workspace-nav.spec.ts` (fresh-install banner) |

## project-board.md
| Section | Status | Where |
|---|---|---|
| Board entry, header project name, view tabs | ✅ E2E | `board-header.spec.ts` (name), `board-interactions.spec.ts` (kanban tab) |
| Toolbar buttons present; New task opens modal | ✅ E2E | `board-toolbar-groups.spec.ts`, `create-task.spec.ts` |
| Group by (regroup + options) | ✅ E2E | `board-interactions.spec.ts` (regroup) |
| Main table — group headers, count badge | ✅ E2E | implied by `group-header` assertions |
| Main table — group collapse/expand chevron | ✅ E2E | `board-toolbar-groups.spec.ts` |
| Column reorder / resize / hide | ✅ E2E | `dnd.spec.ts` (reorder, resize, show/hide) |
| Column-header click sort + arrow | ✅ E2E | `dnd.spec.ts` (sort after reorder), `board-filter-sort.spec.ts` |
| Click row opens detail | ✅ E2E | `board-interactions.spec.ts`, `detail-panel.spec.ts` |
| Inline edit — summary text cell | ✅ E2E | `board-interactions.spec.ts` |
| Inline edit — chip cells (Status/Priority/Category) | ✅ E2E | `inline-chip-edit.spec.ts` |
| Inline edit — Due Date picker | ⬜ Gap | — |
| Quick-add `+ Add task` (Enter creates, Esc cancels) | ✅ E2E | `quick-add.spec.ts` |
| Kanban view render + columns | ✅ E2E | `board-interactions.spec.ts` |
| Kanban drag between columns | ✋ Manual | `TESTING.md` |
| DnD between groups | ✅ E2E | `dnd.spec.ts` (between-group) |
| DnD reorder within group | ✋ Manual | `dnd.spec.ts` fixmes + `TESTING.md` |
| DnD cross-board (highlight, confirm, cancel, same-project no-op) | ✅ E2E | `dnd.spec.ts` (cross-board) |
| Filtering (bar, pills, search, clear, empty state) | ✅ E2E | `board-filter-sort.spec.ts` |
| Due Date range filter | ⬜ Gap (also unbuilt) | — |
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
| Timer & Pomodoro inputs | ⬜ Gap | — |
| Daily notes folder (Browse picker) | 🚫 Out of harness | OS dialog |
| Appearance — theme switch | ✅ E2E | `theme.spec.ts` (dark toggle) |
| Advanced — reset to defaults / open config folder | ⬜ Gap / 🚫 (open folder) | — |
| Cancel returns to board + discard-unsaved-credentials guard | ✅ E2E | `settings.spec.ts` |
| Save writes config + "Settings saved" toast | ⬜ Gap | — |
| Credential storage (safeStorage, fail-closed) | 🚫 Out of harness | keyring |
| Friendly error messages | 🧪 Unit | `errors.test.ts` |

## create-task.md
| Section | Status | Where |
|---|---|---|
| Open form (New task button / modal / Esc dismiss) | ✅ E2E | `create-task.spec.ts` |
| Validation — Summary required (Create disabled) | ✅ E2E | `create-task.spec.ts` |
| Validation — URL format | ⬜ Gap | — |
| Submission — happy-path create | ✅ E2E | `create-task.spec.ts` |
| Project context / Inbox default category | ⬜ Gap | — |
| Date time entered auto-stamp | 🧪 Unit | `youtrack.test.ts` (createIssue stamps it) |

## create-task-ai.md
| Section | Status | Where |
|---|---|---|
| Entry point / gating (disabled without key) | ⬜ Gap (gating) | — |
| Input dialog / Generate | 🚫 Out of harness | Claude call |
| Claude API call + JSON extraction | 🧪 Unit | `aiExtract.test.ts` (project match) |
| Review/edit form | 🚫 Out of harness | downstream of Claude |
| Error handling | 🚫 Out of harness | — |

## task-timer.md
| Section | Status | Where |
|---|---|---|
| Timer math (elapsed, total, format) | 🧪 Unit | `timer.test.ts` |
| Store state machine (start/pause/resume/advance/clear) | 🧪 Unit | `timer.test.ts` |
| Focus mode / break banner / Pomodoro chaining | 🚫 Out of harness | timers + overlay |
| Worklog on stop | 🚫 Out of harness | YouTrack worklog |
| Quit protection / forced-exit recovery | 🚫 Out of harness | Electron lifecycle |
| Board / detail timer indicators | ⬜ Gap | — |

## standup-report.md
| Section | Status | Where |
|---|---|---|
| Task fetch + status bucketing/cutoff | 🧪 Unit | `youtrack.test.ts` (getIssuesForStandup) |
| Prompt assembly (sections, duration, omit-empty) | 🧪 Unit | `standupPrompt.test.ts` |
| Entry/gating, scope/window, panel render, copy, save | 🚫 Out of harness | Claude + OS clipboard/file |

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

**All roadmap gaps are filled.** Smaller leftovers remain as ⬜ in the tables
above (folder move up/down, settings Save→toast, create-task URL-format
validation, Due-Date range filter) — minor, pick up opportunistically.

Out-of-harness criteria (Claude, OS dialogs, keyring, timer worklog, real API failures)
are covered at the unit level where the logic is pure, and otherwise belong to manual
verification (`TESTING.md`) until the fake harness grows fault-injection / Claude stubs.
