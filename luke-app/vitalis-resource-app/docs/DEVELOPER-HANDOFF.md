# My Vitalis Health — Developer Handoff

Practical orientation for the next developer. Date 2026-06-02. Status ≈ **80% product-direction complete** (premium, role-organized, dashboard-driven, document-quality; several silos honestly scaffolded).

---

## 1. What this is
A peptide + nutrition + supplement + meal-plan + bloodwork **research/resource platform** with three roles. Vitalis is positioned as a **research aggregator** — every client-facing output is an educational, practitioner-reviewed resource, never a prescription. The hard rule everywhere: **a client only ever sees `APPROVED_RESOURCE`; drafts never leak.**

## 2. Architecture
- **`packages/protocol-core/`** — CommonJS **logic core** (surface-agnostic, server-authoritative). Gates, models, generator, dosing, evidence, nutrition/supplement/meal engines, packages, research, connectors, `document-model` (dossier adapters). Has its own dependency-free acceptance suite.
- **`luke-app/vitalis-resource-app/`** — the product:
  - `server.js` (Express) imports protocol-core and exposes `/api/*`. **Server runs every gate; the browser only asks.** File-backed store at `lib/store.js` → `data/store.json` (seeds from `protocol-core/data/demo-clients`).
  - `src/` — Vite + React + Tailwind SPA. Token-driven design (`index.css` + `tailwind.config.cjs`).
- Run: `npm run dev:all` (api :3100 + vite :5173) · `npm run build` · `npm test` (acceptance suite, **75/75**).

## 3. Design system (Vitalis dossier identity)
Token-driven via `src/index.css` `:root` (HSL CSS vars) → `tailwind.config.cjs`. **warm parchment surface · charcoal ink · antique-gold accent (`--gold`) · richer deep teal as the functional/interactive color · `--panel` cream · stronger borders + layered shadows.** Retune the whole app from `:root`.
- **Shared components:** `ui/StatCard`, `ui/SectionHeader`, `ui/SiloCard`, `charts/TrendChart` (Recharts), `charts/ProgressRing` (SVG).
- **Document system (PDF-class dossier):** `components/document/` — `vdoc.css` (scoped `.vdoc` identity) + `VitalisDocumentShell` + `DocumentParts` + `PeptideProtocolDocument`. The visual north star, modeled on Marc's Eric PDF.

## 3A. Build protocol (read before core-system edits)
Before touching protocol documents, dosing/schedules, evidence tiers, labs, supplements, nutrition,
meal plans, approval gates, portal silos, billing gates, or the document/design system, read
`docs/VITALIS-BUILD-PROTOCOL.md`.

The short version: the agent must identify the canonical source, route read-only extraction/mapping/QA
work to specialists where useful, and only then implement. Passing tests is not enough; browser evidence
against the old Vitalis standard is required for document/dashboard work. If a parallel engine or
source-of-truth collision appears, stop and collapse back to the canonical source before proceeding.

## 4. Roles & routes (`src/nav.js`, `src/App.jsx`)
- **ADMIN** — platform ops: `/admin` (overview), `/admin/practitioners(/:id)`, `/admin/direct-clients`, `/admin/plans`, `/admin/system` + research/compliance.
- **PRACTITIONER** — `/practice` (command dashboard), `/practice/clients(/:id dossier)`, `/practice/reviews`, `/practice/invitations`, `/practice/add-ons`. The **dossier is the workspace** (protocol/lab/supplement/meal generation live there).
- **CLIENT** — silo portal: `/portal` (dashboard), `/portal/protocols` (Peptide, renders the **dossier**), `/portal/nutrition`, `/portal/add-ons` (`?silo=supplement|meal`), `/portal/package` (Lab Requests), `/portal/labs`, `/portal/progress`, `/portal/documents`, `/portal/usage`. Every nav target resolves — no Route-Not-Found.
- Role chosen via the demo "View as" switcher (`roleContext`). Catch-all `NotFound` is last.

