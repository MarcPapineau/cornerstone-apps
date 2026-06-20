# Vitalis Tooling Decision Matrix

**Doc class:** Phase 0 tooling evaluation (`BUILDER-OPERATING-SYSTEM-PACKAGE-STANDARD.md` Stage 5 — Tooling)
**Owner:** Marc Papineau
**Author:** Documentation Agent (read-only specialist)
**Date:** 2026-06-04
**Scope:** Which tools/libraries should the `vitalis-resource-app` use to build the 4 Vitalis presentation targets — app charts, pitch diagrams, and pitch/export assets — under the consolidation doctrine (**reuse > rebuild; no parallel design system; no 2nd charting library without strong justification**)?
**Governing protocol:** `VITALIS-BUILD-PROTOCOL.md` §1, §4 (drift: inventing a new system where a canonical engine exists)

> **Verified version of record:** recharts **2.15.4** (installed/resolved in `node_modules`; `package.json` floor is `^2.12.7`). lucide-react **^0.408.0**. **No** d3 / echarts / apexcharts / react-flow / mermaid / framer-motion installed — confirmed this session.

---

## 1. Executive summary

**Recommendation: build all 4 targets with what is already installed — recharts (charts), hand-authored SVG (diagrams), lucide-react (icons) — and add nothing.** This was *proven* in the proof route: a full dashboard subset + a radial diagram, both with green gates and zero new dependencies. Introducing a second charting library or a diagram framework (react-flow, d3, mermaid) is **not justified** for these targets and would breach the System Consolidation Discipline doctrine.

| Need | Recommendation | New install? |
|---|---|---|
| **App charts** (lines, donuts, sparklines, combo/dual-axis, bars) | **recharts 2.15.4** via `TrendChart` wrapper + the same recharts components the proof used; **CSS primitives** (`SegmentBar`/`MiniBar`/`ProgressRing`) for bars & rings | **No** |
| **Pitch diagrams** (6-step Journey, radial Ecosystem) | **Hand-authored SVG** (+ lucide-react icons in `foreignObject`) | **No** |
| **Pitch / export assets** (deck-quality PDF, *if* needed) | **Chrome-headless HTML→PDF** (existing workspace pattern) or direct SVG export | **No** (Chrome already used in workspace) |
| **Icons** | **lucide-react ^0.408.0** | **No** |
| **Design system** | **Existing token system + 12 composer primitives** — no parallel kit | **No** |

---

## 2. Full tool-by-tool matrix

Verdict legend: **USE** (recommended) · **AVOID** (no justification for these targets) · **CONDITIONAL** (only if a specific future trigger fires).

