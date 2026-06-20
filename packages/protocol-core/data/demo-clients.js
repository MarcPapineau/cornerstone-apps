/**
 * demo-clients.js — Clearly-labeled DEMO data so the dashboard is populated tonight.
 *
 * Every record carries `_demo: true`. Lab reference ranges (refLow/refHigh) are the
 * LAB REPORT's own ranges — the app computes an out-of-range FLAG from them at read
 * time; it does not bake in any clinical judgement. Product references use REAL
 * catalog ids so the protocol gate treats them as source-of-truth selections.
 *
 * Names are demo handles, not real client PII.
 */

// Practitioners are the tenant owners — each hosts many clients under their profile and
// reviews/approves protocol drafts before any client can see them. pr_lun is the real
// named provider; pr_morgan is a clearly-labeled second demo tenant so the roster and the
// approval boundary can both be exercised across two practices.
const DEMO_PRACTITIONERS = [
  {
    id: 'owner_vitalis',
    _demo: true,
    role: 'PRACTITIONER',
    practitionerType: 'OWNER',
    directClientOwner: true,
    accessStatus: 'ACTIVE',
    planLevel: 'pro',
    portalAccessEnabled: true,
    name: 'Vitalis Clinical Review',
    credentials: 'Vitalis — reviewed by Dr. Vincent Lun',
    discipline: 'Vitalis owner provider (direct-to-client)',
    contact: null,
    email: null,
    focus: ['metabolic', 'hormone', 'recovery', 'longevity'],
    note: 'Vitalis-owned provider profile. Direct-to-client profiles (no external practitioner) live under this owner — Marc/Vitalis operates as the provider here.',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'pr_lun',
    _demo: true,
    role: 'PRACTITIONER',
    practitionerType: 'PRACTITIONER',
    directClientOwner: false,
    accessStatus: 'ACTIVE',
    planLevel: 'plus',
    portalAccessEnabled: true,
    name: 'Dr. Vincent Lun',
    credentials: 'ND',
    discipline: 'Naturopathic Doctor',
    contact: null,
    email: null,
    focus: ['metabolic', 'hormone', 'lowTestosterone', 'nutrientDeficiency'],
    note: 'Reviews protocol drafts and orders the baseline panel. Named provider on referral suggestions.',
    createdAt: '2026-01-01T09:00:00.000Z',
  },
  {
    id: 'pr_morgan',
    _demo: true,
    role: 'PRACTITIONER',
    practitionerType: 'PRACTITIONER',
    directClientOwner: false,
    accessStatus: 'PENDING_REVIEW',
    planLevel: 'free',
    portalAccessEnabled: false,
    name: 'Dr. Morgan Reyes',
    credentials: 'Demo credential',
    discipline: 'Demo practitioner (second tenant)',
    contact: null,
    email: null,
    focus: ['gutHealth', 'hormone'],
    note: 'Clearly-labeled DEMO practitioner — exists to demonstrate multi-tenant separation, an already-approved resource, and a non-ACTIVE access status.',
    createdAt: '2026-01-15T09:00:00.000Z',
  },
];

const DEMO_CLIENTS = [
  {
    id: 'demo_eric_b',
    _demo: true,
    practitionerId: 'pr_lun',
    name: 'Demo — Eric B.',
    age: 47,
    sex: 'male',
    weightKg: 94.0,
    bodyFatPct: 24.5,
    leanMassKg: 71.0,
    goals: ['Fat loss', 'Recovery', 'Energy'],
    contraindications: ['None reported'],
    currentProducts: ['Retatrutide 10mg/vial', 'BPC-157 5mg/vial', 'Combo BPC-157 10mg + TB-500 10mg'],
    notes: 'Demo client. Reta titration 2→3→4 with 6-wk taper per protocol. Tissue-repair stack alongside.',
    createdAt: '2026-03-01T09:00:00.000Z',
  },
  {
    id: 'demo_kristen_a',
    _demo: true,
    practitionerId: 'pr_morgan',
    name: 'Demo — Kristen A.',
    age: 42,
    sex: 'female',
    weightKg: 63.0,
    bodyFatPct: 28.0,
    leanMassKg: 45.0,
    goals: ['Recovery', 'Sleep quality', 'Skin / tissue'],
    contraindications: ['None reported'],
    currentProducts: ['KLOW — Quad Repair Blend (Freeze-Dried)', 'DSIP 5mg', 'Selank 10mg/vial'],
    notes: 'Demo client. KLOW is a 4-compound co-lyophilized blend (BPC-157 + TB-500 + KPV + GHK-Cu) — never shown as 4 separate items. Sleep stack layered.',
    createdAt: '2026-03-05T09:00:00.000Z',
  },
  {
    id: 'demo_jim_b',
    _demo: true,
    practitionerId: 'pr_lun',
    name: 'Demo — Jim B.',
    age: 58,
    sex: 'male',
    weightKg: 88.0,
    bodyFatPct: 22.0,
    leanMassKg: 68.5,
    goals: ['Mitochondrial support', 'Energy', 'Longevity'],
    contraindications: ['None reported'],
    currentProducts: ['SS-31 10mg', 'Pen mots-c', 'CJC-1295 DAC 2mg/vial', 'Combo CJC-1295 5mg + Ipamorelin 5mg'],
    notes: 'Demo client. SS-31 + MOTS-c CO-DOSED (standard — distinct mechanisms). One out-of-range marker present to exercise the provider-review flag.',
    createdAt: '2026-02-15T09:00:00.000Z',
  },
  {
    id: 'demo_direct_dana',
    _demo: true,
    practitionerId: 'owner_vitalis',
    name: 'Demo — Dana K. (direct)',
    age: 38,
    sex: 'female',
    weightKg: 68.0,
    bodyFatPct: 26.0,
    leanMassKg: 50.0,
    goals: ['Fat loss', 'Energy'],
    contraindications: ['None reported'],
    currentProducts: ['Retatrutide 10mg/vial'],
    notes: 'Direct-to-client (no external practitioner). Owned by the Vitalis owner provider profile — never an orphan/global client.',
    createdAt: '2026-04-10T09:00:00.000Z',
  },
];

