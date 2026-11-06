#!/usr/bin/env bash
# Packages a development build for the live harness and records which source
# it came from (out/live-build-info.json), so a live run can say which commit
# it tested.
#
# Refuses to run where out/ already holds the pinned human-acceptance build
# (docs/priority-desk-acceptance.md → "Acceptance build"): rebuilding there
# would overwrite the binary Kevin is testing. Build in a separate checkout or
# worktree instead.
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
  echo "Build in a separate worktree (e.g. ai-wt/<ISSUE>/app) instead." >&2
  exit 3
fi

cd "$APP_DIR"
COMMIT="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain)" ]; then DIRTY=true; else DIRTY=false; fi
VERSION="$(node -p "require('./package.json').version")"

pnpm package

HASH="$(sha "$ASAR")"
cat > "$APP_DIR/out/live-build-info.json" <<JSON
{
  "sourceCommit": "$COMMIT",
  "dirty": $DIRTY,
  "version": "$VERSION",
  "asarSha256": "$HASH",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "Development build: $OUT_DIR"
echo "  source $COMMIT (uncommitted changes: $DIRTY), app.asar $HASH"
