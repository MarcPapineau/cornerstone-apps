#!/usr/bin/env node
/**
 * engineering-os.test.cjs — proves each Engineering-OS rule actually fires.
 *
 * These are the fixtures that keep the gate honest. A validator that silently
 * stops validating produces no error, passes every build, and looks exactly
 * like a healthy one — so the only way to know a rule still works is to feed it
 * something that MUST be refused and check that it was.
 *
 * Every case asserts an exact exit code, and the blocking cases also assert the
 * named rule, so a block that starts firing for the wrong reason is a failure
 * here rather than a mystery in CI.
 *
 * Run: node builder-control/test/engineering-os.test.cjs
 * Exit 0 = all cases passed; 1 = at least one failed.
 */
'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'builder-control', 'engineering-os.cjs');
const REAL_PACKET = path.join(ROOT, 'builder-control', 'packets', 'ENGINEERING-OS-V1.json');

let pass = 0;
let fail = 0;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'engos-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

// Two runners, and the difference between them is the point.
//
// `runProd()` is what CI, the adapters and a human at a terminal actually get:
// no synthetic-subject flag, no synthetic-subject environment variable. The
// negative proofs for finding #1 use this one, because a proof that the gate
// refuses caller-declared changes is worthless if the harness quietly holds the
// door open for it.
//
// `run()` is the fixture runner. Most cases here feed the classifier paths that
// exist in no working tree (`builder-control/test-fixtures/auth/session.ts`, `a.md`…), which is exactly
// what the test-only boundary is for. It opens that boundary — both halves of
// it — ONLY for invocations that actually carry synthetic input, so a case that
// passes neither --changed nor --diff-lines is still exercising the production
// path rather than a permissive variant of it.
function runProd(args, env = {}) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '', ...env },
  });
  return { exit: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function run(args) {
  const synthetic = args.includes('--changed') || args.includes('--diff-lines');
  if (!synthetic) return runProd(args);
  return runProd([...args, '--test-only-synthetic-subject'], { ENGOS_TEST_ONLY_SYNTHETIC: '1' });
}

// Assert against a result that has ALREADY been run. The finding-#1 proofs need
// to choose their own runner and environment, which `expect` cannot express
// because it builds the invocation itself.
function expect_raw(name, r, { exit, contains, notContains }) {
  const okExit = r.exit === exit;
  const okHas = contains ? [].concat(contains).every((c) => r.out.includes(c)) : true;
  const okNot = notContains ? ![].concat(notContains).some((c) => r.out.includes(c)) : true;
  if (okExit && okHas && okNot) {
    pass++;
    console.log(`  ok   ${name}  (exit ${r.exit})`);
  } else {
    fail++;
    console.error(`  FAIL ${name}`);
    console.error(`       expected exit=${exit}${contains ? `, containing ${JSON.stringify([].concat(contains))}` : ''}`);
    console.error(`       got exit=${r.exit}`);
    console.error(r.out.split('\n').map((l) => '         ' + l).join('\n'));
  }
}

function expect(name, args, { exit, contains, notContains }) {
  const r = run(args);
  const okExit = r.exit === exit;
  const okHas = contains ? [].concat(contains).every((c) => r.out.includes(c)) : true;
  const okNot = notContains ? ![].concat(notContains).some((c) => r.out.includes(c)) : true;
  if (okExit && okHas && okNot) {
    pass++;
    console.log(`  ok   ${name}  (exit ${r.exit})`);
  } else {
    fail++;
    console.error(`  FAIL ${name}`);
    console.error(`       expected exit=${exit}${contains ? `, containing ${JSON.stringify([].concat(contains))}` : ''}`);
    console.error(`       got exit=${r.exit}`);
    console.error(r.out.split('\n').map((l) => '         ' + l).join('\n'));
  }
}

// Review fixtures are SIGNED before being written, because that is what a real
// adapter produces. The gate now refuses unsigned records (correction cycle 2,
// finding #1), so an unsigned fixture would only ever prove that the refusal
// works — which is proved deliberately and separately below. Non-review objects
// (packets) are written as-is.
const SIGNER = require(path.join(ROOT, 'builder-control', 'review-sign.cjs'));

// The gate now checks changed paths against the packet's filesAllowed
// (correction cycle 2, finding #3). The real packet authorizes builder-control
// paths, not the synthetic src/*.ts fixtures used here, so these cases get their
// own packet that authorizes exactly what they touch. Records are signed against
// the SAME packet they are gated with, because the attestation covers the
// packet's authorization digest.
const FIXTURE_PACKET = path.join(TMP, 'fixture-packet.json');
(function makeFixturePacket() {
  const base = JSON.parse(fs.readFileSync(REAL_PACKET, 'utf8'));
  // A DISTINCT packetId, so resolvePacketForRecord() cannot accidentally match
  // the real packet in packets/ and compare the wrong authorization digest.
  base.packetId = 'PKT-20260824-ENGOS-TEST-FIXTURE';
  // Keep the fixture inside the builder's canonical registry scope. Synthetic
  // source paths used to be authorized with globs in allowsProtectedPaths;
  // the production validator now correctly permits only exact, canonically
  // protected overrides, so that old fixture shape was no longer executable.
  const fixturePaths = ['builder-control/**', 'research/**'];
  base.filesAllowed = fixturePaths;
  // filesAllowed outside the agent's allowedPathGlobs must be covered by
  // authorization.allowsProtectedPaths, or packet-tools rejects the packet —
  // which is the registry check doing its job on a synthetic fixture.
  base.authorization = { ...base.authorization };
  fs.writeFileSync(FIXTURE_PACKET, JSON.stringify(base, null, 2));
})();
const WRONG_PACKET = path.join(TMP, 'wrong-packet.json');
(function makeWrongPacket() {
  const packet = JSON.parse(fs.readFileSync(FIXTURE_PACKET, 'utf8'));
  packet.packetId = 'PKT-SOMETHING-ELSE';
  fs.writeFileSync(WRONG_PACKET, JSON.stringify(packet, null, 2));
})();
function writeJSON(name, obj, packetPath = FIXTURE_PACKET) {
  const p = path.join(TMP, name);
  const isReview = obj && obj.reviewId && obj.reviewOf && obj.disposition;
  const body = isReview ? SIGNER.sign(obj, { packetPath }) : obj;
  fs.writeFileSync(p, JSON.stringify(body, null, 2));
  return p;
}

// Write a review fixture WITHOUT an attestation, for the cases that must prove
// the refusal fires.
function writeUnsigned(name, obj) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function writeLegacyV1(name, rec, packetPath = FIXTURE_PACKET) {
  // V1 is verification-only in production. This fixture reconstructs its
  // historical bytes to prove the audit remains readable while the gate refuses
  // to consume fields that V1 never authenticated.
  SIGNER.sign(rec, { packetPath }); // ensure the local fixture key exists
  const key = process.env.AEGIS_ATTESTATION_KEY
    || fs.readFileSync(path.join(ROOT, 'builder-control', '.attestation-key'), 'utf8').trim();
  const packetDigest = SIGNER.packetDigest(packetPath, 'aegis-attest-v1');
  const payload = canonical({
    v: 'aegis-attest-v1', reviewId: rec.reviewId, supersedes: rec.supersedes || null,
    aggregate: rec.aggregate ? {
      groupCount: rec.aggregate.groupCount,
      plannedGroupCount: rec.aggregate.plannedGroupCount,
      coverage: rec.aggregate.coverage,
      groups: (rec.aggregate.groups || []).map((group) => ({
        groupId: group.groupId, groupDigest: group.groupDigest,
        pathCount: group.pathCount, disposition: group.disposition,
        reviewId: group.reviewId, attestationDigest: group.attestationDigest,
      })),
    } : null,
    ts: rec.ts, unavailableReason: rec.unavailableReason || null,
    group: rec.group ? { groupId: rec.group.groupId, groupDigest: rec.group.groupDigest || null } : null,
    subjectSha256: rec.reviewOf && rec.reviewOf.diffSha256,
    changedPaths: (rec.reviewOf && rec.reviewOf.changedPaths) || [],
    packetId: rec.packetId, packetDigest, reviewer: rec.reviewer,
    reviewerModel: rec.reviewerModel, disposition: rec.disposition,
    findings: (rec.findings || []).map((finding) => ({
      severity: finding.severity, file: finding.file, problem: finding.problem,
      evidence: finding.evidence, status: finding.status,
    })),
  });
  return writeUnsigned(name, {
    ...rec,
    attestation: {
      v: 'aegis-attest-v1', alg: 'HMAC-SHA256', packetDigest,
      payloadDigest: crypto.createHash('sha256').update(payload).digest('hex'),
      mac: crypto.createHmac('sha256', key).update(payload).digest('hex'),
    },
  });
}

const realPacket = JSON.parse(fs.readFileSync(REAL_PACKET, 'utf8'));
const PACKET_ID = 'PKT-20260824-ENGOS-TEST-FIXTURE';

// A review record that is valid in every respect, used as the base for the
// negative cases so each one differs from a passing record in exactly one way.
// The fixture paths below do not exist in the repository, so their subject
// diff is intentionally empty. Bind the records to the hash the real subject
// calculator produces instead of a made-up digest.
const SHA_A = crypto.createHash('sha256').update('').digest('hex');
const SHA_B = 'b'.repeat(64);
function reviewOf(changedPath = 'builder-control/test-fixtures/app.ts', diffSha256 = SHA_A) {
  return {
    diffSha256,
    baseRef: 'main',
    headRef: 'HEAD',
    changedPaths: [changedPath],
  };
}
function review(over = {}) {
  return {
    reviewId: 'REV-test-001',
    ts: '2026-08-23T04:00:00Z',
    reviewer: 'codex',
    reviewerModel: 'codex-cli-test-fixture',
    packetId: PACKET_ID,
    reviewOf: reviewOf(),
    disposition: 'APPROVE',
    findings: [],
    ...over,
  };
}

console.log('Engineering OS — rule fixtures\n');

// ── classification ──────────────────────────────────────────────────────────
console.log('CLASSIFICATION');

(function proveUntrackedSubjectFailsClosed() {
  const repo = fs.mkdtempSync(path.join(TMP, 'untracked-subject-'));
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'aegis-test@example.invalid']);
  git(['config', 'user.name', 'AEGIS Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'tracked\n');
  git(['add', 'README.md']);
  git(['commit', '--quiet', '-m', 'fixture']);
  const baseCommit = git(['rev-parse', 'HEAD']).stdout.trim();
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'untracked.cjs'), 'module.exports = 1;\n');
  const refused = spawnSync(process.execPath, [CLI, '--subject', '--json'], {
    cwd: repo, encoding: 'utf8', env: {
      ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '',
      GIT_DIR: path.join(repo, '.git'), GIT_WORK_TREE: repo,
    },
  });
  expect_raw('repository-relevant untracked source is refused before subject certification', {
    exit: refused.status, out: (refused.stdout || '') + (refused.stderr || ''),
  }, { exit: 3, contains: 'repository-relevant untracked file' });

  const packetDir = path.join(repo, 'builder-control', 'packets');
  fs.mkdirSync(packetDir, { recursive: true });
  const packetPath = path.join(packetDir, 'packet.json');
  fs.writeFileSync(packetPath, JSON.stringify({ filesAllowed: ['src/untracked.cjs'] }));
  const authorized = spawnSync(process.execPath,
    [CLI, '--subject', '--packet', packetPath, '--json'], {
      cwd: repo, encoding: 'utf8', env: {
        ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '',
        GIT_DIR: path.join(repo, '.git'), GIT_WORK_TREE: repo,
      },
    });
  let authorizedSubject = null;
  try { authorizedSubject = JSON.parse(authorized.stdout); } catch {}
  expect_raw('packet-authorized exact untracked new leaf enters the canonical subject with its bytes', {
    exit: authorized.status,
    out: authorizedSubject && authorizedSubject.subjectPaths.includes('src/untracked.cjs') &&
      authorizedSubject.diffBytes > 0 ? 'AUTHORIZED_UNTRACKED_BOUND' :
      (authorized.stdout || '') + (authorized.stderr || ''),
  }, { exit: 0, contains: 'AUTHORIZED_UNTRACKED_BOUND' });

  const firstHash = authorizedSubject && authorizedSubject.subjectSha256;
  fs.writeFileSync(path.join(repo, 'src', 'untracked.cjs'), 'module.exports = 2;\n');
  const moved = spawnSync(process.execPath,
    [CLI, '--subject', '--packet', packetPath, '--json'], {
      cwd: repo, encoding: 'utf8', env: {
        ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '',
        GIT_DIR: path.join(repo, '.git'), GIT_WORK_TREE: repo,
      },
    });
  let movedSubject = null;
  try { movedSubject = JSON.parse(moved.stdout); } catch {}
  expect_raw('changing an authorized untracked new leaf changes the canonical subject hash', {
    exit: moved.status,
    out: movedSubject && movedSubject.subjectSha256 !== firstHash ? 'UNTRACKED_HASH_MOVED' :
      (moved.stdout || '') + (moved.stderr || ''),
  }, { exit: 0, contains: 'UNTRACKED_HASH_MOVED' });

  git(['add', 'src/untracked.cjs']);
  git(['commit', '--quiet', '-m', 'checkpoint new leaf']);
  const committed = spawnSync(process.execPath,
    [CLI, '--subject', '--packet', packetPath, '--base', baseCommit, '--head', 'HEAD', '--json'], {
      cwd: repo, encoding: 'utf8', env: {
        ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '',
        GIT_DIR: path.join(repo, '.git'), GIT_WORK_TREE: repo,
      },
    });
  let committedSubject = null;
  try { committedSubject = JSON.parse(committed.stdout); } catch {}
  expect_raw('authorized new-leaf subject encoding is identical before and after commit', {
    exit: committed.status,
    out: committedSubject && movedSubject
      && committedSubject.subjectSha256 === movedSubject.subjectSha256
      && committedSubject.diffBytes === movedSubject.diffBytes ? 'NEW_LEAF_CHECKPOINT_STABLE'
      : (committed.stdout || '') + (committed.stderr || ''),
  }, { exit: 0, contains: 'NEW_LEAF_CHECKPOINT_STABLE' });

  git(['rm', '--quiet', 'src/untracked.cjs']);
  git(['commit', '--quiet', '-m', 'remove fixture leaf']);
  const evidenceDir = path.join(repo, 'builder-control', 're' + 'views');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidenceFile = path.join(evidenceDir, 'evidence.json');
  fs.writeFileSync(evidenceFile, '{}\n');
  const evidenceOnly = spawnSync(process.execPath, [CLI, '--subject', '--json'], {
    cwd: repo, encoding: 'utf8', env: {
      ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '',
      GIT_DIR: path.join(repo, '.git'), GIT_WORK_TREE: repo,
    },
  });
  expect_raw('untracked review evidence remains excluded without hiding source code', {
    exit: evidenceOnly.status, out: (evidenceOnly.stdout || '') + (evidenceOnly.stderr || ''),
  }, { exit: 0, contains: '"subjectPaths": []' });
})();

