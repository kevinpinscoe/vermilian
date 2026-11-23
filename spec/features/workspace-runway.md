# Feature: Workspace Runway

## Description

A **Runway** is a numbered, manually ordered list of tickets that belongs to one workspace. It is
the order in which you intend to finish that workspace's work. Membership is **by ticket, not by
project**: the same ticket can sit on several workspaces' Runways, each at its own position, and
adding a ticket to a Runway never moves its tracker project, never changes any workspace's
folders, and never writes to the ticket. Every workspace has a Runway, which starts empty, for
YouTrack and Jira workspaces alike.

The Runway order is local data, kept in the existing `runway-metadata.sqlite` file in `userData`
and moved between computers with the existing manual snapshot export and import. Tracker data —
status, priority, links — is read on each refresh and never stored in the order, so a refresh can
never reorder your plan.

Around the list itself, this feature adds: a **Runway #** column and three sorts in All tasks; a
Runway # control in the ticket detail panel; link-based **blocker** display; the Runway # on
Priority Desk cards (display only); and a **Markdown import** that turns an existing written
schedule into workspaces and their initial order. The Priority Desk itself is unchanged.

Vermilian schedules; ConTower executes. No Runway, sort or import action starts an agent, sends
input to tmux or invokes ConTower, and the Runway works without ConTower.

Approved design: VERM-74. Epic: VERM-75. This spec uses synthetic keys (`READ`, `SYNC`, `PLAT`,
`OPS`), synthetic workspace names and `*.example.test` hosts only.

## Acceptance criteria

### Membership

- [ ] A Runway entry is keyed by (workspace ID, namespaced ticket ID — `yt:…` or `jira:…`). One
      ticket can be on two workspaces' Runways at different positions; removing it from one leaves
      the other unchanged.
- [ ] Adding a ticket to a Runway never calls `setWorkspaceProjects`, never changes any
      workspace's folders or project ownership, and never writes to the ticket in the tracker.
- [ ] A Runway holds tickets from its own workspace's tracker only. It may span several projects on
      that tracker. Mixed-tracker Runways are not possible.
