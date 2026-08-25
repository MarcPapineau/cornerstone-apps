#!/usr/bin/env node
/**
 * review-sign.test.cjs — red proofs for review attestation.
 *
 * The hole being closed: the gate used to trust any JSON in reviews/, so the
 * builder could satisfy its own independent-review requirement by writing a
 * file. Every case below asserts that a forged or altered record is REFUSED.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BC = path.join(ROOT, 'builder-control');
const ENGOS = path.join(BC, 'engineering-os.cjs');
const S = require('../review-sign.cjs');

let passed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-sign-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

const PACKET = path.join(BC, 'packets', 'ENGINEERING-OS-V1.json');
const PACKET_ID = JSON.parse(fs.readFileSync(PACKET, 'utf8')).packetId;
const SHA = 'a'.repeat(64);

const record = (over = {}) => ({
  reviewId: 'REV-sign-001',
  ts: '2026-08-24T12:00:00Z',
  reviewer: 'codex',
  reviewerModel: 'codex-cli-fixture',
  packetId: PACKET_ID,
  reviewOf: { diffSha256: SHA, changedPaths: ['src/app.ts'] },
  disposition: 'APPROVE',
  findings: [],
  ...over,
});

console.log('AEGIS review attestation — red proofs');

test('a signed record verifies', () => {
  const signed = S.sign(record(), { packetPath: PACKET });
  assert.ok(signed.attestation && signed.attestation.mac);
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).ok, true);
});

test('RED: an UNSIGNED record is refused — this is the forged-approval case', () => {
  const r = S.verify(record(), { packetPath: PACKET });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ATTESTATION-MISSING');
  assert.ok(/anyone can write JSON/.test(r.reason));
});

for (const [field, mutate] of [
  ['disposition', (r) => { r.disposition = 'APPROVE'; }],
  ['reviewer', (r) => { r.reviewer = 'grok'; }],
  ['reviewerModel', (r) => { r.reviewerModel = 'something-else'; }],
  ['subject hash', (r) => { r.reviewOf.diffSha256 = 'b'.repeat(64); }],
  ['changedPaths', (r) => { r.reviewOf.changedPaths = ['src/app.ts', 'src/extra.ts']; }],
]) {
  test(`RED: editing ${field} after signing invalidates the attestation`, () => {
    const signed = S.sign(record({ disposition: 'REJECT' }), { packetPath: PACKET });
    assert.strictEqual(S.verify(signed, { packetPath: PACKET }).ok, true, 'baseline must verify');
    mutate(signed);
    const r = S.verify(signed, { packetPath: PACKET });
    assert.strictEqual(r.ok, false, `${field} was edited and still verified`);
    assert.strictEqual(r.code, 'ATTESTATION-INVALID');
  });
}

test('RED: downgrading a finding severity after signing is detected', () => {
  const signed = S.sign(record({
    disposition: 'REJECT',
    findings: [{ severity: 'CRITICAL', file: 'a.js', problem: 'p', evidence: 'e',
                 impact: 'i', requiredCorrection: 'c', verificationMethod: 'v', status: 'OPEN' }],
  }), { packetPath: PACKET });
  signed.findings[0].severity = 'LOW';
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).code, 'ATTESTATION-INVALID');
});

test('RED: flipping a finding to FIXED after signing is detected', () => {
  const signed = S.sign(record({
    disposition: 'REJECT',
    findings: [{ severity: 'HIGH', file: 'a.js', problem: 'p', evidence: 'e',
                 impact: 'i', requiredCorrection: 'c', verificationMethod: 'v', status: 'OPEN' }],
  }), { packetPath: PACKET });
  signed.findings[0].status = 'FIXED';
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).code, 'ATTESTATION-INVALID');
});

test('RED: widening the packet authorization after signing invalidates the review', () => {
  // Finding #3: a review bound only to a packetId is not bound to what that
  // packet permitted, and packets are excluded from the subject hash — so an
  // edit here moves nothing the gate would otherwise notice.
  const pktCopy = path.join(TMP, 'packet.json');
  const pkt = JSON.parse(fs.readFileSync(PACKET, 'utf8'));
  fs.writeFileSync(pktCopy, JSON.stringify(pkt));
  const signed = S.sign(record(), { packetPath: pktCopy });
  assert.strictEqual(S.verify(signed, { packetPath: pktCopy }).ok, true);

  pkt.filesAllowed = [...pkt.filesAllowed, 'src/**', '**/*'];
  fs.writeFileSync(pktCopy, JSON.stringify(pkt));
  const r = S.verify(signed, { packetPath: pktCopy });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ATTESTATION-PACKET-CHANGED');
});

