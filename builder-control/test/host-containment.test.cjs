#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { strictEnvironment } = require('../sandbox-containment.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const AGGREGATE_TIMEOUT_MS = 14 * 60_000;
const PER_SUITE_TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const CONTEXT_TYPE = 'AEGIS_HOST_PROOF_CONTEXT_V1';
const EVIDENCE_TYPE = 'AEGIS_HOST_PROOF_EVIDENCE_V1';
const EVIDENCE_PREFIX = `${EVIDENCE_TYPE}:`;
const BOUNDARY = 'AEGIS_TOP_LEVEL_HOST_CONTAINMENT_V1';
const PRE_HOST_COVERAGE_COMMANDS = Object.freeze([
  'node builder-control/test/functional-beta-snapshot.test.cjs',
  'node builder-control/test/dashboard-slice.test.cjs',
]);
const FIXED_PROBE_NAMES = Object.freeze([
  'deny-default-environment-self-test',
  'governed-worker-lifecycle',
  'governed-run-host-authority',
  'governed-review-adapter-boundary',
  'governed-http-control-path',
  'outer-boundary-fixed-probe',
]);
// Host tests receive only locale, fixed identity/PATH, and the disposable
// HOME/TMPDIR created by the trusted outer runner. Credentials, tokens and
// provider configuration from the operator process are never inherited.
const BASE_TEST_ENV = strictEnvironment({
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  USER: process.env.USER,
  LOGNAME: process.env.LOGNAME,
}, process.env);
const CONTAINED_TEST_ENV = Object.freeze({
  ...BASE_TEST_ENV,
  // Several existing fixtures spawn `node` by name. Bind that lookup to the
  // directory containing this already-running, absolute Node executable,
  // followed by the containment module's fixed system PATH.
  PATH: process.env.PATH,
  // Non-secret proof marker: child lifecycle tests may trust it only after
  // independently proving the deny-default boundary behavior.
  AEGIS_HOST_OUTER_CONTAINMENT: process.env.AEGIS_HOST_OUTER_CONTAINMENT,
  AEGIS_TEST_HOSTING_PORT: process.env.AEGIS_TEST_HOSTING_PORT,
  AEGIS_TEST_HOSTING_API_PORT: process.env.AEGIS_TEST_HOSTING_API_PORT,
  // The trusted process inspector coordinates come from the outer runner.
  // Contained probes revalidate them from scratch (path shape, ownership,
  // digest, deny-default read proof); without them, authenticated Start and
  // Cancel cannot prove process identity inside the deny-default boundary.
  ...(process.env.AEGIS_TRUSTED_PROCESS_INSPECTOR === undefined ? {} : {
    AEGIS_TRUSTED_PROCESS_INSPECTOR: process.env.AEGIS_TRUSTED_PROCESS_INSPECTOR,
  }),
  ...(process.env.AEGIS_TRUSTED_PROCESS_INSPECTOR_SHA256 === undefined ? {} : {
    AEGIS_TRUSTED_PROCESS_INSPECTOR_SHA256: process.env.AEGIS_TRUSTED_PROCESS_INSPECTOR_SHA256,
  }),
});

