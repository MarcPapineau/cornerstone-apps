# Vitalis Workflow & Diagram Authenticity Spec

**Doc class:** Phase 0 workflow-authenticity spec (`BUILDER-OPERATING-SYSTEM-PACKAGE-STANDARD.md` Stage 7 — Workflow Design; anti-theater enforcement)
**Owner:** Marc Papineau
**Author:** Documentation Agent (read-only specialist)
**Date:** 2026-06-04
**Scope:** For each of the 4 Vitalis presentation targets — what it should **authentically** represent, the **real data** that powers it, what would be **fake now**, and a single honesty label — so the screens are grounded, not decorative fiction.
**Governing protocol:** `VITALIS-BUILD-PROTOCOL.md` §4 (drift trigger: "replaces exact content with vague/decorative fiction") + the platform's no-fabricated-claims doctrine.

> **Why this doc exists.** A polished mockup can imply data the platform does not (and should not) produce — a live PubMed feed, an efficacy %, a charged $ meter. This spec pins each target to the **real, wired** signals it may show and explicitly fences off the fabricated ones, so a build cannot quietly ship theater.

**Honesty label legend**

| Label | Meaning |
|---|---|
| **REAL** | Backed by wired endpoints + live gates; can show real (non-PHI / SAMPLE-labelled) signals today. |
| **SCAFFOLD** | The structure/route exists but a specific widget is partially backed; render honest empty/Roadmap state for unbacked parts. |
| **DEMO** | Renders from the seeded demo store (`data/store.json`); every value must be labelled **SAMPLE DATA**. |
| **NOT-WIRED** | No backing data/integration; must be shown as Roadmap/scaffold or omitted — never faked. |

---

## 1. Target 1 — Protocol Builder  ·  **REAL** (with NOT-WIRED widgets fenced)

**Kind:** live operational dashboard (single-patient protocol-authoring workspace).

**What it should authentically represent**
The **governed build of one research-only protocol document** for a selected client:
- Client context: intake, goals, current products, contraindications (from `store.json`).
- Candidate **real catalog items** chosen from the **121-SKU catalog** — never invented.
- Per-item **evidence tier** (HIGH / MODERATE / **UNKNOWN**) via the research gate, and **Canadian compliance status** (ALLOWED_RESOURCE / NEEDS_REVIEW / BLOCKED) via the compliance gate.
- Research-reported **dosing / titration / taper** (from the canonical schedule engine; display-only reshape).
- The **gate-posture banner**: catalog locked · SubQ≠Oral route integrity · research-before-recommend · no fabricated citations · no medical-claim language.
- The **lifecycle action**: acknowledge → Save as DRAFT → attest → APPROVE (the only path to client-visible).
- **Role-aware:** practitioner sees full DRAFT dosing; client sees softened literature ranges with **no** personal schedule.

**Real data that powers it (wired)**

| Signal | Endpoint / engine |
|---|---|
| Build protocol | `POST /api/protocol/generate` · `POST /api/protocol/draft` |
| Real SKUs | `GET /api/catalog` · `GET /api/catalog/:id` (121-SKU catalog) |
| Evidence tiers | `GET /api/evidence/:compoundId` |
| CA compliance gate | `GET /api/compliance` |
| Attest / approve | `POST /api/protocol/drafts/:id/review` · `/lock-current` |
| Compose package | `POST /api/protocol/drafts/:id/package` (Protocol + Bloodwork + Nutrition) |
| Gate engine | `@vitalis/protocol-core` (`G.complianceGate`, `G.researchGate`, `G.labResultFlagGate`) |
| Demo states | `demo_draft_eric` (DRAFT) · `demo_draft_kristen` (APPROVED_RESOURCE) |
| Hard domain rules (real) | KLOW = single 4-compound co-lyophilized blend · Reta 4 mg cap + 6-wk taper · SS-31 + MOTS-c co-dose |

**What would be FAKE now (fence these — NOT-WIRED)**

| Mockup widget | Why fake | Honest render |
|---|---|---|
| "Live RCT / PubMed feed" / real-time citations in Research & Evidence | Evidence is a **curated registry** (source status LIVE/STUB/PLANNED), not a live API | Curated citation list w/ tier badges + source-status labels |
| Auto-prescribing / e-signature on the lifecycle | Attestation = logged checkbox + license-ack, **not** a legal signature/prescription | Label: acknowledge → DRAFT → attest → APPROVE (resource-only) |
| "Recommendation confidence %" / efficacy / outcome-prediction score | System **refuses** medical-claim language; any % is invented | Show gate posture, not a fabricated dial |
| Per-document **$ billing meter** shown as charged | Entitlement math exists but **no Stripe** | Mark Roadmap/scaffold; de-weight |

**Label: REAL** — the workspace + lifecycle + gates are wired; the four widgets above must render as registry / governance / Roadmap, not fabricated live/efficacy/billing surfaces.

---

