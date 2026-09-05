#!/usr/bin/env node
/**
 * packet-planner.test.cjs — focused tests for the read-only packet planner.
 *
 * What is actually proven here: the plan is a pure function of the packet
 * BYTES (not of argument order), the canonical validator is the only thing
 * ever executed, nothing on disk changes, and every unplannable set is refused
 * with the exit code the CLI contract promises.
 *
 *   node builder-control/test/packet-planner.test.cjs
 */
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spawnSync } = childProcess;

const ROOT = path.resolve(__dirname, '..', '..');
const PLANNER = path.join(ROOT, 'builder-control', 'packet-planner.cjs');
const PACKET_TOOLS = path.join(ROOT, 'builder-control', 'packet-tools.cjs');
const REAL_PLANNER_PACKET = path.join(ROOT, 'builder-control', 'packets', 'PKT-20260905-PACKET-PLANNER.json');
const REAL_DOC_PACKET = path.join(ROOT, 'builder-control', 'packets', 'PKT-20260905-PACKET-COORDINATION-DOC.json');

const planner = require('../packet-planner.cjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL ${name}: ${error.stack || error.message}`); }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-packet-planner-'));

// Every fixture is a genuinely valid packet: agentId is a real registry key and
// filesAllowed stays inside that agent's globs, so the canonical validator —
// not a stub — is what accepts them. Write targets are files that do not exist
// (the normal case for a packet that creates its file) and never directories.
function basePacket(packetId, dependsOnPacketIds, writeSet, overrides = {}) {
  return {
    packetId,
    agentId: 'claude-code',
    objective: `Planner fixture ${packetId}.`,
    constraints: ['Fixture packet used for read-only planning analysis'],
    sourceOfTruth: ['builder-control/CONTROL-CONTRACT.md'],
    filesAllowed: ['builder-control/**'],
    testsRequired: ['node builder-control/test/packet-planner.test.cjs'],
    coordination: { executionMode: 'SERIAL_ONLY', dependsOnPacketIds, writeSet },
    stopConditions: ['Fixture packet; never executed'],
    authorization: {
      authorizedBy: 'Marc',
      allowsProtectedPaths: [],
      allowsPublicPush: false,
      allowsRelease: false,
    },
    ...overrides,
  };
}

function writeFixture(name, packet, indent = 2) {
  const file = path.join(tmp, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(packet, null, indent));
  return file;
}

function fixture(name, packetId, dependsOnPacketIds, writeSet, overrides) {
  return writeFixture(name, basePacket(packetId, dependsOnPacketIds, writeSet, overrides));
}

const target = (leaf) => `builder-control/planner-fixture/${leaf}.cjs`;

