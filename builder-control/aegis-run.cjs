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
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

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
  CHECKS_PASSED:    { step: 6,  next: ['REVIEW_BOUND', 'ABANDONED'] },
  REVIEW_BOUND:     { step: 7,  next: ['CHECKPOINTED', 'CORRECTING', 'ABANDONED'] },
  CORRECTING:       { step: 8,  next: ['BUILDING', 'ABANDONED'] },
  CHECKPOINTED:     { step: 10, next: ['ROLLED_BACK'] },
  // Terminal-ish failure states. Each can only go somewhere honest.
  BUILD_FAILED:     { step: 5,  next: ['CORRECTING', 'ROLLED_BACK', 'ABANDONED'], failure: true },
  CHECKS_FAILED:    { step: 6,  next: ['CORRECTING', 'ROLLED_BACK', 'ABANDONED'], failure: true },
  ROLLED_BACK:      { step: 10, next: ['ABANDONED'], failure: true },
  ABANDONED:        { step: 0,  next: [], terminal: true },
};

const MAX_CORRECTIONS = 3;
const WORKER_LAUNCH_GRACE_MS = 5000;
const CHECK_FAILURE_TAIL_LINES = 80;
const CHECK_FAILURE_TAIL_BYTES = 16 * 1024;

const nowIso = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

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
    const result = spawnSync('ps', ['-p', String(pid), '-o', `${field}=`], {
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

  const result = spawnSync('ps', ['-p', String(pid), '-o', 'pid='], {
    encoding: 'utf8', timeout: 1000,
  });
  if (result.error || result.signal || result.status === null) return 'unknown';
  const observed = String(result.stdout || '').trim();
  if (result.status === 0 && observed.split(/\s+/).includes(String(pid))) return 'present';
  if (result.status === 1 && !observed) return 'absent';
  return 'unknown';
}

function sameProcessIdentity(recorded, observed) {
  return Boolean(recorded && observed &&
    recorded.pid === observed.pid &&
    recorded.processGroupId === observed.processGroupId &&
    recorded.startMarker === observed.startMarker &&
    recorded.executable === observed.executable &&
    recorded.source === observed.source);
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
  if (typeof value === 'string' && OBJECTIVE_DANGEROUS_FIELDS.has(value.trim().toLowerCase())) {
    return `${path} contains a control field value ("${value.trim()}")`;
  }
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
  try { ownerNames = fs.readdirSync(lockPath).filter((name) => name.endsWith('.json')); }
  catch { return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' }); }
  if (ownerNames.length !== 1) return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' });
  const ownerName = ownerNames[0];
  const ownerPath = path.join(lockPath, ownerName);
  let claim;
  try { claim = JSON.parse(fs.readFileSync(ownerPath, 'utf8')); }
  catch { return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' }); }
  if (!claim || claim.claimId !== ownerName.slice(0, -'.json'.length) ||
      typeof claim.claimId !== 'string' || !claim.claimId ||
      !Number.isInteger(claim.pid) || claim.pid <= 1 || !claim.processIdentity) {
    return Object.freeze({ blocked: true, reason: 'UNREADABLE_CLAIM' });
  }
  return Object.freeze({ claim, ownerPath });
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

function acquireRunLaunchClaim(runId, waitMs = 0) {
  const lockPath = runLockPath(runId);
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const claimId = crypto.randomUUID();
  const claimantIdentity = processIdentity(process.pid);
  if (!claimantIdentity) {
    throw new AegisControlError('CLAIM_IDENTITY_UNAVAILABLE',
      `cannot prove the process lifetime claiming run ${runId}`, 409);
  }
  const claim = { claimId, runId, pid: process.pid, processIdentity: claimantIdentity, claimedAt: nowIso() };
  cleanupOrphanClaimPublications(lockPath);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return publishRunLaunchClaim(lockPath, claim);
    } catch (e) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e;
      const existing = readRunLaunchClaim(lockPath);
      if (!existing || existing.blocked) {
        if (Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(20, deadline - Date.now()));
          continue;
        }
        throw new AegisControlError('LAUNCH_IN_PROGRESS', `run ${runId} already has an atomic launch claim`, 409);
      }
      const existence = processExistence(existing.claim.pid);
      const observedOwner = existence === 'present' ? processIdentity(existing.claim.pid) : null;
      // Positive absence is sufficient to reclaim a crashed owner. Unknown
      // existence, or a live owner whose immutable identity is unavailable,
      // fails closed. A positive different identity means the PID was reused.
      const reclaimable = existence === 'absent' ||
        (existence === 'present' && observedOwner &&
          !sameProcessIdentity(existing.claim.processIdentity, observedOwner));
      if (!reclaimable) {
        if (Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(20, deadline - Date.now()));
          continue;
        }
        throw new AegisControlError('LAUNCH_IN_PROGRESS', `run ${runId} already has an atomic launch claim`, 409);
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

function releaseRunLaunchClaim(claim) {
  let current = null;
  try { current = JSON.parse(fs.readFileSync(claim.ownerPath, 'utf8')); } catch {}
  if (current && current.claimId === claim.claimId) {
    try { fs.unlinkSync(claim.ownerPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    try { fs.rmdirSync(claim.lockPath); }
    catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
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
    if (observed && sameProcessIdentity(build.processIdentity, observed)) {
      return Object.freeze({ runId, action: 'ACTIVE', state: run.state });
    }
    // If the PID is live but its recorded lifetime cannot be proved, leave the
    // run untouched. Mutating would falsely claim the live worker is gone;
    // signalling it would be worse. A later observation can reconcile after
    // the unverified process exits.
    if (observed) {
      return Object.freeze({ runId, action: 'IDENTITY_UNVERIFIED', state: run.state });
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
    if (run.state !== 'BUILDING' || !run.build || run.build.mode !== 'async') continue;
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
  const entry = {
    entryId: `LED-RUN-${stamp.replace(/[^0-9]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
    ts: stamp,
    agentId: 'claude-code',
    gate: 'aegis-run',
    status: STATES[to] && STATES[to].failure ? 'FAILED' : 'PASS',
    plane: 'CONTROL',
    operationId: `${run.runId}:${from}->${to}`,
    correlationId: run.runId,
    attempt: (run.transitions || []).filter((t) => t.to === to).length + 1,
    result: notes || `${from} -> ${to}`,
    notes: `run ${run.runId}: ${from} -> ${to}${notes ? ` (${notes})` : ''}`,
  };
  const f = path.join(require('os').tmpdir(), `aegis-run-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(f, JSON.stringify(entry));
  try {
    const r = spawnSync('node', [LEDGER_WRITER, '--append', f], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0 && !/NO-OP/.test(r.stdout || '')) {
      throw new RunError('LEDGER-REFUSED',
        `the canonical ledger refused this transition: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}. ` +
        'A transition that cannot be recorded did not happen.');
    }
  } finally { try { fs.unlinkSync(f); } catch {} }
  return entry;
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
  const entry = recordTransition(run, from, to, notes);
  run.state = to;
  run.transitions = run.transitions || [];
  run.transitions.push({ from, to, ts: entry.ts, ledgerEntryId: entry.entryId, notes: notes || null });
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
function createRunFromObjective(input, options = {}) {
  const normalized = normalizeObjective(input);
  const packet = resolvePacketOption(options.packet);

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
    const r = R.routeRole('orchestrator', {});
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
  transition(run, 'ROUTED', `orchestrator route: ${route.model}`);

  // Step 4: create the isolated worktree, argument-array git only. Never
  // reuse an existing path or the primary tree.
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
 * Claim-aware worker launch. The caller must already own the per-run claim;
 * keeping this operation non-reentrant lets retry serialize its correction
 * decision and attempt reservation without releasing ownership in between.
 */
function startWorkerClaimed(run, launchSpec, options = {}) {
  if (run.state !== 'WORKTREE_READY' && run.state !== 'CORRECTING') {
    throw new AegisControlError('ILLEGAL_TRANSITION',
      `asynchronous build requires WORKTREE_READY or CORRECTING, run is ${run.state}`, 409);
  }
  if (!run.worktree || !fs.existsSync(run.worktree.path)) {
    throw new AegisControlError('NO_WORKTREE',
      'the run has no existing isolated worktree; refusing to launch a builder', 409);
  }
  if (run.build && run.build.workerPid && require('./aegis-worker.cjs').processAlive(run.build.workerPid)) {
    throw new AegisControlError('WORKER_ALREADY_ACTIVE',
      `run ${run.runId} already has active worker ${run.build.workerPid}`, 409);
  }
  let normalized;
  try { normalized = require('./aegis-worker.cjs').normalizeLaunchSpec(launchSpec); }
  catch (e) { throw new AegisControlError(e.code || 'INVALID_LAUNCH_SPEC', e.message, 400); }
  let timeoutSec;
  try { timeoutSec = require('./aegis-worker.cjs').normalizeTimeoutSec(options.timeoutSec); }
  catch (e) { throw new AegisControlError(e.code || 'INVALID_LAUNCH_SPEC', e.message, 400); }

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
  try {
    launch = require('./aegis-worker.cjs').launchWorker({
      runId: run.runId,
      attemptId,
      launchSpec: normalized,
      timeoutSec,
    });
  } catch (e) {
    const failed = loadOwnedWorkerAttempt(run.runId, attemptId);
    failed.build = { ...failed.build, endedAt: nowIso(), exit: 127,
      workerState: 'SPAWN_FAILED', stderrTail: String(e.message || e).slice(0, 1000) };
    saveRun(failed);
    transition(failed, 'BUILD_FAILED', 'asynchronous worker spawn failed');
    throw new AegisControlError('WORKER_SPAWN_FAILED', 'the asynchronous worker could not be launched', 409);
  }

  const building = loadRun(run.runId);
  if (!building.build || building.build.attemptId !== attemptId) {
    // Never signal a numeric PID after ownership changes. The worker's
    // immutable launch-record check fails and it exits without build authority.
    throw new AegisControlError('STALE_WORKER_ATTEMPT', 'worker launch ownership changed before metadata was persisted', 409);
  }
  building.build = {
    ...building.build, launchSha256: launch.launchSha256,
    workerPid: launch.workerPid, processGroupId: launch.processGroupId,
    control: launch.control,
    processIdentity: processIdentity(launch.workerPid),
    workerState: 'STARTING', startedAt: nowIso(), heartbeatAt: null,
    exit: null, stdoutTail: '', stderrTail: '',
    revision: buildRevision(building.build) + 1,
  };
  saveRun(building);
  return Object.freeze({
    runId: building.runId, state: building.state, action: 'start',
    workerPid: launch.workerPid, attempt, attemptId, nextAction: 'monitor',
  });
}

/**
 * Launches the build as a detached, bounded worker and returns immediately.
 * The worker may execute only in the already-created isolated worktree. The
 * existing transition() remains the single lifecycle/ledger authority.
 */
function startWorker(runId, launchSpec, options = {}) {
  let claim;
  try { claim = acquireRunLaunchClaim(runId, 1000); }
  catch (e) {
    if (e instanceof RunError) {
      if (e.code === 'BAD-RUN-ID') throw new AegisControlError('INVALID_RUN_ID', e.message, 400);
      if (e.code === 'NO-SUCH-RUN') throw new AegisControlError('RUN_NOT_FOUND', e.message, 404);
    }
    throw e;
  }
  try {
    return startWorkerClaimed(loadRunForControl(runId), launchSpec, options);
  } finally { releaseRunLaunchClaim(claim); }
}

/**
 * Dashboard Start authority. Intake preparation, its fresh post-preparation
 * validation, attempt reservation, and worker launch are one claimed action.
 * The launch-spec factory is trusted server code and is invoked only after the
 * fresh WORKTREE_READY record has been loaded while the claim is still held.
 */
function startGovernedWorker(runId, launchSpecForRun, options = {}) {
  let claim;
  try { claim = acquireRunLaunchClaim(runId, 1000); }
  catch (e) {
    if (e instanceof RunError) {
      if (e.code === 'BAD-RUN-ID') throw new AegisControlError('INVALID_RUN_ID', e.message, 400);
      if (e.code === 'NO-SUCH-RUN') throw new AegisControlError('RUN_NOT_FOUND', e.message, 404);
    }
    throw e;
  }
  try {
    let run = loadRunForControl(runId);
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
    const launchSpec = launchSpecForRun(run);
    return startWorkerClaimed(run, launchSpec, options);
  } finally { releaseRunLaunchClaim(claim); }
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
      if (owned.state !== 'BUILDING' || !owned.build || owned.build.mode !== 'async' ||
          !Number.isInteger(owned.build.workerPid)) {
        throw new AegisControlError('CONTROL_UNAVAILABLE',
          `run ${owned.runId} has no verified active asynchronous worker to cancel.`, 409);
      }
      if (!owned.build.control || !owned.build.childProcessIdentity) {
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
function retryRun(runId) {
  // Preserve the stable control-surface id/not-found errors before the claim
  // path creates or inspects a lock. All retry decisions are still made only
  // after a fresh load while the claim is held below.
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
    if (run.state !== 'BUILD_FAILED' && run.state !== 'CHECKS_FAILED') {
      throw new AegisControlError('INVALID_RETRY',
        `run ${run.runId} is ${run.state}; retry requires BUILD_FAILED or CHECKS_FAILED.`, 409);
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
    run.corrections += 1;
    transition(run, 'CORRECTING', `correction cycle ${run.corrections} of ${MAX_CORRECTIONS} via control surface`);
    if (retryLaunchSpec) return startWorkerClaimed(run, retryLaunchSpec);
    const fresh = loadRun(run.runId);
    return Object.freeze({
      runId: fresh.runId,
      state: fresh.state,
      action: 'retry',
      correction: fresh.corrections,
      nextAction: `--build ${fresh.runId} --cmd "<command>"`,
    });
  } finally { releaseRunLaunchClaim(claim); }
}

// ── step 5: builder execution ───────────────────────────────────────────────
function cmdBuild(args) {
  const run = loadRun(args.runId);
  if (!args.cmd) throw new RunError('NO-COMMAND', '--cmd is required');
  if (run.state !== 'WORKTREE_READY' && run.state !== 'CORRECTING') {
    throw new RunError('ILLEGAL-TRANSITION',
      `build requires WORKTREE_READY or CORRECTING, run is ${run.state}. A build with no isolated worktree is a build in the wrong place.`);
  }
  if (!run.worktree || !fs.existsSync(run.worktree.path)) {
    throw new RunError('NO-WORKTREE', 'the run has no existing worktree; refusing to build in the primary tree');
  }
  if (run.state === 'CORRECTING' && run.corrections >= MAX_CORRECTIONS) {
    throw new RunError('CORRECTION-LIMIT',
      `${run.corrections} correction cycles already used (max ${MAX_CORRECTIONS}). Escalate to the Product Owner rather than looping.`);
  }
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

// ── step 6: deterministic checks ────────────────────────────────────────────
// This is the one canonical check executor. Both the CLI and the authenticated
// dashboard control surface enter through runChecks(), which owns the same
// per-run claim used by every other mutating control. The browser never supplies
// a command: commands come only from the packet already bound to the run.
const SWITCHBOARD_PACKET_ID = 'PKT-20260825-SWITCHBOARD-FOUNDATION';
const SWITCHBOARD_PACKET_FILE = path.join(PACKETS_DIR, `${SWITCHBOARD_PACKET_ID}.json`);
const DASHBOARD_STATE_GENERATOR_REL = path.join('builder-control', 'aegis-state.cjs');
const DASHBOARD_STATE_OUTPUT_REL = path.join('builder-control', 'dashboard', 'state.js');

function prepareCanonicalDashboardState(run, pkt, packetReal) {
  let canonicalPacketReal;
  try { canonicalPacketReal = fs.realpathSync(SWITCHBOARD_PACKET_FILE); }
  catch (e) {
    return { ok: false, code: 'STATE_PACKET_UNAVAILABLE', reason: `canonical switchboard packet is unavailable: ${e.message}` };
  }
  if (packetReal !== canonicalPacketReal || pkt.packetId !== SWITCHBOARD_PACKET_ID) {
    return { ok: true, required: false };
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

  const generated = spawnSync(process.execPath, [generatorReal, '--out', outputExpected], {
    cwd: worktreeReal, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
  });
  const exit = generated.status === null ? 124 : generated.status;
  if (generated.error || exit !== 0) {
    return {
      ok: false,
      code: 'STATE_GENERATION_FAILED',
      exit,
      reason: `canonical dashboard state generation failed${generated.error ? `: ${generated.error.message}` : ` (exit ${exit})`}`,
    };
  }

  let body;
  try {
    const outputStat = fs.lstatSync(outputExpected);
    const outputReal = fs.realpathSync(outputExpected);
    if (outputStat.isSymbolicLink() || !outputStat.isFile() || outputReal !== outputExpected ||
        !outputReal.startsWith(outputDirReal + path.sep)) {
      throw new Error('output escaped the canonical dashboard directory or is not a regular file');
    }
    body = fs.readFileSync(outputReal, 'utf8');
    if (Buffer.byteLength(body, 'utf8') > 32 * 1024 * 1024) throw new Error('output exceeds 32 MiB');
  } catch (e) {
    return { ok: false, code: 'STATE_OUTPUT_INVALID', reason: `generated dashboard state is unavailable: ${e.message}` };
  }
  const marker = 'window.AEGIS_STATE = ';
  const markerAt = body.indexOf(marker);
  if (!body.startsWith('/* Generated by builder-control/aegis-state.cjs') || markerAt === -1) {
    return { ok: false, code: 'STATE_OUTPUT_INVALID', reason: 'generated dashboard state lacks its canonical generator header or assignment' };
  }
  try {
    const value = JSON.parse(body.slice(markerAt + marker.length).trim().replace(/;\s*$/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('state root is not an object');
  } catch (e) {
    return { ok: false, code: 'STATE_OUTPUT_INVALID', reason: `generated dashboard state is invalid: ${e.message}` };
  }
  return { ok: true, required: true, generator: DASHBOARD_STATE_GENERATOR_REL, output: DASHBOARD_STATE_OUTPUT_REL };
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
  const packetReal = fs.realpathSync(path.resolve(ROOT, packet));
  const pkt = JSON.parse(fs.readFileSync(packetReal, 'utf8'));
  const cmds = (pkt.testsRequired || []).filter((command) => {
    if (typeof command !== 'string') return false;
    const tokens = command.trim().split(/\s+/);
    const entrypoint = tokens[1] && tokens[1].replace(/^\.\//, '');
    return !(tokens[0] === 'node' && entrypoint === 'builder-control/engineering-os.cjs' &&
      tokens.includes('--gate-done'));
  });
  if (!cmds.length) {
    transition(run, 'CHECKS_FAILED', 'the packet declares no runnable testsRequired');
    throw new RunError('NO-CHECKS', 'the packet declares no runnable checks. Zero checks passing is the absence of evidence, not evidence.');
  }
  const statePreparation = prepareCanonicalDashboardState(run, pkt, packetReal);
  if (!statePreparation.ok) {
    run.checks = {
      ranAt: nowIso(), total: cmds.length, passed: 0,
      results: cmds.map((cmd) => ({ cmd, exit: null, skipped: 'canonical dashboard state generation failed' })),
      precondition: {
        state: 'FAILED', code: statePreparation.code,
        reason: statePreparation.reason, exit: Number.isInteger(statePreparation.exit) ? statePreparation.exit : null,
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
  const results = [];
  for (const cmd of cmds) {
    const r = spawnSync('bash', ['-lc', cmd], { cwd: worktreeReal, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const exit = r.status === null ? 124 : r.status;
    const result = { cmd, exit };
    if (exit !== 0 || r.error) {
      const stdout = boundedCheckFailureTail(r.stdout);
      const stderr = boundedCheckFailureTail(r.error ? `${r.stderr || ''}\n${r.error.message || ''}` : r.stderr);
      result.failureEvidence = {
        stdoutTail: stdout.tail,
        stderrTail: stderr.tail,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      };
    }
    results.push(result);
  }
  run.checks = {
    ranAt: nowIso(), total: results.length, passed: results.filter((x) => x.exit === 0).length, results,
    ...(statePreparation.required ? { precondition: {
      state: 'PASSED', generator: statePreparation.generator, output: statePreparation.output,
    } } : {}),
  };
  saveRun(run);
  const allPassed = results.every((x) => x.exit === 0);
  transition(run, allPassed ? 'CHECKS_PASSED' : 'CHECKS_FAILED',
    `${run.checks.passed}/${run.checks.total} checks passed`);
  const fresh = loadRun(run.runId);
  return Object.freeze({
    runId: fresh.runId,
    state: fresh.state,
    action: 'checks',
    checks: Object.freeze({ passed: fresh.checks.passed, total: fresh.checks.total }),
    nextAction: allPassed ? 'independent review required' : 'retry',
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
        if (e.code === 'REVIEW-RUN-INVALID' || e.code === 'REVIEW-WORKTREE-INVALID' ||
            e.code === 'REVIEW-WORKTREE-FOREIGN') {
          throw new AegisControlError('CHECKS_WORKTREE_INVALID', e.message, 409);
        }
      }
      throw e;
    }
  } finally { releaseRunLaunchClaim(claim); }
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

function runCanonicalEngineeringOs(args, env) {
  const r = spawnSync(process.execPath, [ENGOS, ...args], {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
  });
  if (r.error) {
    throw new RunError('REVIEW-AUTHORITY-UNAVAILABLE', `engineering-os.cjs could not run: ${r.error.message}`);
  }
  let parsed;
  try { parsed = JSON.parse((r.stdout || '').trim()); }
  catch {
    throw new RunError('REVIEW-AUTHORITY-UNAVAILABLE',
      `engineering-os.cjs returned no parseable JSON${r.status === 0 ? '' : ` (exit ${r.status})`}`);
  }
  return { status: r.status === null ? 124 : r.status, parsed };
}

function validPassedChecks(checks) {
  return Boolean(checks && Number.isInteger(checks.total) && checks.total > 0 &&
    checks.passed === checks.total && Array.isArray(checks.results) &&
    checks.results.length === checks.total &&
    checks.results.every((result) => result && typeof result.cmd === 'string' &&
      result.cmd.trim() && result.exit === 0) &&
    typeof checks.ranAt === 'string' && Number.isFinite(Date.parse(checks.ranAt)));
}

function sameCanonicalSubject(a, b) {
  return Boolean(a && b && /^[0-9a-f]{64}$/.test(a.subjectSha256 || '') &&
    a.subjectSha256 === b.subjectSha256 &&
    JSON.stringify(a.subjectPaths) === JSON.stringify(b.subjectPaths) &&
    a.diffBytes === b.diffBytes && a.range === b.range);
}

function bindIndependentReviewClaimed(run) {
  if (run.state !== 'CHECKS_PASSED') {
    throw new RunError('ILLEGAL-TRANSITION', `review binding requires CHECKS_PASSED, run is ${run.state}`);
  }
  if (!validPassedChecks(run.checks)) {
    throw new RunError('REVIEW-CHECKS-INVALID', 'run has no complete, real all-passed deterministic check record');
  }
  const packet = resolvePacketOption(run.packet);
  if (!packet) throw new RunError('REVIEW-PACKET-INVALID', 'review binding requires the packet already bound to the run');
  const env = canonicalGitEnvironment(run);

  const first = runCanonicalEngineeringOs(['--subject', '--json'], env);
  const subject = first.parsed;
  if (first.status !== 0 || !/^[0-9a-f]{64}$/.test(subject.subjectSha256 || '') ||
      !Array.isArray(subject.subjectPaths) || subject.subjectPaths.length === 0 ||
      !Number.isInteger(subject.diffBytes) || subject.diffBytes <= 0) {
    throw new RunError('REVIEW-SUBJECT-INVALID', 'canonical subject is empty, malformed, or unavailable');
  }

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
    const rules = Array.isArray(gate && gate.problems)
      ? gate.problems.map((problem) => problem && problem.rule).filter(Boolean).join(', ')
      : '';
    throw new RunError('REVIEW-GATE-REFUSED',
      `canonical exact-subject review gate did not pass${rules ? `: ${rules}` : ''}`);
  }

  // The subject is recomputed after the gate and immediately before the sole
  // persistence point.  A moving tree can neither borrow nor retain approval.
  const secondResult = runCanonicalEngineeringOs(['--subject', '--json'], env);
  if (secondResult.status !== 0 || !sameCanonicalSubject(subject, secondResult.parsed)) {
    throw new RunError('REVIEW-SUBJECT-MOVED', 'the canonical subject changed while its reviews were being bound');
  }

  const boundAt = nowIso();
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
  const run = loadRun(args.runId);
  if (!args.cmd) throw new RunError('NO-COMMAND', '--cmd is required');
  const history = [];

  for (let cycle = 0; ; cycle++) {
    if (run.state === 'BUILD_FAILED' || run.state === 'CHECKS_FAILED') {
      if (run.corrections >= MAX_CORRECTIONS) {
        transition(run, 'ABANDONED', `escalating after ${run.corrections} correction cycles`);
        console.error(
          `\nESCALATION REQUIRED — ${run.corrections} correction cycles did not resolve.\n` +
          'Stopping rather than looping. The Product Owner decides what happens next; ' +
          'a fourth attempt is a fourth guess, not a fix.');
        return EXIT_REFUSED;
      }
      run.corrections += 1;
      saveRun(run);
      transition(run, 'CORRECTING', `correction cycle ${run.corrections} of ${MAX_CORRECTIONS}`);
    }

    const b = cmdBuild({ ...args, runId: run.runId });
    Object.assign(run, loadRun(run.runId));
    history.push({ cycle, phase: 'build', state: run.state });
    if (b !== EXIT_PASS) { if (run.corrections >= MAX_CORRECTIONS) continue; else continue; }

    let c;
    try { c = cmdChecks({ runId: run.runId }); }
    catch (e) { if (e instanceof RunError) { c = EXIT_REFUSED; } else throw e; }
    Object.assign(run, loadRun(run.runId));
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
  let cursor = -1;
  for (const stage of REQUIRED_SEQUENCE) {
    const at = reached.indexOf(stage, cursor + 1);
    if (at === -1) {
      problems.push({ rule: 'WATCHDOG-STAGE-MISSING', detail: `required stage ${stage} never occurred in this run` });
    } else if (at < cursor) {
      problems.push({ rule: 'WATCHDOG-OUT-OF-ORDER', detail: `${stage} occurred before a stage that must precede it` });
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
  const ledgerOps = new Set(ledger.filter((e) => e.correlationId === run.runId).map((e) => e.operationId));
  for (const t of run.transitions || []) {
    const op = `${run.runId}:${t.from}->${t.to}`;
    if (!ledgerOps.has(op)) {
      problems.push({
        rule: 'WATCHDOG-UNRECORDED-TRANSITION',
        detail: `the run claims ${t.from} -> ${t.to} but the canonical ledger has no such entry. The run file is not evidence; the ledger is.`,
      });
    }
  }
  return { ok: problems.length === 0, problems, reached, required: REQUIRED_SEQUENCE };
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
function cmdCheckpoint(args) {
  const run = loadRun(args.runId);
  // The guard used to also accept CHECKS_PASSED, which contradicted the
  // transition table (CHECKS_PASSED -> CHECKPOINTED is not legal) and would have
  // let a checkpoint skip step 7 entirely. The table is right: review binds
  // before a known-good point is recorded, or the point is "known good" only to
  // the builder that produced it.
  if (run.state !== 'REVIEW_BOUND') {
    throw new RunError('ILLEGAL-TRANSITION',
      `checkpoint requires REVIEW_BOUND, run is ${run.state}. A checkpoint before independent review records a point only the builder believes in.`);
  }
  if (!run.checks || run.checks.total === 0 || run.checks.passed !== run.checks.total) {
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

  const rollbackPoint = run.worktree
    ? (git(['rev-parse', 'HEAD'], { cwd: run.worktree.path }).stdout || '').trim()
    : null;
  if (!rollbackPoint) {
    throw new RunError('NO-ROLLBACK-POINT',
      'no commit could be resolved as a rollback point. A checkpoint that cannot name where to return to is refused.');
  }
  fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
  const cp = {
    checkpointId: `CP-${nowIso().replace(/[^0-9]/g, '').slice(0, 14)}-${run.runId.slice(-8)}`,
    runId: run.runId, createdAt: nowIso(),
    rollbackPoint, baseCommit: run.baseCommit,
    checks: { passed: run.checks.passed, total: run.checks.total },
    objective: run.objective,
    digest: sha256(`${run.runId}|${rollbackPoint}|${run.checks.passed}/${run.checks.total}`),
  };
  fs.writeFileSync(path.join(CHECKPOINTS_DIR, `${cp.checkpointId}.json`), JSON.stringify(cp, null, 2) + '\n');
  run.checkpoint = cp;
  saveRun(run);
  transition(run, 'CHECKPOINTED', `checkpoint ${cp.checkpointId} at ${rollbackPoint.slice(0, 12)}`);
  console.log(`checkpoint ${cp.checkpointId}\n  rollback point: ${rollbackPoint.slice(0, 12)}\n  checks: ${cp.checks.passed}/${cp.checks.total}`);
  return EXIT_PASS;
}

function cmdRollback(args) {
  const run = loadRun(args.runId);
  const cp = run.checkpoint;
  if (!cp || !cp.rollbackPoint) {
    throw new RunError('NO-ROLLBACK-POINT',
      'this run has no recorded rollback point. Rollback restores a RECORDED point; it never guesses one.');
  }
  if (!run.worktree || !fs.existsSync(run.worktree.path)) {
    throw new RunError('NO-WORKTREE', 'the run has no existing worktree to roll back');
  }
  const r = git(['reset', '--hard', cp.rollbackPoint], { cwd: run.worktree.path });
  if (r.status !== 0) {
    throw new RunError('ROLLBACK-FAILED', `git reset failed: ${(r.stderr || '').trim().slice(0, 200)}`);
  }
  const at = (git(['rev-parse', 'HEAD'], { cwd: run.worktree.path }).stdout || '').trim();
  run.rollback = { toCommit: cp.rollbackPoint, at: nowIso(), verifiedHead: at, ok: at === cp.rollbackPoint };
  saveRun(run);
  transition(run, 'ROLLED_BACK', `restored ${cp.rollbackPoint.slice(0, 12)}`);
  console.log(`rolled back to ${cp.rollbackPoint.slice(0, 12)} (verified head ${at.slice(0, 12)})`);
  return run.rollback.ok ? EXIT_PASS : EXIT_REFUSED;
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

module.exports = { STATES, MAX_CORRECTIONS, WORKER_LAUNCH_GRACE_MS, watchdog, REQUIRED_SEQUENCE, transition, loadRun, saveRun, listRuns, RunError, AegisControlError, normalizeObjective, createRunFromObjective, prepareRun, startWorker, startGovernedWorker, pauseRun, cancelRun, retryRun, runChecks, bindIndependentReview, updateWorkerAttempt, transitionWorkerAttempt, reconcileWorkerRun, reconcileBuildingRuns, processIdentity, processExistence, sameProcessIdentity, runPath, RUNS_DIR, CHECKPOINTS_DIR, PACKETS_DIR };
