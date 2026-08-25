# AEGIS Amendment — Integration Bus, Live Topology, Connector Intelligence

**Date:** 2026-08-23 · **Status:** APPROVED amendment to AEGIS V1 requirements
**Not a restart.** Extends the existing control plane; replaces nothing.

---

## 1. Current architecture (what already exists)

| requirement in the amendment | current state | verdict |
|---|---|---|
| Core control plane owns engineering truth | `gate.cjs`, `engineering-os.cjs`, `protected-paths.json`, ledger | **exists** |
| External systems may not declare PASS | gate is fail-closed; `UNAVAILABLE` blocks | **exists** |
| Capability-based routing | `tool-router.cjs` + `TOOL-CAPABILITY-CANON.json` | **exists** — extend, do not duplicate |
| Availability backed by dated evidence | canon `availabilityEvidence` | **exists** |
| Evidence/audit trail | append-only `ledger.json` (271 entries) | **exists** — this *is* the event log |
| Connector abstraction / registry | — | **missing** |
| Integration router | — | **missing** (but is a sibling of the tool router, not a new kind of thing) |
| Live topology / connector health UI | — | **missing** |

**The single most important finding:** the amendment asks for an *event bus* and
an *evidence trail*. AEGIS already has one append-only, schema-validated event
log — the ledger. Introducing a second event store would create exactly the
duplicate authority `single-authority-check.cjs` exists to prevent. **The ledger
is the event bus.** Connector events become ledger entries with `gate:"integration"`.

## 2. Smallest coherent change

Four additions, no replacements:

1. **`connector-registry.json`** — the typed registry. Same shape discipline as
   the tool canon: declared capabilities, availability with dated evidence.
2. **Integration plane marker on every connector** — `plane: "INTEGRATION"`,
   never `"CONTROL"`. Enforced by test, not by convention.
3. **`aegis-state.cjs`** — one read-only projector that reads real sources and
   emits typed state with explicit `UNAVAILABLE` / `STALE` / `UNVERIFIED`.
   Nothing else may feed the dashboard.
4. **Dashboard slice** — renders that projection and nothing else.

**Deliberately NOT built in V1:** a separate event-bus daemon, a message queue,
Make adapters, live webhooks, Notion write-back. Each would add a moving
part before the core loop has run end-to-end once.

## 3. The authority boundary (the load-bearing rule)

```
CONTROL PLANE            |  INTEGRATION PLANE
-------------------------|---------------------------
workflow engine          |  Notion, Slack, Gmail, Drive
policy / protected paths |  CRM, analytics, notifications
tool + model router      |  Make, Zapier, webhooks
gate + review binding    |  GitHub API (as a worker)
evidence ledger          |
watchdog                 |
human approval gates     |
```

A connector may **execute** `SYNC_VERIFIED_FEATURE_TO_NOTION`. A connector may
never **decide** that the feature is verified.

Concretely forbidden to every connector: marking work VERIFIED · bypassing a
stage · approving its own execution · modifying policy · removing a review gate ·
declaring tests or runtime PASS · suppressing findings · changing product truth ·
creating a checkpoint · overriding the watchdog or a human gate.

This is enforced mechanically: the projector refuses to load a registry entry
whose `plane` is not `INTEGRATION`, and a test asserts a control-plane connector
is rejected.

## 4. Connector abstraction

Every connector declares which operations it supports — no operation is assumed:

`CONNECT · DISCONNECT · HEALTH_CHECK · READ · WRITE · SEARCH · CREATE · UPDATE ·
DELETE · TRIGGER · STATUS`

and reports: `status · authStatus · lastHealthCheck · lastSuccess · lastFailure ·
failureCount · latencyMs · rateLimit · permissions · dependentWorkflows ·
environment · riskLevel`.

Health vocabulary: `HEALTHY · DEGRADED · FAILED · DISCONNECTED · AUTH_EXPIRED ·
RATE_LIMITED · UNKNOWN`. **`UNKNOWN` is the default** — a connector that has
never been probed is UNKNOWN, never HEALTHY. Optimism by default is how an
outage stays invisible.

## 5. Integration router — preference order

For a required external action, choose the **smallest reliable path**:

1. **Direct API** — preferred for a simple, reliable, single-system action.
2. **Built-in / plugin / MCP** — when already authenticated and in-process.
3. **Automation platform (Make)** — only for genuinely multi-system business
   workflows.

Selection inputs: capability · availability with evidence · permissions ·
historical failure rate · latency · security/data class · cost.

**Never route a simple direct API call through an automation chain.** Each hop
is a place the action can fail silently and a place the truth can be laundered.

## 6. Failure isolation

Engineering state and integration state are separate fields, always:

```
ENGINEERING STATUS : READY_FOR_PR      (control plane)
DOCUMENTATION SYNC : FAILED            (integration plane)
CONNECTOR          : notion
RETRY              : AVAILABLE
```

A failed connector **never** downgrades verified engineering. A failed sync is
**never** rendered as successful. Two states, two fields, no blending.

## 7. Idempotency

Every meaningful external operation carries `operationId` (deterministic from
objective + workflow + target), `correlationId`, `attempt`, `ts`, `result`.
A retry with the same `operationId` is a no-op at the target. Destructive
operations are never blindly repeated.

## 8. Events

Connector and workflow events are **ledger entries**, not a new store:
`gate: "integration"`, `status: PASS|BLOCKED|FAILED`, plus operation ids.
This inherits append-only semantics, the existing schema, and the existing
audit tooling for free.

## 9. Live topology + drift visualisation

Nodes render only for systems **actually configured**. Node state is derived
from real sources and may be: `PENDING · ACTIVE · PASS · WARNING · FAILED ·
BLOCKED · WAITING_FOR_HUMAN · UNAVAILABLE · DEGRADED · UNKNOWN`.

**Process drift** is the signature view: the required stage sequence is declared,
the actual evidence is compared against it, and any stage with no evidence is
rendered as a break in the path with the missing gate named. This is not a
decoration — it is the gate's own `--gate-done --json` output drawn as a line.

## 10. Test plan

| test | proves |
|---|---|
| control-plane connector rejected | the authority boundary is mechanical |
| unprobed connector is UNKNOWN, never HEALTHY | no optimistic default |
| stale timestamp renders STALE with age | aged data cannot pose as live |
| missing source renders UNAVAILABLE | absence is visible |
| failed sync + verified engineering coexist | failure isolation |
| same operationId twice is one operation | idempotency |
| no fabricated node/edge/percentage in output | reality-bound |

## 11. V1 vs deferred

**V1:** connector registry · authority boundary enforcement · state projector ·
topology + drift + connector health slice · ledger-as-event-bus.

**Deferred:** Make adapters · Notion write-back · webhooks · realtime push ·
3D spatial layer · voice · historical model learning.

## 12. Risks

| risk | mitigation |
|---|---|
| second event store appears beside the ledger | ledger is the only event sink; single-authority check |
| dashboard becomes a second source of truth | projector is strictly read-only, derives nothing it cannot cite |
| connector optimism hides an outage | UNKNOWN default; staleness is computed, not asserted |
| visual layer drifts from real state | every rendered field carries a provenance path |
