#!/usr/bin/env node
/**
 * aegis-state.test.cjs — red proofs for the state projector.
 *
 * The projector is the only thing the dashboard reads, which makes it the exact
 * place a comfortable lie would enter the system. Every case below asserts an
 * uncomfortable output: a refusal, an UNKNOWN, a STALE, an UNAVAILABLE. A
 * projector that quietly upgraded any of these would pass a happy-path suite
 * and fail the only job it has.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'builder-control', 'aegis-state.cjs');
const REGISTRY = path.join(ROOT, 'builder-control', 'connector-registry.json');
const LEDGER = path.join(ROOT, 'builder-control', 'ledger.json');
const M = require('../aegis-state.cjs');
const R = require('../aegis-run.cjs');

// The canonical bytes, read ONCE at load. Nothing in this suite may change
// them; the last test in the file proves it.
const CANONICAL_REGISTRY_BYTES = fs.readFileSync(REGISTRY, 'utf8');
const CANONICAL_LEDGER_BYTES = fs.readFileSync(LEDGER, 'utf8');
const CANONICAL_LEDGER_AT_START = JSON.parse(CANONICAL_LEDGER_BYTES);

// ── one immutable snapshot of the canonical ledger ─────────────────────────
// REVIEW FINDING #6. The registry is a file nothing legitimately writes during
// a test run, so reading it live is deterministic. The LEDGER is not: it is an
// append-only event store that other suites in this same run correctly append
// to. Any case here that reads it twice and compares the two reads, or that
// compares its bytes with the bytes at load, can be failed by somebody else's
// correct behaviour — and the failure message then blames this suite for a
// write it never performed.
//
// So the ledger is frozen ONCE, at load, into a private temp file, and the
// cases whose result depends on ledger CONTENT are projected from that frozen
// copy through the projector's existing `ledgerFile` injection. The content is
// still real canonical evidence — byte-for-byte what was on disk at load — it
// simply stops moving underneath the assertions. Cases that assert on the
// ledger's IDENTITY (that the default projection reads
// builder-control/ledger.json) keep reading the live artifact, because a single
// read of a constant path has nothing to race with.
const FROZEN_TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-frozen-'));
process.on('exit', () => { try { fs.rmSync(FROZEN_TMP, { recursive: true, force: true }); } catch {} });
const FROZEN_LEDGER = path.join(FROZEN_TMP, 'frozen-canonical.json');
fs.writeFileSync(FROZEN_LEDGER, CANONICAL_LEDGER_BYTES);
fs.chmodSync(FROZEN_LEDGER, 0o444); // read-only: the snapshot is evidence, not scratch

// ── isolated registry fixtures ─────────────────────────────────────────────
// Codex G1 finding #3. These cases used to stage a fixture by OVERWRITING
// builder-control/connector-registry.json and restoring it in a `finally`. Two
// things are wrong with that and both of them happened: a concurrent snapshot
// observes the synthetic registry, and a process killed between the two writes
// leaves the fixture installed as canonical evidence. It also cannot run at all
// where the tree is read-only — the review environment returned EPERM.
//
// Every registry fixture now lives in a private temp directory and is handed to
// the projector through its injected `registryPath`. The projector under test is
// the same projector; only the file it reads is ours.
const REG_TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-reg-'));
process.on('exit', () => { try { fs.rmSync(REG_TMP, { recursive: true, force: true }); } catch {} });
let regFixtureNo = 0;
function fixtureRegistry(reg) {
  const f = path.join(REG_TMP, `registry-${++regFixtureNo}.json`);
  fs.writeFileSync(f, JSON.stringify(reg, null, 2));
  return f;
}
// A path inside the fixture directory where no file exists — for the
// missing-artifact case, which used to be staged by DELETING the canonical one.
function absentRegistry() {
  return path.join(REG_TMP, `absent-${++regFixtureNo}.json`);
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const NOW = Date.parse('2026-08-23T12:00:00Z');
console.log('AEGIS state projector — red proofs');

// ── the authority boundary is mechanical, not advisory ──────────────────────
const ROGUE_CONNECTOR = {
  connectorId: 'rogue', label: 'Rogue', provider: 'x',
  plane: 'CONTROL', health: 'HEALTHY',
  healthEvidence: { observedAt: '2026-08-23T11:59:00Z', method: 'm', result: 'r' },
};

test('a connector claiming CONTROL plane is REFUSED, not warned about', () => {
  // The fixture is the REAL registry plus one rogue connector, so this is the
  // production shape with the one violation added — read canonically, written
  // nowhere but a temp file.
  const reg = JSON.parse(CANONICAL_REGISTRY_BYTES);
  reg.connectors.push(ROGUE_CONNECTOR);
  const p = fixtureRegistry(reg);

  // 1. The pure projector refuses. Not a warning, not a filtered-out row: it
  //    throws, and it throws with the refusal marker the CLI keys off.
  let thrown = null;
  try { M.projectConnectors(NOW, { registryPath: p }); }
  catch (e) { thrown = e; }
  assert.ok(thrown, 'a CONTROL-plane connector was loaded instead of refused');
  assert.strictEqual(thrown.refused, true, 'the refusal must be marked as a refusal, not a generic error');
  assert.ok(/never hold engineering authority/.test(thrown.message), 'the refusal must state why');

  // 2. The CLI maps that refusal to exit 3 and names the rule. This is the
  //    operator-visible half of the behaviour and it still runs end to end.
  const r = spawnSync('node', [CLI], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, AEGIS_CONNECTOR_REGISTRY: p },
  });
  assert.strictEqual(r.status, 3, `expected refusal exit 3, got ${r.status}: ${r.stderr}`);
  assert.ok(/AEGIS-CONNECTOR-PLANE-VIOLATION/.test(r.stderr), 'must name the rule');
  assert.ok(/never hold engineering authority/.test(r.stderr), 'must state why');

  // 3. And none of that touched canonical evidence.
  assert.strictEqual(fs.readFileSync(REGISTRY, 'utf8'), CANONICAL_REGISTRY_BYTES,
    'proving the refusal modified the canonical connector registry');
});

test('the injected registry path is confined to a temp dir — it cannot redirect at another checked-in file', () => {
  // The injection exists to isolate a test. If it could point anywhere, it
  // would be an evidence-substitution switch: aim the dashboard at a file that
  // says everything is healthy and the projection would cite it as canonical.
  const foreign = path.join(ROOT, 'builder-control', 'connector-registry.json.fake');
  assert.throws(() => M.projectConnectors(NOW, { registryPath: foreign }),
    /must point inside/, 'the projector accepted a registry outside the temp directory');
  assert.throws(() => M.resolveEvidencePath(foreign, REGISTRY, M.ENV_REGISTRY), /must point inside/);
  // Naming the canonical artifact explicitly is not a redirection.
  assert.strictEqual(M.resolveEvidencePath(REGISTRY, REGISTRY, M.ENV_REGISTRY), REGISTRY);
  // Omitting it resolves to canonical — the production default.
  assert.strictEqual(M.resolveEvidencePath(undefined, REGISTRY, null), REGISTRY);
});

test('an injected registry is CITED as the file it is — a fixture can never read back as canonical evidence', () => {
  const p = fixtureRegistry({
    healthVocabulary: ['HEALTHY'],
    connectors: [{ connectorId: 'cited', plane: 'INTEGRATION', health: 'HEALTHY',
      healthEvidence: { observedAt: '2026-08-23T11:30:00Z', method: 'm', result: 'r' } }],
  });
  const out = M.projectConnectors(NOW, { registryPath: p });
  assert.strictEqual(out.source, path.relative(ROOT, p), 'the projection did not cite the file it actually read');
  assert.notStrictEqual(out.source, 'builder-control/connector-registry.json',
    'an injected fixture reported itself as the canonical registry');
  assert.strictEqual(out.connectors[0].source, path.relative(ROOT, p));
  // And the canonical default still cites canonical.
  assert.strictEqual(M.projectConnectors(NOW).source, 'builder-control/connector-registry.json');
});

// ── no optimistic defaults ──────────────────────────────────────────────────
test('a connector with no health evidence is UNKNOWN, never HEALTHY', () => {
  const p = fixtureRegistry({
    connectors: [{ connectorId: 'ghost', plane: 'INTEGRATION', health: 'HEALTHY' }],
  });
  const g = M.projectConnectors(NOW, { registryPath: p }).connectors[0];
  assert.strictEqual(g.health, 'UNKNOWN', 'a claimed HEALTHY with no evidence must degrade to UNKNOWN');
  assert.strictEqual(g.staleness.state, 'UNVERIFIED');
});

test('stale evidence is reported with its age and does NOT overwrite last-known health', () => {
  const p = fixtureRegistry({
    stalenessThresholdMinutes: 60,
    healthVocabulary: ['HEALTHY', 'UNKNOWN'],
    connectors: [{
      connectorId: 'aged', plane: 'INTEGRATION', health: 'HEALTHY',
      healthEvidence: { observedAt: '2026-08-23T06:00:00Z', method: 'm', result: 'r' },
    }],
  });
  const c = M.projectConnectors(NOW, { registryPath: p }).connectors[0];
  assert.strictEqual(c.staleness.state, 'STALE');
  assert.strictEqual(c.staleness.ageMinutes, 360, 'age must be computed, not asserted');
  // Overwriting health would destroy the only reading we have; hiding the age
  // would let a six-hour-old reading pose as live. Both are required.
  assert.strictEqual(c.health, 'HEALTHY', 'last-known health is preserved and qualified, not erased');
});

test('fresh evidence inside the threshold is FRESH', () => {
  const p = fixtureRegistry({
    stalenessThresholdMinutes: 60,
    healthVocabulary: ['HEALTHY'],
    connectors: [{ connectorId: 'new', plane: 'INTEGRATION', health: 'HEALTHY',
      healthEvidence: { observedAt: '2026-08-23T11:30:00Z', method: 'm', result: 'r' } }],
  });
  const c = M.projectConnectors(NOW, { registryPath: p }).connectors[0];
  assert.strictEqual(c.staleness.state, 'FRESH');
  assert.strictEqual(c.staleness.ageMinutes, 30);
});

test('a missing registry renders UNAVAILABLE rather than an empty healthy list', () => {
  // Staged by pointing at a path where no file exists — NOT by deleting the
  // canonical registry, which is what this case used to do.
  const p = absentRegistry();
  assert.ok(!fs.existsSync(p), 'the fixture path must not exist for this case to mean anything');
  const out = M.projectConnectors(NOW, { registryPath: p });
  assert.strictEqual(out.state, 'UNAVAILABLE');
  assert.ok(/not found/.test(out.reason));
  assert.deepStrictEqual(out.connectors, []);
  assert.ok(fs.existsSync(REGISTRY), 'the canonical registry must still be on disk');
});

// ── failure isolation is structural ─────────────────────────────────────────
test('engineering and integration are separate objects with no blended health field', () => {
  const snap = M.snapshot({});
  assert.ok(snap.engineering, 'engineering missing');
  assert.ok(snap.integration, 'integration missing');
  // The moment a combined field exists, somebody lets a failed connector
  // darken a verified build. There must be nowhere to put that.
  for (const k of ['overallHealth', 'systemHealth', 'health', 'status', 'score', 'percentComplete']) {
    assert.ok(!(k in snap), `snapshot must not expose a blended "${k}" field`);
  }
  assert.ok(!('engineering' in snap.integration) && !('integration' in snap.engineering),
    'the two planes must not nest inside each other');
});

// ── stage derivation never invents a pass ───────────────────────────────────
test('a required reviewer with no bound record derives MISSING, not PASS', () => {
  const stages = M.deriveStages({
    ok: false,
    classification: { lane: 'FULL', highRisk: true, requiredReviewers: ['codex', 'grok'] },
    problems: [
      { rule: 'ENGOS-REVIEW-MISSING', detail: 'codex is required for lane FULL/high-risk and has no valid review record' },
      { rule: 'ENGOS-REVIEW-MISSING', detail: 'grok is required for lane FULL/high-risk and has no valid review record' },
    ],
    observed: [],
  });
  const by = Object.fromEntries(stages.map((s) => [s.id, s]));
  // Per-reviewer stages became ONE contract step (7). The property is unchanged:
  // a required reviewer with no bound record must render MISSING, never PASS.
  assert.strictEqual(by.review.state, 'MISSING');
  assert.ok(/2 required reviewer/.test(by.review.reason), 'the count of missing reviewers must be visible');
});

test('runtime and checkpoint are ALWAYS UNVERIFIED — this gate cannot speak to them', () => {
  const stages = M.deriveStages({
    ok: true, state: 'READY_FOR_PR',
    classification: { lane: 'FULL', highRisk: false, requiredReviewers: [] },
    problems: [], observed: ['deterministic checks executed here: 3/3 passed'],
  });
  const by = Object.fromEntries(stages.map((s) => [s.id, s]));
  // Even on a fully passing GATE, the runtime steps must not read PASS — the
  // gate has no visibility into whether a checkpoint or rollback ever happened.
  // That separation is the point: one authority cannot vouch for another's work.
  assert.strictEqual(by.checkpoint.state, 'UNVERIFIED');
  assert.strictEqual(by.watchdog.state, 'UNVERIFIED');
  assert.strictEqual(by.worktree.state, 'UNVERIFIED');
});

test('deterministic checks read UNVERIFIED when the gate did not run them itself', () => {
  const stages = M.deriveStages({
    ok: false, classification: { lane: 'FULL', highRisk: false, requiredReviewers: [] },
    problems: [], observed: ['lane FULL'],
  });
  const d = stages.find((s) => s.id === 'deterministic');
  assert.strictEqual(d.state, 'UNVERIFIED');
  assert.ok(/did not execute the checks itself/.test(d.reason),
    'the reason must say the gate did not run the checks — "someone ran them somewhere" is not evidence here');
});

test('a lane requiring no reviewer still does not render review as PASS', () => {
  // The old per-reviewer NOT_REQUIRED stage is gone with the nine-stage model.
  // The surviving property: step 7 must not claim approval when no reviewer was
  // required and none ran — "not required" is not "approved".
  const stages = M.deriveStages({
    ok: true, classification: { lane: 'LIGHT', highRisk: false, requiredReviewers: [] },
    problems: [], observed: [],
  }, []);
  assert.strictEqual(stages.find((s) => s.id === 'review').state, 'UNVERIFIED');
});

// ── provenance ──────────────────────────────────────────────────────────────
test('every projected section cites the artifact it came from', () => {
  const snap = M.snapshot({});
  assert.ok(snap.engineering.source, 'engineering has no source');
  assert.ok(snap.integration.connectors.connectors.every((c) => !!c.source), 'a connector has no source');
  assert.ok(snap.reviewers.reviewers.every((r) => !!r.source), 'a reviewer has no source');
  assert.ok(snap.events.source || snap.events.state !== 'OK', 'events have no source');
});

test('the snapshot declares its three honest absences', () => {
  const snap = M.snapshot({});
  assert.deepStrictEqual(snap.contract.absences, ['UNAVAILABLE', 'STALE', 'UNVERIFIED']);
});

test('the ledger is the event source — no second event store is introduced', () => {
  const snap = M.snapshot({});
  assert.ok(/ledger\.json$/.test(snap.events.source || ''), 'events must come from the existing ledger');
  assert.ok(typeof snap.events.total === 'number' && snap.events.total > 0);
});

// ── CODEX REVIEW CYCLE 1 — confirmed finding #8 ────────────────────────────
test('finding #8 (still holds): build is NOT PASS without a real builder exit', () => {
  // Originally: a subject diff existing was rendered as a passing build. Now
  // build reads run.build.exit, so the same lie has a new shape — a run with no
  // build at all must not render PASS.
  const stages = M.deriveStages({ ok: false, problems: [], observed: [] },
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x' }]);
  const b = stages.find((s) => s.id === 'build');
  assert.strictEqual(b.state, 'UNVERIFIED');
  assert.ok(/has not run/.test(b.reason));
});

test('finding #8 (still holds): a builder exit of 0 is required for PASS', () => {
  const ok = M.deriveStages({ ok: false, problems: [], observed: [] },
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x', build: { exit: 0 },
      watchdog: { corroboratedStages: ['BUILT'] } }]);
  assert.strictEqual(ok.find((s) => s.id === 'build').state, 'PASS');
  const bad = M.deriveStages({ ok: false, problems: [], observed: [] },
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x', build: { exit: 2 } }]);
  assert.strictEqual(bad.find((s) => s.id === 'build').state, 'FAILED');
});

test('finding #8: a required reviewer does NOT default to PASS on an unrecognised rule', () => {
  // A rule the stage mapper does not specifically recognise (stale binding,
  // short coverage, ambiguity) previously fell through to PASS.
  const stages = M.deriveStages({
    ok: false,
    classification: { lane: 'FULL', highRisk: true, requiredReviewers: ['codex', 'grok'] },
    subject: { subjectPaths: ['src/a.ts'] },
    problems: [{ rule: 'ENGOS-REVIEW-COVERAGE-SHORT', detail: 'REV-1 (codex) did not cover 4 subject path(s)' }],
    observed: [],
  });
  const by = Object.fromEntries(stages.map((s) => [s.id, s]));
  // The per-reviewer stages were replaced by ONE contract step (7, review), so
  // this now asserts the same property on that step: an unrecognised failure
  // must never render as an approval.
  assert.notStrictEqual(by.review.state, 'PASS', 'an unrecognised failure must never render as an approval');
  assert.ok(['FAILED', 'MISSING', 'UNVERIFIED'].includes(by.review.state));
});

test('finding #8: a reviewer reaches PASS only on a positively observed approval', () => {
  const subjectSha256 = '7'.repeat(64);
  const stages = M.deriveStages({
    ok: true, state: 'READY_FOR_DETERMINISTIC_VALIDATION',
    classification: { lane: 'FULL', highRisk: false, requiredReviewers: ['codex'] },
    subject: { subjectSha256, subjectPaths: ['src/a.ts'] },
    problems: [], observed: ['codex: APPROVE'],
  }, [{ runId: 'RUN-20260829-70000001', updatedAt: '2026-08-29T10:00:00.000Z',
    subjectSha256 }]);
  assert.strictEqual(stages.find((s) => s.id === 'review').state, 'PASS');
});

test('review stage binds approvals to the canonical selected-run subject and fails closed on drift', () => {
  const gateSubject = '8'.repeat(64);
  const approvedGate = {
    ok: true, state: 'READY_FOR_PR',
    classification: { lane: 'FULL', highRisk: false, requiredReviewers: ['codex'] },
    subject: { subjectSha256: gateSubject, subjectPaths: ['src/a.ts'] },
    problems: [], observed: ['codex: APPROVE'],
  };
  const current = (subjectSha256) => ({
    runId: 'RUN-20260829-80000001', updatedAt: '2026-08-29T11:00:00.000Z', subjectSha256,
  });

  const matching = M.deriveStages(approvedGate, [current(gateSubject)])
    .find((stage) => stage.id === 'review');
  assert.strictEqual(matching.state, 'PASS', 'equal canonical gate/run subjects lost review PASS');

  const mismatched = M.deriveStages(approvedGate, [current('9'.repeat(64))])
    .find((stage) => stage.id === 'review');
  assert.notStrictEqual(mismatched.state, 'PASS', 'approval for another subject passed the current run');
  assert.match(mismatched.reason, /review subject mismatch.*does not cover the current run subject/);

  const unlinked = M.deriveStages(approvedGate, [current(null)])
    .find((stage) => stage.id === 'review');
  assert.notStrictEqual(unlinked.state, 'PASS', 'an unlinked current run borrowed gate approval');
  assert.match(unlinked.reason, /current run is not linked to a canonical subject/);

  const noRun = M.deriveStages(approvedGate, []).find((stage) => stage.id === 'review');
  assert.notStrictEqual(noRun.state, 'PASS', 'page-level approval passed with no current run');
  assert.match(noRun.reason, /no current run is available/);
});

test('review stage never lets approval labels or coverage override a blocked gate', () => {
  const subjectSha256 = '6'.repeat(64);
  const run = [{ runId: 'RUN-20260829-60000001', subjectSha256,
    updatedAt: '2026-08-29T11:30:00.000Z' }];
  const complete = {
    complete: true,
    rows: [{ reviewer: 'codex', required: 'REQUIRED', executed: 'EXECUTED', disposition: 'APPROVE' }],
  };
  for (const rule of [
    'ENGOS-OPEN-BLOCKING-FINDING',
    'ENGOS-REVIEW-COVERAGE-SHORT',
    'ENGOS-REVIEW-COVERAGE-EXTRA',
    'ENGOS-REVIEW-MALFORMED',
    'ENGOS-AMBIGUOUS-REVIEWS',
    'ENGOS-REVIEW-WRONG-PACKET',
  ]) {
    const stage = M.deriveStages({
      ok: false, state: 'BLOCKED', subject: { subjectSha256 },
      problems: [{ rule, detail: 'synthetic blocking gate evidence for projection proof' }],
      observed: ['codex: APPROVE'], reviewerCompleteness: complete,
    }, run).find((item) => item.id === 'review');
    assert.strictEqual(stage.state, 'FAILED', `${rule} was overridden by approval/coverage`);
    assert.match(stage.reason, /gate is blocked|parsed engineering gate is blocked/);
  }
  const blockedWithoutNamedProblem = M.deriveStages({
    ok: false, state: 'BLOCKED', subject: { subjectSha256 }, problems: [],
    observed: ['codex: APPROVE'], reviewerCompleteness: complete,
  }, run).find((item) => item.id === 'review');
  assert.strictEqual(blockedWithoutNamedProblem.state, 'FAILED');
  assert.match(blockedWithoutNamedProblem.reason, /parsed engineering gate is blocked/);
});

// ── VISUAL INTEGRATION: the ELEVEN canonical steps ────────────────────────
// Visual QA found the dashboard still projecting a nine-stage topology that
// predated the runtime — steps 1, 2, 4, 5 and 8 were absent from the screen
// while the code that performs them existed and was tested. The projection must
// match the contract exactly: not nine, not "at least eleven", exactly eleven.
test('RED: the projection carries EXACTLY the 11 contract steps, in order', () => {
  const snap = M.snapshot({});
  const stages = snap.engineering.stages;
  assert.strictEqual(stages.length, 11, `expected 11 contract steps, got ${stages.length}`);
  assert.deepStrictEqual(stages.map((s) => s.step), [1,2,3,4,5,6,7,8,9,10,11],
    'steps must be numbered 1..11 in contract order');
  assert.deepStrictEqual(stages.map((s) => s.id), [
    'objective','acceptance','routing','worktree','build',
    'deterministic','review','correction','watchdog','checkpoint','surface',
  ]);
  // Every step must name where its state is read from.
  for (const st of stages) {
    assert.ok(st.evidence && st.evidence.length > 0, `step ${st.step} names no evidence source`);
    assert.ok(st.reason && st.reason.length > 0, `step ${st.step} gives no reason for its state`);
  }
});

test('RED: with NO run records, runtime steps are UNVERIFIED — never PASS', () => {
  // deriveStages is pure over (gateVerdict, runs). No runs means nothing was
  // exercised, and "nothing was exercised" must never render as success.
  const stages = M.deriveStages({ ok: false, problems: [], observed: [] }, []);
  const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
  for (const id of ['objective','acceptance','routing','worktree','build','correction','watchdog','checkpoint']) {
    assert.strictEqual(byId[id].state, 'UNVERIFIED',
      `${id} claimed ${byId[id].state} with no run evidence at all`);
  }
});

test('RED: a FAILED build never renders as PASS', () => {
  const stages = M.deriveStages({ ok: false, problems: [], observed: [] },
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x', build: { exit: 1 } }]);
  const build = stages.find((s) => s.id === 'build');
  assert.strictEqual(build.state, 'FAILED');
  assert.ok(/exited 1/.test(build.reason));
});

test('active asynchronous BUILDING states remain RUNNING until a terminal exit exists', () => {
  for (const workerState of ['LAUNCH_CLAIMED', 'STARTING', 'RUNNING']) {
    const stages = M.deriveStages({ problems: [], observed: [] }, [{
      runId: 'RUN-20260829-a11ce001', state: 'BUILDING',
      createdAt: '2026-08-28T10:00:00.000Z', updatedAt: '2026-08-28T10:01:00.000Z',
      objective: 'active build', build: { mode: 'async', workerState, exit: null },
      watchdog: { corroboratedStages: ['BUILDING'] },
    }]);
    const build = stages.find((stage) => stage.id === 'build');
    assert.strictEqual(build.state, 'RUNNING', `${workerState} was not projected as in progress`);
    assert.match(build.reason, new RegExp(workerState));
    assert.doesNotMatch(build.reason, /exited null/);
  }
});

test('only terminal numeric builder exits produce PASS or exit-derived FAILED', () => {
  for (const [exit, expected] of [[0, 'PASS'], [1, 'FAILED'], [124, 'FAILED']]) {
    const stages = M.deriveStages({ problems: [], observed: [] }, [{
      runId: 'RUN-20260829-a11ce002', state: exit === 0 ? 'BUILT' : 'BUILD_FAILED',
      createdAt: '2026-08-28T10:00:00.000Z', updatedAt: '2026-08-28T10:01:00.000Z',
      objective: 'terminal build', build: { mode: 'async', workerState: 'EXITED', exit },
      watchdog: { corroboratedStages: exit === 0 ? ['BUILT'] : [] },
    }]);
    assert.strictEqual(stages.find((stage) => stage.id === 'build').state, expected,
      `exit ${exit} did not produce ${expected}`);
  }
  const unknown = M.deriveStages({ problems: [], observed: [] }, [{
    runId: 'RUN-20260829-a11ce003', state: 'BUILT',
    createdAt: '2026-08-28T10:00:00.000Z', updatedAt: '2026-08-28T10:01:00.000Z',
    objective: 'missing terminal evidence', build: { mode: 'async', workerState: 'EXITED', exit: null },
  }]).find((stage) => stage.id === 'build');
  assert.strictEqual(unknown.state, 'UNVERIFIED');
});

test('contradictory builder state and terminal exit fail closed', () => {
  const project = (state, exit) => M.deriveStages({ problems: [], observed: [] }, [{
    runId: `RUN-20260829-${state.toLowerCase()}1`, state,
    createdAt: '2026-08-28T10:00:00.000Z', updatedAt: '2026-08-28T10:01:00.000Z',
    objective: 'contradictory build evidence',
    build: { mode: 'async', workerState: 'EXITED', exit },
  }]).find((stage) => stage.id === 'build');

  const failedWithZero = project('BUILD_FAILED', 0);
  assert.strictEqual(failedWithZero.state, 'FAILED');
  assert.match(failedWithZero.reason, /BUILD_FAILED.*exit is 0/);

  const buildingWithExit = project('BUILDING', 0);
  assert.strictEqual(buildingWithExit.state, 'FAILED');
  assert.match(buildingWithExit.reason, /still says BUILDING.*terminal builder exit 0/);
});

test('RED: a checkpoint with no rollback point is FAILED, not PASS', () => {
  const stages = M.deriveStages({ ok: false, problems: [], observed: [] },
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x', checkpoint: { checkpointId: 'CP-1' } }]);
  assert.strictEqual(stages.find((s) => s.id === 'checkpoint').state, 'FAILED');
});

test('a future watchdog stage missing without a corroborated prefix stays UNVERIFIED', () => {
  const stages = M.deriveStages({ ok: false, problems: [], observed: [] },
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x',
       watchdog: { ok: false, problems: [{ rule: 'WATCHDOG-STAGE-MISSING' }] } }]);
  const w = stages.find((s) => s.id === 'watchdog');
  assert.strictEqual(w.state, 'UNVERIFIED');
  assert.match(w.reason, /no correctly ordered canonical lifecycle prefix/i);
});

// ── COST SEMANTICS ────────────────────────────────────────────────────────
test('RED: an unrecorded run is UNRECORDED — never zero, never estimated', () => {
  const c = M.projectCost();
  assert.strictEqual(c.state, 'OK');
  for (const r of c.runs || []) {
    if (r.usd === null) {
      assert.strictEqual(r.state, 'UNRECORDED', 'a run with no telemetry must be UNRECORDED');
      assert.ok(r.reason && r.reason.length > 0, 'UNRECORDED must say why');
    } else {
      assert.ok(typeof r.usd === 'number' && Number.isFinite(r.usd));
    }
  }
  // No estimation anywhere in the projector.
  // Check CODE, not prose: the first version of this proof matched the comment
  // that says costs are never estimated, which is the opposite of a defect.
  const src = fs.readFileSync(path.join(__dirname, '..', 'aegis-state.cjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/=\s*[^\n]*\b(estimate|approximate|guess)\w*\(/i.test(src),
    'the cost projector must not compute an estimate — one presented beside real figures reads as real');
});

test('RED: the headline total says AT LEAST while any run lacks telemetry', () => {
  const c = M.projectCost();
  if (c.unrecordedRuns > 0) {
    assert.ok(/^AT LEAST /.test(String(c.totalUsd)),
      `with ${c.unrecordedRuns} unrecorded run(s) the total must be "AT LEAST n", got ${c.totalUsd}`);
    assert.ok(c.caveat && /higher/.test(c.caveat), 'the caveat must state the true total is higher');
  }
});

test('RED: recorded spend is a sum of real telemetry, not a stored number', () => {
  const c = M.projectCost();
  const sum = (c.runs || []).filter((r) => typeof r.usd === 'number').reduce((n, r) => n + r.usd, 0);
  assert.ok(Math.abs(sum - c.recordedUsd) < 1e-12,
    `recordedUsd ${c.recordedUsd} is not the exact sum of per-run telemetry ${sum}`);
  // The display figure may round, but only UPWARD — understating spend against
  // a ceiling would make an overrun look like headroom.
  assert.ok(c.recordedUsdDisplay >= c.recordedUsd,
    `display figure ${c.recordedUsdDisplay} understates the real ${c.recordedUsd}`);
});

// ── CANONICAL PROVENANCE ──────────────────────────────────────────────────
test('RED: the projector reads canonical artifacts only — no private store', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'aegis-state.cjs'), 'utf8');
  // It may READ the runtime and the gate; it may not WRITE anything but its own
  // output file, or it would become a second authority.
  const writes = src.match(/writeFileSync\([^)]*/g) || [];
  for (const w of writes) {
    assert.ok(/args\.out|outPath/.test(w),
      `the projector writes something other than its own output: ${w.slice(0, 70)}`);
  }
  assert.ok(/require\('\.\/aegis-run\.cjs'\)/.test(src), 'runtime evidence must come from the runtime');
  assert.ok(/engineering-os\.cjs|ENGOS/.test(src), 'gate evidence must come from the gate');
});

