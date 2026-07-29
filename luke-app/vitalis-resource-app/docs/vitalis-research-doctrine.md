# Vitalis Source Doctrine

Vitalis sells **research resources, not medical advice.** Everything client-facing is an educational,
practitioner-reviewed resource — never a prescription, diagnosis, or treatment. This doctrine governs
which sources may back a claim, and how. It is enforced in code (`packages/protocol-core/research-doctrine.js`)
and gated by tests **RD1–RD4** in `test/acceptance.js`.

---

## Source lanes (what may back an evidence claim)

**TIER 1 — PRIMARY_EVIDENCE (the backbone).** Peer-reviewed journal articles, DOIs, publisher pages,
systematic reviews / meta-analyses of human trials, independent + university research labs, primary
research. **An evidence claim must cite this tier.**

**TIER 2 — DISCOVERY_INDEX (find papers, not the authority).** PubMed/NCBI, Crossref, Semantic Scholar,
Google Scholar, Europe PMC, CNKI / Wanfang / eLibrary, ClinicalTrials.gov *as a trial index*. Use these
to **locate** Tier-1 sources, then cite the underlying paper/DOI. Never cite the index as the claim.

**TIER 3 — PRACTITIONER / EXPERT COMMENTARY (labeled).** Huberman Lab, FoundMyFitness, Peter Attia,
Examine.com, BioLayne, RP Strength, etc. May be used for **discovery / citation mining / framing only**,
and must be labeled "expert commentary / practitioner interpretation" unless backed by Tier 1. Vendors
flagged vendor-adjacent.

**TIER 4 — GOVERNMENT / REGULATORY (NOT evidence authority).** ClinicalTrials.gov, FDA / openFDA,
Health Canada, USADA, DoD. Used **only** as compliance flag · safety/regulatory context · index /
cross-check · source-discovery pointer. **Never the authority on whether a compound is useful or effective.**

### Excluded app-facing (for now)
**WHO** (incl. WHO ICTRP) and **NIH / NIH Office of Dietary Supplements (ODS)** are **excluded** from the
app-facing research registry entirely. Where NIH-ODS fact sheets were previously used (nutrient corpus),
they are retained only as `GovernmentReference` / COMPLIANCE-lane context, tagged `evidenceAuthority: false`,
never presented as peer-reviewed evidence.

---

## Honest labels (when evidence is weak, say so)
`UNKNOWN` · `SOURCE_PENDING` · `NEEDS_REVIEW` · `COMMUNITY_REFERENCE` · `PRACTITIONER_REVIEW`.
Never make a claim stronger than the cited source allows. Never invent research, dosing, citations,
lab interpretation, macros, or supplement claims.

---

## Dosing source-of-truth (no adapter drift)

Dosing is curated, not synthesized. The canonical dosing/schedule engine is the only dosing authority:
`BLEND_SCHEDULES`, `selectedScheduleFor`, and `blendScheduleFor` in `packages/protocol-core`.
Document adapters and renderers may reshape this output for display, but they must never infer,
generate, soften, overwrite, or "helpfully" complete dosing.

**Section 02 of a protocol is the selected schedule, not a range disclosure.** It must render the
curated scenario schedule when one exists: selected dose, route/form, frequency/timing,
onboarding/titration, maintenance, offboarding/taper, cycle/review, and source basis. Broader
research/community ranges belong in the compound-reference section.

**Blend rule:** a blend is not `NEEDS_SOURCE` merely because it has multiple compounds. A blend must
use the curated blend schedule. If no curated blend schedule exists, report the canonical gap and stop;
do not synthesize component math from memory.

Allowed dosing states:
- `SELECTED` — a curated schedule exists for this scenario and is rendered.
- `NEEDS_PRACTITIONER_SELECTION` — source references exist, but no scenario schedule has been selected.
- `NEEDS_SOURCE` — no verified dosing source/reference exists.

Anti-drift rule: before changing any dosing behavior, first prove there is no existing capability that
already owns it. If a parallel dosing path is discovered, collapse to the canonical engine immediately.

---

## Build protocol (how doctrine work must be executed)

Doctrine failures are process failures before they are code failures. For any change touching dosing,
evidence, protocols, labs, supplements, nutrition, meal plans, gates, or portal/document organization,
the agent must follow `docs/VITALIS-BUILD-PROTOCOL.md`.

Required behavior:
- identify the canonical source before editing
- read prior Vitalis protocol/template output when matching an existing standard
- use read-only extraction/mapping/QA specialists where useful
- avoid solo patching when the task spans doctrine, documents, and gates
- stop on source-of-truth collisions and report `DRIFT DETECTED`
- browser-verify document/dashboard changes against the requested product standard

---

## Enforcement (so it cannot recur)
- `research-doctrine.js` — single source of truth: `EXCLUDED_IDS`, `isExcludedSource`, `isGovernmentUrl`,
  `isEvidenceAuthority` (registry/index/gov are never the authority), `laneForUrl`, `appFacingRegistry`,
  `SOURCE_LANES`, `HONEST_LABELS`.
- `research.researchSourceRegistry()` runs the registry through `appFacingRegistry()` and labels every
  entry with its `lane` + `evidenceAuthority:false`.
- `data/research-sources.js` — WHO ICTRP + NIH ODS removed; gov sources noted as index/compliance only.
- `data/nutrient-evidence.js` — government fact-sheet citations auto-tagged `GovernmentReference` / COMPLIANCE.
- Tests: **RD1** no WHO/NIH in registry · **RD2** gov never an evidence authority (+ gov citations COMPLIANCE-tagged)
  · **RD3** this doctrine + lane hierarchy exist · **RD4** weak evidence stays honestly labeled.
- Dosing tests must fail if a renderer/adaptor presents prose-only dosing, substitutes broad ranges for
  selected schedules, marks a blend `NEEDS_SOURCE` when a curated blend schedule exists, or introduces a
  second dosing authority outside the canonical engine.
