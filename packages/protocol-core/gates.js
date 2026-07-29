/**
 * gates.js — The Builder OS gate engine.
 *
 * Each gate is a PURE function with no I/O. The server and the acceptance tests both
 * call these. The gates ARE the doctrine: source-of-truth → research → compliance →
 * draft → review. A gate never invents data; the honest outputs are BLOCKED / UNKNOWN /
 * NEEDS_SOURCE / "review with provider".
 *
 * Hard acceptance tests this engine enforces:
 *   1 missing product route/form        → protocol blocked            (productFormRouteGate)
 *   2 product not in source-of-truth    → protocol blocked            (catalogMembershipGate)
 *   3 missing research evidence         → UNKNOWN, no recommendation  (researchGate)
 *   4 missing lab panel source          → NEEDS_SOURCE, no invention  (labPanelGate)
 *   5 abnormal lab value                → "review with provider"      (labResultFlagGate)
 *   6 SubQ vs oral cannot be blurred    → substitution blocked        (routeIntegrityGate)
 *   7 Canada compliance on every draft  → CA status always present    (complianceGate / assembleDraft)
 *   8 draft stays DRAFT until reviewed  → status guarded              (draftStatusGate)
 *   9 no medical-claim language         → banned-term scan            (languageGate)
 *  10 dashboard works on demo data      → demo present                (demoDataGate)
 */

const M = require('./models');

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// --- Gate 1: product must have a known route AND form -----------------------
function productFormRouteGate(product) {
  const reasons = [];
  if (!product) return { ok: false, blocked: true, reasons: ['Product is null'] };
  if (!product.route) reasons.push(`Route is UNKNOWN for "${product.name}" — cannot draft (would blur how it is taken).`);
  if (!product.form) reasons.push(`Form is UNKNOWN for "${product.name}" — cannot draft.`);
  return { ok: reasons.length === 0, blocked: reasons.length > 0, reasons };
}

// --- Gate 2: product must exist in the source-of-truth catalog --------------
// catalogIndex = { byId: {id->product}, list: [products] }
function catalogMembershipGate(ref, catalogIndex) {
  if (!catalogIndex || !catalogIndex.byId) return { ok: false, product: null, reason: 'No catalog index supplied' };
  // Resolve by id first (the only unambiguous handle).
  if (ref && ref.productId && catalogIndex.byId[ref.productId]) {
    return { ok: true, product: catalogIndex.byId[ref.productId], reason: null };
  }
  // Fall back to an EXACT normalized-name match — never a fuzzy guess.
  const wanted = normName(ref && (ref.productName || ref.name));
  if (wanted) {
    const hit = catalogIndex.list.find((p) => normName(p.name) === wanted);
    if (hit) return { ok: true, product: hit, reason: null };
  }
  return {
    ok: false,
    product: null,
    reason: `"${(ref && (ref.productName || ref.name || ref.productId)) || 'item'}" is not in the source-of-truth catalog — protocol blocked.`,
  };
}

// --- Gate 3: research evidence or honest UNKNOWN ----------------------------
function researchGate(evidenceCompoundId, evidenceByCompound) {
  const rec = evidenceCompoundId && evidenceByCompound ? evidenceByCompound[evidenceCompoundId] : null;
  if (!rec) {
    return {
      level: 'UNKNOWN',
      recommendation: null,
      message: 'No sourced evidence in the corpus for this item — no recommendation can be made (UNKNOWN).',
      citationCount: 0,
      citations: [],
      hasClinicalTrial: false,
    };
  }
  return {
    level: rec.evidenceLevel || 'UNKNOWN',
    recommendation: null, // the app never "recommends" — it surfaces evidence for a provider decision
    message: null,
    mechanism: rec.mechanism || null,
    citationCount: rec.citationCount || 0,
    citations: rec.citations || [],
    hasClinicalTrial: !!rec.hasClinicalTrial,
    clinicalTrialStatus: rec.clinicalTrialStatus || 'NO_TRIAL_CITED',
    contraindicationFlags: rec.contraindicationFlags || [],
  };
}