test('the attestation states its own limits rather than overclaiming', () => {
  const signed = S.sign(record(), { packetPath: PACKET });
  assert.ok(/does NOT prove human approval/i.test(signed.attestation.scope),
    'an over-claimed control is worse than a missing one — the scope must say what it cannot do');
});

test('RED: the gate REFUSES an unsigned record dropped into reviews/', () => {
  // End-to-end: the exact forgery this closes.
  const dir = path.join(BC, 'reviews');
  const created = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  const forged = path.join(dir, `.test-forged-${process.pid}.json`);
  fs.writeFileSync(forged, JSON.stringify(record({ reviewId: `REV-forged-${process.pid}` }), null, 2));
  try {
    const r = spawnSync('node', [ENGOS, '--validate-review', forged], { cwd: ROOT, encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0, 'an unsigned hand-written APPROVE must not validate');
    assert.ok(/ATTESTATION-MISSING/.test(r.stdout + r.stderr),
      'the refusal must name the missing attestation');
  } finally {
    try { fs.unlinkSync(forged); } catch {}
    if (created) { try { fs.rmdirSync(dir); } catch {} }
  }
});

test('the attestation key is never committed', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(/\.attestation-key/.test(gi), 'the key must be gitignored');
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'builder-control/.attestation-key'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.notStrictEqual(tracked.status, 0, 'the attestation key must not be tracked by git');
});

const failed = process.exitCode ? 'at least 1' : '0';
// ── PROVEN DEFECT D5 (2026-08-25): attestation coverage gaps ──────────────
// reviewId, ts, unavailableReason and group were OUTSIDE the signed payload.
// Two are load-bearing: supersession names its target by reviewId, and coverage
// is computed from group.groupId. Relabelling either on a validly-signed record
// could retire another reviewer's rejection, or fake exact coverage over a
// subject that was never fully reviewed.
test('RED: every load-bearing field is inside the attestation', () => {
  const P = path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json');
  const base = {
    reviewId: 'REV-cov-1', ts: '2026-08-25T01:00:00Z',
    reviewer: 'codex', reviewerModel: 'm', packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: 'a'.repeat(64), changedPaths: ['x.cjs'] },
    disposition: 'APPROVE', findings: [], unavailableReason: 'none',
    group: { groupId: 'G1', groupDigest: 'd'.repeat(64) },
  };
  const signed = S.sign(base, { packetPath: P });
  const mutate = (k, v) => {
    const c = JSON.parse(JSON.stringify(signed));
    if (k.includes('.')) { const [a, b] = k.split('.'); c[a][b] = v; } else c[k] = v;
    return S.verify(c, { packetPath: P }).ok;
  };
  const mustDetect = [
    ['reviewId', 'REV-forged'],
    ['ts', '2027-01-01T00:00:00Z'],
    ['unavailableReason', 'rewritten'],
    ['group.groupId', 'G9'],
    ['group.groupDigest', 'e'.repeat(64)],
    ['disposition', 'REJECT'],
    ['reviewer', 'grok'],
    ['reviewerModel', 'other'],
    ['reviewOf.diffSha256', 'b'.repeat(64)],
    ['reviewOf.changedPaths', ['y.cjs']],
  ];
  for (const [field, val] of mustDetect) {
    assert.strictEqual(mutate(field, val), false, `${field} can be forged on a signed record`);
  }
});