// ── N8N REMOVAL — permanent regression ──────────────────────────────────────
// n8n was removed from AEGIS entirely per operator directive. This proves the
// active connector registry, active specs, active drift taxonomy, and the
// active ENGINEERING-OS-V1 packet carry no n8n reference and no connector or
// provider named n8n. Backups, signed reviews, and raw review transcripts are
// audit history and are deliberately excluded.
test('N8N REMOVAL: no active AEGIS file contains a whole-word "n8n" reference', () => {
  const activeFiles = [
    path.join(ROOT, 'builder-control', 'connector-registry.json'),
    path.join(ROOT, 'builder-control', 'DRIFT-TAXONOMY.md'),
    path.join(ROOT, 'builder-control', 'packets', 'ENGINEERING-OS-V1.json'),
    path.join(ROOT, 'builder-control', 'specs', 'AEGIS-AMENDMENT-KNOWLEDGE-MIRROR-2026-08-24.md'),
    path.join(ROOT, 'builder-control', 'specs', 'AEGIS-AMENDMENT-INTEGRATION-BUS-2026-08-23.md'),
  ];
  const n8nWordBoundary = /\bn8n\b/i;
  for (const f of activeFiles) {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!n8nWordBoundary.test(content), `${path.relative(ROOT, f)} still contains a whole-word "n8n" reference`);
  }
});

test('N8N REMOVAL: the connector registry defines no n8n connector, id, or provider', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  for (const c of reg.connectors) {
    assert.notStrictEqual(String(c.connectorId || '').toLowerCase(), 'n8n', 'a connector still uses connectorId "n8n"');
    assert.notStrictEqual(String(c.label || '').toLowerCase(), 'n8n', 'a connector still uses label "n8n"');
    assert.notStrictEqual(String(c.provider || '').toLowerCase(), 'n8n', 'a connector still uses provider "n8n"');
  }
});

// ── CORRECTION CYCLE 1 (PKT-20260825-GOVERNANCE-TRUTH) ─────────────────────
// The gate already computes reviewer completeness and the three independent
// connector facts; this projector defined the functions for them and then
// never called them. These proofs hold the wiring, not just the math.

test('engineering surfaces reviewerCompleteness when the attributed gate is available and fails closed otherwise', () => {
  const snap = M.snapshot({});
  if (snap.engineering.state === 'UNAVAILABLE') {
    assert.ok(!snap.engineering.reviewerCompleteness,
      'an unavailable attributed gate fabricated reviewer completeness');
    assert.match(snap.engineering.reason,
      /current run worktree|gate verdict|digest-bound canonical check receipt/);
    return;
  }
  assert.ok(snap.engineering.reviewerCompleteness, 'the gate\'s reviewerCompleteness table is not reaching the dashboard projection');
  const rc = snap.engineering.reviewerCompleteness;
  assert.ok(Array.isArray(rc.rows) && rc.rows.length > 0, 'reviewerCompleteness has no rows');
  for (const row of rc.rows) {
    assert.ok(['PLANNED', 'NOT_PLANNED'].includes(row.planned), `row ${row.reviewer} has an unrecognised planned value "${row.planned}"`);
    assert.ok(['REQUIRED', 'ADVISORY', 'NOT_REQUIRED'].includes(row.required), `row ${row.reviewer} has an unrecognised required value "${row.required}"`);
    assert.ok(['MISSING', 'STALE', 'UNAVAILABLE', 'EXECUTED'].includes(row.executed), `row ${row.reviewer} has an unrecognised executed value "${row.executed}"`);
    assert.ok(typeof row.score === 'string' && row.score.length > 0, `row ${row.reviewer} has no score — must be "UNAVAILABLE" or a coverage count`);
  }
});

// ── CORRECTION CYCLE 3, G1 FINDING #1 ──────────────────────────────────────
// The proof above checked SHAPE and nothing else: any object carrying
// enum-shaped rows satisfied it. It never compared the table's subject hash
// with the page's, never required the deterministic Codex+Grok roster, and
// never checked that covered/missing/stale paths actually partition the current
// subject. A stale or foreign-subject projection could therefore pass this
// suite while the dashboard reported reviewer completeness for a change nobody
// had reviewed.
//
// `partition` is the invariant that closes it: covered ∪ missing = subject
// EXACTLY, covered ∩ missing = ∅, and stale ∩ subject = ∅. Anything else means
// the table is describing a different change than the one on the page.
function assertPathPartition(label, subjectPaths, covered, missing, stale) {
  const subj = new Set(subjectPaths);
  const cov = new Set(covered);
  const mis = new Set(missing);
  assert.strictEqual(cov.size, covered.length, `${label}: coveredPaths contains duplicates`);
  assert.strictEqual(mis.size, missing.length, `${label}: missingPaths contains duplicates`);
  for (const p of covered) assert.ok(subj.has(p), `${label}: coveredPaths names "${p}", which is not part of this subject`);
  for (const p of missing) assert.ok(subj.has(p), `${label}: missingPaths names "${p}", which is not part of this subject`);
  for (const p of covered) assert.ok(!mis.has(p), `${label}: "${p}" is reported as both covered and missing`);
  assert.strictEqual(covered.length + missing.length, subjectPaths.length,
    `${label}: ${covered.length} covered + ${missing.length} missing does not account for all ${subjectPaths.length} subject path(s)`);
  for (const p of stale) assert.ok(!subj.has(p), `${label}: stalePaths names "${p}", which IS part of this subject and so is not stale`);
}

test('G1 #1: the reviewer table on the page is bound to the EXACT subject the page is gated on', () => {
  const snap = M.snapshot({});
  const eng = snap.engineering;
  if (eng.state !== 'OK') { assert.ok(eng.reason, 'an unavailable gate must say why'); return; }
  const rc = eng.reviewerCompleteness;
  assert.ok(rc, 'no reviewerCompleteness table reached the projection');
  // Exact equality, not a prefix and not a truthiness check. A table computed
  // against any other subject must not be renderable beside this verdict.
  assert.strictEqual(rc.subjectSha256, eng.subjectSha256,
    'the reviewer completeness table is bound to a different subject hash than the gate verdict on the same page');
  assert.ok(/^[0-9a-f]{64}$/.test(String(rc.subjectSha256)), 'the bound subject is not a sha256 digest');
  assert.strictEqual(rc.lane, eng.lane, 'the table reports a different lane than the verdict beside it');
});

test('G1 #1: every REQUIRED reviewer has a row, and the required set is the gate\'s own — not the table\'s opinion', () => {
  const snap = M.snapshot({});
  const eng = snap.engineering;
  if (eng.state !== 'OK') return;
  const rc = eng.reviewerCompleteness;
  assert.deepStrictEqual(rc.required.slice().sort(), (eng.requiredReviewers || []).slice().sort(),
    'the table\'s required roster disagrees with the classifier\'s required roster');
  assert.ok(rc.required.length > 0, 'no reviewer is required — a lane with no required reviewer cannot report completeness');
  for (const name of rc.required) {
    const row = rc.rows.find((r) => r.reviewer === name);
    assert.ok(row, `required reviewer ${name} has no row at all — a missing row reads as nothing to report`);
    assert.strictEqual(row.required, 'REQUIRED', `${name} is required by the classifier but the row calls it ${row.required}`);
  }
  // AGENTS.md: FULL lane requires Codex AND Grok, every time.
  if (eng.lane === 'FULL') {
    for (const name of ['codex', 'grok']) {
      assert.ok(rc.required.includes(name), `lane FULL must require ${name}; required = ${JSON.stringify(rc.required)}`);
    }
  }
});

test('G1 #1: covered, missing and stale paths partition the current subject exactly', () => {
  const snap = M.snapshot({});
  const eng = snap.engineering;
  if (eng.state !== 'OK') return;
  const rc = eng.reviewerCompleteness;
  const subjectPaths = eng.subjectPaths || [];
  for (const row of rc.rows) {
    assertPathPartition(`row ${row.reviewer}`, subjectPaths, row.coveredPaths, row.missingPaths, row.stalePaths);
  }
  assert.strictEqual(rc.pathCoverage.total, subjectPaths.length, 'pathCoverage.total is not the subject path count');
  assertPathPartition('pathCoverage', subjectPaths,
    rc.pathCoverage.coveredByEveryRequiredReviewer, rc.pathCoverage.notCoveredByEveryRequiredReviewer, []);
});

test('G1 #1: completeness is a consequence of the rows, never a standalone claim', () => {
  const snap = M.snapshot({});
  const eng = snap.engineering;
  if (eng.state !== 'OK') return;
  const rc = eng.reviewerCompleteness;
  const requiredRows = rc.rows.filter((r) => r.required === 'REQUIRED');
  if (rc.complete) {
    assert.ok(requiredRows.length > 0, 'complete was claimed with no required reviewer rows to support it');
    for (const row of requiredRows) {
      assert.strictEqual(row.executed, 'EXECUTED', `complete was claimed while ${row.reviewer} reads ${row.executed}`);
      assert.deepStrictEqual(row.missingPaths, [], `complete was claimed while ${row.reviewer} left paths unread`);
      assert.deepStrictEqual(row.stalePaths, [],
        `complete was claimed while ${row.reviewer} claims file(s) outside this change — that record describes a different change`);
    }
    assert.ok(/^Every required reviewer/.test(rc.completeReason || ''),
      'complete was claimed without a plain-English sentence saying what makes it complete');
  } else if (rc.completeReason) {
    assert.ok(/INCOMPLETE/.test(rc.completeReason),
      'incomplete coverage was reported with a sentence that does not say it is incomplete');
  }
  // A record bound to some other version can NEVER be the current subject's.
  for (const row of rc.rows) {
    for (const s of row.staleRecords || []) {
      assert.notStrictEqual(s.boundToSubject, rc.subjectSha256,
        `${row.reviewer} record ${s.reviewId} is filed as stale yet claims this exact subject`);
    }
    if ((row.staleRecords || []).length && !row.reviewId) {
      assert.notStrictEqual(row.executed, 'EXECUTED',
        `${row.reviewer} has only different-subject records and still reads EXECUTED`);
    }
  }
});

// ── controlled evidence: current-subject vs stale-subject ──────────────────
// The live snapshot proves the WIRING. These prove the RULE, against evidence
// this test constructs, because "a stale review cannot become EXECUTED" is not
// demonstrated by a repository that happens to contain no fresh review.
//
// The gate is driven directly through its documented test-only synthetic
// boundary (both halves: the flag AND the environment variable), which also
// means review evidence comes ONLY from the explicit --review records below —
// nothing in builder-control/reviews/ can leak in and nothing here can leak out.
const RC_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-state-rc-'));
const RC_SIGNER = require('../review-sign.cjs');
const RC_PACKET_ID = 'PKT-TEST-AEGIS-STATE-REVIEWER-COMPLETENESS';
const RC_CHANGED = ['src/app.ts', 'src/lib.ts'];
const RC_STALE_SHA = 'b'.repeat(64);

const RC_PACKET = (() => {
  const real = path.join(ROOT, 'builder-control', 'packets', 'PKT-20260825-GOVERNANCE-TRUTH.json');
  const base = JSON.parse(fs.readFileSync(real, 'utf8'));
  // A DISTINCT packetId so nothing in packets/ can be mistaken for the
  // authority that signed these fixtures.
  base.packetId = RC_PACKET_ID;
  base.filesAllowed = ['src/**'];
  base.authorization = { ...base.authorization, allowsProtectedPaths: ['src/**'] };
  const p = path.join(RC_TMP, 'fixture-packet.json');
  fs.writeFileSync(p, JSON.stringify(base, null, 2));
  return p;
})();

function rcGate(args) {
  const r = spawnSync('node', [path.join(ROOT, 'builder-control', 'engineering-os.cjs'), ...args, '--test-only-synthetic-subject'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ENGOS_TEST_ONLY_SYNTHETIC: '1' },
  });
  try { return JSON.parse(r.stdout); }
  catch { throw new Error(`gate produced no JSON verdict (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(0, 300)}`); }
}

// The subject hash for the fixture paths, computed by the SAME calculator the
// gate uses. Binding fixtures to a made-up digest would test nothing.
const RC_SUBJECT = (() => {
  const a = ['--subject', '--json', '--diff-lines', '10'];
  for (const c of RC_CHANGED) a.push('--changed', c);
  return rcGate(a).subjectSha256;
})();

let rcSeq = 0;
function rcReview(reviewer, diffSha256, changedPaths, disposition = 'APPROVE') {
  const rec = {
    reviewId: `REV-TEST-G1-${reviewer}-${rcSeq++}`,
    ts: '2026-08-25T00:00:00.000Z',
    reviewer, reviewerModel: 'fixture',
    packetId: RC_PACKET_ID,
    reviewOf: { diffSha256, baseRef: 'main', headRef: 'HEAD', changedPaths },
    disposition, findings: [], unverified: [],
  };
  const p = path.join(RC_TMP, `${rec.reviewId}.json`);
  fs.writeFileSync(p, JSON.stringify(RC_SIGNER.sign(rec, { packetPath: RC_PACKET }), null, 2));
  return p;
}

function rcCompleteness(reviewPaths) {
  const a = ['--gate-done', '--json', '--subject-sha', RC_SUBJECT, '--packet', RC_PACKET, '--diff-lines', '10'];
  for (const c of RC_CHANGED) a.push('--changed', c);
  for (const r of reviewPaths) a.push('--review', r);
  return rcGate(a).reviewerCompleteness;
}
const rcRow = (rc, name) => rc.rows.find((r) => r.reviewer === name);

test('G1 #1 RED: a review bound to a DIFFERENT subject stays STALE — it can never be EXECUTED or complete', () => {
  const rc = rcCompleteness([
    rcReview('codex', RC_STALE_SHA, RC_CHANGED),
    rcReview('grok', RC_STALE_SHA, RC_CHANGED),
  ]);
  assert.strictEqual(rc.subjectSha256, RC_SUBJECT, 'the table is not bound to the subject the gate was given');
  assert.notStrictEqual(rc.subjectSha256, RC_STALE_SHA, 'the stale review\'s subject became the table\'s subject');
  assert.strictEqual(rc.complete, false, 'a pair of different-subject reviews was counted as complete coverage');
  for (const name of ['codex', 'grok']) {
    const row = rcRow(rc, name);
    assert.strictEqual(row.executed, 'STALE', `${name} reads ${row.executed} for a review bound to another version`);
    assert.deepStrictEqual(row.coveredPaths, [], `${name} was credited with coverage from a different-subject review`);
    assert.deepStrictEqual(row.missingPaths, RC_CHANGED, `${name} must show every subject path as unread`);
    assert.strictEqual(row.score, 'UNAVAILABLE', `${name} published a coverage score off a stale record`);
    assert.strictEqual(row.staleRecords[0].boundToSubject, RC_STALE_SHA, 'the stale record\'s real subject must be disclosed, not hidden');
    assertPathPartition(`stale ${name}`, RC_CHANGED, row.coveredPaths, row.missingPaths, row.stalePaths);
  }
  assert.deepStrictEqual(rc.executed, [], 'a stale record was listed as executed');
  assert.deepStrictEqual(rc.missing.slice().sort(), ['codex', 'grok'], 'both required reviewers must be listed as missing');
  assert.deepStrictEqual(rc.pathCoverage.notCoveredByEveryRequiredReviewer, RC_CHANGED);
});

test('G1 #1: the required roster is deterministically Codex AND Grok, and both must cover every path', () => {
  const rc = rcCompleteness([
    rcReview('codex', RC_SUBJECT, RC_CHANGED),
    rcReview('grok', RC_SUBJECT, RC_CHANGED),
  ]);
  assert.deepStrictEqual(rc.required.slice().sort(), ['codex', 'grok'],
    `the required roster for this lane is not Codex+Grok: ${JSON.stringify(rc.required)}`);
  assert.strictEqual(rc.lane, 'FULL');
  for (const name of ['codex', 'grok']) {
    const row = rcRow(rc, name);
    assert.strictEqual(row.executed, 'EXECUTED', `${name} reviewed this exact subject and still reads ${row.executed}`);
    assert.deepStrictEqual(row.coveredPaths, RC_CHANGED);
    assert.deepStrictEqual(row.missingPaths, []);
    assert.deepStrictEqual(row.stalePaths, []);
    assertPathPartition(`fresh ${name}`, RC_CHANGED, row.coveredPaths, row.missingPaths, row.stalePaths);
  }
  assert.strictEqual(rc.complete, true, 'two exact-subject full-coverage reviews did not read as complete');
  assert.ok(/^Every required reviewer/.test(rc.completeReason),
    `exact full coverage produced no founder-readable completeness sentence: ${JSON.stringify(rc.completeReason)}`);
  assert.deepStrictEqual(rc.pathCoverage.coveredByEveryRequiredReviewer, RC_CHANGED);
  assert.deepStrictEqual(rc.pathCoverage.notCoveredByEveryRequiredReviewer, []);
});

test('G1 #1 RED: one required reviewer missing, or reading only part of the change, is never complete', () => {
  // Grok absent entirely.
  const codexOnly = rcCompleteness([rcReview('codex', RC_SUBJECT, RC_CHANGED)]);
  assert.strictEqual(rcRow(codexOnly, 'grok').executed, 'MISSING', 'an absent adversarial reviewer did not read MISSING');
  assert.strictEqual(codexOnly.complete, false, 'coverage was called complete with Grok absent');
  assert.deepStrictEqual(codexOnly.missing, ['grok']);
  assert.deepStrictEqual(codexOnly.pathCoverage.coveredByEveryRequiredReviewer, [],
    'paths were credited as covered by every required reviewer while one never ran');

  // Both present; Codex read one file of two.
  const partial = rcCompleteness([
    rcReview('codex', RC_SUBJECT, [RC_CHANGED[0]]),
    rcReview('grok', RC_SUBJECT, RC_CHANGED),
  ]);
  const codex = rcRow(partial, 'codex');
  assert.strictEqual(codex.executed, 'EXECUTED');
  assert.deepStrictEqual(codex.coveredPaths, [RC_CHANGED[0]]);
  assert.deepStrictEqual(codex.missingPaths, [RC_CHANGED[1]]);
  assert.strictEqual(partial.complete, false, 'partial reading of the change was counted as complete coverage');
  assert.deepStrictEqual(partial.pathCoverage.coveredByEveryRequiredReviewer, [RC_CHANGED[0]]);
  assert.deepStrictEqual(partial.pathCoverage.notCoveredByEveryRequiredReviewer, [RC_CHANGED[1]]);
  assertPathPartition('partial codex', RC_CHANGED, codex.coveredPaths, codex.missingPaths, codex.stalePaths);
});

test('G1 #1: a reviewer claiming a path outside this change has it reported as stale, never as coverage', () => {
  const rc = rcCompleteness([
    rcReview('codex', RC_SUBJECT, [...RC_CHANGED, 'src/not-in-this-change.ts']),
    rcReview('grok', RC_SUBJECT, RC_CHANGED),
  ]);
  const codex = rcRow(rc, 'codex');
  assert.deepStrictEqual(codex.stalePaths, ['src/not-in-this-change.ts'],
    'a path outside the subject was not reported as stale');
  assert.deepStrictEqual(codex.coveredPaths, RC_CHANGED, 'a foreign path leaked into the coverage count');
  assert.strictEqual(rc.pathCoverage.total, RC_CHANGED.length, 'a foreign path inflated the subject path total');
  assert.ok(/not part of this change/.test(codex.reason), 'the discrepancy must be stated in words, not only in an array');
  assertPathPartition('extra-path codex', RC_CHANGED, codex.coveredPaths, codex.missingPaths, codex.stalePaths);
});

// ── independent-review finding 2 ───────────────────────────────────────────
// The row above already reported the foreign path. The PROJECTION still said
// complete, because completeness only ever asked "did anyone leave a subject
// path unread?" — never "does this record describe anything else?". A reviewer
// whose record covers a wider set than the subject reviewed a different change;
// counting it as complete is how a review of the wrong thing reads as done.
test('G1 #1 RED: a required review claiming ANY path outside the exact subject is never complete', () => {
  const reviews = [
    rcReview('codex', RC_SUBJECT, [...RC_CHANGED, 'src/not-in-this-change.ts']),
    rcReview('grok', RC_SUBJECT, RC_CHANGED),
  ];
  const rc = rcCompleteness(reviews);
  const codex = rcRow(rc, 'codex');

  // The reviewer DID run against this exact subject and DID read every changed
  // file — so every older completeness input is satisfied. Only the extra path
  // distinguishes this from the passing case, which is the whole point.
  assert.strictEqual(codex.executed, 'EXECUTED', 'the fixture no longer exercises an executed, no-missing-path reviewer');
  assert.deepStrictEqual(codex.missingPaths, [], 'the fixture must isolate the extra path as the ONLY defect');
  assert.deepStrictEqual(codex.stalePaths, ['src/not-in-this-change.ts']);
  assert.deepStrictEqual(rcRow(rc, 'grok').stalePaths, [], 'the second reviewer must be clean so the verdict is attributable');

  assert.strictEqual(rc.complete, false,
    'a review claiming a file outside this change was counted as complete coverage of this change');

  // Founder-readable, not only a false boolean: it must name the state, the
  // reviewer, the foreign file, and what to do next.
  const reason = rc.completeReason || '';
  assert.ok(/INCOMPLETE/.test(reason), `completeness gave no incomplete explanation: ${JSON.stringify(reason)}`);
  assert.ok(/codex/.test(reason), 'the incomplete explanation does not name which reviewer is at fault');
  assert.ok(/src\/not-in-this-change\.ts/.test(reason), 'the incomplete explanation does not name the file that is not part of this change');
  assert.ok(/Re-run/.test(reason), 'the incomplete explanation does not say what to do about it');
  assert.ok(/not part of this change/.test(codex.reason) && /does not count as coverage/.test(codex.reason),
    `the reviewer row must say the record does not count, not merely that it differs: ${JSON.stringify(codex.reason)}`);
});

test('G1 #1 RED: the extra-path review still BLOCKS the gate on ENGOS-REVIEW-COVERAGE-EXTRA', () => {
  const a = ['--gate-done', '--json', '--subject-sha', RC_SUBJECT, '--packet', RC_PACKET, '--diff-lines', '10'];
  for (const c of RC_CHANGED) a.push('--changed', c);
  for (const r of [
    rcReview('codex', RC_SUBJECT, [...RC_CHANGED, 'src/not-in-this-change.ts']),
    rcReview('grok', RC_SUBJECT, RC_CHANGED),
  ]) a.push('--review', r);
  const verdict = rcGate(a);

  assert.strictEqual(verdict.ok, false, 'the gate passed a change whose review claims a file outside it');
  const extra = (verdict.problems || []).filter((p) => p.rule === 'ENGOS-REVIEW-COVERAGE-EXTRA');
  assert.strictEqual(extra.length, 1,
    `ENGOS-REVIEW-COVERAGE-EXTRA did not fire exactly once: ${JSON.stringify((verdict.problems || []).map((p) => p.rule))}`);
  assert.ok(/src\/not-in-this-change\.ts/.test(extra[0].detail), 'the blocking rule does not name the foreign path');

  // The rule and the projection must agree. A blocked gate whose completeness
  // table still reads complete is the exact disagreement this finding names.
  assert.strictEqual(verdict.reviewerCompleteness.complete, false,
    'the gate blocked on an extra path while its own completeness table reported complete');
});

