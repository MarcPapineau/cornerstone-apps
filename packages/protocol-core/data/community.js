/**
 * community.js — the "what the greater peptide community is doing" layer.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 * The directive: don't be OVERLY cautious. Where formal trials exist, show what the
 * STUDIES say (that data already lives in evidence.json — citations, mechanism,
 * trial status). Where they DON'T, instead of a dead "UNKNOWN", show what the greater
 * peptide community actually does: what they use a compound for, in what circumstances,
 * how, and what benefits they report. That is genuinely useful — and it stays liability-
 * safe because it is ATTRIBUTED REPORTAGE, never a Vitalis claim or an instruction.
 *
 *   STUDIES say …      → sourced from evidence.json (real citations) by presentation.js
 *   the COMMUNITY does … → this file (use context, common pattern, reported benefits)
 *
 * ── The honesty rules (non-negotiable) ───────────────────────────────────────
 *   • Reported benefits are framed as REPORTED ("users / practitioners report …"),
 *     never asserted as fact and never as a Vitalis health claim.
 *   • No fabricated statistics, no invented studies. Specific numeric endpoints come
 *     ONLY from real citations in evidence.json — never from this file.
 *   • `evidenceNote` tells the truth about strength (RCT vs preclinical vs anecdote vs
 *     retracted). We would rather under-claim than over-claim.
 *   • `pattern` (how the community administers it) is PRACTITIONER-FACING ONLY — the
 *     client view never receives an administration how-to (same boundary as titration/taper).
 *
 * Keyed by evidence compoundId (same key as evidence.json byCompound + dosing.js).
 * A compound with no entry here degrades gracefully (studies-only, or honest minimal).
 *
 * NOT medical advice. NOT legal advice.
 */

const COMMUNITY_FRAMING =
  'Aggregated from how the peptide community and practitioners commonly describe using this ' +
  'compound. Reported use and benefits — NOT clinical-trial proof, NOT a Vitalis claim, NOT an instruction.';

// One profile. Fields:
//   basis            'STUDY' | 'COMMUNITY' | 'EMERGING'   — the curated call on where the weight sits.
//                    STUDY = real trial/clinical weight · COMMUNITY = mostly anecdotal/practitioner use ·
//                    EMERGING = early/preclinical, even community use is thin.
//   usedFor          [string]  — the goals/reasons it is commonly used for (client-safe).
//   pattern          string|null — how the community commonly runs it (PRACTITIONER-ONLY how-to).
//   reportedBenefits [string]  — benefits users/practitioners REPORT (attributed, client-safe, never asserted).
//   evidenceNote     string    — the honest strength-of-evidence one-liner.
const C = (o) => ({
  basis: o.basis || 'COMMUNITY',
  usedFor: o.usedFor || [],
  pattern: o.pattern || null,
  reportedBenefits: o.reportedBenefits || [],
  evidenceNote: o.evidenceNote || COMMUNITY_FRAMING,
});

