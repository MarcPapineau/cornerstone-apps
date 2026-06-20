'use strict';
/**
 * supplements.js — the supplement-plan generator (bloodwork + goals + peptide protocol).
 *
 * REUSE > REBUILD: this does NOT re-derive nutrient logic. It runs the existing nutrition
 * engine (nutrition.analyzeLabForNutrients over confirmed lab values) and the existing
 * peptide ⇄ monitoring source (packages.safetyMonitoringPanel), then SHAPES the result into
 * a SupplementPlan DRAFT. Guarantees inherited from the nutrition engine, unchanged:
 *   • Electrolytes / provider-only nutrients (supplementSafe:false) are NEVER supplement
 *     suggestions — they land in providerReviewFlags only.
 *   • Role softening: a CLIENT view already drops citation lists + the naturopathic "how".
 *   • No medical-claim language (the engine self-checks; we self-check our own copy too).
 *   • No confirmed labs → honest PENDING_LABS (no suggestions invented).
 * The nutrient set is the evidence-reviewed nutrient-evidence corpus; this module does not
 * add nutrients — expansion happens only by adding evidence-reviewed entries there.
 * NOT medical advice, NOT a diagnosis, NOT a prescription.
 */
const gates = require('./gates');
const nutrition = require('./nutrition');

const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

/**
 * generateSupplementPlan(input) → a structured SupplementPlan DRAFT (resource only).
 * input: labValues[{marker,value,unit,refLow,refHigh}], goals[], products[] (current
 *        peptide protocol), contraindications[], preferences[], role, clientName.
 */
function generateSupplementPlan(input = {}) {
  const labValues = arr(input.labValues);
  const goals = arr(input.goals);
  const products = arr(input.products);
  const contraindications = arr(input.contraindications);
  const preferences = arr(input.preferences);
  const isClient = String(input.role || '').toUpperCase() === 'CLIENT';

  // Run the existing engine (or reuse a slip the caller already computed) — it does the
  // deficiency → nutrient mapping, role softening, electrolyte separation, and its own
  // language self-check. REUSE > REBUILD.
  const slip = input.slip || nutrition.analyzeLabForNutrients({
    values: labValues,
    role: input.role,
    products,
    clientName: input.clientName || null,
  });

  // Nutrient targets — only the safe, actionable recommendations (electrolytes are NOT here;
  // the engine routes them to providerReview). Target dose stays null (the naturopath's call).
  const nutrientTargets = slip.recommendations.map((r) => ({
    nutrient: r.nutrient,
    suggestedForm: r.suggestedForm,        // names a FORM, never a dose
    target: r.target,                       // NutrientTarget with target:null (never guessed)
    evidenceTier: r.basis.tier,             // ESTABLISHED | SUPPORTIVE | EMERGING
    evidenceLabel: r.basis.label,
    // Operator-only: the full study basis (citations) is present for non-clients; the engine
    // already stripped citations from the CLIENT slip, so this is undefined for a client.
    studies: isClient ? undefined : (r.basis.studies || null),
  }));

  const foodFirstOptions = slip.recommendations.map((r) => ({ nutrient: r.nutrient, options: r.foodFirst || [] }));

  const discussionItems = slip.recommendations.map((r) => ({
    nutrient: r.nutrient,
    form: r.suggestedForm,
    ask: r.ask,                             // the exact thing to raise with the naturopath
  }));

  // Provider-review flags — electrolytes + unmapped + wrong-direction values. NEVER suggestions.
  const providerReviewFlags = slip.providerReview.map((p) => ({
    marker: p.marker,
    nutrient: p.nutrient || null,
    flag: p.flag,
    reason: p.reason,
    supplementSuggested: false,
    action: p.action || null,
  }));

  // Peptide interaction / monitoring notes — sourced from PEPTIDE_ADDITIONS (never invented).
  const panel = require('./packages').safetyMonitoringPanel(products);
  const peptideNotes = {
    onProtocol: products.length > 0,
    monitoringMarkers: panel.markers,       // [] when no monitored compound
    detail: panel.detail,
    note: products.length
      ? 'Coordinate supplement timing with your current protocol and review the monitoring markers above with your practitioner.'
      : 'No current protocol provided — no peptide interaction notes to add.',
  };

  const hasLabs = labValues.length > 0 || !!(slip && slip.summary && slip.summary.reviewed > 0);
  const status = hasLabs ? 'DRAFT' : 'PENDING_LABS';

  const plan = {
    _model: 'SupplementPlanDraft',
    status,
    isResourceOnly: true,
    isPrescription: false,
    goals,
    contraindications,
    preferences,
    nutrientTargets,
    foodFirstOptions,
    discussionItems,
    providerReviewFlags,
    peptideNotes,
    evidence: {
      // Where the nutrient evidence is sourced (registry-backed; NIH ODS / Health Canada).
      source: 'protocol-core/nutrient-evidence (NIH ODS / Health Canada references)',
      tierLegend: ['ESTABLISHED', 'SUPPORTIVE', 'EMERGING'],
    },
    summary: hasLabs ? slip.summary : null,
    reason: hasLabs
      ? null
      : 'A supplement plan is built from confirmed lab values. Until bloodwork is recorded there is nothing to suggest honestly (PENDING_LABS).',
    referral: slip.referral,                // names Dr. Vincent Lun
    slipLanguageOk: slip.languageOk,
  };

  // Self-check (Gate 9) over the free text THIS module authored (plus the engine's own ok flag).
  const authored = [plan.reason, peptideNotes.note, plan.evidence.source]
    .concat(discussionItems.map((d) => d.ask))
    .filter(Boolean).join('  \n  ');
  const lang = gates.languageGate(authored);
  plan.languageOk = lang.ok && slip.languageOk;
  if (!lang.ok) plan.languageViolations = lang.violations;

  return plan;
}

module.exports = { generateSupplementPlan };