// ── GROK G9 FINDING #3 ────────────────────────────────────────────────────
test('RED #3: every REQUIRED packet field is inside the packet digest', () => {
  const os2 = require('os');
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json'), 'utf8'));
  const T = fs.mkdtempSync(path.join(fs.realpathSync(os2.tmpdir()), 'pkdig-'));
  const w = (o) => { const f = path.join(T, `p${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify(o)); return f; };
  const base = S.packetDigest(w(src));
  // testsRequired was the dangerous omission: emptying it left the digest
  // identical, so a review stayed "valid" after the checks it depended on were
  // deleted — and packets are excluded from the subject hash, so nothing else moved.
  for (const field of ['testsRequired', 'constraints', 'stopConditions', 'filesAllowed', 'sourceOfTruth']) {
    const c = JSON.parse(JSON.stringify(src));
    c[field] = [];
    assert.notStrictEqual(S.packetDigest(w(c)), base, `emptying ${field} did not change the packet digest`);
  }
  const c2 = JSON.parse(JSON.stringify(src));
  c2.authorization = { ...c2.authorization, allowsProtectedPaths: [] };
  assert.notStrictEqual(S.packetDigest(w(c2)), base, 'narrowing authorization did not change the digest');
  fs.rmSync(T, { recursive: true, force: true });
});

test('RED #3b: a DELETED packet fails verification instead of being skipped', () => {
  const os2 = require('os');
  const T = fs.mkdtempSync(path.join(fs.realpathSync(os2.tmpdir()), 'pkdel-'));
  const pkt = path.join(T, 'packet.json');
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json'), 'utf8'));
  src.packetId = 'PKT-DELETE-TEST';
  fs.writeFileSync(pkt, JSON.stringify(src));
  const rec = S.sign({
    reviewId: 'REV-del-1', ts: '2026-08-25T02:00:00Z', reviewer: 'codex', reviewerModel: 'm',
    packetId: 'PKT-DELETE-TEST',
    reviewOf: { diffSha256: 'a'.repeat(64), changedPaths: ['x.cjs'] },
    disposition: 'APPROVE', findings: [],
  }, { packetPath: pkt });
  assert.strictEqual(S.verify(rec, { packetPath: pkt }).ok, true, 'it must verify while the packet exists');
  fs.unlinkSync(pkt);
  const after = S.verify(rec, { packetPath: pkt });
  assert.strictEqual(after.ok, false, 'deleting the authorizing packet must NOT verify like leaving it untouched');
  assert.strictEqual(after.code, 'ATTESTATION-PACKET-MISSING');
  fs.rmSync(T, { recursive: true, force: true });
});

// ── GROK G11 FINDINGS #1 and #5 ──────────────────────────────────────────
test('RED #1: the supersedes POINTER is inside the attestation', () => {
  const P = path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json');
  const base = {
    reviewId: 'REV-sup-1', ts: '2026-08-25T06:00:00Z', reviewer: 'codex', reviewerModel: 'm',
    packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: 'a'.repeat(64), changedPaths: ['x.cjs'] },
    disposition: 'APPROVE', findings: [], supersedes: 'REV-original',
  };
  const signed = S.sign(base, { packetPath: P });
  // Retargeting supersession would retire a DIFFERENT reviewer's rejection.
  const retargeted = { ...signed, supersedes: 'REV-someone-elses-rejection' };
  assert.strictEqual(S.verify(retargeted, { packetPath: P }).ok, false,
    'a retargeted supersedes pointer must not verify');
  // Adding one where there was none is the same attack from the other side.
  const clean = S.sign({ ...base, supersedes: undefined }, { packetPath: P });
  const injected = { ...clean, supersedes: 'REV-injected' };
  assert.strictEqual(S.verify(injected, { packetPath: P }).ok, false,
    'an injected supersedes pointer must not verify');
});

test('RED #5: aggregate data and group digests are inside the attestation', () => {
  const P = path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json');
  const base = {
    reviewId: 'REV-agg-1', ts: '2026-08-25T06:00:00Z', reviewer: 'codex', reviewerModel: 'm',
    packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: 'a'.repeat(64), changedPaths: ['x.cjs'] },
    disposition: 'APPROVE', findings: [],
    aggregate: {
      groupCount: 2, plannedGroupCount: 2, coverage: 'EXACT',
      groups: [
        { groupId: 'G1', groupDigest: 'd1', pathCount: 1, disposition: 'APPROVE', reviewId: 'REV-G1', attestationDigest: 'ad1' },
        { groupId: 'G2', groupDigest: 'd2', pathCount: 1, disposition: 'APPROVE', reviewId: 'REV-G2', attestationDigest: 'ad2' },
      ],
    },
  };
  const signed = S.sign(base, { packetPath: P });
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(signed)); fn(c); return S.verify(c, { packetPath: P }).ok; };

  assert.strictEqual(mutate((c) => { c.aggregate.coverage = 'PARTIAL'; }), false, 'coverage can be rewritten');
  assert.strictEqual(mutate((c) => { c.aggregate.groupCount = 99; }), false, 'groupCount can be rewritten');
  // The embedded digest is the whole basis of the "editing a group invalidates
  // the aggregate" claim. If it can be rewritten, the claim was decorative.
  assert.strictEqual(mutate((c) => { c.aggregate.groups[0].attestationDigest = 'forged'; }), false,
    'an embedded group attestation digest can be rewritten to match a tampered group');
  assert.strictEqual(mutate((c) => { c.aggregate.groups[1].disposition = 'REJECT'; }), false,
    'a group disposition inside the aggregate can be flipped');
  assert.strictEqual(mutate((c) => { c.aggregate.groups.push({ groupId: 'G3', attestationDigest: 'x' }); }), false,
    'a group can be appended to the aggregate after signing');
});

console.log(`${passed} passed, ${failed} failed.`);
