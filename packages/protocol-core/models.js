/**
 * models.js — The 10 data models for the Vitalis Resource App.
 *
 * Each factory normalizes raw input into the canonical shape and stamps `_model`.
 * Where a value is not determinable, it is set to null / UNKNOWN — never guessed.
 * No model here clears anything for use; clinical/legal judgement is always external.
 */

const MODEL_NAMES = [
  'ClientProfile', 'LabPanel', 'LabResult', 'ProductCatalogItem', 'EvidenceCitation',
  'ComplianceCheck', 'ProtocolDraft', 'ProviderReferral', 'OutcomeMetric', 'ReviewCard',
];

// Platform / multi-tenant models — layered on top of the original 10.
const PLATFORM_MODEL_NAMES = [
  'Practitioner', 'ReviewNote',
  // Account & onboarding layer
  'ClientInvitation', 'IntakeSubmission', 'ClientDocument',
  // Subscription & entitlement layer
  'SubscriptionPlan', 'Entitlement',
  // Paid add-on layer
  'AddOnRequest', 'AddOnDraft',
  // Research expansion layer
  'ResearchSource', 'EvidenceReview', 'ResearchGap',
];

// The platform is practitioner-first and multi-tenant. Roles gate which surface a
// person sees; the CLIENT role can only ever see APPROVED protocol resources (the
// hard permission rule lives in gates.js — clientResourceProjection / approvalGate).
const ROLES = { ADMIN: 'ADMIN', PRACTITIONER: 'PRACTITIONER', CLIENT: 'CLIENT', PARTNER: 'PARTNER' };

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null));
const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

