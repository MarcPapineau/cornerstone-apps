# Builder Control — Escalation Map (routing contract)

**Status:** Sprint 1 addition · routing **policy/contract** · subordinate to `builder-control/CONTROL-CONTRACT.md`
**Date:** 2026-06-22

## What this is (and is not)

This file defines **where a gate decision should go** — the severity of each block and the human/route it should reach. It closes the "a block hard-stops + ledgers, but nothing is *routed*" gap identified in Sprint 0 §3 (escalation rules 🔴).

**Anti-theater scope statement (read this):**
- **Automatic TODAY:** every gate decision (PASS and BLOCK) already appends a `builder-control/ledger.json` entry — that is real and runs now (`gate.cjs` → `ledger-writer.cjs`).
- **Defined here, NOT yet wired:** Telegram / `spawn_task`-chip delivery. This document is the **routing contract** a future *thin notifier* will read. **No notifier is installed this sprint.** Until one is, the ledger entry is the system of record and routing is operator-driven (a human reading the ledger / hook output). This file does not claim to send anything.

The opt-in git hooks (`builder-control/hooks/`) are the enforcement on-ramp; this map is the response policy once a block fires.

---

## Severity tiers

| Tier | Meaning | Examples |
|---|---|---|
| **S1 — Canon/authority breach (non-overridable)** | A non-overridable rule fired; an agent tried to invent authority, dose out of canon, leak gov-authority framing, or perform a forbidden op | `BC-FORBIDDEN-TASK`, `BC-INVENTED-AUTHORITY`, `BC-DOSING-OUT-OF-CANON`, `BC-GOV-AUTHORITY-LEAK` |
| **S2 — Exposure / release breach** | A public push or customer-facing release was attempted without authorization / KRITE | `BC-PUBLIC-PUSH`, `BC-CUSTOMER-COPY-NO-KRITE`, `BC-PROTOCOL-NO-LINEAGE` |
| **S3 — Protected-write / process** | A protected path or drift-script block fired; usually a missing packet or real drift to fix | `BC-PROTECTED-WRITE`, `BC-NO-PACKET`, `BC-DRIFT-DETECTED` |
| **S4 — Convergence / repeat** | Not a single gate block — a BL-13 pattern: same correction 2+ times, degrading quality, or convergence stall | (cross-cutting; see BL-13) |

---

## Routing by tier

| Tier | Ledger (auto, now) | Defined target route (future notifier) | Human action |
|---|---|---|---|
| **S1** | BLOCKED entry, `blockRule` set | **Telegram → Marc chat `8617287533`** (immediate) | Marc decides: amend registry/canon, or reject the work. Output is **quarantined** (DIRECT-AGENT-BYPASS) — not used. |
| **S2** | BLOCKED entry | **Telegram → Marc `8617287533`** (release/exposure decision) | Obtain `authorization.allowsPublicPush` / KRITE approval / lineage evidence, then re-run. |
| **S3** | BLOCKED entry | **`spawn_task` chip** (deferrable fix) | Supply a conforming packet or fix the drift the shelled script names, then re-run. |
| **S4** | n/a (telemetry) | **Telegram → Marc `8617287533`** (recovery-path confirm) | Enter BL-13 Diagnostic Mode; do **not** iterate again until Marc confirms the recovery path. |

All tiers: the ledger entry is the durable record regardless of whether a notifier exists.

---

## Stop conditions that force escalation (source: DIRECT-AGENT-BYPASS-CONTROL-2026-06-18 §Stop Conditions)

These are pre-existing; restated so the route is unambiguous. Any one → STOP + S1/S4 route to Marc:

- Gold Standard doctrine file is missing.
- **Two canonical owners collide.**
- A worker tries to infer dosing/schedule content instead of using canonical data.
- Claude Code fails twice on the same delegated code issue.
- KRITE has not approved a protected customer-facing artifact.
- Marc issues STOP / delegate / canon / source-of-truth / protocol-interrupt language during active work.

---

## When the notifier is built (future — not this sprint)

A thin notifier should:
1. Tail `builder-control/ledger.json` for new `status:"BLOCKED"` entries.
2. Map `blockRule` → tier (table above).
3. Deliver to the tier's route (Telegram `8617287533` for S1/S2/S4; chip for S3).
4. Write nothing back to the ledger except (optionally) a delivery-confirmation entry.

It must be **fail-loud** (a delivery failure is itself surfaced, never silently dropped) per GARVIS Operational-Truth doctrine. Building it is a separate, Marc-approved step — it is intentionally **out of scope** for Sprint 1.
