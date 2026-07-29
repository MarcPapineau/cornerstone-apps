'use strict';
/**
 * supplements-research.js — the HONEST source-tiering + Research-Library provenance layer for the
 * supplement mini-dossier. REUSE > REBUILD: it reads the EXISTING nutrient-evidence corpus and the
 * EXISTING research-doctrine lanes/labels; it invents NOTHING and adds NO new external citations.
 *
 * ── The non-negotiable research-credibility rule (why this file exists) ───────────────────────────
 * Discovery confirmed the supplement corpus (data/nutrient-evidence.js) has ZERO peer-reviewed
 * primary citations: all nutrients cite ONLY government nutrition-reference fact sheets (NIH ODS /
 * Health Canada DRIs / MedlinePlus), already doctrine-tagged COMPLIANCE / evidenceAuthority:false.
 * So this layer surfaces every source HONESTLY:
 *   • A government fact sheet  → T3 (established nutrition reference / clinical consensus), used for
 *     RDA / deficiency context / food sources / SAFETY — NEVER dressed as a T1 RCT efficacy proof.
 *   • The corpus `mechanism`   → T4 (mechanistic).
 *   • The corpus `community.*` → T5 (practitioner / community reference), clearly labeled.
 *   • A claim that WOULD need human-trial (T1/T2) efficacy backing the corpus lacks → NEEDS_SOURCE,
 *     and it is added to the research-gap list (candidate sources to verify, never cited as fact).
 *
 * IMPORTANT: the engine's `ESTABLISHED` tier derives from a boolean `hasClinicalTrial` flag, NOT an
 * attached trial — so `ESTABLISHED` is NOT equated with "RCT-backed" anywhere in this metadata. The
 * honest research tier (T1–T5 / NEEDS_SOURCE) is independent of the engine's nutrition tier.
 *
 * NOT medical advice. NOT a prescription. NOT a diagnosis.
 */
const RDOC = require('./research-doctrine');
const NE = require('./data/nutrient-evidence');

const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));
const today = () => new Date().toISOString().slice(0, 10);

// Honest research tiers (T1–T5 / NEEDS_SOURCE) — the searchable-library vocabulary. These are the
// PROVENANCE tiers, distinct from the engine's ESTABLISHED/SUPPORTIVE/EMERGING nutrition tier.
const RESEARCH_TIER_LEGEND = [
  { tier: 'T1', label: 'Human RCT / meta-analysis (strongest efficacy evidence)' },
  { tier: 'T2', label: 'Human observational / cohort / open-label' },
  { tier: 'T3', label: 'Established nutrition reference / clinical consensus (RDA · deficiency · safety)' },
  { tier: 'T4', label: 'Mechanistic / preclinical rationale' },
  { tier: 'T5', label: 'Practitioner / community reference (attributed, not proof)' },
  { tier: 'NEEDS_SOURCE', label: 'Source gap — efficacy claim not yet backed by a verified primary source' },
];

// sourceType vocabulary the brief locks. government_reference is allowed for safety/compliance ONLY.
const SOURCE_TYPE = {
  GUIDELINE: 'guideline',
  CLINICAL_REVIEW: 'clinical_review',
  NUTRITION_LITERATURE: 'nutrition_literature',
  PRACTITIONER_CONSENSUS: 'practitioner_consensus',
  FOOD_FIRST_TRADITION: 'food_first_tradition',
  MECHANISTIC: 'mechanistic',
  GOVERNMENT_REFERENCE: 'government_reference', // safety / compliance / reference context only
};

const refIdFor = (nutrientId, slug, n) => `SRC-${String(nutrientId || 'DRAFT').toUpperCase()}-${slug}${n != null ? '-' + n : ''}`;

/**
 * A single provenance object — the Research-Library row. Real values where the corpus has them;
 * honest null + reviewStatus∈HONEST_LABELS where it does not. NEVER a fabricated PMID/title/url.
 */
