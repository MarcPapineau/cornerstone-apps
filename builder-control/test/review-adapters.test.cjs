#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const {
  detect,
  extractJson,
  extractGrokStreamingReview,
  grokReadReceiptCoverage,
  enforceGrokReadReceipts,
  reviewerProtocolText,
  stopWasAbnormal,
  validateCodexTerminalEnvelope,
  looksUnfinished,
  buildRecord,
  codexPrompt,
  grokPrompt,
  TOOLS,
  isUsableReview,
  validateReviewPayload,
  validateCodexInspectionProofs,
  codexCoveredPaths,
  eligiblePriorFindings,
  loadCurrentStateProofMap,
  isCurrentOpenReverificationTarget,
  runTool,
  runContainedWithWatchdog,
  reapUndrainedReviewerGroup,
  processGroupAlive,
  prepareReviewSandbox,
  validateReviewManifestSnapshot,
  cleanupReviewSandbox,
  reviewerEnvironment,
  validateGrokExecutableIdentity,
  runGrokBillingAcp,
  validateGrokBillingEvidence,
  grokBillingPreflight,
  grokSpendContract,
  buildCodexInput,
  evidenceBlock,
  authoritativeGrokSpend,
  createInvocationIdentity,
  writeImmutableFile,
  writeRecord,
  resolveCanonicalCheckReceipt,
  resolveCanonicalRunContext,
  resolveReviewDataClass,
  resolveBoundedReviewPaths,
  runnablePacketChecks,
  REVIEW_SANDBOX_PREFIX,
  MAX_REVIEW_FILES,
  MAX_REVIEW_BYTES,
  MAX_CODEX_BUNDLE_BYTES,
  MAX_CODEX_INPUT_BYTES,
  MAX_CODEX_INPUT_CHARACTERS,
  GROK_BILLING_MAX_STREAM_BYTES,
  GROK_EXPECTED_VERSION,
  GROK_EXPECTED_SHA256,
} = require('../review-adapters.cjs');
const { planSubjectGroups, checkCoverage, MAX_GROUP_BYTES } = require('../review-chunker.cjs');

let passed = 0;
let skipped = 0;
const pendingTests = [];
let asyncTestChain = Promise.resolve();
const SKIPPED = Symbol('skipped-test');
function skip(reason) { return { [SKIPPED]: true, reason: String(reason) }; }
function test(name, fn) {
  if (fn && fn.constructor && fn.constructor.name === 'AsyncFunction') {
    const queued = asyncTestChain
      .then(() => fn())
      .then((result) => {
        if (result && result[SKIPPED]) {
          skipped++;
          console.log(`skip ${name} — ${result.reason}`);
          return;
        }
        passed++;
        console.log(`ok   ${name}`);
      })
      .catch((e) => { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; });
    asyncTestChain = queued;
    pendingTests.push(queued);
    return;
  }
  try {
    const result = fn();
    if (result && result[SKIPPED]) {
      skipped++;
      console.log(`skip ${name} — ${result.reason}`);
      return;
    }
    if (result && typeof result.then === 'function') {
      pendingTests.push(Promise.resolve(result)
        .then((settled) => {
          if (settled && settled[SKIPPED]) {
            skipped++;
            console.log(`skip ${name} — ${settled.reason}`);
            return;
          }
          passed++;
          console.log(`ok   ${name}`);
        })
        .catch((e) => { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }));
      return;
    }
    passed++;
    console.log(`ok   ${name}`);
  }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

function proveInheritedImmutableCheckBoundary() {
  if (process.env.AEGIS_CHECK_SNAPSHOT_POLICY !== 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1') return null;
  const cwd = fs.realpathSync(process.cwd());
  const boundaryRoot = path.dirname(cwd);
  assert.strictEqual(path.basename(cwd), 'worktree',
    'immutable check policy was asserted outside its canonical worktree');
  assert.match(path.basename(boundaryRoot), /^aegis-check-boundary-/,
    'immutable check policy was asserted outside its disposable boundary');
  const common = spawnSync('git', [
    '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir',
  ], { encoding: 'utf8' });
  assert.strictEqual(common.status, 0, common.stderr);
  assert.strictEqual(fs.realpathSync(common.stdout.trim()), fs.realpathSync(path.join(cwd, '.git')),
    'immutable check worktree does not own an independent repository');
  assert.ok(fs.readFileSync(path.join(cwd, 'builder-control', 'review-adapters.cjs'), 'utf8').length > 0,
    'the exact copied subject is unreadable inside the immutable check boundary');
  assert.throws(() => fs.readFileSync('/private/etc/hosts'), (error) =>
    error && ['EPERM', 'EACCES'].includes(error.code),
  'the inherited immutable boundary can read a non-allowlisted host file');
  const childRead = spawnSync('/bin/cat', ['/private/etc/hosts'], { encoding: 'utf8' });
  assert.notStrictEqual(childRead.status, 0,
    'a child process escaped inherited immutable read containment');
  const deniedWrite = path.join('/private/tmp', `aegis-immutable-denied-${process.pid}`);
  assert.strictEqual(fs.existsSync(deniedWrite), false);
  assert.throws(() => fs.writeFileSync(deniedWrite, 'denied'), (error) =>
    error && ['EPERM', 'EACCES'].includes(error.code),
  'the inherited immutable boundary can write outside its disposable root');
  assert.strictEqual(fs.existsSync(deniedWrite), false);
  return Object.freeze({ cwd, boundaryRoot });
}

function reviewSandboxRoots() {
  const parent = path.dirname(REVIEW_SANDBOX_PREFIX);
  const prefix = path.basename(REVIEW_SANDBOX_PREFIX);
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(parent, entry.name))
    .sort();
}

function assertNoNewReviewSandbox(before, label) {
  const after = reviewSandboxRoots();
  const leaked = after.filter((value) => !before.includes(value));
  for (const root of leaked) {
    for (const rel of [path.join('home', '.grok', 'auth.json'), path.join('home', '.codex', 'auth.json')]) {
      assert.strictEqual(fs.existsSync(path.join(root, rel)), false, `${label}: copied auth survived at ${rel}`);
    }
  }
  assert.deepStrictEqual(after, before, `${label}: review sandbox root survived preparation failure`);
}

function assertAtomicPreparationFailure(label, action, expected) {
  const before = reviewSandboxRoots();
  assert.throws(action, expected);
  assertNoNewReviewSandbox(before, label);
}

const subject = {
  subjectSha256: 'a'.repeat(64),
  subjectPaths: ['src/app.ts'],
};
const base = {
  reviewer: 'codex',
  reviewerModel: 'test-model',
  packetId: 'PKT-test',
  subject,
  ts: '2026-08-23T04:00:00Z',
};

function codexEvidence(parsed, paths = subject.subjectPaths) {
  const inspectionProofs = paths.map((proofPath, index) => ({
    path: proofPath,
    lineNumber: index + 1,
    lineText: `proof:${proofPath}`,
  }));
  const inputDelivery = {
    complete: true,
    coveredPaths: paths.slice(),
    inspectionChallenges: inspectionProofs.map((proof) => ({
      path: proof.path,
      lineNumber: proof.lineNumber,
      lineSha256: crypto.createHash('sha256').update(proof.lineText).digest('hex'),
    })),
    inspectionChallengeSha256: 'c'.repeat(64),
  };
  const completeParsed = { ...parsed, inspectionProofs };
  return {
    parsed: completeParsed,
    inputDelivery,
    codexInspection: validateCodexInspectionProofs(completeParsed, inputDelivery),
  };
}

console.log('Engineering OS — review adapter fixtures');

test('doctor reports every configured role without claiming a review ran', () => {
  const d = detect();
  assert.deepStrictEqual(Object.keys(d).sort(), ['codex', 'copilot', 'grok']);
  for (const value of Object.values(d)) assert.ok(['AVAILABLE', 'UNAVAILABLE', 'UNVERIFIED'].includes(value.status));
});

test('balanced JSON is extracted through surrounding prose', () => {
  assert.deepStrictEqual(extractJson('before {"disposition":"APPROVE","findings":[]} after'), {
    disposition: 'APPROVE', findings: [],
  });
});

test('unparseable output becomes UNAVAILABLE, never APPROVE', () => {
  const record = buildRecord({ ...base, parsed: null, unavailableReason: 'no parseable output' });
  assert.strictEqual(record.disposition, 'UNAVAILABLE');
  assert.strictEqual(record.unavailableReason, 'no parseable output');
  assert.deepStrictEqual(record.findings, []);
});

test('RED: reviewer payload contract refuses missing, extra, and malformed fields', () => {
  const complete = { disposition: 'APPROVE', findings: [], unverified: [] };
  assert.strictEqual(validateReviewPayload(complete).ok, true);
  assert.strictEqual(validateReviewPayload({ disposition: 'APPROVE' }).ok, false);
  assert.strictEqual(validateReviewPayload({ disposition: 'APPROVE', unverified: [] }).ok, false);
  assert.strictEqual(validateReviewPayload({ disposition: 'APPROVE', findings: [] }).ok, false);
  assert.strictEqual(validateReviewPayload({ ...complete, commentary: 'looks good' }).ok, false);
  assert.strictEqual(validateReviewPayload({
    disposition: 'APPROVE_WITH_NOTES',
    findings: [{ severity: 'LOW', file: 'x.cjs', problem: 'p', evidence: 'e', status: 'OPEN' }],
    unverified: [],
  }).ok, false);
});

test('RED: severity controls blocking authority without rewriting a completed reviewer REJECT', () => {
  const low = {
    severity: 'LOW', file: 'x.cjs', location: '1', problem: 'p', evidence: 'e',
    impact: '', requiredCorrection: '', verificationMethod: '', status: 'OPEN',
  };
  const high = {
    severity: 'HIGH', file: 'x.cjs', location: '1', problem: 'p', evidence: 'e',
    impact: 'i', requiredCorrection: 'c', verificationMethod: 'v', status: 'OPEN',
  };
  assert.strictEqual(validateReviewPayload({
    disposition: 'APPROVE_WITH_NOTES', findings: [low], unverified: [],
  }).ok, true);
  assert.strictEqual(validateReviewPayload({
    disposition: 'REJECT', findings: [high], unverified: [],
  }).ok, true);
  assert.strictEqual(validateReviewPayload({
    disposition: 'APPROVE', findings: [low], unverified: [],
  }).ok, false);
  assert.strictEqual(validateReviewPayload({
    disposition: 'APPROVE_WITH_NOTES', findings: [high], unverified: [],
  }).ok, false);
  assert.strictEqual(validateReviewPayload({
    disposition: 'REJECT', findings: [low], unverified: [],
  }).ok, true);
  assert.strictEqual(validateReviewPayload({
    disposition: 'REJECT', findings: [], unverified: [],
  }).ok, true);
  assert.strictEqual(validateReviewPayload({
    disposition: 'APPROVE_WITH_NOTES', findings: [], unverified: [],
  }).ok, false);
});

test('RED: advisory and bare REJECT remain durable completed evidence', () => {
  const low = {
    severity: 'LOW', file: 'x.cjs', location: '1', problem: 'p', evidence: 'e',
    impact: '', requiredCorrection: '', verificationMethod: '', status: 'OPEN',
  };
  for (const parsed of [
    { disposition: 'REJECT', findings: [low], unverified: [] },
    { disposition: 'REJECT', findings: [], unverified: [] },
  ]) {
    const built = buildRecord({ ...base, ...codexEvidence(parsed) });
    assert.strictEqual(built.disposition, 'REJECT');
    assert.strictEqual(built.unavailableReason, undefined);
    assert.deepStrictEqual(built.findings, parsed.findings);
  }
});

test('RED: complete stdin delivery is not Codex inspection coverage without exact line proofs', () => {
  const parsed = { disposition: 'APPROVE', findings: [], unverified: [], inspectionProofs: [] };
  const delivered = {
    complete: true,
    coveredPaths: subject.subjectPaths,
    inspectionChallenges: [{ path: subject.subjectPaths[0], lineNumber: 7, lineSha256: 'a'.repeat(64) }],
    inspectionChallengeSha256: 'b'.repeat(64),
  };
  const missing = validateCodexInspectionProofs(parsed, delivered);
  assert.strictEqual(missing.complete, false);
  const forgedText = validateCodexInspectionProofs({
    ...parsed,
    inspectionProofs: [{ path: subject.subjectPaths[0], lineNumber: 7, lineText: 'wrong' }],
  }, delivered);
  assert.strictEqual(forgedText.complete, false);
  const real = codexEvidence({ disposition: 'APPROVE', findings: [], unverified: [] });
  assert.strictEqual(real.codexInspection.complete, true);
  const record = buildRecord({ ...base, ...real });
  assert.strictEqual(record.disposition, 'APPROVE');
  assert.deepStrictEqual(record.reviewOf.changedPaths, subject.subjectPaths);
});

test('a real reviewer approval binds to the exact subject', () => {
  const record = buildRecord({
    ...base,
    ...codexEvidence({ disposition: 'APPROVE', findings: [], unverified: [] }),
  });
  assert.strictEqual(record.disposition, 'APPROVE');
  assert.strictEqual(record.reviewOf.diffSha256, subject.subjectSha256);
  assert.deepStrictEqual(record.reviewOf.changedPaths, subject.subjectPaths);
});

test('GREEN: a normal adapter record can carry independent prior-finding re-verification', () => {
  // A re-verifiable prior finding is one the current-state proof map bound to
  // THIS subject and THIS check receipt and classified OPEN. Anything less is
  // history, and buildRecord refuses a PASS against history.
  const checkReceipt = { receiptSha256: 'f'.repeat(64) };
  const priorFindings = [{
    sourceReviewId: 'REV-prior-grok-001',
    findingIndex: 0,
    reviewer: 'grok',
    severity: 'HIGH',
    file: 'src/app.ts',
    problem: 'the stale branch can bypass the guard',
    verificationMethod: 'Run the guarded-branch regression test.',
    classification: 'OPEN',
    currentStateBinding: {
      subjectSha256: subject.subjectSha256,
      checkReceiptSha256: checkReceipt.receiptSha256,
    },
  }];
  const parsed = {
    disposition: 'APPROVE',
    findings: [],
    unverified: [],
    reverifiedFindings: [{
      sourceReviewId: 'REV-prior-grok-001',
      findingIndex: 0,
      verificationMethod: 'Run the guarded-branch regression test.',
      evidence: 'The independent guarded-branch regression test exited 0 on the corrected subject.',
      outcome: 'PASS',
    }],
  };
  const record = buildRecord({ ...base, checkReceipt, ...codexEvidence(parsed), priorFindings });
  assert.strictEqual(record.disposition, 'APPROVE');
  assert.deepStrictEqual(record.reverifiedFindings, parsed.reverifiedFindings);

  const sameReviewer = buildRecord({
    ...base,
    checkReceipt,
    ...codexEvidence(parsed),
    priorFindings: [{ ...priorFindings[0], reviewer: 'codex' }],
  });
  assert.strictEqual(sameReviewer.disposition, 'UNAVAILABLE');
  assert.match(sameReviewer.unavailableReason, /different reviewer/);
});

test('RED: Codex cannot claim changed paths from complete input delivery without verified inspection proofs', () => {
  const parsed = { disposition: 'APPROVE', findings: [], unverified: [] };
  const uncovered = buildRecord({ ...base, parsed });
  const partial = buildRecord({
    ...base,
    subject: { ...subject, subjectPaths: ['src/app.ts', 'src/other.ts'] },
    parsed,
    coveredPaths: ['src/app.ts'],
    inputDelivery: { complete: true },
  });
  const pathsWithoutAttestation = buildRecord({ ...base, parsed, coveredPaths: subject.subjectPaths });
  assert.deepStrictEqual(uncovered.reviewOf.changedPaths, []);
  assert.deepStrictEqual(partial.reviewOf.changedPaths, []);
  assert.deepStrictEqual(pathsWithoutAttestation.reviewOf.changedPaths, []);
});

test('RED: Grok cannot approve or claim changed paths without validated native-read coverage', () => {
  const record = buildRecord({
    ...base,
    reviewer: 'grok',
    reviewerModel: 'grok-test',
    parsed: { disposition: 'APPROVE', findings: [], unverified: [] },
  });
  assert.strictEqual(record.disposition, 'UNAVAILABLE');
  assert.deepStrictEqual(record.reviewOf.changedPaths, []);

  const forged = buildRecord({
    ...base,
    reviewer: 'grok',
    reviewerModel: 'grok-test',
    parsed: { disposition: 'APPROVE', findings: [], unverified: [] },
    readCoverage: {
      complete: true,
      terminalValid: true,
      verdictBeforeCoverage: false,
      manifestSha256: 'f'.repeat(64),
      expectedPaths: subject.subjectPaths,
      readPaths: subject.subjectPaths,
    },
  });
  assert.strictEqual(forged.disposition, 'UNAVAILABLE');
  assert.deepStrictEqual(forged.reviewOf.changedPaths, [],
    'a caller-authored complete:true object forged Grok path coverage');
});

test('unevidenced findings are discarded rather than becoming gate evidence', () => {
  const record = buildRecord({
    ...base,
    parsed: { disposition: 'REJECT', findings: [{ severity: 'HIGH', problem: 'guess', evidence: '' }] },
  });
  assert.deepStrictEqual(record.findings, []);
});

test('review prompts are bounded without transporting the large diff in argv', () => {
  const codex = codexPrompt('Build objective', subject, 'diff --git a b');
  const grok = grokPrompt('Build objective', subject, 'diff --git a b');
  for (const prompt of [codex, grok]) {
    assert.ok(prompt.includes('Build objective'));
    assert.ok(prompt.includes('src/app.ts'));
  }
  assert.ok(!grok.includes('diff --git a b'), 'Grok prompt placed the diff in argv');
  assert.ok(!codex.includes('diff --git a b'), 'Codex prompt duplicated the exact subject bundle');
  assert.match(codex, /diff text is deliberately not duplicated/i);
  assert.match(grok, /MANDATORY EVIDENCE SEQUENCE/);
  assert.match(grok, /invoke the Read tool for EVERY SUBJECT PATH/);
  assert.match(grok, /Do not emit a "pending"/);
  assert.match(codex, /preserves that completed reviewer opinion exactly as written/i);
  assert.match(codex, /does not gain blocking authority beyond the severities/i);
});

test('RED: prompt evidence preserves the complete deterministic receipt instead of declaration-only fields', () => {
  const receipt = {
    cmd: 'node focused-test.cjs',
    exit: 0,
    status: 'EXECUTED',
    outputSha256: 'b'.repeat(64),
    stdout: '80 passed, 0 failed',
    ranAt: '2026-08-29T01:00:00Z',
  };
  const block = evidenceBlock({ checks: [receipt] });
  assert.match(block, /DETERMINISTIC EVIDENCE \(executed receipts supplied for this subject\)/);
  for (const [key, value] of Object.entries(receipt)) {
    assert.ok(block.includes(JSON.stringify(key)), `check receipt key ${key} was discarded`);
    assert.ok(block.includes(typeof value === 'string' ? JSON.stringify(value) : String(value)),
      `check receipt value for ${key} was discarded`);
  }
});

test('RED: DECLARED_ONLY checks are separated from executed evidence without losing fields', () => {
  const declared = {
    cmd: 'node required-but-not-run.test.cjs',
    status: 'DECLARED_ONLY',
    note: 'No executed check receipt was supplied to this adapter context.',
    requirementId: 'REQ-17',
  };
  const block = evidenceBlock({ checks: [declared] });
  assert.doesNotMatch(block, /DETERMINISTIC EVIDENCE/);
  assert.match(block, /DECLARED CHECK REQUIREMENTS \(not executed evidence; no run receipt was supplied\)/);
  assert.doesNotMatch(block, /already executed against this subject/);
  for (const [key, value] of Object.entries(declared)) {
    assert.ok(block.includes(JSON.stringify(key)), `declared check key ${key} was discarded`);
    assert.ok(block.includes(JSON.stringify(value)), `declared check value for ${key} was discarded`);
  }
});

test('RED: mixed executed and declared checks render in truthful independent sections', () => {
  const executed = {
    cmd: 'node ran.test.cjs', exit: 0, status: 'EXECUTED',
    ranAt: '2026-08-29T01:00:00Z', stdout: 'PASS',
  };
  const declared = { cmd: 'node pending.test.cjs', status: 'DECLARED_ONLY' };
  const block = evidenceBlock({ checks: [declared, executed] });
  const executedHeading = block.indexOf('DETERMINISTIC EVIDENCE (executed receipts supplied for this subject)');
  const declaredHeading = block.indexOf('DECLARED CHECK REQUIREMENTS (not executed evidence; no run receipt was supplied)');
  assert.ok(executedHeading >= 0 && declaredHeading > executedHeading);
  assert.ok(block.indexOf('"cmd":"node ran.test.cjs"', executedHeading) < declaredHeading,
    'executed receipt was rendered under the declared-only section');
  assert.ok(block.indexOf('"cmd":"node pending.test.cjs"', declaredHeading) > declaredHeading,
    'declared-only requirement was rendered under executed evidence');
});

test('RED: only the explicit canonical executed receipt shape receives the executed label', () => {
  const baseReceipt = {
    status: 'EXECUTED',
    cmd: 'node canonical-check.test.cjs',
    exit: 0,
    ranAt: '2026-08-29T01:00:00Z',
  };
  const accepted = evidenceBlock({ checks: [baseReceipt] });
  assert.match(accepted, /DETERMINISTIC EVIDENCE \(executed receipts supplied for this subject\)/);
  assert.doesNotMatch(accepted, /NON-EXECUTED CHECK STATUS/);

  const refusedMatrix = [
    { ...baseReceipt, status: 'PENDING' },
    { ...baseReceipt, status: 'UNAVAILABLE' },
    { ...baseReceipt, status: 'REFUSED' },
    { ...baseReceipt, status: 'UNKNOWN' },
    { ...baseReceipt, status: undefined },
    { ...baseReceipt, cmd: '' },
    { ...baseReceipt, exit: null },
    { ...baseReceipt, exit: '0' },
    { ...baseReceipt, ranAt: '' },
    { ...baseReceipt, ranAt: 'not-a-timestamp' },
  ];
  for (const candidate of refusedMatrix) {
    const block = evidenceBlock({ checks: [candidate] });
    assert.doesNotMatch(block, /DETERMINISTIC EVIDENCE/,
      `non-receipt was labelled executed: ${JSON.stringify(candidate)}`);
    assert.match(block, /NON-EXECUTED CHECK STATUS \(not execution evidence; receipt shape is absent or incomplete\)/);
  }
});

// RED PROOF — the doctor must resolve the reviewers at their ABSOLUTE install
// paths. Neither tool puts itself on PATH here, so an earlier `command -v codex`
// check reported Codex as absent while it was installed all along. Reporting a
// present tool as missing is not a safe failure: it silently downgrades the
// review lane and makes the gate look satisfied by fewer reviewers.
test('doctor resolves Codex and Grok at their recorded absolute paths', () => {
  assert.strictEqual(TOOLS.codex.bin, '/Applications/ChatGPT.app/Contents/Resources/codex');
  assert.strictEqual(TOOLS.grok.bin, '/Users/marcpapineau/.grok/downloads/grok-macos-aarch64');

  const d = detect();
  for (const name of ['codex', 'grok']) {
    assert.ok(d[name], `doctor omitted ${name}`);
    assert.strictEqual(d[name].bin, TOOLS[name].bin, `${name} reported at the wrong path`);
    assert.ok(['AVAILABLE', 'UNAVAILABLE'].includes(d[name].status));
    // The status must agree with the filesystem — no optimism, no pessimism.
    const onDisk = fs.existsSync(TOOLS[name].bin);
    assert.strictEqual(d[name].status === 'AVAILABLE', onDisk,
      `${name}: doctor says ${d[name].status} but existsSync says ${onDisk}`);
    assert.ok(d[name].detail && d[name].detail.length > 0, `${name} has no detail`);
  }
});

// ── COPILOT: a LOCAL CLI, an UNVERIFIED entitlement, and no approval ──────
// This block replaces a proof that asserted "Copilot has no local binary and
// its capability sits behind a plan entitlement, therefore report UNVERIFIED".
// The first clause is now false — /opt/homebrew/bin/copilot is a real symlink
// to a real cask — and the test was failing against the corrected adapter.
// The clause that was RIGHT and must survive is the second one: install and
// login presence prove nothing about entitlement. So the two facts are now
// separated into two fields instead of being collapsed into one status, which
// is what let the old reading drift in the first place.
test('RED: Copilot is recognised as a LOCAL CLI at its recorded absolute path', () => {
  assert.strictEqual(TOOLS.copilot.bin, '/opt/homebrew/bin/copilot',
    'Copilot is installed locally; addressing it as a remote API brought back the false-absent bug');
  const d = detect();
  assert.ok(d.copilot, 'doctor omitted copilot');
  // Install status is filesystem truth in BOTH directions — no optimism when
  // it is missing, and no residual pessimism now that it is present.
  const onDisk = fs.existsSync(TOOLS.copilot.bin);
  assert.strictEqual(d.copilot.status === 'AVAILABLE', onDisk,
    `doctor says ${d.copilot.status} but existsSync says ${onDisk}`);
});

test('RED: entitlement is UNVERIFIED for EVERY worker, including installed ones', () => {
  const d = detect();
  for (const [name, r] of Object.entries(d)) {
    // The dangerous case is precisely the one that looks fine: present,
    // executable, logged in — and still not proof that a review may be run.
    assert.strictEqual(r.entitlement, 'UNVERIFIED',
      `${name} reports entitlement ${r.entitlement}; nothing this doctor observes can establish one`);
    assert.ok(r.entitlementReason && r.entitlementReason.length > 0,
      `${name} states no reason for an UNVERIFIED entitlement`);
    // Install presence must never be quietly promoted into an entitlement.
    assert.notStrictEqual(r.entitlement, r.status,
      `${name} lets install status stand in for entitlement`);
  }
});

test('RED: the doctor never claims a review ran, and never spends anything', () => {
  const d = detect();
  for (const [name, r] of Object.entries(d)) {
    assert.ok(!/\breview (ran|was run|completed|passed|approved)\b/i.test(r.detail),
      `${name}: the doctor described a review it did not perform`);
    assert.ok(/filesystem/i.test(r.observes),
      `${name}: the doctor must state that it observes the filesystem only`);
  }
  // The 2026-08-25 defect was a probe that REASONED: it ran a different tool,
  // found it authenticated, and derived a claim about a third thing. Check the
  // code, not the comment — the comment already says the right thing.
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  const from = src.indexOf('function detect(');
  const to = src.indexOf('function subjectOf(');
  assert.ok(from !== -1 && to > from, 'could not isolate the detection path');
  const detectionPath = src.slice(from, to)
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const forbidden of ['spawnSync', 'execSync', 'spawn(', 'exec(']) {
    assert.ok(!detectionPath.includes(forbidden),
      `the doctor launches a subprocess (${forbidden}) — a probe that runs something can spend credits and can be wrong in a direction nobody checks`);
  }
});

