# Vermilian — Claude Code Instructions

## Testing requirements

**All code changes must be tested before release. Do not tag a release without running tests first.**

- Run unit tests: `cd app && pnpm test`
- E2e tests require a packaged build: `cd app && pnpm test:e2e`
- Unit tests must pass before every commit that touches `src/`.
- When fixing a bug, add a test that would have caught it before writing the fix.

## Release checklist

Before tagging any version (`git tag -a vX.Y.Z`):

1. `cd app && pnpm test` — all unit tests green
2. Bump `app/package.json` version to match the tag
3. Add a `CHANGELOG.md` entry (Keep a Changelog format) — required for every release including patches
4. Commit version bump + changelog together, then tag

## Query cache keys

All React Query cache keys are defined as exported constants in
`src/renderer/features/settings/api.ts` (`CONFIG_QUERY_KEY`, `CRED_STATUS_QUERY_KEY`).
Import them everywhere — never use inline string arrays for these keys.
A mismatch between what hooks register and what `invalidateQueries` uses will
silently break cache invalidation (this caused a first-run settings bug in v1.0.3).

## Project layout

- `app/` — Electron app (Vite + Electron Forge)
  - `src/main/` — main process (Node/Electron)
  - `src/renderer/` — renderer process (React)
  - `src/shared/` — types and pure logic shared between both
  - `e2e/` — Playwright end-to-end tests
- `cli/` — CLI tooling
- `spec/` — top-level specs
