'use strict';
/**
 * vertical-document-model.js — the NON-peptide vertical-document ADAPTERS.
 *
 * REUSE > REBUILD. Siblings of document-model.toPeptideDocProps. Each adapter adds ZERO
 * clinical logic: it RESHAPES the REAL output of an existing engine (nutrition / supplements /
 * meals / lab-panels) onto the SAME "Vitalis Research" dossier schema the React document shell
 * renders (cover / meta / stats / sections / disclaimer). CommonJS + pure so the acceptance
 * harness tests it directly; the server runs it so the browser stays thin.
 *
 * Doctrine inherited from document-model.js (we re-use its labelCitations + the shared
 * protocol-document-standard section builders, both vertical-agnostic):
 *   • Research Source labeling — a government/index page is never the scientific authority.
 *   • Honest evidence STATUS over fake-green — UNKNOWN / SOURCE_PENDING / NEEDS_SOURCE shown.
 *   • isClient softening by key-presence — a CLIENT view drops operator-only internals (the
 *     naturopathic "how", full citation lists, raw provider-review reasons), exactly like the
 *     peptide adapter. The server still enforces the hard 403 boundary; this is defense-in-depth.
 *
 * These adapters mint NOTHING clinical: no dose (nutrition/supplement targets name a FORM, the
 * dose is the naturopath's call), no fabricated macro number (CURATED_ESTIMATE / SOURCE_PENDING),
 * no invented lab marker (a NEEDS_SOURCE panel surfaces honestly, never padded). KLOW / blend /
 * peptide schedule logic is untouched — that slice lives only in the peptide adapter.
 *
 * NOT medical advice. NOT a prescription. NOT a diagnosis.
 */
const providersCfg = require('./data/providers');
const docStandard = require('./data/protocol-document-standard');
const panelsCfg = require('./data/lab-panels');
const labScenarios = require('./data/lab-scenarios');
const { labelCitations } = require('./document-model');
const supplementsResearch = require('./supplements-research');
const gates = require('./gates');

const DR_LUN = (providersCfg.PROVIDERS || []).find((p) => p.id === 'dr_vincent_lun')
  || { name: 'Dr. Vincent Lun', role: 'Naturopathic Doctor', contact: null };

const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const refId = (src, prefix) => prefix + '-' + String((src && src.id) || 'DRAFT').replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();

// Nutrition evidence tiers (NOT the peptide T1–T4 tiers — the nutrition engine's own vocabulary).
const NUTRITION_TIER_LEGEND = [
  { tier: 'ESTABLISHED', label: 'Established nutrition science (clinical guidelines)' },
  { tier: 'SUPPORTIVE', label: 'Supportive evidence — discuss with your naturopath' },
  { tier: 'EMERGING', label: 'Emerging — limited data' },
];

// The locked research-aggregator positioning, surfaced as a document callout.
const AGGREGATOR_CALLOUT =
  'Vitalis is a research aggregator: we surface the relevant science so you arrive with a vetted ' +
  'starting point for the conversation — not a replacement for it. The decisions stay between you and ' +
  `${DR_LUN.name}.`;

const providerBlock = () => ({ name: DR_LUN.name, role: DR_LUN.role || null, contact: DR_LUN.contact || null });

// SUPPLEMENT-document disclaimer — supplement-specific, with NO peptide-sourcing boilerplate. The peptide
// protocol disclaimer (protocol-document-standard.protocolDisclaimer) speaks to peptide identity/purity/
// channels, which is irrelevant and confusing on a supplement plan. This is the supplement footer text.
const SUPPLEMENT_DISCLAIMER =
  'Strictly for research and educational purposes — not medical advice, not a prescription, and not a ' +
  'diagnosis. This supplement plan names FORMS for context only; the dose, timing, suitability, and ' +
  `duration are decisions for ${DR_LUN.name} (or another licensed practitioner) after review. ` +
  'Out-of-range labs are screening signals, not diagnoses. Discuss any supplement with your practitioner ' +
  'before starting, especially alongside medications, existing conditions, or pregnancy. Vitalis is a ' +
  'research aggregator and assumes no liability for outcomes arising from use outside qualified oversight.';

// Shared cover-review band (physician-review framing) for every vertical.
const REVIEW_BAND = {
  title: 'For practitioner review — resource only.',
  body:
    'This document is a research / educational resource generated from your own inputs, intended for ' +
    `review and authorization by ${DR_LUN.name} (or another licensed practitioner). It is not medical ` +
    'advice, a prescription, or a diagnosis. Out-of-range does not by itself confirm a deficiency.',
};

// ===========================================================================
// toNutritionDocProps — adapts nutrition.analyzeLabForNutrients (the request slip)
// ===========================================================================
/**
 * toNutritionDocProps(slip, { role, client, referenceId }) → dossier props.
 * `slip` is the REAL NaturopathRequestSlip from nutrition.analyzeLabForNutrients (already
 * role-softened upstream). Operator sees citation lists + the naturopathic "how"; a CLIENT
 * view drops them. Sections: S01 Findings & Why · S02 Discussion Plan · S03 Reference ·
 * S04 Supportive Lifestyle · S05 Provider-Review. No dose, ever — the form is named, not the dose.
 */
