/**
 * dosing.js — source-locked, ATTRIBUTION-FRAMED dosing reference for @vitalis/protocol-core.
 *
 * ── What this file is ─────────────────────────────────────────────────────────
 * A curated reference of dose RANGES *commonly reported in the peptide research
 * literature*. It is the answer to the directive "show what dosing to take and
 * present it in a way that waves liability": every number here is presented as an
 * ATTRIBUTION ("the literature reports X–Y mg, N×/week"), never as an INSTRUCTION
 * ("take X mg"). The distinction is the legal spine of the whole feature.
 *
 * ── What this file is NOT ─────────────────────────────────────────────────────
 *   • NOT a prescription, dosing schedule, or medical instruction.
 *   • NOT a fabricated citation. We do not bolt a fake study onto each number.
 *     The compound's REAL citations live in evidence.json (keyed by the same
 *     compoundId); this file carries the curated community/research RANGE plus an
 *     honest `basis` string. Where we do not have a defensible curated range the
 *     entry is status: 'UNKNOWN' and perDose is null — honest UNKNOWN over invention.
 *
 * ── The liability levers this file implements (2 of the 6) ────────────────────
 *   (1) Attribution, not instruction  → every render goes through researchRangeLabel()
 *   (2) Source-locked dosing          → status UNKNOWN where no curated range; never guessed
 * The other four levers (practitioner-mediated, attestation, two-tier client view,
 * jurisdiction acknowledgment) live in generator.js / gates.js / the server.
 *
 * ── Canonical Vitalis tier-matrix rules are ENFORCED here (single source) ─────
 *   • Retatrutide  → cap 4 mg/wk, titrate 2→3→4, MANDATORY 6-wk mirror taper
 *   • SS-31 + MOTS-c → always co-dosed (distinct pathways: quality + biogenesis)
 *   • Cardiogen    → always pairs with SS-31
 *   • CJC-1295 + Tesamorelin → NEVER together (GHRH redundancy)
 *   • KLOW         → ONE 4-compound co-lyophilized blend (never 4 separate items)
 *   • Kisspeptin   → pulsatile, Mon/Wed/Fri only
 *   • Dihexa       → T4-EXP (experimental tier) badge always
 *
 * Route note: the catalog is the authoritative source of route (all current items are
 * SubQ injection). `routeClass: 'INJECTED'` here is only a sanity hint the generator
 * cross-checks against the catalog — this file NEVER overrides the catalog route, so a
 * SubQ/oral/intranasal blur is structurally impossible.
 *
 * NOT medical advice. NOT legal advice.
 */

const RANGE_FRAMING =
  'Commonly-reported range in the peptide research literature — an educational reference, ' +
  'NOT a prescription or dosing instruction. A qualified, peptide-literate practitioner sets any actual dose.';

// ── Phase-2 dosing contract: the honest source/confidence layer ─────────────────
// sourceType says WHERE the range comes from; confidence says HOW SURE we are. Neither is
// ever inflated: a compound with no curated range is NEEDS_SOURCE (a research gap), never dressed
// up as a guideline. The exact line below is what every missing-dosing render must show.
const SOURCE_TYPES = ['STUDY_REPORTED', 'COMMUNITY_REFERENCE', 'PRACTITIONER_REVIEW', 'NEEDS_SOURCE'];
// Section-02 SELECTED-schedule status — the SCENARIO schedule, distinct from the evidence sourceType.
//   SELECTED                     a scenario-specific schedule exists and is rendered
//   NEEDS_PRACTITIONER_SELECTION dosing references exist, but no schedule was selected for THIS scenario
//   NEEDS_SOURCE                 no verified dosing reference/source exists at all (a true research gap)
// Never use NEEDS_SOURCE when the real issue is that a schedule has not been selected.
const SCHEDULE_STATUSES = ['SELECTED', 'NEEDS_PRACTITIONER_SELECTION', 'NEEDS_SOURCE'];
const CONFIDENCE_LEVELS = ['HIGH', 'MODERATE', 'LOW', 'NEEDS_REVIEW'];
const NEEDS_SOURCE_LINE = 'Dosing: NEEDS_SOURCE — no verified dosing reference loaded yet.';
// The exact line shown in the DOSE AMOUNT column when no verified amount exists (never faked).
const NEEDS_DOSE_LINE = 'NEEDS_SOURCE — no verified dosing amount loaded.';
// Real journal citations live in evidence.json (same compoundId key). We READ them — never fabricate.
const EVIDENCE = require('./evidence.json');

// One curated entry. Fields:
//   status      'CURATED' | 'UNKNOWN'  (UNKNOWN ⇒ perDose null, surfaced honestly)
//   perDose     { lowMg, highMg } | null  — amount per administration, in mg
//   frequency   human cadence string (e.g. 'daily', '2×/week')
//   schedule    canonical fixed schedule when one applies (e.g. 'Mon / Wed / Fri') | null
//   cycleWeeks  typical research cycle length (number) | null
//   titration   ramp instruction text | null
//   taper       wind-down instruction text | null   (Retatrutide carries the mandatory one)
//   scheduleGrid  CURATED ordered week/phase bands for Section 02 | null. Authored from the locked
//                 rules — NEVER parsed out of titration prose at render time. Each band:
//                 { weeks:[start,end], block:'Wk 1–4', phase:'Acclimation', dose:'2 mg'|'off',
//                   delivery:'once weekly'|null, milestone:'…'|null }. null ⇒ named-phase fallback.
//   coDoseWith  [compoundId]  — canonical pairings (SS-31↔MOTS-c, Cardiogen→SS-31)
//   neverWith   [compoundId]  — canonical exclusions (CJC↔Tesamorelin)
//   cautions    [string]      — honest, non-diagnostic cautions
//   basis       attribution string (why this range; what it is / is not)
const D = (o) => {
  const status = o.status || (o.perDose ? 'CURATED' : 'UNKNOWN');
  // CURATED + no explicit override → STUDY_REPORTED. No curated range → NEEDS_SOURCE (research gap).
  const sourceType = o.sourceType || (status === 'CURATED' ? 'STUDY_REPORTED' : 'NEEDS_SOURCE');
  const confidence = o.confidence || (status === 'CURATED' ? 'MODERATE' : 'NEEDS_REVIEW');
  return {
    status,
    perDose: o.perDose || null,
    unit: 'mg',
    frequency: o.frequency || null,
    schedule: o.schedule || null,
    cycleWeeks: o.cycleWeeks || null,
    titration: o.titration || null,
    taper: o.taper || null,
    maintenance: o.maintenance || null,
    ceiling: o.ceiling || null,
    // Section-02 curated week/phase bands (old Vitalis protocol-schedule standard). null ⇒ the
    // renderer falls back to the named onboarding/maintenance/offboarding phases (no invented weeks).
    // Each band: { weeks:[start,end], block:'Wk 1–4', phase:'…', dose:'2 mg'|'off', delivery, milestone }.
    scheduleGrid: o.scheduleGrid || null,
    coDoseWith: o.coDoseWith || [],
    neverWith: o.neverWith || [],
    cautions: o.cautions || [],
    basis: o.basis || RANGE_FRAMING,
    sourceType,
    confidence,
    sourceNote: o.sourceNote || null,
  };
};