expect('docs-only small change is LIGHT',
  ['--classify', '--changed', 'docs/guide.md', '--diff-lines', '20'],
  { exit: 0, contains: 'lane      : LIGHT' });

expect('auth path forces FULL + grok',
  ['--classify', '--changed', 'builder-control/test-fixtures/auth/session.ts'],
  { exit: 0, contains: ['lane      : FULL', 'codex + grok', 'authentication/authorization surface'] });

expect('payment path forces FULL + grok',
  ['--classify', '--changed', 'server/billing/charge.js'],
  { exit: 0, contains: ['FULL', 'payment path'] });

expect('migration forces FULL + grok',
  ['--classify', '--changed', 'db/migrations/003_add_users.sql'],
  { exit: 0, contains: ['FULL', 'database schema or migration'] });

expect('protected path forces FULL',
  ['--classify', '--changed', 'packages/protocol-core/data/catalog.json'],
  { exit: 0, contains: ['FULL', 'protected path'] });

expect('editing the CI workflow is high-risk (it is the gate itself)',
  ['--classify', '--changed', '.github/workflows/builder-control.yml'],
  { exit: 0, contains: ['FULL', 'CI enforcement'] });

expect('EMPTY change list refuses to certify trivial',
  ['--classify', '--changed', 'builder-control/reviews/evidence-only.json'],
  { exit: 0, contains: ['FULL', 'refusing to certify an unknown change as trivial'] });

expect('too many files breaks the light lane',
  ['--classify', '--changed', 'a.md', '--changed', 'b.md', '--changed', 'c.md',
   '--changed', 'd.md', '--changed', 'e.md', '--changed', 'f.md'],
  { exit: 0, contains: ['FULL', 'exceeds the light-lane cap'] });

expect('a huge docs change is not a trivial change',
  ['--classify', '--changed', 'docs/guide.md', '--diff-lines', '900'],
  { exit: 0, contains: ['FULL', '900 changed lines exceeds'] });

expect('code file is not on the light allow-list',
  ['--classify', '--changed', 'research/utils/format.ts', '--diff-lines', '3'],
  { exit: 0, contains: ['FULL', 'not on the light-lane allow-list'] });

// ── spec pin ────────────────────────────────────────────────────────────────
console.log('\nSPEC PIN');
expect('real packet pins every source',
  ['--spec-check', '--packet', 'builder-control/packets/ENGINEERING-OS-V1.json'],
  { exit: 0, contains: 'SPEC PIN PASS' });

const unpinned = writeJSON('unpinned.json', { ...realPacket, sourceOfTruth: ['https://notion.so/some-live-page'] });
expect('a live Notion URL with no version is UNRESOLVED and blocks',
  ['--spec-check', '--packet', unpinned],
  { exit: 3, contains: ['UNRESOLVED', 'SPEC PIN BLOCK'] });

