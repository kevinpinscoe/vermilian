#!/usr/bin/env bash
# check-forbidden-strings.sh — keep this public repository free of employer
# names, personal data and local database files.
#
# The denylist is deliberately NOT in the repository: a check that greps for
# forbidden words would itself have to contain them. Patterns come from
#   FORBIDDEN_PATTERNS        newline-separated (CI: a repository secret), or
#   FORBIDDEN_PATTERNS_FILE   a file outside the repository (local use).
# One fixed string per line, matched case-insensitively. Blank lines and lines
# starting with # are ignored. No patterns at all is an error (fail closed).
#
# Checks, against the files tracked in the current checkout:
#   1. no file content or file path contains a forbidden string;
#   2. no extra text file passed as an argument (commit messages, PR title and
#      body) contains one;
#   3. no SQLite database or Runway metadata snapshot is committed — by name
#      (*.sqlite, *.sqlite3, *.db, journal/WAL files) or by content (the
#      SQLite header), so a renamed snapshot is caught too.
#
# Findings never print the matched text or the pattern, only where it is and
# the pattern's line number in the list: this repository's CI logs are public.
#
# Usage: check-forbidden-strings.sh [--text LABEL=FILE]...
# Exit:  0 clean, 1 findings, 2 configuration error.

set -euo pipefail

in_ci=false
[[ "${GITHUB_ACTIONS:-}" == "true" ]] && in_ci=true

report() {
  if $in_ci; then
    echo "::error::$1"
  else
    echo "FAIL: $1" >&2
  fi
}

# ── Patterns ─────────────────────────────────────────────────────────────────
raw=""
if [[ -n "${FORBIDDEN_PATTERNS:-}" ]]; then
  raw="$FORBIDDEN_PATTERNS"
elif [[ -n "${FORBIDDEN_PATTERNS_FILE:-}" ]]; then
  if [[ ! -r "$FORBIDDEN_PATTERNS_FILE" ]]; then
    report "pattern file is not readable: $FORBIDDEN_PATTERNS_FILE"
    exit 2
  fi
  raw="$(cat "$FORBIDDEN_PATTERNS_FILE")"
fi

patterns=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  # trim leading and trailing whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  patterns+=("$line")
done <<<"$raw"

if [[ ${#patterns[@]} -eq 0 ]]; then
  report "no forbidden-string patterns configured (set the FORBIDDEN_STRINGS secret, or FORBIDDEN_PATTERNS_FILE locally)"
  exit 2
fi

# Mask every pattern in the CI log before anything else can print it.
if $in_ci; then
  for p in "${patterns[@]}"; do echo "::add-mask::$p"; done
fi

# ── Extra text inputs ────────────────────────────────────────────────────────
texts=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --text)
      [[ $# -ge 2 && "$2" == *=* ]] || { report "--text needs LABEL=FILE"; exit 2; }
      texts+=("$2")
      shift 2
      ;;
    *)
      report "unknown argument: $1"
      exit 2
      ;;
  esac
done

findings=0

# ── 1 + 2. Forbidden strings ─────────────────────────────────────────────────
mapfile -d '' tracked < <(git ls-files -z)

for i in "${!patterns[@]}"; do
  p="${patterns[$i]}"
  n=$((i + 1))

  # File paths.
  for f in "${tracked[@]}"; do
    if grep -qiF -- "$p" <<<"$f"; then
      report "a tracked file path contains forbidden pattern #$n (path withheld)"
      findings=$((findings + 1))
    fi
  done

  # File contents (text files only): print path and line, never the line.
  while IFS= read -r -d '' path; do
    shown="$path"
    if grep -qiF -- "$p" <<<"$path"; then shown="(path withheld)"; fi
    while IFS= read -r lineno; do
      report "$shown:$lineno contains forbidden pattern #$n"
      findings=$((findings + 1))
    done < <(grep -n -i -F -- "$p" "$path" | cut -d: -f1 || true)
  done < <(git grep -z -l -I -i -F -e "$p" -- . 2>/dev/null || true)

  # Extra text inputs.
  for t in "${texts[@]+"${texts[@]}"}"; do
    label="${t%%=*}"
    file="${t#*=}"
    [[ -r "$file" ]] || continue
    while IFS= read -r lineno; do
      report "$label line $lineno contains forbidden pattern #$n"
      findings=$((findings + 1))
    done < <(grep -n -i -F -- "$p" "$file" | cut -d: -f1 || true)
  done
done

# ── 3. Database and snapshot files ───────────────────────────────────────────
db_name_re='\.(sqlite|sqlite3|db|db3)$|\.(sqlite|sqlite3|db)-(journal|wal|shm)$'
for f in "${tracked[@]}"; do
  if [[ "${f,,}" =~ $db_name_re ]]; then
    report "$f: database files must never be committed (Runway metadata and snapshots stay in private storage)"
    findings=$((findings + 1))
  elif [[ -f "$f" ]] && cmp -s -n 16 -- "$f" <(printf 'SQLite format 3\000'); then
    report "$f: is an SQLite database; database files and Runway snapshots must never be committed"
    findings=$((findings + 1))
  fi
done

if [[ $findings -gt 0 ]]; then
  report "$findings finding(s). Remove them before merging; see scripts/check-forbidden-strings.sh."
  exit 1
fi

echo "forbidden-strings: clean (${#patterns[@]} pattern(s), ${#tracked[@]} tracked file(s), ${#texts[@]} extra text input(s))"
