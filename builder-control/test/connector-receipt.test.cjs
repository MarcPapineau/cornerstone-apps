#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyReceipt } = require('../connector-receipt.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'builder-control', 'connector-receipt.cjs');
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'builder-control', 'connector-registry.json'), 'utf8'));
const NOW = Date.parse('2026-08-25T16:40:00Z');
let passed = 0;
// The count of failures is COUNTED, not inferred from the exit code. It used to
// print `process.exitCode ? 1 : 0`, so nineteen failing proofs reported as
// "1 failed" — a suite that under-reports its own failures is the same class of
// defect as a dashboard that under-reports an outage.
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
// ── CORRECTION CYCLE 2: fixtures start from NO recorded evidence ───────────
// Evidence is now chronologically monotonic. A fixture that applied a receipt
// older than the live registry's recorded probe would be a no-op for the RIGHT
// reason and would therefore prove nothing about the case under test. Fixtures
// begin with a connector that has never been probed; the monotonicity proofs
// build their own history explicitly, which is the only place it belongs.
function registry() {
  const copy = JSON.parse(JSON.stringify(BASE));
  for (const c of copy.connectors) {
    c.healthEvidence = null; c.authEvidence = null; c.verificationEvidence = null;
    c.usageEvidence = null; c.lastSuccess = null; c.lastFailure = null; c.failureCount = 0;
  }
  return copy;
}
function receipt(extra = {}) {
  return {
    connectorId: 'notion', observedAt: '2026-08-25T16:36:00Z',
    health: 'HEALTHY', authStatus: 'AUTHENTICATED',
    method: 'Notion MCP search and fetch',
    result: 'Requested architecture page was found and readable; content omitted.',
    operationId: 'notion-probe-20260825T163600Z', ...extra,
  };
}

console.log('AEGIS connector receipt — fail-honest proofs');

test('successful evidence makes Notion healthy without granting authority', () => {
  const out = applyReceipt(registry(), receipt(), NOW).registry;
  const notion = out.connectors.find((item) => item.connectorId === 'notion');
  assert.strictEqual(notion.health, 'HEALTHY');
  assert.strictEqual(notion.authStatus, 'AUTHENTICATED');
  assert.strictEqual(notion.lastSuccess, receipt().observedAt);
  assert.strictEqual(notion.plane, 'INTEGRATION');
  assert.ok(!('engineeringVerdict' in notion));
});

test('HEALTHY without authenticated evidence is refused', () => {
  assert.throws(() => applyReceipt(registry(), receipt({ authStatus: 'NOT_AUTHORIZED' }), NOW), /requires AUTHENTICATED/);
});

test('authority-shaped and credential-shaped evidence is refused', () => {
  assert.throws(() => applyReceipt(registry(), { ...receipt(), engineeringVerdict: 'PASS' }, NOW), /not allowed/);
  assert.throws(() => applyReceipt(registry(), receipt({ result: 'access_token=abc123' }), NOW), /credential/);
});

test('duplicate operationId is an auditable no-op', () => {
  const first = applyReceipt(registry(), receipt(), NOW).registry;
  const second = applyReceipt(first, receipt({ result: 'different retry text' }), NOW);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(second.registry.connectors.find((item) => item.connectorId === 'notion').healthEvidence.result,
    receipt().result);
});

