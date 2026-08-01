# TODO

This file tracks planned public work for Vermilian. Items here are intentionally high level until
they are promoted into a full feature spec, issue, or pull request.

## In flight

- **[PR #43 — `feat(fields)`: add Issue domain, Edit host, Affected host; fix two stale option
  lists](https://github.com/kevinpinscoe/vermilian/pull/43)** — branch
  `feat/host-and-domain-fields`. Registers the three custom fields added to YouTrack on
  2026-08-01, and fixes two option lists that had drifted from the live bundles: `Project health`
  still offered `Yellow` after the live value was renamed to `Amber` (so the field could not be
  set at all), and `Status` offered `Working on it`, which does not exist, while omitting
  `Backlog` and `Scheduled`, which do. Both were write failures, not cosmetic.
  Typecheck clean, 179/179 tests pass.
  **The schema-drift items below were raised by this PR and are on its branch** — they land on
  `main` only when it merges.

## Planned features

### Task effort estimating

Add first-class effort estimates to tasks so Vermilian can show planned work beside actual worklog
time from the timer.

- [ ] Identify the YouTrack field strategy for estimates.
  - Preferred: use an existing YouTrack custom field when available.
  - Fallback: document the expected field name and type for new installs.
- [ ] Add estimate display to task rows, cards, and the task detail panel.
- [ ] Support inline editing for task estimates from the main table view.
- [ ] Show estimate vs. logged time in task detail.
- [ ] Add validation for empty, zero, and unusually large estimates.
- [ ] Preserve YouTrack as the source of truth; Vermilian should not maintain a separate estimate
      store unless YouTrack lacks a compatible field.
- [ ] Add tests for parsing, formatting, optimistic update, rollback, and display states.

Acceptance criteria:

- [ ] A user can view and edit a task estimate without leaving Vermilian.
- [ ] Estimate changes are written back to YouTrack and survive refresh/restart.
- [ ] Logged focus time and planned estimate are visible together on a task.
- [ ] API failures keep the previous estimate and show a clear error.

### Bento effort view for projects

Add a project-level effort dashboard using a Bento-style layout: compact tiles that summarize
estimate, logged time, remaining work, and risk signals for the selected project.

- [ ] Add an `Effort` view tab beside the existing project board views.
- [ ] Design responsive Bento tiles for the primary effort metrics:
  - Total estimated effort.
  - Total logged time.
  - Remaining estimated effort.
  - Over-estimate / under-estimate variance.
  - Tasks without estimates.
  - High-priority remaining work.
- [ ] Add grouped breakdowns by Status, Priority, Category, and Due Date bucket.
- [ ] Add task drill-down from each tile to the filtered board view.
- [ ] Include an empty state for projects without tasks or without estimates.
- [ ] Make the view work with cached issue data and refresh when the project board refreshes.
- [ ] Add tests for aggregation, filtering handoff, empty states, and responsive layout.

Acceptance criteria:

- [ ] A user can open a project and understand total planned effort at a glance.
- [ ] Tiles use the current project's task data only.
- [ ] Clicking a tile takes the user to the relevant task subset.
- [ ] The layout remains readable on desktop and narrow windows.
- [ ] Missing estimates are visible enough to support cleanup before planning.

## Known issues

### Validate the YouTrack token at startup, not just its presence

The root cause — `connected` never validating the token — is untouched. Fixing it means a startup
network call with careful offline handling, and deserves its own change.

Context: `App.tsx` decides between `SettingsView` and `AppShell` on
`Boolean(youtrackUrl) && Boolean(hasYouTrackToken)`, where `hasYouTrackToken` only reports whether a
credential *file exists*. A token that is present but rejected therefore reads as connected, so the
app opens the board instead of Settings. This is what happened when the YouTrack instance was
rebuilt on 2026-07-29: every call returned 401, the board was empty, and the only Settings button
lived in the left rail — which renders YouTrack-derived data and had itself failed. Recovery meant
deleting `~/.config/Vermilian/credentials/youtrack.token.bin` by hand.

v1.2.7 added the escape hatches (a top-bar Settings gear that depends on no remote data, and a
connection banner offering Open Settings / Retry), so the user is no longer stranded. This item is
about removing the underlying cause rather than routing around it.

- [ ] Decide where validation belongs — startup only, or on every transition into `AppShell`.
- [ ] Add a lightweight verification call (`getCurrentUser` is already used by Settings' Test
      Connection and is cheap) behind the `connected` check.
- [ ] Distinguish "token rejected" from "host unreachable": a revoked token should route to
      `SettingsView`, but a transient network failure or an offline laptop must **not** — otherwise
      working offline throws the user into a setup screen they cannot complete.
- [ ] Decide the offline behaviour explicitly: cached-but-unverified should still reach the board,
      with the existing connection banner carrying the warning.
- [ ] Keep startup responsive — do not block first paint on the network; validate in the background
      and route once the result lands.
- [ ] Add tests: valid token, revoked token (401), unreachable host, and slow/timing-out host.

Acceptance criteria:

- [ ] A revoked token lands the user in Settings automatically, without deleting files by hand.
- [ ] Going offline with a valid token does not eject the user into the setup screen.
- [ ] Startup is not visibly slower when the network is slow or unavailable.

### Detect YouTrack schema drift instead of discovering it on a failed write

`FIELD_DEFS` (`app/src/shared/fields.ts`) is an **allowlist**, and every `options:` list is a
hand-maintained copy of a YouTrack bundle. Nothing checks either against the live instance, so
drift is invisible until a user picks a value and the write fails with *"An X-type entity with the
specified name ({1}) was not found"*.

That is not hypothetical — three separate instances of it are already on record:

| Drift | Discovered |
|---|---|
| `Category` and `Notes` had the wrong `$type` | BUG-005 |
| `Project health` offered `Yellow` after the live value was renamed to `Amber` | 2026-08-01 — the field could not be set at all |
| `Status` offered `Working on it` (not a live value) and omitted `Backlog` / `Scheduled` | 2026-08-01 |

The instance had **32** custom fields while Vermilian knew **24**. The gap itself is fine — the
board query is a wildcard, so unknown fields are ignored — but nothing surfaced it.

- [ ] Add a script or test that reads the live bundles and diffs them against `FIELD_DEFS`
      (`$type`, and each `options:` list). Every list now carries its bundle id and the date it
      was verified, which is what makes this mechanical.
- [ ] Decide where it runs — a dev-only script, a CI job with a reachable instance, or an in-app
      Settings diagnostic. The instance is tailnet-only, so CI cannot reach it without help.
- [ ] Decide the failure mode for a field present in YouTrack but absent from `FIELD_DEFS`.
      Ignoring it is correct today; surfacing it somewhere is better than silence.

Acceptance criteria:

- [ ] A renamed bundle value or changed `$type` is reported before a user hits it.
- [ ] A field added to YouTrack is reported as "known to the instance, unknown to Vermilian".

### `Affected host` values must track the k-fed service catalog

`AFFECTED_HOST_VALUES` mirrors the service catalog's Fleet Hosts table one-for-one. The catalog is
the source of truth; this list is a copy, and a host added to the fleet must be added here too.

Adding a k-fed host now touches **four** value lists across two repos — this one, plus three in
`youtrack.kevininscoe.com` (`docs/custom-fields.md`, `scripts/add-host-and-domain-fields/apply.py`,
and `migrate.py`'s `FALLBACK_BUNDLE_VALUES`). `~/ai/directives/when-adding-a-host-to-the-kfed.md`
Step 8 covers the other three but does **not** mention Vermilian.

- [ ] Either add Vermilian to that directive's Step 8, or fold this list into the drift check above
      so a missing host is reported rather than remembered.

### Housekeeping found 2026-08-01

- [ ] `fields.ts`'s header comment points at `spec/features/field-registry.md`, which does not
      exist. Either write it or drop the reference.
- [ ] `spec/features/workspace-navigation.md:48` and `spec/features/board-configuration.md:37,68`
      use `Working on it` in colour-config examples. It is not a real status value — harmless as
      illustration, misleading as a sample to copy.
- [ ] BUG-005 is listed as open in the sibling `youtrack.kevininscoe.com` repo's `TODO.md`, but
      `fields.ts` carries comments saying both `$type`s were corrected. Confirm and close it there.

## Follow-up specs

- [ ] Create `spec/features/task-effort-estimates.md`.
- [ ] Create `spec/features/project-effort-bento-view.md`.
- [ ] Add matching design wireframes under `docs/design/`.
- [ ] Update `README.md` highlights after the features ship.
- [ ] Add screenshots after the views are implemented.

## Notes for contributors

- **Vermilian is one of five consumers of that YouTrack instance**, and the only one with an
  explicit field allowlist — so it is the one that breaks quietly when the schema moves. The
  others (two byte-identical skill collections, a CLI tool, a backup check) all use wildcard
  queries filtered by field name. The full inventory, with coupling notes, is in the
  `youtrack.kevininscoe.com` repo's `README.md` and `RUNBOOK.md`; that repo's `docs/custom-fields.md`
  is the live field reference and the place to check `$type` and bundle values before editing
  `FIELD_DEFS`.
- Keep YouTrack as the backend and source of truth.
- Match the existing monday.com-style density and Vibe component usage.
- Prefer focused pull requests: estimate storage/editing first, project aggregation second, visual
  polish after the data path is proven.
