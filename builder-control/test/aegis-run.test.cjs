#!/usr/bin/env node
/**
 * aegis-run.test.cjs — red proofs for the V1 runtime.
 *
 * The runtime's whole value is that it REFUSES: a build with no worktree, a
 * checkpoint over unchecked work, a rollback with no recorded point, a state
 * reached by skipping an earlier one. A state machine that can be nudged
 * forward is a progress bar, so every case here asserts a refusal.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Worker } = require('worker_threads');

const ROOT = path.resolve(__dirname, '..', '..');

function checkedTestCommand(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding === null ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
    killSignal: 'SIGKILL',
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message :
      String(result.stderr || result.stdout || `${command} exited ${result.status}`).trim();
    throw new Error(`${label} failed: ${detail}`);
  }
  return result;
}

function outerSnapshotEvidence() {
  if (process.env.AEGIS_CHECK_SNAPSHOT_POLICY !== 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1') return null;
  const cwd = fs.realpathSync(process.cwd());
  const boundaryRoot = path.dirname(cwd);
  if (path.basename(cwd) !== 'worktree' ||
      !path.basename(boundaryRoot).startsWith('aegis-check-boundary-')) {
    throw new Error('AEGIS_CHECK_SNAPSHOT_POLICY was asserted outside the canonical immutable snapshot path');
  }
  try {
    fs.readFileSync('/private/etc/hosts');
    throw new Error('outer snapshot marker is untrusted because a non-allowlisted host file remained readable');
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error && error.code)) throw error;
  }
  const outsideWrite = path.join(fs.realpathSync('/private/tmp'), `aegis-outer-write-${process.pid}`);
  try {
    fs.writeFileSync(outsideWrite, 'must not escape\n', { flag: 'wx' });
    try { fs.unlinkSync(outsideWrite); } catch {}
    throw new Error('outer snapshot marker is untrusted because an external write remained possible');
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error && error.code)) throw error;
  }
  return Object.freeze({
    policy: process.env.AEGIS_CHECK_SNAPSHOT_POLICY,
    cwd,
    boundaryRoot,
    deniedHostRead: true,
    deniedExternalWrite: true,
  });
}

const OUTER_SNAPSHOT = outerSnapshotEvidence();
const HOST_ONLY = process.argv.slice(2).includes('--host-only');
const HOST_PROOF_ONLY = process.argv.slice(2).includes('--host-proof-only');
// A fixed-purpose selector for the global-claim admission proofs only. It adds
// no framework and no pattern matching: the selected case names are a frozen
// literal list below, and every one of them must still run.
const REVIEW_ADMISSION_ONLY = process.argv.slice(2).includes('--review-admission-only');
// The same fixed-purpose shape for the step 10 checkpoint proofs. It selects a
// frozen literal list of case names and nothing else; it is a subset, never a
// gate, and it claims nothing about the rest of the suite.
const CHECKPOINT_ONLY = process.argv.slice(2).includes('--checkpoint-only');

function assertIsolatedRepositoryMarker() {
  const marker = process.env.AEGIS_TEST_ISOLATED_REPOSITORY;
  if (!marker) return false;
  const isolatedRoot = fs.realpathSync(marker);
  const tmpRoot = fs.realpathSync('/private/tmp');
  if (!isolatedRoot.startsWith(path.join(tmpRoot, 'aegis-run-suite-')) ||
      fs.realpathSync(ROOT) !== path.join(isolatedRoot, 'repo')) {
    throw new Error('AEGIS_TEST_ISOLATED_REPOSITORY does not identify this disposable repository');
  }
  const common = checkedTestCommand('resolve isolated repository common dir', 'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT }).stdout.trim();
  if (fs.realpathSync(common) !== fs.realpathSync(path.join(ROOT, '.git'))) {
    throw new Error('test repository is not an independent disposable clone');
  }
  return true;
}

function runInDisposableExactRepository() {
  if (OUTER_SNAPSHOT || assertIsolatedRepositoryMarker()) return;
  const isolatedRoot = fs.mkdtempSync(path.join(fs.realpathSync('/private/tmp'), 'aegis-run-suite-'));
  const repo = path.join(isolatedRoot, 'repo');
  let child;
  try {
    checkedTestCommand('clone exact test repository', 'git',
      ['clone', '--no-hardlinks', '--quiet', ROOT, repo]);
    const diff = checkedTestCommand('capture exact tracked source', 'git',
      ['diff', 'HEAD', '--binary', '--no-ext-diff', '--'], { cwd: ROOT, encoding: null });
    if (diff.stdout.length) {
      checkedTestCommand('apply exact tracked source', 'git',
        ['apply', '--index', '--binary', '--whitespace=nowarn', '-'],
        { cwd: repo, input: diff.stdout, encoding: null });
    }
    const subject = JSON.parse(checkedTestCommand('resolve exact canonical subject', process.execPath,
      [path.join(ROOT, 'builder-control', 'engineering-os.cjs'), '--subject', '--json'],
      { cwd: ROOT }).stdout);
    for (const relative of subject.subjectPaths || []) {
      const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', relative], {
        cwd: ROOT, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
      });
      if (tracked.error) throw new Error(`canonical subject tracking inspection failed: ${tracked.error.message}`);
      if (tracked.status === 0) continue;
      const source = path.join(ROOT, relative);
      const observed = fs.lstatSync(source);
      if (observed.isSymbolicLink() || !observed.isFile() || observed.nlink !== 1) {
        throw new Error(`canonical untracked subject is unsafe: ${relative}`);
      }
      const target = path.join(repo, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, observed.mode & 0o777);
      checkedTestCommand('publish canonical untracked subject intent', 'git',
        ['add', '-N', '--', relative], { cwd: repo });
    }
    const frozenReviewFixtures = HOST_ONLY || REVIEW_ADMISSION_ONLY || CHECKPOINT_ONLY ? [] : [
      'builder-control/review-raw/20260828220306-grok.txt',
      'builder-control/review-raw/20260829021134-grok.txt',
    ];
    for (const relative of frozenReviewFixtures) {
      const source = path.join(ROOT, relative);
      const observed = fs.lstatSync(source);
      if (observed.isSymbolicLink() || !observed.isFile() || observed.size <= 0 || observed.size > 4 * 1024 * 1024) {
        throw new Error(`required frozen host fixture is unsafe: ${relative}`);
      }
      const target = path.join(repo, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, fs.readFileSync(source), { flag: 'wx', mode: observed.mode & 0o777 });
    }
    const copiedSubject = JSON.parse(checkedTestCommand('verify copied canonical subject', process.execPath,
      [path.join(repo, 'builder-control', 'engineering-os.cjs'), '--subject', '--json'],
      { cwd: repo }).stdout);
    assert.deepStrictEqual(copiedSubject.subjectPaths, subject.subjectPaths,
      'the disposable repository changed the canonical subject path set');
    assert.strictEqual(copiedSubject.subjectSha256, subject.subjectSha256,
      'the disposable repository changed canonical subject bytes');
    assert.strictEqual(copiedSubject.diffBytes, subject.diffBytes,
      'the disposable repository changed canonical diff byte count');
    child = spawnSync(process.execPath, [
      path.join(repo, 'builder-control', 'test', 'aegis-run.test.cjs'),
      ...(HOST_ONLY ? ['--host-only'] : []),
      ...(HOST_PROOF_ONLY ? ['--host-proof-only'] : []),
      ...(REVIEW_ADMISSION_ONLY ? ['--review-admission-only'] : []),
      ...(CHECKPOINT_ONLY ? ['--checkpoint-only'] : []),
    ], {
      cwd: repo,
      env: { ...process.env, AEGIS_TEST_ISOLATED_REPOSITORY: isolatedRoot },
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60_000, killSignal: 'SIGKILL',
    });
    process.stdout.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
  if (!child || child.error || child.status !== 0) {
    const detail = child && child.error ? child.error.message : `exit ${child && child.status}`;
    throw new Error(`disposable exact-source suite failed: ${detail}`);
  }
  process.exit(0);
}

runInDisposableExactRepository();

// These proofs intentionally create short-lived canonical packet fixtures in
// the repository. Serialize the complete fixture lifecycle across concurrent
// invocations so another test process cannot change the canonical subject
// while this process is establishing or re-checking it.
function acquireRepositoryFixtureLock() {
  const lockName = `.aegis-run-fixtures-${crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 16)}.lock`;
  const lockDir = path.join(fs.realpathSync(os.tmpdir()), lockName);
  const deadline = Date.now() + 120_000;
  const identity = fixtureProcessIdentity(process.pid);
  if (!identity) throw new Error('cannot establish repository fixture lock process identity');
  const owner = { pid: process.pid, root: ROOT, processIdentity: identity };
  const ownerBytes = JSON.stringify(owner);
  while (Date.now() < deadline) {
    try {
      // One O_EXCL write publishes the complete owner record. There is no
      // observable directory-without-owner interval for another contender to
      // mistake for a stale lock.
      fs.writeFileSync(lockDir, ownerBytes, { flag: 'wx', mode: 0o600 });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          if (fs.readFileSync(lockDir, 'utf8') === ownerBytes) fs.unlinkSync(lockDir);
        } catch { /* a missing or replaced claim is never removed by guess */ }
      };
      Object.defineProperty(release, 'lockPath', { value: lockDir });
      Object.defineProperty(release, 'owner', { value: Object.freeze(owner) });
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let observed = null;
      try { observed = JSON.parse(fs.readFileSync(lockDir, 'utf8')); }
      catch { /* malformed or unreadable publication remains authoritative */ }
      const ownerPid = observed && observed.pid;
      let ownerAlive = false;
      if (Number.isInteger(ownerPid) && ownerPid > 1) {
        try { process.kill(ownerPid, 0); ownerAlive = true; }
        catch (probeError) { ownerAlive = probeError.code !== 'ESRCH'; }
      }
      const currentIdentity = ownerAlive ? fixtureProcessIdentity(ownerPid) : null;
      const sameLifetime = ownerAlive && observed && observed.processIdentity && currentIdentity &&
        observed.processIdentity.pid === currentIdentity.pid &&
        observed.processIdentity.startedAt === currentIdentity.startedAt &&
        observed.processIdentity.command === currentIdentity.command;
      // A live PID whose identity cannot be inspected is not stale evidence.
      // Reclaim only on positive absence, or when a complete current identity
      // positively proves this is a different process lifetime.
      if (observed && (!ownerAlive || (currentIdentity && !sameLifetime))) {
        const tombstone = `${lockDir}.stale-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
        try {
          // Rename reclaims exactly the generation inspected above. A new
          // claimant may publish only after this atomic move, and cannot be
          // deleted by the stale owner's cleanup.
          fs.renameSync(lockDir, tombstone);
          fs.unlinkSync(tombstone);
        } catch { /* another contender won; retry without broad deletion */ }
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  throw new Error(`timed out waiting for repository fixture lock ${lockDir}`);
}

function fixtureProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const probe = spawnSync('ps', ['-o', 'lstart=', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  const line = (probe.stdout || '').trim();
  if (probe.status !== 0 || !line) return null;
  const match = line.match(/^(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/);
  return match ? { pid, startedAt: match[1], command: match[2] } : null;
}

const releaseRepositoryFixtureLock = OUTER_SNAPSHOT ? () => {} : acquireRepositoryFixtureLock();
process.once('exit', releaseRepositoryFixtureLock);

function removeStaleCanonicalCheckPackets() {
  const packetsDir = path.join(ROOT, 'builder-control', 'packets');
  for (const name of fs.readdirSync(packetsDir)) {
    const match = name.match(/^PKT-TEST-CHECKS-(\d+)-[0-9a-f]+\.json$/);
    if (!match) continue;
    const ownerPid = Number(match[1]);
    let ownerAlive = false;
    try { process.kill(ownerPid, 0); ownerAlive = true; }
    catch (error) { ownerAlive = error.code !== 'ESRCH'; }
    if (!ownerAlive) fs.rmSync(path.join(packetsDir, name), { force: true });
  }
}

if (!OUTER_SNAPSHOT) removeStaleCanonicalCheckPackets();

const CLI = path.join(ROOT, 'builder-control', 'aegis-run.cjs');
const SERVER = path.join(ROOT, 'builder-control', 'hosting', 'server.cjs');
const R = require('../aegis-run.cjs');
const STATE = require('../aegis-state.cjs');

let passed = 0;
let skipped = 0;
const skip = (reason) => ({ skipped: String(reason || 'not applicable') });
// The exact cases --review-admission-only selects: the existing canonical
// global-claim recovery proofs, plus the new review-hold admission proofs.
// This is a subset, never a gate — it claims nothing about the rest of the
// suite and must never be reported as full coverage.
const REVIEW_ADMISSION_CASES = Object.freeze([
  'global worker admission refuses a second run before BUILDING mutation',
  'launch claim: a reused numeric PID with a different process lifetime is reclaimed without signalling it',
  'launch claim: a positively absent crashed owner is reclaimed without signalling',
  'global lease transfer defeats a stale launcher decision and stale generations cannot release',
  'global admission recovers an empty directory left by interrupted release',
  'launch claim: live owner with unavailable identity observation fails closed and is preserved',
  'launch claim: an incomplete sibling publication cannot wedge the canonical claim',
  'launch claim: two stale-claim reclaimers cannot unlink the newly acquired owner',
  'review admission: one atomic REVIEW_HOLD generation excludes a second review and a builder',
  'review admission: a dead or reused caller never frees a review hold',
  'review admission: generic, stale and unproven release all preserve the held bytes',
  'review admission: another live process cannot release a hold it does not own',
  'review admission: proven lifecycle evidence releases the slot back to the builders',
  'review request: an ineligible run or an unnamed reviewer never launches',
  'review request: caller authorization, proof and coordinate fields are refused outright',
  'review request: evidence that changed under both claims refuses without launching',
  'review request: an eligible request reaches the canonical reviewer exactly once',
  'review request: contention for the single admission slot refuses without launching',
  'review request: only this invocation\'s own lifecycle evidence frees admission',
  'review request: an unexpected preflight or admission failure is answered, not thrown',
  'review request: a failed cleanup neither escapes nor reports a freed hold',
]);
const selectedReviewAdmissionCases = new Set();
// The exact cases --checkpoint-only selects: the existing step 10 checkpoint
// proof and checkpointCandidateProblem cases, plus the new proofs for the
// shared CLI/internal checkpoint authority. Same rule as above — a subset that
// must never be reported as full coverage.
const CHECKPOINT_CASES = Object.freeze([
  'STEP 10: checkpoint consumes authenticated prerequisites and records a real rollback point while restoration stays deferred',
  'STEP 9 gates STEP 10: a checkpoint over a drifted run is refused',
  'checkpoint candidate accepts one clean descendant containing the exact reviewed subject',
  'checkpoint candidate RED: dirty tree, unrelated HEAD, or post-bind subject mutation are refused',
  'checkpoint callable: one internal run-id-only call refuses a dirty subject, then records the same governed checkpoint the CLI records',
  'checkpoint before independent review: callable and CLI refuse identically and mutate nothing',
  'checkpoint: the CLI and the internal callable are one authority with one refusal vocabulary',
  'checkpoint callable is internal only: it carries no host or browser surface of its own',
]);
const selectedCheckpointCases = new Set();
function executeTest(n, fn) {
  if (REVIEW_ADMISSION_ONLY) {
    if (!REVIEW_ADMISSION_CASES.includes(n)) return;
    selectedReviewAdmissionCases.add(n);
  }
  if (CHECKPOINT_ONLY) {
    if (!CHECKPOINT_CASES.includes(n)) return;
    selectedCheckpointCases.add(n);
  }
  try {
    const result = fn();
    if (result && result.skipped) {
      skipped++;
      console.log(`skip ${n} — ${result.skipped}`);
      return;
    }
    passed++; console.log(`ok   ${n}`);
  }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
function test(n, fn) {
  if (HOST_ONLY || HOST_PROOF_ONLY) return;
  return executeTest(n, fn);
}

test('repository fixture lock preserves a live owner when identity inspection is unavailable', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  const lockBody = source.slice(source.indexOf('function acquireRepositoryFixtureLock()'),
    source.indexOf('function fixtureProcessIdentity(pid)'));
  assert.match(lockBody, /!ownerAlive \|\| \(currentIdentity && !sameLifetime\)/,
    'live owner with unavailable identity is still treated as stale');
  assert.doesNotMatch(lockBody, /!ownerAlive \|\| !sameLifetime/,
    'ambiguous identity still permits destructive lock reclamation');
});
function hostContainmentTest(n, fn) {
  if (HOST_PROOF_ONLY) return;
  return executeTest(n, () => OUTER_SNAPSHOT
    ? skip('requires the separately bound top-level host-containment suite')
    : fn());
}
function hostOrchestrationTest(n, fn) {
  if (HOST_ONLY || HOST_PROOF_ONLY) return;
  return executeTest(n, () => OUTER_SNAPSHOT
    ? skip('requires the complete top-level runtime orchestration suite')
    : fn());
}
function governedHostProofTest(n, fn) {
  if (HOST_ONLY) return;
  return executeTest(n, () => OUTER_SNAPSHOT
    ? skip('requires the complete top-level runtime orchestration suite')
    : fn());
}
function assertOuterSnapshotBehavior() {
  assert.ok(OUTER_SNAPSHOT, 'outer immutable snapshot evidence is absent');
  assert.strictEqual(OUTER_SNAPSHOT.policy, 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1');
  assert.strictEqual(OUTER_SNAPSHOT.deniedHostRead, true);
  assert.strictEqual(OUTER_SNAPSHOT.deniedExternalWrite, true);
  assert.strictEqual(fs.realpathSync(process.cwd()), OUTER_SNAPSHOT.cwd);
}

hostContainmentTest('repository fixture lock publishes one complete atomic owner file', () => {
  const stat = fs.lstatSync(releaseRepositoryFixtureLock.lockPath);
  assert.ok(stat.isFile(), 'fixture lock must be one O_EXCL owner file, not a partially published directory');
  const observed = JSON.parse(fs.readFileSync(releaseRepositoryFixtureLock.lockPath, 'utf8'));
  assert.deepStrictEqual(observed, releaseRepositoryFixtureLock.owner);
  assert.ok(observed.processIdentity && observed.processIdentity.startedAt && observed.processIdentity.command,
    'fixture lock owner lacks immutable process-lifetime evidence');
});
const run = (args) => spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });

console.log('AEGIS runtime — red proofs');

test('immutable outer check snapshot is structurally and behaviorally proven', () => {
  if (!OUTER_SNAPSHOT) return skip('host execution validates the live sandbox paths directly');
  assert.strictEqual(OUTER_SNAPSHOT.policy, 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1');
  assert.strictEqual(path.basename(OUTER_SNAPSHOT.cwd), 'worktree');
  assert.match(path.basename(path.dirname(OUTER_SNAPSHOT.cwd)), /^aegis-check-boundary-/);
  assertOuterSnapshotBehavior();
});

// ── the contract is preserved, not shrunk ──────────────────────────────────
test('state-backed contract steps are represented and step 9 remains the separate watchdog gate', () => {
  const steps = new Set(Object.values(R.STATES).map((s) => s.step).filter((n) => n > 0));
  for (const required of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
    assert.ok(steps.has(required), `contract step ${required} has no state — the contract was shrunk to fit`);
  }
  assert.strictEqual(steps.has(9), false, 'the watchdog gate must not masquerade as persisted lifecycle progress');
  assert.strictEqual(typeof R.watchdog, 'function', 'contract step 9 must remain the executable watchdog gate');
});

test('failure states exist for the paths that can fail', () => {
  for (const s of ['BUILD_FAILED', 'CHECKS_FAILED', 'REVIEW_FAILED', 'ROLLED_BACK']) {
    assert.ok(R.STATES[s], `${s} is missing`);
    assert.strictEqual(R.STATES[s].failure, true, `${s} must be marked a failure state`);
  }
});

// ── transitions ────────────────────────────────────────────────────────────
test('RED: a state cannot be reached by skipping an earlier one', () => {
  // CREATED cannot jump to CHECKPOINTED.
  const illegal = [
    ['CREATED', 'CHECKPOINTED'], ['CREATED', 'BUILT'], ['INTAKE_RECORDED', 'BUILDING'],
    ['ROUTED', 'CHECKS_PASSED'], ['WORKTREE_READY', 'CHECKPOINTED'], ['BUILT', 'CHECKPOINTED'],
    ['CREATED', 'REVIEW_FAILED'], ['BUILT', 'REVIEW_FAILED'],
  ];
  for (const [from, to] of illegal) {
    assert.ok(!R.STATES[from].next.includes(to),
      `${from} -> ${to} is permitted; a run could skip the work in between`);
  }
});

test('RED: no override flag is PARSED by the runtime', () => {
  // Checking for the string "--force" matched the doc comment that says there
  // is no --force. The claim that matters is whether the arg parser accepts one,
  // so this asserts on parsing, not on prose.
  const src = fs.readFileSync(CLI, 'utf8');
  for (const flag of ['--force', '--skip', '--override', '--yes', '--no-verify']) {
    const parsed = new RegExp(`t === '${flag}'`).test(src);
    assert.ok(!parsed, `${flag} is parsed as an argument — a state machine with an override is a progress bar`);
  }
  // And no transition may be taken without passing through transition().
  // `=` alone also matched `===` comparisons, which reported 3 assignments
  // where there is 1. Negative lookahead excludes equality tests.
  const setsStateDirectly = (src.match(/run\.state\s*=(?!=)/g) || []).length;
  assert.strictEqual(setsStateDirectly, 1,
    `run.state is assigned in ${setsStateDirectly} places; it must only be set inside transition()`);
});

test('the legal happy path is contiguous', () => {
  const chain = ['CREATED', 'INTAKE_RECORDED', 'ROUTED', 'WORKTREE_READY', 'BUILDING', 'BUILT', 'CHECKS_PASSED'];
  for (let i = 0; i < chain.length - 1; i++) {
    assert.ok(R.STATES[chain[i]].next.includes(chain[i + 1]),
      `${chain[i]} -> ${chain[i + 1]} is not legal, so the loop cannot complete`);
  }
});

test('RED: a failure state cannot jump straight back to success', () => {
  assert.ok(!R.STATES.BUILD_FAILED.next.includes('BUILT'), 'a failed build must not become BUILT without rebuilding');
  assert.ok(!R.STATES.CHECKS_FAILED.next.includes('CHECKS_PASSED'), 'failed checks must not become passed without rerunning');
  assert.ok(R.STATES.BUILD_FAILED.next.includes('CORRECTING'), 'the honest recovery path must exist');
});

// ── intake ─────────────────────────────────────────────────────────────────
test('RED: a run with no objective is refused', () => {
  const r = run(['--new']);
  assert.strictEqual(r.status, 3);
  assert.ok(/NO-OBJECTIVE/.test(r.stderr), 'a run with no stated objective cannot be reviewed against anything');
});

test('RED: an unknown run id is refused, not created', () => {
  const r = run(['--status', 'RUN-19700101-deadbeef']);
  assert.strictEqual(r.status, 3);
  assert.ok(/NO-SUCH-RUN/.test(r.stderr));
});

test('RED: a malformed run id is rejected before any filesystem access', () => {
  const r = run(['--status', '../../etc/passwd']);
  assert.strictEqual(r.status, 3);
  assert.ok(/BAD-RUN-ID/.test(r.stderr), 'a run id must not be able to address arbitrary paths');
});

// ── missing evidence ───────────────────────────────────────────────────────
test('RED: checkpoint requires checks that ACTUALLY passed', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/NO-PASSING-CHECKS/.test(src));
  assert.ok(/!validPassedChecks\(run\.checks,\s*\{\s*runId:\s*run\.runId\s*\}\)/.test(src),
    'a checkpoint must require the complete subject-bound check receipt, not merely counts');
});

test('the configured correction ceiling remains three', () => {
  assert.strictEqual(R.MAX_CORRECTIONS, 3);
});

// ── no parallel authority ──────────────────────────────────────────────────
test('every transition is recorded in the CANONICAL ledger', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/LEDGER_WRITER/.test(src) && /--append/.test(src),
    'transitions must append to the one canonical ledger');
  assert.ok(/operationId/.test(src) && /correlationId/.test(src),
    'a retried transition must be idempotent, not a duplicate event');
  assert.ok(/A transition that cannot be recorded did not happen/.test(src),
    'a ledger refusal must fail the transition, not be swallowed');
  // And it must not invent its own permission or verdict system.
  assert.ok(!/allowsProtectedPaths\s*=/.test(src), 'the runtime must not grant its own permissions');
  assert.ok(!/disposition\s*[:=]\s*['"]APPROVE/.test(src), 'the runtime must never author a review verdict');
});

test('run files are working state — deleting them loses no authority', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/WORKING STATE, not a source of truth/.test(src));
  // The packet is the permission; the runtime only references it.
  assert.ok(/run\.packet/.test(src), 'the runtime reads the packet rather than replacing it');
});

// ── cost projection: recorded evidence only ────────────────────────────────
test('RED: cost is never estimated for a run whose telemetry was lost', () => {
  const c = STATE.projectCost();
  assert.ok(c.state === 'OK' || c.state === 'UNAVAILABLE');
  if (c.state !== 'OK') return;
  for (const r of c.runs) {
    if (r.state === 'UNRECORDED') {
      assert.strictEqual(r.usd, null, 'an unrecorded run must have no dollar figure at all');
      assert.ok(r.reason, 'it must say why the figure is missing');
    }
  }
  if (c.unrecordedRuns > 0) {
    assert.ok(typeof c.totalUsd === 'string' && /^AT LEAST /.test(c.totalUsd),
      'with runs missing telemetry the total must be a floor, not a number pretending to be exact');
    assert.ok(c.caveat && /higher than the recorded figure/.test(c.caveat));
  }
});

test('RED: cost is read from the run OWN envelope, never from quoted text', () => {
  // A reviewer that READ another reviewer's transcript had that run's cost
  // attributed to itself — two Codex files reported Grok's exact figures.
  const src = fs.readFileSync(path.join(__dirname, '..', 'aegis-state.cjs'), 'utf8');
  assert.ok(/ownEnvelope/.test(src), 'cost must come from the top-level envelope only');
  assert.ok(/quoted while Codex was reviewing/.test(src), 'the reason must be recorded where it can be read');
});

test('metered and subscription spend are reported separately', () => {
  const c = STATE.projectCost();
  if (c.state !== 'OK') return;
  assert.ok(c.byReviewer, 'a single blended figure would misreport the metered cap');
  for (const [who, v] of Object.entries(c.byReviewer)) {
    assert.ok(typeof v.recordedUsd === 'number', `${who} has no numeric recorded spend`);
    assert.ok(v.recordedRuns >= 0 && v.unrecordedRuns >= 0);
  }
});

test('RED: absent transcripts render UNAVAILABLE, not zero cost', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'aegis-state.cjs'), 'utf8');
  assert.ok(/state: 'UNAVAILABLE', reason: `no reviewer transcripts/.test(src),
    'a missing directory must not read as "nothing was spent"');
});

// ── STEP 10: checkpoint persistence and deferred rollback integration ─────
// Check and review authorities are tested independently. This fixture starts
// with authenticated synthetic prerequisites so it can isolate checkpoint
// commit binding, receipt persistence, and deferred rollback policy.
// Previously only the refusal paths were proven. The persistence path could not run
// because an isolated worktree sits at the base commit and committing to the
// product branch is forbidden. A disposable linked worktree keeps the fixture
// in the canonical repository while leaving the product branch untouched.
//
// Those prerequisites are expensive and identical for every checkpoint proof: a
// linked worktree at the canonical HEAD, a run driven to REVIEW_BOUND through
// REAL transitions the watchdog can corroborate against a temp ledger, and one
// persisted canonical check receipt bound to that exact subject. Building them
// once, here, is what lets the CLI proof and the internal-callable proof consume
// the SAME prerequisites instead of two fixtures that could quietly disagree
// about what was proven.
function createCheckpointFixture() {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cp-'));
  const repo = path.join(TMP, 'repo');
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  fs.mkdirSync(runsDir, { recursive: true });

  const g = (args, cwd = repo) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const rootHead = g(['-C', ROOT, 'rev-parse', 'HEAD'], ROOT).stdout.trim();
  const branch = `aegis/test-checkpoint-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const added = g(['-C', ROOT, 'worktree', 'add', '-q', '-b', branch, repo, rootHead], ROOT);
  assert.strictEqual(added.status, 0, `could not create canonical linked worktree: ${added.stderr}`);
  const cleanup = () => {
    g(['-C', ROOT, 'worktree', 'remove', '--force', repo], ROOT);
    g(['-C', ROOT, 'branch', '-D', branch], ROOT);
    fs.rmSync(TMP, { recursive: true, force: true });
  };
  process.once('exit', cleanup);
  const fixtureRel = `builder-control/.aegis-checkpoint-fixture-${process.pid}.txt`;
  const fixtureFile = path.join(repo, fixtureRel);
  fs.writeFileSync(fixtureFile, 'good state\n');
  g(['add', '--', fixtureRel]);
  g(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=AEGIS Fixture',
    'commit', '-q', '-m', 'fixture base']);
  const reviewedBase = g(['rev-parse', 'HEAD']).stdout.trim();
  assert.ok(/^[0-9a-f]{40}$/.test(reviewedBase), 'fixture repo has no commit');
  fs.writeFileSync(fixtureFile, 'reviewed good state\n');

  // The run must reach CHECKS_PASSED through REAL transitions, because the
  // watchdog cross-checks every transition against the canonical ledger — a
  // hand-written run file is exactly what it refuses. A temp ledger keeps that
  // real without touching the production one.
  const ledger = path.join(TMP, 'ledger.json');
  fs.writeFileSync(ledger, '[]\n');
  const CLI2 = path.join(ROOT, 'builder-control', 'aegis-run.cjs');
  const env = {
    ...process.env,
    AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: cpDir, AEGIS_LEDGER_FILE: ledger,
  };

  const runId = `RUN-20260825-a1b2c3d4`;
  const seed = {
    runId, createdAt: '2026-08-25T06:00:00Z', updatedAt: '2026-08-25T06:00:00Z',
    state: 'CREATED', objective: 'fixture checkpoint/rollback',
    packet: 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json', baseCommit: reviewedBase,
    worktree: { path: repo, branch, baseCommit: reviewedBase },
    build: { exit: 0 }, checks: null,
    checkpoint: null, corrections: 0, transitions: [],
  };
  fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(seed, null, 2));

  // Drive the real transition() so each step is recorded in the temp ledger.
  const driver = `
    process.env.AEGIS_RUNS_DIR = ${JSON.stringify(runsDir)};
    process.env.AEGIS_CHECKPOINTS_DIR = ${JSON.stringify(cpDir)};
    process.env.AEGIS_LEDGER_FILE = ${JSON.stringify(ledger)};
    const R = require(${JSON.stringify(path.join(ROOT, 'builder-control', 'aegis-run.cjs'))});
    const run = R.loadRun(${JSON.stringify(runId)});
    for (const to of ['INTAKE_RECORDED','ROUTED','WORKTREE_READY','BUILDING','BUILT','CHECKS_PASSED','REVIEW_BOUND']) {
      R.transition(run, to, 'fixture');
    }
  `;
  const drive = spawnSync('node', ['-e', driver], { cwd: ROOT, encoding: 'utf8', env });
  assert.strictEqual(drive.status, 0, `could not drive the fixture run: ${drive.stderr}`);
  const ledgerEntries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.strictEqual(ledgerEntries.length, 7, `expected 7 recorded transitions, got ${ledgerEntries.length}`);
  const exec = (args) => spawnSync('node', [CLI2, ...args], { cwd: ROOT, encoding: 'utf8', env });

  const subjectRun = spawnSync('node', [path.join(ROOT, 'builder-control', 'engineering-os.cjs'), '--subject', '--json'],
    { cwd: ROOT, encoding: 'utf8', env: { ...env, GIT_DIR: path.join(repo, '.git'), GIT_WORK_TREE: repo } });
  assert.strictEqual(subjectRun.status, 0, subjectRun.stderr);
  const subject = JSON.parse(subjectRun.stdout);
  assert.ok(subject.subjectPaths.length > 0, 'fixture subject is empty');
  const packetPath = path.join(ROOT, seed.packet);
  const packetSha256 = crypto.createHash('sha256').update(fs.readFileSync(packetPath)).digest('hex');
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const commands = (packet.testsRequired || []).filter((command) => {
    const tokens = String(command).trim().split(/\s+/);
    return !(tokens[0] === 'node' && (tokens[1] || '').replace(/^\.\//, '') === 'builder-control/engineering-os.cjs' && tokens.includes('--gate-done'));
  });
  const receiptBody = {
    schemaVersion: 1, authority: 'aegis-run.cjs runChecks', runId,
    packet: { path: seed.packet, sha256: packetSha256 },
    subject: { subjectSha256: subject.subjectSha256, subjectPaths: subject.subjectPaths, diffBytes: subject.diffBytes, range: subject.range },
    startedAt: '2026-08-25T06:01:00Z', completedAt: '2026-08-25T06:02:00Z', complete: true, outcome: 'PASS',
    total: commands.length, passed: commands.length,
    results: commands.map((cmd) => ({ cmd, status: 'EXECUTED', exit: 0, ranAt: '2026-08-25T06:01:30Z' })),
    ...(Array.isArray(packet.hostContainmentRequired) && packet.hostContainmentRequired.length ? {
      hostContainment: passingHostContainmentReceipt(runId, {
        path: seed.packet,
        sha256: packetSha256,
      }, {
        subjectSha256: subject.subjectSha256,
        subjectPaths: subject.subjectPaths,
        diffBytes: subject.diffBytes,
        range: subject.range,
      }, packet.hostContainmentRequired[0]),
    } : {}),
  };
  const receipt = { ...receiptBody, receiptSha256: R.checkReceiptDigest(receiptBody) };
  let prepared = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  prepared.checks = { ranAt: receipt.completedAt, total: receipt.total, passed: receipt.passed,
    results: receipt.results.map((r) => ({ cmd: r.cmd, exit: 0, ranAt: r.ranAt })), receipt };
  prepared.subject = { subjectSha256: subject.subjectSha256, pathCount: subject.subjectPaths.length,
    diffBytes: subject.diffBytes, range: subject.range };
  prepared.reviewGate = { subjectSha256: subject.subjectSha256, checkReceiptSha256: receipt.receiptSha256,
    packet: receipt.packet, headCommit: reviewedBase };
  fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(prepared, null, 2));
  const persistReceipt = spawnSync('node', ['-e', `
    const R = require(${JSON.stringify(path.join(ROOT, 'builder-control', 'aegis-run.cjs'))});
    const run = R.loadRun(${JSON.stringify(runId)});
    run.checks.receiptRef = R.persistCanonicalCheckReceipt(run, run.checks.receipt);
    delete run.checks.receipt;
    R.saveRun(run);
  `], { cwd: ROOT, encoding: 'utf8', env });
  assert.strictEqual(persistReceipt.status, 0, persistReceipt.stderr);

  return Object.freeze({
    TMP, repo, runsDir, cpDir, ledger, env, runId, branch, reviewedBase,
    fixtureRel, fixtureFile, subject, receipt, packetRel: seed.packet, packetSha256,
    objective: seed.objective, g, exec,
    head: () => g(['rev-parse', 'HEAD']).stdout.trim(),
    tree: () => g(['rev-parse', 'HEAD^{tree}']).stdout.trim(),
    readRun: () => JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8')),
    // The ONLY way the reviewed bytes become a commit. Neither entry point
    // creates one, which is exactly what the dirty-tree refusal proves.
    commitReviewedSubject: () => {
      g(['add', '--', fixtureRel]);
      g(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=AEGIS Fixture',
        'commit', '-q', '-m', 'reviewed good']);
    },
    assertNoLeakedClaim: (when) => {
      const leaked = fs.readdirSync(runsDir).filter((name) => name.includes('.launch.lock'));
      assert.deepStrictEqual(leaked, [],
        `the per-run checkpoint claim was left behind ${when}: ${leaked.join(', ')}`);
    },
    finish: () => { process.removeListener('exit', cleanup); cleanup(); },
  });
}

// One bounded call into the runtime with the fixture's isolated directories.
// The module resolves RUNS_DIR/CHECKPOINTS_DIR/LEDGER_FILE from process.env at
// require time and this file has already required it against the real
// directories, so an internal callable can only be exercised honestly in a
// child process — the same isolation withIsolatedRuntime uses.
const CALL_MARKER = 'AEGIS-CALL:';
function callInIsolatedRuntime(env, expression) {
  const r = spawnSync('node', ['-e', `
    const R = require(${JSON.stringify(CLI)});
    let answer;
    try { answer = { ok: true, value: (${expression}) }; }
    catch (e) {
      answer = { ok: false, error: e.constructor.name, code: e.code, httpStatus: e.httpStatus, message: e.message };
    }
    process.stdout.write(${JSON.stringify(CALL_MARKER)} + JSON.stringify(answer));
  `], { cwd: ROOT, encoding: 'utf8', env });
  const at = (r.stdout || '').indexOf(CALL_MARKER);
  assert.notStrictEqual(at, -1, `the callable driver produced no answer: ${r.stderr || r.stdout}`);
  return {
    ...JSON.parse(r.stdout.slice(at + CALL_MARKER.length)),
    driverStatus: r.status, stdout: r.stdout, stderr: r.stderr,
  };
}

test('STEP 10: checkpoint consumes authenticated prerequisites and records a real rollback point while restoration stays deferred', () => {
  const f = createCheckpointFixture();
  try {
    // The browser/run authority cannot manufacture a commit. The reviewed
    // working-tree bytes must first be committed through the approved external
    // narrow-commit path, and a premature checkpoint stays REVIEW_BOUND.
    const precommit = f.exec(['--checkpoint', f.runId]);
    assert.strictEqual(precommit.status, 3,
      `dirty reviewed subject unexpectedly checkpointed: ${precommit.stderr || precommit.stdout}`);
    assert.match(`${precommit.stderr}\n${precommit.stdout}`, /CHECKPOINT-DIRTY-TREE/);
    assert.match(`${precommit.stderr}\n${precommit.stdout}`, /external narrow-commit path/);
    assert.strictEqual(f.readRun().state, 'REVIEW_BOUND');

    f.commitReviewedSubject();
    const goodCommit = f.head();

    // CHECKPOINT — must succeed and name the real commit.
    const cp = f.exec(['--checkpoint', f.runId]);
    assert.strictEqual(cp.status, 0, `checkpoint failed: ${cp.stderr || cp.stdout}`);
    const after = f.readRun();
    assert.strictEqual(after.state, 'CHECKPOINTED');
    assert.strictEqual(after.checkpoint.rollbackPoint, goodCommit,
      'the checkpoint must record the ACTUAL commit, not a placeholder');
    assert.ok(fs.existsSync(path.join(f.cpDir, `${after.checkpoint.checkpointId}.json`)),
      'the checkpoint record must be written to disk');
    // The CLI still prints its own three lines from the shared authority's
    // coordinates, and still exits 0.
    assert.strictEqual(cp.stdout,
      `checkpoint ${after.checkpoint.checkpointId}\n  rollback point: ${goodCommit.slice(0, 12)}\n` +
      `  checks: ${after.checkpoint.checks.passed}/${after.checkpoint.checks.total}\n`,
      'the CLI checkpoint output changed');
    f.assertNoLeakedClaim('after a CLI checkpoint');

    // Now diverge — the situation a rollback exists for.
    fs.writeFileSync(f.fixtureFile, 'broken state\n');
    f.g(['add', '--', f.fixtureRel]);
    f.g(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=AEGIS Fixture',
      'commit', '-q', '-m', 'broken']);
    const brokenCommit = f.head();
    assert.notStrictEqual(brokenCommit, goodCommit, 'the fixture did not actually diverge');
    assert.strictEqual(fs.readFileSync(f.fixtureFile, 'utf8'), 'broken state\n');

    // ROLLBACK — the beta exposes the authenticated point but deliberately
    // refuses destructive reset until the dedicated post-beta control packet.
    const rb = f.exec(['--rollback', f.runId]);
    assert.strictEqual(rb.status, 3, `rollback was not refused: ${rb.stderr || rb.stdout}`);
    assert.match(rb.stderr, /ROLLBACK-DEFERRED/);
    assert.strictEqual(f.head(), brokenCommit, 'a refused beta rollback mutated HEAD');
    assert.strictEqual(fs.readFileSync(f.fixtureFile, 'utf8'), 'broken state\n',
      'a refused beta rollback mutated working-tree content');

    const final = f.readRun();
    assert.strictEqual(final.state, 'CHECKPOINTED');
    assert.strictEqual(final.rollback, undefined);
    assert.strictEqual(final.checkpoint.rollbackPoint, goodCommit,
      'the recoverable point must remain visible even while restoration is deferred');
  } finally { f.finish(); }
});

// ── the internal run-id-only checkpoint callable ───────────────────────────
// The gap this closes: a later dashboard control needs the governed checkpoint
// answer, and the only way to get it was to shell out to the CLI and read
// printed text. The risk in closing it is a SECOND checkpoint path with softer
// gates, so every proof below is aimed at that: same authority, same refusals,
// same evidence chain, no commit, and nothing exposed to a browser.
test('checkpoint callable: one internal run-id-only call refuses a dirty subject, then records the same governed checkpoint the CLI records', () => {
  const f = createCheckpointFixture();
  try {
    // A callable cannot buy what the CLI is refused. The reviewed bytes are
    // still uncommitted, and this call creates no commit to fix that.
    const dirty = callInIsolatedRuntime(f.env, `R.checkpointRun(${JSON.stringify(f.runId)})`);
    assert.strictEqual(dirty.ok, false, 'the callable checkpointed an uncommitted reviewed subject');
    assert.strictEqual(dirty.error, 'AegisControlError');
    assert.strictEqual(dirty.code, 'CHECKPOINT_DIRTY_TREE');
    assert.strictEqual(dirty.httpStatus, 409);
    assert.match(dirty.message, /external narrow-commit path/);
    assert.strictEqual(f.readRun().state, 'REVIEW_BOUND', 'a refused callable moved the run');
    assert.strictEqual(f.readRun().checkpoint, null, 'a refused callable recorded a checkpoint');
    assert.ok(!fs.existsSync(f.cpDir) || fs.readdirSync(f.cpDir).length === 0,
      'a refused callable wrote a checkpoint record');
    assert.strictEqual(f.head(), f.reviewedBase, 'the callable created a commit');
    f.assertNoLeakedClaim('after a refused callable');

    f.commitReviewedSubject();
    const goodCommit = f.head();
    const done = callInIsolatedRuntime(f.env, `R.checkpointRun(${JSON.stringify(f.runId)})`);
    assert.strictEqual(done.ok, true, `the callable refused: ${done.code} — ${done.message}`);
    const v = done.value;

    // Structured SAFE coordinates: identifiers, commit-ish values and digests
    // that are already published in the checkpoint record. No worktree path, no
    // checkpoint file path, no subject path list and no operator text.
    assert.deepStrictEqual(Object.keys(v).sort(), [
      'action', 'checkReceiptSha256', 'checkpointId', 'checks', 'createdAt', 'digest',
      'nextAction', 'packet', 'reviewedBase', 'rollbackPoint', 'runId', 'state', 'subject', 'tree',
    ], 'the callable answer gained or lost a coordinate');
    assert.strictEqual(v.runId, f.runId);
    assert.strictEqual(v.state, 'CHECKPOINTED');
    assert.strictEqual(v.action, 'checkpoint');
    assert.strictEqual(v.nextAction, 'rollback remains deferred');
    assert.strictEqual(v.rollbackPoint, goodCommit,
      'the callable must name the ACTUAL commit, not a placeholder');
    assert.strictEqual(v.reviewedBase, f.reviewedBase);
    assert.strictEqual(v.tree, f.tree());

    // The evidence chain the gates checked is the evidence chain reported.
    assert.strictEqual(v.checkReceiptSha256, f.receipt.receiptSha256);
    assert.deepStrictEqual(v.packet, { path: f.packetRel, sha256: f.packetSha256 });
    assert.strictEqual(v.subject.subjectSha256, f.subject.subjectSha256);
    assert.strictEqual(v.subject.pathCount, f.subject.subjectPaths.length);
    assert.strictEqual(v.subject.diffBytes, f.subject.diffBytes);
    assert.strictEqual(v.subject.reviewedRange, f.subject.range);
    assert.strictEqual(v.subject.committedRange, `${f.reviewedBase}..${goodCommit}`,
      'the committed subject coordinates must name the reviewed base and the real commit');

    // The answer is the record on disk, not a parallel story about it.
    const record = JSON.parse(fs.readFileSync(path.join(f.cpDir, `${v.checkpointId}.json`), 'utf8'));
    assert.strictEqual(record.checkpointId, v.checkpointId);
    assert.strictEqual(record.digest, v.digest);
    assert.strictEqual(record.rollbackPoint, v.rollbackPoint);
    assert.strictEqual(record.checkReceiptSha256, v.checkReceiptSha256);
    const saved = f.readRun();
    assert.strictEqual(saved.state, 'CHECKPOINTED');
    assert.strictEqual(saved.checkpoint.checkpointId, v.checkpointId);
    assert.strictEqual(saved.checkpoint.digest, v.digest);

    const serialized = JSON.stringify(v);
    for (const leak of [f.repo, f.runsDir, f.cpDir, f.ledger, f.fixtureRel, f.objective]) {
      assert.ok(!serialized.includes(leak), `the callable answer leaked ${leak}`);
    }
    // Printing belongs to the CLI. The shared authority wrote nothing to stdout.
    assert.ok(done.stdout.startsWith(CALL_MARKER),
      `the shared checkpoint authority printed to stdout: ${done.stdout}`);
    f.assertNoLeakedClaim('after a successful callable checkpoint');

    // PARITY on the same run: both entry points now meet the same already
    // CHECKPOINTED state and give the same refusal under the paired codes.
    const again = callInIsolatedRuntime(f.env, `R.checkpointRun(${JSON.stringify(f.runId)})`);
    assert.strictEqual(again.ok, false, 'the callable checkpointed the same run twice');
    assert.strictEqual(again.code, 'INVALID_CHECKPOINT');
    const cliAgain = f.exec(['--checkpoint', f.runId]);
    assert.strictEqual(cliAgain.status, 3, `the CLI checkpointed the same run twice: ${cliAgain.stdout}`);
    assert.match(cliAgain.stderr, /rule {2}: ILLEGAL-TRANSITION/);
    assert.ok(cliAgain.stderr.includes(again.message),
      'the CLI and the callable reported different refusals for the same run');
    assert.strictEqual(cliAgain.stdout, '', 'a refused CLI checkpoint printed a success line');
    assert.strictEqual(f.readRun().checkpoint.checkpointId, v.checkpointId,
      'a refused second checkpoint replaced the recorded one');
    f.assertNoLeakedClaim('after paired refusals');
  } finally { f.finish(); }
});

test('checkpoint before independent review: callable and CLI refuse identically and mutate nothing', () => {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cp-pre-'));
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  const ledger = path.join(TMP, 'ledger.json');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(ledger, '[]\n');
  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: cpDir, AEGIS_LEDGER_FILE: ledger };
  try {
    const runId = 'RUN-20260825-b2c3d4e5';
    const runFile = path.join(runsDir, `${runId}.json`);
    fs.writeFileSync(runFile, JSON.stringify({
      runId, createdAt: '2026-08-25T06:00:00Z', updatedAt: '2026-08-25T06:00:00Z',
      state: 'CHECKS_PASSED', objective: 'pre-review checkpoint refusal',
      packet: null, baseCommit: null, worktree: null,
      build: { exit: 0 }, checks: { passed: 3, total: 3 },
      checkpoint: null, corrections: 0, transitions: [],
    }, null, 2));
    const before = fs.readFileSync(runFile, 'utf8');

    const called = callInIsolatedRuntime(env, `R.checkpointRun(${JSON.stringify(runId)})`);
    assert.strictEqual(called.ok, false, 'a checkpoint was recorded before independent review bound');
    assert.strictEqual(called.error, 'AegisControlError');
    assert.strictEqual(called.code, 'INVALID_CHECKPOINT');
    assert.strictEqual(called.httpStatus, 409);
    assert.match(called.message, /checkpoint requires REVIEW_BOUND, run is CHECKS_PASSED/);

    const cli = spawnSync('node', [CLI, '--checkpoint', runId], { cwd: ROOT, encoding: 'utf8', env });
    assert.strictEqual(cli.status, 3, `the CLI did not refuse: ${cli.stdout}${cli.stderr}`);
    assert.match(cli.stderr, /rule {2}: ILLEGAL-TRANSITION/);
    assert.ok(cli.stderr.includes(called.message),
      'the CLI and the callable reported different pre-review refusals');
    assert.strictEqual(cli.stdout, '', 'a refused checkpoint printed a success line');

    // A malformed or unknown id is refused BEFORE a claim directory is ever
    // published, and with the same paired codes.
    const badId = callInIsolatedRuntime(env, "R.checkpointRun('not-a-run')");
    assert.strictEqual(badId.code, 'INVALID_RUN_ID');
    assert.strictEqual(badId.httpStatus, 400);
    assert.match(spawnSync('node', [CLI, '--checkpoint', 'not-a-run'],
      { cwd: ROOT, encoding: 'utf8', env }).stderr, /rule {2}: BAD-RUN-ID/);
    const missing = callInIsolatedRuntime(env, "R.checkpointRun('RUN-20260825-ffffffff')");
    assert.strictEqual(missing.code, 'RUN_NOT_FOUND');
    assert.strictEqual(missing.httpStatus, 404);
    assert.match(spawnSync('node', [CLI, '--checkpoint', 'RUN-20260825-ffffffff'],
      { cwd: ROOT, encoding: 'utf8', env }).stderr, /rule {2}: NO-SUCH-RUN/);

    assert.strictEqual(fs.readFileSync(runFile, 'utf8'), before,
      'a refused checkpoint mutated the canonical run record');
    assert.ok(!fs.existsSync(cpDir) || fs.readdirSync(cpDir).length === 0,
      'a refused checkpoint wrote a checkpoint record');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledger, 'utf8')), [],
      'a refused checkpoint appended a canonical ledger entry');
    const leaked = fs.readdirSync(runsDir).filter((name) => name.includes('.launch.lock'));
    assert.deepStrictEqual(leaked, [],
      `a refused checkpoint left a per-run claim behind: ${leaked.join(', ')}`);
  } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
});

test('checkpoint: the CLI and the internal callable are one authority with one refusal vocabulary', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const cmd = src.slice(src.indexOf('function cmdCheckpoint(args)'), src.indexOf('function cmdRollback'));
  assert.match(cmd, /checkpointRun\(args\.runId\)/, 'the CLI must enter through the shared callable');
  for (const gate of ['REVIEW_BOUND', 'validPassedChecks', 'watchdog(', 'transition(',
    'checkpointCandidateProblem', 'git(', 'saveRun(', 'CHECKPOINTS_DIR']) {
    assert.ok(!cmd.includes(gate),
      `the CLI entry point re-implements ${gate}; a checkpoint must have exactly one authority`);
  }
  // The pre-existing claimed authority keeps its name and its position ahead of
  // cmdRollback, because the canonical beta snapshot reads exactly that slice.
  const claimedAt = src.indexOf('function cmdCheckpointClaimed(run)');
  assert.notStrictEqual(claimedAt, -1, 'the pre-existing claimed checkpoint authority is missing');
  assert.ok(claimedAt < src.indexOf('function cmdRollback'),
    'the claimed authority must stay inside the canonical cmdCheckpoint..cmdRollback slice');
  const claimed = src.slice(claimedAt, src.indexOf('function checkpointRun(runId)'));
  assert.ok(claimed.length > 0, 'the claimed checkpoint authority is missing');
  assert.ok(!/console\.log/.test(claimed),
    'the shared authority must not print; output belongs to the CLI');
  assert.strictEqual(src.split('cmdCheckpointClaimed(').length - 1, 2,
    'the claimed checkpoint authority must have exactly one definition and one call site');
  // Every gate the pre-existing authority enforced is still enforced here.
  for (const gate of ['ILLEGAL-TRANSITION', 'NO-PASSING-CHECKS', 'WATCHDOG-REFUSED',
    'CHECKPOINT-EVIDENCE-INVALID', 'CHECKPOINT-DIRTY-TREE', 'NO-ROLLBACK-POINT',
    'CHECKPOINT-HEAD-UNRELATED', 'CHECKPOINT-SUBJECT-MISMATCH', 'CHECKPOINT-TREE-INVALID']) {
    assert.ok(claimed.includes(gate), `the shared authority dropped the ${gate} refusal`);
  }
  assert.match(claimed, /const w = watchdog\(run\);/, 'the shared authority must consult the watchdog');
  // The claimed authority never creates the commit it checkpoints.
  assert.ok(!/'commit'/.test(claimed), 'the checkpoint authority must never create a commit');

  const wrapper = src.slice(src.indexOf('function checkpointRun(runId)'),
    src.indexOf('function cmdCheckpoint(args)'));
  assert.match(wrapper, /acquireRunLaunchClaim\(runId, 3000\)/,
    'per-run claim ownership must stay in the shared wrapper');
  assert.match(wrapper, /releaseRunLaunchClaim\(claim\)/,
    'claim cleanup must stay in the shared wrapper');
  assert.match(wrapper, /CHECKPOINT_CLAIM_NOT_RELEASED/,
    'a failed claim cleanup must not be answered as a success');
  assert.ok(wrapper.indexOf('loadRunForControl(runId)') < wrapper.indexOf('acquireRunLaunchClaim('),
    'a malformed or unknown id must be refused before a claim is published');
  assert.ok(!/console\.log/.test(wrapper), 'the shared wrapper must not print');

  // The two vocabularies are one table read in both directions, so neither
  // entry point can grow a refusal the other cannot express.
  assert.deepStrictEqual(R.CHECKPOINT_CLI_CODES, Object.fromEntries(
    Object.entries(R.CHECKPOINT_REFUSAL_CODES).map(([cli, control]) => [control, cli])));
  assert.strictEqual(Object.keys(R.CHECKPOINT_CLI_CODES).length,
    Object.keys(R.CHECKPOINT_REFUSAL_CODES).length,
    'two CLI refusals collapsed onto one control code');
  for (const raised of claimed.match(/new RunError\('([A-Z0-9-]+)'/g) || []) {
    const code = raised.slice(14, -1);
    assert.ok(R.CHECKPOINT_REFUSAL_CODES[code],
      `${code} escapes the checkpoint refusal table untranslated`);
  }
});

test('checkpoint callable is internal only: it carries no host or browser surface of its own', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  // Scope: the checkpoint authority and its one callable wrapper. The claim is
  // about THIS function, not about which endpoints exist beside it. Freezing
  // the whole route table would make an approved packet that adds a checkpoint
  // endpoint fail here for the wrong reason; what must hold either way is the
  // direction of the dependency — a host route may call the callable, and the
  // callable must never reach back for a host or browser surface.
  const callable = src.slice(src.indexOf('function cmdCheckpointClaimed(run)'),
    src.indexOf('function cmdRollback'));
  assert.ok(callable.length > 0, 'the checkpoint callable slice is missing');
  for (const surface of ['hosting/server', 'API_POST_ROUTES', 'createServer', 'writeHead',
    'req.', 'res.', '/api/']) {
    assert.ok(!callable.includes(surface),
      `the checkpoint callable reaches for ${surface}; a host surface inside the callable is dispatch, not an internal call`);
  }
  // It is entered by a run id and nothing else, so no caller — the CLI today or
  // a host route later — can hand it request-shaped input.
  assert.strictEqual(typeof R.checkpointRun, 'function');
  assert.strictEqual(R.checkpointRun.length, 1, 'the callable must take exactly a run id');
  assert.match(src, /function checkpointRun\(runId\) \{/,
    'the callable must keep its run-id-only signature');
  // A host may one day call this callable; it must never own a second copy of
  // the authority. That stays true whether or not a route exists today.
  const hosting = fs.readFileSync(SERVER, 'utf8');
  for (const token of ['cmdCheckpointClaimed', 'checkpointCandidateProblem', 'CHECKPOINTS_DIR',
    'CHECKPOINT-DIRTY-TREE']) {
    assert.ok(!hosting.includes(token),
      `the dashboard host re-implements ${token}; a checkpoint must have exactly one authority`);
  }
});

test('RED: the runs directory cannot be redirected outside a temp dir', () => {
  const r = spawnSync('node', ['-e', 'require(process.argv[1])', CLI], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, AEGIS_RUNS_DIR: path.join(ROOT, 'builder-control', 'decoy-runs') },
  });
  assert.notStrictEqual(r.status, 0, 'run evidence must not be redirectable into the repo');
  assert.ok(/must point inside/.test(r.stderr));
});

// ── STEP 8: automatic bounded correction cycles ───────────────────────────
test('STEP 8: the correction loop is bounded and escalates rather than looping', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/function cmdAuto/.test(src), 'step 8 requires an automatic correction driver');
  assert.ok(/ESCALATION REQUIRED/.test(src), 'the loop must escalate, not spin');
  assert.ok(/run\.corrections >= MAX_CORRECTIONS/.test(src), 'the cap must be enforced inside the loop');
  assert.ok(/a fourth attempt is a fourth guess, not a fix/.test(src),
    'the reason for the cap must be recorded where the cap is');
});

test('RED: CORRECTING is only reachable from a failure state', () => {
  const from = Object.entries(R.STATES).filter(([, v]) => v.next.includes('CORRECTING')).map(([k]) => k);
  for (const f of from) {
    assert.ok(R.STATES[f].failure || f === 'REVIEW_BOUND',
      `${f} can enter CORRECTING without having failed — corrections would become routine`);
  }
});

test('async worker core delegates through the canonical worker authority', () => {
  assert.strictEqual(typeof R.startWorker, 'function');
  const src = fs.readFileSync(CLI, 'utf8');
  assert.match(src, /transition\(run, 'BUILDING'/);
  assert.match(src, /require\('\.\/aegis-worker\.cjs'\)\.launchWorker/);
});

test('pause remains honestly unavailable until PAUSED semantics exist', () => {
  assert.ok(!Object.prototype.hasOwnProperty.call(R.STATES, 'PAUSED'));
  const src = fs.readFileSync(CLI, 'utf8');
  assert.match(src, /pause is unavailable because no PAUSED state exists/);
});

// ── STEP 9: watchdog sequence proving ─────────────────────────────────────
test('STEP 9: the watchdog proves the required sequence actually occurred', () => {
  const good = { runId: 'RUN-20260825-deadbeef', transitions: [
    { from: 'CREATED', to: 'INTAKE_RECORDED' }, { from: 'INTAKE_RECORDED', to: 'ROUTED' },
    { from: 'ROUTED', to: 'WORKTREE_READY' }, { from: 'WORKTREE_READY', to: 'BUILDING' },
    { from: 'BUILDING', to: 'BUILT' }, { from: 'BUILT', to: 'CHECKS_PASSED' },
  ] };
  const w = R.watchdog(good);
  // Ledger cross-check will flag these synthetic transitions — that is correct
  // and is asserted separately below. Sequence itself must be clean.
  assert.ok(!w.problems.some((p) => p.rule === 'WATCHDOG-STAGE-MISSING'),
    'a complete sequence must not report a missing stage');
});

test('RED: the watchdog detects a SKIPPED required stage', () => {
  const drifted = { runId: 'RUN-20260825-deadbeef', transitions: [
    { from: 'CREATED', to: 'INTAKE_RECORDED' }, { from: 'INTAKE_RECORDED', to: 'ROUTED' },
    { from: 'ROUTED', to: 'WORKTREE_READY' }, { from: 'WORKTREE_READY', to: 'BUILDING' },
    { from: 'BUILDING', to: 'BUILT' },
  ] };
  const w = R.watchdog(drifted);
  assert.strictEqual(w.ok, false);
  assert.ok(w.problems.some((p) => p.rule === 'WATCHDOG-STAGE-MISSING' && /CHECKS_PASSED/.test(p.detail)),
    'skipping deterministic checks must be detected as process drift');
});

test('RED: the watchdog refuses a transition the CANONICAL ledger never recorded', () => {
  const forged = { runId: 'RUN-20260825-ffffffff', transitions: [
    { from: 'CREATED', to: 'INTAKE_RECORDED' }, { from: 'INTAKE_RECORDED', to: 'ROUTED' },
    { from: 'ROUTED', to: 'WORKTREE_READY' }, { from: 'WORKTREE_READY', to: 'BUILDING' },
    { from: 'BUILDING', to: 'BUILT' }, { from: 'BUILT', to: 'CHECKS_PASSED' },
  ] };
  const w = R.watchdog(forged);
  assert.strictEqual(w.ok, false);
  assert.ok(w.problems.some((p) => p.rule === 'WATCHDOG-UNRECORDED-TRANSITION'),
    'a run file claiming stages the ledger never saw is an edited run file');
});

test('STEP 9 gates STEP 10: a checkpoint over a drifted run is refused', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/WATCHDOG-REFUSED/.test(src));
  assert.ok(/const w = watchdog\(run\);/.test(src), 'checkpoint must consult the watchdog');
});

// ── normalizeObjective — dashboard objective intake ─────────────────────────
test('normalizeObjective: valid input normalizes whitespace and defaults dataClass', () => {
  const out = R.normalizeObjective({
    objective: '  do   the   thing  ',
    project: '  Vitalis  ',
    constraints: ['  no   secrets  '],
    acceptance: ['  tests pass  '],
  });
  assert.strictEqual(out.objective, 'do the thing');
  assert.strictEqual(out.project, 'Vitalis');
  assert.deepStrictEqual(out.constraints, ['no secrets']);
  assert.deepStrictEqual(out.acceptance, ['tests pass']);
  assert.strictEqual(out.dataClass, 'INTERNAL');
});

test('normalizeObjective: minimal input defaults project to null and arrays to empty', () => {
  const out = R.normalizeObjective({ objective: 'do the thing' });
  assert.strictEqual(out.project, null);
  assert.deepStrictEqual(out.constraints, []);
  assert.deepStrictEqual(out.acceptance, []);
  assert.strictEqual(out.dataClass, 'INTERNAL');
});

test('normalizeObjective: an explicit dataClass is honoured', () => {
  const out = R.normalizeObjective({ objective: 'x', dataClass: 'RESTRICTED' });
  assert.strictEqual(out.dataClass, 'RESTRICTED');
});

test('normalizeObjective: return value is frozen (top-level and array fields)', () => {
  const out = R.normalizeObjective({ objective: 'x', constraints: ['a'] });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.constraints));
  assert.ok(Object.isFrozen(out.acceptance));
  assert.throws(() => { out.objective = 'y'; }, /./);
});

test('normalizeObjective: non-plain-object input is rejected', () => {
  for (const bad of [null, undefined, 'x', 5, [], () => {}]) {
    assert.throws(() => R.normalizeObjective(bad), (e) => e instanceof R.AegisControlError && e.code === 'INVALID_OBJECTIVE');
  }
});

test('normalizeObjective: missing or empty objective is rejected', () => {
  assert.throws(() => R.normalizeObjective({}), (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: '' }), (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: '   ' }), (e) => e.code === 'INVALID_OBJECTIVE');
});

test('normalizeObjective: objective over 4000 characters is rejected', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'a'.repeat(4001) }), (e) => e.code === 'INVALID_OBJECTIVE');
  assert.doesNotThrow(() => R.normalizeObjective({ objective: 'a'.repeat(4000) }));
});

test('normalizeObjective: project over 100 characters is rejected', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', project: 'p'.repeat(101) }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.doesNotThrow(() => R.normalizeObjective({ objective: 'x', project: 'p'.repeat(100) }));
});

test('normalizeObjective: unknown top-level keys are rejected', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', extra: 'y' }),
    (e) => e.code === 'INVALID_OBJECTIVE');
});

test('normalizeObjective: invalid dataClass value is rejected', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', dataClass: 'TOP_SECRET' }),
    (e) => e.code === 'INVALID_OBJECTIVE');
});

test('normalizeObjective: constraints/acceptance must be arrays of non-empty strings within bounds', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: 'not an array' }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: [5] }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: [''] }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: ['a'.repeat(501)] }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: Array(21).fill('a') }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.doesNotThrow(() => R.normalizeObjective({ objective: 'x', constraints: Array(20).fill('a') }));
});

test('normalizeObjective: rejects dangerous control fields as top-level keys', () => {
  for (const field of ['command', 'shell', 'argv', 'model', 'provider', 'verdict', 'auth', 'token', 'secret', 'approval']) {
    assert.throws(() => R.normalizeObjective({ objective: 'x', [field]: 'y' }),
      (e) => e.code === 'INVALID_OBJECTIVE', `expected ${field} to be rejected as an unknown/dangerous key`);
  }
});

test('normalizeObjective: ordinary words that resemble control-field names remain valid content', () => {
  const out = R.normalizeObjective({
    objective: 'Improve the operator shell',
    constraints: ['preserve the existing shell'],
    acceptance: ['model routing remains visible'],
  });
  assert.deepStrictEqual(out.constraints, ['preserve the existing shell']);
  assert.deepStrictEqual(out.acceptance, ['model routing remains visible']);
});

test('normalizeObjective: throws AegisControlError with code INVALID_OBJECTIVE and httpStatus 400', () => {
  try {
    R.normalizeObjective({});
    assert.fail('expected normalizeObjective to throw');
  } catch (e) {
    assert.ok(e instanceof R.AegisControlError);
    assert.strictEqual(e.code, 'INVALID_OBJECTIVE');
    assert.strictEqual(e.httpStatus, 400);
  }
});

test('normalizeObjective: has no filesystem or process side effects', () => {
  const runsBefore = fs.existsSync(R.RUNS_DIR) ? fs.readdirSync(R.RUNS_DIR).length : 0;
  R.normalizeObjective({ objective: 'x', project: 'y', constraints: ['a'], acceptance: ['b'], dataClass: 'PUBLIC' });
  try { R.normalizeObjective({ bad: true }); } catch { /* expected */ }
  const runsAfter = fs.existsSync(R.RUNS_DIR) ? fs.readdirSync(R.RUNS_DIR).length : 0;
  assert.strictEqual(runsBefore, runsAfter, 'normalizeObjective must not write to RUNS_DIR');
});

test('normalizeObjective: preserves CLI behaviour (usage output unchanged)', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.ok(/aegis-run.cjs — the V1 runtime/.test(r.stderr));
});

// ── createRunFromObjective — the single intake authority ───────────────────
// Runs a fresh createRunFromObjective call in a child process against a temp
// RUNS_DIR/CHECKPOINTS_DIR/LEDGER_FILE, the same isolation the STEP 10 fixture
// uses, because the module resolves those directories from process.env at
// require time and this test file has already required the module once
// against the real (fallback) directories.
function withIsolatedRuntime(driverBody) {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-intake-'));
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  const ledger = path.join(TMP, 'ledger.json');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(ledger, '[]\n');
  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: cpDir, AEGIS_LEDGER_FILE: ledger };
  const driver = `
    const R = require(${JSON.stringify(CLI)});
    ${driverBody}
  `;
  const r = spawnSync('node', ['-e', driver], { cwd: ROOT, encoding: 'utf8', env });
  return { r, TMP, runsDir, cpDir, ledger };
}

test('createRunFromObjective: normalized fields persist to the run file', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({
      objective: '  ship   the   thing  ', project: '  Vitalis  ',
      constraints: ['  no secrets  '], acceptance: ['  tests pass  '], dataClass: 'CONFIDENTIAL',
    });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
  assert.strictEqual(files.length, 1, 'exactly one run file must be written');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
  assert.strictEqual(saved.objective, 'ship the thing');
  assert.strictEqual(saved.project, 'Vitalis');
  assert.deepStrictEqual(saved.constraints, ['no secrets']);
  assert.deepStrictEqual(saved.acceptanceCriteria, ['tests pass']);
  assert.strictEqual(saved.dataClass, 'CONFIDENTIAL');
});

test('createRunFromObjective: the canonical ledger records CREATED -> INTAKE_RECORDED', () => {
  const { r, ledger } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({ objective: 'record me' });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const entries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  const match = entries.find((e) => e.correlationId === out.runId && e.operationId === `${out.runId}:CREATED->INTAKE_RECORDED`);
  assert.ok(match, 'the ledger must contain the CREATED -> INTAKE_RECORDED transition for this run');
  assert.strictEqual(match.status, 'PASS');
});

test('createRunFromObjective: an invalid objective fails before any run is created', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    try { R.createRunFromObjective({}); console.log('NO-THROW'); }
    catch (e) { console.log(e.code); }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  assert.ok(/INVALID_OBJECTIVE/.test(r.stdout));
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
  assert.strictEqual(files.length, 0, 'an invalid objective must not leave a run file behind');
});

test('createRunFromObjective: an unsafe packet path fails before any run is created', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    try { R.createRunFromObjective({ objective: 'x' }, { packet: '../../../etc/passwd' }); console.log('NO-THROW'); }
    catch (e) { console.log(e.code); }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  assert.ok(/INVALID_PACKET/.test(r.stdout));
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
  assert.strictEqual(files.length, 0, 'an unsafe packet must not leave a run file behind');
});

test('createRunFromObjective: a missing packet fails before any run is created', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    try { R.createRunFromObjective({ objective: 'x' }, { packet: 'builder-control/packets/DOES-NOT-EXIST.json' }); console.log('NO-THROW'); }
    catch (e) { console.log(e.code); }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  assert.ok(/INVALID_PACKET/.test(r.stdout));
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
  assert.strictEqual(files.length, 0, 'a missing packet must not leave a run file behind');
});

test('createRunFromObjective: persists the exact canonically validated packet path, digest and packetId', () => {
  const packet = 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json';
  const absolute = path.join(ROOT, packet);
  const expectedBytes = fs.readFileSync(absolute);
  const expectedPacket = JSON.parse(expectedBytes);
  const { r, runsDir } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({ objective: 'bind packet coordinate' },
      { packet: ${JSON.stringify(packet)} });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const files = fs.readdirSync(runsDir).filter((file) => file.endsWith('.json'));
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
  assert.deepStrictEqual(saved.packetCoordinate, {
    path: packet,
    sha256: crypto.createHash('sha256').update(expectedBytes).digest('hex'),
    packetId: expectedPacket.packetId,
  });
});

// ── automatic-check eligibility marker ─────────────────────────────────────
// The marker records only that a run was created by the dashboard authority.
// It is server-owned (an option, never intake input) and executes nothing.
test('createRunFromObjective: only options.automaticChecks === true marks a run eligible', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    const dashboard = R.createRunFromObjective({ objective: 'dashboard intake' }, { automaticChecks: true });
    const fallback = R.createRunFromObjective({ objective: 'default intake' });
    const truthy = R.createRunFromObjective({ objective: 'truthy intake' }, { automaticChecks: 'true' });
    console.log(JSON.stringify({ dashboard: dashboard.runId, fallback: fallback.runId, truthy: truthy.runId }));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const ids = JSON.parse(r.stdout.trim().split('\n').pop());
  const read = (runId) => JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  const dashboard = read(ids.dashboard);
  assert.strictEqual(dashboard.automaticChecks, true,
    'the dashboard intake authority must record the eligibility marker');
  assert.strictEqual(read(ids.fallback).automaticChecks, false,
    'intake with no automaticChecks option must not mark a run eligible');
  assert.strictEqual(read(ids.truthy).automaticChecks, false,
    'only the exact value true may mark a run eligible');
  // Eligibility is a marker, not an action: intake still stops where it did.
  assert.strictEqual(dashboard.state, 'INTAKE_RECORDED');
  assert.strictEqual(dashboard.checks, null, 'the marker must not execute checks');
  assert.strictEqual(dashboard.worktree, null);
  assert.strictEqual(dashboard.build, null);
});

test('createRunFromObjective: a posted automaticChecks field is refused, never honoured', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    for (const value of [true, false]) {
      try { R.createRunFromObjective({ objective: 'browser marker attempt', automaticChecks: value }); console.log('NO-THROW'); }
      catch (e) { console.log(e.code + ': ' + e.message); }
    }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.strictEqual(lines.length, 2, `expected two refusals, got: ${r.stdout}`);
  for (const line of lines) {
    assert.ok(/^INVALID_OBJECTIVE: /.test(line), `browser JSON set the marker instead of being refused: ${line}`);
    assert.ok(/automaticChecks/.test(line), `the refusal must name the unknown field: ${line}`);
  }
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
  assert.strictEqual(files.length, 0, 'a browser marker attempt must not leave a run file behind');
});

test('createRunFromObjective: the CLI --new path records no automatic-check eligibility', () => {
  const { runsDir } = withIsolatedRuntime(`process.exit(0);`);
  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: path.join(runsDir, '..', 'checkpoints'), AEGIS_LEDGER_FILE: path.join(runsDir, '..', 'ledger.json') };
  const out = spawnSync('node', [CLI, '--new', '--objective', 'cli eligibility', '--json'], { cwd: ROOT, encoding: 'utf8', env });
  assert.strictEqual(out.status, 0, `--new failed: ${out.stderr}`);
  assert.strictEqual(JSON.parse(out.stdout).automaticChecks, false,
    'the CLI is not the dashboard intake authority and must not mark runs eligible');
});

hostContainmentTest('dashboard Start refuses changed packet bytes before routing, worktree creation or BUILDING', () => {
  const source = path.join(ROOT, 'builder-control', 'packets',
    'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const relative = `builder-control/packets/PKT-START-COORDINATE-${process.pid}-${crypto.randomBytes(5).toString('hex')}.json`;
  const disposable = path.join(ROOT, relative);
  fs.copyFileSync(source, disposable, fs.constants.COPYFILE_EXCL);
  const { r, runsDir, runId, TMP } = withIsolatedRuntime(`
    const fs = require('fs');
    const packetPath = ${JSON.stringify(disposable)};
    const out = R.createRunFromObjective({ objective: 'refuse replaced authority' },
      { packet: ${JSON.stringify(relative)} });
    const changed = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
    changed.objective = changed.objective + ' changed after intake';
    fs.writeFileSync(packetPath, JSON.stringify(changed, null, 2) + '\\n');
    let launched = false;
    try {
      R.startGovernedWorker(out.runId, () => { launched = true; return {}; });
      console.log(JSON.stringify({ code: null, launched, runId: out.runId }));
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, launched, runId: out.runId }));
    }
  `);
  try {
    assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
    const result = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(result.code, 'PACKET_CHANGED');
    assert.strictEqual(result.launched, false, 'launch factory ran for changed packet bytes');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${result.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'INTAKE_RECORDED');
    assert.strictEqual(saved.route, undefined);
    assert.strictEqual(saved.worktree, null);
    assert.strictEqual(saved.build, null);
    assert.strictEqual(fs.existsSync(path.join(ROOT, '..', `aegis-wt-${result.runId}`)), false);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(disposable, { force: true });
  }
});

test('createRunFromObjective: does not create a worktree, build, model record, or process', () => {
  const before = spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  const { r, runsDir } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({ objective: 'no side effects' });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const after = spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  assert.strictEqual(before, after, 'createRunFromObjective must not create a git worktree');
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
  assert.strictEqual(saved.worktree, null, 'objective intake must not create a worktree');
  assert.strictEqual(saved.build, null, 'objective intake must not run a build');
  assert.strictEqual(saved.checks, null, 'objective intake must not run checks');
  assert.strictEqual(saved.checkpoint, null, 'objective intake must not create a checkpoint');
  assert.strictEqual(saved.route, undefined, 'objective intake must not perform routing/model selection');
});

test('createRunFromObjective: the CLI --new path goes through the same authority', () => {
  const { r, runsDir } = withIsolatedRuntime(`process.exit(0);`);
  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: path.join(runsDir, '..', 'checkpoints'), AEGIS_LEDGER_FILE: path.join(runsDir, '..', 'ledger.json') };
  const out = spawnSync('node', [CLI, '--new', '--objective', '  cli  path  ', '--json'], { cwd: ROOT, encoding: 'utf8', env });
  assert.strictEqual(out.status, 0, `--new failed: ${out.stderr}`);
  const saved = JSON.parse(out.stdout);
  assert.strictEqual(saved.objective, 'cli path', 'the CLI must go through the same normalizeObjective as the API path');
  assert.strictEqual(saved.state, 'INTAKE_RECORDED');
});

test('createRunFromObjective: the response has exactly runId,state,risk,nextAction and no secrets', () => {
  const { r } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({ objective: 'shape check', dataClass: 'RESTRICTED' });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(Object.keys(out).sort(), ['nextAction', 'risk', 'runId', 'state']);
  const flat = JSON.stringify(out).toLowerCase();
  for (const bad of ['token', 'secret', 'password', 'apikey', 'api_key', 'authorization']) {
    assert.ok(!flat.includes(bad), `response leaked a secret-shaped field: ${bad}`);
  }
});

// ── prepareRun — the single routing + worktree authority ───────────────────

// Sets up a temp git repo + isolated RUNS_DIR/ledger, seeds a run at
// INTAKE_RECORDED via a real transition() call (so the ledger is genuine),
// then runs `driverBody` (which may reference `run.runId`) in the same child
// process and prints its JSON result as the last line of stdout.
function withIntakeRecordedRun(driverBody) {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-prep-'));
  const repo = path.join(TMP, 'repo');
  const runsDir = path.join(TMP, 'runs');
  const ledger = path.join(TMP, 'ledger.json');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(ledger, '[]\n');

  const g = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'fixture@example.invalid']);
  g(['config', 'user.name', 'AEGIS Fixture']);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  // prepareRun's own git calls always run against the canonical ROOT (the
  // real repo this test file lives in), not against this isolated fixture
  // repo — so baseCommit must be a commit that actually resolves there.
  const baseCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: path.join(TMP, 'checkpoints'), AEGIS_LEDGER_FILE: ledger };

  const runId = `RUN-20260825-${crypto.randomBytes(4).toString('hex')}`;
  const intakePacket = 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json';
  const intakePacketBytes = fs.readFileSync(path.join(ROOT, intakePacket));
  const seed = {
    runId, createdAt: '2026-08-25T06:00:00Z', updatedAt: '2026-08-25T06:00:00Z',
    state: 'CREATED', objective: 'fixture prepareRun',
    // Canonical runs always carry these normalized lists; buildGovernedLaunchSpec
    // refuses a run without them. dataClass is intentionally absent — both
    // routeRole and the hosting route default an absent class to INTERNAL.
    constraints: [], acceptanceCriteria: [],
    packet: intakePacket,
    packetCoordinate: {
      path: intakePacket,
      sha256: crypto.createHash('sha256').update(intakePacketBytes).digest('hex'),
      packetId: JSON.parse(intakePacketBytes).packetId,
    },
    baseCommit,
    worktree: null, build: null, checks: null, checkpoint: null, corrections: 0, transitions: [],
  };
  fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(seed, null, 2));

  // Note: this repo (`repo`) is the ROOT the child process's git calls run
  // against, but aegis-run.cjs's own `ROOT` is fixed to the real repo two
  // levels up from this test file — worktree creation always targets
  // `ROOT/../aegis-wt-<runId>`, i.e. next to the real worktree checkout, not
  // inside the fixture repo. Cleanup below removes anything left behind.
  const driver = `
    const R = require(${JSON.stringify(CLI)});
    const run = R.loadRun(${JSON.stringify(runId)});
    R.transition(run, 'INTAKE_RECORDED', 'fixture');
    ${driverBody}
  `;
  const r = spawnSync('node', ['-e', driver], { cwd: ROOT, encoding: 'utf8', env });
  return { r, TMP, runId, runsDir, ledger, env };
}

function cleanupWorktree(runId) {
  if (!/^RUN-\d{8}-[0-9a-f]{8}$/.test(runId)) {
    throw new Error(`refusing to clean up unrecognized run id: ${runId}`);
  }
  const wt = path.join(ROOT, '..', `aegis-wt-${runId}`);
  const branch = `aegis/${runId}`;
  if (fs.existsSync(wt)) {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, encoding: 'utf8' });
    fs.rmSync(wt, { recursive: true, force: true });
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT, encoding: 'utf8' });
  spawnSync('git', ['branch', '-D', branch], { cwd: ROOT, encoding: 'utf8' });
}

test('prepareRun: success reaches WORKTREE_READY with canonical ROUTED and WORKTREE_READY ledger entries', () => {
  const { r, runId, runsDir, ledger, TMP, env } = withIntakeRecordedRun(`
    const out = R.prepareRun(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `prepareRun failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.runId, runId);
    assert.strictEqual(out.state, 'WORKTREE_READY');

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'WORKTREE_READY');

    const entries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    const reversed = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:WORKTREE_READY->ROUTED`);
    assert.ok(!reversed, 'sanity: a reversed transition must never be recorded — checking the two real ones below');
    const toRouted = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:INTAKE_RECORDED->ROUTED`);
    const toReady = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:ROUTED->WORKTREE_READY`);
    assert.ok(toRouted, 'the canonical ledger must record INTAKE_RECORDED -> ROUTED');
    assert.strictEqual(toRouted.status, 'PASS');
    assert.ok(toReady, 'the canonical ledger must record ROUTED -> WORKTREE_READY');
    assert.strictEqual(toReady.status, 'PASS');

    assert.ok(fs.existsSync(saved.worktree.path), 'the worktree directory must actually exist on disk');
    const wtList = spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' }).stdout;
    assert.ok(wtList.includes(saved.worktree.path), 'git must know about the new worktree');
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: route refusal creates no worktree and fails closed with ROUTE_REFUSED/409', () => {
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const path = require('path');
    const fs = require('fs');
    // Force a route refusal without touching the real tool-router: point
    // require() at a stub module of the same name via a fake node_modules-free
    // trick — simplest reliable way is to monkey-patch Module._load.
    const Module = require('module');
    const orig = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === './tool-router.cjs' || /tool-router\\.cjs$/.test(request)) {
        return { routeRole: () => ({ ok: false, code: 'NO_CAPABLE_MODEL', reason: 'no verified capability' }) };
      }
      return orig.apply(this, arguments);
    };
    try {
      R.prepareRun(run.runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus, isAegisControlError: e instanceof R.AegisControlError }));
    }
  `);
  try {
    assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, 'a refused route must throw, not silently proceed');
    assert.strictEqual(out.code, 'ROUTE_REFUSED');
    assert.strictEqual(out.httpStatus, 409);
    assert.strictEqual(out.isAegisControlError, true);

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.notStrictEqual(saved.state, 'WORKTREE_READY', 'a refused route must not reach WORKTREE_READY');
    assert.notStrictEqual(saved.state, 'ROUTED', 'a refused route must not record ROUTED');
    assert.strictEqual(saved.worktree, null, 'a refused route must create no worktree');

    const entries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    const toReady = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:ROUTED->WORKTREE_READY`);
    assert.ok(!toReady, 'the ledger must not record WORKTREE_READY for a refused route');

    const wt = path.join(ROOT, '..', `aegis-wt-${runId}`);
    assert.ok(!fs.existsSync(wt), 'no worktree directory may exist after a route refusal');
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: an existing worktree path leaves INTAKE_RECORDED and can be retried after correction', () => {
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const fs = require('fs');
    const path = require('path');
    const wt = path.join(${JSON.stringify(ROOT)}, '..', 'aegis-wt-' + run.runId);
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'pre-existing');
    try {
      R.prepareRun(run.runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      const stateAfterFailure = R.loadRun(run.runId).state;
      fs.rmSync(wt, { recursive: true, force: true });
      const retried = R.prepareRun(run.runId);
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus,
        stateAfterFailure, retried }));
    }
  `);
  try {
    assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, 'an existing worktree path must be refused, not reused');
    assert.strictEqual(out.code, 'WORKTREE_EXISTS');
    assert.strictEqual(out.httpStatus, 409);
    assert.strictEqual(out.stateAfterFailure, 'INTAKE_RECORDED');
    assert.strictEqual(out.retried.state, 'WORKTREE_READY');

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'WORKTREE_READY', 'a corrected preparation must be recoverable');

    const entries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    const routed = entries.filter((e) => e.correlationId === runId &&
      e.operationId === `${runId}:INTAKE_RECORDED->ROUTED`);
    assert.strictEqual(routed.length, 1, 'the failed first attempt must not publish ROUTED');
    const wt = path.join(ROOT, '..', `aegis-wt-${runId}`);
    assert.ok(!fs.existsSync(path.join(wt, 'dirty.txt')), 'retry reused the dirty pre-existing path');
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: requires an actual existing run at INTAKE_RECORDED — refuses CREATED', () => {
  const { r, runId, runsDir, TMP } = withIntakeRecordedRun(`
    // run is already at INTAKE_RECORDED here; move it back to CREATED by
    // writing the run file directly (a state prepareRun must still refuse,
    // since it is not reachable via transition() from INTAKE_RECORDED).
    const fs = require('fs');
    const p = R.runPath(run.runId);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    raw.state = 'CREATED';
    fs.writeFileSync(p, JSON.stringify(raw, null, 2));
    try {
      R.prepareRun(run.runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  try {
    assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true);
    assert.strictEqual(out.code, 'ILLEGAL_TRANSITION');
    assert.strictEqual(out.httpStatus, 409);
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: refuses a run id that does not exist', () => {
  assert.throws(() => R.prepareRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.RunError && e.code === 'NO-SUCH-RUN');
});

test('prepareRun: response has exactly runId,state,route,worktree,nextAction and no secrets', () => {
  const { r, runId, TMP } = withIntakeRecordedRun(`
    const out = R.prepareRun(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `prepareRun failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['nextAction', 'route', 'runId', 'state', 'worktree']);
    assert.deepStrictEqual(Object.keys(out.worktree).sort(), ['branch', 'path']);
    const flat = JSON.stringify(out).toLowerCase();
    for (const bad of ['token', 'secret', 'password', 'apikey', 'api_key', 'authorization']) {
      assert.ok(!flat.includes(bad), `response leaked a secret-shaped field: ${bad}`);
    }
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: does not execute a builder, model, or create a second event store', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const prepareRunSrc = src.slice(src.indexOf('function prepareRun'), src.indexOf('function cmdWorktree'));
  assert.ok(!/spawnSync\('bash'/.test(prepareRunSrc), 'prepareRun must not spawn a build command');
  assert.ok(!/cmdBuild/.test(prepareRunSrc), 'prepareRun must not execute the builder');
  assert.ok(!/fs\.writeFileSync.*ledger\.json/.test(prepareRunSrc), 'prepareRun must not write a second ledger file directly');
});

test('prepareRun: CLI --worktree calls prepareRun (single authority)', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  // End at the run-controls marker that immediately follows cmdWorktree. Slicing
  // to `function cmdBuild` swept in later unrelated functions (canonicalRetryLaunchSpec
  // and friends), so the routeRole assertion below was reading someone else's code.
  const cmdWorktreeSrc = src.slice(src.indexOf('function cmdWorktree'), src.indexOf('// ── run controls (dashboard)'));
  assert.ok(/result = prepareRun\(args\.runId\)/.test(cmdWorktreeSrc),
    'cmdWorktree must delegate to prepareRun rather than duplicating routing/worktree logic');
  // And it must not itself call git worktree add or routeRole directly.
  assert.ok(!/git\(\['worktree'/.test(cmdWorktreeSrc), 'cmdWorktree must not create the worktree itself');
  assert.ok(!/routeRole/.test(cmdWorktreeSrc), 'cmdWorktree must not route itself');
});

test('prepareRun: exported from the module', () => {
  assert.strictEqual(typeof R.prepareRun, 'function');
});

test('dashboard Start: two concurrent requests prepare and reserve exactly one worker under one claim', () => {
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    const counter = path.join(path.dirname(process.env.AEGIS_RUNS_DIR), 'dashboard-start-launches.txt');
    const startAt = Date.now() + 300;
    const childSource = String.raw\`
      const fs = require('fs');
      const crypto = require('crypto');
      const { spawn } = require('child_process');
      const Module = require('module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === './tool-router.cjs' || /tool-router\\.cjs$/.test(request)) {
          return { routeRole: () => ({ ok: true, model: 'claude', execution: 'SUBSCRIPTION' }) };
        }
        if (request === './aegis-worker.cjs' || /aegis-worker\\.cjs$/.test(request)) {
          return {
            processAlive: () => false,
            normalizeLaunchSpec: (value) => Object.freeze({ ...value }),
            normalizeTimeoutSec: (value) => Number(value),
            launchWorker: ({ launchSpec }) => {
              // A real, disposable process-group leader: production proves ownership against
              // the live process table, so a fabricated pid is not a stand-in for one.
              const worker = spawn(process.execPath,
                ['-e', 'setTimeout(()=>process.exit(0),30000); setInterval(()=>{},1000);'],
                { detached: true, stdio: 'ignore' });
              worker.unref();
              fs.appendFileSync(process.env.AEGIS_START_COUNTER, worker.pid + '\\n');
              return { workerPid: worker.pid, processGroupId: worker.pid,
                launchSha256: crypto.createHash('sha256').update(JSON.stringify(launchSpec)).digest('hex'),
                control: { dir: '/fixture/control-' + process.pid, secretSha256: 'fixture' } };
            },
          };
        }
        return originalLoad.apply(this, arguments);
      };
      while (Date.now() < Number(process.env.AEGIS_START_AT)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      const S = require(process.env.AEGIS_START_SERVER);
      try { console.log(JSON.stringify({ ok: true, value: S.startGovernedRun(process.env.AEGIS_START_RUN_ID) })); }
      catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, httpStatus: e.httpStatus })); }
    \`;
    const childEnv = { ...process.env, NODE_ENV: 'test', AEGIS_START_COUNTER: counter,
      AEGIS_START_AT: String(startAt), AEGIS_START_SERVER: ${JSON.stringify(SERVER)},
      AEGIS_START_RUN_ID: run.runId };
    const execute = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', childSource], { cwd: ${JSON.stringify(ROOT)}, env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    Promise.all([execute(), execute()]).then((children) => {
      const launches = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').trim().split(/\\n/).filter(Boolean) : [];
      // Best-effort reap of every disposable group the mocked launch leaked into the process table.
      for (const pid of launches) { try { process.kill(-Number(pid), 'SIGKILL'); } catch {} }
      try { fs.unlinkSync(counter); } catch {}
      console.log(JSON.stringify({ children, launches }));
    });
  `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    for (const child of out.children) assert.strictEqual(child.status, 0, child.stderr);
    const results = out.children.map((child) => JSON.parse(child.stdout.trim().split('\n').pop()));
    assert.strictEqual(results.filter((value) => value.ok).length, 1, JSON.stringify(results));
    const conflict = results.find((value) => !value.ok);
    assert.ok(conflict && ['LAUNCH_IN_PROGRESS', 'ILLEGAL_TRANSITION'].includes(conflict.code),
      `second Start did not fail closed: ${JSON.stringify(conflict)}`);
    assert.strictEqual(conflict.httpStatus, 409);
    assert.strictEqual(out.launches.length, 1, 'two dashboard Start requests launched more than one worker');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILDING');
    assert.strictEqual(saved.build.attempt, 1);
    assert.strictEqual(saved.transitions.filter((t) => t.from === 'INTAKE_RECORDED' && t.to === 'ROUTED').length, 1);
    assert.strictEqual(saved.transitions.filter((t) => t.from === 'ROUTED' && t.to === 'WORKTREE_READY').length, 1);
    assert.strictEqual(saved.transitions.filter((t) => t.from === 'WORKTREE_READY' && t.to === 'BUILDING').length, 1);
    const entries = ledgerEntriesFor(ledger, runId);
    assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:INTAKE_RECORDED->ROUTED`).length, 1);
    assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:ROUTED->WORKTREE_READY`).length, 1);
    assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:WORKTREE_READY->BUILDING`).length, 1);
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('dashboard Start uses one claim-aware path and never re-enters public prepare or start', () => {
  assert.strictEqual(typeof R.startGovernedWorker, 'function');
  const src = fs.readFileSync(CLI, 'utf8');
  const start = src.slice(src.indexOf('function startGovernedWorker'),
    src.indexOf('function controlMac', src.indexOf('function startGovernedWorker')));
  assert.match(start, /acquireRunLaunchClaim/);
  assert.match(start, /prepareRunClaimed\(/);
  assert.match(start, /startWorkerClaimed\(/);
  assert.doesNotMatch(start, /\bprepareRun\(/);
  assert.doesNotMatch(start, /\bstartWorker\(/);
});

test('dashboard Start refuses an absent recorded packet before routing, worktree or worker state', () => {
  const { r, runsDir, runId, TMP } = withSeededRun('INTAKE_RECORDED', {
    packet: null,
  }, `
    try {
      R.startGovernedWorker(runId, () => { throw new Error('launch factory must not run'); });
      console.log(JSON.stringify({ threw: false }));
    } catch (error) {
      console.log(JSON.stringify({ threw: true, code: error.code }));
    }
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'INVALID_PACKET' });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'INTAKE_RECORDED');
  assert.strictEqual(saved.route, undefined);
  assert.strictEqual(saved.worktree, null);
  assert.strictEqual(saved.build, null);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('legacy --build-async cannot make a caller-selected model authoritative', () => {
  const result = spawnSync('node', [CLI, '--build-async', 'RUN-20260825-deadbeef',
    '--prompt', 'must not launch', '--model', 'opus'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 3, `legacy async launch did not fail closed: ${result.stderr}`);
  assert.match(result.stderr, /GOVERNED-START-REQUIRED/);
  const src = fs.readFileSync(CLI, 'utf8');
  const parser = src.slice(src.indexOf('function parseArgs'), src.indexOf('if (require.main'));
  const branch = src.slice(src.indexOf('else if (args.cmd_build_async)'),
    src.indexOf('else if (args.cmd_checks)', src.indexOf('else if (args.cmd_build_async)')));
  assert.doesNotMatch(parser, /t === '--model'/, 'the legacy CLI still accepts caller model authority');
  assert.doesNotMatch(branch, /startWorker\s*\(/, 'the refused legacy branch can still invoke the worker');
});

// ── pauseRun / cancelRun / retryRun — control-surface functions ────────────
// Isolated run+ledger fixtures, same pattern as withIsolatedRuntime: a temp
// RUNS_DIR/CHECKPOINTS_DIR/AEGIS_LEDGER_FILE, a run file written directly at a
// chosen state, then the function under test driven in a child process so it
// resolves those env-derived directories the same way the module would in
// production.
function withSeededRun(state, extra, driverBody, beforeRequireBody = '') {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-ctrl-'));
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  const ledger = path.join(TMP, 'ledger.json');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(ledger, '[]\n');

  const runId = `RUN-20260825-${crypto.randomBytes(4).toString('hex')}`;
  const resolvedExtra = typeof extra === 'function' ? extra(runId) : extra;
  const seed = Object.assign({
    runId, createdAt: '2026-08-25T06:00:00Z', updatedAt: '2026-08-25T06:00:00Z',
    state, objective: 'fixture control-surface run', packet: null, baseCommit: null,
    worktree: null, build: null, checks: null, checkpoint: null, corrections: 0, transitions: [],
  }, resolvedExtra || {});
  fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(seed, null, 2));

  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: cpDir, AEGIS_LEDGER_FILE: ledger };
  const driver = `
    ${beforeRequireBody}
    const R = require(${JSON.stringify(CLI)});
    const runId = ${JSON.stringify(runId)};
    const seededRun = R.loadRun(runId);
    if (seededRun.checks && seededRun.checks.receipt) {
      seededRun.checks.receiptRef = R.persistCanonicalCheckReceipt(seededRun, seededRun.checks.receipt);
      delete seededRun.checks.receipt;
      R.saveRun(seededRun);
    }
    if (seededRun.checks && seededRun.checks.preHostReceipt) {
      seededRun.checks.preHostReceiptRef = R.persistCanonicalPreHostCheckReceipt(
        seededRun, seededRun.checks.preHostReceipt);
      delete seededRun.checks.preHostReceipt;
      R.saveRun(seededRun);
    }
    ${driverBody}
  `;
  const r = spawnSync('node', ['-e', driver], { cwd: ROOT, encoding: 'utf8', env });
  return { r, TMP, runId, runsDir, ledger, env };
}

function canonicalRetrySeed(overrides = {}) {
  const packet = 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json';
  const bytes = fs.readFileSync(path.join(ROOT, packet));
  return {
    packet,
    packetCoordinate: {
      path: packet,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      packetId: JSON.parse(bytes).packetId,
    },
    dataClass: 'INTERNAL',
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
    worktree: { path: fs.realpathSync(os.tmpdir()) },
    build: {
      mode: 'async', attempt: 1, attemptId: '55555555-5555-4555-8555-555555555555',
      launchSpec: { provider: 'claude-subscription', prompt: 'bounded fixture retry', model: 'opus' },
      workerPid: null, workerState: 'BUILD_FAILED', revision: 2,
    },
    ...overrides,
  };
}

hostContainmentTest('global worker admission refuses a second run before BUILDING mutation', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('WORKTREE_READY', {
    worktree: { path: fs.realpathSync(os.tmpdir()) },
  }, `
    const fs = require('fs'); const path = require('path');
    const otherId = 'RUN-20260825-aaaaaaaa';
    const activeIdentity = R.processIdentity(_activeWorker.pid);
    fs.writeFileSync(path.join(process.env.AEGIS_RUNS_DIR, otherId + '.json'), JSON.stringify({
      runId: otherId, state: 'BUILDING', objective: 'already active',
      build: { mode: 'async', attempt: 1,
        attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workerPid: _activeWorker.pid, processGroupId: activeIdentity.processGroupId,
        processIdentity: activeIdentity, workerState: 'RUNNING' },
      transitions: [], corrections: 0
    }));
    let out; try {
      R.startWorker(runId, { provider: 'claude-subscription', prompt: 'must not launch', model: 'opus' },
        { launchWorker() { throw new Error('launcher must not run'); } });
      out = { threw: false };
    } catch (error) { out = { threw: true, code: error.code }; }
    finally { try { _activeWorker.kill('SIGKILL'); } catch {} }
    console.log(JSON.stringify(out));
  `, `
    const { spawn: _spawn } = require('child_process');
    const _activeWorker = _spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
      { stdio: 'ignore' });
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'GLOBAL_WORKER_ACTIVE' });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'WORKTREE_READY');
  assert.strictEqual(saved.build, null);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('run routing passes the canonical data class without lossy remapping', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  const prepare = source.slice(source.indexOf('function prepareRunClaimed'),
    source.indexOf('function prepareRun(', source.indexOf('function prepareRunClaimed')));
  assert.match(prepare, /routeRole\('orchestrator', \{ dataClass: run\.dataClass \}\)/);
  assert.doesNotMatch(source, /function routingDataClass/);
  assert.doesNotMatch(prepare, /SENSITIVE/);
});

hostContainmentTest('async Retry prevalidation preserves failure state and correction budget', () => {
  for (const [label, override, code] of [
    ['missing worktree', { worktree: { path: path.join(os.tmpdir(), 'aegis-missing-worktree') } }, 'NO_WORKTREE'],
    ['changed packet', { packetCoordinate: { ...canonicalRetrySeed().packetCoordinate,
      sha256: '0'.repeat(64) } }, 'PACKET_CHANGED'],
    ['stale worker route', { build: { ...canonicalRetrySeed().build,
      launchSpec: { provider: 'grok-subscription', prompt: 'mutated', model: 'grok-4.6' } } }, 'ROUTE_STALE'],
  ]) {
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED',
      canonicalRetrySeed(override), `
        let out; try { R.retryRun(runId); out = { threw: false }; }
        catch (error) { out = { threw: true, code: error.code }; }
        console.log(JSON.stringify(out));
      `);
    assert.strictEqual(r.status, 0, `${label}: ${r.stderr}`);
    assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()), { threw: true, code }, label);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILD_FAILED', label);
    assert.strictEqual(saved.corrections, 0, label);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0, label);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('RED: rollback without a recorded point is refused with no run or ledger mutation', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKPOINTED', { checkpoint: null }, `
    const child = require('child_process').spawnSync(process.execPath,
      [${JSON.stringify(CLI)}, '--rollback', runId],
      { cwd: ${JSON.stringify(ROOT)}, env: process.env, encoding: 'utf8' });
    console.log(JSON.stringify({ status: child.status, stderr: child.stderr }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.status, 3);
  assert.match(out.stderr, /NO-ROLLBACK-POINT/);
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKPOINTED');
  assert.strictEqual(saved.checkpoint, null);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('RED: a build without an isolated worktree is refused before command execution with no mutation', () => {
  const marker = path.join(fs.realpathSync(os.tmpdir()),
    `aegis-no-worktree-marker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('WORKTREE_READY', { worktree: null }, `
    const child = require('child_process').spawnSync(process.execPath,
      [${JSON.stringify(CLI)}, '--build', runId, '--cmd', ${JSON.stringify(`touch `)} + ${JSON.stringify(marker)}],
      { cwd: ${JSON.stringify(ROOT)}, env: process.env, encoding: 'utf8' });
    console.log(JSON.stringify({ status: child.status, stderr: child.stderr,
      markerExists: require('fs').existsSync(${JSON.stringify(marker)}) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.status, 3);
  assert.match(out.stderr, /NO-WORKTREE/);
  assert.strictEqual(out.markerExists, false);
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'WORKTREE_READY');
  assert.strictEqual(saved.worktree, null);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(marker, { force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

function ledgerEntriesFor(ledgerFile, runId) {
  const entries = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  return entries.filter((e) => e.correlationId === runId);
}

function receiptFromLedger(ledgerFile, checks) {
  const entries = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  const ref = checks && checks.receiptRef;
  const entry = entries.find((candidate) => candidate.entryId === (ref && ref.entryId));
  assert.ok(entry, 'canonical check receipt ledger entry is missing');
  assert.match(entry.notes || '', /^AEGIS_CHECK_RECEIPT_V1:/);
  const receipt = JSON.parse(Buffer.from(entry.notes.slice('AEGIS_CHECK_RECEIPT_V1:'.length), 'base64url').toString('utf8'));
  assert.strictEqual(receipt.receiptSha256, ref.receiptSha256);
  return receipt;
}

function reviewSubject(overrides = {}) {
  return Object.assign({
    subjectSha256: 'a'.repeat(64),
    subjectPaths: ['builder-control/aegis-run.cjs', 'builder-control/test/aegis-run.test.cjs'],
    excludedAsEvidence: [],
    diffBytes: 4096,
    range: 'HEAD',
  }, overrides);
}

function reviewGate(subject, overrides = {}) {
  return Object.assign({
    ok: true,
    state: 'READY_FOR_DETERMINISTIC_VALIDATION',
    problems: [],
    observed: [],
    unverified: [],
    classification: { lane: 'FULL', requiredReviewers: ['codex', 'grok'] },
    subject,
    reviewerCompleteness: {
      complete: true,
      pathCoverage: {
        total: subject.subjectPaths.length,
        coveredByEveryRequiredReviewer: subject.subjectPaths,
        notCoveredByEveryRequiredReviewer: [],
      },
    },
    reviewsBound: 2,
    reviewsActive: 2,
    reviewsForeign: 1,
  }, overrides);
}

// What `--start --packet <p> --json` actually prints: the subject, the
// classification, and review-cycle.cjs analyze() verbatim under `reviewCycle`.
function reviewCycleStart(subject, cycleOverrides = {}) {
  return {
    call: 'start',
    status: 0,
    body: {
      subject,
      classification: { lane: 'FULL', requiredReviewers: ['codex', 'grok'] },
      reviewCycle: Object.assign({
        packetId: REVIEW_PACKET_ID,
        roundCount: 1,
        maxRounds: 3,
        roundsRemaining: 2,
        verdict: 'PROCEED',
        requiredReviewers: ['codex', 'grok'],
        missingReviewers: ['codex', 'grok'],
        allowedReviewers: ['codex', 'grok'],
        currentRoundComplete: false,
        reasons: [],
      }, cycleOverrides),
    },
  };
}

// The prose --start prints instead of JSON when the cycle stops the round.
function reviewCycleStop(kind = 'HARD STOP') {
  return {
    call: 'start',
    status: 3,
    stdout: `ENGINEERING OS — REVIEW CYCLE ${kind}\n${'='.repeat(60)}\n` +
      `packet      : ${REVIEW_PACKET_ID}\nrounds      : 3 of 3\n` +
      'D-14        : automated review stops here.\n',
  };
}

function engineeringOsMock(responses) {
  const engos = path.join(ROOT, 'builder-control', 'engineering-os.cjs');
  const expectedGitDir = spawnSync('git', ['-C', REVIEW_WORKTREE.path, 'rev-parse', '--absolute-git-dir'],
    { encoding: 'utf8' }).stdout.trim();
  const expectedGitWorkTree = fs.realpathSync(REVIEW_WORKTREE.path);
  const expectedCalls = responses.map((response) => {
    // The review-cycle authority is asked about the same packet as the gate, so
    // it cannot be told apart by its body alone; it declares itself.
    if (response && response.call === 'start') {
      return [engos, '--start', '--packet', path.resolve(ROOT, REVIEW_PACKET), '--json'];
    }
    const body = response && response.body;
    if (body && body.subject && body.reviewerCompleteness) {
      return [engos, '--gate-done', '--packet', path.resolve(ROOT, REVIEW_PACKET),
        '--subject-sha', body.subject.subjectSha256, '--json'];
    }
    return [engos, '--subject', '--packet', REVIEW_PACKET, '--json'];
  });
  return `
    const childProcess = require('child_process');
    const originalSpawnSync = childProcess.spawnSync;
    const engosResponses = ${JSON.stringify(responses)};
    const expectedEngosCalls = ${JSON.stringify(expectedCalls)};
    let engosIndex = 0;
    childProcess.spawnSync = function(command, args, options) {
      if (command === process.execPath && Array.isArray(args) &&
          typeof args[0] === 'string' && args[0].endsWith('/builder-control/engineering-os.cjs')) {
        const snapshotWorktree = options && options.env && options.env.GIT_WORK_TREE;
        const snapshotPacket = args[3];
        const mockPath = require('path');
        if (args.length === 5 && args[1] === '--subject' && args[2] === '--packet' && args[4] === '--json' &&
            typeof snapshotWorktree === 'string' && typeof snapshotPacket === 'string' &&
            mockPath.basename(mockPath.dirname(snapshotWorktree)).startsWith('aegis-host-check-boundary-') &&
            snapshotPacket === mockPath.join(snapshotWorktree, ${JSON.stringify(REVIEW_PACKET)})) {
          return originalSpawnSync.apply(this, arguments);
        }
        const expected = expectedEngosCalls[engosIndex];
        if (!expected || JSON.stringify(args) !== JSON.stringify(expected)) {
          throw new Error('engineering-os invocation mismatch: expected ' +
            JSON.stringify(expected) + ', received ' + JSON.stringify(args));
        }
        if (!options || options.cwd !== ${JSON.stringify(ROOT)} ||
            options.encoding !== 'utf8' || options.timeout !== 60000 ||
            options.maxBuffer !== 64 * 1024 * 1024 || !options.env ||
            options.env.GIT_DIR !== ${JSON.stringify(expectedGitDir)} ||
            options.env.GIT_WORK_TREE !== ${JSON.stringify(expectedGitWorkTree)}) {
          throw new Error('engineering-os spawn options are not bound to the canonical worktree');
        }
        const response = engosResponses[engosIndex++] || { status: 3, body: { ok: false, problems: [] } };
        // --start prints prose, not JSON, when the cycle itself stops the round.
        return { status: response.status,
          stdout: typeof response.stdout === 'string' ? response.stdout : JSON.stringify(response.body),
          stderr: typeof response.stderr === 'string' ? response.stderr : '' };
      }
      return originalSpawnSync.apply(this, arguments);
    };
    process.on('exit', () => {
      if (engosIndex !== expectedEngosCalls.length) {
        console.error('engineering-os invocation count mismatch: expected ' +
          expectedEngosCalls.length + ', received ' + engosIndex);
        process.exitCode = 97;
      }
    });
  `;
}

function engineeringSubjectSequenceMock(subjects, packetPath) {
  const expectedArgs = ['--subject', '--packet', packetPath, '--json'];
  return `
    const childProcess = require('child_process');
    const originalSpawnSync = childProcess.spawnSync;
    const subjectResponses = ${JSON.stringify(subjects)};
    const expectedSubjectArgs = ${JSON.stringify(expectedArgs)};
    let subjectIndex = 0;
    childProcess.spawnSync = function(command, args, options) {
      if (command === process.execPath && Array.isArray(args) &&
          typeof args[0] === 'string' && args[0].endsWith('/builder-control/engineering-os.cjs') &&
          JSON.stringify(args.slice(1)) === JSON.stringify(expectedSubjectArgs)) {
        const body = subjectResponses[subjectIndex++];
        if (!body) throw new Error('unexpected engineering-os subject invocation');
        return { status: 0, stdout: JSON.stringify(body), stderr: '' };
      }
      return originalSpawnSync.apply(this, arguments);
    };
    process.on('exit', () => {
      if (subjectIndex !== subjectResponses.length) {
        console.error('engineering-os subject invocation count mismatch: expected ' +
          subjectResponses.length + ', received ' + subjectIndex);
        process.exitCode = 97;
      }
    });
  `;
}

const REVIEW_PACKET = 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json';
const REVIEW_PACKET_ID = JSON.parse(fs.readFileSync(path.join(ROOT, REVIEW_PACKET), 'utf8')).packetId;
function createCanonicalReviewWorktreeFixture() {
  const root = fs.mkdtempSync(path.join(
    OUTER_SNAPSHOT ? OUTER_SNAPSHOT.boundaryRoot : fs.realpathSync(os.tmpdir()),
    'aegis-review-worktree-'));
  const worktree = path.join(root, 'worktree');
  const branch = `aegis/test-review-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const added = spawnSync('git', ['worktree', 'add', '-q', '-b', branch, worktree, head], {
    cwd: ROOT, encoding: 'utf8',
  });
  if (added.status !== 0) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`could not create canonical review worktree fixture: ${added.stderr || added.stdout}`);
  }
  // The host-containment suite replays two frozen, non-subject Grok receipts.
  // Mirror them into this disposable worktree exactly as a real governed run
  // does; they remain outside filesAllowed and cannot change the subject hash.
  const reviewWorktreeFixtures = HOST_ONLY || REVIEW_ADMISSION_ONLY || CHECKPOINT_ONLY ||
    OUTER_SNAPSHOT ? [] : [
    'builder-control/review-raw/20260828220306-grok.txt',
    'builder-control/review-raw/20260829021134-grok.txt',
  ];
  for (const relative of reviewWorktreeFixtures) {
    const source = path.join(ROOT, relative);
    const target = path.join(worktree, relative);
    const observed = fs.lstatSync(source);
    if (observed.isSymbolicLink() || !observed.isFile()) {
      throw new Error(`unsafe frozen review fixture: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(source), { flag: 'wx', mode: observed.mode & 0o777 });
  }
  fs.appendFileSync(path.join(worktree, 'builder-control', 'review-adapters.cjs'),
    '\n// canonical review worktree fixture subject\n');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, encoding: 'utf8' });
    spawnSync('git', ['branch', '-D', branch], { cwd: ROOT, encoding: 'utf8' });
    fs.rmSync(root, { recursive: true, force: true });
  };
  process.once('exit', cleanup);
  return Object.freeze({ path: worktree, branch, head, cleanup });
}
const REVIEW_WORKTREE = createCanonicalReviewWorktreeFixture();
const REVIEW_HEAD = REVIEW_WORKTREE.head;
const REVIEW_BRANCH = REVIEW_WORKTREE.branch;
const REVIEW_RUN = {
  packet: REVIEW_PACKET,
  baseCommit: REVIEW_HEAD,
  worktree: { path: REVIEW_WORKTREE.path, branch: REVIEW_BRANCH, baseCommit: REVIEW_HEAD },
};

function overlayCurrentSubject(worktree) {
  const subject = JSON.parse(checkedTestCommand('resolve overlay subject', process.execPath,
    [path.join(ROOT, 'builder-control', 'engineering-os.cjs'), '--subject', '--json'],
    { cwd: ROOT }).stdout);
  const originals = [];
  checkedTestCommand('reset overlay fixture index', 'git', ['reset', '--mixed', REVIEW_HEAD], { cwd: worktree });
  // engineering-os deliberately excludes its governing packet from the code
  // subject. The nested review fixture still needs the exact current packet,
  // otherwise current source is evaluated against the stale HEAD allowlist.
  const overlayPaths = [...new Set([...(subject.subjectPaths || []), REVIEW_PACKET])];
  for (const relative of overlayPaths) {
    const source = path.join(ROOT, relative);
    const target = path.join(worktree, relative);
    let original = null;
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`unsafe overlay target: ${relative}`);
      original = { bytes: fs.readFileSync(target), mode: stat.mode & 0o777 };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    originals.push({ relative, original });
    if (!fs.existsSync(source)) {
      fs.rmSync(target, { force: true });
      continue;
    }
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error(`unsafe overlay source: ${relative}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(source), { mode: sourceStat.mode & 0o777 });
    const inHead = spawnSync('git', ['cat-file', '-e', `${REVIEW_HEAD}:${relative}`], {
      cwd: worktree, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
    });
    if (inHead.status !== 0) checkedTestCommand('publish overlay new-file intent', 'git',
      ['add', '-N', '--', relative], { cwd: worktree });
  }
  return () => {
    checkedTestCommand('restore overlay fixture index', 'git', ['reset', '--mixed', REVIEW_HEAD], { cwd: worktree });
    for (const { relative, original } of originals) {
      const target = path.join(worktree, relative);
      if (!original) fs.rmSync(target, { force: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, original.bytes, { mode: original.mode });
      }
    }
  };
}

function writeCanonicalCheckPacket(testsRequiredInput, extra = {}) {
  const name = `PKT-TEST-CHECKS-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`;
  const absolute = path.join(R.PACKETS_DIR, name);
  const relative = path.relative(ROOT, absolute);
  const testsRequired = typeof testsRequiredInput === 'function'
    ? testsRequiredInput(relative) : testsRequiredInput;
  const bytes = JSON.stringify({ ...extra, testsRequired }, null, 2) + '\n';
  fs.writeFileSync(absolute, bytes, {
    flag: 'wx', mode: 0o600,
  });
  return {
    absolute,
    relative,
    initialSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function reserveLoopbackTestPort() {
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const state = new Int32Array(shared);
  const worker = new Worker(`
    const net = require('net');
    const { workerData } = require('worker_threads');
    const state = new Int32Array(workerData);
    const server = net.createServer();
    server.once('error', () => { Atomics.store(state, 0, -1); Atomics.notify(state, 0); });
    server.listen(0, '127.0.0.1', () => {
      Atomics.store(state, 0, server.address().port);
      Atomics.notify(state, 0);
      Atomics.wait(state, 1, 0);
      server.close(() => { Atomics.store(state, 1, 2); Atomics.notify(state, 1); });
    });
  `, { eval: true, workerData: shared });
  const wait = Atomics.wait(state, 0, 0, 2000);
  const port = Atomics.load(state, 0);
  assert.notStrictEqual(wait, 'timed-out', 'timed out reserving loopback test port');
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535,
    `invalid reserved loopback test port: ${port}`);
  let released = false;
  return {
    port,
    release() {
      if (released) return;
      released = true;
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
      assert.notStrictEqual(Atomics.wait(state, 1, 1, 2000), 'timed-out',
        'timed out releasing loopback test port reservation');
      worker.unref();
    },
  };
}
function passingHostContainmentReceipt(runId, packetCoordinate, subject, command) {
  const coverage = [
    'node builder-control/test/functional-beta-snapshot.test.cjs',
    'node builder-control/test/dashboard-slice.test.cjs',
  ].map((coveredCommand, index) => ({
    suite: 'pre-host-command', command: coveredCommand,
    coverage: 'COVERED_BY_EXACT_PREHOST_COMMAND', evidenceSha256: String(index + 1).repeat(64),
  }));
  const body = {
    schemaVersion: 1,
    authority: 'aegis-run.cjs runHostContainmentCheck',
    executionBoundary: 'AEGIS_TOP_LEVEL_HOST_CONTAINMENT_V1',
    runId,
    packet: packetCoordinate,
    subject,
    snapshot: {
      policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1',
      captureSha256: 'c'.repeat(64),
    },
    command,
    platform: 'darwin',
    startedAt: '2026-08-27T17:59:30.000Z',
    completedAt: '2026-08-27T17:59:50.000Z',
    complete: true,
    outcome: 'PASS',
    preHostReceiptRef: {
      entryId: `LED-CHECK-${'a'.repeat(32)}`,
      receiptSha256: 'b'.repeat(64),
    },
    coverage,
    result: {
      status: 'EXECUTED', exit: 0, passed: 128, covered: coverage.length,
      skipped: 0, failed: 0, total: 128 + coverage.length,
      groupDrained: true, ownedGroupDrainageProven: true,
      summaryParsed: true, outputBytes: 4096, outputSha256: 'e'.repeat(64), outputTruncated: false,
    },
  };
  return { ...body, receiptSha256: R.hostContainmentReceiptDigest(body) };
}
function passedChecksFor(runId, subject = reviewSubject(), packetPath = REVIEW_PACKET) {
  const absolutePacket = path.resolve(ROOT, packetPath);
  const packet = JSON.parse(fs.readFileSync(absolutePacket, 'utf8'));
  const commands = (packet.testsRequired || []).filter((command) => {
    const tokens = String(command).trim().split(/\s+/);
    return !(tokens[0] === 'node' && (tokens[1] || '').replace(/^\.\//, '') ===
      'builder-control/engineering-os.cjs' && tokens.includes('--gate-done'));
  });
  const ranAt = '2026-08-27T18:00:00.000Z';
  const packetCoordinate = {
    path: packetPath,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(absolutePacket)).digest('hex'),
  };
  const hostCommands = Array.isArray(packet.hostContainmentRequired)
    ? packet.hostContainmentRequired : [];
  const receiptBody = {
    schemaVersion: 1,
    authority: 'aegis-run.cjs runChecks',
    runId,
    packet: packetCoordinate,
    subject,
    startedAt: '2026-08-27T17:59:00.000Z',
    completedAt: ranAt,
    complete: true,
    outcome: 'PASS',
    total: commands.length,
    passed: commands.length,
    results: commands.map((cmd) => ({ cmd, status: 'EXECUTED', exit: 0, ranAt })),
    ...(hostCommands.length ? {
      hostContainment: passingHostContainmentReceipt(
        runId, packetCoordinate, subject, hostCommands[0]),
    } : {}),
  };
  const receipt = { ...receiptBody, receiptSha256: R.checkReceiptDigest(receiptBody) };
  return {
    ranAt,
    total: commands.length,
    passed: commands.length,
    results: receipt.results.map(({ cmd, exit, ranAt: resultRanAt }) => ({ cmd, exit, ranAt: resultRanAt })),
    receipt,
  };
}

function preHostChecksFor(runId, subject = reviewSubject(), packetPath = REVIEW_PACKET, options = {}) {
  const absolutePacket = path.resolve(ROOT, packetPath);
  const packet = JSON.parse(fs.readFileSync(absolutePacket, 'utf8'));
  const commands = (packet.testsRequired || []).filter((command) => {
    const tokens = String(command).trim().split(/\s+/);
    return !(tokens[0] === 'node' && (tokens[1] || '').replace(/^\.\//, '') ===
      'builder-control/engineering-os.cjs' && tokens.includes('--gate-done'));
  });
  const hostCommands = packet.hostContainmentRequired || [];
  const ranAt = '2026-08-27T18:00:00.000Z';
  const packetCoordinate = {
    path: packetPath,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(absolutePacket)).digest('hex'),
  };
  const body = {
    schemaVersion: 1,
    receiptType: 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1',
    authority: 'aegis-run.cjs runChecks',
    runId,
    packet: packetCoordinate,
    subject,
    snapshot: {
      policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1',
      captureSha256: options.captureSha256 || 'c'.repeat(64),
    },
    startedAt: '2026-08-27T17:59:00.000Z',
    completedAt: ranAt,
    complete: true,
    outcome: 'PASS',
    total: commands.length,
    passed: commands.length,
    results: commands.map((cmd) => ({ cmd, status: 'EXECUTED', exit: 0, ranAt })),
    hostContainment: { state: 'PENDING', commands: hostCommands },
  };
  const receipt = { ...body, receiptSha256: R.checkReceiptDigest(body) };
  return {
    ranAt, total: commands.length, passed: commands.length,
    results: receipt.results.map(({ cmd, exit, ranAt: resultRanAt }) =>
      ({ cmd, exit, ranAt: resultRanAt })),
    hostContainment: { state: 'PENDING', command: hostCommands[0] },
    preHostReceipt: receipt,
  };
}

test('engineeringOsMock: refuses a gate invocation with omitted exact-subject binding', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject);
  const engos = path.join(ROOT, 'builder-control', 'engineering-os.cjs');
  const probe = spawnSync('node', ['-e', `
    ${engineeringOsMock([{ status: 0, body: gate }])}
    require('child_process').spawnSync(process.execPath, [
      ${JSON.stringify(engos)}, '--gate-done', '--packet',
      ${JSON.stringify(path.resolve(ROOT, REVIEW_PACKET))}, '--json'
    ], { cwd: ${JSON.stringify(ROOT)}, encoding: 'utf8' });
  `], { cwd: ROOT, encoding: 'utf8' });
  assert.notStrictEqual(probe.status, 0, 'omitting --subject-sha must fail the review-authority proof');
  assert.match(probe.stderr, /engineering-os invocation mismatch/);
});

hostOrchestrationTest('bindIndependentReview: finalizes pre-host evidence before binding one canonical exact subject', () => {
  const restoreSubject = overlayCurrentSubject(REVIEW_WORKTREE.path);
  try {
  const reviewGitDir = checkedTestCommand('resolve positive review fixture Git directory', 'git',
    ['-C', REVIEW_WORKTREE.path, 'rev-parse', '--absolute-git-dir']).stdout.trim();
  const subject = JSON.parse(checkedTestCommand('resolve positive review fixture subject', process.execPath,
    [path.join(ROOT, 'builder-control', 'engineering-os.cjs'), '--subject', '--packet', REVIEW_PACKET, '--json'], {
      cwd: ROOT,
      env: {
        ...process.env,
        GIT_DIR: reviewGitDir,
        GIT_WORK_TREE: fs.realpathSync(REVIEW_WORKTREE.path),
      },
    }).stdout);
  const gate = reviewGate(subject);
  const packetAbsolute = path.resolve(ROOT, REVIEW_PACKET);
  const packetBytes = fs.readFileSync(packetAbsolute);
  const capture = R.captureCheckExecutionSource(REVIEW_WORKTREE.path, {
    path: REVIEW_PACKET,
    bytes: packetBytes,
  }, subject, {
    required: true,
    generator: 'builder-control/aegis-state.cjs',
    output: 'builder-control/dashboard/state.js',
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN,
    checks: preHostChecksFor(seedRunId, subject, REVIEW_PACKET, {
      captureSha256: capture.captureSha256,
    }),
  }), `
    const result = R.bindIndependentReview(runId, {
      subjectSha256: 'f'.repeat(64), reviewer: 'browser', model: 'browser', executable: '/tmp/browser'
    });
    console.log(JSON.stringify(result));
  `, engineeringOsMock([
    { status: 0, body: subject },
    { status: 0, body: gate },
    { status: 0, body: subject },
    { status: 0, body: subject },
  ]));
  assert.strictEqual(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout.trim().split('\n').pop());
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.deepStrictEqual(Object.keys(result).sort(),
    ['action', 'nextAction', 'runId', 'state', 'subjectSha256'].sort(),
    `host finalization result: ${JSON.stringify({ result, hostContainment: saved.checks && saved.checks.hostContainment })}`);
  assert.strictEqual(result.state, 'REVIEW_BOUND');
  assert.strictEqual(result.subjectSha256, subject.subjectSha256,
    'browser-supplied subject must not become authoritative');
  assert.strictEqual(saved.state, 'REVIEW_BOUND');
  assert.ok(saved.checks.receiptRef && /^[0-9a-f]{64}$/.test(saved.checks.receiptRef.receiptSha256),
    'review bind did not publish the final canonical check receipt');
  assert.strictEqual(saved.checks.hostContainment.state, 'PASSED');
  const finalReceipt = receiptFromLedger(ledger, saved.checks);
  assert.strictEqual(finalReceipt.outcome, 'PASS');
  assert.strictEqual(finalReceipt.hostContainment.outcome, 'PASS');
  assert.strictEqual(finalReceipt.hostContainment.result.skipped, 0);
  assert.deepStrictEqual(Object.keys(saved.subject).sort(),
    ['authority', 'boundAt', 'diffBytes', 'pathCount', 'range', 'subjectSha256'].sort());
  assert.strictEqual(saved.subject.subjectSha256, subject.subjectSha256);
  assert.strictEqual(saved.reviewGate.authority, 'engineering-os.cjs --gate-done');
  assert.strictEqual(saved.reviewGate.exactSubjectReviews, 2);
  assert.strictEqual(saved.reviewGate.ignoredForeignReviews, 1);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'CHECKS_PASSED' && t.to === 'REVIEW_BOUND').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((entry) => entry.operationId === `${runId}:CHECKS_PASSED->REVIEW_BOUND`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
  } finally {
    restoreSubject();
  }
});

test('check receipt authority: mutable run state keeps only a projection and ledger receipt reference', () => {
  const subject = reviewSubject();
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), `
    const run = R.loadRun(runId);
    const receipt = R.loadCanonicalCheckReceipt(run.checks, { runId });
    console.log(JSON.stringify({ run, receipt }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.run.checks.receipt, undefined, 'complete receipt remained in mutable run state');
  assert.match(out.run.checks.receiptRef.entryId, /^LED-CHECK-[0-9a-f]{32}$/);
  assert.strictEqual(out.receipt.runId, runId);
  assert.deepStrictEqual(out.receipt.subject, subject);
  assert.deepStrictEqual(receiptFromLedger(ledger, out.run.checks), out.receipt);
  const evidence = ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-check-receipt');
  assert.strictEqual(evidence.length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('check receipt authority RED: run projection cannot inject or retarget canonical receipt evidence', () => {
  const subject = reviewSubject();
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), `
    const run = R.loadRun(runId);
    run.checks.receiptRef.receiptSha256 = 'f'.repeat(64);
    R.saveRun(run);
    try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
    catch (e) { console.log(JSON.stringify({ threw: true, code: e.code })); }
  `, engineeringOsMock([]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'REVIEW-CHECKS-INVALID' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8')).state,
    'CHECKS_PASSED');
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('check receipt authority RED: edited append-only evidence is not accepted by review binding', () => {
  const subject = reviewSubject();
  const { r, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), `
    const ledger = JSON.parse(fs.readFileSync(process.env.AEGIS_LEDGER_FILE, 'utf8'));
    const receiptEntry = ledger.find((entry) => entry.gate === 'aegis-check-receipt');
    receiptEntry.notes = receiptEntry.notes.slice(0, -1) + (receiptEntry.notes.endsWith('A') ? 'B' : 'A');
    fs.writeFileSync(process.env.AEGIS_LEDGER_FILE, JSON.stringify(ledger, null, 2));
    try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
    catch (e) { console.log(JSON.stringify({ threw: true, code: e.code })); }
  `, `const fs = require('fs'); ${engineeringOsMock([])}`);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'REVIEW-CHECKS-INVALID' });
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: refuses invalid check evidence before consulting review authority', () => {
  const invalidMutations = [
    () => null,
    (checks) => ({ ...checks, total: 0, passed: 0, results: [] }),
    (checks) => ({ ...checks, passed: checks.passed - 1 }),
    (checks) => ({ ...checks, results: [{ cmd: 'one', exit: 0 }] }),
    (checks) => ({ ...checks, results: checks.results.map((x, i) => ({ ...x, exit: i ? 1 : 0 })) }),
  ];
  for (const mutate of invalidMutations) {
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => {
      const valid = passedChecksFor(seedRunId);
      return { ...REVIEW_RUN, checks: mutate(valid) };
    }, `
      try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
      catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
    `, engineeringOsMock([]));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
      { threw: true, code: 'REVIEW-CHECKS-INVALID', httpStatus: 409 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_PASSED');
    assert.strictEqual(saved.subject, undefined);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('bindIndependentReview: missing, foreign-only, stale, partial, ambiguous, and unavailable review evidence never becomes reviewer rejection', () => {
  const subject = reviewSubject();
  const rules = [
    'ENGOS-REVIEW-MISSING', 'ENGOS-REVIEW-MISSING', 'ENGOS-REVIEW-STALE',
    'ENGOS-REVIEW-PARTIAL', 'ENGOS-REVIEW-AMBIGUOUS', 'ENGOS-REVIEW-UNAVAILABLE',
  ];
  for (const rule of rules) {
    const gate = reviewGate(subject, {
      ok: false, problems: [{ rule, detail: 'fixture refusal' }],
      reviewerCompleteness: {
        complete: false,
        pathCoverage: { total: 2, coveredByEveryRequiredReviewer: [], notCoveredByEveryRequiredReviewer: subject.subjectPaths },
      },
      reviewsBound: 0, reviewsActive: 0, reviewsForeign: rule === 'ENGOS-REVIEW-MISSING' ? 2 : 0,
    });
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
      ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
    }), `
      try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
      catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
    `, engineeringOsMock([{ status: 0, body: subject }, { status: 3, body: gate }]));
    assert.strictEqual(r.status, 0, `${rule}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(out, { threw: true, code: 'REVIEW-GATE-REFUSED', httpStatus: 409 }, rule);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_PASSED', rule);
    assert.strictEqual(saved.subject, undefined, rule);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length, 0, rule);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('bindIndependentReview: an incomplete mixed review set remains CHECKS_PASSED despite a rejection', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject, {
    ok: false,
    state: 'BLOCKED',
    problems: [
      { rule: 'ENGOS-REVIEW-REJECTED', detail: 'codex returned REJECT (REV-codex-current)' },
      { rule: 'ENGOS-OPEN-BLOCKING-FINDING', detail: '/private/secret-path must not persist' },
      { rule: 'ENGOS-REVIEW-MISSING', detail: 'grok is still missing' },
    ],
    reviewerCompleteness: {
      subjectSha256: subject.subjectSha256,
      complete: false,
      pathCoverage: { total: 2, coveredByEveryRequiredReviewer: [],
        notCoveredByEveryRequiredReviewer: subject.subjectPaths },
      rows: [
        { reviewer: 'codex', executed: 'EXECUTED', disposition: 'REJECT', reviewId: 'REV-codex-current' },
        { reviewer: 'grok', executed: 'MISSING', disposition: null, reviewId: null },
      ],
    },
    reviewsBound: 1, reviewsActive: 1, reviewsForeign: 0,
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), `
    try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
    catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
  `, engineeringOsMock([
    { status: 0, body: subject }, { status: 3, body: gate },
  ]));
  assert.strictEqual(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(result,
    { threw: true, code: 'REVIEW-GATE-REFUSED', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.strictEqual(saved.reviewFailure, undefined);
  assert.strictEqual(saved.reviewFailures, undefined);
  assert.strictEqual(saved.transitions.filter((t) =>
    t.from === 'CHECKS_PASSED' && t.to === 'REVIEW_FAILED').length, 0);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) =>
    entry.operationId === `${runId}:CHECKS_PASSED->REVIEW_FAILED`).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: an OPEN HIGH from a non-REJECT record reaches REVIEW_FAILED and permits Retry', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject, {
    ok: false,
    state: 'BLOCKED',
    problems: [{ rule: 'ENGOS-OPEN-BLOCKING-FINDING',
      detail: 'HIGH from codex in builder-control/aegis-run.cjs: untrusted detail must not persist' }],
    reviewerCompleteness: {
      subjectSha256: subject.subjectSha256,
      complete: true,
      pathCoverage: { total: 2, coveredByEveryRequiredReviewer: subject.subjectPaths,
        notCoveredByEveryRequiredReviewer: [] },
      rows: [
        { reviewer: 'codex', required: 'REQUIRED', executed: 'EXECUTED',
          disposition: 'APPROVE_WITH_NOTES', reviewId: 'REV-codex-open-high',
          missingPaths: [], stalePaths: [] },
        { reviewer: 'grok', required: 'REQUIRED', executed: 'EXECUTED',
          disposition: 'APPROVE', reviewId: 'REV-grok-current', missingPaths: [], stalePaths: [] },
      ],
    },
    reviewsBound: 1, reviewsActive: 1, reviewsForeign: 0,
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: preHostChecksFor(seedRunId, subject),
  }), `
    const refused = R.bindIndependentReview(runId);
    const retried = R.retryRun(runId);
    console.log(JSON.stringify({ refused, retried }));
  `, engineeringOsMock([
    { status: 0, body: subject }, { status: 3, body: gate }, { status: 0, body: subject },
  ]));
  assert.strictEqual(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(result.refused.state, 'REVIEW_FAILED');
  assert.strictEqual(result.refused.outcome, 'REFUSED');
  assert.strictEqual(result.retried.state, 'CORRECTING');
  assert.strictEqual(result.retried.nextAction, `--build ${runId} --cmd "<command>"`);
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CORRECTING');
  assert.deepStrictEqual(saved.reviewFailure.rejectedReviewers, [
    { reviewer: 'codex', reviewId: 'REV-codex-open-high' },
  ]);
  assert.strictEqual(saved.reviewFailure.checkReceiptSha256,
    saved.checks.preHostReceiptRef.receiptSha256);
  assert.strictEqual(saved.checks.hostContainment.state, 'PENDING',
    'subject-controlled host suite ran before a passing exact-subject review gate');
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((entry) => entry.gate === 'aegis-check-receipt').length, 0,
    'a final host-bound receipt was published for a refused review');
  assert.strictEqual(saved.reviewFailure.blockingFindingCount, 1);
  assert.ok(!JSON.stringify(saved.reviewFailure).includes('untrusted detail'));
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) =>
    entry.operationId === `${runId}:CHECKS_PASSED->REVIEW_FAILED`).length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) =>
    entry.operationId === `${runId}:REVIEW_FAILED->CORRECTING`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: a rejection for a subject that moves before attribution stays CHECKS_PASSED', () => {
  const subject = reviewSubject();
  const moved = reviewSubject({ subjectSha256: 'c'.repeat(64), diffBytes: subject.diffBytes + 1 });
  const gate = reviewGate(subject, {
    ok: false, state: 'BLOCKED',
    problems: [{ rule: 'ENGOS-REVIEW-REJECTED', detail: 'codex returned REJECT' }],
    reviewerCompleteness: {
      subjectSha256: subject.subjectSha256, complete: true,
      pathCoverage: { total: 2, coveredByEveryRequiredReviewer: subject.subjectPaths,
        notCoveredByEveryRequiredReviewer: [] },
      rows: [
        { reviewer: 'codex', required: 'REQUIRED', executed: 'EXECUTED', disposition: 'REJECT',
          reviewId: 'REV-codex-moving', missingPaths: [], stalePaths: [] },
        { reviewer: 'grok', required: 'REQUIRED', executed: 'EXECUTED', disposition: 'APPROVE',
          reviewId: 'REV-grok-moving', missingPaths: [], stalePaths: [] },
      ],
    },
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), `
    try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
    catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
  `, engineeringOsMock([
    { status: 0, body: subject }, { status: 3, body: gate }, { status: 0, body: moved },
  ]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'REVIEW-SUBJECT-MOVED', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.strictEqual(saved.reviewFailure, undefined);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: a subject moving after gate evaluation fails closed with no evidence persisted', () => {
  const subject = reviewSubject();
  const moved = reviewSubject({ subjectSha256: 'b'.repeat(64), diffBytes: 4097 });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), `
    try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
    catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
  `, engineeringOsMock([
    { status: 0, body: subject }, { status: 0, body: reviewGate(subject) }, { status: 0, body: moved },
  ]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'REVIEW-SUBJECT-MOVED', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.strictEqual(saved.subject, undefined);
  assert.strictEqual(saved.reviewGate, undefined);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: gate success without complete exact path coverage is refused', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject);
  gate.reviewerCompleteness.complete = false;
  gate.reviewerCompleteness.pathCoverage.notCoveredByEveryRequiredReviewer = [subject.subjectPaths[1]];
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), `
    try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
    catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
  `, engineeringOsMock([{ status: 0, body: subject }, { status: 0, body: gate }]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'REVIEW-GATE-REFUSED', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.strictEqual(saved.subject, undefined);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: moved or forged run worktree metadata is refused before review authority', () => {
  const primaryBranch = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const invalidRuns = [
    { ...REVIEW_RUN, baseCommit: null },
    { ...REVIEW_RUN, worktree: { ...REVIEW_RUN.worktree, baseCommit: '0'.repeat(40) } },
    { ...REVIEW_RUN, worktree: { ...REVIEW_RUN.worktree, branch: 'aegis/forged-branch' } },
    { ...REVIEW_RUN, worktree: { ...REVIEW_RUN.worktree, path: os.tmpdir() } },
    { ...REVIEW_RUN, worktree: { path: ROOT, branch: primaryBranch, baseCommit: REVIEW_HEAD } },
  ];
  for (const invalid of invalidRuns) {
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
      ...invalid, checks: passedChecksFor(seedRunId),
    }), `
      try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
      catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
    `, engineeringOsMock([]));
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true);
    assert.ok(['REVIEW-RUN-INVALID', 'REVIEW-WORKTREE-INVALID', 'REVIEW-WORKTREE-FOREIGN'].includes(out.code), out.code);
    assert.strictEqual(out.httpStatus, 409);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_PASSED');
    assert.strictEqual(saved.subject, undefined);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('bindIndependentReview: owns the per-run claim and accepts no browser authority inputs', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const body = src.slice(src.indexOf('function bindIndependentReview(runId)'), src.indexOf('function cmdChecks', src.indexOf('function bindIndependentReview(runId)')));
  assert.strictEqual(R.bindIndependentReview.length, 1);
  assert.match(body, /acquireRunLaunchClaim/);
  assert.match(body, /bindIndependentReviewClaimed\(run\)/);
  assert.doesNotMatch(body, /options|reviewer|model|executable|subjectSha/);
});

// Records every process the control path actually starts. The read-only
// preflight is allowed to ASK the canonical subject and gate authorities; it is
// not allowed to launch a reviewer, a worker, a shell or a check suite.
function spawnLedgerProbe() {
  return `
    const probeChildProcess = require('child_process');
    const probeRecords = [];
    const probeSpawnSync = probeChildProcess.spawnSync;
    probeChildProcess.spawnSync = function(command, args) {
      probeRecords.push(command === 'git' ? 'git'
        : (command === process.execPath && Array.isArray(args) && typeof args[0] === 'string' &&
            args[0].endsWith('/builder-control/engineering-os.cjs')
              ? 'engineering-os ' + args[1]
              : 'UNEXPECTED_SPAWN_SYNC ' + command));
      return probeSpawnSync.apply(this, arguments);
    };
    for (const forbidden of ['spawn', 'exec', 'execFile', 'execSync', 'fork']) {
      const originalForbidden = probeChildProcess[forbidden];
      probeChildProcess[forbidden] = function() {
        probeRecords.push('UNEXPECTED_' + forbidden.toUpperCase());
        return originalForbidden.apply(this, arguments);
      };
    }
    global.__probeRecords = probeRecords;
  `;
}

const PREFLIGHT_OBSERVATION_DRIVER = `
  const preflightFs = require('fs');
  const runFile = require('path').join(process.env.AEGIS_RUNS_DIR, runId + '.json');
  const beforeRun = preflightFs.readFileSync(runFile, 'utf8');
  const beforeLedger = preflightFs.readFileSync(process.env.AEGIS_LEDGER_FILE, 'utf8');
  const probeStart = global.__probeRecords ? global.__probeRecords.length : 0;
  const result = R.prepareIndependentReview(runId);
  console.log(JSON.stringify({
    result,
    frozen: Object.isFrozen(result),
    spawned: global.__probeRecords ? global.__probeRecords.slice(probeStart) : [],
    runUnchanged: preflightFs.readFileSync(runFile, 'utf8') === beforeRun,
    ledgerUnchanged: preflightFs.readFileSync(process.env.AEGIS_LEDGER_FILE, 'utf8') === beforeLedger,
    runLockExists: preflightFs.existsSync(runFile + '.launch.lock'),
    globalLockExists: preflightFs.existsSync(R.globalWorkerLockPath()),
  }));
`;

function assertPreflightLeftNothingBehind(out, runsDir, ledger, runId, label = '') {
  assert.strictEqual(out.runUnchanged, true, `${label}: the preflight rewrote the run file`);
  assert.strictEqual(out.ledgerUnchanged, true, `${label}: the preflight appended to the canonical ledger`);
  assert.strictEqual(out.runLockExists, false, `${label}: the preflight took a per-run launch claim`);
  assert.strictEqual(out.globalLockExists, false, `${label}: the preflight touched the global worker lock`);
  assert.strictEqual(out.frozen, true, `${label}: the preflight answer is mutable`);
  assert.strictEqual(out.result.mutations, 'NONE', label);
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.subject, undefined, label);
  assert.strictEqual(saved.reviewGate, undefined, label);
  assert.strictEqual(saved.reviewFailure, undefined, label);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length,
    0, label);
  return saved;
}

test('prepareIndependentReview: names the canonical pending reviewers for the exact subject and mutates nothing', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject, {
    ok: false,
    state: 'BLOCKED',
    problems: [
      { rule: 'ENGOS-REVIEW-MISSING', detail: 'codex has no record bound to this subject' },
      { rule: 'ENGOS-REVIEW-MISSING', detail: 'grok has no record bound to this subject' },
    ],
    reviewerCompleteness: {
      subjectSha256: subject.subjectSha256,
      complete: false,
      required: ['codex', 'grok'],
      missing: ['codex', 'grok'],
      pathCoverage: { total: 2, coveredByEveryRequiredReviewer: [],
        notCoveredByEveryRequiredReviewer: subject.subjectPaths },
      rows: [
        { reviewer: 'codex', required: 'REQUIRED', executed: 'MISSING', disposition: null,
          reviewId: null, missingPaths: subject.subjectPaths, stalePaths: [] },
        { reviewer: 'grok', required: 'REQUIRED', executed: 'STALE', disposition: null,
          reviewId: null, missingPaths: subject.subjectPaths, stalePaths: [] },
        { reviewer: 'copilot', required: 'ADVISORY', executed: 'MISSING', disposition: null,
          reviewId: null, missingPaths: subject.subjectPaths, stalePaths: [] },
      ],
    },
    reviewsBound: 0, reviewsActive: 0, reviewsForeign: 2,
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), PREFLIGHT_OBSERVATION_DRIVER,
  `${engineeringOsMock([{ status: 0, body: subject }, { status: 3, body: gate },
    reviewCycleStart(subject)])}
   ${spawnLedgerProbe()}`);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());

  assert.strictEqual(out.result.status, 'REVIEW_PERMITTED');
  assert.strictEqual(out.result.reasonCode, 'EXACT_SUBJECT_REVIEW_PENDING');
  assert.strictEqual(out.result.nextAction, 'independent-review');
  assert.strictEqual(out.result.runId, runId);
  assert.strictEqual(out.result.state, 'CHECKS_PASSED');
  assert.strictEqual(out.result.action, 'prepare-independent-review');

  // Only REQUIRED reviewers that still owe an exact-subject review are named.
  assert.deepStrictEqual(out.result.pendingReviewers, [
    { reviewer: 'codex', executed: 'MISSING', coverage: 'NONE' },
    { reviewer: 'grok', executed: 'STALE', coverage: 'NONE' },
  ]);
  assert.deepStrictEqual(out.result.requiredReviewers, ['codex', 'grok']);
  assert.strictEqual(out.result.lane, 'FULL');

  // Exact coordinates, taken from the canonical subject and the canonical receipt.
  assert.deepStrictEqual(out.result.subject, {
    subjectSha256: subject.subjectSha256,
    subjectPaths: subject.subjectPaths,
    diffBytes: subject.diffBytes,
    range: subject.range,
  });
  assert.deepStrictEqual(out.result.packet, {
    path: REVIEW_PACKET,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, REVIEW_PACKET))).digest('hex'),
  });
  assert.deepStrictEqual(out.result.evidence, {
    source: 'CANONICAL_CHECK_RECEIPT',
    receiptSha256: passedChecksFor(runId, subject).receipt.receiptSha256,
    hostContainment: 'BOUND',
  });

  // The canonical cycle verdict is reported as given, never re-derived here.
  assert.deepStrictEqual(out.result.reviewCycle, {
    packetId: REVIEW_PACKET_ID, roundCount: 1, maxRounds: 3, roundsRemaining: 2, verdict: 'PROCEED',
  });

  // Three read-only authority questions, and no launch of anything.
  assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('engineering-os')),
    ['engineering-os --subject', 'engineering-os --gate-done', 'engineering-os --start']);
  assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('UNEXPECTED')), []);
  assert.ok(out.spawned.every((entry) => entry === 'git' || entry.startsWith('engineering-os')),
    `unexpected process launched by the preflight: ${JSON.stringify(out.spawned)}`);

  const saved = assertPreflightLeftNothingBehind(out, runsDir, ledger, runId, 'pending reviewers');
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('prepareIndependentReview: complete exact-subject coverage reports no additional review and binds nothing', () => {
  const subject = reviewSubject();
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: preHostChecksFor(seedRunId, subject),
  }), PREFLIGHT_OBSERVATION_DRIVER,
  `${engineeringOsMock([{ status: 0, body: subject }, { status: 0, body: reviewGate(subject) }])}
   ${spawnLedgerProbe()}`);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());

  assert.strictEqual(out.result.status, 'NO_ADDITIONAL_REVIEW_NEEDED');
  assert.strictEqual(out.result.reasonCode, 'EXACT_SUBJECT_REVIEW_COMPLETE');
  assert.strictEqual(out.result.nextAction, 'bind-independent-review');
  assert.deepStrictEqual(out.result.pendingReviewers, []);
  assert.strictEqual(out.result.subject.subjectSha256, subject.subjectSha256);

  // Pre-host evidence is real evidence, and it is stated as what it is: the
  // top-level host containment suite has not run and binding is what runs it.
  assert.deepStrictEqual(out.result.evidence, {
    source: 'CANONICAL_PRE_HOST_CHECK_RECEIPT',
    receiptSha256: preHostChecksFor(runId, subject).preHostReceipt.receiptSha256,
    hostContainment: 'PENDING_AT_BINDING',
  });
  assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('UNEXPECTED')), []);
  assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('engineering-os')),
    ['engineering-os --subject', 'engineering-os --gate-done']);

  const saved = assertPreflightLeftNothingBehind(out, runsDir, ledger, runId, 'no additional review');
  assert.strictEqual(saved.state, 'CHECKS_PASSED', 'a preflight answer bound a review');
  assert.strictEqual(saved.checks.hostContainment.state, 'PENDING',
    'the preflight executed the subject-controlled host suite');
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((entry) => entry.gate === 'aegis-check-receipt').length, 0,
    'the preflight published a final host-bound receipt');
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('prepareIndependentReview: a recorded exact-subject rejection is a refusal, never pending review work', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject, {
    ok: false,
    state: 'BLOCKED',
    problems: [{ rule: 'ENGOS-OPEN-BLOCKING-FINDING',
      detail: 'HIGH from codex in builder-control/aegis-run.cjs: untrusted detail must not persist' }],
    reviewerCompleteness: {
      subjectSha256: subject.subjectSha256,
      complete: true,
      required: ['codex', 'grok'],
      missing: [],
      pathCoverage: { total: 2, coveredByEveryRequiredReviewer: subject.subjectPaths,
        notCoveredByEveryRequiredReviewer: [] },
      rows: [
        { reviewer: 'codex', required: 'REQUIRED', executed: 'EXECUTED',
          disposition: 'APPROVE_WITH_NOTES', reviewId: 'REV-codex-open-high',
          missingPaths: [], stalePaths: [] },
        { reviewer: 'grok', required: 'REQUIRED', executed: 'EXECUTED',
          disposition: 'APPROVE', reviewId: 'REV-grok-current', missingPaths: [], stalePaths: [] },
      ],
    },
    reviewsBound: 1, reviewsActive: 1, reviewsForeign: 0,
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), PREFLIGHT_OBSERVATION_DRIVER,
  `${engineeringOsMock([{ status: 0, body: subject }, { status: 3, body: gate }])}
   ${spawnLedgerProbe()}`);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());

  assert.strictEqual(out.result.status, 'REFUSED');
  assert.strictEqual(out.result.reasonCode, 'EXACT_SUBJECT_REVIEW_REFUSED');
  assert.strictEqual(out.result.nextAction, 'retry');
  assert.deepStrictEqual(out.result.pendingReviewers, []);
  assert.deepStrictEqual(out.result.rejectedReviewers,
    [{ reviewer: 'codex', reviewId: 'REV-codex-open-high' }]);
  assert.strictEqual(out.result.blockingFindingCount, 1);
  assert.ok(!JSON.stringify(out.result).includes('untrusted detail'),
    'unbounded reviewer prose reached the preflight answer');

  // Binding records REVIEW_FAILED for this same gate. A preflight records nothing.
  const saved = assertPreflightLeftNothingBehind(out, runsDir, ledger, runId, 'recorded rejection');
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('UNEXPECTED')), []);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('prepareIndependentReview: a gate blocked outside review work names no reviewer', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject, {
    ok: false,
    state: 'BLOCKED',
    problems: [
      { rule: 'ENGOS-PATH-UNAUTHORIZED', detail: '3 changed path(s) are outside the packet filesAllowed' },
      { rule: 'ENGOS-REVIEW-MISSING', detail: 'codex has no record bound to this subject' },
    ],
    reviewerCompleteness: {
      subjectSha256: subject.subjectSha256,
      complete: false,
      required: ['codex', 'grok'],
      missing: ['codex', 'grok'],
      pathCoverage: { total: 2, coveredByEveryRequiredReviewer: [],
        notCoveredByEveryRequiredReviewer: subject.subjectPaths },
      rows: [
        { reviewer: 'codex', required: 'REQUIRED', executed: 'MISSING', disposition: null,
          reviewId: null, missingPaths: subject.subjectPaths, stalePaths: [] },
        { reviewer: 'grok', required: 'REQUIRED', executed: 'MISSING', disposition: null,
          reviewId: null, missingPaths: subject.subjectPaths, stalePaths: [] },
      ],
    },
    reviewsBound: 0, reviewsActive: 0, reviewsForeign: 0,
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
  }), PREFLIGHT_OBSERVATION_DRIVER,
  `${engineeringOsMock([{ status: 0, body: subject }, { status: 3, body: gate }])}
   ${spawnLedgerProbe()}`);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.result.status, 'REFUSED');
  assert.strictEqual(out.result.reasonCode, 'REVIEW-GATE-BLOCKED');
  assert.deepStrictEqual(out.result.pendingReviewers, [],
    'an unauthorized-path block was reported as review work a reviewer could clear');
  assert.strictEqual(out.result.nextAction, 'none');
  assertPreflightLeftNothingBehind(out, runsDir, ledger, runId, 'gate blocked outside review');
  fs.rmSync(TMP, { recursive: true, force: true });
});

// A gate that still has outstanding exact-subject review work, used wherever a
// scenario needs the preflight to get past the complete-coverage answer.
function pendingReviewGate(subject) {
  return reviewGate(subject, {
    ok: false,
    state: 'BLOCKED',
    problems: [{ rule: 'ENGOS-REVIEW-MISSING', detail: 'codex has no record bound to this subject' }],
    reviewerCompleteness: {
      subjectSha256: subject.subjectSha256,
      complete: false,
      required: ['codex', 'grok'],
      missing: ['codex', 'grok'],
      pathCoverage: {
        total: subject.subjectPaths.length,
        coveredByEveryRequiredReviewer: [],
        notCoveredByEveryRequiredReviewer: subject.subjectPaths,
      },
    },
  });
}

test('prepareIndependentReview RED: wrong state, exhausted cycle, absent receipt and a moved subject fail closed', () => {
  const subject = reviewSubject();
  const moved = reviewSubject({ subjectSha256: 'b'.repeat(64), diffBytes: 4097 });
  const refusedCycle = [1, 2, 3].map((n) => ({
    schemaVersion: 1, status: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
    subjectSha256: subject.subjectSha256, refusedAt: `2026-08-27T18:0${n}:00.000Z`,
  }));
  const scenarios = [
    {
      label: 'wrong state', state: 'BUILT', responses: [], nextAction: 'none',
      reasonCode: 'REVIEW-WRONG-STATE', checks: (id) => passedChecksFor(id, subject),
    },
    {
      label: 'exhausted review cycle', state: 'CHECKS_PASSED', nextAction: 'escalate',
      responses: [{ status: 0, body: subject }, { status: 3, body: pendingReviewGate(subject) }],
      reasonCode: 'REVIEW-CYCLE-EXHAUSTED', checks: (id) => passedChecksFor(id, subject),
      extra: { reviewFailures: refusedCycle, corrections: 3 },
    },
    {
      label: 'absent canonical receipt', state: 'CHECKS_PASSED', responses: [], nextAction: 'none',
      reasonCode: 'REVIEW-CHECKS-INVALID',
      checks: (id) => { const c = passedChecksFor(id, subject); delete c.receipt; return c; },
    },
    {
      label: 'receipt bound to a different subject', state: 'CHECKS_PASSED', nextAction: 'none',
      responses: [{ status: 0, body: moved }], reasonCode: 'REVIEW-CHECKS-STALE',
      checks: (id) => passedChecksFor(id, subject),
    },
  ];
  for (const scenario of scenarios) {
    const { r, runsDir, ledger, runId, TMP } = withSeededRun(scenario.state, (seedRunId) => ({
      ...REVIEW_RUN, checks: scenario.checks(seedRunId), ...(scenario.extra || {}),
    }), PREFLIGHT_OBSERVATION_DRIVER,
    `${engineeringOsMock(scenario.responses)}
     ${spawnLedgerProbe()}`);
    assert.strictEqual(r.status, 0, `${scenario.label}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.result.status, 'REFUSED', scenario.label);
    assert.strictEqual(out.result.reasonCode, scenario.reasonCode, scenario.label);
    assert.strictEqual(out.result.nextAction, scenario.nextAction, scenario.label);
    assert.deepStrictEqual(out.result.pendingReviewers, [],
      `${scenario.label}: a closed refusal still advertised pending review work`);
    assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('UNEXPECTED')), [],
      scenario.label);
    const saved = assertPreflightLeftNothingBehind(out, runsDir, ledger, runId, scenario.label);
    assert.strictEqual(saved.state, scenario.state, scenario.label);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

// The gate names who owes an exact-subject review; the canonical review cycle
// answers whether another round may start at all. The preflight reports the
// intersection, and never names a reviewer the cycle did not permit.
test('prepareIndependentReview: names only reviewers the canonical review cycle permits', () => {
  const subject = reviewSubject();
  const gate = pendingReviewGate(subject);
  const scenarios = [
    {
      label: 'canonical packet cycle exhausted with zero per-run review failures',
      response: reviewCycleStop(),
      status: 'REFUSED', reasonCode: 'REVIEW-CYCLE-EXHAUSTED', nextAction: 'escalate', names: [],
    },
    {
      label: 'a clean third round is complete, not permission for a fourth',
      response: reviewCycleStop('COMPLETE'),
      status: 'REFUSED', reasonCode: 'REVIEW-CYCLE-EXHAUSTED', nextAction: 'escalate', names: [],
    },
    {
      label: 'only the one permitted reviewer is named',
      response: reviewCycleStart(subject, { allowedReviewers: ['grok'], missingReviewers: ['grok'] }),
      status: 'REVIEW_PERMITTED', reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
      nextAction: 'independent-review', names: ['grok'],
    },
    {
      label: 'no reviewer permitted',
      response: reviewCycleStart(subject, { allowedReviewers: [], missingReviewers: [] }),
      status: 'REFUSED', reasonCode: 'REVIEW-CYCLE-NO-PERMITTED-REVIEWER', nextAction: 'none', names: [],
    },
    {
      // Exit 3 without the cycle's own stop banner is a policy failure printed
      // to stderr, not a verdict, and must not read as an exhausted cycle.
      label: 'unreadable cycle verdict',
      response: { call: 'start', status: 3, stdout: 'not a canonical cycle verdict' },
      status: 'REFUSED', reasonCode: 'REVIEW-CYCLE-UNREADABLE', nextAction: 'none', names: [],
    },
    {
      label: 'cycle answered for a moved subject',
      response: reviewCycleStart(reviewSubject({ subjectSha256: 'b'.repeat(64) })),
      status: 'REFUSED', reasonCode: 'REVIEW-SUBJECT-MOVED', nextAction: 'none', names: [],
    },
    {
      label: 'cycle bound to a foreign packet',
      response: reviewCycleStart(subject, { packetId: 'FOREIGN-PACKET' }),
      status: 'REFUSED', reasonCode: 'REVIEW-CYCLE-UNREADABLE', nextAction: 'none', names: [],
    },
    {
      label: 'cycle reported no readable round budget',
      response: { call: 'start', status: 0, body: { subject, classification: { lane: 'FULL',
        requiredReviewers: ['codex', 'grok'] }, reviewCycle: null } },
      status: 'REFUSED', reasonCode: 'REVIEW-CYCLE-UNREADABLE', nextAction: 'none', names: [],
    },
  ];
  for (const scenario of scenarios) {
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
      ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject), reviewFailures: [], corrections: 0,
    }), PREFLIGHT_OBSERVATION_DRIVER,
    `${engineeringOsMock([{ status: 0, body: subject }, { status: 3, body: gate }, scenario.response])}
     ${spawnLedgerProbe()}`);
    assert.strictEqual(r.status, 0, `${scenario.label}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.result.status, scenario.status, scenario.label);
    assert.strictEqual(out.result.reasonCode, scenario.reasonCode, scenario.label);
    assert.strictEqual(out.result.nextAction, scenario.nextAction, scenario.label);
    assert.deepStrictEqual(out.result.pendingReviewers.map((row) => row.reviewer), scenario.names,
      `${scenario.label}: the preflight named a reviewer the canonical cycle did not permit`);
    assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('engineering-os')),
      ['engineering-os --subject', 'engineering-os --gate-done', 'engineering-os --start'],
      scenario.label);
    assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('UNEXPECTED')), [],
      scenario.label);
    assertPreflightLeftNothingBehind(out, runsDir, ledger, runId, scenario.label);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

// The recorded per-run refusals are history. bindIndependentReview accepts this
// exact run, so a preflight that refused it would report a block the canonical
// path does not enforce.
test('prepareIndependentReview: recorded past refusals never refuse a gate that is complete now', () => {
  const subject = reviewSubject();
  const refusedCycle = [1, 2, 3].map((n) => ({
    schemaVersion: 1, status: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
    subjectSha256: subject.subjectSha256, refusedAt: `2026-08-27T18:0${n}:00.000Z`,
  }));
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', (seedRunId) => ({
    ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
    reviewFailures: refusedCycle, corrections: 3,
  }), PREFLIGHT_OBSERVATION_DRIVER,
  `${engineeringOsMock([{ status: 0, body: subject }, { status: 0, body: reviewGate(subject) }])}
   ${spawnLedgerProbe()}`);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.result.status, 'NO_ADDITIONAL_REVIEW_NEEDED');
  assert.strictEqual(out.result.reasonCode, 'EXACT_SUBJECT_REVIEW_COMPLETE');
  assert.strictEqual(out.result.nextAction, 'bind-independent-review');
  assert.deepStrictEqual(out.result.pendingReviewers, []);
  // No new round is being proposed, so the cycle authority is not asked.
  assert.deepStrictEqual(out.spawned.filter((entry) => entry.startsWith('engineering-os')),
    ['engineering-os --subject', 'engineering-os --gate-done']);
  assertPreflightLeftNothingBehind(out, runsDir, ledger, runId, 'complete gate with past refusals');
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('prepareIndependentReview: read-only by construction and shares one coordinate authority with binding', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const preflightStart = src.indexOf('function prepareIndependentReview(runId)');
  const preflight = src.slice(preflightStart,
    src.indexOf('function bindIndependentReviewClaimed', preflightStart));
  const binding = src.slice(src.indexOf('function bindIndependentReviewClaimed'),
    src.indexOf('function bindIndependentReview(runId)'));
  assert.ok(preflightStart > 0 && preflight.length > 0);
  assert.strictEqual(R.prepareIndependentReview.length, 1);
  assert.match(preflight, /canonicalReviewCoordinates\(run\)/);
  assert.match(preflight, /canonicalReviewCycleVerdict\(/,
    'the preflight reports permitted reviewers without asking the canonical review cycle');
  assert.match(binding, /canonicalReviewCoordinates\(run\)/,
    'binding no longer resolves its coordinates through the shared authority');
  assert.doesNotMatch(preflight,
    /saveRun|transition\(|recordReviewFailure|persistCanonical|appendCanonicalLedgerEntry|acquireRunLaunchClaim|releaseRunLaunchClaim|finalizeReviewedHostContainment|spawn|Worker|writeFileSync|rmSync/);
  assert.throws(() => R.prepareIndependentReview('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);
  assert.throws(() => R.prepareIndependentReview('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
});

hostContainmentTest('runChecks: exported claim-safe authority runs only packet-declared checks and returns a minimized result', () => {
  const packet = writeCanonicalCheckPacket(['node -e "process.exit(0)"']);
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['action', 'checks', 'nextAction', 'runId', 'state']);
    assert.strictEqual(out.runId, runId);
    assert.strictEqual(out.state, 'CHECKS_PASSED');
    assert.strictEqual(out.action, 'checks');
    assert.deepStrictEqual(out.checks, { passed: 1, total: 1 });
    assert.ok(!Object.prototype.hasOwnProperty.call(out, 'results'),
      'the control response must not expose packet commands or check output');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_PASSED');
    assert.strictEqual(saved.checks.passed, 1);
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_PASSED`).length, 1);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: executes against a disposable snapshot so transient mutation cannot touch the governed subject', () => {
  const before = crypto.createHash('sha256').update(fs.readFileSync(CLI)).digest('hex');
  const attack = [
    `const fs = require('fs');`,
    `const target = ${JSON.stringify(CLI)};`,
    `try {`,
    `  const original = fs.readFileSync(target);`,
    `  fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\\n// transient check mutation\\n')]));`,
    `  fs.writeFileSync(target, original);`,
    `  process.exit(29);`,
    `} catch (error) {`,
    `  process.exit(error && (error.code === 'EPERM' || error.code === 'EACCES') ? 0 : 31);`,
    `}`,
  ].join(' ');
  const packet = writeCanonicalCheckPacket([`node -e ${JSON.stringify(attack)}`]);
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_PASSED');
    assert.deepStrictEqual(out.checks, { passed: 1, total: 1 });
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(CLI)).digest('hex'), before,
      'a packet check changed and restored the governed subject outside its disposable boundary');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.deepStrictEqual(saved.checks.executionBoundary,
      { policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1', state: 'PASSED' });
    assert.strictEqual(saved.checks.results[0].status, 'EXECUTED');
    assert.strictEqual(saved.checks.results[0].exit, 0);
    assert.strictEqual(receiptFromLedger(ledger, saved.checks).outcome, 'PASS');
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_PASSED`).length, 1);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: an untracked canonical regular subject is copied with bytes and executable mode', () => {
  const name = `.aegis-untracked-subject-${process.pid}-${crypto.randomBytes(4).toString('hex')}.cjs`;
  const relative = path.posix.join('builder-control', 'test', name);
  const absolute = path.join(REVIEW_WORKTREE.path, ...relative.split('/'));
  const body = '#!/usr/bin/env node\nprocess.stdout.write("supplemental-subject-ok\\n");\n';
  fs.writeFileSync(absolute, body, { mode: 0o755 });
  fs.chmodSync(absolute, 0o755);
  const check = [
    `const fs = require('fs');`,
    `const p = ${JSON.stringify(relative)};`,
    `const ok = fs.readFileSync(p, 'utf8') === ${JSON.stringify(body)} &&`,
    `  (fs.statSync(p).mode & 0o777) === 0o755;`,
    `process.exit(ok ? 0 : 41);`,
  ].join(' ');
  const packet = writeCanonicalCheckPacket([`node -e ${JSON.stringify(check)}`], {
    filesAllowed: [relative],
  });
  const worktreePacket = path.join(REVIEW_WORKTREE.path, ...packet.relative.split('/'));
  fs.mkdirSync(path.dirname(worktreePacket), { recursive: true });
  fs.writeFileSync(worktreePacket, fs.readFileSync(packet.absolute), { flag: 'wx', mode: 0o600 });
  const fixture = withSeededRun('BUILT', { ...REVIEW_RUN, packet: packet.relative }, `
    const out = R.runChecks(runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
    const out = JSON.parse(fixture.r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_PASSED');
    assert.deepStrictEqual(out.checks, { passed: 1, total: 1 });
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.deepStrictEqual(saved.checks.executionBoundary,
      { policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1', state: 'PASSED' });
    assert.strictEqual(saved.checks.results[0].status, 'EXECUTED');
    assert.strictEqual(saved.checks.results[0].exit, 0);
  } finally {
    fs.rmSync(absolute, { force: true });
    fs.rmSync(worktreePacket, { force: true });
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: an untracked canonical symlink is refused before snapshot execution', () => {
  const name = `.aegis-untracked-subject-link-${process.pid}-${crypto.randomBytes(4).toString('hex')}.cjs`;
  const relative = path.posix.join('builder-control', 'test', name);
  const absolute = path.join(REVIEW_WORKTREE.path, ...relative.split('/'));
  fs.symlinkSync('aegis-run.test.cjs', absolute);
  const subject = reviewSubject({ subjectPaths: [relative], diffBytes: 64 });
  const packet = writeCanonicalCheckPacket(['node -e "process.exit(0)"']);
  const fixture = withSeededRun('BUILT', { ...REVIEW_RUN, packet: packet.relative }, `
    const out = R.runChecks(runId);
    console.log(JSON.stringify(out));
  `, engineeringSubjectSequenceMock([subject], packet.relative));
  try {
    assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
    const out = JSON.parse(fixture.r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.executionBoundary.state, 'FAILED');
    assert.match(saved.checks.executionBoundary.reason, /unavailable or unsafe|regular file/);
    assert.strictEqual(saved.checks.results[0].status, 'REFUSED');
    assert.strictEqual(saved.checks.results[0].exit, null);
  } finally {
    fs.rmSync(absolute, { force: true });
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: sandbox preflight refusal marks the execution boundary FAILED with a bounded reason', () => {
  const packet = writeCanonicalCheckPacket(['node -e "process.exit(0)"']);
  const fixture = withSeededRun('BUILT', { ...REVIEW_RUN, packet: packet.relative }, `
    const out = R.runChecks(runId);
    console.log(JSON.stringify(out));
  `, `
    const forcedContainment = require(${JSON.stringify(path.join(ROOT, 'builder-control', 'sandbox-containment.cjs'))});
    forcedContainment.assertSandboxOperational = function() { throw new Error('forced sandbox preflight refusal'); };
  `);
  try {
    assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_FAILED');
    assert.strictEqual(saved.checks.executionBoundary.state, 'FAILED');
    assert.match(saved.checks.executionBoundary.reason, /sandbox preflight.*forced sandbox preflight refusal/);
    assert.ok(Buffer.byteLength(saved.checks.executionBoundary.reason, 'utf8') <= 16 * 1024);
  } finally {
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: unsupported Linux snapshot platform is refused explicitly before packet execution', () => {
  const marker = path.join(os.tmpdir(), `.aegis-linux-refusal-${crypto.randomBytes(6).toString('hex')}`);
  const command = `node -e ${JSON.stringify(
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`)}`;
  const packet = writeCanonicalCheckPacket([command]);
  const fixture = withSeededRun('BUILT', { ...REVIEW_RUN, packet: packet.relative }, `
    const out = R.runChecks(runId);
    console.log(JSON.stringify(out));
  `, `Object.defineProperty(process, 'platform', { value: 'linux' });`);
  try {
    assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
    const out = JSON.parse(fixture.r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.executionBoundary.state, 'FAILED');
    assert.match(saved.checks.executionBoundary.reason,
      /sandbox preflight.*immutable check snapshots are unavailable on linux; V1 supports darwin only/);
    assert.strictEqual(saved.checks.results[0].status, 'REFUSED');
    assert.strictEqual(fs.existsSync(marker), false, 'unsupported-platform packet command was executed');
  } finally {
    fs.rmSync(marker, { force: true });
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: a stalled snapshot apply is watchdog-terminated and fails the boundary closed', () => {
  const marker = path.join(os.tmpdir(), `.aegis-stalled-apply-marker-${crypto.randomBytes(6).toString('hex')}`);
  const secret = 'AEGIS_STALLED_APPLY_BEARER_SENTINEL';
  const command = `node -e ${JSON.stringify(
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`)}`;
  const packet = writeCanonicalCheckPacket([command]);
  const fixture = withSeededRun('BUILT', { ...REVIEW_RUN, packet: packet.relative }, `
    const out = R.runChecks(runId);
    console.log(JSON.stringify(out));
  `, `
    const stalledChildProcess = require('child_process');
    const originalStalledSpawnSync = stalledChildProcess.spawnSync;
    let interceptedApply = false;
    stalledChildProcess.spawnSync = function(command, args, options) {
      if (command === 'git' && Array.isArray(args) && args.includes('apply')) {
        interceptedApply = true;
        if (!options || options.timeout !== 60000 || options.killSignal !== 'SIGKILL') {
          throw new Error('snapshot setup watchdog was not configured deterministically');
        }
        const error = new Error('spawnSync git ETIMEDOUT Authorization: Bearer ' +
          ${JSON.stringify(secret)}.repeat(1200));
        error.code = 'ETIMEDOUT';
        return { status: null, signal: 'SIGKILL', stdout: '', stderr: '', error };
      }
      return originalStalledSpawnSync.apply(this, arguments);
    };
    process.on('exit', () => {
      if (!interceptedApply) {
        console.error('snapshot apply stall was not exercised');
        process.exitCode = 98;
      }
    });
  `);
  try {
    assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
    const out = JSON.parse(fixture.r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED');
    assert.deepStrictEqual(out.checks, { passed: 0, total: 1 });
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.executionBoundary.state, 'FAILED');
    assert.match(saved.checks.executionBoundary.reason,
      /snapshot establishment.*timed out after 60000 ms.*SIGKILL termination requested/);
    assert.ok(!saved.checks.executionBoundary.reason.includes(secret),
      'bounded boundary reason retained the simulated credential');
    assert.ok(Buffer.byteLength(saved.checks.executionBoundary.reason, 'utf8') <= 16 * 1024,
      'snapshot setup timeout reason exceeded its evidence bound');
    assert.strictEqual(saved.checks.results[0].status, 'REFUSED');
    assert.strictEqual(saved.checks.results[0].exit, 125);
    assert.strictEqual(fs.existsSync(marker), false, 'declared check ran after snapshot setup timed out');
  } finally {
    fs.rmSync(marker, { force: true });
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: a signal-resistant descendant is drained before cleanup and blocks the next check', () => {
  const portReservation = reserveLoopbackTestPort();
  const testPort = portReservation.port;
  const descendant = [
    `const fs = require('fs'); const net = require('net');`,
    `process.on('SIGTERM', () => {});`,
    `setInterval(() => { if (!fs.existsSync(process.cwd())) console.log('CLEANUP_EARLY'); }, 20);`,
    `const server = net.createServer();`,
    `server.listen(${testPort}, '127.0.0.1', () => console.log('DESCENDANT_PID:' + process.pid));`,
  ].join(' ');
  const first = `node -e ${JSON.stringify(descendant)} & wait`;
  const packet = writeCanonicalCheckPacket([first, 'node -e "process.exit(0)"']);
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('aegis-check-boundary-')));
  const previousTimeout = process.env.AEGIS_TEST_CHECK_TIMEOUT_MS;
  const previousTestPort = process.env.AEGIS_TEST_CHECK_PORT;
  process.env.AEGIS_TEST_CHECK_TIMEOUT_MS = '250';
  process.env.AEGIS_TEST_CHECK_PORT = String(testPort);
  portReservation.release();
  const fixture = withSeededRun('BUILT', { ...REVIEW_RUN, packet: packet.relative }, `
    const out = R.runChecks(runId);
    console.log(JSON.stringify(out));
  `);
  if (previousTimeout === undefined) delete process.env.AEGIS_TEST_CHECK_TIMEOUT_MS;
  else process.env.AEGIS_TEST_CHECK_TIMEOUT_MS = previousTimeout;
  if (previousTestPort === undefined) delete process.env.AEGIS_TEST_CHECK_PORT;
  else process.env.AEGIS_TEST_CHECK_PORT = previousTestPort;
  try {
    assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
    const out = JSON.parse(fixture.r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED');
    assert.deepStrictEqual(out.checks, { passed: 0, total: 2 });
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.executionBoundary.state, 'FAILED');
    assert.match(saved.checks.executionBoundary.reason, /contained check exceeded 250 ms/);
    assert.strictEqual(saved.checks.results[0].status, 'REFUSED');
    assert.strictEqual(saved.checks.results[0].exit, 125);
    assert.strictEqual(saved.checks.results[1].status, 'SKIPPED');
    assert.strictEqual(saved.checks.results[1].exit, null);
    const firstOutput = saved.checks.results[0].executionEvidence.stdoutTail;
    const pidMatch = firstOutput.match(/DESCENDANT_PID:(\d+)/);
    assert.ok(pidMatch, `descendant identity was not captured: ${firstOutput}`);
    assert.ok(!firstOutput.includes('CLEANUP_EARLY'), 'snapshot cleanup ran before descendant drainage');
    const descendantPid = Number(pidMatch[1]);
    assert.throws(() => process.kill(descendantPid, 0), (error) => error && error.code === 'ESRCH',
      'signal-resistant descendant remained alive after group drainage');
    const boundariesAfter = fs.readdirSync(os.tmpdir()).filter((name) =>
      name.startsWith('aegis-check-boundary-') && !before.has(name));
    assert.deepStrictEqual(boundariesAfter, [], 'drained check boundary was not cleaned up');
    const portProbe = spawnSync(process.execPath, ['-e', [
      `const net = require('net'); const server = net.createServer();`,
      `server.once('error', () => process.exit(1));`,
      `server.listen(${testPort}, '127.0.0.1', () => server.close(() => process.exit(0)));`,
    ].join(' ')], { encoding: 'utf8', timeout: 2000 });
    assert.strictEqual(portProbe.status, 0, `descendant port was not reusable: ${portProbe.stderr}`);
  } finally {
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: trusted cleanup refusal marks the execution boundary FAILED after a contained check', () => {
  const packet = writeCanonicalCheckPacket(['node -e "process.exit(0)"']);
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('aegis-check-boundary-')));
  const fixture = withSeededRun('BUILT', { ...REVIEW_RUN, packet: packet.relative }, `
    const out = R.runChecks(runId);
    console.log(JSON.stringify(out));
  `, `
    const forcedFs = require('fs');
    const originalRmSync = forcedFs.rmSync;
    forcedFs.rmSync = function(target, options) {
      if (String(target).includes('aegis-check-boundary-')) throw new Error('forced trusted cleanup refusal');
      return originalRmSync.apply(this, arguments);
    };
  `);
  try {
    assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_FAILED');
    assert.strictEqual(saved.checks.executionBoundary.state, 'FAILED');
    assert.match(saved.checks.executionBoundary.reason, /trusted cleanup.*forced trusted cleanup refusal/);
    assert.ok(Buffer.byteLength(saved.checks.executionBoundary.reason, 'utf8') <= 16 * 1024);
  } finally {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (name.startsWith('aegis-check-boundary-') && !before.has(name)) {
        fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
      }
    }
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: deny-default boundary blocks writes through an external hard-link alias', () => {
  const aliasDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-check-hardlink-'));
  const alias = path.join(aliasDir, 'governed-alias.cjs');
  fs.linkSync(CLI, alias);
  const before = crypto.createHash('sha256').update(fs.readFileSync(CLI)).digest('hex');
  const attack = [
    `const fs = require('fs');`,
    `const target = ${JSON.stringify(alias)};`,
    `try {`,
    `  const original = fs.readFileSync(target);`,
    `  fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\\n// hard-link mutation\\n')]));`,
    `  fs.writeFileSync(target, original);`,
    `  process.exit(29);`,
    `} catch (error) {`,
    `  process.exit(error && (error.code === 'EPERM' || error.code === 'EACCES') ? 0 : 31);`,
    `}`,
  ].join(' ');
  const packet = writeCanonicalCheckPacket([`node -e ${JSON.stringify(attack)}`]);
  const { r, runsDir, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_PASSED');
    assert.deepStrictEqual(out.checks, { passed: 1, total: 1 });
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(CLI)).digest('hex'), before,
      'a check changed the governed subject through an external hard-link alias');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.executionBoundary.state, 'PASSED');
  } finally {
    fs.rmSync(aliasDir, { recursive: true, force: true });
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: a check cannot relocate the disposable boundary away from cleanup', () => {
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) =>
    name.startsWith('aegis-check-boundary-') || name.startsWith('aegis-check-relocated-')));
  const attack = [
    `const fs = require('fs'); const path = require('path');`,
    `const scratch = String(process.env.TMPDIR || '').replace(/\\/$/, '');`,
    `const boundary = path.dirname(scratch);`,
    `const moved = path.join(path.dirname(boundary), 'aegis-check-relocated-' + process.pid);`,
    `try { fs.renameSync(boundary, moved); process.exit(29); }`,
    `catch (error) { process.exit(error && (error.code === 'EPERM' || error.code === 'EACCES') ? 0 : 31); }`,
  ].join(' ');
  const packet = writeCanonicalCheckPacket([`node -e ${JSON.stringify(attack)}`]);
  const { r, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_PASSED');
    const after = fs.readdirSync(os.tmpdir()).filter((name) =>
      (name.startsWith('aegis-check-boundary-') || name.startsWith('aegis-check-relocated-')) && !before.has(name));
    assert.deepStrictEqual(after, [], `disposable boundary escaped cleanup: ${after.join(', ')}`);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: a check cannot remove permissions from disposable boundary anchors', () => {
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) =>
    name.startsWith('aegis-check-boundary-')));
  const attack = [
    `const fs = require('fs'); const path = require('path');`,
    `const scratch = String(process.env.TMPDIR || '').replace(/\\/$/, '');`,
    `const boundary = path.dirname(scratch);`,
    `const sealed = path.join(scratch, 'sealed');`,
    `fs.mkdirSync(sealed); fs.chmodSync(sealed, 0);`,
    `try { fs.chmodSync(boundary, 0); process.exit(29); }`,
    `catch (error) { process.exit(error && (error.code === 'EPERM' || error.code === 'EACCES') ? 0 : 31); }`,
  ].join(' ');
  const packet = writeCanonicalCheckPacket([`node -e ${JSON.stringify(attack)}`]);
  const { r, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_PASSED');
    const after = fs.readdirSync(os.tmpdir()).filter((name) =>
      name.startsWith('aegis-check-boundary-') && !before.has(name));
    assert.deepStrictEqual(after, [], `permission attack left a disposable boundary: ${after.join(', ')}`);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: post-check coordinate failure retains executed receipts and transitions to CHECKS_FAILED', () => {
  const marker = `.aegis-coordinate-test-${crypto.randomBytes(6).toString('hex')}`;
  const commandBody = [
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started');`,
    `setTimeout(() => process.exit(0), 750);`,
  ].join(' ');
  const packet = writeCanonicalCheckPacket([`node -e ${JSON.stringify(commandBody)}`]);
  const helperBody = [
    `const fs = require('fs');`,
    `const path = require('path');`,
    `const base = fs.realpathSync(require('os').tmpdir());`,
    `const packet = ${JSON.stringify(packet.absolute)};`,
    `const marker = ${JSON.stringify(marker)};`,
    `const started = Date.now();`,
    `const timer = setInterval(() => {`,
    `  for (const name of fs.readdirSync(base)) {`,
    `    if (!name.startsWith('aegis-check-boundary-')) continue;`,
    `    if (!fs.existsSync(path.join(base, name, 'worktree', marker))) continue;`,
    `    try { fs.unlinkSync(packet); } catch (error) { if (error.code !== 'ENOENT') throw error; }`,
    `    clearInterval(timer);`,
    `    process.exit(0);`,
    `  }`,
    `  if (Date.now() - started > 10000) { clearInterval(timer); process.exit(72); }`,
    `}, 10);`,
  ].join(' ');
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(helperBody)}],
        { cwd: ${JSON.stringify(ROOT)}, stdio: 'ignore' });
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED');
    assert.deepStrictEqual(out.checks, { passed: 1, total: 1 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_FAILED');
    assert.strictEqual(saved.checks.results.length, 1);
    assert.strictEqual(saved.checks.results[0].status, 'EXECUTED');
    assert.strictEqual(saved.checks.results[0].exit, 0);
    assert.strictEqual(saved.checks.integrity.state, 'FAILED');
    assert.ok(saved.checks.integrity.gaps.some((gap) =>
      gap.includes('post-check packet coordinate unavailable')),
    'the unavailable post-check packet coordinate was not retained');
    assert.ok(saved.checks.integrity.gaps.includes('packet changed during checks'));
    assert.strictEqual(receiptFromLedger(ledger, saved.checks).outcome, 'FAIL');
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_FAILED`).length, 1);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: packet digest, parse and snapshot use one retained byte generation under interleaving mutation', () => {
  const marker = `packet-generation-${crypto.randomBytes(6).toString('hex')}`;
  let checkCommand;
  const packet = writeCanonicalCheckPacket((packetRelative) => {
    const checkBody = [
      `const fs = require('fs');`,
      `const found = JSON.parse(fs.readFileSync(${JSON.stringify(packetRelative)}, 'utf8'));`,
      `console.log('PACKET_GENERATION:' + found.coordinateGeneration);`,
      `process.exit(found.coordinateMarker === ${JSON.stringify(marker)} &&`,
      `  found.coordinateGeneration === 'ORIGINAL' ? 0 : 73);`,
    ].join(' ');
    checkCommand = `node -e ${JSON.stringify(checkBody)}`;
    return [checkCommand];
  }, {
    coordinateMarker: marker,
    coordinateGeneration: 'ORIGINAL',
  });
  const changed = JSON.parse(fs.readFileSync(packet.absolute, 'utf8'));
  changed.coordinateGeneration = 'CHANGED';
  const changedBytes = JSON.stringify(changed, null, 2) + '\n';
  const fixture = withSeededRun('BUILT', { ...REVIEW_RUN, packet: packet.relative }, `
    const out = R.runChecks(runId);
    console.log(JSON.stringify(out));
  `, `
    const interleavingFs = require('fs');
    const interleavingChildProcess = require('child_process');
    const originalInterleavingSpawnSync = interleavingChildProcess.spawnSync;
    let packetReplaced = false;
    interleavingChildProcess.spawnSync = function(command, args, options) {
      const result = originalInterleavingSpawnSync.apply(this, arguments);
      if (!packetReplaced && command === process.execPath && Array.isArray(args) &&
          typeof args[0] === 'string' && args[0].endsWith('/builder-control/engineering-os.cjs') &&
          args.includes('--subject')) {
        interleavingFs.writeFileSync(${JSON.stringify(packet.absolute)}, ${JSON.stringify(changedBytes)});
        packetReplaced = true;
      }
      return result;
    };
    process.on('exit', () => {
      if (!packetReplaced) { console.error('packet interleaving was not exercised'); process.exitCode = 96; }
    });
  `);
  try {
    assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
    const out = JSON.parse(fixture.r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED', 'post-check packet mutation must fail integrity');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.results[0].status, 'EXECUTED');
    assert.strictEqual(saved.checks.results[0].exit, 0,
      `snapshot re-opened the changed packet instead of using the retained accepted bytes: ${saved.checks.results[0].executionEvidence.stdoutTail}`);
    assert.ok(saved.checks.integrity.gaps.includes('packet changed during checks'));
    const canonicalReceipt = receiptFromLedger(fixture.ledger, saved.checks);
    assert.strictEqual(canonicalReceipt.packet.sha256, packet.initialSha256);
    assert.deepStrictEqual(canonicalReceipt.results.map((entry) => entry.cmd), [checkCommand]);
  } finally {
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: failed declared checks persist only bounded redacted private evidence and return no raw output', () => {
  const bearer = 'AEGIS_BEARER_SENTINEL_1234567890abcdef';
  const password = 'AEGIS_PASSWORD_SENTINEL';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZWdpcy1zZW50aW5lbCJ9.signatureSentinel123';
  const diagnostic = 'AEGIS_CHECK_FAILURE_DIAGNOSTIC';
  const checkBody = [
    `for (let i = 0; i < 120; i++) console.log('padding-line-' + i);`,
    `console.log(${JSON.stringify(diagnostic)});`,
    `console.error('Authorization: Bearer ' + ${JSON.stringify(bearer)});`,
    `console.error('password=' + ${JSON.stringify(password)});`,
    `console.error(${JSON.stringify(jwt)});`,
    'process.exit(7);',
  ].join(' ');
  const failed = `node -e ${JSON.stringify(checkBody)}`;
  const packet = writeCanonicalCheckPacket([failed, 'node -e "process.exit(0)"']);
  const { r, runsDir, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['action', 'checks', 'nextAction', 'runId', 'state']);
    assert.deepStrictEqual(out.checks, { passed: 1, total: 2 });
    const publicText = JSON.stringify(out);
    for (const forbidden of [diagnostic, bearer, password, jwt, 'failureEvidence', 'stdoutTail', 'stderrTail']) {
      assert.ok(!publicText.includes(forbidden), `public checks response leaked ${forbidden}`);
    }

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.deepStrictEqual(saved.checks.executionBoundary,
      { policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1', state: 'PASSED' },
    'an ordinary executed nonzero test must not be mislabeled as a containment failure');
    const failedResult = saved.checks.results[0];
    assert.strictEqual(failedResult.exit, 7);
    assert.ok(failedResult.failureEvidence.stdoutTail.includes(diagnostic),
      'private evidence lost the useful failure diagnostic');
    assert.ok(failedResult.failureEvidence.stderrTail.includes('[REDACTED]') ||
      failedResult.failureEvidence.stderrTail.includes('[REDACTED JWT]') ||
      failedResult.failureEvidence.stderrTail.includes('[REDACTED OPAQUE]'),
    'private evidence did not record that sensitive values were redacted');
    for (const secret of [bearer, password, jwt]) {
      assert.ok(!JSON.stringify(failedResult.failureEvidence).includes(secret), `private evidence retained ${secret}`);
    }
    for (const tail of [failedResult.failureEvidence.stdoutTail, failedResult.failureEvidence.stderrTail]) {
      assert.ok(Buffer.byteLength(tail, 'utf8') <= 16 * 1024, 'failure evidence exceeded its byte bound');
      assert.ok(tail.split('\n').length <= 80, 'failure evidence exceeded its line bound');
    }
    assert.strictEqual(failedResult.failureEvidence.stdoutTruncated, true,
      'the line-bounded stdout tail must disclose that diagnostic context was truncated');
    assert.strictEqual(failedResult.failureEvidence.stderrTruncated, false,
      'redaction alone must not be mislabeled as diagnostic truncation');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(saved.checks.results[1], 'failureEvidence'), false,
      'passing checks must not be mislabeled as failures');
    assert.ok(saved.checks.results[1].executionEvidence,
      'passing checks must retain bounded redacted execution evidence');
    for (const tail of [saved.checks.results[1].executionEvidence.stdoutTail,
      saved.checks.results[1].executionEvidence.stderrTail]) {
      assert.ok(Buffer.byteLength(tail, 'utf8') <= 16 * 1024, 'passing evidence exceeded its byte bound');
      assert.ok(tail.split('\n').length <= 80, 'passing evidence exceeded its line bound');
    }
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

hostContainmentTest('runChecks: executes every declared non-recursive check including aegis-run paths', () => {
  const declared = [
    'node -e "process.exit(0)" builder-control/test/aegis-run.test.cjs',
    'node --check builder-control/aegis-run.cjs',
    ...Array.from({ length: 8 }, (_, i) => `node -e "process.exit(${i} === ${i} ? 0 : 1)"`),
  ];
  const recursiveGate = 'node builder-control/engineering-os.cjs --gate-done --packet ignored.json';
  const packet = writeCanonicalCheckPacket([...declared, recursiveGate]);
  const { r, runsDir, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(out.checks, { passed: 10, total: 10 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.deepStrictEqual(saved.checks.results.map((result) => result.cmd), declared);
    assert.ok(saved.checks.results.every((result) => result.exit === 0));
    assert.strictEqual(saved.checks.results.some((result) => result.cmd === recursiveGate), false);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

// ── fixed-policy dashboard check selector ──────────────────────────────────
function selectorPacket() {
  const parsed = JSON.parse(fs.readFileSync(path.join(ROOT, REVIEW_PACKET), 'utf8'));
  const runnable = parsed.testsRequired.filter((command) => {
    const tokens = String(command).trim().split(/\s+/);
    return !(tokens[0] === 'node' && (tokens[1] || '').replace(/^\.\//, '') ===
      'builder-control/engineering-os.cjs' && tokens.includes('--gate-done'));
  });
  return { parsed, runnable };
}

test('check selector: dashboard-only changed paths narrow to the two declared dashboard checks', () => {
  const { parsed } = selectorPacket();
  assert.deepStrictEqual(
    R.dashboardSliceCheckCommands(parsed, ['builder-control/dashboard/index.html']),
    ['node builder-control/test/dashboard-slice.test.cjs', 'git diff --check']);
  assert.deepStrictEqual(
    R.dashboardSliceCheckCommands(parsed,
      ['builder-control/test/dashboard-slice.test.cjs', 'builder-control/dashboard/index.html']),
    ['node builder-control/test/dashboard-slice.test.cjs', 'git diff --check']);
  for (const command of R.dashboardSliceCheckCommands(parsed, ['builder-control/dashboard/index.html'])) {
    assert.ok(parsed.testsRequired.includes(command),
      `selector returned ${command}, which the packet never declared`);
  }
});

test('check selector: any non-dashboard changed path falls back to the packet checks unchanged', () => {
  const { parsed, runnable } = selectorPacket();
  for (const changed of [
    ['builder-control/dashboard/index.html', 'builder-control/aegis-run.cjs'],
    ['builder-control/dashboard/index.html.bak'],
    ['./builder-control/dashboard/index.html'],
    ['builder-control/test/dashboard-slice.test.cjs', null],
    [],
    undefined,
  ]) {
    assert.deepStrictEqual(R.dashboardSliceCheckCommands(parsed, changed), runnable,
      `changed paths ${JSON.stringify(changed)} must not narrow the declared checks`);
  }
});

test('check selector: a packet missing either dashboard command falls back to its own checks', () => {
  const { parsed, runnable } = selectorPacket();
  for (const absent of ['node builder-control/test/dashboard-slice.test.cjs', 'git diff --check']) {
    const packet = { ...parsed, testsRequired: runnable.filter((c) => c !== absent) };
    assert.deepStrictEqual(
      R.dashboardSliceCheckCommands(packet, ['builder-control/dashboard/index.html']),
      packet.testsRequired,
      `a packet without ${absent} must not have that command invented for it`);
  }
  assert.deepStrictEqual(
    R.dashboardSliceCheckCommands({ testsRequired: [] }, ['builder-control/dashboard/index.html']), []);
});

test('check selector is consulted only after a validated canonical subject and before execution', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  const body = source.slice(source.indexOf('function runChecksClaimed(run) {'),
    source.indexOf('function runChecks(runId) {'));
  const selector = body.indexOf(
    'const cmds = dashboardSliceCheckCommands(pkt, subjectBefore.changedPaths);');
  const subjectRefusal = body.indexOf('!validSubjectCoordinate(subjectBefore)');
  const subjectThrow = body.indexOf("'CHECKS-SUBJECT-INVALID'");
  const noChecksRefusal = body.indexOf('if (!runnableCommands.length) {');
  const execution = body.indexOf('for (const cmd of cmds) {');
  assert.ok(selector > 0, 'runChecksClaimed must select its commands through the fixed-policy selector');
  assert.ok(subjectRefusal > 0 && subjectThrow > 0 && noChecksRefusal > 0 && execution > 0,
    'the subject refusal, no-checks refusal, and execution loop must all remain in runChecksClaimed');
  // A narrowed list is a subject-derived claim: it may not be computed from an
  // absent, malformed, or unvalidated subject, and it may not arrive too late
  // to govern what actually runs.
  assert.ok(selector > subjectThrow,
    'the selector must be consulted only after the canonical subject refusal');
  assert.ok(selector < execution,
    'the selector must be consulted before any check command is executed');
  // The refusal that decides whether evidence exists at all still weighs the
  // packet's full runnable list, never the narrowed one.
  assert.ok(noChecksRefusal < selector,
    'the no-checks refusal must precede and ignore any narrowing');
  assert.match(body, /const runnableCommands = runnableCheckCommands\(pkt\);/);
  assert.strictEqual(
    (body.match(/dashboardSliceCheckCommands\(/g) || []).length, 1,
    'the selector must have exactly one call site inside runChecksClaimed');
  assert.doesNotMatch(body.slice(0, selector), /\bcmds\b/,
    'no check list may exist before the validated subject narrows it');
});

// ── automatic focused dashboard checks ─────────────────────────────────────
const FOCUSED_DASHBOARD_PAIR = [
  'node builder-control/test/dashboard-slice.test.cjs',
  'git diff --check',
];

test('automatic checks delegate execution to runChecks and can never name a command', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  const body = source.slice(
    source.indexOf('function automaticDashboardChecksEligibility(runId) {'),
    source.indexOf('// ── step 7: exact-subject independent review binding'));
  assert.ok(body.length > 0, 'the automatic dashboard check authority is missing from aegis-run.cjs');
  assert.strictEqual((body.match(/runChecks\(runId\)/g) || []).length, 1,
    'automatic checks must have exactly one execution call site, and it must be the canonical runChecks');
  assert.doesNotMatch(body, /spawnSync\(|executeCheckInSnapshot\(|transition\(|saveRun\(/,
    'the automatic path must neither execute a check nor move or rewrite a run itself');
  // Eligibility is the whole of the automation's authority, and each of these
  // is a load-bearing refusal, not decoration.
  assert.match(body, /run\.automaticChecks !== true/);
  assert.match(body, /run\.state !== 'BUILT'/);
  assert.match(body, /DASHBOARD_SLICE_PATHS\.includes\(p\)/);
  assert.match(body, /DASHBOARD_SLICE_CHECKS\.every\(/);
});

hostContainmentTest('automatic checks accept a dashboard-created BUILT dashboard-slice run as exactly the focused pair', () => {
  const subject = reviewSubject({
    changedPaths: ['builder-control/dashboard/index.html'],
    subjectPaths: ['builder-control/dashboard/index.html'],
    diffBytes: 256,
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, automaticChecks: true }, `
      console.log(JSON.stringify(R.automaticDashboardChecksEligibility(runId)));
    `, engineeringSubjectSequenceMock([subject], REVIEW_PACKET));
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.eligible, true, `eligibility was refused: ${out.reason}`);
    assert.deepStrictEqual(out.commands, FOCUSED_DASHBOARD_PAIR,
      'an eligible run must resolve to the proven focused pair and nothing wider');
    // Deciding is not executing: eligibility alone moves and records nothing.
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILT');
    assert.strictEqual(saved.checks, null);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledger, 'utf8')), []);
  } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
});

hostContainmentTest('RED: a run that is not dashboard-created is never automatically checked, and no subject is computed', () => {
  for (const marker of [{ automaticChecks: false }, {}]) {
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
      { ...REVIEW_RUN, ...marker }, `
        console.log(JSON.stringify(R.runAutomaticDashboardChecks(runId)));
      `, engineeringSubjectSequenceMock([], REVIEW_PACKET));
    try {
      assert.strictEqual(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.strictEqual(out.ran, false, `${JSON.stringify(marker)} was automatically checked`);
      assert.match(out.reason, /not marked automatic-checks eligible/);
      const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
      assert.strictEqual(saved.state, 'BUILT');
      assert.strictEqual(saved.checks, null);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledger, 'utf8')), []);
    } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
  }
});

hostContainmentTest('RED: automatic checks refuse any run that is not currently BUILT', () => {
  for (const state of ['BUILDING', 'CHECKS_PASSED', 'BUILD_FAILED']) {
    const { r, ledger, TMP } = withSeededRun(state,
      { ...REVIEW_RUN, automaticChecks: true }, `
        console.log(JSON.stringify(R.runAutomaticDashboardChecks(runId)));
      `, engineeringSubjectSequenceMock([], REVIEW_PACKET));
    try {
      assert.strictEqual(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.strictEqual(out.ran, false, `${state} was automatically checked`);
      assert.match(out.reason, /automatic checks require BUILT/);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledger, 'utf8')), []);
    } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
  }
});

hostContainmentTest('RED: a canonical subject reaching past the dashboard slice keeps the manual check path', () => {
  for (const changedPaths of [
    ['builder-control/aegis-run.cjs', 'builder-control/dashboard/index.html'],
    ['builder-control/dashboard/state.js'],
    [],
  ]) {
    const subject = reviewSubject({
      changedPaths,
      subjectPaths: ['builder-control/dashboard/index.html'],
      diffBytes: 256,
    });
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
      { ...REVIEW_RUN, automaticChecks: true }, `
        console.log(JSON.stringify(R.runAutomaticDashboardChecks(runId)));
      `, engineeringSubjectSequenceMock([subject], REVIEW_PACKET));
    try {
      assert.strictEqual(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.strictEqual(out.ran, false,
        `changed paths ${JSON.stringify(changedPaths)} started an automatic check run`);
      assert.match(out.reason, /not confined to the dashboard slice/);
      const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
      assert.strictEqual(saved.state, 'BUILT');
      assert.strictEqual(saved.checks, null);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledger, 'utf8')), []);
    } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
  }
});

hostContainmentTest('reconciliation reports an already BUILT async run without claiming or moving it', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT', {
    ...REVIEW_RUN,
    automaticChecks: true,
    build: {
      mode: 'async', attempt: 1, attemptId: '66666666-6666-4666-8666-666666666666',
      workerPid: null, workerState: 'EXITED', revision: 2, exit: 0,
    },
  }, `
    console.log(JSON.stringify(R.reconcileBuildingRuns()));
  `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
      [{ runId, action: 'NOOP', state: 'BUILT' }],
      'a finished async run must be reported to the reconciler caller exactly once per scan');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILT');
    assert.strictEqual(saved.build.workerState, 'EXITED');
    assert.strictEqual(saved.build.revision, 2, 'observation must not patch the worker attempt');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledger, 'utf8')), []);
  } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
});

hostContainmentTest('runChecks: external packet is refused before checks with no run or ledger mutation', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-check-external-'));
  const packet = path.join(tmp, 'packet.json');
  const marker = path.join(tmp, 'spawned');
  fs.writeFileSync(packet, JSON.stringify({
    testsRequired: [`node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')"`],
  }));
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet }, `
      try { R.runChecks(runId); console.log(JSON.stringify({ threw: false })); }
      catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
      { threw: true, code: 'INVALID_PACKET', httpStatus: 400 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILT');
    assert.strictEqual(saved.checks, null);
    assert.strictEqual(saved.updatedAt, '2026-08-25T06:00:00Z');
    assert.deepStrictEqual(saved.transitions, []);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
    assert.strictEqual(fs.existsSync(marker), false, 'external packet command was spawned');
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

hostContainmentTest('runChecks: forged or moved worktree authority is refused before checks with no mutation', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-check-forged-'));
  const marker = path.join(tmp, 'spawned');
  const packet = writeCanonicalCheckPacket([
    `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')"`,
  ]);
  const primaryBranch = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const invalidRuns = [
    { ...REVIEW_RUN, packet: packet.relative, baseCommit: null },
    { ...REVIEW_RUN, packet: packet.relative,
      worktree: { ...REVIEW_RUN.worktree, baseCommit: '0'.repeat(40) } },
    { ...REVIEW_RUN, packet: packet.relative,
      worktree: { ...REVIEW_RUN.worktree, branch: 'aegis/forged-branch' } },
    { ...REVIEW_RUN, packet: packet.relative,
      worktree: { ...REVIEW_RUN.worktree, path: os.tmpdir() } },
    { ...REVIEW_RUN, packet: packet.relative,
      worktree: { path: ROOT, branch: primaryBranch, baseCommit: REVIEW_HEAD } },
  ];
  try {
    for (const invalid of invalidRuns) {
      const fixture = withSeededRun('BUILT', invalid, `
        try { R.runChecks(runId); console.log(JSON.stringify({ threw: false })); }
        catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
      `);
      try {
        assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
        assert.deepStrictEqual(JSON.parse(fixture.r.stdout.trim().split('\n').pop()),
          { threw: true, code: 'CHECKS_WORKTREE_INVALID', httpStatus: 409 });
        const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
        assert.strictEqual(saved.state, 'BUILT');
        assert.strictEqual(saved.checks, null);
        assert.strictEqual(saved.updatedAt, '2026-08-25T06:00:00Z');
        assert.deepStrictEqual(saved.transitions, []);
        assert.strictEqual(ledgerEntriesFor(fixture.ledger, fixture.runId).length, 0);
        assert.strictEqual(fs.existsSync(marker), false, 'forged worktree command was spawned');
      } finally {
        fs.rmSync(fixture.TMP, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(packet.absolute, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

hostOrchestrationTest('runChecks: canonical switchboard checks generate state.js in a clean isolated worktree and reach 4/4', () => {
  const packet = 'builder-control/packets/PKT-20260825-SWITCHBOARD-FOUNDATION.json';
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const fs = require('fs');
    const path = require('path');
    const { spawnSync } = require('child_process');
    run.packet = ${JSON.stringify(packet)};
    R.saveRun(run);
    R.prepareRun(run.runId);
    const built = R.loadRun(run.runId);
    // prepareRun correctly starts from the recorded base commit. This fixture
    // must then reproduce the exact current release subject in that governed
    // worktree before asking the packet to test newly added subject files.
    const exactPatch = spawnSync('git', ['diff', 'HEAD', '--binary', '--no-ext-diff', '--'], {
      cwd: ${JSON.stringify(ROOT)}, encoding: null, maxBuffer: 64 * 1024 * 1024,
    });
    if (exactPatch.error || exactPatch.status !== 0) {
      throw new Error('could not capture exact fixture subject: ' +
        (exactPatch.error ? exactPatch.error.message : String(exactPatch.stderr || exactPatch.stdout)));
    }
    if (exactPatch.stdout.length) {
      const applied = spawnSync('git', ['apply', '--index', '--binary', '--whitespace=nowarn', '-'], {
        cwd: built.worktree.path, input: exactPatch.stdout, encoding: null,
      });
      if (applied.status !== 0) throw new Error('could not apply exact fixture subject: ' + String(applied.stderr));
    }
    fs.appendFileSync(path.join(built.worktree.path, 'builder-control', 'dashboard', 'index.html'),
      '\\n<!-- canonical switchboard check subject -->\\n');
    R.transition(built, 'BUILDING', 'fixture builder started');
    R.transition(built, 'BUILT', 'fixture builder exited 0');
    const out = R.runChecks(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `canonical checks failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(out.state, 'CHECKS_PASSED', JSON.stringify(saved.checks));
    assert.deepStrictEqual(out.checks, { passed: 4, total: 4 });
    assert.deepStrictEqual(saved.checks.precondition, {
      state: 'PASSED',
      generator: 'builder-control/aegis-state.cjs',
      output: 'builder-control/dashboard/state.js',
    });
    const stateStatus = spawnSync('git', ['status', '--porcelain=v1', '--',
      'builder-control/dashboard/state.js'], { cwd: saved.worktree.path, encoding: 'utf8' });
    assert.strictEqual(stateStatus.status, 0, stateStatus.stderr);
    assert.strictEqual(stateStatus.stdout.trim(), '',
      'canonical checks changed dashboard state in the governed worktree instead of the disposable snapshot');
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_PASSED`).length, 1);
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

hostContainmentTest('runChecks: canonical state generator cannot mutate the exact subject before a declared check', () => {
  const packet = 'builder-control/packets/PKT-20260825-SWITCHBOARD-FOUNDATION.json';
  const maliciousGenerator = [
    `'use strict';`,
    `const fs = require('fs'); const path = require('path');`,
    `const at = process.argv.indexOf('--out'); const out = process.argv[at + 1];`,
    `fs.writeFileSync(out, '/* Generated by builder-control/aegis-state.cjs */\\nwindow.AEGIS_STATE = {};\\n');`,
    `fs.appendFileSync(path.join(__dirname, 'dashboard', 'index.html'), '\\n<!-- generator-mutated-subject -->\\n');`,
  ].join(' ');
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const fs = require('fs');
    const path = require('path');
    run.packet = ${JSON.stringify(packet)};
    R.saveRun(run);
    R.prepareRun(run.runId);
    const built = R.loadRun(run.runId);
    fs.writeFileSync(path.join(built.worktree.path, 'builder-control', 'aegis-state.cjs'),
      ${JSON.stringify(maliciousGenerator)});
    R.transition(built, 'BUILDING', 'fixture builder started');
    R.transition(built, 'BUILT', 'fixture builder exited 0');
    const out = R.runChecks(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `generator containment driver failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED');
    assert.deepStrictEqual(out.checks, { passed: 0, total: 4 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.executionBoundary.state, 'FAILED');
    assert.match(saved.checks.executionBoundary.reason, /dashboard state preflight.*changed the captured exact subject/);
    assert.strictEqual(saved.checks.results[0].status, 'REFUSED');
    assert.strictEqual(saved.checks.results[0].exit, 125);
    assert.ok(saved.checks.results.slice(1).every((result) => result.status === 'SKIPPED' &&
      result.exit === null && result.executionEvidence && result.failureEvidence),
    'checks after the first boundary loss were not blocked with evidence');
    assert.ok(saved.checks.results.every((result) =>
      result.failureEvidence.stderrTail.includes('changed the captured exact subject')),
    'state-generator subject mismatch was not preserved in bounded evidence');
    assert.ok(!fs.readFileSync(path.join(saved.worktree.path, 'builder-control', 'dashboard', 'index.html'), 'utf8')
      .includes('generator-mutated-subject'),
    'the malicious disposable generator changed the governed worktree');
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_FAILED`).length, 1);
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

hostOrchestrationTest('runChecks: operator-beta stops at exact pre-host PASS without executing the host suite', () => {
  const restoreSubject = overlayCurrentSubject(REVIEW_WORKTREE.path);
  const packet = JSON.parse(fs.readFileSync(path.join(ROOT, REVIEW_PACKET), 'utf8'));
  const snapshotCommands = packet.testsRequired.filter((command) => {
    const tokens = String(command).trim().split(/\s+/);
    return !(tokens[0] === 'node' && (tokens[1] || '').replace(/^\.\//, '') ===
      'builder-control/engineering-os.cjs' && tokens.includes('--gate-done'));
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CREATED', {
    ...REVIEW_RUN,
    packet: REVIEW_PACKET,
  }, `
    const fs = require('fs');
    const path = require('path');
    for (const stage of ['INTAKE_RECORDED', 'ROUTED', 'WORKTREE_READY', 'BUILDING', 'BUILT']) {
      R.transition(seededRun, stage, 'operator-beta watchdog fixture');
    }
    const subjectFile = path.join(${JSON.stringify(REVIEW_WORKTREE.path)}, 'builder-control', 'review-adapters.cjs');
    const original = fs.readFileSync(subjectFile);
    try {
      fs.appendFileSync(subjectFile, '\\n// operator-beta exact-subject host-receipt fixture\\n');
      const out = R.runChecks(runId);
      const saved = R.loadRun(runId);
      const receipt = R.loadCanonicalPreHostCheckReceipt(saved.checks, {
        runId,
        packetPath: saved.packet,
        packetSha256: require('crypto').createHash('sha256')
          .update(fs.readFileSync(path.resolve(${JSON.stringify(ROOT)}, saved.packet))).digest('hex'),
        hostCommands: ['node builder-control/test/host-containment.test.cjs'],
      });
      const watchdog = R.watchdog(saved);
      console.log(JSON.stringify({ out, receipt, watchdog }));
    } finally {
      fs.writeFileSync(subjectFile, original);
    }
  `);
  try {
    assert.strictEqual(r.status, 0, `operator-beta packet failed: ${r.stderr || r.stdout}`);
    const result = JSON.parse(r.stdout.trim().split('\n').pop());
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(result.out.state, 'CHECKS_PASSED', JSON.stringify(saved.checks));
    assert.deepStrictEqual(result.out.checks, {
      passed: snapshotCommands.length,
      total: snapshotCommands.length,
    });
    assert.ok(result.receipt, 'canonical check receipt could not be reloaded');
    assert.strictEqual(result.receipt.receiptType, 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1');
    assert.strictEqual(result.receipt.hostContainment.state, 'PENDING');
    assert.deepStrictEqual(result.receipt.hostContainment.commands,
      ['node builder-control/test/host-containment.test.cjs']);
    assert.strictEqual(saved.checks.hostContainment.state, 'PENDING');
    assert.strictEqual(saved.checks.receiptRef, undefined,
      'a final check receipt was published before independent review');
    assert.strictEqual(result.watchdog.checkReceiptValid, true,
      'watchdog did not recognize the digest-bound pre-host snapshot PASS');
    assert.strictEqual(result.watchdog.checkReceiptStage, 'PRE_HOST');
    assert.strictEqual(result.watchdog.hostContainmentState, 'PENDING');
    const evidence = ledgerEntriesFor(ledger, runId)
      .find((entry) => entry.gate === 'aegis-pre-host-check-receipt');
    assert.ok(evidence);
    assert.ok(!evidence.testsRun.includes('node builder-control/test/host-containment.test.cjs'));
    assert.ok(evidence.evidencePaths.some((entry) => entry.startsWith('host-containment:pending:')));
  } finally {
    restoreSubject();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

governedHostProofTest('host containment executes captured bytes despite a mutate-and-restore interleaving', () => {
  const restoreSubject = overlayCurrentSubject(REVIEW_WORKTREE.path);
  const packetAbsolute = path.join(ROOT, REVIEW_PACKET);
  const packetBytes = fs.readFileSync(packetAbsolute);
  const packetBefore = {
    real: fs.realpathSync(packetAbsolute),
    path: REVIEW_PACKET,
    bytes: packetBytes,
    parsed: JSON.parse(packetBytes),
    sha256: crypto.createHash('sha256').update(packetBytes).digest('hex'),
  };
  const env = R.canonicalGitEnvironment(REVIEW_RUN);
  const subjectResult = spawnSync(process.execPath,
    [path.join(ROOT, 'builder-control', 'engineering-os.cjs'), '--subject', '--json'],
    { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(subjectResult.status, 0, subjectResult.stderr);
  const subject = JSON.parse(subjectResult.stdout);
  const capture = R.captureCheckExecutionSource(
    REVIEW_WORKTREE.path, packetBefore, subject, { required: false });
  const targetRelative = 'builder-control/test/host-containment.test.cjs';
  const governedTarget = path.join(REVIEW_WORKTREE.path, targetRelative);
  const governedBytes = fs.readFileSync(governedTarget);
  const preHostReceipt = preHostChecksFor(
    'RUN-20260829-abcdef12', subject, REVIEW_PACKET).preHostReceipt;
  const preHostReceiptRef = {
    entryId: `LED-CHECK-${preHostReceipt.receiptSha256.slice(0, 32)}`,
    receiptSha256: preHostReceipt.receiptSha256,
  };
  let seamCalled = false;
  try {
    const receipt = R.runTopLevelHostContainmentCheck(
      { runId: 'RUN-20260829-abcdef12' }, REVIEW_WORKTREE.path, packetBefore, subject,
      'node builder-control/test/host-containment.test.cjs', capture, {
        preHostReceipt,
        preHostReceiptRef,
        afterSnapshotEstablished(snapshot) {
          seamCalled = true;
          fs.appendFileSync(governedTarget, '\n// transient mutate-and-restore attack\n');
          const capturedBytes = fs.readFileSync(path.join(snapshot.snapshotRoot, targetRelative));
          assert.deepStrictEqual(capturedBytes, governedBytes,
            'host snapshot observed bytes written after the canonical capture');
          fs.writeFileSync(governedTarget, governedBytes);
        },
      });
    assert.strictEqual(seamCalled, true, 'the deterministic interleaving seam did not run');
    assert.strictEqual(receipt.outcome, 'PASS', receipt.reason);
    assert.strictEqual(receipt.snapshot.captureSha256, capture.captureSha256);
    assert.strictEqual(R.validateHostContainmentReceipt(receipt, {
      runId: 'RUN-20260829-abcdef12', packetPath: REVIEW_PACKET,
      packetSha256: packetBefore.sha256, subject,
      command: 'node builder-control/test/host-containment.test.cjs', platform: 'darwin',
      preHostReceiptRef,
    }), true);
  } finally {
    fs.writeFileSync(governedTarget, governedBytes);
    restoreSubject();
  }
});

hostContainmentTest('runChecks: canonical state generation failure records CHECKS_FAILED and runs no packet check', () => {
  const packet = 'builder-control/packets/PKT-20260825-SWITCHBOARD-FOUNDATION.json';
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const fs = require('fs');
    const path = require('path');
    run.packet = ${JSON.stringify(packet)};
    R.saveRun(run);
    R.prepareRun(run.runId);
    const built = R.loadRun(run.runId);
    fs.unlinkSync(path.join(built.worktree.path, 'builder-control', 'aegis-state.cjs'));
    R.transition(built, 'BUILDING', 'fixture builder started');
    R.transition(built, 'BUILT', 'fixture builder exited 0');
    const out = R.runChecks(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `generator refusal driver failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED');
    assert.deepStrictEqual(out.checks, { passed: 0, total: 4 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.precondition.state, 'FAILED');
    assert.strictEqual(saved.checks.precondition.code, 'STATE_GENERATOR_UNAVAILABLE');
    assert.strictEqual(saved.checks.results.length, 4);
    assert.ok(saved.checks.results.every((result) => result.exit === null && result.skipped),
      'packet checks must remain unexecuted when their state precondition fails');
    assert.ok(saved.checks.results.every((result) => result.status === 'SKIPPED' &&
      result.executionEvidence && result.failureEvidence),
    'every skipped check must retain bounded execution and failure evidence');
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_FAILED`).length, 1);
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_PASSED`).length, 0,
      'a failed generator must never produce a passing check transition');
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

hostContainmentTest('runChecks: invalid state fails closed under the canonical claim with no mutation', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', null, `
    try {
      R.runChecks(runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out, { threw: true, code: 'INVALID_CHECKS', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.strictEqual(saved.checks, null);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('runChecks: owns the per-run claim and reuses one claimed executor', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const claimed = src.slice(src.indexOf('function runChecksClaimed'), src.indexOf('function runChecks(runId)'));
  const control = src.slice(src.indexOf('function runChecks(runId)'), src.indexOf('function cmdChecks'));
  assert.match(control, /acquireRunLaunchClaim\(runId,/);
  assert.match(control, /runChecksClaimed\(run\)/);
  assert.doesNotMatch(claimed, /acquireRunLaunchClaim/,
    'the claimed executor must not acquire a second, deadlocking claim');
});

test('reconcileWorkerRun: present worker with transient identity inspection failure preserves BUILDING', () => {
  const attemptId = '66666666-6666-4666-8666-666666666666';
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 9999,
    processIdentity: { pid: 9999, processGroupId: 9999, startMarker: 'recorded',
      executable: '/fixture/worker', source: 'ps' }, workerState: 'RUNNING', revision: 0,
    startedAt: '2026-08-27T12:00:00.000Z' };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    const seeded = R.loadRun(runId);
    seeded.build.workerPid = _sleeper.pid;
    seeded.build.processIdentity = { ...seeded.build.processIdentity, pid: _sleeper.pid };
    R.saveRun(seeded);
    let out;
    try { out = R.reconcileWorkerRun(runId, { observedAt: '2026-08-27T12:01:00.000Z' }); }
    finally { try { _sleeper.kill('SIGKILL'); } catch {} }
    console.log(JSON.stringify(out));
  `, `
    const _fs = require('fs');
    const _childProcess = require('child_process');
    const _sleeper = _childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' });
    const _read = _fs.readFileSync;
    _fs.readFileSync = function(file, ...args) {
      if (String(file) === '/proc/' + _sleeper.pid + '/stat') {
        const error = new Error('transient identity failure'); error.code = 'EACCES'; throw error;
      }
      return _read.call(this, file, ...args);
    };
    const _spawnSync = _childProcess.spawnSync;
    _childProcess.spawnSync = function(command, args, options) {
      if (command === 'ps' && Array.isArray(args) && args[1] === String(_sleeper.pid) &&
          args[3] !== 'pid=') return { status: 1, stdout: '', stderr: '' };
      return _spawnSync.call(this, command, args, options);
    };
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out, { runId, action: 'IDENTITY_UNVERIFIED', state: 'BUILDING',
    reason: 'IDENTITY_INSPECTION_UNAVAILABLE' });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILDING');
  assert.strictEqual(saved.build.revision, 0);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('reconcileWorkerRun: unknown process existence preserves BUILDING without ledger transition', () => {
  const targetPid = 2147483646;
  const attemptId = '77777777-7777-4777-8777-777777777777';
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: targetPid,
    processIdentity: { pid: targetPid, processGroupId: targetPid, startMarker: 'recorded',
      executable: '/fixture/worker', source: 'ps' }, workerState: 'RUNNING', revision: 0,
    startedAt: '2026-08-27T12:00:00.000Z' };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    console.log(JSON.stringify(R.reconcileWorkerRun(runId, { observedAt: '2026-08-27T12:01:00.000Z' })));
  `, `
    const _targetPid = ${targetPid};
    const _fs = require('fs');
    const _childProcess = require('child_process');
    const _read = _fs.readFileSync;
    const _lstat = _fs.lstatSync;
    _fs.readFileSync = function(file, ...args) {
      if (String(file) === '/proc/' + _targetPid + '/stat') {
        const error = new Error('transient identity failure'); error.code = 'EACCES'; throw error;
      }
      return _read.call(this, file, ...args);
    };
    _fs.lstatSync = function(file, ...args) {
      if (String(file) === '/proc/' + _targetPid) {
        const error = new Error('transient existence failure'); error.code = 'EACCES'; throw error;
      }
      return _lstat.call(this, file, ...args);
    };
    const _spawnSync = _childProcess.spawnSync;
    _childProcess.spawnSync = function(command, args, options) {
      if (command === 'ps' && Array.isArray(args) && args[1] === String(_targetPid))
        return { status: null, stdout: '', stderr: '', error: new Error('ps unavailable') };
      return _spawnSync.call(this, command, args, options);
    };
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out, { runId, action: 'IDENTITY_UNVERIFIED', state: 'BUILDING',
    reason: 'PROCESS_EXISTENCE_UNKNOWN' });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILDING');
  assert.strictEqual(saved.build.revision, 0);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('reconcileWorkerRun: positively absent worker transitions exactly once to unsafe BUILD_FAILED', () => {
  const deadPid = 2147483647;
  const attemptId = '88888888-8888-4888-8888-888888888888';
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: deadPid,
    processIdentity: { pid: deadPid, processGroupId: deadPid, startMarker: 'recorded',
      executable: '/fixture/worker', source: 'ps' }, workerState: 'RUNNING', revision: 0,
    startedAt: '2026-08-27T12:00:00.000Z' };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    const first = R.reconcileWorkerRun(runId, { observedAt: '2026-08-27T12:01:00.000Z' });
    const second = R.reconcileWorkerRun(runId, { observedAt: '2026-08-27T12:02:00.000Z' });
    console.log(JSON.stringify({ first, second }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out.first, { runId, action: 'RECOVERED_UNSAFE', state: 'BUILD_FAILED', reason: 'ORPHANED' });
  assert.deepStrictEqual(out.second, { runId, action: 'NOOP', state: 'BUILD_FAILED' });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILD_FAILED');
  assert.strictEqual(saved.build.workerState, 'ORPHANED');
  assert.strictEqual(saved.build.recovery.retrySafe, false);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING' && t.to === 'BUILD_FAILED').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((e) => e.operationId === `${runId}:BUILDING->BUILD_FAILED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('async builder: credential-shaped and oversized output persists only bounded redacted evidence on every durable surface after completion, reconciliation and reload', () => {
  const bearer = 'AEGIS-FAKE-BEARER-2c9d1e8f7a6b5c4d';
  const password = 'AEGIS-FAKE-PASSWORD-9e8d7c6b5a';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZWdpcy1ydW4tZml4dHVyZSJ9.fakeAsyncSignature123456';
  const apiKey = 'AEGIS-FAKE-API-KEY-3f2e1d0c9b8a';
  const secrets = [bearer, password, jwt, apiKey];
  const diagnostic = 'AEGIS_ASYNC_BUILDER_FAILURE_DIAGNOSTIC';
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-async-redaction-'));
  const runsDir = path.join(tmp, 'runs');
  const checkpointsDir = path.join(tmp, 'checkpoints');
  const worktree = path.join(tmp, 'worktree');
  const ledger = path.join(tmp, 'ledger.json');
  const bin = path.join(tmp, 'bin');
  for (const dir of [runsDir, checkpointsDir, worktree, bin]) fs.mkdirSync(dir);
  fs.writeFileSync(ledger, '[]\n');
  fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'fixture\n');
  fs.writeFileSync(path.join(worktree, 'authority-source.txt'), 'canonical\n');
  fs.writeFileSync(path.join(worktree, 'authority-check.cjs'), 'process.exit(0);\n');
  const packetPath = path.join(worktree, 'packet.json');
  fs.writeFileSync(packetPath, JSON.stringify({
    packetId: 'PKT-TEST-ASYNC-REDACTION', agentId: 'claude-code',
    sourceOfTruth: ['authority-source.txt'], testsRequired: ['node authority-check.cjs'],
    filesAllowed: ['allowed.txt'],
  }));
  // The governed builder fixture floods both streams and then finishes with
  // every representative credential shape inside the retained tail window, so
  // an unbounded or unredacted persistence surface cannot escape below.
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
'use strict';
for (let i = 0; i < 4000; i++) console.log('oversized-stdout-padding-line-' + i);
console.log(${JSON.stringify(diagnostic)});
console.log('Authorization: Bearer ' + ${JSON.stringify(bearer)});
console.log('password=' + ${JSON.stringify(password)});
console.log(${JSON.stringify(jwt)});
console.log('api_key: ' + ${JSON.stringify(apiKey)});
for (let i = 0; i < 4000; i++) console.error('oversized-stderr-padding-line-' + i);
console.error(${JSON.stringify(diagnostic)});
console.error('Authorization: Bearer ' + ${JSON.stringify(bearer)});
console.error('password=' + ${JSON.stringify(password)});
console.error(${JSON.stringify(jwt)});
console.error('api_key: ' + ${JSON.stringify(apiKey)});
process.exit(7);
`, { mode: 0o755 });
  const runId = 'RUN-20260901-ac1dbeef';
  const runFile = path.join(runsDir, `${runId}.json`);
  fs.writeFileSync(runFile, JSON.stringify({
    runId, objective: 'prove bounded redacted async builder evidence', state: 'WORKTREE_READY',
    worktree: { path: worktree }, packet: packetPath, build: null,
    corrections: 0, transitions: [], updatedAt: new Date().toISOString(),
  }, null, 2));
  const env = {
    ...process.env, NODE_ENV: 'test',
    AEGIS_TEST_CLAUDE_EXECUTABLE: path.join(bin, 'claude'),
    AEGIS_TEST_CONTAINMENT_MODE: 'DETERMINISTIC_PROFILE_ONLY',
    AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: checkpointsDir, AEGIS_LEDGER_FILE: ledger,
  };
  const controlled = (source) => {
    const result = spawnSync(process.execPath, ['-e',
      `const R=require(${JSON.stringify(CLI)});const runId=${JSON.stringify(runId)};${source}`],
    { cwd: ROOT, env, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').pop());
  };
  const durableSurfaces = () => {
    const surfaces = [ledger];
    for (const root of [runsDir, checkpointsDir]) {
      (function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
          const target = path.join(dir, name);
          if (fs.lstatSync(target).isDirectory()) walk(target);
          else surfaces.push(target);
        }
      })(root);
    }
    return surfaces;
  };
  const assertBoundedRedactedSurfaces = (phase) => {
    for (const target of durableSurfaces()) {
      const bytes = fs.readFileSync(target, 'utf8');
      for (const secret of secrets) {
        assert.ok(!bytes.includes(secret),
          `${phase}: durable surface ${path.relative(tmp, target)} retained a raw credential`);
      }
    }
    const persisted = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    for (const tail of [persisted.build.stdoutTail, persisted.build.stderrTail]) {
      assert.ok(typeof tail === 'string' && tail.includes('[REDACTED]'),
        `${phase}: builder evidence lost its redaction markers`);
      assert.ok(tail.includes(diagnostic), `${phase}: builder evidence lost the useful diagnostic`);
      assert.ok(Buffer.byteLength(tail, 'utf8') <= 12000, `${phase}: builder evidence exceeded its byte bound`);
      assert.ok(tail.split('\n').length <= 24, `${phase}: builder evidence exceeded its line bound`);
    }
    assert.ok(ledgerEntriesFor(ledger, runId).some((entry) =>
      entry.operationId === `${runId}:BUILDING->BUILD_FAILED`),
    `${phase}: the canonical ledger did not record the completed asynchronous build`);
  };
  try {
    const started = controlled(`console.log(JSON.stringify(R.startWorker(runId,
      { provider: 'claude-subscription', prompt: 'emit credential-shaped oversized output', model: 'opus' },
      { timeoutSec: 60 })));`);
    assert.strictEqual(started.state, 'BUILDING');
    const deadline = Date.now() + 30000;
    let run = null;
    while (Date.now() < deadline) {
      run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      if (run.state === 'BUILT' || run.state === 'BUILD_FAILED') break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    assert.strictEqual(run.state, 'BUILD_FAILED', 'the asynchronous builder did not complete');
    assert.strictEqual(run.build.exit, 7);
    assertBoundedRedactedSurfaces('after completion');

    const reconciled = controlled('console.log(JSON.stringify(R.reconcileWorkerRun(runId)));');
    assert.strictEqual(reconciled.state, 'BUILD_FAILED');
    const reloaded = controlled('console.log(JSON.stringify(R.loadRun(runId)));');
    assert.strictEqual(reloaded.state, 'BUILD_FAILED');
    for (const secret of secrets) {
      assert.ok(!JSON.stringify(reloaded).includes(secret), 'reloaded run state retained a raw credential');
    }
    assertBoundedRedactedSurfaces('after reconciliation and reload');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pauseRun: exported and refuses every state, including BUILDING, with no mutation', () => {
  assert.strictEqual(typeof R.pauseRun, 'function');
  for (const state of Object.keys(R.STATES)) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, null, `
      try {
        R.pauseRun(runId);
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus, isAegisControlError: e instanceof R.AegisControlError }));
      }
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, `pauseRun must refuse state ${state}, not silently proceed or invent PAUSED`);
    assert.strictEqual(out.code, 'CONTROL_UNAVAILABLE', `state ${state} did not refuse with CONTROL_UNAVAILABLE`);
    assert.strictEqual(out.httpStatus, 409, `state ${state} did not refuse with 409`);
    assert.strictEqual(out.isAegisControlError, true);

    const files = fs.readdirSync(runsDir);
    assert.strictEqual(files.length, 1, `pauseRun must not create or delete run files for state ${state}`);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
    assert.strictEqual(saved.state, state, `pauseRun must not mutate state ${state}`);
    assert.deepStrictEqual(saved.transitions, [], `pauseRun must record no transition for state ${state}`);
    assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0, `pauseRun must write nothing to the canonical ledger for state ${state}`);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('pauseRun: BUILDING explains active pause requires async worker control', () => {
  const { r } = withSeededRun('BUILDING', null, `
    try { R.pauseRun(runId); } catch (e) { console.log(e.message); }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  assert.ok(/asynchronous worker control/.test(r.stdout), 'BUILDING refusal must explain why, not just fail');
});

test('pauseRun: never touches signals or process control', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const pauseSrc = src.slice(src.indexOf('function pauseRun'), src.indexOf('function cancelRun'));
  assert.ok(!/process\.kill/.test(pauseSrc) && !/spawnSync/.test(pauseSrc) && !/SIGTERM|SIGKILL/.test(pauseSrc),
    'pauseRun must never touch signals or spawn a process — no PAUSED state exists to control');
});

test('cancelRun: exported; every state whose next() permits ABANDONED transitions through transition()', () => {
  assert.strictEqual(typeof R.cancelRun, 'function');
  const permitted = Object.entries(R.STATES).filter(([s, def]) => s !== 'BUILDING' && def.next.includes('ABANDONED')).map(([s]) => s);
  assert.ok(permitted.length > 0, 'sanity: at least one state must legally reach ABANDONED');
  for (const state of permitted) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, null, `
      const out = R.cancelRun(runId);
      console.log(JSON.stringify(out));
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['action', 'nextAction', 'runId', 'state'],
      `cancelRun response for ${state} has the wrong keys`);
    assert.strictEqual(out.state, 'ABANDONED');
    assert.strictEqual(out.action, 'cancel');

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${out.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'ABANDONED', `cancelRun must actually persist ABANDONED for ${state}`);

    const entries = ledgerEntriesFor(ledger, out.runId);
    const match = entries.find((e) => e.operationId === `${out.runId}:${state}->ABANDONED`);
    assert.ok(match, `the canonical ledger must record ${state} -> ABANDONED`);
    assert.strictEqual(match.status, 'PASS');
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('cancelRun source has no raw PID or process-group signal path', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const cancelSrc = src.slice(src.indexOf('function cancelRun'), src.indexOf('\n/**\n * Retry', src.indexOf('function cancelRun')));
  assert.doesNotMatch(cancelSrc, /process\.kill|terminateWorker|terminateProcessGroup|childProcessGroupId/);
  assert.match(cancelSrc, /requestCancellation/);
});

test('workerCancellationCapability preserves authenticated retry authority without trusting a PID alone', () => {
  assert.strictEqual(typeof R.workerCancellationCapability, 'function');
  const complete = {
    state: 'BUILDING',
    build: {
      mode: 'async', workerState: 'RUNNING', workerPid: 4141,
      control: { dir: '/fixture/control', secret: 'private', secretSha256: 'digest' },
      childProcessIdentity: { pid: 4242, processGroupId: 4242,
        startMarker: 'fixture', executable: '/fixture/claude', source: 'fixture' },
    },
  };
  assert.strictEqual(R.workerCancellationCapability(complete), true);
  assert.strictEqual(R.workerCancellationCapability({
    ...complete, build: { ...complete.build, workerState: 'TERMINATION_UNVERIFIED' },
  }), true, 'an authenticated timeout must retain capability for the bounded second cancellation');
  for (const candidate of [
    { ...complete, state: 'BUILT' },
    { ...complete, build: { ...complete.build, mode: 'sync' } },
    { ...complete, build: { ...complete.build, workerPid: null } },
    { ...complete, build: { ...complete.build, control: null } },
    { ...complete, build: { ...complete.build, childProcessIdentity: null } },
  ]) assert.strictEqual(R.workerCancellationCapability(candidate), false);
});

test('transition: exported authority refuses BUILDING -> ABANDONED even with caller-fabricated evidence', () => {
  const attemptId = '90909090-9090-4090-8090-909090909090';
  const cancellationId = '91919191-9191-4191-8191-919191919191';
  const childIdentity = { pid: 4141, processGroupId: 4040, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4040,
    childProcessIdentity: childIdentity, workerState: 'TERMINATED', revision: 2,
    cancellation: { cancellationId, attemptId, status: 'TERMINATED' },
    terminationEvidence: { controlAuthenticated: true, terminated: true,
      childCloseObserved: true, processGroupDrained: true, attemptId, cancellationId,
      childIdentity } };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    let out;
    try { R.transition(R.loadRun(runId), 'ABANDONED', 'caller-supplied evidence'); out = { threw: false }; }
    catch (e) { out = { threw: true, code: e.code }; }
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'TERMINATION-EVIDENCE-REQUIRED' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8')).state, 'BUILDING');
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: state changed to BUILDING before claim uses authenticated mailbox path', () => {
  const attemptId = '92929292-9292-4292-8292-929292929292';
  const childIdentity = { pid: 4242, processGroupId: 4141, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4141,
    processGroupId: 4141, childProcessGroupId: 4141, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' },
    workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('WORKTREE_READY', null, `
    process.env.NODE_ENV = 'test';
    let mailboxRequests = 0;
    const out = R.cancelRun(runId, {
      beforeClaim: () => {
        const starting = R.loadRun(runId);
        starting.build = ${JSON.stringify(build)};
        R.transition(starting, 'BUILDING', 'deterministic Start won before cancellation claim');
      },
      requestCancellation: (observedBuild, cancellationId) => {
        mailboxRequests += 1;
        if (observedBuild.attemptId !== ${JSON.stringify(attemptId)}) throw new Error('wrong attempt signalled');
        return { terminated: true, childCloseObserved: true, processGroupDrained: true,
          cancellationId, childIdentity: ${JSON.stringify(childIdentity)}, signal: 'SIGTERM',
          observedAt: '2026-08-27T12:00:02.000Z' };
      },
    });
    console.log(JSON.stringify({ out, mailboxRequests }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(observed.mailboxRequests, 1, 'fresh BUILDING state must use the authenticated mailbox');
  assert.strictEqual(observed.out.state, 'ABANDONED');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.build.terminationEvidence.controlAuthenticated, true);
  assert.strictEqual(saved.build.terminationEvidence.attemptId, attemptId);
  assert.strictEqual(saved.build.terminationEvidence.cancellationId, saved.build.cancellation.cancellationId);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((entry) => entry.operationId === `${runId}:BUILDING->ABANDONED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: timeout then late authenticated response cannot wedge the next cancellation', () => {
  const controlDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cancel-mailbox-'));
  fs.chmodSync(controlDir, 0o700);
  const controlStat = fs.statSync(controlDir);
  const secret = crypto.randomBytes(32).toString('hex');
  const attemptId = '93939393-9393-4393-8393-939393939393';
  const childIdentity = { pid: 4343, processGroupId: 4242, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4242,
    processGroupId: 4242, childProcessGroupId: 4242, childProcessIdentity: childIdentity,
    control: { dir: controlDir, secret,
      secretSha256: crypto.createHash('sha256').update(secret).digest('hex'),
      directoryIdentity: { dev: Number(controlStat.dev), ino: Number(controlStat.ino) } },
    workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    const crypto = require('crypto');
    const fs = require('fs');
    const path = require('path');
    const childProcess = require('child_process');
    let firstCode = null;
    try { R.cancelRun(runId); } catch (e) { firstCode = e.code; }
    const timedOut = R.loadRun(runId);
    const oldCancellationId = timedOut.build.cancellation.cancellationId;
    const responsePath = path.join(${JSON.stringify(controlDir)}, 'cancel-response.json');
    const requestPath = path.join(${JSON.stringify(controlDir)}, 'cancel-request.json');
    const lateBody = { attemptId: ${JSON.stringify(attemptId)}, cancellationId: oldCancellationId,
      terminated: true, childCloseObserved: true, processGroupDrained: true,
      childIdentity: ${JSON.stringify(childIdentity)}, reason: 'LATE_OLD_RESPONSE',
      observedAt: '2026-08-27T12:00:03.000Z' };
    const lateMac = crypto.createHmac('sha256', ${JSON.stringify(secret)})
      .update(JSON.stringify(lateBody)).digest('hex');
    fs.writeFileSync(responsePath, JSON.stringify({ body: lateBody, mac: lateMac }), { mode: 0o600 });

    const responderScript = ${JSON.stringify(`
      const crypto = require('crypto');
      const fs = require('fs');
      const requestPath = ${JSON.stringify(path.join(controlDir, 'cancel-request.json'))};
      const responsePath = ${JSON.stringify(path.join(controlDir, 'cancel-response.json'))};
      const secret = ${JSON.stringify(secret)};
      const oldCancellationId = process.argv[1];
      const attemptId = ${JSON.stringify(attemptId)};
      const childIdentity = ${JSON.stringify(childIdentity)};
      const deadline = Date.now() + 5000;
      const poll = setInterval(() => {
        if (Date.now() > deadline) { clearInterval(poll); process.exit(2); }
        if (!fs.existsSync(requestPath)) return;
        let request;
        try { request = JSON.parse(fs.readFileSync(requestPath, 'utf8')); } catch { return; }
        if (!request.body || request.body.cancellationId === oldCancellationId) return;
        const body = { attemptId, cancellationId: request.body.cancellationId,
          terminated: true, childCloseObserved: true, processGroupDrained: true,
          childIdentity, reason: 'CURRENT_RESPONSE', observedAt: '2026-08-27T12:00:04.000Z' };
        const mac = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
        const temporary = responsePath + '.' + process.pid + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify({ body, mac }), { mode: 0o600 });
        fs.renameSync(temporary, responsePath);
        clearInterval(poll);
      }, 10);
    `)};
    childProcess.spawn(process.execPath, ['-e', responderScript, oldCancellationId], { stdio: 'ignore' });
    const second = R.cancelRun(runId);
    const saved = R.loadRun(runId);
    console.log(JSON.stringify({ firstCode, oldCancellationId, second,
      acceptedCancellationId: saved.build.terminationEvidence.cancellationId,
      currentCancellationId: saved.build.cancellation.cancellationId,
      responseRemains: fs.existsSync(responsePath), requestRemains: fs.existsSync(requestPath) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(observed.firstCode, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(observed.second.state, 'ABANDONED');
  assert.notStrictEqual(observed.acceptedCancellationId, observed.oldCancellationId);
  assert.strictEqual(observed.acceptedCancellationId, observed.currentCancellationId);
  assert.strictEqual(observed.responseRemains, false);
  assert.strictEqual(observed.requestRemains, false);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((entry) => entry.operationId === `${runId}:BUILDING->ABANDONED`).length, 1);
  fs.rmSync(controlDir, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: malformed response fails closed and is never accepted as termination evidence', () => {
  const controlDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cancel-malformed-'));
  fs.chmodSync(controlDir, 0o700);
  const controlStat = fs.statSync(controlDir);
  const secret = crypto.randomBytes(32).toString('hex');
  const attemptId = '94949494-9494-4494-8494-949494949494';
  const childIdentity = { pid: 4444, processGroupId: 4343, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4343,
    processGroupId: 4343, childProcessGroupId: 4343, childProcessIdentity: childIdentity,
    control: { dir: controlDir, secret,
      secretSha256: crypto.createHash('sha256').update(secret).digest('hex'),
      directoryIdentity: { dev: Number(controlStat.dev), ino: Number(controlStat.ino) } },
    workerState: 'RUNNING', revision: 0 };
  fs.writeFileSync(path.join(controlDir, 'cancel-response.json'), '{not-json', { mode: 0o600 });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    let code = null;
    try { R.cancelRun(runId); } catch (e) { code = e.code; }
    console.log(JSON.stringify({ code, saved: R.loadRun(runId) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(observed.code, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(observed.saved.state, 'BUILDING');
  assert.strictEqual(observed.saved.build.terminationEvidence.terminated, false);
  assert.strictEqual(observed.saved.build.terminationEvidence.reason,
    'CONTROL_RESPONSE_AUTHENTICATION_FAILED');
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(controlDir, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: unauthenticated response fails closed and is never accepted as termination evidence', () => {
  const controlDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cancel-unauthenticated-'));
  fs.chmodSync(controlDir, 0o700);
  const controlStat = fs.statSync(controlDir);
  const secret = crypto.randomBytes(32).toString('hex');
  const attemptId = '95959595-9595-4595-8595-959595959595';
  const cancellationId = '96969696-9696-4696-8696-969696969696';
  const childIdentity = { pid: 4545, processGroupId: 4444, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4444,
    processGroupId: 4444, childProcessGroupId: 4444, childProcessIdentity: childIdentity,
    control: { dir: controlDir, secret,
      secretSha256: crypto.createHash('sha256').update(secret).digest('hex'),
      directoryIdentity: { dev: Number(controlStat.dev), ino: Number(controlStat.ino) } },
    workerState: 'RUNNING', revision: 0 };
  const forgedBody = { attemptId, cancellationId, terminated: true, childCloseObserved: true,
    processGroupDrained: true, childIdentity, reason: 'FORGED_RESPONSE',
    observedAt: '2026-08-27T12:00:05.000Z' };
  fs.writeFileSync(path.join(controlDir, 'cancel-response.json'),
    JSON.stringify({ body: forgedBody, mac: '00'.repeat(32) }), { mode: 0o600 });
  const { r, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    let code = null;
    try { R.cancelRun(runId); } catch (e) { code = e.code; }
    console.log(JSON.stringify({ code, saved: R.loadRun(runId) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(observed.code, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(observed.saved.state, 'BUILDING');
  assert.strictEqual(observed.saved.build.terminationEvidence.terminated, false);
  assert.strictEqual(observed.saved.build.terminationEvidence.reason,
    'CONTROL_RESPONSE_AUTHENTICATION_FAILED');
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(controlDir, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: refuses BUILDING with CONTROL_UNAVAILABLE/409 and no mutation', () => {
  const { r, runsDir, ledger, TMP } = withSeededRun('BUILDING', null, `
    try {
      R.cancelRun(runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.threw, true);
  assert.strictEqual(out.code, 'CONTROL_UNAVAILABLE');
  assert.strictEqual(out.httpStatus, 409);
  const files = fs.readdirSync(runsDir);
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
  assert.strictEqual(saved.state, 'BUILDING', 'cancelRun must not mutate a BUILDING run');
  assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0, 'cancelRun must write nothing to the ledger when refused');
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: heartbeat at the signal boundary cannot deadlock or overwrite cancellation', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  const childIdentity = { pid: 4343, processGroupId: 4242, startMarker: 'child-fixture', executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4242,
    processGroupId: 4242, childProcessGroupId: 4242, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' }, workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    process.env.NODE_ENV = 'test';
    const out = R.cancelRun(runId, {
      requestCancellation: () => {
        R.updateWorkerAttempt(runId, ${JSON.stringify(attemptId)}, 4242,
          { heartbeatAt: '2026-08-27T12:00:01.000Z', stdoutTail: 'heartbeat-preserved' });
        return { terminated: true, childCloseObserved: true, processGroupDrained: true, childIdentity: ${JSON.stringify(childIdentity)}, signal: 'SIGTERM', observedAt: '2026-08-27T12:00:02.000Z' };
      },
    });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.state, 'ABANDONED');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.build.revision, 3, 'intent, heartbeat, and terminal CAS must each advance the revision once');
  assert.strictEqual(saved.build.stdoutTail, 'heartbeat-preserved');
  assert.strictEqual(saved.build.cancellation.status, 'TERMINATED');
  assert.strictEqual(saved.build.terminationEvidence.terminated, true);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((e) => e.operationId === `${runId}:BUILDING->ABANDONED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: a simultaneous second cancellation cannot replace the active operation', () => {
  const attemptId = '12121212-1212-4212-8212-121212121212';
  const childIdentity = { pid: 4444, processGroupId: 4343, startMarker: 'child-fixture', executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4343,
    processGroupId: 4343, childProcessGroupId: 4343, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' }, workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    process.env.NODE_ENV = 'test';
    let competing;
    const out = R.cancelRun(runId, {
      requestCancellation: (_build, cancellationId) => {
        const child = require('child_process').spawnSync(process.execPath, ['-e',
          'const R = require(' + JSON.stringify(${JSON.stringify(CLI)}) + ');' +
          'try { R.cancelRun(' + JSON.stringify(runId) + '); console.log(JSON.stringify({ threw: false })); }' +
          'catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }'
        ], { cwd: ${JSON.stringify(ROOT)}, encoding: 'utf8', env: process.env });
        competing = JSON.parse(child.stdout.trim().split('\\n').pop());
        const during = R.loadRun(runId);
        if (during.build.cancellation.cancellationId !== cancellationId) {
          throw new Error('the competing cancellation replaced the active cancellation id');
        }
        return { terminated: true, childCloseObserved: true, processGroupDrained: true, childIdentity: ${JSON.stringify(childIdentity)}, signal: 'SIGTERM', observedAt: '2026-08-27T12:00:02.000Z' };
      },
    });
    console.log(JSON.stringify({ out, competing }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(observed.competing,
    { threw: true, code: 'CANCELLATION_IN_PROGRESS', httpStatus: 409 });
  assert.strictEqual(observed.out.state, 'ABANDONED');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.build.revision, 2, 'only the original intent and terminal cancellation may mutate the attempt');
  assert.strictEqual(saved.build.cancellation.status, 'TERMINATED');
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((e) => e.operationId === `${runId}:BUILDING->ABANDONED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: a worker finalizer that wins during signalling is never overwritten', () => {
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const childIdentity = { pid: 5353, processGroupId: 5252, startMarker: 'child-fixture', executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 2, attemptId, workerPid: 5252,
    processGroupId: 5252, childProcessGroupId: 5252, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' }, workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    process.env.NODE_ENV = 'test';
    try {
      R.cancelRun(runId, {
        requestCancellation: () => {
          R.transitionWorkerAttempt(runId, ${JSON.stringify(attemptId)}, 5252, 'BUILT', 'deterministic close won', { exit: 0 });
          return { terminated: true, childCloseObserved: true, processGroupDrained: true, childIdentity: ${JSON.stringify(childIdentity)}, signal: null, observedAt: '2026-08-27T12:00:03.000Z' };
        },
      });
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()), {
    threw: true, code: 'CANCELLATION_SUPERSEDED', httpStatus: 409,
  });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILT');
  assert.strictEqual(saved.build.revision, 2, 'cancel intent and finalizer must be the only two mutations');
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING').length, 1);
  const entries = ledgerEntriesFor(ledger, runId);
  assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:BUILDING->BUILT`).length, 1);
  assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:BUILDING->ABANDONED`).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: unsafe recovery is administratively abandonable without signalling or changing termination truth', () => {
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const childIdentity = { pid: 6363, processGroupId: 6262, startMarker: 'child-fixture', executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 3, attemptId, workerPid: 6262,
    processGroupId: 6262, childProcessGroupId: 6262, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' }, workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    process.env.NODE_ENV = 'test';
    let cancelCode = null;
    try {
      R.cancelRun(runId, {
        requestCancellation: () => ({ terminated: false, childCloseObserved: false, reason: 'CONTROL_RESPONSE_TIMEOUT', observedAt: '2026-08-27T12:00:04.000Z' }),
      });
    } catch (e) { cancelCode = e.code; }
    const afterCancel = R.loadRun(runId);
    const reconciled = R.reconcileWorkerRun(runId);
    const failed = R.loadRun(runId);
    let retryCode = null;
    try { R.retryRun(runId); } catch (e) { retryCode = e.code; }
    let lateCode = null;
    try { R.updateWorkerAttempt(runId, ${JSON.stringify(attemptId)}, 6262, { heartbeatAt: 'late' }); }
    catch (e) { lateCode = e.code; }
    const terminationEvidenceBefore = JSON.stringify(failed.build.terminationEvidence);
    let signalRequests = 0;
    let abandonCode = null;
    let abandoned = null;
    try {
      abandoned = R.cancelRun(runId, {
        requestCancellation: () => { signalRequests += 1; throw new Error('administrative abandonment must not signal'); },
      });
    } catch (e) { abandonCode = e.code; }
    let terminalRetryCode = null;
    try { R.retryRun(runId); } catch (e) { terminalRetryCode = e.code; }
    console.log(JSON.stringify({ cancelCode, afterCancel, reconciled, failed, retryCode, lateCode,
      terminationEvidenceBefore, signalRequests, abandonCode, abandoned, terminalRetryCode }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.cancelCode, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(out.afterCancel.state, 'BUILDING');
  assert.strictEqual(out.afterCancel.build.revision, 2);
  assert.strictEqual(out.afterCancel.build.cancellation.status, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(out.reconciled.reason, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(out.failed.state, 'BUILD_FAILED');
  assert.strictEqual(out.failed.build.workerState, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(out.failed.build.recovery.retrySafe, false);
  assert.strictEqual(out.retryCode, 'RECOVERY_UNSAFE');
  assert.strictEqual(out.lateCode, 'STALE-WORKER-ATTEMPT');
  assert.strictEqual(out.signalRequests, 0);
  assert.strictEqual(out.abandonCode, null);
  assert.strictEqual(out.abandoned.state, 'ABANDONED');
  assert.strictEqual(out.terminalRetryCode, 'INVALID_RETRY');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'ABANDONED');
  assert.strictEqual(saved.build.revision, 3);
  assert.strictEqual(JSON.stringify(saved.build.terminationEvidence), out.terminationEvidenceBefore);
  assert.strictEqual(saved.build.recovery.terminationVerified, false);
  assert.strictEqual(saved.build.recovery.retrySafe, false);
  assert.strictEqual(saved.build.recovery.abandonmentAllowed, true);
  assert.deepStrictEqual(Object.keys(saved.build.recovery.administrativeResolution).sort(),
    ['resolvedAt', 'signallingAttempted', 'type']);
  assert.strictEqual(saved.build.recovery.administrativeResolution.type, 'ABANDONED_WITHOUT_SIGNAL');
  assert.strictEqual(saved.build.recovery.administrativeResolution.signallingAttempted, false);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((e) => e.operationId === `${runId}:BUILDING->BUILD_FAILED`).length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((e) => e.operationId === `${runId}:BUILD_FAILED->ABANDONED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: unsafe recovery refuses administrative abandonment unless explicitly allowed', () => {
  const recovery = { reason: 'TERMINATION_UNVERIFIED', observedAt: '2026-08-27T12:01:00.000Z',
    terminationVerified: false, retrySafe: false, abandonmentAllowed: false,
    attemptId: '44444444-4444-4444-8444-444444444444' };
  const build = { mode: 'async', attempt: 4, attemptId: recovery.attemptId, workerState: 'TERMINATION_UNVERIFIED',
    revision: 4, recovery, terminationEvidence: { terminated: false, reason: 'sentinel' } };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { build }, `
    let out;
    try { R.cancelRun(runId); out = { threw: false }; }
    catch (e) { out = { threw: true, code: e.code, httpStatus: e.httpStatus }; }
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'TERMINATION_UNVERIFIED', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILD_FAILED');
  assert.deepStrictEqual(saved.build.recovery, recovery);
  assert.deepStrictEqual(saved.build.terminationEvidence, { terminated: false, reason: 'sentinel' });
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: refuses terminal/non-permitted states with no mutation', () => {
  for (const state of ['ABANDONED', 'CHECKPOINTED']) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, null, `
      try {
        R.cancelRun(runId);
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
      }
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, `cancelRun must refuse ${state}`);
    assert.strictEqual(out.code, 'CONTROL_UNAVAILABLE');
    assert.strictEqual(out.httpStatus, 409);
    const files = fs.readdirSync(runsDir);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
    assert.strictEqual(saved.state, state, `cancelRun must not mutate ${state}`);
    assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('retryRun: build, checks, and review failures transition to CORRECTING with exactly one increment', () => {
  assert.strictEqual(typeof R.retryRun, 'function');
  for (const state of ['BUILD_FAILED', 'CHECKS_FAILED', 'REVIEW_FAILED']) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, { corrections: 1 }, `
      const out = R.retryRun(runId);
      console.log(JSON.stringify(out));
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['action', 'correction', 'nextAction', 'runId', 'state'],
      `retryRun response for ${state} has the wrong keys`);
    assert.strictEqual(out.state, 'CORRECTING');
    assert.strictEqual(out.action, 'retry');
    assert.strictEqual(out.correction, 2, 'corrections must be incremented exactly once, from 1 to 2');

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${out.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CORRECTING');
    assert.strictEqual(saved.corrections, 2);

    const entries = ledgerEntriesFor(ledger, out.runId);
    const match = entries.find((e) => e.operationId === `${out.runId}:${state}->CORRECTING`);
    assert.ok(match, `the canonical ledger must record ${state} -> CORRECTING`);
    assert.strictEqual(match.status, 'PASS');
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('retryRun: an existing per-run claim blocks the complete retry decision without mutation', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 1 }, `
    const fs = require('fs');
    const lock = R.runPath(runId) + '.launch.lock';
    const claimId = 'fixture-live-claim';
    fs.mkdirSync(lock, { mode: 0o700 });
    const owner = require('path').join(lock, claimId + '.json');
    fs.writeFileSync(owner, JSON.stringify({ claimId, runId, pid: process.pid,
      processIdentity: R.processIdentity(process.pid), claimedAt: new Date().toISOString() }), { mode: 0o600 });
    let out;
    try { R.retryRun(runId); out = { threw: false }; }
    catch (e) { out = { threw: true, code: e.code, httpStatus: e.httpStatus }; }
    fs.unlinkSync(owner); fs.rmdirSync(lock);
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'LAUNCH_IN_PROGRESS', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILD_FAILED');
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: a reused numeric PID with a different process lifetime is reclaimed without signalling it', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 0 }, `
    const fs = require('fs');
    const lock = R.runPath(runId) + '.launch.lock';
    const identity = R.processIdentity(process.pid);
    const claimId = 'fixture-reused-pid';
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(require('path').join(lock, claimId + '.json'), JSON.stringify({ claimId, runId, pid: process.pid,
      processIdentity: { ...identity, startMarker: identity.startMarker + '-prior-lifetime' },
      claimedAt: new Date().toISOString() }), { mode: 0o600 });
    const originalKill = process.kill;
    let signalCalls = 0;
    process.kill = () => { signalCalls++; throw new Error('claim recovery must not signal'); };
    let out;
    try { out = R.retryRun(runId); }
    finally { process.kill = originalKill; }
    console.log(JSON.stringify({ out, signalCalls, lockExists: fs.existsSync(lock) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.out.state, 'CORRECTING');
  assert.strictEqual(out.signalCalls, 0, 'claim recovery signalled the unrelated reused PID');
  assert.strictEqual(out.lockExists, false, 'the replacement claim was not released');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CORRECTING');
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: a positively absent crashed owner is reclaimed without signalling', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 0 }, `
    const fs = require('fs');
    const path = require('path');
    const lock = R.runPath(runId) + '.launch.lock';
    const claimId = 'fixture-dead-owner';
    const deadPid = 2147483647;
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, claimId + '.json'), JSON.stringify({ claimId, runId, pid: deadPid,
      processIdentity: { pid: deadPid, processGroupId: deadPid, startMarker: 'prior-lifetime',
        executable: '/dead/aegis-owner', source: 'ps' }, claimedAt: new Date().toISOString() }), { mode: 0o600 });
    const originalKill = process.kill;
    let signalCalls = 0;
    process.kill = () => { signalCalls++; throw new Error('dead-owner recovery must not signal'); };
    let out;
    try { out = R.retryRun(runId); }
    finally { process.kill = originalKill; }
    console.log(JSON.stringify({ out, signalCalls, lockExists: fs.existsSync(lock) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.out.state, 'CORRECTING');
  assert.strictEqual(out.signalCalls, 0, 'dead-owner recovery signalled a PID');
  assert.strictEqual(out.lockExists, false, 'the replacement claim was not released');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('global lease transfer defeats a stale launcher decision and stale generations cannot release', () => {
  const { r, TMP, env } = withSeededRun('WORKTREE_READY', {
    worktree: { path: fs.realpathSync(os.tmpdir()) },
  }, `
    const fs = require('fs');
    const { spawn } = require('child_process');
    const worker = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
      { detached: true, stdio: 'ignore' });
    worker.unref();
    let workerIdentity = null;
    const identityDeadline = Date.now() + 2000;
    while (!workerIdentity && Date.now() < identityDeadline) {
      workerIdentity = R.processIdentity(worker.pid);
      if (!workerIdentity) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    }
    if (!workerIdentity) throw new Error('fixture worker identity unavailable');
    const launcher = R.acquireGlobalWorkerClaim(0);
    const staleDecision = R.readRunLaunchClaim(R.globalWorkerLockPath());
    const transferred = R.transferGlobalWorkerClaim(launcher, runId,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', worker.pid, workerIdentity);
    const staleReleased = R.releaseRunLaunchClaim({ ...staleDecision.claim,
      lockPath: R.globalWorkerLockPath(), ownerPath: staleDecision.ownerPath });
    const staleGenerationReleased = R.releaseGlobalWorkerLease({ ...transferred,
      attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const current = R.readRunLaunchClaim(R.globalWorkerLockPath());
    try { process.kill(-worker.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    console.log(JSON.stringify({ staleReleased, staleGenerationReleased,
      currentClaimId: current.claim.claimId, transferredClaimId: transferred.claimId,
      currentHolder: current.claim.holder }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.staleReleased, false);
  assert.strictEqual(out.staleGenerationReleased, false);
  assert.strictEqual(out.currentClaimId, out.transferredClaimId);
  assert.strictEqual(out.currentHolder, 'WORKER_LEASE');
  const reclaim = spawnSync(process.execPath, ['-e', `
    const R=require(${JSON.stringify(CLI)});const fs=require('fs');
    const replacement=R.acquireGlobalWorkerClaim(3000);
    const replacementReleased=R.releaseRunLaunchClaim(replacement);
    console.log(JSON.stringify({replacementReleased,lockExists:fs.existsSync(R.globalWorkerLockPath())}));
  `], { cwd: ROOT, env, encoding: 'utf8' });
  assert.strictEqual(reclaim.status, 0, reclaim.stderr);
  assert.deepStrictEqual(JSON.parse(reclaim.stdout.trim().split('\n').pop()),
    { replacementReleased: true, lockExists: false });
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('global admission recovers an empty directory left by interrupted release', () => {
  const { r, TMP } = withSeededRun('WORKTREE_READY', {
    worktree: { path: fs.realpathSync(os.tmpdir()) },
  }, `
    const fs = require('fs');
    fs.mkdirSync(R.globalWorkerLockPath(), { mode: 0o700 });
    const claim = R.acquireGlobalWorkerClaim(1000);
    const released = R.releaseRunLaunchClaim(claim);
    console.log(JSON.stringify({ released, lockExists: fs.existsSync(R.globalWorkerLockPath()) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { released: true, lockExists: false });
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ── single-review admission on the same canonical global claim ──────────────
const DRAINED_PROOF = `{ state: 'LAUNCHED_DRAINED', launched: true, drainageProven: true,
  provenance: 'runtool-watchdog-drainage-evidence',
  detail: 'a reviewer process group was launched and this invocation proved it drained' }`;
const NOT_LAUNCHED_PROOF = `{ state: 'NOT_LAUNCHED', launched: false, drainageProven: null,
  provenance: 'callable-entry-before-launch',
  detail: 'no reviewer process was launched during this invocation' }`;

hostContainmentTest('review admission: one atomic REVIEW_HOLD generation excludes a second review and a builder', () => {
  const { r, TMP } = withSeededRun('WORKTREE_READY', {
    worktree: { path: fs.realpathSync(os.tmpdir()) },
  }, `
    const fs = require('fs'); const path = require('path');
    const lock = R.globalWorkerLockPath();
    const hold = R.acquireGlobalReviewHold(runId, 0);
    const owners = fs.readdirSync(lock);
    const stored = JSON.parse(fs.readFileSync(path.join(lock, owners[0]), 'utf8'));
    const attempt = (take) => { try { take(); return { threw: false }; }
      catch (error) { return { threw: true, code: error.code, httpStatus: error.httpStatus }; } };
    const second = attempt(() => R.acquireGlobalReviewHold(runId, 0));
    const builder = attempt(() => R.acquireGlobalWorkerClaim(0));
    console.log(JSON.stringify({ owners, holder: stored.holder, storedRunId: stored.runId,
      boundToRun: stored.runId === runId,
      boundToAttempt: typeof stored.attemptId === 'string' && stored.attemptId.length === 36,
      boundToCaller: stored.pid === process.pid &&
        R.sameProcessIdentity(stored.processIdentity, R.processIdentity(process.pid)),
      publishedGeneration: stored.claimId === hold.claimId, second, builder }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.owners.length, 1, 'the review hold published more than one owner record');
  assert.strictEqual(out.holder, 'REVIEW_HOLD');
  assert.strictEqual(out.boundToRun, true, 'the hold is not bound to exactly one run');
  assert.strictEqual(out.boundToAttempt, true, 'the hold carries no unique attempt');
  assert.strictEqual(out.boundToCaller, true, 'the hold is not bound to the calling process lifetime');
  assert.strictEqual(out.publishedGeneration, true,
    'the published generation differs from the one the caller holds');
  assert.deepStrictEqual(out.second, { threw: true, code: 'LAUNCH_IN_PROGRESS', httpStatus: 409 },
    'a second review overlapped the first');
  assert.deepStrictEqual(out.builder, { threw: true, code: 'LAUNCH_IN_PROGRESS', httpStatus: 409 },
    'a builder overlapped a review');

  // The hold is a review hold in its first published byte: there is no
  // reclaimable LAUNCHER generation that is later promoted, and no second lock.
  const src = fs.readFileSync(CLI, 'utf8');
  const acquireAt = src.indexOf('function acquireGlobalReviewHold');
  const acquire = src.slice(acquireAt, src.indexOf('\n}\n', acquireAt));
  assert.match(acquire, /holder: REVIEW_HOLD_HOLDER/,
    'the review holder must be part of the single atomic publication');
  assert.doesNotMatch(acquire, /LAUNCHER/,
    'the review hold must never exist as a launcher generation first');
  assert.strictEqual((acquire.match(/acquireLaunchClaim\(/g) || []).length, 1,
    'the review hold must reuse exactly one existing publication path');
  assert.strictEqual((src.match(/\.global-worker\.launch\.lock/g) || []).length, 1,
    'admission gained a second global lock path');
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('review admission: a dead or reused caller never frees a review hold', () => {
  const { r, TMP } = withSeededRun('WORKTREE_READY', {
    worktree: { path: fs.realpathSync(os.tmpdir()) },
  }, `
    const fs = require('fs'); const path = require('path');
    const lock = R.globalWorkerLockPath();
    const identity = R.processIdentity(process.pid);
    const deadPid = 2147483647;
    const claimId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const results = [];
    for (const [label, owner] of [
      ['dead caller', { pid: deadPid, processIdentity: { pid: deadPid, processGroupId: deadPid,
        startMarker: 'prior-lifetime', executable: '/dead/aegis-review', source: 'ps' } }],
      ['reused pid', { pid: process.pid,
        processIdentity: { ...identity, startMarker: identity.startMarker + '-prior-lifetime' } }],
    ]) {
      fs.mkdirSync(lock, { mode: 0o700 });
      const ownerPath = path.join(lock, claimId + '.json');
      const bytes = JSON.stringify({ claimId, scope: 'review of run ' + runId,
        lease: 'GLOBAL_SINGLE_WORKER', holder: 'REVIEW_HOLD', runId,
        attemptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ...owner,
        claimedAt: new Date().toISOString() });
      fs.writeFileSync(ownerPath, bytes, { mode: 0o600 });
      const attempt = (take) => { try { take(); return { threw: false }; }
        catch (error) { return { threw: true, code: error.code }; } };
      results.push({ label,
        review: attempt(() => R.acquireGlobalReviewHold(runId, 0)),
        builder: attempt(() => R.acquireGlobalWorkerClaim(0)),
        owners: fs.readdirSync(lock).length,
        preserved: fs.readFileSync(ownerPath, 'utf8') === bytes });
      fs.rmSync(lock, { recursive: true, force: true });
    }
    console.log(JSON.stringify(results));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const results = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(results.length, 2);
  for (const observed of results) {
    assert.deepStrictEqual(observed, {
      label: observed.label,
      review: { threw: true, code: 'LAUNCH_IN_PROGRESS' },
      builder: { threw: true, code: 'LAUNCH_IN_PROGRESS' },
      owners: 1,
      preserved: true,
    }, `a ${observed.label} freed an unresolved review hold`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('review admission: generic, stale and unproven release all preserve the held bytes', () => {
  const { r, TMP } = withSeededRun('WORKTREE_READY', {
    worktree: { path: fs.realpathSync(os.tmpdir()) },
  }, `
    const fs = require('fs');
    const hold = R.acquireGlobalReviewHold(runId, 0);
    const bytes = fs.readFileSync(hold.ownerPath, 'utf8');
    const drained = ${DRAINED_PROOF};
    const drainedLater = ${DRAINED_PROOF};
    const refused = {
      generic: R.releaseRunLaunchClaim(hold),
      // The generic release must have no argument that frees a review hold.
      // Anything extra is ignored, so a caller cannot reach the bytes without
      // going through the dedicated lifecycle validation.
      genericProvenFlag: R.releaseRunLaunchClaim(hold, true),
      genericExtraArguments: R.releaseRunLaunchClaim(hold, true, drainedLater, 'RELEASED'),
      // A reconstructed copy that relabels itself a launcher is still measured
      // against the holder the acquirer wrote to disk.
      genericReconstructedLauncher: R.releaseRunLaunchClaim({ ...hold, holder: 'LAUNCHER' }, true),
      genericWorkerLease: R.releaseGlobalWorkerLease(hold),
      staleGeneration: R.releaseGlobalReviewHold(
        { ...hold, claimId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }, drained),
      staleAttempt: R.releaseGlobalReviewHold(
        { ...hold, attemptId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, drained),
      missingProof: R.releaseGlobalReviewHold(hold, null),
      undrained: R.releaseGlobalReviewHold(hold, { state: 'LAUNCHED_UNDRAINED', launched: true,
        drainageProven: false, provenance: 'runtool-launch-attempted',
        detail: 'a reviewer process group was launched and this invocation did not prove it drained' }),
      unknown: R.releaseGlobalReviewHold(hold, { state: 'UNKNOWN', launched: null,
        drainageProven: null, provenance: 'unavailable',
        detail: 'reviewer process provenance is unavailable for this invocation' }),
      billingLaunchAttempted: R.releaseGlobalReviewHold(hold, { state: 'LAUNCHED_UNDRAINED',
        launched: true, drainageProven: false,
        provenance: 'grok-billing-preflight-launch-attempted',
        detail: 'a billing preflight process group was launched and was not proved drained' }),
      incoherentFields: R.releaseGlobalReviewHold(hold, { ...drained, drainageProven: false }),
      incoherentProvenance: R.releaseGlobalReviewHold(hold,
        { ...drained, provenance: 'runtool-launch-attempted' }),
      notLaunchedAfterLaunch: R.releaseGlobalReviewHold(hold, { state: 'NOT_LAUNCHED',
        launched: false, drainageProven: null, provenance: 'runtool-launch-attempted',
        detail: 'no reviewer process was launched during this invocation' }),
      unknownProvenance: R.releaseGlobalReviewHold(hold,
        { ...drained, provenance: 'browser-request-field' }),
      extraFields: R.releaseGlobalReviewHold(hold, { ...drained, exitCode: 0, verdict: 'PASS' }),
      outcomeShape: R.releaseGlobalReviewHold(hold,
        { ok: true, exitCode: 0, outcome: 'RECORD_WRITTEN', reason: null, verdict: 'PASS' }),
      textProof: R.releaseGlobalReviewHold(hold, 'LAUNCHED_DRAINED'),
      // A state naming an inherited Object.prototype member is malformed, not
      // recognized. It must refuse, not throw on the provenance lookup.
      inheritedStateConstructor: R.releaseGlobalReviewHold(hold, { ...drained, state: 'constructor' }),
      inheritedStateToString: R.releaseGlobalReviewHold(hold, { ...drained, state: 'toString' }),
    };
    const stillHeld = (() => { try { R.acquireGlobalWorkerClaim(0); return false; }
      catch (error) { return error.code === 'LAUNCH_IN_PROGRESS'; } })();
    console.log(JSON.stringify({ refused, stillHeld,
      preserved: fs.readFileSync(hold.ownerPath, 'utf8') === bytes }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const key of ['generic', 'genericProvenFlag', 'genericExtraArguments',
    'genericReconstructedLauncher']) {
    assert.strictEqual(out.refused[key], false, `the generic release freed a review hold: ${key}`);
  }
  assert.strictEqual(out.refused.genericWorkerLease, false,
    'the worker-lease release freed a review hold');
  for (const key of ['staleGeneration', 'staleAttempt']) {
    assert.deepStrictEqual(out.refused[key], { released: false, reason: 'STALE_GENERATION' }, key);
  }
  for (const key of ['missingProof', 'undrained', 'unknown', 'billingLaunchAttempted',
    'incoherentFields', 'incoherentProvenance', 'notLaunchedAfterLaunch', 'unknownProvenance',
    'extraFields', 'outcomeShape', 'textProof', 'inheritedStateConstructor',
    'inheritedStateToString']) {
    assert.deepStrictEqual(out.refused[key], { released: false, reason: 'REVIEW_LIFECYCLE_UNPROVEN' }, key);
  }
  assert.strictEqual(out.preserved, true, 'a refused release mutated the held owner bytes');
  assert.strictEqual(out.stillHeld, true, 'the slot was freed by a refused release');
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('review admission: another live process cannot release a hold it does not own', () => {
  const { r, TMP, env, runId } = withSeededRun('WORKTREE_READY', {
    worktree: { path: fs.realpathSync(os.tmpdir()) },
  }, `
    const fs = require('fs');
    // This process takes the hold and then EXITS without releasing it, which
    // is exactly the caller death that must not free the slot.
    const hold = R.acquireGlobalReviewHold(runId, 0);
    console.log(JSON.stringify({ ownerPath: hold.ownerPath,
      bytes: fs.readFileSync(hold.ownerPath, 'utf8') }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const held = JSON.parse(r.stdout.trim().split('\n').pop());
  const survivor = spawnSync(process.execPath, ['-e', `
    const R = require(${JSON.stringify(CLI)});
    const fs = require('fs');
    const existing = R.readRunLaunchClaim(R.globalWorkerLockPath());
    const hold = { ...existing.claim, lockPath: R.globalWorkerLockPath(), ownerPath: existing.ownerPath };
    const attempt = (take) => { try { take(); return { threw: false }; }
      catch (error) { return { threw: true, code: error.code }; } };
    console.log(JSON.stringify({
      holder: hold.holder,
      proven: R.releaseGlobalReviewHold(hold, ${DRAINED_PROOF}),
      generic: R.releaseRunLaunchClaim(hold),
      review: attempt(() => R.acquireGlobalReviewHold(${JSON.stringify(runId)}, 0)),
      builder: attempt(() => R.acquireGlobalWorkerClaim(0)),
      bytes: fs.readFileSync(existing.ownerPath, 'utf8') }));
  `], { cwd: ROOT, env, encoding: 'utf8' });
  assert.strictEqual(survivor.status, 0, survivor.stderr);
  const out = JSON.parse(survivor.stdout.trim().split('\n').pop());
  assert.strictEqual(out.holder, 'REVIEW_HOLD', 'the dead caller left no review hold behind');
  assert.deepStrictEqual(out.proven, { released: false, reason: 'CALLER_NOT_LIVE_OWNER' },
    'a different live process released a hold it never took');
  assert.strictEqual(out.generic, false);
  assert.deepStrictEqual(out.review, { threw: true, code: 'LAUNCH_IN_PROGRESS' });
  assert.deepStrictEqual(out.builder, { threw: true, code: 'LAUNCH_IN_PROGRESS' });
  assert.strictEqual(out.bytes, held.bytes, 'the surviving hold was rewritten');
  fs.rmSync(TMP, { recursive: true, force: true });
});

hostContainmentTest('review admission: proven lifecycle evidence releases the slot back to the builders', () => {
  const { r, TMP } = withSeededRun('WORKTREE_READY', {
    worktree: { path: fs.realpathSync(os.tmpdir()) },
  }, `
    const fs = require('fs');
    const lock = R.globalWorkerLockPath();
    const first = R.acquireGlobalReviewHold(runId, 0);
    const releasedNotLaunched = R.releaseGlobalReviewHold(first, ${NOT_LAUNCHED_PROOF});
    const freedForBuilder = (() => {
      const claim = R.acquireGlobalWorkerClaim(0);
      const holder = claim.holder;
      return { holder, released: R.releaseRunLaunchClaim(claim) };
    })();
    const second = R.acquireGlobalReviewHold(runId, 0);
    const newGeneration = second.claimId !== first.claimId && second.attemptId !== first.attemptId;
    const staleFirstAgain = R.releaseGlobalReviewHold(first, ${NOT_LAUNCHED_PROOF});
    const releasedDrained = R.releaseGlobalReviewHold(second, ${DRAINED_PROOF});
    console.log(JSON.stringify({ releasedNotLaunched, freedForBuilder, newGeneration,
      staleFirstAgain, releasedDrained, lockExists: fs.existsSync(lock) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out.releasedNotLaunched, { released: true, reason: 'RELEASED' },
    'a proven unlaunched review could not release its own hold');
  assert.deepStrictEqual(out.freedForBuilder, { holder: 'LAUNCHER', released: true },
    'the released slot did not return to ordinary builder admission');
  assert.strictEqual(out.newGeneration, true, 'the second hold reused the first generation');
  assert.deepStrictEqual(out.staleFirstAgain, { released: false, reason: 'STALE_GENERATION' },
    'a spent generation released a live hold');
  assert.deepStrictEqual(out.releasedDrained, { released: true, reason: 'RELEASED' },
    'proven drainage could not release the hold');
  assert.strictEqual(out.lockExists, false, 'the proven release left the global claim behind');
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ── one bounded internal review request over that admission ─────────────────
// The callable owns a SEQUENCE, so every proof below is about the sequence:
// what it refuses before taking anything, what it re-checks once it holds both
// canonical claims, that it reaches the canonical reviewer exactly once, and
// which evidence may hand the admission slot back.
//
// The canonical adapter is replaced inside the isolated subprocess through
// Module._load, before aegis-run is required — the same interception the
// worker-launch contention proof already uses. Production code gains no
// injection point, and no reviewer, provider, network or paid API is reached.
function reviewRequestAdapterDouble(body) {
  return `
    const reviewRequestModule = require('module');
    const originalReviewRequestLoad = reviewRequestModule._load;
    global.__adapterRequests = [];
    reviewRequestModule._load = function (request) {
      if (/review-adapters\\.cjs$/.test(request)) {
        return { requestCanonicalReview: async (received) => {
          global.__adapterRequests.push(received);
          // Observed from INSIDE the one invocation: both canonical claims are
          // held for as long as the reviewer is running.
          const heldR = require(${JSON.stringify(CLI)});
          global.__admissionDuringReview = {
            builderRefused: (() => {
              try { heldR.acquireGlobalWorkerClaim(0); return false; }
              catch (error) { return error.code === 'LAUNCH_IN_PROGRESS'; }
            })(),
            runLockHeld: require('fs').existsSync(global.__runFile + '.launch.lock'),
          };
          ${body}
        } };
      }
      return originalReviewRequestLoad.apply(this, arguments);
    };
  `;
}

function reviewRequestFixture(options) {
  const adapterBody = options.adapter ||
    'throw new Error("the canonical review adapter was invoked by a refused request");';
  return withSeededRun(options.state || 'CHECKS_PASSED', options.seed, `
    ${options.prelude || ''}
    const requestFs = require('fs');
    const requestFile = require('path').join(process.env.AEGIS_RUNS_DIR, runId + '.json');
    global.__runFile = requestFile;
    const beforeRun = requestFs.readFileSync(requestFile, 'utf8');
    const beforeLedger = requestFs.readFileSync(process.env.AEGIS_LEDGER_FILE, 'utf8');
    (async () => {
      const answers = [];
      for (const request of ${options.requests}) {
        answers.push(await R.requestIndependentReview(request));
      }
      console.log(JSON.stringify({
        answers,
        frozen: answers.every((answer) => Object.isFrozen(answer)),
        adapterRequests: global.__adapterRequests,
        admissionDuringReview: global.__admissionDuringReview || null,
        runUnchanged: requestFs.readFileSync(requestFile, 'utf8') === beforeRun,
        ledgerUnchanged: requestFs.readFileSync(process.env.AEGIS_LEDGER_FILE, 'utf8') === beforeLedger,
        runLockExists: requestFs.existsSync(requestFile + '.launch.lock'),
        globalLockExists: requestFs.existsSync(R.globalWorkerLockPath()),
      }));
    })().catch((error) => {
      console.error(error && error.stack ? error.stack : String(error));
      process.exitCode = 1;
    });
  `, `${engineeringOsMock(options.responses || [])}
     ${reviewRequestAdapterDouble(adapterBody)}`);
}

// Exactly the pending shape the canonical gate publishes: every REQUIRED
// reviewer is listed, and only the named ones still owe an exact-subject
// review. Coverage is deliberately incomplete, so the gate blocks on review
// work alone and the recorded-rejection path is not reachable from here.
function reviewRequestPendingGate(subject, pending) {
  return reviewGate(subject, {
    ok: false,
    state: 'BLOCKED',
    problems: pending.map((reviewer) => ({ rule: 'ENGOS-REVIEW-MISSING',
      detail: `${reviewer} has no record bound to this subject` })),
    reviewerCompleteness: {
      subjectSha256: subject.subjectSha256,
      complete: false,
      required: ['codex', 'grok'],
      missing: pending,
      pathCoverage: { total: subject.subjectPaths.length, coveredByEveryRequiredReviewer: [],
        notCoveredByEveryRequiredReviewer: subject.subjectPaths },
      rows: ['codex', 'grok'].map((reviewer) => (pending.includes(reviewer)
        ? { reviewer, required: 'REQUIRED', executed: 'MISSING', disposition: null,
          reviewId: null, missingPaths: subject.subjectPaths, stalePaths: [] }
        : { reviewer, required: 'REQUIRED', executed: 'EXECUTED', disposition: 'APPROVE',
          reviewId: `REV-${reviewer}-fixture`, missingPaths: [], stalePaths: [] })),
    },
    reviewsBound: 0, reviewsActive: 0, reviewsForeign: 0,
  });
}

// One permitted preflight costs three canonical reads: the subject, the gate,
// and the bounded review cycle. The callable performs two preflights, so a
// launched request scripts six.
const reviewRequestPreflight = (subject, pending) => [
  { status: 0, body: subject },
  { status: 3, body: reviewRequestPendingGate(subject, pending) },
  reviewCycleStart(subject),
];

const reviewRequestSeed = (subject) => (seedRunId) => ({
  ...REVIEW_RUN, checks: passedChecksFor(seedRunId, subject),
});

const REVIEW_REQUEST_SECRET = 'SECRET-PROVIDER-TEXT /Users/fixture/secret/prompt.txt';
const reviewRequestAdapterResult = (outcome, exitCode, lifecycle) => `
  return { ok: ${exitCode === 0}, exitCode: ${exitCode}, outcome: ${JSON.stringify(outcome)},
    reason: ${JSON.stringify(REVIEW_REQUEST_SECRET)}${lifecycle ? `,
    processLifecycle: ${lifecycle}` : ''} };
`;

function reviewRequestOutcome(r) {
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// Nothing this callable does may move a lifecycle, bind a review, append to the
// canonical ledger or leave the per-run claim behind — on ANY exit path.
function assertReviewRequestMovedNothing(out, runsDir, ledger, runId, state, label) {
  assert.strictEqual(out.frozen, true, `${label}: a returned answer is mutable`);
  assert.strictEqual(out.runUnchanged, true, `${label}: the request rewrote the run file`);
  assert.strictEqual(out.ledgerUnchanged, true, `${label}: the request appended to the canonical ledger`);
  assert.strictEqual(out.runLockExists, false, `${label}: the per-run claim was not released`);
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, state, `${label}: the run state moved`);
  assert.strictEqual(saved.subject, undefined, `${label}: a subject was bound`);
  assert.strictEqual(saved.reviewGate, undefined, `${label}: a review gate was recorded`);
  assert.strictEqual(saved.reviewFailure, undefined, `${label}: a review failure was recorded`);
  assert.strictEqual(saved.corrections, 0, `${label}: a correction cycle was consumed`);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((entry) => entry.gate === 'aegis-run').length,
    0, `${label}: a canonical ledger transition was appended`);
  const serialized = JSON.stringify(out.answers);
  assert.doesNotMatch(serialized, /SECRET-PROVIDER-TEXT/,
    `${label}: provider output reached the caller`);
  assert.doesNotMatch(serialized, /\/Users\//, `${label}: a filesystem path reached the caller`);
}

test('review request: an ineligible run or an unnamed reviewer never launches', () => {
  // A run that is not CHECKS_PASSED, and a run that does not exist: the
  // preflight refuses both before any canonical authority is asked at all.
  const ineligible = reviewRequestFixture({
    state: 'BUILT',
    seed: (seedRunId) => ({ ...REVIEW_RUN, checks: passedChecksFor(seedRunId) }),
    requests: `[{ runId, reviewer: 'codex' },
      { runId: 'RUN-19700101-deadbeef', reviewer: 'grok' }]`,
  });
  const refusedOut = reviewRequestOutcome(ineligible.r);
  for (const answer of refusedOut.answers) {
    assert.strictEqual(answer.reasonCode, 'REVIEW_NOT_PERMITTED', JSON.stringify(answer));
    assert.strictEqual(answer.review, 'NOT_REQUESTED');
    assert.strictEqual(answer.reviewProcess, 'NOT_LAUNCHED');
    assert.strictEqual(answer.admission, 'NOT_ACQUIRED');
  }
  assert.deepStrictEqual(refusedOut.adapterRequests, [], 'an ineligible run reached the reviewer');
  assert.strictEqual(refusedOut.globalLockExists, false,
    'an ineligible run occupied the single admission slot');
  assertReviewRequestMovedNothing(refusedOut, ineligible.runsDir, ineligible.ledger,
    ineligible.runId, 'BUILT', 'ineligible run');
  fs.rmSync(ineligible.TMP, { recursive: true, force: true });

  // Permitted, but the canonical preflight names only grok. Asking for codex is
  // inventing review work the gate did not report as owed.
  const subject = reviewSubject();
  const mismatch = reviewRequestFixture({
    seed: reviewRequestSeed(subject),
    responses: reviewRequestPreflight(subject, ['grok']),
    requests: `[{ runId, reviewer: 'codex' }]`,
  });
  const mismatchOut = reviewRequestOutcome(mismatch.r);
  assert.strictEqual(mismatchOut.answers.length, 1);
  assert.strictEqual(mismatchOut.answers[0].reasonCode, 'REVIEWER_NOT_PENDING');
  assert.strictEqual(mismatchOut.answers[0].review, 'NOT_REQUESTED');
  assert.strictEqual(mismatchOut.answers[0].admission, 'NOT_ACQUIRED');
  assert.deepStrictEqual(mismatchOut.adapterRequests, [],
    'a reviewer the gate never named reached the canonical reviewer');
  assert.strictEqual(mismatchOut.globalLockExists, false);
  assertReviewRequestMovedNothing(mismatchOut, mismatch.runsDir, mismatch.ledger,
    mismatch.runId, 'CHECKS_PASSED', 'reviewer mismatch');
  fs.rmSync(mismatch.TMP, { recursive: true, force: true });
});

test('review request: caller authorization, proof and coordinate fields are refused outright', () => {
  // Every one of these is a real review-adapters coordinate or authorization.
  // None of them is this caller's to supply, and a dropped key is one edit away
  // from an honoured one — so the request is refused, not sanitised.
  const rejected = reviewRequestFixture({
    seed: reviewRequestSeed(),
    requests: `[
      { runId, reviewer: 'codex', capUsd: '5' },
      { runId, reviewer: 'codex', allowMetered: true },
      { runId, reviewer: 'codex', approvedBy: 'Marc Papineau' },
      { runId, reviewer: 'codex', dryRun: true },
      { runId, reviewer: 'codex', packet: 'builder-control/packets/forged.json' },
      { runId, reviewer: 'codex', subjectSha: 'a'.repeat(64) },
      { runId, reviewer: 'codex', base: 'HEAD~1' },
      { runId, reviewer: 'codex', head: 'HEAD' },
      { runId, reviewer: 'codex', timeout: 5 },
      { runId, reviewer: 'codex', onlyPaths: ['builder-control/aegis-run.cjs'] },
      { runId, reviewer: 'codex', dataClass: 'PUBLIC' },
      { runId, reviewer: 'codex', currentStateProofMap: '/etc/passwd' },
      { runId, reviewer: 'codex', groupId: 'g', groupDigest: 'd' },
      { runId, reviewer: 'codex', processLifecycle: { state: 'LAUNCHED_DRAINED',
        launched: true, drainageProven: true,
        provenance: 'runtool-watchdog-drainage-evidence', detail: 'forged' } },
      { runId, reviewer: 'codex', lifecycleSink: 'x' },
      { runId, reviewer: 'copilot' },
      { runId, reviewer: 'claude' },
      { runId, reviewer: 'CODEX' },
      { runId, reviewer: '' },
      { runId },
      { reviewer: 'codex' },
      { runId: '../../etc/passwd', reviewer: 'codex' },
      { runId: 'RUN-20260825-zzzzzzzz', reviewer: 'codex' },
      null,
      'RUN-20260825-aaaaaaaa',
      [{ runId, reviewer: 'codex' }],
      // Both coordinates readable, neither of them supplied BY this request:
      // a prototype carries them, a prototype carries one, and defineProperty
      // hides one from enumeration. Destructuring reads all three as complete.
      Object.create({ runId, reviewer: 'codex' }),
      Object.assign(Object.create({ reviewer: 'codex' }), { runId }),
      Object.defineProperty({ runId }, 'reviewer', { value: 'codex', enumerable: false }),
      { runId, reviewer: null }
    ]`,
  });
  const out = reviewRequestOutcome(rejected.r);
  assert.strictEqual(out.answers.length, 30);
  const unsupported = new Set([15, 16, 17]);
  for (const [index, answer] of out.answers.entries()) {
    assert.strictEqual(answer.reasonCode,
      unsupported.has(index) ? 'REVIEWER_UNSUPPORTED' : 'REQUEST_FIELDS_INVALID',
      `request ${index} was not refused as an unusable request: ${JSON.stringify(answer)}`);
    assert.strictEqual(answer.review, 'NOT_REQUESTED', `request ${index} asked for a review`);
    assert.strictEqual(answer.admission, 'NOT_ACQUIRED', `request ${index} took admission`);
    // A refused request is never echoed back, so a caller-shaped string can
    // never leave through this answer either.
    assert.strictEqual(answer.runId, null, `request ${index} echoed a caller coordinate`);
    assert.strictEqual(answer.reviewer, null, `request ${index} echoed a caller reviewer`);
  }
  assert.deepStrictEqual(out.adapterRequests, [],
    'a request carrying caller authority reached the canonical reviewer');
  assert.strictEqual(out.globalLockExists, false);
  assertReviewRequestMovedNothing(out, rejected.runsDir, rejected.ledger, rejected.runId,
    'CHECKS_PASSED', 'refused request fields');
  fs.rmSync(rejected.TMP, { recursive: true, force: true });

  // The two-field shape is the contract, not a convention.
  assert.deepStrictEqual(R.REVIEW_REQUEST_FIELDS, ['runId', 'reviewer']);
  assert.deepStrictEqual(R.REVIEW_REQUEST_REVIEWERS, ['codex', 'grok']);
  assert.strictEqual(R.requestIndependentReview.length, 1);
  const src = fs.readFileSync(CLI, 'utf8');
  const body = src.slice(src.indexOf('async function requestIndependentReview(request)'),
    src.indexOf('// ── step 8:'));
  assert.doesNotMatch(body, /\.\.\.request/, 'caller input is spread into an adapter argument');
  assert.match(body, /require\('\.\/review-adapters\.cjs'\)/,
    'the canonical adapter is not loaded lazily from inside the callable');
  assert.strictEqual((body.match(/requestCanonicalReview\(/g) || []).length, 1,
    'the callable names more than one canonical review invocation');
  assert.doesNotMatch(body, /transition\(|saveRun|appendCanonicalLedgerEntry|bindIndependentReview/,
    'the callable reaches a lifecycle, ledger or binding authority');
});

test('review request: evidence that changed under both claims refuses without launching', () => {
  const subject = reviewSubject();
  // The tree moved: the second canonical subject no longer matches the check
  // receipt the first answer was built on.
  const moved = reviewRequestFixture({
    seed: reviewRequestSeed(subject),
    responses: [...reviewRequestPreflight(subject, ['codex', 'grok']),
      { status: 0, body: reviewSubject({ subjectSha256: 'b'.repeat(64) }) }],
    requests: `[{ runId, reviewer: 'codex' }]`,
  });
  const movedOut = reviewRequestOutcome(moved.r);
  assert.strictEqual(movedOut.answers[0].reasonCode, 'REVIEW_EVIDENCE_CHANGED');
  assert.strictEqual(movedOut.answers[0].review, 'NOT_REQUESTED');
  assert.strictEqual(movedOut.answers[0].reviewProcess, 'NOT_LAUNCHED');
  assert.strictEqual(movedOut.answers[0].admission, 'RELEASED',
    'a refusal that launched nothing kept the admission slot');
  assert.deepStrictEqual(movedOut.adapterRequests, [], 'a moved subject reached the reviewer');
  assert.strictEqual(movedOut.globalLockExists, false);
  assertReviewRequestMovedNothing(movedOut, moved.runsDir, moved.ledger, moved.runId,
    'CHECKS_PASSED', 'moved subject');
  fs.rmSync(moved.TMP, { recursive: true, force: true });

  // Still permitted under the claims — but codex stopped owing this subject
  // between the two answers, so this exact request is no longer the work.
  const reassigned = reviewRequestFixture({
    seed: reviewRequestSeed(subject),
    responses: [...reviewRequestPreflight(subject, ['codex', 'grok']),
      ...reviewRequestPreflight(subject, ['grok'])],
    requests: `[{ runId, reviewer: 'codex' }]`,
  });
  const reassignedOut = reviewRequestOutcome(reassigned.r);
  assert.strictEqual(reassignedOut.answers[0].reasonCode, 'REVIEW_EVIDENCE_CHANGED');
  assert.strictEqual(reassignedOut.answers[0].admission, 'RELEASED');
  assert.deepStrictEqual(reassignedOut.adapterRequests, [],
    'a reviewer that stopped owing the subject was still launched');
  assert.strictEqual(reassignedOut.globalLockExists, false);
  assertReviewRequestMovedNothing(reassignedOut, reassigned.runsDir, reassigned.ledger,
    reassigned.runId, 'CHECKS_PASSED', 'reviewer no longer pending');
  fs.rmSync(reassigned.TMP, { recursive: true, force: true });
});

test('review request: an eligible request reaches the canonical reviewer exactly once', () => {
  const subject = reviewSubject();
  const fixture = reviewRequestFixture({
    seed: reviewRequestSeed(subject),
    responses: [...reviewRequestPreflight(subject, ['codex', 'grok']),
      ...reviewRequestPreflight(subject, ['codex', 'grok'])],
    requests: `[{ runId, reviewer: 'codex' }]`,
    adapter: reviewRequestAdapterResult('RECORD_WRITTEN', 0, `{ state: 'LAUNCHED_DRAINED',
      launched: true, drainageProven: true,
      provenance: 'runtool-watchdog-drainage-evidence',
      detail: 'a reviewer process group was launched and this invocation proved it drained' }`),
  });
  const out = reviewRequestOutcome(fixture.r);

  // ONE invocation, carrying exactly four coordinates, every one of them read
  // back out of the canonical preflight rather than out of the caller.
  assert.strictEqual(out.adapterRequests.length, 1, 'the canonical reviewer was not called exactly once');
  assert.deepStrictEqual(out.adapterRequests[0], {
    runId: fixture.runId,
    reviewer: 'codex',
    packet: path.resolve(ROOT, REVIEW_PACKET),
    subjectSha: subject.subjectSha256,
  });
  assert.deepStrictEqual(Object.keys(out.adapterRequests[0]).sort(),
    ['packet', 'reviewer', 'runId', 'subjectSha']);

  // Both canonical claims were held while the reviewer was running.
  assert.deepStrictEqual(out.admissionDuringReview, { builderRefused: true, runLockHeld: true },
    'the request did not hold both canonical claims across the invocation');

  // The whole answer, exactly. RECORD_WRITTEN is reported as a written record
  // and nothing more; the process and admission facts stay separate fields.
  assert.deepStrictEqual(out.answers[0], {
    runId: fixture.runId,
    reviewer: 'codex',
    action: 'request-independent-review',
    authority: 'aegis-run.cjs requestIndependentReview',
    review: 'RECORD_WRITTEN',
    reviewProcess: 'DRAINED',
    admission: 'RELEASED',
    reasonCode: 'REVIEW_RECORD_WRITTEN',
    summary: 'A review record was written. It records what the reviewer said; ' +
      'it is not an approval and it moves no gate.',
  });
  assert.strictEqual(out.globalLockExists, false, 'a drained review kept the admission slot');
  assertReviewRequestMovedNothing(out, fixture.runsDir, fixture.ledger, fixture.runId,
    'CHECKS_PASSED', 'one exact invocation');
  fs.rmSync(fixture.TMP, { recursive: true, force: true });
});

test('review request: contention for the single admission slot refuses without launching', () => {
  const subject = reviewSubject();
  // Another review already owns the one canonical admission slot. The preflight
  // still permits this run — admission is what refuses, and it refuses without
  // waiting, because a reviewer holds the slot for as long as it runs.
  const fixture = reviewRequestFixture({
    seed: reviewRequestSeed(subject),
    responses: reviewRequestPreflight(subject, ['codex', 'grok']),
    prelude: `
      const competing = R.acquireGlobalReviewHold('RUN-20260825-aaaaaaaa', 0);
      global.__competingBytes = require('fs').readFileSync(competing.ownerPath, 'utf8');
      global.__competingOwnerPath = competing.ownerPath;
    `,
    requests: `[{ runId, reviewer: 'codex' }]`,
  });
  const out = reviewRequestOutcome(fixture.r);
  assert.strictEqual(out.answers[0].reasonCode, 'ADMISSION_UNAVAILABLE');
  assert.strictEqual(out.answers[0].review, 'NOT_REQUESTED');
  assert.strictEqual(out.answers[0].reviewProcess, 'NOT_LAUNCHED');
  assert.strictEqual(out.answers[0].admission, 'NOT_ACQUIRED',
    'a request that never took the slot reported an admission decision about it');
  assert.deepStrictEqual(out.adapterRequests, [], 'two reviews overlapped on one admission slot');
  assert.strictEqual(out.runLockExists, false, 'a refused request left the per-run claim behind');
  assert.strictEqual(out.globalLockExists, true,
    'the refused request removed the competing review hold');
  assertReviewRequestMovedNothing(out, fixture.runsDir, fixture.ledger, fixture.runId,
    'CHECKS_PASSED', 'admission contention');
  fs.rmSync(fixture.TMP, { recursive: true, force: true });
});

test('review request: only this invocation\'s own lifecycle evidence frees admission', () => {
  const drained = `{ state: 'LAUNCHED_DRAINED', launched: true, drainageProven: true,
    provenance: 'runtool-watchdog-drainage-evidence',
    detail: 'a reviewer process group was launched and this invocation proved it drained' }`;
  const scenarios = [
    { label: 'proven drainage', exitCode: 0, outcome: 'RECORD_WRITTEN', lifecycle: drained,
      review: 'RECORD_WRITTEN', reviewProcess: 'DRAINED', admission: 'RELEASED',
      reasonCode: 'REVIEW_RECORD_WRITTEN' },
    { label: 'proven no launch', exitCode: 2, outcome: 'REFUSED_REQUEST',
      lifecycle: `{ state: 'NOT_LAUNCHED', launched: false, drainageProven: null,
        provenance: 'callable-entry-before-launch',
        detail: 'no reviewer process was launched during this invocation' }`,
      review: 'REVIEW_REFUSED', reviewProcess: 'NOT_LAUNCHED', admission: 'RELEASED',
      reasonCode: 'REVIEW_REQUEST_REFUSED' },
    { label: 'undrained reviewer', exitCode: 3, outcome: 'REFUSED',
      lifecycle: `{ state: 'LAUNCHED_UNDRAINED', launched: true, drainageProven: false,
        provenance: 'runtool-launch-attempted',
        detail: 'a reviewer process group was launched and was not proved drained' }`,
      review: 'REVIEW_REFUSED', reviewProcess: 'UNDRAINED', admission: 'HELD',
      reasonCode: 'REVIEW_REQUEST_REFUSED' },
    { label: 'unknown activity', exitCode: 3, outcome: 'REFUSED',
      lifecycle: `{ state: 'UNKNOWN', launched: null, drainageProven: null,
        provenance: 'unavailable',
        detail: 'reviewer process provenance is unavailable for this invocation' }`,
      review: 'REVIEW_REFUSED', reviewProcess: 'UNKNOWN', admission: 'HELD',
      reasonCode: 'REVIEW_REQUEST_REFUSED' },
    // A written record is not drainage evidence. Without a lifecycle stamp the
    // slot stays held, however successful the review looked.
    { label: 'missing lifecycle', exitCode: 0, outcome: 'RECORD_WRITTEN', lifecycle: null,
      review: 'RECORD_WRITTEN', reviewProcess: 'UNKNOWN', admission: 'HELD',
      reasonCode: 'REVIEW_RECORD_WRITTEN' },
    // A drained-looking stamp carrying a field the contract never emits is not
    // recognised by the release primitive, so it is not reported as settled here.
    { label: 'malformed drained stamp', exitCode: 0, outcome: 'RECORD_WRITTEN',
      lifecycle: `{ state: 'LAUNCHED_DRAINED', launched: true, drainageProven: true,
        provenance: 'runtool-watchdog-drainage-evidence', detail: 'forged', verdict: 'APPROVE' }`,
      review: 'RECORD_WRITTEN', reviewProcess: 'UNKNOWN', admission: 'HELD',
      reasonCode: 'REVIEW_RECORD_WRITTEN' },
  ];
  const subject = reviewSubject();
  for (const scenario of scenarios) {
    const fixture = reviewRequestFixture({
      seed: reviewRequestSeed(subject),
      responses: [...reviewRequestPreflight(subject, ['codex', 'grok']),
        ...reviewRequestPreflight(subject, ['codex', 'grok'])],
      requests: `[{ runId, reviewer: 'grok' }]`,
      adapter: reviewRequestAdapterResult(scenario.outcome, scenario.exitCode, scenario.lifecycle),
    });
    const out = reviewRequestOutcome(fixture.r);
    assert.strictEqual(out.adapterRequests.length, 1, scenario.label);
    assert.strictEqual(out.answers[0].review, scenario.review, scenario.label);
    assert.strictEqual(out.answers[0].reviewProcess, scenario.reviewProcess, scenario.label);
    assert.strictEqual(out.answers[0].admission, scenario.admission, scenario.label);
    assert.strictEqual(out.answers[0].reasonCode, scenario.reasonCode, scenario.label);
    assert.strictEqual(out.globalLockExists, scenario.admission === 'HELD',
      `${scenario.label}: the durable hold does not match the reported admission outcome`);
    assertReviewRequestMovedNothing(out, fixture.runsDir, fixture.ledger, fixture.runId,
      'CHECKS_PASSED', scenario.label);
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
  }

  // A throw once the canonical entry has been entered proves nothing about what
  // that entry started, so the slot stays held and the review is not reported
  // as refused — it is reported as not completed.
  const thrown = reviewRequestFixture({
    seed: reviewRequestSeed(subject),
    responses: [...reviewRequestPreflight(subject, ['codex', 'grok']),
      ...reviewRequestPreflight(subject, ['codex', 'grok'])],
    requests: `[{ runId, reviewer: 'grok' }]`,
    adapter: `throw new Error(${JSON.stringify(REVIEW_REQUEST_SECRET)});`,
  });
  const thrownOut = reviewRequestOutcome(thrown.r);
  assert.strictEqual(thrownOut.adapterRequests.length, 1);
  assert.strictEqual(thrownOut.answers[0].review, 'REVIEW_UNCOMPLETED');
  assert.strictEqual(thrownOut.answers[0].reviewProcess, 'UNKNOWN');
  assert.strictEqual(thrownOut.answers[0].admission, 'HELD',
    'an exception after dispatch handed the admission slot back');
  assert.strictEqual(thrownOut.answers[0].reasonCode, 'REVIEW_CALL_FAILED');
  assert.strictEqual(thrownOut.globalLockExists, true);
  assertReviewRequestMovedNothing(thrownOut, thrown.runsDir, thrown.ledger, thrown.runId,
    'CHECKS_PASSED', 'thrown after dispatch');
  fs.rmSync(thrown.TMP, { recursive: true, force: true });
});

// ── the seams that used to answer with a raw error ─────────────────────────
// Every refusal above is one the callable decided. These are the ones it did
// not: an internal step that failed in a way no refusal path produces. The
// contract is the same on all of them — a bounded category, a whole-sentence
// summary, the source error kept private, and no claim of ownership the
// failure did not establish.
const REVIEW_REQUEST_DRAINED = `{ state: 'LAUNCHED_DRAINED', launched: true,
  drainageProven: true, provenance: 'runtool-watchdog-drainage-evidence',
  detail: 'a reviewer process group was launched and this invocation proved it drained' }`;

// The answer-level invariants that hold on every one of these paths: frozen,
// no canonical mutation, and not one byte of the underlying error.
function assertBoundedRequestFailure(out, label) {
  assert.strictEqual(out.frozen, true, `${label}: a returned answer is mutable`);
  assert.strictEqual(out.runUnchanged, true, `${label}: the request rewrote the run file`);
  assert.strictEqual(out.ledgerUnchanged, true, `${label}: the request appended to the ledger`);
  const serialized = JSON.stringify(out.answers);
  assert.doesNotMatch(serialized, /SECRET-PROVIDER-TEXT/, `${label}: source evidence reached the caller`);
  assert.doesNotMatch(serialized, /\/Users\//, `${label}: a filesystem path reached the caller`);
  assert.doesNotMatch(serialized, /EACCES|ENOTDIR|not valid JSON/,
    `${label}: a raw error message reached the caller`);
}

test('review request: an unexpected preflight or admission failure is answered, not thrown', () => {
  // The canonical run file no longer parses, so the FIRST preflight throws
  // something no refusal path produces. Nothing was acquired on the way there,
  // so NOT_ACQUIRED is proven rather than assumed — and the thrown error, which
  // quotes the bytes it failed to parse, never leaves this file.
  const corrupt = reviewRequestFixture({
    seed: reviewRequestSeed(),
    prelude: `require('fs').writeFileSync(
      require('path').join(process.env.AEGIS_RUNS_DIR, runId + '.json'),
      ${JSON.stringify(REVIEW_REQUEST_SECRET)});`,
    requests: `[{ runId, reviewer: 'codex' }]`,
  });
  const corruptOut = reviewRequestOutcome(corrupt.r);
  assert.deepStrictEqual(corruptOut.answers[0], {
    runId: corrupt.runId,
    reviewer: 'codex',
    action: 'request-independent-review',
    authority: 'aegis-run.cjs requestIndependentReview',
    review: 'NOT_REQUESTED',
    reviewProcess: 'NOT_LAUNCHED',
    admission: 'NOT_ACQUIRED',
    reasonCode: 'REVIEW_PREFLIGHT_FAILED',
    summary: 'The canonical review preflight did not complete, so this run was never ' +
      'judged eligible and no review was started.',
  });
  assert.deepStrictEqual(corruptOut.adapterRequests, [], 'a failed preflight reached the reviewer');
  assert.strictEqual(corruptOut.runLockExists, false, 'a failed preflight took the per-run claim');
  assert.strictEqual(corruptOut.globalLockExists, false,
    'a failed preflight occupied the single admission slot');
  assertBoundedRequestFailure(corruptOut, 'preflight failure');
  fs.rmSync(corrupt.TMP, { recursive: true, force: true });

  // The canonical global claim path is a plain file, so publication cannot
  // rename onto it. Acquisition fails in a way the primitive never reports as
  // contention, and what owns the slot afterwards is not established — so the
  // answer says unconfirmed, keeps its hands off the bytes, and does not retry.
  const subject = reviewSubject();
  const unjudged = reviewRequestFixture({
    seed: reviewRequestSeed(subject),
    responses: reviewRequestPreflight(subject, ['codex', 'grok']),
    prelude: `require('fs').writeFileSync(R.globalWorkerLockPath(),
      ${JSON.stringify(REVIEW_REQUEST_SECRET)});`,
    requests: `[{ runId, reviewer: 'codex' }]`,
  });
  const unjudgedOut = reviewRequestOutcome(unjudged.r);
  assert.strictEqual(unjudgedOut.answers[0].reasonCode, 'ADMISSION_UNCONFIRMED');
  assert.strictEqual(unjudgedOut.answers[0].review, 'NOT_REQUESTED');
  assert.strictEqual(unjudgedOut.answers[0].reviewProcess, 'NOT_LAUNCHED');
  assert.strictEqual(unjudgedOut.answers[0].admission, 'UNCONFIRMED',
    'an unjudged admission slot was reported as free');
  assert.deepStrictEqual(unjudgedOut.adapterRequests, [],
    'an unjudged admission slot still reached the reviewer');
  assert.strictEqual(unjudgedOut.runLockExists, false);
  assert.strictEqual(fs.readFileSync(path.join(unjudged.runsDir, '.global-worker.launch.lock'), 'utf8'),
    REVIEW_REQUEST_SECRET, 'the failed acquisition guessed at cleaning up the claim path');
  assertBoundedRequestFailure(unjudgedOut, 'unjudged admission');
  assertReviewRequestMovedNothing(unjudgedOut, unjudged.runsDir, unjudged.ledger,
    unjudged.runId, 'CHECKS_PASSED', 'unjudged admission');
  fs.rmSync(unjudged.TMP, { recursive: true, force: true });
});

test('review request: a failed cleanup neither escapes nor reports a freed hold', () => {
  if (process.getuid && process.getuid() === 0) {
    return skip('directory permission seams do not constrain uid 0');
  }
  const subject = reviewSubject();
  // The reviewer ran and a record was written — that part of the answer is
  // settled and must survive. What fails is giving the claims back: the claim
  // directory is made unwritable from inside the one invocation, so the release
  // hits EACCES. Both scenarios must report the review truthfully, must not let
  // the cleanup error escape as the whole answer, and must not say RELEASED.
  const scenarios = [
    { label: 'per-run claim', seam: `require('fs').chmodSync(global.__runFile + '.launch.lock', 0o500);`,
      runLockExists: true, globalLockExists: false,
      lock: (runsDir, runId) => path.join(runsDir, `${runId}.json.launch.lock`) },
    { label: 'global review hold', seam: `require('fs').chmodSync(heldR.globalWorkerLockPath(), 0o500);`,
      runLockExists: false, globalLockExists: true,
      lock: (runsDir) => path.join(runsDir, '.global-worker.launch.lock') },
    // The generic release does not always throw. An unreadable owner record is
    // caught inside it and answered with false, so the claim survives while the
    // release reports failure — and a global release that then succeeds must
    // not turn that preserved claim into a RELEASED answer.
    { label: 'unreadable per-run owner record', seam: `{
        const seamFs = require('fs');
        const seamLock = global.__runFile + '.launch.lock';
        for (const seamOwner of seamFs.readdirSync(seamLock)) {
          seamFs.chmodSync(require('path').join(seamLock, seamOwner), 0o000);
        }
      }`,
      runLockExists: true, globalLockExists: false,
      lock: (runsDir, runId) => path.join(runsDir, `${runId}.json.launch.lock`) },
  ];
  for (const scenario of scenarios) {
    const fixture = reviewRequestFixture({
      seed: reviewRequestSeed(subject),
      responses: [...reviewRequestPreflight(subject, ['codex', 'grok']),
        ...reviewRequestPreflight(subject, ['codex', 'grok'])],
      requests: `[{ runId, reviewer: 'codex' }]`,
      adapter: `${scenario.seam}
        ${reviewRequestAdapterResult('RECORD_WRITTEN', 0, REVIEW_REQUEST_DRAINED)}`,
    });
    const out = reviewRequestOutcome(fixture.r);
    const answer = out.answers[0];
    assert.strictEqual(out.adapterRequests.length, 1, scenario.label);
    assert.strictEqual(answer.review, 'RECORD_WRITTEN',
      `${scenario.label}: a cleanup failure erased the review that did happen`);
    assert.strictEqual(answer.reviewProcess, 'DRAINED', scenario.label);
    assert.strictEqual(answer.reasonCode, 'REVIEW_RECORD_WRITTEN', scenario.label);
    assert.strictEqual(answer.admission, 'UNCONFIRMED',
      `${scenario.label}: a failed cleanup reported the claims as given back`);
    assert.strictEqual(out.runLockExists, scenario.runLockExists, scenario.label);
    assert.strictEqual(out.globalLockExists, scenario.globalLockExists, scenario.label);
    assertBoundedRequestFailure(out, scenario.label);
    const lockDir = scenario.lock(fixture.runsDir, fixture.runId);
    if (scenario.runLockExists) {
      assert.strictEqual(fs.readdirSync(lockDir).length, 1,
        `${scenario.label}: the per-run owner record did not survive the failed cleanup`);
    }
    fs.chmodSync(lockDir, 0o700);
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
  }
});

test('launch claim: live owner with unavailable identity observation fails closed and is preserved', () => {
  const worktree = fs.realpathSync(os.tmpdir());
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('WORKTREE_READY',
    { worktree: { path: worktree } }, `
    const fs = require('fs');
    const path = require('path');
    const lock = R.runPath(runId) + '.launch.lock';
    const claimId = 'fixture-unavailable-owner';
    const identity = { ...R.processIdentity(process.pid), pid: _sleeper.pid };
    fs.mkdirSync(lock, { mode: 0o700 });
    const owner = path.join(lock, claimId + '.json');
    const stored = { claimId, runId, pid: _sleeper.pid, processIdentity: identity,
      claimedAt: new Date().toISOString() };
    fs.writeFileSync(owner, JSON.stringify(stored), { mode: 0o600 });
    let out;
    try { R.startWorker(runId, { provider: 'claude-subscription', prompt: 'must not launch', model: 'opus' });
      out = { threw: false }; }
    catch (e) { out = { threw: true, code: e.code, httpStatus: e.httpStatus }; }
    finally { try { _sleeper.kill('SIGKILL'); } catch {} }
    console.log(JSON.stringify({ out, ownerExists: fs.existsSync(owner),
      identityProbesRefused: globalThis.__identityProbesRefused,
      existenceProbesObserved: globalThis.__existenceProbesObserved,
      stored: JSON.parse(fs.readFileSync(owner, 'utf8')) }));
  `, `
    const _fs = require('fs');
    const _path = require('path');
    const _childProcess = require('child_process');
    const _sleeper = _childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' });
    // This fixture must make identity observation unavailable while the owner
    // process stays positively alive. It previously matched command === 'ps',
    // but the runtime spawns the pinned inspector it resolved (/bin/ps or
    // /usr/bin/ps), never the bare name, so nothing was intercepted: the real
    // identity came back, disagreed with the forged record, and the claim was
    // reclaimed as a reused PID. Match the canonical inspector by basename, and
    // count the interceptions so a fixture that silently stops intercepting can
    // never pass as this proof again.
    globalThis.__identityProbesRefused = 0;
    globalThis.__existenceProbesObserved = 0;
    const _originalReadFileSync = _fs.readFileSync;
    _fs.readFileSync = function(file, ...args) {
      if (String(file) === '/proc/' + _sleeper.pid + '/stat') {
        globalThis.__identityProbesRefused++;
        const error = new Error('identity intentionally unavailable'); error.code = 'EACCES'; throw error;
      }
      return _originalReadFileSync.call(this, file, ...args);
    };
    const _originalSpawnSync = _childProcess.spawnSync;
    _childProcess.spawnSync = function(command, args, options) {
      const inspector = _path.basename(String(command)) === 'ps';
      const sleeperProbe = inspector && Array.isArray(args) &&
        args[0] === '-p' && args[1] === String(_sleeper.pid);
      // Identity fields only. The existence probe (-o pid=) is deliberately
      // left to the real inspector, so the owner reads as alive and the claim
      // must be preserved rather than reclaimed.
      if (sleeperProbe && args[3] !== 'pid=') {
        globalThis.__identityProbesRefused++;
        return { status: 1, stdout: '', stderr: '' };
      }
      if (sleeperProbe) globalThis.__existenceProbesObserved++;
      return _originalSpawnSync.call(this, command, args, options);
    };
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out.out, { threw: true, code: 'LAUNCH_IN_PROGRESS', httpStatus: 409 });
  assert.ok(out.identityProbesRefused > 0,
    'the fixture never intercepted an identity probe, so it proved nothing about unavailability');
  assert.ok(out.existenceProbesObserved > 0 || process.platform === 'linux',
    'the fixture never let a real existence probe through, so liveness was not observed');
  assert.strictEqual(out.ownerExists, true, 'unavailable identity observation removed the claim');
  assert.strictEqual(out.stored.claimId, 'fixture-unavailable-owner');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'WORKTREE_READY');
  assert.strictEqual(saved.build, null);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: an incomplete sibling publication cannot wedge the canonical claim', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 0 }, `
    const fs = require('fs');
    const lock = R.runPath(runId) + '.launch.lock';
    const orphan = lock + '.claim-2147483647-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.tmp';
    fs.mkdirSync(orphan, { mode: 0o700 });
    const out = R.retryRun(runId);
    console.log(JSON.stringify({ out, lockExists: fs.existsSync(lock), orphanExists: fs.existsSync(orphan) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.out.state, 'CORRECTING');
  assert.strictEqual(out.lockExists, false, 'the published claim was not released');
  assert.strictEqual(out.orphanExists, false,
    'a positively dead incomplete sibling publication was not safely collected');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: two stale-claim reclaimers cannot unlink the newly acquired owner', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 0 }, `
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    const lock = R.runPath(runId) + '.launch.lock';
    const staleClaimId = 'fixture-stale-owner';
    const identity = R.processIdentity(process.pid);
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, staleClaimId + '.json'), JSON.stringify({ claimId: staleClaimId,
      runId, pid: process.pid, processIdentity: { ...identity, startMarker: identity.startMarker + '-stale' },
      claimedAt: new Date().toISOString() }), { mode: 0o600 });
    const startAt = Date.now() + 300;
    const childSource = String.raw\`
      const childProcess = require('child_process');
      const originalSpawnSync = childProcess.spawnSync;
      childProcess.spawnSync = function(command, args, options) {
        if (Array.isArray(args) && args.some((arg) => /ledger-writer\\.cjs$/.test(String(arg)))) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);
        }
        return originalSpawnSync.call(this, command, args, options);
      };
      while (Date.now() < Number(process.env.AEGIS_RECLAIM_START_AT)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      const R = require(process.env.AEGIS_RECLAIM_CLI);
      try { console.log(JSON.stringify({ ok: true, value: R.retryRun(process.env.AEGIS_RECLAIM_RUN_ID) })); }
      catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, httpStatus: e.httpStatus })); }
    \`;
    const env = { ...process.env, AEGIS_RECLAIM_START_AT: String(startAt),
      AEGIS_RECLAIM_CLI: ${JSON.stringify(CLI)}, AEGIS_RECLAIM_RUN_ID: runId };
    const execute = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', childSource], { cwd: ${JSON.stringify(ROOT)}, env,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    Promise.all([execute(), execute()]).then((children) => {
      console.log(JSON.stringify({ children, lockExists: fs.existsSync(lock) }));
    });
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const child of out.children) assert.strictEqual(child.status, 0, child.stderr);
  const results = out.children.map((child) => JSON.parse(child.stdout.trim().split('\n').pop()));
  assert.strictEqual(results.filter((value) => value.ok).length, 1, JSON.stringify(results));
  const conflict = results.find((value) => !value.ok);
  assert.ok(conflict && ['LAUNCH_IN_PROGRESS', 'INVALID_RETRY'].includes(conflict.code),
    `second reclaimer did not fail closed: ${JSON.stringify(conflict)}`);
  assert.strictEqual(conflict.httpStatus, 409);
  assert.strictEqual(out.lockExists, false, 'the winning claim was not released cleanly');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CORRECTING');
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILD_FAILED' && t.to === 'CORRECTING').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((e) => e.operationId === `${runId}:BUILD_FAILED->CORRECTING`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('retryRun: two concurrent async retries reserve exactly one correction and one worker attempt', () => {
  const launchSpec = { provider: 'claude-subscription', prompt: 'bounded fixture retry', model: 'opus' };
  const priorBuild = { mode: 'async', attempt: 1, attemptId: '55555555-5555-4555-8555-555555555555',
    launchSpec, workerPid: null, workerState: 'BUILD_FAILED', revision: 2 };
  const worktree = fs.realpathSync(os.tmpdir());
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED',
    { corrections: 0, worktree: { path: worktree }, build: priorBuild }, `
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    const counter = path.join(${JSON.stringify(os.tmpdir())}, 'aegis-retry-launch-' + process.pid + '.txt');
    const startAt = Date.now() + 300;
    const childSource = String.raw\`
      const fs = require('fs');
      const Module = require('module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === './aegis-worker.cjs' || /aegis-worker\\.cjs$/.test(request)) {
          return {
            processAlive: () => false,
            normalizeLaunchSpec: (value) => Object.freeze({ ...value }),
            normalizeTimeoutSec: (value) => value === undefined ? 900 : Number(value),
            launchWorker: ({ launchSpec }) => {
              fs.appendFileSync(process.env.AEGIS_RETRY_COUNTER, process.pid + '\\n');
              return { workerPid: process.pid, processGroupId: process.pid,
                launchSha256: require('crypto').createHash('sha256').update(JSON.stringify(launchSpec)).digest('hex'),
                control: { dir: '/fixture/control-' + process.pid, secretSha256: 'fixture' } };
            },
          };
        }
        return originalLoad.apply(this, arguments);
      };
      while (Date.now() < Number(process.env.AEGIS_RETRY_START_AT)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      const R = require(process.env.AEGIS_RETRY_CLI);
      try { console.log(JSON.stringify({ ok: true, value: R.retryRun(process.env.AEGIS_RETRY_RUN_ID) })); }
      catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, httpStatus: e.httpStatus })); }
    \`;
    const childEnv = { ...process.env, NODE_ENV: 'test', AEGIS_RETRY_COUNTER: counter,
      AEGIS_RETRY_START_AT: String(startAt), AEGIS_RETRY_CLI: ${JSON.stringify(CLI)},
      AEGIS_RETRY_RUN_ID: runId };
    const execute = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', childSource], { cwd: ${JSON.stringify(ROOT)}, env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    Promise.all([execute(), execute()]).then((children) => {
      const launches = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').trim().split(/\\n/).filter(Boolean) : [];
      try { fs.unlinkSync(counter); } catch {}
      console.log(JSON.stringify({ children, launches }));
    });
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.children.length, 2);
  for (const child of out.children) assert.strictEqual(child.status, 0, child.stderr);
  const results = out.children.map((child) => JSON.parse(child.stdout.trim().split('\n').pop()));
  assert.strictEqual(results.filter((value) => value.ok).length, 1);
  const conflict = results.find((value) => !value.ok);
  assert.ok(conflict && ['INVALID_RETRY', 'LAUNCH_IN_PROGRESS'].includes(conflict.code),
    `second retry did not return a deterministic conflict: ${JSON.stringify(conflict)}`);
  assert.strictEqual(conflict.httpStatus, 409);
  assert.strictEqual(out.launches.length, 1, 'only one claimed retry may invoke the worker launcher');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILDING');
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(saved.build.attempt, 2);
  assert.match(saved.build.attemptId, /^[0-9a-f-]{36}$/);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILD_FAILED' && t.to === 'CORRECTING').length, 1);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'CORRECTING' && t.to === 'BUILDING').length, 1);
  const entries = ledgerEntriesFor(ledger, runId);
  assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:BUILD_FAILED->CORRECTING`).length, 1);
  assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:CORRECTING->BUILDING`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('retryRun uses one claim-aware launch path and never re-enters public startWorker', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const claimed = src.slice(src.indexOf('function startWorkerClaimed'), src.indexOf('/**\n * Launches the build', src.indexOf('function startWorkerClaimed')));
  const retry = src.slice(src.indexOf('function retryRun'), src.indexOf('// ── step 5', src.indexOf('function retryRun')));
  assert.doesNotMatch(claimed, /acquireRunLaunchClaim/);
  assert.match(retry, /acquireRunLaunchClaim/);
  assert.match(retry, /canonicalRetryLaunchSpec\(/);
  assert.match(retry, /validateWorkerLaunch\(/);
  assert.match(retry, /startValidatedWorkerClaimed\(/);
  assert.doesNotMatch(retry, /\bstartWorker\(/);
});

test('retryRun: refuses other states with INVALID_RETRY/409 and no mutation', () => {
  for (const state of ['CREATED', 'WORKTREE_READY', 'BUILDING', 'CHECKS_PASSED', 'ABANDONED']) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, null, `
      try {
        R.retryRun(runId);
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
      }
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, `retryRun must refuse ${state}`);
    assert.strictEqual(out.code, 'INVALID_RETRY');
    assert.strictEqual(out.httpStatus, 409);
    const files = fs.readdirSync(runsDir);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
    assert.strictEqual(saved.state, state, `retryRun must not mutate ${state}`);
    assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('retryRun: every retryable failure respects MAX_CORRECTIONS with no mutation', () => {
  for (const state of ['BUILD_FAILED', 'CHECKS_FAILED', 'REVIEW_FAILED']) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, { corrections: R.MAX_CORRECTIONS }, `
      try {
        R.retryRun(runId);
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
      }
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true);
    assert.strictEqual(out.code, 'CORRECTION_LIMIT');
    assert.strictEqual(out.httpStatus, 409);
    const files = fs.readdirSync(runsDir);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
    assert.strictEqual(saved.state, state, 'retryRun must not mutate a run at the correction limit');
    assert.strictEqual(saved.corrections, R.MAX_CORRECTIONS, 'retryRun must not increment corrections past the limit');
    assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('correction cap parity: synchronous cycles 1 through 3 are usable build cycles', () => {
  for (let correction = 1; correction <= R.MAX_CORRECTIONS; correction++) {
    const worktree = fs.realpathSync(os.tmpdir());
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CORRECTING',
      { corrections: correction, worktree: { path: worktree } }, `
        const child = require('child_process').spawnSync(process.execPath,
          [${JSON.stringify(CLI)}, '--build', runId, '--cmd', 'true'],
          { cwd: ${JSON.stringify(ROOT)}, encoding: 'utf8', env: process.env });
        console.log(JSON.stringify({ status: child.status, stderr: child.stderr }));
      `);
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.status, 0, `synchronous correction ${correction} was not usable: ${out.stderr}`);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILT');
    assert.strictEqual(saved.corrections, correction);
    assert.deepStrictEqual(ledgerEntriesFor(ledger, runId).map((entry) => entry.operationId), [
      `${runId}:CORRECTING->BUILDING`, `${runId}:BUILDING->BUILT`,
    ]);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('repeated correction transitions receive distinct exact ledger identities', () => {
  const seedFor = (runId) => ({
    corrections: 2,
    transitions: [
      { from: 'CORRECTING', to: 'BUILDING', ts: '2026-08-25T06:00:01Z',
        ledgerEntryId: 'LED-FIRST-BUILD', operationId: `${runId}:CORRECTING->BUILDING` },
      { from: 'BUILDING', to: 'BUILD_FAILED', ts: '2026-08-25T06:00:02Z',
        ledgerEntryId: 'LED-FIRST-FAIL', operationId: `${runId}:BUILDING->BUILD_FAILED` },
    ],
  });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CORRECTING', seedFor, `
    const fs = require('fs');
    fs.writeFileSync(process.env.AEGIS_LEDGER_FILE, JSON.stringify([
      { entryId: 'LED-FIRST-BUILD', correlationId: runId,
        operationId: runId + ':CORRECTING->BUILDING' },
      { entryId: 'LED-FIRST-FAIL', correlationId: runId,
        operationId: runId + ':BUILDING->BUILD_FAILED' },
    ], null, 2));
    const run = R.loadRun(runId);
    R.transition(run, 'BUILDING', 'second build');
    R.transition(run, 'BUILD_FAILED', 'second failure');
    const saved = R.loadRun(runId);
    const before = R.watchdog(saved).problems.filter((problem) =>
      problem.rule === 'WATCHDOG-UNRECORDED-TRANSITION').length;
    const entries = JSON.parse(fs.readFileSync(process.env.AEGIS_LEDGER_FILE, 'utf8'));
    entries.splice(2, 1);
    fs.writeFileSync(process.env.AEGIS_LEDGER_FILE, JSON.stringify(entries, null, 2));
    const after = R.watchdog(saved).problems.filter((problem) =>
      problem.rule === 'WATCHDOG-UNRECORDED-TRANSITION').length;
    console.log(JSON.stringify({ saved, before, after }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const saved = out.saved;
  const entries = ledgerEntriesFor(ledger, runId);
  assert.strictEqual(entries.length, 3);
  assert.deepStrictEqual(entries.map((entry) => entry.operationId), [
    `${runId}:CORRECTING->BUILDING`,
    `${runId}:BUILDING->BUILD_FAILED`,
    `${runId}:BUILDING->BUILD_FAILED:occurrence:2`,
  ]);
  assert.strictEqual(new Set(saved.transitions.map((transition) => transition.ledgerEntryId)).size, 4);
  assert.strictEqual(out.before, 0);
  assert.strictEqual(out.after, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('correction cap parity: asynchronous cycles 1 through 3 are usable build cycles', () => {
  for (let correction = 1; correction <= R.MAX_CORRECTIONS; correction++) {
    const worktree = fs.realpathSync(os.tmpdir());
    const workerPath = path.join(ROOT, 'builder-control', 'aegis-worker.cjs');
    const workerStub = `
      const workerPath = ${JSON.stringify(workerPath)};
      let workerLaunches = 0;
      require.cache[workerPath] = { id: workerPath, filename: workerPath, loaded: true, exports: {
        processAlive: () => false,
        normalizeLaunchSpec: (spec) => spec,
        normalizeTimeoutSec: (value) => value || 30,
        launchWorker: ({ launchSpec }) => {
          workerLaunches += 1;
          return { launchSha256: require('crypto').createHash('sha256').update(JSON.stringify(launchSpec)).digest('hex'),
            workerPid: process.pid, processGroupId: process.pid, control: { fixture: true } };
        },
      } };
    `;
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CORRECTING',
      { corrections: correction, worktree: { path: worktree } }, `
        const out = R.startWorker(runId,
          { provider: 'claude-subscription', model: 'opus', prompt: 'bounded correction fixture' },
          { timeoutSec: 30 });
        console.log(JSON.stringify({ out, workerLaunches }));
      `, workerStub);
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.workerLaunches, 1, `asynchronous correction ${correction} did not launch exactly once`);
    assert.strictEqual(out.out.state, 'BUILDING');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILDING');
    assert.strictEqual(saved.corrections, correction);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 1);
    assert.strictEqual(ledgerEntriesFor(ledger, runId)[0].operationId, `${runId}:CORRECTING->BUILDING`);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('correction cap parity: synchronous and asynchronous builders refuse only after cycle 3', () => {
  const worktree = fs.realpathSync(os.tmpdir());
  const marker = path.join(worktree, `aegis-cap-marker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const sync = withSeededRun('CORRECTING',
    { corrections: R.MAX_CORRECTIONS + 1, worktree: { path: worktree } }, `
      const child = require('child_process').spawnSync(process.execPath,
        [${JSON.stringify(CLI)}, '--build', runId, '--cmd', ${JSON.stringify(`touch ${marker}`)}],
        { cwd: ${JSON.stringify(ROOT)}, encoding: 'utf8', env: process.env });
      console.log(JSON.stringify({ status: child.status, stderr: child.stderr,
        markerExists: require('fs').existsSync(${JSON.stringify(marker)}) }));
    `);
  assert.strictEqual(sync.r.status, 0, sync.r.stderr);
  const syncOut = JSON.parse(sync.r.stdout.trim().split('\n').pop());
  assert.notStrictEqual(syncOut.status, 0);
  assert.match(syncOut.stderr, /CORRECTION-LIMIT/);
  assert.strictEqual(syncOut.markerExists, false, 'synchronous path executed work beyond the cap');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sync.runsDir, `${sync.runId}.json`), 'utf8')).state,
    'CORRECTING');
  assert.strictEqual(ledgerEntriesFor(sync.ledger, sync.runId).length, 0);
  fs.rmSync(sync.TMP, { recursive: true, force: true });

  const workerPath = path.join(ROOT, 'builder-control', 'aegis-worker.cjs');
  const async = withSeededRun('CORRECTING',
    { corrections: R.MAX_CORRECTIONS + 1, worktree: { path: worktree } }, `
      let out;
      try { R.startWorker(runId,
        { provider: 'claude-subscription', model: 'opus', prompt: 'must not launch' }, { timeoutSec: 30 });
        out = { threw: false }; }
      catch (error) { out = { threw: true, code: error.code, httpStatus: error.httpStatus }; }
      console.log(JSON.stringify({ out, workerLaunches }));
    `, `
      const workerPath = ${JSON.stringify(workerPath)};
      let workerLaunches = 0;
      require.cache[workerPath] = { id: workerPath, filename: workerPath, loaded: true, exports: {
        processAlive: () => false,
        normalizeLaunchSpec: (spec) => spec,
        normalizeTimeoutSec: (value) => value || 30,
        launchWorker: () => { workerLaunches += 1; throw new Error('must not launch'); },
      } };
    `);
  assert.strictEqual(async.r.status, 0, async.r.stderr);
  const asyncOut = JSON.parse(async.r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(asyncOut, {
    out: { threw: true, code: 'CORRECTION_LIMIT', httpStatus: 409 }, workerLaunches: 0,
  });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(async.runsDir, `${async.runId}.json`), 'utf8')).state,
    'CORRECTING');
  assert.strictEqual(ledgerEntriesFor(async.ledger, async.runId).length, 0);
  fs.rmSync(async.TMP, { recursive: true, force: true });
});

test('retryRun: asynchronous retries relaunch only through governed worker ownership and never run checks', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const retrySrc = src.slice(src.indexOf('function retryRun'), src.indexOf('// ── step 5'));
  assert.match(retrySrc, /startWorkerClaimed\(run, retryLaunchSpec\)/,
    'asynchronous retry must relaunch through the governed claimed worker path');
  assert.ok(!/spawnSync\('bash'/.test(retrySrc), 'retryRun must not spawn an ungoverned build command');
  assert.ok(!/cmdBuild|cmdChecks|cmdAuto/.test(retrySrc),
    'retryRun must not enter synchronous build commands or execute checks itself');
});

test('control functions: malformed and missing run ids map to stable AegisControlError', () => {
  assert.throws(() => R.pauseRun('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);
  assert.throws(() => R.cancelRun('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);
  assert.throws(() => R.retryRun('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);
  assert.throws(() => R.runChecks('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);
  assert.throws(() => R.bindIndependentReview('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);

  assert.throws(() => R.pauseRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.cancelRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.retryRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.runChecks('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.bindIndependentReview('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
});

test('check receipt: exact packet, subject, commands and digest validate', () => {
  const body = {
    schemaVersion: 1, authority: 'aegis-run.cjs runChecks', runId: 'RUN-20260828-deadbeef',
    packet: { path: 'builder-control/packets/example.json', sha256: 'a'.repeat(64) },
    subject: { subjectSha256: 'b'.repeat(64), subjectPaths: ['a.js', 'b.js'], diffBytes: 42, range: 'HEAD' },
    startedAt: '2026-08-28T00:00:00.000Z', completedAt: '2026-08-28T00:01:00.000Z',
    complete: true, outcome: 'PASS', total: 1, passed: 1,
    results: [{ cmd: 'node test.cjs', status: 'EXECUTED', exit: 0, ranAt: '2026-08-28T00:00:30.000Z' }],
  };
  const receipt = { ...body, receiptSha256: R.checkReceiptDigest(body) };
  assert.strictEqual(R.validateCheckReceipt(receipt, {
    runId: body.runId, packetPath: body.packet.path, packetSha256: body.packet.sha256,
    subject: body.subject, commands: ['node test.cjs'],
  }), true);
});

test('pre-host check receipt is a distinct exact-subject authority and never validates as final', () => {
  const runId = 'RUN-20260828-deadbeef';
  const checks = preHostChecksFor(runId);
  const receipt = checks.preHostReceipt;
  const expected = {
    runId,
    packetPath: receipt.packet.path,
    packetSha256: receipt.packet.sha256,
    subject: receipt.subject,
    commands: receipt.results.map((result) => result.cmd),
    hostCommands: receipt.hostContainment.commands,
    captureSha256: receipt.snapshot.captureSha256,
  };
  assert.strictEqual(R.validatePreHostCheckReceipt(receipt, expected), true);
  assert.strictEqual(R.validateCheckReceipt(receipt, expected), false,
    'pre-host evidence was accepted as a final host-bound receipt');
  for (const changed of [
    { subject: { ...expected.subject, subjectSha256: 'd'.repeat(64) } },
    { packetSha256: 'd'.repeat(64) },
    { captureSha256: 'd'.repeat(64) },
    { commands: ['node unrelated.test.cjs'] },
    { hostCommands: ['node unrelated-host.test.cjs'] },
  ]) {
    assert.strictEqual(R.validatePreHostCheckReceipt(receipt, { ...expected, ...changed }), false);
  }
});

test('host containment receipt: exact packet/subject, darwin, zero-skip and complete output are mandatory', () => {
  const runId = 'RUN-20260828-deadbeef';
  const packet = { path: 'builder-control/packets/example.json', sha256: 'a'.repeat(64) };
  const subject = {
    subjectSha256: 'b'.repeat(64), subjectPaths: ['a.js'], diffBytes: 42, range: 'HEAD',
  };
  const command = 'node builder-control/test/host-containment.test.cjs';
  const valid = passingHostContainmentReceipt(runId, packet, subject, command);
  const expected = { runId, packetPath: packet.path, packetSha256: packet.sha256,
    subject, command, platform: 'darwin' };
  assert.strictEqual(R.validateHostContainmentReceipt(valid, expected), true);
  const mutate = (change) => {
    const body = change({ ...valid, result: { ...valid.result } });
    delete body.receiptSha256;
    return { ...body, receiptSha256: R.hostContainmentReceiptDigest(body) };
  };
  const invalid = [
    mutate((receipt) => ({ ...receipt, packet: { ...receipt.packet, sha256: 'c'.repeat(64) } })),
    mutate((receipt) => ({ ...receipt, subject: { ...receipt.subject, subjectSha256: 'c'.repeat(64) } })),
    mutate((receipt) => ({ ...receipt, platform: 'linux' })),
    mutate((receipt) => ({ ...receipt, result: { ...receipt.result, exit: 1 } })),
    mutate((receipt) => ({ ...receipt, result: { ...receipt.result, outputTruncated: true } })),
    mutate((receipt) => ({ ...receipt, result: { ...receipt.result, skipped: 1, total: 129 } })),
    mutate((receipt) => { delete receipt.preHostReceiptRef; return receipt; }),
    mutate((receipt) => ({ ...receipt, preHostReceiptRef: {
      ...receipt.preHostReceiptRef, receiptSha256: 'z'.repeat(64),
    } })),
    mutate((receipt) => ({ ...receipt, coverage: receipt.coverage.slice(0, 1),
      result: { ...receipt.result, covered: 1, total: receipt.result.passed + 1 } })),
    mutate((receipt) => ({ ...receipt, coverage: receipt.coverage.map((item, index) =>
      index === 0 ? { ...item, command: 'node unrelated.test.cjs' } : item) })),
  ];
  for (const receipt of invalid) {
    assert.strictEqual(R.validateHostContainmentReceipt(receipt, expected), false);
  }
});

test('check receipt RED: A-to-B subject mutation, stale packet and partial execution are rejected', () => {
  const body = {
    schemaVersion: 1, authority: 'aegis-run.cjs runChecks', runId: 'RUN-20260828-deadbeef',
    packet: { path: 'builder-control/packets/example.json', sha256: 'a'.repeat(64) },
    subject: { subjectSha256: 'b'.repeat(64), subjectPaths: ['a.js'], diffBytes: 42, range: 'HEAD' },
    startedAt: '2026-08-28T00:00:00.000Z', completedAt: '2026-08-28T00:01:00.000Z',
    complete: true, outcome: 'PASS', total: 1, passed: 1,
    results: [{ cmd: 'node test.cjs', status: 'EXECUTED', exit: 0, ranAt: '2026-08-28T00:00:30.000Z' }],
  };
  const receipt = { ...body, receiptSha256: R.checkReceiptDigest(body) };
  assert.strictEqual(R.validateCheckReceipt(receipt, { subject: { ...body.subject, subjectSha256: 'c'.repeat(64) } }), false);
  assert.strictEqual(R.validateCheckReceipt(receipt, { packetSha256: 'd'.repeat(64) }), false);
  assert.strictEqual(R.validateCheckReceipt({ ...receipt, complete: false }), false);
  assert.strictEqual(R.validateCheckReceipt({ ...receipt, results: [] }), false);
  assert.strictEqual(R.validateCheckReceipt(receipt, {
    hostCommands: ['node builder-control/test/host-containment.test.cjs'],
  }), false, 'a missing mandatory host receipt was accepted');
});

test('checkpoint candidate accepts one clean descendant containing the exact reviewed subject', () => {
  const base = 'a'.repeat(40), head = 'b'.repeat(40);
  const subject = { subjectSha256: 'c'.repeat(64), subjectPaths: ['a.js'], diffBytes: 12, range: 'HEAD' };
  const committed = { ...subject, range: `${base}..${head}` };
  assert.strictEqual(R.checkpointCandidateProblem({
    clean: true, reviewedBase: base, head, ancestor: true,
    reviewedSubject: subject, committedSubject: committed,
  }), null);
});

test('checkpoint candidate RED: dirty tree, unrelated HEAD, or post-bind subject mutation are refused', () => {
  const base = 'a'.repeat(40), head = 'b'.repeat(40);
  const subject = { subjectSha256: 'c'.repeat(64), subjectPaths: ['a.js'], diffBytes: 12, range: 'HEAD' };
  const committed = { ...subject, range: `${base}..${head}` };
  assert.strictEqual(R.checkpointCandidateProblem({ clean: false }), 'CHECKPOINT-DIRTY-TREE');
  assert.strictEqual(R.checkpointCandidateProblem({ clean: true, reviewedBase: base, head, ancestor: false }), 'CHECKPOINT-HEAD-UNRELATED');
  assert.strictEqual(R.checkpointCandidateProblem({
    clean: true, reviewedBase: base, head, ancestor: true,
    reviewedSubject: subject, committedSubject: { ...committed, subjectSha256: 'd'.repeat(64) },
  }), 'CHECKPOINT-SUBJECT-MISMATCH');
});

// ── same-attempt timeout continuation ───────────────────────────────────────
// The gap these close: a synchronous builder SIGKILLed at its wall clock after
// it had already edited files leaves real work behind and an honest
// BUILD_FAILED, with no supported way to reconcile that attempt. Closing it
// badly is worse than leaving it open — a generic BUILD_FAILED -> BUILT edge, a
// fourth correction wearing a recovery name, or an operator asserting an
// outcome nobody executed. Every proof below aims at one of those three.

const CONTINUATION_SESSION = '7d96736d-2e94-4c80-b5d5-47a46b550a93';
const CONTINUATION_PREFIX = 'env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN';
const continuationCommand = (sessionId = CONTINUATION_SESSION, bound = 'gtimeout 900') =>
  `${CONTINUATION_PREFIX} ${bound} claude --resume ${sessionId} --print --dangerously-skip-permissions`;

const CONTINUATION_TIMED_OUT_BUILD = Object.freeze({
  cmd: 'env -u ANTHROPIC_API_KEY gtimeout 900 claude --model fable --print',
  startedAt: '2026-09-02T20:13:01.872Z', endedAt: '2026-09-02T20:28:01.885Z',
  exit: 124, stdoutTail: '', stderrTail: '',
});

// A disposable bin whose `claude` and `gtimeout` are shims, written by the
// driver itself before the authority is called. The authority then runs the
// real argv it composed, in the real worktree, and reacts to a real exit code —
// there is no injected executor, so "it executed the continuation itself" is
// proven rather than configured. The live model is never invoked.
const CONTINUATION_SHIM_SETUP = `
  const fs = require('fs');
  const path = require('path');
  const tmpRoot = path.dirname(process.env.AEGIS_RUNS_DIR);
  const bin = path.join(tmpRoot, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ['gtimeout', 'timeout']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\\nshift\\nexec "$@"\\n', { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, 'claude'),
    '#!/bin/sh\\n' +
    'printf "%s\\\\n" "$*" > "$AEGIS_TEST_CONTINUATION_ARGV"\\n' +
    'printf "%s\\\\n" "$PWD" > "$AEGIS_TEST_CONTINUATION_CWD"\\n' +
    'if [ -n "$ANTHROPIC_API_KEY" ] || [ -n "$ANTHROPIC_AUTH_TOKEN" ]; then echo LEAKED_CREDENTIAL; fi\\n' +
    'cat > "$AEGIS_TEST_CONTINUATION_STDIN"\\n' +
    'echo continuation stdout marker\\n' +
    'echo continuation stderr marker >&2\\n' +
    'exit "$AEGIS_TEST_CONTINUATION_EXIT"\\n', { mode: 0o755 });
  process.env.PATH = bin + ':' + process.env.PATH;
  process.env.ANTHROPIC_API_KEY = 'fixture-key-must-be-stripped';
  process.env.AEGIS_TEST_CONTINUATION_ARGV = path.join(tmpRoot, 'argv.txt');
  process.env.AEGIS_TEST_CONTINUATION_CWD = path.join(tmpRoot, 'cwd.txt');
  process.env.AEGIS_TEST_CONTINUATION_STDIN = path.join(tmpRoot, 'stdin.txt');
`;

function continuationDriver(body, { exitCode = 0, shims = true } = {}) {
  return `
    ${shims ? CONTINUATION_SHIM_SETUP : ''}
    ${shims ? `process.env.AEGIS_TEST_CONTINUATION_EXIT = ${JSON.stringify(String(exitCode))};` : ''}
    const report = (fn) => {
      try { console.log(JSON.stringify({ ok: true, result: fn() })); }
      catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, httpStatus: e.httpStatus, message: e.message })); }
    };
    ${body}
  `;
}

// Seeds the exact shape of the real case: BUILD_FAILED at corrections=3 with a
// synchronous attempt that exited 124, a real worktree, and the canonical
// intake packet coordinate the authority re-validates.
function withTimedOutSyncRun(driverBody, options = {}) {
  const worktree = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-continuation-wt-'));
  // The continuation verifies post-resume worktree changes against the packet
  // surface with git itself, so the fixture worktree is a real repository.
  for (const args of [['init', '--quiet'], ['config', 'user.email', 'aegis@test'],
    ['config', 'user.name', 'aegis-test']]) {
    const initialized = spawnSync('git', ['-C', worktree, ...args], { encoding: 'utf8' });
    assert.strictEqual(initialized.status, 0,
      `fixture worktree git ${args[0]} failed: ${initialized.stderr}`);
  }
  const packet = 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json';
  const bytes = fs.readFileSync(path.join(ROOT, packet));
  const seeded = withSeededRun(options.state || 'BUILD_FAILED', {
    packet,
    packetCoordinate: {
      path: packet,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      packetId: JSON.parse(bytes).packetId,
    },
    dataClass: 'INTERNAL',
    corrections: options.corrections === undefined ? 3 : options.corrections,
    worktree: { path: worktree, branch: 'aegis/fixture', createdAt: '2026-09-02T17:52:16.204Z' },
    build: 'build' in options ? options.build : { ...CONTINUATION_TIMED_OUT_BUILD },
  }, driverBody);
  return { ...seeded, worktree, cleanup: () => {
    fs.rmSync(seeded.TMP, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  } };
}

const continuationOutcome = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

const CONTINUE_CALL = (overrides = '') => `
  report(() => R.continueTimedOutBuild(runId, {
    sessionId: ${JSON.stringify(CONTINUATION_SESSION)},
    command: ${JSON.stringify(continuationCommand())},
    prompt: 'finish the interrupted edits',
    ${overrides}
  }));
`;

test('timeout continuation: executes the bounded same-session resume itself and reaches BUILT via BUILD_CONTINUED', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(CONTINUE_CALL(), { exitCode: 0 }));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, true, `continuation refused: ${out.code} ${out.message}`);
    assert.strictEqual(out.result.state, 'BUILT');
    assert.strictEqual(out.result.exit, 0);
    assert.strictEqual(out.result.action, 'continue-timeout');
    assert.strictEqual(out.result.sessionId, CONTINUATION_SESSION);

    // It ran the exact resume argv, in the run's own worktree, without the
    // API-key variables the command unsets.
    const argv = fs.readFileSync(path.join(fixture.TMP, 'argv.txt'), 'utf8').trim();
    assert.strictEqual(argv,
      `--resume ${CONTINUATION_SESSION} --print --dangerously-skip-permissions`);
    assert.strictEqual(fs.realpathSync(fs.readFileSync(path.join(fixture.TMP, 'cwd.txt'), 'utf8').trim()),
      fs.realpathSync(fixture.worktree));
    assert.strictEqual(fs.readFileSync(path.join(fixture.TMP, 'stdin.txt'), 'utf8'),
      'finish the interrupted edits');

    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILT');
    const reached = saved.transitions.map((t) => `${t.from}->${t.to}`);
    assert.deepStrictEqual(reached, ['BUILD_FAILED->BUILD_CONTINUED', 'BUILD_CONTINUED->BUILT'],
      'success must pass through the dedicated recovery state, not jump');
    assert.ok(!reached.some((edge) => edge.endsWith('->CORRECTING')),
      'a continuation must not record a correction cycle');
    const ledgerEdges = ledgerEntriesFor(fixture.ledger, fixture.runId).map((e) => e.operationId);
    assert.ok(ledgerEdges.includes(`${fixture.runId}:BUILD_FAILED->BUILD_CONTINUED`));
    assert.ok(ledgerEdges.includes(`${fixture.runId}:BUILD_CONTINUED->BUILT`));
  } finally { fixture.cleanup(); }
});

test('timeout continuation: the original timed-out build evidence is preserved verbatim and appended to', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(CONTINUE_CALL(), { exitCode: 0 }));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    assert.strictEqual(continuationOutcome(fixture.r).ok, true);
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    for (const key of ['cmd', 'startedAt', 'endedAt', 'exit', 'stdoutTail', 'stderrTail']) {
      assert.deepStrictEqual(saved.build[key], CONTINUATION_TIMED_OUT_BUILD[key],
        `the continuation rewrote the original build's ${key}`);
    }
    const c = saved.build.continuation;
    assert.strictEqual(c.type, 'AEGIS_TIMEOUT_CONTINUATION_V1');
    assert.strictEqual(c.status, 'EXECUTED');
    assert.strictEqual(c.exit, 0);
    assert.strictEqual(c.sessionId, CONTINUATION_SESSION);
    assert.strictEqual(c.timeoutSec, 900);
    assert.ok(/^2\d{3}-/.test(c.startedAt) && /^2\d{3}-/.test(c.endedAt),
      'the continuation must record its own startedAt and endedAt');
    assert.strictEqual(c.commandSha256,
      crypto.createHash('sha256').update(continuationCommand()).digest('hex'),
      'the continuation must record a command digest');
    assert.ok(!Object.prototype.hasOwnProperty.call(c, 'command') &&
      !Object.prototype.hasOwnProperty.call(c, 'prompt'),
      'only digests are recorded, never the raw command or prompt');
    assert.match(c.stdoutTail, /continuation stdout marker/);
    assert.match(c.stderrTail, /continuation stderr marker/);
    assert.ok(!/LEAKED_CREDENTIAL/.test(c.stdoutTail),
      'the continuation command must strip the API-key variables');
    assert.ok(c.stdoutTail.length <= 4096 && c.stderrTail.length <= 4096,
      'continuation output tails must be bounded');

    // The durable same-attempt identity is a pure function of the attempt's
    // immutable inputs — run, correction count, packet digest, worktree
    // identity, route and session — never of anything that happened at runtime.
    const packetBytes = fs.readFileSync(path.join(ROOT,
      'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json'));
    const expectedAttemptKey = crypto.createHash('sha256').update(JSON.stringify({
      type: 'AEGIS_TIMEOUT_CONTINUATION_V1',
      runId: fixture.runId,
      corrections: 3,
      packetSha256: crypto.createHash('sha256').update(packetBytes).digest('hex'),
      worktree: { path: fixture.worktree, branch: 'aegis/fixture' },
      route: null,
      sessionId: CONTINUATION_SESSION,
      commandSha256: c.commandSha256,
    })).digest('hex');
    assert.strictEqual(c.attemptKey, expectedAttemptKey,
      'the attempt key must be a deterministic digest of the attempt identity');

    // The supervision evidence that gates BUILT is recorded, not asserted.
    assert.strictEqual(c.boundary.state, 'PASSED');
    assert.strictEqual(c.boundary.drained, true);
    assert.strictEqual(c.containment.ok, true);
    assert.strictEqual(c.containment.verified, true);
    assert.strictEqual(c.timedOut, null);
    assert.ok(c.progress && c.progress.startedAt && c.progress.firstOutputAt && c.progress.lastOutputAt,
      'the supervisor must record progress timestamps');
    assert.strictEqual(c.executable, fs.realpathSync(path.join(fixture.TMP, 'bin', 'claude')),
      'the resolved executor path must be recorded as evidence');
    assert.ok(c.executor && Number.isInteger(c.executor.pid) && c.executor.processIdentity,
      'the executing authority must record its own provable process identity');
  } finally { fixture.cleanup(); }
});

test('timeout continuation: a successful continuation leaves corrections at 3 and is not a fourth cycle', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(CONTINUE_CALL(), { exitCode: 0 }));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, true, `continuation refused: ${out.code} ${out.message}`);
    assert.strictEqual(out.result.corrections, 3);
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.corrections, 3,
      'a continuation must never spend or reset a correction allowance');
    assert.strictEqual(saved.build.continuation.correctionsAtContinuation, 3);
  } finally { fixture.cleanup(); }
});

test('timeout continuation RED: an executed continuation that fails stays BUILD_FAILED and keeps its evidence', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(CONTINUE_CALL(), { exitCode: 7 }));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, true, `continuation refused: ${out.code} ${out.message}`);
    assert.strictEqual(out.result.state, 'BUILD_FAILED');
    assert.strictEqual(out.result.exit, 7);
    assert.strictEqual(out.result.nextAction, 'escalate');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILD_FAILED');
    assert.strictEqual(saved.corrections, 3);
    assert.strictEqual(saved.build.continuation.status, 'EXECUTED');
    assert.strictEqual(saved.build.continuation.exit, 7);
    assert.strictEqual(saved.build.exit, 124, 'the original timeout evidence must survive a failed continuation');
    assert.deepStrictEqual(saved.transitions.map((t) => `${t.from}->${t.to}`),
      ['BUILD_FAILED->BUILD_CONTINUED', 'BUILD_CONTINUED->BUILD_FAILED']);
  } finally { fixture.cleanup(); }
});

test('timeout continuation RED: a second continuation is refused without executing anything', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(`
    ${CONTINUE_CALL()}
    const fs2 = require('fs');
    fs2.unlinkSync(process.env.AEGIS_TEST_CONTINUATION_ARGV);
    ${CONTINUE_CALL()}
  `, { exitCode: 7 }));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const lines = fixture.r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(lines[0].ok, true, `first continuation refused: ${lines[0].message}`);
    assert.strictEqual(lines[1].ok, false);
    assert.strictEqual(lines[1].code, 'CONTINUATION_ALREADY_ATTEMPTED');
    assert.strictEqual(lines[1].httpStatus, 409);
    assert.strictEqual(fs.existsSync(path.join(fixture.TMP, 'argv.txt')), false,
      'the refused second continuation executed the resume anyway');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.build.continuation.exit, 7, 'the first continuation record was overwritten');
    assert.strictEqual(saved.transitions.length, 2, 'the refused attempt recorded a transition');
  } finally { fixture.cleanup(); }
});

test('timeout continuation: a leaked descendant fails the boundary and BUILT is refused despite exit 0', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(`
    fs.writeFileSync(path.join(bin, 'claude'),
      '#!/bin/sh\\ncat > /dev/null\\nsleep 30 &\\necho leaked descendant started\\nexit 0\\n',
      { mode: 0o755 });
    ${CONTINUE_CALL()}
  `));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, true, `continuation refused: ${out.code} ${out.message}`);
    assert.strictEqual(out.result.exit, 0);
    assert.strictEqual(out.result.state, 'BUILD_FAILED',
      'exit 0 with an undrained boundary must never be BUILT');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    const c = saved.build.continuation;
    assert.strictEqual(c.boundary.state, 'FAILED');
    assert.match(c.boundary.reason, /live descendant process group/);
    assert.strictEqual(c.boundary.drained, true,
      'the supervisor must actually drain the leaked descendant group, not just report it');
    assert.deepStrictEqual(saved.transitions.map((t) => `${t.from}->${t.to}`),
      ['BUILD_FAILED->BUILD_CONTINUED', 'BUILD_CONTINUED->BUILD_FAILED']);
    assert.strictEqual(saved.corrections, 3);
  } finally { fixture.cleanup(); }
});

test('timeout continuation: the supervisor cuts a silent resume at the idle bound', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(`
    process.env.AEGIS_TEST_CONTINUATION_IDLE_MS = '400';
    fs.writeFileSync(path.join(bin, 'claude'),
      '#!/bin/sh\\ncat > /dev/null\\nsleep 20\\nexit 0\\n', { mode: 0o755 });
    ${CONTINUE_CALL()}
  `));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, true, `continuation refused: ${out.code} ${out.message}`);
    assert.strictEqual(out.result.state, 'BUILD_FAILED');
    assert.strictEqual(out.result.exit, 124,
      'an interrupted continuation is recorded as the timeout it is, not invented as a failure code');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    const c = saved.build.continuation;
    assert.strictEqual(c.timedOut, 'IDLE');
    assert.match(c.boundary.reason, /idle bound/);
    assert.strictEqual(c.boundary.drained, true);
    assert.strictEqual(saved.build.exit, 124, 'the original timeout evidence must survive');
    assert.strictEqual(saved.corrections, 3);
  } finally { fixture.cleanup(); }
});

test('timeout continuation: the supervisor enforces the absolute bound even while output keeps flowing', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(`
    process.env.AEGIS_TEST_CONTINUATION_TIMEOUT_MS = '700';
    fs.writeFileSync(path.join(bin, 'claude'),
      '#!/bin/sh\\ncat > /dev/null\\ni=0\\nwhile [ $i -lt 100 ]; do echo tick; sleep 0.1; i=$((i+1)); done\\nexit 0\\n',
      { mode: 0o755 });
    ${CONTINUE_CALL()}
  `));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, true, `continuation refused: ${out.code} ${out.message}`);
    assert.strictEqual(out.result.state, 'BUILD_FAILED');
    assert.strictEqual(out.result.exit, 124);
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    const c = saved.build.continuation;
    assert.strictEqual(c.timedOut, 'ABSOLUTE');
    assert.strictEqual(c.boundary.drained, true);
    assert.ok(c.progress && c.progress.firstOutputAt && c.progress.lastOutputAt,
      'a producing child must leave progress timestamps even when the absolute bound cuts it');
  } finally { fixture.cleanup(); }
});

test('timeout continuation: a clean exit that leaves changes outside the packet surface is not BUILT', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(`
    const worktreePath = R.loadRun(runId).worktree.path;
    fs.writeFileSync(path.join(worktreePath, 'escaped-product-change.txt'), 'outside the packet surface\\n');
    ${CONTINUE_CALL()}
  `));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, true, `continuation refused: ${out.code} ${out.message}`);
    assert.strictEqual(out.result.exit, 0);
    assert.strictEqual(out.result.state, 'BUILD_FAILED',
      'a resume that escaped packet containment must not be BUILT');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    const c = saved.build.continuation;
    assert.strictEqual(c.boundary.state, 'PASSED');
    assert.strictEqual(c.containment.ok, false);
    assert.strictEqual(c.containment.verified, true);
    assert.deepStrictEqual(c.containment.outside, ['escaped-product-change.txt']);
    assert.deepStrictEqual(saved.transitions.map((t) => `${t.from}->${t.to}`),
      ['BUILD_FAILED->BUILD_CONTINUED', 'BUILD_CONTINUED->BUILD_FAILED']);
  } finally { fixture.cleanup(); }
});

// A continuation record that says STARTED with a proven-dead executor is a
// crashed executor: the run is reconciled to an honest BUILD_FAILED with the
// record preserved as INTERRUPTED, and the one-attempt bar stays consumed.
const SEED_INFLIGHT_CONTINUATION = (executorExpr) => `
  const cp = require('child_process');
  (async () => {
    const parked = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const parkedIdentity = R.processIdentity(parked.pid);
    parked.kill('SIGKILL');
    for (let i = 0; i < 200 && R.processExistence(parked.pid) !== 'absent'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const executor = ${executorExpr};
    const file = path.join(process.env.AEGIS_RUNS_DIR, runId + '.json');
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    run.state = 'BUILD_CONTINUED';
    run.build = { ...run.build, continuation: {
      type: 'AEGIS_TIMEOUT_CONTINUATION_V1', status: 'STARTED', attemptKey: 'b'.repeat(64),
      sessionId: ${JSON.stringify(CONTINUATION_SESSION)}, commandSha256: 'a'.repeat(64),
      timeoutSec: 900, promptSha256: null, correctionsAtContinuation: 3,
      executor, executable: '/tmp/claude',
      startedAt: '2026-09-02T21:00:00.000Z', endedAt: null, exit: null, stdoutTail: '', stderrTail: '',
    } };
    fs.writeFileSync(file, JSON.stringify(run, null, 2));
    report(() => R.continueTimedOutBuild(runId, {
      sessionId: ${JSON.stringify(CONTINUATION_SESSION)},
      command: ${JSON.stringify(continuationCommand())},
    }));
  })().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
`;

test('timeout continuation: a crashed executor is reconciled to BUILD_FAILED and never re-executed', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(
    SEED_INFLIGHT_CONTINUATION('{ pid: parked.pid, processIdentity: parkedIdentity }')));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.code, 'CONTINUATION_ALREADY_ATTEMPTED',
      'the crashed attempt keeps the one-continuation slot consumed');
    assert.strictEqual(fs.existsSync(path.join(fixture.TMP, 'argv.txt')), false,
      'reconciliation executed a resume');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILD_FAILED');
    assert.strictEqual(saved.build.continuation.status, 'INTERRUPTED');
    assert.strictEqual(saved.build.continuation.exit, null,
      'reconciliation must not invent an exit code nobody observed');
    assert.strictEqual(saved.build.exit, 124, 'the original timeout evidence must survive reconciliation');
    assert.strictEqual(saved.corrections, 3);
    assert.deepStrictEqual(saved.transitions.map((t) => `${t.from}->${t.to}`),
      ['BUILD_CONTINUED->BUILD_FAILED']);
  } finally { fixture.cleanup(); }
});

test('timeout continuation: a reused executor PID with a different process lifetime counts as crashed', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(SEED_INFLIGHT_CONTINUATION(
    '{ pid: process.pid, processIdentity: { ...R.processIdentity(process.pid), startMarker: "reused-pid-different-lifetime" } }')));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.code, 'CONTINUATION_ALREADY_ATTEMPTED');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILD_FAILED');
    assert.strictEqual(saved.build.continuation.status, 'INTERRUPTED');
  } finally { fixture.cleanup(); }
});

test('timeout continuation RED: a live matching executor blocks a second entry without touching the run', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(
    SEED_INFLIGHT_CONTINUATION('{ pid: process.pid, processIdentity: R.processIdentity(process.pid) }')));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.code, 'CONTINUATION_IN_PROGRESS',
      'a provably live executor must be left alone, not reconciled over');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILD_CONTINUED');
    assert.strictEqual(saved.build.continuation.status, 'STARTED');
    assert.strictEqual(fs.existsSync(path.join(fixture.TMP, 'argv.txt')), false);
  } finally { fixture.cleanup(); }
});

// One table for every precondition that must refuse BEFORE anything executes.
// Each case asserts the refusal code, that no state changed, that no ledger
// entry was written, and that the resume was never spawned.
for (const [name, code, options, callOverride] of [
  ['wrong state (BUILT, not BUILD_FAILED)', 'ILLEGAL_TRANSITION', { state: 'BUILT' }, null],
  ['wrong state (CHECKS_FAILED)', 'ILLEGAL_TRANSITION', { state: 'CHECKS_FAILED' }, null],
  ['non-timeout exit 1', 'NOT_A_TIMEOUT',
    { build: { ...CONTINUATION_TIMED_OUT_BUILD, exit: 1 } }, null],
  ['non-timeout exit 0', 'NOT_A_TIMEOUT',
    { build: { ...CONTINUATION_TIMED_OUT_BUILD, exit: 0 } }, null],
  ['no recorded build', 'NO_TIMED_OUT_BUILD', { build: null }, null],
  ['detached worker attempt, not a synchronous build', 'NOT_A_SYNCHRONOUS_BUILD',
    { build: { mode: 'async', attemptId: '55555555-5555-4555-8555-555555555555', exit: 124,
      cmd: 'ignored', startedAt: null, endedAt: null, stdoutTail: '', stderrTail: '' } }, null],
]) {
  test(`timeout continuation RED: ${name} is refused before execution`, () => {
    const fixture = withTimedOutSyncRun(
      continuationDriver(CONTINUE_CALL(callOverride || ''), { exitCode: 0 }), options);
    try {
      assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
      const out = continuationOutcome(fixture.r);
      assert.strictEqual(out.ok, false, `${name} was accepted`);
      assert.strictEqual(out.code, code);
      assert.strictEqual(out.httpStatus, 409);
      assert.strictEqual(fs.existsSync(path.join(fixture.TMP, 'argv.txt')), false,
        `${name} executed the resume before refusing`);
      const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
      assert.strictEqual(saved.state, options.state || 'BUILD_FAILED');
      assert.strictEqual(saved.corrections, 3);
      assert.deepStrictEqual(saved.transitions, []);
      assert.strictEqual(ledgerEntriesFor(fixture.ledger, fixture.runId).length, 0);
      assert.ok(!saved.build || saved.build.continuation === undefined,
        `${name} left a continuation record behind`);
    } finally { fixture.cleanup(); }
  });
}

// The command/session table. This is the trust boundary: the declared session
// must be a UUID, the command must resume that exact session, and it must be
// bounded. Nothing here may reach a spawn.
for (const [name, code, sessionId, command] of [
  ['malformed session id', 'INVALID_CONTINUATION_SESSION', 'not-a-uuid', continuationCommand()],
  ['uppercase non-canonical session id', 'INVALID_CONTINUATION_SESSION',
    CONTINUATION_SESSION.toUpperCase(), continuationCommand(CONTINUATION_SESSION.toUpperCase())],
  ['session id that does not match the command', 'CONTINUATION_SESSION_MISMATCH',
    CONTINUATION_SESSION, continuationCommand('11111111-2222-4333-8444-555555555555')],
  ['unbounded resume with no timeout', 'UNBOUNDED_CONTINUATION_COMMAND',
    CONTINUATION_SESSION, `${CONTINUATION_PREFIX} claude --resume ${CONTINUATION_SESSION} --print`],
  ['bound above the accepted ceiling', 'UNBOUNDED_CONTINUATION_COMMAND',
    CONTINUATION_SESSION, continuationCommand(CONTINUATION_SESSION, 'gtimeout 9999')],
  ['non-numeric bound', 'UNBOUNDED_CONTINUATION_COMMAND',
    CONTINUATION_SESSION, continuationCommand(CONTINUATION_SESSION, 'gtimeout none')],
  ['not a resume (fresh session)', 'NOT_A_RESUME_CONTINUATION',
    CONTINUATION_SESSION, `${CONTINUATION_PREFIX} gtimeout 900 claude --continue ${CONTINUATION_SESSION}`],
  ['metered execution with no key-stripping prefix', 'INVALID_CONTINUATION_COMMAND',
    CONTINUATION_SESSION, `gtimeout 900 claude --resume ${CONTINUATION_SESSION} --print`],
  ['caller-selected model', 'INVALID_CONTINUATION_COMMAND',
    CONTINUATION_SESSION, `${continuationCommand()} --model opus`],
  ['shell chaining', 'INVALID_CONTINUATION_COMMAND',
    CONTINUATION_SESSION, `${continuationCommand()}; rm -rf /`],
  ['shell redirect', 'INVALID_CONTINUATION_COMMAND',
    CONTINUATION_SESSION, `${continuationCommand()} < /etc/passwd`],
]) {
  test(`timeout continuation RED: ${name} is refused before execution`, () => {
    const fixture = withTimedOutSyncRun(continuationDriver(`
      report(() => R.continueTimedOutBuild(runId, {
        sessionId: ${JSON.stringify(sessionId)},
        command: ${JSON.stringify(command)},
      }));
    `, { exitCode: 0 }));
    try {
      assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
      const out = continuationOutcome(fixture.r);
      assert.strictEqual(out.ok, false, `${name} was accepted`);
      assert.strictEqual(out.code, code);
      assert.strictEqual(fs.existsSync(path.join(fixture.TMP, 'argv.txt')), false,
        `${name} executed the resume before refusing`);
      const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
      assert.strictEqual(saved.state, 'BUILD_FAILED');
      assert.deepStrictEqual(saved.transitions, []);
      assert.strictEqual(saved.build.continuation, undefined);
    } finally { fixture.cleanup(); }
  });
}

test('timeout continuation RED: the recovery edges are unreachable without the executing authority', () => {
  const fixture = withTimedOutSyncRun(continuationDriver(`
    // A caller with full module access, an already-BUILD_CONTINUED run, and a
    // hand-written "successful" continuation record still cannot take the edge.
    report(() => {
      const run = R.loadRun(runId);
      run.build = { ...run.build, continuation: {
        type: 'AEGIS_TIMEOUT_CONTINUATION_V1', status: 'EXECUTED',
        sessionId: ${JSON.stringify(CONTINUATION_SESSION)}, commandSha256: 'a'.repeat(64),
        timeoutSec: 900, startedAt: '2026-09-02T21:00:00Z', endedAt: '2026-09-02T21:05:00Z', exit: 0,
      } };
      R.saveRun(run);
      const codes = [];
      for (const to of ['BUILD_CONTINUED', 'BUILT']) {
        try { R.transition(R.loadRun(runId), to, 'asserted, not executed'); codes.push('NO-THROW:' + to); }
        catch (e) { codes.push(e.code); }
      }
      return codes;
    });
  `, { shims: false }));
  try {
    assert.strictEqual(fixture.r.status, 0, `driver failed: ${fixture.r.stderr}`);
    const out = continuationOutcome(fixture.r);
    assert.strictEqual(out.ok, true, `driver threw: ${out.message}`);
    assert.deepStrictEqual(out.result,
      ['CONTINUATION-AUTHORITY-REQUIRED', 'ILLEGAL-TRANSITION'],
      'a hand-written continuation record must not buy either recovery edge');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILD_FAILED');
  } finally { fixture.cleanup(); }
});

test('timeout continuation: opens no generic success edge and no correction bypass', () => {
  assert.ok(!R.STATES.BUILD_FAILED.next.includes('BUILT'),
    'BUILD_FAILED -> BUILT must remain impossible; recovery goes through BUILD_CONTINUED');
  assert.deepStrictEqual(R.STATES.BUILD_CONTINUED.next, ['BUILT', 'BUILD_FAILED', 'ABANDONED']);
  assert.ok(!R.STATES.BUILD_CONTINUED.next.includes('CORRECTING'),
    'the recovery state must not be a route into another correction cycle');
  assert.strictEqual(R.STATES.BUILD_CONTINUED.failure, undefined);
  assert.strictEqual(R.MAX_CORRECTIONS, 3, 'the correction cap must be unchanged');

  const src = fs.readFileSync(CLI, 'utf8');
  const authority = src.slice(src.indexOf('function continueTimedOutBuildClaimed'),
    src.indexOf('function cmdContinueTimeout'));
  assert.ok(!/corrections\s*(\+\+|\+=|-=|=(?!==))/.test(authority),
    'the continuation authority must never write run.corrections');
  assert.ok(!/'CORRECTING'/.test(authority),
    'the continuation authority must never enter CORRECTING');
  assert.match(authority, /runProcessGroupSupervisor\(\{/,
    'the authority must execute the continuation itself through the shared process-group supervisor');
  assert.match(authority, /idleTimeoutMs/,
    'the continuation must carry both an idle and an absolute bound into the supervisor');
  assert.ok(!/spawnSync\(/.test(authority),
    'the executing authority must not spawn the resume outside the supervisor');
  assert.ok(!/shell/.test(authority),
    'the continuation must never be executed through a shell');
  const declarationToClaim = src.slice(src.indexOf('function continueTimedOutBuild(runId'),
    src.indexOf('function cmdContinueTimeout'));
  assert.ok(declarationToClaim.indexOf('validatedContinuationDeclaration(') <
      declarationToClaim.indexOf('acquireGlobalWorkerClaim('),
    'the declaration must be validated before any global launch claim is taken');
});

test('timeout continuation: is CLI/internal only and is never exposed through dashboard HTTP', () => {
  const hosting = fs.readFileSync(path.join(ROOT, 'builder-control', 'hosting', 'server.cjs'), 'utf8');
  for (const token of ['continueTimedOutBuild', 'continue-timeout', 'BUILD_CONTINUED', 'sessionId']) {
    assert.ok(!hosting.includes(token),
      `the dashboard host references ${token}; browser input must never select a continuation`);
  }
  const Hosting = require('../hosting/server.cjs');
  assert.deepStrictEqual(Object.keys(Hosting.API_POST_ROUTES).sort(),
    ['/api/cancel', '/api/checks', '/api/objective', '/api/pause', '/api/retry',
      '/api/review-bind', '/api/start'],
    'the browser control surface gained or lost a route');
  // The browser body parser accepts exactly a runId, so even a new route could
  // not carry a session id or a command.
  for (const key of ['sessionId', 'session', 'command', 'continuation']) {
    assert.throws(() => Hosting.parseRunIdBody({ runId: 'RUN-20260902-5226737c', [key]: 'x' }),
      (e) => e.code === 'INVALID_REQUEST');
  }
  const src = fs.readFileSync(CLI, 'utf8');
  assert.match(src, /t === '--continue-timeout'/, 'the operator entry point must be the CLI');
});

if (REVIEW_ADMISSION_ONLY) {
  // A selector that silently dropped a renamed case would report a smaller
  // green subset, which is exactly the false comfort this switch must not buy.
  const missing = REVIEW_ADMISSION_CASES.filter((name) => !selectedReviewAdmissionCases.has(name));
  if (missing.length) {
    console.error(`FAIL review-admission selector: unmatched case names ${JSON.stringify(missing)}`);
    process.exitCode = 1;
  }
  console.log(`review-admission subset: ${REVIEW_ADMISSION_CASES.length} selected cases.`);
}
if (CHECKPOINT_ONLY) {
  // A selector that silently dropped a renamed case would report a smaller
  // green subset, which is exactly the false comfort this switch must not buy.
  const missing = CHECKPOINT_CASES.filter((name) => !selectedCheckpointCases.has(name));
  if (missing.length) {
    console.error(`FAIL checkpoint selector: unmatched case names ${JSON.stringify(missing)}`);
    process.exitCode = 1;
  }
  console.log(`checkpoint subset: ${CHECKPOINT_CASES.length} selected cases.`);
}
const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${skipped} skipped, ${failed} failed.`);
