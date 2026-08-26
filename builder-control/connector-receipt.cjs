#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_REGISTRY = path.join(__dirname, 'connector-registry.json');

// ── two receipt kinds, deliberately separate ────────────────────────────────
// A HEALTH receipt answers "can we reach it and are we authenticated?".
// A USAGE receipt answers "did a run actually consume it?".
//
// These were one signal, and that is the defect. Every connector here showed
// HEALTHY because someone had authenticated and probed it — and a founder
// reading the page could only conclude the system was consulting Notion,
// GitHub and Make. Nothing had consulted them. Authentication is a door being
// unlocked; usage is somebody walking through it, and one is not evidence of
// the other.
//
// So: a HEALTH receipt may NEVER write usage, and a USAGE receipt may NEVER
// write authStatus, health, or lastSuccess. Enforced below, and proved in the
// test suite. Collapsing them again requires deleting a test that says why.
const HEALTH_KEYS = new Set([
  'connectorId', 'receiptKind', 'observedAt', 'health', 'authStatus', 'method', 'result',
  'latencyMs', 'rateLimit', 'permissions', 'operationId',
]);
const USAGE_KEYS = new Set([
  'connectorId', 'receiptKind', 'observedAt', 'runId', 'method', 'result',
  'operationId', 'citedSource',
]);
const KINDS = new Set(['HEALTH', 'USAGE']);
const AUTH = new Set(['AUTHENTICATED', 'NOT_AUTHORIZED', 'AUTH_EXPIRED', 'UNKNOWN']);

// A probe that positively succeeded, and nothing else, may date a verification.
// DEGRADED and UNKNOWN are deliberately absent: "it answered, badly" and "we do
// not know" are not proof that the service responded.
const SUCCESS_HEALTH = new Set(['HEALTHY']);
const FAILURE_HEALTH = new Set(['FAILED', 'AUTH_EXPIRED', 'RATE_LIMITED', 'DISCONNECTED']);

// ── ONE credential strategy, used by every field, for every receipt kind ────
// The previous single regex knew about `access_token` and `bearer` and nothing
// else, so a GitHub PAT, a `?token=` query parameter and a URL carrying
// userinfo all walked into the registry and out onto the dashboard. Credential
// rejection is now one exported function with one rule table: adding a field
// cannot accidentally opt out of it, and adding a rule protects every field at
// once. Evidence is also BOUNDED — raw connector output is refused, because a
// short human summary is what this file stores and unbounded text is exactly
// where a secret hides.
const MAX_EVIDENCE_CHARS = 240;
const MAX_CITED_SOURCE_CHARS = 200;

