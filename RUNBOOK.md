---
title: RUNBOOK.md — Vermilian
tags: [runbook, operations]
vault_link: runbooks/home-kinscoe-projects-public-vermilian.md
source_path: /home/kinscoe/Projects/public/vermilian/RUNBOOK.md
---

> 📓 Indexed in the PKM knowledge vault at `runbooks/home-kinscoe-projects-public-vermilian.md` (symlink → this file).

# RUNBOOK.md — Vermilian

## Metadata

| Field | Value |
| --- | --- |
| **Owner** | Kevin P. Inscoe |
| **Last Updated** | 2026-11-24 |
| **Last Tested** | 2026-05-22 |
| **Expected Duration** | 2–5 min (first run); 15–30 s (subsequent runs) |
| **Risk Level** | Low |
| **Repo** | `git@github.com:kevinpinscoe/vermilian.git` |

---

## Purpose

Day-to-day development operations for Vermilian — starting, building, packaging, and troubleshooting the Electron desktop app.

---

## When to Use This Runbook

- **Use when:** starting the dev server, building a release package, or recovering from a broken install.
- **Do NOT use when:** working on bash scripts (`scripts/YouTrack/`) or the Go CLI (`cli/YouTrack/`) — those have no build step.

---

## Prerequisites

- [ ] Node.js 24 LTS on `$PATH` — `node --version` → `v24.x.x`
- [ ] pnpm on `$PATH` — `pnpm --version` → `11.x`
- [ ] Display available (Electron is a GUI app) — `echo $DISPLAY` → `:0`
- [ ] OpenBao reachable; YouTrack token at `app/YouTrack` (field: `token`) in OpenBao

---

## Stack

| Component | Details |
| --- | --- |
| **App shell** | Electron 45 via electron-forge 8 |
| **Renderer** | React 18 + TypeScript 5 + Vite 5 |
| **Design system** | monday.com Vibe (`@vibe/core` 4, `@vibe/icons` 4) |
| **Package manager** | pnpm 11 (hoisted linker — see note below) |
| **External services** | YouTrack REST API at `https://youtrack.example.com` |
| **Credentials** | API token in OpenBao `app/YouTrack` (field: `token`) — retrieved at runtime via `bao` |

---

## Step-by-Step Procedure

### Step 1 — Start the development server

**Why:** Launches Electron with Vite HMR so renderer changes hot-reload without restarting.

From the repo root (convenience wrapper):

```bash
./run.sh
```

Or directly from `app/`:

```bash
cd ~/Projects/private/vermilian/app
pnpm start
```

**Expected output:**

```text
✔ Found pnpm@11.x
✔ Checking your system
[@electron-forge/plugin-vite] target built src/preload.ts
[@electron-forge/plugin-vite] target built src/main.ts
```

An Electron window titled **Vermilian** opens displaying the ThemeProvider placeholder. DevTools open automatically (remove `mainWindow.webContents.openDevTools()` from `src/main.ts` to disable).

**If this fails:** See Troubleshooting below.

---

### Step 2 — Build a release package

```bash
cd ~/Projects/private/vermilian/app
pnpm make
```

