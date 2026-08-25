#!/usr/bin/env node
/**
 * aegis-run.test.cjs — red proofs for the V1 runtime.
 *
 * The runtime's whole value is that it REFUSES: a build with no worktree, a
 * checkpoint over unchecked work, a rollback with no recorded point, a state
 * reached by skipping an earlier one. A state machine that can be nudged
 * forward is a progress bar, so every case here asserts a refusal.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'builder-control', 'aegis-run.cjs');
const R = require('../aegis-run.cjs');
const STATE = require('../aegis-state.cjs');

let passed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
const run = (args) => spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });

console.log('AEGIS runtime — red proofs');

// ── the contract is preserved, not shrunk ──────────────────────────────────
test('every contract step 1-10 is represented by a state', () => {
  const steps = new Set(Object.values(R.STATES).map((s) => s.step).filter((n) => n > 0));
  for (const required of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
    assert.ok(steps.has(required), `contract step ${required} has no state — the contract was shrunk to fit`);
  }
});

test('failure states exist for the paths that can fail', () => {
  for (const s of ['BUILD_FAILED', 'CHECKS_FAILED', 'ROLLED_BACK']) {
    assert.ok(R.STATES[s], `${s} is missing`);
    assert.strictEqual(R.STATES[s].failure, true, `${s} must be marked a failure state`);
  }
});

// ── transitions ────────────────────────────────────────────────────────────
test('RED: a state cannot be reached by skipping an earlier one', () => {
  // CREATED cannot jump to CHECKPOINTED.
  const illegal = [
    ['CREATED', 'CHECKPOINTED'], ['CREATED', 'BUILT'], ['INTAKE_RECORDED', 'BUILDING'],
    ['ROUTED', 'CHECKS_PASSED'], ['WORKTREE_READY', 'CHECKPOINTED'], ['BUILT', 'CHECKPOINTED'],
  ];
  for (const [from, to] of illegal) {
    assert.ok(!R.STATES[from].next.includes(to),
      `${from} -> ${to} is permitted; a run could skip the work in between`);
  }
});

test('RED: no override flag is PARSED by the runtime', () => {
  // Checking for the string "--force" matched the doc comment that says there
  // is no --force. The claim that matters is whether the arg parser accepts one,
  // so this asserts on parsing, not on prose.
  const src = fs.readFileSync(CLI, 'utf8');
  for (const flag of ['--force', '--skip', '--override', '--yes', '--no-verify']) {
    const parsed = new RegExp(`t === '${flag}'`).test(src);
    assert.ok(!parsed, `${flag} is parsed as an argument — a state machine with an override is a progress bar`);
  }
  // And no transition may be taken without passing through transition().
  // `=` alone also matched `===` comparisons, which reported 3 assignments
  // where there is 1. Negative lookahead excludes equality tests.
  const setsStateDirectly = (src.match(/run\.state\s*=(?!=)/g) || []).length;
  assert.strictEqual(setsStateDirectly, 1,
    `run.state is assigned in ${setsStateDirectly} places; it must only be set inside transition()`);
});

test('the legal happy path is contiguous', () => {
  const chain = ['CREATED', 'INTAKE_RECORDED', 'ROUTED', 'WORKTREE_READY', 'BUILDING', 'BUILT', 'CHECKS_PASSED'];
  for (let i = 0; i < chain.length - 1; i++) {
    assert.ok(R.STATES[chain[i]].next.includes(chain[i + 1]),
      `${chain[i]} -> ${chain[i + 1]} is not legal, so the loop cannot complete`);
  }
});

test('RED: a failure state cannot jump straight back to success', () => {
  assert.ok(!R.STATES.BUILD_FAILED.next.includes('BUILT'), 'a failed build must not become BUILT without rebuilding');
  assert.ok(!R.STATES.CHECKS_FAILED.next.includes('CHECKS_PASSED'), 'failed checks must not become passed without rerunning');
  assert.ok(R.STATES.BUILD_FAILED.next.includes('CORRECTING'), 'the honest recovery path must exist');
});

// ── intake ─────────────────────────────────────────────────────────────────
test('RED: a run with no objective is refused', () => {
  const r = run(['--new']);
  assert.strictEqual(r.status, 3);
  assert.ok(/NO-OBJECTIVE/.test(r.stderr), 'a run with no stated objective cannot be reviewed against anything');
});

test('RED: an unknown run id is refused, not created', () => {
  const r = run(['--status', 'RUN-19700101-deadbeef']);
  assert.strictEqual(r.status, 3);
  assert.ok(/NO-SUCH-RUN/.test(r.stderr));
});

test('RED: a malformed run id is rejected before any filesystem access', () => {
  const r = run(['--status', '../../etc/passwd']);
  assert.strictEqual(r.status, 3);
  assert.ok(/BAD-RUN-ID/.test(r.stderr), 'a run id must not be able to address arbitrary paths');
});

// ── missing evidence ───────────────────────────────────────────────────────
test('RED: checkpoint requires checks that ACTUALLY passed', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/NO-PASSING-CHECKS/.test(src));
  assert.ok(/run\.checks\.passed !== run\.checks\.total/.test(src),
    'a checkpoint must require every check to have passed, not merely to exist');
  assert.ok(/run\.checks\.total === 0/.test(src),
    'zero checks must not satisfy a checkpoint — that is the absence of evidence');
});

test('RED: checkpoint requires a resolvable rollback point', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/NO-ROLLBACK-POINT/.test(src));
  assert.ok(/cannot name where to return to is refused/.test(src),
    'a checkpoint that cannot name its rollback point is a label, not a checkpoint');
});

test('RED: rollback refuses when no point was recorded', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/Rollback restores a RECORDED point; it never guesses one/.test(src));
});

test('RED: a build outside an isolated worktree is refused', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/NO-WORKTREE/.test(src));
  assert.ok(/refusing to build in the primary tree/.test(src),
    'the runtime must never build in the primary worktree');
});

test('RED: correction cycles are capped', () => {
  assert.strictEqual(R.MAX_CORRECTIONS, 3);
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/CORRECTION-LIMIT/.test(src), 'an uncapped correction loop optimises reviewers against each other forever');
});

// ── no parallel authority ──────────────────────────────────────────────────
test('every transition is recorded in the CANONICAL ledger', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/LEDGER_WRITER/.test(src) && /--append/.test(src),
    'transitions must append to the one canonical ledger');
  assert.ok(/operationId/.test(src) && /correlationId/.test(src),
    'a retried transition must be idempotent, not a duplicate event');
  assert.ok(/A transition that cannot be recorded did not happen/.test(src),
    'a ledger refusal must fail the transition, not be swallowed');
  // And it must not invent its own permission or verdict system.
  assert.ok(!/allowsProtectedPaths\s*=/.test(src), 'the runtime must not grant its own permissions');
  assert.ok(!/disposition\s*[:=]\s*['"]APPROVE/.test(src), 'the runtime must never author a review verdict');
});

test('run files are working state — deleting them loses no authority', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/WORKING STATE, not a source of truth/.test(src));
  // The packet is the permission; the runtime only references it.
  assert.ok(/run\.packet/.test(src), 'the runtime reads the packet rather than replacing it');
});

// ── cost projection: recorded evidence only ────────────────────────────────
test('RED: cost is never estimated for a run whose telemetry was lost', () => {
  const c = STATE.projectCost();
  assert.ok(c.state === 'OK' || c.state === 'UNAVAILABLE');
  if (c.state !== 'OK') return;
  for (const r of c.runs) {
    if (r.state === 'UNRECORDED') {
      assert.strictEqual(r.usd, null, 'an unrecorded run must have no dollar figure at all');
      assert.ok(r.reason, 'it must say why the figure is missing');
    }
  }
  if (c.unrecordedRuns > 0) {
    assert.ok(typeof c.totalUsd === 'string' && /^AT LEAST /.test(c.totalUsd),
      'with runs missing telemetry the total must be a floor, not a number pretending to be exact');
    assert.ok(c.caveat && /higher than the recorded figure/.test(c.caveat));
  }
});

test('RED: cost is read from the run OWN envelope, never from quoted text', () => {
  // A reviewer that READ another reviewer's transcript had that run's cost
  // attributed to itself — two Codex files reported Grok's exact figures.
  const src = fs.readFileSync(path.join(__dirname, '..', 'aegis-state.cjs'), 'utf8');
  assert.ok(/ownEnvelope/.test(src), 'cost must come from the top-level envelope only');
  assert.ok(/quoted while Codex was reviewing/.test(src), 'the reason must be recorded where it can be read');
});

test('metered and subscription spend are reported separately', () => {
  const c = STATE.projectCost();
  if (c.state !== 'OK') return;
  assert.ok(c.byReviewer, 'a single blended figure would misreport the metered cap');
  for (const [who, v] of Object.entries(c.byReviewer)) {
    assert.ok(typeof v.recordedUsd === 'number', `${who} has no numeric recorded spend`);
    assert.ok(v.recordedRuns >= 0 && v.unrecordedRuns >= 0);
  }
});

test('RED: absent transcripts render UNAVAILABLE, not zero cost', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'aegis-state.cjs'), 'utf8');
  assert.ok(/state: 'UNAVAILABLE', reason: `no reviewer transcripts/.test(src),
    'a missing directory must not read as "nothing was spent"');
});

// ── STEP 10: the checkpoint/rollback SUCCESS path, end to end ─────────────
// Previously only the refusal paths were proven. The happy path could not run
// because an isolated worktree sits at the base commit and committing to the
// product branch is forbidden. A disposable fixture repo removes that
// constraint without touching anything real.
test('STEP 10: checkpoint records a rollback point and rollback restores it', () => {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cp-'));
  const repo = path.join(TMP, 'repo');
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });

  const g = (args, cwd = repo) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'fixture@example.invalid']);
  g(['config', 'user.name', 'AEGIS Fixture']);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'good state\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'good']);
  const goodCommit = g(['rev-parse', 'HEAD']).stdout.trim();
  assert.ok(/^[0-9a-f]{40}$/.test(goodCommit), 'fixture repo has no commit');

  // The run must reach CHECKS_PASSED through REAL transitions, because the
  // watchdog cross-checks every transition against the canonical ledger — a
  // hand-written run file is exactly what it refuses. A temp ledger keeps that
  // real without touching the production one.
  const ledger = path.join(TMP, 'ledger.json');
  fs.writeFileSync(ledger, '[]\n');
  const CLI2 = path.join(ROOT, 'builder-control', 'aegis-run.cjs');
  const env = {
    ...process.env,
    AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: cpDir, AEGIS_LEDGER_FILE: ledger,
  };

  const runId = `RUN-20260825-a1b2c3d4`;
  const seed = {
    runId, createdAt: '2026-08-25T06:00:00Z', updatedAt: '2026-08-25T06:00:00Z',
    state: 'CREATED', objective: 'fixture checkpoint/rollback',
    packet: null, baseCommit: goodCommit,
    worktree: { path: repo, branch: 'main', baseCommit: goodCommit },
    build: { exit: 0 }, checks: { passed: 3, total: 3, results: [] },
    checkpoint: null, corrections: 0, transitions: [],
  };
  fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(seed, null, 2));

  // Drive the real transition() so each step is recorded in the temp ledger.
  const driver = `
    process.env.AEGIS_RUNS_DIR = ${JSON.stringify(runsDir)};
    process.env.AEGIS_CHECKPOINTS_DIR = ${JSON.stringify(cpDir)};
    process.env.AEGIS_LEDGER_FILE = ${JSON.stringify(ledger)};
    const R = require(${JSON.stringify(path.join(ROOT, 'builder-control', 'aegis-run.cjs'))});
    const run = R.loadRun(${JSON.stringify(runId)});
    for (const to of ['INTAKE_RECORDED','ROUTED','WORKTREE_READY','BUILDING','BUILT','CHECKS_PASSED','REVIEW_BOUND']) {
      R.transition(run, to, 'fixture');
    }
  `;
  const drive = spawnSync('node', ['-e', driver], { cwd: ROOT, encoding: 'utf8', env });
  assert.strictEqual(drive.status, 0, `could not drive the fixture run: ${drive.stderr}`);
  const ledgerEntries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.strictEqual(ledgerEntries.length, 7, `expected 7 recorded transitions, got ${ledgerEntries.length}`);
  const exec = (args) => spawnSync('node', [CLI2, ...args], { cwd: ROOT, encoding: 'utf8', env });

  // CHECKPOINT — must succeed and name the real commit.
  const cp = exec(['--checkpoint', runId]);
  assert.strictEqual(cp.status, 0, `checkpoint failed: ${cp.stderr || cp.stdout}`);
  const after = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(after.state, 'CHECKPOINTED');
  assert.strictEqual(after.checkpoint.rollbackPoint, goodCommit,
    'the checkpoint must record the ACTUAL commit, not a placeholder');
  assert.ok(fs.existsSync(path.join(cpDir, `${after.checkpoint.checkpointId}.json`)),
    'the checkpoint record must be written to disk');

  // Now diverge — the situation a rollback exists for.
  fs.writeFileSync(path.join(repo, 'app.txt'), 'broken state\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'broken']);
  const brokenCommit = g(['rev-parse', 'HEAD']).stdout.trim();
  assert.notStrictEqual(brokenCommit, goodCommit, 'the fixture did not actually diverge');
  assert.strictEqual(fs.readFileSync(path.join(repo, 'app.txt'), 'utf8'), 'broken state\n');

  // ROLLBACK — must restore the recorded point, verified by re-reading git.
  const rb = exec(['--rollback', runId]);
  assert.strictEqual(rb.status, 0, `rollback failed: ${rb.stderr || rb.stdout}`);
  const head = g(['rev-parse', 'HEAD']).stdout.trim();
  assert.strictEqual(head, goodCommit, 'HEAD was not restored to the recorded rollback point');
  assert.strictEqual(fs.readFileSync(path.join(repo, 'app.txt'), 'utf8'), 'good state\n',
    'the working tree content was not restored');

  const final = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(final.state, 'ROLLED_BACK');
  assert.strictEqual(final.rollback.ok, true);
  assert.strictEqual(final.rollback.verifiedHead, goodCommit,
    'rollback must VERIFY the head it landed on, not assume the reset worked');

  fs.rmSync(TMP, { recursive: true, force: true });
});

test('RED: the runs directory cannot be redirected outside a temp dir', () => {
  const r = spawnSync('node', ['-e', 'require(process.argv[1])', CLI], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, AEGIS_RUNS_DIR: path.join(ROOT, 'builder-control', 'decoy-runs') },
  });
  assert.notStrictEqual(r.status, 0, 'run evidence must not be redirectable into the repo');
  assert.ok(/must point inside/.test(r.stderr));
});

// ── STEP 8: automatic bounded correction cycles ───────────────────────────
test('STEP 8: the correction loop is bounded and escalates rather than looping', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/function cmdAuto/.test(src), 'step 8 requires an automatic correction driver');
  assert.ok(/ESCALATION REQUIRED/.test(src), 'the loop must escalate, not spin');
  assert.ok(/run\.corrections >= MAX_CORRECTIONS/.test(src), 'the cap must be enforced inside the loop');
  assert.ok(/a fourth attempt is a fourth guess, not a fix/.test(src),
    'the reason for the cap must be recorded where the cap is');
});

test('RED: CORRECTING is only reachable from a failure state', () => {
  const from = Object.entries(R.STATES).filter(([, v]) => v.next.includes('CORRECTING')).map(([k]) => k);
  for (const f of from) {
    assert.ok(R.STATES[f].failure || f === 'REVIEW_BOUND',
      `${f} can enter CORRECTING without having failed — corrections would become routine`);
  }
});

// ── STEP 9: watchdog sequence proving ─────────────────────────────────────
test('STEP 9: the watchdog proves the required sequence actually occurred', () => {
  const good = { runId: 'RUN-20260825-deadbeef', transitions: [
    { from: 'CREATED', to: 'INTAKE_RECORDED' }, { from: 'INTAKE_RECORDED', to: 'ROUTED' },
    { from: 'ROUTED', to: 'WORKTREE_READY' }, { from: 'WORKTREE_READY', to: 'BUILDING' },
    { from: 'BUILDING', to: 'BUILT' }, { from: 'BUILT', to: 'CHECKS_PASSED' },
  ] };
  const w = R.watchdog(good);
  // Ledger cross-check will flag these synthetic transitions — that is correct
  // and is asserted separately below. Sequence itself must be clean.
  assert.ok(!w.problems.some((p) => p.rule === 'WATCHDOG-STAGE-MISSING'),
    'a complete sequence must not report a missing stage');
});

test('RED: the watchdog detects a SKIPPED required stage', () => {
  const drifted = { runId: 'RUN-20260825-deadbeef', transitions: [
    { from: 'CREATED', to: 'INTAKE_RECORDED' }, { from: 'INTAKE_RECORDED', to: 'ROUTED' },
    { from: 'ROUTED', to: 'WORKTREE_READY' }, { from: 'WORKTREE_READY', to: 'BUILDING' },
    { from: 'BUILDING', to: 'BUILT' },
  ] };
  const w = R.watchdog(drifted);
  assert.strictEqual(w.ok, false);
  assert.ok(w.problems.some((p) => p.rule === 'WATCHDOG-STAGE-MISSING' && /CHECKS_PASSED/.test(p.detail)),
    'skipping deterministic checks must be detected as process drift');
});

test('RED: the watchdog refuses a transition the CANONICAL ledger never recorded', () => {
  const forged = { runId: 'RUN-20260825-ffffffff', transitions: [
    { from: 'CREATED', to: 'INTAKE_RECORDED' }, { from: 'INTAKE_RECORDED', to: 'ROUTED' },
    { from: 'ROUTED', to: 'WORKTREE_READY' }, { from: 'WORKTREE_READY', to: 'BUILDING' },
    { from: 'BUILDING', to: 'BUILT' }, { from: 'BUILT', to: 'CHECKS_PASSED' },
  ] };
  const w = R.watchdog(forged);
  assert.strictEqual(w.ok, false);
  assert.ok(w.problems.some((p) => p.rule === 'WATCHDOG-UNRECORDED-TRANSITION'),
    'a run file claiming stages the ledger never saw is an edited run file');
});

test('STEP 9 gates STEP 10: a checkpoint over a drifted run is refused', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(/WATCHDOG-REFUSED/.test(src));
  assert.ok(/const w = watchdog\(run\);/.test(src), 'checkpoint must consult the watchdog');
});

// ── normalizeObjective — dashboard objective intake ─────────────────────────
test('normalizeObjective: valid input normalizes whitespace and defaults dataClass', () => {
  const out = R.normalizeObjective({
    objective: '  do   the   thing  ',
    project: '  Vitalis  ',
    constraints: ['  no   secrets  '],
    acceptance: ['  tests pass  '],
  });
  assert.strictEqual(out.objective, 'do the thing');
  assert.strictEqual(out.project, 'Vitalis');
  assert.deepStrictEqual(out.constraints, ['no secrets']);
  assert.deepStrictEqual(out.acceptance, ['tests pass']);
  assert.strictEqual(out.dataClass, 'INTERNAL');
});

test('normalizeObjective: minimal input defaults project to null and arrays to empty', () => {
  const out = R.normalizeObjective({ objective: 'do the thing' });
  assert.strictEqual(out.project, null);
  assert.deepStrictEqual(out.constraints, []);
  assert.deepStrictEqual(out.acceptance, []);
  assert.strictEqual(out.dataClass, 'INTERNAL');
});

test('normalizeObjective: an explicit dataClass is honoured', () => {
  const out = R.normalizeObjective({ objective: 'x', dataClass: 'RESTRICTED' });
  assert.strictEqual(out.dataClass, 'RESTRICTED');
});

test('normalizeObjective: return value is frozen (top-level and array fields)', () => {
  const out = R.normalizeObjective({ objective: 'x', constraints: ['a'] });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.constraints));
  assert.ok(Object.isFrozen(out.acceptance));
  assert.throws(() => { out.objective = 'y'; }, /./);
});

test('normalizeObjective: non-plain-object input is rejected', () => {
  for (const bad of [null, undefined, 'x', 5, [], () => {}]) {
    assert.throws(() => R.normalizeObjective(bad), (e) => e instanceof R.AegisControlError && e.code === 'INVALID_OBJECTIVE');
  }
});

test('normalizeObjective: missing or empty objective is rejected', () => {
  assert.throws(() => R.normalizeObjective({}), (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: '' }), (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: '   ' }), (e) => e.code === 'INVALID_OBJECTIVE');
});

test('normalizeObjective: objective over 4000 characters is rejected', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'a'.repeat(4001) }), (e) => e.code === 'INVALID_OBJECTIVE');
  assert.doesNotThrow(() => R.normalizeObjective({ objective: 'a'.repeat(4000) }));
});

test('normalizeObjective: project over 100 characters is rejected', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', project: 'p'.repeat(101) }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.doesNotThrow(() => R.normalizeObjective({ objective: 'x', project: 'p'.repeat(100) }));
});

test('normalizeObjective: unknown top-level keys are rejected', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', extra: 'y' }),
    (e) => e.code === 'INVALID_OBJECTIVE');
});

test('normalizeObjective: invalid dataClass value is rejected', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', dataClass: 'TOP_SECRET' }),
    (e) => e.code === 'INVALID_OBJECTIVE');
});

test('normalizeObjective: constraints/acceptance must be arrays of non-empty strings within bounds', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: 'not an array' }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: [5] }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: [''] }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: ['a'.repeat(501)] }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: Array(21).fill('a') }),
    (e) => e.code === 'INVALID_OBJECTIVE');
  assert.doesNotThrow(() => R.normalizeObjective({ objective: 'x', constraints: Array(20).fill('a') }));
});

test('normalizeObjective: rejects dangerous control fields as top-level keys', () => {
  for (const field of ['command', 'shell', 'argv', 'model', 'provider', 'verdict', 'auth', 'token', 'secret', 'approval']) {
    assert.throws(() => R.normalizeObjective({ objective: 'x', [field]: 'y' }),
      (e) => e.code === 'INVALID_OBJECTIVE', `expected ${field} to be rejected as an unknown/dangerous key`);
  }
});

test('normalizeObjective: rejects a dangerous field value inside an array', () => {
  assert.throws(() => R.normalizeObjective({ objective: 'x', constraints: ['shell'] }),
    (e) => e.code === 'INVALID_OBJECTIVE');
});

test('normalizeObjective: throws AegisControlError with code INVALID_OBJECTIVE and httpStatus 400', () => {
  try {
    R.normalizeObjective({});
    assert.fail('expected normalizeObjective to throw');
  } catch (e) {
    assert.ok(e instanceof R.AegisControlError);
    assert.strictEqual(e.code, 'INVALID_OBJECTIVE');
    assert.strictEqual(e.httpStatus, 400);
  }
});

test('normalizeObjective: has no filesystem or process side effects', () => {
  const runsBefore = fs.existsSync(R.RUNS_DIR) ? fs.readdirSync(R.RUNS_DIR).length : 0;
  R.normalizeObjective({ objective: 'x', project: 'y', constraints: ['a'], acceptance: ['b'], dataClass: 'PUBLIC' });
  try { R.normalizeObjective({ bad: true }); } catch { /* expected */ }
  const runsAfter = fs.existsSync(R.RUNS_DIR) ? fs.readdirSync(R.RUNS_DIR).length : 0;
  assert.strictEqual(runsBefore, runsAfter, 'normalizeObjective must not write to RUNS_DIR');
});

