/**
 * lab-panels.js — Lab panel source of truth.
 *
 * BASELINE is Dr. Vincent Lun's "Enhanced Healthy Living Assessment" — his standard
 * ordering, reproduced exactly (Hematology → Metabolic → Thyroid → Inflammation →
 * Minerals → Liver → Kidney → Lipid → Vitamins → Conditional). This is SOURCED.
 *
 * Optional panels that are strict subsets of the sourced baseline are SOURCED.
 * Panels whose exact markers are NOT enumerated in any source file (e.g. an explicit
 * male low-T / full hormone marker list) are emitted with status 'NEEDS_SOURCE' and
 * NO invented markers — per the hard rule: missing source => NEEDS_SOURCE, do not invent.
 *
 * Source: reference_dr_vincent_lun_bio_baseline_panel.md (locked 2026-05-28).
 */

const BASELINE = {
  id: 'baseline',
  label: 'Baseline — Dr. Lun "Enhanced Healthy Living Assessment"',
  status: 'SOURCED',
  source: "Dr. Vincent Lun — Enhanced Healthy Living Assessment (fasting 12h)",
  fasting: true,
  sections: [
    { section: 'Hematology & Iron', markers: ['CBC + Differential', 'Iron / TIBC', 'Ferritin'] },
    { section: 'Metabolic', markers: ['Glucose', 'Fasting Insulin', 'HbA1c'] },
    { section: 'Thyroid', markers: ['TSH'] },
    { section: 'Inflammation', markers: ['hs-CRP', 'ESR'] },
    { section: 'Minerals', markers: ['Potassium', 'Chloride', 'Sodium', 'Magnesium', 'Bicarbonate', 'Calcium (Serum)', 'Phosphorus'] },
    { section: 'Liver Function', markers: ['Albumin', 'Bilirubin (Direct)', 'ALP', 'GGT', 'ALT', 'LDH', 'AST', 'Fib-4 Score'] },
    { section: 'Kidney Function', markers: ['Protein (Total)', 'Bilirubin (Total)', 'Creatinine (incl. eGFR)', 'Uric Acid', 'BUN'] },
    { section: 'Lipid Panel', markers: ['Cholesterol', 'LDL', 'HDL', 'Triglycerides'] },
    { section: 'Vitamins', markers: ['Vitamin B12', 'Folate (RBC)', 'Vitamin D', 'Folate (Serum)'] },
    { section: 'Conditional / Reflexive', markers: ['Hormones panel (full) — per clinical reasoning', 'Homocysteine', 'Apolipoprotein A & B', 'US Biotek Advanced GI (stool)'] },
  ],
};

// Optional panels. SOURCED ones are explicit subsets of the baseline above.
const OPTIONAL = [
  {
    id: 'metabolic', label: 'Metabolic', status: 'SOURCED',
    source: 'Subset of Dr. Lun baseline — Metabolic section',
    markers: ['Glucose', 'Fasting Insulin', 'HbA1c'],
  },
  {
    id: 'inflammation', label: 'Inflammation', status: 'SOURCED',
    source: 'Subset of Dr. Lun baseline — Inflammation section',
    markers: ['hs-CRP', 'ESR'],
  },
  {
    id: 'vitamin_mineral', label: 'Vitamin / Mineral Deficiency', status: 'SOURCED',
    source: 'Subset of Dr. Lun baseline — Vitamins + Minerals sections',
    markers: ['Vitamin B12', 'Folate (RBC)', 'Vitamin D', 'Folate (Serum)', 'Magnesium', 'Calcium (Serum)', 'Phosphorus', 'Potassium', 'Sodium'],
  },
  {
    // Baseline only references "Hormones panel (full)" reflexively, without enumerating
    // the exact markers. We do NOT invent a Total-T/Free-T/LH/FSH list as if sourced.
    id: 'male_low_t', label: 'Male Low-Testosterone', status: 'NEEDS_SOURCE',
    source: null,
    markers: [],
    needs: 'Explicit male low-T marker list (e.g. Total T, Free T, SHBG, LH, FSH, Estradiol, Prolactin) is not enumerated in any current source file. Provide Dr. Lun\'s hormone panel ordering to populate.',
  },
  {
    id: 'hormone', label: 'Hormone (Full)', status: 'NEEDS_SOURCE',
    source: null,
    markers: [],
    needs: 'Baseline lists "Hormones panel (full)" as reflexive but does not enumerate markers. Awaiting sourced ordering.',
  },
  {
    id: 'safety_monitoring', label: 'Peptide Safety Monitoring (compound-specific)', status: 'SOURCED',
    source: 'Dr. Lun peptide-specific additions mapping (layered on baseline)',
    markers: [],                 // populated dynamically from PEPTIDE_ADDITIONS by selected products
    dynamic: true,
  },
];

// Peptide-specific additions — SOURCED mapping table. Layered on top of baseline by
// which compounds appear in the client's current products / draft.
// matcher = substring (normalized) tested against product/compound names.
const PEPTIDE_ADDITIONS = [
  { match: ['hgh', 'somatropin', 'growthhormone'], markers: ['IGF-1 (critical)', 'IGFBP-3'], cadence: 'Baseline + Wk 6 + Wk 12' },
  { match: ['cjc', 'ipamorelin', 'tesamorelin'],   markers: ['IGF-1', 'IGFBP-3'],            cadence: 'Baseline + Wk 12' },
  { match: ['ss31', 'motsc', 'mots'],              markers: ['Lactate (AM fasted)', 'CoQ10 serum', 'NAD/NADH (if available)'], cadence: 'Baseline + Wk 8' },
  { match: ['reta', 'semaglutide', 'sema', 'tirzep'], markers: ['Lipase', 'Amylase', 'Apolipoprotein A', 'Apolipoprotein B'], cadence: 'Baseline + Wk 6 + Wk 12' },
  { match: ['klow', 'ghkcu', 'ghk'],               markers: ['Zinc / Copper ratio'],          cadence: 'Baseline + Wk 12' },
  { match: ['aod'],                                 markers: ['Lipid panel (end of cycle)'],   cadence: 'Baseline + end of cycle' },
  { match: ['dsip', 'selank', 'epitalon', 'pinealon'], markers: ['Cortisol AM', 'Cortisol PM', 'Ferritin', 'Vitamin D'], cadence: 'Baseline + Wk 12' },
  { match: ['bpc', 'tb500', 'tb-500'],             markers: ['hs-CRP'],                        cadence: 'Baseline + Wk 6 + Wk 12' },
];

module.exports = {
  _provenance: { source: 'reference_dr_vincent_lun_bio_baseline_panel.md', locked: '2026-05-28' },
  BASELINE,
  OPTIONAL,
  PEPTIDE_ADDITIONS,
};
