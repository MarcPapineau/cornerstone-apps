'use strict';
/**
 * addons.js — the paid add-on workflow: Supplement Plan + Meal / Diet Plan.
 *
 * The lifecycle mirrors the protocol gate chain exactly, so the same safety guarantees hold:
 *   REQUESTED → (PAID|MANUALLY_APPROVED) → GENERATED_DRAFT → PROVIDER_REVIEW → APPROVED_RESOURCE
 * Three hard rules:
 *   1. CANNOT GENERATE UNLESS PAID/MANUALLY_APPROVED (addonGenerationGate) — never coerced.
 *   2. A DRAFT IS NEVER CLIENT-VISIBLE until status === APPROVED_RESOURCE (addonClientProjection,
 *      same CLIENT_VISIBLE_STATUS boundary as protocols; whitelist projection, never spreads).
 *   3. REAL ENGINES, HONEST GAPS: composeAddOnDraft now delegates to the meal generator
 *      (meals.js) and the supplement generator (supplements.js). Neither fabricates — meal
 *      macros are CURATED_ESTIMATE / SOURCE_PENDING, an unknown calorie target is ESTIMATED or
 *      UNKNOWN, and a supplement plan with no labs is PENDING_LABS. Language self-checked.
 * Resource/educational only — never medical advice, never a prescription.
 */
const gates = require('./gates');
const M = require('./models');

const ADDON_TYPES = ['SUPPLEMENT_PLAN', 'MEAL_PLAN'];

// Display tiers — depth rises with tier; the client chooses how elaborate. feeLabel is
// DISPLAY ONLY (no payment processing in-app; paymentStatus is set out-of-band).
const ADDON_TIERS = {
  SUPPLEMENT_PLAN: [
    { key: 'BASIC', label: 'Basic supplement plan', feeLabel: 'Add-on' },
    { key: 'COMPREHENSIVE', label: 'Comprehensive supplement plan', feeLabel: 'Add-on +' },
  ],
  MEAL_PLAN: [
    { key: 'BASIC', label: 'Basic weekly meal plan', feeLabel: 'Add-on' },
    { key: 'DETAILED', label: 'Detailed weekly plan with recipes', feeLabel: 'Add-on +' },
    { key: 'MONTHLY_PREP', label: 'Monthly meal-prep plan', feeLabel: 'Add-on ++' },
    { key: 'PERFORMANCE', label: 'High-performance coaching plan', feeLabel: 'Add-on premium' },
  ],
};

// The ONLY payment states that unlock generation. A truthy string never coerces a pass.
const PAYMENT_OK = ['PAID', 'MANUALLY_APPROVED'];

function tiersFor(type) {
  return ADDON_TIERS[String(type || '').toUpperCase()] || [];
}

// Validate a request before it is created.
function addonRequestGate(input = {}) {
  const reasons = [];
  const type = String(input.requestType || '').toUpperCase();
  if (!ADDON_TYPES.includes(type)) reasons.push(`Unknown add-on type "${input.requestType}".`);
  const tier = String(input.tier || '').toUpperCase();
  if (type && ADDON_TIERS[type] && tier && !ADDON_TIERS[type].some((t) => t.key === tier)) {
    reasons.push(`Unknown tier "${input.tier}" for ${type}.`);
  }
  if (!input.clientId) reasons.push('A clientId is required to request an add-on.');
  return { ok: reasons.length === 0, blocked: reasons.length > 0, reasons };
}

function createAddOnRequest(input = {}) {
  const type = ADDON_TYPES.includes(String(input.requestType || '').toUpperCase())
    ? String(input.requestType).toUpperCase()
    : 'SUPPLEMENT_PLAN';
  const tierList = ADDON_TIERS[type] || [];
  const tierKey = String(input.tier || (tierList[0] && tierList[0].key) || 'BASIC').toUpperCase();
  const tierDef = tierList.find((t) => t.key === tierKey) || tierList[0] || null;
  return M.AddOnRequest({
    clientId: input.clientId || null,
    requestType: type,
    tier: tierKey,
    requestedBy: input.requestedBy || 'CLIENT',
    intake: input.intake || {},
    paymentStatus: input.paymentStatus || 'UNPAID',
    feeLabel: (tierDef && tierDef.feeLabel) || null,
    status: 'REQUESTED',
    _demo: !!input._demo,
  });
}