const marked = writeJSON('marked.json', { ...realPacket, sourceOfTruth: ['UNVERIFIED: https://notion.so/some-live-page'] });
expect('the same source marked UNVERIFIED is allowed and reported',
  ['--spec-check', '--packet', marked],
  { exit: 0, contains: ['UNVERIFIED', 'does not', 'SPEC PIN PASS'] });

const pinnedExt = writeJSON('pinned-ext.json', { ...realPacket, sourceOfTruth: ['https://notion.so/page@v7'] });
expect('an external source with @version is accepted as pinned',
  ['--spec-check', '--packet', pinnedExt],
  { exit: 0, contains: 'PINNED-EXTERNAL' });

// ── review record validation ────────────────────────────────────────────────
console.log('\nREVIEW RECORDS');
expect('a well-formed record validates',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('good.json', review())],
  { exit: 0, contains: 'All 1 record(s) valid' });

expect('a historically valid V1 attestation remains auditable but cannot satisfy the current gate',
  ['--validate-review', '--packet', FIXTURE_PACKET,
    writeLegacyV1('legacy-v1.json', review({ reviewId: 'REV-legacy-v1' }))],
  { exit: 2, contains: ['ATTESTATION-LEGACY-NON-GATEABLE', 'cannot satisfy the current gate'] });

(function aggregateGroupAuthorityIsEndToEnd() {
  const root = path.join(TMP, 'aggregate-gate-authority');
  const groupsDir = path.join(root, 'groups');
  fs.mkdirSync(groupsDir, { recursive: true });
  const writeSigned = (target, value) => {
    const signed = SIGNER.sign(value, { packetPath: FIXTURE_PACKET });
    fs.writeFileSync(target, JSON.stringify(signed, null, 2));
    return signed;
  };
  const groupPath = path.join(groupsDir, 'aggregate-codex-g1-G1.json');
  const group = writeSigned(groupPath, review({
    reviewId: 'REV-aggregate-codex-g1',
    group: { groupId: 'G1', groupDigest: 'digest-g1' },
  }));
  const aggregatePath = path.join(root, 'codex-aggregate.json');
  writeSigned(aggregatePath, review({
    reviewId: 'REV-aggregate-codex',
    aggregate: {
      groupCount: 1, plannedGroupCount: 1, coverage: 'EXACT', problems: [],
      groups: [{
        groupId: 'G1', groupDigest: 'digest-g1', pathCount: 1,
        disposition: 'APPROVE', reviewId: group.reviewId,
        attestationDigest: group.attestation.payloadDigest,
      }],
    },
  }));
  const grokPath = path.join(root, 'grok.json');
  writeSigned(grokPath, review({
    reviewId: 'REV-aggregate-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
  }));
  const gateArgs = ['--gate-done', '--packet', FIXTURE_PACKET,
    '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
    '--review', aggregatePath, '--review', grokPath];

  expect('a V2 aggregate resolves its active sibling groups directory through the real gate',
    gateArgs, { exit: 0, contains: 'RESULT: READY_FOR_DETERMINISTIC_VALIDATION' });

  fs.unlinkSync(groupPath);
  expect('the real gate refuses a V2 aggregate whose active group record is missing',
    gateArgs, { exit: 3, contains: 'ATTESTATION-AGGREGATE-GROUP-MISSING' });

  writeSigned(groupPath, review({
    reviewId: group.reviewId, reviewerModel: 'substituted-model',
    group: { groupId: 'G1', groupDigest: 'digest-g1' },
  }));
  expect('the real gate refuses a signed substitute for an aggregate group',
    gateArgs, { exit: 3, contains: 'ATTESTATION-AGGREGATE-GROUP-MISMATCH' });
})();

expect('UNAVAILABLE with no reason is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('unavail-noreason.json', review({ disposition: 'UNAVAILABLE' }))],
  { exit: 2, contains: 'requires unavailableReason' });

expect('UNAVAILABLE carrying findings is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('unavail-findings.json', review({
    disposition: 'UNAVAILABLE',
    unavailableReason: 'no credential',
    findings: [{ severity: 'HIGH', problem: 'x', evidence: 'y', status: 'OPEN' }],
  }))],
  { exit: 2, contains: 'cannot carry findings' });

expect('UNAVAILABLE with a reason may truthfully report zero verified changed paths',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('unavail-zero-coverage.json', review({
    disposition: 'UNAVAILABLE',
    unavailableReason: 'review transport failed before any path was inspected',
    reviewOf: { diffSha256: SHA_A, changedPaths: [] },
  }))],
  { exit: 0, contains: 'All 1 record(s) valid' });

expect('a finding with no evidence is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('no-evidence.json', review({
    findings: [{ severity: 'HIGH', problem: 'looks wrong', status: 'OPEN' }],
  }))],
  { exit: 2, contains: 'missing required property "evidence"' });

expect('FALSE_POSITIVE without a builder response is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('fp.json', review({
    findings: [{ severity: 'FALSE_POSITIVE', problem: 'x', evidence: 'y', status: 'DISPUTED' }],
  }))],
  { exit: 2, contains: 'requires builderResponse' });

expect('ACCEPTED_RISK without a named human is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('risk.json', review({
    findings: [{ severity: 'HIGH', problem: 'x', evidence: 'y', status: 'ACCEPTED_RISK' }],
  }))],
  { exit: 2, contains: 'requires acceptedBy' });

expect('an unknown reviewer is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('who.json', review({ reviewer: 'gemini' }))],
  { exit: 2, contains: 'is not one of' });

// ── definition of done ──────────────────────────────────────────────────────
console.log('\nDEFINITION OF DONE');
expect('FULL lane with no reviews at all is BLOCKED',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A],
  { exit: 3, contains: ['RESULT: BLOCKED', 'ENGOS-REVIEW-MISSING'] });

expect('codex AND grok approval clears an ordinary (non-high-risk) FULL change',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'research/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('ok-codex.json', review({ reviewOf: reviewOf('research/app.ts') })),
   '--review', writeJSON('ok-grok.json', review({ reviewId: 'REV-test-001-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture', reviewOf: reviewOf('research/app.ts') }))],
  { exit: 0, contains: 'RESULT: READY_FOR_DETERMINISTIC_VALIDATION' });

expect('codex approval ALONE does not clear an ordinary FULL change — grok is required too',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'research/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('ok-codex-alone.json', review({ reviewId: 'REV-test-001-alone', reviewOf: reviewOf('research/app.ts') }))],
  { exit: 3, contains: ['ENGOS-REVIEW-MISSING', 'grok'], notContains: 'READY_FOR' });

expect('a review of a DIFFERENT diff does not transfer',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('stale.json', review({ reviewOf: reviewOf('builder-control/test-fixtures/app.ts', SHA_B) }))],
  { exit: 3, contains: ['different subject were IGNORED', 'ENGOS-REVIEW-MISSING'] });

expect('high-risk needs grok too — codex alone is not enough',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/auth/login.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('codex-only.json', review({ reviewOf: reviewOf('builder-control/test-fixtures/auth/login.ts') }))],
  { exit: 3, contains: ['ENGOS-REVIEW-MISSING', 'grok'] });

expect('FULL-lane start recipe prints Grok named approval and positive telemetry ceiling',
  ['--start', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-lines', '12'],
  { exit: 0, contains: [
    '--reviewer grok', '--allow-metered', '--approved-by "Marc Papineau"', '--cap-usd 5',
  ] });

expect('claude-self approval never satisfies a required slot',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('self.json', review({ reviewId: 'REV-self-1', reviewer: 'claude-self' }))],
  { exit: 3, contains: ['ENGOS-REVIEW-MISSING', 'codex'] });

expect('a reviewer that could not run BLOCKS and is reported as UNAVAILABLE',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('unavail.json', review({
     disposition: 'UNAVAILABLE', unavailableReason: 'codex CLI not installed on this runner',
   }))],
  { exit: 3, contains: ['ENGOS-REVIEWER-UNAVAILABLE', 'codex CLI not installed'], notContains: 'RESULT: DONE' });

expect('a REJECT label with only MEDIUM findings is recorded but does not override the severity gate',
  ['--gate-done', '--json', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('medium-only-reject.json', review({
     disposition: 'REJECT',
     findings: [{
       severity: 'MEDIUM', file: 'builder-control/test-fixtures/app.ts', location: '12',
       problem: 'an advisory maintainability concern',
       evidence: 'builder-control/test-fixtures/app.ts:12 contains the reviewed pattern',
       status: 'OPEN',
     }],
   })),
   '--review', writeJSON('medium-only-grok.json', review({
     reviewId: 'REV-medium-only-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
   }))],
  { exit: 0, contains: ['"allRequiredApproved": false', '"disposition": "REJECT"', 'REJECT label recorded as nonblocking'],
    notContains: ['ENGOS-REVIEW-REJECTED', 'ENGOS-OPEN-BLOCKING-FINDING'] });

