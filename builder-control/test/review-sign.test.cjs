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
  assert.strictEqual(v.code, 'ATTESTATION-PACKET-CHANGED');
});

const failed = process.exitCode ? 'at least 1' : '0';

console.log(`${passed} passed, ${failed} failed.`);
