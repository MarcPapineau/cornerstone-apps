/**
 * nutrition.js — the deficiency → "request for your naturopath" engine.
 *
 * The directive, made concrete: a client drags in their lab report; the system reads it,
 * and for out-of-range vitamins/minerals produces a SLIP they take to their naturopath
 * (Dr. Vincent Lun) — "ask about these, and ask what this misses." NOT a prescription,
 * NOT a diagnosis. Grounded in real clinical/nutrition science (nutrient-evidence.js) —
 * "not just the peptide but also for naturopathy."
 *
 * This wires the RESERVED Nutrition slot (reserved.js NutritionProfile / NutrientTarget /
 * nutritionGate) to a real engine, reusing the existing rails — never rebuilding them:
 *   • labResultFlagGate (gates.js)       → IN_RANGE / OUT_OF_RANGE_LOW/HIGH per value
 *   • the two-source basis discipline     → composeNutrientBasis mirrors presentation.composeBasis
 *   • role softening by key-presence       → CLIENT drops citation list + naturopathic "how"
 *   • languageGate (gates.js)             → self-check: zero medical-claim language
 *   • providers.js Dr. Vincent Lun        → the named naturopath on the slip
 *   • lab-panels.PEPTIDE_ADDITIONS         → the peptide ⇄ nutrition cross-reference
 *
 * The ingest model is "Extract + confirm": parseLabText does a best-effort local parse
 * (no external service, no OCR — text/CSV/TSV/paste only); the surface shows the result in
 * an editable grid for the human to CONFIRM before anything is analyzed. We never silently
 * trust a misread value.
 *
 * NOT medical advice. NOT a prescription. NOT legal advice.
 */

const gates = require('./gates');
const reserved = require('./reserved');
const presentation = require('./presentation');
const NE = require('./data/nutrient-evidence');
const providersCfg = require('./data/providers');
const panelsCfg = require('./data/lab-panels');

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Tidy a parsed marker label: drop a trailing ":" / stray separators and surrounding space.
const cleanMarker = (s) => String(s || '').replace(/\s*[:\-–—]\s*$/, '').trim();

// ===========================================================================
// 1) parseLabText — dependency-free, best-effort. Output is CONFIRMED by a human.
// ===========================================================================

// A reference range: two numbers joined by a dash / en-dash / "to", optionally
// wrapped in parens or prefixed "Ref:". Returns { refLow, refHigh, matchText } or null.
const RANGE_RE = /\(?\s*(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)\s*\)?/i;
function extractRange(text) {
  const m = String(text).match(RANGE_RE);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
  // Order defensively (some reports print high-low).
  return { refLow: Math.min(lo, hi), refHigh: Math.max(lo, hi), matchText: m[0] };
}

const PURE_NUM_RE = /^-?\d+(?:\.\d+)?$/;
// A unit looks like a word that is NOT a pure number and NOT a flag word; allows µ/μ, %, /, ^.
const UNIT_RE = /^[A-Za-zµμ%][A-Za-z0-9µμ%/.^·-]*$/;
const FLAG_WORDS = new Set(['low', 'high', 'h', 'l', 'normal', 'abnormal', 'flag', 'critical', 'pos', 'neg']);
const HEADER_WORDS = ['marker', 'test', 'analyte', 'value', 'result', 'unit', 'units', 'reference', 'range', 'ref', 'flag'];

function looksLikeHeader(cells) {
  const joined = norm(cells.join(' '));
  const hits = HEADER_WORDS.filter((w) => joined.split(' ').includes(w)).length;
  // A header has several header words and no pure-number cell acting as a value.
  const hasNumber = cells.some((c) => PURE_NUM_RE.test(String(c).trim()));
  return hits >= 2 && !hasNumber;
}

