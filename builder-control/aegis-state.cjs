#!/usr/bin/env node
/**
 * aegis-state.cjs — the ONLY thing the dashboard is allowed to read.
 *
 * This is a projector, not a source. It reads real artifacts, types them, and
 * emits a snapshot in which every rendered fact carries the path it came from.
 * It computes nothing it cannot cite.
 *
 * THE THREE HONEST ABSENCES
 * A dashboard lies in three ways, and each has a required rendering here:
 *   UNAVAILABLE  the source does not exist or could not be read
 *   STALE        the source exists but its observation is older than the
 *                declared threshold — with the age shown, not hidden
 *   UNVERIFIED   nobody checked; there is no evidence either way
 * None of these is ever upgraded to a healthy value. There is no default that
 * means "probably fine": an unprobed connector is UNKNOWN, and a missing
 * reviewer record is UNVERIFIED.
 *
 * THE AUTHORITY BOUNDARY, MECHANICALLY
 * A connector whose `plane` is not "INTEGRATION" is REFUSED, not warned about.
 * Engineering authority lives in the control plane; a registry entry claiming
 * otherwise is a configuration attack surface, not a preference.
 *
 * FAILURE ISOLATION
 * engineering{} and integration{} are separate objects and are never blended.
 * A failed connector cannot downgrade verified engineering, and a failed sync
 * is never rendered as a success.
 *
 *   node builder-control/aegis-state.cjs [--json] [--subject-sha <sha>] [--packet <p>]
 *
 * Exit: 0 snapshot produced (its contents may be full of failures — that is a
 *       successful projection of a failing system) · 2 usage · 3 refused
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const REGISTRY = path.join(HERE, 'connector-registry.json');
const CANON = path.join(HERE, 'TOOL-CAPABILITY-CANON.json');
const LEDGER = path.join(HERE, 'ledger.json');
const ENGOS = path.join(HERE, 'engineering-os.cjs');
const PACKETS_DIR = path.join(HERE, 'packets');
// Private control identity captured with each run. Symbols are deliberately
// non-enumerable, so absolute worktree coordinates can be used to evaluate the
// canonical gate without ever entering JSON, state.js, or the public API.
const RUN_CONTROL_IDENTITY = Symbol('aegis-run-control-identity');
// The ONLY place a USD→CAD rate may come from. It is a dated, cited artifact on
// disk, never a network call and never a constant in this file. If it is absent
// or malformed, CAD renders UNAVAILABLE — an invented rate on a spend figure is
// a fabricated number wearing a currency symbol.
const FX_CANON = path.join(HERE, 'fx-canon.json');
const FX_STALE_DAYS = 7;

// ── injected evidence paths (READ side) ────────────────────────────────────
// Codex G1 findings #3/#4/#5. Every reader below resolved its artifact from a
// module-level constant and from nothing else, so the only way to stage a
// fixture was to OVERWRITE live canonical evidence and put it back in a
// `finally`. That is a concurrency window on the artifacts this system treats
// as authoritative — a snapshot taken mid-test observes the synthetic
// registry — and a crash between the two writes leaves the fixture in place as
// though it were real. It also made the suite unrunnable read-only: the review
// environment returned EPERM on that write.
//
// The dependency is now injectable, and the injection is deliberately narrow:
//
//   * It changes WHICH file is read. It changes no parsing rule, no threshold,
//     no verdict and no authority order. There is one projector, not two.
//   * It is confined to the OS temp directory — the same constraint, for the
//     same reason, as the writer's AEGIS_LEDGER_FILE. Useful for isolating a
//     test; useless for pointing the dashboard at some other checked-in file.
//   * The RESOLVED path is what the projection cites in `source`, so an
//     injected fixture reports itself as the temp file it is and can never be
//     read back as canonical evidence.
//
// Omit it and every reader resolves to the canonical production path, which is
// exactly what the CLI does.
const ENV_REGISTRY = 'AEGIS_CONNECTOR_REGISTRY';

function resolveEvidencePath(override, canonical, envName) {
  const chosen = override != null && override !== ''
    ? override
    : (envName ? process.env[envName] : null);
  if (!chosen) return canonical;
  const abs = path.resolve(chosen);
  // Explicitly naming the canonical artifact is not a redirection.
  if (abs === canonical) return abs;
  const tmpRoot = fs.realpathSync(os.tmpdir());
  let real;
  try { real = fs.realpathSync(path.dirname(abs)); } catch { real = path.dirname(abs); }
  if (real !== tmpRoot && !real.startsWith(tmpRoot + path.sep)) {
    throw new Error(
      `${envName || 'the injected evidence path'} must point inside ${tmpRoot} (got ${abs}). ` +
      'Pointing the projector at another checked-in artifact would let a substituted file be ' +
      'projected as canonical evidence.'
    );
  }
  return abs;
}

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_REFUSED = 3;

const rel = (p) => path.relative(ROOT, p);

// The declared workflow sequence. Drift is measured against this and nothing
// else, so "what was required" is a fact in one place rather than an opinion
// held in several.
// The ELEVEN canonical V1 steps, exactly as AEGIS-V1-ARCHITECTURE-CONTRACT §8
// states them. This list previously held nine review-centric stages that
// predated the runtime, so the dashboard showed a topology the contract had
// already outgrown — steps 1, 2, 4, 5 and 8 were simply absent from the screen
// while the runtime that performs them existed and was tested.
//
// `evidence` names WHERE each step's state is read from. A step with no
// evidence source is UNVERIFIED, never assumed.
const REQUIRED_STAGES = [
  { id: 'objective',     step: 1,  label: 'Objective intake',       evidence: 'aegis-run run.objective' },
  { id: 'acceptance',    step: 2,  label: 'Acceptance + risk',      evidence: 'aegis-run run.risk (from --classify)' },
  { id: 'routing',       step: 3,  label: 'Capability routing',     evidence: 'aegis-run run.route (tool-router)' },
  { id: 'worktree',      step: 4,  label: 'Isolated worktree',      evidence: 'aegis-run run.worktree' },
  { id: 'build',         step: 5,  label: 'Builder execution',      evidence: 'aegis-run run.build.exit' },
  { id: 'deterministic', step: 6,  label: 'Deterministic checks',   evidence: 'gate observed / run.checks' },
  { id: 'review',        step: 7,  label: 'Independent review',     evidence: 'gate review records, subject-bound' },
  { id: 'correction',    step: 8,  label: 'Bounded corrections',    evidence: 'aegis-run run.corrections vs MAX_CORRECTIONS' },
  { id: 'watchdog',      step: 9,  label: 'Watchdog sequence',      evidence: 'aegis-run watchdog() over ledger transitions' },
  { id: 'checkpoint',    step: 10, label: 'Checkpoint + rollback',  evidence: 'aegis-run run.checkpoint.rollbackPoint' },
  { id: 'surface',       step: 11, label: 'Evidence + cost surface', evidence: 'this projection: cost, blockers, provenance' },
];

// These are the three non-terminal states the canonical asynchronous worker
// writes while the run itself remains BUILDING.  A null exit in any of these
// states means exactly "the worker has not exited yet"; it is not a failed
// exit and must never be rendered as one.
const ACTIVE_ASYNC_WORKER_STATES = new Set(['LAUNCH_CLAIMED', 'STARTING', 'RUNNING']);

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Every value the UI renders goes through one of these two constructors, so a
// field physically cannot reach the screen without a provenance path or an
// explicit absence.
function value(v, source, extra = {}) {
  return { value: v, source: rel(source), ...extra };
}
function absent(kind, reason, source) {
  return { value: null, state: kind, reason, source: source ? rel(source) : null };
}

function ageMinutes(iso, now) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 60000);
}

// ── connectors: THREE independent facts, never one ──────────────────────────
// The defect this replaces: one "health" chip stood for all three questions a
// founder is actually asking, and it answered them all with the most flattering
// one. Every connector read HEALTHY because a credential worked — so the page
// said the system was consulting Notion, GitHub and Make, and nothing had.
//
//   authentication  — is the credential/session valid?           (authStatus)
//   lastVerified    — when did a probe last succeed, and is that fresh?
//                                                        (healthEvidence.observedAt)
//   lastUsedByRun   — which exact run last CONSUMED it?          (usageEvidence)
//
// None is derived from any other. In particular there is no path by which
// authentication or a successful probe can produce a lastUsedByRun: usage is
// written only by a USAGE receipt naming a run (connector-receipt.cjs), and is
// corroborated only against the append-only ledger. A connector that is
// authenticated, freshly probed, and used by nobody renders exactly that.
const USAGE_UNAVAILABLE_REASON =
  'No run has recorded using this connector. Being authenticated and reachable is not the same as being consulted, ' +
  'so this reads UNAVAILABLE rather than borrowing the credential\'s good news.';

// The vocabulary a credential state may use. Anything else is not a state we
// recognise, and an unrecognised state is UNAVAILABLE — never quietly kept.
const AUTH_VOCABULARY = new Set(['AUTHENTICATED', 'NOT_AUTHORIZED', 'AUTH_EXPIRED', 'UNKNOWN']);

// A probe that positively succeeded, and nothing else, may date a verification.
const SUCCESS_HEALTH = new Set(['HEALTHY']);
const FAILURE_HEALTH = new Set(['FAILED', 'AUTH_EXPIRED', 'RATE_LIMITED', 'DISCONNECTED']);

// ── authentication: dated, or it does not count ─────────────────────────────
// This used to read a bare `authStatus` string with no observation time, so a
// credential last checked in March and one checked a minute ago rendered
// identically, and neither could ever be called stale because there was no date
// to call stale. Authentication now requires its OWN dated evidence
// (`authEvidence`), ages against the same freshness threshold as everything
// else, and fails CLOSED: no evidence is UNAVAILABLE, not UNKNOWN-but-fine.
function projectAuthentication(c, now = Date.now(), threshold = 60) {
  const source = rel(REGISTRY);
  const undated = c && typeof c.authStatus === 'string' ? c.authStatus : null;
  const ev = c && c.authEvidence && typeof c.authEvidence === 'object' ? c.authEvidence : null;
  const unavailable = (plain) => ({
    state: 'UNAVAILABLE', raw: undated, observedAt: ev && ev.observedAt ? ev.observedAt : null,
    ageMinutes: null, thresholdMinutes: threshold, source, plain,
  });

  if (!ev || !ev.observedAt || typeof ev.authStatus !== 'string') {
    return unavailable(
      'Nobody has recorded a DATED check of our credential for this service. An undated credential state is not ' +
      'evidence of a working credential, so this reads UNAVAILABLE rather than repeating a claim with no date on it.'
    );
  }
  const raw = ev.authStatus;
  if (!AUTH_VOCABULARY.has(raw)) {
    return unavailable(`The recorded credential state ("${raw}") is not one this system recognises, so it cannot be trusted.`);
  }
  const age = ageMinutes(ev.observedAt, now);
  if (age === null) {
    return unavailable(`The recorded credential check time ("${ev.observedAt}") cannot be read as a date, so the check cannot be trusted.`);
  }
  if (age < 0) {
    return unavailable(`The recorded credential check is dated in the future ("${ev.observedAt}"), so it cannot be trusted.`);
  }
  const dated = { raw, observedAt: ev.observedAt, ageMinutes: age, thresholdMinutes: threshold, source };
  if (raw === 'UNKNOWN') {
    return { state: 'UNVERIFIED', ...dated,
      plain: `A check ${age} minute(s) ago could not determine whether our credential for this service works.` };
  }
  if (age > threshold) {
    return { state: 'STALE', ...dated,
      plain: `Our credential last read as ${raw} ${age} minute(s) ago — older than the ${threshold}-minute freshness ` +
        'limit. It may have been revoked or expired since, and nothing here would know.' };
  }
  const plain = {
    AUTHENTICATED: `Our credential for this service was valid when checked ${age} minute(s) ago.`,
    NOT_AUTHORIZED: `Our credential was rejected by this service ${age} minute(s) ago. It needs reconnecting.`,
    AUTH_EXPIRED: `Our credential was expired when checked ${age} minute(s) ago. It needs reconnecting.`,
  }[raw];
  return { state: raw, ...dated, plain };
}

// ── a receipt that contradicts itself verifies nothing ──────────────────────
// PROVEN DEFECT (Codex REV-20260826023038-codex finding #4): `outcome` was
// trusted verbatim, so a receipt reading {health:'FAILED', outcome:'SUCCESS'}
// dated the verification off its own failure and the connector projected
// "Checked 5 minute(s) ago and it responded." A self-contradicting receipt is
// not better evidence than no receipt — it is evidence that something is
// writing receipts wrongly, and the reading taken from it must never be the
// flattering one.
//
// The correction is deliberately ONE-DIRECTIONAL. A SUCCESS claim must be
// corroborated by the health evidence (agreeing, or absent) before it may date
// a verification. A FAILURE claim is always honoured, because downgrading a
// self-reported failure to "we do not know" would be the same defect facing the
// other way.
const PROBE_SUCCESS = 'SUCCESS';
const PROBE_FAILURE = 'FAILURE';
const PROBE_INCONCLUSIVE = 'INCONCLUSIVE';
const PROBE_CONTRADICTORY = 'CONTRADICTORY';

// What the recorded health word, on its own, says about the probe. `null` means
// no health word was recorded at all — which is different from one that was
// recorded and means nothing recognisable.
function healthOutcomeClass(health) {
  if (SUCCESS_HEALTH.has(health)) return PROBE_SUCCESS;
  if (FAILURE_HEALTH.has(health)) return PROBE_FAILURE;
  return typeof health === 'string' && health ? PROBE_INCONCLUSIVE : null;
}

function classifyProbeOutcome(declared, health) {
  const fromHealth = healthOutcomeClass(health);
  // No declared outcome: read the receipt through the health vocabulary, as
  // older registries are written. DEGRADED and UNKNOWN land on INCONCLUSIVE
  // deliberately — "it answered, badly" and "we do not know" are not proof that
  // the service responded.
  if (typeof declared !== 'string' || !declared) return fromHealth || PROBE_INCONCLUSIVE;
  if (declared === PROBE_FAILURE) return PROBE_FAILURE;
  // A word this system does not recognise is not a verdict.
  if (declared !== PROBE_SUCCESS) return PROBE_INCONCLUSIVE;
  if (fromHealth === null || fromHealth === PROBE_SUCCESS) return PROBE_SUCCESS;
  // SUCCESS claimed against health evidence that says otherwise.
  return fromHealth === PROBE_FAILURE ? PROBE_CONTRADICTORY : PROBE_INCONCLUSIVE;
}

// What the MOST RECENT probe actually did. `outcome` is the CORROBORATED
// reading; `declaredOutcome` is what the receipt claimed, kept so the
// disagreement can be stated rather than silently resolved.
function latestProbe(c) {
  const ev = c && c.healthEvidence && typeof c.healthEvidence === 'object' ? c.healthEvidence : null;
  if (!ev || !ev.observedAt) return null;
  const health = typeof ev.health === 'string' ? ev.health
    : (c && typeof c.health === 'string' ? c.health : null);
  const declaredOutcome = typeof ev.outcome === 'string' && ev.outcome ? ev.outcome : null;
  const outcome = classifyProbeOutcome(declaredOutcome, health);
  return {
    observedAt: ev.observedAt, outcome, declaredOutcome, health,
    contradictsHealth: outcome === PROBE_CONTRADICTORY,
    ts: Date.parse(ev.observedAt),
  };
}

// One sentence, used everywhere a contradiction is disclosed, so the page never
// has two different explanations for the same broken receipt.
function contradictionNote(probe) {
  return `The most recent check (${probe.observedAt}) contradicts itself: it claims the outcome ` +
    `${probe.declaredOutcome} while its own health evidence reads ${probe.health}. Evidence that disagrees with ` +
    'itself is not a successful check, so it verifies nothing.';
}

// ── lastVerified: only a SUCCESSFUL probe may date a verification ───────────
// The defect: every health receipt counted as a verification, so a connector
// whose probe had just timed out projected FRESH — "Checked 5 minute(s) ago and
// it responded" — off the timestamp of the failure itself. A failed probe now
// can never produce FRESH. The last time the service actually responded is kept
// (a failure does not erase history), and the failure is shown alongside it, so
// neither fact gets to speak for the other.
function projectLastVerified(c, now, threshold) {
  const source = rel(REGISTRY);
  const probe = latestProbe(c);
  const verEv = c && c.verificationEvidence && c.verificationEvidence.observedAt
    ? c.verificationEvidence.observedAt : null;
  const success = verEv
    || (probe && probe.outcome === PROBE_SUCCESS ? probe.observedAt : null)
    || (c && typeof c.lastSuccess === 'string' ? c.lastSuccess : null);
  const probeAge = probe ? ageMinutes(probe.observedAt, now) : null;
  // A probe dated in the future has an age, and it is negative. Publishing it
  // renders as "checked -12240 minute(s) ago", i.e. more recent than now, so
  // the age is withheld exactly as it is for a failed probe; the timestamp
  // itself stays visible and the prose below names it.
  const probeFuture = probeAge !== null && probeAge < 0;
  const latestProbeFact = probe
    ? { observedAt: probe.observedAt, outcome: probe.outcome, declaredOutcome: probe.declaredOutcome,
        contradictsHealth: probe.contradictsHealth, ageMinutes: probeFuture ? null : probeAge }
    : null;
  const base = { thresholdMinutes: threshold, source, latestProbe: latestProbeFact };

  if (!probe && !success) {
    return { state: 'UNVERIFIED', observedAt: null, ageMinutes: null, ...base,
      plain: 'This service has never been checked, so we do not know whether it is actually reachable.' };
  }
  const successAge = success ? ageMinutes(success, now) : null;
  if (!success || successAge === null || successAge < 0) {
    const why = !success
      ? 'No successful check has ever been recorded for this service.'
      : (successAge !== null && successAge < 0
          ? `The recorded success time ("${success}") is dated in the FUTURE, so nothing was observed at it and it ` +
            'cannot be used as evidence that this service responded.'
          : `The recorded success time ("${success}") cannot be read as a usable date.`);
    const probeNote = probe
      ? (probe.contradictsHealth
          ? ' ' + contradictionNote(probe)
          : probeFuture
            ? ` The most recent check (${probe.observedAt}) is dated in the future — a check cannot have happened yet, ` +
              'so whatever it records is unusable, however successful it claims to be.'
            : ` The most recent check (${probe.observedAt}) did not succeed — it is recorded as ${probe.outcome}.`)
      : '';
    return { state: 'UNVERIFIED', observedAt: null, ageMinutes: null, ...base, plain: why + probeNote };
  }
  const successTs = Date.parse(success);
  const probeSupersedes = !!probe && probe.outcome !== PROBE_SUCCESS
    && (Number.isNaN(probe.ts) || Number.isNaN(successTs) || probe.ts >= successTs);
  const dated = { observedAt: success, ageMinutes: successAge, ...base };

  if (probeSupersedes && probe.outcome === PROBE_CONTRADICTORY) {
    return { state: 'UNVERIFIED', ...dated,
      plain: contradictionNote(probe) +
        ` The last confirmed response was ${success}, ${successAge} minute(s) ago — that is history, not a current verification.` };
  }
  if (probeSupersedes && probe.outcome === PROBE_FAILURE) {
    return { state: 'FAILED', ...dated,
      plain: `The most recent check FAILED (${probe.observedAt}). The last time this service actually responded was ` +
        `${success}, ${successAge} minute(s) ago — that is history, not a current verification.` };
  }
  if (probeSupersedes) {
    return { state: 'UNVERIFIED', ...dated,
      plain: `The most recent check (${probe.observedAt}) was inconclusive, so it verifies nothing. The last confirmed ` +
        `response was ${success}, ${successAge} minute(s) ago.` };
  }
  if (successAge > threshold) {
    return { state: 'STALE', ...dated,
      plain: `Last checked ${successAge} minutes ago — older than the ${threshold}-minute freshness limit. It may have broken since.` };
  }
  return { state: 'FRESH', ...dated, plain: `Checked ${successAge} minute(s) ago and it responded.` };
}

// ── the ledger is the authoritative usage record ────────────────────────────
// A USAGE receipt in the registry is a CLAIM by the thing being described. The
// append-only ledger is written by the control plane as work happens, which is
// why corroboration runs against it and only it. Corroboration used to be an
// operationId appearing anywhere in the ledger under any INTEGRATION entry —
// a collision with an unrelated event was enough. It is now SEMANTIC: the same
// connector, the same run, the same operation, a successful consumption, and a
// timestamp that agrees with the claim. Miss any one of those and the claim
// stays a claim.
const LEDGER_USAGE_GATE = 'connector-usage';

// The ONLY success status a connector-usage entry can carry.
//
// PROVEN DEFECT (AEGIS reviewer finding #1): this set was
// ['PASS', 'OK', 'SUCCESS']. Neither 'OK' nor 'SUCCESS' appears in the status
// enum of ledger-entry.schema.json, so the canonical writer refuses both — the
// projector was reading, and reporting as canonical control-plane truth, two
// statuses no approved write could ever have produced. Anything arriving with
// one of them got there around the writer, and a projector that honours it is
// laundering an unstorable shape into a governance answer. The status enum is
// PASS | BLOCKED | INCOMPLETE | IMPORTED | FAILED; of those, exactly one means
// "this connector was successfully consumed".
const LEDGER_SUCCESS_STATUS = new Set(['PASS']);
const USAGE_CORRELATION_WINDOW_MINUTES = 5;

// ONE validation contract, borrowed rather than restated.
//
// The rule this projector needs — "is this a valid canonical ledger entry?" —
// already has exactly one authority: ledger-writer.validateEntry() against
// builder-control/schemas/ledger-entry.schema.json. Re-implementing any part of
// it here (a required-field list, an inlined status enum, a property allowlist)
// would create a SECOND contract that drifts from the first the day the schema
// changes, and the two would then disagree about what the ledger contains. So
// the canonical validator is imported and called, and nothing is duplicated.
const { validateEntry: validateLedgerEntry } = require('./ledger-writer.cjs');

function normalizeLedgerUsageEvents(entries) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e !== 'object') continue;
    if (e.plane !== 'INTEGRATION') continue;
    // The consumption TYPE, not merely "something happened on this plane".
    if (e.gate !== LEDGER_USAGE_GATE) continue;
    // SCHEMA GATE. A candidate usage entry must be an entry the canonical
    // writer would have accepted — every required field present (entryId, ts,
    // agentId, gate, status), every property known, every value in range. An
    // entry that fails is not a weaker use, it is not a use: it is evidence
    // that never passed the approved write path, and the projection fails
    // closed on it rather than reporting it as a run's consumption.
    //
    // This runs AFTER the two cheap coordinate checks purely as a read
    // optimisation — a non-usage entry is discarded either way, so the outcome
    // is identical and only the work differs.
    if (validateLedgerEntry(e).length) continue;
    if (!LEDGER_SUCCESS_STATUS.has(e.status)) continue;
    const connectorId = typeof e.connectorId === 'string' && e.connectorId ? e.connectorId : null;
    // THE RUN COORDINATE IS `correlationId`, and only that.
    //
    // Codex G1 finding #1: this used to prefer a top-level `runId` and fall
    // back to correlationId. `runId` is not in ledger-entry.schema.json and
    // additionalProperties is false, so NO entry the canonical writer will
    // accept can ever carry one — the preferred path was reachable only by a
    // fixture that skipped the writer. Reading a coordinate the store cannot
    // hold is a second, unwritable authority on "which run used this", so it
    // is gone. connectorId is now a real schema property; correlationId was
    // already one and is documented there as the run coordinate.
    const runId = typeof e.correlationId === 'string' && e.correlationId ? e.correlationId : null;
    const operationId = typeof e.operationId === 'string' && e.operationId ? e.operationId : null;
    const ts = Date.parse(e.ts);
    if (!connectorId || !runId || !operationId || Number.isNaN(ts)) continue;
    out.push({ connectorId, runId, operationId, ts, observedAt: e.ts, entryId: e.entryId || null });
  }
  return out;
}

// Read once per snapshot. A missing or unreadable ledger yields an empty list,
// which makes every usage claim read as uncorroborated — the strict reading,
// never the kind one.
// `ledgerFile` lets a caller (in practice: a test that just appended through
// the canonical writer) point this at an isolated ledger. It changes WHICH
// ledger file is read and nothing else — same normalizer, same rules, same
// fail-closed empty list. There is no second parser and no second authority.
function ledgerUsageEvents(ledgerFile) {
  try {
    return normalizeLedgerUsageEvents(readJSON(ledgerFile || LEDGER));
  } catch { return []; }
}

function toEventArray(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input[Symbol.iterator] === 'function') return [...input];
  return [];
}

// Deterministic newest-wins ordering over canonical events. Newest by
// timestamp; ties broken by operationId then runId then entryId so the SAME set
// of events always names the SAME winner regardless of the order the ledger
// happened to be read in.
function newestUsageEvent(list) {
  const ordered = list.slice().sort((a, b) =>
    (a.ts - b.ts)
    || (a.operationId > b.operationId ? 1 : a.operationId < b.operationId ? -1 : 0)
    || (a.runId > b.runId ? 1 : a.runId < b.runId ? -1 : 0)
    || (String(a.entryId) > String(b.entryId) ? 1 : String(a.entryId) < String(b.entryId) ? -1 : 0));
  return ordered.length ? ordered[ordered.length - 1] : null;
}

// Usage is the one fact that cannot be observed from the connector's side, so
// the APPEND-ONLY LEDGER is the authority for it and the registry is not.
//
// PROVEN DEFECT (Codex REV-20260826023038-codex finding #2): the registry's own
// `usageEvidence` gated the answer. A connector with no claim projected
// UNAVAILABLE even while the ledger held a recorded successful use, and a
// connector whose claim named RUN-1/op-1 projected RUN-1 even when the ledger
// held a NEWER use by RUN-2/op-2. In both directions a self-report about the
// connector was allowed to suppress or override canonical control-plane truth,
// which is the opposite of the authority order this system is built on.
//
// The order now, and there is only one:
//   1. The ledger records a successful consumption of this connector → USED,
//      bound to the NEWEST such event, across any run and any operation.
//   2. No ledger event, but the registry claims one → UNVERIFIED. A connector's
//      claim about itself is never promoted to USED.
//   3. Neither → UNAVAILABLE.
// The registry claim is still carried in `claim`, and whether the ledger
// corroborates that exact claim is reported separately as `claimCorroborated` —
// two different questions, two different fields, neither answering the other.
// A THIRD field, `claimCorroboratesReportedUse`, answers the only question that
// may license a citation: does the claim corroborate the event being reported?
// Provenance travels with that event alone.
// `sources` names the artifacts this projection CITES. It defaults to the
// canonical pair, and an isolated caller passes the temp files it actually
// read — a projection that cited connector-registry.json while reading a
// fixture would be a fabricated provenance line.
function projectLastUsedByRun(c, ledgerEvents, sources = {}) {
  const registryPath = sources.registryPath || REGISTRY;
  const ledgerPath = sources.ledgerPath || LEDGER;
  const source = rel(registryPath);
  const u = c && c.usageEvidence && typeof c.usageEvidence === 'object' ? c.usageEvidence : null;
  const connectorId = c && typeof c.connectorId === 'string' ? c.connectorId : null;
  const forConnector = toEventArray(ledgerEvents)
    .filter((e) => e && typeof e === 'object' && e.connectorId && e.connectorId === connectorId);

  const claim = u && u.runId && u.observedAt
    ? { runId: u.runId, observedAt: u.observedAt, operationId: u.operationId || null,
        citedSource: u.citedSource || null }
    : null;

  // Does the ledger corroborate THE CLAIM itself — same connector, same run,
  // same operation, successful consumption, timestamp inside the window? This
  // no longer decides `state`; it is reported as its own fact.
  const claimTs = claim ? Date.parse(claim.observedAt) : NaN;
  const windowMs = USAGE_CORRELATION_WINDOW_MINUTES * 60000;
  const corroboratesClaim = (e) => !!claim && !!claim.operationId
    && e.operationId === claim.operationId
    && e.runId === claim.runId
    && !Number.isNaN(claimTs) && Math.abs(e.ts - claimTs) <= windowMs;
  const corroborating = claim ? forConnector.filter(corroboratesClaim) : [];
  const claimCorroborated = corroborating.length > 0;

  const newest = newestUsageEvent(forConnector);

  // A THIRD question, distinct from both of the above: does the claim
  // corroborate the event actually BEING REPORTED?
  //
  // Codex G1 finding #2: it did not have to. `claimCorroborated` was true as
  // soon as the claim matched ANY canonical event, including an older one, and
  // the reported line then borrowed that claim's citedSource for the NEWER
  // winning event. The page said "Run RUN-2 used this service, citing src.ts"
  // when src.ts was cited by RUN-1's claim about a different operation. That is
  // one operation's evidence presented as another's — exactly the provenance
  // error a usage audit trail exists to prevent. Only the winning event's own
  // corroboration may lend a source.
  const claimCorroboratesReportedUse = !!newest && corroboratesClaim(newest);

  if (!newest) {
    if (!claim) {
      return { state: 'UNAVAILABLE', runId: null, observedAt: null, operationId: null,
        citedSource: null, ledgerConfirmed: false, claim: null, claimCorroborated: false,
        claimCorroboratesReportedUse: false, ledgerEventCount: 0, source,
        plain: USAGE_UNAVAILABLE_REASON };
    }
    return { state: 'UNVERIFIED', runId: null, observedAt: null, operationId: null,
      citedSource: null, ledgerConfirmed: false, claim, claimCorroborated: false,
      claimCorroboratesReportedUse: false, ledgerEventCount: 0, source,
      plain: `This connector claims run ${claim.runId} used it on ${claim.observedAt}, but the permanent ledger records ` +
        'no successful use of this service at all. A connector\'s claim about itself is not evidence that a run ' +
        'consulted it, so this reads UNVERIFIED rather than USED.' };
  }

  // The ledger has spoken. Whatever the registry says, the newest canonical
  // event is what a run actually consumed most recently.
  let claimNote;
  if (!claim) {
    claimNote = ' This connector has recorded no usage claim of its own; the ledger is the whole of this evidence.';
  } else if (claimCorroboratesReportedUse) {
    claimNote = '';
  } else if (claimCorroborated) {
    // The claim is true of SOMETHING, just not of the use being reported.
    // Saying so is the whole point: silence here is what let one operation's
    // source stand in for another's.
    claimNote = ` This connector separately claims run ${claim.runId} used it on ${claim.observedAt}. The ledger does ` +
      'corroborate that claim, but against an EARLIER recorded use — not the one reported above — so nothing from ' +
      'that claim, including any source it cites, is carried over here.';
  } else {
    claimNote = ` This connector separately claims run ${claim.runId} used it on ${claim.observedAt}; the ledger does not ` +
      'corroborate that exact claim, so the ledger entry above is what is reported.';
  }
  // Only a claim that corroborates THE REPORTED EVENT may lend its cited
  // source. Any other claim — uncorroborated, or corroborating some other
  // entry — describes a different use and cites nothing here.
  const citedSource = claimCorroboratesReportedUse ? claim.citedSource : null;
  return {
    state: 'USED',
    runId: newest.runId,
    observedAt: newest.observedAt,
    operationId: newest.operationId,
    citedSource,
    ledgerConfirmed: true,
    claim,
    claimCorroborated,
    claimCorroboratesReportedUse,
    ledgerEventCount: forConnector.length,
    ledgerEntryId: newest.entryId,
    source: rel(ledgerPath),
    plain: `Run ${newest.runId} used this service` +
      (citedSource ? `, citing ${citedSource}` : '') +
      ` on ${newest.observedAt}. The permanent ledger records that exact use` +
      (newest.entryId ? ` (${newest.entryId}).` : '.') + claimNote,
  };
}

// `opts.registryPath` / `opts.ledgerFile` inject the two artifacts this
// projection reads. Both default to the canonical production paths, both are
// confined to a temp directory when supplied, and both are cited by the paths
// actually resolved. Nothing else about the projection changes: the same
// staleness rules, the same authority order, the same refusal.
function projectConnectors(now, opts = {}) {
  const registryPath = resolveEvidencePath(opts && opts.registryPath, REGISTRY, ENV_REGISTRY);
  const ledgerPath = resolveEvidencePath(opts && opts.ledgerFile, LEDGER, null);
  if (!fs.existsSync(registryPath)) {
    return { state: 'UNAVAILABLE', reason: `connector registry not found at ${rel(registryPath)}`, connectors: [] };
  }
  let reg;
  try { reg = readJSON(registryPath); }
  catch (e) { return { state: 'UNAVAILABLE', reason: `connector registry unreadable: ${e.message}`, connectors: [] }; }

  const threshold = Number(reg.stalenessThresholdMinutes) > 0 ? Number(reg.stalenessThresholdMinutes) : 60;
  const vocab = new Set(reg.healthVocabulary || []);
  const usageEvents = ledgerUsageEvents(ledgerPath);
  const connectors = [];

  for (const c of reg.connectors || []) {
    // Refuse, do not warn. A connector claiming control-plane standing is the
    // one thing this whole amendment exists to make impossible.
    if (c.plane !== 'INTEGRATION') {
      const err = new Error(
        `connector "${c.connectorId}" declares plane "${c.plane}". Only INTEGRATION-plane connectors may be loaded. ` +
        'External systems execute actions; they never hold engineering authority.'
      );
      err.refused = true;
      throw err;
    }

    // An unprobed connector is UNKNOWN. Never HEALTHY by omission.
    let health = vocab.has(c.health) ? c.health : 'UNKNOWN';
    const ev = c.healthEvidence || null;
    const probe = latestProbe(c);
    const authentication = projectAuthentication(c, now, threshold);
    let staleness = null;
    if (!ev || !ev.observedAt) {
      health = 'UNKNOWN';
      staleness = { state: 'UNVERIFIED', reason: 'no dated health evidence has ever been recorded' };
    } else {
      const age = ageMinutes(ev.observedAt, now);
      if (age === null) {
        health = 'UNKNOWN';
        staleness = { state: 'UNVERIFIED', reason: `unparseable observedAt "${ev.observedAt}"` };
      } else if (age < 0) {
        // A check dated after the clock has observed nothing. The staleness
        // branches below all ask "how long ago", and a future timestamp answers
        // that with a negative number that fell straight through to FRESH — the
        // most recent reading on the page. Like unparseable evidence, this
        // fails closed: health is not carried forward, no `ageMinutes` is
        // published, and the reason names the timestamp.
        health = 'UNKNOWN';
        staleness = { state: 'UNVERIFIED', thresholdMinutes: threshold,
          reason: `the recorded check time "${ev.observedAt}" is dated in the future, so it cannot be used as ` +
            'evidence that this service was checked at all' };
      } else if (age > threshold) {
        // Staleness does NOT overwrite the last known health — it qualifies it.
        // Overwriting would destroy the only information we have; hiding it
        // would let an hours-old reading pose as live.
        staleness = { state: 'STALE', ageMinutes: age, thresholdMinutes: threshold,
          reason: `last observed ${age} minute(s) ago, threshold ${threshold}` };
      } else if (probe && probe.outcome === PROBE_CONTRADICTORY) {
        // A receipt at war with itself. Like a failed probe, it publishes no
        // `ageMinutes`, so nothing downstream can print it as a freshness age.
        staleness = { state: 'UNVERIFIED', probeAgeMinutes: age, thresholdMinutes: threshold,
          reason: `the most recent probe contradicts itself ${age} minute(s) ago: it claims ` +
            `${probe.declaredOutcome} while its health evidence reads ${probe.health}` };
      } else if (probe && probe.outcome === PROBE_FAILURE) {
        // A FAILED probe observed one minute ago is a fresh OBSERVATION of a
        // broken service, and the one thing it must never render as is FRESH.
        // `ageMinutes` is deliberately withheld so no consumer can print this
        // as a freshness age; the probe's own age is carried separately.
        staleness = { state: 'FAILED', probeAgeMinutes: age, thresholdMinutes: threshold,
          reason: `the most recent probe FAILED ${age} minute(s) ago` };
      } else if (probe && probe.outcome !== PROBE_SUCCESS) {
        staleness = { state: 'UNVERIFIED', probeAgeMinutes: age, thresholdMinutes: threshold,
          reason: `the most recent probe was inconclusive (${probe.outcome}) ${age} minute(s) ago` };
      } else {
        staleness = { state: 'FRESH', ageMinutes: age };
      }
    }

    connectors.push({
      connectorId: c.connectorId,
      label: c.label || c.connectorId,
      provider: c.provider || 'UNKNOWN',
      plane: c.plane,
      executionPath: c.executionPath || 'UNKNOWN',
      legacy: c.status === 'LEGACY_OPTIONAL',
      health,
      staleness,
      // The DATED verdict, not the undated string. A registry that still says
      // AUTHENTICATED with no recorded check date reads UNAVAILABLE here, so a
      // consumer rendering this field cannot restate an undated claim as fact.
      authStatus: authentication.state,
      authStatusRecorded: typeof c.authStatus === 'string' ? c.authStatus : null,
      capabilities: c.capabilities || [],
      declaredNotSupported: c.declaredNotSupported || [],
      failureCount: typeof c.failureCount === 'number' ? c.failureCount : null,
      lastSuccess: c.lastSuccess || null,
      lastFailure: c.lastFailure || null,
      riskLevel: c.riskLevel || 'UNKNOWN',
      evidence: ev ? { observedAt: ev.observedAt, method: ev.method, result: ev.result } : null,
      authorityNote: c.authorityNote || null,
      // THREE INDEPENDENT FACTS. Each is computed by its own function, from its
      // own source field, and none is derived from either of the others — see
      // the doctrine comment above projectAuthentication/projectLastVerified/
      // projectLastUsedByRun for why collapsing them was the original defect.
      authentication,
      lastVerified: projectLastVerified(c, now, threshold),
      lastUsedByRun: projectLastUsedByRun(c, usageEvents, { registryPath, ledgerPath }),
      source: rel(registryPath),
    });
  }
  return { state: 'OK', thresholdMinutes: threshold, connectors, source: rel(registryPath), ledgerSource: rel(ledgerPath) };
}

// ── reviewers (from the tool canon — availability with dated evidence) ──────
// The role each worker occupies on this surface. Copilot is listed because it
// EXISTS — a real, locally installed, canon-AVAILABLE worker — and a surface
// that hides a running worker is as dishonest as one that invents a passing
// stage. It is listed with its authority welded into the role string, not in a
// sibling field, because `role` is what the panel actually renders: a
// "repository guardian" row carrying an AVAILABLE chip and nothing else will be
// read as a third approver by the next person who looks at it.
const REVIEWER_ROLES = {
  'codex-local': 'independent review',
  'grok-cli': 'adversarial red team',
  'copilot-cli': 'repository guardian (advisory — cannot approve)',
};

function projectReviewers(now, canonPath = CANON) {
  if (!fs.existsSync(canonPath)) {
    return { state: 'UNAVAILABLE', reason: `tool canon not found at ${rel(canonPath)}`, reviewers: [] };
  }
  let canon;
  try { canon = readJSON(canonPath); }
  catch (e) { return { state: 'UNAVAILABLE', reason: `tool canon unreadable: ${e.message}`, reviewers: [] }; }

  const reviewers = [];
  for (const [toolId, role] of Object.entries(REVIEWER_ROLES)) {
    const t = (canon.tools || []).find((x) => x.toolId === toolId);
    if (!t) {
      reviewers.push({ toolId, role, availability: 'UNAVAILABLE',
        reason: 'not present in the Tool Capability Canon', evidence: null, source: rel(canonPath) });
      continue;
    }
    const ev = t.availabilityEvidence || null;
    reviewers.push({
      toolId, role,
      label: t.label || toolId,
      // Copied from the canon, never derived. This projector can see that a
      // Copilot binary sits on this machine — and seeing it must change nothing
      // here, or the canon stops being the single place availability is decided
      // and the dashboard becomes a second, quieter authority.
      availability: t.availability || 'UNKNOWN',
      // Approval authority is likewise READ, not assumed. A canon entry that
      // declares none leaves this UNVERIFIED rather than defaulting either way:
      // "we never wrote it down" and "it may approve" are different facts.
      approvalAuthority: t.approvalAuthority || 'UNVERIFIED',
      enabled: t.enabled !== false,
      evidence: ev ? { observedAt: ev.observedAt, method: ev.method, result: ev.result } : null,
      evidenceAgeMinutes: ev && ev.observedAt ? ageMinutes(ev.observedAt, now) : null,
      source: rel(canonPath),
    });
  }
  return { state: 'OK', reviewers };
}

// ── engineering state (the gate's own verdict — never re-judged here) ───────
function unavailableEngineering(reason, context = {}) {
  const runs = Array.isArray(context.runs) ? context.runs : [];
  const derivedStages = runs.length
    ? deriveStages({ problems: [], observed: [] }, runs, context.surfaceEvidence || null)
    : REQUIRED_STAGES.map((stage) => ({
        ...stage,
        state: 'UNVERIFIED',
        reason: `engineering gate unavailable: ${reason}`,
      }));
  // Runtime lifecycle evidence may still truthfully describe build/check
  // progress while the exact-subject gate is unavailable. Independent review
  // is different: without one parsed gate, mutable run state cannot establish
  // a review failure or approval, so that stage must fail closed as unknown.
  const stages = derivedStages.map((stage) => stage.id === 'review'
    ? { ...stage, state: 'UNVERIFIED', reason: `engineering gate unavailable: ${reason}` }
    : stage);
  return {
    state: 'UNAVAILABLE',
    reason,
    source: rel(ENGOS),
    stages,
  };
}

function currentPacketCoordinate(packetPath) {
  if (typeof packetPath !== 'string' ||
      !/^builder-control\/packets\/[A-Za-z0-9._-]+\.json$/.test(packetPath)) return null;
  let packetReal;
  let packetsReal;
  try {
    packetReal = fs.realpathSync(path.resolve(ROOT, packetPath));
    packetsReal = fs.realpathSync(PACKETS_DIR);
    if (!fs.statSync(packetReal).isFile() ||
        (packetReal !== packetsReal && !packetReal.startsWith(packetsReal + path.sep))) return null;
  } catch { return null; }
  const bytes = fs.readFileSync(packetReal);
  return {
    path: path.relative(ROOT, packetReal),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function validCanonicalSubject(value) {
  return Boolean(value && isSubjectSha(value.subjectSha256) &&
    Array.isArray(value.subjectPaths) && value.subjectPaths.length > 0 &&
    new Set(value.subjectPaths).size === value.subjectPaths.length &&
    value.subjectPaths.every((item) => typeof item === 'string' && item.length > 0 &&
      !path.isAbsolute(item) && !item.split('/').includes('..')) &&
    Number.isInteger(value.diffBytes) && value.diffBytes > 0 &&
    typeof value.range === 'string' && value.range.length > 0);
}

function canonicalReviewRefusal(gate, claim, subject, packet, receipt) {
  if (!claim || !gate || gate.ok !== false || gate.state !== 'BLOCKED' ||
      !validCanonicalSubject(subject) || !gate.subject ||
      gate.subject.subjectSha256 !== subject.subjectSha256 ||
      !gate.reviewerCompleteness || gate.reviewerCompleteness.complete !== true ||
      gate.reviewerCompleteness.subjectSha256 !== subject.subjectSha256 ||
      !Array.isArray(gate.reviewerCompleteness.rows) || !Array.isArray(gate.problems) ||
      !packet || !receipt || receipt.receiptSha256 !== claim.checkReceiptSha256 ||
      claim.subjectSha256 !== subject.subjectSha256 ||
      !claim.packet || claim.packet.path !== packet.path || claim.packet.sha256 !== packet.sha256) return null;
  const coverage = gate.reviewerCompleteness.pathCoverage;
  const requiredRows = gate.reviewerCompleteness.rows.filter((row) => row && row.required === 'REQUIRED');
  if (!coverage || !Array.isArray(coverage.notCoveredByEveryRequiredReviewer) ||
      coverage.notCoveredByEveryRequiredReviewer.length !== 0 || requiredRows.length === 0 ||
      requiredRows.some((row) => row.executed !== 'EXECUTED' ||
        typeof row.reviewer !== 'string' || typeof row.reviewId !== 'string' ||
        (Array.isArray(row.missingPaths) && row.missingPaths.length !== 0) ||
        (Array.isArray(row.stalePaths) && row.stalePaths.length !== 0))) return null;
  const refusalProblems = gate.problems.filter((problem) => problem &&
    (problem.rule === 'ENGOS-REVIEW-REJECTED' || problem.rule === 'ENGOS-OPEN-BLOCKING-FINDING'));
  if (refusalProblems.length === 0) return null;
  const openBlockingReviewers = new Set();
  for (const problem of refusalProblems) {
    if (problem.rule !== 'ENGOS-OPEN-BLOCKING-FINDING') continue;
    const match = /^(?:CRITICAL|HIGH) from ([a-z0-9][a-z0-9._-]{0,63}) in /i.exec(
      String(problem.detail || ''));
    if (!match) return null;
    openBlockingReviewers.add(match[1].toLowerCase());
  }
  const rejectedReviewers = gate.reviewerCompleteness.rows.flatMap((row) => {
    if (!row || row.executed !== 'EXECUTED' ||
        (row.disposition !== 'REJECT' &&
          !openBlockingReviewers.has(String(row.reviewer || '').toLowerCase())) ||
        typeof row.reviewer !== 'string' || typeof row.reviewId !== 'string') return [];
    return [{ reviewer: row.reviewer, reviewId: row.reviewId }];
  });
  const blockingFindingCount = refusalProblems.filter((problem) =>
    problem.rule === 'ENGOS-OPEN-BLOCKING-FINDING').length;
  if (rejectedReviewers.length === 0 ||
      JSON.stringify(rejectedReviewers) !== JSON.stringify(claim.rejectedReviewers) ||
      blockingFindingCount !== claim.blockingFindingCount ||
      refusalProblems.length !== claim.refusalRuleCount) return null;
  return claim;
}

// True only when the run worktree's HEAD has moved off its base commit — i.e.
// the builder committed. Read from git through the same validated environment
// the gate itself runs under; anything unreadable answers false, which leaves
// the previous baseless behaviour exactly as it was.
function committedPastBase(baseCommit, gateEnv) {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: ROOT, env: gateEnv, encoding: 'utf8',
  });
  if (head.status !== 0) return false;
  const headOid = (head.stdout || '').trim();
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(headOid) || headOid === baseCommit) return false;
  // The base must be an ancestor of HEAD, or `base..HEAD` is not this run's
  // change but an unrelated divergence.
  return spawnSync('git', ['merge-base', '--is-ancestor', baseCommit, headOid], {
    cwd: ROOT, env: gateEnv, encoding: 'utf8',
  }).status === 0;
}

function projectEngineering(args, context = {}) {
  const currentRun = context.currentRun || null;
  const identity = currentRun && currentRun[RUN_CONTROL_IDENTITY];
  if (!identity) {
    return unavailableEngineering(
      'no unique validated current run worktree is available, so the engineering gate cannot be attributed to this dashboard run',
      context);
  }
  let gateEnv;
  try {
    gateEnv = require('./aegis-run.cjs').canonicalGitEnvironment(identity);
  } catch (error) {
    return unavailableEngineering(
      `the current run worktree could not be validated for gate projection: ${error.message}`,
      context);
  }
  const runPacket = currentRun.packetId;
  const packet = currentPacketCoordinate(runPacket);
  if (!packet) {
    return unavailableEngineering(
      'the current run does not carry one currently validated bounded packet coordinate, so no gate verdict is attributed to it',
      context);
  }
  if (args.packet && args.packet !== runPacket) {
    return unavailableEngineering(
      'the caller-supplied packet conflicts with the validated current run; refusing to combine different subjects',
      context);
  }
  const reviewedGateRange = identity.reviewedGateRange || null;
  if (reviewedGateRange &&
      ((args.base && args.base !== reviewedGateRange.base) ||
       (args.head && args.head !== reviewedGateRange.head))) {
    return unavailableEngineering(
      'caller-supplied gate range conflicts with the validated reviewed checkpoint range; refusing to recompute a different subject',
      context);
  }
  // A run whose builder COMMITTED inside its governed worktree has a clean
  // HEAD, so the baseless `git diff HEAD` the subject falls back to reads zero
  // bytes and the dashboard reports UNAVAILABLE for a run that in fact carries
  // a complete, reviewable change. The run's own base commit is the range floor
  // that change was cut from, and canonicalGitEnvironment above has already
  // proven it: canonical OID, equal to the worktree's recorded base, and
  // present in this repository. So it becomes the DEFAULT base — never an
  // override. A reviewed checkpoint range still wins, an explicit caller base
  // still wins, and every conflict refusal above still fires first.
  //
  // The HEAD comparison is not optional. Before the builder commits, HEAD IS
  // the base commit and the real change lives only in the working tree, which
  // `base..HEAD` cannot see at all. Defaulting unconditionally would therefore
  // blank the subject of every in-flight run to fix the committed one.
  const runBase = !reviewedGateRange && !args.base && identity.baseCommit &&
    committedPastBase(identity.baseCommit, gateEnv) ? identity.baseCommit : null;
  const gateBase = reviewedGateRange ? reviewedGateRange.base : (args.base || runBase);
  const gateHead = reviewedGateRange ? reviewedGateRange.head : args.head;
  const subjectArgs = [ENGOS, '--subject', '--packet', runPacket, '--json'];
  if (gateBase) subjectArgs.push('--base', gateBase);
  if (gateHead) subjectArgs.push('--head', gateHead);
  if (args.diffLines) subjectArgs.push('--diff-lines', String(args.diffLines));
  for (const c of args.changed || []) subjectArgs.push('--changed', c);
  const subjectResult = spawnSync(process.execPath, subjectArgs, {
    cwd: ROOT, env: gateEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  let canonicalSubject = null;
  try { canonicalSubject = JSON.parse(subjectResult.stdout); } catch { /* handled below */ }
  if (subjectResult.status !== 0 || !validCanonicalSubject(canonicalSubject)) {
    return unavailableEngineering(
      `the canonical subject could not be derived from this run's validated worktree and packet (exit ${subjectResult.status})`,
      context);
  }
  const runSubject = currentRun.subjectSha256;
  if ((isSubjectSha(runSubject) && runSubject !== canonicalSubject.subjectSha256) ||
      (args.subjectSha && args.subjectSha !== canonicalSubject.subjectSha256)) {
    return unavailableEngineering(
      'the current worktree subject conflicts with a recorded or caller-supplied subject; refusing to combine different versions',
      context);
  }
  const runtime = require('./aegis-run.cjs');
  const checkRefs = identity.checks || {};
  const expectedReceipt = {
    runId: currentRun.runId,
    packetPath: packet.path,
    packetSha256: packet.sha256,
    subject: canonicalSubject,
  };
  const receipt = runtime.loadCanonicalCheckReceipt(checkRefs, expectedReceipt) ||
    runtime.loadCanonicalPreHostCheckReceipt(checkRefs, expectedReceipt);
  const gateDependent = ['CHECKS_PASSED', 'REVIEW_FAILED', 'REVIEW_BOUND', 'CHECKPOINTED', 'ROLLED_BACK']
    .includes(currentRun.state);
  if (gateDependent && !receipt) {
    return unavailableEngineering(
      'the current run has no digest-bound canonical check receipt for its current packet and worktree subject',
      context);
  }
  const a = [ENGOS, '--gate-done', '--json'];
  if (gateBase) a.push('--base', gateBase);
  if (gateHead) a.push('--head', gateHead);
  if (args.diffLines) a.push('--diff-lines', String(args.diffLines));
  for (const c of args.changed || []) a.push('--changed', c);
  a.push('--packet', runPacket, '--subject-sha', canonicalSubject.subjectSha256);
  const r = spawnSync(process.execPath, a, {
    cwd: ROOT, env: gateEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });

  // A BLOCKED gate exits 3. That is a successful reading of a blocked system,
  // not a failure to read — so it is projected, not swallowed.
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* handled below */ }
  if (!parsed) {
    return unavailableEngineering(
      `could not read a gate verdict (exit ${r.status}): ${(r.stderr || '').trim().split('\n')[0] || 'no output'}`,
      context);
  }

  // Runtime evidence for steps 1-5 and 8-10. Read directly from the run
  // records the runtime writes; a missing runs/ directory means those steps
  // simply have not been exercised, which renders UNVERIFIED rather than absent.
  let runs = Array.isArray(context.runs) ? context.runs : [];
  if (!Array.isArray(context.runs)) {
    try { runs = require('./aegis-run.cjs').listRuns(); } catch { runs = []; }
  }
  const stageEvidence = deriveStages(parsed, runs, context.surfaceEvidence || null);
  const reviewFailure = canonicalReviewRefusal(
    parsed, identity.reviewFailure, canonicalSubject, packet, receipt);
  return {
    state: 'OK',
    gateExit: r.status,
    verdict: parsed.ok ? parsed.state : 'BLOCKED',
    lane: parsed.classification ? parsed.classification.lane : 'UNKNOWN',
    highRisk: parsed.classification ? !!parsed.classification.highRisk : null,
    // WHY this lane and WHY high-risk, in the classifier's own words. Without
    // these a founder reads "FULL" as a label with no argument behind it, and a
    // label with no argument is indistinguishable from a default.
    laneWhy: parsed.classification ? (parsed.classification.laneWhy || []) : [],
    riskReasons: parsed.classification ? (parsed.classification.riskReasons || []) : [],
    requiredReviewers: parsed.classification ? parsed.classification.requiredReviewers : [],
    subjectSha256: parsed.subject ? parsed.subject.subjectSha256 : null,
    subjectPaths: parsed.subject ? parsed.subject.subjectPaths : [],
    excludedAsEvidence: parsed.subject ? parsed.subject.excludedAsEvidence : [],
    problems: parsed.problems || [],
    observed: parsed.observed || [],
    unverified: parsed.unverified || [],
    stages: stageEvidence,
    // The gate's own PLANNED/REQUIRED/EXECUTED/MISSING table, re-projected
    // verbatim — never re-derived here. This is what lets a founder-readable
    // "why blocked" cite a reviewer by name and coverage score instead of a
    // rule code. Absent only when the gate itself produced no verdict at all.
    reviewerCompleteness: parsed.reviewerCompleteness || null,
    reviewFailure,
    source: rel(ENGOS),
  };
}

