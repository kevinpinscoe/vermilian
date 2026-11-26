# Vermilian AI help desk

Look up how to perform a Vermilian function here before reading source code. Written for AI
agents answering "how do I…?" questions. Facts are for **v1.5.0** and were checked against the
code, except [OpenBao credential storage](#store-credentials-in-openbao), which is merged but not
yet in a release. [Workspace Runways](#workspace-runways) is *available on main for the upcoming
release; not in v1.6.0*; its entries were checked against `main`. Paths are relative to `app/src/` unless they start with `app/` or `docs/`, and
`tid` means `data-testid`.

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
| Filter by status, hide status columns, show Done tickets | Jira | [Jira board controls](#jira-board-controls) |
| Filter by assignee | Both | [Filter by assignee](#filter-by-assignee) |
| Show only my tickets by default, Default assignee | Both | [Default assignee](#set-a-default-assignee) |
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
| OpenBao, move credentials to OpenBao, keychain lockout after an upgrade | Both | [Store credentials in OpenBao](#store-credentials-in-openbao) |
| Theme, reset settings, config folder | Both | [Other settings](#other-settings) |
| Put a ticket on a workspace's Runway, Runway #, my ordered list | Both | [Add tickets to a Runway](#add-tickets-to-a-runway) |
| Move, renumber, drag or remove a Runway ticket | Both | [Reorder a Runway](#reorder-a-runway) |
| Section headings and notes on a Runway | Both | [Sections and notes](#sections-and-notes) |
| Sort All tasks by Runway #, priority or ticket ID | Both | [Sort All tasks](#sort-all-tasks) |
| Blocked, Ready, Unknown, Add to Runway, Order conflict, Move prerequisite above | Both | [Blockers and order conflicts](#blockers-and-order-conflicts) |
| Which link types count as prerequisites | Both | [Choose prerequisite link types](#choose-prerequisite-link-types) |
| Runway # on a Desk card, Now / Next / Then on a Runway row | Both | [Runway # and Desk slot](#runway--and-desk-slot) |
| Import a schedule or plan from Markdown | Both | [Import a schedule from Markdown](#import-a-schedule-from-markdown) |
| Import the same file again, add new tickets to a Runway that has rows | Both | [Import again](#import-again-into-a-runway-that-has-rows) |
| Not readable, Missing or not readable, on a Runway ticket | Both | [Runway ticket states](#runway-ticket-states) |
| Back up or restore Runways, Jira ranks, Runway snapshot | Both | [Runway snapshots](#runway-snapshots) |

## Common misreadings

| What you see | What it does **not** mean | What to do |
| --- | --- | --- |
| The rail's **PROJECTS** section is empty in a Jira workspace | That no Jira projects are chosen. The rail never lists Jira projects or boards | Open **All tasks** and read the "Jira projects: …" and "Jira boards: …" lines under the board title |
| The desk says "No Jira issues are ranked yet." | That the workspace has no issues | Star and rank an issue on **All tasks** |
| A starred issue is not on the desk | That the star failed. The desk shows ranked issues only | Give it rank 1, 2 or 3 |
| A desk card says "Not among this workspace's open Jira issues." | That the rank was lost. The issue is Done, deleted, or outside the chosen projects and boards | Clear the rank on the card if it is no longer wanted |
| The board picker shows "Unauthorized; scope does not match" | That projects are broken. The text is Jira's own error for listing boards | See [Jira connection problems](#jira-connection-problems) |
| **Test connection** passes but the app still fails | That the saved credential works. A pasted token is tested even when OpenBao or Source 1 or 2 overrides it | See [Settings and credentials](#settings-and-credentials) |
| An OpenBao error appears although a token is still saved locally | That the local copy can be used. A credential using OpenBao reads nothing else | Restore OpenBao, or choose **Stop using OpenBao**. See [Store credentials in OpenBao](#store-credentials-in-openbao) |
| A ticket is **Runway #1** but not on the Desk's **Now** card | That the Runway and the Desk disagree. Runway # and Desk slot are separate | See [Runway # and Desk slot](#runway--and-desk-slot) |
| A ticket on the Runway is not on the workspace's board | That the add failed. A Runway ticket never adds its project to the workspace | Find it in the **Runway** view, or in **All tasks**, which lists Runway tickets too |
| A repeat import shows **Nothing new to add** and **Apply** is disabled | That the import is broken. Every ticket, section and note is already on that Runway | Nothing to do; edit the file or the Runway first |
| Tickets are listed under **Not in this file** | That they will be removed. An import never removes or moves a Runway row | Remove them by hand in the Runway view if they are no longer wanted |
| A Runway row shows **Missing or not readable** | That the ticket is gone, or that another credential could read it. Only the workspace's own connection is used | See [Runway ticket states](#runway-ticket-states) |

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
| **Status** pills | Click a status to hide or show its column. Lists every status in the chosen projects, including ones with no issues. **In Progress** is always shown and cannot be turned off. A line under the board names hidden columns with their counts | Yes, with the workspace |
| **Columns…** | The same choice as the **Status** pills, as a checklist with **Save** | Yes, with the workspace |
| **Show done** | Adds Done issues to the board. The desk still reads open issues only | No |
| Search box | See [Search](#search) | No |
| **Assignee** pills | See [Filter by assignee](#filter-by-assignee) | No |

**Limit:** statuses on boards chosen without a project are known only from loaded issues. The board says
so when the Status list may be incomplete, as it does when the token cannot read statuses.

Issues refresh every 60 seconds while the window is visible.

### Jira cards

Each card on a Jira **All tasks** board shows its ticket ID in green, with the summary, priority, due date
and epic below it.

### Jira detail panel

Click a Jira card to open it. It shows Status, Priority, Due date, Epic if any, the **Priority Desk**
section, Description and Comments. Close it with the X or **Esc**.

To open the issue in Jira, click its key at the top of the panel, such as `SRE-4446`. It opens in the
default browser and the panel stays open.

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

### Set a Default assignee

**Both backends.** With a Default assignee set, **All tasks** opens showing only that person's issues.

1. Switch to the workspace, then open Settings with the top-bar gear.
2. Under **Default assignee**, click **Use my account**, or enter a YouTrack login or Jira account ID.
3. Click **Save**.

- **Show all assignees** on the board shows everyone until the next launch or workspace switch.
  **Show only my issues** returns to the default.
- The setting is per workspace and stays on this computer. **Clear** removes it.
- Search still finds other people's issues.
- If no loaded issue carries the saved identity, the board shows everyone and says so.
- The Priority Desk, Stand-up, Daily Review and project boards are not affected.

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

- **Timer already running:** choose **Keep current running** or **Stop and start new**. If the
  time cannot be logged, the current timer keeps running and the new one does not start.
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
| Delete | **Manage workspaces…**, **Delete**, choose where its projects go, type its exact name, click **Delete workspace**. Under per-workspace storage this permanently deletes its configuration from YouTrack for every computer |
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
| 1 | **OpenBao**, once a credential is switched to it | Read from the OpenBao server. Sources 1 to 3 are ignored |
| 2 | **Source 1: Shell command** | Output is used as the token |
| 3 | **Source 2: File path** | File content is used as the token |
| 4 | **Source 3: Paste token (saved to OS keyring)** | Used only when Sources 1 and 2 are blank |

**The highest configured source is the only one used.** A failing source stops resolution and does
not fall through to the next one, although the on-screen text says "blank or fails". To use a pasted
token, blank Sources 1 and 2, and choose **Stop using OpenBao** if that credential uses it.

**Test connection** tests a pasted token if one is in the field, even when a higher source overrides
it. It does not save.

**Credentials not saved** means the keychain cannot encrypt on this computer. Use a shell command,
a file or OpenBao instead.

### Store credentials in OpenBao

**Not yet in a release.** This section describes the code merged after v1.5.0.

**Preconditions:** a reachable OpenBao server with a KV version 2 mount, and a login for Vermilian.
Remote servers must use `https://`. The section is absent from the first-run Settings screen.

1. Open **Settings → OpenBao credential storage** (tid `openbao-section`).
2. In **Applies to**, choose **This machine’s Settings credentials** or **The active workspace**.
3. Fill in **Server address**, **KV v2 mount** and **Secret path**.
4. In **Sign in with**, choose **AppRole** or **Short-lived token**, then give a command or a file
   that supplies the SecretID or token.
5. Click **Use this connection**, then **Test connection**.
6. Click **Move credentials to OpenBao**. Each credential is copied and read back before Vermilian
   switches to it.
7. Restart Vermilian and confirm the board loads.

**Expected result:** each credential's line reads **using OpenBao**.

**Limits:**

- **The active workspace** needs per-workspace storage. Without it the section reads "This scope is
  not available."
- Each scope has its own server and login. A workspace never reads another workspace's scope.
- If OpenBao is unavailable, operations that need that credential stop. There is no offline copy
  and no fallback to another source.
- The move stops, and overwrites nothing, if the secret path already holds a different value.
- If a saved credential can no longer be read, paste its value in that credential's field and click
  **Store**.

| Task | Control |
| --- | --- |
| Replace a stored value | Paste the new value and click **Store** |
| Go back to the previous source | **Stop using OpenBao**. The OpenBao copy is kept |
| Delete the keychain copy | **Remove local copy**. A configured command or file is left alone |
| Delete the OpenBao copy | **Delete from OpenBao**, offered once the credential is not using OpenBao |

**Proof:** `renderer/features/settings/sections/OpenBaoSection.tsx`,
`main/services/credentialResolver.ts`, `shared/credentialRefs.ts`. Spec:
`app/e2e/openbao-settings.spec.ts`. Failure messages and recovery are in `RUNBOOK.md`.

### Recover from a revoked token

1. The banner **Cannot load projects from YouTrack** appears with **Open Settings** and **Retry**.
2. Open Settings with the top-bar gear.
3. Fix the token at whichever source is configured. For a credential using OpenBao, paste the new
   value in **OpenBao credential storage** and click **Store**.
4. Click **Test connection**, then **Save**.
5. Click **Retry** if the banner remains.

### Other settings

- **Theme:** **Appearance**, then **Light**, **Dark** or **System**.
- **Advanced:** **Reset to defaults** keeps credentials. Also **Open config folder** and **Force
  resync from server**.

## Workspace Runways

*Available on main for the upcoming release; not in v1.6.0.* A Runway is a workspace's own ordered
list of the tickets to work on, from either tracker, kept on this computer. Open it with **Runway**
in the rail. Each workspace has its own Runway; the order is never written to YouTrack or Jira, and
adding a ticket never adds its project to the workspace. Rules: `spec/features/workspace-runway.md`.
Code: `renderer/features/runway/`, `main/services/runwayItemStore.ts`.

Two numbers, two meanings:

- **Runway #** is a ticket's place in this workspace's Runway: 1..N, counting tickets only (sections
  and notes have none). It is the same in the Runway view, the **Runway #** column of **All
  tasks**, the board cards, the detail panel and Desk cards.
- **Desk slot** (**Now**, **Next**, **Then**) is the ticket's Priority Desk rank 1, 2 or 3. It is set
  on the Desk, not by the Runway.

A ticket can be **Runway #1** without being **Now**, and **Now** without being on the Runway.
Promoting or demoting on the Desk never changes a Runway #; moving on the Runway never changes the
Desk.

### Add tickets to a Runway

1. Open **Runway** in the rail. The view is titled **Runway** with the workspace's name.
2. In the add box (*Add a ticket: key (READ-12), YouTrack link, or search*; on a Jira workspace
   *key (OPS-7), Jira link, or search*), type a key such as `READ-12`, paste a ticket link on the
   workspace's own tracker host, or type words and pick a search result.
3. Leave **at #** empty to add at the end, or type a Runway # to add there. Click **Add**.

From a board or a detail panel: open the ticket's **Runway #** control and use **Add at #**. A link
to another host, a ticket on the other tracker, or one already on this Runway is refused with the
reason. The ticket is read on the workspace's own connection before it is added.

### Reorder a Runway

In the Runway view each row has **↑** (**Move up**), **↓** (**Move down**), **Move to #** (tickets
only) and **Remove**. You can also click a ticket's number and type a new one, or drag a row by
its handle. In **All tasks**, on cards and in the detail panel, the **Runway #** control offers
**Move to #** and **Remove**. **Remove** asks first (*Remove KEY from this Runway?*) and only takes
the row off this workspace's Runway; the ticket is untouched. Numbers stay 1..N after every
action, and the order survives a restart.

### Sections and notes

Section headings and notes come from a [Markdown import](#import-a-schedule-from-markdown); there
is no control to add or edit them by hand. They have no Runway #, can be moved with **↑**, **↓** or
drag, and removed with **Remove**.

### Sort All tasks

The **Sort** control offers **Runway #**, **Tracker priority** and **Ticket ID**, with **↑
Ascending** to flip the direction and **Clear sort** to return to the default. It behaves
differently on each tracker:

- **YouTrack All tasks** defaults to **Status sections**. Choosing a sort turns the board into one
  flat list of every visible ticket, without status sections; **Clear sort** brings the sections
  back. The **Runway #** and Priority column headers choose the same sorts (other headers sort
  temporarily and show **Column header**).
- **Jira All tasks** is a board of status columns. It defaults to **Default order**, and a sort
  orders the cards **within each status column**; the columns never move. It uses the workspace's
  All tasks setting.
- **YouTrack project boards** in Kanban view have their own **Sort** (default **Default order**),
  remembered separately from All tasks; it also sorts within each column.

Each sort, both trackers:

- **Runway #**: tickets not on this Runway come last in both directions.
- **Tracker priority**: each project's own priority order, never the alphabet.
- **Ticket ID**: the project prefix as text, then the number as a number. Ascending is `OPS-956` →
  `OPS-4089`; descending reverses it.

The sort is remembered per workspace **on this computer** only. Changing it never changes a Runway #
or a tracker field.

### Blockers and order conflicts

In the Runway view each ticket shows **Ready**, **Blocked**, **Unknown** or **Done**, recomputed on
every read; **Refresh** re-reads the tickets. Nothing is ever reordered automatically.

- *Blocked by SYNC-3 (#2 here).* — the prerequisite is on this Runway.
- *Blocked by PLAT-40 (external, In Progress)* — the prerequisite is not on this Runway. Click
  **Add PLAT-40 to Runway** to put it immediately above the blocked ticket.
- *Order conflict — SYNC-3 is #5, after this (#2)* — a prerequisite sits after its dependent. Click
  **Move prerequisite above** to move it immediately above. *Possible order conflict …* means one of
  the two is not known to be open.

**All tasks** shows a badge beside the Runway # only for **Blocked** or **Unknown**, with the reason
on hover.

### Choose prerequisite link types

Which tracker links make a prerequisite is set per workspace, under per-workspace storage only:
**Manage workspaces → Prerequisites…**. In *Prerequisites for "&lt;workspace&gt;"* choose, for each
link type, which side is the prerequisite, or **Not a prerequisite**, then **Save**. **Reset to
default** returns to YouTrack's **Depend** or Jira's **Blocks** ("is blocked by" is the
prerequisite). Subtask links are never prerequisites.

### Runway # and Desk slot

Desk cards show **Runway #N** (or **Runway #?** when the position cannot be verified) and nothing
when the ticket is not on this Runway. Runway and All tasks rows show a read-only **Now**, **Next**
or **Then** chip when the ticket holds that Desk slot, marked ⚠ when two tickets share a rank. See
the definitions at the top of this section.

### Import a schedule from Markdown

Use this to turn a schedule file into workspaces and Runways. Nothing is written until **Apply**.

1. Open **Runway** and click **Import from Markdown…**. Choose a Markdown file (at most 1 MiB).
2. **Import preview — &lt;file&gt;** shows one group per `##` heading. In each group:
   - list items that start with a key or ticket link are numbered #1, #2…; `###` headings become
     sections and paragraphs become notes;
   - keys mentioned in prose, nested bullets, tables or code are listed under **References**,
     unticked; tick one to schedule it;
   - a key that cannot be read on the group's connection is kept as a note (*Unmatched, kept as a
     note: …*), and a repeated ticket as *Already scheduled as #N*.
3. Correct the grouping:
   - **Workspace**: map the group to an existing workspace, or **New workspace**. For a new one,
     **Check tickets using** picks the workspace whose connection reads the tickets, and
     **Rename…** names it.
   - **Merge into…** joins the group into another; **Make its own workspace** splits a `###`
     section out; **Skip** leaves a group out (**Include again** undoes it).
   - **Undo** reverses the last correction, **Reset** restores the preview as opened, **Cancel**
     closes without writing anything.
4. Click **Apply**. It shows **Applying…**, and the preview cannot be changed until it finishes.
   Apply checks the tickets again, backs up the Runway database, creates the new workspaces (each
   copying only its chosen workspace's connection and credential reference, with no projects) and
   writes the rows. The toast reads *Import applied: created …; added to the Runway of …. Backup:
   &lt;path&gt;*, and the active workspace stays the same.

A group that cannot be applied says why above its rows, for example *Choose a workspace for this
group.*, *This name is already used. Rename it, map it, or merge it.* or *Another group also goes
to this workspace. Merge them, or skip one.* If Apply sends a group back (a ticket changed, or the
Runway changed since the preview), correct it and click **Apply** again.

A synthetic schedule (the YouTrack server is `yt.example.test`):

```markdown
## Ship the offline reader

Readers lose their place on the train.

- [ ] https://yt.example.test/issue/READ-12 - Cache articles locally
- [ ] SYNC-3 - Conflict-free merge library
- [ ] READ-14 - Sync read state between devices
- [ ] SYNC-7 - Background sync worker
- [ ] READ-20 - Offline indicator in the toolbar

### Later

- Look at READ-9 again; it was the first attempt and is mostly obsolete.
```

This proposes the workspace *Ship the offline reader* with READ-12 … READ-20 as #1..5, the note
before them, the section **Later** and its note; READ-9 is listed under **References**, unticked.

### Import again into a Runway that has rows

Importing into a Runway that already has rows is additive and append-only: rows already there keep
their place and Runway #, and only what is missing is added **at the end**, in file order.

Example: after the import above, READ-20 was moved to **#1**. The file then gains one line,
`- [ ] PLAT-40 - Device token service`. Importing it again (the heading maps to the existing
workspace) previews:

| File row | Shown | Means |
| --- | --- | --- |
| READ-12 | #2, *Already on the Runway* | stays #2 |
| SYNC-3 | #3, *Already on the Runway* | stays #3 |
| READ-14 | #4, *Already on the Runway* | stays #4 |
| SYNC-7 | #5, *Already on the Runway* | stays #5 |
| READ-20 | #1, *Already on the Runway* | stays #1 |
| PLAT-40 | #6, *Added at the end* | new, after the last row |

After **Apply**, READ-20 is still #1 and PLAT-40 is #6. Every label naming a ticket by number uses
its Runway #, so *Already scheduled as #1* refers to READ-20 here.

- Sections and notes match by text and occurrence: with two **Later** sections on the Runway and
  three in the file, only the third is added. Indentation does not matter; trailing spaces are
  ignored.
- **Not in this file** lists the Runway's tickets the file does not have. They stay where they are.
- **Nothing new to add** means every row is already there; **Apply** stays disabled unless another
  group adds something.
- **Unable to verify** means a ticket already on the Runway could not be read, so a new ticket might
  be it under an old key. The new ticket shows **#?**, nothing can be applied, and **Retry** reads
  the Runway's tickets again.
- A ticket saved under an old Jira key (DEMO-101, now DEMO-150) is recognised as the same ticket.

### Runway ticket states

A Runway ticket is always read on its own workspace's connection; no other credential is ever
tried. Its row shows **Loading…**, then the ticket, or one of: **Not readable** (the credential was
refused), **Missing or not readable** (the tracker answered 404, which can mean either), **Missing**,
**Wrong tracker** or **Not refreshed**. The row keeps its place; fix the credential in **Settings**,
or **Remove** it.

## Runway snapshots

The Runway database holds every workspace's Runway order (both trackers), plus Jira Desk metadata
(Focus, rank, Why now) and dismissals. YouTrack Desk fields, workspace configuration and tickets
are not in it. Both actions are in **Settings → Advanced**.

**Export:** click **Export Runway snapshot…** and choose a new file. It never overwrites a file.
FAT, exFAT and some network folders are refused. The toast counts only Jira entries and
dismissals, but the file holds the Runway rows too.

**Import (restore):**

1. Click **Import Runway snapshot…** and pick a file.
2. Read **Replace all Runway metadata?**, including any **Local Runway changes may be lost**
   warning.
3. Click **Replace Runway data**.

Import replaces the whole database for every workspace; records absent from the snapshot are
removed. It never creates or deletes a workspace and never writes a ticket. The current data is
backed up first to `runway-backups/` (the 10 newest automatic backups are kept). To undo, import
the backup named in the toast.

**Undo a Markdown Apply:**

1. Import the backup named in the Apply's toast. That restore is local to this computer and returns
   every workspace's Runway to the moment before the Apply.
2. Check the Runways.
3. Only if you also want to remove a workspace the Apply created, delete it in **Manage
   workspaces**. This is optional, and it is not part of the restore: under per-workspace storage it
   deletes the workspace's configuration from YouTrack for every computer. Its Runway rows, if any
   remain, stay hidden in the database.

See `RUNBOOK.md`, *Runway database, backups and recovery*, for operational detail.

## Known behaviour to warn users about

These are current behaviours that can surprise a user.

| Behaviour | Source |
| --- | --- |
| **Stop and start new** replaces the timer even if logging the old timer's work failed, so that time can be lost | `renderer/AppShell.tsx` |
| The app quits on **Stop timer & quit** even if logging fails | `renderer/AppShell.tsx` |
| The **OS notifications** checkbox is saved, but the notification code never reads it | `renderer/features/timer/FocusOverlay.tsx`, `renderer/features/timer/BreakBanner.tsx` |
| **Export Runway snapshot…**'s hint and toast mention only Jira data, though the snapshot holds every workspace's Runway too | `renderer/features/settings/sections/AdvancedSection.tsx` |
| A snapshot restore never removes a workspace a Markdown Apply created; delete it by hand | `main/services/runwayImport.ts` |

## Keeping this file current

Update this file in the same change as any user-facing behaviour change, and update the version at
the top on each release. Copy UI labels from the code. Mark anything not confirmed as unverified
instead of guessing.
