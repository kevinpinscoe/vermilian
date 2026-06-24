# Changelog

All notable changes to Vermilian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Distribution: Linux AppImage, universal macOS `.dmg` (Homebrew Cask), and a
  Windows Squirrel installer (Scoop), published from a tag-driven GitHub Actions
  release workflow.

### Notes

- The macOS `.dmg` is not yet notarized with an Apple Developer ID. Gatekeeper
  warns on first launch; the Homebrew Cask clears the quarantine flag, or run
  `xattr -dr com.apple.quarantine /Applications/Vermilian.app` for the manual `.dmg`.

[1.0.0]: https://github.com/kevinpinscoe/vermilian/releases/tag/v1.0.0
