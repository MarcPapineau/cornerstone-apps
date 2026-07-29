/**
 * presentation.js — the two-source "basis" composer for @vitalis/protocol-core.
 *
 * The directive, made concrete: "if there are studies, here's what the studies show;
 * if there aren't, here's what the greater community is doing." This module takes a
 * compound and merges its two honest sources into ONE role-aware basis block:
 *
 *      STUDIES  ← evidence.json (real citations, mechanism, trial status)
 *      COMMUNITY ← community.js (use context, common pattern, reported benefits)
 *
 * It does NOT invent anything. Numeric endpoints surface only if they already exist in a
 * real citation title. Community benefits are passed through pre-labeled as REPORTED. The
 * client view drops the administration `pattern` (the how-to) exactly like dosing drops
 * titration/taper — clients get the "why / what's reported", practitioners get the "how".
 *
 * Tiers (honest, not promotional):
 *   TRIALS      human clinical-trial evidence cited            → "Clinical-trial evidence"
 *   PRECLINICAL citations exist but no human trial             → "Preclinical / early research"
 *   COMMUNITY   little/no formal data; real community practice → "Community-reported (no trials cited)"
 *   EMERGING    thin even at the community level / experimental→ "Emerging — minimal data, strong caution"
 *
 * NOT medical advice. NOT legal advice.
 */

const communityLib = require('./data/community');

// Is there a real, numeric/endpoint-bearing finding already written in a citation title?
// We only ever echo what a citation literally says — never a number this app made up.
function bestFinding(citations) {
  if (!Array.isArray(citations) || !citations.length) return null;
  // Prefer a citation whose title carries a concrete endpoint (a % or a number+unit).
  const withNumber = citations.find((c) => /\d/.test(c.title || '') && /%|mg|kg|week|month|fold|reduction|increase/i.test(c.title || ''));
  const pick = withNumber || citations[0];
  return pick && pick.title ? pick.title : null;
}

// Study strength is read straight off the evidence record — never guessed.
function studyStrength(evidenceRec) {
  if (!evidenceRec) return 'NONE';
  if (evidenceRec.hasClinicalTrial === true || evidenceRec.clinicalTrialStatus === 'TRIAL_CITED') return 'TRIALS';
  if ((evidenceRec.citationCount || 0) > 0 || (Array.isArray(evidenceRec.citations) && evidenceRec.citations.length)) return 'PRECLINICAL';
  return 'NONE';
}

// Resolve the honest top-level tier + label from study strength + the community profile.
function resolveTier(strength, profile) {
  if (profile && profile.basis === 'EMERGING') {
    return { tier: 'EMERGING', label: 'Emerging — minimal data, strong caution' };
  }
  if (strength === 'TRIALS') return { tier: 'TRIALS', label: 'Clinical-trial evidence' };
  if (strength === 'PRECLINICAL') {
    return profile
      ? { tier: 'PRECLINICAL', label: 'Preclinical research + community practice' }
      : { tier: 'PRECLINICAL', label: 'Preclinical / early research' };
  }
  // strength NONE
  if (profile) return { tier: 'COMMUNITY', label: 'Community-reported (no trials cited)' };
  return { tier: 'EMERGING', label: 'Emerging — minimal data' };
}

// Trim a mechanism string to a plain-language lead sentence (no fabrication, just the first clause).
function plainMechanism(mechanism) {
  if (!mechanism) return null;
  const firstSentence = String(mechanism).split(/\.\s/)[0].trim();
  return firstSentence.length > 220 ? firstSentence.slice(0, 217).trim() + '…' : firstSentence;
}

const BENEFITS_LABEL = 'Reported benefits (community / literature — not Vitalis claims, not guaranteed outcomes)';

/**
 * composeBasis — build the role-aware basis block for one item.
 *
 * @param {object} args
 * @param {string} args.compoundId
 * @param {object} args.evidenceRec   evidence.json record for the compound (may be undefined)
 * @param {object} [args.community]   community.js library (defaults to the bundled one)
 * @param {string} [args.role]        'CLIENT' softens + drops the administration pattern
 * @param {string} [args.goalLabel]   the matched goal, for the "if your goal is X…" headline
 * @param {string} [args.productName] display name fallback
 * @returns {object} basis block
 */
function composeBasis({ compoundId, evidenceRec, community = communityLib, role, goalLabel, productName }) {
  const isClient = String(role || '').toUpperCase() === 'CLIENT';
  const profile = community.communityFor ? community.communityFor(compoundId) : null;
  const strength = studyStrength(evidenceRec);
  const { tier, label } = resolveTier(strength, profile);
  const name = (evidenceRec && (evidenceRec.name || evidenceRec.fullName)) || productName || compoundId;

  // ── Studies sub-block (from the real corpus only) ──────────────────────────
  const citations = (evidenceRec && Array.isArray(evidenceRec.citations)) ? evidenceRec.citations : [];
  const studies = (citations.length || strength !== 'NONE') ? {
    strength,                                   // TRIALS | PRECLINICAL | NONE
    hasClinicalTrial: !!(evidenceRec && evidenceRec.hasClinicalTrial),
    evidenceLevel: (evidenceRec && evidenceRec.evidenceLevel) || 'UNKNOWN',
    citationCount: (evidenceRec && evidenceRec.citationCount) || citations.length,
    finding: bestFinding(citations),            // echoes a real citation title, or null
    mechanism: plainMechanism(evidenceRec && evidenceRec.mechanism),
    // Operators get the full citation list; clients get count + the single finding line.
    citations: isClient ? undefined : citations.map((c) => ({ title: c.title, source: c.source, url: c.url, type: c.type })),
  } : null;

  // ── Community sub-block (from the curated profile; pattern is operator-only) ─
  const communityBlock = profile ? {
    usedFor: profile.usedFor || [],
    reportedBenefits: profile.reportedBenefits || [],
    benefitsLabel: BENEFITS_LABEL,
    evidenceNote: profile.evidenceNote,
    // The "how" is practitioner-facing only — the client never receives an administration how-to.
    ...(isClient ? {} : { pattern: profile.pattern || null }),
  } : null;

  // ── Headline: "If your goal is <goal>, here's what the research + community show for <name>." ─
  const goalPart = goalLabel ? `If your goal is ${goalLabel.toLowerCase()}, ` : '';
  const sourcePart =
    tier === 'TRIALS' ? 'here is what the clinical studies report'
      : tier === 'PRECLINICAL' ? 'here is what the early research and the peptide community report'
        : tier === 'COMMUNITY' ? 'here is what the greater peptide community reports'
          : 'here is the little that is known so far';
  const headline = `${goalPart}${sourcePart} for ${name} — reference only, not an instruction.`;

  return {
    framing: 'attribution',
    tier,                 // TRIALS | PRECLINICAL | COMMUNITY | EMERGING
    label,                // human label for the tier
    headline,
    studies,              // null when truly nothing is cited
    community: communityBlock, // null when no curated profile
  };
}

module.exports = {
  BENEFITS_LABEL,
  bestFinding,
  studyStrength,
  resolveTier,
  plainMechanism,
  composeBasis,
};
