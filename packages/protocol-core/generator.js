/**
 * generator.js — the conversational protocol GENERATOR for @vitalis/protocol-core.
 *
 * This is the in-app analogue of "asking the chat to build a protocol", made safe.
 * The deal is simple and is the whole governance story:
 *
 *        AI (or the deterministic mapper) PROPOSES   →   the GATES DISPOSE.
 *
 * A proposer turns a natural-language goal ("fat loss + recovery") into a set of
 * candidate catalog itemRefs. It is allowed to do exactly ONE creative thing: pick
 * which REAL catalog items to consider. It cannot invent a product (catalog gate),
 * cannot invent a citation (research gate), cannot blur a route (route gate), cannot
 * dodge Canadian compliance (compliance gate), cannot emit medical-claim language
 * (language gate), and cannot mint anything past DRAFT/RESOURCE-ONLY (status gate) —
 * because its output is fed straight into assembleDraft(), the SAME gate chain the
 * manual Draft Builder uses. The generator adds nothing that can bypass a gate.
 *
 * On top of that it implements the dosing-liability levers:
 *   (1) attribution not instruction   — dosing rendered via dosing.researchRangeLabel()
 *   (2) source-locked dosing           — UNKNOWN where not curated (dosing.js)
 *   (3) practitioner-mediated          — a specific client dose only after approval
 *   (4) practitioner attestation        — practitionerAttestationGate()
 *   (5) two-tier output                — attachDosing(role): practitioner vs client view
 *   (6) jurisdiction acknowledgment    — jurisdictionAcknowledgmentGate()
 *
 * Pluggable backend: pass opts.propose (e.g. an Anthropic-SDK adapter, env-guarded by
 * ANTHROPIC_API_KEY) to let an LLM choose the catalog items. If none is supplied, the
 * deterministic goal→category→candidate mapper runs. Either way the gates run after.
 *
 * NOT medical advice. NOT legal advice.
 */

const gates = require('./gates');
const dosingLib = require('./data/dosing');
const communityLib = require('./data/community');
const presentation = require('./presentation');

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── Goal → evidence-category map ─────────────────────────────────────────────
// Mirrors @vitalis/stack-core's GOAL_TO_CATEGORY intent, expressed against the six
// evidence categories that actually exist in this corpus (healing, weight, antiaging,
// performance, immune, cognitive). Keyword-driven so free-text goals resolve. The same
// canonical goal vocabulary the consumer surface uses — kept here as CJS to avoid the
// ESM/CJS bridge friction (stack-core is type:module; this package is CommonJS).
const GOAL_KEYWORDS = [
  { category: 'weight', label: 'Fat loss / metabolic', match: ['fat loss', 'fat-loss', 'weight', 'lose weight', 'slim', 'metabolic', 'metabolism', 'glp', 'obesity', 'leaner', 'cut', 'cutting'] },
  { category: 'healing', label: 'Healing & recovery', match: ['heal', 'healing', 'recovery', 'recover', 'injury', 'injured', 'tendon', 'ligament', 'joint', 'wound', 'gut', 'gi', 'tissue', 'repair', 'inflammation', 'post-surgery', 'rehab'] },
  { category: 'performance', label: 'Athletic performance / growth axis', match: ['performance', 'muscle', 'strength', 'athletic', 'gym', 'lean mass', 'growth hormone', 'gh', 'igf', 'power', 'endurance', 'libido', 'sexual', 'erectile', 'testosterone'] },
  { category: 'antiaging', label: 'Anti-aging / mitochondrial / energy', match: ['anti-aging', 'antiaging', 'aging', 'longevity', 'mitochondria', 'mitochondrial', 'energy', 'cellular', 'nad', 'skin', 'collagen', 'fatigue'] },
  { category: 'immune', label: 'Immune support', match: ['immune', 'immunity', 'defense', 'defence', 'infection', 'sick', 'resilience'] },
  { category: 'cognitive', label: 'Cognitive / focus / sleep', match: ['cognit', 'focus', 'brain', 'memory', 'nootropic', 'mood', 'anxiety', 'sleep', 'neuro', 'mental'] },
];

// Parse free text into matched goal categories (ordered by appearance/priority).
function parseGoals(goalText) {
  const t = ' ' + normName(goalText) + ' ';
  const matched = [];
  for (const g of GOAL_KEYWORDS) {
    const hit = g.match.find((m) => t.includes(' ' + normName(m) + ' ') || t.includes(normName(m)));
    if (hit) matched.push({ category: g.category, label: g.label, matchedOn: hit });
  }
  return matched;
}

