#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { liveReviewRecords, reviewCycleLaunchDecision } = require('../review-adapters.cjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
let seq = 0;
const H = (value) => String(value).repeat(64).slice(0, 64);
function rec(subject, reviewer = 'codex', options = {}) {
  seq += 1;
  return {
    reviewId: options.reviewId || `REV-focused-${seq}`,
    ts: `2026-08-31T21:${String(seq).padStart(2, '0')}:00Z`,
    packetId: 'PKT-FOCUSED', reviewer,
    reviewOf: { diffSha256: subject, changedPaths: ['builder-control/review-adapters.cjs'] },
    disposition: options.disposition || 'APPROVE',
    findings: options.findings || [],
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
  };
}

test('direct launch refuses every reviewer after three complete rounds', () => {
  const records = [];
  for (const subject of [H(1), H(2), H(3)]) {
    records.push(rec(subject, 'codex'), rec(subject, 'grok'));
  }
  const decision = reviewCycleLaunchDecision({
    records, packetId: 'PKT-FOCUSED', requiredReviewers: ['codex', 'grok'],
    currentSubjectSha: H(3), reviewer: 'grok',
  });
  assert.strictEqual(decision.ok, false);
  assert.match(decision.reason, /D-14 review-cycle limit reached/);
});

test('an incomplete third round permits only the missing reviewer', () => {
  const records = [
    rec(H(1), 'codex'), rec(H(1), 'grok'),
    rec(H(2), 'codex'), rec(H(2), 'grok'),
    rec(H(3), 'codex'),
  ];
  const grok = reviewCycleLaunchDecision({
    records, packetId: 'PKT-FOCUSED', requiredReviewers: ['codex', 'grok'],
    currentSubjectSha: H(3), reviewer: 'grok',
  });
  const duplicate = reviewCycleLaunchDecision({
    records, packetId: 'PKT-FOCUSED', requiredReviewers: ['codex', 'grok'],
    currentSubjectSha: H(3), reviewer: 'codex',
  });
  assert.strictEqual(grok.ok, true);
  assert.strictEqual(duplicate.ok, false);
  assert.match(duplicate.reason, /not pending/);
});

test('superseded findings are absent from the live eligibility set', () => {
  const original = rec(H(1), 'codex', { reviewId: 'REV-original', disposition: 'REJECT', findings: [{
    severity: 'HIGH', file: 'builder-control/review-adapters.cjs', problem: 'old finding',
    verificationMethod: 'old method', status: 'OPEN',
  }] });
  const replacement = rec(H(1), 'codex', {
    reviewId: 'REV-replacement', supersedes: 'REV-original', disposition: 'APPROVE',
  });
  const live = liveReviewRecords([original, replacement], 'PKT-FOCUSED');
  assert.deepStrictEqual(live.map((record) => record.reviewId), ['REV-replacement']);
  assert.strictEqual(live.flatMap((record) => record.findings || []).length, 0);
});

if (!process.exitCode) console.log(`${passed} passed, 0 failed.`);
