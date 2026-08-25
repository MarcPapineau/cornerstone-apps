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
  BUILDING:         { step: 5,  next: ['BUILT', 'BUILD_FAILED'] },
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

const nowIso = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

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
  fs.writeFileSync(runPath(run.runId), JSON.stringify(run, null, 2) + '\n');
  return run;
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

/** The only way a run changes state. */
function transition(run, to, notes) {
  const from = run.state;
  const def = STATES[from];
  if (!def) throw new RunError('UNKNOWN-STATE', `run is in unknown state ${from}`);
  if (!STATES[to]) throw new RunError('UNKNOWN-STATE', `${to} is not a state`);
  if (!def.next.includes(to)) {
    throw new RunError('ILLEGAL-TRANSITION',
      `${from} -> ${to} is not a legal transition (allowed: ${def.next.join(', ') || 'none'}). ` +
      'A run cannot reach a later state by skipping an earlier one, and there is no --force.');
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
function prepareRun(runId) {
  const run = loadRun(runId);
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
 * Pause never invents a PAUSED state. Builder execution (--build) is a
 * synchronous spawnSync call inside cmdBuild; there is no running process to
 * suspend and no state machine slot to suspend it into. Every state,
 * including BUILDING, fails closed with no mutation — the honest answer to
 * "pause this" is "that control does not exist yet", not a silent no-op.
 */
function pauseRun(runId) {
  const run = loadRunForControl(runId);
  if (run.state === 'BUILDING') {
    throw new AegisControlError('CONTROL_UNAVAILABLE',
      `run ${run.runId} is BUILDING; builder execution is synchronous and there is no PAUSED state. ` +
      'Pausing an active build requires asynchronous worker control, which this runtime does not have.', 409);
  }
  throw new AegisControlError('CONTROL_UNAVAILABLE',
    `run ${run.runId} is ${run.state}; pause is unavailable because no PAUSED state exists in the canonical state machine.`, 409);
}

/**
 * Cancel only ever takes the legal ABANDONED edge that already exists in
 * STATES. BUILDING is refused because there is nothing to interrupt
 * synchronously; any state whose `next` does not list ABANDONED is refused
 * for the same reason transition() would refuse it directly.
 */
function cancelRun(runId) {
  const run = loadRunForControl(runId);
  if (run.state === 'BUILDING') {
    throw new AegisControlError('CONTROL_UNAVAILABLE',
      `run ${run.runId} is BUILDING; cancel cannot interrupt synchronous builder execution.`, 409);
  }
  const def = STATES[run.state];
  if (!def || !def.next.includes('ABANDONED')) {
    throw new AegisControlError('CONTROL_UNAVAILABLE',
      `run ${run.runId} is ${run.state}; ABANDONED is not a legal next state (allowed: ${def ? def.next.join(', ') || 'none' : 'unknown'}).`, 409);
  }
  transition(run, 'ABANDONED', 'cancelled via control surface');
  const fresh = loadRun(run.runId);
  return Object.freeze({
    runId: fresh.runId,
    state: fresh.state,
    action: 'cancel',
    nextAction: 'none',
  });
}

/**
 * Retry only re-enters the existing bounded CORRECTING path, the same one
 * cmdAuto drives — it never runs the builder, model, or checks itself, so
 * actual re-execution stays a separate governed --build step. corrections is
 * incremented exactly once and only after the MAX_CORRECTIONS check passes,
 * matching the CLI's own correction bound.
 */
function retryRun(runId) {
  const run = loadRunForControl(runId);
  if (run.state !== 'BUILD_FAILED' && run.state !== 'CHECKS_FAILED') {
    throw new AegisControlError('INVALID_RETRY',
      `run ${run.runId} is ${run.state}; retry requires BUILD_FAILED or CHECKS_FAILED.`, 409);
  }
  if (run.corrections >= MAX_CORRECTIONS) {
    throw new AegisControlError('CORRECTION_LIMIT',
      `run ${run.runId} already used ${run.corrections} correction cycles (max ${MAX_CORRECTIONS}). Escalate rather than loop.`, 409);
  }
  run.corrections += 1;
  saveRun(run);
  transition(run, 'CORRECTING', `correction cycle ${run.corrections} of ${MAX_CORRECTIONS} via control surface`);
  const fresh = loadRun(run.runId);
  return Object.freeze({
    runId: fresh.runId,
    state: fresh.state,
    action: 'retry',
    correction: fresh.corrections,
    nextAction: `--build ${fresh.runId} --cmd "<command>"`,
  });
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
function cmdChecks(args) {
  const run = loadRun(args.runId);
  if (run.state !== 'BUILT') {
    throw new RunError('ILLEGAL-TRANSITION', `checks require BUILT, run is ${run.state}`);
  }
  const packet = run.packet;
  if (!packet || !fs.existsSync(path.resolve(ROOT, packet))) {
    throw new RunError('NO-PACKET', 'the run names no readable packet, so there are no declared testsRequired to run');
  }
  const pkt = JSON.parse(fs.readFileSync(path.resolve(ROOT, packet), 'utf8'));
  const cmds = (pkt.testsRequired || []).filter((c) => !/--gate-done|aegis-run/.test(c));
  if (!cmds.length) {
    transition(run, 'CHECKS_FAILED', 'the packet declares no runnable testsRequired');
    throw new RunError('NO-CHECKS', 'the packet declares no runnable checks. Zero checks passing is the absence of evidence, not evidence.');
  }
  const results = [];
  for (const cmd of cmds) {
    const r = spawnSync('bash', ['-lc', cmd], { cwd: run.worktree.path, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    results.push({ cmd, exit: r.status === null ? 124 : r.status });
  }
  run.checks = { ranAt: nowIso(), total: results.length, passed: results.filter((x) => x.exit === 0).length, results };
  saveRun(run);
  const allPassed = results.every((x) => x.exit === 0);
  transition(run, allPassed ? 'CHECKS_PASSED' : 'CHECKS_FAILED',
    `${run.checks.passed}/${run.checks.total} checks passed`);
  console.log(`${run.checks.passed}/${run.checks.total} checks passed`);
  return allPassed ? EXIT_PASS : EXIT_REFUSED;
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

module.exports = { STATES, MAX_CORRECTIONS, watchdog, REQUIRED_SEQUENCE, transition, loadRun, saveRun, listRuns, RunError, AegisControlError, normalizeObjective, createRunFromObjective, prepareRun, pauseRun, cancelRun, retryRun, runPath, RUNS_DIR, CHECKPOINTS_DIR, PACKETS_DIR };