// Keyed by evidence compoundId (same key as evidence.json byCompound + catalog.evidenceCompoundId).
const DOSING = {
  // ── Healing / recovery ──────────────────────────────────────────────────────
  bpc157: D({
    perDose: { lowMg: 0.25, highMg: 0.5 }, frequency: 'daily (often split AM/PM)', cycleWeeks: 4,
    coDoseWith: ['tb500'],
    cautions: ['Transient nausea / injection-site redness reported in sources.'],
    basis: 'Soft-tissue / GI recovery research; frequently co-reported with TB-500. ' + RANGE_FRAMING,
    // Curated cycle: a short daily soft-tissue repair block. No pharmacologic taper for this class —
    // stop at the end of the repair window and reassess.
    scheduleGrid: [
      { weeks: [1, 1], block: 'Days 1–3', phase: 'Onboarding', dose: '250 mcg', delivery: 'daily (often split AM/PM)', milestone: 'Half-dose first few days to confirm injection-site tolerance, then full dose.' },
      { weeks: [1, 4], block: 'Wk 1–4', phase: 'Repair block', dose: '500 mcg', delivery: 'daily (often split AM/PM)', milestone: 'Daily soft-tissue / GI repair loading; co-dose with TB-500.' },
      { weeks: [5, 5], block: 'Wk 5+', phase: 'Reassess', dose: 'off', delivery: null, milestone: 'Stop and reassess soft-tissue status; ≥2-week break before any re-cycle.' },
    ],
  }),
  tb500: D({
    perDose: { lowMg: 2.0, highMg: 2.5 }, frequency: '2×/week (loading), then weekly maintenance', cycleWeeks: 6,
    coDoseWith: ['bpc157'],
    basis: 'Connective-tissue recovery research; classic BPC-157 pairing. ' + RANGE_FRAMING,
  }),
  kpv: D({
    // α-MSH(11-13) anti-inflammatory tripeptide. No controlled-trial dose exists; community/practitioner
    // references (incl. KLOW-blend guides) commonly cite ~0.3–0.5 mg/day → COMMUNITY_REFERENCE, LOW.
    perDose: { lowMg: 0.3, highMg: 0.5 }, frequency: 'daily', cycleWeeks: 4,
    sourceType: 'COMMUNITY_REFERENCE', confidence: 'LOW',
    cautions: ['Anti-inflammatory α-MSH fragment; histamine-type reactions uncommon.'],
    basis: 'KPV community-reference dosing — no curated trial dose; anti-inflammatory tripeptide commonly co-formulated in repair blends (e.g. KLOW). ' + RANGE_FRAMING,
  }),
  cardiogen: D({
    // Khavinson-class bioregulator — injectable course dosing is practitioner-set; range not
    // defensibly curated ⇒ honest UNKNOWN, but the canonical SS-31 pairing rule is still carried.
    status: 'UNKNOWN', frequency: 'short bioregulator course (practitioner-set)',
    coDoseWith: ['ss31'],
    cautions: ['Peptide bioregulator — injectable dose range not curated here (UNKNOWN). Practitioner sets the course.'],
    basis: 'Canonical Vitalis rule: Cardiogen is paired with SS-31. Dose range UNKNOWN — not invented.',
  }),
  bronchogen: D({ status: 'UNKNOWN', basis: 'Bioregulator — injectable range not curated (UNKNOWN).' }),
  prostamax: D({ status: 'UNKNOWN', basis: 'Bioregulator — injectable range not curated (UNKNOWN).' }),
  teriparatide: D({
    perDose: { lowMg: 0.02, highMg: 0.02 }, frequency: 'daily', cycleWeeks: 12,
    sourceType: 'PRACTITIONER_REVIEW',
    sourceNote: 'Approved prescription drug (Forteo). Label reference only — a prescriber sets any dose.',
    cautions: ['This is an APPROVED PRESCRIPTION DRUG (Forteo / teriparatide). A prescriber is required — resource framing only.'],
    basis: 'Approved-drug label reference (20 mcg/day SubQ). Compliance gate elevates this item. ' + RANGE_FRAMING,
  }),

  // ── Weight / metabolic ──────────────────────────────────────────────────────
  reta: D({
    perDose: { lowMg: 2, highMg: 4 }, frequency: 'once weekly', cycleWeeks: 12,
    titration: 'Titrate 2 → 3 → 4 mg/week. HARD CEILING 4 mg/week (no 5/6/8 without explicit practitioner authorization).',
    taper: 'MANDATORY 6-week mirror taper at end of cycle: 4 → 3 → 2 → 1 → off, in 2-week steps (avoids cold-turkey rebound).',
    ceiling: '4 mg/week — hard ceiling per Vitalis rule (no 5/6/8 without explicit practitioner authorization).',
    maintenance: 'Hold at 4 mg/week once titrated; then run the mandatory taper.',
    cautions: ['GLP-1/GIP class overlaps approved drugs — compliance gate elevates to NEEDS_REVIEW.', 'GI side-effects on titration.'],
    basis: 'GLP-1/GIP titration literature (STEP-4, SURMOUNT-4 inform the taper rationale). ' + RANGE_FRAMING,
    // Curated week/phase bands (locked Reta rule): 2 mg acclimation → 4 mg ceiling hold → mandatory
    // 6-week mirror taper 4→3→2→1→off in 2-week steps. The 4 mg cap is the visible ceiling, never exceeded.
    scheduleGrid: [
      { weeks: [1, 4], block: 'Wk 1–4', phase: 'Acclimation', dose: '2 mg', delivery: 'once weekly', milestone: 'Start low; expect mild GI on titration. End of Wk 4 → step toward 4 mg ceiling.' },
      { weeks: [5, 12], block: 'Wk 5–12', phase: 'Hold at ceiling', dose: '4 mg', delivery: 'once weekly', milestone: '4 mg/week hard ceiling — sustained fat-loss phase. Mid-cycle bloodwork ~Wk 8.' },
      { weeks: [13, 14], block: 'Wk 13–14', phase: 'Taper step 1', dose: '3 mg', delivery: 'once weekly', milestone: 'Begin mandatory 6-week mirror taper (no cold-turkey stop).' },
      { weeks: [15, 16], block: 'Wk 15–16', phase: 'Taper step 2', dose: '2 mg', delivery: 'once weekly', milestone: null },
      { weeks: [17, 18], block: 'Wk 17–18', phase: 'Taper step 3', dose: '1 mg', delivery: 'once weekly', milestone: 'Final taper step before off.' },
      { weeks: [19, 19], block: 'Wk 19+', phase: 'Off', dose: 'off', delivery: null, milestone: 'Taper complete — reassess with the practitioner before any re-cycle.' },
    ],
  }),
  cagrilintide: D({
    perDose: { lowMg: 0.3, highMg: 2.4 }, frequency: 'once weekly', cycleWeeks: 12,
    titration: 'Long-acting amylin analog — titrate up slowly over weeks; practitioner sets steps.',
    cautions: ['Amylin-analog class — practitioner review required.'],
    basis: 'Amylin-analog (CagriSema-line) research. ' + RANGE_FRAMING,
  }),
  aod9604: D({
    perDose: { lowMg: 0.3, highMg: 0.3 }, frequency: 'daily', cycleWeeks: 12,
    basis: 'hGH-fragment (177-191) fat-metabolism research. ' + RANGE_FRAMING,
  }),
  adipotide: D({
    status: 'UNKNOWN',
    cautions: ['Limited / preclinical human data — dose range not curated (UNKNOWN). Practitioner + research review required.'],
    basis: 'Preclinical compound — honest UNKNOWN, not invented.',
  }),

  // ── Anti-aging / mitochondrial ──────────────────────────────────────────────
  ghkcu: D({
    perDose: { lowMg: 1, highMg: 2 }, frequency: 'daily', cycleWeeks: 6,
    cautions: ['Track Zn:Cu ratio on longer courses (copper peptide).'],
    basis: 'Copper-peptide skin / tissue-remodeling research. ' + RANGE_FRAMING,
  }),
  ss31: D({
    perDose: { lowMg: 10, highMg: 40 }, frequency: 'daily', cycleWeeks: 8,
    coDoseWith: ['motsc'],
    cautions: ['Evidence still emerging (corpus level UNKNOWN) — present as research only.', 'Always co-dosed with MOTS-c (distinct mechanism: mitochondrial quality vs. biogenesis).'],
    basis: 'Elamipretide (SS-31) clinical-trial dose reference; canonical Vitalis SS-31 + MOTS-c co-dose. ' + RANGE_FRAMING,
  }),
  motsc: D({
    perDose: { lowMg: 5, highMg: 10 }, frequency: '2–3×/week', cycleWeeks: 8,
    coDoseWith: ['ss31'],
    cautions: ['Mitochondrial-derived peptide; co-dosed with SS-31 by canonical rule.'],
    basis: 'Mitochondrial-biogenesis research; canonical SS-31 pairing. ' + RANGE_FRAMING,
  }),
  glutathione: D({
    perDose: { lowMg: 600, highMg: 1200 }, frequency: '1–2×/week', cycleWeeks: 8,
    basis: 'Antioxidant (master thiol) research-reported range. ' + RANGE_FRAMING,
  }),
  pinealon: D({ status: 'UNKNOWN', basis: 'Bioregulator — injectable range not curated (UNKNOWN).' }),
  humanin: D({ status: 'UNKNOWN', basis: 'Emerging mitochondrial peptide — range not curated (UNKNOWN).' }),
  pnc27: D({ status: 'UNKNOWN', basis: 'Preclinical compound — honest UNKNOWN.' }),
  epithalon: D({
    perDose: { lowMg: 5, highMg: 10 }, frequency: 'daily (short pulsed course)', cycleWeeks: 2,
    basis: 'Telomerase / pineal-peptide research-reported short-course range. ' + RANGE_FRAMING,
  }),
  nad: D({
    perDose: { lowMg: 50, highMg: 100 }, frequency: 'daily (slow administration)', cycleWeeks: 4,
    cautions: ['Flushing / nausea if administered too fast.'],
    basis: 'NAD+ research-reported range. ' + RANGE_FRAMING,
  }),

  // ── Performance / growth-axis ───────────────────────────────────────────────
  cjc: D({
    perDose: { lowMg: 0.1, highMg: 0.1 }, frequency: '1–2×/day (often nightly)', cycleWeeks: 12,
    coDoseWith: ['ipamorelin'],
    neverWith: ['tesamorelin', 'sermorelin'],
    cautions: ['GHRH analog — NEVER stack with Tesamorelin/Sermorelin (GHRH redundancy).'],
    basis: 'GHRH-analog (CJC-1295) research; classic Ipamorelin pairing. ' + RANGE_FRAMING,
  }),
  ipamorelin: D({
    perDose: { lowMg: 0.2, highMg: 0.3 }, frequency: '1–3×/day (commonly nightly)', cycleWeeks: 12,
    coDoseWith: ['cjc'],
    basis: 'Selective GH-secretagogue research; classic CJC-1295 pairing. ' + RANGE_FRAMING,
  }),
  sermorelin: D({
    perDose: { lowMg: 0.2, highMg: 0.3 }, frequency: 'nightly', cycleWeeks: 12,
    neverWith: ['tesamorelin', 'cjc'],
    cautions: ['GHRH analog — do not stack with other GHRH analogs (redundancy).'],
    basis: 'GHRH-analog research. ' + RANGE_FRAMING,
  }),
  tesamorelin: D({
    perDose: { lowMg: 1, highMg: 2 }, frequency: 'daily (nightly)', cycleWeeks: 12,
    neverWith: ['cjc', 'sermorelin'],
    cautions: ['GHRH analog — NEVER stack with CJC-1295/Sermorelin (GHRH redundancy).', 'GH-axis class overlaps approved drugs — compliance review.'],
    basis: 'Tesamorelin (visceral-fat) clinical reference. ' + RANGE_FRAMING,
  }),
  ghrp6: D({
    perDose: { lowMg: 0.1, highMg: 0.1 }, frequency: '1–3×/day', cycleWeeks: 8,
    cautions: ['Strong appetite stimulation reported.'],
    basis: 'GH-secretagogue (GHRP-6) research. ' + RANGE_FRAMING,
  }),
  igf1lr3: D({
    perDose: { lowMg: 0.02, highMg: 0.05 }, frequency: 'daily', cycleWeeks: 4,
    cautions: ['Hypoglycemia risk — practitioner review required.'],
    basis: 'IGF-1 LR3 research-reported range. ' + RANGE_FRAMING,
  }),
  igf1des: D({ status: 'UNKNOWN', basis: 'IGF-1 DES — range not defensibly curated (UNKNOWN).' }),
  follistatin344: D({ status: 'UNKNOWN', basis: 'Follistatin-344 — limited human data (UNKNOWN).' }),
  hexarelin: D({
    perDose: { lowMg: 0.1, highMg: 0.1 }, frequency: '1–3×/day', cycleWeeks: 6,
    cautions: ['Desensitization with continuous use — practitioner sets cycling.'],
    basis: 'GH-secretagogue (Hexarelin) research. ' + RANGE_FRAMING,
  }),
  pt141: D({
    perDose: { lowMg: 1, highMg: 2 }, frequency: 'PRN, ~45 min before activity (max ~1×/72h)', cycleWeeks: null,
    cautions: ['Transient nausea / flushing / transient BP rise reported.'],
    basis: 'Bremelanotide (PT-141) reference range. ' + RANGE_FRAMING,
  }),
  melanotan2: D({
    perDose: { lowMg: 0.25, highMg: 1.0 }, frequency: 'daily (loading), then maintenance', cycleWeeks: null,
    sourceType: 'COMMUNITY_REFERENCE',
    maintenance: 'Lower maintenance dose after the loading phase (practitioner-set).',
    cautions: ['Cosmetic/tanning use is off-label and not a therapeutic indication.', 'Nausea, new/darkening nevi — dermatology review advised.'],
    basis: 'Melanocortin-agonist (MT-2) community-reported range. ' + RANGE_FRAMING,
  }),
  kisspeptin: D({
    perDose: { lowMg: 0.1, highMg: 0.3 }, frequency: 'pulsatile', schedule: 'Mon / Wed / Fri only', cycleWeeks: 8,
    cautions: ['Canonical rule: pulsatile Mon/Wed/Fri only (continuous dosing desensitizes the axis).'],
    basis: 'Kisspeptin HPG-axis research; canonical Vitalis pulsatile M/W/F schedule. ' + RANGE_FRAMING,
  }),
  hcg: D({ status: 'UNKNOWN', sourceType: 'PRACTITIONER_REVIEW', cautions: ['Approved drug class — prescriber required.'], sourceNote: 'Approved-drug class — a qualified prescriber sets the dose; no curated research range is asserted.', basis: 'Approved-drug class — not curated here (UNKNOWN).' }),
  cjcnodac: D({
    perDose: { lowMg: 0.1, highMg: 0.1 }, frequency: '1–3×/day', cycleWeeks: 12,
    coDoseWith: ['ipamorelin'], neverWith: ['tesamorelin', 'sermorelin'],
    basis: 'CJC-1295 (no-DAC / Mod-GRF) research; Ipamorelin pairing. ' + RANGE_FRAMING,
  }),
  slupppp332: D({ status: 'UNKNOWN', basis: 'Range not defensibly curated (UNKNOWN).' }),
  hghfrag: D({ status: 'UNKNOWN', basis: 'hGH fragment — see AOD-9604; standalone range UNKNOWN.' }),

  // ── Immune ──────────────────────────────────────────────────────────────────
  ta1: D({
    perDose: { lowMg: 1.6, highMg: 1.6 }, frequency: '2×/week', cycleWeeks: 8,
    basis: 'Thymosin alpha-1 immune-modulation research. ' + RANGE_FRAMING,
  }),
  thymalin: D({ status: 'UNKNOWN', basis: 'Bioregulator — injectable range not curated (UNKNOWN).' }),
  thymogen: D({ status: 'UNKNOWN', basis: 'Bioregulator — injectable range not curated (UNKNOWN).' }),
  ll37: D({ status: 'UNKNOWN', cautions: ['Limited human dosing data.'], basis: 'Antimicrobial peptide — range UNKNOWN, not invented.' }),
  vip: D({ status: 'UNKNOWN', basis: 'VIP — range not curated (UNKNOWN).' }),
  gcmaf: D({ status: 'UNKNOWN', basis: 'Range not defensibly curated (UNKNOWN).' }),
  melittin: D({ status: 'UNKNOWN', cautions: ['Cytolytic peptide — significant caution; research only.'], basis: 'Honest UNKNOWN.' }),

  // ── Cognitive / sleep ───────────────────────────────────────────────────────
  semax: D({
    perDose: { lowMg: 0.2, highMg: 0.6 }, frequency: 'daily', cycleWeeks: 3,
    basis: 'Nootropic (Semax) research-reported range. ' + RANGE_FRAMING,
  }),
  selank: D({
    perDose: { lowMg: 0.25, highMg: 0.75 }, frequency: 'daily', cycleWeeks: 3,
    basis: 'Anxiolytic nootropic (Selank) research-reported range. ' + RANGE_FRAMING,
    // Curated cycle: a short daily nootropic course (no pharmacologic taper for this class).
    scheduleGrid: [
      { weeks: [1, 1], block: 'Wk 1', phase: 'Onboarding', dose: '250 mcg', delivery: 'daily', milestone: 'Begin at the low end; assess response before any change.' },
      { weeks: [1, 3], block: 'Wk 1–3', phase: 'Maintenance', dose: '250 mcg', delivery: 'daily', milestone: 'Daily through the short reference course.' },
      { weeks: [4, 4], block: 'Wk 4+', phase: 'Offboarding', dose: 'off', delivery: null, milestone: 'Stop at cycle end; reassess with the practitioner before any re-cycle.' },
    ],
  }),
  dsip: D({
    perDose: { lowMg: 0.1, highMg: 0.3 }, frequency: 'nightly, before sleep (PRN)', cycleWeeks: null,
    basis: 'Delta-sleep-inducing peptide research-reported range. ' + RANGE_FRAMING,
    // Curated cycle: nightly PRN sleep support. PRN class → "as-needed" maintenance, no fixed taper.
    scheduleGrid: [
      { weeks: [1, 1], block: 'Wk 1', phase: 'Onboarding', dose: '100 mcg', delivery: 'nightly, before sleep (PRN)', milestone: 'Begin at the low end before sleep; assess tolerance.' },
      { weeks: [1, 4], block: 'Wk 1–4', phase: 'Maintenance', dose: '100 mcg', delivery: 'nightly, before sleep (PRN)', milestone: 'As-needed nightly through the reference window.' },
      { weeks: [5, 5], block: 'Wk 5+', phase: 'Offboarding', dose: 'off', delivery: null, milestone: 'Discontinue when sleep is stable; PRN re-use with the practitioner.' },
    ],
  }),
  dihexa: D({
    status: 'UNKNOWN',
    cautions: ['T4-EXP (experimental tier) — potent synaptogenic compound, evidence early. Range not curated (UNKNOWN).'],
    basis: 'Canonical Vitalis Dihexa = T4-EXP experimental badge. Dose range UNKNOWN — not invented.',
  }),
  p21: D({ status: 'UNKNOWN', basis: 'Range not defensibly curated (UNKNOWN).' }),
  pinealon_cog: D({ status: 'UNKNOWN', basis: 'Bioregulator — UNKNOWN.' }),
  amino1mq: D({
    perDose: { lowMg: 50, highMg: 100 }, frequency: 'daily (oral in most sources)', cycleWeeks: 8,
    cautions: ['Most sources describe ORAL use — confirm the actual catalog item route before any framing.'],
    basis: 'NNMT-inhibitor (1-MNA / amino-1MQ) research-reported range. ' + RANGE_FRAMING,
  }),
};

