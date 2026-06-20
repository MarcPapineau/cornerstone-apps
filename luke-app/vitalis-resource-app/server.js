/**
 * server.js — My Vitalis Health App (MVP).
 *
 * Thin Express server: serves the SPA and exposes a REST API where every clinical
 * boundary is a server-side GATE (lib/gates.js). The server is the source of truth;
 * the browser asks, it never decides. NOT medical advice — research/resource tooling.
 */
const express = require('express');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const G = require('@vitalis/protocol-core/gates');
const M = require('@vitalis/protocol-core/models');
const GEN = require('@vitalis/protocol-core/generator');
const NUT = require('@vitalis/protocol-core/nutrition');
const PKG = require('@vitalis/protocol-core/packages');
const ACC = require('@vitalis/protocol-core/accounts');
const ADDON = require('@vitalis/protocol-core/addons');
const RSRC = require('@vitalis/protocol-core/research');
const DOC = require('@vitalis/protocol-core/document-model');
const VDOC = require('@vitalis/protocol-core/vertical-document-model');
const connectors = require('@vitalis/protocol-core/connectors');
const CAT = require('@vitalis/protocol-core/catalog');
const {
  catalog,
  evidence,
  panels: panelsData,
  compliance: complianceCfg,
  providers: providersCfg,
  referralNetwork: referralNet,   // location-aware inter-industry referral network (SCAFFOLD)
  demo,
  dosing: dosingCfg,
} = require('@vitalis/protocol-core/data');

const store = require('./lib/store'); // runtime state stays app-local (data/store.json)
const { isOpenMode } = require('./lib/open-mode'); // TEST/OPEN-MODE flag (VITALIS_OPEN_MODE, default OFF)

const APP_NAME = 'My Vitalis Health App';
const DISCLAIMER =
  'Educational / research resource only. NOT medical advice, diagnosis, treatment, or prescription. ' +
  'Vitalis does not diagnose, treat, cure, or prescribe. Always review with a qualified practitioner before any use.';

// Source-of-truth catalog index (built once).
const catalogIndex = { byId: {}, list: catalog.products };
for (const p of catalog.products) catalogIndex.byId[p.id] = p;

const app = express();
app.use(express.json({ limit: '1mb' }));

const DIST_DIR = resolve(__dirname, 'dist');
const PUBLIC_DIR = resolve(__dirname, 'public');
const STATIC_DIR = existsSync(resolve(DIST_DIR, 'index.html')) ? DIST_DIR : PUBLIC_DIR;
app.use(express.static(STATIC_DIR));

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

// --- Dynamic safety-monitoring panel from selected product names ------------
// Single source: delegates to protocol-core (PKG.safetyMonitoringPanel) so the lab-panels
// route and the Client Package composer read the SAME peptide→marker mapping (no drift).
function buildSafetyMonitoring(productNames = []) {
  return PKG.safetyMonitoringPanel(productNames);
}

// --- Scorecard computation from outcome metrics -----------------------------
function computeScorecard(clientId) {
  const outcomes = store.list('outcomes').filter((o) => o.clientId === clientId)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  if (outcomes.length < 1) return M.ReviewCard({ clientId, outcomeFlag: 'PENDING', learnings: 'No outcome metrics recorded yet.' });
  const first = outcomes[0];
  const last = outcomes[outcomes.length - 1];
  const delta = (a, b) => (a != null && b != null ? +(b - a).toFixed(2) : null);
  const deltas = {
    weightKg: delta(first.weightKg, last.weightKg),
    bodyFatPct: delta(first.bodyFatPct, last.bodyFatPct),
    leanMassKg: delta(first.leanMassKg, last.leanMassKg),
  };
  const adherenceVals = outcomes.map((o) => o.adherencePct).filter((v) => v != null);
  const adherenceAvg = adherenceVals.length ? +(adherenceVals.reduce((a, b) => a + b, 0) / adherenceVals.length).toFixed(0) : null;
  const sideEffectsSeen = [...new Set(outcomes.flatMap((o) => o.sideEffects || []))];
  // Honest, non-clinical heuristic flag (operator-facing, never a medical judgement).
  let outcomeFlag = 'PENDING';
  if (outcomes.length >= 2) {
    const fatDown = deltas.bodyFatPct != null && deltas.bodyFatPct < 0;
    const leanHeld = deltas.leanMassKg != null && deltas.leanMassKg >= -1.0;
    if (fatDown && leanHeld) outcomeFlag = 'SUCCESS';
    else if (deltas.bodyFatPct != null && deltas.bodyFatPct > 0.5) outcomeFlag = 'NEEDS_ADJUSTMENT';
    else outcomeFlag = 'NEEDS_ADJUSTMENT';
  }
  return M.ReviewCard({
    clientId, outcomeFlag, deltas, adherenceAvg, sideEffectsSeen,
    learnings: `${outcomes.length} datapoints over ${first.recordedAt.slice(0, 10)} → ${last.recordedAt.slice(0, 10)}.`,
  });
}

// --- Flagged labs for a client (gate 5) -------------------------------------
function flaggedLabsFor(clientId) {
  return store.list('labResults').filter((r) => r.clientId === clientId).map((r) => G.labResultFlagGate(r));
}

// --- Activity time-series (READ-ONLY, additive) for command-center sparklines -----
// The analytics/overview endpoints have NO stored time-series, so the dashboard sparklines are
// derived HERE from EXISTING timestamped store records (drafts.createdAt/reviewedAt,
// labResults.drawnAt, outcomes.recordedAt). This is a pure read-aggregation — no clinical logic,
// nothing written, nothing fabricated. The demo records are already labelled demo, so a REAL
// aggregation of them is honest.
//
// HONESTY GUARANTEE: the demo seed's records run at a MONTHLY cadence (Nov 2025 → May 2026), so
// the only granularity that yields a real, multi-point trend is monthly — weekly buckets would be
// single-point/empty for every metric, which the rule says to omit. We therefore bucket by month
// and apply the omit rule: a series with < 2 populated buckets returns `null` and the KPI card
// ships value+delta only (NEVER a padded or invented trend).
const monthKey = (iso) => (iso ? String(iso).slice(0, 7) : null); // YYYY-MM

// Build an ordered series of monthly values from records, agg = 'count' | 'cumulative' | 'avg'.
// Returns null when fewer than 2 months are populated (the omit rule).
function monthlySeries(records, tsField, { agg = 'count', valFn } = {}) {
  const byMonth = new Map();
  for (const r of records || []) {
    const k = monthKey(r[tsField]);
    if (!k) continue;
    const arr = byMonth.get(k) || [];
    arr.push(valFn ? Number(valFn(r)) : 1);
    byMonth.set(k, arr);
  }
  const keys = [...byMonth.keys()].sort();
  if (keys.length < 2) return null; // single-point / empty → OMIT (no fabrication)
  let running = 0;
  const series = keys.map((k) => {
    const vals = byMonth.get(k);
    if (agg === 'avg') return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const monthSum = vals.reduce((a, b) => a + b, 0);
    if (agg === 'cumulative') { running += monthSum; return running; }
    return monthSum; // 'count' (per-month)
  });
  return series;
}

// Compose the named real series for a given scope (a set of client ids, or all clients when null).
// Each value is a sparkline (≥2 real points) or null (→ delta-only KPI card). NEVER padded.
function activitySeries({ clientIds = null } = {}) {
  const inScope = (rec) => clientIds == null || clientIds.has(rec.clientId);
  const drafts = store.list('drafts').filter(inScope);
  const labs = store.list('labResults').filter(inScope);
  const outcomes = store.list('outcomes').filter(inScope);
  return {
    // Cumulative protocols generated by createdAt (monotonic → reads as growth-to-current).
    protocolsGenerated: monthlySeries(drafts, 'createdAt', { agg: 'cumulative' }),
    // Cumulative approvals by reviewedAt (only approved drafts carry a reviewedAt approval).
    approvedProtocols: monthlySeries(
      drafts.filter((d) => d.status === 'APPROVED_RESOURCE'),
      'reviewedAt',
      { agg: 'cumulative' },
    ),
    // Cumulative labs completed by drawnAt.
    labsCompleted: monthlySeries(labs, 'drawnAt', { agg: 'cumulative' }),
    // Monthly AVERAGE adherence % from recorded outcomes (the genuinely dense series).
    avgAdherence: monthlySeries(outcomes, 'recordedAt', { agg: 'avg', valFn: (o) => o.adherencePct }),
  };
}

// --- Nutrition slip for the Client Package ----------------------------------
// The package's nutrition facet is LAB-DRIVEN: only the client's most-recent recorded lab
// result mints a slip. No results → null → the composer emits an honest PENDING_LABS facet
// (never fabricated guidance). Role-softened + honesty-guarded like /api/nutrition/analyze.
function nutritionSlipForClient(clientId, role) {
  const results = store.list('labResults')
    .filter((r) => r.clientId === clientId)
    .sort((a, b) => new Date(b.drawnAt || 0) - new Date(a.drawnAt || 0));
  if (!results.length) return null;
  const client = store.get('clients', clientId);
  const slip = NUT.analyzeLabForNutrients({
    values: results[0].values || [],
    role,
    products: (client && client.currentProducts) || [],
    clientName: (client && client.name) || null,
  });
  return slip.languageOk === false ? null : slip; // never surface a gate-failing slip
}

// ===========================================================================
// META / HEALTH
// ===========================================================================
app.get('/api/health', (_req, res) => ok(res, { service: APP_NAME, time: new Date().toISOString() }));

// Runtime client config — the ONLY way the SPA learns whether TEST/OPEN-MODE is on. Read at
// request time from the env (NOT baked in at build), so the demo server can be started with
// `VITALIS_OPEN_MODE=1` and the client picks it up on load with no rebuild. Default OFF.
app.get('/api/config', (_req, res) => ok(res, { openMode: isOpenMode() }));

app.get('/api/meta', (_req, res) => ok(res, {
  app: APP_NAME,
  version: require('./package.json').version,
  disclaimer: DISCLAIMER,
  models: M.MODEL_NAMES,
  connectors: connectors.CONNECTORS,
  compliance: { jurisdictions: Object.keys(complianceCfg.JURISDICTIONS), statuses: complianceCfg.STATUSES, disclaimer: complianceCfg.DISCLAIMER },
  provenance: { catalog: catalog._provenance, evidence: evidence._provenance, panels: panelsData._provenance },
}));

// ===========================================================================
// DASHBOARD (screen 1)
// ===========================================================================
app.get('/api/dashboard', (_req, res) => {
  const clients = store.list('clients');
  const drafts = store.list('drafts');
  const labs = store.list('labResults');
  const pendingLabClients = clients.filter((c) => !labs.some((l) => l.clientId === c.id)).length;
  // Compliance warnings: drafts whose items carry NEEDS_REVIEW/BLOCKED, computed live.
  let complianceWarnings = 0;
  let researchGaps = 0;
  for (const d of drafts) {
    for (const it of d.items || []) {
      const comp = G.complianceGate(it.productName, 'CA', complianceCfg);
      if (comp.status === 'NEEDS_REVIEW' || comp.status === 'BLOCKED') complianceWarnings++;
      const r = G.researchGate(it.evidenceCompoundId, evidence.byCompound);
      if (r.level === 'UNKNOWN') researchGaps++;
    }
  }
  const flaggedLabCount = labs.reduce((n, r) => n + (G.labResultFlagGate(r).hasFlags ? 1 : 0), 0);
  ok(res, {
    counts: {
      clients: clients.length,
      draftProtocols: drafts.filter((d) => d.status === 'DRAFT' || d.status === 'BLOCKED').length,
      pendingLabs: pendingLabClients,
      flaggedLabs: flaggedLabCount,
      complianceWarnings,
      researchGaps,
    },
    disclaimer: DISCLAIMER,
    demo: G.demoDataGate(demo),
  });
});

// ===========================================================================
// CLIENTS (screen 2)
// ===========================================================================
app.get('/api/clients', (_req, res) => ok(res, { clients: store.list('clients') }));
app.get('/api/clients/:id', (req, res) => {
  const c = store.get('clients', req.params.id);
  return c ? ok(res, { client: c }) : fail(res, 404, 'Client not found');
});
app.post('/api/clients', (req, res) => {
  const client = M.ClientProfile(req.body || {});
  store.upsert('clients', client);
  ok(res, { client });
});
app.delete('/api/clients/:id', (req, res) => ok(res, { removed: store.remove('clients', req.params.id) }));

// ===========================================================================
// LAB PANELS (screen 3)
// ===========================================================================
app.get('/api/lab-panels', (req, res) => {
  const productNames = (req.query.products ? String(req.query.products).split('|') : []).filter(Boolean);
  const baseline = G.labPanelGate(panelsData.BASELINE);
  const optional = panelsData.OPTIONAL.map((p) => {
    if (p.id === 'safety_monitoring') {
      const sm = buildSafetyMonitoring(productNames);
      return { id: p.id, label: p.label, ...G.labPanelGate({ ...p, status: sm.status === 'SOURCED' ? 'SOURCED' : p.status }), markers: sm.markers, detail: sm.detail, dynamic: true };
    }
    return { id: p.id, label: p.label, ...G.labPanelGate(p) };
  });
  ok(res, { baseline: { ...baseline, label: panelsData.BASELINE.label, sections: panelsData.BASELINE.sections, source: panelsData.BASELINE.source }, optional, provenance: panelsData._provenance });
});

// ===========================================================================
// LAB RESULTS (screen 4)
// ===========================================================================
app.get('/api/lab-results', (req, res) => {
  const clientId = req.query.clientId;
  const rows = store.list('labResults').filter((r) => !clientId || r.clientId === clientId).map((r) => G.labResultFlagGate(r));
  ok(res, { results: rows });
});
app.post('/api/lab-results', (req, res) => {
  const lab = M.LabResult(req.body || {});
  store.upsert('labResults', lab);
  ok(res, { result: G.labResultFlagGate(lab) });
});

// ===========================================================================
// NUTRITION (screen 11) — lab → deficiency → "request for your naturopath" slip.
// Server-authoritative: the browser does a best-effort local parse and the human
// CONFIRMS the values; the SERVER then runs the gate engine and role-softens. A CLIENT
// never receives the citation list or the naturopathic "how" — that boundary is enforced
// HERE (by passing role to the engine), not in the UI. Read-only: never mints a draft,
// never persists, never leaks practitioner content.
// ===========================================================================
app.post('/api/nutrition/parse', (req, res) => {
  const text = (req.body && req.body.text) || '';
  const { rows, skipped } = NUT.parseLabText(text);
  ok(res, { rows, skipped, count: rows.length });
});

