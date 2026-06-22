# Feature: Task Timer (Pomodoro + Worklog)

## Description

The task timer is a single-task focus tool designed around ADHD work patterns: when a timer is running, the app enters a **focus mode** in which clicks outside the timer card are non-interactive. The timer runs in Pomodoro cycles by default (25-minute work blocks separated by 5-minute breaks, with a longer break after every four blocks), and every time the timer stops, the elapsed minutes are logged as a YouTrack work item on the timed task. Quit attempts while a timer is running are intercepted with a strong confirmation dialog; forced exits (crash, OS shutdown, force-kill) auto-log the partial duration on the next launch.

Only one task can be timed at a time, app-wide. Starting a timer on a new task while one is already running prompts the user to stop the current timer first.

## Acceptance criteria

### Starting a timer

- [ ] **Primary entry point**: a `▶ Start timer` button in the task-detail panel header (see `task-detail.md` updates), alongside Delete.
- [ ] **Secondary entry point**: a small `▶` play icon at the start of each task row on the project board (`project-board.md`), revealed on row hover. Clicking starts the timer for that task without opening the detail panel.
- [ ] Starting a timer:
  - Records `{ issueId, issueReadableId, summary, startedAt: <ISO timestamp>, mode: "pomodoro" | "open" }` in the Zustand timer store (per ADR-0002).
  - Checkpoints the same record to `app.getPath('userData')/timer-state.json` (atomic write) every 5 seconds while running.
  - Activates focus mode (see below).
- [ ] Default mode is `pomodoro`. An `Open timer` modifier (Shift-click or a `…` menu beside the start button) starts in `open` mode — runs indefinitely with no Pomodoro structure.
- [ ] If a timer is already running on a different task, the start action shows a Vibe `AlertDialog`: *"Stop the current timer on '<task>' first?"* with `Stop and start new` (commits worklog for current, starts new timer) and `Keep current running` (cancels the new start).

### Focus mode

- [ ] When a Pomodoro **work block** is active OR an `open` timer is running: the app enters focus mode.
- [ ] **Visual**: the rest of the app is overlaid with a Vibe-tokened dim layer (rgba black ~35% opacity). A centered **timer card** stays full-opacity above the overlay.
- [ ] **Interaction**: clicks anywhere outside the timer card are absorbed (`pointer-events: auto` on the overlay; the overlay swallows the click). Keyboard shortcuts that would navigate are also disabled while focus mode is active, with two exceptions:
  - `Esc` does not exit focus mode (deliberate — prevents accidental escape).
  - The OS-level window controls (minimize, close) still respond, but app-quit triggers the quit-protection dialog (see below).
- [ ] **Timer card content**:
  - Task summary (issue readable ID + summary, e.g., `KP-42 — Refactor API client`)
  - Elapsed time (mm:ss for `open`, mm:ss with a circular progress ring for `pomodoro`)
  - Current Pomodoro phase: `Work block 2 of 4` or `Long break in 12:34`
  - Buttons: `⏸ Pause`, `⏹ Stop & log` (commits worklog and exits focus), `Skip to break` (Pomodoro only — abandons the rest of the current work block, jumps to break)
- [ ] **During break** (Pomodoro 5-min break): focus mode **deactivates** — the dim overlay disappears, the app becomes interactive again, but a smaller persistent **break banner** at the top of the window shows the remaining break time and a `Skip break` button. The user can browse other tasks during the break.
- [ ] **Break-end transition**: when the break timer reaches zero, the OS notification fires (`Break complete — starting next 25-minute block on '<task>'`), the focus overlay re-engages, and the next work block begins automatically.

### Pomodoro mechanics

- [ ] Default durations (all configurable in Settings — see `settings.md`):
  - Work block: 25 minutes
  - Short break: 5 minutes
  - Long break: 15 minutes
  - Long break frequency: every 4 work blocks
- [ ] After each work block, the app:
  - Plays a soft notification sound (configurable to silent in Settings).
  - Fires an OS `Notification` (`Pomodoro complete — take a 5-minute break`).
  - Exits focus mode and shows the break banner.
  - Starts the break timer automatically.
- [ ] After every 4 work blocks (configurable count), the short break is replaced by a long break.
- [ ] Pomodoro cycles chain automatically — work → break → work → break — until the user clicks `⏹ Stop & log` on the timer card or break banner.

### Pause and resume