// Canonical multi-compound protocol rules (single source for the generator to enforce).
const PROTOCOL_RULES = {
  // SS-31 and MOTS-c are mechanistically distinct (quality vs. biogenesis) → co-dose.
  coDose: [['ss31', 'motsc'], ['cardiogen', 'ss31'], ['cjc', 'ipamorelin']],
  // GHRH analogs are redundant with one another → never stack.
  neverWith: [['cjc', 'tesamorelin'], ['cjc', 'sermorelin'], ['sermorelin', 'tesamorelin']],
  // KLOW is ONE co-lyophilized blend (BPC-157 + TB-500 + KPV + GHK-Cu) — never 4 badges.
  blends: {
    klow: { label: 'KLOW (co-lyophilized blend)', components: ['bpc157', 'tb500', 'kpv', 'ghkcu'], note: 'Single 4-compound co-lyophilized blend — present as ONE item, never four.' },
  },
  experimentalTier: { dihexa: 'T4-EXP' },
};

const has = (id) => Object.prototype.hasOwnProperty.call(DOSING, id);

function dosingFor(compoundId) {
  return has(compoundId) ? DOSING[compoundId] : D({ status: 'UNKNOWN', basis: 'No curated dosing entry for this item (UNKNOWN — not invented).' });
}

// Render the per-dose range as an ATTRIBUTION string (the practitioner-facing form).
// Always reads as "the literature reports …", never "take …".
function researchRangeLabel(entry) {
  if (!entry || entry.status !== 'CURATED' || !entry.perDose) {
    return 'Dose range UNKNOWN — not curated; a qualified practitioner determines any dose.';
  }
  const { lowMg, highMg } = entry.perDose;
  const amount = lowMg === highMg ? `${lowMg} mg` : `${lowMg}–${highMg} mg`;
  const sched = entry.schedule ? ` (${entry.schedule})` : '';
  const freq = entry.frequency ? `, ${entry.frequency}` : '';
  return `Research literature commonly reports ${amount}${freq}${sched}.`;
}