expect('a bare completed REJECT is preserved but has no authority beyond its empty finding set',
  ['--gate-done', '--json', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('bare-reject.json', review({
     reviewId: 'REV-bare-reject', disposition: 'REJECT', findings: [],
   })),
   '--review', writeJSON('bare-reject-grok.json', review({
     reviewId: 'REV-bare-reject-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
   }))],
  { exit: 0, contains: ['"allRequiredApproved": false', '"disposition": "REJECT"', 'REJECT label recorded as nonblocking'],
    notContains: ['ENGOS-REVIEW-REJECTED', 'ENGOS-OPEN-BLOCKING-FINDING'] });

expect('a REJECT label with an OPEN HIGH finding still blocks',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('high-reject.json', review({
     disposition: 'REJECT',
     findings: [{
       severity: 'HIGH', file: 'builder-control/test-fixtures/app.ts', location: '20',
       problem: 'the application can bypass authorization',
       evidence: 'builder-control/test-fixtures/app.ts:20 returns before the authorization check',
       impact: 'an unauthorized request can reach the protected operation',
       requiredCorrection: 'perform authorization before returning',
       verificationMethod: 'run the authorization rejection test',
       status: 'OPEN',
     }],
   }))],
  { exit: 3, contains: ['ENGOS-REVIEW-REJECTED', 'ENGOS-OPEN-BLOCKING-FINDING'] });

expect('an OPEN HIGH finding from the ADVISORY reviewer still blocks',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('codex-ok2.json', review()),
   '--review', writeJSON('copilot-bad.json', review({
     reviewId: 'REV-copilot-1', reviewer: 'copilot', disposition: 'REJECT',
     reviewerModel: 'github-copilot-test-fixture',
     findings: [{
       severity: 'HIGH',
       problem: 'import of a deleted module',
       evidence: 'builder-control/test-fixtures/app.ts:12 imports ./gone',
       impact: 'The application cannot load the deleted dependency.',
       requiredCorrection: 'Restore the dependency or remove the import.',
       verificationMethod: 'Run the application build and import test.',
       status: 'OPEN',
     }],
   }))],
  { exit: 3, contains: ['ENGOS-OPEN-BLOCKING-FINDING', 'import of a deleted module'] });

expect('an unrelated approval cannot clear a FIXED finding',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('fixed.json', review({
     findings: [{
       severity: 'HIGH',
       problem: 'stale import',
       evidence: 'builder-control/test-fixtures/app.ts:12 imported ./gone',
       impact: 'The application could not load.',
       requiredCorrection: 'Remove the stale import.',
       verificationMethod: 'Run the import test.',
       status: 'FIXED',
       verifiedByReviewId: 'REV-human-verify-001',
     }],
   })),
   '--review', writeJSON('fixed-verifier.json', review({
     reviewId: 'REV-human-verify-001',
     reviewer: 'human',
     reviewerModel: 'Marc Papineau',
   })),
   '--review', writeJSON('fixed-grok.json', review({ reviewId: 'REV-fixed-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture' }))],
  { exit: 3, contains: 'ENGOS-FIX-VERIFICATION-LINK-MISSING' });

expect('a FIXED finding clears only with signed finding-level re-verification evidence',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('fixed-linked.json', review({
     reviewId: 'REV-fixed-source-002',
     findings: [{
       severity: 'HIGH',
       problem: 'stale import',
       evidence: 'builder-control/test-fixtures/app.ts:12 imported ./gone',
       impact: 'The application could not load.',
       requiredCorrection: 'Remove the stale import.',
       verificationMethod: 'Run the import test.',
       status: 'FIXED',
       verifiedByReviewId: 'REV-human-verify-002',
     }],
   })),
   '--review', writeJSON('fixed-linked-verifier.json', review({
     reviewId: 'REV-human-verify-002',
     reviewer: 'human',
     reviewerModel: 'Marc Papineau',
     reverifiedFindings: [{
       sourceReviewId: 'REV-fixed-source-002',
       findingIndex: 0,
       verificationMethod: 'Run the import test.',
       evidence: 'Independent import test exited 0 and loaded the corrected module.',
       outcome: 'PASS',
     }],
   })),
   '--review', writeJSON('fixed-linked-grok.json', review({ reviewId: 'REV-fixed-linked-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture' }))],
  { exit: 0, contains: 'RESULT: READY_FOR_DETERMINISTIC_VALIDATION' });

expect('a FIXED finding cannot cite its own review as independent re-verification',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('fixed-self-linked.json', review({
     reviewId: 'REV-fixed-self-linked',
     findings: [{
       severity: 'HIGH',
       problem: 'stale import',
       evidence: 'builder-control/test-fixtures/app.ts:12 imported ./gone',
       impact: 'The application could not load.',
       requiredCorrection: 'Remove the stale import.',
       verificationMethod: 'Run the import test.',
       status: 'FIXED',
       verifiedByReviewId: 'REV-fixed-self-linked',
     }],
     reverifiedFindings: [{
       sourceReviewId: 'REV-fixed-self-linked', findingIndex: 0,
       verificationMethod: 'Run the import test.',
       evidence: 'The same record claims it checked itself.', outcome: 'PASS',
     }],
   })),
   '--review', writeJSON('fixed-self-linked-grok.json', review({
     reviewId: 'REV-fixed-self-linked-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
   }))],
  { exit: 3, contains: 'ENGOS-FIX-SELF-VERIFIED' });

expect('a FIXED finding cannot cite a second record from the same reviewer',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('fixed-same-reviewer-source.json', review({
     reviewId: 'REV-fixed-same-reviewer-source',
     findings: [{
       severity: 'HIGH',
       problem: 'stale import',
       evidence: 'builder-control/test-fixtures/app.ts:12 imported ./gone',
       impact: 'The application could not load.',
       requiredCorrection: 'Remove the stale import.',
       verificationMethod: 'Run the import test.',
       status: 'FIXED',
       verifiedByReviewId: 'REV-fixed-same-reviewer-verifier',
     }],
   })),
   '--review', writeJSON('fixed-same-reviewer-verifier.json', review({
     reviewId: 'REV-fixed-same-reviewer-verifier',
     reverifiedFindings: [{
       sourceReviewId: 'REV-fixed-same-reviewer-source', findingIndex: 0,
       verificationMethod: 'Run the import test.',
       evidence: 'The same reviewer claims a second pass.', outcome: 'PASS',
     }],
   })),
   '--review', writeJSON('fixed-same-reviewer-grok.json', review({
     reviewId: 'REV-fixed-same-reviewer-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
   }))],
  { exit: 3, contains: 'ENGOS-FIX-SELF-VERIFIED' });

expect('a review bound to another packet is rejected',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('wrongpacket.json', review({ packetId: 'PKT-SOMETHING-ELSE' }), WRONG_PACKET)],
  { exit: 3, contains: ['ENGOS-REVIEW-MALFORMED', 'ATTESTATION-PACKET-MISMATCH'] });

expect('LIGHT lane needs no AI reviewer at all',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'research/notes.md', '--diff-lines', '10', '--diff-sha', SHA_A],
  { exit: 0, contains: 'RESULT: READY_FOR_DETERMINISTIC_VALIDATION' });

expect('unverified items are surfaced, not dropped',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('withunver.json', review({ unverified: ['no browser available to test the modal'] })),
   '--review', writeJSON('withunver-grok.json', review({ reviewId: 'REV-withunver-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture' }))],
  { exit: 0, contains: ['UNVERIFIED', 'no browser available to test the modal'] });

// ── no bypass ───────────────────────────────────────────────────────────────
console.log('\nNO BYPASS');
expect('--force is not a thing here',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'builder-control/test-fixtures/auth/x.ts', '--diff-sha', SHA_A, '--force'],
  { exit: 3, notContains: 'RESULT: DONE' });

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION PASS 1 — RED PROOFS
// Each of these asserts that something MUST be refused. A happy-path suite
// cannot tell a working gate from a gate that says yes to everything; only a
// case that has to fail can.
// ════════════════════════════════════════════════════════════════════════════

const PKT = FIXTURE_PACKET;

console.log('\nRED PROOF — SUBJECT BINDING IS MANDATORY');

expect('FULL lane with NO --subject-sha blocks on the binding itself',
  ['--gate-done', '--packet', PKT, '--changed', 'builder-control/test-fixtures/app.ts'],
  { exit: 3, contains: ['ENGOS-NO-SUBJECT-BINDING', 'certifies nothing'], notContains: 'READY_FOR' });

expect('a --subject-sha that is not a digest blocks',
  ['--gate-done', '--packet', PKT, '--changed', 'builder-control/test-fixtures/app.ts', '--subject-sha', 'not-a-hash'],
  { exit: 3, contains: 'ENGOS-NO-SUBJECT-BINDING' });

