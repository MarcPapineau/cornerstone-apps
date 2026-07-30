#!/usr/bin/env bash
#
# doctrine-validators.sh — Layer 1. Proves the doctrine checks actually fire.
#
# A validator nobody has watched fail is a validator nobody knows works. Each
# rule here gets three fixtures:
#   positive — correct document, must PASS
#   negative — the violation present, must FAIL and name the rule + its source
#   boundary — the nearest CORRECT thing to the violation, must PASS
#
# The boundary cases matter most. A regulator check that also fires on "not
# approved by the FDA" would flag the evidence-boundary language the content
# contract requires, and a gate that fails correct writing gets turned off.
#
#   bash scripts/test/doctrine-validators.sh
#
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

AUDIT="scripts/audit-protocol-content-contract.mjs"
FIX="scripts/test/fixtures"
pass=0; fail=0
ok()  { echo "  ok   $1"; pass=$((pass+1)); }
bad() { echo "  FAIL $1"; fail=$((fail+1)); }

run() { node "$AUDIT" --file "$FIX/$1.html" --strict 2>&1; }
code() { node "$AUDIT" --file "$FIX/$1.html" --strict >/dev/null 2>&1; echo $?; }

echo "LAYER 1 — DOCTRINE VALIDATORS"
echo "============================="

# ── positive ────────────────────────────────────────────────────────
[ "$(code clean-guide)" = "0" ] \
  && ok "positive: a compliant guide exits 0" \
  || bad "positive: compliant guide did not exit 0 — validators are over-strict
$(run clean-guide | sed 's/^/       /')"

# ── negatives: must fail AND be actionable ──────────────────────────
check_violation() { # fixture, rule-key, canon-substring
  local out; out="$(run "$1")"
  local c; c="$(code "$1")"
  if [ "$c" = "0" ]; then bad "negative $1: exited 0 — violation not caught"; return; fi
  case "$out" in
    *"VIOLATION [$2]"*) ;;
    *) bad "negative $1: did not report rule key '$2'"; return ;;
  esac
  case "$out" in *"$FIX/$1.html"*) ;; *) bad "negative $1: error does not name the file"; return ;; esac
  case "$out" in *"canon :"*"$3"*) ;; *) bad "negative $1: error does not cite canonical source '$3'"; return ;; esac
  ok "negative: $2 caught, names file + rule + canonical source"
}

check_violation violation-naming-canon       namingCanon                 rule_naturopath_dr_vincent_lun.md
check_violation violation-internal-jargon    internalJargon              CLAUDE.md
check_violation violation-regulatory-framing regulatoryAuthorityFraming  CLAUDE.md
check_violation violation-evidence-authority evidenceAuthorityDisplacement feedback_pubmed_is_locator_not_authority.md

# ── boundaries: the correct neighbours of each rule ──────────────────
if [ "$(code boundary-regulatory-negated)" = "0" ]; then
  ok "boundary: 'not approved by the FDA' is NOT flagged (required evidence-boundary language)"
else
  bad "boundary: the regulator check fires on correct negated language
$(run boundary-regulatory-negated | sed 's/^/       /')"
fi

if [ "$(code boundary-evidence-authority-locator)" = "0" ]; then
  ok "boundary: locating a study THROUGH an index is NOT flagged (a PMID and 'located through PubMed' are correct)"
else
  bad "boundary: the evidence-authority check fires on correct locator language
$(run boundary-evidence-authority-locator | sed 's/^/       /')"
fi

out="$(run boundary-missing-bucket)"
if [ "$(code boundary-missing-bucket)" != "0" ] && [ "${out#*VIOLATION}" = "$out" ]; then
  ok "boundary: a missing section fails as a structural gap, not as a doctrine violation"
else
  bad "boundary: missing section mis-classified
$(echo "$out" | sed 's/^/       /')"
fi

# ── --text: drift caught in the METHOD, before a file exists ─────────
#
# Every check above reads a finished document. The drift that has cost the most
# happened in a chat turn, in a stated research plan, before any document
# existed — so no document check could ever have seen it. These pin that path.
#
# The negative case is the verbatim sentence from the 2026-07-29 incident.
txt() { node "$AUDIT" --text "$1" >/dev/null 2>&1; echo $?; }

if [ "$(txt "Running — verified deep-research pass, every citation confirmed against PubMed before it makes the report.")" != "0" ]; then
  ok "method: the verbatim 2026-07-29 incident sentence is caught before any file exists"
else
  bad "method: the incident sentence passed — the regression that caused this check is back"
fi

# The last two are verbatim from real client guides. Both were flagged by the
# first draft of this rule and both were correct writing. They are pinned here
# because the cost of a false alarm is the whole check getting switched off.
for good in \
  "I located the study through PubMed, then read the paper in full and graded it." \
  "PubMed is a locator, not the authority. We go to the studies themselves." \
  "This peptide is not approved by the FDA, and that is not the standard we use." \
  "a vetted, organized place instead of a blank PubMed search" \
  "Identifiers cross-checked via NCBI / PubMed; Dr. Lun should verify before clinical use."
do
  if [ "$(txt "$good")" = "0" ]; then
    ok "method: correct writing passes — \"$(echo "$good" | cut -c1-46)...\""
  else
    bad "method: FALSE ALARM on correct writing — \"$good\"
$(node "$AUDIT" --text "$good" 2>&1 | sed 's/^/       /')"
  fi
done

# An empty --text is a check that did not run. It must never read as clean.
if [ "$(txt "")" = "2" ]; then
  ok "fail-closed: an empty --text exits 2, never a silent PASS"
else
  bad "fail-closed: empty --text did not exit 2 (got $(txt ""))"
fi

# ── fail-closed: nothing scanned must never read as clean ────────────
out="$(node "$AUDIT" --days 1 --strict 2>&1)"; c=$?
if [ "$c" != "0" ] || [ "${out#*BLOCKED}" != "$out" ]; then
  ok "fail-closed: a scan matching zero guides reports BLOCKED, not PASS"
else
  bad "fail-closed: an empty scan reported success
$(echo "$out" | sed 's/^/       /')"
fi

# Missing doctrine configuration must be an error, not a silent pass.
out="$(cd /tmp && node "$OLDPWD/$AUDIT" --file "$OLDPWD/$FIX/clean-guide.html" --strict 2>&1)"; c=$?
if [ "$c" != "0" ]; then
  ok "fail-closed: missing protocol root exits non-zero (exit $c)"
else
  bad "fail-closed: missing protocol root still exited 0"
fi

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "DOCTRINE VALIDATOR TESTS PASSED"