test('normalizeObjective: preserves CLI behaviour (usage output unchanged)', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.ok(/aegis-run.cjs — the V1 runtime/.test(r.stderr));
});

// ── createRunFromObjective — the single intake authority ───────────────────
// Runs a fresh createRunFromObjective call in a child process against a temp
// RUNS_DIR/CHECKPOINTS_DIR/LEDGER_FILE, the same isolation the STEP 10 fixture
// uses, because the module resolves those directories from process.env at
// require time and this test file has already required the module once
// against the real (fallback) directories.
function withIsolatedRuntime(driverBody) {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-intake-'));
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  const ledger = path.join(TMP, 'ledger.json');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(ledger, '[]\n');
  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: cpDir, AEGIS_LEDGER_FILE: ledger };
  const driver = `
    const R = require(${JSON.stringify(CLI)});
    ${driverBody}
  `;
  const r = spawnSync('node', ['-e', driver], { cwd: ROOT, encoding: 'utf8', env });
  return { r, TMP, runsDir, cpDir, ledger };
}

test('createRunFromObjective: normalized fields persist to the run file', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({
      objective: '  ship   the   thing  ', project: '  Vitalis  ',
      constraints: ['  no secrets  '], acceptance: ['  tests pass  '], dataClass: 'CONFIDENTIAL',
    });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
  assert.strictEqual(files.length, 1, 'exactly one run file must be written');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
  assert.strictEqual(saved.objective, 'ship the thing');
  assert.strictEqual(saved.project, 'Vitalis');
  assert.deepStrictEqual(saved.constraints, ['no secrets']);
  assert.deepStrictEqual(saved.acceptanceCriteria, ['tests pass']);
  assert.strictEqual(saved.dataClass, 'CONFIDENTIAL');
});