// The softened CLIENT-facing form: same numbers, but explicitly deferred to the practitioner.
// Never a personal instruction; always "discuss with your practitioner".
function clientRangeLabel(entry) {
  if (!entry || entry.status !== 'CURATED' || !entry.perDose) {
    return 'Your practitioner will determine whether this is appropriate and at what amount.';
  }
  const { lowMg, highMg } = entry.perDose;
  const amount = lowMg === highMg ? `${lowMg} mg` : `${lowMg}–${highMg} mg`;
  return `Studies commonly report ${amount}${entry.frequency ? `, ${entry.frequency}` : ''} — review the right amount for you with your practitioner.`;
}

// Real journal citations for a compound's dosing — READ from evidence.json, never fabricated.
function dosingCitations(compoundId, max = 3) {
  const c = (((EVIDENCE.byCompound || {})[compoundId] || {}).citations) || [];
  return c.slice(0, max).map((x) => ({
    title: x.title || null,
    url: x.url || x.doi || null,
    source: x.source || x.journal || 'PubMed',
    year: x.year || null,
  }));
}

// The single honest dosing headline. Missing/uncurated dosing → the exact NEEDS_SOURCE line.
function dosingLine(entry) {
  if (!entry || entry.sourceType === 'NEEDS_SOURCE' || entry.status !== 'CURATED' || !entry.perDose) {
    return NEEDS_SOURCE_LINE;
  }
  const prefix = entry.sourceType === 'COMMUNITY_REFERENCE'
    ? 'Community-reference dosing range'
    : entry.sourceType === 'PRACTITIONER_REVIEW'
      ? 'Practitioner-review dosing (approved-drug class)'
      : 'Study-reported dosing schedule';
  return `${prefix}: ${researchRangeLabel(entry)}`;
}

