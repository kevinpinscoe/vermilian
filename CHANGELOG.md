# Changelog

All notable changes to Vermilian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.3]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.3
[1.0.2]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.2
[1.0.1]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.1
[1.0.0]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.0