const EVIDENCE_RANK = { HIGH: 4, MODERATE: 3, MEDIUM: 3, LOW: 2, UNKNOWN: 1, null: 0 };

// Build a category → [compoundId] index from the evidence corpus, ranked best-first
// (HIGH evidence + has-catalog-product + citationCount). Pure over its inputs.
function indexCandidatesByCategory(evidenceByCompound, productByCompound) {
  const byCat = {};
  for (const [id, rec] of Object.entries(evidenceByCompound || {})) {
    const cat = rec.category || 'UNKNOWN';
    (byCat[cat] ||= []).push({
      compoundId: id,
      name: rec.name || id,
      evidenceLevel: rec.evidenceLevel || 'UNKNOWN',
      citationCount: rec.citationCount || 0,
      hasProduct: !!(productByCompound[id] && productByCompound[id].length),
    });
  }
  for (const cat of Object.keys(byCat)) {
    byCat[cat].sort((a, b) =>
      (b.hasProduct - a.hasProduct) ||
      ((EVIDENCE_RANK[b.evidenceLevel] || 0) - (EVIDENCE_RANK[a.evidenceLevel] || 0)) ||
      (b.citationCount - a.citationCount) ||
      a.compoundId.localeCompare(b.compoundId));
  }
  return byCat;
}

// Map a catalog into { compoundId -> [products] } (first product is the canonical pick).
function productsByCompound(catalogIndex) {
  const map = {};
  for (const p of (catalogIndex && catalogIndex.list) || []) {
    if (!p.evidenceCompoundId) continue;
    (map[p.evidenceCompoundId] ||= []).push(p);
  }
  return map;
}

// ── The deterministic proposer ───────────────────────────────────────────────
// goal text → matched categories → best curated+stocked compound per category →
// canonical co-dose expansion → real catalog itemRefs. Honors the canonical rules in
// dosing.PROTOCOL_RULES (co-dose pairs, never-with exclusions). Returns itemRefs plus a
// human-readable reasoning trail. NEVER returns an off-catalog item.
function deterministicPropose(goalText, ctx) {
  const { evidenceByCompound, catalogIndex, maxItems = 4 } = ctx;
  const productByCompound = productsByCompound(catalogIndex);
  const byCat = indexCandidatesByCategory(evidenceByCompound, productByCompound);
  const matchedGoals = parseGoals(goalText);

  const reasoning = [];
  const chosen = [];          // ordered list of compoundIds
  const chosenSet = new Set();
  const rules = dosingLib.PROTOCOL_RULES;

  const neverConflict = (id) =>
    rules.neverWith.some(([a, b]) =>
      (a === id && chosenSet.has(b)) || (b === id && chosenSet.has(a)));

  function add(compoundId, why) {
    if (chosenSet.has(compoundId)) return false;
    if (chosen.length >= maxItems) return false;
    if (!productByCompound[compoundId] || !productByCompound[compoundId].length) {
      reasoning.push(`· skipped ${compoundId}: no source-of-truth catalog product (cannot draft an off-catalog item).`);
      return false;
    }
    if (neverConflict(compoundId)) {
      reasoning.push(`· skipped ${compoundId}: canonical "never-with" rule (GHRH redundancy) conflicts with an already-selected item.`);
      return false;
    }
    chosen.push(compoundId);
    chosenSet.add(compoundId);
    reasoning.push(why);
    return true;
  }

  if (!matchedGoals.length) {
    reasoning.push('No goal keywords recognized — nothing proposed. Try terms like "fat loss", "recovery", "energy", "focus", "immune".');
  }

  // One best compound per matched goal category.
  for (const g of matchedGoals) {
    const pool = byCat[g.category] || [];
    const pick = pool.find((c) => c.hasProduct && !chosenSet.has(c.compoundId));
    if (pick) {
      add(pick.compoundId, `· ${g.label}: selected ${pick.name} (${pick.evidenceLevel} evidence, ${pick.citationCount} citation(s)) as a research-supported option.`);
    } else {
      reasoning.push(`· ${g.label}: no stocked, evidence-backed candidate available — surfaced as UNKNOWN.`);
    }
  }

  // Canonical co-dose expansion (SS-31↔MOTS-c, Cardiogen→SS-31, CJC↔Ipamorelin).
  for (const id of [...chosen]) {
    for (const [a, b] of rules.coDose) {
      const partner = a === id ? b : (b === id ? a : null);
      if (partner && !chosenSet.has(partner)) {
        add(partner, `· co-dose rule: ${partner} added because it is canonically co-dosed with ${id}.`);
      }
    }
  }

  const itemRefs = chosen.map((compoundId) => ({ productId: productByCompound[compoundId][0].id, compoundId }));
  return { itemRefs, reasoning, matchedGoals, source: 'deterministic' };
}

