# Changelog

All notable changes to Vermilian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The Add projects dialog has a search box** (VERM-13). Typing narrows the list to
  projects whose name or short name contains the text, ignoring case. The box has focus
  when the dialog opens, and a message shows when nothing matches. Filtering only changes
  what is shown: a project ticked and then filtered out of view stays ticked, is saved,
  and is counted in the "will move out of" notice.

### Fixed

- **The e2e suite no longer leaks an Electron profile per test** (VERM-54). Every launch
  left a `vermilian-e2e-*` directory in the temp directory. 9,614 of them built up on one
  workstation and used up its `/tmp` inodes. Profiles now live in one folder per run, which
  is removed when the run ends. The next run sweeps leftovers older than an hour, and
  `VERMILIAN_E2E_KEEP_PROFILES=1` keeps them. The live acceptance harness now removes its
  profile once it has copied the evidence files out.

## [1.3.0] - 2026-11-15

Workspaces become the isolation boundary (ADR-0011), Jira boards arrive read-only, and
per-workspace configuration storage can be switched on. **Installing or starting 1.3.0 changes
nothing about where configuration is stored:** `_vermilian-config` stays authoritative until
you explicitly activate per-workspace storage in **Settings → Workspace storage**. Upgrade
every computer that runs Vermilian before activating, because v1.2.10 and older cannot see
the activation marker (see `RUNBOOK.md` → *Per-workspace configuration storage*).

### Added

- **Jira connection in Settings → Jira** (VERM-18, VERM-19, VERM-20): site URL, account
  email, and a token from a shell command, a file or the OS keyring. **Test connection**
  detects the site's cloudId and checks the token. The site URL, email and cloudId are shared
  between computers through a separate `_vermilian-jira-overlay` article; the token never
  leaves the computer it is configured on.
- **Read-only Jira boards** (VERM-21, VERM-27 to VERM-35, VERM-39, VERM-40). A workspace
  is created as either YouTrack or Jira, with no default. A Jira workspace chooses its Jira
  projects and shows them on the board with each project's own priorities (read from
  editmeta), a per-project status mapping, a chosen due-date field and a read-only detail
  panel (descriptions and comments rendered from ADF). Boards stay fresh by polling
  recently updated issues and back off on rate limits. A revoked or expired Jira token shows
  a reconnect state instead of an empty board. **Nothing is ever written to Jira.** Creating
  a Jira workspace needs per-workspace storage; under the shared configuration every
  workspace is on the one configured YouTrack server, and the Jira choice explains why it is
  disabled.
- **The Priority Desk ranks Jira issues** (VERM-38). Jira Focus, rank, Why now and
  dismissals are kept in a local Runway metadata database (SQLite), per workspace, because
  they cannot be stored in Jira.
- **Runway snapshots** (VERM-50, VERM-51): **Settings → Advanced → Export Runway snapshot…**
  writes a verified, consistent copy of the whole Runway database, never overwriting a file.
  **Import Runway snapshot…** validates a snapshot, previews it, backs up the current
  database first, then replaces it in one transaction and verifies the result.
- **One active workspace per computer** (VERM-46). The active workspace is stored locally
  rather than in the shared article, so two computers no longer switch each other.
  Switching while the timer is running asks **Stop timer** or **Cancel**.
- **A master plan per workspace, or none** (VERM-48): **Manage workspaces → Master plan…**
  sets a YouTrack article ID for a workspace. Under the shared configuration the global
  `_vermilian-master-plan` is still used.
- **Per-workspace credential references** (VERM-42, VERM-45). Each workspace names the
  credential it uses (`youtrack-1`, `anthropic-1`, `jira-1`, or its own), resolved only on
  the computer it runs on. Under per-workspace storage only the first configured source is
  used, with no fallback to another source, reference or workspace.
- **Per-workspace configuration storage can be activated** from **Settings → Workspace
  storage** (VERM-53, ADR-0011 §11). Activation runs only after an explicit confirmation,
  never on startup or install. It backs up `_vermilian-config` and the Jira profile article
  to a private local file and verifies it, previews the migration, checks that every
  credential reference resolves on this computer, migrates each workspace into its own
  `_vermilian-ws-<id>` article, re-checks that the sources did not change, records a shared
  `_vermilian-storage-activation` marker and only then switches this computer. An unsaved
  change to `_vermilian-config` must first be saved and verified, or activation does not
  start, and edits are paused while it runs. Any failure
  leaves `_vermilian-config` in use and unchanged. Other computers join without migrating
  again.
