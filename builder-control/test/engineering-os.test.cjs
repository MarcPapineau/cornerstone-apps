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

function run(args) {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { exit: r.status, out: (r.stdout || '') + (r.stderr || '') };
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
  const fixturePaths = ['src/**', 'docs/**', 'db/**', 'server/**', 'a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', '.github/**', 'builder-control/**', 'packages/**'];
  base.filesAllowed = fixturePaths;
  // filesAllowed outside the agent's allowedPathGlobs must be covered by
  // authorization.allowsProtectedPaths, or packet-tools rejects the packet —
  // which is the registry check doing its job on a synthetic fixture.
  base.authorization = { ...base.authorization, allowsProtectedPaths: fixturePaths };
  fs.writeFileSync(FIXTURE_PACKET, JSON.stringify(base, null, 2));
})();
function writeJSON(name, obj) {
  const p = path.join(TMP, name);
  const isReview = obj && obj.reviewId && obj.reviewOf && obj.disposition;
  const body = isReview ? SIGNER.sign(obj, { packetPath: FIXTURE_PACKET }) : obj;
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

const realPacket = JSON.parse(fs.readFileSync(REAL_PACKET, 'utf8'));
const PACKET_ID = 'PKT-20260824-ENGOS-TEST-FIXTURE';

// A review record that is valid in every respect, used as the base for the
// negative cases so each one differs from a passing record in exactly one way.
// The fixture paths below do not exist in the repository, so their subject
// diff is intentionally empty. Bind the records to the hash the real subject
// calculator produces instead of a made-up digest.
const SHA_A = crypto.createHash('sha256').update('').digest('hex');
const SHA_B = 'b'.repeat(64);
function reviewOf(changedPath = 'src/app.ts', diffSha256 = SHA_A) {
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
expect('docs-only small change is LIGHT',
  ['--classify', '--changed', 'docs/guide.md', '--diff-lines', '20'],
  { exit: 0, contains: 'lane      : LIGHT' });

expect('auth path forces FULL + grok',
  ['--classify', '--changed', 'src/auth/session.ts'],
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
  ['--classify', '--changed', 'src/utils/format.ts', '--diff-lines', '3'],
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
   '--changed', 'src/app.ts', '--diff-sha', SHA_A],
  { exit: 3, contains: ['RESULT: BLOCKED', 'ENGOS-REVIEW-MISSING'] });

expect('codex approval clears a FULL non-high-risk change',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('ok-codex.json', review())],
  { exit: 0, contains: 'RESULT: READY_FOR_DETERMINISTIC_VALIDATION' });

expect('a review of a DIFFERENT diff does not transfer',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('stale.json', review({ reviewOf: reviewOf('src/app.ts', SHA_B) }))],
  { exit: 3, contains: ['different subject were IGNORED', 'ENGOS-REVIEW-MISSING'] });

expect('high-risk needs grok too — codex alone is not enough',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/auth/login.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('codex-only.json', review({ reviewOf: reviewOf('src/auth/login.ts') }))],
  { exit: 3, contains: ['ENGOS-REVIEW-MISSING', 'grok'] });

expect('claude-self approval never satisfies a required slot',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('self.json', review({ reviewId: 'REV-self-1', reviewer: 'claude-self' }))],
  { exit: 3, contains: ['ENGOS-REVIEW-MISSING', 'codex'] });

expect('a reviewer that could not run BLOCKS and is reported as UNAVAILABLE',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('unavail.json', review({
     disposition: 'UNAVAILABLE', unavailableReason: 'codex CLI not installed on this runner',
   }))],
  { exit: 3, contains: ['ENGOS-REVIEWER-UNAVAILABLE', 'codex CLI not installed'], notContains: 'RESULT: DONE' });

expect('an OPEN HIGH finding from the ADVISORY reviewer still blocks',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('codex-ok2.json', review()),
   '--review', writeJSON('copilot-bad.json', review({
     reviewId: 'REV-copilot-1', reviewer: 'copilot', disposition: 'REJECT',
     reviewerModel: 'github-copilot-test-fixture',
     findings: [{
       severity: 'HIGH',
       problem: 'import of a deleted module',
       evidence: 'src/app.ts:12 imports ./gone',
       impact: 'The application cannot load the deleted dependency.',
       requiredCorrection: 'Restore the dependency or remove the import.',
       verificationMethod: 'Run the application build and import test.',
       status: 'OPEN',
     }],
   }))],
  { exit: 3, contains: ['ENGOS-OPEN-BLOCKING-FINDING', 'import of a deleted module'] });