// Lab results over time. `values[].refLow/refHigh` are the report's reference range.
const DEMO_LAB_RESULTS = [
  {
    id: 'demo_lab_eric_1',
    _demo: true,
    clientId: 'demo_eric_b',
    panelId: 'baseline',
    drawnAt: '2026-03-02T08:00:00.000Z',
    fasting: true,
    values: [
      { marker: 'Glucose', value: 5.6, unit: 'mmol/L', refLow: 3.9, refHigh: 5.5 },
      { marker: 'HbA1c', value: 5.5, unit: '%', refLow: 4.0, refHigh: 5.6 },
      { marker: 'hs-CRP', value: 2.1, unit: 'mg/L', refLow: 0.0, refHigh: 3.0 },
      { marker: 'Triglycerides', value: 1.9, unit: 'mmol/L', refLow: 0.0, refHigh: 1.7 },
    ],
  },
  {
    id: 'demo_lab_eric_2',
    _demo: true,
    clientId: 'demo_eric_b',
    panelId: 'baseline',
    drawnAt: '2026-04-20T08:00:00.000Z',
    fasting: true,
    values: [
      { marker: 'Glucose', value: 5.1, unit: 'mmol/L', refLow: 3.9, refHigh: 5.5 },
      { marker: 'HbA1c', value: 5.2, unit: '%', refLow: 4.0, refHigh: 5.6 },
      { marker: 'hs-CRP', value: 1.2, unit: 'mg/L', refLow: 0.0, refHigh: 3.0 },
      { marker: 'Triglycerides', value: 1.4, unit: 'mmol/L', refLow: 0.0, refHigh: 1.7 },
    ],
  },
  {
    id: 'demo_lab_jim_1',
    _demo: true,
    clientId: 'demo_jim_b',
    panelId: 'baseline',
    drawnAt: '2026-02-16T08:00:00.000Z',
    fasting: true,
    values: [
      { marker: 'Vitamin D', value: 48, unit: 'nmol/L', refLow: 75, refHigh: 250 }, // out-of-range (low) → provider review
      { marker: 'Glucose', value: 5.0, unit: 'mmol/L', refLow: 3.9, refHigh: 5.5 },
      { marker: 'Ferritin', value: 130, unit: 'µg/L', refLow: 30, refHigh: 400 },
      { marker: 'hs-CRP', value: 0.8, unit: 'mg/L', refLow: 0.0, refHigh: 3.0 },
    ],
  },
  // Kristen (recovery / sleep client on the KLOW + sleep protocol). Two draws — a BASELINE
  // and a ~6-week FOLLOW-UP — so the lab tracker shows movement and the deltas have a prior.
  // Marker VALUES are reused verbatim from the canonical recovery/inflammation lab scenario
  // (data/lab-scenarios.js → scenarioLabValues('recovery-inflammation')); no number is
  // invented here. The flag (in/out of range) is computed at read time by gates.labResultFlagGate
  // from the report's own refLow/refHigh — this fixture bakes in NO clinical judgement.
  {
    id: 'demo_lab_kristen_1',
    _demo: true,
    clientId: 'demo_kristen_a',
    panelId: 'baseline',
    drawnAt: '2026-03-10T08:00:00.000Z',
    fasting: true,
    values: [
      { marker: 'hs-CRP', value: 4.5, unit: 'mg/L', refLow: 0, refHigh: 3.0 },          // OUT_OF_RANGE_HIGH → provider review
      { marker: 'Ferritin', value: 22, unit: 'µg/L', refLow: 30, refHigh: 400 },        // OUT_OF_RANGE_LOW  → provider review
      { marker: 'Magnesium', value: 0.70, unit: 'mmol/L', refLow: 0.75, refHigh: 0.95 }, // OUT_OF_RANGE_LOW  → provider review
      { marker: 'Vitamin D (25-OH)', value: 58, unit: 'nmol/L', refLow: 75, refHigh: 250 }, // OUT_OF_RANGE_LOW → provider review
      { marker: 'AST', value: 24, unit: 'U/L', refLow: 10, refHigh: 40 },
      { marker: 'ALT', value: 28, unit: 'U/L', refLow: 7, refHigh: 56 },
    ],
  },
  {
    id: 'demo_lab_kristen_2',
    _demo: true,
    clientId: 'demo_kristen_a',
    panelId: 'baseline',
    drawnAt: '2026-04-21T08:00:00.000Z',
    fasting: true,
    values: [
      { marker: 'hs-CRP', value: 2.1, unit: 'mg/L', refLow: 0, refHigh: 3.0 },
      { marker: 'Ferritin', value: 45, unit: 'µg/L', refLow: 30, refHigh: 400 },
      { marker: 'Magnesium', value: 0.82, unit: 'mmol/L', refLow: 0.75, refHigh: 0.95 },
      { marker: 'Vitamin D (25-OH)', value: 95, unit: 'nmol/L', refLow: 75, refHigh: 250 },
      { marker: 'AST', value: 22, unit: 'U/L', refLow: 10, refHigh: 40 },
      { marker: 'ALT', value: 25, unit: 'U/L', refLow: 7, refHigh: 56 },
    ],
  },
];