// Map the gate verdict onto the declared stage sequence. This does not decide
// anything — it re-expresses the gate's own problems as stage states so the
// drift is drawable. A stage with no positive evidence is UNVERIFIED, which is
// distinct from FAILED: nobody looked, versus somebody looked and it failed.
/**
 * Derive the state of all ELEVEN contract steps.
 *
 * Two evidence sources, never blended:
 *   - the GATE verdict (steps 6, 7)
 *   - the RUNTIME's own run records (steps 1-5, 8-10)
 * Step 11 is this projection itself, and it reports PASS only when it can
 * actually cite what it claims to surface.
 *
 * A step with no evidence is UNVERIFIED. Nothing here infers a pass from the
 * absence of a failure.
 */
function deriveStages(parsed, runs, surfaceEvidence = null) {
  const problems = parsed.problems || [];
  const observed = (parsed.observed || []).join(' | ');
  const has = (re) => problems.some((p) => re.test(p.rule + ' ' + p.detail));

  // Most-recently-updated run, if any. The dashboard reports on the newest run
  // rather than inventing an aggregate across runs that never happened together.
  // Runtime lifecycle claims are indivisible: one malformed, ambiguous or
  // future-dated record makes the runtime evidence plane unavailable. A valid
  // neighbouring file must not continue driving green lifecycle stages while
  // the dashboard simultaneously says the run evidence is unreadable.
  const runtimeEvidenceAvailable = !surfaceEvidence ||
    (surfaceEvidence.runs && surfaceEvidence.runs.state === 'OK');
  const run = runtimeEvidenceAvailable ? selectCurrentRun(runs) : null;
  const noRun = { state: 'UNVERIFIED', reason: 'no run record exists; this step has not been exercised' };
  const corroboratedStages = new Set(run && run.watchdog &&
    Array.isArray(run.watchdog.corroboratedStages) ? run.watchdog.corroboratedStages : []);
  const lifecycleProven = (stage) => corroboratedStages.has(stage);
  const uncorroborated = (stage) => ({ state: 'UNVERIFIED',
    reason: `${stage} is claimed by mutable run state but has no correctly ordered canonical ledger transition` });

  const stageFor = (id) => {
    switch (id) {
      // ── steps 1-5: the runtime ──────────────────────────────────────────
      case 'objective':
        if (!run) return noRun;
        if (!lifecycleProven('INTAKE_RECORDED')) return uncorroborated('objective intake');
        return run.objective
          ? { state: 'PASS', reason: `objective recorded: "${String(run.objective).slice(0, 60)}"` }
          : { state: 'FAILED', reason: 'the run carries no objective' };
      case 'acceptance': {
        if (!run) return noRun;
        if (!lifecycleProven('ROUTED')) return uncorroborated('scope and risk routing');
        const risk = run.risk || null;
        if (!risk) return { state: 'UNVERIFIED', reason: 'no risk classification was recorded' };
        if (risk.state === 'UNVERIFIED') return { state: 'UNVERIFIED', reason: risk.reason || 'risk unknown' };
        if (!Number.isInteger(run.acceptanceCriteriaCount) || run.acceptanceCriteriaCount < 1) {
          return { state: 'UNVERIFIED', reason: 'the run does not carry a validated acceptance-criteria count' };
        }
        return { state: 'PASS', reason: `lane ${risk.lane}${risk.highRisk ? ' (high-risk)' : ''}; ${run.acceptanceCriteriaCount} acceptance criterion(a)` };
      }
      case 'routing': {
        if (!run) return noRun;
        const r = run.route;
        // A routing refusal is the canonical reason ROUTED never happened.
        // It is persisted by aegis-run before the route authority throws and
        // is projected only through projectRoute's closed, bounded shape.
        // Requiring a ROUTED transition before reading REFUSED made this
        // branch unreachable and erased the operator's actual blocker.
        if (r && r.state === 'REFUSED') return { state: 'FAILED', reason: `${r.code}: ${r.reason}` };
        if (!lifecycleProven('ROUTED')) return uncorroborated('model routing');
        if (!r) return { state: 'UNVERIFIED', reason: 'no route was recorded' };
        if (r.state === 'UNVERIFIED') return { state: 'UNVERIFIED', reason: r.reason };
        return { state: 'PASS', reason: `routed to ${r.model} (${r.execution})` };
      }
      case 'worktree':
        if (!run) return noRun;
        if (!lifecycleProven('WORKTREE_READY')) return uncorroborated('isolated worktree readiness');
        if (!run.worktree) return { state: 'UNVERIFIED', reason: 'no isolated worktree was created' };
        if (run.worktree.state !== 'VALIDATED' || run.worktree.isolated !== true ||
            typeof run.worktree.branch !== 'string' || !run.worktree.branch) {
          return { state: 'FAILED', reason: run.worktree.reason ||
            'the recorded worktree did not pass the canonical bounded path and branch validation' };
        }
        return { state: 'PASS', reason: `isolated worktree on validated branch ${run.worktree.branch}` };
      case 'build':
        if (!run) return noRun;
        if (!run.build) return { state: 'UNVERIFIED', reason: 'the builder has not run' };
        if (Number.isInteger(run.build.exit)) {
          if (run.state === 'BUILDING') {
            return { state: 'FAILED',
              reason: `the run still says BUILDING even though terminal builder exit ${run.build.exit} is recorded` };
          }
          if (run.state === 'BUILD_FAILED') {
            if (run.build.failure && run.build.failure.code === 'MODEL_AUTH_FAILURE') {
              return { state: 'FAILED', reason: run.build.failover
                ? 'Claude authentication failed; Grok is the next eligible builder, but automatic failover is not enabled for this beta'
                : 'Claude authentication failed; no executable failover was recorded' };
            }
            return run.build.exit === 0
              ? { state: 'FAILED', reason: 'the run says BUILD_FAILED but the recorded builder exit is 0' }
              : { state: 'FAILED', reason: `builder exited ${run.build.exit}` };
          }
          if (run.build.exit === 0 && !lifecycleProven('BUILT')) {
            return uncorroborated('successful build completion');
          }
          return run.build.exit === 0
            ? { state: 'PASS', reason: 'builder exited 0 inside the isolated worktree' }
            : { state: 'FAILED', reason: `builder exited ${run.build.exit} while the run state is ${run.state}` };
        }
        if (run.state === 'BUILDING' && run.build.mode === 'async' &&
            ACTIVE_ASYNC_WORKER_STATES.has(run.build.workerState)) {
          if (!lifecycleProven('BUILDING')) return uncorroborated('active builder execution');
          return { state: 'RUNNING',
            reason: `asynchronous builder is ${run.build.workerState}; no terminal exit has been recorded yet` };
        }
        if (run.state === 'BUILD_FAILED') {
          return { state: 'FAILED',
            reason: 'the canonical run state is BUILD_FAILED, but no numeric builder exit was recorded' };
        }
        return { state: 'UNVERIFIED',
          reason: 'the build has no terminal numeric exit, so success or failure is not yet proven' };

      // ── steps 6-7: the gate ─────────────────────────────────────────────
      case 'deterministic':
        if (run && run.state === 'CHECKS_FAILED') {
          const failures = [];
          if (run.checks && run.checks.integrityState === 'FAILED') failures.push('subject or packet integrity failed');
          if (run.checks && run.checks.hostContainmentState === 'FAILED') failures.push('host containment failed');
          if (run.checks && run.checks.executionBoundaryState === 'FAILED') failures.push('the contained execution boundary failed');
          if (run.checks && run.checks.preconditionState === 'FAILED') failures.push('a check precondition failed');
          return { state: 'FAILED', reason: failures.length
            ? `deterministic checks failed: ${failures.join('; ')}`
            : 'the canonical run state is CHECKS_FAILED' };
        }
        if (has(/ENGOS-DETERMINISTIC-FAILED/)) return { state: 'FAILED', reason: 'a declared check failed' };
        if (has(/ENGOS-NO-DETERMINISTIC-CHECKS/)) return { state: 'FAILED', reason: 'the packet declares no runnable checks; zero passing is not evidence' };
        if (run && run.checks && (run.state === 'BUILDING' || run.state === 'CORRECTING')) {
          return { state: 'RUNNING',
            reason: 'a correction cycle is active; the prior check receipt does not verify this new build generation' };
        }
        if (/deterministic checks executed here: (\d+)\/\1 passed/.test(observed)) {
          return { state: 'PASS', reason: observed.match(/deterministic checks executed here: [^|]*/)[0].trim() };
        }
        if (run && run.checks) {
          const receiptAppliesToCurrentGeneration =
            ['CHECKS_PASSED', 'REVIEW_FAILED', 'REVIEW_BOUND', 'CHECKPOINTED', 'ROLLED_BACK']
              .includes(run.state);
          if (!receiptAppliesToCurrentGeneration) {
            return { state: run.state === 'BUILDING' || run.state === 'CORRECTING' ? 'RUNNING' : 'UNVERIFIED',
              reason: run.state === 'BUILDING' || run.state === 'CORRECTING'
                ? 'a correction cycle is active; the prior check receipt does not verify this new build generation'
                : `the canonical run is ${run.state}; no current checked generation is active` };
          }
          if (run.checks.outcome === 'SNAPSHOT_PASS_HOST_PENDING') {
            return { state: 'UNVERIFIED',
              reason: run.checks.hostContainmentReason ||
                'snapshot checks passed; mandatory host containment is pending until exact-subject review completes' };
          }
          if (run.checks.passed !== run.checks.total || run.checks.total <= 0) {
            return { state: 'FAILED', reason: `${run.checks.passed}/${run.checks.total} checks passed` };
          }
          if (!lifecycleProven('CHECKS_PASSED')) return uncorroborated('deterministic check completion');
          if (!run.watchdog || run.watchdog.checkReceiptValid !== true) {
            return { state: 'UNVERIFIED',
              reason: 'check counters claim success, but no digest-bound canonical PASS receipt proves them' };
          }
          return { state: 'PASS', reason: `${run.checks.passed}/${run.checks.total} checks passed with a canonical digest-bound receipt` };
        }
        return { state: 'UNVERIFIED', reason: 'this gate did not execute the checks itself; passing elsewhere is not evidence here' };
      case 'review': {
        const missing = problems.filter((p) => /ENGOS-REVIEW-MISSING/.test(p.rule));
        if (missing.length) {
          return { state: 'MISSING', reason: `${missing.length} required reviewer(s) have no record bound to this subject` };
        }
        if (has(/ENGOS-REVIEW-REJECTED/)) return { state: 'FAILED', reason: 'a required reviewer returned REJECT' };
        if (has(/ENGOS-REVIEWER-UNAVAILABLE/)) return { state: 'FAILED', reason: 'a required reviewer reported UNAVAILABLE' };
        const invalidReviewAuthority = problems.find((problem) => problem &&
          /ENGOS-(?:OPEN-BLOCKING-FINDING|REVIEW-(?:MALFORMED|WRONG-PACKET|COVERAGE-(?:SHORT|EXTRA))|AMBIGUOUS-REVIEWS)/
            .test(String(problem.rule || '')));
        if (invalidReviewAuthority) {
          return { state: 'FAILED', reason:
            `${invalidReviewAuthority.rule}: the review gate is blocked; approval labels and coverage cannot override it` };
        }
        if (!parsed || parsed.ok !== true) {
          return { state: 'FAILED', reason:
            'the parsed engineering gate is blocked; review approval cannot be projected as PASS' };
        }
        const completenessRows = parsed && parsed.reviewerCompleteness &&
          Array.isArray(parsed.reviewerCompleteness.rows)
          ? parsed.reviewerCompleteness.rows.filter((row) => row && row.required === 'REQUIRED') : [];
        const advisoryReject = completenessRows.some((row) => row.disposition === 'REJECT');
        const reviewComplete = parsed && parsed.reviewerCompleteness &&
          parsed.reviewerCompleteness.complete === true && completenessRows.length > 0 &&
          completenessRows.every((row) => row.executed === 'EXECUTED');
        if (reviewComplete || /: (APPROVE|APPROVE_WITH_NOTES)/.test(observed)) {
          const gateSubject = parsed && parsed.subject && parsed.subject.subjectSha256;
          const runSubject = run && run.subjectSha256;
          if (!run) return { state: 'UNVERIFIED',
            reason: 'review approval exists, but no current run is available to bind it to' };
          if (!isSubjectSha(gateSubject)) return { state: 'UNVERIFIED',
            reason: 'review approval exists, but the gate subject is unavailable or malformed' };
          if (!isSubjectSha(runSubject)) return { state: 'UNVERIFIED',
            reason: 'review approval exists, but the current run is not linked to a canonical subject' };
          if (gateSubject !== runSubject) return { state: 'UNVERIFIED',
            reason: 'review subject mismatch: the gate approval does not cover the current run subject' };
          return advisoryReject
            ? { state: 'PASS', reason: 'required review is complete with no blocking findings; one reviewer did not approve' }
            : { state: 'PASS', reason: 'every required reviewer approved this exact subject' };
        }
        return { state: 'UNVERIFIED', reason: 'no reviewer disposition was observed' };
      }

      // ── steps 8-10: the runtime again ───────────────────────────────────
      case 'correction': {
        if (!run) return noRun;
        if (!Number.isInteger(run.corrections) || run.corrections < 0 ||
            !Number.isInteger(run.maxCorrections) || run.maxCorrections < 1) {
          return { state: 'UNVERIFIED', reason: 'the bounded correction count or cap is unavailable' };
        }
        const used = run.corrections;
        const max = run.maxCorrections;
        if (used === 0) return { state: 'UNVERIFIED', reason: 'no correction cycle has been needed or exercised' };
        const watchdogProblems = run.watchdog && Array.isArray(run.watchdog.problems)
          ? run.watchdog.problems : [];
        const correctingReached = Boolean(run.watchdog && Array.isArray(run.watchdog.reached) &&
          run.watchdog.reached.includes('CORRECTING'));
        const correctingUnrecorded = watchdogProblems.some((problem) => problem &&
          problem.rule === 'WATCHDOG-UNRECORDED-TRANSITION' &&
          / -> CORRECTING\b/.test(String(problem.detail || '')));
        if (!correctingReached || correctingUnrecorded) {
          return { state: 'UNVERIFIED',
            reason: 'a mutable correction count exists, but no canonical ledger-corroborated CORRECTING transition proves it' };
        }
        if (used >= max) return { state: 'FAILED', reason: `${used}/${max} correction cycles used — escalation required` };
        return { state: 'PASS', reason: `${used}/${max} correction cycles used, within bound` };
      }
      case 'watchdog': {
        if (!run) return noRun;
        if (!run.watchdog) return { state: 'UNVERIFIED', reason: 'the watchdog has not been run against this run' };
        if (run.watchdog.ok) {
          return { state: 'PASS', reason: 'the required sequence occurred, in order, and is recorded in the ledger' };
        }
        const watchdogProblems = Array.isArray(run.watchdog.problems) ? run.watchdog.problems : [];
        const drift = watchdogProblems.filter((problem) => problem && problem.rule !== 'WATCHDOG-STAGE-MISSING');
        if (drift.length) {
          return { state: 'FAILED', reason: `process drift: ${drift.map((x) => x.rule).join(', ')}` };
        }
        const prefix = Array.isArray(run.watchdog.corroboratedStages)
          ? run.watchdog.corroboratedStages : [];
        if (prefix.length) {
          const last = prefix[prefix.length - 1];
          return { state: run.state === 'BUILDING' ? 'RUNNING' : 'UNVERIFIED',
            reason: `the canonical sequence is corroborated through ${last}; later required stages have not occurred yet` };
        }
        return { state: 'UNVERIFIED', reason: 'no correctly ordered canonical lifecycle prefix is corroborated yet' };
      }
      case 'checkpoint':
        if (!run) return noRun;
        if (run.checkpointState === 'INVALID') return { state: 'FAILED',
          reason: run.checkpointReason || 'the checkpoint receipt or rollback point is malformed' };
        if (!run.checkpoint && !run.rollbackPoint) {
          return { state: 'UNVERIFIED', reason: 'no checkpoint has been recorded for this run' };
        }
        if (typeof run.checkpoint !== 'string' || !run.checkpoint ||
            typeof run.rollbackPoint !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(run.rollbackPoint)) {
          return { state: 'FAILED', reason: 'a checkpoint requires one bounded receipt id and one canonical rollback commit' };
        }
        return { state: 'PASS', reason: `checkpoint ${run.checkpoint} at ${run.rollbackPoint.slice(0, 12)}` };

      // ── step 11: this surface ───────────────────────────────────────────
      case 'surface':
        // PASS only if this projection can actually cite what it claims to
        // show. Otherwise the step that exists to prove honesty would be the
        // one lying.
        {
          const gaps = [];
          if (!surfaceEvidence) gaps.push('surface evidence was not supplied');
          else {
            if (!surfaceEvidence.runs || surfaceEvidence.runs.state !== 'OK') gaps.push('run evidence unavailable');
            else if (!surfaceEvidence.runs.current || surfaceEvidence.runs.current.state !== 'BOUND') {
              gaps.push('current run binding unavailable');
            }
            if (!surfaceEvidence.events || surfaceEvidence.events.state !== 'OK') gaps.push('event evidence unavailable');
            if (!surfaceEvidence.cost || surfaceEvidence.cost.state !== 'OK') gaps.push('cost evidence unavailable');
            if (!surfaceEvidence.reviewers || surfaceEvidence.reviewers.state !== 'OK') gaps.push('reviewer provenance unavailable');
          }
          return gaps.length
            ? { state: 'UNVERIFIED', reason: `surface gaps: ${gaps.join('; ')}` }
            : { state: 'PASS', reason: 'evidence, cost, blockers and provenance are projected from cited artifacts' };
        }

      default:
        return { state: 'UNVERIFIED', reason: 'no evidence source is defined for this step' };
    }
  };

  return REQUIRED_STAGES.map((s) => ({ ...s, ...stageFor(s.id) }));
}