app.post('/api/nutrition/analyze', (req, res) => {
  const body = req.body || {};
  const role = String(body.role || 'PRACTITIONER').toUpperCase();

  // Confirmed values win. If only raw text was sent, parse server-side as a fallback.
  let values = Array.isArray(body.values) ? body.values : [];
  if (!values.length && typeof body.text === 'string' && body.text.trim()) {
    values = NUT.parseLabText(body.text).rows;
  }
  if (!values.length) return fail(res, 422, 'No lab values supplied to analyze.');

  // Pull the client (for name + current peptide products → peptide ⇄ nutrition cross-ref).
  const client = body.clientId ? store.get('clients', body.clientId) : null;
  const products = Array.isArray(body.products) && body.products.length
    ? body.products
    : (client && client.currentProducts) || [];

  const slip = NUT.analyzeLabForNutrients({
    values,
    role,
    products,
    clientName: (client && client.name) || body.clientName || null,
  });

  // Honesty guard: never emit a slip that fails the medical-language gate.
  if (slip.languageOk === false) return fail(res, 500, 'Generated slip failed the medical-language gate — withheld.');

  ok(res, { slip, disclaimer: DISCLAIMER });
});

// GET the LIVE example slip for a client, resolved server-side from THEIR most-recent stored
// lab draw — same helper the Client Package uses (nutritionSlipForClient), so the standalone
// Nutrition page and the Package facet can never drift. Read-only, role-softened, honesty-gated:
// the engine picks no values the client did not record, and a gate-failing slip is withheld.
// No labs → { slip: null, status: 'PENDING_LABS' } so the surface shows honest empty guidance
// instead of fabricating a recommendation.
app.get('/api/nutrition/slip', (req, res) => {
  const clientId = req.query.clientId;
  if (!clientId) return fail(res, 422, 'clientId is required to resolve a client nutrition slip.');
  const role = String(req.query.role || 'CLIENT').toUpperCase();
  const client = store.get('clients', clientId);
  if (!client) return fail(res, 404, 'Client not found');
  const slip = nutritionSlipForClient(clientId, role);
  if (!slip) return ok(res, { slip: null, status: 'PENDING_LABS', clientName: client.name || null, disclaimer: DISCLAIMER });
  ok(res, { slip, status: 'LIVE', clientName: client.name || null, disclaimer: DISCLAIMER });
});

// ===========================================================================
// CATALOG (screen 5)
// ===========================================================================
app.get('/api/catalog', (req, res) => {
  const role = req.query.role;
  const q = G.normName(req.query.q || '');
  let products = catalog.products;
  if (q) products = products.filter((p) => G.normName(p.name).includes(q));
  // Role-aware projection: CLIENT/PRACTITIONER never receive internal economics (cost/margin/costPerMg).
  ok(res, { products: CAT.projectCatalog(products, role), provenance: catalog._provenance, count: products.length, role: CAT.normalizeRole(role) });
});
app.get('/api/catalog/:id', (req, res) => {
  const p = catalogIndex.byId[req.params.id];
  if (!p) return fail(res, 404, 'Product not in source-of-truth catalog');
  const rf = G.productFormRouteGate(p);
  // Project by role so internal economics never leak to a client/practitioner surface.
  ok(res, { product: CAT.projectProduct(p, req.query.role), routeFormGate: rf });
});

// ===========================================================================
// RESEARCH GATE (screen 6)
// ===========================================================================
app.get('/api/evidence/:compoundId', (req, res) => {
  ok(res, { research: G.researchGate(req.params.compoundId, evidence.byCompound), compoundId: req.params.compoundId });
});
app.get('/api/evidence', (_req, res) => ok(res, { index: evidence.index, provenance: evidence._provenance }));
app.post('/api/research/lookup', async (req, res) => {
  const term = (req.body && req.body.term) || '';
  if (!term) return fail(res, 400, 'term required');
  ok(res, { lookup: await connectors.liveLookup(term) });
});

// ===========================================================================
// PROTOCOL DRAFT (screen 7)
// ===========================================================================
app.post('/api/protocol/draft', (req, res) => {
  const body = req.body || {};
  const client = store.get('clients', body.clientId) || M.ClientProfile({ id: body.clientId });
  const draft = G.assembleDraft({
    client,
    itemRefs: body.itemRefs || [],
    catalogIndex,
    evidenceByCompound: evidence.byCompound,
    complianceCfg,
    jurisdiction: body.jurisdiction || 'CA',
    rationale: body.rationale || '',
    monitoring: body.monitoring || '',
    labsSuggested: body.labsSuggested || [],
  });
  if (body.persist) store.upsert('drafts', draft);
  ok(res, { draft });
});
app.get('/api/protocol/drafts', (req, res) => {
  const clientId = req.query.clientId;
  ok(res, { drafts: store.list('drafts').filter((d) => !clientId || d.clientId === clientId) });
});
app.get('/api/protocol/drafts/:id', (req, res) => {
  const d = store.get('drafts', req.params.id);
  return d ? ok(res, { draft: d }) : fail(res, 404, 'Draft not found');
});
app.post('/api/protocol/drafts/:id/review', (req, res) => {
  const d = store.get('drafts', req.params.id);
  if (!d) return fail(res, 404, 'Draft not found');
  const body = req.body || {};
  const reviewer = body.reviewedBy || 'Dr. Vincent Lun';
  const comment = body.comment || '';

  // Decision-driven path — the multi-tenant approval boundary. APPROVE is the ONLY
  // route that flips a draft to APPROVED_RESOURCE (the single client-visible state).
  if (body.decision) {
    const decision = String(body.decision).toUpperCase();
    if ((decision === 'APPROVE' || decision === 'APPROVED') && d.blocked) {
      return fail(res, 409, 'A BLOCKED draft cannot be approved — clear the gate failures first.');
    }
    // Liability lever 4 — approving a GENERATED (AI-proposed) protocol requires the
    // practitioner to attest they are qualified + peptide-literate AND independently
    // reviewed the basis of the recommendation (the CDS-exemption hinge). Manual drafts
    // have no `source:'generator'` and are unaffected — this guard is purely additive.
    if ((decision === 'APPROVE' || decision === 'APPROVED') && d.source === 'generator') {
      // OPEN_MODE auto-satisfies the attestation PROMPT so a tester can APPROVE a generated
      // protocol without first signing it. The APPROVE TRANSITION below is unchanged — only the
      // 428 prompt friction is removed. The genEvent is still written, tagged as an open-mode
      // override (honest trail), so the attestation record is never silently faked as real.
      const openMode = isOpenMode();
      const att = GEN.practitionerAttestationGate(openMode
        ? { qualifiedPeptideLiterate: true, reviewedBasis: true, practitionerName: (body.attestation && body.attestation.practitionerName) || reviewer }
        : { ...(body.attestation || {}), practitionerName: (body.attestation && body.attestation.practitionerName) || reviewer });
      if (!openMode && !att.ok) return fail(res, 428, 'Practitioner attestation required to approve a generated protocol: ' + att.reasons.join(' '));
      store.upsert('genEvents', { id: M.uid('att'), kind: 'ATTESTATION', draftId: d.id, clientId: d.clientId, openModeOverride: openMode, ...att.attestation });
    }
    const verdict = G.reviewDecisionGate(decision);
    d.reviewedBy = reviewer;
    d.reviewedAt = new Date().toISOString();
    d.status = verdict.status;
    d.statusBanner = verdict.clientVisible
      ? 'APPROVED RESOURCE — reviewed · client-visible'
      : (verdict.status === 'CHANGES_REQUESTED' ? 'CHANGES REQUESTED — practitioner-only' : 'IN REVIEW — practitioner-only');
    store.upsert('drafts', d);
    const note = M.ReviewNote({ draftId: d.id, clientId: d.clientId, author: reviewer, decision, text: comment });
    store.upsert('reviews', note);
    return ok(res, { draft: d, review: note, clientVisible: verdict.clientVisible });
  }

  // Back-compat path — existing "mark reviewed" call (no decision) → REVIEWED, never
  // client-visible. Keeps the Protocol Generator's Draft screen working unchanged.
  d.reviewedBy = reviewer;
  d.reviewedAt = new Date().toISOString();
  const sg = G.draftStatusGate(d);
  d.status = sg.status;
  d.statusBanner = sg.banner;
  store.upsert('drafts', d);
  ok(res, { draft: d });
});

// ===========================================================================
// CLIENT PACKAGE (one-click bundle) — practitioner/operator compose from a draft
// ===========================================================================
// The same gated draft, presented as Protocol + Bloodwork + Nutrition. Operator role gets
// full dosing + rationale; the nutrition facet is PENDING_LABS until the client has recorded
// lab results. Read-only: composes the already-gated draft, persists nothing, mints nothing.
// A CLIENT can never compose from a raw draft here — they use /api/client/:id/package (approved
// only). The package becomes client-visible only when the underlying draft is APPROVED_RESOURCE.
app.get('/api/protocol/drafts/:id/package', (req, res) => {
  const role = String(req.query.role || 'PRACTITIONER').toUpperCase();
  if (role === 'CLIENT') {
    return fail(res, 403, 'A client cannot compose a package from a draft — use the portal package endpoint (approved resources only).');
  }
  const d = store.get('drafts', req.params.id);
  if (!d) return fail(res, 404, 'Draft not found');
  const client = store.get('clients', d.clientId) || M.ClientProfile({ id: d.clientId });
  const slip = nutritionSlipForClient(d.clientId, role);
  const pkg = PKG.composeClientPackage({ protocol: d, client, nutritionSlip: slip, role });
  if (pkg.languageOk === false) return fail(res, 500, 'Generated package failed the medical-language gate — withheld.');
  ok(res, { package: pkg, disclaimer: DISCLAIMER });
});

// ===========================================================================
// PROTOCOL GENERATOR — the in-app "chat" generator (AI proposes, gates dispose)
// ===========================================================================
// Same gate chain as the manual Draft Builder; the difference is only WHO proposes the
// items (a goal→category mapper, or a pluggable LLM adapter) — never how they're vetted.
// Output is always DRAFT / RESOURCE-ONLY, dosing is attribution-framed, and a generated
// draft is persisted ONLY by a practitioner/admin who has accepted the jurisdiction notice.
// Practitioner MODIFICATION — edit a draft's narrative fields before approval (practitioner/
// admin only). Whitelisted fields only; the edit is language-gated and recorded as a MODIFIED
// audit event so the trail reads generated → modified → approved. An APPROVED protocol is locked
// (request changes first). The client never sees these edits until approval; rationale stays
// practitioner-only either way.
const EDITABLE_DRAFT_FIELDS = ['title', 'goal', 'rationale', 'monitoring', 'practitionerNote', 'labsSuggested'];
app.patch('/api/protocol/drafts/:id', (req, res) => {
  const body = req.body || {};
  if (String(body.role || 'PRACTITIONER').toUpperCase() === 'CLIENT') return fail(res, 403, 'A client cannot edit a protocol draft.');
  const draft = store.get('drafts', req.params.id);
  if (!draft) return fail(res, 404, 'Draft not found');
  if (draft.status === 'APPROVED_RESOURCE') return fail(res, 409, 'Approved protocols are locked — request changes first to edit.');
  const changed = [];
  for (const f of EDITABLE_DRAFT_FIELDS) {
    if (body[f] === undefined) continue;
    const val = f === 'labsSuggested'
      ? (Array.isArray(body[f]) ? body[f] : String(body[f]).split(',').map((s) => s.trim()).filter(Boolean))
      : body[f];
    if (JSON.stringify(draft[f]) !== JSON.stringify(val)) { draft[f] = val; changed.push(f); }
  }
  if (!changed.length) return ok(res, { draft, changed: [] });
  const lang = G.languageGate([draft.rationale, draft.monitoring, draft.practitionerNote, draft.title].filter(Boolean).join('  \n  '));
  if (!lang.ok) return fail(res, 422, 'Edited text contains medical-claim language: ' + lang.violations.map((v) => `"${v.term}"`).join(', '));
  draft.modifiedAt = new Date().toISOString();
  draft.modifiedBy = body.modifiedBy || 'practitioner';
  store.upsert('drafts', draft);
  store.upsert('genEvents', { id: M.uid('mod'), kind: 'MODIFIED', draftId: draft.id, clientId: draft.clientId, fields: changed, by: draft.modifiedBy, at: draft.modifiedAt });
  ok(res, { draft, changed });
});

// Audit trail for ONE draft — generated → modified → approved (chronological). Practitioner/admin.
app.get('/api/protocol/drafts/:id/audit', (req, res) => {
  const ts = (e) => new Date(e.at || e.acceptedAt || e.reviewedAt || e.createdAt || 0).getTime();
  const events = store.list('genEvents').filter((e) => e.draftId === req.params.id).sort((a, b) => ts(a) - ts(b));
  ok(res, { draftId: req.params.id, events });
});

