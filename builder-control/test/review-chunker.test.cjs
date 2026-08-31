#!/usr/bin/env node
/**
 * review-chunker.test.cjs — red proofs for chunked review.
 *
 * Chunking is a way to review a large subject completely. The danger is that it
 * becomes a way to review it INcompletely while producing a verdict that looks
 * whole. Every case here asserts that a partial, overlapping, foreign, stale,
 * unsigned, mixed, timed-out, or tampered set of groups CANNOT produce a
 * consumable aggregate.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../review-chunker.cjs');
const SIGN = require('../review-sign.cjs');
const ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}

console.log('AEGIS chunked review — red proofs');

const SUBJECT = [
  'builder-control/engineering-os.cjs',
  'builder-control/ledger-writer.cjs',
  'builder-control/tool-router.cjs',
  'builder-control/review-adapters.cjs',
  'builder-control/aegis-state.cjs',
  'builder-control/dashboard/index.html',
  'builder-control/specs/A.md',
  'builder-control/test/a.test.cjs',
  'builder-control/test/b.test.cjs',
  '.github/workflows/builder-control.yml',
];

// ── planning ────────────────────────────────────────────────────────────────
test('planning is deterministic — identical input yields identical groups', () => {
  const a = C.planGroups(SUBJECT, 5);
  const b = C.planGroups(SUBJECT.slice().reverse(), 5);
  assert.deepStrictEqual(JSON.stringify(a), JSON.stringify(b),
    'input order must not affect grouping, or a record can never be matched to its plan');
});

test('a plan covers the subject exactly', () => {
  const g = C.planGroups(SUBJECT, 5);
  const cov = C.checkCoverage(g, SUBJECT);
  assert.strictEqual(cov.ok, true, cov.reason);
  assert.strictEqual(cov.covered, SUBJECT.length);
});

test('the executable planner and its release proof share the same byte-aware plan', () => {
  const subject = { subjectPaths: SUBJECT.slice() };
  const sizes = Object.fromEntries(SUBJECT.map((p, i) => [p, (i + 1) * 1000]));
  const expected = C.planGroups(subject.subjectPaths, 6, sizes, {
    fixedOverheadBytes: C.FIXED_CHECK_OVERHEAD_BYTES,
  });
  const actual = C.planSubjectGroups(subject, { groups: 6 }, sizes);
  assert.deepStrictEqual(actual, expected,
    'the tested planner must be the exact helper used by --plan, --run, and --aggregate');
  assert.strictEqual(C.checkCoverage(actual, SUBJECT).ok, true);
  assert.throws(() => C.planSubjectGroups({ subjectPaths: [] }, { groups: 6 }, sizes),
    /non-empty canonical subject path list/);
});

test('groups are coherent — tests do not scatter across groups', () => {
  const g = C.planGroups(SUBJECT, 5);
  const withTests = g.filter((x) => x.paths.some((p) => /(^|\/)test\//.test(p)));
  assert.strictEqual(withTests.length, 1, 'test files must land in one group, not be sprinkled');
});

test('the planner honours a smaller target group count', () => {
  const g = C.planGroups(SUBJECT, 3);
  assert.ok(g.length <= 3, `expected at most 3 groups, got ${g.length}`);
  assert.strictEqual(C.checkCoverage(g, SUBJECT).ok, true, 'merging must not break coverage');
});

// ── coverage red proofs ─────────────────────────────────────────────────────
test('RED: a MISSING group is a coverage gap, not a smaller review', () => {
  const g = C.planGroups(SUBJECT, 5);
  const cov = C.checkCoverage(g.slice(0, -1), SUBJECT);
  assert.strictEqual(cov.ok, false);
  assert.strictEqual(cov.code, 'COVERAGE-GAP');
  assert.ok(/in no group/.test(cov.reason));
});

test('RED: OVERLAP between groups is refused', () => {
  const g = C.planGroups(SUBJECT, 5);
  const dup = JSON.parse(JSON.stringify(g));
  dup[1].paths.push(dup[0].paths[0]);
  const cov = C.checkCoverage(dup, SUBJECT);
  assert.strictEqual(cov.ok, false);
  assert.strictEqual(cov.code, 'COVERAGE-OVERLAP');
  assert.ok(/disagree/.test(cov.reason), 'the reason must say why overlap is dangerous');
});

test('RED: a FOREIGN path (reviewed but not in the subject) is refused', () => {
  const g = JSON.parse(JSON.stringify(C.planGroups(SUBJECT, 5)));
  g[0].paths.push('some/other/repo/file.ts');
  const cov = C.checkCoverage(g, SUBJECT);
  assert.strictEqual(cov.ok, false);
  assert.strictEqual(cov.code, 'COVERAGE-FOREIGN');
});

test('RED: an empty group set covers nothing', () => {
  const cov = C.checkCoverage([], SUBJECT);
  assert.strictEqual(cov.ok, false);
  assert.strictEqual(cov.code, 'COVERAGE-GAP');
});

// ── aggregation red proofs (record-level) ───────────────────────────────────
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-chunk-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

const PACKET = path.join(TMP, 'packet.json');
(function () {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packets', 'ENGINEERING-OS-V1.json'), 'utf8'));
  real.packetId = 'PKT-CHUNK-TEST';
  fs.writeFileSync(PACKET, JSON.stringify(real, null, 2));
})();

const SUBJ_SHA = 'c'.repeat(64);
function groupRecord(groupId, paths, over = {}) {
  return {
    reviewId: `REV-${groupId}`,
    ts: '2026-08-25T01:00:00Z',
    reviewer: 'codex',
    reviewerModel: 'codex-cli (ChatGPT.app)',
    packetId: 'PKT-CHUNK-TEST',
    reviewOf: { diffSha256: SUBJ_SHA, changedPaths: paths.slice().sort() },
    disposition: 'APPROVE',
    findings: [],
    group: { groupId, groupDigest: 'd'.repeat(64) },
    ...over,
  };
}
const sign = (r) => SIGN.sign(r, { packetPath: PACKET });

test('RED: a historically valid but non-gateable V1 constituent cannot enter a current aggregate', () => {
  const problem = C.gateableGroupProblem({
    ok: true,
    gateable: false,
    code: 'ATTESTATION-LEGACY-NON-GATEABLE',
    reason: 'historical V1 fields were only partially authenticated',
  }, 'legacy-v1.json');
  assert.ok(problem, 'ok:true was incorrectly treated as current gate authority');
  assert.strictEqual(problem.code, 'GROUP-NON-GATEABLE');
  assert.match(problem.detail, /ATTESTATION-LEGACY-NON-GATEABLE/);
  assert.strictEqual(C.gateableGroupProblem({ ok: true, gateable: true }, 'v2.json'), null);
});

test('run-id parsing accepts only canonical RUN coordinates', () => {
  const runId = 'RUN-20260830-deadbeef';
  assert.strictEqual(C.parseArgs(['--plan', '--run-id', runId]).runId, runId);
  assert.strictEqual(C.normalizeRunId(runId), runId);
  for (const invalid of ['', 'run-20260830-deadbeef', 'RUN-../../escape',
    'RUN-20260830-DEADBEEF', 'RUN-20260830-deadbeef-extra']) {
    assert.throws(() => C.normalizeRunId(invalid), /not a canonical RUN/);
  }
});

test('canonical run context refuses ROOT and packet drift before subject computation', () => {
  const runId = 'RUN-20260830-deadbeef';
  const worktree = fs.mkdtempSync(path.join(TMP, 'run-worktree-'));
  const run = { runId, packet: PACKET, worktree: { path: worktree } };
  const authority = {
    loadRun: (wanted) => { assert.strictEqual(wanted, runId); return run; },
    canonicalGitEnvironment: () => ({ ...process.env, GIT_WORK_TREE: worktree, GIT_DIR: '/fixed/git-dir' }),
  };
  const context = C.resolveRunContext({ runId, packet: PACKET }, authority);
  assert.strictEqual(context.runId, runId);
  assert.strictEqual(context.sourceRoot, fs.realpathSync(worktree));
  assert.notStrictEqual(context.sourceRoot, fs.realpathSync(ROOT),
    'the run silently resolved to the control checkout');

  const invocation = C.buildSubjectInvocation({ packet: PACKET }, context);
  assert.strictEqual(invocation.argv[invocation.argv.indexOf('--packet') + 1],
    fs.realpathSync(PACKET));
  assert.strictEqual(invocation.env.GIT_WORK_TREE, fs.realpathSync(worktree),
    'engineering-os would compute the ROOT subject instead of the run-worktree subject');

  const rootRun = { ...run, worktree: { path: ROOT } };
  assert.throws(() => C.resolveRunContext({ runId, packet: PACKET }, {
    loadRun: () => rootRun,
    canonicalGitEnvironment: () => ({ ...process.env, GIT_WORK_TREE: ROOT }),
  }), /did not resolve to one isolated canonical worktree/);

  const wrongPacket = path.join(TMP, 'wrong-run-packet.json');
  fs.writeFileSync(wrongPacket, '{}');
  assert.throws(() => C.resolveRunContext({ runId, packet: wrongPacket }, authority),
    /does not match.*canonical packet/);
});

test('the run coordinate changes the signed group plan and cross-run groups cannot aggregate', () => {
  const subject = { subjectPaths: SUBJECT.slice() };
  const sizes = Object.fromEntries(SUBJECT.map((reviewPath) => [reviewPath, 100]));
  const runA = 'RUN-20260830-aaaaaaaa';
  const runB = 'RUN-20260830-bbbbbbbb';
  const unitContext = { sourceRoot: ROOT, packetPath: null, gitEnv: null };
  const planA = C.planSubjectGroups(subject, { groups: 5, runId: runA }, sizes, unitContext);
  const planB = C.planSubjectGroups(subject, { groups: 5, runId: runB }, sizes, unitContext);
  assert.deepStrictEqual(planA.map((group) => group.paths), planB.map((group) => group.paths));
  assert.notDeepStrictEqual(planA.map((group) => group.groupDigest),
    planB.map((group) => group.groupDigest),
    'identical paths from two runs produced interchangeable signed group coordinates');

  const recordsFromA = planA.map((group) => groupRecord(group.groupId, group.paths, {
    group: { groupId: group.groupId, groupDigest: group.groupDigest },
  }));
  const binding = C.checkPlanBinding(recordsFromA, planB);
  assert.strictEqual(binding.ok, false);
  assert.ok(binding.problems.every((problem) => problem.code === 'GROUP-PLAN-DIGEST-MISMATCH'));
});

test('RED: an UNSIGNED group record is not smaller evidence — it is none', () => {
  const rec = groupRecord('G1', SUBJECT.slice(0, 3));
  const v = SIGN.verify(rec, { packetPath: PACKET });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'ATTESTATION-MISSING');
});

test('RED: a group bound to a STALE subject cannot join the aggregate', () => {
  const rec = sign(groupRecord('G1', SUBJECT.slice(0, 3), {
    reviewOf: { diffSha256: 'e'.repeat(64), changedPaths: SUBJECT.slice(0, 3) },
  }));
  assert.strictEqual(SIGN.verify(rec, { packetPath: PACKET }).ok, true, 'it is validly signed…');
  assert.notStrictEqual(rec.reviewOf.diffSha256, SUBJ_SHA, '…but bound to another revision');
});

test('RED: MIXED reviewer across groups is detectable', () => {
  const a = sign(groupRecord('G1', SUBJECT.slice(0, 3)));
  const b = sign(groupRecord('G2', SUBJECT.slice(3, 6), { reviewer: 'grok' }));
  const reviewers = [...new Set([a, b].map((r) => r.reviewer))];
  assert.strictEqual(reviewers.length, 2,
    '"Codex approved it" would be true of one group and false of the other');
});

test('RED: MIXED model across groups is detectable', () => {
  const a = sign(groupRecord('G1', SUBJECT.slice(0, 3)));
  const b = sign(groupRecord('G2', SUBJECT.slice(3, 6), { reviewerModel: 'codex-cli (other build)' }));
  assert.strictEqual([...new Set([a, b].map((r) => r.reviewerModel))].length, 2);
});

test('RED: a TIMED-OUT group is UNAVAILABLE and still attested', () => {
  // The 2026-08-25 failure wrote an UNSIGNED timeout record, which the gate saw
  // as malformed rather than as "the reviewer could not run". An UNAVAILABLE is
  // a real fact and gets the same integrity guarantee as an approval.
  const rec = sign(groupRecord('G3', SUBJECT.slice(6, 8), {
    disposition: 'UNAVAILABLE',
    unavailableReason: 'Codex CLI (ChatGPT.app) exceeded the 420s timeout',
    findings: [],
  }));
  assert.strictEqual(SIGN.verify(rec, { packetPath: PACKET }).ok, true,
    'a timeout record must be attested, not left unsigned');
  assert.strictEqual(rec.disposition, 'UNAVAILABLE');
  assert.ok(/timeout/i.test(rec.unavailableReason));
});

test('RED: a CONFLICTING verdict is carried into the aggregate, not averaged away', () => {
  const approve = sign(groupRecord('G1', SUBJECT.slice(0, 3)));
  const reject = sign(groupRecord('G2', SUBJECT.slice(3, 6), {
    disposition: 'REJECT',
    findings: [{ severity: 'HIGH', file: 'x.cjs', problem: 'p', evidence: 'e',
                 impact: 'i', requiredCorrection: 'c', verificationMethod: 'v', status: 'OPEN' }],
  }));
  const dispositions = [approve, reject].map((r) => r.disposition);
  const worst = dispositions.includes('REJECT') ? 'REJECT'
    : dispositions.includes('APPROVE_WITH_NOTES') ? 'APPROVE_WITH_NOTES' : 'APPROVE';
  assert.strictEqual(worst, 'REJECT',
    'one rejecting group must reject the whole aggregate — verdicts are not votes');
});

test('group-level unverified evidence is merged deterministically without hiding duplicates', () => {
  const groups = [
    groupRecord('G2', SUBJECT.slice(3, 6), { unverified: ['zeta', 'same limit'] }),
    groupRecord('G1', SUBJECT.slice(0, 3), { unverified: ['alpha', 'same limit'] }),
    groupRecord('G3', SUBJECT.slice(6), {}),
  ];
  const forward = C.mergeGroupUnverified(groups);
  const reverse = C.mergeGroupUnverified(groups.slice().reverse());
  assert.deepStrictEqual(forward, reverse, 'group file order changed aggregate evidence');
  assert.deepStrictEqual(forward.values, ['alpha', 'same limit', 'same limit', 'zeta']);
  assert.deepStrictEqual(forward.problems, []);
});

test('malformed group-level unverified evidence blocks aggregation rather than being dropped', () => {
  const merged = C.mergeGroupUnverified([
    groupRecord('G1', SUBJECT.slice(0, 3), { unverified: ['valid'] }),
    groupRecord('G2', SUBJECT.slice(3, 6), { unverified: ['valid', { hidden: true }] }),
  ]);
  assert.deepStrictEqual(merged.values, ['valid']);
  assert.strictEqual(merged.problems.length, 1);
  assert.strictEqual(merged.problems[0].code, 'GROUP-UNVERIFIED-MALFORMED');
});

test('RED: AGGREGATION TAMPERING — editing a group after aggregation is detected', () => {
  const g = sign(groupRecord('G1', SUBJECT.slice(0, 3), { disposition: 'REJECT' }));
  const embeddedDigest = g.attestation.payloadDigest;
  // Flip the group's verdict the way someone hiding a rejection would.
  g.disposition = 'APPROVE';
  const v = SIGN.verify(g, { packetPath: PACKET });
  assert.strictEqual(v.ok, false, 'a flipped group verdict must not verify');
  assert.strictEqual(v.code, 'ATTESTATION-PAYLOAD-DIGEST');
  // And the aggregate's embedded digest no longer describes the record on disk.
  const reSigned = SIGN.sign(g, { packetPath: PACKET });
  assert.notStrictEqual(reSigned.attestation.payloadDigest, embeddedDigest,
    'the embedded digest must change, so an aggregate cannot outlive its evidence');
});

test('RED: an aggregate cannot be assembled from groups that do not cover the subject', () => {
  const partial = [
    { groupId: 'G1', paths: SUBJECT.slice(0, 3) },
    { groupId: 'G2', paths: SUBJECT.slice(3, 6) },
  ];
  const cov = C.checkCoverage(partial, SUBJECT);
  assert.strictEqual(cov.ok, false, 'four uncovered paths must block the aggregate');
  assert.strictEqual(cov.code, 'COVERAGE-GAP');
});

test('group records live outside the directory the gate reads', () => {
  // Only the aggregate may reach the gate. A stray group record must never be
  // mistaken for a review of the whole change.
  const adapters = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  assert.ok(/subdir: args\.groupId \? 'groups' : null/.test(adapters),
    'group records must be written into reviews/groups/');
  const engos = fs.readFileSync(path.join(__dirname, '..', 'engineering-os.cjs'), 'utf8');
  assert.ok(/d\.isFile\(\)/.test(engos),
    'the gate must read only top-level review files, never subdirectories');
});

// ── 2026-08-25: the documented chunk command must actually be runnable ─────
// The chunker dropped --allow-metered / --approved-by / --cap-usd, so the
// published Grok command could never run: the adapter routes through
// routeRole(), which refuses METERED execution without a named human and a cap.
// The authorization existed and simply never arrived.
const GROUP = { groupId: 'G1', groupDigest: 'd'.repeat(64), paths: ['x.cjs', 'y.cjs'] };
const SUBJ = { subjectSha256: 'f'.repeat(64) };

test('RED: metered authorization is FORWARDED to the adapter', () => {
  const argv = C.buildGroupArgv(GROUP, SUBJ, {
    reviewer: 'grok', packet: 'P.json',
    allowMetered: true, approvedBy: 'Marc Papineau', capUsd: '5',
  });
  assert.ok(argv.includes('--allow-metered'), '--allow-metered was dropped');
  const ai = argv.indexOf('--approved-by');
  assert.ok(ai !== -1 && argv[ai + 1] === 'Marc Papineau', '--approved-by was dropped or mangled');
  const ci = argv.indexOf('--cap-usd');
  assert.ok(ci !== -1 && argv[ci + 1] === '5', '--cap-usd was dropped or mangled');
});

test('the exact canonical run-id is forwarded to every group adapter call', () => {
  const runId = 'RUN-20260830-deadbeef';
  const argv = C.buildGroupArgv(GROUP, SUBJ, {
    reviewer: 'codex', packet: 'P.json', runId,
  });
  assert.strictEqual(argv.filter((value) => value === '--run-id').length, 1);
  assert.strictEqual(argv[argv.indexOf('--run-id') + 1], runId);
  assert.throws(() => C.buildGroupArgv(GROUP, SUBJ, {
    reviewer: 'codex', packet: 'P.json', runId: 'RUN-../../escape',
  }), /not a canonical RUN/);
});

test('RED: the chunker INVENTS no optional authorization or telemetry ceiling when none was given', () => {
  const argv = C.buildGroupArgv(GROUP, SUBJ, { reviewer: 'grok', packet: 'P.json' });
  for (const f of ['--allow-metered', '--approved-by', '--cap-usd']) {
    assert.ok(!argv.includes(f), `${f} appeared without the operator supplying it`);
  }
});

test('RED: group binding survives the added flags', () => {
  const argv = C.buildGroupArgv(GROUP, SUBJ, {
    reviewer: 'grok', packet: 'P.json', allowMetered: true, approvedBy: 'M', capUsd: '2',
  });
  assert.strictEqual(argv[argv.indexOf('--group-id') + 1], 'G1');
  assert.strictEqual(argv[argv.indexOf('--subject-sha') + 1], SUBJ.subjectSha256);
  assert.strictEqual(argv.filter((x) => x === '--only-path').length, GROUP.paths.length);
});

test('RED: the executed argv IS the tested argv — no second builder', () => {
  // A duplicate argument list is how "declared but never enforced" happens.
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-chunker.cjs'), 'utf8');
  const builders = (src.match(/a\.push\('--allow-metered'\)/g) || []).length;
  assert.strictEqual(builders, 1, 'more than one place builds the adapter argv — they will drift');
  assert.ok(/const a = buildGroupArgv\(group, subject, args\)/.test(src),
    'runGroup must call buildGroupArgv rather than rebuilding the list');
});

// ── PROVEN DEFECT (2026-08-25): splitting ignored SIZE ────────────────────
// planGroups split the group with the most PATHS. Raising --groups from 5 to 12
// therefore split a twelve-file group of small tests over and over while six
// enormous source files stayed together at ~100KB — the one group that kept
// timing out was the one the splitter would never choose. A reviewer's context
// and turn budget are spent on bytes, so bytes are what must be balanced.
test('RED: the splitter targets the BYTE-heaviest group, not the path-heaviest', () => {
  const paths = ['a/many1.md', 'a/many2.md', 'a/many3.md', 'a/many4.md', 'b/huge.cjs', 'b/huge2.cjs'];
  const sizes = {
    'a/many1.md': 1000, 'a/many2.md': 1000, 'a/many3.md': 1000, 'a/many4.md': 1000,
    'b/huge.cjs': 55000, 'b/huge2.cjs': 55000,
  };
  const withSizes = C.planGroups(paths, 3, sizes);
  const weight = (g) => g.paths.reduce((n, p) => n + (sizes[p] || 0), 0);
  const heaviest = Math.max(...withSizes.map(weight));
  assert.ok(heaviest < 110000,
    `the two 55KB files stayed together (heaviest group ${heaviest}B) — size was ignored`);

  // And without sizes it must still work, just on counts.
  const noSizes = C.planGroups(paths, 3);
  assert.strictEqual(C.checkCoverage(noSizes, paths).ok, true, 'the count fallback must still cover');
});

test('RED: a size-aware split still covers the subject exactly', () => {
  const paths = ['x/a.cjs', 'x/b.cjs', 'x/c.cjs', 'y/d.md', 'y/e.md'];
  const sizes = { 'x/a.cjs': 50000, 'x/b.cjs': 400, 'x/c.cjs': 300, 'y/d.md': 200, 'y/e.md': 100 };
  for (const target of [2, 3, 4, 5]) {
    const g = C.planGroups(paths, target, sizes);
    const cov = C.checkCoverage(g, paths);
    assert.strictEqual(cov.ok, true, `target ${target}: ${cov.reason}`);
  }
});

test('size-aware planning stays deterministic', () => {
  const paths = ['x/a.cjs', 'x/b.cjs', 'y/c.md', 'y/d.md'];
  const sizes = { 'x/a.cjs': 9000, 'x/b.cjs': 100, 'y/c.md': 50, 'y/d.md': 40 };
  const a = C.planGroups(paths, 3, sizes);
  const b = C.planGroups(paths.slice().reverse(), 3, sizes);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b),
    'the same subject and sizes must always yield the same plan');
});

// ── GROK G9 FINDINGS #1 and #2 ────────────────────────────────────────────
test('RED #1: the DEFAULT plan splits oversize groups — the split path is reachable', () => {
  // 7 roles vs DEFAULT_GROUPS 5 meant only the MERGE branch ever ran, so the
  // byte-weight split worked at --groups 12 and did nothing at the default.
  assert.ok(C.ROLES.length >= C.DEFAULT_GROUPS,
    'this proof is only meaningful while roles outnumber the default target');
  const paths = ['a/x1.cjs', 'a/x2.cjs', 'b/y1.md', 'b/y2.md'];
  const sizes = { 'a/x1.cjs': 50000, 'a/x2.cjs': 50000, 'b/y1.md': 500, 'b/y2.md': 400 };
  const g = C.planGroups(paths, C.DEFAULT_GROUPS, sizes);
  const weight = (x) => x.paths.reduce((n, q) => n + (sizes[q] || 0), 0);
  for (const grp of g) {
    if (grp.paths.length < 2) continue;
    assert.ok(weight(grp) <= C.MAX_GROUP_BYTES,
      `group ${grp.groupId} is ${weight(grp)}B, over the ${C.MAX_GROUP_BYTES}B budget, at the DEFAULT target`);
  }
  assert.strictEqual(C.checkCoverage(g, paths).ok, true, 'the oversize split must preserve exact coverage');
});

test('RED #1b: a single oversize path receives a named refusal', () => {
  const paths = ['solo/huge.cjs'];
  const sizes = { 'solo/huge.cjs': 500000 };
  assert.throws(() => C.planGroups(paths, C.DEFAULT_GROUPS, sizes), (error) => {
    assert.strictEqual(error.code, 'REVIEW_GROUP_UNSPLITTABLE_OVERSIZE');
    assert.strictEqual(error.path, 'solo/huge.cjs');
    return true;
  });
});

test('RED: explicit cardinality cannot merge byte-safe groups back over the planning ceiling', () => {
  // Sixteen requested lanes over eighteen 40KB files first reaches sixteen,
  // then the preferred-size pass safely splits the remaining two-file groups.
  // The requested count is a minimum routing width, not permission to undo a
  // safety split merely to force an exact cardinality.
  const paths = Array.from({ length: 18 }, (_, i) =>
    `builder-control/test/cardinality-${String(i + 1).padStart(2, '0')}.test.cjs`);
  const sizes = Object.fromEntries(paths.map((p) => [p, 40000]));
  const adaptive = C.planGroups(paths, 16, sizes);
  assert.ok(adaptive.length > 16,
    'the fixture no longer proves that preferred-size splitting can add adaptive lanes');
  const g = C.planGroups(paths, 16, sizes, true);
  assert.strictEqual(g.length, adaptive.length,
    'an explicit count changed the deterministic size-aware production plan');
  assert.ok(g.every((group) => group.paths.length === 1 ||
    group.paths.reduce((sum, reviewPath) => sum + sizes[reviewPath], 0) <= C.MAX_GROUP_BYTES));
  assert.strictEqual(C.checkCoverage(g, paths).ok, true,
    'restoring exact cardinality lost or duplicated subject coverage');
  assert.deepStrictEqual(g.flatMap((group) => group.paths).sort(), paths.slice().sort());
});

test('RED #2: re-running a group ARCHIVES its predecessor rather than duplicating it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-chunker.cjs'), 'utf8');
  assert.ok(/superseded/.test(src) && /renameSync/.test(src),
    'a re-run must move the stale record aside, or aggregation sees two records for one group');
  assert.ok(!/unlinkSync/.test(src),
    'superseded evidence is archived, never deleted — discarding evidence to make a gate pass is the failure this system exists to prevent');
  assert.ok(/withFileTypes/.test(src),
    'aggregation must read only top-level files so the superseded attic is invisible to it');
});

test('RED: the oversize split never produces an EMPTY group', () => {
  // The cut index could reach src.length, leaving group B empty while A stayed
  // oversize — so the loop split again to the iteration guard. Observed: 69
  // groups, most empty. A split that does not reduce what it split is not a split.
  const paths = ['g/a.cjs', 'g/b.cjs', 'g/c.cjs', 'g/d.cjs'];
  const sizes = { 'g/a.cjs': 55000, 'g/b.cjs': 10000, 'g/c.cjs': 10000, 'g/d.cjs': 10000 };
  const g = C.planGroups(paths, 2, sizes);
  assert.ok(g.length <= 12, `runaway split produced ${g.length} groups`);
  for (const grp of g) assert.ok(grp.paths.length > 0, `${grp.groupId} is empty`);
  assert.strictEqual(C.checkCoverage(g, paths).ok, true, 'coverage must survive the oversize pass');
});

test('RED: a group that cannot be reduced below budget receives a named refusal', () => {
  // One path bigger than the budget is irreducible. It must never be silently
  // emitted as a runnable group that exceeds the review budget.
  const paths = ['solo/enormous.cjs', 'solo/small.md'];
  const sizes = { 'solo/enormous.cjs': 900000, 'solo/small.md': 50 };
  assert.throws(() => C.planGroups(paths, 2, sizes), (error) => {
    assert.strictEqual(error.code, 'REVIEW_GROUP_UNSPLITTABLE_OVERSIZE');
    assert.strictEqual(error.path, 'solo/enormous.cjs');
    return true;
  });
});

test('canonical untracked subject bytes are measured from the run source root', () => {
  const sourceRoot = fs.mkdtempSync(path.join(TMP, 'untracked-source-'));
  const bytes = Buffer.from('untracked-\u03c0-payload\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'new-file.cjs'), bytes);
  const sizes = C.pathSizes({
    subjectPaths: ['new-file.cjs'],
    untrackedSubjectPaths: ['new-file.cjs'],
  }, {}, { sourceRoot, gitEnv: null });
  assert.strictEqual(sizes['new-file.cjs'], bytes.length,
    'untracked bytes were omitted or measured as JavaScript characters');
});

test('pinned specifications and fixed checks are included in every group payload estimate', () => {
  const sourceRoot = fs.mkdtempSync(path.join(TMP, 'pinned-source-'));
  fs.mkdirSync(path.join(sourceRoot, 'specs'));
  fs.writeFileSync(path.join(sourceRoot, 'specs', 'a.md'), Buffer.alloc(41));
  fs.writeFileSync(path.join(sourceRoot, 'specs', 'b.md'), Buffer.alloc(59));
  const packetPath = path.join(sourceRoot, 'packet.json');
  fs.writeFileSync(packetPath, JSON.stringify({ sourceOfTruth: ['specs/a.md', 'specs/b.md', 'specs/a.md'] }));
  const overhead = C.fixedReviewOverheadBytes({}, { sourceRoot, packetPath });
  assert.strictEqual(overhead, C.FIXED_CHECK_OVERHEAD_BYTES + 100);

  const plan = C.planGroups(['one.cjs'], 1, { 'one.cjs': 123 }, { fixedOverheadBytes: overhead });
  assert.strictEqual(plan[0].changedBytes, 123);
  assert.strictEqual(plan[0].fixedOverheadBytes, overhead);
  assert.strictEqual(plan[0].estimatedReviewBytes, overhead + 123);
});

test('a single file that exceeds only the total payload ceiling receives the same named refusal', () => {
  const changedBytes = 10;
  const fixedOverheadBytes = C.MAX_GROUP_PAYLOAD_BYTES - changedBytes + 1;
  assert.throws(() => C.planGroups(['solo/small.cjs'], 1,
    { 'solo/small.cjs': changedBytes }, { fixedOverheadBytes }), (error) => {
    assert.strictEqual(error.code, 'REVIEW_GROUP_UNSPLITTABLE_OVERSIZE');
    assert.strictEqual(error.changedBytes, changedBytes);
    assert.strictEqual(error.totalBytes, C.MAX_GROUP_PAYLOAD_BYTES + 1);
    return true;
  });
});

// ── GROK G11 FINDINGS #2 and #3 ──────────────────────────────────────────
test('RED #2: a new aggregate archives only its same-reviewer exact-subject predecessor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-chunker.cjs'), 'utf8');
  assert.ok(/superseded-aggregates/.test(src),
    'a same-lane predecessor must be archived, or the gate sees two authorities from one reviewer');
  assert.ok(/selectAggregateRetention/.test(src),
    'aggregate archival must be selected by the tested reviewer+subject lane helper');
  assert.ok(!/record\.supersedes = supersedesId/.test(src),
    'an archived predecessor is not active, so the replacement must not point at an invisible target');
  assert.ok(/renameSync/.test(src) && !/unlinkSync\(full\)/.test(src),
    'predecessors are archived, never deleted — the audit trail keeps every version');
});

test('RED #3: stale group records from ANOTHER subject are archived, not blocking', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-chunker.cjs'), 'utf8');
  assert.ok(/other-subjects/.test(src), 'stale group records must be moved aside');
  assert.ok(/is not a problem with\s*\n?\s*\/\/ THIS one|not about it/.test(src),
    'evidence about a different subject is not a defect in this one');
  // The blocking calculation must ignore informational entries, or an archived
  // record still permanently blocks every future aggregate.
  assert.ok(/informational/.test(src), 'archival notices must be reported without blocking');
  assert.ok(/blocking\.length === 0/.test(src),
    'ok must be computed from BLOCKING problems only');
});

test('RED #3b: the archive preserves audit history rather than deleting it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-chunker.cjs'), 'utf8');
  const deletes = (src.match(/unlinkSync/g) || []).length;
  assert.strictEqual(deletes, 0,
    'no evidence path may delete a record — discarding evidence to clear a gate is the failure this system exists to prevent');
});

// ── 2026-08-25: group evidence isolation by exact subject hash and reviewer ─
// A rerun's "predecessor" and an aggregate's "lane" must be found by matching
// groupId, reviewer AND subject hash exactly — never by filename shape alone,
// which cannot tell one reviewer's G1 from another's, or this subject's G1
// from a prior subject's.
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const laneRecord = (reviewer, groupId, subjectSha, over = {}) => ({
  reviewer,
  group: { groupId, groupDigest: 'd'.repeat(64) },
  reviewOf: { diffSha256: subjectSha, changedPaths: [] },
  disposition: 'APPROVE',
  ...over,
});

test('RED: interleaved Codex/Grok records in the same group are distinct lanes', () => {
  const codexG1 = laneRecord('codex', 'G1', SHA_A);
  const grokG1 = laneRecord('grok', 'G1', SHA_A);
  const lane = { groupId: 'G1', reviewer: 'codex', subjectSha: SHA_A };
  assert.strictEqual(C.matchesLane(codexG1, lane), true, 'the exact lane must match');
  assert.strictEqual(C.matchesLane(grokG1, lane), false,
    'a Codex rerun of G1 must never archive Grok\'s G1 — same group, different reviewer');
});

test('RED: same-reviewer rerun isolation — a G1 rerun only matches G1, and only this subject', () => {
  const priorSameSubject = laneRecord('codex', 'G1', SHA_A);
  const priorOtherGroup = laneRecord('codex', 'G2', SHA_A);
  const lane = { groupId: 'G1', reviewer: 'codex', subjectSha: SHA_A };
  assert.strictEqual(C.matchesLane(priorSameSubject, lane), true);
  assert.strictEqual(C.matchesLane(priorOtherGroup, lane), false,
    'a G1 rerun must never sweep up G2 for the same reviewer and subject');
});

test('RED: other-subject isolation — a same-reviewer, same-group record from a prior subject never matches', () => {
  const priorSubject = laneRecord('codex', 'G1', SHA_B);
  const lane = { groupId: 'G1', reviewer: 'codex', subjectSha: SHA_A };
  assert.strictEqual(C.matchesLane(priorSubject, lane), false,
    'identical groupId and reviewer is not enough — the subject hash must also match exactly');
});

test('RED: a legacy record missing group/reviewer/subject fields never ambiguously matches a lane', () => {
  const lane = { groupId: 'G1', reviewer: 'codex', subjectSha: SHA_A };
  assert.strictEqual(C.matchesLane({ reviewer: 'codex', reviewOf: { diffSha256: SHA_A } }, lane), false,
    'no group.groupId at all must not be treated as "matches everything"');
  assert.strictEqual(C.matchesLane({ group: { groupId: 'G1' }, reviewOf: { diffSha256: SHA_A } }, lane), false,
    'no reviewer field must not be treated as "matches everything"');
  assert.strictEqual(C.matchesLane({ group: { groupId: 'G1' }, reviewer: 'codex' }, lane), false,
    'no subject binding at all must not be treated as "matches everything"');
});

test('RED: --aggregate --reviewer X loads only that reviewer\'s lane for the current subject', () => {
  const records = [
    laneRecord('codex', 'G1', SHA_A),
    laneRecord('codex', 'G2', SHA_A),
    laneRecord('grok', 'G1', SHA_A),   // same subject, other reviewer — must be excluded, not mixed
    laneRecord('codex', 'G1', SHA_B),  // other subject entirely — must be excluded
  ];
  const lane = C.selectAggregationLane(records, { subjectSha: SHA_A, reviewer: 'codex' });
  assert.strictEqual(lane.usable.length, 2, 'only the codex+subject-A records may load');
  assert.ok(lane.usable.every((r) => r.reviewer === 'codex' && r.reviewOf.diffSha256 === SHA_A));
  assert.strictEqual(lane.excludedReviewer.length, 1, 'the grok record is excluded as a reviewer mismatch');
  assert.strictEqual(lane.excludedReviewer[0].reviewer, 'grok');
  assert.strictEqual(lane.excludedSubject.length, 1, 'the other-subject record is excluded, not mixed in');
});

test('RED: with no --reviewer filter, selectAggregationLane preserves prior mixed-reviewer visibility', () => {
  const records = [laneRecord('codex', 'G1', SHA_A), laneRecord('grok', 'G2', SHA_A)];
  const lane = C.selectAggregationLane(records, { subjectSha: SHA_A, reviewer: null });
  assert.strictEqual(lane.usable.length, 2,
    'without a --reviewer filter, both lanes still load so GROUP-MIXED-REVIEWER can be detected downstream');
});

const aggregateRecord = (reviewer, subjectSha, id) => ({
  reviewId: id,
  reviewer,
  reviewOf: { diffSha256: subjectSha, changedPaths: SUBJECT.slice() },
  aggregate: { groupCount: 1, groups: [], coverage: 'EXACT' },
});

function publishAggregate(active, rec) {
  const retention = C.selectAggregateRetention(active, {
    reviewer: rec.rec.reviewer,
    subjectSha: rec.rec.reviewOf.diffSha256,
  });
  return { active: [...retention.preserved, rec], archived: retention.superseded };
}

test('RED: Codex then Grok leaves both exact-subject aggregates top-level discoverable', () => {
  const codex = { file: 'codex-aggregate.json', rec: aggregateRecord('codex', SHA_A, 'REV-codex-a') };
  const grok = { file: 'grok-aggregate.json', rec: aggregateRecord('grok', SHA_A, 'REV-grok-a') };
  let published = publishAggregate([], codex);
  published = publishAggregate(published.active, grok);
  assert.deepStrictEqual(published.active.map((item) => item.rec.reviewer).sort(), ['codex', 'grok']);
  assert.strictEqual(published.archived.length, 0,
    'publishing Grok must not archive Codex for the same subject');
});

test('RED: Grok then Codex leaves both exact-subject aggregates top-level discoverable', () => {
  const codex = { file: 'codex-aggregate.json', rec: aggregateRecord('codex', SHA_A, 'REV-codex-a') };
  const grok = { file: 'grok-aggregate.json', rec: aggregateRecord('grok', SHA_A, 'REV-grok-a') };
  let published = publishAggregate([], grok);
  published = publishAggregate(published.active, codex);
  assert.deepStrictEqual(published.active.map((item) => item.rec.reviewer).sort(), ['codex', 'grok']);
  assert.strictEqual(published.archived.length, 0,
    'publishing Codex must not archive Grok for the same subject');
});

test('RED: a same-reviewer rerun archives exactly its own exact-subject predecessor', () => {
  const codexOld = { file: 'codex-old-aggregate.json', rec: aggregateRecord('codex', SHA_A, 'REV-codex-old') };
  const codexNew = { file: 'codex-new-aggregate.json', rec: aggregateRecord('codex', SHA_A, 'REV-codex-new') };
  const grok = { file: 'grok-aggregate.json', rec: aggregateRecord('grok', SHA_A, 'REV-grok-a') };
  const otherSubject = { file: 'codex-other-aggregate.json', rec: aggregateRecord('codex', SHA_B, 'REV-codex-b') };
  const published = publishAggregate([codexOld, grok, otherSubject], codexNew);
  assert.deepStrictEqual(published.archived.map((item) => item.file), ['codex-old-aggregate.json']);
  assert.deepStrictEqual(published.active.map((item) => item.file).sort(),
    ['codex-new-aggregate.json', 'codex-other-aggregate.json', 'grok-aggregate.json']);
});

test('RED: malformed aggregate evidence is never guessed into an archival lane', () => {
  const malformed = { file: 'unreadable-aggregate.json', rec: null };
  const result = C.selectAggregateRetention([malformed], { reviewer: 'codex', subjectSha: SHA_A });
  assert.deepStrictEqual(result.superseded, []);
  assert.deepStrictEqual(result.preserved, [malformed],
    'unattributable evidence must stay visible so the canonical gate fails closed');
});

test('RED: aggregate records must bind exactly to every deterministic planned group', () => {
  const plan = C.planGroups(SUBJECT, 3);
  const records = plan.map((group, index) => ({
    reviewId: `REV-${index}`,
    group: { groupId: group.groupId, groupDigest: group.groupDigest },
    reviewOf: { changedPaths: group.paths.slice() },
  }));
  assert.deepStrictEqual(C.checkPlanBinding(records, plan), { ok: true, problems: [] });

  const wrongDigest = JSON.parse(JSON.stringify(records));
  wrongDigest[0].group.groupDigest = '0'.repeat(64);
  assert.ok(C.checkPlanBinding(wrongDigest, plan).problems.some((p) => p.code === 'GROUP-PLAN-DIGEST-MISMATCH'));
  const wrongPaths = JSON.parse(JSON.stringify(records));
  wrongPaths[0].reviewOf.changedPaths = [];
  assert.ok(C.checkPlanBinding(wrongPaths, plan).problems.some((p) => p.code === 'GROUP-PLAN-PATH-MISMATCH'));
  assert.ok(C.checkPlanBinding(records.slice(1), plan).problems.some((p) => p.code === 'GROUP-PLAN-MISSING'));
  assert.ok(C.checkPlanBinding([...records, records[0]], plan).problems.some((p) => p.code === 'GROUP-PLAN-DUPLICATE'));
});

test('RED: operator-only aggregate flags are omitted from the signed schema projection', () => {
  assert.deepStrictEqual(C.schemaAggregateProblems([
    { code: 'GROUPS-EXCLUDED-OTHER-REVIEWER', detail: 'one excluded', informational: true },
    { code: 'GROUP-UNSIGNED', detail: 'bad signature' },
  ]), [
    { code: 'GROUPS-EXCLUDED-OTHER-REVIEWER', detail: 'one excluded' },
    { code: 'GROUP-UNSIGNED', detail: 'bad signature' },
  ]);
});

test('RED: aggregate publication requires an explicit supported reviewer', () => {
  assert.throws(() => C.normalizeAggregateReviewer(), /--reviewer is required/);
  assert.throws(() => C.normalizeAggregateReviewer('other'), /unsupported aggregate reviewer/);
  assert.strictEqual(C.normalizeAggregateReviewer('codex'), 'codex');
  assert.strictEqual(C.normalizeAggregateReviewer('grok'), 'grok');
});

test('RED: signed aggregate replacement publishes before archiving its predecessor', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-aggregate-publication-'));
  try {
    const predecessor = 'codex-old.json';
    fs.writeFileSync(path.join(root, predecessor), '{"old":true}\n');
    const signed = { reviewId: 'REV-new', signature: { algorithm: 'fixture' } };
    const publication = C.publishAggregateReplacement({
      reviewsDir: root, filename: 'codex-new.json', signed,
      predecessors: [{ file: predecessor }],
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(publication.outPath, 'utf8')), signed);
    assert.strictEqual(fs.existsSync(path.join(root, predecessor)), false);
    assert.strictEqual(fs.existsSync(path.join(root, 'superseded-aggregates', predecessor)), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RED: a failed replacement publication leaves the predecessor active', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-aggregate-publication-fail-'));
  try {
    const predecessor = 'codex-old.json';
    fs.writeFileSync(path.join(root, predecessor), '{"old":true}\n');
    fs.mkdirSync(path.join(root, 'blocked-target.json'));
    assert.throws(() => C.publishAggregateReplacement({
      reviewsDir: root, filename: 'blocked-target.json', signed: { reviewId: 'REV-new' },
      predecessors: [{ file: predecessor }],
    }));
    assert.strictEqual(fs.existsSync(path.join(root, predecessor)), true,
      'publication failure archived the only active predecessor');
    assert.strictEqual(fs.existsSync(path.join(root, 'superseded-aggregates', predecessor)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RED: a verified group replacement is active before predecessors retire', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-group-replacement-'));
  try {
    fs.writeFileSync(path.join(root, 'old.json'), '{"old":true}\n');
    fs.writeFileSync(path.join(root, 'new.json'), '{"new":true}\n');
    const result = C.publishGroupReplacement({ groupsDir: root, replacement: 'new.json', predecessors: ['old.json'] });
    assert.deepStrictEqual(result.archived, ['old.json']);
    assert.strictEqual(fs.existsSync(path.join(root, 'new.json')), true);
    assert.strictEqual(fs.existsSync(path.join(root, 'old.json')), false);
    assert.strictEqual(fs.existsSync(path.join(root, 'superseded', 'old.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RED: interleaved cross-reviewer records are partitioned and only the caller lane is quarantined', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-group-lane-race-'));
  const subjectSha = 'a'.repeat(64);
  try {
    const codex = 'codex-new.json';
    const grok = 'grok-new.json';
    fs.writeFileSync(path.join(root, codex), JSON.stringify({
      reviewer: 'codex', group: { groupId: 'G1' }, reviewOf: { diffSha256: subjectSha },
    }));
    fs.writeFileSync(path.join(root, grok), JSON.stringify({
      reviewer: 'grok', group: { groupId: 'G1' }, reviewOf: { diffSha256: subjectSha },
    }));

    const partition = C.partitionCreatedLaneRecords({
      groupsDir: root,
      names: [grok, codex],
      lane: { reviewer: 'codex', groupId: 'G1', subjectSha },
    });
    assert.deepStrictEqual(partition.owned, [codex]);
    assert.deepStrictEqual(partition.foreign, [grok]);

    C.quarantineCreatedLaneRecords({ groupsDir: root, names: partition.owned });
    assert.strictEqual(fs.existsSync(path.join(root, codex)), false);
    assert.strictEqual(fs.existsSync(path.join(root, 'failed-reruns', codex)), true);
    assert.strictEqual(fs.existsSync(path.join(root, grok)), true,
      'Codex failure moved the concurrently published Grok record');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RED: a group archival failure restores every predecessor and quarantines replacement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-group-replacement-fail-'));
  try {
    for (const name of ['old-a.json', 'old-b.json', 'new.json']) fs.writeFileSync(path.join(root, name), '{}\n');
    fs.mkdirSync(path.join(root, 'superseded'), { recursive: true });
    fs.mkdirSync(path.join(root, 'superseded', 'old-b.json'));
    assert.throws(() => C.publishGroupReplacement({
      groupsDir: root, replacement: 'new.json', predecessors: ['old-a.json', 'old-b.json'],
    }));
    assert.strictEqual(fs.existsSync(path.join(root, 'old-a.json')), true);
    assert.strictEqual(fs.existsSync(path.join(root, 'old-b.json')), true);
    assert.strictEqual(fs.existsSync(path.join(root, 'new.json')), false);
    assert.strictEqual(fs.existsSync(path.join(root, 'publication-failures', 'new.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failed} failed.`);