function runCli(args, { raw = false } = {}) {
  return spawnSync(process.execPath, [PLANNER, ...args], {
    cwd: ROOT, encoding: raw ? null : 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
}

function planJson(paths) {
  const args = ['--plan'];
  for (const value of paths) args.push('--packet', value);
  args.push('--json');
  const result = runCli(args);
  assert.ok(result.stdout, result.stderr);
  return { exit: result.status, plan: JSON.parse(result.stdout), stderr: result.stderr };
}

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const codes = (plan) => plan.refusals.map((refusal) => refusal.code).sort();
const waveIds = (plan) => plan.waves.map((wave) => wave.packetIds);

try {
  // ─── The real packets on disk ──────────────────────────────────────────────
  test('plans the two real coordination packets into dependency order', () => {
    const { exit, plan } = planJson([REAL_DOC_PACKET, REAL_PLANNER_PACKET]);
    assert.strictEqual(exit, 0, JSON.stringify(plan.refusals));
    assert.strictEqual(plan.schemaVersion, 1);
    assert.strictEqual(plan.status, 'PLANNED');
    assert.strictEqual(plan.executionMode, 'SERIAL_ONLY');
    assert.deepStrictEqual(waveIds(plan), [
      ['PKT-20260905-PACKET-COORDINATION-DOC'],
      ['PKT-20260905-PACKET-PLANNER'],
    ]);
    assert.deepStrictEqual(plan.serialOrder, [
      'PKT-20260905-PACKET-COORDINATION-DOC',
      'PKT-20260905-PACKET-PLANNER',
    ]);
    assert.deepStrictEqual(plan.conflicts, []);
    assert.deepStrictEqual(plan.refusals, []);
  });

  // ─── Waves ─────────────────────────────────────────────────────────────────
  test('independent packets with disjoint write sets share one wave', () => {
    const alpha = fixture('disjoint-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const bravo = fixture('disjoint-bravo', 'PKT-PLANNER-BRAVO', [], [target('bravo')]);
    const { exit, plan } = planJson([alpha, bravo]);
    assert.strictEqual(exit, 0, JSON.stringify(plan.refusals));
    assert.strictEqual(plan.status, 'PLANNED');
    assert.deepStrictEqual(waveIds(plan), [['PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO']]);
    assert.deepStrictEqual(plan.serialOrder, ['PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO']);
    assert.deepStrictEqual(plan.conflicts, []);
    // A shared wave is an observation about collision, never a launch order.
    assert.strictEqual(plan.executionMode, 'SERIAL_ONLY');
  });

  test('argument order cannot change a single output byte', () => {
    const alpha = fixture('order-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const bravo = fixture('order-bravo', 'PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'], [target('bravo')]);
    const charlie = fixture('order-charlie', 'PKT-PLANNER-CHARLIE', [], [target('bravo')]);

    const forward = runCli(['--plan', '--packet', alpha, '--packet', bravo, '--packet', charlie, '--json'], { raw: true });
    const reversed = runCli(['--plan', '--packet', charlie, '--packet', bravo, '--packet', alpha, '--json'], { raw: true });
    assert.strictEqual(forward.status, 0, String(forward.stderr));
    assert.strictEqual(reversed.status, 0, String(reversed.stderr));
    assert.ok(forward.stdout.equals(reversed.stdout), 'JSON output differed when the packets were passed in another order');

    // Same guarantee for the human-readable rendering.
    const forwardText = runCli(['--plan', '--packet', alpha, '--packet', charlie, '--packet', bravo], { raw: true });
    const reversedText = runCli(['--plan', '--packet', bravo, '--packet', charlie, '--packet', alpha], { raw: true });
    assert.ok(forwardText.stdout.equals(reversedText.stdout), 'text output differed when the packets were passed in another order');
    assert.match(String(forwardText.stdout), /analysis only/);
  });

  test('overlapping write sets serialize into later waves and record the conflict', () => {
    const alpha = fixture('overlap-alpha', 'PKT-PLANNER-ALPHA', [], [target('shared'), target('alpha')]);
    const bravo = fixture('overlap-bravo', 'PKT-PLANNER-BRAVO', [], [target('shared'), target('bravo')]);
    const { exit, plan } = planJson([bravo, alpha]);
    assert.strictEqual(exit, 0, JSON.stringify(plan.refusals));
    assert.strictEqual(plan.status, 'PLANNED');
    // Deferred, never dropped: the overlapping packet lands in the next wave.
    assert.deepStrictEqual(waveIds(plan), [['PKT-PLANNER-ALPHA'], ['PKT-PLANNER-BRAVO']]);
    assert.deepStrictEqual(plan.serialOrder, ['PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO']);
    assert.deepStrictEqual(plan.conflicts, [{
      type: 'WRITE_SET_OVERLAP',
      packetIds: ['PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO'],
      paths: [target('shared')],
      resolution: 'SERIALIZED_BY_PLANNER',
    }]);
  });

  test('an overlap between packets separated by a dependency is still reported', () => {
    // BRAVO depends on ALPHA, so they can never share a wave — and a wave-local
    // conflict check would therefore never compare them and would report this
    // real collision on target('shared') as no conflict at all.
    const alpha = fixture('dep-overlap-alpha', 'PKT-PLANNER-ALPHA', [], [target('shared')]);
    const bravo = fixture('dep-overlap-bravo', 'PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'],
      [target('shared'), target('bravo')]);
    const { exit, plan } = planJson([bravo, alpha]);
    assert.strictEqual(exit, 0, JSON.stringify(plan.refusals));
    assert.strictEqual(plan.status, 'PLANNED');
    assert.deepStrictEqual(waveIds(plan), [['PKT-PLANNER-ALPHA'], ['PKT-PLANNER-BRAVO']]);
    assert.deepStrictEqual(plan.conflicts, [{
      type: 'WRITE_SET_OVERLAP',
      packetIds: ['PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO'],
      paths: [target('shared')],
      resolution: 'SERIALIZED_BY_PLANNER',
    }]);
  });

  test('conflicts list sorted packet ids and sorted paths, one record per pair', () => {
    const first = fixture('conflict-first', 'PKT-PLANNER-CHARLIE', [], [target('zulu'), target('yankee')]);
    const second = fixture('conflict-second', 'PKT-PLANNER-ALPHA', [], [target('yankee'), target('zulu')]);
    const third = fixture('conflict-third', 'PKT-PLANNER-BRAVO', [], [target('zulu')]);
    const { exit, plan } = planJson([first, second, third]);
    assert.strictEqual(exit, 0, JSON.stringify(plan.refusals));
    assert.deepStrictEqual(waveIds(plan), [['PKT-PLANNER-ALPHA'], ['PKT-PLANNER-BRAVO'], ['PKT-PLANNER-CHARLIE']]);
    assert.deepStrictEqual(plan.conflicts, [
      {
        type: 'WRITE_SET_OVERLAP',
        packetIds: ['PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO'],
        paths: [target('zulu')],
        resolution: 'SERIALIZED_BY_PLANNER',
      },
      {
        type: 'WRITE_SET_OVERLAP',
        packetIds: ['PKT-PLANNER-ALPHA', 'PKT-PLANNER-CHARLIE'],
        paths: [target('yankee'), target('zulu')],
        resolution: 'SERIALIZED_BY_PLANNER',
      },
      {
        type: 'WRITE_SET_OVERLAP',
        packetIds: ['PKT-PLANNER-BRAVO', 'PKT-PLANNER-CHARLIE'],
        paths: [target('zulu')],
        resolution: 'SERIALIZED_BY_PLANNER',
      },
    ]);
    // Stable under reordering, conflicts included.
    const reordered = planJson([third, first, second]);
    assert.deepStrictEqual(reordered.plan, plan);
  });

  test('direct and transitive dependencies both order correctly', () => {
    const alpha = fixture('dep-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const bravo = fixture('dep-bravo', 'PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'], [target('bravo')]);
    const charlie = fixture('dep-charlie', 'PKT-PLANNER-CHARLIE', ['PKT-PLANNER-BRAVO'], [target('charlie')]);
    const delta = fixture('dep-delta', 'PKT-PLANNER-DELTA', ['PKT-PLANNER-ALPHA'], [target('delta')]);
    const { exit, plan } = planJson([charlie, delta, alpha, bravo]);
    assert.strictEqual(exit, 0, JSON.stringify(plan.refusals));
    // CHARLIE waits for BRAVO which waits for ALPHA: a transitive dependency is
    // never flattened into the wave that satisfied only its direct one.
    assert.deepStrictEqual(waveIds(plan), [
      ['PKT-PLANNER-ALPHA'],
      ['PKT-PLANNER-BRAVO', 'PKT-PLANNER-DELTA'],
      ['PKT-PLANNER-CHARLIE'],
    ]);
    assert.deepStrictEqual(plan.serialOrder, [
      'PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO', 'PKT-PLANNER-DELTA', 'PKT-PLANNER-CHARLIE',
    ]);
    assert.deepStrictEqual(plan.packets.map((entry) => entry.packetId), [
      'PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO', 'PKT-PLANNER-CHARLIE', 'PKT-PLANNER-DELTA',
    ]);
  });

  // ─── Refusals ──────────────────────────────────────────────────────────────
  test('a dependency outside the supplied set is refused', () => {
    const alpha = fixture('missing-dep-alpha', 'PKT-PLANNER-ALPHA', ['PKT-PLANNER-ABSENT'], [target('alpha')]);
    const { exit, plan } = planJson([alpha]);
    assert.strictEqual(exit, 1);
    assert.strictEqual(plan.status, 'REFUSED');
    assert.deepStrictEqual(codes(plan), ['MISSING_DEPENDENCY']);
    assert.match(plan.refusals[0].message, /PKT-PLANNER-ABSENT, which is not in the supplied set/);
    assert.deepStrictEqual(plan.waves, []);
    assert.deepStrictEqual(plan.serialOrder, []);
  });

  test('a dependency cycle is refused and still hashes the set it took in', () => {
    const alpha = fixture('cycle-alpha', 'PKT-PLANNER-ALPHA', ['PKT-PLANNER-CHARLIE'], [target('alpha')]);
    const bravo = fixture('cycle-bravo', 'PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'], [target('bravo')]);
    const charlie = fixture('cycle-charlie', 'PKT-PLANNER-CHARLIE', ['PKT-PLANNER-BRAVO'], [target('charlie')]);
    const { exit, plan } = planJson([alpha, bravo, charlie]);
    assert.strictEqual(exit, 1);
    assert.strictEqual(plan.status, 'REFUSED');
    assert.deepStrictEqual(codes(plan), ['DEPENDENCY_CYCLE']);
    assert.match(plan.refusals[0].message,
      /PKT-PLANNER-ALPHA, PKT-PLANNER-BRAVO, PKT-PLANNER-CHARLIE/);
    assert.deepStrictEqual(plan.waves, []);
    // Every packet was read, validated and coordinated — only the ORDER failed.
    assert.match(plan.packetSetHash, /^[0-9a-f]{64}$/);
  });

  test('only the packets actually in the cycle are named as its members', () => {
    // ALPHA <-> BRAVO is the cycle. CHARLIE merely depends on BRAVO: it is
    // blocked by the cycle, not part of it, and naming it would send someone to
    // edit a packet that has nothing wrong with it.
    const alpha = fixture('members-alpha', 'PKT-PLANNER-ALPHA', ['PKT-PLANNER-BRAVO'], [target('alpha')]);
    const bravo = fixture('members-bravo', 'PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'], [target('bravo')]);
    const charlie = fixture('members-charlie', 'PKT-PLANNER-CHARLIE', ['PKT-PLANNER-BRAVO'], [target('charlie')]);
    const { exit, plan } = planJson([charlie, bravo, alpha]);
    assert.strictEqual(exit, 1);
    assert.deepStrictEqual(codes(plan), ['DEPENDENCY_CYCLE']);
    assert.strictEqual(plan.refusals[0].message,
      'dependency cycle among PKT-PLANNER-ALPHA, PKT-PLANNER-BRAVO');
    assert.doesNotMatch(plan.refusals[0].message, /CHARLIE/);
    // The cycle is carried as a conflict with no resolution and no paths: the
    // planner refused it, it did not serialize it.
    assert.deepStrictEqual(plan.conflicts, [{
      type: 'DEPENDENCY_CYCLE',
      packetIds: ['PKT-PLANNER-ALPHA', 'PKT-PLANNER-BRAVO'],
    }]);
    assert.deepStrictEqual(plan.waves, []);
    assert.deepStrictEqual(plan.serialOrder, []);

    // The same conflict rendered as text: no resolution arrow, no undefined.
    const text = runCli(['--plan', '--packet', alpha, '--packet', bravo, '--packet', charlie]);
    assert.strictEqual(text.status, 1);
    assert.match(text.stdout, /DEPENDENCY_CYCLE PKT-PLANNER-ALPHA \+ PKT-PLANNER-BRAVO$/m);
    assert.doesNotMatch(text.stdout, /undefined/);
  });

  test('the same packet path supplied twice is refused', () => {
    const alpha = fixture('dup-path-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const { exit, plan } = planJson([alpha, alpha]);
    assert.strictEqual(exit, 1);
    assert.deepStrictEqual(codes(plan), ['DUPLICATE_PACKET_PATH']);
    assert.deepStrictEqual(plan.waves, []);
  });

  test('two files claiming one packet id are refused', () => {
    const first = fixture('dup-id-first', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const second = fixture('dup-id-second', 'PKT-PLANNER-ALPHA', [], [target('bravo')]);
    const { exit, plan } = planJson([first, second]);
    assert.strictEqual(exit, 1);
    assert.deepStrictEqual(codes(plan), ['DUPLICATE_PACKET_ID']);
    assert.match(plan.refusals[0].message, /declared by more than one supplied packet/);
  });

  test('an invalid packet is refused with the canonical validator as the authority', () => {
    // writeSet outside filesAllowed: a rule that lives in packet-tools.cjs and
    // is deliberately not reimplemented in the planner.
    const invalid = writeFixture('invalid', basePacket('PKT-PLANNER-ALPHA', [], [target('alpha')], {
      filesAllowed: ['builder-control/planner-fixture/bravo.cjs'],
    }));
    const good = fixture('invalid-partner', 'PKT-PLANNER-BRAVO', [], [target('bravo')]);
    const { exit, plan } = planJson([invalid, good]);
    assert.strictEqual(exit, 1);
    assert.deepStrictEqual(codes(plan), ['INVALID_PACKET']);
    assert.match(plan.refusals[0].message, /canonical validator rejected/);
    assert.match(plan.refusals[0].message, /outside filesAllowed/);
    // A set the planner could not fully take in is not given a set hash.
    assert.strictEqual(plan.packetSetHash, null);
    assert.deepStrictEqual(plan.waves, []);
  });

  test('a packet without coordination is refused', () => {
    const packet = basePacket('PKT-PLANNER-ALPHA', [], [target('alpha')]);
    delete packet.coordination;
    const uncoordinated = writeFixture('no-coordination', packet);
    // The canonical validator still accepts it — coordination is optional there.
    const validation = spawnSync(process.execPath, [PACKET_TOOLS, '--validate', uncoordinated],
      { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(validation.status, 0, validation.stderr);

    const { exit, plan } = planJson([uncoordinated]);
    assert.strictEqual(exit, 1);
    assert.deepStrictEqual(codes(plan), ['MISSING_COORDINATION']);
    assert.match(plan.refusals[0].message, /declares no coordination/);
  });

  test('a self-dependency is refused by canon, and again by the planner', () => {
    const selfDep = fixture('self-dep', 'PKT-PLANNER-ALPHA', ['PKT-PLANNER-ALPHA'], [target('alpha')]);
    const { exit, plan } = planJson([selfDep]);
    assert.strictEqual(exit, 1);
    assert.strictEqual(plan.status, 'REFUSED');
    assert.match(plan.refusals[0].message, /must not depend on its own packet/);

    // Defense in depth: with the validator stubbed to accept everything, the
    // planner's own graph check still refuses to order a packet against itself.
    const originalSpawnSync = childProcess.spawnSync;
    childProcess.spawnSync = () => ({ status: 0, signal: null, stdout: '', stderr: '' });
    let stubbed;
    try { stubbed = planner.planPacketFiles([selfDep]); }
    finally { childProcess.spawnSync = originalSpawnSync; }
    assert.strictEqual(stubbed.exitCode, 1);
    assert.deepStrictEqual(codes(stubbed), ['SELF_DEPENDENCY']);
  });

  // ─── Hashes ────────────────────────────────────────────────────────────────
  test('packet hashes are the exact file bytes and the set hash is their canonical join', () => {
    const alpha = fixture('hash-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const bravo = fixture('hash-bravo', 'PKT-PLANNER-BRAVO', [], [target('bravo')]);
    const { exit, plan } = planJson([bravo, alpha]);
    assert.strictEqual(exit, 0, JSON.stringify(plan.refusals));

    const alphaSha = sha256File(alpha);
    const bravoSha = sha256File(bravo);
    assert.deepStrictEqual(plan.packets.map((entry) => [entry.packetId, entry.sha256]), [
      ['PKT-PLANNER-ALPHA', alphaSha],
      ['PKT-PLANNER-BRAVO', bravoSha],
    ]);
    const expected = crypto.createHash('sha256')
      .update(`PKT-PLANNER-ALPHA ${alphaSha}\nPKT-PLANNER-BRAVO ${bravoSha}\n`)
      .digest('hex');
    assert.strictEqual(plan.packetSetHash, expected);
  });

  test('any byte change to a packet changes its hash and the set hash', () => {
    const alpha = fixture('change-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const bravo = fixture('change-bravo', 'PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'], [target('bravo')]);
    const before = planJson([alpha, bravo]).plan;

    // Reformatted only: same parsed value, different bytes. The plan is the
    // same, but the hashes must not claim it is the same FILE.
    writeFixture('change-bravo', basePacket('PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'], [target('bravo')]), 4);
    const reformatted = planJson([alpha, bravo]).plan;
    assert.deepStrictEqual(waveIds(reformatted), waveIds(before));
    assert.strictEqual(reformatted.packets[0].sha256, before.packets[0].sha256, 'untouched packet hash moved');
    assert.notStrictEqual(reformatted.packets[1].sha256, before.packets[1].sha256);
    assert.notStrictEqual(reformatted.packetSetHash, before.packetSetHash);

    // Restore the original bytes and the original hashes come back.
    writeFixture('change-bravo', basePacket('PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'], [target('bravo')]));
    assert.deepStrictEqual(planJson([bravo, alpha]).plan, before);
  });

  // ─── Read-only behaviour ───────────────────────────────────────────────────
  test('the canonical validator is the only subprocess the planner ever starts', () => {
    const alpha = fixture('subprocess-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const bravo = fixture('subprocess-bravo', 'PKT-PLANNER-BRAVO', ['PKT-PLANNER-ALPHA'], [target('bravo')]);

    const calls = [];
    const originalSpawnSync = childProcess.spawnSync;
    const forbidden = ['spawn', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
    const originals = {};
    childProcess.spawnSync = (command, args, options) => {
      calls.push({ command, args });
      return originalSpawnSync(command, args, options);
    };
    for (const name of forbidden) {
      originals[name] = childProcess[name];
      childProcess[name] = (...args) => { throw new Error(`planner called child_process.${name}(${String(args[0])})`); };
    }

    let plan;
    try { plan = planner.planPacketFiles([alpha, bravo]); }
    finally {
      childProcess.spawnSync = originalSpawnSync;
      for (const name of forbidden) childProcess[name] = originals[name];
    }

    assert.strictEqual(plan.exitCode, 0, JSON.stringify(plan.refusals));
    assert.strictEqual(calls.length, 2, `expected one validator run per packet, saw ${calls.length}`);
    for (const call of calls) {
      assert.strictEqual(call.command, process.execPath);
      assert.deepStrictEqual(call.args.slice(0, 2), [PACKET_TOOLS, '--validate']);
      assert.strictEqual(call.args.length, 3);
      assert.ok(path.isAbsolute(call.args[2]), `validator was handed a relative path: ${call.args[2]}`);
    }
    // No git, no aegis-run, no worker, no reviewer, no model — nothing else ran.
    const otherBinaries = calls.filter((call) => call.args[0] !== PACKET_TOOLS);
    assert.deepStrictEqual(otherBinaries, []);
  });

  test('planner source contains no literal NUL bytes', () => {
    assert.strictEqual(fs.readFileSync(PLANNER).includes(0), false);
  });

  test('planning writes nothing to the filesystem', () => {
    const alpha = fixture('readonly-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const bravo = fixture('readonly-bravo', 'PKT-PLANNER-BRAVO', [], [target('alpha')]);

    const mutators = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync',
      'unlinkSync', 'renameSync', 'copyFileSync', 'truncateSync', 'createWriteStream',
      'writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename', 'copyFile'];
    const originals = {};
    for (const name of mutators) {
      originals[name] = fs[name];
      fs[name] = (...args) => { throw new Error(`planner called fs.${name}(${String(args[0])})`); };
    }

    let plan;
    try { plan = planner.planPacketFiles([alpha, bravo]); }
    finally { for (const name of mutators) fs[name] = originals[name]; }

    assert.strictEqual(plan.exitCode, 0, JSON.stringify(plan.refusals));
    assert.strictEqual(plan.conflicts.length, 1);
  });

  test('a planning run leaves the repository byte-for-byte unchanged', () => {
    const status = () => spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout;
    const stat = (file) => { const entry = fs.statSync(file); return `${entry.size}:${entry.mtimeMs}`; };
    const watched = [PACKET_TOOLS, REAL_PLANNER_PACKET, REAL_DOC_PACKET,
      path.join(ROOT, 'builder-control', 'ledger.json'), PLANNER];

    const statusBefore = status();
    const statsBefore = watched.map(stat);
    const result = runCli(['--plan', '--packet', REAL_DOC_PACKET, '--packet', REAL_PLANNER_PACKET, '--json']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(status(), statusBefore, 'git status changed during a read-only plan');
    assert.deepStrictEqual(watched.map(stat), statsBefore, 'a watched file was rewritten during a read-only plan');
  });

  // ─── CLI contract ──────────────────────────────────────────────────────────
  test('malformed CLI invocations exit 2 without producing a plan', () => {
    const alpha = fixture('cli-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    for (const [name, args] of [
      ['no arguments', []],
      ['missing --plan', ['--packet', alpha]],
      ['no packet', ['--plan']],
      ['--packet without a value', ['--plan', '--packet']],
      ['--packet followed by a flag', ['--plan', '--packet', '--json']],
      ['unknown argument', ['--plan', '--packet', alpha, '--launch']],
      ['bare path', ['--plan', alpha]],
    ]) {
      const result = runCli(args);
      assert.strictEqual(result.status, 2, `${name} exited ${result.status}`);
      assert.strictEqual(result.stdout, '', `${name} printed a plan`);
      assert.match(result.stderr, /^ERROR: /);
    }
    // The module entry point refuses the same shapes rather than throwing.
    for (const bad of [undefined, 'not-an-array', [], ['']]) {
      const plan = planner.planPacketFiles(bad);
      assert.strictEqual(plan.exitCode, 2, `planPacketFiles(${JSON.stringify(bad)}) did not exit 2`);
      assert.strictEqual(plan.status, 'REFUSED');
    }
  });

  test('input that cannot be read or parsed exits 2', () => {
    const absent = path.join(tmp, 'does-not-exist.json');
    const notJson = path.join(tmp, 'not-json.json');
    fs.writeFileSync(notJson, 'this is not a packet');
    const good = fixture('unreadable-partner', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);

    for (const bad of [absent, notJson]) {
      const { exit, plan } = planJson([good, bad]);
      assert.strictEqual(exit, 2, `${bad} exited ${exit}`);
      assert.strictEqual(plan.status, 'REFUSED');
      assert.deepStrictEqual(codes(plan), ['UNREADABLE_PACKET']);
      assert.strictEqual(plan.packetSetHash, null);
      assert.deepStrictEqual(plan.waves, []);
    }
  });

  test('no refusal names the scratch directory or the checkout it ran in', () => {
    // Two machines must be able to compare the same report. Every refusal path
    // that touches a location — the caller's tmpdir, a filesystem error, the
    // validator's own output — is checked against both prefixes.
    const alpha = fixture('leak-alpha', 'PKT-PLANNER-ALPHA', [], [target('alpha')]);
    const absent = path.join(tmp, 'leak-absent.json');
    const notJson = path.join(tmp, 'leak-not-json.json');
    fs.writeFileSync(notJson, 'this is not a packet');
    const invalid = writeFixture('leak-invalid', basePacket('PKT-PLANNER-BRAVO', [], [target('bravo')], {
      filesAllowed: ['builder-control/planner-fixture/charlie.cjs'],
    }));

    for (const [name, paths] of [
      ['duplicate path', [alpha, alpha]],
      ['absent input', [absent]],
      ['unparseable input', [notJson]],
      ['validator rejection', [invalid]],
    ]) {
      const { exit, plan } = planJson(paths);
      assert.notStrictEqual(exit, 0, `${name} was not refused`);
      assert.ok(plan.refusals.length, `${name} produced no refusal`);
      const rendered = JSON.stringify(plan);
      assert.ok(!rendered.includes(tmp), `${name} leaked the scratch directory: ${rendered}`);
      assert.ok(!rendered.includes(ROOT), `${name} leaked the checkout root: ${rendered}`);
    }
  });

  test('an unreadable input outranks an ordinary refusal in the exit code', () => {
    const absent = path.join(tmp, 'does-not-exist.json');
    const uncoordinated = (() => {
      const packet = basePacket('PKT-PLANNER-BRAVO', [], [target('bravo')]);
      delete packet.coordination;
      return writeFixture('mixed-no-coordination', packet);
    })();
    const { exit, plan } = planJson([uncoordinated, absent]);
    assert.strictEqual(exit, 2);
    assert.deepStrictEqual(codes(plan), ['MISSING_COORDINATION', 'UNREADABLE_PACKET']);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed`);
if (process.exitCode) console.error('packet-planner tests FAILED');