function toNutritionDocProps(slip, opts = {}) {
  if (!slip) return null;
  const isClient = String(opts.role || '').toUpperCase() === 'CLIENT';
  const client = opts.client || null;
  const status = slip.status || 'DRAFT';
  const recs = arr(slip.recommendations);
  const providerReview = arr(slip.providerReview);

  // S01 — Findings & Why: one card per out-of-range nutrient. FORM, not dose.
  const findings = recs.map((r) => {
    const b = r.basis || {};
    const studies = b.studies || {};
    return {
      name: r.nutrient,
      descriptor: r.suggestedForm || null,           // names a FORM, never a dose (client-safe)
      role: r.signal === 'HIGH' ? 'Above reference range' : 'Below reference range',
      roleTone: 'support',
      marker: r.marker,
      alsoFromMarkers: arr(r.alsoFromMarkers),
      value: r.value, unit: r.unit, refLow: r.refLow, refHigh: r.refHigh, flag: r.flag,
      headline: b.headline || null,
      tier: b.tier || null,                          // ESTABLISHED | SUPPORTIVE | EMERGING
      tierLabel: b.label || null,
      foodFirst: arr(r.foodFirst),
      ask: r.ask || null,
      // Operator-only finding line + citations (the engine already strips citations from a CLIENT slip).
      finding: isClient ? null : (studies.finding || null),
      citations: isClient ? [] : labelCitations(studies.citations),
      // Peptide ⇄ nutrition cross-reference (real, from PEPTIDE_ADDITIONS — may be []).
      peptideContext: arr(r.peptideContext),
    };
  });

  // S02 — Discussion Plan: a flat table of what to raise (NO week-band grid).
  const discussionItems = recs.map((r) => ({
    nutrient: r.nutrient,
    form: r.suggestedForm || null,
    ask: r.ask || null,
  }));

  // S05 — Provider-review-only flags (electrolytes = coral 'provider review only'; never an OTC suggestion).
  const providerReviewFlags = providerReview.map((p) => ({
    marker: p.marker,
    nutrient: p.nutrient || null,
    value: p.value, unit: p.unit, refLow: p.refLow, refHigh: p.refHigh, flag: p.flag,
    reason: p.reason || null,
    ask: isClient ? null : (p.ask || null),
    supplementSuggested: false,
    action: p.action || null,
  }));

  const supportiveLifestyle = docStandard.supportiveLifestyleFor({
    title: 'Nutrition follow-up', goal: 'nutrient repletion and food-first support',
  });

  const stats = [
    { value: slip.summary ? slip.summary.reviewed : '—', label: 'Markers reviewed', tone: 'slate' },
    { value: slip.summary ? slip.summary.inRange : '—', label: 'In range', tone: 'slate' },
    { value: recs.length || '—', label: 'Nutrient notes', tone: recs.length ? 'slate' : 'coral' },
    { value: providerReview.length || '—', label: 'Provider review', tone: providerReview.length ? 'coral' : 'slate' },
  ];

  const meta = [
    { label: 'Prepared for', value: (client && client.name) || slip.forClient || '—' },
    { label: 'Document', value: 'Naturopath request slip' },
    { label: 'Findings', value: recs.map((r) => r.nutrient).join(' · ') || 'None out of range' },
    { label: 'Referral', value: (slip.referral && slip.referral.category) || 'Nutritional / functional medicine review' },
    { label: 'Naturopath', value: DR_LUN.contact ? `${DR_LUN.name} · ${DR_LUN.contact}` : DR_LUN.name },
    { label: 'Source', value: 'Vitalis Research' },
    { label: 'Reference', value: opts.referenceId || refId(slip, 'VN') },
  ];

  return {
    kind: 'NUTRITION',
    mode: isClient ? 'client' : 'operator',
    status,
    docClass: 'Naturopath Request Slip · Research Document',
    title: 'Naturopath Request — Nutrient Findings',
    thesis: slip.intro || null,
    cover: { meta, review: REVIEW_BAND },
    stats,
    sections: {
      findings: {                       // S01
        items: findings,
        intro: slip.intro || null,
        tierLegend: NUTRITION_TIER_LEGEND,
        emptyState: findings.length ? null : 'No out-of-range nutrients found in the confirmed values.',
      },
      discussionPlan: {                 // S02
        items: discussionItems,
        intro: 'Bring these to your naturopath — and ask what this misses. Forms are named for context; the dose is your naturopath’s call.',
        emptyState: discussionItems.length ? null : 'No nutrient discussion items — nothing flagged from the confirmed values.',
      },
      reference: {                      // S03
        items: findings,                // per-nutrient basis tier + foodFirst + (operator) citations
        tierLegend: NUTRITION_TIER_LEGEND,
        intro: 'The nutrition-science / naturopathic-practice basis behind each note — including evidence tier and food-first sources.',
      },
      supportiveLifestyle,              // S04
      providerReview: {                 // S05
        items: providerReviewFlags,
        intro: 'Electrolytes and out-of-range values we do not suggest supplementing — these are for provider review only, never an over-the-counter suggestion.',
        emptyState: providerReviewFlags.length ? null : null,
      },
    },
    aggregatorNote: AGGREGATOR_CALLOUT,
    referral: slip.referral || null,
    evidence: { kind: 'NUTRITION', tierLegend: NUTRITION_TIER_LEGEND },
    disclaimers: arr(slip.disclaimers),
    disclaimer: (slip.disclaimers && slip.disclaimers[0]) || (docStandard.protocolDisclaimer().body),
    languageOk: slip.languageOk !== false,
    provider: providerBlock(),
  };
}

// ===========================================================================
// SUPPLEMENT-ONLY helpers — a NARROW reshape of existing lab/client/corpus data into the richer
// mini-dossier sections. They mint NOTHING clinical: lab findings come from the existing
// gates.labResultFlagGate over the client's REAL recorded draws; priority is deterministic from
// tier + flag; "why it matters" is goal-framed research/context phrasing, never a diagnosis. Used
// ONLY by toSupplementDocProps — nutrition / meal / blood-req are untouched.
// ===========================================================================

// ── CLIENT-VIEW GOVERNMENT-SOURCE HARDENING (stricter than the doctrine; enforced in the SUPPLEMENT
//    projection only — research-doctrine.js is off-limits and stays the practitioner/metadata rule) ──
//
// Marc rule (2026-06): a government / public-health body (NIH, NIH ODS, WHO, Health Canada, MedlinePlus,
// CDC, FDA, …) must NOT appear by NAME in the CLIENT-facing evidence language, and must NEVER be the
// efficacy backbone. Practitioners and the research-library metadata still see the underlying reference;
// clients see neutral research-tier language only. Efficacy stays NEEDS_SOURCE unless a real PEER-REVIEWED
// (journal/PMID/DOI) source backs it — never a government reference.
const CLIENT_GOV_SOURCETYPE = 'established_reference'; // client-facing relabel for government_reference
// Phrases that name a government / public-health body in client-visible free text → neutral wording.
const GOV_NAME_SCRUBS = [
  [/\bNIH Office of Dietary Supplements\b/gi, 'an established nutrition reference'],
  [/\bOffice of Dietary Supplements\b/gi, 'an established nutrition reference'],
  [/\bNIH ODS\b/gi, 'an established nutrition reference'],
  [/\bNIH-ODS\b/gi, 'an established nutrition reference'],
  [/\bNIH\b/gi, 'an established nutrition reference'],
  [/\bHealth Canada DRIs\b/gi, 'national dietary-reference intakes'],
  [/\bHealth Canada\b/gi, 'a national health reference'],
  [/\bMedlinePlus\b/gi, 'a consumer-health reference'],
  [/\bWorld Health Organization\b/gi, 'an international health reference'],
  [/\bWHO\b/g, 'an international health reference'],
  [/\bMedline\b/gi, 'a consumer-health reference'],
  [/\bGovernment nutrition reference\b/gi, 'Established nutrition reference'],
  [/\bGovernment\s*\/\s*regulatory\b/gi, 'Established / consensus'],
  [/\bgovernment\b/gi, 'established-reference'],
  [/\bregulatory\b/gi, 'reference'],
];
function scrubGovNames(text) {
  if (text == null) return text;
  let out = String(text);
  for (const [re, sub] of GOV_NAME_SCRUBS) out = out.replace(re, sub);
  return out;
}
// Client projection of one provenance row: drop full citation detail (existing rule) AND neutralize any
// government source name / label in the visible fields. sourceTitle/citation/urlOrPmid already null for
// client; here we also relabel sourceType and scrub claimSupported/limitations free text.
function clientizeProvenanceRow(r) {
  return {
    ...r,
    sourceTitle: null,
    citation: null,
    urlOrPmid: null,
    sourceType: r.sourceType === 'government_reference' ? CLIENT_GOV_SOURCETYPE : r.sourceType,
    claimSupported: scrubGovNames(r.claimSupported),
    limitations: scrubGovNames(r.limitations),
  };
}