// ── Optional LLM proposer hook (env-guarded, dependency-free) ─────────────────
// If a caller supplies opts.propose we use it; otherwise, if ANTHROPIC_API_KEY is set
// AND an adapter function is injected via opts.llmProposeFn, we use that; otherwise we
// fall back to the deterministic mapper. We deliberately do NOT hard-require an SDK here
// so the package runs locally with zero external deps and zero network. The adapter, when
// wired, MUST return the same shape ({ itemRefs:[{productId}], reasoning, source:'llm' })
// and its items still pass through every gate below — an LLM cannot widen the safety surface.
function resolveProposer(opts) {
  if (typeof opts.propose === 'function') return opts.propose;
  const key = (opts.env && opts.env.ANTHROPIC_API_KEY) || process.env.ANTHROPIC_API_KEY;
  if (key && typeof opts.llmProposeFn === 'function') {
    return (goalText, ctx) => opts.llmProposeFn(goalText, { ...ctx, apiKey: key });
  }
  return deterministicPropose;
}

// ── Dosing attribution (lever 1, 2, 5) ───────────────────────────────────────
// Attach role-aware, attribution-framed dosing to each gated item. Practitioner/admin
// get the full DRAFT view (range + titration + taper + canonical rules). Client gets the
// softened "discuss with your practitioner" view with NO titration/taper schedule — a
// client never receives a personal dosing schedule from the generator (lever 3 + 5).
function attachDosing(draft, role, dosingCfg = dosingLib) {
  const isClient = String(role || '').toUpperCase() === 'CLIENT';
  const items = (draft.items || []).map((it) => {
    const entry = dosingCfg.dosingFor(it.evidenceCompoundId);
    // SELECTED schedule comes straight from the canonical engine (selectedScheduleFor) — never synthesized here.
    const sched = dosingCfg.selectedScheduleFor ? dosingCfg.selectedScheduleFor(it.evidenceCompoundId) : null;
    const doseAmount = dosingCfg.formatDoseAmount ? dosingCfg.formatDoseAmount(entry.perDose) : null;
    // Honesty signals — client-safe (they NEVER reveal a personal schedule), shown to both roles.
    const sourceLayer = sched ? {
      sourceType: sched.sourceBasis,
      confidence: sched.confidence,
      sourceNote: sched.sourceNote,
      citations: dosingCfg.dosingCitations ? dosingCfg.dosingCitations(it.evidenceCompoundId) : [],
      doseAmount,                                                  // explicit amount + unit — shown to both roles
      doseAmountLine: doseAmount || dosingCfg.NEEDS_DOSE_LINE,     // amount OR the honest gap line
      selectionStatus: sched.scheduleStatus,
      needsSource: sched.scheduleStatus === 'NEEDS_SOURCE',
    } : {};
    if (isClient) {
      return {
        ...it,
        dosing: {
          status: entry.status,
          framing: 'attribution',
          label: dosingCfg.clientRangeLabel(entry),
          note: 'Educational reference only — your practitioner determines if and how this applies to you.',
          // NB: titration / taper / schedule deliberately omitted for the client view.
          ...sourceLayer,
          cautions: entry.cautions || [],
        },
      };
    }
    return {
      ...it,
      dosing: {
        status: entry.status,
        framing: 'attribution',
        label: dosingCfg.researchRangeLabel(entry),
        sourceLine: sched ? (sched.scheduleStatus === 'NEEDS_SOURCE' ? dosingCfg.NEEDS_SOURCE_LINE : sched.selectedDose) : null,   // headline incl. the exact NEEDS_SOURCE line
        titration: entry.titration || null,
        taper: entry.taper || null,
        maintenance: (sched && sched.maintenance) || null,
        ceiling: (sched && sched.ceiling) || entry.ceiling || null,
        schedule: entry.schedule || null,
        frequency: entry.frequency || null,
        cycleWeeks: entry.cycleWeeks || null,
        route: it.route || null,
        form: it.form || null,
        ...sourceLayer,
        coDoseWith: entry.coDoseWith || [],
        neverWith: entry.neverWith || [],
        cautions: entry.cautions || [],
        basis: entry.basis,
      },
    };
  });
  return { ...draft, items };
}

