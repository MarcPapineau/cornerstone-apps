# CAPABILITY CANON — the routing layer

**Status:** v1.0 proposed · seeded from what this workspace verifiably already uses
**Date:** 2026-08-25
**Home:** `builder-control/capability-canon.json` · `builder-control/capability-check.cjs`
**Mandate:** *Never let a model build something when a tool already does it better.*

---

## 0. The one-sentence problem

Builder Control already knows **who** may act, **where** they may write, and **what** they may say. It does not know **what can do what** — so when an agent is asked for a video, nothing in the system stops it from producing a slideshow and calling it one.

That is the whole gap. This layer closes it, and it closes it in the shape the workspace already uses: **a declarative JSON registry, one checker, the gate, CI.** No new plane, no new vocabulary, no second control loop.

---

## 1. Where this sits

| Registry | Question it answers | Status |
|---|---|---|
| `agent-registry.json` | **Who** may act, and on what paths | shipped |
| `protected-paths.json` | **Where** writes are forbidden | shipped |
| `doctrine-rules.json` | **What** may be written | shipped |
| **`capability-canon.json`** | **With what** — one capability, one default tool | **this file** |

Four registries, one loop. `capability-check.cjs` is the fourth checker, and it reads its registry the same way `doctrine-check.cjs` reads its own.

---

## 2. The routing law: REUSE → ROUTE → BUILD

> Reuse what this workspace already ships. If nothing here does it, **ROUTE** to the canonical external tool. Only **BUILD** when the row's escape hatch applies — and name which one, in the packet.

### Why the middle step had to be added

The consolidation doctrine as written today says *reuse > rebuild; add no new dependency; no second charting library*. That rule is correct, and `VITALIS-TOOLING-DECISION-MATRIX.md` applies it well. But it is a **bundle-weight** rule that lives inside one codebase — and an agent reading it in isolation draws exactly the wrong conclusion:

> "Add nothing. So I'll write it myself."

Which is the failure being complained about. The two rules only look alike:

| | Axis | Says |
|---|---|---|
| **Consolidation** | inside a codebase | Don't add a second thing that does what you already have |
| **Routing** | across capability | Don't become the thing a specialist already is |

`ROUTE` is the reconciliation. **Calling a specialist service is not adding a dependency — it is declining to become one.** Seedance is not a bundle cost; hand-rolling video generation is.

---

## 3. The row shape

One capability per row, and every field earns its place:

- `default` / `fallback` — the answer, and the answer when the answer is down
- `neverBuild` — **the sentence a blocked agent reads.** Not a category, a specific refusal
- `escapeHatch` — the one legitimate reason to build instead. `"None."` means the row cannot be built here, full stop, and the checker enforces that
- `costModel` — a router that cannot see cost cannot choose within a budget
- `evidence` — where the choice is proven here. `"unproven"` is an honest value and 7 rows carry it
- `verdict` — `Deploy | Test | Monitor | Ignore`, the **same vocabulary as `scout-diff.schema.json`**, so a scout row promotes into the canon without translation
- `canon` — the doc that makes it a rule. A routing verdict that can't cite authority gets argued with

---

## 4. What is enforced, and what deliberately is not

**Enforced — at the packet.** A packet declares `routing[]`: one entry per capability the work touches. Four violation classes, all proven firing against `packets/CAP-routing-block-demo.json`:

| Rule | Fires when |
|---|---|
| `CAP-BUILD-NO-REASON` | BUILD without naming an escape hatch |
| `CAP-NO-ESCAPE-HATCH` | BUILD on a row whose escape hatch is `None.` |
| `CAP-OFF-CANON-TOOL` | ROUTE to a non-default tool with no stated reason |
| `CAP-UNKNOWN-CAPABILITY` | a capability that isn't in the canon — how parallel stacks start |

**Deliberately not enforced — file content.** Regex-scanning a diff for *"did this agent hand-roll a video encoder"* produces false positives, and **a gate nobody trusts is a gate everybody bypasses.** The packet is where the decision is actually made, so that is the only place it is checked.

**Grandfathered.** A packet with no `routing[]` reports `UNDECLARED` and exits 0. Retro-failing the existing packets would teach the fleet that this checker is noise. It tightens to `block` once new packets carry routing as a matter of course.

