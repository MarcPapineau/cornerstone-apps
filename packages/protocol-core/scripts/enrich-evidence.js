'use strict';
/**
 * enrich-evidence.js — enrich the peptide evidence corpus with REAL, RELEVANT citations.
 *
 * Pulls from the LIVE PubMed (NCBI E-utilities, sort=relevance) + ClinicalTrials.gov connectors
 * only — no LLM in the citation path, so nothing is fabricated. Queries are [Title/Abstract]-
 * anchored so the compound must be an actual topic (not a passing mention). Merges new real
 * citations into each compound, dedupes, NEVER downgrades a curated level (only proposes
 * upgrades), and logs every change for practitioner review.
 *   node scripts/enrich-evidence.js [--dry] [--limit N] [--only id,id]
 */
const fs = require('node:fs');
const path = require('node:path');
const connectors = require('../connectors');

const FILE = path.join(__dirname, '..', 'data', 'evidence.json');
const DRY = process.argv.includes('--dry');
const limArg = process.argv.indexOf('--limit');
const LIMIT = limArg >= 0 ? Number(process.argv[limArg + 1]) : null;
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg >= 0 ? String(process.argv[onlyArg + 1] || '').split(',').filter(Boolean) : null;

// [Title/Abstract]-anchored PubMed queries — real synonyms incl. legacy / trade / bioregulator names.
const TERMS = {
  bpc157: '(BPC-157[tiab] OR "BPC 157"[tiab] OR "pentadecapeptide BPC"[tiab])',
  reta: '(retatrutide[tiab] OR LY3437943[tiab])',
  tb500: '("thymosin beta-4"[tiab] OR "thymosin beta 4"[tiab] OR TB-500[tiab] OR "TB 500"[tiab])',
  nad: '("nicotinamide riboside"[tiab] OR "nicotinamide mononucleotide"[tiab] OR "NAD+ supplementation"[tiab] OR "NAD precursor"[tiab])',
  ipamorelin: 'ipamorelin[tiab]',
  cjc: '(CJC-1295[tiab] OR "CJC 1295"[tiab])',
  ghkcu: '(GHK-Cu[tiab] OR "GHK copper"[tiab] OR "copper tripeptide"[tiab] OR "GHK peptide"[tiab])',
  sermorelin: 'sermorelin[tiab]',
  aod9604: '(AOD9604[tiab] OR "AOD-9604"[tiab] OR "hGH fragment 177-191"[tiab])',
  ta1: '("thymosin alpha 1"[tiab] OR "thymosin alpha-1"[tiab] OR thymalfasin[tiab])',
  kpv: '(KPV[tiab] AND (peptide[tiab] OR "alpha-MSH"[tiab] OR inflammation[tiab]))',
  semax: 'semax[tiab]',
  selank: 'selank[tiab]',
  tesamorelin: 'tesamorelin[tiab]',
  slupppp332: '("SLU-PP-332"[tiab] OR "SLU PP 332"[tiab])',
  amino1mq: '("5-amino-1MQ"[tiab] OR "5-amino-1-methylquinolinium"[tiab] OR "1-methylquinolinium"[tiab])',
  epithalon: '(epitalon[tiab] OR epithalon[tiab] OR "AEDG peptide"[tiab])',
  motsc: '(MOTS-c[tiab] OR "MOTS c"[tiab])',
  hexarelin: 'hexarelin[tiab]',
  dihexa: '(dihexa[tiab] OR PNB-0408[tiab])',
  ss31: '(elamipretide[tiab] OR SS-31[tiab] OR MTP-131[tiab] OR bendavia[tiab])',
  dsip: '("delta sleep-inducing peptide"[tiab] OR DSIP[tiab])',
  p21: '(P021[tiab] AND (neurotrophic[tiab] OR peptide[tiab] OR neurogenesis[tiab]))',
  pinealon: 'pinealon[tiab]',
  pt141: '(bremelanotide[tiab] OR PT-141[tiab])',
  melanotan2: '("melanotan II"[tiab] OR "melanotan-2"[tiab] OR "melanotan 2"[tiab])',
  kisspeptin: 'kisspeptin[tiab]',
  ll37: '(LL-37[tiab] OR "cathelicidin LL-37"[tiab])',
  igf1lr3: '("IGF-1 LR3"[tiab] OR "Long R3 IGF-1"[tiab] OR "LR3 IGF"[tiab])',
  hghfrag: '("hGH fragment 176-191"[tiab] OR "growth hormone fragment 176-191"[tiab])',
  cardiogen: '(cardiogen[tiab] OR "cardiac peptide bioregulator"[tiab])',
  ghrp6: '(GHRP-6[tiab] OR "growth hormone releasing peptide-6"[tiab])',
  cjcnodac: '("mod-GRF 1-29"[tiab] OR "GRF(1-29)"[tiab] OR "CJC-1295 without DAC"[tiab])',
  humanin: 'humanin[tiab]',
  follistatin344: '("follistatin-344"[tiab] OR "follistatin 344"[tiab] OR FS344[tiab])',
  glutathione: '(glutathione[tiab] AND (supplementation[tiab] OR intravenous[tiab] OR liposomal[tiab] OR "oral glutathione"[tiab]))',
  thymalin: 'thymalin[tiab]',
  thymogen: '(thymogen[tiab] OR "gamma-glutamyl-tryptophan"[tiab])',
  vip: '("vasoactive intestinal peptide"[tiab] AND (therapy[tiab] OR aviptadil[tiab] OR nasal[tiab] OR sarcoidosis[tiab]))',
  bronchogen: '(bronchogen[tiab] OR "bronchus peptide bioregulator"[tiab])',
  adipotide: '(adipotide[tiab] OR "prohibitin-targeting peptide"[tiab])',
  cagrilintide: '(cagrilintide[tiab] OR AM833[tiab])',
  hcg: '("human chorionic gonadotropin"[tiab] AND (testosterone[tiab] OR hypogonadism[tiab] OR "male fertility"[tiab]))',
  igf1des: '("des(1-3) IGF-1"[tiab] OR "DES IGF-1"[tiab])',
  pnc27: '(PNC-27[tiab] OR PNC27[tiab])',
  gcmaf: '(GcMAF[tiab] OR "Gc protein-derived macrophage activating factor"[tiab])',
  teriparatide: '(teriparatide[tiab] OR "PTH 1-34"[tiab])',
  prostamax: '(prostamax[tiab] OR "prostate peptide bioregulator"[tiab])',
  melittin: 'melittin[tiab]',
};