test('projectAuthentication, projectLastVerified and projectLastUsedByRun are three independent, never-inferred facts', () => {
  const c = {
    connectorId: 'x',
    authStatus: 'AUTHENTICATED',
    authEvidence: { observedAt: '2026-08-23T11:30:00Z', authStatus: 'AUTHENTICATED', method: 'm' },
    healthEvidence: { observedAt: '2026-08-23T11:30:00Z', method: 'm', result: 'r', health: 'HEALTHY', outcome: 'SUCCESS' },
    usageEvidence: null,
  };
  const auth = M.projectAuthentication(c, NOW, 60);
  const ver = M.projectLastVerified(c, NOW, 60);
  const used = M.projectLastUsedByRun(c, []);
  assert.strictEqual(auth.state, 'AUTHENTICATED');
  assert.strictEqual(ver.state, 'FRESH');
  assert.strictEqual(used.state, 'UNAVAILABLE',
    'an authenticated, freshly verified connector with no run usage must still read UNAVAILABLE for usage — usage is never inferred from auth or health');
});

test('lastVerified reads STALE with its age shown, independent of authentication staying valid', () => {
  const c = {
    authStatus: 'AUTHENTICATED',
    authEvidence: { observedAt: '2026-08-23T11:45:00Z', authStatus: 'AUTHENTICATED', method: 'm' },
    healthEvidence: { observedAt: '2026-08-23T06:00:00Z', method: 'm', result: 'r', health: 'HEALTHY', outcome: 'SUCCESS' },
  };
  const ver = M.projectLastVerified(c, NOW, 60);
  assert.strictEqual(ver.state, 'STALE');
  assert.strictEqual(ver.ageMinutes, 360);
  assert.strictEqual(M.projectAuthentication(c, NOW, 60).state, 'AUTHENTICATED',
    'staleness in the health probe must not degrade the independently-recorded authentication fact');
});

// ── CORRECTION CYCLE 2 (Codex REV-20260825234549 findings 3 and 4) ─────────
// #3 authentication had no date of its own, and EVERY health receipt — a
//    timeout included — counted as a successful verification.
// #4 an uncorroborated registry claim was promoted straight to USED, with
//    "corroboration" meaning an operationId collision anywhere on the plane.
// Each proof below fails loudly against the previous implementation.

test('finding #3: the reviewer\'s exact repro — a FAILED probe after an older success is NEVER FRESH', () => {
  const c = {
    connectorId: 'repro', health: 'FAILED', lastSuccess: '2026-08-24T00:00:00Z',
    authStatus: 'AUTHENTICATED',
    healthEvidence: { observedAt: '2026-08-25T12:00:00Z', method: 'probe', result: 'timeout' },
  };
  const now = Date.parse('2026-08-25T12:05:00Z');
  const ver = M.projectLastVerified(c, now, 60);
  assert.notStrictEqual(ver.state, 'FRESH', 'a failed probe still projects FRESH');
  assert.strictEqual(ver.state, 'FAILED');
  assert.ok(!/responded\.$/.test(ver.plain), `a failed probe still says it responded: "${ver.plain}"`);
  assert.ok(/FAILED/.test(ver.plain), 'the failure must be stated, not omitted');
  assert.strictEqual(ver.observedAt, '2026-08-24T00:00:00Z',
    'the last successful response must be preserved, not replaced by the failure timestamp');
  assert.strictEqual(ver.latestProbe.outcome, 'FAILURE');
});

test('finding #3: a fresh FAILED probe cannot render as fresh anywhere in the connector row either', () => {
  const p = fixtureRegistry({
    stalenessThresholdMinutes: 60,
    healthVocabulary: ['HEALTHY', 'FAILED', 'UNKNOWN'],
    connectors: [{
      connectorId: 'down', plane: 'INTEGRATION', health: 'FAILED',
      authStatus: 'AUTHENTICATED', lastSuccess: '2026-08-23T11:30:00Z',
      authEvidence: { observedAt: '2026-08-23T11:55:00Z', authStatus: 'AUTHENTICATED', method: 'm' },
      healthEvidence: { observedAt: '2026-08-23T11:55:00Z', method: 'probe', result: 'timeout', health: 'FAILED', outcome: 'FAILURE' },
    }],
  });
  {
    const c = M.projectConnectors(NOW, { registryPath: p }).connectors[0];
    // Five minutes old, and therefore inside the freshness threshold — which is
    // exactly the case that used to render as FRESH.
    assert.strictEqual(c.staleness.state, 'FAILED', 'a five-minute-old FAILED probe rendered as FRESH');
    assert.strictEqual(c.staleness.ageMinutes, undefined,
      'a failed probe must not publish a freshness age a consumer could print as "STALE 5m" or "fresh"');
    assert.strictEqual(c.staleness.probeAgeMinutes, 5);
    assert.strictEqual(c.health, 'FAILED', 'last-known health must be preserved, not upgraded');
    assert.strictEqual(c.lastVerified.state, 'FAILED');
    assert.strictEqual(c.lastVerified.observedAt, '2026-08-23T11:30:00Z',
      'the older success must be preserved and shown as history, not replaced by the failure timestamp');
    assert.strictEqual(c.authentication.state, 'AUTHENTICATED',
      'a failed probe must not silently invalidate the separately dated credential fact');
  }
});

test('finding #3: authentication with NO dated evidence is UNAVAILABLE — an undated claim is not evidence', () => {
  const auth = M.projectAuthentication({ authStatus: 'AUTHENTICATED' }, NOW, 60);
  assert.strictEqual(auth.state, 'UNAVAILABLE', 'an undated AUTHENTICATED string was accepted as a working credential');
  assert.strictEqual(auth.ageMinutes, null);
  assert.strictEqual(M.projectAuthentication({}, NOW, 60).state, 'UNAVAILABLE');
});

test('finding #3: authentication goes STALE on its own clock, and says so', () => {
  const c = { authStatus: 'AUTHENTICATED', authEvidence: { observedAt: '2026-08-23T06:00:00Z', authStatus: 'AUTHENTICATED' } };
  const auth = M.projectAuthentication(c, NOW, 60);
  assert.strictEqual(auth.state, 'STALE');
  assert.strictEqual(auth.ageMinutes, 360);
  assert.ok(/revoked|expired/.test(auth.plain), 'a stale credential must say what could have happened since');
});

test('finding #3: an unrecognised or future-dated credential state is UNAVAILABLE, never carried through', () => {
  assert.strictEqual(M.projectAuthentication(
    { authEvidence: { observedAt: '2026-08-23T11:59:00Z', authStatus: 'DEFINITELY_FINE' } }, NOW, 60).state, 'UNAVAILABLE');
  assert.strictEqual(M.projectAuthentication(
    { authEvidence: { observedAt: 'not-a-date', authStatus: 'AUTHENTICATED' } }, NOW, 60).state, 'UNAVAILABLE');
  assert.strictEqual(M.projectAuthentication(
    { authEvidence: { observedAt: '2026-09-01T00:00:00Z', authStatus: 'AUTHENTICATED' } }, NOW, 60).state, 'UNAVAILABLE');
  assert.strictEqual(M.projectAuthentication(
    { authEvidence: { observedAt: '2026-08-23T11:59:00Z', authStatus: 'UNKNOWN' } }, NOW, 60).state, 'UNVERIFIED');
});

test('finding #3: the authentication clock and the verification clock are independent', () => {
  // Credential checked a minute ago; the service last responded six hours ago.
  const c = {
    authEvidence: { observedAt: '2026-08-23T11:59:00Z', authStatus: 'AUTHENTICATED' },
    healthEvidence: { observedAt: '2026-08-23T06:00:00Z', health: 'HEALTHY', outcome: 'SUCCESS', method: 'm', result: 'r' },
  };
  assert.strictEqual(M.projectAuthentication(c, NOW, 60).state, 'AUTHENTICATED');
  assert.strictEqual(M.projectLastVerified(c, NOW, 60).state, 'STALE');
  // And the reverse: probe fresh, credential evidence six hours old.
  const d = {
    authEvidence: { observedAt: '2026-08-23T06:00:00Z', authStatus: 'AUTHENTICATED' },
    healthEvidence: { observedAt: '2026-08-23T11:59:00Z', health: 'HEALTHY', outcome: 'SUCCESS', method: 'm', result: 'r' },
  };
  assert.strictEqual(M.projectAuthentication(d, NOW, 60).state, 'STALE');
  assert.strictEqual(M.projectLastVerified(d, NOW, 60).state, 'FRESH');
});

test('finding #3: a probe with no recorded outcome verifies nothing — it is UNVERIFIED, not FRESH', () => {
  const c = { healthEvidence: { observedAt: '2026-08-23T11:59:00Z', method: 'm', result: 'r' } };
  const ver = M.projectLastVerified(c, NOW, 60);
  assert.strictEqual(ver.state, 'UNVERIFIED', 'an unqualified probe was counted as a successful verification');
});

// ── G1 finding #4: a check dated in the future has observed nothing ────────
// PROVEN DEFECT (Codex REV-20260826143933-codex finding #4): a HEALTHY/SUCCESS
// receipt timestamped AFTER the clock was read two ways at once. The inspector
// said UNVERIFIED but explained it with "did not succeed — it is recorded as
// SUCCESS", a sentence that argues with itself; the connector row skipped the
// staleness checks entirely (they tested age === null and age > threshold, but
// never age < 0) and landed on FRESH with a NEGATIVE age — the most recent
// check on the page. Both surfaces must fail closed on the same fact and say
// the same plain thing: the timestamp is in the future, so it is unusable.
const FUTURE_PROBE = '2026-09-01T00:00:00Z'; // NOW is 2026-08-23T12:00:00Z

// Any key that reads as an age must never publish a negative number: a negative
// age rendered anywhere is "checked -12960 minutes ago", i.e. fresher than now.
function assertNoNegativeAges(obj, where) {
  JSON.stringify(obj, (k, v) => {
    if (/age/i.test(k) && typeof v === 'number') {
      assert.ok(v >= 0, `${where}.${k} published a negative age (${v}) a consumer could print as freshness`);
    }
    return v;
  });
}

test('G1 #4 RED: a future-dated SUCCESSFUL probe is UNVERIFIED, and the prose names the future timestamp instead of calling a SUCCESS "did not succeed"', () => {
  const c = {
    connectorId: 'ahead',
    healthEvidence: { observedAt: FUTURE_PROBE, method: 'probe', result: 'ok', health: 'HEALTHY', outcome: 'SUCCESS' },
  };
  const ver = M.projectLastVerified(c, NOW, 60);
  assert.strictEqual(ver.state, 'UNVERIFIED', 'a future-dated probe was accepted as a verification');
  assert.strictEqual(ver.ageMinutes, null, 'no freshness age may be published off a future timestamp');
  assertNoNegativeAges(ver, 'lastVerified');
  assert.ok(!/did not succeed/.test(ver.plain),
    `the explanation contradicts itself: "${ver.plain}"`);
  assert.ok(!/cannot be read as a usable date/.test(ver.plain),
    `a future date IS readable — saying otherwise misnames the fault: "${ver.plain}"`);
  assert.ok(/future/i.test(ver.plain), `the explanation must say the timestamp is in the future: "${ver.plain}"`);
  assert.ok(ver.plain.includes(FUTURE_PROBE), `the explanation must name the offending timestamp: "${ver.plain}"`);
});

test('G1 #4 RED: the same future-dated SUCCESS never renders FRESH in the connector row, and never publishes a negative age', () => {
  const p = fixtureRegistry({
    stalenessThresholdMinutes: 60,
    healthVocabulary: ['HEALTHY', 'FAILED', 'UNKNOWN'],
    connectors: [{
      connectorId: 'ahead', plane: 'INTEGRATION', health: 'HEALTHY', authStatus: 'AUTHENTICATED',
      authEvidence: { observedAt: '2026-08-23T11:55:00Z', authStatus: 'AUTHENTICATED', method: 'm' },
      healthEvidence: { observedAt: FUTURE_PROBE, method: 'probe', result: 'ok', health: 'HEALTHY', outcome: 'SUCCESS' },
    }],
  });
  const c = M.projectConnectors(NOW, { registryPath: p }).connectors[0];
  assert.notStrictEqual(c.staleness.state, 'FRESH', 'a future-dated probe rendered as FRESH');
  assert.strictEqual(c.staleness.state, 'UNVERIFIED');
  assert.strictEqual(c.staleness.ageMinutes, undefined,
    'a future-dated probe must not publish a freshness age a consumer could print');
  assertNoNegativeAges(c, 'connector');
  assert.ok(/future/i.test(c.staleness.reason) && c.staleness.reason.includes(FUTURE_PROBE),
    `the row must say the timestamp is future-dated and name it: "${c.staleness.reason}"`);
  assert.strictEqual(c.health, 'UNKNOWN',
    'evidence dated in the future cannot carry a health reading forward — it fails closed to UNKNOWN');
  assert.strictEqual(c.lastVerified.state, 'UNVERIFIED',
    'the row and the inspector must reach the same verdict on the same receipt');
  assert.ok(/future/i.test(c.lastVerified.plain) && !/did not succeed/.test(c.lastVerified.plain),
    `the inspector prose must stay founder-readable and non-contradictory: "${c.lastVerified.plain}"`);
  assert.strictEqual(c.authentication.state, 'AUTHENTICATED',
    'a future-dated health probe must not disturb the separately dated credential fact');
});

// ── a receipt that disagrees with itself is never a verification ───────────
// The reported defect: a receipt reading {health:'FAILED', outcome:'SUCCESS'}
// was trusted verbatim on the outcome word, so the connector dated its
// verification off its own failure and projected "Checked 1 minute(s) ago and
// it responded." A receipt that contradicts itself is not better evidence than
// no receipt — it is evidence that something is writing receipts wrongly, and
// the reading taken from it must never be the flattering one.
//
// Fresh, inside the threshold, and claiming SUCCESS: every ingredient of FRESH
// is present EXCEPT agreement with its own health word. That is the whole test.
test('RED: a receipt claiming SUCCESS against FAILED health is CONTRADICTORY — never FRESH', () => {
  const c = { connectorId: 'x', healthEvidence: {
    observedAt: '2026-08-23T11:59:00Z', health: 'FAILED', outcome: 'SUCCESS', method: 'm', result: 'r' } };
  const probe = M.latestProbe(c);
  assert.strictEqual(probe.outcome, M.PROBE_CONTRADICTORY, 'a self-contradicting receipt was classified as a real outcome');
  assert.strictEqual(probe.declaredOutcome, 'SUCCESS', 'the claim itself must be preserved so the disagreement can be stated');
  assert.strictEqual(probe.contradictsHealth, true);

  const ver = M.projectLastVerified(c, NOW, 60);
  assert.notStrictEqual(ver.state, 'FRESH', 'a contradictory receipt dated a verification off its own failure');
  assert.strictEqual(ver.state, 'UNVERIFIED', 'a contradictory receipt must verify nothing at all');
  assert.strictEqual(ver.observedAt, null, 'a contradictory receipt must not date anything');
  assert.strictEqual(ver.ageMinutes, null);
  assert.ok(/contradicts itself/.test(ver.plain), 'the contradiction must be named, not silently resolved');
  assert.ok(/FAILED/.test(ver.plain) && /SUCCESS/.test(ver.plain),
    'the plain line must show BOTH words it is refusing to reconcile');
  assert.ok(!/it responded/.test(ver.plain), 'the flattering reading survived in the plain-language line');
});

// The same contradiction on top of a real, older success. History is not
// erased — but it is not allowed to speak for the present either.
test('RED: a contradictory receipt cannot borrow an older success to become FRESH', () => {
  const c = { connectorId: 'x',
    verificationEvidence: { observedAt: '2026-08-23T11:58:00Z' },
    healthEvidence: {
      observedAt: '2026-08-23T11:59:00Z', health: 'FAILED', outcome: 'SUCCESS', method: 'm', result: 'r' } };
  const ver = M.projectLastVerified(c, NOW, 60);
  // The older success is one minute old and well inside the 60-minute
  // threshold, so this is precisely the case where FRESH would be tempting.
  assert.notStrictEqual(ver.state, 'FRESH', 'an older success was promoted to current by a contradictory probe');
  assert.strictEqual(ver.state, 'UNVERIFIED');
  assert.strictEqual(ver.observedAt, '2026-08-23T11:58:00Z', 'the last real success must be kept, not erased');
  assert.ok(/history, not a current verification/.test(ver.plain),
    'a past success presented without that caveat reads as a current one');
  assert.ok(/contradicts itself/.test(ver.plain));
  assert.strictEqual(ver.latestProbe.contradictsHealth, true, 'the contradiction must stay visible on the probe fact');
});

// The correction is deliberately ONE-DIRECTIONAL, and that has to be proved or
// it is just an untested comment: a self-reported FAILURE is always honoured.
// Downgrading a declared failure to "we do not know" would be the same defect
// facing the other way — it would let a broken service read as merely unknown.
test('RED: a declared FAILURE against HEALTHY health is still a FAILURE, never upgraded', () => {
  const c = { connectorId: 'x',
    verificationEvidence: { observedAt: '2026-08-23T11:58:00Z' },
    healthEvidence: {
      observedAt: '2026-08-23T11:59:00Z', health: 'HEALTHY', outcome: 'FAILURE', method: 'm', result: 'r' } };
  assert.strictEqual(M.latestProbe(c).outcome, M.PROBE_FAILURE,
    'a self-reported failure was softened because the health word disagreed');
  const ver = M.projectLastVerified(c, NOW, 60);
  assert.strictEqual(ver.state, 'FAILED', 'a declared failure must render FAILED, not UNVERIFIED and not FRESH');
  assert.notStrictEqual(ver.state, 'FRESH');
});

// classifyProbeOutcome is the single decision point, so pin the whole table.
// Anything unrecognised must land on INCONCLUSIVE — a word this system does not
// know is not a verdict, and must never fall through to SUCCESS.
test('RED: the probe-outcome table never resolves an unrecognised or contradictory receipt to SUCCESS', () => {
  const rows = [
    // [declared outcome, health word, expected classification]
    ['SUCCESS', 'HEALTHY', M.PROBE_SUCCESS],
    ['SUCCESS', null, M.PROBE_SUCCESS],
    ['SUCCESS', 'FAILED', M.PROBE_CONTRADICTORY],
    ['SUCCESS', 'AUTH_EXPIRED', M.PROBE_CONTRADICTORY],
    ['SUCCESS', 'RATE_LIMITED', M.PROBE_CONTRADICTORY],
    ['SUCCESS', 'DISCONNECTED', M.PROBE_CONTRADICTORY],
    // A word this system does not know is not a failure either — it is simply
    // not a verdict, so a SUCCESS claim against it is INCONCLUSIVE, not proof.
    ['SUCCESS', 'UNREACHABLE', M.PROBE_INCONCLUSIVE],
    ['SUCCESS', 'DEGRADED', M.PROBE_INCONCLUSIVE],
    ['SUCCESS', 'UNKNOWN', M.PROBE_INCONCLUSIVE],
    ['FAILURE', 'HEALTHY', M.PROBE_FAILURE],
    ['FAILURE', 'FAILED', M.PROBE_FAILURE],
    ['TOTALLY_FINE', 'HEALTHY', M.PROBE_INCONCLUSIVE],
    ['success', 'HEALTHY', M.PROBE_INCONCLUSIVE],
    [null, 'HEALTHY', M.PROBE_SUCCESS],
    [null, 'FAILED', M.PROBE_FAILURE],
    [null, 'DEGRADED', M.PROBE_INCONCLUSIVE],
    [null, null, M.PROBE_INCONCLUSIVE],
  ];
  for (const [declared, health, expected] of rows) {
    assert.strictEqual(M.classifyProbeOutcome(declared, health), expected,
      `outcome=${declared} health=${health} classified wrongly`);
  }
  // The load-bearing invariant, stated separately: no contradictory or
  // unrecognised pairing may ever reach SUCCESS.
  for (const [declared, health, expected] of rows) {
    if (expected !== M.PROBE_SUCCESS) {
      assert.notStrictEqual(M.classifyProbeOutcome(declared, health), M.PROBE_SUCCESS,
        `outcome=${declared} health=${health} fell through to SUCCESS`);
    }
  }
});

// Lowercase 'success' classifies INCONCLUSIVE above; prove that flows all the
// way through to the projection, so the vocabulary check is not decorative.
test('RED: an unrecognised outcome word never renders FRESH, however recent the probe', () => {
  const c = { connectorId: 'x', healthEvidence: {
    observedAt: '2026-08-23T11:59:30Z', health: 'HEALTHY', outcome: 'PROBABLY_OK', method: 'm', result: 'r' } };
  const ver = M.projectLastVerified(c, NOW, 60);
  assert.notStrictEqual(ver.state, 'FRESH', 'an unrecognised outcome word was read as a successful check');
  assert.strictEqual(ver.state, 'UNVERIFIED');
});

// ── #4 usage corroboration is SEMANTIC, against the canonical ledger ────────
//
// THE FIXTURE IS THE CONTRACT (Codex G1 finding #1). This object used to omit
// `agentId` and carry a top-level `runId` — a shape ledger-writer.cjs rejects
// on all three counts (missing required agentId, additional property runId,
// additional property connectorId). The tested success path was therefore
// unreachable through the approved store: no schema-valid entry could carry the
// coordinates these cases assert on. It is now an entry the canonical writer
// accepts, and `usageEntry()` below proves that on every use.
//
//   connectorId   — WHICH service            (schema property, added 2026-08-25)
//   correlationId — WHICH RUN consumed it    (the canonical run coordinate)
//   operationId   — WHICH operation
//
// There is no `runId` on a ledger entry. The registry's usage RECEIPT still has
// one — that is the connector's own claim about itself, a different document
// with a different authority, which is the entire point of corroborating one
// against the other.
const LEDGER_EVENT = {
  entryId: 'LED-USAGE-1', ts: '2026-08-25T10:00:00Z', agentId: 'claude-code',
  plane: 'INTEGRATION', gate: 'connector-usage', status: 'PASS',
  connectorId: 'notion', correlationId: 'RUN-1', operationId: 'op-1', result: 'page fetched',
};
const CLAIMING_CONNECTOR = {
  connectorId: 'notion',
  usageEvidence: { runId: 'RUN-1', observedAt: '2026-08-25T10:00:00Z', operationId: 'op-1', citedSource: 'src.ts' },
};
function events(...list) { return M.normalizeLedgerUsageEvents(list); }

// ── end-to-end through the REAL writer, into an INJECTED ledger ─────────────
// Every case below that builds a ledger event runs it through
// ledger-writer.validateEntry first, so a fixture can never again drift into a
// shape the canonical store would refuse. The heavier cases go further and
// append through the writer itself into a private temp ledger, then project
// from that file — the whole path, never the canonical ledger.
const LW = require('../ledger-writer.cjs');
const USAGE_TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-usage-'));
process.on('exit', () => { try { fs.rmSync(USAGE_TMP, { recursive: true, force: true }); } catch {} });

let usageLedgerNo = 0;
function freshLedger() {
  const f = path.join(USAGE_TMP, `ledger-${++usageLedgerNo}.json`);
  fs.writeFileSync(f, '[]\n');
  return f;
}

// Validate, then append through the canonical writer. Both halves are
// assertions: a fixture that stops being schema-valid fails here, loudly,
// rather than quietly proving something about a shape nothing can store.
function appendCanonical(ledgerFile, entry) {
  const errs = LW.validateEntry(entry);
  assert.deepStrictEqual(errs, [],
    `fixture is not a canonical ledger entry: ${errs.join(' | ')}`);
  const res = LW.appendAtomic(entry, { ledgerFile });
  assert.strictEqual(res.appended, true, `the canonical writer did not append ${entry.entryId}`);
  assert.strictEqual(res.ledgerFile, ledgerFile, 'the writer wrote somewhere other than the injected ledger');
  return res;
}

// Project from what is ACTUALLY ON DISK in the injected ledger.
function projectFromLedger(ledgerFile, connector) {
  return M.projectLastUsedByRun(connector, M.ledgerUsageEvents(ledgerFile));
}

// Guard the whole file: every fixture derived from LEDGER_EVENT must validate.
test('G1 #1: the connector-usage fixture is a schema-valid canonical ledger entry (zero errors)', () => {
  assert.deepStrictEqual(LW.validateEntry(LEDGER_EVENT), [],
    'the fixture these usage tests are built on is not something the canonical writer would accept');
});

test('G1 #1: the pre-correction fixture shape is REFUSED by the canonical writer', () => {
  // Exactly what the tests used to assert against: no agentId, a top-level
  // runId. Every one of those must be named as an error, and the writer CLI
  // must exit non-zero rather than store it.
  const offSchema = {
    entryId: 'LED-OFF-SCHEMA', ts: '2026-08-25T10:00:00Z', plane: 'INTEGRATION',
    gate: 'connector-usage', status: 'PASS', connectorId: 'notion',
    runId: 'RUN-1', operationId: 'op-1', result: 'page fetched',
  };
  const errs = LW.validateEntry(offSchema);
  assert.ok(errs.some((e) => /missing required property "agentId"/.test(e)),
    `agentId must still be required: ${errs.join(' | ')}`);
  assert.ok(errs.some((e) => /additional property "runId"/.test(e)),
    `a second run coordinate must stay unstorable: ${errs.join(' | ')}`);

  const L = freshLedger();
  const f = path.join(USAGE_TMP, 'off-schema.json');
  fs.writeFileSync(f, JSON.stringify(offSchema));
  const r = spawnSync('node', [path.join(ROOT, 'builder-control', 'ledger-writer.cjs'),
    '--append', f, '--ledger', L], { cwd: ROOT, encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0, 'the writer stored an entry that fails the ledger schema');
  assert.ok(/SCHEMA VALIDATION FAILED/.test(r.stderr), r.stderr.slice(0, 200));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(L, 'utf8')), [],
    'a rejected entry still reached the ledger');

  // And an incomplete-but-schema-valid event still projects NO usage: the
  // projector fails closed where the small draft-07 validator cannot reach.
  const noConnector = { ...LEDGER_EVENT, entryId: 'LED-NO-CONN' };
  delete noConnector.connectorId;
  assert.deepStrictEqual(LW.validateEntry(noConnector), [], 'control: this variant IS schema-valid');
  assert.strictEqual(M.normalizeLedgerUsageEvents([noConnector]).length, 0,
    'a connector-usage entry with no connector coordinate was read as a usage event anyway');
  const noRun = { ...LEDGER_EVENT, entryId: 'LED-NO-RUN' };
  delete noRun.correlationId;
  assert.strictEqual(M.normalizeLedgerUsageEvents([noRun]).length, 0,
    'a connector-usage entry with no run coordinate was read as a usage event anyway');
});