// ── recent events (the ledger IS the event bus — no second store) ───────────
function projectEvents(limit, ledgerFile) {
  const ledgerPath = resolveEvidencePath(ledgerFile, LEDGER, null);
  if (!fs.existsSync(ledgerPath)) {
    return { state: 'UNAVAILABLE', reason: `ledger not found at ${rel(ledgerPath)}`, events: [] };
  }
  let l;
  try { l = readJSON(ledgerPath); }
  catch (e) { return { state: 'UNAVAILABLE', reason: `ledger unreadable: ${e.message}`, events: [] }; }
  if (!Array.isArray(l)) return { state: 'UNAVAILABLE', reason: 'ledger is not an array', events: [] };
  const events = l.slice(-limit).reverse().map((e) => ({
    entryId: e.entryId, ts: e.ts, gate: e.gate, status: e.status,
    agentId: e.agentId, packetId: e.packetId || null,
    blockRule: e.blockRule || null,
    operation: e.operation || null,
  }));
  return { state: 'OK', total: l.length, events, source: rel(ledgerPath) };
}

// ── snapshot ────────────────────────────────────────────────────────────────
// ── cost, from recorded telemetry ONLY ─────────────────────────────────────
// The V1 contract says the dashboard shows costs. It showed none. This reads
// what reviewer runs actually reported and nothing else.
//
// The hard rule is what happens to runs whose telemetry was LOST: a killed or
// errored reviewer never writes its envelope, so its spend is real and
// unrecorded. Those are counted and surfaced as UNRECORDED — never estimated
// from an average, never silently treated as zero. A cost display that quietly
// drops the runs it cannot see reads as complete while understating the bill,
// which is the same failure as a dashboard that shows a fabricated PASS.
// Reviewer stdout has two canonical OWN-envelope encodings in preserved
// evidence: newline-delimited compact JSON events and one pretty-printed
// top-level JSON event.  In both encodings the complete stdout payload is the
// envelope stream: whitespace may separate objects, but prose may not precede,
// follow or interrupt it.  This whole-stream boundary is what prevents a JSON
// object quoted while Codex was reviewing another transcript from becoming the
// current run's telemetry, even when that quoted object starts on its own line.
function ownEnvelopeEvents(body) {
  if (typeof body !== 'string') return [];
  const stdout = body.split(/^--- stderr ---\s*$/m)[0];
  const events = [];
  let i = 0;
  while (i < stdout.length) {
    while (i < stdout.length && /\s/.test(stdout[i])) i++;
    if (i === stdout.length) break;
    // Any non-whitespace outside a top-level JSON object means stdout is prose
    // containing JSON, not a canonical telemetry envelope stream.
    if (stdout[i] !== '{') return [];
    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (; i < stdout.length; i++) {
      const char = stdout[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return [];
    try { events.push(JSON.parse(stdout.slice(start, end + 1))); }
    catch { return []; }
    i = end + 1;
  }
  return events;
}

function successfulTerminalCostEnvelope(body) {
  const events = ownEnvelopeEvents(body);
  const terminals = events.filter((event) => event && event.type === 'end');
  if (terminals.length !== 1 || events[events.length - 1] !== terminals[0]) return null;
  const terminal = terminals[0];
  if (terminal.stopReason !== 'end_turn' || typeof terminal.total_cost_usd !== 'number' ||
      !Number.isFinite(terminal.total_cost_usd) || terminal.total_cost_usd < 0) return null;
  return terminal;
}

// ── canonical FX evidence (USD → CAD) ──────────────────────────────────────
// Three things must be true before a CAD figure may appear anywhere: a rate, a
// DATE the rate was observed, and a named SOURCE. Any one missing and this
// returns UNAVAILABLE with the reason, which the page renders as
// "CAD UNAVAILABLE" beside the untouched USD audit figures.
//
// This function does no I/O beyond reading that one file. It never calls a
// network FX service, and there is no default, fallback or last-known rate: a
// stale-but-cited rate is a disclosable fact, an uncited one is a fabrication.
//
// `fxPath` exists for ONE reason: so a test can exercise missing and malformed
// FX evidence without touching the live canonical file. The previous proofs
// renamed builder-control/fx-canon.json aside and back, which meant a
// concurrent projector could observe the canonical evidence as missing and an
// abrupt kill could leave it displaced (Codex REV-20260826023038-codex finding
// #5). Injection is the whole fix: production still reads FX_CANON and nothing
// else, and the default argument is the only path any caller in this file uses.
function projectFx(now = Date.now(), fxPath = FX_CANON) {
  const source = rel(fxPath);
  if (!fs.existsSync(fxPath)) {
    return { state: 'UNAVAILABLE', source,
      reason: `no canonical FX evidence exists at ${source}, so US dollars cannot be shown in Canadian dollars. ` +
        'No rate is fetched and none is assumed — the figures below stay in the currency they were recorded in.' };
  }
  let raw = null;
  try { raw = readJSON(fxPath); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') {
    return { state: 'UNAVAILABLE', source, reason: `${source} could not be read as JSON, so no CAD rate is available.` };
  }
  const rate = typeof raw.rate === 'number' && Number.isFinite(raw.rate) && raw.rate > 0 ? raw.rate : null;
  const base = typeof raw.base === 'string' ? raw.base.toUpperCase() : null;
  const quote = typeof raw.quote === 'string' ? raw.quote.toUpperCase() : null;
  const asOf = typeof raw.asOf === 'string' && !Number.isNaN(Date.parse(raw.asOf)) ? raw.asOf : null;
  const fxSource = typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : null;
  const missing = [];
  if (rate === null) missing.push('a positive numeric "rate"');
  if (base !== 'USD') missing.push('"base":"USD"');
  if (quote !== 'CAD') missing.push('"quote":"CAD"');
  if (!asOf) missing.push('a parseable ISO "asOf" date');
  if (!fxSource) missing.push('a named "source"');
  if (missing.length) {
    return { state: 'UNAVAILABLE', source,
      reason: `${source} is not usable FX evidence: it is missing ${missing.join(', ')}. ` +
        'An incomplete rate record is not converted from — CAD stays UNAVAILABLE.' };
  }
  const observedAt = Date.parse(asOf);
  if (observedAt > now) {
    return { state: 'UNAVAILABLE', source,
      reason: `${source} is future-dated (${asOf}), so it cannot prove a CAD rate observed by the current projection clock. ` +
        'Future evidence is not converted from — CAD stays UNAVAILABLE.' };
  }
  const ageDays = Math.floor((now - observedAt) / 86400000);
  return {
    state: ageDays > FX_STALE_DAYS ? 'STALE' : 'OK',
    rate, base, quote, asOf, ageDays, fxSource, source,
    plain: `1 USD = ${rate} CAD, observed ${asOf} (${fxSource})` +
      (ageDays > FX_STALE_DAYS ? `. That evidence is ${ageDays} days old, so every CAD figure here is dated, not current.` : '.'),
  };
}

// Convert a recorded USD figure using cited evidence. Rounds UP at the cent, in
// the same direction and for the same reason the USD display figure does:
// understating spend against a ceiling is the one error that reads as headroom.
function toCad(usd, fx) {
  if (fx.state !== 'OK' && fx.state !== 'STALE') return null;
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return null;
  return Math.ceil(usd * fx.rate * 100) / 100;
}

function projectCost(opts = {}) {
  const dir = resolveEvidencePath(opts.reviewRawDir, path.join(HERE, 'review-raw'), null);
  if (!fs.existsSync(dir)) {
    return { state: 'UNAVAILABLE', reason: `no reviewer transcripts at ${rel(dir)}`, runs: [] };
  }
  const runs = [];
  let recorded = 0, unrecordedRuns = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
    const full = path.join(dir, f);
    let body = '';
    try { body = fs.readFileSync(full, 'utf8'); } catch { /* unreadable */ }
    // PROVEN DEFECT (2026-08-25): this regex-scanned the WHOLE transcript, so a
    // reviewer that READ another reviewer's raw output had that other run's cost
    // attributed to itself. Two Codex transcripts reported $0.866698 and
    // $0.640374 — Grok's figures, quoted while Codex was reviewing the Grok
    // files. A cost display that double-counts is worse than one that shows
    // nothing, because it looks precise.
    //
    // Cost is read ONLY from the run's own top-level envelope.
    const env = successfulTerminalCostEnvelope(body);
    const usdRaw = env && typeof env.total_cost_usd === 'number' ? env.total_cost_usd : null;
    const turnsRaw = env && typeof env.num_turns === 'number' ? env.num_turns : null;
    const stopRaw = env && typeof env.stopReason === 'string' ? env.stopReason : null;
    const m = usdRaw !== null ? [null, String(usdRaw)] : null;
    const turns = turnsRaw !== null ? [null, String(turnsRaw)] : null;
    const stop = stopRaw !== null ? [null, stopRaw] : null;
    if (m) {
      const usd = parseFloat(m[1]);
      recorded += usd;
      runs.push({ file: f, reviewer: /grok/.test(f) ? 'grok' : /codex/.test(f) ? 'codex' : 'unknown',
        usd, turns: turns ? Number(turns[1]) : null,
        stopReason: stop ? stop[1] : null, state: 'RECORDED', source: rel(full) });
    } else {
      unrecordedRuns++;
      runs.push({ file: f, reviewer: /grok/.test(f) ? 'grok' : /codex/.test(f) ? 'codex' : 'unknown',
        usd: null, turns: null, stopReason: null, state: 'UNRECORDED',
        reason: 'the run ended before its telemetry envelope was written; spend is real but unknown',
        source: rel(full) });
    }
  }
  const fx = projectFx();
  // CAD is a DISPLAY of the USD audit values, never a replacement for them.
  // recordedUsd/recordedUsdDisplay/totalUsd/byReviewer stay exactly as recorded
  // so the audit trail is still in the currency the reviewers billed in.
  const recordedCad = toCad(recorded, fx);
  const cad = fx.state === 'UNAVAILABLE'
    ? { state: 'UNAVAILABLE', reason: fx.reason, source: fx.source }
    : {
        state: fx.state,
        rate: fx.rate, asOf: fx.asOf, ageDays: fx.ageDays, fxSource: fx.fxSource,
        source: fx.source, plain: fx.plain,
        recordedCad,
        totalCad: unrecordedRuns > 0 ? 'AT LEAST ' + recordedCad : recordedCad,
        byReviewerCad: runs.reduce((acc, r) => {
          const k = r.reviewer || 'unknown';
          acc[k] = acc[k] || { recordedCad: 0, unrecordedRuns: 0 };
          if (r.state === 'RECORDED') acc[k].recordedCad = Math.ceil((acc[k].recordedCad + r.usd * fx.rate) * 100) / 100;
          else acc[k].unrecordedRuns++;
          return acc;
        }, {}),
      };

  return {
    state: 'OK',
    fx,
    cad,
    // The EXACT sum of recorded telemetry. It used to be toFixed(6), which made
    // the figure labelled "recorded" not equal to what was actually recorded —
    // small, but this number is checked against a spend cap, and a displayed
    // figure that is not the real one is the wrong kind of small error.
    recordedUsd: recorded,
    // Display value, rounded UP at 6dp. Rounding a spend figure must never
    // round DOWN: understating spend against a ceiling is the one direction
    // that can cause an overrun to look like headroom.
    recordedUsdDisplay: Math.ceil(recorded * 1e6) / 1e6,
    recordedRuns: runs.filter((r) => r.state === 'RECORDED').length,
    unrecordedRuns,
    // Deliberately not a number. Any total that folds in unrecorded runs would
    // be a guess wearing the costume of a measurement.
    totalUsd: unrecordedRuns > 0 ? 'AT LEAST ' + (Math.ceil(recorded * 1e6) / 1e6) : Math.ceil(recorded * 1e6) / 1e6,
    caveat: unrecordedRuns > 0
      ? `${unrecordedRuns} run(s) have no cost telemetry, so the true total is higher than the recorded figure by an unknown amount`
      : null,
    // Metered spend is what a budget cap governs. Codex runs on a subscription,
    // so folding it into one figure would misreport the number Marc authorized.
    byReviewer: runs.reduce((acc, r) => {
      const k = r.reviewer || 'unknown';
      acc[k] = acc[k] || { recordedUsd: 0, recordedRuns: 0, unrecordedRuns: 0 };
      if (r.state === 'RECORDED') { acc[k].recordedUsd += r.usd; acc[k].recordedRuns++; }
      else acc[k].unrecordedRuns++;
      return acc;
    }, {}),
    runs,
    source: rel(dir),
  };
}

// ── runs, from the runtime's working state ─────────────────────────────────
// CONFIRMED FINDING #7: the page used to call the LAST element of this array
// "Current run". This array was built by sorting FILENAMES, and a filename is
// not a clock — RUN ids carry a random suffix, so RUN-20260825-ff.. sorts after
// RUN-20260826-0a.. and yesterday's objective renders as today's. Selection is
// now by the run record's own updatedAt timestamp, and a run whose timestamp
// cannot be parsed is never selected as current at all.
function orderRuns(runs) {
  return runs.slice().sort((a, b) => {
    const at = a.updatedAtMs, bt = b.updatedAtMs;
    if (at !== bt) return (at === null ? -Infinity : at) - (bt === null ? -Infinity : bt);
    const ac = a.createdAtMs, bc = b.createdAtMs;
    if (ac !== bc) return (ac === null ? -Infinity : ac) - (bc === null ? -Infinity : bc);
    // Deterministic last resort so the same inputs always order the same way.
    return String(a.runId) < String(b.runId) ? -1 : (String(a.runId) > String(b.runId) ? 1 : 0);
  });
}

// Keep this identical to aegis-run.cjs RUN_ID_RE. The state projector does not
// own run identity, but it must independently refuse a forged working-state
// filename before any of that file can reach the founder surface. Tests compare
// both authorities over the same positive and negative table.
const RUN_ID_RE = /^RUN-\d{8}-[0-9a-f]{8}$/;

function normalizeRunTimes(run) {
  return {
    ...run,
    createdAtMs: typeof run.createdAtMs === 'number' && Number.isFinite(run.createdAtMs)
      ? run.createdAtMs : (typeof run.createdAt !== 'string' || Number.isNaN(Date.parse(run.createdAt)) ? null : Date.parse(run.createdAt)),
    updatedAtMs: typeof run.updatedAtMs === 'number' && Number.isFinite(run.updatedAtMs)
      ? run.updatedAtMs : (typeof run.updatedAt !== 'string' || Number.isNaN(Date.parse(run.updatedAt)) ? null : Date.parse(run.updatedAt)),
  };
}

function futureRunTimestamp(run, nowMs) {
  return (Number.isFinite(run.createdAtMs) && run.createdAtMs > nowMs) ||
    (Number.isFinite(run.updatedAtMs) && run.updatedAtMs > nowMs);
}

function selectCurrentRun(runs, nowMs = Date.now()) {
  if (!Array.isArray(runs) || !runs.length) return null;
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const normalized = runs.map(normalizeRunTimes);
  const dated = orderRuns(normalized).filter((run) =>
    Number.isFinite(run.updatedAtMs) && !futureRunTimestamp(run, effectiveNow));
  return dated.length ? dated[dated.length - 1] : null;
}

// The canonical subject-hash shape, as engineering-os computes and validates
// it. Reused here so "is this a subject hash" has ONE answer in this system,
// not a second, looser one living in the projector.
const SUBJECT_SHA_RE = /^[0-9a-f]{64}$/;
const isSubjectSha = (v) => typeof v === 'string' && SUBJECT_SHA_RE.test(v);

// ── a run's code version must be the RUN's own record, not the page's ──────
// PROVEN DEFECT (Codex REV-20260826023038-codex finding #3): whatever subject
// hash the page happened to be gated with was written onto the current run and
// labelled its code version, with subjectState BOUND. A run record containing
// nothing but an id and two timestamps therefore advertised a reviewed code
// version it had no linkage to, which reads as "the gate verdict and the
// reviewer approvals on this page cover this run's work" — a claim nothing had
// established.
//
// The two hashes are now kept apart and only ever joined by an EXACT match:
//   gateSubjectSha256  what THIS PAGE's gate verdict is about (the argument)
//   runSubjectSha256   what THE RUN RECORD ITSELF says it built (run.subject)
//   subjectSha256      the run's code version — populated ONLY when those two
//                      are both canonical subject hashes and identical
// Nothing writes run.subject yet, so the honest projection today is UNLINKED
// and the page renders "code version UNAVAILABLE". That is the correct reading:
// the linkage does not exist, so it must not be displayed as if it did.
function runSubjectOf(run) {
  const s = run && run.subject && typeof run.subject === 'object' ? run.subject : null;
  return s && isSubjectSha(s.subjectSha256) ? s.subjectSha256 : null;
}

// A run record may contain child output, environment, launch arguments and
// other private worker internals.  The dashboard needs only this bounded
// lifecycle identity.  Keep this allowlist here, before hosting, so a status
// snapshot can never accidentally carry raw worker data forward.
function projectWorker(build, runState, runtime) {
  if (!build || typeof build !== 'object' || Array.isArray(build)) return null;
  const exit = Number.isInteger(build.exit) ? build.exit : null;
  if (build.mode !== 'async') return { exit };
  const boundedText = (value, max = 128) =>
    typeof value === 'string' && value.length <= max ? value : null;
  const boundedTimestamp = (value) => boundedText(value, 64);
  const recovery = build.recovery && typeof build.recovery === 'object' && !Array.isArray(build.recovery)
    ? { reason: boundedText(build.recovery.reason), retrySafe: build.recovery.retrySafe === true,
        ...(build.recovery.terminationVerified === false ? { terminationVerified: false } : {}) }
    : null;
  const failure = build.failure && typeof build.failure === 'object' && !Array.isArray(build.failure) &&
      build.failure.code === 'MODEL_AUTH_FAILURE' && build.failure.provider === 'claude-subscription' &&
      build.failure.failoverEligible === true
    ? { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
        summary: 'Claude authentication failed.' }
    : null;
  const failover = failure && build.providerSelection && typeof build.providerSelection === 'object' &&
      !Array.isArray(build.providerSelection) && build.providerSelection.provider === 'grok-subscription' &&
      typeof build.providerSelection.model === 'string' && build.providerSelection.model.length > 0 &&
      build.providerSelection.model.length <= 128 && build.handoff && typeof build.handoff === 'object' &&
      build.handoff.state === 'UNAVAILABLE' && build.handoff.executable === false &&
      build.handoff.failureCode === 'MODEL_AUTH_FAILURE' &&
      build.handoff.fromProvider === 'claude-subscription' &&
      build.handoff.toProvider === 'grok-subscription' &&
      build.handoff.sameProviderRetryAllowed === false && build.handoff.unchangedObjective === true &&
      build.recovery && build.recovery.reason === 'MODEL_AUTH_FAILURE' &&
      build.recovery.retrySafe === false && build.recovery.providerFailoverRequired === true &&
      build.recovery.selectedProvider === 'grok-subscription' &&
      build.recovery.selectedModel === build.providerSelection.model
    ? { state: 'NOT_EXECUTABLE', provider: 'grok-subscription', model: build.providerSelection.model,
        reason: 'Grok is the next eligible builder, but automatic failover is not enabled for this beta.' }
    : null;
  return {
    mode: 'async',
    workerState: boundedText(build.workerState),
    workerPid: Number.isInteger(build.workerPid) && build.workerPid > 0 ? build.workerPid : null,
    startedAt: boundedTimestamp(build.startedAt),
    heartbeatAt: boundedTimestamp(build.heartbeatAt),
    endedAt: boundedTimestamp(build.endedAt),
    exit,
    timedOut: build.timedOut === true,
    recovery,
    failure,
    failover,
    // Compute this one public capability while the canonical raw control and
    // child identity are still present. Hosting receives only the boolean;
    // it can neither reconstruct nor expose the mailbox secret.
    cancelAvailable: build.workerState === 'RUNNING' && runtime &&
      typeof runtime.workerCancellationCapability === 'function' &&
      runtime.workerCancellationCapability({ state: runState, build }) === true,
  };
}

function projectChecks(checks, runState, watchdog) {
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) return null;
  const state = (value, allowPending = false) => value && typeof value === 'object' &&
    (value.state === 'PASSED' || value.state === 'FAILED' ||
      (allowPending && value.state === 'PENDING')) ? value.state : null;
  const passed = Number.isInteger(checks.passed) && checks.passed >= 0 ? checks.passed : null;
  const total = Number.isInteger(checks.total) && checks.total > 0 ? checks.total : null;
  const hostContainmentState = state(checks.hostContainment, true);
  const lifecycleChecksPassed = Boolean(watchdog &&
    Array.isArray(watchdog.corroboratedStages) &&
    watchdog.corroboratedStages.includes('CHECKS_PASSED'));
  const verifiedReceipt = lifecycleChecksPassed && watchdog.checkReceiptValid === true;
  const preHostReceiptApplies = runState === 'CHECKS_PASSED' || runState === 'REVIEW_FAILED';
  const finalReceiptApplies = [
    'CHECKS_PASSED', 'REVIEW_FAILED', 'REVIEW_BOUND', 'CHECKPOINTED', 'ROLLED_BACK',
  ].includes(runState);
  const snapshotPassedHostPending = preHostReceiptApplies &&
    passed === total && total > 0 && verifiedReceipt &&
    watchdog.checkReceiptStage === 'PRE_HOST' && watchdog.hostContainmentState === 'PENDING' &&
    hostContainmentState === 'PENDING';
  const finalReceiptPassed = finalReceiptApplies &&
    passed === total && total > 0 && verifiedReceipt &&
    watchdog.checkReceiptStage === 'COMPLETE';
  const hostContainmentReason = snapshotPassedHostPending
    ? (runState === 'REVIEW_FAILED'
      ? 'Snapshot checks passed; mandatory host containment remains pending because exact-subject review did not pass.'
      : 'Snapshot checks passed; mandatory host containment is pending until exact-subject review completes.')
    : null;
  return {
    passed,
    total,
    outcome: runState === 'CHECKS_FAILED' ? 'FAIL'
      : snapshotPassedHostPending ? 'SNAPSHOT_PASS_HOST_PENDING'
      : finalReceiptPassed ? 'PASS' : 'UNVERIFIED',
    snapshotOutcome: runState === 'CHECKS_FAILED' ? 'FAIL'
      : (snapshotPassedHostPending || finalReceiptPassed) ? 'PASS'
      : passed === null || total === null ? 'UNVERIFIED'
      : passed < total ? 'FAIL' : 'UNVERIFIED',
    integrityState: state(checks.integrity),
    integrityGapCount: checks.integrity && Array.isArray(checks.integrity.gaps)
      ? checks.integrity.gaps.length : null,
    hostContainmentState,
    hostContainmentReason,
    executionBoundaryState: state(checks.executionBoundary),
    preconditionState: state(checks.precondition),
    preconditionCode: checks.precondition && typeof checks.precondition.code === 'string' &&
      /^[A-Z0-9_-]{1,96}$/.test(checks.precondition.code) ? checks.precondition.code : null,
  };
}

