#!/usr/bin/env node
/**
 * legacy-import.mjs — DEPRECATED one-time legacy import tool. NOT a canonical sync.
 *
 * ⚠️  The catalog is now CANONICAL and AUTHORED at:
 *         packages/protocol-core/data/catalog.json
 *     Edit that file directly. This script does NOT run as part of any build and will
 *     NOT overwrite the canonical catalog unless you explicitly force it.
 *
 * History: this used to regenerate catalog.json + evidence.json from the legacy LUKE
 * catalog and the legacy peptide compounds corpus. Those sources are now FROZEN snapshots.
 * The script is retained only as a one-time import/recovery tool.
 *
 * To force a legacy re-import (overwrites the canonical catalog — you must re-verify after):
 *         node scripts/legacy-import.mjs --force-legacy-import
 *
 * Without that flag it prints this notice and exits without writing anything.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, '..');
// Canonical, authored data now lives in the shared core (@vitalis/protocol-core).
const DATA_DIR = resolve(APP_DIR, '../../packages/protocol-core/data');

// FROZEN legacy sources (read-only; do not edit — see the *.FROZEN.md companions).
const SRC_CATALOG = resolve(APP_DIR, '../public/catalog-data.json');           // luke-app catalog (frozen)
const SRC_COMPOUNDS = resolve(APP_DIR, '../../peptide-resource-app/src/data/compounds.js'); // peptide corpus (frozen)

const FORCE = process.argv.includes('--force-legacy-import');

const nowIso = new Date().toISOString();

// ---------------------------------------------------------------------------
// 1. CATALOG  →  ProductCatalogItem[] (full economics carried — ADMIN-only at the surface)
// ---------------------------------------------------------------------------
const SECTION_RULES = {
  vials:  { form: 'Lyophilized vial (reconstitute before use)', route: 'SubQ injection', routeBasis: 'catalog-section:vials (Biogenix injectable research vials)', supplier: 'Biogenix' },
  pens:   { form: 'Prefilled injector pen',                     route: 'SubQ injection', routeBasis: 'catalog-section:pens',                                       supplier: null },
  sprays: { form: 'Nasal spray',                                route: 'Intranasal',     routeBasis: 'catalog-section:sprays',                                     supplier: null },
  other:  { form: 'Other / unclassified',                       route: null,             routeBasis: 'catalog-section:other — route NOT determinable from source', supplier: null },
};

function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

function deriveAvailability(p) {
  const note = `${p.penNote || ''} ${p.name || ''} ${p.displayName || ''}`.toLowerCase();
  if (note.includes('discontinued') || note.includes('unavailable')) return 'DISCONTINUED';
  if ((p.status || '').toLowerCase() === 'active') return 'AVAILABLE';
  return 'UNKNOWN';
}

function buildCatalog() {
  const raw = JSON.parse(readFileSync(SRC_CATALOG, 'utf8'));
  const items = [];
  for (const section of ['vials', 'pens', 'sprays', 'other']) {
    const rule = SECTION_RULES[section];
    for (const p of raw[section] || []) {
      const supplier = p.name && /biogenix/i.test(p.name) ? 'Biogenix' : rule.supplier;
      const strengthMg = (typeof p.mg === 'number') ? p.mg : null;
      const msrp = typeof p.msrp === 'number' ? p.msrp : null;
      items.push({
        id: p.id || `prod_${normName(p.sku || p.name)}`,
        sku: p.sku || null,
        name: p.name || p.displayName || 'Unnamed product',
        displayName: p.displayName || p.name || null,
        category: section,                       // vials | pens | sprays | other
        form: rule.form,
        route: rule.route,                       // null === UNKNOWN (gate will block)
        routeBasis: rule.routeBasis,
        strengthMg,
        strengthLabel: p.mgLabel || (strengthMg ? `${strengthMg}mg` : null),
        doseUnits: strengthMg != null ? 'mg' : null,
        concentration: section === 'vials' ? 'Reconstitution-dependent (set by BAC water volume)' : null,
        availability: deriveAvailability(p),
        supplier,
        provider: supplier,
        // Client-facing pricing.
        msrp,
        pricePerVial: typeof p.pricePerVial === 'number' ? p.pricePerVial : null,
        boxPrice: typeof p.boxPrice === 'number' ? p.boxPrice : msrp,
        isBox10: typeof p.isBox10 === 'boolean' ? p.isBox10 : null,
        isPen: typeof p.isPen === 'boolean' ? p.isPen : null,
        mgLabel: p.mgLabel || null,
        penNote: p.penNote || null,
        // Internal economics — ADMIN-only via @vitalis/protocol-core/catalog projections.
        // NOTE: discount fields (discountAllowed / maxDiscountPct) are DELIBERATELY NOT
        // carried forward. Pricing/margins are owner-controlled; there is no discount logic.
        cost: typeof p.cost === 'number' ? p.cost : null,
        margin: typeof p.margin === 'number' ? p.margin : null,
        costPerMg: typeof p.costPerMg === 'number' ? p.costPerMg : null,
        totalMg: typeof p.totalMg === 'number' ? p.totalMg : null,
        status: p.status || null,
        ...(p._inactivated_reason ? { _inactivated_reason: p._inactivated_reason } : {}),
        _sourceSection: section,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 2. EVIDENCE  →  EvidenceCitation corpus (real citations only)
// ---------------------------------------------------------------------------
function mapConfidence(c) {
  const v = String(c || '').toUpperCase();
  if (['HIGH', 'MODERATE', 'EMERGING', 'LOW', 'PRELIMINARY'].includes(v)) return v;
  return 'UNKNOWN';
}
function classifyUrl(url = '') {
  if (/clinicaltrials\.gov/i.test(url)) return 'ClinicalTrial';
  if (/pubmed\.ncbi|ncbi\.nlm/i.test(url)) return 'PubMed';
  if (!url) return 'None';
  return 'Other';
}

async function buildEvidence() {
  const mod = await import(SRC_COMPOUNDS);
  const COMPOUNDS = mod.COMPOUNDS || [];
  const byCompound = {};
  const index = [];
  for (const c of COMPOUNDS) {
    const citations = (c.research || []).map(r => ({
      title: r.title || null,
      source: r.journal || null,
      url: r.url || null,
      type: classifyUrl(r.url),
    }));
    const hasClinicalTrial = citations.some(x => x.type === 'ClinicalTrial');
    const evidenceLevel = mapConfidence(c.confidence);
    const rec = {
      compoundId: c.id,
      name: c.name,
      fullName: c.fullName || c.name,
      category: c.category || null,
      evidenceLevel,
      mechanism: c.mechanism || null,
      citationCount: citations.length,
      hasClinicalTrial,
      clinicalTrialStatus: hasClinicalTrial ? 'TRIAL_CITED' : 'NO_TRIAL_CITED',
      knownSideEffects: c.sideEffects || [],
      contraindicationFlags: deriveFlags(c),
      citations,
      _normName: normName(c.name),
    };
    byCompound[c.id] = rec;
    index.push({ compoundId: c.id, name: c.name, normName: rec._normName, evidenceLevel, citationCount: citations.length });
  }
  return { byCompound, index, compoundCount: COMPOUNDS.length };
}

function deriveFlags(c) {
  const flags = [];
  const blob = `${(c.sideEffects || []).join(' ')} ${c.notable || ''}`.toLowerCase();
  if (/pancreatit|lipase|amylase/.test(blob)) flags.push('Pancreatic-enzyme monitoring noted in source side-effects');
  if (/nausea|gi |gastro|vomit/.test(blob)) flags.push('GI side-effects noted in source');
  if (/histamine|flush|burning/.test(blob)) flags.push('Histamine/flush reaction noted in source');
  if (c.flushWarning) flags.push('Flush warning flagged in source');
  if (c.burnWarning) flags.push('Injection-site burn flagged in source');
  flags.push('Practitioner review required before any use');
  return flags;
}

function crossLink(catalog, evidence) {
  let linked = 0;
  for (const item of catalog) {
    const pn = normName(item.name);
    let match = null;
    for (const e of evidence.index) {
      if (e.normName && e.normName.length >= 4 && pn.includes(e.normName)) { match = e.compoundId; break; }
    }
    item.evidenceCompoundId = match;
    if (match) linked++;
  }
  return linked;
}

// ---------------------------------------------------------------------------
// MAIN — gated. Refuses to overwrite the canonical catalog unless forced.
// ---------------------------------------------------------------------------
if (!FORCE) {
  console.log('');
  console.log('  ⚠️  legacy-import.mjs is a DEPRECATED legacy import tool — it did NOT run.');
  console.log('');
  console.log('  The canonical catalog is authored directly at:');
  console.log('      packages/protocol-core/data/catalog.json');
  console.log('  Edit that file. The legacy LUKE / peptide catalogs are FROZEN snapshots.');
  console.log('');
  console.log('  To force a one-time legacy re-import (OVERWRITES canonical — re-verify after):');
  console.log('      node scripts/legacy-import.mjs --force-legacy-import');
  console.log('');
  process.exit(0);
}

console.log('⚠️  FORCED legacy re-import — overwriting canonical catalog.json + evidence.json from FROZEN legacy sources.');
const catalog = buildCatalog();
const evidence = await buildEvidence();
const linkedCount = crossLink(catalog, evidence);

const catalogOut = {
  _provenance: {
    generatedAt: nowIso,
    source: 'luke-app/public/catalog-data.json (FROZEN legacy snapshot)',
    note: 'FORCED legacy re-import. Normalized into ProductCatalogItem with full economics. '
        + 'Internal economics are ADMIN-only via @vitalis/protocol-core/catalog projections. Re-verify after import.',
    productCount: catalog.length,
  },
  products: catalog,
};
const evidenceOut = {
  _provenance: {
    generatedAt: nowIso,
    source: 'peptide-resource-app/src/data/compounds.js (FROZEN legacy COMPOUNDS export)',
    note: 'FORCED legacy re-import. Citations copied verbatim. evidenceLevel mapped from compound.confidence.',
    compoundCount: evidence.compoundCount,
  },
  byCompound: evidence.byCompound,
  index: evidence.index,
};

writeFileSync(resolve(DATA_DIR, 'catalog.json'), JSON.stringify(catalogOut, null, 2) + '\n');
writeFileSync(resolve(DATA_DIR, 'evidence.json'), JSON.stringify(evidenceOut, null, 2) + '\n');

const routeKnown = catalog.filter(p => p.route).length;
console.log('FORCED LEGACY IMPORT COMPLETE');
console.log(`  catalog.json   : ${catalog.length} products (${routeKnown} with known route, ${catalog.length - routeKnown} UNKNOWN route)`);
console.log(`  evidence.json  : ${evidence.compoundCount} compounds, ${evidence.index.reduce((a, e) => a + e.citationCount, 0)} citations`);
console.log(`  cross-linked   : ${linkedCount}/${catalog.length} products have evidence`);