const LEVELS = ['UNKNOWN', 'LOW', 'MODERATE', 'HIGH'];
const li = (x) => { const i = LEVELS.indexOf(x); return i < 0 ? 0 : i; };
const maxLevel = (a, b) => LEVELS[Math.max(li(a), li(b))];
function derive(n, trial) { if (trial && n >= 4) return 'HIGH'; if (n >= 5) return 'MODERATE'; if (n >= 1) return 'LOW'; return 'UNKNOWN'; }
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().trim();

// Distinctive synonyms for a compound (from its [tiab] query), used to confirm a
// ClinicalTrials.gov study is ACTUALLY about this compound before it can count as a trial.
function primarySynonyms(term, c) {
  const cleaned = String(term).replace(/\[tiab\]/g, '').replace(/\bAND\b[\s\S]*$/i, ' ');
  let parts = cleaned.split(/\bOR\b/i).map((s) => s.replace(/["()]/g, '').trim()).filter(Boolean);
  if (!parts.length) parts = [c.name];
  return parts.filter((p) => p.replace(/[^a-z0-9]/gi, '').length >= 4);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// WHOLE-WORD/phrase matcher: the synonym must appear bounded by non-alphanumerics (or string
// edges), with flexible internal separators. Fixes substring false-matches like the token
// "humanin" matching inside "human insulin". Honest > impressive.
function makeTitleMatcher(synonyms) {
  const res = synonyms.map((syn) => new RegExp('(^|[^a-z0-9])' + escapeRe(syn.trim()).replace(/[-\s]+/g, '[-\\s]?') + '($|[^a-z0-9])', 'i'));
  return (title) => res.some((re) => re.test(String(title || '')));
}

(async () => {
  const corpus = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let ids = Object.keys(corpus.byCompound);
  if (ONLY) ids = ids.filter((id) => ONLY.includes(id));
  if (LIMIT) ids = ids.slice(0, LIMIT);

  const log = [];
  for (const id of ids) {
    const c = corpus.byCompound[id];
    const term = TERMS[id] || c.fullName || c.name;
    let pm = { results: [] }, ct = { results: [] };
    try { pm = (await connectors.pubmedSearch(term, { retmax: 10, sort: 'relevance' })) || pm; } catch (e) { /* honest empty */ }
    await delay(280);
    const ctTerm = term.replace(/\[tiab\]/g, ''); // CT.gov doesn't grok PubMed field tags
    try { ct = (await connectors.clinicalTrialsSearch(ctTerm, { pageSize: 6 })) || ct; } catch (e) { /* honest empty */ }
    await delay(280);
    const pmResults = Array.isArray(pm.results) ? pm.results : [];
    const ctResults = Array.isArray(ct.results) ? ct.results : [];

    const existing = Array.isArray(c.citations) ? c.citations : [];
    const seen = new Set(existing.map((x) => norm(x.url || x.title)));
    const added = [];
    for (const p of pmResults) {
      const url = p.url; if (!url || !p.title) continue;
      if (seen.has(norm(url)) || seen.has(norm(p.title))) continue;
      seen.add(norm(url)); added.push({ title: p.title, source: p.source || 'PubMed', url, type: 'PubMed' });
    }
    // Trial RELEVANCE guard: only count a ClinicalTrials.gov study whose TITLE actually names the
    // compound — kills loose query.term false-matches that would otherwise fabricate a "clinical
    // trial" and over-claim the tier. Honest > impressive.
    const matchesCompound = makeTitleMatcher(primarySynonyms(term, c));
    for (const t of ctResults) {
      const url = t.url || (t.nctId ? `https://clinicaltrials.gov/study/${t.nctId}` : null); if (!url) continue;
      const title = t.title || '';
      if (!title || !matchesCompound(title)) continue; // study title must actually NAME the compound
      if (seen.has(norm(url))) continue;
      // INTERVENTIONAL = compound administered as therapy → counts toward the clinical-trial tier.
      // OBSERVATIONAL = compound only measured (biomarker) → kept as a real citation but does NOT
      // grant a trial tier (would over-claim, e.g. "plasma humanin in AKI"). Honest distinction.
      const interventional = String(t.studyType || '').toUpperCase() === 'INTERVENTIONAL';
      seen.add(norm(url));
      added.push({
        title,
        source: (interventional ? 'ClinicalTrials.gov · trial · ' : 'ClinicalTrials.gov · observational · ') + (t.status || ''),
        url,
        type: interventional ? 'ClinicalTrial' : 'Observational',
      });
    }

    const merged = existing.concat(added).slice(0, 16);
    const hasTrial = merged.some((x) => x.type === 'ClinicalTrial') || !!c.hasClinicalTrial;
    const oldLevel = c.evidenceLevel, oldN = c.citationCount || existing.length;
    const newLevel = maxLevel(oldLevel, derive(merged.length, hasTrial));

    log.push({ id, name: c.name, added: added.length, oldN, newN: merged.length, oldLevel, newLevel,
      upgraded: oldLevel !== newLevel, newTrials: ctResults.length,
      sampleAdds: added.slice(0, 3).map((a) => `${a.type}: ${a.title.slice(0, 72)}`) });

    if (!DRY) {
      c.citations = merged;
      c.citationCount = merged.length;
      c.hasClinicalTrial = hasTrial;
      c.clinicalTrialStatus = merged.some((x) => x.type === 'ClinicalTrial') ? 'TRIAL_CITED' : (c.clinicalTrialStatus || 'NO_TRIAL_CITED');
      c.evidenceLevel = newLevel;
    }
    process.stderr.write(`. ${id}(+${added.length})`);
  }

  if (!DRY) {
    corpus._provenance.enrichedAt = new Date().toISOString();
    corpus._provenance.enrichmentNote = 'Auto-enriched via LIVE PubMed (NCBI E-utilities, relevance-sorted, Title/Abstract-anchored) + ClinicalTrials.gov. Real citations only; curated levels never downgraded; proposed upgrades flagged for practitioner review.';
    fs.writeFileSync(FILE, JSON.stringify(corpus, null, 2));
  }

  const totalAdded = log.reduce((s, l) => s + l.added, 0);
  console.log('\n' + JSON.stringify({
    mode: DRY ? 'DRY-RUN (no write)' : 'WROTE evidence.json',
    compounds: log.length, totalAdded,
    upgraded: log.filter((l) => l.upgraded).map((l) => `${l.id} ${l.oldLevel}→${l.newLevel}`),
    perCompound: log,
  }, null, 1));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