// The route is the run's canonical attribution to the model router.  Preserve
// only its exact safe shape and source marker; browser input and worker output
// never participate in model identity.
function projectRoute(route) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return null;
  const keys = Object.keys(route).sort();
  if (keys.join('\u0000') === 'code\u0000reason\u0000state') {
    if (route.state !== 'REFUSED' ||
        typeof route.code !== 'string' || !/^[A-Z][A-Z0-9_-]{1,95}$/.test(route.code) ||
        typeof route.reason !== 'string' || route.reason.length < 1 || route.reason.length > 512 ||
        route.reason.trim() !== route.reason || /[\u0000-\u001f\u007f]/.test(route.reason)) return null;
    return { state: 'REFUSED', code: route.code, reason: route.reason };
  }
  if (keys.join('\u0000') !== 'execution\u0000model\u0000source') return null;
  if (route.source !== 'tool-router.cjs routeRole') return null;
  if (typeof route.model !== 'string' || route.model.length === 0 || route.model.length > 128 ||
      typeof route.execution !== 'string' || route.execution.length === 0 || route.execution.length > 64) return null;
  return { model: route.model, execution: route.execution, source: route.source };
}

// The browser never needs the operator's absolute worktree path.  The stage
// does need stronger evidence than a truthy string, however, so validate the
// exact shape created by aegis-run before projecting a bounded branch receipt.
// This is structural validation of the recorded creation receipt; live Git
// identity is re-proved by aegis-run before any state-mutating operation.
function projectWorktree(worktree, run) {
  if (worktree === undefined || worktree === null) return null;
  const invalid = (reason) => ({ state: 'INVALID', isolated: false, branch: null, reason });
  if (!worktree || typeof worktree !== 'object' || Array.isArray(worktree)) {
    return invalid('the recorded worktree is not an object');
  }
  const expectedBranch = `aegis/${run.runId}`;
  const expectedDirectory = `aegis-wt-${run.runId}`;
  if (typeof worktree.path !== 'string' || !path.isAbsolute(worktree.path) ||
      path.basename(path.normalize(worktree.path)) !== expectedDirectory) {
    return invalid(`the recorded worktree path is not the bounded ${expectedDirectory} directory`);
  }
  if (typeof worktree.branch !== 'string' || worktree.branch !== expectedBranch) {
    return invalid(`the recorded worktree branch is not ${expectedBranch}`);
  }
  if (typeof worktree.createdAt !== 'string' || !Number.isFinite(Date.parse(worktree.createdAt))) {
    return invalid('the recorded worktree has no parseable creation timestamp');
  }
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(run.baseCommit || '') ||
      worktree.baseCommit !== run.baseCommit) {
    return invalid('the run and worktree do not carry one matching canonical base commit');
  }
  return { state: 'VALIDATED', isolated: true, branch: expectedBranch };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function checkpointDigest(checkpoint) {
  const body = { ...checkpoint };
  delete body.digest;
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(body))).digest('hex');
}

