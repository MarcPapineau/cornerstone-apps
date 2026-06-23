#!/usr/bin/env node
/**
 * smoke-test.cjs — builder-control hooks smoke test.
 *
 * Verifies (without touching real git staging — uses BC_HOOK_FILES):
 *   1. all three shell scripts pass `bash -n` (syntax).
 *   2. install.sh is a dry run by default (does NOT install).
 *   3. pre-commit BLOCKS a staged protected path (exit != 0).
 *   4. pre-commit ALLOWS an ordinary path (exit 0).
 *   5. pre-push BLOCKS a public-repo path (exit != 0).
 *   6. pre-push ALLOWS an ordinary path (exit 0).
 *
 * Run: node builder-control/hooks/smoke-test.cjs
 * Exit 0 = all passed; exit 1 = at least one failed.
 *
 * NOTE: the block cases invoke the real gate, which appends a ledger entry by
 * design (every gate decision is ledgered). That growth is expected evidence.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HOOKS = __dirname;
const ROOT = path.resolve(HOOKS, '..', '..');
const LEDGER = path.join(ROOT, 'builder-control', 'ledger.json');

let pass = 0;
let fail = 0;

function run(cmd, args, extraEnv) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, extraEnv || {}),
  });
}

function expectExit(name, r, predicate, detail) {
  const ok = predicate(r.exit ?? r.status);
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}  (exit ${r.status})`);
  } else {
    fail++;
    console.error(`  ❌ ${name} — ${detail}`);
    console.error(`     got exit=${r.status}`);
    console.error((r.stdout || '') + (r.stderr || ''));
  }
}

console.log('builder-control hooks — smoke test\n');

const ledgerBefore = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')).length : 0;

// 1. syntax
for (const f of ['pre-commit.sh', 'pre-push.sh', 'install.sh']) {
  const r = run('bash', ['-n', path.join(HOOKS, f)]);
  expectExit(`bash -n ${f}`, r, (e) => e === 0, 'syntax error in hook');
}

// 2. install.sh dry run does not install
const dry = run('bash', [path.join(HOOKS, 'install.sh')]);
const dryOk = dry.status === 0 && /DRY RUN/.test((dry.stdout || '') + (dry.stderr || ''));
if (dryOk) { pass++; console.log('  ✅ install.sh dry-run (no --yes) does not install (exit 0, "DRY RUN" shown)'); }
else { fail++; console.error('  ❌ install.sh dry-run did not behave as a dry run'); console.error((dry.stdout || '') + (dry.stderr || '')); }

// 3. pre-commit BLOCKS a protected canon path (no packet → BC-NO-PACKET)
const c1 = run('bash', [path.join(HOOKS, 'pre-commit.sh')], { BC_HOOK_FILES: 'packages/protocol-core/data/dosing.js' });
expectExit('pre-commit BLOCKS protected canon write', c1, (e) => e !== 0, 'should have aborted the commit');

// 4. pre-commit ALLOWS an ordinary in-scope path
const c2 = run('bash', [path.join(HOOKS, 'pre-commit.sh')], { BC_HOOK_FILES: 'luke-app/server/__bc_hook_smoke__.js' });
expectExit('pre-commit ALLOWS ordinary path', c2, (e) => e === 0, 'should have allowed the commit');

// 5. pre-push BLOCKS a public-repo path (no packet → BC-PUBLIC-PUSH)
const p1 = run('bash', [path.join(HOOKS, 'pre-push.sh')], { BC_HOOK_FILES: 'cornerstoneregroup-site/index.html' });
expectExit('pre-push BLOCKS public-repo path', p1, (e) => e !== 0, 'should have aborted the push');

// 6. pre-push ALLOWS an ordinary path
const p2 = run('bash', [path.join(HOOKS, 'pre-push.sh')], { BC_HOOK_FILES: 'luke-app/server/__bc_hook_smoke__.js' });
expectExit('pre-push ALLOWS ordinary path', p2, (e) => e === 0, 'should have allowed the push');

const ledgerAfter = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')).length : 0;
console.log(`\nLedger entries: ${ledgerBefore} → ${ledgerAfter} (block cases append one each — expected).`);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