function governedWorkerLifecycleProbeSource() {
  const runtime = path.join(ROOT, 'builder-control', 'aegis-run.cjs');
  const worker = path.join(ROOT, 'builder-control', 'aegis-worker.cjs');
  return [
    "'use strict';",
    "const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');",
    `const runtimePath = ${JSON.stringify(runtime)}; const workerPath = ${JSON.stringify(worker)};`,
    "const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-host-worker-lifecycle-'));",
    "const runs = path.join(tmp, 'runs'); const worktree = path.join(tmp, 'worktree'); const bin = path.join(tmp, 'bin');",
    "const ledger = path.join(tmp, 'ledger.json'); fs.mkdirSync(runs); fs.mkdirSync(worktree); fs.mkdirSync(bin); fs.writeFileSync(ledger, '[]\\n');",
    "fs.writeFileSync(path.join(worktree, 'source.txt'), 'canonical\\n'); fs.writeFileSync(path.join(worktree, 'allowed.txt'), 'allowed\\n');",
    "fs.writeFileSync(path.join(worktree, 'check.cjs'), 'module.exports = true;\\n');",
    "const packet = path.join(worktree, 'packet.json'); fs.writeFileSync(packet, JSON.stringify({packetId:'PKT-HOST-WORKER-LIFECYCLE',agentId:'claude-code',sourceOfTruth:['source.txt'],filesAllowed:['allowed.txt'],testsRequired:['node check.cjs']}));",
    "const executable = path.join(bin, 'claude-fixture');",
    `fs.writeFileSync(executable, ${JSON.stringify(`#!${process.execPath}\n'use strict';\nconst delay = Number(process.env.FAKE_SLEEP_MS || 0);\nif (process.env.FAKE_EXIT_CODE) { console.error('fixture failure'); process.exit(Number(process.env.FAKE_EXIT_CODE)); }\nif (delay) setTimeout(() => process.exit(0), delay); else process.exit(0);\n`)}, {mode:0o755});`,
    "process.env.NODE_ENV = 'test'; process.env.AEGIS_TEST_CLAUDE_EXECUTABLE = executable; process.env.AEGIS_TEST_CONTAINMENT_MODE = 'DETERMINISTIC_PROFILE_ONLY';",
    "process.env.AEGIS_RUNS_DIR = runs; process.env.AEGIS_CHECKPOINTS_DIR = path.join(tmp, 'checkpoints'); process.env.AEGIS_LEDGER_FILE = ledger;",
    "const R = require(runtimePath); const W = require(workerPath); const groups = new Set();",
    "const waitFor = async (label, read, predicate, timeoutMs = 20000) => { if (typeof label !== 'string' || !label) throw new Error('waitFor requires a lifecycle stage label'); const deadline = Date.now() + timeoutMs; let last; while (Date.now() < deadline) { last = read(); if (predicate(last)) return last; await new Promise((resolve) => setTimeout(resolve,30)); } throw new Error('timed out waiting for canonical worker lifecycle evidence: ' + label + ' after ' + timeoutMs + 'ms; last observed ' + JSON.stringify(last)); };",
    "const seed = (runId, objective) => { const file = path.join(runs, runId + '.json'); fs.writeFileSync(file, JSON.stringify({runId,objective,state:'WORKTREE_READY',worktree:{path:worktree},packet,build:null,corrections:0,transitions:[],updatedAt:new Date().toISOString()},null,2)); return () => JSON.parse(fs.readFileSync(file,'utf8')); };",
    "const start = (runId, prompt) => { const result = R.startWorker(runId,{provider:'claude-subscription',prompt,model:'opus'},{timeoutSec:15}); groups.add(result.workerPid); return result; };",
    "(async () => { try {",
    "delete process.env.FAKE_EXIT_CODE; process.env.FAKE_SLEEP_MS = '1600'; const successRead = seed('RUN-20260830-10000001','host success lifecycle'); const successStart = start('RUN-20260830-10000001','host success lifecycle');",
    "const successRunning = await waitFor('success RUNNING heartbeat', successRead, (run) => run.state === 'BUILDING' && run.build && run.build.workerState === 'RUNNING' && run.build.heartbeatAt); const initialHeartbeat = successRunning.build.heartbeatAt;",
    "const success = await waitFor('success BUILT', successRead, (run) => run.state === 'BUILT'); assert.strictEqual(success.build.exit,0); assert.strictEqual(success.build.workerState,'EXITED'); assert.ok(Date.parse(success.build.heartbeatAt) > Date.parse(initialHeartbeat)); assert.strictEqual(success.transitions.some((t)=>t.from==='BUILDING'&&t.to==='BUILT'),true); await waitFor('success worker group drained', ()=>W.processGroupAlive(successStart.workerPid),(alive)=>alive===false);",
    "process.env.FAKE_SLEEP_MS = '0'; process.env.FAKE_EXIT_CODE = '7'; const failureRead = seed('RUN-20260830-10000002','host failed lifecycle'); const failureStart = start('RUN-20260830-10000002','host failed lifecycle'); const failed = await waitFor('failure BUILD_FAILED', failureRead,(run)=>run.state==='BUILD_FAILED'); assert.strictEqual(failed.build.exit,7); assert.strictEqual(failed.build.workerState,'FAILED'); assert.strictEqual(failed.transitions.some((t)=>t.from==='BUILDING'&&t.to==='BUILD_FAILED'),true); await waitFor('failure worker group drained', ()=>W.processGroupAlive(failureStart.workerPid),(alive)=>alive===false);",
    "delete process.env.FAKE_EXIT_CODE; process.env.FAKE_SLEEP_MS = '30000'; const cancelRead = seed('RUN-20260830-10000003','host cancel lifecycle'); const cancelStart = start('RUN-20260830-10000003','host cancel lifecycle'); const active = await waitFor('cancellation active child identity', cancelRead,(run)=>run.state==='BUILDING'&&run.build&&run.build.workerState==='RUNNING'&&run.build.control&&run.build.childProcessIdentity); const cancelled = R.cancelRun(active.runId); assert.strictEqual(cancelled.state,'ABANDONED'); const abandoned = cancelRead(); assert.strictEqual(abandoned.build.workerState,'TERMINATED'); assert.strictEqual(abandoned.build.terminationEvidence.terminated,true); assert.strictEqual(abandoned.build.terminationEvidence.childCloseObserved,true); assert.strictEqual(abandoned.build.terminationEvidence.processGroupDrained,true); await waitFor('cancellation worker group drained', ()=>W.processGroupAlive(cancelStart.workerPid),(alive)=>alive===false);",
    "console.log('18 passed, 0 skipped, 0 failed.');",
    "} finally { for (const group of groups) { if (W.processGroupAlive(group)) { try { process.kill(-group,'SIGKILL'); } catch {} } } for (const group of groups) { try { await waitFor('cleanup worker group drained', ()=>W.processGroupAlive(group),(alive)=>alive===false,2000); } catch {} } fs.rmSync(tmp,{recursive:true,force:true}); } })().catch((error)=>{ console.error(error.stack||error.message); process.exit(1); });",
  ].join('\n');
}