const COMMUNITY = {
  // ── Healing / recovery ──────────────────────────────────────────────────────
  bpc157: C({
    basis: 'STUDY',
    usedFor: ['Soft-tissue, tendon & ligament recovery', 'Gut / GI repair', 'Nagging joint discomfort'],
    pattern: 'Commonly run in ~4-week cycles, frequently paired with TB-500 for connective-tissue work; community practice often injects SubQ near the area of interest.',
    reportedBenefits: ['Faster recovery from soft-tissue and tendon injuries', 'Reduced gut/GI inflammation', 'Improved comfort in overused joints'],
    evidenceNote: 'Multiple preclinical (animal/in-vitro) tendon-healing and IBD studies cited; no human RCT cited. Strong mechanistic + animal data, human evidence still anecdotal.',
  }),
  tb500: C({
    basis: 'COMMUNITY',
    usedFor: ['Connective-tissue & muscle recovery', 'Flexibility / range of motion', 'Systemic healing support'],
    pattern: 'Community pattern: a loading phase (~2×/week) then weekly maintenance over ~6 weeks; classically stacked with BPC-157.',
    reportedBenefits: ['Reported faster connective-tissue recovery', 'Reported improved flexibility', 'Reported whole-body (not just local) healing feel'],
    evidenceNote: 'Mechanistic actin-regulation rationale; human data largely anecdotal/community-reported. No human RCT cited.',
  }),
  cardiogen: C({
    basis: 'COMMUNITY',
    usedFor: ['Cardiac-tissue support', 'Recovery alongside mitochondrial work'],
    pattern: 'Khavinson-style short bioregulator course (practitioner-set); canonically paired with SS-31 in Vitalis practice.',
    reportedBenefits: ['Reported cardiac-tissue / recovery support', 'Generally reported as very well tolerated'],
    evidenceNote: 'Russian (Khavinson Institute) bioregulator literature only; 1 citation, no Western RCT. Treat as community/bioregulator practice, not established clinical evidence.',
  }),

  // ── Weight / metabolic ──────────────────────────────────────────────────────
  reta: C({
    basis: 'STUDY',
    usedFor: ['Significant fat loss', 'Metabolic / appetite control'],
    pattern: 'Community + trial pattern: titrate slowly (2→3→4 mg/week) to manage GI side-effects; Vitalis caps at 4 mg/week with a mandatory 6-week taper.',
    reportedBenefits: ['Large body-weight reduction reported in trials', 'Strong appetite / satiety control', 'Improved metabolic markers'],
    evidenceNote: 'Human Phase 2 clinical-trial evidence cited (GIP/GLP-1/glucagon triple agonist). The strongest evidence tier in this corpus.',
  }),
  cagrilintide: C({
    basis: 'STUDY',
    usedFor: ['Appetite / satiety control', 'Fat loss (often alongside a GLP-1)'],
    pattern: 'Long-acting amylin analog; community + trial pattern titrates up slowly over weeks. Often paired with semaglutide (the "CagriSema" approach).',
    reportedBenefits: ['Reported appetite reduction and satiety', 'Reported additive weight loss when combined with a GLP-1'],
    evidenceNote: 'Amylin-analog clinical research (CagriSema line) cited; practitioner review required.',
  }),
  aod9604: C({
    basis: 'COMMUNITY',
    usedFor: ['Targeted fat metabolism', 'Body recomposition'],
    pattern: 'Community pattern: daily, often fasted AM; run in ~12-week blocks.',
    reportedBenefits: ['Reported fat loss without the GH-axis side-effects of full growth-hormone peptides'],
    evidenceNote: 'hGH-fragment (177-191) research; human fat-loss evidence is mixed/limited. Largely community-reported.',
  }),

  // ── Anti-aging / mitochondrial ──────────────────────────────────────────────
  ghkcu: C({
    basis: 'COMMUNITY',
    usedFor: ['Skin quality & collagen', 'Wound / tissue remodeling', 'Hair support'],
    pattern: 'Community pattern: daily over ~6-week courses; injectable for systemic, topical for skin. Track Zn:Cu on longer runs.',
    reportedBenefits: ['Reported improvements in skin firmness/texture', 'Reported wound-healing support', 'Reported hair-quality improvements'],
    evidenceNote: 'Copper-peptide skin-remodeling research (much of it topical/in-vitro); injectable systemic use is largely community practice.',
  }),
  ss31: C({
    basis: 'COMMUNITY',
    usedFor: ['Mitochondrial energy / fatigue', 'Exercise capacity', 'Cellular anti-aging'],
    pattern: 'Community pattern: daily over ~8-week cycles; canonically co-dosed with MOTS-c (distinct mechanism: quality vs. biogenesis).',
    reportedBenefits: ['Reported improvements in energy and fatigue', 'Reported better exercise tolerance', 'Reported recovery support'],
    evidenceNote: 'Elamipretide (SS-31) has formal clinical research in mitochondrial disease, but community injectable anti-aging use sits well beyond those indications — present as research-adjacent community practice. Corpus evidence level: UNKNOWN.',
  }),
  motsc: C({
    basis: 'COMMUNITY',
    usedFor: ['Metabolic / mitochondrial support', 'Endurance & energy'],
    pattern: 'Community pattern: 2–3×/week over ~8 weeks; canonically co-dosed with SS-31.',
    reportedBenefits: ['Reported energy and endurance improvements', 'Reported metabolic / body-composition support'],
    evidenceNote: 'Mitochondrial-derived-peptide ("exercise mimetic") research is mostly preclinical; human use is community-reported.',
  }),
  glutathione: C({
    basis: 'COMMUNITY',
    usedFor: ['Antioxidant / detox support', 'Skin brightening', 'Recovery'],
    pattern: 'Community pattern: 1–2×/week; IV/IM in clinics, SubQ in self-directed community use.',
    reportedBenefits: ['Reported antioxidant / detox feel', 'Reported skin brightening', 'Reported recovery support'],
    evidenceNote: 'Master-antioxidant (thiol) rationale is well established; specific injected-dose benefits are largely community/clinic-reported.',
  }),
  epithalon: C({
    basis: 'COMMUNITY',
    usedFor: ['Longevity / "anti-aging" courses', 'Sleep & circadian support'],
    pattern: 'Community pattern: short pulsed courses (e.g. ~10–20 days, 1–2× per year) rather than continuous use.',
    reportedBenefits: ['Reported sleep improvements', 'Reported general "anti-aging" / wellbeing feel'],
    evidenceNote: 'Telomerase/pineal-peptide research is largely from one research group; human longevity claims are not independently established. Community/pulsed-course practice.',
  }),
  nad: C({
    basis: 'COMMUNITY',
    usedFor: ['Cellular energy', 'Mental clarity', 'Recovery / longevity support'],
    pattern: 'Community pattern: daily, administered slowly (fast administration causes flushing/nausea); ~4-week blocks.',
    reportedBenefits: ['Reported energy and clarity', 'Reported recovery and "reset" feel'],
    evidenceNote: 'NAD+ biology is well studied; benefits of injected NAD+ specifically are largely community/clinic-reported.',
  }),

  // ── Performance / growth-axis ───────────────────────────────────────────────
  cjc: C({
    basis: 'COMMUNITY',
    usedFor: ['Lean mass & recovery', 'Sleep quality', 'Body composition'],
    pattern: 'Community pattern: nightly (GH pulse follows sleep onset), classically paired with Ipamorelin. NEVER stacked with Tesamorelin/Sermorelin (GHRH redundancy).',
    reportedBenefits: ['Reported lean-mass and recovery support', 'Reported deeper sleep', 'Reported body-composition improvements'],
    evidenceNote: 'GHRH-analog pharmacology is established; the popular CJC+Ipamorelin body-composition use is largely community-reported.',
  }),
  ipamorelin: C({
    basis: 'COMMUNITY',
    usedFor: ['Lean mass & recovery', 'Sleep', 'Gentle GH support'],
    pattern: 'Community pattern: nightly (and/or post-workout), paired with CJC-1295; valued for being selective (little cortisol/prolactin bump).',
    reportedBenefits: ['Reported recovery and sleep improvements', 'Reported lean-mass support with a clean side-effect profile'],
    evidenceNote: 'Selective GH-secretagogue; human physique/recovery benefits are largely community-reported.',
  }),
  tesamorelin: C({
    basis: 'STUDY',
    usedFor: ['Visceral (belly) fat reduction', 'Body composition'],
    pattern: 'Community + label pattern: nightly. GHRH analog — NEVER stack with CJC-1295/Sermorelin.',
    reportedBenefits: ['Clinically studied visceral-fat reduction', 'Reported body-composition improvement'],
    evidenceNote: 'Approved-drug (Egrifta) clinical evidence for visceral fat cited; off-label community use extends beyond that.',
  }),
  ghrp6: C({
    basis: 'COMMUNITY',
    usedFor: ['GH support & recovery', 'Appetite stimulation (bulking)'],
    pattern: 'Community pattern: 1–3×/day; notable for strong hunger stimulation, sometimes used deliberately to drive appetite.',
    reportedBenefits: ['Reported recovery and GH-support', 'Reported strong appetite increase'],
    evidenceNote: 'GH-secretagogue pharmacology established; physique use is community-reported.',
  }),
  igf1lr3: C({
    basis: 'COMMUNITY',
    usedFor: ['Muscle growth', 'Recovery'],
    pattern: 'Community pattern: daily, ~4-week blocks. Hypoglycemia risk — community practice times it with food; practitioner review required.',
    reportedBenefits: ['Reported muscle growth and pump', 'Reported recovery support'],
    evidenceNote: 'Long-acting IGF-1 analog; human physique benefits are community-reported with meaningful safety cautions.',
  }),
  hexarelin: C({
    basis: 'COMMUNITY',
    usedFor: ['GH support & strength'],
    pattern: 'Community pattern: 1–3×/day with deliberate cycling — desensitizes with continuous use.',
    reportedBenefits: ['Reported GH-support and strength', 'Potent secretagogue effect reported'],
    evidenceNote: 'Potent GH-secretagogue; desensitization is well noted. Physique use community-reported.',
  }),
  pt141: C({
    basis: 'STUDY',
    usedFor: ['Libido / sexual function'],
    pattern: 'Community + label pattern: PRN, ~45 min before activity; community caps frequency (~1× per 72h) for tolerability.',
    reportedBenefits: ['Clinically studied effect on sexual desire', 'Reported improved arousal/response'],
    evidenceNote: 'Approved-drug (Vyleesi / bremelanotide) clinical evidence cited; transient nausea/flushing/BP rise reported.',
  }),
  melanotan2: C({
    basis: 'COMMUNITY',
    usedFor: ['Tanning / pigmentation', 'Libido (secondary)'],
    pattern: 'Community pattern: low daily loading then maintenance. Cosmetic/tanning use is off-label.',
    reportedBenefits: ['Reported tanning with less sun exposure', 'Reported libido increase'],
    evidenceNote: 'Melanocortin-agonist; community/cosmetic use. Nausea and new/darkening moles reported — dermatology review advised.',
  }),
  kisspeptin: C({
    basis: 'COMMUNITY',
    usedFor: ['Hormonal-axis (HPG) support', 'Libido'],
    pattern: 'Canonical Vitalis pattern: pulsatile, Mon/Wed/Fri only — continuous dosing desensitizes the axis.',
    reportedBenefits: ['Reported support of natural hormone signaling', 'Reported libido / wellbeing improvements'],
    evidenceNote: 'Kisspeptin HPG-axis research is real in clinical/fertility contexts; physique/libido community use extends beyond that.',
  }),

  // ── Immune ──────────────────────────────────────────────────────────────────
  ta1: C({
    basis: 'STUDY',
    usedFor: ['Immune resilience', 'Recovery from illness', 'Immune modulation'],
    pattern: 'Community + clinical pattern: ~2×/week over ~8-week courses.',
    reportedBenefits: ['Clinically used for immune modulation in some regions', 'Reported resilience / fewer-illness feel'],
    evidenceNote: 'Thymosin alpha-1 has genuine clinical use for immune modulation in several countries; general-wellness use is community-reported.',
  }),

  // ── Cognitive / sleep ───────────────────────────────────────────────────────
  semax: C({
    basis: 'COMMUNITY',
    usedFor: ['Focus & mental clarity', 'Mood', 'Neuroprotection'],
    pattern: 'Community pattern: daily (often intranasal in source literature — confirm the catalog route), short ~3-week courses.',
    reportedBenefits: ['Reported focus and clarity', 'Reported mood support', 'Reported neuroprotective feel under stress'],
    evidenceNote: 'Russian-registry nootropic with clinical use there; Western evidence is limited. Community-reported for general focus.',
  }),
  selank: C({
    basis: 'COMMUNITY',
    usedFor: ['Calm / anxiety reduction', 'Focus under stress'],
    pattern: 'Community pattern: daily, short ~3-week courses; the anxiolytic counterpart to Semax.',
    reportedBenefits: ['Reported calm without sedation', 'Reported anxiety reduction', 'Reported steadier focus'],
    evidenceNote: 'Russian-registry anxiolytic peptide; Western clinical evidence limited. Community-reported.',
  }),
  dsip: C({
    basis: 'COMMUNITY',
    usedFor: ['Sleep quality', 'Stress / recovery'],
    pattern: 'Community pattern: nightly before sleep, PRN rather than continuous.',
    reportedBenefits: ['Reported improved sleep onset/quality', 'Reported stress reduction'],
    evidenceNote: 'Delta-sleep-inducing peptide; human sleep evidence is old and limited. Community-reported.',
  }),
  dihexa: C({
    basis: 'EMERGING',
    usedFor: ['Cognition / memory (experimental)'],
    pattern: null, // experimental — Vitalis does not surface a community administration how-to.
    reportedBenefits: ['Some users report cognitive / memory effects (anecdotal)'],
    evidenceNote: 'EXPERIMENTAL (Vitalis T4-EXP tier). A key early citation was RETRACTED in 2025. Potent MET-pathway activity raises cancer-growth caution. Evidence is thin and contested — present with strong caution, not enthusiasm.',
  }),
  amino1mq: C({
    basis: 'COMMUNITY',
    usedFor: ['Metabolic / fat-loss support', 'NAD+ preservation'],
    pattern: 'Most sources describe ORAL use — confirm the actual catalog item route before any framing; daily, ~8-week blocks.',
    reportedBenefits: ['Reported fat-loss / metabolic support', 'Reported energy via NAD+ preservation'],
    evidenceNote: 'NNMT-inhibitor (1-MNA) research is largely preclinical; human metabolic benefits are community-reported.',
  }),
};

const has = (id) => Object.prototype.hasOwnProperty.call(COMMUNITY, id);

// Returns a profile for a compound, or null when none is curated (caller degrades gracefully
// to a studies-only / honest-minimal presentation — never fabricates a community profile).
function communityFor(compoundId) {
  return has(compoundId) ? COMMUNITY[compoundId] : null;
}

module.exports = {
  _provenance: {
    source: 'hand-curated community-use reference (Vitalis protocol-core)',
    framing: 'ATTRIBUTED REPORTAGE of community/practitioner use + reported benefits. NOT clinical proof, NOT a Vitalis claim, NOT an instruction. Specific numeric endpoints come only from real citations in evidence.json.',
  },
  COMMUNITY_FRAMING,
  COMMUNITY,
  communityFor,
};
