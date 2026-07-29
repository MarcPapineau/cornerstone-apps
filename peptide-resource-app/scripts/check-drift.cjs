#!/usr/bin/env node
/**
 * scripts/check-drift.cjs
 * ============================================================================
 * BUILD-GATE drift checker. Runs as `prebuild` — if any check fails, the
 * build fails and the offending strings/files are listed.
 *
 * Why this exists: Marc's hard rule — "If the canonical source changes,
 * update every consumer or FAIL THE BUILD." This script enforces that gate.
 *
 * Checks (any failure exits 1):
 *   1. src/prompts/ must NOT exist (it was a duplicate of the live server
 *      prompt + carried stale stack content).
 *   2. _chat-tier-context.cjs is the ONLY file that defines TIER_MATRIX_SUMMARY.
 *   3. Both chat consumers (vitalis-chat-background.js, vitalis-system-prompt.js)
 *      MUST import from _chat-tier-context.cjs.
 *   4. Retired SKUs (GLOW-KPV-BOX10, OXY-2MG-BOX10) must NOT have status:Active
 *      in any catalog-data.json under the project.
 *   5. stacks.js MUST contain the sync-discipline comment block referencing
 *      _chat-tier-context.cjs.
 *   6. Drift rules — these literal forbidden strings must NOT appear in any
 *      .js / .jsx / .cjs file OUTSIDE the doctrine context file
 *      (_chat-tier-context.cjs is allowed to mention them in the
 *      "do-not-do" rules block):
 *        - GLOW-KPV-BOX10 (retired SKU)
 *        - "canonical four-peptide" (KLOW hero framing)
 *        - "GLP-FatMobilize" (old wonky stack)
 *        - "Visceral Recomp" (old wonky stack)
 *
 * Exit codes:
 *   0 = clean, build proceeds
 *   1 = drift detected, fix before shipping
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const failures = [];

function fail(check, detail) {
  failures.push(`  ❌ [${check}] ${detail}`);
}

function pass(check) {
  console.log(`  ✅ [${check}]`);
}

// ---------------------------------------------------------------------------
// CHECK 1: src/prompts/ booby-trap directory must not exist
// ---------------------------------------------------------------------------
const stalePromptsDir = path.join(PROJECT_ROOT, 'src/prompts');
if (fs.existsSync(stalePromptsDir)) {
  fail('CHECK 1', `src/prompts/ exists — known stale prompt directory. Delete it.`);
} else {
  pass('CHECK 1 · stale prompts dir absent');
}

// ---------------------------------------------------------------------------
// CHECK 2: TIER_MATRIX_SUMMARY defined in exactly ONE file
// ---------------------------------------------------------------------------
const grepOut = safeGrep(`-rln "TIER_MATRIX_SUMMARY *=" src netlify`, PROJECT_ROOT);
const definers = grepOut.split('\n').filter(Boolean);
const expectedDefiner = 'netlify/functions/_chat-tier-context.cjs';
if (definers.length === 1 && definers[0].endsWith(expectedDefiner)) {
  pass('CHECK 2 · TIER_MATRIX_SUMMARY defined only in shared module');
} else if (definers.length === 0) {
  fail('CHECK 2', `TIER_MATRIX_SUMMARY not defined anywhere — expected ${expectedDefiner}`);
} else {
  fail('CHECK 2', `TIER_MATRIX_SUMMARY defined in ${definers.length} files (expected 1): ${definers.join(', ')}`);
}

// ---------------------------------------------------------------------------
// CHECK 3: chat consumers import from _chat-tier-context.cjs
// ---------------------------------------------------------------------------
const consumers = [
  'netlify/functions/vitalis-chat-background.js',
  'netlify/functions/vitalis-system-prompt.js',
];
for (const consumer of consumers) {
  const fullPath = path.join(PROJECT_ROOT, consumer);
  if (!fs.existsSync(fullPath)) {
    fail('CHECK 3', `consumer missing: ${consumer}`);
    continue;
  }
  const src = fs.readFileSync(fullPath, 'utf8');
  if (!src.includes("require('./_chat-tier-context.cjs')") &&
      !src.includes('require("./_chat-tier-context.cjs")')) {
    fail('CHECK 3', `${consumer} does NOT import from _chat-tier-context.cjs — hardcoded tier content is forbidden`);
  } else {
    pass(`CHECK 3 · ${consumer.split('/').pop()} imports shared tier module`);
  }
}

// ---------------------------------------------------------------------------
// CHECK 4: retired SKUs must NOT be Active in any catalog file under project
// ---------------------------------------------------------------------------
const RETIRED_SKUS = ['GLOW-KPV-BOX10', 'OXY-2MG-BOX10'];
// Find ALL catalog-data.json under project (excluding node_modules/dist)
const catalogPaths = safeGrep(`-rl --include=catalog-data.json . --exclude-dir=node_modules --exclude-dir=dist`, PROJECT_ROOT)
  .split('\n').filter(Boolean);
for (const cp of catalogPaths) {
  let cat;
  try { cat = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, cp), 'utf8')); }
  catch { fail('CHECK 4', `cannot parse ${cp}`); continue; }
  const allEntries = ['vials','pens','other','sprays'].flatMap(s => cat[s] || []);
  for (const sku of RETIRED_SKUS) {
    const entry = allEntries.find(e => e?.sku === sku);
    if (entry && entry.status === 'Active') {
      fail('CHECK 4', `${sku} is Active in ${cp} — must be Inactive (retired)`);
    }
  }
}
if (catalogPaths.length > 0) pass(`CHECK 4 · retired SKUs inactive across ${catalogPaths.length} catalog file(s)`);

// ---------------------------------------------------------------------------
// CHECK 5: stacks.js has sync-discipline comment
// ---------------------------------------------------------------------------
const stacksPath = path.join(PROJECT_ROOT, 'src/data/stacks.js');
const stacksSrc = fs.readFileSync(stacksPath, 'utf8');
if (stacksSrc.includes('_chat-tier-context.cjs') &&
    stacksSrc.includes('CHAT-APP SYNC DISCIPLINE')) {
  pass('CHECK 5 · stacks.js carries sync-discipline reminder');
} else {
  fail('CHECK 5', `stacks.js missing sync-discipline comment referencing _chat-tier-context.cjs`);
}

// ---------------------------------------------------------------------------
// CHECK 6: forbidden drift strings in code files
// ---------------------------------------------------------------------------
const FORBIDDEN = [
  { pattern: 'GLOW-KPV-BOX10',         note: 'retired SKU' },
  { pattern: 'OXY-2MG',                note: 'retired SKU prefix (oxytocin removed from offering)' },
  { pattern: 'OXY-2MG-BOX10',          note: 'retired SKU full form' },
  { pattern: 'canonical four-peptide', note: 'KLOW hero framing' },
  { pattern: 'hero-tier',              note: 'KLOW hero framing' },
  { pattern: 'Tesa + CJC',             note: 'redundant GHRH-receptor pairing' },
  { pattern: 'Tesamorelin + CJC',      note: 'redundant GHRH-receptor pairing' },
  { pattern: 'GLP-FatMobilize',        note: 'old wonky stack' },
  { pattern: 'Visceral Recomp',        note: 'old wonky stack' },
];
const ALLOWED_DOCTRINE_FILES = [
  'netlify/functions/_chat-tier-context.cjs', // explicitly lists forbidden strings as DRIFT-PREVENTION RULES
  'scripts/check-drift.cjs',                  // this file (defines the rules)
];
for (const { pattern, note } of FORBIDDEN) {
  // grep across .js/.jsx/.cjs/.ts/.tsx in src and netlify
  const hits = safeGrep(`-rln --include="*.js" --include="*.jsx" --include="*.cjs" "${pattern}" src netlify`, PROJECT_ROOT)
    .split('\n').filter(Boolean)
    .filter(line => !ALLOWED_DOCTRINE_FILES.some(allowed => line.startsWith(allowed)));
  if (hits.length > 0) {
    fail('CHECK 6', `forbidden string "${pattern}" (${note}) found in: ${hits.join(', ')}`);
  } else {
    pass(`CHECK 6 · "${pattern}" absent (${note})`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
if (failures.length === 0) {
  console.log('🟢 DRIFT CHECK PASSED — tier matrix authority intact, no forbidden patterns.\n');
  process.exit(0);
} else {
  console.error('🔴 DRIFT CHECK FAILED:\n');
  failures.forEach(f => console.error(f));
  console.error('\nFix the above before building. The tier matrix in _chat-tier-context.cjs is the single source of truth.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helper — grep without throwing on no-match (exit 1 on no match is normal)
// ---------------------------------------------------------------------------
function safeGrep(args, cwd) {
  try {
    return execSync(`grep ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return ''; // no matches
  }
}
