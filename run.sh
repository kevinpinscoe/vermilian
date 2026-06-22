#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/app"
exec mise exec -- pnpm start