test('CLI writes atomically to an isolated registry', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-connector-'));
  const reg = path.join(dir, 'connector-registry.json');
  const input = path.join(dir, 'receipt.json');
  fs.writeFileSync(reg, JSON.stringify(registry()));
  fs.writeFileSync(input, JSON.stringify(receipt()));
  const run = spawnSync('node', [CLI, '--record', input], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, AEGIS_CONNECTOR_REGISTRY: reg },
  });
  assert.strictEqual(run.status, 0, run.stderr);
  const saved = JSON.parse(fs.readFileSync(reg, 'utf8'));
  assert.strictEqual(saved.connectors.find((item) => item.connectorId === 'notion').health, 'HEALTHY');
  assert.ok(!fs.existsSync(reg + '.lock'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── CORRECTION CYCLE 1 (PKT-20260825-GOVERNANCE-TRUTH) ─────────────────────
// Authentication, verification and usage are three separate claims. These
// proofs hold that a HEALTH receipt records auth independently of health, that
// a stale observedAt is stored exactly as given (staleness is judged later, at
// projection time, never rewritten here), that a HEALTH receipt never invents
// usage, and that a USAGE receipt records the exact run and touches nothing
// about credentials or health.

test('authentication is recorded independent of health: AUTHENTICATED with DEGRADED health is accepted', () => {
  const out = applyReceipt(registry(), receipt({ health: 'DEGRADED' }), NOW).registry;
  const notion = out.connectors.find((item) => item.connectorId === 'notion');
  assert.strictEqual(notion.authStatus, 'AUTHENTICATED', 'authentication must record even when health is not HEALTHY');
  assert.strictEqual(notion.health, 'DEGRADED');
});

test('a stale observedAt is stored exactly as given — staleness is judged at projection time, not rewritten here', () => {
  const old = '2026-08-01T00:00:00Z';
  const out = applyReceipt(registry(), receipt({ observedAt: old, operationId: 'notion-probe-stale' }), NOW).registry;
  const notion = out.connectors.find((item) => item.connectorId === 'notion');
  assert.strictEqual(notion.healthEvidence.observedAt, old, 'the receipt must not silently freshen an old observedAt');
});

test('a HEALTH receipt never writes usageEvidence — no run has used it stays no run has used it', () => {
  const out = applyReceipt(registry(), receipt(), NOW).registry;
  const notion = out.connectors.find((item) => item.connectorId === 'notion');
  assert.strictEqual(notion.usageEvidence, null, 'authenticating and probing a connector must not be recorded as a run using it');
});

test('a USAGE receipt records the exact run and touches nothing about credentials or health', () => {
  const before = registry();
  const beforeNotion = before.connectors.find((item) => item.connectorId === 'notion');
  const usage = {
    connectorId: 'notion', receiptKind: 'USAGE', observedAt: '2026-08-25T16:40:00Z',
    runId: 'RUN-20260825-001', method: 'Notion MCP fetch', result: 'page read for subject binding',
    operationId: 'notion-usage-20260825T164000Z', citedSource: 'builder-control/specs/spec.md',
  };
  const out = applyReceipt(before, usage, NOW).registry;
  const notion = out.connectors.find((item) => item.connectorId === 'notion');
  assert.deepStrictEqual(notion.usageEvidence, {
    observedAt: usage.observedAt, runId: usage.runId, method: usage.method,
    result: usage.result, operationId: usage.operationId, citedSource: usage.citedSource,
  });
  assert.strictEqual(notion.authStatus, beforeNotion.authStatus, 'a USAGE receipt must not touch authStatus');
  assert.strictEqual(notion.health, beforeNotion.health, 'a USAGE receipt must not touch health');
  assert.strictEqual(notion.lastSuccess, beforeNotion.lastSuccess, 'a USAGE receipt must not touch lastSuccess');
});

test('a duplicate USAGE operationId is an auditable no-op, exactly like a duplicate HEALTH receipt', () => {
  const usage = {
    connectorId: 'notion', receiptKind: 'USAGE', observedAt: '2026-08-25T16:40:00Z',
    runId: 'RUN-20260825-001', method: 'm', result: 'r', operationId: 'notion-usage-dup',
  };
  const first = applyReceipt(registry(), usage, NOW).registry;
  const second = applyReceipt(first, { ...usage, runId: 'RUN-DIFFERENT' }, NOW);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(second.registry.connectors.find((item) => item.connectorId === 'notion').usageEvidence.runId, 'RUN-20260825-001');
});

test('a USAGE receipt requires an exact runId — "the nightly job" is not a run identifier and is refused', () => {
  assert.throws(() => applyReceipt(registry(), {
    connectorId: 'notion', receiptKind: 'USAGE', observedAt: '2026-08-25T16:40:00Z',
    runId: 'the nightly job', method: 'm', result: 'r', operationId: 'notion-usage-vague',
  }, NOW), /exact run identifier/);
});


// ── CORRECTION CYCLE 2 (Codex REV-20260825234549 findings 5, 6, 9) ─────────
// Three defects, three groups of proofs:
//   #5 the secret regex knew `access_token` and `bearer` and nothing else
//   #6 a writer that LOST the lock race deleted the winner's lock anyway
//   #9 an August 1 receipt applied after August 25 rewound lastUsedByRun
// Each proof below fails loudly against the previous implementation.

const {
  credentialReason, sanitizeCitedSource, acquireLock, recordReceipt,
  MAX_EVIDENCE_CHARS,
} = require('../connector-receipt.cjs');

function usage(extra = {}) {
  return {
    connectorId: 'notion', receiptKind: 'USAGE', observedAt: '2026-08-25T16:39:00Z',
    runId: 'RUN-20260825-001', method: 'Notion MCP fetch', result: 'page read for subject binding',
    operationId: 'notion-usage-base', ...extra,
  };
}
function notion(reg) { return reg.connectors.find((item) => item.connectorId === 'notion'); }

// ── #5 credentials ─────────────────────────────────────────────────────────
const CREDENTIAL_CASES = [
  ['a GitHub personal access token', 'used PAT ghp_abcdefghijklmnopqrstuvwxyz123456'],
  ['a fine-grained GitHub token', 'github_pat_11ABCDEFG0abcdefghijklmnop'],
  ['a bearer header value', 'called with Authorization Bearer abcdef.ghijkl-mnopqr'],
  ['a generic token query parameter', 'fetched https://example.invalid/source?token=abcdefghijkl'],
  ['an api_key query parameter', 'fetched https://example.invalid/x?api_key=abcdefghijkl'],
  ['URL userinfo', 'fetched https://user:hunter2@example.invalid/source'],
  ['an Anthropic-style key', 'key sk-ant-abcdefghijklmnopqrstuvwx'],
  ['a Slack token', 'posted with xoxb-1234567890-abcdefghijkl'],
  ['an AWS access key id', 'assumed AKIAIOSFODNN7EXAMPLE'],
  ['a Google API key', 'AIzaSyA1234567890abcdefghijklmnopqrstuvw'],
  ['a session identifier', 'session_id=9f8e7d6c5b4a3210'],
  ['a labelled password', 'password: hunter2'],
  ['a JSON Web Token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'],
  ['an unlabelled high-entropy secret', 'value tR7xQm2LpZ0aVbNc8YeWuJ4KsHdG1fXo'],
];

test('finding #5: every known credential shape is refused, in method, in result AND in citedSource', () => {
  for (const [label, text] of CREDENTIAL_CASES) {
    assert.ok(credentialReason(text), `${label} was not recognised as a credential: ${text}`);
    assert.throws(() => applyReceipt(registry(), receipt({ result: text, operationId: 'op-r' }), NOW),
      /credential/i, `${label} was accepted in result`);
    assert.throws(() => applyReceipt(registry(), receipt({ method: text, operationId: 'op-m' }), NOW),
      /credential/i, `${label} was accepted in method`);
  }
  // The exact string the reviewer walked in with, on the exact field it used.
  assert.throws(() => applyReceipt(registry(), usage({
    result: 'used PAT ghp_abcdefghijklmnopqrstuvwxyz123456',
  }), NOW), /credential/i, 'the reviewed GitHub-PAT USAGE receipt is still accepted');
  assert.throws(() => applyReceipt(registry(), usage({
    citedSource: 'https://example.invalid/source?token=ghp_abcdefghijklmnopqrstuvwxyz123456',
  }), NOW), /credential|query string/i, 'the reviewed credential-bearing citedSource is still accepted');
});

test('finding #5: ordinary evidence is NOT refused — the rule table must not be a blanket ban', () => {
  const out = applyReceipt(registry(), receipt(), NOW).registry;
  assert.strictEqual(notion(out).healthEvidence.result, receipt().result);
  assert.strictEqual(credentialReason('Authenticated active account confirmed; credential value omitted.'), null);
  assert.strictEqual(credentialReason('AEGIS Integration Plane toolbox is accessible.'), null);
});

test('finding #5: citedSource is allowlisted — a path or a clean http(s) URL, nothing else', () => {
  assert.strictEqual(sanitizeCitedSource('builder-control/specs/spec.md'), 'builder-control/specs/spec.md');
  assert.strictEqual(sanitizeCitedSource('https://example.invalid/page'), 'https://example.invalid/page');
  assert.throws(() => sanitizeCitedSource('https://example.invalid/p?session=abc'), /query string|credential/i);
  assert.throws(() => sanitizeCitedSource('https://u:p@example.invalid/p'), /credential/i);
  assert.throws(() => sanitizeCitedSource('../../etc/passwd'), /traversal|repository-relative/i);
  assert.throws(() => sanitizeCitedSource('file:///etc/shadow'), /http\(s\)/i);
});

test('finding #5: evidence is BOUNDED — raw connector output is refused, not quietly stored', () => {
  const huge = 'page content '.repeat(60); // well over the bound, no credential in it
  assert.ok(huge.length > MAX_EVIDENCE_CHARS);
  assert.throws(() => applyReceipt(registry(), receipt({ result: huge }), NOW), /evidence bound/);
  const stored = applyReceipt(registry(), receipt({ result: '  spaced\n\tsummary  ' }), NOW).registry;
  assert.strictEqual(notion(stored).healthEvidence.result, 'spaced summary', 'evidence must be normalised before it is persisted');
});

// ── #9 chronological monotonicity ──────────────────────────────────────────
test('finding #9: an OLDER usage receipt cannot overwrite a newer one — it is a superseded no-op', () => {
  const newer = usage({ observedAt: '2026-08-25T16:39:00Z', runId: 'RUN-NEW', operationId: 'op-new' });
  const older = usage({ observedAt: '2026-08-01T00:00:00Z', runId: 'RUN-OLD', operationId: 'op-old' });
  const afterNew = applyReceipt(registry(), newer, NOW).registry;
  const outcome = applyReceipt(afterNew, older, NOW);
  assert.strictEqual(outcome.superseded, true, 'an older receipt must be reported as superseded, not applied');
  assert.strictEqual(notion(outcome.registry).usageEvidence.runId, 'RUN-NEW',
    'lastUsedByRun regressed to an older run — the exact defect this proof exists for');
});

test('finding #9: applying the same receipts in ANY order lands on the same last-used run', () => {
  const a = usage({ observedAt: '2026-08-01T00:00:00Z', runId: 'RUN-A', operationId: 'op-a' });
  const b = usage({ observedAt: '2026-08-20T00:00:00Z', runId: 'RUN-B', operationId: 'op-b' });
  const c = usage({ observedAt: '2026-08-25T16:39:00Z', runId: 'RUN-C', operationId: 'op-c' });
  const orders = [[a, b, c], [c, b, a], [b, c, a], [c, a, b]];
  const landed = orders.map((order) => {
    let reg = registry();
    for (const r of order) reg = applyReceipt(reg, r, NOW).registry;
    return notion(reg).usageEvidence;
  });
  for (const state of landed) {
    assert.strictEqual(state.runId, 'RUN-C', 'the newest authoritative usage must win regardless of arrival order');
    assert.deepStrictEqual(state, landed[0], 'the same receipts in a different order produced different state');
  }
});

test('finding #9: a retried OLD operation after a newer one does not regress the state', () => {
  let reg = registry();
  const old = usage({ observedAt: '2026-08-01T00:00:00Z', runId: 'RUN-OLD', operationId: 'op-old' });
  reg = applyReceipt(reg, old, NOW).registry;
  reg = applyReceipt(reg, usage({ observedAt: '2026-08-25T16:39:00Z', runId: 'RUN-NEW', operationId: 'op-new' }), NOW).registry;
  const retry = applyReceipt(reg, old, NOW);
  assert.strictEqual(retry.superseded, true);
  assert.strictEqual(notion(retry.registry).usageEvidence.runId, 'RUN-NEW');
});

test('finding #9: equal timestamps break the tie deterministically, not by arrival order', () => {
  const t = '2026-08-25T16:39:00Z';
  const x = usage({ observedAt: t, runId: 'RUN-X', operationId: 'op-x' });
  const y = usage({ observedAt: t, runId: 'RUN-Y', operationId: 'op-y' });
  const xy = notion(applyReceipt(applyReceipt(registry(), x, NOW).registry, y, NOW).registry).usageEvidence;
  const yx = notion(applyReceipt(applyReceipt(registry(), y, NOW).registry, x, NOW).registry).usageEvidence;
  assert.deepStrictEqual(xy, yx, 'a tie must resolve to the same evidence in either order');
});

test('finding #9: an older HEALTH receipt cannot overwrite newer health evidence either', () => {
  let reg = registry();
  reg = applyReceipt(reg, receipt({ observedAt: '2026-08-25T16:36:00Z', operationId: 'probe-new' }), NOW).registry;
  const outcome = applyReceipt(reg, receipt({
    observedAt: '2026-08-01T00:00:00Z', operationId: 'probe-old', health: 'FAILED', authStatus: 'AUTH_EXPIRED',
    result: 'timeout',
  }), NOW);
  assert.strictEqual(outcome.superseded, true);
  assert.strictEqual(notion(outcome.registry).health, 'HEALTHY', 'a month-old failure overwrote a newer successful probe');
  assert.strictEqual(notion(outcome.registry).authStatus, 'AUTHENTICATED');
});

// ── dated authentication + preserved verification (finding #3, write side) ──
test('finding #3: a HEALTH receipt persists DATED authentication evidence, not a bare string', () => {
  const out = applyReceipt(registry(), receipt(), NOW).registry;
  const ev = notion(out).authEvidence;
  assert.ok(ev && ev.observedAt === receipt().observedAt, 'authentication was persisted with no observation date');
  assert.strictEqual(ev.authStatus, 'AUTHENTICATED');
  assert.strictEqual(ev.operationId, receipt().operationId);
});

test('finding #3: only a SUCCESSFUL probe dates a verification, and a later failure never erases it', () => {
  let reg = applyReceipt(registry(), receipt(), NOW).registry;
  const success = notion(reg).verificationEvidence;
  assert.ok(success && success.observedAt === receipt().observedAt, 'a successful probe recorded no verification evidence');
  reg = applyReceipt(reg, receipt({
    observedAt: '2026-08-25T16:38:00Z', operationId: 'probe-fail', health: 'FAILED',
    authStatus: 'NOT_AUTHORIZED', result: 'timeout after 30s',
  }), NOW).registry;
  assert.deepStrictEqual(notion(reg).verificationEvidence, success,
    'a failed probe overwrote the record of the last time the service actually responded');
  assert.strictEqual(notion(reg).healthEvidence.outcome, 'FAILURE');
  assert.strictEqual(notion(reg).lastSuccess, receipt().observedAt, 'lastSuccess must survive a later failure');
});

test('finding #3: a DEGRADED probe is INCONCLUSIVE — it does not date a verification', () => {
  const out = applyReceipt(registry(), receipt({ health: 'DEGRADED', operationId: 'probe-degraded' }), NOW).registry;
  assert.strictEqual(notion(out).healthEvidence.outcome, 'INCONCLUSIVE');
  assert.ok(!notion(out).verificationEvidence, 'a degraded probe must not count as a verification');
  assert.ok(!notion(out).lastSuccess, 'a degraded probe must not record a successful response');
});

// ── #6 lock ownership ──────────────────────────────────────────────────────
test('finding #6: a writer that CANNOT take the lock removes nothing and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-lock-'));
  const reg = path.join(dir, 'connector-registry.json');
  const lock = reg + '.lock';
  fs.writeFileSync(reg, JSON.stringify(registry()));
  fs.writeFileSync(lock, 'held by another writer');           // somebody else owns it
  const before = fs.readFileSync(reg, 'utf8');
  assert.throws(() => recordReceipt(receipt(), reg), /locked by another writer/);
  assert.ok(fs.existsSync(lock), 'the loser deleted the winner\'s lock — the exact reviewed defect');
  assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'held by another writer', 'the lock file was rewritten by a non-owner');
  assert.strictEqual(fs.readFileSync(reg, 'utf8'), before, 'a writer without the lock modified the registry');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finding #6: contention is bounded and reported, and the owner still releases its own lock', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-lock2-'));
  const lock = path.join(dir, 'x.lock');
  const fd = acquireLock(lock, 2, 1);
  assert.ok(fs.existsSync(lock));
  assert.throws(() => acquireLock(lock, 2, 1), /locked by another writer/);
  assert.ok(fs.existsSync(lock), 'the failed second acquirer removed the first acquirer\'s lock');
  fs.closeSync(fd); fs.unlinkSync(lock);
  const again = acquireLock(lock, 2, 1);                       // released, so re-acquirable
  fs.closeSync(again);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finding #6: concurrent writers serialise — every accepted update survives and the JSON stays valid', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-conc-'));
  const reg = path.join(dir, 'connector-registry.json');
  fs.writeFileSync(reg, JSON.stringify(registry()));
  const inputs = [
    receipt({ connectorId: 'notion', observedAt: '2026-08-25T16:30:00Z', operationId: 'c-notion' }),
    receipt({ connectorId: 'github', observedAt: '2026-08-25T16:31:00Z', operationId: 'c-github',
      method: 'GitHub CLI authentication probe', result: 'active account confirmed' }),
    receipt({ connectorId: 'make', observedAt: '2026-08-25T16:32:00Z', operationId: 'c-make',
      method: 'Make MCP toolbox inspection', result: 'toolbox accessible' }),
  ].map((r, i) => {
    const file = path.join(dir, `receipt-${i}.json`);
    fs.writeFileSync(file, JSON.stringify(r));
    return file;
  });
  const driver = `
    const { spawn } = require('child_process');
    const [cli, reg, ...files] = process.argv.slice(1);
    Promise.all(files.map((f) => new Promise((res) => {
      const p = spawn(process.execPath, [cli, '--record', f], { env: { ...process.env, AEGIS_CONNECTOR_REGISTRY: reg } });
      let out = '', err = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { err += d; });
      p.on('close', (code) => res({ code, out: out.trim(), err: err.trim() }));
    }))).then((r) => console.log(JSON.stringify(r)));
  `;
  const run = spawnSync('node', ['-e', driver, '--', CLI, reg, ...inputs], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  const results = JSON.parse(run.stdout.trim().split('\n').pop());
  const saved = JSON.parse(fs.readFileSync(reg, 'utf8'));       // must still be valid JSON
  assert.ok(!fs.existsSync(reg + '.lock'), 'a lock survived every writer exiting');
  for (const r of results) {
    if (r.code !== 0) assert.match(r.err, /locked by another writer/, `an unexpected failure: ${r.err}`);
  }
  for (const id of ['notion', 'github', 'make']) {
    const c = saved.connectors.find((item) => item.connectorId === id);
    const wrote = results.some((r) => r.code === 0);
    if (wrote) assert.ok(c.healthEvidence, `${id} lost its accepted update to a concurrent writer`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── the authority boundary this file has always enforced, still enforced ────
test('protocol authority: a receipt may not carry an engineering verdict, and only INTEGRATION-plane connectors accept one', () => {
  assert.throws(() => applyReceipt(registry(), { ...receipt(), engineeringVerdict: 'PASS' }, NOW), /not allowed/);
  const reg = registry();
  reg.connectors.push({ connectorId: 'rogue', plane: 'CONTROL', health: 'UNKNOWN' });
  assert.throws(() => applyReceipt(reg, receipt({ connectorId: 'rogue' }), NOW), /only INTEGRATION-plane/);
});

test('protocol authority: a USAGE receipt still cannot promote itself to authenticated or healthy', () => {
  assert.throws(() => applyReceipt(registry(), usage({ authStatus: 'AUTHENTICATED' }), NOW), /not allowed on a USAGE receipt/);
  assert.throws(() => applyReceipt(registry(), usage({ health: 'HEALTHY' }), NOW), /not allowed on a USAGE receipt/);
});

process.on('exit', () => console.log(`${passed} passed, ${failed} failed`));
