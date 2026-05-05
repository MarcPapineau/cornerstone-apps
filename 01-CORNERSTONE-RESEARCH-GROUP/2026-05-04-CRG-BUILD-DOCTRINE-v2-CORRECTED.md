# CRG Build Doctrine v2 — Corrected (Operational Contract)

**Version:** v2.0.0
**Date:** 2026-05-04
**Supersedes:** All prior build pipeline doctrine, including BUILD-AGENT-OPERATING-MANUAL-v1.md, the implicit "Builder → KRITE → Karis → Validator" pipeline cited in 2026-04-25 → 2026-05-04 dispatches, and any memory entry asserting Build Agent v1 / KRITE / Bezalel / Judge are deployed.
**Authority source:** 2026-05-04 Theater Audit (`01-CORNERSTONE-RESEARCH-GROUP/2026-05-04-CRG-THEATER-AUDIT-FULL-REPORT.md`).
**Document type:** Operational contract. Not narrative.

---

## §1. ACTUAL PIPELINE (verified runtime existence as of 2026-05-04)

The only build sequence currently fireable end-to-end. Every component has runtime evidence cited inline.

### §1.1 Components

| # | Component | Runtime location | Evidence |
|---|---|---|---|
| 1 | Orchestrator | Claude Code session, model `claude-opus-4-7` | This conversation log |
| 2 | Habakkuk Pre-Build pattern checker | `cornerstoneregroup-site/netlify/functions/_lib/habakkuk-pattern-checks.js` | File exists; 8 patterns; deterministic, no LLM |
| 3 | Habakkuk Pre-Build harness | `cornerstoneregroup-site/scripts/qa/habakkuk-pre-build.sh` | Exit codes 0/1/2/3; runs locally |
| 4 | git + GitHub | `git@github.com:MarcPapineau/cornerstoneregroup-site` (and similar for other repos) | git log accessible |
| 5 | Marc as final reviewer + merger | git user `marc@cornerstoneregroup.ca` | Commit author records |
| 6 | Anthropic Managed Agents API | `https://api.anthropic.com/v1/agents` | Returns 19 records (10 unique names) when authed with ANTHROPIC_API_KEY |
| 7 | Doppler vault (secrets) | `crg-site/prd` config | 112 secrets listed today |
| 8 | Langfuse traces | `https://us.cloud.langfuse.com` | 70 traces last 7 days |
| 9 | Netlify deploys | `cornerstoneregroup.netlify.app` + `mybioyouth-pos.netlify.app` | netlify.toml schedule blocks fire |
| 10 | Windmill local | `http://localhost:8000` workspace `admin` | 2 scripts (`obadiah_daily_brief`, `luke_weekly_research_v1`) |

### §1.2 Pipeline flow

```
Marc intent (chat or task)
  ↓
Orchestrator writes spec → 01-CORNERSTONE-RESEARCH-GROUP/<DATE>-<NAME>-DISPATCH.md
  ↓
Orchestrator writes code on feature branch (NOT main)
  ↓
Habakkuk Pre-Build harness → 8 patterns checked → exit 0/1/2/3
  ↓
git commit with evidence in body (file paths + line counts + test counts)
  ↓
PR open
  ↓
Marc review + merge
  ↓
Auto-deploy (Netlify) OR manual push (Windmill)
  ↓
Post-fire Langfuse trace observed within first scheduled run window
```

### §1.3 Gates that ACTUALLY fire today

| Gate | Status | Evidence type |
|---|---|---|
| **A — Dispatch written** | EXISTS | `.md` file at `01-CORNERSTONE-RESEARCH-GROUP/<DATE>-<NAME>-DISPATCH.md` |
| **C — Orchestrator verification** | EXISTS (when commit body has evidence) | `git show <sha>` returns evidence block |
| **D — Runtime evidence** | EXISTS (when Langfuse trace within 7d) | `curl https://us.cloud.langfuse.com/api/public/traces?name=<agent>&fromTimestamp=<7d>` |
| **Habakkuk Pre-Build** | EXISTS | exit code from `bash scripts/qa/habakkuk-pre-build.sh` |
| **Marc merge** | EXISTS | git log + PR merge record |

---

## §2. OPTIONAL PIPELINE (deferred — exists as spec, not deployed)

Components specified in design docs but NOT runtime-existing. Use of these names without §3 fictional-tag is a doctrine violation.

