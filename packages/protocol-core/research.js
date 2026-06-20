'use strict';
/**
 * research.js — the Research Source Registry accessor + evidence-review gate.
 *
 * REUSE > REBUILD: the live-lookup layer already exists (connectors.js). This module does
 * NOT build a parallel fetcher — it presents the seeded registry (data/research-sources.js)
 * with each source's status RECONCILED against the real connector status, so a source is
 * only ever reported LIVE when its connector actually is. Everything else is honestly STUB
 * or PLANNED. The evidence-review gate stays pure/offline and NEVER fabricates citations:
 * non-live sources yield an empty UNKNOWN review; live sources yield PENDING (the caller
 * performs the real network lookup via connectors.liveLookup). NOT medical advice.
 */
const connectors = require('./connectors');
const M = require('./models');
const { RESEARCH_SOURCES, SOURCE_STATUSES } = require('./data/research-sources');
const evidenceCorpus = require('./data/evidence.json');
const NE = require('./data/nutrient-evidence');
const doctrine = require('./research-doctrine');

// The merged registry: wired sources defer to the connector's real status; registry-only
// sources keep their seeded PLANNED/STUB. Returns ResearchSource models (honest by design).
function researchSourceRegistry() {
  const byConnector = {};
  for (const c of connectors.CONNECTORS || []) byConnector[c.id] = c;
  // Doctrine gate: WHO / NIH (and anything excluded) are filtered out app-facing; every entry is
  // labeled with its lane and is NEVER an evidence authority (only peer-reviewed papers are).
  return doctrine.appFacingRegistry(RESEARCH_SOURCES).map((s) => {
    const wired = byConnector[s.id];
    return { ...M.ResearchSource({ ...s, status: wired ? wired.status : s.status }), lane: doctrine.laneForUrl(s.base || s.label), evidenceAuthority: doctrine.isEvidenceAuthority(s) };
  });
}

function registrySummary() {
  const reg = researchSourceRegistry();
  const count = (st) => reg.filter((s) => s.status === st).length;
  return {
    total: reg.length,
    live: count('LIVE'),
    stub: count('STUB'),
    planned: count('PLANNED'),
    statuses: SOURCE_STATUSES,
  };
}

// Honest evidence-review request. A LIVE source → PENDING (caller runs the real lookup via
// connectors.liveLookup); anything else → UNKNOWN with no rows. NEVER fabricates citations.
function evidenceReviewGate(input = {}) {
  const sourceId = input.sourceId || null;
  const term = input.term || null;
  const src = researchSourceRegistry().find((s) => s.id === sourceId) || null;
  const status = src && src.status === 'LIVE' ? 'PENDING' : 'UNKNOWN';
  return M.EvidenceReview({ sourceId, term, status, citations: [] });
}

// ---------------------------------------------------------------------------
// Research Gap Closure System
//
// The HONEST research backlog, computed from the corpus — it never marks anything
// LIVE/complete that isn't. A gap is anything we cannot yet stand behind with sourced
// evidence: a compound whose evidence tier is UNKNOWN/LOW, a supplement nutrient on weak
// evidence, a registry connector that isn't LIVE, and the meal-macro source that still
// reads SOURCE_PENDING until USDA-verified. Each gap carries a priority, a research-workflow
// status, the registries to search, and the next concrete action. The status workflow is
// UNKNOWN → SEARCH_NEEDED → SOURCE_FOUND → REVIEWED → LOCKED; advancing it is an operator
// act (server-side), and it NEVER auto-promotes a source to LIVE.
// ---------------------------------------------------------------------------
const GAP_STATUSES = ['UNKNOWN', 'SEARCH_NEEDED', 'SOURCE_FOUND', 'REVIEWED', 'LOCKED'];
const GAP_KINDS = ['COMPOUND', 'NUTRIENT', 'CONNECTOR', 'FOOD', 'CITATION'];
const STRONG_LEVELS = ['HIGH', 'GUIDELINE', 'STRONG', 'RDA', 'MODERATE'];
// Source TARGETS for research gaps — peer-reviewed-first. Government registries (ClinicalTrials.gov)
// appear only as an index/cross-check, never as the evidence authority. WHO / NIH excluded.
const TRIAL_TARGETS = ['PubMed', 'EU CTIS', 'ChiCTR', 'jRCT', 'ClinicalTrials.gov (index)'];
const SUPP_TARGETS = ['PubMed', 'Cochrane', 'Examine.com (discovery)', 'Linus Pauling Institute'];
const FOOD_TARGETS = ['USDA FoodData Central (index)', 'Peer-reviewed nutrition literature'];

function citeCount(rec) {
  if (!rec) return 0;
  return rec.citationCount != null ? rec.citationCount : (rec.citations || []).length;
}