expect('a FIXED finding no longer blocks',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('fixed.json', review({
     findings: [{
       severity: 'HIGH',
       problem: 'stale import',
       evidence: 'src/app.ts:12 imported ./gone',
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
   }))],
  { exit: 0, contains: 'RESULT: READY_FOR_DETERMINISTIC_VALIDATION' });

expect('a review bound to another packet is rejected',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('wrongpacket.json', review({ packetId: 'PKT-SOMETHING-ELSE' }))],
  { exit: 3, contains: 'ENGOS-REVIEW-WRONG-PACKET' });

expect('LIGHT lane needs no AI reviewer at all',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'docs/notes.md', '--diff-lines', '10', '--diff-sha', SHA_A],
  { exit: 0, contains: 'RESULT: READY_FOR_DETERMINISTIC_VALIDATION' });

expect('unverified items are surfaced, not dropped',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/app.ts', '--diff-sha', SHA_A,
   '--review', writeJSON('withunver.json', review({ unverified: ['no browser available to test the modal'] }))],
  { exit: 0, contains: ['UNVERIFIED', 'no browser available to test the modal'] });

// ── no bypass ───────────────────────────────────────────────────────────────
console.log('\nNO BYPASS');
expect('--force is not a thing here',
  ['--gate-done', '--packet', FIXTURE_PACKET,
   '--changed', 'src/auth/x.ts', '--diff-sha', SHA_A, '--force'],
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
  ['--gate-done', '--packet', PKT, '--changed', 'src/app.ts'],
  { exit: 3, contains: ['ENGOS-NO-SUBJECT-BINDING', 'certifies nothing'], notContains: 'READY_FOR' });

expect('a --subject-sha that is not a digest blocks',
  ['--gate-done', '--packet', PKT, '--changed', 'src/app.ts', '--subject-sha', 'not-a-hash'],
  { exit: 3, contains: 'ENGOS-NO-SUBJECT-BINDING' });

expect('a WRONG --subject-sha blocks even with a valid approval present',
  ['--gate-done', '--packet', PKT, '--changed', 'src/app.ts',
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
  const withoutEvidence = run(['--subject', '--changed', 'src/app.ts', '--json']);
  const withEvidence = run([
    '--subject', '--changed', 'src/app.ts',
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

  // Belt and braces: if an earlier interrupted run left a probe behind, remove
  // it so it cannot block the gate cases below.
  const strayProbe = path.join(ROOT, 'builder-control', 'reviews', 'rp-stability-probe.json');
  let removedStray = false;
  try { if (fs.existsSync(strayProbe)) { fs.unlinkSync(strayProbe); removedStray = true; } } catch {}

  if (stable && excluded) {
    pass++;
    console.log(`  ok   adding a review record does NOT change the subject hash  (stable${removedStray ? '; removed a stray probe from an interrupted run' : ''})`);
  } else {
    fail++;
    console.error('  FAIL adding a review record changed the subject hash');
    console.error(`       without=${a && a.subjectSha256}\n       with   =${b && b.subjectSha256}\n       excluded=${excluded}`);
  }
})();

expect('control metadata does NOT escalate an ordinary code change to high-risk',
  ['--classify', '--changed', 'src/app.ts',
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
   '--changed', 'src/app.ts', '--changed', 'src/other.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-subset.json', review({
     reviewId: 'REV-rp-subset',
     reviewOf: { diffSha256: SHA_A, changedPaths: ['src/app.ts'] },
   }))],
  { exit: 3, contains: ['ENGOS-REVIEW-COVERAGE-SHORT', 'Partial coverage is not approval'] });

expect('a review claiming paths OUTSIDE the subject blocks',
  ['--gate-done', '--packet', PKT, '--changed', 'src/app.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-extra.json', review({
     reviewId: 'REV-rp-extra',
     reviewOf: { diffSha256: SHA_A, changedPaths: ['src/app.ts', 'src/not-in-subject.ts'] },
   }))],
  { exit: 3, contains: 'ENGOS-REVIEW-COVERAGE-EXTRA' });