// ── Two-source presentation (studies ⊕ community) ────────────────────────────
// Attach the role-aware basis block to each gated item: "here's what the studies show"
// (from the evidence corpus) and/or "here's what the greater community does" (from
// community.js). This is the anti-"overly cautious" layer — useful, attributed, never an
// instruction and never a fabricated number. Client view drops the administration how-to.
function attachBasis(draft, role, evidenceByCompound = {}, goalLabel, community = communityLib) {
  const items = (draft.items || []).map((it) => ({
    ...it,
    basis: presentation.composeBasis({
      compoundId: it.evidenceCompoundId,
      evidenceRec: evidenceByCompound[it.evidenceCompoundId],
      community,
      role,
      goalLabel,
      productName: it.productName,
    }),
  }));
  return { ...draft, items };
}

// ── Practitioner LICENSE acknowledgment (responsibility shift) ────────────────
// Distinct from the per-protocol jurisdiction gate. This is the software-license-level
// acknowledgment a licensing practitioner accepts: Vitalis provides access to research-
// and community-aggregated protocols; the practitioner owns their own due diligence and
// professional qualifications and how they use the output. Returns ok/blocked; the server
// logs it. NEVER auto-passes.
function practitionerLicenseAcknowledgmentGate(ack) {
  const a = ack || {};
  const reasons = [];
  if (a.acceptedResponsibility !== true) reasons.push('Must accept responsibility for your own professional due diligence and use of the output.');
  if (a.acceptedQualifications !== true) reasons.push('Must confirm you are responsible for verifying your own qualifications to use this tool.');
  return {
    ok: reasons.length === 0,
    blocked: reasons.length > 0,
    reasons,
    statement:
      'Vitalis provides software that aggregates published research and reported community ' +
      'practice into DRAFT protocol resources. It does not practice medicine, prescribe, diagnose, ' +
      'or assume clinical responsibility. As a licensed user I am responsible for my own professional ' +
      'due diligence, qualifications, and any decision to act on this output.',
    acknowledgment: reasons.length === 0
      ? { acceptedResponsibility: true, acceptedQualifications: true, acknowledgedAt: new Date().toISOString() }
      : null,
  };
}

// ── Liability lever 6: jurisdiction acknowledgment ───────────────────────────
// Returns the notice the operator must click-accept before a dosed protocol is shown.
// Canada is the default operating jurisdiction; US is the user's own cross-border call.
function jurisdictionAcknowledgmentGate(jurisdiction = 'CA', complianceCfg) {
  const jx = (complianceCfg && complianceCfg.JURISDICTIONS && complianceCfg.JURISDICTIONS[jurisdiction]) || null;
  const isCA = jurisdiction === 'CA';
  return {
    jurisdiction,
    label: (jx && jx.label) || jurisdiction,
    required: true,
    notice: isCA
      ? 'Vitalis is a Canadian company providing a research/education software service in Canada. This tool aggregates published research into a DRAFT resource. It is NOT a prescription, NOT a diagnosis, and NOT a substitute for a qualified, peptide-literate practitioner. Dosing shown is the range reported in the literature — your practitioner determines any actual use.'
      : 'This software is a Canadian research/education service. If you access it from outside Canada, you do so on your own responsibility and under your own local laws. Vitalis does not supply peptides and makes no determination of legality in your jurisdiction. Output is a research DRAFT only — review with a qualified, peptide-literate practitioner.',
    acceptLabel: 'I understand this is research / educational software, not medical advice or a prescription.',
    disclaimer: (complianceCfg && complianceCfg.DISCLAIMER) || null,
  };
}

