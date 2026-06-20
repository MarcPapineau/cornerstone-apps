'use strict';
/**
 * packages.js — the One-Click Client Package composer.
 *
 * "AI proposes, gates dispose" already produced a vetted protocol DRAFT. A Client Package is
 * that SAME gated draft, presented as a 3-facet bundle a practitioner generates once, approves
 * through the existing review gate, and the client opens in the portal — so a goal becomes a
 * protocol + the bloodwork to order + the nutrition follow-up, attached to the client's record
 * and swappable through the existing current/past lifecycle.
 *
 *   1. PROTOCOL    — pass-through of the gated draft (items, role-shaped dosing, monitoring).
 *   2. BLOODWORK   — the requisition to ORDER: Dr. Lun's baseline + product-driven safety
 *                    monitoring (sourced from PEPTIDE_ADDITIONS) + whatever the protocol already
 *                    flagged in labsSuggested, framed as a request to bring to Dr. Vincent Lun.
 *   3. NUTRITION   — the deficiency → naturopath slip. Lab-DRIVEN: until results are recorded it
 *                    is honestly PENDING_LABS — never fabricated guidance (honest UNKNOWN first).
 *
 * This module COMPOSES already-gated artifacts. It mints nothing clinical, invents no markers
 * (the peptide→marker map is the single source in data/lab-panels PEPTIDE_ADDITIONS), and runs
 * a medical-language self-check so a package can never carry claim language. Surface-agnostic +
 * server-authoritative like every other gate. NOT medical advice — research / resource only.
 */
const gates = require('./gates');
const panelsCfg = require('./data/lab-panels');
const providersCfg = require('./data/providers');

const DR_LUN = (providersCfg.PROVIDERS || []).find((p) => p.id === 'dr_vincent_lun') || { name: 'Dr. Vincent Lun' };

// The aggregator framing, in the locked voice: we curate the research, the naturopath decides.
const REQUISITION_NOTE =
  `Bring this request to ${DR_LUN.name}. We aggregate the research so you arrive with a vetted ` +
  `starting point — he reviews everything, and adds anything he sees missing, before any labs are ` +
  `drawn or any product is used. The decisions are his and yours.`;

const NOT_A_PRESCRIPTION =
  'Educational / research resource only — a draft to review with your practitioner. Not a prescription, not a diagnosis.';

// --- Product-driven safety-monitoring panel ---------------------------------
// The SINGLE source of the peptide→marker map is panelsCfg.PEPTIDE_ADDITIONS (the same table the
// /api/lab-panels route reads). No markers are invented; an unmatched product contributes nothing.
function safetyMonitoringPanel(productNames = []) {
  const blob = (productNames || []).map(gates.normName).join(' ');
  const matched = [];
  for (const add of panelsCfg.PEPTIDE_ADDITIONS) {
    if (add.match.some((m) => blob.includes(gates.normName(m)))) {
      matched.push({ markers: add.markers, cadence: add.cadence, matchedOn: add.match[0] });
    }
  }
  const markers = [...new Set(matched.flatMap((m) => m.markers))];
  return { status: matched.length ? 'SOURCED' : 'EMPTY', markers, detail: matched };
}

// Which product names drive this package's monitoring: the package's OWN protocol items, so the
// bloodwork facet always matches the protocol facet inside the same bundle. (Deriving from the
// client's separate currentProducts list would mismatch a freshly generated goal→protocol against
// whatever the client happens to be on now — an internally inconsistent package.) For the portal
// case the spine IS the client's approved protocol, so its items already equal currentProducts;
// currentProducts is kept only as a defensive fallback when a projection carries no items.
function packageProductNames(protocol, client) {
  const fromProtocol = (protocol.items || []).map((it) => it.productName).filter(Boolean);
  if (fromProtocol.length) return fromProtocol;
  if (client && Array.isArray(client.currentProducts) && client.currentProducts.length) return client.currentProducts;
  return [];
}