// Outcome metrics over time (scorecard inputs).
const DEMO_OUTCOMES = [
  { id: 'demo_out_eric_1', _demo: true, clientId: 'demo_eric_b', recordedAt: '2026-03-01T09:00:00.000Z', weightKg: 94.0, bodyFatPct: 24.5, leanMassKg: 71.0, adherencePct: 100, sideEffects: [], notes: 'Baseline.' },
  { id: 'demo_out_eric_2', _demo: true, clientId: 'demo_eric_b', recordedAt: '2026-04-01T09:00:00.000Z', weightKg: 90.5, bodyFatPct: 22.8, leanMassKg: 70.5, adherencePct: 95, sideEffects: ['Mild nausea wk1 (Reta titration)'], notes: 'Wk 4.' },
  { id: 'demo_out_eric_3', _demo: true, clientId: 'demo_eric_b', recordedAt: '2026-05-01T09:00:00.000Z', weightKg: 87.0, bodyFatPct: 21.0, leanMassKg: 70.0, adherencePct: 92, sideEffects: [], notes: 'Wk 8. Lean mass largely preserved.' },
  { id: 'demo_out_jim_1', _demo: true, clientId: 'demo_jim_b', recordedAt: '2026-02-15T09:00:00.000Z', weightKg: 88.0, bodyFatPct: 22.0, leanMassKg: 68.5, adherencePct: 100, sideEffects: [], notes: 'Baseline.' },
  { id: 'demo_out_jim_2', _demo: true, clientId: 'demo_jim_b', recordedAt: '2026-03-30T09:00:00.000Z', weightKg: 87.5, bodyFatPct: 21.5, leanMassKg: 68.8, adherencePct: 98, sideEffects: [], notes: 'Wk 6. Reported energy improvement (subjective).' },
  // Kristen — ~12 weeks of self-logged recovery/sleep tracking, aligned to her KLOW + sleep
  // protocol start (2026-03-08). Recovery client, not a fat-loss case: weight is broadly
  // stable, body fat eases down gently and lean mass holds/creeps up, with strong adherence.
  // Sleep quality is tracked SUBJECTIVELY (per the protocol's monitoring note), so the
  // sleep/recovery score lives in the free-text log — never presented as a clinical metric.
  // These feed PortalProgress (TrendChart Weight/Lean/Body-fat), computeScorecard deltas +
  // adherenceAvg, and the PortalHome adherence ring.
  { id: 'demo_out_kristen_1', _demo: true, clientId: 'demo_kristen_a', recordedAt: '2026-03-08T09:00:00.000Z', weightKg: 63.0, bodyFatPct: 28.0, leanMassKg: 45.0, adherencePct: 100, sideEffects: [], notes: 'Baseline at protocol start. Self-rated sleep quality 5/10; recovery between sessions 5/10.' },
  { id: 'demo_out_kristen_2', _demo: true, clientId: 'demo_kristen_a', recordedAt: '2026-03-22T09:00:00.000Z', weightKg: 62.8, bodyFatPct: 27.6, leanMassKg: 45.1, adherencePct: 96, sideEffects: [], notes: 'Wk 2. Self-rated sleep quality 6/10; falling asleep a little easier (subjective).' },
  { id: 'demo_out_kristen_3', _demo: true, clientId: 'demo_kristen_a', recordedAt: '2026-04-05T09:00:00.000Z', weightKg: 62.7, bodyFatPct: 27.1, leanMassKg: 45.3, adherencePct: 95, sideEffects: [], notes: 'Wk 4. Self-rated sleep quality 6/10; recovery 6/10. Missed two evening doses this block.' },
  { id: 'demo_out_kristen_4', _demo: true, clientId: 'demo_kristen_a', recordedAt: '2026-04-19T09:00:00.000Z', weightKg: 62.5, bodyFatPct: 26.7, leanMassKg: 45.4, adherencePct: 94, sideEffects: [], notes: 'Wk 6. Self-rated sleep quality 7/10; deeper sleep reported (subjective).' },
  { id: 'demo_out_kristen_5', _demo: true, clientId: 'demo_kristen_a', recordedAt: '2026-05-03T09:00:00.000Z', weightKg: 62.4, bodyFatPct: 26.3, leanMassKg: 45.6, adherencePct: 93, sideEffects: [], notes: 'Wk 8. Self-rated sleep quality 7/10; recovery 7/10. Training recovery noticeably easier.' },
  { id: 'demo_out_kristen_6', _demo: true, clientId: 'demo_kristen_a', recordedAt: '2026-05-31T09:00:00.000Z', weightKg: 62.3, bodyFatPct: 25.9, leanMassKg: 45.8, adherencePct: 94, sideEffects: [], notes: 'Wk 12. Self-rated sleep quality 8/10; recovery 7/10. Consolidation phase steady.' },
];