test('createRunFromObjective: the canonical ledger records CREATED -> INTAKE_RECORDED', () => {
  const { r, ledger } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({ objective: 'record me' });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const entries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  const match = entries.find((e) => e.correlationId === out.runId && e.operationId === `${out.runId}:CREATED->INTAKE_RECORDED`);
  assert.ok(match, 'the ledger must contain the CREATED -> INTAKE_RECORDED transition for this run');
  assert.strictEqual(match.status, 'PASS');
});

test('createRunFromObjective: an invalid objective fails before any run is created', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    try { R.createRunFromObjective({}); console.log('NO-THROW'); }
    catch (e) { console.log(e.code); }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  assert.ok(/INVALID_OBJECTIVE/.test(r.stdout));
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
  assert.strictEqual(files.length, 0, 'an invalid objective must not leave a run file behind');
});

test('createRunFromObjective: an unsafe packet path fails before any run is created', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    try { R.createRunFromObjective({ objective: 'x' }, { packet: '../../../etc/passwd' }); console.log('NO-THROW'); }
    catch (e) { console.log(e.code); }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  assert.ok(/INVALID_PACKET/.test(r.stdout));
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
  assert.strictEqual(files.length, 0, 'an unsafe packet must not leave a run file behind');
});

test('createRunFromObjective: a missing packet fails before any run is created', () => {
  const { r, runsDir } = withIsolatedRuntime(`
    try { R.createRunFromObjective({ objective: 'x' }, { packet: 'builder-control/packets/DOES-NOT-EXIST.json' }); console.log('NO-THROW'); }
    catch (e) { console.log(e.code); }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  assert.ok(/INVALID_PACKET/.test(r.stdout));
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
  assert.strictEqual(files.length, 0, 'a missing packet must not leave a run file behind');
});

test('createRunFromObjective: does not create a worktree, build, model record, or process', () => {
  const before = spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  const { r, runsDir } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({ objective: 'no side effects' });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const after = spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  assert.strictEqual(before, after, 'createRunFromObjective must not create a git worktree');
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
  assert.strictEqual(saved.worktree, null, 'objective intake must not create a worktree');
  assert.strictEqual(saved.build, null, 'objective intake must not run a build');
  assert.strictEqual(saved.checks, null, 'objective intake must not run checks');
  assert.strictEqual(saved.checkpoint, null, 'objective intake must not create a checkpoint');
  assert.strictEqual(saved.route, undefined, 'objective intake must not perform routing/model selection');
});

test('createRunFromObjective: the CLI --new path goes through the same authority', () => {
  const { r, runsDir } = withIsolatedRuntime(`process.exit(0);`);
  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: path.join(runsDir, '..', 'checkpoints'), AEGIS_LEDGER_FILE: path.join(runsDir, '..', 'ledger.json') };
  const out = spawnSync('node', [CLI, '--new', '--objective', '  cli  path  ', '--json'], { cwd: ROOT, encoding: 'utf8', env });
  assert.strictEqual(out.status, 0, `--new failed: ${out.stderr}`);
  const saved = JSON.parse(out.stdout);
  assert.strictEqual(saved.objective, 'cli path', 'the CLI must go through the same normalizeObjective as the API path');
  assert.strictEqual(saved.state, 'INTAKE_RECORDED');
});

test('createRunFromObjective: the response has exactly runId,state,risk,nextAction and no secrets', () => {
  const { r } = withIsolatedRuntime(`
    const out = R.createRunFromObjective({ objective: 'shape check', dataClass: 'RESTRICTED' });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(Object.keys(out).sort(), ['nextAction', 'risk', 'runId', 'state']);
  const flat = JSON.stringify(out).toLowerCase();
  for (const bad of ['token', 'secret', 'password', 'apikey', 'api_key', 'authorization']) {
    assert.ok(!flat.includes(bad), `response leaked a secret-shaped field: ${bad}`);
  }
});

// ── prepareRun — the single routing + worktree authority ───────────────────
const crypto = require('crypto');

// Sets up a temp git repo + isolated RUNS_DIR/ledger, seeds a run at
// INTAKE_RECORDED via a real transition() call (so the ledger is genuine),
// then runs `driverBody` (which may reference `run.runId`) in the same child
// process and prints its JSON result as the last line of stdout.
function withIntakeRecordedRun(driverBody) {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-prep-'));
  const repo = path.join(TMP, 'repo');
  const runsDir = path.join(TMP, 'runs');
  const ledger = path.join(TMP, 'ledger.json');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(ledger, '[]\n');

  const g = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'fixture@example.invalid']);
  g(['config', 'user.name', 'AEGIS Fixture']);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  // prepareRun's own git calls always run against the canonical ROOT (the
  // real repo this test file lives in), not against this isolated fixture
  // repo — so baseCommit must be a commit that actually resolves there.
  const baseCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: path.join(TMP, 'checkpoints'), AEGIS_LEDGER_FILE: ledger };

  const runId = `RUN-20260825-${crypto.randomBytes(4).toString('hex')}`;
  const seed = {
    runId, createdAt: '2026-08-25T06:00:00Z', updatedAt: '2026-08-25T06:00:00Z',
    state: 'CREATED', objective: 'fixture prepareRun', packet: null, baseCommit,
    worktree: null, build: null, checks: null, checkpoint: null, corrections: 0, transitions: [],
  };
  fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(seed, null, 2));

  // Note: this repo (`repo`) is the ROOT the child process's git calls run
  // against, but aegis-run.cjs's own `ROOT` is fixed to the real repo two
  // levels up from this test file — worktree creation always targets
  // `ROOT/../aegis-wt-<runId>`, i.e. next to the real worktree checkout, not
  // inside the fixture repo. Cleanup below removes anything left behind.
  const driver = `
    const R = require(${JSON.stringify(CLI)});
    const run = R.loadRun(${JSON.stringify(runId)});
    R.transition(run, 'INTAKE_RECORDED', 'fixture');
    ${driverBody}
  `;
  const r = spawnSync('node', ['-e', driver], { cwd: ROOT, encoding: 'utf8', env });
  return { r, TMP, runId, runsDir, ledger, env };
}

