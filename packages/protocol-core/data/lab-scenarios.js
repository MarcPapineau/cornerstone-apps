'use strict';
/**
 * lab-scenarios.js — GENERIC demo lab scenarios (no real patient data).
 *
 * REUSE > REBUILD. Each scenario is just LabResult-shaped `values` ({ marker, value, unit, refLow, refHigh })
 * — the SAME shape the lab tracker + nutrition engine already consume. Flagging (in/out of range) and
 * deltas are computed by the EXISTING gate (gates.labResultFlagGate); this file invents NO interpretation.
 * Reference ranges are conventional/illustrative for a demo. NOT medical advice, diagnosis, or treatment.
 *
 * These feed, unchanged:
 *   • gates.labResultFlagGate   → flags + "review with provider" actions
 *   • nutrition.analyzeLabForNutrients → lab-driven supplement / nutrition suggestions
 *   • the generator (via goal) → lab-driven peptide research references
 */
const gates = require('../gates');

function num(x) { return (x == null || x === '') ? null : (Number.isFinite(+x) ? +x : null); }

// 3 generic personas (Marc's brief). Each: baseline + follow-up values + a stated research goal.
const SCENARIOS = [
  {
    id: 'fat-loss-metabolic',
    title: 'Fat-loss / metabolic optimization',
    goal: 'fat loss, energy, improved body composition',
    persona: 'Generic adult researching metabolic + body-composition improvement.',
    narrative: 'Baseline shows insulin-resistance signals (elevated fasting insulin, borderline HbA1c), '
      + 'elevated ApoB, mildly elevated hs-CRP, and low vitamin D. The follow-up panel after a research-informed '
      + 'block shows movement toward the reference range. Out-of-range values are flagged for provider review — not a diagnosis.',
    baseline: [
      { marker: 'Fasting Insulin', value: 18, unit: 'µIU/mL', refLow: 2, refHigh: 12 },
      { marker: 'HbA1c', value: 5.9, unit: '%', refLow: 4.0, refHigh: 5.6 },
      { marker: 'ApoB', value: 1.15, unit: 'g/L', refLow: 0.4, refHigh: 1.0 },
      { marker: 'hs-CRP', value: 3.2, unit: 'mg/L', refLow: 0, refHigh: 3.0 },
      { marker: 'Vitamin D (25-OH)', value: 48, unit: 'nmol/L', refLow: 75, refHigh: 250 },
      { marker: 'Triglycerides', value: 2.1, unit: 'mmol/L', refLow: 0, refHigh: 1.7 },
    ],
    followUp: [
      { marker: 'Fasting Insulin', value: 11, unit: 'µIU/mL', refLow: 2, refHigh: 12 },
      { marker: 'HbA1c', value: 5.5, unit: '%', refLow: 4.0, refHigh: 5.6 },
      { marker: 'ApoB', value: 0.98, unit: 'g/L', refLow: 0.4, refHigh: 1.0 },
      { marker: 'hs-CRP', value: 1.8, unit: 'mg/L', refLow: 0, refHigh: 3.0 },
      { marker: 'Vitamin D (25-OH)', value: 92, unit: 'nmol/L', refLow: 75, refHigh: 250 },
      { marker: 'Triglycerides', value: 1.4, unit: 'mmol/L', refLow: 0, refHigh: 1.7 },
    ],
  },
  {
    id: 'recovery-inflammation',
    title: 'Recovery / inflammation / joint support',
    goal: 'recovery, training support, sleep quality',
    persona: 'Generic active adult researching recovery + training support.',
    narrative: 'Baseline shows elevated hs-CRP, low ferritin (borderline iron stores), and low magnesium, with '
      + 'liver enzymes (AST/ALT) in range. The follow-up panel shows inflammation and mineral status moving toward range. '
      + 'Out-of-range values are flagged for provider review — not a diagnosis.',
    baseline: [
      { marker: 'hs-CRP', value: 4.5, unit: 'mg/L', refLow: 0, refHigh: 3.0 },
      { marker: 'Ferritin', value: 22, unit: 'µg/L', refLow: 30, refHigh: 400 },
      { marker: 'Magnesium', value: 0.70, unit: 'mmol/L', refLow: 0.75, refHigh: 0.95 },
      { marker: 'Vitamin D (25-OH)', value: 58, unit: 'nmol/L', refLow: 75, refHigh: 250 },
      { marker: 'AST', value: 24, unit: 'U/L', refLow: 10, refHigh: 40 },
      { marker: 'ALT', value: 28, unit: 'U/L', refLow: 7, refHigh: 56 },
    ],
    followUp: [
      { marker: 'hs-CRP', value: 2.1, unit: 'mg/L', refLow: 0, refHigh: 3.0 },
      { marker: 'Ferritin', value: 45, unit: 'µg/L', refLow: 30, refHigh: 400 },
      { marker: 'Magnesium', value: 0.82, unit: 'mmol/L', refLow: 0.75, refHigh: 0.95 },
      { marker: 'Vitamin D (25-OH)', value: 95, unit: 'nmol/L', refLow: 75, refHigh: 250 },
      { marker: 'AST', value: 22, unit: 'U/L', refLow: 10, refHigh: 40 },
      { marker: 'ALT', value: 25, unit: 'U/L', refLow: 7, refHigh: 56 },
    ],
  },
  {
    id: 'mens-optimization',
    title: 'Men’s optimization / low-energy',
    goal: 'energy, lean mass, better training output',
    persona: 'Generic adult male researching energy + lean-mass optimization.',
    narrative: 'Baseline shows low-normal testosterone (total + free), low vitamin D, and mildly elevated hs-CRP, '
      + 'alongside a rising waist / body-fat trend logged in Progress. The follow-up panel shows markers moving toward range. '
      + 'Out-of-range values are flagged for provider review — not a diagnosis, and not a TRT recommendation.',
    baseline: [
      { marker: 'Total Testosterone', value: 11, unit: 'nmol/L', refLow: 12, refHigh: 28 },
      { marker: 'Free Testosterone', value: 180, unit: 'pmol/L', refLow: 225, refHigh: 725 },
      { marker: 'SHBG', value: 58, unit: 'nmol/L', refLow: 18, refHigh: 54 },
      { marker: 'Vitamin D (25-OH)', value: 52, unit: 'nmol/L', refLow: 75, refHigh: 250 },
      { marker: 'hs-CRP', value: 3.4, unit: 'mg/L', refLow: 0, refHigh: 3.0 },
    ],
    followUp: [
      { marker: 'Total Testosterone', value: 16, unit: 'nmol/L', refLow: 12, refHigh: 28 },
      { marker: 'Free Testosterone', value: 290, unit: 'pmol/L', refLow: 225, refHigh: 725 },
      { marker: 'SHBG', value: 46, unit: 'nmol/L', refLow: 18, refHigh: 54 },
      { marker: 'Vitamin D (25-OH)', value: 95, unit: 'nmol/L', refLow: 75, refHigh: 250 },
      { marker: 'hs-CRP', value: 1.9, unit: 'mg/L', refLow: 0, refHigh: 3.0 },
    ],
  },
];

