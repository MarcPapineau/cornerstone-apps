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
#
# Layer 4 — this hook also issues the RECEIPT that proves it ran.
# `git commit --no-verify` skips this file entirely (proven, not assumed:
# builder-control/test/bypass-experiment.sh). So its absence cannot be detected
# from inside here. Instead this hook writes a receipt naming the exact tree it
# approved, and post-commit.sh — which --no-verify CANNOT skip — checks whether
# the tree that actually got committed carries one.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
GATE="$ROOT/builder-control/gate.cjs"
FILTER="$ROOT/builder-control/hooks/_filter-sensitive.cjs"
AGENT="${BC_AGENT:-claude-code}"
RECEIPT_DIR="$ROOT/builder-control/.receipts"

# Issue the receipt for the tree being committed. Written on EVERY compliant
# commit, not only protected-path ones: the observer must be able to tell
# "the gate ran and had nothing to block" apart from "the gate never ran".
# Keyed BY tree hash, so a receipt cannot be replayed for a different tree.
issue_receipt() {
  local tree
  tree="$(git write-tree)" || return 0
  mkdir -p "$RECEIPT_DIR" 2>/dev/null || return 0
  printf '%s\t%s\t%s\n' "$tree" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$AGENT" \
    > "$RECEIPT_DIR/$tree" 2>/dev/null || return 0
}

if [ -n "${BC_HOOK_FILES:-}" ]; then
  FILES="$(printf '%s\n' ${BC_HOOK_FILES})"
else
  FILES="$(git diff --cached --name-only)"
fi
[ -z "$FILES" ] && { issue_receipt; exit 0; }

# ── Doctrine rules, every lane ──────────────────────────────────────
# Not Vitalis-specific. builder-control/doctrine-rules.json is scoped per rule,
# so a rule fires only on the files it names — a peptide rule can never block a
# listing package. To govern a new lane, add a rule there; nothing here changes.
DOCTRINE="$ROOT/builder-control/doctrine-check.cjs"
if [ -f "$DOCTRINE" ]; then
  set +e
  node "$DOCTRINE" --staged
  drc=$?
  set -e
  if [ "$drc" -ne 0 ]; then
    echo "[builder-control/pre-commit] BLOCKED by doctrine rules (exit $drc). Commit aborted."
    echo "  Each finding above names the rule and the document that makes it a rule."
    exit 1
  fi
fi

SENSITIVE="$(printf '%s\n' "$FILES" | node "$FILTER" write || true)"
[ -z "$SENSITIVE" ] && { issue_receipt; exit 0; }

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
issue_receipt
exit 0