// One demo protocol DRAFT so the draft + scorecard screens render content immediately.
// References REAL catalog ids/routes. Stays status: DRAFT until reviewed.
const DEMO_DRAFTS = [
  {
    id: 'demo_draft_eric',
    _demo: true,
    clientId: 'demo_eric_b',
    status: 'DRAFT',
    createdAt: '2026-03-01T10:00:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    items: [
      { productId: 'recCXUpl3yHnrTjWD', productName: 'Retatrutide 10mg/vial', route: 'SubQ injection', form: 'Lyophilized vial (reconstitute before use)', evidenceCompoundId: 'reta' },
      { productId: 'reckoOwImcNNXa8Q6', productName: 'BPC-157 5mg/vial', route: 'SubQ injection', form: 'Lyophilized vial (reconstitute before use)', evidenceCompoundId: 'bpc157' },
    ],
    rationale: 'Resource summary only. If someone were considering a fat-loss + recovery focus, the literature most often referenced covers GLP-1/GIP agonism (Retatrutide) and tissue-repair signaling (BPC-157). Decisions are the client\'s and their provider\'s.',
    monitoring: 'Per Dr. Lun additions: Lipase / Amylase + Apo A/B baseline, Wk 6, Wk 12 (Reta). General baseline panel at start.',
    labsSuggested: ['baseline', 'safety_monitoring'],
    warnings: ['Reta capped at 4 mg/wk with mandatory 6-wk taper.', 'NEEDS_REVIEW compliance flag (GLP-1 class).'],
    citationsResolved: null, // resolved live by the research gate at view time
    unknowns: [],
  },
  // A second protocol that HAS been reviewed and approved — owned by Kristen (tenant
  // pr_morgan). This is the ONLY draft a client portal may render. Pairing it with the
  // un-reviewed Eric draft above is what proves the hard permission boundary: Eric's
  // DRAFT must never reach a client surface; Kristen's APPROVED_RESOURCE may.
  {
    id: 'demo_draft_kristen',
    _demo: true,
    clientId: 'demo_kristen_a',
    status: 'APPROVED_RESOURCE',
    createdAt: '2026-03-05T10:00:00.000Z',
    reviewedBy: 'Dr. Morgan Reyes',
    reviewedAt: '2026-03-08T14:30:00.000Z',
    items: [
      { productId: 'recNdXT2Py2hPGQkX', productName: 'KLOW — Quad Repair Blend (Freeze-Dried)', route: 'SubQ injection', form: 'Lyophilized vial (reconstitute before use)', evidenceCompoundId: null, evidenceLevel: 'UNKNOWN', dosing: { framing: 'attribution', label: 'Community practice commonly reports a daily repair-phase dose of the co-lyophilized blend', schedule: 'Once daily, evening', titration: 'Repair phase ~4–6 weeks, then reassess with your practitioner', taper: null, timing: 'Evening, separate from food', note: 'KLOW is a single co-lyophilized 4-compound blend (BPC-157 + TB-500 + KPV + GHK-Cu) — not four separate items.' } },
      { productId: 'recKMzHNkbfplVt6K', productName: 'DSIP 5mg', route: 'SubQ injection', form: 'Lyophilized vial (reconstitute before use)', evidenceCompoundId: 'dsip', evidenceLevel: 'UNKNOWN', dosing: { framing: 'attribution', label: 'Community practice reports low pre-sleep microgram dosing', schedule: 'Nightly, ~1 hour before bed', titration: 'Start low; adjust only with your practitioner', taper: null, timing: 'Pre-sleep', note: null } },
      { productId: 'recZjE0X49Q7BMa23', productName: 'Selank 10mg/vial', route: 'SubQ injection', form: 'Lyophilized vial (reconstitute before use)', evidenceCompoundId: 'selank', evidenceLevel: 'UNKNOWN', dosing: { framing: 'attribution', label: 'Reported anxiolytic dosing varies; cycle-based use is common', schedule: 'M/W/F or as advised', titration: '4–8 week cycles', taper: null, timing: 'Daytime', note: null } },
    ],
    rationale: 'Resource summary only. Recovery + sleep-quality focus: the literature most often referenced covers co-lyophilized tissue-repair signaling (KLOW blend) and sleep/anxiolytic peptides (DSIP, Selank). Evidence tier is honestly UNKNOWN for these — surfaced for the client and provider to weigh, not a recommendation.',
    monitoring: 'General baseline panel at start. Sleep-quality and recovery tracked subjectively in the progress log.',
    labsSuggested: ['baseline'],
    warnings: [],
    citationsResolved: null,
    unknowns: ['KLOW blend: no single-compound corpus entry (UNKNOWN).', 'DSIP / Selank: limited sourced evidence (UNKNOWN).'],
    compliance: {
      jurisdiction: 'CA',
      status: 'ALLOWED_RESOURCE',
      reason: 'No elevated items.',
      disclaimer: 'Compliance flags are operational routing signals only — NOT legal advice and NOT a legal determination. Every NEEDS_REVIEW / UNKNOWN item must be cleared by a qualified practitioner and/or legal counsel before any use.',
    },
    // --- Client portal "My Protocols" journey fields (current / ACTIVE) -------
    // These ride along on the approved draft and are surfaced ONLY through the
    // client-safe clientProtocolProjection. They never weaken the approval boundary:
    // the protocol is visible because status === 'APPROVED_RESOURCE', nothing else.
    title: 'Recovery & Sleep — KLOW + Sleep Stack',
    goal: 'Tissue recovery and sleep quality',
    lifecycle: 'ACTIVE',
    phase: { label: 'Phase 2 of 3 — Consolidation', index: 2, total: 3 },
    startDate: '2026-03-08T00:00:00.000Z',
    endDate: null,
    nextCheckIn: '2026-06-08T00:00:00.000Z',
    practitionerNote: 'Approved as a resource for you to review with me. We consolidated your earlier BPC-157 / TB-500 recovery work into the KLOW co-lyophilized blend and layered DSIP + Selank for sleep. Keep logging sleep quality in My Progress — this is a resource, not a prescription.',
    adherence: { pct: 94, summary: 'Strong adherence across the first 8 weeks; a couple of missed evening doses noted.' },
    progressSummary: 'Sleep quality trending up in your subjective log; training recovery reported as improved.',
    timeline: [
      { kind: 'GENERATED', at: '2026-03-05T10:00:00.000Z', label: 'Protocol resource generated', by: 'Dr. Morgan Reyes' },
      { kind: 'REVIEWED', at: '2026-03-08T14:30:00.000Z', label: 'Reviewed and approved by your practitioner', by: 'Dr. Morgan Reyes' },
      { kind: 'CLIENT_VIEWED', at: '2026-03-09T08:15:00.000Z', label: 'You opened this protocol', by: 'You' },
      { kind: 'LABS_UPLOADED', at: '2026-03-12T09:00:00.000Z', label: 'Baseline labs uploaded', by: 'You' },
      { kind: 'CHECK_IN', at: '2026-04-06T09:00:00.000Z', label: 'Week 4 progress check-in', by: 'You' },
      { kind: 'CHECK_IN', at: '2026-05-04T09:00:00.000Z', label: 'Week 8 progress check-in', by: 'You' },
    ],
  },
  // A PAST, COMPLETED protocol — also approved, also owned by Kristen. It gives the
  // "My Protocols → Past Protocols" section real history and proves the lifecycle split
  // (current vs past) is driven by `lifecycle`, not by a second visibility rule. Its
  // learnings informed the current KLOW protocol above (informedNext).
  {
    id: 'demo_draft_kristen_prior',
    _demo: true,
    clientId: 'demo_kristen_a',
    status: 'APPROVED_RESOURCE',
    lifecycle: 'COMPLETED',
    title: 'Tissue-Repair Recovery Cycle — BPC-157 / TB-500',
    goal: 'Post-injury soft-tissue recovery',
    createdAt: '2025-11-10T10:00:00.000Z',
    reviewedBy: 'Dr. Morgan Reyes',
    reviewedAt: '2025-11-12T15:00:00.000Z',
    startDate: '2025-11-12T00:00:00.000Z',
    endDate: '2026-02-20T00:00:00.000Z',
    items: [
      { productId: 'reckoOwImcNNXa8Q6', productName: 'BPC-157 5mg/vial', route: 'SubQ injection', form: 'Lyophilized vial (reconstitute before use)', evidenceCompoundId: 'bpc157', evidenceLevel: 'HIGH' },
      { productId: 'recJ9TEOXxO20L540', productName: 'Combo BPC-157 10mg + TB-500 10mg', route: 'SubQ injection', form: 'Lyophilized vial (reconstitute before use)', evidenceCompoundId: 'bpc157', evidenceLevel: 'HIGH' },
    ],
    rationale: 'Resource summary only. Earlier soft-tissue recovery focus referencing BPC-157 and TB-500 tissue-repair signaling. Decisions were the client\'s and their provider\'s.',
    monitoring: 'General baseline panel at the start and end of the cycle. Recovery tracked subjectively.',
    labsSuggested: ['baseline'],
    warnings: [],
    citationsResolved: null,
    unknowns: [],
    compliance: {
      jurisdiction: 'CA',
      status: 'ALLOWED_RESOURCE',
      reason: 'No elevated items.',
      disclaimer: 'Compliance flags are operational routing signals only — NOT legal advice and NOT a legal determination. Every NEEDS_REVIEW / UNKNOWN item must be cleared by a qualified practitioner and/or legal counsel before any use.',
    },
    practitionerNote: 'This recovery cycle went well — soft-tissue recovery was the focus and you tolerated it without issues. We used what we learned here to design your current KLOW-based protocol.',
    clientNote: 'My own notes: shoulder mobility came back over the cycle and recovery between training sessions got noticeably easier. Sleep was still hit-or-miss, which is what we decided to focus on next.',
    adherence: { pct: 91, summary: 'Consistent through the full 14-week cycle.' },
    progressSummary: 'Recovery goals met in your subjective log; transitioned to a consolidated blend afterward.',
    outcome: {
      summary: 'Completed the full cycle. Soft-tissue recovery reported as improved (subjective); no flagged tolerability issues. Informed the move to the KLOW co-lyophilized blend.',
      adherencePct: 91,
      labChanges: [
        { marker: 'hs-CRP', from: 2.4, to: 1.1, unit: 'mg/L', direction: 'down' },
      ],
      bodyComp: [
        { label: 'Body fat', from: 30.0, to: 28.5, unit: '%', direction: 'down' },
        { label: 'Lean mass', from: 44.0, to: 45.0, unit: 'kg', direction: 'up' },
      ],
    },
    informedNext: { protocolId: 'demo_draft_kristen', note: 'Learnings carried into the current KLOW + sleep protocol.' },
    timeline: [
      { kind: 'GENERATED', at: '2025-11-10T10:00:00.000Z', label: 'Protocol resource generated', by: 'Dr. Morgan Reyes' },
      { kind: 'REVIEWED', at: '2025-11-12T15:00:00.000Z', label: 'Reviewed and approved by your practitioner', by: 'Dr. Morgan Reyes' },
      { kind: 'CLIENT_VIEWED', at: '2025-11-13T07:50:00.000Z', label: 'You opened this protocol', by: 'You' },
      { kind: 'LABS_UPLOADED', at: '2025-11-15T09:00:00.000Z', label: 'Baseline labs uploaded', by: 'You' },
      { kind: 'CHECK_IN', at: '2025-12-20T09:00:00.000Z', label: 'Mid-cycle progress check-in', by: 'You' },
      { kind: 'CHANGED', at: '2026-01-15T09:00:00.000Z', label: 'Dose schedule adjusted with your practitioner', by: 'Dr. Morgan Reyes' },
      { kind: 'COMPLETED', at: '2026-02-20T00:00:00.000Z', label: 'Protocol completed', by: 'Dr. Morgan Reyes' },
    ],
  },
];

