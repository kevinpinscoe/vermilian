#!/usr/bin/env bash
# check-push-guard.sh — report whether this repository's pre-push check
# (.githooks/pre-push) actually runs on this host, and whether the private
# forbidden-strings list is in place. Read-only: changes nothing.
# Usage: bash scripts/check-push-guard.sh
set -uo pipefail
root="$(git rev-parse --show-toplevel)" || exit 2
ok=true
list="${FORBIDDEN_PATTERNS_FILE:-$HOME/Projects/private/vermilian-private/forbidden-strings.txt}"

if [[ -r "$list" ]]; then
  n=$(grep -cvE '^[[:space:]]*(#|$)' "$list" || true)
  echo "list:  OK, $n pattern(s) at $list"
else
  echo "list:  MISSING at $list (every push will be refused until it is cloned)"
  ok=false
fi

hp="$(git -C "$root" config --get core.hooksPath || true)"
scope="$(git -C "$root" config --show-scope --get core.hooksPath 2>/dev/null | cut -f1 || true)"
hp="${hp/#\~/$HOME}"
if [[ -z "$hp" ]]; then
  echo "hook:  NOT WIRED. No core.hooksPath is set, so Git runs .git/hooks, which has no check."
  echo "       Wire it for this repository only:  git -C \"$root\" config core.hooksPath .githooks"
  ok=false
elif [[ "$hp" == ".githooks" || "$hp" == "$root/.githooks" ]]; then
  echo "hook:  OK, core.hooksPath ($scope) points at this repository's .githooks"
else
  [[ "$hp" = /* ]] || hp="$root/$hp"
  if [[ -x "$hp/pre-push" ]] && grep -q '\.githooks/pre-push' "$hp/pre-push"; then
    echo "hook:  OK, the $scope pre-push hook ($hp/pre-push) delegates to .githooks/pre-push"
  else
    echo "hook:  NOT WIRED. core.hooksPath ($scope) is $hp, and its pre-push does not run"
    echo "       .githooks/pre-push. Decide how to chain it before changing any shared hook."
    ok=false
  fi
fi
[[ -x "$root/.githooks/pre-push" ]] || { echo "hook:  .githooks/pre-push is missing or not executable"; ok=false; }

if $ok; then
  echo "push guard: ready"
else
  echo "push guard: NOT ready"
  exit 1
fi
