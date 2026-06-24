# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `app/`:

```bash
pnpm start              # dev server (Electron + Vite HMR)
pnpm lint               # ESLint over .ts/.tsx
pnpm test               # unit tests (vitest, Node env) — run before every commit
pnpm test:watch         # vitest watch mode
pnpm test:e2e           # e2e tests (packages first if out/ is missing)
pnpm test:e2e:fresh     # force re-package then run e2e
pnpm test:e2e:ui        # Playwright UI mode
```

Run a single unit test file:
```bash
pnpm vitest run src/renderer/features/settings/api.test.ts
```

## Release checklist

Before tagging any `vX.Y.Z`:

1. `pnpm test` — all tests green
2. Bump `app/package.json` `"version"` to match the tag
3. Add a `CHANGELOG.md` entry (Keep a Changelog format) — required for every release, including patches
4. Commit version + changelog together, then `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z`

The CI release workflow fires on tags matching `v[0-9]+.[0-9]+.[0-9]+`, builds all three platforms, and pushes the Homebrew Cask and Scoop manifest automatically.

## Architecture

Vermilian is a standard Electron app using Vite + Electron Forge. The key constraint is the **process boundary**: the renderer cannot call Node/Electron APIs directly.

### Process boundary and IPC

```
renderer (React)  →  window.vermilian.*  →  preload (contextBridge)  →  ipcMain handlers  →  main process services
```

- `src/shared/ipc.ts` — typed `IPC` channel name map and the full `VermilianAPI` interface. This is the contract for every call that crosses the boundary.
- `src/preload.ts` — exposes `window.vermilian` via `contextBridge`. **Never leak `ipcRenderer` itself to the renderer.**
- `src/main/ipc.ts` — registers all `ipcMain.handle()` handlers. The single place where IPC names map to main-process logic.

### Main process (`src/main/`)

- `services/config.ts` — reads/writes `userData/app-config.json`. Under `VERMILIAN_E2E=1` seeds a fake `youtrackUrl` unless `VERMILIAN_E2E_UNCONFIGURED=1` is also set.
- `services/credentials.ts` — three-source priority chain for secrets: (1) shell command, (2) file path, (3) Electron `safeStorage`. Always use `loadSecretWithSources()` / `hasSecretWithSources()` — never the bare `loadSecret()`.
- `api/` — YouTrack REST client, Claude API calls, AI extraction, fake YouTrack stub for e2e.

### Renderer (`src/renderer/`)

- `App.tsx` — top-level router: shows `SettingsView` when unconfigured (`!youtrackUrl || !hasYouTrackToken`) or when `showSettings` is true; otherwise shows `AppShell`. Uses `useConfig()` / `useCredentialStatus()` from `settings/api.ts`.
- `AppShell.tsx` — the main chrome: top bar, workspace nav rail, board area, all modal overlays (create task, AI create, stand-up, timer conflict, quit-protection).
- `features/` — self-contained feature slices, each with its own components, hooks, and local state.
- `stores/` — Zustand stores for cross-feature state: `timer`, `workspace` (active project/workspace), `toast`, `theme`.

### React Query cache keys

All cache key arrays are exported constants from `src/renderer/features/settings/api.ts`:

```ts
CONFIG_QUERY_KEY       // ['config']
CRED_STATUS_QUERY_KEY  // ['cred-status']
```

Import these everywhere. Never write inline `['config']` strings. A mismatch between what hooks register and what `invalidateQueries` uses silently breaks cache invalidation (this was the v1.0.3 bug).

### Shared (`src/shared/`)

Pure TypeScript — no Electron, no React. Safe to import in either process or in unit tests.

- `ipc.ts` — IPC channel names + all request/response types
- `config.ts` — `AppConfig` type and `DEFAULT_CONFIG`
- `workspace.ts` — `BoardIssue`, `YouTrackProject`, `VermilianConfig`

### Testing

**Unit tests** (vitest, `src/**/*.test.ts`) run in a plain Node environment — no DOM, no Electron. They cover pure logic only: board grouping/sorting/filtering, timer state machine, error message formatting, API transforms, query key constants. Use fixture factory functions to build test data.

**E2e tests** (Playwright, `e2e/*.spec.ts`) run against the packaged Electron binary in `out/`. Each test gets a fresh `--user-data-dir` temp directory. `VERMILIAN_E2E=1` activates the in-memory fake YouTrack and injects mock credentials. Use `launchApp()` for a pre-seeded connected state; use `launchAppUnconfigured()` to test the first-run settings flow.

When fixing a bug, write the test first, confirm it fails, then fix and confirm it passes.

### E2e fake backend

`VERMILIAN_E2E=1` enables an in-memory YouTrack stub (`src/main/api/fakeYouTrack.ts`) with deterministic fixture data. The main process IPC handlers return fake tokens and mock credential status automatically. The renderer sees a fully connected app without any real network calls.