- **Configuration writes are guarded on every computer.** A computer still on the shared
  configuration stops saving configuration once another computer has activated, and a
  computer on per-workspace storage stops when the activation is retired or replaced. The
  marker is read afresh for every write; nothing cached authorizes one. A
  marker that cannot be read or verified blocks writes rather than guessing. Changes made
  to `_vermilian-config` after activation by Vermilian v1.2.10 or older (which cannot see
  the marker) are detected and shown in Settings.
- **Return to the shared configuration**, allowed only while no configuration has changed
  since activation; otherwise it is refused and nothing changes. The workspace articles
  are always kept. `RUNBOOK.md` documents activation, joining, failure handling, manual
  reconciliation and recovery.

### Changed

- **Stand-ups cover the active workspace only** (VERM-48), under both storage modes. This
  changes the default: stand-ups no longer combine every workspace. Stand-ups are not
  available for Jira workspaces yet.
- **AI features use the active workspace's Anthropic credential** (VERM-47). Under the
  shared configuration that is still the Settings key (`anthropic-1`), so nothing changes for
  an existing install. Under per-workspace storage a workspace with no AI credential selected
  has AI create, recommendations and stand-ups disabled, and the reason is shown.
- With per-workspace storage active, YouTrack issue operations use the active workspace's
  own server and credential reference, and Jira issue listing uses the active Jira
  workspace's reference, with no fallback to the Settings credentials or another
  workspace's. A YouTrack workspace on a different server now shows its board.
- With per-workspace storage active, workspace layout (names, folders, projects), board
  settings and "Not this week" dismissals are saved to the workspace's own article through
  the merge-and-verify write. Removing a workspace from the rail is refused there.
- A refused configuration save shows one short-lived toast instead of stacking persistent
  ones that could cover the top-bar Settings button.

### Removed

- **Cross-workspace stand-up scopes** (VERM-48): the "All workspaces" and "Custom" choices
  and the workspace picker are gone from the stand-up modal, and the `standupScope` setting
  is withdrawn. An older `app-config.json` that still holds it loads normally, and the value
  is ignored.
- The standalone "apply migration" API (`applyWorkspaceMigration`). Migration now runs only
  inside activation; the dry-run preview remains.

### Security

- **Electron 44.3.0 → 44.11.3.** Electron 44.3.0 still trusted a set of compromised
  eMudhra intermediate certificates (GHSA-jr5w-w6x2-84p9), so someone able to intercept
  the connection could impersonate the Jira or Anthropic servers. The update also
  includes the Electron fixes for GHSA-x562-297c-g43g, GHSA-3qxv-5xgr-q7w9 and
  GHSA-h3v5-h239-pg29. Vermilian does not use the features those three affect.
- **Build and test tooling patched.** None of these packages ships inside the packaged
  app, but they run on development machines and in CI:
  - Vite 6.4.3 → 6.4.6, staying on Vite 6. This fixes dev-server advisories, including
    the launch-editor ones.
  - Vitest 5.0.2 → 5.1.0, which brings `@vitest/mocker` 5.1.0.
  - Raised dependency overrides: undici 7.30.1, fast-uri 3.1.9, source-map-js 1.2.2,
    postcss-selector-parser 6.1.5 and zod 4.6.6.

## [1.2.10] - 2026-11-08

### Added

- **Priority Desk**, a new entry above *All tasks* in the left rail that answers one
  question: what should I work on now? It reads across every project in the active
  workspace. YouTrack stays the source of truth, and the desk stores nothing of its own.
  - **Focus, Focus rank and Why now.** A star marks an issue as focused, and a rank of
    1, 2 or 3 gives it a slot. The star is available on table rows, Kanban cards and the
    task detail panel. *Why now* is a short reason shown on the card. Unstarring clears
    the rank but keeps the reason.
  - **No silent replacement.** At most one issue holds each rank in a workspace. Taking a
    rank that is already held asks which issue keeps it. If two issues ever share a rank
    (an edit in the web UI, another machine), a repair banner names both and lets you
    choose. Vermilian never picks a winner on its own.
  - **Now mode** shows up to three cards, Now, Next and Then, with the issue's project,
    parent epic, priority, a blocker warning and the *Why now* note. *Start focus* on the
    Now card starts the existing focus timer. Empty slots stay empty.
  - **Choose next** shows up to seven candidates, earliest due date first, then by
    priority, with filters for status and active epic. A card can be starred, opened or given a rank. *Not this week*
    hides a candidate until the following Monday without changing its YouTrack priority.
  - **Epic context.** Cards show their parent epic and that epic's outcome, read from a
    `_vermilian-master-plan` Knowledge Base article. A banner explains when the outcome
    cannot be found.
  - **Ask for recommendation** (AI). Claude suggests a ranked order for a chosen outcome,
    with its reasoning and dependency readiness. Nothing changes until you choose an
    action, and that action posts an audit comment on the issues it touched.
  - **Daily Review**, a read-only summary: the current focus slots, blocked focused
    work, starred-but-unranked issues, recently completed work, and placeholders for
    agent work.
