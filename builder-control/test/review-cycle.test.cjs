#!/usr/bin/env node
/**
 * review-cycle.test.cjs — proofs for D-19, D-20 and D-14 enforcement.
 *
 * The failure this guards against is the one that actually happened: a review
 * loop running for seventy hours because nothing counted the rounds. So the
 * proofs here are mostly about the counting being HONEST — that a superseded
 * record is not a new round, that a reformatted finding is still the same
 * finding, and that unreadable evidence stops the run instead of reading as
 * "clear to proceed".
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const RC = require('../review-cycle.cjs');
const ENGOS = require('../engineering-os.cjs');
const SIGNER = require('../review-sign.cjs');
const PACKET = path.join(__dirname, '..', 'packets', 'PKT-20260831-REVIEW-CYCLE-LIMIT.json');
const PACKET_ID = 'PKT-20260831-REVIEW-CYCLE-LIMIT';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// -- fixtures ----------------------------------------------------------------
let seq = 0;
function rec(packetId, subject, opts = {}) {
  seq += 1;
  return {
    reviewId: opts.reviewId || `REV-test-${String(seq).padStart(3, '0')}`,
    ts: opts.ts || `2026-08-${String(10 + seq).padStart(2, '0')}T04:00:00Z`,
    reviewer: opts.reviewer || 'codex',
    reviewerModel: opts.reviewerModel || 'codex-test',
    packetId,
    reviewOf: { diffSha256: subject, changedPaths: opts.changedPaths || ['a.cjs'] },
    disposition: opts.disposition || 'REJECT',
    findings: opts.findings || [],
    ...(opts.reverifiedFindings ? { reverifiedFindings: opts.reverifiedFindings } : {}),
    ...(opts.supersedes ? { supersedes: opts.supersedes } : {}),
  };
}
function finding(opts = {}) {
  return {
    severity: opts.severity || 'HIGH',
    file: opts.file || 'builder-control/thing.cjs',
    location: opts.location || 'line 100',
    problem: opts.problem || 'the widget is not bounded',
    evidence: opts.evidence || 'quoted code',
    impact: opts.impact || 'the governed workflow can make the wrong decision',
    requiredCorrection: opts.requiredCorrection || 'correct the bounded control logic',
    verificationMethod: opts.verificationMethod || 'run the focused deterministic proof',
    status: opts.status || 'OPEN',
  };
}
const H = (n) => String(n).repeat(64).slice(0, 64);

// -- D-19: the cycle limit ---------------------------------------------------
test('one round with no findings proceeds', () => {
  const records = [rec('PKT-A', H(1), { disposition: 'APPROVE' })];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 1);
  assert.strictEqual(r.verdict, 'PROCEED');
  assert.strictEqual(r.roundsRemaining, 2);
});

test('two rounds with blocking findings still proceed - the limit is three', () => {
  const records = [
    rec('PKT-A', H(1), { findings: [finding({ problem: 'first defect' })] }),
    rec('PKT-A', H(2), { findings: [finding({ problem: 'second defect' })] }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 2);
  assert.strictEqual(r.verdict, 'PROCEED');
});

test('D-19: third round with blocking findings HALTS', () => {
  const records = [
    rec('PKT-A', H(1), { findings: [finding({ problem: 'first defect' })] }),
    rec('PKT-A', H(2), { findings: [finding({ problem: 'second defect' })] }),
    rec('PKT-A', H(3), { findings: [finding({ problem: 'third defect' })] }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 3);
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'D-19'));
  assert.strictEqual(r.roundsRemaining, 0);
});

test('third round that is CLEAN routes to the gate and cannot launch a fourth review', () => {
  const records = [
    rec('PKT-A', H(1), { findings: [finding({ problem: 'first defect' })] }),
    rec('PKT-A', H(2), { findings: [finding({ problem: 'second defect' })] }),
    rec('PKT-A', H(3), { disposition: 'APPROVE', findings: [] }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.verdict, 'COMPLETE_GATE');
  assert.strictEqual(r.roundsRemaining, 0);
});

test('an incomplete third round permits only the missing required reviewer', () => {
  const records = [
    rec('PKT-A', H(1), { reviewer: 'codex', disposition: 'APPROVE' }),
    rec('PKT-A', H(1), { reviewer: 'grok', disposition: 'APPROVE' }),
    rec('PKT-A', H(2), { reviewer: 'codex', disposition: 'APPROVE' }),
    rec('PKT-A', H(2), { reviewer: 'grok', disposition: 'APPROVE' }),
    rec('PKT-A', H(3), { reviewer: 'codex', disposition: 'APPROVE' }),
  ];
  const partial = RC.analyze({
    records,
    packetId: 'PKT-A',
    requiredReviewers: ['codex', 'grok'],
    currentSubjectSha: H(3),
  });
  assert.strictEqual(partial.verdict, 'PROCEED');
  assert.deepStrictEqual(partial.allowedReviewers, ['grok']);
  records.push(rec('PKT-A', H(3), { reviewer: 'grok', disposition: 'APPROVE' }));
  const complete = RC.analyze({
    records,
    packetId: 'PKT-A',
    requiredReviewers: ['codex', 'grok'],
    currentSubjectSha: H(3),
  });
  assert.strictEqual(complete.verdict, 'COMPLETE_GATE');
  assert.deepStrictEqual(complete.allowedReviewers, []);
});

test('a blocking partial third round still permits the missing adversarial reviewer', () => {
  const records = [
    rec('PKT-A', H(1), { reviewer: 'codex', disposition: 'APPROVE' }),
    rec('PKT-A', H(1), { reviewer: 'grok', disposition: 'APPROVE' }),
    rec('PKT-A', H(2), { reviewer: 'codex', disposition: 'APPROVE' }),
    rec('PKT-A', H(2), { reviewer: 'grok', disposition: 'APPROVE' }),
    rec('PKT-A', H(3), { reviewer: 'codex', findings: [finding({ problem: 'third defect' })] }),
  ];
  const partial = RC.analyze({
    records,
    packetId: 'PKT-A',
    requiredReviewers: ['codex', 'grok'],
    currentSubjectSha: H(3),
  });
  assert.strictEqual(partial.verdict, 'PROCEED');
  assert.deepStrictEqual(partial.allowedReviewers, ['grok']);
});

test('a fourth subject is refused even when the third round was incomplete', () => {
  const records = [
    rec('PKT-A', H(1), { reviewer: 'codex', disposition: 'APPROVE' }),
    rec('PKT-A', H(2), { reviewer: 'codex', disposition: 'APPROVE' }),
    rec('PKT-A', H(3), { reviewer: 'codex', disposition: 'APPROVE' }),
  ];
  const result = RC.analyze({
    records,
    packetId: 'PKT-A',
    requiredReviewers: ['codex', 'grok'],
    currentSubjectSha: H(4),
  });
  assert.strictEqual(result.verdict, 'HALT_ESCALATE');
  assert.ok(result.reasons.some((reason) => reason.rule === 'D-19'));
});

test('D-19: a fourth round is itself the violation', () => {
  const records = [1, 2, 3, 4].map((n) =>
    rec('PKT-A', H(n), { findings: [finding({ problem: `defect ${n}` })] }));
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 4);
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
  assert.ok(r.reasons.some((x) => /should never have been started/.test(x.detail)));
});

test('MEDIUM and LOW findings do not block, but a third round still routes to the gate', () => {
  const records = [
    rec('PKT-A', H(1), { findings: [finding({ severity: 'MEDIUM' })] }),
    rec('PKT-A', H(2), { findings: [finding({ severity: 'LOW' })] }),
    rec('PKT-A', H(3), { findings: [finding({ severity: 'INFORMATIONAL' })] }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.verdict, 'COMPLETE_GATE');
});

test('dispositioned findings do not block: FIXED, DISPUTED, ACCEPTED_RISK', () => {
  for (const status of ['FIXED', 'DISPUTED', 'ACCEPTED_RISK']) {
    assert.strictEqual(RC.isBlocking(finding({ status })), false, status);
  }
  assert.strictEqual(RC.isBlocking(finding({ status: 'OPEN' })), true);
});

// -- round counting honesty --------------------------------------------------
test('a superseded record is not an extra round', () => {
  const first = rec('PKT-A', H(1), { reviewId: 'REV-original' });
  const replacement = rec('PKT-A', H(1), {
    reviewId: 'REV-replacement', supersedes: 'REV-original',
  });
  const r = RC.analyze({ records: [first, replacement], packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 1, 'superseded original must not count');
  assert.strictEqual(r.rounds[0].reviewIds[0], 'REV-replacement');
});

test('cross-reviewer supersession fails closed and does not erase the target', () => {
  const first = rec('PKT-A', H(1), { reviewId: 'REV-codex', reviewer: 'codex' });
  const attacker = rec('PKT-A', H(1), {
    reviewId: 'REV-grok', reviewer: 'grok', supersedes: 'REV-codex',
  });
  const r = RC.analyze({ records: [first, attacker], packetId: 'PKT-A' });
  assert.strictEqual(r.rounds[0].reviewIds.length, 2, 'invalid declaration retires nothing');
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'REVIEW-EVIDENCE'));
});

test('cross-subject supersession fails closed and does not reduce the round count', () => {
  const first = rec('PKT-A', H(1), { reviewId: 'REV-old' });
  const attacker = rec('PKT-A', H(2), {
    reviewId: 'REV-new', supersedes: 'REV-old',
  });
  const r = RC.analyze({ records: [first, attacker], packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 2);
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
});

test('unknown, self and cross-packet supersessions all fail closed', () => {
  const target = rec('PKT-B', H(1), { reviewId: 'REV-other-packet' });
  for (const bad of [
    rec('PKT-A', H(1), { reviewId: 'REV-unknown', supersedes: 'REV-missing' }),
    rec('PKT-A', H(1), { reviewId: 'REV-self', supersedes: 'REV-self' }),
    rec('PKT-A', H(1), { reviewId: 'REV-cross-packet', supersedes: 'REV-other-packet' }),
  ]) {
    const r = RC.analyze({ records: [target, bad], packetId: 'PKT-A' });
    assert.strictEqual(r.verdict, 'HALT_ESCALATE');
    assert.ok(r.supersessionProblems.length > 0);
  }
});

test('two reviewers on the same subject are ONE round, not two', () => {
  const records = [
    rec('PKT-A', H(1), { reviewer: 'codex' }),
    rec('PKT-A', H(1), { reviewer: 'grok' }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 1);
  assert.deepStrictEqual(r.rounds[0].reviewers.sort(), ['codex', 'grok']);
});

test('records for other packets are not counted', () => {
  const records = [
    rec('PKT-A', H(1)), rec('PKT-B', H(2)), rec('PKT-B', H(3)), rec('PKT-B', H(4)),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 1);
  assert.strictEqual(r.verdict, 'PROCEED');
});

test('rounds are ordered by timestamp, not file order', () => {
  const late = rec('PKT-A', H(1), { ts: '2026-08-30T04:00:00Z' });
  const early = rec('PKT-A', H(2), { ts: '2026-08-20T04:00:00Z' });
  const r = RC.analyze({ records: [late, early], packetId: 'PKT-A' });
  assert.strictEqual(r.rounds[0].subject, H(2), 'earliest ts is round 1');
});

// -- D-20: recurrence --------------------------------------------------------
test('D-20: a finding raised, fixed, and raised again is DISPUTED immediately', () => {
  const problem = 'the packet write authority is unbounded';
  const raised = rec('PKT-A', H(1), {
    reviewId: 'REV-raised', reviewer: 'codex', findings: [finding({ problem })],
  });
  const records = [
    raised,
    rec('PKT-A', H(2), {
      reviewId: 'REV-addressed', reviewer: 'grok', disposition: 'APPROVE',
      reverifiedFindings: [{
        sourceReviewId: raised.reviewId, findingIndex: 0,
        verificationMethod: raised.findings[0].verificationMethod,
        evidence: 'focused deterministic proof passed', outcome: 'PASS',
      }],
    }),
    rec('PKT-A', H(3), { findings: [finding({ problem, status: 'OPEN' })] }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  // Only two rounds - under the cycle limit - so this can ONLY come from D-20.
  assert.strictEqual(r.roundCount, 3);
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'D-20'));
  assert.strictEqual(r.disputed.length, 1);
  assert.strictEqual(r.disputed[0].firstRaisedRound, 1);
  assert.strictEqual(r.disputed[0].addressedRound, 2);
  assert.strictEqual(r.disputed[0].raisedAgainRound, 3);
});

test('repeated OPEN findings without intervening FIXED evidence are not D-20 churn', () => {
  const problem = 'same complaint';
  const records = [
    rec('PKT-A', H(1), { findings: [finding({ problem })] }),
    rec('PKT-A', H(2), { findings: [finding({ problem })] }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.disputed.length, 0);
  assert.strictEqual(r.verdict, 'PROCEED');
});

test('D-20 does not wait for an additional round after OPEN then FIXED then OPEN', () => {
  const problem = 'same complaint';
  const raised = rec('PKT-A', H(1), {
    reviewId: 'REV-first-open', reviewer: 'codex', findings: [finding({ problem })],
  });
  const records = [
    raised,
    rec('PKT-A', H(2), {
      reviewer: 'grok', disposition: 'APPROVE', reverifiedFindings: [{
        sourceReviewId: raised.reviewId, findingIndex: 0,
        verificationMethod: raised.findings[0].verificationMethod,
        evidence: 'verification passed', outcome: 'PASS',
      }],
    }),
    rec('PKT-A', H(3), { findings: [finding({ problem, status: 'OPEN' })] }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'D-20'));
});

test('D-20 fires when one corrected-subject reviewer verifies and another raises the finding again', () => {
  const problem = 'same corrected-subject complaint';
  const raised = rec('PKT-A', H(1), {
    reviewId: 'REV-same-round-raised', reviewer: 'codex', findings: [finding({ problem })],
  });
  const records = [
    raised,
    rec('PKT-A', H(2), {
      reviewId: 'REV-same-round-proof', reviewer: 'grok', disposition: 'APPROVE',
      reverifiedFindings: [{
        sourceReviewId: raised.reviewId, findingIndex: 0,
        verificationMethod: raised.findings[0].verificationMethod,
        evidence: 'independent focused proof passed', outcome: 'PASS',
      }],
    }),
    rec('PKT-A', H(2), {
      reviewId: 'REV-same-round-returned', reviewer: 'codex',
      findings: [finding({ problem, status: 'OPEN' })],
    }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'D-20'));
  assert.strictEqual(r.disputed.length, 1);
  assert.strictEqual(r.disputed[0].addressedRound, 2);
  assert.strictEqual(r.disputed[0].raisedAgainRound, 2);
});

test('recurrence survives a line-number move - location is not fingerprinted', () => {
  const problem = 'unbounded write';
  const a = finding({ problem, location: 'line 412' });
  const b = finding({ problem, location: 'line 418' });
  assert.strictEqual(RC.fingerprint(a), RC.fingerprint(b));
});

test('recurrence survives whitespace, case and trailing punctuation drift', () => {
  const a = finding({ problem: 'The widget  is not bounded.' });
  const b = finding({ problem: 'the widget is not bounded' });
  assert.strictEqual(RC.fingerprint(a), RC.fingerprint(b));
});

test('different files with identical text are NOT the same finding', () => {
  const a = finding({ problem: 'unbounded write', file: 'one.cjs' });
  const b = finding({ problem: 'unbounded write', file: 'two.cjs' });
  assert.notStrictEqual(RC.fingerprint(a), RC.fingerprint(b));
});

test('different severities are NOT the same finding', () => {
  const a = finding({ problem: 'unbounded write', severity: 'HIGH' });
  const b = finding({ problem: 'unbounded write', severity: 'MEDIUM' });
  assert.notStrictEqual(RC.fingerprint(a), RC.fingerprint(b));
});

test('a finding repeated three times is ONE dispute, not three', () => {
  const problem = 'the same complaint';
  const raised = rec('PKT-A', H(1), {
    reviewId: 'REV-repeat-raised', reviewer: 'codex', findings: [finding({ problem })],
  });
  const records = [
    raised,
    rec('PKT-A', H(2), {
      reviewer: 'grok', disposition: 'APPROVE', reverifiedFindings: [{
        sourceReviewId: raised.reviewId, findingIndex: 0,
        verificationMethod: raised.findings[0].verificationMethod,
        evidence: 'verification passed', outcome: 'PASS',
      }],
    }),
    rec('PKT-A', H(3), { findings: [finding({ problem, status: 'OPEN' })] }),
    rec('PKT-A', H(4), { findings: [finding({ problem, status: 'OPEN' })] }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.disputed.length, 1);
});

test('an unverified, same-reviewer, or mismatched re-verification proof fails closed', () => {
  const raised = rec('PKT-A', H(1), {
    reviewId: 'REV-proof-source', reviewer: 'codex', findings: [finding()],
  });
  const bad = rec('PKT-A', H(2), {
    reviewId: 'REV-proof-bad', reviewer: 'codex', disposition: 'APPROVE',
    reverifiedFindings: [{
      sourceReviewId: raised.reviewId, findingIndex: 0,
      verificationMethod: 'a different method', evidence: 'builder says fixed', outcome: 'PASS',
    }],
  });
  const r = RC.analyze({ records: [raised, bad], packetId: 'PKT-A' });
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'REVIEW-EVIDENCE'));
});

test('the same finding twice WITHIN one round is not a recurrence', () => {
  const problem = 'duplicate in one round';
  const records = [
    rec('PKT-A', H(1), {
      reviewer: 'codex', findings: [finding({ problem })],
    }),
    rec('PKT-A', H(1), {
      reviewer: 'grok', findings: [finding({ problem })],
    }),
  ];
  const r = RC.analyze({ records, packetId: 'PKT-A' });
  assert.strictEqual(r.disputed.length, 0, 'two reviewers agreeing is not churn');
  assert.strictEqual(r.verdict, 'PROCEED');
});

// -- fail-closed -------------------------------------------------------------
test('an unparseable record exits 2, never 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-bad-'));
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(rec('PKT-A', H(1))));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ this is not json');
  const originalError = console.error;
  console.error = () => {};
  let code;
  try {
    code = RC.main(['--packet', 'PKT-A', '--reviews-dir', dir], {
      validateReview: (p) => ({ ok: true, rec: JSON.parse(fs.readFileSync(p, 'utf8')) }),
    });
  } finally {
    console.error = originalError;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.strictEqual(code, 2, 'unreadable evidence must not read as PROCEED');
});

test('a missing reviews directory yields no records rather than throwing', () => {
  const loaded = RC.loadRecords(path.join(os.tmpdir(), 'rc-does-not-exist-' + Date.now()));
  assert.deepStrictEqual(loaded.records, []);
  assert.deepStrictEqual(loaded.problems, []);
});

test('canonical loader counts only signed, schema-valid substantive reviews', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-authority-'));
  try {
    const valid = SIGNER.sign(rec(PACKET_ID, H(1), {
      reviewId: 'REV-authority-valid', disposition: 'APPROVE',
    }), { packetPath: PACKET });
    const unavailable = SIGNER.sign({ ...rec(PACKET_ID, H(2), {
      reviewId: 'REV-authority-unavailable', disposition: 'UNAVAILABLE',
      changedPaths: [],
    }), findings: [], unavailableReason: 'transport unavailable' }, { packetPath: PACKET });
    const unsigned = rec(PACKET_ID, H(3), { reviewId: 'REV-authority-unsigned' });
    const badAttestation = SIGNER.sign(rec(PACKET_ID, H(4), {
      reviewId: 'REV-authority-tampered', disposition: 'APPROVE',
    }), { packetPath: PACKET });
    badAttestation.disposition = 'REJECT';
    const schemaInvalid = SIGNER.sign({ ...rec(PACKET_ID, H(5), {
      reviewId: 'REV-authority-schema', disposition: 'APPROVE',
    }), reviewerModel: '' }, { packetPath: PACKET });
    for (const record of [valid, unavailable, unsigned, badAttestation, schemaInvalid]) {
      fs.writeFileSync(path.join(dir, `${record.reviewId}.json`), JSON.stringify(record));
    }
    const loaded = RC.loadRecords(dir, {
      validateReview: ENGOS.loadReview, packetPath: PACKET, packetId: PACKET_ID,
    });
    assert.deepStrictEqual(loaded.records.map((r) => r.reviewId), ['REV-authority-valid']);
    assert.strictEqual(loaded.unavailable.length, 1, 'UNAVAILABLE is retained as status but consumes no round');
    assert.strictEqual(loaded.problems.length, 3, 'unsigned, tampered and schema-invalid all fail closed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('three canonically validated signed completed rounds still trigger D-19', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-valid-rounds-'));
  try {
    for (let i = 1; i <= 3; i++) {
      const record = SIGNER.sign(rec(PACKET_ID, H(i), {
        reviewId: `REV-signed-round-${i}`,
        findings: [finding({ problem: `signed defect ${i}` })],
      }), { packetPath: PACKET });
      fs.writeFileSync(path.join(dir, `round-${i}.json`), JSON.stringify(record));
    }
    const loaded = RC.loadRecords(dir, {
      validateReview: ENGOS.loadReview, packetPath: PACKET, packetId: PACKET_ID,
    });
    assert.strictEqual(loaded.problems.length, 0);
    const result = RC.analyze({ records: loaded.records, packetId: PACKET_ID });
    assert.strictEqual(result.roundCount, 3);
    assert.strictEqual(result.verdict, 'HALT_ESCALATE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a record with no subject binding is counted, not silently dropped', () => {
  const orphan = rec('PKT-A', null);
  delete orphan.reviewOf;
  const r = RC.analyze({ records: [orphan], packetId: 'PKT-A' });
  assert.strictEqual(r.roundCount, 1);
  assert.strictEqual(r.rounds[0].subject, null);
});

test('CLI requires --packet or --all', () => {
  assert.ok(RC.parseArgs([]).error);
  assert.ok(RC.parseArgs(['--json']).error);
  assert.ok(!RC.parseArgs(['--all']).error);
  assert.ok(!RC.parseArgs(['--packet', 'PKT-A']).error);
});

test('CLI rejects unknown arguments rather than ignoring them', () => {
  assert.ok(RC.parseArgs(['--packet', 'PKT-A', '--force']).error);
});

test('exit code is 1 on HALT and 0 on PROCEED', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-exit-'));
  const write = (n, r) => fs.writeFileSync(path.join(dir, `r${n}.json`), JSON.stringify(r));
  write(1, rec('PKT-A', H(1), { disposition: 'APPROVE' }));
  const originalLog = console.log;
  console.log = () => {};
  let pass, halt;
  try {
    const dependencies = {
      validateReview: (p) => ({ ok: true, rec: JSON.parse(fs.readFileSync(p, 'utf8')) }),
    };
    pass = RC.main(['--packet', 'PKT-A', '--reviews-dir', dir], dependencies);
    write(2, rec('PKT-A', H(1), { reviewer: 'grok', disposition: 'APPROVE' }));
    write(3, rec('PKT-A', H(2), { reviewer: 'codex', findings: [finding({ problem: 'd2' })] }));
    write(4, rec('PKT-A', H(2), { reviewer: 'grok', disposition: 'APPROVE' }));
    write(5, rec('PKT-A', H(3), { reviewer: 'codex', findings: [finding({ problem: 'd3' })] }));
    write(6, rec('PKT-A', H(3), { reviewer: 'grok', disposition: 'APPROVE' }));
    halt = RC.main(['--packet', 'PKT-A', '--reviews-dir', dir], dependencies);
  } finally {
    console.log = originalLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.strictEqual(pass, 0);
  assert.strictEqual(halt, 1);
});

test('CLI keeps a Codex-only third round open for the missing Grok reviewer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-cli-required-reviewers-'));
  const records = [
    rec('PKT-A', H(1), { reviewer: 'codex', disposition: 'APPROVE' }),
    rec('PKT-A', H(1), { reviewer: 'grok', disposition: 'APPROVE' }),
    rec('PKT-A', H(2), { reviewer: 'codex', disposition: 'APPROVE' }),
    rec('PKT-A', H(2), { reviewer: 'grok', disposition: 'APPROVE' }),
    rec('PKT-A', H(3), { reviewer: 'codex', disposition: 'APPROVE' }),
  ];
  records.forEach((record, index) => {
    fs.writeFileSync(path.join(dir, `r${index}.json`), JSON.stringify(record));
  });
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  let code;
  try {
    code = RC.main(['--packet', 'PKT-A', '--reviews-dir', dir, '--json'], {
      validateReview: (p) => ({ ok: true, rec: JSON.parse(fs.readFileSync(p, 'utf8')) }),
    });
  } finally {
    console.log = originalLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const result = JSON.parse(lines.join('\n'));
  assert.strictEqual(code, 0);
  assert.strictEqual(result.verdict, 'PROCEED');
  assert.deepStrictEqual(result.allowedReviewers, ['grok']);
});

test('packetIdsIn finds every packet and ignores records without one', () => {
  const nameless = rec('PKT-A', H(9));
  delete nameless.packetId;
  const ids = RC.packetIdsIn([rec('PKT-B', H(1)), rec('PKT-A', H(2)), nameless]);
  assert.deepStrictEqual(ids, ['PKT-A', 'PKT-B']);
});

// -- the regression this file exists for -------------------------------------
test('REGRESSION: seventy hours of the same finding cannot report PROCEED', () => {
  // Twelve rounds, the same unresolved complaint every time. This is the shape
  // of the loop that ran against this codebase for three days. Before this
  // module existed nothing in builder-control could answer "how many times has
  // this been reviewed?" - so the honest requirement is simply that this state
  // is impossible to read as healthy.
  const problem = 'the gate cannot certify itself';
  const records = Array.from({ length: 12 }, (_, i) =>
    rec('PKT-LOOP', H((i % 9) + 1) + String(i), { findings: [finding({ problem })] }));
  const r = RC.analyze({ records, packetId: 'PKT-LOOP' });
  assert.strictEqual(r.verdict, 'HALT_ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'D-19'), 'cycle limit fires');
  assert.ok(!r.reasons.some((x) => x.rule === 'D-20'), 'OPEN repetition alone is not fabricated churn');
  assert.strictEqual(r.roundsRemaining, 0);
});

// -- runner ------------------------------------------------------------------
let passed = 0;
const failures = [];
for (const t of tests) {
  try {
    t.fn();
    passed += 1;
  } catch (e) {
    failures.push({ name: t.name, message: e && e.message });
  }
}
for (const f of failures) {
  console.log(`FAIL  ${f.name}`);
  console.log(`      ${f.message}`);
}
console.log(`${passed} passed, ${failures.length} failed.`);
process.exit(failures.length === 0 ? 0 : 1);