// THE paid gate: a requested add-on cannot generate a draft unless it is PAID or a
// practitioner MANUALLY_APPROVED it. Strict membership — never coerced.
function addonGenerationGate(request = {}) {
  const pay = request && request.paymentStatus;
  const ok = PAYMENT_OK.includes(pay);
  return {
    ok,
    blocked: !ok,
    reason: ok ? null : `Add-on request is "${pay || 'UNPAID'}" — generation requires PAID or MANUALLY_APPROVED.`,
  };
}

// --- Section builders (client-safe rendered summary the projection exposes) --
function mealSections(plan) {
  const mt = plan.macroTarget;
  const fmt = (v, u) => (v == null ? 'UNKNOWN' : `${v}${u}`);
  const out = [];
  out.push({
    key: 'macro_target',
    title: 'Daily macro target',
    status: mt.status, // PROVIDED | ESTIMATED | UNKNOWN
    items: [
      { field: 'Calories', value: mt.kcal == null ? 'UNKNOWN' : `${mt.kcal} kcal${mt.status === 'ESTIMATED' ? ' (estimated)' : ''}` },
      { field: 'Protein', value: fmt(mt.proteinG, ' g') },
      { field: 'Carbs', value: fmt(mt.carbG, ' g') },
      { field: 'Fat', value: fmt(mt.fatG, ' g') },
    ],
    note: mt.basis,
  });
  out.push({
    key: 'weekly_plan',
    title: plan.periodicity === 'monthly' ? 'Weekly template (monthly rotation)' : 'Weekly plan',
    status: 'RECORDED',
    items: plan.days.map((d) => ({ field: `Day ${d.day}`, value: d.meals.map((m) => m.name || `(${m.slot}: practitioner to add)`).join(' · ') })),
    note: plan.sourceNotes[0] || null,
  });
  if (plan.groceryList.length) {
    out.push({ key: 'grocery', title: 'Grocery list', status: 'RECORDED', items: plan.groceryList.map((g) => ({ field: g.item, value: `used in ${g.mealsUsing} meal(s)` })), note: null });
  }
  if (plan.substitutions.length) {
    out.push({ key: 'substitutions', title: 'Substitutions', status: 'RECORDED', items: plan.substitutions.map((s) => ({ field: `${s.excluded} (${s.reason})`, value: s.alternatives.join(', ') })), note: 'Allergies and disliked foods are excluded from every meal above.' });
  }
  out.push({ key: 'prep', title: 'Prep notes', status: 'RECORDED', items: [], note: (plan.prepNotes || []).join('  ') });
  return out;
}

function supplementSections(plan) {
  if (plan.status === 'PENDING_LABS') {
    return [{ key: 'pending', title: 'Supplement focus', status: 'PENDING_LABS', items: [], note: plan.reason }];
  }
  const out = [];
  out.push({
    key: 'nutrient_targets',
    title: 'Nutrient focus (from your labs)',
    status: 'SOURCED',
    items: plan.nutrientTargets.map((t) => ({ nutrient: t.nutrient, value: t.suggestedForm, tier: t.evidenceTier })),
    note: 'A request to review with your naturopath — not a prescription. The dose is your naturopath’s call.',
  });
  if (plan.foodFirstOptions.length) {
    out.push({ key: 'food_first', title: 'Food-first options', status: 'SOURCED', items: plan.foodFirstOptions.map((f) => ({ nutrient: f.nutrient, value: (f.options || []).join(', ') })), note: 'Diet-first sources to discuss before any supplement.' });
  }
  out.push({
    key: 'discussion',
    title: 'Discussion items for your naturopath',
    status: 'SOURCED',
    items: plan.discussionItems.map((d) => ({ nutrient: d.nutrient, ask: d.ask })),
    note: null,
  });
  if (plan.providerReviewFlags.length) {
    out.push({ key: 'provider_review', title: 'For provider review (no OTC suggestion)', status: 'REVIEW', items: plan.providerReviewFlags.map((p) => ({ marker: p.marker, value: p.reason })), note: 'Electrolytes and out-of-range values we do not suggest supplementing — your provider reviews these.' });
  }
  out.push({
    key: 'protocol_monitoring',
    title: 'Protocol monitoring',
    status: (plan.peptideNotes.monitoringMarkers || []).length ? 'SOURCED' : 'NONE',
    items: (plan.peptideNotes.monitoringMarkers || []).map((m) => ({ field: 'Monitor', value: m })),
    note: plan.peptideNotes.note,
  });
  return out;
}

