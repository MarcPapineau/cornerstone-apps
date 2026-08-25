#!/usr/bin/env node
/**
 * model-routing.test.cjs — red proofs for policy-based model routing.
 *
 * Every case here asserts a REFUSAL. A router that says yes to everything
 * passes a happy-path suite and provides no governance at all.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../tool-router.cjs');

let passed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
console.log('AEGIS model routing — red proofs');

test('the policy declares the roles the amendment requires', () => {
  const p = R.loadPolicy();
  for (const r of ['orchestrator', 'implementation-review', 'adversarial-review', 'repository-guardian']) {
    assert.ok(p.roles[r], `missing role ${r}`);
    assert.strictEqual(p.roles[r].mayApproveOwnWork, false, `${r} must not approve its own work`);
  }
  assert.strictEqual(p.roles.orchestrator.default, 'claude');
  assert.strictEqual(p.roles['implementation-review'].default, 'codex');
  assert.strictEqual(p.roles['adversarial-review'].default, 'grok');
});

test('data sensitivity vetoes BEFORE capability and cost', () => {
  const p = R.loadPolicy();
  assert.deepStrictEqual(p.vetoOrder, ['dataSensitivity', 'capability', 'availability', 'cost']);
  const r = R.routeRole('implementation-review', { dataClass: 'SENSITIVE' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'DATA_CLASS_REFUSED');
});

test('RED: a bare --allow-metered does NOT authorize spending', () => {
  const r = R.routeRole('adversarial-review', { allowMetered: true });
  assert.strictEqual(r.ok, false, 'a boolean must not unlock money');
  assert.strictEqual(r.code, 'METERED_UNAUTHORIZED');
  assert.ok(/named human/i.test(r.reason));
});

test('RED: metered without a cap is refused even with a named human', () => {
  const r = R.routeRole('adversarial-review', { allowMetered: true, approvedBy: 'Marc Papineau' });
  assert.strictEqual(r.ok, false);
  assert.ok(/cap/i.test(r.reason), 'must demand a cap');
});

test('RED: a cap above the policy hard ceiling is refused', () => {
  const ceiling = R.loadPolicy().budgets.hardCeilingUsd;
  const r = R.routeRole('adversarial-review', { allowMetered: true, approvedBy: 'Marc', capUsd: ceiling + 1 });
  assert.strictEqual(r.ok, false);
  assert.ok(/ceiling/i.test(r.reason), 'a ceiling that can be exceeded inline is not a ceiling');
});

test('a named human plus a cap inside the ceiling routes, carrying its bounds', () => {
  const r = R.routeRole('adversarial-review', { allowMetered: true, approvedBy: 'Marc Papineau', capUsd: 2 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.model, 'grok');
  // The bounds the Product Owner specified must survive into the route.
  assert.strictEqual(r.bounds.maxTurns, 16);
  assert.strictEqual(r.bounds.maxRetries, 0);
  assert.strictEqual(r.bounds.subagents, false);
  assert.strictEqual(r.bounds.webAccess, false);
});

test('RED: a model may not review its own work', () => {
  const r = R.routeRole('implementation-review', { model: 'claude' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'SELF_REVIEW_REFUSED');
});

test('RED: recursive delegation is refused by default for every role', () => {
  for (const role of ['orchestrator', 'implementation-review', 'adversarial-review']) {
    const r = R.routeRole(role, { wantsDelegation: true, allowMetered: true, approvedBy: 'M', capUsd: 1 });
    assert.strictEqual(r.ok, false, `${role} allowed delegation`);
    assert.strictEqual(r.code, 'RECURSIVE_DELEGATION_REFUSED');
  }
});

test('RED: fallback exhaustion REFUSES rather than falling back to the author', () => {
  const p = R.loadPolicy();
  assert.strictEqual(p.fallbacks.fallbackExhaustedBehaviour, 'REFUSE');
  assert.ok(!p.fallbacks['implementation-review'].includes('claude'),
    'the orchestrator must never be a review fallback — self-review is most tempting exactly when the reviewer is down');
});

test('RED: a missing policy file refuses rather than routing permissively', () => {
  const live = path.join(__dirname, '..', 'MODEL-ROUTING-POLICY.json');
  const hidden = live + '.test-hidden';
  const restore = () => { try { if (fs.existsSync(hidden)) fs.renameSync(hidden, live); } catch {} };
  process.on('exit', restore);
  fs.renameSync(live, hidden);
  let threw = false;
  try { R.routeRole('orchestrator', {}); } catch (e) { threw = /absent policy is not a permissive policy/.test(e.message); }
  finally { restore(); }
  assert.ok(threw, 'an absent policy must refuse');
  assert.ok(fs.existsSync(live), 'policy must be restored');
});

test('repository-guardian is advisory and cannot approve', () => {
  const p = R.loadPolicy();
  assert.strictEqual(p.roles['repository-guardian'].advisoryOnly, true);
  assert.strictEqual(p.roles['repository-guardian'].mayApproveOwnWork, false);
});

// ── 2026-08-25: bounded ≠ crippled ─────────────────────────────────────────
// maxTurns was 1. An agentic reviewer spends turn one opening files, so the run
// ended "max turns reached" with no verdict and USD 0.00717944 charged. Paying
// for a non-answer is the worst available outcome. These proofs pin the
// corrected contract: enough turns to finish, every other bound intact.
test('RED: the adversarial reviewer has enough turns to actually finish', () => {
  const b = R.loadPolicy().roles['adversarial-review'].bounds;
  assert.ok(b.maxTurns >= 8,
    `maxTurns is ${b.maxTurns}; below ~8 an agentic reviewer cannot open files AND return a verdict, so the call is paid for and wasted`);
  assert.ok(b.maxTurns <= 40, `maxTurns is ${b.maxTurns} — a runaway guard must still guard`);
});

test('RED: raising turns did NOT loosen any other bound', () => {
  const b = R.loadPolicy().roles['adversarial-review'].bounds;
  assert.strictEqual(b.maxRetries, 0, 'retries must stay at zero');
  assert.strictEqual(b.subagents, false, 'sub-agents must stay disabled');
  assert.strictEqual(b.webAccess, false, 'web access must stay disabled');
  assert.strictEqual(b.toolWrites, false, 'the reviewer stays read-only');
});

test('RED: the USD 5 hard ceiling and named-human requirement are untouched', () => {
  const p = R.loadPolicy();
  assert.strictEqual(p.budgets.hardCeilingUsd, 5);
  assert.deepStrictEqual(p.budgets.meteredRequires.sort(), ['capUsd', 'namedHuman']);
  // Still fail-closed: authorization at the ceiling routes, a hair above refuses.
  assert.strictEqual(R.routeRole('adversarial-review', { allowMetered: true, approvedBy: 'Marc Papineau', capUsd: 5 }).ok, true);
  assert.strictEqual(R.routeRole('adversarial-review', { allowMetered: true, approvedBy: 'Marc Papineau', capUsd: 5.01 }).ok, false);
  assert.strictEqual(R.routeRole('adversarial-review', { allowMetered: true, capUsd: 2 }).ok, false, 'still needs a named human');
  assert.strictEqual(R.routeRole('adversarial-review', { allowMetered: true, approvedBy: 'Marc' }).ok, false, 'still needs a cap');
});

test('RED: turns are documented as a runaway guard, not a cost control', () => {
  const b = R.loadPolicy().roles['adversarial-review'].bounds;
  assert.ok(/runaway guard/i.test(b.maxTurnsPurpose || ''),
    'the policy must say what maxTurns is FOR, or someone will lower it again to save money');
  assert.ok(/NOT a cost control/i.test(b.maxTurnsPurpose || ''));
});

// ── PROVEN DEFECT D4 (2026-08-25): unknown data class failed OPEN ──────────
// "CONFIDENTIAL", "typo-class" and "" all routed successfully. An unrecognised
// rank compared as undefined, the veto was skipped, and the FIRST control in
// the policy silently did nothing. A misspelling must never widen access.
test('RED: an unrecognised data class REFUSES rather than defaulting through', () => {
  for (const dc of ['CONFIDENTIAL', 'typo-class', 'internal', 'Secret']) {
    const r = R.routeRole('implementation-review', { dataClass: dc });
    assert.strictEqual(r.ok, false, `dataClass "${dc}" was allowed`);
    assert.strictEqual(r.code, 'DATA_CLASS_UNKNOWN', `dataClass "${dc}" gave ${r.code}`);
  }
});

test('RED: an explicitly EMPTY data class is not silently defaulted', () => {
  const r = R.routeRole('implementation-review', { dataClass: '' });
  assert.strictEqual(r.ok, false, 'an empty string must not fall through to INTERNAL');
  assert.strictEqual(r.code, 'DATA_CLASS_UNKNOWN');
});

test('an ABSENT data class still defaults to INTERNAL', () => {
  assert.strictEqual(R.routeRole('implementation-review', {}).ok, true);
  assert.strictEqual(R.routeRole('implementation-review', { dataClass: undefined }).ok, true);
});

test('every declared class is still routable or refused on rank, not on spelling', () => {
  const p = R.loadPolicy();
  for (const dc of Object.keys(p.dataClasses)) {
    const r = R.routeRole('implementation-review', { dataClass: dc });
    if (!r.ok) assert.strictEqual(r.code, 'DATA_CLASS_REFUSED', `${dc} refused for the wrong reason: ${r.code}`);
  }
});

// ── GROK G9 FINDINGS #4 and #5 ────────────────────────────────────────────
test('RED #4: route() refuses an unknown data class, exactly as routeRole() does', () => {
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  const task = (canon.taskTypes[0] || {}).taskId;
  // The D4 repair was applied to routeRole only; route() kept `undefined >
  // undefined`, which is false, so an unrecognised class passed the veto.
  for (const dc of ['typo-class', 'not-a-class', 'Secret']) {
    const r = R.route(canon, { task, dataClass: dc });
    assert.strictEqual(r.ok, false, `route() allowed dataClass "${dc}"`);
  }
});

test('RED #5: a MISSING hard ceiling refuses metered execution', () => {
  const os2 = require('os');
  const live = path.join(__dirname, '..', 'MODEL-ROUTING-POLICY.json');
  const backup = fs.readFileSync(live, 'utf8');
  const restore = () => { try { fs.writeFileSync(live, backup); } catch {} };
  process.on('exit', restore);
  try {
    for (const bad of [undefined, null, 'five', NaN, 0, -1]) {
      const p = JSON.parse(backup);
      if (bad === undefined) delete p.budgets.hardCeilingUsd; else p.budgets.hardCeilingUsd = bad;
      fs.writeFileSync(live, JSON.stringify(p));
      delete require.cache[require.resolve('../tool-router.cjs')];
      const RR = require('../tool-router.cjs');
      const r = RR.meteredAuthorization({ allowMetered: true, approvedBy: 'Marc', capUsd: 2 });
      assert.strictEqual(r.ok, false,
        `hardCeilingUsd=${JSON.stringify(bad)} permitted a metered route — a ceiling that vanishes when malformed is not a ceiling`);
    }
  } finally {
    restore();
    delete require.cache[require.resolve('../tool-router.cjs')];
  }
  assert.strictEqual(fs.readFileSync(live, 'utf8'), backup, 'the policy must be restored');
});

const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failed} failed.`);
