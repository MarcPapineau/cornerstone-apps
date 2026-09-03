#!/usr/bin/env node
/**
 * hosting.test.cjs — red proofs for the dashboard host.
 *
 * The host serves internal engineering process state. Every case asserts a
 * refusal, an auth failure, or a leak that does NOT happen.
 */
'use strict';
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const S = require('../hosting/server.cjs');
const AegisState = require('../aegis-state.cjs');
const INHERITED_IMMUTABLE_SNAPSHOT =
  process.env.AEGIS_CHECK_SNAPSHOT_POLICY === 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1';
const HOST_ONLY = process.argv.slice(2).includes('--host-only');
const HOST_COMPOSITION_ONLY = HOST_ONLY && (INHERITED_IMMUTABLE_SNAPSHOT ||
  process.env.AEGIS_HOST_OUTER_CONTAINMENT === 'AEGIS_TOP_LEVEL_HOST_CONTAINMENT_V1');

function validatedSwitchboardPacket() {
  const packetPath = path.join(__dirname, '..', 'packets',
    'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
  const bytes = fs.readFileSync(packetPath);
  const parsed = JSON.parse(bytes);
  return Object.freeze({
    path: S.SWITCHBOARD_PACKET,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    packetId: parsed.packetId,
    parsed,
  });
}

let passed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
async function atest(n, fn) {
  try { await fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
const TOKEN = 'test-token-' + crypto.randomBytes(16).toString('hex');
function configuredListenerPort(name, directFallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    assert.strictEqual(require.main, module,
      `${name} is required when hosting.test.cjs is not executed directly`);
    return directFallback;
  }
  const port = Number(raw);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535,
    `${name} must be an unprivileged TCP port`);
  return port;
}
const HOSTING_TEST_PORT = configuredListenerPort('AEGIS_TEST_HOSTING_PORT', 8796);
const HOSTING_API_TEST_PORT = configuredListenerPort('AEGIS_TEST_HOSTING_API_PORT', 18797);
assert.notStrictEqual(HOSTING_TEST_PORT, HOSTING_API_TEST_PORT,
  'the two hosting test listeners require distinct ports');
const HOSTILE_WORKER_OUTPUT = Object.freeze({
  source: 'function INTERNAL_SOURCE_SENTINEL(){ return "repository text must stay private"; }',
  pem: '-----BEGIN PRIVATE KEY-----\nAEGIS-PEM-SENTINEL-DO-NOT-PUBLISH\n-----END PRIVATE KEY-----',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZWdpcy1qd3Qtc2VudGluZWwifQ.signatureSentinel123',
  cookie: 'Cookie: session=AEGIS-COOKIE-SENTINEL-DO-NOT-PUBLISH',
  unlabelled: 'tR7xQm2LpZ0aVbNc8YeWuJ4KsHdG1fXo',
});

function assertNoHostileWorkerOutput(value, surface) {
  const text = JSON.stringify(value);
  for (const [kind, sentinel] of Object.entries(HOSTILE_WORKER_OUTPUT)) {
    assert.ok(!text.includes(sentinel), `${surface} leaked ${kind} worker output`);
  }
  for (const field of ['stdoutTail', 'stderrTail', 'rawOutput', 'modelOutput', 'transcript']) {
    assert.ok(!text.includes(field), `${surface} published forbidden raw-output field ${field}`);
  }
}

console.log('AEGIS dashboard hosting — red proofs');

test('listener ports honor the snapshot supervisor environment', () => {
  assert.strictEqual(HOSTING_TEST_PORT,
    process.env.AEGIS_TEST_HOSTING_PORT ? Number(process.env.AEGIS_TEST_HOSTING_PORT) : 8796);
  assert.strictEqual(HOSTING_API_TEST_PORT,
    process.env.AEGIS_TEST_HOSTING_API_PORT ? Number(process.env.AEGIS_TEST_HOSTING_API_PORT) : 18797);
});

test('loopback with a generated token is allowed', () => {
  const v = S.validateConfig({ port: 8791, host: '127.0.0.1' }, {});
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.config.generated, true, 'a token must be generated when none is supplied');
  assert.ok(v.config.token.length >= 24);
});

test('RED: binding beyond loopback is refused', () => {
  const v = S.validateConfig({ port: 8791, host: '0.0.0.0' }, {});
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'NON_LOOPBACK_REFUSED');
});

test('RED: localhost is refused because post-validation name resolution is mutable', () => {
  const v = S.validateConfig({ port: 8791, host: 'localhost', token: 'x'.repeat(32) }, {});
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'NON_LOOPBACK_REFUSED');
});

test('RED: IPv6 loopback is refused consistently before any listener or malformed URL authority exists', () => {
  const validated = S.validateConfig({ port: HOSTING_TEST_PORT, host: '::1', token: 'x'.repeat(32) }, {});
  assert.strictEqual(validated.ok, false);
  assert.strictEqual(validated.code, 'NON_LOOPBACK_REFUSED');
  const started = S.start({ port: HOSTING_TEST_PORT, host: '::1', token: 'x'.repeat(32) });
  assert.deepStrictEqual(started, { ok: false, code: 'NON_LOOPBACK_REFUSED' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(started, 'server'), false,
    'the refused IPv6 address still created a runtime listener');
});

test('RED: legacy acknowledgement flags and a strong token cannot expose plaintext HTTP', () => {
  for (const host of ['0.0.0.0', '192.0.2.10', '::']) {
    const v = S.validateConfig({
      port: 8791, host, token: 'x'.repeat(32),
      allowNonLoopback: true, acknowledged: true,
    }, {});
    assert.strictEqual(v.ok, false, `${host} escaped the loopback-only boundary`);
    assert.strictEqual(v.code, 'NON_LOOPBACK_REFUSED');
    assert.match(v.reason, /local-only.*no flag can expose/i);
  }
});

test('RED: start refuses non-loopback HTTP before creating a listener', () => {
  const started = S.start({
    port: HOSTING_TEST_PORT, host: '0.0.0.0', token: 'x'.repeat(32),
    allowNonLoopback: true, acknowledged: true,
  });
  assert.deepStrictEqual(started, { ok: false, code: 'NON_LOOPBACK_REFUSED' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(started, 'server'), false,
    'refused exposure still returned a server handle');
});

test('RED: a weak token is refused', () => {
  const v = S.validateConfig({ port: 8791, host: '127.0.0.1', token: 'short' }, {});
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'WEAK_TOKEN');
});

test('RED: there is no anonymous mode, even on loopback', () => {
  // Auth is structural: every validated config carries a token.
  const v = S.validateConfig({ port: 8791, host: '127.0.0.1' }, {});
  assert.ok(v.config.token, 'a config without a token must not exist');
});

test('RED: sensitive path classes are never servable', () => {
  for (const p of ['/ledger.json', '/builder-control/ledger.json', '/reviews/r.json',
                   '/review-raw/x.txt', '/packets/p.json', '/.env', '/.git/config',
                   '/id.pem', '/secret.json', '/token.txt']) {
    assert.ok(S.isNeverServe(p), `${p} must be refused`);
  }
});

test('RED: the servable allow-list is exactly the projection', () => {
  assert.deepStrictEqual(Object.keys(S.SERVABLE).sort(), ['/', '/index.html', '/state.js']);
  for (const v of Object.values(S.SERVABLE)) {
    assert.ok(['index.html', 'state.js'].includes(v.file), `unexpected servable file ${v.file}`);
  }
});

// ── switchboard UI wiring — static source proofs ────────────────────────────
// These read builder-control/dashboard/index.html as text and prove the
// interactive layer actually exists and stays inside its guardrails, without
// needing a browser: a required objective field, a Start control, honest
// limitation text, no dangerous free-text intake fields, safe DOM rendering,
// and no n8n anywhere.
const DASHBOARD_HTML_PATH = require('path').join(__dirname, '..', 'dashboard', 'index.html');
const dashboardHtml = () => fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');

test('switchboard: objective intake form exists with objective required', () => {
  const html = dashboardHtml();
  assert.ok(/id="intake-form"/.test(html), 'no objective intake form found');
  assert.ok(/id="in-objective"[^>]*required/.test(html) || /id="in-objective"[\s\S]{0,80}required/.test(html),
    'objective field is not marked required');
  assert.ok(/id="in-project"/.test(html), 'no optional project field');
  assert.ok(/id="in-constraints"/.test(html), 'no optional constraints field');
  assert.ok(/id="in-acceptance"/.test(html), 'no optional acceptance criteria field');
  assert.ok(/id="in-dataclass"/.test(html), 'no optional data classification field');
});

test('switchboard: intake posts to /api/objective, start posts to /api/start', () => {
  const html = dashboardHtml();
  assert.ok(/\/api\/objective/.test(html), 'no reference to /api/objective');
  assert.ok(/\/api\/start/.test(html), 'no reference to /api/start');
  assert.ok(/INTAKE_RECORDED/.test(html), 'no honest INTAKE_RECORDED confirmation rendering');
});

test('switchboard: objective intake is pinned to the approved operator-beta packet', () => {
  assert.strictEqual(
    S.SWITCHBOARD_PACKET,
    'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json',
    'dashboard intake is not bound to the approved functional-beta packet',
  );
});

test('switchboard: deterministic checks use the canonical authenticated /api/checks route only for BUILT', () => {
  const html = dashboardHtml();
  assert.ok(/\/api\/checks/.test(html), 'no deterministic-checks control wiring');
  const row = html.slice(html.indexOf('function runActionRow'), html.indexOf('function renderRuns'));
  assert.ok(/run\.state\s*===\s*'BUILT'/.test(row), 'the checks control is not gated to BUILT');
  assert.ok(/Run deterministic checks/.test(row), 'the checks control has no founder-readable label');
  assert.strictEqual(S.API_POST_ROUTES['/api/checks'], 'checks',
    'hosting does not declare the canonical checks route');
  assert.strictEqual(S.DEFAULT_CONTROL_AUTHORITIES.runChecks, require('../aegis-run.cjs').runChecks,
    'the production HTTP route is not pinned to canonical runChecks');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8'),
    /pathname === '\/api\/checks'\) result = controlAuthorities\.runChecks\(runId\)/,
    'the HTTP route is not a thin pass-through to its fixed runChecks authority');
});

test('switchboard: review verification uses the canonical bind-only route only for CHECKS_PASSED', () => {
  const html = dashboardHtml();
  const row = html.slice(html.indexOf('function runActionRow'), html.indexOf('function renderRuns'));
  assert.ok(/run\.state\s*===\s*'CHECKS_PASSED'/.test(row),
    'review verification is not gated to CHECKS_PASSED');
  assert.ok(/Verify independent review/.test(row), 'review verification has no founder-readable label');
  assert.ok(/reviews run outside this functional-beta dashboard/.test(row),
    'the dashboard does not explain that reviews run externally');
  assert.ok(/does not launch or pay for a review/.test(row),
    'the dashboard could imply that binding launches a reviewer');
  assert.strictEqual(S.API_POST_ROUTES['/api/review-bind'], 'review-bind',
    'hosting does not declare the canonical review-bind route');
  assert.strictEqual(S.DEFAULT_CONTROL_AUTHORITIES.bindIndependentReview,
    require('../aegis-run.cjs').bindIndependentReview,
    'the production HTTP route is not pinned to canonical bindIndependentReview');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8'),
    /pathname === '\/api\/review-bind'\) result = controlAuthorities\.bindIndependentReview\(runId\)/,
    'the HTTP route is not a thin pass-through to its fixed bindIndependentReview authority');
});

test('control authority composition seam is exact, frozen, and unavailable to browser input', () => {
  assert.ok(Object.isFrozen(S.DEFAULT_CONTROL_AUTHORITIES));
  assert.deepStrictEqual(Object.keys(S.DEFAULT_CONTROL_AUTHORITIES).sort(),
    ['bindIndependentReview', 'runChecks']);
  assert.throws(() => S.resolveControlAuthorities({ runChecks() {} }), /provide exactly/);
  assert.throws(() => S.resolveControlAuthorities({
    runChecks() {}, bindIndependentReview() {}, startRun() {},
  }), /provide exactly/);
  const supplied = S.resolveControlAuthorities({
    runChecks() { return 'checks'; },
    bindIndependentReview() { return 'review'; },
  });
  assert.ok(Object.isFrozen(supplied));
  assert.deepStrictEqual(Object.keys(supplied).sort(), ['bindIndependentReview', 'runChecks']);
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  assert.match(serverSource, /http\.createServer\(handler\(config\)\)/,
    'production server construction must not inject alternate control authorities');
  assert.throws(() => S.resolveControlAuthorities(Object.defineProperty({
    bindIndependentReview() {},
  }, 'runChecks', { enumerable: true, get() { throw new Error('getter executed'); } })),
  /provide exactly/, 'accessor-backed control authority was accepted');
});