| Component | Spec location | Runtime status | Decision token |
|---|---|---|---|
| Build Agent v1 | `01-CORNERSTONE-RESEARCH-GROUP/build-agent-v1/main.py` (2,318 lines, uncommitted to git) | DEFERRED (never deployed) | Marc Decision B |
| KRITE — build-time 5-axis dispatch reviewer | `01-CORNERSTONE-RESEARCH-GROUP/NEXT-PROMPT-krite-agent-v1.md` | DEFERRED | Marc Decision A |
| Karis — per-PR test-runner | doctrine in memory | DEFERRED | Marc Decision A |
| Independent Validator (Gate G agent) | `rule_gate_g_independent_validator.md` | DEFERRED | Marc Decision A |
| Build Agent v2 | not specified | OPEN | Future |
| Bezalel runtime | `bezalel-vitalis-v1/artifacts/*` (corpus + system prompt) | DEFERRED (Phase 5/6 never executed) | Open |
| Judge | `/agents/JUDGE.md` | DEFERRED | Open |

**Rule:** Until decision tokens resolve, references to these components in dispatches must use the qualifier `DEFERRED` or `SPECIFIED-NOT-BUILT`. Use of `LIVE`, `DEPLOYED`, `BUILT`, `READY`, or `PASS` for these components is a doctrine violation.

---

## §3. DEPRECATED / FICTIONAL COMPONENTS (referenced as deployed but verified absent 2026-05-04)

These have appeared in past dispatches/memories as if deployed. They are NOT. Future references must tag explicitly per Rule R6.

| Component | Verified-absent evidence | Required tag |
|---|---|---|
| `u/marc/build-agent-v1` (Windmill) | 404 on script GET; zero jobs ever | FICTIONAL |
| KRITE-as-separate-build-time-reviewer-agent | No agent_id; no `krite-bootstrap.js`; no `krite-*-background.js` | FICTIONAL (note: `utils/krite.js` is a real Apollos content-quality gate; that exists — different function) |
| Bezalel runtime endpoint | No Anthropic registration; no Netlify function; no Windmill script; system prompt artifact self-declares "AUTHORED — pending Phase 5" | FICTIONAL |
| Judge agent | One spec file; no bootstrap; no runtime; no agent_id | FICTIONAL |
| "9 Windmill v2 anti-drift scripts" claim 2026-05-01 | `find -name "*-v2.py"` returns zero | FICTIONAL |
| `feat/levite-gate-f-and-theater-detector` files (`levite-kill.js` 328 lines, `levite-theater-detector.js` 271 lines) | `git show <branch>:<path>` returns "path does not exist" | FICTIONAL |
| "41 Windmill scripts" claim 2026-04-30 verification | Today: 2 scripts | UNVERIFIABLE — flag verification doc as INCONCLUSIVE |
| "3 Levite schedules" claim 2026-04-30 | Today: 0 Levite schedules | FICTIONAL |
| `u/admin/nehemiah_eod_v1` deployment claim 2026-05-01 | 404 on script GET; 0 jobs | FICTIONAL (file exists locally, not in Windmill) |

**Action:** MEMORY.md must be updated to reflect this list. Memory entries citing these as deployed must be either removed or amended with `[FICTIONAL — see 2026-05-04 audit]` tag.

---

## §4. ANTI-DRIFT ENFORCEMENT RULES (HARD)

Each rule is testable and fail-closed. Violations are doctrine breaches.

### Rule R1 — No runtime ID = no existence

An agent is NOT deployed unless ONE of the following produces a positive response:
- Anthropic `/v1/agents` returns its `agent_id`
- Windmill `/api/w/<workspace>/scripts/get/p/<path>` returns 200 with body
- Netlify function URL returns HTTP 200 from a fresh curl
- A committed file path + commit SHA + deployment URL trio is producible

If none: state DEFERRED or FICTIONAL. Never "deployed."

### Rule R2 — No trace in 7 days = STALE

An agent claimed LIVE must have a Langfuse trace within 7 calendar days. Older = STALE. Re-verify with fresh fire before re-citing as LIVE.

### Rule R3 — Self-verification is invalid

The orchestrator scoring its own output and labeling that score as a separate review (KRITE / Karis / Validator) is FORBIDDEN. A separate review requires:
- A separate Anthropic `agent_id` OR Windmill script path OR Netlify function endpoint
- A verdict file at a specified path committed to the same PR diff
- A Langfuse trace ID for the review session

If the orchestrator self-grades, the label MUST be `shadow-<gate>` or `advisory-<gate>`, never the gate name alone.

### Rule R4 — Docs cannot be used as evidence

A `.md` file claiming X is deployed is NOT evidence. Evidence is a live tool call returning a runtime artifact. Doc files describe intent; runtime calls describe reality.

### Rule R5 — Past claims must be re-verifiable or downgraded

