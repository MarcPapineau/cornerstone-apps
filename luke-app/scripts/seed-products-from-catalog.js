#!/usr/bin/env node
'use strict';
/**
 * seed-products-from-catalog.js
 * One-shot script: reads catalog-data.json, maps each product into the
 * local-db.json products[] format that server.js (localDb.js) expects,
 * and writes the seeded DB as local-db-v1.json (NEVER overwrites local-db.json).
 *
 * Run: node luke-app/scripts/seed-products-from-catalog.js
 * from the workspace root, OR node scripts/seed-products-from-catalog.js
 * from within luke-app/.
 */

const fs   = require('fs');
const path = require('path');

// Resolve paths relative to this script's location (luke-app/scripts/)
const SCRIPT_DIR   = __dirname;
const LUKE_ROOT    = path.resolve(SCRIPT_DIR, '..');
const CATALOG_PATH = path.join(LUKE_ROOT, 'public', 'catalog-data.json');
const SOURCE_DB    = path.join(LUKE_ROOT, 'data', 'local-db.json');
const OUTPUT_DB    = path.join(LUKE_ROOT, 'data', 'local-db-v1.json');

console.log('=== Vitalis POS — Seed Products from Catalog ===');
console.log('Catalog:', CATALOG_PATH);
console.log('Source DB:', SOURCE_DB);
console.log('Output DB:', OUTPUT_DB);
console.log('');

// --- Load catalog-data.json ---
if (!fs.existsSync(CATALOG_PATH)) {
  console.error('ERROR: catalog-data.json not found at', CATALOG_PATH);
  process.exit(1);
}
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
// 2026-05-01 FIX (P0 BUG #1): include `sprays` category.
// Prior version flattened only vials+pens+other, silently dropping all spray
// SKUs (Spray BPC, etc.) on every reseed. Runtime code at app.js:478-483 and
// pos.js:49-54 already merges all 4 catalog categories — only the seeder was
// out-of-sync with catalog-data.json's actual top-level keys
// (`vials`, `pens`, `other`, `sprays`).
const allCatalogItems = [
  ...(catalog.vials  || []),
  ...(catalog.pens   || []),
  ...(catalog.other  || []),
  ...(catalog.sprays || []),
];
console.log(`Catalog loaded: ${allCatalogItems.length} products (${(catalog.vials||[]).length} vials, ${(catalog.pens||[]).length} pens, ${(catalog.other||[]).length} other, ${(catalog.sprays||[]).length} sprays)`);

// --- Load current local-db.json ---
if (!fs.existsSync(SOURCE_DB)) {
  console.error('ERROR: local-db.json not found at', SOURCE_DB);
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(SOURCE_DB, 'utf8'));
console.log(`Source DB loaded. Existing products: ${(db.products||[]).length}`);

// --- Map catalog items → localDb product records ---
// localDb stores records as { id, createdTime, fields: { ... } }
// server.js /api/products reads these fields:
//   'Product Name', 'SKU', 'Category', 'MSRP', 'Cost', 'Status', 'Description'
// Extra fields we pass through for the front-end enhancements:
//   'mg', 'isBox10', 'pricePerVial', 'isPen', 'discountAllowed', 'maxDiscountPct',
//   'margin', 'profit', 'mgLabel', 'penNote', 'costPerMg'

