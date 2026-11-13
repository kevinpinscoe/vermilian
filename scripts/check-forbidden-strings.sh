#!/usr/bin/env bash
# check-forbidden-strings.sh — keep this public repository free of employer
# names, personal data and local database files.
#
# The forbidden-strings list is private and is NEVER in this repository, in
# GitHub secrets or in CI: a check that names the forbidden words would publish
# them. It is read locally from
#   $FORBIDDEN_PATTERNS_FILE, or by default
#   ~/Projects/private/vermilian-private/forbidden-strings.txt
# One fixed string per line, matched case-insensitively. Blank lines and lines
# starting with # are ignored. A missing, unreadable or empty list is an error
# (fail closed), except in --db-only mode, which needs no list.
#
# Modes:
#   (default)          scan the files tracked in the current checkout
#   --push REMOTE      pre-push: read Git's ref list on stdin and scan every
#                      commit being pushed (content and paths of the files each
#                      commit adds or changes, and its message; annotated tag
#                      messages too), so a string added and later removed is
#                      still caught before it is published
#   --range A..B       scan the commits in a revision range (as --push does)
#   --text LABEL=FILE  also scan a text file (PR title or body, a message);
#                      repeatable
#   --text-only        scan only the --text inputs (see check-pr-text.sh)
#   --db-only          skip the forbidden strings; check only for database
#                      files (what public CI runs; no list involved)
#
# Database rule (every mode except --text-only): no SQLite database or Runway
# metadata snapshot, by name (*.sqlite, *.sqlite3, *.db, *.db3, journal/WAL/SHM
# files) or by content (the SQLite header), so a renamed snapshot is caught.
#
# Output names only the location and the pattern's line number in the list,
# never the matched text or the pattern itself.
#
# Portable to macOS: bash 3.2 and BSD userland (no ${x,,}, mapfile or cmp -n).
#
# Exit: 0 clean, 1 findings, 2 configuration or usage error.

set -euo pipefail

DEFAULT_LIST="$HOME/Projects/private/vermilian-private/forbidden-strings.txt"

say() { echo "forbidden-strings: $*" >&2; }
finding() { echo "  FAIL: $*" >&2; findings=$((findings + 1)); }

mode=tree
push_remote=""
range=""
db_only=false
texts=()
findings=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      [[ $# -ge 2 ]] || { say "--push needs the remote name"; exit 2; }
      mode=push; push_remote="$2"; shift 2 ;;
    --range)
      [[ $# -ge 2 && "$2" == *..* ]] || { say "--range needs A..B"; exit 2; }
      mode=range; range="$2"; shift 2 ;;
    --text)
      [[ $# -ge 2 && "$2" == *=* ]] || { say "--text needs LABEL=FILE"; exit 2; }
      texts+=("$2"); shift 2 ;;
    --text-only) mode=text; shift ;;
    --db-only) db_only=true; shift ;;
    -h|--help) sed -n "2,38p" "$0"; exit 0 ;;
    *) say "unknown argument: $1"; exit 2 ;;
  esac
done