expect('a WRONG --subject-sha blocks even with a valid approval present',
  ['--gate-done', '--packet', PKT, '--changed', 'builder-control/test-fixtures/app.ts',
   '--subject-sha', 'f'.repeat(64),
   '--review', writeJSON('rp-wrong-hash.json', review({ reviewId: 'REV-rp-wronghash' }))],
  { exit: 3, contains: ['ENGOS-SUBJECT-MISMATCH'], notContains: 'READY_FOR' });

console.log('\nRED PROOF — EVIDENCE IS NOT PART OF ITS OWN SUBJECT');

// Writing a review record must leave the subject hash untouched. If it did not,
// every record would invalidate itself the instant it was written and no set of
// reviews could ever satisfy the gate.
(function subjectHashStableUnderEvidence() {
  // STRUCTURAL FIX (2026-08-25): this used to WRITE an unsigned probe record into
  // the canonical builder-control/reviews/ directory and delete it afterwards.
  // On the happy path that worked. On any interruption it left an unsigned
  // record behind, and because the gate auto-collects from that directory, the
  // leftover blocked EVERY later gate test with ATTESTATION-MISSING — a test
  // fixture silently failing the real gate. Same family as the ledger-atomicity
  // defect: a test mutating the canonical evidence store.
  //
  // The property under test never needed a file. It is that a reviews/ path is
  // classified as EVIDENCE and therefore excluded from the subject, so the hash
  // is computed over the same paths with or without it.
  const withoutEvidence = run(['--subject', '--changed', 'builder-control/test-fixtures/app.ts', '--json']);
  const withEvidence = run([
    '--subject', '--changed', 'builder-control/test-fixtures/app.ts',
    '--changed', 'builder-control/reviews/some-record.json',
    '--changed', 'builder-control/review-raw/some-raw.txt',
    '--json',
  ]);
  let a, b;
  try { a = JSON.parse(withoutEvidence.out); b = JSON.parse(withEvidence.out); }
  catch { a = null; b = null; }

  const stable = a && b && a.subjectSha256 === b.subjectSha256;
  const excluded = b && b.excludedAsEvidence.length === 2 &&
    !b.subjectPaths.some((p) => /reviews|review-raw/.test(p));

  if (stable && excluded) {
    pass++;
    console.log('  ok   adding a review record does NOT change the subject hash  (stable)');
  } else {
    fail++;
    console.error('  FAIL adding a review record changed the subject hash');
    console.error(`       without=${a && a.subjectSha256}\n       with   =${b && b.subjectSha256}\n       excluded=${excluded}`);
  }
})();

expect('control metadata does NOT escalate an ordinary code change to high-risk',
  ['--classify', '--changed', 'research/app.ts',
   '--changed', 'builder-control/packets/SOME.json',
   '--changed', 'builder-control/reviews/some.json',
   '--changed', 'builder-control/ledger.json'],
  { exit: 0, contains: ['lane      : FULL', 'high-risk : no'], notContains: 'the control system itself' });

expect('control CODE still IS high-risk (the exclusion is evidence-only)',
  ['--classify', '--changed', 'builder-control/engineering-os.cjs'],
  { exit: 0, contains: ['FULL', 'high-risk : YES', 'the control system itself'] });

console.log('\nRED PROOF — COVERAGE AND CONTAMINATION');

expect('a review covering only SOME subject paths blocks',
  ['--gate-done', '--packet', PKT,
   '--changed', 'builder-control/test-fixtures/app.ts', '--changed', 'builder-control/test-fixtures/other.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-subset.json', review({
     reviewId: 'REV-rp-subset',
     reviewOf: { diffSha256: SHA_A, changedPaths: ['builder-control/test-fixtures/app.ts'] },
   }))],
  { exit: 3, contains: ['ENGOS-REVIEW-COVERAGE-SHORT', 'Partial coverage is not approval'] });

expect('a review claiming paths OUTSIDE the subject blocks',
  ['--gate-done', '--packet', PKT, '--changed', 'builder-control/test-fixtures/app.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-extra.json', review({
     reviewId: 'REV-rp-extra',
     reviewOf: { diffSha256: SHA_A, changedPaths: ['builder-control/test-fixtures/app.ts', 'builder-control/test-fixtures/not-in-subject.ts'] },
   }))],
  { exit: 3, contains: 'ENGOS-REVIEW-COVERAGE-EXTRA' });

// A CRITICAL finding about a DIFFERENT change must not block this one. Evidence
// about another subject is evidence about another thing, in both directions.
expect('a stale CRITICAL finding bound to another subject does NOT contaminate this one',
  ['--gate-done', '--packet', PKT, '--changed', 'builder-control/test-fixtures/app.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-clean.json', review({ reviewId: 'REV-rp-clean' })),
   '--review', writeJSON('rp-clean-grok.json', review({ reviewId: 'REV-rp-clean-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture' })),
   '--review', writeJSON('rp-stale-critical.json', review({
     reviewId: 'REV-rp-stalecrit',
     reviewer: 'grok',
     reviewOf: { diffSha256: SHA_B, changedPaths: ['builder-control/test-fixtures/app.ts'] },
     disposition: 'REJECT',
     findings: [{
       severity: 'CRITICAL', file: 'src/old.ts', problem: 'auth bypass in a previous revision',
       evidence: 'src/old.ts:40 skipped the session check', impact: 'unauthenticated access',
       requiredCorrection: 'restore the check', verificationMethod: 'auth integration test',
       status: 'OPEN',
     }],
   }))],
  { exit: 0, contains: ['READY_FOR_DETERMINISTIC_VALIDATION', 'IGNORED'], notContains: 'ENGOS-OPEN-BLOCKING-FINDING' });

expect('two conflicting records from the same reviewer for the same subject BLOCK as ambiguous',
  ['--gate-done', '--packet', PKT, '--changed', 'builder-control/test-fixtures/app.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-dup-a.json', review({ reviewId: 'REV-rp-dup-a', disposition: 'APPROVE' })),
   '--review', writeJSON('rp-dup-b.json', review({ reviewId: 'REV-rp-dup-b', disposition: 'REJECT' }))],
  { exit: 3, contains: ['ENGOS-AMBIGUOUS-REVIEWS', 'Exactly one verdict per reviewer per subject'] });

expect('an explicit supersedes declaration resolves the ambiguity deterministically',
  ['--gate-done', '--packet', PKT, '--changed', 'builder-control/test-fixtures/app.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-sup-old.json', review({ reviewId: 'REV-rp-sup-old', disposition: 'REJECT' })),
   '--review', writeJSON('rp-sup-new.json', review({
     reviewId: 'REV-rp-sup-new', disposition: 'APPROVE', supersedes: 'REV-rp-sup-old',
   })),
   '--review', writeJSON('rp-sup-grok.json', review({ reviewId: 'REV-rp-sup-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture' }))],
  { exit: 0, contains: ['READY_FOR_DETERMINISTIC_VALIDATION', 'superseded'] });

console.log('\nRED PROOF — RECORD FIELDS THAT CANNOT BE EMPTY');

expect('an empty evidence string is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('rp-empty-ev.json', review({
    findings: [{ severity: 'MEDIUM', problem: 'x', evidence: '   ', status: 'OPEN' }],
  }))],
  { exit: 2, contains: 'evidence is empty' });

expect('a loose timestamp with no timezone is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('rp-bad-ts.json', review({ ts: '2026-08-23 04:00' }))],
  { exit: 2, contains: '/ts' });

expect('a missing reviewerModel is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, (() => { const r = review(); delete r.reviewerModel; return writeJSON('rp-no-model.json', r); })()],
  { exit: 2, contains: 'reviewerModel' });

expect('an empty changedPaths is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('rp-no-cov.json', review({
    reviewOf: { diffSha256: SHA_A, changedPaths: [] },
  }))],
  { exit: 2, contains: 'changedPaths' });

expect('a HIGH finding without impact/correction/verification is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('rp-thin-high.json', review({
    findings: [{ severity: 'HIGH', problem: 'x', evidence: 'line 3', status: 'OPEN' }],
  }))],
  { exit: 2, contains: ['require a non-empty impact', 'requiredCorrection', 'verificationMethod'] });

expect('a FIXED finding that nobody re-verified is refused',
  ['--validate-review', '--packet', FIXTURE_PACKET, writeJSON('rp-selffixed.json', review({
    findings: [{ severity: 'HIGH', problem: 'x', evidence: 'y', impact: 'i',
                 requiredCorrection: 'c', verificationMethod: 'v', status: 'FIXED' }],
  }))],
  { exit: 2, contains: 'requires verifiedByReviewId' });

console.log('\nRED PROOF — FAIL CLOSED WHEN POLICY OR INPUT IS UNSAFE');

