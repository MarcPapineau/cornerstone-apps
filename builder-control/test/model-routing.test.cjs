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
const os = require('os');
const crypto = require('crypto');
const POLICY = path.join(__dirname, '..', 'MODEL-ROUTING-POLICY.json');
const policyBefore = fs.readFileSync(POLICY);
const policyBeforeSha = crypto.createHash('sha256').update(policyBefore).digest('hex');
const INVOCATION_ID = 'INV-model-routing-fixture';
let proofSequence = 0;
function zeroMeteredProof(invocationId = INVOCATION_ID, overrides = {}) {
  const now = Date.now();
  proofSequence += 1;
  return Object.freeze({
    ok: true,
    mode: 'zero-metered',
    invocationId,
    preflightId: `PREFLIGHT-${invocationId}-${proofSequence}`,
    observedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    subscriptionTier: 'Free',
    subscriptionTierState: 'REPORTED',
    unifiedBilling: true,
    onDemandCap: 0,
    onDemandUsed: 0,
    prepaidBalance: 0,
    autoTopup: 'DISABLED',
    ...overrides,
  });
}
const subscriptionProof = zeroMeteredProof();
const grokAuthorization = Object.freeze({
  allowMetered: true,
  approvedBy: 'Marc Papineau',
  capUsd: 2,
  invocationId: INVOCATION_ID,
  subscriptionProof,
});

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

test('the orchestrator policy owns the concrete bounded-worker route', () => {
  const p = R.loadPolicy();
  const selected = p.roles.orchestrator.default;
  assert.deepStrictEqual(p.models[selected].workerRoute,
    { provider: 'claude-subscription', model: 'opus' });
  assert.strictEqual(p.models[selected].execution, 'SUBSCRIPTION');
});

