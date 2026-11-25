#!/usr/bin/env bash
# Packages the e2e build that pnpm test:e2e and test:e2e:fresh run against
# (VERM-106): VERMILIAN_E2E_BUILD=1 compiles in the e2e process recorder and
# its debug methods, which a release package (plain `pnpm package`) does not
# contain. It always packages, so an out/ left by `pnpm package` is never
# mistaken for an e2e build.
#
# With --release it packages without the flag instead, exactly as a release
# is built, for pnpm test:release-isolation (the check that a release package
# has no recorder).
#
# Refuses to run where out/ already holds the pinned human-acceptance build
# (docs/priority-desk-acceptance.md → "Acceptance build"), as
# e2e-live/package-dev-build.sh does: packaging there would overwrite the
# binary Kevin is testing. Run the suite in a separate worktree instead.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PINNED_ASAR_SHA256=44d4ee7e866a6b2ea7c162001fb9966eb3255e94fce37ddc7d957a4355855055

# The package's path comes from Node, as the Playwright launcher computes it
# (e2e/helpers/launch.ts: out/Vermilian-<process.platform>-<process.arch>), not
# from uname, which Git Bash on Windows reports as MINGW64_NT-…. Paths stay
# relative to the app directory, so Node on Windows reads them too.
cd "$APP_DIR"
TARGET="$(node -p "process.platform + '-' + process.arch")"
OUT_DIR="out/Vermilian-$TARGET"
if [ "${TARGET%%-*}" = darwin ]; then ASAR="$OUT_DIR/Vermilian.app/Contents/Resources/app.asar"; else ASAR="$OUT_DIR/resources/app.asar"; fi

sha() { node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))" "$1"; }

if [ -f "$ASAR" ] && [ "$(sha "$ASAR")" = "$PINNED_ASAR_SHA256" ]; then
  echo "REFUSED: $ASAR is the pinned acceptance build. Packaging here would overwrite it." >&2
  echo "Run the e2e suite in a separate worktree (e.g. ai-wt/<ISSUE>/app) instead." >&2
  exit 3
fi

if [ "${1:-}" = --release ]; then
  env -u VERMILIAN_E2E_BUILD pnpm exec electron-forge package
  echo "Release build: $ASAR ($(sha "$ASAR"))"
else
  VERMILIAN_E2E_BUILD=1 pnpm exec electron-forge package
  echo "E2e build: $ASAR ($(sha "$ASAR"))"
fi
