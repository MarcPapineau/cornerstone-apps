/**
 * referral-network.js — Location-aware INTER-INDUSTRY referral network (SCAFFOLD).
 *
 * This is the data layer for Marc's cross-discipline referral idea: a client needs a
 * service the current practitioner can't provide (e.g. functional-med MD bloodwork
 * interpretation, physiotherapy, dietetics) → the app surfaces a LOCATION + SERVICE
 * filtered list of partnering practitioners → the operator sends a referral + the
 * relevant document → the recipient accepts/declines → a "handshake" is recorded.
 *
 * HARD FRAMING (inherited from providers.js, do not weaken):
 *   • Every entry is a referral CATEGORY suggestion surfaced to the OPERATOR — never a
 *     diagnosis, never an auto-booking, never a fee execution.
 *   • The naturopath is "Dr. Vincent Lun" on all output — never "Dr. Vinny".
 *   • Nothing here fabricates a credential or a clinical claim. Demo entries are flagged
 *     `_demo: true` and are illustrative partner profiles, not real endorsements.
 *
 * SCAFFOLD STATUS: the network roster + demo referral records are real, queryable data.
 * The transport (sending a referral, the recipient accept/decline handshake, and any
 * future referral / platform fee) is NOT wired — it is documented in docs/REFERRAL-SYSTEM.md
 * and surfaced in the UI as clearly-labeled scaffold. No money moves anywhere in this code.
 *
 * This file is ADDITIVE: it imports the canonical PROVIDERS / REFERRAL_CATEGORIES from
 * providers.js (the existing source-of-truth that gates.js, packages.js, nutrition.js and
 * the document models already consume) and layers a location-aware network on top. It does
 * NOT mutate providers.js, so every existing consumer is untouched.
 */

const providersCfg = require('./providers');

// The canonical naturopath record (reused — never re-typed). gates.referralGate already
// maps categories → this provider; the network roster reuses the SAME identity.
const DR_LUN =
  (providersCfg.PROVIDERS || []).find((p) => p.id === 'dr_vincent_lun') ||
  { id: 'dr_vincent_lun', name: 'Dr. Vincent Lun', role: 'Naturopathic Doctor', contact: '613-413-6053', focus: [] };

// --- Service taxonomy -------------------------------------------------------
// `service` keys are the cross-discipline needs a client can have. They map onto the
// existing REFERRAL_CATEGORIES.trigger vocabulary where one exists, so the gate's
// category logic (gates.referralGate) and the network filter speak the same language.
// `mapsToCategory` is null when the service is broader than any single observed-signal
// category (e.g. physiotherapy is a goal-driven service, not a lab-flag category).
const REFERRAL_SERVICES = [
  { service: 'naturopathic_review', label: 'Naturopathic review', mapsToCategory: 'hormone' },
  { service: 'functional_medicine', label: 'Functional-medicine workup', mapsToCategory: 'metabolic' },
  { service: 'hormone_panel', label: 'Hormone panel & review', mapsToCategory: 'lowTestosterone' },
  { service: 'bloodwork_interpretation', label: 'Bloodwork interpretation', mapsToCategory: 'abnormalLab' },
  { service: 'nutrition_dietetics', label: 'Registered-dietitian nutrition', mapsToCategory: 'nutrientDeficiency' },
  { service: 'physiotherapy', label: 'Physiotherapy / rehab', mapsToCategory: null },
  { service: 'gut_health', label: 'Functional GI / gut-health review', mapsToCategory: 'gutHealth' },
];

const SERVICE_LABELS = REFERRAL_SERVICES.reduce((acc, s) => { acc[s.service] = s.label; return acc; }, {});

