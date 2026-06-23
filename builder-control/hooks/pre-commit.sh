#!/usr/bin/env bash
# builder-control pre-commit hook — OPT-IN / MANUAL (not auto-installed).
# Routes any STAGED protected-path write through the Builder Control gate before
# the commit is allowed. Ordinary files are not gated (kept fast). Fail-closed:
# any gate block aborts the commit. There is no silent bypass — the only override
# is a task-packet authorization{} (pass BC_PACKET=<path>).
#
# Env overrides:
#   BC_AGENT       agentId to attribute the op to (default: claude-code)
#   BC_PACKET      path to a task packet that authorizes the protected write(s)
#   BC_HOOK_FILES  test override: explicit file list instead of `git diff --cached`
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
GATE="$ROOT/builder-control/gate.cjs"
FILTER="$ROOT/builder-control/hooks/_filter-sensitive.cjs"
AGENT="${BC_AGENT:-claude-code}"

if [ -n "${BC_HOOK_FILES:-}" ]; then
  FILES="$(printf '%s\n' ${BC_HOOK_FILES})"
else
  FILES="$(git diff --cached --name-only)"
fi
[ -z "$FILES" ] && exit 0

SENSITIVE="$(printf '%s\n' "$FILES" | node "$FILTER" write || true)"
[ -z "$SENSITIVE" ] && exit 0

echo "[builder-control/pre-commit] protected path(s) staged — routing through the gate:"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  set +e
  if [ -n "${BC_PACKET:-}" ]; then
    node "$GATE" --agent "$AGENT" --op write --path "$f" --packet "$BC_PACKET"
  else
    node "$GATE" --agent "$AGENT" --op write --path "$f"
  fi
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "[builder-control/pre-commit] BLOCKED on: $f (gate exit $rc). Commit aborted."
    echo "  Override: add an authorization{} task packet naming this path and re-run with BC_PACKET=<path>. No silent bypass."
    exit 1
  fi
done <<EOF
$SENSITIVE
EOF

echo "[builder-control/pre-commit] all protected staged paths passed the gate."
exit 0
