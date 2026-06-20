# Pre-Build Extraction Artifact — Vitalis Vertical Document System

Produced under PROTOCOL LOCK + Vertical Document Doctrine. **No code edited to produce this** —
it is grounded entirely on reading the real engine source (not the demo seed, not a visual copy of
the PDF). Companion to `docs/grounding-pdf-protocol-system.md` (PDF brand/section extraction).
Date 2026-06-02.

---

## 1. Existing generator / source files found

`packages/protocol-core/`
| File | Role |
|---|---|
| `generator.js` | Peptide protocol engine — `generateProtocol` (propose → gate chain → `attachDosing`/`attachBasis`) |
| `data/dosing.js` | **Source-locked** dosing reference (range/titration/taper/schedule/timing per compound) |
| `data/evidence.json` | 49-compound evidence corpus (evidenceLevel, mechanism, citationCount, knownSideEffects, contraindicationFlags) |
| `supplements.js` | `generateSupplementPlan` — lab + goals → nutrient targets (reuses nutrition engine) |
| `nutrition.js` | `analyzeLabForNutrients` (naturopath slip) + `parseLabText` + `composeNutrientBasis` |
| `data/nutrient-evidence.js` | Nutrient corpus (NUTRIENTS + ELECTROLYTES) w/ evidenceRec + community + foodFirst + naturopathAsk |
| `meals.js` | `generateMealPlan` + `estimateMacroTarget` (Mifflin–St Jeor) + `macroForFood` |
| `data/foods.js` | Seeded FOODS + MEALS + SUBSTITUTIONS + `MACRO_SOURCE` (CURATED_ESTIMATE) |
| `packages.js` | `composeClientPackage` (protocol+bloodwork+nutrition) + `safetyMonitoringPanel` + `REQUISITION_NOTE` |
| `data/lab-panels.js` | **Dr. Lun baseline** (10 sections, SOURCED) + OPTIONAL panels + `PEPTIDE_ADDITIONS` (peptide→marker map) |
| `gates.js` | language/labFlag/approval/projection gates + `CLIENT_VISIBLE_STATUS` |
| `research.js` | source registry (LIVE/STUB/PLANNED) + evidence-review + (new, dormant) researchGaps |
| `connectors.js` | PubMed + ClinicalTrials.gov + USDA FDC (LIVE); HealthCanada/openFDA (STUB) |
| `data/providers.js` | Dr. Vincent Lun (named provider + referral categories) |

## 2. Real generated-output data contracts (verified by reading source)

**PEPTIDE** — `generateProtocol` draft:
`{ items[{ productName, route, form, evidenceCompoundId, evidenceLevel, dosing{ label, titration, taper, schedule, timing, basis, note } }], rationale, monitoring, labsSuggested[], unknowns[], warnings[], citationsResolved[] }` · per item, `evidence.json[evidenceCompoundId]` adds `{ name, fullName, category, mechanism, citationCount, hasClinicalTrial, knownSideEffects[], contraindicationFlags[] }`. Client role: `dosing` collapses to `label` only (titration/taper/schedule stripped) until approved → projection re-exposes the reviewed schedule.

**SUPPLEMENT** — `generateSupplementPlan`:
`{ status: DRAFT|PENDING_LABS, goals, contraindications, preferences, nutrientTargets[{ nutrient, suggestedForm, target(=null dose), evidenceTier: ESTABLISHED|SUPPORTIVE|EMERGING, evidenceLabel, studies }], foodFirstOptions[{ nutrient, options[] }], discussionItems[{ nutrient, form, ask }], providerReviewFlags[{ marker, nutrient, flag, reason, supplementSuggested:false, action }], peptideNotes{ onProtocol, monitoringMarkers[], detail[], note }, evidence{ source, tierLegend }, summary, referral(Dr.Lun), languageOk }`

**NUTRITION** — `analyzeLabForNutrients` slip + `generateMealPlan`:
slip `{ banner, title, intro, aggregatorNote, providerReviewSuggested, recommendations[{ marker, value, unit, refLow, refHigh, flag, signal, nutrient, suggestedForm, foodFirst[], ask, basis{ tier, label, headline, studies{ finding, mechanism, citationCount, citations[] }, community{ usedFor, reportedBenefits, evidenceNote } }, peptideContext[] }], providerReview[], referral, summary{ reviewed, inRange, flagged, nutrientSuggestions, providerOnly }, disclaimers[] }`
meals `{ periodicity, macroTarget{ status: PROVIDED|ESTIMATED|UNKNOWN, kcal, proteinG, carbG, fatG, basis, providerReviewRequired, source }, slots[], days[7]{ meals[{ slot, name, kcal, protein, carb, fat | status:NO_COMPLIANT_OPTION }], dayTotals }, groceryList[], substitutions[], prepNotes[], excluded{ allergies, dislikes, dietaryStyle }, sourceNotes[] }`

