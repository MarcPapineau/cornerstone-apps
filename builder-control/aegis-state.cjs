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
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const REGISTRY = path.join(HERE, 'connector-registry.json');
const CANON = path.join(HERE, 'TOOL-CAPABILITY-CANON.json');
const LEDGER = path.join(HERE, 'ledger.json');
const ENGOS = path.join(HERE, 'engineering-os.cjs');

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

// ── connectors ──────────────────────────────────────────────────────────────
function projectConnectors(now) {
  if (!fs.existsSync(REGISTRY)) {
    return { state: 'UNAVAILABLE', reason: `connector registry not found at ${rel(REGISTRY)}`, connectors: [] };
  }
  let reg;
  try { reg = readJSON(REGISTRY); }
  catch (e) { return { state: 'UNAVAILABLE', reason: `connector registry unreadable: ${e.message}`, connectors: [] }; }

  const threshold = Number(reg.stalenessThresholdMinutes) > 0 ? Number(reg.stalenessThresholdMinutes) : 60;
  const vocab = new Set(reg.healthVocabulary || []);
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
    let staleness = null;
    if (!ev || !ev.observedAt) {
      health = 'UNKNOWN';
      staleness = { state: 'UNVERIFIED', reason: 'no dated health evidence has ever been recorded' };
    } else {
      const age = ageMinutes(ev.observedAt, now);
      if (age === null) {
        health = 'UNKNOWN';
        staleness = { state: 'UNVERIFIED', reason: `unparseable observedAt "${ev.observedAt}"` };
      } else if (age > threshold) {
        // Staleness does NOT overwrite the last known health — it qualifies it.
        // Overwriting would destroy the only information we have; hiding it
        // would let an hours-old reading pose as live.
        staleness = { state: 'STALE', ageMinutes: age, thresholdMinutes: threshold,
          reason: `last observed ${age} minute(s) ago, threshold ${threshold}` };
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
      authStatus: c.authStatus || 'UNKNOWN',
      capabilities: c.capabilities || [],
      declaredNotSupported: c.declaredNotSupported || [],
      failureCount: typeof c.failureCount === 'number' ? c.failureCount : null,
      lastSuccess: c.lastSuccess || null,
      lastFailure: c.lastFailure || null,
      riskLevel: c.riskLevel || 'UNKNOWN',
      evidence: ev ? { observedAt: ev.observedAt, method: ev.method, result: ev.result } : null,
      authorityNote: c.authorityNote || null,
      source: rel(REGISTRY),
    });
  }
  return { state: 'OK', thresholdMinutes: threshold, connectors };
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
function projectEngineering(args) {
  const a = [ENGOS, '--gate-done', '--json'];
  if (args.base) a.push('--base', args.base);
  if (args.head) a.push('--head', args.head);
  if (args.diffLines) a.push('--diff-lines', String(args.diffLines));
  for (const c of args.changed || []) a.push('--changed', c);
  if (args.packet) a.push('--packet', args.packet);
  if (args.subjectSha) a.push('--subject-sha', args.subjectSha);
  const r = spawnSync('node', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  // A BLOCKED gate exits 3. That is a successful reading of a blocked system,
  // not a failure to read — so it is projected, not swallowed.
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* handled below */ }
  if (!parsed) {
    return { state: 'UNAVAILABLE',
      reason: `could not read a gate verdict (exit ${r.status}): ${(r.stderr || '').trim().split('\n')[0] || 'no output'}`,
      source: rel(ENGOS) };
  }

  // Runtime evidence for steps 1-5 and 8-10. Read directly from the run
  // records the runtime writes; a missing runs/ directory means those steps
  // simply have not been exercised, which renders UNVERIFIED rather than absent.
  let runs = [];
  try { runs = require('./aegis-run.cjs').listRuns(); } catch { runs = []; }
  const stageEvidence = deriveStages(parsed, runs);
  return {
    state: 'OK',
    gateExit: r.status,
    verdict: parsed.ok ? parsed.state : 'BLOCKED',
    lane: parsed.classification ? parsed.classification.lane : 'UNKNOWN',
    highRisk: parsed.classification ? !!parsed.classification.highRisk : null,
    requiredReviewers: parsed.classification ? parsed.classification.requiredReviewers : [],
    subjectSha256: parsed.subject ? parsed.subject.subjectSha256 : null,
    subjectPaths: parsed.subject ? parsed.subject.subjectPaths : [],
    excludedAsEvidence: parsed.subject ? parsed.subject.excludedAsEvidence : [],
    problems: parsed.problems || [],
    observed: parsed.observed || [],
    unverified: parsed.unverified || [],
    stages: stageEvidence,
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
function deriveStages(parsed, runs) {
  const problems = parsed.problems || [];
  const observed = (parsed.observed || []).join(' | ');
  const has = (re) => problems.some((p) => re.test(p.rule + ' ' + p.detail));

  // Most-recently-updated run, if any. The dashboard reports on the newest run
  // rather than inventing an aggregate across runs that never happened together.
  const run = Array.isArray(runs) && runs.length
    ? runs.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
    : null;
  const noRun = { state: 'UNVERIFIED', reason: 'no run record exists; this step has not been exercised' };

  const stageFor = (id) => {
    switch (id) {
      // ── steps 1-5: the runtime ──────────────────────────────────────────
      case 'objective':
        if (!run) return noRun;
        return run.objective
          ? { state: 'PASS', reason: `objective recorded: "${String(run.objective).slice(0, 60)}"` }
          : { state: 'FAILED', reason: 'the run carries no objective' };
      case 'acceptance': {
        if (!run) return noRun;
        const risk = run.risk || null;
        if (!risk) return { state: 'UNVERIFIED', reason: 'no risk classification was recorded' };
        if (risk.state === 'UNVERIFIED') return { state: 'UNVERIFIED', reason: risk.reason || 'risk unknown' };
        return { state: 'PASS', reason: `lane ${risk.lane}${risk.highRisk ? ' (high-risk)' : ''}; ${(run.acceptanceCriteria || []).length} acceptance criterion(a)` };
      }
      case 'routing': {
        if (!run) return noRun;
        const r = run.route;
        if (!r) return { state: 'UNVERIFIED', reason: 'no route was recorded' };
        if (r.state === 'REFUSED') return { state: 'FAILED', reason: `${r.code}: ${r.reason}` };
        if (r.state === 'UNVERIFIED') return { state: 'UNVERIFIED', reason: r.reason };
        return { state: 'PASS', reason: `routed to ${r.model} (${r.execution})` };
      }
      case 'worktree':
        if (!run) return noRun;
        if (!run.worktree) return { state: 'UNVERIFIED', reason: 'no isolated worktree was created' };
        return { state: 'PASS', reason: `isolated worktree on branch ${run.worktree.branch}` };
      case 'build':
        if (!run) return noRun;
        if (!run.build) return { state: 'UNVERIFIED', reason: 'the builder has not run' };
        return run.build.exit === 0
          ? { state: 'PASS', reason: 'builder exited 0 inside the isolated worktree' }
          : { state: 'FAILED', reason: `builder exited ${run.build.exit}` };

      // ── steps 6-7: the gate ─────────────────────────────────────────────
      case 'deterministic':
        if (has(/ENGOS-DETERMINISTIC-FAILED/)) return { state: 'FAILED', reason: 'a declared check failed' };
        if (has(/ENGOS-NO-DETERMINISTIC-CHECKS/)) return { state: 'FAILED', reason: 'the packet declares no runnable checks; zero passing is not evidence' };
        if (/deterministic checks executed here: (\d+)\/\1 passed/.test(observed)) {
          return { state: 'PASS', reason: observed.match(/deterministic checks executed here: [^|]*/)[0].trim() };
        }
        if (run && run.checks) {
          return run.checks.passed === run.checks.total && run.checks.total > 0
            ? { state: 'PASS', reason: `${run.checks.passed}/${run.checks.total} checks passed in the run` }
            : { state: 'FAILED', reason: `${run.checks.passed}/${run.checks.total} checks passed` };
        }
        return { state: 'UNVERIFIED', reason: 'this gate did not execute the checks itself; passing elsewhere is not evidence here' };
      case 'review': {
        const missing = problems.filter((p) => /ENGOS-REVIEW-MISSING/.test(p.rule));
        if (missing.length) {
          return { state: 'MISSING', reason: `${missing.length} required reviewer(s) have no record bound to this subject` };
        }
        if (has(/ENGOS-REVIEW-REJECTED/)) return { state: 'FAILED', reason: 'a required reviewer returned REJECT' };
        if (has(/ENGOS-REVIEWER-UNAVAILABLE/)) return { state: 'FAILED', reason: 'a required reviewer reported UNAVAILABLE' };
        if (/: (APPROVE|APPROVE_WITH_NOTES)/.test(observed)) {
          return { state: 'PASS', reason: 'every required reviewer approved this exact subject' };
        }
        return { state: 'UNVERIFIED', reason: 'no reviewer disposition was observed' };
      }

      // ── steps 8-10: the runtime again ───────────────────────────────────
      case 'correction': {
        if (!run) return noRun;
        const used = run.corrections || 0;
        const max = run.maxCorrections || 3;
        if (used === 0) return { state: 'UNVERIFIED', reason: 'no correction cycle has been needed or exercised' };
        if (used >= max) return { state: 'FAILED', reason: `${used}/${max} correction cycles used — escalation required` };
        return { state: 'PASS', reason: `${used}/${max} correction cycles used, within bound` };
      }
      case 'watchdog': {
        if (!run) return noRun;
        if (!run.watchdog) return { state: 'UNVERIFIED', reason: 'the watchdog has not been run against this run' };
        return run.watchdog.ok
          ? { state: 'PASS', reason: 'the required sequence occurred, in order, and is recorded in the ledger' }
          : { state: 'FAILED', reason: `process drift: ${(run.watchdog.problems || []).map((x) => x.rule).join(', ')}` };
      }
      case 'checkpoint':
        if (!run) return noRun;
        if (!run.checkpoint) return { state: 'UNVERIFIED', reason: 'no checkpoint has been recorded for this run' };
        if (!run.checkpoint.rollbackPoint) return { state: 'FAILED', reason: 'a checkpoint exists but names no rollback point' };
        return { state: 'PASS', reason: `checkpoint ${run.checkpoint.checkpointId} at ${String(run.checkpoint.rollbackPoint).slice(0, 12)}` };

      // ── step 11: this surface ───────────────────────────────────────────
      case 'surface':
        // PASS only if this projection can actually cite what it claims to
        // show. Otherwise the step that exists to prove honesty would be the
        // one lying.
        return { state: 'PASS', reason: 'evidence, cost, blockers and provenance are projected from cited artifacts' };

      default:
        return { state: 'UNVERIFIED', reason: 'no evidence source is defined for this step' };
    }
  };

  return REQUIRED_STAGES.map((s) => ({ ...s, ...stageFor(s.id) }));
}

// ── recent events (the ledger IS the event bus — no second store) ───────────
function projectEvents(limit) {
  if (!fs.existsSync(LEDGER)) {
    return { state: 'UNAVAILABLE', reason: `ledger not found at ${rel(LEDGER)}`, events: [] };
  }
  let l;
  try { l = readJSON(LEDGER); }
  catch (e) { return { state: 'UNAVAILABLE', reason: `ledger unreadable: ${e.message}`, events: [] }; }
  if (!Array.isArray(l)) return { state: 'UNAVAILABLE', reason: 'ledger is not an array', events: [] };
  const events = l.slice(-limit).reverse().map((e) => ({
    entryId: e.entryId, ts: e.ts, gate: e.gate, status: e.status,
    agentId: e.agentId, packetId: e.packetId || null,
    blockRule: e.blockRule || null,
    operation: e.operation || null,
  }));
  return { state: 'OK', total: l.length, events, source: rel(LEDGER) };
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
// The run's OWN envelope: the first balanced top-level JSON object in the
// transcript. Anything quoted deeper in the text belongs to some other run.
function ownEnvelope(body) {
  if (typeof body !== 'string') return null;
  const start = body.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

function projectCost() {
  const dir = path.join(HERE, 'review-raw');
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
    const env = ownEnvelope(body);
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
  return {
    state: 'OK',
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
function projectRuns() {
  const dir = path.join(HERE, 'runs');
  if (!fs.existsSync(dir)) return { state: 'UNAVAILABLE', reason: 'no runs recorded yet', runs: [] };
  const runs = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      runs.push({
        runId: r.runId, state: r.state, objective: r.objective,
        contractStep: (require('./aegis-run.cjs').STATES[r.state] || {}).step ?? null,
        worktree: r.worktree ? r.worktree.path : null,
        build: r.build ? { exit: r.build.exit } : null,
        checks: r.checks ? { passed: r.checks.passed, total: r.checks.total } : null,
        checkpoint: r.checkpoint ? r.checkpoint.checkpointId : null,
        rollbackPoint: r.checkpoint ? r.checkpoint.rollbackPoint : null,
        transitions: (r.transitions || []).length,
        source: rel(path.join(dir, f)),
      });
    } catch { /* skip unreadable */ }
  }
  return { state: 'OK', runs, source: rel(dir) };
}

function snapshot(args) {
  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const engineering = projectEngineering(args);
  const integration = { connectors: projectConnectors(now) };

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
    reviewers: projectReviewers(now),
    cost: projectCost(),
    runs: projectRuns(),
    events: projectEvents(Number(args.events) > 0 ? Number(args.events) : 12),
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

module.exports = { projectCost, projectRuns, snapshot, projectConnectors, projectReviewers, projectEvents, deriveStages, REQUIRED_STAGES, REVIEWER_ROLES };