// --- The location-aware practitioner roster (SCAFFOLD demo data) ------------
// Each entry carries the fields the data model needs for a location + service filter:
//   location { city, region, country }  · businessAddress · occupation · practitionerType
//   credentials · qualifications · servicesOffered[] · serviceRadiusKm · acceptingReferrals
// `_demo: true` marks every illustrative profile. Dr. Vincent Lun is reused as the anchor
// naturopath (real partnering practitioner on Vitalis client care).
const REFERRAL_NETWORK = [
  {
    id: 'dr_vincent_lun',
    _demo: false, // the one real partnering practitioner; the rest are demo fixtures
    name: DR_LUN.name, // "Dr. Vincent Lun" — never "Vinny"
    occupation: 'Naturopathic Doctor',
    practitionerType: 'ND',
    credentials: ['ND', 'Functional Neurology Fellow (FACFN cand.)'],
    qualifications: 'Naturopathic doctor; runs the Enhanced Healthy Living Assessment baseline panel; reviews Vitalis protocols before use.',
    contact: DR_LUN.contact || '613-413-6053',
    location: { city: 'Ottawa', region: 'ON', country: 'CA' },
    businessAddress: 'Ottawa, ON (by appointment)',
    servicesOffered: ['naturopathic_review', 'hormone_panel', 'bloodwork_interpretation', 'nutrition_dietetics', 'gut_health'],
    serviceRadiusKm: 60,
    acceptingReferrals: true,
    note: 'Anchor partnering naturopath on Vitalis client care.',
  },
  {
    id: 'demo_clinic_fm_ott',
    _demo: true,
    name: 'Demo — Dr. Amelia Roy, MD (Functional Medicine)',
    occupation: 'Physician — Functional / Integrative Medicine',
    practitionerType: 'MD',
    credentials: ['MD', 'CCFP', 'IFM-certified (demo)'],
    qualifications: 'Demo profile. Family physician with a functional-medicine focus; orders and interprets advanced metabolic and hormone panels.',
    contact: '613-555-0142',
    location: { city: 'Ottawa', region: 'ON', country: 'CA' },
    businessAddress: '200 Bank St, Ottawa, ON (demo)',
    servicesOffered: ['functional_medicine', 'hormone_panel', 'bloodwork_interpretation', 'metabolic'],
    serviceRadiusKm: 40,
    acceptingReferrals: true,
    note: 'Demo clinic — illustrative only, not a real endorsement.',
  },
  {
    id: 'demo_physio_kanata',
    _demo: true,
    name: 'Demo — Kanata Movement & Rehab (Physiotherapy)',
    occupation: 'Physiotherapy clinic',
    practitionerType: 'PT',
    credentials: ['Registered Physiotherapist (PT)'],
    qualifications: 'Demo profile. Musculoskeletal rehab, post-injury recovery, and movement assessment.',
    contact: '613-555-0188',
    location: { city: 'Kanata', region: 'ON', country: 'CA' },
    businessAddress: '500 Hazeldean Rd, Kanata, ON (demo)',
    servicesOffered: ['physiotherapy'],
    serviceRadiusKm: 30,
    acceptingReferrals: true,
    note: 'Demo clinic — illustrative only.',
  },
  {
    id: 'demo_dietitian_ott',
    _demo: true,
    name: 'Demo — Sarah Beauchamp, RD (Registered Dietitian)',
    occupation: 'Registered Dietitian',
    practitionerType: 'RD',
    credentials: ['RD', 'MSc Nutrition (demo)'],
    qualifications: 'Demo profile. Clinical dietetics — deficiency follow-up, metabolic nutrition, and meal planning support.',
    contact: '613-555-0173',
    location: { city: 'Ottawa', region: 'ON', country: 'CA' },
    businessAddress: '1505 Carling Ave, Ottawa, ON (demo)',
    servicesOffered: ['nutrition_dietetics', 'gut_health'],
    serviceRadiusKm: 50,
    acceptingReferrals: false, // demo: a roster member NOT currently taking referrals (the filter must respect this)
    note: 'Demo dietitian — illustrative only; flagged not-accepting to exercise the availability filter.',
  },
];

// --- Demo referral records (ProviderReferral-compatible, with a status lifecycle) -----
// These illustrate the referral handshake the scaffold documents but does not transport.
// Status lifecycle: PENDING (sent, awaiting recipient) → ACCEPTED / DECLINED → 'handshake'
// (a mutual confirmation flag) when ACCEPTED. `feeStatus` is always 'NONE' in this scaffold —
// no platform/referral fee is ever computed or executed here (documented hook only).
const REFERRAL_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED'];