## 5. Approval / gate flow (do NOT weaken)
`generate (DRAFT)` → `practitioner review / modify` → `practitioner attest → APPROVED_RESOURCE` → client-visible. Enforced server-side: whitelist projections (`gates.clientProtocolProjection`) physically drop operator-only fields; the document endpoint **403s** a CLIENT on any non-approved draft. Two-tier dosing: practitioner sees titration/taper/basis; client sees the reviewed schedule once approved, never internal rationale/blocked notes. Entitlements: active-protocol cap + monthly credits → overage fee (no payment processor; `paymentStatus` only).

### Dosing ownership (do NOT duplicate)
The canonical dosing/schedule engine is the only authority for dosing logic:
`BLEND_SCHEDULES`, `selectedScheduleFor`, and `blendScheduleFor` in `packages/protocol-core`.
Document adapters may only map canonical output into render props; renderers may only display it.
They must not synthesize dosing, infer blend math, convert reference ranges into selected schedules,
or soften the schedule into vague compliance language.

If a dosing change appears necessary, run existing-capability discovery first. If a parallel adapter or
duplicate engine exists, collapse it back into the canonical engine before proceeding. This is a hard
anti-drift rule from `docs/vitalis-research-doctrine.md`.

## 6. Document silos (`GET /api/documents/:silo/:id?role=`)
Server runs `document-model` adapter → returns dossier props; React renders `PeptideProtocolDocument`.
- **PEPTIDE — LIVE.** Full dossier (cover/meta, Stack & Why, dosing schedule, compound reference w/ evidence tiers + citations, monitoring, contraindications, physician review, disclaimer). Operator full / client softened.
- **NUTRITION / SUPPLEMENT / BLOOD_REQ — scaffolded.** Engines exist (`nutrition.js`, `supplements.js`, `meals.js`, `packages.composeBloodworkFacet`); adapters (`toNutritionDocProps` etc.) + components are the next build (endpoint returns honest 501 today).

## 7. Research spine (status)
`data/evidence.json` — **49 peptides, all with real peer-reviewed citations.** Pulled from live PubMed (relevance + title/abstract anchored). **Source hierarchy enforced:** evidence backbone = journal/DOI literature; WHO + NIH / NIH-ODS are **excluded app-facing**; ClinicalTrials.gov / FDA / Health Canada / USDA are **cross-check / compliance / index only** (CT.gov entries live in `registeredStudies`, not `citations`). Tiers: **19 HIGH / 29 MODERATE / 1 LOW**. **Confidence layer:** `HIGH_CONFIDENCE` (6) · `NEEDS_REVIEW` (13) · `SOURCE_TRACEABLE` (29) · `SPARSE` (1). See `docs/research-report-final.md` + `docs/research-source-registry.md` (50 classified expert/lab sources). Maintenance scripts: `protocol-core/scripts/enrich-evidence.js`, `reconcile-evidence.js`.
- **NEEDS_REVIEW peptides** (curation pass): `bpc157, tb500, nad, sermorelin, kpv, ghrp6, cjcnodac, glutathione, ipamorelin, cjc, ghkcu, ta1`.

## 8. Known gaps / scaffolded
- Nutrition / Supplement / Blood-Requisition **document renderers** (adapters + components) — peptide is the reference pattern.
- Practitioner "Generate <silo>" one-click **persist** (generate currently previews; persisted drafts flow through review).
- `?silo` filter on `PortalAddOns` is a light retitle (supplement/meal share the add-ons page).
- Confidence/`registeredStudies` not yet surfaced in the rendered dossier (data is there).
- Demo `demo_draft_eric` is thin; `demo_draft_kristen` is the rich approved flagship.
- No auth, no payment processor (by design for now).

## 9. Next priorities (suggested)
1. Build the 3 remaining silo document renderers on the dossier shell.
2. Persist generated drafts from the practitioner dashboard "Generate" actions.
3. Surface confidence + registered-trial cross-checks in the dossier evidence section.
4. Nutrition/supplement/meal research depth (food macros via USDA enrichment; NEEDS_REVIEW curation).
5. Auth + (eventually) payment.