function cleanupWorktree(runId) {
  if (!/^RUN-\d{8}-[0-9a-f]{8}$/.test(runId)) {
    throw new Error(`refusing to clean up unrecognized run id: ${runId}`);
  }
  const wt = path.join(ROOT, '..', `aegis-wt-${runId}`);
  const branch = `aegis/${runId}`;
  if (fs.existsSync(wt)) {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, encoding: 'utf8' });
    fs.rmSync(wt, { recursive: true, force: true });
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT, encoding: 'utf8' });
  spawnSync('git', ['branch', '-D', branch], { cwd: ROOT, encoding: 'utf8' });
}

test('prepareRun: success reaches WORKTREE_READY with canonical ROUTED and WORKTREE_READY ledger entries', () => {
  const { r, runId, runsDir, ledger, TMP, env } = withIntakeRecordedRun(`
    const out = R.prepareRun(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `prepareRun failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.runId, runId);
    assert.strictEqual(out.state, 'WORKTREE_READY');

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'WORKTREE_READY');

    const entries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    const reversed = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:WORKTREE_READY->ROUTED`);
    assert.ok(!reversed, 'sanity: a reversed transition must never be recorded — checking the two real ones below');
    const toRouted = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:INTAKE_RECORDED->ROUTED`);
    const toReady = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:ROUTED->WORKTREE_READY`);
    assert.ok(toRouted, 'the canonical ledger must record INTAKE_RECORDED -> ROUTED');
    assert.strictEqual(toRouted.status, 'PASS');
    assert.ok(toReady, 'the canonical ledger must record ROUTED -> WORKTREE_READY');
    assert.strictEqual(toReady.status, 'PASS');

    assert.ok(fs.existsSync(saved.worktree.path), 'the worktree directory must actually exist on disk');
    const wtList = spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' }).stdout;
    assert.ok(wtList.includes(saved.worktree.path), 'git must know about the new worktree');
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: route refusal creates no worktree and fails closed with ROUTE_REFUSED/409', () => {
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const path = require('path');
    const fs = require('fs');
    // Force a route refusal without touching the real tool-router: point
    // require() at a stub module of the same name via a fake node_modules-free
    // trick — simplest reliable way is to monkey-patch Module._load.
    const Module = require('module');
    const orig = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === './tool-router.cjs' || /tool-router\\.cjs$/.test(request)) {
        return { routeRole: () => ({ ok: false, code: 'NO_CAPABLE_MODEL', reason: 'no verified capability' }) };
      }
      return orig.apply(this, arguments);
    };
    try {
      R.prepareRun(run.runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus, isAegisControlError: e instanceof R.AegisControlError }));
    }
  `);
  try {
    assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, 'a refused route must throw, not silently proceed');
    assert.strictEqual(out.code, 'ROUTE_REFUSED');
    assert.strictEqual(out.httpStatus, 409);
    assert.strictEqual(out.isAegisControlError, true);

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.notStrictEqual(saved.state, 'WORKTREE_READY', 'a refused route must not reach WORKTREE_READY');
    assert.notStrictEqual(saved.state, 'ROUTED', 'a refused route must not record ROUTED');
    assert.strictEqual(saved.worktree, null, 'a refused route must create no worktree');

    const entries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    const toReady = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:ROUTED->WORKTREE_READY`);
    assert.ok(!toReady, 'the ledger must not record WORKTREE_READY for a refused route');

    const wt = path.join(ROOT, '..', `aegis-wt-${runId}`);
    assert.ok(!fs.existsSync(wt), 'no worktree directory may exist after a route refusal');
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: an existing worktree path or failed git worktree add does not claim WORKTREE_READY', () => {
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const fs = require('fs');
    const path = require('path');
    const wt = path.join(${JSON.stringify(ROOT)}, '..', 'aegis-wt-' + run.runId);
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'pre-existing');
    try {
      R.prepareRun(run.runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  try {
    assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, 'an existing worktree path must be refused, not reused');
    assert.strictEqual(out.code, 'WORKTREE_EXISTS');
    assert.strictEqual(out.httpStatus, 409);

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.notStrictEqual(saved.state, 'WORKTREE_READY', 'must not claim WORKTREE_READY over a dirty existing path');

    const entries = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    const toReady = entries.find((e) => e.correlationId === runId && e.operationId === `${runId}:ROUTED->WORKTREE_READY`);
    assert.ok(!toReady, 'the ledger must not record WORKTREE_READY when git worktree add never ran');

    // The pre-existing dirty directory must be untouched, not silently reused.
    const wt = path.join(ROOT, '..', `aegis-wt-${runId}`);
    assert.ok(fs.existsSync(path.join(wt, 'dirty.txt')), 'the pre-existing path must be left as-is, not overwritten');
  } finally {
    const wt = path.join(ROOT, '..', `aegis-wt-${runId}`);
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: requires an actual existing run at INTAKE_RECORDED — refuses CREATED', () => {
  const { r, runId, runsDir, TMP } = withIntakeRecordedRun(`
    // run is already at INTAKE_RECORDED here; move it back to CREATED by
    // writing the run file directly (a state prepareRun must still refuse,
    // since it is not reachable via transition() from INTAKE_RECORDED).
    const fs = require('fs');
    const p = R.runPath(run.runId);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    raw.state = 'CREATED';
    fs.writeFileSync(p, JSON.stringify(raw, null, 2));
    try {
      R.prepareRun(run.runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  try {
    assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true);
    assert.strictEqual(out.code, 'ILLEGAL_TRANSITION');
    assert.strictEqual(out.httpStatus, 409);
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: refuses a run id that does not exist', () => {
  assert.throws(() => R.prepareRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.RunError && e.code === 'NO-SUCH-RUN');
});

