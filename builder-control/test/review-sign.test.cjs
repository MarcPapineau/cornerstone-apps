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
const groupFilename = (record) => `${record.reviewId.slice(4)}-${record.group.groupId}.json`;
const crypto = require('crypto');
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

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

console.log('AEGIS review attestation — red proofs');

test('historical V1 attestation reconstructs its original version marker', () => {
  const key = 'historical-v1-fixture-key-material-32-bytes-minimum';
  const prior = process.env.AEGIS_ATTESTATION_KEY;
  process.env.AEGIS_ATTESTATION_KEY = key;
  try {
    const historicalFinding = {
      severity: 'HIGH', file: 'src/app.ts', location: 'line 7', problem: 'historical issue',
      evidence: 'historical proof', impact: 'legacy uncovered field',
      requiredCorrection: 'legacy uncovered field', verificationMethod: 'legacy uncovered field',
      status: 'OPEN',
    };
    const rec = record({ reviewId: 'REV-historical-v1', disposition: 'REJECT',
      findings: [historicalFinding] });
    const packetDigest = S.packetDigest(PACKET, 'aegis-attest-v1');
    const payload = canonical({
      v: 'aegis-attest-v1',
      reviewId: rec.reviewId,
      supersedes: null,
      aggregate: null,
      ts: rec.ts,
      unavailableReason: null,
      group: null,
      subjectSha256: rec.reviewOf.diffSha256,
      changedPaths: rec.reviewOf.changedPaths,
      packetId: rec.packetId,
      packetDigest,
      reviewer: rec.reviewer,
      reviewerModel: rec.reviewerModel,
      disposition: rec.disposition,
      findings: [{
        severity: historicalFinding.severity, file: historicalFinding.file,
        problem: historicalFinding.problem, evidence: historicalFinding.evidence,
        status: historicalFinding.status,
      }],
    });
    const historical = {
      ...rec,
      attestation: {
        v: 'aegis-attest-v1',
        alg: 'HMAC-SHA256',
        packetDigest,
        payloadDigest: crypto.createHash('sha256').update(payload).digest('hex'),
        mac: crypto.createHmac('sha256', key).update(payload).digest('hex'),
      },
    };
    const historicalVerification = S.verify(historical, { packetPath: PACKET });
    assert.strictEqual(historicalVerification.ok, true,
      'a genuine V1 payload was not reconstructed byte-for-byte');
    assert.strictEqual(historicalVerification.gateable, false,
      'historical V1 evidence left governance-bearing finding fields uncovered and must not satisfy the current gate');
    assert.strictEqual(historicalVerification.code, 'ATTESTATION-LEGACY-NON-GATEABLE');
    const changed = JSON.parse(JSON.stringify(historical));
    changed.reviewer = 'grok';
    assert.strictEqual(S.verify(changed, { packetPath: PACKET }).ok, false,
      'changing a V1-covered field did not invalidate the historical MAC');
    const historicallyUncovered = JSON.parse(JSON.stringify(historical));
    historicallyUncovered.findings[0].impact = 'changed after signing';
    assert.strictEqual(S.verify(historicallyUncovered, { packetPath: PACKET }).ok, true,
      'V1 verification no longer reproduces the historical partial finding payload');
  } finally {
    if (prior === undefined) delete process.env.AEGIS_ATTESTATION_KEY;
    else process.env.AEGIS_ATTESTATION_KEY = prior;
  }
});

test('a signed record verifies', () => {
  const signed = S.sign(record(), { packetPath: PACKET });
  assert.ok(signed.attestation && signed.attestation.mac);
  assert.strictEqual(signed.attestation.v, 'aegis-attest-v2',
    'new records must never be minted with the legacy partial finding payload');
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).ok, true);
});

test('RED: V2 verification recomputes the recorded payload digest', () => {
  const signed = S.sign(record(), { packetPath: PACKET });
  signed.attestation.payloadDigest = '0'.repeat(64);
  const result = S.verify(signed, { packetPath: PACKET });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'ATTESTATION-PAYLOAD-DIGEST');
});

test('RED: governance-bearing finding fields are covered by every new signature', () => {
  for (const [status, field] of [
    ['DISPUTED', 'builderResponse'],
    ['FALSE_POSITIVE', 'builderResponse'],
    ['ACCEPTED_RISK', 'acceptedBy'],
  ]) {
    const finding = {
      severity: 'HIGH', file: 'a.js', location: 'line 7', problem: 'unsafe path',
      evidence: 'observed branch', impact: 'wrong process may run',
      requiredCorrection: 'bind the route', verificationMethod: 'interleaving proof',
      status,
      ...(field === 'builderResponse' ? { builderResponse: 'bounded rebuttal' }
        : { acceptedBy: 'Marc fixture' }),
    };
    const signed = S.sign(record({ disposition: 'REJECT', findings: [finding] }),
      { packetPath: PACKET });
    assert.strictEqual(signed.attestation.v, 'aegis-attest-v2');
    assert.strictEqual(S.verify(signed, { packetPath: PACKET }).ok, true);
    signed.findings[0][field] += '-tampered';
    assert.strictEqual(S.verify(signed, { packetPath: PACKET }).code, 'ATTESTATION-PAYLOAD-DIGEST',
      `${status}.${field} remained mutable after signing`);
  }
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
    assert.strictEqual(r.code, 'ATTESTATION-PAYLOAD-DIGEST');
  });
}