// Cancel and retry are wired because they are operational: cancelRun takes the
// legal ABANDONED edge that already exists in STATES, and retryRun re-enters a
// failed run. Pause is NOT wired, and this test exists to keep it that way.
// Builder execution is a synchronous spawnSync inside cmdBuild — there is no
// asynchronous worker to suspend and no PAUSED slot in the canonical state
// machine. The earlier version of this test asserted /api/pause appeared in the
// page, which would have been satisfied ONLY by shipping a control that cannot
// do what its label promises. A disabled button that says so is the true
// rendering; a live button that 409s after the click is theater.
test('switchboard: cancel and retry are wired; Pause remains unavailable without safe resume semantics', () => {
  const html = dashboardHtml();
  assert.ok(/\/api\/cancel/.test(html), 'no cancel wiring');
  assert.ok(/\/api\/retry/.test(html), 'no retry wiring');
  assert.ok(!/\/api\/pause/.test(html),
    'the dashboard wires /api/pause — Pause must stay unwired until an asynchronous worker exists to suspend');
});

// "Wired" is not the whole contract — cancel and retry must be wired ONLY where
// they can actually succeed. An always-rendered Cancel on a terminal run is the
// same defect as a live Pause. BUILDING is different: the canonical async
// worker publishes verified ownership evidence and cancelRun uses its
// authenticated, attempt-bound cancellation mailbox. The browser may expose
// Cancel only when that public ownership projection is complete.
test('RED: cancel and retry render only in states where they are operational', () => {
  const html = dashboardHtml();
  const row = html.slice(html.indexOf('function runActionRow'), html.indexOf('function renderRuns'));
  assert.ok(row.length > 0, 'runActionRow not found — the action-row contract cannot be checked');

  const cancelable = row.slice(row.indexOf('CANCELABLE'), row.indexOf('/api/cancel'));
  assert.ok(/CANCELABLE\.indexOf\(run\.state\)\s*!==\s*-1/.test(row),
    'Cancel is rendered unconditionally — it must be gated on the run state');
  assert.ok(/hasCancellationCapability\(run\)/.test(cancelable),
    'BUILDING cancellation is not gated on the canonical public capability');
  const capability = html.slice(html.indexOf('function hasCancellationCapability'),
    html.indexOf('function buildEvidence'));
  assert.match(capability,
    /run\.state\s*===\s*'BUILDING'[\s\S]{0,160}run\.build\.cancelAvailable\s*===\s*true/,
    'the dashboard does not require the bounded server-projected cancellation capability');
  assert.doesNotMatch(capability, /workerPid|status\s*===\s*'STARTING'/,
    'the browser inferred cancellation authority from process or activity telemetry');
  for (const terminal of ['ABANDONED', 'ROLLED_BACK', 'CHECKPOINTED']) {
    assert.ok(!new RegExp(`'${terminal}'`).test(cancelable),
      `${terminal} is listed as cancelable — a terminal run cannot be cancelled, and offering it is theater`);
  }

  assert.ok(/run\.state\s*===\s*'BUILD_FAILED'\s*\|\|\s*run\.state\s*===\s*'CHECKS_FAILED'\s*\|\|\s*run\.state\s*===\s*'REVIEW_FAILED'/.test(row),
    'Retry is not gated to the failed states it can actually re-enter');
  const retryHelper = html.slice(html.indexOf('async function requestRunRetry'),
    html.indexOf('function renderFounderSummary'));
  assert.match(retryHelper,
    /\['BUILD_FAILED','CHECKS_FAILED','REVIEW_FAILED'\]\.indexOf\(run\.state\)\s*===\s*-1/,
    'the shared Retry helper does not fail closed outside canonical failed states');
  assert.match(retryHelper, /callApi\('\/api\/retry',\s*\{\s*runId:\s*run\.runId\s*\}\)/,
    'Retry must send only the canonical runId to /api/retry');
  assert.match(row,
    /run\.state\s*===\s*'BUILD_FAILED'[\s\S]*?retryBtn\.addEventListener\('click',[\s\S]*?window\.AEGIS_DASHBOARD\.requestRunRetry\(run,\s*retryBtn\)/,
    'the failed-state guard must enclose wiring to the one exported Retry helper');
  assert.match(html, /requestRunRetry:\s*requestRunRetry/,
    'the canonical Retry helper is not exported through the shared dashboard seam');
  const cancelCall = row.slice(row.indexOf("callApi('/api/cancel'"), row.indexOf("callApi('/api/cancel'") + 100);
  assert.match(cancelCall, /callApi\('\/api\/cancel',\s*\{\s*runId:\s*run\.runId\s*\}\)/,
    'Cancel must send only the canonical runId to /api/cancel');
});

test('RED: the Pause button is rendered disabled, not merely titled or hidden', () => {
  const html = dashboardHtml();
  // The control is present (the founder can see the capability is known and
  // absent) but structurally un-clickable, so the impossible action cannot be
  // attempted and then explained away in an error toast afterwards.
  const idx = html.indexOf("'Pause'");
  assert.ok(idx !== -1, 'no Pause control is rendered at all — the limitation must be visible, not omitted');
  const block = html.slice(idx, idx + 400);
  assert.ok(/\.disabled\s*=\s*true/.test(block), 'the Pause button is not set disabled');
  assert.ok(!/pauseBtn\.addEventListener/.test(html), 'the Pause button has a click handler — it must have none');
  assert.ok(/until safe suspend\/resume semantics and evidence exist/i.test(block),
    'the disabled Pause carries no reason a founder can read');
});

test('RED: the page states the Pause limitation in prose, not only in a tooltip', () => {
  const html = dashboardHtml();
  const notice = html.slice(html.indexOf('id="limitation-notice"'), html.indexOf('id="limitation-notice"') + 600);
  assert.ok(/Pause is unavailable/i.test(notice), 'the limitation notice does not mention Pause');
  assert.ok(/asynchronous/i.test(notice), 'the notice does not say WHY pause is unavailable');
});

// Truthful route exposure: the server keeps /api/pause in its route table. That
// is not a contradiction — the route exists so that a direct API caller gets a
// reasoned 409 CONTROL_UNAVAILABLE instead of an ambiguous 404 that reads as
// "wrong URL". The route is honest precisely because it never mutates.
test('RED: /api/pause is exposed as a route but is a refusal, never a mutation', () => {
  assert.ok(Object.keys(S.API_POST_ROUTES || {}).includes('/api/pause'),
    '/api/pause must remain a declared route so callers get a reason, not a 404');
  const src = fs.readFileSync(path.join(__dirname, '..', 'aegis-run.cjs'), 'utf8');
  // Slice the FUNCTION BODY only. Cutting at `function cancelRun` would drag in
  // cancelRun's doc comment, which legitimately names transition() — a false
  // positive that would make this proof assert the wrong file region.
  const start = src.indexOf('function pauseRun');
  assert.ok(start !== -1, 'pauseRun not found in aegis-run.cjs');
  const end = src.indexOf('\n}\n', start);
  assert.ok(end !== -1, 'could not find the end of pauseRun');
  const body = src.slice(start, end);
  assert.ok(!/transition\(/.test(body), 'pauseRun calls transition() — pause must never move a run');
  assert.ok(!/saveRun\(/.test(body), 'pauseRun writes a run file — pause must never mutate');
  assert.ok(/CONTROL_UNAVAILABLE/.test(body), 'pauseRun does not fail closed with CONTROL_UNAVAILABLE');
  // Every path out of pauseRun is a throw; there is no returning branch.
  assert.ok(!/\n\s*return\s/.test(body), 'pauseRun has a returning branch — every state must fail closed');
});

test('RED: pauseRun refuses BUILDING and non-BUILDING alike, with no PAUSED state anywhere', () => {
  const AegisRun = require('../aegis-run.cjs');
  assert.ok(!Object.keys(AegisRun.STATES).includes('PAUSED'),
    'a PAUSED state exists in the canonical state machine — pause would then be implementable, and this proof is stale');
  // A run id that cannot resolve still must not produce a success shape.
  assert.throws(() => AegisRun.pauseRun('RUN-DOES-NOT-EXIST-0000'),
    (e) => e instanceof AegisRun.AegisControlError,
    'pauseRun must throw a typed control error, never return');
});

// ── the live surface must carry what the founder panel re-renders from ────
// CONFIRMED FINDING #7: the founder summary repaints on every /api/status
// push. Anything it states out loud — which run is bound, at what time, under
// what packet and subject hash, why the risk tier is what it is, and which
// reviewer covered which path — has to survive minimization or the repainted
// panel is quietly less true than the generated one.
test('RED: /api/status carries the current-run binding, not just an array of runs', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK',
      runs: [{ runId: 'RUN-A', state: 'BUILT', objective: 'o', createdAt: 'c', updatedAt: 'u', packetId: 'p' }],
      current: { state: 'BOUND', runId: 'RUN-A', updatedAt: 'u', packetId: 'p', subjectSha256: 'sha', reason: 'why' } },
  });
  assert.ok(min.runsBinding, 'no runsBinding on the live status surface');
  assert.strictEqual(min.runsBinding.runId, 'RUN-A');
  assert.strictEqual(min.runsBinding.subjectSha256, 'sha');
  assert.ok(min.runsBinding.reason, 'the binding must carry the reason it was selected');
  assert.strictEqual(min.runs[0].updatedAt, 'u', 'run timestamps must survive minimization');
  assert.strictEqual(min.runs[0].packetId, 'p', 'the packet id must survive minimization');
});

test('RED: a missing binding minimizes to UNAVAILABLE, never to the first run in the list', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK', runs: [{ runId: 'RUN-A', state: 'BUILT' }] },
  });
  assert.strictEqual(min.runsBinding.state, 'UNAVAILABLE');
  assert.strictEqual(min.runsBinding.runId, null);
});

test('RED: an unavailable live gate still preserves the truthful eleven-stage projection', () => {
  const stages = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    step: `step-${index + 1}`,
    label: `Stage ${index + 1}`,
    state: index < 5 ? 'PASS' : 'UNVERIFIED',
    reason: index < 5 ? 'canonical evidence is present' : 'awaiting canonical evidence',
    privateDetail: 'must not travel',
  }));
  const min = S.minimizeApiStatus({
    generatedAt: 'T',
    engineering: { state: 'UNAVAILABLE', reason: 'no current subject is bound', stages },
    runs: { state: 'OK', runs: [] },
  });
  assert.strictEqual(min.engineering.state, 'UNAVAILABLE');
  assert.strictEqual(min.engineering.reason, 'no current subject is bound');
  assert.strictEqual(min.engineering.stages.length, 11,
    'the live minimizer discarded the canonical route before subject binding');
  assert.deepStrictEqual(min.engineering.stages[4], {
    id: 5, step: 'step-5', label: 'Stage 5', state: 'PASS',
    reason: 'canonical evidence is present',
  });
  assert.ok(!JSON.stringify(min.engineering.stages).includes('privateDetail'));
});

test('RED: /api/status preserves the checkpoint receipt id and its safe rollback commit', () => {
  const rollbackPoint = '0123456789abcdef0123456789abcdef01234567';
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK', runs: [{
      runId: 'RUN-A', state: 'CHECKPOINTED', checkpoint: 'CP-A', rollbackPoint,
      checkpointState: 'VALIDATED', checkpointReason: null,
      checkpointInternal: { secret: 'must not travel' },
    }] },
  });
  assert.strictEqual(min.runs[0].checkpoint, 'CP-A',
    'the public run lost its canonical checkpoint receipt id');
  assert.strictEqual(min.runs[0].rollbackPoint, rollbackPoint,
    'the public run lost the canonical safe rollback commit');
  assert.strictEqual(min.runs[0].checkpointState, 'VALIDATED',
    'the public run lost the projector\'s checkpoint validation result');
  assert.strictEqual(min.runs[0].checkpointReason, null);
  assert.ok(!('checkpointInternal' in min.runs[0]),
    'checkpoint internals crossed the public run allowlist');
});

test('RED: /api/status carries only the bounded validated worktree receipt, never its private path', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK', runs: [{
      runId: 'RUN-20260829-c0ffee01', state: 'WORKTREE_READY',
      worktree: { state: 'VALIDATED', isolated: true, branch: 'aegis/RUN-20260829-c0ffee01',
        path: '/Users/operator/private/aegis-wt-RUN-20260829-c0ffee01' },
    }] },
  });
  assert.deepStrictEqual(min.runs[0].worktree, {
    state: 'VALIDATED', isolated: true, branch: 'aegis/RUN-20260829-c0ffee01',
  });
  assert.ok(!JSON.stringify(min).includes('/Users/operator/private'),
    'the private absolute worktree path crossed the live public boundary');

  const malformed = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK', runs: [{ runId: 'RUN-20260829-c0ffee02', state: 'WORKTREE_READY',
      worktree: { state: 'INVALID', reason: 'bounded branch validation failed', path: '/private/secret' } }] },
  });
  assert.deepStrictEqual(malformed.runs[0].worktree, {
    state: 'INVALID', isolated: false, branch: null, reason: 'bounded branch validation failed',
  });
  assert.ok(!JSON.stringify(malformed).includes('/private/secret'));
});

