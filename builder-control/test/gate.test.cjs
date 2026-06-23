#!/usr/bin/env node
/**
 * gate.test.cjs — Builder Control System v1, B1 gate end-to-end loop test.
 *
 * Exercises the HARD-BLOCK gate against the LIVE registry, protected-paths, and
 * the Wave-1 modules (boundary-checks import, ledger-writer shell). Each case
 * asserts the EXACT exit code and (for blocks) the named RULE-ID in the output.
 *
 * Run: node builder-control/test/gate.test.cjs
 * Exit 0 = all cases passed; exit 1 = at least one failed.
 *
 * NOTE: every gate invocation appends a ledger entry (PASS or BLOCKED) by design.
 * This test therefore grows builder-control/ledger.json — that growth IS the
 * success-criterion #2 evidence, not a side effect to suppress.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const GATE = path.join(ROOT, 'builder-control', 'gate.cjs');
const LEDGER = path.join(ROOT, 'builder-control', 'ledger.json');

let pass = 0;
let fail = 0;

function runGate(args) {
  const r = spawnSync('node', [GATE, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { exit: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function expect(name, args, { exit, rule, mustNotContain }) {
  const r = runGate(args);
  const okExit = r.exit === exit;
  const okRule = rule ? new RegExp(`rule:\\s+${rule}\\b`).test(r.out) : true;
  const okNot = mustNotContain ? !r.out.includes(mustNotContain) : true;
  if (okExit && okRule && okNot) {
    pass++;
    console.log(`  ✅ ${name}  (exit ${r.exit}${rule ? `, rule ${rule}` : ''})`);
  } else {
    fail++;
    console.error(`  ❌ ${name}`);
    console.error(`     expected exit=${exit}${rule ? ` rule=${rule}` : ''}; got exit=${r.exit}`);
    console.error(`     output:\n${r.out.split('\n').map((l) => '       ' + l).join('\n')}`);
  }
}

console.log('Builder Control — gate end-to-end loop test\n');

const ledgerBefore = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')).length : 0;

// 1. PASS — registered agent, conforming in-scope control-system write.
expect('PASS: in-scope control-system write (gate.cjs)',
  ['--check', '--packet', 'builder-control/packets/B1-pass-demo.json', '--op', 'write', '--path', 'builder-control/gate.cjs'],
  { exit: 0 });

// 2. RECONCILIATION: control-system write ALLOWED while canon write BLOCKED.
expect('RECONCILIATION-allow: control-system write (gate.cjs) PASSES',
  ['--check', '--packet', 'builder-control/packets/B1.json', '--op', 'write', '--path', 'builder-control/gate.cjs'],
  { exit: 0 });
expect('RECONCILIATION-block: canon write (dosing.js) HARD-BLOCKED',
  ['--check', '--packet', 'builder-control/packets/B1.json', '--op', 'write', '--path', 'packages/protocol-core/data/dosing.js'],
  { exit: 3, rule: 'BC-PROTECTED-WRITE' });

// 3. BC-NO-PACKET — protected canon write with no packet at all.
expect('BC-NO-PACKET: protected canon write, no packet',
  ['--agent', 'claude-code', '--op', 'write', '--path', 'packages/protocol-core/data/dosing.js'],
  { exit: 3, rule: 'BC-NO-PACKET' });

// 4. BC-PUBLIC-PUSH — push to public repo with no allowsPublicPush.
expect('BC-PUBLIC-PUSH: push cornerstoneregroup-site/** without allowsPublicPush',
  ['--check', '--packet', 'builder-control/packets/B1.json', '--op', 'push', '--path', 'cornerstoneregroup-site/index.html'],
  { exit: 3, rule: 'BC-PUBLIC-PUSH' });

// 5. BC-PROTECTED-WRITE — write a protected canon entry without authorization (with packet but empty auth).
expect('BC-PROTECTED-WRITE: brain json write without authorization',
  ['--check', '--packet', 'builder-control/packets/B1-pass-demo.json', '--op', 'write', '--path', 'peptide-resource-app/research-intel/brain/research-brain.json'],
  { exit: 3, rule: 'BC-PROTECTED-WRITE' });

// 6. BC-GOV-AUTHORITY-LEAK — candidate text uses FDA approval as value-authority (NOT overridable).
expect('BC-GOV-AUTHORITY-LEAK: FDA-approved value claim in candidate text',
  ['--agent', 'claude-code', '--op', 'write', '--path', 'luke-app/public/x.html', '--text', 'This peptide is FDA-approved and recognized by ClinicalTrials.gov.'],
  { exit: 3, rule: 'BC-GOV-AUTHORITY-LEAK' });

// 7. SAFE: evidence-boundary language must NOT trigger gov-leak.
expect('SAFE: "mechanism studied in animals" passes gov-leak (in-scope path)',
  ['--agent', 'claude-code', '--op', 'write', '--path', 'luke-app/public/x.html', '--text', 'This is a mechanism studied in animals; not approved for human use.'],
  { exit: 0, mustNotContain: 'BC-GOV-AUTHORITY-LEAK' });

// 8. BC-FORBIDDEN-TASK — claude-code may not "release" (op not in allowedOps).
expect('BC-FORBIDDEN-TASK: claude-code attempts release (op not allowed)',
  ['--check', '--packet', 'builder-control/packets/B1.json', '--op', 'release', '--path', 'luke-app/public/x.html'],
  { exit: 3, rule: 'BC-FORBIDDEN-TASK' });

// 9. No-bypass: --force flag is refused.
expect('NO-BYPASS: --force flag refused',
  ['--force', '--agent', 'claude-code', '--op', 'write', '--path', 'packages/protocol-core/data/dosing.js'],
  { exit: 2, mustNotContain: 'PASS' });

const ledgerAfter = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')).length : 0;
console.log(`\nLedger entries: ${ledgerBefore} → ${ledgerAfter} (every gate decision appended one — success-criterion #2).`);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