- **Three new fields: `Issue domain`, `Edit host`, and `Affected host`.** They
  were added to the YouTrack instance on 2026-08-01 and record whose work an
  issue is (`Personal` / `Employer work` / `Client work`), which machine it is
  being worked *from*, and which host it is *about*. All three are single-select
  dropdowns, optional, and hidden board columns by default — they are empty on
  every issue that predates them, since there was no backfill, so showing them
  by default would have added three blank columns. `Issue domain` is offered on
  the create-task form; the two host fields are edit-only.

  `Affected host`'s 21 values mirror the k-fed service catalog's fleet-host
  list. Adding a host to the fleet means adding a value here too.

### Changed

- **Electron 43 to 44**, with routine dependency updates (React, TanStack Query, the
  Anthropic SDK, Vibe, ESLint, Vitest, Playwright).

### Fixed

- **A finished issue kept its Priority Desk slot and rank.** A ranked issue set to `Done`
  stayed on the Now card after a restart, and its old rank raised an "already taken"
  question for an active issue. YouTrack returns resolved issues to the desk's query. The
  desk, *Blocked focused work* and *Needs attention* now skip completed issues. Their
  stored Focus and Focus rank are left as they were, and a reopened issue that collides
  with an active one goes to the repair banner.
- **The task detail panel's star did not change when clicked**, although the board and
  Kanban card did and the change was saved. The panel now refreshes after any star or
  rank change.
- **`Project health` could not be set at all.** The dropdown still offered
  `Yellow`, which was renamed to `Amber` in YouTrack on 2026-08-01 when the
  field adopted standard RAG nomenclature. Selecting it failed with *"An X-type
  entity with the specified name ({1}) was not found"*.
- **The `Status` dropdown had drifted from the live instance.** It offered
  `Working on it`, which is not a real status and failed the same way on write,
  and it was missing `Backlog` and `Scheduled` — both live, both previously
  unreachable from Vermilian. The list now matches the instance's `Statuses`
  bundle exactly, in the same order.

### Security

- Raised dependency floors past published advisories (`brace-expansion`, CVE-2026-69152;
  `fast-uri` 3.1.5; `nanoid` 3.3.18), and cleared 16 of the 18 open Dependabot alerts.

## [1.2.9] - 2026-07-31

### Added

- **"+ Add projects" in the workspace rail.** Until now a project could only be
  put into a workspace by right-clicking it and choosing *Move to workspace* —
  which needs a visible project row to right-click. A newly created workspace
  has none, so there was no way to put anything in it from inside it. The rail
  now has an **+ Add projects** button that opens a picker listing every
  YouTrack project with a checkbox and the workspace it currently belongs to.
  Unchecking a project leaves it unassigned rather than deleting it.

### Changed

- **Deleting a workspace that still holds projects is no longer blocked.** The
  old warning — "Move or remove all projects from X before deleting it" — named
  an action the dialog gave no way to perform, and no *remove projects* control
  existed anywhere in that modal. The delete confirmation now asks where the
  projects should go instead, offering *Unassigned* or any other workspace. The
  projects are never deleted, and the type-the-name confirmation is unchanged.

### Fixed

- **A workspace containing no projects rendered a completely blank left rail,**
  leaving no way to switch back to a workspace that did have projects, and no
  way to reach the workspace switcher, folder controls, or settings gear.
  `ThemeProvider` renders its own wrapping `<div>`, and it was being used
  without a `className`, so an unstyled auto-height element sat between `#root`
  and the app shell — every `height: 100%` below it resolved to `auto`. A
  populated board hid this by supplying its own content height, but an empty
  workspace falls back to the one-line "Select a project" placeholder, which
  collapsed the absolutely positioned rail to 22px.

- The `↑`/`↓` workspace reorder buttons in *Manage workspaces* rendered as thin
  vertical slivers — a 16px-tall button with `font-size: 11px` and
  `line-height: 1` clipped the arrow glyphs' ascender and descender.

## [1.2.8] - 2026-07-30