function projectCheckpoint(checkpoint, run, watchdog) {
  if (checkpoint === undefined || checkpoint === null) {
    return { state: 'ABSENT', checkpoint: null, rollbackPoint: null, reason: null };
  }
  const invalid = (reason) => ({ state: 'INVALID', checkpoint: null, rollbackPoint: null, reason });
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    return invalid('the checkpoint receipt is not an object');
  }
  if (typeof checkpoint.checkpointId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(checkpoint.checkpointId)) {
    return invalid('the checkpoint receipt id is missing or malformed');
  }
  const oid = (value) => typeof value === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value);
  if (!oid(checkpoint.rollbackPoint) || !oid(checkpoint.baseCommit) || !oid(checkpoint.tree) ||
      !oid(checkpoint.reviewedBase)) {
    return invalid('the checkpoint does not name canonical rollback, base, tree, and reviewed-base commits');
  }
  if (!run || checkpoint.runId !== run.runId || checkpoint.baseCommit !== run.baseCommit) {
    return invalid('the checkpoint receipt is not bound to this run and its canonical base commit');
  }
  if (typeof checkpoint.createdAt !== 'string' || !Number.isFinite(Date.parse(checkpoint.createdAt))) {
    return invalid('the checkpoint receipt has no parseable creation timestamp');
  }
  if (!isSubjectSha(checkpoint.digest) || checkpointDigest(checkpoint) !== checkpoint.digest) {
    return invalid('the checkpoint digest does not authenticate the complete canonical receipt');
  }
  const packet = checkpoint.packet;
  const subject = checkpoint.subject;
  const review = run.reviewGate;
  const runSubject = run.subject;
  if (!packet || typeof packet.path !== 'string' || !packet.path || !isSubjectSha(packet.sha256) ||
      !subject || !isSubjectSha(subject.subjectSha256) || !Array.isArray(subject.subjectPaths) ||
      subject.subjectPaths.length < 1 || subject.subjectPaths.some((item) =>
        typeof item !== 'string' || !item || path.isAbsolute(item) || item.split('/').includes('..')) ||
      !Number.isInteger(subject.diffBytes) || subject.diffBytes <= 0 ||
      typeof subject.reviewedRange !== 'string' || !subject.reviewedRange ||
      typeof subject.committedRange !== 'string' || !subject.committedRange ||
      !isSubjectSha(checkpoint.checkReceiptSha256)) {
    return invalid('the checkpoint packet, subject, or deterministic receipt coordinate is malformed');
  }
  if (subject.committedRange !== `${checkpoint.reviewedBase}..${checkpoint.rollbackPoint}`) {
    return invalid('the checkpoint committed range does not bind the reviewed base to the rollback commit');
  }
  if (!review || !runSubject || review.subjectSha256 !== subject.subjectSha256 ||
      runSubject.subjectSha256 !== subject.subjectSha256 ||
      review.checkReceiptSha256 !== checkpoint.checkReceiptSha256 ||
      !review.packet || review.packet.path !== packet.path || review.packet.sha256 !== packet.sha256 ||
      review.headCommit !== checkpoint.reviewedBase || runSubject.pathCount !== subject.subjectPaths.length ||
      runSubject.diffBytes !== subject.diffBytes || runSubject.range !== subject.reviewedRange) {
    return invalid('the checkpoint does not bind one reviewed subject, packet, and deterministic receipt');
  }
  if (!checkpoint.checks || !run.checks || checkpoint.checks.passed !== checkpoint.checks.total ||
      checkpoint.checks.total < 1 || checkpoint.checks.passed !== run.checks.passed ||
      checkpoint.checks.total !== run.checks.total || checkpoint.objective !== run.objective) {
    return invalid('the checkpoint does not bind the run objective and its complete passing checks');
  }
  const transition = Array.isArray(run.transitions) && run.transitions.find((item) =>
    item && item.from === 'REVIEW_BOUND' && item.to === 'CHECKPOINTED' &&
    typeof item.ts === 'string' && Number.isFinite(Date.parse(item.ts)) &&
    Date.parse(item.ts) >= Date.parse(checkpoint.createdAt) &&
    typeof item.ledgerEntryId === 'string' && /^LED-RUN-/.test(item.ledgerEntryId) &&
    item.notes === `checkpoint ${checkpoint.checkpointId} at ${checkpoint.rollbackPoint.slice(0, 12)}`);
  if (!transition || !['CHECKPOINTED', 'ROLLED_BACK'].includes(run.state) || !watchdog || watchdog.ok !== true) {
    return invalid('the checkpoint is not corroborated by the canonical CHECKPOINTED transition and ledger watchdog');
  }
  return { state: 'VALIDATED', checkpoint: checkpoint.checkpointId,
    rollbackPoint: checkpoint.rollbackPoint, reason: null };
}