const suites = [
  {
    name: 'deny-default-environment-self-test',
    argv: ['-e', [
      // CoreFoundation injects its non-secret text-encoding hint on macOS even
      // when spawn receives an otherwise exact environment object.
      "const allowed = new Set(['HOME','TMPDIR','USER','LOGNAME','LANG','LC_ALL','LC_CTYPE','TERM','PATH','AEGIS_HOST_OUTER_CONTAINMENT','AEGIS_TEST_HOSTING_PORT','AEGIS_TEST_HOSTING_API_PORT','AEGIS_TRUSTED_PROCESS_INSPECTOR','AEGIS_TRUSTED_PROCESS_INSPECTOR_SHA256','__CF_USER_TEXT_ENCODING']);",
      "const unexpected = Object.keys(process.env).filter((key) => !allowed.has(key));",
      "if (unexpected.length) { console.error(unexpected.join(',')); process.exit(1); }",
      "console.log('1 passed, 0 skipped, 0 failed.');",
    ].join(' ')],
  },
  {
    name: 'governed-worker-lifecycle',
    argv: ['-e', governedWorkerLifecycleProbeSource()],
  },
  {
    name: 'governed-run-host-authority',
    argv: ['-e', [
      `const R = require(${JSON.stringify(path.join(ROOT, 'builder-control', 'aegis-run.cjs'))});`,
      "const identity = R.processIdentity(process.pid); if (!identity) throw new Error('current process identity unavailable');",
      "if (!R.sameProcessIdentity(identity, R.processIdentity(process.pid))) throw new Error('same process lifetime was not recognized');",
      "if (R.sameProcessIdentity(identity, { ...identity, startMarker: identity.startMarker + '-other' })) throw new Error('reused process identity was accepted');",
      "const pidOnly = { state: 'BUILDING', build: { mode: 'async', workerPid: process.pid } };",
      "if (R.workerCancellationCapability(pidOnly)) throw new Error('PID existence alone became cancellation authority');",
      "const bound = { state: 'BUILDING', build: { mode: 'async', workerPid: process.pid, control: { dir: process.env.TMPDIR }, childProcessIdentity: identity } };",
      "if (!R.workerCancellationCapability(bound)) throw new Error('identity-bound worker capability was not recognized');",
      "console.log('4 passed, 0 skipped, 0 failed.');",
    ].join(' ')],
  },
  {
    name: 'governed-review-adapter-boundary',
    argv: ['-e', [
      "const fs = require('fs'); const path = require('path');",
      `const A = require(${JSON.stringify(path.join(ROOT, 'builder-control', 'review-adapters.cjs'))});`,
      "(async () => {",
      "const sourceRoot = process.env.TMPDIR; const source = path.join(sourceRoot, 'host-review-subject.js');",
      "fs.writeFileSync(source, 'module.exports = true;\\n', { mode: 0o600, flag: 'wx' });",
      "let sandbox; try {",
      "sandbox = A.prepareReviewSandbox(['host-review-subject.js'], sourceRoot);",
      "const manifest = A.validateReviewManifestSnapshot(sandbox, 'host-proof', sourceRoot);",
      "if (!manifest.complete || manifest.checkedPaths.length !== 1) throw new Error('review manifest was not proven');",
      "const watched = await A.runContainedWithWatchdog({ bin: process.execPath, argv: ['-e', 'process.stdout.write(\\\"review-host-ok\\\")'] }, { cwd: sandbox.tmp, env: process.env, timeoutMs: 5000, maxOutputBytes: 4096 });",
      "if (watched.status !== 0 || watched.stdout !== 'review-host-ok') throw new Error('review watchdog did not complete its bounded child');",
      "} finally { if (sandbox) A.cleanupReviewSandbox(sandbox); try { fs.unlinkSync(source); } catch {} }",
      "console.log('2 passed, 0 skipped, 0 failed.');",
      "})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });",
    ].join(' ')],
  },
  {
    name: 'governed-http-control-path',
    argv: [path.join('builder-control', 'test', 'hosting.test.cjs'), '--host-only'],
  },
  {
    name: 'outer-boundary-fixed-probe',
    argv: ['-e', [
      "const fs = require('fs'); const net = require('net'); const path = require('path');",
      "const inside = path.join(process.env.TMPDIR, 'aegis-host-inside-' + process.pid);",
      "const outside = '/private/tmp/aegis-host-outside-' + process.pid;",
      "try { fs.writeFileSync(inside, 'inside'); if (fs.readFileSync(inside, 'utf8') !== 'inside') throw new Error('disposable write mismatch'); fs.unlinkSync(inside); } catch (error) { console.error('disposable boundary write failed: ' + error.message); process.exit(1); }",
      "try { fs.writeFileSync(outside, 'outside', { flag: 'wx' }); try { fs.unlinkSync(outside); } catch {} console.error('outside write unexpectedly succeeded'); process.exit(1); } catch (error) { if (!['EPERM','EACCES'].includes(error.code)) { console.error('outside write was not denied by containment: ' + error.code); process.exit(1); } }",
      "try { fs.readFileSync('/etc/hosts'); console.error('outside read unexpectedly succeeded'); process.exit(1); } catch (error) { if (!['EPERM','EACCES'].includes(error.code)) { console.error('outside read was not denied by containment: ' + error.code); process.exit(1); } }",
      "const socket = net.createConnection({ host: '1.1.1.1', port: 53 });",
      "let settled = false; const finish = (ok, detail) => { if (settled) return; settled = true; socket.destroy(); if (!ok) { console.error(detail); process.exit(1); } console.log('1 passed, 0 skipped, 0 failed.'); };",
      "socket.once('connect', () => finish(false, 'ambient network unexpectedly connected'));",
      "socket.once('error', (error) => finish(['EPERM','EACCES'].includes(error.code), 'ambient network was not denied by containment: ' + error.code));",
      "setTimeout(() => finish(false, 'ambient network denial did not fail closed'), 1500).unref();",
    ].join(' ')],
  },
];

