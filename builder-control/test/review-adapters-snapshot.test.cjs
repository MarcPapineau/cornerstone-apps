#!/usr/bin/env node
'use strict';

// Immutable-snapshot-safe contracts for reviewer transport and drainage.
//
// This suite reads checked-in source and packet policy only. It deliberately
// never launches sandbox-exec, a reviewer/model, ps, a network listener, or any
// child process. Live process-group containment remains mandatory separate
// host evidence in review-adapters.test.cjs before the final gate.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ADAPTER_PATH = path.join(ROOT, 'builder-control', 'review-adapters.cjs');
const PACKET_PATH = path.join(
  ROOT,
  'builder-control',
  'packets',
  'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json',
);
const SNAPSHOT_COMMAND = 'node builder-control/test/review-adapters-snapshot.test.cjs';
const HOST_COMMAND = 'node builder-control/test/host-containment.test.cjs';
const source = fs.readFileSync(ADAPTER_PATH, 'utf8');
const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));

let passed = 0;
const failures = [];

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

process.stdout.write('AEGIS reviewer adapter — immutable snapshot contracts\n');

test('packet separates immutable contracts from one mandatory top-level behavioral proof', () => {
  assert.ok(packet.testsRequired.includes(SNAPSHOT_COMMAND));
  assert.ok(!packet.testsRequired.includes(HOST_COMMAND),
    'the host behavioral suite cannot nest its own sandbox inside the immutable boundary');
  assert.deepStrictEqual(packet.hostContainmentRequired, [HOST_COMMAND],
    'the canonical top-level host receipt requirement is absent or ambiguous');
  assert.ok(packet.filesAllowed.includes('builder-control/test/review-adapters-snapshot.test.cjs'));
  assert.ok(packet.filesAllowed.includes('builder-control/test/review-adapters.test.cjs'),
    'the separately mandatory host suite remains part of the exact reviewed subject');
  for (const requiredPath of [
    'builder-control/test/host-containment.test.cjs',
    'builder-control/test/review-adapters.test.cjs',
    'builder-control/test/aegis-run.test.cjs',
  ]) {
    assert.ok(packet.filesAllowed.includes(requiredPath), `${requiredPath} is outside filesAllowed`);
    assert.ok(packet.authorization.allowsProtectedPaths.includes(requiredPath),
      `${requiredPath} is outside protected-path authorization`);
  }
});

test('packet requires inherited immutable proof and separate top-level live OS containment evidence', () => {
  const constraints = packet.constraints.join('\n');
  assert.match(constraints,
    /execute `node builder-control\/test\/host-containment\.test\.cjs` once at the top-level macOS host boundary/i);
  assert.match(constraints, /bind its zero-skip receipt to this exact packet and subject/i);
  assert.match(constraints, /Missing, stale, wrong-subject, wrong-packet, non-macOS, nonzero, truncated, failed, or skipped/i);
  assert.match(constraints,
    /Live OS containment may be claimed only from the bound top-level host containment receipt/i);
});

test('reviewer watchdog launches one detached owned group with explicit non-inherited stdio', () => {
  const start = source.indexOf('function runContainedWithWatchdog(');
  const end = source.indexOf('async function runTool(', start);
  const watchdog = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(watchdog, /detached:\s*process\.platform\s*!==\s*'win32'/);
  assert.match(watchdog,
    /stdio:\s*\[hasStdinInput\s*\?\s*'pipe'\s*:\s*'ignore',\s*'pipe',\s*'pipe'\]/);
  assert.match(watchdog, /const ownedProcessGroupId = child\.pid/);
});