// Client documents (metadata only — local-first, never a binary blob). These populate the
// client's "My Documents" surface. Kristen (the default demo client) gets three so the page
// is not empty: her approved protocol reference, the bloodwork requisition Dr. Vincent Lun
// ordered, and her intake summary. `status` is RECEIVED | REVIEWED only — never an approval of
// care. A document is owned via clientId (practitioner is derived, never denormalized here).
const DEMO_CLIENT_DOCUMENTS = [
  {
    id: 'demo_doc_kristen_protocol', _demo: true, clientId: 'demo_kristen_a',
    kind: 'OTHER', label: 'Protocol reference — Recovery & Sleep (KLOW + sleep stack)',
    fileName: 'recovery-sleep-protocol-reference.pdf', mimeType: 'application/pdf', sizeBytes: 184320,
    textExcerpt: 'Approved resource reference for your current Recovery & Sleep protocol — educational, not a prescription. Review with your practitioner.',
    status: 'REVIEWED', uploadedBy: 'PRACTITIONER', createdAt: '2026-03-08T15:00:00.000Z',
  },
  {
    id: 'demo_doc_kristen_requisition', _demo: true, clientId: 'demo_kristen_a',
    kind: 'LAB_REPORT', label: 'Bloodwork requisition — baseline recovery panel (Dr. Vincent Lun)',
    fileName: 'baseline-requisition.pdf', mimeType: 'application/pdf', sizeBytes: 96256,
    textExcerpt: 'Baseline panel requisition: hs-CRP, ferritin, magnesium, vitamin D (25-OH), AST, ALT. Bring to your lab draw.',
    status: 'RECEIVED', uploadedBy: 'PRACTITIONER', createdAt: '2026-03-09T09:30:00.000Z',
  },
  {
    id: 'demo_doc_kristen_intake', _demo: true, clientId: 'demo_kristen_a',
    kind: 'INTAKE', label: 'Intake summary — goals & history',
    fileName: 'intake-summary.txt', mimeType: 'text/plain', sizeBytes: 4096,
    textExcerpt: 'Goals: recovery, sleep quality, skin / tissue. No contraindications reported. Prior soft-tissue recovery cycle completed.',
    status: 'REVIEWED', uploadedBy: 'CLIENT', createdAt: '2026-03-05T11:00:00.000Z',
  },
];