| Tool / library | Category | Installed? | Fit for the 4 targets | Verdict | Rationale |
|---|---|---|---|---|---|
| **recharts 2.15.4** | Charting (React/SVG) | **Yes** | Lines, multi-line, donut/pie, sparklines, dual-axis combo (`ComposedChart`), bars | **USE** | Already the **only** reusable chart wrapper (`TrendChart`); proof drove `ComposedChart`/`PieChart`/`LineChart` from it. Themed via `--chart-*` tokens. Covers every chart in all 4 targets. |
| **Existing CSS primitives** (`SegmentBar`, `MiniBar`, `ProgressRing`) | Charting (no lib) | **Yes** | Horizontal bars, biomarker range/gauge bars, progress donuts/rings, honest empty states | **USE** | `ProgressRing` = pure SVG; `SegmentBar`/`MiniBar` = CSS with **honest 0-state** (never a fake full bar). The "biomarker gauge bars" + compliance donuts in the targets are these, recolored. |
| **Hand-authored SVG** | Diagram | **Yes** (native) | Radial hub-and-spoke (Ecosystem), 6-node connector (Journey) | **USE** | Proof built the radial Ecosystem this way. Full layout control, deck-grade, zero deps, prints cleanly. |
| **lucide-react ^0.408.0** | Icons | **Yes** | KPI icons, alert glyphs, journey node icons, trust chips | **USE** | Canonical icon set; embeds in SVG via `foreignObject` (proof did this). |
| **Existing token system + 12 composers** (`composers.jsx`) | Design system | **Yes** | KPI rails, status ribbons, silo panels, goal-ring clusters, timeline rail, document-preview cards, masthead | **USE** | Reuse mandate. Covers every non-chart widget across all 4 targets. A parallel kit = consolidation violation. |
| **Chrome-headless (HTML→PDF)** | Export / pitch asset | Workspace-level (per memory doctrine) | Deck-quality PDF of a pitch diagram | **CONDITIONAL** | Only if a **downloadable** pitch PDF is a deliverable (Marc decision U2). Already the canonical premium-export engine in the workspace — do **not** introduce a new PDF lib. |
| **react-flow** | Node/diagram framework | No | Could render node graphs | **AVOID** | The diagrams are **static** pitch assets — no drag/edit/zoom requirement. A heavy dep for decoration = consolidation violation. **CONDITIONAL** only if the Ecosystem must become interactive/editable. |
| **d3 (d3-radial/d3-hierarchy)** | Low-level viz | No | Could compute radial layout | **AVOID** | Hand-authored SVG already proved sufficient. d3 adds bundle + a second mental model for charts/diagrams recharts+SVG already cover. |
| **echarts / apexcharts** | Charting | No | Alternative chart engines | **AVOID** | Second charting library = **explicit** doctrine breach with **no** capability the targets need beyond recharts. |
| **mermaid** | Diagram-as-text | No | Flowcharts from markup | **AVOID** | Generic auto-layout aesthetic; cannot match the bespoke brand layout of these decks. Off-brand. |
| **framer-motion** | Animation | No | Motion on dashboards/diagrams | **AVOID** | The targets are static screens/infographics; GARVIS aesthetic doctrine bans decorative animation. No motion requirement. |
| **Canva / generic infographic tools** | External design | n/a | Could mock the pitch diagrams | **AVOID** | Visual Intelligence doctrine bans "generic AI infographic / Canva-style" aesthetic; output wouldn't live in-app or stay token-consistent. |

---

## 3. Single recommendations (the one answer per need)

### 3.1 App charts → **recharts 2.15.4**, routed through `TrendChart` + CSS primitives
- **Lines / multi-line / dual-axis combo / donuts / sparklines:** recharts (`TrendChart` for the themed line case; `ComposedChart` for dual-axis adherence-vs-outcome; `PieChart`/`Pie`/`Cell` for utilization donuts; small `LineChart` for KPI sparklines — all proven in the proof).
- **Bars / gauge bars / rings:** the existing CSS primitives (`SegmentBar`, `MiniBar`, `ProgressRing`) — they carry the **honest empty state**, which a raw chart lib would not give for free.
- **Theming:** `--chart-1` cobalt · `--chart-2` steel-slate · `--chart-3` cooled green · `--ring-track` platinum. **Recolor via tokens; never restructure a chart or drop its empty state.**

### 3.2 Pitch diagrams → **hand-authored SVG** (+ lucide-react)
- Both the **6-step Practitioner Journey** and the **radial Vitalis Ecosystem** are static brand infographics → bespoke SVG gives exact deck fidelity with zero deps.
- For the Journey specifically, the existing **`TimelineRail`** primitive (horizontal numbered done/active/todo nodes with connecting hairlines) is the closest reusable starting point — extend it, or author as one SVG. (`TimelineRail` is **linear only**, not radial — so the Ecosystem must be SVG.)

### 3.3 Pitch / export assets → **on-screen first; Chrome-headless HTML→PDF only if a downloadable deck is required**
- Default: the diagrams live **in-app** (a route/section), no export pipeline needed.
- If Marc wants a **PDF/deck** to send (decision U2), use the workspace's existing **Chrome-headless** premium-export path (already canonical for editorial/institutional artifacts) or export the SVG directly. **Do not** add a new PDF/imaging library.

### 3.4 Icons → **lucide-react ^0.408.0** (no change)