app.post('/api/protocol/generate', (req, res) => {
  const body = req.body || {};
  const role = String(body.role || 'PRACTITIONER').toUpperCase();
  const jurisdiction = body.jurisdiction || 'CA';
  const client = store.get('clients', body.clientId) || M.ClientProfile({ id: body.clientId || 'anonymous', name: 'Unassigned' });

  const result = GEN.generateProtocol({
    goalText: body.goalText || '',
    client,
    catalogIndex,
    evidenceByCompound: evidence.byCompound,
    complianceCfg,
    dosing: dosingCfg,
    jurisdiction,
    role,
  });

  const hasItems = (result.draft.items || []).length > 0;
  // OPEN_MODE auto-satisfies the one-time jurisdiction-notice PROMPT so a tester can persist
  // without first signing the ack. This removes the prompt FRICTION only — every downstream
  // gate (language, compliance, projection, approval) is untouched.
  const openMode = isOpenMode();
  const acknowledged = body.acknowledged === true || openMode;

  // Persistence is practitioner/admin-only AND requires the jurisdiction acknowledgment.
  // A CLIENT-role generation is always live/educational and is NEVER persisted — a client
  // cannot mint a draft, only explore research ranges (lever 5).
  let persisted = false;
  let requiresAcknowledgment = false;
  let protocolPayment = null;
  if (body.persist && hasItems) {
    if (role === 'CLIENT') {
      return fail(res, 403, 'A client cannot persist a protocol — generated client output is educational only.');
    }
    if (!acknowledged) {
      requiresAcknowledgment = true;
    } else {
      const isNew = !store.get('drafts', result.draft.id);
      if (isNew) {
        // Entitlement enforcement on a NEW generated protocol: (1) the active-protocol cap (a hard
        // block), and (2) monthly included-credit accounting. Within credits → INCLUDED_CREDIT
        // (free); past them an overage fee is DUE and we BLOCK (402) unless it is paid or a
        // practitioner/admin explicitly overrides (logged MANUALLY_APPROVED). A CLIENT role can
        // never reach this path (it is 403'd above), so client self-generation can't bypass fees.
        const entitlement = store.list('entitlements').find((e) => e.clientId === client.id) || ACC.defaultEntitlement(client.id);
        const capGate = ACC.entitlementGate({ entitlement, activeProtocolCount: activeProtocolCountFor(client.id) });
        // OPEN_MODE: do not reject for entitlement reasons (no active-protocol cap 409, no
        // included-credit/$25 overage 402). Treat as unlimited / auto-override so testers can
        // generate freely. The genEvent below is still written, tagged OPEN_MODE_OVERRIDE (honest trail).
        if (!openMode && capGate.blocked) return fail(res, 409, capGate.reason);

        const plan = ACC.planForKey(entitlement.planKey);
        const pay = ACC.protocolPaymentFor(plan, entitlement.usedThisMonth || 0);
        const override = body.manualOverride === true && (role === 'PRACTITIONER' || role === 'ADMIN');
        if (openMode) protocolPayment = 'OPEN_MODE_OVERRIDE';
        else if (pay.withinCredit) protocolPayment = 'INCLUDED_CREDIT';
        else if (override) protocolPayment = 'MANUALLY_APPROVED';
        else if (body.overagePaid === true) protocolPayment = 'PAID';
        else {
          return res.status(402).json({
            ok: false,
            error: `Protocol overage fee of $${pay.fee} is due — monthly included credits used (${entitlement.usedThisMonth}/${plan.includedProtocolCredits}). Pay the overage or use a practitioner override.`,
            payment: { required: true, fee: pay.fee, usedThisMonth: entitlement.usedThisMonth, includedCredits: plan.includedProtocolCredits, status: 'UNPAID' },
          });
        }

        result.draft.paymentStatus = protocolPayment;
        store.upsert('drafts', result.draft);

        // Increment the client's monthly usage so the NEXT generation sees the consumed credit.
        const liveEnt = store.list('entitlements').find((e) => e.clientId === client.id);
        if (liveEnt) { liveEnt.usedThisMonth = (liveEnt.usedThisMonth || 0) + 1; liveEnt.updatedAt = new Date().toISOString(); store.upsert('entitlements', liveEnt); }
        else { const seeded = ACC.defaultEntitlement(client.id); seeded.usedThisMonth = 1; store.upsert('entitlements', seeded); }

        store.upsert('genEvents', { id: M.uid('pay'), kind: 'PROTOCOL_PAYMENT', draftId: result.draft.id, clientId: client.id, paymentStatus: protocolPayment, fee: openMode ? 0 : pay.fee, role, manualOverride: override, openModeOverride: openMode, at: new Date().toISOString() });
      } else {
        store.upsert('drafts', result.draft); // re-persist of an existing draft id = update, not a new protocol
      }
      store.upsert('genEvents', {
        id: M.uid('ack'), kind: 'ACKNOWLEDGMENT', draftId: result.draft.id,
        clientId: client.id, jurisdiction, role, goalText: String(body.goalText || '').slice(0, 240),
        // Honest trail: when the jurisdiction-notice prompt was auto-satisfied by OPEN_MODE
        // (tester didn't sign it), record that — distinct from a real practitioner acceptance.
        openModeOverride: openMode && body.acknowledged !== true,
        acceptedAt: new Date().toISOString(),
      });
      persisted = true;
    }
  }

  ok(res, {
    draft: result.draft,
    reasoning: result.reasoning,
    matchedGoals: result.matchedGoals,
    proposerSource: result.proposerSource,
    jurisdictionNotice: result.jurisdictionNotice,
    licenseNotice: { statement: GEN.practitionerLicenseAcknowledgmentGate({}).statement },
    framing: result.framing,
    empty: !hasItems,
    persisted,
    requiresAcknowledgment,
    protocolPayment,
    disclaimer: DISCLAIMER,
  });
});

// Software-license acknowledgment (responsibility shift) — distinct from the per-protocol
// jurisdiction notice. A licensing practitioner accepts that they own their own due diligence
// and qualifications; Vitalis only provides access to research/community-aggregated DRAFTs.
// Validated server-side via the same gate the tests cover, and logged as an audit genEvent.
app.post('/api/protocol/license-ack', (req, res) => {
  const body = req.body || {};
  const role = String(body.role || 'PRACTITIONER').toUpperCase();
  if (role === 'CLIENT') {
    return fail(res, 403, 'The license acknowledgment applies to practitioners/operators licensing the software, not clients.');
  }
  // OPEN_MODE auto-satisfies the software-license-ack PROMPT so a tester is never blocked behind
  // an unsigned license. The genEvent is tagged openModeOverride so the trail stays honest.
  const openMode = isOpenMode();
  const gate = GEN.practitionerLicenseAcknowledgmentGate({
    acceptedResponsibility: openMode || body.acceptedResponsibility === true,
    acceptedQualifications: openMode || body.acceptedQualifications === true,
  });
  if (!gate.ok) return fail(res, 422, gate.reasons.join(' '));
  store.upsert('genEvents', {
    id: M.uid('lic'), kind: 'LICENSE_ACK', role,
    practitionerName: body.practitionerName || null,
    acceptedResponsibility: true, acceptedQualifications: true,
    openModeOverride: openMode && !(body.acceptedResponsibility === true && body.acceptedQualifications === true),
    acceptedAt: gate.acknowledgment.acknowledgedAt,
  });
  ok(res, { acknowledged: gate.acknowledgment, statement: gate.statement });
});

// Audit trail for the generator (acknowledgments + attestations) — admin/observability.
app.get('/api/protocol/gen-events', (req, res) => {
  const clientId = req.query.clientId;
  ok(res, { events: store.list('genEvents').filter((e) => !clientId || e.clientId === clientId) });
});

// ===========================================================================
// PROVIDER REFERRALS (screen 8)
// ===========================================================================
app.get('/api/referrals', (req, res) => {
  const client = store.get('clients', req.query.clientId);
  if (!client) return fail(res, 404, 'Client not found');
  ok(res, { referrals: G.referralGate(client, flaggedLabsFor(client.id), providersCfg) });
});
app.get('/api/providers', (_req, res) => ok(res, { providers: providersCfg.PROVIDERS, categories: providersCfg.REFERRAL_CATEGORIES }));

// --- Inter-industry referral network (SCAFFOLD) -----------------------------
// Location + service filtered roster of partnering practitioners a client could be
// referred to for a need outside the current practitioner's scope. SUGGESTION-only —
// reuses referral-network.filterNetwork (same service↔category vocabulary as the gate);
// it never diagnoses, never books, and never executes a fee. Read endpoints only.
//   GET /api/referrals/network?clientId=&service=&region=&location=&includeUnavailable=
//   GET /api/referrals/status?clientId=
app.get('/api/referrals/network', (req, res) => {
  const { clientId, service, region, location } = req.query;
  const includeUnavailable = String(req.query.includeUnavailable || '') === 'true';
  // clientId is optional context; when present we attach the client's region as a default
  // location hint, but never expand the filter beyond what was asked.
  const client = clientId ? store.get('clients', clientId) : null;
  if (clientId && !client) return fail(res, 404, 'Client not found');
  const matches = referralNet.filterNetwork({ service, region, location, includeUnavailable });
  ok(res, {
    scaffold: true, // the transport (send referral / handshake / fee) is NOT wired
    clientId: clientId || null,
    filter: { service: service || null, region: region || null, location: location || null, includeUnavailable },
    services: referralNet.REFERRAL_SERVICES,
    matches,
    note: 'Referral suggestions only — not a diagnosis, no booking, no fee. Sending a referral + the handshake are scaffold (see docs/REFERRAL-SYSTEM.md).',
  });
});

app.get('/api/referrals/status', (req, res) => {
  const { clientId } = req.query;
  if (clientId && !store.get('clients', clientId)) return fail(res, 404, 'Client not found');
  ok(res, {
    scaffold: true,
    clientId: clientId || null,
    referrals: referralNet.listReferralsForClient(clientId),
    statuses: referralNet.REFERRAL_STATUSES,
    note: 'Demo referral records (sent/accepted/declined/handshake). Status is illustrative — no live transport or fee.',
  });
});

// ===========================================================================
// OUTCOMES + SCORECARD (screen 9)
// ===========================================================================
app.get('/api/outcomes', (req, res) => {
  const clientId = req.query.clientId;
  ok(res, { outcomes: store.list('outcomes').filter((o) => !clientId || o.clientId === clientId) });
});
app.post('/api/outcomes', (req, res) => {
  const o = M.OutcomeMetric(req.body || {});
  store.upsert('outcomes', o);
  ok(res, { outcome: o, scorecard: computeScorecard(o.clientId) });
});
app.get('/api/scorecard/:clientId', (req, res) => ok(res, { scorecard: computeScorecard(req.params.clientId) }));

// ===========================================================================
// COMPLIANCE (screen 10)
// ===========================================================================
app.get('/api/compliance', (req, res) => {
  const subject = req.query.subject || '';
  const jurisdiction = req.query.jurisdiction || 'CA';
  if (!subject) {
    return ok(res, { jurisdictions: complianceCfg.JURISDICTIONS, statuses: complianceCfg.STATUSES, flags: complianceCfg.COMPOUND_FLAGS, disclaimer: complianceCfg.DISCLAIMER });
  }
  ok(res, { check: G.complianceGate(subject, jurisdiction, complianceCfg) });
});

// ===========================================================================
// MULTI-TENANT — PRACTITIONERS · CLIENT PORTAL · ADMIN (role-aware surfaces)
// Ownership is single-sourced on client.practitionerId. Nothing is denormalized onto
// drafts; rosters and review queues are DERIVED by joining draft.clientId → client.
// ===========================================================================

// Admin: every practitioner (tenant owner).
app.get('/api/practitioners', (_req, res) => ok(res, { practitioners: store.list('practitioners') }));
app.get('/api/practitioners/:id', (req, res) => {
  const p = store.get('practitioners', req.params.id);
  return p ? ok(res, { practitioner: p }) : fail(res, 404, 'Practitioner not found');
});

// Admin: create a practitioner/provider account. Defaults ACTIVE + portal access on (M.Practitioner).
app.post('/api/practitioners', (req, res) => {
  const body = req.body || {};
  if (!String(body.name || '').trim()) return fail(res, 400, 'A practitioner name is required.');
  const pr = M.Practitioner(body);
  store.upsert('practitioners', pr);
  ok(res, { practitioner: pr });
});

// Admin: update a practitioner's access status / plan / portal access (whitelisted fields only).
const ACCESS_STATES = ['ACTIVE', 'SUSPENDED', 'INVITED', 'PENDING_REVIEW'];
app.patch('/api/practitioners/:id', (req, res) => {
  const pr = store.get('practitioners', req.params.id);
  if (!pr) return fail(res, 404, 'Practitioner not found');
  const body = req.body || {};
  if (body.accessStatus != null) {
    const s = String(body.accessStatus).toUpperCase();
    if (!ACCESS_STATES.includes(s)) return fail(res, 400, `accessStatus must be one of ${ACCESS_STATES.join(', ')}.`);
    pr.accessStatus = s;
  }
  if (body.planLevel != null) pr.planLevel = String(body.planLevel).toLowerCase();
  if (body.portalAccessEnabled != null) pr.portalAccessEnabled = !!body.portalAccessEnabled;
  store.upsert('practitioners', pr);
  ok(res, { practitioner: pr });
});

// Admin: per-practitioner analytics — a real operator view of one provider (counts, usage,
// approval turnaround, demo revenue, access).
app.get('/api/practitioner/:id/analytics', (req, res) => {
  const pid = req.params.id;
  const p = store.get('practitioners', pid);
  if (!p) return fail(res, 404, 'Practitioner not found');
  const clients = store.list('clients').filter((c) => c.practitionerId === pid);
  const clientIds = new Set(clients.map((c) => c.id));
  const allDrafts = store.list('drafts');
  const drafts = allDrafts.filter((d) => clientIds.has(d.clientId));
  const addOnDrafts = store.list('addOnDrafts').filter((d) => clientIds.has(d.clientId));
  const addOnRequests = store.list('addOnRequests').filter((r) => clientIds.has(r.clientId));
  const entitlements = store.list('entitlements').filter((e) => clientIds.has(e.clientId));
  const planByKey = Object.fromEntries(ACC.SUBSCRIPTION_TIERS.map((x) => [x.key, x]));
  const paid = new Set(['PAID', 'MANUALLY_APPROVED', 'INCLUDED_CREDIT']);

  const approved = drafts.filter((d) => d.status === 'APPROVED_RESOURCE');
  const activeClients = clients.filter((c) => drafts.some((d) => d.clientId === c.id && d.status === 'APPROVED_RESOURCE' && String(d.lifecycle || 'ACTIVE').toUpperCase() !== 'COMPLETED')).length;
  const turns = approved.filter((d) => d.createdAt && d.reviewedAt).map((d) => (new Date(d.reviewedAt) - new Date(d.createdAt)) / 36e5);
  const avgTurnaroundHours = turns.length ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length) : null;
  const mrr = entitlements.reduce((s, e) => s + ((planByKey[e.planKey] || {}).monthlyFee || 0), 0);
  const addOnRevenue = addOnRequests
    .filter((r) => paid.has(r.paymentStatus) && r.paymentStatus !== 'INCLUDED_CREDIT')
    .reduce((s, r) => { const ent = entitlements.find((e) => e.clientId === r.clientId); const plan = planByKey[(ent || {}).planKey] || planByKey.free; return s + (ACC.addOnFeeFor(plan, r.requestType) || 0); }, 0);

  // Operating-surface signals (derived from existing store data — no new module, no new endpoint).
  const clientsWithLabs = new Set(store.list('labResults').map((l) => l.clientId));
  const clientsMissingLabs = clients.filter((c) => !clientsWithLabs.has(c.id)).length;
  const dueCutoff = Date.now() + 14 * 864e5;
  const clientsDueCheckIn = approved.filter((d) => d.nextCheckIn && new Date(d.nextCheckIn).getTime() <= dueCutoff).length;
  const recentDrafts = drafts.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 5)
    .map((d) => ({ id: d.id, clientId: d.clientId, status: d.status, createdAt: d.createdAt, items: (d.items || []).length, title: d.title || d.goal || null }));

  // Per-silo usage — every count is DERIVED from a store read this practitioner already owns
  // (no new engine, no fabricated number). Meal plans are the nutrition-adjacent silo; the
  // bloodwork-requisition silo is counted from the practitioner's clients' LAB_REPORT documents.
  const mealPlans = addOnDrafts.filter((d) => d.addOnType === 'MEAL_PLAN').length;
  const supplementPlans = addOnDrafts.filter((d) => d.addOnType === 'SUPPLEMENT_PLAN').length;
  const bloodReqs = store.list('clientDocuments').filter((doc) => clientIds.has(doc.clientId) && doc.kind === 'LAB_REPORT').length;
  const moduleUsage = [
    { silo: 'peptide', label: 'Peptide protocols', count: drafts.length },
    { silo: 'supplement', label: 'Supplement plans', count: supplementPlans },
    { silo: 'meal', label: 'Meal / nutrition plans', count: mealPlans },
    { silo: 'blood_req', label: 'Bloodwork requisitions', count: bloodReqs },
  ];

  // Referral activity — aggregate this practitioner's CLIENTS' demo referral records (reuses the
  // same scaffold read behind GET /api/referrals/status). Counts only; no transport, no fee.
  const refRecords = referralNet.listReferralsForClient().filter((r) => clientIds.has(r.clientId));
  const refByStatus = refRecords.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const referralSummary = {
    scaffold: true,
    total: refRecords.length,
    sent: refRecords.filter((r) => r.direction === 'SENT').length,
    accepted: refByStatus.ACCEPTED || 0,
    pending: refByStatus.PENDING || 0,
    declined: refByStatus.DECLINED || 0,
    handshakes: refRecords.filter((r) => r.handshake).length,
    recent: refRecords
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 5)
      .map((r) => ({ id: r.id, clientId: r.clientId, serviceLabel: r.serviceLabel, toName: r.toName, status: r.status, handshake: !!r.handshake, createdAt: r.createdAt })),
  };

  ok(res, {
    practitioner: { id: p.id, name: p.name, discipline: p.discipline, credentials: p.credentials, accessStatus: p.accessStatus, planLevel: p.planLevel, portalAccessEnabled: p.portalAccessEnabled !== false, practitionerType: p.practitionerType || 'PRACTITIONER', directClientOwner: !!p.directClientOwner, note: p.note || null },
    stats: {
      clientCount: clients.length,
      activeClients,
      protocolsGenerated: drafts.length,
      approvedProtocols: approved.length,
      pendingReviews: drafts.filter((d) => d.status !== 'APPROVED_RESOURCE' && !d.blocked).length,
      supplementPlans,
      mealPlans,
      bloodReqs,
      addOnRequests: addOnRequests.length,
      clientsMissingLabs,
      clientsDueCheckIn,
      avgTurnaroundHours,
      revenue: { mrr, addOnRevenue, total: mrr + addOnRevenue },
    },
    moduleUsage,
    referrals: referralSummary,
    recentDrafts,
    // Real monthly sparkline series for the command-center KPI strip (omit-or-real; never padded).
    activity: activitySeries({ clientIds }),
  });
});

