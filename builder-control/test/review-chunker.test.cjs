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

test('RED: AGGREGATION TAMPERING — editing a group after aggregation is detected', () => {
  const g = sign(groupRecord('G1', SUBJECT.slice(0, 3), { disposition: 'REJECT' }));
  const embeddedDigest = g.attestation.payloadDigest;
  // Flip the group's verdict the way someone hiding a rejection would.
  g.disposition = 'APPROVE';
  const v = SIGN.verify(g, { packetPath: PACKET });
  assert.strictEqual(v.ok, false, 'a flipped group verdict must not verify');
  assert.strictEqual(v.code, 'ATTESTATION-INVALID');
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

test('RED: the chunker INVENTS no authorization when none was given', () => {
  const argv = C.buildGroupArgv(GROUP, SUBJ, { reviewer: 'grok', packet: 'P.json' });
  for (const f of ['--allow-metered', '--approved-by', '--cap-usd']) {
    assert.ok(!argv.includes(f), `${f} appeared without the operator supplying it`);
  }
  // The adapter must then refuse — which is the correct outcome, not a bug.
  const r = require('../tool-router.cjs').routeRole('adversarial-review', {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'METERED_UNAUTHORIZED');
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
    'b/huge.cjs': 90000, 'b/huge2.cjs': 90000,
  };
  const withSizes = C.planGroups(paths, 3, sizes);
  const weight = (g) => g.paths.reduce((n, p) => n + (sizes[p] || 0), 0);
  const heaviest = Math.max(...withSizes.map(weight));
  assert.ok(heaviest < 180000,
    `the two 90KB files stayed together (heaviest group ${heaviest}B) — size was ignored`);

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
  const sizes = { 'a/x1.cjs': 90000, 'a/x2.cjs': 90000, 'b/y1.md': 500, 'b/y2.md': 400 };
  const g = C.planGroups(paths, C.DEFAULT_GROUPS, sizes);
  const weight = (x) => x.paths.reduce((n, q) => n + (sizes[q] || 0), 0);
  for (const grp of g) {
    if (grp.paths.length < 2) continue;
    assert.ok(weight(grp) <= C.MAX_GROUP_BYTES,
      `group ${grp.groupId} is ${weight(grp)}B, over the ${C.MAX_GROUP_BYTES}B budget, at the DEFAULT target`);
  }
  assert.strictEqual(C.checkCoverage(g, paths).ok, true, 'the oversize split must preserve exact coverage');
});

test('RED #1b: a single oversize path is not split into nothing', () => {
  const paths = ['solo/huge.cjs'];
  const sizes = { 'solo/huge.cjs': 500000 };
  const g = C.planGroups(paths, C.DEFAULT_GROUPS, sizes);
  assert.strictEqual(g.length, 1, 'one path cannot become two groups');
  assert.strictEqual(C.checkCoverage(g, paths).ok, true);
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
  const sizes = { 'g/a.cjs': 200000, 'g/b.cjs': 100, 'g/c.cjs': 100, 'g/d.cjs': 100 };
  const g = C.planGroups(paths, 2, sizes);
  assert.ok(g.length <= 12, `runaway split produced ${g.length} groups`);
  for (const grp of g) assert.ok(grp.paths.length > 0, `${grp.groupId} is empty`);
  assert.strictEqual(C.checkCoverage(g, paths).ok, true, 'coverage must survive the oversize pass');
});

test('RED: a group that cannot be reduced below budget is left intact, not split forever', () => {
  // One path bigger than the budget is irreducible. It must stay one group.
  const paths = ['solo/enormous.cjs', 'solo/small.md'];
  const sizes = { 'solo/enormous.cjs': 900000, 'solo/small.md': 50 };
  const g = C.planGroups(paths, 2, sizes);
  assert.ok(g.length <= 4, `irreducible group split ${g.length} times`);
  assert.strictEqual(C.checkCoverage(g, paths).ok, true);
  const singles = g.filter((x) => x.paths.length === 1 && x.paths[0] === 'solo/enormous.cjs');
  assert.strictEqual(singles.length, 1, 'the oversize single path must end up alone, exactly once');
});

// ── GROK G11 FINDINGS #2 and #3 ──────────────────────────────────────────
test('RED #2: a new aggregate SUPERSEDES and archives its predecessors', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-chunker.cjs'), 'utf8');
  assert.ok(/superseded-aggregates/.test(src),
    'prior aggregates must be archived, or the gate sees two authorities for one subject');
  assert.ok(/record\.supersedes = supersedesId/.test(src),
    'supersession must be an explicit signed claim, not an inference from file order');
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

const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failed} failed.`);