// --- Gate 4: lab panel must be SOURCED, else NEEDS_SOURCE (no invention) ----
function labPanelGate(panel) {
  if (!panel) return { ok: false, status: 'UNKNOWN', markers: [], message: 'Panel not found.' };
  if (panel.status === 'NEEDS_SOURCE') {
    return { ok: false, status: 'NEEDS_SOURCE', markers: [], message: panel.needs || 'Panel markers not enumerated in any source — NEEDS_SOURCE. Markers will not be invented.' };
  }
  return { ok: true, status: panel.status || 'SOURCED', markers: panel.markers || [], sections: panel.sections || [], message: null };
}

// --- Gate 5: abnormal lab value → "review with provider", never a diagnosis -
function labResultFlagGate(labResult) {
  const out = {
    id: labResult && labResult.id,
    clientId: labResult && labResult.clientId,
    // Passthrough of RECORDED data (not interpretation): the draw date + panel identity must
    // survive the gate, or the portal loses "Drawn …", the trend prior, and the server sort.
    drawnAt: (labResult && labResult.drawnAt) || null,
    panelName: (labResult && (labResult.panelName || labResult.label)) || null,
    flags: [],
    values: [],
  };
  for (const v of (labResult && labResult.values) || []) {
    let flag = 'IN_RANGE';
    if (v.value != null && v.refLow != null && v.value < v.refLow) flag = 'OUT_OF_RANGE_LOW';
    else if (v.value != null && v.refHigh != null && v.value > v.refHigh) flag = 'OUT_OF_RANGE_HIGH';
    else if (v.refLow == null && v.refHigh == null) flag = 'NO_RANGE';
    const annotated = {
      ...v,
      flag,
      // The ONLY action language permitted for an out-of-range value. Never a diagnosis.
      action: flag.startsWith('OUT_OF_RANGE') ? 'Review with your provider — this is not a diagnosis.' : null,
    };
    out.values.push(annotated);
    if (flag.startsWith('OUT_OF_RANGE')) out.flags.push({ marker: v.marker, flag, action: annotated.action });
  }
  out.hasFlags = out.flags.length > 0;
  return out;
}

// --- Gate 6: SubQ and oral can never be substituted/blurred -----------------
const ROUTE_CLASS = (route) => {
  const r = String(route || '').toLowerCase();
  if (!route) return 'UNKNOWN';
  if (r.includes('subq') || r.includes('inject')) return 'INJECTED';
  if (r.includes('oral') || r.includes('tab') || r.includes('capsule')) return 'ORAL';
  if (r.includes('nasal') || r.includes('intranasal') || r.includes('spray')) return 'INTRANASAL';
  return 'OTHER';
};
function routeIntegrityGate(productA, productB) {
  const a = ROUTE_CLASS(productA && productA.route);
  const b = ROUTE_CLASS(productB && productB.route);
  if (a === 'UNKNOWN' || b === 'UNKNOWN') {
    return { ok: false, blocked: true, reason: 'One product has UNKNOWN route — substitution blocked (cannot confirm same route).' };
  }
  if (a !== b) {
    return { ok: false, blocked: true, reason: `Route mismatch: ${a} cannot be substituted for ${b}. SubQ/oral/intranasal are never interchangeable.` };
  }
  return { ok: true, blocked: false, reason: null };
}

// --- Gate 7: compliance — always returns a status for the jurisdiction ------
function complianceGate(subject, jurisdiction, complianceCfg) {
  const jx = (complianceCfg.JURISDICTIONS && complianceCfg.JURISDICTIONS[jurisdiction]) || complianceCfg.JURISDICTIONS.CA;
  const wanted = normName(subject);
  let status = jx.default;
  let reason = jx.basis;
  for (const flag of complianceCfg.COMPOUND_FLAGS || []) {
    if (flag.match.some((m) => wanted.includes(normName(m)))) {
      // Elevate to the more cautious flagged status.
      status = flag.status;
      reason = flag.reason;
      break;
    }
  }
  return M.ComplianceCheck({ subject, jurisdiction: jx.code, status, reason, disclaimer: complianceCfg.DISCLAIMER });
}

