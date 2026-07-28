#!/usr/bin/env bash
#
# post-edit-gate.sh — runs the app's quality gate automatically after Claude
# edits any My Vitalis Health source file. Wired in .claude/settings.json as a
# PostToolUse hook on Write|Edit.
#
# Nobody has to remember to run the tests. That is the entire point.
#
# Exit 0 = pass (silent). Exit 2 = fail, and the output below is fed straight
# back to Claude as a blocking error so it fixes the break in the same turn.
#
# This is a convenience mirror, NOT the enforcement boundary. CI is the gate
# that actually blocks (.github/workflows/vitalis-app.yml) — it runs on GitHub
# where no local session can skip it. Both run scripts/gate.sh.
#
set -uo pipefail

# Self-locating: .claude/hooks/ -> luke-app/ -> vitalis-resource-app/
# so moving or renaming the checkout never silently disables the gate.
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/vitalis-resource-app"

# Hook payload arrives as JSON on stdin.
file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)
[ -n "$file" ] || exit 0

# Only gate edits to this app's own source.
case "$file" in
  "$APP"/*) ;;
  *) exit 0 ;;
esac

# Ignore churn that cannot affect the gate.
case "$file" in
  */node_modules/*|*/.output/*|*/__screenshots__/*|*.md|*.log) exit 0 ;;
esac

if out=$(bash "$APP/scripts/gate.sh" 2>&1); then
  exit 0
fi

echo "QUALITY GATE FAILED after editing: $file"
echo
echo "$out" | grep -E "✗|FAIL|Error|error:" | head -20
echo
echo "Full run: bash $APP/scripts/gate.sh"
exit 2