// Light listing for menus.
function labScenarios() {
  return SCENARIOS.map((s) => ({ id: s.id, title: s.title, goal: s.goal, persona: s.persona }));
}
function scenarioById(id) {
  return SCENARIOS.find((s) => s.id === String(id || '')) || null;
}

// Flag a value list with the SAME gate the lab tracker uses (never invents interpretation here).
function flagValues(values) {
  const coerced = (values || []).map((v) => ({
    marker: v.marker, value: num(v.value), unit: v.unit || null, refLow: num(v.refLow), refHigh: num(v.refHigh),
  }));
  return gates.labResultFlagGate({ values: coerced }).values;
}

// Baseline + follow-up flagged, plus per-marker deltas + direction (movement toward range = improvement).
// Direction is geometric (toward/away from the reference band), never a clinical/treatment claim.
function labScenarioReport(id) {
  const s = scenarioById(id);
  if (!s) return null;
  const baseline = flagValues(s.baseline);
  const followUp = flagValues(s.followUp);
  const pair = {};
  for (const v of baseline) pair[v.marker] = { baseline: v };
  for (const v of followUp) (pair[v.marker] = pair[v.marker] || {}).followUp = v;
  const out = (v) => !!v && String(v.flag || '').startsWith('OUT_OF_RANGE');
  const deltas = Object.keys(pair).map((marker) => {
    const b = pair[marker].baseline; const f = pair[marker].followUp;
    const change = (b && f && b.value != null && f.value != null) ? +(f.value - b.value).toFixed(2) : null;
    let direction = 'UNCHANGED';
    if (b && f) {
      if (out(b) && !out(f)) direction = 'INTO_RANGE';
      else if (!out(b) && out(f)) direction = 'OUT_OF_RANGE';
      else if (change != null && change !== 0) direction = 'CHANGED';
    }
    return {
      marker, unit: (b && b.unit) || (f && f.unit) || null,
      baseline: b ? b.value : null, followUp: f ? f.value : null, change, direction,
      baselineFlag: b ? b.flag : null, followUpFlag: f ? f.flag : null,
    };
  });
  return {
    id: s.id, title: s.title, goal: s.goal, persona: s.persona, narrative: s.narrative,
    baseline, followUp, deltas,
    flaggedMarkers: baseline.filter(out).map((v) => v.marker),
    reviewNote: 'Out-of-range values are flagged for review with your provider — not a diagnosis. '
      + 'Deltas describe movement toward the reference range, not a treatment claim.',
    disclaimer: 'Generic demonstration scenario — no real patient data. NOT medical advice, diagnosis, or treatment.',
  };
}

// The raw flagged baseline values — exactly the shape nutrition.analyzeLabForNutrients + the lab tracker consume.
function scenarioLabValues(id, which = 'baseline') {
  const s = scenarioById(id);
  if (!s) return [];
  return (which === 'followUp' ? s.followUp : s.baseline).map((v) => ({ ...v }));
}

module.exports = {
  _provenance: {
    source: 'generic demo lab scenarios (no real patient data)',
    framing: 'LabResult-shaped values feed the EXISTING flag gate + nutrition engine. Flagging/deltas are computed by the gate, never invented. Illustrative reference ranges. NOT medical advice.',
  },
  SCENARIOS,
  labScenarios,
  scenarioById,
  labScenarioReport,
  scenarioLabValues,
};
