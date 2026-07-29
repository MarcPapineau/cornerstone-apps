#!/usr/bin/env bash
#
# bypass-experiment.sh — measures which git hooks actually run.
#
# post-commit.sh's whole design rests on one claim: `git commit --no-verify`
# skips pre-commit but NOT post-commit. This script is the measurement behind
# that claim, kept in the repo so it can be re-run against any git version
# rather than trusted from memory.
#
# It builds a throwaway repo under $TMPDIR and never touches the real one.
# Nothing here is destructive to the workspace.
#
#   bash builder-control/test/bypass-experiment.sh
#
set -uo pipefail

LAB="$(mktemp -d "${TMPDIR:-/tmp}/bc-bypass-experiment-XXXXXX")"
trap 'rm -rf "$LAB"' EXIT
cd "$LAB"
git init -q .
git config user.email experiment@local
git config user.name experiment

EVID="$LAB/fired.log"
for h in pre-commit prepare-commit-msg commit-msg post-commit; do
  printf '#!/bin/bash\necho %s >> "%s"\nexit 0\n' "$h" "$EVID" > ".git/hooks/$h"
  chmod +x ".git/hooks/$h"
done

fired() { sort "$EVID" 2>/dev/null | tr '\n' ' '; }

echo "git version: $(git --version)"
echo
printf '%-34s %s\n' "SCENARIO" "HOOKS THAT RAN"
printf '%-34s %s\n' "--------" "--------------"

echo a > a.txt; git add a.txt; : > "$EVID"
git commit -q -m normal
NORMAL="$(fired)"
printf '%-34s %s\n' "normal commit" "$NORMAL"

echo b > b.txt; git add b.txt; : > "$EVID"
git commit -q --no-verify -m bypassed
BYPASS="$(fired)"
printf '%-34s %s\n' "git commit --no-verify" "$BYPASS"

echo
fail=0

case "$NORMAL" in
  *pre-commit*) echo "  ok   pre-commit runs on a normal commit" ;;
  *) echo "  FAIL pre-commit did not run on a normal commit"; fail=1 ;;
esac

case "$BYPASS" in
  *pre-commit*) echo "  FAIL --no-verify did NOT skip pre-commit (premise broken)"; fail=1 ;;
  *) echo "  ok   --no-verify skips pre-commit — a gate there cannot see its own bypass" ;;
esac

case "$BYPASS" in
  *post-commit*) echo "  ok   --no-verify does NOT skip post-commit — the observer survives" ;;
  *) echo "  FAIL post-commit was skipped by --no-verify."
     echo "       Layer 4's observer placement is INVALID on this git version."
     fail=1 ;;
esac

echo
if [ "$fail" -ne 0 ]; then
  echo "EXPERIMENT FAILED — post-commit is not a reliable observer here."
  exit 1
fi
echo "EXPERIMENT PASSED — post-commit is a reliable bypass observer."