if [[ "$mode" == text && ${#texts[@]} -eq 0 ]]; then
  say "--text-only needs at least one --text LABEL=FILE"; exit 2
fi
if $db_only && [[ "$mode" == text ]]; then
  say "--db-only and --text-only cannot be combined"; exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"

# ── Patterns ─────────────────────────────────────────────────────────────────
patterns=()
plist="$work/patterns"
: >"$plist"
if ! $db_only; then
  list="${FORBIDDEN_PATTERNS_FILE:-$DEFAULT_LIST}"
  if [[ ! -r "$list" ]]; then
    say "the private forbidden-strings list is not available at: $list"
    say "Clone or update it (see CONTRIBUTING.md, \"Keeping the public repository clean\"),"
    say "or set FORBIDDEN_PATTERNS_FILE. Nothing was pushed or approved."
    exit 2
  fi
  # The list must never live inside this repository.
  if git ls-files --error-unmatch -- "$list" >/dev/null 2>&1; then
    say "the forbidden-strings list is tracked in this repository; remove it at once"
    exit 2
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    patterns+=("$line")
    printf '%s\n' "$line" >>"$plist"
  done <"$list"
  if [[ ${#patterns[@]} -eq 0 ]]; then
    say "the forbidden-strings list at $list has no patterns; refusing (fail closed)"
    exit 2
  fi
fi

# Reports which pattern numbers occur in one line of text (read from stdin).
pattern_numbers() {
  local text nums=() i
  text="$(cat)"
  for i in "${!patterns[@]}"; do
    if grep -qiF -- "${patterns[$i]}" <<<"$text"; then nums+=("#$((i + 1))"); fi
  done
  local IFS=,
  echo "${nums[*]}"
}

# Subresource-integrity hashes (sha512-<base64>, as in pnpm-lock.yaml) are
# random base64. A short pattern matched case-insensitively turns up in them by
# chance, so each one is blanked before matching. Only well-formed values are
# blanked: the algorithm name followed by exactly its digest length in base64.
# Line numbers are unchanged.
sri_re='sha512-[A-Za-z0-9+/]{86}==|sha384-[A-Za-z0-9+/]{64}|sha256-[A-Za-z0-9+/]{43}=|sha1-[A-Za-z0-9+/]{27}='
mask_hashes() { LC_ALL=C sed -E "s#$sri_re#(integrity-hash)#g"; }

# scan_file LABEL FILE — forbidden strings in a text file's lines.
scan_file() {
  local label="$1" file="$2" n masked="$work/masked"
  [[ ${#patterns[@]} -gt 0 && -s "$file" ]] || return 0
  grep -q -I '' -- "$file" || return 0   # binary: nothing to scan as text
  mask_hashes <"$file" >"$masked"
  while IFS= read -r n; do
    finding "$label line $n contains forbidden pattern $(sed -n "${n}p" "$masked" | pattern_numbers)"
  done < <(grep -n -i -F -I -f "$plist" -- "$masked" | cut -d: -f1 || true)
}

# scan_path WHERE PATH — forbidden strings in a path; returns a display form.
shown_path() {
  local path="$1"
  if [[ ${#patterns[@]} -gt 0 ]] && grep -qiF -f "$plist" <<<"$path"; then
    echo "(path withheld)"
  else
    echo "$path"
  fi
}
scan_path() {
  local where="$1" path="$2"
  [[ ${#patterns[@]} -gt 0 ]] || return 0
  if grep -qiF -f "$plist" <<<"$path"; then
    finding "${where}a file path contains forbidden pattern $(pattern_numbers <<<"$path") (path withheld)"
  fi
}

# "SQLite format 3\0" in hex; od/head keep this portable to macOS (BSD) tools.
SQLITE_MAGIC=53514c69746520666f726d6174203300
db_name_re='\.(sqlite|sqlite3|db|db3)$|\.(sqlite|sqlite3|db)-(journal|wal|shm)$'
# check_db WHERE PATH FILE — database by name or SQLite header.
check_db() {
  local where="$1" path="$2" file="$3" shown
  shown="$(shown_path "$path")"
  if [[ "$(printf '%s' "$path" | tr '[:upper:]' '[:lower:]')" =~ $db_name_re ]]; then
    finding "$where$shown: database files must never be committed (Runway metadata and snapshots stay in private storage)"
  elif [[ -f "$file" ]] && [[ "$(head -c 16 -- "$file" | od -An -tx1 | tr -d ' \n')" == "$SQLITE_MAGIC" ]]; then
    finding "$where$shown: is an SQLite database; database files and Runway snapshots must never be committed"
  fi
}

# ── Tree mode: files tracked in the checkout ─────────────────────────────────
scan_tree() {
  local f
  while IFS= read -r -d '' f; do
    scan_path "" "$f"
    check_db "" "$f" "$f"
    if [[ ${#patterns[@]} -gt 0 && -f "$f" && ! -L "$f" ]]; then
      scan_file "$(shown_path "$f")" "$f"
    fi
  done < <(git ls-files -z)
}

# ── Commit mode: commits being pushed, or a range ────────────────────────────
scan_commit() {
  local c="$1" short parent path blob
  short="$(git rev-parse --short "$c")"
  git log -1 --format=%B "$c" >"$work/msg"
  scan_file "commit $short message" "$work/msg"
  # Files this commit adds or changes (first parent; root commit: whole tree).
  if parent="$(git rev-parse -q --verify "$c^1" 2>/dev/null)"; then
    git diff --name-only -z --no-renames --diff-filter=ACMRT "$parent" "$c" >"$work/paths"
  else
    git ls-tree -r -z --name-only "$c" >"$work/paths"
  fi
  while IFS= read -r -d '' path; do
    scan_path "commit $short: " "$path"
    blob="$work/blob"
    # Symlinks and submodules have no ordinary blob content worth scanning.
    if [[ "$(git cat-file -t "$c:$path" 2>/dev/null)" != blob ]]; then continue; fi
    git cat-file blob "$c:$path" >"$blob"
    check_db "commit $short: " "$path" "$blob"
    scan_file "commit $short: $(shown_path "$path")" "$blob"
  done <"$work/paths"
}

scan_commits() {  # reads commit ids on stdin
  local c count=0
  while IFS= read -r c; do
    [[ -n "$c" ]] || continue
    scan_commit "$c"
    count=$((count + 1))
  done
  echo "$count" >"$work/count"
}

is_zero() { [[ "$1" =~ ^0+$ ]]; }

push_commits() {
  local local_ref local_sha _remote_ref remote_sha tagn=0
  while read -r local_ref local_sha _remote_ref remote_sha; do
    [[ -n "${local_sha:-}" ]] || continue
    is_zero "$local_sha" && continue   # deleting a remote ref publishes nothing
    if [[ "$(git cat-file -t "$local_sha" 2>/dev/null)" == tag ]]; then
      # Saved for scanning in the main shell (this runs in a subshell).
      tagn=$((tagn + 1))
      git cat-file tag "$local_sha" | sed '1,/^$/d' >"$work/tag.$tagn"
      printf '%s\t%s\n' "$work/tag.$tagn" "tag ${local_ref#refs/tags/} message" >>"$work/tags"
    fi
    if ! is_zero "$remote_sha" && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
      git rev-list "$remote_sha..$local_sha"
    else
      # New ref, or a remote tip we do not have: everything not already on the remote.
      git rev-list "$local_sha" --not --remotes="$push_remote"
    fi
  done | awk '!seen[$0]++'
}

case "$mode" in
  tree) scan_tree; echo 0 >"$work/count" ;;
  # Process substitution, not a pipe: scan_commits must run in this shell so its
  # findings count survives.
  push)
    : >"$work/tags"
    scan_commits < <(push_commits)
    while IFS=$'\t' read -r tagfile taglabel; do
      scan_file "$taglabel" "$tagfile"
    done <"$work/tags"
    ;;
  range) scan_commits < <(git rev-list "$range") ;;
  text) echo 0 >"$work/count" ;;
esac

for t in "${texts[@]+"${texts[@]}"}"; do
  label="${t%%=*}"
  file="${t#*=}"
  if [[ ! -r "$file" ]]; then say "cannot read --text input: $label"; exit 2; fi
  scan_file "$label" "$file"
done

what="patterns: ${#patterns[@]}"
$db_only && what="database check only"
if [[ $findings -gt 0 ]]; then
  say "$findings finding(s) — refused ($what). Locations and pattern numbers only; values are never printed."
  exit 1
fi
case "$mode" in
  push|range) say "clean: $(cat "$work/count") commit(s) checked ($what)" ;;
  text) say "clean: ${#texts[@]} text input(s) checked ($what)" ;;
  *) say "clean: $(git ls-files | wc -l | tr -d ' ') tracked file(s) checked ($what)" ;;
esac
