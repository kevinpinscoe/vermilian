# Repository Guidelines

## Project Structure & Module Organization

Vermilian is an Electron desktop app for YouTrack. Its application code is in `app/`: `src/main/` is the Electron main process, `src/preload.ts` exposes IPC, `src/renderer/` is the React UI, and `src/shared/` contains cross-process types and utilities. Group renderer work in `app/src/renderer/features/<feature>/`; keep CSS modules alongside their components.

Unit tests live beside their code as `*.test.ts`; Playwright end-to-end specs are in `app/e2e/`. Product requirements are in `spec/features/`; ADRs, diagrams, and screenshots live under `docs/`. `cli/YouTrack/` is a planned Go CLI and is not part of the Electron build.

## Build, Test, and Development Commands

Use the pinned Node 24 toolchain: run `mise install`, then `corepack enable pnpm`. Follow the `README.md` instructions to put the mise-managed Node binary on `PATH` in a new shell.

Run these from `app/`:

- `pnpm install` installs locked dependencies.
- `pnpm start` runs Electron Forge with Vite HMR.
- `pnpm lint` checks TypeScript and TSX with ESLint.
- `pnpm typecheck` runs TypeScript without emitting files.
- `pnpm test` runs the Vitest unit suite once; `pnpm test:watch` watches it.
- `pnpm test:e2e` packages when needed and runs Playwright.
- `pnpm package` builds an unpackaged Electron bundle; `pnpm make` creates distributable artifacts.

## Coding Style & Naming Conventions

Write TypeScript and React function components. Use `PascalCase.tsx` for components and stores, descriptive `camelCase.ts` for modules, and `ComponentName.module.css` for CSS modules. Keep feature-specific code local; promote only genuinely reusable contracts and helpers to `src/shared/`. ESLint governs formatting and imports—run `pnpm lint` before submission.

## Testing Guidelines

Add focused Vitest coverage beside changed logic (for example, `colors.test.ts` or `workspace.test.ts`). Use Playwright for workflows crossing windows, renderer state, settings, timers, search, or packaged-app behavior. Update screenshots or coverage notes only for intentional UI changes.

## Commit & Pull Request Guidelines

Use narrow, signed Conventional Commits such as `fix:`, `docs:`, `ci:`, `chore:`, and `build(deps):`. Documentation and small fixes may go directly to `main`; changes under `app/src/` require a branch such as `feat/<slug>` or `fix/<short-description>` and a PR. Complete the PR template: explain the change, list validation, link related issues/specs, include UI screenshots where applicable, and disclose AI assistance.
