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
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'builder-control', 'aegis-state.cjs');
const REGISTRY = path.join(ROOT, 'builder-control', 'connector-registry.json');
const M = require('../aegis-state.cjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const NOW = Date.parse('2026-08-23T12:00:00Z');
console.log('AEGIS state projector — red proofs');

// ── the authority boundary is mechanical, not advisory ──────────────────────
test('a connector claiming CONTROL plane is REFUSED, not warned about', () => {
  const original = fs.readFileSync(REGISTRY, 'utf8');
  const reg = JSON.parse(original);
  reg.connectors.push({
    connectorId: 'rogue', label: 'Rogue', provider: 'x',
    plane: 'CONTROL', health: 'HEALTHY',
    healthEvidence: { observedAt: new Date().toISOString(), method: 'm', result: 'r' },
  });
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
  try {
    const r = spawnSync('node', [CLI], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(r.status, 3, `expected refusal exit 3, got ${r.status}`);
    assert.ok(/AEGIS-CONNECTOR-PLANE-VIOLATION/.test(r.stderr), 'must name the rule');
    assert.ok(/never hold engineering authority/.test(r.stderr), 'must state why');
  } finally {
    fs.writeFileSync(REGISTRY, original);
  }
  // and the restore must have worked, or every later test is meaningless
  assert.strictEqual(fs.readFileSync(REGISTRY, 'utf8'), original);
});

// ── no optimistic defaults ──────────────────────────────────────────────────
test('a connector with no health evidence is UNKNOWN, never HEALTHY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-reg-'));
  const p = path.join(dir, 'connector-registry.json');
  fs.writeFileSync(p, JSON.stringify({
    connectors: [{ connectorId: 'ghost', plane: 'INTEGRATION', health: 'HEALTHY' }],
  }));
  // exercise the pure function against a registry with no evidence
  const original = fs.readFileSync(REGISTRY, 'utf8');
  fs.writeFileSync(REGISTRY, fs.readFileSync(p, 'utf8'));
  try {
    const out = M.projectConnectors(NOW);
    const g = out.connectors[0];
    assert.strictEqual(g.health, 'UNKNOWN', 'a claimed HEALTHY with no evidence must degrade to UNKNOWN');
    assert.strictEqual(g.staleness.state, 'UNVERIFIED');
  } finally { fs.writeFileSync(REGISTRY, original); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('stale evidence is reported with its age and does NOT overwrite last-known health', () => {
  const original = fs.readFileSync(REGISTRY, 'utf8');
  fs.writeFileSync(REGISTRY, JSON.stringify({
    stalenessThresholdMinutes: 60,
    healthVocabulary: ['HEALTHY', 'UNKNOWN'],
    connectors: [{
      connectorId: 'aged', plane: 'INTEGRATION', health: 'HEALTHY',
      healthEvidence: { observedAt: '2026-08-23T06:00:00Z', method: 'm', result: 'r' },
    }],
  }));
  try {
    const c = M.projectConnectors(NOW).connectors[0];
    assert.strictEqual(c.staleness.state, 'STALE');
    assert.strictEqual(c.staleness.ageMinutes, 360, 'age must be computed, not asserted');
    // Overwriting health would destroy the only reading we have; hiding the age
    // would let a six-hour-old reading pose as live. Both are required.
    assert.strictEqual(c.health, 'HEALTHY', 'last-known health is preserved and qualified, not erased');
  } finally { fs.writeFileSync(REGISTRY, original); }
});

test('fresh evidence inside the threshold is FRESH', () => {
  const original = fs.readFileSync(REGISTRY, 'utf8');
  fs.writeFileSync(REGISTRY, JSON.stringify({
    stalenessThresholdMinutes: 60,
    healthVocabulary: ['HEALTHY'],
    connectors: [{ connectorId: 'new', plane: 'INTEGRATION', health: 'HEALTHY',
      healthEvidence: { observedAt: '2026-08-23T11:30:00Z', method: 'm', result: 'r' } }],
  }));
  try {
    const c = M.projectConnectors(NOW).connectors[0];
    assert.strictEqual(c.staleness.state, 'FRESH');
    assert.strictEqual(c.staleness.ageMinutes, 30);
  } finally { fs.writeFileSync(REGISTRY, original); }
});

test('a missing registry renders UNAVAILABLE rather than an empty healthy list', () => {
  const original = fs.readFileSync(REGISTRY, 'utf8');
  fs.unlinkSync(REGISTRY);
  try {
    const out = M.projectConnectors(NOW);
    assert.strictEqual(out.state, 'UNAVAILABLE');
    assert.ok(/not found/.test(out.reason));
    assert.deepStrictEqual(out.connectors, []);
  } finally { fs.writeFileSync(REGISTRY, original); }
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
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x', build: { exit: 0 } }]);
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
  const stages = M.deriveStages({
    ok: true, state: 'READY_FOR_DETERMINISTIC_VALIDATION',
    classification: { lane: 'FULL', highRisk: false, requiredReviewers: ['codex'] },
    subject: { subjectPaths: ['src/a.ts'] },
    problems: [], observed: ['codex: APPROVE'],
  });
  assert.strictEqual(stages.find((s) => s.id === 'review').state, 'PASS');
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

test('RED: a checkpoint with no rollback point is FAILED, not PASS', () => {
  const stages = M.deriveStages({ ok: false, problems: [], observed: [] },
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x', checkpoint: { checkpointId: 'CP-1' } }]);
  assert.strictEqual(stages.find((s) => s.id === 'checkpoint').state, 'FAILED');
});

test('RED: watchdog drift renders FAILED and names the rule', () => {
  const stages = M.deriveStages({ ok: false, problems: [], observed: [] },
    [{ updatedAt: '2026-08-25T10:00:00Z', objective: 'x',
       watchdog: { ok: false, problems: [{ rule: 'WATCHDOG-STAGE-MISSING' }] } }]);
  const w = stages.find((s) => s.id === 'watchdog');
  assert.strictEqual(w.state, 'FAILED');
  assert.ok(/WATCHDOG-STAGE-MISSING/.test(w.reason));
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

const failedCount = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failedCount} failed.`);
