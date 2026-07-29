# Builder Control — Drift Taxonomy (consolidation index)

**Status:** Sprint 1 addition · consolidation only · **introduces ZERO new rules**
**Owner:** subordinate to `builder-control/CONTROL-CONTRACT.md` (the canonical Agent Control Layer SoT)
**Date:** 2026-06-22

This file unifies, in one place, the three drift vocabularies that already exist across the workspace so an operator (or a future notifier) can read one table instead of three. It **defines nothing new** — every row points back to its canonical source. If this file ever disagrees with a source, the source wins and this file is the bug.

The three pre-existing vocabularies:
1. **The 5 canonical drift *types*** — `memory/doctrine_drift_cancer_governance_model.md` (Drift = Cancer, locked 2026-05-11).
2. **The 10 enforcement *RULE-IDs*** — `builder-control/CONTROL-CONTRACT.md` §6 (the gate's HARD-BLOCK set).
3. **The agent-health *fail_reasons*** — `AGENT-ORCHESTRATION-SPINE-REPAIR-2026-06-14.md` (the fail-closed health compiler).

---

## A. The 5 canonical drift types (source: Drift = Cancer doctrine)

| # | Drift type | Meaning |
|---|---|---|
| 1 | **Specification Drift** | Build diverges from operator intent |
| 2 | **Goal Drift** | System optimizes for the wrong success metric |
| 3 | **Runtime Drift** | Claimed functionality diverges from actual operational state |
| 4 | **Context Drift** | Old / stale information resurfaces incorrectly |
| 5 | **Capability Drift** | System attempts outcomes beyond current tooling / stack capability |

These are the classification buckets. Every enforcement block and every health failure below maps to one or more of them.

---

## B. The 10 enforcement RULE-IDs → which drift type they stop (source: CONTROL-CONTRACT §6)

The gate (`gate.cjs`) is the runtime-enforcement layer (Layer 3 of the 4-layer governance model). Each RULE-ID below is defined authoritatively in CONTROL-CONTRACT §6 — this column only *classifies* it against the 5 types and notes whether a task-packet `authorization{}` can override it.

| RULE-ID | Stops (drift type) | Packet-overridable? |
|---|---|---|
| `BC-PROTECTED-WRITE` | Context / Specification | YES — `authorization.allowsProtectedPaths[]` names the exact path |
| `BC-PUBLIC-PUSH` | Runtime (exposure) | YES — `authorization.allowsPublicPush === true` |
| `BC-NO-PACKET` | Specification | YES — supply a conforming task packet |
| `BC-FORBIDDEN-TASK` | Capability / Goal | **NO** — Marc amends the registry |
| `BC-INVENTED-AUTHORITY` | Goal / Capability | **NO** — route to canonical owner |
| `BC-CUSTOMER-COPY-NO-KRITE` | Goal / Runtime | YES via the KRITE release gate (`--require-krite-approved`), not a bare flag |
| `BC-GOV-AUTHORITY-LEAK` | Goal (authority framing) | **NO** — content fix required |
| `BC-DOSING-OUT-OF-CANON` | Context / Capability | **NO** — source from `protocol-core` canon |
| `BC-DRIFT-DETECTED` | Specification / Context | YES — fix the drift the shelled script names |
| `BC-PROTOCOL-NO-LINEAGE` | Specification (evidence) | YES — add brain-sourced `discoveryLineage` evidence |

The four **NOT-overridable** rules (`BC-FORBIDDEN-TASK`, `BC-INVENTED-AUTHORITY`, `BC-DOSING-OUT-OF-CANON`, `BC-GOV-AUTHORITY-LEAK`) are the "no parallel canon / no invented authority" non-negotiables from `DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md`. Only Marc amending `agent-registry.json` / `protected-paths.json` changes them.

---

## C. Agent-health fail_reasons → drift type (source: spine-repair health compiler)

These are emitted by `scripts/lib/agent-health-compiler.js` into `data/agent-health-current.json`. They are *telemetry* (Layer 3/4), not gate blocks, but they classify into the same 5 types so one drift dashboard can span both.

| fail_reason | Drift type | Notes |
|---|---|---|
| `scorecards_untrusted` | Runtime | scorecards stale / all-zero / placeholder → not trustworthy |
| `legacy_n8n_dependency_blocked` | Capability | n8n decommissioning; legacy dependency, migration candidate not bug |
| `protocol_drafter_quarantined` | Goal / Specification | Protocol Drafter bypassed canon (Angela incident) → quarantined |
| `agent_down` | Runtime | claimed-functional agent has no proven current output path |
| `agent_degraded` | Runtime | partial / cadence-gap operation |

---

## D. On detection — the standing protocol (source: Drift=Cancer §enforcement + BL-13)

This is the existing protocol, restated for convenience (not new):

1. **Stop** — do not blindly continue iterating.
2. **Diagnose** — what is actually happening.
3. **Classify** — which of the 5 drift types (§A).
4. **Root cause** — doctrine / orchestration / tooling / stack / capability / workflow / runtime.
5. **Propose correction.**
6. **Prevent recurrence** (test / guard / structural change).

`BL-13` (`memory/rule_bl13_anti_drift_escalation_protocol.md`) escalation applies: **2+ same correction, persistent structural issue, or degrading quality → STOP normal iteration, enter Diagnostic Mode.** Routing of a detected/blocked event to a human is defined in `builder-control/ESCALATION-MAP.md`.

---

## E. What this file is NOT

- Not a new rule set — see CONTROL-CONTRACT §6 for the authoritative rules.
- Not a runtime — the gate enforces; this is a reading aid.
- Not a place to add rules. New rules go in CONTROL-CONTRACT §6 (and the gate / boundary-checks), then get *referenced* here.