Any "PASS / LIVE / DEPLOYED" claim made in a past session is automatically downgraded to UNVERIFIED until re-verified now via Rule R1 / R2 evidence types. Stale-Memory rule applies more aggressively than the existing 30-day window: any claim about agent runtime state >24 hours old must be re-verified before being re-cited as live.

### Rule R6 — Allowed language (banned terms + replacements)

| Banned without evidence | Replacement |
|---|---|
| `PASS` | `VERIFIED <verdict-file-path>` OR `INCOMPLETE` |
| `LIVE` | `OBSERVED <last-trace-timestamp>` OR `STALE` OR `DEFERRED` |
| `DEPLOYED` | `DEPLOYED <runtime>:<id>` (e.g., `DEPLOYED Anthropic:agent_011...`) OR `INCOMPLETE` |
| `BUILT` | `BUILT (file: <path>:<line-count>, commit: <sha>)` OR `INCOMPLETE` |
| `KRITE PASS` | BANNED (see Rule R3) until KRITE has runtime ID |
| `Karis verified` | BANNED until Karis-as-PR-test-runner has runtime ID |
| `Validator CONFIRMED` | BANNED until Independent Validator has runtime ID |
| `SHIPPED` | `SHIPPED <commit-sha> + <deploy-url-200>` OR `INCOMPLETE` |

Default fallback when work cannot meet criteria: `INCOMPLETE`. Acceptable when work is in progress; required when claim cannot be backed by evidence.

### Rule R7 — Habakkuk Pattern 9 (verdict-file-required) — to be implemented

PR bodies claiming any gate-pass token MUST include the corresponding verdict file in the same PR diff. Habakkuk Pre-Build returns REJECT if claim found without file.

**Implementation deferred:** Pattern 9 must be added to `_lib/habakkuk-pattern-checks.js` as a separate dispatch. Until then, this rule is enforced by Marc + orchestrator manual scan of every PR body for banned tokens.

### Rule R8 — Doppler-first, Levite-only-for-rotation

Reaffirmed from existing memory rules. Do not request credentials from Marc; query Doppler. Do not drive vendor dashboards manually for rotation; dispatch Levite.

### Rule R9 — INCOMPLETE-OVER-FAKED

Reaffirmed from anti-drift v2 block. The orchestrator must label work `INCOMPLETE` rather than fabricate completion. Self-doubt check before every "done" claim. Faking completion is the most-punished error in this system.

### Rule R10 — Agent-registry as single source of truth

A new file `cornerstoneregroup-site/data/agents-registry.json` (already partially exists) becomes the authoritative source for "is X deployed." Every agent must have an entry with: name, runtime (anthropic|windmill|netlify), runtime_id, last_verified_timestamp, last_trace_timestamp, status (LIVE|STALE|DEFERRED|FICTIONAL).

When a memory file or doc references an agent, reader must consult the registry before trusting the reference. Continuous audit (§5) maintains the registry.

---

## §5. CONTINUOUS AUDIT MECHANISM

### §5.1 Daily auto-audit (to be built per Marc Decision A3)

Scheduled function runs every 24h (proposed: 4am ET, before morning brief):

1. Pulls Anthropic `/v1/agents` list, Windmill script list, Netlify deploy state, Langfuse trace counts last 7d for each agent name.
2. Cross-references against `data/agents-registry.json` and MEMORY.md.
3. Updates registry: `last_verified_timestamp`, `last_trace_timestamp`, `status`.
4. Auto-downgrades any agent showing >7d trace silence to STALE.
5. Flags any FICTIONAL component cited as deployed elsewhere (memory, dispatches).
6. Writes audit log to `01-CORNERSTONE-RESEARCH-GROUP/audit-YYYY-MM-DD.md` with Reality vs Claim table.

### §5.2 Pre-merge audit (every PR)

Habakkuk Pre-Build runs before every merge. When Pattern 9 ships, it blocks gate-pass tokens lacking verdict files. Until then, orchestrator must manually grep PR body for banned tokens.

### §5.3 Per-Marc-facing-message check

Before sending a message to Marc claiming agent X is functioning:

1. Run live tool call (curl Anthropic / curl Windmill / read registry / query Langfuse) to verify state.
2. State the evidence in the message (agent_id, last trace timestamp, file path).
3. If can't verify: label `INCOMPLETE` and state what is blocked.

This rule applies to me (orchestrator) in this session and every future session.

---

## §6. ENFORCEMENT CHECKLIST (every build)

This block must appear in every PR description for any agent build. Habakkuk Pattern 9 will eventually parse it; until then Marc + orchestrator hand-check.

