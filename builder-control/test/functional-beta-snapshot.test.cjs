#!/usr/bin/env node
/**
 * functional-beta-snapshot.test.cjs
 *
 * Snapshot-safe acceptance proofs for the first AEGIS dashboard beta.
 *
 * This suite is deliberately non-recursive.  It is suitable for execution
 * inside AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1 because it never calls runChecks(),
 * launches sandbox-exec, starts a reviewer/model, or opens a network listener.
 * State mutations below are confined to an isolated directory under TMPDIR.
 */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-beta-snapshot-'));
const runsDir = path.join(scratch, 'runs');
const checkpointsDir = path.join(scratch, 'checkpoints');
const ledgerFile = path.join(scratch, 'ledger.json');
fs.mkdirSync(runsDir, { recursive: true });
fs.mkdirSync(checkpointsDir, { recursive: true });
fs.writeFileSync(ledgerFile, '[]\n', { mode: 0o600 });

// aegis-run resolves these once, at require time.  Keeping them below TMPDIR
// proves real public controls without touching canonical run or ledger state.
process.env.AEGIS_RUNS_DIR = runsDir;
process.env.AEGIS_CHECKPOINTS_DIR = checkpointsDir;
process.env.AEGIS_LEDGER_FILE = ledgerFile;

const AegisRun = require('../aegis-run.cjs');
const AegisState = require('../aegis-state.cjs');
const Hosting = require('../hosting/server.cjs');
const PACKET_BYTES = fs.readFileSync(path.join(ROOT, 'builder-control', 'packets',
  'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json'));
const PACKET = JSON.parse(PACKET_BYTES);
const VALIDATED_PACKET = Object.freeze({
  path: 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json',
  sha256: crypto.createHash('sha256').update(PACKET_BYTES).digest('hex'),
  packetId: PACKET.packetId,
  parsed: PACKET,
});

let passed = 0;
const failures = [];
const detachedFixtureStops = new Map();

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`ok   ${name}\n`);
  } catch (error) {
    failures.push({ name, error });
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
  }
}

function controlError(fn, code, status = 409) {
  assert.throws(fn, (error) =>
    error instanceof AegisRun.AegisControlError &&
    error.code === code && error.httpStatus === status,
  `expected ${code}/${status}`);
}

function detachedFixtureWorker() {
  const stopFile = path.join(scratch, `stop-detached-${crypto.randomUUID()}`);
  const childSource = [
    "const fs=require('fs');",
    "const stop=process.argv[1];",
    "const poll=setInterval(()=>{if(fs.existsSync(stop)){clearInterval(poll);process.exit(0);}},10);",
    "setTimeout(()=>process.exit(0),30000).unref();",
  ].join('');
  const helper = spawnSync(process.execPath, ['-e', [
    "const {spawn}=require('child_process');",
    `const child=spawn(process.execPath,['-e',${JSON.stringify(childSource)},${JSON.stringify(stopFile)}],`,
    "  {detached:true,stdio:'ignore'});",
    "child.unref();process.stdout.write(String(child.pid));",
  ].join('')], { encoding: 'utf8', timeout: 2000 });
  assert.strictEqual(helper.status, 0, helper.stderr);
  const pid = Number(String(helper.stdout || '').trim());
  const deadline = Date.now() + 2000;
  let identity = null;
  while (Date.now() < deadline && !(identity = AegisRun.processIdentity(pid))) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  assert.ok(identity && identity.pid === pid && identity.processGroupId === pid,
    'detached fixture worker identity was unavailable');
  detachedFixtureStops.set(pid, stopFile);
  return { pid, identity };
}

function stopDetachedFixtureWorker(pid) {
  const stopFile = detachedFixtureStops.get(pid);
  assert.ok(stopFile, `detached fixture ${pid} has no bounded stop coordinate`);
  fs.writeFileSync(stopFile, 'stop\n', { mode: 0o600 });
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline &&
      (AegisRun.processExistence(pid) !== 'absent' ||
       AegisRun.processGroupExistence(pid) !== 'absent')) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  assert.strictEqual(AegisRun.processExistence(pid), 'absent');
  assert.strictEqual(AegisRun.processGroupExistence(pid), 'absent');
  detachedFixtureStops.delete(pid);
  fs.rmSync(stopFile, { force: true });
}

function seedRun(runId, state, extra = {}) {
  const run = {
    runId,
    createdAt: '2026-08-29T05:00:00.000Z',
    updatedAt: '2026-08-29T05:00:00.000Z',
    state,
    objective: 'Prove the bounded functional beta control contract',
    project: 'AEGIS dashboard',
    constraints: [],
    acceptanceCriteria: [],
    dataClass: 'INTERNAL',
    packet: 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json',
    baseCommit: 'a'.repeat(40),
    route: null,
    worktree: null,
    build: null,
    checks: null,
    subject: null,
    reviewGate: null,
    checkpoint: null,
    corrections: 0,
    transitions: [],
    ...extra,
  };
  AegisRun.saveRun(run);
  return run;
}

function validCheckReceipt() {
  const subject = {
    subjectSha256: 'b'.repeat(64),
    subjectPaths: ['builder-control/aegis-run.cjs', 'builder-control/hosting/server.cjs'],
    diffBytes: 2048,
    range: 'HEAD',
  };
  const packet = {
    path: 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json',
    sha256: 'c'.repeat(64),
  };
  const hostBody = {
    schemaVersion: 1,
    authority: 'aegis-run.cjs runHostContainmentCheck',
    executionBoundary: 'AEGIS_TOP_LEVEL_HOST_CONTAINMENT_V1',
    runId: 'RUN-20260829-11111111',
    packet,
    subject,
    snapshot: {
      policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1',
      captureSha256: 'e'.repeat(64),
    },
    command: 'node builder-control/test/host-containment.test.cjs',
    platform: 'darwin',
    startedAt: '2026-08-29T05:01:40.000Z',
    completedAt: '2026-08-29T05:01:50.000Z',
    complete: true,
    outcome: 'PASS',
    preHostReceiptRef: {
      entryId: `LED-CHECK-${'a'.repeat(32)}`,
      receiptSha256: 'b'.repeat(64),
    },
    coverage: [
      'node builder-control/test/functional-beta-snapshot.test.cjs',
      'node builder-control/test/dashboard-slice.test.cjs',
    ].map((command, index) => ({
      suite: 'pre-host-command', command,
      coverage: 'COVERED_BY_EXACT_PREHOST_COMMAND', evidenceSha256: String(index + 1).repeat(64),
    })),
    result: {
      status: 'EXECUTED', exit: 0, passed: 128, covered: 2,
      skipped: 0, failed: 0, total: 130,
      groupDrained: true, ownedGroupDrainageProven: true,
      summaryParsed: true, outputBytes: 8192, outputSha256: 'd'.repeat(64), outputTruncated: false,
    },
  };
  const hostContainment = {
    ...hostBody,
    receiptSha256: AegisRun.hostContainmentReceiptDigest(hostBody),
  };
  const body = {
    schemaVersion: 1,
    authority: 'aegis-run.cjs runChecks',
    runId: 'RUN-20260829-11111111',
    packet,
    subject,
    startedAt: '2026-08-29T05:01:00.000Z',
    completedAt: '2026-08-29T05:02:00.000Z',
    complete: true,
    outcome: 'PASS',
    total: 1,
    passed: 1,
    results: [{
      cmd: 'node builder-control/test/functional-beta-snapshot.test.cjs',
      status: 'EXECUTED',
      exit: 0,
      ranAt: '2026-08-29T05:01:30.000Z',
    }],
    hostContainment,
  };
  return { ...body, receiptSha256: AegisRun.checkReceiptDigest(body) };
}