// --- Gate 8: a draft is DRAFT / RESOURCE ONLY until a reviewer signs off ----
function draftStatusGate(draft) {
  const reviewed = !!(draft && draft.reviewedBy);
  const status = reviewed ? (draft.status === 'APPROVED_RESOURCE' ? 'APPROVED_RESOURCE' : 'REVIEWED') : 'DRAFT';
  return {
    ok: true,
    status,
    isResourceOnly: true,           // always — this app never produces a prescription
    reviewed,
    banner: reviewed ? 'REVIEWED — RESOURCE ONLY' : 'DRAFT — RESOURCE ONLY · NOT REVIEWED · NOT MEDICAL ADVICE',
  };
}

// --- Gate 8b: the approval boundary — THE HARD MULTI-TENANT PERMISSION RULE --
// "A client must not see draft protocol content until practitioner review/approval."
// Client-visibility is ONE rule: status === 'APPROVED_RESOURCE'. There is deliberately
// NO parameter on the projection that could make it return an un-approved draft — the
// boundary cannot be bypassed by passing a flag. The server calls these; the browser
// only ever receives the projected, stripped shape.
const CLIENT_VISIBLE_STATUS = 'APPROVED_RESOURCE';

function isClientVisible(draft) {
  return !!draft && draft.status === CLIENT_VISIBLE_STATUS;
}

// Projects a draft into the ONLY shape a client may receive. Returns null for anything
// not yet approved — so a DRAFT / IN_REVIEW / CHANGES_REQUESTED / BLOCKED protocol can
// never leak. Strips practitioner-only internals: warnings, blockedReasons, unknowns,
// raw compliance reasons, and any review comments.
function clientResourceProjection(draft) {
  if (!isClientVisible(draft)) return null;
  return {
    _model: 'ApprovedResource',
    id: draft.id,
    clientId: draft.clientId,
    status: 'APPROVED_RESOURCE',
    banner: 'APPROVED RESOURCE — reviewed by your practitioner · educational, not a prescription',
    approvedBy: draft.reviewedBy || null,
    approvedAt: draft.reviewedAt || null,
    items: (draft.items || []).map((it) => ({
      productName: it.productName,
      route: it.route,
      form: it.form,
      evidenceLevel: it.evidenceLevel || null,
    })),
    rationale: draft.rationale || '',
    monitoring: draft.monitoring || '',
    labsSuggested: draft.labsSuggested || [],
    disclaimer: (draft.compliance && draft.compliance.disclaimer) || null,
  };
}

// All approved resources for one client. Filters by ownership (clientId) AND approval —
// the map→projection→filter(Boolean) chain drops every non-approved draft to null.
function clientVisibleResources(drafts, clientId) {
  return (drafts || [])
    .filter((d) => d.clientId === clientId)
    .map(clientResourceProjection)
    .filter(Boolean);
}

// --- Protocol journey projection — the client portal "My Protocols" surface --
// SAME hard boundary as clientResourceProjection: a protocol is client-visible IFF
// status === 'APPROVED_RESOURCE'. Returns null for anything un-approved, so a DRAFT /
// IN_REVIEW / CHANGES_REQUESTED / BLOCKED protocol can never enter the journey. This is
// a richer, lifecycle-aware view of the SAME approved set — not a second, weaker rule.
// Whitelist-only (never spreads the draft): practitioner-only internals (warnings,
// blockedReasons, unknowns, raw rationale, raw compliance reasons, review comments) are
// physically dropped. The only note a client sees is the dedicated client-safe
// `practitionerNote` the practitioner authored for them.
const TIMELINE_KINDS = ['GENERATED', 'REVIEWED', 'CLIENT_VIEWED', 'LABS_UPLOADED', 'CHECK_IN', 'COMPLETED', 'PAUSED', 'CHANGED'];
const LIFECYCLE_STATES = ['ACTIVE', 'PENDING', 'PAUSED', 'COMPLETED'];