// Compose an add-on DRAFT from the REAL engines. Keeps the gate chain (DRAFT, resource-only,
// language self-check); carries a structured `plan` (operator) + client-safe `sections`.
function composeAddOnDraft(input = {}) {
  const request = input.request;
  if (!request) throw new Error('composeAddOnDraft requires a request.');
  const client = input.client || null;
  const nutritionSlip = input.nutritionSlip || null;
  const protocolProducts = Array.isArray(input.protocolProducts) ? input.protocolProducts : [];
  const role = input.role || 'PRACTITIONER';
  const type = ADDON_TYPES.includes(request.requestType) ? request.requestType : 'SUPPLEMENT_PLAN';
  const intake = request.intake || {};

  let sections = [];
  let compatibilityNotes = null;
  let plan = null;
  let title;

  if (type === 'MEAL_PLAN') {
    const meals = require('./meals');
    plan = meals.generateMealPlan({
      ...intake,
      periodicity: request.tier === 'MONTHLY_PREP' ? 'monthly' : 'weekly',
    });
    title = `Meal plan (draft) — ${plan.periodicity}`;
    sections = mealSections(plan);
    if (protocolProducts.length) {
      compatibilityNotes = `Plan accounts for your current protocol (${protocolProducts.length} item(s)); coordinate meal timing around training and dosing with your practitioner.`;
    }
  } else {
    const supplements = require('./supplements');
    plan = supplements.generateSupplementPlan({
      slip: nutritionSlip,
      labValues: intake.labValues || [],
      goals: intake.goals || [],
      products: protocolProducts,
      contraindications: (client && client.contraindications) || intake.contraindications || [],
      preferences: intake.preferences || [],
      role,
      clientName: (client && client.name) || null,
    });
    title = 'Supplement plan (draft)';
    sections = supplementSections(plan);
    if (plan.peptideNotes && plan.peptideNotes.onProtocol) compatibilityNotes = plan.peptideNotes.note;
  }

  const draft = M.AddOnDraft({
    requestId: request.id,
    clientId: request.clientId,
    addOnType: type,
    tier: request.tier,
    title,
    status: 'DRAFT',
    sections,
    plan,
    rationale: `Composed for ${type} request ${request.id}. Resource-only; practitioner review is required before the client can see it.`,
    compatibilityNotes,
    _demo: !!request._demo,
  });

  // Language self-check (Gate 9) over ONLY the free text this composer/engine authored.
  const authored = [title, draft.rationale, compatibilityNotes]
    .concat(sections.map((s) => `${s.title}  ${s.note || ''}`))
    .concat(plan && plan.languageOk === false ? ['__ENGINE_LANGUAGE_FLAG__'] : [])
    .filter(Boolean)
    .join('  \n  ');
  const lang = gates.languageGate(authored);
  draft.languageOk = lang.ok && (plan ? plan.languageOk !== false : true);
  if (!draft.languageOk) draft.languageViolations = (lang.violations || []).concat(plan && plan.languageViolations ? plan.languageViolations : []);

  return draft;
}

// Client visibility — the SAME hard boundary as protocols: an add-on draft reaches the
// client ONLY when status === APPROVED_RESOURCE. Whitelist projection (never spreads the
// draft): operator-only rationale / compatibilityNotes / the raw `plan` are physically dropped.
function addonClientProjection(draft) {
  if (!draft || draft.status !== gates.CLIENT_VISIBLE_STATUS) return null;
  return {
    _model: 'ApprovedAddOn',
    id: draft.id,
    clientId: draft.clientId,
    addOnType: draft.addOnType,
    tier: draft.tier,
    title: draft.title,
    status: 'APPROVED_RESOURCE',
    isResourceOnly: true,
    isPrescription: false,
    banner: 'APPROVED RESOURCE — reviewed by your practitioner · educational, not a prescription',
    approvedBy: draft.reviewedBy || null,
    approvedAt: draft.reviewedAt || null,
    sections: (draft.sections || []).map((s) => ({
      key: s.key,
      title: s.title,
      status: s.status,
      items: s.items || [],
      note: s.note || null,
    })),
    disclaimer: 'Educational / research resource only — reviewed with your practitioner. Not a prescription, not a diagnosis.',
  };
}

// All approved add-ons for one client (ownership + approval filter → drops every un-approved draft).
function clientVisibleAddOns(drafts, clientId) {
  return (drafts || []).filter((d) => d.clientId === clientId).map(addonClientProjection).filter(Boolean);
}

module.exports = {
  ADDON_TYPES,
  ADDON_TIERS,
  PAYMENT_OK,
  tiersFor,
  addonRequestGate,
  createAddOnRequest,
  addonGenerationGate,
  composeAddOnDraft,
  mealSections,
  supplementSections,
  addonClientProjection,
  clientVisibleAddOns,
};