function projectReviewFailure(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schemaVersion !== 1 || value.status !== 'REFUSED' ||
      value.reasonCode !== 'EXACT_SUBJECT_REVIEW_REFUSED' ||
      !isSubjectSha(value.subjectSha256) || !isSubjectSha(value.checkReceiptSha256) ||
      typeof value.refusedAt !== 'string' || !Number.isFinite(Date.parse(value.refusedAt)) ||
      value.authority !== 'engineering-os.cjs --gate-done' ||
      !value.packet || typeof value.packet !== 'object' ||
      !/^builder-control\/packets\/[A-Za-z0-9._-]+\.json$/.test(value.packet.path || '') ||
      !isSubjectSha(value.packet.sha256) ||
      !Number.isInteger(value.blockingFindingCount) || value.blockingFindingCount < 0 ||
      !Number.isInteger(value.refusalRuleCount) || value.refusalRuleCount < 1 ||
      !Array.isArray(value.rejectedReviewers) || value.rejectedReviewers.length < 1) return null;
  const rejectedReviewers = value.rejectedReviewers.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        typeof row.reviewer !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(row.reviewer) ||
        typeof row.reviewId !== 'string' || !/^REV-[A-Za-z0-9._-]{1,127}$/.test(row.reviewId)) return [];
    return [{ reviewer: row.reviewer, reviewId: row.reviewId }];
  });
  if (rejectedReviewers.length !== value.rejectedReviewers.length) return null;
  // The run JSON is mutable and is not an attestation surface. Its shape can
  // establish only that a review-failure claim was recorded. The parsed,
  // exact-subject engineering gate owns the blocking verdict; until that
  // evidence is provided to this projector, publish no reviewer identity,
  // counts, hashes, or refusal conclusion as fact.
  return {
    status: 'UNVERIFIED',
    reasonCode: 'REVIEW_FAILURE_UNCORROBORATED',
    summary: 'The run records a review-failure claim, but attested exact-subject gate evidence is unavailable in this projection.',
  };
}

