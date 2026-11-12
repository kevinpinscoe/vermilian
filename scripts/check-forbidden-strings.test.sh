#!/usr/bin/env bash
# Self-test for check-forbidden-strings.sh, the pre-push hook and
# check-pr-text.sh. Builds throwaway repositories (and bare "remotes") in a
# temp directory and pushes to them with real `git push`, so the pre-push path
# is exercised end to end. Uses only a made-up pattern; needs no private list
# and no network. Runs in public CI. Run: bash scripts/check-forbidden-strings.test.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$HERE/check-forbidden-strings.sh"
ROOT="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PAT='ZzPlantedWordZz'
LIST="$WORK/list.txt"
printf '# test list\n\nunrelated-word-qq\n%s\n' "$PAT" >"$LIST"   # PAT is pattern #2

# Hooks dir used by test pushes: runs the scanner exactly as .githooks/pre-push does.
HOOKS="$WORK/hooks"
mkdir -p "$HOOKS"
cat >"$HOOKS/pre-push" <<EOF
#!/usr/bin/env bash
exec bash "$CHECK" --push "\$1"
EOF
chmod +x "$HOOKS/pre-push"

pass=0
fail=0
LAST_OUT=""
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL [$1]"; [[ -n "${2:-}" ]] && printf '%s\n' "$2" | sed 's/^/    /'; }

git_() { git -c user.email=test@example.com -c user.name=Test -c commit.gpgsign=false -c tag.gpgsign=false "$@"; }

new_repo() {
  local d="$WORK/$1"
  mkdir -p "$d"
  git_ -C "$d" init -q -b main
  echo "$d"
}
commit_all() { git_ -C "$1" add -A; git_ -C "$1" commit -q -m "${2:-test}"; }

# run NAME WANT_EXIT DIR [VAR=VALUE...] -- [checker args...]
run() {
  local name="$1" want="$2" dir="$3" envs=() got
  shift 3
  while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  set +e
  LAST_OUT="$(cd "$dir" && env -u FORBIDDEN_PATTERNS_FILE FORBIDDEN_PATTERNS_FILE="$LIST" ${envs[@]+"${envs[@]}"} bash "$CHECK" "$@" 2>&1)"
  got=$?
  set -e
  if [[ "$got" == "$want" ]]; then ok; else bad "$name: exit $got, wanted $want" "$LAST_OUT"; fi
}

# push NAME WANT_EXIT REPO [VAR=VALUE...] -- [git push args...]
push() {
  local name="$1" want="$2" dir="$3" envs=() got
  shift 3
  while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  set +e
  LAST_OUT="$(cd "$dir" && export FORBIDDEN_PATTERNS_FILE="$LIST" \
    && for e in ${envs[@]+"${envs[@]}"}; do export "${e?}"; done \
    && git_ -c core.hooksPath="$HOOKS" push "$@" 2>&1)"
  got=$?
  set -e
  if [[ "$want" == 0 && "$got" == 0 ]] || [[ "$want" != 0 && "$got" != 0 ]]; then ok; else
    bad "$name: push exit $got, wanted $([[ $want == 0 ]] && echo success || echo refusal)" "$LAST_OUT"
  fi
}

has() { if grep -qF -- "$2" <<<"$LAST_OUT"; then ok; else bad "$1: output lacks '$2'" "$LAST_OUT"; fi; }
no_leak() { if grep -qiF -- "$PAT" <<<"$LAST_OUT"; then bad "$1: output reveals the pattern"; else ok; fi; }

new_remote() { local r="$WORK/$1.git"; git init -q --bare -b main "$r"; echo "$r"; }
remote_has() {  # remote_has NAME REMOTE REF WANT(yes|no)
  if git -C "$2" rev-parse -q --verify "$3" >/dev/null; then got=yes; else got=no; fi
  if [[ "$got" == "$4" ]]; then ok; else bad "$1: remote ref $3 present=$got, wanted $4"; fi
}

# ── List handling (fail closed) ──────────────────────────────────────────────
r="$(new_repo base)"; echo ok >"$r/a.txt"; commit_all "$r"
run "missing list" 2 "$r" FORBIDDEN_PATTERNS_FILE="$WORK/nope.txt" --
has "missing list message" "not available"
printf '# only comments\n\n   \n' >"$WORK/empty.txt"
run "empty list" 2 "$r" FORBIDDEN_PATTERNS_FILE="$WORK/empty.txt" --
cp "$LIST" "$r/list.txt"; commit_all "$r"
run "list tracked in repo" 2 "$r" FORBIDDEN_PATTERNS_FILE="$r/list.txt" --
git_ -C "$r" rm -q list.txt; commit_all "$r"

