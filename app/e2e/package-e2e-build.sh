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

case "$(uname -s)" in
  Darwin) PLATFORM=darwin ;;
  Linux) PLATFORM=linux ;;
  *) echo "unsupported platform: $(uname -s)" >&2; exit 2 ;;
esac
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 2 ;;
esac
OUT_DIR="$APP_DIR/out/Vermilian-$PLATFORM-$ARCH"
if [ "$PLATFORM" = darwin ]; then ASAR="$OUT_DIR/Vermilian.app/Contents/Resources/app.asar"; else ASAR="$OUT_DIR/resources/app.asar"; fi

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

if [ -f "$ASAR" ] && [ "$(sha "$ASAR")" = "$PINNED_ASAR_SHA256" ]; then
  echo "REFUSED: $ASAR is the pinned acceptance build. Packaging here would overwrite it." >&2
  echo "Run the e2e suite in a separate worktree (e.g. ai-wt/<ISSUE>/app) instead." >&2
  exit 3
fi

cd "$APP_DIR"
if [ "${1:-}" = --release ]; then
  env -u VERMILIAN_E2E_BUILD pnpm exec electron-forge package
  echo "Release build: $OUT_DIR (app.asar $(sha "$ASAR"))"
else
  VERMILIAN_E2E_BUILD=1 pnpm exec electron-forge package
  echo "E2e build: $OUT_DIR (app.asar $(sha "$ASAR"))"
fi