test('normal close requires a positive process-group member proof', () => {
  const start = source.indexOf('const proveClosedGroupDrain = async () => {');
  const end = source.indexOf('\n    const finish = async', start);
  const proof = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(proof, /listOwnedGroupMembers\('close-proof'\)/);
  assert.match(proof, /if \(members === null\) return false/);
  assert.match(proof, /if \(members\.length === 0\) return true/);
  assert.match(source,
    /if \(childClosed \|\| source === 'close'\) \{\s*drainageProvenBeforeClose = await proveClosedGroupDrain\(\)/);
  assert.match(source, /const groupDrained = drainageProvenBeforeClose/);
});

test('post-close PID reuse is a read-only refusal and never signalling authority', () => {
  const start = source.indexOf('const proveClosedGroupDrain = async () => {');
  const end = source.indexOf('\n    const finish = async', start);
  const proof = source.slice(start, end);
  assert.match(proof,
    /if \(members\.includes\(ownedProcessGroupId\)\) \{\s*recordReusedGroupRefusal\('close-proof'\);\s*return false/);
  assert.match(source, /code: 'PROCESS_GROUP_REUSED'/);
  assert.match(source, /signalling authority was relinquished/);
});

test('leaderless residual reviewers receive bounded TERM then KILL and cannot resolve before drain', () => {
  const start = source.indexOf('const proveClosedGroupDrain = async () => {');
  const end = source.indexOf('\n    const finish = async', start);
  const proof = source.slice(start, end);
  const term = proof.indexOf("signalClosedResidualGroup('SIGTERM'");
  const termDrain = proof.indexOf("waitForClosedGroupDrain('close-term-drain'", term);
  const kill = proof.indexOf("signalClosedResidualGroup('SIGKILL'", termDrain);
  const killDrain = proof.indexOf("waitForClosedGroupDrain('close-kill-drain'", kill);
  assert.ok(term >= 0 && termDrain > term && kill > termDrain && killDrain > kill,
    'closed residual group does not preserve TERM -> grace/drain -> KILL -> drain ordering');
  assert.match(proof, /terminationStarted = true/);
  assert.match(proof, /killGraceMs/);
});

test('undrained evidence is unusable and sandbox cleanup waits for proven drainage', () => {
  const start = source.indexOf('async function runTool(');
  const end = source.indexOf('function cmdRun(', start);
  const runTool = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(runTool, /if \(!r\.groupDrained\) \{\s*retainReviewSandbox = true/);
  assert.match(runTool, /await reapUndrainedReviewerGroup\(terminationEvidence, opts\.reaperOptions \|\| \{\}\)/);
  assert.match(runTool, /if \(reaper\.drained\) retainReviewSandbox = false/);
  assert.match(runTool, /cleanup: 'bounded-identity-bound-reaper'/);
  assert.match(runTool, /let retainReviewSandbox = false/);
  assert.match(runTool, /retainReviewSandbox = billingPreflight\.retainSandbox === true/);
  assert.match(runTool,
    /finally \{\s*if \(!retainReviewSandbox\) cleanupReviewSandbox\(sandbox\)/);
});

test('active review publication is downstream of signing and private validation', () => {
  const start = source.indexOf('function writeRecord(');
  const end = source.indexOf('\nfunction usage(', start);
  const publication = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const signAt = publication.indexOf("require('./review-sign.cjs').sign");
  const quarantineAt = publication.indexOf("fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-review-record-')");
  const validateAt = publication.indexOf('(opts.validateRecord || validateRecord)(quarantinePath)');
  const publishAt = publication.indexOf('fs.linkSync(quarantinePath, outPath)');
  assert.ok(signAt >= 0 && quarantineAt > signAt && validateAt > quarantineAt && publishAt > validateAt,
    'review publication is not ordered sign -> private quarantine -> validate -> active atomic link');
  assert.match(publication, /if \(incomplete\.length\)[\s\S]*return EXIT_BLOCK[\s\S]*let signed/);
});

test('mandatory host proof behaviorally exercises containment and publication boundaries', () => {
  const live = fs.readFileSync(path.join(ROOT, 'builder-control', 'test', 'review-adapters.test.cjs'), 'utf8');
  for (const proofName of [
    'RED: OS sandbox denies unrelated reads and non-allowlisted writes',
    'RED: bounded reviewer reads work through one outer sandbox while nested sandbox-exec is refused',
    'valid signed review passes the real validator before default active publication',
    'RED: a signed record rejected in quarantine leaves only non-gated diagnostic evidence',
    'RED: Grok 1.0.5 target_file receipts reject a returned sibling path and wrong digest bytes',
  ]) {
    assert.ok(live.includes(`test('${proofName}'`), `mandatory host behavior is missing: ${proofName}`);
  }
});

test('review launch resolves the canonical ledger receipt with the packet host requirement', () => {
  const start = source.indexOf('function resolveCanonicalCheckReceipt(');
  const end = source.indexOf('\nfunction evidenceBlock(', start);
  const resolver = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(resolver, /hostCommands = runnableHostContainmentChecks\(packet\)/);
  assert.match(resolver, /expectedRunId[\s\S]*runAuthority\.loadRun\(expectedRunId\)/);
  assert.match(resolver, /ambiguous canonical receipt coordinate[\s\S]*provide --run-id/);
  assert.match(resolver, /loadCanonicalCheckReceipt\(run\.checks, bound\)/);
  assert.match(resolver, /loadCanonicalPreHostCheckReceipt\(run\.checks, bound\)/);
  assert.match(resolver, /receiptType === 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1'/);
  assert.match(resolver, /hostContainment\.state === 'PENDING'/);
  assert.doesNotMatch(resolver, /run\.checks\.receipt/,
    'review launch still trusts mutable inline receipt bytes');
});

test('explicit run review uses the runtime-validated worktree for subject, diff, and copied bytes', () => {
  const contextStart = source.indexOf('function resolveCanonicalRunContext(');
  const contextEnd = source.indexOf('\nfunction subjectOf(', contextStart);
  const context = source.slice(contextStart, contextEnd);
  const commandStart = source.indexOf('async function cmdRun(');
  const commandEnd = source.indexOf('\nfunction usage(', commandStart);
  const command = source.slice(commandStart, commandEnd);
  assert.ok(contextStart >= 0 && contextEnd > contextStart && commandStart >= 0 && commandEnd > commandStart);
  assert.match(context, /runAuthority\.loadRun\(runId\)/);
  assert.match(context, /runAuthority\.canonicalGitEnvironment\(run\)/);
  assert.match(context, /suppliedPacket !== recordedPacket/);
  assert.match(context, /sourceRoot !== envWorktree/);
  assert.match(command, /resolveCanonicalRunContext\(args\.runId, args\.packet\)/);
  assert.match(command, /subjectOf\(args, runContext\)/);
  assert.match(command, /subjectDiff\(subject, args, runContext\)/);
  assert.match(command, /resolveBoundedReviewPaths\(subject, packet, runContext\.sourceRoot\)/);
  assert.match(command, /sourceRoot: runContext\.sourceRoot/);
  assert.match(command, /\{ runId: runContext\.runId \}/);
});

test('ACP billing correlates its two replies independently and bounds both retained streams', () => {
  const start = source.indexOf('function runGrokBillingAcp(');
  const end = source.indexOf('\nfunction validateGrokBillingEvidence(', start);
  const acp = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(acp, /message\.id === 2 \|\| message\.id === 3/);
  assert.doesNotMatch(acp, /expectedResponseId/);
  assert.match(acp, /GROK_BILLING_MAX_STREAM_BYTES - stdoutBytes/);
  assert.match(acp, /GROK_BILLING_MAX_STREAM_BYTES - stderrBytes/);
  assert.match(acp, /exceeded bounded stderr output/);
});

test('reviewer execution consumes the immutable authorized route bounds without a second policy read', () => {
  const start = source.indexOf('async function runTool(');
  const end = source.indexOf('\nasync function cmdRun(', start);
  const runTool = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(runTool, /const bounds = reviewer === 'codex' \? null : gateResult\.route\.bounds/);
  assert.doesNotMatch(runTool, /loadPolicy\(/,
    'runTool reloaded policy after the route had already been authorized');
});

test('Grok route and receipt describe post-run telemetry without claiming cap enforcement', () => {
  const contract = source.slice(source.indexOf('function grokSpendContract('),
    source.indexOf('// Only coverage objects', source.indexOf('function grokSpendContract(')));
  assert.match(contract, /authorizationScope:\s*'post-run-telemetry-only'/);
  assert.match(contract, /telemetryCeilingUsd:\s*cap/);
  assert.match(contract, /capEnforcement:\s*false/);
  assert.match(contract, /preRunSpendEnforced:\s*false/);
  assert.match(contract, /incrementalSpendEnforced:\s*false/);
  assert.doesNotMatch(contract, /capUsd:/);
});

test('platform omissions are explicit skips and async skip results are not counted as passes', () => {
  const live = fs.readFileSync(path.join(ROOT, 'builder-control', 'test', 'review-adapters.test.cjs'), 'utf8');
  assert.doesNotMatch(live, /process\.platform\s*[!=]==?\s*['"](?:darwin|win32)['"]\) return;/);
  assert.match(live, /if \(result && result\[SKIPPED\]\)[\s\S]*skipped\+\+/);
  assert.match(live, /\.then\(\(result\) => \{[\s\S]*result\[SKIPPED\][\s\S]*skipped\+\+/);
});

Promise.resolve().then(() => {
  if (failures.length) {
    process.stderr.write(`${passed}/${passed + failures.length} passed, ${failures.length} failed.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${passed} passed, 0 failed.\n`);
  }
});