function validPreHostReceipt() {
  const subject = {
    subjectSha256: '7'.repeat(64),
    subjectPaths: ['builder-control/aegis-run.cjs'],
    diffBytes: 1024,
    range: 'HEAD',
  };
  const commands = [
    'node builder-control/test/functional-beta-snapshot.test.cjs',
    'node builder-control/test/dashboard-slice.test.cjs',
  ];
  const body = {
    schemaVersion: 1,
    receiptType: 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1',
    authority: 'aegis-run.cjs runChecks',
    runId: 'RUN-20260829-22222222',
    packet: { path: 'builder-control/packets/PKT.json', sha256: '8'.repeat(64) },
    subject,
    snapshot: { policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1', captureSha256: '9'.repeat(64) },
    startedAt: '2026-08-29T06:00:00.000Z',
    completedAt: '2026-08-29T06:01:00.000Z',
    complete: true,
    outcome: 'PASS',
    total: commands.length,
    passed: commands.length,
    results: commands.map((cmd, index) => ({
      cmd, status: 'EXECUTED', exit: 0, ranAt: `2026-08-29T06:00:${20 + index}.000Z`,
    })),
    hostContainment: {
      state: 'PENDING', commands: ['node builder-control/test/host-containment.test.cjs'],
    },
  };
  return { ...body, receiptSha256: AegisRun.checkReceiptDigest(body) };
}

process.stdout.write('AEGIS functional beta — immutable snapshot acceptance\n');

test('the canonical state graph permits no shortcut from intake to build', () => {
  assert.deepStrictEqual(AegisRun.STATES.INTAKE_RECORDED.next, ['ROUTED', 'ABANDONED']);
  assert.deepStrictEqual(AegisRun.STATES.ROUTED.next, ['WORKTREE_READY', 'ABANDONED']);
  assert.ok(AegisRun.STATES.WORKTREE_READY.next.includes('BUILDING'));
  assert.ok(!AegisRun.STATES.INTAKE_RECORDED.next.includes('BUILDING'));
  assert.ok(!Object.prototype.hasOwnProperty.call(AegisRun.STATES, 'PAUSED'));
});

test('the real dashboard intake authority binds the approved operator-beta packet', () => {
  const created = AegisRun.createRunFromObjective(
    { objective: 'Prove dashboard intake packet binding' },
    { packet: Hosting.SWITCHBOARD_PACKET },
  );
  const recorded = AegisRun.loadRun(created.runId);
  assert.strictEqual(
    recorded.packet,
    'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json',
    'dashboard objective intake persisted a packet other than the approved functional-beta packet',
  );
});

test('Start launch specification consumes only the canonical route and exact recorded dashboard packet', () => {
  const launch = Hosting.buildGovernedLaunchSpec({
    runId: 'RUN-20260829-22222222',
    objective: 'Build only the AEGIS dashboard beta',
    constraints: ['Do not touch unrelated systems'],
    acceptanceCriteria: ['The governed dashboard slice passes'],
    packet: Hosting.SWITCHBOARD_PACKET,
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
  }, undefined, VALIDATED_PACKET);
  assert.deepStrictEqual(Object.keys(launch).sort(), ['model', 'prompt', 'provider', 'timeoutSec']);
  assert.strictEqual(launch.timeoutSec, 900);
  assert.match(launch.prompt,
    /Canonical packet: builder-control\/packets\/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA\.json/,
    'the governed launch prompt did not preserve the packet recorded by dashboard intake');
  assert.match(launch.prompt, /Canonical run constraints JSON: \["Do not touch unrelated systems"\]/);
  assert.match(launch.prompt, /Canonical acceptance criteria JSON: \["The governed dashboard slice passes"\]/);
  assert.throws(() => Hosting.buildGovernedLaunchSpec({
    runId: 'RUN-20260829-22222222', objective: 'bounded', constraints: [], acceptanceCriteria: [],
    packet: 'packet.json',
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
  }, undefined, VALIDATED_PACKET), (error) => error && error.code === 'INVALID_PACKET');
});

test('Cancel uses the real public authority and only a legal ABANDONED transition', () => {
  const runId = 'RUN-20260829-33333333';
  seedRun(runId, 'WORKTREE_READY');
  const result = AegisRun.cancelRun(runId);
  assert.deepStrictEqual(result, {
    runId,
    state: 'ABANDONED',
    action: 'cancel',
    nextAction: 'none',
  });
  const saved = AegisRun.loadRun(runId);
  assert.strictEqual(saved.state, 'ABANDONED');
  assert.deepStrictEqual(saved.transitions.map(({ from, to }) => ({ from, to })),
    [{ from: 'WORKTREE_READY', to: 'ABANDONED' }]);
});

test('Retry uses the real public authority only from failure and remains bounded', () => {
  const runId = 'RUN-20260829-44444444';
  seedRun(runId, 'CHECKS_FAILED');
  const result = AegisRun.retryRun(runId);
  assert.strictEqual(result.state, 'CORRECTING');
  assert.strictEqual(result.action, 'retry');
  assert.strictEqual(result.correction, 1);
  assert.match(result.nextAction, /^--build RUN-20260829-44444444 --cmd/);
  const saved = AegisRun.loadRun(runId);
  assert.strictEqual(saved.corrections, 1);
  assert.deepStrictEqual(saved.transitions.map(({ from, to }) => ({ from, to })),
    [{ from: 'CHECKS_FAILED', to: 'CORRECTING' }]);

  const invalidId = 'RUN-20260829-55555555';
  seedRun(invalidId, 'BUILT');
  controlError(() => AegisRun.retryRun(invalidId), 'INVALID_RETRY');
  assert.strictEqual(AegisRun.loadRun(invalidId).state, 'BUILT');

  const boundedId = 'RUN-20260829-66666666';
  seedRun(boundedId, 'BUILD_FAILED', { corrections: AegisRun.MAX_CORRECTIONS });
  controlError(() => AegisRun.retryRun(boundedId), 'CORRECTION_LIMIT');
  assert.strictEqual(AegisRun.loadRun(boundedId).corrections, AegisRun.MAX_CORRECTIONS);
});

test('REVIEW_FAILED async Retry uses identity-bound worker evidence through the public runtime path', () => {
  const launchedWorker = detachedFixtureWorker();
  const launchSpec = {
    provider: 'claude-subscription', model: 'opus', prompt: 'bounded review correction',
  };
  const staleRunId = 'RUN-20260829-45454545';
  seedRun(staleRunId, 'REVIEW_FAILED', {
    packetCoordinate: { path: VALIDATED_PACKET.path, sha256: VALIDATED_PACKET.sha256,
      packetId: VALIDATED_PACKET.packetId },
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
    worktree: { path: scratch },
    build: {
      mode: 'async', attempt: 1, attemptId: '45454545-4545-4545-8545-454545454545',
      launchSpec, workerPid: launchedWorker.pid, processGroupId: launchedWorker.pid,
      processIdentity: { ...launchedWorker.identity,
        startMarker: `${launchedWorker.identity.startMarker}-prior-lifetime` },
      workerState: 'REVIEW_FAILED', revision: 2,
    },
  });

  const workerPath = require.resolve('../aegis-worker.cjs');
  const workerModule = require.cache[workerPath] || { exports: require(workerPath) };
  const originalWorker = workerModule.exports;
  let launches = 0;
  let liveWorker = null;
  workerModule.exports = {
    ...originalWorker,
    normalizeLaunchSpec: (value) => Object.freeze({ ...value }),
    normalizeTimeoutSec: (value) => value === undefined ? 900 : Number(value),
    launchWorker: ({ launchSpec: requested }) => {
      launches += 1;
      return {
        workerPid: launchedWorker.pid,
        processGroupId: launchedWorker.pid,
        launchSha256: crypto.createHash('sha256').update(JSON.stringify(requested)).digest('hex'),
        control: { dir: path.join(scratch, 'control'), secretSha256: 'fixture' },
      };
    },
  };
  try {
    const result = AegisRun.retryRun(staleRunId);
    assert.strictEqual(result.state, 'BUILDING');
    assert.strictEqual(result.action, 'start');
    assert.strictEqual(result.attempt, 2);
    assert.strictEqual(launches, 1);
    const saved = AegisRun.loadRun(staleRunId);
    assert.strictEqual(saved.corrections, 1);
    assert.deepStrictEqual(saved.transitions.map(({ from, to }) => ({ from, to })), [
      { from: 'REVIEW_FAILED', to: 'CORRECTING' },
      { from: 'CORRECTING', to: 'BUILDING' },
    ]);
    AegisRun.transition(saved, 'BUILD_FAILED', 'fixture closes the stubbed retry worker');
    AegisRun.verifyGlobalWorkerLease(staleRunId, saved.build.attemptId, launchedWorker.pid);
    stopDetachedFixtureWorker(launchedWorker.pid);
    const reclaimedLease = AegisRun.acquireGlobalWorkerClaim(1000);
    assert.strictEqual(AegisRun.releaseRunLaunchClaim(reclaimedLease), true,
      'the terminal fixture worker lease was not safely reclaimed');

    const liveRunId = 'RUN-20260829-46464646';
    liveWorker = detachedFixtureWorker();
    seedRun(liveRunId, 'REVIEW_FAILED', {
      packetCoordinate: { path: VALIDATED_PACKET.path, sha256: VALIDATED_PACKET.sha256,
        packetId: VALIDATED_PACKET.packetId },
      route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
      worktree: { path: scratch },
      build: {
        mode: 'async', attempt: 1, attemptId: '46464646-4646-4646-8646-464646464646',
        launchSpec, workerPid: liveWorker.pid, processGroupId: liveWorker.pid,
        processIdentity: liveWorker.identity, workerState: 'REVIEW_FAILED', revision: 2,
      },
    });
    controlError(() => AegisRun.retryRun(liveRunId), 'WORKER_ALREADY_ACTIVE');
    const unchanged = AegisRun.loadRun(liveRunId);
    assert.strictEqual(unchanged.state, 'REVIEW_FAILED');
    assert.strictEqual(unchanged.corrections, 0);
    assert.strictEqual(launches, 1, 'identity-bound live-worker refusal launched a duplicate worker');
    stopDetachedFixtureWorker(liveWorker.pid);
  } finally {
    workerModule.exports = originalWorker;
    if (AegisRun.processExistence(launchedWorker.pid) !== 'absent') {
      stopDetachedFixtureWorker(launchedWorker.pid);
    }
    if (liveWorker && AegisRun.processExistence(liveWorker.pid) !== 'absent') {
      stopDetachedFixtureWorker(liveWorker.pid);
    }
  }
});

test('browser run controls accept exactly runId and refuse command or routing authority', () => {
  const runId = 'RUN-20260829-77777777';
  assert.strictEqual(Hosting.parseRunIdBody({ runId }), runId);
  for (const key of ['command', 'provider', 'model', 'executable', 'reviewer', 'packet']) {
    controlError(() => Hosting.parseRunIdBody({ runId, [key]: 'caller-controlled' }),
      'INVALID_REQUEST', 400);
  }
  for (const key of ['command', 'provider', 'model', 'executable', 'packet']) {
    controlError(() => AegisRun.normalizeObjective({ objective: 'bounded objective', [key]: 'caller-controlled' }),
      'INVALID_OBJECTIVE', 400);
  }
});

test('checks and review binding are named thin routes over canonical authorities', () => {
  assert.strictEqual(Hosting.API_POST_ROUTES['/api/checks'], 'checks');
  assert.strictEqual(Hosting.API_POST_ROUTES['/api/review-bind'], 'review-bind');
  const hostingSource = fs.readFileSync(path.join(ROOT, 'builder-control', 'hosting', 'server.cjs'), 'utf8');
  assert.strictEqual(Hosting.DEFAULT_CONTROL_AUTHORITIES.runChecks, AegisRun.runChecks);
  assert.strictEqual(Hosting.DEFAULT_CONTROL_AUTHORITIES.bindIndependentReview,
    AegisRun.bindIndependentReview);
  assert.match(hostingSource,
    /pathname === '\/api\/checks'\) result = controlAuthorities\.runChecks\(runId\)/);
  assert.match(hostingSource,
    /pathname === '\/api\/review-bind'\) result = controlAuthorities\.bindIndependentReview\(runId\)/);
  assert.match(hostingSource, /http\.createServer\(handler\(config\)\)/,
    'production host construction must use the canonical default authorities');

  const runSource = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-run.cjs'), 'utf8');
  const checkResult = runSource.slice(
    runSource.indexOf('function runChecksClaimed'),
    runSource.indexOf('function runChecks(runId)'));
  assert.match(checkResult, /checks:\s*Object\.freeze\(\{ passed: fresh\.checks\.passed, total: fresh\.checks\.total \}\)/);
  assert.doesNotMatch(checkResult.slice(checkResult.lastIndexOf('return Object.freeze')),
    /stdout|stderr|results|command|provider|model/);

  const reviewResult = runSource.slice(
    runSource.indexOf('function bindIndependentReviewClaimed'),
    runSource.indexOf('function bindIndependentReview(runId)'));
  assert.match(reviewResult, /action: 'bind-independent-review'/);
  assert.match(reviewResult, /subjectSha256: fresh\.subject\.subjectSha256/);
  assert.doesNotMatch(reviewResult.slice(reviewResult.lastIndexOf('return Object.freeze')),
    /findings|transcript|stdout|stderr|provider|model/);
});

