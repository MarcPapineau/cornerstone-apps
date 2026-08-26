#!/usr/bin/env node
/**
 * integration-runner.test.cjs — fail-honest proofs for the governed connector runner.
 *
 * FIXTURE ISOLATION
 * Every case runs against a PRIVATE registry and a PRIVATE ledger in a temp
 * directory. Nothing here reads or writes builder-control/connector-registry.json
 * or builder-control/ledger.json, and a final case proves that by hashing both
 * canonical files before and after the suite. That proof is not decoration: a
 * red-proof run of an earlier connector change wrote six fabricated usage
 * entries into the real ledger, and the only reason to trust a suite that
 * exercises writers is a measurement that it did not touch the real ones.
 *
 * The fixtures start with NO recorded usage evidence, so a duplicate refusal in
 * a test is caused by that test and not by history it inherited.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runIntegration } = require('../integration-runner.cjs');
const { readLedger } = require('../ledger-writer.cjs');

const BC = path.resolve(__dirname, '..');
const CANONICAL_REGISTRY = path.join(BC, 'connector-registry.json');
const CANONICAL_LEDGER = path.join(BC, 'ledger.json');
const BASE = JSON.parse(fs.readFileSync(CANONICAL_REGISTRY, 'utf8'));

function digest(file) {
  if (!fs.existsSync(file)) return 'ABSENT';
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const REGISTRY_BEFORE = digest(CANONICAL_REGISTRY);
const LEDGER_BEFORE = digest(CANONICAL_LEDGER);

const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-integration-'));
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} }
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

// ── the count of failures is COUNTED, never inferred from the exit code ─────
let passed = 0;
let failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

// A private registry + ledger pair per case, so one case can never see another.
let caseNo = 0;
function fixture(mutate) {
  const dir = path.join(TMP, `case-${++caseNo}`);
  fs.mkdirSync(dir);
  const registry = JSON.parse(JSON.stringify(BASE));
  for (const c of registry.connectors) {
    c.usageEvidence = null;
    c.healthEvidence = null;
    c.authEvidence = null;
    c.verificationEvidence = null;
    c.lastSuccess = null;
    c.lastFailure = null;
    c.failureCount = 0;
  }
  if (mutate) mutate(registry);
  const registryFile = path.join(dir, 'connector-registry.json');
  const ledgerFile = path.join(dir, 'ledger.json');
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n');
  fs.writeFileSync(ledgerFile, '[]\n');
  return { dir, registryFile, ledgerFile };
}

const readRegistry = (f) => JSON.parse(fs.readFileSync(f.registryFile, 'utf8'));
const connectorOf = (f, id) => readRegistry(f).connectors.find((c) => c.connectorId === id);
const entries = (f) => readLedger(f.ledgerFile);

// A transport that records exactly how it was called and never returns anything
// the runner is allowed to persist.
function spyTransport(behaviour) {
  const calls = [];
  const fn = async (ctx) => {
    calls.push(ctx);
    if (typeof behaviour === 'function') return behaviour(ctx);
    return behaviour;
  };
  fn.calls = calls;
  return fn;
}

async function refusal(promiseFactory) {
  try {
    await promiseFactory();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: 'expected a refusal, but the call resolved' });
}

console.log('AEGIS integration runner — fail-honest proofs');

// ── SUCCESS: one invocation, two matching records, for each real connector ──
// Make, Notion and GitHub are exercised separately because each has a different
// executionPath and a different declared capability set: a runner that only
// works for the connector it was written against is not a runner.
const SUCCESS_CASES = [
  { connectorId: 'make', capability: 'TRIGGER', citedSource: 'https://us2.make.com/2781592/scenarios/6040068/logs' },
  { connectorId: 'notion', capability: 'READ', citedSource: null },
  { connectorId: 'github', capability: 'SEARCH', citedSource: 'https://github.com/MarcPapineau/cornerstone-apps' },
];

for (const scenario of SUCCESS_CASES) {
  test(`injected success: ${scenario.connectorId}/${scenario.capability} records ONE PASS and ONE matching USAGE receipt`, async () => {
    const f = fixture();
    const transport = spyTransport({ ok: true, payload: 'ignored' });
    const runId = 'RUN-20260826-INTEGRATION';
    const operationId = `${scenario.connectorId}-${scenario.capability.toLowerCase()}-20260826T120000Z`;

    const out = await runIntegration({
      transport,
      runId,
      operationId,
      connectorId: scenario.connectorId,
      capability: scenario.capability,
      resultSummary: 'The declared capability completed; response body deliberately not recorded.',
      citedSource: scenario.citedSource,
      registryFile: f.registryFile,
      ledgerFile: f.ledgerFile,
    });

    assert.strictEqual(out.status, 'PASS');
    assert.strictEqual(out.transportInvocations, 1, 'the transport must be invoked exactly once');
    assert.strictEqual(transport.calls.length, 1, 'the transport must be invoked exactly once');

    // The transport is handed the four coordinates and NOTHING else — no
    // registry, no writer, no credential.
    assert.deepStrictEqual(Object.keys(transport.calls[0]).sort(),
      ['capability', 'connectorId', 'operationId', 'runId']);
    assert.deepStrictEqual(transport.calls[0],
      { connectorId: scenario.connectorId, capability: scenario.capability, runId, operationId });

    // ── half one: the canonical ledger entry ──
    const all = entries(f);
    assert.strictEqual(all.length, 1, 'exactly one ledger entry');
    const entry = all[0];
    assert.strictEqual(entry.gate, 'connector-usage');
    assert.strictEqual(entry.status, 'PASS');
    assert.strictEqual(entry.plane, 'INTEGRATION');
    assert.strictEqual(entry.connectorId, scenario.connectorId);
    assert.strictEqual(entry.correlationId, runId, 'correlationId IS the run coordinate');
    assert.strictEqual(entry.operationId, operationId);
    assert.strictEqual(entry.attempt, 1);
    assert.ok(!('runId' in entry), 'a second run coordinate would be a second authority; the schema rejects it');

    // ── half two: the USAGE receipt on the connector ──
    const connector = connectorOf(f, scenario.connectorId);
    assert.ok(connector.usageEvidence, 'the USAGE receipt must be recorded');
    assert.strictEqual(connector.usageEvidence.runId, runId);
    assert.strictEqual(connector.usageEvidence.operationId, operationId);
    assert.strictEqual(connector.usageEvidence.citedSource, scenario.citedSource);

    // ── the two halves MATCH on every corroboration axis ──
    assert.strictEqual(connector.usageEvidence.operationId, entry.operationId);
    assert.strictEqual(connector.usageEvidence.runId, entry.correlationId);
    assert.strictEqual(connector.usageEvidence.observedAt, entry.ts,
      'the receipt and the entry must share the instant, or corroboration depends on a correlation window');

    // A USAGE receipt may never move health or auth: usage is somebody walking
    // through the door, not the door being unlocked.
    assert.strictEqual(connector.healthEvidence, null);
    assert.strictEqual(connector.authEvidence, null);
    assert.strictEqual(connector.lastSuccess, null);
  });
}

// ── DUPLICATE: refused BEFORE the transport, from either half ───────────────
test('duplicate operationId already in the ledger is refused BEFORE the transport is invoked', async () => {
  const f = fixture();
  const shared = 'make-trigger-20260826T130000Z';
  const first = spyTransport({ ok: true });
  await runIntegration({
    transport: first, runId: 'RUN-20260826-DUP', operationId: shared,
    connectorId: 'make', capability: 'TRIGGER',
    resultSummary: 'first invocation completed',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  });
  const afterFirst = entries(f);

  const second = spyTransport({ ok: true });
  const error = await refusal(() => runIntegration({
    transport: second, runId: 'RUN-20260826-DUP', operationId: shared,
    connectorId: 'make', capability: 'TRIGGER',
    resultSummary: 'a retry of the same operation',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  }));

  assert.strictEqual(error.code, 'DUPLICATE_OPERATION');
  assert.strictEqual(second.calls.length, 0,
    'the external effect must NOT be performed a second time — an idempotency key checked after the side effect protects nothing');
  assert.deepStrictEqual(entries(f), afterFirst, 'the refusal wrote nothing');
  assert.strictEqual(entries(f).length, 1);
});

test('duplicate operationId already recorded as usageEvidence is refused BEFORE the transport, even with an empty ledger', async () => {
  const shared = 'notion-read-20260826T131500Z';
  const f = fixture((registry) => {
    const notion = registry.connectors.find((c) => c.connectorId === 'notion');
    notion.usageEvidence = {
      observedAt: '2026-08-26T13:15:00Z', runId: 'RUN-20260826-EARLIER',
      method: 'an earlier governed invocation', result: 'page read',
      operationId: shared, citedSource: null,
    };
  });
  const transport = spyTransport({ ok: true });
  const error = await refusal(() => runIntegration({
    transport, runId: 'RUN-20260826-DUP2', operationId: shared,
    connectorId: 'notion', capability: 'READ',
    resultSummary: 'a replay of an operation the receipt already claims',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  }));
  assert.strictEqual(error.code, 'DUPLICATE_OPERATION');
  assert.strictEqual(transport.calls.length, 0);
  assert.strictEqual(entries(f).length, 0, 'no PASS was recorded');
});

// ── WRONG PLANE ────────────────────────────────────────────────────────────
test('a connector that is not INTEGRATION-plane is refused, invokes nothing, and records no PASS', async () => {
  const f = fixture((registry) => {
    registry.connectors.push({
      connectorId: 'rogue-control', label: 'Rogue', provider: 'Rogue',
      plane: 'CONTROL', capabilities: ['READ'], declaredNotSupported: [],
      usageEvidence: null, health: 'UNKNOWN',
    });
  });
  const transport = spyTransport({ ok: true });
  const error = await refusal(() => runIntegration({
    transport, runId: 'RUN-20260826-PLANE', operationId: 'rogue-read-20260826T140000Z',
    connectorId: 'rogue-control', capability: 'READ',
    resultSummary: 'this must never be recorded',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  }));
  assert.strictEqual(error.code, 'WRONG_PLANE');
  assert.match(error.message, /CONTROL plane/);
  assert.strictEqual(transport.calls.length, 0);
  assert.strictEqual(entries(f).length, 0);
  assert.strictEqual(connectorOf(f, 'rogue-control').usageEvidence, null);
});

test('an unknown connector is refused rather than invented', async () => {
  const f = fixture();
  const transport = spyTransport({ ok: true });
  const error = await refusal(() => runIntegration({
    transport, runId: 'RUN-20260826-UNKNOWN', operationId: 'ghost-read-20260826T140500Z',
    connectorId: 'ghost', capability: 'READ',
    resultSummary: 'nothing to record',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  }));
  assert.strictEqual(error.code, 'UNKNOWN_CONNECTOR');
  assert.strictEqual(transport.calls.length, 0);
  assert.strictEqual(entries(f).length, 0);
});

// ── MISSING CAPABILITY ─────────────────────────────────────────────────────
test('a capability the connector never declared is refused, invokes nothing, and records no PASS', async () => {
  const f = fixture();
  const transport = spyTransport({ ok: true });
  // Notion declares READ/SEARCH/CREATE/UPDATE. STATUS is simply absent.
  const error = await refusal(() => runIntegration({
    transport, runId: 'RUN-20260826-CAP', operationId: 'notion-status-20260826T141000Z',
    connectorId: 'notion', capability: 'STATUS',
    resultSummary: 'a capability Notion does not have',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  }));
  assert.strictEqual(error.code, 'CAPABILITY_NOT_DECLARED');
  assert.strictEqual(transport.calls.length, 0);
  assert.strictEqual(entries(f).length, 0);
  assert.strictEqual(connectorOf(f, 'notion').usageEvidence, null);
});

test('a capability the connector declares NOT SUPPORTED is refused by name', async () => {
  const f = fixture();
  const transport = spyTransport({ ok: true });
  // GitHub explicitly declares DELETE and TRIGGER unsupported.
  const error = await refusal(() => runIntegration({
    transport, runId: 'RUN-20260826-CAP2', operationId: 'github-delete-20260826T141500Z',
    connectorId: 'github', capability: 'DELETE',
    resultSummary: 'a capability GitHub declares it does not support',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  }));
  assert.strictEqual(error.code, 'CAPABILITY_DECLARED_UNSUPPORTED');
  assert.match(error.message, /NOT SUPPORTED/);
  assert.strictEqual(transport.calls.length, 0);
  assert.strictEqual(entries(f).length, 0);
});

// ── TRANSPORT FAILURE: FAILED is recorded, PASS never is ───────────────────
test('a transport that THROWS records one FAILED entry, no PASS, and no USAGE receipt', async () => {
  const f = fixture();
  const transport = spyTransport(() => { throw new Error('Make returned HTTP 502 from the scenario endpoint'); });
  const out = await runIntegration({
    transport, runId: 'RUN-20260826-THROW', operationId: 'make-trigger-20260826T150000Z',
    connectorId: 'make', capability: 'TRIGGER',
    resultSummary: 'this summary belongs to an attempt that did not succeed',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  });

  assert.strictEqual(out.status, 'FAILED');
  assert.strictEqual(out.receipt, null);
  assert.strictEqual(transport.calls.length, 1, 'a failure is never retried into a second external effect');

  const all = entries(f);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].status, 'FAILED');
  assert.strictEqual(all[0].gate, 'connector-usage');
  assert.strictEqual(all[0].plane, 'INTEGRATION');
  assert.match(all[0].result, /HTTP 502/, 'an integration failure with no returned error is unactionable');
  assert.ok(!all.some((e) => e.status === 'PASS'), 'a failure may never be recorded as a PASS');
  assert.strictEqual(connectorOf(f, 'make').usageEvidence, null,
    'a failed attempt did not CONSUME the connector, so it makes no usage claim');
});

test('a transport that reports ok:false records FAILED, not BLOCKED and not PASS', async () => {
  const f = fixture();
  const transport = spyTransport({ ok: false, error: 'Notion API replied object_not_found for the requested page' });
  const out = await runIntegration({
    transport, runId: 'RUN-20260826-FALSE', operationId: 'notion-read-20260826T151000Z',
    connectorId: 'notion', capability: 'READ',
    resultSummary: 'the page was requested but not returned',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  });

  assert.strictEqual(out.status, 'FAILED');
  const all = entries(f);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].status, 'FAILED',
    'FAILED means an external worker could not complete; BLOCKED means a control-plane rule refused');
  assert.match(all[0].result, /object_not_found/);
  assert.strictEqual(connectorOf(f, 'notion').usageEvidence, null);
});

// ── SECRETS: never persisted, from any direction ───────────────────────────
test('secret-shaped evidence is refused BEFORE the transport and records no PASS', async () => {
  const f = fixture();
  const transport = spyTransport({ ok: true });
  const error = await refusal(() => runIntegration({
    transport, runId: 'RUN-20260826-SECRET', operationId: 'github-search-20260826T160000Z',
    connectorId: 'github', capability: 'SEARCH',
    resultSummary: 'search succeeded using api_key=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  }));
  assert.strictEqual(error.code, 'UNSAFE_EVIDENCE');
  assert.match(error.message, /credential|secret/i);
  assert.strictEqual(transport.calls.length, 0,
    'an operation whose record could never be stored safely must not be performed at all');
  assert.strictEqual(entries(f).length, 0);
  const raw = fs.readFileSync(f.registryFile, 'utf8') + fs.readFileSync(f.ledgerFile, 'utf8');
  assert.ok(!raw.includes('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'), 'the credential reached a file');
});

test('a citedSource carrying a query string is refused BEFORE the transport — query parameters are where tokens hide', async () => {
  const f = fixture();
  const transport = spyTransport({ ok: true });
  const error = await refusal(() => runIntegration({
    transport, runId: 'RUN-20260826-QUERY', operationId: 'make-trigger-20260826T161000Z',
    connectorId: 'make', capability: 'TRIGGER',
    resultSummary: 'scenario executed',
    citedSource: 'https://us2.make.com/api/v2/scenarios/6040068?access_token=abcdef0123456789',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  }));
  assert.strictEqual(error.code, 'UNSAFE_EVIDENCE');
  assert.match(error.message, /query string|credential/i);
  assert.strictEqual(transport.calls.length, 0);
  assert.strictEqual(entries(f).length, 0);
  const raw = fs.readFileSync(f.registryFile, 'utf8') + fs.readFileSync(f.ledgerFile, 'utf8');
  assert.ok(!raw.includes('access_token'), 'a query parameter reached a file');
});

test('the raw transport response is NEVER persisted, on the success path', async () => {
  const f = fixture();
  const marker = 'ghp_ZYXWVUTSRQPONMLKJIHGFEDCBA987654';
  const transport = spyTransport({
    ok: true,
    body: `{"token":"${marker}","items":[{"id":1}]}`,
    headers: { authorization: `Bearer ${marker}` },
  });
  const out = await runIntegration({
    transport, runId: 'RUN-20260826-RAW', operationId: 'github-search-20260826T170000Z',
    connectorId: 'github', capability: 'SEARCH',
    resultSummary: 'Search returned results; the response body is deliberately not recorded.',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  });
  assert.strictEqual(out.status, 'PASS');
  const raw = fs.readFileSync(f.registryFile, 'utf8') + fs.readFileSync(f.ledgerFile, 'utf8');
  assert.ok(!raw.includes(marker), 'the response payload leaked into a persisted file');
  assert.ok(!raw.includes('Bearer '), 'a response header leaked into a persisted file');
  assert.ok(!raw.includes('"body"'), 'a response field leaked into a persisted file');
});

test('failure text that carries a credential is redacted rather than dropped — a secret cannot buy a failure silence', async () => {
  const f = fixture();
  // assembled at runtime: no complete token signature is stored in this repository's text
  const marker = ['xo', 'xb', '-', '1234567890', '-', 'ABCDEFGHIJKLMNOP'].join('');
  const transport = spyTransport(() => { throw new Error(`upstream rejected authorization: Bearer ${marker}`); });
  const out = await runIntegration({
    transport, runId: 'RUN-20260826-REDACT', operationId: 'make-trigger-20260826T171000Z',
    connectorId: 'make', capability: 'TRIGGER',
    resultSummary: 'the scenario was triggered but the platform rejected the call',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  });
  assert.strictEqual(out.status, 'FAILED');
  const all = entries(f);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].status, 'FAILED', 'the failure is still recorded');
  assert.match(all[0].result, /withheld/, 'the finding is recorded in place of the text');
  const raw = fs.readFileSync(f.registryFile, 'utf8') + fs.readFileSync(f.ledgerFile, 'utf8');
  assert.ok(!raw.includes(marker), 'the credential in the failure text reached a file');
});

// ── the writers used are the CANONICAL ones ────────────────────────────────
test('the PASS entry is schema-valid because it went through the canonical writer, not around it', async () => {
  const { validateEntry } = require('../ledger-writer.cjs');
  const f = fixture();
  await runIntegration({
    transport: spyTransport({ ok: true }),
    runId: 'RUN-20260826-SCHEMA', operationId: 'github-read-20260826T180000Z',
    connectorId: 'github', capability: 'READ',
    resultSummary: 'repository metadata was read',
    registryFile: f.registryFile, ledgerFile: f.ledgerFile,
  });
  const [entry] = entries(f);
  assert.deepStrictEqual(validateEntry(entry), [],
    'an off-schema shape would mean the runner wrote around the writer');
});

// ── isolation, measured rather than asserted ───────────────────────────────
test('this suite left the canonical registry and the canonical ledger byte-identical', () => {
  assert.strictEqual(digest(CANONICAL_REGISTRY), REGISTRY_BEFORE, 'the canonical connector registry was modified');
  assert.strictEqual(digest(CANONICAL_LEDGER), LEDGER_BEFORE, 'the canonical evidence ledger was modified');
});

(async () => {
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed += 1;
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`${passed} passed, ${failed} failed`);
})();