### Fixed

- **A stale machine could corrupt the shared workspace config for every other
  machine.** Workspace/folder/project-assignment data syncs across machines
  through a YouTrack Knowledge Base Article (`_vermilian-config`). A startup
  race let a machine serve (and later re-save) its local
  `workspace-config.json` cache before that Article finished loading, and
  saving never dropped project ids that no longer exist — so a machine whose
  local cache still held pre-rebuild project ids (YouTrack rebuilds reassign
  ids even when names/short names are unchanged) could push that stale data
  up through an ordinary action like switching workspaces, clobbering the
  correct config every other machine relied on.

  `saveWorkspaceConfig` now prunes any project ids absent from the live
  project list before persisting anywhere (locally, in the Article cache, or
  in the scheduled remote write). `getWorkspaceConfig` now waits (bounded) for
  an in-flight Article load instead of racing it. And Settings → Advanced has
  a new **"Force resync from server"** action to recover a config that's
  already corrupted, without manual API surgery.

### Added

- Settings → Advanced → **"Force resync from server"** — discards the
  cached workspace/project layout and re-fetches it from the YouTrack
  `_vermilian-config` Article, pruning stale project ids in the process.

### Changed

- The e2e suite's packaged-binary path was hardcoded to Linux
  (`out/Vermilian-linux-x64/Vermilian`), so it could only run on FLDW. It now
  resolves per `process.platform`/`process.arch`, and the full suite has been
  verified passing on macOS as well.

## [1.2.7] - 2026-07-29

### Fixed

- **A broken YouTrack connection could leave the app with no way to fix it.**
  The startup check asks only whether a stored token *exists*, never whether it
  works — so after a YouTrack rebuild invalidated the saved token, the app still
  considered itself connected and opened the board instead of Settings. The
  board was then empty, and the sole Settings button lived in the left rail,
  which renders YouTrack-derived data and had itself failed to load. An
  authentication failure removed the only route to fixing authentication, and
  recovery meant deleting the credential file by hand.

  Two escape hatches now exist. A Settings gear sits in the top bar, which
  depends on no remote data and is therefore always reachable. And when the
  projects query fails, a banner appears beneath the top bar naming the actual
  problem — distinguishing a rejected token from an unreachable host or a wrong
  URL — with **Open Settings** and **Retry** buttons.

  Related: `IPC.getProjects` now re-throws a real `Error` carrying the HTTP
  status. It previously let a plain `{ status, message }` object cross the IPC
  boundary, where Electron stringified it to `[object Object]` and the status
  was lost, so the renderer could not tell why a call had failed.

### Changed

- TypeScript 5.9.3 → 6.0.3, and `baseUrl` removed from `app/tsconfig.json`. It
  was set to `"."` with no `paths` mappings, so it resolved nothing; TypeScript
  6 deprecates the option (`TS5101`) and 7 removes it, so deleting it was both a
  valid cleanup and what unblocked the 6.0.3 bump.

- Dependabot no longer proposes TypeScript at or above 6.1.0. That is the
  ceiling of `@typescript-eslint`'s peer range (`>=4.8.4 <6.1.0` on 8.65.0, the
  latest release), and this project now sits at the top of it. The bound is a
  version constraint rather than a major-version ignore on purpose: 6.1.0 is a
  minor bump but already outside the range, so ignoring majors alone would
  still admit a failing update.

## [1.2.6] - 2026-07-29

### Added

- `pnpm typecheck` (`tsc --noEmit`), now a required CI step. Nothing previously
  type-checked this project — Vite/esbuild strips types without verifying them,
  so a plain `const n: number = "str"` passed lint, all 162 unit tests, and a
  full package build. `tsconfig.json` also moves to
  `moduleResolution: "bundler"`; the previous `"node"` setting is the legacy
  Node10 algorithm and cannot read `exports` maps, which produced spurious
  "cannot find module" errors for `@electron/fuses` and `@vitejs/plugin-react`.

### Changed

- TypeScript 5.4.5 → 5.9.3, required for the resolution change above.

### Removed

- `eslint-plugin-import`. Its last release (2.32.0, June 2025) declares an
  ESLint peer range ending at 9, so it was formally unsupported against the
  ESLint 10 this project now runs. Four of its seven enabled rules were
  module-correctness checks the TypeScript compiler performs natively and more
  accurately, and are now covered by `pnpm typecheck`; the remaining three were
  warning-level style heuristics, deliberately dropped rather than carrying an
  unmaintained plugin.

### Fixed