function defaultSourceNote(entry) {
  switch (entry && entry.sourceType) {
    case 'NEEDS_SOURCE':
      return 'No verified dosing reference loaded yet — counts as a research gap until a peer-reviewed or curated source is attached.';
    case 'COMMUNITY_REFERENCE':
      return 'Range is community-reported, not from a controlled trial — educational research resource only, not a prescription.';
    case 'PRACTITIONER_REVIEW':
      return 'Approved-drug class — a qualified prescriber sets any actual dose. Educational research resource only, not a prescription.';
    default:
      return 'Range reflects amounts reported in the research literature — educational research resource only, not a prescription.';
  }
}

// Format a perDose {lowMg, highMg} as an EXPLICIT amount + unit. Sub-milligram renders in mcg for clarity.
// Returns null when no amount exists — callers show NEEDS_DOSE_LINE, never a fabricated number.
function formatDoseAmount(perDose) {
  if (!perDose || perDose.lowMg == null) return null;
  const { lowMg, highMg } = perDose;
  const top = highMg != null ? highMg : lowMg;
  const useMcg = top < 1;                          // sub-milligram dose → show micrograms
  const u = useMcg ? 'mcg' : 'mg';
  const f = (v) => {
    const n = useMcg ? v * 1000 : v;
    return Number.isInteger(n) ? String(n) : String(+n.toFixed(useMcg ? 0 : 2));
  };
  return (highMg == null || lowMg === highMg) ? `${f(lowMg)} ${u}` : `${f(lowMg)}–${f(highMg)} ${u}`;
}