// Parse one already-split set of delimited cells: marker | value | unit | (range | low | high)
function parseCells(cells, raw) {
  const clean = cells.map((c) => String(c).trim()).filter((c) => c !== '');
  if (clean.length < 2) return null;
  const marker = clean[0];
  if (!norm(marker)) return null;
  let value = null, unit = null, refLow = null, refHigh = null;
  for (let i = 1; i < clean.length; i++) {
    const cell = clean[i];
    const range = extractRange(cell);
    if (range && !PURE_NUM_RE.test(cell)) { refLow = range.refLow; refHigh = range.refHigh; continue; }
    if (PURE_NUM_RE.test(cell)) {
      if (value == null) value = Number(cell);
      else if (refLow == null) refLow = Number(cell);
      else if (refHigh == null) refHigh = Number(cell);
      continue;
    }
    if (FLAG_WORDS.has(norm(cell))) continue;
    if (value != null && unit == null && UNIT_RE.test(cell)) unit = cell;
  }
  if (value == null) return null;
  return { marker: cleanMarker(marker), value, unit, refLow, refHigh, raw };
}

// Parse one loose, whitespace-only line: "Vitamin B12 145 pmol/L (138-652)".
function parseLooseLine(line) {
  const raw = line;
  let work = line;
  let refLow = null, refHigh = null;
  const range = extractRange(work);
  if (range) { refLow = range.refLow; refHigh = range.refHigh; work = work.replace(range.matchText, ' '); }
  const tokens = work.split(/\s+/).filter(Boolean);
  // value = first PURE number token (so "B12", "D3", "25-OH" stay part of the marker).
  let valueIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (PURE_NUM_RE.test(tokens[i])) { valueIdx = i; break; }
  }
  if (valueIdx <= 0) return null; // no marker words before a value → not a result line
  const marker = tokens.slice(0, valueIdx).join(' ');
  if (!norm(marker)) return null;
  const value = Number(tokens[valueIdx]);
  let unit = null;
  for (let i = valueIdx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (PURE_NUM_RE.test(t)) { // a trailing bare low/high pair without a dash
      if (refLow == null) { refLow = Number(t); continue; }
      if (refHigh == null) { refHigh = Number(t); continue; }
      continue;
    }
    if (FLAG_WORDS.has(norm(t))) continue;
    if (unit == null && UNIT_RE.test(t)) { unit = t; continue; }
  }
  return { marker: cleanMarker(marker), value, unit, refLow, refHigh, raw };
}

function parseLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  if (/^(#|\/\/|;)/.test(trimmed)) return null; // comment

  // Choose a delimiter. Markers (e.g. "Vitamin B12") survive because the delimiter,
  // not whitespace, separates the marker cell from the value cell.
  let cells = null;
  if (trimmed.includes('\t')) cells = trimmed.split('\t');
  else if (trimmed.includes('|')) cells = trimmed.split('|');
  else if (trimmed.includes(',')) cells = trimmed.split(',');
  else if (/\s{2,}/.test(trimmed)) cells = trimmed.split(/\s{2,}/);

  if (cells) {
    if (looksLikeHeader(cells)) return null;
    const out = parseCells(cells, trimmed);
    if (out) return out;
    // fall through to loose parsing if the delimited attempt failed
  }
  if (looksLikeHeader(trimmed.split(/\s+/))) return null;
  return parseLooseLine(trimmed);
}

/**
 * parseLabText(text) → { rows, skipped }
 *   rows    : [{ marker, value, unit, refLow, refHigh, raw }]  (value is a Number)
 *   skipped : [raw]  — non-blank lines we could not confidently parse (shown so the
 *                       human can add them manually; we never invent a value)
 */
function parseLabText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const rows = [];
  const skipped = [];
  for (const line of lines) {
    if (!String(line).trim()) continue;
    const parsed = parseLine(line);
    if (parsed) rows.push(parsed);
    else if (!looksLikeHeader(String(line).trim().split(/\s+/))) skipped.push(String(line).trim());
  }
  return { rows, skipped };
}

// ===========================================================================
// 2) composeNutrientBasis — two-source, role-aware basis (mirrors presentation.composeBasis)
// ===========================================================================