// A CRITICAL finding about a DIFFERENT change must not block this one. Evidence
// about another subject is evidence about another thing, in both directions.
expect('a stale CRITICAL finding bound to another subject does NOT contaminate this one',
  ['--gate-done', '--packet', PKT, '--changed', 'src/app.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-clean.json', review({ reviewId: 'REV-rp-clean' })),
   '--review', writeJSON('rp-stale-critical.json', review({
     reviewId: 'REV-rp-stalecrit',
     reviewer: 'grok',
     reviewOf: { diffSha256: SHA_B, changedPaths: ['src/app.ts'] },
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
  ['--gate-done', '--packet', PKT, '--changed', 'src/app.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-dup-a.json', review({ reviewId: 'REV-rp-dup-a', disposition: 'APPROVE' })),
   '--review', writeJSON('rp-dup-b.json', review({ reviewId: 'REV-rp-dup-b', disposition: 'REJECT' }))],
  { exit: 3, contains: ['ENGOS-AMBIGUOUS-REVIEWS', 'Exactly one verdict per reviewer per subject'] });

expect('an explicit supersedes declaration resolves the ambiguity deterministically',
  ['--gate-done', '--packet', PKT, '--changed', 'src/app.ts', '--subject-sha', SHA_A,
   '--review', writeJSON('rp-sup-old.json', review({ reviewId: 'REV-rp-sup-old', disposition: 'REJECT' })),
   '--review', writeJSON('rp-sup-new.json', review({
     reviewId: 'REV-rp-sup-new', disposition: 'APPROVE', supersedes: 'REV-rp-sup-old',
   }))],
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
  const live = path.join(ROOT, 'builder-control', 'protected-paths.json');
  const hidden = live + '.redproof-hidden';
  if (!fs.existsSync(live)) { fail++; console.error('  FAIL protected-paths.json is missing before the test even ran'); return; }
  const restore = () => { try { if (fs.existsSync(hidden)) fs.renameSync(hidden, live); } catch {} };
  process.on('exit', restore);
  let r;
  try {
    fs.renameSync(live, hidden);
    r = run(['--classify', '--changed', 'src/app.ts']);
  } finally {
    restore();
  }
  const ok = r && r.exit === 3 && /ENGOS-POLICY-UNAVAILABLE/.test(r.out) && /an absent policy is not an empty policy/.test(r.out);
  if (ok) {
    pass++; console.log('  ok   a missing protected-path policy HARD-BLOCKS  (exit 3)');
  } else {
    fail++;
    console.error('  FAIL missing protected-path policy did not fail closed');
    console.error(`       exit=${r && r.exit}\n${(r && r.out || '').split('\n').map((l) => '         ' + l).join('\n')}`);
  }
  if (!fs.existsSync(live)) { fail++; console.error('  FAIL protected-paths.json was NOT restored'); }
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
  const empty = { ...realPacket, testsRequired: [] };
  const p = writeJSON('rp-nochecks.json', empty);
  const r = run(['--gate-done', '--packet', p, '--changed', 'src/app.ts',
    '--subject-sha', SHA_A, '--run-checks',
    '--review', writeJSON('rp-nochecks-rev.json', review({ reviewId: 'REV-rp-nochk' }))]);
  const claimsReadyForPr = /RESULT: READY_FOR_PR/.test(r.out);
  const namesTheRule = /ENGOS-NO-DETERMINISTIC-CHECKS/.test(r.out);
  if (!claimsReadyForPr && namesTheRule) {
    pass++; console.log('  ok   a packet with zero testsRequired cannot reach READY_FOR_PR  (exit ' + r.exit + ')');
  } else {
    fail++;
    console.error('  FAIL zero executed checks still reported READY_FOR_PR');
    console.error(`       claimsReadyForPr=${claimsReadyForPr} namesTheRule=${namesTheRule}`);
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

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