test('RED: /api/status exposes only minimized exact-subject review refusal evidence', () => {
  const min = S.minimizeApiStatus({
    generatedAt: '2026-08-29T10:00:00.000Z', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK', runs: [{
      runId: 'RUN-20260829-a1b2c3d4', state: 'REVIEW_FAILED', objective: 'correct review findings',
      reviewFailure: {
        status: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
        subjectSha256: 'a'.repeat(64), checkReceiptSha256: 'b'.repeat(64),
        refusedAt: '2026-08-29T09:59:00.000Z', authority: 'engineering-os.cjs --gate-done',
        rejectedReviewers: [{ reviewer: 'codex', reviewId: 'REV-codex-current', raw: 'SECRET' }],
        blockingFindingCount: 2, refusalRuleCount: 3,
        summary: 'caller-selected message', rawGate: { detail: 'SECRET' },
      },
    }] },
  });
  const refusal = min.runs[0].reviewFailure;
  assert.deepStrictEqual(Object.keys(refusal).sort(), [
    'authority', 'blockingFindingCount', 'checkReceiptSha256', 'reasonCode', 'refusedAt',
    'rejectedReviewers', 'status', 'subjectSha256', 'summary',
  ].sort());
  assert.deepStrictEqual(refusal.rejectedReviewers,
    [{ reviewer: 'codex', reviewId: 'REV-codex-current' }]);
  assert.strictEqual(refusal.summary,
    'Independent review found 2 blocking issue(s) on this exact checked version.');
  assert.ok(!JSON.stringify(refusal).includes('SECRET'));
  assert.ok(!JSON.stringify(refusal).includes('caller-selected'));
});

test('RED: /api/status preserves only a bounded canonical route refusal', () => {
  const base = { generatedAt: 'T', engineering: { state: 'UNAVAILABLE' } };
  const refused = S.minimizeApiStatus({ ...base, runs: { state: 'OK', runs: [{
    runId: 'RUN-20260830-a1b2c3d4', state: 'INTAKE_RECORDED', objective: 'route refusal',
    route: { state: 'REFUSED', code: 'DATA_CLASS_REFUSED', reason: 'SENSITIVE data exceeds this route.' },
  }] } });
  assert.deepStrictEqual(refused.runs[0].route, {
    state: 'REFUSED', code: 'DATA_CLASS_REFUSED', reason: 'SENSITIVE data exceeds this route.',
  });
  for (const malformed of [
    { state: 'REFUSED', code: 'bad', reason: 'reason' },
    { state: 'REFUSED', code: 'ROUTE_REFUSED', reason: ' secret\ntext' },
    { state: 'REFUSED', code: 'ROUTE_REFUSED', reason: 'x'.repeat(513) },
    { state: 'REFUSED', code: 'ROUTE_REFUSED', reason: 'reason', detail: 'private' },
  ]) {
    const projected = S.minimizeApiStatus({ ...base, runs: { state: 'OK', runs: [{
      runId: 'RUN-20260830-a1b2c3d5', state: 'INTAKE_RECORDED', objective: 'bad route', route: malformed,
    }] } });
    assert.strictEqual(projected.runs[0].route, null);
  }
});

test('snapshot to live status retains the fail-closed uncorroborated review claim', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-host-review-failure-'));
  try {
    const runId = 'RUN-20260830-feed0002';
    fs.writeFileSync(path.join(temp, `${runId}.json`), JSON.stringify({
      runId, state: 'REVIEW_FAILED', objective: 'Correct exact review findings',
      createdAt: '2026-08-30T12:00:00.000Z', updatedAt: '2026-08-30T12:01:00.000Z',
      packet: 'builder-control/packets/PKT-TEST.json', corrections: 0,
      reviewFailure: {
        schemaVersion: 1, status: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
        subjectSha256: 'a'.repeat(64), checkReceiptSha256: 'b'.repeat(64),
        packet: { path: 'builder-control/packets/PKT-TEST.json', sha256: 'c'.repeat(64) },
        refusedAt: '2026-08-30T12:01:00.000Z', authority: 'engineering-os.cjs --gate-done',
        rejectedReviewers: [{ reviewer: 'codex', reviewId: 'REV-codex-current' }],
        blockingFindingCount: 1, refusalRuleCount: 2,
      },
    }));
    const status = S.minimizeApiStatus(AegisState.snapshot({}, { runsDir: temp }));
    assert.deepStrictEqual(status.runs[0].reviewFailure, {
      status: 'UNVERIFIED', reasonCode: 'REVIEW_FAILURE_UNCORROBORATED',
      summary: 'The run records a review-failure claim, but attested exact-subject gate evidence is unavailable in this projection.',
    });
    assert.strictEqual(status.runs[0].state, 'REVIEW_FAILED');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('RED: /api/status carries risk reasons, subject hash and reviewer completeness', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T',
    engineering: { state: 'OK', verdict: 'BLOCKED', lane: 'FULL', highRisk: true,
      laneWhy: ['a high-risk signal is present'], riskReasons: ['touches a protected path'],
      subjectSha256: 'sha256value', subjectPaths: ['a.cjs'],
      problems: [{ rule: 'R', detail: 'd', internalOnly: 'must not travel' }],
      reviewerCompleteness: { complete: false, subjectSha256: 'sha256value', rows: [
        { reviewer: 'codex', job: 'j', planned: 'PLANNED', required: 'REQUIRED', executed: 'EXECUTED',
          disposition: 'REJECT', reviewId: 'REV-1', score: '1/2 subject path(s) covered',
          coveredPaths: ['a.cjs'], missingPaths: ['b.cjs'], stalePaths: ['gone.cjs'], reason: 'r',
          rawTranscript: 'SECRET REVIEWER OUTPUT' } ] },
      stages: [] },
  });
  const e = min.engineering;
  assert.deepStrictEqual(e.riskReasons, ['touches a protected path']);
  assert.deepStrictEqual(e.laneWhy, ['a high-risk signal is present']);
  assert.strictEqual(e.subjectSha256, 'sha256value');
  assert.strictEqual(e.problems[0].detail, 'd');
  assert.ok(!('internalOnly' in e.problems[0]), 'minimization must drop fields it does not explicitly copy');
  const row = e.reviewerCompleteness.rows[0];
  assert.strictEqual(row.disposition, 'REJECT');
  assert.strictEqual(row.score, '1/2 subject path(s) covered');
  assert.deepStrictEqual(row.coveredPaths, ['a.cjs']);
  assert.deepStrictEqual(row.missingPaths, ['b.cjs']);
  assert.deepStrictEqual(row.stalePaths, ['gone.cjs']);
  assert.ok(!('rawTranscript' in row), 'raw reviewer output must never reach the browser surface');
  assert.ok(!JSON.stringify(min).includes('SECRET REVIEWER OUTPUT'), 'reviewer transcript content leaked onto /api/status');
});

// A panel that prints "INCOMPLETE" and stops has told the founder there is a
// problem and not what it is. The projector writes the sentence that says
// which reviewer fell short and how; minimization must not be what deletes it.
test('RED: the founder-readable INCOMPLETE explanation survives minimization', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T',
    engineering: { state: 'OK', verdict: 'BLOCKED', lane: 'FULL', highRisk: true,
      subjectSha256: 'sha256value', problems: [], stages: [],
      reviewerCompleteness: {
        complete: false, subjectSha256: 'sha256value', lane: 'FULL',
        required: ['codex'], advisory: [], executed: [], missing: ['codex'],
        completeReason: 'Review coverage is INCOMPLETE: codex read only part of the change. ' +
          'Re-run the reviewer(s) named above against this exact change.',
        rows: [] },
      },
  });
  const rc = min.engineering.reviewerCompleteness;
  assert.ok(rc.completeReason, 'the completeness sentence was stripped by minimization');
  assert.ok(/INCOMPLETE/.test(rc.completeReason), 'the surviving sentence does not state the incomplete verdict');
  assert.ok(/codex read only part of the change/.test(rc.completeReason),
    'the surviving sentence does not name the reviewer or say what it fell short on');
  assert.ok(/Re-run/.test(rc.completeReason), 'the surviving sentence does not state the remedy');
  assert.strictEqual(rc.complete, false);
});

test('RED: the complete explanation travels too, so a green panel says why it is green', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T',
    engineering: { state: 'OK', verdict: 'READY', lane: 'FULL', highRisk: false,
      subjectSha256: 'sha256value', problems: [], stages: [],
      reviewerCompleteness: {
        complete: true, subjectSha256: 'sha256value', lane: 'FULL',
        required: ['codex'], advisory: [], executed: ['codex'], missing: [],
        completeReason: 'Every required reviewer (codex) reviewed this exact change and read all ' +
          '2 changed file(s), and no reviewer claims a file outside it.',
        rows: [] },
      },
  });
  const rc = min.engineering.reviewerCompleteness;
  assert.ok(/^Every required reviewer/.test(rc.completeReason || ''),
    'the complete-coverage sentence did not survive minimization');
  assert.strictEqual(rc.complete, true);
});

// The sentence is BUILT by concatenating paths and reviewer names into prose,
// so it is exactly the kind of string that can carry a home directory onto a
// browser panel. It must travel sanitized, like every other public string.
test('RED: the completeness sentence is sanitized and carries no private reviewer data', () => {
  const repo = path.resolve(__dirname, '..', '..');
  const min = S.minimizeApiStatus({
    generatedAt: 'T',
    engineering: { state: 'OK', verdict: 'BLOCKED', lane: 'FULL', highRisk: true,
      subjectSha256: 'sha256value', problems: [], stages: [],
      reviewerCompleteness: {
        complete: false, subjectSha256: 'sha256value', lane: 'FULL',
        required: ['codex'], advisory: [], executed: [], missing: ['codex'],
        completeReason: 'Review coverage is INCOMPLETE: codex claims file(s) that are not part of ' +
          `this change (${repo}/builder-control/hosting/server.cjs, /Users/someone/secret-checkout/x.cjs), ` +
          'so the record describes a different change.',
        rawTranscript: 'SECRET COMPLETENESS TRANSCRIPT',
        internalOnly: 'must not travel',
        rows: [] },
      },
  });
  const rc = min.engineering.reviewerCompleteness;
  assert.ok(!rc.completeReason.includes(repo), 'the repository absolute path leaked in the completeness sentence');
  assert.ok(/builder-control\/hosting\/server\.cjs/.test(rc.completeReason),
    'republishing repo-relative must keep the file the sentence is about');
  assert.ok(!/\/Users\/someone/.test(rc.completeReason), 'a foreign absolute path leaked in the completeness sentence');
  assert.ok(rc.completeReason.includes('[path]/x.cjs'), 'a foreign path must reduce to [path]/<file>, not vanish');
  assert.ok(!('rawTranscript' in rc), 'minimization must drop fields it does not explicitly copy');
  assert.ok(!('internalOnly' in rc), 'minimization must drop fields it does not explicitly copy');
  assert.ok(!JSON.stringify(min).includes('SECRET COMPLETENESS TRANSCRIPT'),
    'reviewer transcript content leaked onto /api/status alongside the completeness sentence');
});

test('a completeness projection with no sentence minimizes to null, never to undefined or a guess', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T',
    engineering: { state: 'OK', verdict: 'BLOCKED', lane: 'FULL', highRisk: false,
      subjectSha256: 'sha', problems: [], stages: [],
      reviewerCompleteness: { complete: false, subjectSha256: 'sha', rows: [] } },
  });
  const rc = min.engineering.reviewerCompleteness;
  assert.ok('completeReason' in rc, 'the field must exist so the panel does not have to guess it away');
  assert.strictEqual(rc.completeReason, null);
});

test('RED: /api/status carries the CAD projection, including its UNAVAILABLE state', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    cost: { state: 'OK', recordedUsdDisplay: 1, totalUsd: 1, recordedRuns: 1, unrecordedRuns: 0,
      caveat: null, byReviewer: {}, cad: { state: 'UNAVAILABLE', reason: 'no canonical FX evidence' } },
  });
  assert.strictEqual(min.cost.cad.state, 'UNAVAILABLE');
  assert.ok(/no canonical FX evidence/.test(min.cost.cad.reason));
  assert.strictEqual(min.cost.totalUsd, 1, 'the USD audit value must still travel');
});

test('RED: the founder summary repaints from the live push, through one shared renderer', () => {
  const html = dashboardHtml();
  assert.ok(/window\.AEGIS_DASHBOARD\s*=/.test(html), 'no shared renderer seam between the snapshot and the live surface');
  const apply = html.slice(html.indexOf('function applyStatus'), html.indexOf('function applyStatus') + 1400);
  assert.ok(/renderFounderSummary/.test(apply), 'applyStatus does not repaint the founder summary');
  assert.ok(/status\.runsBinding/.test(apply), 'the repaint does not use the pushed binding');
  assert.ok(/renderCost/.test(apply), 'applyStatus does not repaint the spend panel, which would leave a stale figure');
  assert.ok(/renderConnectors/.test(apply), 'applyStatus does not repaint connector evidence');
  assert.ok(/function renderConnectors/.test(html), 'the initial and live connector rows do not share one renderer');
});