// A ref carrying shell metacharacters must never reach a shell.
(function refInjectionCannotExecute() {
  const canary = path.join(os.tmpdir(), `engos-canary-${process.pid}`);
  try { fs.unlinkSync(canary); } catch {}
  const r = run(['--subject', '--base', `main; touch ${canary}`]);
  const blocked = r.exit === 3 && /not a plain ref name/.test(r.out);
  const noSideEffect = !fs.existsSync(canary);
  if (blocked && noSideEffect) {
    pass++; console.log('  ok   a shell-metacharacter ref is refused and executes nothing  (exit 3)');
  } else {
    fail++;
    console.error('  FAIL shell-metacharacter ref handling');
    console.error(`       exit=${r.exit} blocked=${blocked} canaryAbsent=${noSideEffect}`);
  }
  try { fs.unlinkSync(canary); } catch {}
})();

// A missing protected-path policy must be a hard block, never an empty
// allow-list. "No policy found" must never read as "nothing is protected".
(function missingPolicyFailsClosed() {
  const isolatedRoot = fs.mkdtempSync(path.join(TMP, 'missing-policy-'));
  const isolatedControl = path.join(isolatedRoot, 'builder-control');
  fs.mkdirSync(isolatedControl, { recursive: true });
  const isolatedCli = path.join(isolatedControl, 'engineering-os.cjs');
  fs.copyFileSync(CLI, isolatedCli);
  spawnSync('git', ['init', '--quiet'], { cwd: isolatedRoot, encoding: 'utf8' });
  spawnSync('git', ['-c', 'user.name=AEGIS Fixture', '-c', 'user.email=aegis@example.invalid',
    'commit', '--allow-empty', '--quiet', '-m', 'fixture base'], { cwd: isolatedRoot, encoding: 'utf8' });
  const result = spawnSync('node', [isolatedCli, '--classify',
    '--changed', 'builder-control/test-fixtures/app.ts', '--diff-lines', '1',
    '--test-only-synthetic-subject'], {
    cwd: isolatedRoot,
    encoding: 'utf8',
    env: { ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '1' },
  });
  const r = { exit: result.status, out: (result.stdout || '') + (result.stderr || '') };
  const ok = r && r.exit === 3 && /ENGOS-POLICY-UNAVAILABLE/.test(r.out) && /an absent policy is not an empty policy/.test(r.out);
  if (ok) {
    pass++; console.log('  ok   a missing protected-path policy HARD-BLOCKS  (exit 3)');
  } else {
    fail++;
    console.error('  FAIL missing protected-path policy did not fail closed');
    console.error(`       exit=${r && r.exit}\n${(r && r.out || '').split('\n').map((l) => '         ' + l).join('\n')}`);
  }
})();

console.log('\nRED PROOF — PORTABILITY AND WORKFLOW BINDING');

// Every source of truth must resolve from the repo root. A Mac-only absolute
// path makes "spec-governed" unfalsifiable anywhere but one machine.
(function pinsResolveInACleanCheckout() {
  const pkt = JSON.parse(fs.readFileSync(REAL_PACKET, 'utf8'));
  const absolute = pkt.sourceOfTruth.filter((s) => path.isAbsolute(s));
  const unresolved = pkt.sourceOfTruth
    .filter((s) => !path.isAbsolute(s) && !/^UNVERIFIED:/i.test(s) && !/:\/\//.test(s))
    .filter((s) => !fs.existsSync(path.join(ROOT, s)));
  if (absolute.length === 0 && unresolved.length === 0) {
    pass++; console.log(`  ok   all ${pkt.sourceOfTruth.length} packet source pins resolve repo-relative (no machine-only paths)`);
  } else {
    fail++;
    console.error('  FAIL packet sources would not resolve in a clean CI checkout');
    for (const a of absolute) console.error(`       absolute path: ${a}`);
    for (const u of unresolved) console.error(`       unresolved   : ${u}`);
  }
})();

// The workflow must actually block. A gate that reports and exits 0 is a report.
(function workflowIsBinding() {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'builder-control.yml'), 'utf8');
  const problems = [];
  if (/ENGOS_ENFORCE/.test(wf)) problems.push('an ENGOS_ENFORCE opt-in still exists');
  if (/REPORT-ONLY\./.test(wf)) problems.push('a REPORT-ONLY banner still exists');
  if (!/--gate-done/.test(wf)) problems.push('the workflow never calls --gate-done');
  if (!/--subject-sha/.test(wf)) problems.push('--gate-done is called without --subject-sha');
  const gateStep = wf.slice(wf.indexOf('required review evidence'));
  if (/exit 0\s*$/m.test(gateStep)) problems.push('the gate step ends with an unconditional exit 0');
  if (problems.length === 0) {
    pass++; console.log('  ok   the CI gate is binding: no opt-in, no report-only, subject-bound');
  } else {
    fail++;
    console.error('  FAIL the CI gate is not binding');
    for (const p of problems) console.error(`       ${p}`);
  }
})();

// ── CODEX REVIEW CYCLE 1 — regressions for confirmed findings ──────────────
console.log('\nRED PROOF — CONFIRMED CODEX FINDINGS (cycle 1)');

expect('finding #10: LIGHT is refused when the line count is unknown',
  ['--classify', '--changed', 'docs/guide.md'],
  { exit: 0, contains: ['lane      : FULL', 'an unknown size is not a small size'], notContains: 'lane      : LIGHT' });

expect('finding #10: LIGHT is still granted when the size is known and small',
  ['--classify', '--changed', 'docs/guide.md', '--diff-lines', '20'],
  { exit: 0, contains: 'lane      : LIGHT' });

// ── GROK G9 (inside finding #3's evidence): 0/0 checks read as READY_FOR_PR ─
console.log('\nRED PROOF — ZERO CHECKS IS NOT EVIDENCE');
(function zeroChecksIsNotReady() {
  // Keep this fixture valid under the current packet registry so the proof
  // reaches the zero-check rule rather than stopping on unrelated historical
  // paths from ENGINEERING-OS-V1.json.
  const empty = {
    ...realPacket,
    packetId: PACKET_ID,
    filesAllowed: ['builder-control/test-fixtures/app.ts'],
    testsRequired: [],
    authorization: {
      authorizedBy: 'none',
      allowsProtectedPaths: [],
      allowsPublicPush: false,
      allowsRelease: false,
    },
  };
  const p = writeJSON('rp-nochecks.json', empty);
  const codexReview = writeJSON('rp-nochecks-codex.json', review({
    reviewId: 'REV-rp-nochk-codex',
  }));
  const grokReview = writeJSON('rp-nochecks-grok.json', review({
    reviewId: 'REV-rp-nochk-grok',
    reviewer: 'grok',
    reviewerModel: 'grok-test-fixture',
  }));
  const r = run(['--gate-done', '--packet', p, '--changed', 'builder-control/test-fixtures/app.ts',
    '--subject-sha', SHA_A, '--run-checks',
    '--review', codexReview, '--review', grokReview, '--json']);
  let result = null;
  try { result = JSON.parse(r.out); } catch {}
  const namesTheRule = result && Array.isArray(result.problems) &&
    result.problems.some((problem) => problem.rule === 'ENGOS-NO-DETERMINISTIC-CHECKS');
  if (r.exit === 3 && result && result.ok === false && result.state === 'BLOCKED' && namesTheRule) {
    pass++; console.log('  ok   a gate-complete packet with zero testsRequired exits 3 with ok=false and BLOCKED');
  } else {
    fail++; console.error('  FAIL zero executed checks did not independently block a gate-complete fixture');
    console.error(`       exit=${r.exit} ok=${result && result.ok} state=${result && result.state} namesTheRule=${namesTheRule}`);
  }
})();

// RED PROOF: no test in this file may write into the canonical evidence
// directories. A fixture that mutates reviews/ can leave an unsigned record
// behind on any interruption, and the gate auto-collects from there — so the
// leftover blocks every later gate case. That is how a passing suite turns into
// an intermittent one that only fails on the SECOND run.
(function noCanonicalEvidenceWrites() {
  const src = fs.readFileSync(__filename, 'utf8');
  const body = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const offenders = [];
  if (/writeFileSync\([^)]*reviews[\/'"]/.test(body)) offenders.push('writes into builder-control/reviews/');
  if (/renameSync\(live/.test(body)) offenders.push('renames the canonical protected-path policy');
  if (/unlinkSync\(strayProbe/.test(body)) offenders.push('deletes canonical review evidence');
  if (/writeFileSync\([^)]*review-raw/.test(body)) offenders.push('writes into builder-control/review-raw/');
  if (/writeFileSync\([^)]*ledger\.json/.test(body)) offenders.push('writes the canonical ledger');
  if (offenders.length === 0) {
    pass++;
    console.log('  ok   this suite writes nothing into the canonical evidence directories');
  } else {
    fail++;
    console.error('  FAIL this suite mutates canonical evidence: ' + offenders.join('; '));
  }
})();

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION CYCLE 1 — PKT-20260825-GOVERNANCE-TRUTH
// The prior suite proved "high-risk needs grok too" but never proved the plain
// case: an ORDINARY FULL change — no high-risk signal at all — also requires
// both reviewers, and control/security documents never slip into LIGHT just
// because they end in .md. These are the exact holes the packet named.
// ════════════════════════════════════════════════════════════════════════════

console.log('\nRED PROOF — ORDINARY FULL REQUIRES BOTH CODEX AND GROK');

expect('an ordinary (no high-risk signal) FULL change with codex approval alone is BLOCKED — codex-only is not enough',
  ['--gate-done', '--packet', PKT,
   '--changed', 'research/plain-feature.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('rp-ordinary-codex-only.json', review({
     reviewId: 'REV-rp-ordinary-codex', reviewOf: reviewOf('research/plain-feature.ts'),
   }))],
  { exit: 3, contains: ['ENGOS-REVIEW-MISSING', 'grok'], notContains: 'READY_FOR' });

expect('an ordinary (no high-risk signal) FULL change with grok approval alone is BLOCKED — grok-only is not enough',
  ['--gate-done', '--packet', PKT,
   '--changed', 'research/plain-feature.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('rp-ordinary-grok-only.json', review({
     reviewId: 'REV-rp-ordinary-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
     reviewOf: reviewOf('research/plain-feature.ts'),
   }))],
  { exit: 3, contains: ['ENGOS-REVIEW-MISSING', 'codex'], notContains: 'READY_FOR' });

