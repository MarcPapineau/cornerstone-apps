'use strict';
/**
 * research-doctrine.js — the Vitalis Source Doctrine GATE (prevents WHO/NIH/gov-as-authority drift).
 *
 * Single source of truth for: which sources are EXCLUDED from the app-facing registry, how a source /
 * citation maps to a LANE, and whether anything may be treated as an EVIDENCE AUTHORITY.
 *
 * Doctrine (full text: docs/vitalis-research-doctrine.md):
 *  - Evidence backbone = peer-reviewed papers / journal / DOI / publisher / independent + university labs.
 *  - Expert/commentary (Huberman, Attia, FoundMyFitness, Examine, BioLayne, RP) = discovery / citation
 *    mining ONLY, labeled as commentary.
 *  - Government / regulatory (ClinicalTrials.gov, FDA, openFDA, Health Canada, USDA, …) = compliance /
 *    index / cross-check context ONLY — never the authority on whether a compound is useful or effective.
 *  - WHO and NIH / NIH ODS are EXCLUDED from the app-facing research registry entirely (for now).
 *  - Weak evidence is labeled honestly with one of HONEST_LABELS.
 *
 * Resource/educational only — never medical advice.
 */
const SOURCE_LANES = { PRIMARY: 'PRIMARY_EVIDENCE', INDEX: 'DISCOVERY_INDEX', COMMENTARY: 'PRACTITIONER_COMMENTARY', COMPLIANCE: 'COMPLIANCE' };
const HONEST_LABELS = ['UNKNOWN', 'SOURCE_PENDING', 'NEEDS_REVIEW', 'COMMUNITY_REFERENCE', 'PRACTITIONER_REVIEW'];

// EXCLUDED app-facing: WHO + NIH / NIH ODS. Matched by registry id, label, or citation URL host.
const EXCLUDED_IDS = ['who_ictrp', 'nih_ods'];
const EXCLUDED_PATTERNS = [
  /who\s*ictrp/i, /world health organization/i, /\bwho\.int\b/i,
  /nih\s*office of dietary/i, /nih[-\s]?ods\b/i, /\bods\.od\.nih\.gov/i,
];

// Government / regulatory hosts — kept only as compliance / index / cross-check, NEVER evidence authority.
const GOV_HOST_PATTERNS = [
  /clinicaltrials\.gov/i, /\.fda\.gov/i, /\bopenfda\b/i, /api\.fda\.gov/i, /canada\.ca/i, /health-products\.canada/i,
  /ema\.europa/i, /\.nih\.gov/i, /\bpubmed\b/i, /ncbi\.nlm\.nih/i, /usda\.gov/i, /nal\.usda/i, /who\.int/i,
  /usada\.org/i, /\bopss\.org\b/i, /\.mil\b/i,
];

const lc = (s) => String(s || '').toLowerCase();

/** True if a source (by any of id / label / url) is excluded from the app-facing registry. */
function isExcludedSource(...vals) {
  const blob = vals.map(lc).join(' ');
  if (EXCLUDED_IDS.some((id) => blob.includes(id))) return true;
  return EXCLUDED_PATTERNS.some((re) => re.test(blob));
}

function isGovernmentUrl(url) { return GOV_HOST_PATTERNS.some((re) => re.test(String(url || ''))); }

/**
 * The EVIDENCE AUTHORITY is the underlying peer-reviewed paper — NEVER a registry / index / regulator /
 * government source. Every entry in the source registry is a discovery / cross-check layer, so this
 * returns false for all of them. (RD2: no registry source may be an evidence authority.)
 */
function isEvidenceAuthority() { return false; }

/** Lane for a citation/source URL: government → COMPLIANCE, excluded → COMPLIANCE, else PRIMARY. */
function laneForUrl(url) {
  if (isExcludedSource(url) || isGovernmentUrl(url)) return SOURCE_LANES.COMPLIANCE;
  return SOURCE_LANES.PRIMARY;
}

/** Drop WHO / NIH (and anything excluded) from an app-facing source registry. */
function appFacingRegistry(sources) { return (sources || []).filter((s) => !isExcludedSource(s && s.id, s && s.label, s && s.base)); }

module.exports = {
  SOURCE_LANES, HONEST_LABELS, EXCLUDED_IDS,
  isExcludedSource, isGovernmentUrl, isEvidenceAuthority, laneForUrl, appFacingRegistry,
};
