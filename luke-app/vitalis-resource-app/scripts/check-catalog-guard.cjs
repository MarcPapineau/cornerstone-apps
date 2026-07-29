#!/usr/bin/env node
'use strict';
/**
 * check-catalog-guard.cjs — anti-drift guard for the ONE canonical catalog.
 * Runs as `prebuild` (build gate) and via `npm run check:catalog`.
 *
 * Canonical catalog = packages/protocol-core/data/catalog.json (the ONLY source of truth).
 *
 * HARD FAILS (exit 1):
 *   1. A client/practitioner catalog projection leaks internal economics (cost/margin/costPerMg).
 *   2. The canonical catalog — or ANY projection — carries a discount field.
 *   3. My Vitalis Health server-side code reads a FROZEN legacy catalog directly.
 *   4. Active discount/coupon logic exists in the engine or a pricing surface.
 * WARNINGS (exit 0):
 *   5. A frozen legacy snapshot diverges from canonical (product count or shared-SKU price).
 *
 * Pricing/margins are OWNER-CONTROLLED (set manually by Marc). No automatic discount exists.
 */
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP_DIR, '../..');
const CANON = path.join(ROOT, 'packages/protocol-core/data/catalog.json');
const LEGACY = {
  luke: path.join(ROOT, 'luke-app/public/catalog-data.json'),
  peptide: path.join(ROOT, 'peptide-resource-app/src/data/catalog-data.json'),
};

let failed = false;
const fail = (m) => { failed = true; console.error('  ✗ FAIL: ' + m); };
const warn = (m) => console.warn('  ⚠ WARN: ' + m);
const okk = (m) => console.log('  ✓ ' + m);

console.log('catalog guard — canonical = packages/protocol-core/data/catalog.json');

// --- Check 1 + 2: projection economics + NO discount fields anywhere ---
try {
  const CAT = require('@vitalis/protocol-core/catalog');
  const raw = CAT.allProductsRaw();
  for (const role of ['CLIENT', 'PRACTITIONER', undefined, 'bogus']) {
    if (CAT.leaksEconomics(CAT.projectCatalog(raw, role))) {
      fail(`role=${role} catalog projection leaks internal economics (${CAT.INTERNAL_ECONOMICS_FIELDS.join('/')})`);
    }
  }
  if (!CAT.leaksEconomics(CAT.projectCatalog(raw, 'ADMIN'))) {
    warn('ADMIN projection exposes no economics — expected cost/margin for admin (catalog data may lack economics)');
  }
  // Discount logic is forbidden: no product (raw or any projection) may carry a discount field.
  if (CAT.hasDiscountField(raw)) fail(`canonical catalog contains a forbidden discount field (${CAT.FORBIDDEN_DISCOUNT_FIELDS.join('/')})`);
  for (const role of ['CLIENT', 'PRACTITIONER', 'ADMIN']) {
    if (CAT.hasDiscountField(CAT.projectCatalog(raw, role))) fail(`role=${role} catalog projection exposes a forbidden discount field`);
  }
  if (!failed) okk('projection: economics ADMIN-only; NO discount field in catalog or any projection');
} catch (e) {
  fail('could not load @vitalis/protocol-core/catalog: ' + e.message);
}

// --- shared file walker ---
function walk(roots, fn, { skip = [] } = {}) {
  const seen = (f) => skip.some((s) => f.endsWith(s));
  function rec(p) {
    if (p.includes('node_modules') || p.includes(`${path.sep}dist${path.sep}`)) return;
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const e of fs.readdirSync(p)) rec(path.join(p, e)); }
    else if (/\.(js|mjs|cjs|jsx)$/.test(p) && !seen(p)) fn(p);
  }
  roots.forEach(rec);
}

// --- Check 3: app server-side code must not read a legacy catalog directly ---
const LEGACY_PATTERNS = [/public\/catalog-data\.json/, /peptide-resource-app\/src\/data\/catalog-data\.json/];
walk(
  [path.join(APP_DIR, 'server.js'), path.join(APP_DIR, 'lib'), path.join(APP_DIR, 'src'), path.join(APP_DIR, 'scripts')],
  (f) => { let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return; } for (const re of LEGACY_PATTERNS) if (re.test(t)) fail(`${path.relative(ROOT, f)} reads a FROZEN legacy catalog (${re})`); },
  // legacy-import.mjs is the only file allowed to reference frozen sources; the guard names them to detect them.
  { skip: ['legacy-import.mjs', 'check-catalog-guard.cjs'] },
);
if (!failed) okk('no My Vitalis Health code reads a frozen legacy catalog directly');

// --- Check 4: no ACTIVE discount/coupon logic in the engine or any pricing surface ---
const DISCOUNT_RE = /discount|coupon|maxDiscount/i;
walk(
  [path.join(ROOT, 'packages/protocol-core'), path.join(APP_DIR, 'server.js'), path.join(APP_DIR, 'lib')],
  (f) => { let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return; } if (DISCOUNT_RE.test(t)) fail(`${path.relative(ROOT, f)} contains discount/coupon logic — discounts are owner-manual only`); },
  // These files NAME discount fields solely to forbid/document them — not active logic.
  { skip: ['catalog.js', 'check-catalog-guard.cjs', 'legacy-import.mjs'] },
);
if (!failed) okk('no active discount/coupon logic in protocol-core engine or pricing surfaces');