test('RED: downgrading a finding severity after signing is detected', () => {
  const signed = S.sign(record({
    disposition: 'REJECT',
    findings: [{ severity: 'CRITICAL', file: 'a.js', problem: 'p', evidence: 'e',
                 impact: 'i', requiredCorrection: 'c', verificationMethod: 'v', status: 'OPEN' }],
  }), { packetPath: PACKET });
  signed.findings[0].severity = 'LOW';
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).code, 'ATTESTATION-PAYLOAD-DIGEST');
});

test('RED: flipping a finding to FIXED after signing is detected', () => {
  const signed = S.sign(record({
    disposition: 'REJECT',
    findings: [{ severity: 'HIGH', file: 'a.js', problem: 'p', evidence: 'e',
                 impact: 'i', requiredCorrection: 'c', verificationMethod: 'v', status: 'OPEN' }],
  }), { packetPath: PACKET });
  signed.findings[0].status = 'FIXED';
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).code, 'ATTESTATION-PAYLOAD-DIGEST');
});

test('RED: V2 attestation covers reviewer unverified evidence', () => {
  const signed = S.sign(record({ unverified: ['Could not execute the macOS-only probe.'] }),
    { packetPath: PACKET });
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).ok, true);
  const changed = JSON.parse(JSON.stringify(signed));
  changed.unverified[0] = 'Everything was verified.';
  assert.strictEqual(S.verify(changed, { packetPath: PACKET }).code,
    'ATTESTATION-PAYLOAD-DIGEST',
    'reviewer limitations remained mutable after signing');
});

test('RED: finding-level re-verification linkage and evidence are signed', () => {
  const signed = S.sign(record({
    reviewId: 'REV-sign-verifier-001',
    reviewer: 'human',
    reviewerModel: 'human-fixture',
    reverifiedFindings: [{
      sourceReviewId: 'REV-source-001',
      findingIndex: 0,
      verificationMethod: 'Run the import test.',
      evidence: 'Import test exited 0.',
      outcome: 'PASS',
    }],
  }), { packetPath: PACKET });
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).ok, true);
  for (const field of ['sourceReviewId', 'findingIndex', 'verificationMethod', 'evidence', 'outcome']) {
    const changed = JSON.parse(JSON.stringify(signed));
    changed.reverifiedFindings[0][field] = field === 'findingIndex'
      ? 1
      : `${String(changed.reverifiedFindings[0][field])}-tampered`;
    assert.strictEqual(S.verify(changed, { packetPath: PACKET }).code, 'ATTESTATION-PAYLOAD-DIGEST',
      `${field} remained mutable after signing`);
  }
});

test('RED: every validated finding field is immutable while object key order is irrelevant', () => {
  const finding = {
    severity: 'HIGH', file: 'a.js', location: 'line 7', problem: 'unsafe path',
    evidence: 'observed branch', impact: 'wrong process may run',
    requiredCorrection: 'bind the route', verificationMethod: 'interleaving proof', status: 'OPEN',
  };
  const signed = S.sign(record({ disposition: 'REJECT', findings: [finding] }), { packetPath: PACKET });
  assert.strictEqual(S.verify(signed, { packetPath: PACKET }).ok, true);
  for (const field of Object.keys(finding)) {
    const changed = JSON.parse(JSON.stringify(signed));
    changed.findings[0][field] = `${String(changed.findings[0][field])}-tampered`;
    assert.strictEqual(S.verify(changed, { packetPath: PACKET }).code, 'ATTESTATION-PAYLOAD-DIGEST',
      `${field} remained mutable after signing`);
  }
  const reordered = JSON.parse(JSON.stringify(signed));
  reordered.findings[0] = Object.fromEntries(Object.entries(reordered.findings[0]).reverse());
  assert.strictEqual(S.verify(reordered, { packetPath: PACKET }).ok, true,
    'JSON object key order changed the canonical attestation');
});

test('RED: signing requires one readable active packet whose packetId matches the review', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'authority-'));
  assert.throws(() => S.sign(record({ packetId: 'PKT-NONE' }), { packetsDir: dir }),
    /ATTESTATION-PACKET-MISSING/);

  const wrong = path.join(dir, 'wrong.json');
  fs.writeFileSync(wrong, JSON.stringify({ packetId: 'PKT-OTHER' }));
  assert.throws(() => S.sign(record({ packetId: 'PKT-WANTED' }), { packetPath: wrong }),
    /ATTESTATION-PACKET-MISMATCH/);

  const unreadable = path.join(dir, 'unreadable.json');
  fs.writeFileSync(unreadable, '{not json');
  assert.throws(() => S.sign(record({ packetId: 'PKT-WANTED' }), { packetPath: unreadable }),
    /ATTESTATION-PACKET-UNREADABLE/);

  const backup = path.join(dir, 'PKT-WANTED-BACKUP-2026-08-29.json');
  fs.writeFileSync(backup, JSON.stringify({ packetId: 'PKT-WANTED' }));
  assert.throws(() => S.sign(record({ packetId: 'PKT-WANTED' }), { packetPath: backup }),
    /ATTESTATION-PACKET-BACKUP/);
});