function provenance(o) {
  return {
    sourceId: o.sourceId,
    sourceTitle: o.sourceTitle || null,
    sourceType: o.sourceType,                 // ∈ SOURCE_TYPE
    evidenceTier: o.evidenceTier,             // ∈ {T1,T2,T3,T4,T5,NEEDS_SOURCE}
    citation: o.citation || null,             // human-readable citation label
    urlOrPmid: o.urlOrPmid || null,           // real http(s) url, or null where SOURCE_PENDING
    appliesTo: o.appliesTo || null,           // the nutrient / claim domain this supports
    claimSupported: o.claimSupported || null, // WHAT this source actually backs (honest scope)
    limitations: o.limitations || null,       // the honest ceiling of the source
    lastReviewed: o.lastReviewed || today(),
    reviewStatus: o.reviewStatus,             // ∈ RDOC.HONEST_LABELS (e.g. SOURCE_PENDING / COMMUNITY_REFERENCE)
  };
}

/**
 * Government citation → a T3 provenance row. The corpus citation is REAL; we only re-frame its TIER
 * honestly (reference/safety, not efficacy). Tagged government_reference so a reader sees the lane.
 */
function govCitationProvenance(nutrient, cite, idx) {
  const isMedlinePlus = /medlineplus/i.test(String(cite.source || '') + String(cite.url || ''));
  return provenance({
    sourceId: refIdFor(nutrient.nutrientId, 'REF', idx),
    sourceTitle: cite.title,
    sourceType: SOURCE_TYPE.GOVERNMENT_REFERENCE,   // safety / reference context ONLY
    evidenceTier: 'T3',                              // established nutrition reference — NOT an RCT
    citation: `${cite.title} — ${cite.source}`,
    urlOrPmid: cite.url || null,
    appliesTo: nutrient.name,
    claimSupported:
      'RDA / dietary-reference-intake, deficiency context, food sources, and safety / upper-limit guidance' +
      (isMedlinePlus ? ' (consumer health reference)' : ''),
    limitations:
      'Government nutrition reference — used for safety / reference / compliance context only. It does ' +
      'NOT establish that supplementing improves a clinical outcome; that requires a primary human trial.',
    lastReviewed: nutrient._lastReviewed || today(),
    reviewStatus: 'COMMUNITY_REFERENCE', // an established external reference, not a Vitalis primary-evidence authority
  });
}

/**
 * A PEER-REVIEWED primary citation (journal RCT / meta-analysis, indexed by DOI/PMID — NOT a
 * government reference) → a real T1/T2 provenance row. The citation object carries its own honest
 * `evidenceTier` (T1 RCT/meta · T2 observational), `claimSupported`, and `limitations`; the url is the
 * journal DOI (doi.org), never a government host. This is what closes a NEEDS_SOURCE efficacy gap.
 */
function peerReviewedProvenance(nutrient, cite, idx) {
  const tier = (cite.evidenceTier === 'T2') ? 'T2' : 'T1';
  const sourceType = (tier === 'T1') ? SOURCE_TYPE.CLINICAL_REVIEW : SOURCE_TYPE.NUTRITION_LITERATURE;
  const pmidTag = cite.pmid ? ` · PMID ${cite.pmid}` : '';
  return provenance({
    sourceId: refIdFor(nutrient.nutrientId, 'RCT', idx),
    sourceTitle: cite.title,
    sourceType,
    evidenceTier: tier,
    citation: `${cite.title} — ${cite.source}${cite.year ? ` (${cite.year})` : ''}${pmidTag}`,
    urlOrPmid: cite.url || null,                 // journal DOI (doi.org) — a real, clickable http(s) link
    appliesTo: cite.appliesTo || nutrient.name,
    claimSupported: cite.claimSupported ||
      `Peer-reviewed ${tier === 'T1' ? 'trial / meta-analysis' : 'observational'} evidence relating to ${nutrient.name}.`,
    limitations: cite.limitations ||
      'Peer-reviewed primary source; final dose, form, suitability and duration still require practitioner review.',
    lastReviewed: nutrient._lastReviewed || today(),
    reviewStatus: 'NEEDS_REVIEW', // an HONEST_LABEL — a real source, still subject to practitioner review
  });
}

/** Mechanism field → a T4 mechanistic provenance row (no external citation; rationale only). */
function mechanismProvenance(nutrient) {
  if (!(nutrient.evidenceRec && nutrient.evidenceRec.mechanism)) return null;
  return provenance({
    sourceId: refIdFor(nutrient.nutrientId, 'MECH'),
    sourceTitle: `${nutrient.name} — mechanistic rationale`,
    sourceType: SOURCE_TYPE.MECHANISTIC,
    evidenceTier: 'T4',
    citation: 'Mechanistic rationale (physiology) — corpus-curated, not an outcome trial',
    urlOrPmid: null,
    appliesTo: nutrient.name,
    claimSupported: nutrient.evidenceRec.mechanism,
    limitations: 'Mechanistic plausibility only — a mechanism is not evidence of a clinical benefit.',
    reviewStatus: 'NEEDS_REVIEW',
  });
}