```
- [ ] Spec at 01-CORNERSTONE-RESEARCH-GROUP/<DATE>-<NAME>-DISPATCH.md (Gate A)
- [ ] Code on feature branch (`feature/<name>-vN`), NOT main
- [ ] Habakkuk Pre-Build run output included in PR body (8 patterns)
- [ ] If gate-pass tokens used: verdict file paths included in PR diff (Rule R7)
- [ ] If "deployed" claim used: runtime ID + trace ID in PR body (Rules R1, R2)
- [ ] Anti-drift v2 9-rule block embedded byte-for-byte in agent system prompt
- [ ] WKU framing (Proverbs 24:3-4) in agent system prompt
- [ ] agents-registry.json entry added/updated (Rule R10)
- [ ] Marc explicit approval before merge (Gate Marc)
- [ ] Post-merge: Langfuse trace observed within first scheduled run window (Gate D)
- [ ] If deferred or fictional component referenced: tagged DEFERRED or FICTIONAL, not LIVE (Rule R6, §3)
- [ ] All runtime claims have a live tool call output in the commit body (Rule R4)
```

---

## §7. FAILURE MODES (and how v2 prevents recurrence)

| Failure mode (observed 2026-04-25 → 2026-05-04) | How it occurred | How v2 prevents |
|---|---|---|
| Doctrine without runtime | "Builder → KRITE → Karis → Validator" specified; runtime never built | §3 tags fictional components explicitly. Rule R1 forbids "deployed" without runtime ID. |
| Self-verification labeled as separate review | Orchestrator scored own work, called it KRITE | Rule R3 forbids. `shadow-<gate>` labeling required when agent doesn't exist. |
| Docs treated as evidence | Operating Manual cited as proof of Build Agent existing | Rule R4: docs ≠ evidence. Live tool call required. |
| Stale memory cited as live | KRITE doctrine memory cited mid-build before re-verification | Rule R5: any runtime claim >24h must be re-verified. Daily auto-audit catches. |
| Decoration language | "PASS / LIVE / DEPLOYED" used without backing | Rule R6: replacements with VERIFIED / OBSERVED / DEPLOYED-`<id>` / INCOMPLETE. |
| Phantom files on branches | Levite Gate F branch claimed files that don't exist | Habakkuk Pattern 9 (planned): scan PR body for file claims, verify each via `git show <branch>:<path>`. |
| Past claims compounding | Each new dispatch cited prior dispatches as proof; cumulative theater | Rule R5 + continuous audit + STALE auto-downgrade prevents lineage trust. |
| Memory drift through normal use | Memory entries written 2026-04-25 cited in 2026-05-04 build | Rule R5 (24h re-verification) + daily auto-audit + Rule R10 (registry as source of truth). |
| Branch-collision unobserved | Wrote on `feature/obadiah-agent` while Marc was on it; commits got swept up by his `git add .` | Procedural: orchestrator must `git branch --show-current` before any commit and create dedicated `feature/<orchestrator-task>-N` branch if Marc is on a different branch. |
| Cross-session lie chain | Past Claude session reports "Build Agent dispatched"; new session trusts the claim | Rule R5 + Rule R10 + audit log file. Past session reports are evidence of intent, not reality. |

---

## §8. MIGRATION PATH FROM OLD DOCTRINE

This v2 doctrine supersedes the old one immediately on commit. To migrate cleanly:

1. **Update MEMORY.md** to reference this file as canonical build doctrine (added entry with 🚨 tag).
2. **Tag stale memory entries:** all entries describing Build Agent / KRITE / Bezalel / Judge as deployed get `[FICTIONAL — see 2026-05-04 audit + doctrine v2]` appended OR are removed.
3. **BUILD-AGENT-OPERATING-MANUAL-v1.md** marked DEPRECATED at top of file.
4. **All future dispatches** use language from §4 Rule R6.
5. **Agents-registry.json** brought to source-of-truth state per Rule R10 (separate dispatch).
6. **Daily audit function** built per §5.1 (separate dispatch — Decision A3).
7. **Habakkuk Pattern 9** added (separate dispatch — Rule R7 implementation).

---

## §9. AMENDMENT PROCEDURE

This doctrine is a contract. Amendments require:
1. A `<DATE>-DOCTRINE-AMENDMENT-<NAME>.md` dispatch describing the change + reason.
2. Marc explicit approval.
3. Commit on feature branch with `-Co-Authored-By: Claude Opus 4.7-` and reference to this file.
4. Update MEMORY.md.
5. Habakkuk Pre-Build pattern check passes.

Self-amendment by orchestrator without Marc approval is a doctrine violation.

---

*End of operational contract.*

*Filed 2026-05-04 21:50 EDT.*
*Authority: 2026-05-04 Theater Audit (commit `dc20a04`).*
*Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>*
