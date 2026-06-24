# vermilian

> **V**alidate **E**stimates, **R**equirements, and **M**ilestones; **I**dentify, **L**og **I**ssues, **A**ssign **N**ext steps.

An Electron desktop application that provides an enhanced frontend for a self-hosted [JetBrains YouTrack](https://www.jetbrains.com/youtrack/) instance.

## Status

**v1.0.0 — first public release.** Vermilian is feature-complete against its specification and
available from [GitHub Releases](https://github.com/kevinpinscoe/vermilian/releases) and package
managers (see [Installation](#installation)).

- **Built and working:** the monday.com-style task board (table + Kanban) with grouping, filtering,
  and sorting; the task detail panel with inline field editing; the full Pomodoro focus timer
  (state machine, focus-mode lock, quit protection, crash-recovery checkpointing, and an automatic
  YouTrack worklog on stop); the AI and daily stand-up flows; layered credential storage; and
  light/dark themes.
- **Tested:** unit tests cover the core logic (including 28 for the timer state machine), with an
  end-to-end (Playwright) suite over the board, detail panel, settings, timer, AI, and stand-up
  flows. Verified on Linux (Fedora 42); the macOS and Windows builds are published but less
  extensively exercised.

## What it is

Vermilian is a cross-platform desktop app that connects to your self-hosted YouTrack via its REST API and provides a focused, opinionated interface for daily task and project management. YouTrack is the backend and source of truth; Vermilian is the client.

## Installation

Each release is published to [GitHub Releases](https://github.com/kevinpinscoe/vermilian/releases)
and to a package manager per platform. Pick your platform below.

### Linux — AppImage

Download `Vermilian-*-x86_64.AppImage` from the [latest release](https://github.com/kevinpinscoe/vermilian/releases/latest), then:

```bash
chmod +x Vermilian-*-x86_64.AppImage
./Vermilian-*-x86_64.AppImage
```

An AppImage is one self-contained file that runs on any modern x86_64 distribution — no install
step. For a desktop menu entry, use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher).

> **Raspberry Pi (arm64):** the x86_64 AppImage will not run on a Pi. Build a native arm64 AppImage
> on a 64-bit Pi yourself — see [Target platforms](#target-platforms).

### macOS — Homebrew Cask

Requires [Homebrew](https://brew.sh). Add the tap once, then install the Cask:

```bash
brew tap kevinpinscoe/tap                 # add the tap (one time)
brew install --cask vermilian             # install Vermilian.app into /Applications

# later:
brew upgrade --cask vermilian             # update to the newest release
brew uninstall --cask vermilian           # remove
```

The tap + Cask in one line also works: `brew install --cask kevinpinscoe/tap/vermilian`.

Prefer a manual install? Download the universal `.dmg` (Intel + Apple Silicon) from the release and
drag **Vermilian** to Applications.

> **Unsigned build:** Vermilian is not yet notarized with an Apple Developer ID, so Gatekeeper
> reports that the app "cannot be opened" or "is damaged." The Homebrew Cask clears the quarantine
> flag for you automatically. For the manual `.dmg`, run this once after dragging it in:
> ```bash
> xattr -dr com.apple.quarantine /Applications/Vermilian.app
> ```

### Windows — Scoop

Requires [Scoop](https://scoop.sh). Add the bucket once, then install:

```powershell
scoop bucket add kevinpinscoe https://github.com/kevinpinscoe/scoop-bucket   # add the bucket (one time)
scoop install vermilian                                                       # install

# later:
scoop update vermilian                                                        # update to the newest release
scoop uninstall vermilian                                                     # remove
```

Prefer a manual install? Download and run the Squirrel `Vermilian-*Setup.exe` from the release.

## Highlights

These are the features that shape Vermilian. They are built and working; the app is feature-complete
against its spec and shipping as of v1.0.0 (see [Status](#status)):

- **Pomodoro focus timer** — a single-task focus tool built around ADHD work patterns. Running
  a timer puts the app into a focus mode; stopping it logs the elapsed minutes as a YouTrack
  work item. Defaults to Pomodoro cycles (25-minute work blocks, breaks, long break every four),
  with an open-ended mode as well.
- **monday.com-style board** — a high-density task board with colour-coded status, priority, and
  category chips, grouping, filtering, and sorting; table and Kanban views.
- **Layered credential sources** — read your YouTrack token from a shell command (e.g. a secrets
  manager), a file path, or the OS keyring — whichever fits your setup.
- **Cross-platform desktop** — Linux (x86_64 AppImage), macOS (universal `.dmg`, Intel + Apple
  Silicon), and Windows. A Raspberry Pi / arm64 AppImage can be built from source (see
  [Target platforms](#target-platforms)).

## Screenshots

> Captured against built-in demo data — no real YouTrack instance required.

**Task board** — grouped by status, with priority and category chips:

![Vermilian task board, light theme](docs/screenshots/board-light.png)

**Dark theme:**

![Vermilian task board, dark theme](docs/screenshots/board-dark.png)

**Task detail panel** — inline field editing and a built-in Pomodoro timer:

![Vermilian task detail panel](docs/screenshots/task-detail.png)

**Pomodoro focus timer** — focus mode with a work-block countdown; stopping logs a YouTrack worklog:

![Vermilian Pomodoro focus timer](docs/screenshots/timer-focus.png)

**Settings** — the Connection section, with layered credential sources (shell command, file path, or OS keyring):

![Vermilian settings — connection](docs/screenshots/settings.png)

## Target platforms

| Platform | Artifact | Architecture | v1.0.0 |
|---|---|---|---|
| Linux (Fedora / Ubuntu) | AppImage | x86_64 | published |
| macOS | `.dmg` (universal) | x86_64 + Apple Silicon | published |
| Windows 11 | Squirrel installer + Scoop | x86_64 | published |
| Raspberry Pi OS | AppImage | arm64 (64-bit only) | build from source |

A Raspberry Pi (arm64) AppImage is not yet produced by CI. Build it natively on a 64-bit Pi:

```bash
cd app
mise install && corepack enable pnpm
pnpm install
pnpm make            # → app/out/make/Vermilian-<ver>-arm64.AppImage
```

Automated arm64 builds (via a `ubuntu-24.04-arm` CI runner) are planned for a follow-up release.

## Tech stack

| Layer | Choice |
|---|---|
| App shell | Electron (electron-forge) |
| UI framework | React 18 + TypeScript |
| Design system | [monday.com Vibe](https://style.monday.com) — React component library for monday.com-style UI |
| Package manager | pnpm |
| Diagramming | D2, Mermaid (Kroki) |

## Local development

The app lives in `app/`. The toolchain is pinned by `mise.toml` (Node 24.15.0); **pnpm comes from corepack**, not the system. Neither is active in a stock non-interactive shell, so each session needs the mise node bin on `PATH`:

```bash
# one-time
mise trust                 # trust the pinned mise.toml
mise install               # install Node 24.15.0
corepack enable pnpm       # enable pnpm 11 (uses the mise node)

# every session
export PATH="$HOME/.local/share/mise/installs/node/24.15.0/bin:$PATH"
```

Then, from `app/`:

```bash
pnpm install
pnpm start                       # run app in development (Electron + Vite HMR)
pnpm lint                        # ESLint
pnpm package                     # electron-forge bundle (no GUI needed)
./node_modules/.bin/tsc --noEmit # type-check only
```

System `/usr/bin/node` on Fedora is v22 — too old. Always use the mise-managed v24.

**pnpm 11.5 config gotcha:** `block-exotic-subdeps=false` in `app/.npmrc` is silently ignored by pnpm 11.5+ and `pnpm add` fails with `ERR_PNPM_EXOTIC_SUBDEP` on `@electron/rebuild`'s git subdep. The canonical form is `blockExoticSubdeps: false` in `app/pnpm-workspace.yaml`, mirroring how `nodeLinker` is configured there. The `.npmrc` line is kept as a legacy marker.

## Look and feel

Vermilian targets a **monday.com-style** visual experience: high-density boards, strong colour-coded status and priority chips, left-rail navigation, and inline editing without full-page reloads. The [monday.com Vibe Design System](https://style.monday.com) provides the React component library, theming tokens, and accessibility guidelines used throughout the app.

## Tuning dark mode colours

Theme colours are defined in `app/src/renderer/theme.ts`. Two independent palettes let the left nav and the main board have different text colours:

| Variable | Where it applies |
|---|---|
| `--nav-header-text-color` | Left rail — workspace name, "All tasks" link |
| `--nav-primary-text-color` | Left rail — project names |
| `--nav-secondary-text-color` | Left rail — folder names, issue-count badges |
| `--primary-text-color` | Board — task titles, column headers |
| `--secondary-text-color` | Board — issue IDs, secondary labels |

To tune colours live without editing source, use the Electron DevTools colour picker:

1. Run the app (`pnpm start` from `app/`).
2. Press **Cmd+Option+I** (macOS) or **Ctrl+Shift+I** (Linux/Windows) to open DevTools.
3. In the **Elements** panel, find `<style id="vermilian-theme-overrides">`.
4. Click any hex colour value — the browser's built-in colour picker opens.
5. Adjust until satisfied, then copy the final hex values back into `DARK_PALETTE` in `theme.ts`.

## Development approach

Vermilian is built spec-first using **Spec Driven Design (SDD)**. Feature specs in `spec/features/` define what the app must do before any code is written. Claude Code implements against those specs.

See [spec/README.md](spec/README.md) for the full SDD workflow.

## Phases

| Phase | Goal |
|---|---|
| 0 | Dev environment — tools installed, YouTrack API verified |
| 1 | SDD design — specs, wireframes, ADRs, API contracts |
| 2 | Coding — implement from specs |
| 3 | Testing — unit + E2E tests, cross-platform smoke tests |
| 4 | Public release — GitHub migration, CI/CD, first versioned release |

## Implementation notes — current increment

Phase 2 increment 1 (Foundation + Settings) is shipped but has a few known deviations from the specs/wireframes that will be cleaned up in follow-up work:

- **Confirmations are inline `AttentionBox` panels**, not Vibe `Modal` / `AlertDialog`. The Reset-to-defaults confirm is implemented; the **Cancel-with-unsaved-credentials confirm is not yet** (Cancel currently discards immediately).
- **Test connection messages** show the raw API error string rather than the friendly 401-vs-network strings the Settings spec calls for (e.g. *"Invalid token or insufficient permissions."*).
- **Theme switching** toggles `light-app-theme` / `dark-app-theme` classes on the app root div. These are the standard Vibe theme classes, but the visual switch has not been confirmed in a graphical session yet.
- **`blockExoticSubdeps` config moved** (see Local development above) — `app/.npmrc` keeps the legacy entry for older pnpm; pnpm 11.5+ requires the canonical form in `app/pnpm-workspace.yaml`.

## Repository Layout

```
vermilian/
├── app/                    # Electron app root (electron-forge, Vite, React 18, Vibe)
│   ├── src/
│   │   ├── main/           # Electron main process modules
│   │   ├── renderer/       # React renderer — components, hooks, stores, API client
│   │   ├── shared/         # Types and utilities shared across processes
│   │   ├── main.ts         # Electron main process entry
│   │   ├── preload.ts      # Electron preload (contextBridge IPC)
│   │   └── renderer.tsx    # React app entry — mounts <App>
│   ├── forge.config.ts     # electron-forge config
│   ├── vite.*.config.ts    # per-process Vite configs
│   ├── pnpm-workspace.yaml # pnpm compat settings (must not be removed)
│   └── package.json
├── spec/
│   ├── features/           # authoritative feature specs (SDD workflow)
│   └── phases/             # phase-level specs with exit criteria
├── docs/
│   ├── adr/                # Architecture Decision Records
│   ├── architecture/       # D2 component diagrams
│   ├── design/             # D2 / Mermaid UI wireframes
│   └── requirements.md
├── cli/YouTrack/           # planned Go CLI (in progress)
├── mise.toml               # Node 24.15.0 toolchain pin
├── CONTRIBUTING.md
├── LICENSE
├── README.md
└── RUNBOOK.md
```

## Documentation

- [Requirements](docs/requirements.md)
- [SDD specs](spec/README.md)
- [Architecture diagrams](docs/architecture/README.md)
- [UI wireframes](docs/design/README.md)
- [Architecture Decision Records](docs/adr/README.md)

## App icon

The default Electron icon can be replaced by dropping three files into `app/build/` and updating the forge config.

### Image requirements

| Platform | Format | Minimum size |
|---|---|---|
| macOS | `.icns` | 1024×1024 source |
| Windows | `.ico` | 256×256 source (multi-resolution container) |
| Linux | `.png` | 512×512 (1024×1024 recommended) |

Start with a single 1024×1024 PNG and convert to the platform formats. Tools: [Iconset](https://iconset.io) (macOS app), `icotool` (Linux CLI), or the npm package `electron-icon-maker`.

### Wiring it up

**1.** Place the files:

```
app/build/
  icon.icns
  icon.ico
  icon.png
```

**2.** Update `app/forge.config.ts`:

```ts
packagerConfig: {
  asar: true,
  icon: './build/icon',   // no extension — forge picks the right format per platform
},
// ...
new MakerDMG({ icon: './build/icon.icns' }, ['darwin']),
new MakerAppImage({ options: { icon: './build/icon.png' } }, ['linux']),
```

**3.** Set the runtime window icon in `app/src/main/window.ts` (shown in the taskbar/dock while the app is running, independently of the packaged installer icon):

```ts
new BrowserWindow({
  icon: path.join(__dirname, '../build/icon.png'),
  // ...
})
```

`pnpm start` picks up the window icon immediately; `pnpm make` bakes it into the installer packages.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the PR workflow and diagram conventions.

## License

Copyright © Kevin P. Inscoe.

Vermilian is licensed under the **GNU General Public License v3.0 only** (`GPL-3.0-only`).
You may use, study, share, and modify it under the terms of that license; distributed
modifications must also be released under the GPL-3.0. See the [LICENSE](LICENSE) file for
the full text, or <https://www.gnu.org/licenses/gpl-3.0.html>.
