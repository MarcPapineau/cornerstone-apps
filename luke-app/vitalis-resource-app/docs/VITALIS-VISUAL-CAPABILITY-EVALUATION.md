# Vitalis Visual Capability Evaluation

**Doc class:** Phase 0 capability evaluation (feasibility verdict) — NOT a build sign-off
**Owner:** Marc Papineau
**Author:** Documentation Agent (read-only specialist)
**Date:** 2026-06-04
**Scope:** Can the `vitalis-resource-app` reproduce the 4 supplied Vitalis "Dashboard" presentation targets — to a client-grade standard — on the current stack, without breaking the working app?
**Governing protocol:** `VITALIS-BUILD-PROTOCOL.md` §1 (design-system / dashboard-architecture is a core system → discovery-and-routing gate first, no solo patching)
**Standard alignment:** `CLIENT-GRADE-DELIVERABLE-STANDARD.md` · `BUILDER-OPERATING-SYSTEM-PACKAGE-STANDARD.md` (Stage 1 Evaluation)

> **Anti-theater note.** This document distinguishes three tiers — **PROVEN** (executed + gated this session), **POSSIBLE** (credible with stated tooling/time, not yet executed), and **NOT REALISTIC / OVERCLAIM** (would require fabricated data or contradict the gate doctrine). Anything unverified is marked **UNKNOWN**, not asserted.

---

## 1. Executive summary (for Marc)

The four presentation images are reproducible on the **current stack with no new dependencies** — and one of each *kind* (a live dashboard + a pitch diagram) has already been **built and proven** behind an isolated, code-split route (`/_proof-of-capability`), with both gates green and **zero** off-limits files touched. The app already ships the exact engines, tokens, chart wrapper, and 12 dashboard composer primitives these screens need; this is a **re-skin + composition** exercise, not a new design system and not a second charting library.

The single real decision blocking a production build is **aesthetic, not technical**: the four targets show a **dark navy left rail**, but production shipped a **light platinum** sidebar on 2026-06-04. That divergence must be Marc's call before any production styling moves.

**Top-line KPIs**

| KPI | Value | Source |
|---|---|---|
| Targets reproducible on current stack, no new deps | **4 / 4** | Stack audit + proof build |
| Targets already PROVEN behind isolated route | **2 / 4** (1 live dashboard + 1 pitch diagram) | `src/proof/ProofOfCapability.jsx` |
| New dependencies required | **0** | recharts + lucide-react + SVG already installed |
| Off-limits files touched by the proof | **0** | mtime verification (proof report) |
| Gates at proof | **`npm test` 125/125 · `npm run build` green** | proof return |
| Blocking decision for Marc | **1** (dark rail vs platinum) | divergence flag below |

**Honest one-line read:** the capability claim is **real, not overclaimed** — within the explicit boundary that "reproduce these screens" means visual + composition fidelity using real wired data and honest empty states, **not** the fabricated live-feed / efficacy-score / billing-meter surfaces some of the mockups *imply*.

---

## 2. What is PROVEN (executed this session, gated)

Evidence basis: the proof agent's verified return + direct file/stack inspection by this evaluator.

| # | Claim | Evidence |
|---|---|---|
| P1 | An **isolated proof route exists** and renders outside the production `<Layout>` (its own chrome, no production Sidebar/Topbar). | Route `/_proof-of-capability`, lazy-loaded in `src/App.jsx`; component `src/proof/ProofOfCapability.jsx` (verified present, 31KB, mtime 2026-06-04 17:32 — newest file in tree). |
| P2 | **Exactly 2 files changed**, both additive; every off-limits file retains a pre-session mtime. | Proof return + this evaluator confirmed `src/components/document/**` (8 files incl. `vdoc.css`), `Sidebar.jsx`, `Topbar.jsx`, `index.css` tokens, `tailwind.config.cjs`, and the 4 `protocol-*.png` baselines were untouched. |
| P3 | **A live-dashboard target is reproducible** (Part A — mini "Clinic Command Center"): 5-up KPI strip w/ sparklines, dual-axis outcome chart (recharts `ComposedChart`: cobalt Area + green Line), silo-utilization donut (recharts `PieChart`), protocol-queue table w/ per-row SVG compliance rings + real lifecycle status pills (DRAFT / APPROVED_RESOURCE / NEEDS_REVIEW). | Built in the proof; every value labelled **SAMPLE DATA**. |
| P4 | **A pitch-diagram target is reproducible** (Part B — radial "Vitalis Ecosystem"): hand-authored SVG hub-and-spoke, 12 spokes mapped to real building blocks, honest Live / Early-access / Roadmap weighting (no fabricated partners, no wired billing). | Built in the proof. |
| P5 | **No new dependency was required** for either. All charts use the already-installed recharts; the diagram is hand-authored SVG with lucide-react icons in `foreignObject`. | Proof return + `package.json` (no chart/diagram lib added). |
| P6 | **Both gates pass** with the proof present. | `npm test` → `125/125 checks passed.` / `All acceptance tests passed.`  ·  `npm run build` → green, `✓ 2414 modules transformed`, proof code-split into its **own** 72.2 kB chunk (gzip 17.98 kB) adding **zero** weight to the production `index` bundle. |

