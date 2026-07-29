# Grounding Artifact — PDF-Class Protocol Document System

Produced under PROTOCOL LOCK. Two grounding gates completed with evidence before any shared-code edit.
Date: 2026-06-02.

---

## Gate 1 — Page audit (workflow `wuju8tloc`, 22 agents, plain-text, no schema)

Status: **COMPLETE & USABLE** (the prior schema-forced run returned empty = a *failed* audit and was discarded; this deterministic re-run succeeded).

Verified facts (not memory):
- **All 22 role pages** handle loading/error/empty states; every audited button/link is wired to a real action or route.
- **Route/nav reconciliation (evidence):** every `nav.js` target resolves to a `App.jsx` route — admin (5), research (3), practice (5), portal (12). **No nav → Route-Not-Found exists today.** Catch-all `NotFound` is last.
- **Audit anomaly disproven:** one agent reported `PortalPackage.jsx` missing and "no vitalis-resource-app dir" — both false (file is 3,773 bytes; route `portal/package` at App.jsx:90). That agent had a path glitch; verified directly.

Real issues to fold in during this sprint (polish, not blockers):
- `PracticeHome` / `PracticeReviews`: roster/reviews/add-ons fetch errors are *swallowed* → a failed fetch shows "Queue clear" (false-clear). Surface inline error chips.
- Portal pages (`PortalHome`, `PortalLabs`, `PortalAddOns`, `PortalProtocols`): heavy `text-2xs`/`text-faint` → low contrast; lift to `text-xs`/`text-soft`.
- `PracticeClientDetail`: "Upload surface" links to `/portal/documents` (context-losing); 7-tab bar clips on narrow widths; `reviewer={null}` passed to DraftCard.
- `PracticeInvitations`: intake link is dead `<code>` text — add copy-to-clipboard.
- `AdminOverview`: 12 KPI cards as a flat wall — promote action-required metrics into a "Needs attention" band.

---

## Gate 2 — Canonical PDF inspection

File: `/Users/marcpapineau/Desktop/Vitalis/Patients/Eric/02-Eric-Fat-Loss-Optimization-Protocol.pdf`
11 pages · US Letter portrait (612×792). All pages read visually.

### Brand identity — "Vitalis Research" document system
- **Wordmark:** `Vitalis` (charcoal serif roman) + `Research` (antique-gold serif *italic*). Under it: `RESEARCH DOCUMENTS · EDUCATIONAL USE ONLY` (tracked uppercase, muted).
- **Palette (extracted):**
  - Ink / charcoal (warm near-black): `#1F1B18` — headings, emphasis
  - Body gray: `#403A34`
  - Muted label gray: `#9A9089`
  - **Antique gold accent:** `#B0894E` (eyebrows, labels, italic display words, rules, T-badges, callout borders)
  - **Cream / parchment panel:** `#F4EEE0` (callouts, evidence legend, disclaimers)
  - **Coral / clinical red:** `#BC5147` (Retatrutide card border, "STOP NOW" tier, danger)
  - **Slate blue-gray:** `#5B6B70` (the "EXPECTED ADAPTATION · OBSERVE" tier border) — this is the only "teal-ish" note in the PDF
  - Page white `#FFFFFF`
- **Typography:**
  - Display = high-contrast serif (Cormorant Garamond family): wordmark, section titles, compound names, big stat numerals, sub-heads. Gold *italic* on the emphasis word ("Eric's *Metabolic* Reset", "The Stack *& Why*").
  - Body = humanist sans (Inter), ~10.5px, generous leading, warm gray.
  - Eyebrows/labels = uppercase sans, ~0.12em tracking, 8–9px, gold or muted.
  - Dosing tails set in *italic*; oldstyle/serif figures for stats.
- **Furniture:** running header (`Vitalis Research` left | `SECTION 0X · TITLE` right) over a thin gold rule; ~3px gold left-border on cream callouts; dotted rules between definition-list rows; dark charcoal table header row with white text; alternating white/cream table rows.