# ── Tree mode ────────────────────────────────────────────────────────────────
run "clean tree" 0 "$r" --
r="$(new_repo content)"
printf 'line one\nsee %s here\n' "$(tr '[:upper:][:lower:]' '[:lower:][:upper:]' <<<"$PAT")" >"$r/notes.md"
commit_all "$r"
run "content, case-insensitive" 1 "$r" --
has "content location and number" "notes.md line 2 contains forbidden pattern #2"
no_leak "content"
r="$(new_repo path)"; mkdir -p "$r/docs"; echo ok >"$r/docs/${PAT}-notes.txt"; commit_all "$r"
run "path" 1 "$r" --
has "path withheld" "(path withheld)"
no_leak "path"
r="$(new_repo untracked)"; echo ok >"$r/a.txt"; commit_all "$r"; echo "$PAT" >"$r/scratch.txt"
run "untracked ignored" 0 "$r" --
for name in runway.sqlite data.db snap.SQLITE3 runway.sqlite-wal; do
  r="$(new_repo "db-$name")"; echo x >"$r/$name"; commit_all "$r"
  run "db by name: $name" 1 "$r" --
done
r="$(new_repo header)"; printf 'SQLite format 3\000rest-of-header' >"$r/runway-export.bin"; commit_all "$r"
run "db by header" 1 "$r" --
r="$(new_repo mention)"; echo 'kept in runway-metadata.sqlite' >"$r/README.md"; commit_all "$r"
run "mentioning .sqlite is fine" 0 "$r" --

# ── --db-only (public CI): no list needed, strings ignored ───────────────────
r="$(new_repo dbonly)"; echo "$PAT" >"$r/a.txt"; commit_all "$r"
run "db-only ignores strings, needs no list" 0 "$r" FORBIDDEN_PATTERNS_FILE="$WORK/nope.txt" -- --db-only
echo x >"$r/runway.db"; commit_all "$r"
run "db-only still catches databases" 1 "$r" FORBIDDEN_PATTERNS_FILE="$WORK/nope.txt" -- --db-only
r="$(new_repo dbrange)"; echo ok >"$r/a.txt"; commit_all "$r"; base="$(git -C "$r" rev-parse HEAD)"
printf 'SQLite format 3\000x' >"$r/snap.bin"; commit_all "$r"; git_ -C "$r" rm -q snap.bin; commit_all "$r"
run "db-only range catches a database added then removed" 1 "$r" FORBIDDEN_PATTERNS_FILE="$WORK/nope.txt" -- --db-only --range "$base..HEAD"

# ── Text inputs and check-pr-text.sh ─────────────────────────────────────────
printf 'feat: something\n\nmentions %s\n' "$PAT" >"$WORK/pr.md"
printf 'feat: something harmless\n' >"$WORK/pr-ok.md"
run "text-only finds" 1 "$r" -- --text-only --text "PR body=$WORK/pr.md"
has "text location" "PR body line 3 contains forbidden pattern #2"
no_leak "text"
run "text-only clean" 0 "$r" -- --text-only --text "PR body=$WORK/pr-ok.md"
set +e
LAST_OUT="$(FORBIDDEN_PATTERNS_FILE="$LIST" bash "$HERE/check-pr-text.sh" - <"$WORK/pr.md" 2>&1)"; got=$?
set -e
[[ $got == 1 ]] && ok || bad "check-pr-text stdin: exit $got" "$LAST_OUT"
no_leak "check-pr-text"
set +e
LAST_OUT="$(FORBIDDEN_PATTERNS_FILE="$LIST" bash "$HERE/check-pr-text.sh" "$WORK/pr-ok.md" 2>&1)"; got=$?
set -e
[[ $got == 0 ]] && ok || bad "check-pr-text clean file: exit $got" "$LAST_OUT"

# ── Pre-push, with real git push to a local bare remote ──────────────────────
R="$(new_remote origin)"
r="$(new_repo pusher)"; git -C "$r" remote add origin "$R"
echo ok >"$r/a.txt"; commit_all "$r" "first"
push "clean push" 0 "$r" -- -q origin main
remote_has "clean push landed" "$R" refs/heads/main yes