// Practitioner roster: the clients that BELONG TO this practitioner.
app.get('/api/practitioner/:id/clients', (req, res) => {
  const pid = req.params.id;
  if (!store.get('practitioners', pid)) return fail(res, 404, 'Practitioner not found');
  const clients = store.list('clients').filter((c) => c.practitionerId === pid);
  ok(res, { practitionerId: pid, clients });
});

// Practitioner review queue: this practitioner's drafts still awaiting a decision —
// not yet approved and not gate-blocked. Derived via draft.clientId → client.practitionerId.
app.get('/api/practitioner/:id/reviews', (req, res) => {
  const pid = req.params.id;
  if (!store.get('practitioners', pid)) return fail(res, 404, 'Practitioner not found');
  const ownClientIds = new Set(store.list('clients').filter((c) => c.practitionerId === pid).map((c) => c.id));
  const reviews = store.list('drafts')
    .filter((d) => ownClientIds.has(d.clientId) && d.status !== 'APPROVED_RESOURCE' && !d.blocked)
    .map((d) => ({ ...d, clientName: (store.get('clients', d.clientId) || {}).name || null }));
  ok(res, { practitionerId: pid, reviews });
});

// Practitioner creates a client UNDER their practice — practitionerId is FORCED from the
// route, so a practitioner-created client is never an orphan/global record (the IA rule).
app.post('/api/practitioner/:id/clients', (req, res) => {
  const pid = req.params.id;
  if (String((req.body && req.body.role) || 'PRACTITIONER').toUpperCase() === 'CLIENT') return fail(res, 403, 'A client cannot create clients.');
  if (!store.get('practitioners', pid)) return fail(res, 404, 'Practitioner not found');
  const client = M.ClientProfile({ ...(req.body || {}), practitionerId: pid });
  store.upsert('clients', client);
  ok(res, { client });
});

// Practitioner client DOSSIER — everything for ONE owned client in a single scoped read.
// Ownership is ENFORCED (the client must belong to this practitioner). Drafts are raw /
// practitioner-only; `protocols` is the APPROVED current/past projection (the same gate the
// portal uses); add-ons carry their drafts for review. Nothing here weakens a client
// projection — the portal endpoints remain the only client-facing surface.
app.get('/api/practitioner/:id/clients/:clientId/dossier', (req, res) => {
  const pid = req.params.id;
  const cid = req.params.clientId;
  if (String(req.query.role || 'PRACTITIONER').toUpperCase() === 'CLIENT') return fail(res, 403, 'Clients cannot open the practitioner dossier.');
  if (!store.get('practitioners', pid)) return fail(res, 404, 'Practitioner not found');
  const client = store.get('clients', cid);
  if (!client) return fail(res, 404, 'Client not found');
  if (client.practitionerId !== pid) return fail(res, 403, 'This client does not belong to your practice.');

  const allDrafts = store.list('drafts');
  const drafts = allDrafts.filter((d) => d.clientId === cid);
  const reviewDrafts = drafts.filter((d) => d.status !== 'APPROVED_RESOURCE');
  const protocols = G.clientVisibleProtocols(allDrafts, cid);
  const { current, past } = G.splitProtocolsByLifecycle(protocols);
  const labs = flaggedLabsFor(cid);
  const documents = store.list('clientDocuments').filter((d) => d.clientId === cid);
  const addOnDrafts = store.list('addOnDrafts');
  const addOnRequests = store.list('addOnRequests').filter((r) => r.clientId === cid)
    .map((r) => ({ ...r, draft: r.draftId ? (addOnDrafts.find((d) => d.id === r.draftId) || null) : null }));
  const addOnApproved = ADDON.clientVisibleAddOns(addOnDrafts, cid);
  const outcomes = store.list('outcomes').filter((o) => o.clientId === cid)
    .sort((a, b) => new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0));
  const entitlement = store.list('entitlements').find((e) => e.clientId === cid) || ACC.defaultEntitlement(cid);

  ok(res, {
    practitionerId: pid,
    client,
    drafts,
    reviewDrafts,
    protocols: { current, past },
    labs,
    documents,
    addOns: { requests: addOnRequests, approved: addOnApproved },
    outcomes,
    entitlement,
    activeProtocolCount: current.length,
    counts: {
      reviewDrafts: reviewDrafts.length,
      currentProtocols: current.length,
      pastProtocols: past.length,
      labs: labs.length,
      documents: documents.length,
      addOnRequests: addOnRequests.length,
      addOnApproved: addOnApproved.length,
      outcomes: outcomes.length,
    },
    disclaimer: DISCLAIMER,
  });
});

// CLIENT PORTAL — THE HARD PERMISSION RULE, server-enforced. Returns ONLY approved
// resources, projected through the gate. There is deliberately no parameter that can
// surface a draft: an un-approved draft is physically dropped to null by the projection.
app.get('/api/client/:id/resources', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  const resources = G.clientVisibleResources(store.list('drafts'), cid);
  ok(res, { clientId: cid, resources, disclaimer: DISCLAIMER });
});

// CLIENT PORTAL — "My Protocols" journey. SAME hard boundary as /resources: only
// APPROVED_RESOURCE protocols are projected (clientVisibleProtocols), so an un-approved
// draft is physically dropped. The approved set is then split current-vs-past by lifecycle
// and folded into one newest-first timeline. No parameter can surface a draft here either.
app.get('/api/client/:id/protocols', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  const protocols = G.clientVisibleProtocols(store.list('drafts'), cid);
  const { current, past } = G.splitProtocolsByLifecycle(protocols);
  const timeline = G.buildProtocolTimeline(protocols);
  ok(res, { clientId: cid, current, past, timeline, disclaimer: DISCLAIMER });
});

// CLIENT PORTAL — the one-click Client Package, opened by the client. SAME hard boundary as
// /protocols: the spine is composed ONLY from this client's APPROVED protocols (the lifecycle
// "current" leads; we fall back to the most recent past). clientVisibleProtocols physically
// drops every un-approved draft, so no parameter can surface a draft. Nutrition is lab-driven
// (PENDING_LABS until results exist). When the client has no approved protocol yet, we say so.
app.get('/api/client/:id/package', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  const protocols = G.clientVisibleProtocols(store.list('drafts'), cid);
  const { current, past } = G.splitProtocolsByLifecycle(protocols);
  const spine = current[0] || past[0] || null;
  if (!spine) return ok(res, { clientId: cid, package: null, status: 'NO_PROTOCOL', disclaimer: DISCLAIMER });
  const client = store.get('clients', cid);
  const slip = nutritionSlipForClient(cid, 'CLIENT');
  const pkg = PKG.composeClientPackage({ protocol: spine, client, nutritionSlip: slip, role: 'CLIENT' });
  if (pkg.languageOk === false) return fail(res, 500, 'Package failed the medical-language gate — withheld.');
  ok(res, { clientId: cid, package: pkg, status: 'OK', disclaimer: DISCLAIMER });
});

// CLIENT self-service protocol REQUEST. The client submits a goal; the server generates a
// gated DRAFT, entitlement-enforced: within monthly credits → INCLUDED_CREDIT and the draft
// enters the practitioner review queue; over credits → 402 with the overage fee (no bypass).
// The draft is NEVER client-visible until the practitioner approves it — the client only ever
// sees its STATUS via /protocol-requests. Self-generation cannot mint an approved resource.
app.post('/api/client/:id/protocol-requests', (req, res) => {
  const cid = req.params.id;
  const client = store.get('clients', cid);
  if (!client) return fail(res, 404, 'Client not found');
  const goalText = String((req.body || {}).goalText || '').trim();
  if (!goalText) return fail(res, 400, 'A goal is required to request a protocol.');

  const result = GEN.generateProtocol({ goalText, client, catalogIndex, evidenceByCompound: evidence.byCompound, complianceCfg, dosing: dosingCfg, jurisdiction: 'CA', role: 'PRACTITIONER' });
  if (!(result.draft.items || []).length) {
    return ok(res, { requested: false, empty: true, message: 'No catalog-backed resources matched that goal yet — try a clearer goal, or ask your practitioner.', disclaimer: DISCLAIMER });
  }

  // OPEN_MODE: never reject a client protocol REQUEST for entitlement reasons (no cap 409, no
  // overage 402) — the request still enters the practitioner review queue, and is still NEVER
  // client-visible until APPROVED (the approval boundary is untouched). Friction removed, not the gate.
  const openMode = isOpenMode();
  const entitlement = store.list('entitlements').find((e) => e.clientId === cid) || ACC.defaultEntitlement(cid);
  const capGate = ACC.entitlementGate({ entitlement, activeProtocolCount: activeProtocolCountFor(cid) });
  if (!openMode && capGate.blocked) return fail(res, 409, capGate.reason);
  const plan = ACC.planForKey(entitlement.planKey);
  const pay = ACC.protocolPaymentFor(plan, entitlement.usedThisMonth || 0);
  if (!openMode && !pay.withinCredit) {
    return res.status(402).json({ ok: false, error: `This month's included protocol credits are used (${entitlement.usedThisMonth}/${plan.includedProtocolCredits}). An overage fee of $${pay.fee} applies — your practitioner can confirm it.`, payment: { required: true, fee: pay.fee, usedThisMonth: entitlement.usedThisMonth, includedCredits: plan.includedProtocolCredits } });
  }

  result.draft.paymentStatus = openMode ? 'OPEN_MODE_OVERRIDE' : 'INCLUDED_CREDIT';
  result.draft.requestedBy = 'CLIENT';
  result.draft.status = 'IN_REVIEW';        // enters the practitioner review queue; never client-visible
  result.draft.goal = goalText;
  store.upsert('drafts', result.draft);
  const liveEnt = store.list('entitlements').find((e) => e.clientId === cid);
  if (liveEnt) { liveEnt.usedThisMonth = (liveEnt.usedThisMonth || 0) + 1; liveEnt.updatedAt = new Date().toISOString(); store.upsert('entitlements', liveEnt); }
  else { const seeded = ACC.defaultEntitlement(cid); seeded.usedThisMonth = 1; store.upsert('entitlements', seeded); }
  const requestPayment = openMode ? 'OPEN_MODE_OVERRIDE' : 'INCLUDED_CREDIT';
  store.upsert('genEvents', { id: M.uid('req'), kind: 'CLIENT_PROTOCOL_REQUEST', draftId: result.draft.id, clientId: cid, goalText: goalText.slice(0, 240), paymentStatus: requestPayment, openModeOverride: openMode, at: new Date().toISOString() });
  ok(res, { requested: true, status: 'IN_REVIEW', draftId: result.draft.id, payment: { status: requestPayment, creditsRemaining: openMode ? null : Math.max(0, (plan.includedProtocolCredits || 0) - ((entitlement.usedThisMonth || 0) + 1)) }, disclaimer: DISCLAIMER });
});

// CLIENT view of their protocol REQUESTS — STATUS ONLY (never the draft content). Approved
// protocols carry full content in /api/client/:id/protocols; here the client tracks in-flight
// requests: Awaiting review / Changes requested / Approved.
const REQUEST_STATUS_LABEL = { DRAFT: 'Awaiting review', IN_REVIEW: 'Awaiting review', CHANGES_REQUESTED: 'Changes requested', APPROVED_RESOURCE: 'Approved', BLOCKED: 'Needs attention' };
app.get('/api/client/:id/protocol-requests', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  const requests = store.list('drafts')
    .filter((d) => d.clientId === cid && d.requestedBy === 'CLIENT')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map((d) => ({ id: d.id, goal: d.goal || null, status: d.status, statusLabel: REQUEST_STATUS_LABEL[d.status] || d.status, createdAt: d.createdAt }));
  ok(res, { clientId: cid, requests, disclaimer: DISCLAIMER });
});

// ===========================================================================
// PLATFORM — ONBOARDING (invitations + self-intake + documents)
// A practitioner invites a client; the invited client opens the invitation by its opaque
// token and submits their own intake, which creates/links a ClientProfile (DATA ONLY — a
// self-intake never approves anything). Documents are local-first metadata.
// ===========================================================================

