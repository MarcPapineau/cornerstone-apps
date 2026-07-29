#!/usr/bin/env node
/**
 * doctrine-check.cjs — Layer 1, generalized.
 *
 * Applies builder-control/doctrine-rules.json to ANY file, in ANY lane of this
 * workspace. Peptide protocols were simply the first domain that had its rules
 * written down; nothing here is peptide-specific. Real estate packages, apparel
 * tech packs, the 75 Hard app, Primerica material — each governs itself by
 * adding an entry to the registry, not by getting its own checker.
 *
 * Scope is per-rule, so a rule only ever fires on files it names. Adding a
 * Vitalis rule cannot break a listing package.
 *
 *   node builder-control/doctrine-check.cjs --staged        what's about to commit
 *   node builder-control/doctrine-check.cjs <file> [file…]  specific files
 *   node builder-control/doctrine-check.cjs --all           every tracked file
 *   node builder-control/doctrine-check.cjs --json
 *
 * Exit 0 = no blocking violation. Exit 1 = blocked. Exit 2 = cannot run.
 *
 * FAIL-CLOSED: a missing or unparseable registry exits 2. "The rules could not
 * be loaded" must never print the same way as "the rules all passed".
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'builder-control', 'doctrine-rules.json');
const args = process.argv.slice(2);
const asJson = args.includes('--json');

function die(msg, code = 2) {
  console.error(`doctrine-check: ${msg}`);
  process.exit(code);
}

// Glob -> RegExp. The two-character tokens have to be swapped out before the
// single-character ones, so they are parked on sentinels no file path contains.
function globToRe(glob) {
  const GS = 'GLOBSTAR_SLASH';
  const G = 'GLOBSTAR';
  const body = glob
    .replace(/\*\*\//g, GS)
    .replace(/\*\*/g, G)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .split(GS).join('(?:.*/)?')
    .split(G).join('.*');
  return new RegExp('^' + body + '$');
}

if (!fs.existsSync(REGISTRY)) {
  die(`registry MISSING at ${REGISTRY} — refusing to report a pass with no rules loaded.`);
}
let registry;
try {
  registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
} catch (e) {
  die(`registry is unparseable (${e.message}) — refusing to report a pass with no rules loaded.`);
}
if (!Array.isArray(registry.rules) || !registry.rules.length) {
  die('registry contains no rules — nothing would be checked, so nothing can pass.');
}

// Compiled up front, so a bad pattern is a startup error rather than a rule that
// silently never matches anything for months.
const rules = registry.rules.map((r) => {
  for (const f of ['id', 'scope', 'forbid', 'canon', 'rule']) {
    if (!r[f]) die(`rule "${r.id || '(unnamed)'}" is missing required field "${f}"`);
  }
  try {
    return {
      id: r.id,
      canon: r.canon,
      rule: r.rule,
      severity: r.severity === 'review' ? 'review' : 'block',
      re: new RegExp(r.forbid, 'gi'),
      exemptRe: r.exempt ? new RegExp(r.exempt, 'i') : null,
      scopeRes: [].concat(r.scope).map(globToRe),
      // excludeScope wins over scope. A "customer-facing" rule has to be able to
      // say that build evidence and internal audits are not customer-facing —
      // without it the rule fires on machine logs and the finding count becomes
      // noise nobody reads.
      excludeRes: [].concat(r.excludeScope || []).map(globToRe),
    };
  } catch (e) {
    return die(`rule "${r.id}" has an invalid pattern: ${e.message}`);
  }
});

const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  } catch {
    return '';
  }
};

// --all walks the WORKING TREE, not `git ls-files`.
//
// It used the git index first, and reported 0 violations across the whole
// client corpus — because all 231 protocol guides are untracked. "Nothing is
// tracked" and "nothing is wrong" printed identically. That is the same blind
// green this system exists to remove, so the file list can no longer come from
// a source that silently excludes the files most worth checking.
const IGNORE_DIRS = /(^|\/)(node_modules|\.git|_backups?|backups?|archive|dist|build|out|\.session-archive[^/]*|\.session-restore[^/]*)(\/|$)/;
function walkTree(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full);
    if (IGNORE_DIRS.test(rel)) continue;
    if (e.isDirectory()) walkTree(full, acc);
    else if (TEXTUAL_NAME.test(e.name)) acc.push(rel);
  }
  return acc;
}
const TEXTUAL_NAME = /\.(md|markdown|html?|txt|json|js|mjs|cjs|ts|tsx|jsx|css|yml|yaml|csv)$/i;