function privateReviewFailureClaim(value) {
  const projected = projectReviewFailure(value);
  if (!projected) return null;
  return Object.freeze({
    schemaVersion: 1,
    status: 'REFUSED',
    reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
    subjectSha256: value.subjectSha256,
    checkReceiptSha256: value.checkReceiptSha256,
    packet: Object.freeze({ path: value.packet.path, sha256: value.packet.sha256 }),
    refusedAt: value.refusedAt,
    authority: value.authority,
    rejectedReviewers: Object.freeze(value.rejectedReviewers.map((row) =>
      Object.freeze({ reviewer: row.reviewer, reviewId: row.reviewId }))),
    blockingFindingCount: value.blockingFindingCount,
    refusalRuleCount: value.refusalRuleCount,
    summary: value.blockingFindingCount > 0
      ? `Independent review found ${value.blockingFindingCount} blocking issue(s) on this exact checked version.`
      : 'An independent reviewer rejected this exact checked version.',
  });
}

// The one binding the founder panel reads. It names all four coordinates the
// summary claims to be about — run, time, packet, subject hash — and refuses to
// exist when any of the first two is unknown. A panel bound to nothing renders
// UNAVAILABLE rather than to whatever happened to be last in a directory.
function bindCurrentRun(ordered, subjectSha256, nowMs = Date.now()) {
  const gateSubject = typeof subjectSha256 === 'string' && subjectSha256 ? subjectSha256 : null;
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const normalized = ordered.map(normalizeRunTimes);
  const futureRuns = normalized.filter((r) => futureRunTimestamp(r, effectiveNow));
  const dated = normalized.filter((r) =>
    Number.isFinite(r.updatedAtMs) && !futureRunTimestamp(r, effectiveNow));
  if (!dated.length) {
    return { state: 'UNAVAILABLE', runId: null, updatedAt: null, packetId: null,
      subjectSha256: null, runSubjectSha256: null, gateSubjectSha256: gateSubject,
      subjectState: 'UNAVAILABLE',
      reason: futureRuns.length
        ? `${futureRuns.length} run record(s) carry a timestamp in the future, so current run evidence is unavailable until the clock and records agree.`
        : normalized.length
        ? `${normalized.length} run record(s) exist but none carries a parseable updatedAt timestamp, so which one is current cannot be established. Selecting by filename order would be a guess.`
        : 'no run records exist yet, so no run is current.' };
  }
  const latest = selectCurrentRun(dated, effectiveNow);
  const tied = dated.filter((r) => r.updatedAtMs === latest.updatedAtMs);

  const runSubject = latest.subjectSha256 && isSubjectSha(latest.subjectSha256) ? latest.subjectSha256 : null;
  const linked = !!gateSubject && !!runSubject && gateSubject === runSubject;
  const subjectState = !gateSubject ? 'UNAVAILABLE'
    : (!runSubject ? 'UNLINKED' : (linked ? 'BOUND' : 'MISMATCHED'));
  const subjectPlain = {
    UNAVAILABLE: ' No subject hash is available, so this run is not bound to a reviewed version of the code.',
    UNLINKED: ` The gate verdict on this page is for subject ${String(gateSubject).slice(0, 12)}…, but this run's own ` +
      'record names no subject hash, so nothing links that verdict to this run. The run\'s code version is UNAVAILABLE — ' +
      'the gate subject is shown separately and must not be read as this run\'s.',
    MISMATCHED: ` The gate verdict on this page is for subject ${String(gateSubject).slice(0, 12)}…, but this run's own ` +
      `record names subject ${String(runSubject).slice(0, 12)}…. They are different versions of the code, so the verdict ` +
      'on this page does not cover this run.',
    BOUND: ` This run's own record names subject ${String(runSubject).slice(0, 12)}…, which is exactly the subject the ` +
      'gate verdict on this page is for.',
  }[subjectState];

  return {
    state: 'BOUND',
    runId: latest.runId,
    updatedAt: latest.updatedAt,
    createdAt: latest.createdAt,
    runState: latest.state,
    objective: latest.objective,
    packetId: latest.packetId,
    // The run's code version. Null unless the run itself proved the linkage.
    subjectSha256: linked ? runSubject : null,
    // The two inputs, kept visible and kept apart.
    runSubjectSha256: runSubject,
    gateSubjectSha256: gateSubject,
    subjectState,
    selectedBy: 'the newest updatedAt timestamp recorded by the run itself',
    tiedCount: tied.length,
    undatedRuns: normalized.length - dated.length - futureRuns.length,
    futureRuns: futureRuns.length,
    reason: `Bound to ${latest.runId}, whose own record was last written ${latest.updatedAt}.` +
      (tied.length > 1 ? ` ${tied.length} runs share that exact timestamp; the tie was broken by run id, so this binding is deterministic but not unambiguous.` : '') +
      (normalized.length - dated.length - futureRuns.length > 0 ? ` ${normalized.length - dated.length - futureRuns.length} run record(s) carry no usable timestamp and were excluded from this selection.` : '') +
      (futureRuns.length > 0 ? ` ${futureRuns.length} future-dated run record(s) were excluded and cannot establish current state.` : '') +
      subjectPlain,
  };
}