// Practitioner creates an invitation (practitioner/admin only).
app.post('/api/invitations', (req, res) => {
  const body = req.body || {};
  const role = String(body.role || 'PRACTITIONER').toUpperCase();
  if (role === 'CLIENT') return fail(res, 403, 'Only a practitioner can invite a client.');
  const practitionerId = body.practitionerId || null;
  if (practitionerId && !store.get('practitioners', practitionerId)) return fail(res, 404, 'Practitioner not found');
  const invitation = ACC.createInvitation({ practitionerId, email: body.email, name: body.name, message: body.message });
  store.upsert('invitations', invitation);
  ok(res, { invitation, disclaimer: DISCLAIMER });
});

// List invitations (optionally scoped to a practitioner) — the practitioner's invite list.
app.get('/api/invitations', (req, res) => {
  const practitionerId = req.query.practitionerId;
  const invitations = store.list('invitations').filter((i) => !practitionerId || i.practitionerId === practitionerId);
  ok(res, { invitations });
});

// Load a single invitation by its opaque token (the invited client opens their intake form).
app.get('/api/invitations/:token', (req, res) => {
  const inv = store.list('invitations').find((i) => i.token === req.params.token) || null;
  if (!inv) return fail(res, 404, 'Invitation not found');
  ok(res, { invitation: inv });
});

// The invited client submits their self-intake → creates/links a ClientProfile + records the
// submission. DATA ONLY: never an approval, never a draft. The new client belongs to the
// inviting practitioner (derived ownership).
app.post('/api/invitations/:token/intake', (req, res) => {
  const inv = store.list('invitations').find((i) => i.token === req.params.token) || null;
  if (!inv) return fail(res, 404, 'Invitation not found');
  const body = req.body || {};
  const existing = inv.clientId ? store.get('clients', inv.clientId) : null;
  const { client, submission } = ACC.applyIntake({ invitation: inv, intake: body.intake || body, existingClient: existing });
  store.upsert('clients', client);
  store.upsert('intakeSubmissions', submission);
  inv.clientId = client.id;
  inv.status = 'INTAKE_SUBMITTED';
  inv.intakeSubmissionId = submission.id;
  inv.respondedAt = new Date().toISOString();
  store.upsert('invitations', inv);
  ok(res, { client, submission, invitation: inv, disclaimer: DISCLAIMER });
});

// Record a client document's metadata (local-first; the client brings in a lab/intake doc).
app.post('/api/client/:id/documents', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  const doc = ACC.recordDocument({ ...(req.body || {}), clientId: cid });
  store.upsert('clientDocuments', doc);
  ok(res, { document: doc });
});

// List a client's documents.
app.get('/api/client/:id/documents', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  ok(res, { clientId: cid, documents: store.list('clientDocuments').filter((d) => d.clientId === cid) });
});

// ===========================================================================
// PLATFORM — ENTITLEMENTS (subscription cap on active generated protocols)
// ===========================================================================
function activeProtocolCountFor(clientId) {
  return store.list('drafts').filter((d) => d.clientId === clientId
    && d.status !== 'BLOCKED'
    && String(d.lifecycle || 'ACTIVE').toUpperCase() !== 'COMPLETED').length;
}

app.get('/api/client/:id/entitlements', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  const entitlement = store.list('entitlements').find((e) => e.clientId === cid) || ACC.defaultEntitlement(cid);
  const usage = ACC.entitlementGate({ entitlement, activeProtocolCount: activeProtocolCountFor(cid) });
  ok(res, { clientId: cid, entitlement, plan: ACC.planForKey(entitlement.planKey), usage, tiers: ACC.SUBSCRIPTION_TIERS });
});

// ===========================================================================
// PLATFORM — PAID ADD-ONS (supplement + meal plans). Same DRAFT → review → approve spine
// as protocols: a draft is NEVER client-visible until status === APPROVED_RESOURCE.
// ===========================================================================

// Client (or practitioner) requests an add-on. Created UNPAID; cannot generate until paid.
app.post('/api/client/:id/add-ons/request', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  const body = req.body || {};
  const gate = ADDON.addonRequestGate({ clientId: cid, requestType: body.requestType, tier: body.tier });
  if (!gate.ok) return fail(res, 400, gate.reasons.join(' '));
  const request = ADDON.createAddOnRequest({
    clientId: cid, requestType: body.requestType, tier: body.tier, intake: body.intake || {},
    requestedBy: String(body.role || 'CLIENT').toUpperCase() === 'CLIENT' ? 'CLIENT' : 'PRACTITIONER',
    paymentStatus: body.paymentStatus || 'UNPAID',
  });
  store.upsert('addOnRequests', request);
  ok(res, { request, disclaimer: DISCLAIMER });
});

// Client view of their add-ons: request statuses + APPROVED add-on content (projected). An
// un-approved add-on is NEVER returned as content — only its lifecycle status.
app.get('/api/client/:id/add-ons', (req, res) => {
  const cid = req.params.id;
  if (!store.get('clients', cid)) return fail(res, 404, 'Client not found');
  const requests = store.list('addOnRequests').filter((r) => r.clientId === cid)
    .map((r) => ({ id: r.id, requestType: r.requestType, tier: r.tier, status: r.status, paymentStatus: r.paymentStatus, feeLabel: r.feeLabel, createdAt: r.createdAt }));
  const approved = ADDON.clientVisibleAddOns(store.list('addOnDrafts'), cid);
  ok(res, { clientId: cid, requests, approved, tiers: ADDON.ADDON_TIERS, types: ADDON.ADDON_TYPES, disclaimer: DISCLAIMER });
});

// Practitioner add-on queue: requests for THIS practitioner's clients (derived via
// clientId → practitionerId), each joined to its client name + generated draft. Practitioner/admin only.
app.get('/api/practitioner/:id/add-ons', (req, res) => {
  const pid = req.params.id;
  if (String(req.query.role || 'PRACTITIONER').toUpperCase() === 'CLIENT') return fail(res, 403, 'Clients cannot view the practitioner add-on queue.');
  if (!store.get('practitioners', pid)) return fail(res, 404, 'Practitioner not found');
  const ownClientIds = new Set(store.list('clients').filter((c) => c.practitionerId === pid).map((c) => c.id));
  const drafts = store.list('addOnDrafts');
  const requests = store.list('addOnRequests').filter((r) => ownClientIds.has(r.clientId)).map((r) => ({
    ...r,
    clientName: (store.get('clients', r.clientId) || {}).name || null,
    draft: r.draftId ? (drafts.find((d) => d.id === r.draftId) || null) : null,
  }));
  ok(res, { practitionerId: pid, requests });
});

// Confirm an add-on fee (practitioner/admin only). There is NO payment processor — this only
// sets paymentStatus to PAID | MANUALLY_APPROVED so the request can be generated. A client
// cannot approve their own fee.
app.post('/api/add-ons/:id/payment', (req, res) => {
  const body = req.body || {};
  if (String(body.role || 'PRACTITIONER').toUpperCase() === 'CLIENT') return fail(res, 403, 'A client cannot approve an add-on fee.');
  const request = store.get('addOnRequests', req.params.id);
  if (!request) return fail(res, 404, 'Add-on request not found');
  const status = String(body.paymentStatus || 'MANUALLY_APPROVED').toUpperCase();
  if (!ADDON.PAYMENT_OK.includes(status)) return fail(res, 400, 'paymentStatus must be PAID or MANUALLY_APPROVED.');
  request.paymentStatus = status;
  request.updatedAt = new Date().toISOString();
  store.upsert('addOnRequests', request);
  ok(res, { request });
});

// Generate a draft for a PAID/MANUALLY_APPROVED request (practitioner/admin only). Composes an
// honest add-on draft via the real engines: a meal plan (meals.js — macros CURATED_ESTIMATE /
// target ESTIMATED / SOURCE_PENDING) or a supplement plan (supplements.js — from confirmed labs,
// else PENDING_LABS). Nothing is fabricated.
app.post('/api/add-ons/:id/generate', (req, res) => {
  if (String((req.body && req.body.role) || 'PRACTITIONER').toUpperCase() === 'CLIENT') return fail(res, 403, 'A client cannot generate an add-on draft.');
  const request = store.get('addOnRequests', req.params.id);
  if (!request) return fail(res, 404, 'Add-on request not found');
  const payGate = ADDON.addonGenerationGate(request);
  if (!payGate.ok) return fail(res, 402, payGate.reason);
  const client = store.get('clients', request.clientId);
  const slip = nutritionSlipForClient(request.clientId, 'PRACTITIONER');
  const draft = ADDON.composeAddOnDraft({ request, client, nutritionSlip: slip, protocolProducts: (client && client.currentProducts) || [] });
  if (draft.languageOk === false) return fail(res, 500, 'Generated add-on failed the medical-language gate — withheld.');
  draft.status = 'PROVIDER_REVIEW';       // ready for the practitioner; never client-visible
  store.upsert('addOnDrafts', draft);
  request.status = 'PROVIDER_REVIEW';
  request.draftId = draft.id;
  request.updatedAt = new Date().toISOString();
  store.upsert('addOnRequests', request);
  ok(res, { draft, request, disclaimer: DISCLAIMER });
});

// Review an add-on draft (practitioner/admin only). APPROVE → APPROVED_RESOURCE (client-visible)
// and requires practitioner attestation, exactly like a generated protocol; REQUEST_CHANGES keeps
// it practitioner-only. A client/self-intake actor is blocked from approving here.
app.post('/api/add-ons/:id/review', (req, res) => {
  const body = req.body || {};
  const approvalGate = ACC.selfIntakeApprovalGate(String(body.role || 'PRACTITIONER').toUpperCase());
  if (!approvalGate.ok) return fail(res, 403, approvalGate.reason);
  const draft = store.get('addOnDrafts', req.params.id);
  if (!draft) return fail(res, 404, 'Add-on draft not found');
  const reviewer = body.reviewedBy || 'Dr. Vincent Lun';
  const decision = String(body.decision || '').toUpperCase();
  if (!decision) return fail(res, 400, 'A review decision is required.');
  if (decision === 'APPROVE' || decision === 'APPROVED') {
    // OPEN_MODE auto-satisfies the attestation PROMPT (parity with the protocol review path) so a
    // tester can APPROVE an add-on without first signing it. selfIntakeApprovalGate above STILL
    // blocks a CLIENT from approving — only the 428 attestation prompt is removed, not the actor gate.
    const openMode = isOpenMode();
    const att = GEN.practitionerAttestationGate(openMode
      ? { qualifiedPeptideLiterate: true, reviewedBasis: true, practitionerName: (body.attestation && body.attestation.practitionerName) || reviewer }
      : { ...(body.attestation || {}), practitionerName: (body.attestation && body.attestation.practitionerName) || reviewer });
    if (!openMode && !att.ok) return fail(res, 428, 'Practitioner attestation required to approve an add-on: ' + att.reasons.join(' '));
    store.upsert('genEvents', { id: M.uid('att'), kind: 'ADDON_ATTESTATION', draftId: draft.id, clientId: draft.clientId, openModeOverride: openMode, ...att.attestation });
  }
  const verdict = G.reviewDecisionGate(decision);
  draft.status = verdict.status;
  draft.reviewedBy = reviewer;
  draft.reviewedAt = new Date().toISOString();
  store.upsert('addOnDrafts', draft);
  const request = draft.requestId ? store.get('addOnRequests', draft.requestId) : null;
  if (request) {
    request.status = verdict.status;
    request.updatedAt = new Date().toISOString();
    store.upsert('addOnRequests', request);
  }
  ok(res, { draft, clientVisible: verdict.clientVisible, request: request || null });
});

// ===========================================================================
// PROTOCOL LOCK-IN — accept an approved protocol as the single CURRENT one.
// "When a client accepts a protocol it locks in as CURRENT until the next round." Lifecycle
// axis only — the locked and any superseded protocol both stay APPROVED_RESOURCE.
// ===========================================================================
app.post('/api/protocol/drafts/:id/lock-current', (req, res) => {
  const body = req.body || {};
  const role = String(body.role || 'PRACTITIONER').toUpperCase();
  const draft = store.get('drafts', req.params.id);
  if (!draft) return fail(res, 404, 'Protocol not found');
  if (role === 'CLIENT' && body.clientId && draft.clientId !== body.clientId) {
    return fail(res, 403, 'A client can only accept their own protocol.');
  }
  const gate = G.protocolLockGate(draft);
  if (!gate.ok) return fail(res, 409, gate.reason);
  const result = G.lockProtocolAsCurrent(store.list('drafts'), draft.id);
  if (!result.ok) return fail(res, 409, result.reason);
  for (const d of result.drafts) {
    if (d.id === result.lockedId || result.supersededIds.includes(d.id)) store.upsert('drafts', d);
  }
  const protocols = G.clientVisibleProtocols(store.list('drafts'), draft.clientId);
  const { current, past } = G.splitProtocolsByLifecycle(protocols);
  ok(res, { lockedId: result.lockedId, supersededIds: result.supersededIds, current, past, disclaimer: DISCLAIMER });
});

// ===========================================================================
// RESEARCH SOURCE REGISTRY — the honest LIVE/STUB/PLANNED catalogue (Phase E)
// ===========================================================================
app.get('/api/research/sources', (_req, res) => {
  ok(res, { sources: RSRC.researchSourceRegistry(), summary: RSRC.registrySummary() });
});

// Subscription plan catalog (display only — the app processes no payments; entitlement is the
// operational lever). Platform/admin surface.
app.get('/api/plans', (_req, res) => ok(res, { plans: ACC.SUBSCRIPTION_TIERS }));

