#!/usr/bin/env bash
# builder-control pre-push hook — OPT-IN / MANUAL (not auto-installed).
# Routes any to-be-pushed PUBLIC-repo path through the Builder Control gate (op=push)
# before the push is allowed. Fail-closed: a BC-PUBLIC-PUSH block aborts the push.
# The only override is a task packet with authorization.allowsPublicPush === true
# (pass BC_PACKET=<path>). No silent bypass.
#
# Env overrides:
#   BC_AGENT       agentId to attribute the op to (default: claude-code)
#   BC_PACKET      path to a task packet whose authorization.allowsPublicPush is true
#   BC_HOOK_FILES  test override: explicit file list instead of computing the push range
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
GATE="$ROOT/builder-control/gate.cjs"
FILTER="$ROOT/builder-control/hooks/_filter-sensitive.cjs"
AGENT="${BC_AGENT:-claude-code}"

if [ -n "${BC_HOOK_FILES:-}" ]; then
  FILES="$(printf '%s\n' ${BC_HOOK_FILES})"
else
  # Best-effort v1: files ahead of the configured upstream. If no upstream is set,
  # fall back to the last commit. (A future version can parse the stdin ref ranges.)
  FILES="$(git diff --name-only '@{u}' HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD 2>/dev/null || true)"
fi
[ -z "$FILES" ] && exit 0

SENSITIVE="$(printf '%s\n' "$FILES" | node "$FILTER" push || true)"
[ -z "$SENSITIVE" ] && exit 0

echo "[builder-control/pre-push] public-repo path(s) in push — routing through the gate:"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  set +e
  if [ -n "${BC_PACKET:-}" ]; then
    node "$GATE" --agent "$AGENT" --op push --path "$f" --packet "$BC_PACKET"
  else
    node "$GATE" --agent "$AGENT" --op push --path "$f"
  fi
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "[builder-control/pre-push] BLOCKED on: $f (gate exit $rc). Push aborted."
    echo "  Override: add a task packet with authorization.allowsPublicPush=true and re-run with BC_PACKET=<path>. No silent bypass."
    exit 1
  fi
done <<EOF
$SENSITIVE
EOF

echo "[builder-control/pre-push] all public-repo push paths passed the gate."
exit 0