expect('an ordinary (no high-risk signal) FULL change clears ONLY once both codex and grok approve',
  ['--gate-done', '--packet', PKT,
   '--changed', 'research/plain-feature.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('rp-ordinary-both-codex.json', review({
     reviewId: 'REV-rp-ordinary-both-codex', reviewOf: reviewOf('research/plain-feature.ts'),
   })),
   '--review', writeJSON('rp-ordinary-both-grok.json', review({
     reviewId: 'REV-rp-ordinary-both-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
     reviewOf: reviewOf('research/plain-feature.ts'),
   }))],
  { exit: 0, contains: 'RESULT: READY_FOR_DETERMINISTIC_VALIDATION' });

console.log('\nRED PROOF — CONTROL AND SECURITY MARKDOWN NEVER ENTERS LIGHT');

expect('a .github control-surface markdown file is FULL despite the .md extension',
  ['--classify', '--changed', '.github/copilot-instructions.md', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'repository control surface'], notContains: 'lane      : LIGHT' });

expect('the root AGENTS.md charter is FULL despite the .md extension',
  ['--classify', '--changed', 'AGENTS.md', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'agent charter'], notContains: 'lane      : LIGHT' });

expect('a SECURITY.md file is FULL despite the .md extension — it matches the security-control pattern',
  ['--classify', '--changed', 'SECURITY.md', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'security control'], notContains: 'lane      : LIGHT' });

expect('a CODEOWNERS review-ownership file is FULL with no extension at all',
  ['--classify', '--changed', 'CODEOWNERS', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'review-ownership control file'], notContains: 'lane      : LIGHT' });

console.log('\nRED PROOF — REVIEWER COMPLETENESS: EXACT-SUBJECT EXECUTION STATUS');

// EXECUTED requires a valid record bound to the EXACT current subject hash.
// A record bound to any other subject is STALE; a malformed record that never
// became evidence is MISSING; two conflicting active records are MISSING
// (ambiguous, not evidence). None of the three may ever read as EXECUTED.
(function reviewerCompletenessExecutedOnlyOnExactSubject() {
  const r = run(['--gate-done', '--packet', PKT,
    '--changed', 'builder-control/test-fixtures/exact-subject.ts', '--subject-sha', SHA_A,
    '--review', writeJSON('rp-exact-codex.json', review({
      reviewId: 'REV-rp-exact-codex', reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts'),
    })),
    '--review', writeJSON('rp-exact-grok.json', review({
      reviewId: 'REV-rp-exact-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
      reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts'),
    })),
    '--json']);
  let j; try { j = JSON.parse(r.out); } catch { j = null; }
  const rows = j && j.reviewerCompleteness && j.reviewerCompleteness.rows;
  const codexRow = rows && rows.find((x) => x.reviewer === 'codex');
  const grokRow = rows && rows.find((x) => x.reviewer === 'grok');
  const ok = r.exit === 0 && codexRow && codexRow.executed === 'EXECUTED' &&
    /1\/1 subject path\(s\) covered/.test(codexRow.score) &&
    grokRow && grokRow.executed === 'EXECUTED';
  if (ok) {
    pass++; console.log('  ok   a record bound to the exact current subject reads EXECUTED with a coverage score');
  } else {
    fail++;
    console.error('  FAIL exact-subject EXECUTED status not reported correctly');
    console.error(`       exit=${r.exit} codexRow=${JSON.stringify(codexRow)} grokRow=${JSON.stringify(grokRow)}`);
  }
})();

(function reviewerCompletenessStaleNeverReadsExecuted() {
  const r = run(['--gate-done', '--packet', PKT,
    '--changed', 'builder-control/test-fixtures/exact-subject.ts', '--subject-sha', SHA_A,
    '--review', writeJSON('rp-stale-codex.json', review({
      reviewId: 'REV-rp-stale-codex', reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts'),
    })),
    '--review', writeJSON('rp-stale-grok-otherversion.json', review({
      reviewId: 'REV-rp-stale-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
      reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts', SHA_B),
    })),
    '--json']);
  let j; try { j = JSON.parse(r.out); } catch { j = null; }
  const rows = j && j.reviewerCompleteness && j.reviewerCompleteness.rows;
  const grokRow = rows && rows.find((x) => x.reviewer === 'grok');
  const ok = r.exit === 3 && grokRow && grokRow.executed === 'STALE' &&
    Array.isArray(grokRow.staleRecords) && grokRow.staleRecords.length === 1 &&
    grokRow.executed !== 'EXECUTED';
  if (ok) {
    pass++; console.log('  ok   a record bound to a DIFFERENT subject reads STALE, never EXECUTED');
  } else {
    fail++;
    console.error('  FAIL a stale-subject record was not reported as STALE');
    console.error(`       exit=${r.exit} grokRow=${JSON.stringify(grokRow)}`);
  }
})();