- [ ] A workspace with **no** board projects is valid and has a working Runway.
- [ ] A Runway ticket is read with its own workspace's credential only, and no other credential
      is ever tried. Under per-workspace storage that is the workspace's own credential reference
      (YouTrack) or Jira connection, never the Settings YouTrack token. Under legacy shared
      storage no workspace has a credential of its own, so it is the Settings YouTrack connection
      every workspace already uses. Each ticket row shows one of these states (VERM-84):
      - **Missing or not readable** — the tracker answered 404 for the ticket. YouTrack and Jira
        both answer 404 whether a ticket was deleted or this credential cannot see it, so the two
        cannot be told apart.
      - **Not readable with this workspace's credential** — an explicit access refusal (403), or a
        Jira ticket that moved to a key this workspace may not read.
      - **Missing** — only when the tracker confirms the ticket is gone (410).
      - **Wrong tracker** — the row names a ticket on the other tracker (for example after the
        workspace's backend changed). It is kept, not read, and no credential is resolved for it.
- [ ] Tickets are read in batches. A batch that fails because one ticket is unavailable (YouTrack
      answers 400 for a whole `issue id:` query if one ID does not exist; Jira does the same for
      `key in (…)`) is retried one ticket at a time on the same workspace connection, so the
      readable tickets still load.
- [ ] If authentication fails for the whole connection (401), or the workspace's credential cannot
      be resolved, the Runway shows one workspace-level error and no individual retries are made.
      A network failure, a timeout (no answer, 408 or 504), a rate limit (429), a server error
      or any other unexpected status is a refresh error, not a ticket state.
- [ ] Jira: the workspace ownership check that gates detail and link reads also admits a ticket
      that is on that workspace's Runway, on that workspace's own connection.

### Runway view

- [ ] A **Runway** entry in the left rail, between Priority Desk and All tasks, opens the active
      workspace's Runway in place of the board (VERM-85). It is there for YouTrack and Jira
      workspaces, including a workspace with no board projects.
- [ ] The view shows every saved row in its stored order: numbered tickets, section headings and
      notes, with their depth. The order comes from the local store; each ticket's details come
      from its tracker on the workspace's own connection.
- [ ] A ticket that did not resolve stays in place with its Runway #, its state and the reason
      (*Missing or not readable*, *Not readable*, *Missing*, *Wrong tracker*). If the whole read
      fails, every row stays, marked *Not refreshed*, under one warning.
- [ ] Clicking a resolved ticket opens the active workspace's existing detail panel — the
      YouTrack panel, or the Jira panel for a Jira workspace, including a Jira ticket that is only
      on the Runway. Closing the panel leaves the Runway's order and scroll position unchanged.

### Adding a ticket

- [ ] The Runway view's **Add** box takes a ticket key, a ticket link, or search text, and an
      optional **at #N**; without one the ticket goes at the end (VERM-86).
- [ ] A link must be on the workspace's own tracker host (its YouTrack server, or its Jira site),
      checked before any request. YouTrack links may be `…/issue/KEY` or the project view's
      `…/projects/PROJECT/issues/KEY`; Jira links `…/browse/KEY` or `?selectedIssue=KEY`. A link to any other host — the other tracker's included — is
      refused with a message naming the workspace's host.
- [ ] Submitting Add, or pressing Enter, reads that exact key once on the workspace's own
      connection, and on no other. This check does not widen search or detail admission: the Add
      box's search covers only the workspace's own projects and Jira boards (VERM-61, VERM-83).
- [ ] A ticket that passes is added once, through the Runway write gate, under the key the tracker
      answered with. Inside the gate, immediately before the write, a row holding the ticket under
      any ID it goes by — its readable key, or the YouTrack entity ID the check returned — refuses
      the add, and that row keeps its place and number. A 404 is refused with *Ticket missing or not readable with this workspace's
      credential.*; a timeout, no answer, a rate limit or a server error is a retryable error; a
      ticket already on the Runway is refused with no request. The order is unchanged by any
      refusal.
- [ ] Switching workspace while the check is in flight, or while the add waits for the write gate,
      cancels the add, and neither workspace's Runway changes. A switch is counted by the switch
      generation, not the active ID, so a round trip A → B → A cancels too.
- [ ] Adding never moves a project or board in any workspace.

### Runway order

- [ ] Ticket positions are numbered 1..N per workspace and stay **dense** — no gaps, no duplicates —
      after every action.
- [ ] The Runway view supports **Add**, **Remove**, **Move up**, **Move down**, **Move to #N**,
      typing a number in the row's **#** field, and drag. Each action is one transaction.
      Every row — ticket, section or note — has a drag handle, **↑**, **↓** and **Remove**;
      ticket rows also have **Move to #N** and the **#** field (VERM-87). ↑ and ↓ swap the row
      with the one immediately beside it, so crossing a heading or note keeps the Runway # and
      crossing a ticket changes it by one. A # past the end moves the ticket last; a # that is not
      a whole number of 1 or more is refused and nothing moves.
- [ ] **Remove** asks first, on the row: *Remove READ-12 from this Runway?*, or for a heading or
      note its own text, with **Remove** and **Cancel**. Confirming removes only that row from the
      active workspace's Runway; the tracker ticket and its rows on other workspaces' Runways are
      untouched.
- [ ] Remove and every Move capture the workspace-switch generation when the main process
      receives the request, and check it inside the Runway write gate after the last awaited
      validation, immediately before the write. Any switch while the edit waits — including a round
      trip A → B → A — cancels it, and neither workspace's Runway changes.
- [x] The ticket detail panel — YouTrack and Jira — has a **Runway #** control (VERM-88). Empty,
      it offers *Add at end* and *Add at #N*; filled, it shows the ticket's Runway # and offers
      *Move to #N* and *Remove*, confirmed inline (*Remove READ-12 from this Runway?*). It is
      independent of the Priority Desk: a Jira ticket with no Desk slot shows it too. The panel's
      ticket is matched to its saved row by every ID it goes by — its key, a YouTrack entity ID,
      the key a Jira panel was opened by — and by the row's tracker read, so a Jira ticket saved
      under a key it has since moved from is found; Move and Remove then use the row's stored ID.
      Adds go through the Add box's gated add (duplicate check by every ID, cancelled by any
      workspace switch); moves and removes are the Runway view's edits.
- [x] All tasks has the same **Runway #** control (VERM-90): its Runway # cell (YouTrack) or
      card badge (Jira) opens a popover holding the detail panel's control, with the same
      matching, gating, Retry and Remove confirmation. Clicks and keys in it never reach the row
      or card underneath. Opening it moves keyboard focus into it; Escape, from the number field
      or anywhere in it, closes it and returns focus to its cell or badge. Only one is open at a
      time. A cell with too little room below (a bottom row) opens it above, so its controls stay
      on screen.