// COSMETIC: suppress a form descriptor that just repeats the nutrient name. "Magnesium glycinate" +
// form "glycinate" → don't render "Magnesium glycinate glycinate"; "Vitamin D3 + K2" + "D3 with K2" →
// drop the redundant form; a genuinely distinct form (Iron … + "ferrous bisglycinate") is kept once.
// Returns the form to DISPLAY, or null when it is redundant with the name.
function displayForm(name, form) {
  if (!form) return null;
  const n = norm(name);
  const f = norm(form);
  if (!f) return null;
  if (n === f) return null;                       // exact duplicate
  if (n.includes(f)) return null;                 // form is already contained in the name
  // form-tokens that are all present in the name (e.g. "D3 with K2" vs "Vitamin D3 + K2") → redundant.
  const nameTokens = new Set(n.split(' ').filter(Boolean));
  const formTokens = f.split(' ').filter((t) => t && t !== 'with' && t !== 'and');
  if (formTokens.length && formTokens.every((t) => nameTokens.has(t))) return null;
  return form;
}

// A flagged-marker label is humanized for the findings phrasing (lab status word).
function labStatusWord(flag) {
  if (flag === 'OUT_OF_RANGE_LOW') return 'low';
  if (flag === 'OUT_OF_RANGE_HIGH') return 'high';
  if (flag === 'IN_RANGE') return 'optimal';
  return 'needs review';
}

// Marker-specific "why it matters" one-liners — research/context phrasing only (NOT a diagnosis). Used
// when a marker has no T5 community match so each marker reads distinctly (no repeated boilerplate across
// hs-CRP / AST / ALT / etc.). Matched by normalized substring against the marker name.
const MARKER_CONTEXT = [
  [/hs[\s-]?crp|c[\s-]?reactive/, 'hs-CRP is a general inflammation signal, commonly discussed in recovery and cardiometabolic contexts'],
  [/\bast\b|aspartate/, 'AST is a liver / hepatic enzyme, commonly read alongside ALT for liver context'],
  [/\balt\b|alanine/, 'ALT is a liver / hepatic enzyme, commonly discussed in liver-health context'],
  [/ferritin|\biron\b/, 'Ferritin reflects iron stores, commonly discussed in energy and fatigue context'],
  [/magnesium|\bmg\b/, 'Magnesium is commonly discussed in sleep, muscle, and metabolic context'],
  [/vitamin d|25[\s-]?oh|calcidiol/, 'Vitamin D is commonly discussed in bone, immune, and muscle context'],
  [/b12|cobalamin/, 'Vitamin B12 is commonly discussed in energy, nerve, and red-cell context'],
  [/folate|b9/, 'Folate is commonly discussed in red-cell and methylation context'],
  [/zinc/, 'Zinc is commonly discussed in immune, skin, and hormone context'],
  [/calcium/, 'Calcium is commonly discussed in bone-health context (read with vitamin D and albumin)'],
  [/glucose|\ba1c\b|hba1c/, 'This marker is commonly discussed in metabolic / glucose-handling context'],
];
function markerContextLine(markerName) {
  const m = norm(markerName);
  for (const [re, line] of MARKER_CONTEXT) if (re.test(m)) return line;
  return null;
}

// Why a marker matters for THIS client's goal — research/context phrasing, NOT diagnosis. Sourced from
// the nutrient corpus' community.usedFor where a nutrient maps; otherwise a marker-specific context line
// (and only then a neutral fallback) — so markers never share identical boilerplate.
function whyMarkerMatters(markerName, goals) {
  const profile = supplementsResearch.researchProfileForNutrient(markerName);
  const goalStr = arr(goals).join(', ');
  const t5 = profile && (profile.rows || []).find((r) => r.evidenceTier === 'T5' && r.claimSupported);
  const ctx = t5 ? String(t5.claimSupported).replace(/\.\s*Reported.*$/i, '').trim() : null;
  const specific = markerContextLine(markerName);
  const base = ctx
    ? `${ctx}.`
    : (specific
      ? `${specific}.`
      : `${markerName} is flagged for review as a practitioner-interpretation item.`);
  return `${base}${goalStr ? ` Relevant to your stated goal (${goalStr}).` : ''} This is a practitioner-review item, not a prescription.`;
}

/**
 * deriveLabFindings(labResults) → { findings[], baselineDate, latestDate, hasBaseline }
 *   labResults: [{ drawnAt, values:[{marker,value,unit,refLow,refHigh}] }] (the client's recorded draws)
 * Runs the SAME gates.labResultFlagGate the lab tracker uses (no new clinical logic). Threads
 * baseline → latest so each marker carries a status, a baseline-vs-latest delta, and a trend word.
 * Out-of-range does NOT become a diagnosis — every status is a screening flag with review phrasing.
 */
function deriveLabFindings(labResults, goals) {
  const draws = arr(labResults)
    .filter((r) => r && arr(r.values).length)
    .slice()
    .sort((a, b) => new Date(a.drawnAt || 0) - new Date(b.drawnAt || 0)); // oldest → newest
  if (!draws.length) return { findings: [], baselineDate: null, latestDate: null, hasBaseline: false };

  const baseline = draws[0];
  const latest = draws[draws.length - 1];
  const hasBaseline = draws.length > 1;

  const flaggedLatest = gates.labResultFlagGate(latest).values;
  const flaggedBaseline = gates.labResultFlagGate(baseline).values;
  const baselineByMarker = new Map(flaggedBaseline.map((v) => [norm(v.marker), v]));

  const findings = flaggedLatest.map((v) => {
    const prior = hasBaseline ? baselineByMarker.get(norm(v.marker)) : null;
    let trend = null;
    if (prior && prior.value != null && v.value != null && prior.value !== v.value) {
      const towardRange =
        (v.refLow != null && v.value >= v.refLow && (prior.value < prior.refLow)) ||
        (v.refHigh != null && v.value <= v.refHigh && (prior.value > prior.refHigh)) ||
        (prior.flag !== 'IN_RANGE' && v.flag === 'IN_RANGE');
      const movedUp = v.value > prior.value;
      trend = {
        baseline: prior.value, latest: v.value, unit: v.unit || prior.unit || null,
        direction: movedUp ? 'up' : 'down',
        normalized: towardRange,
        word: towardRange ? 'improving — moved toward range' : (prior.flag === 'IN_RANGE' && v.flag === 'IN_RANGE' ? 'stable in range' : 'changed — review'),
      };
    } else if (prior && prior.value === v.value) {
      trend = { baseline: prior.value, latest: v.value, unit: v.unit || null, direction: 'flat', normalized: v.flag === 'IN_RANGE', word: 'unchanged' };
    }
    const status = trend && trend.normalized && v.flag === 'IN_RANGE' ? 'improving' : labStatusWord(v.flag);
    return {
      marker: v.marker,
      value: v.value, unit: v.unit || null, refLow: v.refLow, refHigh: v.refHigh, flag: v.flag,
      status,                                    // low | high | optimal | improving | needs review
      source: 'lab',                             // lab | lifestyle | protocol | practitioner note
      whyItMatters: whyMarkerMatters(v.marker, goals),
      trend,                                     // baseline-vs-latest delta (null when no prior)
      outOfRange: String(v.flag).startsWith('OUT_OF_RANGE'),
      action: v.action || null,                  // gate's review phrasing, never a diagnosis
    };
  });

  return {
    findings,
    baselineDate: baseline.drawnAt || null,
    latestDate: latest.drawnAt || null,
    hasBaseline,
  };
}