git -C "$r" switch -q -c leak-content
echo "about $PAT" >"$r/b.txt"; commit_all "$r" "add b"
push "content in pushed commit" 1 "$r" -- origin leak-content
has "push names commit and line" "b.txt line 1 contains forbidden pattern #2"
no_leak "push content"
remote_has "refused push did not land" "$R" refs/heads/leak-content no

git -C "$r" switch -q main; git -C "$r" switch -q -c leak-history
echo "about $PAT" >"$r/c.txt"; commit_all "$r" "add c"
git_ -C "$r" rm -q c.txt; commit_all "$r" "remove c"
push "added then removed is still refused" 1 "$r" -- origin leak-history
no_leak "push history"

git -C "$r" switch -q main; git -C "$r" switch -q -c leak-message
echo d >"$r/d.txt"; commit_all "$r" "mention $PAT in the message"
push "commit message" 1 "$r" -- origin leak-message
has "message location" "message line 1 contains forbidden pattern #2"
no_leak "push message"

git -C "$r" switch -q main; git -C "$r" switch -q -c leak-path
echo e >"$r/${PAT}.txt"; commit_all "$r" "add e"
push "path in pushed commit" 1 "$r" -- origin leak-path
has "pushed path withheld" "(path withheld)"
no_leak "push path"

git -C "$r" switch -q main; git -C "$r" switch -q -c db-name
echo x >"$r/runway.sqlite"; commit_all "$r" "add db"
push "database by name" 1 "$r" -- origin db-name

git -C "$r" switch -q main; git -C "$r" switch -q -c db-header
printf 'SQLite format 3\000x' >"$r/export.dat"; commit_all "$r" "add renamed snapshot"
push "renamed database by header" 1 "$r" -- origin db-header

git -C "$r" switch -q main
echo f >"$r/f.txt"; commit_all "$r" "second"
push "missing list refuses the push" 1 "$r" FORBIDDEN_PATTERNS_FILE="$WORK/nope.txt" -- origin main
has "missing list message on push" "not available"
push "clean incremental push" 0 "$r" -- -q origin main

git_ -C "$r" tag -a v1 -m "release notes naming $PAT"
push "annotated tag message" 1 "$r" -- origin v1
git -C "$r" tag -d v1 >/dev/null
git_ -C "$r" tag -a v1 -m "release notes"
push "clean annotated tag" 0 "$r" -- -q origin v1

git -C "$r" switch -q -c to-delete; push "push branch" 0 "$r" -- -q origin to-delete
push "deleting a remote branch is allowed" 0 "$r" -- -q origin --delete to-delete

# A forbidden string already on the remote is not re-reported for new clean commits.
R2="$(new_remote legacy)"
r="$(new_repo legacy)"; git -C "$r" remote add origin "$R2"
echo "old $PAT" >"$r/old.txt"; commit_all "$r" "old"
git_ -C "$r" -c core.hooksPath=/dev/null push -q origin main
echo new >"$r/new.txt"; commit_all "$r" "new"
push "only new commits are scanned" 0 "$r" -- -q origin main

# ── The real .githooks/pre-push, as the shared global hook would call it ─────
R3="$(new_remote real)"
r="$(new_repo realhook)"; git -C "$r" remote add origin "$R3"
mkdir -p "$r/scripts" "$r/.githooks"
cp "$CHECK" "$r/scripts/"; cp "$ROOT/.githooks/pre-push" "$r/.githooks/"
echo ok >"$r/a.txt"; commit_all "$r" "with hook"
set +e
LAST_OUT="$(cd "$r" && FORBIDDEN_PATTERNS_FILE="$LIST" git_ -c core.hooksPath=.githooks push -q origin main 2>&1)"; got=$?
set -e
[[ $got == 0 ]] && ok || bad "real hook clean push: exit $got" "$LAST_OUT"
echo "x $PAT" >"$r/z.txt"; commit_all "$r" "z"
set +e
LAST_OUT="$(cd "$r" && FORBIDDEN_PATTERNS_FILE="$LIST" git_ -c core.hooksPath=.githooks push -q origin main 2>&1)"; got=$?
set -e
[[ $got != 0 ]] && ok || bad "real hook refuses: exit $got" "$LAST_OUT"
no_leak "real hook"

echo "check-forbidden-strings self-test: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