test('RED: internal validator subprocesses use the running Node executable, not PATH lookup', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  assert.ok(!src.includes("spawnSync('node'"),
    'contained execution removes Homebrew from PATH, so internal Node scripts must use process.execPath');
  assert.ok(src.includes('spawnSync(process.execPath, a,'),
    'subject resolution is not pinned to the running Node executable');
  assert.ok(src.includes("spawnSync(process.execPath, [ENGOS, '--validate-review'"),
    'review-record validation is not pinned to the running Node executable');
});

test('RED: Copilot is ADVISORY — refused as a gate reviewer even though the canon says AVAILABLE', () => {
  const { authorizeLaunch } = require('../review-adapters.cjs');
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  const t = (canon.tools || []).find((x) => x.toolId === 'copilot-cli');
  assert.ok(t, 'copilot-cli is not declared in the Tool Capability Canon');
  assert.strictEqual(t.approvalAuthority, 'NONE',
    'the canon must record that Copilot holds no approval authority');

  // The whole point: this refusal must NOT depend on the tool being broken,
  // missing or blocked. It is AVAILABLE, installed and executable here, and it
  // is still refused — because availability and authority are different
  // questions, and a working binary next to two reviewer binaries is exactly
  // what tempts someone to answer the second by looking at the first.
  assert.strictEqual(t.availability, 'AVAILABLE',
    'this proof is only meaningful while Copilot is genuinely available');
  assert.strictEqual(detect().copilot.status, 'AVAILABLE',
    'this proof is only meaningful while the Copilot binary is genuinely executable here');

  const r = authorizeLaunch('copilot');
  assert.strictEqual(r.ok, false, 'an AVAILABLE Copilot was authorised as a gate reviewer');
  assert.ok(/advisor/i.test(r.reason) && /approv/i.test(r.reason),
    `the refusal must name advisory status and the absence of approval authority, got: ${r.reason}`);
  assert.strictEqual(detect().copilot.advisoryOnly, true);
  assert.ok(/ADVISORY ONLY/.test(detect().copilot.detail),
    'the doctor line for an advisory worker must say so where an operator reads it');
});

test('RED: no launch argv exists for an advisory or unknown worker', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  // Falling through to Grok's argv would build a real, runnable command line
  // for a worker that must never be launched.
  assert.throws(() => buildToolArgv('copilot', 'P', null), /no launch argv/i,
    'Copilot silently inherited another reviewer\'s command line');
  assert.throws(() => buildToolArgv('nonesuch', 'P', null), /no launch argv/i);
});

// ── CODEX / GROK FAIL-CLOSED SEMANTICS ARE UNCHANGED ─────────────────────
// Adding a third worker must not loosen the two that gate anything. These
// assert the INVARIANT against whatever the canon currently says, rather than
// pinning a literal — pinning is how "declared in policy, enforced nowhere"
// passed a test suite once already.
test('RED: a reviewer that is not positively AVAILABLE in the canon is refused', () => {
  const { authorizeLaunch } = require('../review-adapters.cjs');
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  for (const [reviewer, toolId] of [['codex', 'codex-local'], ['grok', 'grok-cli']]) {
    const t = (canon.tools || []).find((x) => x.toolId === toolId);
    assert.ok(t, `${toolId} is not declared in the canon`);
    if (t.availability === 'AVAILABLE') continue; // covered by the evidence proof below
    const r = authorizeLaunch(reviewer);
    assert.strictEqual(r.ok, false,
      `${reviewer} is ${t.availability} in the canon and was authorised anyway`);
    assert.ok(new RegExp(t.availability).test(r.reason),
      `the refusal must name the canon state, got: ${r.reason}`);
  }
});

test('RED: an AVAILABLE reviewer still needs DATED evidence behind it', () => {
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  for (const toolId of ['codex-local', 'grok-cli', 'copilot-cli']) {
    const t = (canon.tools || []).find((x) => x.toolId === toolId);
    if (!t || t.availability !== 'AVAILABLE') continue;
    assert.ok(t.availabilityEvidence && t.availabilityEvidence.observedAt,
      `${toolId} is AVAILABLE with no dated evidence — AVAILABLE without a date is a claim, not an observation`);
    assert.ok(t.availabilityEvidence.method && t.availabilityEvidence.result,
      `${toolId} evidence names no method or result`);
  }
});

// The absolute-path constants are the contract. If someone "helpfully" changes
// them to a bare command name, PATH resolution comes back and the earlier
// false-absent bug returns.
test('reviewer binaries are addressed absolutely, never by bare command name', () => {
  for (const [name, t] of Object.entries(TOOLS)) {
    assert.ok(path.isAbsolute(t.bin), `${name} is not an absolute path: ${t.bin}`);
    assert.ok(t.role && t.label, `${name} is missing role/label`);
  }
});

// ── RED PROOF: declared bounds must be ENFORCED, not merely declared ───────
// This exists because of a real failure on 2026-08-24: MODEL-ROUTING-POLICY
// declared maxTurns:1 for the adversarial reviewer, the adapter never passed
// --max-turns, and a live run went 13 turns and returned no record. The policy
// read as governance and enforced nothing. Every bound the policy states must
// now appear on the actual command line.
test('RED: every declared Grok bound appears on the real command line', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  const bounds = require('../tool-router.cjs').loadPolicy().roles['adversarial-review'].bounds;
  const argv = buildToolArgv('grok', 'PROMPT', bounds, '/private/tmp/review-fixture');

  // Not pinned to a literal: the point of this proof is that WHATEVER the
  // policy declares reaches the command line. Hard-coding the number here is
  // what made this test pass while maxTurns:1 silently starved the reviewer.
  assert.ok(Number.isInteger(bounds.maxTurns) && bounds.maxTurns > 0,
    'the policy must declare a positive turn budget');
  const i = argv.indexOf('--max-turns');
  assert.ok(i !== -1, 'maxTurns is declared but --max-turns is not passed — declared-not-enforced');
  assert.strictEqual(argv[i + 1], String(bounds.maxTurns), '--max-turns must carry the policy value');

  assert.ok(argv.includes('--disable-web-search'), 'webAccess:false must disable web search');
  assert.ok(!argv.includes('--agents'), 'subagents:false is expressed by omitting --agents entirely');
  assert.ok(argv.includes('-p'), 'must run in single-turn print mode');
  for (const forbidden of ['--always-approve', '--permission-mode']) {
    assert.ok(!argv.includes(forbidden), `${forbidden} must never be passed to a read-only reviewer`);
  }
  assert.match(bounds.boundsNote, /do not enforce a spend ceiling/);
  assert.match(bounds.boundsNote, /fresh, execution-bound ACP proof.*every spend vector at zero/);
  assert.match(bounds.boundsNote, /post-run telemetry ceiling/);
  assert.match(bounds.boundsNote, /no pre-run or incremental enforcement/);
  assert.doesNotMatch(bounds.boundsNote, /Spend is bounded by capUsd|Cost is controlled by capUsd/i);
  assert.match(bounds.maxTurnsPurpose, /runaway guard only.*not a cost control/i);
});

test('RED: a tightened policy bound propagates to the command line', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  const argv = buildToolArgv('grok', 'P', { maxTurns: 3, webAccess: false, subagents: false }, '/private/tmp/review-fixture');
  assert.strictEqual(argv[argv.indexOf('--max-turns') + 1], '3',
    'the adapter must read the bound from the policy, not hardcode it');
});

test('RED: Codex relies on the exact outer OS sandbox instead of nesting sandbox-exec', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  const argv = buildToolArgv('codex', 'P', null);
  assert.ok(argv.includes('--dangerously-bypass-approvals-and-sandbox'),
    'an externally contained Codex reviewer must not start a second macOS sandbox');
  assert.ok(!argv.includes('--sandbox'),
    'nested Codex sandbox-exec fails with sandbox_apply: Operation not permitted');
  assert.strictEqual(argv.at(-1), '-', 'Codex must receive its complete initial input through stdin');
  assert.ok(!argv.includes('P'), 'the Codex prompt must not be exposed as a single argv item');
  assert.ok(argv.includes('--json'), 'Codex must emit its documented JSONL event protocol');
});

test('RED: Codex review is isolated from interactive config and persisted sessions', () => {
  const { buildToolArgv, REVIEW_SANDBOX_PREFIX } = require('../review-adapters.cjs');
  const argv = buildToolArgv('codex', 'P', null);
  for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules']) {
    assert.ok(argv.includes(flag), `Codex review is missing ${flag}`);
  }
  assert.ok(!argv.includes(path.resolve(__dirname, '..', '..')),
    'Codex review must not receive the repository as its working root');
  assert.ok(REVIEW_SANDBOX_PREFIX.startsWith(require('os').tmpdir()));
});

test('RED: Codex disables every model-issued shell route inside external containment', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  const argv = buildToolArgv('codex', 'P', null);
  const disabled = argv.flatMap((value, index) => value === '--disable' ? [argv[index + 1]] : []);
  assert.deepStrictEqual(disabled, ['shell_snapshot', 'shell_tool', 'unified_exec']);
  for (const feature of disabled) {
    assert.ok(!argv.includes(`${feature}=true`), `${feature} was disabled and re-enabled`);
  }
});

function parseExactCodexBundle(input, expectedByPath) {
  assert.ok(expectedByPath instanceof Map, 'independent expected path map is required');
  const begin = Buffer.from('<<<AEGIS_CODEX_EXACT_BUNDLE_V1_BEGIN>>>\n');
  const all = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  const start = all.indexOf(begin);
  assert.ok(start >= 0, 'bundle begin missing');
  assert.strictEqual(all.indexOf(begin, start + 1), -1, 'duplicate bundle begin');
  const buffer = all.subarray(start);
  let offset = begin.length;
  const line = () => {
    const end = buffer.indexOf(0x0a, offset);
    assert.ok(end >= 0, 'unterminated framing line');
    const value = buffer.subarray(offset, end).toString('utf8');
    offset = end + 1;
    return value;
  };
  const expectBytes = (value) => {
    const expected = Buffer.from(value, 'utf8');
    assert.ok(buffer.subarray(offset, offset + expected.length).equals(expected), `expected ${JSON.stringify(value)}`);
    offset += expected.length;
  };
  const manifestBytes = Number(line().match(/^MANIFEST_BYTES (\d+)$/)?.[1]);
  const manifestSha = line().match(/^MANIFEST_SHA256 ([a-f0-9]{64})$/)?.[1];
  assert.strictEqual(line(), '<<<AEGIS_CODEX_MANIFEST_BEGIN>>>');
  const manifestRaw = buffer.subarray(offset, offset + manifestBytes);
  offset += manifestBytes;
  assert.strictEqual(crypto.createHash('sha256').update(manifestRaw).digest('hex'), manifestSha);
  expectBytes('\n<<<AEGIS_CODEX_MANIFEST_END>>>\n');
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  assert.ok(Array.isArray(manifest), 'manifest must be an array');
  const manifestPaths = manifest.map((entry) => entry.path);
  assert.strictEqual(new Set(manifestPaths).size, manifestPaths.length, 'duplicate manifest path');
  assert.deepStrictEqual(manifestPaths.slice().sort(), [...expectedByPath.keys()].sort(),
    'manifest path set differs from independent expected set');
  const contents = [];
  manifest.forEach((entry, index) => {
    const expected = expectedByPath.get(entry.path);
    assert.ok(Buffer.isBuffer(expected), `no independent bytes for ${entry.path}`);
    assert.strictEqual(entry.bytes, expected.length, `manifest byte count differs for ${entry.path}`);
    assert.strictEqual(entry.sha256, crypto.createHash('sha256').update(expected).digest('hex'),
      `manifest digest differs for ${entry.path}`);
    assert.strictEqual(line(), `<<<AEGIS_CODEX_FILE_${index}_BEGIN_${entry.sha256}>>>`);
    assert.strictEqual(line(), `PATH ${JSON.stringify(entry.path)}`);
    assert.strictEqual(line(), `BYTES ${entry.bytes}`);
    assert.strictEqual(line(), `LINES ${entry.lines}`);
    assert.strictEqual(line(), `SHA256 ${entry.sha256}`);
    assert.strictEqual(line(), 'CONTENT_BEGIN');
    const content = buffer.subarray(offset, offset + entry.bytes);
    offset += entry.bytes;
    assert.strictEqual(crypto.createHash('sha256').update(content).digest('hex'), entry.sha256);
    assert.ok(content.equals(expected), `framed bytes differ from independent source for ${entry.path}`);
    expectBytes(`\nCONTENT_END\n<<<AEGIS_CODEX_FILE_${index}_END_${entry.sha256}>>>\n`);
    contents.push(content);
  });
  assert.strictEqual(line(), '<<<AEGIS_CODEX_EXACT_BUNDLE_V1_END>>>');
  assert.strictEqual(offset, buffer.length, 'trailing or duplicate frame bytes');
  return { manifest, contents };
}

