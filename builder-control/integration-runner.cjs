#!/usr/bin/env node
/**
 * integration-runner.cjs — Builder Control System, INTEGRATION plane
 *
 * THE GAP THIS CLOSES
 * connector-receipt.cjs deliberately refuses to write the ledger entry that
 * corroborates its own USAGE receipt — a receipt that wrote both sides of its
 * own proof would prove nothing. So the two halves of "a run consumed this
 * connector" had no single owner: whoever performed the consumption was
 * trusted to remember to write both, in the same shape, with the same
 * coordinates. Nobody did, which is why every connector on the dashboard read
 * HEALTHY and none of them read USED.
 *
 * This module is that owner. It performs the consumption AND records both
 * halves from the SAME coordinates, so they cannot disagree:
 *
 *     ledger entry   gate "connector-usage", status PASS, plane INTEGRATION,
 *                    connectorId, correlationId = runId, operationId, ts
 *     USAGE receipt  connectorId, runId, operationId, observedAt (same ts)
 *
 * It writes through the EXISTING canonical APIs — ledger-writer.appendAtomic
 * and connector-receipt.recordReceipt — never around them. It hand-rolls no
 * schema check, no lock and no atomic-rename of its own, because a second
 * implementation of a write invariant is a second thing that can be wrong.
 *
 * FOUR REFUSALS, ALL BEFORE THE TRANSPORT
 *   1. evidence that carries a credential, or a citedSource that carries a
 *      query string — the evidence is checked BEFORE the external effect, so
 *      an operation whose record could never be written safely is never
 *      performed at all;
 *   2. a connector that is not on the INTEGRATION plane;
 *   3. a capability the connector does not declare (or declares unsupported);
 *   4. an operationId already recorded — in the ledger OR in the connector's
 *      usageEvidence.
 * A refusal invokes nothing and writes nothing: no PASS, no receipt, no
 * partial record. The operationId stays unused, so a corrected retry is clean.
 *
 * WHAT IS NEVER PERSISTED
 * The transport's return value. Not one field of it. Evidence is the caller's
 * short, bounded, credential-scanned summary and nothing else, because raw
 * connector output is exactly where a token rides into a file that renders on a
 * dashboard. A failure's error text is bounded and redacted for the same
 * reason — a failure must be recordable without being quotable.
 */
'use strict';

const fs = require('fs');

const {
  recordReceipt, resolveRegistry, credentialReason,
  sanitizeEvidenceText, sanitizeCitedSource, MAX_EVIDENCE_CHARS,
} = require('./connector-receipt.cjs');
const { appendAtomic, readLedger } = require('./ledger-writer.cjs');

const USAGE_GATE = 'connector-usage';
const PLANE = 'INTEGRATION';

// Both coordinates must be exact and checkable. "the nightly job" is not a run
// and "retry" is not an operation; either would make the resulting record
// unfalsifiable, which is the same as having no record.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const CAPABILITY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/g;

function refuse(code, message) {
  const error = new Error(message);
  error.code = code;
  error.refused = true;
  return error;
}

// Failure text comes from OUTSIDE. It is bounded and credential-scanned before
// it is stored — and when it does carry a credential the finding is recorded
// instead of the text, so a secret can never buy itself silence by making the
// failure unrecordable.
function redactFailureText(raw) {
  const text = String(raw == null ? '' : raw).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'the transport reported failure and returned no error text';
  const reason = credentialReason(text);
  if (reason) return `failure text withheld: it appeared to contain ${reason}`;
  return text.length > MAX_EVIDENCE_CHARS
    ? `${text.slice(0, MAX_EVIDENCE_CHARS - 3)}...`
    : text;
}