## 2. Target 2 — Clinic Command Center  ·  **REAL** (per-field SCAFFOLD where unbacked)

**Kind:** live operational dashboard (multi-patient practice-wide ops overview).

**What it should authentically represent**
**Operator triage** for a practitioner (or admin across tenants):
- Client count + active clients.
- Protocols generated vs approved (approval-rate ring).
- **Pending review queue** (drafts awaiting attestation — the highest-value operator action).
- Avg draft→approved turnaround (hours).
- Clients missing labs; clients due for check-in (`nextCheckIn` ≤ 14d).
- Per-silo module usage (peptide / supplement / meal / bloodwork-requisition counts via `moduleUsage[]`).
- Review-pipeline segment bar (awaiting / approved / other).
- Multi-tenant separation (direct-to-client owner vs external practitioners).
- The gate-posture panel + the outcome-trend line chart (real outcomes over dated check-ins) are existing real widgets.

**Real data that powers it (wired)**

| Signal | Endpoint |
|---|---|
| Practitioner analytics | `GET /api/practitioner/:id/analytics` → `stats{clientCount, activeClients, protocolsGenerated, approved, …}`, `moduleUsage[]`, outcomes series |
| Platform-wide overview | `GET /api/admin/overview` |
| Source pages already shipping this | `src/pages/PracticeHome.jsx` (commented *"the practitioner COMMAND CENTER"*) · `src/pages/AdminOverview.jsx` |

> The **proof already built a faithful subset** of this exact screen (5-up KPI strip w/ sparklines, dual-axis outcome chart, utilization donut, protocol-queue table w/ compliance rings + real lifecycle pills) — all values labelled **SAMPLE DATA**.

**What would be FAKE now (fence these)**

| Mockup widget | Why fake | Honest render |
|---|---|---|
| KPI values implied as **real practice data** (e.g. "Active Patients 156", "Labs Completed 248", "Avg Outcome Score 4.7/5") | Demo numbers from seeded store; real per-tenant backing is **per-field UNKNOWN** | Label **SAMPLE DATA** on demo; at build time, any field without a real backing column → honest empty state, never faked |
| Alerts/notifications presented as a **live monitoring feed** w/ real PHI | No live alerting integration verified; PHI must not be shown | Render from real queue signals where they exist (pending review, missing labs, due check-ins); otherwise SCAFFOLD |
| Team-activity feed as a **real audit stream** | Activity-stream backing is **UNKNOWN** | SCAFFOLD — show only events the API actually emits |
| Revenue / utilization shown in **$ collected** | No Stripe | Show **counts** (module usage), not collected revenue |

**Label: REAL** — the aggregate endpoints exist and the proof rendered the screen; individual KPI tiles are **SCAFFOLD** wherever a real backing column isn't confirmed (render empty/labelled, never fabricated).

---

## 3. Target 3 — Practitioner Journey  ·  **DEMO / illustrative** (static pitch infographic)

**Kind:** static marketing infographic — **not** a live screen.

**What it should authentically represent**
A 6-step narrative of the platform's real capability arc — each node corresponding to a surface that **actually exists** in the app:

| # | Node | Maps to (real surface) |
|---|---|---|
| 1 | Assessment | Intake (`PortalIntake.jsx` / intake data in `store.json`) |
| 2 | Biomarkers | Lab recommend / results (`LabRecommend.jsx`, `LabResults.jsx`) |
| 3 | Research Hub | Evidence registry (`Research.jsx`, `/api/evidence/:id`) |
| 4 | Protocol Builder | `ProtocolChat.jsx` / `Draft.jsx` + protocol gate chain (Target 1) |
| 5 | Patient Monitoring | Outcomes / progress (`Outcomes.jsx`, `PortalProgress.jsx`) |
| 6 | Outcome Analytics | Practitioner analytics (Target 2) |

The shrunken mock panels under each node should **echo the real surfaces** (and stay generic enough to avoid implying live data).

**Real data that powers it**
**None at runtime** — it's an infographic. Its honesty comes from the **node-to-surface mapping above being true** (every step is a shipped capability). It must **not** present sample numbers as real metrics.

**What would be FAKE now**

| Element | Why fake | Honest render |
|---|---|---|
| Mock panels showing **specific patient metrics / counts** as if live | It's a static asset; numbers imply real data | Use schematic/placeholder visuals or **SAMPLE**-labelled illustrative values |
| Value-prop claims that imply **clinical efficacy** ("Improve Patient Outcomes" as a guaranteed result) | Medical-claim language is forbidden | Keep value props operational ("Save Time", "Track & Optimize"), not efficacy guarantees |
| Trust chips ("Secure & Compliant", "Evidence-Driven") implying **certifications** | Specific certifications **UNKNOWN** | Keep as positioning language, not certification claims |

**Label: DEMO / illustrative** — authentic **only** if the 6 nodes map to real shipped surfaces (they do) and no sample value is dressed as a real metric.