- The first-run settings screen rendered its "Connect your YouTrack instance to
  get started" banner with `type="informative"`, which is not one of the
  `AttentionBox` component's accepted values (`primary`, `positive`, `negative`,
  `warning`, `neutral`), so the banner did not style as intended. Now `primary`.
  This had shipped unnoticed; the new typecheck step is what surfaced it.

## [1.2.5] - 2026-07-29

### Fixed

- The `column widens when right edge dragged right` end-to-end test was flaky.
  It read the column width once, immediately after releasing the mouse — but
  the board clears the live drag width synchronously while persisting the new
  width through an async config mutation, so the header briefly renders back at
  its original width. The single read could land in that window, which is why
  the test passed in isolation and failed only under full-suite load. It now
  polls for the committed width. The neighbouring `40px minimum` test had the
  same race but *false-passed* rather than flaking, because the stale width was
  also above the minimum — it never exercised the clamp, and now does.

## [1.2.4] - 2026-07-29

### Changed

- ESLint 8.57.1 → **10.8.0**, and the lint configuration migrated from
  `.eslintrc.json` to flat config at `app/eslint.config.mjs`. ESLint 10 removed
  eslintrc support outright, so this was a prerequisite rather than a
  preference. The migration was verified rule-for-rule: linting the whole tree
  under both setups produced an identical set of findings, file and line for
  file and line. `pnpm lint` is now plain `eslint .` — the `--ext` flag no
  longer exists, and the config names the TypeScript extensions instead.

### Fixed

- An `eslint-disable-next-line react-hooks/exhaustive-deps` in
  `ProjectBoard.tsx` suppressed nothing. It sat directly above the
  `useCallback`, but the rule reports on the dependency-array line, so the
  warning fired anyway and the directive was dead. Flat config reports unused
  disable directives by default — which is how this surfaced — and the
  directive has been moved to where it actually applies.

## [1.2.3] - 2026-07-28

### Changed

- Electron 42.2.0 → **43.2.0**. This is the runtime the app ships on, so it
  carries the upstream Chromium and Node updates for every platform build.
  Verified with the full end-to-end suite against the packaged binary.

- Updated the UI and API libraries the app ships: `@vibe/core` 4.2.1 → 4.5.3,
  `@vibe/icons` 4.0.0 → 4.1.0, and `@anthropic-ai/sdk` 0.100.0 → 0.115.0.

- Updated development tooling: the Playwright group (`@playwright/test` and
  `playwright-core`, which must move together) to 1.62.0, and
  `@tanstack/react-query-devtools` to 5.101.4.

- Dependabot no longer proposes `vite` major bumps. The `vite` version is fixed
  by an `overrides:` entry in `app/pnpm-workspace.yaml`, which wins over the
  declared dependency range — so a bump of the `devDependencies` entry alone
  resolves to the old version, passes CI, and leaves `package.json` disagreeing
  with the installed tree. A genuine vite upgrade means editing the override,
  lifting the `@vitejs/plugin-react` ignore, and checking
  `@electron-forge/plugin-vite` (whose vite peer is `^5.0.12`).

### Security

- Raised the `postcss` override floor to `^8.5.18`, clearing the two remaining
  high-severity Dependabot advisories on `main`. As with the other overrides,
  `postcss` is build tooling and does not ship in the packaged app — Electron
  Forge bundles only `dependencies`.

## [1.2.2] - 2026-07-28

### Added

- Every GitHub Release now includes a `checksums.txt` — a SHA-256 manifest of
  all release assets — so downloads can be verified with
  `sha256sum -c checksums.txt`. Generated and uploaded by the release workflow's
  `channels` job after all platform artifacts are built.

- A `CI` workflow runs `pnpm lint`, `pnpm test`, and `pnpm package` on every
  pull request into `main` and on `main` after merge. Previously the only
  workflow fired on release tags, so pull requests carried no status checks at
  all. The `package` step is the important one: the two dependency bumps that
  broke `main` on 2026-07-27 both passed lint and all 162 unit tests, and only
  a real build caught them.

- `react-hooks/rules-of-hooks` (error) and `react-hooks/exhaustive-deps`
  (warning) are now enforced, via a new `eslint-plugin-react-hooks`
  dev-dependency. Two `eslint-disable react-hooks/exhaustive-deps` comments
  already in the tree had never done anything, because the plugin providing the
  rule was never installed. The plugin's own `recommended` preset is
  deliberately not used — v7 folded in the React Compiler rule set, which
  errors on 14 existing call sites; adopting those belongs in its own change.