function researchGaps() {
  const gaps = [];

  // 1. Compounds with UNKNOWN or LOW (weak) evidence, or zero citations.
  const byC = evidenceCorpus.byCompound || {};
  for (const id of Object.keys(byC)) {
    const rec = byC[id] || {};
    const level = String(rec.evidenceLevel || 'UNKNOWN').toUpperCase();
    const cites = citeCount(rec);
    const weak = level === 'UNKNOWN' || level === 'LOW' || cites === 0;
    if (!weak) continue;
    const priority = (level === 'UNKNOWN' && !rec.hasClinicalTrial) || cites === 0
      ? 'high'
      : level === 'UNKNOWN' ? 'medium' : 'low';
    gaps.push(M.ResearchGap({
      id: `cmp_${id}`, kind: 'COMPOUND', label: rec.name || rec.fullName || id,
      evidenceLevel: level, citationCount: cites, priority,
      sourceTarget: TRIAL_TARGETS, status: 'UNKNOWN',
      nextAction: level === 'UNKNOWN'
        ? 'Search ClinicalTrials.gov + PubMed for primary human evidence; assign an evidence tier with sourced citations.'
        : 'Strengthen the evidence tier — add higher-quality clinical citations.',
    }));
  }

  // 2. Supplement nutrients on weak/emerging evidence (electrolytes excluded — never suggestions).
  for (const n of (NE.NUTRIENTS || [])) {
    const rec = n.evidenceRec || {};
    const level = String(rec.evidenceLevel || 'UNKNOWN').toUpperCase();
    const cites = citeCount(rec);
    if (STRONG_LEVELS.includes(level) && cites > 0) continue;
    gaps.push(M.ResearchGap({
      id: `nut_${n.nutrientId}`, kind: 'NUTRIENT', label: n.name,
      evidenceLevel: level, citationCount: cites,
      priority: cites === 0 ? 'medium' : 'low',
      sourceTarget: SUPP_TARGETS, status: 'SEARCH_NEEDED',
      nextAction: 'Confirm peer-reviewed references (PubMed / Cochrane / independent labs) for the supplement recommendation.',
    }));
  }

  // 3. Every registry connector that is not LIVE (planned/stub — honestly not wired).
  for (const s of researchSourceRegistry()) {
    if (s.status === 'LIVE') continue;
    gaps.push(M.ResearchGap({
      id: `src_${s.id}`, kind: 'CONNECTOR', label: s.label,
      evidenceLevel: s.status, citationCount: null,
      priority: s.status === 'STUB' ? 'medium' : 'low',
      sourceTarget: [s.label], status: s.status === 'STUB' ? 'SOURCE_FOUND' : 'SEARCH_NEEDED',
      nextAction: s.status === 'STUB'
        ? 'Wire the defined connector to its live API and verify a real lookup before marking LIVE.'
        : 'Build + test a connector for this registry; do not mark LIVE until a real lookup returns data.',
    }));
  }

  // 4. Meal-plan macros still reading SOURCE_PENDING until USDA-verified.
  gaps.push(M.ResearchGap({
    id: 'food_usda_enrichment', kind: 'FOOD', label: 'Meal-plan macros pending USDA verification',
    evidenceLevel: 'SOURCE_PENDING', citationCount: null, priority: 'medium',
    sourceTarget: FOOD_TARGETS, status: 'SEARCH_NEEDED',
    nextAction: 'Enrich the seeded meal macros via the live USDA FoodData Central connector and cite the FDC IDs.',
  }));

  // Stable order: priority (high→low), then kind, then label.
  const rank = { high: 0, medium: 1, low: 2 };
  return gaps.sort((a, b) =>
    (rank[a.priority] - rank[b.priority]) ||
    a.kind.localeCompare(b.kind) ||
    a.label.localeCompare(b.label));
}

function researchGapsSummary(gaps) {
  const list = gaps || researchGaps();
  const by = (key) => list.reduce((acc, g) => { acc[g[key]] = (acc[g[key]] || 0) + 1; return acc; }, {});
  const live = registrySummary().live;
  return {
    total: list.length,
    open: list.filter((g) => g.status !== 'LOCKED').length,
    byPriority: by('priority'),
    byStatus: by('status'),
    byKind: by('kind'),
    statuses: GAP_STATUSES,
    kinds: GAP_KINDS,
    liveConnectors: live,
  };
}

module.exports = {
  researchSourceRegistry,
  registrySummary,
  evidenceReviewGate,
  researchGaps,
  researchGapsSummary,
  GAP_STATUSES,
  GAP_KINDS,
  RESEARCH_SOURCES,
  SOURCE_STATUSES,
};
