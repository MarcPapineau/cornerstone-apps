# CRG Agent Handoff Pattern (LOCKED 2026-04-21)

**One pattern for every inter-agent handoff. No exceptions without a doctrine update.**

Ratified after Wave 1d audit found the agent queue empty because no producer/consumer pair actually enqueued work. First wire: **Daniel → Apollos** (top-story content pipeline). Every future wire (Lazarus → Abigail, Martha → Nehemiah, Lydia → Apollos, etc.) follows this shape exactly.

## The contract

```
Producer agent                 agent-event.js router              Consumer agent
──────────────                 ─────────────────────              ──────────────
  emit(event, source, payload)  →  route in HANDLERS  →  bus.enqueue(item)
                                                              ↓
                                                         Blob-backed queue
                                                              ↓
                                                     consumer draws via
                                                     bus.queueOpenFor(agent)
                                                     on its next scheduled run
```

### Rules

1. **Producer never touches the consumer's filesystem or function URL directly.** The only write the producer makes is `bus.emit(eventName, "producer", payload)`. No direct `bus.enqueue` from the producer — the router owns queue shape.
2. **Event name is a typed contract.** `brief.top_story`, `call.completed`, `score.failed`. Past-tense noun phrase. Adding a new event means adding a handler in `agent-event.js` HANDLERS. Never fire an event with no registered handler in production.
3. **Router is the one place queue-item shape is decided.** Tier, priority, escalation rule, and fan-out count all live in `agent-event.js`. Producers stay thin.
4. **Consumer polls its inbox on its own schedule.** Consumer calls `bus.queueOpenFor("consumer-name")` at the top of each scheduled run, claims items with `bus.claim(itemId, "consumer-name")`, processes, emits `queue.item.done` (implicit via `bus.updateStatus(item.id, "done")`).
5. **One event can fan out to N queue items.** Example: `brief.top_story` from Daniel produces THREE `content-brief` items for Apollos (blog + LinkedIn + Instagram). Fan-out decision lives in the router.
6. **Idempotency is the consumer's job.** If the consumer runs twice, the claim-or-skip pattern (`bus.claim`) prevents double-processing. Don't build dedup into producers.
7. **Every handoff goes through KRITE (yellow tier) or Samuel (red tier) before reaching Marc.** No agent emits to `to: "marc"` as its primary payload channel — that's the escape hatch for escalations only.

## Reference implementation: Daniel → Apollos

### Producer (`daniel-background.js` · after opus synthesis)

```js
await bus.emit("brief.top_story", "daniel", {
  topic      : brief.cover.headline,
  headline   : brief.cover.headline,
  body       : brief.cover.deck,
  tier       : brief.cover.tier,         // T1 | T2 | T3 | T4
  marc_angle : brief.cover.marc_angle,
  cite_urls  : [brief.cover.url],
  traceId    : trace,
  dateET     : dateKeyET(),
});
```

Top 1–2 stories per daily brief. Selection: cover (always) + first section with a non-trivial `marc_angle`. Capped at 2 to avoid flooding Apollos's KRITE-gated pipeline.

### Router (`agent-event.js · HANDLERS["brief.top_story"]`)

Fans out to three `content-brief` queue items, one per channel (blog, LinkedIn, Instagram). Each carries a `brief_text` string pre-assembled from headline + body + Marc angle + citations so the consumer doesn't need to know the producer's schema.

### Consumer (`apollos-background.js`)

Already drains `content-brief` items on its scheduled runs (13:00 + 17:00 UTC, Mon–Fri). Uses `payload.type` or `payload.channel` to choose the right generator schema (blog / linkedin / instagram / newsletter). KRITE-gated; pass → `content.drafted` event; fail → `score.failed` → Marc red-tier queue.

No change to Apollos code required. That is the point of the pattern.

## Applying the pattern to future handoffs

| Handoff | Event name | Router fan-out | Consumer type(s) |
|---------|------------|----------------|------------------|
| Lazarus → Abigail | `call.qualified` | single item | `outbound-call` |
| Martha → Nehemiah | `daily-brief.delivered` | single item | `heartbeat-refresh` |
| Lydia → Apollos | `brief.queued` | single item (already wired) | `content-brief` |
| Asaph → Apollos | `brief.queued` | single item (already wired) | `content-brief` |
| Abigail → Samuel | `call.completed` | single item (already wired) | `score-call` |
| Samuel → Marc | `agent.retrain_required` | single item (red) | `retrain-required` |

Pattern checklist before shipping a new handoff:

- [ ] Event name registered in `agent-event.js` HANDLERS
- [ ] Producer emits via `bus.emit(event, source, payload)` ONLY — no direct enqueue
- [ ] Router decides tier / priority / escalation
- [ ] Consumer has a scheduled run that calls `bus.queueOpenFor("<name>")`
- [ ] Consumer uses `bus.claim` before processing (idempotency)
- [ ] Terminal status emits via `bus.updateStatus(id, "done"|"blocked")`
- [ ] Red-tier escalations carry an `escalation_rule` (`marc-24h`, `marc-48h`, `marc-72h`)

## Why this pattern (vs alternatives)

- **Direct fetch-to-consumer URL**: tempting but fragile — consumer must be warm, and you lose the queue-history audit trail.
- **Producer writes to shared file**: what we had before Wave 1d. Ephemeral Lambda fs means writes disappear. The Blob-backed queue is the fix.
- **Consumer polls producer**: inverted coupling — producer's schema leaks into every consumer.

The LangGraph supervisor pattern (producer emits typed events; router fans out; consumers claim and acknowledge) is the shape mature agent infra lands on. Sierra, Cognition, Cursor, and Anthropic's internal tooling all converge here. We adopt it explicitly.

— Locked 2026-04-21. Deviation requires a new doctrine entry.