// ===========================================================================
// PLATFORM LAYER DEMO DATA — invitations, entitlements, paid add-ons.
// Every record _demo:true. References real practitioner/client ids above so the
// new surfaces render immediately and the gates can be exercised end-to-end.
// ===========================================================================

// A pending invitation from Dr. Lun to a prospective client — exercises the
// invite → self-intake onboarding path (no client exists yet).
const DEMO_INVITATIONS = [
  {
    id: 'demo_invite_1',
    _demo: true,
    token: 'demo_tok_welcome',
    practitionerId: 'pr_lun',
    clientId: null,
    email: 'prospect@example.com',
    name: 'Demo — Prospective Client',
    status: 'PENDING',
    message: 'Welcome — please complete your intake so we can prepare your resources.',
    intakeSubmissionId: null,
    createdAt: '2026-05-25T09:00:00.000Z',
    respondedAt: null,
  },
];

// One entitlement per existing client. Eric/Jim are Free (cap 3) so the cap can be
// exercised; Kristen is Plus (cap 10). Caps are educational-resource limits, never clinical.
const DEMO_ENTITLEMENTS = [
  { id: 'demo_ent_eric', _demo: true, clientId: 'demo_eric_b', planKey: 'free', activeProtocolCap: 3, includedProtocolCredits: 1, usedThisMonth: 1, perProtocolFee: 25, addOnsRemaining: null, status: 'ACTIVE', updatedAt: '2026-03-01T09:00:00.000Z' },
  { id: 'demo_ent_kristen', _demo: true, clientId: 'demo_kristen_a', planKey: 'plus', activeProtocolCap: 10, includedProtocolCredits: 5, usedThisMonth: 2, perProtocolFee: 20, addOnsRemaining: null, status: 'ACTIVE', updatedAt: '2026-03-05T09:00:00.000Z' },
  { id: 'demo_ent_jim', _demo: true, clientId: 'demo_jim_b', planKey: 'free', activeProtocolCap: 3, includedProtocolCredits: 1, usedThisMonth: 0, perProtocolFee: 25, addOnsRemaining: null, status: 'ACTIVE', updatedAt: '2026-02-15T09:00:00.000Z' },
  { id: 'demo_ent_dana', _demo: true, clientId: 'demo_direct_dana', planKey: 'plus', activeProtocolCap: 10, includedProtocolCredits: 5, usedThisMonth: 1, perProtocolFee: 20, addOnsRemaining: null, status: 'ACTIVE', updatedAt: '2026-04-10T09:00:00.000Z' },
];