**BLOOD REQUISITION** — `composeBloodworkFacet` + `safetyMonitoringPanel`:
`{ status: TO_ORDER, requisitionNote, baseline{ label, status: SOURCED, fasting, sections[{ section, markers[] }], markerCount }, safetyMonitoring{ status: SOURCED|EMPTY, markers[], detail[{ markers, cadence, matchedOn }], basedOn[] }, suggested[], provider(Dr.Lun), disclaimer }` · lab-panels OPTIONAL carry `status: SOURCED | NEEDS_SOURCE` (NEEDS_SOURCE = **no invented markers**).

## 3. PDF (peptide) section → data field map
| PDF section | Backed by (real) |
|---|---|
| Cover metadata | client, draft, products, `providers` Dr. Lun, ref id |
| 01 Stack & Why — stat band | item count, evidence-tier mix, labsSuggested count |
| 01 compound cards | productName, `evidence.fullName`, evidenceLevel, `dosing.label/timing` |
| 02 schedule | per-item `dosing.schedule / titration / taper / timing` |
| 03 compound reference | form, route, `dosing.schedule`, evidenceLevel, `evidence.mechanism`, `citationsResolved` (PMIDs), knownSideEffects, contraindicationFlags |
| 05 monitoring | `monitoring`, `warnings[]`, `labsSuggested[]`, `safetyMonitoringPanel` |
| contraindications | union of item `contraindicationFlags` |
| disclaimers | static Vitalis research/physician-review text |

## 4. Fields MISSING from the current app demo seed (why we ground on engine, not seed)
- `demo_draft_eric.items` carry only `productName/route/form/evidenceCompoundId` — **no `dosing` block, no `evidenceLevel`** (the generator adds these; the seed predates them).
- Seed has no `goal`, `protocolName`, `requestedBy`, `paymentStatus` populated.
- → Documents render generator output; the demo seed will be re-seeded to a generated-shape draft (or rendered with honest empty dosing where absent). **No dosing fabricated for thin seeds.**

PDF **superset** (content the engine does not auto-produce — never fabricated):
- 02 week-by-week titration **table rows** (engine gives strings) → practitioner-authored block.
- 04 Supportive Lifestyle 8-point list → practitioner-authored.
- 05 three-tier adaptation-signal grid + re-eval checkpoints → practitioner-authored.
- 01 "weeks total" / pen SKUs → only if provided.

## 5. Existing generator logic REUSED (no rebuild)
`generateProtocol` · `attachDosing` · `attachBasis` · `generateSupplementPlan` · `analyzeLabForNutrients` · `composeNutrientBasis` · `generateMealPlan` · `estimateMacroTarget` · `composeClientPackage` · `composeBloodworkFacet` · `safetyMonitoringPanel` · all of `gates.js` (language/approval/projection) · `dosing.js` · `evidence.json` · `nutrient-evidence.js` · `lab-panels.js` · `providers.js`. **The document system adds NO clinical logic** — it is a presentation layer.

## 6. Renderer components to BUILD
- ✅ `VitalisDocumentShell` + 14 primitives + `vdoc.css` (done, syntax-validated).
- `PeptideProtocolDocument` (flagship; maps §2 PEPTIDE → PDF spine).
- `NutritionProtocolDocument` · `SupplementProtocolDocument` · `BloodRequisitionDocument` (same shell, vertical schema).
- A thin `documentModel.js` adapter per vertical (engine output → shell props) so React stays declarative.
- New primitives if needed: `DocMacroTable`, `DocMarkerList` (compose from existing primitives first).

## 7. What will NOT be rebuilt or hard-coded
Engines, gates, dosing source, evidence/nutrient corpora, lab panels, Dr. Lun identity, the LIVE/STUB/PLANNED connector status, the approval/visibility gate, fee model. **No clinical content invented** in the renderer. No marker invented where `NEEDS_SOURCE`. No macro number where `UNKNOWN`/`SOURCE_PENDING`. No evidence marked LIVE without a live connector.

---

## 8. VERTICAL SECTION MAP (doctrine deliverable)
Wireframe stays stable across verticals; only the schema changes. `→` = functional equivalent.