test('RED: the live projection carries sanitized connector facts without credentials or query strings', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    integration: { connectors: { state: 'OK', thresholdMinutes: 60,
      source: 'builder-control/connector-registry.json', ledgerSource: 'builder-control/ledger.json',
      connectors: [{
        connectorId: 'notion', label: 'Notion', provider: 'Notion', plane: 'INTEGRATION',
        executionPath: 'DIRECT_API', capabilities: ['READ'], declaredNotSupported: ['TRIGGER'],
        health: 'HEALTHY', staleness: { state: 'FRESH', ageMinutes: 1 }, authStatus: 'AUTHENTICATED',
        authentication: { state: 'AUTHENTICATED', observedAt: 'T', plain: 'SECRET-AUTH-TEXT' },
        lastVerified: { state: 'FRESH', observedAt: 'T', latestProbe: { outcome: 'SUCCESS' }, plain: 'SECRET-PROBE-TEXT' },
        lastUsedByRun: { state: 'USED', runId: 'RUN-A', observedAt: 'T', operationId: 'op',
          citedSource: 'https://example.test/page?token=SECRET#private', ledgerConfirmed: true,
          ledgerEntryId: 'SECRET-LEDGER-ID', source: 'SECRET-LEDGER-SOURCE',
          claim: { runId: 'RUN-A', privatePageContents: 'must not travel' }, plain: 'SECRET-USAGE-TEXT' },
        evidence: { observedAt: 'T', method: 'MCP', result: 'PRIVATE PAGE CONTENT MUST NOT TRAVEL' },
        authorityNote: 'SECRET-AUTHORITY-NOTE', source: 'SECRET-REGISTRY-PATH',
      }] } },
  });
  const c = min.integration.connectors.connectors[0];
  assert.strictEqual(min.integration.connectors.state, 'OK');
  assert.strictEqual(c.lastUsedByRun.citedSource, 'https://example.test/page', 'query-bearing citations must be stripped');
  assert.deepStrictEqual(c.lastUsedByRun.claim, { runId: 'RUN-A' }, 'only the claimed run id may cross the boundary');
  assert.deepStrictEqual(Object.keys(c).sort(),
    ['authStatus', 'executionPath', 'health', 'label', 'lastUsedByRun', 'legacy', 'provider', 'staleness'].sort());
  assert.deepStrictEqual(Object.keys(c.lastUsedByRun).sort(),
    ['citedSource', 'claim', 'ledgerConfirmed', 'observedAt', 'runId', 'state'].sort());
  const publicJson = JSON.stringify(min);
  for (const forbidden of ['SECRET', 'PRIVATE PAGE CONTENT', 'authentication', 'lastVerified', 'authorityNote', 'ledgerEntryId', 'operationId']) {
    assert.ok(!publicJson.includes(forbidden), `public connector projection leaked ${forbidden}`);
  }
});