---

## 4. Target 4 — Vitalis Ecosystem  ·  **SCAFFOLD / NOT-WIRED** (static pitch infographic)

**Kind:** static radial hub-and-spoke ecosystem map — **not** a live screen.

**What it should authentically represent**
The platform's real architecture as a hub with honestly-weighted spokes — center = the approval-gate + evidence-tier doctrine; spokes = real building blocks:

| Spoke class | Honest weighting | Basis |
|---|---|---|
| 3 portals (Admin / Practitioner / Client) | **Live** | Role-scoped IA shipping |
| Peptide silo · Bloodwork-requisition silo | **Live** | Wired endpoints + documents |
| Intake · Labs · Outcomes | **Live** | Shipped surfaces (§3 mapping) |
| 121-SKU catalog | **Live** | `/api/catalog` |
| Supplement · Meal silos | **Early access** | Scaffolded, not full |
| Entitlements / billing | **Roadmap** (de-weighted, dashed) | Entitlement math exists, **no Stripe** |
| Referral network | **Roadmap / scaffold** (de-weighted) | Not wired |

> The **proof already built this** as a hand-authored radial SVG: 12 spokes, Live / Early-access / Roadmap weighting, **no fabricated partners, no wired billing**.

**Real data that powers it**
**None at runtime** — static infographic. Honesty = the **weighting matching reality** (Live vs Early-access vs Roadmap) and the **absence of fabricated relationships**.

**What would be FAKE now**

| Element | Why fake | Honest render |
|---|---|---|
| **Named external partners / logos** (specific labs, pharmacies, integrations, payment, insurance, legal) shown as **signed** | No verified partner roster supplied; printing logos implies relationships that are **UNKNOWN** | Use **category** nodes (Diagnostic Labs, Compounding Pharmacies, …) without named/signed partners |
| Enterprise/investor nodes implying **closed deals** | **UNKNOWN** | Positioning categories only, not committed partners |
| Revenue-model band implying **active revenue streams** | No Stripe / no billing live | Show as **business-model** framing, clearly forward-looking |
| Billing/entitlement spoke at full weight | **No Stripe** | De-weight / dash · label Roadmap |

**Label: SCAFFOLD / NOT-WIRED** — authentic as a **positioning** asset only if spoke weighting matches reality and no named partner / active-revenue / signed-deal claim is fabricated.

---

## 5. Cross-cutting honesty rules (apply to all 4)

1. **SAMPLE DATA labelling.** Any demo/seeded value on any screen (live or pitch) is labelled **SAMPLE DATA**. No real PHI on demo or pitch surfaces. (The proof did this on every figure.)
2. **No fabricated live feeds.** Evidence is a curated registry (LIVE/STUB/PLANNED source status), never a live PubMed/RCT API.
3. **No efficacy / confidence scores.** The platform refuses medical-claim language; no efficacy %, outcome-prediction, or "recommendation confidence" dial.
4. **No charged-dollar billing.** Entitlement math exists, **no Stripe** — show counts, not collected revenue; mark billing/entitlement **Roadmap**.
5. **No named/signed partners.** Ecosystem uses category nodes; named partners/logos are **UNKNOWN** and must not be printed as signed.
6. **Honest empty states are mandatory, not optional.** `SegmentBar`/`MiniBar`/`ProgressRing` already render honest 0/—; never replace with a fake-full bar or a placeholder metric.
7. **Lifecycle truth.** Acknowledge → DRAFT → attest → APPROVE (resource-only). Never "prescribe"/"sign."
8. **Drift stop (`VITALIS-BUILD-PROTOCOL.md` §4).** If a build starts dressing any NOT-WIRED widget as real, that is a drift trigger → stop and report, do not ship.

---

## 6. Summary table — labels at a glance

| # | Target | Kind | Label | One-line honesty boundary |
|---|---|---|---|---|
| 1 | **Protocol Builder** | live dashboard | **REAL** | Workspace + gates wired; fence live-feed / efficacy / e-sign / $-meter as registry/governance/Roadmap |
| 2 | **Clinic Command Center** | live dashboard | **REAL** (per-field SCAFFOLD) | Aggregate endpoints real; unbacked KPI tiles → honest empty/SAMPLE, not faked |
| 3 | **Practitioner Journey** | pitch diagram | **DEMO / illustrative** | Authentic only if 6 nodes map to real surfaces (they do) and no sample value posed as a real metric |
| 4 | **Vitalis Ecosystem** | pitch diagram | **SCAFFOLD / NOT-WIRED** | Positioning asset only; spoke weighting must match reality; no named/signed partners or active-revenue claims |

**Net:** all four are honestly buildable — two as **REAL** operational dashboards (with a small set of fabricated widgets fenced off), two as **clearly-labelled pitch infographics** whose integrity rests on truthful mapping/weighting rather than live data. Decorative fiction is the only failure mode, and §5 prevents it.
