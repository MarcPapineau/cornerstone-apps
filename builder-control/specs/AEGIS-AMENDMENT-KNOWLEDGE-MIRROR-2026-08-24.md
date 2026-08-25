# AEGIS Amendment — Non-Disruptive Knowledge + Integration

**Approved:** Marc Papineau, 2026-08-24 · **Status:** ADDITIVE ONLY

## What this does not change

Workflow Engine · Policy Engine · Watchdog · Evidence Engine · Model Router ·
GitHub source-of-truth · agent structure · anti-drift logic. Nothing above is
replaced, and this amendment introduces no second workflow engine, no second
sync system, and no second source-of-truth rule.

## Current state, honestly

Already satisfied by the existing build:

| requirement | where it already lives |
|---|---|
| connector abstraction + registry | `connector-registry.json` |
| connector health, staleness, UNKNOWN default | `aegis-state.cjs` |
| integration/engineering failure isolation | separate `engineering{}` / `integration{}` objects |
| external systems cannot hold authority | `plane !== INTEGRATION` → refused, exit 3 |
| event source | the canonical ledger — no second event store |
| Make as current integration plumbing | `make` is the active `INTEGRATION` plane connector in the registry |

Gaps this amendment closes:

1. Sync state was not modelled at all — a Notion write had no state to be in.
2. There was no conflict rendering when Notion disagrees with AEGIS.
3. The ledger could not carry `operationId`/`correlationId`/`attempt`, so
   external writes could not be made retry-safe or de-duplicated.
4. Nothing mechanically stopped a Notion-sourced claim from being read as
   evidence.

## Sync states

`SYNCED` · `PENDING` · `STALE` · `FAILED` · `CONFLICT` · `DISCONNECTED`

Tracked **separately** from engineering state. Two independent facts:

```
Engineering:  VERIFIED
Notion:       SYNC FAILED
```

is a valid, renderable pair. A failed sync never downgrades engineering, and a
sync is never rendered `SYNCED` unless the write actually occurred and returned
a result. `PENDING` is not optimism — it means dispatched and unconfirmed.

## Notion may not self-certify

Mechanically refused, not discouraged. A knowledge record may not assert:
tests passed · feature verified · checkpoint created · review bypassed ·
watchdog overridden · policy altered · architecture truth changed.

A record carrying any such assertion is **REFUSED** at load with
`AEGIS-KNOWLEDGE-SELF-CERTIFICATION`, the same way a `CONTROL`-plane connector
is refused. The reason is identical: the moment an external store can say
"verified", it becomes the brain, and it will be wrong exactly when it matters.

## Conflict handling

When the knowledge mirror and AEGIS disagree on a feature's state, the
projector emits a `CONFLICT` with **both** values and resolves nothing:

```
SOURCE-OF-TRUTH CONFLICT
  notion   : DONE
  aegis    : NOT VERIFIED
  required : Product Owner decision
```

Automatic resolution is prohibited. Silently preferring either side would
destroy the only signal that something is wrong.

## Human input flows one way

An approved Product Owner change in Notion becomes a **PROPOSED** objective and
enters the normal loop: objective → requirement analysis → risk classification →
build → review → gate. It never modifies code directly, and it never skips a
stage. Proposals are inert until they enter the workflow.

## Retry safety

Every external operation carries `operationId`, `correlationId`, `attempt`, and
`result`. Re-appending the same `operationId` is a **no-op**, not a second
record — this is what makes a retry safe rather than duplicating a page, an
issue, a release, or a notification.

## Security and data minimization

The knowledge mirror holds structured fields only — never raw agent transcripts,
never diffs, never credentials. Retrieval is scoped to the selected context; the
full knowledge base is never dumped into model context.

## What is deferred

- Live Notion API reads/writes. The connector is `DISCONNECTED`; this amendment
  models the states and refusals, and performs **no** external calls.
- Make execution. Modelled as the active integration-plane connector, not invoked.
- Notion database provisioning. Requires credentials and an authorized mutation,
  which this pass forbids.

Everything deferred above is reported as `UNAVAILABLE` or `DISCONNECTED` in the
dashboard rather than assumed working.