// Returns the SAME shape composeBasis returns, so the SAME UI BasisBlock renders it.
// Honest nutrition tiers (not the peptide tiers): ESTABLISHED / SUPPORTIVE / EMERGING.
function composeNutrientBasis({ entry, role, signal }) {
  const isClient = String(role || '').toUpperCase() === 'CLIENT';
  const rec = entry.evidenceRec;
  const com = entry.community;

  let tier, label;
  if (com.basis === 'EMERGING') { tier = 'EMERGING'; label = 'Emerging — limited data'; }
  else if (rec.hasClinicalTrial) { tier = 'ESTABLISHED'; label = 'Established nutrition science (clinical guidelines)'; }
  else { tier = 'SUPPORTIVE'; label = 'Supportive evidence — discuss with your naturopath'; }

  const citations = Array.isArray(rec.citations) ? rec.citations : [];
  const studies = {
    strength: rec.hasClinicalTrial ? 'GUIDELINE_TRIALS' : 'GUIDELINE',
    hasClinicalTrial: !!rec.hasClinicalTrial,
    evidenceLevel: rec.evidenceLevel || 'GUIDELINE',
    citationCount: rec.citationCount || citations.length,
    // `summary` is qualitative standard-of-practice — never a fabricated number.
    finding: rec.summary || presentation.bestFinding(citations),
    mechanism: presentation.plainMechanism(rec.mechanism),
    // Operators get the full citation list; clients get count + the single finding line.
    citations: isClient ? undefined : citations.map((c) => ({ title: c.title, source: c.source, url: c.url, type: c.type })),
  };

  const community = {
    usedFor: com.usedFor || [],
    reportedBenefits: com.reportedBenefits || [],
    benefitsLabel: presentation.BENEFITS_LABEL,
    evidenceNote: com.evidenceNote,
    // The naturopathic "how" (form/dose feel) is practitioner-only — same boundary as peptides.
    ...(isClient ? {} : { pattern: com.pattern || null }),
  };

  const dir = signal === 'HIGH' ? 'is above your lab’s reference range' : 'is below your lab’s reference range';
  const headline =
    `Your ${entry.name} ${dir} — here is what nutrition science and naturopathic practice ` +
    `suggest discussing for ${entry.name}. Reference only, not a prescription.`;

  return { framing: 'attribution', tier, label, headline, studies, community };
}

// Shim mirroring data/community.communityFor, for symmetry / external reuse.
function nutrientCommunityFor(nutrientId) {
  const e = NE.ALL.find((x) => x.nutrientId === nutrientId);
  return e ? e.community : null;
}

// ===========================================================================
// 3) peptide ⇄ nutrition cross-reference (real, sourced from lab-panels.PEPTIDE_ADDITIONS)
// ===========================================================================
function peptideMonitoringFor(marker, products = []) {
  const m = norm(marker);
  const productBlob = norm((products || []).join(' '));
  const hits = [];
  for (const add of panelsCfg.PEPTIDE_ADDITIONS || []) {
    const monitorsMarker = (add.markers || []).some((mk) => {
      const n = norm(mk);
      return n && (n.includes(m) || m.includes(n.split(' ')[0]));
    });
    if (!monitorsMarker) continue;
    const onProtocol = (add.match || []).some((token) => productBlob.includes(norm(token)));
    hits.push({ compounds: add.match, cadence: add.cadence, relevantToProducts: onProtocol });
  }
  // If the client lists products, prefer the ones they are actually on.
  const relevant = hits.filter((h) => h.relevantToProducts);
  return relevant.length ? relevant : hits;
}

// ===========================================================================
// 4) analyzeLabForNutrients — the request slip
// ===========================================================================
const DR_LUN = (providersCfg.PROVIDERS || []).find((p) => p.id === 'dr_vincent_lun') || { name: 'Dr. Vincent Lun' };
const NUTRIENT_REFERRAL = (providersCfg.REFERRAL_CATEGORIES || []).find((c) => c.trigger === 'nutrientDeficiency');

const SLIP_BANNER =
  'REQUEST SLIP — RESOURCE ONLY · NOT A PRESCRIPTION · NOT A DIAGNOSIS · bring to Dr. Vincent Lun';
const NOT_A_PRESCRIPTION =
  'This slip is generated from your own lab values for you to bring to Dr. Vincent Lun. ' +
  'It is not a prescription and not a diagnosis. Out-of-range does not by itself confirm a deficiency. ' +
  'Please ask Dr. Vincent Lun to review these notes — and to flag anything they miss.';