// `opts.runsDir` injects the directory of run records. It defaults to the
// canonical `builder-control/runs`. Codex G1 finding #5: the only proof that a
// run's subject hash is read from run.subject.subjectSha256 and nowhere else
// ran against whatever happened to be on disk, which in the reviewed workspace
// was zero runs — so the proof asserted nothing. A table of injected records is
// the only way to show that the canonical location is accepted AND that every
// alternate location is refused.
function projectRuns(opts = {}) {
  const subjectSha256 = opts && typeof opts.subjectSha256 === 'string' ? opts.subjectSha256 : null;
  const requestedNow = typeof opts.now === 'string' ? Date.parse(opts.now) : opts.now;
  const nowMs = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const dir = resolveEvidencePath(opts && opts.runsDir, path.join(HERE, 'runs'), null);
  if (!fs.existsSync(dir)) {
    return { state: 'UNAVAILABLE', reason: 'the run evidence directory is unavailable', runs: [],
      current: { ...bindCurrentRun([], subjectSha256), evidenceState: 'UNAVAILABLE',
        reason: 'the run evidence directory is unavailable, so an empty run list is not proof that no run exists.' } };
  }
  const runs = [];
  const invalidFiles = new Set();
  const invalidReasons = [];
  const seenRunIds = new Set();
  const runtime = require('./aegis-run.cjs');
  const knownStates = runtime.STATES;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      // Parseable JSON is not necessarily a run record. The public lifecycle
      // identity must at least be attributable to a non-empty run id and one
      // canonical runtime state. Timestamps remain separately fail-closed so
      // an otherwise valid historical record may still be reported as undated.
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        invalidFiles.add(f);
        invalidReasons.push(`${f} is not a run-record object.`);
        continue;
      }
      const recordProblems = [];
      if (typeof r.runId !== 'string' || !RUN_ID_RE.test(r.runId)) {
        recordProblems.push(`${f} does not contain a canonical RUN-YYYYMMDD-8hex runId`);
      } else {
        if (seenRunIds.has(r.runId)) recordProblems.push(`${r.runId} appears in more than one run file`);
        seenRunIds.add(r.runId);
        if (f !== `${r.runId}.json`) recordProblems.push(`${f} is an alias; canonical filename is ${r.runId}.json`);
      }
      if (typeof r.state !== 'string' || !Object.prototype.hasOwnProperty.call(knownStates, r.state)) {
        recordProblems.push(`${f} does not carry a canonical runtime state`);
      }
      const times = normalizeRunTimes(r);
      if (futureRunTimestamp(times, nowMs)) {
        recordProblems.push(`${f} carries a future timestamp (${r.updatedAt || r.createdAt})`);
      }
      if (recordProblems.length) {
        invalidFiles.add(f);
        invalidReasons.push(...recordProblems.map((reason) => `${reason}.`));
        continue;
      }
      // The runtime's exported watchdog remains the one sequence/ledger
      // authority.  Project it from the exact raw run object captured above;
      // do not wait for a `run.watchdog` field that the runtime never writes,
      // and do not recreate its required sequence in this projector.
      let watchdog;
      try { watchdog = runtime.watchdog(r); }
      catch (error) {
        watchdog = { ok: false, problems: [{
          rule: 'WATCHDOG-EVIDENCE-UNAVAILABLE',
          detail: `the canonical watchdog could not read this run: ${String(error && error.message || error).slice(0, 240)}`,
        }], reached: [], required: [] };
      }
      const worktree = projectWorktree(r.worktree, r);
      const checkpoint = projectCheckpoint(r.checkpoint, r, watchdog);
      const projected = {
        runId: r.runId, state: r.state, objective: r.objective,
        // Authoritative time, from the record itself — never the filename and
        // never the file's mtime, which a copy or a checkout would rewrite.
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
        updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
        createdAtMs: Number.isNaN(Date.parse(r.createdAt)) ? null : Date.parse(r.createdAt),
        updatedAtMs: Number.isNaN(Date.parse(r.updatedAt)) ? null : Date.parse(r.updatedAt),
        packetId: typeof r.packet === 'string' && r.packet ? r.packet : null,
        // The run's OWN authoritative linkage to a gate subject, read from one
        // canonical place (run.subject.subjectSha256) and validated against the
        // one canonical subject-hash shape. A record that names none gets null,
        // and null is what makes the code version render UNAVAILABLE instead of
        // borrowing the page's gate subject.
        subjectSha256: runSubjectOf(r),
        risk: r.risk || null,
        contractStep: (knownStates[r.state] || {}).step ?? null,
        // The private absolute path never crosses the projection boundary.
        // A positive stage consumes only this structurally validated receipt.
        worktree,
        build: projectWorker(r.build, r.state, runtime),
        route: projectRoute(r.route),
        checks: projectChecks(r.checks, r.state, watchdog),
        acceptanceCriteriaCount: Array.isArray(r.acceptanceCriteria) &&
          r.acceptanceCriteria.length > 0 && r.acceptanceCriteria.every((criterion) =>
            typeof criterion === 'string' && criterion.trim().length > 0)
          ? r.acceptanceCriteria.length : null,
        corrections: Number.isInteger(r.corrections) && r.corrections >= 0 ? r.corrections : null,
        maxCorrections: Number.isInteger(runtime.MAX_CORRECTIONS) && runtime.MAX_CORRECTIONS > 0
          ? runtime.MAX_CORRECTIONS : null,
        reviewFailure: projectReviewFailure(r.reviewFailure),
        watchdog,
        checkpoint: checkpoint.checkpoint,
        rollbackPoint: checkpoint.rollbackPoint,
        checkpointState: checkpoint.state,
        checkpointReason: checkpoint.reason,
        transitions: (r.transitions || []).length,
        source: rel(path.join(dir, f)),
      };
      Object.defineProperty(projected, RUN_CONTROL_IDENTITY, {
        value: Object.freeze({
          baseCommit: r.baseCommit,
          reviewedGateRange: checkpoint.state === 'VALIDATED'
            ? Object.freeze({ base: r.checkpoint.reviewedBase, head: r.checkpoint.rollbackPoint })
            : null,
          worktree: Object.freeze({
            path: r.worktree && r.worktree.path,
            branch: r.worktree && r.worktree.branch,
            baseCommit: r.worktree && r.worktree.baseCommit,
          }),
          checks: Object.freeze({
            receiptRef: r.checks && r.checks.receiptRef
              ? Object.freeze({ entryId: r.checks.receiptRef.entryId,
                  receiptSha256: r.checks.receiptRef.receiptSha256 }) : null,
            preHostReceiptRef: r.checks && r.checks.preHostReceiptRef
              ? Object.freeze({ entryId: r.checks.preHostReceiptRef.entryId,
                  receiptSha256: r.checks.preHostReceiptRef.receiptSha256 }) : null,
          }),
          reviewFailure: privateReviewFailureClaim(r.reviewFailure),
        }),
        enumerable: false,
      });
      runs.push(projected);
    } catch {
      invalidFiles.add(f);
      invalidReasons.push(`${f} could not be read as JSON.`);
    }
  }
  const ordered = orderRuns(runs);
  if (invalidFiles.size > 0) {
    const details = invalidReasons.slice(0, 4).join(' ');
    const remainder = invalidReasons.length > 4 ? ` ${invalidReasons.length - 4} additional validation problem(s) are withheld from this summary.` : '';
    const reason = `${invalidFiles.size} run record(s) could not be read or validated, so current run status and lifecycle evidence are unavailable. ${details}${remainder}`;
    return { state: 'UNAVAILABLE', reason, invalidRecords: invalidFiles.size, invalidReasons, runs: ordered,
      current: { ...bindCurrentRun([], subjectSha256), evidenceState: 'UNAVAILABLE', reason }, source: rel(dir) };
  }
  return { state: 'OK', runs: ordered,
    current: { ...bindCurrentRun(ordered, subjectSha256, nowMs), evidenceState: 'OK' }, source: rel(dir) };
}

// Rebind a gate subject to an ALREADY CAPTURED run projection. This function
// deliberately performs no filesystem I/O: a snapshot must not reopen the run
// directory after the gate has run, because a worker may legitimately advance
// a run in between those reads. Mixing the stages from the first read with the
// run list/current binding from the second produces a snapshot that never
// existed at any instant.
function bindCapturedRuns(capture, subjectSha256, nowMs) {
  const runs = capture && Array.isArray(capture.runs) ? capture.runs : [];
  if (!capture || capture.state !== 'OK') {
    const reason = capture && capture.reason
      ? capture.reason
      : 'the captured run evidence is unavailable, so current run status cannot be established.';
    return {
      ...(capture || { state: 'UNAVAILABLE', runs: [] }),
      current: { ...bindCurrentRun([], subjectSha256, nowMs), evidenceState: 'UNAVAILABLE', reason },
    };
  }
  return {
    ...capture,
    current: { ...bindCurrentRun(runs, subjectSha256, nowMs), evidenceState: 'OK' },
  };
}

// Freeze the captured evidence recursively before any downstream projector
// receives it. The capture is a value object (JSON-compatible data only), so a
// recursive freeze is sufficient and makes accidental mutation fail loudly in
// strict mode instead of creating another mixed-time view in memory.
function freezeEvidence(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeEvidence(child);
  return Object.freeze(value);
}

// `deps` injects the evidence artifacts the snapshot is projected FROM:
// `registryPath`, `ledgerFile` and `runsDir`. Every one of them defaults to the
// canonical production path, which is what the CLI below relies on — it calls
// `snapshot(args)` with no deps and therefore reads canonical evidence, exactly
// as before. Supplying them lets a test project a whole snapshot from isolated
// fixtures without touching a single canonical file.
function snapshot(args, deps = {}) {
  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const cost = projectCost();
  const events = projectEvents(Number(args.events) > 0 ? Number(args.events) : 12, deps.ledgerFile);
  const reviewers = projectReviewers(now, deps.canonPath);
  // Read and validate the run directory ONCE. Everything below — engineering
  // stages, the public runs list, and the current binding — is derived from
  // this immutable capture. `afterRunCapture` is a test-only mutation seam: it
  // lets a proof advance the directory at the exact point where the former
  // second read observed a different world. The CLI supplies no deps, so the
  // production path has no callback or alternate authority.
  const runCapture = freezeEvidence(projectRuns({ subjectSha256: null, runsDir: deps.runsDir, now }));
  if (typeof deps.afterRunCapture === 'function') deps.afterRunCapture(runCapture);
  const currentRun = runCapture && runCapture.current && runCapture.current.runId
    ? runCapture.runs.find((run) => run.runId === runCapture.current.runId) || null
    : null;
  const engineering = projectEngineering(args, {
    runs: runCapture.runs,
    currentRun,
    surfaceEvidence: { cost, events, reviewers, runs: runCapture },
  });
  // Reuse the one immutable run capture. A canonical gate-backed refusal may
  // replace only the generic claim on the selected REVIEW_FAILED run; no file
  // is reopened and no mutable run verdict is promoted on its own.
  const publicRunCapture = engineering.reviewFailure && currentRun
    ? {
        ...runCapture,
        runs: runCapture.runs.map((run) => run.runId === currentRun.runId &&
          run.state === 'REVIEW_FAILED'
          ? { ...run, reviewFailure: engineering.reviewFailure }
          : run),
      }
    : runCapture;
  const integration = { connectors: projectConnectors(now, deps) };

  // Failure isolation, made structural: these are two objects. There is no
  // combined "overall health" field, because the moment one exists somebody
  // will let a failed connector darken a verified build.
  return {
    generatedAt: nowIso,
    contract: {
      absences: ['UNAVAILABLE', 'STALE', 'UNVERIFIED'],
      note: 'Engineering and integration state are separate and are never blended. No field in this snapshot is synthesised; every value cites the artifact it came from.',
    },
    engineering,
    integration,
    // A THIRD plane, deliberately not merged into either of the others. It is
    // not engineering (it holds no authority) and not integration (a Notion
    // disagreement is not a connector fault). Separating it is precisely what
    // makes "engineering VERIFIED / knowledge CONFLICT" a renderable pair
    // rather than a contradiction something has to resolve.
    knowledge: (() => {
      try { return require('./knowledge-mirror.cjs').project({ now }); }
      catch (e) {
        // A refusal is a real, reportable state — never silently omitted.
        return { state: 'REFUSED', reason: e.message, records: [], conflicts: 0 };
      }
    })(),
    reviewers,
    cost,
    runs: bindCapturedRuns(
      publicRunCapture,
      engineering.state === 'OK' ? engineering.subjectSha256 : null,
      now,
    ),
    events,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {};
  // CONFIRMED FINDING #8: the projector only accepted --packet and
  // --subject-sha, so gateDone recomputed from `git diff HEAD` — empty once the
  // reviewed change is committed. The dashboard then showed an empty subject
  // for work that had actually been reviewed. The exact range the gate used is
  // now forwarded rather than reconstructed from the working tree.
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--subject-sha') a.subjectSha = argv[++i];
    else if (t === '--packet') a.packet = argv[++i];
    else if (t === '--base') a.base = argv[++i];
    else if (t === '--head') a.head = argv[++i];
    else if (t === '--events') a.events = argv[++i];
    else if (t === '--json') a.json = true;
    else if (t === '--out') a.out = argv[++i];
  }
  return a;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let snap;
  try {
    snap = snapshot(args);
  } catch (e) {
    if (e.refused) {
      process.stderr.write(`\nAEGIS-STATE REFUSED\n  rule:   AEGIS-CONNECTOR-PLANE-VIOLATION\n  reason: ${e.message}\n`);
      process.exit(EXIT_REFUSED);
    }
    throw e;
  }
  const text = JSON.stringify(snap, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    // A `.js` target emits a global assignment rather than bare JSON. The
    // dashboard has to work from file:// with no server — that is the whole
    // point of an evidence view — and fetch() of a local JSON file is blocked
    // by the file:// origin policy. A script tag is not. The content is
    // identical either way; only the wrapper differs.
    const isJs = args.out.endsWith('.js');
    const body = isJs
      ? `/* Generated by builder-control/aegis-state.cjs — do not edit by hand.\n   Every value here cites the artifact it came from. Regenerate with:\n     node builder-control/aegis-state.cjs --out builder-control/dashboard/state.js */\nwindow.AEGIS_STATE = ${text};\n`
      : text + '\n';
    fs.writeFileSync(args.out, body, 'utf8');
    process.stderr.write(`[aegis-state] wrote ${rel(path.resolve(args.out))}\n`);
  } else {
    process.stdout.write(text + '\n');
  }
  process.exit(EXIT_PASS);
}

module.exports = {
  projectCost, projectFx, toCad, projectRuns, bindCapturedRuns, orderRuns, selectCurrentRun, bindCurrentRun, snapshot, projectConnectors, projectReviewers, projectEvents,
  successfulTerminalCostEnvelope,
  deriveStages, REQUIRED_STAGES, REVIEWER_ROLES,
  projectAuthentication, projectLastVerified, projectLastUsedByRun,
  canonicalReviewRefusal,
  latestProbe, classifyProbeOutcome, ledgerUsageEvents, normalizeLedgerUsageEvents,
  LEDGER_USAGE_GATE, USAGE_CORRELATION_WINDOW_MINUTES,
  PROBE_SUCCESS, PROBE_FAILURE, PROBE_INCONCLUSIVE, PROBE_CONTRADICTORY,
  SUCCESS_HEALTH, FAILURE_HEALTH, FX_CANON,
  // Injection surface, exported so a test can prove the confinement rule holds
  // rather than take it on faith.
  resolveEvidencePath, ENV_REGISTRY, REGISTRY, LEDGER,
  RUN_ID_RE,
  ACTIVE_ASYNC_WORKER_STATES,
};