// --- Facet 1: PROTOCOL (pass-through of the gated draft) ---------------------
// Defense-in-depth: even though the server passes a client-safe projection for CLIENT, we strip
// operator-only dosing keys (titration / taper / schedule) here too, so the composer is safe
// regardless of the shape it is handed. A client never receives a personal dosing schedule.
function safeItemDosing(dosing, isClient) {
  if (!dosing) return null;
  if (!isClient) return dosing;
  const { titration, taper, schedule, ...clientSafe } = dosing;
  return clientSafe;
}

function composeProtocolFacet(protocol, isClient) {
  const items = (protocol.items || []).map((it) => {
    const out = {
      productName: it.productName,
      route: it.route || null,
      form: it.form || null,
      evidenceLevel: it.evidenceLevel || (it.evidence && it.evidence.level) || null,
    };
    if (it.dosing) out.dosing = safeItemDosing(it.dosing, isClient);
    return out;
  });
  return {
    facet: 'protocol',
    title: protocol.title || 'Protocol resource',
    goal: protocol.goal || null,
    status: protocol.status || 'DRAFT',
    itemCount: items.length,
    items,
    monitoring: protocol.monitoring || '',
    // Operator-only context — never spread to a client (rationale is internal reasoning).
    rationale: isClient ? undefined : (protocol.rationale || null),
    practitionerNote: protocol.practitionerNote || null, // client-safe note the practitioner authored
  };
}

// --- Facet 2: BLOODWORK (the requisition to order) --------------------------
function composeBloodworkFacet(protocol, client) {
  const products = packageProductNames(protocol, client);
  const baselineGate = gates.labPanelGate(panelsCfg.BASELINE);
  const safety = safetyMonitoringPanel(products);
  const suggested = Array.isArray(protocol.labsSuggested) ? protocol.labsSuggested : [];
  const baselineMarkerCount = (panelsCfg.BASELINE.sections || []).reduce((n, s) => n + (s.markers || []).length, 0);

  return {
    facet: 'bloodwork',
    status: 'TO_ORDER',
    title: 'Bloodwork to order',
    requisitionNote: REQUISITION_NOTE,
    baseline: {
      id: panelsCfg.BASELINE.id,
      label: panelsCfg.BASELINE.label,
      status: baselineGate.status,                 // SOURCED — Dr. Lun's enumerated panel
      source: panelsCfg.BASELINE.source,
      fasting: !!panelsCfg.BASELINE.fasting,
      sections: panelsCfg.BASELINE.sections,        // lab test names — safe for client + operator
      markerCount: baselineMarkerCount,
    },
    // Product-driven additions, sourced from PEPTIDE_ADDITIONS (never invented). EMPTY when the
    // package has no monitored compounds — shown honestly, not padded.
    safetyMonitoring: {
      status: safety.status,                        // SOURCED | EMPTY
      markers: safety.markers,
      detail: safety.detail,                        // [{ markers, cadence, matchedOn }]
      basedOn: products,
    },
    // Whatever the protocol itself already flagged to suggest ordering (free-text labels).
    suggested,
    provider: { name: DR_LUN.name, role: DR_LUN.role || null, contact: DR_LUN.contact || null },
    disclaimer: 'Lab ordering and interpretation are your naturopath\'s call — this is a request to review, not a diagnosis.',
  };
}

// --- Facet 3: NUTRITION (lab-driven; honest PENDING_LABS otherwise) ---------
function composeNutritionFacet(nutritionSlip) {
  if (nutritionSlip) {
    // The slip is ALREADY role-softened upstream by analyzeLabForNutrients — pass it through.
    return {
      facet: 'nutrition',
      status: nutritionSlip.providerReviewSuggested ? 'READY' : 'NONE_FLAGGED',
      title: nutritionSlip.title || `Request for your naturopath — ${DR_LUN.name}`,
      summary: nutritionSlip.summary || null,
      slip: nutritionSlip,
    };
  }
  // No confirmed lab results yet → say so plainly. We never fabricate nutrient guidance.
  return {
    facet: 'nutrition',
    status: 'PENDING_LABS',
    title: 'Nutrition — pending lab results',
    summary: null,
    slip: null,
    reason:
      'Nutrition guidance is built from your lab values. Once the bloodwork above is drawn and the ' +
      'results recorded, out-of-range vitamins and minerals become a request slip for your naturopath. ' +
      'Until those results exist there is nothing to suggest honestly.',
    unlocksWith: 'lab results recorded for this client',
  };
}