Output artifacts land in `app/out/make/`. On Fedora the maker produces an `.AppImage`
(Linux ships AppImage only — see [Release process](#release-process)). On macOS it
produces a `.dmg`; on Windows, a Squirrel `Setup.exe` plus a portable `.zip`.

---

### Step 3 — Verify TypeScript compiles cleanly

```bash
cd ~/Projects/private/vermilian/app
./node_modules/.bin/tsc --noEmit
```

**Expected output:** No output (exit 0). All errors are clean.

---

### Step 4 — Run ESLint

```bash
cd ~/Projects/private/vermilian/app
pnpm lint
```

---

### Step 5 — Run the unit tests

```bash
cd ~/Projects/private/vermilian/app
pnpm test
```

**Expected output:** Vitest reports all suites passing (e.g. `Test Files  2 passed`). Runs in ~0.3s from source — no packaging needed. E2E (`pnpm test:e2e`) always packages an e2e build first (`e2e/package-e2e-build.sh`, `VERMILIAN_E2E_BUILD=1`) and runs under `xvfb-run`.

**E2E profile directories.** Each e2e run gets one folder, `vermilian-e2e-run-*`, in `$TMPDIR`
(`/tmp` by default). Every Electron profile of the run goes inside it. For the length of the run,
`TMPDIR`, `TMP` and `TEMP` point at that folder, so any temp folder a spec makes, and Chromium's own
temp files, land there too (VERM-112). The folder is removed when the run ends, pass or fail. A
killed run leaves that one folder behind; the next run removes any `vermilian-e2e-*` folder older
than an hour, including the loose ones left by runs before VERM-54.

After the last test, a cleanup check runs:

- If the run's own folder cannot be removed, the run fails and prints its path.
- If new e2e folders (`vermilian-e2e-*`, `verm-e2e-*`, `verm<N>-e2e-*`, `vermilian-live-profile-*`)
  appeared in the real temp directory during the run, it prints a warning listing them. It leaves
  them in place, since another lane's run may own them. A warning naming one of this branch's specs
  means that spec wrote outside the run folder, for example to a hard-coded `/tmp`.

Screenshots taken as PR evidence (the Runway snapshot import previews) go in one folder per worker,
`evidence-w<N>` inside the run folder, and are removed with it. Each capture gets its own file name:
a repeated name or a retry is saved as `name-2.png`, `name-3.png` and so on, never over an earlier
one.

- Set `VERMILIAN_E2E_KEEP_PROFILES=1` to keep the run folder (profiles and screenshots) for
  debugging. The run prints the folder's path and each evidence folder in it. It also keeps the
  live harness's `vermilian-live-profile-*` profile.
- Set `VERMILIAN_E2E_EVIDENCE_DIR=<dir>` to write the screenshots to `<dir>` instead and keep them.
  Captures from earlier runs in the same folder are not overwritten.

---

### Step 6 — Live acceptance harness

A pilot that runs selected Priority Desk checklist cases against a real YouTrack server.
`app/e2e-live/HARNESS.md` covers its design, settings, the server setup it still needs, and the
open decisions. Its reports are supporting evidence only. VERM-10's comments are the acceptance
record.

**Never package in the checkout that holds the human-acceptance build.** Use a worktree.
`test:live:package` refuses if `out/` holds the pinned build.

```bash
cd <worktree>/app
pnpm test:live:package                       # dev build + out/live-build-info.json (source commit)
pnpm test:e2e                                # deterministic suite (fake YouTrack)
pnpm exec playwright test e2e/timer.spec.ts  # one deterministic spec
```

Run the live suite. Settings come from the environment; see `HARNESS.md` → *Settings*.

```bash
export VERMILIAN_LIVE_EVIDENCE_DIR=~/evidence/VERM-10
pnpm test:live                                    # every live case, serially
pnpm test:live -g "A5/A6"                         # one checklist case, by ID
pnpm test:live -g "B9"                            # both B9 cases
pnpm test:live -g HARNESS                         # self-test only; needs no server
VERMILIAN_LIVE_EXECUTABLE=~/Projects/public/vermilian/app/out/Vermilian-linux-x64/Vermilian \
  pnpm test:live                                  # against the pinned acceptance build
```

When the app's token comes from a broker that renders it into a temporary file for the life of
one command, run the suite inside that command so the file exists throughout. The profile sets
`VERMILIAN_LIVE_APP_TOKEN_FILE`:

```bash
parzival exec --as ai youtrack-vermilian-harness -- pnpm test:live
```

Do not pass `--reporter`. It replaces the configured reporters, so no `results.md`, manifest or
HTML report is written.

**Expected output:** the run ends by printing its evidence directory,
`$VERMILIAN_LIVE_EVIDENCE_DIR/<UTC timestamp>/`. That directory holds:

| File | Contents |
| --- | --- |
| `results.md` | One row per checklist ID (Pass, Fail, Blocked or Not run), with expected and observed behavior |
| `manifest.json` | Build and environment identity |
| `test-output/` | Traces, screenshots, app logs, and server values before and after |

Without the server setup in `HARNESS.md` → *Server setup*, every checklist case reports
**Blocked** with the failing preflight check, and the run exits non-zero. That is expected.

To open the evidence:

```bash
less <run dir>/results.md
pnpm exec playwright show-report <run dir>/html
pnpm exec playwright show-trace <run dir>/test-output/<test>/trace-launch-1.zip
```

---

## Verification

```bash
pnpm start
```

**Success criteria:** Electron window opens with "Vermilian — YouTrack desktop client" text; no errors in the DevTools console; Vite HMR active (editing `src/App.tsx` reloads the window without restart).

---

## Release process

Releases are tag-driven. Pushing a signed `vMAJOR.MINOR.PATCH` tag triggers
`.github/workflows/release.yml`, which:

1. Builds the native artifact on each OS (matrix): Linux AppImage, universal macOS
   `.dmg`, Windows Squirrel installer + portable `.zip`.
2. Uploads them all to a single **draft** GitHub Release (electron-forge GitHub publisher).
3. The `channels` job promotes the draft to published, then commits an updated
   Homebrew **Cask** to `kevinpinscoe/homebrew-tap` and a **Scoop** manifest to
   `kevinpinscoe/scoop-bucket`, both pointing at the new release assets.

Linux ships AppImage only — `.deb`/`.rpm` are intentionally not produced, because the
`apt`/`rpm` index repos store package files in git and ~100 MB Electron packages would
bloat them. The macOS `.dmg` is unsigned (no Apple Developer ID); the Cask clears the
Gatekeeper quarantine flag on install.

### Required repo secrets

| Secret | Purpose |
| --- | --- |
| `HOMEBREW_TAP_TOKEN` | Push the Cask commit to `homebrew-tap` |
| `SCOOP_BUCKET_TOKEN` | Push the manifest commit to `scoop-bucket` |
| `GITHUB_TOKEN` | Auto-injected; creates the release |

### Cut a release

```bash
# 1. Bump app/package.json "version" to the new MAJOR.MINOR.PATCH
# 2. Update CHANGELOG.md
# 3. Commit (signed), then create and push a signed tag:
git tag -s vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z          # this push triggers the release workflow
```

Verify the signed tag with `git tag -v vX.Y.Z`. Watch the run with
`gh run watch --repo kevinpinscoe/vermilian`.

---

## Runway database, backups and recovery

### What the Runway database holds

`runway-metadata.sqlite`, in Vermilian's user-data directory (**Settings → Advanced → Open config
folder**), is local to this computer and holds, for **every** workspace:

| Table | What it is |
| --- | --- |
| `runway_item` | Each workspace's **Workspace Runway**: its ordered tickets (YouTrack and Jira), sections and notes (v1.7.0) |
| `runway_entry` | Jira workspaces' Priority Desk metadata: Focus, Focus rank, Why now |
| `dismissal` | Jira workspaces' "Not this week" dismissals |

It does **not** hold:

- **Workspace configuration** — workspaces, their names, folders, projects and credential
  references live in `_vermilian-config` or the per-workspace articles (see
  [Per-workspace configuration storage](#per-workspace-configuration-storage-verm-53)), and the
  active workspace in `active-workspace.json`.
- **Tracker data** — tickets, their fields and their links stay in YouTrack and Jira. YouTrack
  workspaces keep their Priority Desk metadata in YouTrack custom fields.
- **Credentials** — see [OpenBao credential storage](#openbao-credential-storage-verm-64) and
  Settings.

Nothing in this section ever writes to YouTrack or Jira.

**Process boundary (VERM-106).** Runway, sort and import actions never start an agent (such as
Claude Code), never send input to tmux and never invoke ConTower. The only process they can start
is a workspace's own **shell-command credential**, which runs when a ticket read needs that
workspace's token, exactly as it does for the board. `e2e/runway-process-boundary.spec.ts` checks
this with an e2e-build-only process recorder.

### Exporting a snapshot (VERM-50)

1. Open **Settings → Advanced → Export Runway snapshot…**.
2. Choose a new file name. The suggested name is
   `vermilian-runway-YYYYMMDD-HHMMSS.sqlite` in your Documents folder.
3. A toast reads "Exported Runway snapshot (N entries, M dismissals) to …". The counts are Jira
   Desk entries and dismissals only; the file also holds every workspace's Runway rows.

What the snapshot is:

- The whole database, every workspace and both trackers' Runway rows, as an ordinary SQLite file
  with the same schema, `application_id` (`VRML`) and `user_version` (2) as the live one, plus a
  `runway_snapshot_info` table recording when and on which computer it was exported. It is the
  format the snapshot import (below) restores.
- Taken with SQLite's online backup, so Vermilian keeps reading and writing the live database while
  it runs. The live file is never copied directly.
- Verified before it appears: the copy must pass `PRAGMA integrity_check` and carry the Runway
  `application_id` and a supported schema version.

It never replaces an existing file. If the chosen name already exists (even after the save dialog
asked to replace it), the export is refused and the existing file is left untouched; choose a new
name. A cancelled or failed export leaves no file behind.

The finished snapshot is published with a single hard link, so it appears complete or not at all.
A folder whose filesystem has no hard links (FAT/exFAT drives, some network shares) is refused
with "No snapshot was created … Choose a folder on a local disk" rather than written by a copy
that could be seen half-finished. Export to a local disk, then copy the file wherever it needs to
go.

Verify a snapshot by hand:

```bash
sqlite3 -readonly vermilian-runway-20261115-090507.sqlite \
  'PRAGMA integrity_check; PRAGMA application_id; PRAGMA user_version;
   SELECT count(*) FROM runway_entry; SELECT count(*) FROM dismissal;
   SELECT count(*) FROM runway_item;'
# Expect: ok, 1448234316 (VRML), 2, then the three row counts.
```

### Automatic backups and retention

Two operations back up the whole live database first, verified, with the same export:

- a **snapshot import** (below), before it replaces anything;
- a Markdown import's **Apply** (VERM-104), before it creates a workspace or writes a row.

Both write `runway-backups/runway-before-import-YYYYMMDD-HHMMSS.sqlite` in the user-data
directory (local time, with a `-2`, `-3` … suffix if that name exists; never overwritten). If the
backup fails, nothing is changed. Every backup is an ordinary snapshot, restorable as below.

The two share one pool: the **10 newest** `runway-before-import-*.sqlite` files are kept, and older
ones are removed after a successful snapshot import and after each Apply backup is written (even if
that Apply is then refused or fails). The backup just written is never removed. Nothing else in
`runway-backups/` (manual exports, other files, links, folders) is ever removed. Export a snapshot
by hand to keep a recovery point longer.

### Importing a snapshot (VERM-51)

Importing replaces the whole Runway database — **every** workspace's Runway order, and Jira Desk
metadata and dismissals — with the snapshot's. Nothing is sent to Jira or YouTrack, and workspace
configuration is not touched.

1. Open **Settings → Advanced → Import Runway snapshot…** and choose a snapshot file.
2. Vermilian reads the file once into a private copy in `runway-import-staging/` (user-data
   directory) and checks the copy: `integrity_check`, the `VRML` application ID, schema version 1
   or 2 (a newer one is refused), a schema identical to that version's (extra triggers, views or
   indexes are refused), Jira-only Desk issue IDs, dense 1..N Runway order rows, and a dry run that
   inserts every row under the live constraints. A version 1 snapshot is upgraded to version 2 in
   the staged copy only. A file that fails is refused before any preview.
3. **Replace all Runway metadata?** shows **File**, **Snapshot version**, **Exported by
   computer**, **Export time**, **File last modified (file metadata, not the export time)**,
   **Snapshot holds** and **Will replace (current)** (row counts), and **Backup of current data
   first, in**. A version 1 snapshot shows *Version 1 — will be upgraded to version 2 on import*
   and *Not recorded (version 1 snapshot)* for the computer and time. Before you can confirm,
   **Local Runway changes may be lost** warns when this computer has changes newer than the
   snapshot, or when Vermilian cannot tell. **Cancel** changes nothing.
4. **Replace Runway data**:
   - the chosen file must still be byte-identical to what was previewed, otherwise the import is
     refused ("changed after it was previewed");
   - the current database is backed up as above. If the backup fails, nothing is imported;
   - the replacement is one SQLite transaction on the live connection (`ATTACH`, `BEGIN
     IMMEDIATE`, `DELETE`, `INSERT … SELECT`, `COMMIT`): every row is re-checked by the live
     constraints, and any failure rolls back with the live data unchanged. Runway writes wait while
     it runs, and if live data changed after the backup the import is refused;
   - the result is verified (`integrity_check` and a row-by-row comparison with the snapshot), and
     a toast reads "Imported Runway snapshot (…). Previous data backed up to …".
5. One import at a time: while an import runs, a new preview, a second confirmation (from any
   window) and a cancel are refused or ignored with "A Runway snapshot import is already running",
   and the running import's staged copy is removed only when it finishes, succeeded or failed.

| Message starts with | Meaning | Live data |
| --- | --- | --- |
| This file is not an SQLite database / not a Vermilian Runway snapshot | Wrong file | Unchanged |
| Snapshot failed integrity_check | Corrupt file | Unchanged |
| Snapshot schema vN is newer / cannot be imported | Different Vermilian version | Unchanged |
| Snapshot schema does not match / breaks a Runway rule | Edited or damaged file | Unchanged |
| Nothing was imported: … changed after it was previewed | File replaced or edited after the preview; choose it again | Unchanged |
| Nothing was imported: the backup … could not be written | Disk or permission problem in the user-data directory | Unchanged |
| Nothing was imported: … busy / changed while the backup was being written | Try again | Unchanged |
| The snapshot was imported but the result did not verify | Restore the named backup as below | Replaced; restore the backup |

### Markdown import Apply (VERM-104, VERM-105)

*New in v1.7.0.*

**Import from Markdown…** (Runway view) previews a schedule file; **Apply** writes it. Apply:

1. reads every numbered ticket again on its group's connection and, for an existing destination,
   the tickets already on that Runway; anything changed since the preview sends the group back;
2. backs up the whole database (above);
3. creates the new workspaces — each copies only its chosen workspace's tracker connection and
   credential reference; no projects, no AI credential;
4. in one transaction, **appends** to each destination what it does not have yet, after checking
   every destination's rows are still exactly the ones the preview compared. Nothing already on a
   Runway moves, changes or is removed, so no Runway # changes.

If Apply fails, no partial set of Runway rows is committed. Any backup already created is kept.
Vermilian attempts to remove the workspaces this Apply created. If cleanup is incomplete, the dialog
shows the backup path and identifies what needs attention. Remove only items the dialog identifies
as created by this import and requiring manual removal. Leave articles listed under "Left in place
for inspection" in place while you investigate.

### Recovery: what "restore" means

Two operations change a Runway in bulk. They have different scopes:

| | Markdown import **Apply** | Snapshot **restore** (import) |
| --- | --- | --- |
| Rows | Appends missing rows to the chosen Runways only | Replaces **every** row of the whole database |
| Workspaces | Can create new workspaces (configuration) | Never creates, deletes or edits a workspace |
| Other workspaces' Runways | Untouched | Replaced with the snapshot's |
| Jira Desk metadata and dismissals | Untouched | Replaced with the snapshot's |
| YouTrack and Jira tickets and fields | Never written | Never written |
| Backup first | Yes | Yes |

**Undo a Markdown Apply** — restore first; deleting a workspace is a separate, optional step:

1. Import the backup named in the Apply's toast (`runway-backups/runway-before-import-…sqlite`)
   with **Settings → Advanced → Import Runway snapshot…**. This is local to this computer and
   returns **every** workspace's Runway, and Jira Desk metadata, to the moment before that Apply —
   including undoing anything changed since in any workspace. Read the **Local Runway changes may
   be lost** warning before confirming. The restore itself backs up the current state first.
2. Verify the Runways in the Runway view.
3. **Optional:** a workspace the Apply created is still there, because a restore never touches
   configuration. Delete it in **Manage workspaces** only if you also want to remove its
   configuration. Under per-workspace storage that deletes its configuration article from YouTrack
   for **every** computer and cannot be undone by a restore (see
   [Deleting a workspace](#deleting-a-workspace)). Do it only after step 2 succeeded.

For a single ticket, removing it by hand in the Runway view (**Remove**) is narrower than a
restore.

**Restore a snapshot** (moving to a new computer, or recovering a damaged database): import it as
above. Runway rows for a workspace that no longer exists in the configuration stay in the database
but are not shown (deleting a workspace never removes its Runway rows); workspaces are restored
separately, through their configuration.

**After "the result did not verify":** import the backup named in the message.

---

## Per-workspace configuration storage (VERM-53)

Vermilian keeps workspace configuration in one of two places:

- **Shared configuration (legacy):** every workspace in the one
  `_vermilian-config` article in the VERM project. This is the default.
- **Per-workspace storage:** one `_vermilian-ws-<workspaceId>` article per
  workspace (ADR-0011 §4). Workspaces, folders, projects, board settings and
  "Not this week" dismissals are written to the workspace's own article.

Two pieces of state decide which one a machine uses:

| State | Where | Written by |
| --- | --- | --- |
| This machine's mode and the activation it joined | `workspace-storage.json` in the user-data directory (mode `0600`) | Activation and return to legacy only |
| Whether per-workspace storage is active, its generation, and the article stamps at activation | The `_vermilian-storage-activation` article in VERM | Activation and return to legacy only |

Nothing switches on startup or install. A missing `workspace-storage.json` means
legacy. **Every configuration write checks both first, reading the marker from
YouTrack afresh each time, and fails closed:** if the marker cannot be read, is
duplicated or is malformed, is missing or retired when this machine expects it
active, or belongs to another generation, or the local file cannot be read,
nothing is saved and a toast says why. No cached marker ever authorizes a
write.

**Remaining limitation.** YouTrack has no compare-and-swap. A marker change
that lands in the one round trip between a write's check and that write is not
seen by that write; the next write is refused. Two machines activating at the
same instant can still both write a marker; the marker read-back or the
duplicate check then blocks writes everywhere until it is resolved (see
*Recovery*).

`_vermilian-config` and the Jira profile article are **never** written by
activation or return to legacy. Vermilian v1.2.10 and older never read the
marker and cannot be stopped by it: their writes to `_vermilian-config` are
detected afterwards (Settings shows a warning), not prevented. Upgrade every
machine before activating.

### Before activating (live activation needs Kevin's explicit approval)

Live activation on a real host is a separate, approved step: APP-65 (FLDW) and
APP-66 (Mac). Before it:

1. Every machine that runs Vermilian runs a build that contains VERM-53.
2. On the host, every credential reference in use resolves: at least
   `youtrack-1` and `anthropic-1`, and `jira-1` when the Jira profile will
   become a workspace. These three resolve through the Settings YouTrack
   token, Claude key and Jira token sources, so the **Test** buttons in
   **Settings → Connection**, **AI** and **Jira** are a first check.
   Activation itself runs the real resolution check for every reference the
   workspaces name, and refuses, naming the reference, if any fails.
3. **Settings → Workspace storage → Preview migration** shows each workspace as
   *will be created* or *already migrated*, and nothing as *CONFLICT*,
   *AMBIGUOUS* or *cannot be read*. The preview writes nothing.

### Activating (first machine)

1. **Settings → Workspace storage.** Optionally enter a name for a new Jira
   workspace (only if a Jira profile is set up; empty keeps the profile as it
   is).
2. **Preview migration**, read the list, then **Activate per-workspace
   storage…** and confirm.
3. Vermilian then, in order: pauses edits to `_vermilian-config` for the
   whole activation; if an edit is unsaved (debounced, retrying, in flight or
   refused earlier), writes it and reads it back, and **refuses to start** if
   that does not succeed — with no unsaved edit nothing is written; reads
   both source articles; writes a backup to
   `storage-activation-backups/activation-<UTC time>.json` (directory `0700`,
   file `0600`, never overwritten, never pruned) and verifies it reads back
   exactly; dry-runs the migration; resolves every credential reference;
   runs the VERM-44 migration and requires `complete: true`; re-reads both
   sources and stops if either changed; records every workspace article's
   stamp; writes the marker (new generation) and verifies it; and only then
   writes `workspace-storage.json`.
4. Success shows **Per-workspace storage activated** and the backup path.

### Joining (every other machine)

Once one machine has activated, every machine still on legacy storage shows
**Configuration changes are not being saved** and saves no configuration. On
each one: **Settings → Workspace storage → Use per-workspace storage on this
computer…** and confirm. Joining checks that every workspace article is
readable and every credential reference resolves on *this* machine, then
switches. Nothing is migrated again and no backup is written.

### Verifying

- **Settings → Workspace storage** shows **Per-workspace storage since
  <date>** in green.
- `workspace-storage.json` holds `"mode": "per-workspace"` and the marker's
  generation.
- The backup holds both source articles:

  ```bash
  jq '.articles[] | {role, articleId, updated}' "<user-data>/storage-activation-backups/activation-*.json"
  ```

### How to tell activation failed

Activation reports **Not activated** with the cause, and in every case below
this machine stays on `_vermilian-config`, which stays authoritative:

| Message (starts with) | Cause | What to do |
| --- | --- | --- |
| Your latest configuration change could not be saved to YouTrack | An edit to `_vermilian-config` was unsaved and could not be written and verified (YouTrack unreachable or refusing, or the write guard refused it) | Nothing was migrated and the edit is kept and retried; activate again once YouTrack accepts the save |
| An activation is already running on this computer | A second activation request while one runs | Wait for the first to finish |
| The backup … could not be written / did not read back | Disk or permission problem in the user-data directory | Fix it and run activation again |
| Migration cannot complete | An existing workspace article conflicts, is duplicated or unreadable; or the Jira profile is invalid | Fix the article named in the message in YouTrack, then preview again |
| A credential reference does not resolve | The named reference has no working source on this machine | Fix the host's source for it; no fallback is used |
| Migration did not complete | A create failed part-way | Run again: articles already created are found unchanged |
| The configuration changed while it was being migrated | Another machine or an older Vermilian saved `_vermilian-config` | Run again to migrate the current configuration |
| The storage activation marker … could not be verified | The marker write raced another machine, or there are now two markers | See *Marker cannot be verified* below |
| Per-workspace storage was activated, but this machine could not record the switch | The marker is active; `workspace-storage.json` could not be written | Run activation again on this machine; it joins |

Workspace articles created by a failed run are kept, never deleted.

### Deleting a workspace

**Manage workspaces… → Delete** permanently deletes the workspace's
`_vermilian-ws-<id>` article from YouTrack, for every machine. It cannot be
undone from Vermilian. Its board settings and dismissals go with it, unless its
projects are moved to another workspace, in which case their board settings
move too. The YouTrack or Jira projects themselves are never touched.

The projects are moved first, then the article is deleted. If the delete then
fails, the projects are in both workspaces and nothing is lost: run it again.

| Message (contains) | Cause | What to do |
| --- | --- | --- |
| uses a different server | The chosen destination is on another server or tracker | Choose a workspace on the same server, or Unassigned |
| was changed elsewhere | Another machine edited the workspace during the delete | Review the workspace, then delete it again |
| At least one workspace must exist | It is the only usable workspace | Create another workspace first |
| could not be confirmed gone | YouTrack accepted the delete, but the check afterwards failed | Reload and check the workspace list before retrying |

Deleting a workspace counts as a change since activation, so **Return to the
shared configuration** is refused afterwards.

### Returning to the shared configuration (safe rollback)

**Settings → Workspace storage → Return to the shared configuration…** and
confirm. It is allowed **only when nothing has changed since activation**:
every workspace article still has the stamp recorded in the marker, no
workspace was added or removed, and neither `_vermilian-config` nor the Jira
profile article moved. Then the marker is retired (verified), this machine
returns to legacy, and the workspace articles are kept. Every other machine
still on per-workspace storage then blocks configuration changes until it is
returned too (the same button; it returns locally because the marker is
already retired).

If anything changed, it is **refused and nothing changes**: returning would
hide configuration that exists only in the workspace articles. Vermilian never
copies workspace articles back into `_vermilian-config`.

### Manual reconciliation (when the return is refused)

The normal answer is to stay on per-workspace storage and fix forward. If the
shared configuration really must come back:

1. Stop Vermilian on every machine.
2. In YouTrack, compare each `_vermilian-ws-<id>` article with the matching
   workspace in `_vermilian-config` and copy any change you want to keep into
   `_vermilian-config` by hand (names, folders, projects, `boards`,
   `dismissals`). Anything not copied stays only in the workspace articles,
   which are kept.
3. Edit `_vermilian-storage-activation`: set `"state": "retired"`, set
   `"retiredAt"` to the current UTC time, and add 1 to `"sequence"`.
4. Start Vermilian on each machine and use **Return to the shared
   configuration…**: with the marker retired it returns locally.

### Recovery

**Marker cannot be verified** (writes blocked on every machine, "could not
verify which configuration storage is active"): in YouTrack, list the VERM
articles titled `_vermilian-storage-activation`. If there are two, keep the one
whose `generation` matches `workspace-storage.json` on the machine that
activated and delete the other. If the one marker is malformed, restore its
JSON from a correct copy (it holds no secrets) or, if per-workspace storage was
never used, delete it and remove `workspace-storage.json` on every machine.

**`workspace-storage.json` unreadable** (writes blocked on that machine): with
Vermilian stopped, delete the file to return the machine to legacy, then join
again from Settings if the marker is active.

**`_vermilian-config` damaged by an older client:** the activation backup holds
its content as it was at activation. Extract it and paste it into the article
in YouTrack:

```bash
jq -r '.articles[] | select(.role == "config") | .content' "<user-data>/storage-activation-backups/activation-<time>.json"
```

Backups contain configuration (names, project IDs, board settings), never
credentials. Keep them in the user-data directory; never commit them.

---

## Stand-up status mapping (VERM-114)

Stand-ups and the Priority Desk Daily Review read each YouTrack project's own
**Status** field and never use a built-in list of status names. For every
project in the active workspace, Vermilian reads the project's field
configuration (`/api/admin/projects/<shortName>/customFields`) on the
workspace's own connection, then decides what each Status value means:

| Value | Default role | Stand-up group |
| --- | --- | --- |
| Resolved (`isResolved`), e.g. `Done`, `Fixed`, `Duplicate` | `done` | Done |
| `Wont do` (also spelt `Won't do`, any case) | none | Not reported |
| `In Progress`, `Working on it`, `Doing`, `In development`, `In review` | `inProgress` | In progress |
| Any name starting `Waiting` | `waiting` | In progress |
| `Blocked`, `Impeded` (any case) | `blocked` | Blocked |
| Anything else | `todo` | Not reported |

`Wont do` is the only resolved value left out of completed work by default.
Every other resolved value, including `Duplicate`, `Obsolete` and `Rejected`,
counts as done unless the project's override maps it to a role with no
stand-up group (`todo` or `deferred`); see the worked example below.

Results are read in pages of 100 until YouTrack has no more, with no upper
limit: old completed issues match too and are dropped only after the read, so
a project with years of history still gets today's report. If YouTrack returns
the same page again instead of moving on, the stand-up stops with an error
rather than showing a partial report.

Daily Review reads only the active workspace. A request for any other
workspace is refused before its credential is resolved; a review that started
before you switched workspaces still finishes, and its result is kept with the
workspace it was for.

The query and the displayed groups are built from the same mapping, and the
query names only values the project actually has. If a project has no value
for a group, the stand-up names the project and the group it is missing
("OPS: no Status value is mapped to blocked …") and still reports the other
groups.

### Overriding the mapping for one project

Per-workspace storage only: legacy storage always uses the defaults above.
Overrides live in the workspace's own `_vermilian-ws-<workspaceId>` article
in the VERM project, under `youtrackProjects`, keyed by project short name.
Each entry maps an exact Status value to one of `todo`, `inProgress`,
`waiting`, `blocked`, `deferred` or `done`. Values not named keep their
default.

Worked example: project `OPS` uses `Stuck` for blocked work, its team wants
`Wont do` listed as completed, and it does not want `Duplicate` counted as an
accomplishment:

```json
"youtrackProjects": {
  "OPS": {
    "statusRoles": {
      "Stuck": "blocked",
      "Wont do": "done",
      "Duplicate": "deferred"
    }
  }
}
```

1. Stop Vermilian on every machine that uses the workspace, so none of them
   writes the article while you edit it.
2. In YouTrack, open the article `_vermilian-ws-<workspaceId>`, add the
   `youtrackProjects` block at the top level of the JSON, and save.
3. Start Vermilian and generate a stand-up. `Stuck` issues now appear under
   Blocked, recently closed `Wont do` issues under Done, and `Duplicate`
   issues nowhere. A name that is not
   one of the project's Status values is ignored, and the stand-up says so.

To return a project to the defaults, delete its entry. A mapping editor in the
app is a planned follow-up.

## Task creation field values (VERM-115)

New task and AI create take Status, Priority and Category from the selected
project's own configuration in YouTrack. They read
`/api/admin/projects/{id}/customFields` on the active workspace's connection,
using the same reader the stand-up uses. Nothing is configured in Vermilian.
To change what the form offers, change the project's fields or bundles in
YouTrack. The form shows the project's active values, defaulting to its
configured default or blank. A blank field is left out of the create request.

Before sending, the main process re-reads the project and checks the
workspace and every value. If any check fails, nothing is sent.

| Message (contains) | Cause | What to do |
| --- | --- | --- |
| Could not load this project's fields … Retry | The field read failed (YouTrack unreachable, or the workspace credential cannot read the project) | Click **Retry**; the draft is kept. If it persists, check the workspace's YouTrack credential |
| `<Field> "<value>" is not a value in this project` | The value is no longer offered (the bundle changed while the form was open), or a caller sent a stale value | Pick another value; **Refresh project options** re-reads the project |
| AI suggested `<Field> "<value>"` … Cleared | Claude proposed a value the project does not have | Choose a value or leave it blank |
| The active workspace changed before the task was created | The workspace was switched while the form was open | Reopen the form in the workspace you want |
| YouTrack rejected the request but did not identify the field | YouTrack refused the create with its unfilled `({1})` template, and a fresh read still offers every value sent | Click **Refresh project options** and try again; if it repeats, compare the form's values with the project's fields in YouTrack |

The `({1})` refusal recorded on 2026-11-24 read
`An Open-type entity with the specified name ({1}) was not found`. Whether
`Open` was the refused value is unconfirmed, and the word is never used to name
a field. Vermilian names a field only when the response itself names it, or
when a fresh read confirms the submitted value is no longer offered.

The automatic `Date time entered` timestamp is sent only when the project
defines that field as a `date` or `date and time` field. It is sent with the
`$type` that field takes on issues: `DateIssueCustomField` for `date`,
`SimpleIssueCustomField` for `date and time` (the type of `Date time entered`
in every current project). A project without the field, or with another
type, gets no timestamp, rather than a refused create.

Every options read and create runs on the YouTrack connection of the
workspace the form or AI request came from. A workspace switch cancels a
pending read or create before anything is sent, and the AI create message
"The active workspace changed while the AI was answering" means exactly this.

## OpenBao credential storage (VERM-64)

### What this is

OpenBao is the fourth credential source, beside a shell command, a file and Electron
`safeStorage`. A credential switched to OpenBao is read only from OpenBao, over its HTTP API
(KV v2), in the main process. The renderer never receives a stored credential or an OpenBao token.

**How this changes the original VERM-64 signing requirement.** macOS ties a `safeStorage` keychain
item to the build that created it, and ad-hoc signed builds change identity on every release.
Credentials in OpenBao never touch that keychain item, so upgrades cannot lock them out. Apple
Developer ID signing is no longer needed for credential persistence. It remains a separate,
optional concern for distribution (Gatekeeper and notarization).

### Scopes and isolation

Settings configures one **scope** at a time, and scopes share nothing:

| Scope | Covers | Stored under `openbaoScopes` key |
| --- | --- | --- |
| This machine's Settings credentials | The YouTrack, Claude and Jira credentials from Settings. Vermilian loads the workspace list with the YouTrack one | `_settings` |
| The active workspace | That workspace's tracker and Anthropic credential references. Needs per-workspace storage | The workspace ID |

Each scope has its own server, namespace, KV mount, secret path and login, and logs in for itself.
A workspace never reads another workspace's scope. Use a separate OpenBao instance, policy and
AppRole for work and for personal workspaces; Vermilian assumes nothing is shared between them.

`app-config.json` holds connection details and references only. The AppRole SecretID or token is
read from your command or file at login and kept in memory.

### Prerequisites

- A KV **version 2** mount.
- HTTPS for any remote server. Plain `http://` is accepted only for this machine (`127.0.0.1`,
  `localhost`, `[::1]`, `host.docker.internal`).
- A dedicated, least-privilege identity for each scope. Never use a root, administrative or
  break-glass token.

Policy for a scope using mount `secret` and path `vermilian/work`:

```hcl
path "secret/data/vermilian/work/*" {
  capabilities = ["create", "read", "update", "delete"]
}
```

AppRole is the recommended login. Keep the SecretID outside OpenBao, in a `0600` file or behind a
command such as a password manager CLI, so that OpenBao login never depends on OpenBao itself.
A short-lived token from a command is also supported. Do not point either at a long-lived token.
If the SecretID has a use limit, allow for one login per token lifetime and per app start.

### Configure and migrate

1. Open **Settings → OpenBao credential storage** and choose the scope.
2. Enter the server address, KV mount, secret path and login, then **Use this connection**.
3. **Test connection**. It reports connected, unreachable, sealed, login rejected, insufficient
   permissions, secret not found, or incomplete configuration.
4. **Move credentials to OpenBao**. Each credential is read from its current source, written,
   read back and compared. The scope switches over only after every credential verifies.
5. Restart Vermilian and confirm the board loads.
6. Optional: **Remove local copy** deletes the saved keychain-encrypted copy, after confirming the
   OpenBao copy is readable. A configured command or file is left as it is.

The migration can be repeated safely. A location already holding the same value is accepted. A
location holding a **different** value stops the migration and nothing is overwritten: choose
another secret path, or resolve the difference in OpenBao.

### First move on a Mac with an old keychain item

If an ad-hoc build can no longer read its saved credential, migration stops at that credential
because there is no readable original. Paste the value into that credential's field in the OpenBao
section and choose **Store**. This needs no keychain repair.

### Failure and recovery

| Symptom | Meaning | Action |
| --- | --- | --- |
| Server unreachable | Network, VPN or server down | Restore access. Vermilian keeps OpenBao selected and retries on the next operation |
| Sealed | OpenBao is sealed or uninitialized | Unseal the server |
| Login rejected or expired | SecretID or token revoked, expired or wrong | Issue a new one, update its file or command, then **Test connection** |
| Login secret unavailable | The command failed or the file is unreadable | Fix the command or file |
| Insufficient permissions | Policy does not cover the path | Correct the policy |
| Secret not found | Deleted, or the path changed | Restore the version in OpenBao, or **Store** the value again |

Operations that need a credential stop while OpenBao is unavailable. There is no offline cache.
Vermilian never switches to the keychain, a plain-text file or another workspace's server by itself.

To go back to the previous source, choose **Stop using OpenBao** for that credential. The copy in
OpenBao is kept. If you already removed the local copy, enter the credential again in Settings first.

### Rotate or revoke access

- **Rotate the SecretID:** issue a new one, update the file or command, **Test connection**, then
  destroy the old SecretID.
- **Rotate a stored credential:** paste the new value in the OpenBao section and choose **Store**.
- **Revoke Vermilian's access:** destroy the SecretID and revoke its tokens. Vermilian then reports
  the login as rejected.

### Testing

`app/src/main/services/openbaoLive.test.ts` runs against a real, disposable dev server and is skipped
unless `VERMILIAN_OPENBAO_TEST_ADDR` and `VERMILIAN_OPENBAO_TEST_ROOT` are set. It creates policies
and seals the server, so never point it at a real instance. When starting a dev server, set `HOME`
to an empty directory and pass `-dev-no-store-token`, so it cannot replace a stored CLI token.

---

## Dependency maintenance (VERM-55)

Dependabot (`.github/dependabot.yml`) checks `app/` (npm) and the workflows (GitHub
Actions) weekly. To keep its queue from building up again, it groups updates:

| Pull request | What it carries |
| --- | --- |
| One per lockstep group | `typescript-eslint`, `electron-forge`, `react`, `playwright`, `dnd-kit`. Each group's packages must move together |
| `npm-minor-patch` | Every other compatible minor or patch npm update, in one weekly PR |
| One per major | Any major update, e.g. Electron or Electron Forge, on its own |
| `@anthropic-ai/sdk` | Always on its own; test AI create, recommendations and stand-up |
| `github-actions` | Every action pin update, in one PR |

The ignores for `@vitejs/plugin-react >=6`, vite majors and `typescript >=6.1.0` stay in
place. "Dependency constraints worth knowing" in the repository's agent notes explains why.

### Policy

- **Weekly review.** Once a week, merge or close the open Dependabot PRs. Routine
  (grouped minor/patch) PRs merge once CI passes and the packaged e2e suite has run
  locally. Leave none open longer than two weeks: when PRs pile up they conflict with each
  other on `pnpm-lock.yaml` and none of them can merge.
- **Security updates at once.** A Dependabot security alert or security PR is handled
  as soon as it is seen, outside the weekly cadence. Check with
  `gh api 'repos/kevinpinscoe/vermilian/dependabot/alerts?state=open' --jq length`.
- **Majors are compatibility work.** A major update to a runtime or build dependency
  (Electron, Electron Forge, the Anthropic SDK) gets its own YouTrack issue when it needs
  more than a version bump. Do not fold one into a routine PR.
- **Consolidating by hand.** When several PRs conflict, bump them together on one branch
  instead of rebasing each. Close the superseded Dependabot PRs with a comment, but only
  after the replacement is merged and checked on `main`.
- **Release age.** pnpm 11 will not install a version published less than a day ago
  (`minimumReleaseAge`). If `pnpm add` writes a `minimumReleaseAgeExclude` list into
  `app/pnpm-workspace.yaml`, revert it and choose the newest version that is old
  enough. That exclusion list turns off the supply-chain age check for those packages.

### Gate for every dependency PR

```bash
cd app
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test
pnpm package
pnpm test:e2e:fresh          # packaged e2e; not in CI, so run it locally
```

`pnpm test:e2e` and `pnpm test:e2e:fresh` are the same: both package an **e2e build**
(`e2e/package-e2e-build.sh`, which sets `VERMILIAN_E2E_BUILD=1`) before running Playwright,
even when `out/` already holds the release package `pnpm package` just made. Only an e2e
build contains the e2e process recorder that `runway-process-boundary.spec.ts` reads
(VERM-106); a release package does not, so running Playwright directly on `pnpm package`'s
output fails that spec, with a message saying to use `pnpm test:e2e`. The script refuses,
like `test:live:package`, when `out/` holds the pinned acceptance build.

`pnpm test:release-isolation` checks the other side: it packages a release build
(`e2e/package-e2e-build.sh --release`) and proves that, even launched with
`VERMILIAN_E2E=1`, it exposes neither recorder debug method and registers neither of its
channels. Run `pnpm test:e2e` afterwards to put an e2e build back in `out/`.

CI runs everything except e2e. The `SQLite packaged check` workflow, which tests the
packaged SQLite module on every platform, runs by itself on any PR that changes
`app/package.json` or `app/pnpm-lock.yaml`. To rerun it by hand:
`gh workflow run sqlite-packaged-check.yml --ref <branch>`.

---

## Rollback Procedure

If `node_modules` becomes corrupt or the linker state is wrong:

```bash
cd ~/Projects/private/vermilian/app
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

Do **not** delete `.npmrc` or `pnpm-workspace.yaml` — they encode required compatibility settings.

---

## Escalation

This is a solo personal project. No escalation path.

---

## Related Runbooks

None yet. Future runbooks for the YouTrack Go CLI and packaging pipeline will be linked here.

---

## Troubleshooting

| Symptom | Likely Cause | Resolution |
| --- | --- | --- |
| `node-linker must be set to "hoisted"` on `pnpm start` | `nodeLinker: hoisted` missing from `pnpm-workspace.yaml`, or ran `pnpm install` before it was set | Verify `pnpm-workspace.yaml` has `nodeLinker: hoisted`, then `rm -rf node_modules && pnpm install` |
| `[ERR_PNPM_EXOTIC_SUBDEP]` on `pnpm install` | `block-exotic-subdeps=false` missing from `app/.npmrc` | Verify `.npmrc` has the line; if lost, re-add and reinstall |
| `pnpm create electron-app` fails with exotic subdep error | pnpm dlx reads global config, not project `.npmrc` | Use `npm create electron-app@latest` for the initial scaffold only; switch to pnpm afterwards |
| TypeScript errors in `node_modules/@types/node` | TypeScript version too old for `@types/node` v24 (requires TS 5+) | `pnpm add -D typescript@5` |
| `@vitejs/plugin-react` install conflict | Latest `@vitejs/plugin-react` (v6+) requires Vite 8; project uses Vite 5 | `pnpm add -D @vitejs/plugin-react@4` |
| `ReferenceError: __vite_ssr_exportName__ is not defined` on `pnpm test` | Vitest 2.x pulled a nested Vite 8 (rolldown/oxc) incompatible with its SSR transform | Ensure `overrides: { vite: ^5.4.21 }` is in `pnpm-workspace.yaml` (NOT `package.json` — pnpm 11.5 ignores it there), then `rm -rf node_modules && pnpm install` to prune the stale nested copy |
| `Cannot find package 'tinyglobby'` on `pnpm test` | hoisted linker didn't bring this transitive dep of Vitest's Vite | `pnpm add -D tinyglobby` |
| Electron window doesn't open, log stops after Vite builds | Electron binary not yet in `~/.cache/electron` for this version | Wait — first run downloads ~100 MB; subsequent runs use cache |
| `pnpm config get node-linker` returns `undefined` even with `.npmrc` set | `nodeLinker` must be in `pnpm-workspace.yaml`, not `.npmrc` | Move the setting to `pnpm-workspace.yaml` |
| `node_modules/.bin/electron-forge: Permission denied` on `pnpm package` | The local pnpm store holds `@electron-forge/cli`'s bin file without its execute bit. The published files are mode 0644, and pnpm normally sets the bit when it links the bin. A fresh store, as in CI, installs it 0755 | Confirm with `stat -c %A "$(readlink -f node_modules/.bin/electron-forge)"`. Reinstall from a clean store, e.g. `rm -rf node_modules && pnpm install --frozen-lockfile --store-dir <empty dir>`. Do not `chmod` the store copy without understanding why it lost the bit |

---

## Logs

```bash
# Dev server output goes directly to terminal.
# For background runs:
pnpm start > /tmp/vermilian.log 2>&1 &
tail -f /tmp/vermilian.log
```

---

## Maintenance Notes

- **Last game-day test:** 2026-05-22 — window launched on Fedora 42 KDE (Electron 42, pnpm 11)
- **Next scheduled review:** When upgrading Electron or pnpm major versions
- **Known drift risks:**
  - pnpm major upgrades may change how `node-linker` and `block-exotic-subdeps` are configured
  - electron-forge upgrades sometimes change the pnpm compatibility requirements
  - `@types/node` upgrades may require a TypeScript version bump

## pnpm + electron-forge compatibility notes

electron-forge 7 had three pnpm 11 requirements that are not obvious from the error messages alone. They were kept unchanged for electron-forge 8 (VERM-55), and the build works with them in place:

| Setting | File | Value | Why |
| --- | --- | --- | --- |
| `block-exotic-subdeps` | `app/.npmrc` | `false` | `@electron/rebuild` has a git-URL subdependency (`@electron/node-gyp`) that pnpm 11 blocks by default |
| `nodeLinker` | `app/pnpm-workspace.yaml` | `hoisted` | electron-forge requires flat `node_modules`; pnpm 11's default isolated linker breaks module resolution at runtime |
| `allowBuilds.esbuild` / `allowBuilds.electron-winstaller` | `app/pnpm-workspace.yaml` | `true` | pnpm 11 blocks install-time build scripts by default; both packages need them |

**Initial scaffold must use npm**, not pnpm. `pnpm dlx` fails with the exotic-subdep error because `.npmrc` is not in scope during dlx resolution. After the first `npm create electron-app`, all ongoing development uses `pnpm`.