- [ ] **Section** and **note** rows keep the structure of an imported schedule. They appear in the
      Runway view only, and the Runway # counts **tickets only** — a section or note never uses up
      a number.
- [ ] Every change is committed to `runway-metadata.sqlite` immediately. Order, sections and notes
      survive a restart unchanged.
- [ ] A ticket the tracker no longer returns keeps its row and position, marked **Missing or not
      readable** (or **Missing** when the tracker confirms it is gone), so a later refresh can
      restore its details. Reading the tracker never writes the Runway order.

### Storage and snapshots

- [ ] The order lives in a new `runway_item` table in `runway-metadata.sqlite`, schema version 2.
      The existing `runway_entry` (Jira Desk) and `dismissal` tables are unchanged, and the
      Jira-only ID rule stays on `runway_entry` only.
- [ ] A version 1 file is migrated to version 2 additively on first open, after a pre-migration
      copy is written. An older Vermilian refuses a version 2 file with its existing
      newer-schema error.
- [ ] **Export Runway snapshot…** writes version 2, including `runway_item`.
- [ ] Snapshot import accepts version 1 (migrated in the staging copy) and version 2, through the
      existing validation, preview, pre-import backup and single-transaction replace.
- [ ] A snapshot records the **computer that exported it** and the export time. The import
      preview shows both before anything is replaced.
- [ ] Because import replaces all local Runway data, the preview **warns when this computer has
      Runway changes newer than the snapshot's export time**, naming the latest local change,
      before the user can confirm.
- [ ] **A version 1 snapshot** predates these fields, so its preview:
  - labels the snapshot *Version 1 — will be upgraded to version 2 on import*, and says the
    upgrade happens in the staging copy, never in the live database;
  - shows the exporting computer and export time as **Not recorded (version 1 snapshot)** —
    never a guess, and never the file's modification time presented as the export time (it may
    appear only when clearly labelled as file metadata);
  - shows the warning *This snapshot does not record when it was exported, so Vermilian cannot
    tell whether this computer has newer Runway changes. Importing replaces all local Runway
    data.* in place of the newer-changes comparison, whenever this computer has any local Runway
    data;
  - shows the Runway order as empty (version 1 has no `runway_item` table), with the Desk entry
    and dismissal counts as today.
- [ ] Moving the Runway between Fedora and macOS uses manual export and import only. There is no
      automatic sync.

### All tasks

- [x] All tasks shows the workspace's project issues **plus** tickets added individually to the
      Runway from outside those projects, de-duplicated by namespaced ID (VERM-89): a ticket in a
      project and on the Runway appears once, and so do two Runway rows that read as the same
      ticket. YouTrack and Jira (projects and boards) alike, read on the workspace's own
      connection. An inline edit to an outside Runway ticket shows in its row.
- [x] Runway tickets make All tasks available in a workspace with **zero** board projects: it
      shows every readable ticket on its Runway, each exactly once (VERM-89). *Select a project*
      is shown only for a workspace with neither projects nor Runway tickets; a Jira workspace
      with no projects or boards says so above its Runway tickets.
- [x] **The filter decides which tickets are visible**, wherever a ticket came from (VERM-89). A
      resolved ticket from the Runway follows **Show closed** / **Show done** exactly as one from a
      project does. When that hides every ticket, All tasks stays open and says *All tickets are
      hidden by the current filter*, with the Show closed or Show done control.
- [x] A Runway ticket the tracker cannot read (*Missing*, *Not readable*, or a failed lookup) is
      not listed in All tasks; the Runway view keeps its position and explains its state. A
      failed Runway lookup still shows the tickets loaded from the workspace's projects or boards
      (VERM-89). When All tasks is empty because its Runway tickets cannot be read, it says so and
      offers **Open Runway**, which opens the Runway view; when closed tickets are hidden too, it
      gives both reasons and offers both Open Runway and the toggle.
- [x] All tasks lists only tickets still saved on the Runway: a removed ticket leaves at once,
      even while the tracker's answers are cached; one that is also in a project or board stays,
      once, through that source (VERM-89).
