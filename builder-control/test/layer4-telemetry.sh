#!/usr/bin/env bash
#
# layer4-telemetry.sh — tests the REAL hook scripts, in a throwaway repo.
#
# Every case below is one way Layer 4 could lie. The rule under test is the same
# each time: the system must never report "clean" when it is actually blind.
#
#   1. normal commit           -> PASS recorded
#   2. git commit --no-verify  -> BYPASS recorded
#   3. missing bypass.log      -> watchdog says UNKNOWN, not "no bypasses"
#   4. unwritable log          -> loud failure, never silent success
#   5. stale/mismatched receipt-> BYPASS (a receipt for another tree proves nothing)
#   6. malformed telemetry     -> UNKNOWN, not skipped
#   7. CI independence         -> covered by .github/workflows (asserted here as a doc check)
#
# Runs entirely under $TMPDIR against a copy of the real hooks. Never touches
# the workspace repo.
#
#   bash builder-control/test/layer4-telemetry.sh
#
set -uo pipefail

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_SRC="$SRC_ROOT/builder-control/hooks"
WATCHDOG_SRC="$SRC_ROOT/builder-control/watchdog.cjs"

LAB="$(mktemp -d "${TMPDIR:-/tmp}/bc-layer4-XXXXXX")"
trap 'chmod -R u+w "$LAB" 2>/dev/null; rm -rf "$LAB"' EXIT

pass=0; fail=0
ok()   { echo "  ok   $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL $1"; fail=$((fail+1)); }

# A throwaway repo carrying the real hook scripts.
new_repo() {
  local d="$LAB/$1"; rm -rf "$d"; mkdir -p "$d/builder-control/hooks"; cd "$d"
  git init -q .; git config user.email t@local; git config user.name t
  cp "$HOOKS_SRC/pre-commit.sh" "$HOOKS_SRC/post-commit.sh" "$d/builder-control/hooks/"
  # Stub the sensitivity filter to "nothing is protected". This suite tests the
  # RECEIPT path — whether a commit can be proven gated — not gate.cjs itself,
  # which has its own suite. The real filter would pull gate.cjs and the whole
  # registry into a fixture that has neither.
  printf 'process.stdin.resume();process.stdin.on("data",()=>{});process.stdin.on("end",()=>process.exit(0));\n' \
    > "$d/builder-control/hooks/_filter-sensitive.cjs"
  chmod +x "$d/builder-control/hooks/"*.sh
  ln -sf "$d/builder-control/hooks/pre-commit.sh"  .git/hooks/pre-commit
  ln -sf "$d/builder-control/hooks/post-commit.sh" .git/hooks/post-commit
  echo seed > seed.txt; git add seed.txt
  git commit -q -m seed 2>/dev/null
}

verdicts() { sed -n 's/.*"verdict":"\([A-Z]*\)".*/\1/p' builder-control/bypass.log 2>/dev/null | tr '\n' ' '; }

echo "LAYER 4 — BYPASS TELEMETRY"
echo "=========================="

# ── 1. normal commit is recorded as PASS ────────────────────────────
new_repo t1
echo one > a.txt; git add a.txt; git commit -q -m one
if [ "$(verdicts)" = "PASS PASS " ]; then ok "normal commit records PASS"
else bad "normal commit: expected 'PASS PASS ', got '$(verdicts)'"; fi

# ── 2. --no-verify is detected ──────────────────────────────────────
new_repo t2
echo two > b.txt; git add b.txt; git commit -q --no-verify -m two
case "$(verdicts)" in
  *BYPASS*) ok "git commit --no-verify records BYPASS" ;;
  *) bad "--no-verify not detected; verdicts='$(verdicts)'" ;;
esac

# ── 5. a receipt for a DIFFERENT tree must not vouch for this commit ─
new_repo t5
mkdir -p builder-control/.receipts
printf 'deadbeef\t2020-01-01T00:00:00Z\tstale\n' > builder-control/.receipts/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
echo five > e.txt; git add e.txt; git commit -q --no-verify -m five
case "$(verdicts)" in
  *BYPASS*) ok "stale/mismatched receipt still records BYPASS" ;;
  *) bad "stale receipt was accepted; verdicts='$(verdicts)'" ;;
esac

# ── 4. an unwritable log fails loudly instead of silently ───────────
new_repo t4
mkdir -p builder-control
: > builder-control/bypass.log
chmod a-w builder-control/bypass.log
echo four > d.txt; git add d.txt
ERR="$(git commit -q --no-verify -m four 2>&1)"
case "$ERR" in
  *BLIND*|*"CANNOT WRITE"*) ok "unwritable log reports BLIND on stderr (never silent)" ;;
  *) bad "unwritable log produced no warning; stderr was: ${ERR:-<empty>}" ;;
esac
chmod u+w builder-control/bypass.log

# ── 3 & 6. watchdog must not call a missing or malformed log 'clean' ─
# Exercised against the real watchdog's Layer 4 reader.
if [ -f "$WATCHDOG_SRC" ]; then
  read_verdict() { # $1 = repo dir
    node -e '
      const {readLayer4} = require(process.argv[1]);
      const r = readLayer4(process.argv[2]);
      console.log(r.state);
    ' "$WATCHDOG_SRC" "$1" 2>/dev/null || echo HARNESS_ERROR
  }

  # 3. log missing entirely, observer IS installed
  new_repo t3
  rm -f builder-control/bypass.log
  V="$(read_verdict "$PWD")"
  case "$V" in
    UNKNOWN|BLIND) ok "missing bypass.log -> $V (not 'no bypasses recorded')" ;;
    HARNESS_ERROR) bad "watchdog does not export readLayer4() for testing" ;;
    *) bad "missing bypass.log reported as '$V' — that is a blind green" ;;
  esac

  # 6. malformed telemetry
  new_repo t6
  mkdir -p builder-control
  printf 'not json at all\n{"ts":"x","verdict":\n' > builder-control/bypass.log
  V="$(read_verdict "$PWD")"
  case "$V" in
    UNKNOWN|BLIND) ok "malformed telemetry -> $V (not silently skipped)" ;;
    HARNESS_ERROR) bad "watchdog does not export readLayer4() for testing" ;;
    *) bad "malformed telemetry reported as '$V'" ;;
  esac
else
  bad "watchdog.cjs not found at $WATCHDOG_SRC"
fi

# ── 7. CI must rerun the gate independently of local hooks ──────────
WF="$SRC_ROOT/.github/workflows/vitalis-app.yml"
if [ -f "$WF" ] && grep -q 'gate.sh' "$WF"; then
  ok "CI reruns gate.sh server-side (local bypass cannot fake a remote green)"
else
  bad "no CI workflow runs gate.sh — a local bypass would produce a green remote"
fi

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "LAYER 4 TELEMETRY TESTS PASSED"