test('RED: Codex exact stdin bundle deterministically covers every copied subject and pinned spec byte', () => {
  const reviewPaths = [
    'builder-control/MODEL-ROUTING-POLICY.json',
    'builder-control/TOOL-CAPABILITY-CANON.json',
  ];
  const sandbox = prepareReviewSandbox(reviewPaths);
  try {
    const first = buildCodexInput('EXACT TEST PROMPT', sandbox, reviewPaths);
    const second = buildCodexInput('EXACT TEST PROMPT', sandbox, reviewPaths);
    assert.ok(first.input.startsWith('EXACT TEST PROMPT\n\n<<<AEGIS_CODEX_INSPECTION_CHALLENGES_V1_BEGIN>>>'));
    assert.ok(first.input.endsWith('<<<AEGIS_CODEX_EXACT_BUNDLE_V1_END>>>\n'));
    assert.deepStrictEqual(first.inputDelivery.coveredPaths, reviewPaths.slice().sort());
    assert.deepStrictEqual(first.inputDelivery.manifest.map((entry) => entry.path), reviewPaths.slice().sort());
    assert.ok(first.inputDelivery.manifest.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
    assert.ok(first.inputDelivery.inspectionChallenges.every((challenge) =>
      typeof challenge.linePrefix === 'string' && challenge.linePrefix.length > 0));
    assert.strictEqual(first.inputDelivery.inputBytes, first.inputBuffer.length);
    assert.strictEqual(first.inputDelivery.inputSha256,
      crypto.createHash('sha256').update(first.inputBuffer).digest('hex'));
    assert.strictEqual(first.input, second.input);
    assert.deepStrictEqual(first.inputDelivery, second.inputDelivery);
    const expectedByPath = new Map(reviewPaths.map((rel) => [rel, fs.readFileSync(path.join(sandbox.cwd, rel))]));
    const independentlyParsed = parseExactCodexBundle(first.inputBuffer, expectedByPath);
    assert.deepStrictEqual(independentlyParsed.manifest, first.inputDelivery.manifest);
    for (const entry of first.inputDelivery.manifest) {
      const exact = fs.readFileSync(path.join(sandbox.cwd, entry.path));
      assert.ok(first.inputBuffer.includes(exact), `stdin bundle omitted exact bytes for ${entry.path}`);
      assert.match(first.input, new RegExp(`SHA256 ${entry.sha256}`));
    }
    const proofPayload = {
      disposition: 'APPROVE', findings: [], unverified: [],
      inspectionProofs: first.inputDelivery.inspectionChallenges.map((challenge) => ({
        path: challenge.path,
        lineNumber: challenge.lineNumber,
        lineText: fs.readFileSync(path.join(sandbox.cwd, challenge.path), 'utf8')
          .split(/\r\n|\n|\r/)[challenge.lineNumber - 1],
      })),
    };
    assert.strictEqual(validateCodexInspectionProofs(proofPayload, first.inputDelivery).complete, true,
      'a response copied from the exact challenged lines did not prove bounded inspection');
    assert.ok(first.inputDelivery.bundleBytes <= MAX_CODEX_BUNDLE_BYTES);
    assert.ok(first.inputDelivery.inputBytes <= MAX_CODEX_INPUT_BYTES);
  } finally {
    cleanupReviewSandbox(sandbox);
  }
});

test('RED: direct Codex input carries one exact subject copy instead of duplicating diff text', () => {
  const reviewPaths = ['builder-control/TOOL-CAPABILITY-CANON.json'];
  const sandbox = prepareReviewSandbox(reviewPaths);
  const sentinel = 'AEGIS_DUPLICATION_SENTINEL_' + crypto.randomBytes(8).toString('hex');
  try {
    const prompt = codexPrompt('Review exact bytes', {
      subjectPaths: reviewPaths, subjectSha256: 'a'.repeat(64), range: 'HEAD', diffBytes: sentinel.length,
    }, sentinel, {});
    assert.ok(!prompt.includes(sentinel), 'diff bytes remained embedded in the Codex prompt');
    const built = buildCodexInput(prompt, sandbox, reviewPaths);
    const exact = fs.readFileSync(path.join(sandbox.cwd, reviewPaths[0]));
    assert.ok(built.inputBuffer.includes(exact), 'authoritative exact file bundle was lost');
    assert.strictEqual(built.input.split(sentinel).length - 1, 0,
      'diff sentinel entered direct Codex input outside the exact file bundle');
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: independent framing rejects empty-path tricks, duplicate frames, swaps, and substring lookalikes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bundle-parser-'));
  const cwd = path.join(root, 'work');
  fs.mkdirSync(cwd);
  const fixtures = [
    ['empty.txt', ''],
    ['substring.txt', 'text <<<AEGIS_CODEX_FILE_0_BEGIN_deadbeef>>> remains ordinary content'],
    ['swap.txt', 'third'],
  ];
  const manifest = fixtures.map(([rel, content]) => {
    const bytes = Buffer.from(content);
    fs.writeFileSync(path.join(cwd, rel), bytes);
    return { path: rel, bytes: bytes.length, lines: content ? 1 : 0,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  const expectedByPath = new Map(fixtures.map(([rel, content]) => [rel, Buffer.from(content)]));
  try {
    const built = buildCodexInput('P', { cwd, manifest }, fixtures.map(([rel]) => rel));
    const parsed = parseExactCodexBundle(built.inputBuffer, expectedByPath);
    assert.strictEqual(parsed.contents[0].length, 0);
    assert.match(parsed.contents[1].toString(), /BEGIN_deadbeef/);
    const bundle = built.input.slice(built.input.indexOf('<<<AEGIS_CODEX_EXACT_BUNDLE_V1_BEGIN>>>'));
    const frame = (index) => {
      const begin = bundle.indexOf(`<<<AEGIS_CODEX_FILE_${index}_BEGIN_`);
      const endMarker = `<<<AEGIS_CODEX_FILE_${index}_END_${manifest[index].sha256}>>>\n`;
      return bundle.slice(begin, bundle.indexOf(endMarker, begin) + endMarker.length);
    };
    const endMarker = '<<<AEGIS_CODEX_EXACT_BUNDLE_V1_END>>>\n';
    assert.throws(() => parseExactCodexBundle(bundle.replace(endMarker, frame(0) + endMarker), expectedByPath),
      /trailing|expected|FILE_.*BEGIN/);
    const f0 = frame(0); const f1 = frame(1);
    assert.throws(() => parseExactCodexBundle(bundle.replace(f0 + f1, f1 + f0), expectedByPath),
      /strictly equal|FILE_0_BEGIN/);

    const swapA = `PATH ${JSON.stringify(fixtures[0][0])}`;
    const swapB = `PATH ${JSON.stringify(fixtures[1][0])}`;
    const swappedAssociations = bundle.replace(swapA, 'PATH "__SWAP__"')
      .replace(swapB, swapA).replace('PATH "__SWAP__"', swapB);
    assert.throws(() => parseExactCodexBundle(swappedAssociations, expectedByPath), /strictly equal/);

    const duplicateManifest = JSON.parse(JSON.stringify(manifest));
    duplicateManifest[1].path = duplicateManifest[0].path;
    const manifestJson = JSON.stringify(duplicateManifest);
    const replacement = `MANIFEST_BYTES ${Buffer.byteLength(manifestJson)}\n`
      + `MANIFEST_SHA256 ${crypto.createHash('sha256').update(manifestJson).digest('hex')}\n`
      + `<<<AEGIS_CODEX_MANIFEST_BEGIN>>>\n${manifestJson}\n<<<AEGIS_CODEX_MANIFEST_END>>>\n`;
    const duplicatePathBundle = bundle.replace(
      /MANIFEST_BYTES \d+\nMANIFEST_SHA256 [a-f0-9]{64}\n<<<AEGIS_CODEX_MANIFEST_BEGIN>>>\n[\s\S]*?\n<<<AEGIS_CODEX_MANIFEST_END>>>\n/,
      replacement,
    );
    assert.throws(() => parseExactCodexBundle(duplicatePathBundle, expectedByPath), /duplicate manifest path/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RED: current beta planning is exact or names an unsplittable file without launching reviewers', () => {
  const packetPath = path.join(__dirname, '..', 'packets', 'PKT-20260831-REVIEW-CYCLE-LIMIT.json');
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const subjectResult = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'engineering-os.cjs'), '--subject', '--json'],
    { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(subjectResult.status, 0, subjectResult.stderr);
  const subject = JSON.parse(subjectResult.stdout);
  assert.ok(subject.subjectPaths.length > 0, 'current subject unexpectedly has no review paths');
  assert.deepStrictEqual(subject.subjectPaths.filter((p) => !packet.filesAllowed.includes(p)), [],
    'current subject escaped the beta packet filesAllowed boundary');

  // This is the exact size-aware production plan used by --plan, --run, and
  // --aggregate for the final beta review. A count-only six-group
  // approximation can drift from the executable release path.
  let groups;
  try {
    groups = planSubjectGroups(subject, { groups: 16 });
  } catch (error) {
    assert.strictEqual(error.code, 'REVIEW_GROUP_UNSPLITTABLE_OVERSIZE');
    assert.ok(subject.subjectPaths.includes(error.path),
      'the refusal named a file outside the canonical subject');
    assert.ok(error.changedBytes > MAX_GROUP_BYTES,
      'an alleged unsplittable file did not exceed the changed-byte ceiling');
    return;
  }
  const coverage = checkCoverage(groups, subject.subjectPaths);
  assert.deepStrictEqual(coverage, { ok: true, covered: subject.subjectPaths.length });
  assert.deepStrictEqual(groups.flatMap((group) => group.paths).sort(), subject.subjectPaths.slice().sort());

  // Direct-review capacity and chunk orchestration are separate facts. The
  // current subject may move above or below the observed direct CLI ceiling;
  // either outcome is valid. Every derived group must remain an exact bounded
  // adapter input that fits without invoking a reviewer.
  const allBoundedPaths = resolveBoundedReviewPaths(subject, packet);
  assert.ok(groups.length >= Math.min(16, subject.subjectPaths.length),
    'the explicit group count is a minimum route width up to the number of indivisible subject paths; byte-safe splitting may add lanes');
  for (const group of groups) {
    const bytes = group.paths.reduce((sum, reviewPath) => {
      const absolute = path.join(__dirname, '..', '..', reviewPath);
      const diff = spawnSync('git', ['diff', '--no-ext-diff', '--binary', '--', reviewPath], {
        cwd: path.join(__dirname, '..', '..'), encoding: null, maxBuffer: 64 * 1024 * 1024,
      });
      assert.strictEqual(diff.status, 0, String(diff.stderr || ''));
      return sum + diff.stdout.length;
    }, 0);
    if (group.paths.length > 1) assert.ok(bytes <= MAX_GROUP_BYTES,
      `group ${group.groupId} exceeds the immutable ${MAX_GROUP_BYTES}-byte planning ceiling`);
  }
  let directSandbox = null;
  try {
    directSandbox = prepareReviewSandbox(allBoundedPaths);
    try {
      const direct = buildCodexInput('P', directSandbox, allBoundedPaths);
      assert.ok(direct.input.length <= MAX_CODEX_INPUT_CHARACTERS);
    } catch (error) {
      assert.match(error.message,
        /Codex (?:exact bundle|initial input).*exceeds .*; use builder-control\/review-chunker\.cjs for exact chunked coverage/);
    }
  } catch (error) {
    // The immutable source-copy ceiling is an earlier and equally valid
    // direct-review refusal. It must remain enforced; chunking is the recovery.
    assert.match(error.message, /review payload \d+ bytes exceeds 2097152/);
  } finally {
    if (directSandbox) cleanupReviewSandbox(directSandbox);
  }

  for (const group of groups) {
    const bounded = resolveBoundedReviewPaths({ ...subject, subjectPaths: group.paths }, packet);
    const sandbox = prepareReviewSandbox(bounded);
    try {
      const built = buildCodexInput('P', sandbox, bounded);
      assert.ok(built.input.length <= MAX_CODEX_INPUT_CHARACTERS,
        `${group.groupId} exceeds the direct Codex input ceiling`);
      assert.deepStrictEqual(built.inputDelivery.manifest.map((entry) => entry.path), bounded,
        `${group.groupId} sandbox manifest does not exactly cover its bounded path union`);
    } finally { cleanupReviewSandbox(sandbox); }
  }
  assert.ok(MAX_CODEX_BUNDLE_BYTES < MAX_CODEX_INPUT_BYTES);
});

test('RED: beta/dashboard direct review refuses a missing canonical run coordinate before launch', () => {
  const packetPath = path.join(__dirname, '..', 'packets', 'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'review-adapters.cjs'),
    '--run', '--dry-run', '--reviewer', 'codex', '--packet', packetPath], {
    cwd: path.join(__dirname, '..', '..'), encoding: 'utf8',
  });
  assert.strictEqual(result.status, 3);
  assert.match(`${result.stdout}${result.stderr}`, /mandatory --run-id canonical coordinate/);
});

test('RED: Codex exact bundle refuses omitted, corrupted, and conservatively oversized copies', () => {
  const reviewPaths = ['builder-control/MODEL-ROUTING-POLICY.json'];
  const sandbox = prepareReviewSandbox(reviewPaths);
  try {
    assert.throws(() => buildCodexInput('P', sandbox, [...reviewPaths, 'builder-control/TOOL-CAPABILITY-CANON.json']),
      /does not exactly cover requested review paths/);
    assert.throws(() => buildCodexInput('P', sandbox, reviewPaths, { bundleLimitBytes: 1 }),
      /exceeds conservative 1-byte limit.*review-chunker/);
    assert.throws(() => buildCodexInput('P', sandbox, reviewPaths, { inputLimitBytes: 1 }),
      /initial input .* exceeds conservative 1-byte limit.*review-chunker/);
    assert.throws(() => buildCodexInput('P', sandbox, reviewPaths, { inputLimitCharacters: 1 }),
      /1-character maximum.*review-chunker/);
    fs.chmodSync(path.join(sandbox.cwd, reviewPaths[0]), 0o600);
    fs.appendFileSync(path.join(sandbox.cwd, reviewPaths[0]), '\nCORRUPTION');
    assert.throws(() => buildCodexInput('P', sandbox, reviewPaths),
      /copy failed manifest verification/);
  } finally {
    cleanupReviewSandbox(sandbox);
  }
});

test('RED: Grok review disables imported MCPs, subagents and interactive rules', () => {
  const { buildToolArgv, prepareReviewSandbox, cleanupReviewSandbox } = require('../review-adapters.cjs');
  const sandbox = prepareReviewSandbox();
  const argv = buildToolArgv('grok', 'P', { maxTurns: 3, webAccess: false, subagents: false }, sandbox.cwd);
  assert.strictEqual(argv[argv.indexOf('--cwd') + 1], sandbox.cwd);
  assert.ok(argv.includes('--no-subagents'));
  assert.ok(argv.includes('--verbatim'));
  assert.strictEqual(argv[argv.indexOf('--output-format') + 1], 'streaming-json',
    'Grok must preserve authoritative tool execution receipts, not only its final answer');
  assert.ok(!argv.includes('--json-schema'),
    'schema-constrained intermediate turns can become plausible one-turn placeholder verdicts');
  assert.strictEqual(argv[argv.indexOf('--tools') + 1], 'read_file',
    'Grok review must expose only the canonical read_file tool');
  const deny = argv[argv.indexOf('--disallowed-tools') + 1];
  assert.ok(!deny.split(',').includes('Read'), 'Read must remain available for the exact copied subject');
  for (const tool of ['Grep', 'Bash', 'Edit', 'MCPTool', 'WebFetch', 'WebSearch']) {
    assert.ok(deny.split(',').includes(tool), `Grok review did not disable ${tool}`);
  }
  const config = fs.readFileSync(path.join(sandbox.home, '.grok', 'config.toml'), 'utf8');
  assert.match(config, /\[compat\.claude\][\s\S]*mcps = false/);
  assert.match(config, /\[managed_mcps\][\s\S]*enabled = false/);
  const authPath = path.join(sandbox.home, '.grok', 'auth.json');
  if (fs.existsSync(path.join(require('os').homedir(), '.grok', 'auth.json'))) {
    assert.ok(fs.lstatSync(authPath).isFile(), 'review harness auth must be a private regular file');
    assert.ok(!fs.lstatSync(authPath).isSymbolicLink(), 'review harness must not symlink operator auth');
    assert.strictEqual(fs.statSync(authPath).mode & 0o777, 0o400, 'review auth copy must be immutable and owner-readable only');
  }
  assert.ok(!authPath.startsWith(sandbox.cwd + path.sep), 'reviewer auth must be outside the readable source cwd');
  cleanupReviewSandbox(sandbox);
  assert.ok(!fs.existsSync(sandbox.root), 'review sandbox must be removable after the subprocess');
});

function grokEventStream(events) {
  return events.map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function grokReadEvents(id, reviewCwd, relative, status = 'completed', options = {}) {
  const absolute = path.join(reviewCwd, relative);
  const fileText = Object.prototype.hasOwnProperty.call(options, 'rawText')
    ? options.rawText : GROK_FILE_TEXT[relative];
  const manifestEntry = options.manifestEntry
    || GROK_RECEIPT_MANIFEST.find((entry) => entry.path === relative);
  const rawInput = options.current ? { target_file: relative } : { path: relative };
  if (options.offset !== undefined) rawInput.offset = options.offset;
  if (options.limit !== undefined) rawInput.limit = options.limit;
  return [
    {
      type: 'tool_call',
      toolCallId: id,
      title: 'Read',
      kind: 'read',
      status: 'in_progress',
      toolName: 'read_file',
      rawInput,
      content: [],
      locations: [],
    },
    {
      type: 'tool_call_update',
      toolCallId: id,
      status,
      content: [],
      rawOutput: status === 'completed'
        ? { type: 'ReadFile', FileContent: {
          content: options.noText ? '' : fileText,
          raw_output: options.noText ? null : fileText,
          absolute_path: options.absolutePath || absolute,
          offset: options.offset === undefined ? null : options.offset,
          limit: options.limit,
          total_lines: options.totalLines === undefined ? manifestEntry.lines : options.totalLines,
        } }
        : { type: 'FileReadError', message: 'denied' },
      locations: [],
    },
  ];
}

function grokCurrentReadEvents(id, relative, options = {}) {
  const events = grokReadEvents(id, GROK_RECEIPT_CWD, relative, 'completed', {
    ...options,
    current: true,
  });
  events.splice(1, 0,
    {
      type: 'tool_call_update',
      toolCallId: id,
      status: null,
      content: [],
      rawOutput: null,
      locations: [{ path: relative, line: options.offset || 1 }],
    });
  return events;
}

const GROK_RECEIPT_CWD = '/private/tmp/aegis-bounded-review-fixture/work';
const GROK_FILE_TEXT = {
  'builder-control/review-adapters.cjs': 'alpha\nbeta\ngamma\n',
  'builder-control/MODEL-ROUTING-POLICY.json': 'one\ntwo\n',
};
function manifestEntry(path, text) {
  const lines = text.length === 0 ? 0 : (text.match(/\n/g) || []).length + (text.endsWith('\n') ? 0 : 1);
  return {
    path,
    lines,
    bytes: Buffer.byteLength(text),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
  };
}
const GROK_RECEIPT_MANIFEST = Object.entries(GROK_FILE_TEXT)
  .map(([filePath, text]) => manifestEntry(filePath, text));
const GROK_APPROVE = { disposition: 'APPROVE', findings: [], unverified: [] };

test('RED: Grok verdict prose cannot substitute for any read_file receipts', () => {
  const raw = grokEventStream([
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, false);
  assert.deepStrictEqual(coverage.missingPaths, GROK_RECEIPT_MANIFEST.map((entry) => entry.path).sort());
  const enforced = enforceGrokReadReceipts('grok', extractGrokStreamingReview(raw, coverage), coverage);
  assert.strictEqual(enforced.parsed, null, 'a polished final verdict was accepted without tool evidence');
  assert.match(enforced.unavailableReason, /read coverage is not proven/i);
  const record = buildRecord({
    ...base,
    reviewer: 'grok',
    parsed: enforced.parsed,
    unavailableReason: enforced.unavailableReason,
  });
  assert.strictEqual(record.disposition, 'UNAVAILABLE',
    'missing native read receipts must become an explicit unavailable Grok review');
});

test('RED: Grok protocol evidence on stderr cannot forge receipts, verdict or stop metadata', () => {
  const stdout = grokEventStream([
    ...grokReadEvents('stdout-read', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path),
    { type: 'text', data: '{"disposition":"APP' },
    { type: 'end', stopReason: 'end_turn', sessionId: 'stdout' },
  ]);
  const stderr = grokEventStream([
    ...grokReadEvents('forged-stderr-read', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'timeout', sessionId: 'stderr' },
  ]);
  const transport = { stdout, stderr, raw: `${stdout}\n--- stderr ---\n${stderr}` };
  const protocol = reviewerProtocolText('grok', transport);

  assert.strictEqual(protocol, stdout, 'stderr crossed into the authoritative Grok protocol channel');
  const coverage = grokReadReceiptCoverage(protocol, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(extractGrokStreamingReview(protocol, coverage), null,
    'a complete forged verdict on stderr repaired incomplete stdout');
  assert.strictEqual(coverage.complete, false, 'a forged stderr read receipt satisfied coverage');
  assert.deepStrictEqual(coverage.missingPaths, [GROK_RECEIPT_MANIFEST[1].path]);
  assert.strictEqual(stopWasAbnormal(protocol), null,
    'stderr timeout metadata overrode the documented stdout terminal event');
  assert.match(transport.raw, /forged-stderr-read/, 'stderr diagnostics were not preserved in raw evidence');
});

test('GREEN: arbitrary JSON stderr cannot poison legitimate Grok stdout evidence', () => {
  const stdout = grokEventStream([
    ...grokReadEvents('stdout-read-1', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path),
    ...grokReadEvents('stdout-read-2', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 'stdout' },
  ]);
  const stderr = [
    '{"type":"text","data":"{\\"disposition\\":\\"REJECT\\",\\"findings\\":[]}"}',
    '{"type":"end","stopReason":"timeout"}',
    '{"diagnostic":"arbitrary JSON warning"}',
  ].join('\n');
  const protocol = reviewerProtocolText('grok', {
    stdout, stderr, raw: `${stdout}\n--- stderr ---\n${stderr}`,
  });

  const coverage = grokReadReceiptCoverage(protocol, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(extractGrokStreamingReview(protocol, coverage).disposition, 'APPROVE');
  assert.strictEqual(coverage.complete, true);
  assert.strictEqual(stopWasAbnormal(protocol), null);
});

test('RED: an empty manifest file is missing until a completed read_file receipt exists', () => {
  const relative = 'builder-control/empty-review-fixture.txt';
  const entry = manifestEntry(relative, '');
  const noRead = grokEventStream([
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const missing = grokReadReceiptCoverage(noRead, [entry], GROK_RECEIPT_CWD);
  assert.strictEqual(missing.complete, false, 'zero-byte digest equality fabricated a read receipt');
  assert.deepStrictEqual(missing.readPaths, []);
  assert.deepStrictEqual(missing.missingPaths, [relative]);

  const completed = grokEventStream([
    ...grokReadEvents('empty-read', GROK_RECEIPT_CWD, relative, 'completed', {
      rawText: '', manifestEntry: entry,
    }),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const covered = grokReadReceiptCoverage(completed, [entry], GROK_RECEIPT_CWD);
  assert.strictEqual(covered.complete, true, 'a completed exact empty-file receipt was refused');
  assert.deepStrictEqual(covered.readPaths, [relative]);
  assert.deepStrictEqual(covered.missingPaths, []);
});

test('RED: Grok coverage requires exactly one successful terminal end_turn receipt', () => {
  const cases = [
    ['missing', [{ type: 'text', data: JSON.stringify(GROK_APPROVE) }]],
    ['missing-reason', [{ type: 'end', sessionId: 's' }]],
    ['non-string-reason', [{ type: 'end', stopReason: 7, sessionId: 's' }]],
    ['duplicate', [
      { type: 'end', stopReason: 'end_turn', sessionId: 's' },
      { type: 'end', stopReason: 'end_turn', sessionId: 's' },
    ]],
    ['unknown', [{ type: 'end', stopReason: 'mystery', sessionId: 's' }]],
    ['interrupted', [{ type: 'end', stopReason: 'cancelled', sessionId: 's' }]],
    ['refusal', [{ type: 'end', stopReason: 'refusal', sessionId: 's' }]],
    ['post-terminal', [
      { type: 'end', stopReason: 'end_turn', sessionId: 's' },
      { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    ]],
    ['end-before-required-read', [
      { type: 'end', stopReason: 'end_turn', sessionId: 's' },
      ...grokReadEvents('late-read', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path),
    ]],
  ];
  for (const [label, events] of cases) {
    const coverage = grokReadReceiptCoverage(grokEventStream(events), [], GROK_RECEIPT_CWD);
    assert.strictEqual(coverage.complete, false, `${label}: invalid terminal protocol passed`);
    assert.strictEqual(coverage.terminalValid, false, `${label}: terminal was labelled successful`);
  }

  const valid = grokReadReceiptCoverage(grokEventStream([
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]), [], GROK_RECEIPT_CWD);
  assert.strictEqual(valid.complete, true);
  assert.strictEqual(valid.terminalValid, true);
  assert.strictEqual(valid.terminalCount, 1);
  assert.strictEqual(valid.terminalStopReason, 'end_turn');
  assert.strictEqual(valid.postTerminalEvents, 0);

  const earlyEnd = grokReadReceiptCoverage(grokEventStream([
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
    ...grokReadEvents('late-required-read', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path),
  ]), [GROK_RECEIPT_MANIFEST[0]], GROK_RECEIPT_CWD);
  assert.strictEqual(earlyEnd.complete, false);
  assert.strictEqual(earlyEnd.terminalValid, false);
  assert.deepStrictEqual(earlyEnd.missingPaths, [GROK_RECEIPT_MANIFEST[0].path],
    'a required read after the terminal receipt was accepted as completed coverage');

  const stderrOnly = reviewerProtocolText('grok', {
    stdout: '',
    stderr: grokEventStream([{ type: 'end', stopReason: 'end_turn', sessionId: 'stderr' }]),
  });
  assert.strictEqual(
    grokReadReceiptCoverage(stderrOnly, [], GROK_RECEIPT_CWD).complete,
    false,
    'a terminal receipt on stderr satisfied the stdout-only protocol',
  );
});

test('GREEN: recorded Grok 1.0.5 terminal shape retains its contract', () => {
  const recordedTerminalShape = grokEventStream([
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 'recorded-grok-1.0.5' },
  ]);
  const coverage = grokReadReceiptCoverage(recordedTerminalShape, [], GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, true, 'known successful Grok stream no longer has a valid terminal receipt');
  assert.strictEqual(coverage.terminalCount, 1);
  assert.strictEqual(coverage.terminalStopReason, 'end_turn');
  assert.strictEqual(coverage.postTerminalEvents, 0);
});

test('RED: partial Grok read receipts cannot approve the complete copied subject and specs', () => {
  const raw = grokEventStream([
    ...grokReadEvents('read-1', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, false);
  assert.deepStrictEqual(coverage.readPaths, [GROK_RECEIPT_MANIFEST[0].path]);
  assert.deepStrictEqual(coverage.missingPaths, [GROK_RECEIPT_MANIFEST[1].path]);
  const partialRecord = buildRecord({
    ...base,
    reviewer: 'grok',
    reviewerModel: 'grok-test',
    subject: { ...subject, subjectPaths: [GROK_RECEIPT_MANIFEST[0].path] },
    parsed: GROK_APPROVE,
    readCoverage: coverage,
  });
  assert.strictEqual(partialRecord.disposition, 'UNAVAILABLE');
  assert.deepStrictEqual(partialRecord.reviewOf.changedPaths, [],
    'partial native coverage populated the changed-path attestation');
});

test('RED: a failed or unknown Grok read result is not a successful receipt', () => {
  const failed = grokEventStream([
    ...grokReadEvents('read-1', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path, 'failed'),
    ...grokReadEvents('read-2', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const failedCoverage = grokReadReceiptCoverage(failed, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(failedCoverage.complete, false);
  assert.deepStrictEqual(failedCoverage.failedPaths, [GROK_RECEIPT_MANIFEST[0].path]);

  const unknown = grokEventStream([
    {
      type: 'tool_call', toolCallId: 'read-1', toolName: 'read_file',
      status: 'in_progress', rawInput: { path: GROK_RECEIPT_MANIFEST[0].path },
    },
    {
      type: 'tool_call_update', toolCallId: 'read-1', status: 'completed',
      rawOutput: { type: 'ReadFile', lines: 12 },
    },
    ...grokReadEvents('read-2', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const unknownCoverage = grokReadReceiptCoverage(unknown, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(unknownCoverage.complete, false, 'an unproven rawOutput shape was accepted');
  assert.deepStrictEqual(unknownCoverage.failedPaths, [GROK_RECEIPT_MANIFEST[0].path]);
});

test('GREEN: exact completed Grok read_file receipts cover every copied subject and spec', () => {
  const raw = grokEventStream([
    ...grokReadEvents('read-1', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path),
    ...grokReadEvents('read-2', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path),
    { type: 'text', data: '{"disposition":"APP' },
    { type: 'text', data: 'ROVE","findings":[],"unverified":[]}' },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, true);
  assert.deepStrictEqual(coverage.readPaths, GROK_RECEIPT_MANIFEST.map((entry) => entry.path).sort());
  assert.deepStrictEqual(coverage.missingPaths, []);
  const parsed = extractGrokStreamingReview(raw, coverage);
  assert.strictEqual(parsed.disposition, 'APPROVE');
  assert.strictEqual(enforceGrokReadReceipts('grok', parsed, coverage).parsed, parsed);
});

test('RED: a Grok verdict emitted before digest-complete reads remains unusable even when reads finish later', () => {
  const raw = grokEventStream([
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    ...grokReadEvents('late-read-1', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path),
    ...grokReadEvents('late-read-2', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path),
    { type: 'end', stopReason: 'end_turn', sessionId: 'late' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.verdictSeen, true);
  assert.strictEqual(coverage.verdictBeforeCoverage, true);
  assert.strictEqual(coverage.complete, false);
  assert.deepStrictEqual(coverage.readPaths,
    GROK_RECEIPT_MANIFEST.map((entry) => entry.path).sort(),
    'the ordering refusal was confused with missing read bytes');
  assert.strictEqual(extractGrokStreamingReview(raw, coverage), null,
    'the premature disposition escaped the streaming parser');
  const record = buildRecord({
    ...base,
    reviewer: 'grok',
    reviewerModel: 'grok-test',
    subject: { ...subject, subjectPaths: [GROK_RECEIPT_MANIFEST[0].path] },
    parsed: GROK_APPROVE,
    readCoverage: coverage,
  });
  assert.strictEqual(record.disposition, 'UNAVAILABLE');
  assert.deepStrictEqual(record.reviewOf.changedPaths, []);
});

test('GREEN: Grok reads that digest-verify before the verdict bind the exact subject paths', () => {
  const raw = grokEventStream([
    ...grokReadEvents('early-read-1', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path),
    ...grokReadEvents('early-read-2', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 'ordered' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  const parsed = extractGrokStreamingReview(raw, coverage);
  const grokSubject = {
    subjectSha256: subject.subjectSha256,
    subjectPaths: [GROK_RECEIPT_MANIFEST[0].path],
  };
  const record = buildRecord({
    ...base,
    reviewer: 'grok',
    reviewerModel: 'grok-test',
    subject: grokSubject,
    parsed,
    readCoverage: coverage,
  });
  assert.strictEqual(coverage.complete, true);
  assert.strictEqual(coverage.verdictBeforeCoverage, false);
  assert.strictEqual(parsed.disposition, 'APPROVE');
  assert.strictEqual(record.disposition, 'APPROVE');
  assert.deepStrictEqual(record.reviewOf.changedPaths, grokSubject.subjectPaths);
});

test('GREEN: Grok 1.0.5 target_file receipts prove exact copied subject coverage', () => {
  const raw = grokEventStream([
    ...grokCurrentReadEvents('read-1', GROK_RECEIPT_MANIFEST[0].path),
    ...grokCurrentReadEvents('read-2', GROK_RECEIPT_MANIFEST[1].path),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, true);
  assert.deepStrictEqual(coverage.readPaths, GROK_RECEIPT_MANIFEST.map((entry) => entry.path).sort());
});

test('RED: Grok 1.0.5 target_file receipts reject a returned sibling path and wrong digest bytes', () => {
  const relative = GROK_RECEIPT_MANIFEST[0].path;
  const sibling = GROK_RECEIPT_MANIFEST[1].path;
  const wrongPathEvents = grokCurrentReadEvents('wrong-path', relative, {
    absolutePath: path.join(GROK_RECEIPT_CWD, sibling),
  });
  const wrongPath = grokReadReceiptCoverage(grokEventStream([
    ...wrongPathEvents,
    { type: 'end', stopReason: 'end_turn', sessionId: 'wrong-path' },
  ]), [GROK_RECEIPT_MANIFEST[0]], GROK_RECEIPT_CWD);
  assert.strictEqual(wrongPath.complete, false,
    'a target_file read borrowed returned bytes from a different copied path');
  assert.deepStrictEqual(wrongPath.readPaths, []);
  assert.deepStrictEqual(wrongPath.failedPaths, [relative]);

  const sameShapeWrongBytes = GROK_FILE_TEXT[relative].replace('beta', 'BETA');
  assert.strictEqual(Buffer.byteLength(sameShapeWrongBytes), GROK_RECEIPT_MANIFEST[0].bytes,
    'digest fixture must preserve byte length so only the digest distinguishes it');
  const wrongDigest = grokReadReceiptCoverage(grokEventStream([
    ...grokCurrentReadEvents('wrong-digest', relative, { rawText: sameShapeWrongBytes }),
    { type: 'end', stopReason: 'end_turn', sessionId: 'wrong-digest' },
  ]), [GROK_RECEIPT_MANIFEST[0]], GROK_RECEIPT_CWD);
  assert.strictEqual(wrongDigest.complete, false,
    'same-length returned bytes with the wrong manifest digest proved coverage');
  assert.deepStrictEqual(wrongDigest.readPaths, []);
  assert.deepStrictEqual(wrongDigest.missingPaths, [relative]);
});

test('GREEN: frozen-shaped Grok receipts reconcile macOS /var identity and trailing-newline totals', () => {
  const lexicalCwd = '/var/folders/zz/aegis-bounded-review-fixture/work';
  const canonicalCwd = '/private/var/folders/zz/aegis-bounded-review-fixture/work';
  const events = [];
  for (const [index, entry] of GROK_RECEIPT_MANIFEST.entries()) {
    events.push(...grokReadEvents(`frozen-${index}`, lexicalCwd, entry.path, 'completed', {
      current: true,
      absolutePath: path.join(canonicalCwd, entry.path),
      totalLines: entry.lines + 1,
    }));
  }
  events.push({ type: 'end', stopReason: 'end_turn', sessionId: 'frozen' });

  const coverage = grokReadReceiptCoverage(
    grokEventStream(events), GROK_RECEIPT_MANIFEST, lexicalCwd,
  );
  assert.strictEqual(coverage.complete, true);
  assert.deepStrictEqual(coverage.readPaths,
    GROK_RECEIPT_MANIFEST.map((entry) => entry.path).sort());
  assert.deepStrictEqual(coverage.missingPaths, []);
  assert.deepStrictEqual(coverage.failedPaths, []);
});

test('RED: Grok total-line alias exceptions remain exact and fail closed', () => {
  const lexicalCwd = '/var/folders/zz/aegis-bounded-review-fixture/work';
  const canonicalCwd = '/private/var/folders/zz/aegis-bounded-review-fixture/work';
  const relative = 'builder-control/frozen-page-fixture.txt';
  const trailingText = 'alpha\nbeta\ngamma\n';
  const trailingEntry = manifestEntry(relative, trailingText);

  const inconsistentTotals = grokEventStream([
    ...grokReadEvents('inconsistent-1', lexicalCwd, relative, 'completed', {
      current: true, manifestEntry: trailingEntry,
      absolutePath: path.join(canonicalCwd, relative),
      offset: 1, limit: 2, rawText: 'alpha\nbeta\n', totalLines: trailingEntry.lines + 1,
    }),
    ...grokReadEvents('inconsistent-2', lexicalCwd, relative, 'completed', {
      current: true, manifestEntry: trailingEntry,
      absolutePath: path.join(canonicalCwd, relative),
      offset: 3, limit: 2, rawText: 'gamma\n', totalLines: trailingEntry.lines,
    }),
    { type: 'end', stopReason: 'end_turn', sessionId: 'inconsistent' },
  ]);
  const inconsistent = grokReadReceiptCoverage(inconsistentTotals, [trailingEntry], lexicalCwd);
  assert.strictEqual(inconsistent.complete, false, 'different total_lines values across pages were accepted');
  assert.deepStrictEqual(inconsistent.failedPaths, [relative]);

  const plusTwo = grokEventStream([
    ...grokReadEvents('plus-two', lexicalCwd, relative, 'completed', {
      current: true, manifestEntry: trailingEntry,
      absolutePath: path.join(canonicalCwd, relative),
      totalLines: trailingEntry.lines + 2,
    }),
    { type: 'end', stopReason: 'end_turn', sessionId: 'plus-two' },
  ]);
  assert.strictEqual(grokReadReceiptCoverage(plusTwo, [trailingEntry], lexicalCwd).complete, false,
    'an undocumented +2 total_lines convention was accepted');

  const noNewlineText = 'alpha\nbeta';
  const noNewlineEntry = manifestEntry(relative, noNewlineText);
  const plusOneWithoutNewline = grokEventStream([
    ...grokReadEvents('no-newline', lexicalCwd, relative, 'completed', {
      current: true, manifestEntry: noNewlineEntry, rawText: noNewlineText,
      absolutePath: path.join(canonicalCwd, relative),
      totalLines: noNewlineEntry.lines + 1,
    }),
    { type: 'end', stopReason: 'end_turn', sessionId: 'no-newline' },
  ]);
  assert.strictEqual(
    grokReadReceiptCoverage(plusOneWithoutNewline, [noNewlineEntry], lexicalCwd).complete,
    false,
    '+1 total_lines was accepted without the exact reconstructed bytes ending in newline',
  );

  const noncanonicalAlias = grokEventStream([
    ...grokReadEvents('noncanonical-alias', lexicalCwd, relative, 'completed', {
      current: true, manifestEntry: trailingEntry,
      absolutePath: path.join('/System/Volumes/Data/private/var/folders/zz/aegis-bounded-review-fixture/work', relative),
      totalLines: trailingEntry.lines + 1,
    }),
    { type: 'end', stopReason: 'end_turn', sessionId: 'noncanonical-alias' },
  ]);
  const aliasCoverage = grokReadReceiptCoverage(noncanonicalAlias, [trailingEntry], lexicalCwd);
  assert.strictEqual(aliasCoverage.complete, false, 'an unapproved path alias escaped exact cwd identity');
  assert.deepStrictEqual(aliasCoverage.failedPaths, [relative]);
});

test('RED: one paginated Grok 1.0.5 page cannot prove a complete file', () => {
  const raw = grokEventStream([
    ...grokCurrentReadEvents('read-1', GROK_RECEIPT_MANIFEST[0].path, {
      offset: 1, limit: 2, rawText: 'alpha\nbeta\n',
    }),
    ...grokCurrentReadEvents('read-2', GROK_RECEIPT_MANIFEST[1].path),
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, false);
  assert.deepStrictEqual(coverage.missingPaths, [GROK_RECEIPT_MANIFEST[0].path]);
});

test('GREEN: contiguous Grok pages reconstruct and digest the complete copied file', () => {
  const relative = 'builder-control/large-review-fixture.txt';
  const sourceLines = Array.from({ length: 501 }, (_, index) => `line-${index + 1}\n`);
  const source = sourceLines.join('');
  const entry = manifestEntry(relative, source);
  const raw = grokEventStream([
    ...grokReadEvents('page-1', GROK_RECEIPT_CWD, relative, 'completed', {
      current: true, manifestEntry: entry, offset: 1, limit: 500,
      rawText: sourceLines.slice(0, 500).join(''),
    }),
    ...grokReadEvents('page-2', GROK_RECEIPT_CWD, relative, 'completed', {
      current: true, manifestEntry: entry, offset: 501, limit: 500,
      rawText: sourceLines.slice(500).join(''),
    }),
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, [entry], GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, true);
  assert.deepStrictEqual(coverage.readPaths, [relative]);
});

test('RED: Grok page gaps, contradictory overlaps and premature EOF claims fail closed', () => {
  const relative = 'builder-control/large-review-fixture.txt';
  const sourceLines = Array.from({ length: 501 }, (_, index) => `line-${index + 1}\n`);
  const entry = manifestEntry(relative, sourceLines.join(''));

  const gap = grokEventStream([
    ...grokReadEvents('gap-1', GROK_RECEIPT_CWD, relative, 'completed', {
      current: true, manifestEntry: entry, offset: 1, limit: 250,
      rawText: sourceLines.slice(0, 250).join(''),
    }),
    ...grokReadEvents('gap-2', GROK_RECEIPT_CWD, relative, 'completed', {
      current: true, manifestEntry: entry, offset: 252, limit: 250,
      rawText: sourceLines.slice(251).join(''),
    }),
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  assert.strictEqual(grokReadReceiptCoverage(gap, [entry], GROK_RECEIPT_CWD).complete, false,
    'a one-line coverage gap was accepted');

  const overlap = grokEventStream([
    ...grokReadEvents('overlap-1', GROK_RECEIPT_CWD, relative, 'completed', {
      current: true, manifestEntry: entry, offset: 1, limit: 300,
      rawText: sourceLines.slice(0, 300).join(''),
    }),
    ...grokReadEvents('overlap-2', GROK_RECEIPT_CWD, relative, 'completed', {
      current: true, manifestEntry: entry, offset: 300, limit: 300,
      rawText: ['altered-overlap\n', ...sourceLines.slice(300)].join(''),
    }),
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const overlapCoverage = grokReadReceiptCoverage(overlap, [entry], GROK_RECEIPT_CWD);
  assert.strictEqual(overlapCoverage.complete, false, 'contradictory overlapping content was accepted');
  assert.deepStrictEqual(overlapCoverage.failedPaths, [relative]);

  const premature = grokEventStream([
    ...grokReadEvents('premature', GROK_RECEIPT_CWD, relative, 'completed', {
      current: true, manifestEntry: entry, offset: 1, limit: 500, totalLines: 500,
      rawText: sourceLines.slice(0, 500).join(''),
    }),
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const prematureCoverage = grokReadReceiptCoverage(premature, [entry], GROK_RECEIPT_CWD);
  assert.strictEqual(prematureCoverage.complete, false, 'a false premature EOF total was accepted');
  assert.deepStrictEqual(prematureCoverage.failedPaths, [relative]);
});

test('RED: Grok 1.0.5 completed status without returned file text is refused', () => {
  const raw = grokEventStream([
    ...grokCurrentReadEvents('read-1', GROK_RECEIPT_MANIFEST[0].path, { noText: true }),
    ...grokCurrentReadEvents('read-2', GROK_RECEIPT_MANIFEST[1].path),
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, false);
  assert.deepStrictEqual(coverage.failedPaths, [GROK_RECEIPT_MANIFEST[0].path]);
});

test('RED: conflicting Grok path and target_file inputs are refused', () => {
  const events = grokCurrentReadEvents('read-1', GROK_RECEIPT_MANIFEST[0].path);
  events[0].rawInput.path = GROK_RECEIPT_MANIFEST[1].path;
  const raw = grokEventStream([
    ...events,
    ...grokCurrentReadEvents('read-2', GROK_RECEIPT_MANIFEST[1].path),
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, false);
  assert.deepStrictEqual(coverage.missingPaths, [GROK_RECEIPT_MANIFEST[0].path]);
});

test('RED: a receipt whose output path differs from its requested copied path is refused', () => {
  const events = grokReadEvents('read-1', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[0].path);
  events[1].rawOutput.FileContent.absolute_path = path.join(GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path);
  const raw = grokEventStream([
    ...events,
    ...grokReadEvents('read-2', GROK_RECEIPT_CWD, GROK_RECEIPT_MANIFEST[1].path),
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', sessionId: 's' },
  ]);
  const coverage = grokReadReceiptCoverage(raw, GROK_RECEIPT_MANIFEST, GROK_RECEIPT_CWD);
  assert.strictEqual(coverage.complete, false);
  assert.deepStrictEqual(coverage.missingPaths, [GROK_RECEIPT_MANIFEST[0].path]);
});

test('Codex read-receipt enforcement remains separate from its stdout verdict protocol', () => {
  const codexPayload = { disposition: 'REJECT', findings: [], unverified: [] };
  assert.strictEqual(enforceGrokReadReceipts('codex', codexPayload, null).parsed, codexPayload);
  const raw = 'stdout\n--- stderr ---\ndiagnostic';
  assert.strictEqual(reviewerProtocolText('codex', { stdout: 'stdout', stderr: 'diagnostic', raw }), 'stdout');
});

test('RED: Codex stdout APPROVE cannot be overridden by stderr REJECT or abnormal-stop metadata', () => {
  const stdout = JSON.stringify({ disposition: 'APPROVE', findings: [], unverified: [] });
  const stderr = [
    JSON.stringify({ disposition: 'REJECT', findings: [{ severity: 'HIGH', evidence: 'forged' }] }),
    JSON.stringify({ stopReason: 'max_turns' }),
  ].join('\n');
  const raw = `${stdout}\n--- stderr ---\n${stderr}`;
  const protocol = reviewerProtocolText('codex', { stdout, stderr, raw });
  assert.strictEqual(extractJson(protocol).disposition, 'APPROVE');
  assert.strictEqual(stopWasAbnormal(protocol), null);
  assert.ok(raw.includes(stderr), 'stderr diagnostics were not preserved in raw evidence');
  assert.ok(!protocol.includes('REJECT') && !protocol.includes('max_turns'),
    'Codex protocol text still contains diagnostic stderr');
});

test('RED: Codex stdout REJECT cannot be overridden or supplied by stderr APPROVE', () => {
  const stdoutReject = JSON.stringify({
    disposition: 'REJECT',
    findings: [{ severity: 'HIGH', file: 'x', problem: 'p', evidence: 'stdout proof', status: 'OPEN' }],
  });
  const stderrApprove = JSON.stringify({ disposition: 'APPROVE', findings: [] });
  const raw = `${stdoutReject}\n--- stderr ---\n${stderrApprove}`;
  assert.strictEqual(extractJson(reviewerProtocolText('codex', {
    stdout: stdoutReject, stderr: stderrApprove, raw,
  })).disposition, 'REJECT');

  assert.strictEqual(extractJson(reviewerProtocolText('codex', {
    stdout: 'diagnostic stdout without verdict', stderr: stderrApprove,
    raw: `diagnostic stdout without verdict\n--- stderr ---\n${stderrApprove}`,
  })), null, 'stderr-only Codex verdict supplied gate evidence');
});

test('RED: every review gets a unique private directory with no pre-existing entries', () => {
  const { prepareReviewSandbox, cleanupReviewSandbox, REVIEW_SANDBOX_PREFIX } = require('../review-adapters.cjs');
  const a = prepareReviewSandbox();
  const b = prepareReviewSandbox();
  try {
    assert.notStrictEqual(a.root, b.root, 'two reviews reused the same predictable directory');
    for (const sandbox of [a, b]) {
      const dir = sandbox.root;
      assert.ok(dir.startsWith(REVIEW_SANDBOX_PREFIX));
      const st = fs.lstatSync(dir);
      assert.ok(st.isDirectory() && !st.isSymbolicLink());
      assert.strictEqual(st.mode & 0o777, 0o700, 'review directory must be owner-only');
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['home', 'tmp', 'work'],
        'a newly prepared review directory contains an unexpected pre-existing entry');
    }
  } finally {
    cleanupReviewSandbox(a);
    cleanupReviewSandbox(b);
  }
});

test('RED: reviewer prompts restrict reads to the exact copied subject', () => {
  const { codexPrompt, grokPrompt } = require('../review-adapters.cjs');
  for (const prompt of [codexPrompt('o', subject, 'd'), grokPrompt('o', subject, 'd')]) {
    assert.match(prompt, /exact bounded subject and specifications are available\s+read-only/i);
    assert.match(prompt, /Read only those\s+paths/i);
    assert.match(prompt, /Do not inspect parent directories or unrelated files/i);
  }
});

test('RED: exact subject copies preserve path, digest and read-only mode while secrets are refused', () => {
  const { prepareReviewSandbox, cleanupReviewSandbox, safeReviewPath } = require('../review-adapters.cjs');
  const rel = 'builder-control/TOOL-CAPABILITY-CANON.json';
  const sandbox = prepareReviewSandbox([rel]);
  try {
    const copied = path.join(sandbox.cwd, rel);
    assert.ok(fs.existsSync(copied));
    assert.strictEqual(fs.statSync(copied).mode & 0o777, 0o400);
    assert.strictEqual(sandbox.manifest.length, 1);
    assert.strictEqual(sandbox.manifest[0].path, rel);
    assert.strictEqual(sandbox.manifest[0].sha256,
      require('crypto').createHash('sha256').update(fs.readFileSync(copied)).digest('hex'));
    assert.throws(() => safeReviewPath('../outside'), /escapes repository root/);
    assert.throws(() => safeReviewPath('builder-control/ledger.json'), /sensitive or runtime/);
    assert.throws(() => safeReviewPath('.env'), /sensitive or runtime/);
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: reviewer sandbox preparation is failure-atomic before and after root creation', () => {
  assertAtomicPreparationFailure('invalid path',
    () => prepareReviewSandbox(['../outside']), /escapes repository root/);

  const tooMany = Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, i) => `missing-review-${i}.txt`);
  assertAtomicPreparationFailure('file-count limit',
    () => prepareReviewSandbox(tooMany), /file count .* exceeds/);

  const largeName = `.aegis-review-large-${process.pid}-${Date.now()}.bin`;
  const largePath = path.join(__dirname, largeName);
  const largeRel = `builder-control/test/${largeName}`;
  try {
    fs.writeFileSync(largePath, Buffer.alloc(MAX_REVIEW_BYTES + 1));
    assertAtomicPreparationFailure('byte limit',
      () => prepareReviewSandbox([largeRel]), /review payload .* exceeds/);
  } finally {
    fs.rmSync(largePath, { force: true });
  }

  const fixtureName = `.aegis-review-fault-${process.pid}-${Date.now()}.txt`;
  const fixturePath = path.join(__dirname, fixtureName);
  const fixtureRel = `builder-control/test/${fixtureName}`;
  fs.writeFileSync(fixturePath, 'bounded review fixture\n');
  try {
    const realCopy = fs.copyFileSync;
    try {
      fs.copyFileSync = function injectedCopyFailure(src, dest, flags) {
        if (String(dest).includes(`${path.sep}work${path.sep}`)) throw new Error('injected review copy failure');
        return realCopy.call(fs, src, dest, flags);
      };
      assertAtomicPreparationFailure('subject copy failure',
        () => prepareReviewSandbox([fixtureRel]), /injected review copy failure/);
    } finally {
      fs.copyFileSync = realCopy;
    }

    const realRead = fs.readFileSync;
    try {
      fs.readFileSync = function injectedReadFailure(target, ...args) {
        if (path.resolve(String(target)) === path.resolve(fixturePath)) throw new Error('injected review read failure');
        return realRead.call(fs, target, ...args);
      };
      assertAtomicPreparationFailure('subject read failure',
        () => prepareReviewSandbox([fixtureRel]), /injected review read failure/);
    } finally {
      fs.readFileSync = realRead;
    }

    try {
      fs.copyFileSync = function injectedDigestMismatch(src, dest, flags) {
        const result = realCopy.call(fs, src, dest, flags);
        if (String(dest).includes(`${path.sep}work${path.sep}`)) fs.appendFileSync(dest, 'altered');
        return result;
      };
      assertAtomicPreparationFailure('subject digest mismatch',
        () => prepareReviewSandbox([fixtureRel]), /review copy digest mismatch/);
    } finally {
      fs.copyFileSync = realCopy;
    }

    const operatorAuthExists = [
      path.join(os.homedir(), '.grok', 'auth.json'),
      path.join(os.homedir(), '.codex', 'auth.json'),
    ].some((value) => fs.existsSync(value));
    if (operatorAuthExists) {
      try {
        fs.copyFileSync = function injectedPostAuthCopyFailure(src, dest, flags) {
          const result = realCopy.call(fs, src, dest, flags);
          if (path.basename(dest) === 'auth.json') throw new Error('injected post-auth copy failure');
          return result;
        };
        assertAtomicPreparationFailure('partial auth copy failure',
          () => prepareReviewSandbox([fixtureRel]), /injected post-auth copy failure/);
      } finally {
        fs.copyFileSync = realCopy;
      }
    }
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
});

test('RED: runTool converts sandbox preparation failure into a structured refusal', async () => {
  const before = reviewSandboxRoots();
  const result = await runTool('codex', 'must never launch', 1, { reviewPaths: ['../outside'] });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.raw, '');
  assert.match(result.reason, /review sandbox preparation failed:.*escapes repository root/);
  assertNoNewReviewSandbox(before, 'runTool structured refusal');
});

test('RED: runTool cannot raise the observed Codex character ceiling or reach the watchdog', async () => {
  let launched = false;
  const result = await runTool('codex', 'x'.repeat(MAX_CODEX_INPUT_CHARACTERS + 1), 1, {
    reviewPaths: [],
    codexInputLimitCharacters: MAX_CODEX_INPUT_CHARACTERS * 2,
    codexInputLimitBytes: MAX_CODEX_INPUT_BYTES * 2,
    watchdogRunner: async () => { launched = true; throw new Error('must not launch'); },
  });
  assert.strictEqual(launched, false);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, new RegExp(`${MAX_CODEX_INPUT_CHARACTERS}-character maximum`));
  assert.match(result.reason, /review-chunker\.cjs for exact chunked coverage/);
});

test('RED: runTool sends the complete Codex bundle through stdin, never argv, and attests exact delivery', async () => {
  const reviewPaths = ['builder-control/MODEL-ROUTING-POLICY.json'];
  const before = reviewSandboxRoots();
  let observed = null;
  const result = await runTool('codex', 'PRIVATE PROMPT SENTINEL', 1, {
    reviewPaths,
    watchdogRunner: async (contained, options) => {
      observed = { contained, input: Buffer.from(options.stdinInput) };
      return {
        status: 0,
        signal: null,
        stdout: '{"disposition":"APPROVE","findings":[],"unverified":[]}',
        stderr: '',
        timedOut: false,
        outputOverflow: false,
        error: null,
        processGroupId: 4242,
        terminationSignals: [],
        terminationFailures: [],
        groupDrained: true,
        stdinDelivery: {
          delivered: true,
          bytes: options.stdinInput.length,
          sha256: crypto.createHash('sha256').update(options.stdinInput).digest('hex'),
          error: null,
        },
      };
    },
  });
  assert.strictEqual(result.ok, true, result.reason);
  assert.ok(observed, 'injected watchdog was not reached');
  assert.strictEqual(observed.contained.argv.at(-1), '-', 'Codex exec must read instructions from stdin');
  assert.ok(!observed.contained.argv.includes('PRIVATE PROMPT SENTINEL'), 'private prompt leaked into argv');
  assert.match(observed.input.toString('utf8'), /^PRIVATE PROMPT SENTINEL\n\n<<<AEGIS_CODEX_INSPECTION_CHALLENGES_V1_BEGIN>>>/);
  assert.strictEqual(result.inputDelivery.complete, true);
  assert.strictEqual(result.inputDelivery.delivered, true);
  assert.deepStrictEqual(result.inputDelivery.coveredPaths, reviewPaths);
  assert.strictEqual(result.inputDelivery.transport.bytes, observed.input.length);
  assert.strictEqual(result.inputDelivery.transport.sha256,
    crypto.createHash('sha256').update(observed.input).digest('hex'));
  assert.match(result.inputDelivery.deliveryAttestationSha256, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(result.completionEvidence, {
    authority: 'review-adapters.cjs runTool',
    status: 0,
    timedOut: false,
    outputOverflow: false,
    error: null,
    groupDrained: true,
    inputComplete: true,
    subjectSnapshotComplete: true,
    manifestSnapshotComplete: true,
    complete: true,
  });
  assertNoNewReviewSandbox(before, 'successful Codex stdin delivery');
});

test('RED: Codex stdin write failure refuses review truth and still removes the private sandbox', async () => {
  const reviewPaths = ['builder-control/MODEL-ROUTING-POLICY.json'];
  const before = reviewSandboxRoots();
  const result = await runTool('codex', 'P', 1, {
    reviewPaths,
    watchdogRunner: async (_contained, options) => ({
      status: null,
      signal: 'SIGTERM',
      stdout: '{"disposition":"APPROVE","findings":[]}',
      stderr: 'diagnostic only',
      timedOut: false,
      outputOverflow: false,
      error: null,
      processGroupId: 4243,
      terminationSignals: ['SIGTERM'],
      terminationFailures: [],
      groupDrained: true,
      stdinDelivery: {
        delivered: false,
        bytes: options.stdinInput.length,
        sha256: crypto.createHash('sha256').update(options.stdinInput).digest('hex'),
        error: { code: 'EPIPE', message: 'injected stdin write failure' },
      },
    }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.inputDelivery.complete, false);
  assert.match(result.reason, /EPIPE: injected stdin write failure/);
  assertNoNewReviewSandbox(before, 'Codex stdin write refusal');
});

test('RED: reviewer subprocess stdin is explicit and never inherited', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  assert.match(src, /stdio:\s*\[hasStdinInput\s*\?\s*'pipe'\s*:\s*'ignore',\s*'pipe',\s*'pipe'\]/,
    'Codex stdin must be piped exactly while Grok/no-input stdin remains closed');
});

test('RED: reviewer sandbox cleanup is guaranteed after every subprocess outcome', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  const start = src.indexOf('function runTool(');
  const end = src.indexOf('function cmdRun(', start);
  const runTool = src.slice(start, end);
  assert.match(runTool, /try\s*\{[\s\S]*await watchdogRunner[\s\S]*\}\s*finally\s*\{[\s\S]*cleanupReviewSandbox\(sandbox\)/,
    'review temp credentials/config can survive timeout, failure or success');
});

test('RED: watchdog writes and closes the exact bounded stdin bytes before accepting delivery', async () => {
  const input = Buffer.from('exact-codex-stdin\nwith-binary-safe-utf8-✓', 'utf8');
  const fixture = `
    const crypto = require('crypto');
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      const bytes = Buffer.concat(chunks);
      process.stdout.write(JSON.stringify({
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex')
      }));
    });
  `;
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', fixture],
  }, {
    timeoutMs: 2_000,
    killGraceMs: 50,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    stdinInput: input,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    bytes: input.length,
    sha256: crypto.createHash('sha256').update(input).digest('hex'),
  });
  assert.deepStrictEqual(result.stdinDelivery, {
    delivered: true,
    bytes: input.length,
    sha256: crypto.createHash('sha256').update(input).digest('hex'),
    error: null,
  });
  assert.strictEqual(result.groupDrained, true);
});

test('RED: watchdog catches a synchronous stdin writer failure and returns structured refusal evidence', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', 'setInterval(() => {}, 1000)'],
  }, {
    timeoutMs: 2_000,
    killGraceMs: 50,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    stdinInput: Buffer.from('must-not-be-accepted'),
    stdinWriter() {
      const error = new Error('injected synchronous write failure');
      error.code = 'EPIPE';
      throw error;
    },
  });
  assert.strictEqual(result.stdinDelivery.delivered, false);
  assert.deepStrictEqual(result.stdinDelivery.error, {
    code: 'EPIPE',
    message: 'injected synchronous write failure',
  });
  assert.strictEqual(result.groupDrained, true);
  assert.ok(result.terminationSignals.includes('SIGTERM'));
});

test('RED: synchronous spawn failure returns fail-closed stdin evidence instead of escaping cleanup', async () => {
  const input = Buffer.from('bounded input');
  const result = await runContainedWithWatchdog({ bin: null, argv: [] }, {
    timeoutMs: 100,
    maxOutputBytes: 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    stdinInput: input,
  });
  assert.strictEqual(result.status, null);
  assert.ok(result.error && result.error.message);
  assert.strictEqual(result.groupDrained, true);
  assert.deepStrictEqual(result.stdinDelivery, {
    delivered: false,
    bytes: input.length,
    sha256: crypto.createHash('sha256').update(input).digest('hex'),
    error: result.error,
  });
});

test('GREEN: immediate clean close proves an empty group without unsafe numeric kill probing', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  let probes = 0;
  const signals = [];
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', 'process.stdout.write("clean-close\\n")'],
  }, {
    timeoutMs: 2_000,
    killGraceMs: 100,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    processGroupAlive() {
      probes++;
      return true; // Represents immediate reuse of the old numeric PGID.
    },
    signalProcessGroup(_pid, signal) {
      signals.push(signal);
      return true;
    },
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, 'clean-close\n');
  assert.strictEqual(result.groupDrained, true,
    'a normal clean child close was misreported as forced termination');
  await new Promise((resolve) => setTimeout(resolve, 175));
  assert.strictEqual(probes, 0, 'close-driven settlement used the unsafe kill(0) group probe after close');
  assert.deepStrictEqual(signals, [], 'close-driven settlement signalled a reusable numeric process group');
});

test('RED: normal reviewer close drains a stdio-closed descendant before returning usable evidence', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const fixture = `
    const { spawn } = require('child_process');
    const descendant = spawn(process.execPath, ['-e',
      'process.on("SIGTERM",()=>{});if(process.send)process.send("ready");setInterval(()=>{},1000)'
    ], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    descendant.once('message', () => {
      process.stdout.write('stdio-closed-descendant:' + descendant.pid + '\\n', () => process.exit(0));
    });
  `;
  const started = Date.now();
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', fixture],
  }, {
    timeoutMs: 2_000,
    killGraceMs: 75,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
  });
  const elapsed = Date.now() - started;
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.timedOut, false);
  assert.match(result.stdout, /stdio-closed-descendant:/);
  assert.ok(result.terminationSignals.includes('SIGTERM'), 'residual descendant did not receive TERM');
  assert.ok(result.terminationSignals.includes('SIGKILL'), 'TERM-resistant residual descendant did not receive KILL');
  assert.ok(elapsed >= 75, `watchdog returned before its descendant drain grace (${elapsed}ms)`);
  assert.strictEqual(result.groupDrained, true, 'normal close was accepted before positive group drainage');
  assert.strictEqual(processGroupAlive(result.processGroupId), false,
    'reviewer group remained live after the normal-close result became usable');
  const match = result.stdout.match(/stdio-closed-descendant:(\d+)/);
  assert.ok(match, 'descendant PID evidence was not captured');
  assert.throws(() => process.kill(Number(match[1]), 0), { code: 'ESRCH' },
    'stdio-closed reviewer descendant survived normal completion');
});

test('RED: normal close refuses a reused numeric process-group id without signalling it', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const signals = [];
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', 'process.stdout.write("closed-before-reuse\\n")'],
  }, {
    timeoutMs: 2_000,
    killGraceMs: 50,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    processGroupMembers(processGroupId) {
      return [processGroupId]; // A leader at pid===pgid after close means reuse.
    },
    signalProcessGroup(_processGroupId, signal) {
      signals.push(signal);
      return true;
    },
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.groupDrained, false,
    'a reused process-group id was accepted as the closed reviewer group');
  assert.ok(result.terminationFailures.some((failure) =>
    failure.code === 'PROCESS_GROUP_REUSED' && failure.phase === 'close-proof'));
  assert.deepStrictEqual(signals, [], 'the reused numeric process group was signalled');
});

test('RED: grace escalation cannot probe or SIGKILL a reused process group after child settlement', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  let representsReusedGroup = false;
  let postSettlementProbes = 0;
  const postSettlementSignals = [];
  const deliveredSignals = [];
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', 'setInterval(() => {}, 1000)'],
  }, {
    // Give the child enough time to install its SIGTERM handler before the
    // watchdog fires. At 50 ms, a loaded host could terminate Node during
    // startup and make this injected probe-error assertion nondeterministic.
    timeoutMs: 500,
    killGraceMs: 250,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    processGroupAlive(pid) {
      if (representsReusedGroup) {
        postSettlementProbes++;
        return true;
      }
      return processGroupAlive(pid);
    },
    signalProcessGroup(pid, signal) {
      if (representsReusedGroup) {
        postSettlementSignals.push(signal);
        return true;
      }
      deliveredSignals.push(signal);
      process.kill(-pid, signal);
      return true;
    },
  });
  assert.strictEqual(result.timedOut, true);
  assert.deepStrictEqual(deliveredSignals, ['SIGTERM'],
    'the original TERM-responsive child unexpectedly required escalation');
  assert.strictEqual(result.groupDrained, true);

  // Simulate the immutable child having settled while its old numeric process
  // group id now names unrelated work. A stale grace callback must not even
  // probe that id, much less deliver KILL.
  representsReusedGroup = true;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.strictEqual(postSettlementProbes, 0, 'stale grace callback probed a reused process-group id');
  assert.deepStrictEqual(postSettlementSignals, [], 'stale grace callback signalled a reused process group');
});

test('RED: the reviewer watchdog hard-kills a TERM-resistant process group', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const { runContainedWithWatchdog, processGroupAlive } = require('../review-adapters.cjs');
  const fixture = `
    const { spawn } = require('child_process');
    process.on('SIGTERM', () => {});
    const descendant = spawn(process.execPath, ['-e',
      'process.on("SIGTERM",()=>{});process.stdout.write("descendant-ready\\n");setInterval(()=>{},1000)'
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    process.stdout.write('fixture-ready:' + descendant.pid + '\\n');
    setInterval(() => {}, 1000);
  `;
  const started = Date.now();
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', fixture],
  }, {
    timeoutMs: 100,
    killGraceMs: 100,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
  });
  const elapsed = Date.now() - started;
  assert.strictEqual(result.timedOut, true);
  assert.ok(elapsed < 1_000, `hard timeout returned after ${elapsed}ms`);
  assert.ok(result.terminationSignals.includes('SIGTERM'));
  assert.ok(result.terminationSignals.includes('SIGKILL'));
  assert.strictEqual(result.groupDrained, true);
  assert.strictEqual(processGroupAlive(result.processGroupId), false,
    'owned reviewer process group survived the watchdog');
  assert.match(result.stdout, /fixture-ready:/);
  const match = result.stdout.match(/fixture-ready:(\d+)/);
  assert.ok(match, 'fixture descendant PID was not retained in partial output');
  assert.throws(() => process.kill(Number(match[1]), 0), { code: 'ESRCH' },
    'TERM-resistant descendant survived the watchdog');
});

test('reviewer output activity extends the idle deadline without removing the hard cap', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const fixture = `
    let count = 0;
    const timer = setInterval(() => {
      process.stdout.write('progress-' + (++count) + '\\n');
      if (count === 6) { clearInterval(timer); process.exit(0); }
    }, 100);
  `;
  const started = Date.now();
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', fixture],
  }, {
    timeoutMs: 250,
    activityExtendsTimeout: true,
    hardTimeoutMs: 1_200,
    killGraceMs: 75,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.timedOut, false);
  assert.strictEqual(result.timeoutReason, null);
  assert.match(result.stdout, /progress-6/);
  assert.ok(Date.now() - started >= 500, 'fixture did not actually outlive the idle deadline');
});

test('continuous reviewer chatter cannot evade the absolute hard cap', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const fixture = `
    process.on('SIGTERM', () => {});
    setInterval(() => process.stdout.write('still-working\\n'), 50);
  `;
  const started = Date.now();
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', fixture],
  }, {
    timeoutMs: 150,
    activityExtendsTimeout: true,
    hardTimeoutMs: 500,
    killGraceMs: 75,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
  });
  const elapsed = Date.now() - started;
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(result.timeoutReason, 'hard-cap');
  assert.ok(elapsed >= 450 && elapsed < 1_500, `hard cap was not bounded: ${elapsed}ms`);
  assert.strictEqual(result.groupDrained, true);
});

test('RED: an injected initial TERM failure is retained and cannot escape asynchronously', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const fixture = 'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000)';
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', fixture],
  }, {
    timeoutMs: 75,
    killGraceMs: 75,
    maxOutputBytes: 64 * 1024,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    signalProcessGroup(pid, signal) {
      if (signal === 'SIGTERM') {
        const error = new Error('injected TERM delivery failure');
        error.code = 'EACCES';
        throw error;
      }
      process.kill(-pid, signal);
      return true;
    },
  });
  assert.strictEqual(result.timedOut, true);
  assert.ok(result.terminationFailures.some((failure) =>
    failure.phase === 'initial' && failure.signal === 'SIGTERM' && failure.code === 'EACCES'));
  assert.ok(result.terminationSignals.includes('SIGKILL'), 'the watchdog did not recover with group KILL');
  assert.strictEqual(result.groupDrained, true, 'successful escalation did not prove group drainage');
});

test('RED: injected grace KILL failures resolve fail-closed with undrained evidence', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const fixture = 'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000)';
  let result;
  try {
    result = await runContainedWithWatchdog({
      bin: process.execPath,
      argv: ['-e', fixture],
    }, {
      // Let the child install its SIGTERM handler before fault injection. A
      // startup-race result proves only host load, not KILL-failure handling.
      timeoutMs: 500,
      killGraceMs: 50,
      maxOutputBytes: 64 * 1024,
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH },
      signalProcessGroup(pid, signal) {
        if (signal === 'SIGKILL') {
          const error = new Error('injected KILL delivery failure');
          error.code = 'EPERM';
          throw error;
        }
        process.kill(-pid, signal);
        return true;
      },
    });
    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.groupDrained, false,
      'unproven termination was reported as a drained reviewer group');
    assert.ok(result.terminationFailures.some((failure) =>
      failure.phase === 'grace' && failure.signal === 'SIGKILL' && failure.code === 'EPERM'),
    'the asynchronous grace-callback failure was not retained');
    assert.ok(result.terminationFailures.some((failure) => failure.signal === 'SIGKILL'),
      'no KILL failure evidence survived into the result');
  } finally {
    if (result && processGroupAlive(result.processGroupId)) {
      try { process.kill(-result.processGroupId, 'SIGKILL'); } catch {}
    }
  }
});

test('RED: Grok subprocess HOME is the isolated review harness', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  assert.match(src, /HOME:\s*sandbox\.home/,
    'Grok must not rediscover interactive MCPs and rules through the operator HOME');
});

test('RED: reviewer environment is a strict allowlist with no operator secrets', () => {
  const { prepareReviewSandbox, cleanupReviewSandbox, reviewerEnvironment } = require('../review-adapters.cjs');
  const sandbox = prepareReviewSandbox();
  try {
    const source = {
      LANG: 'en_CA.UTF-8',
      ANTHROPIC_API_KEY: 'must-not-cross',
      XAI_API_KEY: 'must-not-cross',
      GITHUB_TOKEN: 'must-not-cross',
      AWS_SECRET_ACCESS_KEY: 'must-not-cross',
      GIT_DIR: '/tmp/ambient-git-dir',
      GIT_WORK_TREE: '/tmp/ambient-git-worktree',
    };
    for (const reviewer of ['codex', 'grok']) {
      const env = reviewerEnvironment(reviewer, sandbox, source);
      assert.strictEqual(env.LANG, 'en_CA.UTF-8');
      for (const secret of ['ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY']) {
        assert.ok(!Object.prototype.hasOwnProperty.call(env, secret), `${reviewer} inherited ${secret}`);
      }
      assert.ok(!Object.keys(env).some((key) => key.startsWith('GIT_')),
        `${reviewer} inherited ambient Git coordinates`);
      assert.deepStrictEqual(Object.keys(env).sort(),
        (reviewer === 'codex'
          ? ['CODEX_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR']
          : ['GROK_DISABLE_AUTOUPDATER', 'GROK_MANAGED_MCPS_ENABLED', 'HOME', 'LANG', 'PATH', 'TMPDIR']).sort());
      if (reviewer === 'grok') assert.strictEqual(env.GROK_DISABLE_AUTOUPDATER, '1');
    }
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: reviewer CLI alone can read its disposable HOME while copied subject remains read-only', () => {
  if (process.platform !== 'darwin') return skip('macOS sandbox-exec proof requires darwin');
  if (proveInheritedImmutableCheckBoundary()) {
    return skip('process-only reviewer HOME split requires the mandatory top-level host suite; inherited immutable containment was proven without nesting sandbox-exec');
  }
  const {
    buildMacSandboxProfile,
    sandboxedCommand,
    strictEnvironment,
    sandboxCapability,
  } = require('../sandbox-containment.cjs');
  if (!sandboxCapability().available) return skip('macOS sandbox-exec capability is unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-home-proof-'));
  try {
    const subjectDir = path.join(root, 'work');
    const home = path.join(root, 'home');
    const tmp = path.join(root, 'tmp');
    fs.mkdirSync(subjectDir);
    fs.mkdirSync(home);
    fs.mkdirSync(tmp);
    const subject = path.join(subjectDir, 'subject.txt');
    const privateCache = path.join(home, 'cache.txt');
    fs.writeFileSync(subject, 'SUBJECT');
    fs.writeFileSync(privateCache, 'PRIVATE');
    const profile = buildMacSandboxProfile({
      root,
      executable: '/bin/bash',
      readPaths: [subjectDir],
      writePaths: [home, tmp],
      processOnlyReadDirectoryPaths: [home, tmp],
      allowNetwork: false,
      reviewerRuntime: true,
    });
    const run = (script, args = []) => {
      const command = sandboxedCommand(profile, ['-c', script, 'aegis-test', ...args]);
      return spawnSync(command.bin, command.argv, { encoding: 'utf8', env: strictEnvironment() });
    };
    assert.strictEqual(run('IFS= read -r value < "$1"; printf "%s" "$value"', [privateCache]).stdout, 'PRIVATE',
      'pinned reviewer executable could not read its disposable cache');
    const deniedCredentialRead = run('/bin/cat "$1"', [privateCache]);
    assert.notStrictEqual(deniedCredentialRead.status, 0,
      'a model-issued child process read disposable HOME contents');
    assert.ok(!deniedCredentialRead.stdout.includes('PRIVATE'));
    assert.strictEqual(run('/bin/cat "$1"', [subject]).stdout, 'SUBJECT',
      'bounded copied subject was not readable');
    assert.strictEqual(run('printf ok > "$1"', [path.join(home, 'new-cache.txt')]).status, 0,
      'disposable reviewer HOME was not writable');
    assert.strictEqual(run('printf ok > "$1"', [path.join(tmp, 'runtime.tmp')]).status, 0,
      'disposable reviewer TMPDIR was not writable');
    assert.notStrictEqual(run('printf changed > "$1"', [subject]).status, 0,
      'copied review subject became writable');
    assert.strictEqual(fs.readFileSync(subject, 'utf8'), 'SUBJECT');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RED: contained reviewer profile grants no write authority to copied subject or operator HOME', () => {
  if (process.platform !== 'darwin') return skip('macOS sandbox profile proof requires darwin');
  const {
    prepareReviewSandbox,
    cleanupReviewSandbox,
    containedReviewerCommand,
  } = require('../review-adapters.cjs');
  const sandbox = prepareReviewSandbox();
  try {
    const disposable = [sandbox.home, sandbox.tmp].map((value) => fs.realpathSync(value)).sort();
    for (const reviewer of ['codex', 'grok']) {
      const contained = containedReviewerCommand(reviewer, sandbox, ['--version']);
      const expectedReads = [sandbox.cwd, ...(reviewer === 'grok' ? [sandbox.grokConfigPath] : [])]
        .map((value) => fs.realpathSync(value)).sort();
      const auth = reviewer === 'codex' ? sandbox.codexAuthPath : sandbox.grokAuthPath;
      const expectedCredentialReads = auth ? [fs.realpathSync(auth)] : [];
      assert.deepStrictEqual(contained.profile.writePaths.slice().sort(), disposable);
      assert.deepStrictEqual(contained.profile.processOnlyReadDirectoryPaths.slice().sort(), disposable);
      assert.deepStrictEqual(contained.profile.readPaths.slice().sort(), expectedReads);
      assert.deepStrictEqual(contained.profile.processOnlyReadPaths.slice().sort(), expectedCredentialReads);
      assert.ok(!contained.profile.writePaths.includes(fs.realpathSync(sandbox.cwd)));
      const lines = contained.profile.profile.trim().split('\n');
      assert.ok(!lines.includes(`(allow file-read* (subpath ${JSON.stringify(fs.realpathSync(os.homedir()))}))`),
        `${reviewer} received broad actual operator HOME read authority`);
      assert.ok(!contained.profile.profile.includes(JSON.stringify(path.join(os.homedir(), '.codex', 'auth.json'))));
      assert.ok(!contained.profile.profile.includes(JSON.stringify(path.join(os.homedir(), '.grok', 'auth.json'))));
      assert.ok(!contained.profile.profile.includes(`${path.sep}Keychains`));
      assert.ok(!lines.includes('(allow file-read*)'));
      assert.ok(!lines.includes('(allow file-write*)'));
      assert.ok(!lines.includes('(allow process*)'), `${reviewer} retained blanket child-process authority`);
      assert.ok(lines.some((line) => line.startsWith('(allow process-exec (literal ')),
        `${reviewer} has no pinned executable authority`);
      assert.ok(!lines.includes('(allow network-outbound)'), `${reviewer} retained ambient outbound network`);
      assert.ok(lines.some((line) => line.startsWith('(allow network-outbound (process-path ')),
        `${reviewer} network was not bound to the pinned CLI process`);
    }
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: process-only disposable directory reads reject files, escapes, and symlinks', () => {
  if (process.platform !== 'darwin') return skip('macOS process-read validation requires darwin');
  const { buildMacSandboxProfile } = require('../sandbox-containment.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-process-read-validation-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-process-read-outside-'));
  try {
    const file = path.join(root, 'file.txt');
    const outsideDir = path.join(outside, 'dir');
    const link = path.join(root, 'escape-link');
    fs.writeFileSync(file, 'x');
    fs.mkdirSync(outsideDir);
    fs.symlinkSync(outsideDir, link);
    const make = (value) => buildMacSandboxProfile({
      root,
      executable: '/bin/bash',
      processOnlyReadDirectoryPaths: [value],
      allowNetwork: false,
    });
    assert.throws(() => make(file), /must resolve to a directory/);
    assert.throws(() => make(outsideDir), /escapes containment root/);
    assert.throws(() => make(link), /escapes containment root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('RED: Grok model tools can read only the copied review tree, not credential HOME', () => {
  const { prepareReviewSandbox, cleanupReviewSandbox, buildToolArgv } = require('../review-adapters.cjs');
  const sandbox = prepareReviewSandbox();
  try {
    const argv = buildToolArgv('grok', 'P', { maxTurns: 1, webAccess: false }, sandbox.cwd);
    const allowAt = argv.indexOf('--allow');
    assert.strictEqual(argv[allowAt + 1], `Read(${sandbox.cwd}/**)`);
    const denyRules = argv.reduce((all, value, index) => value === '--deny' ? [...all, argv[index + 1]] : all, []);
    assert.ok(denyRules.includes(`Read(${sandbox.home}/**)`));
    assert.ok(denyRules.includes('Read(../**)'));
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: packet filesAllowed is the fail-closed review subject authority', () => {
  const { resolveBoundedReviewPaths } = require('../review-adapters.cjs');
  const rel = 'builder-control/review-adapters.cjs';
  assert.deepStrictEqual(resolveBoundedReviewPaths(
    { subjectPaths: [rel] },
    { filesAllowed: [rel], sourceOfTruth: [] },
  ), [rel]);
  assert.throws(() => resolveBoundedReviewPaths(
    { subjectPaths: [rel] },
    { filesAllowed: ['builder-control/aegis-run.cjs'], sourceOfTruth: [] },
  ), /outside packet filesAllowed/);
  assert.throws(() => resolveBoundedReviewPaths(
    { subjectPaths: [rel] },
    { filesAllowed: [rel], sourceOfTruth: ['builder-control/ledger.json'] },
  ), /sensitive or runtime/);
});

test('RED: OS sandbox denies unrelated reads and non-allowlisted writes', () => {
  if (process.platform !== 'darwin') return skip('macOS sandbox enforcement proof requires darwin');
  if (proveInheritedImmutableCheckBoundary()) return;
  const {
    buildMacSandboxProfile,
    sandboxedCommand,
    strictEnvironment,
    sandboxCapability,
  } = require('../sandbox-containment.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-containment-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-containment-outside-'));
  try {
    const readable = path.join(root, 'allowed.txt');
    const writable = path.join(root, 'write');
    const deniedInside = path.join(root, 'denied.txt');
    const deniedOutside = path.join(outside, 'secret.txt');
    fs.writeFileSync(readable, 'ALLOWED');
    fs.mkdirSync(writable);
    fs.writeFileSync(deniedInside, 'DENIED');
    fs.writeFileSync(deniedOutside, 'SECRET');
    const profile = buildMacSandboxProfile({
      root,
      executable: '/bin/bash',
      readPaths: [readable],
      writePaths: [writable],
      allowNetwork: false,
    });
    const run = (script, args = []) => {
      const command = sandboxedCommand(profile, ['-c', script, 'aegis-test', ...args]);
      return spawnSync(command.bin, command.argv, { encoding: 'utf8', env: strictEnvironment() });
    };
    const capability = sandboxCapability();
    if (!capability.available) {
      const refused = run('exit 0');
      assert.notStrictEqual(refused.status, 0, 'unavailable OS containment failed open');
      assert.match(capability.reason, /refusing|failed|unavailable|not permitted/i);
      return;
    }
    assert.strictEqual(run('IFS= read -r value < "$1"; printf "%s" "$value"', [readable]).stdout, 'ALLOWED');
    assert.notStrictEqual(run('IFS= read -r value < "$1"', [deniedInside]).status, 0);
    assert.notStrictEqual(run('IFS= read -r value < "$1"', [deniedOutside]).status, 0);
    assert.strictEqual(run('printf ok > "$1"', [path.join(writable, 'ok.txt')]).status, 0);
    assert.notStrictEqual(run('printf bad > "$1"', [deniedInside]).status, 0);
    assert.notStrictEqual(run('printf bad > "$1"', [path.join(outside, 'bad.txt')]).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('RED: bounded reviewer reads work through one outer sandbox while nested sandbox-exec is refused', () => {
  if (process.platform !== 'darwin') return skip('nested macOS sandbox behavior requires darwin');
  if (proveInheritedImmutableCheckBoundary()) return;
  const {
    buildMacSandboxProfile,
    sandboxedCommand,
    strictEnvironment,
    sandboxCapability,
  } = require('../sandbox-containment.cjs');
  if (!sandboxCapability().available) return skip('macOS sandbox-exec capability is unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-read-proof-'));
  try {
    const readable = path.join(root, 'subject.txt');
    const denied = path.join(root, 'unrelated.txt');
    fs.writeFileSync(readable, 'BOUNDED');
    fs.writeFileSync(denied, 'DENIED');

    const nestedOuter = buildMacSandboxProfile({
      root,
      executable: '/usr/bin/sandbox-exec',
      readPaths: [readable],
      allowNetwork: false,
      reviewerRuntime: true,
    });
    const innerProfile = [
      '(version 1)',
      '(deny default)',
      '(allow process*)',
      `(allow file-read* (literal "${readable}"))`,
    ].join('\n');
    const nested = sandboxedCommand(nestedOuter, ['-p', innerProfile, '/bin/cat', readable]);
    const nestedResult = spawnSync(nested.bin, nested.argv, {
      encoding: 'utf8', env: strictEnvironment(),
    });
    assert.notStrictEqual(nestedResult.status, 0,
      'the historical nested reviewer sandbox unexpectedly initialized');
    assert.match(String(nestedResult.stderr), /sandbox_apply: Operation not permitted/,
      'the proof must reproduce the exact bounded-review failure');

    const directOuter = buildMacSandboxProfile({
      root,
      executable: '/bin/cat',
      readPaths: [readable],
      allowNetwork: false,
      reviewerRuntime: true,
    });
    const directRead = sandboxedCommand(directOuter, [readable]);
    const allowed = spawnSync(directRead.bin, directRead.argv, {
      encoding: 'utf8', env: strictEnvironment(),
    });
    assert.strictEqual(allowed.status, 0);
    assert.strictEqual(allowed.stdout, 'BOUNDED');

    const deniedRead = sandboxedCommand(directOuter, [denied]);
    assert.notStrictEqual(spawnSync(deniedRead.bin, deniedRead.argv, {
      encoding: 'utf8', env: strictEnvironment(),
    }).status, 0, 'outer containment allowed an unrelated sibling read');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('RED: reusable worker containment rejects packet paths outside its worktree', () => {
  const { prepareWorkerContainment } = require('../sandbox-containment.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-worker-containment-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-worker-outside-'));
  try {
    const allowed = path.join(root, 'subject.cjs');
    const writeDir = path.join(root, 'out');
    const foreign = path.join(outside, 'foreign.cjs');
    fs.writeFileSync(allowed, 'module.exports = 1;');
    fs.mkdirSync(writeDir);
    fs.writeFileSync(foreign, 'secret');
    assert.throws(() => prepareWorkerContainment({
      worktree: root,
      executable: '/bin/bash',
      packetReadPaths: [allowed, foreign],
      packetWritePaths: [writeDir],
    }), /escapes containment root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('RED: reviewer runtime allowances never leak into the worker profile', () => {
  const { buildMacSandboxProfile } = require('../sandbox-containment.cjs');
  if (process.platform !== 'darwin') return skip('macOS runtime scope proof requires darwin');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-runtime-scope-'));
  try {
    const allowed = path.join(root, 'allowed.txt');
    fs.writeFileSync(allowed, 'ok');
    const worker = buildMacSandboxProfile({
      root,
      executable: '/usr/bin/true',
      readPaths: [allowed],
      reviewerRuntime: false,
    }).profile;
    const reviewer = buildMacSandboxProfile({
      root,
      executable: '/usr/bin/true',
      readPaths: [allowed],
      reviewerRuntime: true,
    }).profile;
    assert.ok(!worker.includes('(allow system-socket)'));
    assert.ok(!worker.includes('(allow user-preference-read)'));
    assert.ok(reviewer.includes('(allow system-socket)'));
    assert.ok(reviewer.includes('(allow user-preference-read)'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── PROVEN DEFECT D2 (2026-08-25): envelope verdicts were discarded ────────
// Several CLIs return {text, stopReason, usage, num_turns} with the model's
// answer inside `text`. extractJson returned the envelope, isUsableReview saw
// no disposition, and a genuine REJECT was recorded as UNAVAILABLE. The
// reviewer was blamed three times for "producing no parseable JSON".
test('RED: a verdict inside a CLI envelope is RECOVERED, not discarded', () => {
  const env = JSON.stringify({
    text: 'Here is my review:\n{"disposition":"REJECT","findings":[{"severity":"HIGH","file":"x.cjs","location":"1","problem":"p","evidence":"e","impact":"i","requiredCorrection":"c","verificationMethod":"v","status":"OPEN"}],"unverified":[]}',
    stopReason: 'end_turn', num_turns: 5, total_cost_usd: 0.12,
  });
  const got = extractJson(env);
  assert.ok(got, 'nothing extracted');
  assert.strictEqual(got.disposition, 'REJECT', 'the real verdict was thrown away');
  assert.strictEqual(got.findings.length, 1, 'findings were lost with it');
  assert.strictEqual(isUsableReview(got), true);
});

test('RED: an envelope with NO verdict inside is still UNAVAILABLE', () => {
  // The opposite failure would be worse: inventing a verdict from a cancelled run.
  const env = JSON.stringify({ text: 'I could not finish the review', stopReason: 'cancelled', num_turns: 9 });
  assert.strictEqual(isUsableReview(extractJson(env)), false,
    'a cancelled run must never yield a usable verdict');
});

test('RED: envelope unwrapping is bounded to one level', () => {
  const nested = JSON.stringify({ text: JSON.stringify({ text: '{"disposition":"APPROVE"}' }) });
  assert.strictEqual(isUsableReview(extractJson(nested)), false,
    'unbounded unwrapping would let arbitrary nesting smuggle a verdict');
});

test('a plain JSON verdict with no envelope still works', () => {
  const got = extractJson('prose {"disposition":"APPROVE","findings":[],"unverified":[]} trailing');
  assert.strictEqual(got.disposition, 'APPROVE');
  assert.strictEqual(isUsableReview(got), true);
});

// ── PROVEN DEFECT (2026-08-25): schema-valid ≠ real ───────────────────────
// --json-schema constrains the model to emit conforming JSON on EVERY turn, so
// a run cut off mid-investigation still emits a perfect-looking verdict. The
// fixture below is the REAL output of a truncated run, kept in the repo:
//   {"disposition":"REJECT","findings":[{"severity":"HIGH","location":"pending",
//     "problem":"Full prompt and subject files not yet inspected; starting…"}]}
// Constraining output makes this gap WIDER, not narrower — the placeholder now
// passes every syntactic check a record has.
const TRUNCATED_FIXTURE = path.join(__dirname, '..', 'review-raw', '20260825021136-grok.txt');

test('RED: the real truncated run is detected as an abnormal stop', () => {
  if (!fs.existsSync(TRUNCATED_FIXTURE)) {
    return skip(`frozen fixture unavailable: ${path.basename(TRUNCATED_FIXTURE)}`);
  }
  const raw = fs.readFileSync(TRUNCATED_FIXTURE, 'utf8');
  assert.ok(stopWasAbnormal(raw), 'a run that ended "max turns reached" must be flagged abnormal');
});

test('RED: the real truncated run DOES parse as a schema-valid verdict — which is the danger', () => {
  if (!fs.existsSync(TRUNCATED_FIXTURE)) {
    return skip(`frozen fixture unavailable: ${path.basename(TRUNCATED_FIXTURE)}`);
  }
  const raw = fs.readFileSync(TRUNCATED_FIXTURE, 'utf8');
  const v = extractJson(raw);
  assert.strictEqual(v && v.disposition, 'REJECT',
    'this fixture exists precisely because it looks like a real verdict');
  // The ORIGINAL assertion here checked looksUnfinished, which was true while
  // the parser returned the first-turn placeholder. Now that the parser returns
  // the LAST object, this fixture surfaces a later, plausible-looking finding —
  // and the placeholder heuristic no longer fires on it. That is exactly why the
  // abnormal-stop guard has to be the primary defence: it does not depend on the
  // payload looking wrong, only on the run not having finished.
  assert.ok(stopWasAbnormal(raw),
    'the stop guard must catch a truncated run even when its payload looks perfectly finished');
});

test('RED: the placeholder heuristic still fires on a genuine placeholder', () => {
  const placeholder = { disposition: 'REJECT', findings: [
    { severity: 'HIGH', file: 'x.cjs', location: 'pending', problem: 'not yet inspected', evidence: 'e', status: 'OPEN' },
  ] };
  assert.strictEqual(looksUnfinished(placeholder), true,
    'the secondary net must still catch a self-declared placeholder that stopped cleanly');
});

test('RED: placeholder findings are recognised across the phrasings a model uses', () => {
  for (const marker of ['pending', 'not yet inspected', 'starting adversarial review', 'in progress', 'TBD']) {
    assert.strictEqual(
      looksUnfinished({ disposition: 'REJECT', findings: [{ location: marker, problem: 'x' }] }),
      true, `"${marker}" was not recognised as a placeholder`);
  }
});

test('RED: a clean stop that admits required reads are incomplete is still a placeholder', () => {
  for (const admission of ['reads not yet completed', 'Required reads are not yet completed.']) {
    const premature = { disposition: 'REJECT', findings: [], unverified: [admission] };
    assert.strictEqual(looksUnfinished(premature), true,
      `a one-turn verdict must not count when the reviewer admits: ${admission}`);
  }
});

test('RED: completed findings that discuss unfinished product work are not placeholder reviews', () => {
  const completedCodexFinding = {
    disposition: 'REJECT',
    findings: [{
      severity: 'MEDIUM',
      file: 'builder-control/review-adapters.cjs',
      location: 'PLACEHOLDER / looksUnfinished',
      problem: 'The unfinished-review detector rejects completed review records whenever any unverified item contains the generic phrase "not yet completed", even when it truthfully describes a bounded verification limitation rather than an unfinished verdict.',
      evidence: 'The completed review inspected the supplied diff.',
      status: 'OPEN',
    }],
    unverified: [
      'The out-of-scope deployment is not completed.',
      'Whether the normal pending-state bug reproduces in an unrelated component.',
    ],
  };
  assert.strictEqual(looksUnfinished(completedCodexFinding), false,
    'normal finding language must not be mistaken for a self-declared unfinished review');
});

test('RED: an explicit problem admission still identifies a placeholder review', () => {
  const premature = {
    disposition: 'REJECT',
    findings: [{ location: 'inspection', problem: 'Full prompt and subject files not yet inspected; starting review.' }],
  };
  assert.strictEqual(looksUnfinished(premature), true);
});

test('a genuine finished verdict is NOT flagged as unfinished', () => {
  const real = { disposition: 'REJECT', findings: [
    { severity: 'HIGH', file: 'x.cjs', location: 'line 42', problem: 'auth bypass on the admin route', evidence: 'code', status: 'OPEN' },
  ] };
  assert.strictEqual(looksUnfinished(real), false, 'the guard must not eat real findings');
  assert.strictEqual(stopWasAbnormal(JSON.stringify({ text: '{}', stopReason: 'end_turn' })), null);
});

test('RED: Codex JSONL verdict and terminal metadata are independent fail-closed evidence', () => {
  const verdict = { disposition: 'APPROVE', findings: [], unverified: [], inspectionProofs: [] };
  const cleanCompletion = {
    authority: 'review-adapters.cjs runTool', status: 0,
    timedOut: false, outputOverflow: false, error: null, groupDrained: true,
    inputComplete: true, subjectSnapshotComplete: true, manifestSnapshotComplete: true,
    complete: true,
  };
  const message = { type: 'item.completed', item: { id: 'item_0', type: 'agent_message',
    text: JSON.stringify(verdict) } };
  const terminal = { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } };
  const actualJsonl = [message, terminal].map(JSON.stringify).join('\n');
  const completed = validateCodexTerminalEnvelope(actualJsonl, cleanCompletion);
  assert.strictEqual(completed.ok, true, completed.reason);
  assert.strictEqual(completed.terminalType, 'turn.completed');
  assert.deepStrictEqual(extractJson(actualJsonl), verdict,
    'the final Codex agent_message was not extracted from JSONL');

  const missing = validateCodexTerminalEnvelope(JSON.stringify(message), cleanCompletion);
  assert.strictEqual(missing.ok, false, 'agent message without turn.completed was accepted');
  assert.match(missing.reason, /count is 0; exactly one is required/);
  for (const unsafe of [
    { status: 1, complete: false },
    { timedOut: true, complete: false },
    { outputOverflow: true, complete: false },
    { error: 'spawn failed', complete: false },
    { groupDrained: false, complete: false },
    { inputComplete: false, complete: false },
    { subjectSnapshotComplete: false, complete: false },
    { manifestSnapshotComplete: false, complete: false },
  ]) {
    const refused = validateCodexTerminalEnvelope(actualJsonl, {
      ...cleanCompletion, ...unsafe,
    });
    assert.strictEqual(refused.ok, false,
      `plain stdout was accepted with unsafe completion: ${JSON.stringify(unsafe)}`);
  }

  const duplicate = validateCodexTerminalEnvelope([message, terminal, terminal]
    .map(JSON.stringify).join('\n'), cleanCompletion);
  assert.strictEqual(duplicate.ok, false, 'duplicate successful terminals were accepted');
  assert.match(duplicate.reason, /count is 2/);

  const failed = validateCodexTerminalEnvelope([message, { type: 'turn.failed', error: { message: 'cancelled' } }]
    .map(JSON.stringify).join('\n'), cleanCompletion);
  assert.strictEqual(failed.ok, false, 'turn.failed was accepted');
  assert.match(failed.reason, /did not complete successfully/);
  assert.strictEqual(stopWasAbnormal(JSON.stringify({ type: 'turn.failed' })), 'turn.failed');

  const postTerminal = validateCodexTerminalEnvelope([message, terminal,
    { type: 'item.completed', item: { type: 'agent_message', text: '{}' } }]
    .map(JSON.stringify).join('\n'), cleanCompletion);
  assert.strictEqual(postTerminal.ok, false, 'post-terminal protocol event was accepted');
  assert.match(postTerminal.reason, /after turn\.completed/);
});

test('RED: run-bound review data class comes only from the canonical run', () => {
  const context = { runId: 'RUN-20260830-aaaaaaaa', run: { dataClass: 'CONFIDENTIAL' } };
  assert.strictEqual(resolveReviewDataClass(context), 'CONFIDENTIAL');
  assert.strictEqual(resolveReviewDataClass(context, 'CONFIDENTIAL'), 'CONFIDENTIAL');
  for (const conflicting of ['PUBLIC', 'INTERNAL', 'RESTRICTED', 'SENSITIVE', '']) {
    assert.throws(() => resolveReviewDataClass(context, conflicting), /conflicts with run/);
  }
  assert.throws(() => resolveReviewDataClass({ runId: context.runId, run: {} }),
    /has no canonical data class/);
  assert.strictEqual(resolveReviewDataClass({ runId: null }, undefined), 'INTERNAL');
});

test('RED: an abnormal stop outranks a parseable payload', () => {
  // Order matters: if the payload were trusted first, a truncated run's
  // placeholder would be recorded as a real REJECT at the gate.
  const truncated = JSON.stringify({
    text: '{"disposition":"APPROVE","findings":[]}',
    stopReason: 'max_turns', num_turns: 16,
  });
  assert.ok(stopWasAbnormal(truncated), 'max_turns must be abnormal');
  assert.strictEqual(extractJson(truncated).disposition, 'APPROVE',
    'the payload really is parseable — which is exactly why the stop reason must win');
});

// ── PARSER DEFECT (2026-08-25): the first-turn placeholder won ───────────
// --json-schema makes the model emit a conforming object EVERY turn, so the
// payload holds several verdicts. Taking the FIRST returned a REJECT with zero
// findings while the real verdict — five HIGH findings — sat later in the same
// string. Worse than a timeout: it produces a PLAUSIBLE record that reads as a
// completed review which happened to find nothing.
const REAL_G9 = path.join(__dirname, '..', 'review-raw', '20260825022432-grok.txt');

test('RED: the real multi-verdict run yields the FINAL verdict, not the first turn', () => {
  if (!fs.existsSync(REAL_G9)) return skip(`frozen fixture unavailable: ${path.basename(REAL_G9)}`);
  const v = extractJson(fs.readFileSync(REAL_G9, 'utf8'));
  assert.strictEqual(v.disposition, 'REJECT');
  assert.strictEqual(v.findings.length, 5,
    `expected the 5-finding final verdict, got ${v.findings.length} — the first-turn placeholder won again`);
});

test('RED: structuredOutput is preferred over anything in the text stream', () => {
  const raw = JSON.stringify({
    text: '{"disposition":"APPROVE","findings":[]}',
    structuredOutput: { disposition: 'REJECT', findings: [{ severity: 'HIGH', file: 'x', problem: 'p', evidence: 'e', status: 'OPEN' }] },
    stopReason: 'end_turn',
  });
  const v = extractJson(raw);
  assert.strictEqual(v.disposition, 'REJECT', 'the tool\'s authoritative result must win over a stream fragment');
  assert.strictEqual(v.findings.length, 1);
});

test('RED: the FINAL disposition-bearing structuredOutput outranks an earlier approval', () => {
  const raw = [
    JSON.stringify({
      type: 'turn',
      structuredOutput: { disposition: 'APPROVE', findings: [], unverified: [] },
    }),
    JSON.stringify({
      type: 'turn',
      structuredOutput: {
        disposition: 'REJECT',
        findings: [{ severity: 'HIGH', file: 'x.cjs', problem: 'late blocker', evidence: 'line 9', status: 'OPEN' }],
        unverified: [],
      },
    }),
  ].join('\n');
  const v = extractJson(raw);
  assert.strictEqual(v.disposition, 'REJECT',
    'an earlier structured approval overrode the reviewer\'s final structured rejection');
  assert.strictEqual(v.findings.length, 1);
  assert.strictEqual(v.findings[0].problem, 'late blocker');
});

test('RED: with no structuredOutput, the LAST conforming object wins', () => {
  const raw = '{"disposition":"REJECT","findings":[],"unverified":["still reading"]}'
    + '{"disposition":"REJECT","findings":[],"unverified":["half read"]}'
    + '{"disposition":"APPROVE_WITH_NOTES","findings":[{"severity":"LOW","file":"a","problem":"p","evidence":"e","status":"OPEN"}]}';
  const v = extractJson(raw);
  assert.strictEqual(v.disposition, 'APPROVE_WITH_NOTES', 'an earlier placeholder outranked the final word');
  assert.strictEqual(v.findings.length, 1);
});

test('a single plain verdict is unaffected by multi-object handling', () => {
  const v = extractJson('prose {"disposition":"APPROVE","findings":[],"unverified":[]} trailing');
  assert.strictEqual(v.disposition, 'APPROVE');
  assert.strictEqual(isUsableReview(v), true);
});

test('RED: authoritative Grok cost comes only from one successful terminal stdout event', () => {
  const end = (cost) => JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: cost });
  const within = authoritativeGrokSpend(`${JSON.stringify({ type: 'text', data: '{}' })}\n${end(0.25)}\n`, 1);
  assert.strictEqual(within.ok, true);
  assert.strictEqual(within.actualUsd, 0.25);
  assert.strictEqual(within.telemetryCeilingUsd, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(within, 'capUsd'), false,
    'post-run telemetry was still labelled as an enforced spend cap');
  assert.strictEqual(within.authorizationScope, 'post-run-telemetry-only');
  assert.strictEqual(within.possibleEventOvershoot, true);
  assert.strictEqual(within.observedEventOvershoot, false);
  assert.strictEqual(within.enforceablePrechargeCap, false);
  assert.strictEqual(within.billedSpend, false);
  assert.strictEqual(within.capEnforcement, false);
  assert.strictEqual(within.preRunSpendEnforced, false);
  assert.strictEqual(within.incrementalSpendEnforced, false);
  assert.strictEqual(within.classification, 'credit-equivalent-pricing-telemetry');
  assert.match(within.reason, /credit-equivalent pricing telemetry.*one completed event can overshoot/);
  const over = authoritativeGrokSpend(`${end(1.01)}\n`, 1);
  assert.strictEqual(over.ok, false, 'over-cap review remained usable');
  assert.strictEqual(over.possibleEventOvershoot, true);
  assert.strictEqual(over.observedEventOvershoot, true);
  assert.strictEqual(over.capEnforcement, false);
  assert.strictEqual(over.enforceablePrechargeCap, false);
  assert.match(over.reason, /after completion; an overshoot was observed/);
  assert.strictEqual(authoritativeGrokSpend(`${end(-1)}\n`, 1).ok, false, 'negative cost reduced spend');
  assert.strictEqual(authoritativeGrokSpend(`${end(0.1)}\n${end(0.1)}\n`, 1).ok, false, 'duplicate terminal cost was accepted');
  assert.strictEqual(authoritativeGrokSpend(`${JSON.stringify({ type: 'end', stopReason: 'end_turn' })}\n`, 1).ok, false,
    'missing terminal cost was accepted');
  const stdout = JSON.stringify({ type: 'text', data: '{}' });
  const stderr = end(0.01);
  assert.strictEqual(authoritativeGrokSpend(stdout, 1).ok, false,
    `stderr forged cost became authoritative: ${stderr}`);

  const contract = grokSpendContract(10);
  assert.deepStrictEqual(contract, {
    authorizationScope: 'post-run-telemetry-only',
    telemetryCeilingUsd: 10,
    billingRequirement: 'fresh-execution-bound-zero-metered',
    billedSpend: false,
    capEnforcement: false,
    preRunSpendEnforced: false,
    incrementalSpendEnforced: false,
    enforceablePrechargeCap: false,
  });
  assert.strictEqual(grokSpendContract(0), null);
});

test('RED: Grok routing labels the owner number as post-run telemetry, never an enforced spend cap', () => {
  const { authorizeLaunch } = require('../review-adapters.cjs');
  const observedAt = new Date().toISOString();
  const routed = authorizeLaunch('grok', {
    invocationId: 'REV-routing-proof',
    dataClass: 'INTERNAL', allowMetered: true,
    approvedBy: 'Marc Papineau', capUsd: 5,
    subscriptionProof: {
      ok: true, mode: 'zero-metered', invocationId: 'REV-routing-proof',
      preflightId: 'GBPF-routing-proof',
      observedAt,
      expiresAt: new Date(Date.parse(observedAt) + 4 * 60 * 1000).toISOString(),
      subscriptionTier: 'Free', subscriptionTierState: 'REPORTED', unifiedBilling: true,
      onDemandCap: 0, onDemandUsed: 0, prepaidBalance: 0, autoTopup: 'DISABLED',
    },
  });
  assert.strictEqual(routed.ok, true, routed.reason);
  assert.deepStrictEqual(routed.route.spendContract, grokSpendContract(5));
  assert.strictEqual(routed.route.spendContract.authorizationScope, 'post-run-telemetry-only');
  assert.strictEqual(routed.route.spendContract.capEnforcement, false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(routed.route.spendContract, 'capUsd'), false);
  assert.doesNotMatch(JSON.stringify(routed.route), /(?:spend|cost) is (?:bounded|controlled) by capUsd/i,
    'the adapter leaked the router policy\'s false cap-enforcement claim');
  assert.match(routed.route.bounds.boundsNote, /do not enforce a spend ceiling/);
  assert.strictEqual(routed.route.bounds.maxTurnsPurpose, 'runaway guard only; not a cost control');
});

function goodGrokBillingEvidence(overrides = {}) {
  const config = {
    creditUsagePercent: 16,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    prepaidBalance: { val: 0 },
    isUnifiedBillingUser: true,
    ...(overrides.config || {}),
  };
  return {
    ok: true,
    initialized: true,
    groupDrained: true,
    retainSandbox: false,
    billing: { subscription_tier: 'SuperGrok', config, ...(overrides.billing || {}) },
    autoTopup: {},
    ...overrides,
  };
}

test('RED: Grok pin remains the immutable 1.0.5 binary and disables its updater', () => {
  assert.strictEqual(TOOLS.grok.bin, '/Users/marcpapineau/.grok/downloads/grok-macos-aarch64');
  assert.strictEqual(TOOLS.grok.expectedVersion, GROK_EXPECTED_VERSION);
  assert.strictEqual(TOOLS.grok.expectedSha256, GROK_EXPECTED_SHA256);
  let versionEnv;
  const proven = validateGrokExecutableIdentity({
    versionRunner: (_bin, _argv, options) => {
      versionEnv = options.env;
      return { status: 0, stdout: `${GROK_EXPECTED_VERSION}\n` };
    },
  });
  assert.strictEqual(proven.ok, true, proven.reason);
  assert.strictEqual(proven.sha256, GROK_EXPECTED_SHA256);
  assert.strictEqual(proven.updaterDisabled, true);
  assert.strictEqual(versionEnv.GROK_DISABLE_AUTOUPDATER, '1');
  const changed = validateGrokExecutableIdentity({
    versionRunner: () => ({ status: 0, stdout: 'grok 1.0.13 (changed) [stable]\n' }),
  });
  assert.strictEqual(changed.ok, false);
  assert.match(changed.reason, /version mismatch/);
  const sandbox = prepareReviewSandbox();
  try {
    assert.strictEqual(reviewerEnvironment('grok', sandbox).GROK_DISABLE_AUTOUPDATER, '1');
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: Grok executable mutation during updater-disabled version probe is refused', () => {
  let mutated = false;
  const result = validateGrokExecutableIdentity({
    digestRunner: () => mutated ? '0'.repeat(64) : GROK_EXPECTED_SHA256,
    versionRunner: (_bin, _argv, options) => {
      assert.strictEqual(options.env.GROK_DISABLE_AUTOUPDATER, '1');
      mutated = true;
      return { status: 0, stdout: `${GROK_EXPECTED_VERSION}\n` };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /changed during version probe/);
});

test('RED: Grok billing evidence admits only a fresh execution-bound zero-metered state', () => {
  const invocationId = 'REV-billing-proof';
  const nowMs = Date.parse('2026-08-30T12:00:00.000Z');
  const freeEvidence = goodGrokBillingEvidence();
  freeEvidence.billing.subscription_tier = 'Free';
  const good = validateGrokBillingEvidence(freeEvidence, { invocationId, nowMs });
  assert.strictEqual(good.ok, true, good.reason);
  assert.strictEqual(good.mode, 'zero-metered');
  assert.strictEqual(good.invocationId, invocationId);
  assert.ok(typeof good.preflightId === 'string' && good.preflightId.length > 8);
  assert.strictEqual(good.observedAt, '2026-08-30T12:00:00.000Z');
  assert.strictEqual(good.expiresAt, '2026-08-30T12:05:00.000Z');
  assert.ok(Date.parse(good.expiresAt) - Date.parse(good.observedAt) <= 5 * 60 * 1000);
  assert.strictEqual(good.subscriptionTier, 'Free');
  assert.strictEqual(good.subscriptionTierState, 'REPORTED');
  assert.strictEqual(good.autoTopup, 'ABSENT');
  assert.strictEqual(validateGrokBillingEvidence(
    goodGrokBillingEvidence({ autoTopup: { enabled: false } }), { invocationId, nowMs }).ok, true);

  const rejected = [
    null,
    goodGrokBillingEvidence({ initialized: false }),
    goodGrokBillingEvidence({ billing: { subscription_tier: '' } }),
    goodGrokBillingEvidence({ config: { isUnifiedBillingUser: false } }),
    goodGrokBillingEvidence({ config: { onDemandCap: { val: 1 } } }),
    goodGrokBillingEvidence({ config: { onDemandUsed: { val: 0.01 } } }),
    goodGrokBillingEvidence({ config: { prepaidBalance: { val: '0' } } }),
    goodGrokBillingEvidence({ autoTopup: { enabled: true } }),
    goodGrokBillingEvidence({ autoTopup: null }),
  ];
  for (const evidence of rejected) {
    const result = validateGrokBillingEvidence(evidence, { invocationId, nowMs });
    assert.strictEqual(result.ok, false, `unsafe billing evidence was admitted: ${JSON.stringify(evidence)}`);
  }
  assert.strictEqual(validateGrokBillingEvidence(goodGrokBillingEvidence(), { nowMs }).ok, false,
    'unbound billing proof was accepted');
  const second = validateGrokBillingEvidence(goodGrokBillingEvidence(), { invocationId, nowMs });
  assert.notStrictEqual(second.preflightId, good.preflightId, 'preflight identity was reused');
  const unreportedEvidence = goodGrokBillingEvidence();
  delete unreportedEvidence.billing.subscription_tier;
  const unreported = validateGrokBillingEvidence(unreportedEvidence, { invocationId, nowMs });
  assert.strictEqual(unreported.ok, true, unreported.reason);
  assert.strictEqual(unreported.subscriptionTier, null, 'adapter fabricated an unreported tier');
  assert.strictEqual(unreported.subscriptionTierState, 'UNREPORTED');
});

test('RED: ACP billing transport sends initialize then only the two read-only billing requests', async () => {
  const requests = [];
  const result = await runGrokBillingAcp({ bin: '/fake/grok', argv: ['agent', '--no-leader', 'stdio'] }, {
    timeoutMs: 500,
    killImpl: () => {},
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 987654321;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write(line) {
          const request = JSON.parse(line);
          requests.push(request);
          const response = request.id === 1
            ? { jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }
            : request.id === 2
            ? { jsonrpc: '2.0', id: 2, result: goodGrokBillingEvidence().billing }
            : { jsonrpc: '2.0', id: 3, result: {} };
          setImmediate(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify(response)}\n`)));
          return true;
        },
        end() { setImmediate(() => child.emit('close', 0)); },
      };
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  assert.strictEqual(result.ok, true, result.reason);
  assert.deepStrictEqual(requests.map(({ method }) => method),
    ['initialize', '_x.ai/billing', '_x.ai/auto-topup-rule']);
  assert.strictEqual(requests[0].params.clientInfo.name, 'AEGIS');
  assert.ok(requests.every(({ method }) => !/session|prompt/i.test(method)));
});

test('GREEN: ACP billing ignores legitimate id-less notifications but still binds every response id', async () => {
  const requests = [];
  const result = await runGrokBillingAcp({ bin: '/fake/grok', argv: ['agent', '--no-leader', 'stdio'] }, {
    timeoutMs: 500,
    killImpl: () => {},
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 987654329;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      let ended = false;
      const emit = (value) => child.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`));
      child.stdin = {
        write(line) {
          const request = JSON.parse(line);
          requests.push(request);
          if (request.id === 1) setImmediate(() => {
            emit({ jsonrpc: '2.0', method: 'system/status', params: { ready: true } });
            emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
          });
          if (request.id === 2) setImmediate(() => {
            emit({ jsonrpc: '2.0', method: 'account/changed', params: {} });
            emit({ jsonrpc: '2.0', id: 2, result: goodGrokBillingEvidence().billing });
          });
          if (request.id === 3) setImmediate(() => emit({ jsonrpc: '2.0', id: 3, result: {} }));
          return true;
        },
        end() {
          if (ended) return;
          ended = true;
          setImmediate(() => child.emit('close', 0));
        },
      };
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  assert.strictEqual(result.ok, true, result.reason);
  assert.deepStrictEqual(requests.map(({ id }) => id), [1, 2, 3]);
});

test('RED: ACP billing rejects an id-less response-shaped frame', async () => {
  const result = await runGrokBillingAcp({ bin: '/fake/grok', argv: ['agent', '--no-leader', 'stdio'] }, {
    timeoutMs: 500,
    killImpl: () => {},
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 987654330;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write() {
          setImmediate(() => child.stdout.emit('data', Buffer.from(
            `${JSON.stringify({ jsonrpc: '2.0', result: { protocolVersion: 1 } })}\n`)));
          return true;
        },
        end() { setImmediate(() => child.emit('close', 0)); },
      };
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /duplicate, uncorrelated, or unexpected response id undefined/);
});

test('GREEN: ACP billing accepts correlated billing responses in either arrival order', async () => {
  const requests = [];
  const result = await runGrokBillingAcp({ bin: '/fake/grok', argv: ['agent', '--no-leader', 'stdio'] }, {
    timeoutMs: 500,
    killImpl: () => {},
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 987654324;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      let emitted = false;
      child.stdin = {
        write(line) {
          const request = JSON.parse(line);
          requests.push(request);
          if (request.id === 1) {
            setImmediate(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify({
              jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 },
            })}\n`)));
          } else if (request.id === 3 && !emitted) {
            emitted = true;
            setImmediate(() => child.stdout.emit('data', Buffer.from([
              JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }),
              JSON.stringify({ jsonrpc: '2.0', id: 2, result: goodGrokBillingEvidence().billing }),
              '',
            ].join('\n'))));
          }
          return true;
        },
        end() { setImmediate(() => child.emit('close', 0)); },
      };
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  assert.strictEqual(result.ok, true, result.reason);
  assert.deepStrictEqual(requests.map(({ method }) => method),
    ['initialize', '_x.ai/billing', '_x.ai/auto-topup-rule']);
  assert.deepStrictEqual(result.autoTopup, {});
  assert.strictEqual(result.billing.subscription_tier, 'SuperGrok');
});

test('RED: ACP billing bounds diagnostic stderr before refusing the process', async () => {
  const result = await runGrokBillingAcp({ bin: '/fake/grok', argv: ['agent', '--no-leader', 'stdio'] }, {
    timeoutMs: 500,
    killImpl: () => {},
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 987654325;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write() {
          setImmediate(() => child.stderr.emit('data',
            Buffer.alloc(GROK_BILLING_MAX_STREAM_BYTES + 4096, 0x78)));
          return true;
        },
        end() { setImmediate(() => child.emit('close', 1)); },
      };
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /exceeded bounded stderr output/);
  assert.ok(Buffer.byteLength(result.stderr) <= GROK_BILLING_MAX_STREAM_BYTES,
    'bounded ACP stderr retained more bytes than its limit');
});

function adversarialGrokBillingRunner(mode, requests) {
  return async (contained, options) => runGrokBillingAcp(contained, {
    ...options,
    timeoutMs: 500,
    killImpl: () => {},
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 987654322;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const emit = (value) => child.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`));
      child.stdin = {
        write(line) {
          const request = JSON.parse(line);
          requests.push(request);
          if (request.id === 1) {
            if (mode === 'pre-initialize') {
              setImmediate(() => emit({ jsonrpc: '2.0', id: 2, result: goodGrokBillingEvidence().billing }));
            } else {
              setImmediate(() => {
                emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
                emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
              });
            }
          } else if (request.id === 2) {
            setImmediate(() => emit({ jsonrpc: '2.0', id: 2, result: goodGrokBillingEvidence().billing }));
          } else if (request.id === 3) {
            setImmediate(() => emit({ jsonrpc: '2.0', id: 3, result: {} }));
          }
          return true;
        },
        end() { setImmediate(() => child.emit('close', 0)); },
      };
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
}

test('RED: duplicate initialize and uncorrelated pre-initialize responses cannot reach reviewer spawn', async () => {
  for (const mode of ['duplicate-initialize', 'pre-initialize']) {
    let reviewerLaunched = false;
    const requests = [];
    const result = await runTool('grok', 'P', 1, {
      invocationId: `REV-${mode}-billing`,
      allowMetered: true, approvedBy: 'Marc Papineau', capUsd: 5, reviewPaths: [],
      grokVersionRunner: () => ({ status: 0, stdout: `${GROK_EXPECTED_VERSION}\n` }),
      grokBillingRunner: adversarialGrokBillingRunner(mode, requests),
      watchdogRunner: async () => { reviewerLaunched = true; throw new Error('reviewer must not launch'); },
    });
    assert.strictEqual(result.ok, false, mode);
    assert.strictEqual(reviewerLaunched, false, mode);
    assert.match(result.reason, /duplicate, uncorrelated, or unexpected response id/, mode);
    assert.deepStrictEqual(requests.map(({ method }) => method), mode === 'pre-initialize'
      ? ['initialize']
      : ['initialize', '_x.ai/billing', '_x.ai/auto-topup-rule']);
  }
});

function trailingGrokBillingRunner(mode, requests) {
  return async (contained, options) => runGrokBillingAcp(contained, {
    ...options,
    timeoutMs: 500,
    killImpl: () => {},
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 987654323;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      let ended = false;
      const line = (value) => `${JSON.stringify(value)}\n`;
      const emit = (value) => child.stdout.emit('data', Buffer.from(line(value)));
      child.stdin = {
        write(input) {
          const request = JSON.parse(input);
          requests.push(request);
          if (request.id === 1) {
            setImmediate(() => emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }));
          } else if (request.id === 2) {
            setImmediate(() => emit({ jsonrpc: '2.0', id: 2, result: goodGrokBillingEvidence().billing }));
          } else if (request.id === 3 && mode === 'same-chunk') {
            setImmediate(() => child.stdout.emit('data', Buffer.from(
              line({ jsonrpc: '2.0', id: 3, result: {} })
              + line({ jsonrpc: '2.0', id: 4, result: {} }))));
          } else if (request.id === 3) {
            setImmediate(() => emit({ jsonrpc: '2.0', id: 3, result: {} }));
          }
          return true;
        },
        end() {
          if (ended) return;
          ended = true;
          if (mode === 'later-chunk') {
            setImmediate(() => {
              emit({ jsonrpc: '2.0', id: 4, result: {} });
              setImmediate(() => child.emit('close', 0));
            });
          } else setImmediate(() => child.emit('close', 0));
        },
      };
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
}

test('RED: trailing ACP responses after valid billing evidence cannot reach reviewer spawn', async () => {
  for (const mode of ['same-chunk', 'later-chunk']) {
    let reviewerLaunched = false;
    const requests = [];
    const result = await runTool('grok', 'P', 1, {
      invocationId: `REV-${mode}-trailing`,
      allowMetered: true, approvedBy: 'Marc Papineau', capUsd: 5, reviewPaths: [],
      grokVersionRunner: () => ({ status: 0, stdout: `${GROK_EXPECTED_VERSION}\n` }),
      grokBillingRunner: trailingGrokBillingRunner(mode, requests),
      watchdogRunner: async () => { reviewerLaunched = true; throw new Error('reviewer must not launch'); },
    });
    assert.strictEqual(result.ok, false, mode);
    assert.strictEqual(reviewerLaunched, false, mode);
    assert.match(result.reason, /duplicate, uncorrelated, or unexpected response id 4/, mode);
    assert.deepStrictEqual(requests.map(({ method }) => method),
      ['initialize', '_x.ai/billing', '_x.ai/auto-topup-rule']);
  }
});

test('RED: Grok billing preflight is no-session, no-prompt and uses only ACP billing methods', async () => {
  const sandbox = prepareReviewSandbox();
  let observed;
  try {
    const result = await grokBillingPreflight(sandbox, {
      invocationId: 'REV-preflight-no-session',
      grokVersionRunner: () => ({ status: 0, stdout: `${GROK_EXPECTED_VERSION}\n` }),
      grokBillingRunner: async (contained, options) => {
        observed = { contained, options };
        return goodGrokBillingEvidence();
      },
    });
    assert.strictEqual(result.ok, true, result.reason);
    assert.deepStrictEqual(result.transport, {
      method: 'ACP initialize + _x.ai/billing + _x.ai/auto-topup-rule',
      sessionCreated: false,
      promptSent: false,
    });
    assert.ok(observed.contained.argv.includes('agent'));
    assert.ok(observed.contained.argv.includes('--no-leader'));
    assert.ok(observed.contained.argv.includes('stdio'));
    const reviewerArgv = observed.contained.argv.slice(observed.contained.argv.indexOf(TOOLS.grok.bin) + 1);
    assert.ok(!reviewerArgv.includes('-p'));
    assert.ok(!reviewerArgv.includes('--prompt'));
    assert.strictEqual(observed.options.env.GROK_DISABLE_AUTOUPDATER, '1');
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: unsafe Grok billing state refuses before reviewer spawn', async () => {
  let launched = false;
  const result = await runTool('grok', 'P', 1, {
    invocationId: 'REV-unsafe-billing',
    allowMetered: true, approvedBy: 'Marc Papineau', capUsd: 5, reviewPaths: [],
    grokVersionRunner: () => ({ status: 0, stdout: `${GROK_EXPECTED_VERSION}\n` }),
    grokBillingRunner: async () => goodGrokBillingEvidence({ config: { onDemandUsed: { val: 1 } } }),
    watchdogRunner: async () => { launched = true; throw new Error('must not launch'); },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(launched, false);
  assert.match(result.reason, /zero-metered billing preflight refused launch.*onDemandUsed\.val === 0/);
});

test('GREEN: proven fresh execution-bound zero-metered billing permits one bounded Grok reviewer launch', async () => {
  let launched = false;
  let versionProbes = 0;
  const terminal = [
    JSON.stringify({ type: 'text', data: '{"disposition":"APPROVE","findings":[]}' }),
    JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 0.1 }),
    '',
  ].join('\n');
  const result = await runTool('grok', 'P', 1, {
    invocationId: 'REV-proven-zero-metered',
    allowMetered: true, approvedBy: 'Marc Papineau', capUsd: 5, reviewPaths: [],
    grokVersionRunner: () => {
      versionProbes++;
      return { status: 0, stdout: `${GROK_EXPECTED_VERSION}\n` };
    },
    grokBillingRunner: async () => goodGrokBillingEvidence(),
    watchdogRunner: async () => {
      launched = true;
      return { status: 0, signal: null, stdout: terminal, stderr: '', timedOut: false,
        outputOverflow: false, error: null, processGroupId: 9, terminationSignals: [],
        terminationFailures: [], groupDrained: true };
    },
  });
  assert.strictEqual(launched, true);
  assert.strictEqual(versionProbes, 2, 'identity was not re-proven immediately before reviewer launch');
  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(result.billingPreflight.mode, 'zero-metered');
  assert.strictEqual(result.billingPreflight.invocationId, 'REV-proven-zero-metered');
  assert.strictEqual(result.spendContract.authorizationScope, 'post-run-telemetry-only');
  assert.strictEqual(result.spendContract.telemetryCeilingUsd, 5);
  assert.strictEqual(result.spendContract.capEnforcement, false);
  assert.strictEqual(result.spendAuthorization.classification, 'credit-equivalent-pricing-telemetry');
  assert.strictEqual(result.spendAuthorization.authorizationScope, 'post-run-telemetry-only');
});

test('RED: Grok argv remains bound to the immutable route authorized before a policy reload changes', async () => {
  const router = require('../tool-router.cjs');
  const originalRouteRole = router.routeRole;
  const originalLoadPolicy = router.loadPolicy;
  let authorizedBounds;
  let launchedArgv;
  const terminal = [
    JSON.stringify({ type: 'text', data: '{"disposition":"APPROVE","findings":[]}' }),
    JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 0.1 }),
    '',
  ].join('\n');
  router.routeRole = (...args) => {
    const routed = originalRouteRole(...args);
    authorizedBounds = { ...routed.bounds };
    router.loadPolicy = () => ({ roles: { 'adversarial-review': {
      bounds: { maxTurns: 999, webAccess: true, subagents: true },
    } } });
    return routed;
  };
  try {
    const result = await runTool('grok', 'P', 1, {
      invocationId: 'REV-route-bound',
      allowMetered: true, approvedBy: 'Marc Papineau', capUsd: 5, reviewPaths: [],
      grokVersionRunner: () => ({ status: 0, stdout: `${GROK_EXPECTED_VERSION}\n` }),
      grokBillingRunner: async () => goodGrokBillingEvidence(),
      watchdogRunner: async (contained) => {
        launchedArgv = contained.argv.slice(contained.argv.indexOf(TOOLS.grok.bin) + 1);
        return { status: 0, signal: null, stdout: terminal, stderr: '', timedOut: false,
          outputOverflow: false, error: null, processGroupId: 10, terminationSignals: [],
          terminationFailures: [], groupDrained: true };
      },
    });
    assert.strictEqual(result.ok, true, result.reason);
    assert.ok(authorizedBounds && Number.isInteger(authorizedBounds.maxTurns));
    assert.deepStrictEqual(launchedArgv.slice(launchedArgv.indexOf('--max-turns'), launchedArgv.indexOf('--max-turns') + 2),
      ['--max-turns', String(authorizedBounds.maxTurns)]);
    assert.ok(launchedArgv.includes('--disable-web-search'),
      'a post-authorization policy reload enabled web access');
    assert.ok(launchedArgv.includes('--no-subagents'),
      'a post-authorization policy reload enabled subagents');
    assert.ok(!launchedArgv.includes('999'), 'execution used reloaded bounds instead of authorized bounds');
  } finally {
    router.routeRole = originalRouteRole;
    router.loadPolicy = originalLoadPolicy;
  }
});

test('GREEN: recorded Grok 1.0.5 terminal stdout cost remains recognized', () => {
  const recordedTerminalStdout = grokEventStream([
    { type: 'text', data: JSON.stringify(GROK_APPROVE) },
    { type: 'end', stopReason: 'end_turn', total_cost_usd: 0.36490364 },
  ]);
  const spend = authoritativeGrokSpend(recordedTerminalStdout, 1);
  assert.strictEqual(spend.ok, true, spend.reason);
  assert.strictEqual(spend.actualUsd, 0.36490364);
});

test('RED: review invocation identities remain unique under a frozen clock', () => {
  const fixed = new Date('2026-08-29T02:30:00.123Z');
  const first = createInvocationIdentity('grok', fixed, '11111111-1111-4111-8111-111111111111');
  const second = createInvocationIdentity('grok', fixed, '22222222-2222-4222-8222-222222222222');
  assert.notStrictEqual(first.base, second.base);
  assert.notStrictEqual(first.reviewId, second.reviewId);
  assert.match(first.base, /^20260829023000123-grok-/);
});

test('RED: immutable evidence publication never overwrites an existing target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-immutable-'));
  const target = path.join(dir, 'receipt.txt');
  try {
    writeImmutableFile(target, 'first');
    assert.throws(() => writeImmutableFile(target, 'second'), /EEXIST|exist/i);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'first');
    assert.deepStrictEqual(fs.readdirSync(dir), ['receipt.txt']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('RED: unexpected process-group probe errors remain UNKNOWN and fail closed', async () => {
  if (process.platform === 'win32') return skip('POSIX process groups are unavailable on win32');
  const result = await runContainedWithWatchdog({
    bin: process.execPath,
    argv: ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
  }, {
    // Give the child enough time to install its SIGTERM handler before the
    // watchdog fires. At 50 ms, a loaded host could terminate Node during
    // startup and make this injected probe-error assertion nondeterministic.
    timeoutMs: 500,
    killGraceMs: 50,
    maxOutputBytes: 4096,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    processGroupAlive() { const error = new Error('injected probe failure'); error.code = 'EIO'; throw error; },
    signalProcessGroup(pid, signal) { process.kill(-pid, signal); return true; },
  });
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(result.groupDrained, false);
  assert.ok(result.terminationFailures.some((failure) => failure.signal === 'PROBE' && failure.code === 'EIO'));
  try { process.kill(-result.processGroupId, 'SIGKILL'); } catch {}
});

test('RED: canonical checks bind one explicit run receipt and reject root/worktree ambiguity', () => {
  const packetPath = path.join(__dirname, '..', 'packets', 'PKT-20260825-SWITCHBOARD-FOUNDATION.json');
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const exactSubject = { subjectSha256: 'a'.repeat(64), subjectPaths: ['x.cjs'], diffBytes: 1, range: null };
  const runAuthority = require('../aegis-run.cjs');
  const packetRelative = path.relative(path.join(__dirname, '..', '..'), packetPath).split(path.sep).join('/');
  const commands = runnablePacketChecks(packet);
  const startedAt = '2026-08-29T02:00:00.000Z';
  const completedAt = '2026-08-29T02:01:00.000Z';
  const body = {
    schemaVersion: 1, authority: 'aegis-run.cjs runChecks', runId: 'RUN-EXACT',
    packet: { path: packetRelative, sha256: crypto.createHash('sha256').update(fs.readFileSync(packetPath)).digest('hex') },
    subject: exactSubject, startedAt, completedAt, complete: true, outcome: 'PASS',
    total: commands.length, passed: commands.length,
    results: commands.map((cmd) => ({ cmd, status: 'EXECUTED', exit: 0, ranAt: completedAt })),
  };
  const receipt = { ...body, receiptSha256: runAuthority.checkReceiptDigest(body) };
  const laterBody = {
    ...body,
    runId: 'RUN-EXACT-LATER',
    startedAt: '2026-08-29T02:02:00.000Z',
    completedAt: '2026-08-29T02:03:00.000Z',
    results: commands.map((cmd) => ({ cmd, status: 'EXECUTED', exit: 0, ranAt: '2026-08-29T02:03:00.000Z' })),
  };
  const laterReceipt = { ...laterBody, receiptSha256: runAuthority.checkReceiptDigest(laterBody) };
  const positiveAuthority = { ...runAuthority,
    listRuns: () => [
      { runId: 'RUN-EXACT-LATER', checks: { receipt: laterReceipt } },
      { runId: 'RUN-EXACT', checks: { receipt } },
    ],
    loadCanonicalCheckReceipt: (checks, expected) =>
      runAuthority.validateCheckReceipt(checks && checks.receipt, expected)
        ? checks.receipt : null,
  };
  assert.throws(
    () => resolveCanonicalCheckReceipt(packetPath, packet, exactSubject, positiveAuthority),
    /ambiguous canonical receipt coordinate across 2 runs; provide --run-id/,
    'legacy control-worktree mode silently selected one of several run coordinates');
  const explicitAuthority = {
    ...positiveAuthority,
    listRuns: () => { throw new Error('explicit run binding searched unrelated runs'); },
    loadRun: (runId) => positiveAuthority.listRuns().find((run) => run.runId === runId),
  };
  const binding = resolveCanonicalCheckReceipt(
    packetPath, packet, exactSubject, explicitAuthority, { runId: 'RUN-EXACT-LATER' });
  assert.strictEqual(binding.receipt, laterReceipt);
  assert.strictEqual(binding.runId, 'RUN-EXACT-LATER');
  assert.strictEqual(binding.receiptStage, 'COMPLETE');
  assert.deepStrictEqual(binding.selection, {
    rule: 'explicit-run-id-then-latest-valid-complete-stage-receipt',
    candidateCount: 1,
  });
  const uniqueAuthority = { ...positiveAuthority, listRuns: () => [{ runId: 'RUN-EXACT', checks: { receipt } }] };
  const legacyBinding = resolveCanonicalCheckReceipt(packetPath, packet, exactSubject, uniqueAuthority);
  assert.strictEqual(legacyBinding.receipt, receipt,
    'unambiguous external control-worktree review lost backward compatibility');
  assert.strictEqual(legacyBinding.selection.rule, 'unique-run-then-latest-valid-complete-stage-receipt');
  const staleSubject = { ...exactSubject, subjectSha256: 'b'.repeat(64) };
  assert.throws(
    () => resolveCanonicalCheckReceipt(
      packetPath, packet, staleSubject, explicitAuthority, { runId: 'RUN-EXACT-LATER' }),
    /for RUN-EXACT-LATER; found 0/,
    'a control-checkout subject was accepted for the explicit run worktree');

  const hostCommands = [];
  const preHostReceipt = {
    schemaVersion: 1,
    receiptType: 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1',
    authority: 'aegis-run.cjs runChecks',
    runId: 'RUN-PRE-HOST',
    packet: body.packet,
    subject: exactSubject,
    snapshot: { policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1', captureSha256: 'c'.repeat(64) },
    startedAt: '2026-08-29T02:04:00.000Z', completedAt: '2026-08-29T02:05:00.000Z',
    complete: true, outcome: 'PASS', total: commands.length, passed: commands.length,
    results: body.results,
    hostContainment: { state: 'PENDING', commands: hostCommands },
    receiptSha256: 'd'.repeat(64),
  };
  const preHostAuthority = {
    listRuns: () => [{ runId: 'RUN-PRE-HOST', checks: { preHostReceiptRef: 'LEDGER:fixture' } }],
    loadRun: (runId) => runId === 'RUN-PRE-HOST'
      ? { runId, checks: { preHostReceiptRef: 'LEDGER:fixture' } } : null,
    loadCanonicalCheckReceipt: () => null,
    loadCanonicalPreHostCheckReceipt: (_checks, expected) =>
      expected.runId === 'RUN-PRE-HOST' && expected.subject.subjectSha256 === exactSubject.subjectSha256
        ? preHostReceipt : null,
  };
  const preHostBinding = resolveCanonicalCheckReceipt(
    packetPath, packet, exactSubject, preHostAuthority, { runId: 'RUN-PRE-HOST' });
  assert.strictEqual(preHostBinding.receipt, preHostReceipt);
  assert.strictEqual(preHostBinding.receiptStage, 'PRE_HOST');

  const untypedAuthority = {
    ...preHostAuthority,
    loadCanonicalPreHostCheckReceipt: () => ({ ...preHostReceipt, receiptType: undefined }),
  };
  assert.throws(() => resolveCanonicalCheckReceipt(
    packetPath, packet, exactSubject, untypedAuthority, { runId: 'RUN-PRE-HOST' }), /found 0/);
  const completedHostAuthority = {
    ...preHostAuthority,
    loadCanonicalPreHostCheckReceipt: () => ({
      ...preHostReceipt, hostContainment: { state: 'PASS', commands: hostCommands },
    }),
  };
  assert.throws(() => resolveCanonicalCheckReceipt(
    packetPath, packet, exactSubject, completedHostAuthority, { runId: 'RUN-PRE-HOST' }), /found 0/);

  const failAuthority = {
    listRuns: () => [{ runId: 'RUN-FAIL', checks: {} }],
    loadRun: (runId) => ({ runId, checks: {} }),
    loadCanonicalCheckReceipt: () => ({ ...receipt, outcome: 'FAIL' }),
    loadCanonicalPreHostCheckReceipt: () => null,
  };
  assert.throws(() => resolveCanonicalCheckReceipt(
    packetPath, packet, exactSubject, failAuthority, { runId: 'RUN-FAIL' }), /found 0/);
});

test('RED: explicit run context binds the exact packet and validated isolated worktree', () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-run-worktree-'));
  const copiedRel = 'builder-control/review-adapters.cjs';
  fs.mkdirSync(path.join(sourceRoot, 'builder-control'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, copiedRel), 'isolated-worktree-bytes\n');
  const packetPath = path.join(__dirname, '..', 'packets', 'PKT-20260825-SWITCHBOARD-FOUNDATION.json');
  const otherPacketPath = path.join(__dirname, '..', 'packets', 'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const packetRelative = path.relative(path.join(__dirname, '..', '..'), packetPath);
  const runId = 'RUN-20260829-abcdef12';
  const run = { runId, packet: packetRelative, worktree: { path: sourceRoot } };
  const authority = {
    loadRun: (wanted) => wanted === runId ? run : null,
    canonicalGitEnvironment: (selected) => {
      assert.strictEqual(selected, run);
      return { PATH: process.env.PATH, GIT_DIR: path.join(sourceRoot, '.git-fixture'), GIT_WORK_TREE: sourceRoot };
    },
  };
  try {
    const context = resolveCanonicalRunContext(runId, packetPath, authority);
    assert.strictEqual(context.runId, runId);
    assert.strictEqual(context.sourceRoot, fs.realpathSync(sourceRoot));
    assert.strictEqual(context.gitEnv.GIT_WORK_TREE, fs.realpathSync(sourceRoot));
    const sandbox = prepareReviewSandbox([copiedRel], context.sourceRoot);
    try {
      assert.strictEqual(fs.readFileSync(path.join(sandbox.cwd, copiedRel), 'utf8'),
        'isolated-worktree-bytes\n', 'review copied control-checkout bytes instead of run-worktree bytes');
    } finally { cleanupReviewSandbox(sandbox); }
    assert.throws(() => resolveCanonicalRunContext(runId, otherPacketPath, authority),
      /does not match .* canonical packet/);
    const rootRun = { ...run, worktree: { path: path.join(__dirname, '..', '..') } };
    const rootAuthority = {
      loadRun: () => rootRun,
      canonicalGitEnvironment: () => ({ GIT_WORK_TREE: path.join(__dirname, '..', '..') }),
    };
    assert.throws(() => resolveCanonicalRunContext(runId, packetPath, rootAuthority),
      /did not resolve to one isolated canonical worktree/);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('RED: early Codex transport failure can create UNAVAILABLE evidence without delivery dereference', () => {
  assert.deepStrictEqual(codexCoveredPaths(undefined), []);
  assert.deepStrictEqual(codexCoveredPaths({ coveredPaths: ['b.cjs', 'a.cjs'] }), ['b.cjs', 'a.cjs']);
  const subject = { subjectSha256: 'a'.repeat(64), subjectPaths: ['builder-control/review-adapters.cjs'] };
  const record = buildRecord({
    reviewer: 'codex', reviewerModel: 'codex-cli (ChatGPT.app)', packetId: 'PKT-fixture',
    subject, parsed: null, unavailableReason: 'fixture failed before input delivery',
    ts: '2026-08-29T02:00:00.000Z', coveredPaths: codexCoveredPaths(undefined),
    inputDelivery: null, codexInspection: null, invocationId: 'REV-fixture',
  });
  assert.strictEqual(record.disposition, 'UNAVAILABLE');
  assert.deepStrictEqual(record.reviewOf.changedPaths, []);
  assert.match(record.unavailableReason, /before input delivery/);
});

test('RED: identity-bound reaper drains residual descendants but relinquishes a reused group id', async () => {
  let now = 0;
  let probes = 0;
  let signals = 0;
  const drained = await reapUndrainedReviewerGroup({ processGroupId: 7001 }, {
    processGroupMembers: () => (++probes === 1 ? [7002] : []),
    signalProcessGroup: (pgid, signal) => {
      assert.strictEqual(pgid, 7001); assert.strictEqual(signal, 'SIGKILL'); signals++; return true;
    },
    now: () => now, sleep: async (ms) => { now += ms; }, timeoutMs: 10, intervalMs: 1,
  });
  assert.strictEqual(drained.drained, true);
  assert.strictEqual(drained.retained, false);
  assert.strictEqual(signals, 1);

  const reused = await reapUndrainedReviewerGroup({ processGroupId: 7001 }, {
    processGroupMembers: () => [7001],
    signalProcessGroup: () => { throw new Error('reused identity must never be signalled'); },
  });
  assert.strictEqual(reused.drained, false);
  assert.strictEqual(reused.retained, true);
  assert.match(reused.reason, /reused/);
});

test('RED: undrained reviewer sandbox is retained for bounded identity-bound cleanup', async () => {
  const prefix = path.basename(REVIEW_SANDBOX_PREFIX);
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix)));
  let result;
  try {
    result = await runTool('codex', 'P', 1, {
      reviewPaths: ['builder-control/MODEL-ROUTING-POLICY.json'],
      watchdogRunner: async (_contained, options) => ({
        status: null, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: false,
        outputOverflow: false, error: null, processGroupId: 7001,
        terminationSignals: ['SIGKILL'], terminationFailures: [], groupDrained: false,
        stdinDelivery: { delivered: true, bytes: options.stdinInput.length,
          sha256: crypto.createHash('sha256').update(options.stdinInput).digest('hex'), error: null },
      }),
      reaperOptions: { processGroupMembers: () => [7001] },
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.sandboxRetention, {
      retained: true, cleanup: 'bounded-identity-bound-reaper',
      reason: 'the reviewer process-group id was reused; signalling authority was relinquished',
      attempts: 0,
    });
    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix) && !before.has(name));
    assert.strictEqual(after.length, 1, 'undrained reviewer sandbox was not retained exactly once');
    fs.rmSync(path.join(os.tmpdir(), after[0]), { recursive: true, force: true });
  } finally {
    for (const name of fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(prefix) && !before.has(entry))) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
});

test('RED: a post-copy or mid-run subject change makes the review unusable', async () => {
  const reviewPaths = ['builder-control/MODEL-ROUTING-POLICY.json'];
  let phaseCount = 0;
  const result = await runTool('codex', 'P', 1, {
    reviewPaths,
    validateSubjectSnapshot(phase) {
      phaseCount++;
      if (phase === 'post-run') throw new Error('injected subject mutation');
    },
    watchdogRunner: async (_contained, options) => ({
      status: 0, signal: null,
      stdout: '{"disposition":"APPROVE","findings":[]}', stderr: '',
      timedOut: false, outputOverflow: false, error: null, processGroupId: 9,
      terminationSignals: [], terminationFailures: [], groupDrained: true,
      stdinDelivery: { delivered: true, bytes: options.stdinInput.length,
        sha256: crypto.createHash('sha256').update(options.stdinInput).digest('hex'), error: null },
    }),
  });
  assert.strictEqual(phaseCount, 2);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /subject changed during execution/);
});

test('RED: manifest snapshots detect copied and canonical source mutation for every bounded path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-manifest-source-'));
  const cwd = path.join(root, 'copy');
  fs.mkdirSync(cwd);
  const rel = 'pinned-spec.txt';
  const original = Buffer.from('pinned authority\n');
  fs.writeFileSync(path.join(root, rel), original);
  fs.writeFileSync(path.join(cwd, rel), original);
  const sandbox = { cwd, manifest: [{ path: rel, bytes: original.length,
    sha256: crypto.createHash('sha256').update(original).digest('hex'), lines: 1 }] };
  try {
    assert.strictEqual(validateReviewManifestSnapshot(sandbox, 'green', root).complete, true);
    fs.writeFileSync(path.join(cwd, rel), 'copy changed\n');
    assert.throws(() => validateReviewManifestSnapshot(sandbox, 'copy', root), /copy digest changed/);
    fs.writeFileSync(path.join(cwd, rel), original);
    fs.writeFileSync(path.join(root, rel), 'source changed\n');
    assert.throws(() => validateReviewManifestSnapshot(sandbox, 'source', root), /source digest changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RED: a real copied-path mutation during reviewer execution makes the review unusable', async () => {
  const rel = 'builder-control/MODEL-ROUTING-POLICY.json';
  const result = await runTool('codex', 'P', 1, {
    reviewPaths: [rel],
    watchdogRunner: async (_contained, options) => {
      const copied = path.join(options.cwd, rel);
      fs.chmodSync(copied, 0o600);
      fs.appendFileSync(copied, '\nMUTATED');
      return {
        status: 0, signal: null, stdout: '{"disposition":"APPROVE","findings":[]}', stderr: '',
        timedOut: false, outputOverflow: false, error: null, processGroupId: 9,
        terminationSignals: [], terminationFailures: [], groupDrained: true,
        stdinDelivery: { delivered: true, bytes: options.stdinInput.length,
          sha256: crypto.createHash('sha256').update(options.stdinInput).digest('hex'), error: null },
      };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /review manifest changed during execution.*copy digest changed/);
  assert.strictEqual(result.manifestSnapshot.complete, false);
});

test('RED: incomplete HIGH findings become UNAVAILABLE rather than repaired approvals', () => {
  const localSubject = {
    subjectSha256: 'a'.repeat(64),
    subjectPaths: ['builder-control/review-adapters.cjs'],
  };
  for (const missing of ['impact', 'requiredCorrection', 'verificationMethod']) {
    const finding = { severity: 'HIGH', file: localSubject.subjectPaths[0], location: '1',
      problem: 'fixture malformed high', evidence: 'bounded fixture evidence',
      impact: 'real impact', requiredCorrection: 'bounded correction',
      verificationMethod: 'focused regression', status: 'OPEN' };
    finding[missing] = '';
    const record = buildRecord({
      reviewer: 'codex', reviewerModel: 'fixture', packetId: 'PKT-fixture', subject: localSubject,
      ...codexEvidence({ disposition: 'REJECT', findings: [finding], unverified: [] }, localSubject.subjectPaths),
      ts: '2026-08-29T04:00:00.000Z', invocationId: `REV-publication-${missing}`,
    });
    assert.strictEqual(record.disposition, 'UNAVAILABLE');
    assert.deepStrictEqual(record.findings, []);
    assert.match(record.unavailableReason, /inspection coverage was not proven|payload was refused/);
  }
});

test('RED: failed Codex transport publishes a signed schema-valid UNAVAILABLE record with zero claimed paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-unavailable-publication-'));
  const reviewsRoot = path.join(root, 'reviews');
  const diagnosticsRoot = path.join(root, 'diagnostics');
  fs.mkdirSync(reviewsRoot);
  const packetPath = path.join(__dirname, '..', 'packets',
    'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const localSubject = { subjectSha256: 'e'.repeat(64),
    subjectPaths: ['builder-control/review-adapters.cjs'] };
  const record = buildRecord({
    reviewer: 'codex', reviewerModel: 'fixture', packetId: packet.packetId,
    subject: localSubject, parsed: null,
    unavailableReason: 'Codex exact input delivery was not proven (fixture stdin failure)',
    ts: '2026-08-29T04:00:30.000Z', invocationId: 'REV-unavailable-transport',
    inputDelivery: { complete: false, delivered: false, reason: 'fixture stdin failure' },
  });
  try {
    assert.strictEqual(record.disposition, 'UNAVAILABLE');
    assert.deepStrictEqual(record.reviewOf.changedPaths, []);
    assert.strictEqual(writeRecord(record, 'unavailable', '(fixture)', {
      packetPath, reviewsRoot, diagnosticsRoot,
    }), 0);
    const active = JSON.parse(fs.readFileSync(path.join(reviewsRoot, 'unavailable.json'), 'utf8'));
    assert.strictEqual(active.disposition, 'UNAVAILABLE');
    assert.deepStrictEqual(active.reviewOf.changedPaths, []);
    assert.match(active.unavailableReason, /stdin failure/);
    assert.ok(active.attestation, 'durable UNAVAILABLE record was not signed');
    const source = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
    const transportSection = source.slice(source.indexOf('// Failed Codex transport still becomes durable'),
      source.indexOf('const protocolText', source.indexOf('// Failed Codex transport still becomes durable')));
    assert.ok(!/return EXIT_BLOCK/.test(transportSection),
      'cmdRun still exits before constructing the durable UNAVAILABLE record');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('valid review bytes are signed and validated in quarantine before one atomic publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-valid-publication-'));
  const reviewsRoot = path.join(root, 'reviews');
  const diagnosticsRoot = path.join(root, 'diagnostics');
  fs.mkdirSync(reviewsRoot);
  const packetPath = path.join(__dirname, '..', 'packets',
    'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const subject = { subjectSha256: 'b'.repeat(64),
    subjectPaths: ['builder-control/review-adapters.cjs'] };
  const record = buildRecord({
    reviewer: 'codex', reviewerModel: 'fixture', packetId: packet.packetId, subject,
    ...codexEvidence({ disposition: 'APPROVE', findings: [], unverified: [] }, subject.subjectPaths),
    ts: '2026-08-29T04:01:00.000Z', invocationId: 'REV-valid-publication',
  });
  const active = path.join(reviewsRoot, 'valid.json');
  let validatedPath = null;
  const validator = (candidate) => {
    validatedPath = candidate;
    assert.strictEqual(fs.existsSync(active), false,
      'active review existed before private validation completed');
    assert.ok(JSON.parse(fs.readFileSync(candidate, 'utf8')).attestation,
      'quarantine candidate was not fully signed');
    return { ok: true, errors: [] };
  };
  try {
    assert.strictEqual(writeRecord(record, 'valid', '(fixture)', {
      packetPath, reviewsRoot, diagnosticsRoot, validateRecord: validator,
    }), 0);
    assert.ok(validatedPath && validatedPath.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    assert.ok(!validatedPath.startsWith(reviewsRoot + path.sep));
    assert.ok(fs.existsSync(active), 'validated signed record was not atomically published');
    assert.strictEqual(fs.existsSync(diagnosticsRoot), false);
    assert.throws(() => writeRecord(record, 'valid', '(fixture)', {
      packetPath, reviewsRoot, diagnosticsRoot,
      validateRecord: () => ({ ok: true, errors: [] }),
    }), /EEXIST/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('valid signed review passes the real validator before default active publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-real-validator-'));
  const reviewsRoot = path.join(root, 'reviews');
  const diagnosticsRoot = path.join(root, 'diagnostics');
  fs.mkdirSync(reviewsRoot);
  const packetPath = path.join(__dirname, '..', 'packets',
    'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const subject = { subjectSha256: 'd'.repeat(64),
    subjectPaths: ['builder-control/review-adapters.cjs'] };
  const record = buildRecord({
    reviewer: 'codex', reviewerModel: 'fixture', packetId: packet.packetId, subject,
    ...codexEvidence({ disposition: 'APPROVE', findings: [], unverified: [] }, subject.subjectPaths),
    ts: '2026-08-29T04:01:30.000Z', invocationId: 'REV-real-validator-publication',
  });
  try {
    assert.strictEqual(writeRecord(record, 'real-validator', '(fixture)', {
      packetPath, reviewsRoot, diagnosticsRoot,
    }), 0, 'the production validator refused a schema-valid signed review');
    const active = path.join(reviewsRoot, 'real-validator.json');
    assert.ok(fs.existsSync(active), 'production validation never published the active review');
    assert.ok(JSON.parse(fs.readFileSync(active, 'utf8')).attestation,
      'active production-validated review is not signed');
    assert.strictEqual(fs.existsSync(diagnosticsRoot), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RED: a signed record rejected in quarantine leaves only non-gated diagnostic evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-quarantine-refusal-'));
  const reviewsRoot = path.join(root, 'reviews');
  const diagnosticsRoot = path.join(root, 'diagnostics');
  fs.mkdirSync(reviewsRoot);
  const packetPath = path.join(__dirname, '..', 'packets',
    'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const subject = { subjectSha256: 'c'.repeat(64),
    subjectPaths: ['builder-control/review-adapters.cjs'] };
  const record = buildRecord({
    reviewer: 'codex', reviewerModel: 'fixture', packetId: packet.packetId, subject,
    ...codexEvidence({ disposition: 'APPROVE', findings: [], unverified: [] }, subject.subjectPaths),
    ts: '2026-08-29T04:02:00.000Z', invocationId: 'REV-quarantine-refusal',
  });
  try {
    assert.strictEqual(writeRecord(record, 'refused', '(fixture)', {
      packetPath, reviewsRoot, diagnosticsRoot,
      validateRecord: (candidate) => {
        assert.ok(JSON.parse(fs.readFileSync(candidate, 'utf8')).attestation,
          'validator did not receive fully signed bytes');
        assert.strictEqual(fs.readdirSync(reviewsRoot).length, 0,
          'active review existed before quarantine validation refused it');
        return { ok: false, errors: ['fixture schema refusal'] };
      },
    }), 3);
    assert.deepStrictEqual(fs.readdirSync(reviewsRoot), [],
      'quarantine-rejected signed record became active evidence');
    const diagnostic = JSON.parse(fs.readFileSync(path.join(diagnosticsRoot, 'refused.json'), 'utf8'));
    assert.ok(diagnostic.attestation, 'signed diagnostic evidence was not retained');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

Promise.all(pendingTests).then(() => {
  const failedCount = process.exitCode ? 'at least 1' : '0';
  console.log(`${passed} passed, ${skipped} skipped, ${failedCount} failed.`);
});

// RUN-20260831-18c775b7 regression. Codex returned a complete, correct review
// twice and AEGIS scored it UNAVAILABLE with "inspection proof failed for
// builder-control/schemas/engineering-review.schema.json". The reviewer had in
// fact read the file exactly: every character after the indent was byte-perfect.
// It had parsed the .json subject and pretty-printed it at four-space indent,
// so the challenged line at nesting depth five came back with 20 leading spaces
// instead of the file's 10. The exact-hash test correctly rejected it, but the
// failure reason could not distinguish that from a reviewer that never opened
// the file, which is what turned one formatting artefact into a review loop.
test('RED: a re-indented exact line is rejected AND named as a re-render, not as absent inspection', () => {
  const schemaPath = 'builder-control/schemas/engineering-review.schema.json';
  const sandbox = prepareReviewSandbox([schemaPath]);
  try {
    const built = buildCodexInput('EXACT INDENT REGRESSION', sandbox, [schemaPath]);
    const challenge = built.inputDelivery.inspectionChallenges
      .find((entry) => entry.path === schemaPath);
    assert.ok(challenge, 'no challenge was issued for the schema');

    // The challenge must publish the shape metrics a reviewer needs to notice
    // it is about to answer from a re-rendering rather than from raw bytes.
    const raw = fs.readFileSync(path.join(sandbox.cwd, schemaPath), 'utf8')
      .split(/\r\n|\n|\r/)[challenge.lineNumber - 1];
    assert.strictEqual(challenge.lineBytes, Buffer.byteLength(raw, 'utf8'));
    assert.strictEqual(challenge.leadingWhitespace, raw.length - raw.replace(/^\s+/, '').length);
    assert.ok(built.input.includes(`"lineBytes":${challenge.lineBytes}`),
      'shape metrics never reached the reviewer-visible challenge block');
    assert.match(built.input, /Do not parse, reformat,/);

    const payload = (lineText) => ({
      disposition: 'APPROVE', findings: [], unverified: [],
      inspectionProofs: [{ path: schemaPath, lineNumber: challenge.lineNumber, lineText }],
    });

    // The honest raw line still proves inspection. The accept path is unchanged.
    assert.strictEqual(validateCodexInspectionProofs(payload(raw), built.inputDelivery).complete, true,
      'the exact raw line stopped proving inspection');

    // Reproduce the actual defect: the same line as this file re-serialises it.
    const reserialised = JSON.stringify(
      JSON.parse(fs.readFileSync(path.join(sandbox.cwd, schemaPath), 'utf8')), null, 4)
      .split('\n').find((candidate) => candidate.trim() === raw.trim());
    assert.ok(reserialised && reserialised !== raw,
      'the re-serialised variant did not differ, so this no longer reproduces the defect');

    const verdict = validateCodexInspectionProofs(payload(reserialised), built.inputDelivery);
    assert.strictEqual(verdict.complete, false, 'inspection proof was weakened into accepting re-rendered text');
    assert.match(verdict.reason, /leading whitespace \d+ vs challenged \d+/);
    assert.match(verdict.reason, /content matches exactly after indent correction/);
    assert.match(verdict.reason, /reviewer formatting fault, not missing inspection/);
  } finally { cleanupReviewSandbox(sandbox); }
});

// Pins the observed bytes from the RUN-20260831-18c775b7 receipts themselves,
// so the case survives any later change to challenge line selection.
test('RED: the exact bytes Codex returned on 2026-08-31 are diagnosed, and a genuine miss still reads as one', () => {
  const real = '          "description": "SHA-256 of the SUBJECT diff that was reviewed, from '
    + '`engineering-os.cjs --subject`. The subject excludes review evidence, so adding this record '
    + 'does not change the hash it names."';
  const returned = `          ${real}`; // the receipted answer: 20 leading spaces, not 10
  assert.strictEqual(real.length - real.replace(/^\s+/, '').length, 10);
  assert.strictEqual(returned.length - returned.replace(/^\s+/, '').length, 20);
  assert.strictEqual(crypto.createHash('sha256').update(returned).digest('hex'),
    '2986802240abeefcdfe6cf884f4f9adadb83d80c13bfd6b306dc39fc8d9b0469',
    'this no longer reproduces the bytes Codex actually returned');

  const schemaPath = 'builder-control/schemas/engineering-review.schema.json';
  const inputDelivery = {
    complete: true,
    coveredPaths: [schemaPath],
    inspectionChallenges: [{
      path: schemaPath,
      lineNumber: 62,
      linePrefix: real.slice(0, 32),
      lineBytes: Buffer.byteLength(real, 'utf8'),
      leadingWhitespace: 10,
      lineSha256: crypto.createHash('sha256').update(real).digest('hex'),
    }],
    inspectionChallengeSha256: 'd'.repeat(64),
  };
  const payload = (lineText) => ({
    disposition: 'APPROVE', findings: [], unverified: [],
    inspectionProofs: [{ path: schemaPath, lineNumber: 62, lineText }],
  });

  assert.strictEqual(validateCodexInspectionProofs(payload(real), inputDelivery).complete, true);

  const reRendered = validateCodexInspectionProofs(payload(returned), inputDelivery);
  assert.strictEqual(reRendered.complete, false);
  assert.match(reRendered.reason, /leading whitespace 20 vs challenged 10/);
  assert.match(reRendered.reason, /content matches exactly after indent correction/);

  // A reviewer that guessed the line must NOT be described as a formatting
  // artefact. The two failures have to stay distinguishable in both directions.
  const invented = validateCodexInspectionProofs(
    payload('          "description": "a plausible sentence that was never in the file at all."'),
    inputDelivery);
  assert.strictEqual(invented.complete, false);
  assert.doesNotMatch(invented.reason, /after indent correction/);
  assert.doesNotMatch(invented.reason, /formatting fault/);
});

// RUN-20260902-5226737c regression, subject 3870834fd6bddd99fa49c9dbc1d2be6e856b2205efdcc2bc8dedeb7bd622ff53.
// Codex G3 twice read builder-control/test/hosting.test.cjs line 1028 and
// returned it without its final comma. The validator was right to reject the
// short line against the exact one, but the published challenge gave the
// reviewer nothing to check its own tail against: linePrefix pins the head,
// leadingWhitespace the indent, and lineBytes is a count no reviewer recomputes
// reliably enough to notice one absent byte. lineSuffix makes trailing
// punctuation self-checkable. Acceptance stays byte-exact.
test('RED: a dropped trailing comma is still rejected, and is named as a truncated tail', () => {
  const real = "    ['ORPHANED', 'Worker supervisor exited unexpectedly; builder termination "
    + "is unverified and retry is blocked', 127, false],";
  const truncated = real.slice(0, -1); // the receipted answer: the final comma dropped
  assert.strictEqual(Buffer.byteLength(real, 'utf8'), 126);
  assert.strictEqual(Buffer.byteLength(truncated, 'utf8'), 125);

  const hostingPath = 'builder-control/test/hosting.test.cjs';
  const linePrefix = real.slice(0, 32);
  const inputDelivery = {
    complete: true,
    coveredPaths: [hostingPath],
    inspectionChallenges: [{
      path: hostingPath,
      lineNumber: 1028,
      linePrefix,
      lineBytes: Buffer.byteLength(real, 'utf8'),
      leadingWhitespace: 4,
      // The published rule, recomputed here independently of the adapter.
      lineSuffix: real.slice(real.length - 16),
      lineSha256: crypto.createHash('sha256').update(real).digest('hex'),
    }],
    inspectionChallengeSha256: 'e'.repeat(64),
  };
  const payload = (lineText) => ({
    disposition: 'APPROVE', findings: [], unverified: [],
    inspectionProofs: [{ path: hostingPath, lineNumber: 1028, lineText }],
  });

  // Byte-exact acceptance is unchanged.
  assert.strictEqual(validateCodexInspectionProofs(payload(real), inputDelivery).complete, true,
    'the exact raw line stopped proving inspection');

  // One missing comma is still a rejection. Nothing here normalises punctuation.
  const dropped = validateCodexInspectionProofs(payload(truncated), inputDelivery);
  assert.strictEqual(dropped.complete, false,
    'a line missing its trailing comma was accepted as an exact inspection proof');
  assert.match(dropped.reason, /returned 125 UTF-8 bytes/);
  assert.match(dropped.reason, /challenged line is 126 bytes/);
  assert.match(dropped.reason, /does not end with the challenged lineSuffix/);
  assert.doesNotMatch(dropped.reason, /after indent correction/,
    'a truncated tail was misreported as a re-indentation artefact');

  // A truncation must stay distinguishable from an invented line in both
  // directions: the invented one shares neither head nor tail.
  const invented = validateCodexInspectionProofs(
    payload("    ['ORPHANED', 'a plausible row that was never in the file at all', 1, true]"),
    inputDelivery);
  assert.strictEqual(invented.complete, false);
  assert.match(invented.reason, /does not begin with the challenged linePrefix/);
});

test('the inspection challenge and the reviewer prompt both carry a bounded deterministic lineSuffix', () => {
  // The documented rule, reimplemented here so the adapter cannot silently
  // redefine it: at most 16 trailing UTF-16 code units, never starting inside a
  // surrogate pair, never leaving fewer than 8 unpublished units between the
  // published prefix and the published suffix.
  const expectedSuffix = (lineText, linePrefix) => {
    const budget = Math.min(16, lineText.length - linePrefix.length - 8);
    if (budget <= 0) return '';
    let start = lineText.length - budget;
    const unit = lineText.charCodeAt(start);
    if (unit >= 0xDC00 && unit <= 0xDFFF) start += 1;
    return lineText.slice(start);
  };

  const reviewPaths = [
    'builder-control/test/hosting.test.cjs',
    'builder-control/schemas/engineering-review.schema.json',
  ];
  const sandbox = prepareReviewSandbox(reviewPaths);
  try {
    const built = buildCodexInput('EXACT SUFFIX TRANSPORT', sandbox, reviewPaths);
    assert.strictEqual(built.inputDelivery.inspectionChallenges.length, reviewPaths.length);

    for (const challenge of built.inputDelivery.inspectionChallenges) {
      const raw = fs.readFileSync(path.join(sandbox.cwd, challenge.path), 'utf8')
        .split(/\r\n|\n|\r/)[challenge.lineNumber - 1];
      assert.strictEqual(typeof challenge.lineSuffix, 'string',
        `${challenge.path} published no lineSuffix`);
      assert.ok(challenge.lineSuffix.length > 0,
        `${challenge.path} published an empty lineSuffix for a full-length candidate line`);
      assert.ok(challenge.lineSuffix.length <= 16, 'lineSuffix exceeded its published bound');
      assert.strictEqual(challenge.lineSuffix, expectedSuffix(raw, challenge.linePrefix),
        `${challenge.path} lineSuffix does not follow the published rule`);
      assert.ok(raw.endsWith(challenge.lineSuffix), 'lineSuffix is not the tail of the challenged line');

      // Prefix + suffix must never span the whole line, or a reviewer could
      // reconstruct it from the challenge instead of locating it in the bundle.
      assert.ok(raw.length - challenge.linePrefix.length - challenge.lineSuffix.length >= 8,
        `${challenge.path} published enough of the line to reconstruct it without reading the file`);

      // It reached the reviewer, not just the private challenge record.
      assert.ok(built.input.includes(`"lineSuffix":${JSON.stringify(challenge.lineSuffix)}`),
        `${challenge.path} lineSuffix never reached the reviewer-visible challenge block`);
      assert.ok(!built.input.includes(challenge.lineSha256),
        'the private line hash leaked into the reviewer-visible challenge block');

      // Acceptance is still exact, and the tail is still load-bearing.
      const payload = (lineText) => ({
        disposition: 'APPROVE',
        findings: [],
        unverified: [],
        inspectionProofs: built.inputDelivery.inspectionChallenges.map((entry) => ({
          path: entry.path,
          lineNumber: entry.lineNumber,
          lineText: entry.path === challenge.path ? lineText
            : fs.readFileSync(path.join(sandbox.cwd, entry.path), 'utf8')
              .split(/\r\n|\n|\r/)[entry.lineNumber - 1],
        })),
      });
      assert.strictEqual(validateCodexInspectionProofs(payload(raw), built.inputDelivery).complete, true,
        `${challenge.path} exact line stopped proving inspection`);
      const shortened = validateCodexInspectionProofs(payload(raw.slice(0, -1)), built.inputDelivery);
      assert.strictEqual(shortened.complete, false,
        `${challenge.path} accepted a line missing its final character`);
      assert.match(shortened.reason, /does not end with the challenged lineSuffix/);
    }

    // The prompt has to demand the tail, not merely publish it.
    assert.match(built.input, /must ALSO end with exactly those characters/);
    assert.match(built.input, /including any trailing comma/);
    assert.match(built.input, /must be exactly lineBytes UTF-8 bytes/);
    assert.match(built.input, /exactly leadingWhitespace whitespace characters/);
  } finally { cleanupReviewSandbox(sandbox); }
});