### Changed

- GitHub Release bodies now contain this file's section for the released
  version, extracted by the release workflow, instead of the generic
  "Automated release vX.Y.Z. See CHANGELOG.md for details." pointer. Releases
  published before this change were backfilled the same way. If a tag has no
  matching `CHANGELOG.md` section, the workflow falls back to a link.

- Dependabot now groups packages that must move in lockstep — `@typescript-eslint/*`,
  `@electron-forge/*`, React and its type packages, Playwright, and `@dnd-kit/*` —
  and its open-PR limit is raised from the default 5 to 10. It is also pinned
  off `@vitejs/plugin-react` 6.x and above until this project moves to vite 8.

### Removed

- Dead code in `WorkspaceBoard.tsx`: an unused `useRef` import and an unused
  `projectPrefix()` helper.

### Fixed

- `pnpm package` failed on `main`, which would have made the next release tag
  fail every platform build. `@vitejs/plugin-react` had been bumped to 6.0.4,
  which requires `vite ^8.0.0`, while this project is on `vite` 6.4.3; the
  plugin imports `vite/internal`, a subpath vite 6 does not export. Pinned to
  `@vitejs/plugin-react` 5.2.0 — the newest release whose vite peer range still
  covers 6 (`^4.2 || ^5 || ^6 || ^7 || ^8`) — restoring the packaged build.

- `pnpm lint` failed on `main`: `@typescript-eslint/eslint-plugin` had been
  bumped to 8.65.0 while `@typescript-eslint/parser` stayed on 5.62.0. The two
  share a major line and cannot be mixed. Bumped the parser to 8.65.0 to match.
  typescript-eslint v8 also promoted `no-unused-vars` to an error in its
  `recommended` config with no default ignore pattern, so the rule is now
  configured to honour this codebase's existing leading-underscore convention
  for deliberately-unused bindings.

## [1.2.1] - 2026-07-23

### Fixed

- The top-bar issue search is no longer disabled (with a "blocked"/not-allowed
  cursor) on the All-tasks / workspace view. When no single project is selected
  it now searches across every project in the active workspace; when a project
  is selected it stays scoped to that project. The `searchIssues` IPC now takes
  a list of project short names, and the query builder joins them
  (`project: {A},{B} <terms>`).

### Security

- Upgraded `vite` 5.4.21 → 6.4.3 and pinned `esbuild` ≥ 0.25.0 via
  `pnpm-workspace.yaml` overrides, clearing the four remaining Dependabot
  advisories: vite GHSA-fx2h-pf6j-xcff (high, `server.fs.deny` bypass),
  GHSA-v6wh-96g9-6wx3, GHSA-4w7w-66w2-5vf9, and esbuild GHSA-67mh-4wv8-2f99.
  All four were dev-toolchain only and never shipped in the packaged app
  (Electron Forge bundles only `dependencies`). `pnpm audit` is now clean.
  Verified with a full `electron-forge package` build — `@electron-forge/plugin-vite@7.11`
  has no vite peer/dep pin and `@vitejs/plugin-react@4.7` supports vite 6.

## [1.2.0] - 2026-07-23

### Added

- Issue search in the top bar, scoped to the active project. Typing debounced
  free-text terms queries YouTrack (`project: <shortName> <terms>`, capped at 50
  matches) and shows a results dropdown; selecting a result opens the issue in
  the detail panel. Handles the empty-query, no-results, and API-failure states,
  and disables with a "Select a project to search" hint when no project is
  active. YouTrack remains the source of truth — no local index. Backed by the
  e2e fake YouTrack (substring match on summary / readable id) so the flow is
  testable without network calls. New `youtrack:searchIssues` IPC channel; pure
  query builder in `shared/search.ts` with unit tests plus an e2e flow spec.

## [1.1.3] - 2026-07-23

### Security

- Pinned patched versions of two more vulnerable transitive dev-toolchain
  dependencies via `pnpm-workspace.yaml` overrides: `fast-uri` 3.1.2→3.1.4 (host
  confusion via backslash authority delimiter / failed IDN canonicalization,
  GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6) and `brace-expansion` 1.1.14→1.1.16
  and 2.1.0→2.1.2 (exponential-time ReDoS on consecutive non-expanding `{}`
  groups, GHSA-3jxr-9vmj-r5cp). Neither ships in the packaged app — both are
  deep build/lint tooling transitives. The remaining open advisories are all in
  the vite tree and require the deferred vite 5→6 major upgrade.

## [1.1.2] - 2026-07-23