// 1. ClientProfile -----------------------------------------------------------
function ClientProfile(input = {}) {
  return {
    _model: 'ClientProfile',
    id: input.id || uid('client'),
    _demo: !!input._demo,
    practitionerId: input.practitionerId || null,   // owning practitioner (client BELONGS TO practitioner)
    name: input.name || 'Unnamed client',
    age: num(input.age),
    sex: input.sex || null,                 // 'male' | 'female' | other | null (never inferred)
    weightKg: num(input.weightKg),
    bodyFatPct: num(input.bodyFatPct),
    leanMassKg: num(input.leanMassKg),
    goals: arr(input.goals),
    contraindications: arr(input.contraindications),
    currentProducts: arr(input.currentProducts),
    notes: input.notes || '',
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

// 2. LabPanel ----------------------------------------------------------------
function LabPanel(input = {}) {
  return {
    _model: 'LabPanel',
    id: input.id || uid('panel'),
    label: input.label || 'Lab panel',
    status: input.status || 'UNKNOWN',      // SOURCED | NEEDS_SOURCE | UNKNOWN
    source: input.source || null,
    markers: arr(input.markers),
    sections: arr(input.sections),
    needs: input.needs || null,             // populated when NEEDS_SOURCE
    dynamic: !!input.dynamic,
  };
}

// 3. LabResult ---------------------------------------------------------------
function LabResult(input = {}) {
  return {
    _model: 'LabResult',
    id: input.id || uid('lab'),
    _demo: !!input._demo,
    clientId: input.clientId || null,
    panelId: input.panelId || null,
    drawnAt: input.drawnAt || new Date().toISOString(),
    fasting: input.fasting == null ? null : !!input.fasting,
    values: arr(input.values).map((v) => ({
      marker: v.marker || 'Unknown marker',
      value: num(v.value),
      unit: v.unit || null,
      refLow: num(v.refLow),
      refHigh: num(v.refHigh),
    })),
  };
}

// 4. ProductCatalogItem ------------------------------------------------------
// (Normalizes a row already produced by the seed; route/form may be null = UNKNOWN.)
function ProductCatalogItem(input = {}) {
  return {
    _model: 'ProductCatalogItem',
    id: input.id || uid('prod'),
    sku: input.sku || null,
    name: input.name || 'Unnamed product',
    displayName: input.displayName || input.name || null,
    category: input.category || null,
    form: input.form || null,               // null === UNKNOWN
    route: input.route || null,             // null === UNKNOWN (gate blocks)
    routeBasis: input.routeBasis || null,
    strengthMg: num(input.strengthMg),
    strengthLabel: input.strengthLabel || null,
    doseUnits: input.doseUnits || null,
    concentration: input.concentration || null,
    availability: input.availability || 'UNKNOWN',
    supplier: input.supplier || null,
    provider: input.provider || input.supplier || null,
    evidenceCompoundId: input.evidenceCompoundId || null,
  };
}

// 5. EvidenceCitation --------------------------------------------------------
function EvidenceCitation(input = {}) {
  return {
    _model: 'EvidenceCitation',
    title: input.title || null,
    source: input.source || null,
    url: input.url || null,
    type: input.type || 'None',             // PubMed | ClinicalTrial | Other | None
  };
}

// 6. ComplianceCheck ---------------------------------------------------------
function ComplianceCheck(input = {}) {
  return {
    _model: 'ComplianceCheck',
    subject: input.subject || null,         // product / compound name evaluated
    jurisdiction: input.jurisdiction || 'CA',
    status: input.status || 'UNKNOWN',      // ALLOWED_RESOURCE | NEEDS_REVIEW | BLOCKED | UNKNOWN
    reason: input.reason || null,
    disclaimer: input.disclaimer || null,
    evaluatedAt: input.evaluatedAt || new Date().toISOString(),
  };
}

// 7. ProtocolDraft -----------------------------------------------------------
function ProtocolDraft(input = {}) {
  return {
    _model: 'ProtocolDraft',
    id: input.id || uid('draft'),
    _demo: !!input._demo,
    clientId: input.clientId || null,
    status: input.status || 'DRAFT',        // DRAFT until reviewed; RESOURCE ONLY framing
    createdAt: input.createdAt || new Date().toISOString(),
    reviewedBy: input.reviewedBy || null,
    reviewedAt: input.reviewedAt || null,
    items: arr(input.items),
    rationale: input.rationale || '',
    monitoring: input.monitoring || '',
    labsSuggested: arr(input.labsSuggested),
    warnings: arr(input.warnings),
    citationsResolved: input.citationsResolved || null,
    unknowns: arr(input.unknowns),
    blocked: input.blocked == null ? false : !!input.blocked,
    blockedReasons: arr(input.blockedReasons),
    paymentStatus: input.paymentStatus || null,   // INCLUDED_CREDIT | PAID | MANUALLY_APPROVED | null
    goal: input.goal || null,
    requestedBy: input.requestedBy || null,        // 'CLIENT' when the client self-requested it
  };
}

// 8. ProviderReferral --------------------------------------------------------
function ProviderReferral(input = {}) {
  return {
    _model: 'ProviderReferral',
    trigger: input.trigger || null,
    label: input.label || null,
    whenObserved: input.whenObserved || null,
    suggests: input.suggests || null,
    provider: input.provider || null,       // named provider (e.g. Dr. Vincent Lun) or null
    disclaimer: input.disclaimer || 'Referral category suggestion — not a diagnosis.',
  };
}

// 9. OutcomeMetric -----------------------------------------------------------
function OutcomeMetric(input = {}) {
  return {
    _model: 'OutcomeMetric',
    id: input.id || uid('outcome'),
    _demo: !!input._demo,
    clientId: input.clientId || null,
    recordedAt: input.recordedAt || new Date().toISOString(),
    weightKg: num(input.weightKg),
    bodyFatPct: num(input.bodyFatPct),
    leanMassKg: num(input.leanMassKg),
    adherencePct: num(input.adherencePct),
    sideEffects: arr(input.sideEffects),
    notes: input.notes || '',
  };
}

// 10. ReviewCard / Scorecard -------------------------------------------------
function ReviewCard(input = {}) {
  return {
    _model: 'ReviewCard',
    id: input.id || uid('review'),
    clientId: input.clientId || null,
    draftId: input.draftId || null,
    outcomeFlag: input.outcomeFlag || 'PENDING',   // SUCCESS | NEEDS_ADJUSTMENT | FAILURE | PENDING
    deltas: input.deltas || {},                    // computed weight/bodyFat/leanMass deltas
    adherenceAvg: num(input.adherenceAvg),
    sideEffectsSeen: arr(input.sideEffectsSeen),
    learnings: input.learnings || '',
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

// 11. Practitioner / Provider (tenant owner) --------------------------------
// A practitioner hosts many clients under their profile. They review and approve
// protocol drafts before any client can see them.
function Practitioner(input = {}) {
  return {
    _model: 'Practitioner',
    id: input.id || uid('pract'),
    _demo: !!input._demo,
    role: 'PRACTITIONER',
    name: input.name || 'Unnamed practitioner',
    credentials: input.credentials || null,
    discipline: input.discipline || null,
    contact: input.contact || null,
    email: input.email || null,
    focus: arr(input.focus),
    note: input.note || '',
    practitionerType: input.practitionerType || 'PRACTITIONER', // PRACTITIONER | OWNER (Vitalis-owned, direct-client provider)
    accessStatus: input.accessStatus || 'ACTIVE',               // ACTIVE | SUSPENDED | INVITED | PENDING_REVIEW
    planLevel: input.planLevel || 'free',                       // subscription tier key
    portalAccessEnabled: input.portalAccessEnabled == null ? true : !!input.portalAccessEnabled,
    directClientOwner: !!input.directClientOwner,               // the OWNER practitioner holding direct-to-client profiles
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

// 12. ReviewNote — a practitioner's decision + comment on a protocol draft ----
function ReviewNote(input = {}) {
  return {
    _model: 'ReviewNote',
    id: input.id || uid('note'),
    draftId: input.draftId || null,
    clientId: input.clientId || null,
    author: input.author || null,                 // practitioner name (e.g. Dr. Vincent Lun)
    decision: input.decision || 'COMMENT',        // APPROVE | REQUEST_CHANGES | SIGN_OFF | COMMENT
    text: input.text || '',
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

// ===========================================================================
// PLATFORM LAYER — onboarding, entitlements, paid add-ons, research registry.
// Same factory conventions: _model tag, uid('prefix'), _demo flag, null/UNKNOWN
// for indeterminate values (never guessed). Ownership is DERIVED via clientId —
// the practitioner pointer is not denormalized onto child records.
// ===========================================================================

// 13. ClientInvitation — a practitioner invites a client to self-onboard -------
function ClientInvitation(input = {}) {
  return {
    _model: 'ClientInvitation',
    id: input.id || uid('invite'),
    _demo: !!input._demo,
    token: input.token || uid('tok'),               // opaque lookup key (GET /api/invitations/:token)
    practitionerId: input.practitionerId || null,   // who sent it (legitimate source — no client exists yet)
    clientId: input.clientId || null,               // linked once intake creates/links a client
    email: input.email || null,
    name: input.name || null,
    status: input.status || 'PENDING',              // PENDING | INTAKE_SUBMITTED | ACCEPTED | REVOKED | EXPIRED
    message: input.message || null,                 // optional note from the practitioner
    intakeSubmissionId: input.intakeSubmissionId || null,
    createdAt: input.createdAt || new Date().toISOString(),
    respondedAt: input.respondedAt || null,
  };
}

// 14. IntakeSubmission — a client's self-reported intake (DATA ONLY) -----------
function IntakeSubmission(input = {}) {
  return {
    _model: 'IntakeSubmission',
    id: input.id || uid('intake'),
    _demo: !!input._demo,
    invitationToken: input.invitationToken || null,
    clientId: input.clientId || null,
    submittedBy: input.submittedBy || 'CLIENT',     // CLIENT (self-intake) | PRACTITIONER (manual)
    status: input.status || 'SUBMITTED',            // SUBMITTED | LINKED   (NEVER an approval state)
    profile: input.profile || {},                   // raw self-reported fields — data only, never clinical clearance
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

// 15. ClientDocument — metadata for a document the client brought in -----------
function ClientDocument(input = {}) {
  return {
    _model: 'ClientDocument',
    id: input.id || uid('doc'),
    _demo: !!input._demo,
    clientId: input.clientId || null,               // owner derived via the client (practitioner not denormalized)
    kind: input.kind || 'OTHER',                    // LAB_REPORT | INTAKE | IMAGING | OTHER
    label: input.label || input.fileName || 'Document',
    fileName: input.fileName || null,
    mimeType: input.mimeType || null,
    sizeBytes: num(input.sizeBytes),
    textExcerpt: input.textExcerpt || null,         // local-first: optional pasted text, never a binary blob
    status: input.status || 'RECEIVED',             // RECEIVED | REVIEWED   (never an approval of care)
    uploadedBy: input.uploadedBy || 'CLIENT',       // CLIENT | PRACTITIONER
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

// 16. SubscriptionPlan — a display tier + its entitlement cap ------------------
function SubscriptionPlan(input = {}) {
  return {
    _model: 'SubscriptionPlan',
    id: input.id || uid('plan'),
    key: input.key || 'free',                       // free | plus | pro
    label: input.label || 'Free',
    monthlyFee: num(input.monthlyFee) || 0,         // DISPLAY ONLY — the app processes no payments
    includedProtocolCredits: input.includedProtocolCredits === null ? null : (num(input.includedProtocolCredits) == null ? 1 : num(input.includedProtocolCredits)), // null === unlimited
    perProtocolFee: num(input.perProtocolFee) || 0, // overage fee once monthly credits are used
    activeProtocolCap: input.activeProtocolCap === null ? null : (num(input.activeProtocolCap) == null ? 3 : num(input.activeProtocolCap)), // null === unlimited
    addOnFee: input.addOnFee || {},                 // { SUPPLEMENT_PLAN, MEAL_PLAN } display fees
    includedAddOns: arr(input.includedAddOns),
    priceLabel: input.priceLabel || null,
    note: input.note || null,
  };
}

// 17. Entitlement — what a client's plan currently allows (cap + usage) --------
function Entitlement(input = {}) {
  return {
    _model: 'Entitlement',
    id: input.id || uid('ent'),
    _demo: !!input._demo,
    clientId: input.clientId || null,
    planKey: input.planKey || 'free',
    activeProtocolCap: input.activeProtocolCap === null ? null : (num(input.activeProtocolCap) == null ? 3 : num(input.activeProtocolCap)), // null === unlimited
    includedProtocolCredits: input.includedProtocolCredits === null ? null : (num(input.includedProtocolCredits) == null ? 1 : num(input.includedProtocolCredits)), // null === unlimited monthly credits
    usedThisMonth: num(input.usedThisMonth) || 0,   // protocols generated this billing month
    perProtocolFee: num(input.perProtocolFee) || 0, // overage fee once monthly credits are used
    addOnsRemaining: num(input.addOnsRemaining),    // null === not metered (pay-per-request)
    status: input.status || 'ACTIVE',               // ACTIVE | PAST_DUE | CANCELED
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

// 18. AddOnRequest — a client's paid request for a supplement / meal plan -------
function AddOnRequest(input = {}) {
  return {
    _model: 'AddOnRequest',
    id: input.id || uid('addon'),
    _demo: !!input._demo,
    clientId: input.clientId || null,               // owner derived via the client (queue joins clientId → practitionerId)
    requestType: input.requestType || 'SUPPLEMENT_PLAN', // SUPPLEMENT_PLAN | MEAL_PLAN
    tier: input.tier || 'BASIC',
    requestedBy: input.requestedBy || 'CLIENT',     // CLIENT | PRACTITIONER
    intake: input.intake || {},                     // request-specific inputs
    paymentStatus: input.paymentStatus || 'UNPAID', // UNPAID | PAID | MANUALLY_APPROVED  (generation gate)
    feeLabel: input.feeLabel || null,               // DISPLAY ONLY
    status: input.status || 'REQUESTED',            // REQUESTED | GENERATED_DRAFT | PROVIDER_REVIEW | APPROVED_RESOURCE | CHANGES_REQUESTED
    draftId: input.draftId || null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || null,
  };
}

// 19. AddOnDraft — the composed, gated add-on (DRAFT until practitioner approval) --
function AddOnDraft(input = {}) {
  return {
    _model: 'AddOnDraft',
    id: input.id || uid('addondraft'),
    _demo: !!input._demo,
    requestId: input.requestId || null,
    clientId: input.clientId || null,
    addOnType: input.addOnType || 'SUPPLEMENT_PLAN',
    tier: input.tier || 'BASIC',
    title: input.title || 'Add-on resource (draft)',
    status: input.status || 'DRAFT',                // DRAFT | PROVIDER_REVIEW | APPROVED_RESOURCE | CHANGES_REQUESTED | BLOCKED
    isResourceOnly: true,                           // ALWAYS — never a prescription
    isPrescription: false,
    sections: arr(input.sections),                  // composed content blocks (honest PENDING/NEEDS_SOURCE where unwired)
    plan: input.plan || null,                       // structured engine output (operator-only; stripped from client projection)
    rationale: input.rationale || '',               // operator-only
    compatibilityNotes: input.compatibilityNotes || null, // peptide-protocol compatibility (operator context)
    reviewedBy: input.reviewedBy || null,
    reviewedAt: input.reviewedAt || null,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

// 20. ResearchSource — one entry in the research source registry ---------------
function ResearchSource(input = {}) {
  return {
    _model: 'ResearchSource',
    id: input.id || uid('src'),
    label: input.label || 'Unnamed source',
    kind: input.kind || 'REGISTRY',                 // TRIAL_REGISTRY | LITERATURE | SUPPLEMENT | FOOD | REGULATOR | REGISTRY
    jurisdiction: input.jurisdiction || 'GLOBAL',   // CA | US | EU | CN | JP | RU | GLOBAL
    status: input.status || 'PLANNED',              // LIVE | STUB | PLANNED  (honest — never LIVE unless wired)
    base: input.base || null,
    note: input.note || null,
  };
}

// 21. EvidenceReview — an honest evidence-lookup record (never fabricated rows) --
function EvidenceReview(input = {}) {
  return {
    _model: 'EvidenceReview',
    id: input.id || uid('evrev'),
    sourceId: input.sourceId || null,
    term: input.term || null,
    status: input.status || 'PENDING',              // PENDING | INGESTED | UNKNOWN
    citations: arr(input.citations),                // real rows only — never invented
    reviewedBy: input.reviewedBy || null,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

// 22. ResearchGap — an honest, trackable evidence gap (the research backlog) -----
function ResearchGap(input = {}) {
  return {
    _model: 'ResearchGap',
    id: input.id || uid('gap'),
    kind: input.kind || 'COMPOUND',                 // COMPOUND | NUTRIENT | CONNECTOR | FOOD | CITATION
    label: input.label || 'Unnamed gap',
    evidenceLevel: input.evidenceLevel || 'UNKNOWN',
    citationCount: input.citationCount == null ? null : num(input.citationCount),
    priority: input.priority || 'medium',           // high | medium | low
    status: input.status || 'UNKNOWN',              // UNKNOWN | SEARCH_NEEDED | SOURCE_FOUND | REVIEWED | LOCKED
    sourceTarget: arr(input.sourceTarget),          // registries to search (PubMed, ClinicalTrials.gov, …)
    nextAction: input.nextAction || null,
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

module.exports = {
  MODEL_NAMES, PLATFORM_MODEL_NAMES, ROLES, uid,
  ClientProfile, LabPanel, LabResult, ProductCatalogItem, EvidenceCitation,
  ComplianceCheck, ProtocolDraft, ProviderReferral, OutcomeMetric, ReviewCard,
  Practitioner, ReviewNote,
  // Platform layer
  ClientInvitation, IntakeSubmission, ClientDocument,
  SubscriptionPlan, Entitlement,
  AddOnRequest, AddOnDraft,
  ResearchSource, EvidenceReview, ResearchGap,
};