const CREDENTIAL_RULES = [
  ['a bearer token', /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i],
  ['a basic-auth credential', /\bbasic\s+[A-Za-z0-9+/=]{12,}/i],
  ['a labelled secret', /\b(?:api[_-]?keys?|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|secret|password|passwd|pwd|passphrase|session[_-]?id|sessionid|session[_-]?token|cookie|authorization|credentials?|token)\b\s*[:=]\s*\S+/i],
  ['a credential-bearing URL parameter', /[?&](?:access_token|api[_-]?key|apikey|auth|authorization|code|key|passwd|password|pwd|secret|session|sig|signature|sso|token)=[^&\s]+/i],
  ['credentials embedded in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i],
  ['a recognised provider token', new RegExp([
    'gh[pousr]_[A-Za-z0-9]{16,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'sk-(?:ant-)?[A-Za-z0-9._-]{16,}',
    'xox[abeoprs]-[A-Za-z0-9-]{10,}',
    '(?:AKIA|ASIA)[0-9A-Z]{12,}',
    'AIza[0-9A-Za-z_-]{30,}',
    'ya29\\.[0-9A-Za-z_-]{20,}',
    'glpat-[0-9A-Za-z_-]{16,}',
    'npm_[A-Za-z0-9]{30,}',
    'dop_v1_[a-f0-9]{32,}',
    'shpat_[a-fA-F0-9]{28,}',
    'SG\\.[A-Za-z0-9_-]{16,}',
    '(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}',
    'hf_[A-Za-z0-9]{20,}',
    'xai-[A-Za-z0-9]{20,}',
    'ntn_[A-Za-z0-9]{20,}',
    'secret_[A-Za-z0-9]{32,}',
    'pat[A-Za-z0-9]{14}\\.[A-Za-z0-9]{32,}',
  ].join('|'))],
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
];

// An unlabelled secret still looks like one: a long opaque run carrying upper
// case, lower case and digits at once. Ordinary English evidence — and the
// dated operationIds this system writes — do not produce such a token, which is
// what makes this safe to refuse rather than merely flag.
function highEntropyToken(text) {
  for (const token of String(text).split(/[^A-Za-z0-9+/=_-]+/)) {
    if (token.length < 32) continue;
    if (/[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token)) return token;
  }
  return null;
}

// Returns a human reason when the text carries a credential, else null. This is
// the ONLY place any field is judged; nothing else may hand-roll one.
function credentialReason(text) {
  const s = String(text == null ? '' : text);
  for (const [reason, pattern] of CREDENTIAL_RULES) {
    if (pattern.test(s)) return reason;
  }
  if (highEntropyToken(s)) return 'a high-entropy secret-shaped value';
  return null;
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/g;

function collapse(raw) {
  return String(raw).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

// Persisted evidence is what this returns and nothing else: normalised,
// length-bounded, credential-free.
function sanitizeEvidenceText(field, raw, limit = MAX_EVIDENCE_CHARS) {
  if (typeof raw !== 'string') throw new Error(`receipt.${field} must be a string`);
  const text = collapse(raw);
  if (!text) throw new Error(`receipt.${field} is required`);
  if (text.length > limit) {
    throw new Error(
      `receipt.${field} is ${text.length} characters, over the ${limit}-character evidence bound — ` +
      'record a short summary, never raw connector output'
    );
  }
  const reason = credentialReason(text);
  if (reason) {
    throw new Error(
      `receipt.${field} appears to contain ${reason} — connector evidence is stored in plain text ` +
      'and rendered on the dashboard, so it may never carry a credential'
    );
  }
  return text;
}

// citedSource is allowlisted, not merely scanned: a repository-relative path,
// or an http(s) URL with no userinfo and no query string. Query strings are
// where tokens live, so the format refuses them outright rather than trying to
// out-guess every provider's parameter name.
function sanitizeCitedSource(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('receipt.citedSource must be a non-empty string when present');
  const s = collapse(raw);
  if (s.length > MAX_CITED_SOURCE_CHARS) {
    throw new Error(`receipt.citedSource is over the ${MAX_CITED_SOURCE_CHARS}-character bound`);
  }
  const reason = credentialReason(s);
  if (reason) throw new Error(`receipt.citedSource appears to contain ${reason} — a cited source may never carry a credential`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (!/^https?:\/\//i.test(s)) throw new Error('receipt.citedSource may only cite an http(s) URL or a repository-relative path');
    let url;
    try { url = new URL(s); } catch { throw new Error('receipt.citedSource is not a readable URL'); }
    if (url.username || url.password) throw new Error('receipt.citedSource carries credentials embedded in a URL');
    if (url.search) throw new Error('receipt.citedSource may not carry a query string — query parameters are where credentials hide');
    return s;
  }
  if (s.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(s)) {
    throw new Error('receipt.citedSource must be a repository-relative path without traversal, or an http(s) URL');
  }
  return s;
}

// Kept for callers that still import the old name. A receipt is validated
// against the key set for its own kind, never against the union.
const ALLOWED_KEYS = HEALTH_KEYS;

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

function receiptKind(receipt) {
  const k = receipt && receipt.receiptKind;
  if (k == null) return 'HEALTH'; // every receipt written before USAGE existed
  if (typeof k !== 'string' || !KINDS.has(k)) throw new Error(`unsupported receiptKind "${k}"`);
  return k;
}

// ── chronological monotonicity ──────────────────────────────────────────────
// Truth about a connector moves forward only. An August 1 receipt applied after
// an August 25 one used to silently rewind lastUsedByRun to the older run — a
// retry of an old operation was enough to make the dashboard name the wrong
// run. Evidence is now ordered by (observedAt, operationId), the newest wins,
// and applying the same set of receipts in any order lands on the same state.
// An older receipt is not an error: it is a SUPERSEDED no-op, reported as such
// so a retry stays auditable instead of quietly destructive.
function evidenceOrder(candidate, existing) {
  if (!existing || !existing.observedAt) return 1;
  const a = Date.parse(candidate.observedAt);
  const b = Date.parse(existing.observedAt);
  if (Number.isNaN(b)) return 1; // unreadable existing evidence is not truth worth protecting
  if (a > b) return 1;
  if (a < b) return -1;
  const ao = String(candidate.operationId || '');
  const bo = String(existing.operationId || '');
  if (ao === bo) return 0;
  return ao > bo ? 1 : -1;
}

function laterIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta >= tb ? a : b;
}

function validateReceipt(receipt, registry, now = Date.now()) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('receipt must be a JSON object');
  }
  const kind = receiptKind(receipt);
  const keys = kind === 'USAGE' ? USAGE_KEYS : HEALTH_KEYS;
  for (const key of Object.keys(receipt)) {
    if (!keys.has(key)) throw new Error(`receipt field "${key}" is not allowed on a ${kind} receipt`);
  }
  const requiredKeys = kind === 'USAGE'
    ? ['connectorId', 'observedAt', 'runId', 'method', 'result', 'operationId']
    : ['connectorId', 'observedAt', 'health', 'authStatus', 'method', 'result', 'operationId'];
  for (const key of requiredKeys) {
    if (typeof receipt[key] !== 'string' || !receipt[key].trim()) throw new Error(`receipt.${key} is required`);
  }
  const connector = (registry.connectors || []).find((item) => item.connectorId === receipt.connectorId);
  if (!connector) throw new Error(`unknown connector "${receipt.connectorId}"`);
  if (connector.plane !== 'INTEGRATION') throw new Error('only INTEGRATION-plane connectors may accept receipts');
  if (kind === 'USAGE') return validateUsageReceipt(receipt, connector, now);
  if (!(registry.healthVocabulary || []).includes(receipt.health)) throw new Error(`unsupported health "${receipt.health}"`);
  if (!AUTH.has(receipt.authStatus)) throw new Error(`unsupported authStatus "${receipt.authStatus}"`);
  if (receipt.health === 'HEALTHY' && receipt.authStatus !== 'AUTHENTICATED') {
    throw new Error('HEALTHY requires AUTHENTICATED');
  }
  const observed = Date.parse(receipt.observedAt);
  if (Number.isNaN(observed)) throw new Error('receipt.observedAt must be an ISO timestamp');
  if (observed > now + 5 * 60 * 1000) throw new Error('receipt.observedAt cannot be in the future');
  sanitizeEvidenceText('method', receipt.method);
  sanitizeEvidenceText('result', receipt.result);
  if (receipt.latencyMs != null && (!Number.isFinite(receipt.latencyMs) || receipt.latencyMs < 0)) {
    throw new Error('receipt.latencyMs must be a non-negative number');
  }
  if (receipt.permissions != null && (!Array.isArray(receipt.permissions) || receipt.permissions.some((p) => typeof p !== 'string'))) {
    throw new Error('receipt.permissions must be an array of strings');
  }
  return connector;
}

// A USAGE receipt is a claim that a NAMED run consumed this connector. It says
// nothing about credentials and is refused if it tries to: `authStatus` and
// `health` are not on USAGE_KEYS, so a run cannot promote itself to
// authenticated by reporting that it used something.
//
// It is a CLAIM, not a proof. Corroboration happens at projection time against
// the append-only ledger (aegis-state.cjs), and an uncorroborated claim is never
// rendered as usage. This file deliberately does NOT write that ledger entry: a
// receipt that wrote both sides of its own corroboration would prove nothing.
function validateUsageReceipt(receipt, connector, now) {
  const observed = Date.parse(receipt.observedAt);
  if (Number.isNaN(observed)) throw new Error('receipt.observedAt must be an ISO timestamp');
  if (observed > now + 5 * 60 * 1000) throw new Error('receipt.observedAt cannot be in the future');
  // "a run" must be a specific, checkable run. "recently", "the nightly job" or
  // an empty string is not a run, and would make lastUsedByRun unfalsifiable.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(receipt.runId)) {
    throw new Error('receipt.runId must be an exact run identifier — a vague or empty runId makes usage unverifiable');
  }
  sanitizeEvidenceText('method', receipt.method);
  sanitizeEvidenceText('result', receipt.result);
  if (receipt.citedSource != null) sanitizeCitedSource(receipt.citedSource);
  return connector;
}