test('G1 #1: END TO END — validate, append through the writer, project USED from that ledger', () => {
  const L = freshLedger();
  appendCanonical(L, LEDGER_EVENT);

  // The entry is genuinely on disk, in the injected ledger, unmodified.
  const onDisk = JSON.parse(fs.readFileSync(L, 'utf8'));
  assert.strictEqual(onDisk.length, 1);
  assert.deepStrictEqual(onDisk[0], LEDGER_EVENT, 'the writer altered the entry it stored');

  const out = projectFromLedger(L, CLAIMING_CONNECTOR);
  assert.strictEqual(out.state, 'USED', 'a canonical, writer-stored consumption did not project as a use');
  assert.strictEqual(out.ledgerConfirmed, true);
  assert.strictEqual(out.runId, 'RUN-1', 'the run coordinate must come from the entry\'s correlationId');
  assert.strictEqual(out.operationId, 'op-1');
  assert.strictEqual(out.observedAt, '2026-08-25T10:00:00Z');
  assert.strictEqual(out.ledgerEntryId, 'LED-USAGE-1');
  assert.strictEqual(out.claimCorroborated, true);
  assert.strictEqual(out.claimCorroboratesReportedUse, true);
  assert.strictEqual(out.citedSource, 'src.ts', 'a claim that describes the reported use may cite its source');

  // Nothing about this touched the canonical ledger.
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'builder-control', 'ledger.json'), 'utf8'));
  assert.ok(!real.some((e) => String(e.entryId || '').startsWith('LED-USAGE-')),
    'a test usage entry reached the canonical production ledger');
});

test('G1 #1: END TO END — a ledger-only use, with no registry claim at all, projects USED', () => {
  const L = freshLedger();
  appendCanonical(L, LEDGER_EVENT);
  const out = projectFromLedger(L, { connectorId: 'notion' });
  assert.strictEqual(out.state, 'USED', 'canonical ledger truth needed a self-report to be believed');
  assert.strictEqual(out.runId, 'RUN-1');
  assert.strictEqual(out.claim, null);
  assert.strictEqual(out.citedSource, null, 'a source was cited with no claim to have cited it');
});

test('finding #4: an uncorroborated usage claim is UNVERIFIED — never USED', () => {
  const out = M.projectLastUsedByRun(CLAIMING_CONNECTOR, []);
  assert.strictEqual(out.state, 'UNVERIFIED', 'a registry claim with no ledger entry was promoted to USED');
  assert.strictEqual(out.ledgerConfirmed, false);
  assert.strictEqual(out.runId, null, 'an unproven claim must not be published as the run that used the connector');
  assert.strictEqual(out.claim.runId, 'RUN-1', 'the claim itself must still be shown, not hidden');
});

test('finding #4: an unrelated ledger entry sharing the operationId corroborates nothing', () => {
  const collision = { ...LEDGER_EVENT, connectorId: 'github', entryId: 'LED-OTHER' };
  assert.strictEqual(M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(collision)).state, 'UNVERIFIED');
  // and the old, weaker shape — a plane match with a colliding operationId — must also fail
  const weak = { ts: LEDGER_EVENT.ts, plane: 'INTEGRATION', status: 'PASS', operationId: 'op-1' };
  assert.strictEqual(M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(weak)).state, 'UNVERIFIED',
    'an operationId collision on the INTEGRATION plane is still being treated as corroboration');
});

// A mismatched run, operation or timestamp is TWO questions, not one, and the
// projector must answer them differently. The CLAIM stays uncorroborated —
// strictly, on all three axes — while the ledger event is still a real,
// successful, canonical consumption of this connector and therefore still
// projects USED, bound to the LEDGER's coordinates and never the claim's.
//
// The earlier contract asserted UNVERIFIED here, which let the registry's own
// self-report veto canonical control-plane truth: a recorded successful use
// disappeared from the page because the connector's claim about itself
// disagreed with it. That is the authority order backwards (Codex G1). What
// must never happen is the opposite leak — the unproven claim's runId,
// operationId or citedSource being published as the corroborated fact — so
// that is what is asserted, on every axis.
test('finding #4 (G1): a mismatched run, operation or timestamp NEVER corroborates the claim, and the ledger still wins', () => {
  const wrongRun = { ...LEDGER_EVENT, correlationId: 'RUN-OTHER', entryId: 'LED-RUN' };
  const wrongOp = { ...LEDGER_EVENT, operationId: 'op-other', entryId: 'LED-OP' };
  const wrongTime = { ...LEDGER_EVENT, ts: '2026-08-25T18:00:00Z', entryId: 'LED-TIME' };
  for (const [label, e] of [['run', wrongRun], ['operation', wrongOp], ['timestamp', wrongTime]]) {
    const out = M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(e));

    // 1. Strict corroboration of the registry's claim — unchanged, all three axes.
    assert.strictEqual(out.claimCorroborated, false,
      `a mismatched ${label} was accepted as corroboration of the registry's own claim`);
    assert.strictEqual(out.citedSource, null,
      `an uncorroborated claim lent its citedSource to a ledger entry it does not describe (${label})`);
    assert.strictEqual(out.claim.runId, 'RUN-1', 'the claim itself must still be shown, not hidden');

    // 2. The ledger is the authority for usage, so a real successful event stands.
    assert.strictEqual(out.state, 'USED',
      `a canonical successful ledger use was suppressed by a mismatched ${label} in the registry's claim`);
    assert.strictEqual(out.ledgerConfirmed, true);
    assert.strictEqual(out.ledgerEntryId, e.entryId);
    assert.strictEqual(out.runId, e.correlationId,
      `the projected run must be the LEDGER's correlationId, not the claim's runId (${label})`);
    assert.strictEqual(out.operationId, e.operationId,
      `the projected operation must be the LEDGER's, not the claim's (${label})`);
    assert.strictEqual(out.observedAt, e.ts, `the projected time must be the LEDGER's, not the claim's (${label})`);
    assert.ok(/ledger\.json$/.test(out.source), 'a confirmed use must cite the ledger, not the connector\'s own file');
    assert.ok(/does not corroborate that exact claim/.test(out.plain),
      `the disagreement between claim and ledger must be stated out loud (${label})`);
  }
});

// The ledger-only half of the same authority rule, stated on its own so it
// cannot regress silently: a connector that makes NO claim at all still reads
// USED when the ledger records a successful consumption of it. Previously the
// registry's `usageEvidence` gated the answer, so canonical truth rendered
// UNAVAILABLE for want of a self-report.
test('finding #4 (G1): a ledger use with NO registry claim at all still projects USED', () => {
  const out = M.projectLastUsedByRun({ connectorId: 'notion' }, events(LEDGER_EVENT));
  assert.strictEqual(out.state, 'USED', 'canonical ledger truth was suppressed because the connector made no claim');
  assert.strictEqual(out.claim, null, 'a claim was invented for a connector that made none');
  assert.strictEqual(out.claimCorroborated, false, 'a nonexistent claim cannot be corroborated');
  assert.strictEqual(out.citedSource, null, 'a citedSource appeared with no claim to have cited it');
  assert.strictEqual(out.runId, 'RUN-1');
  assert.ok(/recorded no usage claim of its own/.test(out.plain), 'the absence of a claim must be stated, not hidden');
});

// ── AEGIS REVIEWER FINDING #1 ──────────────────────────────────────────────
// THE PROJECTION MAY READ ONLY WHAT THE CANONICAL STORE WOULD ACCEPT.
//
// The proven defect: normalizeLedgerUsageEvents() decided "is this a usage
// event?" from four coordinates it read off the object itself, and treated
// 'OK' and 'SUCCESS' as success statuses. Neither string is in the status enum
// of ledger-entry.schema.json, and the schema sets additionalProperties:false
// with entryId/ts/agentId/gate/status all required — so an entry with
// status 'OK', or with no agentId, or with no entryId, is an entry the
// canonical writer refuses outright. The projector read them anyway and could
// publish one as "a run used this connector": a governance answer sourced from
// a record that never passed the approved write path.
//
// The repair is a gate, not a second rulebook. normalizeLedgerUsageEvents()
// calls ledger-writer.validateEntry() — the same function, against the same
// schema file, that the writer itself gates on. There is exactly one definition
// of a valid ledger entry in this system, and both sides now ask it.
//
// Each case below is proved on all three surfaces, because any one alone can
// be defeated: the canonical VALIDATOR names the fault, NORMALIZATION yields
// zero events, and the PROJECTION never reads USED.
const SCHEMA_INVALID_USAGE_CASES = [
  {
    label: 'invalid status OK',
    fault: /#\/status: must be one of .*"PASS".*got "OK"/,
    entry: { ...LEDGER_EVENT, entryId: 'LED-BAD-STATUS-OK', status: 'OK' },
  },
  {
    label: 'invalid status SUCCESS',
    fault: /#\/status: must be one of .*"PASS".*got "SUCCESS"/,
    entry: { ...LEDGER_EVENT, entryId: 'LED-BAD-STATUS-SUCCESS', status: 'SUCCESS' },
  },
  {
    label: 'missing agentId',
    fault: /missing required property "agentId"/,
    entry: (() => { const e = { ...LEDGER_EVENT, entryId: 'LED-BAD-NO-AGENT' }; delete e.agentId; return e; })(),
  },
  {
    label: 'missing entryId',
    fault: /missing required property "entryId"/,
    entry: (() => { const e = { ...LEDGER_EVENT }; delete e.entryId; return e; })(),
  },
];

// A ledger file written DIRECTLY, bypassing the writer entirely. That bypass is
// the whole point: these shapes cannot arrive through the canonical writer, so
// the only way to prove the projector refuses them on disk is to put them there
// by the same off-path route a real off-schema entry would have taken. It is a
// private temp file; the canonical ledger is never touched.
function rawLedgerFile(entries) {
  const f = path.join(USAGE_TMP, `raw-ledger-${++usageLedgerNo}.json`);
  fs.writeFileSync(f, JSON.stringify(entries, null, 2) + '\n');
  return f;
}

test('finding #1: the canonical validator REFUSES every schema-invalid connector-usage shape, and names the fault', () => {
  for (const c of SCHEMA_INVALID_USAGE_CASES) {
    const errs = LW.validateEntry(c.entry);
    assert.ok(errs.length > 0,
      `${c.label}: the canonical ledger schema accepted an entry it must refuse`);
    assert.ok(errs.some((e) => c.fault.test(e)),
      `${c.label}: the refusal must name the actual fault, got: ${errs.join(' | ')}`);
  }
  // POSITIVE CONTROL. If the validator refused everything, the three
  // assertions above would pass while proving nothing at all.
  assert.deepStrictEqual(LW.validateEntry(LEDGER_EVENT), [],
    'control: the schema-valid PASS fixture must still validate cleanly');
});

test('finding #1: a schema-invalid connector-usage entry normalizes to ZERO usage events', () => {
  for (const c of SCHEMA_INVALID_USAGE_CASES) {
    assert.strictEqual(M.normalizeLedgerUsageEvents([c.entry]).length, 0,
      `${c.label}: an entry the canonical writer would refuse was read as a usage event`);
  }
  // All four together, and mixed with the one valid event: exactly the valid
  // one survives. A normalizer that dropped everything would satisfy the loop
  // above; it cannot satisfy this.
  const mixed = M.normalizeLedgerUsageEvents(
    [...SCHEMA_INVALID_USAGE_CASES.map((c) => c.entry), LEDGER_EVENT]);
  assert.strictEqual(mixed.length, 1, 'exactly one of these five entries is canonically valid');
  assert.strictEqual(mixed[0].entryId, 'LED-USAGE-1');
  assert.strictEqual(mixed[0].runId, 'RUN-1');
});

test('finding #1: projectLastUsedByRun NEVER reads USED from a schema-invalid entry', () => {
  for (const c of SCHEMA_INVALID_USAGE_CASES) {
    // (a) in memory, with a registry claim that would otherwise match it exactly
    const claimed = M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(c.entry));
    assert.notStrictEqual(claimed.state, 'USED',
      `${c.label}: an unstorable entry was published as a run's consumption`);
    assert.strictEqual(claimed.state, 'UNVERIFIED',
      `${c.label}: with a claim present and no valid ledger event, the honest state is UNVERIFIED`);
    assert.strictEqual(claimed.ledgerConfirmed, false, `${c.label}: the ledger confirmed nothing`);
    assert.strictEqual(claimed.ledgerEventCount, 0, `${c.label}: an invalid entry was counted as an event`);
    assert.strictEqual(claimed.runId, null,
      `${c.label}: a run was named as having used this connector on invalid evidence`);
    assert.strictEqual(claimed.citedSource, null, `${c.label}: a source was cited on invalid evidence`);

    // (b) in memory, with no claim at all
    const bare = M.projectLastUsedByRun({ connectorId: 'notion' }, events(c.entry));
    assert.strictEqual(bare.state, 'UNAVAILABLE',
      `${c.label}: with neither a valid ledger event nor a claim, usage is UNAVAILABLE`);
    assert.strictEqual(bare.runId, null);

    // (c) ON DISK: the same entry sitting in a real ledger file, read through
    //     the real read path. This is the surface the dashboard actually uses.
    const L = rawLedgerFile([c.entry]);
    const onDisk = projectFromLedger(L, CLAIMING_CONNECTOR);
    assert.notStrictEqual(onDisk.state, 'USED',
      `${c.label}: an off-schema entry ON DISK projected as a use`);
    assert.strictEqual(onDisk.ledgerEventCount, 0);
    assert.strictEqual(M.ledgerUsageEvents(L).length, 0,
      `${c.label}: the ledger read path returned a usage event for an unstorable entry`);
  }
});

test('finding #1: the writer REFUSES to store any of these shapes, so the projector and the store agree', () => {
  // One contract, asked from both sides. If the writer would accept a shape the
  // projector rejects (or the reverse), there are two definitions of a valid
  // ledger entry and the disagreement is the bug.
  for (const c of SCHEMA_INVALID_USAGE_CASES) {
    const L = freshLedger();
    assert.throws(() => LW.appendAtomic(c.entry, { ledgerFile: L }),
      /fails ledger-entry\.schema\.json/,
      `${c.label}: the canonical writer stored an entry the projector refuses to read`);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(L, 'utf8')), [],
      `${c.label}: a refused entry still reached the ledger`);
  }
});

// THE SUCCESS PROOF, RETAINED. Every case above is a refusal, and a projection
// that returned UNAVAILABLE for everything would satisfy all of them. This is
// the case that makes them mean something: a schema-valid PASS entry, stored by
// the canonical writer into a real ledger file, read back off disk, still
// projects USED with the ledger's own coordinates.
test('finding #1: a writer-stored, schema-valid PASS entry STILL projects USED (the negatives are not blanket)', () => {
  const L = freshLedger();
  appendCanonical(L, LEDGER_EVENT);
  const stored = JSON.parse(fs.readFileSync(L, 'utf8'));
  assert.strictEqual(stored.length, 1, 'the valid entry did not reach the ledger');
  assert.deepStrictEqual(stored[0], LEDGER_EVENT, 'the writer altered the entry it stored');

  assert.strictEqual(M.ledgerUsageEvents(L).length, 1, 'the valid stored entry was not read as a usage event');
  const out = projectFromLedger(L, CLAIMING_CONNECTOR);
  assert.strictEqual(out.state, 'USED', 'the schema gate suppressed a canonical, writer-stored use');
  assert.strictEqual(out.ledgerConfirmed, true);
  assert.strictEqual(out.ledgerEventCount, 1);
  assert.strictEqual(out.runId, 'RUN-1');
  assert.strictEqual(out.operationId, 'op-1');
  assert.strictEqual(out.ledgerEntryId, 'LED-USAGE-1');

  // And the mixed reality: four unstorable entries sitting alongside the one
  // real use must change nothing about what is reported.
  const mixedFile = rawLedgerFile([...SCHEMA_INVALID_USAGE_CASES.map((c) => c.entry), LEDGER_EVENT]);
  const mixedOut = projectFromLedger(mixedFile, CLAIMING_CONNECTOR);
  assert.strictEqual(mixedOut.state, 'USED');
  assert.strictEqual(mixedOut.ledgerEventCount, 1, 'an invalid neighbour was counted as a use');
  assert.strictEqual(mixedOut.ledgerEntryId, 'LED-USAGE-1');
});

// Newest-wins must hold ACROSS different runs and operations, not merely
// between repeats of the same one. The older event here is the one the registry
// claims and can corroborate; the newer belongs to a different run and
// operation. The newer must still win, and winning must not drag the older
// claim's citedSource along with it.
// PROVENANCE TRAVELS WITH ITS OWN EVENT (Codex G1 finding #2).
//
// The previous version of this case pinned the opposite: the claim corroborates
// the OLDER event, the NEWER event wins, and the older claim's citedSource was
// lent to the newer entry — rendering "Run RUN-2 used this service, citing
// src.ts" when src.ts was cited by RUN-1's claim about op-1. That is one
// operation's evidence published as another's, and it was locked in by an
// assertion. It is now the failure the case exists to catch.
const OLDER_USE = { ...LEDGER_EVENT, entryId: 'LED-OLD', ts: '2026-08-25T10:00:00Z' };
const NEWER_USE = { ...LEDGER_EVENT, entryId: 'LED-NEW', ts: '2026-08-25T11:30:00Z',
  correlationId: 'RUN-2', operationId: 'op-2' };
// A claim describing the NEWER use exactly — the only kind that may cite.
const WINNER_CLAIMING_CONNECTOR = {
  connectorId: 'notion',
  usageEvidence: { runId: 'RUN-2', observedAt: '2026-08-25T11:30:00Z', operationId: 'op-2', citedSource: 'src.ts' },
};

test('finding #4 (G1): the newest canonical event wins across a DIFFERENT run and operation', () => {
  const a = M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(OLDER_USE, NEWER_USE));
  const b = M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(NEWER_USE, OLDER_USE));
  assert.deepStrictEqual(a, b, 'the projected use must not depend on ledger ordering');
  assert.strictEqual(a.state, 'USED');
  assert.strictEqual(a.ledgerEntryId, 'LED-NEW', 'an older corroborated event outranked a newer canonical one');
  assert.strictEqual(a.runId, 'RUN-2');
  assert.strictEqual(a.operationId, 'op-2');
  assert.strictEqual(a.ledgerEventCount, 2, 'both canonical events must be counted, not just the winner');
  // The claim corroborates the OLDER event, which is NOT the one being reported.
  // Both facts are published, and they are different fields because they are
  // different questions.
  assert.strictEqual(a.claimCorroborated, true, 'the claim does match an authoritative event and must say so');
  assert.strictEqual(a.claimCorroboratesReportedUse, false,
    'a claim about op-1 was recorded as corroborating the op-2 event being reported');
  assert.strictEqual(a.citedSource, null,
    'RUN-1\'s cited source was lent to RUN-2\'s ledger entry — one operation\'s evidence published as another\'s');
  assert.ok(!/citing/.test(a.plain),
    `the founder-facing line still cites a source it has no right to: ${a.plain}`);
  assert.ok(/EARLIER recorded use/.test(a.plain),
    'the mismatch between the claim and the reported use must be stated in plain language');
});

test('G1 #2: a claim that describes the WINNING event exactly may lend its source', () => {
  const a = M.projectLastUsedByRun(WINNER_CLAIMING_CONNECTOR, events(OLDER_USE, NEWER_USE));
  const b = M.projectLastUsedByRun(WINNER_CLAIMING_CONNECTOR, events(NEWER_USE, OLDER_USE));
  assert.deepStrictEqual(a, b, 'the projected use must not depend on ledger ordering');
  assert.strictEqual(a.ledgerEntryId, 'LED-NEW');
  assert.strictEqual(a.runId, 'RUN-2');
  assert.strictEqual(a.claimCorroboratesReportedUse, true);
  assert.strictEqual(a.citedSource, 'src.ts',
    'a claim corroborating the exact reported use was stripped of its source — the rule is now too strict');
  assert.ok(/citing src\.ts/.test(a.plain), a.plain);
});

// The same two cases again, but through the REAL writer into an INJECTED
// ledger — so the provenance rule is proven against stored canonical evidence,
// not only against hand-built objects.
test('G1 #1+#2: END TO END — newest wins in BOTH append orders, and an older claim lends nothing', () => {
  const forward = freshLedger();
  appendCanonical(forward, OLDER_USE);
  appendCanonical(forward, NEWER_USE);
  const reverse = freshLedger();
  appendCanonical(reverse, NEWER_USE);
  appendCanonical(reverse, OLDER_USE);

  const a = projectFromLedger(forward, CLAIMING_CONNECTOR);
  const b = projectFromLedger(reverse, CLAIMING_CONNECTOR);
  assert.deepStrictEqual(a, b, 'the winner depended on the order entries were appended in');
  assert.strictEqual(a.state, 'USED');
  assert.strictEqual(a.ledgerEntryId, 'LED-NEW', 'the newest canonical event did not win');
  assert.strictEqual(a.runId, 'RUN-2', 'authority must hold ACROSS runs, not only within one');
  assert.strictEqual(a.operationId, 'op-2', 'authority must hold ACROSS operations, not only within one');
  assert.strictEqual(a.observedAt, '2026-08-25T11:30:00Z');
  assert.strictEqual(a.ledgerEventCount, 2);
  assert.strictEqual(a.citedSource, null, 'an older claim lent provenance to a newer entry it does not describe');
  assert.ok(!/citing/.test(a.plain), a.plain);

  // Same stored ledger, a claim that matches the winner: the source returns.
  const exact = projectFromLedger(forward, WINNER_CLAIMING_CONNECTOR);
  assert.strictEqual(exact.ledgerEntryId, 'LED-NEW');
  assert.strictEqual(exact.citedSource, 'src.ts');
  assert.ok(/citing src\.ts/.test(exact.plain), exact.plain);
});

test('finding #4: a FAILED or non-consumption ledger entry never corroborates a use', () => {
  const failed = { ...LEDGER_EVENT, status: 'BLOCKED' };
  const wrongGate = { ...LEDGER_EVENT, gate: 'control' };
  const wrongPlane = { ...LEDGER_EVENT, plane: 'CONTROL' };
  for (const [label, e] of [['FAILED', failed], ['non-usage gate', wrongGate], ['control-plane', wrongPlane]]) {
    assert.strictEqual(M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(e)).state, 'UNVERIFIED',
      `a ${label} entry was accepted as a successful consumption`);
  }
});

test('finding #4: only a fully matching successful ledger entry projects USED', () => {
  const out = M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(LEDGER_EVENT));
  assert.strictEqual(out.state, 'USED');
  assert.strictEqual(out.ledgerConfirmed, true);
  assert.strictEqual(out.runId, 'RUN-1');
  assert.strictEqual(out.operationId, 'op-1');
  assert.strictEqual(out.ledgerEntryId, 'LED-USAGE-1');
  assert.ok(/ledger\.json$/.test(out.source), 'a confirmed use must cite the ledger, not the connector\'s own file');
});

test('finding #4: when several authoritative events corroborate, the NEWEST is the truth', () => {
  const older = { ...LEDGER_EVENT, entryId: 'LED-OLD', ts: '2026-08-25T09:58:00Z' };
  const newer = { ...LEDGER_EVENT, entryId: 'LED-NEW', ts: '2026-08-25T10:02:00Z' };
  const a = M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(older, newer));
  const b = M.projectLastUsedByRun(CLAIMING_CONNECTOR, events(newer, older));
  assert.strictEqual(a.ledgerEntryId, 'LED-NEW', 'an older ledger entry overwrote newer truth');
  assert.deepStrictEqual(a, b, 'the projected use must not depend on ledger ordering');
});

test('a connector with no usageEvidence at all renders UNAVAILABLE for usage, never a default of "used"', () => {
  const out = M.projectLastUsedByRun({}, []);
  assert.strictEqual(out.state, 'UNAVAILABLE');
  assert.strictEqual(out.runId, null);
});

test('projectConnectors renders authentication, lastVerified and lastUsedByRun as three independent objects per connector', () => {
  const out = M.projectConnectors(NOW);
  assert.strictEqual(out.state, 'OK');
  assert.ok(out.connectors.length > 0, 'no connectors were projected');
  for (const c of out.connectors) {
    assert.ok(c.authentication && typeof c.authentication.state === 'string', `${c.connectorId} has no authentication fact`);
    assert.ok(c.lastVerified && typeof c.lastVerified.state === 'string', `${c.connectorId} has no lastVerified fact`);
    assert.ok(c.lastUsedByRun && typeof c.lastUsedByRun.state === 'string', `${c.connectorId} has no lastUsedByRun fact`);
    // The row-level authStatus must be the DATED verdict, so a consumer that
    // renders it cannot restate an undated registry claim as current fact.
    assert.strictEqual(c.authStatus, c.authentication.state,
      `${c.connectorId} publishes an authStatus that is not the dated authentication verdict`);
  }
});

// ── G1 finding #4: independence, proved in isolation ───────────────────────
// This pair used to be one assertion over LIVE evidence: "no connector in the
// canonical registry projects USED, because the canonical ledger happens to be
// empty of usage events." That is not a proof of the projector's rule, it is an
// observation about the current contents of a mutable, append-only operational
// store — and the suite made it a REQUIREMENT. The first legitimate
// connector-usage event ever recorded would have turned a correct projection
// into a red suite, which is a standing incentive to keep the authoritative
// ledger empty. The ledger is supposed to fill up.
//
// The rule being tested has nothing to do with what is on disk today, so it is
// now tested against an isolated registry and an isolated ledger, in both
// directions:
//   * empty ledger  → UNAVAILABLE, even for a connector that is AUTHENTICATED
//                     and was successfully probed sixty seconds ago;
//   * one canonical usage event → USED.
// Nothing here reads or asserts anything about live operational history.
const USAGE_NOW = Date.parse('2026-08-25T10:05:00Z');

// AUTHENTICATED, freshly and SUCCESSFULLY probed, and making no usage claim of
// its own. Every input that could tempt an inference of use is present.
const HEALTHY_UNUSED_REGISTRY = {
  stalenessThresholdMinutes: 60,
  healthVocabulary: ['HEALTHY', 'FAILED', 'UNKNOWN'],
  connectors: [{
    connectorId: 'notion', label: 'Notion', provider: 'notion', plane: 'INTEGRATION',
    health: 'HEALTHY', authStatus: 'AUTHENTICATED',
    authEvidence: { observedAt: '2026-08-25T10:04:00Z', authStatus: 'AUTHENTICATED', method: 'token check' },
    healthEvidence: { observedAt: '2026-08-25T10:04:00Z', method: 'probe', result: 'ok',
      health: 'HEALTHY', outcome: 'SUCCESS' },
    usageEvidence: null,
  }],
};