(function reviewerCompletenessMalformedNeverReadsExecuted() {
  const malformedGrok = review({ reviewId: 'REV-rp-malformed-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture', reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts') });
  delete malformedGrok.reviewerModel; // required by schema — this record cannot become evidence
  const r = run(['--gate-done', '--packet', PKT,
    '--changed', 'builder-control/test-fixtures/exact-subject.ts', '--subject-sha', SHA_A,
    '--review', writeJSON('rp-malf-codex.json', review({
      reviewId: 'REV-rp-malf-codex', reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts'),
    })),
    '--review', writeJSON('rp-malformed-grok.json', malformedGrok),
    '--json']);
  let j; try { j = JSON.parse(r.out); } catch { j = null; }
  const rows = j && j.reviewerCompleteness && j.reviewerCompleteness.rows;
  const grokRow = rows && rows.find((x) => x.reviewer === 'grok');
  const malformedNamed = /ENGOS-REVIEW-MALFORMED/.test(r.out);
  const ok = r.exit === 3 && malformedNamed && grokRow && grokRow.executed !== 'EXECUTED';
  if (ok) {
    pass++; console.log(`  ok   a malformed record never becomes evidence and never reads EXECUTED (grok reads ${grokRow.executed})`);
  } else {
    fail++;
    console.error('  FAIL a malformed record was not kept out of EXECUTED');
    console.error(`       exit=${r.exit} malformedNamed=${malformedNamed} grokRow=${JSON.stringify(grokRow)}`);
  }
})();

(function reviewerCompletenessAmbiguousNeverReadsExecuted() {
  const r = run(['--gate-done', '--packet', PKT,
    '--changed', 'builder-control/test-fixtures/exact-subject.ts', '--subject-sha', SHA_A,
    '--review', writeJSON('rp-ambig-codex-a.json', review({
      reviewId: 'REV-rp-ambig-codex-a', disposition: 'APPROVE', reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts'),
    })),
    '--review', writeJSON('rp-ambig-codex-b.json', review({
      reviewId: 'REV-rp-ambig-codex-b', disposition: 'REJECT', reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts'),
    })),
    '--review', writeJSON('rp-ambig-grok.json', review({
      reviewId: 'REV-rp-ambig-grok', reviewer: 'grok', reviewerModel: 'grok-test-fixture',
      reviewOf: reviewOf('builder-control/test-fixtures/exact-subject.ts'),
    })),
    '--json']);
  let j; try { j = JSON.parse(r.out); } catch { j = null; }
  const rows = j && j.reviewerCompleteness && j.reviewerCompleteness.rows;
  const codexRow = rows && rows.find((x) => x.reviewer === 'codex');
  const ok = r.exit === 3 && /ENGOS-AMBIGUOUS-REVIEWS/.test(r.out) &&
    codexRow && codexRow.executed !== 'EXECUTED';
  if (ok) {
    pass++; console.log(`  ok   two conflicting active records never read EXECUTED (codex reads ${codexRow.executed})`);
  } else {
    fail++;
    console.error('  FAIL ambiguous conflicting records were not kept out of EXECUTED');
    console.error(`       exit=${r.exit} codexRow=${JSON.stringify(codexRow)}`);
  }
})();


// ═══════════════════════════════════════════════════════════════════════════
// CORRECTION CYCLE — REV-20260825234549-codex, findings #1, #2, #8
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nRED PROOF — FINDING #1: THE CALLER CANNOT DECLARE ITS OWN CHANGE');

// The exact reproduction from the review. In THIS working tree the real subject
// is a set of HIGH-RISK builder-control paths; before the fix, naming an
// unchanged README.md and a 1-line count returned ok:true, lane LIGHT, no
// packet and no required reviewers. runProd() is used deliberately: this must
// hold for the invocation a human or CI actually makes, with no test-only
// boundary opened anywhere.
expect_raw('a dirty builder-control tree cannot be certified LIGHT by naming README.md',
  runProd(['--gate-done', '--changed', 'README.md', '--diff-lines', '1',
           '--subject-sha', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '--json']),
  { exit: 3, contains: ['ENGOS-SYNTHETIC-INPUT-REFUSED'], notContains: ['"lane": "LIGHT"', '"ok": true'] });

expect_raw('--changed alone is refused in production, not silently honoured',
  runProd(['--classify', '--changed', 'README.md', '--json']),
  { exit: 3, contains: ['ENGOS-SYNTHETIC-INPUT-REFUSED'], notContains: '"lane": "LIGHT"' });

expect_raw('--diff-lines alone is refused in production — the size cap is git\'s to measure',
  runProd(['--classify', '--diff-lines', '1', '--json']),
  { exit: 3, contains: ['ENGOS-SYNTHETIC-INPUT-REFUSED'] });

expect_raw('the flag alone does not open the boundary — the environment must agree',
  runProd(['--classify', '--changed', 'README.md', '--diff-lines', '1', '--test-only-synthetic-subject', '--json']),
  { exit: 3, contains: ['ENGOS-SYNTHETIC-INPUT-REFUSED'] });

expect_raw('the environment alone does not open the boundary — the flag must be explicit',
  runProd(['--classify', '--changed', 'README.md', '--diff-lines', '1', '--json'],
          { ENGOS_TEST_ONLY_SYNTHETIC: '1' }),
  { exit: 3, contains: ['ENGOS-SYNTHETIC-INPUT-REFUSED'] });

// A forged subject hash, supplied with no synthetic narrowing at all, must be
// caught by the binding check against the REAL tree — and the lane reported
// must be the real tree's lane, not the forged one's.
expect_raw('a forged subject hash is refused against the real tree',
  runProd(['--gate-done',
           '--subject-sha', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '--json']),
  { exit: 3, contains: ['ENGOS-SUBJECT-MISMATCH'], notContains: '"ok": true' });

// Finding #1's second verification requirement: one subject hash cannot
// classify two ways because the caller changed --diff-lines. In production the
// caller has no --diff-lines to change, so the check is that repeated runs of
// the real tree agree with each other exactly.
(function classificationIsAFunctionOfTheSubjectAlone() {
  const a = runProd(['--classify', '--json']);
  const b = runProd(['--classify', '--json']);
  let ja, jb;
  try { ja = JSON.parse(a.out); jb = JSON.parse(b.out); } catch { ja = jb = null; }
  const ok = ja && jb &&
    ja.subject.subjectSha256 === jb.subject.subjectSha256 &&
    ja.lane === jb.lane &&
    ja.caps.linesSeen === jb.caps.linesSeen &&
    typeof ja.caps.linesSeen === 'number' &&
    JSON.stringify(ja.requiredReviewers) === JSON.stringify(jb.requiredReviewers);
  if (ok) {
    pass++;
    console.log(`  ok   one subject hash classifies one way (${ja.lane}, ${ja.caps.linesSeen} git-measured lines, twice)`);
  } else {
    fail++;
    console.error('  FAIL classification of one subject hash was not stable');
    console.error(`       a=${JSON.stringify(ja && { lane: ja.lane, lines: ja.caps.linesSeen })} b=${JSON.stringify(jb && { lane: jb.lane, lines: jb.caps.linesSeen })}`);
  }
})();

console.log('\nRED PROOF — FINDING #2: ONE PATH HAS ONE SPELLING');

// Every alias of the root charter must reach the same canonical path and the
// same FULL/HIGH-RISK verdict. Before the fix `./AGENTS.md` classified LIGHT.
for (const alias of ['./AGENTS.md', 'dir/../AGENTS.md', 'a/b/../../AGENTS.md']) {
  expect(`the alias ${alias} resolves to AGENTS.md and is FULL`,
    ['--classify', '--changed', alias, '--diff-lines', '5'],
    { exit: 0, contains: ['lane      : FULL', 'agent charter', 'AGENTS.md'], notContains: 'lane      : LIGHT' });
}

// Charters below the root. luke-app/CLAUDE.md is a real agent charter in this
// repository and classified LIGHT before the fix.
expect('a nested charter luke-app/CLAUDE.md is FULL at its real depth',
  ['--classify', '--changed', 'luke-app/CLAUDE.md', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'agent charter'], notContains: 'lane      : LIGHT' });

expect('a charter inside a docs tree (docs/AGENTS.md) is FULL, not documentation',
  ['--classify', '--changed', 'docs/AGENTS.md', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'agent charter'], notContains: 'lane      : LIGHT' });

// Real .claude control files in this repository.
expect('an existing .claude settings file is FULL — it decides what an agent may do',
  ['--classify', '--changed', 'luke-app/.claude/settings.json', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'agent control directory'], notContains: 'lane      : LIGHT' });

expect('an existing .claude launch config is FULL',
  ['--classify', '--changed', 'luke-app/.claude/launch.json', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'agent control directory'], notContains: 'lane      : LIGHT' });

expect('a .claude hook is FULL — it runs on the agent\'s behalf',
  ['--classify', '--changed', './luke-app/.claude/hooks/x.sh', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'agent control directory'], notContains: 'lane      : LIGHT' });

// Paths that cannot be reduced to one canonical spelling are refused outright,
// never classified as anything — including never as LIGHT.
expect('an absolute path is refused, not classified',
  ['--classify', '--changed', '/etc/passwd', '--diff-lines', '1'],
  { exit: 3, contains: ['ENGOS-PATH-NOT-CANONICAL', 'absolute'], notContains: 'lane      : LIGHT' });

expect('a backslash path is refused — git never emits one',
  ['--classify', '--changed', 'docs\\AGENTS.md', '--diff-lines', '1'],
  { exit: 3, contains: ['ENGOS-PATH-NOT-CANONICAL', 'backslash'], notContains: 'lane      : LIGHT' });

expect('a path escaping the repository root is refused',
  ['--classify', '--changed', '../outside/notes.md', '--diff-lines', '1'],
  { exit: 3, contains: ['ENGOS-PATH-NOT-CANONICAL', 'escapes'], notContains: 'lane      : LIGHT' });

// The canonicalisation must not quietly promote ordinary documents.
expect('canonicalisation does not drag an ordinary doc out of the light lane',
  ['--classify', '--changed', './docs/guide.md', '--diff-lines', '20'],
  { exit: 0, contains: ['lane      : LIGHT'] });

console.log('\nRED PROOF — FINDING #8: EVERY FULL SUBJECT REQUIRES CODEX AND GROK');

// This is the already-approved rule and it is NOT weakened to match the stale
// documentation. The docs were corrected instead. An ordinary FULL change —
// one that reached FULL precisely because nothing could confidently call it
// safe — requires both reviewers.
expect('an ordinary FULL change requires codex AND grok',
  ['--classify', '--changed', 'research/plain-feature.ts', '--diff-lines', '10'],
  { exit: 0, contains: ['lane      : FULL', 'codex + grok (required)'] });

expect('a HIGH-RISK change requires codex AND grok',
  ['--classify', '--changed', 'builder-control/test-fixtures/auth/session.ts', '--diff-lines', '10'],
  { exit: 0, contains: ['lane      : FULL', 'high-risk : YES', 'codex + grok (required)'] });

expect('a control-plane charter change requires codex AND grok',
  ['--classify', '--changed', 'luke-app/CLAUDE.md', '--diff-lines', '5'],
  { exit: 0, contains: ['lane      : FULL', 'codex + grok (required)'] });

(function requiredReviewerSetIsStableAcrossRepeatedClassification() {
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const r = run(['--classify', '--changed', 'research/plain-feature.ts', '--diff-lines', '10', '--json']);
    let j; try { j = JSON.parse(r.out); } catch { j = null; }
    seen.add(j ? JSON.stringify(j.requiredReviewers) : `parse-error-${i}`);
  }
  const ok = seen.size === 1 && seen.has('["codex","grok"]');
  if (ok) { pass++; console.log('  ok   the required-reviewer set is identical on repeated classification'); }
  else { fail++; console.error(`  FAIL required-reviewer set varied across runs: ${[...seen].join(' | ')}`); }
})();


console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
