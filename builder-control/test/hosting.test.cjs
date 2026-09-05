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
  assert.ok(/only verifies and binds review evidence that already exists for this exact code version/.test(row),
    'the dashboard does not scope binding to review evidence that already exists for this exact version');
  assert.ok(/it starts no new review and pays for nothing/.test(row),
    'the dashboard could imply that binding launches or pays for a reviewer');
  assert.ok(/Requesting a review is a separate, explicit act/.test(row),
    'the dashboard does not separate binding from the explicit review request');
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
  const SEAM = ['bindIndependentReview', 'checkpointRun', 'prepareIndependentReview',
    'requestIndependentReview', 'runChecks'];
  assert.ok(Object.isFrozen(S.DEFAULT_CONTROL_AUTHORITIES));
  assert.deepStrictEqual(Object.keys(S.DEFAULT_CONTROL_AUTHORITIES).sort(), SEAM);
  assert.ok(Object.isFrozen(S.CONTROL_AUTHORITY_NAMES), 'the seam membership list must be frozen');
  assert.deepStrictEqual([...S.CONTROL_AUTHORITY_NAMES], SEAM);
  assert.throws(() => S.resolveControlAuthorities({ runChecks() {} }), /provide exactly/);
  assert.throws(() => S.resolveControlAuthorities({
    runChecks() {}, bindIndependentReview() {},
  }), /provide exactly/, 'a seam missing the preflight authority was accepted');
  assert.throws(() => S.resolveControlAuthorities({
    runChecks() {}, bindIndependentReview() {}, prepareIndependentReview() {},
  }), /provide exactly/, 'a seam missing the review-request authority was accepted');
  assert.throws(() => S.resolveControlAuthorities({
    runChecks() {}, bindIndependentReview() {}, prepareIndependentReview() {},
    requestIndependentReview() {},
  }), /provide exactly/, 'a seam missing the checkpoint authority was accepted');
  assert.throws(() => S.resolveControlAuthorities({
    runChecks() {}, bindIndependentReview() {}, prepareIndependentReview() {},
    requestIndependentReview() {}, checkpointRun() {}, startRun() {},
  }), /provide exactly/);
  const supplied = S.resolveControlAuthorities({
    runChecks() { return 'checks'; },
    bindIndependentReview() { return 'review'; },
    prepareIndependentReview() { return 'preflight'; },
    requestIndependentReview() { return 'request'; },
    checkpointRun() { return 'checkpoint'; },
  });
  assert.ok(Object.isFrozen(supplied));
  assert.deepStrictEqual(Object.keys(supplied).sort(), SEAM);
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  assert.match(serverSource, /http\.createServer\(handler\(config\)\)/,
    'production server construction must not inject alternate control authorities');
  assert.throws(() => S.resolveControlAuthorities(Object.defineProperty({
    bindIndependentReview() {}, prepareIndependentReview() {}, requestIndependentReview() {},
    checkpointRun() {},
  }, 'runChecks', { enumerable: true, get() { throw new Error('getter executed'); } })),
  /provide exactly/, 'accessor-backed control authority was accepted');
  assert.throws(() => S.resolveControlAuthorities(Object.defineProperty({
    runChecks() {}, bindIndependentReview() {}, prepareIndependentReview() {},
    requestIndependentReview() {},
  }, 'checkpointRun', { enumerable: true, get() { throw new Error('getter executed'); } })),
  /provide exactly/, 'an accessor-backed checkpoint authority was accepted');
});

// ── read-only independent-review preflight — static and unit proofs ─────────
test('the review preflight route is a named POST bound to the canonical read-only authority', () => {
  assert.strictEqual(S.API_POST_ROUTES['/api/review-preflight'], 'review-preflight',
    'hosting does not declare the canonical review-preflight route');
  assert.strictEqual(S.DEFAULT_CONTROL_AUTHORITIES.prepareIndependentReview,
    require('../aegis-run.cjs').prepareIndependentReview,
    'the production HTTP route is not pinned to canonical prepareIndependentReview');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  assert.match(serverSource,
    /pathname === '\/api\/review-preflight'\) result = reviewPreflight\(runId, controlAuthorities\)/,
    'the HTTP route is not a thin pass-through to its fixed preflight authority');
  assert.match(serverSource,
    /const runId = parseRunIdBody\(body\);/,
    'the preflight route must share the single runId-only body parser');
  // The preflight is a question. It must not be able to reach a launch, a
  // binding, a check or a run mutation from inside this route.
  const route = serverSource.slice(serverSource.indexOf('function reviewPreflight('),
    serverSource.indexOf('// ── authenticated SSE event stream'));
  for (const forbidden of ['launchWorker', 'bindIndependentReview', 'runChecks',
    'startGovernedRun', 'saveRun', 'transition', 'spawn']) {
    assert.ok(!route.includes(forbidden),
      `the preflight route reaches ${forbidden}, which is not a read-only question`);
  }
});