/**
 * derivePriorityRanking(targets, findings) → ranked supplement targets. Deterministic from the
 * engine's nutrition tier + the matched lab finding's severity — NO new claim. Bands:
 *   Priority 1 (strongest lab/lifestyle match) · Priority 2 (supportive) · Optional / watchlist ·
 *   Hold / not recommended (placeholder for provider-only items; targets here are already safe).
 */
function derivePriorityRanking(targets, findings) {
  const findingByName = new Map(arr(findings).map((f) => [norm(f.marker), f]));
  const tierRank = { ESTABLISHED: 0, SUPPORTIVE: 1, EMERGING: 2 };
  const ranked = arr(targets).map((t) => {
    // A target matches a lab finding when the marker name shares a stem (Vitamin D ↔ Vitamin D (25-OH)).
    const match = arr(findings).find((f) => {
      const a = norm(f.marker); const b = norm(t.nutrient || t.name);
      return a && b && (a.includes(b.split(' ')[0]) || b.includes(a.split(' ')[0]));
    }) || findingByName.get(norm(t.nutrient || t.name)) || null;
    const tier = t.tier || t.evidenceTier || null;
    const flaggedOut = match && match.outOfRange;
    let band, why;
    if (flaggedOut && tierRank[tier] === 0) {
      band = 'Priority 1'; why = `Strongest match: ${match.marker} is ${match.status} on labs and the reference basis is established.`;
    } else if (flaggedOut) {
      band = 'Priority 1'; why = `Direct lab match: ${match.marker} is ${match.status} on labs.`;
    } else if (match && match.status === 'improving') {
      band = 'Optional / watchlist'; why = `${match.marker} is improving toward range — supportive watch rather than a new priority.`;
    } else if (tierRank[tier] != null && tierRank[tier] <= 1) {
      band = 'Priority 2'; why = 'Supportive: reference basis present, no direct out-of-range lab driver.';
    } else {
      band = 'Optional / watchlist'; why = 'Optional support — limited/emerging basis and no out-of-range lab driver.';
    }
    return { nutrient: t.nutrient || t.name, form: t.suggestedForm || t.descriptor || null, tier, band, why, marker: match ? match.marker : null };
  });
  const order = { 'Priority 1': 0, 'Priority 2': 1, 'Optional / watchlist': 2, 'Hold / not recommended': 3 };
  ranked.sort((a, b) => (order[a.band] - order[b.band]));
  return ranked;
}

// ===========================================================================
// toSupplementDocProps — adapts supplements.generateSupplementPlan (the plan DRAFT)
// ===========================================================================
/**
 * toSupplementDocProps(plan, { role, client, referenceId, labResults }) → dossier props.
 * `plan` is the REAL SupplementPlanDraft. PENDING_LABS surfaces honestly (no suggestions
 * invented). nutrientTargets name a FORM, not a dose. Evidence tiers ESTABLISHED/SUPPORTIVE/EMERGING.
 *
 * NEW (research mini-dossier): when `opts.labResults` (the client's recorded draws) is passed, the
 * adapter threads them through gates.labResultFlagGate to derive REAL Lab+Lifestyle Findings,
 * baseline-vs-latest deltas, and a deterministic Priority Ranking — plus a per-claim Research Basis &
 * Source Transparency payload (honest T1–T5 / NEEDS_SOURCE tiering, no fabrication). Backward
 * compatible: with no labResults the original six section keys (and tests VD2/DF3/DF4) are unchanged.
 */
