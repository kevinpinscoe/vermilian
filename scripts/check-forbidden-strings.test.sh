#!/usr/bin/env bash
# Self-test for check-forbidden-strings.sh. Builds throwaway git repositories
# in a temp directory and checks exit codes and output. Uses made-up patterns
# only. Run: bash scripts/check-forbidden-strings.test.sh

set -euo pipefail

CHECK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-forbidden-strings.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PAT='ZzPlantedWordZz'
pass=0
fail=0

new_repo() {
  local d="$WORK/$1"
  mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" config user.email test@example.com
  git -C "$d" config user.name Test
  echo "$d"
}

commit_all() {
  git -C "$1" add -A
  git -C "$1" commit -q -m "test" --no-gpg-sign
}

# expect NAME EXPECTED_EXIT DIR [env/args...] — runs the checker in DIR.
expect() {
  local name="$1" want="$2" dir="$3"
  shift 3
  local out got envs=() args=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  args=("$@")
  set +e
  out="$(cd "$dir" && env -u GITHUB_ACTIONS -u FORBIDDEN_PATTERNS -u FORBIDDEN_PATTERNS_FILE \
           "${envs[@]}" bash "$CHECK" "${args[@]+"${args[@]}"}" 2>&1)"
  got=$?
  set -e
  LAST_OUT="$out"
  if [[ "$got" == "$want" ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL [$name]: exit $got, wanted $want"
    echo "$out" | sed 's/^/    /'
  fi
}

expect_no_leak() {
  local name="$1"
  if grep -qiF -- "$PAT" <<<"$LAST_OUT"; then
    fail=$((fail + 1))
    echo "FAIL [$name]: output reveals the pattern"
  else
    pass=$((pass + 1))
  fi
}

# 1. No patterns configured: fail closed.
r="$(new_repo none)"; echo ok >"$r/a.txt"; commit_all "$r"
expect "no patterns" 2 "$r" FORBIDDEN_PATTERNS=""
expect "only comments and blanks" 2 "$r" FORBIDDEN_PATTERNS=$'# comment\n\n   \n'

# 2. Clean repository passes; comments and blank lines are ignored.
expect "clean" 0 "$r" FORBIDDEN_PATTERNS=$'# list\n\n'"$PAT"$'\n'

# 3. Content match, case-insensitive, without revealing the pattern.
r="$(new_repo content)"
printf 'line one\nsee %s here\n' "$(tr '[:upper:][:lower:]' '[:lower:][:upper:]' <<<"$PAT")" >"$r/notes.md"
commit_all "$r"
expect "content match" 1 "$r" FORBIDDEN_PATTERNS="$PAT"
expect_no_leak "content match"
grep -q 'notes.md:2 contains forbidden pattern #1' <<<"$LAST_OUT" && pass=$((pass + 1)) || {
  fail=$((fail + 1)); echo "FAIL [content location]: $LAST_OUT"; }

# 4. Second pattern reported by its number.
expect "pattern numbering" 1 "$r" FORBIDDEN_PATTERNS=$'unrelated\n'"$PAT"
grep -q 'forbidden pattern #2' <<<"$LAST_OUT" && pass=$((pass + 1)) || {
  fail=$((fail + 1)); echo "FAIL [numbering]: $LAST_OUT"; }

# 5. Path match: path withheld.
r="$(new_repo path)"; mkdir -p "$r/docs"; echo ok >"$r/docs/${PAT}-notes.txt"; commit_all "$r"
expect "path match" 1 "$r" FORBIDDEN_PATTERNS="$PAT"
expect_no_leak "path match"

# 6. Untracked files are not scanned.
r="$(new_repo untracked)"; echo ok >"$r/a.txt"; commit_all "$r"; echo "$PAT" >"$r/scratch.txt"
expect "untracked ignored" 0 "$r" FORBIDDEN_PATTERNS="$PAT"

# 7. Extra text input (commit messages, PR title/body).
r="$(new_repo text)"; echo ok >"$r/a.txt"; commit_all "$r"
printf 'feat: something\n\nmentions %s\n' "$PAT" >"$WORK/msgs.txt"
expect "text input" 1 "$r" FORBIDDEN_PATTERNS="$PAT" -- --text "commit messages=$WORK/msgs.txt"
expect_no_leak "text input"
grep -q 'commit messages line 3' <<<"$LAST_OUT" && pass=$((pass + 1)) || {
  fail=$((fail + 1)); echo "FAIL [text location]: $LAST_OUT"; }

# 8. Pattern file instead of the environment variable.
printf '%s\n' "$PAT" >"$WORK/patterns.txt"
expect "pattern file" 1 "$r" FORBIDDEN_PATTERNS_FILE="$WORK/patterns.txt" -- --text "pr=$WORK/msgs.txt"
expect "missing pattern file" 2 "$r" FORBIDDEN_PATTERNS_FILE="$WORK/nope.txt"

# 9. Database files by name.
for name in runway.sqlite data.db snap.SQLITE3 runway.sqlite-wal; do
  r="$(new_repo "db-$name")"; echo x >"$r/$name"; commit_all "$r"
  expect "db name $name" 1 "$r" FORBIDDEN_PATTERNS="$PAT"
done

# 10. A renamed SQLite database is caught by its header.
r="$(new_repo header)"
printf 'SQLite format 3\000rest-of-header' >"$r/runway-export.bin"
commit_all "$r"
expect "sqlite header" 1 "$r" FORBIDDEN_PATTERNS="$PAT"

# 11. A file merely mentioning .sqlite in its text is fine.
r="$(new_repo mention)"; echo 'store it in runway-metadata.sqlite' >"$r/README.md"; commit_all "$r"
expect "mention ok" 0 "$r" FORBIDDEN_PATTERNS="$PAT"

# 12. CI mode masks every pattern before anything else.
r="$(new_repo ci)"; echo ok >"$r/a.txt"; commit_all "$r"
set +e
out="$(cd "$r" && GITHUB_ACTIONS=true FORBIDDEN_PATTERNS="$PAT" bash "$CHECK" 2>&1)"
set -e
[[ "$(head -n1 <<<"$out")" == "::add-mask::$PAT" ]] && pass=$((pass + 1)) || {
  fail=$((fail + 1)); echo "FAIL [ci mask]: $out"; }

echo "check-forbidden-strings self-test: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