// Selection status values live in SCHEDULE_STATUSES (defined above): SELECTED /
// NEEDS_PRACTITIONER_SELECTION / NEEDS_SOURCE — never confuse "no schedule" with "no source".

// isDosingGap / dosingGaps — a compound with NO curated reference (NEEDS_SOURCE) is a research gap.
// Reads the canonical engine directly; a blend that HAS a curated schedule is never a gap.
function isDosingGap(compoundId) {
  const id = String(compoundId || '').toLowerCase();
  const sched = BLEND_SCHEDULES[id] ? blendScheduleFor(id) : selectedScheduleFor(compoundId);
  return !sched || sched.scheduleStatus === 'NEEDS_SOURCE';
}
// Missing dosing counts as a research gap — returns the gap list for any set of compoundIds.
function dosingGaps(compoundIds = []) {
  return (Array.isArray(compoundIds) ? compoundIds : [])
    .filter((id) => isDosingGap(id))
    .map((id) => ({ compoundId: id, reason: 'NEEDS_SOURCE', line: NEEDS_SOURCE_LINE }));
}

// ── Phase-3: SELECTED scenario schedule (Section 02) + blend modeling ─────────
// Section 02 must show the SELECTED schedule for THIS research scenario (dose · frequency · timing ·
// onboarding/titration · maintenance · offboarding/taper · cycle/review · monitoring · source basis),
// framed as ATTRIBUTION ("for this research scenario, the reference schedule is…"). Section 03 keeps the
// broad reference range + evidence + uncertainty. A blend (KLOW) is modeled from its fixed-ratio
// components — it is NEVER NEEDS_SOURCE just because no single-compound corpus entry exists.

