#!/usr/bin/env bash
# rename-propagate.sh — Rule 6 (Rename-Propagation Gate, ratified 2026-04-22)
#
# Repo-wide grep + in-place sed for a canonical rename. When any CRG entity is
# renamed (agent, rubric, function, memory file) we propagate the rename
# atomically and log it in 01-CORNERSTONE-RESEARCH-GROUP/RENAMES.md.
#
# Usage:
#   scripts/rename-propagate.sh <old-name> <new-name> [--dry-run]
#
# Example:
#   scripts/rename-propagate.sh Judge Samuel
#   scripts/rename-propagate.sh agent-judge-background samuel-background
#
# Guards (skipped paths):
#   .git/  node_modules/  backups/  backup/  *.bak  *.bak-*  /tmp/*
#   Binary files (file(1) result != text)
#
# After the propagation pass, append a row to RENAMES.md. Samuel's rename-
# verify CI hook reads that file on every PR and fails if stale references
# remain.
#
# Exit codes:
#   0 — success (files touched or nothing to touch)
#   1 — missing args
#   2 — grep/sed pipeline failure

set -euo pipefail

OLD="${1:-}"
NEW="${2:-}"
DRY="${3:-}"

if [[ -z "$OLD" || -z "$NEW" ]]; then
  echo "Usage: $0 <old-name> <new-name> [--dry-run]" >&2
  exit 1
fi

WORKSPACE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKSPACE_ROOT"

# Exclude patterns — skip anywhere these show up in the path.
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
)

# Build grep exclude args
GREP_ARGS=(-r -l -F -I)  # -I skips binary files
for d in "${EXCLUDE_DIRS[@]}"; do
  GREP_ARGS+=(--exclude-dir="$d")
done
for g in "${EXCLUDE_GLOBS[@]}"; do
  GREP_ARGS+=(--exclude="$g")
done

echo "→ Searching for '$OLD' in $WORKSPACE_ROOT"
MATCHES=$(grep "${GREP_ARGS[@]}" "$OLD" . 2>/dev/null || true)

if [[ -z "$MATCHES" ]]; then
  echo "No matches found — nothing to propagate."
  exit 0
fi

COUNT=$(echo "$MATCHES" | wc -l | tr -d ' ')
echo "→ Found $COUNT file(s) referencing '$OLD':"
echo "$MATCHES" | sed 's/^/   /'

if [[ "$DRY" == "--dry-run" ]]; then
  echo "--dry-run: stopping before in-place edits."
  exit 0
fi

echo "→ Replacing '$OLD' → '$NEW' in $COUNT file(s)..."

# Use sed -i in a portable way (macOS + Linux differ; we detect Darwin).
SED_INPLACE=(-i '')
if sed --version >/dev/null 2>&1; then
  # GNU sed (Linux)
  SED_INPLACE=(-i)
fi

# Escape for sed (forward-slash + ampersand)
OLD_SED=$(printf '%s\n' "$OLD" | sed 's/[\\/&]/\\&/g')
NEW_SED=$(printf '%s\n' "$NEW" | sed 's/[\\/&]/\\&/g')

echo "$MATCHES" | while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  sed "${SED_INPLACE[@]}" "s/$OLD_SED/$NEW_SED/g" "$f"
done

echo "✓ In-place rename complete."
echo ""
echo "REMINDER: log this rename in 01-CORNERSTONE-RESEARCH-GROUP/RENAMES.md"
echo "and run scripts/rename-verify.sh '$OLD' to confirm zero stale references."
