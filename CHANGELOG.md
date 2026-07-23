# Changelog

All notable changes to Vermilian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
