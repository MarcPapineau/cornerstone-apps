#!/usr/bin/env node
'use strict';
/**
 * _filter-sensitive.cjs — hook helper (REUSE, not a new policy).
 *
 * Reads newline-delimited paths on stdin and prints ONLY those that are
 * sensitive for the given op, so the hooks invoke the full gate exclusively on
 * protected/public files (ordinary commits stay fast and do not append ledger
 * entries for every file).
 *
 *   --op write : prints paths that match a protected-paths.json category (write-scoped)
 *   --op push  : prints paths that are public-repo (boundary-checks.publicPush) OR
 *                match a push-scoped protected category
 *
 * Reuses gate.cjs matchProtected() + boundary-checks.publicPush() — it does NOT
 * define any new protected-path policy. protected-paths.json remains the SoT.
 *
 * Usage:  printf '%s\n' "$FILES" | node _filter-sensitive.cjs write
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const BC = path.resolve(HERE, '..');
const { matchProtected } = require(path.join(BC, 'gate.cjs'));
const boundary = require(path.join(BC, 'boundary-checks.cjs'));
const protectedDoc = JSON.parse(fs.readFileSync(path.join(BC, 'protected-paths.json'), 'utf8'));

const op = String(process.argv[2] || 'write').toLowerCase();

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch (_) { input = ''; }
const files = input.split('\n').map((s) => s.trim()).filter(Boolean);

for (const f of files) {
  const m = matchProtected(protectedDoc, f, op);
  const pub = op === 'push' ? boundary.publicPush(f).violated : false;
  if (m.matched || pub) console.log(f);
}