test('G1 #4: with an EMPTY ledger, authentication and a successful probe do NOT imply usage', () => {
  const registryPath = fixtureRegistry(HEALTHY_UNUSED_REGISTRY);
  const ledgerFile = freshLedger();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledgerFile, 'utf8')), [],
    'the isolated ledger must start empty for this case to mean anything');

  const out = M.projectConnectors(USAGE_NOW, { registryPath, ledgerFile });
  assert.strictEqual(out.state, 'OK');
  const c = out.connectors[0];

  // The two facts that must NOT leak into the third.
  assert.strictEqual(c.authentication.state, 'AUTHENTICATED', 'control: the credential fact is present and fresh');
  assert.strictEqual(c.lastVerified.state, 'FRESH', 'control: the service was successfully probed one minute ago');
  assert.strictEqual(c.staleness.state, 'FRESH');

  // And usage is still unknown, because nothing recorded a use.
  assert.strictEqual(c.lastUsedByRun.state, 'UNAVAILABLE',
    'usage was inferred from authentication or a healthy probe');
  assert.strictEqual(c.lastUsedByRun.runId, null);
  assert.strictEqual(c.lastUsedByRun.ledgerConfirmed, false);
  assert.strictEqual(c.lastUsedByRun.ledgerEventCount, 0);
  assert.strictEqual(c.lastUsedByRun.citedSource, null);
});

test('G1 #4: one VALID canonical usage event in the isolated ledger projects USED — the suite does not require an empty ledger', () => {
  const registryPath = fixtureRegistry(HEALTHY_UNUSED_REGISTRY);
  const ledgerFile = freshLedger();
  // Written by the canonical writer, so this is an entry the real store would
  // actually accept — not a shape invented for the test.
  appendCanonical(ledgerFile, LEDGER_EVENT);

  const c = M.projectConnectors(USAGE_NOW, { registryPath, ledgerFile }).connectors[0];
  assert.strictEqual(c.lastUsedByRun.state, 'USED',
    'a recorded, successful, canonical consumption did not project as USED');
  assert.strictEqual(c.lastUsedByRun.runId, 'RUN-1', 'the projected run must be the ledger\'s correlationId');
  assert.strictEqual(c.lastUsedByRun.operationId, 'op-1');
  assert.strictEqual(c.lastUsedByRun.observedAt, LEDGER_EVENT.ts);
  assert.strictEqual(c.lastUsedByRun.ledgerConfirmed, true);
  assert.strictEqual(c.lastUsedByRun.ledgerEntryId, LEDGER_EVENT.entryId);
  // The registry made no claim, so nothing may be cited from one.
  assert.strictEqual(c.lastUsedByRun.claim, null);
  assert.strictEqual(c.lastUsedByRun.citedSource, null);
  // Provenance names the ledger that was actually read.
  assert.strictEqual(c.lastUsedByRun.source, path.relative(ROOT, ledgerFile));

  // The other two facts are unmoved by the arrival of a usage event.
  assert.strictEqual(c.authentication.state, 'AUTHENTICATED');
  assert.strictEqual(c.lastVerified.state, 'FRESH');
});

test('G1 #4: the canonical ledger is READ, never asserted to be empty — usage projection tracks whatever it holds', () => {
  // What may legitimately be said about live evidence: the projector reads it,
  // and every usage projection it produces is either backed by a canonical
  // event in that ledger or is not USED. This holds with zero usage events on
  // disk and it holds with a thousand.
  //
  // REVIEW FINDING #6: this case used to read the live ledger TWICE — once for
  // the event list, once through the projector — and hold the two against each
  // other. A legitimate append by a concurrently running suite landing between
  // those two reads made the halves disagree, and this file reported it as a
  // projector defect. Both halves now read the ONE frozen snapshot taken at
  // load, so the correlation is proven against real canonical content at a
  // single instant instead of across a race. The claim is unweakened: the
  // content is the canonical ledger's own.
  assert.strictEqual(fs.readFileSync(FROZEN_LEDGER, 'utf8'), CANONICAL_LEDGER_BYTES,
    'the frozen ledger is no longer the canonical content it was taken from');

  const evs = M.ledgerUsageEvents(FROZEN_LEDGER);
  assert.ok(Array.isArray(evs), 'ledger usage events must project as a list');
  const byConnector = new Map();
  for (const e of evs) byConnector.set(e.connectorId, (byConnector.get(e.connectorId) || 0) + 1);

  // The IDENTITY claim, which is what the live read was ever for: with nothing
  // injected, the projector reads builder-control/ledger.json and says so. One
  // read of a constant path — nothing here to race with.
  assert.strictEqual(M.projectConnectors(Date.parse('2026-08-25T17:00:00Z')).ledgerSource,
    'builder-control/ledger.json',
    'the default projection must read the canonical ledger');

  const live = M.projectConnectors(Date.parse('2026-08-25T17:00:00Z'), { ledgerFile: FROZEN_LEDGER });
  assert.strictEqual(live.ledgerSource, path.relative(ROOT, FROZEN_LEDGER),
    'the projection must cite the ledger it actually read');
  for (const c of live.connectors) {
    if (c.lastUsedByRun.state === 'USED') {
      // Not "this must never happen" — "if it happens, a canonical event is
      // behind it." A USED with no event behind it is the actual defect.
      assert.ok((byConnector.get(c.connectorId) || 0) > 0,
        `${c.connectorId} projects USED with no canonical usage event in the ledger`);
      assert.strictEqual(c.lastUsedByRun.ledgerConfirmed, true,
        `${c.connectorId} projects USED without ledger confirmation`);
    } else {
      assert.strictEqual((byConnector.get(c.connectorId) || 0), 0,
        `${c.connectorId} has canonical usage events but does not project USED`);
    }
  }
});

test('control-plane authority is unchanged: usage corroboration reads the canonical ledger, not a second store', () => {
  const snap = M.snapshot({});
  assert.ok(/ledger\.json$/.test(snap.events.source || ''), 'events must still come from the existing ledger');
  assert.strictEqual(M.LEDGER_USAGE_GATE, 'connector-usage',
    'the consumption event type must stay a named, checkable contract');
});

// ── current-run binding: a filename is not a clock ─────────────────────────
// CONFIRMED FINDING #7. The dashboard called runs[length-1] of a
// FILENAME-sorted array "Current run". Run ids carry a random suffix, so
// filename order and time order are different orders, and the panel could
// present yesterday's objective as today's.
const mkRun = (runId, updatedAt, extra) => Object.assign({
  runId, state: 'BUILT', objective: 'o-' + runId,
  createdAt: updatedAt, updatedAt,
  createdAtMs: updatedAt === null ? null : Date.parse(updatedAt),
  updatedAtMs: updatedAt === null ? null : Date.parse(updatedAt),
  packetId: null,
}, extra || {});

test('runs order by their own updatedAt timestamp, never by run id or file order', () => {
  // Filename/id order puts -zzzz last; time order puts -aaaa last.
  const ordered = M.orderRuns([
    mkRun('RUN-20260826-aaaa', '2026-08-26T10:00:00.000Z'),
    mkRun('RUN-20260825-zzzz', '2026-08-25T10:00:00.000Z'),
  ]);
  assert.deepStrictEqual(ordered.map((r) => r.runId), ['RUN-20260825-zzzz', 'RUN-20260826-aaaa'],
    'ordering fell back to id/filename order, which is the defect');
});

// Two canonical subject hashes, used as the run's OWN recorded subject.
const RUN_SUBJECT = 'a'.repeat(64);
const OTHER_SUBJECT = 'c'.repeat(64);

// The legacy contract asserted that whatever hash the PAGE was gated with came
// back as the current run's `subjectSha256` — here, the 16-character string
// 'deadbeefdeadbeef', which is not even a canonical subject hash. That is the
// defect Codex G1 finding #3 named: a run record carrying nothing but an id and
// two timestamps advertised a reviewed code version it had no linkage to, which
// reads as "the gate verdict and reviewer approvals on this page cover this
// run's work". Nothing had established that.
//
// The contract below is the corrected one: run, time and packet are still named
// from the run's own record, and the code version is UNLINKED — null — unless
// the RUN ITSELF recorded a subject hash that exactly matches the page's.
test('the current run is the newest by timestamp, and names run, time and packet — but never borrows the page\'s subject', () => {
  const b = M.bindCurrentRun(M.orderRuns([
    mkRun('RUN-B', '2026-08-26T10:00:00.000Z', { packetId: 'builder-control/packets/P.json' }),
    mkRun('RUN-A', '2026-08-25T10:00:00.000Z'),
  ]), RUN_SUBJECT);
  assert.strictEqual(b.state, 'BOUND');
  assert.strictEqual(b.runId, 'RUN-B');
  assert.strictEqual(b.updatedAt, '2026-08-26T10:00:00.000Z');
  assert.strictEqual(b.packetId, 'builder-control/packets/P.json');
  // The run record names no subject of its own, so there is no linkage.
  assert.strictEqual(b.subjectState, 'UNLINKED');
  assert.strictEqual(b.subjectSha256, null,
    'the page\'s gate subject was stamped onto a run that never recorded one');
  assert.strictEqual(b.runSubjectSha256, null);
  assert.strictEqual(b.gateSubjectSha256, RUN_SUBJECT, 'the gate subject must stay visible, just not borrowed');
  assert.ok(/nothing links that verdict to this run/.test(b.reason),
    'an absent linkage must be said out loud, not left to be inferred from a null');
  assert.ok(/deterministic|last written/.test(b.reason), 'the binding must explain how it was selected');
});

// The positive half: linkage EXISTS and is published only on an exact match
// between the run's own recorded subject and the page's gate subject.
test('G1 #3: a run that records the page\'s exact subject is BOUND, and only then is a code version published', () => {
  const b = M.bindCurrentRun(M.orderRuns([
    mkRun('RUN-LINKED', '2026-08-26T10:00:00.000Z', { subjectSha256: RUN_SUBJECT }),
  ]), RUN_SUBJECT);
  assert.strictEqual(b.runId, 'RUN-LINKED');
  assert.strictEqual(b.subjectState, 'BOUND');
  assert.strictEqual(b.subjectSha256, RUN_SUBJECT, 'a proven exact linkage must be published');
  assert.strictEqual(b.runSubjectSha256, RUN_SUBJECT);
  assert.strictEqual(b.gateSubjectSha256, RUN_SUBJECT);
  assert.ok(/exactly the subject/.test(b.reason), 'a BOUND linkage must state that the two hashes are the same');
});

// The negative half: the run recorded a subject, and it is a DIFFERENT one.
// This is the most dangerous case — two real hashes, one page — and it must
// never resolve to a code version.
test('G1 #3 RED: a run recording a DIFFERENT subject is MISMATCHED, and publishes no code version', () => {
  const b = M.bindCurrentRun(M.orderRuns([
    mkRun('RUN-OTHER', '2026-08-26T10:00:00.000Z', { subjectSha256: OTHER_SUBJECT }),
  ]), RUN_SUBJECT);
  assert.strictEqual(b.subjectState, 'MISMATCHED');
  assert.strictEqual(b.subjectSha256, null, 'two different subject hashes were resolved into a code version anyway');
  assert.strictEqual(b.runSubjectSha256, OTHER_SUBJECT, 'both hashes must stay visible and stay apart');
  assert.strictEqual(b.gateSubjectSha256, RUN_SUBJECT);
  assert.ok(/does not cover this run/.test(b.reason),
    'a mismatch must say the page\'s verdict does not cover this run');
});

// A hash-shaped-ish string is not a subject hash. The projector has ONE answer
// to "is this a subject hash" (64 lowercase hex), and a looser one must not
// creep in on either side of the comparison.
test('G1 #3 RED: a non-canonical subject hash never links, on either side of the comparison', () => {
  const short = 'deadbeefdeadbeef';
  const runShort = M.bindCurrentRun(M.orderRuns([
    mkRun('RUN-SHORT', '2026-08-26T10:00:00.000Z', { subjectSha256: short }),
  ]), short);
  assert.strictEqual(runShort.runSubjectSha256, null,
    'a 16-character string was accepted as the run\'s canonical subject hash');
  assert.strictEqual(runShort.subjectSha256, null, 'two equal non-hashes were treated as a proven linkage');
  assert.strictEqual(runShort.subjectState, 'UNLINKED');

  // Uppercase hex is not the canonical form either.
  const upper = 'A'.repeat(64);
  const runUpper = M.bindCurrentRun(M.orderRuns([
    mkRun('RUN-UPPER', '2026-08-26T10:00:00.000Z', { subjectSha256: upper }),
  ]), upper);
  assert.strictEqual(runUpper.runSubjectSha256, null, 'a non-canonical hash form was accepted as a subject hash');
  assert.strictEqual(runUpper.subjectSha256, null);
});

// ── G1 finding #5: the canonical subject location, proved by a table ───────
// runSubjectOf is the ONLY reader of a run's recorded subject hash. The proof
// of that used to run projectRuns against the LIVE runs directory and check
// that any non-null result looked like 64 hex characters. In the reviewed
// workspace that directory held zero runs, so the loop body never executed and
// the test asserted nothing at all — while its name claimed the strongest
// property in this file. A regression that read a top-level `subjectSha256`, or
// a second nested field, would have passed it.
//
// It is now a table over INJECTED run records. One canonical location is
// accepted; every alternate location, every malformed value and every decoy is
// refused; and each case asserts BOTH halves — what the run publishes and what
// the current-run binding does with it.
const TABLE_OTHER_SUBJECT = 'b'.repeat(64);
const DECOY_SUBJECT = 'd'.repeat(64);

const RUNS_TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-runs-'));
process.on('exit', () => { try { fs.rmSync(RUNS_TMP, { recursive: true, force: true }); } catch {} });
let runsDirNo = 0;
// A private runs directory holding exactly the records handed in. Nothing here
// touches builder-control/runs.
function fixtureRunsDir(records) {
  const d = path.join(RUNS_TMP, `runs-${++runsDirNo}`);
  fs.mkdirSync(d, { recursive: true });
  records.forEach((r) => fs.writeFileSync(
    path.join(d, `${r.runId}.json`), JSON.stringify(r, null, 2)));
  return d;
}

const WATCHDOG_TRANSITIONS = [
  ['CREATED', 'INTAKE_RECORDED'],
  ['INTAKE_RECORDED', 'ROUTED'],
  ['ROUTED', 'WORKTREE_READY'],
  ['WORKTREE_READY', 'BUILDING'],
  ['BUILDING', 'BUILT'],
  ['BUILT', 'CHECKS_PASSED'],
];

function watchdogRun(runId, transitions = WATCHDOG_TRANSITIONS) {
  return runRecord(runId, {
    state: 'CHECKS_PASSED',
    transitions: transitions.map(([from, to], index) => ({
      from, to, ts: `2026-08-29T10:00:0${index}.000Z`, ledgerEntryId: `LED-${index + 1}`,
    })),
  });
}

function withWatchdogLedger(run, recordedTransitions, fn) {
  const ledgerFile = path.join(RUNS_TMP, `watchdog-ledger-${++runsDirNo}.json`);
  const entries = recordedTransitions.map(([from, to], index) => {
    const transition = (run.transitions || [])[index] || {};
    return ({
      entryId: transition.ledgerEntryId || `LED-WATCH-${index + 1}`,
      ts: `2026-08-29T10:00:0${index}.000Z`,
      agentId: 'claude-code',
      gate: 'aegis-run',
      status: 'PASS',
      plane: 'CONTROL',
      correlationId: run.runId,
      operationId: transition.operationId || `${run.runId}:${from}->${to}`,
      attempt: 1,
      result: `${from} -> ${to}`,
      notes: `run ${run.runId}: ${from} -> ${to}`,
    });
  });
  for (const entry of entries) {
    assert.deepStrictEqual(LW.validateEntry(entry), [],
      `watchdog fixture is not a canonical ledger entry: ${entry.operationId}`);
  }
  fs.writeFileSync(ledgerFile, JSON.stringify(entries, null, 2));
  const before = process.env.AEGIS_LEDGER_FILE;
  process.env.AEGIS_LEDGER_FILE = ledgerFile;
  try { return fn(); }
  finally {
    if (before === undefined) delete process.env.AEGIS_LEDGER_FILE;
    else process.env.AEGIS_LEDGER_FILE = before;
  }
}

const RUN_CASE_ID = 'RUN-20260826-00000001';
const RUN_CITED_ID = 'RUN-20260826-00000002';
const RUN_LIFECYCLE_ID = 'RUN-20260826-00000003';
const RUN_ROUTE_ID = 'RUN-20260826-00000004';

test('malformed run evidence degrades the projection and the surface instead of becoming clean empty state', () => {
  const dir = fixtureRunsDir([]);
  fs.writeFileSync(path.join(dir, '000-malformed.json'), '{"runId":', 'utf8');

  const projected = M.projectRuns({ subjectSha256: RUN_SUBJECT, runsDir: dir });
  assert.strictEqual(projected.state, 'UNAVAILABLE');
  assert.strictEqual(projected.invalidRecords, 1);
  assert.strictEqual(projected.runs.length, 0,
    'unreadable bytes must not be published as a run');
  assert.strictEqual(projected.current.state, 'UNAVAILABLE');
  assert.strictEqual(projected.current.evidenceState, 'UNAVAILABLE');
  assert.match(projected.current.reason, /could not be read or validated/);

  const snap = M.snapshot({}, { runsDir: dir });
  assert.notStrictEqual(snap.runs.state, 'OK',
    'a snapshot promoted an unreadable run directory to available evidence');
  assert.strictEqual(snap.engineering.state, 'UNAVAILABLE');
  assert.match(snap.engineering.reason, /no unique validated current run worktree/,
    'malformed run evidence must not let the gate fall back to the control checkout');
});

test('parseable non-run JSON is invalid evidence, while a genuinely empty directory is affirmatively empty', () => {
  const malformedDir = fixtureRunsDir([]);
  fs.writeFileSync(path.join(malformedDir, '000-not-a-run.json'), '[]', 'utf8');
  const malformed = M.projectRuns({ runsDir: malformedDir });
  assert.strictEqual(malformed.state, 'UNAVAILABLE');
  assert.strictEqual(malformed.current.evidenceState, 'UNAVAILABLE');

  const empty = M.projectRuns({ runsDir: fixtureRunsDir([]) });
  assert.strictEqual(empty.state, 'OK');
  assert.deepStrictEqual(empty.runs, []);
  assert.strictEqual(empty.current.state, 'UNAVAILABLE');
  assert.strictEqual(empty.current.evidenceState, 'OK',
    'the live surface needs positive evidence that an empty directory was actually read');
  assert.match(empty.current.reason, /no run records exist yet/);
});

test('run identity is canonical, matches its filename, and stays in parity with the runtime authority', () => {
  for (const runId of [
    'RUN-20260829-deadbeef',
    'RUN-20260829-DEADBEEF',
    'RUN-20260829-deadbee',
    'RUN-2026-08-29-deadbeef',
    'RUN-CASE',
  ]) {
    let runtimeAccepts = true;
    try { R.runPath(runId); } catch { runtimeAccepts = false; }
    assert.strictEqual(M.RUN_ID_RE.test(runId), runtimeAccepts,
      `${runId}: projector identity diverged from aegis-run.cjs`);
  }

  const canonical = runRecord('RUN-20260829-deadbeef');
  const aliasDir = fixtureRunsDir([]);
  fs.writeFileSync(path.join(aliasDir, 'friendly-name.json'), JSON.stringify(canonical));
  const alias = M.projectRuns({ runsDir: aliasDir, now: '2026-08-29T23:59:59.000Z' });
  assert.strictEqual(alias.state, 'UNAVAILABLE');
  assert.match(alias.reason, /alias; canonical filename is RUN-20260829-deadbeef\.json/);

  const noncanonicalDir = fixtureRunsDir([]);
  fs.writeFileSync(path.join(noncanonicalDir, 'RUN-CASE.json'), JSON.stringify(runRecord('RUN-CASE')));
  const noncanonical = M.projectRuns({ runsDir: noncanonicalDir, now: '2026-08-29T23:59:59.000Z' });
  assert.strictEqual(noncanonical.state, 'UNAVAILABLE');
  assert.match(noncanonical.reason, /canonical RUN-YYYYMMDD-8hex runId/);
});

test('duplicate runIds are refused even when one copy uses an alias filename', () => {
  const run = runRecord('RUN-20260829-abcd1234');
  const dir = fixtureRunsDir([run]);
  fs.writeFileSync(path.join(dir, 'duplicate.json'), JSON.stringify(run));
  const out = M.projectRuns({ runsDir: dir, now: '2026-08-29T23:59:59.000Z' });
  assert.strictEqual(out.state, 'UNAVAILABLE');
  assert.strictEqual(out.invalidRecords, 1);
  assert.match(out.reason, /appears in more than one run file/);
  assert.strictEqual(out.current.evidenceState, 'UNAVAILABLE');
});

test('mixed valid and malformed run evidence fails every runtime-derived lifecycle stage closed', () => {
  const valid = runRecord('RUN-20260829-abcdef12', {
    createdAt: '2026-08-29T10:00:00.000Z', updatedAt: '2026-08-29T10:01:00.000Z',
    objective: 'must not become a green stage beside malformed evidence',
    risk: { lane: 'FULL', highRisk: false },
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
    worktree: { path: '/tmp/aegis', branch: 'aegis/test' }, build: { exit: 0 },
    checks: { passed: 1, total: 1 },
  });
  const dir = fixtureRunsDir([valid]);
  fs.writeFileSync(path.join(dir, 'malformed.json'), '{', 'utf8');
  const projected = M.projectRuns({ runsDir: dir, now: '2026-08-29T23:59:59.000Z' });
  assert.strictEqual(projected.state, 'UNAVAILABLE');
  assert.strictEqual(projected.runs.length, 1, 'the valid record may remain visible for audit');

  const stages = M.deriveStages({ problems: [], observed: [] }, projected.runs, {
    runs: projected, events: { state: 'OK' }, cost: { state: 'OK' }, reviewers: { state: 'OK' },
  });
  const runtimeStageIds = new Set(['objective', 'acceptance', 'routing', 'worktree', 'build', 'correction', 'watchdog', 'checkpoint']);
  const runtimeStages = stages.filter((stage) => runtimeStageIds.has(stage.id));
  assert.ok(runtimeStages.length > 0);
  assert.ok(runtimeStages.every((stage) => stage.state !== 'PASS'),
    `runtime evidence leaked PASS beside an invalid record: ${JSON.stringify(runtimeStages)}`);
  assert.match(stages.find((stage) => stage.id === 'surface').reason, /run evidence unavailable/);
});

test('worktree stage passes only a bounded canonical run worktree receipt and never publishes its path', () => {
  const runId = 'RUN-20260829-c0ffee01';
  const baseCommit = '1'.repeat(40);
  const worktreeTransitions = WATCHDOG_TRANSITIONS.slice(0, 3);
  const valid = runRecord(runId, {
    state: 'WORKTREE_READY', baseCommit,
    worktree: {
      path: `/tmp/aegis-wt-${runId}`,
      branch: `aegis/${runId}`,
      createdAt: '2026-08-29T10:00:00.000Z',
      baseCommit,
    },
    transitions: worktreeTransitions.map(([from, to], index) => ({
      from, to, ts: `2026-08-29T10:00:0${index}.000Z`, ledgerEntryId: `LED-WORKTREE-${index + 1}`,
    })),
  });
  const projected = withWatchdogLedger(valid, worktreeTransitions,
    () => M.projectRuns({ runsDir: fixtureRunsDir([valid]), now: '2026-08-29T23:59:59.000Z' }));
  assert.deepStrictEqual(projected.runs[0].worktree, {
    state: 'VALIDATED', isolated: true, branch: `aegis/${runId}`,
  });
  assert.ok(!JSON.stringify(projected.runs[0]).includes(`/tmp/aegis-wt-${runId}`),
    'the private absolute worktree path crossed the dashboard projection');
  const stage = M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'worktree');
  assert.deepStrictEqual(stage, {
    id: 'worktree', step: 4, label: 'Isolated worktree', evidence: 'aegis-run run.worktree',
    state: 'PASS', reason: `isolated worktree on validated branch aegis/${runId}`,
  });

  for (const [label, worktree, expected] of [
    ['truthy string', '/tmp/looks-real', /not an object/],
    ['foreign branch', { ...valid.worktree, branch: 'main' }, /branch is not aegis\//],
    ['unbounded path', { ...valid.worktree, path: '/tmp/another-place' }, /bounded aegis-wt-/],
    ['mismatched base', { ...valid.worktree, baseCommit: '2'.repeat(40) }, /matching canonical base commit/],
  ]) {
    const record = runRecord(runId, {
      state: 'WORKTREE_READY', baseCommit, worktree,
      transitions: valid.transitions,
    });
    const out = withWatchdogLedger(record, worktreeTransitions,
      () => M.projectRuns({ runsDir: fixtureRunsDir([record]), now: '2026-08-29T23:59:59.000Z' }));
    assert.strictEqual(out.runs[0].worktree.state, 'INVALID', `${label}: malformed worktree passed projection`);
    const failed = M.deriveStages({ problems: [], observed: [] }, out.runs)
      .find((item) => item.id === 'worktree');
    assert.strictEqual(failed.state, 'FAILED', `${label}: malformed worktree passed the lifecycle stage`);
    assert.match(failed.reason, expected, `${label}: exact validation diagnosis was lost`);
  }
});