// ── Liability lever 4: practitioner attestation ──────────────────────────────
// Approving a DOSED protocol for a specific client requires the practitioner to attest
// they are qualified and peptide-literate, and that they independently reviewed the basis
// of the recommendation (the CDS-exemption hinge in both CA and US guidance). Returns
// ok/blocked; the server logs the attestation. NEVER auto-passes.
function practitionerAttestationGate(attestation) {
  const a = attestation || {};
  const reasons = [];
  if (!a.practitionerName) reasons.push('Practitioner name required.');
  if (a.qualifiedPeptideLiterate !== true) reasons.push('Must attest to being a qualified, peptide-literate practitioner.');
  if (a.reviewedBasis !== true) reasons.push('Must attest to having independently reviewed the basis of the recommendation.');
  return {
    ok: reasons.length === 0,
    blocked: reasons.length > 0,
    reasons,
    attestation: reasons.length === 0
      ? { practitionerName: a.practitionerName, qualifiedPeptideLiterate: true, reviewedBasis: true, attestedAt: new Date().toISOString() }
      : null,
  };
}

// ── The generator entrypoint ─────────────────────────────────────────────────
// Proposes itemRefs, runs the FULL gate chain (assembleDraft), then attaches role-aware
// dosing attribution + the jurisdiction notice. Returns everything the surface needs.
function generateProtocol(opts) {
  const {
    goalText = '', client, catalogIndex, evidenceByCompound = {}, complianceCfg,
    dosing = dosingLib, jurisdiction = 'CA', role = 'PRACTITIONER',
    rationale, monitoring, maxItems = 4,
  } = opts;

  const proposer = resolveProposer(opts);
  const proposal = proposer(goalText, { evidenceByCompound, catalogIndex, complianceCfg, maxItems });

  // Compose a SAFE rationale/monitoring (these pass through the language gate inside
  // assembleDraft, so they must avoid medical-claim verbs). Goal text is echoed as the
  // user's own words, never re-asserted as a clinical claim.
  const goalEcho = String(goalText || '').trim().slice(0, 240);
  const autoRationale = rationale != null ? rationale
    : `Generated DRAFT resource for the stated goal: "${goalEcho}". Items are research-supported catalog options surfaced for practitioner review — educational reference only, not a recommendation to use.`;
  const autoMonitoring = monitoring != null ? monitoring
    : 'Baseline labs before any use; follow the safety-monitoring panel matched to the selected items. Review all flags with a qualified practitioner.';

  // THE GATES RUN HERE — identical chain to the manual Draft Builder.
  let draft = gates.assembleDraft({
    client,
    itemRefs: proposal.itemRefs,
    catalogIndex,
    evidenceByCompound,
    complianceCfg,
    jurisdiction,
    rationale: autoRationale,
    monitoring: autoMonitoring,
  });

  // Tag the draft as generator-sourced + carry the goal for the portal "My Protocols" view.
  draft.source = 'generator';
  draft.goal = matchedGoalLabel(proposal.matchedGoals) || goalEcho || null;
  draft.title = draft.goal ? `${draft.goal} — generated DRAFT` : 'Generated DRAFT resource';

  // Attach role-aware dosing attribution AFTER the gate chain (lever 1/2/5).
  draft = attachDosing(draft, role, dosing);
  // Attach the two-source basis (studies ⊕ community) — the anti-"overly cautious" layer.
  draft = attachBasis(draft, role, evidenceByCompound, draft.goal);

  return {
    draft,
    reasoning: proposal.reasoning,
    matchedGoals: proposal.matchedGoals,
    proposerSource: proposal.source,
    jurisdictionNotice: jurisdictionAcknowledgmentGate(jurisdiction, complianceCfg),
    framing: {
      mode: 'AI proposes, gates dispose',
      dosing: 'attribution not instruction',
      evidence: 'studies where they exist, community practice where they do not — attributed, never asserted',
      status: draft.status,
      isResourceOnly: true,
    },
  };
}

function matchedGoalLabel(matchedGoals) {
  if (!matchedGoals || !matchedGoals.length) return null;
  return matchedGoals.map((g) => g.label.split(' / ')[0].split(' & ')[0].trim()).join(' + ');
}

module.exports = {
  normName,
  GOAL_KEYWORDS,
  parseGoals,
  indexCandidatesByCategory,
  productsByCompound,
  deterministicPropose,
  resolveProposer,
  attachDosing,
  attachBasis,
  practitionerLicenseAcknowledgmentGate,
  jurisdictionAcknowledgmentGate,
  practitionerAttestationGate,
  generateProtocol,
};