### Security

- Pinned patched versions of vulnerable transitive dev-toolchain dependencies
  via `pnpm-workspace.yaml` overrides: `tar` 6.2.1→7.5.21 (node-tar path/hardlink
  traversal advisories), `undici` 7.25.0→7.28.0, `tmp` 0.0.33→0.2.7, `js-yaml`
  4.1.1→4.3.0, `@babel/core` 7.29.0→7.29.7, and deduped `postcss` to 8.5.15.
  This clears 20 Dependabot alerts (including the two critical vitest UI RCE
  alerts, already resolved by the 3.2.7 bump). None of these packages ship in
  the packaged app — Electron Forge bundles only `dependencies`, and all of the
  above are build/test/CLI tooling. The `electron-forge package` build
  (including native-dependency rebuild) was verified against the bumped `tar`.
  The remaining vite-tree advisories require a vite 5→6 major upgrade and are
  deferred to a separate change.

## [1.1.1] - 2026-07-23

### Added

- The application version is now shown in the top bar, immediately to the left
  of the Exit button (e.g. `v1.1.1`). It is sourced from `package.json` at build
  time, so it always matches the released tag.

## [1.1.0] - 2026-07-22

### Added

- Field-definition registry (`src/shared/fields.ts`) as the single source of
  truth for every known YouTrack custom field, replacing eight independently
  hand-maintained lists.
- 13 new YouTrack custom fields: Ghostty tab name, Repo URL, Working branch,
  Tracking file URL, TODO file URL, Project health, Progress percent, Next
  status due, Reporting cadence, Base branch, Pull request URL, Artifact URL,
  and Last reported commit. All are hidden by default; only Repo URL is
  creatable from the new-task form.
- A `number` field editor (0–100, clamped on commit) for Progress percent,
  backed by a new `integer` wire kind for raw-numeric custom fields.

### Fixed

- Category and Notes custom fields were declared with the wrong YouTrack
  `$type` (`SingleEnumIssueCustomField`/`TextIssueCustomField` instead of
  `StateIssueCustomField`/`SimpleIssueCustomField`), which broke writes to
  those two fields.
- Assignee was missing from the field type map entirely, so patching it threw
  "Unknown field".
- Knowledge Base article creation now sends the required `project` field. On
  YouTrack 2026.2 every article must belong to a project; the previous
  `{summary, content}`-only request returned `400 Article.project-is-invalid`
  (surfaced as the "Could not sync configuration — retrying." toast).

### Changed

- Renamed the `trackingLink` field to `relatedLink` throughout (key, YouTrack
  lookup, and UI label) to match the "Related link" rename on the YouTrack
  instance.

## [1.0.8] - 2026-07-17

### Added

- CI release workflow now builds an arm64 Linux AppImage (on `ubuntu-24.04-arm`)
  alongside the existing release targets.

## [1.0.7] - 2026-06-25

### Fixed