function toSupplementDocProps(plan, opts = {}) {
  if (!plan) return null;
  const isClient = String(opts.role || '').toUpperCase() === 'CLIENT';
  const client = opts.client || null;
  const status = plan.status || 'DRAFT';
  const pending = status === 'PENDING_LABS';

  const nutrientTargets = arr(plan.nutrientTargets).map((t) => ({
    nutrient: t.nutrient,
    // descriptor is the card-header form shown NEXT TO the name → suppress it when it just repeats the
    // name ("Magnesium glycinate" + "glycinate"). suggestedForm keeps the raw form for the labeled
    // "Form: …" body line + priority ranking (where it reads standalone, not duplicated).
    descriptor: displayForm(t.nutrient, t.suggestedForm),
    suggestedForm: t.suggestedForm || null,
    tier: t.evidenceTier || null,                    // ESTABLISHED | SUPPORTIVE | EMERGING
    tierLabel: t.evidenceLabel || null,
    targetIsNull: !(t.target && t.target.target != null), // the dose is the naturopath's call → null
    basis: (t.target && t.target.basis) || null,
    // Operator-only study basis (the engine already dropped citations from a CLIENT plan).
    finding: isClient ? null : (t.studies && t.studies.finding) || null,
    citations: isClient ? [] : labelCitations(t.studies && t.studies.citations),
  }));

  const foodFirstOptions = arr(plan.foodFirstOptions).map((f) => ({ nutrient: f.nutrient, options: arr(f.options) }));
  // Timing-table form column: suppress a form that just repeats the nutrient name (same cosmetic rule).
  const discussionItems = arr(plan.discussionItems).map((d) => ({ nutrient: d.nutrient, form: displayForm(d.nutrient, d.form), ask: d.ask || null }));

  const providerReviewFlags = arr(plan.providerReviewFlags).map((p) => ({
    marker: p.marker, nutrient: p.nutrient || null, flag: p.flag || null,
    reason: p.reason || null, supplementSuggested: false, action: p.action || null,
  }));

  const peptideNotes = plan.peptideNotes ? {
    onProtocol: !!plan.peptideNotes.onProtocol,
    monitoringMarkers: arr(plan.peptideNotes.monitoringMarkers),
    detail: arr(plan.peptideNotes.detail),
    note: plan.peptideNotes.note || null,
  } : null;

  const supportiveLifestyle = docStandard.supportiveLifestyleFor({
    title: 'Supplement support', goal: (arr(plan.goals).join(' ') || 'nutrient repletion') + ' food-first',
  });

  // ── Research mini-dossier ADD-ONS (additive — original keys above are unchanged) ───────────────
  const goals = arr(plan.goals);
  const monitoringMarkers = (peptideNotes && peptideNotes.monitoringMarkers) || [];

  // Lab + Lifestyle Findings — derived from the client's REAL recorded draws via gates.labResultFlagGate
  // (baseline → latest). Lifestyle is genuinely absent unless the plan carries it → honest "not captured".
  const labDerived = deriveLabFindings(opts.labResults, goals);
  const lifestyleContext = arr(plan.lifestyleContext || (client && client.lifestyleContext));
  const lifestyleCaptured = lifestyleContext.length > 0;
  const lifestyleFindings = lifestyleContext.map((l) => ({
    marker: l.label || l.area || 'Lifestyle', status: l.status || 'needs review', source: 'lifestyle',
    whyItMatters: l.note || null, trend: null, outOfRange: false,
  }));
  const intakeQuestions = [
    'Typical sleep window and sleep quality (hours, wakeups, sleep latency).',
    'Training / activity load (sessions per week, intensity, recovery between sessions).',
    'Stress level and stressors, and any shift / circadian disruption.',
    'Dietary pattern (protein adequacy, alcohol, caffeine timing) and any restrictions/allergies.',
    'Current supplements and the timing you take them.',
  ];

  // Priority Ranking — deterministic from tier + flag severity (no new claim).
  const priorityRanking = derivePriorityRanking(nutrientTargets, labDerived.findings);

  // Research Basis & Source Transparency — honest per-claim provenance (T1–T5 / NEEDS_SOURCE), no fabrication.
  const researchBasis = supplementsResearch.buildResearchBasis({
    targets: nutrientTargets,
    providerReviewFlags: providerReviewFlags.concat(labDerived.findings.filter((f) => f.outOfRange).map((f) => ({ marker: f.marker, flag: f.flag }))),
    monitoringMarkers,
    lifestyleCaptured,
  });
  // CLIENT view: show tiers + source categories, but DROP full citation URLs/titles (operator keeps them)
  // AND neutralize every government source NAME/label in the visible language (stricter Marc rule —
  // a government body is never named to a client, never the efficacy backbone). Operator/metadata intact.
  const provenanceRows = (researchBasis.provenance || []).map((r) => (isClient ? clientizeProvenanceRow(r) : r));
  // Government-use disclosure + corpus note: practitioner keeps the named-source version; the client gets a
  // neutral, no-government-name version. (A government source remains reference/safety only — never efficacy.)
  const clientGovUse = {
    used: researchBasis.govUse && researchBasis.govUse.used,
    purpose: (researchBasis.govUse && researchBasis.govUse.used)
      ? 'Established nutrition / safety references (and your own lab reference ranges) are used ONLY for ' +
        'reference, deficiency context, and safety — never as the efficacy backbone. Efficacy claims are ' +
        'backed only by peer-reviewed studies, or shown honestly as a source gap.'
      : null,
  };
  const govUseOut = isClient ? clientGovUse : researchBasis.govUse;
  const researchNoteOut = isClient ? scrubGovNames(researchBasis.note) : researchBasis.note;

  const flaggedCount = labDerived.findings.filter((f) => f.outOfRange).length;

  // Exec summary narrative (cover) — what / why / inputs used / what needs review / resource-only.
  const inputsUsed = [
    labDerived.findings.length ? `lab values (${labDerived.findings.length} markers${labDerived.hasBaseline ? ', baseline vs latest' : ''})` : null,
    lifestyleCaptured ? 'lifestyle context' : null,
    (peptideNotes && peptideNotes.onProtocol) ? 'current protocol' : null,
  ].filter(Boolean);
  const execSummary = {
    goal: goals.join(', ') || 'general optimization (no specific goal recorded)',
    whyGenerated: 'This plan was generated to give you a vetted, research-tiered starting point for a supplement conversation with your naturopath — not a prescription.',
    inputsUsed: inputsUsed.length ? inputsUsed : ['no confirmed labs yet (PENDING_LABS)'],
    needsReview: [
      flaggedCount ? `${flaggedCount} lab marker(s) flagged for practitioner interpretation` : null,
      nutrientTargets.length ? `dose, timing, suitability and duration for ${nutrientTargets.length} supplement target(s)` : null,
      researchBasis.counts.needsSource ? `${researchBasis.counts.needsSource} efficacy claim(s) carrying a source gap (NEEDS_SOURCE)` : null,
      lifestyleCaptured ? null : 'lifestyle detail not yet captured at intake',
    ].filter(Boolean),
    resourceDisclaimer:
      'Educational research resource only. Vitalis is a research aggregator, not a prescriber. Final dose, ' +
      'timing, suitability, and duration require practitioner review.',
  };

  // Client snapshot — goals, lifestyle (or honest gap), protocol, allergies/preferences, active flags.
  const clientSnapshot = {
    name: (client && client.name) || (plan.forClient || null),
    goals,
    lifestyle: lifestyleCaptured
      ? { captured: true, items: lifestyleFindings }
      : { captured: false, note: 'Lifestyle detail not yet captured — intake should ask:', intakeQuestions },
    currentProtocol: (client && arr(client.currentProducts)) || (peptideNotes && peptideNotes.onProtocol ? ['On a current protocol'] : []),
    allergiesPreferences: arr(plan.contraindications).concat(arr(plan.preferences)),
    activeLabFlags: labDerived.findings.filter((f) => f.outOfRange).map((f) => ({ marker: f.marker, status: f.status, value: f.value, unit: f.unit })),
    baselineVsLatest: labDerived.hasBaseline ? 'Baseline and latest draws both on file — deltas shown in Findings.' : (labDerived.latestDate ? 'Single recorded draw on file.' : 'No labs threaded.'),
  };
  const stats = [
    { value: nutrientTargets.length || (pending ? '—' : 0), label: 'Nutrient targets', tone: nutrientTargets.length ? 'slate' : 'coral' },
    { value: labDerived.findings.length || '—', label: 'Markers reviewed', tone: 'slate' },
    { value: flaggedCount || '—', label: 'Flagged for review', tone: flaggedCount ? 'coral' : 'slate' },
    { value: researchBasis.counts.needsSource || '—', label: 'Source gaps', tone: researchBasis.counts.needsSource ? 'coral' : 'slate' },
  ];

  const baselineVsLatest = labDerived.hasBaseline
    ? `Baseline ${String(labDerived.baselineDate || '').slice(0, 10)} → latest ${String(labDerived.latestDate || '').slice(0, 10)}`
    : (labDerived.latestDate ? `Single draw ${String(labDerived.latestDate).slice(0, 10)}` : 'No recorded labs threaded');

  const meta = [
    { label: 'Prepared for', value: (client && client.name) || '—' },
    { label: 'Document', value: 'Supplement plan (research resource)' },
    { label: 'Goals', value: arr(plan.goals).join(' · ') || '—' },
    { label: 'Targets', value: nutrientTargets.map((t) => t.nutrient).join(' · ') || (pending ? 'Pending labs' : 'None') },
    { label: 'Labs', value: baselineVsLatest },
    { label: 'Naturopath', value: DR_LUN.contact ? `${DR_LUN.name} · ${DR_LUN.contact}` : DR_LUN.name },
    { label: 'Source', value: 'Vitalis Research' },
    { label: 'Reference', value: opts.referenceId || refId(plan, 'VS') },
  ];

  return {
    kind: 'SUPPLEMENT',
    mode: isClient ? 'client' : 'operator',
    status,
    docClass: 'Supplement Plan · Research Document',
    title: 'Supplement Plan — From Your Labs',
    thesis: pending ? (plan.reason || null) : 'A request to review with your naturopath — built from your confirmed lab values.',
    cover: { meta, review: REVIEW_BAND, execSummary },
    stats,
    pending,
    pendingReason: pending ? (plan.reason || 'A supplement plan is built from confirmed lab values (PENDING_LABS).') : null,
    sections: {
      // ── EXISTING six keys (tests VD2/DF3 assert these BY NAME — never renamed/removed) ──────────
      nutrientTargets: {
        items: nutrientTargets,
        tierLegend: NUTRITION_TIER_LEGEND,
        intro: 'Each target names a FORM for context only — the dose is your naturopath’s call.',
        emptyState: nutrientTargets.length ? null : (pending ? (plan.reason || null) : 'No nutrient targets flagged from the confirmed values.'),
      },
      foodFirst: {
        items: foodFirstOptions,
        intro: 'Diet-first sources to discuss before any supplement — why food-first matters before/alongside a supplement.',
        emptyState: foodFirstOptions.length ? null : null,
      },
      discussionPlan: {
        items: discussionItems,
        intro: 'The exact items to raise with your naturopath.',
        emptyState: discussionItems.length ? null : null,
      },
      providerReview: {
        items: providerReviewFlags,
        intro: 'Electrolytes and out-of-range values we do not suggest supplementing — provider review only.',
        emptyState: providerReviewFlags.length ? null : null,
      },
      supportiveLifestyle,
      peptideNotes,                     // monitoring (sourced from PEPTIDE_ADDITIONS; may be empty)

      // ── NEW research-mini-dossier sections (ADDED alongside — never replace the six above) ──────
      clientSnapshot,                   // S02 — goals · lifestyle (or honest gap) · protocol · allergies · active flags
      labFindings: {                    // S03 — per-marker status + why + baseline-vs-latest delta (research phrasing)
        items: labDerived.findings,
        lifestyle: clientSnapshot.lifestyle,
        baselineDate: labDerived.baselineDate,
        latestDate: labDerived.latestDate,
        hasBaseline: labDerived.hasBaseline,
        intro: labDerived.findings.length
          ? 'Each marker carries a status, why it matters for your goal, and (where a prior draw exists) the baseline-vs-latest movement. These are research/context notes for practitioner review — not a diagnosis.'
          : 'No lab values were threaded into this plan — nothing to interpret honestly.',
        emptyState: labDerived.findings.length ? null : 'No recorded labs available for this plan.',
      },
      priorityRanking: {                // S04 — Priority 1 / 2 / optional-watchlist, deterministic from tier + flag
        items: priorityRanking,
        intro: 'Priority is derived deterministically from the evidence tier and the strength of the lab/lifestyle match — Priority 1 (strongest lab match) → Priority 2 (supportive) → Optional / watchlist. It is a discussion ordering, not an instruction to start anything.',
        emptyState: priorityRanking.length ? null : 'No targets to rank.',
      },
      monitoring: {                     // S08 — what to track + which labs to recheck (reuses requisition data, read-only)
        markers: monitoringMarkers,
        recheckPanel: panelsCfg.BASELINE ? { label: panelsCfg.BASELINE.label, fasting: !!panelsCfg.BASELINE.fasting } : null,
        reviewInterval: 'Re-check at the practitioner-set interval (commonly ~8–12 weeks for repletion markers); the practitioner sets the schedule.',
        weeklyTracking: (supportiveLifestyle && supportiveLifestyle.weeklyTracking) || [],
        triggers: [
          'A flagged marker that does not move toward range by the review point.',
          'Any new or worsening symptom, or a tolerance issue if a supplement is started under practitioner guidance.',
        ],
        intro: 'What to track between visits and which labs to recheck — the recheck panel is read from the bloodwork requisition source (never invented). The practitioner sets cadence and follow-up triggers.',
      },
      practitionerReview: {             // S09 — practitioner-view checklist (operator only)
        items: isClient ? [] : [
          { label: 'Confirm lab interpretation', body: 'Review the flagged markers and baseline-vs-latest deltas; confirm or revise the screening read.' },
          { label: 'Check contraindications / interactions', body: 'Screen the supplement forms against the current protocol, allergies, and medications.' },
          { label: 'Set dose / timing / duration', body: 'If approving, set the dose, timing, and duration (the plan deliberately leaves dose null).' },
          { label: 'Confirm monitoring plan', body: 'Confirm which markers to recheck and the review interval.' },
          { label: 'Approve / modify / hold', body: 'Record the decision for each target — approve, modify, or hold.' },
        ],
        intro: isClient ? null : 'Practitioner review checklist — confirm before authorizing any item.',
        operatorOnly: true,
      },
    },
    // S10 — Evidence Reference (tier + plain-English reason + source category; UNKNOWN/weak stays visible).
    evidenceReference: {
      tierLegend: supplementsResearch.RESEARCH_TIER_LEGEND,
      items: provenanceRows.map((r) => ({
        appliesTo: r.appliesTo, evidenceTier: r.evidenceTier, sourceType: r.sourceType,
        claimSupported: r.claimSupported, reviewStatus: r.reviewStatus,
        citation: r.citation, urlOrPmid: r.urlOrPmid,
      })),
      intro: 'Every claim, tiered with a plain-English reason and its source category. Weak / source-gap rows stay visible (UNKNOWN / NEEDS_SOURCE), never hidden.',
    },
    // S11 — Research Basis & Source Transparency (the per-claim provenance table + how tiering works).
    researchBasis: {
      tierLegend: researchBasis.tierLegend,
      provenance: provenanceRows,
      gapList: isClient ? (researchBasis.gapList || []).map((g) => ({ ...g, why: scrubGovNames(g.why), claim: scrubGovNames(g.claim) })) : researchBasis.gapList,
      counts: researchBasis.counts,
      govUse: govUseOut,
      note: researchNoteOut,
      intro:
        'How sources are tiered, which recommendations are strongly supported vs supportive-only vs ' +
        'practitioner/community reference vs source-gap, and why this is an educational research resource — ' +
        'not medical advice.',
    },
    aggregatorNote: AGGREGATOR_CALLOUT,
    referral: plan.referral || null,
    evidence: {
      kind: 'SUPPLEMENT',
      tierLegend: NUTRITION_TIER_LEGEND,
      researchTierLegend: supplementsResearch.RESEARCH_TIER_LEGEND,
      // CLIENT view never names a government body even in the provenance "source" string.
      source: isClient
        ? 'protocol-core/nutrient-evidence (established nutrition references + peer-reviewed studies)'
        : ((plan.evidence && plan.evidence.source) || 'protocol-core/nutrient-evidence'),
    },
    // SUPPLEMENT-specific disclaimer — NOT the peptide protocol disclaimer (which carries peptide-sourcing
    // language that does not belong on a supplement document).
    disclaimer: SUPPLEMENT_DISCLAIMER,
    languageOk: plan.languageOk !== false,
    provider: providerBlock(),
  };
}

