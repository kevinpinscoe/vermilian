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
| **Last Updated** | 2026-11-15 |
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
| **App shell** | Electron 42 via electron-forge 7 |
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

**Expected output:** Vitest reports all suites passing (e.g. `Test Files  2 passed`). Runs in ~0.3s from source — no packaging needed. E2E (`pnpm test:e2e`) packages first and runs under `xvfb-run`.

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

## Runway metadata snapshot (Jira workspaces)

Jira workspaces keep their Priority Desk metadata (Focus, Focus rank, Why now,
"Not this week" dismissals) in a local SQLite file,
`runway-metadata.sqlite`, in Vermilian's user-data directory. YouTrack
workspaces keep theirs in YouTrack custom fields and are not in this file.

To take a manual backup (VERM-50):

1. Open **Settings → Advanced → Export Runway snapshot…**.
2. Choose a new file name. The suggested name is
   `vermilian-runway-YYYYMMDD-HHMMSS.sqlite` in your Documents folder.
3. A toast reports the path and the number of entries and dismissals written.

What the snapshot is:

- The whole database, every workspace, as an ordinary SQLite file with the
  same schema, `application_id` (`VRML`) and `user_version` as the live one.
  It is the format the snapshot import (below) restores.
- Taken with SQLite's online backup, so Vermilian keeps reading and writing
  the live database while it runs. The live file is never copied directly.
- Verified before it appears: the copy must pass `PRAGMA integrity_check`
  and carry the Runway `application_id` and a supported schema version.

It never replaces an existing file. If the chosen name already exists (even
after the save dialog asked to replace it), the export is refused and the
existing file is left untouched; choose a new name. A cancelled or failed
export leaves no file behind.

The finished snapshot is published with a single hard link, so it appears
complete or not at all. A folder whose filesystem has no hard links (FAT/exFAT
drives, some network shares) is refused with "No snapshot was created … Choose
a folder on a local disk" rather than written by a copy that could be seen
half-finished. Export to a local disk, then copy the file wherever it needs to
go.

Verify a snapshot by hand:

```bash
sqlite3 -readonly vermilian-runway-20261115-090507.sqlite \
  'PRAGMA integrity_check; PRAGMA application_id; PRAGMA user_version;
   SELECT count(*) FROM runway_entry; SELECT count(*) FROM dismissal;'
# Expect: ok, 1448234316 (VRML), 1, then the two row counts.
```

### Importing a snapshot (VERM-51)

Importing replaces the Runway metadata for **every** workspace on this
computer with the snapshot's. Nothing is sent to Jira or YouTrack.

1. Open **Settings → Advanced → Import Runway snapshot…** and choose a
   snapshot file.
2. Vermilian reads the file once into a private copy in
   `runway-import-staging/` (user-data directory) and checks the copy:
   `integrity_check`, the `VRML` application ID, a schema version exactly the
   one this build uses (newer and older are refused; nothing is migrated), a
   schema identical to this build's (extra triggers, views or indexes are
   refused), Jira-only issue IDs, and a dry run that inserts every row under
   the live constraints. A file that fails is refused before any preview.
3. The confirmation shows the file, **Export time: Not recorded in the
   snapshot** (the export does not store one), the file's last-modified time
   labelled as file metadata, the schema version, snapshot and current row
   counts, and the backup folder. **Cancel** changes nothing.
4. **Replace Runway data**:
   - the chosen file must still be byte-identical to what was previewed,
     otherwise the import is refused ("changed after it was previewed");
   - the current database is backed up, verified, to
     `runway-backups/runway-before-import-YYYYMMDD-HHMMSS.sqlite` (with a
     `-2`, `-3` … suffix if that name exists; never overwritten). If the
     backup fails, nothing is imported;
   - the replacement is one SQLite transaction on the live connection
     (`ATTACH`, `BEGIN IMMEDIATE`, `DELETE`, `INSERT … SELECT`, `COMMIT`):
     every row is re-checked by the live constraints, and any failure rolls
     back with the live data unchanged. Runway writes wait while it runs, and
     if live data changed after the backup the import is refused;
   - the result is verified (`integrity_check` and a row-by-row comparison
     with the snapshot), the Priority Desk refreshes, and a toast names the
     backup.
5. One import at a time: while an import runs, a new preview, a second
   confirmation (from any window) and a cancel are refused or ignored with
   "A Runway snapshot import is already running", and the running import's
   staged copy is removed only when it finishes, succeeded or failed.
6. Retention: after a successful import only the **10 newest**
   `runway-before-import-*.sqlite` files are kept. Nothing else in
   `runway-backups/` (manual exports, other files, links, folders) is ever
   removed, and nothing is pruned after a failed or cancelled import. A
   cleanup failure shows a warning; the import itself still succeeded.

**Undo an import**, or recover after "the result did not verify": import the
backup named in the toast — it is an ordinary snapshot. Open the user-data
directory with **Settings → Advanced → Open config folder**.

| Message starts with | Meaning | Live data |
| --- | --- | --- |
| This file is not an SQLite database / not a Vermilian Runway snapshot | Wrong file | Unchanged |
| Snapshot failed integrity_check | Corrupt file | Unchanged |
| Snapshot schema vN is newer / cannot be imported | Different Vermilian version | Unchanged |
| Snapshot schema does not match / breaks a Runway rule | Edited or damaged file | Unchanged |
| Nothing was imported: … changed after it was previewed | File replaced or edited after the preview; choose it again | Unchanged |
| Nothing was imported: the backup … could not be written | Disk or permission problem in the user-data directory | Unchanged |
| Nothing was imported: … busy / changed while the backup was being written | Try again | Unchanged |
| The snapshot was imported but the result did not verify | Restore the named backup as above | Replaced; restore the backup |

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

electron-forge 7 has three pnpm 11 requirements that are not obvious from the error messages alone. All three must be in place:

| Setting | File | Value | Why |
| --- | --- | --- | --- |
| `block-exotic-subdeps` | `app/.npmrc` | `false` | `@electron/rebuild` has a git-URL subdependency (`@electron/node-gyp`) that pnpm 11 blocks by default |
| `nodeLinker` | `app/pnpm-workspace.yaml` | `hoisted` | electron-forge requires flat `node_modules`; pnpm 11's default isolated linker breaks module resolution at runtime |
| `allowBuilds.esbuild` / `allowBuilds.electron-winstaller` | `app/pnpm-workspace.yaml` | `true` | pnpm 11 blocks install-time build scripts by default; both packages need them |

**Initial scaffold must use npm**, not pnpm. `pnpm dlx` fails with the exotic-subdep error because `.npmrc` is not in scope during dlx resolution. After the first `npm create electron-app`, all ongoing development uses `pnpm`.