- When `safeStorage` encryption is completely unavailable (e.g. macOS 26 /
  Tahoe where Electron's keychain integration may fail entirely), `saveSecret`
  now falls back to a plain-text file with owner-only permissions (`0o600`) in
  the app data folder. The save succeeds and a warning toast informs the user
  that encryption was unavailable. Previously the save returned `{ ok: false }`
  and the token was never written, blocking first-run configuration.
- `loadSecret` now checks the plain-text fallback file when the encrypted blob
  is absent or unreadable, so tokens survive across restarts.

## [1.0.6] - 2026-06-25

### Fixed

- `saveSecret` no longer bails out early on macOS when
  `safeStorage.isEncryptionAvailable()` returns `false`. On macOS 26 (Tahoe)
  the API can incorrectly return `false` even though `encryptString()` still
  succeeds; the early-exit check meant tokens pasted into Source 3 were never
  written and the "Credentials not saved" error was shown on every Save. The
  guard is now Linux-only (where no keyring daemon genuinely prevents
  encryption). The existing try/catch handles failures on all platforms.

## [1.0.5] - 2026-06-25

### Fixed

- `saveSecret` in `credentials.ts` now catches exceptions from
  `safeStorage.encryptString()` and returns `{ ok: false }` instead of
  propagating. On macOS 26 (Tahoe) and unsigned dev builds, Keychain access can
  be denied at the call site even when `isEncryptionAvailable()` returns true;
  the unhandled exception was silently aborting `handleSave` in the renderer,
  leaving the Save button in a stuck loading state so the user would force-quit
  before the token was written.
- `handleSave` in `SettingsView.tsx` now wraps all IPC calls in a try-catch so
  any unexpected rejection surfaces as a visible error banner rather than
  silently breaking the save flow.
- Updated the "credentials not saved" error message to mention both macOS
  Keychain and Linux keyring — the old message only mentioned Linux tools.

## [1.0.4] - 2026-06-24

### Fixed

- Query keys used by `useConfig()` and `useCredentialStatus()` are now exported
  constants (`CONFIG_QUERY_KEY`, `CRED_STATUS_QUERY_KEY`) in `settings/api.ts`.
  `SettingsView` imports and uses the same constants for `invalidateQueries`,
  eliminating any risk of future key drift. Unit tests added to lock the values.

### Added

- `e2e/first-run.spec.ts`: Playwright tests covering the unconfigured first-run
  flow — settings screen appears automatically, Cancel is absent, and Save with
  a YouTrack URL navigates to the main board.
- `VERMILIAN_E2E_UNCONFIGURED=1` env flag for e2e tests that need to exercise
  the app in an unconfigured state without the normal URL seed.
- `CLAUDE.md` at project root documenting the release checklist, testing
  requirements, and query-key conventions.

## [1.0.3] - 2026-06-24

### Fixed

- Saving credentials on first-run now correctly returns to the main app.
  `App.tsx` was registering its own React Query entries under different keys
  (`['appConfig']`, `['credentialStatus']`) than the ones `SettingsView`
  invalidated on save (`['config']`, `['cred-status']`). The mismatch meant
  the `connected` flag never updated after save, leaving the settings screen
  open until the 60-second stale timer expired. `App.tsx` now consumes the
  shared `useConfig()` / `useCredentialStatus()` hooks so all components
  share the same cache entries.

## [1.0.2] - 2026-06-24

### Fixed

- First-run settings screen now shows an informative banner explaining that a
  YouTrack URL and token are required to get started, so it is clear why
  Settings opened automatically on launch.
- The quit button in the settings footer is labelled "Quit Vermilian" when the
  app is unconfigured, distinguishing it from "Cancel" (close Settings) and
  avoiding confusion with a standard dialog dismiss action.
- Saving credentials on first run now always dismisses the Settings screen
  immediately rather than waiting for a background query refetch.

## [1.0.1] - 2026-06-24

### Fixed

- Packaged app crashed on launch with "Failed to load image from path
  `.../app.asar/build/icon.png`". The icon file was not bundled inside the asar.
  `build/icon.png` is now shipped as an `extraResource` (copied to
  `Contents/Resources/` alongside the asar) and the `BrowserWindow` icon path
  uses `process.resourcesPath` to find it at runtime.
- Removed a redundant `app.dock.setIcon()` call; macOS uses the bundled
  `.icns` automatically and the programmatic call referenced the same missing
  path.

## [1.0.0] - 2026-06-24

First public release. Vermilian is feature-complete against its specification.

### Added

- monday.com-style task board (table + Kanban) with grouping, filtering, and sorting.
- Task detail panel with inline field editing.
- Pomodoro focus timer: state machine, focus-mode lock, quit protection,
  crash-recovery checkpointing, and an automatic YouTrack worklog on stop.
- Layered credential sources — read the YouTrack token from a shell command,
  a file path, or the OS keyring.
- Light and dark themes.
- AI and daily stand-up flows.
- Distribution: Linux x86_64 AppImage, Apple Silicon macOS `.dmg` (Homebrew Cask),
  and a Windows Squirrel installer (Scoop), published from a tag-driven GitHub
  Actions release workflow. Intel macOS and arm64 Linux build from source.

### Notes

- The macOS `.dmg` is not yet notarized with an Apple Developer ID. Gatekeeper
  warns on first launch; the Homebrew Cask clears the quarantine flag, or run
  `xattr -dr com.apple.quarantine /Applications/Vermilian.app` for the manual `.dmg`.

[Unreleased]: https://github.com/kevinpinscoe/vermilian/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.3.0
[1.2.10]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.10
[1.2.9]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.9
[1.2.8]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.8
[1.2.7]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.7
[1.2.6]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.6
[1.2.5]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.5
[1.2.4]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.4
[1.2.3]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.3
[1.2.2]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.2
[1.2.1]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.1
[1.2.0]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.2.0
[1.1.3]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.1.3
[1.1.2]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.1.2
[1.1.1]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.1.1
[1.1.0]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.1.0
[1.0.4]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.4
[1.0.3]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.3
[1.0.2]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.2
[1.0.1]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.1
[1.0.0]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.0
