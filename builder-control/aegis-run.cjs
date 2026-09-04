#!/usr/bin/env node
/**
 * aegis-run.cjs — the V1 runtime: intake, worktree, build, checkpoint, rollback.
 *
 * WHY THIS EXISTS
 * AEGIS-V1-ARCHITECTURE-CONTRACT §8 claims V1 proves one complete local loop of
 * eleven steps. Five were executable; steps 1, 4, 5 and 10 did not exist at all.
 * The choice was to shrink the contract or build the runtime. The contract was
 * kept, so this is the runtime.
 *
 * IT OWNS NO AUTHORITY
 * A run file under runs/ is WORKING STATE, not a source of truth:
 *   permission            → the task packet, unchanged
 *   evidence of what ran  → the canonical ledger, appended on every transition
 *   review verdicts       → reviews/, attested, unchanged
 *   the gate              → engineering-os.cjs, unchanged
 * Delete every run file and no permission, verdict or gate decision is lost.
 * That is the test of whether this introduced a second authority: it did not.
 *
 * TRANSITIONS ARE REFUSED, NOT COERCED
 * A run cannot reach a later state by skipping an earlier one. There is no
 * --force. A build with no worktree, a checkpoint with no passing checks, or a
 * rollback with no recorded point are all hard refusals, because a state machine
 * that can be nudged forward is a progress bar, not a control.
 *
 *   node builder-control/aegis-run.cjs --new --objective "..." [--acceptance "..."] [--packet <p>]
 *   node builder-control/aegis-run.cjs --status <runId> [--json]
 *   node builder-control/aegis-run.cjs --worktree <runId>
 *   node builder-control/aegis-run.cjs --build <runId> --cmd "<command>"
 *   node builder-control/aegis-run.cjs --checks <runId>
 *   node builder-control/aegis-run.cjs --checkpoint <runId>
 *   node builder-control/aegis-run.cjs --rollback <runId>
 *   node builder-control/aegis-run.cjs --list [--json]
 *
 * Exit: 0 ok · 2 usage · 3 refused (illegal transition, missing evidence)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Worker } = require('worker_threads');
const CheckContainment = require('./sandbox-containment.cjs');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
// Runs and checkpoints live here. The override exists so the checkpoint/rollback
// SUCCESS path can be exercised against a disposable fixture repo without
// committing anything to the product branch — the one path that could not
// otherwise be proven, because an isolated worktree sits at the base commit.
//
// Constrained to the OS temp directory for the same reason the ledger override
// is: an unconstrained redirect would let a run record its evidence somewhere
// nobody looks.
function resolveDir(envVar, fallback) {
  const o = process.env[envVar];
  if (!o) return fallback;
  const abs = path.resolve(o);
  const tmpRoot = fs.realpathSync(require('os').tmpdir());
  let real;
  try { real = fs.realpathSync(abs); } catch { real = abs; }
  if (real !== tmpRoot && !real.startsWith(tmpRoot + path.sep)) {
    throw new Error(`${envVar} must point inside ${tmpRoot} (got ${abs}). Run evidence may not be redirected outside a temp directory.`);
  }
  return abs;
}
const RUNS_DIR = resolveDir('AEGIS_RUNS_DIR', path.join(HERE, 'runs'));
const CHECKPOINTS_DIR = resolveDir('AEGIS_CHECKPOINTS_DIR', path.join(HERE, 'checkpoints'));
const LEDGER_WRITER = path.join(HERE, 'ledger-writer.cjs');
const ENGOS = path.join(HERE, 'engineering-os.cjs');
const PACKET_TOOLS = path.join(HERE, 'packet-tools.cjs');
const MODEL_ROUTING_POLICY = path.join(HERE, 'MODEL-ROUTING-POLICY.json');

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_REFUSED = 3;

/**
 * The eleven contract steps, as states. Each names the evidence that must exist
 * before the run may leave it — so "what does this state mean" has exactly one
 * answer, written next to the state rather than argued about later.
 */
const STATES = {
  CREATED:          { step: 1,  next: ['INTAKE_RECORDED', 'ABANDONED'] },
  INTAKE_RECORDED:  { step: 2,  next: ['ROUTED', 'ABANDONED'] },
  ROUTED:           { step: 3,  next: ['WORKTREE_READY', 'ABANDONED'] },
  WORKTREE_READY:   { step: 4,  next: ['BUILDING', 'ABANDONED'] },
  BUILDING:         { step: 5,  next: ['BUILT', 'BUILD_FAILED', 'ABANDONED'] },
  BUILT:            { step: 5,  next: ['CHECKS_PASSED', 'CHECKS_FAILED'] },
  CHECKS_PASSED:    { step: 6,  next: ['REVIEW_BOUND', 'REVIEW_FAILED', 'CHECKS_FAILED', 'ABANDONED'] },
  REVIEW_BOUND:     { step: 7,  next: ['CHECKPOINTED', 'CORRECTING', 'ABANDONED'] },
  REVIEW_FAILED:    { step: 7,  next: ['CORRECTING', 'ABANDONED'], failure: true },
  CORRECTING:       { step: 8,  next: ['BUILDING', 'ABANDONED'] },
  CHECKPOINTED:     { step: 10, next: ['ROLLED_BACK'] },
  // The one recovery slot for a synchronous build that timed out mid-edit.
  // It is NOT a correction cycle and NOT reachable by any generic caller:
  // BUILD_FAILED -> BUILD_CONTINUED -> BUILT both require the continuation
  // capability, held only by continueTimedOutBuild() after it has itself
  // executed the bounded same-session resume and observed exit 0.
  BUILD_CONTINUED:  { step: 5,  next: ['BUILT', 'BUILD_FAILED', 'ABANDONED'] },
  // Terminal-ish failure states. Each can only go somewhere honest.
  BUILD_FAILED:     { step: 5,  next: ['CORRECTING', 'ROLLED_BACK', 'ABANDONED', 'BUILD_CONTINUED'], failure: true },
  CHECKS_FAILED:    { step: 6,  next: ['CORRECTING', 'ROLLED_BACK', 'ABANDONED'], failure: true },
  ROLLED_BACK:      { step: 10, next: ['ABANDONED'], failure: true },
  ABANDONED:        { step: 0,  next: [], terminal: true },
};

const MAX_CORRECTIONS = 3;
const WORKER_LAUNCH_GRACE_MS = 5000;

// ── same-attempt timeout continuation ───────────────────────────────────────
// A synchronous builder that is SIGKILLed at its wall clock (exit 124) after it
// has already started editing leaves real work behind and an honest
// BUILD_FAILED. The only truthful way to reconcile that is to finish the SAME
// model session in the SAME worktree under the SAME correction, and to record
// what actually ran. Everything below exists to make that one narrow path
// executable and to keep it from becoming anything wider.
const CONTINUATION_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTINUATION_TIMED_OUT_EXIT = 124;
// The command is executed WITHOUT a shell, so this charset is the whole
// injection surface: no redirect, pipe, separator, substitution or quoting
// character can appear at all.
const CONTINUATION_COMMAND_CHARSET = /^[A-Za-z0-9 _-]+$/;
const CONTINUATION_MAX_COMMAND_LEN = 512;
// Subscription execution, proven by construction: the two API-key variables are
// unset by the command itself, so a continuation can never bill metered spend.
const CONTINUATION_ENV_PREFIX = Object.freeze(
  ['env', '-u', 'ANTHROPIC_API_KEY', '-u', 'ANTHROPIC_AUTH_TOKEN']);
const CONTINUATION_BOUNDING_COMMANDS = new Set(['timeout', 'gtimeout']);
const CONTINUATION_MIN_TIMEOUT_SEC = 1;
const CONTINUATION_MAX_TIMEOUT_SEC = 3600;
// No --model, --provider or -p: resume inherits the original session's route,
// so a continuation cannot re-select a model or smuggle in a fresh prompt.
const CONTINUATION_OPTIONAL_FLAGS = new Set(['--print', '--dangerously-skip-permissions']);
const CONTINUATION_MAX_PROMPT_BYTES = 8 * 1024;
const CONTINUATION_TAIL_LINES = 12;
const CONTINUATION_TAIL_BYTES = 4 * 1024;
// Both execution bounds belong to the shared process-group supervisor: the
// declared wall clock is the absolute bound, and a resume that stops producing
// output is cut at the idle bound instead of holding the attempt open.
const CONTINUATION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const CHECK_FAILURE_TAIL_LINES = 80;
const CHECK_FAILURE_TAIL_BYTES = 16 * 1024;
const CHECK_RECEIPT_NOTE_PREFIX = 'AEGIS_CHECK_RECEIPT_V1:';
const PRE_HOST_CHECK_RECEIPT_TYPE = 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1';
const PRE_HOST_CHECK_RECEIPT_NOTE_PREFIX = `${PRE_HOST_CHECK_RECEIPT_TYPE}:`;
const HOST_CONTAINMENT_BOUNDARY = 'AEGIS_TOP_LEVEL_HOST_CONTAINMENT_V1';
const HOST_CONTAINMENT_AUTHORITY = 'aegis-run.cjs runHostContainmentCheck';
const HOST_PROOF_CONTEXT_TYPE = 'AEGIS_HOST_PROOF_CONTEXT_V1';
const HOST_PROOF_EVIDENCE_TYPE = 'AEGIS_HOST_PROOF_EVIDENCE_V1';
const HOST_PROOF_EVIDENCE_PREFIX = `${HOST_PROOF_EVIDENCE_TYPE}:`;
const TRUSTED_PROCESS_INSPECTOR_ENV = 'AEGIS_TRUSTED_PROCESS_INSPECTOR';
const TRUSTED_PROCESS_INSPECTOR_SHA_ENV = 'AEGIS_TRUSTED_PROCESS_INSPECTOR_SHA256';
const HOST_CONTAINMENT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const HOST_CONTAINMENT_ALLOWED_COMMANDS = new Set([
  'node builder-control/test/host-containment.test.cjs',
]);
const HOST_CONTAINMENT_REQUIRED_PACKET_IDS = new Set([
  'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA',
]);
const HOST_PRE_HOST_COVERAGE_COMMANDS = Object.freeze([
  'node builder-control/test/functional-beta-snapshot.test.cjs',
  'node builder-control/test/dashboard-slice.test.cjs',
]);
const HOST_FIXED_PROBE_NAMES = Object.freeze([
  'deny-default-environment-self-test',
  'governed-worker-lifecycle',
  'governed-run-host-authority',
  'governed-review-adapter-boundary',
  'governed-http-control-path',
  'outer-boundary-fixed-probe',
]);

const nowIso = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}
const stableJson = (value) => JSON.stringify(stableValue(value));

function checkReceiptDigest(receiptWithoutDigest) {
  if (!receiptWithoutDigest || typeof receiptWithoutDigest !== 'object' || Array.isArray(receiptWithoutDigest)) return null;
  const body = { ...receiptWithoutDigest };
  delete body.receiptSha256;
  return sha256(stableJson(body));
}

function hostContainmentReceiptDigest(receiptWithoutDigest) {
  if (!receiptWithoutDigest || typeof receiptWithoutDigest !== 'object' || Array.isArray(receiptWithoutDigest)) return null;
  const body = { ...receiptWithoutDigest };
  delete body.receiptSha256;
  return sha256(stableJson(body));
}

function validSubjectCoordinate(subject) {
  return Boolean(subject && /^[0-9a-f]{64}$/.test(subject.subjectSha256 || '') &&
    Array.isArray(subject.subjectPaths) && subject.subjectPaths.length > 0 &&
    subject.subjectPaths.every((p) => typeof p === 'string' && p.length > 0) &&
    JSON.stringify(subject.subjectPaths) === JSON.stringify([...subject.subjectPaths].sort()) &&
    Number.isInteger(subject.diffBytes) && subject.diffBytes > 0 &&
    (typeof subject.range === 'string' || subject.range === null));
}

function validateCompleteHostContainmentReceipt(receipt, expected = {}) {
  const result = receipt && receipt.result;
  if (!receipt || receipt.schemaVersion !== 1 || receipt.authority !== HOST_CONTAINMENT_AUTHORITY ||
      receipt.executionBoundary !== HOST_CONTAINMENT_BOUNDARY || typeof receipt.runId !== 'string' ||
      !receipt.packet || !receipt.subject || typeof receipt.command !== 'string' || !receipt.command.trim() ||
      !HOST_CONTAINMENT_ALLOWED_COMMANDS.has(receipt.command) || typeof receipt.platform !== 'string' ||
      receipt.complete !== true || !['PASS', 'FAIL'].includes(receipt.outcome) ||
      !Number.isFinite(Date.parse(receipt.startedAt || '')) || !Number.isFinite(Date.parse(receipt.completedAt || '')) ||
      !/^[0-9a-f]{64}$/.test(receipt.packet.sha256 || '') || typeof receipt.packet.path !== 'string' ||
      !receipt.snapshot || receipt.snapshot.policy !== CHECK_SNAPSHOT_POLICY ||
      !/^[0-9a-f]{64}$/.test(receipt.snapshot.captureSha256 || '') ||
      !validSubjectCoordinate(receipt.subject) || !result ||
      !['EXECUTED', 'REFUSED', 'SKIPPED'].includes(result.status) ||
      !(Number.isInteger(result.exit) || result.exit === null) ||
      !Number.isInteger(result.passed) || result.passed < 0 ||
      !Number.isInteger(result.skipped) || result.skipped < 0 ||
      !Number.isInteger(result.failed) || result.failed < 0 ||
      (result.covered !== undefined && (!Number.isInteger(result.covered) || result.covered < 0)) ||
      !Number.isInteger(result.total) || result.total !== result.passed + (result.covered || 0) + result.skipped + result.failed ||
      !Number.isInteger(result.outputBytes) || result.outputBytes < 0 ||
      typeof result.outputTruncated !== 'boolean' || typeof result.summaryParsed !== 'boolean' ||
      typeof result.groupDrained !== 'boolean' || typeof result.ownedGroupDrainageProven !== 'boolean' ||
      !/^[0-9a-f]{64}$/.test(result.outputSha256 || '') ||
      !/^[0-9a-f]{64}$/.test(receipt.receiptSha256 || '') ||
      hostContainmentReceiptDigest(receipt) !== receipt.receiptSha256) return false;
  if (receipt.outcome === 'PASS' && (receipt.platform !== 'darwin' || result.status !== 'EXECUTED' ||
      result.exit !== 0 || result.outputTruncated || !result.summaryParsed || result.passed <= 0 ||
      result.skipped !== 0 || result.failed !== 0 || result.groupDrained !== true ||
      result.ownedGroupDrainageProven !== true)) return false;
  if (receipt.outcome === 'PASS' && (!receipt.preHostReceiptRef ||
      !/^LED-CHECK-[0-9a-f]{32}$/.test(receipt.preHostReceiptRef.entryId || '') ||
      !/^[0-9a-f]{64}$/.test(receipt.preHostReceiptRef.receiptSha256 || '') ||
      !Array.isArray(receipt.coverage) ||
      receipt.coverage.length !== HOST_PRE_HOST_COVERAGE_COMMANDS.length ||
      result.covered !== HOST_PRE_HOST_COVERAGE_COMMANDS.length ||
      receipt.coverage.some((item, index) => !item || item.suite !== 'pre-host-command' ||
        item.command !== HOST_PRE_HOST_COVERAGE_COMMANDS[index] ||
        item.coverage !== 'COVERED_BY_EXACT_PREHOST_COMMAND' ||
        !/^[0-9a-f]{64}$/.test(item.evidenceSha256 || '')))) return false;
  if (expected.runId && receipt.runId !== expected.runId) return false;
  if (expected.packetPath && receipt.packet.path !== expected.packetPath) return false;
  if (expected.packetSha256 && receipt.packet.sha256 !== expected.packetSha256) return false;
  if (expected.subject && !sameCanonicalSubject(receipt.subject, expected.subject)) return false;
  if (expected.command && receipt.command !== expected.command) return false;
  if (expected.platform && receipt.platform !== expected.platform) return false;
  if (expected.preHostReceiptRef && stableJson(receipt.preHostReceiptRef) !== stableJson(expected.preHostReceiptRef)) return false;
  return true;
}

function validateHostContainmentReceipt(receipt, expected = {}) {
  return validateCompleteHostContainmentReceipt(receipt, expected) && receipt.outcome === 'PASS';
}

function validateCheckReceipt(receipt, expected = {}) {
  if (!receipt || receipt.receiptType === PRE_HOST_CHECK_RECEIPT_TYPE ||
      receipt.schemaVersion !== 1 || receipt.authority !== 'aegis-run.cjs runChecks' ||
      typeof receipt.runId !== 'string' || !receipt.packet || !receipt.subject ||
      receipt.complete !== true || receipt.outcome !== 'PASS' ||
      !Number.isInteger(receipt.total) || receipt.total <= 0 || receipt.passed !== receipt.total ||
      !Array.isArray(receipt.results) || receipt.results.length !== receipt.total ||
      !Number.isFinite(Date.parse(receipt.startedAt || '')) || !Number.isFinite(Date.parse(receipt.completedAt || '')) ||
      !/^[0-9a-f]{64}$/.test(receipt.packet.sha256 || '') || typeof receipt.packet.path !== 'string' ||
      !validSubjectCoordinate(receipt.subject) || !/^[0-9a-f]{64}$/.test(receipt.receiptSha256 || '') ||
      checkReceiptDigest(receipt) !== receipt.receiptSha256 ||
      !receipt.results.every((r) => r && typeof r.cmd === 'string' && r.cmd.trim() &&
        r.status === 'EXECUTED' && r.exit === 0 && Number.isFinite(Date.parse(r.ranAt || '')))) return false;
  const hostCommands = Array.isArray(expected.hostCommands) ? expected.hostCommands : null;
  if (hostCommands && hostCommands.length > 0 &&
      (hostCommands.length !== 1 || !validateHostContainmentReceipt(receipt.hostContainment, {
    runId: receipt.runId,
    packetPath: receipt.packet.path,
    packetSha256: receipt.packet.sha256,
    subject: receipt.subject,
    command: hostCommands[0],
    platform: 'darwin',
  }))) return false;
  if ((!hostCommands || hostCommands.length === 0) && receipt.hostContainment &&
      !validateHostContainmentReceipt(receipt.hostContainment, {
    runId: receipt.runId,
    packetPath: receipt.packet.path,
    packetSha256: receipt.packet.sha256,
    subject: receipt.subject,
  })) return false;
  if (expected.runId && receipt.runId !== expected.runId) return false;
  if (expected.packetPath && receipt.packet.path !== expected.packetPath) return false;
  if (expected.packetSha256 && receipt.packet.sha256 !== expected.packetSha256) return false;
  if (expected.subject && !sameCanonicalSubject(receipt.subject, expected.subject)) return false;
  if (expected.commands && JSON.stringify(receipt.results.map((r) => r.cmd)) !== JSON.stringify(expected.commands)) return false;
  return true;
}

function validatePreHostCheckReceipt(receipt, expected = {}) {
  if (!receipt || receipt.schemaVersion !== 1 ||
      receipt.receiptType !== PRE_HOST_CHECK_RECEIPT_TYPE ||
      receipt.authority !== 'aegis-run.cjs runChecks' || typeof receipt.runId !== 'string' ||
      !receipt.packet || !receipt.subject || !receipt.snapshot ||
      receipt.snapshot.policy !== CHECK_SNAPSHOT_POLICY ||
      !/^[0-9a-f]{64}$/.test(receipt.snapshot.captureSha256 || '') ||
      receipt.complete !== true || receipt.outcome !== 'PASS' ||
      !Number.isInteger(receipt.total) || receipt.total <= 0 || receipt.passed !== receipt.total ||
      !Array.isArray(receipt.results) || receipt.results.length !== receipt.total ||
      !Number.isFinite(Date.parse(receipt.startedAt || '')) ||
      !Number.isFinite(Date.parse(receipt.completedAt || '')) ||
      !/^[0-9a-f]{64}$/.test(receipt.packet.sha256 || '') ||
      typeof receipt.packet.path !== 'string' || !validSubjectCoordinate(receipt.subject) ||
      !receipt.hostContainment || receipt.hostContainment.state !== 'PENDING' ||
      !Array.isArray(receipt.hostContainment.commands) ||
      receipt.hostContainment.commands.length !== 1 ||
      !HOST_CONTAINMENT_ALLOWED_COMMANDS.has(receipt.hostContainment.commands[0]) ||
      !/^[0-9a-f]{64}$/.test(receipt.receiptSha256 || '') ||
      checkReceiptDigest(receipt) !== receipt.receiptSha256 ||
      !receipt.results.every((result) => result && typeof result.cmd === 'string' && result.cmd.trim() &&
        result.status === 'EXECUTED' && result.exit === 0 &&
        Number.isFinite(Date.parse(result.ranAt || '')))) return false;
  if (expected.runId && receipt.runId !== expected.runId) return false;
  if (expected.packetPath && receipt.packet.path !== expected.packetPath) return false;
  if (expected.packetSha256 && receipt.packet.sha256 !== expected.packetSha256) return false;
  if (expected.subject && !sameCanonicalSubject(receipt.subject, expected.subject)) return false;
  if (expected.captureSha256 && receipt.snapshot.captureSha256 !== expected.captureSha256) return false;
  if (expected.commands && JSON.stringify(receipt.results.map((result) => result.cmd)) !==
      JSON.stringify(expected.commands)) return false;
  if (expected.hostCommands && JSON.stringify(receipt.hostContainment.commands) !==
      JSON.stringify(expected.hostCommands)) return false;
  return true;
}

function validateCompleteCheckReceipt(receipt, expected = {}) {
  if (!receipt || receipt.receiptType === PRE_HOST_CHECK_RECEIPT_TYPE ||
      receipt.schemaVersion !== 1 || receipt.authority !== 'aegis-run.cjs runChecks' ||
      typeof receipt.runId !== 'string' || !receipt.packet || !receipt.subject || receipt.complete !== true ||
      !['PASS', 'FAIL'].includes(receipt.outcome) || !Number.isInteger(receipt.total) || receipt.total <= 0 ||
      !Number.isInteger(receipt.passed) || receipt.passed < 0 || receipt.passed > receipt.total ||
      !Array.isArray(receipt.results) || receipt.results.length !== receipt.total ||
      !Number.isFinite(Date.parse(receipt.startedAt || '')) || !Number.isFinite(Date.parse(receipt.completedAt || '')) ||
      !/^[0-9a-f]{64}$/.test(receipt.packet.sha256 || '') || typeof receipt.packet.path !== 'string' ||
      !validSubjectCoordinate(receipt.subject) || !/^[0-9a-f]{64}$/.test(receipt.receiptSha256 || '') ||
      checkReceiptDigest(receipt) !== receipt.receiptSha256 ||
      !receipt.results.every((r) => r && typeof r.cmd === 'string' && r.cmd.trim() &&
        typeof r.status === 'string' && (Number.isInteger(r.exit) || r.exit === null))) return false;
  if (receipt.hostContainment && !validateCompleteHostContainmentReceipt(receipt.hostContainment, {
    runId: receipt.runId,
    packetPath: receipt.packet.path,
    packetSha256: receipt.packet.sha256,
    subject: receipt.subject,
  })) return false;
  if (Array.isArray(expected.hostCommands) && expected.hostCommands.length > 0 &&
      (!receipt.hostContainment || expected.hostCommands.length !== 1 ||
       receipt.hostContainment.command !== expected.hostCommands[0])) return false;
  if (receipt.outcome === 'PASS' && !validateCheckReceipt(receipt, expected)) return false;
  if (receipt.outcome === 'FAIL' && receipt.passed !== receipt.results.filter((r) => r.exit === 0).length) return false;
  if (expected.runId && receipt.runId !== expected.runId) return false;
  if (expected.packetPath && receipt.packet.path !== expected.packetPath) return false;
  if (expected.packetSha256 && receipt.packet.sha256 !== expected.packetSha256) return false;
  if (expected.subject && !sameCanonicalSubject(receipt.subject, expected.subject)) return false;
  if (expected.commands && JSON.stringify(receipt.results.map((r) => r.cmd)) !== JSON.stringify(expected.commands)) return false;
  return true;
}

function trustedProcessInspector(source = process.env) {
  if (source.AEGIS_HOST_OUTER_CONTAINMENT !== HOST_CONTAINMENT_BOUNDARY &&
      source.AEGIS_CHECK_SNAPSHOT_POLICY !== CHECK_SNAPSHOT_POLICY) return null;
  const candidate = source[TRUSTED_PROCESS_INSPECTOR_ENV];
  const expectedSha256 = source[TRUSTED_PROCESS_INSPECTOR_SHA_ENV];
  const home = source.HOME;
  const scratch = source.TMPDIR;
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) ||
      !/^[0-9a-f]{64}$/.test(expectedSha256 || '') ||
      typeof home !== 'string' || typeof scratch !== 'string') return null;
  const root = path.dirname(home);
  const normalizedScratch = scratch.endsWith(path.sep) ? scratch.slice(0, -1) : scratch;
  const bin = path.join(root, 'bin');
  if (home !== path.join(root, 'home') || normalizedScratch !== path.join(root, 'tmp') ||
      candidate !== path.join(bin, 'ps')) return null;
  try {
    for (const target of [root, bin]) {
      const stat = fs.lstatSync(target);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
          (stat.mode & 0o022) !== 0 || fs.realpathSync(target) !== target) return null;
    }
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
        (stat.mode & 0o077) !== 0 || (stat.mode & 0o100) === 0 ||
        fs.realpathSync(candidate) !== candidate ||
        sha256(fs.readFileSync(candidate)) !== expectedSha256) return null;
  } catch { return null; }
  // The env pair alone must never be able to select an inspector outside real
  // containment. The disposable boundary root is deliberately writable inside
  // the check sandbox, so a writability probe proves nothing there; what only
  // real containment can prove is deny-default reads. A host file no check
  // profile allowlists must be unreadable — the same proof the inherited
  // snapshot boundary already requires. Outside containment that read succeeds
  // and the candidate is refused, leaving the system inspector authoritative.
  try { fs.readFileSync('/private/etc/hosts'); return null; }
  catch (error) { return ['EPERM', 'EACCES'].includes(error.code) ? candidate : null; }
}

function processInspectorExecutable(source = process.env) {
  return trustedProcessInspector(source) || (fs.existsSync('/bin/ps') ? '/bin/ps' : '/usr/bin/ps');
}

/**
 * Keep failed check diagnostics useful without turning arbitrary process output
 * into a credential store. This evidence remains in the private run record;
 * the dashboard control response still returns counts only.
 */
function boundedCheckFailureTail(value) {
  let text = String(value || '')
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/-----BEGIN [^-\r\n]+-----[\s\S]*?-----END [^-\r\n]+-----/g, '[REDACTED PEM]')
    .replace(/((?:set-)?cookie\s*:\s*)[^\r\n]*/ig, '$1[REDACTED]')
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+/ig, '$1[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd)["']?\s*[=:]\s*["']?)[^\s,"'}]+/ig,
      '$1[REDACTED]')
    .replace(/([?&#](?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password)=)[^&#\s]*/ig,
      '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+@/ig, '$1[REDACTED]@')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, '[REDACTED JWT]')
    .replace(/\b(?:sk|gh[opusr]|github_pat|xox[baprs])-?[A-Za-z0-9_-]{12,}\b/ig, '[REDACTED TOKEN]')
    // Unknown opaque strings are safer treated as secrets. This can redact a
    // hash, but a digest is less useful than an accidentally persisted token.
    .replace(/(?<![A-Za-z0-9])[A-Za-z0-9_+\/=.-]{32,}(?![A-Za-z0-9])/g, '[REDACTED OPAQUE]')
    .replace(/[^\S\r\n]+$/gm, '');
  const lines = text.split(/\r?\n/);
  let truncated = lines.length > CHECK_FAILURE_TAIL_LINES;
  text = lines.slice(-CHECK_FAILURE_TAIL_LINES).join('\n');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > CHECK_FAILURE_TAIL_BYTES) {
    truncated = true;
    text = bytes.subarray(bytes.length - CHECK_FAILURE_TAIL_BYTES).toString('utf8').replace(/^\uFFFD+/, '');
  }
  return { tail: text, truncated };
}

/**
 * Capture the OS identity of this exact process lifetime. PIDs and process
 * group IDs are reusable, so neither is cancellation authority by itself.
 * Linux provides a boot-relative start tick and executable through /proc;
 * macOS and other POSIX hosts use ps start time plus executable.
 */
function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const procDir = path.join('/proc', String(pid));
  try {
    const stat = fs.readFileSync(path.join(procDir, 'stat'), 'utf8');
    const close = stat.lastIndexOf(')');
    if (close === -1) return null;
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const processGroupId = Number(fields[2]);
    const startMarker = fields[19];
    const executable = fs.realpathSync(path.join(procDir, 'exe'));
    if (!Number.isInteger(processGroupId) || !startMarker || !executable) return null;
    return Object.freeze({ pid, processGroupId, startMarker, executable, source: 'procfs' });
  } catch { /* non-Linux host or the process exited; fall through to ps */ }

  const psValue = (field) => {
    const result = spawnSync(processInspectorExecutable(), ['-p', String(pid), '-o', `${field}=`], {
      encoding: 'utf8', timeout: 1000,
    });
    return result.status === 0 ? String(result.stdout || '').trim() : '';
  };
  const processGroupId = Number(psValue('pgid'));
  const startMarker = psValue('lstart');
  const executable = psValue('comm');
  if (!Number.isInteger(processGroupId) || !startMarker || !executable) return null;
  return Object.freeze({ pid, processGroupId, startMarker, executable, source: 'ps' });
}

/**
 * Establish only whether a PID currently exists. Identity inspection and
 * existence are deliberately separate: a missing identity can mean either a
 * dead process or an inaccessible live process, and those require opposite
 * claim decisions. This probe never sends a signal to the target process.
 */
function processExistence(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return 'unknown';
  const procRoot = '/proc';
  try {
    if (fs.statSync(procRoot).isDirectory()) {
      try { fs.lstatSync(path.join(procRoot, String(pid))); return 'present'; }
      catch (e) { return e.code === 'ENOENT' ? 'absent' : 'unknown'; }
    }
  } catch { /* non-Linux host; use a read-only ps query */ }

  const result = spawnSync(processInspectorExecutable(), ['-p', String(pid), '-o', 'pid='], {
    encoding: 'utf8', timeout: 1000,
  });
  if (result.error || result.signal || result.status === null) return 'unknown';
  const observed = String(result.stdout || '').trim();
  if (result.status === 0 && observed.split(/\s+/).includes(String(pid))) return 'present';
  if (result.status === 1 && !observed) return 'absent';
  return 'unknown';
}

function processGroupExistence(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return 'unknown';
  try { process.kill(-processGroupId, 0); return 'present'; }
  catch (error) {
    if (error && error.code === 'ESRCH') return 'absent';
    if (error && error.code === 'EPERM') return 'present';
    return 'unknown';
  }
}

function processGroupMembers(processGroupId, timeoutMs = 500) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return null;
  const observed = spawnSync(processInspectorExecutable(), ['-axo', 'pid=,pgid='], {
    encoding: 'utf8', timeout: timeoutMs,
  });
  if (observed.error || observed.signal || observed.status !== 0) return null;
  const members = [];
  for (const line of String(observed.stdout || '').split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (match && Number(match[2]) === processGroupId) members.push(Number(match[1]));
  }
  return members;
}

function sameProcessIdentity(recorded, observed) {
  return Boolean(recorded && observed &&
    recorded.pid === observed.pid &&
    recorded.processGroupId === observed.processGroupId &&
    recorded.startMarker === observed.startMarker &&
    recorded.executable === observed.executable &&
    recorded.source === observed.source);
}

function workerLeaseRunBindingMatches(claim) {
  if (!claim || claim.holder !== 'WORKER_LEASE') return false;
  let run;
  try { run = loadRun(claim.runId); } catch { return false; }
  const lease = run && run.build && run.build.globalLease;
  return Boolean(lease && run.build.attemptId === claim.attemptId &&
    lease.claimId === claim.claimId && lease.holder === 'WORKER_LEASE' &&
    lease.transferFrom === claim.transferFrom && lease.runId === claim.runId &&
    lease.attemptId === claim.attemptId && lease.pid === claim.pid &&
    lease.processGroupId === claim.processGroupId &&
    sameProcessIdentity(lease.processIdentity, claim.processIdentity));
}

function workerOwnershipProof(initialBuild, freshBuild) {
  if (!initialBuild || !freshBuild ||
      typeof freshBuild.attemptId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(freshBuild.attemptId) ||
      initialBuild.attemptId !== freshBuild.attemptId ||
      initialBuild.attempt !== freshBuild.attempt ||
      initialBuild.workerPid !== freshBuild.workerPid ||
      initialBuild.processGroupId !== freshBuild.processGroupId ||
      freshBuild.processGroupId !== freshBuild.workerPid ||
      !sameProcessIdentity(initialBuild.processIdentity, freshBuild.processIdentity)) {
    return null;
  }
  const observed = processIdentity(freshBuild.workerPid);
  return sameProcessIdentity(freshBuild.processIdentity, observed) ? observed : null;
}

class RunError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}

/**
 * AegisControlError — a stable, HTTP-shaped error for control-surface intake
 * (the dashboard). Distinct from RunError, which is the runtime's own refusal
 * type: this one exists so an HTTP layer can map errors to status codes
 * without inspecting message text.
 */
class AegisControlError extends Error {
  constructor(code, msg, httpStatus) {
    super(msg);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ── objective intake (dashboard) ────────────────────────────────────────────
// Pure, fail-closed normalization of a POSTed objective. No filesystem, no
// subprocess, no ledger write, no model call, no GitHub mutation — it forms
// no opinion beyond "is this a well-shaped objective", because a second
// opinion here is exactly the second authority the contract forbids.
const OBJECTIVE_ALLOWED_KEYS = new Set(['objective', 'project', 'constraints', 'acceptance', 'dataClass']);
const OBJECTIVE_DATA_CLASSES = new Set(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
const OBJECTIVE_DANGEROUS_FIELDS = new Set([
  'command', 'shell', 'argv', 'model', 'provider', 'verdict', 'auth', 'token', 'secret', 'approval',
]);
const OBJECTIVE_MAX_LEN = 4000;
const OBJECTIVE_PROJECT_MAX_LEN = 100;
const OBJECTIVE_ARRAY_MAX_ITEMS = 20;
const OBJECTIVE_ARRAY_ITEM_MAX_LEN = 500;

function invalidObjective(reason) {
  return new AegisControlError('INVALID_OBJECTIVE', reason, 400);
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function containsDangerousField(value, path) {
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = containsDangerousField(v, path);
      if (hit) return hit;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (OBJECTIVE_DANGEROUS_FIELDS.has(k.trim().toLowerCase())) {
        return `${path}.${k} is a control field, not an objective field`;
      }
      const hit = containsDangerousField(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

function normalizeStringArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidObjective(`${field} must be an array of strings`);
  if (value.length > OBJECTIVE_ARRAY_MAX_ITEMS) {
    throw invalidObjective(`${field} may not contain more than ${OBJECTIVE_ARRAY_MAX_ITEMS} entries`);
  }
  return value.map((v, i) => {
    if (typeof v !== 'string') throw invalidObjective(`${field}[${i}] must be a string`);
    const s = v.trim().replace(/\s+/g, ' ');
    if (!s) throw invalidObjective(`${field}[${i}] may not be empty`);
    if (s.length > OBJECTIVE_ARRAY_ITEM_MAX_LEN) {
      throw invalidObjective(`${field}[${i}] may not exceed ${OBJECTIVE_ARRAY_ITEM_MAX_LEN} characters`);
    }
    return s;
  });
}

function normalizeObjective(input) {
  if (!isPlainObject(input)) {
    throw invalidObjective('objective intake must be a plain object');
  }

  const unknownKeys = Object.keys(input).filter((k) => !OBJECTIVE_ALLOWED_KEYS.has(k));
  if (unknownKeys.length) {
    throw invalidObjective(`unknown field(s): ${unknownKeys.join(', ')}`);
  }

  const dangerous = containsDangerousField(input, 'objective');
  if (dangerous) {
    throw invalidObjective(`refusing dangerous input: ${dangerous}`);
  }

  if (typeof input.objective !== 'string') {
    throw invalidObjective('objective is required and must be a string');
  }
  const objective = input.objective.trim().replace(/\s+/g, ' ');
  if (!objective) throw invalidObjective('objective may not be empty');
  if (objective.length > OBJECTIVE_MAX_LEN) {
    throw invalidObjective(`objective may not exceed ${OBJECTIVE_MAX_LEN} characters`);
  }

  let project = null;
  if (input.project !== undefined) {
    if (typeof input.project !== 'string') throw invalidObjective('project must be a string');
    project = input.project.trim().replace(/\s+/g, ' ');
    if (!project) throw invalidObjective('project may not be empty when provided');
    if (project.length > OBJECTIVE_PROJECT_MAX_LEN) {
      throw invalidObjective(`project may not exceed ${OBJECTIVE_PROJECT_MAX_LEN} characters`);
    }
  }

  const constraints = normalizeStringArray(input.constraints, 'constraints');
  const acceptance = normalizeStringArray(input.acceptance, 'acceptance');

  let dataClass = 'INTERNAL';
  if (input.dataClass !== undefined) {
    if (typeof input.dataClass !== 'string' || !OBJECTIVE_DATA_CLASSES.has(input.dataClass)) {
      throw invalidObjective(`dataClass must be one of ${[...OBJECTIVE_DATA_CLASSES].join(', ')}`);
    }
    dataClass = input.dataClass;
  }

  return Object.freeze({
    objective,
    project,
    constraints: Object.freeze(constraints),
    acceptance: Object.freeze(acceptance),
    dataClass,
  });
}

// ── packet resolution (dashboard) ───────────────────────────────────────────
// options.packet is the ONLY way a packet reaches createRunFromObjective —
// never from the POSTed input, which normalizeObjective already refuses to
// carry (it is not in OBJECTIVE_ALLOWED_KEYS). A packet path must resolve
// inside builder-control/packets and exist, the same containment discipline
// resolveDir applies to run/checkpoint evidence, so the intake path cannot be
// used to read or reference an arbitrary file on disk.
const PACKETS_DIR = path.join(HERE, 'packets');

function resolvePacketOption(packetOption) {
  if (packetOption === undefined || packetOption === null) return null;
  if (typeof packetOption !== 'string' || !packetOption.trim()) {
    throw new AegisControlError('INVALID_PACKET', 'packet must be a non-empty string path', 400);
  }
  const abs = path.resolve(ROOT, packetOption);
  let real;
  try { real = fs.realpathSync(abs); }
  catch { throw new AegisControlError('INVALID_PACKET', `packet "${packetOption}" does not exist`, 400); }
  let packetsReal;
  try { packetsReal = fs.realpathSync(PACKETS_DIR); }
  catch { throw new AegisControlError('INVALID_PACKET', 'the packets directory is unavailable', 400); }
  if (real !== packetsReal && !real.startsWith(packetsReal + path.sep)) {
    throw new AegisControlError('INVALID_PACKET',
      `packet must resolve inside ${path.relative(ROOT, PACKETS_DIR)}`, 400);
  }
  if (!fs.statSync(real).isFile()) {
    throw new AegisControlError('INVALID_PACKET', `packet "${packetOption}" is not a file`, 400);
  }
  return path.relative(ROOT, real);
}

function packetCoordinate(packet) {
  const packetReal = fs.realpathSync(path.resolve(ROOT, packet));
  const bytes = fs.readFileSync(packetReal);
  return Object.freeze({
    path: path.relative(ROOT, packetReal),
    sha256: sha256(bytes),
    real: packetReal,
    // The packet is executable authority. Retain the exact bytes whose digest
    // and parsed commands were accepted so snapshot establishment cannot
    // re-open the path and silently execute a different packet generation.
    bytes,
    parsed: JSON.parse(bytes.toString('utf8')),
  });
}

/**
 * Validate the exact packet generation whose digest is retained by intake.
 * packet-tools.cjs remains the sole schema/registry authority; the private
 * snapshot prevents its validation read from racing a replacement of the
 * canonical path. A second coordinate read proves the path still contains
 * the validated generation before it can be recorded or launched.
 */
function validatedPacketCoordinate(packet) {
  const before = packetCoordinate(packet);
  const validationDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-packet-validation-'));
  const validationPath = path.join(validationDir, 'packet.json');
  let validation;
  try {
    fs.writeFileSync(validationPath, before.bytes, { flag: 'wx', mode: 0o600 });
    validation = spawnSync(process.execPath, [PACKET_TOOLS, '--validate', validationPath], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
  } finally {
    fs.rmSync(validationDir, { recursive: true, force: true });
  }
  if (!validation || validation.status !== 0) {
    const detail = boundedCheckFailureTail(
      `${validation && validation.stderr ? validation.stderr : ''}\n${validation && validation.stdout ? validation.stdout : ''}`
    ).tail;
    throw new Error(`canonical packet validation failed${detail ? `: ${detail}` : ''}`);
  }
  const after = packetCoordinate(packet);
  if (before.path !== after.path || before.sha256 !== after.sha256) {
    throw new Error('packet bytes changed while canonical validation was in progress');
  }
  const packetId = before.parsed && before.parsed.packetId;
  if (typeof packetId !== 'string' || !packetId.trim() || packetId !== after.parsed.packetId) {
    throw new Error('canonical packetId is missing or changed');
  }
  return Object.freeze({
    path: before.path,
    sha256: before.sha256,
    packetId,
    // The launch-spec factory consumes this exact validated generation. It
    // must never reopen the mutable canonical path between validation reads.
    parsed: before.parsed,
  });
}

function samePacketCoordinate(left, right) {
  return Boolean(left && right &&
    left.path === right.path && left.sha256 === right.sha256 && left.packetId === right.packetId);
}

function currentRunPacketCoordinate(run) {
  if (!run || !run.packetCoordinate ||
      typeof run.packetCoordinate.path !== 'string' ||
      !/^[0-9a-f]{64}$/.test(run.packetCoordinate.sha256 || '') ||
      typeof run.packetCoordinate.packetId !== 'string' || !run.packetCoordinate.packetId.trim() ||
      run.packetCoordinate.path !== run.packet) {
    throw new Error('run has no complete immutable intake packet coordinate');
  }
  const recordedPacket = resolvePacketOption(run.packet);
  if (!recordedPacket) throw new Error('packet is absent');
  const current = validatedPacketCoordinate(recordedPacket);
  if (!samePacketCoordinate(run.packetCoordinate, current)) {
    throw new Error('packet path, sha256, or packetId changed after objective intake');
  }
  return current;
}

function runnableCheckCommands(packet) {
  return (packet.testsRequired || []).filter((command) => {
    if (typeof command !== 'string') return false;
    const tokens = command.trim().split(/\s+/);
    const entrypoint = tokens[1] && tokens[1].replace(/^\.\//, '');
    return !(tokens[0] === 'node' && entrypoint === 'builder-control/engineering-os.cjs' &&
      tokens.includes('--gate-done'));
  });
}

// Fixed-policy narrowing. Both lists are module constants: no caller, packet, or
// changed-path input can supply, name, or invent a command, and every returned
// entry is an element the packet already declared in testsRequired.
const DASHBOARD_SLICE_PATHS = Object.freeze([
  'builder-control/dashboard/index.html',
  'builder-control/test/dashboard-slice.test.cjs',
]);
const DASHBOARD_SLICE_CHECKS = Object.freeze([
  'node builder-control/test/dashboard-slice.test.cjs',
  'git diff --check',
]);

function dashboardSliceCheckCommands(packet, changedPaths) {
  const commands = runnableCheckCommands(packet || {});
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return commands;
  if (!changedPaths.every((p) => typeof p === 'string' && DASHBOARD_SLICE_PATHS.includes(p))) return commands;
  if (!DASHBOARD_SLICE_CHECKS.every((command) => commands.includes(command))) return commands;
  return commands.filter((command) => DASHBOARD_SLICE_CHECKS.includes(command));
}

function runnableHostContainmentCommands(packet) {
  const declared = packet && packet.hostContainmentRequired;
  const required = Boolean(packet && HOST_CONTAINMENT_REQUIRED_PACKET_IDS.has(packet.packetId));
  if (declared === undefined && !required) return [];
  if (!Array.isArray(declared) || declared.length !== 1 ||
      declared.some((command) => typeof command !== 'string' || !HOST_CONTAINMENT_ALLOWED_COMMANDS.has(command)) ||
      (required && (!Array.isArray(packet.filesAllowed) ||
        ![
          'builder-control/test/host-containment.test.cjs',
          'builder-control/test/aegis-worker.test.cjs',
          'builder-control/test/review-adapters.test.cjs',
          'builder-control/test/aegis-run.test.cjs',
          'builder-control/test/hosting.test.cjs',
        ].every((entrypoint) => packet.filesAllowed.includes(entrypoint)) ||
        !packet.authorization || !Array.isArray(packet.authorization.allowsProtectedPaths) ||
        ![
          'builder-control/test/host-containment.test.cjs',
          'builder-control/test/aegis-worker.test.cjs',
          'builder-control/test/review-adapters.test.cjs',
          'builder-control/test/aegis-run.test.cjs',
          'builder-control/test/hosting.test.cjs',
        ].every((entrypoint) => packet.authorization.allowsProtectedPaths.includes(entrypoint))))) {
    throw new RunError('HOST-CONTAINMENT-PACKET-INVALID',
      'hostContainmentRequired must declare the one canonical aggregate host containment suite and authorize each exact suite it executes');
  }
  return declared.slice();
}

// ── git, argument-array only ────────────────────────────────────────────────
function git(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new RunError('GIT-SPAWN', `git ${args[0]}: ${r.error.message}`);
  return r;
}

// ── run storage (working state only) ────────────────────────────────────────
const RUN_ID_RE = /^RUN-\d{8}-[0-9a-f]{8}$/;

function runPath(runId) {
  if (!RUN_ID_RE.test(runId)) throw new RunError('BAD-RUN-ID', `"${runId}" is not a run id`);
  return path.join(RUNS_DIR, `${runId}.json`);
}
function loadRun(runId) {
  const p = runPath(runId);
  if (!fs.existsSync(p)) throw new RunError('NO-SUCH-RUN', `no run ${runId}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function saveRun(run) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const target = runPath(run.runId);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(run, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
  return run;
}

function runLockPath(runId) { return `${runPath(runId)}.launch.lock`; }
function globalWorkerLockPath() { return path.join(RUNS_DIR, '.global-worker.launch.lock'); }

/**
 * A third holder on the SAME canonical global claim — not a second lock. A
 * dashboard review occupies the one admission slot builders already contend
 * for, so a review can never overlap a builder, and two reviews can never
 * overlap each other.
 *
 * It differs from the builder holders in exactly one way, and deliberately:
 * a review hold is NEVER reclaimable. A launcher or a worker lease can be
 * recovered from proven owner death because the thing they guard — a build
 * process group — is observable, so absence is evidence. A review's reviewer
 * process is not owned by this claim, so a dead or PID-reused caller proves
 * nothing about whether a reviewer is still running. Freeing the slot on that
 * evidence would be a guess, and the guess admits an overlapping reviewer.
 * The hold therefore survives caller death and is released only through
 * releaseGlobalReviewHold below. Automatic cleanup of an abandoned hold is
 * deliberately NOT implemented here.
 */
const REVIEW_HOLD_HOLDER = 'REVIEW_HOLD';

function readRunLaunchClaim(lockPath) {
  let stat;
  try { stat = fs.lstatSync(lockPath); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  // Pre-directory claims and malformed lock objects are preserved. Guessing
  // that an unreadable owner is stale would turn uncertainty into authority.
  if (!stat.isDirectory()) return Object.freeze({ blocked: true, reason: 'LEGACY_OR_MALFORMED_CLAIM' });
  let ownerNames;
  try { ownerNames = fs.readdirSync(lockPath); }
  catch { return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' }); }
  if (ownerNames.length === 0) return Object.freeze({ blocked: true, reason: 'EMPTY_CLAIM' });
  if (ownerNames.some((name) => !name.endsWith('.json')) || ownerNames.length > 2) {
    return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' });
  }
  const owners = [];
  for (const ownerName of ownerNames) {
    const ownerPath = path.join(lockPath, ownerName);
    let claim;
    try { claim = JSON.parse(fs.readFileSync(ownerPath, 'utf8')); }
    catch { return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' }); }
    if (!claim || claim.claimId !== ownerName.slice(0, -'.json'.length) ||
        typeof claim.claimId !== 'string' || !claim.claimId ||
        !Number.isInteger(claim.pid) || claim.pid <= 1 || !claim.processIdentity ||
        (claim.holder === 'WORKER_LEASE' &&
          (!RUN_ID_RE.test(claim.runId || '') || typeof claim.attemptId !== 'string' ||
           !Number.isInteger(claim.processGroupId) || claim.processGroupId <= 1)) ||
        // A review hold that cannot name its run and its unique attempt is
        // malformed. It stays blocked rather than becoming releasable.
        (claim.holder === REVIEW_HOLD_HOLDER &&
          (!RUN_ID_RE.test(claim.runId || '') || typeof claim.attemptId !== 'string' ||
           !claim.attemptId))) {
      return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' });
    }
    owners.push({ claim, ownerPath });
  }
  if (owners.length === 1) return Object.freeze(owners[0]);
  // Transfer publishes a new immutable generation before removing the exact
  // launcher generation. Only that unambiguous two-record relationship is
  // resolvable; every other multi-owner shape fails closed. A transfer source
  // is always a LAUNCHER, so a review hold can never be the record this reader
  // silently retires.
  const worker = owners.find(({ claim }) => claim.holder === 'WORKER_LEASE');
  const launcher = owners.find(({ claim }) => worker && claim.holder === 'LAUNCHER' &&
    claim.claimId === worker.claim.transferFrom);
  if (!worker || !launcher || worker === launcher ||
      owners.filter(({ claim }) => claim.holder === 'WORKER_LEASE').length !== 1) {
    return Object.freeze({ blocked: true, reason: 'AMBIGUOUS_CLAIM' });
  }
  try { fs.unlinkSync(launcher.ownerPath); }
  catch (error) { if (error.code !== 'ENOENT') return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' }); }
  return Object.freeze(worker);
}

function publishRunLaunchClaim(lockPath, claim) {
  // Build the complete claim away from the canonical name. rename(2) then
  // publishes the non-empty directory atomically; a crash while constructing
  // it can leave only a uniquely named, non-authoritative sibling.
  const publicationPath = `${lockPath}.claim-${claim.pid}-${claim.claimId}.tmp`;
  const publicationOwner = path.join(publicationPath, `${claim.claimId}.json`);
  try {
    fs.mkdirSync(publicationPath, { mode: 0o700 });
    fs.writeFileSync(publicationOwner, JSON.stringify(claim), { flag: 'wx', mode: 0o600 });
    fs.renameSync(publicationPath, lockPath);
    return Object.freeze({ ...claim, lockPath, ownerPath: path.join(lockPath, `${claim.claimId}.json`) });
  } finally {
    // This path is claim-specific, so cleanup can never remove another
    // claimant's publication. A process crash may leave it behind, but such a
    // sibling is ignored by readers and cannot wedge the canonical claim.
    try { fs.unlinkSync(publicationOwner); } catch {}
    try { fs.rmdirSync(publicationPath); } catch {}
  }
}

function cleanupOrphanClaimPublications(lockPath) {
  const parent = path.dirname(lockPath);
  const prefix = `${path.basename(lockPath)}.claim-`;
  let names;
  try { names = fs.readdirSync(parent); } catch { return; }
  for (const name of names) {
    const transferPrefix = `${path.basename(lockPath)}.transfer-`;
    if (name.startsWith(transferPrefix) && name.endsWith('.tmp')) {
      const transferMatch = name.slice(transferPrefix.length, -'.tmp'.length)
        .match(/^(\d+)-([0-9a-f]{8}-[0-9a-f-]{27})$/);
      if (transferMatch && processExistence(Number(transferMatch[1])) === 'absent') {
        try { fs.unlinkSync(path.join(parent, name)); } catch {}
      }
      continue;
    }
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
    const match = name.slice(prefix.length, -'.tmp'.length)
      .match(/^(\d+)-([0-9a-f]{8}-[0-9a-f-]{27})$/);
    if (!match || processExistence(Number(match[1])) !== 'absent') continue;
    const publicationPath = path.join(parent, name);
    let stat;
    try { stat = fs.lstatSync(publicationPath); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let entries;
    try { entries = fs.readdirSync(publicationPath); } catch { continue; }
    if (entries.length === 0) {
      try { fs.rmdirSync(publicationPath); } catch {}
      continue;
    }
    // A complete but unpublished orphan is removable only when its sole owner
    // record agrees with the PID and claimId encoded in the unique sibling.
    if (entries.length !== 1 || entries[0] !== `${match[2]}.json`) continue;
    const ownerPath = path.join(publicationPath, entries[0]);
    let owner;
    try { owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')); } catch { continue; }
    if (!owner || owner.pid !== Number(match[1]) || owner.claimId !== match[2]) continue;
    try { fs.unlinkSync(ownerPath); } catch { continue; }
    try { fs.rmdirSync(publicationPath); } catch {}
  }
}

function acquireLaunchClaim(lockPath, scope, waitMs = 0, metadata = {}) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const claimId = crypto.randomUUID();
  const claimantIdentity = processIdentity(process.pid);
  if (!claimantIdentity) {
    throw new AegisControlError('CLAIM_IDENTITY_UNAVAILABLE',
      `cannot prove the process lifetime claiming ${scope}`, 409);
  }
  // The holder is decided BEFORE the single atomic publication below, so a
  // review hold exists as a review hold from its first published byte. There
  // is no interval in which it is a reclaimable LAUNCHER awaiting promotion.
  const claim = { claimId, scope, ...metadata, holder: metadata.holder || 'LAUNCHER',
    pid: process.pid, processIdentity: claimantIdentity, claimedAt: nowIso() };
  cleanupOrphanClaimPublications(lockPath);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return publishRunLaunchClaim(lockPath, claim);
    } catch (e) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e;
      const existing = readRunLaunchClaim(lockPath);
      if (existing && existing.blocked && existing.reason === 'EMPTY_CLAIM') {
        try { fs.rmdirSync(lockPath); }
        catch (removeError) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(removeError.code)) throw removeError;
        }
        continue;
      }
      if (!existing || existing.blocked) {
        if (Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(20, deadline - Date.now()));
          continue;
        }
        throw new AegisControlError('LAUNCH_IN_PROGRESS', `${scope} already has an atomic launch claim`, 409);
      }
      const existence = processExistence(existing.claim.pid);
      const observedOwner = existence === 'present' ? processIdentity(existing.claim.pid) : null;
      // Positive absence is sufficient to reclaim a crashed owner. Unknown
      // existence, or a live owner whose immutable identity is unavailable,
      // fails closed. A positive different identity means the PID was reused.
      let reclaimable = existence === 'absent' ||
        (existence === 'present' && observedOwner &&
          !sameProcessIdentity(existing.claim.processIdentity, observedOwner));
      if (existing.claim.holder === REVIEW_HOLD_HOLDER) {
        // Owner death and PID reuse are exactly the conditions that free the
        // builder holders. They free nothing here: this claim guards a
        // reviewer this process never owned, so its absence is unobservable
        // and the slot stays occupied until proven release.
        reclaimable = false;
      } else if (existing.claim.holder === 'WORKER_LEASE') {
        // A dead supervisor is not a drained build: its child and descendants
        // remain in the worker-owned process group after the leader exits.
        // Admission is recoverable only when BOTH the exact owner lifetime is
        // gone/reused and the complete group is positively absent. Run-file
        // publication is deliberately not required here: the launcher can die
        // after lease transfer but before publishing worker metadata, and that
        // crash must not create an unreclaimable global lock.
        reclaimable = reclaimable &&
          processGroupExistence(existing.claim.processGroupId) === 'absent';
      }
      if (!reclaimable) {
        if (Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(20, deadline - Date.now()));
          continue;
        }
        throw new AegisControlError('LAUNCH_IN_PROGRESS', `${scope} already has an atomic launch claim`, 409);
      }
      // The owner filename is claim-specific. If another reclaimer already
      // removed this stale owner and installed a new claim directory, this
      // unlink can only address the old claimId and therefore returns ENOENT;
      // it cannot delete the new owner's differently named file.
      try { fs.unlinkSync(existing.ownerPath); }
      catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
        continue;
      }
      try { fs.rmdirSync(lockPath); }
      catch (removeError) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(removeError.code)) throw removeError;
      }
    }
  }
}

function acquireRunLaunchClaim(runId, waitMs = 0) {
  return acquireLaunchClaim(runLockPath(runId), `run ${runId}`, waitMs, { runId });
}

function acquireGlobalWorkerClaim(waitMs = 0) {
  return acquireLaunchClaim(globalWorkerLockPath(), 'global worker admission', waitMs,
    { lease: 'GLOBAL_SINGLE_WORKER' });
}

/**
 * PRIVATE, and deliberately not exported. This is the deletion mechanism and
 * nothing more: it frees the bytes only when the on-disk owner record is still
 * exactly the generation the caller presents, and it decides no authority of
 * its own. Matching a record is shape agreement, not authentication of who is
 * entitled to release — every caller must have established that first. The
 * holder comparison against the on-disk record stays here, so a reconstructed
 * claim that relabels itself (a forged 'LAUNCHER' copy of a review hold) still
 * fails against the bytes the acquirer actually wrote.
 */
function deleteExactGenerationClaim(claim) {
  if (!claim || typeof claim.ownerPath !== 'string') return false;
  let current = null;
  try { current = JSON.parse(fs.readFileSync(claim.ownerPath, 'utf8')); } catch {}
  if (current && current.claimId === claim.claimId && current.pid === claim.pid &&
      current.holder === claim.holder && current.runId === claim.runId &&
      current.attemptId === claim.attemptId &&
      sameProcessIdentity(current.processIdentity, claim.processIdentity)) {
    try { fs.unlinkSync(claim.ownerPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    try { fs.rmdirSync(claim.lockPath); }
    catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
    return true;
  }
  return false;
}

/**
 * The generic release is the builder path and stays exactly as it was for a
 * launcher or worker lease. It refuses a review hold unconditionally: matching
 * the owner record is enough to free a launcher, but a review hold also
 * requires the lifecycle proof only releaseGlobalReviewHold can check.
 *
 * There is no override parameter, by design. The previous boolean escape hatch
 * was a public argument, so anything holding a review hold object could free it
 * without ever reaching the dedicated validation. Extra arguments are now
 * ignored — this function reads its first argument and nothing else — and the
 * one path that may delete a review hold is releaseGlobalReviewHold, which
 * calls the private helper above only after its own checks pass.
 */
function releaseRunLaunchClaim(claim) {
  if (claim && claim.holder === REVIEW_HOLD_HOLDER) return false;
  return deleteExactGenerationClaim(claim);
}

function transferGlobalWorkerClaim(claim, runId, attemptId, workerPid, workerIdentity) {
  if (!claim || claim.lockPath !== globalWorkerLockPath() || claim.holder !== 'LAUNCHER' ||
      claim.pid !== process.pid || !sameProcessIdentity(claim.processIdentity, processIdentity(process.pid))) {
    throw new AegisControlError('GLOBAL_LEASE_TRANSFER_REFUSED',
      'the launcher no longer owns the global worker admission claim', 409);
  }
  if (!RUN_ID_RE.test(runId) || typeof attemptId !== 'string' ||
      !Number.isInteger(workerPid) || workerPid <= 1 ||
      !sameProcessIdentity(workerIdentity, processIdentity(workerPid))) {
    throw new AegisControlError('WORKER_IDENTITY_UNAVAILABLE',
      'the detached worker process lifetime could not be proven before lease transfer', 409);
  }
  let current;
  try { current = JSON.parse(fs.readFileSync(claim.ownerPath, 'utf8')); }
  catch {
    throw new AegisControlError('GLOBAL_LEASE_TRANSFER_REFUSED',
      'the global worker admission owner record disappeared before transfer', 409);
  }
  if (current.claimId !== claim.claimId || current.pid !== claim.pid ||
      current.holder !== 'LAUNCHER' || current.runId !== claim.runId ||
      current.attemptId !== claim.attemptId ||
      !sameProcessIdentity(current.processIdentity, claim.processIdentity)) {
    throw new AegisControlError('GLOBAL_LEASE_TRANSFER_REFUSED',
      'the global worker admission owner changed before transfer', 409);
  }
  const transferredClaimId = crypto.randomUUID();
  const transferredOwnerPath = path.join(claim.lockPath, `${transferredClaimId}.json`);
  const transferred = Object.freeze({
    claimId: transferredClaimId, scope: current.scope, lease: current.lease,
    holder: 'WORKER_LEASE', transferFrom: current.claimId,
    runId, attemptId, pid: workerPid, processGroupId: workerPid,
    processIdentity: workerIdentity, claimedAt: current.claimedAt, transferredAt: nowIso(),
    lockPath: claim.lockPath, ownerPath: transferredOwnerPath,
  });
  const persisted = { ...transferred };
  delete persisted.lockPath;
  delete persisted.ownerPath;
  const temporary = `${claim.lockPath}.transfer-${process.pid}-${transferredClaimId}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(persisted), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, transferredOwnerPath);
    try { fs.unlinkSync(claim.ownerPath); }
    catch { /* the two-owner reader resolves only this exact transferFrom pair */ }
  } finally { try { fs.unlinkSync(temporary); } catch {} }
  return transferred;
}

function verifyGlobalWorkerLease(runId, attemptId, workerPid) {
  const existing = readRunLaunchClaim(globalWorkerLockPath());
  const claim = existing && !existing.blocked ? existing.claim : null;
  const observed = processIdentity(workerPid);
  if (!observed) {
    throw new RunError('PROCESS-IDENTITY-PROBE-UNAVAILABLE',
      `worker attempt ${attemptId} could not obtain exact process-lifetime identity`);
  }
  if (!claim || claim.holder !== 'WORKER_LEASE' || claim.runId !== runId ||
      claim.attemptId !== attemptId || claim.pid !== workerPid ||
      claim.processGroupId !== workerPid ||
      !sameProcessIdentity(claim.processIdentity, observed) ||
      !workerLeaseRunBindingMatches(claim)) {
    throw new RunError('GLOBAL-WORKER-LEASE-MISMATCH',
      `worker attempt ${attemptId} does not own the exact transferred global lease`);
  }
  return Object.freeze({ ...claim, lockPath: globalWorkerLockPath(), ownerPath: existing.ownerPath });
}

function releaseGlobalWorkerLease(lease) {
  if (!lease || lease.holder !== 'WORKER_LEASE') return false;
  const existing = readRunLaunchClaim(globalWorkerLockPath());
  const current = existing && !existing.blocked ? existing.claim : null;
  if (!current || current.claimId !== lease.claimId ||
      current.transferFrom !== lease.transferFrom || current.runId !== lease.runId ||
      current.attemptId !== lease.attemptId || current.pid !== lease.pid ||
      current.processGroupId !== lease.processGroupId ||
      !sameProcessIdentity(current.processIdentity, lease.processIdentity)) return false;
  // The worker itself is necessarily still a member while executing this
  // synchronous finally block. Any other member means a builder child or
  // descendant is still alive, so the lease must survive the wrapper exit and
  // be reclaimed only after the OS proves the whole group absent.
  const members = processGroupMembers(lease.processGroupId);
  if (!Array.isArray(members) || members.some((pid) => pid !== lease.pid)) return false;
  return releaseRunLaunchClaim(lease);
}

// ── single-review admission ─────────────────────────────────────────────────
// Two primitives only: take the one canonical global admission slot as a
// review, and give it back with proof. They launch nothing, queue nothing,
// choose no reviewer and write no receipt; a future canonical orchestration
// calls them around a review it already had authority to run.

/**
 * Take the canonical global admission slot for a review of exactly one run.
 * Refused while any builder launcher, worker lease or other review hold owns
 * it, which is the whole point: one slot, three holder kinds, no overlap.
 */
function acquireGlobalReviewHold(runId, waitMs = 0) {
  if (!RUN_ID_RE.test(runId || '')) {
    throw new AegisControlError('REVIEW_HOLD_RUN_INVALID',
      'a review hold must name exactly one canonical run', 400);
  }
  // The claimId minted inside publication IS the generation of this hold, and
  // attemptId distinguishes two holds the same process takes for the same run.
  return acquireLaunchClaim(globalWorkerLockPath(), `review of run ${runId}`, waitMs,
    { lease: 'GLOBAL_SINGLE_WORKER', holder: REVIEW_HOLD_HOLDER, runId,
      attemptId: crypto.randomUUID() });
}

/**
 * The ONLY evidence that can free a review hold: the processLifecycle object
 * requestCanonicalReview returned to this invocation (review-adapters.cjs).
 * That contract reports reviewer AND billing-preflight process activity
 * cumulatively — the most uncertain activity wins — so a single affirmative
 * stamp here covers every process group that invocation could have started.
 *
 * Only two states permit release:
 *   NOT_LAUNCHED       nothing was ever spawned, from the one provenance that
 *                      can honestly say so (before any launch).
 *   LAUNCHED_DRAINED   that invocation positively proved drainage.
 * LAUNCHED_UNDRAINED and UNKNOWN retain the hold, and so does any stamp whose
 * typed fields disagree with its own state, whose provenance is unknown or
 * incoherent with the state, or which carries fields the contract never emits.
 *
 * What is NOT evidence, and is never inspected here: an exit code, the review
 * outcome or verdict, a written record, a historical receipt, caller death,
 * and anything shaped by a browser request. This function reads five fixed
 * typed fields of one object and nothing else.
 */
const REVIEW_RELEASE_PROOF_FIELDS = Object.freeze(
  ['state', 'launched', 'drainageProven', 'provenance', 'detail']);
const REVIEW_RELEASE_PROOF_PROVENANCE = Object.freeze({
  NOT_LAUNCHED: Object.freeze(['callable-entry-before-launch']),
  LAUNCHED_DRAINED: Object.freeze([
    'runtool-watchdog-drainage-evidence',
    'runtool-bounded-reaper-drainage',
    'grok-billing-preflight-drainage-evidence',
  ]),
});

function reviewLifecycleProofPermitsRelease(proof) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return false;
  const keys = Object.keys(proof);
  if (keys.length !== REVIEW_RELEASE_PROOF_FIELDS.length ||
      REVIEW_RELEASE_PROOF_FIELDS.some((field) => !keys.includes(field))) return false;
  // The state must name an OWN recognized entry. A plain property read here
  // reaches Object.prototype, so a proof stating 'constructor' or 'toString'
  // resolved to a function and threw on .includes — a malformed proof turning
  // a retained hold into an exception in the caller. A refusal is the only
  // honest answer to a proof this function does not recognize, and the held
  // bytes must survive it.
  if (typeof proof.state !== 'string' ||
      !Object.prototype.hasOwnProperty.call(REVIEW_RELEASE_PROOF_PROVENANCE, proof.state)) {
    return false;
  }
  const allowed = REVIEW_RELEASE_PROOF_PROVENANCE[proof.state];
  if (!Array.isArray(allowed) || !allowed.includes(proof.provenance)) return false;
  if (typeof proof.detail !== 'string' || !proof.detail) return false;
  return proof.state === 'NOT_LAUNCHED'
    ? proof.launched === false && proof.drainageProven === null
    : proof.launched === true && proof.drainageProven === true;
}

/**
 * Release a review hold. Every one of these must hold, or the bytes stay:
 *   · the caller presents a review hold on the canonical global claim;
 *   · the caller is the same LIVE process lifetime that took it — a reused PID
 *     is a different process and releases nothing;
 *   · the on-disk owner is still exactly this generation and attempt;
 *   · this invocation's reviewer lifecycle evidence is affirmative.
 * Refusal is reported, never thrown, so an uncertain caller cannot turn a
 * retained hold into a control-flow accident.
 */
function releaseGlobalReviewHold(hold, reviewProcessLifecycle) {
  const refuse = (reason) => Object.freeze({ released: false, reason });
  if (!hold || hold.holder !== REVIEW_HOLD_HOLDER ||
      hold.lockPath !== globalWorkerLockPath() || typeof hold.ownerPath !== 'string') {
    return refuse('NOT_A_REVIEW_HOLD');
  }
  if (hold.pid !== process.pid ||
      !sameProcessIdentity(hold.processIdentity, processIdentity(process.pid))) {
    return refuse('CALLER_NOT_LIVE_OWNER');
  }
  if (!reviewLifecycleProofPermitsRelease(reviewProcessLifecycle)) {
    return refuse('REVIEW_LIFECYCLE_UNPROVEN');
  }
  const existing = readRunLaunchClaim(globalWorkerLockPath());
  const current = existing && !existing.blocked ? existing.claim : null;
  if (!current || current.holder !== REVIEW_HOLD_HOLDER ||
      current.claimId !== hold.claimId || current.runId !== hold.runId ||
      current.attemptId !== hold.attemptId || current.pid !== hold.pid ||
      !sameProcessIdentity(current.processIdentity, hold.processIdentity)) {
    return refuse('STALE_GENERATION');
  }
  return deleteExactGenerationClaim(hold)
    ? Object.freeze({ released: true, reason: 'RELEASED' })
    : refuse('STALE_GENERATION');
}

function assertGlobalWorkerAvailable(runId) {
  let active = listRuns().find((candidate) => candidate && candidate.runId !== runId &&
    candidate.state === 'BUILDING');
  if (active && active.build && active.build.mode === 'async') {
    const observed = Number.isInteger(active.build.workerPid)
      ? processIdentity(active.build.workerPid) : null;
    const existence = Number.isInteger(active.build.workerPid)
      ? processExistence(active.build.workerPid) : 'absent';
    if (existence === 'absent' || (observed &&
        !sameProcessIdentity(active.build.processIdentity, observed))) {
      reconcileWorkerRun(active.runId);
      active = listRuns().find((candidate) => candidate && candidate.runId !== runId &&
        candidate.state === 'BUILDING');
    }
  }
  if (active) {
    throw new AegisControlError('GLOBAL_WORKER_ACTIVE',
      `run ${active.runId} already owns the single governed worker slot`, 409);
  }
}

function loadOwnedWorkerAttempt(runId, attemptId, workerPid) {
  const run = loadRun(runId);
  if (!run.build || run.build.attemptId !== attemptId ||
      (workerPid !== undefined && run.build.workerPid !== workerPid) || run.state !== 'BUILDING') {
    throw new RunError('STALE-WORKER-ATTEMPT', `worker attempt ${attemptId} no longer owns run ${runId}`);
  }
  return run;
}

function buildRevision(build) {
  return Number.isInteger(build && build.revision) && build.revision >= 0 ? build.revision : 0;
}

function patchOwnedWorkerAttempt(run, attemptId, expectedRevision, patch) {
  if (!run.build || run.build.attemptId !== attemptId ||
      buildRevision(run.build) !== expectedRevision || run.state !== 'BUILDING') {
    throw new RunError('STALE-WORKER-ATTEMPT',
      `worker attempt ${attemptId} no longer owns run ${run.runId} at revision ${expectedRevision}`);
  }
  run.build = { ...run.build, ...patch, revision: expectedRevision + 1 };
  return run;
}

function updateWorkerAttempt(runId, attemptId, workerPid, patch) {
  const claim = acquireRunLaunchClaim(runId, 3000);
  try {
    const run = loadOwnedWorkerAttempt(runId, attemptId, workerPid);
    patchOwnedWorkerAttempt(run, attemptId, buildRevision(run.build), patch);
    return saveRun(run);
  } finally { releaseRunLaunchClaim(claim); }
}

function transitionWorkerAttempt(runId, attemptId, workerPid, to, notes, patch = {}) {
  const claim = acquireRunLaunchClaim(runId, 3000);
  try {
    const run = loadOwnedWorkerAttempt(runId, attemptId, workerPid);
    patchOwnedWorkerAttempt(run, attemptId, buildRevision(run.build), patch);
    return transition(run, to, notes);
  } finally { releaseRunLaunchClaim(claim); }
}

function unsafeRecoveryPatch(build, reason, observedAt = nowIso()) {
  return {
    workerState: reason === 'TERMINATION_UNVERIFIED' ? 'TERMINATION_UNVERIFIED' : 'ORPHANED',
    endedAt: observedAt,
    recovery: {
      reason,
      observedAt,
      terminationVerified: false,
      retrySafe: false,
      abandonmentAllowed: true,
      attemptId: build.attemptId,
    },
  };
}

/**
 * Reconcile one detached worker without ever treating a recorded PID as
 * signalling authority. The same per-run claim used by launch, heartbeat,
 * cancellation and finalization serializes the observation and transition.
 * A missing/mismatched process lifetime proves only that the recorded worker
 * no longer owns the run; it does not prove that any reused PID is safe to
 * signal or that a descendant stopped. Recovery therefore fails closed:
 * BUILD_FAILED, retrySafe=false, with ABANDONED left as the safe operator path.
 */
function reconcileWorkerRun(runId, options = {}) {
  const observedAt = typeof options.observedAt === 'string' ? options.observedAt : nowIso();
  const launchGraceMs = Number.isInteger(options.launchGraceMs) && options.launchGraceMs >= 0
    ? options.launchGraceMs : WORKER_LAUNCH_GRACE_MS;
  const claim = acquireRunLaunchClaim(runId, 0);
  try {
    const run = loadRun(runId);
    if (run.state !== 'BUILDING' || !run.build || run.build.mode !== 'async') {
      return Object.freeze({ runId, action: 'NOOP', state: run.state });
    }
    const build = run.build;
    if (build.workerState === 'TERMINATION_UNVERIFIED') {
      patchOwnedWorkerAttempt(run, build.attemptId, buildRevision(build),
        unsafeRecoveryPatch(build, 'TERMINATION_UNVERIFIED', observedAt));
      transition(run, 'BUILD_FAILED', 'worker termination could not be verified; retry is blocked');
      return Object.freeze({ runId, action: 'RECOVERED_UNSAFE', state: 'BUILD_FAILED', reason: 'TERMINATION_UNVERIFIED' });
    }

    if (!Number.isInteger(build.workerPid) || build.workerPid <= 1) {
      const startedMs = Date.parse(build.startedAt || '');
      if (build.workerState === 'LAUNCH_CLAIMED' && Number.isFinite(startedMs) &&
          Date.parse(observedAt) - startedMs < launchGraceMs) {
        return Object.freeze({ runId, action: 'LAUNCH_GRACE', state: run.state });
      }
      patchOwnedWorkerAttempt(run, build.attemptId, buildRevision(build),
        unsafeRecoveryPatch(build, 'ORPHANED', observedAt));
      transition(run, 'BUILD_FAILED', 'detached worker launch ownership was lost; retry is blocked');
      return Object.freeze({ runId, action: 'RECOVERED_UNSAFE', state: 'BUILD_FAILED', reason: 'ORPHANED' });
    }

    const observed = processIdentity(build.workerPid);
    if (observed) {
      if (sameProcessIdentity(build.processIdentity, observed)) {
        return Object.freeze({ runId, action: 'ACTIVE', state: run.state });
      }
      // A complete, positively different immutable identity proves PID reuse.
      // Do not signal the unrelated process; close only the stale run record.
      patchOwnedWorkerAttempt(run, build.attemptId, buildRevision(build),
        unsafeRecoveryPatch(build, 'ORPHANED', observedAt));
      transition(run, 'BUILD_FAILED', 'detached worker PID was reused after its process lifetime ended');
      return Object.freeze({ runId, action: 'RECOVERED_UNSAFE', state: 'BUILD_FAILED', reason: 'PID_REUSED' });
    }

    // An unavailable identity observation is not evidence of death. Consult a
    // separate no-signal existence probe: only positive absence may close the
    // attempt. A present or unknown PID preserves BUILDING so transient ps,
    // procfs, permission, and inspection failures cannot fabricate ORPHANED.
    const existence = processExistence(build.workerPid);
    if (existence !== 'absent') {
      return Object.freeze({ runId, action: 'IDENTITY_UNVERIFIED', state: run.state,
        reason: existence === 'present' ? 'IDENTITY_INSPECTION_UNAVAILABLE' : 'PROCESS_EXISTENCE_UNKNOWN' });
    }

    patchOwnedWorkerAttempt(run, build.attemptId, buildRevision(build),
      unsafeRecoveryPatch(build, 'ORPHANED', observedAt));
    transition(run, 'BUILD_FAILED', 'detached worker process lifetime ended without finalization; retry is blocked');
    return Object.freeze({ runId, action: 'RECOVERED_UNSAFE', state: 'BUILD_FAILED', reason: 'ORPHANED' });
  } finally { releaseRunLaunchClaim(claim); }
}

function reconcileBuildingRuns(options = {}) {
  const results = [];
  for (const run of listRuns()) {
    if (!run.build || run.build.mode !== 'async') continue;
    // A detached worker records its own BUILT transition, so a run that
    // already finished is never handed to reconcileWorkerRun. Report it as the
    // observation it is: no claim is taken, nothing is patched, and no
    // transition is attempted. Callers learn a worker slot finished here or
    // not at all.
    if (run.state === 'BUILT') {
      results.push(Object.freeze({ runId: run.runId, action: 'NOOP', state: 'BUILT' }));
      continue;
    }
    if (run.state !== 'BUILDING') continue;
    try { results.push(reconcileWorkerRun(run.runId, options)); }
    catch (error) {
      if (error instanceof AegisControlError && error.code === 'LAUNCH_IN_PROGRESS') {
        results.push(Object.freeze({ runId: run.runId, action: 'BUSY', state: run.state }));
      } else throw error;
    }
  }
  return Object.freeze(results);
}

/**
 * Every transition is recorded in the CANONICAL ledger. The run file is a
 * convenience view; the ledger is the evidence. operationId makes a retried
 * transition a no-op rather than a duplicate event.
 */
function recordTransition(run, from, to, notes) {
  const stamp = nowIso();
  // Correction cycles legally repeat transitions such as CORRECTING ->
  // BUILDING. The first occurrence retains the historical operation id; each
  // later occurrence is distinct evidence. If a process crashes after the
  // ledger append but before saveRun(), the unchanged occurrence count
  // recreates the same operation id and recovers that exact entry.
  const occurrence = (run.transitions || []).filter((t) => t.from === from && t.to === to).length + 1;
  const transitionBase = `${run.runId}:${from}->${to}`;
  const operationId = occurrence === 1 ? transitionBase : `${transitionBase}:occurrence:${occurrence}`;
  const entry = {
    entryId: `LED-RUN-${stamp.replace(/[^0-9]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
    ts: stamp,
    agentId: 'claude-code',
    gate: 'aegis-run',
    status: STATES[to] && STATES[to].failure ? 'FAILED' : 'PASS',
    plane: 'CONTROL',
    operationId,
    correlationId: run.runId,
    attempt: occurrence,
    result: notes || `${from} -> ${to}`,
    notes: `run ${run.runId}: ${from} -> ${to}${notes ? ` (${notes})` : ''}`,
  };
  const f = path.join(require('os').tmpdir(), `aegis-run-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(f, JSON.stringify(entry));
  try {
    const args = [LEDGER_WRITER, '--append', f];
    if (process.env.AEGIS_LEDGER_FILE) args.push('--ledger', canonicalLedgerFile());
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0 && !/NO-OP/.test(r.stdout || '')) {
      throw new RunError('LEDGER-REFUSED',
        `the canonical ledger refused this transition: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}. ` +
        'A transition that cannot be recorded did not happen.');
    }
  } finally { try { fs.unlinkSync(f); } catch {} }
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(canonicalLedgerFile(), 'utf8')); }
  catch {
    throw new RunError('LEDGER-REFUSED', 'the canonical ledger could not be re-read after transition append');
  }
  const persisted = Array.isArray(ledger) ? ledger.filter((candidate) =>
    candidate && candidate.correlationId === run.runId && candidate.operationId === operationId) : [];
  if (persisted.length !== 1 || typeof persisted[0].entryId !== 'string') {
    throw new RunError('LEDGER-REFUSED',
      `the canonical ledger did not retain exactly one entry for ${operationId}`);
  }
  return persisted[0];
}

function canonicalLedgerFile() {
  return process.env.AEGIS_LEDGER_FILE
    ? path.resolve(process.env.AEGIS_LEDGER_FILE)
    : path.join(HERE, 'ledger.json');
}

function appendCanonicalLedgerEntry(entry) {
  const f = path.join(os.tmpdir(), `aegis-evidence-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(f, JSON.stringify(entry), { mode: 0o600 });
  try {
    const args = [LEDGER_WRITER, '--append', f];
    if (process.env.AEGIS_LEDGER_FILE) args.push('--ledger', canonicalLedgerFile());
    const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    if (result.status !== 0 && !/NO-OP/.test(result.stdout || '')) {
      throw new RunError('CHECK-RECEIPT-LEDGER-REFUSED',
        `the canonical ledger refused the deterministic receipt: ${(result.stderr || result.stdout || '').trim().slice(0, 240)}`);
    }
  } finally { try { fs.unlinkSync(f); } catch {} }
}

function canonicalReceiptCommands(receipt) {
  const commands = receipt.results.filter(({ exit }) => Number.isInteger(exit))
    .map(({ cmd, exit }) => ({ cmd, exit }));
  if (receipt.hostContainment && receipt.hostContainment.result &&
      Number.isInteger(receipt.hostContainment.result.exit)) {
    commands.push({ cmd: receipt.hostContainment.command, exit: receipt.hostContainment.result.exit });
  }
  return commands;
}

function canonicalReceiptTests(receipt) {
  const tests = receipt.results.map(({ cmd }) => cmd);
  if (receipt.hostContainment) tests.push(receipt.hostContainment.command);
  return tests;
}

/**
 * Persist the complete deterministic receipt outside mutable run state. The
 * canonical ledger is already the append-only evidence authority for this
 * runtime; this is a new entry type in that authority, not a second store.
 */
function persistCanonicalCheckReceipt(run, receipt) {
  if (!run || !validateCompleteCheckReceipt(receipt, { runId: run.runId })) {
    throw new RunError('CHECK-RECEIPT-INVALID', 'refusing to persist a malformed deterministic check receipt');
  }
  const entryId = `LED-CHECK-${receipt.receiptSha256.slice(0, 32)}`;
  appendCanonicalLedgerEntry({
    entryId,
    ts: receipt.completedAt,
    // The retained receipt proves the packet by path + digest. Do not put that
    // path in the schema's packetId field and mislabel it as a parsed ID.
    packetId: null,
    agentId: 'claude-code',
    gate: 'aegis-check-receipt',
    status: receipt.outcome === 'PASS' ? 'PASS' : 'FAILED',
    plane: 'CONTROL',
    operationId: `${run.runId}:check-receipt:${receipt.receiptSha256}`,
    correlationId: run.runId,
    attempt: 1,
    operation: `deterministic checks for ${receipt.subject.subjectSha256}`,
    result: receipt.outcome,
    changed: [...receipt.subject.subjectPaths],
    commandsRun: canonicalReceiptCommands(receipt),
    testsRun: canonicalReceiptTests(receipt),
    screenshots: [],
    commitSha: null,
    bundleHash: receipt.receiptSha256,
    evidencePaths: [
      `packet:${receipt.packet.path}#${receipt.packet.sha256}`,
      `subject:${receipt.subject.subjectSha256}`,
      ...(receipt.hostContainment
        ? [`host-containment:${receipt.hostContainment.receiptSha256}`] : []),
    ],
    driftChecks: [],
    notes: CHECK_RECEIPT_NOTE_PREFIX + Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64url'),
  });
  return Object.freeze({ entryId, receiptSha256: receipt.receiptSha256 });
}

function persistCanonicalPreHostCheckReceipt(run, receipt) {
  if (!run || !validatePreHostCheckReceipt(receipt, { runId: run.runId })) {
    throw new RunError('CHECK-RECEIPT-INVALID',
      'refusing to persist a malformed pre-host deterministic check receipt');
  }
  const entryId = `LED-CHECK-${receipt.receiptSha256.slice(0, 32)}`;
  const commands = receipt.results.map(({ cmd, exit }) => ({ cmd, exit }));
  const tests = receipt.results.map(({ cmd }) => cmd);
  appendCanonicalLedgerEntry({
    entryId,
    ts: receipt.completedAt,
    packetId: null,
    agentId: 'claude-code',
    gate: 'aegis-pre-host-check-receipt',
    status: 'PASS',
    plane: 'CONTROL',
    operationId: `${run.runId}:pre-host-check-receipt:${receipt.receiptSha256}`,
    correlationId: run.runId,
    attempt: 1,
    operation: `pre-host deterministic checks for ${receipt.subject.subjectSha256}`,
    result: receipt.outcome,
    changed: [...receipt.subject.subjectPaths],
    commandsRun: commands,
    testsRun: tests,
    screenshots: [],
    commitSha: null,
    bundleHash: receipt.receiptSha256,
    evidencePaths: [
      `packet:${receipt.packet.path}#${receipt.packet.sha256}`,
      `subject:${receipt.subject.subjectSha256}`,
      `snapshot:${receipt.snapshot.captureSha256}`,
      `host-containment:pending:${receipt.hostContainment.commands[0]}`,
    ],
    driftChecks: [],
    notes: PRE_HOST_CHECK_RECEIPT_NOTE_PREFIX +
      Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64url'),
  });
  return Object.freeze({ entryId, receiptSha256: receipt.receiptSha256 });
}

// ── Marc's research decisions ───────────────────────────────────────────────
// The ONLY way a research recommendation becomes anything other than a
// recommendation. Nothing an agent proposes becomes build canon by being
// proposed; it becomes a bounded PROPOSAL when — and only when — Marc records
// an approval here, and even then no builder starts.
//
// Three properties are load-bearing:
//
//   * Approve, park and reject are three DISTINCT recorded decisions. None of
//     them is the absence of another, and none overwrites an earlier one: the
//     ledger is append-only and the projector reads the FIRST recorded
//     decision, so a second write cannot quietly reverse the first.
//   * The decision word is chosen by the CALLER'S ROUTE, not by a request
//     body. This function accepts a fixed keyword from a closed set; hosting
//     supplies it from its own route table, so a browser cannot post a verdict.
//   * The subject is re-read from the canonical projection. A caller names one
//     recommendation id and nothing else — never a report, a path, a packet, a
//     hash, an objective or a proposal — so every field bound into the receipt
//     comes from validated canonical evidence rather than from the request.
const RESEARCH_DECISION_NOTE_PREFIX = 'aegis-marc-decision-v1:';
const RESEARCH_DECISIONS = Object.freeze({
  APPROVE: 'APPROVED', PARK: 'PARKED', REJECT: 'REJECTED',
});

function researchDecisionStamp(iso) {
  return iso.replace(/[^0-9]/g, '').slice(0, 14);
}

function recordResearchDecision(recommendationId, decision) {
  const AegisState = require('./aegis-state.cjs');
  if (typeof recommendationId !== 'string' ||
      !AegisState.RECOMMENDATION_ID_RE.test(recommendationId)) {
    throw new AegisControlError('INVALID_RECOMMENDATION_ID',
      'a decision names exactly one canonical recommendation id', 400);
  }
  if (!Object.prototype.hasOwnProperty.call(RESEARCH_DECISIONS, decision)) {
    throw new AegisControlError('INVALID_DECISION',
      'the decision word comes from the server route, never from a request body', 400);
  }
  const recorded = RESEARCH_DECISIONS[decision];

  let projection;
  try {
    projection = AegisState.projectResearchReport(Date.now(), {
      ledgerFile: canonicalLedgerFile(),
    });
  }
  catch {
    throw new AegisControlError('RESEARCH_REPORT_UNAVAILABLE',
      'the canonical research-report projection could not be read, so no decision was recorded', 503);
  }
  if (!projection || projection.state !== 'OK' || !projection.report) {
    throw new AegisControlError('RESEARCH_REPORT_UNAVAILABLE',
      (projection && projection.reason) ||
      'no current validated research report is available, so there is nothing to decide', 409);
  }
  const item = projection.recommendations
    .find((row) => row.recommendationId === recommendationId);
  if (!item) {
    throw new AegisControlError('RECOMMENDATION_NOT_FOUND',
      'the current validated research report contains no such recommendation', 404);
  }
  if (!item.decidable) {
    throw new AegisControlError('DECISION_ALREADY_RECORDED',
      item.notDecidableReason || 'this recommendation is not open for a decision', 409);
  }

  const decidedAt = nowIso();
  const stamp = researchDecisionStamp(decidedAt);
  const decisionId = `DEC-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
  // An approval creates a PROPOSAL and nothing else. It is not a packet file,
  // it grants no file authority, it declares no allowlist, and builderStarted
  // is a recorded false rather than an omission — scoping a packet and running
  // a governed build stay separate, deliberate acts after this point.
  const proposal = recorded === 'APPROVED' ? Object.freeze({
    proposalId: `PROP-${stamp}-${crypto.randomBytes(4).toString('hex')}`,
    state: 'PROPOSED',
    proposedPacketId: `PKT-PROPOSED-${stamp}-${recommendationId}`,
    objective: item.title,
    sourceRecommendationId: recommendationId,
    sourceReportId: projection.report.reportId,
    builderStarted: false,
  }) : null;

  const payload = {
    version: 'aegis-marc-decision-v1',
    decisionId,
    decidedAt,
    // The AUTHORITY that decided. It is deliberately not the agentId below:
    // agentId names the process that appended the entry, which is never the
    // thing that may approve.
    decidedBy: 'MARC',
    decision: recorded,
    reportId: projection.report.reportId,
    notionPageId: projection.report.notionPageId,
    reportSha256: projection.report.reportSha256,
    recommendationId,
    recommendationSha256: item.recommendationSha256,
    proposal,
  };
  const bundleHash = sha256(JSON.stringify(payload));
  const entryId = `LED-DECISION-${bundleHash.slice(0, 32)}`;
  try {
    appendCanonicalLedgerEntry({
      entryId,
      ts: decidedAt,
      packetId: null,
      agentId: 'claude-code',
      gate: 'aegis-marc-decision',
      status: 'PASS',
      plane: 'CONTROL',
      operationId: `${projection.report.reportId}:marc-decision:${recommendationId}`,
      correlationId: projection.report.reportId,
      attempt: 1,
      operation: `Marc recorded ${recorded} for ${recommendationId}`,
      result: recorded,
      changed: [],
      commandsRun: [],
      testsRun: [],
      screenshots: [],
      commitSha: null,
      bundleHash,
      evidencePaths: [
        `research-report:${projection.source}#${projection.report.reportSha256}`,
        `notion-page:${projection.report.notionPageId}`,
        `recommendation:${recommendationId}#${item.recommendationSha256}`,
        ...(proposal ? [`packet-proposal:${proposal.proposalId}`] : []),
      ],
      driftChecks: [],
      notes: RESEARCH_DECISION_NOTE_PREFIX +
        Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    });
  } catch (error) {
    throw new AegisControlError('DECISION_LEDGER_REFUSED',
      `the canonical ledger refused this decision, so nothing was decided: ${String(error.message || error).slice(0, 240)}`,
      503);
  }
  // A decision that cannot be read back did not happen.
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(canonicalLedgerFile(), 'utf8')); }
  catch {
    throw new AegisControlError('DECISION_LEDGER_UNREADABLE',
      'the canonical ledger could not be re-read after this decision was appended', 503);
  }
  const persisted = Array.isArray(ledger)
    ? ledger.filter((entry) => entry && entry.entryId === entryId) : [];
  if (persisted.length !== 1) {
    throw new AegisControlError('DECISION_NOT_RECORDED',
      'the canonical ledger did not retain exactly one entry for this decision', 503);
  }

  return Object.freeze({
    decision: recorded,
    lifecycleState: AegisState.RESEARCH_DECISION_STATES[recorded],
    decisionId,
    decidedAt,
    decidedBy: 'MARC',
    recommendationId,
    reportId: projection.report.reportId,
    entryId,
    proposal,
    builderStarted: false,
    nextAction: recorded === 'APPROVED'
      ? 'A bounded packet proposal is recorded against this recommendation. No builder was started; scoping the packet and starting a governed build remain separate decisions.'
      : 'Recorded. Nothing is being built from this recommendation.',
  });
}

function loadCanonicalCheckReceipt(checks, expected = {}) {
  const ref = checks && checks.receiptRef;
  if (!ref || !/^LED-CHECK-[0-9a-f]{32}$/.test(ref.entryId || '') ||
      !/^[0-9a-f]{64}$/.test(ref.receiptSha256 || '')) return null;
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(canonicalLedgerFile(), 'utf8')); }
  catch { return null; }
  if (!Array.isArray(ledger)) return null;
  const matches = ledger.filter((entry) => entry && entry.entryId === ref.entryId);
  if (matches.length !== 1) return null;
  const entry = matches[0];
  if (entry.gate !== 'aegis-check-receipt' || entry.plane !== 'CONTROL' ||
      entry.correlationId !== (expected.runId || entry.correlationId) ||
      entry.bundleHash !== ref.receiptSha256 || typeof entry.notes !== 'string' ||
      !entry.notes.startsWith(CHECK_RECEIPT_NOTE_PREFIX)) return null;
  let receipt;
  try {
    receipt = JSON.parse(Buffer.from(entry.notes.slice(CHECK_RECEIPT_NOTE_PREFIX.length), 'base64url').toString('utf8'));
  } catch { return null; }
  if (!validateCompleteCheckReceipt(receipt, expected) || receipt.receiptSha256 !== ref.receiptSha256 ||
      entry.status !== (receipt.outcome === 'PASS' ? 'PASS' : 'FAILED') ||
      JSON.stringify(entry.changed || []) !== JSON.stringify(receipt.subject.subjectPaths) ||
      JSON.stringify((entry.commandsRun || []).map(({ cmd, exit }) => ({ cmd, exit }))) !==
        JSON.stringify(canonicalReceiptCommands(receipt)) ||
      JSON.stringify(entry.testsRun || []) !== JSON.stringify(canonicalReceiptTests(receipt))) return null;
  return receipt;
}

function loadCanonicalPreHostCheckReceipt(checks, expected = {}) {
  const ref = checks && checks.preHostReceiptRef;
  if (!ref || !/^LED-CHECK-[0-9a-f]{32}$/.test(ref.entryId || '') ||
      !/^[0-9a-f]{64}$/.test(ref.receiptSha256 || '')) return null;
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(canonicalLedgerFile(), 'utf8')); }
  catch { return null; }
  if (!Array.isArray(ledger)) return null;
  const matches = ledger.filter((entry) => entry && entry.entryId === ref.entryId);
  if (matches.length !== 1) return null;
  const entry = matches[0];
  if (entry.gate !== 'aegis-pre-host-check-receipt' || entry.plane !== 'CONTROL' ||
      entry.correlationId !== (expected.runId || entry.correlationId) || entry.status !== 'PASS' ||
      entry.bundleHash !== ref.receiptSha256 || typeof entry.notes !== 'string' ||
      !entry.notes.startsWith(PRE_HOST_CHECK_RECEIPT_NOTE_PREFIX)) return null;
  let receipt;
  try {
    receipt = JSON.parse(Buffer.from(
      entry.notes.slice(PRE_HOST_CHECK_RECEIPT_NOTE_PREFIX.length), 'base64url').toString('utf8'));
  } catch { return null; }
  const commands = receipt.results.map(({ cmd, exit }) => ({ cmd, exit }));
  const tests = receipt.results.map(({ cmd }) => cmd);
  if (!validatePreHostCheckReceipt(receipt, expected) ||
      receipt.receiptSha256 !== ref.receiptSha256 ||
      JSON.stringify(entry.changed || []) !== JSON.stringify(receipt.subject.subjectPaths) ||
      JSON.stringify(entry.commandsRun || []) !== JSON.stringify(commands) ||
      JSON.stringify(entry.testsRun || []) !== JSON.stringify(tests)) return null;
  return receipt;
}

const BUILDING_ABANDON_CAPABILITY = Symbol('authenticated BUILDING abandonment');

function hasCurrentAttemptTerminationEvidence(run) {
  const build = run && run.build;
  const cancellation = build && build.cancellation;
  const evidence = build && build.terminationEvidence;
  return Boolean(build && build.mode === 'async' && typeof build.attemptId === 'string' &&
    cancellation && cancellation.status === 'TERMINATED' &&
    cancellation.attemptId === build.attemptId && typeof cancellation.cancellationId === 'string' &&
    evidence && evidence.controlAuthenticated === true && evidence.terminated === true &&
    evidence.childCloseObserved === true && evidence.processGroupDrained === true &&
    evidence.attemptId === build.attemptId &&
    evidence.cancellationId === cancellation.cancellationId &&
    sameProcessIdentity(build.childProcessIdentity, evidence.childIdentity));
}

const TIMEOUT_CONTINUATION_CAPABILITY = Symbol('executed same-attempt timeout continuation');
const TIMEOUT_CONTINUATION_TYPE = 'AEGIS_TIMEOUT_CONTINUATION_V1';

/**
 * The capability symbol alone would still let a caller inside this module take
 * the edge without having run anything. Both continuation edges additionally
 * require the typed continuation record the executor writes: STARTED (with the
 * digest of the command it is about to run) to enter, and EXECUTED with a
 * literal exit 0 to complete. An operator-authored record cannot exist here,
 * because nothing outside continueTimedOutBuild() ever writes this shape.
 */
function hasExecutedTimeoutContinuationEvidence(run, to) {
  const c = run && run.build && run.build.continuation;
  if (!c || c.type !== TIMEOUT_CONTINUATION_TYPE) return false;
  if (!CONTINUATION_SESSION_ID_RE.test(c.sessionId || '')) return false;
  if (!/^[0-9a-f]{64}$/.test(c.commandSha256 || '')) return false;
  if (run.build.exit !== 124) return false;
  if (to === 'BUILD_CONTINUED') return c.status === 'STARTED' && c.exit === null;
  // Completing the slot as BUILT needs more than an exit code: the supervisor
  // must have proven the dedicated process group drained, and the worktree's
  // changed paths must have been verified inside the packet's allowed surface.
  return c.status === 'EXECUTED' && c.exit === 0 && typeof c.endedAt === 'string' &&
    Boolean(c.boundary) && c.boundary.state === 'PASSED' && c.boundary.drained === true &&
    Boolean(c.containment) && c.containment.ok === true;
}

/** The only way a run changes state. */
function transition(run, to, notes, authority) {
  const from = run.state;
  const def = STATES[from];
  if (!def) throw new RunError('UNKNOWN-STATE', `run is in unknown state ${from}`);
  if (!STATES[to]) throw new RunError('UNKNOWN-STATE', `${to} is not a state`);
  if (!def.next.includes(to)) {
    throw new RunError('ILLEGAL-TRANSITION',
      `${from} -> ${to} is not a legal transition (allowed: ${def.next.join(', ') || 'none'}). ` +
      'A run cannot reach a later state by skipping an earlier one, and there is no --force.');
  }
  if (from === 'BUILDING' && to === 'ABANDONED' &&
      (authority !== BUILDING_ABANDON_CAPABILITY || !hasCurrentAttemptTerminationEvidence(run))) {
    throw new RunError('TERMINATION-EVIDENCE-REQUIRED',
      'BUILDING -> ABANDONED requires authenticated child-close and process-group-drain evidence ' +
      'bound to the current worker attempt and cancellation operation.');
  }
  // Entering and completing the timeout-continuation recovery slot is not a
  // generic edge. Without the capability, BUILD_FAILED still has exactly its
  // pre-existing honest exits and BUILD_CONTINUED can only fail or abandon.
  if (((from === 'BUILD_FAILED' && to === 'BUILD_CONTINUED') ||
       (from === 'BUILD_CONTINUED' && to === 'BUILT')) &&
      (authority !== TIMEOUT_CONTINUATION_CAPABILITY ||
       !hasExecutedTimeoutContinuationEvidence(run, to))) {
    throw new RunError('CONTINUATION-AUTHORITY-REQUIRED',
      `${from} -> ${to} is reachable only through the same-attempt timeout continuation authority, ` +
      'which must have executed the bounded same-session resume itself. There is no operator assertion.');
  }
  const entry = recordTransition(run, from, to, notes);
  run.state = to;
  run.transitions = run.transitions || [];
  run.transitions.push({ from, to, ts: entry.ts, ledgerEntryId: entry.entryId,
    operationId: entry.operationId, notes: notes || null });
  run.updatedAt = entry.ts;
  return saveRun(run);
}

// ── step 1–2: objective intake ──────────────────────────────────────────────
// The single intake authority. Both the CLI (--new) and the dashboard/API
// layer must create runs through this function, so there is exactly one place
// that decides what a valid objective is and exactly one place that writes
// the CREATED -> INTAKE_RECORDED transition. It never accepts a packet from
// `input` — normalizeObjective already refuses unknown keys — only from
// `options.packet`, which must resolve inside builder-control/packets.
//
// options.automaticChecks is the same kind of server-owned option: it records
// an eligibility marker only, and nothing here executes a check. The POSTed
// body can never set it, because `automaticChecks` is not an
// OBJECTIVE_ALLOWED_KEYS field and normalizeObjective refuses unknown keys
// before this point. Only the exact value `true` marks a run eligible; every
// other caller, including the CLI, records false.
function createRunFromObjective(input, options = {}) {
  const normalized = normalizeObjective(input);
  const automaticChecks = options.automaticChecks === true;
  const packet = resolvePacketOption(options.packet);
  let immutablePacketCoordinate = null;
  if (packet) {
    try {
      const validated = validatedPacketCoordinate(packet);
      immutablePacketCoordinate = Object.freeze({
        path: validated.path,
        sha256: validated.sha256,
        packetId: validated.packetId,
      });
    }
    catch (error) {
      throw new AegisControlError('INVALID_PACKET',
        `objective intake requires a canonically valid stable packet: ${error.message}`, 400);
    }
  }

  const stamp = nowIso();
  const runId = `RUN-${stamp.slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
  const run = {
    runId,
    createdAt: stamp,
    updatedAt: stamp,
    state: 'CREATED',
    objective: normalized.objective,
    project: normalized.project,
    constraints: normalized.constraints,
    acceptanceCriteria: normalized.acceptance,
    dataClass: normalized.dataClass,
    packet,
    packetCoordinate: immutablePacketCoordinate,
    automaticChecks,
    baseCommit: git(['rev-parse', 'HEAD']).stdout.trim() || null,
    worktree: null,
    build: null,
    checks: null,
    checkpoint: null,
    corrections: 0,
    transitions: [],
  };
  saveRun(run);
  transition(run, 'INTAKE_RECORDED', 'objective and acceptance recorded');

  // Step 2 also wants RISK. Risk is classified by the existing classifier — a
  // second risk opinion here would be exactly the duplicate authority the
  // contract forbids. An unknown or refused classification stays UNVERIFIED;
  // it is never assumed low.
  const cls = spawnSync('node', [ENGOS, '--classify', '--json'], { cwd: ROOT, encoding: 'utf8' });
  if (cls.status === 0) {
    try {
      const j = JSON.parse(cls.stdout);
      run.risk = { lane: j.lane, highRisk: j.highRisk, requiredReviewers: j.requiredReviewers, source: 'engineering-os.cjs --classify' };
    } catch { run.risk = { state: 'UNVERIFIED', reason: 'classifier output was unparseable' }; }
  } else {
    run.risk = { state: 'UNVERIFIED', reason: 'the classifier refused; risk is unknown rather than assumed low' };
  }
  saveRun(run);

  return Object.freeze({
    runId: run.runId,
    state: run.state,
    risk: run.risk,
    nextAction: `--worktree ${run.runId}`,
  });
}

function cmdNew(args) {
  if (!args.objective || !String(args.objective).trim()) {
    throw new RunError('NO-OBJECTIVE', '--objective is required: a run with no stated objective cannot be reviewed against anything');
  }
  let result;
  try {
    result = createRunFromObjective(
      {
        objective: String(args.objective),
        acceptance: args.acceptance ? [String(args.acceptance)] : [],
      },
      { packet: args.packet },
    );
  } catch (e) {
    // The CLI's own error surface is RunError (message on stderr, exit 3).
    // AegisControlError is the dashboard/API surface; translate rather than
    // let it escape uncaught, so --new keeps behaving exactly as before.
    if (e instanceof AegisControlError) throw new RunError(e.code, e.message);
    throw e;
  }
  const run = loadRun(result.runId);

  if (args.json) { console.log(JSON.stringify(run, null, 2)); return EXIT_PASS; }
  console.log(`AEGIS RUN ${run.runId}`);
  console.log(`  objective : ${run.objective}`);
  console.log(`  state     : ${run.state}`);
  console.log(`  base      : ${run.baseCommit ? run.baseCommit.slice(0, 12) : 'UNAVAILABLE'}`);
  console.log(`  risk      : ${run.risk.lane || run.risk.state}`);
  console.log('');
  console.log('next: --worktree ' + run.runId);
  return EXIT_PASS;
}

// ── step 3–4: routing + isolated worktree ───────────────────────────────────
// The single authority for turning an INTAKE_RECORDED run into a WORKTREE_READY
// one. Both the CLI (--worktree) and the dashboard/API layer must call this,
// so there is exactly one place that routes, one place that decides whether a
// refused route blocks worktree creation, and one place that creates the
// worktree. It never executes a build or model — that remains --build, a
// separate governed step.
function prepareRunClaimed(run) {
  if (run.state !== 'INTAKE_RECORDED') {
    throw new AegisControlError('ILLEGAL_TRANSITION',
      `prepareRun requires state INTAKE_RECORDED, run is ${run.state}`, 409);
  }

  // Step 3: route from VERIFIED capabilities via the existing router. Only a
  // positive `ok` result may proceed; anything else — refused, unverified,
  // thrown — fails closed with no worktree created.
  let route;
  try {
    const R = require('./tool-router.cjs');
    const r = R.routeRole('orchestrator', { dataClass: run.dataClass });
    route = r && r.ok === true
      ? { model: r.model, execution: r.execution, source: 'tool-router.cjs routeRole' }
      : { state: 'REFUSED', code: (r && r.code) || 'ROUTE_REFUSED', reason: (r && r.reason) || 'router did not return ok' };
  } catch (e) {
    route = { state: 'REFUSED', code: 'ROUTE_REFUSED', reason: e.message };
  }
  run.route = route;
  saveRun(run);

  if (route.state === 'REFUSED') {
    throw new AegisControlError('ROUTE_REFUSED',
      `routing refused: ${route.reason}. No worktree was created.`, 409);
  }
  // Step 4: create the isolated worktree, argument-array git only. Never
  // reuse an existing path or the primary tree. ROUTED is published only
  // after worktree creation succeeds, so an operational git failure leaves
  // the run at INTAKE_RECORDED and a later Start can safely retry it.
  const wt = path.join(ROOT, '..', `aegis-wt-${run.runId}`);
  if (fs.existsSync(wt)) {
    throw new AegisControlError('WORKTREE_EXISTS',
      `${wt} already exists; refusing to reuse a dirty tree`, 409);
  }
  const branch = `aegis/${run.runId}`;
  const r = git(['worktree', 'add', '-b', branch, wt, run.baseCommit || 'HEAD']);
  if (r.status !== 0) {
    throw new AegisControlError('WORKTREE_FAILED',
      `git worktree add failed: ${(r.stderr || '').trim().slice(0, 200)}`, 409);
  }
  transition(run, 'ROUTED', `orchestrator route: ${route.model}`);
  run.worktree = { path: wt, branch, createdAt: nowIso(), baseCommit: run.baseCommit };
  saveRun(run);
  transition(run, 'WORKTREE_READY', `isolated worktree at ${path.basename(wt)}`);

  const fresh = loadRun(run.runId);
  return Object.freeze({
    runId: fresh.runId,
    state: fresh.state,
    route: fresh.route,
    worktree: { path: fresh.worktree.path, branch: fresh.worktree.branch },
    nextAction: `--build ${fresh.runId} --cmd "<command>"`,
  });
}

function prepareRun(runId) {
  const claim = acquireRunLaunchClaim(runId, 1000);
  try {
    return prepareRunClaimed(loadRun(runId));
  } finally { releaseRunLaunchClaim(claim); }
}

function cmdWorktree(args) {
  let result;
  try {
    result = prepareRun(args.runId);
  } catch (e) {
    // The CLI's own error surface is RunError (message on stderr, exit 3).
    // AegisControlError is the dashboard/API surface; translate rather than
    // let it escape uncaught, so --worktree keeps behaving exactly as before.
    if (e instanceof AegisControlError) throw new RunError(e.code, e.message);
    throw e;
  }
  console.log(`worktree ready: ${result.worktree.path}\n  branch: ${result.worktree.branch}\nnext: ${result.nextAction}`);
  return EXIT_PASS;
}

// ── run controls (dashboard) ────────────────────────────────────────────────
// pauseRun/cancelRun/retryRun are the ONLY control-surface mutators besides
// createRunFromObjective/prepareRun. Each loads the run through the same
// loadRun a malformed or missing id already refuses, translates that refusal
// into AegisControlError so an HTTP layer never has to parse a message, and
// otherwise moves state ONLY through transition() — the canonical ledger, not
// a second store.
function loadRunForControl(runId) {
  try {
    return loadRun(runId);
  } catch (e) {
    if (e instanceof RunError) {
      if (e.code === 'BAD-RUN-ID') throw new AegisControlError('INVALID_RUN_ID', e.message, 400);
      if (e.code === 'NO-SUCH-RUN') throw new AegisControlError('RUN_NOT_FOUND', e.message, 404);
    }
    throw e;
  }
}

/**
 * Pause never invents a PAUSED state. Async worker execution can be active,
 * but there is still no canonical lifecycle slot or tested resume contract to
 * suspend it into. Every state, including BUILDING, therefore fails closed
 * with no mutation.
 */
function pauseRun(runId) {
  const run = loadRunForControl(runId);
  if (run.state === 'BUILDING') {
    throw new AegisControlError('CONTROL_UNAVAILABLE',
      `run ${run.runId} is BUILDING; asynchronous worker control is active, but the canonical state machine has no PAUSED state. ` +
      'Pause is refused until suspend/resume evidence and lifecycle semantics are defined.', 409);
  }
  throw new AegisControlError('CONTROL_UNAVAILABLE',
    `run ${run.runId} is ${run.state}; pause is unavailable because no PAUSED state exists in the canonical state machine.`, 409);
}

/**
 * A recorded correction cycle is a usable build allowance. Retry records
 * cycles 1..MAX_CORRECTIONS before launch, so both synchronous and detached
 * builders must accept that inclusive range and refuse only malformed state or
 * a value beyond the advertised cap.
 */
function correctionBuildProblem(run) {
  if (!run || run.state !== 'CORRECTING') return null;
  if (!Number.isInteger(run.corrections) || run.corrections < 1) {
    return `run ${run.runId} has CORRECTING state without a valid recorded correction cycle`;
  }
  if (run.corrections > MAX_CORRECTIONS) {
    return `${run.corrections} correction cycles already used (max ${MAX_CORRECTIONS}). Escalate rather than build again.`;
  }
  return null;
}

/**
 * A numeric PID is never worker ownership evidence.  A prior async attempt
 * blocks a new launch only when its recorded immutable process identity still
 * matches the currently observed process lifetime.  A positively different
 * identity proves PID reuse and is safe to ignore; an existing/unknown PID
 * whose identity cannot be inspected fails closed rather than guessing.
 */
function priorWorkerLaunchProblem(build) {
  if (!build || !Number.isInteger(build.workerPid) || build.workerPid <= 1) return null;
  const observed = processIdentity(build.workerPid);
  if (observed) {
    return sameProcessIdentity(build.processIdentity, observed)
      ? { code: 'WORKER_ALREADY_ACTIVE', reason: 'MATCHING_PROCESS_IDENTITY' }
      : null;
  }
  const existence = processExistence(build.workerPid);
  if (existence === 'absent') return null;
  return { code: 'WORKER_IDENTITY_UNVERIFIED', reason: existence === 'present'
    ? 'IDENTITY_INSPECTION_UNAVAILABLE' : 'PROCESS_EXISTENCE_UNKNOWN' };
}

function assertPriorWorkerLaunchSafe(run) {
  const problem = priorWorkerLaunchProblem(run && run.build);
  if (!problem) return;
  if (problem.code === 'WORKER_ALREADY_ACTIVE') {
    throw new AegisControlError(problem.code,
      `run ${run.runId} already has the identity-bound active worker ${run.build.workerPid}`, 409);
  }
  throw new AegisControlError(problem.code,
    `run ${run.runId} cannot prove whether recorded worker ${run.build.workerPid} is the same process lifetime (${problem.reason}); refusing an overlapping launch.`, 409);
}

function terminateFailedWorkerLaunch(launch, identity, waitMs = 3500) {
  if (!launch || !Number.isInteger(launch.workerPid) || launch.workerPid <= 1) return true;
  const deadline = Date.now() + waitMs;
  if (identity && launch.processGroupId === launch.workerPid) {
    const observed = processIdentity(launch.workerPid);
    if (sameProcessIdentity(identity, observed)) {
      try { process.kill(-launch.processGroupId, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') return false; }
    }
  }
  while (Date.now() < deadline) {
    const observed = processIdentity(launch.workerPid);
    const ownerGone = Boolean(observed && identity && !sameProcessIdentity(identity, observed)) ||
      (!observed && processExistence(launch.workerPid) === 'absent');
    if (ownerGone && processGroupExistence(launch.processGroupId) === 'absent') return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return false;
}

/**
 * Claim-aware worker launch. The caller must already own the per-run claim;
 * keeping this operation non-reentrant lets retry serialize its correction
 * decision and attempt reservation without releasing ownership in between.
 */
function validateWorkerLaunch(run, launchSpec, options = {}) {
  if (run.state !== 'WORKTREE_READY' && run.state !== 'CORRECTING') {
    throw new AegisControlError('ILLEGAL_TRANSITION',
      `asynchronous build requires WORKTREE_READY or CORRECTING, run is ${run.state}`, 409);
  }
  if (!run.worktree || !fs.existsSync(run.worktree.path)) {
    throw new AegisControlError('NO_WORKTREE',
      'the run has no existing isolated worktree; refusing to launch a builder', 409);
  }
  const correctionProblem = correctionBuildProblem(run);
  if (correctionProblem) {
    throw new AegisControlError('CORRECTION_LIMIT', correctionProblem, 409);
  }
  assertPriorWorkerLaunchSafe(run);
  let normalized;
  try { normalized = require('./aegis-worker.cjs').normalizeLaunchSpec(launchSpec); }
  catch (e) { throw new AegisControlError(e.code || 'INVALID_LAUNCH_SPEC', e.message, 400); }
  let timeoutSec;
  try { timeoutSec = require('./aegis-worker.cjs').normalizeTimeoutSec(options.timeoutSec); }
  catch (e) { throw new AegisControlError(e.code || 'INVALID_LAUNCH_SPEC', e.message, 400); }
  const launchAuthority = options.launchWorker === undefined
    ? require('./aegis-worker.cjs').launchWorker : options.launchWorker;
  if (typeof launchAuthority !== 'function') {
    throw new AegisControlError('INVALID_LAUNCH_SPEC',
      'the trusted worker launch authority must be a function', 400);
  }
  return Object.freeze({ normalized, timeoutSec, launchAuthority });
}

function startValidatedWorkerClaimed(run, validated, globalClaim) {
  const { normalized, timeoutSec, launchAuthority } = validated;
  if (!globalClaim || globalClaim.lockPath !== globalWorkerLockPath()) {
    throw new AegisControlError('GLOBAL_LEASE_REQUIRED',
      'asynchronous worker launch requires the owned global admission claim', 409);
  }
  const attempt = ((run.build && run.build.attempt) || 0) + 1;
  const attemptId = crypto.randomUUID();
  run.build = {
    mode: 'async', attempt, attemptId, launchSpec: normalized,
    launchSha256: sha256(JSON.stringify(normalized)), workerPid: null,
    processGroupId: null, workerState: 'LAUNCH_CLAIMED', revision: 0,
    startedAt: nowIso(), heartbeatAt: null, exit: null, stdoutTail: '', stderrTail: '',
  };
  transition(run, 'BUILDING', `asynchronous builder attempt ${attempt} starting`);
  let launch;
  let workerIdentity = null;
  let transferredLease = null;
  try {
    launch = launchAuthority({
      runId: run.runId,
      attemptId,
      launchSpec: normalized,
      timeoutSec,
    });
    workerIdentity = processIdentity(launch.workerPid);
    if (!workerIdentity || launch.processGroupId !== launch.workerPid ||
        workerIdentity.processGroupId !== launch.processGroupId) {
      throw new AegisControlError('WORKER_IDENTITY_UNAVAILABLE',
        'the detached worker process lifetime could not be proven before lease transfer', 409);
    }
    transferredLease = transferGlobalWorkerClaim(globalClaim, run.runId, attemptId,
      launch.workerPid, workerIdentity);

    const building = loadRun(run.runId);
    if (!building.build || building.build.attemptId !== attemptId) {
      throw new AegisControlError('STALE_WORKER_ATTEMPT',
        'worker launch ownership changed before metadata was persisted', 409);
    }
    building.build = {
      ...building.build, launchSha256: launch.launchSha256,
      workerPid: launch.workerPid, processGroupId: launch.processGroupId,
      control: launch.control,
      processIdentity: workerIdentity,
      globalLease: {
        claimId: transferredLease.claimId, holder: 'WORKER_LEASE',
        transferFrom: transferredLease.transferFrom,
        runId: run.runId, attemptId, pid: launch.workerPid,
        processGroupId: launch.processGroupId, processIdentity: workerIdentity,
        transferredAt: transferredLease.transferredAt,
      },
      workerState: 'STARTING', startedAt: nowIso(), heartbeatAt: null,
      exit: null, stdoutTail: '', stderrTail: '',
      revision: buildRevision(building.build) + 1,
    };
    saveRun(building);
    return Object.freeze({
      runId: building.runId, state: building.state, action: 'start',
      workerPid: launch.workerPid, attempt, attemptId, nextAction: 'monitor',
    });
  } catch (e) {
    const terminationVerified = terminateFailedWorkerLaunch(launch, workerIdentity);
    const failed = loadOwnedWorkerAttempt(run.runId, attemptId);
    failed.build = { ...failed.build,
      ...(launch ? {
        workerPid: launch.workerPid, processGroupId: launch.processGroupId,
        processIdentity: workerIdentity,
      } : {}),
      ...(transferredLease ? {
        globalLease: {
          claimId: transferredLease.claimId, holder: 'WORKER_LEASE',
          transferFrom: transferredLease.transferFrom,
          runId: run.runId, attemptId, pid: launch.workerPid,
          processGroupId: launch.processGroupId, processIdentity: workerIdentity,
          transferredAt: transferredLease.transferredAt,
        },
      } : {}),
      endedAt: nowIso(), exit: 127,
      workerState: launch
        ? (terminationVerified ? 'LEASE_TRANSFER_FAILED' : 'TERMINATION_UNVERIFIED')
        : 'SPAWN_FAILED',
      stderrTail: String(e.message || e).slice(0, 1000),
      ...(!terminationVerified ? {
        recovery: {
          reason: 'TERMINATION_UNVERIFIED', observedAt: nowIso(), terminationVerified: false,
          retrySafe: false, abandonmentAllowed: true, attemptId,
        },
      } : {}),
    };
    saveRun(failed);
    transition(failed, 'BUILD_FAILED', launch
      ? 'asynchronous worker lease transfer or metadata publication failed'
      : 'asynchronous worker spawn failed');
    throw new AegisControlError(launch ? (e.code || 'GLOBAL_LEASE_TRANSFER_FAILED') : 'WORKER_SPAWN_FAILED',
      launch ? 'the asynchronous worker lease could not be transferred safely'
        : 'the asynchronous worker could not be launched', 409);
  }
}

function startWorkerClaimed(run, launchSpec, options = {}, globalClaim) {
  return startValidatedWorkerClaimed(run, validateWorkerLaunch(run, launchSpec, options), globalClaim);
}

/**
 * Launches the build as a detached, bounded worker and returns immediately.
 * The worker may execute only in the already-created isolated worktree. The
 * existing transition() remains the single lifecycle/ledger authority.
 */
function startWorker(runId, launchSpec, options = {}) {
  let globalClaim;
  let claim;
  try {
    globalClaim = acquireGlobalWorkerClaim(1000);
    claim = acquireRunLaunchClaim(runId, 1000);
  }
  catch (e) {
    if (globalClaim) releaseRunLaunchClaim(globalClaim);
    if (e instanceof RunError) {
      if (e.code === 'BAD-RUN-ID') throw new AegisControlError('INVALID_RUN_ID', e.message, 400);
      if (e.code === 'NO-SUCH-RUN') throw new AegisControlError('RUN_NOT_FOUND', e.message, 404);
    }
    throw e;
  }
  try {
    assertGlobalWorkerAvailable(runId);
    return startWorkerClaimed(loadRunForControl(runId), launchSpec, options, globalClaim);
  } finally {
    if (claim) releaseRunLaunchClaim(claim);
    if (globalClaim) releaseRunLaunchClaim(globalClaim);
  }
}

/**
 * Dashboard Start authority. Intake preparation, its fresh post-preparation
 * validation, attempt reservation, and worker launch are one claimed action.
 * The launch-spec factory is trusted server code and is invoked only after the
 * fresh WORKTREE_READY record has been loaded while the claim is still held.
 */
function startGovernedWorker(runId, launchSpecForRun, options = {}) {
  let globalClaim;
  let claim;
  try {
    globalClaim = acquireGlobalWorkerClaim(1000);
    claim = acquireRunLaunchClaim(runId, 1000);
  }
  catch (e) {
    if (globalClaim) releaseRunLaunchClaim(globalClaim);
    if (e instanceof RunError) {
      if (e.code === 'BAD-RUN-ID') throw new AegisControlError('INVALID_RUN_ID', e.message, 400);
      if (e.code === 'NO-SUCH-RUN') throw new AegisControlError('RUN_NOT_FOUND', e.message, 404);
    }
    throw e;
  }
  try {
    assertGlobalWorkerAvailable(runId);
    let run = loadRunForControl(runId);
    try {
      currentRunPacketCoordinate(run);
    } catch (error) {
      const code = run.packet && run.packetCoordinate ? 'PACKET_CHANGED' : 'INVALID_PACKET';
      throw new AegisControlError(code,
        `start requires the exact canonically valid packet recorded at intake before routing or worker launch: ${error.message}`, 409);
    }
    if (run.state === 'INTAKE_RECORDED') {
      prepareRunClaimed(run);
      run = loadRunForControl(runId);
    }
    if (run.state !== 'WORKTREE_READY') {
      throw new AegisControlError('ILLEGAL_TRANSITION',
        `start requires INTAKE_RECORDED or WORKTREE_READY, run is ${run.state}`, 409);
    }
    if (typeof launchSpecForRun !== 'function') {
      throw new AegisControlError('INVALID_LAUNCH_SPEC',
        'dashboard start requires a trusted server launch-spec factory', 400);
    }
    let validatedPacket;
    try { validatedPacket = currentRunPacketCoordinate(run); }
    catch (error) {
      throw new AegisControlError('PACKET_CHANGED',
        `start refused a packet change during worktree preparation: ${error.message}`, 409);
    }
    const launchSpec = launchSpecForRun(run, validatedPacket);
    try { currentRunPacketCoordinate(run); }
    catch (error) {
      throw new AegisControlError('PACKET_CHANGED',
        `start refused a packet change during launch composition: ${error.message}`, 409);
    }
    return startWorkerClaimed(run, launchSpec, options, globalClaim);
  } finally {
    if (claim) releaseRunLaunchClaim(claim);
    if (globalClaim) releaseRunLaunchClaim(globalClaim);
  }
}

function controlMac(secret, value) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
}

function validControlMac(secret, value, mac) {
  if (typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac)) return false;
  const expected = Buffer.from(controlMac(secret, value), 'hex');
  const observed = Buffer.from(mac, 'hex');
  return observed.length === expected.length && crypto.timingSafeEqual(observed, expected);
}

function privateAtomicJson(target, value) {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function inspectCancellationResponse(responsePath, control, build, cancellationId) {
  if (!fs.existsSync(responsePath)) return { status: 'MISSING' };
  let identity;
  let response;
  try {
    const observed = fs.lstatSync(responsePath);
    identity = { dev: Number(observed.dev), ino: Number(observed.ino) };
    if (observed.isSymbolicLink() || !observed.isFile() || (observed.mode & 0o777) !== 0o600) {
      throw new Error('unsafe response');
    }
    response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
  } catch {
    return { status: 'INVALID', identity };
  }
  if (!response || !response.body || !validControlMac(control.secret, response.body, response.mac) ||
      response.body.attemptId !== build.attemptId ||
      JSON.stringify(response.body.childIdentity) !== JSON.stringify(build.childProcessIdentity)) {
    return { status: 'INVALID', identity };
  }
  if (response.body.cancellationId !== cancellationId) {
    return { status: 'STALE_AUTHENTICATED', identity };
  }
  return { status: 'CURRENT_AUTHENTICATED', identity, body: response.body };
}

function removeObservedControlFile(filePath, identity) {
  if (!identity) return false;
  try {
    const current = fs.lstatSync(filePath);
    if (current.isSymbolicLink() || !current.isFile() ||
        Number(current.dev) !== identity.dev || Number(current.ino) !== identity.ino) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    return error && error.code === 'ENOENT';
  }
}

function requestWorkerCancellation(build, cancellationId, timeoutMs = 2750) {
  const control = build && build.control;
  if (!control || typeof control.dir !== 'string' || typeof control.secret !== 'string' ||
      sha256(control.secret) !== control.secretSha256) {
    return { terminated: false, reason: 'CONTROL_CAPABILITY_INVALID', observedAt: nowIso() };
  }
  let dirReal;
  try {
    dirReal = fs.realpathSync(control.dir);
    const dirStat = fs.statSync(control.dir);
    if (dirReal !== control.dir || fs.lstatSync(control.dir).isSymbolicLink() ||
        !dirStat.isDirectory() || (dirStat.mode & 0o777) !== 0o700 || !control.directoryIdentity ||
        Number(dirStat.dev) !== control.directoryIdentity.dev || Number(dirStat.ino) !== control.directoryIdentity.ino) {
      throw new Error('unsafe control directory');
    }
  } catch {
    return { terminated: false, reason: 'CONTROL_MAILBOX_REPLACED', observedAt: nowIso() };
  }
  const requestPath = path.join(dirReal, 'cancel-request.json');
  const responsePath = path.join(dirReal, 'cancel-response.json');
  const priorResponse = inspectCancellationResponse(responsePath, control, build, cancellationId);
  if (priorResponse.status === 'STALE_AUTHENTICATED') {
    if (!removeObservedControlFile(responsePath, priorResponse.identity)) {
      return { terminated: false, reason: 'CONTROL_RESPONSE_REPLACED', observedAt: nowIso() };
    }
  } else if (priorResponse.status !== 'MISSING') {
    removeObservedControlFile(responsePath, priorResponse.identity);
    return { terminated: false, reason: 'CONTROL_RESPONSE_AUTHENTICATION_FAILED', observedAt: nowIso() };
  }
  const body = {
    attemptId: build.attemptId, cancellationId, requestedAt: nowIso(),
    expiresAt: Date.now() + 1500, nonce: crypto.randomBytes(16).toString('hex'),
  };
  try { privateAtomicJson(requestPath, { body, mac: controlMac(control.secret, body) }); }
  catch { return { terminated: false, reason: 'CONTROL_REQUEST_WRITE_FAILED', observedAt: nowIso() }; }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = inspectCancellationResponse(responsePath, control, build, cancellationId);
    if (response.status === 'STALE_AUTHENTICATED') {
      if (!removeObservedControlFile(responsePath, response.identity)) {
        try { fs.unlinkSync(requestPath); } catch {}
        return { terminated: false, reason: 'CONTROL_RESPONSE_REPLACED', observedAt: nowIso() };
      }
      continue;
    }
    if (response.status === 'INVALID') {
      try { fs.unlinkSync(requestPath); } catch {}
      removeObservedControlFile(responsePath, response.identity);
      return { terminated: false, reason: 'CONTROL_RESPONSE_AUTHENTICATION_FAILED', observedAt: nowIso() };
    }
    if (response.status === 'CURRENT_AUTHENTICATED') {
      try { fs.unlinkSync(requestPath); } catch {}
      if (!removeObservedControlFile(responsePath, response.identity)) {
        return { terminated: false, reason: 'CONTROL_RESPONSE_REPLACED', observedAt: nowIso() };
      }
      return response.body;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  try { fs.unlinkSync(requestPath); } catch {}
  return { terminated: false, reason: 'CONTROL_RESPONSE_TIMEOUT', observedAt: nowIso() };
}

/**
 * One canonical predicate owns whether a BUILDING run retains the authenticated,
 * attempt-bound capability required by cancelRun. A PID alone is deliberately
 * insufficient: the worker must have published both its control mailbox and
 * verified child identity. Public display readiness is narrower and remains a
 * server projection so a timed-out first request can be retried without making
 * a non-RUNNING worker look safely cancellable in the dashboard.
 */
function workerCancellationCapability(run) {
  return !!(run && run.state === 'BUILDING' && run.build &&
    run.build.mode === 'async' &&
    Number.isInteger(run.build.workerPid) && run.build.workerPid > 0 &&
    run.build.control && run.build.childProcessIdentity);
}

/** Cancel BUILDING only through its per-attempt authenticated worker mailbox. */
function cancelRun(runId, testDependencies) {
  let dependencies = { requestCancellation: requestWorkerCancellation, beforeClaim: null };
  if (testDependencies !== undefined) {
    const keys = testDependencies && typeof testDependencies === 'object'
      ? Object.keys(testDependencies) : [];
    if (process.env.NODE_ENV !== 'test' || !testDependencies ||
        typeof testDependencies.requestCancellation !== 'function' ||
        keys.some((key) => !['requestCancellation', 'beforeClaim'].includes(key)) ||
        (testDependencies.beforeClaim !== undefined && typeof testDependencies.beforeClaim !== 'function')) {
      throw new AegisControlError('INVALID_TEST_SEAM',
        'cancellation dependencies may be injected only by deterministic tests', 400);
    }
    dependencies = { requestCancellation: testDependencies.requestCancellation,
      beforeClaim: testDependencies.beforeClaim || null };
  }

  // Preserve the existing not-found/invalid-id response before invoking the
  // deterministic interleaving seam. This observation is never used to choose
  // a cancellation path; only the fresh record loaded under the claim is.
  loadRunForControl(runId);
  if (dependencies.beforeClaim) dependencies.beforeClaim();

  let owned;
  let cancellationId;
  let claim = acquireRunLaunchClaim(runId, 3000);
  try {
    owned = loadRunForControl(runId);
    if (owned.state === 'BUILDING') {
      // Phase A owns only the run-file mutation. The claim is deliberately
      // released before signalling so a heartbeat or child-close finalizer can
      // acquire the same claim rather than deadlocking behind cancellation.
      cancellationId = crypto.randomUUID();
      if (!workerCancellationCapability(owned)) {
        throw new AegisControlError('CONTROL_UNAVAILABLE',
          `run ${owned.runId} has no authenticated worker cancellation capability.`, 409);
      }
      if (owned.build.cancellation && owned.build.cancellation.status === 'REQUESTED') {
        throw new AegisControlError('CANCELLATION_IN_PROGRESS',
          `run ${owned.runId} already has cancellation ${owned.build.cancellation.cancellationId} in progress.`, 409);
      }
      const requestedAt = nowIso();
      patchOwnedWorkerAttempt(owned, owned.build.attemptId, buildRevision(owned.build), {
        cancelRequestedAt: requestedAt,
        cancellation: { cancellationId, attemptId: owned.build.attemptId, requestedAt, status: 'REQUESTED' },
      });
      saveRun(owned);
    } else {
      const recovery = owned.build && owned.build.recovery;
      if (recovery && recovery.terminationVerified === false) {
        if (owned.state !== 'BUILD_FAILED' || recovery.abandonmentAllowed !== true ||
            recovery.retrySafe !== false) {
          throw new AegisControlError('TERMINATION_UNVERIFIED',
            `run ${owned.runId} cannot be administratively abandoned because its unsafe recovery does not permit that resolution.`, 409);
        }
        const resolvedAt = nowIso();
        owned.build = {
          ...owned.build,
          recovery: {
            ...recovery,
            terminationVerified: false,
            retrySafe: false,
            administrativeResolution: {
              type: 'ABANDONED_WITHOUT_SIGNAL',
              resolvedAt,
              signallingAttempted: false,
            },
          },
        };
        transition(owned, 'ABANDONED',
          'administratively abandoned without signalling; worker termination remains unverified');
      } else {
        const def = STATES[owned.state];
        if (!def || !def.next.includes('ABANDONED')) {
          throw new AegisControlError('CONTROL_UNAVAILABLE',
            `run ${owned.runId} is ${owned.state}; ABANDONED is not a legal next state (allowed: ${def ? def.next.join(', ') || 'none' : 'unknown'}).`, 409);
        }
        transition(owned, 'ABANDONED', 'cancelled via control surface');
      }
      const fresh = loadRun(owned.runId);
      return Object.freeze({
        runId: fresh.runId,
        state: fresh.state,
        action: 'cancel',
        nextAction: 'none',
      });
    }
  } finally { releaseRunLaunchClaim(claim); }

  const evidence = dependencies.requestCancellation(owned.build, cancellationId);

  // Phase B fresh-loads under the same claim. Heartbeats may have advanced
  // the revision while signalling was in progress, so the terminal CAS uses
  // the current revision but still requires the original attempt and cancel
  // operation. A worker finalizer that already left BUILDING wins honestly.
  claim = acquireRunLaunchClaim(runId, 3000);
  try {
    const stopped = loadRunForControl(runId);
    if (stopped.state !== 'BUILDING' || !stopped.build ||
        stopped.build.attemptId !== owned.build.attemptId ||
        !stopped.build.cancellation ||
        stopped.build.cancellation.cancellationId !== cancellationId) {
      throw new AegisControlError('CANCELLATION_SUPERSEDED',
        `run ${owned.runId} left the cancelled worker attempt before cancellation could record a terminal transition.`, 409);
    }
    const revision = buildRevision(stopped.build);
    if (!evidence.terminated) {
      patchOwnedWorkerAttempt(stopped, owned.build.attemptId, revision, {
        workerState: 'TERMINATION_UNVERIFIED',
        cancellation: { ...stopped.build.cancellation, status: 'TERMINATION_UNVERIFIED' },
        terminationEvidence: { ...evidence, attemptId: owned.build.attemptId },
        recovery: { reason: 'TERMINATION_UNVERIFIED', observedAt: nowIso(), terminationVerified: false,
          retrySafe: false, abandonmentAllowed: false, attemptId: owned.build.attemptId },
      });
      saveRun(stopped);
      throw new AegisControlError('TERMINATION_UNVERIFIED',
        `worker ${owned.build.workerPid} did not terminate within the bounded grace period; the run remains BUILDING.`, 409);
    }
    patchOwnedWorkerAttempt(stopped, owned.build.attemptId, revision, {
      workerState: 'TERMINATED', endedAt: evidence.observedAt,
      cancellation: { ...stopped.build.cancellation, status: 'TERMINATED' },
      terminationEvidence: { ...evidence, attemptId: owned.build.attemptId, cancellationId,
        controlAuthenticated: true },
    });
    transition(stopped, 'ABANDONED',
      `cancelled after worker ${owned.build.workerPid} termination was observed`,
      BUILDING_ABANDON_CAPABILITY);
    const fresh = loadRun(owned.runId);
    return Object.freeze({ runId: fresh.runId, state: fresh.state, action: 'cancel', nextAction: 'none' });
  } finally { releaseRunLaunchClaim(claim); }
}

/**
 * Retry only re-enters the existing bounded CORRECTING path, the same one
 * cmdAuto drives — it never runs the builder, model, or checks itself, so
 * actual re-execution stays a separate governed --build step. corrections is
 * incremented exactly once and only after the MAX_CORRECTIONS check passes,
 * matching the CLI's own correction bound.
 */
function canonicalRetryLaunchSpec(run, recordedLaunchSpec) {
  let packet;
  try { packet = currentRunPacketCoordinate(run); }
  catch (error) {
    throw new AegisControlError('PACKET_CHANGED',
      `retry requires the exact packet generation recorded at intake: ${error.message}`, 409);
  }

  let routed;
  try { routed = require('./tool-router.cjs').routeRole('orchestrator', { dataClass: run.dataClass }); }
  catch (error) {
    throw new AegisControlError('ROUTE_POLICY_UNAVAILABLE',
      `retry could not load the canonical model route: ${error.message}`, 409);
  }
  if (!routed || routed.ok !== true) {
    throw new AegisControlError((routed && routed.code) || 'ROUTE_REFUSED',
      `retry routing refused: ${(routed && routed.reason) || 'router did not return ok'}`, 409);
  }
  const recordedRoute = run.route;
  if (!recordedRoute || recordedRoute.source !== 'tool-router.cjs routeRole' ||
      recordedRoute.model !== routed.model || recordedRoute.execution !== routed.execution) {
    throw new AegisControlError('ROUTE_STALE',
      'retry refused because the recorded run route no longer matches the canonical orchestrator route', 409);
  }

  let policy;
  try { policy = JSON.parse(fs.readFileSync(MODEL_ROUTING_POLICY, 'utf8')); }
  catch {
    throw new AegisControlError('ROUTE_POLICY_UNAVAILABLE',
      'retry could not read the canonical model-routing policy', 409);
  }
  const declared = policy && policy.models && policy.models[routed.model];
  const workerRoute = declared && declared.workerRoute;
  if (!workerRoute || typeof workerRoute.provider !== 'string' || typeof workerRoute.model !== 'string') {
    throw new AegisControlError('ROUTE_UNSUPPORTED',
      'retry canonical route has no bounded worker declaration', 409);
  }
  let normalized;
  try { normalized = require('./aegis-worker.cjs').normalizeLaunchSpec(recordedLaunchSpec); }
  catch (error) {
    throw new AegisControlError(error.code || 'INVALID_LAUNCH_SPEC', error.message, 400);
  }
  if (normalized.provider !== workerRoute.provider || normalized.model !== workerRoute.model) {
    throw new AegisControlError('ROUTE_STALE',
      'retry refused because the recorded worker identity no longer matches the canonical route', 409);
  }
  return Object.freeze({ launchSpec: normalized, packet });
}

function retryRun(runId) {
  // Preserve the stable control-surface id/not-found errors before the claim
  // path creates or inspects a lock. All retry decisions are still made only
  // after a fresh load while the claim is held below.
  loadRunForControl(runId);
  let globalClaim;
  let claim;
  try {
    globalClaim = acquireGlobalWorkerClaim(3000);
    claim = acquireRunLaunchClaim(runId, 3000);
  }
  catch (e) {
    if (globalClaim) releaseRunLaunchClaim(globalClaim);
    if (e instanceof RunError) {
      if (e.code === 'BAD-RUN-ID') throw new AegisControlError('INVALID_RUN_ID', e.message, 400);
      if (e.code === 'NO-SUCH-RUN') throw new AegisControlError('RUN_NOT_FOUND', e.message, 404);
    }
    throw e;
  }
  try {
    const run = loadRunForControl(runId);
    assertGlobalWorkerAvailable(runId);
    if (run.state !== 'BUILD_FAILED' && run.state !== 'CHECKS_FAILED' && run.state !== 'REVIEW_FAILED') {
      throw new AegisControlError('INVALID_RETRY',
        `run ${run.runId} is ${run.state}; retry requires BUILD_FAILED, CHECKS_FAILED, or REVIEW_FAILED.`, 409);
    }
    if (run.state === 'BUILD_FAILED' && run.build && run.build.recovery &&
        run.build.recovery.retrySafe === false) {
      throw new AegisControlError('RECOVERY_UNSAFE',
        `run ${run.runId} cannot be retried because its prior worker termination is unverified. ` +
        'Abandon this run rather than risk overlapping builder processes.', 409);
    }
    if (run.corrections >= MAX_CORRECTIONS) {
      throw new AegisControlError('CORRECTION_LIMIT',
        `run ${run.runId} already used ${run.corrections} correction cycles (max ${MAX_CORRECTIONS}). Escalate rather than loop.`, 409);
    }
    const retryLaunchSpec = run.build && run.build.mode === 'async' && run.build.launchSpec
      ? run.build.launchSpec : null;
    if (run.build && run.build.mode === 'async') assertPriorWorkerLaunchSafe(run);
    let validatedLaunch = null;
    if (retryLaunchSpec) {
      const governedRetry = canonicalRetryLaunchSpec(run, retryLaunchSpec);
      // Validate every pre-BUILDING refusal while the prior failure state and
      // correction budget are still untouched. The synthetic state grants no
      // authority; it only exercises the same validator the launch consumes.
      validatedLaunch = validateWorkerLaunch({ ...run, state: 'CORRECTING', corrections: run.corrections + 1 }, governedRetry.launchSpec, {
        timeoutSec: 900,
      });
      try { currentRunPacketCoordinate(run); }
      catch (error) {
        throw new AegisControlError('PACKET_CHANGED',
          `retry refused a packet change during launch validation: ${error.message}`, 409);
      }
    }
    run.corrections += 1;
    transition(run, 'CORRECTING', `correction cycle ${run.corrections} of ${MAX_CORRECTIONS} via control surface`);
    if (validatedLaunch) return startValidatedWorkerClaimed(run, validatedLaunch, globalClaim);
    const fresh = loadRun(run.runId);
    return Object.freeze({
      runId: fresh.runId,
      state: fresh.state,
      action: 'retry',
      correction: fresh.corrections,
      nextAction: `--build ${fresh.runId} --cmd "<command>"`,
    });
  } finally {
    if (claim) releaseRunLaunchClaim(claim);
    if (globalClaim) releaseRunLaunchClaim(globalClaim);
  }
}

// ── step 5: builder execution ───────────────────────────────────────────────
function cmdBuildClaimed(run, args) {
  if (!args.cmd) throw new RunError('NO-COMMAND', '--cmd is required');
  if (run.state !== 'WORKTREE_READY' && run.state !== 'CORRECTING') {
    throw new RunError('ILLEGAL-TRANSITION',
      `build requires WORKTREE_READY or CORRECTING, run is ${run.state}. A build with no isolated worktree is a build in the wrong place.`);
  }
  if (!run.worktree || !fs.existsSync(run.worktree.path)) {
    throw new RunError('NO-WORKTREE', 'the run has no existing worktree; refusing to build in the primary tree');
  }
  const correctionProblem = correctionBuildProblem(run);
  if (correctionProblem) throw new RunError('CORRECTION-LIMIT', correctionProblem);
  transition(run, 'BUILDING', 'builder started');

  const started = nowIso();
  const r = spawnSync('bash', ['-lc', args.cmd], {
    cwd: run.worktree.path, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    timeout: Number(args.timeout || 900) * 1000,
  });
  const exit = r.status === null ? 124 : r.status;
  run.build = {
    cmd: args.cmd, startedAt: started, endedAt: nowIso(), exit,
    stdoutTail: (r.stdout || '').trim().split('\n').slice(-12).join('\n'),
    stderrTail: (r.stderr || '').trim().split('\n').slice(-12).join('\n'),
  };
  saveRun(run);

  if (exit !== 0) {
    transition(run, 'BUILD_FAILED', `builder exited ${exit}`);
    console.error(`BUILD FAILED (exit ${exit})\n${run.build.stderrTail || run.build.stdoutTail}`);
    return EXIT_REFUSED;
  }
  transition(run, 'BUILT', 'builder exited 0');
  console.log(`build ok\nnext: --checks ${run.runId}`);
  return EXIT_PASS;
}

function cmdBuild(args) {
  const globalClaim = acquireGlobalWorkerClaim(3000);
  let claim;
  try {
    claim = acquireRunLaunchClaim(args.runId, 3000);
    assertGlobalWorkerAvailable(args.runId);
    return cmdBuildClaimed(loadRun(args.runId), args);
  } finally {
    if (claim) releaseRunLaunchClaim(claim);
    releaseRunLaunchClaim(globalClaim);
  }
}

// ── same-attempt timeout continuation (step 5 recovery, not a correction) ────
// A synchronous builder killed at its wall clock leaves partial, real edits and
// an honest BUILD_FAILED. This authority is the ONLY way that attempt is ever
// reconciled, and it reconciles it by finishing the work itself: it validates
// the exact bounded same-session resume command, executes it in the same
// worktree, and records what happened. No caller may assert the outcome, no
// correction is consumed, and one attempt is all there is.

function continuationRefusal(code, message) {
  return new AegisControlError(code, message, 409);
}

function boundedContinuationTail(value) {
  const text = String(value || '').trim();
  const lines = text ? text.split('\n').slice(-CONTINUATION_TAIL_LINES).join('\n') : '';
  return lines.length > CONTINUATION_TAIL_BYTES ? lines.slice(-CONTINUATION_TAIL_BYTES) : lines;
}

/**
 * The whole trust boundary of the continuation command, in one place.
 * Executed without a shell, so the accepted grammar IS the argv: an explicit
 * API-key-stripping `env` prefix, an explicit bounded timeout, and
 * `claude --resume <the same session id>` with a closed flag allowlist.
 */
function parseTimeoutContinuationCommand(command, sessionId) {
  if (typeof command !== 'string' || !command.length || command.length > CONTINUATION_MAX_COMMAND_LEN) {
    throw continuationRefusal('INVALID_CONTINUATION_COMMAND',
      `the continuation command must be a string of 1..${CONTINUATION_MAX_COMMAND_LEN} characters`);
  }
  if (!CONTINUATION_COMMAND_CHARSET.test(command)) {
    throw continuationRefusal('INVALID_CONTINUATION_COMMAND',
      'the continuation command may contain only letters, digits, spaces, underscores and hyphens; ' +
      'no redirect, pipe, separator, substitution or quoting character is accepted');
  }
  const argv = command.split(' ');
  if (argv.some((token) => token.length === 0)) {
    throw continuationRefusal('INVALID_CONTINUATION_COMMAND',
      'the continuation command must be single-space separated with no empty token');
  }
  const prefix = argv.slice(0, CONTINUATION_ENV_PREFIX.length);
  if (prefix.length !== CONTINUATION_ENV_PREFIX.length ||
      prefix.some((token, i) => token !== CONTINUATION_ENV_PREFIX[i])) {
    throw continuationRefusal('INVALID_CONTINUATION_COMMAND',
      `the continuation command must begin with the exact subscription prefix "${CONTINUATION_ENV_PREFIX.join(' ')}"`);
  }
  const bounding = argv[CONTINUATION_ENV_PREFIX.length];
  if (!CONTINUATION_BOUNDING_COMMANDS.has(bounding)) {
    throw continuationRefusal('UNBOUNDED_CONTINUATION_COMMAND',
      `the continuation command must be bounded by ${[...CONTINUATION_BOUNDING_COMMANDS].join(' or ')}; an unbounded resume is refused`);
  }
  const seconds = argv[CONTINUATION_ENV_PREFIX.length + 1];
  const timeoutSec = /^[1-9][0-9]{0,3}$/.test(seconds || '') ? Number(seconds) : NaN;
  if (!Number.isInteger(timeoutSec) ||
      timeoutSec < CONTINUATION_MIN_TIMEOUT_SEC || timeoutSec > CONTINUATION_MAX_TIMEOUT_SEC) {
    throw continuationRefusal('UNBOUNDED_CONTINUATION_COMMAND',
      `the continuation bound must be a whole number of seconds in ${CONTINUATION_MIN_TIMEOUT_SEC}..${CONTINUATION_MAX_TIMEOUT_SEC}`);
  }
  if (argv[CONTINUATION_ENV_PREFIX.length + 2] !== 'claude' ||
      argv[CONTINUATION_ENV_PREFIX.length + 3] !== '--resume') {
    throw continuationRefusal('NOT_A_RESUME_CONTINUATION',
      'the continuation command must invoke exactly "claude --resume"; a fresh session is a new attempt, not a continuation');
  }
  const commandSessionId = argv[CONTINUATION_ENV_PREFIX.length + 4];
  if (commandSessionId !== sessionId) {
    throw continuationRefusal('CONTINUATION_SESSION_MISMATCH',
      'the resumed session id in the continuation command is not the declared session id');
  }
  const flags = argv.slice(CONTINUATION_ENV_PREFIX.length + 5);
  for (const flag of flags) {
    if (!CONTINUATION_OPTIONAL_FLAGS.has(flag)) {
      throw continuationRefusal('INVALID_CONTINUATION_COMMAND',
        `"${flag}" is not an accepted continuation flag (accepted: ${[...CONTINUATION_OPTIONAL_FLAGS].join(', ')}); ` +
        'a continuation may not re-select a provider, model or prompt');
    }
  }
  if (new Set(flags).size !== flags.length) {
    throw continuationRefusal('INVALID_CONTINUATION_COMMAND', 'continuation flags must not repeat');
  }
  return Object.freeze({
    argv: Object.freeze(argv),
    timeoutSec,
    // What actually executes: the resolved claude executable with exactly these
    // arguments. The declared env/timeout prefix is honored by the sanitized
    // env object and the supervisor's own bounds, not by wrapper binaries.
    resumeArgv: Object.freeze(argv.slice(CONTINUATION_ENV_PREFIX.length + 3)),
  });
}

/** Everything the run record must already say before anything is executed. */
function timeoutContinuationPrecondition(run) {
  if (run.state !== 'BUILD_FAILED') {
    return continuationRefusal('ILLEGAL_TRANSITION',
      `timeout continuation requires BUILD_FAILED, run is ${run.state}`);
  }
  const build = run.build;
  if (!build || typeof build !== 'object') {
    return continuationRefusal('NO_TIMED_OUT_BUILD',
      `run ${run.runId} records no build attempt to continue`);
  }
  if (build.exit !== CONTINUATION_TIMED_OUT_EXIT) {
    return continuationRefusal('NOT_A_TIMEOUT',
      `timeout continuation requires a prior builder exit of exactly ${CONTINUATION_TIMED_OUT_EXIT}; ` +
      `run ${run.runId} recorded ${JSON.stringify(build.exit)}. A build that failed on its merits is corrected, not continued.`);
  }
  if (typeof build.cmd !== 'string' || !build.cmd.length || build.mode === 'async' ||
      typeof build.attemptId === 'string' || build.workerPid !== undefined || build.control !== undefined) {
    return continuationRefusal('NOT_A_SYNCHRONOUS_BUILD',
      `run ${run.runId} did not record a synchronous builder attempt; detached worker attempts are reconciled by their own authority`);
  }
  if (build.continuation !== undefined) {
    return continuationRefusal('CONTINUATION_ALREADY_ATTEMPTED',
      `run ${run.runId} already has a recorded timeout continuation (${(build.continuation || {}).status}); ` +
      'one attempt gets one continuation. Escalate rather than resuming again.');
  }
  const recovery = build.recovery;
  if (recovery && recovery.retrySafe === false) {
    return continuationRefusal('TERMINATION_UNVERIFIED',
      `run ${run.runId} has an unsafe recovery record; continuing it would race an unverified process lifetime`);
  }
  if (!Number.isInteger(run.corrections) || run.corrections < 0 || run.corrections > MAX_CORRECTIONS) {
    return continuationRefusal('INVALID_CORRECTION_STATE',
      `run ${run.runId} does not record a valid correction count; refusing to continue an attempt whose allowance is unknown`);
  }
  if (!run.worktree || typeof run.worktree.path !== 'string' || !fs.existsSync(run.worktree.path)) {
    return continuationRefusal('NO_WORKTREE',
      `run ${run.runId} has no existing isolated worktree; a continuation runs in the same place the attempt did`);
  }
  return null;
}

/**
 * Pure input validation for a continuation declaration. It runs before any
 * claim is taken or any run state is read, so a request that could never
 * execute is refused identically in every environment — including inside a
 * containment snapshot — without depending on or disturbing launch state.
 */
function validatedContinuationDeclaration(continuation) {
  if (!continuation || typeof continuation !== 'object' || Array.isArray(continuation)) {
    throw new AegisControlError('INVALID_CONTINUATION',
      'timeout continuation requires an explicit { sessionId, command } declaration', 400);
  }
  const unknown = Object.keys(continuation).filter((k) => !['sessionId', 'command', 'prompt'].includes(k));
  if (unknown.length) {
    throw new AegisControlError('INVALID_CONTINUATION',
      `unknown continuation field(s): ${unknown.join(', ')}`, 400);
  }
  const { sessionId, command, prompt } = continuation;
  if (typeof sessionId !== 'string' || !CONTINUATION_SESSION_ID_RE.test(sessionId)) {
    throw new AegisControlError('INVALID_CONTINUATION_SESSION',
      'timeout continuation requires an explicit lowercase canonical UUID session id', 400);
  }
  if (prompt !== undefined &&
      (typeof prompt !== 'string' || Buffer.byteLength(prompt, 'utf8') > CONTINUATION_MAX_PROMPT_BYTES)) {
    throw new AegisControlError('INVALID_CONTINUATION',
      `the optional continuation prompt must be a string of at most ${CONTINUATION_MAX_PROMPT_BYTES} bytes`, 400);
  }
  const parsed = parseTimeoutContinuationCommand(command, sessionId);
  return Object.freeze({ sessionId, command, prompt, parsed });
}

/**
 * Subscription execution is enforced with a real env object: the exact
 * variables the declared `env -u` prefix names are removed from the child
 * environment, so a continuation cannot bill metered spend regardless of what
 * is exported around it. No API key is required or consulted.
 */
function continuationExecutionEnv() {
  const env = { ...process.env };
  for (let i = 1; i + 1 < CONTINUATION_ENV_PREFIX.length; i += 2) {
    if (CONTINUATION_ENV_PREFIX[i] === '-u') delete env[CONTINUATION_ENV_PREFIX[i + 1]];
  }
  return env;
}

/**
 * Resolve the one executable the grammar names. Resolution happens here, in
 * the executing authority, against absolute PATH entries only, and the real
 * path is recorded as evidence — the supervisor is never handed a bare name.
 */
function resolveContinuationExecutable(env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, 'claude');
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch { continue; }
  }
  throw continuationRefusal('CONTINUATION_EXECUTABLE_UNAVAILABLE',
    'no executable "claude" exists on an absolute PATH entry; a continuation never guesses its executor');
}

function continuationExecutionBounds(timeoutSec) {
  let timeoutMs = timeoutSec * 1000;
  let idleTimeoutMs = Math.min(timeoutMs, CONTINUATION_IDLE_TIMEOUT_MS);
  // Test-only tightening, honored solely when the runs dir is disposable under
  // the OS temp root — the same locality proof the contained check port uses.
  try {
    const runsReal = fs.realpathSync(RUNS_DIR);
    const tmpReal = fs.realpathSync(os.tmpdir());
    if (runsReal.startsWith(tmpReal + path.sep)) {
      const absolute = Number(process.env.AEGIS_TEST_CONTINUATION_TIMEOUT_MS);
      const idle = Number(process.env.AEGIS_TEST_CONTINUATION_IDLE_MS);
      if (Number.isInteger(absolute) && absolute > 0 && absolute < timeoutMs) timeoutMs = absolute;
      if (Number.isInteger(idle) && idle > 0 && idle < idleTimeoutMs) idleTimeoutMs = idle;
    }
  } catch { /* keep the declared bounds */ }
  return { timeoutMs, idleTimeoutMs };
}

/**
 * BUILT is a claim about the product, so the product must still be inside the
 * packet: every path the worktree now carries as changed must be allowed by
 * the exact packet generation bound at intake. An uninspectable worktree is a
 * failed verification, never a pass.
 */
function continuationChangeContainment(run, filesAllowed) {
  if (!Array.isArray(filesAllowed) || filesAllowed.length === 0 ||
      !filesAllowed.every((entry) => typeof entry === 'string' && entry.trim())) {
    return { ok: false, verified: false, outside: [],
      reason: 'the intake packet declares no usable filesAllowed surface' };
  }
  const observed = spawnSync('git', ['-C', run.worktree.path, 'status', '--porcelain=v1', '-z'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL',
  });
  if (observed.error || observed.status !== 0) {
    return { ok: false, verified: false, outside: [],
      reason: `worktree changes could not be inspected${observed.error ?
        `: ${observed.error.message}` : ` (git status exit ${observed.status})`}` };
  }
  const tokens = String(observed.stdout || '').split('\0').filter((token) => token.length > 0);
  const changed = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.length < 4) {
      return { ok: false, verified: false, outside: [], reason: 'unparseable git status entry' };
    }
    changed.push(token.slice(3));
    // A rename/copy record carries its origin path as the next NUL field, and
    // both ends must stay inside the allowed surface.
    if (token[0] === 'R' || token[0] === 'C') {
      i += 1;
      if (tokens[i]) changed.push(tokens[i]);
    }
  }
  const matchers = filesAllowed.map((entry) => {
    if (!entry.includes('*')) return (candidate) => candidate === entry;
    const pattern = entry.split('**').map((part) =>
      part.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
    const re = new RegExp(`^${pattern}$`);
    return (candidate) => re.test(candidate);
  });
  const outside = changed.filter((candidate) => !matchers.some((matches) => matches(candidate)));
  return {
    ok: outside.length === 0, verified: true, outside: outside.slice(0, 10),
    reason: outside.length === 0 ? null :
      `${outside.length} changed path(s) escape the packet filesAllowed surface`,
  };
}

/**
 * A continuation whose executing process died leaves the run honestly parked
 * in BUILD_CONTINUED with a STARTED record. Recovery is evidence-first: only a
 * proven-ended executor lifetime is reconciled, into BUILD_FAILED with the
 * record preserved as INTERRUPTED. The one-continuation bar stays consumed —
 * a crashed attempt may have executed real work, so nothing retries into it.
 */
function reconcileInterruptedContinuation(run) {
  if (run.state !== 'BUILD_CONTINUED') return run;
  const c = run.build && run.build.continuation;
  if (!c || c.type !== TIMEOUT_CONTINUATION_TYPE || c.status !== 'STARTED') {
    throw continuationRefusal('CONTINUATION_STATE_UNRECOGNIZED',
      `run ${run.runId} is BUILD_CONTINUED without a STARTED continuation record; refusing to guess what is executing`);
  }
  const executor = c.executor;
  if (!executor || !Number.isInteger(executor.pid) || !executor.processIdentity) {
    throw continuationRefusal('CONTINUATION_LIFETIME_UNVERIFIED',
      `run ${run.runId} records no provable executor identity for its in-flight continuation`);
  }
  const existence = processExistence(executor.pid);
  if (existence === 'unknown') {
    throw continuationRefusal('CONTINUATION_LIFETIME_UNVERIFIED',
      `the executor lifetime of run ${run.runId}'s continuation cannot be established right now`);
  }
  if (existence === 'present') {
    const observedIdentity = processIdentity(executor.pid);
    if (observedIdentity && sameProcessIdentity(executor.processIdentity, observedIdentity)) {
      throw continuationRefusal('CONTINUATION_IN_PROGRESS',
        `run ${run.runId} already has a live continuation executor (pid ${executor.pid})`);
    }
    if (!observedIdentity) {
      throw continuationRefusal('CONTINUATION_LIFETIME_UNVERIFIED',
        `pid ${executor.pid} exists but its identity cannot be proven; refusing to reconcile over a possibly live executor`);
    }
    // The PID exists but belongs to a different process lifetime: the executor
    // is gone and the PID was reused.
  }
  run.build = { ...run.build, continuation: { ...c, status: 'INTERRUPTED', endedAt: nowIso() } };
  transition(run, 'BUILD_FAILED',
    'timeout continuation executor ended without recording a result; the attempt record is preserved as INTERRUPTED');
  return loadRun(run.runId);
}

function continueTimedOutBuildClaimed(run, declared) {
  const { sessionId, command, prompt, parsed } = declared;
  run = reconcileInterruptedContinuation(run);
  const precondition = timeoutContinuationPrecondition(run);
  if (precondition) throw precondition;
  let packetCoordinate;
  try { packetCoordinate = currentRunPacketCoordinate(run); }
  catch (error) {
    throw continuationRefusal('PACKET_CHANGED',
      `timeout continuation requires the exact canonically valid packet recorded at intake: ${error.message}`);
  }
  const executionEnv = continuationExecutionEnv();
  const executable = resolveContinuationExecutable(executionEnv);
  const bounds = continuationExecutionBounds(parsed.timeoutSec);
  const executorIdentity = processIdentity(process.pid);
  if (!executorIdentity) {
    throw continuationRefusal('CLAIM_IDENTITY_UNAVAILABLE',
      'cannot prove the process lifetime executing this continuation');
  }

  const correctionsBefore = run.corrections;
  const originalBuild = run.build;
  const originalEvidence = Object.freeze({
    cmd: originalBuild.cmd, startedAt: originalBuild.startedAt, endedAt: originalBuild.endedAt,
    exit: originalBuild.exit, stdoutTail: originalBuild.stdoutTail, stderrTail: originalBuild.stderrTail,
  });
  const commandSha256 = sha256(command);
  const startedAt = nowIso();
  // One durable identity for this exact recovery attempt: the same inputs are
  // the same attempt, and any changed input is a different declaration the
  // one-attempt bar will refuse. Runtime evidence is output, never part of it.
  const attemptKey = sha256(JSON.stringify({
    type: TIMEOUT_CONTINUATION_TYPE,
    runId: run.runId,
    corrections: correctionsBefore,
    packetSha256: packetCoordinate.sha256,
    worktree: { path: run.worktree.path, branch: run.worktree.branch || null },
    route: originalBuild.route || run.route || null,
    sessionId,
    commandSha256,
  }));

  // The STARTED record is published, and the run leaves BUILD_FAILED, BEFORE
  // anything is executed. If this process dies mid-continuation the evidence
  // and the one-attempt bar both survive; nothing can retry into the gap.
  run.build = {
    ...originalBuild,
    continuation: {
      type: TIMEOUT_CONTINUATION_TYPE, status: 'STARTED', attemptKey, sessionId, commandSha256,
      timeoutSec: parsed.timeoutSec, promptSha256: prompt === undefined ? null : sha256(prompt),
      correctionsAtContinuation: correctionsBefore,
      executor: { pid: process.pid, processIdentity: executorIdentity },
      executable,
      startedAt, endedAt: null, exit: null, stdoutTail: '', stderrTail: '',
    },
  };
  transition(run, 'BUILD_CONTINUED',
    `same-attempt timeout continuation of session ${sessionId} starting`, TIMEOUT_CONTINUATION_CAPABILITY);

  // The one shared asynchronous supervisor executes the resume: a dedicated
  // process group, streamed bounded output with progress timestamps, idle and
  // absolute bounds it owns itself, and TERM -> grace -> KILL with proven
  // group drainage. Never a shell, never a wrapper binary, and never an
  // asserted outcome in place of an observed one.
  let supervised;
  try {
    supervised = runProcessGroupSupervisor({
      bin: executable,
      argv: [...parsed.resumeArgv],
      cwd: run.worktree.path,
      env: executionEnv,
      input: prompt === undefined ? '' : prompt,
      timeoutMs: bounds.timeoutMs,
      idleTimeoutMs: bounds.idleTimeoutMs,
      termGraceMs: CONTAINED_CHECK_TERM_GRACE_MS,
      drainTimeoutMs: CONTAINED_CHECK_DRAIN_TIMEOUT_MS,
    });
  } catch (error) {
    // Supervision itself failed to produce evidence. Whether the resume ran is
    // unknowable, so the slot stays consumed and the run fails closed.
    supervised = {
      status: null, signal: null, stdout: '', stderr: '',
      timedOut: null, progress: null,
      executionBoundary: { state: 'FAILED', drained: false,
        reason: `continuation supervisor failed: ${error.message || error}` },
    };
  }
  const boundary = supervised.executionBoundary ||
    { state: 'FAILED', drained: false, reason: 'the supervisor returned no execution-boundary evidence' };
  const timedOut = supervised.timedOut || null;
  const exit = supervised.status === null ? CONTINUATION_TIMED_OUT_EXIT : supervised.status;

  const finished = loadRun(run.runId);
  if (finished.state !== 'BUILD_CONTINUED' || !finished.build || !finished.build.continuation ||
      finished.build.continuation.startedAt !== startedAt ||
      finished.build.continuation.attemptKey !== attemptKey) {
    throw continuationRefusal('CONTINUATION_SUPERSEDED',
      `run ${run.runId} left this continuation before its result could be recorded`);
  }
  const containment = exit === 0 && boundary.state === 'PASSED' && boundary.drained === true
    ? continuationChangeContainment(finished, packetCoordinate.parsed.filesAllowed)
    : { ok: false, verified: false, outside: [],
      reason: 'not evaluated: the resume did not complete cleanly' };
  // The original attempt's evidence is carried through literally. A
  // continuation adds a record; it never rewrites what the timed-out build did.
  finished.build = {
    ...finished.build, ...originalEvidence,
    continuation: {
      ...finished.build.continuation,
      status: 'EXECUTED', endedAt: nowIso(), exit,
      timedOut,
      progress: supervised.progress || null,
      boundary: { state: boundary.state, drained: boundary.drained === true, reason: boundary.reason || null },
      containment,
      stdoutTail: boundedContinuationTail(supervised.stdout),
      stderrTail: boundedContinuationTail(supervised.stderr),
    },
  };
  saveRun(finished);

  if (exit === 0 && boundary.state === 'PASSED' && boundary.drained === true && containment.ok === true) {
    transition(finished, 'BUILT',
      `same-attempt timeout continuation of session ${sessionId} exited 0 with a drained process group inside packet containment`,
      TIMEOUT_CONTINUATION_CAPABILITY);
  } else {
    const why = exit !== 0
      ? (timedOut ? `hit its ${timedOut === 'IDLE' ? 'idle' : 'absolute'} bound` : `exited ${exit}`)
      : (boundary.state !== 'PASSED' || boundary.drained !== true
        ? `exited 0 but its execution boundary failed (${boundary.reason || 'no drainage evidence'})`
        : `exited 0 but left changes outside packet containment (${containment.reason})`);
    transition(finished, 'BUILD_FAILED',
      `same-attempt timeout continuation of session ${sessionId} ${why}`);
  }

  const fresh = loadRun(run.runId);
  if (fresh.corrections !== correctionsBefore) {
    throw continuationRefusal('INVALID_CORRECTION_STATE',
      `timeout continuation changed the recorded correction count of run ${run.runId}`);
  }
  return Object.freeze({
    runId: fresh.runId, state: fresh.state, action: 'continue-timeout',
    sessionId, exit, corrections: fresh.corrections,
    nextAction: fresh.state === 'BUILT' ? 'checks' : 'escalate',
  });
}

/**
 * The single continuation authority. Deliberately not reachable from the
 * dashboard: it is not in API_POST_ROUTES and no HTTP handler references it,
 * so no browser input can select a session id or a command.
 */
function continueTimedOutBuild(runId, continuation) {
  // The declaration is validated before any global claim is taken: a request
  // that could never execute must be refused without depending on — or
  // disturbing — launch-claim state, and identically in every environment.
  const declared = validatedContinuationDeclaration(continuation);
  let globalClaim;
  let claim;
  try {
    globalClaim = acquireGlobalWorkerClaim(3000);
    claim = acquireRunLaunchClaim(runId, 3000);
  } catch (e) {
    if (globalClaim) releaseRunLaunchClaim(globalClaim);
    if (e instanceof RunError) {
      if (e.code === 'BAD-RUN-ID') throw new AegisControlError('INVALID_RUN_ID', e.message, 400);
      if (e.code === 'NO-SUCH-RUN') throw new AegisControlError('RUN_NOT_FOUND', e.message, 404);
    }
    throw e;
  }
  try {
    assertGlobalWorkerAvailable(runId);
    const run = loadRunForControl(runId);
    assertPriorWorkerLaunchSafe(run);
    return continueTimedOutBuildClaimed(run, declared);
  } finally {
    if (claim) releaseRunLaunchClaim(claim);
    if (globalClaim) releaseRunLaunchClaim(globalClaim);
  }
}

function cmdContinueTimeout(args) {
  let result;
  try {
    result = continueTimedOutBuild(args.runId, {
      sessionId: args.session,
      command: args.continueCmd,
      ...(args.continuePrompt === undefined ? {} : { prompt: args.continuePrompt }),
    });
  } catch (e) {
    if (e instanceof AegisControlError) {
      const cliCode = { INVALID_RUN_ID: 'BAD-RUN-ID', RUN_NOT_FOUND: 'NO-SUCH-RUN' }[e.code] || e.code;
      throw new RunError(cliCode, e.message);
    }
    throw e;
  }
  if (result.state === 'BUILT') {
    console.log(`continuation ok (exit 0), corrections unchanged at ${result.corrections}\nnext: --checks ${result.runId}`);
    return EXIT_PASS;
  }
  console.error(`CONTINUATION FAILED (exit ${result.exit}); run remains ${result.state} at ${result.corrections} corrections`);
  return EXIT_REFUSED;
}

// ── step 6: deterministic checks ────────────────────────────────────────────
// This is the one canonical check executor. Both the CLI and the authenticated
// dashboard control surface enter through runChecks(), which owns the same
// per-run claim used by every other mutating control. The browser never supplies
// a command: commands come only from the packet already bound to the run.
const SWITCHBOARD_PACKET_ID = 'PKT-20260825-SWITCHBOARD-FOUNDATION';
const DASHBOARD_STATE_PACKET_IDS = new Set([
  SWITCHBOARD_PACKET_ID,
  'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA',
]);
const DASHBOARD_STATE_GENERATOR_REL = path.join('builder-control', 'aegis-state.cjs');
const DASHBOARD_STATE_OUTPUT_REL = path.join('builder-control', 'dashboard', 'state.js');

const CHECK_SNAPSHOT_POLICY = 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1';

function checkSnapshotFailure(message) {
  const bounded = boundedCheckFailureTail(message);
  return {
    stdoutTail: '',
    stderrTail: bounded.tail,
    stdoutTruncated: false,
    stderrTruncated: bounded.truncated,
  };
}

function checkExecutionEvidence(stdout = '', stderr = '') {
  const stdoutBounded = boundedCheckFailureTail(stdout);
  const stderrBounded = boundedCheckFailureTail(stderr);
  return {
    stdoutTail: stdoutBounded.tail,
    stderrTail: stderrBounded.tail,
    stdoutTruncated: stdoutBounded.truncated,
    stderrTruncated: stderrBounded.truncated,
  };
}

function nonExecutedCheckResult(cmd, status, skipped, reason) {
  const executionEvidence = checkSnapshotFailure(reason);
  return {
    cmd,
    exit: null,
    status,
    skipped,
    executionEvidence,
    failureEvidence: executionEvidence,
  };
}

const CHECK_SETUP_TIMEOUT_MS = 60_000;

function checkedSpawn(label, command, args, options = {}) {
  const requestedTimeout = Number.isInteger(options.timeout) && options.timeout > 0
    ? options.timeout : CHECK_SETUP_TIMEOUT_MS;
  const timeout = Math.min(requestedTimeout, CHECK_SETUP_TIMEOUT_MS);
  const result = spawnSync(command, args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options,
    timeout,
    killSignal: 'SIGKILL',
  });
  if (result.error || result.status !== 0) {
    const rawDetail = result.error && result.error.code === 'ETIMEDOUT'
      ? `timed out after ${timeout} ms; SIGKILL termination requested; ${result.error.message}`
      : result.error ? result.error.message
        : (result.stderr || result.stdout || `exit ${result.status}`).trim();
    const detail = boundedCheckFailureTail(rawDetail).tail;
    throw new RunError('CHECKS-CONTAINMENT-FAILED', `${label}: ${detail}`);
  }
  return result;
}

const MAX_SUPPLEMENTAL_SUBJECT_BYTES = 64 * 1024 * 1024;

function canonicalSubjectFilePath(worktreeReal, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0') ||
      path.posix.isAbsolute(relativePath) || path.posix.normalize(relativePath) !== relativePath ||
      relativePath === '..' || relativePath.startsWith('../')) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      `canonical subject path is not a safe repository-relative path: ${String(relativePath)}`);
  }
  const expected = path.resolve(worktreeReal, ...relativePath.split('/'));
  if (expected === worktreeReal || !expected.startsWith(worktreeReal + path.sep)) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      `canonical subject path escapes the governed worktree: ${relativePath}`);
  }
  return expected;
}

function readCanonicalUntrackedSubjectFile(worktreeReal, relativePath) {
  const expected = canonicalSubjectFilePath(worktreeReal, relativePath);
  let current = worktreeReal;
  for (const component of relativePath.split('/').slice(0, -1)) {
    current = path.join(current, component);
    const parent = fs.lstatSync(current);
    if (parent.isSymbolicLink() || !parent.isDirectory()) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        `canonical untracked subject path crosses an unsafe parent: ${relativePath}`);
    }
  }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(expected, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || (before.mode & 0o7000) !== 0) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        `canonical untracked subject is not a safe regular file: ${relativePath}`);
    }
    if (before.size > MAX_SUPPLEMENTAL_SUBJECT_BYTES) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        `canonical untracked subject exceeds the snapshot byte limit: ${relativePath}`);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        `canonical untracked subject changed while it was captured: ${relativePath}`);
    }
    return Object.freeze({
      path: relativePath,
      contentBase64: bytes.toString('base64'),
      mode: before.mode & 0o777,
    });
  } catch (error) {
    if (error instanceof RunError) throw error;
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      `canonical untracked subject is unavailable or unsafe (${relativePath}): ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function captureCanonicalUntrackedSubjectFiles(worktreeReal, head, subjectPaths) {
  const indexed = new Set(checkedSpawn('identify indexed canonical subject files', 'git',
    ['-C', worktreeReal, 'ls-files', '--cached', '-z', '--', ...subjectPaths]).stdout
    .split('\0').filter(Boolean));
  const atHead = new Set(checkedSpawn('identify canonical subject files at captured HEAD', 'git',
    ['-C', worktreeReal, 'ls-tree', '-r', '-z', '--name-only', head, '--', ...subjectPaths]).stdout
    .split('\0').filter(Boolean));
  const supplemental = [];
  let totalBytes = 0;
  for (const relativePath of subjectPaths) {
    if (indexed.has(relativePath) || atHead.has(relativePath)) continue;
    const entry = readCanonicalUntrackedSubjectFile(worktreeReal, relativePath);
    totalBytes += Buffer.byteLength(entry.contentBase64, 'base64');
    if (totalBytes > MAX_SUPPLEMENTAL_SUBJECT_BYTES) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        'canonical untracked subjects exceed the aggregate snapshot byte limit');
    }
    supplemental.push(entry);
  }
  return Object.freeze(supplemental);
}

function captureCheckExecutionSource(worktreeReal, packetBefore, subjectBefore, statePreparation) {
  const head = checkedSpawn('capture check HEAD', 'git',
    ['-C', worktreeReal, 'rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(head)) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED', 'captured check HEAD is not a commit');
  }
  const patch = checkedSpawn('capture exact working-tree bytes', 'git',
    ['-C', worktreeReal, 'diff', '--binary', '--full-index', 'HEAD', '--']).stdout;
  const packetBytes = Buffer.from(packetBefore.bytes);
  const supplementalSubjectFiles = captureCanonicalUntrackedSubjectFiles(
    worktreeReal, head, subjectBefore.subjectPaths);
  const capture = {
    head,
    patch,
    packetBytes,
    packetPath: packetBefore.path,
    stateGenerator: statePreparation.required ? statePreparation.generator : null,
    statePath: statePreparation.required ? statePreparation.output : null,
    supplementalSubjectFiles,
    subject: Object.freeze({
      subjectSha256: subjectBefore.subjectSha256,
      subjectPaths: Object.freeze([...subjectBefore.subjectPaths]),
      diffBytes: subjectBefore.diffBytes,
      range: subjectBefore.range,
    }),
  };
  const captureSha256 = sha256(stableJson({
    head,
    patchSha256: sha256(patch),
    packetSha256: sha256(packetBytes),
    packetPath: packetBefore.path,
    stateGenerator: capture.stateGenerator,
    statePath: capture.statePath,
    supplementalSubjectFiles,
    subject: capture.subject,
  }));
  return Object.freeze({ ...capture, captureSha256 });
}

function writeSupplementalSubjectFiles(snapshotRoot, files) {
  for (const entry of files || []) {
    const target = canonicalSubjectFilePath(snapshotRoot, entry.path);
    let parent = snapshotRoot;
    for (const component of entry.path.split('/').slice(0, -1)) {
      parent = path.join(parent, component);
      if (fs.existsSync(parent)) {
        const parentStat = fs.lstatSync(parent);
        if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
          throw new RunError('CHECKS-CONTAINMENT-FAILED',
            `snapshot target crosses an unsafe parent: ${entry.path}`);
        }
      } else {
        fs.mkdirSync(parent, { mode: 0o700 });
      }
    }
    if (fs.existsSync(target)) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        `snapshot target unexpectedly collides with tracked content: ${entry.path}`);
    }
    fs.writeFileSync(target, Buffer.from(entry.contentBase64, 'base64'), {
      flag: 'wx', mode: entry.mode,
    });
    fs.chmodSync(target, entry.mode);
  }
}

function annotateBoundaryFailure(error, stage, priorFailure = null) {
  const source = error instanceof Error ? error : new Error(String(error));
  const reasonParts = [
    `${stage}: ${boundedCheckFailureTail(source.message || source).tail}`,
  ];
  if (priorFailure && priorFailure.executionBoundaryFailure) {
    reasonParts.push(`prior ${priorFailure.executionBoundaryFailure.reason}`);
  }
  source.executionBoundaryFailure = {
    state: 'FAILED',
    reason: boundedCheckFailureTail(reasonParts.join('; ')).tail,
  };
  return source;
}

const CONTAINED_CHECK_TIMEOUT_MS = 15 * 60 * 1000;
const CONTAINED_CHECK_TERM_GRACE_MS = 1000;
const CONTAINED_CHECK_DRAIN_TIMEOUT_MS = 2000;

function assertSnapshotPlatformSupported() {
  // V1 containment is implemented with macOS sandbox-exec and a disposable
  // libproc inspector. Refuse before snapshot creation on every other host;
  // naming Linux here without a Linux sandbox/inspector would be false support.
  if (process.platform !== 'darwin') {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      `immutable check snapshots are unavailable on ${process.platform}; V1 supports darwin only`);
  }
}

function containedCheckTimeoutMs() {
  const raw = process.env.AEGIS_TEST_CHECK_TIMEOUT_MS;
  if (!raw) return CONTAINED_CHECK_TIMEOUT_MS;
  let runsReal;
  let tmpReal;
  try {
    runsReal = fs.realpathSync(RUNS_DIR);
    tmpReal = fs.realpathSync(os.tmpdir());
  } catch { return CONTAINED_CHECK_TIMEOUT_MS; }
  const parsed = Number(raw);
  if (!runsReal.startsWith(tmpReal + path.sep) || !Number.isInteger(parsed) || parsed < 50 || parsed > 5000) {
    return CONTAINED_CHECK_TIMEOUT_MS;
  }
  return parsed;
}

function containedCheckTestPort() {
  const raw = process.env.AEGIS_TEST_CHECK_PORT;
  if (!raw) return null;
  let runsReal;
  let tmpReal;
  try {
    runsReal = fs.realpathSync(RUNS_DIR);
    tmpReal = fs.realpathSync(os.tmpdir());
  } catch { return null; }
  const port = Number(raw);
  if (!runsReal.startsWith(tmpReal + path.sep) || !Number.isInteger(port) ||
      port < 1024 || port > 65535) return null;
  return port;
}

function nodeRuntimeReadRoots() {
  const executable = fs.realpathSync(process.execPath);
  const nodeRoot = path.dirname(path.dirname(executable));
  const roots = new Set([path.dirname(executable), path.join(nodeRoot, 'lib')]);
  const linked = spawnSync('/usr/bin/otool', ['-L', executable], {
    encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL',
  });
  if (linked.error || linked.status !== 0) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      `could not resolve the pinned Node runtime libraries: ${linked.error ? linked.error.message : `otool exit ${linked.status}`}`);
  }
  for (const line of String(linked.stdout || '').split('\n').slice(1)) {
    const candidate = line.trim().split(/\s+/)[0];
    if (!candidate || !path.isAbsolute(candidate) ||
        candidate.startsWith('/System/') || candidate.startsWith('/usr/lib/')) continue;
    let real;
    try { real = fs.realpathSync(candidate); }
    catch (error) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        `pinned Node runtime library is unavailable: ${path.basename(candidate)} (${error.code || error.message})`);
    }
    if (!fs.statSync(real).isFile()) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        `pinned Node runtime dependency is not a regular file: ${path.basename(candidate)}`);
    }
    roots.add(path.dirname(candidate));
    roots.add(path.dirname(real));
  }
  return Object.freeze([...roots].sort());
}

function reserveContainedCheckPorts(count) {
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED', 'invalid contained check port reservation count');
  }
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * (count + 1));
  const state = new Int32Array(shared);
  const worker = new Worker(`
    const net = require('net');
    const { workerData } = require('worker_threads');
    const state = new Int32Array(workerData.shared);
    const servers = [];
    let ready = 0;
    for (let i = 0; i < workerData.count; i += 1) {
      const server = net.createServer();
      servers.push(server);
      server.once('error', () => {
        Atomics.store(state, i, -1);
        Atomics.notify(state, i);
      });
      server.listen(0, '127.0.0.1', () => {
        Atomics.store(state, i, server.address().port);
        Atomics.notify(state, i);
        ready += 1;
        if (ready === workerData.count) {
          Atomics.wait(state, workerData.count, 0);
          let pending = servers.length;
          for (const open of servers) open.close(() => {
            pending -= 1;
            if (pending === 0) {
              Atomics.store(state, workerData.count, 2);
              Atomics.notify(state, workerData.count);
            }
          });
        }
      });
    }
  `, { eval: true, workerData: { shared, count } });
  const ports = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const wait = Atomics.wait(state, index, 0, 3000);
      const port = Atomics.load(state, index);
      if (wait === 'timed-out' || !Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new RunError('CHECKS-CONTAINMENT-FAILED', 'could not reserve a per-execution loopback port');
      }
      ports.push(port);
    }
  } catch (error) {
    worker.terminate();
    throw error;
  }
  let released = false;
  return Object.freeze({
    ports: Object.freeze(ports),
    release() {
      if (released) return;
      released = true;
      Atomics.store(state, count, 1);
      Atomics.notify(state, count);
      if (Atomics.wait(state, count, 1, 3000) === 'timed-out') {
        worker.terminate();
        throw new RunError('CHECKS-CONTAINMENT-FAILED', 'timed out releasing per-execution loopback ports');
      }
      worker.unref();
    },
  });
}

function containedCheckSupervisorMain() {
  'use strict';
  const fs = require('fs');
  const path = require('path');
  const childProcess = require('child_process');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MAX_TAIL_BYTES = 64 * 1024;

  function appendTail(state, chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const combined = Buffer.concat([state.bytes, bytes]);
    if (combined.length > MAX_TAIL_BYTES) {
      state.bytes = combined.subarray(combined.length - MAX_TAIL_BYTES);
      state.truncated = true;
    } else state.bytes = combined;
  }

  function processMarker(pid) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).trim().split(/\s+/);
      if (fields[19]) return `proc:${fields[19]}`;
    } catch { /* macOS or exited process */ }
    const ps = fs.existsSync('/bin/ps') ? '/bin/ps' : '/usr/bin/ps';
    try {
      const observed = childProcess.spawnSync(ps, ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL',
      });
      const marker = (observed.stdout || '').trim();
      return observed.status === 0 && marker ? `ps:${marker}` : null;
    } catch { return null; }
  }

  function observedProcessGroup(pid) {
    const ps = fs.existsSync('/bin/ps') ? '/bin/ps' : '/usr/bin/ps';
    try {
      const observed = childProcess.spawnSync(ps, ['-p', String(pid), '-o', 'pgid='], {
        encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL',
      });
      const value = Number((observed.stdout || '').trim());
      return observed.status === 0 && Number.isInteger(value) && value > 1 ? value : null;
    } catch { return null; }
  }

  function groupAlive(groupId) {
    const ps = fs.existsSync('/bin/ps') ? '/bin/ps' : '/usr/bin/ps';
    try {
      const observed = childProcess.spawnSync(ps, ['-axo', 'pgid=,stat='], {
        encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL',
      });
      if (observed.status === 0) {
        const members = String(observed.stdout || '').split(/\r?\n/).map((line) => line.trim())
          .filter(Boolean).map((line) => {
            const match = /^(\d+)\s+(\S+)/.exec(line);
            return match ? { pgid: Number(match[1]), state: match[2] } : null;
          }).filter(Boolean).filter((entry) => entry.pgid === groupId);
        // A dead child can remain briefly as a zombie until this supervisor
        // exits and its parent reaps it. Zombies cannot execute or retain the
        // disposable boundary, so only a non-zombie member blocks cleanup.
        return members.some((entry) => !/^Z/.test(entry.state));
      }
    } catch { /* fail closed through the kernel probe below */ }
    try { process.kill(-groupId, 0); return true; }
    catch (error) {
      if (error && error.code === 'ESRCH') return false;
      return true;
    }
  }

  function signalGroup(groupId, signal) {
    try { process.kill(-groupId, signal); return true; }
    catch (error) {
      if (error && error.code === 'ESRCH') return false;
      throw error;
    }
  }

  async function waitForDrain(groupId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
      if (!groupAlive(groupId)) return true;
      await sleep(25);
    } while (Date.now() < deadline);
    return !groupAlive(groupId);
  }

  async function terminateAndDrain(groupId, leaderPid, leaderMarker, graceMs, drainMs) {
    const currentMarker = processMarker(leaderPid);
    if (leaderMarker && currentMarker && leaderMarker !== currentMarker) {
      return { drained: false, reason: 'process-group leader identity changed before termination', signals: [] };
    }
    const signals = [];
    if (!groupAlive(groupId)) return { drained: true, reason: null, signals };
    if (signalGroup(groupId, 'SIGTERM')) signals.push('SIGTERM');
    if (await waitForDrain(groupId, graceMs)) return { drained: true, reason: null, signals };
    if (signalGroup(groupId, 'SIGKILL')) signals.push('SIGKILL');
    const drained = await waitForDrain(groupId, drainMs);
    return {
      drained,
      reason: drained ? null : 'dedicated process group remained after TERM/grace/KILL drainage',
      signals,
    };
  }

  async function readConfiguration() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async function main() {
    const config = await readConfiguration();
    if (process.platform !== 'darwin') {
      throw new Error(`dedicated process-group supervision is unavailable on ${process.platform}`);
    }
    const stdout = { bytes: Buffer.alloc(0), truncated: false };
    const stderr = { bytes: Buffer.alloc(0), truncated: false };
    let child;
    try {
      child = childProcess.spawn(config.bin, config.argv, {
        cwd: config.cwd,
        env: config.env,
        detached: true,
        stdio: [config.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: null, signal: null, stdout: '', stderr: '',
        error: { code: 'CHECK_PROCESS_SPAWN_FAILED', message: error.message },
        executionBoundary: { state: 'FAILED', drained: true, reason: 'contained process could not be spawned' },
      }));
      return;
    }
    const outcomePromise = new Promise((resolve) => {
      child.once('error', (error) => resolve({ type: 'error', error }));
      child.once('exit', (code, signal) => resolve({ type: 'exit', code, signal }));
    });
    // Progress is observed, never asserted: every output chunk stamps the idle
    // clock, so a silently hung child is distinguishable from a working one.
    const startedTs = Date.now();
    const progress = { startedAt: new Date(startedTs).toISOString(), firstOutputAt: null, lastOutputAt: null };
    let lastActivityTs = startedTs;
    const observe = (state) => (chunk) => {
      appendTail(state, chunk);
      lastActivityTs = Date.now();
      const stamp = new Date(lastActivityTs).toISOString();
      if (!progress.firstOutputAt) progress.firstOutputAt = stamp;
      progress.lastOutputAt = stamp;
    };
    child.stdout.on('data', observe(stdout));
    child.stderr.on('data', observe(stderr));
    if (config.input !== undefined && child.stdin) {
      child.stdin.on('error', () => { /* a child may exit before reading */ });
      child.stdin.end(String(config.input));
    }
    const leaderPid = child.pid;
    const leaderMarker = processMarker(leaderPid);
    const observedGroup = observedProcessGroup(leaderPid);
    const groupId = leaderPid;
    const groupMismatch = observedGroup !== null && observedGroup !== groupId;
    const idleMs = Number.isInteger(config.idleTimeoutMs) && config.idleTimeoutMs > 0
      ? config.idleTimeoutMs : null;
    let boundsPoll = null;
    const outcome = await new Promise((resolve) => {
      const absoluteDeadline = startedTs + config.timeoutMs;
      boundsPoll = setInterval(() => {
        const now = Date.now();
        if (now >= absoluteDeadline) resolve({ type: 'timeout', mode: 'ABSOLUTE' });
        else if (idleMs !== null && now - lastActivityTs >= idleMs) resolve({ type: 'timeout', mode: 'IDLE' });
      }, 100);
      outcomePromise.then(resolve);
    });
    clearInterval(boundsPoll);
    let boundaryReason = groupMismatch
      ? `detached child did not own its dedicated process group (${observedGroup} != ${groupId})` : null;
    if (outcome.type === 'timeout') {
      boundaryReason = outcome.mode === 'IDLE'
        ? `contained process produced no output for ${idleMs} ms (idle bound)`
        : `contained check exceeded ${config.timeoutMs} ms`;
    }
    else if (outcome.type === 'error') boundaryReason = `contained check process error: ${outcome.error.message}`;
    else if (outcome.signal) boundaryReason = `contained check terminated abnormally by ${outcome.signal}`;
    else if (groupAlive(groupId)) boundaryReason = 'contained check left a live descendant process group';

    let drainage = { drained: !groupAlive(groupId), reason: null, signals: [] };
    if (!drainage.drained || boundaryReason) {
      drainage = await terminateAndDrain(groupId, leaderPid, leaderMarker,
        config.termGraceMs, config.drainTimeoutMs);
    }
    if (!drainage.drained) {
      boundaryReason = [boundaryReason, drainage.reason].filter(Boolean).join('; ');
    }
    await sleep(25);
    const failedBoundary = Boolean(boundaryReason) || !drainage.drained;
    const result = {
      status: outcome.type === 'exit' ? outcome.code : null,
      signal: outcome.type === 'exit' ? outcome.signal : outcome.type === 'timeout' ? 'SIGKILL' : null,
      stdout: stdout.bytes.toString('utf8'),
      stderr: stderr.bytes.toString('utf8'),
      outputTruncated: stdout.truncated || stderr.truncated,
      timedOut: outcome.type === 'timeout' ? outcome.mode : null,
      progress,
      error: failedBoundary ? {
        code: outcome.type === 'timeout' ? 'CHECK_PROCESS_TIMEOUT' : 'CHECK_PROCESS_GROUP_FAILED',
        message: [boundaryReason, drainage.signals.length ?
          `termination sequence ${drainage.signals.join('->')}` : null].filter(Boolean).join('; '),
      } : null,
      executionBoundary: {
        state: failedBoundary ? 'FAILED' : 'PASSED',
        drained: drainage.drained,
        reason: boundaryReason,
        processGroupId: groupId,
        leaderIdentity: leaderMarker ? 'CAPTURED' : 'UNAVAILABLE',
      },
    };
    process.stdout.write(JSON.stringify(result));
  }

  main().catch((error) => {
    process.stdout.write(JSON.stringify({
      status: null, signal: null, stdout: '', stderr: '',
      error: { code: 'CHECK_SUPERVISOR_FAILED', message: error.message },
      executionBoundary: { state: 'FAILED', drained: false, reason: error.message },
    }));
  });
}

const CONTAINED_CHECK_SUPERVISOR_SOURCE = `(${containedCheckSupervisorMain.toString()})()`;

/**
 * The one shared asynchronous supervisor entry point. Callers hand it a fully
 * explicit execution — bin, argv, cwd, an env object, idle/absolute bounds —
 * and it owns the dedicated process group, streamed bounded output with
 * progress timestamps, and TERM -> grace -> KILL with proven group drainage.
 * It throws only when supervision itself could not produce valid evidence;
 * what the supervised process did is returned for the caller to judge.
 */
function runProcessGroupSupervisor(config) {
  const supervisor = spawnSync(process.execPath, ['-e', CONTAINED_CHECK_SUPERVISOR_SOURCE], {
    input: JSON.stringify(config),
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: config.timeoutMs + config.termGraceMs + config.drainTimeoutMs + 10_000,
    killSignal: 'SIGKILL',
  });
  if (supervisor.error || supervisor.status !== 0) {
    const raw = supervisor.error ? supervisor.error.message
      : (supervisor.stderr || supervisor.stdout || `supervisor exit ${supervisor.status}`);
    const error = new RunError('CHECKS-CONTAINMENT-FAILED',
      `contained check supervisor failed: ${boundedCheckFailureTail(raw).tail}`);
    error.executionBoundaryFailure = {
      state: 'FAILED',
      reason: boundedCheckFailureTail(error.message).tail,
    };
    error.checkGroupDrained = false;
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(supervisor.stdout); }
  catch (error) {
    const failure = new RunError('CHECKS-CONTAINMENT-FAILED',
      `contained check supervisor returned invalid evidence: ${error.message}`);
    failure.executionBoundaryFailure = { state: 'FAILED', reason: boundedCheckFailureTail(failure.message).tail };
    failure.checkGroupDrained = false;
    throw failure;
  }
  if (!parsed.executionBoundary || typeof parsed.executionBoundary.drained !== 'boolean') {
    const failure = new RunError('CHECKS-CONTAINMENT-FAILED',
      'contained check supervisor omitted process-group drainage evidence');
    failure.executionBoundaryFailure = { state: 'FAILED', reason: failure.message };
    failure.checkGroupDrained = false;
    throw failure;
  }
  return parsed;
}

function runContainedCheckProcess(command, cwd, env) {
  const parsed = runProcessGroupSupervisor({
    bin: command.bin,
    argv: command.argv,
    cwd,
    env,
    timeoutMs: containedCheckTimeoutMs(),
    termGraceMs: CONTAINED_CHECK_TERM_GRACE_MS,
    drainTimeoutMs: CONTAINED_CHECK_DRAIN_TIMEOUT_MS,
  });
  if (parsed.error) {
    const failure = new RunError(parsed.error.code || 'CHECKS-CONTAINMENT-FAILED',
      boundedCheckFailureTail(parsed.error.message || parsed.executionBoundary.reason || 'contained check failed').tail);
    failure.executionBoundaryFailure = {
      state: 'FAILED',
      reason: boundedCheckFailureTail(parsed.executionBoundary.reason || failure.message).tail,
    };
    failure.checkGroupDrained = parsed.executionBoundary.drained;
    failure.checkStdout = parsed.stdout || '';
    failure.checkStderr = parsed.stderr || '';
    throw failure;
  }
  return {
    status: parsed.status,
    signal: parsed.signal,
    stdout: parsed.stdout || '',
    stderr: parsed.stderr || '',
    outputTruncated: parsed.outputTruncated === true,
    executionBoundary: parsed.executionBoundary,
  };
}

function proveOwnedProcessGroupDrainage(profile, cwd, env) {
  const source = [
    "const { spawn } = require('child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "child.once('error', (error) => { console.error(error.message); process.exit(1); });",
    "child.once('spawn', () => { child.unref(); process.exit(0); });",
    "setTimeout(() => process.exit(2), 1000).unref();",
  ].join(' ');
  const contained = CheckContainment.sandboxedCommand(profile, ['-e', source]);
  try {
    runContainedCheckProcess(contained, cwd, env);
    return false;
  } catch (error) {
    return error && error.code === 'CHECK_PROCESS_GROUP_FAILED' &&
      error.checkGroupDrained === true && error.executionBoundaryFailure &&
      /left a live descendant process group/.test(error.executionBoundaryFailure.reason || '');
  }
}

function snapshotGitEnvironment(home, scratch, bin) {
  const env = {};
  for (const key of ['LANG', 'LC_ALL', 'LC_CTYPE', 'TERM']) {
    if (typeof process.env[key] === 'string' && process.env[key]) env[key] = process.env[key];
  }
  env.HOME = home;
  env.USER = 'aegis-check';
  env.LOGNAME = 'aegis-check';
  env.TMPDIR = scratch.endsWith(path.sep) ? scratch : scratch + path.sep;
  env.PATH = [
    bin,
    path.dirname(process.execPath),
    '/Library/Developer/CommandLineTools/usr/bin',
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ].join(':');
  env.GIT_OPTIONAL_LOCKS = '0';
  env.AEGIS_CHECK_SNAPSHOT_POLICY = 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1';
  const inspector = path.join(bin, 'ps');
  env[TRUSTED_PROCESS_INSPECTOR_ENV] = inspector;
  env[TRUSTED_PROCESS_INSPECTOR_SHA_ENV] = sha256(fs.readFileSync(inspector));
  return env;
}

function writeSnapshotProcessInspector(bin) {
  assertSnapshotPlatformSupported();
  const source = path.join(bin, 'ps.c');
  const target = path.join(bin, 'ps');
  const body = [
    '#include <errno.h>',
    '#include <libproc.h>',
    '#include <stdio.h>',
    '#include <stdlib.h>',
    '#include <string.h>',
    'int main(int argc, char **argv) {',
    '  if (argc == 3 && !strcmp(argv[1], "-axo") && !strcmp(argv[2], "pid=,pgid=")) {',
    '    int bytes = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);',
    '    if (bytes <= 0) return 1;',
    '    pid_t *pids = (pid_t *)malloc((size_t)bytes);',
    '    if (!pids) return 1;',
    '    int got = proc_listpids(PROC_ALL_PIDS, 0, pids, bytes);',
    '    if (got <= 0) { free(pids); return 1; }',
    '    int count = got / (int)sizeof(pid_t);',
    '    for (int i = 0; i < count; i++) {',
    '      if (pids[i] <= 0) continue;',
    '      struct proc_bsdinfo entry;',
    '      if (proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &entry, sizeof(entry)) != (int)sizeof(entry)) continue;',
    '      printf("%d %d\\n", entry.pbi_pid, entry.pbi_pgid);',
    '    }',
    '    free(pids);',
    '    return 0;',
    '  }',
    '  if (argc != 5 || strcmp(argv[1], "-p") || strcmp(argv[3], "-o")) return 2;',
    '  char *end = NULL; long parsed = strtol(argv[2], &end, 10);',
    '  if (!end || *end || parsed <= 1) return 2;',
    '  struct proc_bsdinfo info;',
    '  int got = proc_pidinfo((int)parsed, PROC_PIDTBSDINFO, 0, &info, sizeof(info));',
    '  if (got != sizeof(info)) return 1;',
    '  if (!strcmp(argv[4], "pid=")) printf("%d\\n", info.pbi_pid);',
    '  else if (!strcmp(argv[4], "pgid=")) printf("%d\\n", info.pbi_pgid);',
    '  else if (!strcmp(argv[4], "lstart=")) printf("%llu.%llu\\n", info.pbi_start_tvsec, info.pbi_start_tvusec);',
    '  else if (!strcmp(argv[4], "comm=")) printf("%s\\n", info.pbi_comm);',
    '  else return 2;',
    '  return 0;',
    '}',
  ].join('\n') + '\n';
  fs.writeFileSync(source, body, { mode: 0o600 });
  checkedSpawn('compile unprivileged snapshot process inspector', '/usr/bin/clang',
    ['-Wall', '-Wextra', '-O2', source, '-o', target]);
  fs.chmodSync(target, 0o700);
  const observed = checkedSpawn('verify snapshot process inspector', target,
    ['-p', String(process.pid), '-o', 'pid=']).stdout.trim();
  if (observed !== String(process.pid)) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      'snapshot process inspector did not report its real host PID');
  }
  const listed = checkedSpawn('verify snapshot process-group listing', target,
    ['-axo', 'pid=,pgid=']).stdout;
  if (!listed.split('\n').some((line) => line.trim().match(/^(\d+)\s+(\d+)$/) &&
      Number(line.trim().split(/\s+/)[0]) === process.pid)) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      'snapshot process inspector did not list its real host PID with a process group');
  }
}

function validateGeneratedDashboardState(snapshotRoot, statePath) {
  const outputExpected = path.join(snapshotRoot, statePath);
  const outputDirExpected = path.dirname(outputExpected);
  let body;
  try {
    const outputStat = fs.lstatSync(outputExpected);
    const outputReal = fs.realpathSync(outputExpected);
    const outputDirReal = fs.realpathSync(outputDirExpected);
    if (outputStat.isSymbolicLink() || !outputStat.isFile() || outputReal !== outputExpected ||
        outputDirReal !== outputDirExpected || !outputReal.startsWith(outputDirReal + path.sep)) {
      throw new Error('output escaped the disposable dashboard directory or is not a regular file');
    }
    body = fs.readFileSync(outputReal, 'utf8');
    if (Buffer.byteLength(body, 'utf8') > 32 * 1024 * 1024) throw new Error('output exceeds 32 MiB');
  } catch (error) {
    throw new RunError('STATE_OUTPUT_INVALID', `generated dashboard state is unavailable: ${error.message}`);
  }
  const marker = 'window.AEGIS_STATE = ';
  const markerAt = body.indexOf(marker);
  if (!body.startsWith('/* Generated by builder-control/aegis-state.cjs') || markerAt === -1) {
    throw new RunError('STATE_OUTPUT_INVALID',
      'generated dashboard state lacks its canonical generator header or assignment');
  }
  try {
    const value = JSON.parse(body.slice(markerAt + marker.length).trim().replace(/;\s*$/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('state root is not an object');
  } catch (error) {
    throw new RunError('STATE_OUTPUT_INVALID', `generated dashboard state is invalid: ${error.message}`);
  }
}

function removeCheckBoundary(boundaryRoot, namespace = 'aegis-check-boundary-') {
  if (!['aegis-check-boundary-', 'aegis-host-check-boundary-'].includes(namespace)) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      'refused cleanup for an unknown disposable boundary namespace');
  }
  const tmpReal = fs.realpathSync(os.tmpdir());
  const expectedPrefix = path.join(tmpReal, namespace);
  const resolved = path.resolve(boundaryRoot);
  if (!resolved.startsWith(expectedPrefix) || path.dirname(resolved) !== tmpReal) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      'refused cleanup outside the exact disposable check-boundary namespace');
  }
  if (!fs.existsSync(resolved)) return;

  // A contained command may remove permissions or set the user immutable bit
  // on files inside its disposable boundary. Cleanup runs outside containment:
  // clear recoverable flags, restore traversal permissions without following
  // symlinks, then prove the exact boundary is gone.
  spawnSync('/usr/bin/chflags', ['-R', 'nouchg', resolved], {
    encoding: 'utf8', timeout: 30_000,
  });
  const pending = [resolved];
  while (pending.length) {
    const current = pending.pop();
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT') continue; else throw error; }
    if (stat.isSymbolicLink()) continue;
    try { fs.chmodSync(current, stat.isDirectory() ? 0o700 : 0o600); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!stat.isDirectory()) continue;
    for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  if (fs.existsSync(resolved)) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      'disposable check boundary remained after trusted cleanup');
  }
}

function inheritedImmutableCheckBoundary(worktreeReal) {
  if (process.env.AEGIS_CHECK_SNAPSHOT_POLICY !== CHECK_SNAPSHOT_POLICY) return null;
  let cwd;
  let common;
  try {
    cwd = fs.realpathSync(process.cwd());
    const boundaryRoot = path.dirname(cwd);
    if (path.basename(cwd) !== 'worktree' ||
        !path.basename(boundaryRoot).startsWith('aegis-check-boundary-') ||
        fs.realpathSync(worktreeReal) !== cwd) {
      throw new Error('the asserted inherited snapshot is not the governed canonical worktree');
    }
    common = checkedSpawn('prove inherited snapshot repository ownership', 'git', [
      '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir',
    ]).stdout.trim();
    if (fs.realpathSync(common) !== fs.realpathSync(path.join(cwd, '.git'))) {
      throw new Error('the asserted inherited snapshot is not an independent repository');
    }
    try {
      fs.readFileSync('/private/etc/hosts');
      throw new Error('the asserted inherited snapshot can still read a non-allowlisted host file');
    } catch (error) {
      if (!error || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    }
    return Object.freeze({ cwd, boundaryRoot });
  } catch (error) {
    throw new RunError('CHECKS-CONTAINMENT-FAILED',
      `inherited immutable snapshot proof failed: ${error.message}`);
  }
}

function executeCheckInInheritedSnapshot(cmd, inherited, capture) {
  let nestedRoot = null;
  let failure = null;
  let result;
  try {
    // The inherited sandbox authorizes writes only beneath its already-proven
    // boundary. Allocating a sibling in the ambient OS temp directory was both
    // denied in real containment and escaped cleanup if mkdir itself threw.
    nestedRoot = fs.mkdtempSync(path.join(inherited.boundaryRoot, 'aegis-inherited-check-'));
    const snapshotRoot = path.join(nestedRoot, 'worktree');
    checkedSpawn('create inherited independent check repository', 'git',
      ['clone', '--no-hardlinks', '--no-checkout', '--quiet', inherited.cwd, snapshotRoot]);
    checkedSpawn('checkout inherited captured check HEAD', 'git',
      ['-C', snapshotRoot, 'checkout', '-B', 'aegis/inherited-check-snapshot', '--quiet', capture.head]);
    if (capture.patch) {
      checkedSpawn('apply inherited captured working-tree bytes', 'git',
        ['-C', snapshotRoot, 'apply', '--index', '--binary', '--whitespace=nowarn', '-'],
        { input: capture.patch });
    }
    writeSupplementalSubjectFiles(snapshotRoot, capture.supplementalSubjectFiles);
    const packetTarget = path.join(snapshotRoot, capture.packetPath);
    fs.mkdirSync(path.dirname(packetTarget), { recursive: true });
    fs.writeFileSync(packetTarget, capture.packetBytes);
    const home = path.join(nestedRoot, 'home');
    const scratch = path.join(nestedRoot, 'tmp');
    const bin = path.join(nestedRoot, 'bin');
    fs.mkdirSync(home, { mode: 0o700 });
    fs.mkdirSync(scratch, { mode: 0o700 });
    fs.mkdirSync(bin, { mode: 0o700 });
    writeSnapshotProcessInspector(bin);
    const env = snapshotGitEnvironment(home, scratch, bin);
    const snapshotSubject = runCanonicalEngineeringOs([
      '--subject', '--packet', path.join(snapshotRoot, capture.packetPath), '--json'], {
      ...env,
      GIT_DIR: path.join(snapshotRoot, '.git'),
      GIT_WORK_TREE: snapshotRoot,
    });
    if (snapshotSubject.status !== 0 || !sameCanonicalSubject(capture.subject, snapshotSubject.parsed)) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        'inherited disposable snapshot does not reproduce the captured canonical subject');
    }
    if (capture.stateGenerator && capture.statePath) {
      const generator = path.join(snapshotRoot, capture.stateGenerator);
      const output = path.join(snapshotRoot, capture.statePath);
      const generated = spawnSync(process.execPath, [generator, '--out', output], {
        cwd: snapshotRoot, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000, killSignal: 'SIGKILL',
      });
      const generatedExit = generated.status === null ? 124 : generated.status;
      if (generated.error || generatedExit !== 0) {
        throw new RunError('STATE_GENERATION_FAILED',
          `canonical dashboard state generation failed in inherited snapshot${generated.error ?
            `: ${generated.error.message}` : ` (exit ${generatedExit})`}`);
      }
      validateGeneratedDashboardState(snapshotRoot, capture.statePath);
      const generatedSubject = runCanonicalEngineeringOs([
        '--subject', '--packet', path.join(snapshotRoot, capture.packetPath), '--json'], {
        ...env,
        GIT_DIR: path.join(snapshotRoot, '.git'),
        GIT_WORK_TREE: snapshotRoot,
      });
      if (generatedSubject.status !== 0 || !sameCanonicalSubject(capture.subject, generatedSubject.parsed)) {
        throw new RunError('CHECKS-CONTAINMENT-FAILED',
          'inherited dashboard state generation changed the captured exact subject');
      }
    }
    const hostingCheckCommands = new Set([
      'node builder-control/test/hosting.test.cjs',
      'node builder-control/test/hosting.test.cjs --host-only',
      'node --test builder-control/test/hosting.test.cjs',
    ]);
    if (hostingCheckCommands.has(cmd.trim())) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        'recursive hosting checks cannot acquire new network authority inside an inherited snapshot');
    }
    result = runContainedCheckProcess({ bin: '/bin/bash', argv: ['-c', cmd] }, snapshotRoot, env);
  } catch (error) {
    failure = annotateBoundaryFailure(error, 'inherited immutable check execution');
    if (error && error.checkStdout) failure.checkStdout = error.checkStdout;
    if (error && error.checkStderr) failure.checkStderr = error.checkStderr;
  }
  if (nestedRoot) {
    try {
      fs.rmSync(nestedRoot, { recursive: true, force: true });
      if (fs.existsSync(nestedRoot)) {
        throw new Error('inherited disposable check directory remained after cleanup');
      }
    } catch (error) {
      failure = annotateBoundaryFailure(error, 'inherited disposable cleanup', failure);
    }
  }
  if (failure) throw failure;
  return result;
}

function executeCheckInSnapshot(cmd, worktreeReal, capture) {
  const inherited = inheritedImmutableCheckBoundary(worktreeReal);
  if (inherited) return executeCheckInInheritedSnapshot(cmd, inherited, capture);
  let boundaryRoot = null;
  let networkReservation = null;
  let stage = 'sandbox preflight';
  let result;
  let failure = null;
  let cleanupSafe = true;
  try {
    assertSnapshotPlatformSupported();
    CheckContainment.assertSandboxOperational();
    stage = 'snapshot establishment';
    boundaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-check-boundary-'));
    const snapshotRoot = path.join(boundaryRoot, 'worktree');
    checkedSpawn('create independent check repository', 'git',
      ['clone', '--no-hardlinks', '--no-checkout', '--quiet', worktreeReal, snapshotRoot]);
    checkedSpawn('checkout captured check HEAD', 'git',
      ['-C', snapshotRoot, 'checkout', '-B', 'aegis/check-snapshot', '--quiet', capture.head]);
    if (capture.patch) {
      checkedSpawn('apply captured working-tree bytes', 'git',
        ['-C', snapshotRoot, 'apply', '--index', '--binary', '--whitespace=nowarn', '-'],
        { input: capture.patch });
    }
    writeSupplementalSubjectFiles(snapshotRoot, capture.supplementalSubjectFiles);

    const packetTarget = path.join(snapshotRoot, capture.packetPath);
    fs.mkdirSync(path.dirname(packetTarget), { recursive: true });
    fs.writeFileSync(packetTarget, capture.packetBytes);
    const home = path.join(boundaryRoot, 'home');
    const scratch = path.join(boundaryRoot, 'tmp');
    const bin = path.join(boundaryRoot, 'bin');
    fs.mkdirSync(home, { mode: 0o700 });
    fs.mkdirSync(scratch, { mode: 0o700 });
    fs.mkdirSync(bin, { mode: 0o700 });
    // sandbox-exec refuses the setuid system /bin/ps even under an allow-all
    // profile. Compile a disposable, unprivileged libproc reader that reports
    // the real kernel PID/group/start/executable fields required by lifecycle
    // tests. This preserves real identity evidence; it does not synthesize it.
    writeSnapshotProcessInspector(bin);
    const env = snapshotGitEnvironment(home, scratch, bin);
    stage = 'snapshot subject preflight';
    const snapshotSubject = runCanonicalEngineeringOs([
      '--subject', '--packet', packetTarget, '--json'], {
      ...env,
      GIT_DIR: path.join(snapshotRoot, '.git'),
      GIT_WORK_TREE: snapshotRoot,
    });
    if (snapshotSubject.status !== 0 || !sameCanonicalSubject(capture.subject, snapshotSubject.parsed)) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        'disposable check snapshot does not reproduce the captured canonical subject');
    }

    // Reads are explicit: the immutable snapshot, its disposable runtime, the
    // pinned Node/Homebrew runtime libraries, and the macOS toolchain. There is
    // no blanket file-read authority over the operator machine. Writes remain
    // deny-by-default and confined to this new boundary plus /dev/null.
    //
    // Network is normally absent. The one checked-in hosting suite receives
    // two freshly reserved loopback ports for this execution only; no fixed
    // ambient port can become an unauthenticated exfiltration receiver.
    const allowedLoopbackPorts = [];
    const checkCommand = cmd.trim();
    const hostingCheckCommands = new Set([
      'node builder-control/test/hosting.test.cjs',
      'node builder-control/test/hosting.test.cjs --host-only',
      'node --test builder-control/test/hosting.test.cjs',
    ]);
    if (hostingCheckCommands.has(checkCommand)) {
      networkReservation = reserveContainedCheckPorts(2);
      const [projectionPort, apiPort] = networkReservation.ports;
      env.AEGIS_TEST_HOSTING_PORT = String(projectionPort);
      env.AEGIS_TEST_HOSTING_API_PORT = String(apiPort);
      allowedLoopbackPorts.push(projectionPort, apiPort);
    }
    const testPort = containedCheckTestPort();
    if (testPort && !allowedLoopbackPorts.includes(testPort)) allowedLoopbackPorts.push(testPort);
    const loopbackRules = allowedLoopbackPorts.flatMap((port) => [
      `(allow network-inbound (local ip "localhost:${port}"))`,
      `(allow network-outbound (remote ip "localhost:${port}"))`,
    ]);
    const runtimeReadRules = nodeRuntimeReadRoots()
      .map((root) => `(subpath ${JSON.stringify(root)})`).join(' ');
    const profile = {
      bin: CheckContainment.SANDBOX_EXEC,
      executable: '/bin/bash',
      root: boundaryRoot,
      writeAuthorities: CheckContainment.resolveWriteAuthorities(
        [boundaryRoot], boundaryRoot, 'check boundary write path'),
      profile: [
        '(version 1)',
        '(deny default)',
        '(allow process*)',
        '(allow signal (target self))',
        '(allow signal (target children))',
        '(allow sysctl-read)',
        '(allow mach-lookup)',
        '(allow ipc-posix-shm)',
        '(allow system-socket)',
        '(allow user-preference-read)',
        '(allow file-read-metadata)',
        '(allow file-read-data (literal "/"))',
        '(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/usr/bin") (subpath "/bin") (subpath "/usr/sbin") (subpath "/sbin") (subpath "/Library/Developer/CommandLineTools") (subpath "/private/var/db/dyld") (subpath "/private/var/db/timezone") (literal "/private/etc/ssl/cert.pem") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))',
        `(allow file-read* (subpath ${JSON.stringify(boundaryRoot)}))`,
        `(allow file-read* ${runtimeReadRules} (literal "/opt/homebrew/etc/openssl@3/openssl.cnf"))`,
        `(deny file-write-mode ${[boundaryRoot, snapshotRoot, home, scratch, bin]
          .map((anchor) => `(literal ${JSON.stringify(anchor)})`).join(' ')})`,
        `(deny file-write-flags ${[boundaryRoot, snapshotRoot, home, scratch, bin]
          .map((anchor) => `(literal ${JSON.stringify(anchor)})`).join(' ')})`,
        `(allow file-write* (subpath ${JSON.stringify(boundaryRoot)}) (literal "/dev/null"))`,
        ...loopbackRules,
      ].join('\n') + '\n',
    };
    if (capture.stateGenerator && capture.statePath) {
      stage = 'dashboard state preflight';
      const generator = path.join(snapshotRoot, capture.stateGenerator);
      const output = path.join(snapshotRoot, capture.statePath);
      const generatedCommand = CheckContainment.sandboxedCommand(
        { ...profile, executable: process.execPath }, [generator, '--out', output]);
      const generated = spawnSync(generatedCommand.bin, generatedCommand.argv, {
        cwd: snapshotRoot, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
      });
      const generatedExit = generated.status === null ? 124 : generated.status;
      if (generated.error || generatedExit !== 0) {
        throw new RunError('STATE_GENERATION_FAILED',
          `canonical dashboard state generation failed${generated.error ? `: ${generated.error.message}` :
            ` (exit ${generatedExit}${generated.signal ? `, signal ${generated.signal}` : ''}${generated.stderr ? `: ${boundedCheckFailureTail(generated.stderr).tail}` : ''})`}`);
      }
      validateGeneratedDashboardState(snapshotRoot, capture.statePath);
      const generatedSubject = runCanonicalEngineeringOs([
        '--subject', '--packet', packetTarget, '--json'], {
        ...env,
        GIT_DIR: path.join(snapshotRoot, '.git'),
        GIT_WORK_TREE: snapshotRoot,
      });
      if (generatedSubject.status !== 0 || !sameCanonicalSubject(capture.subject, generatedSubject.parsed)) {
        throw new RunError('CHECKS-CONTAINMENT-FAILED',
          'dashboard state generation changed the captured exact subject');
      }
    }
    stage = 'contained check execution';
    const contained = CheckContainment.sandboxedCommand(profile, ['-c', cmd]);
    if (networkReservation) {
      networkReservation.release();
      networkReservation = null;
    }
    result = runContainedCheckProcess(contained, snapshotRoot, env);
  } catch (error) {
    if (error && error.checkGroupDrained === false) cleanupSafe = false;
    failure = annotateBoundaryFailure(error, stage);
    if (error && error.checkStdout) failure.checkStdout = error.checkStdout;
    if (error && error.checkStderr) failure.checkStderr = error.checkStderr;
  }
  if (networkReservation) {
    try { networkReservation.release(); }
    catch (error) { failure = annotateBoundaryFailure(error, 'network reservation cleanup', failure); }
  }
  if (boundaryRoot && cleanupSafe) {
    try { removeCheckBoundary(boundaryRoot); }
    catch (error) { failure = annotateBoundaryFailure(error, 'trusted cleanup', failure); }
  } else if (boundaryRoot && !cleanupSafe) {
    failure = annotateBoundaryFailure(
      new RunError('CHECKS-CONTAINMENT-FAILED',
        'trusted cleanup deferred because process-group drainage was not proven'),
      'trusted cleanup', failure);
  }
  if (failure) throw failure;
  return result;
}

function prepareCanonicalDashboardState(run, pkt, packetReal) {
  if (!DASHBOARD_STATE_PACKET_IDS.has(pkt.packetId)) {
    return { ok: true, required: false };
  }
  const expectedPacket = path.join(PACKETS_DIR, `${pkt.packetId}.json`);
  let canonicalPacketReal;
  try { canonicalPacketReal = fs.realpathSync(expectedPacket); }
  catch (e) {
    return { ok: false, code: 'STATE_PACKET_UNAVAILABLE', reason: `canonical dashboard packet is unavailable: ${e.message}` };
  }
  if (packetReal !== canonicalPacketReal) {
    return { ok: false, code: 'STATE_PACKET_INVALID', reason: 'dashboard state preflight requires the canonical active packet file' };
  }

  let env;
  try { env = canonicalGitEnvironment(run); }
  catch (e) {
    return { ok: false, code: 'STATE_WORKTREE_INVALID', reason: e.message };
  }
  const worktreeReal = env.GIT_WORK_TREE;
  const generatorExpected = path.join(worktreeReal, DASHBOARD_STATE_GENERATOR_REL);
  const outputDirExpected = path.dirname(path.join(worktreeReal, DASHBOARD_STATE_OUTPUT_REL));
  const outputExpected = path.join(outputDirExpected, 'state.js');
  let generatorReal;
  let outputDirReal;
  try {
    generatorReal = fs.realpathSync(generatorExpected);
    outputDirReal = fs.realpathSync(outputDirExpected);
  } catch (e) {
    return { ok: false, code: 'STATE_GENERATOR_UNAVAILABLE', reason: `canonical dashboard state path is unavailable: ${e.message}` };
  }
  if (generatorReal !== generatorExpected || !fs.statSync(generatorReal).isFile() ||
      outputDirReal !== outputDirExpected || !outputDirReal.startsWith(worktreeReal + path.sep)) {
    return { ok: false, code: 'STATE_PATH_INVALID', reason: 'dashboard state generator/output path is not the canonical regular-file boundary' };
  }
  if (fs.existsSync(outputExpected)) {
    const existing = fs.lstatSync(outputExpected);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      return { ok: false, code: 'STATE_OUTPUT_INVALID', reason: 'dashboard state output exists but is not a regular file' };
    }
  }

  return { ok: true, required: true, generator: DASHBOARD_STATE_GENERATOR_REL, output: DASHBOARD_STATE_OUTPUT_REL };
}

function buildHostProofContext(preHostReceipt, preHostReceiptRef) {
  if (!validatePreHostCheckReceipt(preHostReceipt) || !preHostReceiptRef ||
      preHostReceiptRef.receiptSha256 !== preHostReceipt.receiptSha256 ||
      !/^LED-CHECK-[0-9a-f]{32}$/.test(preHostReceiptRef.entryId || '')) {
    throw new RunError('HOST-PROOF-CONTEXT-INVALID',
      'post-review host proof requires the validated canonical pre-host receipt and its exact ledger reference');
  }
  const results = new Map(preHostReceipt.results.map((result) => [result.cmd, result]));
  const preHostCommandCoverage = HOST_PRE_HOST_COVERAGE_COMMANDS.map((command) => {
    const result = results.get(command);
    if (!result || result.status !== 'EXECUTED' || result.exit !== 0) {
      throw new RunError('HOST-PROOF-CONTEXT-INVALID',
        `host proof has no exact PRE_HOST PASS command evidence (${command})`);
    }
    return Object.freeze({
      suite: 'pre-host-command', command,
      coverage: 'COVERED_BY_EXACT_PREHOST_COMMAND',
      evidenceSha256: sha256(stableJson(result)),
    });
  });
  const body = {
    schemaVersion: 1,
    contextType: HOST_PROOF_CONTEXT_TYPE,
    boundary: HOST_CONTAINMENT_BOUNDARY,
    subject: preHostReceipt.subject,
    preHostReceipt,
    preHostReceiptRef,
    preHostCommandCoverage,
    fixedProbeNames: [...HOST_FIXED_PROBE_NAMES],
  };
  return Object.freeze({ ...body, contextSha256: sha256(stableJson(body)) });
}

function validateHostProofEvidence(evidence, context) {
  if (!evidence || evidence.schemaVersion !== 1 || evidence.evidenceType !== HOST_PROOF_EVIDENCE_TYPE ||
      evidence.boundary !== HOST_CONTAINMENT_BOUNDARY || evidence.contextSha256 !== context.contextSha256 ||
      evidence.subjectSha256 !== context.subject.subjectSha256 ||
      stableJson(evidence.preHostReceiptRef) !== stableJson(context.preHostReceiptRef) ||
      !Array.isArray(evidence.executedSuites) ||
      stableJson(evidence.executedSuites) !== stableJson(HOST_FIXED_PROBE_NAMES) ||
      stableJson(context.fixedProbeNames) !== stableJson(HOST_FIXED_PROBE_NAMES) ||
      !Array.isArray(evidence.coverage) || !Array.isArray(context.preHostCommandCoverage)) return false;
  const expected = context.preHostCommandCoverage
    .map(({ suite, command, coverage, evidenceSha256 }) => ({
      suite, command, coverage, evidenceSha256,
    }));
  return stableJson(evidence.coverage) === stableJson(expected);
}

function topLevelHostCheckEnvironment(boundaryRoot = null, proof = null) {
  if (!boundaryRoot) {
    return {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: 'en_CA.UTF-8', LC_ALL: 'en_CA.UTF-8',
      USER: 'aegis-host-check', LOGNAME: 'aegis-host-check',
    };
  }
  const home = path.join(boundaryRoot, 'home');
  const scratch = path.join(boundaryRoot, 'tmp');
  const bin = path.join(boundaryRoot, 'bin');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  // The system ps binary is setuid and cannot execute inside sandbox-exec.
  // Reuse the narrow libproc reader already used by immutable check snapshots
  // so public lifecycle controls retain real PID-lifetime evidence.
  writeSnapshotProcessInspector(bin);
  const inspector = path.join(bin, 'ps');
  return {
    HOME: home, TMPDIR: scratch,
    PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    LANG: 'en_CA.UTF-8', LC_ALL: 'en_CA.UTF-8',
    USER: 'aegis-host-check', LOGNAME: 'aegis-host-check',
    AEGIS_HOST_OUTER_CONTAINMENT: HOST_CONTAINMENT_BOUNDARY,
    [TRUSTED_PROCESS_INSPECTOR_ENV]: inspector,
    [TRUSTED_PROCESS_INSPECTOR_SHA_ENV]: sha256(fs.readFileSync(inspector)),
    ...(proof ? {
      AEGIS_HOST_PROOF_CONTEXT: proof.path,
      AEGIS_HOST_PROOF_CONTEXT_SHA256: proof.context.contextSha256,
    } : {}),
  };
}

function outerHostContainmentProfile(boundaryRoot, loopbackPorts = []) {
  const home = path.join(boundaryRoot, 'home');
  const scratch = path.join(boundaryRoot, 'tmp');
  const runtimeReadRules = nodeRuntimeReadRoots()
    .map((root) => `(subpath ${JSON.stringify(root)})`).join(' ');
  const loopbackRules = loopbackPorts.flatMap((port) => [
    `(allow network-inbound (local ip "localhost:${port}"))`,
    `(allow network-outbound (remote ip "localhost:${port}"))`,
  ]);
  return {
    bin: CheckContainment.SANDBOX_EXEC,
    executable: process.execPath,
    root: boundaryRoot,
    writeAuthorities: CheckContainment.resolveWriteAuthorities(
      [home, scratch], boundaryRoot, 'host containment boundary write path'),
    profile: [
      '(version 1)',
      '(deny default)',
      '(allow process*)',
      '(allow signal (target self))',
      '(allow signal (target children))',
      '(allow sysctl-read)',
      '(allow mach-lookup)',
      '(allow ipc-posix-shm)',
      '(allow system-socket)',
      '(allow user-preference-read)',
      '(allow file-read-metadata)',
      '(allow file-read-data (literal "/"))',
      '(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/usr/bin") (subpath "/bin") (subpath "/usr/sbin") (subpath "/sbin") (subpath "/Library/Developer/CommandLineTools") (subpath "/private/var/db/dyld") (subpath "/private/var/db/timezone") (literal "/private/etc/ssl/cert.pem") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))',
      `(allow file-read* (subpath ${JSON.stringify(boundaryRoot)}))`,
      `(allow file-read* ${runtimeReadRules} (literal "/opt/homebrew/etc/openssl@3/openssl.cnf"))`,
      `(allow file-read* (literal ${JSON.stringify(require('./aegis-worker.cjs').CLAUDE_EXECUTABLE)}))`,
      `(deny file-write-mode (literal ${JSON.stringify(boundaryRoot)}))`,
      `(deny file-write-flags (literal ${JSON.stringify(boundaryRoot)}))`,
      `(allow file-write* (subpath ${JSON.stringify(home)}) (subpath ${JSON.stringify(scratch)}) (literal "/dev/null"))`,
      // The authenticated hosting proof receives only supervisor-reserved,
      // exact loopback ports. Ambient and external routes remain denied.
      ...loopbackRules,
    ].join('\n') + '\n',
  };
}

function hostContainmentReceiptBody(run, packetBefore, subjectBefore, command, capture, execution) {
  return {
    schemaVersion: 1,
    authority: HOST_CONTAINMENT_AUTHORITY,
    executionBoundary: HOST_CONTAINMENT_BOUNDARY,
    runId: run.runId,
    packet: { path: packetBefore.path, sha256: packetBefore.sha256 },
    subject: {
      subjectSha256: subjectBefore.subjectSha256,
      subjectPaths: [...subjectBefore.subjectPaths],
      diffBytes: subjectBefore.diffBytes,
      range: subjectBefore.range,
    },
    snapshot: {
      policy: CHECK_SNAPSHOT_POLICY,
      captureSha256: capture.captureSha256,
    },
    command,
    platform: process.platform,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    complete: true,
    outcome: execution.outcome,
    result: execution.result,
    ...(execution.preHostReceiptRef ? { preHostReceiptRef: execution.preHostReceiptRef } : {}),
    ...(execution.coverage ? { coverage: execution.coverage } : {}),
    ...(execution.reason ? { reason: boundedCheckFailureTail(execution.reason).tail } : {}),
  };
}

function establishHostContainmentSnapshot(worktreeReal, capture) {
  const boundaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-host-check-boundary-'));
  try {
    const repositoryRoot = path.join(boundaryRoot, 'repository');
    const snapshotRoot = path.join(boundaryRoot, 'worktree');
    checkedSpawn('create independent host-containment repository', 'git',
      ['clone', '--no-hardlinks', '--no-checkout', '--quiet', worktreeReal, repositoryRoot]);
    checkedSpawn('create independent host-containment worktree', 'git',
      ['-C', repositoryRoot, 'worktree', 'add', '--detach', '--quiet', snapshotRoot, capture.head]);
    checkedSpawn('name captured host-containment worktree', 'git',
      ['-C', snapshotRoot, 'switch', '-c', 'aegis/host-check-snapshot', '--quiet']);
    if (capture.patch) {
      checkedSpawn('apply captured host-containment working-tree bytes', 'git',
        ['-C', snapshotRoot, 'apply', '--index', '--binary', '--whitespace=nowarn', '-'],
        { input: capture.patch });
    }
    writeSupplementalSubjectFiles(snapshotRoot, capture.supplementalSubjectFiles);
    const packetTarget = path.join(snapshotRoot, capture.packetPath);
    fs.mkdirSync(path.dirname(packetTarget), { recursive: true });
    fs.writeFileSync(packetTarget, capture.packetBytes);
    const gitDir = checkedSpawn('resolve host-containment worktree Git directory', 'git',
      ['-C', snapshotRoot, 'rev-parse', '--absolute-git-dir']).stdout.trim();
    const snapshotSubject = runCanonicalEngineeringOs([
      '--subject', '--packet', packetTarget, '--json'], {
      ...topLevelHostCheckEnvironment(),
      GIT_DIR: gitDir,
      GIT_WORK_TREE: snapshotRoot,
    });
    if (snapshotSubject.status !== 0 || !sameCanonicalSubject(capture.subject, snapshotSubject.parsed)) {
      throw new RunError('CHECKS-CONTAINMENT-FAILED',
        'host-containment snapshot does not reproduce the captured canonical subject');
    }
    return Object.freeze({ boundaryRoot, snapshotRoot });
  } catch (error) {
    fs.rmSync(boundaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function runTopLevelHostContainmentCheck(run, worktreeReal, packetBefore, subjectBefore, command, capture, options = {}) {
  const startedAt = nowIso();
  let execution;
  if (options.skipReason) {
    execution = {
      startedAt,
      completedAt: nowIso(),
      outcome: 'FAIL',
      reason: options.skipReason,
      result: {
        status: 'SKIPPED', exit: null, passed: 0, skipped: 1, failed: 0, total: 1,
        groupDrained: false, ownedGroupDrainageProven: false,
        summaryParsed: false, outputBytes: 0, outputSha256: sha256(''), outputTruncated: false,
      },
    };
  } else if (process.platform !== 'darwin') {
    execution = {
      startedAt,
      completedAt: nowIso(),
      outcome: 'FAIL',
      reason: `top-level reviewer containment proof requires darwin, observed ${process.platform}`,
      result: {
        status: 'REFUSED', exit: null, passed: 0, skipped: 0, failed: 1, total: 1,
        groupDrained: false, ownedGroupDrainageProven: false,
        summaryParsed: false, outputBytes: 0, outputSha256: sha256(''), outputTruncated: false,
      },
    };
  } else {
    let snapshot = null;
    let networkReservation = null;
    let result;
    let boundaryFailure = null;
    let proofContext = null;
    let proofEvidence = null;
    try {
      CheckContainment.assertSandboxOperational();
      snapshot = establishHostContainmentSnapshot(worktreeReal, capture);
      if (typeof options.afterSnapshotEstablished === 'function') {
        options.afterSnapshotEstablished(snapshot);
      }
      const script = command.slice('node '.length);
      proofContext = buildHostProofContext(options.preHostReceipt, options.preHostReceiptRef);
      const proofPath = path.join(snapshot.boundaryRoot, 'host-proof-context.json');
      fs.writeFileSync(proofPath, JSON.stringify(proofContext), { mode: 0o400, flag: 'wx' });
      networkReservation = reserveContainedCheckPorts(2);
      const [hostingPort, hostingApiPort] = networkReservation.ports;
      const containedEnv = {
        ...topLevelHostCheckEnvironment(snapshot.boundaryRoot, {
        path: proofPath, context: proofContext,
        }),
        AEGIS_TEST_HOSTING_PORT: String(hostingPort),
        AEGIS_TEST_HOSTING_API_PORT: String(hostingApiPort),
      };
      const profile = outerHostContainmentProfile(snapshot.boundaryRoot,
        [hostingPort, hostingApiPort]);
      const ownedGroupDrainageProven = proveOwnedProcessGroupDrainage(
        profile, snapshot.snapshotRoot, containedEnv);
      if (!ownedGroupDrainageProven) {
        throw new RunError('CHECKS-CONTAINMENT-FAILED',
          'trusted supervisor did not behaviorally prove owned process-group drainage');
      }
      const contained = CheckContainment.sandboxedCommand(profile, [script]);
      networkReservation.release();
      networkReservation = null;
      result = runContainedCheckProcess(contained, snapshot.snapshotRoot, containedEnv);
      result.ownedGroupDrainageProven = true;
    } catch (error) {
      boundaryFailure = error;
      result = { status: null, stdout: '', stderr: '', error };
    } finally {
      if (networkReservation) {
        try { networkReservation.release(); }
        catch (error) { boundaryFailure = boundaryFailure || error; }
      }
      if (snapshot) {
        try { removeCheckBoundary(snapshot.boundaryRoot, 'aegis-host-check-boundary-'); }
        catch (error) { boundaryFailure = boundaryFailure || error; }
      }
    }
    const stdout = String(result.stdout || '');
    const stderr = String(result.stderr || '');
    const output = `${stdout}\n--- STDERR ---\n${stderr}`;
    const outputBytes = Buffer.byteLength(output, 'utf8');
    const outputTruncated = result.outputTruncated === true ||
      Boolean(result.error && result.error.code === 'ENOBUFS') ||
      outputBytes >= HOST_CONTAINMENT_MAX_OUTPUT_BYTES;
    const summaryLines = stdout.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => /^\d+ passed, \d+ skipped, (?:\d+|at least \d+) failed\.$/.test(line));
    const summary = summaryLines.length === 1
      ? /^(\d+) passed, (\d+) skipped, (\d+) failed\.$/.exec(summaryLines[0]) : null;
    const passed = summary ? Number(summary[1]) : 0;
    const skipped = summary ? Number(summary[2]) : 0;
    const failed = summary ? Number(summary[3]) : 1;
    const evidenceLines = stdout.split(/\r?\n/)
      .filter((line) => line.startsWith(HOST_PROOF_EVIDENCE_PREFIX));
    if (evidenceLines.length === 1) {
      try {
        proofEvidence = JSON.parse(Buffer.from(
          evidenceLines[0].slice(HOST_PROOF_EVIDENCE_PREFIX.length), 'base64url').toString('utf8'));
      } catch { proofEvidence = null; }
    }
    const proofValid = Boolean(proofContext && validateHostProofEvidence(proofEvidence, proofContext));
    const covered = proofValid ? proofEvidence.coverage.length : 0;
    const exit = result.status === null ? (result.error && result.error.code === 'ETIMEDOUT' ? 124 : null) : result.status;
    const groupDrained = Boolean(result.executionBoundary &&
      result.executionBoundary.state === 'PASSED' && result.executionBoundary.drained === true);
    const ok = !boundaryFailure && !result.error && exit === 0 && groupDrained && !outputTruncated &&
      summaryLines.length === 1 && Boolean(summary) && proofValid && passed > 0 && skipped === 0 && failed === 0;
    const failureReason = ok ? null : boundedCheckFailureTail([
      boundaryFailure ? boundaryFailure.message : result.error ? result.error.message :
        `host containment suite did not prove a zero-skip pass (exit ${exit === null ? 'unknown' : exit})`,
      stdout,
      stderr,
    ].filter(Boolean).join('\n')).tail;
    execution = {
      startedAt,
      completedAt: nowIso(),
      outcome: ok ? 'PASS' : 'FAIL',
      ...(failureReason ? { reason: failureReason } : {}),
      result: {
        status: 'EXECUTED', exit, passed, covered, skipped, failed, groupDrained,
        ownedGroupDrainageProven: result.ownedGroupDrainageProven === true,
        total: passed + covered + skipped + failed,
        summaryParsed: Boolean(summary) && proofValid, outputBytes,
        outputSha256: sha256(output), outputTruncated,
      },
      ...(proofContext ? { preHostReceiptRef: proofContext.preHostReceiptRef } : {}),
      ...(proofValid ? { coverage: proofEvidence.coverage } : {}),
    };
  }
  const body = hostContainmentReceiptBody(
    run, packetBefore, subjectBefore, command, capture, execution);
  return Object.freeze({ ...body, receiptSha256: hostContainmentReceiptDigest(body) });
}

function runChecksClaimed(run) {
  if (run.state !== 'BUILT') {
    throw new RunError('ILLEGAL-TRANSITION', `checks require BUILT, run is ${run.state}`);
  }
  const packet = resolvePacketOption(run.packet);
  if (!packet) {
    throw new RunError('NO-PACKET', 'the run names no readable packet, so there are no declared testsRequired to run');
  }
  // A check command is executable authority. Resolve its packet through the
  // same canonical packets boundary as intake, then prove the recorded run
  // still names the governed Git worktree/base/branch before reading commands
  // or spawning a shell. Refusal happens before any run or ledger mutation.
  const gitEnv = canonicalGitEnvironment(run);
  const worktreeReal = gitEnv.GIT_WORK_TREE;
  const packetBefore = packetCoordinate(packet);
  const packetReal = packetBefore.real;
  const pkt = packetBefore.parsed;
  const runnableCommands = runnableCheckCommands(pkt);
  const hostCommands = runnableHostContainmentCommands(pkt);
  if (!runnableCommands.length) {
    transition(run, 'CHECKS_FAILED', 'the packet declares no runnable testsRequired');
    throw new RunError('NO-CHECKS', 'the packet declares no runnable checks. Zero checks passing is the absence of evidence, not evidence.');
  }
  const startedAt = nowIso();
  const subjectBeforeResult = runCanonicalEngineeringOs([
    '--subject', '--packet', packetBefore.path, '--json'], gitEnv);
  const subjectBefore = subjectBeforeResult.parsed;
  if (subjectBeforeResult.status !== 0 || !validSubjectCoordinate(subjectBefore)) {
    transition(run, 'CHECKS_FAILED', 'canonical subject was empty, malformed, or unavailable before checks');
    throw new RunError('CHECKS-SUBJECT-INVALID',
      'deterministic checks require a non-empty canonical subject before execution');
  }
  // Narrowing is a subject-derived decision, so the selector may only read a
  // canonical subject this authority already validated. The no-checks refusal
  // above still weighs the packet's full runnable list, and the selector's
  // only inputs are that validated packet and its changed paths.
  const cmds = dashboardSliceCheckCommands(pkt, subjectBefore.changedPaths);
  const statePreparation = prepareCanonicalDashboardState(run, pkt, packetReal);
  if (!statePreparation.ok) {
    const boundaryReason = boundedCheckFailureTail(
      `dashboard state preflight: ${statePreparation.reason}`).tail;
    run.checks = {
      ranAt: nowIso(), total: cmds.length, passed: 0,
      results: cmds.map((cmd) => nonExecutedCheckResult(
        cmd, 'SKIPPED', 'canonical dashboard state generation failed', statePreparation.reason)),
      precondition: {
        state: 'FAILED', code: statePreparation.code,
        reason: statePreparation.reason, exit: Number.isInteger(statePreparation.exit) ? statePreparation.exit : null,
      },
      executionBoundary: {
        policy: CHECK_SNAPSHOT_POLICY, state: 'FAILED', reason: boundaryReason,
      },
    };
    saveRun(run);
    transition(run, 'CHECKS_FAILED', `0/${run.checks.total} checks passed; ${statePreparation.code}`);
    const fresh = loadRun(run.runId);
    return Object.freeze({
      runId: fresh.runId,
      state: fresh.state,
      action: 'checks',
      checks: Object.freeze({ passed: fresh.checks.passed, total: fresh.checks.total }),
      nextAction: 'retry',
    });
  }
  let checkCapture;
  try {
    checkCapture = captureCheckExecutionSource(
      worktreeReal, packetBefore, subjectBefore, statePreparation);
  } catch (error) {
    const failure = checkSnapshotFailure(error && error.message ? error.message : error);
    run.checks = {
      ranAt: nowIso(), total: cmds.length, passed: 0,
      results: cmds.map((cmd) => ({
        ...nonExecutedCheckResult(cmd, 'REFUSED', 'immutable check snapshot unavailable',
          error && error.message ? error.message : error),
        failureEvidence: failure,
        executionEvidence: failure,
      })),
      integrity: {
        state: 'FAILED',
        gaps: ['immutable check execution boundary could not be established'],
      },
      executionBoundary: {
        policy: CHECK_SNAPSHOT_POLICY,
        state: 'FAILED',
        reason: boundedCheckFailureTail(error && error.message ? error.message : error).tail,
      },
    };
    saveRun(run);
    transition(run, 'CHECKS_FAILED', '0 checks ran; immutable check execution boundary unavailable');
    const fresh = loadRun(run.runId);
    return Object.freeze({
      runId: fresh.runId,
      state: fresh.state,
      action: 'checks',
      checks: Object.freeze({ passed: fresh.checks.passed, total: fresh.checks.total }),
      nextAction: 'retry',
    });
  }
  const results = [];
  const boundaryFailures = [];
  for (const cmd of cmds) {
    const ranAt = nowIso();
    if (boundaryFailures.length) {
      results.push({
        ...nonExecutedCheckResult(cmd, 'SKIPPED',
          'an earlier check lost its execution boundary', boundaryFailures[0]),
        ranAt,
      });
      continue;
    }
    let r;
    let executionStatus = 'EXECUTED';
    try {
      r = executeCheckInSnapshot(cmd, worktreeReal, checkCapture);
      if (r.error) executionStatus = 'REFUSED';
    } catch (error) {
      executionStatus = 'REFUSED';
      r = {
        status: null,
        stdout: error && error.checkStdout ? error.checkStdout : '',
        stderr: error && error.checkStderr ? error.checkStderr : '',
        error,
      };
    }
    if (r.error && r.error.executionBoundaryFailure) {
      boundaryFailures.push(r.error.executionBoundaryFailure.reason);
    }
    const preconditionFailure = statePreparation.required && r.error &&
      ['STATE_GENERATION_FAILED', 'STATE_OUTPUT_INVALID'].includes(r.error.code);
    const exit = preconditionFailure ? null
      : executionStatus === 'REFUSED' ? 125 : (r.status === null ? 124 : r.status);
    const result = { cmd, exit, ranAt, status: executionStatus };
    result.executionEvidence = checkExecutionEvidence(
      r.stdout, r.error ? `${r.stderr || ''}\n${r.error.message || ''}` : r.stderr);
    if (preconditionFailure) {
      result.skipped = 'canonical dashboard state generation failed';
      result.preconditionFailure = {
        code: r.error.code,
        reason: boundedCheckFailureTail(r.error.message || r.error).tail,
      };
    } else if (exit !== 0 || r.error) {
      result.failureEvidence = result.executionEvidence;
    }
    results.push(result);
  }
  const snapshotCommandsPassed = boundaryFailures.length === 0 &&
    results.every((result) => result.status === 'EXECUTED' && result.exit === 0 && !result.preconditionFailure);
  const completedAt = nowIso();
  const coordinateGaps = [];
  let packetStable = false;
  try {
    const packetAfter = packetCoordinate(packet);
    packetStable = packetBefore.path === packetAfter.path && packetBefore.sha256 === packetAfter.sha256;
  } catch (error) {
    coordinateGaps.push(`post-check packet coordinate unavailable: ${boundedCheckFailureTail(error && error.message ? error.message : error).tail}`);
  }
  let subjectStable = false;
  try {
    const subjectAfterResult = runCanonicalEngineeringOs([
      '--subject', '--packet', packetBefore.path, '--json'], gitEnv);
    subjectStable = subjectAfterResult.status === 0 && sameCanonicalSubject(subjectBefore, subjectAfterResult.parsed);
    if (subjectAfterResult.status !== 0) coordinateGaps.push(`post-check subject authority exited ${subjectAfterResult.status}`);
  } catch (error) {
    coordinateGaps.push(`post-check subject coordinate unavailable: ${boundedCheckFailureTail(error && error.message ? error.message : error).tail}`);
  }
  const stateFailure = results.find((result) => result.preconditionFailure);
  const statePreconditionPassed = !statePreparation.required || !stateFailure;
  const executionBoundaryPassed = boundaryFailures.length === 0;
  const commandsPassed = statePreconditionPassed && executionBoundaryPassed &&
    results.every((x) => x.status === 'EXECUTED' && x.exit === 0);
  const snapshotPassed = commandsPassed && subjectStable && packetStable;
  const commonReceiptBody = {
    schemaVersion: 1,
    authority: 'aegis-run.cjs runChecks',
    runId: run.runId,
    packet: { path: packetBefore.path, sha256: packetBefore.sha256 },
    subject: {
      subjectSha256: subjectBefore.subjectSha256,
      subjectPaths: [...subjectBefore.subjectPaths],
      diffBytes: subjectBefore.diffBytes,
      range: subjectBefore.range,
    },
    startedAt,
    completedAt,
    complete: true,
    total: results.length,
    passed: results.filter((x) => x.exit === 0).length,
    results: results.map((r) => ({ cmd: r.cmd, status: r.status, exit: r.exit, ranAt: r.ranAt })),
  };
  let receipt = null;
  let receiptRef = null;
  let preHostReceipt = null;
  let preHostReceiptRef = null;
  let hostContainment = null;
  let hostContainmentState = null;
  if (hostCommands.length && snapshotPassed) {
    const preHostBody = {
      ...commonReceiptBody,
      receiptType: PRE_HOST_CHECK_RECEIPT_TYPE,
      snapshot: { policy: CHECK_SNAPSHOT_POLICY, captureSha256: checkCapture.captureSha256 },
      outcome: 'PASS',
      hostContainment: { state: 'PENDING', commands: [...hostCommands] },
    };
    preHostReceipt = { ...preHostBody, receiptSha256: checkReceiptDigest(preHostBody) };
    preHostReceiptRef = persistCanonicalPreHostCheckReceipt(run, preHostReceipt);
    hostContainmentState = 'PENDING';
  } else {
    if (hostCommands.length) {
      hostContainment = runTopLevelHostContainmentCheck(
        run, worktreeReal, packetBefore, subjectBefore, hostCommands[0], checkCapture,
        { skipReason: 'immutable packet checks did not all pass or their exact coordinate moved' });
      hostContainmentState = 'FAILED';
    }
    const receiptBody = {
      ...commonReceiptBody,
      outcome: snapshotPassed && hostCommands.length === 0 ? 'PASS' : 'FAIL',
      ...(hostContainment ? { hostContainment } : {}),
    };
    receipt = { ...receiptBody, receiptSha256: checkReceiptDigest(receiptBody) };
    receiptRef = persistCanonicalCheckReceipt(run, receipt);
    if (hostCommands.length === 0) hostContainmentState = null;
  }
  run.checks = {
    ranAt: completedAt, total: results.length, passed: results.filter((x) => x.exit === 0).length, results,
    ...(receiptRef ? { receiptRef } : {}),
    ...(preHostReceiptRef ? { preHostReceiptRef } : {}),
    integrity: {
      state: subjectStable && packetStable ? 'PASSED' : 'FAILED',
      gaps: [
        ...(!subjectStable ? ['canonical subject changed during checks'] : []),
        ...(!packetStable ? ['packet changed during checks'] : []),
        ...coordinateGaps,
      ],
    },
    executionBoundary: executionBoundaryPassed
      ? { policy: CHECK_SNAPSHOT_POLICY, state: 'PASSED' }
      : {
          policy: CHECK_SNAPSHOT_POLICY,
          state: 'FAILED',
          reason: boundedCheckFailureTail([...new Set(boundaryFailures)].join('; ')).tail,
        },
    ...(hostContainmentState === 'PENDING' ? { hostContainment: {
      state: 'PENDING', executionBoundary: HOST_CONTAINMENT_BOUNDARY,
      command: hostCommands[0], passed: 0, skipped: 0, failed: 0,
      reason: 'awaiting exact-subject independent review before host execution',
    } } : hostContainment ? { hostContainment: {
      state: 'FAILED', executionBoundary: hostContainment.executionBoundary,
      platform: hostContainment.platform, command: hostContainment.command,
      passed: hostContainment.result.passed, skipped: hostContainment.result.skipped,
      covered: hostContainment.result.covered || 0,
      failed: hostContainment.result.failed, receiptSha256: hostContainment.receiptSha256,
      ...(hostContainment.reason ? { reason: hostContainment.reason } : {}),
    } } : {}),
    ...(statePreparation.required ? { precondition: stateFailure ? {
      state: 'FAILED', code: stateFailure.preconditionFailure.code,
      reason: stateFailure.preconditionFailure.reason,
    } : {
      state: 'PASSED', generator: statePreparation.generator, output: statePreparation.output,
    } } : {}),
  };
  // A prior review refusal belongs to the earlier checked subject. Preserve
  // its minimized audit record in reviewFailures, but stop presenting it as
  // the active refusal once a new deterministic receipt has been produced.
  run.reviewFailure = null;
  saveRun(run);
  const readyForReview = hostCommands.length
    ? snapshotPassed && validatePreHostCheckReceipt(preHostReceipt, {
      runId: run.runId, packetPath: packetBefore.path, packetSha256: packetBefore.sha256,
      subject: subjectBefore, commands: cmds, hostCommands, captureSha256: checkCapture.captureSha256,
    })
    : snapshotPassed && validateCheckReceipt(receipt, {
      runId: run.runId, packetPath: packetBefore.path, packetSha256: packetBefore.sha256,
      subject: subjectBefore, commands: cmds, hostCommands,
    });
  transition(run, readyForReview ? 'CHECKS_PASSED' : 'CHECKS_FAILED',
    `${run.checks.passed}/${run.checks.total} snapshot checks passed` +
      `${hostCommands.length ? `; host containment ${readyForReview ? 'pending review' : 'not run'}` : ''}` +
      `${subjectStable && packetStable ? '' : '; integrity moved'}`);
  const fresh = loadRun(run.runId);
  return Object.freeze({
    runId: fresh.runId,
    state: fresh.state,
    action: 'checks',
    checks: Object.freeze({ passed: fresh.checks.passed, total: fresh.checks.total }),
    nextAction: readyForReview ? 'independent review required' : 'retry',
  });
}

function runChecks(runId) {
  // Preserve stable malformed/missing id errors before attempting a claim.
  loadRunForControl(runId);
  let claim;
  try { claim = acquireRunLaunchClaim(runId, 3000); }
  catch (e) {
    if (e instanceof RunError) {
      if (e.code === 'BAD-RUN-ID') throw new AegisControlError('INVALID_RUN_ID', e.message, 400);
      if (e.code === 'NO-SUCH-RUN') throw new AegisControlError('RUN_NOT_FOUND', e.message, 404);
    }
    throw e;
  }
  try {
    const run = loadRunForControl(runId);
    try { return runChecksClaimed(run); }
    catch (e) {
      if (e instanceof RunError) {
        if (e.code === 'ILLEGAL-TRANSITION') {
          throw new AegisControlError('INVALID_CHECKS', e.message, 409);
        }
        if (e.code === 'NO-PACKET') {
          throw new AegisControlError('CHECKS_UNAVAILABLE', e.message, 409);
        }
        if (e.code === 'NO-CHECKS') {
          throw new AegisControlError('NO_CHECKS', e.message, 409);
        }
        if (e.code === 'CHECKS-SUBJECT-INVALID') {
          throw new AegisControlError('CHECKS_SUBJECT_INVALID', e.message, 409);
        }
        if (e.code === 'REVIEW-RUN-INVALID' || e.code === 'REVIEW-WORKTREE-INVALID' ||
            e.code === 'REVIEW-WORKTREE-FOREIGN') {
          throw new AegisControlError('CHECKS_WORKTREE_INVALID', e.message, 409);
        }
      }
      throw e;
    }
  } finally { releaseRunLaunchClaim(claim); }
}

// ── automatic focused dashboard checks ─────────────────────────────────────
// One narrow automation and nothing wider: a dashboard-created run that
// reaches BUILT with a canonical subject confined to the dashboard slice may
// have its already-proven focused check pair executed without an operator
// click. Every other run keeps the manual control-surface path exactly as it
// is, and the full packet is never started automatically.
//
// This is an ELIGIBILITY authority, not a second check authority. It selects
// no command, transitions no state, and writes no evidence. Execution goes
// through runChecks() — the one canonical executor — which takes the same
// per-run claim as the operator button and re-derives the narrowed list from
// the canonical subject itself. Eligibility is a refusal-shaped decision: if
// anything is missing, moved, unreadable, or wider than the dashboard slice,
// the answer is "not eligible" and the run simply stays manual.
function automaticDashboardChecksEligibility(runId) {
  const ineligible = (reason, state = null) =>
    Object.freeze({ eligible: false, runId, state, reason });
  let run;
  try { run = loadRun(runId); }
  catch (error) {
    return ineligible(`the canonical run record is unavailable: ${error.message}`);
  }
  // The eligibility marker is server-owned and recorded once at objective
  // intake; no request body can set it. A CLI run, or any run created without
  // it, is never touched here.
  if (run.automaticChecks !== true) {
    return ineligible('the run is not marked automatic-checks eligible', run.state);
  }
  if (run.state !== 'BUILT') {
    return ineligible(`automatic checks require BUILT, run is ${run.state}`, run.state);
  }
  let packetBefore;
  let gitEnv;
  try {
    const packet = resolvePacketOption(run.packet);
    if (!packet) return ineligible('the run names no readable packet', run.state);
    packetBefore = packetCoordinate(packet);
    gitEnv = canonicalGitEnvironment(run);
  } catch (error) {
    return ineligible(`the packet or worktree could not be proven: ${error.message}`, run.state);
  }
  let subjectResult;
  try {
    subjectResult = runCanonicalEngineeringOs(
      ['--subject', '--packet', packetBefore.path, '--json'], gitEnv);
  } catch (error) {
    return ineligible(`the canonical subject authority was unavailable: ${error.message}`, run.state);
  }
  const subject = subjectResult.parsed;
  if (subjectResult.status !== 0 || !validSubjectCoordinate(subject)) {
    return ineligible('the canonical subject was empty, malformed, or unavailable', run.state);
  }
  const changedPaths = subject.changedPaths;
  if (!Array.isArray(changedPaths) || changedPaths.length === 0 ||
      !changedPaths.every((p) => typeof p === 'string' && DASHBOARD_SLICE_PATHS.includes(p))) {
    return ineligible('the canonical changed paths are not confined to the dashboard slice', run.state);
  }
  // The decisive guard against ever auto-running the packet: the fixed-policy
  // selector must ALREADY reduce this subject to exactly the proven focused
  // pair. A packet that would fall back to its full list is ineligible rather
  // than narrowed here, because narrowing is not this function's authority.
  const commands = dashboardSliceCheckCommands(packetBefore.parsed, changedPaths);
  const selected = new Set(commands);
  if (commands.length !== DASHBOARD_SLICE_CHECKS.length ||
      selected.size !== DASHBOARD_SLICE_CHECKS.length ||
      !DASHBOARD_SLICE_CHECKS.every((command) => selected.has(command))) {
    return ineligible('the canonical selection is not the proven focused dashboard pair', run.state);
  }
  return Object.freeze({
    eligible: true, runId, state: run.state, commands: Object.freeze([...commands]),
  });
}

function runAutomaticDashboardChecks(runId) {
  const eligibility = automaticDashboardChecksEligibility(runId);
  if (!eligibility.eligible) {
    return Object.freeze({
      runId, action: 'automatic-checks', ran: false,
      state: eligibility.state, reason: eligibility.reason,
    });
  }
  const checks = runChecks(runId);
  return Object.freeze({
    runId, action: 'automatic-checks', ran: true, commands: eligibility.commands,
    state: checks.state, checks: checks.checks, nextAction: checks.nextAction,
  });
}

// ── step 7: exact-subject independent review binding ───────────────────────
// The runtime deliberately does not interpret review records.  The canonical
// Engineering OS computes the subject and applies the review gate; this layer
// only binds that decision to the claimed run after proving that the run's
// linked worktree belongs to this repository.  GIT_DIR/GIT_WORK_TREE redirect
// Git reads to the run worktree without executing a copy of engineering-os.cjs
// from code that is itself under review.
function canonicalGitEnvironment(run) {
  const worktreePath = run && run.worktree && run.worktree.path;
  if (typeof worktreePath !== 'string' || !worktreePath.trim()) {
    throw new RunError('REVIEW-WORKTREE-INVALID', 'review binding requires a recorded worktree path');
  }
  let worktreeReal;
  try {
    worktreeReal = fs.realpathSync(worktreePath);
    if (!fs.statSync(worktreeReal).isDirectory()) throw new Error('not a directory');
  } catch (e) {
    throw new RunError('REVIEW-WORKTREE-INVALID', `run worktree is unavailable: ${e.message}`);
  }

  const inspect = (args, label) => {
    const r = git(['-C', worktreeReal, ...args]);
    if (r.status !== 0) {
      throw new RunError('REVIEW-WORKTREE-INVALID',
        `cannot prove run worktree ${label}: ${(r.stderr || r.stdout || `git exited ${r.status}`).trim()}`);
    }
    return (r.stdout || '').trim();
  };
  let topReal;
  try { topReal = fs.realpathSync(inspect(['rev-parse', '--show-toplevel'], 'top level')); }
  catch (e) {
    if (e instanceof RunError) throw e;
    throw new RunError('REVIEW-WORKTREE-INVALID', `cannot resolve run worktree top level: ${e.message}`);
  }
  if (topReal !== worktreeReal) {
    throw new RunError('REVIEW-WORKTREE-FOREIGN',
      `recorded worktree is not its Git top level (${worktreeReal} != ${topReal})`);
  }
  let runtimeRootReal;
  try { runtimeRootReal = fs.realpathSync(ROOT); }
  catch (e) {
    throw new RunError('REVIEW-WORKTREE-INVALID', `cannot resolve the control runtime checkout: ${e.message}`);
  }
  if (worktreeReal === runtimeRootReal) {
    throw new RunError('REVIEW-WORKTREE-INVALID',
      'the control runtime checkout is not a governed run worktree');
  }

  const commonFor = (cwd) => {
    const r = git(['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (r.status !== 0) {
      throw new RunError('REVIEW-WORKTREE-INVALID',
        `cannot prove repository authority: ${(r.stderr || r.stdout || `git exited ${r.status}`).trim()}`);
    }
    try { return fs.realpathSync((r.stdout || '').trim()); }
    catch (e) { throw new RunError('REVIEW-WORKTREE-INVALID', `cannot resolve repository authority: ${e.message}`); }
  };
  if (commonFor(worktreeReal) !== commonFor(ROOT)) {
    throw new RunError('REVIEW-WORKTREE-FOREIGN', 'run worktree belongs to a different Git repository');
  }

  const gitDir = inspect(['rev-parse', '--absolute-git-dir'], 'git directory');
  inspect(['rev-parse', '--verify', 'HEAD^{commit}'], 'HEAD commit');
  const recordedBase = run && run.baseCommit;
  const worktreeBase = run && run.worktree && run.worktree.baseCommit;
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(recordedBase || '') ||
      worktreeBase !== recordedBase) {
    throw new RunError('REVIEW-RUN-INVALID', 'run and worktree do not carry one matching canonical base commit');
  }
  inspect(['cat-file', '-e', `${recordedBase}^{commit}`], 'base commit');
  const recordedBranch = run && run.worktree && run.worktree.branch;
  const currentBranch = inspect(['symbolic-ref', '--quiet', '--short', 'HEAD'], 'branch');
  if (typeof recordedBranch !== 'string' || !recordedBranch || currentBranch !== recordedBranch) {
    throw new RunError('REVIEW-RUN-INVALID',
      `run worktree branch moved or is not the recorded branch (${recordedBranch || 'missing'} != ${currentBranch || 'detached'})`);
  }
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('GIT_') || key === 'NODE_OPTIONS' || key === 'NODE_PATH' ||
        key === 'ENGOS_TEST_ONLY_SYNTHETIC') continue;
    env[key] = value;
  }
  env.GIT_DIR = gitDir;
  env.GIT_WORK_TREE = worktreeReal;
  return env;
}

// One read of the canonical authority. `parseable` is reported rather than
// thrown on, because engineering-os has one command — --start — whose refusal
// is deliberately printed as prose with a hard-block exit rather than JSON.
// For every other caller an unparseable answer is still an error; that is
// runCanonicalEngineeringOs below, whose behaviour is unchanged.
function readCanonicalEngineeringOs(args, env) {
  const r = spawnSync(process.execPath, [ENGOS, ...args], {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
  });
  if (r.error) {
    throw new RunError('REVIEW-AUTHORITY-UNAVAILABLE', `engineering-os.cjs could not run: ${r.error.message}`);
  }
  let parsed = null;
  let parseable = true;
  try { parsed = JSON.parse((r.stdout || '').trim()); }
  catch { parseable = false; }
  return { status: r.status === null ? 124 : r.status, parsed, parseable, stdout: r.stdout || '' };
}

function runCanonicalEngineeringOs(args, env) {
  const r = readCanonicalEngineeringOs(args, env);
  if (!r.parseable) {
    throw new RunError('REVIEW-AUTHORITY-UNAVAILABLE',
      `engineering-os.cjs returned no parseable JSON${r.status === 0 ? '' : ` (exit ${r.status})`}`);
  }
  return { status: r.status, parsed: r.parsed };
}

function validPassedChecks(checks, expected = {}) {
  const receipt = loadCanonicalCheckReceipt(checks, expected);
  return Boolean(checks && Number.isInteger(checks.total) && checks.total > 0 &&
    checks.passed === checks.total && Array.isArray(checks.results) &&
    checks.results.length === checks.total &&
    checks.results.every((result) => result && typeof result.cmd === 'string' &&
      result.cmd.trim() && result.exit === 0) &&
    typeof checks.ranAt === 'string' && Number.isFinite(Date.parse(checks.ranAt)) &&
    receipt && receipt.outcome === 'PASS');
}

function sameCanonicalSubject(a, b) {
  return Boolean(a && b && /^[0-9a-f]{64}$/.test(a.subjectSha256 || '') &&
    a.subjectSha256 === b.subjectSha256 &&
    JSON.stringify(a.subjectPaths) === JSON.stringify(b.subjectPaths) &&
    a.diffBytes === b.diffBytes && a.range === b.range);
}

function sameSubjectContent(a, b) {
  return Boolean(validSubjectCoordinate(a) && validSubjectCoordinate(b) &&
    a.subjectSha256 === b.subjectSha256 &&
    JSON.stringify(a.subjectPaths) === JSON.stringify(b.subjectPaths) &&
    a.diffBytes === b.diffBytes);
}

const REVIEW_REFUSAL_RULES = new Set([
  'ENGOS-REVIEW-REJECTED',
  'ENGOS-OPEN-BLOCKING-FINDING',
]);

function attributableReviewRefusal(gate, subject) {
  if (!gate || gate.ok !== false || gate.state !== 'BLOCKED' ||
      !gate.subject || !sameCanonicalSubject(subject, gate.subject) ||
      !Array.isArray(gate.problems) || !gate.reviewerCompleteness ||
      gate.reviewerCompleteness.subjectSha256 !== subject.subjectSha256 ||
      gate.reviewerCompleteness.complete !== true ||
      !Array.isArray(gate.reviewerCompleteness.rows)) return null;

  const completeness = gate.reviewerCompleteness;
  const uncovered = completeness.pathCoverage &&
    completeness.pathCoverage.notCoveredByEveryRequiredReviewer;
  const requiredRows = completeness.rows.filter((row) => row && row.required === 'REQUIRED');
  if (!Array.isArray(uncovered) || uncovered.length !== 0 || requiredRows.length === 0 ||
      requiredRows.some((row) => row.executed !== 'EXECUTED' ||
        typeof row.reviewer !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(row.reviewer) ||
        typeof row.reviewId !== 'string' || !/^REV-[A-Za-z0-9._-]{1,127}$/.test(row.reviewId) ||
        (Array.isArray(row.missingPaths) && row.missingPaths.length !== 0) ||
        (Array.isArray(row.stalePaths) && row.stalePaths.length !== 0))) return null;

  const refusalProblems = gate.problems.filter((problem) => problem &&
    REVIEW_REFUSAL_RULES.has(problem.rule));
  if (refusalProblems.length === 0) return null;
  const openBlockingReviewers = new Set();
  for (const problem of refusalProblems) {
    if (problem.rule !== 'ENGOS-OPEN-BLOCKING-FINDING') continue;
    const match = /^(?:CRITICAL|HIGH) from ([a-z0-9][a-z0-9._-]{0,63}) in /i.exec(
      String(problem.detail || ''));
    if (!match) return null;
    openBlockingReviewers.add(match[1].toLowerCase());
  }

  // Identities still come only from exact-subject completeness rows. The
  // canonical gate's bounded "SEVERITY from reviewer in path" prefix is used
  // solely to correlate an OPEN blocker with that row; arbitrary prose after
  // the path is never persisted.
  const rejectedReviewers = gate.reviewerCompleteness.rows.flatMap((row) => {
    // `rejectedReviewers` is the established minimized projection field. For
    // an OPEN CRITICAL/HIGH finding the canonical gate has refused the exact
    // subject even when the record's overall disposition was not REJECT, so
    // retain the executed record identity without inventing a disposition.
    if (!row || row.executed !== 'EXECUTED' ||
        (row.disposition !== 'REJECT' &&
          !openBlockingReviewers.has(String(row.reviewer || '').toLowerCase())) ||
        typeof row.reviewer !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(row.reviewer) ||
        typeof row.reviewId !== 'string' || !/^REV-[A-Za-z0-9._-]{1,127}$/.test(row.reviewId)) return [];
    return [{ reviewer: row.reviewer, reviewId: row.reviewId }];
  });
  if (rejectedReviewers.length === 0) return null;

  return {
    rejectedReviewers,
    blockingFindingCount: refusalProblems.filter((problem) =>
      problem.rule === 'ENGOS-OPEN-BLOCKING-FINDING').length,
    refusalRuleCount: refusalProblems.length,
  };
}

function recordReviewFailure(run, subject, packetNow, refusal, checkReceipt) {
  const refusedAt = nowIso();
  const failure = {
    schemaVersion: 1,
    status: 'REFUSED',
    reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
    subjectSha256: subject.subjectSha256,
    checkReceiptSha256: checkReceipt.receiptSha256,
    packet: { path: packetNow.path, sha256: packetNow.sha256 },
    refusedAt,
    authority: 'engineering-os.cjs --gate-done',
    rejectedReviewers: refusal.rejectedReviewers,
    blockingFindingCount: refusal.blockingFindingCount,
    refusalRuleCount: refusal.refusalRuleCount,
    summary: refusal.blockingFindingCount > 0
      ? `Independent review found ${refusal.blockingFindingCount} blocking issue(s) on this exact checked version.`
      : 'An independent reviewer rejected this exact checked version.',
  };
  run.reviewFailure = failure;
  run.reviewFailures = [...(Array.isArray(run.reviewFailures) ? run.reviewFailures : []), failure]
    .slice(-(MAX_CORRECTIONS + 1));
  transition(run, 'REVIEW_FAILED',
    `canonical exact-subject review refused ${subject.subjectSha256.slice(0, 16)}…`);
  return Object.freeze({
    runId: run.runId,
    state: 'REVIEW_FAILED',
    action: 'bind-independent-review',
    outcome: 'REFUSED',
    reasonCode: failure.reasonCode,
    nextAction: 'retry',
  });
}

function finalizeReviewedHostContainment(run, packetNow, subject, commands, hostCommands,
    preHostReceipt, worktreeReal, gitEnv) {
  const statePreparation = prepareCanonicalDashboardState(run, packetNow.parsed, packetNow.real);
  if (!statePreparation.ok) {
    throw new RunError('REVIEW-CHECKS-STALE',
      `host containment preflight no longer matches the checked subject: ${statePreparation.reason}`);
  }
  const capture = captureCheckExecutionSource(
    worktreeReal, packetNow, subject, statePreparation);
  if (capture.captureSha256 !== preHostReceipt.snapshot.captureSha256) {
    throw new RunError('REVIEW-CHECKS-STALE',
      'the exact source capture changed after snapshot checks and before host containment');
  }

  // This is deliberately after the canonical exact-subject review gate. The
  // host suite is subject-controlled code and therefore must never execute on
  // the operator host merely because snapshot checks passed.
  const hostContainment = runTopLevelHostContainmentCheck(
    run, worktreeReal, packetNow, subject, hostCommands[0], capture, {
      preHostReceipt,
      preHostReceiptRef: run.checks.preHostReceiptRef,
    });
  let packetStable = false;
  let subjectStable = false;
  try {
    const packetAfter = packetCoordinate(packetNow.path);
    packetStable = packetAfter.path === packetNow.path && packetAfter.sha256 === packetNow.sha256;
  } catch { packetStable = false; }
  try {
    const subjectAfter = runCanonicalEngineeringOs([
      '--subject', '--packet', packetNow.path, '--json'], gitEnv);
    subjectStable = subjectAfter.status === 0 && sameCanonicalSubject(subject, subjectAfter.parsed);
  } catch { subjectStable = false; }
  const hostPassed = packetStable && subjectStable && validateHostContainmentReceipt(hostContainment, {
    runId: run.runId, packetPath: packetNow.path, packetSha256: packetNow.sha256,
    subject, command: hostCommands[0], platform: 'darwin',
    preHostReceiptRef: run.checks.preHostReceiptRef,
  });
  const completedAt = nowIso();
  const finalBody = {
    schemaVersion: 1,
    authority: 'aegis-run.cjs runChecks',
    runId: run.runId,
    packet: { path: packetNow.path, sha256: packetNow.sha256 },
    subject: {
      subjectSha256: subject.subjectSha256, subjectPaths: [...subject.subjectPaths],
      diffBytes: subject.diffBytes, range: subject.range,
    },
    startedAt: preHostReceipt.startedAt,
    completedAt,
    complete: true,
    outcome: hostPassed ? 'PASS' : 'FAIL',
    total: preHostReceipt.total,
    passed: preHostReceipt.passed,
    results: preHostReceipt.results.map((result) => ({ ...result })),
    hostContainment,
  };
  const finalReceipt = { ...finalBody, receiptSha256: checkReceiptDigest(finalBody) };
  const receiptRef = persistCanonicalCheckReceipt(run, finalReceipt);
  run.checks = {
    ...run.checks,
    ranAt: completedAt,
    receiptRef,
    integrity: {
      state: packetStable && subjectStable ? 'PASSED' : 'FAILED',
      gaps: [
        ...(!subjectStable ? ['canonical subject changed during host containment'] : []),
        ...(!packetStable ? ['packet changed during host containment'] : []),
      ],
    },
    hostContainment: {
      state: hostPassed ? 'PASSED' : 'FAILED',
      executionBoundary: hostContainment.executionBoundary,
      platform: hostContainment.platform,
      command: hostContainment.command,
      passed: hostContainment.result.passed,
      covered: hostContainment.result.covered || 0,
      skipped: hostContainment.result.skipped,
      failed: hostContainment.result.failed,
      receiptSha256: hostContainment.receiptSha256,
      ...(hostContainment.reason ? { reason: hostContainment.reason } : {}),
    },
  };
  saveRun(run);
  if (!hostPassed || !validateCheckReceipt(finalReceipt, {
    runId: run.runId, packetPath: packetNow.path, packetSha256: packetNow.sha256,
    subject, commands, hostCommands,
  })) {
    transition(run, 'CHECKS_FAILED',
      'post-review host containment did not prove a zero-skip exact-subject pass');
    return Object.freeze({ ok: false, receipt: finalReceipt });
  }
  return Object.freeze({ ok: true, receipt: finalReceipt });
}

function checkpointCandidateProblem(candidate) {
  if (!candidate || candidate.clean !== true) return 'CHECKPOINT-DIRTY-TREE';
  if (!Object.prototype.hasOwnProperty.call(candidate, 'reviewedBase')) return null;
  if (!/^[0-9a-f]{40,64}$/.test(candidate.reviewedBase || '') ||
      !/^[0-9a-f]{40,64}$/.test(candidate.head || '') ||
      candidate.reviewedBase === candidate.head || candidate.ancestor !== true) {
    return 'CHECKPOINT-HEAD-UNRELATED';
  }
  if (!Object.prototype.hasOwnProperty.call(candidate, 'committedSubject')) return null;
  if (!sameSubjectContent(candidate.reviewedSubject, candidate.committedSubject) ||
      candidate.committedSubject.range !== `${candidate.reviewedBase}..${candidate.head}`) {
    return 'CHECKPOINT-SUBJECT-MISMATCH';
  }
  return null;
}

// ── one coordinate authority for independent review ─────────────────────────
// Binding and the read-only preflight below must be talking about the SAME
// packet, the SAME exact subject and the SAME canonical receipt. If each
// derived its own plausible-looking set, the dashboard could describe a review
// of one version of the code while binding a review of another — which is the
// exact recycling failure the subject hash exists to prevent.
//
// This validates and returns coordinates. It persists nothing, transitions
// nothing, and takes no claim; every caller-visible refusal is a RunError.
function canonicalReviewCoordinates(run) {
  if (!run.checks || !Number.isInteger(run.checks.total) || run.checks.total <= 0 ||
      run.checks.passed !== run.checks.total || !Array.isArray(run.checks.results) ||
      run.checks.results.length !== run.checks.total ||
      !run.checks.results.every((result) => result && typeof result.cmd === 'string' &&
        result.cmd.trim() && result.exit === 0) ||
      (!run.checks.receiptRef && !run.checks.preHostReceiptRef)) {
    throw new RunError('REVIEW-CHECKS-INVALID',
      'run has no complete, real all-passed deterministic snapshot-check record');
  }
  const locallyAuthenticatedFinalReceipt = validPassedChecks(run.checks, { runId: run.runId });
  const locallyAuthenticatedPreHostReceipt = loadCanonicalPreHostCheckReceipt(
    run.checks, { runId: run.runId });
  if (!locallyAuthenticatedFinalReceipt && !locallyAuthenticatedPreHostReceipt) {
    throw new RunError('REVIEW-CHECKS-INVALID',
      'run check projection does not resolve to canonical append-only check evidence');
  }
  const packet = resolvePacketOption(run.packet);
  if (!packet) throw new RunError('REVIEW-PACKET-INVALID', 'review binding requires the packet already bound to the run');
  const env = canonicalGitEnvironment(run);
  const packetNow = packetCoordinate(packet);
  const commands = runnableCheckCommands(packetNow.parsed);
  const hostCommands = runnableHostContainmentCommands(packetNow.parsed);

  const first = runCanonicalEngineeringOs([
    '--subject', '--packet', packetNow.path, '--json'], env);
  const subject = first.parsed;
  if (first.status !== 0 || !/^[0-9a-f]{64}$/.test(subject.subjectSha256 || '') ||
      !Array.isArray(subject.subjectPaths) || subject.subjectPaths.length === 0 ||
      !Number.isInteger(subject.diffBytes) || subject.diffBytes <= 0) {
    throw new RunError('REVIEW-SUBJECT-INVALID', 'canonical subject is empty, malformed, or unavailable');
  }
  const checkReceipt = loadCanonicalCheckReceipt(run.checks, {
    runId: run.runId, packetPath: packetNow.path, packetSha256: packetNow.sha256,
    subject, commands, hostCommands,
  });
  const preHostReceipt = hostCommands.length ? loadCanonicalPreHostCheckReceipt(run.checks, {
    runId: run.runId, packetPath: packetNow.path, packetSha256: packetNow.sha256,
    subject, commands, hostCommands,
  }) : null;
  if (!checkReceipt && !preHostReceipt) {
    throw new RunError('REVIEW-CHECKS-STALE',
      'deterministic check evidence is missing, partial, stale, or bound to a different packet or subject');
  }
  return { packet, env, packetNow, commands, hostCommands, subject, checkReceipt, preHostReceipt };
}

// ── canonical review-cycle authority (read-only) ────────────────────────────
// The bounded review cycle — D-19's three-round ceiling and D-14's "it does not
// attempt one more pass" — is enforced by engineering-os --start, not by
// --gate-done. The gate answers "which required reviewer has no record bound to
// this exact subject"; it never answers "is another review round allowed at
// all". An exhausted packet still produces a gate full of ENGOS-REVIEW-MISSING
// rows, so a preflight that reads only the gate will name reviewers and call it
// permitted work — which is the fourth round D-14 exists to stop.
//
// This introduces NO second counter. The rounds are the review records already
// on disk and --start is their one reader; this asks that same authority about
// the SAME packet and the SAME subject the gate was asked about, and takes its
// verdict and its allowedReviewers as given.
const ENGOS_HARD_BLOCK = 3;

// --start prints this banner on stdout, and only this banner, when the cycle
// itself stops the round. Exit 3 alone does not mean that: every PolicyError
// fails closed on the same exit code and prints to stderr instead.
const ENGOS_CYCLE_STOP_BANNER = /^ENGINEERING OS — REVIEW CYCLE (COMPLETE|HARD STOP)$/m;

function canonicalReviewCycleVerdict(packetPath, packetId, subject, env) {
  const named = (name) => typeof name === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name);
  const unreadable = (message) => ({ refusal: { code: 'REVIEW-CYCLE-UNREADABLE', message } });
  let answer;
  try { answer = readCanonicalEngineeringOs(['--start', '--packet', packetPath, '--json'], env); }
  catch (e) {
    if (!(e instanceof RunError)) throw e;
    return { refusal: { code: e.code, message: e.message } };
  }

  // --start hard-blocks and prints prose instead of JSON when no further round
  // may start. That is the authority answering, not a malfunction, and the
  // answer is STOP. It is deliberately not read back out of that prose beyond
  // its banner: the only thing a preflight needs from it is that no reviewer
  // may be named. A bare exit 3 with no banner is a policy failure, not a
  // verdict, and is reported as unreadable rather than as an exhausted cycle.
  if (!answer.parseable) {
    if (answer.status === ENGOS_HARD_BLOCK && ENGOS_CYCLE_STOP_BANNER.test(answer.stdout)) {
      return { stopped: true };
    }
    return unreadable(
      `the canonical review-cycle authority returned no readable verdict (exit ${answer.status})`);
  }
  const cycle = answer.parsed && typeof answer.parsed === 'object' ? answer.parsed.reviewCycle : null;
  if (answer.status !== 0 || !cycle || typeof cycle !== 'object') {
    return unreadable(
      `the canonical review-cycle authority named no review cycle for this packet (exit ${answer.status})`);
  }
  if (!sameCanonicalSubject(subject, answer.parsed.subject)) {
    return { refusal: { code: 'REVIEW-SUBJECT-MOVED',
      message: 'the canonical subject changed between reading the review gate and the review cycle' } };
  }
  if (typeof cycle.packetId !== 'string' || cycle.packetId !== packetId) {
    return unreadable('the canonical review cycle is bound to a different packet than the run');
  }
  if (!Number.isInteger(cycle.roundCount) || !Number.isInteger(cycle.maxRounds) ||
      !Number.isInteger(cycle.roundsRemaining) || typeof cycle.verdict !== 'string' || !cycle.verdict) {
    return unreadable('the canonical review cycle reported no readable round budget');
  }
  const budget = {
    packetId: cycle.packetId,
    roundCount: cycle.roundCount,
    maxRounds: cycle.maxRounds,
    roundsRemaining: cycle.roundsRemaining,
    verdict: cycle.verdict,
  };
  // COMPLETE_GATE and HALT_ESCALATE both mean "do not start another round".
  // Only PROCEED authorises naming a reviewer.
  if (cycle.verdict !== 'PROCEED') return { stopped: true, cycle: Object.freeze(budget) };
  if (!Array.isArray(cycle.allowedReviewers) || !cycle.allowedReviewers.every(named)) {
    return unreadable('the canonical review cycle named no readable set of allowed reviewers');
  }
  return { cycle: Object.freeze({ ...budget,
    allowedReviewers: Object.freeze(cycle.allowedReviewers.slice(0, 16)) }) };
}

// ── read-only independent-review preflight ──────────────────────────────────
// The operator surface needs one honest answer to "what review action is
// permitted on this run right now", and it needs it BEFORE anything is
// launched. Previously the only way to find out was to attempt the binding
// itself, which is a decision, not a question.
//
// This asks the question and nothing else. It takes no claim, writes no run
// file, appends no ledger entry, rewrites no receipt, executes no check and
// starts no reviewer. REVIEW_PERMITTED means a review of this exact subject
// MAY now be run — never that one has been run, and never that binding has
// happened. Binding remains a separate decision with its own evidence.
//
// It reads two canonical authorities, both read-only queries that binding
// already makes: the subject and the gate. It fabricates neither.
const REVIEW_PREFLIGHT_ACTION = 'prepare-independent-review';
const REVIEW_PREFLIGHT_AUTHORITY = 'aegis-run.cjs prepareIndependentReview (read-only)';

// Gate rules that a NEW exact-subject review can actually clear. Anything else
// blocking the gate — an invalid packet, unauthorized paths, an unpinned spec,
// a malformed record, a self-verified fix — is not review work, and naming a
// reviewer for it would be inventing a task that cannot succeed.
const REVIEW_PENDING_RULES = new Set([
  'ENGOS-REVIEW-MISSING',
  'ENGOS-REVIEWER-UNAVAILABLE',
  'ENGOS-REVIEW-COVERAGE-SHORT',
  'ENGOS-REVIEW-COVERAGE-EXTRA',
]);

// Which required reviewers still owe an exact-subject review, taken from the
// canonical completeness rows rather than re-derived. Returns null when the
// completeness record cannot be read as a list of named required reviewers:
// an unreadable answer is reported as a refusal, never smoothed into an empty
// or guessed set of pending work.
function pendingRequiredReviewers(completeness) {
  const named = (name) => typeof name === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name);
  const rows = Array.isArray(completeness && completeness.rows) ? completeness.rows : null;
  if (rows && rows.length) {
    const requiredRows = rows.filter((row) => row && row.required === 'REQUIRED');
    if (requiredRows.length === 0 || !requiredRows.every((row) => named(row.reviewer))) return null;
    return requiredRows
      .filter((row) => row.executed !== 'EXECUTED' ||
        (Array.isArray(row.missingPaths) && row.missingPaths.length !== 0) ||
        (Array.isArray(row.stalePaths) && row.stalePaths.length !== 0))
      .map((row) => Object.freeze({
        reviewer: row.reviewer,
        executed: typeof row.executed === 'string' ? row.executed : 'UNKNOWN',
        coverage: row.executed === 'EXECUTED' ? 'INCOMPLETE' : 'NONE',
      }));
  }
  const missing = Array.isArray(completeness && completeness.missing) ? completeness.missing : null;
  if (!missing || missing.length === 0 || !missing.every(named)) return null;
  return missing.map((reviewer) => Object.freeze({
    reviewer, executed: 'MISSING', coverage: 'NONE',
  }));
}

function reviewPreflightAnswer(run, fields) {
  return Object.freeze({
    runId: run.runId,
    state: run.state,
    action: REVIEW_PREFLIGHT_ACTION,
    authority: REVIEW_PREFLIGHT_AUTHORITY,
    mutations: 'NONE',
    pendingReviewers: Object.freeze([]),
    ...fields,
  });
}

function reviewPreflightRefusal(run, reasonCode, summary, fields = {}) {
  return reviewPreflightAnswer(run, {
    status: 'REFUSED', reasonCode, summary, nextAction: 'none', ...fields,
  });
}

function prepareIndependentReview(runId) {
  const run = loadRunForControl(runId);

  if (run.state !== 'CHECKS_PASSED') {
    return reviewPreflightRefusal(run, 'REVIEW-WRONG-STATE',
      `review binding requires CHECKS_PASSED, run is ${run.state}`);
  }

  let coordinates;
  try { coordinates = canonicalReviewCoordinates(run); }
  catch (e) {
    if (!(e instanceof RunError)) throw e;
    return reviewPreflightRefusal(run, e.code, e.message);
  }
  const { env, packetNow, subject, checkReceipt, preHostReceipt } = coordinates;
  const evidence = checkReceipt || preHostReceipt;
  const coordinateFields = {
    packet: Object.freeze({ path: packetNow.path, sha256: packetNow.sha256 }),
    subject: Object.freeze({
      subjectSha256: subject.subjectSha256,
      subjectPaths: Object.freeze(subject.subjectPaths.slice()),
      diffBytes: subject.diffBytes,
      range: subject.range,
    }),
    evidence: Object.freeze({
      source: checkReceipt ? 'CANONICAL_CHECK_RECEIPT' : 'CANONICAL_PRE_HOST_CHECK_RECEIPT',
      receiptSha256: evidence.receiptSha256,
      // A pre-host receipt is real evidence, but the top-level host containment
      // suite has not run yet. Binding is what executes it; say so rather than
      // letting a preflight read as if containment were already proven.
      hostContainment: checkReceipt ? 'BOUND' : 'PENDING_AT_BINDING',
    }),
  };

  let gateResult;
  try {
    gateResult = runCanonicalEngineeringOs([
      '--gate-done', '--packet', path.resolve(ROOT, coordinates.packet),
      '--subject-sha', subject.subjectSha256, '--json',
    ], env);
  } catch (e) {
    if (!(e instanceof RunError)) throw e;
    return reviewPreflightRefusal(run, e.code, e.message, coordinateFields);
  }
  const gate = gateResult.parsed;
  const completeness = gate && gate.reviewerCompleteness;
  if (!gate || !gate.subject || !sameCanonicalSubject(subject, gate.subject)) {
    return reviewPreflightRefusal(run, 'REVIEW-SUBJECT-MOVED',
      'the canonical subject changed between resolving it and reading the review gate',
      coordinateFields);
  }
  const classification = (gate.classification && typeof gate.classification === 'object')
    ? gate.classification : {};
  const laneFields = {
    lane: classification.lane || null,
    requiredReviewers: Object.freeze(Array.isArray(classification.requiredReviewers)
      ? classification.requiredReviewers.slice(0, 16) : []),
  };
  if (!completeness) {
    return reviewPreflightRefusal(run, 'REVIEW-COMPLETENESS-UNREADABLE',
      'the canonical review gate returned no reviewer completeness for this exact subject',
      { ...coordinateFields, ...laneFields });
  }

  // Exactly the condition binding requires, read as a question instead of a
  // decision. Review coverage being complete does not bind anything: the run is
  // still CHECKS_PASSED and binding remains a separate action with its own
  // subject recomputation and its own evidence.
  const coverage = completeness.pathCoverage;
  if (gateResult.status === 0 && gate.ok === true &&
      Array.isArray(gate.problems) && gate.problems.length === 0 &&
      completeness.complete === true && coverage &&
      Array.isArray(coverage.notCoveredByEveryRequiredReviewer) &&
      coverage.notCoveredByEveryRequiredReviewer.length === 0) {
    return reviewPreflightAnswer(run, {
      status: 'NO_ADDITIONAL_REVIEW_NEEDED',
      reasonCode: 'EXACT_SUBJECT_REVIEW_COMPLETE',
      summary: 'Every required reviewer has an exact-subject review covering the whole subject. ' +
        'No additional review is needed. Nothing is bound: binding is a separate action.',
      ...coordinateFields,
      ...laneFields,
      nextAction: 'bind-independent-review',
    });
  }

  // An exhausted review cycle is not pending work. Once the bounded ceiling of
  // exact-subject review refusals has been recorded, another review round is an
  // escalation decision, and reporting reviewers as "pending" here would dress
  // that escalation up as ordinary remaining work. It is read AFTER the gate,
  // not before it: those refusals are history, and history does not override a
  // gate that is complete on the subject as it stands now — binding accepts
  // that same run, so refusing it here would be a false refusal.
  const reviewFailures = Array.isArray(run.reviewFailures) ? run.reviewFailures : [];
  const corrections = Number.isInteger(run.corrections) ? run.corrections : 0;
  if (reviewFailures.length >= MAX_CORRECTIONS) {
    return reviewPreflightRefusal(run, 'REVIEW-CYCLE-EXHAUSTED',
      `${reviewFailures.length} exact-subject review refusal(s) are already recorded against the ` +
      `${MAX_CORRECTIONS}-cycle ceiling; a further review round is an escalation, not remaining work.`, {
        ...coordinateFields,
        ...laneFields,
        nextAction: 'escalate',
        reviewCycles: Object.freeze({
          recordedReviewFailures: reviewFailures.length, corrections, ceiling: MAX_CORRECTIONS,
        }),
      });
  }

  if (gateResult.status !== EXIT_REFUSED || gate.ok !== false || gate.state !== 'BLOCKED' ||
      !Array.isArray(gate.problems) || gate.problems.length === 0) {
    return reviewPreflightRefusal(run, 'REVIEW-GATE-UNREADABLE',
      `the canonical review gate returned neither a clean pass nor a readable block (exit ${gateResult.status})`,
      { ...coordinateFields, ...laneFields });
  }

  // A recorded rejection of this exact subject is not missing review work.
  const refusal = attributableReviewRefusal(gate, subject);
  if (refusal) {
    return reviewPreflightRefusal(run, 'EXACT_SUBJECT_REVIEW_REFUSED',
      refusal.blockingFindingCount > 0
        ? `Independent review found ${refusal.blockingFindingCount} blocking issue(s) on this exact checked version.`
        : 'An independent reviewer rejected this exact checked version.', {
        ...coordinateFields,
        ...laneFields,
        nextAction: 'retry',
        rejectedReviewers: Object.freeze(refusal.rejectedReviewers.map((row) => Object.freeze({ ...row }))),
        blockingFindingCount: refusal.blockingFindingCount,
      });
  }

  const blockingRules = gate.problems.map((problem) => problem && problem.rule);
  const unnamedRule = blockingRules.some((rule) => typeof rule !== 'string' || !rule);
  const outsideReviewWork = [...new Set(blockingRules.filter((rule) =>
    typeof rule === 'string' && rule && !REVIEW_PENDING_RULES.has(rule)))];
  if (unnamedRule || outsideReviewWork.length) {
    return reviewPreflightRefusal(run, 'REVIEW-GATE-BLOCKED',
      `the canonical gate is blocked by ${outsideReviewWork.join(', ') || 'an unnamed rule'}, ` +
      'which no additional independent review can clear',
      { ...coordinateFields, ...laneFields });
  }

  const pending = pendingRequiredReviewers(completeness);
  if (!pending || pending.length === 0) {
    return reviewPreflightRefusal(run, 'REVIEW-COMPLETENESS-UNREADABLE',
      'the canonical gate reports outstanding review work but names no required reviewer that could do it',
      { ...coordinateFields, ...laneFields });
  }

  // The gate names who owes an exact-subject review. It never answers whether
  // another review round may start at all — that is the canonical review cycle,
  // asked here about the SAME packet and the SAME subject the gate was asked
  // about. No reviewer is reported as permitted unless it says so.
  const packetId = packetNow.parsed && typeof packetNow.parsed.packetId === 'string'
    ? packetNow.parsed.packetId : '';
  if (!packetId) {
    return reviewPreflightRefusal(run, 'REVIEW-PACKET-INVALID',
      'the packet bound to the run names no packetId, so its review cycle cannot be read',
      { ...coordinateFields, ...laneFields });
  }
  const cycleAnswer = canonicalReviewCycleVerdict(
    path.resolve(ROOT, coordinates.packet), packetId, subject, env);
  const cycleFields = cycleAnswer.cycle ? {
    reviewCycle: Object.freeze({
      packetId: cycleAnswer.cycle.packetId,
      roundCount: cycleAnswer.cycle.roundCount,
      maxRounds: cycleAnswer.cycle.maxRounds,
      roundsRemaining: cycleAnswer.cycle.roundsRemaining,
      verdict: cycleAnswer.cycle.verdict,
    }),
  } : {};
  if (cycleAnswer.refusal) {
    return reviewPreflightRefusal(run, cycleAnswer.refusal.code, cycleAnswer.refusal.message,
      { ...coordinateFields, ...laneFields, ...cycleFields });
  }
  if (cycleAnswer.stopped) {
    return reviewPreflightRefusal(run, 'REVIEW-CYCLE-EXHAUSTED',
      'the canonical review cycle for this packet permits no further review round; ' +
      'a further round is an escalation, not remaining work.',
      { ...coordinateFields, ...laneFields, ...cycleFields, nextAction: 'escalate' });
  }

  // Owing a review and being allowed to run one are two different facts. Report
  // only the intersection, and refuse rather than name a reviewer the cycle
  // authority did not permit.
  const allowedReviewers = new Set(cycleAnswer.cycle.allowedReviewers);
  const permitted = pending.filter((row) => allowedReviewers.has(row.reviewer));
  if (permitted.length === 0) {
    return reviewPreflightRefusal(run, 'REVIEW-CYCLE-NO-PERMITTED-REVIEWER',
      'the canonical gate reports outstanding review work, but the canonical review cycle ' +
      'permits no reviewer to run it against this subject.',
      { ...coordinateFields, ...laneFields, ...cycleFields });
  }

  return reviewPreflightAnswer(run, {
    status: 'REVIEW_PERMITTED',
    reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
    summary: `${permitted.map((row) => row.reviewer).join(' and ')} still owe an exact-subject review ` +
      `of ${subject.subjectSha256.slice(0, 16)}… over ${subject.subjectPaths.length} path(s). ` +
      'Nothing has been launched by this preflight.',
    ...coordinateFields,
    ...laneFields,
    ...cycleFields,
    pendingReviewers: Object.freeze(permitted),
    nextAction: 'independent-review',
  });
}

function bindIndependentReviewClaimed(run) {
  if (run.state !== 'CHECKS_PASSED') {
    throw new RunError('ILLEGAL-TRANSITION', `review binding requires CHECKS_PASSED, run is ${run.state}`);
  }
  const coordinates = canonicalReviewCoordinates(run);
  const { packet, env, packetNow, commands, hostCommands, subject, preHostReceipt } = coordinates;
  let checkReceipt = coordinates.checkReceipt;

  const gateResult = runCanonicalEngineeringOs([
    '--gate-done', '--packet', path.resolve(ROOT, packet),
    '--subject-sha', subject.subjectSha256, '--json',
  ], env);
  const gate = gateResult.parsed;
  const completeness = gate && gate.reviewerCompleteness;
  if (gateResult.status !== 0 || gate.ok !== true || !completeness || completeness.complete !== true ||
      !Array.isArray(gate.problems) || gate.problems.length !== 0 ||
      !gate.subject || !sameCanonicalSubject(subject, gate.subject) ||
      !completeness.pathCoverage ||
      !Array.isArray(completeness.pathCoverage.notCoveredByEveryRequiredReviewer) ||
      completeness.pathCoverage.notCoveredByEveryRequiredReviewer.length !== 0) {
    const refusal = gateResult.status === EXIT_REFUSED
      ? attributableReviewRefusal(gate, subject) : null;
    if (refusal) {
      const refusalSubject = runCanonicalEngineeringOs([
        '--subject', '--packet', packetNow.path, '--json'], env);
      if (refusalSubject.status !== 0 || !sameCanonicalSubject(subject, refusalSubject.parsed)) {
        throw new RunError('REVIEW-SUBJECT-MOVED',
          'the canonical subject changed while its review refusal was being attributed');
      }
      return recordReviewFailure(run, subject, packetNow, refusal, checkReceipt || preHostReceipt);
    }
    const rules = Array.isArray(gate && gate.problems)
      ? gate.problems.map((problem) => problem && problem.rule).filter(Boolean).join(', ')
      : '';
    throw new RunError('REVIEW-GATE-REFUSED',
      `canonical exact-subject review gate did not pass${rules ? `: ${rules}` : ''}`);
  }

  // The subject is recomputed after the gate and immediately before the sole
  // persistence point.  A moving tree can neither borrow nor retain approval.
  const secondResult = runCanonicalEngineeringOs([
    '--subject', '--packet', packetNow.path, '--json'], env);
  if (secondResult.status !== 0 || !sameCanonicalSubject(subject, secondResult.parsed)) {
    throw new RunError('REVIEW-SUBJECT-MOVED', 'the canonical subject changed while its reviews were being bound');
  }

  if (!checkReceipt) {
    const finalized = finalizeReviewedHostContainment(
      run, packetNow, subject, commands, hostCommands, preHostReceipt,
      env.GIT_WORK_TREE, env);
    if (!finalized.ok) {
      const fresh = loadRun(run.runId);
      return Object.freeze({
        runId: fresh.runId, state: fresh.state, action: 'bind-independent-review',
        outcome: 'HOST_CONTAINMENT_FAILED', reasonCode: 'HOST_CONTAINMENT_FAILED',
        nextAction: 'retry',
      });
    }
    checkReceipt = finalized.receipt;
  }

  const boundAt = nowIso();
  const headCommit = (git(['-C', env.GIT_WORK_TREE, 'rev-parse', 'HEAD']).stdout || '').trim();
  if (!/^[0-9a-f]{40,64}$/.test(headCommit)) {
    throw new RunError('REVIEW-RUN-INVALID', 'the reviewed worktree has no canonical HEAD commit');
  }
  run.subject = {
    subjectSha256: subject.subjectSha256,
    pathCount: subject.subjectPaths.length,
    diffBytes: subject.diffBytes,
    range: subject.range,
    boundAt,
    authority: 'engineering-os.cjs --subject',
  };
  const classification = gate.classification || {};
  const coverage = completeness.pathCoverage;
  run.reviewGate = {
    subjectSha256: subject.subjectSha256,
    verifiedAt: boundAt,
    authority: 'engineering-os.cjs --gate-done',
    packet: { path: packetNow.path, sha256: packetNow.sha256 },
    checkReceiptSha256: checkReceipt.receiptSha256,
    headCommit,
    state: gate.state,
    lane: classification.lane || null,
    requiredReviewers: Array.isArray(classification.requiredReviewers)
      ? classification.requiredReviewers.slice(0, 16) : [],
    activeReviews: Number.isInteger(gate.reviewsActive) ? gate.reviewsActive : 0,
    exactSubjectReviews: Number.isInteger(gate.reviewsBound) ? gate.reviewsBound : 0,
    ignoredForeignReviews: Number.isInteger(gate.reviewsForeign) ? gate.reviewsForeign : 0,
    pathCoverage: {
      total: Number.isInteger(coverage.total) ? coverage.total : subject.subjectPaths.length,
      coveredByEveryRequiredReviewer: Array.isArray(coverage.coveredByEveryRequiredReviewer)
        ? coverage.coveredByEveryRequiredReviewer.length : 0,
      notCoveredByEveryRequiredReviewer: 0,
    },
  };
  transition(run, 'REVIEW_BOUND',
    `canonical exact-subject review gate passed for ${subject.subjectSha256.slice(0, 16)}…`);
  const fresh = loadRun(run.runId);
  return Object.freeze({
    runId: fresh.runId,
    state: fresh.state,
    action: 'bind-independent-review',
    subjectSha256: fresh.subject.subjectSha256,
    nextAction: 'checkpoint',
  });
}

function bindIndependentReview(runId) {
  loadRunForControl(runId);
  const claim = acquireRunLaunchClaim(runId, 3000);
  try {
    const run = loadRunForControl(runId);
    try { return bindIndependentReviewClaimed(run); }
    catch (e) {
      if (e instanceof RunError) {
        const status = e.code === 'REVIEW-AUTHORITY-UNAVAILABLE' ? 503 : 409;
        throw new AegisControlError(e.code, e.message, status);
      }
      throw e;
    }
  } finally { releaseRunLaunchClaim(claim); }
}

function cmdChecks(args) {
  let result;
  try { result = runChecks(args.runId); }
  catch (e) {
    if (e instanceof AegisControlError) {
      const cliCode = {
        INVALID_RUN_ID: 'BAD-RUN-ID', RUN_NOT_FOUND: 'NO-SUCH-RUN',
        INVALID_CHECKS: 'ILLEGAL-TRANSITION', CHECKS_UNAVAILABLE: 'NO-PACKET',
        NO_CHECKS: 'NO-CHECKS',
        CHECKS_SUBJECT_INVALID: 'CHECKS-SUBJECT-INVALID',
      }[e.code] || e.code;
      throw new RunError(cliCode, e.message);
    }
    throw e;
  }
  console.log(`${result.checks.passed}/${result.checks.total} checks passed`);
  return result.state === 'CHECKS_PASSED' ? EXIT_PASS : EXIT_REFUSED;
}

// ── step 8: automatic bounded correction cycles ─────────────────────────────
// The contract says corrections are bounded and rechecked. "Bounded" was
// enforced only as a refusal when someone happened to try a fourth build. This
// drives the loop: build, check, and on failure enter CORRECTING and rebuild —
// up to MAX_CORRECTIONS, then STOP and escalate.
//
// The cap is the point. Reviewers and builders will optimise against each other
// indefinitely if allowed to, and the failure mode is not a crash: it is quiet,
// expensive, converging on nothing.
function cmdAuto(args) {
  if (!args.cmd) throw new RunError('NO-COMMAND', '--cmd is required');
  const history = [];

  for (let cycle = 0; ; cycle++) {
    let run = loadRun(args.runId);
    if (run.state === 'BUILD_FAILED' || run.state === 'CHECKS_FAILED' || run.state === 'REVIEW_FAILED') {
      const claim = acquireRunLaunchClaim(args.runId, 3000);
      try {
        run = loadRun(args.runId);
        if (!['BUILD_FAILED', 'CHECKS_FAILED', 'REVIEW_FAILED'].includes(run.state)) continue;
        if (run.corrections >= MAX_CORRECTIONS) {
          transition(run, 'ABANDONED', `escalating after ${run.corrections} correction cycles`);
          console.error(
            `\nESCALATION REQUIRED — ${run.corrections} correction cycles did not resolve.\n` +
            'Stopping rather than looping. The Product Owner decides what happens next; ' +
            'a fourth attempt is a fourth guess, not a fix.');
          return EXIT_REFUSED;
        }
        run.corrections += 1;
        transition(run, 'CORRECTING', `correction cycle ${run.corrections} of ${MAX_CORRECTIONS}`);
      } finally {
        releaseRunLaunchClaim(claim);
      }
    }

    const b = cmdBuild({ ...args, runId: args.runId });
    run = loadRun(args.runId);
    history.push({ cycle, phase: 'build', state: run.state });
    if (b !== EXIT_PASS) { if (run.corrections >= MAX_CORRECTIONS) continue; else continue; }

    let c;
    try { c = cmdChecks({ runId: args.runId }); }
    catch (e) { if (e instanceof RunError) { c = EXIT_REFUSED; } else throw e; }
    run = loadRun(args.runId);
    history.push({ cycle, phase: 'checks', state: run.state });
    if (c === EXIT_PASS) {
      console.log(`\nconverged after ${run.corrections} correction cycle(s)`);
      return EXIT_PASS;
    }
  }
}

// ── step 9: watchdog — prove the policy sequence actually happened ───────────
// The watchdog does not judge code. It reads the transitions this run actually
// recorded and refuses if a required stage never occurred or occurred out of
// order. Process drift is exactly this: reaching a late state without passing
// through an earlier one, which no single stage can detect on its own.
const REQUIRED_SEQUENCE = [
  'INTAKE_RECORDED', 'ROUTED', 'WORKTREE_READY', 'BUILDING', 'BUILT', 'CHECKS_PASSED',
];

function watchdog(run) {
  const reached = (run.transitions || []).map((t) => t.to);
  const problems = [];
  const ledgerCorroboratedIndexes = new Set();
  let cursor = -1;
  for (const stage of REQUIRED_SEQUENCE) {
    const at = reached.indexOf(stage, cursor + 1);
    if (at === -1) {
      const anywhere = reached.indexOf(stage);
      if (anywhere !== -1) {
        problems.push({ rule: 'WATCHDOG-OUT-OF-ORDER', detail: `${stage} occurred before a stage that must precede it` });
      } else {
        problems.push({ rule: 'WATCHDOG-STAGE-MISSING', detail: `required stage ${stage} never occurred in this run` });
      }
    } else {
      cursor = at;
    }
  }
  // Every transition must also be present in the CANONICAL ledger. A run file
  // claiming a stage the ledger never recorded is a run file that was edited.
  // The watchdog must read the SAME ledger the writer wrote to. It previously
  // hardcoded builder-control/ledger.json while transitions honoured
  // AEGIS_LEDGER_FILE, so a run recorded to a temp ledger looked entirely
  // unrecorded — the verifier and the writer were pointed at different files,
  // which is the one thing a cross-check must never do.
  const ledgerFile = process.env.AEGIS_LEDGER_FILE
    ? path.resolve(process.env.AEGIS_LEDGER_FILE)
    : path.join(HERE, 'ledger.json');
  let ledger = [];
  try { ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')); } catch { /* absent */ }
  for (const [index, t] of (run.transitions || []).entries()) {
    const op = typeof t.operationId === 'string' && t.operationId
      ? t.operationId : `${run.runId}:${t.from}->${t.to}`;
    const matches = ledger.filter((entry) => entry && entry.correlationId === run.runId &&
      entry.operationId === op && entry.entryId === t.ledgerEntryId);
    if (matches.length !== 1) {
      problems.push({
        rule: 'WATCHDOG-UNRECORDED-TRANSITION',
        detail: `the run claims ${t.from} -> ${t.to} at ${t.ledgerEntryId || 'an unnamed entry'} ` +
          'but the canonical ledger does not contain that one exact transition entry. The run file is not evidence; the ledger is.',
      });
    } else {
      ledgerCorroboratedIndexes.add(index);
    }
  }

  // Publish only the longest correctly ordered prefix whose individual
  // transitions are each present exactly once in the canonical ledger. This
  // lets the dashboard show truthful in-progress state without requiring the
  // entire future sequence to have completed, while preventing mutable run
  // JSON from lighting a lifecycle stage by itself.
  const corroboratedStages = [];
  let corroboratedCursor = -1;
  for (const stage of REQUIRED_SEQUENCE) {
    const at = reached.indexOf(stage, corroboratedCursor + 1);
    if (at === -1 || !ledgerCorroboratedIndexes.has(at)) break;
    corroboratedStages.push(stage);
    corroboratedCursor = at;
  }
  const checkReceipt = corroboratedStages.includes('CHECKS_PASSED')
    ? loadCanonicalCheckReceipt(run.checks, { runId: run.runId }) : null;
  const preHostReceipt = corroboratedStages.includes('CHECKS_PASSED') && !checkReceipt
    ? loadCanonicalPreHostCheckReceipt(run.checks, { runId: run.runId }) : null;
  const checkReceiptValid = Boolean(
    (checkReceipt && checkReceipt.outcome === 'PASS') ||
    (preHostReceipt && preHostReceipt.outcome === 'PASS' &&
      preHostReceipt.hostContainment && preHostReceipt.hostContainment.state === 'PENDING'));
  const checkReceiptStage = checkReceiptValid
    ? (checkReceipt ? 'COMPLETE' : 'PRE_HOST') : null;
  const hostContainmentState = checkReceipt
    ? (checkReceipt.hostContainment && checkReceipt.hostContainment.outcome === 'PASS' ? 'PASSED' : null)
    : (preHostReceipt ? 'PENDING' : null);

  return {
    ok: problems.length === 0,
    problems,
    reached,
    required: REQUIRED_SEQUENCE,
    corroboratedStages,
    checkReceiptValid,
    checkReceiptStage,
    hostContainmentState,
  };
}

function cmdWatchdog(args) {
  const run = loadRun(args.runId);
  const w = watchdog(run);
  if (args.json) { console.log(JSON.stringify(w, null, 2)); return w.ok ? EXIT_PASS : EXIT_REFUSED; }
  console.log(`WATCHDOG — ${run.runId}`);
  console.log(`  required sequence: ${w.required.join(' -> ')}`);
  console.log(`  actually reached : ${w.reached.join(' -> ') || 'nothing'}`);
  if (w.ok) { console.log('\n  PROCESS SEQUENCE PROVEN'); return EXIT_PASS; }
  console.log('\n  PROCESS DRIFT DETECTED');
  for (const p of w.problems) { console.log(`    ${p.rule}`); console.log(`      ${p.detail}`); }
  return EXIT_REFUSED;
}

// ── step 10: checkpoint + rollback ──────────────────────────────────────────
function cmdCheckpointClaimed(run, args) {
  // The guard used to also accept CHECKS_PASSED, which contradicted the
  // transition table (CHECKS_PASSED -> CHECKPOINTED is not legal) and would have
  // let a checkpoint skip step 7 entirely. The table is right: review binds
  // before a known-good point is recorded, or the point is "known good" only to
  // the builder that produced it.
  if (run.state !== 'REVIEW_BOUND') {
    throw new RunError('ILLEGAL-TRANSITION',
      `checkpoint requires REVIEW_BOUND, run is ${run.state}. A checkpoint before independent review records a point only the builder believes in.`);
  }
  if (!validPassedChecks(run.checks, { runId: run.runId })) {
    throw new RunError('NO-PASSING-CHECKS',
      'a checkpoint requires deterministic checks that actually ran and passed. A known-good point that was never known to be good is a label, not a checkpoint.');
  }
  // Step 9 gates step 10: a checkpoint over a run that skipped a required stage
  // records a known-good point that was never known to be good.
  const w = watchdog(run);
  if (!w.ok) {
    throw new RunError('WATCHDOG-REFUSED',
      `the watchdog refuses this checkpoint: ${w.problems.map((p) => p.rule).join(', ')}. ` +
      w.problems[0].detail);
  }

  const env = canonicalGitEnvironment(run);
  const packet = resolvePacketOption(run.packet);
  if (!packet) throw new RunError('CHECKPOINT-EVIDENCE-INVALID', 'checkpoint packet is unavailable');
  const packetNow = packetCoordinate(packet);
  const receipt = loadCanonicalCheckReceipt(run.checks, {
    runId: run.runId, packetPath: packetNow.path, packetSha256: packetNow.sha256,
    commands: runnableCheckCommands(packetNow.parsed),
    hostCommands: runnableHostContainmentCommands(packetNow.parsed),
  });
  if (!receipt || !run.reviewGate || run.reviewGate.subjectSha256 !== receipt.subject.subjectSha256 ||
      run.reviewGate.checkReceiptSha256 !== receipt.receiptSha256 ||
      !run.reviewGate.packet || run.reviewGate.packet.path !== packetNow.path ||
      run.reviewGate.packet.sha256 !== packetNow.sha256 || !run.subject ||
      run.subject.subjectSha256 !== receipt.subject.subjectSha256 ||
      run.subject.pathCount !== receipt.subject.subjectPaths.length ||
      run.subject.diffBytes !== receipt.subject.diffBytes || run.subject.range !== receipt.subject.range) {
    throw new RunError('CHECKPOINT-EVIDENCE-INVALID',
      'review, deterministic checks, packet, and subject do not form one exact evidence chain');
  }
  const status = git(['-C', env.GIT_WORK_TREE, 'status', '--porcelain=v1', '--untracked-files=all']);
  const clean = status.status === 0 && !(status.stdout || '').trim();
  if (checkpointCandidateProblem({ clean })) {
    throw new RunError('CHECKPOINT-DIRTY-TREE',
      'checkpoint requires the already checked and reviewed subject to be committed by the approved external narrow-commit path; commit exactly that subject, then retry checkpoint without changing its bytes');
  }
  const rollbackPoint = (git(['-C', env.GIT_WORK_TREE, 'rev-parse', 'HEAD']).stdout || '').trim();
  if (!rollbackPoint) {
    throw new RunError('NO-ROLLBACK-POINT',
      'no commit could be resolved as a rollback point. A checkpoint that cannot name where to return to is refused.');
  }
  const reviewedBase = run.reviewGate.headCommit;
  const ancestor = /^[0-9a-f]{40,64}$/.test(reviewedBase || '') && reviewedBase !== rollbackPoint &&
    git(['-C', env.GIT_WORK_TREE, 'merge-base', '--is-ancestor', reviewedBase, rollbackPoint]).status === 0;
  if (checkpointCandidateProblem({ clean, reviewedBase, head: rollbackPoint, ancestor })) {
    throw new RunError('CHECKPOINT-HEAD-UNRELATED',
      'current HEAD is not a descendant commit containing the reviewed working-tree subject');
  }
  const committedResult = runCanonicalEngineeringOs([
    '--subject', '--packet', packetNow.path,
    '--base', reviewedBase, '--head', rollbackPoint, '--json',
  ], env);
  const committedSubject = committedResult.parsed;
  if (committedResult.status !== 0 || checkpointCandidateProblem({
    clean, reviewedBase, head: rollbackPoint, ancestor,
    reviewedSubject: receipt.subject, committedSubject,
  })) {
    throw new RunError('CHECKPOINT-SUBJECT-MISMATCH',
      'current clean HEAD does not contain exactly the checked and reviewed subject');
  }
  const tree = (git(['-C', env.GIT_WORK_TREE, 'rev-parse', 'HEAD^{tree}']).stdout || '').trim();
  if (!/^[0-9a-f]{40,64}$/.test(tree)) {
    throw new RunError('CHECKPOINT-TREE-INVALID', 'current commit tree could not be resolved');
  }
  fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
  const cpBody = {
    checkpointId: `CP-${nowIso().replace(/[^0-9]/g, '').slice(0, 14)}-${run.runId.slice(-8)}`,
    runId: run.runId, createdAt: nowIso(),
    rollbackPoint, baseCommit: run.baseCommit,
    tree,
    reviewedBase,
    packet: { path: packetNow.path, sha256: packetNow.sha256 },
    subject: {
      subjectSha256: receipt.subject.subjectSha256,
      subjectPaths: [...receipt.subject.subjectPaths],
      diffBytes: receipt.subject.diffBytes,
      reviewedRange: receipt.subject.range,
      committedRange: committedSubject.range,
    },
    checkReceiptSha256: receipt.receiptSha256,
    checks: { passed: run.checks.passed, total: run.checks.total },
    objective: run.objective,
  };
  const cp = { ...cpBody, digest: sha256(stableJson(cpBody)) };
  fs.writeFileSync(path.join(CHECKPOINTS_DIR, `${cp.checkpointId}.json`), JSON.stringify(cp, null, 2) + '\n');
  run.checkpoint = cp;
  saveRun(run);
  transition(run, 'CHECKPOINTED', `checkpoint ${cp.checkpointId} at ${rollbackPoint.slice(0, 12)}`);
  console.log(`checkpoint ${cp.checkpointId}\n  rollback point: ${rollbackPoint.slice(0, 12)}\n  checks: ${cp.checks.passed}/${cp.checks.total}`);
  return EXIT_PASS;
}

function cmdCheckpoint(args) {
  const claim = acquireRunLaunchClaim(args.runId, 3000);
  try { return cmdCheckpointClaimed(loadRun(args.runId), args); }
  finally { releaseRunLaunchClaim(claim); }
}

function cmdRollback(args) {
  const run = loadRun(args.runId);
  const cp = run.checkpoint;
  if (!cp || !cp.rollbackPoint) {
    throw new RunError('NO-ROLLBACK-POINT',
      'this run has no recorded rollback point. Rollback restores a RECORDED point; it never guesses one.');
  }
  throw new RunError('ROLLBACK-DEFERRED',
    'destructive rollback is disabled for the functional beta. The authenticated checkpoint and rollback point remain visible, but restoring them requires the dedicated post-beta rollback-control packet.');
}

// ── status / list ───────────────────────────────────────────────────────────
function cmdStatus(args) {
  const run = loadRun(args.runId);
  if (args.json) { console.log(JSON.stringify(run, null, 2)); return EXIT_PASS; }
  console.log(`AEGIS RUN ${run.runId}`);
  console.log(`  state     : ${run.state}  (contract step ${STATES[run.state].step})`);
  console.log(`  objective : ${run.objective}`);
  console.log(`  worktree  : ${run.worktree ? run.worktree.path : 'none'}`);
  console.log(`  build     : ${run.build ? `exit ${run.build.exit}` : 'not run'}`);
  console.log(`  checks    : ${run.checks ? `${run.checks.passed}/${run.checks.total}` : 'not run'}`);
  console.log(`  checkpoint: ${run.checkpoint ? run.checkpoint.checkpointId : 'none'}`);
  console.log(`  next      : ${STATES[run.state].next.join(', ') || 'none'}`);
  console.log('');
  console.log('  transitions:');
  for (const t of run.transitions || []) console.log(`    ${t.ts}  ${t.from} -> ${t.to}`);
  return EXIT_PASS;
}

function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

function cmdList(args) {
  const runs = listRuns();
  if (args.json) { console.log(JSON.stringify(runs, null, 2)); return EXIT_PASS; }
  if (!runs.length) { console.log('no runs'); return EXIT_PASS; }
  for (const r of runs) console.log(`  ${r.runId}  ${r.state.padEnd(16)} ${r.objective.slice(0, 48)}`);
  return EXIT_PASS;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--new') a.cmd_new = true;
    else if (t === '--status') { a.cmd_status = true; a.runId = argv[++i]; }
    else if (t === '--worktree') { a.cmd_worktree = true; a.runId = argv[++i]; }
    else if (t === '--build') { a.cmd_build = true; a.runId = argv[++i]; }
    else if (t === '--build-async') { a.cmd_build_async = true; a.runId = argv[++i]; }
    else if (t === '--continue-timeout') { a.cmd_continue_timeout = true; a.runId = argv[++i]; }
    else if (t === '--session') a.session = argv[++i];
    else if (t === '--continue-cmd') a.continueCmd = argv[++i];
    else if (t === '--continue-prompt') a.continuePrompt = argv[++i];
    else if (t === '--checks') { a.cmd_checks = true; a.runId = argv[++i]; }
    else if (t === '--checkpoint') { a.cmd_checkpoint = true; a.runId = argv[++i]; }
    else if (t === '--rollback') { a.cmd_rollback = true; a.runId = argv[++i]; }
    else if (t === '--list') a.cmd_list = true;
    else if (t === '--auto') { a.cmd_auto = true; a.runId = argv[++i]; }
    else if (t === '--watchdog') { a.cmd_watchdog = true; a.runId = argv[++i]; }
    else if (t === '--objective') a.objective = argv[++i];
    else if (t === '--acceptance') a.acceptance = argv[++i];
    else if (t === '--packet') a.packet = argv[++i];
    else if (t === '--cmd') a.cmd = argv[++i];
    else if (t === '--prompt') a.prompt = argv[++i];
    else if (t === '--timeout') a.timeout = argv[++i];
    else if (t === '--json') a.json = true;
  }
  return a;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let code;
  try {
    if (args.cmd_new) code = cmdNew(args);
    else if (args.cmd_status) code = cmdStatus(args);
    else if (args.cmd_worktree) code = cmdWorktree(args);
    else if (args.cmd_build) code = cmdBuild(args);
    else if (args.cmd_build_async) {
      throw new RunError('GOVERNED-START-REQUIRED',
        '--build-async cannot select a provider or model. Launch through the dashboard Start authority, which consumes the canonical run route.');
    }
    else if (args.cmd_continue_timeout) code = cmdContinueTimeout(args);
    else if (args.cmd_checks) code = cmdChecks(args);
    else if (args.cmd_checkpoint) code = cmdCheckpoint(args);
    else if (args.cmd_rollback) code = cmdRollback(args);
    else if (args.cmd_auto) code = cmdAuto(args);
    else if (args.cmd_watchdog) code = cmdWatchdog(args);
    else if (args.cmd_list) code = cmdList(args);
    else {
      process.stderr.write(`
aegis-run.cjs — the V1 runtime

  --new --objective "..." [--acceptance "..."] [--packet <p>]
  --worktree <runId>          create the isolated worktree (routes first)
  --build <runId> --cmd "..." run the builder INSIDE that worktree
  --continue-timeout <runId> --session <uuid> --continue-cmd "..."
                              finish a synchronous build that exited 124 in the
                              SAME session and correction; the command must be a
                              bounded "claude --resume <uuid>" subscription run
  --checks <runId>            run the packet's declared checks
  --checkpoint <runId>        record a checkpoint + rollback point
  --rollback <runId>          restore the recorded rollback point
  --status <runId> | --list [--json]

Illegal transitions are refused. There is no --force.
`);
      code = EXIT_USAGE;
    }
  } catch (e) {
    if (e instanceof RunError) {
      process.stderr.write(`\nAEGIS-RUN REFUSED\n  rule  : ${e.code}\n  reason: ${e.message}\n`);
      code = EXIT_REFUSED;
    } else throw e;
  }
  process.exit(code);
}

module.exports = { STATES, MAX_CORRECTIONS, WORKER_LAUNCH_GRACE_MS, watchdog, REQUIRED_SEQUENCE, dashboardSliceCheckCommands, transition, loadRun, saveRun, listRuns, RunError, AegisControlError, normalizeObjective, createRunFromObjective, prepareRun, startWorker, startGovernedWorker, continueTimedOutBuild, parseTimeoutContinuationCommand, pauseRun, workerCancellationCapability, cancelRun, retryRun, runChecks, automaticDashboardChecksEligibility, runAutomaticDashboardChecks, prepareIndependentReview, bindIndependentReview, recordResearchDecision, RESEARCH_DECISIONS, RESEARCH_DECISION_NOTE_PREFIX, updateWorkerAttempt, transitionWorkerAttempt, reconcileWorkerRun, reconcileBuildingRuns, processIdentity, processExistence, processGroupExistence, processGroupMembers, sameProcessIdentity, acquireGlobalWorkerClaim, transferGlobalWorkerClaim, releaseRunLaunchClaim, verifyGlobalWorkerLease, releaseGlobalWorkerLease, acquireGlobalReviewHold, releaseGlobalReviewHold, reviewLifecycleProofPermitsRelease, REVIEW_HOLD_HOLDER, readRunLaunchClaim, globalWorkerLockPath, checkReceiptDigest, hostContainmentReceiptDigest, validateCheckReceipt, validateCompleteCheckReceipt, validatePreHostCheckReceipt, validateHostContainmentReceipt, validateCompleteHostContainmentReceipt, persistCanonicalCheckReceipt, persistCanonicalPreHostCheckReceipt, loadCanonicalCheckReceipt, loadCanonicalPreHostCheckReceipt, buildHostProofContext, validateHostProofEvidence, checkpointCandidateProblem, canonicalGitEnvironment, captureCheckExecutionSource, establishHostContainmentSnapshot, runTopLevelHostContainmentCheck, runPath, RUNS_DIR, CHECKPOINTS_DIR, PACKETS_DIR };
