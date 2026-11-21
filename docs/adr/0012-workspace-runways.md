# ADR-0012: Workspace Runways — a numbered ticket order per workspace

Date: 2026-11-21
Status: Accepted

## Context

A workspace today is a set of tracker projects. All tasks sorts by field values, and project
boards have a per-board drag order with no position numbers. Nothing records the order in which
the user intends to finish a workspace's work.

The user keeps that order in a Markdown schedule. Each major heading is an outcome, and under it
is a list of tickets in intended completion order. Two facts about that schedule shape this
decision:

- **An outcome spans several projects, and one project feeds several outcomes.** Project
  membership is exclusive — a project lives in exactly one folder of one workspace
  (`docs/requirements.md` § Workspaces and organization; [ADR-0011](0011-workspace-isolation-and-tracker-providers.md)
  section 4) — so building outcome workspaces from projects would keep moving projects between
  workspaces.
- **The same ticket can matter to more than one outcome**, at a different place in each.

Three gaps in today's behavior also bear on it:

- YouTrack priority sorts alphabetically (`Critical, Major, Minor, Normal, Show-stopper`), not in
  YouTrack's own order.
- The Jira board's key tie-break is numeric-aware, so `OPS-956` sorts before `OPS-4089`; the user
  wants plain text order.
- The All tasks sort lasts only for the session.

The feature is specified in [`spec/features/workspace-runway.md`](../../spec/features/workspace-runway.md).
This ADR records the decisions behind it. They were approved by the user on 2026-11-21 (proposal
VERM-74, decisions A–F with clarifications), and three were revised in review of the spec
(VERM-76). The spec holds the detailed, testable behavior; this ADR records the decisions and
why. If the two ever disagree, both are corrected together, never one alone.

## Options considered

**Where the order lives**

| Option | Pros | Cons |
| --- | --- | --- |
| **1. Outcome workspaces built from project membership** | No new storage | Collides with exclusive project ownership; pulls in whole projects; still has no order. Rejected. |
| **2. Order in a tracker field** | Visible in the tracker | One value per ticket, so overlapping workspaces need a field each. Jira custom fields need an administrator. YouTrack records history noise on every move. Rejected. |
| **3. Order in the per-workspace configuration article** | Syncs between machines automatically | Every move becomes a merge-and-verify article write, and a Jira workspace's schedule would live in YouTrack. Not needed once manual transfer was accepted. |
| **4. A table in the existing local Runway database, membership by ticket (chosen)** | Reuses the per-workspace SQLite store and its snapshot export, import and backups (ADR-0011 sections 6–7). Order and tracker data are stored apart, so a refresh cannot reorder the plan. Works the same for YouTrack and Jira. | Local-first: it moves between machines only by manual snapshot. |

**Repeat import of a Markdown schedule**

| Option | Pros | Cons |
| --- | --- | --- |
| **Three-way merge** (proposes removals and reorders from the file) | Keeps the file and the Runway in step | Needs an import-lineage table; about 1.5 days more; can move the user's own edits. |
| **Additive, append-only (chosen)** | Never changes a position the user set | Removals and reorders from the file are done by hand. |

## Decision

**Option 4.** Each workspace has a **Runway**: a numbered, manually ordered list of tickets on the
workspace's own tracker, stored in a new `runway_item` table in `runway-metadata.sqlite`
(schema version 2). Membership is **by ticket**: an entry is keyed by (workspace ID, namespaced
ticket ID), so one ticket can sit at different positions on different workspaces' Runways.
Positions are dense 1..N; section and note rows keep an imported schedule's structure and never
use up a number.

### Approved decisions (VERM-74)

| | Decision |
| --- | --- |
| **A. Name** | "Runway" names both the existing Desk metadata database and the new ordered list. |
| **B. All tasks** | All tasks shows the workspace's project issues **plus** tickets added individually to the Runway from outside those projects, de-duplicated by namespaced ID. |
| **C. Unnumbered tickets** | Under the **Runway #** sort, tickets with no position come **last in both directions**, among themselves by ticket ID ascending. The **tracker priority** and **ticket ID** sorts apply to the **whole list**, numbered and unnumbered alike. (Approval clarification; it replaces the proposal's wording, which put unnumbered tickets last under every sort.) |
| **D. Remembered sort** | The chosen All tasks sort is remembered **per workspace, on this computer only**: a local view setting, not in the snapshot and not in the tracker. |
| **E. Default prerequisite links** | YouTrack `Depend` (*depends on*) and Jira `Blocks` (*is blocked by*), configurable per workspace. `Subtask` and parent links are never blockers. A YouTrack status of `BLOCKED` with no prerequisite link counts as Blocked, with the reason *status BLOCKED, no linked prerequisite*. |
| **F. Repeat import** | Importing into a non-empty Runway is **additive**: it never removes or reorders. |