/** community.{usedFor,reportedBenefits,evidenceNote} → a T5 practitioner/community provenance row. */
function communityProvenance(nutrient) {
  const com = nutrient.community || {};
  if (!(arr(com.usedFor).length || arr(com.reportedBenefits).length || com.evidenceNote)) return null;
  const used = arr(com.usedFor).join('; ');
  const benefits = arr(com.reportedBenefits).join('; ');
  return provenance({
    sourceId: refIdFor(nutrient.nutrientId, 'PRAC'),
    sourceTitle: `${nutrient.name} — naturopathic / community practice reference`,
    sourceType: SOURCE_TYPE.PRACTITIONER_CONSENSUS,
    evidenceTier: 'T5',
    citation: 'Attributed naturopathic / community practice reference (reported, not asserted)',
    urlOrPmid: null,
    appliesTo: nutrient.name,
    claimSupported:
      (used ? `Commonly discussed for: ${used}. ` : '') +
      (benefits ? `Reported (not proven) benefits: ${benefits}.` : '') ||
      (com.evidenceNote || null),
    limitations:
      'Practitioner / community reference — attributed and clearly labeled as reported experience, ' +
      'NOT controlled-trial proof. ' + (com.evidenceNote || ''),
    reviewStatus: 'PRACTITIONER_REVIEW',
  });
}

/**
 * The efficacy SOURCE-GAP row — every supplement claim that WOULD need a human-trial (T1/T2) efficacy
 * backing the corpus does not carry. Surfaced honestly as NEEDS_SOURCE with urlOrPmid:null; it is the
 * thing Marc approves for a real primary-source follow-up. NEVER a fabricated citation.
 */
function efficacyGapProvenance(nutrient) {
  return provenance({
    sourceId: refIdFor(nutrient.nutrientId, 'EFFGAP'),
    sourceTitle: null,
    sourceType: SOURCE_TYPE.CLINICAL_REVIEW,
    evidenceTier: 'NEEDS_SOURCE',
    citation: null,
    urlOrPmid: null,
    appliesTo: nutrient.name,
    claimSupported:
      `Whether supplementing ${nutrient.name} (vs food-first repletion) improves ${nutrient.name}-related ` +
      'outcomes for this client — a human-trial (T1/T2) efficacy claim.',
    limitations:
      'No verified peer-reviewed primary source is attached in the corpus for this efficacy claim. ' +
      'Candidate sources must be verified before citing — do not present as a cited fact.',
    reviewStatus: 'SOURCE_PENDING',
  });
}

/**
 * researchProfileForNutrient(name|id) → the full honest provenance bundle for ONE nutrient:
 *   { nutrient, rows[provenance…], hasEfficacyGap, engineTier }
 * Resolves by nutrient name (the supplement plan carries names) or nutrientId. Returns null if the
 * nutrient is not in the corpus (e.g. a seeded combo form like "Vitamin D3 + K2" maps by best match).
 */