const DEMO_REFERRALS = [
  {
    id: 'demo_ref_eric_fm',
    _demo: true,
    status: 'PENDING',
    handshake: false,
    feeStatus: 'NONE',
    direction: 'SENT',
    fromPractitionerId: 'dr_vincent_lun',
    toPractitionerId: 'demo_clinic_fm_ott',
    clientId: 'demo_eric_b',
    service: 'functional_medicine',
    trigger: 'metabolic',
    reason: 'Metabolic markers + fat-loss goal warrant a functional-medicine workup beyond the current scope.',
    documentRef: { silo: 'peptide', kind: 'BLOOD_REQUISITION' }, // the doc that would ride along (scaffold — not transported)
    createdAt: '2026-05-20T14:00:00.000Z',
    disclaimer: 'Referral category suggestion — not a diagnosis. No service or fee is executed by this record.',
  },
  {
    id: 'demo_ref_jim_physio',
    _demo: true,
    status: 'ACCEPTED',
    handshake: true,
    feeStatus: 'NONE',
    direction: 'SENT',
    fromPractitionerId: 'dr_vincent_lun',
    toPractitionerId: 'demo_physio_kanata',
    clientId: 'demo_jim_b',
    service: 'physiotherapy',
    trigger: null, // physiotherapy is a goal-driven service, not an observed-signal category
    reason: 'Client requested rehab support for a recovery goal outside peptide-protocol scope.',
    documentRef: null,
    createdAt: '2026-05-12T10:30:00.000Z',
    acceptedAt: '2026-05-13T09:15:00.000Z',
    disclaimer: 'Referral category suggestion — not a diagnosis. Handshake recorded; no fee executed.',
  },
  {
    id: 'demo_ref_kristen_rd',
    _demo: true,
    status: 'DECLINED',
    handshake: false,
    feeStatus: 'NONE',
    direction: 'SENT',
    fromPractitionerId: 'dr_vincent_lun',
    toPractitionerId: 'demo_dietitian_ott',
    clientId: 'demo_kristen_a',
    service: 'nutrition_dietetics',
    trigger: 'nutrientDeficiency',
    reason: 'Deficiency follow-up suggested; recipient not currently accepting referrals.',
    documentRef: { silo: 'nutrition', kind: 'NUTRITION_SLIP' },
    createdAt: '2026-05-18T16:45:00.000Z',
    declinedAt: '2026-05-19T08:00:00.000Z',
    disclaimer: 'Referral category suggestion — not a diagnosis. Declined; no fee executed.',
  },
];

const norm = (s) => String(s || '').toLowerCase().trim();

/**
 * filterNetwork — the pure location + service filter behind GET /api/referrals/network.
 * Returns roster members who offer the needed `service` (matched directly OR via the
 * service→category mapping a needed category implies), optionally narrowed to a `region`
 * (province code, e.g. 'ON') or a free-text `location` substring (city). Only members with
 * `acceptingReferrals !== false` are returned unless `includeUnavailable` is set.
 *
 * This is a SUGGESTION filter — it never diagnoses and never books. It reuses the same
 * service vocabulary the gate's categories use, so the two stay in sync.
 */
function filterNetwork({ service, region, location, includeUnavailable = false } = {}) {
  const wantService = norm(service);
  const wantRegion = norm(region);
  const wantLoc = norm(location);

  // If a needed service maps to a category, also accept roster members who list that
  // category id in servicesOffered (some demo members list the category, e.g. 'metabolic').
  const svc = REFERRAL_SERVICES.find((s) => s.service === wantService);
  const mappedCategory = svc ? svc.mapsToCategory : null;

  return REFERRAL_NETWORK.filter((p) => {
    if (!includeUnavailable && p.acceptingReferrals === false) return false;

    if (wantService) {
      const offers = (p.servicesOffered || []).map(norm);
      const hit = offers.includes(wantService) || (mappedCategory && offers.includes(norm(mappedCategory)));
      if (!hit) return false;
    }
    if (wantRegion && norm(p.location && p.location.region) !== wantRegion) return false;
    if (wantLoc) {
      const blob = norm([p.location && p.location.city, p.location && p.location.region, p.businessAddress].join(' '));
      if (!blob.includes(wantLoc)) return false;
    }
    return true;
  });
}

/**
 * listReferralsForClient — the pure read behind GET /api/referrals/status.
 * Returns the demo referral records for one client (or all when no clientId), each
 * decorated with the resolved recipient's display name + the human service label.
 * Read-only; no status is mutated here (the scaffold does not transport a handshake).
 */
function listReferralsForClient(clientId) {
  const want = norm(clientId);
  return DEMO_REFERRALS
    .filter((r) => !want || norm(r.clientId) === want)
    .map((r) => {
      const to = REFERRAL_NETWORK.find((p) => p.id === r.toPractitionerId) || null;
      const from = REFERRAL_NETWORK.find((p) => p.id === r.fromPractitionerId) || null;
      return {
        ...r,
        serviceLabel: SERVICE_LABELS[r.service] || r.service,
        toName: to ? to.name : r.toPractitionerId,
        fromName: from ? from.name : r.fromPractitionerId,
      };
    });
}

module.exports = {
  _provenance: {
    source: 'hand-authored location-aware referral network (SCAFFOLD) layered on data/providers.js',
    note: 'Referral CATEGORY suggestions + demo handshake records only — never diagnoses, never a fee execution. Dr. Vincent Lun naming rule enforced. Demo roster flagged _demo.',
  },
  REFERRAL_SERVICES,
  SERVICE_LABELS,
  REFERRAL_NETWORK,
  REFERRAL_STATUSES,
  DEMO_REFERRALS,
  filterNetwork,
  listReferralsForClient,
};