test('check receipts are bound to the exact packet, subject and command list', () => {
  const receipt = validCheckReceipt();
  const expected = {
    runId: receipt.runId,
    packetPath: receipt.packet.path,
    packetSha256: receipt.packet.sha256,
    subject: receipt.subject,
    commands: receipt.results.map((result) => result.cmd),
    hostCommands: ['node builder-control/test/host-containment.test.cjs'],
  };
  assert.strictEqual(AegisRun.validateCheckReceipt(receipt, expected), true);
  assert.strictEqual(AegisRun.validateCheckReceipt(receipt,
    { ...expected, packetSha256: 'd'.repeat(64) }), false);
  assert.strictEqual(AegisRun.validateCheckReceipt(receipt,
    { ...expected, subject: { ...expected.subject, subjectSha256: 'e'.repeat(64) } }), false);
  assert.strictEqual(AegisRun.validateCheckReceipt(receipt,
    { ...expected, commands: ['node --check unrelated.cjs'] }), false);
  assert.strictEqual(AegisRun.validateCheckReceipt(receipt,
    { ...expected, hostCommands: ['node --check unrelated.cjs'] }), false);
  for (const mutate of [
    (host) => null,
    (host) => ({ ...host, platform: 'linux' }),
    (host) => ({ ...host, result: { ...host.result, exit: 1 } }),
    (host) => ({ ...host, result: { ...host.result, outputTruncated: true } }),
    (host) => ({ ...host, result: { ...host.result, skipped: 1, total: host.result.total + 1 } }),
  ]) {
    const changed = mutate(receipt.hostContainment);
    const body = { ...receipt, hostContainment: changed };
    delete body.receiptSha256;
    const tampered = { ...body, receiptSha256: AegisRun.checkReceiptDigest(body) };
    assert.strictEqual(AegisRun.validateCheckReceipt(tampered, expected), false,
      'invalid host containment evidence reached PASS');
  }
});

