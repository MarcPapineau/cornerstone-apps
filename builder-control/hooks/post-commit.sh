#!/usr/bin/env bash
#
# post-commit.sh — Layer 4. The bypass observer.
#
# WHY THIS HOOK AND NOT ANOTHER:
# `git commit --no-verify` skips pre-commit and commit-msg. It does NOT skip
# post-commit. That is not an assumption — it is measured, and the measurement
# is reproducible:
#
#     bash builder-control/test/bypass-experiment.sh
#
#                    pre-commit  commit-msg  prepare-commit-msg  post-commit
#   normal commit        run         run            run              run
#   --no-verify        SKIPPED     SKIPPED          run              run
#
# So a bypass cannot be detected by the hook that gets bypassed. It is detected
# here, afterwards, by asking a question the bypasser cannot fake: does the tree
# that just got committed carry a receipt from the gate?
#
# pre-commit.sh writes builder-control/.receipts/<tree-sha> for the tree it
# approved. A commit whose tree has no receipt is a commit no gate checked.
# Receipts are keyed by tree hash, so yesterday's receipt cannot vouch for
# today's commit.
#
# This hook NEVER blocks — a blocked bypass just gets routed around, and then we
# learn nothing. It records. The watchdog is what surfaces the record.
#
# Fail-closed rule: every path through this script writes a line. If it cannot
# determine what happened it writes UNKNOWN. Silence is never treated as safety,
# because "no line" and "nothing bad happened" must never look the same.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
LOG="$ROOT/builder-control/bypass.log"
RECEIPT_DIR="$ROOT/builder-control/.receipts"

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
TREE="$(git rev-parse HEAD^{tree} 2>/dev/null || echo unknown)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
AUTHOR="$(git log -1 --format=%ae 2>/dev/null || echo unknown)"

emit() { # verdict, detail
  local line
  line="$(printf '{"ts":"%s","verdict":"%s","commit":"%s","tree":"%s","branch":"%s","author":"%s","detail":"%s"}' \
    "$TS" "$1" "$COMMIT" "$TREE" "$BRANCH" "$AUTHOR" "$2")"
  if ! printf '%s\n' "$line" >> "$LOG" 2>/dev/null; then
    # The log is unwritable. Telemetry that cannot record must say so loudly
    # rather than disappear — an unwritable log is indistinguishable from a
    # clean one to anything reading the file later.
    echo "[builder-control/post-commit] CANNOT WRITE $LOG — bypass telemetry is BLIND" >&2
    return 1
  fi
}

if [ "$TREE" = "unknown" ] || [ "$COMMIT" = "unknown" ]; then
  emit UNKNOWN "could not resolve HEAD or its tree"
  exit 0
fi

if [ -f "$RECEIPT_DIR/$TREE" ]; then
  emit PASS "gate receipt present for committed tree"
  # Receipts are single-use bookkeeping, not history. Keep the directory from
  # growing without bound, but never prune the log.
  find "$RECEIPT_DIR" -type f -mtime +7 -delete 2>/dev/null || true
else
  emit BYPASS "no gate receipt for committed tree — this commit was not checked by any gate"
  echo "[builder-control/post-commit] BYPASS RECORDED — commit ${COMMIT:0:9} had no gate receipt." >&2
  echo "  This is logged, not blocked. It will show in: node builder-control/watchdog.cjs" >&2
fi
exit 0