let files;
if (args.includes('--staged')) {
  files = sh('git diff --cached --name-only --diff-filter=ACMR').split('\n').filter(Boolean);
} else if (args.includes('--all')) {
  files = walkTree(ROOT, []);
} else {
  files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) die('no files given. Use --staged, --all, or pass paths.');
}

// Text only. A regex over a PDF or a PNG produces noise, not findings.
const TEXTUAL = /\.(md|markdown|html?|txt|json|js|mjs|cjs|ts|tsx|jsx|css|yml|yaml|csv)$/i;

function stripHtml(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const findings = [];
let scanned = 0;
let skipped = 0;

for (const file of files) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;

  const applicable = rules.filter((r) =>
    r.scopeRes.some((re) => re.test(file)) && !r.excludeRes.some((re) => re.test(file)));
  if (!applicable.length || !TEXTUAL.test(file)) {
    skipped++;
    continue;
  }

  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    // In scope but unreadable. That is not a pass.
    findings.push({
      file, id: 'unreadable', severity: 'block', canon: '(n/a)',
      rule: 'A file in scope that cannot be read cannot be cleared.',
      match: e.message, excerpt: '',
    });
    continue;
  }
  if (/\.html?$/i.test(file)) text = stripHtml(text);
  scanned++;

  for (const r of applicable) {
    r.re.lastIndex = 0;
    for (const hit of text.matchAll(r.re)) {
      const start = Math.max(0, hit.index - 45);
      const excerpt = text.slice(start, hit.index + hit[0].length + 45).trim().replace(/\s+/g, ' ');
      if (r.exemptRe && r.exemptRe.test(excerpt)) continue;
      findings.push({
        file, id: r.id, severity: r.severity, canon: r.canon,
        rule: r.rule, match: hit[0], excerpt,
      });
    }
  }
}

const blocking = findings.filter((f) => f.severity === 'block');
const review = findings.filter((f) => f.severity === 'review');

// --summary prints counts only. The full --json payload of a whole-corpus run is
// several megabytes of excerpts, which silently overruns the 1MB default buffer
// of anything calling this with execSync — and a truncated JSON payload parses
// as an error, which the watchdog would then report as "rules could not be
// evaluated". A caller that only needs counts should not have to risk that.
if (args.includes('--summary')) {
  const byRule = {};
  for (const f of findings) byRule[f.id] = (byRule[f.id] || 0) + 1;
  console.log(JSON.stringify({
    scanned, skipped,
    blocking: blocking.length,
    review: review.length,
    filesWithBlocking: new Set(blocking.map(f => f.file)).size,
    byRule,
  }));
  process.exit(blocking.length ? 1 : 0);
}

if (asJson) {
  console.log(JSON.stringify({ scanned, skipped, blocking: blocking.length, review: review.length, findings }, null, 2));
  process.exit(blocking.length ? 1 : 0);
}

if (!findings.length) {
  console.log(`doctrine-check: ${scanned} file(s) in scope, ${rules.length} rule(s) applied, no violations.`);
  process.exit(0);
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

console.log('DOCTRINE CHECK');
console.log('='.repeat(52));
for (const [file, hits] of byFile) {
  console.log(`\n${file}`);
  const byRule = new Map();
  for (const f of hits) {
    if (!byRule.has(f.id)) byRule.set(f.id, []);
    byRule.get(f.id).push(f);
  }
  for (const [id, group] of byRule) {
    const h = group[0];
    console.log(`  ${h.severity === 'block' ? 'BLOCK ' : 'REVIEW'} [${id}] ${group.length} occurrence(s)`);
    console.log(`    rule  : ${h.rule}`);
    console.log(`    canon : ${h.canon}`);
    for (const m of group.slice(0, 3)) console.log(`    found : "${m.match}"  in  ...${m.excerpt}...`);
    if (group.length > 3) console.log(`    ...and ${group.length - 3} more`);
  }
}

console.log('');
console.log(`Summary: scanned=${scanned} blocking=${blocking.length} review=${review.length}`);
if (blocking.length) {
  console.log('\nBLOCKED. Fix the content — or if the rule itself is wrong, change it in');
  console.log('builder-control/doctrine-rules.json. Never work around it in the file.');
  process.exit(1);
}
console.log('\nNo blocking violations (review items above are advisory).');
