#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'builder-control', 'aegis-run.cjs');
const WORKER = require('../aegis-worker.cjs');
const CONTAINMENT = require('../sandbox-containment.cjs');
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const skip = (reason) => ({ skipped: String(reason || 'not applicable') });
function waitFor(read, pred, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = read();
    if (pred(value)) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
  }
  throw new Error('timed out waiting for worker evidence');
}

// Test-only cleanup for deliberately orphaned fixture groups. Production
// cancellation has no numeric PID/PGID signal authority.
function terminateFixtureGroup(processGroupId, timeoutMs = 2000) {
  if (!WORKER.processGroupAlive(processGroupId)) return;
  try { process.kill(-processGroupId, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  waitFor(() => WORKER.processGroupAlive(processGroupId), (alive) => alive === false, timeoutMs);
}

function writePacketFixture(worktree, packetPath, packet) {
  const source = 'authority-source.txt';
  const dependency = 'authority-check-dependency.cjs';
  const check = 'authority-check.cjs';
  if (!fs.existsSync(path.join(worktree, source))) fs.writeFileSync(path.join(worktree, source), 'canonical\n');
  if (!fs.existsSync(path.join(worktree, dependency))) {
    fs.writeFileSync(path.join(worktree, dependency), "module.exports = 'dependency';\n");
  }
  if (!fs.existsSync(path.join(worktree, check))) {
    fs.writeFileSync(path.join(worktree, check), "require('./authority-check-dependency.cjs');\n");
  }
  fs.writeFileSync(packetPath, JSON.stringify({
    sourceOfTruth: [source], testsRequired: [`node ${check}`], ...packet,
  }));
}

function frozenPacketCoordinate(packetName, packetPath) {
  const bytes = fs.readFileSync(packetPath);
  return {
    path: packetName,
    sha256: crypto.createHash('sha256').update(String(bytes)).digest('hex'),
    packetId: JSON.parse(bytes.toString('utf8')).packetId,
  };
}

function fixture(prompt, extraEnv = {}, timeoutSec = 30, options = {}) {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-test-'));
  const runs = path.join(tmp, 'runs');
  const worktree = path.join(tmp, 'worktree');
  const ledger = path.join(tmp, 'ledger.json');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(runs); fs.mkdirSync(worktree); fs.mkdirSync(bin); fs.writeFileSync(ledger, '[]\n');
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'fixture\n');
  const packetRelative = options.repositoryRelativePacket || null;
  const packetPath = packetRelative ? path.join(worktree, packetRelative) : path.join(worktree, 'packet.json');
  fs.mkdirSync(path.dirname(packetPath), { recursive: true });
  writePacketFixture(worktree, packetPath,
    { packetId: 'PKT-TEST-WORKER', agentId: 'claude-code', filesAllowed: ['allowed.txt'] });
  let canonicalRoot = null;
  if (packetRelative) {
    canonicalRoot = path.join(tmp, 'canonical');
    const canonicalPacket = path.join(canonicalRoot, packetRelative);
    fs.mkdirSync(path.dirname(canonicalPacket), { recursive: true });
    fs.copyFileSync(packetPath, canonicalPacket);
  }
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
'use strict';
const fs = require('fs');
const { spawn } = require('child_process');
if (process.env.FAKE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
if (process.env.FAKE_ENV_FILE) fs.writeFileSync(process.env.FAKE_ENV_FILE, process.env.ANTHROPIC_API_KEY || 'unset');
if (process.env.FAKE_STDIN_FILE) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    fs.writeFileSync(process.env.FAKE_STDIN_FILE, input);
    console.log('ok'); process.exit(0);
  });
  return;
}
if (process.env.FAKE_CLAUDE_MODE === 'fail') { console.log('hello'); console.error('bad'); process.exit(7); }
if (process.env.FAKE_CLAUDE_MODE === 'auth-fail') {
  console.error('Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.');
  process.exit(1);
}
if (process.env.FAKE_CLAUDE_MODE === 'progress') {
  const delay = Number(process.env.FAKE_SLEEP_MS || 800);
  const timer = setInterval(() => console.log('progress'), 75);
  setTimeout(() => { clearInterval(timer); process.exit(0); }, delay);
  return;
}
if (process.env.FAKE_CLAUDE_MODE === 'write-progress') {
  const delay = Number(process.env.FAKE_SLEEP_MS || 2300);
  const timer = setInterval(() => fs.appendFileSync('allowed.txt', 'progress\\n'), 250);
  setTimeout(() => { clearInterval(timer); process.exit(0); }, delay);
  return;
}
if (process.env.FAKE_CLAUDE_MODE === 'tree') {
  process.on('SIGTERM', () => {});
  const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
  if (process.env.FAKE_DESCENDANT_PID_FILE) fs.writeFileSync(process.env.FAKE_DESCENDANT_PID_FILE, String(descendant.pid));
  setInterval(() => {}, 1000);
  return;
}
if (process.env.FAKE_CLAUDE_MODE === 'parent-exits-descendant-survives') {
  const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),10000)"], { stdio: 'ignore' });
  if (process.env.FAKE_DESCENDANT_PID_FILE) fs.writeFileSync(process.env.FAKE_DESCENDANT_PID_FILE, String(descendant.pid));
  process.on('SIGTERM', () => process.exit(143));
  setInterval(() => {}, 1000);
  return;
}
const delay = Number(process.env.FAKE_SLEEP_MS || 0);
if (delay) setTimeout(() => process.exit(0), delay); else { console.log('ok'); process.exit(0); }
`, { mode: 0o755 });

  const runId = 'RUN-20260827-deadbeef';
  const runFile = path.join(runs, `${runId}.json`);
  fs.writeFileSync(runFile, JSON.stringify({
    runId, objective: prompt, state: 'WORKTREE_READY', worktree: { path: worktree },
    packet: packetRelative || packetPath,
    ...(packetRelative ? { packetCoordinate: frozenPacketCoordinate(packetRelative, packetPath) } : {}),
    build: null,
    corrections: 0, transitions: [], updatedAt: new Date().toISOString(),
  }, null, 2));
  const env = {
    ...process.env, NODE_ENV: 'test', AEGIS_TEST_CLAUDE_EXECUTABLE: path.join(bin, 'claude'),
    AEGIS_TEST_CONTAINMENT_MODE: 'DETERMINISTIC_PROFILE_ONLY',
    AEGIS_RUNS_DIR: runs, AEGIS_CHECKPOINTS_DIR: path.join(tmp, 'checkpoints'),
    AEGIS_LEDGER_FILE: ledger,
    ...(canonicalRoot ? { AEGIS_TEST_CANONICAL_ROOT: canonicalRoot } : {}), ...extraEnv,
  };
  const launchSpec = { provider: 'claude-subscription', prompt, model: 'opus' };
  const driver = `const R=require(${JSON.stringify(RUNTIME)}); console.log(JSON.stringify(R.startWorker(${JSON.stringify(runId)}, ${JSON.stringify(launchSpec)}, {timeoutSec:${JSON.stringify(timeoutSec)}})));`;
  const launch = spawnSync('node', ['-e', driver], { cwd: ROOT, env, encoding: 'utf8' });
  assert.strictEqual(launch.status, 0, launch.stderr);
  return { tmp, runs, worktree, ledger, runId, runFile, env, packetPath, canonicalRoot,
    read: () => JSON.parse(fs.readFileSync(runFile, 'utf8')) };
}

function control(f, source) {
  return spawnSync('node', ['-e', `const R=require(${JSON.stringify(RUNTIME)});${source}`],
    { cwd: ROOT, env: f.env, encoding: 'utf8' });
}

function reconcile(f) {
  const result = control(f, `console.log(JSON.stringify(R.reconcileWorkerRun(${JSON.stringify(f.runId)})))`);
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function assertUnsafeRecoveryBlocked(f, expectedWorkerState, expectedRetryCode = 'RECOVERY_UNSAFE') {
  const failed = f.read();
  assert.strictEqual(failed.state, 'BUILD_FAILED');
  assert.strictEqual(failed.build.workerState, expectedWorkerState);
  assert.strictEqual(failed.build.recovery.retrySafe, false);
  assert.strictEqual(failed.build.recovery.terminationVerified, false);
  assert.strictEqual(failed.transitions.filter((t) => t.from === 'BUILDING' && t.to === 'BUILD_FAILED').length, 1);
  const retry = control(f, `try{R.retryRun(${JSON.stringify(f.runId)});process.exit(9)}catch(e){console.log(e.code)}`);
  assert.strictEqual(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, new RegExp(expectedRetryCode));
  const terminationEvidence = JSON.stringify(failed.build.terminationEvidence);
  const cancel = control(f, `console.log(JSON.stringify(R.cancelRun(${JSON.stringify(f.runId)})))`);
  assert.strictEqual(cancel.status, 0, cancel.stderr);
  const cancelResponse = JSON.parse(cancel.stdout.trim().split('\n').pop());
  assert.strictEqual(cancelResponse.state, 'ABANDONED');
  const abandoned = f.read();
  assert.strictEqual(abandoned.state, 'ABANDONED');
  assert.strictEqual(abandoned.build.recovery.terminationVerified, false);
  assert.strictEqual(abandoned.build.recovery.retrySafe, false);
  assert.strictEqual(abandoned.build.recovery.abandonmentAllowed, true);
  assert.strictEqual(abandoned.build.recovery.administrativeResolution.type,
    'ABANDONED_WITHOUT_SIGNAL');
  assert.strictEqual(abandoned.build.recovery.administrativeResolution.signallingAttempted, false);
  assert.strictEqual(JSON.stringify(abandoned.build.terminationEvidence), terminationEvidence);
  assert.strictEqual(abandoned.transitions.filter((t) =>
    t.from === 'BUILD_FAILED' && t.to === 'ABANDONED').length, 1);
  const terminalRetry = control(f,
    `try{R.retryRun(${JSON.stringify(f.runId)});process.exit(9)}catch(e){console.log(e.code)}`);
  assert.strictEqual(terminalRetry.status, 0, terminalRetry.stderr);
  assert.match(terminalRetry.stdout,
    new RegExp(expectedRetryCode === 'LAUNCH_IN_PROGRESS' ? 'LAUNCH_IN_PROGRESS' : 'INVALID_RETRY'));
}

test('async worker returns immediately and records BUILDING process evidence', () => {
  const f = fixture('perform the bounded test task', { FAKE_SLEEP_MS: '500' });
  const run = f.read();
  assert.strictEqual(run.state, 'BUILDING');
  assert.strictEqual(run.build.mode, 'async');
  assert.ok(Number.isInteger(run.build.workerPid));
  assert.strictEqual(run.build.processGroupId, run.build.workerPid);
  const done = waitFor(f.read, (r) => r.state === 'BUILT');
  assert.strictEqual(done.build.exit, 0);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('repository-relative dashboard packet runs from its content-bound isolated worktree copy', () => {
  const relativePacket = 'builder-control/packets/PKT-DASHBOARD-WORKER.json';
  const f = fixture('execute the repository-relative dashboard packet', {}, 30,
    { repositoryRelativePacket: relativePacket });
  const done = waitFor(f.read, (r) => r.state === 'BUILT');
  assert.strictEqual(done.build.exit, 0);
  assert.strictEqual(done.packet, relativePacket);
  assert.strictEqual(done.build.environment.readPaths.includes(relativePacket), true);
  assert.strictEqual(done.build.environment.writePaths.includes(relativePacket), false);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('subscription worker strips a stale ANTHROPIC_API_KEY override', () => {
  const envFile = path.join(fs.realpathSync(os.tmpdir()), `aegis-env-${process.pid}-${Date.now()}.txt`);
  const f = fixture('report authentication route', { ANTHROPIC_API_KEY: 'must-not-leak', FAKE_ENV_FILE: envFile });
  waitFor(f.read, (r) => r.state === 'BUILT');
  assert.strictEqual(fs.readFileSync(envFile, 'utf8'), 'unset');
  assert.strictEqual(f.read().build.environment.anthropicApiKeyOverrideRemoved, true);
  fs.rmSync(envFile, { force: true });
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('anthropic removal telemetry distinguishes model override from API-key removal', () => {
  const f = fixture('report non-secret model override', {
    ANTHROPIC_MODEL: 'stale-model', ANTHROPIC_API_KEY: undefined,
  });
  const done = waitFor(f.read, (r) => r.state === 'BUILT');
  assert.strictEqual(done.build.environment.anthropicOverridesRemoved, true);
  assert.strictEqual(done.build.environment.anthropicApiKeyOverrideRemoved, false);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('worker captures bounded output tails and reaches BUILD_FAILED on non-zero exit', () => {
  const f = fixture('fail this bounded fixture', { FAKE_CLAUDE_MODE: 'fail' });
  const done = waitFor(f.read, (r) => r.state === 'BUILD_FAILED');
  assert.strictEqual(done.build.exit, 7);
  assert.match(done.build.stdoutTail, /hello/);
  assert.match(done.build.stderrTail, /bad/);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('duplicate active launch is refused', () => {
  const f = fixture('remain active for duplicate refusal', { FAKE_SLEEP_MS: '30000' });
  const spec = { provider: 'claude-subscription', prompt: 'second worker', model: 'opus' };
  const driver = `const R=require(${JSON.stringify(RUNTIME)}); try{R.startWorker(${JSON.stringify(f.runId)},${JSON.stringify(spec)});process.exit(9)}catch(e){console.log(e.code)}`;
  const r = spawnSync('node', ['-e', driver], { cwd: ROOT, env: f.env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /ILLEGAL_TRANSITION|WORKER_ALREADY_ACTIVE|LAUNCH_IN_PROGRESS/);
  const cancel = spawnSync('node', ['-e', `const R=require(${JSON.stringify(RUNTIME)}); console.log(JSON.stringify(R.cancelRun(${JSON.stringify(f.runId)})))`], { cwd: ROOT, env: f.env, encoding: 'utf8' });
  assert.strictEqual(cancel.status, 0, cancel.stderr);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('simultaneous cross-run starts admit exactly one worker lifetime', async () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-race-'));
  const runs = path.join(tmp, 'runs');
  const worktree = path.join(tmp, 'worktree');
  const ledger = path.join(tmp, 'ledger.json');
  const executable = path.join(tmp, 'claude');
  fs.mkdirSync(runs); fs.mkdirSync(worktree); fs.writeFileSync(ledger, '[]\n');
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'fixture\n');
  const packetPath = path.join(worktree, 'packet.json');
  writePacketFixture(worktree, packetPath,
    { packetId: 'PKT-TEST-RACE', agentId: 'claude-code', filesAllowed: ['allowed.txt'] });
  fs.writeFileSync(executable,
    `#!${process.execPath}\nsetTimeout(()=>process.exit(0),30000);\n`, { mode: 0o755 });
  const runIds = ['RUN-20260827-deadbeef', 'RUN-20260827-feedface'];
  const runFiles = runIds.map((runId) => path.join(runs, `${runId}.json`));
  for (let index = 0; index < runIds.length; index++) {
    fs.writeFileSync(runFiles[index], JSON.stringify({ runId: runIds[index], state: 'WORKTREE_READY',
      worktree: { path: worktree }, packet: packetPath,
      build: null, corrections: 0, transitions: [] }, null, 2));
  }
  const env = { ...process.env, NODE_ENV: 'test', AEGIS_TEST_CLAUDE_EXECUTABLE: executable,
    AEGIS_TEST_CONTAINMENT_MODE: 'DETERMINISTIC_PROFILE_ONLY',
    AEGIS_RUNS_DIR: runs, AEGIS_CHECKPOINTS_DIR: path.join(tmp, 'checkpoints'), AEGIS_LEDGER_FILE: ledger };
  const spec = { provider: 'claude-subscription', prompt: 'one owner only', model: 'opus' };
  const invoke = (runId) => new Promise((resolve) => {
    const driver = `const R=require(${JSON.stringify(RUNTIME)});try{const x=R.startWorker(${JSON.stringify(runId)},${JSON.stringify(spec)});console.log('STARTED '+x.attemptId)}catch(e){console.log('REFUSED '+e.code)}`;
    const child = spawn('node', ['-e', driver], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (v) => { stdout += v; }); child.stderr.on('data', (v) => { stderr += v; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  let cleanupRequired = true;
  try {
    const results = await Promise.all(runIds.map(invoke));
    assert.strictEqual(results.filter((r) => /STARTED /.test(r.stdout)).length, 1, JSON.stringify(results));
    assert.strictEqual(results.filter((r) => /REFUSED LAUNCH_IN_PROGRESS/.test(r.stdout)).length, 1,
      JSON.stringify(results));
    const runsAfterLaunch = runFiles.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
    const run = runsAfterLaunch.find((candidate) => candidate.state === 'BUILDING');
    assert.ok(run, 'neither cross-run contender owns BUILDING');
    const runFile = runFiles[runIds.indexOf(run.runId)];
    assert.strictEqual(runsAfterLaunch.filter((candidate) => candidate.state === 'BUILDING').length, 1);
    assert.strictEqual(runsAfterLaunch.filter((candidate) => candidate.state === 'WORKTREE_READY').length, 1);
    assert.match(run.build.attemptId, /^[0-9a-f-]{36}$/);
    assert.strictEqual(runsAfterLaunch.flatMap((candidate) => candidate.transitions)
      .filter((t) => t.to === 'BUILDING').length, 1);

    // startWorker returns after the atomic launch claim is published. The
    // worker publishes its authenticated cancellation mailbox and verified
    // child identity asynchronously, so cleanup must wait for that canonical
    // RUNNING evidence rather than racing cancelRun's fail-closed guard.
    let running;
    try {
      running = waitFor(() => JSON.parse(fs.readFileSync(runFile, 'utf8')),
        (candidate) => candidate.state === 'BUILDING' && candidate.build &&
          candidate.build.workerState === 'RUNNING' && candidate.build.control &&
          candidate.build.childProcessIdentity);
    } catch (error) {
      throw new Error(`${error.message}; latest=${fs.readFileSync(runFile, 'utf8')}`);
    }
    assert.strictEqual(running.build.attemptId, run.build.attemptId);
    assert.strictEqual(running.build.childProcessIdentity.processGroupId,
      running.build.childProcessGroupId);

    const cancel = spawnSync('node', ['-e', `require(${JSON.stringify(RUNTIME)}).cancelRun(${JSON.stringify(run.runId)})`],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.strictEqual(cancel.status, 0, cancel.stderr);
    const abandoned = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.strictEqual(abandoned.state, 'ABANDONED');
    assert.strictEqual(abandoned.build.cancellation.status, 'TERMINATED');
    assert.strictEqual(abandoned.transitions.filter((t) => t.to === 'BUILDING').length, 1);
    cleanupRequired = false;
  } finally {
    if (cleanupRequired) {
      for (const runFile of runFiles) {
        if (!fs.existsSync(runFile)) continue;
        const latest = JSON.parse(fs.readFileSync(runFile, 'utf8'));
        const groups = [latest.build && latest.build.childProcessGroupId,
          latest.build && latest.build.processGroupId]
          .filter((value, index, values) => Number.isInteger(value) && values.indexOf(value) === index);
        for (const processGroupId of groups) terminateFixtureGroup(processGroupId, 2000);
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bootstrap failure reaches BUILD_FAILED with bounded evidence and no live worker', () => {
  const missing = path.join(fs.realpathSync(os.tmpdir()), `missing-claude-${process.pid}-${Date.now()}`);
  const f = fixture('exercise bootstrap failure', { AEGIS_TEST_CLAUDE_EXECUTABLE: missing });
  const failed = waitFor(f.read, (r) => r.state === 'BUILD_FAILED');
  assert.strictEqual(failed.build.workerState, 'BOOTSTRAP_FAILED');
  assert.strictEqual(failed.build.bootstrapFailure, true);
  assert.strictEqual(failed.build.exit, 127);
  assert.ok(failed.build.stderrTail.length > 0 && failed.build.stderrTail.length <= 12000);
  waitFor(() => WORKER.processAlive(failed.build.workerPid), (alive) => alive === false);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('post-spawn process identity failure drains the owned child group before BUILD_FAILED', () => {
  const f = fixture('exercise post-spawn identity failure', {
    FAKE_SLEEP_MS: '30000', FAKE_PROCESS_IDENTITY_FAILURE: '1',
  });
  const failed = waitFor(f.read, (r) => r.state === 'BUILD_FAILED', 6000);
  assert.strictEqual(failed.build.workerState, 'BOOTSTRAP_FAILED');
  assert.strictEqual(failed.build.bootstrapFailure, true);
  assert.match(failed.build.stderrTail, /process identity failure/);
  assert.strictEqual(failed.build.terminationEvidence.terminated, true);
  assert.strictEqual(failed.build.terminationEvidence.childCloseObserved, true);
  assert.strictEqual(failed.build.terminationEvidence.processGroupDrained, true);
  assert.strictEqual(failed.build.recovery, undefined);
  waitFor(() => WORKER.processGroupAlive(failed.build.terminationEvidence.processGroupId),
    (alive) => alive === false, 2000);
  assert.strictEqual(WORKER.processGroupAlive(failed.build.terminationEvidence.processGroupId), false);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('post-spawn initial attempt update failure drains the owned child group before BUILD_FAILED', () => {
  const f = fixture('exercise initial attempt update failure', {
    FAKE_SLEEP_MS: '30000', FAKE_INITIAL_UPDATE_FAILURE: '1',
  });
  const failed = waitFor(f.read, (r) => r.state === 'BUILD_FAILED', 6000);
  assert.strictEqual(failed.build.workerState, 'BOOTSTRAP_FAILED');
  assert.strictEqual(failed.build.bootstrapFailure, true);
  assert.match(failed.build.stderrTail, /initial worker-attempt update failure/);
  assert.strictEqual(failed.build.terminationEvidence.terminated, true);
  assert.strictEqual(failed.build.terminationEvidence.childCloseObserved, true);
  assert.strictEqual(failed.build.terminationEvidence.processGroupDrained, true);
  assert.strictEqual(failed.build.recovery, undefined);
  waitFor(() => WORKER.processGroupAlive(failed.build.terminationEvidence.processGroupId),
    (alive) => alive === false, 2000);
  assert.strictEqual(WORKER.processGroupAlive(failed.build.terminationEvidence.processGroupId), false);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('SIGKILL during STARTING reconciles once to unsafe BUILD_FAILED and remains abandonable', () => {
  const f = fixture('hold before child spawn', { FAKE_WORKER_PRE_CHILD_MS: '5000' });
  const starting = waitFor(f.read, (r) => r.state === 'BUILDING' && r.build.workerState === 'STARTING');
  process.kill(starting.build.workerPid, 'SIGKILL');
  waitFor(() => WORKER.processAlive(starting.build.workerPid), (alive) => alive === false, 5000);
  const outcome = reconcile(f);
  assert.strictEqual(outcome.reason, 'ORPHANED');
  assertUnsafeRecoveryBlocked(f, 'ORPHANED');
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('SIGKILL during RUNNING never signals the unverified child and blocks retry', () => {
  const f = fixture('leave child running after supervisor death', { FAKE_SLEEP_MS: '30000' });
  const running = waitFor(f.read, (r) => r.state === 'BUILDING' && r.build.workerState === 'RUNNING');
  const childGroup = running.build.childProcessGroupId;
  process.kill(running.build.workerPid, 'SIGKILL');
  waitFor(() => WORKER.processAlive(running.build.workerPid), (alive) => alive === false, 5000);
  reconcile(f);
  assert.strictEqual(WORKER.processGroupAlive(childGroup), true,
    'reconciliation must not signal an unverified child process group');
  const blockedAdmission = control(f,
    `try{R.acquireGlobalWorkerClaim(0);console.log('ACQUIRED')}catch(e){console.log(e.code)}`);
  assert.strictEqual(blockedAdmission.status, 0, blockedAdmission.stderr);
  assert.match(blockedAdmission.stdout, /LAUNCH_IN_PROGRESS/,
    'wrapper death admitted another worker while its child process group remained live');
  assertUnsafeRecoveryBlocked(f, 'ORPHANED', 'LAUNCH_IN_PROGRESS');
  terminateFixtureGroup(childGroup, 2000);
  waitFor(() => WORKER.processGroupAlive(childGroup), (alive) => alive === false, 3000);
  const reclaimed = control(f,
    `const lease=R.acquireGlobalWorkerClaim(1000);const released=R.releaseRunLaunchClaim(lease);console.log(JSON.stringify({released,lockExists:require('fs').existsSync(R.globalWorkerLockPath())}))`);
  assert.strictEqual(reclaimed.status, 0, reclaimed.stderr);
  assert.deepStrictEqual(JSON.parse(reclaimed.stdout.trim().split('\n').pop()),
    { released: true, lockExists: false },
    'terminal global lease was not reclaimable after complete process-group drain');
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('a live worker remains BUILDING even when its heartbeat snapshot is stale', () => {
  const f = fixture('stay live through stale heartbeat observation', { FAKE_SLEEP_MS: '30000' });
  const running = waitFor(f.read, (r) => r.state === 'BUILDING' && r.build.workerState === 'RUNNING');
  const stale = f.read();
  stale.build.heartbeatAt = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(f.runFile, JSON.stringify(stale, null, 2));
  const outcome = reconcile(f);
  assert.strictEqual(outcome.action, 'ACTIVE');
  assert.strictEqual(f.read().state, 'BUILDING');
  const cancel = control(f, `R.cancelRun(${JSON.stringify(f.runId)})`);
  assert.strictEqual(cancel.status, 0, cancel.stderr);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('timeout with unverified termination transitions directly to unsafe BUILD_FAILED', () => {
  const startedAt = Date.now();
  const f = fixture('force unverified timeout evidence', {
    FAKE_SLEEP_MS: '30000', FAKE_UNVERIFIED_TIMEOUT: '1', FAKE_NEVER_CLOSE: '1',
  }, 1);
  const failed = waitFor(f.read, (r) => r.state === 'BUILD_FAILED', 6000);
  assert.ok(Date.now() - startedAt < 5000, `unverified timeout exceeded wall-clock bound: ${Date.now() - startedAt}ms`);
  assert.strictEqual(failed.build.workerState, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(failed.build.timeoutTerminationEvidence.childCloseObserved, false);
  const childGroup = failed.build.childProcessGroupId;
  assertUnsafeRecoveryBlocked(f, 'TERMINATION_UNVERIFIED', 'LAUNCH_IN_PROGRESS');
  terminateFixtureGroup(childGroup, 2000);
  waitFor(() => WORKER.processGroupAlive(childGroup), (alive) => alive === false, 3000);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('two reconcilers racing an orphan record exactly one BUILD_FAILED transition', async () => {
  const f = fixture('race orphan reconciliation', { FAKE_WORKER_PRE_CHILD_MS: '5000' });
  const starting = waitFor(f.read, (r) => r.state === 'BUILDING' && r.build.workerState === 'STARTING');
  process.kill(starting.build.workerPid, 'SIGKILL');
  waitFor(() => WORKER.processAlive(starting.build.workerPid), (alive) => alive === false, 5000);
  const source = `try{console.log(JSON.stringify(R.reconcileWorkerRun(${JSON.stringify(f.runId)})))}catch(e){console.log(JSON.stringify({code:e.code}))}`;
  const invoke = () => new Promise((resolve) => {
    const child = spawn('node', ['-e', `const R=require(${JSON.stringify(RUNTIME)});${source}`],
      { cwd: ROOT, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (v) => { stdout += v; });
    child.stderr.on('data', (v) => { stderr += v; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all([invoke(), invoke()]);
  assert.ok(results.every((r) => r.status === 0), JSON.stringify(results));
  const failed = f.read();
  assert.strictEqual(failed.state, 'BUILD_FAILED');
  assert.strictEqual(failed.transitions.filter((t) => t.from === 'BUILDING' && t.to === 'BUILD_FAILED').length, 1);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('corrupt worker payload uses immutable argv ownership to record BUILD_FAILED', () => {
  const f = fixture('payload must fail truthfully', { FAKE_CORRUPT_WORKER_PAYLOAD: '1' });
  const failed = waitFor(f.read, (r) => r.state === 'BUILD_FAILED');
  assert.strictEqual(failed.build.workerState, 'BOOTSTRAP_FAILED');
  assert.strictEqual(failed.build.bootstrapFailure, true);
  assert.match(failed.build.stderrTail, /JSON|Unexpected|position/i);
  waitFor(() => WORKER.processAlive(failed.build.workerPid), (alive) => alive === false);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('tampered launch payload fails binding before Claude starts', () => {
  const argsFile = path.join(fs.realpathSync(os.tmpdir()), `aegis-tamper-args-${process.pid}-${Date.now()}.json`);
  const f = fixture('immutable governed prompt', {
    FAKE_TAMPER_WORKER_PAYLOAD: '1', FAKE_ARGS_FILE: argsFile,
  });
  const failed = waitFor(f.read, (r) => r.state === 'BUILD_FAILED');
  assert.strictEqual(failed.build.bootstrapFailure, true);
  assert.match(failed.build.stderrTail, /launchSpec does not match its canonical launch record/);
  assert.strictEqual(failed.build.childPid, undefined);
  assert.strictEqual(fs.existsSync(argsFile), false, 'Claude fixture started after payload tamper');
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('invalid worker payload identities fail the immutable owned attempt without touching another run', () => {
  for (const mode of ['empty', 'missing', 'wrong', 'wrong-type']) {
    const f = fixture(`reject ${mode} payload identity`, { FAKE_PAYLOAD_IDENTITY_MODE: mode });
    const failed = waitFor(f.read, (r) => r.state === 'BUILD_FAILED');
    assert.strictEqual(failed.runId, f.runId);
    assert.strictEqual(failed.build.workerState, 'BOOTSTRAP_FAILED');
    assert.strictEqual(failed.build.bootstrapFailure, true);
    assert.strictEqual(failed.build.childPid, undefined);
    assert.strictEqual(failed.transitions.filter((t) => t.to === 'BUILD_FAILED').length, 1);
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('launch binding rejects canonical run-record tamper', () => {
  const launchSpec = { provider: 'claude-subscription', prompt: 'approved', model: 'opus' };
  const digest = WORKER.launchDigest(launchSpec);
  const payload = { launchSpec, launchSha256: digest };
  const run = { build: { launchSpec, launchSha256: digest } };
  assert.deepStrictEqual(WORKER.assertLaunchBinding(payload, run), WORKER.normalizeLaunchSpec(launchSpec));
  const changed = { ...launchSpec, model: 'sonnet' };
  assert.throws(() => WORKER.assertLaunchBinding(payload, {
    build: { launchSpec: changed, launchSha256: WORKER.launchDigest(changed) },
  }), /does not match its canonical launch record/);
});

test('authorized write digest detects an applied file change without exposing file contents', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-write-proof-'));
  const target = path.join(tmp, 'dashboard.txt');
  const missing = WORKER.authorizedWriteDigest([target]);
  fs.writeFileSync(target, 'first bounded change');
  const created = WORKER.authorizedWriteDigest([target]);
  fs.writeFileSync(target, 'second bounded change');
  const edited = WORKER.authorizedWriteDigest([target]);
  assert.notStrictEqual(created, missing, 'creating an authorized file was not detected');
  assert.notStrictEqual(edited, created, 'editing an authorized file was not detected');
  assert.match(edited, /^[0-9a-f]{64}$/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('stale attempt token cannot update or terminate the current attempt', () => {
  const f = fixture('preserve current attempt ownership', { FAKE_SLEEP_MS: '30000' });
  const active = waitFor(f.read, (r) => r.build && r.build.workerState === 'RUNNING');
  const before = JSON.stringify(active.build);
  const driver = `const R=require(${JSON.stringify(RUNTIME)});try{R.updateWorkerAttempt(${JSON.stringify(f.runId)},'00000000-0000-4000-8000-000000000000',${active.build.workerPid},{workerState:'FAILED'});process.exit(9)}catch(e){console.log(e.code)}`;
  const stale = spawnSync('node', ['-e', driver], { cwd: ROOT, env: f.env, encoding: 'utf8' });
  assert.strictEqual(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /STALE-WORKER-ATTEMPT/);
  assert.strictEqual(JSON.stringify(f.read().build), before);
  const cancel = spawnSync('node', ['-e', `require(${JSON.stringify(RUNTIME)}).cancelRun(${JSON.stringify(f.runId)})`],
    { cwd: ROOT, env: f.env, encoding: 'utf8' });
  assert.strictEqual(cancel.status, 0, cancel.stderr);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('atomic run replacement stays parseable during heartbeat writes', () => {
  const f = fixture('exercise atomic record replacement', { FAKE_SLEEP_MS: '1200' });
  for (let i = 0; i < 400; i++) JSON.parse(fs.readFileSync(f.runFile, 'utf8'));
  waitFor(f.read, (r) => r.state === 'BUILT');
  assert.strictEqual(fs.readdirSync(f.runs).some((name) => name.endsWith('.tmp')), false);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('packet allowlists permit an exact new leaf for write but not read', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-new-leaf-'));
  const worktree = path.join(tmp, 'worktree');
  const approvedParent = path.join(worktree, 'approved');
  fs.mkdirSync(worktree); fs.mkdirSync(approvedParent);
  fs.writeFileSync(path.join(approvedParent, 'existing.txt'), 'existing\n');
  const packetPath = path.join(worktree, 'packet.json');
  writePacketFixture(worktree, packetPath, {
    packetId: 'PKT-NEW-LEAF', agentId: 'claude-code',
    filesAllowed: ['approved/new.txt', 'approved/existing.txt'],
  });
  const priorNodeEnv = process.env.NODE_ENV;
  const priorMode = process.env.AEGIS_TEST_CONTAINMENT_MODE;
  process.env.NODE_ENV = 'test';
  process.env.AEGIS_TEST_CONTAINMENT_MODE = 'DETERMINISTIC_PROFILE_ONLY';
  try {
    const allowed = WORKER.derivePacketAllowlists(
      { packet: packetPath, worktree: { path: worktree } }, worktree);
    assert.deepStrictEqual(allowed.readPaths, [
      'approved/existing.txt', 'authority-check-dependency.cjs', 'authority-check.cjs',
      'authority-source.txt', 'packet.json',
    ]);
    assert.deepStrictEqual(allowed.writePaths, ['approved/existing.txt', 'approved/new.txt']);
    assert.strictEqual(fs.existsSync(path.join(approvedParent, 'new.txt')), false,
      'allowlist derivation must not create the approved leaf');
    const executable = '/usr/bin/touch';
    const prepared = WORKER.prepareRunContainment(
      { packet: packetPath, worktree: { path: worktree } }, executable, {});
    const newLeaf = path.join(approvedParent, 'new.txt');
    assert.strictEqual(fs.existsSync(newLeaf), false,
      'containment preparation must not create the approved leaf');
    assert.ok(prepared.profile.profile.includes(`(allow file-write* (literal "${newLeaf}"))`));
    assert.ok(!prepared.profile.profile.includes(`(allow file-write* (subpath "${approvedParent}"))`));
    assert.ok(!prepared.profile.profile.includes(`(allow file-write* (subpath "${newLeaf}"))`));

    const capability = CONTAINMENT.sandboxCapability();
    if (capability.available) {
      const invoke = (target) => spawnSync(prepared.command.bin,
        [...prepared.command.argv, target], { encoding: 'utf8' });
      assert.strictEqual(invoke(newLeaf).status, 0, 'exact absent leaf must be creatable');
      const sibling = path.join(approvedParent, 'sibling.txt');
      assert.notStrictEqual(invoke(sibling).status, 0, 'sibling creation must be denied');
      assert.strictEqual(fs.existsSync(sibling), false);
    }
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    if (priorMode === undefined) delete process.env.AEGIS_TEST_CONTAINMENT_MODE;
    else process.env.AEGIS_TEST_CONTAINMENT_MODE = priorMode;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('packet * and ** globs resolve once to exact existing files without broad write authority', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-globs-'));
  const worktree = path.join(tmp, 'worktree');
  fs.mkdirSync(path.join(worktree, 'approved', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(worktree, 'denied'));
  fs.writeFileSync(path.join(worktree, 'approved', 'one.txt'), 'one\n');
  fs.writeFileSync(path.join(worktree, 'approved', 'two.js'), 'two\n');
  fs.writeFileSync(path.join(worktree, 'approved', 'nested', 'three.txt'), 'three\n');
  fs.writeFileSync(path.join(worktree, 'denied', 'outside.txt'), 'outside\n');
  const packetPath = path.join(worktree, 'packet.json');
  writePacketFixture(worktree, packetPath, {
    packetId: 'PKT-GLOB-EXACT-EXPANSION', agentId: 'claude-code',
    filesAllowed: ['approved/*.txt', 'approved/**/*.txt', 'approved/two.js'],
  });
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const allowed = WORKER.derivePacketAllowlists(
      { packet: packetPath, worktree: { path: worktree } }, worktree);
    assert.deepStrictEqual(allowed.writePaths, [
      'approved/nested/three.txt', 'approved/one.txt', 'approved/two.js',
    ]);
    assert.ok(!allowed.writePaths.includes('denied/outside.txt'));
    assert.ok(!allowed.writePaths.includes('approved/new.txt'), 'a glob must not grant unbounded new-leaf creation');
    const profile = CONTAINMENT.buildMacSandboxProfile({
      root: worktree, executable: '/usr/bin/touch',
      readPaths: allowed.readPaths.map((p) => path.join(worktree, p)),
      writePaths: allowed.writePaths.map((p) => path.join(worktree, p)),
    });
    assert.ok(profile.profile.includes(`(allow file-write* (literal "${path.join(worktree, 'approved', 'one.txt')}"))`));
    assert.ok(!profile.profile.includes(`(allow file-write* (subpath "${path.join(worktree, 'approved')}"))`));
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('packet glob authority rejects traversal, unsupported operators, symlinks, and empty matches', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-glob-deny-'));
  const worktree = path.join(tmp, 'worktree');
  fs.mkdirSync(path.join(worktree, 'approved'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'approved', 'one.txt'), 'one\n');
  fs.symlinkSync(path.join(worktree, 'approved', 'one.txt'), path.join(worktree, 'approved', 'link.txt'));
  const packetPath = path.join(worktree, 'packet.json');
  const run = { packet: packetPath, worktree: { path: worktree } };
  const check = (pattern, expected) => {
    writePacketFixture(worktree, packetPath, {
      packetId: 'PKT-GLOB-DENY', agentId: 'claude-code', filesAllowed: [pattern],
    });
    assert.throws(() => WORKER.derivePacketAllowlists(run, worktree), expected);
  };
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    check('../*.txt', /supported worktree-relative/);
    check('approved/?.txt', /supported worktree-relative/);
    check('approved/link*', /symbolic link/);
    check('approved/*.missing', /matched no existing regular files/);
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('packet write authority permits only exact atomic temp replacement leaves', () => {
  const capability = CONTAINMENT.sandboxCapability();
  if (!capability.available) return skip(`host sandbox unavailable: ${capability.reason || 'unknown reason'}`);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-atomic-write-'));
  const worktree = path.join(tmp, 'worktree');
  fs.mkdirSync(worktree);
  const allowed = path.join(worktree, 'allowed.txt');
  const unrelated = path.join(worktree, 'unrelated.txt');
  fs.writeFileSync(allowed, 'before\n');
  fs.writeFileSync(unrelated, 'unrelated\n');
  const profile = CONTAINMENT.buildMacSandboxProfile({
    root: worktree,
    executable: '/bin/sh',
    readPaths: [allowed],
    writePaths: [allowed],
    allowNetwork: false,
  });
  const containedCommand = CONTAINMENT.sandboxedCommand(profile);
  const invoke = (script, ...args) => spawnSync(profile.bin,
    [...containedCommand.argv, '-c', script, 'aegis-atomic-test', ...args],
    { encoding: 'utf8' });
  const atomicTemp = `${allowed}.tmp.${process.pid}.aB_09-safe`;
  const replace = invoke('printf "after\\n" > "$1" && /bin/mv "$1" "$2"', atomicTemp, allowed);
  assert.strictEqual(replace.status, 0,
    `authorized atomic replacement failed: ${replace.stderr || replace.signal || replace.status}`);
  assert.strictEqual(fs.readFileSync(allowed, 'utf8'), 'after\n');
  assert.strictEqual(fs.existsSync(atomicTemp), false);

  const directSibling = invoke('printf "denied\\n" > "$1"', unrelated);
  assert.notStrictEqual(directSibling.status, 0, 'unrelated sibling write must be denied');
  assert.strictEqual(fs.readFileSync(unrelated, 'utf8'), 'unrelated\n');
  const unrelatedTemp = `${unrelated}.tmp.${process.pid}.aB_09-safe`;
  const tempSibling = invoke('printf "denied\\n" > "$1"', unrelatedTemp);
  assert.notStrictEqual(tempSibling.status, 0, 'unrelated atomic-temp sibling must be denied');
  assert.strictEqual(fs.existsSync(unrelatedTemp), false);
  const malformedTemp = `${allowed}.tmp.not-a-pid.aB_09-safe`;
  const malformed = invoke('printf "denied\\n" > "$1"', malformedTemp);
  assert.notStrictEqual(malformed.status, 0, 'noncanonical temp leaf must be denied');
  assert.strictEqual(fs.existsSync(malformedTemp), false);
  assert.ok(!profile.profile.includes(`(allow file-write* (subpath "${worktree}"))`));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('packet new-leaf authority rejects a symlinked parent escape', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-leaf-escape-'));
  const worktree = path.join(tmp, 'worktree');
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(worktree); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(worktree, 'escape-parent'));
  const packetPath = path.join(worktree, 'packet.json');
  writePacketFixture(worktree, packetPath, {
    packetId: 'PKT-NEW-LEAF-ESCAPE', agentId: 'claude-code',
    filesAllowed: ['escape-parent/new.txt'],
  });
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    assert.throws(() => WORKER.prepareRunContainment(
      { packet: packetPath, worktree: { path: worktree } }, '/usr/bin/touch', {}),
    /parent escapes the isolated worktree|escapes containment root/);
    assert.strictEqual(fs.existsSync(path.join(outside, 'new.txt')), false);
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('repository-relative packet rejects a changed or symlinked worktree copy', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-packet-binding-'));
  const canonicalRoot = path.join(tmp, 'canonical');
  const worktree = path.join(tmp, 'worktree');
  const relativePacket = 'builder-control/packets/PKT-DASHBOARD-BINDING.json';
  const canonicalPacket = path.join(canonicalRoot, relativePacket);
  const worktreePacket = path.join(worktree, relativePacket);
  fs.mkdirSync(path.dirname(canonicalPacket), { recursive: true });
  fs.mkdirSync(path.dirname(worktreePacket), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'allowed\n');
  writePacketFixture(worktree, worktreePacket,
    { packetId: 'PKT-DASHBOARD-BINDING', agentId: 'claude-code', filesAllowed: ['allowed.txt'] });
  fs.copyFileSync(worktreePacket, canonicalPacket);
  const run = { packet: relativePacket,
    packetCoordinate: frozenPacketCoordinate(relativePacket, worktreePacket),
    worktree: { path: worktree } };
  const priorNodeEnv = process.env.NODE_ENV;
  const priorCanonicalRoot = process.env.AEGIS_TEST_CANONICAL_ROOT;
  process.env.NODE_ENV = 'test'; process.env.AEGIS_TEST_CANONICAL_ROOT = canonicalRoot;
  try {
    assert.strictEqual(WORKER.derivePacketAllowlists(run, worktree).packetId, 'PKT-DASHBOARD-BINDING');
    fs.appendFileSync(worktreePacket, '\n');
    assert.throws(() => WORKER.derivePacketAllowlists(run, worktree), /digest does not match canonical/);
    fs.copyFileSync(canonicalPacket, worktreePacket);
    const target = path.join(tmp, 'packet-copy.json');
    fs.copyFileSync(canonicalPacket, target);
    fs.unlinkSync(worktreePacket);
    fs.symlinkSync(target, worktreePacket);
    assert.throws(() => WORKER.derivePacketAllowlists(run, worktree), /may not be a symbolic link/);
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    if (priorCanonicalRoot === undefined) delete process.env.AEGIS_TEST_CANONICAL_ROOT;
    else process.env.AEGIS_TEST_CANONICAL_ROOT = priorCanonicalRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detached worker refuses a replacement packet even when canonical and worktree copies agree', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-packet-freeze-'));
  const canonicalRoot = path.join(tmp, 'canonical');
  const worktree = path.join(tmp, 'worktree');
  const relativePacket = 'builder-control/packets/PKT-PACKET-FREEZE.json';
  const canonicalPacket = path.join(canonicalRoot, relativePacket);
  const worktreePacket = path.join(worktree, relativePacket);
  fs.mkdirSync(path.dirname(canonicalPacket), { recursive: true });
  fs.mkdirSync(path.dirname(worktreePacket), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'allowed-a.txt'), 'a\n');
  fs.writeFileSync(path.join(worktree, 'allowed-b.txt'), 'b\n');
  writePacketFixture(worktree, worktreePacket, {
    packetId: 'PKT-PACKET-FREEZE', agentId: 'claude-code', filesAllowed: ['allowed-a.txt'],
  });
  fs.copyFileSync(worktreePacket, canonicalPacket);
  const run = { packet: relativePacket,
    packetCoordinate: frozenPacketCoordinate(relativePacket, worktreePacket),
    worktree: { path: worktree } };
  const priorNodeEnv = process.env.NODE_ENV;
  const priorCanonicalRoot = process.env.AEGIS_TEST_CANONICAL_ROOT;
  process.env.NODE_ENV = 'test'; process.env.AEGIS_TEST_CANONICAL_ROOT = canonicalRoot;
  try {
    assert.deepStrictEqual(WORKER.derivePacketAllowlists(run, worktree).writePaths, ['allowed-a.txt']);
    writePacketFixture(worktree, worktreePacket, {
      packetId: 'PKT-PACKET-FREEZE', agentId: 'claude-code',
      filesAllowed: ['allowed-a.txt', 'allowed-b.txt'],
    });
    fs.copyFileSync(worktreePacket, canonicalPacket);
    assert.throws(() => WORKER.derivePacketAllowlists(run, worktree),
      /changed after objective intake/);
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    if (priorCanonicalRoot === undefined) delete process.env.AEGIS_TEST_CANONICAL_ROOT;
    else process.env.AEGIS_TEST_CANONICAL_ROOT = priorCanonicalRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('packet allowlists are exact, worktree-scoped, and reject unsafe leaves', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-paths-'));
  const worktree = path.join(tmp, 'worktree');
  const sibling = path.join(tmp, 'sibling');
  const approvedDir = path.join(worktree, 'approved-dir');
  fs.mkdirSync(worktree); fs.mkdirSync(sibling); fs.mkdirSync(approvedDir);
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'allowed\n');
  fs.writeFileSync(path.join(worktree, 'unauthorized-sibling.txt'), 'sibling\n');
  fs.writeFileSync(path.join(sibling, 'outside.txt'), 'outside\n');
  fs.symlinkSync(path.join(sibling, 'outside.txt'), path.join(worktree, 'escape-link'));
  fs.symlinkSync(sibling, path.join(worktree, 'escape-parent'));
  const packetPath = path.join(worktree, 'packet.json');
  const run = { packet: packetPath, worktree: { path: worktree } };
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const writePacket = (filesAllowed) => writePacketFixture(worktree, packetPath,
      { packetId: 'PKT-PATHS', agentId: 'claude-code', filesAllowed });
    writePacket(['allowed.txt']);
    const allowed = WORKER.derivePacketAllowlists(run, worktree);
    assert.deepStrictEqual(allowed.readPaths, [
      'allowed.txt', 'authority-check-dependency.cjs', 'authority-check.cjs',
      'authority-source.txt', 'packet.json',
    ]);
    assert.deepStrictEqual(allowed.writePaths, ['allowed.txt']);
    assert.strictEqual(allowed.readPaths.includes('unauthorized-sibling.txt'), false);
    assert.strictEqual(allowed.writePaths.includes('unauthorized-sibling.txt'), false);
    for (const rejected of [
      ['missing-parent/new.txt'], ['../sibling/outside.txt'], [path.join(os.homedir(), '.ssh')],
      ['escape-link'], ['escape-parent/new.txt'], ['approved-dir'], ['allowed/../unauthorized-sibling.txt'],
    ]) {
      writePacket(rejected);
      assert.throws(() => WORKER.derivePacketAllowlists(run, worktree),
        /missing|escapes|exact worktree-relative|must be a file or an exact new leaf/);
    }
    assert.throws(() => WORKER.derivePacketAllowlists({ packet: null, worktree: { path: worktree } }, worktree),
      /no approved packet/);
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('deterministic containment argv grants only packet paths and denies default', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-profile-'));
  const worktree = path.join(tmp, 'worktree');
  const sibling = path.join(tmp, 'sibling');
  fs.mkdirSync(worktree); fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'allowed\n');
  const executable = path.join(tmp, 'claude-fixture');
  fs.copyFileSync(WORKER.CLAUDE_EXECUTABLE, executable); fs.chmodSync(executable, 0o755);
  const packetPath = path.join(worktree, 'packet.json');
  writePacketFixture(worktree, packetPath,
    { packetId: 'PKT-PROFILE', agentId: 'claude-code', filesAllowed: ['allowed.txt'] });
  const priorNodeEnv = process.env.NODE_ENV;
  const priorMode = process.env.AEGIS_TEST_CONTAINMENT_MODE;
  process.env.NODE_ENV = 'test'; process.env.AEGIS_TEST_CONTAINMENT_MODE = 'DETERMINISTIC_PROFILE_ONLY';
  try {
    const prepared = WORKER.prepareRunContainment({ packet: packetPath, worktree: { path: worktree } },
      executable, { LANG: 'C' });
    const profile = prepared.profile.profile;
    assert.match(profile, /\(deny default\)/);
    assert.match(profile, new RegExp(path.join(worktree, 'allowed.txt').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const expectedRead of ['packet.json', 'authority-source.txt', 'authority-check.cjs', 'authority-check-dependency.cjs']) {
      assert.match(profile, new RegExp(path.join(worktree, expectedRead).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.strictEqual(prepared.allowlists.writePaths.includes(expectedRead), false);
    }
    assert.ok(!profile.includes(`(subpath "${sibling}")`));
    assert.ok(!profile.includes(`(subpath "${os.homedir()}")`));
    assert.ok(!profile.includes(`(subpath "${ROOT}")`));
    assert.strictEqual(prepared.command.bin, CONTAINMENT.SANDBOX_EXEC);
    assert.deepStrictEqual(prepared.command.argv.slice(0, 2), ['-p', profile]);
    assert.strictEqual(prepared.command.argv[2], fs.realpathSync(executable));
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    if (priorMode === undefined) delete process.env.AEGIS_TEST_CONTAINMENT_MODE; else process.env.AEGIS_TEST_CONTAINMENT_MODE = priorMode;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('contained check authority reads packet, specification and dependency but writes only filesAllowed', () => {
  const capability = CONTAINMENT.sandboxCapability();
  if (!capability.available) return skip(`host sandbox unavailable: ${capability.reason || 'unknown reason'}`);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-authority-'));
  const worktree = path.join(tmp, 'worktree');
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'allowed\n');
  fs.writeFileSync(path.join(worktree, 'unrelated.txt'), 'unrelated\n');
  const packetPath = path.join(worktree, 'packet.json');
  writePacketFixture(worktree, packetPath,
    { packetId: 'PKT-AUTHORITY', agentId: 'claude-code', filesAllowed: ['allowed.txt'] });
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const authority = WORKER.derivePacketAllowlists(
      { packet: packetPath, worktree: { path: worktree } }, worktree);
    const absoluteReads = authority.readPaths.map((value) => path.join(worktree, value));
    const absoluteWrites = authority.writePaths.map((value) => path.join(worktree, value));
    const readProfile = CONTAINMENT.buildMacSandboxProfile({
      root: worktree, executable: '/bin/cat', readPaths: absoluteReads, writePaths: absoluteWrites,
    });
    const read = (target) => spawnSync(readProfile.bin,
      [...CONTAINMENT.sandboxedCommand(readProfile).argv, target], { encoding: 'utf8' });
    const authorizedReads = ['packet.json', 'authority-source.txt', 'authority-check.cjs',
      'authority-check-dependency.cjs', 'allowed.txt'];
    const first = read(path.join(worktree, authorizedReads[0]));
    assert.strictEqual(first.status, 0,
      `authorized packet read failed despite available sandbox: ${first.stderr || first.signal || first.status}`);
    for (const relative of authorizedReads) assert.strictEqual(read(path.join(worktree, relative)).status, 0, relative);
    assert.notStrictEqual(read(path.join(worktree, 'unrelated.txt')).status, 0);

    const writeProfile = CONTAINMENT.buildMacSandboxProfile({
      root: worktree, executable: '/usr/bin/touch', readPaths: absoluteReads, writePaths: absoluteWrites,
    });
    const write = (target) => spawnSync(writeProfile.bin,
      [...CONTAINMENT.sandboxedCommand(writeProfile).argv, target], { encoding: 'utf8' });
    assert.strictEqual(write(path.join(worktree, 'allowed.txt')).status, 0);
    for (const denied of ['packet.json', 'authority-source.txt', 'authority-check.cjs',
      'authority-check-dependency.cjs', 'unrelated.txt']) {
      assert.notStrictEqual(write(path.join(worktree, denied)).status, 0, denied);
    }
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('packet authority rejects unsafe specifications, checks and dependency escapes', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-authority-deny-'));
  const worktree = path.join(tmp, 'worktree'); const sibling = path.join(tmp, 'sibling');
  fs.mkdirSync(worktree); fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'allowed\n');
  fs.writeFileSync(path.join(sibling, 'outside.cjs'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(worktree, 'spec.txt'), 'spec\n');
  fs.symlinkSync(path.join(sibling, 'outside.cjs'), path.join(worktree, 'escape.cjs'));
  const packetPath = path.join(worktree, 'packet.json');
  const run = { packet: packetPath, worktree: { path: worktree } };
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const writePacket = (sourceOfTruth, testsRequired) => fs.writeFileSync(packetPath, JSON.stringify({
      packetId: 'PKT-AUTHORITY-DENY', agentId: 'claude-code', filesAllowed: ['allowed.txt'],
      sourceOfTruth, testsRequired,
    }));
    writePacket(['../sibling/outside.cjs'], ['node allowed.txt']);
    assert.throws(() => WORKER.derivePacketAllowlists(run, worktree), /sourceOfTruth.*exact worktree-relative/);
    writePacket(['spec.txt'], ['node authority-check.cjs; touch unrelated.txt']);
    assert.throws(() => WORKER.derivePacketAllowlists(run, worktree), /not an approved deterministic check form/);
    fs.writeFileSync(path.join(worktree, 'authority-check.cjs'), "require('./escape.cjs');\n");
    writePacket(['spec.txt'], ['node authority-check.cjs']);
    assert.throws(() => WORKER.derivePacketAllowlists(run, worktree), /dependency escapes the isolated worktree/);
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('declared deterministic checks accept exact single-file test modes and preserve existing forms', () => {
  assert.strictEqual(WORKER.declaredCheckEntrypoint(
    'node --test builder-control/test/aegis-run.test.cjs'),
  'builder-control/test/aegis-run.test.cjs');
  assert.strictEqual(WORKER.declaredCheckEntrypoint('node builder-control/test/aegis-run.test.cjs'),
    'builder-control/test/aegis-run.test.cjs');
  assert.strictEqual(WORKER.declaredCheckEntrypoint(
    'node builder-control/test/hosting.test.cjs --host-only'),
  'builder-control/test/hosting.test.cjs');
  assert.strictEqual(WORKER.declaredCheckEntrypoint('node --check builder-control/aegis-run.cjs'),
    'builder-control/aegis-run.cjs');
  assert.strictEqual(WORKER.declaredCheckEntrypoint('git diff --check'), null);
});

test('node test check declarations refuse extra authority and non-test targets', () => {
  const refused = [
    'NODE_ENV=test node --test builder-control/test/aegis-run.test.cjs',
    'node --test',
    'node --test --test-reporter tap builder-control/test/aegis-run.test.cjs',
    'node --test builder-control/test/aegis-run.test.cjs --test-reporter tap',
    'node builder-control/test/hosting.test.cjs --host-only extra',
    'node builder-control/test/hosting.test.cjs --host-only --inspect',
    'node builder-control/hosting/server.cjs --host-only',
    'node --test builder-control/test/aegis-run.test.cjs builder-control/test/hosting.test.cjs',
    'node --test /tmp/outside.test.cjs',
    'node --test ../outside.test.cjs',
    'node --test builder-control/../outside.test.cjs',
    'node --test builder-control/test/*.test.cjs',
    'node --test builder-control/test/[ab].test.cjs',
    'node --test builder-control/test/aegis-run.test.cjs; touch outside',
    'node --test builder-control/test/aegis-run.test.cjs && touch outside',
    'node --test builder-control/test/aegis-run.test.cjs | sh',
    'node --test $(printf builder-control/test/aegis-run.test.cjs)',
    'node --test `printf builder-control/test/aegis-run.test.cjs`',
    'node --test builder-control/test/aegis-run.test.cjs\nnode outside.cjs',
    'node --loader ./loader.cjs --test builder-control/test/aegis-run.test.cjs',
    'node --import ./hook.cjs --test builder-control/test/aegis-run.test.cjs',
    'node --require ./hook.cjs --test builder-control/test/aegis-run.test.cjs',
    'node --eval "process.exit()" --test builder-control/test/aegis-run.test.cjs',
    'node --test builder-control/test/aegis-run.cjs',
    'node --test builder-control/test/aegis-run.test.js',
    'node --test builder-control/test/aegis-run.test.mjs',
  ];
  for (const command of refused) {
    assert.throws(() => WORKER.declaredCheckEntrypoint(command),
      /not an approved deterministic check form|not an exact worktree-relative path/, command);
  }
});

test('canonical dashboard packet derives all declared single-file node tests into its read allowlist', () => {
  const packet = 'builder-control/packets/PKT-20260825-SWITCHBOARD-FOUNDATION.json';
  const allowed = WORKER.derivePacketAllowlists(
    { packet, packetCoordinate: frozenPacketCoordinate(packet, path.join(ROOT, packet)),
      worktree: { path: ROOT } }, ROOT);
  assert.strictEqual(allowed.packetId, 'PKT-20260825-SWITCHBOARD-FOUNDATION');
  for (const testPath of [
    'builder-control/test/aegis-run.test.cjs',
    'builder-control/test/hosting.test.cjs',
    'builder-control/test/dashboard-slice.test.cjs',
    'builder-control/test/aegis-state.test.cjs',
  ]) assert.strictEqual(allowed.readPaths.includes(testPath), true, testPath);
});

test('worker fails closed when the OS sandbox is unavailable', () => {
  const capability = CONTAINMENT.sandboxCapability();
  if (capability.available) return;
  const f = fixture('must not run uncontained', { AEGIS_TEST_CONTAINMENT_MODE: '' });
  const failed = waitFor(f.read, (r) => r.state === 'BUILD_FAILED');
  assert.strictEqual(failed.build.bootstrapFailure, true);
  assert.match(failed.build.stderrTail, /sandbox|uncontained/i);
  assert.strictEqual(failed.build.childPid, undefined);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('host sandbox allows the packet path and denies sibling, home, and non-allowlisted paths when operational', () => {
  const capability = CONTAINMENT.sandboxCapability();
  if (!capability.available) return skip(`host sandbox unavailable: ${capability.reason || 'unknown reason'}`);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-host-sandbox-'));
  const worktree = path.join(tmp, 'worktree'); const sibling = path.join(tmp, 'sibling');
  fs.mkdirSync(worktree); fs.mkdirSync(sibling);
  const allowed = path.join(worktree, 'allowed.txt'); const other = path.join(worktree, 'other.txt');
  const siblingFile = path.join(sibling, 'outside.txt');
  fs.writeFileSync(allowed, 'allowed\n'); fs.writeFileSync(other, 'other\n'); fs.writeFileSync(siblingFile, 'outside\n');
  const readProfile = CONTAINMENT.buildMacSandboxProfile({ root: worktree, executable: '/bin/cat', readPaths: [allowed] });
  const read = (target) => spawnSync(readProfile.bin, [...CONTAINMENT.sandboxedCommand(readProfile).argv, target], { encoding: 'utf8' });
  const allowedRead = read(allowed);
  assert.strictEqual(allowedRead.status, 0,
    `authorized host-sandbox read failed despite available containment: ${allowedRead.stderr || allowedRead.signal || allowedRead.status}`);
  for (const denied of [other, siblingFile, path.join(os.homedir(), '.ssh')]) assert.notStrictEqual(read(denied).status, 0);
  const writeProfile = CONTAINMENT.buildMacSandboxProfile({ root: worktree, executable: '/usr/bin/touch', writePaths: [allowed] });
  const write = (target) => spawnSync(writeProfile.bin, [...CONTAINMENT.sandboxedCommand(writeProfile).argv, target], { encoding: 'utf8' });
  assert.strictEqual(write(allowed).status, 0);
  for (const denied of [other, siblingFile, path.join(os.homedir(), '.aegis-denied')]) assert.notStrictEqual(write(denied).status, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('cancel proves termination before ABANDONED', () => {
  const f = fixture('remain active until cancellation', { FAKE_SLEEP_MS: '30000' });
  const active = waitFor(f.read, (r) => r.build && r.build.workerState === 'RUNNING');
  assert.match(active.build.attemptId, /^[0-9a-f-]{36}$/);
  assert.ok(active.build.processIdentity);
  assert.strictEqual(active.build.processIdentity.pid, active.build.workerPid);
  assert.strictEqual(active.build.processIdentity.processGroupId, active.build.processGroupId);
  assert.ok(active.build.processIdentity.startMarker);
  assert.ok(active.build.processIdentity.executable);
  const childProcessGroupId = active.build.childProcessGroupId;
  const cancel = spawnSync('node', ['-e', `const R=require(${JSON.stringify(RUNTIME)}); console.log(JSON.stringify(R.cancelRun(${JSON.stringify(f.runId)})))`], { cwd: ROOT, env: f.env, encoding: 'utf8' });
  assert.strictEqual(cancel.status, 0, cancel.stderr);
  const run = f.read();
  assert.strictEqual(run.state, 'ABANDONED');
  assert.strictEqual(run.build.workerState, 'TERMINATED');
  assert.strictEqual(run.build.terminationEvidence.terminated, true);
  assert.strictEqual(run.build.terminationEvidence.childCloseObserved, true);
  assert.strictEqual(run.build.terminationEvidence.attemptId, active.build.attemptId);
  assert.deepStrictEqual(run.build.terminationEvidence.childIdentity, active.build.childProcessIdentity);
  assert.strictEqual(WORKER.processGroupAlive(childProcessGroupId), false);
  assert.ok(run.build.terminationEvidence.observedAt);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('bad cancellation HMAC fails closed without signalling the owned worker group', () => {
  const f = fixture('remain active after bad cancellation HMAC', { FAKE_SLEEP_MS: '30000' });
  const active = waitFor(f.read, (r) => r.build && r.build.workerState === 'RUNNING');
  const tampered = f.read();
  tampered.build.control.secret = '00'.repeat(32);
  tampered.build.control.secretSha256 = require('crypto').createHash('sha256').update(tampered.build.control.secret).digest('hex');
  fs.writeFileSync(f.runFile, JSON.stringify(tampered, null, 2));
  const cancel = control(f, `try{R.cancelRun(${JSON.stringify(f.runId)});process.exit(9)}catch(e){console.log(e.code)}`);
  assert.strictEqual(cancel.status, 0, cancel.stderr);
  assert.match(cancel.stdout, /TERMINATION_UNVERIFIED/);
  assert.strictEqual(WORKER.processGroupAlive(active.build.processGroupId), true);
  assert.strictEqual(f.read().build.terminationEvidence.reason, 'CONTROL_RESPONSE_AUTHENTICATION_FAILED');
  terminateFixtureGroup(active.build.processGroupId, 2000);
  waitFor(() => WORKER.processGroupAlive(active.build.processGroupId), (alive) => alive === false, 3000);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('cancel stays unverified when the exact child closes but a descendant keeps the owned group alive', () => {
  const descendantPidFile = path.join(fs.realpathSync(os.tmpdir()), `aegis-cancel-desc-${process.pid}-${Date.now()}.txt`);
  const f = fixture('prove descendant-aware cancellation', {
    FAKE_CLAUDE_MODE: 'parent-exits-descendant-survives',
    FAKE_DESCENDANT_PID_FILE: descendantPidFile,
  });
  const active = waitFor(f.read, (r) => r.build && r.build.workerState === 'RUNNING');
  waitFor(() => fs.existsSync(descendantPidFile), (exists) => exists === true);
  const descendantPid = Number(fs.readFileSync(descendantPidFile, 'utf8'));
  const cancel = control(f, `try{R.cancelRun(${JSON.stringify(f.runId)});process.exit(9)}catch(e){console.log(e.code)}`);
  assert.strictEqual(cancel.status, 0, cancel.stderr);
  assert.match(cancel.stdout, /TERMINATION_UNVERIFIED/);
  const run = f.read();
  assert.strictEqual(run.state, 'BUILDING');
  assert.strictEqual(run.build.workerState, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(run.build.terminationEvidence.terminated, false);
  assert.strictEqual(run.build.terminationEvidence.childCloseObserved, true);
  assert.strictEqual(run.build.terminationEvidence.processGroupDrained, false);
  assert.strictEqual(run.build.terminationEvidence.reason, 'GROUP_STILL_ALIVE');
  assert.ok(run.build.terminationEvidence.remainingProcessGroupMembers.includes(descendantPid));
  assert.strictEqual(WORKER.processGroupAlive(active.build.processGroupId), true);
  assert.strictEqual(WORKER.processAlive(descendantPid), true);
  terminateFixtureGroup(active.build.processGroupId, 2000);
  waitFor(() => WORKER.processGroupAlive(active.build.processGroupId), (alive) => alive === false, 3000);
  fs.rmSync(descendantPidFile, { force: true });
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('replaced cancellation mailbox fails closed without signalling the owned worker group', () => {
  const f = fixture('remain active after mailbox replacement', { FAKE_SLEEP_MS: '30000' });
  const active = waitFor(f.read, (r) => r.build && r.build.workerState === 'RUNNING');
  const original = `${active.build.control.dir}.original`;
  fs.renameSync(active.build.control.dir, original);
  fs.mkdirSync(active.build.control.dir, { mode: 0o700 });
  const cancel = control(f, `try{R.cancelRun(${JSON.stringify(f.runId)});process.exit(9)}catch(e){console.log(e.code)}`);
  assert.strictEqual(cancel.status, 0, cancel.stderr);
  assert.match(cancel.stdout, /TERMINATION_UNVERIFIED/);
  assert.strictEqual(WORKER.processGroupAlive(active.build.processGroupId), true);
  assert.strictEqual(f.read().build.terminationEvidence.reason, 'CONTROL_MAILBOX_REPLACED');
  terminateFixtureGroup(active.build.processGroupId, 2000);
  waitFor(() => WORKER.processGroupAlive(active.build.processGroupId), (alive) => alive === false, 3000);
  fs.rmSync(f.tmp, { recursive: true, force: true });
  fs.rmSync(original, { recursive: true, force: true });
});

test('cancel without authenticated control and child identity refuses before signalling an unrelated PID', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-stale-cancel-'));
  const runs = path.join(tmp, 'runs');
  const ledger = path.join(tmp, 'ledger.json');
  fs.mkdirSync(runs);
  fs.writeFileSync(ledger, '[]\n');

  // This is deliberately not an AEGIS worker. Detached mode gives it a
  // dedicated group, reproducing the blast radius of signalling a reused PID.
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true, stdio: 'ignore',
  });
  unrelated.unref();
  waitFor(() => WORKER.processAlive(unrelated.pid), (alive) => alive === true);

  const runId = 'RUN-20260827-feedface';
  const runFile = path.join(runs, `${runId}.json`);
  fs.writeFileSync(runFile, JSON.stringify({
    runId, state: 'BUILDING', worktree: { path: tmp }, corrections: 0, transitions: [],
    updatedAt: new Date().toISOString(),
    build: {
      mode: 'async', attempt: 4, attemptId: '11111111-1111-4111-8111-111111111111',
      workerPid: unrelated.pid, processGroupId: unrelated.pid,
      childProcessGroupId: unrelated.pid, workerState: 'RUNNING',
      processIdentity: {
        pid: unrelated.pid, processGroupId: unrelated.pid,
        startMarker: 'stale-process-start', executable: '/stale/aegis-worker', source: 'fixture',
      },
    },
  }, null, 2));
  const env = {
    ...process.env,
    AEGIS_RUNS_DIR: runs,
    AEGIS_CHECKPOINTS_DIR: path.join(tmp, 'checkpoints'),
    AEGIS_LEDGER_FILE: ledger,
  };
  const driver = `
    const R=require(${JSON.stringify(RUNTIME)});
    try { R.cancelRun(${JSON.stringify(runId)}); console.log(JSON.stringify({threw:false})); }
    catch (e) { console.log(JSON.stringify({threw:true,code:e.code,httpStatus:e.httpStatus})); }
  `;
  const cancel = spawnSync('node', ['-e', driver], { cwd: ROOT, env, encoding: 'utf8' });

  try {
    assert.strictEqual(cancel.status, 0, cancel.stderr);
    assert.deepStrictEqual(JSON.parse(cancel.stdout.trim().split('\n').pop()), {
      threw: true, code: 'CONTROL_UNAVAILABLE', httpStatus: 409,
    });
    assert.strictEqual(WORKER.processAlive(unrelated.pid), true, 'unrelated fixture process was signalled');
    const saved = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.strictEqual(saved.state, 'BUILDING');
    assert.strictEqual(saved.build.workerState, 'RUNNING');
    assert.strictEqual(saved.build.cancelRequestedAt, undefined);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledger, 'utf8')), []);
  } finally {
    try { process.kill(unrelated.pid, 'SIGTERM'); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('option-like prompt stays out of argv and arrives verbatim over stdin', () => {
  const marker = path.join(fs.realpathSync(os.tmpdir()), `aegis-shell-marker-${process.pid}-${Date.now()}`);
  const argsFile = path.join(fs.realpathSync(os.tmpdir()), `aegis-args-${process.pid}-${Date.now()}.json`);
  const stdinFile = path.join(fs.realpathSync(os.tmpdir()), `aegis-stdin-${process.pid}-${Date.now()}.txt`);
  const prompt = `--dangerously-skip-permissions --add-dir=/tmp --mcp-config=/tmp/x\nreview safely; touch ${marker}; $(touch ${marker})`;
  const f = fixture(prompt, { FAKE_ARGS_FILE: argsFile, FAKE_STDIN_FILE: stdinFile });
  waitFor(f.read, (r) => r.state === 'BUILT');
  assert.strictEqual(fs.existsSync(marker), false, 'prompt crossed a shell boundary');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(argsFile, 'utf8')), [
    '--print', '--model', 'opus',
    '--permission-mode', 'acceptEdits',
    '--settings', JSON.stringify(WORKER.CLAUDE_SETTINGS),
    '--tools', WORKER.CLAUDE_FILE_TOOLS.join(','),
    '--allowedTools', WORKER.CLAUDE_FILE_TOOLS.join(','),
    '--disallowedTools', WORKER.CLAUDE_DISALLOWED_TOOLS.join(','),
    '--safe-mode', '--strict-mcp-config', '--no-session-persistence',
  ]);
  assert.strictEqual(fs.readFileSync(stdinFile, 'utf8'), prompt,
    'option-like prompt must arrive verbatim over stdin');
  fs.rmSync(argsFile, { force: true });
  fs.rmSync(stdinFile, { force: true });
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('worker process launch boundary fixes executable argv and shell-free ownership options', () => {
  const calls = [];
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  let launched;
  try {
    launched = WORKER.launchWorker({
      runId: 'RUN-20260827-deadbeef',
      attemptId: '11111111-1111-4111-8111-111111111111',
      launchSpec: { provider: 'claude-subscription', prompt: 'safe; $(touch never)', model: 'opus' },
      timeoutSec: 90,
    }, { spawn: (bin, argv, options) => {
      calls.push({ bin, argv, options });
      return { pid: 4242, unref() {} };
    } });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].bin, process.execPath);
    assert.deepStrictEqual(calls[0].argv, [
      path.join(ROOT, 'builder-control', 'aegis-worker.cjs'), '--execute', launched.payloadPath,
      'RUN-20260827-deadbeef', '11111111-1111-4111-8111-111111111111',
    ]);
    assert.strictEqual(calls[0].options.cwd, path.join(ROOT, 'builder-control'));
    assert.strictEqual(calls[0].options.detached, true);
    assert.strictEqual(calls[0].options.shell, false);
    assert.strictEqual(calls[0].options.stdio, 'ignore');
    assert.strictEqual(calls[0].options.env.PATH, WORKER.workerEnvironment().PATH);
    assert.strictEqual(calls[0].argv.includes('safe; $(touch never)'), false,
      'dashboard prompt belongs only in the private payload, never the worker process argv');
    delete process.env.NODE_ENV;
    assert.throws(() => WORKER.launchWorker({
      runId: 'RUN-20260827-deadbeef',
      attemptId: '22222222-2222-4222-8222-222222222222',
      launchSpec: { provider: 'claude-subscription', prompt: 'x', model: 'opus' },
    }, { spawn: () => { throw new Error('must not spawn'); } }), /instrumentation is test-only/);
    process.env.NODE_ENV = 'test';
  } finally {
    if (launched) {
      fs.rmSync(launched.payloadPath, { force: true });
      fs.rmSync(launched.control.dir, { recursive: true, force: true });
    }
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
  }
});

test('Claude launch boundary uses exact contained argv and rejects caller process controls', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-launch-boundary-'));
  const worktree = path.join(tmp, 'worktree');
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'allowed\n');
  const executable = path.join(tmp, 'claude-fixture');
  fs.copyFileSync(WORKER.CLAUDE_EXECUTABLE, executable); fs.chmodSync(executable, 0o755);
  const packetPath = path.join(worktree, 'packet.json');
  writePacketFixture(worktree, packetPath,
    { packetId: 'PKT-LAUNCH-BOUNDARY', agentId: 'claude-code', filesAllowed: ['allowed.txt'] });
  const prior = {
    NODE_ENV: process.env.NODE_ENV,
    executable: process.env.AEGIS_TEST_CLAUDE_EXECUTABLE,
    mode: process.env.AEGIS_TEST_CONTAINMENT_MODE,
  };
  process.env.NODE_ENV = 'test';
  process.env.AEGIS_TEST_CLAUDE_EXECUTABLE = executable;
  process.env.AEGIS_TEST_CONTAINMENT_MODE = 'DETERMINISTIC_PROFILE_ONLY';
  const calls = [];
  try {
    const prompt = '--dangerously-skip-permissions --add-dir=/tmp --mcp-config=/tmp/x\nliteral; $(touch never) --model sonnet';
    const run = { packet: packetPath, worktree: { path: worktree } };
    const minimizedEnv = WORKER.claudeEnvironment({
      HOME: '/caller/home', PATH: '/caller/bin', ANTHROPIC_API_KEY: 'forbidden', NODE_ENV: 'test',
    });
    const result = WORKER.launchClaudeProcess(run,
      { provider: 'claude-subscription', prompt, model: 'opus' },
      minimizedEnv,
      { forceContainedCommand: true, spawn: (bin, argv, options) => {
        calls.push({ bin, argv, options });
        return {
          pid: 4343,
          stdin: { end(value) { calls[calls.length - 1].stdin = value; } },
          stdout: null,
          stderr: null,
        };
      } });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].bin, CONTAINMENT.SANDBOX_EXEC);
    assert.deepStrictEqual(calls[0].argv.slice(0, 2), ['-p', result.contained.profile.profile]);
    assert.match(calls[0].argv[1], /^\(version 1\)\n\(deny default\)/);
    assert.strictEqual(calls[0].argv[2], fs.realpathSync(executable));
    assert.deepStrictEqual(calls[0].argv.slice(3), [
      '--print', '--model', 'opus', '--permission-mode', 'acceptEdits',
      '--settings', JSON.stringify(WORKER.CLAUDE_SETTINGS),
      '--tools', WORKER.CLAUDE_FILE_TOOLS.join(','),
      '--allowedTools', WORKER.CLAUDE_FILE_TOOLS.join(','),
      '--disallowedTools', WORKER.CLAUDE_DISALLOWED_TOOLS.join(','), '--safe-mode',
      '--strict-mcp-config', '--no-session-persistence',
    ]);
    assert.strictEqual(calls[0].options.cwd, worktree);
    assert.strictEqual(calls[0].options.detached, false);
    assert.strictEqual(calls[0].options.shell, false);
    assert.deepStrictEqual(calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.strictEqual(calls[0].stdin, prompt, 'prompt must be delivered verbatim over stdin');
    assert.strictEqual(calls[0].argv.includes(prompt), false, 'prompt must never enter argv');
    assert.strictEqual(Object.values(calls[0].options.env).includes(prompt), false,
      'prompt must never enter the child environment');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(calls[0].options.env, 'ANTHROPIC_API_KEY'), false);
    assert.strictEqual(calls[0].options.env.PATH, CONTAINMENT.FIXED_PATH);
    assert.notStrictEqual(calls[0].options.env.PATH, '/caller/bin');
    assert.strictEqual(result.claudeExecutable, fs.realpathSync(executable));
    assert.strictEqual(path.basename(WORKER.CLAUDE_EXECUTABLE), WORKER.CLAUDE_VERSION);

    for (const spec of [
      { provider: 'claude-subscription', prompt: 'x', model: 'opus', executable: '/bin/sh' },
      { provider: 'claude-subscription', prompt: 'x', model: 'opus', argv: ['-lc', 'evil'] },
      { provider: 'claude-subscription', prompt: 'x', model: 'opus', shell: true },
      { provider: 'claude-subscription', prompt: 'x', model: 'opus', tools: ['Bash'] },
      { provider: 'claude-subscription', prompt: 'x', model: 'opus', disallowedTools: [] },
    ]) assert.throws(() => WORKER.launchClaudeProcess(run, spec, {}, {
      forceContainedCommand: true, spawn: () => { throw new Error('must not spawn'); },
    }), /unknown launchSpec field/);
  } finally {
    for (const [key, value] of [['NODE_ENV', prior.NODE_ENV],
      ['AEGIS_TEST_CLAUDE_EXECUTABLE', prior.executable],
      ['AEGIS_TEST_CONTAINMENT_MODE', prior.mode]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('launch spec rejects executable, argv, environment and unknown models before state mutation', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-worker-invalid-'));
  const runs = path.join(tmp, 'runs');
  const worktree = path.join(tmp, 'worktree');
  const ledger = path.join(tmp, 'ledger.json');
  fs.mkdirSync(runs); fs.mkdirSync(worktree); fs.writeFileSync(ledger, '[]\n');
  const runId = 'RUN-20260827-deadbeef';
  const runFile = path.join(runs, `${runId}.json`);
  fs.writeFileSync(runFile, JSON.stringify({ runId, state: 'WORKTREE_READY', worktree: { path: worktree }, build: null, corrections: 0, transitions: [] }));
  const env = { ...process.env, AEGIS_RUNS_DIR: runs, AEGIS_CHECKPOINTS_DIR: path.join(tmp, 'checkpoints'), AEGIS_LEDGER_FILE: ledger };
  for (const spec of [
    { provider: 'claude-subscription', prompt: 'x', model: 'opus', executable: 'bash' },
    { provider: 'claude-subscription', prompt: 'x', model: 'opus', argv: ['-lc', 'evil'] },
    { provider: 'claude-subscription', prompt: 'x', model: 'opus', env: { X: 'Y' } },
    { provider: 'claude-subscription', prompt: 'x', model: 'opus', tools: ['Bash'] },
    { provider: 'claude-subscription', prompt: 'x', model: 'opus', disallowedTools: [] },
    { provider: 'claude-subscription', prompt: 'x', model: '--evil' },
  ]) {
    const driver = `const R=require(${JSON.stringify(RUNTIME)}); try{R.startWorker(${JSON.stringify(runId)},${JSON.stringify(spec)});process.exit(9)}catch(e){console.log(e.code)}`;
    const result = spawnSync('node', ['-e', driver], { cwd: ROOT, env, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /INVALID-LAUNCH-SPEC/);
    assert.strictEqual(JSON.parse(fs.readFileSync(runFile, 'utf8')).state, 'WORKTREE_READY');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('timeout is integer-bounded before worker launch', () => {
  for (const value of [0, -1, 1.5, 3601, 'not-a-number']) {
    assert.throws(() => WORKER.normalizeTimeoutSec(value), /timeoutSec must be an integer/);
  }
  assert.strictEqual(WORKER.normalizeTimeoutSec(undefined), 900);
  assert.strictEqual(WORKER.normalizeTimeoutSec(1), 1);
  assert.strictEqual(WORKER.normalizeTimeoutSec(3600), 3600);
});

test('builder no-progress watchdog is fixed at five minutes and cannot be operator shortened', () => {
  assert.strictEqual(WORKER.DEFAULT_NO_PROGRESS_TIMEOUT_SEC, 300);
  assert.strictEqual(WORKER.builderNoProgressTimeoutMs(900_000, {}), 300_000);
  assert.strictEqual(WORKER.builderNoProgressTimeoutMs(300_000, {}), null);
  assert.strictEqual(WORKER.builderNoProgressTimeoutMs(900_000, {
    FAKE_NO_PROGRESS_TIMEOUT_MS: '25',
  }), 300_000);
  assert.strictEqual(WORKER.builderNoProgressTimeoutMs(5_000, {
    NODE_ENV: 'test', FAKE_NO_PROGRESS_TIMEOUT_MS: '250',
  }), 250);
});

test('no-output builder is stopped as stalled before its hard timeout', () => {
  const f = fixture('stop the genuinely idle builder', {
    FAKE_SLEEP_MS: '4000', FAKE_NO_PROGRESS_TIMEOUT_MS: '250',
  }, 5);
  const done = waitFor(f.read, (r) => r.state === 'BUILD_FAILED', 8000);
  assert.strictEqual(done.build.exit, 124);
  assert.strictEqual(done.build.timedOut, true);
  assert.strictEqual(done.build.timeoutReason, 'NO_PROGRESS_TIMEOUT');
  assert.strictEqual(done.build.timeoutTerminationEvidence.timeoutReason, 'NO_PROGRESS_TIMEOUT');
  assert.strictEqual(done.build.timeoutTerminationEvidence.childCloseObserved, true);
  assert.strictEqual(done.build.workerState, 'FAILED');
  assert.strictEqual(done.build.progressKind, 'STARTED');
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('real stdout progress keeps a builder alive until successful exit', () => {
  const f = fixture('allow a builder that is reporting real progress', {
    FAKE_CLAUDE_MODE: 'progress', FAKE_SLEEP_MS: '1200',
    FAKE_NO_PROGRESS_TIMEOUT_MS: '750',
  }, 5);
  const done = waitFor(f.read, (r) => r.state === 'BUILT', 8000);
  assert.strictEqual(done.build.exit, 0);
  assert.strictEqual(done.build.timedOut, false);
  assert.strictEqual(done.build.timeoutReason, null);
  assert.strictEqual(done.build.progressKind, 'STDOUT');
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('authorized file changes count as progress even when model output is buffered', () => {
  const f = fixture('allow a quiet builder that is changing its authorized file', {
    FAKE_CLAUDE_MODE: 'write-progress', FAKE_SLEEP_MS: '2300',
    FAKE_NO_PROGRESS_TIMEOUT_MS: '1500',
  }, 5);
  const done = waitFor(f.read, (r) => r.state === 'BUILT', 8000);
  assert.strictEqual(done.build.exit, 0);
  assert.strictEqual(done.build.timedOut, false);
  assert.strictEqual(done.build.timeoutReason, null);
  assert.strictEqual(done.build.progressKind, 'AUTHORIZED_WRITE');
  assert.strictEqual(done.build.authorizedMutationObserved, true);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('timeout fails closed when the owned process group does not produce exact child close', () => {
  const descendantPidFile = path.join(fs.realpathSync(os.tmpdir()), `aegis-desc-${process.pid}-${Date.now()}.txt`);
  const f = fixture('exercise timeout process-group cleanup', {
    FAKE_CLAUDE_MODE: 'tree', FAKE_DESCENDANT_PID_FILE: descendantPidFile,
  }, 1);
  const done = waitFor(f.read, (r) => r.state === 'BUILD_FAILED', 10000);
  assert.strictEqual(done.build.exit, 124);
  assert.strictEqual(done.build.timedOut, true);
  assert.strictEqual(done.build.timeoutTerminationEvidence.terminated, false);
  assert.strictEqual(done.build.timeoutTerminationEvidence.childCloseObserved, false);
  assert.strictEqual(done.build.workerState, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(done.build.recovery.retrySafe, false);
  assert.strictEqual(WORKER.processGroupAlive(done.build.childProcessGroupId), true);
  const descendantPid = Number(fs.readFileSync(descendantPidFile, 'utf8'));
  assert.strictEqual(WORKER.processAlive(descendantPid), true);
  terminateFixtureGroup(done.build.childProcessGroupId, 2000);
  waitFor(() => WORKER.processGroupAlive(done.build.childProcessGroupId), (alive) => alive === false, 3000);
  fs.rmSync(descendantPidFile, { force: true });
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('worker and Claude environments are allowlisted and never carry provider overrides', () => {
  const source = {
    HOME: '/tmp/home', USER: 'fixture', LOGNAME: 'fixture', TMPDIR: '/tmp', LANG: 'C',
    ANTHROPIC_API_KEY: 'forbidden', ANTHROPIC_AUTH_TOKEN: 'forbidden', ANTHROPIC_BASE_URL: 'forbidden',
    AWS_SECRET_ACCESS_KEY: 'forbidden', EVIL: 'forbidden', AEGIS_RUNS_DIR: '/tmp/runs',
  };
  const workerEnv = WORKER.workerEnvironment(source);
  const claudeEnv = WORKER.claudeEnvironment(source);
  assert.strictEqual(workerEnv.AEGIS_REMOVED_ANTHROPIC_API_KEY, '1');
  assert.strictEqual(workerEnv.AEGIS_REMOVED_ANTHROPIC_OVERRIDES, '1');
  assert.strictEqual(workerEnv.AEGIS_RUNS_DIR, '/tmp/runs');
  for (const env of [workerEnv, claudeEnv]) {
    for (const forbidden of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'AWS_SECRET_ACCESS_KEY', 'EVIL']) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(env, forbidden), false, `${forbidden} leaked`);
    }
  }
  assert.strictEqual(workerEnv.PATH.includes('/usr/bin'), true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(claudeEnv, 'PATH'), false);
});

test('contained environment accepts only worker and reviewer runtime keys and fixes PATH last', () => {
  const source = {
    NODE_ENV: 'production', LANG: 'C', LC_CTYPE: 'UTF-8', TERM: 'xterm-256color',
    PATH: '/host/bin', NODE_OPTIONS: '--require=/tmp/host.js', ANTHROPIC_API_KEY: 'host-secret',
  };
  const env = CONTAINMENT.strictEnvironment({
    HOME: '/tmp/contained-home', USER: 'contained', LOGNAME: 'contained', TMPDIR: '/tmp/contained',
    LC_ALL: 'C', CODEX_HOME: '/tmp/contained-home/.codex', GROK_MANAGED_MCPS_ENABLED: 'false',
    GIT_OPTIONAL_LOCKS: '0',
  }, source);
  assert.deepStrictEqual(Object.keys(env).sort(), [
    'CODEX_HOME', 'GIT_OPTIONAL_LOCKS', 'GROK_MANAGED_MCPS_ENABLED', 'HOME', 'LANG', 'LC_ALL',
    'LC_CTYPE', 'LOGNAME', 'PATH', 'TERM', 'TMPDIR', 'USER',
  ].sort());
  assert.strictEqual(env.PATH, CONTAINMENT.FIXED_PATH);
  assert.strictEqual(env.NODE_OPTIONS, undefined);
  assert.strictEqual(env.ANTHROPIC_API_KEY, undefined);
  assert.strictEqual(Object.isFrozen(env), true);
});

test('contained environment permits fixture controls only from an explicit test source', () => {
  const env = CONTAINMENT.strictEnvironment({ NODE_ENV: 'test', FAKE_SLEEP_MS: '1' }, { NODE_ENV: 'test' });
  assert.strictEqual(env.NODE_ENV, 'test');
  assert.strictEqual(env.FAKE_SLEEP_MS, '1');
  assert.strictEqual(env.PATH, CONTAINMENT.FIXED_PATH);
  assert.throws(() => CONTAINMENT.strictEnvironment({ NODE_ENV: 'test' }, { NODE_ENV: 'production' }),
    /NODE_ENV is not allowed/);
  assert.throws(() => CONTAINMENT.strictEnvironment({ FAKE_SLEEP_MS: '1' }, { NODE_ENV: 'production' }),
    /FAKE_SLEEP_MS is not allowed/);
});

test('contained environment rejects executable, loader, credential and routing overrides', () => {
  const rejected = [
    'PATH', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'XAI_API_KEY',
    'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL',
    'ANTHROPIC_MODEL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    'AWS_REGION', 'VERTEX_REGION', 'MODEL', 'PROVIDER',
  ];
  for (const key of rejected) {
    assert.throws(() => CONTAINMENT.strictEnvironment({ [key]: 'attacker-controlled' }, { NODE_ENV: 'production' }),
      new RegExp(`${key} is not allowed`), key);
  }
  assert.throws(() => CONTAINMENT.strictEnvironment({ HOME: 'bad\0path' }),
    /invalid contained environment entry HOME/);
});

test('Claude subscription config metadata policy accepts only the two exact private regular files', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-claude-auth-policy-'));
  const claudeDir = path.join(tmp, '.claude');
  fs.mkdirSync(claudeDir, { mode: 0o700 });
  const top = path.join(tmp, '.claude.json');
  const settings = path.join(claudeDir, 'settings.json');
  fs.writeFileSync(top, '{}\n', { mode: 0o600 });
  fs.writeFileSync(settings, '{}\n', { mode: 0o600 });
  const exact = CONTAINMENT.claudeSubscriptionConfigPaths(tmp);
  assert.deepStrictEqual(CONTAINMENT.validateClaudeSubscriptionConfigPaths(exact, { home: tmp }), exact);
  assert.throws(() => CONTAINMENT.validateClaudeSubscriptionConfigPaths([settings, top], { home: tmp }),
    /exact literals/);
  fs.chmodSync(settings, 0o644);
  assert.throws(() => CONTAINMENT.validateClaudeSubscriptionConfigPaths(exact, { home: tmp }),
    /permissions/);
  fs.chmodSync(settings, 0o600);
  const alternate = path.join(tmp, 'alternate-config-link.json');
  fs.linkSync(settings, alternate);
  assert.throws(() => CONTAINMENT.validateClaudeSubscriptionConfigPaths(exact, { home: tmp }),
    /hard-link/);
  fs.rmSync(alternate);
  fs.rmSync(top);
  fs.symlinkSync(settings, top);
  assert.throws(() => CONTAINMENT.validateClaudeSubscriptionConfigPaths(exact, { home: tmp }),
    /regular non-symlink/);
  fs.rmSync(top);
  assert.throws(() => CONTAINMENT.validateClaudeSubscriptionConfigPaths(exact, { home: tmp }),
    /absent/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Claude disposable runtime metadata policy accepts only its exact private real directory', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-claude-runtime-policy-'));
  fs.chmodSync(tmp, 0o700);
  assert.strictEqual(CONTAINMENT.validateClaudeDisposableRuntimeDir(tmp, {
    ownerUid: process.getuid(), expectedPath: tmp,
  }), fs.realpathSync(tmp));
  fs.chmodSync(tmp, 0o750);
  assert.throws(() => CONTAINMENT.validateClaudeDisposableRuntimeDir(tmp, {
    ownerUid: process.getuid(), expectedPath: tmp,
  }), /0700/);
  fs.chmodSync(tmp, 0o700);
  assert.throws(() => CONTAINMENT.validateClaudeDisposableRuntimeDir(tmp, {
    ownerUid: process.getuid(), expectedPath: path.join(path.dirname(tmp), 'wrong'),
  }), /exact literal/);
  const link = `${tmp}-link`;
  fs.symlinkSync(tmp, link);
  assert.throws(() => CONTAINMENT.validateClaudeDisposableRuntimeDir(link, {
    ownerUid: process.getuid(), expectedPath: link,
  }), /non-symlink/);
  fs.unlinkSync(link);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('production containment grants only process-bound directory data on exact Claude disposable runtime', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-claude-runtime-profile-'));
  const allowed = path.join(tmp, 'allowed.txt');
  fs.writeFileSync(allowed, 'fixture\n');
  const executable = WORKER.resolveClaudeExecutable();
  const runtimeDir = CONTAINMENT.claudeDisposableRuntimeDir();
  const profile = CONTAINMENT.buildMacSandboxProfile({
    root: tmp,
    executable,
    readPaths: [allowed],
    claudeDisposableRuntimeDirReadPath: runtimeDir,
  });
  const exactRule = `(allow file-read-data (require-all (literal "${runtimeDir}") (process-path "${executable}")))`;
  assert.strictEqual(profile.profile.includes(exactRule), true);
  assert.strictEqual(profile.claudeDisposableRuntimePolicy,
    CONTAINMENT.CLAUDE_DISPOSABLE_RUNTIME_POLICY);
  assert.strictEqual(profile.claudeDisposableRuntimeDirReadPath, runtimeDir);
  assert.strictEqual(profile.profile.includes(`(subpath "${runtimeDir}")`), false,
    'runtime descendants and contents must remain denied');
  assert.strictEqual(profile.profile.includes(`file-write` + `* (literal "${runtimeDir}")`), false,
    'runtime writes must remain denied');
  assert.strictEqual(profile.profile.includes(`file-write` + `* (subpath "${runtimeDir}")`), false,
    'runtime creates must remain denied');
  assert.strictEqual(profile.profile.includes('(subpath "/private/tmp")'), false,
    'broader temporary-directory access must remain denied');
  assert.strictEqual(profile.profile.includes(`(literal "${runtimeDir}"))`), false,
    'the runtime rule must never omit its pinned process-path qualifier');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('production containment grants Claude only exact config literals and no general HOME tree', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-claude-auth-profile-'));
  const allowed = path.join(tmp, 'allowed.txt');
  fs.writeFileSync(allowed, 'fixture\n');
  const configs = CONTAINMENT.claudeSubscriptionConfigPaths();
  const profile = CONTAINMENT.buildMacSandboxProfile({
    root: tmp,
    executable: WORKER.resolveClaudeExecutable(),
    readPaths: [allowed],
    claudeSubscriptionConfigReadPaths: configs,
  });
  assert.strictEqual(profile.claudeSubscriptionConfigPolicy,
    CONTAINMENT.CLAUDE_SUBSCRIPTION_CONFIG_POLICY);
  assert.deepStrictEqual(profile.claudeSubscriptionConfigReadPaths, configs);
  assert.strictEqual(profile.profile.includes(
    `(allow file-read-data (literal "${fs.realpathSync(tmp)}"))`), true,
  'Claude startup may list only the exact canonical worktree root');
  assert.strictEqual(profile.profile.includes(
    `(allow file-read* (subpath "${fs.realpathSync(tmp)}"))`), false,
  'the startup allowance must not grant descendant content reads');
  assert.strictEqual(profile.profile.includes(
    `(allow file-read-data (literal "${path.dirname(fs.realpathSync(tmp))}"))`), false,
  'the startup allowance must not grant directory reads to the worktree parent');
  for (const literal of configs) {
    assert.match(profile.profile, new RegExp(`literal "${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
  for (const forbidden of [
    `(subpath "${os.homedir()}")`,
    path.join(os.homedir(), '.ssh'),
    path.join(os.homedir(), '.aws'),
    path.join(os.homedir(), '.config', 'gcloud'),
    path.join(os.homedir(), '.openclaw'),
  ]) assert.strictEqual(profile.profile.includes(forbidden), false, forbidden);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('production containment grants exact native runtime and process-bound read-only Keychain helper access', () => {
  const executable = WORKER.resolveClaudeExecutable();
  const native = CONTAINMENT.claudeNativeRuntimePaths(ROOT);
  const keychain = CONTAINMENT.claudeKeychainHelperPaths();
  const prepared = CONTAINMENT.prepareWorkerContainment({
    worktree: ROOT,
    executable,
    packetReadPaths: ['builder-control/aegis-worker.cjs'],
    packetWritePaths: [],
    claudeSubscriptionConfigReadPaths: CONTAINMENT.claudeSubscriptionConfigPaths(),
    claudeDisposableRuntimeDirReadPath: CONTAINMENT.claudeDisposableRuntimeDir(),
    claudeNativeRuntime: native,
    claudeKeychainHelper: keychain,
    env: { HOME: os.homedir() },
  });
  assert.strictEqual(prepared.profile.claudeNativeRuntimePolicy, CONTAINMENT.CLAUDE_NATIVE_RUNTIME_POLICY);
  assert.strictEqual(prepared.profile.claudeKeychainHelperPolicy, CONTAINMENT.CLAUDE_KEYCHAIN_HELPER_POLICY);
  assert.strictEqual(prepared.env.GIT_OPTIONAL_LOCKS, '0');
  assert.strictEqual(prepared.profile.profile.includes(`(subpath "${native.gitCommonDir}")`), false);
  assert.strictEqual(prepared.profile.profile.includes('(subpath "/usr/bin")'), false);
  assert.strictEqual(prepared.profile.profile.includes('(literal "/usr/bin/git")'), true);
  for (const literal of native.gitReadFiles) {
    assert.strictEqual(prepared.profile.profile.includes(`(literal "${literal}")`), true, literal);
  }
  assert.strictEqual(prepared.profile.profile.includes(
    `(literal "${path.join(native.gitCommonDir, 'config')}")`), false);
  const capability = CONTAINMENT.sandboxCapability();
  if (capability.available) {
    const contained = CONTAINMENT.sandboxedCommand(prepared.profile);
    const gitObjectEscape = spawnSync(contained.bin,
      [...contained.argv, '/usr/bin/git', '-C', ROOT, 'show', 'HEAD:.gitignore'],
      { encoding: 'utf8', env: prepared.env });
    assert.notStrictEqual(gitObjectEscape.status, 0,
      'shared Git objects exposed a committed path outside the packet read list');
    const configEscape = spawnSync(contained.bin,
      [...contained.argv, '/bin/cat', path.join(native.gitCommonDir, 'config')],
      { encoding: 'utf8', env: prepared.env });
    assert.notStrictEqual(configEscape.status, 0,
      'shared Git config remained readable outside exact runtime literals');
  }
  assert.strictEqual(prepared.profile.profile.includes(`(subpath "${native.claudeLocksDir}")`), true);
  const helperQualifier = `(process-path "${keychain.securityHelper}")`;
  assert.strictEqual(prepared.profile.profile.includes(
    `(subpath "${keychain.keychainsDir}")`), true);
  assert.strictEqual(prepared.profile.profile.includes(helperQualifier), true);
  assert.strictEqual(prepared.profile.profile.includes(
    `(allow file-write* (subpath "${keychain.keychainsDir}"))`), false);
  assert.strictEqual(prepared.profile.profile.includes(
    `(allow file-read* (subpath "${keychain.keychainsDir}"))`), false,
  'Keychain access must never lose its process-path qualifier');
  assert.strictEqual(prepared.profile.profile.includes(`(subpath "${os.homedir()}")`), false);
});

test('native runtime authority accepts only a fresh canonical exact object', () => {
  const canonical = CONTAINMENT.claudeNativeRuntimePaths(ROOT);
  assert.deepStrictEqual(CONTAINMENT.validateClaudeNativeRuntime(canonical, { root: ROOT }), canonical);
  for (const replacement of [
    { ...canonical, rootGitFile: '/' },
    { ...canonical, gitDir: os.tmpdir() },
    { ...canonical, gitCommonDir: '/' },
    { ...canonical, claudeLocksDir: '/' },
    { rootGitFile: canonical.rootGitFile, gitDir: canonical.gitDir,
      gitCommonDir: canonical.gitCommonDir },
    { ...canonical, extra: canonical.gitCommonDir },
  ]) {
    assert.throws(() => CONTAINMENT.validateClaudeNativeRuntime(replacement, { root: ROOT }),
      /exact literals/);
  }
  assert.throws(() => CONTAINMENT.validateClaudeNativeRuntime(null, { root: ROOT }), /must be an object/);
  assert.throws(() => CONTAINMENT.validateClaudeNativeRuntime(canonical, {
    root: ROOT, ownerUid: process.getuid() + 1,
  }), /controlled by the current owner/);

  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-native-runtime-link-'));
  const substituted = path.join(tmp, 'git-pointer');
  fs.symlinkSync(canonical.rootGitFile, substituted);
  assert.throws(() => CONTAINMENT.validateClaudeNativeRuntime({
    ...canonical, rootGitFile: substituted,
  }, { root: ROOT }), /exact literals/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Keychain helper authority rejects substituted executables and HOME paths', () => {
  const canonical = CONTAINMENT.claudeKeychainHelperPaths();
  assert.deepStrictEqual(CONTAINMENT.validateClaudeKeychainHelper(canonical), canonical);
  assert.throws(() => CONTAINMENT.validateClaudeKeychainHelper({
    ...canonical, securityHelper: '/bin/sh',
  }), /exact literals/);
  assert.throws(() => CONTAINMENT.validateClaudeKeychainHelper({
    ...canonical, keychainsDir: os.homedir(),
  }), /exact literals/);
  assert.throws(() => CONTAINMENT.validateClaudeKeychainHelper({
    ...canonical, extra: canonical.keychainsDir,
  }), /exact literals/);
});

test('pinned Claude bootstraps auth status through the production containment boundary without provider overrides', async () => {
  const executable = WORKER.resolveClaudeExecutable();
  const packet = path.join(ROOT, 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const run = { packet, worktree: { path: ROOT } };
  const childEnv = WORKER.claudeEnvironment({
    HOME: os.homedir(),
    ANTHROPIC_API_KEY: 'must-not-reach-contained-child',
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(childEnv, 'ANTHROPIC_API_KEY'), false);
  const prepared = WORKER.prepareRunContainment(run, executable, childEnv);
  assert.strictEqual(prepared.command.bin, CONTAINMENT.SANDBOX_EXEC);
  assert.strictEqual(prepared.profile.claudeSubscriptionConfigPolicy,
    CONTAINMENT.CLAUDE_SUBSCRIPTION_CONFIG_POLICY);
  assert.strictEqual(prepared.profile.claudeDisposableRuntimePolicy,
    CONTAINMENT.CLAUDE_DISPOSABLE_RUNTIME_POLICY);
  assert.strictEqual(prepared.profile.claudeNativeRuntimePolicy,
    CONTAINMENT.CLAUDE_NATIVE_RUNTIME_POLICY);
  assert.strictEqual(prepared.profile.claudeKeychainHelperPolicy, null,
    'the contained Claude process must receive no direct Keychain helper authority');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(prepared.env, 'ANTHROPIC_API_KEY'), false);

  const fdPrepared = WORKER.prepareRunContainment(run, executable, {
    ...childEnv,
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: WORKER.CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR,
  });
  assert.strictEqual(WORKER.CLAUDE_KEYCHAIN_SERVICE, 'Claude Code-credentials');
  assert.strictEqual(WORKER.CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR, '3');
  assert.strictEqual(fdPrepared.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, '3');
  assert.match(fdPrepared.profile.profile,
    /\(allow file-read-data \(require-all \(literal "\/dev\/fd\/3"\) \(process-path "[^"]+"\)\)\)/);
  assert.doesNotMatch(fdPrepared.profile.profile,
    /\(allow file-read-data \(literal "\/dev\/fd\/3"\)\)/,
    'descriptor 3 must never be readable by every model-launched descendant');
  assert.strictEqual(fdPrepared.profile.profile.includes('/dev/fd/4'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(fdPrepared.env, 'ANTHROPIC_API_KEY'), false);

  // `auth status` is a zero-cost executable/bootstrap proof: it makes no
  // prompt or model call. Keep the payload private and assert only its bounded
  // shape, so credentials, email, org IDs, and subscription details never
  // enter test output or evidence.
  let result;
  try {
    result = await WORKER.runContainedClaudeAuthStatus(run, childEnv);
  } catch (error) {
    assert.strictEqual(error.code, 'CLAUDE_SUBSCRIPTION_REAUTH_REQUIRED');
    assert.match(error.message, /preflight blocked before model launch/);
    assert.match(error.operatorAction, /auth login --claudeai interactively/);
    return { skipped: 'local Claude OAuth is expired; fail-closed reauthentication path verified' };
  }
  assert.strictEqual(result.status, 0,
    `contained Claude auth bootstrap failed with exit ${result.status}`);
  assert.strictEqual(result.loggedIn, true,
    'contained Claude must report an authenticated subscription session');
  assert.strictEqual(result.authMethod, 'oauth_token');
  assert.strictEqual(typeof result.apiProvider, 'string');
  assert.deepStrictEqual(Object.keys(result).sort(), ['apiProvider', 'authMethod', 'loggedIn', 'status']);
});

test('Claude OAuth preflight rejects expired or unverifiable credentials before launch without exposing tokens', () => {
  const now = 2_000_000;
  const fresh = WORKER.assertClaudeOAuthFreshness({
    expiresAt: now + WORKER.CLAUDE_OAUTH_EXPIRY_SKEW_MS + 1,
    hasRefreshToken: true,
    accessToken: 'must-never-be-returned',
    refreshToken: 'must-never-be-returned',
  }, now);
  assert.deepStrictEqual(fresh, {
    expiresAt: now + WORKER.CLAUDE_OAUTH_EXPIRY_SKEW_MS + 1,
    hasRefreshToken: true,
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(fresh, 'accessToken'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(fresh, 'refreshToken'), false);
  for (const metadata of [
    { expiresAt: now, hasRefreshToken: true },
    { expiresAt: now + WORKER.CLAUDE_OAUTH_EXPIRY_SKEW_MS, hasRefreshToken: false },
    { expiresAt: null, hasRefreshToken: true },
  ]) {
    assert.throws(() => WORKER.assertClaudeOAuthFreshness(metadata, now), (error) => {
      assert.strictEqual(error.code, 'CLAUDE_SUBSCRIPTION_REAUTH_REQUIRED');
      assert.match(error.message, /Operator action: .*auth login --claudeai interactively/);
      assert.doesNotMatch(error.message, /must-never-be-returned/);
      return true;
    });
  }
  assert.throws(() => WORKER.assertClaudeOAuthFreshness({ expiresAt: now + 120000 }, NaN),
    /finite clock/);

  const source = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-worker.cjs'), 'utf8');
  const launch = source.slice(source.indexOf('function launchClaudeProcess'),
    source.indexOf('function grokArgv'));
  assert.ok(launch.indexOf('readClaudeOAuthToken()') < launch.indexOf('spawnImpl('),
    'Claude credential freshness must be checked before the model process is spawned');
});

test('Claude builder has only file tools and callers cannot restore Bash authority', () => {
  assert.strictEqual(WORKER.assertClaudeModelSandboxPolicy(), true);
  assert.deepStrictEqual(WORKER.CLAUDE_FILE_TOOLS, ['Read', 'Edit', 'Write', 'Glob', 'Grep']);
  assert.strictEqual(WORKER.CLAUDE_FILE_TOOLS.includes('Bash'), false);
  assert.strictEqual(WORKER.CLAUDE_DISALLOWED_TOOLS.includes('Bash'), true);
  assert.throws(() => WORKER.assertClaudeModelSandboxPolicy(WORKER.CLAUDE_SETTINGS,
    [...WORKER.CLAUDE_FILE_TOOLS, 'Bash'], WORKER.CLAUDE_DISALLOWED_TOOLS),
  /does not enforce file-only tools/);
  assert.throws(() => WORKER.assertClaudeModelSandboxPolicy(WORKER.CLAUDE_SETTINGS,
    WORKER.CLAUDE_FILE_TOOLS, []), /does not enforce file-only tools/);
});

test('Claude tool policy denies model-issued reads of subscription config and sensitive homes', () => {
  const deny = WORKER.CLAUDE_SETTINGS.permissions.deny;
  for (const rule of [
    'Read(~/.claude.json)', 'Read(~/.claude/settings.json)', 'Read(~/.claude/**)',
    'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.config/gcloud/**)',
    'Read(~/Library/Keychains/**)', 'Bash(security *)', 'Bash(/usr/bin/security *)',
  ]) assert.strictEqual(deny.includes(rule), true, rule);
});

test('Claude expired OAuth is classified as MODEL_AUTH_FAILURE only on a terminal non-zero exit', () => {
  const text = 'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.';
  const failure = WORKER.classifyBuilderFailure('claude-subscription', 1, text, '');
  assert.deepStrictEqual(failure, {
    code: 'MODEL_AUTH_FAILURE',
    provider: 'claude-subscription',
    summary: 'Claude authentication expired. AEGIS marked Claude unavailable and identified the next eligible builder, but governed failover execution is not activated for this beta.',
    retrySafe: true,
    failoverEligible: true,
  });
  assert.strictEqual(WORKER.classifyBuilderFailure('claude-subscription', 0, text, ''), null);
  assert.strictEqual(WORKER.classifyBuilderFailure('grok-subscription', 1, text, ''), null);
});

test('Claude auth failure records a non-executable Grok candidate and blocks unsafe retry', () => {
  const f = fixture('Preserve this objective exactly across provider failover.',
    { FAKE_CLAUDE_MODE: 'auth-fail' });
  const failed = waitFor(f.read, (run) => run.state === 'BUILD_FAILED');
  assert.strictEqual(failed.build.failure.code, 'MODEL_AUTH_FAILURE');
  assert.deepStrictEqual(failed.build.providerSelection, {
    provider: 'grok-subscription',
    model: 'grok-4.6',
    reason: failed.build.providerSelection.reason,
  });
  assert.match(failed.build.providerSelection.reason, /next eligible canonical subscription builder/);
  assert.match(failed.build.providerSelection.reason, /failover execution is not activated/);
  assert.strictEqual(failed.build.handoff.state, 'UNAVAILABLE');
  assert.strictEqual(failed.build.handoff.executable, false);
  assert.match(failed.build.handoff.reason, /not activated for this beta/);
  assert.strictEqual(failed.build.handoff.sameProviderRetryAllowed, false);
  assert.strictEqual(failed.build.handoff.unchangedObjective, true);
  assert.strictEqual(failed.build.recovery.retrySafe, false);
  assert.strictEqual(failed.build.recovery.providerFailoverRequired, true);
  assert.strictEqual(failed.build.recovery.selectedProvider, 'grok-subscription');
  assert.strictEqual(failed.build.authorizedMutationObserved, false);
  const retry = control(f,
    `try{R.retryRun(${JSON.stringify(f.runId)});process.exit(9)}catch(e){console.log(e.code)}`);
  assert.strictEqual(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /RECOVERY_UNSAFE/);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('unchanged objective never reselects the unavailable Claude provider', () => {
  const prompt = 'Implement the exact canonical objective; do not drift.';
  const launch = { provider: 'claude-subscription', model: 'opus', prompt };
  const failure = WORKER.classifyBuilderFailure('claude-subscription', 1,
    'API Error: 401 OAuth access token has expired', '');
  const selected = WORKER.selectFailoverBuilder(launch, failure,
    { objective: 'Bound AEGIS operator dashboard objective exactly.' });
  assert.strictEqual(selected.launchSpec.provider, 'grok-subscription');
  assert.notStrictEqual(selected.launchSpec.provider, launch.provider);
  assert.strictEqual(selected.launchSpec.prompt, prompt);
  assert.strictEqual(selected.handoff.state, 'UNAVAILABLE');
  assert.strictEqual(selected.handoff.executable, false);
  assert.strictEqual(selected.handoff.sameProviderRetryAllowed, false);
  assert.strictEqual(selected.handoff.unchangedObjective, true);
});

test('canonical policy selects Grok 4.6 as the next eligible subscription builder', () => {
  const policy = WORKER.loadModelRoutingPolicy();
  assert.deepStrictEqual(policy.fallbacks.orchestrator, ['claude', 'grok-builder']);
  assert.deepStrictEqual(policy.models['grok-builder'].workerRoute,
    { provider: 'grok-subscription', model: 'grok-4.6' });
  const selected = WORKER.selectFailoverBuilder(
    { provider: 'claude-subscription', model: 'opus', prompt: 'same prompt' },
    { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription', failoverEligible: true },
    { objective: 'same objective' }, policy);
  assert.strictEqual(selected.launchSpec.model, 'grok-4.6');
  assert.match(selected.selectionReason, /next eligible canonical subscription builder/);
  assert.match(selected.selectionReason, /failover execution is not activated/);
  assert.strictEqual(selected.handoff.state, 'UNAVAILABLE');
  assert.strictEqual(selected.handoff.executable, false);
  assert.match(selected.handoff.objectiveSha256, /^[0-9a-f]{64}$/);
  assert.match(selected.handoff.promptSha256, /^[0-9a-f]{64}$/);
});

test('Grok launch descriptor pins exact file-only argv inside the outer deny-default packet boundary', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-grok-launch-'));
  const prior = {
    NODE_ENV: process.env.NODE_ENV,
    executable: process.env.AEGIS_TEST_GROK_EXECUTABLE,
    containment: process.env.AEGIS_TEST_CONTAINMENT_MODE,
  };
  let grokHome;
  try {
    const worktree = path.join(tmp, 'worktree');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'before\n');
    fs.writeFileSync(path.join(worktree, 'check.cjs'), 'process.exit(0);\n');
    const packet = path.join(worktree, 'packet.json');
    fs.writeFileSync(packet, JSON.stringify({
      packetId: 'PKT-GROK-ARGV',
      agentId: 'claude-code',
      sourceOfTruth: ['allowed.txt'],
      testsRequired: ['node check.cjs'],
      filesAllowed: ['allowed.txt'],
    }));
    const executable = path.join(tmp, 'grok-fixture');
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    grokHome = fs.mkdtempSync('/private/tmp/aegis-grok-');
    fs.chmodSync(grokHome, 0o700);
    fs.mkdirSync(path.join(grokHome, '.grok'), { mode: 0o700 });
    fs.mkdirSync(path.join(grokHome, 'tmp'), { mode: 0o700 });
    process.env.NODE_ENV = 'test';
    process.env.AEGIS_TEST_GROK_EXECUTABLE = executable;
    process.env.AEGIS_TEST_CONTAINMENT_MODE = 'DETERMINISTIC_PROFILE_ONLY';

    const prompt = '--dangerously-skip-permissions; $(touch never)';
    const prepared = WORKER.prepareGrokLaunch(
      { objective: 'bound objective', packet, worktree: { path: worktree } },
      { provider: 'grok-subscription', model: 'grok-4.6', prompt }, grokHome);
    assert.strictEqual(prepared.command.bin, CONTAINMENT.SANDBOX_EXEC);
    assert.strictEqual(prepared.contained.profile.profile.startsWith('(version 1)\n(deny default)\n'), true);
    assert.strictEqual(prepared.contained.allowlists.packetId, 'PKT-GROK-ARGV');
    assert.deepStrictEqual(prepared.contained.allowlists.writePaths, ['allowed.txt']);
    assert.deepStrictEqual(prepared.argv, [
      '--single', prompt, '--model', 'grok-4.6', '--permission-mode', 'acceptEdits',
      '--output-format', 'plain', '--no-subagents', '--verbatim', '--no-plan',
      '--disable-web-search', '--tools', 'read_file,search_replace,grep,list_dir',
      '--disallowed-tools', 'run_terminal_cmd,web_search,web_fetch,task', '--max-turns', '32',
    ]);
    assert.strictEqual(prepared.argv.includes('bypassPermissions'), false);
    assert.strictEqual(prepared.argv.includes('run_terminal_cmd'), false,
      'the shell tool must appear only inside the disallowed-tools value');
    assert.strictEqual(prepared.env.HOME, grokHome);
    assert.strictEqual(prepared.env.GROK_HOME, path.join(grokHome, '.grok'));
    assert.strictEqual(prepared.env.GROK_MANAGED_MCPS_ENABLED, 'false');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(prepared.env, 'ANTHROPIC_API_KEY'), false);
  } finally {
    if (prior.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior.NODE_ENV;
    if (prior.executable === undefined) delete process.env.AEGIS_TEST_GROK_EXECUTABLE;
    else process.env.AEGIS_TEST_GROK_EXECUTABLE = prior.executable;
    if (prior.containment === undefined) delete process.env.AEGIS_TEST_CONTAINMENT_MODE;
    else process.env.AEGIS_TEST_CONTAINMENT_MODE = prior.containment;
    if (grokHome) fs.rmSync(grokHome, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Grok builder cannot review or approve its own exact subject', () => {
  const selected = WORKER.selectFailoverBuilder(
    { provider: 'claude-subscription', model: 'opus', prompt: 'exact subject prompt' },
    { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription', failoverEligible: true },
    { objective: 'exact subject objective' });
  assert.strictEqual(selected.handoff.builderMayApproveOwnWork, false);
  assert.deepStrictEqual(selected.handoff.excludedSelfReviewModels, ['grok']);
  assert.deepStrictEqual(selected.handoff.independentReviewers,
    [{ roleId: 'implementation-review', model: 'codex', providerFamily: 'codex' }]);
});

test('production Claude executable is an absolute approved version pin', () => {
  assert.strictEqual(path.isAbsolute(WORKER.CLAUDE_EXECUTABLE), true);
  assert.strictEqual(WORKER.CLAUDE_VERSION, '2.1.245');
  assert.strictEqual(path.basename(WORKER.CLAUDE_EXECUTABLE), '2.1.245');
  assert.match(WORKER.CLAUDE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(WORKER.resolveClaudeExecutable(), fs.realpathSync(WORKER.CLAUDE_EXECUTABLE));
});

(async () => {
  let passed = 0;
  let skipped = 0;
  for (const t of tests) {
    try {
      const result = await t.fn();
      if (result && result.skipped) {
        skipped++;
        console.log(`SKIP ${t.name} — ${result.skipped}`);
      } else {
        passed++;
        console.log(`PASS ${t.name}`);
      }
    }
    catch (e) { console.error(`FAIL ${t.name}\n${e.stack || e}`); }
  }
  console.log(`\n${passed} passed, ${skipped} skipped, ${tests.length - passed - skipped} failed.`);
  if (skipped > 0) {
    console.error(`\nMANDATORY PROOFS NOT EXECUTED (${skipped}) — this suite is NOT green.`);
  }
  // Green requires every registered proof to have actually run and passed.
  process.exit(passed === tests.length ? 0 : 1);
})();