test('data sensitivity vetoes BEFORE capability and cost', () => {
  const p = R.loadPolicy();
  assert.deepStrictEqual(p.vetoOrder, ['dataSensitivity', 'capability', 'availability', 'cost']);
  const r = R.routeRole('implementation-review', { dataClass: 'RESTRICTED' });
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

test('a named human plus a cap and fresh zero-metered proof route, carrying bounds', () => {
  const r = R.routeRole('adversarial-review', grokAuthorization);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.model, 'grok');
  assert.strictEqual(r.toolId, 'grok-cli');
  // The bounds the Product Owner specified must survive into the route.
  assert.strictEqual(r.bounds.maxTurns, 16);
  assert.strictEqual(r.bounds.maxRetries, 0);
  assert.strictEqual(r.bounds.subagents, false);
  assert.strictEqual(r.bounds.webAccess, false);
});

test('RED: role routing refuses a model that does not declare the requested role capability', () => {
  const r = R.routeRole('adversarial-review', { model: 'grok-builder' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'MODEL_CAPABILITY_REFUSED');
});

test('RED: canonical disabled, unavailable, unproven, or task-ineligible tools cannot route', () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  const policy = R.loadPolicy();
  const model = policy.models.codex;
  const mutate = (fn) => {
    const canon = JSON.parse(JSON.stringify(live));
    const tool = canon.tools.find((entry) => entry.toolId === 'codex-local');
    fn(tool);
    return R.validateRoleToolAuthority('implementation-review', 'codex', model, canon);
  };
  for (const [label, result] of [
    ['disabled', mutate((tool) => { tool.enabled = false; })],
    ['unavailable', mutate((tool) => { tool.availability = 'UNVERIFIED'; })],
    ['unproven', mutate((tool) => { delete tool.availabilityEvidence.observedAt; })],
    ['task-ineligible', mutate((tool) => { tool.taskIds = []; })],
  ]) {
    assert.strictEqual(result.ok, false, `${label} canonical tool routed`);
  }
});

test('the default role routes bind to one enabled AVAILABLE canonical tool and task', () => {
  const cases = [
    ['orchestrator', {}, 'claude-code'],
    ['implementation-review', {}, 'codex-local'],
    ['adversarial-review', grokAuthorization, 'grok-cli'],
  ];
  for (const [role, opts, toolId] of cases) {
    const r = R.routeRole(role, opts);
    assert.strictEqual(r.ok, true, `${role} refused: ${r.code} ${r.reason}`);
    assert.strictEqual(r.toolId, toolId);
  }
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
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-routing-missing-')), 'missing.json');
  let threw = false;
  try { R.routeRole('orchestrator', { policyPath: missing }); } catch (e) { threw = /absent policy is not a permissive policy/.test(e.message); }
  assert.ok(threw, 'an absent policy must refuse');
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(POLICY)).digest('hex'), policyBeforeSha);
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
  assert.strictEqual(R.routeRole('adversarial-review', { ...grokAuthorization, capUsd: 5 }).ok, true);
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
// "SENSITIVE", "typo-class" and "" all routed successfully. An unrecognised
// rank compared as undefined, the veto was skipped, and the FIRST control in
// the policy silently did nothing. A misspelling must never widen access.
test('RED: an unrecognised data class REFUSES rather than defaulting through', () => {
  for (const dc of ['SENSITIVE', 'typo-class', 'internal', 'Secret']) {
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

test('policy, router, and canonical tool ceilings share the four-class vocabulary', () => {
  const expected = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];
  const p = R.loadPolicy();
  assert.deepStrictEqual(Object.keys(p.dataClasses), expected);
  assert.deepStrictEqual(Object.keys(R.DATA_RANK), expected);
  assert.deepStrictEqual(expected.map((name) => p.dataClasses[name].rank), [0, 1, 2, 3]);

  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  const routedModels = ['claude', 'codex', 'grok', 'grok-builder', 'copilot'];
  for (const modelId of routedModels) {
    const toolId = R.POLICY_MODEL_TO_CANON_TOOL[modelId];
    const tool = canon.tools.find((entry) => entry.toolId === toolId);
    assert.ok(tool, `${modelId} has no canonical tool ${toolId}`);
    assert.ok(expected.includes(tool.maxDataClassification), `${toolId} uses a foreign data class`);
    assert.strictEqual(p.models[modelId].maxDataClass, tool.maxDataClassification,
      `${modelId} policy ceiling drifted from ${toolId}`);
  }
  assert.strictEqual(R.routeRole('implementation-review', { dataClass: 'CONFIDENTIAL' }).ok, true);
  assert.strictEqual(R.routeRole('implementation-review', { dataClass: 'RESTRICTED' }).code,
    'DATA_CLASS_REFUSED');
});

test('a policy/canon data ceiling conflict refuses before a tool can route', () => {
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  const model = { ...R.loadPolicy().models.codex, maxDataClass: 'INTERNAL' };
  const result = R.validateRoleToolAuthority('implementation-review', 'codex', model, canon);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DATA_CEILING_AUTHORITY_MISMATCH');
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
  const backup = fs.readFileSync(POLICY, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-routing-policy-'));
  for (const [index, bad] of [undefined, null, 'five', NaN, 0, -1].entries()) {
      const p = JSON.parse(backup);
      if (bad === undefined) delete p.budgets.hardCeilingUsd; else p.budgets.hardCeilingUsd = bad;
      const isolated = path.join(dir, `policy-${index}.json`);
      fs.writeFileSync(isolated, JSON.stringify(p));
      const r = R.meteredAuthorization({ allowMetered: true, approvedBy: 'Marc', capUsd: 2, policyPath: isolated });
      assert.strictEqual(r.ok, false,
        `hardCeilingUsd=${JSON.stringify(bad)} permitted a metered route — a ceiling that vanishes when malformed is not a ceiling`);
  }
  assert.strictEqual(fs.readFileSync(POLICY, 'utf8'), backup, 'the canonical policy must never be mutated by a test');
});

test('RED: UNKNOWN canonical billing never launches on a subscription label alone', () => {
  const envelope = { allowMetered: true, approvedBy: 'Marc', capUsd: 2, invocationId: INVOCATION_ID };
  const refused = R.routeRole('adversarial-review', envelope);
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.code, 'BILLING_PROOF_REQUIRED');
  assert.strictEqual(R.routeRole('adversarial-review', { ...envelope, subscriptionProof }).ok, true);
});

test('RED: zero-metered proof rejects missing, malformed, stale, future, and expired evidence', () => {
  const now = Date.now();
  const envelope = { allowMetered: true, approvedBy: 'Marc', capUsd: 2, invocationId: INVOCATION_ID };
  const cases = [
    ['missing preflight id', zeroMeteredProof(INVOCATION_ID, { preflightId: '' })],
    ['wrong mode', zeroMeteredProof(INVOCATION_ID, { mode: 'subscription-only' })],
    ['non-canonical timestamp', zeroMeteredProof(INVOCATION_ID, { observedAt: new Date(now - 1_000).toUTCString() })],
    ['stale lifetime', zeroMeteredProof(INVOCATION_ID, {
      observedAt: new Date(now - (10 * 60_000)).toISOString(),
      expiresAt: new Date(now + 30_000).toISOString(),
    })],
    ['future observation', zeroMeteredProof(INVOCATION_ID, {
      observedAt: new Date(now + 30_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    })],
    ['expired', zeroMeteredProof(INVOCATION_ID, {
      observedAt: new Date(now - 120_000).toISOString(),
      expiresAt: new Date(now - 60_000).toISOString(),
    })],
  ];
  for (const [label, proof] of cases) {
    const result = R.routeRole('adversarial-review', { ...envelope, subscriptionProof: proof });
    assert.strictEqual(result.ok, false, `${label} proof routed`);
    assert.strictEqual(result.code, 'BILLING_PROOF_REQUIRED', `${label} gave ${result.code}`);
  }
});

test('RED: zero-metered proof is bound to one invocation and cannot replay across another', () => {
  const proof = zeroMeteredProof('INV-proof-owner');
  const envelope = { allowMetered: true, approvedBy: 'Marc', capUsd: 2, subscriptionProof: proof };
  assert.strictEqual(R.routeRole('adversarial-review', { ...envelope, invocationId: 'INV-proof-owner' }).ok, true);
  const replay = R.routeRole('adversarial-review', { ...envelope, invocationId: 'INV-another-execution' });
  assert.strictEqual(replay.ok, false);
  assert.strictEqual(replay.code, 'BILLING_PROOF_REQUIRED');
  assert.match(replay.reason, /replay|does not match/i);
});

test('RED: every zero-spend vector and unified billing are mandatory for reported and unreported tiers', () => {
  const envelope = { allowMetered: true, approvedBy: 'Marc', capUsd: 2, invocationId: INVOCATION_ID };
  for (const [field, value] of [
    ['unifiedBilling', false],
    ['onDemandCap', 1],
    ['onDemandUsed', 0.01],
    ['prepaidBalance', 1],
    ['autoTopup', 'ENABLED'],
  ]) {
    const result = R.routeRole('adversarial-review', {
      ...envelope, subscriptionProof: zeroMeteredProof(INVOCATION_ID, { [field]: value }),
    });
    assert.strictEqual(result.ok, false, `${field}=${JSON.stringify(value)} routed`);
    assert.strictEqual(result.code, 'BILLING_PROOF_REQUIRED');
  }
  assert.strictEqual(R.routeRole('adversarial-review', {
    ...envelope, subscriptionProof: zeroMeteredProof(INVOCATION_ID, {
      subscriptionTierState: 'REPORTED', subscriptionTier: 'Free',
    }),
  }).ok, true, 'Free is allowed only when the same zero-metered vectors are proven');
  assert.strictEqual(R.routeRole('adversarial-review', {
    ...envelope, subscriptionProof: zeroMeteredProof(INVOCATION_ID, {
      subscriptionTierState: 'REPORTED', subscriptionTier: 'Premium',
    }),
  }).ok, true, 'paid tiers are allowed under the same zero-metered proof');
  assert.strictEqual(R.routeRole('adversarial-review', {
    ...envelope, subscriptionProof: zeroMeteredProof(INVOCATION_ID, {
      subscriptionTierState: 'UNREPORTED', subscriptionTier: null,
    }),
  }).ok, true, 'an unreported tier is allowed only when every zero-spend vector is still proven');
});

test('RED: subscription tier reporting state is explicit and internally consistent', () => {
  const envelope = { allowMetered: true, approvedBy: 'Marc', capUsd: 2, invocationId: INVOCATION_ID };
  for (const [label, overrides] of [
    ['missing state', { subscriptionTierState: undefined, subscriptionTier: null }],
    ['unknown state', { subscriptionTierState: 'UNKNOWN', subscriptionTier: null }],
    ['reported null', { subscriptionTierState: 'REPORTED', subscriptionTier: null }],
    ['reported empty', { subscriptionTierState: 'REPORTED', subscriptionTier: '' }],
    ['unreported named', { subscriptionTierState: 'UNREPORTED', subscriptionTier: 'Free' }],
  ]) {
    const result = R.routeRole('adversarial-review', {
      ...envelope, subscriptionProof: zeroMeteredProof(INVOCATION_ID, overrides),
    });
    assert.strictEqual(result.ok, false, `${label} tier shape routed`);
    assert.strictEqual(result.code, 'BILLING_PROOF_REQUIRED');
  }
});

test('RED: proof deferral is restricted to the named adapter preflight invocation', () => {
  const envelope = { allowMetered: true, approvedBy: 'Marc', capUsd: 2, deferSubscriptionProof: true };
  for (const opts of [
    envelope,
    { ...envelope, invocationId: INVOCATION_ID },
    { ...envelope, invocationId: INVOCATION_ID, preflightStage: 'another-stage' },
  ]) {
    const result = R.routeRole('adversarial-review', opts);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'BILLING_PROOF_REQUIRED');
  }
  assert.strictEqual(R.routeRole('adversarial-review', {
    ...envelope,
    invocationId: INVOCATION_ID,
    preflightStage: 'adapter-billing-preflight',
  }).ok, true);
  const inapplicable = R.routeRole('implementation-review', {
    deferSubscriptionProof: true,
    invocationId: INVOCATION_ID,
    preflightStage: 'adapter-billing-preflight',
  });
  assert.strictEqual(inapplicable.ok, false, 'an INCLUDED route may not carry a billing-proof bypass flag');
  assert.strictEqual(inapplicable.code, 'BILLING_PROOF_REQUIRED');
});

test('RED: generic route() applies the same UNKNOWN authorization and proof contract', () => {
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  const envelope = { task: 'software.red-team', dataClass: 'INTERNAL', allowMetered: true,
    approvedBy: 'Marc', capUsd: 2, invocationId: INVOCATION_ID };
  const missing = R.route(canon, envelope);
  assert.strictEqual(missing.ok, false);
  assert.match(missing.considered[0].reasons.join(' '), /BILLING_PROOF_REQUIRED/);
  const deferred = R.route(canon, { ...envelope, deferSubscriptionProof: true,
    preflightStage: 'adapter-billing-preflight' });
  assert.strictEqual(deferred.ok, false, 'generic routing may not impersonate adapter preflight');
  assert.strictEqual(R.route(canon, { ...envelope, subscriptionProof }).ok, true);
});

test('Grok policy mirrors UNKNOWN canonical cost until the per-execution proof exists', () => {
  const grok = R.loadPolicy().models.grok;
  assert.strictEqual(grok.execution, 'CANON_UNKNOWN_REQUIRES_PREFLIGHT');
  assert.strictEqual(grok.costPerRouteUsd, null);
  assert.match(grok.costNote, /canonical tool cost class is UNKNOWN/i);
});

test('the live canonical policy bytes were never renamed or rewritten', () => {
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(POLICY)).digest('hex'), policyBeforeSha);
});

const failed = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failed} failed.`);