| # | Peptide section | Nutrition equivalent | Supplement equivalent | Blood-requisition equivalent | Data fields | Research source |
|---|---|---|---|---|---|---|
| Cover | Protocol metadata | Nutrition Strategy metadata | Supplement Plan metadata | **Lab Request** metadata (no-fee) | client, goals, ref id, Dr. Lun | `providers.js` |
| 01 | Stack & Why | **Nutrition Strategy & Why** (goals + macro rationale + deficiency context) | **Supplement Stack & Why** (lab-driven nutrient rationale) | **Why this panel** (baseline + protocol-driven additions) | goals, macroTarget.basis, slip.summary / nutrientTargets / safetyMonitoring.basedOn | engine (Mifflin); `nutrient-evidence`; `lab-panels` |
| 02 | Schedule / titration table | **Meal timing / training-day structure** (days × slots + macro target) | **Form / timing / discussion table** (suggestedForm + ask; dose = naturopath) | **Draw schedule** (per-marker cadence) | meals.days/slots/macroTarget; nutrientTargets+discussionItems; safetyMonitoring.detail[].cadence | `foods.js`; `nutrient-evidence`; `PEPTIDE_ADDITIONS` |
| 03 | Compound Reference (evidence tiers) | **Macro/micro targets + deficiency interpretation** | **Lab-driven nutrient reference** (forms, contraindication notes, food-first vs supplement) | **Marker reference — why each matters** | recommendations+basis+foodFirst; nutrientTargets+evidenceTier+studies; baseline.sections | `nutrient-evidence` (peer-reviewed + Health Canada compliance context); `lab-panels` |
| 04 | Supportive Lifestyle | **Food-first recommendations + lifestyle/adherence** | **Food-first vs supplement rationale** | n/a (fasting/prep note only) | foodFirst[], prepNotes[]; foodFirstOptions[] | engine (food-first lists) |
| 05 | Physiological Monitoring (signals) | **Monitoring checkpoints** (re-test cadence) | **Monitoring markers** (peptide compatibility) | **Provider review + timing** | monitoring/warnings/labsSuggested; peptideNotes.monitoringMarkers; safetyMonitoring | `lab-panels` `PEPTIDE_ADDITIONS` |
| — | Contraindications / flags | providerReview (electrolytes/wrong-direction) | providerReviewFlags + contraindications | — | providerReview[]; providerReviewFlags[] | engine (electrolyte separation) |
| — | Evidence / references | studies citations | evidence.source + tierLegend + studies | panel source (SOURCED/NEEDS_SOURCE) | basis.studies.citations; evidence; baseline.source | `evidence.json`; `nutrient-evidence`; `lab-panels` |
| Footer | Physician review + disclaimers | same | same | provider note, **no paid positioning** | static + Dr. Lun | `providers.js` |

## 9. REUSE PLAN
- **Shell reused:** `VitalisDocumentShell` + all primitives + `vdoc.css` — identical across all four verticals (cover, section numbering, clinical tables, evidence badges, callouts, disclaimer, print-ready).
- **Shared components:** `DocCover`, `DocSection`, `DocStatBand`, `DocClinicalTable`, `DocPanel/DocDef`, `EvidenceBadge`, `DocCallout`, `DocSignalGrid`, `DocDisclaimer`, `DocStatusBanner`.
- **Varies by vertical (schema only):** one `<XProtocolDocument>` per silo + a small `toDocProps(engineOutput, mode)` adapter that maps that engine's real fields → shell props. No vertical re-implements layout or branding.
- **Server:** existing engines + `composeClientPackage`; documents are typed by silo (`PEPTIDE | NUTRITION | SUPPLEMENT | BLOOD_REQ`) flowing through the existing DRAFT→review→approve→APPROVED_RESOURCE spine. Blood-req = no-fee.

## 10. GAP LIST
**Data that EXISTS now (real):** peptide dosing+evidence+citations; supplement nutrient targets+tiers; nutrition slip+macro engine; Dr. Lun baseline + peptide safety markers; food-first lists; LIVE connectors (PubMed/CT.gov/USDA).
**MISSING / must be practitioner-authored:** peptide week-table rows, 8-point lifestyle, 3-tier adaptation grid, re-eval checkpoints, pen SKUs (peptide); deeper macro-periodization & training-day science beyond Mifflin (nutrition).
**Must remain UNKNOWN / SOURCE_PENDING / NEEDS_SOURCE (never faked):**
- Meal food macros not in seed → `SOURCE_PENDING` (USDA enrichment path exists, not yet run).
- Macro target without age/sex/height/weight → `UNKNOWN`.
- `male_low_t` / `hormone (full)` panels → `NEEDS_SOURCE` (no invented markers).
- Evidence stays `UNKNOWN`/non-LIVE except where a connector is actually LIVE.
- Any nutrition/supplement section we cannot source from the corpus → labelled, not fabricated.

---

### Build order (after go-ahead)
1. `documentModel.js` adapters (peptide first) — pure mappers, unit-testable.
2. `PeptideProtocolDocument` → preview route → `npm run build` evidence.
3. Wire into DraftCard (operator) + portal approved view; supersede thin card.
4. `NutritionProtocolDocument` · `SupplementProtocolDocument` · `BloodRequisitionDocument`.
5. Server: silo doc types through the existing gate spine; blood-req no-fee.
6. Practitioner operating dashboard (point-and-shoot generate by silo) + status lifecycle.
7. Client portal silo sections (approved-only).
8. Tests (silo separation · required sections · dosing in approved doc · no draft leak · blood-req no-fee · no nav 404 · existing green) + `npm test` + `npm run build` + browser desktop/mobile.
