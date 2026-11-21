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
- [ ] A Runway ticket is read with its own workspace's credential only. If that credential cannot
      read it, the row shows **Not readable with this workspace's credential**, and no other
      credential is tried.
- [ ] Jira: the workspace ownership check that gates detail and link reads also admits a ticket
      that is on that workspace's Runway, on that workspace's own connection.

### Runway order

- [ ] Ticket positions are numbered 1..N per workspace and stay **dense** — no gaps, no duplicates —
      after every action.
- [ ] The Runway view supports **Add**, **Remove**, **Move up**, **Move down**, **Move to #N**,
      typing a number in the row's **#** field, and drag. Each action is one transaction.
- [ ] All tasks and the ticket detail panel have a **Runway #** control. Empty, it offers
      *Add at end* and *Add at #N*; filled, it offers *Move to #N* and *Remove*.
- [ ] **Section** and **note** rows keep the structure of an imported schedule. They appear in the
      Runway view only, and the Runway # counts **tickets only** — a section or note never uses up
      a number.
- [ ] Every change is committed to `runway-metadata.sqlite` immediately. Order, sections and notes
      survive a restart unchanged.
- [ ] A ticket that disappears from the tracker keeps its row and position, marked **Missing**.

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

- [ ] All tasks shows the workspace's project issues **plus** tickets added individually to the
      Runway from outside those projects, de-duplicated by namespaced ID.
- [ ] In a workspace with **zero** board projects, All tasks shows every ticket on its Runway,
      each exactly once, with its Runway # and all three sorts working. It is never empty
      while the Runway has tickets.
- [ ] Both All tasks views (YouTrack and Jira) have a **Runway #** column.
- [ ] A sort control offers three keys, each ascending or descending:

  | Sort key | Order |
  | --- | --- |
  | **Runway #** | By Runway position. Tickets with no position come **last in both directions**, among themselves by ticket ID ascending. |
  | **Tracker priority** | The tracker's own order — YouTrack's `Priority` bundle order; each Jira project's priority order from editmeta — never alphabetical. Applies to the **whole list**, positioned and unpositioned alike. A missing priority sorts last in both directions. |
  | **Ticket ID** | Plain text order of the displayed key, code unit by code unit, with no numeric awareness: `OPS-4089` < `OPS-956` < `OPS-96`. Applies to the **whole list**. |

- [ ] Ties under every sort break by ticket ID ascending, so the order is fully deterministic.
- [ ] **Sorting never writes Runway positions or tracker fields.** Switching sorts calls no
      Runway write and no tracker write, and Runway positions are identical afterwards.
- [ ] The chosen sort is remembered **per workspace, on this computer only**. It is saved as a
      local view setting, not in the snapshot and not in the tracker, so it survives a restart.
      Saving it is the only write a sort change makes.
- [ ] Project boards keep their own sorts and drag order; the new sorts apply to All tasks only.
- [ ] *Optional:* the same sort control orders cards **within** each Kanban status column, for
      YouTrack and Jira. The column order itself is unchanged. With no sort chosen, Jira columns
      keep today's order. The Initial Usable Milestone does not depend on this.

### Blockers

- [ ] Each Runway ticket shows one state, in the Runway view and as a badge in All tasks:

  | State | Rule | Shown with |
  | --- | --- | --- |
  | **Done** | The ticket is resolved | kept in place |
  | **Blocked** | A prerequisite link points to an unresolved ticket, or the status is `BLOCKED` with no link | each blocking key, its status, and its Runway # here or *external* |
  | **Ready** | Unresolved, links read, every prerequisite resolved | — |
  | **Unknown** | Links could not be read: offline, not readable with this credential, link type not mapped, or stale | the reason |

- [ ] A YouTrack `BLOCKED` status with no prerequisite link shows the reason
      *status BLOCKED, no linked prerequisite*.
- [ ] Prerequisite link types are configurable per workspace. Defaults: YouTrack `Depend`
      (*depends on* is a prerequisite) and Jira `Blocks` (*is blocked by* is a prerequisite).
      `Subtask` and parent links are never blockers.
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
- [ ] **7. Kanban (optional):** each status column follows the chosen sort, and the column order
      is unchanged.
- [ ] **8. Blockers:** resolving SYNC-3 turns READ-14 from Blocked to Ready without reordering,
      and PLAT-40 still shows as external on SYNC-7.
- [ ] **9. Order conflict:** moving SYNC-3 below READ-14 flags the conflict, and nothing moves
      without a click.
- [ ] **10. Desk unchanged:** the existing Desk e2e specs pass unmodified, and promoting a ticket
      never changes its position.
- [ ] **11. Credentials:** a ticket the workspace's credential cannot read shows as
      *Not readable*, and no other credential is used.
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