function normalizeLifecycle(lc) {
  const v = String(lc || 'ACTIVE').toUpperCase();
  return LIFECYCLE_STATES.includes(v) ? v : 'ACTIVE';
}

// One timeline event, reduced to a client-safe shape. `label` is a short caption authored
// for the client; `by` is a name ("Dr. Vincent Lun" / "You") — never internal free text.
function projectTimelineEvent(ev) {
  if (!ev) return null;
  const kind = String(ev.kind || '').toUpperCase();
  return {
    kind: TIMELINE_KINDS.includes(kind) ? kind : 'CHANGED',
    at: ev.at || null,
    label: ev.label || null,
    by: ev.by || null,
  };
}

function clientProtocolProjection(draft) {
  if (!isClientVisible(draft)) return null;
  const lifecycle = normalizeLifecycle(draft.lifecycle);
  return {
    _model: 'ApprovedProtocol',
    id: draft.id,
    clientId: draft.clientId,
    status: 'APPROVED_RESOURCE',              // approval gate — always approved here
    lifecycle,                                 // ACTIVE | PENDING | PAUSED | COMPLETED
    isCurrent: lifecycle !== 'COMPLETED',
    title: draft.title || 'Protocol resource',
    goal: draft.goal || null,
    phase: draft.phase || null,                // { label, index, total } — null when not staged
    startDate: draft.startDate || draft.reviewedAt || null,
    endDate: draft.endDate || null,
    banner: 'APPROVED RESOURCE — reviewed by your practitioner · educational, not a prescription',
    approvedBy: draft.reviewedBy || null,
    approvedAt: draft.reviewedAt || null,
    items: (draft.items || []).map((it) => ({
      productName: it.productName,
      route: it.route,
      form: it.form,
      evidenceLevel: it.evidenceLevel || null,
      // Client-safe dosing — surfaced ONLY because this protocol is APPROVED / practitioner-reviewed.
      // Carries the reviewed schedule (label / schedule / titration / taper / timing / note) and
      // OMITS internal reasoning (basis / framing). An un-approved draft never reaches this projection.
      dosing: it.dosing ? {
        label: it.dosing.label || null,
        schedule: it.dosing.schedule || null,
        titration: it.dosing.titration || null,
        taper: it.dosing.taper || null,
        timing: it.dosing.timing || null,
        note: it.dosing.note || null,
      } : null,
    })),
    monitoring: draft.monitoring || '',
    labsSuggested: draft.labsSuggested || [],
    nextCheckIn: draft.nextCheckIn || null,              // next scheduled lab / progress check-in (current protocols)
    practitionerNote: draft.practitionerNote || null,   // client-safe note ONLY (never raw rationale)
    clientNote: draft.clientNote || null,                // the client's own reflection (client-authored, safe to show)
    adherence: draft.adherence || null,                  // { pct, summary }
    progressSummary: draft.progressSummary || null,
    outcome: draft.outcome || null,                      // past protocols: { summary, adherencePct, labChanges[], bodyComp[] }
    informedNext: draft.informedNext || null,            // { protocolId, note } | null
    timeline: (draft.timeline || []).map(projectTimelineEvent).filter(Boolean),
    disclaimer: (draft.compliance && draft.compliance.disclaimer) || null,
  };
}

// Every approved protocol for one client (same ownership + approval filter as resources).
function clientVisibleProtocols(drafts, clientId) {
  return (drafts || [])
    .filter((d) => d.clientId === clientId)
    .map(clientProtocolProjection)
    .filter(Boolean);
}