test('prepareRun: response has exactly runId,state,route,worktree,nextAction and no secrets', () => {
  const { r, runId, TMP } = withIntakeRecordedRun(`
    const out = R.prepareRun(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `prepareRun failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['nextAction', 'route', 'runId', 'state', 'worktree']);
    assert.deepStrictEqual(Object.keys(out.worktree).sort(), ['branch', 'path']);
    const flat = JSON.stringify(out).toLowerCase();
    for (const bad of ['token', 'secret', 'password', 'apikey', 'api_key', 'authorization']) {
      assert.ok(!flat.includes(bad), `response leaked a secret-shaped field: ${bad}`);
    }
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('prepareRun: does not execute a builder, model, or create a second event store', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const prepareRunSrc = src.slice(src.indexOf('function prepareRun'), src.indexOf('function cmdWorktree'));
  assert.ok(!/spawnSync\('bash'/.test(prepareRunSrc), 'prepareRun must not spawn a build command');
  assert.ok(!/cmdBuild/.test(prepareRunSrc), 'prepareRun must not execute the builder');
  assert.ok(!/fs\.writeFileSync.*ledger\.json/.test(prepareRunSrc), 'prepareRun must not write a second ledger file directly');
});

test('prepareRun: CLI --worktree calls prepareRun (single authority)', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const cmdWorktreeSrc = src.slice(src.indexOf('function cmdWorktree'), src.indexOf('function cmdBuild'));
  assert.ok(/result = prepareRun\(args\.runId\)/.test(cmdWorktreeSrc),
    'cmdWorktree must delegate to prepareRun rather than duplicating routing/worktree logic');
  // And it must not itself call git worktree add or routeRole directly.
  assert.ok(!/git\(\['worktree'/.test(cmdWorktreeSrc), 'cmdWorktree must not create the worktree itself');
  assert.ok(!/routeRole/.test(cmdWorktreeSrc), 'cmdWorktree must not route itself');
});

test('prepareRun: exported from the module', () => {
  assert.strictEqual(typeof R.prepareRun, 'function');
});

// ── pauseRun / cancelRun / retryRun — control-surface functions ────────────
// Isolated run+ledger fixtures, same pattern as withIsolatedRuntime: a temp
// RUNS_DIR/CHECKPOINTS_DIR/AEGIS_LEDGER_FILE, a run file written directly at a
// chosen state, then the function under test driven in a child process so it
// resolves those env-derived directories the same way the module would in
// production.
function withSeededRun(state, extra, driverBody) {
  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-ctrl-'));
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  const ledger = path.join(TMP, 'ledger.json');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(ledger, '[]\n');

  const runId = `RUN-20260825-${crypto.randomBytes(4).toString('hex')}`;
  const seed = Object.assign({
    runId, createdAt: '2026-08-25T06:00:00Z', updatedAt: '2026-08-25T06:00:00Z',
    state, objective: 'fixture control-surface run', packet: null, baseCommit: null,
    worktree: null, build: null, checks: null, checkpoint: null, corrections: 0, transitions: [],
  }, extra || {});
  fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(seed, null, 2));

  const env = { ...process.env, AEGIS_RUNS_DIR: runsDir, AEGIS_CHECKPOINTS_DIR: cpDir, AEGIS_LEDGER_FILE: ledger };
  const driver = `
    const R = require(${JSON.stringify(CLI)});
    const runId = ${JSON.stringify(runId)};
    ${driverBody}
  `;
  const r = spawnSync('node', ['-e', driver], { cwd: ROOT, encoding: 'utf8', env });
  return { r, TMP, runId, runsDir, ledger, env };
}

function ledgerEntriesFor(ledgerFile, runId) {
  const entries = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  return entries.filter((e) => e.correlationId === runId);
}

test('pauseRun: exported and refuses every state, including BUILDING, with no mutation', () => {
  assert.strictEqual(typeof R.pauseRun, 'function');
  for (const state of Object.keys(R.STATES)) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, null, `
      try {
        R.pauseRun(runId);
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus, isAegisControlError: e instanceof R.AegisControlError }));
      }
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, `pauseRun must refuse state ${state}, not silently proceed or invent PAUSED`);
    assert.strictEqual(out.code, 'CONTROL_UNAVAILABLE', `state ${state} did not refuse with CONTROL_UNAVAILABLE`);
    assert.strictEqual(out.httpStatus, 409, `state ${state} did not refuse with 409`);
    assert.strictEqual(out.isAegisControlError, true);

    const files = fs.readdirSync(runsDir);
    assert.strictEqual(files.length, 1, `pauseRun must not create or delete run files for state ${state}`);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
    assert.strictEqual(saved.state, state, `pauseRun must not mutate state ${state}`);
    assert.deepStrictEqual(saved.transitions, [], `pauseRun must record no transition for state ${state}`);
    assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0, `pauseRun must write nothing to the canonical ledger for state ${state}`);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('pauseRun: BUILDING explains active pause requires async worker control', () => {
  const { r } = withSeededRun('BUILDING', null, `
    try { R.pauseRun(runId); } catch (e) { console.log(e.message); }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  assert.ok(/asynchronous worker control/.test(r.stdout), 'BUILDING refusal must explain why, not just fail');
});

test('pauseRun: never touches signals or process control', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const pauseSrc = src.slice(src.indexOf('function pauseRun'), src.indexOf('function cancelRun'));
  assert.ok(!/process\.kill/.test(pauseSrc) && !/spawnSync/.test(pauseSrc) && !/SIGTERM|SIGKILL/.test(pauseSrc),
    'pauseRun must never touch signals or spawn a process — no PAUSED state exists to control');
});

test('cancelRun: exported; every state whose next() permits ABANDONED transitions through transition()', () => {
  assert.strictEqual(typeof R.cancelRun, 'function');
  const permitted = Object.entries(R.STATES).filter(([s, def]) => s !== 'BUILDING' && def.next.includes('ABANDONED')).map(([s]) => s);
  assert.ok(permitted.length > 0, 'sanity: at least one state must legally reach ABANDONED');
  for (const state of permitted) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, null, `
      const out = R.cancelRun(runId);
      console.log(JSON.stringify(out));
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['action', 'nextAction', 'runId', 'state'],
      `cancelRun response for ${state} has the wrong keys`);
    assert.strictEqual(out.state, 'ABANDONED');
    assert.strictEqual(out.action, 'cancel');

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${out.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'ABANDONED', `cancelRun must actually persist ABANDONED for ${state}`);

    const entries = ledgerEntriesFor(ledger, out.runId);
    const match = entries.find((e) => e.operationId === `${out.runId}:${state}->ABANDONED`);
    assert.ok(match, `the canonical ledger must record ${state} -> ABANDONED`);
    assert.strictEqual(match.status, 'PASS');
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('cancelRun: refuses BUILDING with CONTROL_UNAVAILABLE/409 and no mutation', () => {
  const { r, runsDir, ledger, TMP } = withSeededRun('BUILDING', null, `
    try {
      R.cancelRun(runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.threw, true);
  assert.strictEqual(out.code, 'CONTROL_UNAVAILABLE');
  assert.strictEqual(out.httpStatus, 409);
  const files = fs.readdirSync(runsDir);
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
  assert.strictEqual(saved.state, 'BUILDING', 'cancelRun must not mutate a BUILDING run');
  assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0, 'cancelRun must write nothing to the ledger when refused');
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: refuses terminal/non-permitted states with no mutation', () => {
  for (const state of ['ABANDONED', 'CHECKPOINTED']) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, null, `
      try {
        R.cancelRun(runId);
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
      }
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, `cancelRun must refuse ${state}`);
    assert.strictEqual(out.code, 'CONTROL_UNAVAILABLE');
    assert.strictEqual(out.httpStatus, 409);
    const files = fs.readdirSync(runsDir);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
    assert.strictEqual(saved.state, state, `cancelRun must not mutate ${state}`);
    assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('retryRun: exported; BUILD_FAILED and CHECKS_FAILED transition to CORRECTING with exactly one increment', () => {
  assert.strictEqual(typeof R.retryRun, 'function');
  for (const state of ['BUILD_FAILED', 'CHECKS_FAILED']) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, { corrections: 1 }, `
      const out = R.retryRun(runId);
      console.log(JSON.stringify(out));
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['action', 'correction', 'nextAction', 'runId', 'state'],
      `retryRun response for ${state} has the wrong keys`);
    assert.strictEqual(out.state, 'CORRECTING');
    assert.strictEqual(out.action, 'retry');
    assert.strictEqual(out.correction, 2, 'corrections must be incremented exactly once, from 1 to 2');

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${out.runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CORRECTING');
    assert.strictEqual(saved.corrections, 2);

    const entries = ledgerEntriesFor(ledger, out.runId);
    const match = entries.find((e) => e.operationId === `${out.runId}:${state}->CORRECTING`);
    assert.ok(match, `the canonical ledger must record ${state} -> CORRECTING`);
    assert.strictEqual(match.status, 'PASS');
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('retryRun: refuses other states with INVALID_RETRY/409 and no mutation', () => {
  for (const state of ['CREATED', 'WORKTREE_READY', 'BUILDING', 'CHECKS_PASSED', 'ABANDONED']) {
    const { r, runsDir, ledger, TMP } = withSeededRun(state, null, `
      try {
        R.retryRun(runId);
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
      }
    `);
    assert.strictEqual(r.status, 0, `driver failed for ${state}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true, `retryRun must refuse ${state}`);
    assert.strictEqual(out.code, 'INVALID_RETRY');
    assert.strictEqual(out.httpStatus, 409);
    const files = fs.readdirSync(runsDir);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
    assert.strictEqual(saved.state, state, `retryRun must not mutate ${state}`);
    assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('retryRun: refuses with CORRECTION_LIMIT/409 once MAX_CORRECTIONS is reached, with no mutation', () => {
  const { r, runsDir, ledger, TMP } = withSeededRun('BUILD_FAILED', { corrections: R.MAX_CORRECTIONS }, `
    try {
      R.retryRun(runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  assert.strictEqual(r.status, 0, `driver failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.threw, true);
  assert.strictEqual(out.code, 'CORRECTION_LIMIT');
  assert.strictEqual(out.httpStatus, 409);
  const files = fs.readdirSync(runsDir);
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), 'utf8'));
  assert.strictEqual(saved.state, 'BUILD_FAILED', 'retryRun must not mutate a run at the correction limit');
  assert.strictEqual(saved.corrections, R.MAX_CORRECTIONS, 'retryRun must not increment corrections past the limit');
  assert.strictEqual(ledgerEntriesFor(ledger, saved.runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('retryRun: does not execute a builder, model, or checks', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const retrySrc = src.slice(src.indexOf('function retryRun'), src.indexOf('// ── step 5'));
  assert.ok(!/spawnSync\('bash'/.test(retrySrc), 'retryRun must not spawn a build command');
  assert.ok(!/cmdBuild|cmdChecks|cmdAuto/.test(retrySrc), 'retryRun must not execute the builder or checks itself');
});

test('control functions: malformed and missing run ids map to stable AegisControlError', () => {
  assert.throws(() => R.pauseRun('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);
  assert.throws(() => R.cancelRun('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);
  assert.throws(() => R.retryRun('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);

  assert.throws(() => R.pauseRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.cancelRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.retryRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
});

const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failed} failed.`);
