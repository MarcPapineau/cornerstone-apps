'use strict';
/**
 * reconcile-evidence.js — enforce the SOURCE HIERARCHY + add the CONFIDENCE layer.
 *
 * Correction 1 (source hierarchy): the evidence BACKBONE is peer-reviewed literature
 * (journal / DOI, reached via an index). Government / regulatory sources — ClinicalTrials.gov,
 * NIH-ODS, FDA, WHO, USADA, DoD — are NOT the backbone; they are cross-check / compliance /
 * discovery pointers only. So tiers are re-derived from JOURNAL citations; CT.gov entries move
 * out of `citations` into `registeredStudies` (a labeled cross-check).
 *
 * Correction 2 (honest tiers + confidence): do not force "0 UNKNOWN". Compounds with sparse
 * peer-reviewed evidence may be LOW / UNKNOWN. A separate `confidence` layer is added, and the
 * pre-curated HIGH compounds with no published trial are marked NEEDS_REVIEW (never blind-downgraded).
 *
 *   node scripts/reconcile-evidence.js [--dry]
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'data', 'evidence.json');
const ORIG = '/tmp/evidence.prebak.json';            // pre-enrichment corpus (for original-HIGH detection)
const DRY = process.argv.includes('--dry');

// Pre-curated HIGH compounds explicitly flagged by the research lead for review.
const PRECURATED_REVIEW = new Set(['bpc157', 'tb500', 'nad', 'sermorelin', 'kpv', 'ghrp6', 'cjcnodac', 'glutathione']);

// HIGH-PRECISION published clinical-trial signal in a JOURNAL title. Loose signals ("systematic
// review", "efficacy and safety") are deliberately EXCLUDED because they catch preclinical reviews;
// a negative guard drops experimental / animal / gene-therapy papers so we never over-claim a human
// trial (e.g. a "systematic review of experimental" dihexa paper, or a follistatin GENE-therapy trial).
const TRIAL_POS = /(randomi[sz]ed|double.?blind|placebo.?controlled|\bphase\s*(0|1|2|3|i{1,3})[ab]?\b|controlled trial|clinical trial|\brct\b|first-in-(human|man))/i;
const TRIAL_NEG = /(experimental|preclinical|\banimal\b|in[ -]?vitro|\brat\b|\bmouse\b|\bmice\b|gene therapy|cell line|rodent)/i;
const isClinicalTrialPaper = (title) => { const t = String(title || ''); return TRIAL_POS.test(t) && !TRIAL_NEG.test(t); };

const isGov = (c) => c.type === 'ClinicalTrial' || c.type === 'Observational';

(async () => {
  const cur = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let orig = {};
  try { orig = JSON.parse(fs.readFileSync(ORIG, 'utf8')).byCompound || {}; } catch (e) { /* ok */ }

  const log = [];
  for (const id of Object.keys(cur.byCompound)) {
    const c = cur.byCompound[id];
    const cites = Array.isArray(c.citations) ? c.citations : [];
    const journal = cites.filter((x) => !isGov(x));                 // peer-reviewed backbone
    const gov = cites.filter(isGov);                                 // CT.gov → cross-check only
    const publishedTrial = journal.some((x) => isClinicalTrialPaper(x.title));
    const nJ = journal.length;

    let level = publishedTrial && nJ >= 3 ? 'HIGH' : nJ >= 5 ? 'MODERATE' : nJ >= 1 ? 'LOW' : 'UNKNOWN';
    const origHigh = (orig[id] || {}).evidenceLevel === 'HIGH';
    // Never blind-downgrade a pre-curated HIGH — preserve the level but flag it for review.
    if (origHigh && level !== 'HIGH') level = 'HIGH';
    const needsReview = PRECURATED_REVIEW.has(id) || (origHigh && !publishedTrial) || (level === 'HIGH' && !publishedTrial);

    let confidence;
    if (needsReview) confidence = 'NEEDS_REVIEW';
    else if (level === 'HIGH') confidence = 'HIGH_CONFIDENCE';
    else if (level === 'MODERATE') confidence = 'SOURCE_TRACEABLE';
    else if (level === 'LOW') confidence = 'SPARSE';
    else confidence = 'SOURCE_PENDING';

    const oldLevel = c.evidenceLevel;
    log.push({ id, name: c.name, oldLevel, newLevel: level, confidence, journal: nJ, registered: gov.length, publishedTrial, changed: oldLevel !== level });

    if (!DRY) {
      c.citations = journal;                                         // backbone = peer-reviewed only
      c.citationCount = nJ;
      c.evidenceLevel = level;
      c.confidence = confidence;                                     // separate confidence layer
      c.reviewStatus = needsReview ? 'NEEDS_REVIEW' : (level === 'UNKNOWN' ? 'SOURCE_PENDING' : 'OK');
      c.hasPublishedTrial = publishedTrial;                          // a real journal trial/meta paper
      c.hasRegisteredTrial = gov.some((g) => g.type === 'ClinicalTrial'); // CT.gov pointer (not backbone)
      c.registeredStudies = gov.map((g) => ({ title: g.title, url: g.url, note: g.source, kind: g.type === 'ClinicalTrial' ? 'INTERVENTIONAL_REGISTRATION' : 'OBSERVATIONAL_REGISTRATION' }));
      delete c.clinicalTrialStatus;                                  // superseded by hasPublishedTrial + registeredStudies
    }
  }

  if (!DRY) {
    cur._provenance.reconciledAt = new Date().toISOString();
    cur._provenance.sourceHierarchy = 'Evidence backbone = peer-reviewed journal/DOI literature (reached via index). ClinicalTrials.gov / NIH-ODS / FDA / WHO / USADA / DoD are NOT the backbone — they are cross-check / compliance / discovery pointers only (see registeredStudies). Tiers re-derived from journal citations.';
    cur._provenance.confidenceLayer = 'HIGH_CONFIDENCE = HIGH evidence + published trial/meta · NEEDS_REVIEW = pre-curated or HIGH-without-published-trial · SOURCE_TRACEABLE = MODERATE · SPARSE = LOW · SOURCE_PENDING = UNKNOWN. UNKNOWN retained where peer-reviewed evidence is genuinely absent.';
    fs.writeFileSync(FILE, JSON.stringify(cur, null, 2));
  }

  const by = (k) => log.reduce((a, l) => { a[l[k]] = (a[l[k]] || 0) + 1; return a; }, {});
  console.log(JSON.stringify({
    mode: DRY ? 'DRY' : 'WROTE',
    levelDist: by('newLevel'), confidenceDist: by('confidence'),
    changed: log.filter((l) => l.changed).map((l) => `${l.id} ${l.oldLevel}→${l.newLevel} [${l.confidence}] (journal=${l.journal}, reg=${l.registered})`),
    needsReview: log.filter((l) => l.confidence === 'NEEDS_REVIEW').map((l) => `${l.id} (journal=${l.journal}, publishedTrial=${l.publishedTrial})`),
  }, null, 1));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