function loadRegistry(registryFile) {
  try {
    return JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  } catch (error) {
    throw refuse('REGISTRY_UNREADABLE', `connector registry ${registryFile} could not be read: ${error.message}`);
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw refuse('BAD_INPUT', `${field} is required`);
  return value.trim();
}

/**
 * Perform ONE governed connector operation and record it.
 *
 * @param {object}   options
 * @param {Function} options.transport      injected; invoked at most once with
 *                                          the four coordinates and nothing else
 * @param {string}   options.runId          the consuming run (ledger correlationId)
 * @param {string}   options.operationId    idempotency key, shared by both records
 * @param {string}   options.connectorId    which service
 * @param {string}   options.capability     which declared capability is being used
 * @param {string}   options.resultSummary  short human evidence — NOT the response
 * @param {string}  [options.citedSource]   repo-relative path or query-free http(s) URL
 * @param {string}  [options.registryFile]  temp-dir registry, for isolation
 * @param {string}  [options.ledgerFile]    temp-dir ledger, for isolation
 * @param {string}  [options.method] [options.agentId] [options.packetId] [options.entryId]
 * @param {number}  [options.now]           epoch ms; both records share this instant
 * @returns {Promise<object>} { status: 'PASS' | 'FAILED', ... }
 * @throws  on any refusal, with error.code set and NOTHING written
 */
async function runIntegration(options) {
  const opts = options || {};
  if (typeof opts.transport !== 'function') throw refuse('BAD_INPUT', 'transport must be an injected function');

  const runId = requireString(opts.runId, 'runId');
  const operationId = requireString(opts.operationId, 'operationId');
  const connectorId = requireString(opts.connectorId, 'connectorId');
  const capability = requireString(opts.capability, 'capability');
  if (!ID_PATTERN.test(runId)) throw refuse('BAD_INPUT', 'runId must be an exact run identifier');
  if (!ID_PATTERN.test(operationId)) throw refuse('BAD_INPUT', 'operationId must be an exact operation identifier');
  if (!CAPABILITY_PATTERN.test(capability)) throw refuse('BAD_INPUT', `capability "${capability}" is not a declarable capability name`);

  const registryFile = opts.registryFile || resolveRegistry();
  const ledgerFile = opts.ledgerFile || null;
  const agentId = opts.agentId || 'claude-code';
  const packetId = opts.packetId == null ? null : opts.packetId;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const ts = new Date(now).toISOString();
  const entryId = opts.entryId || `LED-USAGE-${operationId}`;

  // ── REFUSAL 1: evidence that could never be stored safely ────────────────
  // Checked FIRST, before the connector is even looked up and long before the
  // transport runs. An operation whose record would be refused must not happen:
  // otherwise the external effect lands and the evidence for it does not, which
  // is precisely the invisible-usage failure this whole plane exists to stop.
  let method;
  let resultSummary;
  let citedSource = null;
  try {
    method = sanitizeEvidenceText('method', opts.method
      || `Governed AEGIS integration-runner invocation of ${connectorId} capability ${capability}`);
    resultSummary = sanitizeEvidenceText('result', opts.resultSummary);
    if (opts.citedSource != null) citedSource = sanitizeCitedSource(opts.citedSource);
  } catch (error) {
    throw refuse('UNSAFE_EVIDENCE', `refused before invoking ${connectorId}: ${error.message}`);
  }

  // ── REFUSAL 2 & 3: plane and capability, from the registry ───────────────
  const registry = loadRegistry(registryFile);
  const connector = (registry.connectors || []).find((item) => item && item.connectorId === connectorId);
  if (!connector) throw refuse('UNKNOWN_CONNECTOR', `unknown connector "${connectorId}"`);
  if (connector.plane !== PLANE) {
    throw refuse('WRONG_PLANE',
      `connector "${connectorId}" is on the ${connector.plane} plane — only ${PLANE}-plane connectors may be invoked, ` +
      'because a connector reachable from the control plane could act on its own authority');
  }
  const declaredNotSupported = Array.isArray(connector.declaredNotSupported) ? connector.declaredNotSupported : [];
  if (declaredNotSupported.includes(capability)) {
    throw refuse('CAPABILITY_DECLARED_UNSUPPORTED',
      `connector "${connectorId}" declares ${capability} NOT SUPPORTED — invoking it anyway would record a capability it does not have`);
  }
  const capabilities = Array.isArray(connector.capabilities) ? connector.capabilities : [];
  if (!capabilities.includes(capability)) {
    throw refuse('CAPABILITY_NOT_DECLARED',
      `connector "${connectorId}" does not declare capability ${capability} (declared: ${capabilities.join(', ') || 'none'})`);
  }

  // ── REFUSAL 4: duplicate operationId, BEFORE the transport ───────────────
  // Both halves are consulted. The ledger is the corroborating record and the
  // receipt is the claim; if EITHER already carries this operationId then the
  // external effect already happened, and re-invoking would perform it twice —
  // an idempotency key that is only checked after the side effect protects
  // nothing. A genuine retry uses a NEW operationId under the SAME runId.
  const existingEntries = readLedger(ledgerFile || undefined);
  const priorEntry = existingEntries.find((entry) => entry && entry.operationId === operationId);
  if (priorEntry) {
    throw refuse('DUPLICATE_OPERATION',
      `operationId "${operationId}" is already recorded in the ledger as "${priorEntry.entryId}" — ` +
      'refusing to invoke the connector a second time');
  }
  const priorUsage = connector.usageEvidence;
  if (priorUsage && priorUsage.operationId === operationId) {
    throw refuse('DUPLICATE_OPERATION',
      `operationId "${operationId}" is already recorded as usageEvidence on "${connectorId}" — ` +
      'refusing to invoke the connector a second time');
  }

  // ── the one and only invocation ──────────────────────────────────────────
  // The transport receives the four coordinates and nothing else: no
  // credential, no registry, no writer. It is called exactly once and never
  // retried — a retry here would be an unrecorded second external effect.
  let invocations = 0;
  let failure = null;
  try {
    invocations += 1;
    const returned = await opts.transport({ connectorId, capability, runId, operationId });
    if (returned && typeof returned === 'object' && returned.ok === false) {
      failure = redactFailureText(returned.error || returned.result);
    }
    // `returned` goes out of scope here, deliberately unread beyond `ok`.
    // Nothing derived from the response is ever persisted.
  } catch (error) {
    failure = redactFailureText(error && error.message);
  }

  const baseEntry = {
    entryId,
    ts,
    packetId,
    agentId,
    gate: USAGE_GATE,
    status: 'PASS',
    plane: PLANE,
    connectorId,
    correlationId: runId,
    operationId,
    attempt: 1,
    operation: `${capability} via connector ${connectorId}`,
    changed: [],
    commandsRun: [],
    testsRun: [],
    evidencePaths: [],
  };

  // ── the operation FAILED: recorded, but never as a PASS ──────────────────
  // FAILED is not BLOCKED. An external worker that could not complete is a
  // different fact from a control-plane refusal, and the schema keeps them
  // apart. No USAGE receipt is written: a receipt is a claim that the run
  // CONSUMED the connector, and an attempt that failed did not.
  if (failure !== null) {
    const failedEntry = {
      ...baseEntry,
      status: 'FAILED',
      result: failure,
      notes: 'INTEGRATION attempt failed. No PASS was recorded and no USAGE receipt was written. ' +
        'Raw transport output is never persisted; this text is bounded and credential-scanned.',
    };
    const written = appendAtomic(failedEntry, ledgerFile ? { ledgerFile } : undefined);
    return {
      status: 'FAILED',
      connectorId, runId, operationId, capability,
      entryId: failedEntry.entryId,
      error: failure,
      transportInvocations: invocations,
      ledger: written,
      receipt: null,
      registryFile,
    };
  }

  // ── the operation SUCCEEDED: both halves, same coordinates ───────────────
  // Ledger FIRST. The ledger is the append-only corroborating record; the
  // receipt is the claim it corroborates. If the receipt write then fails, the
  // projector sees a PASS with no claim and renders UNAVAILABLE — visibly
  // missing. The other order would leave a claim with no corroboration, which
  // is the shape this system already refuses to trust. Both directions fail
  // closed; this one fails closed with the canonical evidence intact.
  const passEntry = {
    ...baseEntry,
    result: resultSummary,
    notes: 'A run CONSUMED this connector through the governed integration runner. correlationId is the run, ' +
      'connectorId is the service; the matching USAGE receipt carries the same operationId and observedAt. ' +
      'INTEGRATION-plane entry: it carries no engineering authority and verifies nothing.',
  };
  const written = appendAtomic(passEntry, ledgerFile ? { ledgerFile } : undefined);
  if (!written.appended) {
    throw refuse('LEDGER_DUPLICATE_AFTER_TRANSPORT',
      `the connector was invoked but operationId "${operationId}" was already in the ledger by the time the ` +
      'entry was appended (concurrent writer). No USAGE receipt was written; the external effect may have happened twice.');
  }

  const usageReceipt = {
    connectorId,
    receiptKind: 'USAGE',
    observedAt: ts,
    runId,
    method,
    result: resultSummary,
    operationId,
  };
  if (citedSource !== null) usageReceipt.citedSource = citedSource;

  let receiptOutcome;
  try {
    receiptOutcome = recordReceipt(usageReceipt, registryFile);
  } catch (error) {
    const broken = refuse('RECEIPT_REFUSED',
      `the connector-usage PASS entry "${entryId}" was appended, but the USAGE receipt was refused: ${error.message}. ` +
      'The connector will project UNAVAILABLE rather than USED until a receipt with these exact coordinates is recorded.');
    broken.refused = false; // the effect and the ledger entry are real; this is not a clean refusal
    throw broken;
  }

  return {
    status: 'PASS',
    connectorId, runId, operationId, capability,
    entryId,
    ts,
    citedSource,
    transportInvocations: invocations,
    ledger: written,
    receipt: receiptOutcome,
    registryFile,
  };
}

if (require.main === module) {
  console.error('integration-runner.cjs is a library: it takes an INJECTED transport function, which a command line cannot supply.');
  console.error('Require it and call runIntegration({ transport, runId, operationId, connectorId, capability, resultSummary }).');
  process.exitCode = 2;
}

module.exports = { runIntegration, redactFailureText, USAGE_GATE, ID_PATTERN, CAPABILITY_PATTERN };