test('the Codex review request is one named POST pinned to the canonical callable, and nothing more', () => {
  assert.strictEqual(S.API_POST_ROUTES['/api/request-codex-review'], 'request-codex-review',
    'hosting does not declare the canonical Codex review-request route');
  assert.strictEqual(S.DEFAULT_CONTROL_AUTHORITIES.requestIndependentReview,
    require('../aegis-run.cjs').requestIndependentReview,
    'the production HTTP route is not pinned to canonical requestIndependentReview');
  assert.strictEqual(S.REVIEW_REQUEST_REVIEWER, 'codex',
    'the reviewer word must be a server constant, never a request field');
  // Grok stays a canonical reviewer. This route is Codex-only; it removes nobody.
  assert.ok(require('../aegis-run.cjs').REVIEW_REQUEST_REVIEWERS.includes('grok'),
    'this Codex-only route must not remove Grok from canonical model policy');

  const source = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  const route = source.slice(source.indexOf('async function requestCodexReview('),
    source.indexOf('async function handleApi('));
  assert.match(route, /await controlAuthorities\.requestIndependentReview\(\s*\{ runId, reviewer: REVIEW_REQUEST_REVIEWER \}\)/,
    'the route is not a single awaited pass-through with a server-fixed reviewer');
  assert.strictEqual((route.match(/requestIndependentReview\(/g) || []).length, 1,
    'the route invokes the canonical review request more than once');
  // Sequencing, leases, processes and retries all belong to the callable.
  for (const forbidden of ['acquireGlobalReviewHold', 'releaseGlobalReviewHold',
    'acquireRunLaunchClaim', 'launchWorker', 'startGovernedRun', 'runChecks',
    'bindIndependentReview', 'saveRun', 'setTimeout', 'setInterval', 'spawn']) {
    assert.ok(!route.includes(forbidden),
      `the review-request route reaches ${forbidden}, which the canonical callable owns`);
  }
});

// ── the one authenticated checkpoint route — static and unit proofs ─────────
test('the checkpoint route is one named POST pinned to the canonical checkpoint authority, and nothing more', () => {
  assert.strictEqual(S.API_POST_ROUTES['/api/checkpoint'], 'checkpoint',
    'hosting does not declare the canonical checkpoint route');
  assert.strictEqual(S.DEFAULT_CONTROL_AUTHORITIES.checkpointRun,
    require('../aegis-run.cjs').checkpointRun,
    'the production HTTP route is not pinned to canonical checkpointRun');

  const source = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  assert.match(source,
    /pathname === '\/api\/checkpoint'\) result = recordCheckpoint\(runId, controlAuthorities\)/,
    'the HTTP route is not a thin pass-through to its fixed checkpoint authority');
  assert.match(source, /const runId = parseRunIdBody\(body\);/,
    'the checkpoint route must share the single runId-only body parser');

  const route = source.slice(source.indexOf('function recordCheckpoint('),
    source.indexOf('async function handleApi('));
  assert.match(route, /answer = controlAuthorities\.checkpointRun\(runId\);/,
    'the route is not a single pass-through carrying only the validated runId');
  assert.strictEqual((route.match(/checkpointRun\(/g) || []).length, 1,
    'the route invokes the canonical checkpoint authority more than once');
  // Committing, claiming, restoring, deploying, launching and retrying all
  // belong to authorities this route is not allowed to be.
  for (const forbidden of ['commit', 'force', 'rollbackRun', 'cmdRollback', 'acquireRunLaunchClaim',
    'releaseRunLaunchClaim', 'launchWorker', 'startGovernedRun', 'runChecks',
    'bindIndependentReview', 'saveRun', 'transition', 'spawn', 'setTimeout', 'setInterval']) {
    assert.ok(!route.includes(forbidden),
      `the checkpoint route reaches ${forbidden}, which the canonical authority owns`);
  }
});

test('the checkpoint DTO publishes validated coordinates only, and never the packet, subject or objective', () => {
  const runId = 'RUN-20260904-0badc0de';
  const canonical = {
    runId, state: 'CHECKPOINTED', action: 'checkpoint',
    checkpointId: 'CP-20260904123456-0badc0de',
    createdAt: '2026-09-04T12:34:56.789Z',
    rollbackPoint: 'a'.repeat(40), tree: 'b'.repeat(40), digest: 'c'.repeat(64),
    reviewedBase: 'd'.repeat(40),
    packet: { path: 'builder-control/packets/PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json',
      sha256: 'e'.repeat(64) },
    subject: { subjectSha256: 'f'.repeat(64), pathCount: 2, diffBytes: 4096,
      reviewedRange: 'aaa..bbb', committedRange: 'ccc..ddd' },
    checkReceiptSha256: '9'.repeat(64),
    checks: { passed: 13, total: 13 },
    objective: 'the canonical objective text must never travel',
    nextAction: 'rollback remains deferred',
  };
  const dto = S.minimizeCheckpoint(runId, canonical);
  assert.deepStrictEqual(dto, {
    runId, action: 'checkpoint', outcome: 'RECORDED', state: 'CHECKPOINTED',
    checkpointId: 'CP-20260904123456-0badc0de', createdAt: '2026-09-04T12:34:56.789Z',
    rollbackPoint: 'a'.repeat(40), tree: 'b'.repeat(40), digest: 'c'.repeat(64),
    reasonCode: null, reasonSummary: null,
    summary: S.PUBLIC_CHECKPOINT_SUMMARIES.RECORDED,
  });
  const text = JSON.stringify(dto);
  for (const forbidden of ['packets/', 'PKT-', 'aaa..bbb', 'ccc..ddd', 'objective',
    'subjectSha256', 'diffBytes', 'reviewedBase', 'checkReceiptSha256']) {
    assert.ok(!text.includes(forbidden),
      `the checkpoint DTO published ${forbidden}, which is callable-only evidence`);
  }
  assert.match(dto.summary, /restores no files and deploys nothing/,
    'a recorded checkpoint does not state that it neither restores nor deploys');

  // Every coordinate is validated by FORMAT, not copied. Any one of them being
  // wrong makes the whole answer unreadable rather than half-published.
  for (const [field, value] of [
    ['runId', 'RUN-20260904-deadbeef'], ['state', 'ROLLED_BACK'], ['action', 'rollback'],
    ['checkpointId', '../../etc/passwd'], ['checkpointId', 'CP-20260904123456-nothex!'],
    ['createdAt', 'yesterday'], ['rollbackPoint', 'HEAD'], ['tree', 'z'.repeat(40)],
    ['digest', 'c'.repeat(63)],
  ]) {
    assert.strictEqual(S.minimizeCheckpoint(runId, { ...canonical, [field]: value }), null,
      `an invalid ${field} (${value}) was published as a recorded checkpoint`);
  }
  for (const answer of [null, 'CHECKPOINTED', [], { ...canonical, checkpointId: undefined }]) {
    assert.strictEqual(S.minimizeCheckpoint(runId, answer), null,
      `a malformed canonical answer was published as a recorded checkpoint: ${JSON.stringify(answer)}`);
  }
});

test('every checkpoint refusal and uncertainty sentence is host-written and claims no safety', () => {
  const AegisRun = require('../aegis-run.cjs');
  // The host maps the canonical refusal vocabulary as it stands, and invents
  // no code of its own: every mapped code is one the canonical authority can
  // actually raise. CHECKPOINT_CLAIM_NOT_RELEASED is deliberately NOT here —
  // it is a post-write uncertainty, not a refusal.
  const canonicalCodes = Object.values(AegisRun.CHECKPOINT_REFUSAL_CODES);
  assert.deepStrictEqual(Object.keys(S.PUBLIC_CHECKPOINT_REFUSALS).sort(),
    [...canonicalCodes].sort(),
    'the host refusal table and the canonical refusal vocabulary disagree');
  assert.ok(!Object.prototype.hasOwnProperty.call(
    S.PUBLIC_CHECKPOINT_REFUSALS, 'CHECKPOINT_CLAIM_NOT_RELEASED'),
  'an unreleased claim is reported as a plain refusal');
  for (const [code, mapped] of Object.entries(S.PUBLIC_CHECKPOINT_REFUSALS)) {
    assert.ok([400, 404, 409].includes(mapped.httpStatus), `${code} has no bounded refusal status`);
    assert.ok(mapped.message.length > 0 && !/\//.test(mapped.message),
      `${code} refusal wording carries a path: ${mapped.message}`);
    assert.ok(!/no checkpoint was recorded|nothing changed|nothing happened|safe/i.test(mapped.message),
      `${code} refusal wording fabricates a no-mutation or safety claim: ${mapped.message}`);
  }
  for (const [code, sentence] of Object.entries(S.PUBLIC_CHECKPOINT_UNCERTAIN_REASONS)) {
    assert.ok(!/nothing changed|nothing was recorded|no checkpoint was recorded/i.test(sentence),
      `the ${code} sentence claims nothing changed: ${sentence}`);
    assert.match(sentence, /unknown|could not prove/,
      `the ${code} sentence does not report uncertainty: ${sentence}`);
  }
  assert.match(S.PUBLIC_CHECKPOINT_SUMMARIES.UNCERTAIN,
    /neither checkpointed nor unchanged/,
    'the uncertain summary picks a side it cannot know');
  assert.match(S.PUBLIC_CHECKPOINT_SUMMARIES.UNCERTAIN, /never restores files and never deploys/,
    'the uncertain summary does not state that a checkpoint neither restores nor deploys');
});

// This replaces a stage-boundary lock that forbade the dashboard from naming
// /api/review-preflight at all. That assertion could only hold until the
// approved UI packet wires the control it is waiting for, and would then fail
// for doing the right thing — a test that guarantees a future correct change
// fails is a schedule, not a contract. What has to hold forever is narrower and
// stronger: whenever the browser reaches review readiness, it reaches it as a
// question — the one declared read-only POST, pinned to the canonical read-only
// authority, holding no check, binding or worker-execution authority itself.
test('review readiness stays a read-only question wherever the browser reaches it', () => {
  assert.strictEqual(S.API_POST_ROUTES['/api/review-preflight'], 'review-preflight',
    'hosting does not declare the canonical review-preflight route');
  assert.strictEqual(S.DEFAULT_CONTROL_AUTHORITIES.prepareIndependentReview,
    require('../aegis-run.cjs').prepareIndependentReview,
    'the browser-reachable preflight is not pinned to the canonical read-only authority');

  const html = dashboardHtml();
  // The only spelling the host answers is the one it declares. A subpath, a
  // query string or an invented sibling route would need a second, unreviewed
  // handler before it could mean anything.
  for (const literal of html.match(/['"`][^'"`\n]*review-preflight[^'"`\n]*['"`]/g) || []) {
    assert.strictEqual(literal.slice(1, -1), '/api/review-preflight',
      `the dashboard names a preflight route the host does not declare: ${literal}`);
  }
  // The browser asks over HTTP. It never names — and may never hold — the
  // canonical authority behind the question, nor the check, binding and launch
  // authorities a read-only question is not allowed to reach.
  for (const authority of ['prepareIndependentReview', 'bindIndependentReview', 'runChecks',
    'launchWorker', 'startGovernedRun', 'spawn']) {
    assert.ok(!html.includes(authority),
      `the dashboard names ${authority} — the browser holds no canonical authority`);
  }
});

test('the preflight DTO is a closed, host-written projection of the three canonical outcomes', () => {
  const RUN_ID = 'RUN-20260904-0badc0de';
  const SUBJECT = 'a'.repeat(64);
  const RECEIPT = 'b'.repeat(64);
  const CLOSED_KEYS = ['checkReceiptSha256', 'hostContainment', 'mutations', 'nextAction',
    'pendingReviewers', 'reasonCode', 'reasonSummary', 'requiredReviewers', 'runId',
    'state', 'status', 'statusSummary', 'subjectSha256'];

  const permitted = S.minimizeReviewPreflight(RUN_ID, {
    runId: RUN_ID, state: 'CHECKS_PASSED', mutations: 'NONE',
    status: 'REVIEW_PERMITTED', reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
    summary: 'canonical generated sentence naming /Users/someone/checkout paths',
    nextAction: 'independent-review',
    lane: 'DEEP', requiredReviewers: ['gpt-5-codex', 'gemini'],
    pendingReviewers: [{ reviewer: 'gpt-5-codex', executed: 'MISSING', coverage: 'NONE' }],
    subject: { subjectSha256: SUBJECT, subjectPaths: ['builder-control/hosting/server.cjs'],
      diffBytes: 1234, range: 'abc..def' },
    evidence: { source: 'CANONICAL_CHECK_RECEIPT', receiptSha256: RECEIPT, hostContainment: 'BOUND' },
  });
  assert.deepStrictEqual(Object.keys(permitted).sort(), CLOSED_KEYS);
  assert.strictEqual(permitted.status, 'REVIEW_PERMITTED');
  assert.strictEqual(permitted.statusSummary, S.PUBLIC_REVIEW_PREFLIGHT_STATUSES.REVIEW_PERMITTED);
  assert.strictEqual(permitted.reasonSummary,
    S.PUBLIC_REVIEW_PREFLIGHT_REASONS.EXACT_SUBJECT_REVIEW_PENDING);
  assert.strictEqual(permitted.nextAction, 'independent-review');
  assert.deepStrictEqual(permitted.requiredReviewers, ['gpt-5-codex', 'gemini']);
  assert.deepStrictEqual(permitted.pendingReviewers,
    [{ reviewer: 'gpt-5-codex', executed: 'MISSING', coverage: 'NONE' }]);
  assert.strictEqual(permitted.subjectSha256, SUBJECT);
  assert.strictEqual(permitted.checkReceiptSha256, RECEIPT);
  assert.strictEqual(permitted.hostContainment, 'BOUND');
  assert.strictEqual(permitted.mutations, 'NONE');
  const permittedText = JSON.stringify(permitted);
  assert.ok(!/subjectPaths|server\.cjs|diffBytes|abc\.\.def|Users/.test(permittedText),
    `the permitted DTO leaked subject detail: ${permittedText}`);
  // A permitted reading is permission to ASK for a review, never a claim that
  // one was started, approved or paid for.
  assert.ok(!/approved|started|running/i.test(permitted.statusSummary),
    'a permitted preflight reads as launch approval');
  assert.match(permitted.statusSummary, /Nothing has been launched and nothing is bound/);

  const complete = S.minimizeReviewPreflight(RUN_ID, {
    runId: RUN_ID, state: 'CHECKS_PASSED', mutations: 'NONE',
    status: 'NO_ADDITIONAL_REVIEW_NEEDED', reasonCode: 'EXACT_SUBJECT_REVIEW_COMPLETE',
    nextAction: 'bind-independent-review', pendingReviewers: [],
    subject: { subjectSha256: SUBJECT },
    evidence: { receiptSha256: RECEIPT, hostContainment: 'PENDING_AT_BINDING' },
  });
  assert.deepStrictEqual(Object.keys(complete).sort(), CLOSED_KEYS);
  assert.strictEqual(complete.status, 'NO_ADDITIONAL_REVIEW_NEEDED');
  assert.deepStrictEqual(complete.pendingReviewers, []);
  assert.strictEqual(complete.hostContainment, 'PENDING_AT_BINDING');

  const refused = S.minimizeReviewPreflight(RUN_ID, {
    runId: RUN_ID, state: 'BUILT', mutations: 'NONE', status: 'REFUSED',
    reasonCode: 'REVIEW-WRONG-STATE', nextAction: 'none', pendingReviewers: [],
    summary: 'review binding requires CHECKS_PASSED, run is BUILT',
  });
  assert.deepStrictEqual(Object.keys(refused).sort(), CLOSED_KEYS);
  assert.strictEqual(refused.status, 'REFUSED');
  assert.strictEqual(refused.reasonSummary,
    S.PUBLIC_REVIEW_PREFLIGHT_REASONS['REVIEW-WRONG-STATE']);
  assert.strictEqual(refused.subjectSha256, null);
  assert.strictEqual(refused.checkReceiptSha256, null);
  assert.strictEqual(refused.hostContainment, null);

  // The packet names REVIEW-CYCLE-NO-PERMITTED-REVIEWER as refused/no-action.
  const noPermittedReviewer = S.minimizeReviewPreflight(RUN_ID, {
    runId: RUN_ID, state: 'CHECKS_PASSED', mutations: 'NONE', status: 'REFUSED',
    reasonCode: 'REVIEW-CYCLE-NO-PERMITTED-REVIEWER', nextAction: 'none',
    pendingReviewers: [{ reviewer: 'gpt-5-codex', executed: 'MISSING', coverage: 'NONE' }],
  });
  assert.strictEqual(noPermittedReviewer.status, 'REFUSED');
  assert.strictEqual(noPermittedReviewer.nextAction, 'none');
  assert.match(noPermittedReviewer.reasonSummary, /permits no reviewer/);
});

test('RED: the preflight DTO refuses hostile, mismatched or mutation-claiming answers', () => {
  const RUN_ID = 'RUN-20260904-0badc0de';
  const base = { runId: RUN_ID, state: 'CHECKS_PASSED', mutations: 'NONE',
    status: 'REFUSED', reasonCode: 'REVIEW-WRONG-STATE', nextAction: 'none' };
  for (const [name, answer] of [
    ['a non-object answer', 'REVIEW_PERMITTED'],
    ['an array answer', [base]],
    ['a null answer', null],
    ['a different run', { ...base, runId: 'RUN-20260904-deadbeef' }],
    ['a mutating answer', { ...base, mutations: 'RUN_RECORD_WRITTEN' }],
    ['an unrecognised status', { ...base, status: 'LAUNCHED' }],
  ]) {
    assert.strictEqual(S.minimizeReviewPreflight(RUN_ID, answer), null,
      `${name} produced a publishable DTO`);
  }

  const hostile = S.minimizeReviewPreflight(RUN_ID, {
    ...base,
    state: 'PWNED', reasonCode: 'ATTACKER-SUPPLIED-CODE', nextAction: 'launch-reviewer',
    requiredReviewers: ['../../etc/passwd', 'gpt-5-codex', HOSTILE_WORKER_OUTPUT.jwt],
    pendingReviewers: [
      { reviewer: 'gpt-5-codex', executed: 'LAUNCHED', coverage: 'TOTAL',
        transcript: HOSTILE_WORKER_OUTPUT.source, findings: [HOSTILE_WORKER_OUTPUT.pem] },
      { reviewer: HOSTILE_WORKER_OUTPUT.cookie, executed: 'MISSING', coverage: 'NONE' },
    ],
    subject: { subjectSha256: 'not-a-hash', subjectPaths: [HOSTILE_WORKER_OUTPUT.source] },
    evidence: { receiptSha256: 'zz', hostContainment: 'PROVEN_BY_THE_REVIEWER' },
    packet: { path: '/Users/someone/checkout/builder-control/packets/p.json' },
    commands: ['node builder-control/test/host-containment.test.cjs'],
    credentials: HOSTILE_WORKER_OUTPUT.pem,
    stdoutTail: HOSTILE_WORKER_OUTPUT.unlabelled,
  });
  assert.deepStrictEqual(Object.keys(hostile).sort(),
    ['checkReceiptSha256', 'hostContainment', 'mutations', 'nextAction', 'pendingReviewers',
      'reasonCode', 'reasonSummary', 'requiredReviewers', 'runId', 'state', 'status',
      'statusSummary', 'subjectSha256']);
  assert.strictEqual(hostile.state, null, 'an unrecognised lifecycle word travelled');
  assert.strictEqual(hostile.reasonCode, null, 'an unrecognised reason code travelled');
  assert.strictEqual(hostile.reasonSummary, null);
  assert.strictEqual(hostile.nextAction, null, 'an unrecognised next action travelled');
  assert.deepStrictEqual(hostile.requiredReviewers, ['gpt-5-codex'],
    'a reviewer identifier outside the bounded name shape travelled');
  assert.deepStrictEqual(hostile.pendingReviewers,
    [{ reviewer: 'gpt-5-codex', executed: 'UNKNOWN', coverage: 'UNKNOWN' }]);
  assert.strictEqual(hostile.subjectSha256, null);
  assert.strictEqual(hostile.checkReceiptSha256, null);
  assert.strictEqual(hostile.hostContainment, null);
  assertNoHostileWorkerOutput(hostile, 'the preflight DTO');
  const text = JSON.stringify(hostile);
  assert.ok(!/Users|passwd|packets\/|host-containment/.test(text),
    `the preflight DTO leaked a path, packet or command: ${text}`);
});

test('the preflight reviewer lists are bounded and de-duplicated', () => {
  const RUN_ID = 'RUN-20260904-0badc0de';
  const many = Array.from({ length: 40 }, (_, i) => `reviewer-${i}`);
  const dto = S.minimizeReviewPreflight(RUN_ID, {
    runId: RUN_ID, state: 'CHECKS_PASSED', mutations: 'NONE', status: 'REFUSED',
    reasonCode: 'REVIEW-GATE-BLOCKED', nextAction: 'none',
    requiredReviewers: [...many, 'reviewer-0'],
    pendingReviewers: many.map((reviewer) => ({ reviewer, executed: 'MISSING', coverage: 'NONE' }))
      .concat([{ reviewer: 'reviewer-0', executed: 'MISSING', coverage: 'NONE' }]),
  });
  assert.strictEqual(dto.requiredReviewers.length, 16);
  assert.strictEqual(dto.pendingReviewers.length, 16);
  assert.strictEqual(new Set(dto.requiredReviewers).size, dto.requiredReviewers.length);
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

  // The failed-state list lives in retryAvailability(), the one authority the
  // action row, the command deck and the POST helper all read. Prove it there:
  // a second copy of the list inline in runActionRow would be exactly the
  // duplicated state authority this page refuses. The row's obligation is to
  // consult that authority and to wire the click only where it says allowed.
  const retryGate = html.slice(html.indexOf('function retryAvailability'),
    html.indexOf('async function requestRunRetry'));
  assert.match(retryGate,
    /\['BUILD_FAILED','CHECKS_FAILED','REVIEW_FAILED'\]\.indexOf\(run\.state\)\s*===\s*-1/,
    'Retry is not gated to the failed states it can actually re-enter');
  assert.match(row, /window\.AEGIS_DASHBOARD\.retryAvailability\(run\)/,
    'the action row does not read the shared Retry authority');
  const retryStart = html.indexOf('async function requestRunRetry');
  const retryHelper = html.slice(retryStart, html.indexOf('\n  }\n', retryStart));
  assert.match(retryHelper, /if \(!retryAvailability\(run\)\.allowed\) return;/,
    'the shared Retry helper does not fail closed outside canonical failed states');
  assert.match(retryHelper, /callApi\('\/api\/retry',\s*\{\s*runId:\s*run\.runId\s*\}\)/,
    'Retry must send only the canonical runId to /api/retry');
  assert.match(row,
    /if \(retryState\.allowed\) \{\s*retryBtn\.addEventListener\('click', function\(\)\{\s*return window\.AEGIS_DASHBOARD\.requestRunRetry\(run, retryBtn\);/,
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
  // applyStatus()'s own body, ended at its closing brace. A fixed character
  // window silently stops proving the repaints that sit past it, so the last
  // renderer wired into the function would be the first one to go unguarded.
  const applyStart = html.indexOf('function applyStatus');
  const applyEnd = html.indexOf('\n  }\n', applyStart);
  assert.ok(applyStart !== -1 && applyEnd !== -1, 'no applyStatus() boundary found');
  const apply = html.slice(applyStart, applyEnd);
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
      'recoveryCode', 'retrySafe', 'startedAt', 'status', 'supervision', 'timedOut', 'workerPid'].sort());
  assert.deepStrictEqual(Object.keys(worker.supervision).sort(),
    ['activityAt', 'activityCode', 'activityReason', 'activityState', 'activitySummary',
      'lastProgressAt', 'noProgressLimitSec', 'progressKind', 'progressReason', 'progressState',
      'progressSummary', 'timeoutReason', 'timeoutSummary', 'wallClockLimitSec'].sort());
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

test('MODEL_AUTH_FAILURE and completed one-attempt Grok handoff cross the public status allowlist without raw output', () => {
  const worker = S.minimizeWorker({
    mode: 'async', workerState: 'FAILED', exit: 1,
    recovery: { reason: 'MODEL_AUTH_FAILURE', retrySafe: false },
    failure: { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
      summary: 'Claude authentication failed.' },
    handoff: { state: 'COMPLETED', toProvider: 'grok-subscription',
      launchSpec: { provider: 'grok-subscription', model: 'grok-4.6' },
      reason: 'untrusted worker prose must not cross' },
    stdoutTail: 'must not cross', stderrTail: 'must not cross',
  }, 'BUILD_FAILED');
  assert.deepStrictEqual(worker.failure, {
    code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription', summary: 'Claude authentication failed.',
  });
  assert.deepStrictEqual(worker.failover, {
    state: 'COMPLETED', provider: 'grok-subscription', model: 'grok-4.6',
    reason: 'The unchanged run was handed to the next eligible builder once.',
  });
  assert.deepStrictEqual(worker.activity, {
    code: 'MODEL_AUTH_FAILURE', phase: 'BLOCKED', active: false,
    summary: 'Claude authentication failed.',
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
  assert.deepStrictEqual(augmented.failure, {
    code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription', summary: 'Claude authentication failed.',
  }, 'the canonical failure should survive while caller-added fields are discarded');
  assert.strictEqual(augmented.activity.code, 'MODEL_AUTH_FAILURE');
  assert.ok(!JSON.stringify(augmented).includes('forged'));
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

// ── live supervision (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ──────────────
// The defect this guards is a dashboard that reports a heartbeating but idle
// builder as working. The projection therefore has to keep real progress and
// supervisor liveness apart, publish the fixed limits it is actually judged
// against, and refuse anything that is not in its closed vocabulary.
test('supervision publishes real progress from canonical run state and never from the heartbeat', () => {
  const worker = S.minimizeWorker({
    mode: 'async', workerState: 'RUNNING', workerPid: 4242,
    startedAt: '2026-09-02T10:00:00.000Z',
    heartbeatAt: '2026-09-02T10:09:59.000Z',
    lastProgressAt: '2026-09-02T10:04:00.000Z',
    progressKind: 'AUTHORIZED_WRITE',
    stdoutTail: HOSTILE_WORKER_OUTPUT.source,
    stderrTail: HOSTILE_WORKER_OUTPUT.pem,
  }, 'BUILDING');
  assert.strictEqual(worker.supervision.progressState, 'RECORDED');
  assert.strictEqual(worker.supervision.progressKind, 'AUTHORIZED_WRITE');
  assert.strictEqual(worker.supervision.lastProgressAt, '2026-09-02T10:04:00.000Z');
  assert.strictEqual(worker.supervision.progressSummary,
    'Builder changed a file it is authorized to write');
  assert.strictEqual(worker.supervision.progressReason, null);
  // The heartbeat stays exactly where it was. Copying it into the supervision
  // object would create a second place a renderer could mistake for progress.
  assert.strictEqual(worker.heartbeatAt, '2026-09-02T10:09:59.000Z');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(worker.supervision, 'heartbeatAt'), false,
    'the heartbeat was republished inside the progress object it must stay distinct from');
  assert.notStrictEqual(worker.supervision.lastProgressAt, worker.heartbeatAt,
    'this fixture must keep a live heartbeat separable from older real progress');
  assertNoHostileWorkerOutput(worker, 'supervision projection');
});

test('RED: a heartbeating builder with no recorded progress fails closed to UNRECORDED', () => {
  const supervision = S.minimizeWorker({
    mode: 'async', workerState: 'RUNNING',
    heartbeatAt: '2026-09-02T10:09:59.000Z',
  }, 'BUILDING').supervision;
  assert.strictEqual(supervision.progressState, 'UNRECORDED');
  assert.strictEqual(supervision.progressKind, null);
  assert.strictEqual(supervision.lastProgressAt, null);
  assert.match(supervision.progressReason, /heartbeat alone/,
    'an unrecorded progress state must say what liveness actually rests on');

  // Half a pair proves nothing about when the builder last did work, so a kind
  // without a time, or a time without a kind, is refused rather than published.
  for (const [label, partial] of [
    ['kind without a timestamp', { progressKind: 'STDOUT' }],
    ['timestamp without a kind', { lastProgressAt: '2026-09-02T10:04:00.000Z' }],
    ['unknown vocabulary', { progressKind: 'THINKING', lastProgressAt: '2026-09-02T10:04:00.000Z' }],
    ['model prose as a phase', { progressKind: HOSTILE_WORKER_OUTPUT.source,
      lastProgressAt: '2026-09-02T10:04:00.000Z' }],
    ['unparseable timestamp', { progressKind: 'STDOUT', lastProgressAt: 'just now' }],
  ]) {
    const refused = S.minimizeWorker({ mode: 'async', workerState: 'RUNNING', ...partial }, 'BUILDING')
      .supervision;
    assert.strictEqual(refused.progressState, 'UNRECORDED', label);
    assert.strictEqual(refused.progressKind, null, label);
    assert.strictEqual(refused.lastProgressAt, null, label);
    assertNoHostileWorkerOutput(refused, `supervision (${label})`);
  }
});

// ── the bounded activity category (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// "Real progress was observed" still does not tell a founder what the builder
// is doing. The activity category does, in a closed vocabulary hosting owns —
// and it is published only when authenticated progress evidence backs it.
test('a recorded read or edit activity travels as plain English with its own evidence time', () => {
  for (const [code, expected] of [
    ['READING', 'Reading files in the worktree'],
    ['EDITING', 'Editing files it is authorized to change'],
  ]) {
    const supervision = S.minimizeWorker({
      mode: 'async', workerState: 'RUNNING', workerPid: 4242,
      heartbeatAt: '2026-09-03T10:09:59.000Z',
      lastProgressAt: '2026-09-03T10:09:40.000Z', progressKind: 'STDOUT',
      progressActivity: code, progressActivityAt: '2026-09-03T10:09:30.000Z',
      stdoutTail: HOSTILE_WORKER_OUTPUT.source, stderrTail: HOSTILE_WORKER_OUTPUT.pem,
    }, 'BUILDING').supervision;
    assert.strictEqual(supervision.activityState, 'RECORDED', code);
    assert.strictEqual(supervision.activityCode, code);
    assert.strictEqual(supervision.activitySummary, expected,
      'the activity sentence must be hosting\'s own, not the worker\'s or the model\'s');
    assert.strictEqual(supervision.activityAt, '2026-09-03T10:09:30.000Z',
      'the activity carries the time its own evidence was observed, not the later progress stamp');
    assert.strictEqual(supervision.activityReason, null);
    assertNoHostileWorkerOutput(supervision, `activity supervision (${code})`);
  }
  assert.deepStrictEqual(Object.keys(S.PUBLIC_PROGRESS_ACTIVITIES).sort(),
    ['DIAGNOSING', 'EDITING', 'READING', 'RESPONDING', 'SEARCHING', 'STARTING', 'WORKING'],
    'the public activity vocabulary is no longer the closed set the worker derives');
  assert.ok(Object.isFrozen(S.PUBLIC_PROGRESS_ACTIVITIES));
});

test('RED: a heartbeat, a half pair, or an unknown category publishes no activity at all', () => {
  const heartbeatOnly = S.minimizeWorker({
    mode: 'async', workerState: 'RUNNING', heartbeatAt: '2026-09-03T10:09:59.000Z',
    // A worker that recorded a category but no real progress is exactly the
    // stalled-but-heartbeating case: the category must not survive alone.
    progressActivity: 'EDITING', progressActivityAt: '2026-09-03T10:00:00.000Z',
  }, 'BUILDING').supervision;
  assert.strictEqual(heartbeatOnly.progressState, 'UNRECORDED');
  assert.strictEqual(heartbeatOnly.activityState, 'UNRECORDED');
  assert.strictEqual(heartbeatOnly.activityCode, null);
  assert.strictEqual(heartbeatOnly.activitySummary, null);
  assert.strictEqual(heartbeatOnly.activityAt, null);
  assert.match(heartbeatOnly.activityReason, /unavailable/,
    'an unrecorded activity must say plainly that it is unavailable');

  const progressing = {
    mode: 'async', workerState: 'RUNNING',
    lastProgressAt: '2026-09-03T10:09:40.000Z', progressKind: 'STDOUT',
  };
  for (const [label, partial] of [
    ['category without a time', { progressActivity: 'READING' }],
    ['time without a category', { progressActivityAt: '2026-09-03T10:09:30.000Z' }],
    ['unknown vocabulary', { progressActivity: 'DEPLOYING', progressActivityAt: '2026-09-03T10:09:30.000Z' }],
    ['model prose as a category', { progressActivity: HOSTILE_WORKER_OUTPUT.source,
      progressActivityAt: '2026-09-03T10:09:30.000Z' }],
    ['unparseable evidence time', { progressActivity: 'READING', progressActivityAt: 'a moment ago' }],
  ]) {
    const refused = S.minimizeWorker({ ...progressing, ...partial }, 'BUILDING').supervision;
    assert.strictEqual(refused.progressState, 'RECORDED', label);
    assert.strictEqual(refused.activityState, 'UNRECORDED', label);
    assert.strictEqual(refused.activityCode, null, label);
    assert.strictEqual(refused.activitySummary, null, label);
    assert.strictEqual(refused.activityAt, null, label);
    assertNoHostileWorkerOutput(refused, `activity supervision (${label})`);
  }
});

test('the published watchdog and wall-clock limits are read from their enforcing authorities', () => {
  const AegisWorker = require('../aegis-worker.cjs');
  const supervision = S.minimizeWorker({ mode: 'async', workerState: 'RUNNING' }, 'BUILDING').supervision;
  assert.strictEqual(supervision.wallClockLimitSec, S.GOVERNED_BUILDER.timeoutSec,
    'the published wall-clock limit is not the one every governed launch is given');
  // Resolved exactly as hosting resolves it, including the fail-closed null, so
  // this proof compares two readings of one authority rather than a constant.
  let enforcedMs = null;
  try { enforcedMs = AegisWorker.builderNoProgressTimeoutMs(S.GOVERNED_BUILDER.timeoutSec * 1000); }
  catch { enforcedMs = null; }
  assert.strictEqual(supervision.noProgressLimitSec,
    Number.isInteger(enforcedMs) && enforcedMs > 0 ? enforcedMs / 1000 : null,
    'the published no-progress limit is not the one aegis-worker actually arms');
  assert.strictEqual(S.GOVERNED_NO_PROGRESS_LIMIT_SEC, supervision.noProgressLimitSec);
  // Restating either bound as a literal here would create a second limit
  // authority that drifts silently from the one that kills the build.
  const source = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  const block = source.slice(source.indexOf('const GOVERNED_NO_PROGRESS_LIMIT_SEC'),
    source.indexOf('function structuredWorkerActivity'));
  assert.ok(block.length > 0, 'the supervision projection source boundary was not found');
  assert.match(block, /AegisWorker\.builderNoProgressTimeoutMs\(GOVERNED_BUILDER\.timeoutSec \* 1000\)/);
  assert.doesNotMatch(block, /\b(?:300|900)\b/,
    'a hard-coded limit second-guesses the authority that enforces it');
  assert.doesNotMatch(block, /Date\.now\(|setTimeout\(|setInterval\(/,
    'the supervision projection introduced its own clock or timer');
});

test('RED: only a canonical timeout reason travels, and it never invents a stop cause', () => {
  const timedOut = S.minimizeWorker({
    mode: 'async', workerState: 'FAILED', exit: 124, timedOut: true,
    timeoutReason: 'NO_PROGRESS_TIMEOUT',
    lastProgressAt: '2026-09-02T10:04:00.000Z', progressKind: 'STDOUT',
  }, 'BUILD_FAILED');
  assert.strictEqual(timedOut.timedOut, true);
  assert.strictEqual(timedOut.supervision.timeoutReason, 'NO_PROGRESS_TIMEOUT');
  assert.match(timedOut.supervision.timeoutSummary, /no real builder progress was observed/);

  const wall = S.minimizeWorker({
    mode: 'async', workerState: 'FAILED', exit: 124, timedOut: true,
    timeoutReason: 'WALL_CLOCK_TIMEOUT',
  }, 'BUILD_FAILED').supervision;
  assert.strictEqual(wall.timeoutReason, 'WALL_CLOCK_TIMEOUT');
  assert.match(wall.timeoutSummary, /fixed wall-clock limit/);

  // A reason with no recorded timeout, an unknown reason, and hostile text all
  // fail closed. A recorded timeout with no reason says so rather than picking.
  for (const [label, build, expectSummary] of [
    ['reason without a recorded timeout',
      { mode: 'async', workerState: 'FAILED', exit: 1, timeoutReason: 'WALL_CLOCK_TIMEOUT' }, null],
    ['unknown reason',
      { mode: 'async', workerState: 'FAILED', exit: 124, timedOut: true, timeoutReason: 'GAVE_UP' },
      /no canonical timeout reason is recorded/],
    ['hostile reason',
      { mode: 'async', workerState: 'FAILED', exit: 124, timedOut: true,
        timeoutReason: HOSTILE_WORKER_OUTPUT.jwt }, /no canonical timeout reason is recorded/],
  ]) {
    const supervision = S.minimizeWorker(build, 'BUILD_FAILED').supervision;
    assert.strictEqual(supervision.timeoutReason, null, label);
    if (expectSummary === null) assert.strictEqual(supervision.timeoutSummary, null, label);
    else assert.match(supervision.timeoutSummary, expectSummary, label);
    assertNoHostileWorkerOutput(supervision, `timeout supervision (${label})`);
  }
});

test('supervision adds no second timeout, failure, recovery, checkpoint or cost authority', () => {
  const worker = S.minimizeWorker({
    mode: 'async', workerState: 'FAILED', exit: 1, timedOut: false,
    recovery: { reason: 'TERMINATION_UNVERIFIED', retrySafe: false, terminationVerified: false },
    lastProgressAt: '2026-09-02T10:04:00.000Z', progressKind: 'STDOUT',
  }, 'BUILD_FAILED');
  // These five remain the only places the browser reads availability from.
  assert.strictEqual(worker.retrySafe, false);
  assert.strictEqual(worker.recoveryCode, 'TERMINATION_UNVERIFIED');
  assert.strictEqual(worker.cancelAvailable, false);
  assert.strictEqual(worker.timedOut, false);
  assert.strictEqual(worker.exit, 1);
  for (const forbidden of ['retrySafe', 'retryAvailable', 'recoveryCode', 'cancelAvailable',
    'timedOut', 'exit', 'checkpoint', 'rollbackPoint', 'cost', 'cad', 'totalUsd']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(worker.supervision, forbidden), false,
      `supervision republished ${forbidden} and became a second authority for it`);
  }
});

test('supervision reaches the whole minimized status surface with cost and checkpoint untouched', () => {
  const min = S.minimizeApiStatus({
    generatedAt: 'T', engineering: { state: 'UNAVAILABLE' },
    cost: { state: 'OK', recordedUsdDisplay: 1.5, totalUsd: 'AT LEAST 1.5', recordedRuns: 1,
      unrecordedRuns: 2, caveat: '2 run(s) have no cost telemetry', byReviewer: {},
      cad: { state: 'OK', totalCad: 'AT LEAST 2.05', plain: 'USD 1 = CAD 1.37 on 2026-09-01',
        source: 'builder-control/fx-canon.json' } },
    runs: { state: 'OK', runs: [{
      runId: 'RUN-SUPERVISION', state: 'BUILDING', objective: 'o',
      checkpoint: 'CKPT-1', rollbackPoint: 'f'.repeat(40), checkpointState: 'VALIDATED',
      build: { mode: 'async', workerState: 'RUNNING', heartbeatAt: '2026-09-02T10:09:59.000Z',
        lastProgressAt: '2026-09-02T10:09:00.000Z', progressKind: 'STDOUT' },
    }] },
  });
  const run = min.runs[0];
  assert.strictEqual(run.build.supervision.progressKind, 'STDOUT');
  assert.strictEqual(run.build.supervision.progressState, 'RECORDED');
  // The existing checkpoint and CAD projections are carried through unchanged;
  // supervision neither recomputes nor estimates either of them.
  assert.strictEqual(run.checkpoint, 'CKPT-1');
  assert.strictEqual(run.rollbackPoint, 'f'.repeat(40));
  assert.strictEqual(run.checkpointState, 'VALIDATED');
  assert.strictEqual(min.cost.cad.totalCad, 'AT LEAST 2.05');
  assert.strictEqual(min.cost.totalUsd, 'AT LEAST 1.5');
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

test('RED: hosting never names a check command when it offers a BUILT run for automatic checks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'hosting', 'server.cjs'), 'utf8');
  const body = source.slice(source.indexOf('function startRunReconciler('), source.indexOf('function start(args)'));
  assert.ok(body.length > 0, 'startRunReconciler source boundary was not found');
  // A comment may describe the boundary — naming the slice this delegation is
  // narrowed to is how the boundary is documented. Only executable source can
  // actually select a command, so the prohibitions below read the code alone.
  const executable = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(executable, /authority\.runAutomaticDashboardChecks\(result\.runId\)/,
    'hosting must delegate automatic checks to the canonical authority by run id alone');
  assert.ok(!/testsRequired|dashboard-slice|git diff --check|\.test\.cjs/.test(executable),
    'hosting must not name, select, or narrow a check command');
  assert.ok(!/transition|CHECKS_PASSED|CHECKS_FAILED/.test(executable),
    'hosting must not decide or record a lifecycle outcome for an automatically checked run');
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

// Reconciler assertions wait for the pass count the fixture itself records,
// never for a fixed sleep: the observed outcome is what keeps the offer count
// deterministic on a slow or loaded machine.
function afterPasses(observed, target) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const tick = () => {
      if (observed.passes >= target) return resolve();
      if (Date.now() > deadline) {
        return reject(new Error(`reconciliation pass ${target} never ran (saw ${observed.passes})`));
      }
      setTimeout(tick, 5);
    };
    tick();
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

  await atest('hosting offers only a returned BUILT run to the automatic-checks authority, by run id alone', async () => {
    const server = new EventEmitter();
    const runId = 'RUN-20260903-1a2b3c4d';
    let results = [{ runId, action: 'ACTIVE', state: 'BUILDING' }];
    const offered = [];
    const authority = {
      reconcileBuildingRuns() { return results; },
      runAutomaticDashboardChecks(...args) { offered.push(args); return { runId, ran: false }; },
    };
    const reconciler = S.startRunReconciler(server, authority, 20);
    assert.deepStrictEqual(offered, [], 'a BUILDING run must never be offered to automatic checks');
    // Hosting hands over an identifier and nothing else: no command, no
    // selection, no packet. Every decision stays with aegis-run.
    results = [{ runId, action: 'NOOP', state: 'BUILT' }];
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.deepStrictEqual(offered, [[runId]],
      'a BUILT run must be offered exactly once per arrival, with the run id as the only argument');
    // A correction cycle returning through BUILDING is a new arrival.
    results = [{ runId, action: 'ACTIVE', state: 'BUILDING' }];
    await new Promise((resolve) => setTimeout(resolve, 70));
    results = [{ runId, action: 'NOOP', state: 'BUILT' }];
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.deepStrictEqual(offered, [[runId], [runId]],
      'a run that reached BUILT again after a correction was never offered');
    server.emit('close');
    reconciler.stop();
  });

  await atest('an automatic-checks refusal never stops hosting reconciliation', async () => {
    const server = new EventEmitter();
    let passes = 0;
    const authority = {
      reconcileBuildingRuns() {
        passes += 1;
        return [{ runId: 'RUN-20260903-5e6f7a8b', action: 'NOOP', state: 'BUILT' }];
      },
      runAutomaticDashboardChecks() {
        const error = new Error('automatic checks are refused for this fixture');
        error.code = 'INVALID_CHECKS';
        throw error;
      },
    };
    const reconciler = S.startRunReconciler(server, authority, 20);
    const afterFirstPass = passes;
    assert.strictEqual(afterFirstPass, 1, 'the immediate pass did not survive an automatic-checks refusal');
    await new Promise((resolve) => setTimeout(resolve, 55));
    assert.ok(passes > afterFirstPass, 'reconciliation stopped after an automatic-checks refusal');
    server.emit('close');
    reconciler.stop();
  });

  await atest('hosting reconciliation tolerates an authority without the automatic-checks capability', async () => {
    const server = new EventEmitter();
    let passes = 0;
    const authority = {
      reconcileBuildingRuns() {
        passes += 1;
        return [{ runId: 'RUN-20260903-9c0d1e2f', action: 'NOOP', state: 'BUILT' }];
      },
    };
    const reconciler = S.startRunReconciler(server, authority, 20);
    await new Promise((resolve) => setTimeout(resolve, 55));
    assert.ok(passes >= 2, 'a reconciler without an automatic-checks authority stopped reconciling');
    server.emit('close');
    reconciler.stop();
  });

  await atest('a run already BUILT before the pass looked is still offered exactly once', async () => {
    const server = new EventEmitter();
    const runId = 'RUN-20260905-11aa22bb';
    // Another canonical status reader carried this run out of BUILDING first,
    // so reconciliation has nothing at all to report about it. Before this was
    // fixed the run sat at BUILT forever and was never offered.
    const observed = { passes: 0 };
    const offered = [];
    const authority = {
      reconcileBuildingRuns() { observed.passes += 1; return []; },
      listRuns() { return [{ runId, state: 'BUILT' }]; },
      runAutomaticDashboardChecks(...args) { offered.push(args); return { runId, ran: true }; },
    };
    const reconciler = S.startRunReconciler(server, authority, 10);
    await afterPasses(observed, 4);
    assert.deepStrictEqual(offered, [[runId]],
      'an already-BUILT run must be offered exactly once per arrival, with the run id as the only argument');
    server.emit('close');
    reconciler.stop();
  });

  await atest('one BUILT arrival reported by both reconciliation and the canonical list is offered once', async () => {
    const server = new EventEmitter();
    const runId = 'RUN-20260905-33cc44dd';
    const observed = { passes: 0 };
    const offered = [];
    const authority = {
      reconcileBuildingRuns() {
        observed.passes += 1;
        return [{ runId, action: 'NOOP', state: 'BUILT' }];
      },
      listRuns() { return [{ runId, state: 'BUILT' }]; },
      runAutomaticDashboardChecks(...args) { offered.push(args); return { runId, ran: true }; },
    };
    const reconciler = S.startRunReconciler(server, authority, 10);
    await afterPasses(observed, 4);
    assert.deepStrictEqual(offered, [[runId]],
      'two views of the same BUILT arrival must not produce two offers');
    server.emit('close');
    reconciler.stop();
  });

  await atest('leaving BUILT clears the marker so a later BUILT arrival is offered again', async () => {
    const server = new EventEmitter();
    const runId = 'RUN-20260905-55ee66ff';
    const observed = { passes: 0 };
    const offered = [];
    let canonicalState = 'BUILT';
    const authority = {
      reconcileBuildingRuns() { observed.passes += 1; return []; },
      listRuns() { return [{ runId, state: canonicalState }]; },
      runAutomaticDashboardChecks(...args) { offered.push(args); return { runId, ran: true }; },
    };
    const reconciler = S.startRunReconciler(server, authority, 10);
    await afterPasses(observed, 3);
    assert.deepStrictEqual(offered, [[runId]], 'the first BUILT arrival was not offered exactly once');
    // A correction cycle takes the run away from BUILT; the second arrival at
    // BUILT is a new arrival and is offered again.
    canonicalState = 'CORRECTING';
    await afterPasses(observed, observed.passes + 3);
    assert.deepStrictEqual(offered, [[runId]], 'a run away from BUILT must never be offered');
    canonicalState = 'BUILT';
    await afterPasses(observed, observed.passes + 3);
    assert.deepStrictEqual(offered, [[runId], [runId]],
      'a run that reached BUILT again after leaving it was never offered');
    server.emit('close');
    reconciler.stop();
  });

  await atest('a canonically ineligible BUILT run executes nothing', async () => {
    const server = new EventEmitter();
    const runId = 'RUN-20260905-77aa88bb';
    const observed = { passes: 0 };
    const offered = [];
    const executed = [];
    // Eligibility stays exactly where it already lives. Hosting hands over a
    // run id and no opinion; the canonical authority refuses, and no check,
    // command, or lifecycle outcome exists for this run.
    const authority = {
      reconcileBuildingRuns() { observed.passes += 1; return []; },
      listRuns() { return [{ runId, state: 'BUILT' }]; },
      automaticDashboardChecksEligibility(id) {
        return { eligible: false, runId: id, state: 'BUILT',
          reason: 'the run is not marked automatic-checks eligible' };
      },
      runAutomaticDashboardChecks(id) {
        offered.push(id);
        const eligibility = authority.automaticDashboardChecksEligibility(id);
        if (!eligibility.eligible) {
          return { runId: id, action: 'automatic-checks', ran: false, reason: eligibility.reason };
        }
        executed.push(id);
        return { runId: id, action: 'automatic-checks', ran: true };
      },
    };
    const reconciler = S.startRunReconciler(server, authority, 10);
    await afterPasses(observed, 4);
    assert.deepStrictEqual(executed, [],
      'an ineligible run must never have checks executed for it');
    assert.deepStrictEqual(offered, [runId],
      'an ineligible run must be offered to the refusing authority once, not repeatedly');
    server.emit('close');
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
  // Reuses the now-closed HOSTING_TEST_PORT listener slot rather than opening a
  // third port, so the suite still owns exactly two listener ports.
  await runReviewPreflightCompositionSuite();
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
function post(port, path_, { headers = {}, body, cookie, agent } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(body);
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (data) h['content-length'] = data.length;
    const req = http.request(
      { host: '127.0.0.1', port, path: path_, method: 'POST', headers: h,
        ...(agent === undefined ? {} : { agent }) },
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

// ── /api/review-preflight transport suite ───────────────────────────────────
// The composition seam is exercised in-process with a recording preflight stub,
// so every transport rule (auth, origin-before-body, method, bounded body,
// exact-field discipline), the exact runId that reaches the authority, all
// three canonical outcomes, and the sanitization of hostile answers and
// exceptions are proved deterministically — without executing a real review,
// a real check, a model, or any run/ledger write. The runChecks and
// bindIndependentReview members of the same seam are wired to recorders that
// fail the suite if this read-only route ever reaches them.
async function runReviewPreflightCompositionSuite() {
  const PORT = HOSTING_TEST_PORT;
  const PREFLIGHT_TOKEN = 'preflight-token-' + crypto.randomBytes(16).toString('hex');
  const ORIGIN = `http://127.0.0.1:${PORT}`;
  const RUN_ID = 'RUN-20260904-0badc0de';
  const SUBJECT = 'c'.repeat(64);
  const RECEIPT = 'd'.repeat(64);
  // A string that exists nowhere in the host's own vocabulary. Asserting the
  // absence of English like "still owes" cannot tell a canonical leak apart
  // from the host's own sanctioned reason copy, which says "still owes"
  // legitimately; asserting the absence of this can.
  const CANONICAL_ONLY = 'CANONICAL-ONLY-' + crypto.randomBytes(16).toString('hex');
  // Every request in this fixture opens its own connection. This suite reuses
  // the listener slot the static-file server just released, and that server
  // left keep-alive sockets in the shared globalAgent pool — reusing one of
  // those already-closed sockets resolves as status 0, a transport failure that
  // never happened. A non-pooling agent removes the reuse, deterministically,
  // without a sleep, a retry or a relaxed expectation.
  const agent = new http.Agent({ keepAlive: false });

  const calls = [];
  let answer = null;
  let thrown = null;
  // The review-request double is a FUNCTION, so one closed test authority can
  // answer, defer, reject or throw without a second fixture. It reaches no
  // reviewer, no provider and no paid API — nothing here executes a review.
  let requestResult = null;
  // The checkpoint double is a FUNCTION for the same reason: one closed test
  // authority can record, refuse, fail to release its claim or blow up without
  // a second fixture. It writes no checkpoint record, takes no claim, runs no
  // git command and creates no commit — nothing here checkpoints anything.
  let checkpointResult = null;
  const controlAuthorities = {
    prepareIndependentReview(runId) {
      calls.push({ route: 'prepareIndependentReview', runId });
      if (thrown) throw thrown;
      return answer;
    },
    runChecks(runId) { calls.push({ route: 'runChecks', runId }); return { runId }; },
    bindIndependentReview(runId) { calls.push({ route: 'bindIndependentReview', runId }); return { runId }; },
    requestIndependentReview(request) {
      calls.push({ route: 'requestIndependentReview', request });
      return requestResult === null ? null : requestResult();
    },
    checkpointRun(runId) {
      calls.push({ route: 'checkpointRun', runId });
      return checkpointResult === null ? null : checkpointResult();
    },
  };
  const preflightCalls = () => calls.filter((c) => c.route === 'prepareIndependentReview');
  const forbiddenCalls = () => calls.filter((c) => c.route !== 'prepareIndependentReview');
  const requestCalls = () => calls.filter((c) => c.route === 'requestIndependentReview');
  const checkpointCalls = () => calls.filter((c) => c.route === 'checkpointRun');
  // Every control that existed before the checkpoint route. A checkpoint case
  // asserts this list stayed empty, so the new route cannot quietly reach a
  // check, a binding, a preflight or a review request.
  const otherControlCalls = () => calls.filter((c) => c.route !== 'checkpointRun');
  const canonicalAnswer = (fields) => ({
    runId: RUN_ID, state: 'CHECKS_PASSED', action: 'prepare-independent-review',
    authority: 'aegis-run.cjs prepareIndependentReview (read-only)', mutations: 'NONE',
    pendingReviewers: [], ...fields,
  });
  // Shaped exactly like the canonical callable's own answer, including a
  // summary sentence the host must never republish.
  const canonicalRequestAnswer = (fields) => ({
    runId: RUN_ID, reviewer: 'codex', action: 'request-independent-review',
    authority: 'aegis-run.cjs requestIndependentReview',
    review: 'NOT_REQUESTED', reviewProcess: 'NOT_LAUNCHED', admission: 'NOT_ACQUIRED',
    reasonCode: 'REVIEW_NOT_PERMITTED', summary: `canonical text ${CANONICAL_ONLY}`, ...fields,
  });
  const expectedRequestDto = (review, reviewProcess, admission, reasonCode) => ({
    runId: RUN_ID, reviewer: 'codex', review,
    reviewProcess, reviewProcessSummary: S.PUBLIC_REVIEW_PROCESS_SUMMARIES[reviewProcess],
    admission, admissionSummary: S.PUBLIC_REVIEW_ADMISSION_SUMMARIES[admission],
    reasonCode, reasonSummary: S.PUBLIC_REVIEW_REQUEST_REASONS[reasonCode],
  });
  const ask = (path_, options = {}) => post(PORT, path_, { agent, ...options });
  const askPreflight = (body, extra = {}) => ask('/api/review-preflight', {
    headers: { authorization: 'Bearer ' + PREFLIGHT_TOKEN, 'content-type': 'application/json',
      origin: ORIGIN, ...(extra.headers || {}) },
    ...(extra.cookie ? { cookie: extra.cookie } : {}),
    body,
  });
  const askRequest = (body, extra = {}) => ask('/api/request-codex-review', {
    headers: { authorization: 'Bearer ' + PREFLIGHT_TOKEN, 'content-type': 'application/json',
      origin: ORIGIN, ...(extra.headers || {}) },
    ...(extra.cookie ? { cookie: extra.cookie } : {}),
    body,
  });
  const askCheckpoint = (body, extra = {}) => ask('/api/checkpoint', {
    headers: { authorization: 'Bearer ' + PREFLIGHT_TOKEN, 'content-type': 'application/json',
      origin: ORIGIN, ...(extra.headers || {}) },
    ...(extra.cookie ? { cookie: extra.cookie } : {}),
    body,
  });
  // The checkpoint coordinates a canonical answer carries, in the exact shapes
  // aegis-run's checkpoint authority produces them.
  const CHECKPOINT_ID = 'CP-20260904123456-0badc0de';
  const CREATED_AT = '2026-09-04T12:34:56.789Z';
  const ROLLBACK_POINT = 'a'.repeat(40);
  const TREE = 'b'.repeat(40);
  const CHECKPOINT_DIGEST = 'e'.repeat(64);
  // Shaped exactly like the canonical callable's own answer, including the
  // packet path, subject detail and objective a browser must never receive.
  const canonicalCheckpointAnswer = (fields) => ({
    runId: RUN_ID, state: 'CHECKPOINTED', action: 'checkpoint',
    checkpointId: CHECKPOINT_ID, createdAt: CREATED_AT,
    rollbackPoint: ROLLBACK_POINT, tree: TREE, digest: CHECKPOINT_DIGEST,
    reviewedBase: 'd'.repeat(40),
    packet: { path: S.SWITCHBOARD_PACKET, sha256: '7'.repeat(64) },
    subject: { subjectSha256: SUBJECT, pathCount: 2, diffBytes: 4096,
      reviewedRange: 'aaa..bbb', committedRange: 'ccc..ddd' },
    checkReceiptSha256: RECEIPT, checks: { passed: 13, total: 13 },
    objective: `canonical objective ${CANONICAL_ONLY}`,
    nextAction: 'rollback remains deferred',
    ...fields,
  });
  const recordedCheckpointDto = () => ({
    runId: RUN_ID, action: 'checkpoint', outcome: 'RECORDED', state: 'CHECKPOINTED',
    checkpointId: CHECKPOINT_ID, createdAt: CREATED_AT,
    rollbackPoint: ROLLBACK_POINT, tree: TREE, digest: CHECKPOINT_DIGEST,
    reasonCode: null, reasonSummary: null,
    summary: S.PUBLIC_CHECKPOINT_SUMMARIES.RECORDED,
  });
  const uncertainCheckpointDto = (reasonCode) => ({
    runId: RUN_ID, action: 'checkpoint', outcome: 'UNCERTAIN', state: null,
    checkpointId: null, createdAt: null, rollbackPoint: null, tree: null, digest: null,
    reasonCode, reasonSummary: S.PUBLIC_CHECKPOINT_UNCERTAIN_REASONS[reasonCode],
    summary: S.PUBLIC_CHECKPOINT_SUMMARIES.UNCERTAIN,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
  const waitFor = async (predicate, what) => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  // Each case owns the recorder and the stubbed answer outright. Resetting at
  // the end of a case only resets the cases that pass: one failed assertion
  // used to hand the next case a dirty call log and report a second failure
  // that was never a defect. The reset runs before the assertions, so nothing
  // here can swallow one.
  const ptest = (name, fn) => atest(name, () => {
    calls.length = 0;
    answer = null;
    thrown = null;
    requestResult = null;
    checkpointResult = null;
    return fn();
  });

  const v = S.validateConfig({ port: PORT, host: '127.0.0.1', token: PREFLIGHT_TOKEN }, {});
  assert.strictEqual(v.ok, true, 'the preflight transport fixture requires a validated config');
  const srv = http.createServer(S.handler(v.config, { controlAuthorities }));
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(new Error(
      `the preflight transport fixture could not reuse port ${PORT}: ${error.message}`));
    srv.once('error', onError);
    srv.listen(PORT, '127.0.0.1', () => { srv.off('error', onError); resolve(); });
  });

  try {
    await ptest('API RED: unauthenticated POST /api/review-preflight is 401 and reaches no authority', async () => {
      const r = await ask('/api/review-preflight', {
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: RUN_ID }),
      });
      assert.strictEqual(r.status, 401);
      const wrongToken = await ask('/api/review-preflight', {
        headers: { authorization: 'Bearer ' + 'x'.repeat(40), 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: RUN_ID }),
      });
      assert.strictEqual(wrongToken.status, 401);
      assert.deepStrictEqual(calls, [], 'an unauthenticated caller reached a control authority');
    });

    await ptest('API RED: GET and HEAD cannot dispatch the preflight question', async () => {
      const request = (method) => new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/review-preflight',
          method, agent, headers: { authorization: 'Bearer ' + PREFLIGHT_TOKEN } },
        (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
        req.on('error', () => resolve({ status: 0 }));
        req.end();
      });
      for (const method of ['GET', 'HEAD']) {
        assert.strictEqual((await request(method)).status, 405, `${method} reached the preflight dispatcher`);
      }
      assert.deepStrictEqual(calls, [], 'a non-POST request reached a control authority');
    });

    await ptest('API RED: a cookie-authenticated preflight is refused on origin before the body is read', async () => {
      const cookie = `aegis_session=${S.sessionFor(PREFLIGHT_TOKEN)}`;
      const noOrigin = await ask('/api/review-preflight', {
        headers: { 'content-type': 'application/json' }, cookie,
        body: JSON.stringify({ runId: RUN_ID }),
      });
      assert.strictEqual(noOrigin.status, 403);
      assert.strictEqual(JSON.parse(noOrigin.body).error.code, 'CSRF_ORIGIN_REQUIRED');
      const wrongOrigin = await ask('/api/review-preflight', {
        headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, cookie,
        body: 'not even json',
      });
      assert.strictEqual(wrongOrigin.status, 403);
      assert.strictEqual(JSON.parse(wrongOrigin.body).error.code, 'CSRF_ORIGIN_MISMATCH');
      const bearerWrongOrigin = await askPreflight(JSON.stringify({ runId: RUN_ID }),
        { headers: { origin: 'http://evil.example' } });
      assert.strictEqual(bearerWrongOrigin.status, 403);
      assert.deepStrictEqual(calls, [], 'a cross-origin request reached a control authority');
    });

    await ptest('API RED: the preflight body must be bounded, well-formed JSON naming only runId', async () => {
      const wrongType = await askPreflight(JSON.stringify({ runId: RUN_ID }),
        { headers: { 'content-type': 'text/plain' } });
      assert.strictEqual(wrongType.status, 415);

      const malformed = await askPreflight('{ not json');
      assert.strictEqual(malformed.status, 400);
      assert.strictEqual(JSON.parse(malformed.body).error.code, 'MALFORMED_JSON');

      const oversized = await askPreflight(JSON.stringify({
        runId: RUN_ID, pad: 'p'.repeat(S.MAX_API_BODY_BYTES + 1024) }));
      assert.strictEqual(oversized.status, 413);

      for (const key of ['model', 'reviewer', 'packet', 'spendUsd', 'command', 'provider',
        'verdict', 'permissionMode', 'cwd']) {
        const r = await askPreflight(JSON.stringify({ runId: RUN_ID, [key]: 'caller-controlled' }));
        assert.strictEqual(r.status, 400, `${key} was not refused: ${r.body}`);
        assert.strictEqual(JSON.parse(r.body).error.code, 'INVALID_REQUEST');
      }
      for (const body of ['[]', '"RUN-20260904-0badc0de"', '{}',
        JSON.stringify({ runId: '' }), JSON.stringify({ runId: 7 })]) {
        const r = await askPreflight(body);
        assert.strictEqual(r.status, 400, `${body} was not refused: ${r.body}`);
        assert.strictEqual(JSON.parse(r.body).error.code, 'INVALID_REQUEST');
      }
      assert.deepStrictEqual(calls, [],
        'a malformed, oversized or caller-augmented body reached a control authority');
    });

    await ptest('authenticated POST /api/review-preflight forwards exactly the runId, once', async () => {
      answer = canonicalAnswer({
        status: 'REVIEW_PERMITTED', reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
        nextAction: 'independent-review', lane: 'DEEP',
        requiredReviewers: ['gpt-5-codex', 'gemini'],
        pendingReviewers: [{ reviewer: 'gpt-5-codex', executed: 'MISSING', coverage: 'NONE' }],
        subject: { subjectSha256: SUBJECT, subjectPaths: ['builder-control/hosting/server.cjs'],
          diffBytes: 4096, range: 'aaa..bbb' },
        evidence: { source: 'CANONICAL_CHECK_RECEIPT', receiptSha256: RECEIPT, hostContainment: 'BOUND' },
        summary: `gpt-5-codex still owes an exact-subject review over 1 path(s). ${CANONICAL_ONLY}`,
      });
      const r = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.ok(/application\/json/.test(r.headers['content-type']));
      assert.deepStrictEqual(preflightCalls(), [{ route: 'prepareIndependentReview', runId: RUN_ID }],
        'the canonical preflight was not reached exactly once with the exact runId');
      assert.deepStrictEqual(forbiddenCalls(), [],
        'a read-only preflight reached the checks or binding authority');
      const parsed = JSON.parse(r.body);
      assert.deepStrictEqual(parsed, {
        runId: RUN_ID, state: 'CHECKS_PASSED', status: 'REVIEW_PERMITTED',
        statusSummary: S.PUBLIC_REVIEW_PREFLIGHT_STATUSES.REVIEW_PERMITTED,
        reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
        reasonSummary: S.PUBLIC_REVIEW_PREFLIGHT_REASONS.EXACT_SUBJECT_REVIEW_PENDING,
        nextAction: 'independent-review',
        requiredReviewers: ['gpt-5-codex', 'gemini'],
        pendingReviewers: [{ reviewer: 'gpt-5-codex', executed: 'MISSING', coverage: 'NONE' }],
        subjectSha256: SUBJECT, checkReceiptSha256: RECEIPT, hostContainment: 'BOUND',
        mutations: 'NONE',
      });
      assert.ok(!r.body.includes(CANONICAL_ONLY),
        `the response echoed canonical summary text the host never wrote: ${r.body}`);
      assert.ok(!/subjectPaths|server\.cjs|aaa\.\.bbb/.test(r.body),
        `the response leaked subject detail: ${r.body}`);
    });

    await ptest('the preflight distinguishes complete coverage and refusal, and neither approves a launch', async () => {
      answer = canonicalAnswer({
        status: 'NO_ADDITIONAL_REVIEW_NEEDED', reasonCode: 'EXACT_SUBJECT_REVIEW_COMPLETE',
        nextAction: 'bind-independent-review', requiredReviewers: ['gpt-5-codex'],
        subject: { subjectSha256: SUBJECT },
        evidence: { receiptSha256: RECEIPT, hostContainment: 'PENDING_AT_BINDING' },
      });
      const complete = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(complete.status, 200, complete.body);
      const completeBody = JSON.parse(complete.body);
      assert.strictEqual(completeBody.status, 'NO_ADDITIONAL_REVIEW_NEEDED');
      assert.strictEqual(completeBody.nextAction, 'bind-independent-review');
      assert.strictEqual(completeBody.hostContainment, 'PENDING_AT_BINDING');
      assert.strictEqual(completeBody.mutations, 'NONE');

      // The packet names this outcome refused with no action available.
      answer = canonicalAnswer({
        status: 'REFUSED', reasonCode: 'REVIEW-CYCLE-NO-PERMITTED-REVIEWER', nextAction: 'none',
        requiredReviewers: ['gpt-5-codex'],
        subject: { subjectSha256: SUBJECT },
        evidence: { receiptSha256: RECEIPT, hostContainment: 'BOUND' },
        summary: 'the canonical gate reports outstanding review work, but the canonical review cycle permits none.',
      });
      const refused = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(refused.status, 200,
        `a readable refusal is a successful reading: ${refused.body}`);
      const refusedBody = JSON.parse(refused.body);
      assert.strictEqual(refusedBody.status, 'REFUSED');
      assert.strictEqual(refusedBody.reasonCode, 'REVIEW-CYCLE-NO-PERMITTED-REVIEWER');
      assert.strictEqual(refusedBody.nextAction, 'none');
      assert.match(refusedBody.statusSummary, /No independent review can be prepared/);
      assert.ok(!/approved|permitted to launch|started/i.test(refusedBody.statusSummary),
        'a refused reading could be read as launch approval');
      assert.strictEqual(preflightCalls().length, 2);
      assert.deepStrictEqual(forbiddenCalls(), []);
    });

    await ptest('API RED: a hostile preflight answer cannot publish paths, transcripts or credentials', async () => {
      answer = {
        runId: RUN_ID, mutations: 'NONE', state: 'CHECKS_PASSED',
        status: 'REVIEW_PERMITTED', reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
        nextAction: 'independent-review',
        requiredReviewers: ['gpt-5-codex'],
        pendingReviewers: [{ reviewer: 'gpt-5-codex', executed: 'MISSING', coverage: 'NONE',
          transcript: HOSTILE_WORKER_OUTPUT.source, findings: [HOSTILE_WORKER_OUTPUT.pem] }],
        subject: { subjectSha256: SUBJECT, subjectPaths: ['/Users/someone/checkout/secret.cjs'] },
        evidence: { receiptSha256: RECEIPT, hostContainment: 'BOUND' },
        packet: { path: '/Users/someone/checkout/builder-control/packets/p.json' },
        commands: ['node builder-control/test/host-containment.test.cjs'],
        stdoutTail: HOSTILE_WORKER_OUTPUT.unlabelled,
        modelOutput: HOSTILE_WORKER_OUTPUT.source,
        credentials: HOSTILE_WORKER_OUTPUT.jwt + ' ' + HOSTILE_WORKER_OUTPUT.cookie,
        summary: HOSTILE_WORKER_OUTPUT.pem,
      };
      const r = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(r.status, 200, r.body);
      assertNoHostileWorkerOutput(JSON.parse(r.body), '/api/review-preflight');
      assert.ok(!/Users|packets|host-containment|secret\.cjs/.test(r.body),
        `the preflight response leaked a path, packet or command: ${r.body}`);
      assert.deepStrictEqual(Object.keys(JSON.parse(r.body)).sort(),
        ['checkReceiptSha256', 'hostContainment', 'mutations', 'nextAction', 'pendingReviewers',
          'reasonCode', 'reasonSummary', 'requiredReviewers', 'runId', 'state', 'status',
          'statusSummary', 'subjectSha256']);

      // An answer about another run, or one claiming a mutation, is not a
      // half-published result: it is a flat 500.
      for (const hostileAnswer of [
        { ...answer, runId: 'RUN-20260904-deadbeef' },
        { ...answer, mutations: 'RUN_RECORD_WRITTEN' },
        { ...answer, status: 'LAUNCHED' },
        'REVIEW_PERMITTED',
      ]) {
        answer = hostileAnswer;
        const refused = await askPreflight(JSON.stringify({ runId: RUN_ID }));
        assert.strictEqual(refused.status, 500, refused.body);
        assert.deepStrictEqual(JSON.parse(refused.body),
          { error: { code: 'INTERNAL_ERROR', message: 'internal error' } });
      }
      assert.deepStrictEqual(forbiddenCalls(), []);
    });

    await ptest('API RED: preflight exceptions map to fixed host text, never to canonical message echo', async () => {
      const { AegisControlError } = require('../aegis-run.cjs');
      const leaky = `preflight blew up reading /Users/someone/checkout/builder-control/runs/${RUN_ID}.json ` +
        HOSTILE_WORKER_OUTPUT.pem;

      thrown = new AegisControlError('REVIEW-GATE-UNREADABLE', leaky, 409);
      const unknownCode = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(unknownCode.status, 500, unknownCode.body);
      assert.deepStrictEqual(JSON.parse(unknownCode.body),
        { error: { code: 'INTERNAL_ERROR', message: 'internal error' } });

      thrown = new Error(leaky);
      const plain = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(plain.status, 500, plain.body);
      assert.deepStrictEqual(JSON.parse(plain.body),
        { error: { code: 'INTERNAL_ERROR', message: 'internal error' } });

      thrown = new AegisControlError('INVALID_RUN_ID', leaky, 400);
      const badId = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(badId.status, 400, badId.body);
      assert.deepStrictEqual(JSON.parse(badId.body), { error: { code: 'INVALID_RUN_ID',
        message: 'runId is not a canonical AEGIS run identifier.' } });

      thrown = new AegisControlError('RUN_NOT_FOUND', leaky, 404);
      const missing = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(missing.status, 404, missing.body);
      assert.deepStrictEqual(JSON.parse(missing.body), { error: { code: 'RUN_NOT_FOUND',
        message: 'No run with that identifier exists.' } });

      for (const response of [unknownCode, plain, badId, missing]) {
        assert.ok(!/Users|runs\/|BEGIN PRIVATE KEY/.test(response.body),
          `a preflight exception echoed canonical internals: ${response.body}`);
      }
      assert.deepStrictEqual(forbiddenCalls(), []);
    });

    // ── POST /api/request-codex-review ──────────────────────────────────────
    // The one action that ASKS for a review. Same transport fixture, same
    // closed doubles, same per-case reset — and still no reviewer, no provider
    // and no paid API anywhere in it.
    //
    // What these cases do NOT prove, deliberately: that a pending request means
    // a reviewer is running (it means this host is waiting for an outcome),
    // that the outcome survives a restart (there is no durable, reconnectable
    // status), or that a server-process death is recovered from (it is not —
    // the canonical hold is simply left unresolved).
    await ptest('API RED: unauthenticated, cross-origin, non-POST and malformed review requests reach no authority', async () => {
      const unauth = await ask('/api/request-codex-review', {
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: RUN_ID }),
      });
      assert.strictEqual(unauth.status, 401);

      const crossOrigin = await askRequest(JSON.stringify({ runId: RUN_ID }),
        { headers: { origin: 'http://evil.example' } });
      assert.strictEqual(crossOrigin.status, 403);
      const cookieNoOrigin = await ask('/api/request-codex-review', {
        headers: { 'content-type': 'application/json' },
        cookie: `aegis_session=${S.sessionFor(PREFLIGHT_TOKEN)}`,
        body: JSON.stringify({ runId: RUN_ID }),
      });
      assert.strictEqual(cookieNoOrigin.status, 403);
      assert.strictEqual(JSON.parse(cookieNoOrigin.body).error.code, 'CSRF_ORIGIN_REQUIRED');

      for (const method of ['GET', 'HEAD']) {
        const r = await new Promise((resolve) => {
          const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/request-codex-review',
            method, agent, headers: { authorization: 'Bearer ' + PREFLIGHT_TOKEN } },
          (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
          req.on('error', () => resolve({ status: 0 }));
          req.end();
        });
        assert.strictEqual(r.status, 405, `${method} reached the review-request dispatcher`);
      }

      const wrongType = await askRequest(JSON.stringify({ runId: RUN_ID }),
        { headers: { 'content-type': 'text/plain' } });
      assert.strictEqual(wrongType.status, 415);
      const malformed = await askRequest('{ not json');
      assert.strictEqual(malformed.status, 400);
      const oversized = await askRequest(JSON.stringify({
        runId: RUN_ID, pad: 'p'.repeat(S.MAX_API_BODY_BYTES + 1024) }));
      assert.strictEqual(oversized.status, 413);

      // The reviewer word is the server's. So is every other coordinate the
      // canonical callable refuses to take from a caller.
      for (const key of ['reviewer', 'packet', 'subject', 'subjectSha', 'command', 'timeoutSec',
        'processLifecycle', 'capUsd', 'allowMetered', 'approvedBy', 'model', 'provider']) {
        const r = await askRequest(JSON.stringify({ runId: RUN_ID, [key]: 'caller-controlled' }));
        assert.strictEqual(r.status, 400, `${key} was not refused: ${r.body}`);
        assert.strictEqual(JSON.parse(r.body).error.code, 'INVALID_REQUEST');
      }
      for (const body of ['[]', '{}', '"RUN-20260904-0badc0de"',
        JSON.stringify({ runId: '' }), JSON.stringify({ runId: 7 })]) {
        const r = await askRequest(body);
        assert.strictEqual(r.status, 400, `${body} was not refused: ${r.body}`);
      }
      // A well-formed body naming a non-canonical run id is refused by this
      // host before the authority is reached, so no unvalidated string is ever
      // handed to the canonical callable or echoed back out of it.
      const badId = await askRequest(JSON.stringify({ runId: '../../etc/passwd' }));
      assert.strictEqual(badId.status, 400, badId.body);
      assert.deepStrictEqual(JSON.parse(badId.body), { error: { code: 'INVALID_RUN_ID',
        message: 'runId is not a canonical AEGIS run identifier.' } });

      assert.deepStrictEqual(calls, [],
        'a refused review request reached a control authority');
    });

    await ptest('an authenticated review request awaits the canonical callable once, with the server-fixed Codex reviewer', async () => {
      requestResult = () => canonicalRequestAnswer({
        review: 'RECORD_WRITTEN', reviewProcess: 'DRAINED', admission: 'RELEASED',
        reasonCode: 'REVIEW_RECORD_WRITTEN',
      });
      const r = await askRequest(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.deepStrictEqual(calls, [{ route: 'requestIndependentReview',
        request: { runId: RUN_ID, reviewer: 'codex' } }],
      'the canonical review request was not made exactly once with only the validated runId and fixed reviewer');
      assert.deepStrictEqual(JSON.parse(r.body), expectedRequestDto(
        'RECORD_WRITTEN', 'DRAINED', 'RELEASED', 'REVIEW_RECORD_WRITTEN'));
      assert.ok(!r.body.includes(CANONICAL_ONLY),
        `the response echoed canonical summary text the host never wrote: ${r.body}`);
      assert.match(JSON.parse(r.body).reasonSummary, /not an approval and it moves no gate/,
        'a written review record was published without saying it approves nothing');
    });

    await ptest('a deferred canonical review request produces no premature success', async () => {
      let release;
      requestResult = () => new Promise((resolve) => { release = resolve; });
      const pending = askRequest(JSON.stringify({ runId: RUN_ID }));
      let responded = false;
      pending.then(() => { responded = true; });
      // A failed assertion must never leave the request open: the fixture's own
      // close() would then wait on a connection nothing will ever answer.
      try {
        await settle();
        assert.strictEqual(responded, false,
          'the host answered before the canonical review request produced an outcome');
        assert.strictEqual(requestCalls().length, 1, 'the deferred request was made more than once');
      } finally {
        release(canonicalRequestAnswer({ review: 'REVIEW_REFUSED', reviewProcess: 'DRAINED',
          admission: 'RELEASED', reasonCode: 'REVIEW_REQUEST_REFUSED' }));
      }
      const r = await pending;
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual(JSON.parse(r.body), expectedRequestDto(
        'REVIEW_REFUSED', 'DRAINED', 'RELEASED', 'REVIEW_REQUEST_REFUSED'));
      assert.strictEqual(requestCalls().length, 1);
    });

    await ptest('a client disconnect cancels nothing, retries nothing and releases nothing', async () => {
      let release;
      requestResult = () => new Promise((resolve) => { release = resolve; });
      const body = JSON.stringify({ runId: RUN_ID });
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/request-codex-review',
        method: 'POST', agent,
        headers: { authorization: 'Bearer ' + PREFLIGHT_TOKEN, 'content-type': 'application/json',
          origin: ORIGIN, 'content-length': Buffer.byteLength(body) } });
      req.on('error', () => { /* the socket is destroyed on purpose below */ });
      req.end(body);
      try {
        await waitFor(() => requestCalls().length === 1, 'the canonical review request');
        req.destroy();
        await settle();
        // The canonical call owns its own outcome. The disconnect must not have
        // torn it down, and the host must not have started a second one.
        assert.strictEqual(requestCalls().length, 1,
          'a client disconnect caused a duplicate or retried canonical review request');
      } finally {
        req.destroy();
        if (release) {
          release(canonicalRequestAnswer({ review: 'RECORD_WRITTEN', reviewProcess: 'UNDRAINED',
            admission: 'HELD', reasonCode: 'REVIEW_RECORD_WRITTEN' }));
        }
      }
      await settle();
      assert.strictEqual(requestCalls().length, 1,
        'the canonical review request was repeated after its outcome arrived');
      assert.deepStrictEqual(forbiddenCalls().filter((c) => c.route !== 'requestIndependentReview'), [],
        'a disconnected review request reached the checks or binding authority');
    });

    await ptest('API RED: refused, held, unconfirmed, malformed and rejected results leak nothing and free nothing', async () => {
      // Every canonical outcome that must not read as success, including the
      // held slot and the unconfirmed admission the callable reports.
      for (const [review, reviewProcess, admission, reasonCode] of [
        ['NOT_REQUESTED', 'NOT_LAUNCHED', 'NOT_ACQUIRED', 'ADMISSION_UNAVAILABLE'],
        ['NOT_REQUESTED', 'NOT_LAUNCHED', 'UNCONFIRMED', 'ADMISSION_UNCONFIRMED'],
        ['REVIEW_UNCOMPLETED', 'UNKNOWN', 'HELD', 'REVIEW_CALL_FAILED'],
        ['NOT_REQUESTED', 'NOT_LAUNCHED', 'NOT_ACQUIRED', 'REVIEW_EVIDENCE_CHANGED'],
      ]) {
        requestResult = () => canonicalRequestAnswer({ review, reviewProcess, admission, reasonCode });
        const r = await askRequest(JSON.stringify({ runId: RUN_ID }));
        assert.strictEqual(r.status, 200, r.body);
        assert.deepStrictEqual(JSON.parse(r.body),
          expectedRequestDto(review, reviewProcess, admission, reasonCode));
      }

      // A malformed, foreign or rejected canonical result is normalized to one
      // fixed unknown answer. It never claims the process stopped, and it never
      // reports the governed admission slot as freed.
      const unreadable = expectedRequestDto('UNKNOWN', 'UNKNOWN', 'UNCONFIRMED', 'REVIEW_RESULT_UNREADABLE');
      const hostile = canonicalRequestAnswer({
        review: 'APPROVED', reviewProcess: 'DRAINED', admission: 'RELEASED',
        reasonCode: 'REVIEW_RECORD_WRITTEN',
        transcript: HOSTILE_WORKER_OUTPUT.source, stdoutTail: HOSTILE_WORKER_OUTPUT.unlabelled,
        credentials: HOSTILE_WORKER_OUTPUT.jwt + ' ' + HOSTILE_WORKER_OUTPUT.cookie,
        packet: '/Users/someone/checkout/builder-control/packets/p.json',
        summary: HOSTILE_WORKER_OUTPUT.pem,
      });
      for (const result of [
        () => hostile,
        () => canonicalRequestAnswer({ runId: 'RUN-20260904-deadbeef' }),
        () => canonicalRequestAnswer({ reviewer: 'grok' }),
        () => canonicalRequestAnswer({ authority: 'somewhere-else' }),
        () => canonicalRequestAnswer({ reasonCode: 'REVIEW_RESULT_UNREADABLE' }),
        () => 'RECORD_WRITTEN',
        () => Promise.reject(new Error(
          `review blew up in /Users/someone/checkout ${HOSTILE_WORKER_OUTPUT.pem}`)),
        () => { throw new Error(`synchronous ${HOSTILE_WORKER_OUTPUT.jwt}`); },
      ]) {
        requestResult = result;
        const r = await askRequest(JSON.stringify({ runId: RUN_ID }));
        assert.strictEqual(r.status, 200, r.body);
        assert.deepStrictEqual(JSON.parse(r.body), unreadable, r.body);
        assertNoHostileWorkerOutput(JSON.parse(r.body), '/api/request-codex-review');
        assert.ok(!/Users|packets|BEGIN PRIVATE KEY/.test(r.body),
          `the review-request response leaked a path or credential: ${r.body}`);
      }
      assert.ok(!unreadable.reviewProcessSummary.includes('No reviewer process was started'),
        'an unreadable result claimed no reviewer process was started');
      assert.ok(!/released|freed/i.test(unreadable.admissionSummary),
        'an unreadable result claimed the governed admission slot was freed');
      assert.deepStrictEqual(forbiddenCalls().filter((c) => c.route !== 'requestIndependentReview'), []);
    });

    // ── POST /api/checkpoint ────────────────────────────────────────────────
    // The one control that RECORDS where a run reached. Same transport
    // fixture, same closed doubles, same per-case reset — and still no commit,
    // no claim, no git command and no checkpoint record anywhere in it.
    //
    // What these cases do NOT prove, deliberately: that the prerequisites are
    // satisfiable from here (they are decided by the canonical authority, and
    // the double stands in for it), or that a recorded checkpoint can be
    // restored (rollback stays deferred to its own packet).
    await ptest('API RED: unauthenticated, cross-origin, non-POST and malformed checkpoint requests reach no authority', async () => {
      const unauth = await ask('/api/checkpoint', {
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: RUN_ID }),
      });
      assert.strictEqual(unauth.status, 401);
      const wrongToken = await askCheckpoint(JSON.stringify({ runId: RUN_ID }),
        { headers: { authorization: 'Bearer ' + 'x'.repeat(40) } });
      assert.strictEqual(wrongToken.status, 401);

      const crossOrigin = await askCheckpoint(JSON.stringify({ runId: RUN_ID }),
        { headers: { origin: 'http://evil.example' } });
      assert.strictEqual(crossOrigin.status, 403);
      const cookieNoOrigin = await ask('/api/checkpoint', {
        headers: { 'content-type': 'application/json' },
        cookie: `aegis_session=${S.sessionFor(PREFLIGHT_TOKEN)}`,
        body: JSON.stringify({ runId: RUN_ID }),
      });
      assert.strictEqual(cookieNoOrigin.status, 403);
      assert.strictEqual(JSON.parse(cookieNoOrigin.body).error.code, 'CSRF_ORIGIN_REQUIRED');

      for (const method of ['GET', 'HEAD']) {
        const r = await new Promise((resolve) => {
          const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/checkpoint',
            method, agent, headers: { authorization: 'Bearer ' + PREFLIGHT_TOKEN } },
          (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
          req.on('error', () => resolve({ status: 0 }));
          req.end();
        });
        assert.strictEqual(r.status, 405, `${method} reached the checkpoint dispatcher`);
      }

      const wrongType = await askCheckpoint(JSON.stringify({ runId: RUN_ID }),
        { headers: { 'content-type': 'text/plain' } });
      assert.strictEqual(wrongType.status, 415);
      const malformed = await askCheckpoint('{ not json');
      assert.strictEqual(malformed.status, 400);
      assert.strictEqual(JSON.parse(malformed.body).error.code, 'MALFORMED_JSON');
      const oversized = await askCheckpoint(JSON.stringify({
        runId: RUN_ID, pad: 'p'.repeat(S.MAX_API_BODY_BYTES + 1024) }));
      assert.strictEqual(oversized.status, 413);

      // A checkpoint cannot be widened by describing one. Every coordinate the
      // canonical authority re-derives under its own claim is refused here.
      for (const key of ['commit', 'baseCommit', 'packet', 'packetId', 'force', 'override',
        'rollback', 'rollbackPoint', 'restore', 'deploy', 'checkpointId', 'tree', 'digest',
        'subject', 'subjectSha256', 'checks', 'reviewedBase', 'state', 'objective']) {
        const r = await askCheckpoint(JSON.stringify({ runId: RUN_ID, [key]: 'caller-controlled' }));
        assert.strictEqual(r.status, 400, `${key} was not refused: ${r.body}`);
        assert.strictEqual(JSON.parse(r.body).error.code, 'INVALID_REQUEST');
      }
      for (const body of ['[]', '{}', '"RUN-20260904-0badc0de"',
        JSON.stringify({ runId: '' }), JSON.stringify({ runId: 7 })]) {
        const r = await askCheckpoint(body);
        assert.strictEqual(r.status, 400, `${body} was not refused: ${r.body}`);
      }
      // A well-formed body naming a non-canonical run id is refused by this
      // host before the authority is reached, so no unvalidated string is ever
      // handed to the canonical checkpoint callable.
      for (const badRunId of ['../../etc/passwd', 'RUN-2026-0badc0de', 'run-20260904-0badc0de']) {
        const r = await askCheckpoint(JSON.stringify({ runId: badRunId }));
        assert.strictEqual(r.status, 400, r.body);
        assert.deepStrictEqual(JSON.parse(r.body), { error: { code: 'INVALID_RUN_ID',
          message: 'runId is not a canonical AEGIS run identifier.' } });
      }

      assert.deepStrictEqual(calls, [], 'a refused checkpoint request reached a control authority');
    });

    await ptest('an authenticated checkpoint invokes the canonical authority exactly once and publishes only validated coordinates', async () => {
      checkpointResult = () => canonicalCheckpointAnswer();
      const r = await askCheckpoint(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.ok(/application\/json/.test(r.headers['content-type']));
      assert.deepStrictEqual(checkpointCalls(), [{ route: 'checkpointRun', runId: RUN_ID }],
        'the canonical checkpoint authority was not reached exactly once with the exact runId');
      assert.deepStrictEqual(otherControlCalls(), [],
        'a checkpoint reached a check, binding, preflight or review-request authority');
      assert.deepStrictEqual(JSON.parse(r.body), recordedCheckpointDto());
      assert.ok(!r.body.includes(CANONICAL_ONLY),
        `the response echoed canonical objective text the host never wrote: ${r.body}`);
      // The callable's answer carries a relative packet path. It is
      // deliberately excluded from HTTP, along with the subject and its ranges.
      assert.ok(!/packets\/|PKT-|aaa\.\.bbb|ccc\.\.ddd|subjectSha256|diffBytes|objective/.test(r.body),
        `the checkpoint response leaked packet, subject or objective detail: ${r.body}`);
      assert.match(JSON.parse(r.body).summary, /restores no files and deploys nothing/,
        'a recorded checkpoint was published without saying it neither restores nor deploys');
    });

    await ptest('API RED: mismatched coordinates and hostile malformed checkpoint output are never published as a checkpoint', async () => {
      const unreadable = uncertainCheckpointDto('CHECKPOINT_RESULT_UNREADABLE');
      const hostile = canonicalCheckpointAnswer({
        transcript: HOSTILE_WORKER_OUTPUT.source, stdoutTail: HOSTILE_WORKER_OUTPUT.unlabelled,
        credentials: HOSTILE_WORKER_OUTPUT.jwt + ' ' + HOSTILE_WORKER_OUTPUT.cookie,
        worktree: '/Users/someone/checkout/builder-control',
        checkpointFile: '/Users/someone/checkout/builder-control/checkpoints/CP.json',
        summary: HOSTILE_WORKER_OUTPUT.pem,
        checkpointId: '../../etc/passwd',
      });
      for (const result of [
        // A hostile answer whose own checkpoint id is unusable.
        () => hostile,
        // Coordinates about another run, another action or another state.
        () => canonicalCheckpointAnswer({ runId: 'RUN-20260904-deadbeef' }),
        () => canonicalCheckpointAnswer({ runId: null }),
        () => canonicalCheckpointAnswer({ state: 'ROLLED_BACK' }),
        () => canonicalCheckpointAnswer({ state: 'REVIEW_BOUND' }),
        () => canonicalCheckpointAnswer({ action: 'rollback' }),
        // Coordinates that are the right names in the wrong shapes.
        () => canonicalCheckpointAnswer({ createdAt: 'just now' }),
        () => canonicalCheckpointAnswer({ rollbackPoint: 'HEAD' }),
        () => canonicalCheckpointAnswer({ tree: 'z'.repeat(40) }),
        () => canonicalCheckpointAnswer({ digest: 'e'.repeat(63) }),
        () => canonicalCheckpointAnswer({ checkpointId: 'CP-2026-0badc0de' }),
        () => 'CHECKPOINTED',
        () => [canonicalCheckpointAnswer()],
        () => null,
      ]) {
        checkpointResult = result;
        const r = await askCheckpoint(JSON.stringify({ runId: RUN_ID }));
        assert.strictEqual(r.status, 200, r.body);
        assert.deepStrictEqual(JSON.parse(r.body), unreadable, r.body);
        assertNoHostileWorkerOutput(JSON.parse(r.body), '/api/checkpoint');
        assert.ok(!/Users|checkpoints|BEGIN PRIVATE KEY|deadbeef/.test(r.body),
          `the checkpoint response leaked a path, credential or foreign run: ${r.body}`);
      }
      assert.ok(!/nothing changed|no checkpoint was recorded/i.test(JSON.stringify(unreadable)),
        'an unreadable checkpoint result claimed nothing changed');
      assert.deepStrictEqual(otherControlCalls(), []);
    });

    await ptest('API RED: known canonical checkpoint refusals map to fixed host wording, never a canonical message echo', async () => {
      const { AegisControlError } = require('../aegis-run.cjs');
      const leaky = `checkpoint refused in /Users/someone/checkout/builder-control/runs/${RUN_ID}.json ` +
        HOSTILE_WORKER_OUTPUT.pem;
      for (const [code, mapped] of Object.entries(S.PUBLIC_CHECKPOINT_REFUSALS)) {
        checkpointResult = () => { throw new AegisControlError(code, leaky, mapped.httpStatus); };
        const r = await askCheckpoint(JSON.stringify({ runId: RUN_ID }));
        assert.strictEqual(r.status, mapped.httpStatus, `${code}: ${r.body}`);
        assert.deepStrictEqual(JSON.parse(r.body),
          { error: { code, message: mapped.message } }, r.body);
        assert.ok(!/Users|runs\/|BEGIN PRIVATE KEY/.test(r.body),
          `a checkpoint refusal echoed canonical internals: ${r.body}`);
      }
      assert.strictEqual(checkpointCalls().length,
        Object.keys(S.PUBLIC_CHECKPOINT_REFUSALS).length,
        'a refused checkpoint reached the canonical authority more or less than once');
      assert.deepStrictEqual(otherControlCalls(), []);
    });

    await ptest('API RED: an unreleased claim and an unexpected failure report uncertainty, never that nothing changed', async () => {
      const { AegisControlError } = require('../aegis-run.cjs');
      const leaky = `checkpoint CP-20260904123456-0badc0de was recorded under ` +
        `/Users/someone/checkout/builder-control/checkpoints ${HOSTILE_WORKER_OUTPUT.pem}`;
      for (const [result, reasonCode] of [
        // The canonical post-write refusal: the record exists, the claim does not
        // provably. This must never read as "refused" and never as "recorded".
        [() => { throw new AegisControlError('CHECKPOINT_CLAIM_NOT_RELEASED', leaky, 409); },
          'CHECKPOINT_CLAIM_NOT_RELEASED'],
        // Anything raised deeper than the checkpoint gates — a refused ledger
        // append, an unavailable git or subject authority — is unknown, not safe.
        [() => { throw new AegisControlError('LEDGER-APPEND-REFUSED', leaky, 409); },
          'CHECKPOINT_CALL_FAILED'],
        [() => { throw new Error(leaky); }, 'CHECKPOINT_CALL_FAILED'],
        [() => { throw new TypeError(HOSTILE_WORKER_OUTPUT.jwt); }, 'CHECKPOINT_CALL_FAILED'],
      ]) {
        checkpointResult = result;
        const r = await askCheckpoint(JSON.stringify({ runId: RUN_ID }));
        assert.strictEqual(r.status, 200,
          `an uncertain outcome must be reported, not swallowed: ${r.body}`);
        const parsed = JSON.parse(r.body);
        assert.deepStrictEqual(parsed, uncertainCheckpointDto(reasonCode), r.body);
        assert.ok(!/Users|checkpoints|BEGIN PRIVATE KEY|eyJhbGciOi/.test(r.body),
          `an uncertain checkpoint echoed canonical internals: ${r.body}`);
        assert.ok(!/nothing changed|nothing was recorded|no checkpoint was recorded/i.test(r.body),
          `an uncertain checkpoint claimed nothing changed: ${r.body}`);
        assert.strictEqual(parsed.checkpointId, null,
          'an uncertain outcome published a checkpoint id it could not validate');
        assert.strictEqual(parsed.state, null,
          'an uncertain outcome published a lifecycle state it could not read');
      }
      assert.match(uncertainCheckpointDto('CHECKPOINT_CLAIM_NOT_RELEASED').reasonSummary,
        /could not prove it released/,
        'an unreleased claim was not reported as an unreleased claim');
      assert.deepStrictEqual(otherControlCalls(), []);
    });

    await ptest('the existing controls still route to their own authorities after a checkpoint', async () => {
      checkpointResult = () => canonicalCheckpointAnswer();
      assert.strictEqual((await askCheckpoint(JSON.stringify({ runId: RUN_ID }))).status, 200);

      answer = canonicalAnswer({
        status: 'REVIEW_PERMITTED', reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
        nextAction: 'independent-review', requiredReviewers: ['gpt-5-codex'],
        subject: { subjectSha256: SUBJECT },
        evidence: { receiptSha256: RECEIPT, hostContainment: 'BOUND' },
      });
      const preflight = await askPreflight(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(preflight.status, 200, preflight.body);
      assert.strictEqual(JSON.parse(preflight.body).status, 'REVIEW_PERMITTED');

      requestResult = () => canonicalRequestAnswer({ review: 'NOT_REQUESTED',
        reviewProcess: 'NOT_LAUNCHED', admission: 'NOT_ACQUIRED',
        reasonCode: 'ADMISSION_UNAVAILABLE' });
      const requested = await askRequest(JSON.stringify({ runId: RUN_ID }));
      assert.strictEqual(requested.status, 200, requested.body);
      assert.deepStrictEqual(JSON.parse(requested.body), expectedRequestDto(
        'NOT_REQUESTED', 'NOT_LAUNCHED', 'NOT_ACQUIRED', 'ADMISSION_UNAVAILABLE'));

      const checks = await ask('/api/checks', {
        headers: { authorization: 'Bearer ' + PREFLIGHT_TOKEN, 'content-type': 'application/json',
          origin: ORIGIN },
        body: JSON.stringify({ runId: RUN_ID }),
      });
      assert.strictEqual(checks.status, 200, checks.body);
      assert.deepStrictEqual(JSON.parse(checks.body), { runId: RUN_ID });

      assert.deepStrictEqual(calls.map((c) => c.route),
        ['checkpointRun', 'prepareIndependentReview', 'requestIndependentReview', 'runChecks'],
        'the checkpoint route disturbed the existing control routing');
      assert.strictEqual(checkpointCalls().length, 1,
        'an existing control reached the canonical checkpoint authority');
    });
  } finally {
    agent.destroy();
    await new Promise((resolve) => srv.close(resolve));
  }
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
      // The preflight is read-only, so the composition seam records the runId
      // and then asks the REAL canonical authority. The route therefore behaves
      // identically whether or not this seam is supplied.
      prepareIndependentReview(runId) {
        record('prepareIndependentReview', runId);
        return AegisRun.prepareIndependentReview(runId);
      },
      // Closed and inert: the seam records the request and answers with a
      // canonical-shaped refusal. No reviewer, no paid API and no admission
      // slot is ever reached from this fixture.
      async requestIndependentReview(request) {
        record('requestIndependentReview', request && request.runId);
        return { runId: request.runId, reviewer: request.reviewer,
          action: 'request-independent-review',
          authority: 'aegis-run.cjs requestIndependentReview',
          review: 'NOT_REQUESTED', reviewProcess: 'NOT_LAUNCHED', admission: 'NOT_ACQUIRED',
          reasonCode: 'REVIEW_NOT_PERMITTED', summary: 'fixture refusal' };
      },
      // Closed and inert for the same reason: the seam records the runId and
      // answers with a canonical-shaped refusal. No checkpoint record is
      // written, no per-run claim is taken and no commit is created here.
      checkpointRun(runId) {
        record('checkpointRun', runId);
        throw new AegisRun.AegisControlError('INVALID_CHECKPOINT',
          'checkpoint requires REVIEW_BOUND', 409);
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

    await atest('API RED: unauthenticated POST /api/review-preflight is 401', async () => {
      const r = await post(PORT, '/api/review-preflight', {
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

    // The canonical read-only preflight, over HTTP, against the real
    // aegis-run authority: a run that has not reached CHECKS_PASSED is a
    // readable REFUSED reading, and reading it changes nothing.
    await atest('authenticated POST /api/review-preflight reads readiness without launching or mutating anything', async () => {
      const intake = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'review preflight readiness proof' }),
      });
      assert.strictEqual(intake.status, 200, intake.body);
      const preflightRunId = JSON.parse(intake.body).runId;
      const runFile = path.join(runsDir, `${preflightRunId}.json`);
      const runBefore = fs.readFileSync(runFile, 'utf8');
      const ledgerBefore = fs.readFileSync(ledger, 'utf8');

      for (const key of ['model', 'reviewer', 'packet', 'spendUsd', 'command', 'verdict']) {
        const injected = await post(PORT, '/api/review-preflight', {
          headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ runId: preflightRunId, [key]: 'caller-controlled' }),
        });
        assert.strictEqual(injected.status, 400, `${key} was not refused: ${injected.body}`);
        assert.strictEqual(JSON.parse(injected.body).error.code, 'INVALID_REQUEST');
      }

      const r = await post(PORT, '/api/review-preflight', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: preflightRunId }),
      });
      assert.strictEqual(r.status, 200, r.body);
      const parsed = JSON.parse(r.body);
      assert.strictEqual(parsed.runId, preflightRunId);
      assert.strictEqual(parsed.state, 'INTAKE_RECORDED');
      assert.strictEqual(parsed.status, 'REFUSED');
      assert.strictEqual(parsed.reasonCode, 'REVIEW-WRONG-STATE');
      assert.strictEqual(parsed.nextAction, 'none');
      assert.strictEqual(parsed.mutations, 'NONE');
      assert.deepStrictEqual(parsed.pendingReviewers, []);
      assert.strictEqual(parsed.subjectSha256, null);
      assert.strictEqual(parsed.hostContainment, null);
      assert.ok(!/CHECKS_PASSED, run is|Users|worktree/.test(r.body),
        `the preflight echoed a canonical generated message: ${r.body}`);

      assert.strictEqual(fs.readFileSync(runFile, 'utf8'), runBefore,
        'a read-only review preflight mutated the run record');
      assert.strictEqual(fs.readFileSync(ledger, 'utf8'), ledgerBefore,
        'a read-only review preflight wrote a lifecycle event');

      const unknown = await post(PORT, '/api/review-preflight', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-20260825-deadbeef' }),
      });
      assert.strictEqual(unknown.status, 404, unknown.body);
      assert.deepStrictEqual(JSON.parse(unknown.body), { error: { code: 'RUN_NOT_FOUND',
        message: 'No run with that identifier exists.' } });

      const malformedId = await post(PORT, '/api/review-preflight', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: '../../etc/passwd' }),
      });
      assert.strictEqual(malformedId.status, 400, malformedId.body);
      assert.deepStrictEqual(JSON.parse(malformedId.body), { error: { code: 'INVALID_RUN_ID',
        message: 'runId is not a canonical AEGIS run identifier.' } });
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