**What P1–P6 establish:** both *kinds* of target (operational dashboard + static pitch infographic) are demonstrably buildable on this stack, to a credible visual standard, without new tooling and without destabilizing the app. That is the core of the feasibility question, and it is answered **yes** with running evidence.

> **One verified correction to carry forward:** the KNOWN-FACTS brief lists `recharts ^2.12.7`. The **installed/resolved** version in `node_modules` is **`2.15.4`** (the proof return is correct). `^2.12.7` is the `package.json` floor; the lockfile resolved higher. No action needed — both are recharts 2.x and API-compatible — but use **2.15.4** as the real version of record. (No d3/echarts/apexcharts/react-flow/mermaid/framer-motion present — confirmed.)

---

## 3. What is POSSIBLE with more tooling / time (credible, not yet executed)

These are **not** proven; they are reasonable extensions with the stated cost. Each is achievable **without** a second charting library or a parallel design system.

| # | Capability | What it takes | Confidence | Why it's credible |
|---|---|---|---|---|
| F1 | **Full production "Protocol Builder" dashboard** (Target 1) — phase-stepper timeline, evidence-citation list w/ tier badges, biomarker range/gauge bars, compliance donut + metric tiles, completion stepper footer. | Compose existing primitives (`TimelineRail`, `MetricRail`, `SegmentBar`, `ProgressRing`, `StatusRibbon`, `DocumentPreviewPanel`) + recharts `TrendChart` for outcome lines; wire to existing endpoints (`/api/protocol/*`, `/api/evidence/:id`, `/api/compliance`). | **HIGH** | The page maps 1:1 onto endpoints that already exist; `ProtocolChat.jsx` + `Draft.jsx` already drive the same gate chain. Biomarker "gauge bars" = `SegmentBar`/`MiniBar` recolor. |
| F2 | **Full production "Clinic Command Center"** (Target 2) — 5 KPI cards w/ sparklines, active-patients list w/ mini donuts, protocol-utilization donut + legend, alerts list, outcomes combo chart, labs donut + most-common-labs bars, team-activity feed. | Same primitive set + recharts `ComposedChart`/`PieChart`; wire to `/api/practitioner/:id/analytics` and `/api/admin/overview` which **already aggregate** these signals. | **HIGH** | `PracticeHome.jsx` is literally commented "the practitioner COMMAND CENTER"; `AdminOverview.jsx` is the platform view. The proof already built a faithful subset of this exact screen. |
| F3 | **Production "Practitioner Journey"** (Target 3, 6-step linear infographic). | Either (a) extend the existing `TimelineRail` (horizontal numbered phase rail — the closest existing primitive, but **linear only**) with per-node mini mock panels, or (b) hand-author as one SVG/HTML composition like the proof's diagram. | **HIGH** | `TimelineRail` already does numbered done/active/todo nodes with connecting hairlines. Per-node "shrunken product panels" are static decoration. |
| F4 | **Production "Vitalis Ecosystem"** (Target 4, radial hub-and-spoke). | Hand-authored SVG (proof already did this). A library (`react-flow`/d3-radial) would only be justified if the map must become **interactive/editable** — not needed for a static pitch asset. | **HIGH (static) / UNKNOWN (interactive)** | Proof built it as SVG with honest Live/Roadmap weighting. Interactivity is out of current scope. |
| F5 | **Pixel-matched dark-rail aesthetic** across the production shell. | A token-additive dark-rail variant (see §7 Merge safety) **iff Marc approves the dark direction**. | **MEDIUM** | Technically straightforward; the constraint is **decision + brand-consistency**, not capability. The proof previewed the dark rail *scoped to its own page only*. |
| F6 | **Print/PDF export of a pitch diagram** at deck quality. | Chrome-headless HTML→PDF (workspace already uses this pattern per memory doctrine for premium artifacts) OR direct SVG export. | **MEDIUM** | Not attempted this session — **UNKNOWN** whether a print path is wired for these specific screens. Flag as a small follow-up if a deliverable PDF is wanted. |

