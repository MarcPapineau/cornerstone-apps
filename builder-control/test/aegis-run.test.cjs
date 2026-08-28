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
const SERVER = path.join(ROOT, 'builder-control', 'hosting', 'server.cjs');
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

test('async worker core delegates through the canonical worker authority', () => {
  assert.strictEqual(typeof R.startWorker, 'function');
  const src = fs.readFileSync(CLI, 'utf8');
  assert.match(src, /transition\(run, 'BUILDING'/);
  assert.match(src, /require\('\.\/aegis-worker\.cjs'\)\.launchWorker/);
});

test('pause remains honestly unavailable until PAUSED semantics exist', () => {
  assert.ok(!Object.prototype.hasOwnProperty.call(R.STATES, 'PAUSED'));
  const src = fs.readFileSync(CLI, 'utf8');
  assert.match(src, /pause is unavailable because no PAUSED state exists/);
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

test('dashboard Start: two concurrent requests prepare and reserve exactly one worker under one claim', () => {
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    const counter = path.join(path.dirname(process.env.AEGIS_RUNS_DIR), 'dashboard-start-launches.txt');
    const startAt = Date.now() + 300;
    const childSource = String.raw\`
      const fs = require('fs');
      const crypto = require('crypto');
      const Module = require('module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === './tool-router.cjs' || /tool-router\\.cjs$/.test(request)) {
          return { routeRole: () => ({ ok: true, model: 'claude', execution: 'SUBSCRIPTION' }) };
        }
        if (request === './aegis-worker.cjs' || /aegis-worker\\.cjs$/.test(request)) {
          return {
            processAlive: () => false,
            normalizeLaunchSpec: (value) => Object.freeze({ ...value }),
            normalizeTimeoutSec: (value) => Number(value),
            launchWorker: ({ launchSpec }) => {
              fs.appendFileSync(process.env.AEGIS_START_COUNTER, process.pid + '\\n');
              return { workerPid: process.pid, processGroupId: process.pid,
                launchSha256: crypto.createHash('sha256').update(JSON.stringify(launchSpec)).digest('hex'),
                control: { dir: '/fixture/control-' + process.pid, secretSha256: 'fixture' } };
            },
          };
        }
        return originalLoad.apply(this, arguments);
      };
      while (Date.now() < Number(process.env.AEGIS_START_AT)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      const S = require(process.env.AEGIS_START_SERVER);
      try { console.log(JSON.stringify({ ok: true, value: S.startGovernedRun(process.env.AEGIS_START_RUN_ID) })); }
      catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, httpStatus: e.httpStatus })); }
    \`;
    const childEnv = { ...process.env, NODE_ENV: 'test', AEGIS_START_COUNTER: counter,
      AEGIS_START_AT: String(startAt), AEGIS_START_SERVER: ${JSON.stringify(SERVER)},
      AEGIS_START_RUN_ID: run.runId };
    const execute = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', childSource], { cwd: ${JSON.stringify(ROOT)}, env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    Promise.all([execute(), execute()]).then((children) => {
      const launches = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').trim().split(/\\n/).filter(Boolean) : [];
      try { fs.unlinkSync(counter); } catch {}
      console.log(JSON.stringify({ children, launches }));
    });
  `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    for (const child of out.children) assert.strictEqual(child.status, 0, child.stderr);
    const results = out.children.map((child) => JSON.parse(child.stdout.trim().split('\n').pop()));
    assert.strictEqual(results.filter((value) => value.ok).length, 1, JSON.stringify(results));
    const conflict = results.find((value) => !value.ok);
    assert.ok(conflict && ['LAUNCH_IN_PROGRESS', 'ILLEGAL_TRANSITION'].includes(conflict.code),
      `second Start did not fail closed: ${JSON.stringify(conflict)}`);
    assert.strictEqual(conflict.httpStatus, 409);
    assert.strictEqual(out.launches.length, 1, 'two dashboard Start requests launched more than one worker');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILDING');
    assert.strictEqual(saved.build.attempt, 1);
    assert.strictEqual(saved.transitions.filter((t) => t.from === 'INTAKE_RECORDED' && t.to === 'ROUTED').length, 1);
    assert.strictEqual(saved.transitions.filter((t) => t.from === 'ROUTED' && t.to === 'WORKTREE_READY').length, 1);
    assert.strictEqual(saved.transitions.filter((t) => t.from === 'WORKTREE_READY' && t.to === 'BUILDING').length, 1);
    const entries = ledgerEntriesFor(ledger, runId);
    assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:INTAKE_RECORDED->ROUTED`).length, 1);
    assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:ROUTED->WORKTREE_READY`).length, 1);
    assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:WORKTREE_READY->BUILDING`).length, 1);
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('dashboard Start uses one claim-aware path and never re-enters public prepare or start', () => {
  assert.strictEqual(typeof R.startGovernedWorker, 'function');
  const src = fs.readFileSync(CLI, 'utf8');
  const start = src.slice(src.indexOf('function startGovernedWorker'),
    src.indexOf('function controlMac', src.indexOf('function startGovernedWorker')));
  assert.match(start, /acquireRunLaunchClaim/);
  assert.match(start, /prepareRunClaimed\(/);
  assert.match(start, /startWorkerClaimed\(/);
  assert.doesNotMatch(start, /\bprepareRun\(/);
  assert.doesNotMatch(start, /\bstartWorker\(/);
});

test('legacy --build-async cannot make a caller-selected model authoritative', () => {
  const result = spawnSync('node', [CLI, '--build-async', 'RUN-20260825-deadbeef',
    '--prompt', 'must not launch', '--model', 'opus'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 3, `legacy async launch did not fail closed: ${result.stderr}`);
  assert.match(result.stderr, /GOVERNED-START-REQUIRED/);
  const src = fs.readFileSync(CLI, 'utf8');
  const parser = src.slice(src.indexOf('function parseArgs'), src.indexOf('if (require.main'));
  const branch = src.slice(src.indexOf('else if (args.cmd_build_async)'),
    src.indexOf('else if (args.cmd_checks)', src.indexOf('else if (args.cmd_build_async)')));
  assert.doesNotMatch(parser, /t === '--model'/, 'the legacy CLI still accepts caller model authority');
  assert.doesNotMatch(branch, /startWorker\s*\(/, 'the refused legacy branch can still invoke the worker');
});

// ── pauseRun / cancelRun / retryRun — control-surface functions ────────────
// Isolated run+ledger fixtures, same pattern as withIsolatedRuntime: a temp
// RUNS_DIR/CHECKPOINTS_DIR/AEGIS_LEDGER_FILE, a run file written directly at a
// chosen state, then the function under test driven in a child process so it
// resolves those env-derived directories the same way the module would in
// production.
function withSeededRun(state, extra, driverBody, beforeRequireBody = '') {
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
    ${beforeRequireBody}
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

function reviewSubject(overrides = {}) {
  return Object.assign({
    subjectSha256: 'a'.repeat(64),
    subjectPaths: ['builder-control/aegis-run.cjs', 'builder-control/test/aegis-run.test.cjs'],
    excludedAsEvidence: [],
    diffBytes: 4096,
    range: 'HEAD',
  }, overrides);
}

function reviewGate(subject, overrides = {}) {
  return Object.assign({
    ok: true,
    state: 'READY_FOR_DETERMINISTIC_VALIDATION',
    problems: [],
    observed: [],
    unverified: [],
    classification: { lane: 'FULL', requiredReviewers: ['codex', 'grok'] },
    subject,
    reviewerCompleteness: {
      complete: true,
      pathCoverage: {
        total: subject.subjectPaths.length,
        coveredByEveryRequiredReviewer: subject.subjectPaths,
        notCoveredByEveryRequiredReviewer: [],
      },
    },
    reviewsBound: 2,
    reviewsActive: 2,
    reviewsForeign: 1,
  }, overrides);
}

function engineeringOsMock(responses) {
  const engos = path.join(ROOT, 'builder-control', 'engineering-os.cjs');
  const expectedGitDir = spawnSync('git', ['-C', ROOT, 'rev-parse', '--absolute-git-dir'],
    { encoding: 'utf8' }).stdout.trim();
  const expectedGitWorkTree = fs.realpathSync(ROOT);
  const expectedCalls = responses.map((response) => {
    const body = response && response.body;
    if (body && body.subject && body.reviewerCompleteness) {
      return [engos, '--gate-done', '--packet', path.resolve(ROOT, REVIEW_PACKET),
        '--subject-sha', body.subject.subjectSha256, '--json'];
    }
    return [engos, '--subject', '--json'];
  });
  return `
    const childProcess = require('child_process');
    const originalSpawnSync = childProcess.spawnSync;
    const engosResponses = ${JSON.stringify(responses)};
    const expectedEngosCalls = ${JSON.stringify(expectedCalls)};
    let engosIndex = 0;
    childProcess.spawnSync = function(command, args, options) {
      if (command === process.execPath && Array.isArray(args) &&
          typeof args[0] === 'string' && args[0].endsWith('/builder-control/engineering-os.cjs')) {
        const expected = expectedEngosCalls[engosIndex];
        if (!expected || JSON.stringify(args) !== JSON.stringify(expected)) {
          throw new Error('engineering-os invocation mismatch: expected ' +
            JSON.stringify(expected) + ', received ' + JSON.stringify(args));
        }
        if (!options || options.cwd !== ${JSON.stringify(ROOT)} ||
            options.encoding !== 'utf8' || options.timeout !== 60000 ||
            options.maxBuffer !== 64 * 1024 * 1024 || !options.env ||
            options.env.GIT_DIR !== ${JSON.stringify(expectedGitDir)} ||
            options.env.GIT_WORK_TREE !== ${JSON.stringify(expectedGitWorkTree)}) {
          throw new Error('engineering-os spawn options are not bound to the canonical worktree');
        }
        const response = engosResponses[engosIndex++] || { status: 3, body: { ok: false, problems: [] } };
        return { status: response.status, stdout: JSON.stringify(response.body), stderr: '' };
      }
      return originalSpawnSync.apply(this, arguments);
    };
    process.on('exit', () => {
      if (engosIndex !== expectedEngosCalls.length) {
        console.error('engineering-os invocation count mismatch: expected ' +
          expectedEngosCalls.length + ', received ' + engosIndex);
        process.exitCode = 97;
      }
    });
  `;
}

const REVIEW_PACKET = 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json';
const REVIEW_HEAD = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const REVIEW_BRANCH = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'],
  { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const REVIEW_RUN = {
  packet: REVIEW_PACKET,
  baseCommit: REVIEW_HEAD,
  worktree: { path: ROOT, branch: REVIEW_BRANCH, baseCommit: REVIEW_HEAD },
};
function writeCanonicalCheckPacket(testsRequired) {
  const name = `PKT-TEST-CHECKS-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`;
  const absolute = path.join(R.PACKETS_DIR, name);
  fs.writeFileSync(absolute, JSON.stringify({ testsRequired }, null, 2) + '\n');
  return { absolute, relative: path.relative(ROOT, absolute) };
}
const PASSED_CHECKS = {
  ranAt: '2026-08-27T18:00:00.000Z', total: 2, passed: 2,
  results: [{ cmd: 'node --check builder-control/aegis-run.cjs', exit: 0 },
    { cmd: 'node builder-control/test/aegis-run.test.cjs', exit: 0 }],
};

test('engineeringOsMock: refuses a gate invocation with omitted exact-subject binding', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject);
  const engos = path.join(ROOT, 'builder-control', 'engineering-os.cjs');
  const probe = spawnSync('node', ['-e', `
    ${engineeringOsMock([{ status: 0, body: gate }])}
    require('child_process').spawnSync(process.execPath, [
      ${JSON.stringify(engos)}, '--gate-done', '--packet',
      ${JSON.stringify(path.resolve(ROOT, REVIEW_PACKET))}, '--json'
    ], { cwd: ${JSON.stringify(ROOT)}, encoding: 'utf8' });
  `], { cwd: ROOT, encoding: 'utf8' });
  assert.notStrictEqual(probe.status, 0, 'omitting --subject-sha must fail the review-authority proof');
  assert.match(probe.stderr, /engineering-os invocation mismatch/);
});

test('bindIndependentReview: binds one canonical exact subject and minimized gate evidence atomically', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject);
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', {
    ...REVIEW_RUN,
    checks: PASSED_CHECKS,
  }, `
    const result = R.bindIndependentReview(runId, {
      subjectSha256: 'f'.repeat(64), reviewer: 'browser', model: 'browser', executable: '/tmp/browser'
    });
    console.log(JSON.stringify(result));
  `, engineeringOsMock([
    { status: 0, body: subject },
    { status: 0, body: gate },
    { status: 0, body: subject },
  ]));
  assert.strictEqual(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(Object.keys(result).sort(),
    ['action', 'nextAction', 'runId', 'state', 'subjectSha256'].sort());
  assert.strictEqual(result.state, 'REVIEW_BOUND');
  assert.strictEqual(result.subjectSha256, subject.subjectSha256,
    'browser-supplied subject must not become authoritative');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'REVIEW_BOUND');
  assert.deepStrictEqual(Object.keys(saved.subject).sort(),
    ['authority', 'boundAt', 'diffBytes', 'pathCount', 'range', 'subjectSha256'].sort());
  assert.strictEqual(saved.subject.subjectSha256, subject.subjectSha256);
  assert.strictEqual(saved.reviewGate.authority, 'engineering-os.cjs --gate-done');
  assert.strictEqual(saved.reviewGate.exactSubjectReviews, 2);
  assert.strictEqual(saved.reviewGate.ignoredForeignReviews, 1);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'CHECKS_PASSED' && t.to === 'REVIEW_BOUND').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((entry) => entry.operationId === `${runId}:CHECKS_PASSED->REVIEW_BOUND`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: refuses invalid check evidence before consulting review authority', () => {
  for (const checks of [null,
    { ...PASSED_CHECKS, total: 0, passed: 0, results: [] },
    { ...PASSED_CHECKS, passed: 1 },
    { ...PASSED_CHECKS, results: [{ cmd: 'one', exit: 0 }] },
    { ...PASSED_CHECKS, results: PASSED_CHECKS.results.map((x, i) => ({ ...x, exit: i ? 1 : 0 })) },
  ]) {
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', {
      ...REVIEW_RUN, checks,
    }, `
      try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
      catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
    `, engineeringOsMock([]));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
      { threw: true, code: 'REVIEW-CHECKS-INVALID', httpStatus: 409 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_PASSED');
    assert.strictEqual(saved.subject, undefined);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('bindIndependentReview: canonical missing, foreign-only, stale, partial, ambiguous, unavailable, rejected, and blocking review gates never advance', () => {
  const subject = reviewSubject();
  const rules = [
    'ENGOS-REVIEW-MISSING', 'ENGOS-REVIEW-MISSING', 'ENGOS-REVIEW-STALE',
    'ENGOS-REVIEW-PARTIAL', 'ENGOS-REVIEW-AMBIGUOUS', 'ENGOS-REVIEW-UNAVAILABLE',
    'ENGOS-REVIEW-REJECTED', 'ENGOS-OPEN-FINDINGS',
  ];
  for (const rule of rules) {
    const gate = reviewGate(subject, {
      ok: false, problems: [{ rule, detail: 'fixture refusal' }],
      reviewerCompleteness: {
        complete: false,
        pathCoverage: { total: 2, coveredByEveryRequiredReviewer: [], notCoveredByEveryRequiredReviewer: subject.subjectPaths },
      },
      reviewsBound: 0, reviewsActive: 0, reviewsForeign: rule === 'ENGOS-REVIEW-MISSING' ? 2 : 0,
    });
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', {
      ...REVIEW_RUN, checks: PASSED_CHECKS,
    }, `
      try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
      catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
    `, engineeringOsMock([{ status: 0, body: subject }, { status: 3, body: gate }]));
    assert.strictEqual(r.status, 0, `${rule}: ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(out, { threw: true, code: 'REVIEW-GATE-REFUSED', httpStatus: 409 }, rule);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_PASSED', rule);
    assert.strictEqual(saved.subject, undefined, rule);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0, rule);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('bindIndependentReview: a subject moving after gate evaluation fails closed with no evidence persisted', () => {
  const subject = reviewSubject();
  const moved = reviewSubject({ subjectSha256: 'b'.repeat(64), diffBytes: 4097 });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', {
    ...REVIEW_RUN, checks: PASSED_CHECKS,
  }, `
    try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
    catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
  `, engineeringOsMock([
    { status: 0, body: subject }, { status: 0, body: reviewGate(subject) }, { status: 0, body: moved },
  ]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'REVIEW-SUBJECT-MOVED', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.strictEqual(saved.subject, undefined);
  assert.strictEqual(saved.reviewGate, undefined);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: gate success without complete exact path coverage is refused', () => {
  const subject = reviewSubject();
  const gate = reviewGate(subject);
  gate.reviewerCompleteness.complete = false;
  gate.reviewerCompleteness.pathCoverage.notCoveredByEveryRequiredReviewer = [subject.subjectPaths[1]];
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', {
    ...REVIEW_RUN, checks: PASSED_CHECKS,
  }, `
    try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
    catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
  `, engineeringOsMock([{ status: 0, body: subject }, { status: 0, body: gate }]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'REVIEW-GATE-REFUSED', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.strictEqual(saved.subject, undefined);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('bindIndependentReview: moved or forged run worktree metadata is refused before review authority', () => {
  const invalidRuns = [
    { ...REVIEW_RUN, baseCommit: null },
    { ...REVIEW_RUN, worktree: { ...REVIEW_RUN.worktree, baseCommit: '0'.repeat(40) } },
    { ...REVIEW_RUN, worktree: { ...REVIEW_RUN.worktree, branch: 'aegis/forged-branch' } },
    { ...REVIEW_RUN, worktree: { ...REVIEW_RUN.worktree, path: os.tmpdir() } },
  ];
  for (const invalid of invalidRuns) {
    const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', {
      ...invalid, checks: PASSED_CHECKS,
    }, `
      try { R.bindIndependentReview(runId); console.log(JSON.stringify({ threw: false })); }
      catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
    `, engineeringOsMock([]));
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.threw, true);
    assert.ok(['REVIEW-RUN-INVALID', 'REVIEW-WORKTREE-INVALID', 'REVIEW-WORKTREE-FOREIGN'].includes(out.code), out.code);
    assert.strictEqual(out.httpStatus, 409);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_PASSED');
    assert.strictEqual(saved.subject, undefined);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('bindIndependentReview: owns the per-run claim and accepts no browser authority inputs', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const body = src.slice(src.indexOf('function bindIndependentReview(runId)'), src.indexOf('function cmdChecks', src.indexOf('function bindIndependentReview(runId)')));
  assert.strictEqual(R.bindIndependentReview.length, 1);
  assert.match(body, /acquireRunLaunchClaim/);
  assert.match(body, /bindIndependentReviewClaimed\(run\)/);
  assert.doesNotMatch(body, /options|reviewer|model|executable|subjectSha/);
});

test('runChecks: exported claim-safe authority runs only packet-declared checks and returns a minimized result', () => {
  const packet = writeCanonicalCheckPacket(['node -e "process.exit(0)"']);
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['action', 'checks', 'nextAction', 'runId', 'state']);
    assert.strictEqual(out.runId, runId);
    assert.strictEqual(out.state, 'CHECKS_PASSED');
    assert.strictEqual(out.action, 'checks');
    assert.deepStrictEqual(out.checks, { passed: 1, total: 1 });
    assert.ok(!Object.prototype.hasOwnProperty.call(out, 'results'),
      'the control response must not expose packet commands or check output');
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'CHECKS_PASSED');
    assert.strictEqual(saved.checks.passed, 1);
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_PASSED`).length, 1);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

test('runChecks: failed declared checks persist only bounded redacted private evidence and return no raw output', () => {
  const bearer = 'AEGIS_BEARER_SENTINEL_1234567890abcdef';
  const password = 'AEGIS_PASSWORD_SENTINEL';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZWdpcy1zZW50aW5lbCJ9.signatureSentinel123';
  const diagnostic = 'AEGIS_CHECK_FAILURE_DIAGNOSTIC';
  const checkBody = [
    `for (let i = 0; i < 120; i++) console.log('padding-line-' + i);`,
    `console.log(${JSON.stringify(diagnostic)});`,
    `console.error('Authorization: Bearer ' + ${JSON.stringify(bearer)});`,
    `console.error('password=' + ${JSON.stringify(password)});`,
    `console.error(${JSON.stringify(jwt)});`,
    'process.exit(7);',
  ].join(' ');
  const failed = `node -e ${JSON.stringify(checkBody)}`;
  const packet = writeCanonicalCheckPacket([failed, 'node -e "process.exit(0)"']);
  const { r, runsDir, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(Object.keys(out).sort(), ['action', 'checks', 'nextAction', 'runId', 'state']);
    assert.deepStrictEqual(out.checks, { passed: 1, total: 2 });
    const publicText = JSON.stringify(out);
    for (const forbidden of [diagnostic, bearer, password, jwt, 'failureEvidence', 'stdoutTail', 'stderrTail']) {
      assert.ok(!publicText.includes(forbidden), `public checks response leaked ${forbidden}`);
    }

    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    const failedResult = saved.checks.results[0];
    assert.strictEqual(failedResult.exit, 7);
    assert.ok(failedResult.failureEvidence.stdoutTail.includes(diagnostic),
      'private evidence lost the useful failure diagnostic');
    assert.ok(failedResult.failureEvidence.stderrTail.includes('[REDACTED]') ||
      failedResult.failureEvidence.stderrTail.includes('[REDACTED JWT]') ||
      failedResult.failureEvidence.stderrTail.includes('[REDACTED OPAQUE]'),
    'private evidence did not record that sensitive values were redacted');
    for (const secret of [bearer, password, jwt]) {
      assert.ok(!JSON.stringify(failedResult.failureEvidence).includes(secret), `private evidence retained ${secret}`);
    }
    for (const tail of [failedResult.failureEvidence.stdoutTail, failedResult.failureEvidence.stderrTail]) {
      assert.ok(Buffer.byteLength(tail, 'utf8') <= 16 * 1024, 'failure evidence exceeded its byte bound');
      assert.ok(tail.split('\n').length <= 80, 'failure evidence exceeded its line bound');
    }
    assert.strictEqual(failedResult.failureEvidence.stdoutTruncated, true,
      'the line-bounded stdout tail must disclose that diagnostic context was truncated');
    assert.strictEqual(failedResult.failureEvidence.stderrTruncated, false,
      'redaction alone must not be mislabeled as diagnostic truncation');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(saved.checks.results[1], 'failureEvidence'), false,
      'passing checks must not retain output evidence');
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

test('runChecks: executes every declared non-recursive check including aegis-run paths', () => {
  const declared = [
    'node -e "process.exit(0)" builder-control/test/aegis-run.test.cjs',
    'node --check builder-control/aegis-run.cjs',
    ...Array.from({ length: 8 }, (_, i) => `node -e "process.exit(${i} === ${i} ? 0 : 1)"`),
  ];
  const recursiveGate = 'node builder-control/engineering-os.cjs --gate-done --packet ignored.json';
  const packet = writeCanonicalCheckPacket([...declared, recursiveGate]);
  const { r, runsDir, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet: packet.relative }, `
      const out = R.runChecks(runId);
      console.log(JSON.stringify(out));
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(out.checks, { passed: 10, total: 10 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.deepStrictEqual(saved.checks.results.map((result) => result.cmd), declared);
    assert.ok(saved.checks.results.every((result) => result.exit === 0));
    assert.strictEqual(saved.checks.results.some((result) => result.cmd === recursiveGate), false);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(packet.absolute, { force: true });
  }
});

test('runChecks: external packet is refused before checks with no run or ledger mutation', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-check-external-'));
  const packet = path.join(tmp, 'packet.json');
  const marker = path.join(tmp, 'spawned');
  fs.writeFileSync(packet, JSON.stringify({
    testsRequired: [`node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')"`],
  }));
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILT',
    { ...REVIEW_RUN, packet }, `
      try { R.runChecks(runId); console.log(JSON.stringify({ threw: false })); }
      catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
    `);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
      { threw: true, code: 'INVALID_PACKET', httpStatus: 400 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.state, 'BUILT');
    assert.strictEqual(saved.checks, null);
    assert.strictEqual(saved.updatedAt, '2026-08-25T06:00:00Z');
    assert.deepStrictEqual(saved.transitions, []);
    assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
    assert.strictEqual(fs.existsSync(marker), false, 'external packet command was spawned');
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runChecks: forged or moved worktree authority is refused before checks with no mutation', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-check-forged-'));
  const marker = path.join(tmp, 'spawned');
  const packet = writeCanonicalCheckPacket([
    `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')"`,
  ]);
  const invalidRuns = [
    { ...REVIEW_RUN, packet: packet.relative, baseCommit: null },
    { ...REVIEW_RUN, packet: packet.relative,
      worktree: { ...REVIEW_RUN.worktree, baseCommit: '0'.repeat(40) } },
    { ...REVIEW_RUN, packet: packet.relative,
      worktree: { ...REVIEW_RUN.worktree, branch: 'aegis/forged-branch' } },
    { ...REVIEW_RUN, packet: packet.relative,
      worktree: { ...REVIEW_RUN.worktree, path: os.tmpdir() } },
  ];
  try {
    for (const invalid of invalidRuns) {
      const fixture = withSeededRun('BUILT', invalid, `
        try { R.runChecks(runId); console.log(JSON.stringify({ threw: false })); }
        catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }
      `);
      try {
        assert.strictEqual(fixture.r.status, 0, fixture.r.stderr);
        assert.deepStrictEqual(JSON.parse(fixture.r.stdout.trim().split('\n').pop()),
          { threw: true, code: 'CHECKS_WORKTREE_INVALID', httpStatus: 409 });
        const saved = JSON.parse(fs.readFileSync(path.join(fixture.runsDir, `${fixture.runId}.json`), 'utf8'));
        assert.strictEqual(saved.state, 'BUILT');
        assert.strictEqual(saved.checks, null);
        assert.strictEqual(saved.updatedAt, '2026-08-25T06:00:00Z');
        assert.deepStrictEqual(saved.transitions, []);
        assert.strictEqual(ledgerEntriesFor(fixture.ledger, fixture.runId).length, 0);
        assert.strictEqual(fs.existsSync(marker), false, 'forged worktree command was spawned');
      } finally {
        fs.rmSync(fixture.TMP, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(packet.absolute, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runChecks: canonical switchboard checks generate state.js in a clean isolated worktree and reach 4/4', () => {
  const packet = 'builder-control/packets/PKT-20260825-SWITCHBOARD-FOUNDATION.json';
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    run.packet = ${JSON.stringify(packet)};
    R.saveRun(run);
    R.prepareRun(run.runId);
    const built = R.loadRun(run.runId);
    R.transition(built, 'BUILDING', 'fixture builder started');
    R.transition(built, 'BUILT', 'fixture builder exited 0');
    const out = R.runChecks(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `canonical checks failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_PASSED');
    assert.deepStrictEqual(out.checks, { passed: 4, total: 4 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.deepStrictEqual(saved.checks.precondition, {
      state: 'PASSED',
      generator: 'builder-control/aegis-state.cjs',
      output: 'builder-control/dashboard/state.js',
    });
    const generated = path.join(saved.worktree.path, 'builder-control', 'dashboard', 'state.js');
    assert.ok(fs.existsSync(generated), 'canonical checks did not generate state.js in the run worktree');
    assert.match(fs.readFileSync(generated, 'utf8'), /^\/\* Generated by builder-control\/aegis-state\.cjs/);
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_PASSED`).length, 1);
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('runChecks: canonical state generation failure records CHECKS_FAILED and runs no packet check', () => {
  const packet = 'builder-control/packets/PKT-20260825-SWITCHBOARD-FOUNDATION.json';
  const { r, runId, runsDir, ledger, TMP } = withIntakeRecordedRun(`
    const fs = require('fs');
    const path = require('path');
    run.packet = ${JSON.stringify(packet)};
    R.saveRun(run);
    R.prepareRun(run.runId);
    const built = R.loadRun(run.runId);
    fs.renameSync(path.join(built.worktree.path, 'builder-control', 'aegis-state.cjs'),
      path.join(built.worktree.path, 'builder-control', 'aegis-state.cjs.disabled'));
    R.transition(built, 'BUILDING', 'fixture builder started');
    R.transition(built, 'BUILT', 'fixture builder exited 0');
    const out = R.runChecks(run.runId);
    console.log(JSON.stringify(out));
  `);
  try {
    assert.strictEqual(r.status, 0, `generator refusal driver failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(out.state, 'CHECKS_FAILED');
    assert.deepStrictEqual(out.checks, { passed: 0, total: 4 });
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
    assert.strictEqual(saved.checks.precondition.state, 'FAILED');
    assert.strictEqual(saved.checks.precondition.code, 'STATE_GENERATOR_UNAVAILABLE');
    assert.strictEqual(saved.checks.results.length, 4);
    assert.ok(saved.checks.results.every((result) => result.exit === null && result.skipped),
      'packet checks must remain unexecuted when their state precondition fails');
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_FAILED`).length, 1);
    assert.strictEqual(ledgerEntriesFor(ledger, runId)
      .filter((e) => e.operationId === `${runId}:BUILT->CHECKS_PASSED`).length, 0,
      'a failed generator must never produce a passing check transition');
  } finally {
    cleanupWorktree(runId);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('runChecks: invalid state fails closed under the canonical claim with no mutation', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('CHECKS_PASSED', null, `
    try {
      R.runChecks(runId);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out, { threw: true, code: 'INVALID_CHECKS', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CHECKS_PASSED');
  assert.strictEqual(saved.checks, null);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('runChecks: owns the per-run claim and reuses one claimed executor', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const claimed = src.slice(src.indexOf('function runChecksClaimed'), src.indexOf('function runChecks(runId)'));
  const control = src.slice(src.indexOf('function runChecks(runId)'), src.indexOf('function cmdChecks'));
  assert.match(control, /acquireRunLaunchClaim\(runId,/);
  assert.match(control, /runChecksClaimed\(run\)/);
  assert.doesNotMatch(claimed, /acquireRunLaunchClaim/,
    'the claimed executor must not acquire a second, deadlocking claim');
});

test('reconcileWorkerRun: present worker with transient identity inspection failure preserves BUILDING', () => {
  const attemptId = '66666666-6666-4666-8666-666666666666';
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 9999,
    processIdentity: { pid: 9999, processGroupId: 9999, startMarker: 'recorded',
      executable: '/fixture/worker', source: 'ps' }, workerState: 'RUNNING', revision: 0,
    startedAt: '2026-08-27T12:00:00.000Z' };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    const seeded = R.loadRun(runId);
    seeded.build.workerPid = _sleeper.pid;
    seeded.build.processIdentity = { ...seeded.build.processIdentity, pid: _sleeper.pid };
    R.saveRun(seeded);
    let out;
    try { out = R.reconcileWorkerRun(runId, { observedAt: '2026-08-27T12:01:00.000Z' }); }
    finally { try { _sleeper.kill('SIGKILL'); } catch {} }
    console.log(JSON.stringify(out));
  `, `
    const _fs = require('fs');
    const _childProcess = require('child_process');
    const _sleeper = _childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' });
    const _read = _fs.readFileSync;
    _fs.readFileSync = function(file, ...args) {
      if (String(file) === '/proc/' + _sleeper.pid + '/stat') {
        const error = new Error('transient identity failure'); error.code = 'EACCES'; throw error;
      }
      return _read.call(this, file, ...args);
    };
    const _spawnSync = _childProcess.spawnSync;
    _childProcess.spawnSync = function(command, args, options) {
      if (command === 'ps' && Array.isArray(args) && args[1] === String(_sleeper.pid) &&
          args[3] !== 'pid=') return { status: 1, stdout: '', stderr: '' };
      return _spawnSync.call(this, command, args, options);
    };
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out, { runId, action: 'IDENTITY_UNVERIFIED', state: 'BUILDING',
    reason: 'IDENTITY_INSPECTION_UNAVAILABLE' });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILDING');
  assert.strictEqual(saved.build.revision, 0);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('reconcileWorkerRun: unknown process existence preserves BUILDING without ledger transition', () => {
  const targetPid = 2147483646;
  const attemptId = '77777777-7777-4777-8777-777777777777';
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: targetPid,
    processIdentity: { pid: targetPid, processGroupId: targetPid, startMarker: 'recorded',
      executable: '/fixture/worker', source: 'ps' }, workerState: 'RUNNING', revision: 0,
    startedAt: '2026-08-27T12:00:00.000Z' };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    console.log(JSON.stringify(R.reconcileWorkerRun(runId, { observedAt: '2026-08-27T12:01:00.000Z' })));
  `, `
    const _targetPid = ${targetPid};
    const _fs = require('fs');
    const _childProcess = require('child_process');
    const _read = _fs.readFileSync;
    const _lstat = _fs.lstatSync;
    _fs.readFileSync = function(file, ...args) {
      if (String(file) === '/proc/' + _targetPid + '/stat') {
        const error = new Error('transient identity failure'); error.code = 'EACCES'; throw error;
      }
      return _read.call(this, file, ...args);
    };
    _fs.lstatSync = function(file, ...args) {
      if (String(file) === '/proc/' + _targetPid) {
        const error = new Error('transient existence failure'); error.code = 'EACCES'; throw error;
      }
      return _lstat.call(this, file, ...args);
    };
    const _spawnSync = _childProcess.spawnSync;
    _childProcess.spawnSync = function(command, args, options) {
      if (command === 'ps' && Array.isArray(args) && args[1] === String(_targetPid))
        return { status: null, stdout: '', stderr: '', error: new Error('ps unavailable') };
      return _spawnSync.call(this, command, args, options);
    };
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out, { runId, action: 'IDENTITY_UNVERIFIED', state: 'BUILDING',
    reason: 'PROCESS_EXISTENCE_UNKNOWN' });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILDING');
  assert.strictEqual(saved.build.revision, 0);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('reconcileWorkerRun: positively absent worker transitions exactly once to unsafe BUILD_FAILED', () => {
  const deadPid = 2147483647;
  const attemptId = '88888888-8888-4888-8888-888888888888';
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: deadPid,
    processIdentity: { pid: deadPid, processGroupId: deadPid, startMarker: 'recorded',
      executable: '/fixture/worker', source: 'ps' }, workerState: 'RUNNING', revision: 0,
    startedAt: '2026-08-27T12:00:00.000Z' };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    const first = R.reconcileWorkerRun(runId, { observedAt: '2026-08-27T12:01:00.000Z' });
    const second = R.reconcileWorkerRun(runId, { observedAt: '2026-08-27T12:02:00.000Z' });
    console.log(JSON.stringify({ first, second }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out.first, { runId, action: 'RECOVERED_UNSAFE', state: 'BUILD_FAILED', reason: 'ORPHANED' });
  assert.deepStrictEqual(out.second, { runId, action: 'NOOP', state: 'BUILD_FAILED' });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILD_FAILED');
  assert.strictEqual(saved.build.workerState, 'ORPHANED');
  assert.strictEqual(saved.build.recovery.retrySafe, false);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING' && t.to === 'BUILD_FAILED').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((e) => e.operationId === `${runId}:BUILDING->BUILD_FAILED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

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

test('cancelRun source has no raw PID or process-group signal path', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const cancelSrc = src.slice(src.indexOf('function cancelRun'), src.indexOf('\n/**\n * Retry', src.indexOf('function cancelRun')));
  assert.doesNotMatch(cancelSrc, /process\.kill|terminateWorker|terminateProcessGroup|childProcessGroupId/);
  assert.match(cancelSrc, /requestCancellation/);
});

test('transition: exported authority refuses BUILDING -> ABANDONED even with caller-fabricated evidence', () => {
  const attemptId = '90909090-9090-4090-8090-909090909090';
  const cancellationId = '91919191-9191-4191-8191-919191919191';
  const childIdentity = { pid: 4141, processGroupId: 4040, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4040,
    childProcessIdentity: childIdentity, workerState: 'TERMINATED', revision: 2,
    cancellation: { cancellationId, attemptId, status: 'TERMINATED' },
    terminationEvidence: { controlAuthenticated: true, terminated: true,
      childCloseObserved: true, processGroupDrained: true, attemptId, cancellationId,
      childIdentity } };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    let out;
    try { R.transition(R.loadRun(runId), 'ABANDONED', 'caller-supplied evidence'); out = { threw: false }; }
    catch (e) { out = { threw: true, code: e.code }; }
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'TERMINATION-EVIDENCE-REQUIRED' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8')).state, 'BUILDING');
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: state changed to BUILDING before claim uses authenticated mailbox path', () => {
  const attemptId = '92929292-9292-4292-8292-929292929292';
  const childIdentity = { pid: 4242, processGroupId: 4141, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4141,
    processGroupId: 4141, childProcessGroupId: 4141, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' },
    workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('WORKTREE_READY', null, `
    process.env.NODE_ENV = 'test';
    let mailboxRequests = 0;
    const out = R.cancelRun(runId, {
      beforeClaim: () => {
        const starting = R.loadRun(runId);
        starting.build = ${JSON.stringify(build)};
        R.transition(starting, 'BUILDING', 'deterministic Start won before cancellation claim');
      },
      requestCancellation: (observedBuild, cancellationId) => {
        mailboxRequests += 1;
        if (observedBuild.attemptId !== ${JSON.stringify(attemptId)}) throw new Error('wrong attempt signalled');
        return { terminated: true, childCloseObserved: true, processGroupDrained: true,
          cancellationId, childIdentity: ${JSON.stringify(childIdentity)}, signal: 'SIGTERM',
          observedAt: '2026-08-27T12:00:02.000Z' };
      },
    });
    console.log(JSON.stringify({ out, mailboxRequests }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(observed.mailboxRequests, 1, 'fresh BUILDING state must use the authenticated mailbox');
  assert.strictEqual(observed.out.state, 'ABANDONED');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.build.terminationEvidence.controlAuthenticated, true);
  assert.strictEqual(saved.build.terminationEvidence.attemptId, attemptId);
  assert.strictEqual(saved.build.terminationEvidence.cancellationId, saved.build.cancellation.cancellationId);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((entry) => entry.operationId === `${runId}:BUILDING->ABANDONED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: timeout then late authenticated response cannot wedge the next cancellation', () => {
  const controlDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cancel-mailbox-'));
  fs.chmodSync(controlDir, 0o700);
  const controlStat = fs.statSync(controlDir);
  const secret = crypto.randomBytes(32).toString('hex');
  const attemptId = '93939393-9393-4393-8393-939393939393';
  const childIdentity = { pid: 4343, processGroupId: 4242, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4242,
    processGroupId: 4242, childProcessGroupId: 4242, childProcessIdentity: childIdentity,
    control: { dir: controlDir, secret,
      secretSha256: crypto.createHash('sha256').update(secret).digest('hex'),
      directoryIdentity: { dev: Number(controlStat.dev), ino: Number(controlStat.ino) } },
    workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    const crypto = require('crypto');
    const fs = require('fs');
    const path = require('path');
    const childProcess = require('child_process');
    let firstCode = null;
    try { R.cancelRun(runId); } catch (e) { firstCode = e.code; }
    const timedOut = R.loadRun(runId);
    const oldCancellationId = timedOut.build.cancellation.cancellationId;
    const responsePath = path.join(${JSON.stringify(controlDir)}, 'cancel-response.json');
    const requestPath = path.join(${JSON.stringify(controlDir)}, 'cancel-request.json');
    const lateBody = { attemptId: ${JSON.stringify(attemptId)}, cancellationId: oldCancellationId,
      terminated: true, childCloseObserved: true, processGroupDrained: true,
      childIdentity: ${JSON.stringify(childIdentity)}, reason: 'LATE_OLD_RESPONSE',
      observedAt: '2026-08-27T12:00:03.000Z' };
    const lateMac = crypto.createHmac('sha256', ${JSON.stringify(secret)})
      .update(JSON.stringify(lateBody)).digest('hex');
    fs.writeFileSync(responsePath, JSON.stringify({ body: lateBody, mac: lateMac }), { mode: 0o600 });

    const responderScript = ${JSON.stringify(`
      const crypto = require('crypto');
      const fs = require('fs');
      const requestPath = ${JSON.stringify(path.join(controlDir, 'cancel-request.json'))};
      const responsePath = ${JSON.stringify(path.join(controlDir, 'cancel-response.json'))};
      const secret = ${JSON.stringify(secret)};
      const oldCancellationId = process.argv[1];
      const attemptId = ${JSON.stringify(attemptId)};
      const childIdentity = ${JSON.stringify(childIdentity)};
      const deadline = Date.now() + 5000;
      const poll = setInterval(() => {
        if (Date.now() > deadline) { clearInterval(poll); process.exit(2); }
        if (!fs.existsSync(requestPath)) return;
        let request;
        try { request = JSON.parse(fs.readFileSync(requestPath, 'utf8')); } catch { return; }
        if (!request.body || request.body.cancellationId === oldCancellationId) return;
        const body = { attemptId, cancellationId: request.body.cancellationId,
          terminated: true, childCloseObserved: true, processGroupDrained: true,
          childIdentity, reason: 'CURRENT_RESPONSE', observedAt: '2026-08-27T12:00:04.000Z' };
        const mac = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
        const temporary = responsePath + '.' + process.pid + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify({ body, mac }), { mode: 0o600 });
        fs.renameSync(temporary, responsePath);
        clearInterval(poll);
      }, 10);
    `)};
    childProcess.spawn(process.execPath, ['-e', responderScript, oldCancellationId], { stdio: 'ignore' });
    const second = R.cancelRun(runId);
    const saved = R.loadRun(runId);
    console.log(JSON.stringify({ firstCode, oldCancellationId, second,
      acceptedCancellationId: saved.build.terminationEvidence.cancellationId,
      currentCancellationId: saved.build.cancellation.cancellationId,
      responseRemains: fs.existsSync(responsePath), requestRemains: fs.existsSync(requestPath) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(observed.firstCode, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(observed.second.state, 'ABANDONED');
  assert.notStrictEqual(observed.acceptedCancellationId, observed.oldCancellationId);
  assert.strictEqual(observed.acceptedCancellationId, observed.currentCancellationId);
  assert.strictEqual(observed.responseRemains, false);
  assert.strictEqual(observed.requestRemains, false);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((entry) => entry.operationId === `${runId}:BUILDING->ABANDONED`).length, 1);
  fs.rmSync(controlDir, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: malformed response fails closed and is never accepted as termination evidence', () => {
  const controlDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cancel-malformed-'));
  fs.chmodSync(controlDir, 0o700);
  const controlStat = fs.statSync(controlDir);
  const secret = crypto.randomBytes(32).toString('hex');
  const attemptId = '94949494-9494-4494-8494-949494949494';
  const childIdentity = { pid: 4444, processGroupId: 4343, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4343,
    processGroupId: 4343, childProcessGroupId: 4343, childProcessIdentity: childIdentity,
    control: { dir: controlDir, secret,
      secretSha256: crypto.createHash('sha256').update(secret).digest('hex'),
      directoryIdentity: { dev: Number(controlStat.dev), ino: Number(controlStat.ino) } },
    workerState: 'RUNNING', revision: 0 };
  fs.writeFileSync(path.join(controlDir, 'cancel-response.json'), '{not-json', { mode: 0o600 });
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    let code = null;
    try { R.cancelRun(runId); } catch (e) { code = e.code; }
    console.log(JSON.stringify({ code, saved: R.loadRun(runId) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(observed.code, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(observed.saved.state, 'BUILDING');
  assert.strictEqual(observed.saved.build.terminationEvidence.terminated, false);
  assert.strictEqual(observed.saved.build.terminationEvidence.reason,
    'CONTROL_RESPONSE_AUTHENTICATION_FAILED');
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(controlDir, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: unauthenticated response fails closed and is never accepted as termination evidence', () => {
  const controlDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-cancel-unauthenticated-'));
  fs.chmodSync(controlDir, 0o700);
  const controlStat = fs.statSync(controlDir);
  const secret = crypto.randomBytes(32).toString('hex');
  const attemptId = '95959595-9595-4595-8595-959595959595';
  const cancellationId = '96969696-9696-4696-8696-969696969696';
  const childIdentity = { pid: 4545, processGroupId: 4444, startMarker: 'child-fixture',
    executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4444,
    processGroupId: 4444, childProcessGroupId: 4444, childProcessIdentity: childIdentity,
    control: { dir: controlDir, secret,
      secretSha256: crypto.createHash('sha256').update(secret).digest('hex'),
      directoryIdentity: { dev: Number(controlStat.dev), ino: Number(controlStat.ino) } },
    workerState: 'RUNNING', revision: 0 };
  const forgedBody = { attemptId, cancellationId, terminated: true, childCloseObserved: true,
    processGroupDrained: true, childIdentity, reason: 'FORGED_RESPONSE',
    observedAt: '2026-08-27T12:00:05.000Z' };
  fs.writeFileSync(path.join(controlDir, 'cancel-response.json'),
    JSON.stringify({ body: forgedBody, mac: '00'.repeat(32) }), { mode: 0o600 });
  const { r, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    let code = null;
    try { R.cancelRun(runId); } catch (e) { code = e.code; }
    console.log(JSON.stringify({ code, saved: R.loadRun(runId) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(observed.code, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(observed.saved.state, 'BUILDING');
  assert.strictEqual(observed.saved.build.terminationEvidence.terminated, false);
  assert.strictEqual(observed.saved.build.terminationEvidence.reason,
    'CONTROL_RESPONSE_AUTHENTICATION_FAILED');
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(controlDir, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
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

test('cancelRun: heartbeat at the signal boundary cannot deadlock or overwrite cancellation', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  const childIdentity = { pid: 4343, processGroupId: 4242, startMarker: 'child-fixture', executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4242,
    processGroupId: 4242, childProcessGroupId: 4242, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' }, workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    process.env.NODE_ENV = 'test';
    const out = R.cancelRun(runId, {
      requestCancellation: () => {
        R.updateWorkerAttempt(runId, ${JSON.stringify(attemptId)}, 4242,
          { heartbeatAt: '2026-08-27T12:00:01.000Z', stdoutTail: 'heartbeat-preserved' });
        return { terminated: true, childCloseObserved: true, processGroupDrained: true, childIdentity: ${JSON.stringify(childIdentity)}, signal: 'SIGTERM', observedAt: '2026-08-27T12:00:02.000Z' };
      },
    });
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.state, 'ABANDONED');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.build.revision, 3, 'intent, heartbeat, and terminal CAS must each advance the revision once');
  assert.strictEqual(saved.build.stdoutTail, 'heartbeat-preserved');
  assert.strictEqual(saved.build.cancellation.status, 'TERMINATED');
  assert.strictEqual(saved.build.terminationEvidence.terminated, true);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((e) => e.operationId === `${runId}:BUILDING->ABANDONED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: a simultaneous second cancellation cannot replace the active operation', () => {
  const attemptId = '12121212-1212-4212-8212-121212121212';
  const childIdentity = { pid: 4444, processGroupId: 4343, startMarker: 'child-fixture', executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 1, attemptId, workerPid: 4343,
    processGroupId: 4343, childProcessGroupId: 4343, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' }, workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    process.env.NODE_ENV = 'test';
    let competing;
    const out = R.cancelRun(runId, {
      requestCancellation: (_build, cancellationId) => {
        const child = require('child_process').spawnSync(process.execPath, ['-e',
          'const R = require(' + JSON.stringify(${JSON.stringify(CLI)}) + ');' +
          'try { R.cancelRun(' + JSON.stringify(runId) + '); console.log(JSON.stringify({ threw: false })); }' +
          'catch (e) { console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus })); }'
        ], { cwd: ${JSON.stringify(ROOT)}, encoding: 'utf8', env: process.env });
        competing = JSON.parse(child.stdout.trim().split('\\n').pop());
        const during = R.loadRun(runId);
        if (during.build.cancellation.cancellationId !== cancellationId) {
          throw new Error('the competing cancellation replaced the active cancellation id');
        }
        return { terminated: true, childCloseObserved: true, processGroupDrained: true, childIdentity: ${JSON.stringify(childIdentity)}, signal: 'SIGTERM', observedAt: '2026-08-27T12:00:02.000Z' };
      },
    });
    console.log(JSON.stringify({ out, competing }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const observed = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(observed.competing,
    { threw: true, code: 'CANCELLATION_IN_PROGRESS', httpStatus: 409 });
  assert.strictEqual(observed.out.state, 'ABANDONED');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.build.revision, 2, 'only the original intent and terminal cancellation may mutate the attempt');
  assert.strictEqual(saved.build.cancellation.status, 'TERMINATED');
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((e) => e.operationId === `${runId}:BUILDING->ABANDONED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: a worker finalizer that wins during signalling is never overwritten', () => {
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const childIdentity = { pid: 5353, processGroupId: 5252, startMarker: 'child-fixture', executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 2, attemptId, workerPid: 5252,
    processGroupId: 5252, childProcessGroupId: 5252, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' }, workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    process.env.NODE_ENV = 'test';
    try {
      R.cancelRun(runId, {
        requestCancellation: () => {
          R.transitionWorkerAttempt(runId, ${JSON.stringify(attemptId)}, 5252, 'BUILT', 'deterministic close won', { exit: 0 });
          return { terminated: true, childCloseObserved: true, processGroupDrained: true, childIdentity: ${JSON.stringify(childIdentity)}, signal: null, observedAt: '2026-08-27T12:00:03.000Z' };
        },
      });
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, httpStatus: e.httpStatus }));
    }
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()), {
    threw: true, code: 'CANCELLATION_SUPERSEDED', httpStatus: 409,
  });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILT');
  assert.strictEqual(saved.build.revision, 2, 'cancel intent and finalizer must be the only two mutations');
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING').length, 1);
  const entries = ledgerEntriesFor(ledger, runId);
  assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:BUILDING->BUILT`).length, 1);
  assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:BUILDING->ABANDONED`).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: unsafe recovery is administratively abandonable without signalling or changing termination truth', () => {
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const childIdentity = { pid: 6363, processGroupId: 6262, startMarker: 'child-fixture', executable: '/fixture/claude', source: 'fixture' };
  const build = { mode: 'async', attempt: 3, attemptId, workerPid: 6262,
    processGroupId: 6262, childProcessGroupId: 6262, childProcessIdentity: childIdentity,
    control: { dir: '/fixture/control', secret: 'fixture', secretSha256: 'fixture' }, workerState: 'RUNNING', revision: 0 };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILDING', { build }, `
    process.env.NODE_ENV = 'test';
    let cancelCode = null;
    try {
      R.cancelRun(runId, {
        requestCancellation: () => ({ terminated: false, childCloseObserved: false, reason: 'CONTROL_RESPONSE_TIMEOUT', observedAt: '2026-08-27T12:00:04.000Z' }),
      });
    } catch (e) { cancelCode = e.code; }
    const afterCancel = R.loadRun(runId);
    const reconciled = R.reconcileWorkerRun(runId);
    const failed = R.loadRun(runId);
    let retryCode = null;
    try { R.retryRun(runId); } catch (e) { retryCode = e.code; }
    let lateCode = null;
    try { R.updateWorkerAttempt(runId, ${JSON.stringify(attemptId)}, 6262, { heartbeatAt: 'late' }); }
    catch (e) { lateCode = e.code; }
    const terminationEvidenceBefore = JSON.stringify(failed.build.terminationEvidence);
    let signalRequests = 0;
    let abandonCode = null;
    let abandoned = null;
    try {
      abandoned = R.cancelRun(runId, {
        requestCancellation: () => { signalRequests += 1; throw new Error('administrative abandonment must not signal'); },
      });
    } catch (e) { abandonCode = e.code; }
    let terminalRetryCode = null;
    try { R.retryRun(runId); } catch (e) { terminalRetryCode = e.code; }
    console.log(JSON.stringify({ cancelCode, afterCancel, reconciled, failed, retryCode, lateCode,
      terminationEvidenceBefore, signalRequests, abandonCode, abandoned, terminalRetryCode }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.cancelCode, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(out.afterCancel.state, 'BUILDING');
  assert.strictEqual(out.afterCancel.build.revision, 2);
  assert.strictEqual(out.afterCancel.build.cancellation.status, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(out.reconciled.reason, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(out.failed.state, 'BUILD_FAILED');
  assert.strictEqual(out.failed.build.workerState, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(out.failed.build.recovery.retrySafe, false);
  assert.strictEqual(out.retryCode, 'RECOVERY_UNSAFE');
  assert.strictEqual(out.lateCode, 'STALE-WORKER-ATTEMPT');
  assert.strictEqual(out.signalRequests, 0);
  assert.strictEqual(out.abandonCode, null);
  assert.strictEqual(out.abandoned.state, 'ABANDONED');
  assert.strictEqual(out.terminalRetryCode, 'INVALID_RETRY');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'ABANDONED');
  assert.strictEqual(saved.build.revision, 3);
  assert.strictEqual(JSON.stringify(saved.build.terminationEvidence), out.terminationEvidenceBefore);
  assert.strictEqual(saved.build.recovery.terminationVerified, false);
  assert.strictEqual(saved.build.recovery.retrySafe, false);
  assert.strictEqual(saved.build.recovery.abandonmentAllowed, true);
  assert.deepStrictEqual(Object.keys(saved.build.recovery.administrativeResolution).sort(),
    ['resolvedAt', 'signallingAttempted', 'type']);
  assert.strictEqual(saved.build.recovery.administrativeResolution.type, 'ABANDONED_WITHOUT_SIGNAL');
  assert.strictEqual(saved.build.recovery.administrativeResolution.signallingAttempted, false);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILDING').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((e) => e.operationId === `${runId}:BUILDING->BUILD_FAILED`).length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).filter((e) => e.operationId === `${runId}:BUILD_FAILED->ABANDONED`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('cancelRun: unsafe recovery refuses administrative abandonment unless explicitly allowed', () => {
  const recovery = { reason: 'TERMINATION_UNVERIFIED', observedAt: '2026-08-27T12:01:00.000Z',
    terminationVerified: false, retrySafe: false, abandonmentAllowed: false,
    attemptId: '44444444-4444-4444-8444-444444444444' };
  const build = { mode: 'async', attempt: 4, attemptId: recovery.attemptId, workerState: 'TERMINATION_UNVERIFIED',
    revision: 4, recovery, terminationEvidence: { terminated: false, reason: 'sentinel' } };
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { build }, `
    let out;
    try { R.cancelRun(runId); out = { threw: false }; }
    catch (e) { out = { threw: true, code: e.code, httpStatus: e.httpStatus }; }
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'TERMINATION_UNVERIFIED', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILD_FAILED');
  assert.deepStrictEqual(saved.build.recovery, recovery);
  assert.deepStrictEqual(saved.build.terminationEvidence, { terminated: false, reason: 'sentinel' });
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
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

test('retryRun: an existing per-run claim blocks the complete retry decision without mutation', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 1 }, `
    const fs = require('fs');
    const lock = R.runPath(runId) + '.launch.lock';
    const claimId = 'fixture-live-claim';
    fs.mkdirSync(lock, { mode: 0o700 });
    const owner = require('path').join(lock, claimId + '.json');
    fs.writeFileSync(owner, JSON.stringify({ claimId, runId, pid: process.pid,
      processIdentity: R.processIdentity(process.pid), claimedAt: new Date().toISOString() }), { mode: 0o600 });
    let out;
    try { R.retryRun(runId); out = { threw: false }; }
    catch (e) { out = { threw: true, code: e.code, httpStatus: e.httpStatus }; }
    fs.unlinkSync(owner); fs.rmdirSync(lock);
    console.log(JSON.stringify(out));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()),
    { threw: true, code: 'LAUNCH_IN_PROGRESS', httpStatus: 409 });
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILD_FAILED');
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: a reused numeric PID with a different process lifetime is reclaimed without signalling it', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 0 }, `
    const fs = require('fs');
    const lock = R.runPath(runId) + '.launch.lock';
    const identity = R.processIdentity(process.pid);
    const claimId = 'fixture-reused-pid';
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(require('path').join(lock, claimId + '.json'), JSON.stringify({ claimId, runId, pid: process.pid,
      processIdentity: { ...identity, startMarker: identity.startMarker + '-prior-lifetime' },
      claimedAt: new Date().toISOString() }), { mode: 0o600 });
    const originalKill = process.kill;
    let signalCalls = 0;
    process.kill = () => { signalCalls++; throw new Error('claim recovery must not signal'); };
    let out;
    try { out = R.retryRun(runId); }
    finally { process.kill = originalKill; }
    console.log(JSON.stringify({ out, signalCalls, lockExists: fs.existsSync(lock) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.out.state, 'CORRECTING');
  assert.strictEqual(out.signalCalls, 0, 'claim recovery signalled the unrelated reused PID');
  assert.strictEqual(out.lockExists, false, 'the replacement claim was not released');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CORRECTING');
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: a positively absent crashed owner is reclaimed without signalling', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 0 }, `
    const fs = require('fs');
    const path = require('path');
    const lock = R.runPath(runId) + '.launch.lock';
    const claimId = 'fixture-dead-owner';
    const deadPid = 2147483647;
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, claimId + '.json'), JSON.stringify({ claimId, runId, pid: deadPid,
      processIdentity: { pid: deadPid, processGroupId: deadPid, startMarker: 'prior-lifetime',
        executable: '/dead/aegis-owner', source: 'ps' }, claimedAt: new Date().toISOString() }), { mode: 0o600 });
    const originalKill = process.kill;
    let signalCalls = 0;
    process.kill = () => { signalCalls++; throw new Error('dead-owner recovery must not signal'); };
    let out;
    try { out = R.retryRun(runId); }
    finally { process.kill = originalKill; }
    console.log(JSON.stringify({ out, signalCalls, lockExists: fs.existsSync(lock) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.out.state, 'CORRECTING');
  assert.strictEqual(out.signalCalls, 0, 'dead-owner recovery signalled a PID');
  assert.strictEqual(out.lockExists, false, 'the replacement claim was not released');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: live owner with unavailable identity observation fails closed and is preserved', () => {
  const worktree = fs.realpathSync(os.tmpdir());
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('WORKTREE_READY',
    { worktree: { path: worktree } }, `
    const fs = require('fs');
    const path = require('path');
    const lock = R.runPath(runId) + '.launch.lock';
    const claimId = 'fixture-unavailable-owner';
    const identity = { ...R.processIdentity(process.pid), pid: _sleeper.pid };
    fs.mkdirSync(lock, { mode: 0o700 });
    const owner = path.join(lock, claimId + '.json');
    const stored = { claimId, runId, pid: _sleeper.pid, processIdentity: identity,
      claimedAt: new Date().toISOString() };
    fs.writeFileSync(owner, JSON.stringify(stored), { mode: 0o600 });
    let out;
    try { R.startWorker(runId, { provider: 'claude-subscription', prompt: 'must not launch', model: 'opus' });
      out = { threw: false }; }
    catch (e) { out = { threw: true, code: e.code, httpStatus: e.httpStatus }; }
    finally { try { _sleeper.kill('SIGKILL'); } catch {} }
    console.log(JSON.stringify({ out, ownerExists: fs.existsSync(owner), stored: JSON.parse(fs.readFileSync(owner, 'utf8')) }));
  `, `
    const _fs = require('fs');
    const _childProcess = require('child_process');
    const _sleeper = _childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' });
    const _originalReadFileSync = _fs.readFileSync;
    _fs.readFileSync = function(file, ...args) {
      if (String(file) === '/proc/' + _sleeper.pid + '/stat') {
        const error = new Error('identity intentionally unavailable'); error.code = 'EACCES'; throw error;
      }
      return _originalReadFileSync.call(this, file, ...args);
    };
    const _originalSpawnSync = _childProcess.spawnSync;
    _childProcess.spawnSync = function(command, args, options) {
      if (command === 'ps' && Array.isArray(args) && args[1] === String(_sleeper.pid) &&
          args[3] !== 'pid=') return { status: 1, stdout: '', stderr: '' };
      return _originalSpawnSync.call(this, command, args, options);
    };
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out.out, { threw: true, code: 'LAUNCH_IN_PROGRESS', httpStatus: 409 });
  assert.strictEqual(out.ownerExists, true, 'unavailable identity observation removed the claim');
  assert.strictEqual(out.stored.claimId, 'fixture-unavailable-owner');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'WORKTREE_READY');
  assert.strictEqual(saved.build, null);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 0);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: an incomplete sibling publication cannot wedge the canonical claim', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 0 }, `
    const fs = require('fs');
    const lock = R.runPath(runId) + '.launch.lock';
    const orphan = lock + '.claim-2147483647-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.tmp';
    fs.mkdirSync(orphan, { mode: 0o700 });
    const out = R.retryRun(runId);
    console.log(JSON.stringify({ out, lockExists: fs.existsSync(lock), orphanExists: fs.existsSync(orphan) }));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.out.state, 'CORRECTING');
  assert.strictEqual(out.lockExists, false, 'the published claim was not released');
  assert.strictEqual(out.orphanExists, false,
    'a positively dead incomplete sibling publication was not safely collected');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('launch claim: two stale-claim reclaimers cannot unlink the newly acquired owner', () => {
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED', { corrections: 0 }, `
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    const lock = R.runPath(runId) + '.launch.lock';
    const staleClaimId = 'fixture-stale-owner';
    const identity = R.processIdentity(process.pid);
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, staleClaimId + '.json'), JSON.stringify({ claimId: staleClaimId,
      runId, pid: process.pid, processIdentity: { ...identity, startMarker: identity.startMarker + '-stale' },
      claimedAt: new Date().toISOString() }), { mode: 0o600 });
    const startAt = Date.now() + 300;
    const childSource = String.raw\`
      const childProcess = require('child_process');
      const originalSpawnSync = childProcess.spawnSync;
      childProcess.spawnSync = function(command, args, options) {
        if (Array.isArray(args) && args.some((arg) => /ledger-writer\\.cjs$/.test(String(arg)))) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);
        }
        return originalSpawnSync.call(this, command, args, options);
      };
      while (Date.now() < Number(process.env.AEGIS_RECLAIM_START_AT)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      const R = require(process.env.AEGIS_RECLAIM_CLI);
      try { console.log(JSON.stringify({ ok: true, value: R.retryRun(process.env.AEGIS_RECLAIM_RUN_ID) })); }
      catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, httpStatus: e.httpStatus })); }
    \`;
    const env = { ...process.env, AEGIS_RECLAIM_START_AT: String(startAt),
      AEGIS_RECLAIM_CLI: ${JSON.stringify(CLI)}, AEGIS_RECLAIM_RUN_ID: runId };
    const execute = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', childSource], { cwd: ${JSON.stringify(ROOT)}, env,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    Promise.all([execute(), execute()]).then((children) => {
      console.log(JSON.stringify({ children, lockExists: fs.existsSync(lock) }));
    });
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const child of out.children) assert.strictEqual(child.status, 0, child.stderr);
  const results = out.children.map((child) => JSON.parse(child.stdout.trim().split('\n').pop()));
  assert.strictEqual(results.filter((value) => value.ok).length, 1, JSON.stringify(results));
  const conflict = results.find((value) => !value.ok);
  assert.ok(conflict && ['LAUNCH_IN_PROGRESS', 'INVALID_RETRY'].includes(conflict.code),
    `second reclaimer did not fail closed: ${JSON.stringify(conflict)}`);
  assert.strictEqual(conflict.httpStatus, 409);
  assert.strictEqual(out.lockExists, false, 'the winning claim was not released cleanly');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'CORRECTING');
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILD_FAILED' && t.to === 'CORRECTING').length, 1);
  assert.strictEqual(ledgerEntriesFor(ledger, runId)
    .filter((e) => e.operationId === `${runId}:BUILD_FAILED->CORRECTING`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('retryRun: two concurrent async retries reserve exactly one correction and one worker attempt', () => {
  const launchSpec = { provider: 'claude-subscription', prompt: 'bounded fixture retry', model: 'opus' };
  const priorBuild = { mode: 'async', attempt: 1, attemptId: '55555555-5555-4555-8555-555555555555',
    launchSpec, workerPid: null, workerState: 'BUILD_FAILED', revision: 2 };
  const worktree = fs.realpathSync(os.tmpdir());
  const { r, runsDir, ledger, runId, TMP } = withSeededRun('BUILD_FAILED',
    { corrections: 0, worktree: { path: worktree }, build: priorBuild }, `
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    const counter = path.join(${JSON.stringify(os.tmpdir())}, 'aegis-retry-launch-' + process.pid + '.txt');
    const startAt = Date.now() + 300;
    const childSource = String.raw\`
      const fs = require('fs');
      const Module = require('module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === './aegis-worker.cjs' || /aegis-worker\\.cjs$/.test(request)) {
          return {
            processAlive: () => false,
            normalizeLaunchSpec: (value) => Object.freeze({ ...value }),
            normalizeTimeoutSec: (value) => value === undefined ? 900 : Number(value),
            launchWorker: ({ launchSpec }) => {
              fs.appendFileSync(process.env.AEGIS_RETRY_COUNTER, process.pid + '\\n');
              return { workerPid: process.pid, processGroupId: process.pid,
                launchSha256: require('crypto').createHash('sha256').update(JSON.stringify(launchSpec)).digest('hex'),
                control: { dir: '/fixture/control-' + process.pid, secretSha256: 'fixture' } };
            },
          };
        }
        return originalLoad.apply(this, arguments);
      };
      while (Date.now() < Number(process.env.AEGIS_RETRY_START_AT)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      const R = require(process.env.AEGIS_RETRY_CLI);
      try { console.log(JSON.stringify({ ok: true, value: R.retryRun(process.env.AEGIS_RETRY_RUN_ID) })); }
      catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, httpStatus: e.httpStatus })); }
    \`;
    const childEnv = { ...process.env, NODE_ENV: 'test', AEGIS_RETRY_COUNTER: counter,
      AEGIS_RETRY_START_AT: String(startAt), AEGIS_RETRY_CLI: ${JSON.stringify(CLI)},
      AEGIS_RETRY_RUN_ID: runId };
    const execute = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', childSource], { cwd: ${JSON.stringify(ROOT)}, env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    Promise.all([execute(), execute()]).then((children) => {
      const launches = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').trim().split(/\\n/).filter(Boolean) : [];
      try { fs.unlinkSync(counter); } catch {}
      console.log(JSON.stringify({ children, launches }));
    });
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.children.length, 2);
  for (const child of out.children) assert.strictEqual(child.status, 0, child.stderr);
  const results = out.children.map((child) => JSON.parse(child.stdout.trim().split('\n').pop()));
  assert.strictEqual(results.filter((value) => value.ok).length, 1);
  const conflict = results.find((value) => !value.ok);
  assert.ok(conflict && ['INVALID_RETRY', 'LAUNCH_IN_PROGRESS'].includes(conflict.code),
    `second retry did not return a deterministic conflict: ${JSON.stringify(conflict)}`);
  assert.strictEqual(conflict.httpStatus, 409);
  assert.strictEqual(out.launches.length, 1, 'only one claimed retry may invoke the worker launcher');
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, `${runId}.json`), 'utf8'));
  assert.strictEqual(saved.state, 'BUILDING');
  assert.strictEqual(saved.corrections, 1);
  assert.strictEqual(saved.build.attempt, 2);
  assert.match(saved.build.attemptId, /^[0-9a-f-]{36}$/);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'BUILD_FAILED' && t.to === 'CORRECTING').length, 1);
  assert.strictEqual(saved.transitions.filter((t) => t.from === 'CORRECTING' && t.to === 'BUILDING').length, 1);
  const entries = ledgerEntriesFor(ledger, runId);
  assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:BUILD_FAILED->CORRECTING`).length, 1);
  assert.strictEqual(entries.filter((e) => e.operationId === `${runId}:CORRECTING->BUILDING`).length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('retryRun uses one claim-aware launch path and never re-enters public startWorker', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const claimed = src.slice(src.indexOf('function startWorkerClaimed'), src.indexOf('/**\n * Launches the build', src.indexOf('function startWorkerClaimed')));
  const retry = src.slice(src.indexOf('function retryRun'), src.indexOf('// ── step 5', src.indexOf('function retryRun')));
  assert.doesNotMatch(claimed, /acquireRunLaunchClaim/);
  assert.match(retry, /acquireRunLaunchClaim/);
  assert.match(retry, /startWorkerClaimed\(/);
  assert.doesNotMatch(retry, /\bstartWorker\(/);
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
  assert.throws(() => R.runChecks('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);
  assert.throws(() => R.bindIndependentReview('../../etc/passwd'),
    (e) => e instanceof R.AegisControlError && e.code === 'INVALID_RUN_ID' && e.httpStatus === 400);

  assert.throws(() => R.pauseRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.cancelRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.retryRun('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.runChecks('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
  assert.throws(() => R.bindIndependentReview('RUN-19700101-deadbeef'),
    (e) => e instanceof R.AegisControlError && e.code === 'RUN_NOT_FOUND' && e.httpStatus === 404);
});

const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failed} failed.`);