test('checkpoint projection publishes only one digest-authenticated, run-bound, reviewed transition receipt', () => {
  const stable = (value) => Array.isArray(value) ? value.map(stable) :
    (value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
      : value);
  const sign = (body) => ({ ...body,
    digest: crypto.createHash('sha256').update(JSON.stringify(stable(body))).digest('hex') });
  const runId = 'RUN-20260829-c0ffee02';
  const objective = 'Bind the exact reviewed dashboard subject to one safe checkpoint.';
  const subjectSha256 = 'a'.repeat(64);
  const checkReceiptSha256 = 'b'.repeat(64);
  const packet = { path: 'builder-control/packets/PKT-CHECKPOINT.json', sha256: 'c'.repeat(64) };
  const rollbackPoint = 'd'.repeat(40);
  const reviewedBase = '2'.repeat(40);
  const transitionPairs = [
    ['CREATED', 'INTAKE_RECORDED'], ['INTAKE_RECORDED', 'ROUTED'],
    ['ROUTED', 'WORKTREE_READY'], ['WORKTREE_READY', 'BUILDING'],
    ['BUILDING', 'BUILT'], ['BUILT', 'CHECKS_PASSED'],
    ['CHECKS_PASSED', 'REVIEW_BOUND'], ['REVIEW_BOUND', 'CHECKPOINTED'],
  ];
  const checkpointBody = {
    checkpointId: 'CP-20260829010101-c0ffee02', runId,
    createdAt: '2026-08-29T10:00:07.000Z', rollbackPoint,
    baseCommit: '1'.repeat(40), tree: '3'.repeat(40), reviewedBase,
    packet,
    subject: { subjectSha256, subjectPaths: ['builder-control/dashboard/index.html'],
      diffBytes: 123, reviewedRange: 'HEAD', committedRange: `${reviewedBase}..${rollbackPoint}` },
    checkReceiptSha256, checks: { passed: 1, total: 1 }, objective,
  };
  const makeRun = (checkpoint = sign(checkpointBody), transitions = transitionPairs) => runRecord(runId, {
    state: 'CHECKPOINTED', objective, baseCommit: checkpointBody.baseCommit,
    subject: { subjectSha256, pathCount: 1, diffBytes: 123, range: 'HEAD' },
    reviewGate: { subjectSha256, checkReceiptSha256, packet, headCommit: checkpointBody.reviewedBase },
    checks: { passed: 1, total: 1 }, checkpoint,
    transitions: transitions.map(([from, to], index) => ({
      from, to, ts: `2026-08-29T10:00:0${index + 1}.000Z`,
      ledgerEntryId: `LED-RUN-checkpoint-${index + 1}`,
      notes: from === 'REVIEW_BOUND'
        ? `checkpoint ${checkpoint.checkpointId} at ${checkpoint.rollbackPoint.slice(0, 12)}`
        : `${from} -> ${to}`,
    })),
  });
  const valid = makeRun();
  const projected = withWatchdogLedger(valid, transitionPairs,
    () => M.projectRuns({ runsDir: fixtureRunsDir([valid]), now: '2026-08-29T23:59:59.000Z' }));
  assert.strictEqual(projected.runs[0].checkpoint, checkpointBody.checkpointId);
  assert.strictEqual(projected.runs[0].rollbackPoint, rollbackPoint);
  assert.strictEqual(projected.runs[0].checkpointState, 'VALIDATED');
  assert.deepStrictEqual(M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'checkpoint'), {
      id: 'checkpoint', step: 10, label: 'Checkpoint + rollback',
      evidence: 'aegis-run run.checkpoint.rollbackPoint', state: 'PASS',
      reason: `checkpoint ${checkpointBody.checkpointId} at dddddddddddd`,
    });

  const invalidCases = [
    ['digest', { ...sign(checkpointBody), digest: '0'.repeat(64) }, transitionPairs,
      /digest does not authenticate/],
    ['run binding', sign({ ...checkpointBody, runId: 'RUN-20260829-deadbeef' }), transitionPairs,
      /not bound to this run/],
    ['review subject binding', sign({ ...checkpointBody, subject: {
      ...checkpointBody.subject, subjectSha256: 'e'.repeat(64) } }), transitionPairs,
      /does not bind one reviewed subject/],
    ['check receipt binding', sign({ ...checkpointBody, checkReceiptSha256: 'f'.repeat(64) }), transitionPairs,
      /does not bind one reviewed subject/],
    ['committed range binding', sign({ ...checkpointBody, subject: {
      ...checkpointBody.subject, committedRange: 'HEAD' } }), transitionPairs,
      /committed range does not bind/],
    ['rollback commit shape', sign({ ...checkpointBody, rollbackPoint: 'abc1234' }), transitionPairs,
      /canonical rollback/],
    ['checkpoint transition', sign(checkpointBody), transitionPairs.slice(0, -1),
      /canonical CHECKPOINTED transition/],
  ];
  for (const [label, receipt, transitions, reason] of invalidCases) {
    const invalidRun = makeRun(receipt, transitions);
    const refused = withWatchdogLedger(invalidRun, transitions,
      () => M.projectRuns({ runsDir: fixtureRunsDir([invalidRun]), now: '2026-08-29T23:59:59.000Z' }));
    assert.strictEqual(refused.runs[0].checkpointState, 'INVALID', `${label}: receipt passed projection`);
    assert.strictEqual(refused.runs[0].checkpoint, null, `${label}: checkpoint id escaped fail-closed projection`);
    assert.strictEqual(refused.runs[0].rollbackPoint, null, `${label}: rollback point escaped fail-closed projection`);
    const failed = M.deriveStages({ problems: [], observed: [] }, refused.runs)
      .find((item) => item.id === 'checkpoint');
    assert.strictEqual(failed.state, 'FAILED', `${label}: invalid receipt passed stage 10`);
    assert.match(failed.reason, reason, `${label}: exact refusal diagnosis was lost`);
  }
});

test('future-dated run evidence is unavailable and cannot win current-run selection', () => {
  const now = '2026-08-29T12:00:00.000Z';
  const current = runRecord('RUN-20260829-11111111', {
    createdAt: '2026-08-29T10:00:00.000Z', updatedAt: '2026-08-29T10:01:00.000Z',
  });
  const future = runRecord('RUN-20990101-22222222', {
    createdAt: '2099-01-01T10:00:00.000Z', updatedAt: '2099-01-01T10:01:00.000Z',
  });
  assert.strictEqual(M.selectCurrentRun([current, future], Date.parse(now)).runId, current.runId,
    'future evidence won the pure current-run selector');

  const projected = M.projectRuns({ runsDir: fixtureRunsDir([current, future]), now });
  assert.strictEqual(projected.state, 'UNAVAILABLE');
  assert.strictEqual(projected.current.state, 'UNAVAILABLE');
  assert.strictEqual(projected.current.evidenceState, 'UNAVAILABLE');
  assert.match(projected.reason, /future timestamp/);
  assert.match(projected.reason, /current run status and lifecycle evidence are unavailable/);
});

test('an unavailable pre-review engineering gate keeps independent review UNVERIFIED', () => {
  const run = runRecord('RUN-20260830-10101010', {
    state: 'CHECKS_PASSED', updatedAt: '2026-08-30T10:00:00.000Z',
    checks: { passed: 1, total: 1 },
  });
  const snap = M.snapshot({}, {
    runsDir: fixtureRunsDir([run]), now: '2026-08-30T10:01:00.000Z',
  });
  assert.strictEqual(snap.engineering.state, 'UNAVAILABLE');
  const review = snap.engineering.stages.find((stage) => stage.id === 'review');
  assert.strictEqual(review.state, 'UNVERIFIED');
  assert.match(review.reason, /engineering gate unavailable/i);
  assert.doesNotMatch(review.reason, /rejected|blocked|failed/i,
    'missing gate evidence was presented as a review verdict');
});
// A schema-shaped run record. `extra` decides where — if anywhere — a subject
// hash is written.
function runRecord(runId, extra) {
  return Object.assign({
    runId, state: 'BUILT', objective: 'o-' + runId,
    createdAt: '2026-08-26T10:00:00.000Z', updatedAt: '2026-08-26T10:00:00.000Z',
    packet: 'PKT-TEST', risk: 'FULL',
  }, extra || {});
}

test('mutable REVIEW_FAILED evidence remains an uncorroborated claim in the public projection', () => {
  const valid = runRecord('RUN-20260829-a1b2c3d4', {
    state: 'REVIEW_FAILED',
    reviewFailure: {
      schemaVersion: 1, status: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
      subjectSha256: 'a'.repeat(64), checkReceiptSha256: 'b'.repeat(64),
      packet: { path: 'builder-control/packets/PKT-TEST.json', sha256: 'c'.repeat(64) },
      refusedAt: '2026-08-29T10:00:00.000Z', authority: 'engineering-os.cjs --gate-done',
      rejectedReviewers: [{ reviewer: 'codex', reviewId: 'REV-codex-current' }],
      blockingFindingCount: 2, refusalRuleCount: 3,
      summary: '/private/host/secret must never be copied',
      rawGate: { detail: 'credential-shaped untrusted prose' },
    },
  });
  const projected = M.projectRuns({ runsDir: fixtureRunsDir([valid]), now: '2026-08-29T23:59:59.000Z' });
  assert.strictEqual(projected.state, 'OK');
  const failure = projected.runs[0].reviewFailure;
  assert.deepStrictEqual(failure, {
    status: 'UNVERIFIED', reasonCode: 'REVIEW_FAILURE_UNCORROBORATED',
    summary: 'The run records a review-failure claim, but attested exact-subject gate evidence is unavailable in this projection.',
  });
  assert.ok(!JSON.stringify(failure).includes('codex') &&
    !JSON.stringify(failure).includes('2 blocking') &&
    !JSON.stringify(failure).includes('a'.repeat(64)),
  'mutable reviewer identity, counts, or hashes escaped as a blocking verdict');
  assert.ok(!JSON.stringify(failure).includes('secret'));

  const hostile = runRecord('RUN-20260829-b1c2d3e4', {
    state: 'REVIEW_FAILED',
    reviewFailure: { ...valid.reviewFailure,
      rejectedReviewers: [{ reviewer: '<script>', reviewId: 'REV-codex-current' }] },
  });
  const refused = M.projectRuns({ runsDir: fixtureRunsDir([hostile]), now: '2026-08-29T23:59:59.000Z' });
  assert.strictEqual(refused.runs[0].reviewFailure, null,
    'malformed reviewer identity reached the public run projection');
});

test('only one exact canonical gate, packet and receipt can corroborate a review refusal', () => {
  const subject = {
    subjectSha256: 'a'.repeat(64), subjectPaths: ['builder-control/aegis-state.cjs'],
    diffBytes: 10, range: 'HEAD',
  };
  const packet = { path: 'builder-control/packets/PKT-TEST.json', sha256: 'b'.repeat(64) };
  const receipt = { receiptSha256: 'c'.repeat(64) };
  const claim = {
    schemaVersion: 1, status: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
    subjectSha256: subject.subjectSha256, checkReceiptSha256: receipt.receiptSha256,
    packet, refusedAt: '2026-08-30T12:01:00.000Z', authority: 'engineering-os.cjs --gate-done',
    rejectedReviewers: [{ reviewer: 'codex', reviewId: 'REV-codex-current' }],
    blockingFindingCount: 1, refusalRuleCount: 2,
    summary: 'Independent review found 1 blocking issue(s) on this exact checked version.',
  };
  const gate = {
    ok: false, state: 'BLOCKED', subject,
    problems: [
      { rule: 'ENGOS-REVIEW-REJECTED', detail: 'bounded' },
      { rule: 'ENGOS-OPEN-BLOCKING-FINDING',
        detail: 'HIGH from codex in builder-control/aegis-state.cjs: bounded' },
    ],
    reviewerCompleteness: {
      complete: true, subjectSha256: subject.subjectSha256,
      pathCoverage: { notCoveredByEveryRequiredReviewer: [] },
      rows: [{ reviewer: 'codex', reviewId: 'REV-codex-current', required: 'REQUIRED',
        executed: 'EXECUTED', disposition: 'REJECT', missingPaths: [], stalePaths: [] }],
    },
  };
  assert.deepStrictEqual(M.canonicalReviewRefusal(gate, claim, subject, packet, receipt), claim);
  for (const [label, nextClaim, nextSubject, nextPacket, nextReceipt] of [
    ['subject', { ...claim, subjectSha256: 'd'.repeat(64) }, subject, packet, receipt],
    ['gate subject', claim, { ...subject, subjectSha256: 'd'.repeat(64) }, packet, receipt],
    ['packet', claim, subject, { ...packet, sha256: 'd'.repeat(64) }, receipt],
    ['receipt', claim, subject, packet, { receiptSha256: 'd'.repeat(64) }],
  ]) {
    assert.strictEqual(M.canonicalReviewRefusal(gate, nextClaim, nextSubject, nextPacket, nextReceipt), null,
      `${label} mismatch promoted a mutable refusal claim`);
  }
});

test('review refusals correlate open blockers only to the reviewer named by canonical gate evidence', () => {
  const subject = {
    subjectSha256: 'a'.repeat(64), subjectPaths: ['builder-control/aegis-state.cjs'],
    diffBytes: 10, range: 'HEAD',
  };
  const packet = { path: 'builder-control/packets/PKT-TEST.json', sha256: 'b'.repeat(64) };
  const receipt = { receiptSha256: 'c'.repeat(64) };
  const claim = {
    schemaVersion: 1, status: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
    subjectSha256: subject.subjectSha256, checkReceiptSha256: receipt.receiptSha256,
    packet, refusedAt: '2026-08-30T12:01:00.000Z', authority: 'engineering-os.cjs --gate-done',
    rejectedReviewers: [{ reviewer: 'grok', reviewId: 'REV-grok-current' }],
    blockingFindingCount: 1, refusalRuleCount: 1,
    summary: 'Independent review found 1 blocking issue(s) on this exact checked version.',
  };
  const rows = [
    { reviewer: 'codex', reviewId: 'REV-codex-current', required: 'REQUIRED',
      executed: 'EXECUTED', disposition: 'APPROVE', missingPaths: [], stalePaths: [] },
    { reviewer: 'grok', reviewId: 'REV-grok-current', required: 'REQUIRED',
      executed: 'EXECUTED', disposition: 'APPROVE_WITH_NOTES', missingPaths: [], stalePaths: [] },
  ];
  const gate = {
    ok: false, state: 'BLOCKED', subject,
    problems: [{ rule: 'ENGOS-OPEN-BLOCKING-FINDING',
      detail: 'HIGH from grok in builder-control/aegis-state.cjs: bounded' }],
    reviewerCompleteness: { complete: true, subjectSha256: subject.subjectSha256,
      pathCoverage: { notCoveredByEveryRequiredReviewer: [] }, rows },
  };
  assert.deepStrictEqual(M.canonicalReviewRefusal(gate, claim, subject, packet, receipt), claim,
    'the named reviewer blocker was not correlated to that reviewer');
  assert.strictEqual(M.canonicalReviewRefusal(gate,
    { ...claim, rejectedReviewers: [
      { reviewer: 'codex', reviewId: 'REV-codex-current' },
      { reviewer: 'grok', reviewId: 'REV-grok-current' },
    ] }, subject, packet, receipt), null,
  'one reviewer blocker contaminated an approving reviewer');
  assert.strictEqual(M.canonicalReviewRefusal({ ...gate, problems: [
    { rule: 'ENGOS-OPEN-BLOCKING-FINDING', detail: 'bounded without a reviewer identity' },
  ] }, claim, subject, packet, receipt), null,
  'malformed gate evidence was guessed into reviewer ownership');
});

test('run projection distinguishes MODEL_AUTH_FAILURE and a non-executable Grok failover without raw output', () => {
  const run = runRecord('RUN-20260829-c1d2e3f4', {
    state: 'BUILD_FAILED',
    build: {
      mode: 'async', workerState: 'FAILED', exit: 1,
      failure: { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
        summary: 'raw provider output must not cross', retrySafe: true, failoverEligible: true },
      providerSelection: { provider: 'grok-subscription', model: 'grok-4.6',
        reason: 'raw policy explanation must not cross' },
      handoff: { state: 'UNAVAILABLE', executable: false,
        reason: 'raw handoff text must not cross', fromProvider: 'claude-subscription',
        toProvider: 'grok-subscription', failureCode: 'MODEL_AUTH_FAILURE',
        sameProviderRetryAllowed: false, unchangedObjective: true },
      recovery: { reason: 'MODEL_AUTH_FAILURE', retrySafe: false, providerFailoverRequired: true,
        selectedProvider: 'grok-subscription', selectedModel: 'grok-4.6' },
      stdoutTail: 'credential-shaped raw output', stderrTail: 'secret raw output',
    },
  });
  const projected = M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-29T23:59:59.000Z' });
  const build = projected.runs[0].build;
  assert.deepStrictEqual(build.failure, {
    code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription', summary: 'Claude authentication failed.',
  });
  assert.deepStrictEqual(build.failover, {
    state: 'NOT_EXECUTABLE', provider: 'grok-subscription', model: 'grok-4.6',
    reason: 'Grok is the next eligible builder, but automatic failover is not enabled for this beta.',
  });
  assert.ok(!JSON.stringify(build).includes('raw output') && !JSON.stringify(build).includes('secret'));
  const stage = M.deriveStages({ ok: false, problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'build');
  assert.strictEqual(stage.state, 'FAILED');
  assert.match(stage.reason, /Claude authentication failed.*Grok.*not enabled/i);
});

test('run projection preserves the bounded unverified-termination signal for hosting', () => {
  const run = runRecord('RUN-20260829-c1d2e3f5', {
    state: 'BUILD_FAILED',
    build: {
      mode: 'async', workerState: 'FAILED', exit: 124, timedOut: true,
      recovery: { reason: 'TERMINATION_UNVERIFIED', retrySafe: false,
        terminationVerified: false, secret: 'must not cross' },
    },
  });
  const projected = M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-29T23:59:59.000Z' });
  assert.deepStrictEqual(projected.runs[0].build.recovery, {
    reason: 'TERMINATION_UNVERIFIED', retrySafe: false, terminationVerified: false,
  });
  assert.ok(!JSON.stringify(projected.runs[0].build).includes('must not cross'));
});

function lifecycleEvidenceRun(runId) {
  const baseCommit = 'a'.repeat(40);
  return Object.assign(watchdogRun(runId), {
    objective: 'Prove founder-visible lifecycle truth',
    acceptanceCriteria: ['Only canonical evidence can light a stage'],
    risk: { state: 'CLASSIFIED', lane: 'FULL', highRisk: true },
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
    baseCommit,
    worktree: {
      path: path.join(os.tmpdir(), `aegis-wt-${runId}`),
      branch: `aegis/${runId}`,
      baseCommit,
      createdAt: '2026-08-29T10:00:02.000Z',
    },
    build: { exit: 0 },
    checks: { passed: 1, total: 1 },
  });
}

function attachCanonicalPassingCheckReceipt(run) {
  const body = {
    schemaVersion: 1,
    authority: 'aegis-run.cjs runChecks',
    runId: run.runId,
    packet: { path: 'builder-control/packets/PKT-TEST.json', sha256: 'b'.repeat(64) },
    subject: {
      subjectSha256: 'c'.repeat(64),
      subjectPaths: ['builder-control/aegis-state.cjs'],
      diffBytes: 1,
      range: null,
    },
    startedAt: '2026-08-29T10:00:06.000Z',
    completedAt: '2026-08-29T10:00:07.000Z',
    complete: true,
    outcome: 'PASS',
    total: 1,
    passed: 1,
    results: [{
      cmd: 'node builder-control/test/aegis-state.test.cjs',
      status: 'EXECUTED',
      exit: 0,
      ranAt: '2026-08-29T10:00:06.500Z',
    }],
  };
  const receipt = { ...body, receiptSha256: R.checkReceiptDigest(body) };
  run.checks = {
    passed: 1,
    total: 1,
    receiptRef: R.persistCanonicalCheckReceipt(run, receipt),
  };
}

function attachCanonicalPreHostCheckReceipt(run) {
  const body = {
    schemaVersion: 1,
    receiptType: 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1',
    authority: 'aegis-run.cjs runChecks',
    runId: run.runId,
    packet: { path: 'builder-control/packets/PKT-TEST.json', sha256: 'b'.repeat(64) },
    subject: {
      subjectSha256: 'c'.repeat(64),
      subjectPaths: ['builder-control/aegis-state.cjs'],
      diffBytes: 1,
      range: null,
    },
    snapshot: {
      policy: 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1',
      captureSha256: 'd'.repeat(64),
    },
    startedAt: '2026-08-29T10:00:06.000Z',
    completedAt: '2026-08-29T10:00:07.000Z',
    complete: true,
    outcome: 'PASS',
    total: 1,
    passed: 1,
    results: [{
      cmd: 'node builder-control/test/aegis-state.test.cjs',
      status: 'EXECUTED', exit: 0, ranAt: '2026-08-29T10:00:06.500Z',
    }],
    hostContainment: {
      state: 'PENDING',
      commands: ['node builder-control/test/host-containment.test.cjs'],
    },
  };
  const receipt = { ...body, receiptSha256: R.checkReceiptDigest(body) };
  run.checks = {
    passed: 1,
    total: 1,
    hostContainment: { state: 'PENDING' },
    preHostReceiptRef: R.persistCanonicalPreHostCheckReceipt(run, receipt),
  };
}

test('mutable run claims cannot light lifecycle stages without exact canonical ledger evidence', () => {
  const run = lifecycleEvidenceRun('RUN-20260829-aaaab010');
  const projected = withWatchdogLedger(run, [],
    () => M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-29T23:59:59.000Z' }));
  const stages = M.deriveStages({ problems: [], observed: [] }, projected.runs);
  for (const id of ['objective', 'acceptance', 'routing', 'worktree', 'build', 'deterministic']) {
    const stage = stages.find((item) => item.id === id);
    assert.ok(!['PASS', 'RUNNING'].includes(stage.state),
      `${id} was lit by mutable run JSON without canonical ledger evidence: ${JSON.stringify(stage)}`);
  }
  assert.deepStrictEqual(projected.runs[0].watchdog.corroboratedStages, []);
  assert.strictEqual(projected.runs[0].watchdog.checkReceiptValid, false);
});

test('ordered ledger transitions plus a digest-bound canonical check receipt light the proven lifecycle stages', () => {
  const run = lifecycleEvidenceRun('RUN-20260829-aaaab011');
  const projected = withWatchdogLedger(run, WATCHDOG_TRANSITIONS, () => {
    attachCanonicalPassingCheckReceipt(run);
    return M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-29T23:59:59.000Z' });
  });
  assert.deepStrictEqual(projected.runs[0].watchdog.corroboratedStages,
    ['INTAKE_RECORDED', 'ROUTED', 'WORKTREE_READY', 'BUILDING', 'BUILT', 'CHECKS_PASSED']);
  assert.strictEqual(projected.runs[0].watchdog.checkReceiptValid, true);
  const stages = M.deriveStages({ problems: [], observed: [] }, projected.runs);
  for (const id of ['objective', 'acceptance', 'routing', 'worktree', 'build', 'deterministic']) {
    const stage = stages.find((item) => item.id === id);
    assert.strictEqual(stage.state, 'PASS', `${id} did not light from exact evidence: ${JSON.stringify(stage)}`);
  }
});

test('a valid final deterministic receipt remains PASS after review binding and checkpointing', () => {
  const cases = [
    ['REVIEW_BOUND', [['CHECKS_PASSED', 'REVIEW_BOUND']]],
    ['CHECKPOINTED', [['CHECKS_PASSED', 'REVIEW_BOUND'], ['REVIEW_BOUND', 'CHECKPOINTED']]],
  ];
  for (const [state, suffix] of cases) {
    const transitions = [...WATCHDOG_TRANSITIONS, ...suffix];
    const run = Object.assign(lifecycleEvidenceRun(
      state === 'REVIEW_BOUND' ? 'RUN-20260830-abcde006' : 'RUN-20260830-abcde007'), {
      state,
      transitions: transitions.map(([from, to], index) => ({
        from, to, ts: `2026-08-29T10:00:${String(index).padStart(2, '0')}.000Z`,
        ledgerEntryId: `LED-${state}-${index + 1}`,
      })),
    });
    const projected = withWatchdogLedger(run, transitions, () => {
      attachCanonicalPassingCheckReceipt(run);
      return M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-30T12:00:00.000Z' });
    });
    assert.strictEqual(projected.runs[0].checks.outcome, 'PASS',
      `${state} erased its valid final deterministic receipt`);
    assert.strictEqual(projected.runs[0].checks.snapshotOutcome, 'PASS');
    const stage = M.deriveStages({ problems: [], observed: [] }, projected.runs)
      .find((item) => item.id === 'deterministic');
    assert.strictEqual(stage.state, 'PASS', `${state} downgraded deterministic evidence`);
  }
});

test('projected watchdog PASS comes from the canonical runtime watchdog over complete ledger-corroborated transitions', () => {
  const run = watchdogRun('RUN-20260829-aaaab001');
  const projected = withWatchdogLedger(run, WATCHDOG_TRANSITIONS,
    () => M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-29T23:59:59.000Z' }));
  assert.strictEqual(projected.runs[0].watchdog.ok, true);
  const watchdog = M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((stage) => stage.id === 'watchdog');
  assert.strictEqual(watchdog.state, 'PASS');
});

test('projected watchdog distinguishes an incomplete prefix from actual sequence drift', () => {
  const missing = watchdogRun('RUN-20260829-aaaab002', WATCHDOG_TRANSITIONS.slice(0, -1));
  const missingProjection = withWatchdogLedger(missing, WATCHDOG_TRANSITIONS.slice(0, -1),
    () => M.projectRuns({ runsDir: fixtureRunsDir([missing]), now: '2026-08-29T23:59:59.000Z' }));
  assert.ok(missingProjection.runs[0].watchdog.problems.some((p) =>
    p.rule === 'WATCHDOG-STAGE-MISSING' && /CHECKS_PASSED/.test(p.detail)));

  const reorderedTransitions = [
    ...WATCHDOG_TRANSITIONS.slice(0, 3),
    WATCHDOG_TRANSITIONS[4],
    WATCHDOG_TRANSITIONS[3],
    WATCHDOG_TRANSITIONS[5],
  ];
  const outOfOrder = watchdogRun('RUN-20260829-aaaab003', reorderedTransitions);
  const outOfOrderProjection = withWatchdogLedger(outOfOrder, reorderedTransitions,
    () => M.projectRuns({ runsDir: fixtureRunsDir([outOfOrder]), now: '2026-08-29T23:59:59.000Z' }));
  assert.strictEqual(outOfOrderProjection.runs[0].watchdog.ok, false);
  const orderProblems = outOfOrderProjection.runs[0].watchdog.problems;
  assert.deepStrictEqual(orderProblems, [{
    rule: 'WATCHDOG-OUT-OF-ORDER',
    detail: 'BUILT occurred before a stage that must precede it',
  }], 'the exact canonical diagnosis for the misordered BUILDING/BUILT sequence changed');

  const unrecorded = watchdogRun('RUN-20260829-aaaab004');
  const unrecordedProjection = withWatchdogLedger(unrecorded, WATCHDOG_TRANSITIONS.slice(0, -1),
    () => M.projectRuns({ runsDir: fixtureRunsDir([unrecorded]), now: '2026-08-29T23:59:59.000Z' }));
  assert.ok(unrecordedProjection.runs[0].watchdog.problems.some((p) =>
    p.rule === 'WATCHDOG-UNRECORDED-TRANSITION' && /BUILT -> CHECKS_PASSED/.test(p.detail)));

  const missingStage = M.deriveStages({ problems: [], observed: [] }, missingProjection.runs)
    .find((item) => item.id === 'watchdog');
  assert.strictEqual(missingStage.state, 'UNVERIFIED');
  assert.match(missingStage.reason, /corroborated through BUILT/);

  for (const projection of [outOfOrderProjection, unrecordedProjection]) {
    const stage = M.deriveStages({ problems: [], observed: [] }, projection.runs)
      .find((item) => item.id === 'watchdog');
    assert.strictEqual(stage.state, 'FAILED');
  }
});

test('an active canonical lifecycle prefix reports RUNNING while later watchdog stages have not occurred', () => {
  const prefix = WATCHDOG_TRANSITIONS.slice(0, 4);
  const run = runRecord('RUN-20260829-aaaab005', {
    state: 'BUILDING',
    build: { mode: 'async', workerState: 'RUNNING', workerPid: 4321 },
    transitions: prefix.map(([from, to], index) => ({
      from, to, ts: `2026-08-29T10:00:0${index}.000Z`, ledgerEntryId: `LED-PREFIX-${index + 1}`,
    })),
  });
  const projected = withWatchdogLedger(run, prefix,
    () => M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-29T23:59:59.000Z' }));
  const stage = M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'watchdog');
  assert.strictEqual(stage.state, 'RUNNING');
  assert.match(stage.reason, /corroborated through BUILDING/);
});

test('run projection carries bounded acceptance, correction cap and failed check truth', () => {
  const run = runRecord('RUN-20260829-aaaab006', {
    state: 'CHECKS_FAILED',
    acceptanceCriteria: ['one', 'two'],
    corrections: 2,
    maxCorrections: 3,
    checks: {
      passed: 4, total: 4,
      integrity: { state: 'FAILED', gaps: ['subject mismatch'] },
      hostContainment: { state: 'PASSED' },
      executionBoundary: { state: 'FAILED' },
      precondition: { state: 'FAILED', code: 'CHECK_SOURCE_MISMATCH' },
    },
  });
  const projected = M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-29T23:59:59.000Z' });
  const publicRun = projected.runs[0];
  assert.strictEqual(publicRun.acceptanceCriteriaCount, 2);
  assert.strictEqual(publicRun.corrections, 2);
  assert.strictEqual(publicRun.maxCorrections, 3);
  assert.deepStrictEqual(publicRun.checks, {
    passed: 4, total: 4, outcome: 'FAIL', snapshotOutcome: 'FAIL',
    integrityState: 'FAILED', integrityGapCount: 1,
    hostContainmentState: 'PASSED', executionBoundaryState: 'FAILED',
    hostContainmentReason: null,
    preconditionState: 'FAILED', preconditionCode: 'CHECK_SOURCE_MISMATCH',
  });
  const deterministic = M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'deterministic');
  assert.strictEqual(deterministic.state, 'FAILED');
  assert.match(deterministic.reason, /integrity failed.*execution boundary failed.*precondition failed/i);
});

test('mutable pre-host pass counters remain UNVERIFIED without canonical receipt and lifecycle evidence', () => {
  const run = runRecord('RUN-20260830-abcde001', {
    state: 'CHECKS_PASSED',
    checks: {
      passed: 12, total: 12,
      hostContainment: { state: 'PENDING',
        reason: 'awaiting exact-subject independent review before host execution' },
    },
  });
  const projected = M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-30T12:00:00.000Z' });
  assert.deepStrictEqual(projected.runs[0].checks, {
    passed: 12, total: 12, outcome: 'UNVERIFIED', snapshotOutcome: 'UNVERIFIED',
    integrityState: null, integrityGapCount: null, hostContainmentState: 'PENDING',
    hostContainmentReason: null,
    executionBoundaryState: null, preconditionState: null, preconditionCode: null,
  });
  const stage = M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'deterministic');
  assert.strictEqual(stage.state, 'UNVERIFIED');
  assert.doesNotMatch(stage.reason, /Snapshot checks passed/i);
});

test('canonical pre-host receipt plus corroborated lifecycle projects snapshot PASS and host PENDING', () => {
  const run = Object.assign(watchdogRun('RUN-20260830-abcde003'), {
    checks: { passed: 1, total: 1, hostContainment: { state: 'PENDING' } },
  });
  const projected = withWatchdogLedger(run, WATCHDOG_TRANSITIONS, () => {
    attachCanonicalPreHostCheckReceipt(run);
    return M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-30T12:00:00.000Z' });
  });
  assert.strictEqual(projected.runs[0].watchdog.checkReceiptValid, true);
  assert.strictEqual(projected.runs[0].watchdog.checkReceiptStage, 'PRE_HOST');
  assert.deepStrictEqual(projected.runs[0].checks, {
    passed: 1, total: 1, outcome: 'SNAPSHOT_PASS_HOST_PENDING', snapshotOutcome: 'PASS',
    integrityState: null, integrityGapCount: null, hostContainmentState: 'PENDING',
    hostContainmentReason: 'Snapshot checks passed; mandatory host containment is pending until exact-subject review completes.',
    executionBoundaryState: null, preconditionState: null, preconditionCode: null,
  });
  const stage = M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'deterministic');
  assert.strictEqual(stage.state, 'UNVERIFIED');
  assert.match(stage.reason, /Snapshot checks passed.*host containment is pending/i);
});

