#!/usr/bin/env bash
# check-pr-text.sh — check a proposed PR title and description (or any text)
# against the private forbidden-strings list BEFORE pasting it into GitHub.
#
# The pre-push check cannot see PR text: it is typed on GitHub after the push.
# Usage:
#   bash scripts/check-pr-text.sh pr-body.md [more files...]
#   pbpaste | bash scripts/check-pr-text.sh -      (or: wl-paste | ...)
# Then publish exactly the checked text, for example:
#   gh pr create --title "..." --body-file pr-body.md
# Output names line numbers and pattern numbers only, never the matched text.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ $# -gt 0 ]] || { echo "usage: $0 FILE... | -" >&2; exit 2; }
args=()
tmp=""
trap '[[ -n "$tmp" ]] && rm -f "$tmp"' EXIT
for f in "$@"; do
  if [[ "$f" == "-" ]]; then
    tmp="$(mktemp)"
    cat >"$tmp"
    args+=(--text "stdin=$tmp")
  else
    args+=(--text "$f=$f")
  fi
done
bash "$here/check-forbidden-strings.sh" --text-only "${args[@]}"
