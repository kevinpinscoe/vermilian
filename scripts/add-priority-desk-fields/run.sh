#!/usr/bin/env bash
# Add the Focus / Focus rank / Why now custom fields (ADR-0007) to every
# active YouTrack project.
#
# This is a Kevin-run script, not something the Claude_Code AI session ever
# executes itself. Per ~/ai/directives/when-creating-a-youtrack-ticket.md
# §14 — "Admin-level YouTrack changes are never something an AI session runs
# itself" — creating/attaching custom-field schema is an api/admin/... write
# that is out of scope for the Claude_Code token regardless of what it could
# technically reach. Generated for VERM-4; run it yourself.
#
# Reads the API token from OpenBao at app/YouTrack (the token named 'AI') —
# the same credential the sibling youtrack.kevininscoe.com repo's own admin
# scripts use (see scripts/add-host-and-domain-fields there, the precedent
# this script's shape is copied from). Not app/YouTrack-Claude-Code, which is
# the AI's own issue-level-only credential and has no admin rights.
#
# Usage:
#   bash run.sh --stage fields  --dry-run
#   bash run.sh --stage fields
#   bash run.sh --stage test
#   bash run.sh --stage verify
#
# Stages are independent and re-runnable. Run --stage verify after any change.
# Always run --stage fields --dry-run first and read its output before the
# real run — it prints every bundle/prototype/attach it would create or
# change, with nothing written.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export YOUTRACK_TARGET_URL="${YOUTRACK_TARGET_URL:-http://127.0.0.1:9000}"

YOUTRACK_TARGET_TOKEN="$(
  parzival get --as youtrack-kevin 'bao:app/YouTrack#token'
)"
export YOUTRACK_TARGET_TOKEN

if [[ -z "${YOUTRACK_TARGET_TOKEN}" ]]; then
  echo "ERROR: could not read the 'AI' token from OpenBao (app/YouTrack)." >&2
  exit 1
fi

exec python3 "${SCRIPT_DIR}/apply.py" "$@"