let aggregatePassed = 0;
let aggregateFailed = 0;
const failureDiagnostics = [];

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadProofContext() {
  const boundaryRoot = path.dirname(ROOT);
  const expected = path.join(boundaryRoot, 'host-proof-context.json');
  const declared = process.env.AEGIS_HOST_PROOF_CONTEXT;
  const declaredSha = process.env.AEGIS_HOST_PROOF_CONTEXT_SHA256;
  if (process.env.AEGIS_HOST_OUTER_CONTAINMENT !== BOUNDARY || declared !== expected ||
      !/^[0-9a-f]{64}$/.test(declaredSha || '')) throw new Error('typed outer host-proof context is absent');
  const stat = fs.lstatSync(declared);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
      fs.realpathSync(declared) !== declared) throw new Error('outer host-proof context is not an immutable private regular file');
  const context = JSON.parse(fs.readFileSync(declared, 'utf8'));
  const body = { ...context };
  delete body.contextSha256;
  if (context.schemaVersion !== 1 || context.contextType !== CONTEXT_TYPE || context.boundary !== BOUNDARY ||
      context.contextSha256 !== declaredSha || sha256(stable(body)) !== declaredSha ||
      !context.preHostReceipt || !context.preHostReceiptRef ||
      context.preHostReceipt.receiptSha256 !== context.preHostReceiptRef.receiptSha256 ||
      !/^LED-CHECK-[0-9a-f]{32}$/.test(context.preHostReceiptRef.entryId || '') ||
      !/^[0-9a-f]{64}$/.test(context.preHostReceiptRef.receiptSha256 || '')) {
    throw new Error('outer host-proof context digest/reference validation failed');
  }
  const preHostBody = { ...context.preHostReceipt };
  delete preHostBody.receiptSha256;
  const preHost = context.preHostReceipt;
  if (preHost.receiptType !== 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1' || preHost.outcome !== 'PASS' ||
      preHost.complete !== true || !preHost.hostContainment || preHost.hostContainment.state !== 'PENDING' ||
      preHost.subject.subjectSha256 !== context.subject.subjectSha256 ||
      sha256(stable(preHostBody)) !== preHost.receiptSha256 ||
      !Array.isArray(preHost.results) || preHost.results.some((result) =>
        result.status !== 'EXECUTED' || result.exit !== 0)) {
    throw new Error('pre-host evidence is not one exact digest-bound PASS with host PENDING');
  }
  const byCommand = new Map(preHost.results.map((result) => [result.cmd, result]));
  if (stable(context.fixedProbeNames) !== stable(FIXED_PROBE_NAMES) ||
      !Array.isArray(context.preHostCommandCoverage) ||
      context.preHostCommandCoverage.length !== PRE_HOST_COVERAGE_COMMANDS.length) {
    throw new Error('host-proof context does not name the exact fixed probes and PRE_HOST commands');
  }
  const seenPreHost = new Set();
  for (const covered of context.preHostCommandCoverage) {
    const result = byCommand.get(covered.command);
    if (covered.suite !== 'pre-host-command' ||
        covered.coverage !== 'COVERED_BY_EXACT_PREHOST_COMMAND' ||
        !PRE_HOST_COVERAGE_COMMANDS.includes(covered.command) || seenPreHost.has(covered.command) ||
        !result || covered.evidenceSha256 !== sha256(stable(result))) {
      throw new Error(`host command coverage lacks one-to-one PRE_HOST evidence: ${covered.command || 'unknown'}`);
    }
    seenPreHost.add(covered.command);
  }
  if (stable([...seenPreHost]) !== stable(PRE_HOST_COVERAGE_COMMANDS)) {
    throw new Error('not every fixed PRE_HOST command has one-to-one evidence');
  }
  return context;
}