// ===========================================================================
// ADMIN
// ===========================================================================
app.get('/api/admin/overview', (_req, res) => {
  const practitioners = store.list('practitioners');
  const clients = store.list('clients');
  const drafts = store.list('drafts');
  const addOnDrafts = store.list('addOnDrafts');
  const addOnRequests = store.list('addOnRequests');
  const entitlements = store.list('entitlements');
  const planByKey = Object.fromEntries(ACC.SUBSCRIPTION_TIERS.map((p) => [p.key, p]));

  const ownerIds = new Set(practitioners.filter((p) => p.practitionerType === 'OWNER').map((p) => p.id));
  const directClients = clients.filter((c) => ownerIds.has(c.practitionerId));
  const providerClients = clients.filter((c) => c.practitionerId && !ownerIds.has(c.practitionerId));

  const draftsByStatus = drafts.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {});
  const paidStatuses = new Set(['PAID', 'MANUALLY_APPROVED', 'INCLUDED_CREDIT']);

  // Demo fee totals — DISPLAY ONLY, no payment processor.
  const mrr = entitlements.reduce((sum, e) => sum + ((planByKey[e.planKey] || {}).monthlyFee || 0), 0);
  const overageRevenue = entitlements.reduce((sum, e) => {
    const plan = planByKey[e.planKey] || {};
    const over = plan.includedProtocolCredits == null ? 0 : Math.max(0, (e.usedThisMonth || 0) - plan.includedProtocolCredits);
    return sum + over * (plan.perProtocolFee || 0);
  }, 0);
  const addOnRevenue = addOnRequests
    .filter((r) => paidStatuses.has(r.paymentStatus) && r.paymentStatus !== 'INCLUDED_CREDIT')
    .reduce((sum, r) => {
      const ent = entitlements.find((e) => e.clientId === r.clientId);
      const plan = planByKey[(ent || {}).planKey] || planByKey.free;
      return sum + (ACC.addOnFeeFor(plan, r.requestType) || 0);
    }, 0);

  const perPractitioner = practitioners.map((p) => {
    const myIds = new Set(clients.filter((c) => c.practitionerId === p.id).map((c) => c.id));
    const myDrafts = drafts.filter((d) => myIds.has(d.clientId));
    const myAddOns = addOnDrafts.filter((d) => myIds.has(d.clientId));
    return {
      id: p.id, name: p.name, discipline: p.discipline,
      practitionerType: p.practitionerType || 'PRACTITIONER',
      accessStatus: p.accessStatus || 'ACTIVE',
      planLevel: p.planLevel || 'free',
      portalAccessEnabled: p.portalAccessEnabled !== false,
      directClientOwner: !!p.directClientOwner,
      clientCount: myIds.size,
      generatedCount: myDrafts.length,
      pendingReviews: myDrafts.filter((d) => d.status !== 'APPROVED_RESOURCE' && !d.blocked).length,
      approvedCount: myDrafts.filter((d) => d.status === 'APPROVED_RESOURCE').length,
      // Per-provider module usage (derived from the same store reads — no fabricated number).
      supplementPlans: myAddOns.filter((d) => d.addOnType === 'SUPPLEMENT_PLAN').length,
      mealPlans: myAddOns.filter((d) => d.addOnType === 'MEAL_PLAN').length,
    };
  });

  // Referral activity (SCAFFOLD) — the inter-industry network roster + demo handshake records.
  // Counts only; the transport (send / accept / fee) is not wired (see docs/REFERRAL-SYSTEM.md).
  const referralRecords = referralNet.listReferralsForClient();
  const referralByStatus = referralRecords.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const referralActivity = {
    scaffold: true,
    networkSize: referralNet.REFERRAL_NETWORK.length,
    acceptingReferrals: referralNet.filterNetwork({}).length,
    services: referralNet.REFERRAL_SERVICES.length,
    records: referralRecords.length,
    accepted: referralByStatus.ACCEPTED || 0,
    pending: referralByStatus.PENDING || 0,
    declined: referralByStatus.DECLINED || 0,
    handshakes: referralRecords.filter((r) => r.handshake).length,
    statuses: referralNet.REFERRAL_STATUSES,
  };

  ok(res, {
    counts: {
      clients: clients.length,
      practitioners: practitioners.length,
      directClients: directClients.length,
      providerClients: providerClients.length,
      protocolsGenerated: drafts.length,
      peptideProtocols: drafts.length,
      supplementPlans: addOnDrafts.filter((d) => d.addOnType === 'SUPPLEMENT_PLAN').length,
      mealPlans: addOnDrafts.filter((d) => d.addOnType === 'MEAL_PLAN').length,
      draftsAwaiting: drafts.filter((d) => d.status !== 'APPROVED_RESOURCE' && !d.blocked).length,
      approvedResources: drafts.filter((d) => d.status === 'APPROVED_RESOURCE').length,
      approvedAddOns: addOnDrafts.filter((d) => d.status === 'APPROVED_RESOURCE').length,
      paidAddOnRequests: addOnRequests.filter((r) => paidStatuses.has(r.paymentStatus)).length,
      unpaidAddOnRequests: addOnRequests.filter((r) => r.paymentStatus === 'UNPAID').length,
      monthlyProtocolUsage: entitlements.reduce((n, e) => n + (e.usedThisMonth || 0), 0),
    },
    fees: { mrr, overageRevenue, addOnRevenue, total: mrr + overageRevenue + addOnRevenue, currency: 'USD', note: 'Demo figures — no payment processor wired.' },
    draftsByStatus,
    perPractitioner,
    referrals: referralActivity,
    // Real platform-wide monthly sparkline series for the command-center KPI strip (omit-or-real).
    activity: activitySeries({ clientIds: null }),
    demo: G.demoDataGate(demo),
    disclaimer: DISCLAIMER,
  });
});

// Admin: direct-to-client profiles — clients owned by an OWNER (Vitalis-owned) practitioner,
// never orphan/global. Returns the owner profiles + their direct clients.
app.get('/api/admin/direct-clients', (_req, res) => {
  const owners = store.list('practitioners').filter((p) => p.practitionerType === 'OWNER');
  const ownerIds = new Set(owners.map((p) => p.id));
  const clients = store.list('clients').filter((c) => ownerIds.has(c.practitionerId)).map((c) => ({
    ...c, ownerName: (store.get('practitioners', c.practitionerId) || {}).name || null,
  }));
  ok(res, { owners, clients });
});

app.post('/api/admin/reset-demo', (_req, res) => { store.resetDemo(); ok(res, { reset: true }); });

// ===========================================================================
// VERTICAL DOCUMENTS — render existing engine output as a Vitalis clinical dossier.
// The SERVER runs the adapter (Research Source Doctrine labeling); the browser only renders.
// PEPTIDE is live; other silos return an honest 501 until their adapters land. A CLIENT may
// only ever receive an APPROVED document — a draft can never reach the portal (defense-in-depth).
// ===========================================================================
app.get('/api/documents/:silo/:id', (req, res) => {
  const silo = String(req.params.silo || '').toUpperCase();
  const role = req.query.role || 'PRACTITIONER';
  const isClient = String(role).toUpperCase() === 'CLIENT';
  // THE one client-visibility rule, reused across every silo (no parallel gate): a client may
  // only ever receive a source whose status === 'APPROVED_RESOURCE'. A draft can never leak.
  const approvalGuard = (status) => isClient && status !== 'APPROVED_RESOURCE';

  if (silo === 'PEPTIDE') {
    const draft = store.get('drafts', req.params.id);
    if (!draft) return fail(res, 404, 'Draft not found.');
    if (approvalGuard(draft.status)) return fail(res, 403, 'Not approved for client view.');
    const client = draft.clientId ? store.get('clients', draft.clientId) : null;
    return ok(res, { silo, document: DOC.toPeptideDocProps(draft, { role, client }) });
  }

  // SUPPLEMENT / MEAL — the gated paid add-on DRAFTs (addOnDrafts). They already ride the same
  // approval lifecycle as a protocol, so the SAME guard applies; the adapter reshapes draft.plan.
  if (silo === 'SUPPLEMENT' || silo === 'MEAL') {
    const wantType = silo === 'SUPPLEMENT' ? 'SUPPLEMENT_PLAN' : 'MEAL_PLAN';
    const draft = store.get('addOnDrafts', req.params.id);
    if (!draft || draft.addOnType !== wantType) return fail(res, 404, 'Add-on draft not found.');
    if (approvalGuard(draft.status)) return fail(res, 403, 'Not approved for client view.');
    if (!draft.plan) return fail(res, 422, 'Add-on draft has no generated plan to render.');
    const client = draft.clientId ? store.get('clients', draft.clientId) : null;
    // Thread the client's REAL recorded draws into the supplement adapter so the research mini-dossier
    // derives Lab+Lifestyle Findings + baseline-vs-latest deltas from actual flagged markers (the
    // adapter runs the same gates.labResultFlagGate; no clinical logic added here). Read-only.
    const labResults = (silo === 'SUPPLEMENT' && draft.clientId)
      ? store.list('labResults').filter((r) => r.clientId === draft.clientId)
      : [];
    const document = silo === 'SUPPLEMENT'
      ? VDOC.toSupplementDocProps({ ...draft.plan, status: draft.status }, { role, client, labResults })
      : VDOC.toMealDocProps({ ...draft.plan, status: draft.status }, { role, client });
    return ok(res, { silo, document });
  }

  // NUTRITION — the lab-driven naturopath request slip, keyed by clientId (:id). The slip is a
  // standalone DRAFT (it is not independently approval-gated), so the SAME guard 403s a client —
  // a draft never leaks. A practitioner sees the live slip.
  if (silo === 'NUTRITION') {
    const client = store.get('clients', req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');
    const slip = nutritionSlipForClient(client.id, role);
    if (!slip) return fail(res, 404, 'No confirmed lab results for this client — nothing to render (PENDING_LABS).');
    if (approvalGuard(slip.status)) return fail(res, 403, 'Not approved for client view.');
    return ok(res, { silo, document: VDOC.toNutritionDocProps(slip, { role, client }) });
  }

  // BLOOD_REQ — the "bloodwork to order" requisition for a protocol DRAFT (:id). Same gated
  // protocol spine + same guard; the adapter reads the protocol's products + labsSuggested and
  // layers Dr. Lun's baseline + the sourced PEPTIDE_ADDITIONS cadence (never invented).
  if (silo === 'BLOOD_REQ') {
    const draft = store.get('drafts', req.params.id);
    if (!draft) return fail(res, 404, 'Protocol draft not found.');
    if (approvalGuard(draft.status)) return fail(res, 403, 'Not approved for client view.');
    const client = draft.clientId ? store.get('clients', draft.clientId) : null;
    const source = {
      products: (draft.items || []).map((it) => it.productName).filter(Boolean),
      labsSuggested: draft.labsSuggested || [],
      status: draft.status,
      forClient: (client && client.name) || draft.forClient || null,
      scenarioId: req.query.scenarioId || null,
    };
    return ok(res, { silo, document: VDOC.toBloodRequisitionDocProps(source, { role, client }) });
  }

  return fail(res, 501, `Document vertical "${silo}" is not yet implemented.`);
});

// ===========================================================================
// ORDER OPS — internal operator order management (SIMULATION / RESEARCH ONLY)
// No live SMS/Telegram transport. Invoice text, sms: links, and Telegram share
// URLs are generated for copy/paste only. No medical advice surfaced here.
// ===========================================================================
const OPS_BANNER = 'This is a simulation, for Research purposes. Not actual representation.';
const OPS_BRAND  = 'Vitalis Research';

// --- helpers ---------------------------------------------------------------
function opsUid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function calcOrderTotals(items, creditApplied = 0) {
  const subtotal    = items.reduce((s, it) => s + (it.lineTotal || 0), 0);
  const costTotal   = items.reduce((s, it) => s + (it.lineCost  || 0), 0);
  const total       = Math.max(0, subtotal - creditApplied);
  const grossProfit = total - costTotal;
  const marginPct   = total > 0 ? +((grossProfit / total) * 100).toFixed(1) : 0;
  return { subtotal, costTotal, total, grossProfit, marginPct };
}

function nextInvoiceNumber() {
  const orders = store.list('opsOrders');
  const nums = orders
    .map((o) => parseInt((o.invoiceNumber || '').replace('VIT-', ''), 10))
    .filter((n) => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `VIT-${String(next).padStart(4, '0')}`;
}

function inventoryFor(productId) {
  return store.list('opsInventory').find((iv) => iv.productId === productId) || null;
}

function decrementInventory(productId, qty, reason, orderId = null) {
  const iv = inventoryFor(productId);
  if (!iv) return;
  iv.onHand = Math.max(0, (iv.onHand || 0) - qty);
  iv.updatedAt = new Date().toISOString();
  store.upsert('opsInventory', iv);
  store.upsert('opsInventoryMovements', {
    id: opsUid('mov'), productId, type: 'SALE', qty: -qty,
    reason, orderId, supplierOrderId: null, createdAt: new Date().toISOString(),
  });
}

function referralAccountFor(customerId) {
  return store.list('opsReferralAccounts').find((r) => r.customerId === customerId) || null;
}

function buildInvoicePlainText(order, customer) {
  const lines = (order.items || [])
    .map((it) => `  ${it.name} x${it.qty}  @$${it.price}  = $${it.lineTotal.toFixed(2)}`)
    .join('\n');
  return [
    OPS_BANNER,
    '',
    OPS_BRAND + ' — INVOICE',
    `Invoice #: ${order.invoiceNumber}`,
    `Date:      ${(order.createdAt || '').slice(0, 10)}`,
    `Customer:  ${customer ? customer.name : (order.customerName || 'Unknown')}`,
    '',
    'Items:',
    lines,
    '',
    `Subtotal:   $${(order.subtotal || 0).toFixed(2)}`,
    order.accountCreditApplied ? `Credit:    -$${(order.accountCreditApplied || 0).toFixed(2)}` : null,
    `Total:      $${(order.total || 0).toFixed(2)}`,
    `Paid:       $${(order.amountPaid || 0).toFixed(2)}`,
    `Balance:    $${(order.balanceDue || 0).toFixed(2)}`,
    '',
    OPS_BANNER,
  ].filter((l) => l !== null).join('\n');
}

// MTD/YTD helpers
function salesStats(orders) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const yr = `${now.getFullYear()}`;
  let mtdSales = 0, ytdSales = 0, mtdCost = 0, ytdCost = 0;
  for (const o of orders) {
    const d = (o.createdAt || '').slice(0, 7);
    if (d === ym) { mtdSales += o.total || 0; mtdCost += o.costTotal || 0; }
    if ((o.createdAt || '').startsWith(yr)) { ytdSales += o.total || 0; ytdCost += o.costTotal || 0; }
  }
  return { mtdSales, ytdSales, mtdCost, ytdCost, mtdProfit: mtdSales - mtdCost, ytdProfit: ytdSales - ytdCost };
}

// --- Internal-only access guard for EVERY /api/ops/* route ------------------
// Order Ops surfaces internal economics (cost / marginPct / grossProfit), supplier balances,
// and customer/order data. It is operator/admin-only. The role signal REUSES the app-wide
// convention (CAT.normalizeRole): an explicit ADMIN via the `x-vitalis-role` header (preferred),
// or a `role` query param / body field. Anything that does NOT normalize to ADMIN — including the
// absent/default case — is 403'd here, ONCE, before any handler runs, so no individual ops route
// can leak. CLIENT and PRACTITIONER never reach an ops handler. This is access protection only;
// the authorized-operator behavior of every route below is unchanged.
function opsInternalGuard(req, res, next) {
  const signal = req.get('x-vitalis-role') || req.query.role || (req.body && req.body.role) || null;
  if (CAT.normalizeRole(signal) !== 'ADMIN') {
    return res.status(403).json({ ok: false, error: 'Order Ops is internal/operator-only (admin access required).', banner: OPS_BANNER });
  }
  return next();
}
app.use('/api/ops', opsInternalGuard);

// --- GET /api/ops/catalog --------------------------------------------------
// Normalized catalog products with inventory overlaid
app.get('/api/ops/catalog', (_req, res) => {
  const invMap = {};
  for (const iv of store.list('opsInventory')) invMap[iv.productId] = iv;
  const LOW_STOCK_THRESHOLD = 2;

  const products = catalog.products
    .filter((p) => p.availability !== 'UNAVAILABLE')
    .map((p) => {
      const iv = invMap[p.id] || null;
      const onHand = iv ? (iv.onHand || 0) : 0;
      return {
        id: p.id, sku: p.sku, name: p.name || p.displayName, displayName: p.displayName,
        supplier: p.supplier || p.provider || null, category: p.category || null,
        msrp: p.msrp || p.boxPrice || 0, cost: p.cost || 0, price: p.msrp || p.boxPrice || 0,
        onHand, lowStock: onHand <= LOW_STOCK_THRESHOLD,
        availability: p.availability, status: p.status,
      };
    });
  ok(res, { products, banner: OPS_BANNER });
});

// --- GET /api/ops/dashboard ------------------------------------------------
app.get('/api/ops/dashboard', (_req, res) => {
  const orders       = store.list('opsOrders');
  const inventory    = store.list('opsInventory');
  const supplierOrds = store.list('opsSupplierOrders');
  const refAccounts  = store.list('opsReferralAccounts');

  const stats = salesStats(orders);
  const mtdMargin = stats.mtdSales > 0 ? +((stats.mtdProfit / stats.mtdSales) * 100).toFixed(1) : 0;
  const ytdMargin = stats.ytdSales > 0 ? +((stats.ytdProfit / stats.ytdSales) * 100).toFixed(1) : 0;

  const unpaidOrders   = orders.filter((o) => o.paymentStatus === 'UNPAID');
  const partialOrders  = orders.filter((o) => o.paymentStatus === 'PARTIAL');
  const receivables    = {
    unpaidCount: unpaidOrders.length,
    unpaidValue: unpaidOrders.reduce((s, o) => s + (o.balanceDue || 0), 0),
    partialCount: partialOrders.length,
    partialValue: partialOrders.reduce((s, o) => s + (o.balanceDue || 0), 0),
  };

  const LOW = 2;
  const lowStockItems  = inventory.filter((iv) => (iv.onHand || 0) <= LOW);
  const invUnits       = inventory.reduce((s, iv) => s + (iv.onHand || 0), 0);
  // Canonical catalog cost + MSRP per product for valuation (msrp falls back to boxPrice).
  const catMap = {};
  for (const p of catalog.products) catMap[p.id] = { cost: p.cost || 0, msrp: p.msrp || p.boxPrice || 0 };
  const invValue       = inventory.reduce((s, iv) => s + (iv.onHand || 0) * ((catMap[iv.productId] || {}).cost || 0), 0);

  // --- Inventory valuation — ACTIVE stock only (onHand > 0); zero-stock products excluded. ---
  // Valued at the canonical catalog MSRP (sell) and cost (buy); projected profit/margin is what the
  // current on-hand stock would yield IF it all sold at MSRP. Simulation figures, not a forecast.
  const activeInv = inventory.filter((iv) => (iv.onHand || 0) > 0);
  const sumValue = (items, key) => +items.reduce((s, iv) => s + (iv.onHand || 0) * ((catMap[iv.productId] || {})[key] || 0), 0).toFixed(2);
  const unitsOnHand = activeInv.reduce((s, iv) => s + (iv.onHand || 0), 0);
  const valueAtCost = sumValue(activeInv, 'cost');
  const valueAtMsrp = sumValue(activeInv, 'msrp');
  const projectedGrossProfit = +(valueAtMsrp - valueAtCost).toFixed(2);
  const projectedMarginPct = valueAtMsrp > 0 ? +((projectedGrossProfit / valueAtMsrp) * 100).toFixed(1) : 0;
  const lowActive = activeInv.filter((iv) => (iv.onHand || 0) <= LOW);
  const lowStockValueAtCost = sumValue(lowActive, 'cost');
  const lowStockValueAtMsrp = sumValue(lowActive, 'msrp');

  const supplierBalances = supplierOrds
    .filter((so) => (so.balanceDue || 0) > 0)
    .reduce((s, so) => s + (so.balanceDue || 0), 0);

  const referralLiability = refAccounts.reduce((s, r) => s + (r.creditBalance || 0), 0);

  const recentOrders = [...orders]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);

  ok(res, {
    mtdSales: stats.mtdSales, ytdSales: stats.ytdSales,
    mtdCost: stats.mtdCost, ytdCost: stats.ytdCost,
    mtdProfit: stats.mtdProfit, ytdProfit: stats.ytdProfit,
    mtdMargin, ytdMargin,
    receivables,
    inventory: {
      units: invUnits, value: invValue, lowStockCount: lowStockItems.length, lowStockList: lowStockItems,
      // Valuation (active stock onHand > 0; canonical catalog MSRP/cost).
      unitsOnHand, valueAtMsrp, valueAtCost, projectedGrossProfit, projectedMarginPct,
      lowStockValueAtMsrp, lowStockValueAtCost,
    },
    supplierBalances,
    referralLiability,
    recentOrders,
    banner: OPS_BANNER,
  });
});