### Document structure (the section spine to reproduce)
1. **Cover** — wordmark band · protocol-class eyebrow · serif title (gold italic emphasis) · thesis paragraph · **metadata block** (PREPARED FOR / PROTOCOL / per-compound DURATION / REFERRAL PHYSICIAN `Dr. Vincent Lun · phone` / SOURCE / REFERENCE id e.g. `ED-FL-2026-05`) · **physician-review disclaimer band** (cream, gold border).
2. **Section 01 · The Stack & Why** — intro · **4-up stat band** (serif numerals + small-caps labels + thin accent rule) · **compound cards** (colored top border; serif name + italic descriptor; role chip `★ ANCHOR · 16 WEEKS` / `★ SUPPORT` / `◆ FOUNDATION`; body with bold lead-ins; *italic dosing tail*) · "Why this sequencing" cream callout.
3. **Section 02 · The Schedule** — intro · **schedule table** (charcoal header; cols = BLOCK + one per compound w/ dosing-time subhead + PHASE MILESTONE; rows = week-blocks w/ gold serif labels; alt white/cream; conditional doses *italic*; ended compound = "— cycle done —") · per-compound "Why <timing>" callouts · **pen/supply summary** (SKU list).
4. **Section 03 · Compound Reference** — **evidence-tier legend** (T1–T4 gold badges + defs) · per-compound **reference panel** (gold left border; name + descriptor + cadence chip; definition list FORM / ROUTE / SCHEDULE / CYCLE / MECHANISM / EVIDENCE / ADAPTATION SIGNALS; EVIDENCE row carries inline T-badges + real PMIDs + *"Honest caveat:"*; SS-31 has a "HONEST FRAMING" row: *"is not a fat-loss compound"*).
5. **Section 04 · Supportive Lifestyle** — intro · **numbered 1–8** (bold lead + body; #8 = adjunctive supplementation "review with Dr. Lun", "None are Vitalis products") · "What to track weekly" cream callout.
6. **Section 05 · Physiological Monitoring** — intro ("observation, not alarm") · **"Three response patterns"** panel (Amplify-existing / Reveal-unrecognized / Dose-too-aggressive; each w/ **Action:**) · **"Adaptation signals by tier"** grid (●  EXPECTED ADAPTATION·OBSERVE [slate] / ▲ MEANINGFUL DRIFT·CHECK IN [gold] / ■ STOP NOW·PHYSICIAN SAME DAY [red]) · "general principle" callout · **re-evaluation checkpoints** (Week 2/4/8/16) · **contraindications** line · **master disclaimer band** (names Dr. Vincent Lun, FDA-status honesty, sourcing responsibility, no-liability).

### Tone & density
Dense but readable; confident, clinical, **honest** ("Honest caveat" / "HONEST FRAMING" where evidence is weaker). Physician-review framing throughout; **Dr. Vincent Lun** named in full (matches hard rule). Evidence tiers T1–T4 with real PMIDs. "research / educational / guide only" repeated; responsibility on recipient + physician. No marketing fluff, no emoji, restrained gold.

---

## Grounded data contract (real fields, verified — not memory)

Generator `attachDosing` (operator/practitioner role) produces per item:
```
{ productId, productName, route, form, evidenceCompoundId, evidenceLevel,
  dosing: { label, titration, taper, schedule, timing, basis, note } }   // client role: label only
```
Draft carries: `rationale`, `monitoring`, `labsSuggested[]`, `unknowns[]`, `warnings[]`, `citationsResolved[]`, `items[]`.
`evidence.json[evidenceCompoundId]` adds: `name`, `fullName`, `category`, `evidenceLevel`, `mechanism`, `citationCount`, `hasClinicalTrial`, `knownSideEffects[]`, `contraindicationFlags[]`.
Approved client view: `gates.clientProtocolProjection` exposes per-item `dosing{label,schedule,titration,taper,timing,note}` (no basis/blocked) — so the approved document is **useful** (directive-compliant), drafts never leak.

### PDF section → data source map
| PDF section | Backed by real data | Practitioner-authored (never fabricated) |
|---|---|---|
| Cover metadata | client, draft, products, Dr. Lun (providers), ref id | protocol display name (if unset → derive) |
| 01 Stack & Why — stat band | compound count, evidence-tier mix, labs count | "weeks total" (only if durations provided) |
| 01 compound cards | productName, descriptor (evidence.fullName), evidenceLevel, dosing.label/timing | role chip (anchor/support) — derive from order/category or practitioner sets |
| 02 schedule | per-item dosing.schedule / titration / taper / timing (strings) | week-by-week **table rows** — optional block, practitioner-entered |
| 02 supply | productName mg + route | exact pen SKUs / counts — optional |
| 03 compound reference | form, route, dosing.schedule, evidenceLevel, mechanism, citationsResolved (PMIDs), knownSideEffects, contraindicationFlags | "cycle", "honest caveat" prose — optional practitioner note |
| 04 supportive lifestyle | — | **entire section** optional, practitioner-entered |
| 05 monitoring | monitoring string, warnings[], labsSuggested[], safety panel | 3-tier signal grid + checkpoints — optional block |
| contraindications | union of item.contraindicationFlags | — |
| disclaimers | static Vitalis research/physician-review language | — |

**Rule:** the document SHELL + SECTION STRUCTURE reproduce the PDF exactly; CONTENT comes only from real gated data; sections without engine data render as practitioner-authored blocks or honest empty states. No fabricated clinical content.

---

## Silo architecture (4 document products + 1 future)
1. **Peptide Protocol** — paid; flagship; matches the PDF. (`PeptideProtocolDocument`)
2. **Nutrition Protocol** — paid; from bloodwork + goals + peptide context + deficiencies. (`NutritionProtocolDocument`) — already has engine output (`nutrition.js` slip → upgrade to full document).
3. **Supplement Protocol** — paid; from labs + goals + deficiencies. (`SupplementProtocolDocument`) — `supplements.js` output → full document.
4. **Blood Requisition / Lab Request** — **no-fee**; clean lab-request doc; feeds the other silos. (`BloodRequisitionDocument`) — from `lab-panels` + `safetyMonitoringPanel`.
5. **Referrals** — placeholder only (future silo). Do not build deeply.

All silos render through one reusable **`VitalisDocumentShell`** (cover/header, prepared-for metadata, reference id, physician-review line, numbered sections, dense tables, premium panels, disclaimer/footer, print/PDF-ready). Existing `ProtocolDocumentView` (thin cards) is superseded by `PeptideProtocolDocument` for the protocol silo.

## Gate preservation (unchanged — must not weaken)
Draft generated → practitioner reviews/modifies → practitioner approves (attestation) → client sees `APPROVED_RESOURCE` only. Whitelist projection drops operator-only fields. Paid add-on gate intact. Blood Requisition = no-fee, separate from paid silos. No payment processor (paymentStatus only).

## Build plan (sequence; evidence at each step)
1. Brand tokens — Vitalis Research document identity (CSS vars + Tailwind) scoped to documents (`.vdoc`), app chrome untouched this sprint.
2. `VitalisDocumentShell` + shared doc primitives (Cover, SectionHeader, DefList, ClinicalTable, Callout, EvidenceBadge, DisclaimerBand) — new files.
3. `PeptideProtocolDocument` (flagship) — map grounded data → PDF sections; operator full / client softened.
4. Wire into DraftCard (operator preview) + portal approved view; supersede thin card.
5. `NutritionProtocolDocument`, `SupplementProtocolDocument`, `BloodRequisitionDocument` on the shell.
6. Server: silo-typed documents + "generate by silo" (peptide/nutrition/supplement/blood-req) into the existing review→approve spine; blood-req no-fee.
7. Practitioner operating dashboard: needs-review / pending drafts / pending add-ons / missing bloodwork / due-for-update / recent documents / one-click "Generate <silo>" / status lifecycle.
8. Client portal: silo sections (My Peptide / Nutrition / Supplement / Lab Requests / History) — approved-only.
9. Tests (silo separation, required PDF sections present, dosing in approved doc, no draft leak, blood-req no-fee, no nav 404, existing green) + `npm test` + `npm run build` + browser (desktop + mobile).