test('REVIEW_FAILED preserves a valid pre-host snapshot PASS while host containment remains pending', () => {
  const transitions = [...WATCHDOG_TRANSITIONS, ['CHECKS_PASSED', 'REVIEW_FAILED']];
  const run = Object.assign(lifecycleEvidenceRun('RUN-20260830-abcde008'), {
    state: 'REVIEW_FAILED',
    transitions: transitions.map(([from, to], index) => ({
      from, to, ts: `2026-08-29T10:00:${String(index).padStart(2, '0')}.000Z`,
      ledgerEntryId: `LED-REVIEW-FAILED-${index + 1}`,
    })),
  });
  const projected = withWatchdogLedger(run, transitions, () => {
    attachCanonicalPreHostCheckReceipt(run);
    return M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-30T12:00:00.000Z' });
  });
  assert.strictEqual(projected.runs[0].checks.outcome, 'SNAPSHOT_PASS_HOST_PENDING');
  assert.strictEqual(projected.runs[0].checks.snapshotOutcome, 'PASS');
  assert.match(projected.runs[0].checks.hostContainmentReason, /review did not pass/i);
  const stage = M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'deterministic');
  assert.strictEqual(stage.state, 'UNVERIFIED');
  assert.match(stage.reason, /host containment remains pending/i);
});

test('a retry build cannot inherit deterministic PASS from the prior checked generation', () => {
  const transitions = [
    ...WATCHDOG_TRANSITIONS,
    ['CHECKS_PASSED', 'REVIEW_FAILED'],
    ['REVIEW_FAILED', 'CORRECTING'],
    ['CORRECTING', 'BUILDING'],
  ];
  const run = Object.assign(lifecycleEvidenceRun('RUN-20260830-abcde004'), {
    state: 'BUILDING', corrections: 1,
    transitions: transitions.map(([from, to], index) => ({
      from, to, ts: `2026-08-29T10:00:${String(index).padStart(2, '0')}.000Z`,
      ledgerEntryId: `LED-RETRY-${index + 1}`,
    })),
  });
  const projected = withWatchdogLedger(run, transitions, () => {
    attachCanonicalPassingCheckReceipt(run);
    return M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-30T12:00:00.000Z' });
  });
  assert.strictEqual(projected.runs[0].watchdog.checkReceiptValid, true,
    'the test did not preserve the old authenticated receipt it is meant to challenge');
  assert.strictEqual(projected.runs[0].checks.outcome, 'UNVERIFIED');
  const stages = M.deriveStages({ problems: [], observed: [] }, projected.runs);
  const deterministic = stages.find((item) => item.id === 'deterministic');
  assert.strictEqual(deterministic.state, 'RUNNING');
  assert.match(deterministic.reason, /prior check receipt does not verify this new build generation/i);
  const correction = stages.find((item) => item.id === 'correction');
  assert.strictEqual(correction.state, 'PASS',
    'the exact ledger-backed CORRECTING transition was not recognized');
});

test('a mutable correction count cannot light PASS without its canonical CORRECTING transition', () => {
  const transitions = [
    ...WATCHDOG_TRANSITIONS,
    ['CHECKS_PASSED', 'REVIEW_FAILED'],
    ['REVIEW_FAILED', 'CORRECTING'],
  ];
  const run = Object.assign(lifecycleEvidenceRun('RUN-20260830-abcde005'), {
    state: 'CORRECTING', corrections: 1,
    transitions: transitions.map(([from, to], index) => ({
      from, to, ts: `2026-08-29T10:00:${String(index).padStart(2, '0')}.000Z`,
      ledgerEntryId: `LED-CORRECTION-${index + 1}`,
    })),
  });
  const projected = withWatchdogLedger(run, WATCHDOG_TRANSITIONS, () =>
    M.projectRuns({ runsDir: fixtureRunsDir([run]), now: '2026-08-30T12:00:00.000Z' }));
  const correction = M.deriveStages({ problems: [], observed: [] }, projected.runs)
    .find((item) => item.id === 'correction');
  assert.strictEqual(correction.state, 'UNVERIFIED');
  assert.match(correction.reason, /no canonical ledger-corroborated CORRECTING transition/i);
});

test('an advisory REJECT is review-complete without being rewritten as unanimous approval', () => {
  const subjectSha256 = 'a'.repeat(64);
  const stages = M.deriveStages({
    ok: true,
    problems: [],
    observed: ['codex: APPROVE', 'grok: REJECT label recorded as nonblocking'],
    subject: { subjectSha256 },
    reviewerCompleteness: {
      complete: true,
      rows: [
        { reviewer: 'codex', required: 'REQUIRED', executed: 'EXECUTED', disposition: 'APPROVE' },
        { reviewer: 'grok', required: 'REQUIRED', executed: 'EXECUTED', disposition: 'REJECT' },
      ],
    },
  }, [{ runId: 'RUN-20260830-abcde002', subjectSha256,
    updatedAt: '2026-08-29T12:01:00.000Z' }]);
  const review = stages.find((item) => item.id === 'review');
  assert.strictEqual(review.state, 'PASS');
  assert.match(review.reason, /review is complete.*no blocking findings.*one reviewer did not approve/i);
  assert.doesNotMatch(review.reason, /every required reviewer approved/i);
});

test('a snapshot derives stages, run list and current binding from one immutable run capture', () => {
  const intakeTransition = WATCHDOG_TRANSITIONS.slice(0, 1);
  const first = runRecord('RUN-20260828-01010101', {
    createdAt: '2026-08-28T01:00:00.000Z',
    updatedAt: '2026-08-28T01:01:00.000Z',
    objective: 'objective from the immutable capture',
    risk: { state: 'CLASSIFIED', lane: 'FULL', highRisk: false },
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
    worktree: { path: '/tmp/aegis-first', branch: 'aegis/first' },
    build: { exit: 0 },
    transitions: intakeTransition.map(([from, to], index) => ({
      from, to, ts: `2026-08-28T01:00:0${index}.000Z`, ledgerEntryId: `LED-SNAPSHOT-${index + 1}`,
    })),
  });
  const later = runRecord('RUN-20260828-02020202', {
    createdAt: '2026-08-28T02:00:00.000Z',
    updatedAt: '2026-08-28T02:01:00.000Z',
    objective: 'objective written after the capture',
    risk: { state: 'CLASSIFIED', lane: 'FULL', highRisk: false },
    route: { model: 'grok', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
    worktree: { path: '/tmp/aegis-later', branch: 'aegis/later' },
    build: { exit: 0 },
  });
  const dir = fixtureRunsDir([first]);
  let seamCalls = 0;

  const snap = withWatchdogLedger(first, intakeTransition, () => M.snapshot({}, {
      runsDir: dir,
      afterRunCapture(capture) {
        seamCalls++;
        assert.ok(Object.isFrozen(capture), 'the run projection was not frozen before downstream use');
        assert.ok(Object.isFrozen(capture.runs), 'the captured run list was not frozen');
        assert.ok(Object.isFrozen(capture.runs[0]), 'a captured run record was still mutable');
        // Advance the canonical-looking fixture after the snapshot's only read.
        // The old implementation reopened the directory after the gate and mixed
        // this later record into `snapshot.runs` while stages still described
        // `first`.
        fs.writeFileSync(path.join(dir, `${later.runId}.json`), JSON.stringify(later, null, 2));
      },
    }));

  assert.strictEqual(seamCalls, 1, 'the deterministic post-capture seam did not run exactly once');
  assert.deepStrictEqual(snap.runs.runs.map((run) => run.runId), [first.runId],
    'the public run list was reread after the immutable capture');
  assert.strictEqual(snap.runs.current.runId, first.runId,
    'the current binding came from a later directory read');
  assert.strictEqual(snap.engineering.state, 'UNAVAILABLE',
    'a fixture run with no validated governed worktree must not fall back to the control checkout gate');
  assert.match(snap.engineering.reason, /worktree|current run/i);

  // Control: the mutation was real and a fresh, separate projection sees it.
  // Its absence from `snap` therefore proves one-capture behavior rather than
  // a seam that failed to mutate the fixture.
  const after = M.projectRuns({ runsDir: dir, now: '2026-08-29T00:00:00.000Z' });
  assert.deepStrictEqual(after.runs.map((run) => run.runId), [first.runId, later.runId]);
  assert.strictEqual(after.current.runId, later.runId);
});

test('live engineering projection is evaluated against the selected governed run worktree', () => {
  const snap = M.snapshot({});
  if (!snap.runs || snap.runs.state !== 'OK' || !snap.runs.current || !snap.runs.current.runId) {
    assert.strictEqual(snap.engineering.state, 'UNAVAILABLE');
    return;
  }
  const runtime = require('../aegis-run.cjs');
  const raw = runtime.loadRun(snap.runs.current.runId);
  if (!snap.runs.current.packetId) {
    assert.strictEqual(snap.engineering.state, 'UNAVAILABLE');
    assert.match(snap.engineering.reason, /packet/i);
    return;
  }
  let env;
  try { env = runtime.canonicalGitEnvironment(raw); }
  catch {
    assert.strictEqual(snap.engineering.state, 'UNAVAILABLE',
      'an invalid current worktree must fail closed instead of gating the control checkout');
    return;
  }
  const subjectRead = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'engineering-os.cjs'), '--subject', '--json',
      '--packet', snap.runs.current.packetId],
    { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const directSubject = JSON.parse(subjectRead.stdout);
  const direct = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'engineering-os.cjs'), '--gate-done', '--json',
      '--packet', snap.runs.current.packetId, '--subject-sha', directSubject.subjectSha256],
    { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const gate = JSON.parse(direct.stdout);
  if (snap.engineering.state === 'UNAVAILABLE') {
    assert.match(snap.engineering.reason, /digest-bound canonical check receipt/,
      'a validated live worktree was suppressed for a reason other than missing run-bound check evidence');
    assert.ok(['CHECKS_PASSED', 'REVIEW_FAILED', 'REVIEW_BOUND', 'CHECKPOINTED', 'ROLLED_BACK'].includes(raw.state),
      'a pre-check run was incorrectly required to carry a final check receipt');
    return;
  }
  assert.strictEqual(snap.engineering.state, 'OK');
  assert.strictEqual(snap.engineering.subjectSha256, gate.subject.subjectSha256,
    'dashboard engineering subject does not match the selected run worktree gate');
  assert.deepStrictEqual(snap.engineering.subjectPaths, gate.subject.subjectPaths);
});