// ===========================================================================
// toMealDocProps — adapts meals.generateMealPlan (the meal-plan DRAFT)
// ===========================================================================
/**
 * toMealDocProps(plan, { role, client, referenceId }) → dossier props.
 * `plan` is the REAL MealPlanDraft. macroTarget is PROVIDED/ESTIMATED/UNKNOWN (never a guessed
 * number). The 7-day plan renders as a flat table (per-meal + dayTotals; CURATED_ESTIMATE /
 * SOURCE_PENDING). HARD allergen / dislike exclusion is preserved (the engine already removed them).
 */
function toMealDocProps(plan, opts = {}) {
  if (!plan) return null;
  const isClient = String(opts.role || '').toUpperCase() === 'CLIENT';
  const client = opts.client || null;
  const mt = plan.macroTarget || { status: 'UNKNOWN' };
  const days = arr(plan.days);

  // S02 — the 7-day plan: per-meal rows + a day-total row per day (flat table, no week-band grid).
  const planDays = days.map((d) => ({
    day: d.day,
    meals: arr(d.meals).map((m) => ({
      slot: m.slot,
      name: m.name || null,
      status: m.status || (m.name ? 'CURATED_ESTIMATE' : 'SOURCE_PENDING'),
      note: m.note || null,
      kcal: m.kcal != null ? m.kcal : null,
      proteinG: m.protein != null ? m.protein : null,
      carbG: m.carb != null ? m.carb : null,
      fatG: m.fat != null ? m.fat : null,
      macroSource: m.macroSource || null,
    })),
    dayTotals: d.dayTotals || null,
  }));

  const groceryList = arr(plan.groceryList).map((g) => ({ item: g.item, mealsUsing: g.mealsUsing }));
  const substitutions = arr(plan.substitutions).map((s) => ({ excluded: s.excluded, reason: s.reason, alternatives: arr(s.alternatives) }));
  const prepNotes = arr(plan.prepNotes);
  const excluded = plan.excluded || { allergies: [], dislikes: [], dietaryStyle: null };

  const macroTarget = {
    status: mt.status,                  // PROVIDED | ESTIMATED | UNKNOWN
    kcal: mt.kcal != null ? mt.kcal : null,
    proteinG: mt.proteinG != null ? mt.proteinG : null,
    carbG: mt.carbG != null ? mt.carbG : null,
    fatG: mt.fatG != null ? mt.fatG : null,
    basis: mt.basis || null,
    providerReviewRequired: !!mt.providerReviewRequired,
    source: mt.source || null,
  };

  const stats = [
    { value: macroTarget.kcal != null ? macroTarget.kcal : 'UNKNOWN', label: macroTarget.status === 'ESTIMATED' ? 'kcal (estimated)' : 'kcal target', tone: macroTarget.kcal != null ? 'slate' : 'coral' },
    { value: macroTarget.proteinG != null ? `${macroTarget.proteinG}g` : '—', label: 'Protein', tone: 'slate' },
    { value: days.length || '—', label: 'Days planned', tone: 'slate' },
    { value: (arr(excluded.allergies).length + arr(excluded.dislikes).length) || '—', label: 'Hard exclusions', tone: (arr(excluded.allergies).length || arr(excluded.dislikes).length) ? 'coral' : 'slate' },
  ];

  const meta = [
    { label: 'Prepared for', value: (client && client.name) || '—' },
    { label: 'Document', value: plan.periodicity === 'monthly' ? 'Meal plan (monthly template)' : 'Meal plan (weekly)' },
    { label: 'Macro target', value: macroTarget.kcal != null ? `${macroTarget.kcal} kcal${macroTarget.status === 'ESTIMATED' ? ' (estimated)' : ''}` : 'UNKNOWN — practitioner to set' },
    { label: 'Excludes', value: [...arr(excluded.allergies), ...arr(excluded.dislikes)].join(' · ') || 'None' },
    { label: 'Practitioner', value: DR_LUN.contact ? `${DR_LUN.name} · ${DR_LUN.contact}` : DR_LUN.name },
    { label: 'Source', value: 'Vitalis Research' },
    { label: 'Reference', value: opts.referenceId || refId(plan, 'VM') },
  ];

  return {
    kind: 'MEAL',
    mode: isClient ? 'client' : 'operator',
    status: plan.status || 'DRAFT',
    docClass: 'Meal Plan · Research Document',
    title: plan.periodicity === 'monthly' ? 'Meal Plan — Monthly Template' : 'Meal Plan — Weekly',
    thesis: 'A research / educational meal plan generated from your inputs. Allergies and disliked foods are excluded from every meal. Macros are curated estimates pending verification.',
    cover: { meta, review: REVIEW_BAND },
    stats,
    sections: {
      macroTarget,                      // S01
      weeklyPlan: {                     // S02 — flat 7-day table
        days: planDays,
        periodicity: plan.periodicity || 'weekly',
        monthlyNote: plan.monthlyNote || null,
        intro: 'Per-meal macros are a CURATED_ESTIMATE pending verification; a food not in the seed is SOURCE_PENDING. Adjust portions to hit the target above — your practitioner can fine-tune.',
      },
      groceryList: { items: groceryList, intro: 'Aggregated across the meals above.' },
      substitutions: { items: substitutions, intro: 'For the allergens / dislikes that constrained the plan.' },
      prepNotes: { items: prepNotes },
      excluded,                         // HARD exclusion (allergies + dislikes), preserved
    },
    sourceNotes: arr(plan.sourceNotes),
    evidence: { kind: 'MEAL', macroSource: macroTarget.source },
    disclaimer:
      'Research / educational meal plan only — not medical advice, not a diagnosis, not a prescription. ' +
      'Allergies and disliked foods are hard-excluded. Macros are curated estimates pending USDA verification; ' +
      'an unknown calorie target is left UNKNOWN, never guessed. Review with your practitioner before use.',
    languageOk: plan.languageOk !== false,
    provider: providerBlock(),
  };
}