test('the canonical beta packet keeps host containment separate and mandatory exactly once', () => {
  const command = 'node builder-control/test/host-containment.test.cjs';
  assert.strictEqual(PACKET.testsRequired.filter((candidate) => candidate === command).length, 0,
    'the nested immutable check set still attempts to execute the top-level host suite');
  assert.deepStrictEqual(PACKET.hostContainmentRequired, [command]);
  assert.strictEqual(PACKET.testsRequired.includes('node builder-control/test/aegis-worker.test.cjs'), false,
    'the host-only worker behavior suite was nested inside the immutable check sandbox');
  assert.ok(PACKET.filesAllowed.includes('builder-control/test/host-containment.test.cjs'));
  assert.ok(PACKET.filesAllowed.includes('builder-control/test/aegis-worker.test.cjs'));
  assert.ok(PACKET.authorization.allowsProtectedPaths.includes('builder-control/test/host-containment.test.cjs'));
  assert.ok(PACKET.authorization.allowsProtectedPaths.includes('builder-control/test/aegis-worker.test.cjs'));
  const aggregateSource = fs.readFileSync(path.join(ROOT, 'builder-control', 'test', 'host-containment.test.cjs'), 'utf8');
  const runtimeSource = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-run.cjs'), 'utf8');
  assert.doesNotMatch(aggregateSource,
    /builder-control\/test\/(?:aegis-worker|aegis-run|review-adapters)\.test\.cjs/,
    'the host aggregate nested a complete worker, run, or review-adapter suite inside the outer seatbelt');
  assert.match(aggregateSource, /runContainedWithWatchdog/,
    'the host aggregate no longer exercises the production review watchdog primitive');
  const lifecycleProbe = aggregateSource.slice(
    aggregateSource.indexOf('function governedWorkerLifecycleProbeSource'),
    aggregateSource.indexOf('const suites ='));
  for (const required of [
    /R\.startWorker\(/, /workerState === 'RUNNING'/, /heartbeatAt/,
    /state === 'BUILT'/, /state==='BUILD_FAILED'/, /R\.cancelRun\(/,
    /childCloseObserved,true/, /processGroupDrained,true/, /W\.processGroupAlive/,
  ]) assert.match(lifecycleProbe, required,
    `the fixed governed worker probe omitted production lifecycle evidence ${required}`);
  assert.doesNotMatch(lifecycleProbe, /console\.log\('4 passed, 0 skipped, 0 failed\.'\)/,
    'the former predicate-only launch-binding check is still labeled as a worker lifecycle');
  assert.match(runtimeSource, /runContainedCheckProcess\(contained, snapshot\.snapshotRoot, containedEnv\)/);
  assert.match(runtimeSource, /result\.executionBoundary\.drained === true/);
  assert.match(runtimeSource, /function proveOwnedProcessGroupDrainage/);
  assert.match(runtimeSource, /left a live descendant process group/,
    'the trusted supervisor drainage proof did not require a real descendant');
  assert.match(runtimeSource, /ownedGroupDrainageProven: result\.ownedGroupDrainageProven === true/,
    'the canonical host receipt omitted the behavioral drainage proof');
});

test('review binding and checkpoint reload the mandatory host receipt from canonical evidence', () => {
  const source = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-run.cjs'), 'utf8');
  const review = source.slice(source.indexOf('function bindIndependentReviewClaimed'),
    source.indexOf('function bindIndependentReview(runId)'));
  const checkpoint = source.slice(source.indexOf('function cmdCheckpoint'),
    source.indexOf('function cmdRollback'));
  assert.match(review, /hostCommands = runnableHostContainmentCommands\(packetNow\.parsed\)/);
  assert.match(review, /loadCanonicalPreHostCheckReceipt\(run\.checks/);
  assert.match(review, /subject, commands, hostCommands/);
  assert.ok(review.indexOf("'--gate-done'") < review.indexOf('finalizeReviewedHostContainment('),
    'subject-controlled host containment can execute before the exact-subject review gate');
  assert.match(checkpoint, /hostCommands: runnableHostContainmentCommands\(packetNow\.parsed\)/);
});

test('pre-host PASS is separately typed and cannot satisfy the final check authority', () => {
  const source = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-run.cjs'), 'utf8');
  const initialChecks = source.slice(source.indexOf('function runChecksClaimed'),
    source.indexOf('function runChecks(runId)'));
  const finalization = source.slice(source.indexOf('function finalizeReviewedHostContainment'),
    source.indexOf('function checkpointCandidateProblem'));
  assert.match(initialChecks, /receiptType: PRE_HOST_CHECK_RECEIPT_TYPE/);
  assert.match(initialChecks, /hostContainment: \{ state: 'PENDING'/);
  assert.match(finalization, /runTopLevelHostContainmentCheck\(/);
  assert.match(finalization, /persistCanonicalCheckReceipt\(run, finalReceipt\)/);
  assert.match(source, /receipt\.receiptType === PRE_HOST_CHECK_RECEIPT_TYPE/,
    'the full PASS validator can accept pre-host evidence');
});

test('post-review host execution is wrapped in a deny-default disposable boundary', () => {
  const source = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-run.cjs'), 'utf8');
  const environment = source.slice(source.indexOf('function topLevelHostCheckEnvironment'),
    source.indexOf('function outerHostContainmentProfile'));
  const profile = source.slice(source.indexOf('function outerHostContainmentProfile'),
    source.indexOf('function hostContainmentReceiptBody'));
  const execution = source.slice(source.indexOf('function runTopLevelHostContainmentCheck'),
    source.indexOf('function finalizeReviewedHostContainment'));
  assert.match(environment, /HOME: home, TMPDIR: scratch/);
  assert.doesNotMatch(environment, /\.\.\.process\.env/,
    'the host suite inherited the operator environment');
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /allow file-write\* \(subpath/);
  assert.doesNotMatch(profile, /allow file-read\*\)/,
    'the outer profile granted an unbounded file-read wildcard');
  assert.doesNotMatch(profile, /allow network\*\)/,
    'the outer profile granted ambient network access');
  assert.match(execution, /CheckContainment\.sandboxedCommand\(profile, \[script\]\)/);
  assert.match(execution, /buildHostProofContext\(options\.preHostReceipt, options\.preHostReceiptRef\)/);
  assert.match(execution,
    /runContainedCheckProcess\(contained, snapshot\.snapshotRoot, containedEnv\)/,
    'the trusted outer supervisor did not launch the sandbox with its scrubbed environment');
});

test('typed host coverage binds exact PRE_HOST commands and separately requires executed fixed probes', () => {
  const preHostReceipt = validPreHostReceipt();
  const preHostReceiptRef = {
    entryId: `LED-CHECK-${preHostReceipt.receiptSha256.slice(0, 32)}`,
    receiptSha256: preHostReceipt.receiptSha256,
  };
  const context = AegisRun.buildHostProofContext(preHostReceipt, preHostReceiptRef);
  assert.deepStrictEqual(context.preHostCommandCoverage.map(({ suite, command, coverage }) =>
    ({ suite, command, coverage })), [
    { suite: 'pre-host-command', command: 'node builder-control/test/functional-beta-snapshot.test.cjs',
      coverage: 'COVERED_BY_EXACT_PREHOST_COMMAND' },
    { suite: 'pre-host-command', command: 'node builder-control/test/dashboard-slice.test.cjs',
      coverage: 'COVERED_BY_EXACT_PREHOST_COMMAND' },
  ]);
  assert.deepStrictEqual(context.fixedProbeNames, [
    'deny-default-environment-self-test', 'governed-worker-lifecycle',
    'governed-run-host-authority', 'governed-review-adapter-boundary',
    'governed-http-control-path',
    'outer-boundary-fixed-probe',
  ]);
  assert.ok(context.preHostCommandCoverage.every((item) =>
    !Object.hasOwn(item, 'testName') && !Object.hasOwn(item, 'preHostCommand')),
  'a named host-only test was certified without executing a fixed probe');
  const coverage = context.preHostCommandCoverage.map(
    ({ suite, command, coverage: state, evidenceSha256 }) =>
      ({ suite, command, coverage: state, evidenceSha256 }));
  const evidence = {
    schemaVersion: 1,
    evidenceType: 'AEGIS_HOST_PROOF_EVIDENCE_V1',
    boundary: 'AEGIS_TOP_LEVEL_HOST_CONTAINMENT_V1',
    contextSha256: context.contextSha256,
    subjectSha256: preHostReceipt.subject.subjectSha256,
    preHostReceiptRef,
    executedSuites: [
      'deny-default-environment-self-test', 'governed-worker-lifecycle',
      'governed-run-host-authority', 'governed-review-adapter-boundary',
      'governed-http-control-path',
      'outer-boundary-fixed-probe',
    ],
    coverage,
  };
  assert.strictEqual(AegisRun.validateHostProofEvidence(evidence, context), true);
  assert.strictEqual(AegisRun.validateHostProofEvidence({
    ...evidence,
    coverage: evidence.coverage.slice(1),
  }, context), false, 'missing PRE_HOST command coverage was accepted');
  assert.strictEqual(AegisRun.validateHostProofEvidence({
    ...evidence,
    executedSuites: [...evidence.executedSuites, 'named-test-not-executed'],
  }, context), false, 'a named but unexecuted host test was accepted as a fixed probe');
  assert.throws(() => AegisRun.buildHostProofContext({
    ...preHostReceipt,
    results: preHostReceipt.results.slice(0, 1),
  }, preHostReceiptRef), /validated canonical pre-host receipt|one-to-one PRE_HOST PASS/);
});

test('the beta packet is explicitly bound to canonical dashboard-state preflight', () => {
  const source = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-run.cjs'), 'utf8');
  const block = source.slice(source.indexOf('const DASHBOARD_STATE_PACKET_IDS'),
    source.indexOf('const CHECK_SNAPSHOT_POLICY'));
  assert.match(block, /PKT-20260826-ASYNC-WORKER-OPERATOR-BETA/,
    'operator beta can run checks without required canonical dashboard state generation');
});

test('live activity is projected from canonical worker state without raw output', () => {
  const subjectSha256 = 'f'.repeat(64);
  const snap = {
    generatedAt: '2026-08-29T05:03:00.000Z',
    engineering: { state: 'UNAVAILABLE', reason: 'gate evidence is not yet bound' },
    integration: { connectors: { state: 'UNAVAILABLE', reason: 'no connector evidence', connectors: [] } },
    reviewers: { state: 'UNAVAILABLE', reviewers: [] },
    cost: { state: 'UNAVAILABLE', reason: 'no cost evidence' },
    knowledge: { state: 'UNKNOWN', conflicts: 0 },
    events: {
      state: 'OK',
      events: [{
        entryId: 'LED-BETA-1', ts: '2026-08-29T05:03:00.000Z', gate: 'aegis-run',
        status: 'PASS', agentId: 'claude-code', result: 'private result must not travel',
      }],
    },
    runs: {
      state: 'OK',
      current: {
        state: 'BOUND', runId: 'RUN-20260829-88888888', updatedAt: '2026-08-29T05:03:00.000Z',
        packetId: 'PKT-BETA', subjectSha256, subjectState: 'BOUND',
      },
      runs: [{
        runId: 'RUN-20260829-88888888', state: 'BUILDING', objective: 'Build AEGIS beta',
        contractStep: 5, createdAt: '2026-08-29T05:00:00.000Z', updatedAt: '2026-08-29T05:03:00.000Z',
        packetId: 'PKT-BETA', route: {
          model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole',
        },
        build: {
          mode: 'async', workerState: 'RUNNING', workerPid: 4242,
          startedAt: '2026-08-29T05:01:00.000Z', heartbeatAt: '2026-08-29T05:02:59.000Z',
          stdoutTail: 'PRIVATE MODEL OUTPUT', stderrTail: 'PRIVATE ERROR OUTPUT',
          launchSpec: { prompt: 'PRIVATE PROMPT', provider: 'caller-controlled' },
        },
        checks: null, checkpoint: null, transitions: 3,
      }],
    },
  };
  const projected = Hosting.minimizeApiStatus(snap);
  assert.strictEqual(projected.runs.length, 1);
  assert.deepStrictEqual(projected.runs[0].build.activity, {
    code: 'RUNNING', phase: 'RUNNING', active: true, summary: 'Builder is running',
  });
  assert.strictEqual(projected.events.length, 1);
  assert.deepStrictEqual(Object.keys(projected.events[0]).sort(),
    ['agentId', 'entryId', 'gate', 'status', 'ts'].sort());
  const publicText = JSON.stringify(projected);
  for (const forbidden of ['stdoutTail', 'stderrTail', 'launchSpec', 'PRIVATE MODEL OUTPUT',
    'PRIVATE ERROR OUTPUT', 'PRIVATE PROMPT', 'private result must not travel']) {
    assert.ok(!publicText.includes(forbidden), `public live state leaked ${forbidden}`);
  }

  const mismatch = Hosting.minimizeWorker({
    mode: 'async', workerState: 'RUNNING', workerPid: 4242,
  }, 'BUILT');
  assert.deepStrictEqual(mismatch.activity, {
    code: 'STATE_MISMATCH', phase: 'BLOCKED', active: false,
    summary: 'Worker reports running outside an active build',
  });
});

test('current-run binding uses canonical timestamps and never borrows a gate subject', () => {
  const subject = '1'.repeat(64);
  const older = {
    runId: 'RUN-20260829-aaaaaaaa', updatedAt: '2026-08-29T05:00:00.000Z', updatedAtMs: Date.parse('2026-08-29T05:00:00.000Z'),
    createdAt: '2026-08-29T04:59:00.000Z', state: 'BUILT', packetId: 'PKT-OLD', subjectSha256: subject,
  };
  const newerUnlinked = {
    runId: 'RUN-20260829-bbbbbbbb', updatedAt: '2026-08-29T05:05:00.000Z', updatedAtMs: Date.parse('2026-08-29T05:05:00.000Z'),
    createdAt: '2026-08-29T05:01:00.000Z', state: 'BUILDING', packetId: 'PKT-NEW', subjectSha256: null,
  };
  const binding = AegisState.bindCurrentRun([older, newerUnlinked], subject);
  assert.strictEqual(binding.runId, newerUnlinked.runId);
  assert.strictEqual(binding.subjectState, 'UNLINKED');
  assert.strictEqual(binding.subjectSha256, null);
  assert.strictEqual(binding.gateSubjectSha256, subject);
});

// Every process that persists governed state loads this observer first. It
// records each write payload before delegating to the real filesystem, so the
// proof below is about bytes handed to persistence, not about final state.
const PERSISTENCE_OBSERVER_SOURCE = `'use strict';
const realFs = require('fs');
const trace = process.env.FAKE_PERSISTENCE_TRACE_FILE;
if (trace) {
  const append = realFs.appendFileSync.bind(realFs);
  const payloadText = (data) => {
    if (typeof data === 'string') return data;
    try { return Buffer.from(data).toString('utf8'); } catch { return ''; }
  };
  const record = (op, target, data) => {
    if (String(target) === trace) return;
    try {
      append(trace, JSON.stringify({ pid: process.pid, op, target: String(target),
        payload: payloadText(data) }) + '\\n');
    } catch { /* observation must never alter production behavior */ }
  };
  for (const op of ['writeFileSync', 'appendFileSync']) {
    const original = realFs[op].bind(realFs);
    realFs[op] = (target, data, ...rest) => { record(op, target, data); return original(target, data, ...rest); };
  }
  const originalRename = realFs.renameSync.bind(realFs);
  realFs.renameSync = (from, to) => { record('renameSync', from + ' -> ' + to, ''); return originalRename(from, to); };
  const originalWriteFile = realFs.writeFile;
  realFs.writeFile = function(target, data, ...rest) { record('writeFile', target, data); return originalWriteFile.call(realFs, target, data, ...rest); };
  const originalPromisesWrite = realFs.promises.writeFile.bind(realFs.promises);
  realFs.promises.writeFile = (target, data, ...rest) => { record('promises.writeFile', target, data); return originalPromisesWrite(target, data, ...rest); };
}
`;

function readPersistenceTrace(tracePath) {
  return fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function persistenceSecretViolations(traceEntries, secrets) {
  const violations = [];
  for (const entry of traceEntries) {
    for (const secret of secrets) {
      if (String(entry.payload || '').includes(secret)) {
        violations.push({ op: entry.op, target: entry.target, secret });
      }
    }
  }
  return violations;
}

function walkArtifactDigests(roots) {
  const digests = new Map();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    if (fs.lstatSync(root).isFile()) {
      digests.set(root, crypto.createHash('sha256').update(fs.readFileSync(root)).digest('hex'));
      continue;
    }
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const target = path.join(dir, name);
        if (fs.lstatSync(target).isDirectory()) walk(target);
        else digests.set(target, crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'));
      }
    })(root);
  }
  return digests;
}

test('credential-shaped builder output never reaches any run, ledger or evidence persistence write, proven at the write boundary and after reload', () => {
  const bearer = 'AEGIS-BETA-FAKE-BEARER-5a4b3c2d1e0f9a8b';
  const password = 'AEGIS-BETA-FAKE-PASSWORD-6f5e4d3c';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZWdpcy1iZXRhLWZpeHR1cmUifQ.fakeBetaSignature654321';
  const apiKey = 'AEGIS-BETA-FAKE-API-KEY-7b6a5948';
  const secrets = [bearer, password, jwt, apiKey];
  const diagnostic = 'AEGIS_BETA_BUILDER_DIAGNOSTIC';
  // The observer trace and the faulty fixture live outside every observed
  // persistence root so the proof never scans its own instrumentation.
  const fixtureDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-beta-observer-'));
  const tracePath = path.join(fixtureDir, 'persistence-trace.jsonl');
  const observerPath = path.join(fixtureDir, 'persistence-observer.cjs');
  fs.writeFileSync(tracePath, '');
  fs.writeFileSync(observerPath, PERSISTENCE_OBSERVER_SOURCE);
  // The suite scratch already resolves inside the OS temp root, which is what
  // the deterministic worker fixture and the ledger writer both require.
  const buildFixture = path.join(scratch, 'build-fixture');
  const worktree = path.join(buildFixture, 'worktree');
  const bin = path.join(buildFixture, 'bin');
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'fixture\n');
  fs.writeFileSync(path.join(worktree, 'authority-source.txt'), 'canonical\n');
  fs.writeFileSync(path.join(worktree, 'authority-check.cjs'), 'process.exit(0);\n');
  const packetPath = path.join(worktree, 'packet.json');
  fs.writeFileSync(packetPath, JSON.stringify({
    packetId: 'PKT-TEST-BETA-REDACTION', agentId: 'claude-code',
    sourceOfTruth: ['authority-source.txt'], testsRequired: ['node authority-check.cjs'],
    filesAllowed: ['allowed.txt'],
  }));
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
'use strict';
for (let i = 0; i < 3000; i++) console.log('oversized-stdout-padding-line-' + i);
console.log(${JSON.stringify(diagnostic)});
console.log('Authorization: Bearer ' + ${JSON.stringify(bearer)});
console.log('password=' + ${JSON.stringify(password)});
console.log(${JSON.stringify(jwt)});
console.log('api_key: ' + ${JSON.stringify(apiKey)});
for (let i = 0; i < 3000; i++) console.error('oversized-stderr-padding-line-' + i);
console.error(${JSON.stringify(diagnostic)});
console.error('Authorization: Bearer ' + ${JSON.stringify(bearer)});
console.error('password=' + ${JSON.stringify(password)});
console.error(${JSON.stringify(jwt)});
console.error('api_key: ' + ${JSON.stringify(apiKey)});
process.exit(9);
`, { mode: 0o755 });

  const runId = 'RUN-20260901-be7a0001';
  seedRun(runId, 'WORKTREE_READY', { worktree: { path: worktree }, packet: packetPath, build: null });
  const runFile = AegisRun.runPath(runId);
  const observedRoots = [runsDir, checkpointsDir, ledgerFile, buildFixture];
  const beforeArtifacts = walkArtifactDigests(observedRoots);

  const savedEnv = {};
  for (const [key, value] of Object.entries({
    NODE_ENV: 'test',
    AEGIS_TEST_CLAUDE_EXECUTABLE: path.join(bin, 'claude'),
    AEGIS_TEST_CONTAINMENT_MODE: 'DETERMINISTIC_PROFILE_ONLY',
    FAKE_PERSISTENCE_TRACE_FILE: tracePath,
  })) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  const workerPath = require.resolve('../aegis-worker.cjs');
  require(workerPath);
  const workerModule = require.cache[workerPath];
  const originalWorker = workerModule.exports;
  const interceptInProcess = () => {
    const original = {
      writeFileSync: fs.writeFileSync, appendFileSync: fs.appendFileSync, renameSync: fs.renameSync,
    };
    const append = original.appendFileSync.bind(fs);
    const record = (op, target, data) => {
      if (String(target) === tracePath) return;
      append(tracePath, JSON.stringify({ pid: process.pid, op, target: String(target),
        payload: typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : '' }) + '\n');
    };
    fs.writeFileSync = (target, data, ...rest) => { record('writeFileSync', target, data);
      return original.writeFileSync.call(fs, target, data, ...rest); };
    fs.appendFileSync = (target, data, ...rest) => { record('appendFileSync', target, data);
      return original.appendFileSync.call(fs, target, data, ...rest); };
    fs.renameSync = (from, to) => { record('renameSync', `${from} -> ${to}`, '');
      return original.renameSync.call(fs, from, to); };
    return () => { Object.assign(fs, original); };
  };
  try {
    // The production launch path is preserved byte for byte; the test-only
    // spawn seam prepends the observer preload to the worker's node argv.
    workerModule.exports = {
      ...originalWorker,
      launchWorker: (launchArgs) => originalWorker.launchWorker(launchArgs, {
        spawn: (bin2, argv, options) =>
          require('child_process').spawn(bin2, ['--require', observerPath, ...argv], options),
      }),
    };
    const restoreInProcess = interceptInProcess();
    let started;
    try {
      started = AegisRun.startWorker(runId, {
        provider: 'claude-subscription', prompt: 'emit credential-shaped oversized output', model: 'opus',
      }, { timeoutSec: 60 });
    } finally { restoreInProcess(); }
    assert.strictEqual(started.state, 'BUILDING');

    const deadline = Date.now() + 30000;
    let run = null;
    while (Date.now() < deadline) {
      run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      if (run.state === 'BUILT' || run.state === 'BUILD_FAILED') break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    assert.strictEqual(run && run.state, 'BUILD_FAILED', 'the governed builder did not complete');
    const workerPid = run.build.workerPid;
    const exitDeadline = Date.now() + 5000;
    while (Date.now() < exitDeadline && AegisRun.processExistence(workerPid) !== 'absent') {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }

    const trace = readPersistenceTrace(tracePath);
    // The observation instrument itself is proven before any absence claim:
    // the trace must contain the launch payload, the worker's RUNNING record,
    // the builder-output-bearing finalization, and one intercepted temp write
    // for every atomic publish of the run record.
    assert.ok(trace.some((entry) => /"workerState":\s*"RUNNING"/.test(entry.payload || '')),
      'the persistence observer never saw the worker RUNNING record');
    const outputWrites = trace.filter((entry) => /"stdoutTail"/.test(entry.payload || ''));
    assert.ok(outputWrites.length >= 1, 'the persistence observer never saw a builder-output payload');
    assert.ok(outputWrites.some((entry) => String(entry.payload).includes('[REDACTED]')),
      'no observed builder-output payload carried a redaction marker');
    const runPublishes = trace.filter((entry) => entry.op === 'renameSync' &&
      entry.target.endsWith(` -> ${runFile}`));
    assert.ok(runPublishes.length >= 3, 'atomic run-record publishes were not observed');
    for (const publish of runPublishes) {
      const source = publish.target.slice(0, -` -> ${runFile}`.length);
      assert.ok(trace.some((entry) => entry.op === 'writeFileSync' && entry.target === source),
        `run-record publish from ${source} had no intercepted write payload`);
    }
    const ledgerEntries = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))
      .filter((entry) => entry && entry.correlationId === runId);
    assert.ok(ledgerEntries.some((entry) => entry.operationId === `${runId}:BUILDING->BUILD_FAILED`),
      'the canonical ledger did not record the completed build');
    for (const entry of ledgerEntries) {
      assert.ok(trace.some((item) => String(item.payload || '').includes(entry.operationId)),
        `canonical ledger entry ${entry.operationId} was appended from an unobserved payload`);
    }

    // A deliberately faulty persister that writes raw bytes first and only
    // then replaces them with redacted bytes passes final-state inspection but
    // must be detected by the same write-boundary observation.
    const faultyTracePath = path.join(fixtureDir, 'faulty-trace.jsonl');
    const faultyTarget = path.join(fixtureDir, 'faulty-run-record.json');
    fs.writeFileSync(faultyTracePath, '');
    const faultyRestore = (() => {
      const original = fs.writeFileSync;
      const append = fs.appendFileSync.bind(fs);
      fs.writeFileSync = (target, data, ...rest) => {
        if (String(target) !== faultyTracePath) {
          append(faultyTracePath, JSON.stringify({ op: 'writeFileSync', target: String(target),
            payload: typeof data === 'string' ? data : '' }) + '\n');
        }
        return original.call(fs, target, data, ...rest);
      };
      return () => { fs.writeFileSync = original; };
    })();
    try {
      fs.writeFileSync(faultyTarget, JSON.stringify({ stdoutTail: `Authorization: Bearer ${bearer}` }));
      fs.writeFileSync(faultyTarget, JSON.stringify({ stdoutTail: 'Authorization: Bearer [REDACTED]' }));
    } finally { faultyRestore(); }
    for (const secret of secrets) {
      assert.ok(!fs.readFileSync(faultyTarget, 'utf8').includes(secret),
        'the faulty fixture must end in a state that final-only inspection would accept');
    }
    const faultyViolations = persistenceSecretViolations(readPersistenceTrace(faultyTracePath), secrets);
    assert.ok(faultyViolations.length >= 1,
      'write-boundary observation failed to detect the raw-first-then-redacted fixture');

    // With the instrument proven, the actual security claim: no raw secret was
    // ever supplied to any run, ledger or evidence write.
    const violations = persistenceSecretViolations(trace, secrets);
    assert.deepStrictEqual(violations, [],
      `raw credentials reached persistence writes: ${JSON.stringify(violations.map(({ op, target }) => ({ op, target })))}`);

    // Every artifact the build created or changed is enumerated — from the
    // observed roots and from every write target the trace recorded, wherever
    // it landed — and its exact final bytes are inspected; nothing is inferred
    // from the run alone.
    const afterArtifacts = walkArtifactDigests(observedRoots);
    const changedArtifacts = new Set([...afterArtifacts.keys()].filter((target) =>
      beforeArtifacts.get(target) !== afterArtifacts.get(target)));
    assert.ok(changedArtifacts.has(runFile), 'artifact enumeration missed the run record');
    assert.ok(changedArtifacts.has(ledgerFile), 'artifact enumeration missed the canonical ledger');
    for (const entry of trace) {
      const targets = entry.op === 'renameSync' ? entry.target.split(' -> ') : [entry.target];
      for (const target of targets) {
        if (target !== tracePath && fs.existsSync(target) && fs.lstatSync(target).isFile()) {
          changedArtifacts.add(target);
        }
      }
    }
    for (const target of changedArtifacts) {
      const bytes = fs.readFileSync(target, 'utf8');
      for (const secret of secrets) {
        assert.ok(!bytes.includes(secret),
          `build artifact ${path.relative(scratch, target)} retained a raw credential`);
      }
    }

    // The durable record stays bounded and redacted after a fresh reload.
    const reloaded = AegisRun.loadRun(runId);
    assert.strictEqual(reloaded.state, 'BUILD_FAILED');
    for (const secret of secrets) {
      assert.ok(!JSON.stringify(reloaded).includes(secret), 'reloaded run state retained a raw credential');
    }
    for (const tail of [reloaded.build.stdoutTail, reloaded.build.stderrTail]) {
      assert.ok(typeof tail === 'string' && tail.includes('[REDACTED]'),
        'reloaded builder evidence lost its redaction markers');
      assert.ok(tail.includes(diagnostic), 'reloaded builder evidence lost the useful diagnostic');
      assert.ok(Buffer.byteLength(tail, 'utf8') <= 12000, 'reloaded builder evidence exceeded its byte bound');
      assert.ok(tail.split('\n').length <= 24, 'reloaded builder evidence exceeded its line bound');
    }
  } finally {
    workerModule.exports = originalWorker;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

try {
  fs.rmSync(scratch, { recursive: true, force: true });
} catch (error) {
  failures.push({ name: 'isolated fixture cleanup', error });
  process.stderr.write(`FAIL isolated fixture cleanup: ${error.message}\n`);
}

if (failures.length) {
  process.stderr.write(`\n${passed} passed, ${failures.length} failed.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`\n${passed}/${passed} passed\n`);
}
