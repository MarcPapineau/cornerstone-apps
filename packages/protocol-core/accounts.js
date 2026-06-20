'use strict';
/**
 * accounts.js — the client-account / onboarding platform layer.
 *
 * Invitations, self-intake, document metadata, subscription tiers, and the entitlement cap
 * on active generated protocols. Pure + surface-agnostic like every gate; the server is
 * authoritative. Three hard rules live here:
 *   1. SELF-INTAKE NEVER APPROVES: an invited client can submit profile DATA, but a CLIENT
 *      actor can never approve a clinical resource (selfIntakeApprovalGate). Onboarding ≠ care.
 *   2. ENTITLEMENT IS A CAP, NOT A CLAIM: entitlementGate limits how many ACTIVE generated
 *      protocols a plan allows; it is an educational-resource limit, never a clinical one,
 *      and is never coerced (cap null === unlimited).
 *   3. OWNERSHIP IS DERIVED: child records (documents, intake) reference clientId; the
 *      practitioner pointer is not denormalized onto them (it is derived via the client).
 * Resource/educational only — never medical advice, never a prescription.
 */
const M = require('./models');

const pick = (a, b) => (a != null && a !== '' ? a : b);

// --- Subscription tiers ------------------------------------------------------
// activeProtocolCap null === unlimited. priceLabel is DISPLAY ONLY — the app processes
// no payments (billing is out of scope; entitlement is the operational lever).
// Each tier: a monthly fee, included protocol credits per month (null === unlimited), a
// per-protocol overage fee once credits run out, an active-protocol cap, and add-on fees.
// All amounts are DISPLAY-ONLY (no payment processor); paymentStatus is the operational lever.
const SUBSCRIPTION_TIERS = [
  { key: 'free', label: 'Free', monthlyFee: 0, includedProtocolCredits: 1, perProtocolFee: 25, activeProtocolCap: 3, addOnFee: { SUPPLEMENT_PLAN: 30, MEAL_PLAN: 40 }, includedAddOns: [], priceLabel: 'Free', note: '1 protocol/mo included · up to 3 active · $25/protocol overage.' },
  { key: 'plus', label: 'Plus', monthlyFee: 49, includedProtocolCredits: 5, perProtocolFee: 20, activeProtocolCap: 10, addOnFee: { SUPPLEMENT_PLAN: 25, MEAL_PLAN: 35 }, includedAddOns: [], priceLabel: '$49/mo', note: '5 protocols/mo included · up to 10 active · $20/protocol overage.' },
  { key: 'pro', label: 'Pro', monthlyFee: 149, includedProtocolCredits: null, perProtocolFee: 0, activeProtocolCap: null, addOnFee: { SUPPLEMENT_PLAN: 0, MEAL_PLAN: 0 }, includedAddOns: ['SUPPLEMENT_PLAN', 'MEAL_PLAN'], priceLabel: '$149/mo', note: 'Unlimited protocols + supplement & meal add-ons included.' },
];

function planForKey(key) {
  const t = SUBSCRIPTION_TIERS.find((p) => p.key === String(key || '').toLowerCase());
  return M.SubscriptionPlan(t || SUBSCRIPTION_TIERS[0]);
}

function defaultEntitlement(clientId, planKey) {
  const plan = SUBSCRIPTION_TIERS.find((p) => p.key === String(planKey || 'free').toLowerCase()) || SUBSCRIPTION_TIERS[0];
  return M.Entitlement({
    clientId, planKey: plan.key,
    activeProtocolCap: plan.activeProtocolCap,
    includedProtocolCredits: plan.includedProtocolCredits,
    perProtocolFee: plan.perProtocolFee,
    usedThisMonth: 0,
  });
}

// Entitlement cap gate — may the client generate ANOTHER active protocol? Honest +
// server-authoritative. cap null === unlimited; the limit is an educational-resource cap,
// never a clinical restriction; never coerced.
function entitlementGate(input = {}) {
  const ent = input.entitlement || {};
  // Active-protocol cap (max concurrent CURRENT protocols). Missing → free default (3); null → unlimited.
  const cap = 'activeProtocolCap' in ent ? ent.activeProtocolCap : 3;
  const used = Number.isFinite(input.activeProtocolCount) ? input.activeProtocolCount : 0;
  const capBlocked = cap != null && used >= cap;

  // Monthly included-credit accounting — a SEPARATE axis from the cap. Within credits the next
  // protocol is INCLUDED_CREDIT (no fee); past credits it carries the per-protocol overage fee.
  const includedCredits = 'includedProtocolCredits' in ent ? ent.includedProtocolCredits : null;
  const usedThisMonth = Number.isFinite(input.usedThisMonth) ? input.usedThisMonth
    : (Number.isFinite(ent.usedThisMonth) ? ent.usedThisMonth : 0);
  const withinCredit = includedCredits == null || usedThisMonth < includedCredits;
  const perProtocolFee = Number.isFinite(ent.perProtocolFee) ? ent.perProtocolFee : 0;

  return {
    ok: !capBlocked,
    blocked: capBlocked,
    cap,
    used,
    remaining: cap == null ? null : Math.max(0, cap - used),
    includedCredits,
    usedThisMonth,
    creditsRemaining: includedCredits == null ? null : Math.max(0, includedCredits - usedThisMonth),
    nextProtocolPayment: withinCredit ? 'INCLUDED_CREDIT' : 'OVERAGE_FEE',
    nextProtocolFee: withinCredit ? 0 : perProtocolFee,
    reason: capBlocked
      ? `Active-protocol limit reached (${used}/${cap}). Upgrade the plan or retire a protocol to generate another — an educational-resource limit, not a clinical restriction.`
      : null,
  };
}