---

## 5. How the canon stays current without anyone maintaining it

The pieces for this already exist and are simply not connected:

```
  DANIEL weekly scout  →  scout-sidecar.cjs  →  scout-diff JSON
        (discovery)          (already built)     (verdicts: Deploy/Test/Monitor/Ignore)
                                                        │
                                                        ▼
                                            ── Marc approves a Deploy ──
                                                        │
                                                        ▼
                                            capability-canon.json      ← the canon
                                                        │
                                                        ▼
                                   capability-check.cjs → gate → ledger
```

Today the scout's verdicts die in a markdown file. Nothing binds *"Deploy: Seedance for video"* to a rule that stops an agent hand-rolling one. **One-way promotion — a tool enters the canon only via a Deploy verdict plus a Marc approval — gives a self-updating canon that cannot drift**, using machinery already built.

The natural next build is `scout-promote.cjs`: read the sidecar, diff `Deploy` verdicts against the canon, emit the proposed rows. It proposes; it never writes.

---

## 6. The gaps are the deliverable

`node builder-control/capability-check.cjs --coverage` reports **14 canon · 3 candidate · 6 GAP**. The gaps are the most useful output in the file, because a gap that is written down gets scouted and a gap that isn't gets hand-rolled at 2am:

| Gap | Why it matters |
|---|---|
| `video-assembly` | Generation is not delivery. A pile of clips is not a video — this is where most "AI video" work actually fails |
| `image-generation` | Currently the failure is a gradient or an emoji standing in for a commissioned asset |
| `social-publishing` | Per-platform auth and rate limits become permanent maintenance the day they change |
| `transcription` | Without it, a model guesses at audio it cannot hear |
| `web-research` | DANIEL's 5-source floor is enforced by a rubric, not a tool |
| `design-source` | The token system is the fallback; nothing holds the visual source of truth |

`video-generation` and `video-assembly` are **both** gaps in practice, and they are the pair that has to be closed together for the video lane to be real.

---

## 7. Recommendations that are not code yet

**7.1 — Add a Capability Coverage panel to AEGIS.** The dashboard shows Connector Health: three connectors, the plumbing. It does not show whether the company can *do* things. `--coverage --json` emits exactly that panel: per capability — canonical tool, authenticated, last exercised, cost. **A capability with a healthy connector and no run record in 90 days is not a capability, it's a subscription.**

**7.2 — Put cost in the ledger, not just the canon.** Routing to the best tool every time is unbounded spend by construction. The canon carries `costModel` so the router can choose; the ledger should carry actual spend per packet so the Evidence + cost surface shows real numbers. Without the second half, "always use the best tool" has no brake.

**7.3 — Exercise the watchdog and rollback first.** AEGIS currently reports steps 09 (Watchdog sequence) and 10 (Checkpoint + rollback) as `UNVERIFIED — no run record exists`. Layering capability routing on top of an unexercised rollback path means the first bad automated route has nothing to undo it. That is the system's own gate saying so, and it is cheap to clear.

**7.4 — The knowledge mirror is memory, never authority.** AEGIS reports it `DISCONNECTED`. When it is connected, the rule in the canon row holds: an agent may write to the mirror and must never read a decision back out of it and treat it as canon. Canon lives in the repo. A mirror that becomes an input is a second source of truth.

**7.5 — Reconcile the roster before adding agents.** `agent-registry.json` already flags nine doctrine-roster names (solomon, ezra, joseph, luke, samuel, judge, levite, lazarus, benaiah) with no infra entry, correctly declining to invent them. Adding capability routing across a roster that isn't reconciled spreads the ambiguity. It is a Marc decision and it is still open.

---

## 8. Usage

```bash
# what can this company actually do
node builder-control/capability-check.cjs --coverage

# the same, for the AEGIS panel
node builder-control/capability-check.cjs --coverage --json

# check a packet's routing before dispatch
node builder-control/capability-check.cjs --packet builder-control/packets/<packet>.json
```

Adding a capability: append a row to `capability-canon.json` following `howToAddACapability`. Do not write a second checker.