test('RED: verification refuses a null packet digest and an explicit packetId mismatch', () => {
  const signed = S.sign(record(), { packetPath: PACKET });
  const nullDigest = JSON.parse(JSON.stringify(signed));
  nullDigest.attestation.packetDigest = null;
  assert.strictEqual(S.verify(nullDigest, { packetPath: PACKET }).code, 'ATTESTATION-PACKET-MISSING');

  const wrong = path.join(TMP, 'verify-wrong-packet.json');
  fs.writeFileSync(wrong, JSON.stringify({ packetId: 'PKT-OTHER' }));
  assert.strictEqual(S.verify(signed, { packetPath: wrong }).code, 'ATTESTATION-PACKET-MISMATCH');
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
  // End-to-end against an explicit synthetic gate coordinate. The forgery is
  // never published into canonical reviews/, where a concurrent real gate
  // could observe a test artifact and fail for the wrong reason.
  const dir = fs.mkdtempSync(path.join(TMP, 'forged-gate-'));
  const forged = path.join(dir, 'forged.json');
  const changedPath = 'builder-control/review-sign.cjs';
  const syntheticArgs = ['--changed', changedPath, '--diff-lines', '1',
    '--test-only-synthetic-subject'];
  const env = { ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '1' };
  const subjectResult = spawnSync('node', [ENGOS, '--subject', ...syntheticArgs, '--json'],
    { cwd: ROOT, encoding: 'utf8', env });
  assert.strictEqual(subjectResult.status, 0, subjectResult.stderr);
  const subjectSha = JSON.parse(subjectResult.stdout).subjectSha256;
  fs.writeFileSync(forged, JSON.stringify(record({
    reviewId: `REV-forged-${process.pid}`,
    reviewOf: { diffSha256: subjectSha, changedPaths: [changedPath] },
  }), null, 2));
  try {
    const r = spawnSync('node', [ENGOS, '--gate-done', '--subject-sha', subjectSha,
      '--packet', PACKET, '--review', forged, ...syntheticArgs, '--json'],
    { cwd: ROOT, encoding: 'utf8', env });
    assert.notStrictEqual(r.status, 0, 'an unsigned discovered APPROVE must not satisfy the real gate');
    assert.ok(/ATTESTATION-MISSING/.test(r.stdout + r.stderr),
      'the gate refusal must name the missing attestation');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the attestation key is never committed', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(/\.attestation-key/.test(gi), 'the key must be gitignored');
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'builder-control/.attestation-key'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.notStrictEqual(tracked.status, 0, 'the attestation key must not be tracked by git');
});

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
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packets', 'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json'), 'utf8'));
  const T = fs.mkdtempSync(path.join(fs.realpathSync(os2.tmpdir()), 'pkdig-'));
  const w = (o) => { const f = path.join(T, `p${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify(o)); return f; };
  const base = S.packetDigest(w(src));
  // testsRequired was the dangerous omission: emptying it left the digest
  // identical, so a review stayed "valid" after the checks it depended on were
  // deleted — and packets are excluded from the subject hash, so nothing else moved.
  for (const field of ['testsRequired', 'hostContainmentRequired', 'constraints', 'stopConditions', 'filesAllowed', 'sourceOfTruth']) {
    const c = JSON.parse(JSON.stringify(src));
    c[field] = [];
    assert.notStrictEqual(S.packetDigest(w(c)), base, `emptying ${field} did not change the packet digest`);
  }
  const c2 = JSON.parse(JSON.stringify(src));
  c2.authorization = { ...c2.authorization, allowsProtectedPaths: [] };
  assert.notStrictEqual(S.packetDigest(w(c2)), base, 'narrowing authorization did not change the digest');

  const livePacket = w(src);
  const signed = S.sign({
    reviewId: 'REV-host-authority', ts: '2026-08-29T00:00:00Z', reviewer: 'codex', reviewerModel: 'm',
    packetId: src.packetId, reviewOf: { diffSha256: 'a'.repeat(64), changedPaths: ['x.cjs'] },
    disposition: 'APPROVE', findings: [],
  }, { packetPath: livePacket });
  const mutated = JSON.parse(JSON.stringify(src));
  mutated.hostContainmentRequired = [];
  fs.writeFileSync(livePacket, JSON.stringify(mutated));
  assert.strictEqual(S.verify(signed, { packetPath: livePacket }).ok, false,
    'host containment authority changed without staling the signed review');
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
  const groupsDir = fs.mkdtempSync(path.join(TMP, 'aggregate-groups-'));
  const groupRecord = (id, groupId, groupDigest, changedPath) => S.sign({
    reviewId: id, ts: '2026-08-25T05:59:00Z', reviewer: 'codex', reviewerModel: 'm',
    packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: 'a'.repeat(64), changedPaths: [changedPath] },
    disposition: 'APPROVE', findings: [], group: { groupId, groupDigest },
  }, { packetPath: P });
  const group1 = groupRecord('REV-G1', 'G1', 'd1', 'x.cjs');
  const group2 = groupRecord('REV-G2', 'G2', 'd2', 'y.cjs');
  fs.writeFileSync(path.join(groupsDir, groupFilename(group1)), JSON.stringify(group1));
  fs.writeFileSync(path.join(groupsDir, groupFilename(group2)), JSON.stringify(group2));
  const base = {
    reviewId: 'REV-agg-1', ts: '2026-08-25T06:00:00Z', reviewer: 'codex', reviewerModel: 'm',
    packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: 'a'.repeat(64), changedPaths: ['x.cjs', 'y.cjs'] },
    disposition: 'APPROVE', findings: [],
    aggregate: {
      groupCount: 2, plannedGroupCount: 2, coverage: 'EXACT',
      groups: [
        { groupId: 'G1', groupDigest: 'd1', pathCount: 1, disposition: 'APPROVE', reviewId: 'REV-G1', attestationDigest: group1.attestation.payloadDigest },
        { groupId: 'G2', groupDigest: 'd2', pathCount: 1, disposition: 'APPROVE', reviewId: 'REV-G2', attestationDigest: group2.attestation.payloadDigest },
      ],
    },
  };
  const signed = S.sign(base, { packetPath: P });
  assert.strictEqual(S.verify(signed, { packetPath: P, groupsDir }).ok, true,
    'a signed aggregate must resolve its active signed group records');
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(signed)); fn(c); return S.verify(c, { packetPath: P, groupsDir }).ok; };

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

test('RED: only an EXACT complete duplicate-free signed aggregate is gateable', () => {
  const groupsDir = fs.mkdtempSync(path.join(TMP, 'aggregate-exact-only-'));
  const makeGroup = (id, groupId, changedPath) => S.sign({
    reviewId: id, ts: '2026-08-30T22:00:00Z', reviewer: 'codex', reviewerModel: 'm',
    packetId: PACKET_ID, reviewOf: { diffSha256: SHA, changedPaths: [changedPath] },
    disposition: 'APPROVE', findings: [], group: { groupId, groupDigest: `digest-${groupId}` },
  }, { packetPath: PACKET });
  const writeGroups = (groups) => {
    for (const entry of fs.readdirSync(groupsDir)) fs.unlinkSync(path.join(groupsDir, entry));
    for (const group of groups) fs.writeFileSync(path.join(groupsDir, groupFilename(group)), JSON.stringify(group));
  };
  const aggregate = (groups, over = {}) => S.sign({
    reviewId: `REV-exact-${crypto.randomBytes(4).toString('hex')}`,
    ts: '2026-08-30T22:01:00Z', reviewer: 'codex', reviewerModel: 'm', packetId: PACKET_ID,
    reviewOf: { diffSha256: SHA, changedPaths: ['x.cjs', 'y.cjs'] },
    disposition: 'APPROVE', findings: [],
    aggregate: {
      groupCount: groups.length, plannedGroupCount: groups.length, coverage: 'EXACT',
      groups: groups.map((group) => ({
        groupId: group.group.groupId, groupDigest: group.group.groupDigest,
        pathCount: group.reviewOf.changedPaths.length, disposition: group.disposition,
        reviewId: group.reviewId, attestationDigest: group.attestation.payloadDigest,
      })),
      ...over,
    },
  }, { packetPath: PACKET });

  const exactGroups = [makeGroup('REV-exact-G1', 'G1', 'x.cjs'), makeGroup('REV-exact-G2', 'G2', 'y.cjs')];
  writeGroups(exactGroups);
  assert.strictEqual(S.verify(aggregate(exactGroups), { packetPath: PACKET, groupsDir }).gateable, true);

  const partial = S.verify(aggregate(exactGroups, { coverage: 'PARTIAL' }), { packetPath: PACKET, groupsDir });
  assert.strictEqual(partial.gateable, undefined);
  assert.strictEqual(partial.code, 'ATTESTATION-AGGREGATE-COVERAGE-NONEXACT');

  const missingPlan = S.verify(aggregate(exactGroups, { plannedGroupCount: 1 }), { packetPath: PACKET, groupsDir });
  assert.strictEqual(missingPlan.code, 'ATTESTATION-AGGREGATE-PLAN-COUNT');

  const duplicateGroups = [makeGroup('REV-duplicate-G1', 'G1', 'x.cjs'), makeGroup('REV-duplicate-G2', 'G2', 'x.cjs')];
  writeGroups(duplicateGroups);
  const duplicate = S.verify(aggregate(duplicateGroups), { packetPath: PACKET, groupsDir });
  assert.strictEqual(duplicate.code, 'ATTESTATION-AGGREGATE-COVERAGE');

  writeGroups(exactGroups);
  const wider = aggregate(exactGroups);
  wider.reviewOf.changedPaths.push('z.cjs');
  // Re-sign so this tests semantic coverage rather than MAC immutability.
  delete wider.attestation;
  const widerSigned = S.sign(wider, { packetPath: PACKET });
  assert.strictEqual(S.verify(widerSigned, { packetPath: PACKET, groupsDir }).code,
    'ATTESTATION-AGGREGATE-COVERAGE');
});

test('RED: a V2 aggregate refuses missing, substituted, or changed active group evidence', () => {
  const P = path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json');
  const groupsDir = fs.mkdtempSync(path.join(TMP, 'aggregate-resolution-'));
  const makeGroup = (over = {}) => S.sign({
    reviewId: 'REV-resolve-G1', ts: '2026-08-25T05:59:00Z',
    reviewer: 'codex', reviewerModel: 'm', packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: SHA, changedPaths: ['x.cjs'] },
    disposition: 'APPROVE', findings: [], group: { groupId: 'G1', groupDigest: 'd1' },
    ...over,
  }, { packetPath: P });
  const group = makeGroup();
  const aggregate = S.sign({
    reviewId: 'REV-resolve-aggregate', ts: '2026-08-25T06:00:00Z',
    reviewer: 'codex', reviewerModel: 'm', packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: SHA, changedPaths: ['x.cjs'] },
    disposition: 'APPROVE', findings: [],
    aggregate: {
      groupCount: 1, plannedGroupCount: 1, coverage: 'EXACT',
      groups: [{ groupId: 'G1', groupDigest: 'd1', pathCount: 1,
        disposition: 'APPROVE', reviewId: group.reviewId,
        attestationDigest: group.attestation.payloadDigest }],
    },
  }, { packetPath: P });
  const groupPath = path.join(groupsDir, groupFilename(group));
  fs.writeFileSync(groupPath, JSON.stringify(group));
  assert.strictEqual(S.verify(aggregate, { packetPath: P, groupsDir }).ok, true);

  fs.writeFileSync(path.join(groupsDir, 'unrelated-truncated.json'), '{');
  try { fs.symlinkSync(path.join(groupsDir, 'unrelated-truncated.json'), path.join(groupsDir, 'unrelated-link.json')); } catch {}
  assert.strictEqual(S.verify(aggregate, { packetPath: P, groupsDir }).ok, true,
    'an unrelated malformed or symlink sibling must not control this signed aggregate');
  fs.writeFileSync(path.join(groupsDir, 'alternate-valid-duplicate.json'), JSON.stringify(group));
  assert.strictEqual(S.verify(aggregate, { packetPath: P, groupsDir }).code,
    'ATTESTATION-AGGREGATE-GROUP-MISSING', 'a second valid claimant must fail closed');
  fs.unlinkSync(path.join(groupsDir, 'alternate-valid-duplicate.json'));

  fs.unlinkSync(groupPath);
  assert.strictEqual(S.verify(aggregate, { packetPath: P, groupsDir }).code,
    'ATTESTATION-AGGREGATE-GROUP-MISSING');

  const substituted = makeGroup({ reviewerModel: 'different-model' });
  fs.writeFileSync(groupPath, JSON.stringify(substituted));
  assert.strictEqual(S.verify(aggregate, { packetPath: P, groupsDir }).code,
    'ATTESTATION-AGGREGATE-GROUP-MISMATCH');

  const changedDigest = JSON.parse(JSON.stringify(group));
  changedDigest.attestation.payloadDigest = '0'.repeat(64);
  fs.writeFileSync(groupPath, JSON.stringify(changedDigest));
  assert.strictEqual(S.verify(aggregate, { packetPath: P, groupsDir }).code,
    'ATTESTATION-AGGREGATE-GROUP-INVALID');
});

test('RED: a V2 aggregate cannot wrap a historical V1 non-gateable group', () => {
  const P = path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json');
  const groupsDir = fs.mkdtempSync(path.join(TMP, 'aggregate-v1-refusal-'));
  const key = 'aggregate-v1-refusal-key-material-32-bytes-minimum';
  const prior = process.env.AEGIS_ATTESTATION_KEY;
  process.env.AEGIS_ATTESTATION_KEY = key;
  try {
    const group = {
      reviewId: 'REV-legacy-aggregate-G1', ts: '2026-08-25T05:59:00Z',
      reviewer: 'codex', reviewerModel: 'legacy-model',
      packetId: 'PKT-20260823-ENGINEERING-OS-V1',
      reviewOf: { diffSha256: SHA, changedPaths: ['x.cjs'] },
      disposition: 'APPROVE', findings: [],
      group: { groupId: 'G1', groupDigest: 'legacy-digest' },
    };
    const packetDigest = S.packetDigest(P, 'aegis-attest-v1');
    const payload = canonical({
      v: 'aegis-attest-v1', reviewId: group.reviewId, supersedes: null,
      aggregate: null, ts: group.ts, unavailableReason: null,
      group: { groupId: 'G1', groupDigest: 'legacy-digest' },
      subjectSha256: SHA, changedPaths: ['x.cjs'], packetId: group.packetId,
      packetDigest, reviewer: group.reviewer, reviewerModel: group.reviewerModel,
      disposition: group.disposition, findings: [],
    });
    const historical = {
      ...group,
      attestation: {
        v: 'aegis-attest-v1', alg: 'HMAC-SHA256', packetDigest,
        payloadDigest: crypto.createHash('sha256').update(payload).digest('hex'),
        mac: crypto.createHmac('sha256', key).update(payload).digest('hex'),
      },
    };
    const historicalVerification = S.verify(historical, { packetPath: P });
    assert.strictEqual(historicalVerification.ok, true);
    assert.strictEqual(historicalVerification.gateable, false);
    fs.writeFileSync(path.join(groupsDir, groupFilename(historical)), JSON.stringify(historical));

    const aggregate = S.sign({
      reviewId: 'REV-v2-over-v1', ts: '2026-08-25T06:00:00Z',
      reviewer: 'codex', reviewerModel: 'legacy-model',
      packetId: group.packetId,
      reviewOf: { diffSha256: SHA, changedPaths: ['x.cjs'] },
      disposition: 'APPROVE', findings: [],
      aggregate: {
        groupCount: 1, plannedGroupCount: 1, coverage: 'EXACT',
        groups: [{ groupId: 'G1', groupDigest: 'legacy-digest', pathCount: 1,
          disposition: 'APPROVE', reviewId: historical.reviewId,
          attestationDigest: historical.attestation.payloadDigest }],
      },
    }, { packetPath: P });
    const verdict = S.verify(aggregate, { packetPath: P, groupsDir });
    assert.strictEqual(verdict.ok, false,
      'a V2 wrapper upgraded a non-gateable historical constituent into current evidence');
    assert.strictEqual(verdict.code, 'ATTESTATION-AGGREGATE-GROUP-INVALID');
    assert.match(verdict.reason, /not current gateable active evidence/);
  } finally {
    if (prior === undefined) delete process.env.AEGIS_ATTESTATION_KEY;
    else process.env.AEGIS_ATTESTATION_KEY = prior;
  }
});

test('RED: a signed aggregate must publish the exact deterministic unverified merge of its groups', () => {
  const P = path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json');
  const groupsDir = fs.mkdtempSync(path.join(TMP, 'aggregate-unverified-'));
  const makeGroup = (reviewId, groupId, changedPath, unverified) => S.sign({
    reviewId, ts: '2026-08-30T00:00:00Z', reviewer: 'codex', reviewerModel: 'm',
    packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: SHA, changedPaths: [changedPath] },
    disposition: 'APPROVE', findings: [], unverified,
    group: { groupId, groupDigest: `digest-${groupId}` },
  }, { packetPath: P });
  const group1 = makeGroup('REV-unverified-G1', 'G1', 'x.cjs', ['zeta', 'same limit']);
  const group2 = makeGroup('REV-unverified-G2', 'G2', 'y.cjs', ['alpha', 'same limit']);
  fs.writeFileSync(path.join(groupsDir, groupFilename(group1)), JSON.stringify(group1));
  fs.writeFileSync(path.join(groupsDir, groupFilename(group2)), JSON.stringify(group2));

  const aggregateRecord = (unverified) => ({
    reviewId: 'REV-unverified-aggregate', ts: '2026-08-30T00:01:00Z',
    reviewer: 'codex', reviewerModel: 'm', packetId: 'PKT-20260823-ENGINEERING-OS-V1',
    reviewOf: { diffSha256: SHA, changedPaths: ['x.cjs', 'y.cjs'] },
    disposition: 'APPROVE', findings: [], unverified,
    aggregate: {
      groupCount: 2, plannedGroupCount: 2, coverage: 'EXACT',
      groups: [group1, group2].map((group) => ({
        groupId: group.group.groupId,
        groupDigest: group.group.groupDigest,
        pathCount: 1,
        disposition: group.disposition,
        reviewId: group.reviewId,
        attestationDigest: group.attestation.payloadDigest,
      })),
    },
  });

  const exact = S.sign(aggregateRecord(['alpha', 'same limit', 'same limit', 'zeta']),
    { packetPath: P });
  assert.strictEqual(S.verify(exact, { packetPath: P, groupsDir }).ok, true,
    'exact group limitations did not verify');

  for (const wrong of [
    [],
    ['alpha', 'same limit', 'zeta'],
    ['zeta', 'same limit', 'same limit', 'alpha'],
    ['alpha', 'invented', 'same limit', 'same limit', 'zeta'],
  ]) {
    const inconsistent = S.sign(aggregateRecord(wrong), { packetPath: P });
    const verdict = S.verify(inconsistent, { packetPath: P, groupsDir });
    assert.strictEqual(verdict.code, 'ATTESTATION-AGGREGATE-UNVERIFIED',
      `published ${JSON.stringify(wrong)} was accepted against signed groups`);
  }

  const malformedGroup = S.sign({ ...group1, attestation: undefined,
    unverified: ['valid', { hidden: true }] }, { packetPath: P });
  fs.writeFileSync(path.join(groupsDir, groupFilename(malformedGroup)), JSON.stringify(malformedGroup));
  const malformedAggregate = aggregateRecord(['alpha', 'same limit']);
  malformedAggregate.aggregate.groups[0].attestationDigest = malformedGroup.attestation.payloadDigest;
  const malformedVerdict = S.verify(S.sign(malformedAggregate, { packetPath: P }), { packetPath: P, groupsDir });
  assert.strictEqual(malformedVerdict.ok, false);
  assert.strictEqual(malformedVerdict.code, 'ATTESTATION-AGGREGATE-GROUP-INVALID',
    'malformed signed group limitations reached a gateable aggregate');
});


// ── PROVEN DEFECT (2026-08-25): a BACKUP packet was resolved as the authority ──
// packets/ holds in-place backups — PKT-X.json beside PKT-X-BACKUP-<date>.json —
// and a backup carries the SAME packetId because it is a copy. The resolver
// returned the first directory match, and `-BACKUP-` sorts before `.json`, so a
// validly-signed Codex G1 record was digested against a stale copy and REFUSED
// for a change that never happened. These proofs pin all three outcomes: the
// active file wins, no active file fails closed, and two active files refuse
// rather than guess.
const PKTS_ROOT = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-pkts-'));
process.on('exit', () => { try { fs.rmSync(PKTS_ROOT, { recursive: true, force: true }); } catch {} });
let pktDirSeq = 0;
const packetDir = () => {
  const d = path.join(PKTS_ROOT, `d${++pktDirSeq}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const REAL_PACKET = JSON.parse(fs.readFileSync(PACKET, 'utf8'));
function writePacket(dir, filename, id, over = {}) {
  const full = path.join(dir, filename);
  fs.writeFileSync(full, JSON.stringify({ ...REAL_PACKET, packetId: id, ...over }, null, 2));
  return full;
}

test('RED: the ACTIVE packet wins over a same-id BACKUP that sorts before it', () => {
  const dir = packetDir();
  const active = writePacket(dir, 'PKT-BK.json', 'PKT-BK');
  const backup = writePacket(dir, 'PKT-BK-BACKUP-2026-08-25-THING.json', 'PKT-BK',
    { filesAllowed: ['**/*'] });
  assert.strictEqual(fs.readdirSync(dir).sort()[0], path.basename(backup),
    'the backup must sort FIRST, or this proof is not reproducing the defect');
  assert.notStrictEqual(S.packetDigest(active), S.packetDigest(backup),
    'the two must differ, or which one was chosen could not be observed');

  const r = S.resolvePacket({ packetId: 'PKT-BK' }, { packetsDir: dir });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.path, active, 'a backup was resolved as the authority');
  assert.deepStrictEqual(r.backups, [backup], 'the backup must still be reported, not silently dropped');

  // End to end, through the resolver both times — the path the gate actually takes.
  const signed = S.sign(record({ packetId: 'PKT-BK' }), { packetsDir: dir });
  assert.strictEqual(signed.attestation.packetDigest, S.packetDigest(active));
  const v = S.verify(signed, { packetsDir: dir });
  assert.strictEqual(v.ok, true, `a valid review was refused: ${v.code} — ${v.reason}`);
});

test('RED: with NO active packet left, verification fails CLOSED and names the backup', () => {
  // Exactly what an in-place backup-then-replace leaves behind if the active
  // file is lost: the id still exists on disk, but only as a copy.
  const dir = packetDir();
  const active = writePacket(dir, 'PKT-GONE.json', 'PKT-GONE');
  const signed = S.sign(record({ packetId: 'PKT-GONE' }), { packetsDir: dir });
  assert.strictEqual(S.verify(signed, { packetsDir: dir }).ok, true, 'baseline must verify');

  fs.renameSync(active, path.join(dir, 'PKT-GONE-BACKUP-2026-08-25-THING.json'));
  const v = S.verify(signed, { packetsDir: dir });
  assert.strictEqual(v.ok, false, 'a backup must never stand in for the authority it copies');
  assert.strictEqual(v.code, 'ATTESTATION-PACKET-MISSING');
  assert.ok(/backup is a copy, not an authority/.test(v.reason),
    'the refusal must explain WHY nothing was found, or it reads as an empty directory');
});

test('RED: two ACTIVE packets for one packetId are REFUSED, never guessed', () => {
  const dir = packetDir();
  const first = writePacket(dir, 'PKT-AMB.json', 'PKT-AMB');
  const signed = S.sign(record({ packetId: 'PKT-AMB' }), { packetsDir: dir });
  assert.strictEqual(S.verify(signed, { packetsDir: dir }).ok, true, 'baseline must verify');

  writePacket(dir, 'PKT-AMB-second.json', 'PKT-AMB', { objective: 'a different objective' });
  const v = S.verify(signed, { packetsDir: dir });
  assert.strictEqual(v.ok, false, 'picking one of two authorities is a coin toss dressed as verification');
  assert.strictEqual(v.code, 'ATTESTATION-PACKET-AMBIGUOUS');
  assert.ok(/refused rather than guessed/.test(v.reason));
  assert.ok(/--packet/.test(v.reason), 'the refusal must name the way out');

  assert.throws(() => S.sign(record({ packetId: 'PKT-AMB' }), { packetsDir: dir }),
    /ATTESTATION-PACKET-AMBIGUOUS/,
    'signing against an unresolvable packet mints a record that can never verify the same way twice');
  assert.strictEqual(S.resolvePacketForRecord({ packetId: 'PKT-AMB' }, { packetsDir: dir }), null,
    'the back-compatible shape must return null on ambiguity, not the first match');
  assert.ok(fs.existsSync(first), 'nothing is deleted to resolve ambiguity');
});

test('an EXPLICIT packet path resolves what a directory scan cannot', () => {
  const dir = packetDir();
  const p1 = writePacket(dir, 'PKT-EXP.json', 'PKT-EXP');
  const p2 = writePacket(dir, 'PKT-EXP-second.json', 'PKT-EXP', { objective: 'other' });
  // Ambiguous by scan…
  assert.strictEqual(S.resolvePacket({ packetId: 'PKT-EXP' }, { packetsDir: dir }).ok, false);
  // …but a named authority is a decision the operator has already made.
  const signed = S.sign(record({ packetId: 'PKT-EXP' }), { packetPath: p1 });
  assert.strictEqual(S.verify(signed, { packetPath: p1 }).ok, true);
  const wrong = S.verify(signed, { packetPath: p2 });
  assert.strictEqual(wrong.ok, false, 'naming a DIFFERENT packet must not verify');
  assert.strictEqual(wrong.code, 'ATTESTATION-PACKET-CHANGED');
});

test('the CLI parser reads --packet as a flag, in any order', () => {
  assert.deepStrictEqual(S.parseCli(['--verify', 'r.json', '--packet', 'p.json']),
    { mode: 'verify', file: 'r.json', packet: 'p.json' });
  assert.deepStrictEqual(S.parseCli(['--packet', 'p.json', '--verify', 'r.json']),
    { mode: 'verify', file: 'r.json', packet: 'p.json' });
  assert.deepStrictEqual(S.parseCli(['--sign', 'r.json']),
    { mode: 'sign', file: 'r.json', packet: null });
  // A dropped flag looks exactly like a check that ran, so it is a usage error.
  assert.ok(S.parseCli(['--verify', 'r.json', '--pakcet', 'p.json']).error, 'a misspelled flag must not be ignored');
  assert.ok(S.parseCli(['--verify']).error, '--verify without a record must not be accepted');
  assert.ok(S.parseCli(['--packet']).error, '--packet without a path must not be accepted');
});

test('CLI: --verify <record> --packet <path> honours the named packet', () => {
  const dir = packetDir();
  const p1 = writePacket(dir, 'PKT-CLI.json', 'PKT-CLI');
  const p2 = writePacket(dir, 'PKT-CLI-other.json', 'PKT-CLI', { objective: 'other' });
  const recPath = path.join(dir, 'record.json');
  fs.writeFileSync(recPath, JSON.stringify(S.sign(record({ packetId: 'PKT-CLI' }), { packetPath: p1 }), null, 2));

  const SIGNCLI = path.join(BC, 'review-sign.cjs');
  const good = spawnSync('node', [SIGNCLI, '--verify', recPath, '--packet', p1], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(good.status, 0, `expected exit 0, got ${good.status}: ${good.stdout}${good.stderr}`);
  assert.ok(/VERIFIED/.test(good.stdout));

  const bad = spawnSync('node', [SIGNCLI, '--verify', recPath, '--packet', p2], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(bad.status, 3, 'a record verified against the wrong packet must exit 3');
  assert.ok(/ATTESTATION-PACKET-CHANGED/.test(bad.stdout + bad.stderr));

  // Without --packet the scan finds two active packets and refuses.
  const scan = spawnSync('node', [SIGNCLI, '--verify', recPath], { cwd: ROOT, encoding: 'utf8' });
  assert.notStrictEqual(scan.status, 0, 'an unresolvable packetId must not verify by scan');

  const usage = spawnSync('node', [SIGNCLI, '--verify', recPath, '--pakcet', p1], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(usage.status, 2, 'a misspelled flag is a usage error, not a silent pass');
});

test('PROOF: a record signed against the ACTIVE packet verifies, implicitly and explicitly', () => {
  // The live-fixture version of this proof pinned two real files by path:
  // reviews/groups/20260826010801-codex-G1.json and
  // packets/PKT-20260825-GOVERNANCE-TRUTH.json. Both are mutable — the packet
  // is a governance document that gets authorized updates, and each update
  // legitimately changes its digest. Binding a permanent test to that moving
  // target meant the test went red every time the packet was updated for a
  // reason that had nothing to do with backup resolution — the packet content
  // simply outran the record it was pinned to. That is a false failure, the
  // same category of harm as the false refusal this file exists to catch.
  //
  // What the defect actually depends on — a same-id BACKUP that sorts ahead of
  // the active file, an active file that resolves and verifies regardless, and
  // a named backup that fails closed — does not need a live file at all. This
  // proof builds that fixture from scratch: one canonical active packet, one
  // same-id backup with genuinely different content, and a record signed
  // against the active packet the same way the gate signs one.
  const dir = packetDir();
  const active = writePacket(dir, 'PKT-G1FIX.json', 'PKT-G1FIX');
  const backup = writePacket(dir, 'PKT-G1FIX-BACKUP-2026-08-25-FIXTURE.json', 'PKT-G1FIX',
    { filesAllowed: ['**/*'] });
  assert.strictEqual(fs.readdirSync(dir).sort()[0], path.basename(backup),
    'the backup must sort FIRST, or this proof is not reproducing the defect');
  assert.notStrictEqual(S.packetDigest(active), S.packetDigest(backup),
    'the active packet and its backup must differ, or which one was chosen could not be observed');

  const rec = S.sign(record({ reviewId: 'REV-g1-fixture', packetId: 'PKT-G1FIX' }), { packetsDir: dir });

  // The defect needs a same-id BACKUP present to reproduce.
  const r = S.resolvePacket(rec, { packetsDir: dir });
  assert.strictEqual(r.ok, true, `packet resolution refused: ${r.code} — ${r.reason}`);
  assert.deepStrictEqual(r.backups, [backup],
    'this proof is only meaningful while a same-id BACKUP sits beside the active packet — '
    + 'without one, the ordering bug it covers cannot occur');
  assert.strictEqual(r.path, active,
    `resolution picked ${r.path && path.basename(r.path)}; the authority is ${path.basename(active)}, never a backup`);

  // The scan path — what the gate actually calls — must reach VERIFIED.
  const scanned = S.verify(rec, { packetsDir: dir });
  assert.strictEqual(scanned.ok, true,
    `a record signed against the active packet was refused by directory scan: ${scanned.code} — ${scanned.reason}`);

  // And naming the authority explicitly must agree with it. If these two ever
  // disagreed, one of them is resolving to something other than the packet.
  const explicit = S.verify(rec, { packetPath: active });
  assert.strictEqual(explicit.ok, true,
    `the same record was refused against the named active packet: ${explicit.code} — ${explicit.reason}`);
  assert.strictEqual(scanned.packetDigest, explicit.packetDigest,
    'scan and explicit --packet resolved to different packet content');
});

test('PROOF: the same record is REFUSED against the stale BACKUP copy', () => {
  // The other half of the same fact. Passing above only means something if
  // digesting the backup would have produced a different answer — otherwise the
  // two files are identical and resolution order never mattered. Built from the
  // same fixture as the proof above, not a live file, for the reason stated there.
  const dir = packetDir();
  const active = writePacket(dir, 'PKT-G1BAD.json', 'PKT-G1BAD');
  const backup = writePacket(dir, 'PKT-G1BAD-BACKUP-2026-08-25-FIXTURE.json', 'PKT-G1BAD',
    { filesAllowed: ['**/*'] });
  assert.strictEqual(S.isBackupPacketName(backup), true, 'the backup must be recognised by name');
  assert.notStrictEqual(S.packetDigest(active), S.packetDigest(backup),
    'the backup must genuinely differ from the active packet, or this proof shows nothing');

  const rec = S.sign(record({ reviewId: 'REV-g1-fixture-bad', packetId: 'PKT-G1BAD' }), { packetPath: active });
  const v = S.verify(rec, { packetPath: backup });
  assert.strictEqual(v.ok, false,
    'the backup digests identically to the active packet, so this proof shows nothing — '
    + 'the ordering defect would have been invisible either way');
  assert.strictEqual(v.code, 'ATTESTATION-PACKET-BACKUP');
});

const failed = process.exitCode ? 'at least 1' : '0';

console.log(`${passed} passed, ${failed} failed.`);