// What a NEW protocol would cost on this plan, given how many were generated this month.
// Within included credits → INCLUDED_CREDIT (no fee); past them → UNPAID + the per-protocol fee.
function protocolPaymentFor(plan, usedThisMonth = 0) {
  const inc = plan && 'includedProtocolCredits' in plan ? plan.includedProtocolCredits : 0;
  const within = inc == null || usedThisMonth < inc;
  return { status: within ? 'INCLUDED_CREDIT' : 'UNPAID', fee: within ? 0 : ((plan && plan.perProtocolFee) || 0), withinCredit: within };
}

// The add-on fee for this plan + add-on type (0 when included in the tier; null if unknown).
function addOnFeeFor(plan, addOnType) {
  const map = (plan && plan.addOnFee) || {};
  return Object.prototype.hasOwnProperty.call(map, addOnType) ? map[addOnType] : null;
}

// --- Invitations + self-intake ----------------------------------------------
function createInvitation(input = {}) {
  return M.ClientInvitation({
    practitionerId: input.practitionerId || null,
    email: input.email || null,
    name: input.name || null,
    message: input.message || null,
    _demo: !!input._demo,
  });
}

// HARD RULE: a self-intake / CLIENT actor can NEVER approve a clinical resource — only a
// PRACTITIONER or ADMIN may. This is the lock the acceptance test drives; the server calls
// it before any approval path, and the add-on / protocol review gates inherit the same idea.
function selfIntakeApprovalGate(actorRole) {
  const role = String(actorRole || '').toUpperCase();
  const allowed = role === 'PRACTITIONER' || role === 'ADMIN';
  return {
    ok: allowed,
    blocked: !allowed,
    reason: allowed ? null : 'Self-intake / client actors cannot approve clinical resources — practitioner review is required.',
  };
}

// Apply a self-intake submission to a client profile. DATA ONLY: it creates / updates the
// ClientProfile and records the submission. It NEVER creates an approved resource, never
// touches a draft's status, never grants visibility. Returns { client, submission }.
function applyIntake(input = {}) {
  const invitation = input.invitation || null;
  const intake = input.intake || {};
  const existing = input.existingClient || null;
  const practitionerId = (invitation && invitation.practitionerId) || (existing && existing.practitionerId) || null;

  const client = M.ClientProfile({
    id: (existing && existing.id) || (invitation && invitation.clientId) || undefined,
    practitionerId,
    name: pick(intake.name, pick(existing && existing.name, (invitation && invitation.name) || 'Invited client')),
    age: pick(intake.age, existing && existing.age),
    sex: pick(intake.sex, existing && existing.sex),
    weightKg: pick(intake.weightKg, existing && existing.weightKg),
    bodyFatPct: pick(intake.bodyFatPct, existing && existing.bodyFatPct),
    leanMassKg: pick(intake.leanMassKg, existing && existing.leanMassKg),
    goals: (intake.goals && intake.goals.length ? intake.goals : (existing && existing.goals)) || [],
    contraindications: (intake.allergies && intake.allergies.length ? intake.allergies : (intake.contraindications || (existing && existing.contraindications))) || [],
    currentProducts: (intake.currentProducts && intake.currentProducts.length ? intake.currentProducts : (existing && existing.currentProducts)) || [],
    notes: pick(intake.notes, (existing && existing.notes) || ''),
    _demo: !!(invitation && invitation._demo),
  });

  const submission = M.IntakeSubmission({
    invitationToken: invitation && invitation.token,
    clientId: client.id,
    submittedBy: 'CLIENT',
    status: 'LINKED',
    profile: intake,
    _demo: !!(invitation && invitation._demo),
  });

  return { client, submission };
}

// Record a client document's METADATA (local-first: never a binary blob, never a third-party
// upload — the client's text/notes stay on the org's own server). Documents carry data, never
// an approval of care.
function recordDocument(input = {}) {
  return M.ClientDocument({
    clientId: input.clientId || null,
    kind: input.kind || 'OTHER',
    label: input.label || input.fileName || null,
    fileName: input.fileName || null,
    mimeType: input.mimeType || null,
    sizeBytes: input.sizeBytes,
    textExcerpt: input.textExcerpt || null,
    uploadedBy: input.uploadedBy || 'CLIENT',
    _demo: !!input._demo,
  });
}

module.exports = {
  SUBSCRIPTION_TIERS,
  planForKey,
  defaultEntitlement,
  entitlementGate,
  protocolPaymentFor,
  addOnFeeFor,
  createInvitation,
  selfIntakeApprovalGate,
  applyIntake,
  recordDocument,
};