function inferCategory(item) {
  const sku  = (item.sku || '').toUpperCase();
  const name = (item.displayName || item.name || '').toLowerCase();

  if (item.isPen) return 'Pen';

  const FAT_LOSS = ['RETA','SEMA','AOD','TESA','HGH-FRAG','CLEN','TORCH','YOHIM','SLUP','REVOLEAN','LCAR'];
  const GH_AXIS  = ['CJC','IPA','SERM','GHRP','HEXAR','MOD-GRF'];
  const HEALING  = ['BPC','TB500','GHK','KPV','KLOW','COMBO-BPC','COMBO-CJC','GLOW','LL37'];
  const COGNIT   = ['SEMAX','SELANK','NAD','DSIP','PINEALON','P21'];
  const IMMUNE   = ['TA1','THYMO','HCG','KISS','PT141','MT2','OXY'];
  const LONGEVITY= ['EPITALON','SS31','MOTC','IGF1','SLU'];
  const BUNDLE   = ['COMBO','KLOW','GLOW'];

  if (BUNDLE.some(k  => sku.includes(k)))   return 'Bundle';
  if (HEALING.some(k => sku.includes(k)))   return 'Healing';
  if (FAT_LOSS.some(k => sku.includes(k)))  return 'Fat Loss';
  if (GH_AXIS.some(k => sku.includes(k)))   return 'GH Axis';
  if (COGNIT.some(k  => sku.includes(k)))   return 'Cognitive';
  if (IMMUNE.some(k  => sku.includes(k)))   return 'Immune / Hormonal';
  if (LONGEVITY.some(k => sku.includes(k))) return 'Longevity';

  // Fallback: check name
  if (name.includes('fat') || name.includes('weight')) return 'Fat Loss';
  if (name.includes('heal') || name.includes('repair')) return 'Healing';
  return 'Peptide';
}

let seq = db._seq || 1;
function makeId() { return 'rec' + String(seq++).padStart(8, '0'); }

const NOW = new Date().toISOString();
const seededProducts = allCatalogItems
  .filter(item => item.status !== 'Archived' && item.msrp > 0)
  .map(item => {
    const msrp   = parseFloat(item.msrp)  || 0;
    const cost   = parseFloat(item.cost)  || 0;
    const margin = item.margin !== undefined && item.margin !== null
      ? parseFloat(item.margin)
      : (msrp > 0 && cost > 0 ? parseFloat(((msrp - cost) / msrp * 100).toFixed(1)) : null);
    const profit = msrp > 0 && cost > 0 ? parseFloat((msrp - cost).toFixed(2)) : null;

    return {
      id:          item.id || makeId(),
      createdTime: NOW,
      fields: {
        // Standard server.js fields
        'Product Name':    item.displayName || item.name || '',
        'SKU':             item.sku || '',
        'Category':        inferCategory(item),
        'MSRP':            msrp,
        'Cost':            cost,
        'Status':          item.status || 'Active',
        'Description':     '',

        // Extended fields — used by front-end directly
        'Margin':          margin,
        'Profit':          profit,
        'mg':              item.mg   || null,
        'totalMg':         item.totalMg || null,
        'costPerMg':       item.costPerMg || null,
        'isBox10':         item.isBox10 || false,
        'pricePerVial':    item.pricePerVial || null,
        'boxPrice':        item.boxPrice || null,
        'isPen':           item.isPen || false,
        'mgLabel':         item.mgLabel || null,
        'penNote':         item.penNote || null,
        'discountAllowed': item.discountAllowed || false,
        'maxDiscountPct':  item.maxDiscountPct || 0,
      }
    };
  });

console.log(`Mapped ${seededProducts.length} products from catalog.`);

// --- Build the versioned DB (local-db-v1.json) ---
// Preserve all existing non-product collections (clients, orders, stacks, etc.)
// Only replace/fill the products array.
const outputDb = {
  ...db,
  products:  seededProducts,
  _seq:      seq,
  _seeded:   NOW,
  _seedNote: 'Seeded from catalog-data.json by seed-products-from-catalog.js'
};

fs.writeFileSync(OUTPUT_DB, JSON.stringify(outputDb, null, 2));

const byCategory = {};
seededProducts.forEach(p => {
  const cat = p.fields['Category'];
  byCategory[cat] = (byCategory[cat] || 0) + 1;
});

console.log('\nProducts by category:');
Object.entries(byCategory).sort().forEach(([cat, n]) => {
  console.log(`  ${cat}: ${n}`);
});

console.log(`\nDone. Wrote ${seededProducts.length} products to:`);
console.log(' ', OUTPUT_DB);
console.log('\nNEXT STEP (for Marc):');
console.log('  Review local-db-v1.json, then:');
console.log('    cp luke-app/data/local-db-v1.json luke-app/data/local-db.json');
console.log('  to make it live.');
console.log('\nDO NOT overwrite local-db.json automatically — per versioning doctrine.');
