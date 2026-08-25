#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_REGISTRY = path.join(__dirname, 'connector-registry.json');
const ALLOWED_KEYS = new Set([
  'connectorId', 'observedAt', 'health', 'authStatus', 'method', 'result',
  'latencyMs', 'rateLimit', 'permissions', 'operationId',
]);
const AUTH = new Set(['AUTHENTICATED', 'NOT_AUTHORIZED', 'AUTH_EXPIRED', 'UNKNOWN']);
const SECRET_PATTERN = /(bearer\s+[a-z0-9._~-]+|(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+)/i;

function resolveRegistry() {
  const override = process.env.AEGIS_CONNECTOR_REGISTRY;
  if (!override) return DEFAULT_REGISTRY;
  const absolute = path.resolve(override);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const parent = fs.realpathSync(path.dirname(absolute));
  if (parent !== tempRoot && !parent.startsWith(tempRoot + path.sep)) {
    throw new Error(`AEGIS_CONNECTOR_REGISTRY must be inside ${tempRoot}`);
  }
  return absolute;
}

function validateReceipt(receipt, registry, now = Date.now()) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('receipt must be a JSON object');
  }
  for (const key of Object.keys(receipt)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`receipt field "${key}" is not allowed`);
  }
  for (const key of ['connectorId', 'observedAt', 'health', 'authStatus', 'method', 'result', 'operationId']) {
    if (typeof receipt[key] !== 'string' || !receipt[key].trim()) throw new Error(`receipt.${key} is required`);
  }
  const connector = (registry.connectors || []).find((item) => item.connectorId === receipt.connectorId);
  if (!connector) throw new Error(`unknown connector "${receipt.connectorId}"`);
  if (connector.plane !== 'INTEGRATION') throw new Error('only INTEGRATION-plane connectors may accept receipts');
  if (!(registry.healthVocabulary || []).includes(receipt.health)) throw new Error(`unsupported health "${receipt.health}"`);
  if (!AUTH.has(receipt.authStatus)) throw new Error(`unsupported authStatus "${receipt.authStatus}"`);
  if (receipt.health === 'HEALTHY' && receipt.authStatus !== 'AUTHENTICATED') {
    throw new Error('HEALTHY requires AUTHENTICATED');
  }
  const observed = Date.parse(receipt.observedAt);
  if (Number.isNaN(observed)) throw new Error('receipt.observedAt must be an ISO timestamp');
  if (observed > now + 5 * 60 * 1000) throw new Error('receipt.observedAt cannot be in the future');
  if (SECRET_PATTERN.test(receipt.method) || SECRET_PATTERN.test(receipt.result)) {
    throw new Error('receipt evidence appears to contain a credential');
  }
  if (receipt.latencyMs != null && (!Number.isFinite(receipt.latencyMs) || receipt.latencyMs < 0)) {
    throw new Error('receipt.latencyMs must be a non-negative number');
  }
  if (receipt.permissions != null && (!Array.isArray(receipt.permissions) || receipt.permissions.some((p) => typeof p !== 'string'))) {
    throw new Error('receipt.permissions must be an array of strings');
  }
  return connector;
}

function applyReceipt(registry, receipt, now = Date.now()) {
  const connector = validateReceipt(receipt, registry, now);
  if (connector.healthEvidence && connector.healthEvidence.operationId === receipt.operationId) {
    return { registry, duplicate: true };
  }
  connector.authStatus = receipt.authStatus;
  connector.health = receipt.health;
  connector.healthEvidence = {
    observedAt: receipt.observedAt,
    method: receipt.method,
    result: receipt.result,
    operationId: receipt.operationId,
  };
  connector.latencyMs = receipt.latencyMs == null ? null : receipt.latencyMs;
  connector.rateLimit = receipt.rateLimit || 'UNKNOWN';
  if (receipt.permissions) connector.permissions = [...receipt.permissions];
  if (receipt.health === 'HEALTHY') {
    connector.lastSuccess = receipt.observedAt;
    connector.failureCount = 0;
  } else if (['FAILED', 'AUTH_EXPIRED', 'RATE_LIMITED'].includes(receipt.health)) {
    connector.lastFailure = receipt.observedAt;
    connector.failureCount = (Number(connector.failureCount) || 0) + 1;
  }
  return { registry, duplicate: false };
}

function recordReceipt(receipt, registryFile = resolveRegistry()) {
  const lock = registryFile + '.lock';
  let lockFd;
  try {
    lockFd = fs.openSync(lock, 'wx');
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const outcome = applyReceipt(registry, receipt);
    if (outcome.duplicate) return outcome;
    const temp = `${registryFile}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(outcome.registry, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, registryFile);
    return outcome;
  } finally {
    if (lockFd != null) try { fs.closeSync(lockFd); } catch {}
    try { fs.unlinkSync(lock); } catch {}
  }
}

function main(argv) {
  const index = argv.indexOf('--record');
  if (index < 0 || !argv[index + 1]) {
    console.error('Usage: node connector-receipt.cjs --record <receipt.json>');
    return 2;
  }
  try {
    const receipt = JSON.parse(fs.readFileSync(path.resolve(argv[index + 1]), 'utf8'));
    const outcome = recordReceipt(receipt);
    console.log(outcome.duplicate ? 'CONNECTOR RECEIPT: NO-OP (duplicate operationId)' : 'CONNECTOR RECEIPT: RECORDED');
    return 0;
  } catch (error) {
    console.error(`CONNECTOR RECEIPT: REFUSED — ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { validateReceipt, applyReceipt, recordReceipt, resolveRegistry };