function researchProfileForNutrient(nameOrId) {
  if (!nameOrId) return null;
  const key = String(nameOrId).toLowerCase();
  const entry = NE.ALL.find((n) =>
    n.nutrientId === nameOrId ||
    String(n.name).toLowerCase() === key ||
    // best-effort name containment so "Magnesium glycinate" → magnesium, "Vitamin D3 + K2" → vitamin d
    key.includes(String(n.name).toLowerCase().split(/[\s(]/)[0]) ||
    String(n.name).toLowerCase().includes(key.split(/[\s(]/)[0]),
  );
  if (!entry) {
    // Honest miss — the nutrient is not in the corpus. Surface a pure SOURCE_PENDING gap, never invent.
    return {
      nutrient: String(nameOrId),
      engineTier: null,
      hasEfficacyGap: true,
      rows: [provenance({
        sourceId: refIdFor(String(nameOrId).replace(/[^a-z0-9]+/gi, '_'), 'NOCORPUS'),
        sourceTitle: null,
        sourceType: SOURCE_TYPE.NUTRITION_LITERATURE,
        evidenceTier: 'NEEDS_SOURCE',
        citation: null,
        urlOrPmid: null,
        appliesTo: String(nameOrId),
        claimSupported: `Any claim about ${nameOrId}.`,
        limitations: 'Not present in the curated nutrient-evidence corpus — no source attached. SOURCE_PENDING.',
        reviewStatus: 'SOURCE_PENDING',
      })],
    };
  }

  const rows = [];
  const cites = (entry.evidenceRec && arr(entry.evidenceRec.citations)) || [];
  let hasPeerReviewedEfficacy = false;
  cites.forEach((c, i) => {
    if (RDOC.isGovernmentUrl(c.url) || RDOC.isExcludedSource(c.source, c.url)) {
      rows.push(govCitationProvenance(entry, c, i)); // government reference → T3 (safety/reference only)
    } else if (c.peerReviewed && /^https?:\/\//.test(String(c.url || '')) && ['T1', 'T2'].includes(c.evidenceTier)) {
      // A non-gov peer-reviewed primary citation (journal RCT/meta, DOI-linked) → a real T1/T2 row.
      rows.push(peerReviewedProvenance(entry, c, i));
      hasPeerReviewedEfficacy = true;
    }
    // (A non-gov citation lacking peerReviewed/tier/url is ignored here — never dressed up as evidence.)
  });
  const mech = mechanismProvenance(entry);
  if (mech) rows.push(mech);
  const com = communityProvenance(entry);
  if (com) rows.push(com);
  // Surface the honest efficacy gap ONLY when the corpus carries no verified peer-reviewed efficacy
  // source for this nutrient. When a real T1/T2 citation IS present, the gap is closed — not faked.
  if (!hasPeerReviewedEfficacy) rows.push(efficacyGapProvenance(entry));

  // The engine's nutrition tier (ESTABLISHED/SUPPORTIVE/EMERGING) — kept SEPARATE from the research tier,
  // and explicitly NOT equated with RCT-backed (it derives from a hasClinicalTrial boolean, not a trial).
  let engineTier = 'SUPPORTIVE';
  if ((entry.community || {}).basis === 'EMERGING') engineTier = 'EMERGING';
  else if (entry.evidenceRec && entry.evidenceRec.hasClinicalTrial) engineTier = 'ESTABLISHED';

  return { nutrient: entry.name, engineTier, hasEfficacyGap: true, rows };
}

// Dedupe + join human-readable target labels (e.g. "magnesium → sleep quality / insomnia") into a short,
// grammatical list — used to NAME, from the actual rows, which targets a given tier covers. Returns '' on none.
function joinTargets(labels) {
  const seen = [];
  for (const l of labels) {
    const v = String(l || '').trim();
    if (v && !seen.includes(v)) seen.push(v);
  }
  if (!seen.length) return '';
  if (seen.length === 1) return seen[0];
  if (seen.length === 2) return `${seen[0]} and ${seen[1]}`;
  return `${seen.slice(0, -1).join(', ')}, and ${seen[seen.length - 1]}`;
}

/**
 * buildResearchNote(provRows, counts) → the human-readable Source-Transparency note, DERIVED from the actual
 * provenance rows + tier counts (never hardcoded), so the prose can NEVER drift out of sync with the tier
 * table on the same page. It NAMES — from the rows themselves — the specific targets that carry T1/T2
 * efficacy evidence and the targets whose efficacy is still an open NEEDS_SOURCE gap. It keeps the
 * conservative, no-overclaim tone (the RCT evidence has real limitations — subjective / short-term /
 * low-certainty) and it NEVER names a government / public-health body (T3 is described neutrally as an
 * established nutrition reference), so it is safe for the client-visible view without relying on a scrub.
 */
function buildResearchNote(provRows, counts) {
  const primaryEfficacy = (counts.T1 || 0) + (counts.T2 || 0);
  const intro =
    'Sources are tiered T1 (human RCT / meta-analysis) → T5 (practitioner / community), with explicit ' +
    'NEEDS_SOURCE gaps. ';
  // The non-primary corpus tiers present, described neutrally (no government body named).
  const refGrade = [];
  if (counts.T3) refGrade.push('established nutrition reference (T3)');
  if (counts.T4) refGrade.push('mechanistic rationale (T4)');
  if (counts.T5) refGrade.push('practitioner / community reference (T5)');
  const refGradeClause = refGrade.length ? `the remainder are ${joinTargets(refGrade)}` : 'the remainder are reference-grade';

  if (primaryEfficacy > 0) {
    // Name, from the actual rows, which targets carry the peer-reviewed RCT/meta-analysis evidence.
    const t1t2 = provRows.filter((r) => r.evidenceTier === 'T1' || r.evidenceTier === 'T2');
    const backedTargets = joinTargets(t1t2.map((r) => r.appliesTo));
    const citeWord = primaryEfficacy === 1 ? 'citation' : 'citations';
    const backedClause = backedTargets
      ? ` for ${backedTargets}`
      : '';
    // Name the still-open efficacy gaps, from the actual NEEDS_SOURCE rows.
    const gapTargets = joinTargets(provRows.filter((r) => r.evidenceTier === 'NEEDS_SOURCE').map((r) => r.appliesTo));
    const gapClause = counts.NEEDS_SOURCE
      ? ` ${counts.NEEDS_SOURCE} efficacy gap(s) remain open${gapTargets ? ` (${gapTargets})` : ''} and are shown honestly as NEEDS_SOURCE, not asserted.`
      : '';
    return (
      intro +
      `This plan now includes ${primaryEfficacy} peer-reviewed RCT / meta-analysis ${citeWord} (T1)${backedClause}; ` +
      `${refGradeClause}. The peer-reviewed evidence has real limitations (e.g. subjective, short-term, or ` +
      `low-certainty outcomes) and is a vetted starting point, not proof of benefit for this client.` +
      gapClause +
      ' This is an educational research resource, not medical advice.'
    );
  }

  // No primary efficacy evidence yet — keep the prior honest reference-grade language.
  return (
    intro +
    `This corpus carries ${refGrade.length ? joinTargets(refGrade) : 'reference-grade sources'} — but no ` +
    'peer-reviewed primary EFFICACY trials (T1/T2). Recommendations are therefore supportive / reference-grade, ' +
    'not RCT-proven. This is an educational research resource, not medical advice.'
  );
}

/**
 * buildResearchBasis({ targets, providerReviewFlags, monitoringMarkers, lifestyleCaptured }) →
 * the whole-document Research Basis & Source Transparency payload:
 *   { tierLegend, provenance[…rows across every claim], gapList[…], counts:{bySourceTier, sourceBacked, needsSource}, govUse }
 * Pure reshape of the corpus through researchProfileForNutrient — no fabrication, no new citations.
 *
 * `targets` are the supplement plan's nutrientTargets (objects with `.nutrient`); flags/monitoring are
 * read only to add their honest lab-interpretation + monitoring provenance rows.
 */
function buildResearchBasis(opts = {}) {
  const targets = arr(opts.targets);
  const providerReviewFlags = arr(opts.providerReviewFlags);
  const monitoringMarkers = arr(opts.monitoringMarkers);
  const lifestyleCaptured = !!opts.lifestyleCaptured;

  const provRows = [];
  const gapList = [];
  const counts = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, NEEDS_SOURCE: 0 };

  const pushRow = (row) => {
    provRows.push(row);
    if (counts[row.evidenceTier] != null) counts[row.evidenceTier] += 1;
    if (row.evidenceTier === 'NEEDS_SOURCE') {
      gapList.push({
        claim: row.claimSupported,
        appliesTo: row.appliesTo,
        why: row.limitations,
        candidateAction: 'Identify + verify a peer-reviewed primary source (PMID/DOI) before citing. Candidate — do not present as a cited fact.',
        reviewStatus: row.reviewStatus,
      });
    }
  };

  // 1) Per supplement target: T3 reference + T4 mechanism + T5 practitioner + the NEEDS_SOURCE efficacy gap.
  const seen = new Set();
  for (const t of targets) {
    const name = t.nutrient || t.name;
    if (!name || seen.has(String(name).toLowerCase())) continue;
    seen.add(String(name).toLowerCase());
    const profile = researchProfileForNutrient(name);
    if (profile) profile.rows.forEach(pushRow);
  }

  // 2) Lab-interpretation claims: each flagged marker is a "review with provider" finding (T3 reference
  //    framing — the lab REFERENCE range is the source; the interpretation is explicitly practitioner's).
  for (const f of providerReviewFlags) {
    pushRow(provenance({
      sourceId: refIdFor(String(f.marker || 'marker').replace(/[^a-z0-9]+/gi, '_'), 'LAB'),
      sourceTitle: `${f.marker} — laboratory reference range (report-provided)`,
      sourceType: SOURCE_TYPE.GOVERNMENT_REFERENCE,
      evidenceTier: 'T3',
      citation: `${f.marker} flag derived from the report's own reference range (labResultFlagGate).`,
      urlOrPmid: null,
      appliesTo: f.marker,
      claimSupported: `${f.marker} is ${/HIGH/.test(String(f.flag)) ? 'above' : 'below'} the report reference range — a flag, not a diagnosis.`,
      limitations: 'A reference-range flag is a screening signal only. Clinical interpretation is the practitioner’s. Out-of-range does not by itself confirm a deficiency.',
      reviewStatus: 'PRACTITIONER_REVIEW',
    }));
  }

  // 3) Monitoring claims: sourced from PEPTIDE_ADDITIONS (real markers). T5 practitioner-reference framing.
  if (monitoringMarkers.length) {
    pushRow(provenance({
      sourceId: refIdFor('MONITORING', 'PANEL'),
      sourceTitle: 'Protocol monitoring markers (peptide-additions mapping)',
      sourceType: SOURCE_TYPE.PRACTITIONER_CONSENSUS,
      evidenceTier: 'T5',
      citation: 'Sourced from the peptide-additions monitoring mapping (never invented).',
      urlOrPmid: null,
      appliesTo: monitoringMarkers.join(' · '),
      claimSupported: `Markers to track alongside the current protocol: ${monitoringMarkers.join(', ')}.`,
      limitations: 'A monitoring cadence is a practitioner-reference convention, not an efficacy claim. The practitioner sets the schedule.',
      reviewStatus: 'PRACTITIONER_REVIEW',
    }));
  }

  // 4) Lifestyle claims: honestly NEEDS_SOURCE when not captured (we never fabricate lifestyle findings).
  if (!lifestyleCaptured) {
    pushRow(provenance({
      sourceId: refIdFor('LIFESTYLE', 'GAP'),
      sourceTitle: null,
      sourceType: SOURCE_TYPE.NUTRITION_LITERATURE,
      evidenceTier: 'NEEDS_SOURCE',
      citation: null,
      urlOrPmid: null,
      appliesTo: 'Lifestyle context',
      claimSupported: 'Any lifestyle-derived finding (sleep, stress, training load, diet pattern) for this client.',
      limitations: 'Lifestyle detail was not captured at intake — no lifestyle finding is asserted. Intake should collect it before any lifestyle claim is made.',
      reviewStatus: 'SOURCE_PENDING',
    }));
  }

  const sourceBacked = provRows.filter((r) => r.evidenceTier !== 'NEEDS_SOURCE').length;
  const needsSource = counts.NEEDS_SOURCE;
  const govUse = provRows.some((r) => r.sourceType === SOURCE_TYPE.GOVERNMENT_REFERENCE);

  return {
    tierLegend: RESEARCH_TIER_LEGEND,
    provenance: provRows,
    gapList,
    counts: { bySourceTier: counts, sourceBacked, needsSource, total: provRows.length },
    govUse: {
      used: govUse,
      purpose: govUse
        ? 'Government / regulatory sources (NIH ODS / Health Canada DRIs / MedlinePlus + lab reference ranges) ' +
          'are used ONLY for RDA / deficiency context / food sources / safety / reference — never as the efficacy backbone.'
        : null,
    },
    // The note is DERIVED from the actual tier counts + rows (never hardcoded), so it can never contradict
    // the tier table on the same page. It names the T1/T2-backed targets and the open NEEDS_SOURCE gaps,
    // stays conservative about the evidence's limitations, and names no government body (client-safe).
    note: buildResearchNote(provRows, counts),
  };
}

module.exports = {
  RESEARCH_TIER_LEGEND,
  SOURCE_TYPE,
  provenance,
  researchProfileForNutrient,
  buildResearchBasis,
};