---

## 4. What is NOT realistic / would be OVERCLAIMING

These surfaces appear (or are implied) in the mockups but **cannot be built honestly today**. Building them as if real would violate the platform's own gate doctrine (`VITALIS-BUILD-PROTOCOL.md` §4 drift trigger: "replaces exact content with vague/decorative fiction") and the anti-theater rule.

| # | Tempting but NOT honest now | Why it would be overclaiming | Honest alternative |
|---|---|---|---|
| N1 | A **"live RCT / PubMed feed"** or real-time citation pulling in the Research & Evidence panel. | Evidence is a **curated registry** with honest tiers (HIGH/MODERATE/**UNKNOWN**; source status LIVE/STUB/PLANNED), not a live literature API. | Show the curated registry with explicit tier badges + source-status labels. |
| N2 | A **"recommendation engine confidence %"** or **efficacy / outcome-prediction score**. | The system deliberately **refuses medical-claim language**; any such number is invented. | Show governance posture (catalog locked, route integrity, research-before-recommend) — not a fabricated confidence dial. |
| N3 | **Auto-prescribing / e-signature** framing on the lifecycle actions. | Attestation is a logged checkbox + license-ack, **not** a legal signature or prescription; every output is DRAFT / resource-only. | Label the lifecycle honestly: acknowledge → Save DRAFT → attest → APPROVE (resource-only). |
| N4 | A **per-document billing meter** shown as "charged $/document". | Entitlement math exists but **no Stripe**; showing dollars as collected is unbacked. | Mark billing/entitlement tiles **Roadmap/scaffold** and de-weight (the proof did exactly this). |
| N5 | **Named external partners / logos** on the Ecosystem map (specific labs, pharmacies, integrations) presented as signed. | No verified partner roster supplied; printing logos implies relationships that are **UNKNOWN**. | Use category nodes (Diagnostic Labs, Compounding Pharmacies, …) without claiming named, signed partners. |
| N6 | **Real patient PHI / real counts** on any demo or pitch screen. | Demo data is a seeded JSON store; presenting it as real practice data is fabrication. | Label every value **SAMPLE DATA** (the proof did this on every figure). |

> **Net:** the *chrome* of all four screens is fully achievable; a specific minority of the *content widgets* must be rendered as honest registry/governance/SAMPLE surfaces rather than the fabricated live/efficacy/billing surfaces the polished mockups imply. That boundary is the difference between "real capability" and "overclaim."

---

## 5. Design-system extraction summary

Classification of the 4 supplied images (classified from the images, not file order):

| Target | Kind | One-line |
|---|---|---|
| **Protocol Builder** | **Live dashboard** | Single-patient protocol-authoring workspace: dark navy nav, 4-phase stepped timeline, evidence-citation list w/ tier badges, outcome multi-line chart, biomarker range/gauge bars, compliance donut + metric tiles, 6-step completion stepper. |
| **Clinic Command Center** | **Live dashboard** | Multi-patient practice ops overview: 5 KPI cards w/ sparklines, active-patients list w/ mini donuts, protocol-utilization donut, alerts list, outcomes combo chart, labs donut + most-common-labs bars, team-activity feed. |
| **Practitioner Journey** | **Pitch diagram** (static) | 6 cobalt numbered nodes (Assessment → Biomarkers → Research Hub → Protocol Builder → Patient Monitoring → Outcome Analytics) on a horizontal connector, each over a shrunken product-surface mock; value-prop row; dark navy closing band w/ trust chips. |
| **Vitalis Ecosystem** | **Pitch diagram** (static) | Radial hub-and-spoke: silver/chrome center medallion + cobalt V-mark, inner ring of user types, top arc of enterprise partners, left/right strategic-partner columns, bottom revenue-model band, dark navy mission rail. |

**Palette extracted from the decks vs. the locked token (must reconcile):**

| Element | Sampled from deck | Locked app token | Verdict |
|---|---|---|---|
| Brand cobalt | ~`#002F7F`–`#003080` | **`#033594`** (`--primary`/`--accent`/`--gold`, HSL `219 96% 30%`) | Use the **token**. The deck sample is within rounding; brand guideline says cobalt was **pixel-measured from the logo** (`#033594` authoritative). A near-identical `#003DA5` may appear on the deck — open confirm, but **build to `#033594`**. |
| Dark navy rail / footer | `#041223` (rail), `#031635`/`#0B1A2F` (cards/gradient); T2 rail slightly graphite `#11202E` | **Not in the locked 4-color set** | **Proposed divergence** — see §6. |
| Steel / dividers | cool low-sat ~214–220° | **Silver Steel `#AEB5BF`** (`--border` family) | Matches. |
| Field / cards | platinum / near-white | `--background 214 24% 96%` · `--card 210 30% 99.5%` | Matches the deck's light body zones. |
| Chart series | cobalt primary, cool secondary, green positive | `--chart-1` cobalt · `--chart-2` steel-slate · `--chart-3` cooled green | Matches. |

**Typography (already loaded, `src/index.css` line 1 `@import`):** Cormorant Garamond (display/masthead) · Montserrat (labels/eyebrows) · Inter (body/UI) · JetBrains Mono (`.font-data`, numerals). The decks' big editorial headings = Cormorant; section labels = Montserrat. **No font work required.**

---

## 6. The divergence Marc must rule on: DARK RAIL vs PLATINUM

**This is the headline decision. Do not silently implement.**

| | Production (shipped 2026-06-04) | The 4 presentation targets |
|---|---|---|
| Left rail | **Light platinum** sidebar | **Dark navy** rail (`#041223`-ish), cobalt active pill, steel inactive items |
| Status in code | Live `Sidebar.jsx` (off-limits to recolor without sign-off) | Mockup direction only — **not** a shipped fact |
| Brand-guideline standing | Matches the locked "bright platinum field, restrained cobalt, **not** dark-blue corporate" doctrine | Dark navy is **not** in the locked 4-anchor palette |

The brand guidelines (`docs/VITALIS-BRAND-GUIDELINES.md` §1) explicitly frame the app as *"Premium, clean, operational — not dark-blue corporate"* with a *~50% platinum / 30% white / 15% cobalt / 5% graphite* ratio and **cobalt as an accent, never a background**. A dark navy rail is a **deliberate departure** from that locked doctrine — which is exactly why it needs Marc, not an agent.

**Three clean options:**

- **Option A — Keep platinum (no brand change).** Build all 4 screens on the *current* light shell; treat the decks' dark rail as art-direction license that production declines. Lowest risk, fully on-doctrine.
- **Option B — Adopt dark rail as a sanctioned variant.** Add a token-additive dark-rail surface set (new `--rail-*` vars) and update the brand guideline's locked palette to include it. Matches the decks; requires a doctrine amendment + brand sign-off.
- **Option C — Dark rail for pitch/marketing screens only; platinum for the operational app.** Pitch diagrams (Journey, Ecosystem) use the dark presentation treatment; the live dashboards (Builder, Command Center) stay platinum. Honors both worlds; adds a "presentation theme" boundary to maintain.

The proof previewed Option-B styling **scoped to the proof page only** — it did **not** touch the production `Sidebar.jsx`. So nothing is pre-committed.

---

## 7. Merge safety — how to apply this WITHOUT destroying the working app

These are the guardrails any production build must obey. They derive directly from `VITALIS-BUILD-PROTOCOL.md` and `VITALIS-BRAND-GUIDELINES.md`, both verified this session.

1. **Token-additive only — never restructure tokens.** Most of the app re-skins from the `:root` token edit alone (components consume `bg-card`, `text-foreground`, `bg-primary`, `text-gold`, `border-border`, …). If a dark rail is approved, **add** new surface vars (e.g. `--rail-bg`, `--rail-fg`, `--rail-active`); do **not** repurpose `--background`/`--card`/`--primary` (which would ripple app-wide). Cobalt stays `#033594` (`219 96% 30%`).
2. **Reuse the composer primitives — build no parallel kit.** The 12 primitives in `src/components/dashboard/composers.jsx` + `ProgressRing` + `TrendChart` cover every widget in all 4 targets (KPI rails, status ribbons, silo panels, goal rings, segment bars, timeline rail, document-preview cards). A "new design system" or a second chart lib is a **consolidation-doctrine violation** unless strongly justified (it is not, here).
3. **One charting library — recharts.** All charts route through `TrendChart` (the only reusable recharts wrapper) or the same recharts components the proof used (`ComposedChart`/`PieChart`/`LineChart`). Recolor via `--chart-*` tokens; **never restructure a chart or remove its honest empty state.** Do not add d3/echarts/apexcharts/react-flow.
4. **The dossier is OFF-LIMITS — a re-skin cannot touch one pixel of it.** `src/components/document/**` (incl. `vdoc.css`, `PeptideProtocolDocument.jsx`, `VitalisDocumentShell.jsx`) is the warm charcoal/antique-gold/cream "document world," insulated under `.vdoc` + `--vd-*` with its own Cormorant `@import` and **zero** app tokens. Do not recolor, "reconcile," or cobalt-ify it.
5. **Two baseline families, two rules:**
   - **The 4 PROTOCOL baselines** (`protocol-cover` / `-fullpage` / `-s02-schedule` / `-s05-signals.png`) must stay **byte-identical** across any re-skin. If they move, accidental app↔dossier coupling was introduced → **revert, do not re-baseline** (`VITALIS-BRAND-GUIDELINES.md` §5).
   - **The 6 dashboard surfaces** (the live app screens) are the ones a re-skin is *allowed* to change — and changing them requires the **visual acceptance gate**: `VITALIS-BUILD-PROTOCOL.md` §8 — tests + build passing is **necessary but insufficient**; **browser screenshots are required**, side-by-side vs the supplied targets.
6. **Never touch clinical logic for a visual task.** No dosing/schedule/blend/gate/role-projection edits. Dosing authority stays `BLEND_SCHEDULES` / `selectedScheduleFor` / `blendScheduleFor`; renderers reshape for display only (`VITALIS-BUILD-PROTOCOL.md` §6). The no-draft-leak gates and role field-drops must still pass.
7. **Isolated-proof discipline.** Demo/preview routes mount **outside** `<Layout>` and code-split into their own chunk (the proof adds zero weight to the production bundle). Keep any future preview the same; remove before/at production cutover.

> **Merge-safety bottom line:** a correct build of these screens is **purely additive** — new composed pages + (optionally) new rail tokens — and is structurally incapable of altering the dossier or the clinical engines if rules 1–7 hold.

---

## 8. Gaps / UNKNOWNs (honest inventory)

- **U1 — Dark-rail decision:** unresolved (§6). Blocks any *production* shell styling. Not a capability gap; a decision gap.
- **U2 — PDF/deck export of pitch diagrams:** **UNKNOWN** whether a print/export path is wired for these specific screens (§F6). Only relevant if a downloadable pitch PDF is a deliverable.
- **U3 — Interactive/editable ecosystem map:** out of current scope; if it ever needs drag/edit, *then* re-evaluate a library — not before.
- **U4 — Production data completeness:** the analytics endpoints aggregate the right signals, but whether **every** field each target shows (e.g. "Avg Outcome Score 4.7/5", "Labs Completed 248") has a real backing column for a real tenant is **UNKNOWN** per-field — must be checked at build time, with any unbacked field rendered as honest empty state, never faked.
- **U5 — Recharts version of record:** resolved to **2.15.4** (not the `^2.12.7` floor). Documented; no action.
- **U6 — Brand cobalt confirm:** `#033594` (measured from logo) is authoritative in code; deck may show `#003DA5`. Open confirm-for-Marc per brand guideline, but does not block.

---

## 9. What Marc must decide

1. **Dark rail vs platinum — pick A / B / C (§6).** This is the one true blocker for a production build. (Recommendation, if you want one: **C** — dark treatment for the two *pitch* diagrams, platinum kept for the two *operational* dashboards — honors both the decks and the locked "not dark-blue corporate" app doctrine. But this is your aesthetic call.)
2. **Scope of the production build:** all 4 targets, or start with the 2 already proven (Command Center subset + Ecosystem) and expand?
3. **Honesty boundary sign-off (§4):** confirm the N1–N6 surfaces (live feed, efficacy %, e-signature, $ billing meter, named partners, real PHI) are rendered as **registry / governance / Roadmap / SAMPLE** — not faked. (This is doctrine; flagging for explicit acknowledgement.)
4. **Pitch-asset export:** do you need a downloadable **PDF/deck** of the Journey + Ecosystem (triggers the U2 export work), or are they on-screen only?
5. **Brand cobalt confirm (U6):** ratify `#033594` as the build value (recommended — it's the measured logo ink) and note `#003DA5` as deck-only.

**No production styling, tokens, routes, or clinical logic will change until items 1–3 are decided.** This evaluation is Phase 0 only.
