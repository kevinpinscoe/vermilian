# RUNBOOK.md — Vermilian

## Metadata

| Field | Value |
|---|---|
| **Owner** | Kevin P. Inscoe |
| **Last Updated** | 2026-05-22 |
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
|---|---|
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
```
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

Output artifacts land in `app/out/make/`. On Fedora: `.deb` and `.rpm`.

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

## Verification

```bash
pnpm start
```

**Success criteria:** Electron window opens with "Vermilian — YouTrack desktop client" text; no errors in the DevTools console; Vite HMR active (editing `src/App.tsx` reloads the window without restart).

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
|---|---|---|
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
|---|---|---|---|
| `block-exotic-subdeps` | `app/.npmrc` | `false` | `@electron/rebuild` has a git-URL subdependency (`@electron/node-gyp`) that pnpm 11 blocks by default |
| `nodeLinker` | `app/pnpm-workspace.yaml` | `hoisted` | electron-forge requires flat `node_modules`; pnpm 11's default isolated linker breaks module resolution at runtime |
| `allowBuilds.esbuild` / `allowBuilds.electron-winstaller` | `app/pnpm-workspace.yaml` | `true` | pnpm 11 blocks install-time build scripts by default; both packages need them |

**Initial scaffold must use npm**, not pnpm. `pnpm dlx` fails with the exotic-subdep error because `.npmrc` is not in scope during dlx resolution. After the first `npm create electron-app`, all ongoing development uses `pnpm`.