- [ ] In the zero-project All tasks, each ticket shows its Runway # and all three sorts work
      (VERM-90, VERM-91, VERM-92).
- [x] Both All tasks views (YouTrack and Jira) have a **Runway #** column (VERM-90). YouTrack's
      table has a *Runway #* column; Jira's All tasks is a card board, so each card carries a
      Runway # badge beside its key. Each shows the ticket's Runway # on the active workspace's
      Runway, blank when it has none and *?* when its position cannot be verified.
- [x] A sort control offers three keys, each ascending or descending (VERM-92 for YouTrack's All
      tasks table; Jira's All tasks board is VERM-93):

  | Sort key | Order |
  | --- | --- |
  | **Runway #** | By Runway position. Tickets with no position come **last in both directions**, among themselves by ticket ID ascending. |
  | **Tracker priority** | The tracker's own order — YouTrack's `Priority` bundle order; each Jira project's priority order from editmeta — never alphabetical. Applies to the **whole list**, positioned and unpositioned alike. **Ascending is the order the tracker lists, most urgent first.** Each ticket ranks by its position in **its own project's** order, so tickets from different Jira schemes compare by rank (`Highest` and `P1` are both rank 1). Only **known** ranks follow the direction. A priority whose rank is unknown — a value its project's order does not list, or a project whose order is unknown — comes **after every ranked ticket in both directions**, followed by tickets with no priority, last in both directions. |
  | **Ticket ID** | The displayed key's **project prefix as text** (code unit by code unit, no locale), then its **final number numerically**: ascending gives `VERM-90` → `VERM-101` and `OPS-96` → `OPS-956` → `OPS-4089`; descending reverses each. Applies to the **whole list**. |

- [x] Ties under **Runway #** and **Tracker priority** break by the ascending **Ticket ID** order
      (prefix as text, number numerically), even when those sorts are descending, so the order is
      fully deterministic.
- [x] **Sorting never writes Runway positions or tracker fields.** Switching sorts calls no
      Runway write and no tracker write, and Runway positions are identical afterwards.
- [x] The chosen sort is remembered **per workspace, on this computer only**. It is saved as a
      local view setting, not in the snapshot and not in the tracker, so it survives a restart.
      Saving it is the only write a sort change makes. It lives in `app-config.json`'s
      `allTasksSorts`, by workspace ID (VERM-92).
- [x] YouTrack's Tracker priority order is each project's own configured `Priority` bundle, read
      by `ordinal` on the workspace's own connection for every project the visible tickets come
      from — tickets added to the Runway from outside the workspace's projects included. A project
      whose bundle cannot be read ranks its tickets as unknown (VERM-92).
- [x] In YouTrack's All tasks a chosen sort lists every visible ticket as **one flat list**, with no
      status sections, so the Runway # reads straight down across statuses; the Status column
      stays and the filters still apply. **Clear sort** returns to the usual status sections and
      removes only the active workspace's remembered entry (VERM-92).
- [x] One sort is active at a time. Clicking the **Runway #** or **Priority** column header chooses
      that sort (a second click reverses it) and is remembered like the control. The other
      headers (Task, Status, Category, Due date) are a temporary sort inside the status sections
      for this session; they leave the remembered sort untouched (VERM-92).
- [ ] Project boards keep their own sorts and drag order; the new sorts apply to All tasks only.
- [x] *Optional:* the same sort control orders cards **within** each Kanban status column, for
      YouTrack and Jira. The column order itself is unchanged. With no sort chosen, Jira columns
      keep today's order. The Initial Usable Milestone does not depend on this (VERM-93):
      - **Jira's All tasks board** uses the All tasks sort (`allTasksSorts`) — it is All tasks.
        Tracker priority ranks each card by its own project's scheme, a Runway ticket from
        outside the workspace's projects included (read only for the workspace's own projects and
        its Runway tickets' projects).
      - **YouTrack project boards' Kanban view** has its own sort, remembered per workspace on
        this computer in `app-config.json`'s `kanbanSorts`, apart from All tasks'. It replaces
        the table's Sort menu in Kanban, which never ordered Kanban cards. Tracker priority uses
        the project's configured Priority bundle. With no sort, the cards keep today's order.
      - Each YouTrack Kanban card carries the All tasks **Runway #** cell and its popover. A press
        on the cell or its popover never starts a card drag.

### Blockers

- [ ] Each Runway ticket shows one state, in the Runway view and as a badge in All tasks:

  | State | Rule | Shown with |
  | --- | --- | --- |
  | **Done** | The ticket is resolved | kept in place |
  | **Blocked** | A prerequisite link points to an unresolved ticket, or the status is `BLOCKED` with no link | each blocking key, its status, and its Runway # here or *external* |
  | **Ready** | Unresolved, links read, every prerequisite resolved | — |
  | **Unknown** | Links could not be read: offline, not readable with this credential, link type not mapped, or stale | the reason |

- [x] Links are read into a provider-neutral `IssueLink` on each ticket: link type, direction as
      that ticket sees it, the wording from its side (the link type's name when that direction has
      no wording — never the other direction's), and the linked ticket's key, summary and resolved
      state: resolved, open, or *unknown* when the tracker did not say — never assumed open
      (YouTrack: VERM-94; Jira: VERM-95). A ticket whose links were not read has
      none recorded, which the blocker states treat as *Unknown*, never as "no prerequisites".
      Whether a link is a prerequisite is decided from its type and direction at display time
      (`linkRole`): an inward link of a prerequisite type (YouTrack `Depend` "depends on", Jira
      `Blocks` "is blocked by") makes the linked ticket a prerequisite.
- [x] A linked Jira ticket counts as done when its own project's status mapping says so, if the
      workspace maps that project's statuses; otherwise when Jira's status category is Done. A
      linked ticket with no readable status is *unknown*. A Jira link type whose two wordings are
      the same (`Relates`) is undirected (VERM-95).
- [ ] A YouTrack `BLOCKED` status with no prerequisite link shows the reason
      *status BLOCKED, no linked prerequisite*.
- [x] Prerequisite link types are configurable per workspace. Defaults: YouTrack `Depend`
      (*depends on* is a prerequisite) and Jira `Blocks` (*is blocked by* is a prerequisite).
      `Subtask` and parent links are never blockers. Chosen in Manage workspaces →
      **Prerequisites…** from the workspace's own tracker's link types: for each, the wording
      that answers "What am I waiting on?", so a custom type worded the other way works.
      `Subtask` and undirected types are shown but can't be chosen. Saved in the workspace's own
      article (per-workspace storage) as `prerequisiteLinkTypes`; absent is the default, an
      empty list means no link is a prerequisite, and **Reset to default** removes it. When the
      tracker can't be read, the saved choice is shown and can't be edited; closing keeps it,
      and **Reset to default** still removes it through the normal workspace save (VERM-96).
      Saves combined from the same starting document keep every field, the Master plan included.
- [ ] A blocker outside the Runway shows as *external*, e.g. *Blocked by PLAT-40 (external,
      In Progress)*, with an explicit **Add to Runway** action.
- [ ] A prerequisite positioned after its dependent shows an **Order conflict** badge, e.g.
      *Order conflict — SYNC-3 is #5, after this (#2)*, with an explicit
      **Move prerequisite above** action. Nothing moves until it is clicked.
- [ ] Blocker state is computed on each refresh and held only in the renderer cache. A refresh
      never writes the Runway order.

### Priority Desk (display only)

- [ ] Priority Desk behavior and storage are unchanged for both trackers: YouTrack's `Focus`,
      `Focus rank` and `Why now` fields; Jira's `runway_entry`; Choose next, *Not this week*, the
      AI adviser and Daily Review. Desk picks are not restricted to the Runway.
- [ ] A Desk card shows the ticket's Runway # in the active workspace, when it has one.
- [ ] Runway rows and All tasks rows show the ticket's Desk slot (Now, Next or Then), when it has
      one.
- [ ] Promoting or demoting a ticket on the Desk never changes a Runway position.

### Markdown import

- [ ] Import shows a **preview**; nothing is written until **Apply**, and **Cancel** leaves
      `runway-metadata.sqlite` byte-identical.
- [ ] Each `##` heading becomes a **proposed workspace** — new, or mapped to an existing workspace
      by name. `###` and deeper headings become **section** rows inside it.
- [ ] In the preview the grouping can be corrected: rename, merge, split a `###` into its own
      workspace, map to an existing workspace, choose the workspace's tracker connection, or skip.
- [ ] A ticket is **scheduled** when it leads a list item — `- [ ] KEY …`, `- [ ] <ticket URL> …`,
      `- [-] …`, `- [X] …`, or a plain bullet starting with a key or URL. Scheduled tickets become
      #1..N in file order, and `[X]` items keep their place.
- [ ] Keys in prose, nested sub-bullets, tables or code fences, or after "see", "moved to" or
      "replaced by", are listed under **References**, unticked. Ticking one schedules it.
- [ ] Prose paragraphs, non-ticket checklist items and fenced blocks become **note** rows at their
      position.
- [ ] **Repeated headings and notes are preserved.** A heading or note whose text appears more
      than once in the file — two `### Later` sections, or the same note under two headings —
      becomes one row per occurrence, each at its original location. Matching text is never
      merged or dropped.
- [ ] A key on the other tracker, or one the workspace's credential cannot read, is listed as
      unmatched and becomes a note.
- [ ] Importing a ticket never adds its project to the workspace.
- [ ] **Repeat import is additive and append-only:** into a non-empty Runway, tickets new to it
      are offered **at the end**, in file order. Every existing ticket keeps its Runway #;
      nothing is inserted between existing rows, removed or reordered. Tickets missing from the
      file are only listed.
- [ ] A repeat import never duplicates structure. A section or note in the file matches an
      existing row by **kind, text and occurrence** — the first `### Later` in the file matches
      the first `### Later` row, the second matches the second — and a matched row stays where
      it is. Only occurrences the Runway does not already have are new; they are appended at the
      end with the new tickets, in file order. Importing the same file twice leaves the Runway
      unchanged.
- [ ] **Apply** is one transaction, taken after a pre-apply snapshot in `runway-backups`.

### ConTower boundary

- [ ] Adding, removing, moving, sorting or importing tickets never starts an agent (such as
      Claude Code), never sends input to tmux, and never invokes ConTower. A test asserts this for
      the Runway, sort and import handlers.
- [ ] This is not a ban on every child process: a workspace whose tracker credential comes from
      a shell command still runs that command, and credential reads keep working during Runway,
      sort and import actions.
- [ ] The Runway is fully usable with ConTower absent.

### End-to-end acceptance

Fixtures: synthetic YouTrack projects `READ`, `SYNC` and `PLAT` in the fake YouTrack, with
`Depend` links; their Jira equivalents in the fake Jira, with `Blocks` links and the keys
`OPS-956` and `OPS-4089`.

- [ ] **1. Import:** the Markdown example below produces a workspace with tickets #1..5 in file
      order, the section and notes in place, READ-9 unscheduled and no project moved. Cancel
      leaves the database byte-identical.
- [ ] **2. Repeat import:** after moving READ-20 to #1 and adding a key to the file, a second
      import keeps every existing position (READ-20 stays #1), offers the new key at the end,
      and removes nothing.
- [ ] **3. Reorder:** positions stay dense 1..N after any action — up, down, *Move to #N*, typed
      #, drag, remove, re-add — from the Runway view, All tasks or the detail panel (plus a unit
      test over random action sequences).
- [ ] **4. Membership:** READ-14 sits in two workspaces at #3 and #1, each keeps its own
      position, and project ownership is unchanged.
- [ ] **5. Sorts:** the Runway # sort puts unnumbered tickets last both ways; the priority sort
      follows tracker order across the whole list; the ID sort puts `OPS-4089` before `OPS-956`
      ascending, across the whole list.
- [ ] **6. Sort safety:** switching sorts writes no Runway position and no tracker field, and
      the positions afterwards are identical. Only the remembered sort is saved locally.
- [x] **7. Kanban (optional):** each status column follows the chosen sort, and the column order
      is unchanged.
- [ ] **8. Blockers:** resolving SYNC-3 turns READ-14 from Blocked to Ready without reordering,
      and PLAT-40 still shows as external on SYNC-7.
- [ ] **9. Order conflict:** moving SYNC-3 below READ-14 flags the conflict, and nothing moves
      without a click.
- [ ] **10. Desk unchanged:** the existing Desk e2e specs pass unmodified, and promoting a ticket
      never changes its position.
- [ ] **11. Credentials:** a ticket the workspace's credential is refused shows as
      *Not readable*, one it gets a 404 for shows as *Missing or not readable*, and no other
      credential is used.
- [ ] **12. Restart:** the order, sections, notes and remembered sort are identical after quit
      and relaunch.
- [ ] **13. Snapshot restore:** an exported snapshot restores the order exactly, a version 1
      snapshot is accepted, and a backup is written first.
- [ ] **14. ConTower:** Runway, sort and import actions start no agent, send nothing to tmux
      and never invoke ConTower, while a workspace with a shell-command credential still reads
      its tickets.
- [ ] **15. Zero-project All tasks:** in a workspace with no board projects and five Runway
      tickets, All tasks lists each of the five exactly once and sorts them correctly by
      Runway #, tracker priority and ticket ID, each ascending and descending.
- [ ] **16. Repeat import of an unchanged file:** importing the example below a second time
      adds no ticket, section or note and changes no Runway #.
- [ ] **17. Transfer warning:** importing a snapshot older than this computer's latest Runway
      change shows the exporting computer and the newer-local-changes warning before the user
      confirms. A version 1 snapshot shows *Version 1 — will be upgraded*, the exporting computer
      and export time as *Not recorded (version 1 snapshot)*, and the cannot-tell warning.
- [ ] **18. Repeated headings and notes:** a file with two `### Later` sections, each holding the
      same note, imports as two section rows and two note rows at their original locations;
      importing it a second time adds nothing.

### Example (synthetic)

A Markdown schedule section. The YouTrack server is `yt.example.test`:

```markdown
## Ship the offline reader

Readers lose their place on the train. Target: before the spring release.

- [ ] https://yt.example.test/issue/READ-12 - Cache articles locally
- [ ] SYNC-3 - Conflict-free merge library
- [ ] READ-14 - Sync read state between devices
- [ ] SYNC-7 - Background sync worker
- [ ] READ-20 - Offline indicator in the toolbar

### Later

- Look at READ-9 again; it was the first attempt and is mostly obsolete.
```

After import, the Runway view of workspace *Ship the offline reader* (a YouTrack workspace with
no board projects), with Desk slots set afterwards using today's Desk controls:

| Runway # | Row | Blockers | Desk |
| --- | --- | --- | --- |
| — | *note:* "Readers lose their place on the train. …" | | |
| 1 | READ-12 Cache articles locally | Ready | Now |
| 2 | SYNC-3 Conflict-free merge library | Ready | Next |
| 3 | READ-14 Sync read state between devices | Blocked by SYNC-3 (#2 here) | |
| 4 | SYNC-7 Background sync worker | Blocked by PLAT-40 (external, In Progress) | |
| 5 | READ-20 Offline indicator in the toolbar | Ready | Then |
| — | *section:* Later | | |
| — | *note:* "Look at READ-9 again; …" | | |

- READ-9 is an unticked reference, so it is a note, not a ticket.
- No project moved: `READ` and `SYNC` stay in whichever workspace owns them.
- All tasks sorted by **Ticket ID ascending:** `READ-12, READ-14, READ-20, SYNC-3, SYNC-7`.
- All tasks sorted by **Runway # descending:** `READ-20 (5), SYNC-7 (4), READ-14 (3), SYNC-3 (2),
  READ-12 (1)`, then any unnumbered tickets by ticket ID ascending.
- When SYNC-3 is resolved, the next refresh shows SYNC-3 as Done, still at #2, and READ-14 as
  Ready. The order does not change.

### Out of scope

Any Priority Desk change; project-ownership or Add-projects changes; automatic cross-machine
sync; writing to Jira; creating or editing tracker links; mixed-tracker Runways; Markdown export;
ConTower implementation; starting an agent from Vermilian; new sorts on project boards.

## Wireframe

None yet. The synthetic example above stands in for the Runway view's layout.

## Open questions

- [ ] Jira link-type names on real sites have not been checked live; the per-workspace
      prerequisite link setting covers a site whose names differ from the `Blocks` default.
- [ ] Not yet verified that every screen copes with a workspace that has no board projects; the
      Runway view is the first screen built for one.
- [ ] `docs/requirements.md` does not yet describe this feature, and three of its statements
      need updating once it ships. *Scope* calls YouTrack the source of truth reached only
      through its REST API, but the Runway order is local data, and Jira workspaces exist.
      *Workspaces and organization* says workspace data syncs through `_vermilian-config`, but
      the Runway moves by manual snapshot only. *Priority Desk* says desk preferences use "no
      new local task database", which stays true for the Desk, but the Runway adds a local
      table. Project ownership ("exactly one folder in exactly one workspace") and the Desk's
      own blocker warning are unchanged by this spec.