// Paid add-on requests across the lifecycle: Kristen's is PAID + approved (portal shows it);
// Jim's is MANUALLY_APPROVED + awaiting review (practitioner queue); Eric's is UNPAID so it
// CANNOT generate (exercises the paid gate). practitionerId is DERIVED via the client.
const DEMO_ADDON_REQUESTS = [
  { id: 'demo_addon_kristen_supp', _demo: true, clientId: 'demo_kristen_a', requestType: 'SUPPLEMENT_PLAN', tier: 'COMPREHENSIVE', requestedBy: 'CLIENT', intake: { goals: ['Recovery', 'Sleep quality'], allergies: [], preferences: ['Prefer capsules'] }, paymentStatus: 'PAID', feeLabel: 'Add-on +', status: 'APPROVED_RESOURCE', draftId: 'demo_addondraft_kristen_supp', createdAt: '2026-05-10T09:00:00.000Z', updatedAt: '2026-05-12T10:00:00.000Z' },
  { id: 'demo_addon_jim_supp', _demo: true, clientId: 'demo_jim_b', requestType: 'SUPPLEMENT_PLAN', tier: 'BASIC', requestedBy: 'PRACTITIONER', intake: { goals: ['Energy', 'Longevity'] }, paymentStatus: 'MANUALLY_APPROVED', feeLabel: 'Add-on', status: 'PROVIDER_REVIEW', draftId: 'demo_addondraft_jim_supp', createdAt: '2026-05-20T09:00:00.000Z', updatedAt: '2026-05-21T09:00:00.000Z' },
  { id: 'demo_addon_eric_meal', _demo: true, clientId: 'demo_eric_b', requestType: 'MEAL_PLAN', tier: 'DETAILED', requestedBy: 'CLIENT', intake: { goals: ['Fat loss'], allergies: ['Shellfish'], dislikes: ['Liver'], dietaryStyle: 'omnivore', sex: 'male', age: 47, heightCm: 180, weightKg: 94, activityDaysPerWeek: 4, mealsPerDay: 4, cookingPreference: 'Batch / meal-prep', flavorPreference: 'moderate' }, paymentStatus: 'UNPAID', feeLabel: 'Add-on +', status: 'REQUESTED', draftId: null, createdAt: '2026-05-22T09:00:00.000Z', updatedAt: null },
];

