'use strict';
/**
 * research-sources.js — the Research Source Registry (seeded source-of-truth).
 *
 * The platform's evidence comes from a KNOWN set of registries / databases. This file is
 * the honest catalogue of them: each entry declares LIVE (wired connector), STUB (interface
 * defined, not wired), or PLANNED (identified, no connector built) — and NEVER claims a
 * source is live unless its connector says so (research.js reconciles status against
 * connectors.js). No source here fabricates data; an unwired source yields nothing.
 *
 * Wired ids (pubmed / clinicaltrials / healthcanada_dpd / openfda) MATCH the ids in connectors.js
 * so research.js can defer to the connector's real status. Registry-only sources keep their honest
 * PLANNED/STUB here. Government / regulatory sources are compliance / index context ONLY — never an
 * evidence authority. WHO and NIH / NIH ODS are EXCLUDED app-facing (Vitalis Source Doctrine).
 * Resource/educational only — never medical advice.
 */

const RESEARCH_SOURCES = [
  // --- Wired (status reconciled against connectors.js) ---------------------
  { id: 'clinicaltrials', label: 'ClinicalTrials.gov API v2', kind: 'TRIAL_REGISTRY', jurisdiction: 'US', status: 'LIVE', base: 'https://clinicaltrials.gov/api/v2', note: 'Wired live connector.' },
  { id: 'pubmed', label: 'PubMed / NCBI E-utilities', kind: 'LITERATURE', jurisdiction: 'US', status: 'LIVE', base: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils', note: 'Wired live connector.' },
  { id: 'healthcanada_dpd', label: 'Health Canada Drug Product Database', kind: 'REGULATOR', jurisdiction: 'CA', status: 'STUB', base: 'https://health-products.canada.ca/api/drug', note: 'Connector interface defined; not yet wired.' },
  { id: 'openfda', label: 'openFDA', kind: 'REGULATOR', jurisdiction: 'US', status: 'STUB', base: 'https://api.fda.gov', note: 'Compliance / regulatory index only — NOT an evidence authority.' },

  // WHO ICTRP and NIH Office of Dietary Supplements are intentionally EXCLUDED from this app-facing
  // registry per the Vitalis Source Doctrine (docs/vitalis-research-doctrine.md). research-doctrine
  // .appFacingRegistry() also filters them defensively so they cannot recur.

  // --- Registry-only (identified; no connector built — honest PLANNED) ------
  { id: 'eu_ctis', label: 'EU Clinical Trials Information System (CTIS / EUCTR)', kind: 'TRIAL_REGISTRY', jurisdiction: 'EU', status: 'PLANNED', base: null, note: 'Registry identified; connector not built.' },
  { id: 'chictr', label: 'Chinese Clinical Trial Registry (ChiCTR)', kind: 'TRIAL_REGISTRY', jurisdiction: 'CN', status: 'PLANNED', base: null, note: 'Registry identified; connector not built.' },
  { id: 'jrct', label: 'Japan Registry of Clinical Trials (jRCT / JPRN)', kind: 'TRIAL_REGISTRY', jurisdiction: 'JP', status: 'PLANNED', base: null, note: 'Registry identified; connector not built.' },
  { id: 'grls', label: 'Russian State Register of Medicines (GRLS)', kind: 'REGULATOR', jurisdiction: 'RU', status: 'PLANNED', base: null, note: 'Registry identified; connector not built. Compliance / index context only.' },
  { id: 'usda_fdc', label: 'USDA FoodData Central', kind: 'FOOD', jurisdiction: 'US', status: 'LIVE', base: 'https://api.nal.usda.gov/fdc/v1', note: 'Food-macro index only (CC0). Nutrition cross-reference, NOT an evidence authority.' },
  { id: 'healthcanada_nutrition', label: 'Health Canada — Nutrition & Dietary Guidance', kind: 'FOOD', jurisdiction: 'CA', status: 'PLANNED', base: null, note: 'Reference guidance; connector not built.' },
];

// The ONLY honest status values a source may carry.
const SOURCE_STATUSES = ['LIVE', 'STUB', 'PLANNED'];

module.exports = { RESEARCH_SOURCES, SOURCE_STATUSES };
