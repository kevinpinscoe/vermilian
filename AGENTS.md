# Repository Guidelines

## Project Structure & Module Organization

Vermilian is an Electron desktop app for YouTrack. The application lives in `app/`: `src/main/` contains Electron main-process code, `src/preload.ts` exposes IPC, `src/renderer/` contains React UI, and `src/shared/` holds cross-process types and utilities. Renderer features are grouped under `app/src/renderer/features/<feature>/`, with CSS modules beside their components. Unit tests sit next to the code as `*.test.ts`; Playwright E2E specs live in `app/e2e/`. Product specs are in `spec/features/`, ADRs in `docs/adr/`, diagrams in `docs/architecture/` and `docs/design/`, and screenshots in `docs/screenshots/`.

## Build, Test, and Development Commands

Use the pinned toolchain: `mise install`, then `corepack enable pnpm`. In new shells, ensure Node 24 is on `PATH` as documented in `README.md`.

Run commands from `app/`:

- `pnpm install` installs dependencies from `pnpm-lock.yaml`.
- `pnpm start` launches Electron Forge with Vite HMR.
- `pnpm lint` runs ESLint over TypeScript and TSX.
- `pnpm test` or `pnpm test:unit` runs Vitest once.
- `pnpm test:watch` runs Vitest in watch mode.
- `pnpm test:e2e` packages the app if needed, then runs Playwright.
- `pnpm package` builds an Electron package without publishing.
- `./node_modules/.bin/tsc --noEmit` performs a type-check only pass.

## Coding Style & Naming Conventions

Use TypeScript for app code and React function components for renderer UI. Follow existing naming: components and stores use `PascalCase.tsx` or descriptive `camelCase.ts`; CSS modules use `ComponentName.module.css`. Keep feature-specific code inside its feature directory and move only reusable contracts/utilities to `src/shared/`. ESLint is the source of formatting and import hygiene; run `pnpm lint` before submitting.

## Testing Guidelines

Prefer focused unit tests beside the implementation (`colors.test.ts`, `workspace.test.ts`). Use Vitest for pure logic, stores, API transforms, and IPC-safe utilities. Use Playwright specs in `app/e2e/` for workflows spanning windows, renderer state, settings, timer, search, and packaged Electron behavior. Update screenshots or coverage notes only when the UI behavior intentionally changes.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `fix:`, `docs:`, `ci:`, `chore:`, and `build(deps):`. Keep commits narrow and signed when landing on `main`. For changes touching `app/src/`, create a branch such as `feat/<slug>` or `fix/<short-description>` and open a PR. PRs should describe the change, list validation commands, link related issues/specs, include screenshots for UI changes, and note any AI-assisted content when applicable.