/**
 * composeClientPackage({ protocol, client, nutritionSlip, role })
 *   protocol      : a gated protocol DRAFT (operator) OR a clientProtocolProjection (client) — the spine.
 *   client        : ClientProfile (name + currentProducts → drives bloodwork monitoring).
 *   nutritionSlip : a NaturopathRequestSlip from analyzeLabForNutrients when lab results exist; else null
 *                   → the nutrition facet is honestly PENDING_LABS.
 *   role          : 'CLIENT' softens the protocol facet (no titration/taper/schedule).
 * Returns the 3-facet bundle. Composes already-gated artifacts; never mints clinical content.
 * Runs a medical-language self-check (languageOk) so a package can never carry claim language.
 */
function composeClientPackage({ protocol, client = null, nutritionSlip = null, role } = {}) {
  if (!protocol) throw new Error('composeClientPackage requires a protocol (the package spine).');
  const isClient = String(role || '').toUpperCase() === 'CLIENT';

  const protocolStatus =
    protocol.status || (protocol._model === 'ApprovedProtocol' ? 'APPROVED_RESOURCE' : 'DRAFT');
  const clientVisible = protocolStatus === gates.CLIENT_VISIBLE_STATUS; // APPROVED_RESOURCE

  const facets = {
    protocol: composeProtocolFacet(protocol, isClient),
    bloodwork: composeBloodworkFacet(protocol, client),
    nutrition: composeNutritionFacet(nutritionSlip),
  };

  const banner = clientVisible
    ? 'APPROVED RESOURCE — reviewed by your practitioner · educational, not a prescription'
    : 'DRAFT — practitioner-only · not yet approved · educational resource, not a prescription';

  const pkg = {
    _model: 'ClientPackage',
    module: 'client-package',
    title: protocol.title || (client && client.name ? `Care package — ${client.name}` : 'Client care package'),
    forClient: (client && client.name) || protocol.forClient || null,
    clientId: protocol.clientId || (client && client.id) || null,
    goal: protocol.goal || null,
    role: isClient ? 'CLIENT' : (role || 'PRACTITIONER'),
    status: protocolStatus,
    clientVisible,
    isResourceOnly: true,
    isPrescription: false,
    banner,
    intro: NOT_A_PRESCRIPTION,
    facetOrder: ['protocol', 'bloodwork', 'nutrition'],
    facets,
    meta: {
      protocolItems: facets.protocol.itemCount,
      bloodworkSourced: facets.bloodwork.baseline.status === 'SOURCED',
      safetyMonitoringStatus: facets.bloodwork.safetyMonitoring.status,
      nutritionStatus: facets.nutrition.status,
    },
    disclaimers: [
      NOT_A_PRESCRIPTION,
      facets.bloodwork.disclaimer,
    ],
  };

  // Self-check (Gate 9): nothing this composer authored may carry medical-claim language.
  // Scan ONLY the free text we wrote — lab test names and citation data are data, not claims.
  const authored = [
    pkg.banner, pkg.intro, pkg.title,
    facets.bloodwork.requisitionNote, facets.bloodwork.disclaimer,
    facets.nutrition.reason || null,
    facets.protocol.practitionerNote || null,
  ].filter(Boolean).join('  \n  ');
  const lang = gates.languageGate(authored);
  pkg.languageOk = lang.ok;
  if (!lang.ok) pkg.languageViolations = lang.violations;

  return pkg;
}

module.exports = {
  composeClientPackage,
  safetyMonitoringPanel,
  packageProductNames,
  REQUISITION_NOTE,
};