// gate: the subject hash the PAGE's gate verdict is about (the argument).
// expectRunSubject: what the run must publish as its own recorded subject.
// expectState: the binding's subjectState.
// expectBound: what the binding may publish as THE RUN'S code version.
const SUBJECT_LOCATION_CASES = [
  // ── the one accepted location ──
  { name: 'canonical run.subject.subjectSha256, matching the gate subject',
    record: { subject: { subjectSha256: RUN_SUBJECT } },
    gate: RUN_SUBJECT, expectRunSubject: RUN_SUBJECT, expectState: 'BOUND', expectBound: RUN_SUBJECT },
  { name: 'canonical location, canonical value, DIFFERENT from the gate subject',
    record: { subject: { subjectSha256: TABLE_OTHER_SUBJECT } },
    gate: RUN_SUBJECT, expectRunSubject: TABLE_OTHER_SUBJECT, expectState: 'MISMATCHED', expectBound: null },
  { name: 'canonical location, but the page carries no gate subject at all',
    record: { subject: { subjectSha256: RUN_SUBJECT } },
    gate: null, expectRunSubject: RUN_SUBJECT, expectState: 'UNAVAILABLE', expectBound: null },

  // ── rejected: a SECOND location ──
  { name: 'top-level subjectSha256 — a second subject-hash path must not exist',
    record: { subjectSha256: RUN_SUBJECT },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'alternate nested field subject.sha256',
    record: { subject: { sha256: RUN_SUBJECT } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'alternate nested field subject.subject_sha256',
    record: { subject: { subject_sha256: RUN_SUBJECT } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'alternate nested field subject.hash',
    record: { subject: { hash: RUN_SUBJECT } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'top-level subjectHash',
    record: { subjectHash: RUN_SUBJECT },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'top-level gateSubjectSha256 — the gate\'s hash is not the run\'s',
    record: { gateSubjectSha256: RUN_SUBJECT },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'a deeper nesting, subject.subject.subjectSha256',
    record: { subject: { subject: { subjectSha256: RUN_SUBJECT } } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'checkpoint.subjectSha256',
    record: { checkpoint: { checkpointId: 'CP-1', subjectSha256: RUN_SUBJECT } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },

  // ── rejected: the right location, a malformed value ──
  { name: 'canonical location, 63 hex characters',
    record: { subject: { subjectSha256: 'a'.repeat(63) } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'canonical location, 65 hex characters',
    record: { subject: { subjectSha256: 'a'.repeat(65) } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'canonical location, UPPERCASE hex is not the canonical form',
    record: { subject: { subjectSha256: 'A'.repeat(64) } },
    gate: 'A'.repeat(64), expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'canonical location, non-hex characters',
    record: { subject: { subjectSha256: 'z'.repeat(64) } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'canonical location, empty string',
    record: { subject: { subjectSha256: '' } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'canonical location, a number rather than a string',
    record: { subject: { subjectSha256: 12345 } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'canonical location, null',
    record: { subject: { subjectSha256: null } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'canonical location, an array of hashes',
    record: { subject: { subjectSha256: [RUN_SUBJECT] } },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'subject is a bare string rather than an object',
    record: { subject: RUN_SUBJECT },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'no subject recorded anywhere',
    record: {},
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },

  // ── rejected: conflicting decoys, where reading the wrong field is visible ──
  { name: 'DECOY: canonical nested value with a DIFFERENT top-level subjectSha256',
    record: { subject: { subjectSha256: RUN_SUBJECT }, subjectSha256: DECOY_SUBJECT },
    gate: RUN_SUBJECT, expectRunSubject: RUN_SUBJECT, expectState: 'BOUND', expectBound: RUN_SUBJECT },
  { name: 'DECOY: malformed canonical value with a well-formed top-level one',
    record: { subject: { subjectSha256: 'nope' }, subjectSha256: RUN_SUBJECT },
    gate: RUN_SUBJECT, expectRunSubject: null, expectState: 'UNLINKED', expectBound: null },
  { name: 'DECOY: canonical value matching the gate, decoys in three other fields',
    record: { subject: { subjectSha256: RUN_SUBJECT, sha256: DECOY_SUBJECT },
      subjectSha256: DECOY_SUBJECT, subjectHash: DECOY_SUBJECT },
    gate: RUN_SUBJECT, expectRunSubject: RUN_SUBJECT, expectState: 'BOUND', expectBound: RUN_SUBJECT },
  { name: 'DECOY: only the decoys match the gate; the canonical value does not',
    record: { subject: { subjectSha256: TABLE_OTHER_SUBJECT }, subjectSha256: RUN_SUBJECT },
    gate: RUN_SUBJECT, expectRunSubject: TABLE_OTHER_SUBJECT, expectState: 'MISMATCHED', expectBound: null },
];

test('G1 #5: a run\'s subject is read from run.subject.subjectSha256 and nowhere else — table over injected runs', () => {
  assert.ok(SUBJECT_LOCATION_CASES.length >= 20,
    'the table must actually cover the alternates it claims to reject');
  let accepted = 0;
  for (const c of SUBJECT_LOCATION_CASES) {
    const dir = fixtureRunsDir([runRecord(RUN_CASE_ID, c.record)]);
    const out = M.projectRuns({ subjectSha256: c.gate, runsDir: dir });

    assert.strictEqual(out.state, 'OK', `${c.name}: the injected runs directory did not project`);
    assert.strictEqual(out.runs.length, 1, `${c.name}: expected exactly the injected record`);

    // HALF ONE — what the run itself publishes as its recorded subject.
    assert.strictEqual(out.runs[0].subjectSha256, c.expectRunSubject,
      `${c.name}: the projected run subject is wrong`);

    // HALF TWO — what the current-run binding does with it.
    const cur = out.current;
    assert.strictEqual(cur.state, 'BOUND', `${c.name}: a dated run must still bind as current`);
    assert.strictEqual(cur.runId, RUN_CASE_ID);
    assert.strictEqual(cur.subjectState, c.expectState, `${c.name}: wrong subjectState`);
    assert.strictEqual(cur.runSubjectSha256, c.expectRunSubject,
      `${c.name}: the binding published a run subject the run did not record`);
    assert.strictEqual(cur.subjectSha256, c.expectBound,
      `${c.name}: the binding published a code version it had not proved`);
    assert.strictEqual(cur.gateSubjectSha256, c.gate,
      `${c.name}: the gate subject must stay visible and unmodified`);

    // A decoy must never be reachable from anything the projection publishes.
    if (c.expectRunSubject !== DECOY_SUBJECT) {
      assert.notStrictEqual(out.runs[0].subjectSha256, DECOY_SUBJECT, `${c.name}: a decoy field was read`);
      assert.notStrictEqual(cur.runSubjectSha256, DECOY_SUBJECT, `${c.name}: a decoy field reached the binding`);
      assert.notStrictEqual(cur.subjectSha256, DECOY_SUBJECT, `${c.name}: a decoy was published as the code version`);
    }
    if (c.expectState === 'BOUND') accepted++;
  }
  // Guard against the whole table degenerating into "everything is rejected",
  // which would pass a projector that reads nothing at all.
  assert.strictEqual(accepted, 3, `exactly the canonical-and-matching cases may bind; ${accepted} did`);
});

test('G1 #5: the run-subject table is not vacuous — the canonical case fails if the canonical location is not read', () => {
  // The defect the old test could not catch: a reader that took the top-level
  // field. Prove the fixtures DISCRIMINATE by evaluating both readers over the
  // table and showing they disagree — if they agreed, the table would prove
  // nothing about WHICH location is authoritative.
  const canonical = (r) => (r && r.subject && typeof r.subject === 'object'
    && typeof r.subject.subjectSha256 === 'string' && /^[0-9a-f]{64}$/.test(r.subject.subjectSha256))
    ? r.subject.subjectSha256 : null;
  const topLevel = (r) => (typeof r.subjectSha256 === 'string' && /^[0-9a-f]{64}$/.test(r.subjectSha256))
    ? r.subjectSha256 : null;
  const disagreements = SUBJECT_LOCATION_CASES
    .map((c) => runRecord(RUN_CASE_ID, c.record))
    .filter((r) => canonical(r) !== topLevel(r));
  assert.ok(disagreements.length >= 5,
    `the table must contain records where the two readers disagree; found ${disagreements.length}`);
  // And the projector agrees with the canonical reader on every one of them.
  for (const r of disagreements) {
    const out = M.projectRuns({ subjectSha256: RUN_SUBJECT, runsDir: fixtureRunsDir([r]) });
    assert.strictEqual(out.runs[0].subjectSha256, canonical(r),
      'the projector read a subject hash from somewhere other than run.subject.subjectSha256');
  }
});

test('G1 #5: an injected runs directory is cited as itself, and the default still reads builder-control/runs', () => {
  const dir = fixtureRunsDir([runRecord(RUN_CITED_ID, { subject: { subjectSha256: RUN_SUBJECT } })]);
  const out = M.projectRuns({ subjectSha256: RUN_SUBJECT, runsDir: dir });
  assert.strictEqual(out.source, path.relative(ROOT, dir), 'the projection did not cite the directory it read');
  // The production default is unchanged: it resolves to the canonical runs
  // directory, whether or not that directory exists yet.
  const live = M.projectRuns({ subjectSha256: RUN_SUBJECT });
  if (live.state === 'OK') {
    assert.strictEqual(live.source, 'builder-control/runs');
  } else {
    assert.strictEqual(live.state, 'UNAVAILABLE');
    assert.strictEqual(live.current.state, 'UNAVAILABLE');
  }
  // And the confinement rule holds for this injection too.
  assert.throws(() => M.projectRuns({ runsDir: path.join(ROOT, 'builder-control') }),
    /must point inside/, 'the runs directory injection accepted a checked-in path');
});

test('dashboard projection preserves bounded worker lifecycle and canonical route identity only', () => {
  const hostile = 'PRIVATE_WORKER_OUTPUT_SHOULD_NEVER_REACH_THE_DASHBOARD';
  const record = runRecord(RUN_LIFECYCLE_ID, {
    state: 'BUILDING',
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
    build: {
      mode: 'async', workerState: 'RUNNING', workerPid: 4321,
      startedAt: '2026-08-27T20:00:00.000Z', heartbeatAt: '2026-08-27T20:00:01.000Z',
      endedAt: null, exit: null, timedOut: false,
      stdoutTail: hostile, stderrTail: hostile, modelOutput: hostile, transcript: hostile,
      control: { dir: '/private/control', secret: hostile, secretSha256: 'digest' },
      childProcessIdentity: { pid: 4321, processGroupId: 4321, startMarker: 'fixture',
        executable: '/fixture/claude', source: 'fixture' },
      recovery: { reason: 'TERMINATION_UNVERIFIED', retrySafe: false, raw: hostile },
    },
  });
  const out = M.projectRuns({ subjectSha256: RUN_SUBJECT, runsDir: fixtureRunsDir([record]) });
  const projected = out.runs[0];
  assert.deepStrictEqual(projected.build, {
    mode: 'async', workerState: 'RUNNING', workerPid: 4321,
    startedAt: '2026-08-27T20:00:00.000Z', heartbeatAt: '2026-08-27T20:00:01.000Z',
    endedAt: null, exit: null, timedOut: false,
    recovery: { reason: 'TERMINATION_UNVERIFIED', retrySafe: false },
    failure: null,
    failover: null,
    cancelAvailable: true,
  });
  assert.deepStrictEqual(projected.route,
    { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' });
  assert.ok(!JSON.stringify(projected).includes(hostile), 'raw worker output crossed the projector boundary');
});

test('dashboard projection rejects unvalidated route identity', () => {
  for (const route of [
    { model: 'claude', execution: 'SUBSCRIPTION', source: 'caller' },
    { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole', provider: 'caller' },
    { model: '', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
    { state: 'REFUSED', code: 'bad code', reason: 'bounded refusal' },
    { state: 'REFUSED', code: 'SPECIALIST_REQUIRED', reason: ' leading whitespace' },
    { state: 'REFUSED', code: 'SPECIALIST_REQUIRED', reason: 'line\nbreak' },
    { state: 'REFUSED', code: 'SPECIALIST_REQUIRED', reason: 'bounded refusal', model: 'caller' },
  ]) {
    const record = runRecord(RUN_ROUTE_ID, { route });
    const out = M.projectRuns({ runsDir: fixtureRunsDir([record]) });
    assert.strictEqual(out.runs[0].route, null, `unvalidated route crossed the boundary: ${JSON.stringify(route)}`);
  }
});

test('dashboard projects a bounded canonical route refusal as FAILED without claiming ROUTED', () => {
  const refusal = {
    state: 'REFUSED',
    code: 'SPECIALIST_REQUIRED',
    reason: 'No eligible builder satisfies the packet policy.',
  };
  const record = runRecord(RUN_ROUTE_ID, { state: 'INTAKE_RECORDED', route: refusal });
  const out = M.projectRuns({ runsDir: fixtureRunsDir([record]) });
  assert.deepStrictEqual(out.runs[0].route, refusal,
    'the bounded refusal was erased from the public run projection');
  assert.ok(!out.runs[0].watchdog.corroboratedStages.includes('ROUTED'),
    'the fixture unexpectedly claims a successful route transition');

  const routing = M.deriveStages({ problems: [], observed: [] }, out.runs)
    .find((stage) => stage.id === 'routing');
  assert.strictEqual(routing.state, 'FAILED',
    'a canonical refusal stayed unverified merely because ROUTED never occurred');
  assert.strictEqual(routing.reason,
    'SPECIALIST_REQUIRED: No eligible builder satisfies the packet policy.');
});

test('a run with no parseable timestamp is NEVER selected as current', () => {
  const b = M.bindCurrentRun(M.orderRuns([mkRun('RUN-UNDATED', null)]), 'abc');
  assert.strictEqual(b.state, 'UNAVAILABLE', 'an undated run was promoted to current by list position');
  assert.strictEqual(b.runId, null);
  assert.ok(/parseable updatedAt/.test(b.reason));
});

test('an undated run alongside a dated one is excluded and the exclusion is stated', () => {
  const b = M.bindCurrentRun(M.orderRuns([
    mkRun('RUN-UNDATED', null), mkRun('RUN-DATED', '2026-08-26T10:00:00.000Z'),
  ]), null);
  assert.strictEqual(b.runId, 'RUN-DATED');
  assert.ok(/1 run record\(s\) carry no usable timestamp/.test(b.reason), 'silently dropping records is not disclosure');
  assert.strictEqual(b.subjectState, 'UNAVAILABLE');
  assert.ok(/not bound to a reviewed version/.test(b.reason), 'a missing subject hash must be said out loud');
});

test('a timestamp tie is broken deterministically and disclosed as ambiguous', () => {
  const ts = '2026-08-26T10:00:00.000Z';
  const b1 = M.bindCurrentRun(M.orderRuns([mkRun('RUN-A', ts), mkRun('RUN-B', ts)]), null);
  const b2 = M.bindCurrentRun(M.orderRuns([mkRun('RUN-B', ts), mkRun('RUN-A', ts)]), null);
  assert.strictEqual(b1.runId, b2.runId, 'the same runs must bind the same way regardless of input order');
  assert.strictEqual(b1.tiedCount, 2);
  assert.ok(/share that exact timestamp/.test(b1.reason), 'an ambiguous binding must say it is ambiguous');
});

test('no runs directory yields an UNAVAILABLE binding, not an empty-but-confident one', () => {
  const r = M.projectRuns({ subjectSha256: 'abc' });
  assert.ok(r.current, 'projectRuns must always produce a binding object');
  if (r.state !== 'OK') assert.strictEqual(r.current.state, 'UNAVAILABLE');
});

// ── FX: a currency figure may only come from dated, cited evidence ─────────
const FX_CANON_PATH = path.join(ROOT, 'builder-control', 'fx-canon.json');

// The live canonical evidence, captured before any FX proof runs. Nothing below
// may move, rename, delete or rewrite this file — the closing test proves it.
const FX_LIVE_BYTES = fs.readFileSync(FX_CANON_PATH, 'utf8');

// Missing and malformed FX evidence are exercised through the projector's
// injected `fxPath`, against files in a temp directory.
//
// The previous harness renamed builder-control/fx-canon.json aside and back to
// stage the absence. That made a PROOF mutate live control-plane evidence: a
// concurrent projector could observe the canonical rate as missing, and an
// abrupt kill between the two renames left it displaced under a second name
// (Codex REV-20260826023038-codex finding #5). A test that can destroy the
// artifact it is testing is not isolation. The fixture never touches the real
// path, so there is nothing to restore and no crash window to survive.
const FX_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-state-fx-'));
// Named fx-canon.json so the projector's reason still names the file it wanted.
const FX_ABSENT_PATH = path.join(FX_TMP, 'absent', 'fx-canon.json');
function fxFixture(name, contents) {
  const p = path.join(FX_TMP, name);
  fs.writeFileSync(p, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  return p;
}

test('with no canonical FX file, CAD is UNAVAILABLE and no rate is invented', () => {
  assert.ok(!fs.existsSync(FX_ABSENT_PATH), 'the absent-evidence fixture path must not exist');
  const fx = M.projectFx(NOW, FX_ABSENT_PATH);
  assert.strictEqual(fx.state, 'UNAVAILABLE', 'a missing evidence file must render UNAVAILABLE');
  assert.ok(/fx-canon\.json/.test(fx.reason), 'the reason must name the evidence file it wanted');
  assert.ok(/no rate is fetched|none is assumed/i.test(fx.reason));
  assert.strictEqual(M.toCad(10, fx), null, 'no rate must mean no converted figure at all');
  assert.ok(!('rate' in fx), 'an UNAVAILABLE projection must not carry a rate field at all');
});

// Malformed evidence is not a lesser form of evidence. Each fixture below is
// missing or corrupts exactly ONE required element, so a projector that started
// defaulting any single field would fail here rather than convert from a hole.
test('RED: malformed FX evidence is UNAVAILABLE and names what is missing — it never converts', () => {
  const VALID = { base: 'USD', quote: 'CAD', rate: 1.3839, asOf: '2026-08-23T00:00:00Z', source: 'Bank of Canada' };
  const cases = [
    ['unparseable JSON', 'not json at all{', /could not be read as JSON/],
    ['an empty file', '', /could not be read as JSON/],
    ['a JSON array, not an object', '[]', /missing|could not be read/],
    ['no rate', { ...VALID, rate: undefined }, /positive numeric "rate"/],
    ['a zero rate', { ...VALID, rate: 0 }, /positive numeric "rate"/],
    ['a negative rate', { ...VALID, rate: -1.4 }, /positive numeric "rate"/],
    ['a string rate', { ...VALID, rate: '1.3839' }, /positive numeric "rate"/],
    // 1e999 parses as a real JSON number and lands on Infinity — a numeric
    // rate that would convert to Infinity CAD if Number.isFinite were dropped.
    ['a non-finite rate', '{"base":"USD","quote":"CAD","rate":1e999,"asOf":"2026-08-23T00:00:00Z","source":"f"}',
      /positive numeric "rate"/],
    ['the wrong base currency', { ...VALID, base: 'EUR' }, /"base":"USD"/],
    ['the wrong quote currency', { ...VALID, quote: 'GBP' }, /"quote":"CAD"/],
    ['no asOf date', { ...VALID, asOf: undefined }, /parseable ISO "asOf" date/],
    ['an unparseable asOf date', { ...VALID, asOf: 'sometime last week' }, /parseable ISO "asOf" date/],
    ['no source', { ...VALID, source: undefined }, /named "source"/],
    ['a blank source', { ...VALID, source: '   ' }, /named "source"/],
  ];
  cases.forEach(([label, contents, expectReason], i) => {
    const p = fxFixture(`malformed-${i}.json`, contents);
    const fx = M.projectFx(NOW, p);
    assert.strictEqual(fx.state, 'UNAVAILABLE', `FX evidence with ${label} was accepted as usable`);
    assert.ok(!('rate' in fx), `an UNAVAILABLE projection carried a rate field (${label})`);
    assert.strictEqual(M.toCad(100, fx), null, `a CAD figure was produced from FX evidence with ${label}`);
    assert.ok(expectReason.test(fx.reason), `the reason for ${label} did not say what was wrong: ${fx.reason}`);
  });
});

// A well-formed fixture proves the injected path is a real read, not a branch
// that only ever returns UNAVAILABLE — otherwise every assertion above would
// pass against a projector that simply refused everything it was handed.
test('the injected FX path is a real read: a well-formed fixture projects OK and converts', () => {
  const p = fxFixture('valid.json', {
    base: 'USD', quote: 'CAD', rate: 1.25, asOf: '2026-08-23T00:00:00Z', source: 'fixture',
  });
  const fx = M.projectFx(NOW, p);
  assert.strictEqual(fx.state, 'OK', `a well-formed fixture did not project OK: ${fx.reason || ''}`);
  assert.strictEqual(fx.rate, 1.25);
  assert.strictEqual(M.toCad(100, fx), 125);
});

test('RED: future-dated FX evidence is UNAVAILABLE and never converts', () => {
  const p = fxFixture('future.json', {
    base: 'USD', quote: 'CAD', rate: 9.99, asOf: '2026-08-24T00:00:00Z', source: 'future fixture',
  });
  const fx = M.projectFx(NOW, p);
  assert.strictEqual(fx.state, 'UNAVAILABLE');
  assert.match(fx.reason, /future-dated/);
  assert.ok(!('rate' in fx), 'future evidence leaked a usable rate');
  assert.strictEqual(M.toCad(100, fx), null, 'future evidence produced a CAD conversion');
});

// The whole point of the injection. If any FX proof ever reaches for the live
// artifact again, this fails.
test('RED: no FX proof moved, renamed, deleted or rewrote the live canonical evidence', () => {
  assert.ok(fs.existsSync(FX_CANON_PATH), 'the live canonical FX evidence is missing after the FX proofs ran');
  assert.strictEqual(fs.readFileSync(FX_CANON_PATH, 'utf8'), FX_LIVE_BYTES,
    'the live canonical FX evidence changed while the tests ran');
  // A displaced canon is the exact failure the rename harness could leave behind.
  for (const stray of ['fx-canon.json.test-isolated', 'fx-canon.json.bak', 'fx-canon.json.tmp']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'builder-control', stray)),
      `a displaced copy of the canonical FX evidence was left behind: ${stray}`);
  }
  // And the harness itself must not come back.
  const suite = fs.readFileSync(__filename, 'utf8');
  assert.ok(!/renameSync\([^)]*FX_CANON_PATH/.test(suite),
    'an FX proof renames the live canonical evidence again — use the injected fxPath instead');
  assert.ok(!/(unlinkSync|writeFileSync|rmSync)\(\s*FX_CANON_PATH/.test(suite),
    'an FX proof writes to or deletes the live canonical evidence — use the injected fxPath instead');
});

// The live file, not a fixture. This is the proof that the evidence actually on
// disk is usable — a fixture-only suite would pass with a malformed canon.
test('the LIVE canonical FX file parses as OK and converts deterministically, with no fetch', () => {
  // The clock is pinned to the evidence date so this proof cannot rot into a
  // failure simply because time passed; staleness is proved separately below.
  const fx = M.projectFx(Date.parse('2026-08-25T12:00:00-04:00'));
  assert.strictEqual(fx.state, 'OK', `the live canonical FX file did not project OK: ${fx.reason || ''}`);
  assert.strictEqual(fx.base, 'USD');
  assert.strictEqual(fx.quote, 'CAD');
  assert.strictEqual(fx.rate, 1.3839, 'the live rate is not the recorded Bank of Canada Daily Digest figure');
  assert.strictEqual(fx.asOf, '2026-08-25T00:00:00-04:00');
  assert.ok(/bankofcanada\.ca/.test(fx.fxSource), 'the live rate does not cite the Bank of Canada as its source');
  assert.strictEqual(fx.ageDays, 0, 'the evidence age must be computed from asOf, not assumed');

  // Deterministic and rounded UP at the cent, the same direction as the USD
  // display figure: understating spend against a ceiling reads as headroom.
  assert.strictEqual(M.toCad(100, fx), 138.39);
  assert.strictEqual(M.toCad(1, fx), 1.39, '1.3839 must round UP to 1.39, never down to 1.38');
  assert.strictEqual(M.toCad(0, fx), 0);
  assert.strictEqual(M.toCad(100, fx), M.toCad(100, fx), 'conversion must be repeatable');
  assert.ok(/1 USD = 1.3839 CAD/.test(fx.plain), 'the plain-language line must state the rate it used');
});

test('the live canonical FX file carries the Bank of Canada indicative-rate caveat', () => {
  const raw = JSON.parse(fs.readFileSync(FX_CANON_PATH, 'utf8'));
  assert.ok(/indicative/i.test(raw.note || ''),
    'the canonical FX evidence does not record that the Bank publishes these rates as indicative');
});

test('the live canonical FX evidence goes STALE with age — it never silently stays fresh', () => {
  const elevenDaysOn = Date.parse('2026-09-05T12:00:00-04:00');
  const fx = M.projectFx(elevenDaysOn);
  assert.strictEqual(fx.state, 'STALE', 'aged evidence must be disclosed as STALE, not rendered as current');
  assert.ok(fx.ageDays > 7, 'the staleness threshold was not applied');
  assert.ok(/days old/.test(fx.plain), 'a STALE rate must say out loud how old it is');
  assert.strictEqual(M.toCad(100, fx), 138.39, 'dated-but-cited evidence still converts, labelled STALE');
});

test('the projector contains no hardcoded exchange rate and no network FX call', () => {
  const src = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-state.cjs'), 'utf8');
  assert.ok(!/https?:\/\/[^\s'"]*(fx|exchange|currency|rate)/i.test(src), 'a live FX endpoint appears in the projector');
  const body = src.slice(src.indexOf('function projectFx'), src.indexOf('function toCad'));
  assert.ok(!/rate\s*=\s*\d+\.\d+/.test(body), 'a literal rate is assigned inside projectFx');
});

test('toCad refuses to convert on UNAVAILABLE evidence and rounds UP on valid evidence', () => {
  assert.strictEqual(M.toCad(1, { state: 'UNAVAILABLE' }), null);
  assert.strictEqual(M.toCad(1, { state: 'OK', rate: 1.3701 }), 1.38, 'spend must never round down against a cap');
  assert.strictEqual(M.toCad(2, { state: 'STALE', rate: 1.5 }), 3, 'dated-but-cited evidence still converts, labelled STALE');
  assert.strictEqual(M.toCad(null, { state: 'OK', rate: 1.37 }), null, 'an unrecorded USD figure must not become a CAD number');
});

test('the cost projection always carries a cad block, and it is UNAVAILABLE rather than zero', () => {
  const c = M.projectCost();
  if (c.state !== 'OK') return;
  assert.ok(c.cad, 'no cad block on the cost projection');
  assert.ok(['OK', 'STALE', 'UNAVAILABLE'].includes(c.cad.state), `unexpected cad state ${c.cad.state}`);
  if (c.cad.state === 'UNAVAILABLE') {
    assert.ok(!('recordedCad' in c.cad), 'an unavailable rate must not still produce a CAD figure');
    assert.ok(c.cad.reason, 'CAD UNAVAILABLE must say why');
  }
  // The USD audit values survive in every case.
  assert.strictEqual(typeof c.recordedUsd, 'number');
  assert.ok(c.totalUsd !== undefined, 'the USD total must be preserved as the audit value');
});

// ── G1 finding #3: the suite may not write to canonical evidence ──────────
// Two guards, because either one alone can be defeated. The static one catches
// the pattern before it can run; the byte one catches anything that reaches
// disk by a route the pattern misses. Both must stay.
const MUTATORS = 'writeFileSync|appendFileSync|unlinkSync|renameSync|rmSync|rmdirSync|truncateSync|copyFileSync|createWriteStream';

test('G1 #3: static inspection finds NO mutation of the canonical registry or ledger anywhere in this suite', () => {
  const suite = fs.readFileSync(__filename, 'utf8');
  // POSITIVE CONTROL FIRST. A "no match found" guard is worthless unless the
  // pattern is shown to match the thing it is looking for — a typo in the
  // regex would otherwise read as a clean bill of health forever.
  // Assembled from fragments on purpose: written out whole, these samples
  // would be found by the very scan below and fail this suite for quoting the
  // thing it forbids.
  const W = 'write' + 'FileSync';
  const BAD_SAMPLES = [
    `fs.${W}(` + 'REGISTRY, original);',
    'fs.unlink' + 'Sync( REGISTRY )',
    'fs.rename' + 'Sync(LEDGER, tmp)',
    'fs.rm' + 'Sync(LEDGER);',
    `fs.${W}(` + 'path.join(ROOT, "builder-control", "connector-registry.json"), x)',
  ];
  for (const sample of BAD_SAMPLES) {
    const hit = ['REGISTRY', 'LEDGER'].some((t) =>
      new RegExp(`(?:${MUTATORS})\\(\\s*${t}\\b`).test(sample))
      || new RegExp(`(?:${MUTATORS})\\(\\s*path\\.join\\([^)]*(?:connector-registry|ledger)\\.json`).test(sample);
    assert.ok(hit, `the static guard does not detect a canonical mutation it must catch: ${sample}`);
  }
  for (const target of ['REGISTRY', 'LEDGER']) {
    // Any mutating fs call whose first argument is the canonical constant,
    // with any spacing. (Spelled through a variable so this comment cannot
    // itself trip the check.)
    const direct = new RegExp(`(?:${MUTATORS})\\(\\s*${target}\\b`);
    assert.ok(!direct.test(suite),
      `this suite still mutates the canonical ${target.toLowerCase()} — stage a temp fixture and inject it instead`);
    // …and the same thing reached through a local alias of the literal path.
    const viaLiteral = new RegExp(`(?:${MUTATORS})\\(\\s*path\\.join\\([^)]*(?:connector-registry|ledger)\\.json`);
    assert.ok(!viaLiteral.test(suite),
      'this suite mutates a canonical artifact through a rebuilt literal path');
  }
  // The injection this replaced it with must actually be in use, or the guard
  // above would pass a suite that simply stopped testing the projector.
  assert.ok(/registryPath:/.test(suite), 'no registry is injected anywhere — the coverage was dropped, not isolated');
  assert.ok(/ledgerFile[,:]/.test(suite), 'no ledger is injected anywhere');
  assert.ok(/runsDir:/.test(suite), 'no runs directory is injected anywhere');
});

test('G1 #3: the canonical registry is byte-identical to what this suite started with', () => {
  // The registry is not an append-only store and nothing legitimately writes
  // it while tests run, so byte equality remains exactly the right proof here.
  assert.strictEqual(fs.readFileSync(REGISTRY, 'utf8'), CANONICAL_REGISTRY_BYTES,
    'this suite changed builder-control/connector-registry.json');
});

// ── REVIEW FINDING #6: the ledger's no-write proof must be ATTRIBUTABLE ─────
// Byte-comparing builder-control/ledger.json against the bytes read at load was
// the wrong instrument for an append-only store that other suites in the same
// run legitimately write to. It reported THEIR correct append as THIS suite's
// violation — a guard that fires on a defect which is not there teaches people
// to ignore it, and a guard people ignore protects nothing.
//
// The two things this suite is actually answerable for are both checkable
// without a race:
//   (a) APPEND-ONLY — every entry that existed at load is still there, in the
//       same position, unchanged. A concurrent append satisfies this; a
//       rewrite, reorder or truncation does not, and neither is legitimate.
//   (b) ATTRIBUTION — no entry bearing THIS suite's fixture identity is in the
//       canonical ledger, whether it arrived before or during this run.
// Neither weakens the original claim. The original could only say "the bytes
// are the same"; these say who changed what, which is the fact that was wanted.

// The fixture identities this suite would leave behind. Read out of the source
// rather than hand-listed, so a fixture entry added tomorrow is covered by this
// guard the moment it is written — a hand-list would silently stop covering it.
function suiteFixtureEntryIds() {
  const suite = fs.readFileSync(__filename, 'utf8');
  const ids = new Set();
  for (const m of suite.matchAll(/entryId:\s*'([^']+)'/g)) ids.add(m[1]);
  return ids;
}

test('G1 #3 / finding #6: this suite left NO attributable entry in the canonical ledger, and rewrote none of the entries it found there', () => {
  const ids = suiteFixtureEntryIds();
  // The matcher must have something to look for, or "found nothing" is a
  // statement about the matcher rather than about the ledger.
  assert.ok(ids.size > 0, 'no fixture entryId was recovered from this suite — the attribution guard is looking for nothing');
  assert.ok(ids.has(LEDGER_EVENT.entryId),
    `the attribution guard did not recover this suite's primary usage fixture (${LEDGER_EVENT.entryId})`);

  const before = CANONICAL_LEDGER_AT_START;
  const after = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  assert.ok(Array.isArray(after), 'the canonical ledger is no longer a JSON array');

  // (a) APPEND-ONLY.
  assert.ok(after.length >= before.length,
    `the canonical ledger shrank from ${before.length} to ${after.length} entries while this suite ran`);
  for (let i = 0; i < before.length; i++) {
    assert.strictEqual(JSON.stringify(after[i]), JSON.stringify(before[i]),
      `canonical ledger entry #${i} (${(before[i] || {}).entryId}) was rewritten or displaced while this suite ran`);
  }

  // (b) ATTRIBUTION. Stated over the WHOLE ledger, not just the tail, so a
  // fixture that leaked in during some earlier run is caught too.
  const attributable = after.filter((e) => e && ids.has(e.entryId));
  assert.deepStrictEqual(attributable.map((e) => e.entryId), [],
    'a fixture entry from this suite is present in the canonical production ledger');

  // POSITIVE CONTROL, in the same style as the static guard above: an empty
  // result only means something once the matcher is shown to catch the entry
  // it exists to catch. Planted in memory — the ledger on disk is not touched.
  const planted = after.concat([{ entryId: LEDGER_EVENT.entryId, gate: 'connector-usage' }]);
  assert.strictEqual(planted.filter((e) => e && ids.has(e.entryId)).length, 1,
    'the attribution matcher does not detect a fixture entry it must catch');

  // …and the append-only check must actually be able to see a rewrite.
  const tampered = before.slice();
  if (tampered.length > 0) {
    tampered[0] = Object.assign({}, tampered[0], { status: 'TAMPERED' });
    assert.notStrictEqual(JSON.stringify(tampered[0]), JSON.stringify(before[0]),
      'the append-only comparison cannot distinguish a rewritten entry from the original');
  }
});

test('current-run selection is identical for mission binding and stages when timestamps tie', () => {
  const timestamp = '2026-08-28T12:00:00.000Z';
  const runs = [
    { runId: 'RUN-20260828-00000001', updatedAt: timestamp, createdAt: timestamp, objective: 'older tie', risk: { lane: 'FULL' },
      watchdog: { corroboratedStages: ['INTAKE_RECORDED'] } },
    { runId: 'RUN-20260828-ffffffff', updatedAt: timestamp, createdAt: timestamp, objective: 'selected tie', risk: { lane: 'FULL' },
      watchdog: { corroboratedStages: ['INTAKE_RECORDED'] } },
  ];
  assert.strictEqual(M.selectCurrentRun(runs).runId, 'RUN-20260828-ffffffff');
  const binding = M.bindCurrentRun(M.orderRuns(runs.map((r) => ({ ...r, updatedAtMs: Date.parse(timestamp), createdAtMs: Date.parse(timestamp) }))), null);
  assert.strictEqual(binding.runId, 'RUN-20260828-ffffffff');
  const stages = M.deriveStages({ problems: [], observed: [] }, runs, {
    runs: { state: 'OK', current: { state: 'BOUND' } }, events: { state: 'OK' },
    cost: { state: 'OK' }, reviewers: { state: 'OK' },
  });
  assert.match(stages.find((stage) => stage.id === 'objective').reason, /selected tie/);
});

test('Evidence + cost stays UNVERIFIED when an evidence plane is unavailable', () => {
  const stages = M.deriveStages({ problems: [], observed: [] }, [], {
    runs: { state: 'OK', current: { state: 'BOUND' } }, events: { state: 'OK' },
    cost: { state: 'UNAVAILABLE' }, reviewers: { state: 'OK' },
  });
  const surface = stages.find((stage) => stage.id === 'surface');
  assert.strictEqual(surface.state, 'UNVERIFIED');
  assert.match(surface.reason, /cost evidence unavailable/);
});

test('Evidence surface never passes when current-run binding is unavailable', () => {
  const stages = M.deriveStages({ problems: [], observed: [] }, [], {
    runs: { state: 'OK', current: { state: 'UNAVAILABLE', evidenceState: 'OK' } },
    events: { state: 'OK' }, cost: { state: 'OK' }, reviewers: { state: 'OK' },
  });
  const surface = stages.find((stage) => stage.id === 'surface');
  assert.strictEqual(surface.state, 'UNVERIFIED');
  assert.match(surface.reason, /current run binding unavailable/);
});

test('cost telemetry accepts only one successful final terminal stdout event', () => {
  const good = [
    JSON.stringify({ type: 'usage', total_cost_usd: 99 }),
    JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 1.25, num_turns: 2 }),
  ].join('\n');
  assert.strictEqual(M.successfulTerminalCostEnvelope(good).total_cost_usd, 1.25);
  assert.strictEqual(M.successfulTerminalCostEnvelope(JSON.stringify({ type: 'end', stopReason: 'max_turns', total_cost_usd: 1.25 })), null);
  assert.strictEqual(M.successfulTerminalCostEnvelope([
    JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 1 }),
    JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 2 }),
  ].join('\n')), null);
  assert.strictEqual(M.successfulTerminalCostEnvelope(JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: -1 })), null);
});

test('cost telemetry supports canonical JSONL and pretty-printed top-level events without parsing quoted model JSON', () => {
  const pretty = JSON.stringify({
    type: 'end', stopReason: 'end_turn', total_cost_usd: 2.5, num_turns: 3,
  }, null, 2);
  assert.strictEqual(M.successfulTerminalCostEnvelope(pretty).total_cost_usd, 2.5,
    'preserved pretty-printed reviewer evidence lost backward-compatible telemetry');

  const quoted = 'model said {"type":"end","stopReason":"end_turn","total_cost_usd":999}';
  assert.strictEqual(M.successfulTerminalCostEnvelope(quoted), null,
    'JSON embedded in prose was accepted as reviewer telemetry');

  const quotedOnOwnLine = [
    'Reviewer quoted a previous transcript:',
    pretty,
  ].join('\n');
  assert.strictEqual(M.successfulTerminalCostEnvelope(quotedOnOwnLine), null,
    'a pretty JSON object quoted on its own line inside reviewer prose was accepted as this run telemetry');

  const afterTerminal = [
    JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 1 }),
    JSON.stringify({ type: 'usage', total_cost_usd: 1 }),
  ].join('\n');
  assert.strictEqual(M.successfulTerminalCostEnvelope(afterTerminal), null,
    'a terminal event that was not the final stdout event was accepted');

  assert.strictEqual(M.successfulTerminalCostEnvelope(`${pretty}\nreview complete`), null,
    'reviewer prose after a terminal object was accepted as part of the run own envelope');

  const stderrTerminal = [
    JSON.stringify({ type: 'usage', total_cost_usd: 1 }),
    '--- stderr ---',
    JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 1 }),
  ].join('\n');
  assert.strictEqual(M.successfulTerminalCostEnvelope(stderrTerminal), null,
    'a terminal event from stderr was accepted as stdout billing telemetry');
});

const failedCount = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failedCount} failed.`);