function applyReceipt(registry, receipt, now = Date.now()) {
  const connector = validateReceipt(receipt, registry, now);
  const kind = receiptKind(receipt);
  const method = sanitizeEvidenceText('method', receipt.method);
  const result = sanitizeEvidenceText('result', receipt.result);

  // ── USAGE: writes usageEvidence and NOTHING else ──────────────────────────
  // Not authStatus, not health, not lastSuccess. A run consuming a connector is
  // not a health probe: the run may well have used a connector that is now
  // expired, and overwriting health here would invent a fresh verification that
  // never happened.
  if (kind === 'USAGE') {
    const order = evidenceOrder(receipt, connector.usageEvidence);
    if (order === 0) return { registry, duplicate: true, superseded: false };
    if (order < 0) return { registry, duplicate: false, superseded: true };
    connector.usageEvidence = {
      observedAt: receipt.observedAt,
      runId: receipt.runId,
      method,
      result,
      operationId: receipt.operationId,
      citedSource: receipt.citedSource == null ? null : sanitizeCitedSource(receipt.citedSource),
    };
    return { registry, duplicate: false, superseded: false };
  }

  // ── HEALTH: writes auth + health evidence and NEVER usageEvidence ─────────
  const order = evidenceOrder(receipt, connector.healthEvidence);
  if (order === 0) return { registry, duplicate: true, superseded: false };
  if (order < 0) return { registry, duplicate: false, superseded: true };

  const succeeded = SUCCESS_HEALTH.has(receipt.health);
  const failed = FAILURE_HEALTH.has(receipt.health);

  connector.authStatus = receipt.authStatus;
  // Authentication now carries its OWN dated evidence. It used to be a bare
  // string with no observation time, so a credential checked in March and one
  // checked a minute ago rendered identically — and neither could ever be
  // called stale, because there was no date to call stale.
  connector.authEvidence = {
    observedAt: receipt.observedAt,
    authStatus: receipt.authStatus,
    method,
    operationId: receipt.operationId,
  };
  connector.health = receipt.health;
  connector.healthEvidence = {
    observedAt: receipt.observedAt,
    method,
    result,
    operationId: receipt.operationId,
    health: receipt.health,
    outcome: succeeded ? 'SUCCESS' : failed ? 'FAILURE' : 'INCONCLUSIVE',
  };
  // The last time it actually RESPONDED is kept separately from the last time it
  // was probed, so a failure never erases the successful history and a success
  // never gets to speak for a later failure.
  if (succeeded) {
    connector.verificationEvidence = {
      observedAt: receipt.observedAt,
      method,
      result,
      operationId: receipt.operationId,
    };
  }
  connector.latencyMs = receipt.latencyMs == null ? null : receipt.latencyMs;
  connector.rateLimit = receipt.rateLimit || 'UNKNOWN';
  if (receipt.permissions) connector.permissions = [...receipt.permissions];
  if (succeeded) {
    connector.lastSuccess = laterIso(connector.lastSuccess, receipt.observedAt);
    connector.failureCount = 0;
  } else if (failed) {
    connector.lastFailure = laterIso(connector.lastFailure, receipt.observedAt);
    connector.failureCount = (Number(connector.failureCount) || 0) + 1;
  }
  return { registry, duplicate: false, superseded: false };
}

