#!/usr/bin/env bash
# MANUAL installer for the builder-control git hooks. OPT-IN ONLY.
#
# This script is NOT run automatically by anything. Sprint 1 deliberately leaves
# the hooks opt-in: they exist and are tested, but enforcement-by-hook is enabled
# only when a human runs this with --yes. Without --yes this is a dry run.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
HOOKS="$ROOT/builder-control/hooks"
GITHOOKS="$ROOT/.git/hooks"

if [ "${1:-}" != "--yes" ]; then
  echo "builder-control hook installer — DRY RUN (no changes made)."
  echo
  echo "This WOULD symlink:"
  echo "  $GITHOOKS/pre-commit   ->  $HOOKS/pre-commit.sh"
  echo "  $GITHOOKS/pre-push     ->  $HOOKS/pre-push.sh"
  echo "  $GITHOOKS/post-commit  ->  $HOOKS/post-commit.sh   (Layer 4 bypass observer)"
  echo
  echo "Hooks are OPT-IN. To actually install, re-run:"
  echo "  bash builder-control/hooks/install.sh --yes"
  echo
  echo "To uninstall later:"
  echo "  rm -f $GITHOOKS/pre-commit $GITHOOKS/pre-push $GITHOOKS/post-commit"
  exit 0
fi

mkdir -p "$GITHOOKS"
ln -sf "$HOOKS/pre-commit.sh" "$GITHOOKS/pre-commit"
ln -sf "$HOOKS/pre-push.sh" "$GITHOOKS/pre-push"
# post-commit is what makes --no-verify visible. Installing pre-commit without
# it gives you a gate that can be skipped silently — the exact failure that cost
# 178 files on 2026-07-28. They install together.
ln -sf "$HOOKS/post-commit.sh" "$GITHOOKS/post-commit"
chmod +x "$HOOKS/pre-commit.sh" "$HOOKS/pre-push.sh" "$HOOKS/post-commit.sh"
echo "Installed builder-control hooks (symlinked):"
echo "  $GITHOOKS/pre-commit   ->  $HOOKS/pre-commit.sh"
echo "  $GITHOOKS/pre-push     ->  $HOOKS/pre-push.sh"
echo "  $GITHOOKS/post-commit  ->  $HOOKS/post-commit.sh   (Layer 4 bypass observer)"
