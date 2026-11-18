# Vermilian AI help desk

Look up how to perform a Vermilian function here before reading source code. Written for AI
agents answering "how do I…?" questions. Facts are for **v1.5.0** and were checked against the
code. Paths are relative to `app/src/` unless they start with `app/` or `docs/`, and `tid` means
`data-testid`.

## How to use this file

1. **Find out which backend the user's workspace uses.** Most answers differ. A Jira workspace
   shows a **Jira · read-only** badge on its board, and the top bar shows the Jira site.
2. Find the task in the index below and follow its entry.
3. Check [Common misreadings](#common-misreadings) before concluding that something is missing
   or broken.
4. Use the UI labels exactly as written here.

## Task index

| The user asks… | Backend | Go to |
| --- | --- | --- |
| Put a ticket on the Priority Desk, star, focus, rank, Now / Next / Then | Both | [Rank an issue](#rank-an-issue-on-the-priority-desk) |
| Why a ticket is not on the desk, or the desk is empty | Both | [Rank an issue](#rank-an-issue-on-the-priority-desk) |
| Add a reason, Why now | Both | [Why now](#add-a-why-now-reason) |
| A rank is already taken, duplicate rank, repair banner | Both | [Rank conflicts](#rank-conflicts-and-repair) |
| Choose next, candidates, Not this week | YouTrack | [Choose next](#choose-next-and-not-this-week) |
| AI recommendation for the desk | YouTrack | [AI recommendation](#ai-recommendation) |
| Create a Jira workspace, connect Jira | Jira | [Create a Jira workspace](#create-a-jira-workspace) |
| Choose Jira projects or boards | Jira | [Choose projects and boards](#choose-jira-projects-and-boards) |
| Hide status columns, show Done tickets | Jira | [Jira board controls](#jira-board-controls) |
| Filter by assignee, only my tickets | Both | [Filter by assignee](#filter-by-assignee) |
| Search for a ticket | Both | [Search](#search) |
| Open a Jira ticket's details | Jira | [Jira detail panel](#jira-detail-panel) |
| See my open Jira tickets across all projects | Jira | [Jira list](#jira-list) |
| Jira token scopes, Reconnect Jira, Unauthorized | Jira | [Jira connection problems](#jira-connection-problems) |
| Create a task, AI create | YouTrack | [Create a task](#create-a-task) |
| Edit, delete, move, drag a task, resize columns | YouTrack | [Work with tasks](#work-with-tasks-on-a-board) |
| Timer, Pomodoro, log work, breaks | YouTrack | [Timer and work logging](#timer-and-work-logging) |
| Stand-up report | YouTrack | [Stand-up](#stand-up) |
| Daily Review | YouTrack | [Daily Review](#daily-review) |
| Create, switch, rename, reorder, delete a workspace, folders | Both | [Workspaces](#workspaces) |
| Per-workspace storage | Both | [Workspace storage](#activate-per-workspace-storage) |
| Master plan | YouTrack | [Master plan](#set-a-master-plan) |
| Token, credentials, Test connection, revoked token | Both | [Settings and credentials](#settings-and-credentials) |
| Theme, reset settings, config folder | Both | [Other settings](#other-settings) |
| Back up or restore Jira ranks, Runway snapshot | Jira | [Runway snapshots](#runway-snapshots) |

## Common misreadings

| What you see | What it does **not** mean | What to do |
| --- | --- | --- |
| The rail's **PROJECTS** section is empty in a Jira workspace | That no Jira projects are chosen. The rail never lists Jira projects or boards | Open **All tasks** and read the "Jira projects: …" and "Jira boards: …" lines under the board title |
| The desk says "No Jira issues are ranked yet." | That the workspace has no issues | Star and rank an issue on **All tasks** |
| A starred issue is not on the desk | That the star failed. The desk shows ranked issues only | Give it rank 1, 2 or 3 |
| A desk card says "Not among this workspace's open Jira issues." | That the rank was lost. The issue is Done, deleted, or outside the chosen projects and boards | Clear the rank on the card if it is no longer wanted |
| The board picker shows "Unauthorized; scope does not match" | That projects are broken. The text is Jira's own error for listing boards | See [Jira connection problems](#jira-connection-problems) |
| **Test connection** passes but the app still fails | That the saved credential works. A pasted token is tested even when Source 1 or 2 overrides it | See [Settings and credentials](#settings-and-credentials) |

## Priority Desk

Open it with **Priority Desk** at the top of the left rail (tid `nav-priority-desk`). Return to the
board with **All tasks** (tid `nav-all-tasks`).

| | YouTrack workspace | Jira workspace |
| --- | --- | --- |
| Slots | Now, Next, Then | Now, Next, Then |
| Where ranks are stored | YouTrack fields Focus, Focus rank, Why now | Local database on this computer. Jira is never changed |
| Where to star | Board rows, Kanban cards, task detail, desk cards | Board cards, detail panel, desk cards |
| Now card action | **Start focus** | **Open** |
| Choose next, AI recommendation, Not this week | Yes | No |
| A finished issue | Leaves the desk and frees its rank | Keeps its rank until cleared |

Source: `renderer/features/priority-desk/PriorityDesk.tsx`,
`renderer/features/jira-board/JiraPriorityDesk.tsx`.

### Rank an issue on the Priority Desk

**Precondition (Jira):** the issue is open and in a chosen project or board.

1. Open **All tasks**. To find the issue, type its key in the search box above the board.
2. Click the ☆ on the issue. A rank badge showing `–` appears beside it.
3. Click the `–` badge and choose **1**, **2** or **3**.
4. Open **Priority Desk**. Rank 1 is **Now**, 2 is **Next** and 3 is **Then**.

**Limits:**

- An issue needs both a star and a rank to appear in a slot.
- Each slot holds one issue. Empty slots read "Empty is fine".
- **Clear rank** in the badge menu removes the rank and keeps the star.
- Removing the star also clears the rank, and keeps Why now.

**Proof:** tids `jira-focus-star-{key}`, `jira-focus-rank-badge-{key}`,
`jira-focus-rank-option-{key}-{n}`, `jira-focus-rank-clear-{key}`. YouTrack uses the same names
without the `jira-` prefix. Spec: `app/e2e/jira-priority-desk.spec.ts`.

### Add a Why now reason

- **Jira:** click the card to open its detail panel. In the **Priority Desk** section, fill in
  **Why now** and click **Save** (tids `jira-why-now-input`, `jira-why-now-save`).
- **YouTrack:** open the task detail panel and edit the **Why now** field.

The reason appears on the issue's desk card.

### Rank conflicts and repair

Choosing a rank another issue holds opens **Focus rank N is already taken**:

- **Keep {id}** changes nothing.
- **Move rank here** gives the rank to the new issue. The old holder stays starred with no rank.

**YouTrack only:** two issues can end up sharing a rank. The banner **Focus rank N is held by M
issues** then offers **Keep {id} at rank N** (tid `focus-rank-repair-keep-{id}`). Jira cannot have
duplicate ranks.

### Choose next and Not this week

**YouTrack only.** On the desk, switch to **Choose next**. The number on the button is how many
candidates are shown.

- It shows at most 7 candidates, ordered by due date, priority, then ID.
- It excludes Epics, Done issues, ranked issues and issues dismissed this week.
- Filter with the Status pills and, when Epics exist, the epic pills.
- **Not this week** (tid `priority-desk-candidate-dismiss-{id}`) hides a candidate until the end of
  the local Monday-based week. There is no undo control.

### AI recommendation

**YouTrack only**, in **Choose next**. It needs a loaded master plan with outcomes, at least one
candidate and an AI credential.

1. Select an outcome pill (tid `priority-desk-outcome-pill`).
2. Click **Ask for recommendation** (tid `priority-desk-ask-recommendation`).
3. Choose **Apply to desk**, **Star only** or **Keep my order**.

**Limits:** only the top three are written. **Apply to desk** is refused entirely if a target rank is
held by another issue. All three choices post an audit comment on the top-ranked issue.

## Jira workspaces

### Create a Jira workspace

**Precondition:** per-workspace storage is active. Until then the **Jira** choice is disabled. See
[Activate per-workspace storage](#activate-per-workspace-storage).

1. Open the workspace switcher in the left rail (tid `workspace-switcher`).
2. Click **+ New workspace**.
3. Enter a name and choose **Jira**.
4. Fill in the site URL and Atlassian account email. The credential reference starts as `jira-1`.
5. Click **Create**. The board reads "No Jira projects or boards chosen yet."

The `jira-1` reference uses the token in **Settings → Jira**.

### Choose Jira projects and boards

1. Click **Choose projects and boards…** in the board header, or **+ Choose Jira projects or
   boards** in the rail.
2. Tick the projects and boards.
3. Click **Save**.

A board shows whatever its own Jira filter selects, from any project. If boards cannot be listed,
projects can still be saved and the chosen boards are kept.

**Confirm the choice** on **All tasks**, under the board title. Do not use the rail for this.

### Jira board controls

| Control | What it does | Saved? |
| --- | --- | --- |
| **Columns…** | Untick statuses and click **Save** to hide those columns. A line under the board names hidden columns with their counts | Yes, with the workspace |
| **Show done** | Adds Done issues to the board. The desk still reads open issues only | No |
| Search box | See [Search](#search) | No |
| **Assignee** pills | See [Filter by assignee](#filter-by-assignee) | No |

**Limit:** **Columns…** lists only statuses that loaded issues are in, plus statuses already hidden.

Issues refresh every 60 seconds while the window is visible.

### Jira detail panel

Click a Jira card to open it. It shows Status, Priority, Due date, Epic if any, the **Priority Desk**
section, Description and Comments. Close it with the X or **Esc**.

**Vermilian never writes to Jira.** Cards cannot be dragged, and there are no edit, delete or timer
controls. Only star, rank and Why now can be changed, and they stay on this computer.

### Jira list

The top-bar **Jira** button (tid `jira-list-btn`) opens **Jira — open issues assigned to me**. It is
not limited to the workspace's chosen projects. Clicking a key opens the issue in Jira.

Under per-workspace storage it needs an active Jira workspace. In a YouTrack workspace it reports
"The active workspace is not a Jira workspace."

### Jira connection problems

**Token scopes.** Classic and scoped API tokens both work. A scoped token needs:

| Scope | Needed for |
| --- | --- |
| `read:jira-work` | Issues, comments and project lists |
| `read:board-scope:jira-software` | Listing Jira boards and reading their issues |

**"Unauthorized; scope does not match" in the board picker.** Vermilian displays Jira's own error
here. The likely fix is to add `read:board-scope:jira-software` to the token. Projects keep working
in the meantime.

**Reconnect Jira** replaces the board or desk after a 401 or an unresolved credential. Click **Try
again**. For `jira-1`, replace the token in **Settings → Jira**. Other workspaces are unaffected.

**Test connection** in **Settings → Jira** tests that profile's token, not a workspace's custom
credential reference.

## Boards

### Filter by assignee

The **Assignee** section has pills for **Me**, **Unassigned** and each other assignee on a loaded
issue. Selected pills combine with OR, and with AND against other filters.

- **YouTrack All tasks:** the **Assigned to me** button toggles the same **Me** filter. **Me** needs
  **YouTrack username** in Settings.
- **YouTrack project board:** click **Filter** to open the pills.
- **Jira:** **Me** appears once the account is known.

Filters are not saved between sessions.

### Search

| Search | Where | Behaviour |
| --- | --- | --- |
| Above the board (tid `board-search-input`) | **All tasks** and Jira boards | Typing filters loaded cards by key or summary. **Enter**, or 2+ characters matching nothing loaded, searches the backend, Done included. **/** focuses it and **Esc** clears it |
| Top bar (tid `issue-search-input`) | Every view | 2+ characters. Covers the active project, otherwise the workspace. Jira workspaces search Jira only |
| **Search** on a project board (tid `search-btn`) | Project boards | Loaded issues only |

### Create a task

**YouTrack only.**

- **New task** (key **N**): fill in **Summary** and **Project**, then click **Create**.
- **+ Add task** in a group: quick add on project boards.
- **AI create** (key **A**, with a project open): describe the task, click **Generate**, review, then
  click **Create**. It needs an AI credential.

### Work with tasks on a board

**YouTrack only.**

- **Open details:** click a row or card. On **Main table**, clicking the summary text edits it inline.
- **Edit:** fields save on blur, Enter or selection. Assignee is not editable in the detail panel.
- **Delete:** trash icon, then **Delete**. This cannot be undone.
- **Move between columns:** on a project board, drag a card on **Kanban**, or the ⠿ handle on
  **Main table**. **All tasks** has no drag.
- **Move to another project:** drop the task on a project in the rail, then confirm **Move**.
- **Resize a column:** on **Main table**, drag the right edge of the header. **Summary** cannot be
  resized.

### Timer and work logging

**YouTrack only.** Jira boards have no timer.

1. Click the play icon on a row (title **Start timer**), or **Start timer** in the detail panel.
2. A full-screen overlay runs the work block. Use **Pause**, **Skip to break** or **Stop & log**.
3. Work and breaks alternate automatically. The defaults are 25 and 5 minutes, with a 15-minute long
   break every 4 blocks.

**Logging work:** stopping the timer is the only way to log work. Minutes round to the nearest
minute, with a minimum of 1. Break time is not logged.

- **Timer already running:** choose **Keep current running** or **Stop and start new**.
- **Quitting with a timer running:** choose **Keep working** or **Stop timer & quit**.
- **After a crash:** 60 seconds or more of work is logged at the next launch. The timer does not
  resume.

### Stand-up

**YouTrack only**, and it needs an AI credential. On a Jira workspace the button is disabled.

1. Click **Stand-up** in the top bar (key **S**).
2. Choose **24h**, **48h**, **7d** or **Custom** (1 to 720 hours).
3. Click **Generate**.
4. Use **Copy to clipboard** or **Save to daily notes**. Saving needs a folder set in Settings.

### Daily Review

Click **Daily Review** in the top bar. It is a fixed list with no AI: Now / Next / Then, blocked
focused work, items needing attention, and work completed in the last 48 hours. It reads YouTrack
data. Its contents in a Jira workspace have not been verified.

## Workspaces

Everything starts at the workspace switcher in the left rail (tid `workspace-switcher`).

| Task | Steps |
| --- | --- |
| Create | **+ New workspace**, enter a name, choose **YouTrack** or **Jira**, click **Create** |
| Switch | Pick the workspace. The choice applies to this computer only. A running timer asks **Cancel** or **Stop timer** first |
| Rename or reorder | **Manage workspaces…**, click a name to rename, use ↑ and ↓ to reorder, click **Done** |
| Delete | **Manage workspaces…**, **Delete**, choose where its projects go, type its exact name, click **Delete workspace**. Refused under per-workspace storage |
| Add a folder | **+ Add folder** in the rail |
| Change a folder | Right-click it: **Rename**, **Move up**, **Move down**, **Delete folder** (empty folders only) |
| Move a project | Right-click it: **Move to folder** or **Move to workspace** |

### Activate per-workspace storage

1. Open **Settings → Workspace storage**.
2. Click **Preview migration**.
3. Click **Activate per-workspace storage…**, enabled only after a clean preview.
4. Confirm with **Activate**.

On another computer, use **Use per-workspace storage on this computer…**. To undo, use **Return to
the shared configuration…**, which is refused if anything changed since activation.

**Warning:** computers still on shared storage stop saving configuration until they join.

### Set a master plan

**YouTrack workspaces under per-workspace storage only.** Open **Manage workspaces…**, click
**Master plan…**, enter an article ID such as `VERM-A-12`, and click **Save**. Titles and URLs are
rejected. **Set to None** removes it.

## Settings and credentials

Open Settings with the top-bar gear (tid `topbar-settings-btn`). It works even when the connection
is broken. Click **Save** to keep changes. Theme applies immediately.

### Credential sources

| Priority | Source | Behaviour |
| --- | --- | --- |
| 1 | **Source 1: Shell command** | Output is used as the token |
| 2 | **Source 2: File path** | File content is used as the token |
| 3 | **Source 3: Paste token (saved to OS keyring)** | Used only when Sources 1 and 2 are blank |

**The highest configured source is the only one used.** A failing source stops resolution and does
not fall through to the next one, although the on-screen text says "blank or fails". To use a pasted
token, blank Sources 1 and 2.

**Test connection** tests a pasted token if one is in the field, even when a higher source overrides
it. It does not save.

**Credentials not saved** means the keychain cannot encrypt on this computer. Use a shell command or
file instead.

### Recover from a revoked token

1. The banner **Cannot load projects from YouTrack** appears with **Open Settings** and **Retry**.
2. Open Settings with the top-bar gear.
3. Fix the token at whichever source is configured.
4. Click **Test connection**, then **Save**.
5. Click **Retry** if the banner remains.

### Other settings

- **Theme:** **Appearance**, then **Light**, **Dark** or **System**.
- **Advanced:** **Reset to defaults** keeps credentials. Also **Open config folder** and **Force
  resync from server**.

## Runway snapshots

Runway holds Jira Focus, rank, Why now and dismissals for all workspaces on this computer. YouTrack
data is not included. Both actions are in **Settings → Advanced**.

**Export:** click **Export Runway snapshot…** and choose a new file. It never overwrites a file.
FAT, exFAT and some network folders are refused.

**Import:**

1. Click **Import Runway snapshot…** and pick a file.
2. Click **Preview import**.
3. In **Replace all Runway metadata?**, click **Replace Runway data**.

Import replaces everything, and records absent from the snapshot are removed. Current data is backed
up first to `runway-backups/`. To undo, import the backup named in the toast.

See `RUNBOOK.md` for operational detail.

## Known behaviour to warn users about

These are current behaviours that can surprise a user.

| Behaviour | Source |
| --- | --- |
| **Stop and start new** replaces the timer even if logging the old timer's work failed, so that time can be lost | `renderer/AppShell.tsx` |
| The app quits on **Stop timer & quit** even if logging fails | `renderer/AppShell.tsx` |
| The **OS notifications** checkbox is saved, but the notification code never reads it | `renderer/features/timer/FocusOverlay.tsx`, `renderer/features/timer/BreakBanner.tsx` |
| **Delete** is offered for a workspace under per-workspace storage, but the save is refused | `shared/workspaceLayout.ts`, `renderer/features/workspace-nav/ManageWorkspacesModal.tsx` |

## Keeping this file current

Update this file in the same change as any user-facing behaviour change, and update the version at
the top on each release. Copy UI labels from the code. Mark anything not confirmed as unverified
instead of guessing.
