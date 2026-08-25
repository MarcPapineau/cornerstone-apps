#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PREREQS, OS_FILES, auditSource, SOURCE_ROOT } = require('../install-engineering-os.cjs');

const CLI = path.join(SOURCE_ROOT, 'builder-control', 'install-engineering-os.cjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'engos-install-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}
function run(args) {
  return spawnSync('node', [CLI, ...args], { cwd: SOURCE_ROOT, encoding: 'utf8' });
}

console.log('Engineering OS — installer fixtures');

test('source package is complete', () => {
  const audit = auditSource();
  assert.deepStrictEqual(audit.prereqs.filter((x) => !x.present), []);
  assert.deepStrictEqual(audit.osFiles.filter((x) => !x.present), []);
});

test('doctor passes on the source package', () => {
  const r = run(['--doctor']);
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(r.stdout.includes('Source is complete'));
});

test('installer copies every required file to an empty target', () => {
  const target = path.join(TMP, 'target');
  fs.mkdirSync(target);
  const r = run(['--install', '--target', target]);
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  for (const item of [...PREREQS.map((x) => x.p), ...OS_FILES]) {
    assert.ok(fs.existsSync(path.join(target, item)), `missing ${item}`);
  }
});

test('installer refuses to install onto its source repo', () => {
  const r = run(['--install', '--target', SOURCE_ROOT]);
  assert.strictEqual(r.status, 3);
  assert.ok(r.stderr.includes('target is the source repo'));
});

// RED PROOF — the installer must REFUSE when prerequisites are absent.
// A partial install of a gate is indistinguishable from a working one right up
// until it matters, so "copy what exists and hope" is the one behaviour that
// must not be possible. This builds a genuinely incomplete source repo (the
// installer resolves SOURCE_ROOT from its own __dirname) and proves it refuses.
test('installer REFUSES from a source missing its Builder Control prerequisites', () => {
  const fakeSrc = fs.mkdtempSync(path.join(TMP, 'fake-src-'));
  const target = fs.mkdtempSync(path.join(TMP, 'fake-target-'));
  fs.mkdirSync(path.join(fakeSrc, 'builder-control'), { recursive: true });
  // Only the installer itself is present. Every prerequisite is missing.
  fs.copyFileSync(CLI, path.join(fakeSrc, 'builder-control', 'install-engineering-os.cjs'));

  const r = spawnSync('node',
    [path.join(fakeSrc, 'builder-control', 'install-engineering-os.cjs'), '--install', '--target', target],
    { encoding: 'utf8' });

  assert.strictEqual(r.status, 3, `expected refusal exit 3, got ${r.status}`);
  assert.ok(/REFUSED/.test(r.stderr), 'refusal must say REFUSED');
  assert.ok(/packet-tools\.cjs/.test(r.stderr), 'refusal must name the missing prerequisite');
  assert.ok(/Nothing was copied/.test(r.stderr), 'refusal must state that nothing was copied');

  // And it must have actually copied nothing.
  const leaked = fs.existsSync(path.join(target, 'builder-control'));
  assert.ok(!leaked, 'a refused install must leave the target untouched');
});

test('installer doctor REFUSES (exit 3) on an incomplete source', () => {
  const fakeSrc = fs.mkdtempSync(path.join(TMP, 'fake-doc-'));
  fs.mkdirSync(path.join(fakeSrc, 'builder-control'), { recursive: true });
  fs.copyFileSync(CLI, path.join(fakeSrc, 'builder-control', 'install-engineering-os.cjs'));
  const r = spawnSync('node',
    [path.join(fakeSrc, 'builder-control', 'install-engineering-os.cjs'), '--doctor'],
    { encoding: 'utf8' });
  assert.strictEqual(r.status, 3, `expected exit 3, got ${r.status}`);
  assert.ok(/MISSING/.test(r.stdout), 'doctor must list what is missing');
});

test('every declared prerequisite is a real runtime dependency that exists here', () => {
  for (const d of PREREQS) {
    assert.ok(fs.existsSync(path.join(SOURCE_ROOT, d.p)), `declared prerequisite absent: ${d.p}`);
    assert.ok(d.why && d.why.length > 0, `prerequisite ${d.p} has no stated reason`);
  }
  assert.ok(OS_FILES.length > 0);
});

const failedCount = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failedCount} failed.`);