test('switchboard: status bootstrap and SSE event stream are wired same-origin', () => {
  const html = dashboardHtml();
  assert.ok(/fetch\(\s*['"]\/api\/status['"]/.test(html), 'no /api/status bootstrap fetch');
  assert.ok(/new EventSource\(\s*['"]\/api\/events['"]/.test(html), 'no EventSource(\'/api/events\') wiring');
  assert.ok(/credentials:\s*['"]same-origin['"]/.test(html), 'fetch calls must carry same-origin credentials for the cookie session');
});

test('RED: no dangerous free-text intake field is present', () => {
  const html = dashboardHtml();
  for (const bad of ['name="command"', 'name="shell"', 'name="model"', 'name="provider"',
                     'name="path"', 'name="token"', 'name="secret"', 'name="verdict"']) {
    assert.ok(!html.includes(bad), `dangerous field ${bad} must not exist in the intake form`);
  }
});

test('RED: the browser cannot select the governed builder executable, provider, model or permission mode', () => {
  assert.deepStrictEqual(S.GOVERNED_BUILDER, {
    timeoutSec: 900,
  });
  assert.ok(Object.isFrozen(S.GOVERNED_BUILDER), 'the governed builder specification is mutable');
  const run = { runId: 'RUN-20260826-5afe0001', objective: "build it'; touch /tmp/SHOULD_NOT_RUN; echo '",
    constraints: ['Edit only packet-authorized files'], acceptanceCriteria: ['Focused checks pass'],
    packet: S.SWITCHBOARD_PACKET, route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' } };
  const governed = S.buildGovernedLaunchSpec(run, undefined, validatedSwitchboardPacket());
  assert.deepStrictEqual(Object.keys(governed).sort(), ['model', 'prompt', 'provider', 'timeoutSec']);
  assert.strictEqual(governed.provider, 'claude-subscription');
  assert.strictEqual(governed.model, 'opus');
  assert.strictEqual(governed.timeoutSec, 900);
  assert.ok(governed.prompt.includes(run.objective), 'the objective must remain prompt data');
  assert.match(governed.prompt, /Canonical run constraints JSON: \["Edit only packet-authorized files"\]/);
  assert.match(governed.prompt, /Canonical acceptance criteria JSON: \["Focused checks pass"\]/);
  assert.match(governed.prompt, /Canonical packet constraints JSON:/);
  assert.match(governed.prompt, /Use the authorized Edit or Write tools to apply the smallest correct change/,
    'the headless builder was not explicitly required to apply its change');
  assert.match(governed.prompt, /never describe a no-write response as a completed build/,
    'the headless builder can silently degrade into a patch advisor');
  for (const forbidden of ['command', 'executable', 'permissionMode', 'shell']) {
    assert.ok(!(forbidden in governed), `${forbidden} crossed the server-created launch boundary`);
  }
});

test('the current canonical route is the sole provider/model authority and policy changes propagate', () => {
  const policy = S.loadModelRoutingPolicy();
  const run = { runId: 'RUN-20260826-5afe0002', objective: 'bounded task', constraints: [], acceptanceCriteria: [],
    packet: S.SWITCHBOARD_PACKET,
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' } };
  assert.deepStrictEqual(S.canonicalWorkerRoute(run, policy),
    { provider: 'claude-subscription', model: 'opus' });
  const changed = JSON.parse(JSON.stringify(policy));
  changed.models.claude.workerRoute.model = 'sonnet';
  const governed = S.buildGovernedLaunchSpec(run, changed, validatedSwitchboardPacket());
  assert.strictEqual(governed.model, 'sonnet',
    'a canonical policy model change required an edit to hosting/server.cjs');
});

test('RED: missing, stale, unsupported and caller-augmented routes fail closed', () => {
  const policy = S.loadModelRoutingPolicy();
  const base = { runId: 'RUN-20260826-5afe0003', objective: 'bounded task', constraints: [], acceptanceCriteria: [],
    packet: S.SWITCHBOARD_PACKET };
  const canonical = { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' };
  const cases = [
    [{ ...base }, 'ROUTE_MISSING'],
    [{ ...base, route: { ...canonical, model: 'old-model' } }, 'ROUTE_STALE'],
    [{ ...base, route: { ...canonical, execution: 'METERED' } }, 'ROUTE_STALE'],
    [{ ...base, route: { ...canonical, source: 'caller' } }, 'ROUTE_MISMATCH'],
    [{ ...base, route: { ...canonical, provider: 'caller-selected' } }, 'ROUTE_MISMATCH'],
  ];
  for (const [run, code] of cases) {
    assert.throws(() => S.buildGovernedLaunchSpec(run, policy, validatedSwitchboardPacket()),
      (error) => error && error.code === code, `${code} did not fail closed`);
  }
  const unsupported = JSON.parse(JSON.stringify(policy));
  unsupported.models.claude.workerRoute.model = 'not-supported';
  assert.throws(() => S.buildGovernedLaunchSpec(
    { ...base, route: canonical }, unsupported, validatedSwitchboardPacket()),
    (error) => error && error.code === 'ROUTE_UNSUPPORTED');

  for (const malformed of [
    { ...base, constraints: 'not-an-array', route: canonical },
    { ...base, constraints: [' leading'], route: canonical },
    { ...base, acceptanceCriteria: [42], route: canonical },
    { ...base, acceptanceCriteria: ['x'.repeat(501)], route: canonical },
  ]) {
    assert.throws(() => S.buildGovernedLaunchSpec(malformed, policy, validatedSwitchboardPacket()),
      (error) => error && error.code === 'INVALID_RUN');
  }
});

test('RED: launch composition refuses to reopen or substitute for the validated packet generation', () => {
  const run = {
    runId: 'RUN-20260826-5afe0004', objective: 'bounded task', constraints: [], acceptanceCriteria: [],
    packet: S.SWITCHBOARD_PACKET,
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
  };
  assert.throws(() => S.buildGovernedLaunchSpec(run),
    (error) => error && error.code === 'INVALID_PACKET');
  const valid = validatedSwitchboardPacket();
  assert.throws(() => S.buildGovernedLaunchSpec(run, undefined,
    { ...valid, sha256: '0'.repeat(64), packetId: 'PKT-SUBSTITUTED' }),
  (error) => error && error.code === 'INVALID_PACKET');
});

test('RED: the only Start composition seam is the trusted low-level worker launcher', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  const start = source.slice(source.indexOf('function startGovernedRun'),
    source.indexOf('// ── authenticated SSE event stream', source.indexOf('function startGovernedRun')));
  assert.match(start, /AegisRun\.startGovernedWorker\(/,
    'server Start bypassed the canonical prepare and routing authority');
  assert.match(start, /launchWorker/,
    'host tests have no seam below canonical prepare/routing for a bounded process launcher');
  assert.doesNotMatch(start, /authority\.startGovernedWorker/,
    'an injected object can replace canonical Start authority');
});

test('RED: server Start never composes public prepareRun plus public startWorker', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  const start = source.slice(source.indexOf('function startGovernedRun'),
    source.indexOf('// ── authenticated SSE event stream', source.indexOf('function startGovernedRun')));
  assert.match(start, /startGovernedWorker\(/,
    'server Start must delegate to the canonical atomic start authority');
  assert.doesNotMatch(start, /\.prepareRun\(|\.startWorker\(/,
    'server Start split preparation and launch across reentrant public calls');
});

test('RED: the public worker projection is an exact lifecycle allowlist with no raw model output', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK', runs: [{
      runId: 'RUN-A', state: 'BUILDING', objective: 'o',
      build: {
        mode: 'async', workerState: 'RUNNING', workerPid: 123,
        startedAt: '2026-08-27T15:00:00.000Z', heartbeatAt: '2026-08-27T15:00:01.000Z',
        endedAt: '2026-08-27T15:00:02.000Z', exit: 23, timedOut: false,
        stdoutTail: HOSTILE_WORKER_OUTPUT.source + '\n' + HOSTILE_WORKER_OUTPUT.pem,
        stderrTail: HOSTILE_WORKER_OUTPUT.jwt + '\n' + HOSTILE_WORKER_OUTPUT.cookie,
        rawOutput: HOSTILE_WORKER_OUTPUT.unlabelled,
        modelOutput: HOSTILE_WORKER_OUTPUT.source,
        transcript: HOSTILE_WORKER_OUTPUT.pem,
        recovery: { reason: HOSTILE_WORKER_OUTPUT.unlabelled, retrySafe: false },
      },
    }] },
  });
  const worker = min.runs[0].build;
  assert.deepStrictEqual(Object.keys(worker).sort(),
    ['activity', 'cancelAvailable', 'endedAt', 'exit', 'failover', 'failure', 'heartbeatAt', 'mode',
      'recoveryCode', 'retrySafe', 'startedAt', 'status', 'timedOut', 'workerPid'].sort());
  assert.strictEqual(worker.status, 'RUNNING');
  assert.strictEqual(worker.cancelAvailable, false,
    'RUNNING plus PID must not imply authenticated cancellation authority');
  assert.strictEqual(worker.workerPid, 123);
  assert.strictEqual(worker.heartbeatAt, '2026-08-27T15:00:01.000Z');
  assert.strictEqual(worker.exit, 23);
  assert.deepStrictEqual(worker.activity,
    { code: 'TERMINAL_STATE_MISMATCH', phase: 'BLOCKED', active: false,
      summary: 'Terminal builder exit 23 conflicts with an active lifecycle claim' });
  assert.strictEqual(worker.recoveryCode, null, 'arbitrary recovery text crossed the public allowlist');
  assertNoHostileWorkerOutput(worker, 'unit worker projection');
});

test('RED: public cancelAvailable is true only for the canonical authenticated RUNNING capability', () => {
  const build = {
    mode: 'async', workerState: 'RUNNING', workerPid: 123,
    cancelAvailable: true,
  };
  const available = S.minimizeWorker(build, 'BUILDING');
  assert.strictEqual(available.cancelAvailable, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(available, 'control'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(available, 'childProcessIdentity'), false);
  for (const [label, candidate, state] of [
    ['launch claim', { ...build, workerState: 'LAUNCH_CLAIMED' }, 'BUILDING'],
    ['starting', { ...build, workerState: 'STARTING' }, 'BUILDING'],
    ['capability absent', { ...build, cancelAvailable: false }, 'BUILDING'],
    ['terminal exit', { ...build, exit: 0 }, 'BUILDING'],
    ['wrong lifecycle', build, 'BUILT'],
  ]) assert.strictEqual(S.minimizeWorker(candidate, state).cancelAvailable, false, label);
});

test('MODEL_AUTH_FAILURE and non-executable Grok failover cross the public status allowlist without raw output', () => {
  const worker = S.minimizeWorker({
    mode: 'async', workerState: 'FAILED', exit: 1,
    recovery: { reason: 'MODEL_AUTH_FAILURE', retrySafe: false },
    failure: { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
      summary: 'Claude authentication failed.' },
    failover: { state: 'NOT_EXECUTABLE', provider: 'grok-subscription', model: 'grok-4.6',
      reason: 'Grok is the next eligible builder, but automatic failover is not enabled for this beta.' },
    stdoutTail: 'must not cross', stderrTail: 'must not cross',
  }, 'BUILD_FAILED');
  assert.deepStrictEqual(worker.failure, {
    code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription', summary: 'Claude authentication failed.',
  });
  assert.deepStrictEqual(worker.failover, {
    state: 'NOT_EXECUTABLE', provider: 'grok-subscription', model: 'grok-4.6',
    reason: 'Grok is the next eligible builder, but automatic failover is not enabled for this beta.',
  });
  assert.deepStrictEqual(worker.activity, {
    code: 'MODEL_AUTH_FAILURE', phase: 'BLOCKED', active: false,
    summary: 'Claude authentication failed',
  });
  assert.strictEqual(worker.recoveryCode, 'MODEL_AUTH_FAILURE');
  assert.strictEqual(worker.retrySafe, false);
  assert.ok(!JSON.stringify(worker).includes('must not cross'));

  const augmented = S.minimizeWorker({
    mode: 'async', workerState: 'FAILED', exit: 1,
    recovery: { reason: 'MODEL_AUTH_FAILURE', retrySafe: false },
    failure: { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
      summary: 'Claude authentication failed.', raw: 'forged' },
  }, 'BUILD_FAILED');
  assert.strictEqual(augmented.failure, null, 'caller-augmented auth failure crossed the closed vocabulary');
  assert.notStrictEqual(augmented.activity.code, 'MODEL_AUTH_FAILURE');
});

test('a successful async worker stays completed while later governed stages execute', () => {
  const build = { mode: 'async', workerState: 'EXITED', exit: 0,
    endedAt: '2026-08-30T12:00:00.000Z' };
  for (const state of ['BUILT', 'CHECKS_PASSED', 'REVIEW_BOUND', 'REVIEW_FAILED',
                       'CORRECTING', 'CHECKS_FAILED', 'CHECKPOINTED', 'ROLLED_BACK', 'ABANDONED']) {
    const worker = S.minimizeWorker(build, state);
    assert.deepStrictEqual(worker.activity, {
      code: 'EXITED', phase: 'SUCCEEDED', active: false,
      summary: 'Builder finished successfully',
    }, `${state} rewrote a successful builder exit as a stopped/failed build`);
  }
});

test('RED: the public run projection carries canonical route identity and no route extras', () => {
  const canonical = { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' };
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK', runs: [{
      runId: 'RUN-ROUTE', state: 'BUILDING', objective: 'o', route: canonical,
      build: { mode: 'async', workerState: 'RUNNING' },
    }] },
  });
  assert.deepStrictEqual(min.runs[0].route, canonical);

  const augmented = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    runs: { state: 'OK', runs: [{
      runId: 'RUN-ROUTE', state: 'BUILDING', objective: 'o',
      route: { ...canonical, modelOverride: 'caller-selected' },
      build: { mode: 'async', workerState: 'RUNNING' },
    }] },
  });
  assert.strictEqual(augmented.runs[0].route, null, 'caller route extras were published');
});

test('RED: unknown lifecycle values and malformed public fields fail closed', () => {
  const worker = S.minimizeWorker({
    mode: 'async',
    workerState: HOSTILE_WORKER_OUTPUT.unlabelled,
    workerPid: -1,
    startedAt: HOSTILE_WORKER_OUTPUT.source,
    heartbeatAt: '2026-08-27T15:00:01+00:00',
    endedAt: HOSTILE_WORKER_OUTPUT.pem,
    exit: HOSTILE_WORKER_OUTPUT.jwt,
    timedOut: 'yes',
    stdoutTail: HOSTILE_WORKER_OUTPUT.source,
    stderrTail: HOSTILE_WORKER_OUTPUT.pem,
    recovery: { reason: HOSTILE_WORKER_OUTPUT.unlabelled, retrySafe: 'yes' },
  }, 'BUILDING');
  assert.strictEqual(worker.status, 'UNKNOWN');
  assert.strictEqual(worker.workerPid, null);
  assert.strictEqual(worker.startedAt, null);
  assert.strictEqual(worker.heartbeatAt, null);
  assert.strictEqual(worker.endedAt, null);
  assert.strictEqual(worker.exit, null);
  assert.strictEqual(worker.timedOut, false);
  assert.strictEqual(worker.retrySafe, false);
  assert.strictEqual(worker.recoveryCode, null);
  assert.deepStrictEqual(worker.activity,
    { code: 'UNKNOWN', phase: 'UNKNOWN', active: false, summary: 'Builder activity is unverified' });
  assertNoHostileWorkerOutput(worker, 'fail-closed worker projection');

  const mismatch = S.minimizeWorker({ mode: 'async', workerState: 'STARTING', workerPid: 12 }, 'BUILD_FAILED');
  assert.deepStrictEqual(mismatch.activity,
    { code: 'STATE_MISMATCH', phase: 'BLOCKED', active: false,
      summary: 'Worker reports running outside an active build' });
});

test('RED: status reads never invoke worker reconciliation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  const statusSource = source.slice(source.indexOf('function buildApiStatus'), source.indexOf('function buildGovernedLaunchSpec'));
  assert.ok(statusSource.length > 0, 'buildApiStatus source boundary was not found');
  assert.ok(!/reconcileWorkerRun|reconcileBuildingRuns|startRunReconciler/.test(statusSource),
    'a status read must not mutate lifecycle state through reconciliation');
  assert.ok(!/AegisRun\.loadRun|hydrateWorkerEvidence/.test(statusSource),
    'status must not reopen mutable run files after the immutable AegisState snapshot');
});

test('RED: failed bootstrap and unverified termination never project as running activity', () => {
  for (const [workerState, expected, exit, terminationVerified] of [
    ['BOOTSTRAP_FAILED', 'Builder failed during startup', null, null],
    ['SPAWN_FAILED', 'Builder failed before its process started', null, null],
    ['TERMINATION_UNVERIFIED', 'Termination could not be verified; retry is blocked', 124, false],
    ['ORPHANED', 'Worker supervisor exited unexpectedly; builder termination is unverified and retry is blocked', 127, false],
  ]) {
    const worker = S.minimizeWorker({ mode: 'async', workerState, exit,
      recovery: { reason: workerState, retrySafe: false, terminationVerified } }, 'BUILD_FAILED');
    assert.strictEqual(worker.status, workerState);
    assert.strictEqual(worker.activity.summary, expected);
    assert.strictEqual(worker.retrySafe, false);
    assert.strictEqual(worker.recoveryCode,
      ['TERMINATION_UNVERIFIED', 'ORPHANED'].includes(workerState) ? workerState : null,
      'only canonical unsafe-recovery codes may cross the public boundary');
    assert.ok(!/Builder is running/.test(worker.activity.summary),
      `${workerState} was falsely projected as active execution`);
    if (terminationVerified === false) {
      assert.strictEqual(worker.activity.phase, 'BLOCKED');
      assert.notStrictEqual(worker.activity.phase, 'STOPPED',
        `${workerState} converted an unverified descendant into a stopped process`);
    }
  }

  const inferred = S.minimizeWorker({
    mode: 'async', workerState: 'FAILED', exit: 124,
    recovery: { reason: 'TERMINATION_UNVERIFIED', retrySafe: false, terminationVerified: false },
  }, 'BUILD_FAILED');
  assert.deepStrictEqual(inferred.activity, {
    code: 'TERMINATION_UNVERIFIED', phase: 'BLOCKED', active: false,
    summary: 'Termination could not be verified; retry is blocked',
  }, 'the canonical recovery signal did not outrank generic FAILED plus a numeric exit');
});

test('RED: no innerHTML assignment anywhere in the dashboard', () => {
  const html = dashboardHtml();
  assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML must never be used to render API-sourced data; use textContent/DOM APIs');
});

test('switchboard: the live worker boundary and honest Pause limitation are visible', () => {
  const html = dashboardHtml();
  assert.ok(/Start launches one governed asynchronous Claude worker/.test(html) && /isolated worktree/.test(html),
    'the operational async Start boundary must be visible');
  assert.ok(!/does not\s*\n?\s*yet launch an asynchronous builder/.test(html),
    'the retired Start-prepares-worktree-only claim must not survive');
  assert.ok(/Pause is unavailable/.test(html), 'the pause-unavailable limitation must be visible');
});

test('RED: n8n is never referenced anywhere in the dashboard', () => {
  assert.ok(!/n8n/i.test(dashboardHtml()), 'n8n must not appear in the active dashboard');
});

test('dashboard-owned script blocks are syntactically valid JavaScript', () => {
  const html = dashboardHtml();
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 2, 'expected the static renderer and the switchboard control-layer script blocks');
  for (const [i, body] of blocks.entries()) {
    assert.doesNotThrow(() => new Function(body), `script block ${i} is not syntactically valid: see thrown error`);
  }
});

// ── live probes ─────────────────────────────────────────────────────────────
function get(port, path_, headers = {}) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: path_, headers }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', () => resolve({ status: 0 }));
  });
}

(async () => {
  await atest('hosting reconciler runs immediately, repeats on a bounded interval, and clears on close', async () => {
    const server = new EventEmitter();
    let passes = 0;
    const authority = { reconcileBuildingRuns() { passes += 1; } };
    const reconciler = S.startRunReconciler(server, authority, 20);
    assert.strictEqual(passes, 1, 'the orphan scan must run before the interval');
    await new Promise((resolve) => setTimeout(resolve, 55));
    assert.ok(passes >= 2, 'the bounded interval never ran');
    server.emit('close');
    const stoppedAt = passes;
    await new Promise((resolve) => setTimeout(resolve, 55));
    assert.strictEqual(passes, stoppedAt, 'the reconciliation timer leaked after server close');
    reconciler.stop();
  });

  // Generate and serve the projection entirely from a disposable dashboard
  // root. A host test must never rewrite the operator's canonical state.js.
  const servedRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-hosting-projection-'));
  const servedStatePath = path.join(servedRoot, 'state.js');
  fs.copyFileSync(path.join(__dirname, '..', 'dashboard', 'index.html'), path.join(servedRoot, 'index.html'));
  const generatedState = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'aegis-state.cjs'), '--out', servedStatePath],
    { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8' });
  assert.strictEqual(generatedState.status, 0,
    `canonical served state generation failed: ${generatedState.stderr || generatedState.stdout}`);
  const expectedServedState = fs.readFileSync(servedStatePath);

  const v = S.validateConfig({ port: HOSTING_TEST_PORT, host: '127.0.0.1', token: TOKEN }, {});
  const srv = http.createServer(S.handler(v.config, { dashboardRoot: servedRoot }));
  await new Promise((r) => srv.listen(HOSTING_TEST_PORT, '127.0.0.1', r));

  await atest('RED: a request with no token is 401', async () => {
    const r = await get(HOSTING_TEST_PORT, '/');
    assert.strictEqual(r.status, 401);
  });

  await atest('RED: a wrong token is 401', async () => {
    const r = await get(HOSTING_TEST_PORT, '/', { authorization: 'Bearer ' + 'x'.repeat(40) });
    assert.strictEqual(r.status, 401);
  });

  await atest('a valid token reaches the generated projection', async () => {
    const r = await get(HOSTING_TEST_PORT, '/', { authorization: 'Bearer ' + TOKEN });
    assert.strictEqual(r.status, 200, `got ${r.status}`);
  });

  await atest('the authenticated state.js response is the exact canonical generated artifact', async () => {
    const r = await get(HOSTING_TEST_PORT, '/state.js', { authorization: 'Bearer ' + TOKEN });
    assert.strictEqual(r.status, 200, r.body);
    assert.deepStrictEqual(Buffer.from(r.body), expectedServedState,
      'the host served bytes other than the canonical generated state artifact');
    assert.match(r.body, /^\/\* Generated by builder-control\/aegis-state\.cjs/);
    assert.match(r.body, /window\.AEGIS_STATE\s*=/);
  });

  await atest('RED: an authenticated request still cannot reach the ledger', async () => {
    const r = await get(HOSTING_TEST_PORT, '/ledger.json', { authorization: 'Bearer ' + TOKEN });
    assert.strictEqual(r.status, 403, 'authentication must not grant data access beyond the projection');
  });

  await atest('RED: an authenticated request cannot reach raw reviewer transcripts', async () => {
    const r = await get(HOSTING_TEST_PORT, '/review-raw/x.txt', { authorization: 'Bearer ' + TOKEN });
    assert.strictEqual(r.status, 403);
  });

  await atest('RED: writes are refused — this host is read-only', async () => {
    const r = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: HOSTING_TEST_PORT, path: '/', method: 'POST',
        headers: { authorization: 'Bearer ' + TOKEN } }, (res) => resolve({ status: res.statusCode }));
      req.on('error', () => resolve({ status: 0 })); req.end();
    });
    assert.strictEqual(r.status, 405);
  });

  await atest('security headers are present on a served response', async () => {
    const r = await get(HOSTING_TEST_PORT, '/state.js', { authorization: 'Bearer ' + TOKEN });
    if (r.status === 200) {
      assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.ok(/frame-ancestors 'none'/.test(r.headers['content-security-policy']));
    }
  });

  await new Promise((resolve) => srv.close(resolve));
  fs.rmSync(servedRoot, { recursive: true, force: true });
  await runApiSuite();
  const failed = process.exitCode ? 'at least 1' : '0';
  console.log(`${passed} passed, 0 skipped, ${failed} failed.`);
})();

