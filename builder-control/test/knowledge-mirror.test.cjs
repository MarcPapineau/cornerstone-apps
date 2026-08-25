#!/usr/bin/env node
/**
 * knowledge-mirror.test.cjs — red proofs for the human knowledge layer.
 *
 * The mirror's only job is to be useful WITHOUT being authoritative. Every
 * case here asserts that it refused, conflicted, or declined to resolve.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const K = require('../knowledge-mirror.cjs');

let passed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-km-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });
const mk = (name, obj) => { const p = path.join(TMP, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
const NOW = Date.parse('2026-08-24T12:00:00Z');

console.log('AEGIS knowledge mirror — red proofs');

test('an absent mirror is DISCONNECTED, never an empty healthy state', () => {
  const out = K.project({ mirror: path.join(TMP, 'nope.json') });
  assert.strictEqual(out.state, 'DISCONNECTED');
  assert.deepStrictEqual(out.records, []);
  assert.ok(/never been authorized/.test(out.reason));
});

for (const claim of K.FORBIDDEN_CLAIMS) {
  test(`RED: a record asserting "${claim}" is REFUSED, not sanitized`, () => {
    assert.throws(
      () => K.assertNoSelfCertification([{ recordId: 'F-1', [claim]: true }]),
      (e) => e instanceof K.KnowledgeRefusal && new RegExp(claim).test(e.message)
    );
  });
}

test('RED: a record claiming AEGIS concluded VERIFIED is refused', () => {
  assert.throws(
    () => K.assertNoSelfCertification([{ recordId: 'F-2', aegisClaim: 'VERIFIED' }]),
    (e) => e instanceof K.KnowledgeRefusal && /never what AEGIS concluded/.test(e.message)
  );
});

test('a record stating only what the HUMAN believes is allowed', () => {
  assert.doesNotThrow(() => K.assertNoSelfCertification([{ recordId: 'F-3', notionStatus: 'DONE' }]));
});

test('RED: Notion DONE + AEGIS not verified renders CONFLICT and resolves NOTHING', () => {
  const rows = K.reconcile([{ recordId: 'F-1', title: 'Login', notionStatus: 'DONE', syncState: 'SYNCED', lastSyncedAt: '2026-08-24T11:59:00Z' }], {}, NOW);
  const r = rows[0];
  assert.strictEqual(r.syncState, 'CONFLICT');
  assert.ok(r.conflict, 'a conflict object is required');
  assert.strictEqual(r.conflict.notion, 'DONE');
  assert.strictEqual(r.conflict.aegis, 'NOT_VERIFIED');
  assert.ok(/Product Owner decision/i.test(r.conflict.requiredAction));
  // Both values must survive. Preferring either side destroys the signal.
  assert.ok(r.notionStatus === 'DONE' && r.aegisStatus === 'NOT_VERIFIED');
});

test('no conflict when AEGIS genuinely verified the same record', () => {
  const rows = K.reconcile([{ recordId: 'F-1', notionStatus: 'DONE', syncState: 'SYNCED', lastSyncedAt: '2026-08-24T11:59:00Z' }], { 'F-1': 'VERIFIED' }, NOW);
  assert.strictEqual(rows[0].conflict, null);
  assert.strictEqual(rows[0].syncState, 'SYNCED');
});

test('RED: SYNCED with no confirmed write time degrades to PENDING', () => {
  const rows = K.reconcile([{ recordId: 'F-9', notionStatus: 'IN_PROGRESS', syncState: 'SYNCED' }], {}, NOW);
  assert.strictEqual(rows[0].syncState, 'PENDING', 'a write that was never confirmed is not a write');
});

test('an aged sync becomes STALE with its age, not silently fresh', () => {
  const rows = K.reconcile([{ recordId: 'F-4', notionStatus: 'IN_PROGRESS', syncState: 'SYNCED', lastSyncedAt: '2026-08-20T12:00:00Z' }], {}, NOW);
  assert.strictEqual(rows[0].syncState, 'STALE');
  assert.strictEqual(rows[0].ageMinutes, 5760);
});

test('an unknown sync state is DISCONNECTED, never assumed good', () => {
  const rows = K.reconcile([{ recordId: 'F-5', notionStatus: 'X', syncState: 'PROBABLY_FINE' }], {}, NOW);
  assert.strictEqual(rows[0].syncState, 'DISCONNECTED');
});

test('a failed sync does NOT downgrade engineering state', () => {
  const rows = K.reconcile([{ recordId: 'F-6', notionStatus: 'IN_PROGRESS', syncState: 'FAILED' }], { 'F-6': 'VERIFIED' }, NOW);
  assert.strictEqual(rows[0].syncState, 'FAILED');
  assert.strictEqual(rows[0].aegisStatus, 'VERIFIED', 'a broken connector must not un-verify real work');
});

test('a Product Owner change is PROPOSED and inert, never a direct code change', () => {
  const rows = K.reconcile([{ recordId: 'F-7', notionStatus: 'NEW', syncState: 'PENDING', proposedChange: 'add SSO' }], {}, NOW);
  assert.strictEqual(rows[0].proposal.state, 'PROPOSED');
  assert.ok(/never modifies code directly/i.test(rows[0].proposal.note));
});

test('the CLI exits 3 on a self-certifying mirror', () => {
  const { spawnSync } = require('child_process');
  const bad = mk('bad.json', { records: [{ recordId: 'F-8', notionStatus: 'DONE', testsPassed: true }] });
  const r = spawnSync('node', [path.join(__dirname, '..', 'knowledge-mirror.cjs'), '--mirror', bad], { encoding: 'utf8' });
  assert.strictEqual(r.status, 3);
  assert.ok(/AEGIS-KNOWLEDGE-SELF-CERTIFICATION/.test(r.stderr));
  assert.ok(/Refused rather than sanitized/.test(r.stderr));
});

const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failed} failed.`);
