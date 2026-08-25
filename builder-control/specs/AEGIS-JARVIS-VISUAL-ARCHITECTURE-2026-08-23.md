# AEGIS — JARVIS Visual Architecture

**Date:** 2026-08-23 · **Status:** APPROVED amendment · enhances the control
surface, changes no core architecture.

**Routed through the existing Tool Router, not assigned by preference:**

```
$ node builder-control/tool-router.cjs --task design.visual-architecture
ROUTE: codex-local (SUBSCRIPTION_CLI; INCLUDED)
$ node builder-control/tool-router.cjs --task design.visual-critique
ROUTE: grok-cli (SUBSCRIPTION_CLI; UNKNOWN)
```

Architect and critic are **different tools**, and `design.visual-critique`
declares `generalistFallback: FORBIDDEN` with `codex-local` deliberately absent
from its preferred list. A design critiqued by its own author is not critiqued.

---

## A. Information architecture

Three levels, and nothing deeper — depth is where operational dashboards go to
die:

```
L0  CONTEXT BAR      which entity am I looking at · global health · last refresh
L1  OPERATIONAL VIEW one primary view at a time (Topology / Evidence / Connectors)
L2  INSPECTOR        detail for exactly one selected node, in a side panel
```

The organising question at L1 is always *"what is true right now, and what is
blocking?"* — never *"what data do we have?"*.

Panel priority is computed, not fixed. Ordering rule, highest first:
**BLOCKED → FAILED → DRIFT → WAITING_FOR_HUMAN → DEGRADED → STALE → UNAVAILABLE
→ ACTIVE → PASS.** A panel with nothing to say sinks; it never occupies prime
space to look busy.

## B. Layout

```
┌───────────────────────────────────────────────────────────────┐
│ CONTEXT BAR   entity ▾ · subject 7f3a… · refreshed 4s ago      │
├──────────────────────────────────┬────────────────────────────┤
│ WORKFLOW TOPOLOGY + DRIFT        │ INSPECTOR                  │
│ (primary — the signature view)   │ selected node detail       │
│                                  │ provenance path            │
├──────────────────────────────────┤ required vs actual evidence│
│ CONNECTOR HEALTH   REVIEWERS     │                            │
└──────────────────────────────────┴────────────────────────────┘
```

## C. Context Pivot

One control reorganises the whole surface around an entity (a repo, a project,
an objective). It is a **filter over real state**, never a data fetch that can
invent scope:

1. resolve the entity against configured sources; unresolvable → `UNAVAILABLE`,
   never an empty-but-confident view
2. re-scope topology, connectors, reviewers, events to that entity
3. anything with no data under the new scope renders `UNAVAILABLE`, not zero

**A pivot may never change a state value — only what is in view.** If pivoting
could alter a status, the pivot would be a source of truth.

## D. Live System Topology

Nodes render only for systems actually configured. Node states:
`PENDING · ACTIVE · PASS · WARNING · FAILED · BLOCKED · WAITING_FOR_HUMAN ·
UNAVAILABLE · DEGRADED · UNKNOWN`.

Every node carries a **provenance path** — the file or command its state came
from — and the inspector shows it. A node that cannot cite its source is a bug,
not a node.

## E. Process drift (the signature view)

The required stage sequence is declared; actual evidence is compared to it.
A stage with no evidence renders as a **visible break** in the path with the
missing gate named. This is the gate's own `--gate-done --json` drawn as a line
— no separate judgement, no second opinion about what "done" means.

## F. Large-screen Command Center

A wall-monitor mode readable at 3 metres: topology fills the canvas, the
inspector collapses, type scales up one step, and only items at DEGRADED or
worse are shown. It answers, without interaction: *what is failing, what is
drifting, what is waiting on me.*

## G. Agent & reviewer visualisation

Each required reviewer is a node showing role · tool · availability with its
evidence · disposition if a record exists · the subject hash it is bound to.
**No record ⇒ `UNVERIFIED`, never an implicit pass.** A reviewer that could not
run shows `UNAVAILABLE` with the concrete reason.

## H. Motion system

Motion is a **status channel**, not decoration. Four behaviours only:

| motion | means | fires when |
|---|---|---|
| slow pulse (2s) | ACTIVE | a real process is running |
| flowing edge | transfer in progress | only while a real transfer is open |
| single shake (150ms) | a state just went FAILED/BLOCKED | on a real transition |
| settle (200ms ease-out) | reached PASS | on a real transition |

Everything else is static. **Nothing animates on a timer.** If a pulse can run
without a corresponding real event, it is fake activity and must be deleted.

`prefers-reduced-motion: reduce` → all four collapse to instant state changes.
No information is carried by motion alone; every motion state is also a label
and a colour.

## I. Design tokens

Dark command-center ground, restrained. Semantic tokens only — no raw hex at
call sites, so a status colour has exactly one definition.

```
--bg-0 #0b0e13   --bg-1 #131820   --bg-2 #1b2230   --line #2a3444
--text-0 #e6edf7 --text-1 #9fb0c8 --text-2 #6b7c96
--pass #3fb98a  --active #4aa3ff --warn #e0a33e
--fail #e5484d  --blocked #b45cf0 --stale #8a94a6 --unknown #566073
--focus #4aa3ff (3:1 min against every surface)
```

Type: system UI stack, 6 sizes, tabular numerals for anything numeric.
Spacing: 4px base. Radius: 6px. Elevation by 1px border + background step —
no drop shadows, which read as decoration at a distance.

## J. Accessibility

- WCAG AA: body ≥ 4.5:1, large text and non-text state indicators ≥ 3:1.
- **Status is never colour-only** — always colour + label + shape/icon.
- Full keyboard path: `Tab` between nodes, `Enter` inspect, `Esc` close,
  arrow keys along a topology path. Visible 2px focus ring, never suppressed.
- Topology exposed as a list to assistive tech: each node a listitem with
  `aria-label` "<name>: <state> — <reason>". The SVG is `aria-hidden`; the
  accessible tree is the list, so screen readers get facts, not geometry.
- Live region (`aria-live="polite"`) announces state changes, not refreshes.
- Honours `prefers-reduced-motion` and `prefers-contrast`.

## K. Performance

- First meaningful paint from local state < 200ms; no network on load.
- The projection is a single JSON read — no per-node fetches.
- Topology is inline SVG (tens of nodes, not thousands): no library, no WebGL,
  no layout thrash.
- Refresh is explicit or polled at ≥ 5s; **staleness is displayed, never hidden
  by a spinner.**
- Budget: < 60KB total, zero external requests, zero fonts to download.

## L. 2D vs 3D responsibility map

| concern | 2D (required) | 3D (optional, deferred) |
|---|---|---|
| workflow topology + drift | **yes — authoritative** | may add depth only |
| connector health | **yes** | no |
| reviewer/evidence status | **yes** | no |
| provenance + inspector | **yes** | no |
| keyboard + screen reader | **yes** | not a substitute |
| large multi-project constellation | — | candidate for V2 |

**The 2D layer is the product.** 3D is an optional enhancement that may never
own a fact. With WebGL disabled, nothing is lost — which is the acceptance test,
not a fallback story.

## M. Responsive behaviour

| width | layout |
|---|---|
| < 720px | single column; topology becomes a vertical stage list; inspector full-screen |
| 720–1279px | topology + collapsible inspector |
| 1280–1919px | full three-region layout |
| ≥ 1920px | Command Center mode (§F) |

Touch targets ≥ 44px. No hover-only affordance anywhere — every hover has a
click/focus equivalent.

## N. Technical recommendation

**For the V1 slice: a single self-contained HTML file with inline SVG and no
framework.** Reasons, in order:

1. The slice must prove *real-state binding*, not framework capability. A build
   step would add a place for the rendered state and the real state to diverge.
2. Zero dependencies means zero supply-chain surface on a public repo.
3. It runs from `file://` with no server — so the evidence view works on a
   machine with nothing installed.

**Next.js/React is a reasonable V2 choice** once there are multiple views and
shared state; adopting it now buys nothing this slice needs.
**Three.js/WebGL: deferred** — §L gives it no fact to own in V1.
**Supabase: rejected for V1.** The existing local data layer (ledger + canon +
registry) already satisfies the requirement; adding a hosted realtime store
would put engineering state outside the local-first boundary the AEGIS contract
sets, for no capability this slice lacks.