// Split a client's approved protocols into the journey shape the portal renders:
// current = still running/pending/paused; past = COMPLETED. Each list is sorted so the
// most relevant entry leads.
function splitProtocolsByLifecycle(protocols) {
  const list = (protocols || []).slice();
  const current = list
    .filter((p) => p.lifecycle !== 'COMPLETED')
    .sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
  const past = list
    .filter((p) => p.lifecycle === 'COMPLETED')
    .sort((a, b) => new Date(b.endDate || b.startDate || 0) - new Date(a.endDate || a.startDate || 0));
  return { current, past };
}

// Unified, newest-first journey timeline across all of a client's approved protocols.
// Events are already client-safe (projected); we only tag each with which protocol it
// belongs to. An un-approved protocol contributes nothing — its events never reach here.
function buildProtocolTimeline(protocols) {
  const events = [];
  for (const p of protocols || []) {
    for (const ev of p.timeline || []) {
      events.push({ ...ev, protocolId: p.id, protocolTitle: p.title, lifecycle: p.lifecycle });
    }
  }
  return events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

// Translates a practitioner's review decision into the next draft status + whether that
// status is client-visible. APPROVE is the only path that flips clientVisible to true.
function reviewDecisionGate(decision) {
  const d = String(decision || '').toUpperCase();
  if (d === 'APPROVE' || d === 'APPROVED') return { status: 'APPROVED_RESOURCE', clientVisible: true };
  if (d === 'REQUEST_CHANGES' || d === 'CHANGES_REQUESTED') return { status: 'CHANGES_REQUESTED', clientVisible: false };
  if (d === 'SUBMIT' || d === 'IN_REVIEW') return { status: 'IN_REVIEW', clientVisible: false };
  return { status: 'DRAFT', clientVisible: false };
}

// --- Protocol lock — make exactly ONE approved protocol the CURRENT one ------
// "When a client accepts a protocol, it locks in as CURRENT until the next round." The lock
// touches ONLY the lifecycle axis (current/past), never the approval axis: both the newly
// locked protocol and any superseded one stay status === 'APPROVED_RESOURCE'. The locked one
// becomes lifecycle 'ACTIVE'; every other still-running approved protocol for the SAME client
// is moved to 'COMPLETED' (→ PAST), so there is exactly one CURRENT.
function protocolLockGate(draft) {
  if (!draft) return { ok: false, blocked: true, reason: 'No protocol supplied.' };
  if (!isClientVisible(draft)) return { ok: false, blocked: true, reason: 'Only an APPROVED_RESOURCE protocol can be locked as current.' };
  return { ok: true, blocked: false, reason: null };
}

function lockProtocolAsCurrent(drafts, draftId) {
  const list = (drafts || []).map((d) => ({ ...d }));
  const target = list.find((d) => d.id === draftId) || null;
  const gate = protocolLockGate(target);
  if (!gate.ok) return { ok: false, blocked: true, reason: gate.reason, drafts: list, lockedId: null, supersededIds: [] };
  const supersededIds = [];
  for (const d of list) {
    if (d.id === target.id) continue;
    if (d.clientId !== target.clientId) continue;       // never touch another client's journey
    if (!isClientVisible(d)) continue;                  // only approved peers participate (status untouched)
    if (normalizeLifecycle(d.lifecycle) !== 'COMPLETED') {
      d.lifecycle = 'COMPLETED';                        // prior CURRENT → PAST (status UNCHANGED — still approved)
      supersededIds.push(d.id);
    }
  }
  target.lifecycle = 'ACTIVE';                           // exactly one CURRENT
  target.isCurrentLocked = true;
  target.lockedAt = target.lockedAt || new Date().toISOString();
  return { ok: true, blocked: false, reason: null, drafts: list, lockedId: target.id, supersededIds };
}

// --- Gate 9: no medical-claim language (negation-aware) ---------------------
const BANNED_TERMS = ['treats', 'treat', 'cures', 'cure', 'heals', 'heal', 'prescribe', 'prescribes', 'prescribed', 'prescribing', 'diagnose', 'diagnoses', 'diagnosed', 'diagnosing', 'diagnosis'];
const BANNED_PHRASES = ['doctor replacement', 'replace your doctor', 'replaces your doctor', 'replacement for a doctor', 'instead of a doctor', 'substitute for a doctor'];
// A match is allowed if a negator appears shortly before it (so "does not diagnose",
// "not a substitute for a doctor", "not a diagnosis" all pass — they are disclaimers).
const NEGATOR = /\b(not|never|no|without|cannot|can't|don't|doesn't|isn't|aren't|won't|do not|does not)\b/i;
function languageGate(text) {
  const t = String(text || '');
  const violations = [];
  const scan = (needle, isPhrase) => {
    const re = isPhrase
      ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      : new RegExp(`\\b${needle}\\b`, 'gi');
    let m;
    while ((m = re.exec(t)) !== null) {
      const preceding = t.slice(Math.max(0, m.index - 48), m.index);
      if (!NEGATOR.test(preceding)) violations.push({ term: m[0], at: m.index });
    }
  };
  BANNED_TERMS.forEach((term) => scan(term, false));
  BANNED_PHRASES.forEach((p) => scan(p, true));
  return { ok: violations.length === 0, violations };
}

// --- Gate 10: dashboard must work on demo data ------------------------------
function demoDataGate(demo) {
  const clients = (demo && demo.DEMO_CLIENTS) || [];
  return {
    ok: clients.length > 0,
    clientCount: clients.length,
    allFlaggedDemo: clients.every((c) => c._demo === true),
    message: clients.length ? null : 'No demo clients present — dashboard would be empty.',
  };
}

// --- Referral suggestion (categories, never diagnoses) ----------------------
function referralGate(client, flaggedResults, providersCfg) {
  const signals = new Set();
  if (flaggedResults && flaggedResults.some((r) => r.hasFlags)) signals.add('abnormalLab');
  // A flagged vitamin/mineral marker → nutrientDeficiency category (still not a diagnosis).
  for (const r of flaggedResults || []) {
    for (const f of r.flags || []) {
      if (/vitamin|folate|ferritin|b12|magnesium|calcium|zinc|iron/i.test(f.marker)) signals.add('nutrientDeficiency');
    }
  }
  const goalsBlob = (client && client.goals || []).join(' ').toLowerCase() + ' ' + String(client && client.notes || '').toLowerCase();
  if (/testosterone|low.?t|libido|androgen/.test(goalsBlob)) signals.add('lowTestosterone');
  if (/fat loss|weight|metabolic|glucose|insulin/.test(goalsBlob)) signals.add('metabolic');
  if (/hormone/.test(goalsBlob)) signals.add('hormone');
  if (/gut|digest|gi\b|stool/.test(goalsBlob)) signals.add('gutHealth');

  const out = [];
  for (const trigger of signals) {
    const cat = (providersCfg.REFERRAL_CATEGORIES || []).find((c) => c.trigger === trigger);
    if (!cat) continue;
    const provider = (providersCfg.PROVIDERS || []).find((p) => (p.focus || []).includes(trigger));
    out.push(M.ProviderReferral({
      trigger: cat.trigger, label: cat.label, whenObserved: cat.whenObserved, suggests: cat.suggests,
      provider: provider ? { name: provider.name, role: provider.role, contact: provider.contact } : null,
      disclaimer: cat.disclaimer,
    }));
  }
  return out;
}

// --- Assembly: run the full gate chain to produce a gated ProtocolDraft -----
function assembleDraft(opts) {
  const {
    client, itemRefs = [], catalogIndex, evidenceByCompound = {}, complianceCfg,
    jurisdiction = 'CA', rationale = '', monitoring = '', labsSuggested = [], existing = {},
  } = opts;

  const blockedReasons = [];
  const items = [];
  const unknowns = [];
  const warnings = [];
  const compliances = [];

  for (const ref of itemRefs) {
    // Gate 2 — catalog membership
    const mem = catalogMembershipGate(ref, catalogIndex);
    if (!mem.ok) { blockedReasons.push(mem.reason); continue; }
    const product = mem.product;

    // Gate 1 — route/form present
    const rf = productFormRouteGate(product);
    if (!rf.ok) { blockedReasons.push(...rf.reasons); continue; }

    // Gate 3 — research / UNKNOWN
    const research = researchGate(product.evidenceCompoundId, evidenceByCompound);
    if (research.level === 'UNKNOWN') unknowns.push(`${product.name}: no sourced evidence (UNKNOWN — no recommendation).`);

    // Gate 7 — compliance (CA always computed)
    const comp = complianceGate(product.name, jurisdiction, complianceCfg);
    compliances.push(comp);
    if (comp.status === 'NEEDS_REVIEW') warnings.push(`${product.name}: compliance ${comp.status} — ${comp.reason}`);
    if (comp.status === 'BLOCKED') blockedReasons.push(`${product.name}: compliance BLOCKED — ${comp.reason}`);

    items.push({
      productId: product.id,
      productName: product.name,
      route: product.route,            // copied verbatim from catalog — never remapped (Gate 6 integrity)
      form: product.form,
      evidenceCompoundId: product.evidenceCompoundId,
      evidenceLevel: research.level,
      citationCount: research.citationCount,
      hasClinicalTrial: research.hasClinicalTrial,
      contraindicationFlags: research.contraindicationFlags || [],
      compliance: { status: comp.status, reason: comp.reason },
    });
  }

  // Overall jurisdiction compliance summary (Gate 7 — always present, most restrictive wins).
  const order = { BLOCKED: 3, NEEDS_REVIEW: 2, UNKNOWN: 1, ALLOWED_RESOURCE: 0 };
  const overallCompliance = compliances.reduce((acc, c) => (order[c.status] > order[acc.status] ? c : acc),
    M.ComplianceCheck({ subject: 'overall', jurisdiction, status: 'ALLOWED_RESOURCE', reason: 'No elevated items.', disclaimer: complianceCfg.DISCLAIMER }));

  // Gate 9 — language scan over everything we generated.
  const lang = languageGate([rationale, monitoring, warnings.join(' '), unknowns.join(' ')].join(' \n '));
  if (!lang.ok) blockedReasons.push(`Language gate: banned medical-claim term(s) ${lang.violations.map((v) => `"${v.term}"`).join(', ')}.`);

  const blocked = blockedReasons.length > 0;

  const draft = M.ProtocolDraft({
    ...existing,
    clientId: client && client.id,
    items,
    rationale,
    monitoring,
    labsSuggested,
    warnings,
    unknowns,
    blocked,
    blockedReasons,
    citationsResolved: items.map((i) => ({ productName: i.productName, evidenceLevel: i.evidenceLevel, citationCount: i.citationCount })),
  });

  // Gate 8 — status banner.
  const statusGate = draftStatusGate(draft);
  draft.status = blocked ? 'BLOCKED' : statusGate.status;
  draft.statusBanner = blocked ? 'BLOCKED — gate failure (see reasons)' : statusGate.banner;
  draft.compliance = { jurisdiction, status: overallCompliance.status, reason: overallCompliance.reason, disclaimer: complianceCfg.DISCLAIMER };

  return draft;
}

module.exports = {
  normName, ROUTE_CLASS,
  productFormRouteGate, catalogMembershipGate, researchGate, labPanelGate, labResultFlagGate,
  routeIntegrityGate, complianceGate, draftStatusGate, languageGate, demoDataGate,
  referralGate, assembleDraft,
  // Multi-tenant approval boundary (hard permission rule)
  CLIENT_VISIBLE_STATUS, isClientVisible, clientResourceProjection, clientVisibleResources, reviewDecisionGate,
  // Client portal "My Protocols" journey (same approval boundary, lifecycle-aware view)
  clientProtocolProjection, clientVisibleProtocols, splitProtocolsByLifecycle, buildProtocolTimeline,
  // Protocol lock — accept a protocol as the single CURRENT one (lifecycle axis only)
  protocolLockGate, lockProtocolAsCurrent,
};