The sorts themselves: **tracker priority** uses the tracker's own order (YouTrack's `Priority`
bundle order; each Jira project's order from editmeta), never alphabetical; **ticket ID** compares
the displayed key code unit by code unit, with no numeric awareness, so `OPS-4089` sorts before
`OPS-956` ascending. Ties break by ticket ID ascending under every sort. Sorting within Kanban
status columns is **optional** and separate; the Initial Usable Milestone does not depend on it.

### Decisions revised in review of the spec (VERM-76)

| | Decision |
| --- | --- |
| **F, tightened: append-only** | Repeat import adds new tickets **at the end**, in file order, and never inserts between existing rows, so no existing Runway # changes. Sections and notes match existing rows by kind, text **and occurrence**, so a matched row stays where it is and only unmatched occurrences are appended; importing the same file twice changes nothing. (The proposal also allowed insertion after a file neighbor, which would have renumbered later tickets.) |
| **Repeated headings and notes** | A heading or note whose text repeats in the file — two `### Later` sections, the same note under two headings — is kept once per occurrence, at its original location. Matching text is never merged or dropped; that is why repeat import matches by occurrence rather than by text alone. |
| **Transfer warnings** | A snapshot records the **computer that exported it** and the **export time**, and the import preview shows both. Because import replaces all local Runway data, the preview **warns when this computer has Runway changes newer than the snapshot**, before the user confirms. (Revision 1 of the proposal had dropped these warnings; the user restored them.) A **version 1** snapshot records neither field: its preview says it will be upgraded to version 2 in the staging copy, shows both fields as *Not recorded (version 1 snapshot)* rather than a guess or a file time passed off as the export time, and replaces the comparison with a warning that Vermilian cannot tell whether local changes are newer and that importing replaces all local Runway data. |
| **ConTower boundary** | Runway, sort and import actions never start an agent, never send input to tmux and never invoke ConTower. This is not a ban on child processes: a tracker credential obtained by a shell command (ADR-0011 section 5) still runs and still works. |
| **Sorting never writes** | A sort change writes no Runway position and no tracker field. Saving the remembered sort (D) is its only write. |

### Unchanged

- **Project ownership.** Adding a ticket to a Runway never calls `setWorkspaceProjects`, never
  changes any workspace's folders and never writes to the ticket. A project still lives in exactly
  one folder of one workspace.
- **The Priority Desk**, in behavior and storage, for both trackers: YouTrack's `Focus`,
  `Focus rank` and `Why now` fields (ADR-0007) and Jira's `runway_entry` table (ADR-0011 section 6).
  The Runway adds display only — the Runway # on Desk cards and the Desk slot on Runway and All
  tasks rows — and promoting or demoting on the Desk never changes a Runway position.
- **Credential isolation** (ADR-0011 section 5). A Runway ticket is read with its own workspace's
  credential only; one it cannot read shows as *Not readable*, with no fallback.
- **Manual transfer.** The Runway moves between computers by snapshot export and import only.
- **Project boards** keep their own sorts and drag order.

## Consequences

- **Easier:** an outcome can be a workspace with zero board projects, built from tickets in any
  of its tracker's projects, without moving a project. The same ticket can be planned in several
  outcomes. Blocker state is read on refresh and never written, so the plan's order survives
  tracker changes.
- **Amends [ADR-0011](0011-workspace-isolation-and-tracker-providers.md) section 7**, in three
  places:
  - a snapshot now records the exporting computer and export time, so the import preview shows
    them, where section 7 says "the snapshot does not record when it was exported";
  - import accepts a version 1 snapshot by migrating it in the staging copy, where section 7
    requires the snapshot's `user_version` to be the one this version uses (a newer schema is
    still refused);
  - the preview adds the newer-local-changes warning, or, for a version 1 snapshot, the
    cannot-tell warning. Section 7's rule that a file's modification time is shown only when
    labelled as file metadata still holds.
- **Extends ADR-0011 section 6:** the local database now also holds the Runway order, for both
  YouTrack and Jira workspaces, and user-entered section and note text from imports. It still
  holds no tracker titles, descriptions or comments.
- **Harder:** two machines' Runways differ until a snapshot is moved across, and the last import
  wins. The newer-local-changes warning reduces, but does not remove, the risk of overwriting work.
- **Harder:** removals and reorders in the Markdown schedule after the first import must be made
  by hand on the Runway.
- **YouTrack Desk slots are per ticket:** a ticket on several Runways shows the same Desk slot in
  each, and appears on the Desk of the workspace that owns its project.
- **Follow-on:** `docs/requirements.md` needs updating once the feature ships (listed in the
  spec's open questions). ADR-0011 is still Proposed; this ADR depends on its sections 5–7 as
  written, plus the amendments above.
- **Risk:** section and note text comes from the user's own schedule and may be sensitive. Like
  `Why now`, it stays in the local database and its snapshots, never in this repository.
