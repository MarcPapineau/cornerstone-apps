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
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
function registry() { return JSON.parse(JSON.stringify(BASE)); }
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

process.on('exit', () => console.log(`${passed} passed, ${process.exitCode ? 1 : 0} failed`));
