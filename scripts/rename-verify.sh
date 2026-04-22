#!/usr/bin/env bash
# rename-verify.sh — Rule 6 (Rename-Propagation Gate, ratified 2026-04-22)
#
# Verifies that a canonical rename has zero remaining references to the old
# name. Non-zero exit code + count on any stale reference. Safe-path guards
# mirror rename-propagate.sh.
#
# Usage:
#   scripts/rename-verify.sh <old-name>
#
# Exit codes:
#   0 — zero stale references (merge-safe)
#   1 — missing args
#   2 — stale references found (count printed)

set -euo pipefail

OLD="${1:-}"
if [[ -z "$OLD" ]]; then
  echo "Usage: $0 <old-name>" >&2
  exit 1
fi

WORKSPACE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKSPACE_ROOT"

EXCLUDE_DIRS=(
  ".git" "node_modules" "backups" "backup" ".cache"
  "dist" "build" ".next" ".netlify" "coverage"
  ".claude" ".openclaw" ".clawhub" "__pycache__"
)

EXCLUDE_GLOBS=(
  "*.bak" "*.bak-*" "*.lock" "*-lock.json" "*.log"
  "*.png" "*.jpg" "*.jpeg" "*.gif" "*.pdf" "*.svg"
  "*.docx" "*.pptx" "*.xlsx" "*.zip" "*.tar.gz"
  "*.woff" "*.woff2" "*.ttf" "*.mp3" "*.mp4"
  "RENAMES.md"
)

GREP_ARGS=(-r -F -I -n --color=never)
for d in "${EXCLUDE_DIRS[@]}"; do
  GREP_ARGS+=(--exclude-dir="$d")
done
for g in "${EXCLUDE_GLOBS[@]}"; do
  GREP_ARGS+=(--exclude="$g")
done

MATCHES=$(grep "${GREP_ARGS[@]}" "$OLD" . 2>/dev/null || true)

if [[ -z "$MATCHES" ]]; then
  echo "✓ Zero stale references to '$OLD' — merge-safe."
  exit 0
fi

COUNT=$(echo "$MATCHES" | wc -l | tr -d ' ')
echo "✗ Found $COUNT stale reference(s) to '$OLD':" >&2
echo "$MATCHES" >&2
exit 2