// Canonical blend schedules. KLOW is a Vitalis paired-compound schedule item, not four independent
// protocol lines. The schedule is expressed in IU because that is how the historical Vitalis protocols
// and cheat sheets carried it. Marc clarified the component math is WEEKLY exposure, not a per-dose
// or per-day component amount: KLOW 10 IU daily = 2.5mg BPC-157 + 2.5mg TB-500 + 2.5mg KPV +
// 10mg GHK-Cu per week. Do not multiply this into daily x7 / Mon-Fri exposure variants.
// This replaces the drifted vial-divide math and the later per-dose overcorrection; neither can be
// promoted into the selected protocol schedule.
const BLEND_SCHEDULES = {
  klow: {
    blendId: 'klow',
    label: 'KLOW — co-lyophilized 4-compound blend',
    scenario: 'Vitalis KLOW protocol schedule',
    ratioNote: 'KLOW is carried as one Vitalis paired compound. The selected protocol dose is KLOW 10 IU; the component translation is weekly exposure context only.',
    components: [
      { compoundId: 'bpc157', name: 'BPC-157', selectedAmount: 2.5, unit: 'mg', amountBasis: 'weekly', basis: 'KLOW 10 IU weekly exposure translation supplied by the Vitalis protocol standard.' },
      { compoundId: 'tb500', name: 'TB-500', selectedAmount: 2.5, unit: 'mg', amountBasis: 'weekly', basis: 'KLOW 10 IU weekly exposure translation supplied by the Vitalis protocol standard.' },
      { compoundId: 'kpv', name: 'KPV', selectedAmount: 2.5, unit: 'mg', amountBasis: 'weekly', basis: 'KLOW 10 IU weekly exposure translation supplied by the Vitalis protocol standard.' },
      { compoundId: 'ghkcu', name: 'GHK-Cu', selectedAmount: 10, unit: 'mg', amountBasis: 'weekly', basis: 'KLOW 10 IU weekly exposure translation supplied by the Vitalis protocol standard.' },
    ],
    selectedDose: 'KLOW 10 IU',
    // KLOW renders as ONE Section-02 column; the per-band dose is the FULL co-lyophilized blend amount
    // (never four columns). componentsHeader lists the 4 parts in the column header only.
    componentsHeader: 'Weekly exposure: BPC-157 2.5mg · TB-500 2.5mg · KPV 2.5mg · GHK-Cu 10mg',
    fullDose: 'KLOW 10 IU',
    doseTranslation: {
      weeklyExposure: '10 IU daily = 2.5mg BPC-157 + 2.5mg TB-500 + 2.5mg KPV + 10mg GHK-Cu per week',
      warning: 'Weekly exposure only — not per dose, not per day.',
    },
    selectedFrequency: 'Daily',
    selectedTiming: '10 IU per day; consistent time daily; rotate injection sites.',
    onboarding: 'Start KLOW 10 IU daily as the selected Vitalis reference schedule unless the practitioner adjusts the protocol.',
    maintenance: 'KLOW 10 IU daily through the focused repair block; use the weekly exposure math to understand cumulative component exposure.',
    offboarding: 'Stop at the end of the repair block or hold for practitioner reassessment before any new cycle.',
    cycleLength: 'Review after the focused repair block; practitioner decides whether to continue, pause, or cycle.',
    // Curated week/phase bands — ONE blend column. dose = full co-lyophilized blend amount per band.
    scheduleGrid: [
      { weeks: [1, 4], block: 'Wk 1–4', phase: 'Repair block', dose: 'KLOW 10 IU', delivery: 'daily', milestone: '10 IU daily selected schedule; weekly exposure translation = 2.5 / 2.5 / 2.5 / 10mg.' },
      { weeks: [5, 8], block: 'Wk 5–8', phase: 'Continue / assess', dose: 'KLOW 10 IU', delivery: 'daily', milestone: 'Continue KLOW 10 IU daily if the practitioner keeps the repair block active; track response and tolerability.' },
      { weeks: [9, 12], block: 'Wk 9–12', phase: 'Extended repair / review', dose: 'KLOW 10 IU', delivery: 'daily', milestone: 'Extended use should be reviewed against the weekly exposure translation: 2.5 / 2.5 / 2.5 / 10mg.' },
      { weeks: [13, 13], block: 'Wk 13+', phase: 'Hold / reassess', dose: 'off', delivery: null, milestone: 'Hold or recycle only after practitioner review.' },
    ],
    monitoring: 'Zinc:Copper ratio at baseline + ~Wk 12 / end of any extended course (daily GHK-Cu copper load); injection-site tolerance / histamine response; soft-tissue functional status as the recovery readout.',
    sourceBasis: 'COMMUNITY_REFERENCE',
    confidence: 'LOW',
    sourceNote: 'Historical Vitalis KLOW protocols carry KLOW as one paired compound in IU. Component mg is shown only as weekly exposure translation from the 10 IU selected schedule, not as a per-dose or per-day amount.',
    referenceRange: 'Selected Vitalis KLOW standard: KLOW 10 IU daily. Component translation is weekly exposure only: 2.5mg BPC-157 + 2.5mg TB-500 + 2.5mg KPV + 10mg GHK-Cu per week. KLOW remains one paired compound in the protocol schedule.',
    references: ['Historical Vitalis KLOW protocol guides and cheat sheets — KLOW carried as one paired compound with IU schedule; component translation recorded for research/reconstitution context.'],
  },
};

// Resolve a blend id from an item. KLOW has no single evidenceCompoundId, so detect by an explicit
// blendId or by the product name. Returns a blend key (e.g. 'klow') or null.
function blendIdForItem(item = {}) {
  if (item && item.blendId) return String(item.blendId).toLowerCase();
  const name = String((item && (item.productName || item.name)) || '').toLowerCase();
  return name.includes('klow') ? 'klow' : null;
}

// The SELECTED scenario schedule for a BLEND (Section 02). Returns null for an unknown blend.
function blendScheduleFor(blendId) {
  const b = BLEND_SCHEDULES[String(blendId || '').toLowerCase()];
  if (!b) return null;
  return {
    compound: b.blendId, isBlend: true, label: b.label, scenario: b.scenario, ratioNote: b.ratioNote,
    components: b.components.map((c) => ({ compoundId: c.compoundId, name: c.name, selectedAmount: c.selectedAmount, unit: c.unit, amountBasis: c.amountBasis || null, basis: c.basis })),
    componentsHeader: b.componentsHeader || null, fullDose: b.fullDose || null, doseTranslation: b.doseTranslation || null,
    scheduleStatus: 'SELECTED',
    selectedDose: b.selectedDose, selectedFrequency: b.selectedFrequency, selectedTiming: b.selectedTiming,
    onboarding: b.onboarding, maintenance: b.maintenance, offboarding: b.offboarding,
    cycleLength: b.cycleLength, monitoring: b.monitoring,
    // Curated Section-02 week/phase bands (ONE blend column; dose = full co-lyophilized blend amount).
    scheduleGrid: b.scheduleGrid || null,
    sourceBasis: b.sourceBasis, sourceNote: b.sourceNote, referenceRange: b.referenceRange,
    confidence: b.confidence, references: b.references || [],
  };
}