// --- Check 5: legacy parity (WARN only — frozen snapshots may intentionally drift) ---
function flatten(obj) {
  const out = [];
  for (const s of ['vials', 'pens', 'sprays', 'other']) for (const p of (obj[s] || [])) out.push(p);
  return out;
}
try {
  const canon = JSON.parse(fs.readFileSync(CANON, 'utf8'));
  const canonProducts = canon.products || [];
  const canonBySku = {};
  for (const p of canonProducts) if (p.sku) canonBySku[p.sku] = p;

  if (fs.existsSync(LEGACY.luke)) {
    const lukeFlat = flatten(JSON.parse(fs.readFileSync(LEGACY.luke, 'utf8')));
    if (lukeFlat.length !== canonProducts.length) warn(`luke legacy ${lukeFlat.length} products vs canonical ${canonProducts.length}`);
    let drift = 0;
    for (const p of lukeFlat) {
      const c = p.sku && canonBySku[p.sku];
      if (c && typeof p.msrp === 'number' && typeof c.msrp === 'number' && p.msrp !== c.msrp) drift++;
    }
    if (drift) warn(`luke legacy diverges from canonical on ${drift} shared-SKU price(s) (expected for a frozen snapshot)`);
    else okk('luke legacy snapshot prices match canonical');
  }
  if (fs.existsSync(LEGACY.peptide)) {
    const pepFlat = flatten(JSON.parse(fs.readFileSync(LEGACY.peptide, 'utf8')));
    if (pepFlat.length && pepFlat.length !== canonProducts.length) warn(`peptide legacy ${pepFlat.length} products vs canonical ${canonProducts.length}`);
    else okk(`peptide legacy snapshot present (${pepFlat.length} products)`);
  }
} catch (e) {
  warn('parity check skipped: ' + e.message);
}

// --- Check 6: ONE canonical dosing authority (anti-drift) ---
// The dosing engine (BLEND_SCHEDULES / selectedScheduleFor / blendScheduleFor) is DEFINED only in
// packages/protocol-core/data/dosing.js. App code (src / server.js / lib) may CALL it (via the
// document-model), but must never define a parallel authority, reintroduce the banned `normalizedDosing`
// adapter, or construct dosing/schedule objects ad-hoc. (Imports/calls are fine — only definitions/
// ad-hoc construction fail.) Closes the source-level gap the data-layer acceptance tests can't see.
const DOSING_DEF_RE = /\b(?:function|const|let|var)\s+(?:selectedScheduleFor|blendScheduleFor|BLEND_SCHEDULES)\b|\b(?:selectedScheduleFor|blendScheduleFor|BLEND_SCHEDULES)\s*=\s*(?:function|\(|async|\{)/;
const PARALLEL_AUTHORITY_RE = /\bnormalizedDosing\b/;
const ADHOC_SCHEDULE_RE = /\b(?:scheduleGrid|selectedDose|referenceRange)\s*:/;
walk(
  [path.join(APP_DIR, 'src'), path.join(APP_DIR, 'server.js'), path.join(APP_DIR, 'lib')],
  (f) => {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return; }
    const rel = path.relative(ROOT, f);
    if (DOSING_DEF_RE.test(t)) fail(`${rel} DEFINES a dosing authority — the ONLY definer is packages/protocol-core/data/dosing.js (calls are fine, definitions are not)`);
    if (PARALLEL_AUTHORITY_RE.test(t)) fail(`${rel} references a banned parallel dosing authority 'normalizedDosing' — collapse to the canonical engine`);
    if (ADHOC_SCHEDULE_RE.test(t)) fail(`${rel} constructs a dosing/schedule object ad-hoc (scheduleGrid/selectedDose/referenceRange:) — renderers/server must only READ canonical document-model output`);
  },
);
if (!failed) okk('ONE canonical dosing authority: app reads protocol-core; no parallel/ad-hoc dosing defined in src/server/lib');

// --- Check 7: no drifted KLOW vial-math on the Vitalis surface ---
// Canonical KLOW = ONE co-lyophilized blend dosed "KLOW 10 IU"; weekly translation is
// "2.5mg BPC-157 · 2.5mg TB-500 · 2.5mg KPV · 10mg GHK-Cu per week". The old vial-math drift
// (12.5/17.5/50/70 mg, "12.5 mg GHK") must never reappear on the Vitalis app or the canonical engine.
const KLOW_FORBIDDEN = [/12\.5\s*mg BPC-157/i, /17\.5\s*mg BPC-157/i, /50\s*mg GHK-Cu/i, /70\s*mg GHK-Cu/i, /12\.5\s*mg GHK\b/i];
walk(
  [path.join(APP_DIR, 'src'), path.join(APP_DIR, 'server.js'), path.join(APP_DIR, 'lib'), path.join(ROOT, 'packages/protocol-core')],
  (f) => {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return; }
    for (const re of KLOW_FORBIDDEN) if (re.test(t)) fail(`${path.relative(ROOT, f)} contains drifted KLOW vial-math (${re}) — KLOW is ONE blend "KLOW 10 IU"; the canonical weekly line is 10mg GHK-Cu`);
  },
  // acceptance.js + this guard NAME the forbidden strings solely to forbid them.
  { skip: ['acceptance.js', 'check-catalog-guard.cjs'] },
);
if (!failed) okk('no drifted KLOW vial-math on the Vitalis surface (canonical KLOW 10 IU / 10mg GHK-Cu)');

if (failed) { console.error('catalog guard: FAILED'); process.exit(1); }
console.log('catalog guard: OK');