// Add-on DRAFTS: Kristen's is APPROVED_RESOURCE (the ONLY one a client portal may render);
// Jim's stays in PROVIDER_REVIEW (never client-visible) to populate the review surface.
const DEMO_ADDON_DRAFTS = [
  {
    id: 'demo_addondraft_kristen_supp', _demo: true, requestId: 'demo_addon_kristen_supp', clientId: 'demo_kristen_a',
    addOnType: 'SUPPLEMENT_PLAN', tier: 'COMPREHENSIVE', title: 'Supplement plan — Recovery & Sleep',
    status: 'APPROVED_RESOURCE', isResourceOnly: true, isPrescription: false,
    sections: [
      { key: 'micronutrient_focus', title: 'Micronutrient focus', status: 'SOURCED', items: [
        { nutrient: 'Magnesium glycinate', ask: 'Discuss evening magnesium for sleep quality with your naturopath', basisFraming: 'attribution' },
        { nutrient: 'Vitamin D3 + K2', ask: 'Review vitamin D status at your next labs', basisFraming: 'attribution' },
      ], note: 'A request to review with your naturopath — not a prescription.' },
    ],
    rationale: 'Operator context — composed from recovery / sleep goals. Resource-only.',
    compatibilityNotes: 'Coordinates with the current KLOW + sleep protocol; timing notes for the practitioner.',
    // Sparse SupplementPlanDraft so GET /api/documents/supplement/<id> renders (toSupplementDocProps
    // is arr()-guarded). FORMS, never doses — every target stays target:null (the naturopath's call).
    // Shapes mirror supplements.generateSupplementPlan output; no clinical data is invented.
    // Targets trace to Kristen's REAL flagged baseline markers (demo_lab_kristen_1, 2026-03-10):
    // Magnesium 0.70 L, Vitamin D (25-OH) 58 L, Ferritin 22 L — all repleted toward range by the
    // 2026-04-21 follow-up. FORMS, never doses (target:null). The adapter threads the labs to derive
    // the Lab+Lifestyle Findings + baseline-vs-latest deltas + priority — no clinical value is invented.
    plan: {
      _model: 'SupplementPlanDraft', status: 'APPROVED_RESOURCE', isResourceOnly: true, isPrescription: false,
      goals: ['Recovery', 'Sleep'],
      // From her real intake (demo_addon_kristen_supp): no allergies, prefers capsules.
      contraindications: ['None reported'],
      preferences: ['Prefer capsules'],
      nutrientTargets: [
        { nutrient: 'Magnesium glycinate', suggestedForm: 'glycinate', target: { target: null, basis: 'SUPPORTIVE' }, evidenceTier: 'SUPPORTIVE', evidenceLabel: 'Supportive evidence' },
        { nutrient: 'Vitamin D3 + K2', suggestedForm: 'D3 with K2', target: { target: null, basis: 'ESTABLISHED' }, evidenceTier: 'ESTABLISHED', evidenceLabel: 'Established evidence' },
        { nutrient: 'Iron (ferritin / iron stores)', suggestedForm: 'ferrous bisglycinate', target: { target: null, basis: 'ESTABLISHED' }, evidenceTier: 'ESTABLISHED', evidenceLabel: 'Established evidence' },
      ],
      foodFirstOptions: [
        { nutrient: 'Magnesium glycinate', options: ['Pumpkin seeds', 'Spinach', 'Black beans'] },
        { nutrient: 'Vitamin D3 + K2', options: ['Fatty fish', 'Egg yolk', 'Sun exposure'] },
        { nutrient: 'Iron (ferritin / iron stores)', options: ['Red meat (heme)', 'Lentils + vitamin C', 'Tofu'] },
      ],
      discussionItems: [
        { nutrient: 'Magnesium glycinate', form: 'glycinate', ask: 'Discuss evening magnesium for sleep quality with your naturopath' },
        { nutrient: 'Vitamin D3 + K2', form: 'D3 with K2', ask: 'Review vitamin D status at your next labs' },
        { nutrient: 'Iron (ferritin / iron stores)', form: 'ferrous bisglycinate', ask: 'Review whether ferritin warrants iron, how to take it for absorption, and re-test timing with your naturopath' },
      ],
      providerReviewFlags: [],
      peptideNotes: {
        onProtocol: true, monitoringMarkers: ['hs-CRP'], detail: [{ markers: ['hs-CRP'], cadence: 'Per practitioner', matchedOn: 'KLOW' }],
        note: 'Coordinate supplement timing with your current protocol and review the monitoring markers with your practitioner.',
      },
      evidence: { source: 'protocol-core/nutrient-evidence (NIH ODS / Health Canada references)', tierLegend: ['ESTABLISHED', 'SUPPORTIVE', 'EMERGING'] },
    },
    reviewedBy: 'Dr. Morgan Reyes', reviewedAt: '2026-05-12T10:00:00.000Z', createdAt: '2026-05-11T09:00:00.000Z',
  },
  {
    id: 'demo_addondraft_jim_supp', _demo: true, requestId: 'demo_addon_jim_supp', clientId: 'demo_jim_b',
    addOnType: 'SUPPLEMENT_PLAN', tier: 'BASIC', title: 'Supplement plan (draft)',
    status: 'PROVIDER_REVIEW', isResourceOnly: true, isPrescription: false,
    sections: [
      { key: 'micronutrient_focus', title: 'Micronutrient focus (from your labs)', status: 'SOURCED', items: [
        { nutrient: 'Vitamin D3', ask: 'Low vitamin D flagged — discuss repletion with your naturopath', basisFraming: 'attribution' },
      ], note: 'Built from your confirmed lab values.' },
    ],
    rationale: 'Operator context — Jim has a low vitamin D flag; energy / longevity goals. Resource-only.',
    compatibilityNotes: 'Coordinates with SS-31 + MOTS-c co-dose; no interaction expected.',
    reviewedBy: null, reviewedAt: null, createdAt: '2026-05-20T10:00:00.000Z',
  },
];

module.exports = {
  _provenance: {
    source: 'hand-authored DEMO data (clearly marked _demo:true)',
    note: 'Demo handles, not real PII. Lab ranges are report ranges; flags computed at read time. Product refs use real catalog ids.',
  },
  DEMO_PRACTITIONERS,
  DEMO_CLIENTS,
  DEMO_LAB_RESULTS,
  DEMO_OUTCOMES,
  DEMO_DRAFTS,
  DEMO_CLIENT_DOCUMENTS,
  DEMO_INVITATIONS,
  DEMO_ENTITLEMENTS,
  DEMO_ADDON_REQUESTS,
  DEMO_ADDON_DRAFTS,
};