// ===========================================================================
// toBloodRequisitionDocProps — adapts lab-panels BASELINE + PEPTIDE_ADDITIONS
//   (the "bloodwork to order" requisition — same data packages.composeBloodworkFacet reads)
// ===========================================================================
/**
 * toBloodRequisitionDocProps(source, { role, client, referenceId }) → dossier props.
 * `source` carries { products?, labsSuggested?, scenarioId? } (a protocol draft or a thin
 * descriptor). BASELINE is rendered as category-grouped MARKER cards; PEPTIDE_ADDITIONS adds
 * product-driven markers + cadence (never invented — a NEEDS_SOURCE panel surfaces honestly).
 * 'what moves predictably' is sourced from lab-scenarios. Dr. Vincent Lun is the referral.
 */
function toBloodRequisitionDocProps(source, opts = {}) {
  const src = source || {};
  const isClient = String(opts.role || '').toUpperCase() === 'CLIENT';
  const client = opts.client || null;
  const products = arr(src.products).length ? arr(src.products) : ((client && arr(client.currentProducts)) || []);
  const labsSuggested = arr(src.labsSuggested);

  // BASELINE — gated SOURCED, rendered as category-grouped marker cards (lab test names; safe for both views).
  const baselineGate = require('./gates').labPanelGate(panelsCfg.BASELINE);
  const baselineSections = arr(panelsCfg.BASELINE.sections).map((s) => ({ section: s.section, markers: arr(s.markers) }));
  const baselineMarkerCount = baselineSections.reduce((n, s) => n + s.markers.length, 0);

  // PEPTIDE_ADDITIONS — product-driven cadence additions, sourced (never invented). Empty when no monitored compound.
  const blob = products.map(norm).join(' ');
  const additions = [];
  for (const add of arr(panelsCfg.PEPTIDE_ADDITIONS)) {
    if (arr(add.match).some((m) => blob.includes(norm(m)))) {
      additions.push({ markers: arr(add.markers), cadence: add.cadence || null, matchedOn: add.match[0] });
    }
  }
  const additionMarkers = [...new Set(additions.flatMap((a) => a.markers))];

  // Honest NEEDS_SOURCE panels (e.g. male low-T / full hormone): surfaced, NEVER populated with invented markers.
  const needsSourcePanels = arr(panelsCfg.OPTIONAL)
    .filter((p) => p.status === 'NEEDS_SOURCE')
    .map((p) => ({ id: p.id, label: p.label, status: 'NEEDS_SOURCE', needs: p.needs || 'Markers not enumerated in any source — NEEDS_SOURCE.', markers: [] }));

  // 'What moves predictably' — sourced from lab-scenarios deltas (movement toward range, never a treatment claim).
  let predictableMovement = null;
  const scen = src.scenarioId ? labScenarios.labScenarioReport(src.scenarioId) : null;
  if (scen) {
    predictableMovement = {
      scenario: scen.title,
      note: scen.reviewNote,
      markers: arr(scen.deltas).filter((d) => d.direction === 'INTO_RANGE' || d.direction === 'CHANGED').map((d) => ({
        marker: d.marker, direction: d.direction, baseline: d.baseline, followUp: d.followUp, unit: d.unit,
      })),
    };
  }

  const stats = [
    { value: baselineMarkerCount, label: 'Baseline markers', tone: 'slate' },
    { value: baselineSections.length, label: 'Categories', tone: 'slate' },
    { value: additionMarkers.length || '—', label: 'Protocol additions', tone: additionMarkers.length ? 'slate' : 'slate' },
    { value: needsSourcePanels.length || '—', label: 'Needs source', tone: needsSourcePanels.length ? 'coral' : 'slate' },
  ];

  const requisitionNote =
    `Bring this request to ${DR_LUN.name}. We aggregate the research so you arrive with a vetted starting ` +
    'point — he reviews everything, and adds anything he sees missing, before any labs are drawn. The decisions are his and yours.';

  const meta = [
    { label: 'Prepared for', value: (client && client.name) || src.forClient || '—' },
    { label: 'Document', value: 'Bloodwork requisition (to order)' },
    { label: 'Baseline panel', value: panelsCfg.BASELINE.label },
    { label: 'Protocol additions', value: additionMarkers.join(' · ') || 'None (no monitored compound)' },
    { label: 'Referral physician', value: DR_LUN.contact ? `${DR_LUN.name} · ${DR_LUN.contact}` : DR_LUN.name },
    { label: 'Source', value: 'Vitalis Research' },
    { label: 'Reference', value: opts.referenceId || refId(src, 'VB') },
  ];

  return {
    kind: 'BLOOD_REQ',
    mode: isClient ? 'client' : 'operator',
    status: src.status || 'TO_ORDER',
    docClass: 'Bloodwork Requisition · Research Document',
    title: 'Bloodwork to Order',
    thesis: requisitionNote,
    cover: { meta, review: REVIEW_BAND },
    stats,
    sections: {
      baseline: {                       // category-grouped MARKER cards
        id: panelsCfg.BASELINE.id,
        label: panelsCfg.BASELINE.label,
        status: baselineGate.status,    // SOURCED
        source: panelsCfg.BASELINE.source,
        fasting: !!panelsCfg.BASELINE.fasting,
        sections: baselineSections,
        markerCount: baselineMarkerCount,
        intro: 'Dr. Lun’s Enhanced Healthy Living Assessment — the baseline panel, grouped by category.',
      },
      safetyMonitoring: {               // PEPTIDE_ADDITIONS cadence (sourced; empty honestly)
        status: additions.length ? 'SOURCED' : 'EMPTY',
        markers: additionMarkers,
        detail: additions,
        basedOn: products,
        intro: 'Product-driven additions layered on the baseline — sourced from the peptide-additions mapping, never invented.',
      },
      needsSource: {                    // NEEDS_SOURCE panels shown honestly
        items: needsSourcePanels,
        intro: 'These panels are not enumerated in any source file — surfaced honestly as NEEDS_SOURCE. Markers are never invented.',
      },
      suggested: { items: labsSuggested },
      predictableMovement,              // 'what moves predictably' from lab-scenarios (may be null)
    },
    aggregatorNote: AGGREGATOR_CALLOUT,
    requisitionNote,
    referral: { provider: providerBlock(), category: 'Bloodwork ordering & interpretation' },
    evidence: { kind: 'BLOOD_REQ', source: panelsCfg.BASELINE.source, provenance: panelsCfg._provenance },
    disclaimer:
      'Lab ordering and interpretation are your naturopath’s call — this is a request to review, not a diagnosis. ' +
      'Markers shown are sourced from Dr. Lun’s baseline panel and the peptide-additions mapping; panels with no ' +
      'enumerated source are shown as NEEDS_SOURCE and never populated with invented markers.',
    languageOk: true,
    provider: providerBlock(),
  };
}

module.exports = {
  NUTRITION_TIER_LEGEND,
  toNutritionDocProps,
  toSupplementDocProps,
  toMealDocProps,
  toBloodRequisitionDocProps,
};
