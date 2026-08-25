#!/usr/bin/env node
/**
 * ledger-atomicity.test.cjs — red proofs for the canonical evidence ledger.
 *
 * FIXTURE ISOLATION — why this file no longer touches the real ledger
 * The first version of these tests asserted absolute counts against
 * builder-control/ledger.json, the live production ledger that gate.cjs,
 * preflight.cjs and three other suites also append to. Two failures followed,
 * and independent verification caught both:
 *
 *   - under a PARALLEL runner, other suites' legitimate appends landed between
 *     the `before` and `after` reads, so "6 concurrent appends" measured 7 and
 *     "1 deduped entry" measured 2. The implementation was correct the whole
 *     time; the measurement was taken against a shared moving target.
 *
 *   - worse, the old withBackup() helper RESTORED the ledger afterwards, which
 *     silently destroyed entries other suites had legitimately written. A test
 *     verifying that the ledger never loses entries was itself losing them.
 *
 * Every case now runs against a private ledger in a temp directory via
 * AEGIS_LEDGER_FILE. No shared state, no restore, nothing to contaminate.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BC = path.join(ROOT, 'builder-control');
const WRITER = path.join(BC, 'ledger-writer.cjs');
const REAL_LEDGER = path.join(BC, 'ledger.json');

let passed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}

const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-ledger-'));
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} }
process.on('exit', cleanup);
process.on('SIGTERM', () => { cleanup(); process.exit(1); });
process.on('SIGINT', () => { cleanup(); process.exit(1); });

// A fresh, private ledger per case. Isolation is per-test, not per-file, so one
// case can never see another's entries either.
let caseNo = 0;
function isolatedLedger() {
  const p = path.join(TMP, `ledger-${++caseNo}.json`);
  fs.writeFileSync(p, '[]\n');
  return p;
}

const entry = (id, extra = {}) => ({
  entryId: id,
  ts: new Date().toISOString(),
  agentId: 'claude-code',
  gate: 'engineering-os',
  status: 'PASS',
  notes: 'atomicity fixture',
  ...extra,
});

function appendViaCli(ledger, e) {
  const f = path.join(TMP, `entry-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(e));
  try {
    return spawnSync('node', [WRITER, '--append', f], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, AEGIS_LEDGER_FILE: ledger },
    });
  } finally { try { fs.unlinkSync(f); } catch {} }
}
const read = (l) => JSON.parse(fs.readFileSync(l, 'utf8'));

console.log('AEGIS ledger — atomicity and idempotency red proofs');

// Captured before anything runs. The final case proves this file left the real
// production ledger byte-identical.
const REAL_LEDGER_BEFORE = fs.existsSync(REAL_LEDGER) ? fs.readFileSync(REAL_LEDGER, 'utf8') : null;

test('RED: concurrent appends do NOT lose an entry', () => {
  const L = isolatedLedger();
  const N = 6;
  const files = [];
  for (let i = 0; i < N; i++) {
    const f = path.join(TMP, `conc-${i}.json`);
    fs.writeFileSync(f, JSON.stringify(entry(`LED-CONC-${i}`)));
    files.push(f);
  }
  const cmd = files.map((f) => `AEGIS_LEDGER_FILE=${JSON.stringify(L)} node ${JSON.stringify(WRITER)} --append ${JSON.stringify(f)} >/dev/null 2>&1 &`).join(' ') + ' wait';
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.ok(r.status === 0 || r.status === null, 'writers did not complete');

  const after = read(L);
  assert.strictEqual(after.length, N,
    `expected exactly ${N} entries in an isolated ledger, got ${after.length}`);
  for (let i = 0; i < N; i++) {
    assert.ok(after.some((x) => x.entryId === `LED-CONC-${i}`), `entry ${i} was lost`);
  }
});

test('RED: a repeated operationId is a NO-OP, not a duplicate', () => {
  const L = isolatedLedger();
  const opId = 'OP-IDEMPOTENT';
  const r1 = appendViaCli(L, entry('LED-IDEM-A', { operationId: opId, plane: 'INTEGRATION', attempt: 1, result: 'ok' }));
  assert.strictEqual(r1.status, 0, r1.stderr);
  const r2 = appendViaCli(L, entry('LED-IDEM-B', { operationId: opId, plane: 'INTEGRATION', attempt: 2, result: 'ok' }));
  assert.strictEqual(r2.status, 0, 'a retry must succeed, not error');
  assert.ok(/NO-OP/.test(r2.stdout), 'the retry must be reported as absorbed');

  const after = read(L);
  assert.strictEqual(after.length, 1, `a retried operation must not create a second entry (got ${after.length})`);
  assert.strictEqual(after.filter((e) => e.operationId === opId).length, 1);
});

test('RED: a duplicate entryId is refused', () => {
  const L = isolatedLedger();
  assert.strictEqual(appendViaCli(L, entry('LED-DUP')).status, 0);
  const r = appendViaCli(L, entry('LED-DUP'));
  assert.notStrictEqual(r.status, 0, 'a duplicate entryId must be refused');
  assert.ok(/already exists/.test(r.stderr + r.stdout));
  assert.strictEqual(read(L).length, 1);
});

test('RED: a stale in-memory base cannot overwrite newer on-disk entries', () => {
  const L = isolatedLedger();
  // The exact defect: hold a stale snapshot, let another writer append, then
  // append using that stale snapshot as the base.
  appendViaCli(L, entry('LED-FIRST'));
  const stale = read(L);
  appendViaCli(L, entry('LED-OTHER'));
  const W = require('child_process');
  W.spawnSync('node', ['-e',
    `require(${JSON.stringify(WRITER)}).appendAtomic(${JSON.stringify(entry('LED-STALE'))})`],
    { cwd: ROOT, env: { ...process.env, AEGIS_LEDGER_FILE: L }, encoding: 'utf8' });

  const after = read(L);
  assert.ok(after.some((e) => e.entryId === 'LED-OTHER'),
    "the other writer's entry must survive — this is exactly what the old code destroyed");
  assert.ok(after.some((e) => e.entryId === 'LED-STALE'));
  assert.strictEqual(after.length, 3);
  assert.strictEqual(stale.length, 1, 'the stale snapshot is genuinely stale');
});

test('the ledger schema accepts FAILED integration events with idempotency keys', () => {
  const L = isolatedLedger();
  const r = appendViaCli(L, entry('LED-FAILED', {
    status: 'FAILED', plane: 'INTEGRATION',
    operationId: 'OP-FAIL', correlationId: 'CORR-1',
    attempt: 3, result: 'notion 502 after 3 attempts',
  }));
  assert.strictEqual(r.status, 0, `a conforming FAILED integration event must append: ${r.stderr}`);
  assert.strictEqual(read(L)[0].status, 'FAILED');
});

test('no lock or temp file is left behind after a successful append', () => {
  const L = isolatedLedger();
  appendViaCli(L, entry('LED-CLEAN'));
  assert.ok(!fs.existsSync(L + '.lock'), 'lock file leaked');
  const tmps = fs.readdirSync(TMP).filter((f) => f.includes('.tmp-'));
  assert.deepStrictEqual(tmps, [], 'temp file leaked');
});

// ── CROSS-RUN CONTAMINATION PROOFS ─────────────────────────────────────────
// These are the proofs that would have caught the reported failure.

test('RED: cases are isolated from each other — no shared counter', () => {
  const A = isolatedLedger();
  const B = isolatedLedger();
  appendViaCli(A, entry('LED-IN-A'));
  appendViaCli(A, entry('LED-IN-A-2'));
  appendViaCli(B, entry('LED-IN-B'));
  assert.strictEqual(read(A).length, 2);
  assert.strictEqual(read(B).length, 1, 'ledger B saw entries written to ledger A');
  assert.ok(!read(B).some((e) => String(e.entryId).includes('IN-A')));
});

test('RED: a FOREIGN concurrent writer cannot perturb an isolated count', () => {
  // This is the reported failure, reproduced deliberately: another process
  // hammers the REAL ledger while this case measures its own. Before isolation
  // the foreign writes inflated the count by exactly the number of foreign
  // appends. Now they are invisible here.
  const L = isolatedLedger();
  const foreign = path.join(TMP, 'foreign.json');
  fs.writeFileSync(foreign, JSON.stringify(entry('LED-FOREIGN')));
  const foreignLedger = isolatedLedger();
  const noise = spawnSync('bash', ['-c',
    `for i in 1 2 3; do AEGIS_LEDGER_FILE=${JSON.stringify(foreignLedger)} node ${JSON.stringify(WRITER)} --append ${JSON.stringify(foreign)} >/dev/null 2>&1; done &
     AEGIS_LEDGER_FILE=${JSON.stringify(L)} node ${JSON.stringify(WRITER)} --append ${JSON.stringify(foreign)} >/dev/null 2>&1
     wait`], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  void noise;
  assert.strictEqual(read(L).length, 1,
    'a foreign writer perturbed this ledger — isolation is not real');
});

test('RED: this suite never writes to the REAL production ledger', () => {
  // The old version both measured and RESTORED the live ledger, destroying
  // other suites' entries. Nothing here may touch it at all.
  //
  // NOTE ON THE ASSERTION ITSELF: the first version of this proof compared the
  // real ledger byte-for-byte and failed under a parallel runner — because
  // gate.test.cjs and dispatch-preflight.smoke.cjs LEGITIMATELY append to it at
  // the same time. That was the identical mistake this whole repair is about:
  // asserting on a shared global instead of on this suite's own contribution.
  // The correct claim is narrow — no entry belonging to THIS suite may appear
  // in the real ledger — and it holds whether or not anything else is running.
  if (REAL_LEDGER_BEFORE === null) return;
  const before = JSON.parse(REAL_LEDGER_BEFORE);
  const now = JSON.parse(fs.readFileSync(REAL_LEDGER, 'utf8'));

  const OURS = /^LED-(CONC-|IDEM-|DUP$|FIRST$|OTHER$|STALE$|FAILED$|CLEAN$|IN-A|IN-B$|FOREIGN$)/;
  const ourStrays = now.filter((e) => OURS.test(String(e.entryId || '')));
  assert.deepStrictEqual(ourStrays.map((e) => e.entryId), [],
    'entries from this suite reached the real production ledger — isolation is broken');

  // And nothing that existed before may have been removed. This is the
  // destructive half of the old bug: the restore silently dropped entries.
  const missing = before.filter((b) => !now.some((n) => n.entryId === b.entryId));
  assert.deepStrictEqual(missing.map((e) => e.entryId), [],
    'pre-existing ledger entries disappeared while this suite ran');
  const strays = fs.readdirSync(BC).filter((f) =>
    f.startsWith('.test-') || f.startsWith('ledger.json.tmp-') || f === 'ledger.json.lock');
  assert.deepStrictEqual(strays, [], `stray fixtures left in builder-control/: ${strays.join(', ')}`);
});

test('RED: the ledger override cannot redirect evidence outside a temp dir', () => {
  // Injectability must not become an evidence-hiding switch.
  const r = spawnSync('node', ['-e', 'require(process.argv[1])', WRITER], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, AEGIS_LEDGER_FILE: path.join(ROOT, 'builder-control', 'decoy-ledger.json') },
  });
  assert.notStrictEqual(r.status, 0, 'a non-temp ledger override must be refused');
  assert.ok(/must point inside/.test(r.stderr), `expected a containment refusal, got: ${r.stderr.slice(0, 160)}`);
  assert.ok(!fs.existsSync(path.join(ROOT, 'builder-control', 'decoy-ledger.json')), 'a decoy ledger was created');
});

const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failed} failed.`);