// --- GET /api/ops/customers, POST /api/ops/customers ----------------------
app.get('/api/ops/customers', (_req, res) => {
  ok(res, { customers: store.list('opsCustomers'), banner: OPS_BANNER });
});

app.post('/api/ops/customers', (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return fail(res, 400, 'Customer name is required.');
  // Upsert by email when provided
  const existing = body.email
    ? store.list('opsCustomers').find((c) => c.email === body.email.trim())
    : null;
  const customer = existing
    ? { ...existing, name, phone: body.phone || existing.phone, notes: body.notes || existing.notes }
    : {
        id: opsUid('cust'), name,
        email: body.email ? body.email.trim() : null,
        phone: body.phone ? body.phone.trim() : null,
        notes: body.notes || '',
        totalSpend: 0, orderCount: 0, creditBalance: 0,
        createdAt: new Date().toISOString(),
      };
  store.upsert('opsCustomers', customer);
  ok(res, { customer, banner: OPS_BANNER });
});

// --- GET /api/ops/customers/:id — customer detail: profile + their orders + referral acct/ledger -
app.get('/api/ops/customers/:id', (req, res) => {
  const customer = store.get('opsCustomers', req.params.id);
  if (!customer) return fail(res, 404, 'Customer not found');
  const orders = store.list('opsOrders')
    .filter((o) => o.customerId === customer.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const referralAccount = store.list('opsReferralAccounts').find((r) => r.customerId === customer.id) || null;
  const ledger = referralAccount
    ? store.list('opsReferralLedger')
        .filter((l) => l.referralAccountId === referralAccount.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    : [];
  ok(res, { customer, orders, referralAccount, ledger, banner: OPS_BANNER });
});

// --- GET /api/ops/orders, GET /api/ops/orders/:id, POST /api/ops/orders ---
app.get('/api/ops/orders', (_req, res) => {
  ok(res, { orders: store.list('opsOrders'), banner: OPS_BANNER });
});

app.get('/api/ops/orders/:id', (req, res) => {
  const o = store.get('opsOrders', req.params.id);
  return o ? ok(res, { order: o, banner: OPS_BANNER }) : fail(res, 404, 'Order not found');
});

app.post('/api/ops/orders', (req, res) => {
  const body = req.body || {};
  const customerId = String(body.customerId || '').trim();
  if (!customerId) return fail(res, 400, 'customerId is required.');
  const customer = store.get('opsCustomers', customerId);
  if (!customer) return fail(res, 404, 'Customer not found.');

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return fail(res, 400, 'At least one item is required.');

  // Enrich items from catalog
  const items = rawItems.map((it) => {
    const prod = catalogIndex.byId[it.productId] || null;
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const price = parseFloat(it.price) || (prod ? (prod.msrp || prod.boxPrice || 0) : 0);
    const cost  = parseFloat(it.cost)  || (prod ? (prod.cost  || 0) : 0);
    return {
      productId: it.productId, sku: prod ? prod.sku : (it.sku || ''),
      name: prod ? (prod.name || prod.displayName) : (it.name || ''),
      qty, price, cost,
      lineTotal:  +(qty * price).toFixed(2),
      lineCost:   +(qty * cost).toFixed(2),
      lineProfit: +(qty * (price - cost)).toFixed(2),
    };
  });

  const paymentStatus  = ['PAID','PARTIAL','UNPAID'].includes(body.paymentStatus) ? body.paymentStatus : 'UNPAID';
  const amountPaid     = parseFloat(body.amountPaid)     || 0;

  // Auto-apply referral/account credit
  let refAccount = referralAccountFor(customerId);
  let creditApplied = 0;
  if (refAccount && refAccount.creditBalance > 0) {
    const tots0 = calcOrderTotals(items, 0);
    creditApplied = Math.min(refAccount.creditBalance, tots0.total);
  }
  // Override with explicit request
  if (typeof body.accountCreditApplied === 'number') {
    creditApplied = parseFloat(body.accountCreditApplied) || 0;
  }

  const { subtotal, costTotal, total, grossProfit, marginPct } = calcOrderTotals(items, creditApplied);
  const balanceDue = Math.max(0, total - amountPaid);
  const finalPayStatus = balanceDue <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : paymentStatus;

  const invoiceNumber = nextInvoiceNumber();
  const now = new Date().toISOString();
  const order = {
    id: opsUid('ord'), invoiceNumber,
    customerId, customerName: customer.name,
    items, subtotal, accountCreditApplied: creditApplied,
    total, amountPaid, balanceDue,
    costTotal, grossProfit, marginPct,
    paymentStatus: finalPayStatus,
    invoiceStatus: 'DRAFT',
    createdAt: now, updatedAt: now,
  };
  store.upsert('opsOrders', order);

  // Decrement inventory for each item
  for (const it of items) {
    decrementInventory(it.productId, it.qty, `Order ${invoiceNumber}`, order.id);
  }

  // Deduct applied credit from referral account
  if (creditApplied > 0 && refAccount) {
    refAccount.creditBalance = Math.max(0, refAccount.creditBalance - creditApplied);
    refAccount.totalRedeemed = (refAccount.totalRedeemed || 0) + creditApplied;
    store.upsert('opsReferralAccounts', refAccount);
    store.upsert('opsReferralLedger', {
      id: opsUid('rled'), referralAccountId: refAccount.id,
      type: 'DEBIT', amount: creditApplied,
      reason: `Credit applied to Order ${invoiceNumber}`, orderId: order.id,
      createdAt: now,
    });
  }

  // Credit a referral account for another customer if requested
  if (body.referralCreditForCustomerId && body.referralCreditAmount > 0) {
    let refAcct = referralAccountFor(body.referralCreditForCustomerId);
    const refCust = store.get('opsCustomers', body.referralCreditForCustomerId);
    if (!refAcct && refCust) {
      refAcct = {
        id: opsUid('ref'), customerId: refCust.id,
        customerName: refCust.name, creditBalance: 0,
        totalEarned: 0, totalRedeemed: 0, createdAt: now,
      };
    }
    if (refAcct) {
      const amt = parseFloat(body.referralCreditAmount);
      refAcct.creditBalance  = (refAcct.creditBalance  || 0) + amt;
      refAcct.totalEarned    = (refAcct.totalEarned    || 0) + amt;
      store.upsert('opsReferralAccounts', refAcct);
      store.upsert('opsReferralLedger', {
        id: opsUid('rled'), referralAccountId: refAcct.id,
        type: 'CREDIT', amount: amt,
        reason: `Referral credit from Order ${invoiceNumber}`, orderId: order.id,
        createdAt: now,
      });
    }
  }

  // Update customer stats
  customer.orderCount = (customer.orderCount || 0) + 1;
  customer.totalSpend = (customer.totalSpend || 0) + total;
  if (creditApplied > 0) customer.creditBalance = Math.max(0, (customer.creditBalance || 0) - creditApplied);
  store.upsert('opsCustomers', customer);

  ok(res, { order, banner: OPS_BANNER });
});

// --- PATCH /api/ops/orders/:id/payment ------------------------------------
app.patch('/api/ops/orders/:id/payment', (req, res) => {
  const order = store.get('opsOrders', req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  const body = req.body || {};
  const amountPaid = parseFloat(body.amountPaid) != null && !isNaN(parseFloat(body.amountPaid))
    ? parseFloat(body.amountPaid) : order.amountPaid;
  const balanceDue = Math.max(0, (order.total || 0) - amountPaid);
  const paymentStatus = balanceDue <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'UNPAID';
  const invoiceStatus = paymentStatus === 'PAID' ? 'PAID' : order.invoiceStatus;
  Object.assign(order, { amountPaid, balanceDue, paymentStatus, invoiceStatus, updatedAt: new Date().toISOString() });
  store.upsert('opsOrders', order);
  ok(res, { order, banner: OPS_BANNER });
});

// --- PATCH /api/ops/orders/:id — order detail + lifecycle ------------------
// invoiceStatus is the workflow axis (DRAFT | SENT | PAID | VOID); paymentStatus is the money
// axis, derived from amountPaid. Items are editable ONLY while DRAFT — return to DRAFT first to
// edit a SENT/PAID order. Editing items recalculates totals from the canonical catalog and
// reconciles inventory (decrement the additional qty, restock the reduced qty) with movement rows.
const OPS_INVOICE_STATES = ['DRAFT', 'SENT', 'PAID', 'VOID'];
app.patch('/api/ops/orders/:id', (req, res) => {
  const order = store.get('opsOrders', req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  const body = req.body || {};
  const now = new Date().toISOString();

  // --- items (DRAFT only) — validated against the canonical catalog, with inventory reconciliation
  if (Array.isArray(body.items)) {
    if (order.invoiceStatus !== 'DRAFT') {
      return fail(res, 409, 'Order items can only be edited while the invoice is DRAFT — return it to DRAFT first.');
    }
    const newItems = body.items.map((it) => {
      const prod = catalogIndex.byId[it.productId] || null;
      if (!prod) return null; // canonical catalog only — never an off-catalog product
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const price = parseFloat(it.price); const cost = parseFloat(it.cost);
      const finalPrice = isNaN(price) ? (prod.msrp || prod.boxPrice || 0) : price;
      const finalCost = isNaN(cost) ? (prod.cost || 0) : cost;
      return {
        productId: it.productId, sku: prod.sku, name: prod.name || prod.displayName,
        qty, price: finalPrice, cost: finalCost,
        lineTotal: +(qty * finalPrice).toFixed(2),
        lineCost: +(qty * finalCost).toFixed(2),
        lineProfit: +(qty * (finalPrice - finalCost)).toFixed(2),
      };
    }).filter(Boolean);
    if (!newItems.length) return fail(res, 400, 'At least one valid catalog item is required.');

    // Reconcile inventory by per-product qty delta (old vs new).
    const sumQty = (items) => items.reduce((m, it) => { m[it.productId] = (m[it.productId] || 0) + (it.qty || 0); return m; }, {});
    const oldQty = sumQty(order.items || []);
    const newQty = sumQty(newItems);
    for (const pid of new Set([...Object.keys(oldQty), ...Object.keys(newQty)])) {
      const delta = (newQty[pid] || 0) - (oldQty[pid] || 0);
      if (delta === 0) continue;
      const iv = inventoryFor(pid);
      if (iv) {
        iv.onHand = Math.max(0, (iv.onHand || 0) - delta); // delta>0 sells more (decrement); delta<0 restocks
        iv.updatedAt = now;
        store.upsert('opsInventory', iv);
      }
      store.upsert('opsInventoryMovements', {
        id: opsUid('mov'), productId: pid,
        type: delta > 0 ? 'SALE' : 'RESTOCK', qty: -delta,
        reason: `Order ${order.invoiceNumber} item edit`, orderId: order.id, supplierOrderId: null, createdAt: now,
      });
    }

    order.items = newItems;
    const t = calcOrderTotals(newItems, order.accountCreditApplied || 0);
    order.subtotal = t.subtotal; order.costTotal = t.costTotal; order.total = t.total;
    order.grossProfit = t.grossProfit; order.marginPct = t.marginPct;
  }

  // --- amountPaid → recompute balance + paymentStatus (money axis) ---
  if (body.amountPaid != null && !isNaN(parseFloat(body.amountPaid))) {
    order.amountPaid = Math.max(0, parseFloat(body.amountPaid));
  }
  order.balanceDue = Math.max(0, (order.total || 0) - (order.amountPaid || 0));
  order.paymentStatus = order.balanceDue <= 0 ? 'PAID' : (order.amountPaid || 0) > 0 ? 'PARTIAL' : 'UNPAID';

  // --- invoiceStatus (workflow axis) — explicit, independent of paymentStatus ---
  if (body.invoiceStatus != null) {
    const s = String(body.invoiceStatus).toUpperCase();
    if (!OPS_INVOICE_STATES.includes(s)) return fail(res, 400, `invoiceStatus must be one of ${OPS_INVOICE_STATES.join(', ')}.`);
    order.invoiceStatus = s;
  }

  if (body.notes != null) order.notes = String(body.notes);

  order.updatedAt = now;
  store.upsert('opsOrders', order);
  ok(res, { order, banner: OPS_BANNER });
});

// --- GET /api/ops/orders/:id/invoice --------------------------------------
app.get('/api/ops/orders/:id/invoice', (req, res) => {
  const order = store.get('opsOrders', req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  const customer = store.get('opsCustomers', order.customerId) || null;
  const plainText = buildInvoicePlainText(order, customer);
  const encodedText = encodeURIComponent(plainText);
  const phone = customer && customer.phone ? customer.phone.replace(/\D/g, '') : '';
  const smsUrl = phone ? `sms:+${phone}?&body=${encodedText}` : `sms:?body=${encodedText}`;
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(OPS_BRAND)}&text=${encodedText}`;
  ok(res, { order, customer, invoice: { plainText, smsUrl, telegramUrl }, banner: OPS_BANNER });
});

// --- GET /api/ops/inventory, POST /api/ops/inventory/adjust ---------------
app.get('/api/ops/inventory', (_req, res) => {
  const invMap = {};
  for (const iv of store.list('opsInventory')) invMap[iv.productId] = iv;
  const LOW = 2;
  const items = catalog.products
    .filter((p) => p.availability !== 'UNAVAILABLE')
    .map((p) => {
      const iv = invMap[p.id] || { productId: p.id, onHand: 0 };
      const onHand = iv.onHand || 0;
      const cost = p.cost || 0;
      const msrp = p.msrp || p.boxPrice || 0;
      const valueAtCost = +(onHand * cost).toFixed(2);
      const valueAtMsrp = +(onHand * msrp).toFixed(2);
      const projectedGrossProfit = +(valueAtMsrp - valueAtCost).toFixed(2);
      const projectedMarginPct = valueAtMsrp > 0 ? +((projectedGrossProfit / valueAtMsrp) * 100).toFixed(1) : 0;
      return {
        productId: p.id, sku: p.sku, name: p.name || p.displayName,
        supplier: p.supplier || p.provider,
        onHand,
        lowStock: onHand <= LOW,
        cost, msrp, valueAtCost, valueAtMsrp, projectedGrossProfit, projectedMarginPct,
      };
    });
  const movements = store.list('opsInventoryMovements');
  ok(res, { items, movements, banner: OPS_BANNER });
});

// --- GET /api/ops/reorder-suggestions -------------------------------------
// Low-stock reorder list. Source is the ACTIVELY-TRACKED inventory records (store opsInventory) —
// NOT the full catalog — so a sold-out tracked product (onHand 0) is included (it needs reordering)
// while the 100+ never-stocked catalog products are excluded. reorderPoint / target are simulation
// operational defaults (NOT economics); cost/MSRP come ONLY from the canonical catalog. Read-only:
// this suggests, it never creates a supplier order or mutates stock.
const REORDER_POINT = 3;   // onHand <= this → suggest a reorder
const REORDER_TARGET = 12; // restock back up to this level (suggested qty = target − onHand)
app.get('/api/ops/reorder-suggestions', (_req, res) => {
  const catMap = {};
  for (const p of catalog.products) {
    catMap[p.id] = { cost: p.cost || 0, msrp: p.msrp || p.boxPrice || 0, sku: p.sku, name: p.name || p.displayName, supplier: p.supplier || p.provider || null };
  }
  const items = store.list('opsInventory')
    .map((iv) => {
      const c = catMap[iv.productId] || {};
      const onHand = iv.onHand || 0;
      const suggestedReorderQty = Math.max(0, REORDER_TARGET - onHand);
      const cost = c.cost || 0;
      const msrp = c.msrp || 0;
      // Valuation is of the SUGGESTED REORDER QTY (what restocking would cost / be worth / yield).
      const valueAtCost = +(suggestedReorderQty * cost).toFixed(2);
      const valueAtMsrp = +(suggestedReorderQty * msrp).toFixed(2);
      const projectedGrossProfit = +(valueAtMsrp - valueAtCost).toFixed(2);
      return {
        productId: iv.productId, sku: iv.sku || c.sku || null, name: iv.name || c.name || null,
        supplier: c.supplier, onHand, reorderPoint: REORDER_POINT, suggestedReorderQty,
        cost, msrp, valueAtCost, valueAtMsrp, projectedGrossProfit,
      };
    })
    .filter((it) => it.onHand <= it.reorderPoint)
    .sort((a, b) => a.onHand - b.onHand);
  ok(res, { items, reorderPoint: REORDER_POINT, reorderTarget: REORDER_TARGET, banner: OPS_BANNER });
});

app.post('/api/ops/inventory/adjust', (req, res) => {
  const body = req.body || {};
  const productId = String(body.productId || '').trim();
  if (!productId) return fail(res, 400, 'productId is required.');
  const prod = catalogIndex.byId[productId];
  if (!prod) return fail(res, 404, 'Product not found in catalog.');
  const mode   = String(body.mode || 'set').toLowerCase(); // 'set' | 'add' | 'subtract'
  const qty    = parseInt(body.qty, 10) || 0;
  const reason = String(body.reason || 'Manual adjustment').trim();
  const supplierOrderId = body.supplierOrderId || null;

  let iv = inventoryFor(productId);
  if (!iv) {
    iv = { id: opsUid('inv'), productId, sku: prod.sku, name: prod.name || prod.displayName, onHand: 0, updatedAt: new Date().toISOString() };
  }

  const before = iv.onHand || 0;
  if (mode === 'set')      iv.onHand = Math.max(0, qty);
  else if (mode === 'add') iv.onHand = Math.max(0, before + qty);
  else                     iv.onHand = Math.max(0, before - qty);  // subtract
  iv.updatedAt = new Date().toISOString();
  store.upsert('opsInventory', iv);

  const movType = mode === 'subtract' ? 'SALE' : 'RESTOCK';
  const movQty  = mode === 'set' ? (iv.onHand - before) : (mode === 'add' ? qty : -qty);
  store.upsert('opsInventoryMovements', {
    id: opsUid('mov'), productId, type: movType, qty: movQty,
    reason, orderId: null, supplierOrderId, createdAt: new Date().toISOString(),
  });
  ok(res, { inventory: iv, banner: OPS_BANNER });
});

// --- GET /api/ops/supplier-orders, POST, PATCH ----------------------------
app.get('/api/ops/supplier-orders', (_req, res) => {
  ok(res, { supplierOrders: store.list('opsSupplierOrders'), banner: OPS_BANNER });
});

app.post('/api/ops/supplier-orders', (req, res) => {
  const body = req.body || {};
  const supplier = String(body.supplier || '').trim();
  if (!supplier) return fail(res, 400, 'supplier is required.');
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map((it) => {
    const prod = catalogIndex.byId[it.productId] || null;
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const unitCost = parseFloat(it.unitCost) || (prod ? (prod.cost || 0) : 0);
    return {
      productId: it.productId, name: prod ? (prod.name || prod.displayName) : (it.name || ''),
      qty, unitCost, lineTotal: +(qty * unitCost).toFixed(2),
    };
  });
  const totalCost   = items.reduce((s, it) => s + it.lineTotal, 0);
  const amountPaid  = parseFloat(body.amountPaid) || 0;
  const balanceDue  = Math.max(0, totalCost - amountPaid);
  const now = new Date().toISOString();
  const so = {
    id: opsUid('supp'), supplier, items, totalCost, amountPaid, balanceDue,
    paymentStatus: balanceDue <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'UNPAID',
    orderStatus: 'ORDERED', notes: body.notes || '',
    createdAt: now, updatedAt: now,
  };
  store.upsert('opsSupplierOrders', so);
  ok(res, { supplierOrder: so, banner: OPS_BANNER });
});

app.patch('/api/ops/supplier-orders/:id', (req, res) => {
  const so = store.get('opsSupplierOrders', req.params.id);
  if (!so) return fail(res, 404, 'Supplier order not found');
  const body = req.body || {};
  const VALID_STATUSES = ['ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED'];
  if (body.orderStatus && !VALID_STATUSES.includes(body.orderStatus)) {
    return fail(res, 400, `orderStatus must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if (body.amountPaid != null) {
    so.amountPaid  = parseFloat(body.amountPaid) || 0;
    so.balanceDue  = Math.max(0, so.totalCost - so.amountPaid);
    so.paymentStatus = so.balanceDue <= 0 ? 'PAID' : so.amountPaid > 0 ? 'PARTIAL' : 'UNPAID';
  }
  if (body.orderStatus) so.orderStatus = body.orderStatus;
  if (body.notes != null) so.notes = body.notes;
  so.updatedAt = new Date().toISOString();
  store.upsert('opsSupplierOrders', so);

  // When marking RECEIVED, optionally restock inventory
  if (body.orderStatus === 'RECEIVED' && body.restock !== false) {
    for (const it of so.items || []) {
      if (!it.productId) continue;
      let iv = inventoryFor(it.productId);
      const prod = catalogIndex.byId[it.productId];
      if (!iv && prod) {
        iv = { id: opsUid('inv'), productId: it.productId, sku: prod.sku, name: prod.name || prod.displayName, onHand: 0, updatedAt: so.updatedAt };
      }
      if (iv) {
        iv.onHand = (iv.onHand || 0) + (it.qty || 0);
        iv.updatedAt = so.updatedAt;
        store.upsert('opsInventory', iv);
        store.upsert('opsInventoryMovements', {
          id: opsUid('mov'), productId: it.productId, type: 'RESTOCK',
          qty: it.qty || 0, reason: `Received supplier order ${so.id}`,
          orderId: null, supplierOrderId: so.id, createdAt: so.updatedAt,
        });
      }
    }
  }
  ok(res, { supplierOrder: so, banner: OPS_BANNER });
});

// --- GET /api/ops/referrals, POST credit/debit ----------------------------
app.get('/api/ops/referrals', (_req, res) => {
  const accounts = store.list('opsReferralAccounts');
  const ledger   = store.list('opsReferralLedger');
  ok(res, { accounts, ledger, banner: OPS_BANNER });
});

app.post('/api/ops/referrals/:id/credit', (req, res) => {
  const acct = store.get('opsReferralAccounts', req.params.id);
  if (!acct) return fail(res, 404, 'Referral account not found');
  const amount = parseFloat((req.body || {}).amount) || 0;
  if (amount <= 0) return fail(res, 400, 'amount must be positive');
  acct.creditBalance = (acct.creditBalance || 0) + amount;
  acct.totalEarned   = (acct.totalEarned   || 0) + amount;
  store.upsert('opsReferralAccounts', acct);
  const entry = {
    id: opsUid('rled'), referralAccountId: acct.id, type: 'CREDIT', amount,
    reason: String((req.body || {}).reason || 'Manual credit'), orderId: null,
    createdAt: new Date().toISOString(),
  };
  store.upsert('opsReferralLedger', entry);
  ok(res, { account: acct, entry, banner: OPS_BANNER });
});

app.post('/api/ops/referrals/:id/debit', (req, res) => {
  const acct = store.get('opsReferralAccounts', req.params.id);
  if (!acct) return fail(res, 404, 'Referral account not found');
  const amount = parseFloat((req.body || {}).amount) || 0;
  if (amount <= 0) return fail(res, 400, 'amount must be positive');
  acct.creditBalance  = Math.max(0, (acct.creditBalance  || 0) - amount);
  acct.totalRedeemed  = (acct.totalRedeemed  || 0) + amount;
  store.upsert('opsReferralAccounts', acct);
  const entry = {
    id: opsUid('rled'), referralAccountId: acct.id, type: 'DEBIT', amount,
    reason: String((req.body || {}).reason || 'Manual debit'), orderId: null,
    createdAt: new Date().toISOString(),
  };
  store.upsert('opsReferralLedger', entry);
  ok(res, { account: acct, entry, banner: OPS_BANNER });
});

// SPA fallback
app.get('*', (_req, res) => res.sendFile(resolve(STATIC_DIR, 'index.html')));

const PORT = process.env.PORT || 3100;
if (require.main === module) {
  store.load();
  app.listen(PORT, () => console.log(`${APP_NAME} → http://localhost:${PORT}`));
}

module.exports = { app, buildSafetyMonitoring, computeScorecard, catalogIndex };