const AGGREGATOR_NOTE =
  'Vitalis is a research aggregator: we surface the relevant nutrition science so you have a vetted ' +
  'starting point for the conversation, not a replacement for it. The decisions stay between you and Dr. Vincent Lun.';

function actionableDirection(entry, flag) {
  if (entry.actOn === 'BOTH') return flag === 'OUT_OF_RANGE_LOW' || flag === 'OUT_OF_RANGE_HIGH';
  if (entry.actOn === 'HIGH') return flag === 'OUT_OF_RANGE_HIGH';
  return flag === 'OUT_OF_RANGE_LOW';
}

/**
 * analyzeLabForNutrients({ values, role, products, clientName })
 *   values   : [{ marker, value, unit, refLow, refHigh }]  (already confirmed by the human)
 *   role     : 'CLIENT' softens (drops citation lists + naturopathic "how")
 *   products : [string]  current peptide products, for the peptide ⇄ nutrition cross-ref
 * Returns a role-aware "request for your naturopath" slip. Never throws on bad input.
 */
function analyzeLabForNutrients({ values = [], role, products = [], clientName } = {}) {
  const isClient = String(role || '').toUpperCase() === 'CLIENT';

  // Normalize + flag using the SAME gate the lab tracker uses.
  const coerced = (values || []).map((v) => ({
    marker: v.marker || 'Unknown marker',
    value: num(v.value),
    unit: v.unit || null,
    refLow: num(v.refLow),
    refHigh: num(v.refHigh),
  }));
  const flagged = gates.labResultFlagGate({ values: coerced }).values;

  const recommendations = [];   // safe nutrient suggestions (out-of-range, supplementSafe)
  const providerReview = [];    // electrolytes + unmapped out-of-range + wrong-direction (no supplement)
  const seenNutrient = new Map(); // nutrientId → recommendation (dedupe; collect all markers)
  let reviewedCount = 0;
  let inRangeCount = 0;

  for (const v of flagged) {
    reviewedCount++;
    if (v.flag === 'IN_RANGE') { inRangeCount++; continue; }
    const outOfRange = String(v.flag).startsWith('OUT_OF_RANGE');
    const entry = NE.matchNutrient(v.marker);

    if (!outOfRange) continue; // NO_RANGE with no flag → nothing to say honestly

    if (!entry) {
      providerReview.push({
        marker: v.marker, value: v.value, unit: v.unit, flag: v.flag,
        refLow: v.refLow, refHigh: v.refHigh,
        reason: 'Out of range with no matching nutrient in our reference — review this value with your provider.',
        supplementSuggested: false,
        action: v.action,
      });
      continue;
    }

    const signal = v.flag === 'OUT_OF_RANGE_HIGH' ? 'HIGH' : 'LOW';

    if (!actionableDirection(entry, v.flag)) {
      // e.g. a vitamin flagged HIGH when only LOW is actionable → provider review, no supplement.
      providerReview.push({
        marker: v.marker, value: v.value, unit: v.unit, flag: v.flag,
        refLow: v.refLow, refHigh: v.refHigh,
        nutrient: entry.name,
        reason: `Out of range in a direction we do not suggest supplementing — review your ${entry.name} with your provider.`,
        supplementSuggested: false,
        action: v.action,
      });
      continue;
    }

    if (entry.supplementSafe === false) {
      // Electrolytes — provider-review ONLY, never an OTC suggestion.
      providerReview.push({
        marker: v.marker, value: v.value, unit: v.unit, flag: v.flag,
        refLow: v.refLow, refHigh: v.refHigh,
        nutrient: entry.name,
        reason: entry.evidenceRec.summary,
        supplementSuggested: false,
        ask: entry.naturopathAsk,
        action: v.action,
      });
      continue;
    }

    // A safe, actionable micronutrient → a request-slip recommendation.
    // Dedupe: if two markers map to the same nutrient (e.g. "Vitamin D" + "25-OH Vitamin D"),
    // keep one card and record both contributing markers rather than doubling the suggestion.
    if (seenNutrient.has(entry.nutrientId)) {
      seenNutrient.get(entry.nutrientId).alsoFromMarkers.push(v.marker);
      continue;
    }
    const basis = composeNutrientBasis({ entry, role, signal });
    const target = reserved.NutrientTarget({
      nutrient: entry.name,
      unit: entry.unit,
      target: null, // never guessed — the dose is the naturopath's call
      basis: 'Deficiency context from NIH ODS / Health Canada (dose individualized by your naturopath)',
      source: 'protocol-core/nutrient-evidence',
    });
    const peptideContext = peptideMonitoringFor(v.marker, products);

    const rec = {
      marker: v.marker,
      alsoFromMarkers: [],                 // other report rows that mapped to the same nutrient
      value: v.value,
      unit: v.unit,
      refLow: v.refLow,
      refHigh: v.refHigh,
      flag: v.flag,
      signal,
      nutrient: entry.name,
      suggestedForm: entry.form,           // names a form, never a dose (client-safe)
      foodFirst: entry.foodFirst,          // diet-first, client-safe
      ask: entry.naturopathAsk,            // the exact thing to ask Dr. Vincent Lun
      target,                              // NutrientTarget with target:null (not guessed)
      basis,                               // two-source, role-softened
      peptideContext,                      // real peptide ⇄ nutrition cross-reference (may be [])
    };
    recommendations.push(rec);
    seenNutrient.set(entry.nutrientId, rec);
  }

  const providerReviewSuggested = recommendations.length > 0 || providerReview.length > 0;

  const referral = {
    provider: { name: DR_LUN.name, role: DR_LUN.role || null, contact: DR_LUN.contact || null },
    category: NUTRIENT_REFERRAL ? NUTRIENT_REFERRAL.label : 'Nutritional / functional medicine review',
    disclaimer: NUTRIENT_REFERRAL ? NUTRIENT_REFERRAL.disclaimer : 'Referral category suggestion — not a diagnosis.',
  };

  const slip = {
    _model: 'NaturopathRequestSlip',
    module: 'nutrition',
    status: 'DRAFT',
    isResourceOnly: true,
    isPrescription: false,
    banner: SLIP_BANNER,
    title: `Request for your naturopath — ${DR_LUN.name}`,
    forClient: clientName || null,
    role: isClient ? 'CLIENT' : (role || 'PRACTITIONER'),
    intro: NOT_A_PRESCRIPTION,
    aggregatorNote: AGGREGATOR_NOTE,
    providerReviewSuggested,
    recommendations,
    providerReview,
    referral,
    summary: {
      reviewed: reviewedCount,
      inRange: inRangeCount,
      flagged: recommendations.length + providerReview.length,
      nutrientSuggestions: recommendations.length,
      providerOnly: providerReview.length,
    },
    disclaimers: [
      NOT_A_PRESCRIPTION,
      AGGREGATOR_NOTE,
      referral.disclaimer,
    ],
  };

  // Self-check (Gate 9): nothing we generated may carry medical-claim language.
  // Scan ONLY the free text this engine authored (citation titles/URLs are data, not claims).
  const authored = [
    slip.banner, slip.title, slip.intro, slip.aggregatorNote, referral.category, referral.disclaimer,
    ...recommendations.flatMap((r) => [r.ask, r.basis.headline, r.basis.community && r.basis.community.evidenceNote, r.basis.studies && r.basis.studies.finding].filter(Boolean)),
    ...providerReview.flatMap((p) => [p.reason, p.ask].filter(Boolean)),
  ].join('  \n  ');
  const lang = gates.languageGate(authored);
  slip.languageOk = lang.ok;
  if (!lang.ok) slip.languageViolations = lang.violations;

  return slip;
}

module.exports = {
  // parsing (Extract + confirm)
  parseLabText,
  parseLine,
  extractRange,
  // engine
  analyzeLabForNutrients,
  composeNutrientBasis,
  nutrientCommunityFor,
  peptideMonitoringFor,
  // re-exports for convenience
  matchNutrient: NE.matchNutrient,
  NUTRIENT_EVIDENCE: NE,
};