// ── lock ownership ──────────────────────────────────────────────────────────
// The old `finally` deleted the lock file whether or not this process had ever
// held it, so a writer that LOST the race removed the winner's lock on its way
// out, and both then wrote. Only the acquirer releases; contention is bounded
// and reported; the read-under-lock plus atomic-rename invariant is unchanged.
const LOCK_ATTEMPTS = 40;
const LOCK_WAIT_MS = 25;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lock, attempts = LOCK_ATTEMPTS, waitMs = LOCK_WAIT_MS) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return fs.openSync(lock, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt === attempts) {
        const held = new Error(
          `connector registry is locked by another writer (${lock}) after ${attempts} attempts — ` +
          'this process wrote nothing and removed nothing'
        );
        held.code = 'ELOCKED';
        throw held;
      }
      sleepSync(waitMs);
    }
  }
  throw new Error('unreachable');
}

function recordReceipt(receipt, registryFile = resolveRegistry()) {
  const lock = registryFile + '.lock';
  // Throws WITHOUT touching the lock when it belongs to somebody else.
  const lockFd = acquireLock(lock);
  try {
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const outcome = applyReceipt(registry, receipt);
    if (outcome.duplicate || outcome.superseded) return outcome;
    const temp = `${registryFile}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(outcome.registry, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, registryFile);
    return outcome;
  } finally {
    try { fs.closeSync(lockFd); } catch {}
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
    if (outcome.duplicate) console.log('CONNECTOR RECEIPT: NO-OP (duplicate operationId)');
    else if (outcome.superseded) console.log('CONNECTOR RECEIPT: NO-OP (superseded — newer evidence is already recorded)');
    else console.log('CONNECTOR RECEIPT: RECORDED');
    return 0;
  } catch (error) {
    console.error(`CONNECTOR RECEIPT: REFUSED — ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = {
  validateReceipt, applyReceipt, recordReceipt, resolveRegistry, receiptKind,
  credentialReason, sanitizeEvidenceText, sanitizeCitedSource, acquireLock, evidenceOrder,
  HEALTH_KEYS, USAGE_KEYS, ALLOWED_KEYS, MAX_EVIDENCE_CHARS,
};
