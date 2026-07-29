/**
 * connectors.js — Research connector architecture.
 *
 * LIVE connectors (PubMed, ClinicalTrials.gov) hit real public APIs via fetch. They
 * NEVER throw and NEVER fabricate: any failure (offline, timeout, bad response) returns
 * status 'UNKNOWN' with a message. STUB connectors (Health Canada DPD, openFDA) declare
 * themselves honestly as not-yet-wired — the interface exists, the data does not.
 *
 * The app's primary evidence still comes from the SEEDED corpus (real, verified citations).
 * These connectors are the live-lookup layer; the MVP does not block on them.
 */

const CONNECTORS = [
  { id: 'pubmed', label: 'PubMed (NCBI E-utilities)', status: 'LIVE', base: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils' },
  { id: 'clinicaltrials', label: 'ClinicalTrials.gov API v2', status: 'LIVE', base: 'https://clinicaltrials.gov/api/v2' },
  { id: 'healthcanada_dpd', label: 'Health Canada Drug Product Database', status: 'STUB', base: 'https://health-products.canada.ca/api/drug' },
  { id: 'openfda', label: 'openFDA', status: 'STUB', base: 'https://api.fda.gov' },
  { id: 'usda_fdc', label: 'USDA FoodData Central', status: 'LIVE', base: 'https://api.nal.usda.gov/fdc/v1' },
];

const TIMEOUT_MS = 6000;

async function fetchJson(url) {
  if (typeof fetch !== 'function') {
    return { _ok: false, _reason: 'global fetch unavailable (Node < 18)' };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'VitalisResourceApp/0.1 (research lookup)' } });
    if (!res.ok) return { _ok: false, _reason: `HTTP ${res.status}` };
    return { _ok: true, data: await res.json() };
  } catch (e) {
    return { _ok: false, _reason: e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'fetch error' };
  } finally {
    clearTimeout(t);
  }
}

// --- LIVE: PubMed -----------------------------------------------------------
async function pubmedSearch(term, { retmax = 5, sort = 'relevance' } = {}) {
  const base = { source: 'PubMed', connector: 'pubmed', term };
  if (!term) return { ...base, status: 'UNKNOWN', message: 'No search term.', results: [] };
  const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&sort=${encodeURIComponent(sort)}&term=${encodeURIComponent(term)}`;
  const s = await fetchJson(esearchUrl);
  if (!s._ok) return { ...base, status: 'UNKNOWN', message: `PubMed unavailable (${s._reason}) — UNKNOWN, not fabricated.`, results: [] };
  const ids = (s.data && s.data.esearchresult && s.data.esearchresult.idlist) || [];
  if (!ids.length) return { ...base, status: 'LIVE', message: 'No PubMed records matched.', count: 0, results: [] };
  const sum = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`);
  const results = sum._ok && sum.data && sum.data.result
    ? ids.map((id) => {
        const r = sum.data.result[id] || {};
        return { pmid: id, title: r.title || null, source: r.fulljournalname || r.source || null, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` };
      })
    : ids.map((id) => ({ pmid: id, title: null, source: null, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` }));
  return { ...base, status: 'LIVE', count: ids.length, results };
}

// --- LIVE: ClinicalTrials.gov ----------------------------------------------
async function clinicalTrialsSearch(term, { pageSize = 5 } = {}) {
  const base = { source: 'ClinicalTrials.gov', connector: 'clinicaltrials', term };
  if (!term) return { ...base, status: 'UNKNOWN', message: 'No search term.', results: [] };
  const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(term)}&pageSize=${pageSize}`;
  const r = await fetchJson(url);
  if (!r._ok) return { ...base, status: 'UNKNOWN', message: `ClinicalTrials.gov unavailable (${r._reason}) — UNKNOWN, not fabricated.`, results: [] };
  const studies = (r.data && r.data.studies) || [];
  const results = studies.map((st) => {
    const ps = st.protocolSection || {};
    const nct = (ps.identificationModule && ps.identificationModule.nctId) || null;
    return {
      nctId: nct,
      title: (ps.identificationModule && ps.identificationModule.briefTitle) || null,
      status: (ps.statusModule && ps.statusModule.overallStatus) || null,
      studyType: (ps.designModule && ps.designModule.studyType) || null, // INTERVENTIONAL | OBSERVATIONAL
      url: nct ? `https://clinicaltrials.gov/study/${nct}` : null,
    };
  });
  return { ...base, status: 'LIVE', count: results.length, results };
}

// --- STUB: Health Canada DPD ------------------------------------------------
async function healthCanadaDPD(term) {
  return {
    source: 'Health Canada DPD', connector: 'healthcanada_dpd', term,
    status: 'STUB',
    message: 'Health Canada Drug Product Database connector is defined but not yet wired. Returns STUB — no data fabricated.',
    results: [],
  };
}

// --- STUB: openFDA ----------------------------------------------------------
async function openFDA(term) {
  return {
    source: 'openFDA', connector: 'openfda', term,
    status: 'STUB',
    message: 'openFDA connector is defined but not yet wired. Returns STUB — no data fabricated.',
    results: [],
  };
}

// --- LIVE: USDA FoodData Central (keyless DEMO_KEY or env USDA_FDC_API_KEY) --
// The meal engine's first nutrition-enrichment source. Like the other LIVE connectors it
// NEVER throws and NEVER fabricates: any failure (offline, rate-limit, bad response) returns
// status 'UNKNOWN'. A food the engine cannot source here stays SOURCE_PENDING upstream.
async function usdaFoodSearch(term, { pageSize = 5 } = {}) {
  const base = { source: 'USDA FoodData Central', connector: 'usda_fdc', term };
  if (!term) return { ...base, status: 'UNKNOWN', message: 'No search term.', results: [] };
  const key = (typeof process !== 'undefined' && process.env && process.env.USDA_FDC_API_KEY) || 'DEMO_KEY';
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(term)}&pageSize=${pageSize}&dataType=${encodeURIComponent('Foundation,SR Legacy')}`;
  const r = await fetchJson(url);
  if (!r._ok) return { ...base, status: 'UNKNOWN', message: `USDA FoodData Central unavailable (${r._reason}) — UNKNOWN, not fabricated.`, results: [] };
  const foods = (r.data && r.data.foods) || [];
  const macro = (food, names, unit) => {
    const list = (food.foodNutrients || []).filter((x) => names.some((nm) => String(x.nutrientName || '').toLowerCase().includes(nm)));
    const u = unit ? list.find((x) => String(x.unitName || '').toUpperCase() === unit) : null;
    const pick = u || list[0];
    return pick && pick.value != null ? pick.value : null;
  };
  const results = foods.map((f) => ({
    fdcId: f.fdcId || null,
    description: f.description || null,
    kcal: macro(f, ['energy'], 'KCAL'),
    proteinG: macro(f, ['protein']),
    carbG: macro(f, ['carbohydrate']),
    fatG: macro(f, ['total lipid', 'fat']),
    source: 'usda_fdc',
  }));
  return { ...base, status: 'LIVE', count: results.length, results };
}

// Aggregate live lookup (used by the research-gate screen "look it up" action).
async function liveLookup(term) {
  const [pm, ct] = await Promise.all([pubmedSearch(term), clinicalTrialsSearch(term)]);
  return {
    term,
    pubmed: pm,
    clinicaltrials: ct,
    healthcanada_dpd: await healthCanadaDPD(term),
    openfda: await openFDA(term),
  };
}

module.exports = { CONNECTORS, pubmedSearch, clinicalTrialsSearch, healthCanadaDPD, openFDA, usdaFoodSearch, liveLookup };