### 3.5 Design system → **existing token system + 12 composer primitives** (no parallel kit)

---

## 4. Recharts-consolidation reconciliation

**Question:** the targets show many chart types (donuts, dual-axis combos, sparklines, horizontal bars, gauge bars) — does that justify a second charting library?

**Answer: No.** Reconciliation:

| Target chart | Covered by | Library? |
|---|---|---|
| Outcome multi-line / outcomes-over-time | `TrendChart` (recharts `LineChart`) | recharts |
| Dual-axis "Outcome Score + Compliance Rate" combo | recharts `ComposedChart` (Area + Line, two axes) — **proven in proof** | recharts |
| Protocol/Labs **utilization donuts** | recharts `PieChart`/`Pie`/`Cell` — **proven in proof** | recharts |
| KPI **sparklines** | small recharts `LineChart` — **proven in proof** | recharts |
| "Most Common Labs" / revenue-split **horizontal bars** | `SegmentBar` / `MiniBar` (CSS, honest 0-state) | **none** |
| Biomarker **range / gauge bars** (Vit D, HbA1c, …) | `SegmentBar` / `MiniBar` recolor | **none** |
| Compliance / progress **rings & donuts** | `ProgressRing` (pure SVG) | **none** |

**Every** chart in all 4 targets is served by **recharts (2.15.4) or an existing CSS/SVG primitive.** There is **no** chart type in the targets that recharts cannot render and that would force a second library. Per System Consolidation Discipline + `VITALIS-BUILD-PROTOCOL.md` §4 (drift: inventing a new system where a canonical engine exists), the verdict is: **stay single-library (recharts), keep the CSS primitives for bars/rings, add nothing.**

**Version note:** standardize references on **recharts 2.15.4** (the resolved version). Optionally pin the `package.json` floor up to match, but that is a hygiene change, not a capability need — and not part of this Phase 0 evaluation's allowed edits.

---

## 5. Model / software recommendation

Per `BUILDER-OPERATING-SYSTEM-PACKAGE-STANDARD.md` Stage 6 (cost discipline: Haiku default · Sonnet for reasoning · Opus for critique) — for a **visual re-skin + composition** build (not a research or generation task):

| Build phase | Recommended model | Rationale |
|---|---|---|
| Layout/composition coding (compose existing primitives, recolor) | **Sonnet-class** | Deterministic, primitive-reuse work; low ambiguity once the spec is set. Opus is overkill for wiring existing composers. |
| Visual-fidelity critique vs the 4 target images | **Opus-class** | `VITALIS-BUILD-PROTOCOL.md` §8 visual acceptance gate + Reference Compliance doctrine (score similarity/layout/typography/hierarchy/whitespace) — fidelity scoring is the high-judgement step. |
| Honesty / anti-theater audit (the N1–N6 surfaces) | **Opus-class** | Catching fabricated live-feed / efficacy / billing surfaces is a doctrine-critical critique. |

**Software / runtime stack (unchanged — this is the point):**

| Layer | Tool | Status |
|---|---|---|
| Framework | React 18.3.1 + Vite 5.4.8 + Tailwind 3.4.13 (CommonJS build; `tailwind.config.cjs` + `postcss.config.cjs`) | Keep |
| Charts | recharts 2.15.4 | Keep |
| Icons | lucide-react ^0.408.0 | Keep |
| Diagrams | hand-authored SVG | Native |
| Routing | react-router-dom 6.26 (single `<Layout>` shell) | Keep |
| Data | server-authoritative Express 4.18 API (`server.js` :3100) + `@vitalis/protocol-core` gates; thin `useFetch` + `roleContext` | Keep |
| Export (conditional) | Chrome-headless HTML→PDF | Existing workspace pattern |
| Visual gate | Playwright (`playwright.vitalis.config.cjs`) + browser screenshots | Existing; required by §8 |

**Bottom line: zero new software bets.** The entire build is achievable on the installed stack; the only model spend that matters is an **Opus-class visual-fidelity + honesty critique** pass before any screen is called done.
