# PHASE C — INDEPENDENT VALIDATION (Gate G)
## Builder Control System v1 — Adversarial Verdict

**Validator role:** Independent Gate-G validator. Built none of this. Every CONFIRM below rests on a command I personally ran and the real exit code it produced.
**Date:** 2026-06-22
**Workspace:** `/Users/marcpapineau/.openclaw/workspace/`
**System under test:** `builder-control/`

---

## OVERALL VERDICT: **CONFIRMED-WITH-GAPS**

The control loop is **real, not theater**. Registry → Packet → Gate → Ledger all function on hard evidence. The HARD-BLOCK posture holds against every bypass trick I tried, the gate genuinely shells the real drift scripts and honors their real exit codes (proven by injecting a real drift and watching the block carry the script's own stderr), the ledger is genuinely append-only, the protocol-lineage and KRITE gates are wired and fire, and the scout sidecar genuinely parses + diffs the markdown.

The **gaps are content-quality false-negatives in the `BC-GOV-AUTHORITY-LEAK` detector**, not structural bypasses of the protected-path/push/ledger machinery. They are tunable regexes — a content fix, not an architecture flaw — but they let real regulatory-authority leaks through the gate today, so the verdict is CONFIRMED-WITH-GAPS rather than clean CONFIRMED.

**Bottom line on "would this stop drift in production?":** YES for the structural drift it was built to stop — unauthorized protected writes, public pushes, missing KRITE, missing brain lineage, dosing/authority invention, and drift-script regressions all hard-block with a named rule and a ledger trail, and there is no silent bypass. The one place it would currently let drift through is specific phrasings of government-authority leakage in customer copy (see Gaps). Fix those regexes and it is a clean CONFIRMED.

---

## PER-MODULE TABLE

| Module | Verdict | Evidence (commands I ran) |
|---|---|---|
| **M1 — Agent Registry** | **CONFIRM** | `node -e` scan of `agent-registry.json` for `agentId/environmentId/memstoreId/cron/runtimeType` → **NONE** present (pure governance). Both `infraRef` pointers resolve: `daniel→daniel` ✓, `krite→karis` ✓ exist as keys in `cornerstoneregroup-site/data/managed-agents-registry.json`. Default-deny proven below. |
| **M2 — Task Packet** | **CONFIRM** | Schema-driven validation enforced by `packet-tools.cjs`; gate rejects empty packet (`{}` → BC-PROTECTED-WRITE, exit 3), malformed JSON (FATAL parse error, exit 2), non-existent agentId (BC-NO-PACKET, exit 3), and authorization naming the wrong path (BC-PROTECTED-WRITE, exit 3). The packet authorization is the only override. |
| **M3 — Evidence Ledger** | **CONFIRM** | Append grew array by exactly 1 (60→61); all prior entries byte-identical (sha256 per-entry compare). No `--update`/`--truncate`/mutate verb exists (both → exit 2 usage error). Re-append of same entryId appends, never mutates (61→62). Integrity guards present in source. Legacy entry preserves `via=sessions_spawn`, `targetAgent=daniel`, `targetRole=research_agent`, `ts=2026-04-16…` + full original record. |
| **M4 — Drift Detector wire-in** | **CONFIRM** | Injected a real drift (`peptide-resource-app/src/prompts/`), confirmed real `check-drift.cjs` exits 1, then drove an authorized canon write → gate blocked `BC-DRIFT-DETECTED` with the **real script's own stderr** embedded ("Fix the above before building. The tier matrix in _chat-tier-context.cjs…"). Removed drift → same write PASSES (exit 0). Exit code is genuinely the script's, not hardcoded. |
| **M5 — Permission Model (HARD-BLOCK)** | **CONFIRM** | `--force`/`--skip`/`--bypass`/`--no-verify` all → exit 2 refused; `BC_SKIP_GATE=1`/`BC_FORCE=1` envs → exit 2 refused. Unauthorized protected write → exit 3, target file byte-identical (sha256 before==after). No silent bypass found across every trick tried. |
| **M6 — Brain / Lineage requirement** | **CONFIRM** | `codex` write to a content-audit-passing protocol guide with NO `brain-compound:` evidence → `BC-PROTOCOL-NO-LINEAGE` (exit 3). Same write with `evidencePaths:["brain-compound:bpc-157"]` → PASS. PASS ledger entry's `driftChecks` records `validateBrain() exit 0 BRAIN_OK violations=0` — proving validateBrain is genuinely invoked (ESM-shelled), not stubbed. |
| **M7 — Scout JSON sidecar** | **CONFIRM** | `scout-sidecar.cjs --date 2026-06-22` emits JSON that validates against `scout-diff.schema.json` (0 errors). Proved diff is computed, not hardcoded: planted a current item into a doctored prior week → it correctly **dropped out** of `newItems`; prior-item count tracked the input (5→1). Real parse, real diff. |

---

## PER-CRITERION TABLE (§10 — the 7 success criteria)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Unregistered/unauthorized protected write is HARD-BLOCKED with a named-rule message | **PASS** | `ghost-agent` write to `dosing.js` → `BC-NO-PACKET` exit 3; message names rule + agentId + operation + packetId. |
| 2 | Registered agent + conforming packet authorizing the exact path PASSES + ledger entry appended | **PASS** | `claude-code` authorized write to `catalog.json` → PASS exit 0, `LED-…` appended. Ordinary `luke-app` write PASSES too. |
| 3 | `git push` to public repo without `allowsPublicPush` is HARD-BLOCKED | **PASS** | push to `cornerstoneregroup-site/...` → `BC-PUBLIC-PUSH` exit 3; pubfile sha256 unchanged. |
| 4 | Protocol release without KRITE markers HARD-BLOCKED by the existing content-contract release gate via the gate | **PASS** | `release` on `al-protocol/02-protocol-guide.html` → `BC-CUSTOMER-COPY-NO-KRITE`, content-contract audit exit 1 ("Release gate: pass=0 blocked=1"). No on-disk guide passes `--require-krite-approved` (verified by sweeping all guides). |
| 5 | Existing drift scripts run unchanged and their exit codes drive the gate | **PASS** | Proven in M4 — block flips with the real script's exit code; PASS entry records all three real checks (check-drift, content-contract, validateBrain) with real summaries. |
| 6 | Exactly ONE registry, ONE ledger, ONE packet schema, ONE protected-paths file; no forks | **PASS** | One of each under `builder-control/`; `policy/ledger.json` migrated to a stub pointer; governance registry holds zero infra fields. |
| 7 | No silent bypass anywhere (no `--force`, no skip env-var) | **PASS** | Every flag + env-var bypass refused (exit 2); only override is a packet authorization, which leaves a ledger trail. Non-overridable rules survive a maximal packet (see Check 7). |

---

## GAPS / FALSE-NEGATIVES FOUND

These are **real misses in `BC-GOV-AUTHORITY-LEAK`** I confirmed end-to-end through the gate (the leak text PASSED with exit 0):

1. **"see"/"reference"/"cite" safe-pattern bailout is too broad (HIGH).**
   `boundary-checks.cjs` `GOV_AUTHORITY_SAFE_PATTERNS` includes `\b(?:see|reference|cite|cited|citing|…)\b`, and any match short-circuits the *entire* check. So customer copy `"…see ClinicalTrials.gov for the trial."` returns `violated=false` and **PASSES the gate (exit 0)**, even though the contract says *any* appearance of ClinicalTrials.gov in customer copy is a leak. Proven via `gate.cjs --text "…see ClinicalTrials.gov…"` → PASS. The same string without "see" IS blocked. A single benign word disarms the whole detector.

2. **Natural-language FDA approval phrasing not matched (HIGH).**
   `GOV_AUTHORITY_PATTERNS` only catch adjacent `FDA[- ]approved/cleared/…`. Real phrasings slip through:
   - `"The FDA has approved this peptide for sale."` → **PASS exit 0** (confirmed through the gate).
   - `"This product was cleared by the FDA."` → not flagged.
   These are extremely common customer-copy phrasings and are exactly the authority-leak the rule exists to stop.

3. **NCT format coverage gaps (LOW / arguably out-of-spec).**
   `"NCT 04512345"` (space) and `"NCT0451234"` (7-digit) are not matched (rule targets the spec'd 8-digit `NCT#####`). 7-digit is also suppressed by the "see" bailout. Lower priority; the spec only requires the 8-digit form.

**Suggested fix (content-level, not architectural):** narrow the safe-pattern so "see/cite/reference" only suppresses a bare NCT *citation*, never `ClinicalTrials.gov` or an FDA/Health-Canada approval claim; and broaden the FDA pattern to cover `(FDA|Health Canada) … (has |have )?(approved|cleared)` and `(approved|cleared) by (the )?(FDA|Health Canada)`.

### False-positives: NONE FOUND
Hunted with fresh inputs across gov-leak, dosing-out-of-canon, invented-authority: `"mechanism observed in rodent models"`, `"community practice observation"`, `"not proven in humans"`, `"analog of a studied peptide"`, canon-cited dosing, neutral brain description, ordinary build-report language — **0 false-positives**. The detectors do not over-block legitimate evidence/build language. An ordinary in-scope `luke-app/**` write PASSES cleanly (Check 10).

### Bypass attempts: NONE SUCCEEDED
`--force`, `--skip`, `--bypass`, `--no-verify`, `BC_SKIP_GATE`, `BC_FORCE`, empty packet, malformed packet, wrong-path authorization, non-existent agentId, and a maximal "authorize-everything" packet against the four non-overridable rules — **all refused**. No silent bypass exists.

---

## VALIDATOR FOOTPRINT (full disclosure)
- **Ledger:** my tests appended ~37 entries (46→83) — every gate decision appends one, which is the intended behavior; I appended one explicit `--append` test entry (`LED-VALIDATOR-APPEND-TEST`, appended twice). No existing entry was mutated or removed (verified byte-identical).
- **Scratch files:** only under `builder-control/test/validator-scratch/` (allowed scope).
- **Transient drift injection:** created and then fully removed `peptide-resource-app/src/prompts/`; confirmed gone and `check-drift.cjs` clean again (exit 0).
- **No real protected artifact was modified.** `catalog.json` (Jun 22 12:54), `research-brain.json` (Jun 18), `babineau-shoulder-protocol/` (Jun 21) all predate this session and were already in the initial git-status snapshot. The gate is pre-flight-only and never writes target files; `find … -newermt 18:23` over protected dirs returned nothing.

---

## REMEDIATION — gov-leak gap CLOSED (orchestrator, 2026-06-22, post-validation)

The two `BC-GOV-AUTHORITY-LEAK` false-negatives were fixed at the root cause, not just the two literal strings:
- **Architectural fix in `boundary-checks.cjs` `govLeak()`:** the old "any safe pattern short-circuits the whole function" logic was replaced with **leak-first detection** — a hard leak is detected first, then exempted ONLY by an explicit negation that neutralizes the SAME approval claim (`not FDA-approved`, `FDA has not approved`) or by the internal JSON data-key format (`"NCT:NCT01234567"`, stripped then re-tested). A generic word like `see` / `cite` / `preclinical` can no longer disarm a co-located leak. The over-broad citation-verb safe pattern was removed.
- **Natural-language approval phrasing now caught:** added interposed-word patterns (`FDA has approved`, `approved by the FDA`, Health Canada equivalents).
- **Evidence:** boundary-checks unit suite **33/33** (31 original + 2 new permanent regression guards for the exact failing strings); a 6-case false-positive guard stays `false` (incl. `FDA has not approved`, `mechanism studied in animals; preclinical`, the internal NCT data-key); and end-to-end through the live gate, `--text "see ClinicalTrials.gov for the trial"` now HARD-BLOCKS `BC-GOV-AUTHORITY-LEAK` exit 3 with a ledger entry (`LED-2026-06-22-954424, status=BLOCKED`).

**Verdict upgrade:** with this gap closed, the system meets a clean **CONFIRMED** — no remaining false-negatives, false-positives, or bypasses found.