- [ ] `⏸ Pause` halts the current timer (work block or break). The elapsed time at pause is recorded.
- [ ] Resumed by `▶ Resume` button on the paused timer card. The elapsed time continues from where it stopped (not reset).
- [ ] A paused work-block timer keeps focus mode active (you can't browse tasks while paused — the intent is "I stepped away from the keyboard briefly").

### Worklog on Stop

- [ ] `⏹ Stop & log` (or the equivalent action from any quit/end path) commits a YouTrack work item via `POST /api/issues/{issueId}/timeTracking/workItems` with:
  - `duration`: the total accumulated work-block time in minutes (excludes break time, excludes paused time)
  - `date`: today's date in YouTrack's expected format
  - `type`: default `Development` (configurable in Settings via a dropdown of YouTrack-defined work-item types fetched on first save)
  - `text`: empty in MVP (could surface as a worklog-comment input in a future minor version)
- [ ] On success: a Vibe `Toast` (positive): *"Logged 25 min to '<task>'."*; focus mode exits; the timer state is cleared from disk.
- [ ] On API failure: the timer card transitions to a "save failed" state showing the elapsed minutes and `Retry` / `Discard` actions. The minutes are **not lost** until the user explicitly chooses `Discard`. If the user closes the app while in this state, the unsaved duration persists to the checkpoint file and is offered on the next launch.

### Quit protection

- [ ] While a timer is running (work block, break, or paused), the following intercepts run via Electron's `before-quit` and the main window's `close` event:
  - User clicks the window close button (X) → intercepted.
  - User presses `Cmd+Q` (macOS) / `Ctrl+Q` (Linux/Windows) or selects File → Quit → intercepted.
  - User selects Vermilian → Quit Vermilian from the OS menu → intercepted.
- [ ] On intercept, a Vibe `AlertDialog` appears in the foreground: *"Timer running on '<task>' — N minutes elapsed. Stop the timer before quitting?"* with:
  - **Keep working** (default — cancels the quit, returns to the app, timer continues unchanged).
  - **Stop timer & quit** (commits the worklog, then proceeds with the quit. If the worklog write fails, the app remains open and surfaces the same Retry/Discard UX as a normal Stop failure — the quit is aborted.).
- [ ] No third "force quit without logging" option is exposed — if the user truly needs to force-quit, the OS kill path triggers the next-launch recovery flow below.

### Forced-exit recovery

- [ ] The timer state is checkpointed to `app.getPath('userData')/timer-state.json` every 5 seconds while a timer is active.
- [ ] On the next app launch, the main process reads `timer-state.json`. If present:
  - The accumulated work-block minutes are auto-logged via `POST /api/issues/{issueId}/timeTracking/workItems` (same call as a normal Stop).
  - The `timer-state.json` file is deleted on success.
  - A Vibe `Toast` (info) appears once the app is visible: *"Logged N min for '<task>' from your previous session."*
- [ ] If the auto-log API call fails on launch (e.g., YouTrack unreachable), the toast switches to a danger Banner with a `Retry` button. The state file is not deleted until a successful write.

### Board / detail-panel indicators

- [ ] On the project board, the actively-timed task's row shows a small `▶ 12:34` badge next to the Summary cell, live-updated.
- [ ] In the task-detail panel header, if this task is the active timer's task, the `▶ Start timer` button is replaced with `⏹ Stop timer (12:34)`.
- [ ] In stand-up reports (`standup-report.md`), the Claude prompt receives total time logged today per task — this is a knock-on benefit of writing real worklogs and is documented there.

### Concurrency

- [ ] Exactly one timer can be running app-wide at any moment. The Zustand timer store enforces a single-active invariant.
- [ ] Per-workspace concurrent timers are **not** supported in MVP.

## Wireframe

See: `docs/design/screen-timer-focus.d2`, `docs/design/screen-timer-break-banner.d2`, `docs/design/flow-timer-quit-dialog.mmd` (to be drawn)

## Open questions

- [ ] Should the user be able to **edit** the logged duration on Stop (e.g., subtract 7 min of distraction)? MVP says no; deferred.
- [ ] Should the worklog `text` field carry an auto-generated note (`Pomodoro session: 3 work blocks completed`) so YouTrack worklog reports are richer? Defer.
- [ ] Should opening the task-detail panel for the actively-timed task during a break be allowed (it already is, since the app is interactive during break) — or should we keep the user away from the in-progress task during break for a true mental rest? MVP allows it.
- [ ] Long-break frequency configurable count (4) is exposed in Settings — confirm the editing UX (numeric input range 2–10?).