// ── live child-process API suite ────────────────────────────────────────────
// A dedicated child process, started with a temp AEGIS_RUNS_DIR/
// AEGIS_CHECKPOINTS_DIR/AEGIS_LEDGER_FILE BEFORE it ever requires
// server.cjs/aegis-run.cjs, so nothing here touches the real runs/ or
// ledger.json. The child's own module cache is therefore the only place the
// temp env applies — the correct isolation, since resolveDir() reads
// process.env once at require time.
function post(port, path_, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(body);
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (data) h['content-length'] = data.length;
    const req = http.request(
      { host: '127.0.0.1', port, path: path_, method: 'POST', headers: h },
      (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
      }
    );
    req.on('error', () => resolve({ status: 0 }));
    if (data) req.write(data);
    req.end();
  });
}
function apiGet(port, path_, headers = {}) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: path_, headers }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', () => resolve({ status: 0 }));
  });
}

function processGroupAlive(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return false;
  try { process.kill(-processGroupId, 0); return true; }
  catch (error) { return error && error.code === 'EPERM'; }
}

function waitForChildClose(child, timeoutMs = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API driver did not close within its bounded deadline')), timeoutMs);
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

// Opens an SSE connection and resolves once the first chunk of the body has
// arrived, then destroys the socket. Good enough for header/initial-event
// assertions that don't need the connection to stay open.
function sseFirstChunk(port, path_, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: path_, headers }, (res) => {
      let done = false;
      res.on('data', (d) => {
        if (done) return;
        done = true;
        resolve({ status: res.statusCode, headers: res.headers, firstChunk: d.toString('utf8') });
        req.destroy();
      });
      res.on('end', () => {
        if (!done) { done = true; resolve({ status: res.statusCode, headers: res.headers, firstChunk: '' }); }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

// Opens a live SSE connection, splitting the byte stream on the SSE record
// separator ("\n\n") into a queue of whole records a test can pull from with
// next()/tryNext(). close() ends the request, the proof-of-cleanup test
// relies on the *server* noticing that and tearing its own timers/watcher
// down, not on anything this helper does.
function openSse(port, path_, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: path_, headers }, (res) => {
      let buf = '';
      const queue = [];
      const waiters = [];
      res.on('data', (d) => {
        buf += d.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const record = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (waiters.length) waiters.shift()(record);
          else queue.push(record);
        }
      });
      resolve({
        next(timeoutMs = 2000) {
          if (queue.length) return Promise.resolve(queue.shift());
          return new Promise((res2, rej2) => {
            const to = setTimeout(() => rej2(new Error('timed out waiting for an SSE record')), timeoutMs);
            waiters.push((record) => { clearTimeout(to); res2(record); });
          });
        },
        tryNext(timeoutMs = 400) {
          if (queue.length) return Promise.resolve(queue.shift());
          return new Promise((res2) => {
            const to = setTimeout(() => res2(null), timeoutMs);
            waiters.push((record) => { clearTimeout(to); res2(record); });
          });
        },
        close() { req.destroy(); },
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

async function runApiSuite() {
  const PORT = HOSTING_API_TEST_PORT;
  const API_TOKEN = 'api-test-token-' + crypto.randomBytes(16).toString('hex');
  const ORIGIN = `http://127.0.0.1:${PORT}`;

  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-hosting-api-'));
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  const ledger = path.join(TMP, 'ledger.json');
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fixtureRepo = path.join(TMP, 'repo');
  const cloned = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', repoRoot, fixtureRepo], {
    encoding: 'utf8', shell: false,
  });
  assert.strictEqual(cloned.status, 0, `disposable hosting fixture clone failed: ${cloned.stderr}`);
  const workingPatch = spawnSync('git', ['diff', '--binary', 'HEAD', '--', 'builder-control'], {
    cwd: repoRoot, encoding: null, shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  assert.strictEqual(workingPatch.status, 0, `hosting fixture diff failed: ${workingPatch.stderr}`);
  if (workingPatch.stdout.length) {
    const applied = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], {
      cwd: fixtureRepo, input: workingPatch.stdout, encoding: 'utf8', shell: false,
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.strictEqual(applied.status, 0, `disposable hosting fixture patch failed: ${applied.stderr}`);
  }
  const packetId = `PKT-HOSTING-CHECKS-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const checksPacket = path.join(fixtureRepo, 'builder-control', 'packets', `${packetId}.json`);
  const baseCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: fixtureRepo, encoding: 'utf8', shell: false,
  }).stdout.trim();
  assert.match(baseCommit, /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/,
    'hosting check fixture requires a canonical base commit');
  const runWorktree = path.join(TMP, 'run-worktree');
  const branch = `hosting-fixture-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  const worktreeAdded = spawnSync('git', ['worktree', 'add', '--quiet', '-b', branch, runWorktree, baseCommit], {
    cwd: fixtureRepo, encoding: 'utf8', shell: false,
  });
  assert.strictEqual(worktreeAdded.status, 0,
    `disposable governed worktree creation failed: ${worktreeAdded.stderr}`);
  fs.appendFileSync(path.join(runWorktree, 'builder-control', 'hosting', 'server.cjs'),
    '\n// disposable hosting fixture subject\n');
  fs.writeFileSync(checksPacket, JSON.stringify({
    packetId,
    sourceOfTruth: ['builder-control/hosting/server.cjs'],
    filesAllowed: ['builder-control/hosting/server.cjs'],
    testsRequired: ['node --check builder-control/hosting/server.cjs'],
  }));

  const serverPath = path.join(fixtureRepo, 'builder-control', 'hosting', 'server.cjs');
  const routeCallsFile = path.join(TMP, 'control-route-calls.jsonl');
  const driver = `
    process.env.AEGIS_RUNS_DIR = ${JSON.stringify(runsDir)};
    process.env.AEGIS_CHECKPOINTS_DIR = ${JSON.stringify(cpDir)};
    process.env.AEGIS_LEDGER_FILE = ${JSON.stringify(ledger)};
    const S = require(${JSON.stringify(serverPath)});
    const AegisRun = require(${JSON.stringify(path.join(fixtureRepo, 'builder-control', 'aegis-run.cjs'))});
    const crypto = require('crypto');
    const { spawn } = require('child_process');
    const fs = require('fs');
    const http = require('http');
    const v = S.validateConfig({ port: ${PORT}, host: '127.0.0.1', token: ${JSON.stringify(API_TOKEN)} }, {});
    if (!v.ok) { console.error('CONFIG_FAIL ' + JSON.stringify(v)); process.exit(1); }
    const record = (route, runId) => fs.appendFileSync(${JSON.stringify(routeCallsFile)},
      JSON.stringify({ route, runId }) + '\\n');
    const controlAuthorities = {
      runChecks(runId) {
        record('runChecks', runId);
        return { runId, state: 'CHECKS_PASSED', action: 'checks',
          checks: { passed: 1, total: 1 }, nextAction: 'bind-review' };
      },
      bindIndependentReview(runId) {
        record('bindIndependentReview', runId);
        throw new AegisRun.AegisControlError('REVIEW-WORKTREE-INVALID',
          'review worktree failed canonical validation', 409);
      },
    };
    const launchedWorkers = [];
    const launchWorker = ({ launchSpec }) => {
      const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: ${JSON.stringify(fixtureRepo)}, env: process.env, detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      worker.unref();
      launchedWorkers.push(worker.pid);
      if (process.send) process.send({ type: 'worker-launched', processGroupId: worker.pid });
      return {
        launchSha256: crypto.createHash('sha256').update(JSON.stringify(launchSpec)).digest('hex'),
        workerPid: worker.pid, processGroupId: worker.pid,
      };
    };
    process.on('exit', () => {
      for (const pid of launchedWorkers) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    });
    const server = http.createServer(S.handler(v.config, ${
      HOST_COMPOSITION_ONLY
        ? '{ controlAuthorities, launchWorker }' : '{ launchWorker }'
    }));
    const groupAlive = (pid) => {
      try { process.kill(-pid, 0); return true; }
      catch (error) { return error && error.code === 'EPERM'; }
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const drainWorkers = async () => {
      for (const pid of launchedWorkers) { try { process.kill(-pid, 'SIGTERM'); } catch {} }
      let deadline = Date.now() + 1500;
      while (Date.now() < deadline && launchedWorkers.some(groupAlive)) await wait(25);
      for (const pid of launchedWorkers.filter(groupAlive)) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
      deadline = Date.now() + 1500;
      while (Date.now() < deadline && launchedWorkers.some(groupAlive)) await wait(25);
      return launchedWorkers.filter(groupAlive);
    };
    let shutdownStarted = false;
    process.on('message', (message) => {
      if (!message || message.type !== 'shutdown' || shutdownStarted) return;
      shutdownStarted = true;
      server.close(async () => {
        const remaining = await drainWorkers();
        if (process.send) process.send({ type: 'shutdown-complete', drained: remaining.length === 0,
          processGroups: launchedWorkers, remaining });
        process.exit(remaining.length === 0 ? 0 : 1);
      });
    });
    server.listen(${PORT}, '127.0.0.1', () => { console.log('READY'); });
  `;

  const child = spawn('node', ['-e', driver], { cwd: fixtureRepo, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const launchedWorkerGroups = new Set();
  child.on('message', (message) => {
    if (message && message.type === 'worker-launched' && Number.isInteger(message.processGroupId)) {
      launchedWorkerGroups.add(message.processGroupId);
    }
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));

  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('API child did not become ready: ' + out)), 10000);
    const check = setInterval(() => {
      if (/READY/.test(out)) { clearInterval(check); clearTimeout(to); resolve(); }
      if (child.exitCode !== null) { clearInterval(check); clearTimeout(to); reject(new Error('API child exited early: ' + out)); }
    }, 25);
  });

  try {
    await atest('API RED: unauthenticated GET /api/status is 401', async () => {
      const r = await apiGet(PORT, '/api/status');
      assert.strictEqual(r.status, 401);
    });

    await atest('API RED: unauthenticated POST /api/objective is 401', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'unauthenticated attempt' }),
      });
      assert.strictEqual(r.status, 401);
    });

    await atest('API RED: unauthenticated POST /api/checks is 401', async () => {
      const r = await post(PORT, '/api/checks', {
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-20260825-deadbeef' }),
      });
      assert.strictEqual(r.status, 401);
    });

    await atest('API RED: unauthenticated POST /api/review-bind is 401', async () => {
      const r = await post(PORT, '/api/review-bind', {
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-20260825-deadbeef' }),
      });
      assert.strictEqual(r.status, 401);
    });

    let statusBody;
    await atest('authenticated GET /api/status is 200 JSON, no-store', async () => {
      const r = await apiGet(PORT, '/api/status', { authorization: 'Bearer ' + API_TOKEN });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.ok(/application\/json/.test(r.headers['content-type']));
      statusBody = r.body;
      assert.doesNotThrow(() => JSON.parse(statusBody));
    });

    await atest('API RED: /api/status leaks none of the forbidden terms', () => {
      assert.ok(statusBody, 'status body must have been captured by the previous test');
      const lower = statusBody.toLowerCase();
      for (const term of ['token', 'secret', 'review-raw', 'stdouttail', 'stderrtail', TMP.toLowerCase(), process.cwd().toLowerCase()]) {
        assert.ok(!lower.includes(term), `/api/status leaked forbidden term: ${term}`);
      }
    });

    let cookie;
    await atest('a bearer GET establishes a session cookie', async () => {
      const r = await apiGet(PORT, '/api/status', { authorization: 'Bearer ' + API_TOKEN });
      const sc = r.headers['set-cookie'];
      assert.ok(sc && sc.length, 'expected a set-cookie header on a primary-credential request');
      cookie = sc[0].split(';')[0];
    });

    await atest('API RED: cookie POST without Origin is 403', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { 'content-type': 'application/json' },
        cookie,
        body: JSON.stringify({ runId: 'RUN-does-not-exist' }),
      });
      assert.strictEqual(r.status, 403);
    });

    await atest('API RED: cookie POST with wrong Origin is 403 before the body is read', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
        cookie,
        body: 'not even json',
      });
      assert.strictEqual(r.status, 403);
    });

    await atest('a bearer POST may omit Origin entirely', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ runId: 'RUN-does-not-exist' }),
      });
      assert.notStrictEqual(r.status, 403);
    });

    await atest('API RED: a bearer POST with the wrong Origin present is still 403', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: 'http://evil.example' },
        body: JSON.stringify({ runId: 'RUN-does-not-exist' }),
      });
      assert.strictEqual(r.status, 403);
    });

    await atest('API RED: wrong content-type is 415', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'text/plain', origin: ORIGIN },
        body: JSON.stringify({ objective: 'wrong content type' }),
      });
      assert.strictEqual(r.status, 415);
    });

    await atest('API RED: malformed JSON is 400', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: '{not valid json',
      });
      assert.strictEqual(r.status, 400);
    });

    await atest('API RED: a body over 16 KiB returns an actual 413 response', async () => {
      const big = JSON.stringify({ objective: 'x'.repeat(20 * 1024) });
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: big,
      });
      assert.strictEqual(r.status, 413, `expected 413, got ${r.status} (0 means the connection was reset, not answered)`);
    });

    await atest('API RED: an objective with an unknown key is rejected', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'has an unknown field', packet: 'evil.json' }),
      });
      assert.strictEqual(r.status, 400);
    });

    await atest('ordinary objective content is not mistaken for browser control authority', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'legit objective text', project: 'shell' }),
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(JSON.parse(r.body).state, 'INTAKE_RECORDED');
    });

    let createdRunId;
    await atest('a valid objective creates a run and stops at INTAKE_RECORDED', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'hosting API suite isolated intake test' }),
      });
      assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.body}`);
      const parsed = JSON.parse(r.body);
      assert.strictEqual(parsed.state, 'INTAKE_RECORDED');
      assert.ok(parsed.runId, 'response must carry the created runId');
      createdRunId = parsed.runId;
      const runFile = path.join(runsDir, `${parsed.runId}.json`);
      assert.ok(fs.existsSync(runFile), 'the run must have been written to the isolated temp runs dir, not the real one');
      const recordedRun = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      assert.strictEqual(recordedRun.packet, S.SWITCHBOARD_PACKET,
        'the real authenticated objective route persisted a different packet than the server-owned beta packet');
      assert.strictEqual(recordedRun.packet,
        'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json',
        'changing SWITCHBOARD_PACKET back to the foundation packet must fail this end-to-end proof');
      const packetBytes = fs.readFileSync(path.join(fixtureRepo, recordedRun.packet));
      assert.deepStrictEqual(recordedRun.packetCoordinate, {
        path: recordedRun.packet,
        sha256: crypto.createHash('sha256').update(packetBytes).digest('hex'),
        packetId: JSON.parse(packetBytes).packetId,
      }, 'objective intake did not persist the immutable canonical packet coordinate');
      assert.ok(fs.existsSync(ledger), 'the intake transition must have been recorded to the isolated temp ledger');
    });

    await atest('dashboard intake records the server-owned automatic-check marker the browser cannot set', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'dashboard automatic check eligibility proof' }),
      });
      assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.body}`);
      const parsed = JSON.parse(r.body);
      assert.ok(!('automaticChecks' in parsed), 'the intake response must not publish the marker');
      const recorded = JSON.parse(fs.readFileSync(path.join(runsDir, `${parsed.runId}.json`), 'utf8'));
      assert.strictEqual(recorded.automaticChecks, true,
        'the authenticated objective authority must mark dashboard-created runs eligible');
      assert.strictEqual(recorded.state, 'INTAKE_RECORDED',
        'the marker must not advance the run past intake');
      assert.strictEqual(recorded.checks, null, 'the marker must not execute checks');

      // The marker is not an objective field: a browser body carrying it is
      // refused as an unknown field, in both directions.
      for (const value of [true, false]) {
        const injected = await post(PORT, '/api/objective', {
          headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ objective: 'browser marker attempt', automaticChecks: value }),
        });
        assert.strictEqual(injected.status, 400,
          `a browser-supplied automaticChecks=${value} reached intake: ${injected.body}`);
      }
    });

    await atest('authenticated Start uses canonical prepare/routing and rejects browser launch authority', async () => {
      for (const [key, value] of [
        ['command', 'rm -rf /'], ['provider', 'grok'], ['model', 'caller-model'],
        ['packet', 'builder-control/packets/other.json'],
      ]) {
        const injected = await post(PORT, '/api/start', {
          headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ runId: createdRunId, [key]: value }),
        });
        assert.strictEqual(injected.status, 400, `${key} reached Start authority: ${injected.body}`);
      }
      const started = await post(PORT, '/api/start', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: createdRunId }),
      });
      assert.strictEqual(started.status, 200, started.body);
      const response = JSON.parse(started.body);
      assert.strictEqual(response.state, 'BUILDING');
      assert.deepStrictEqual(response.builder, { provider: 'claude-subscription', model: 'opus' });
      const recorded = JSON.parse(fs.readFileSync(path.join(runsDir, `${createdRunId}.json`), 'utf8'));
      assert.strictEqual(recorded.state, 'BUILDING');
      assert.strictEqual(recorded.packet, S.SWITCHBOARD_PACKET);
      assert.strictEqual(recorded.route.source, 'tool-router.cjs routeRole');
    });

    await atest('dashboard Start maps missing and malformed canonical runs to stable refusals', async () => {
      const missing = await post(PORT, '/api/start', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-20260830-00000000' }),
      });
      assert.strictEqual(missing.status, 404, missing.body);
      assert.strictEqual(JSON.parse(missing.body).error.code, 'RUN_NOT_FOUND');

      const malformedRunId = 'RUN-20260830-bad0c0de';
      fs.writeFileSync(path.join(runsDir, `${malformedRunId}.json`), '{');
      const malformed = await post(PORT, '/api/start', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: malformedRunId }),
      });
      assert.strictEqual(malformed.status, 409, malformed.body);
      assert.strictEqual(JSON.parse(malformed.body).error.code, 'INVALID_RUN_RECORD');
      fs.unlinkSync(path.join(runsDir, `${malformedRunId}.json`));
    });

    await atest('dashboard Start refuses a different valid recorded packet before routing or worker launch', async () => {
      const intake = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'wrong recorded packet refusal proof' }),
      });
      assert.strictEqual(intake.status, 200, intake.body);
      const wrongRunId = JSON.parse(intake.body).runId;
      const wrongPath = path.join(runsDir, `${wrongRunId}.json`);
      const wrong = JSON.parse(fs.readFileSync(wrongPath, 'utf8'));
      wrong.packet = 'builder-control/packets/PKT-20260825-SWITCHBOARD-FOUNDATION.json';
      fs.writeFileSync(wrongPath, JSON.stringify(wrong, null, 2));
      const started = await post(PORT, '/api/start', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: wrongRunId }),
      });
      assert.strictEqual(started.status, 409, started.body);
      assert.strictEqual(JSON.parse(fs.readFileSync(wrongPath, 'utf8')).state, 'INTAKE_RECORDED');
      assert.ok(!fs.existsSync(path.join(fixtureRepo, '..', `aegis-wt-${wrongRunId}`)));
    });

    await atest('API RED: GET and HEAD cannot dispatch POST-only run controls', async () => {
      const runFile = path.join(runsDir, `${createdRunId}.json`);
      const runBefore = fs.readFileSync(runFile, 'utf8');
      const ledgerBefore = fs.readFileSync(ledger, 'utf8');
      const requestMethod = (method, route) => new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: PORT, path: route, method,
          headers: { authorization: 'Bearer ' + API_TOKEN } }, (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', () => resolve({ status: 0 }));
        req.end();
      });
      for (const method of ['GET', 'HEAD']) {
        for (const route of ['/api/start', '/api/cancel', '/api/retry', '/api/checks', '/api/review-bind']) {
          const response = await requestMethod(method, route);
          assert.strictEqual(response.status, 405, `${method} ${route} reached a POST-only dispatcher`);
        }
      }
      assert.strictEqual(fs.readFileSync(runFile, 'utf8'), runBefore,
        'a GET/HEAD control request mutated the selected run');
      assert.strictEqual(fs.readFileSync(ledger, 'utf8'), ledgerBefore,
        'a GET/HEAD control request wrote a lifecycle event');
    });

    await atest('API RED: a runId route rejects an extra key', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-does-not-exist', force: true }),
      });
      assert.strictEqual(r.status, 400);
    });

    await atest('authenticated POST /api/cancel accepts only runId and records the canonical ABANDONED transition', async () => {
      const intake = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'cancel API boundary proof' }),
      });
      assert.strictEqual(intake.status, 200, intake.body);
      const cancelRunId = JSON.parse(intake.body).runId;
      const injected = await post(PORT, '/api/cancel', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: cancelRunId, signal: 'SIGKILL' }),
      });
      assert.strictEqual(injected.status, 400, injected.body);
      const cancelled = await post(PORT, '/api/cancel', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: cancelRunId }),
      });
      assert.strictEqual(cancelled.status, 200, cancelled.body);
      assert.deepStrictEqual(JSON.parse(cancelled.body), {
        runId: cancelRunId, state: 'ABANDONED', action: 'cancel', nextAction: 'none',
      });
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(runsDir, `${cancelRunId}.json`), 'utf8')).state,
        'ABANDONED', 'the API response did not correspond to the canonical persisted transition');
    });

    await atest('authenticated POST /api/cancel fails closed for BUILDING without authenticated worker ownership', async () => {
      const intake = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'building cancellation ownership proof' }),
      });
      assert.strictEqual(intake.status, 200, intake.body);
      const buildingRunId = JSON.parse(intake.body).runId;
      const runFile = path.join(runsDir, `${buildingRunId}.json`);
      const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      run.state = 'BUILDING';
      run.build = { mode: 'async', workerPid: child.pid, workerState: 'RUNNING', attemptId: 'attempt-1' };
      fs.writeFileSync(runFile, JSON.stringify(run));
      const refused = await post(PORT, '/api/cancel', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: buildingRunId }),
      });
      assert.strictEqual(refused.status, 409, refused.body);
      assert.strictEqual(JSON.parse(refused.body).error.code, 'CONTROL_UNAVAILABLE');
      assert.strictEqual(JSON.parse(fs.readFileSync(runFile, 'utf8')).state, 'BUILDING',
        'a refused BUILDING cancellation advanced the lifecycle');
    });

    await atest('API RED: /api/checks refuses browser-supplied command/model/provider fields', async () => {
      for (const key of ['command', 'model', 'provider']) {
        const r = await post(PORT, '/api/checks', {
          headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ runId: createdRunId, [key]: 'caller-controlled' }),
        });
        assert.strictEqual(r.status, 400, `${key} was not refused: ${r.body}`);
        assert.strictEqual(JSON.parse(r.body).error.code, 'INVALID_REQUEST');
      }
    });

    if (INHERITED_IMMUTABLE_SNAPSHOT && !HOST_ONLY) test(
      'immutable snapshot defers nested state-mutating /api/checks proof to the top-level hosting suite', () => {
        assert.strictEqual(process.env.AEGIS_CHECK_SNAPSHOT_POLICY,
          'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1');
      });
    else if (HOST_COMPOSITION_ONLY) await atest(
      'host composition: authenticated POST /api/checks routes only the exact runId and returns a minimized result', async () => {
      const runFile = path.join(runsDir, `${createdRunId}.json`);
      const seeded = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      seeded.state = 'BUILT';
      seeded.packet = path.relative(fixtureRepo, checksPacket);
      seeded.baseCommit = baseCommit;
      seeded.worktree = { path: runWorktree, branch, baseCommit };
      fs.writeFileSync(runFile, JSON.stringify(seeded));
      const r = await post(PORT, '/api/checks', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: createdRunId }),
      });
      assert.strictEqual(r.status, 200, r.body);
      const parsed = JSON.parse(r.body);
      assert.strictEqual(parsed.state, 'CHECKS_PASSED');
      assert.deepStrictEqual(parsed.checks, { passed: 1, total: 1 });
      assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'results'));
      assert.ok(!/process\.exit|node -e/.test(r.body), 'the HTTP response leaked packet command text');
      assert.strictEqual(JSON.parse(fs.readFileSync(runFile, 'utf8')).state, 'BUILT',
        'the transport composition proof unexpectedly mutated lifecycle state');
      const calls = fs.readFileSync(routeCallsFile, 'utf8').trim().split(/\n/).map(JSON.parse);
      assert.deepStrictEqual(calls.filter((call) => call.route === 'runChecks'),
        [{ route: 'runChecks', runId: createdRunId }]);
    });
    else await atest('authenticated POST /api/checks runs the packet-bound canonical checks and returns no command text', async () => {
      const runFile = path.join(runsDir, `${createdRunId}.json`);
      const seeded = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      seeded.state = 'BUILT';
      seeded.packet = path.relative(fixtureRepo, checksPacket);
      seeded.baseCommit = baseCommit;
      seeded.worktree = { path: runWorktree, branch, baseCommit };
      fs.writeFileSync(runFile, JSON.stringify(seeded));
      const r = await post(PORT, '/api/checks', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: createdRunId }),
      });
      assert.strictEqual(r.status, 200, r.body);
      const parsed = JSON.parse(r.body);
      const persistedAfterChecks = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      assert.strictEqual(parsed.state, 'CHECKS_PASSED', JSON.stringify({
        response: parsed,
        checks: persistedAfterChecks.checks,
      }));
      assert.deepStrictEqual(parsed.checks, { passed: 1, total: 1 });
      assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'results'));
      assert.ok(!/process\.exit|node -e/.test(r.body), 'the HTTP response leaked packet command text');
    });

    await atest('API RED: /api/review-bind accepts exactly runId and refuses launch/routing injection', async () => {
      for (const key of ['command', 'model', 'provider', 'reviewer', 'verdict', 'reviewFailure']) {
        const r = await post(PORT, '/api/review-bind', {
          headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ runId: createdRunId, [key]: 'caller-controlled' }),
        });
        assert.strictEqual(r.status, 400, `${key} was not refused: ${r.body}`);
        assert.strictEqual(JSON.parse(r.body).error.code, 'INVALID_REQUEST');
      }
    });

    if (INHERITED_IMMUTABLE_SNAPSHOT && !HOST_ONLY) test(
      'immutable snapshot defers nested state-mutating /api/review-bind proof to the top-level hosting suite', () => {
        assert.strictEqual(process.env.AEGIS_CHECK_SNAPSHOT_POLICY,
          'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1');
      });
    else if (HOST_COMPOSITION_ONLY) await atest(
      'host composition: authenticated POST /api/review-bind routes only the exact runId and preserves refusal', async () => {
      const runFile = path.join(runsDir, `${createdRunId}.json`);
      const before = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      before.state = 'CHECKS_PASSED';
      fs.writeFileSync(runFile, JSON.stringify(before));
      const r = await post(PORT, '/api/review-bind', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: createdRunId }),
      });
      assert.strictEqual(r.status, 409, `expected canonical binder refusal, got ${r.status}: ${r.body}`);
      const parsed = JSON.parse(r.body);
      assert.strictEqual(parsed.error.code, 'REVIEW-WORKTREE-INVALID',
        `canonical binder code was not preserved: ${JSON.stringify(parsed)}`);
      assert.strictEqual(JSON.parse(fs.readFileSync(runFile, 'utf8')).state, 'CHECKS_PASSED',
        'a refused review bind advanced run state');
      const calls = fs.readFileSync(routeCallsFile, 'utf8').trim().split(/\n/).map(JSON.parse);
      assert.deepStrictEqual(calls.filter((call) => call.route === 'bindIndependentReview'),
        [{ route: 'bindIndependentReview', runId: createdRunId }]);
    });
    else await atest('authenticated POST /api/review-bind surfaces canonical refusal and leaves the run unchanged', async () => {
      const runFile = path.join(runsDir, `${createdRunId}.json`);
      const before = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      assert.strictEqual(before.state, 'CHECKS_PASSED', 'review refusal proof requires passed checks');
      before.packet = S.SWITCHBOARD_PACKET;
      before.worktree = { path: TMP };
      fs.writeFileSync(runFile, JSON.stringify(before));
      const r = await post(PORT, '/api/review-bind', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: createdRunId }),
      });
      assert.strictEqual(r.status, 409, `expected canonical binder refusal, got ${r.status}: ${r.body}`);
      const parsed = JSON.parse(r.body);
      assert.strictEqual(parsed.error.code, 'REVIEW-WORKTREE-INVALID',
        `canonical binder code was not preserved: ${JSON.stringify(parsed)}`);
      assert.strictEqual(JSON.parse(fs.readFileSync(runFile, 'utf8')).state, 'CHECKS_PASSED',
        'a refused review bind advanced run state');
    });

    await atest('API RED: a runId route for a nonexistent run maps to a stable 404', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-20260825-deadbeef' }),
      });
      assert.strictEqual(r.status, 404);
      const parsed = JSON.parse(r.body);
      assert.strictEqual(parsed.error.code, 'RUN_NOT_FOUND');
    });

    await atest('API RED: an unknown API path cannot mutate', async () => {
      const r = await post(PORT, '/api/does-not-exist', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-x' }),
      });
      assert.strictEqual(r.status, 405);
    });

    await atest('API RED: unauthenticated GET /api/events is 401', async () => {
      const r = await apiGet(PORT, '/api/events');
      assert.strictEqual(r.status, 401);
    });

    await atest('authenticated GET /api/events streams SSE headers and an initial event', async () => {
      const { status, headers, firstChunk } = await sseFirstChunk(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      assert.strictEqual(status, 200);
      assert.ok(/text\/event-stream/.test(headers['content-type']), `unexpected content-type: ${headers['content-type']}`);
      assert.strictEqual(headers['cache-control'], 'no-store');
      assert.strictEqual(headers['connection'], 'keep-alive');
      assert.strictEqual(headers['x-accel-buffering'], 'no');
      assert.ok(/^event: status\ndata: /.test(firstChunk), `expected an initial status event, got: ${firstChunk}`);
      const parsed = JSON.parse(firstChunk.replace(/^event: status\ndata: /, '').trim());
      assert.ok(parsed.generatedAt, 'initial event must carry a sanitized status snapshot');
    });

    await atest('API RED: SSE stream leaks none of the forbidden terms', async () => {
      const { firstChunk } = await sseFirstChunk(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      const lower = firstChunk.toLowerCase();
      for (const term of ['token', 'secret', 'review-raw', 'stdouttail', 'stderrtail', TMP.toLowerCase(), process.cwd().toLowerCase()]) {
        assert.ok(!lower.includes(term), `SSE stream leaked forbidden term: ${term}`);
      }
    });

    await atest('a ledger change produces a debounced status event, not a duplicate per write', async () => {
      const sse = await openSse(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      try {
        await sse.next(); // discard the initial event
        // Several rapid writes inside the debounce window must collapse into
        // one further event, not one per write.
        for (let i = 0; i < 5; i++) {
          fs.writeFileSync(ledger, JSON.stringify([{ tick: i }]));
          await new Promise((r) => setTimeout(r, 20));
        }
        const evt = await sse.next(2000);
        assert.ok(/^event: status\n/.test(evt), `expected a status event after the ledger changed, got: ${evt}`);
        // Give any further debounced sends a chance to land, then confirm the
        // burst collapsed rather than firing one event per write.
        const extra = await sse.tryNext(400);
        assert.strictEqual(extra, null, `debounce must collapse a write burst, got an extra event: ${extra}`);
      } finally {
        sse.close();
      }
    });

    await atest('/api/status and SSE expose structured worker lifecycle but no raw model output', async () => {
      const sse = await openSse(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      try {
        await sse.next();
        const runFile = path.join(runsDir, `${createdRunId}.json`);
        const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
        run.state = 'BUILDING';
        run.build = { mode: 'async', workerState: 'RUNNING', workerPid: child.pid,
          startedAt: '2026-08-26T20:00:00.000Z', heartbeatAt: '2026-08-26T20:00:01.000Z',
          endedAt: '2026-08-26T20:00:02.000Z', exit: 17, timedOut: false,
          stdoutTail: HOSTILE_WORKER_OUTPUT.source + '\n' + HOSTILE_WORKER_OUTPUT.pem,
          stderrTail: HOSTILE_WORKER_OUTPUT.jwt + '\n' + HOSTILE_WORKER_OUTPUT.cookie,
          rawOutput: HOSTILE_WORKER_OUTPUT.unlabelled,
          modelOutput: HOSTILE_WORKER_OUTPUT.source,
          transcript: HOSTILE_WORKER_OUTPUT.pem };
        fs.writeFileSync(runFile, JSON.stringify(run));

        const statusResponse = await apiGet(PORT, '/api/status', { authorization: 'Bearer ' + API_TOKEN });
        assert.strictEqual(statusResponse.status, 200);
        const status = JSON.parse(statusResponse.body);
        const statusRun = status.runs.find((r) => r.runId === createdRunId);
        assert.ok(statusRun && statusRun.build, 'worker lifecycle did not reach /api/status');
        assertNoHostileWorkerOutput(statusRun.build, '/api/status');
        assert.strictEqual(statusRun.build.status, 'RUNNING');
        assert.strictEqual(statusRun.build.heartbeatAt, '2026-08-26T20:00:01.000Z');
        assert.strictEqual(statusRun.build.exit, 17);
        assert.deepStrictEqual(statusRun.build.activity,
          { code: 'TERMINAL_STATE_MISMATCH', phase: 'BLOCKED', active: false,
            summary: 'Terminal builder exit 17 conflicts with an active lifecycle claim' });

        const evt = await sse.next(2000);
        const parsed = JSON.parse(evt.replace(/^event: status\ndata: /, '').trim());
        const projected = parsed.runs.find((r) => r.runId === createdRunId);
        assert.ok(projected && projected.build,
          `worker evidence did not reach the SSE projection: ${JSON.stringify(parsed.runs)}`);
        assertNoHostileWorkerOutput(projected.build, 'SSE');
        assert.strictEqual(projected.build.status, 'RUNNING');
        assert.strictEqual(projected.build.workerPid, child.pid);
        assert.strictEqual(projected.build.heartbeatAt, '2026-08-26T20:00:01.000Z');
        assert.strictEqual(projected.build.exit, 17);
        assert.deepStrictEqual(projected.build.activity,
          { code: 'TERMINAL_STATE_MISMATCH', phase: 'BLOCKED', active: false,
            summary: 'Terminal builder exit 17 conflicts with an active lifecycle claim' });
      } finally {
        sse.close();
      }
    });

    await atest('disconnecting an SSE client lets its child-owned resources go, and the child still exits', async () => {
      const sse = await openSse(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      await sse.next();
      sse.close();
      // No assertion beyond "this does not hang" — the real proof is the
      // child process exiting cleanly in the outer finally block below,
      // which would hang forever if a watcher/timer/listener leaked.
      await new Promise((r) => setTimeout(r, 100));
    });

    await atest('SERVABLE remains exactly the three-entry projection', () => {
      assert.deepStrictEqual(Object.keys(S.SERVABLE).sort(), ['/', '/index.html', '/state.js']);
    });
  } finally {
    let shutdownEvidence = null;
    let shutdownError = null;
    try {
      shutdownEvidence = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('API driver shutdown acknowledgement timed out')), 4000);
        const onMessage = (message) => {
          if (!message || message.type !== 'shutdown-complete') return;
          clearTimeout(timer); child.off('message', onMessage); resolve(message);
        };
        child.on('message', onMessage);
        child.send({ type: 'shutdown' }, (error) => {
          if (error) { clearTimeout(timer); child.off('message', onMessage); reject(error); }
        });
      });
      const closed = await waitForChildClose(child, 3000);
      assert.strictEqual(closed.code, 0, `API driver shutdown failed: ${JSON.stringify(closed)}`);
      assert.strictEqual(shutdownEvidence.drained, true, JSON.stringify(shutdownEvidence));
      assert.deepStrictEqual([...shutdownEvidence.processGroups].sort((a, b) => a - b),
        [...launchedWorkerGroups].sort((a, b) => a - b), 'shutdown omitted a launched worker group');
      assert.deepStrictEqual(shutdownEvidence.remaining, []);
      for (const processGroupId of launchedWorkerGroups) {
        assert.strictEqual(processGroupAlive(processGroupId), false,
          `detached worker group ${processGroupId} survived API fixture shutdown`);
      }
    } catch (error) {
      shutdownError = error;
      try { child.kill('SIGKILL'); } catch {}
      for (const processGroupId of launchedWorkerGroups) {
        try { process.kill(-processGroupId, 'SIGKILL'); } catch {}
      }
      try { await waitForChildClose(child, 1000); } catch {}
    } finally {
      fs.rmSync(TMP, { recursive: true, force: true });
    }
    if (shutdownError) throw shutdownError;
  }
}