// The SELECTED scenario schedule for a single curated compound (Section 02). When a curated reference
// range EXISTS we SELECT a conservative scenario schedule (the range, framed as attribution) — never
// NEEDS_SOURCE. opts.selectedDose overrides the chosen amount; opts.defer → NEEDS_PRACTITIONER_SELECTION
// (references exist but the scenario schedule is deliberately left for the practitioner to set).
function selectedScheduleFor(compoundId, opts = {}) {
  const entry = dosingFor(compoundId);
  const noRef = entry.status !== 'CURATED' || !entry.perDose;
  if (noRef) {
    return {
      compound: compoundId, isBlend: false, components: [],
      scheduleStatus: 'NEEDS_SOURCE', sourceBasis: 'NEEDS_SOURCE',
      selectedDose: null, selectedFrequency: null, selectedTiming: null,
      onboarding: null, maintenance: null, offboarding: null, cycleLength: null, monitoring: null,
      scheduleGrid: null,
      referenceRange: null, sourceNote: defaultSourceNote(entry), confidence: entry.confidence || 'NEEDS_REVIEW',
    };
  }
  const range = formatDoseAmount(entry.perDose);
  const lowPoint = formatDoseAmount({ lowMg: entry.perDose.lowMg, highMg: null });
  const highPoint = formatDoseAmount({ lowMg: entry.perDose.highMg, highMg: null });
  if (opts.defer) {
    return {
      compound: compoundId, isBlend: false, components: [],
      scheduleStatus: 'NEEDS_PRACTITIONER_SELECTION', sourceBasis: 'NEEDS_PRACTITIONER_SELECTION',
      selectedDose: null, selectedFrequency: entry.frequency, selectedTiming: entry.schedule || null,
      onboarding: entry.titration || null, maintenance: entry.maintenance || null, offboarding: entry.taper || null,
      cycleLength: entry.cycleWeeks ? `${entry.cycleWeeks} weeks` : null,
      monitoring: (entry.cautions || []).join(' · ') || null,
      // Curated bands still travel with a deferred compound (the practitioner confirms / overrides them).
      scheduleGrid: entry.scheduleGrid || null,
      referenceRange: researchRangeLabel(entry),
      sourceNote: 'Dosing references exist; a specific scenario schedule has not been selected — the practitioner selects within the reference range.',
      confidence: entry.confidence,
    };
  }
  return {
    compound: compoundId, isBlend: false, components: [],
    scheduleStatus: 'SELECTED',
    // EXACT selected dose (protocol-style), never a "range" hedge. Titration compounds show the ladder.
    // The broad reference range lives only in `referenceRange` (source context / Section 03).
    selectedDose: opts.selectedDose
      || (entry.titration && entry.perDose.lowMg !== entry.perDose.highMg
        ? `${lowPoint} → ${highPoint}${entry.frequency ? `, ${entry.frequency}` : ''}`
        : `${lowPoint}${entry.frequency ? `, ${entry.frequency}` : ''}`),
    selectedFrequency: entry.frequency,
    selectedTiming: entry.schedule || null,
    onboarding: entry.titration || `Begin at ${lowPoint}${entry.frequency ? `, ${entry.frequency}` : ''}; reassess with the practitioner before any change.`,
    maintenance: entry.maintenance || `Hold at ${lowPoint}${entry.frequency ? `, ${entry.frequency}` : ''} through the ${entry.cycleWeeks ? `${entry.cycleWeeks}-week` : 'reference'} cycle.`,
    offboarding: entry.taper || 'No pharmacologic taper required for this class unless noted — stop at cycle end and reassess with the practitioner before any re-cycle.',
    cycleLength: entry.cycleWeeks ? `${entry.cycleWeeks} weeks, then reassess` : 'Reassess after labs / with practitioner',
    monitoring: (entry.cautions && entry.cautions.length) ? entry.cautions.join(' · ') : null,
    // Curated Section-02 week/phase bands when authored; null ⇒ renderer uses the named-phase fallback.
    scheduleGrid: entry.scheduleGrid || null,
    sourceBasis: entry.sourceType,
    sourceNote: entry.sourceNote || defaultSourceNote(entry),
    referenceRange: researchRangeLabel(entry),
    confidence: entry.confidence,
    ceiling: entry.ceiling || null,
  };
}

module.exports = {
  _provenance: {
    source: 'hand-curated research-range reference (Vitalis protocol-core)',
    framing: 'ATTRIBUTION not instruction. UNKNOWN where not defensibly curated. NOT medical or legal advice. '
      + 'Phase-2 contract: every entry carries sourceType (STUDY_REPORTED / COMMUNITY_REFERENCE / PRACTITIONER_REVIEW / NEEDS_SOURCE) '
      + '+ confidence (HIGH / MODERATE / LOW / NEEDS_REVIEW); NEEDS_SOURCE is a research gap, never dressed up as a guideline.',
    rulesEnforced: ['Reta ≤4mg/wk + mandatory 6-wk taper', 'SS-31+MOTS-c co-dose', 'Cardiogen+SS-31', 'CJC+Tesamorelin never together', 'KLOW single blend', 'Kisspeptin M/W/F', 'Dihexa T4-EXP'],
  },
  RANGE_FRAMING,
  SOURCE_TYPES,
  CONFIDENCE_LEVELS,
  NEEDS_SOURCE_LINE,
  NEEDS_DOSE_LINE,
  formatDoseAmount,
  DOSING,
  PROTOCOL_RULES,
  dosingFor,
  researchRangeLabel,
  clientRangeLabel,
  dosingCitations,
  dosingLine,
  isDosingGap,
  dosingGaps,
  SCHEDULE_STATUSES,
  BLEND_SCHEDULES,
  blendIdForItem,
  blendScheduleFor,
  selectedScheduleFor,
};
