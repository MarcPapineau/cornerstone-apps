#!/usr/bin/env bash
#
# gate.sh — the single definition of "green" for My Vitalis Health.
#
# Three callers run THIS file, so "it passes" means exactly one thing everywhere:
#   1. CI            .github/workflows/vitalis-app.yml   (the one that actually blocks)
#   2. Claude Code   luke-app/.claude/hooks/post-edit-gate.sh
#   3. You           bash scripts/gate.sh
#
# Add a check here and all three pick it up. Never add a check to only one caller.
#
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "── catalog guard ─────────────────────────────"
node scripts/check-catalog-guard.cjs || fail=1

echo "── acceptance suite ──────────────────────────"
node test/acceptance.js || fail=1

if [ "$fail" -ne 0 ]; then
  echo
  echo "GATE FAILED"
  exit 1
fi

echo
echo "GATE PASSED"