function boundedTail(value, lineLimit = 80) {
  return String(value || '').split(/\r?\n/).filter(Boolean).slice(-lineLimit).join('\n');
}

function relay(name, channel, value) {
  for (const line of String(value || '').split(/\r?\n/)) {
    if (line) process.stdout.write(`[${name} ${channel}] ${line}\n`);
  }
}

async function main() {
  const context = loadProofContext();
  const aggregateDeadline = Date.now() + AGGREGATE_TIMEOUT_MS;
  const executedSuites = [];
  for (const suite of suites) {
    const remainingMs = aggregateDeadline - Date.now();
    if (remainingMs <= 0) {
      aggregateFailed++;
      failureDiagnostics.push(`[host-containment] ${suite.name} was not launched because the aggregate deadline expired`);
      continue;
    }
    const result = spawnSync(process.execPath, suite.argv, {
      cwd: ROOT,
      env: CONTAINED_TEST_ENV,
      encoding: 'utf8',
      timeout: Math.min(PER_SUITE_TIMEOUT_MS, remainingMs),
      killSignal: 'SIGKILL',
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    relay(suite.name, 'stdout', result.stdout);
    relay(suite.name, 'stderr', result.stderr);
    const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim())
      .filter((line) => /^\d+ passed, \d+ skipped, (?:\d+|at least \d+) failed\.$/.test(line));
    const summary = lines.length === 1
      ? /^(\d+) passed, (\d+) skipped, (\d+) failed\.$/.exec(lines[0]) : null;
    const passed = summary ? Number(summary[1]) : 0;
    const skipped = summary ? Number(summary[2]) : 0;
    const failed = summary ? Number(summary[3]) : 1;
    const ok = !result.error && result.status === 0 &&
      lines.length === 1 && summary && passed > 0 && skipped === 0 && failed === 0;
    if (!ok) {
      aggregateFailed++;
      failureDiagnostics.push([
        `[host-containment] ${suite.name} bounded failure detail`,
        boundedTail(result.stdout),
        boundedTail(result.stderr),
        result.error ? String(result.error.message || result.error) : '',
      ].filter(Boolean).join('\n'));
      process.stderr.write(`[host-containment] ${suite.name} did not produce one drained zero-skip pass ` +
        `(exit ${result.status === null ? 'unknown' : result.status}; summaries ${lines.length})\n`);
    } else {
      aggregatePassed += passed;
      executedSuites.push(suite.name);
    }
  }

  for (const diagnostic of failureDiagnostics) process.stderr.write(`${diagnostic}\n`);
  if (aggregateFailed) process.exitCode = 1;
  if (!aggregateFailed) {
    const evidence = {
      schemaVersion: 1,
      evidenceType: EVIDENCE_TYPE,
      boundary: BOUNDARY,
      contextSha256: context.contextSha256,
      subjectSha256: context.subject.subjectSha256,
      preHostReceiptRef: context.preHostReceiptRef,
      executedSuites,
      coverage: context.preHostCommandCoverage.map(
        ({ suite, command, coverage, evidenceSha256 }) =>
          ({ suite, command, coverage, evidenceSha256 })),
    };
    console.log(`${EVIDENCE_PREFIX}${Buffer.from(JSON.stringify(evidence), 'utf8').toString('base64url')}`);
  }
  console.log(`${aggregatePassed} passed, 0 skipped, ${aggregateFailed ? 'at least 1' : '0'} failed.`);
}

main().catch((error) => {
  process.stderr.write(`[host-containment] supervisor failed closed: ${error.message}\n`);
  process.exitCode = 1;
});
