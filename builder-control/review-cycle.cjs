#!/usr/bin/env node
/**
 * review-cycle.cjs — enforces AEGIS Decision Register D-19, D-20 and D-14.
 *
 * These three decisions were made on 30 Aug 2026 and recorded in
 * 06.2 · AEGIS Decision Register. Until this file existed they were enforced
 * nowhere: a grep across builder-control for cycleLimit / reviewRound /
 * correctionRound / churn / disputed returned exactly one hit, in
 * schemas/engineering-review.schema.json — a shape a record is ALLOWED to
 * have, not a rule anything applies.
 *
 *   D-19  Review cycle limit is 2 corrections — initial review plus up to two
 *         correction-and-re-review rounds, three reviews maximum. On the third
 *         set of findings, stop and escalate.
 *   D-20  A finding raised, addressed, and raised again on the same subject is
 *         flagged DISPUTED immediately — it does not wait for the cycle limit.
 *   D-14  On hitting the review cycle limit, automated review STOPS and
 *         escalates. "It does not attempt one more pass."
 *
 * WHY THIS FILE IS THE FIRST SELF-BUILD PACKET. A review loop ran for roughly
 * seventy hours against this codebase in direct violation of all three. Every
 * "one final pass" was D-14 being broken by a system that had never been told
 * about it. The governance was written, correct, and unread by the runtime.
 *
 * WHERE THE ROUND COUNT COMES FROM — no new state, no counter file.
 * engineering-os.cjs already partitions records into `active` (bound to the
 * current subject hash) and `foreign` (bound to some other hash). For one
 * packetId, the foreign records ARE the earlier rounds: a correction changes
 * the diff, which changes reviewOf.diffSha256, which makes every prior record
 * foreign. So the number of distinct subject hashes reviewed under a packetId
 * is the number of review rounds, and it is already sitting on disk. A counter
 * file would be a second source of truth for something the evidence already
 * proves, and D-01 says the evidence owns runtime truth.
 *
 *   node builder-control/review-cycle.cjs --packet PKT-...
 *   node builder-control/review-cycle.cjs --packet PKT-... --json
 *   node builder-control/review-cycle.cjs --all
 *
 * Exit 0 = proceed. Exit 1 = STOP, escalate to a human. Exit 2 = cannot run.
 *
 * FAIL-CLOSED: an unreadable reviews/ directory or an unparseable record exits
 * 2. "The cycle state could not be determined" must never print the same way
 * as "you are clear to run another review round".
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const REVIEWS_DIR = path.join(HERE, 'reviews');

const EXIT_PASS = 0;
const EXIT_HALT = 1;
const EXIT_USAGE = 2;

// D-19. Three reviews total: the initial one plus at most two correction
// rounds. The rationale recorded with the decision is that this is where the
// evidence stops improving — the first correction catches real defects, the
// second catches what the first introduced, and beyond that findings are
// disagreements about approach, which are not resolved by asking the same two
// models again.
const MAX_REVIEW_ROUNDS = 3;
const DEFAULT_REQUIRED_REVIEWERS = Object.freeze(['codex', 'grok']);

// Severities that make a round count as "a set of findings" for D-19. MEDIUM
// and LOW do not stop a packet; treating them as blocking would recreate the
// churn this file exists to end.
const BLOCKING_SEVERITIES = new Set(['CRITICAL', 'HIGH']);

// A finding is not blocking once it has been dispositioned by someone with the
// authority to do so. FIXED needs an independent verifier, DISPUTED needs a
// builder rationale, ACCEPTED_RISK needs a human — the schema enforces each of
// those, so trusting the status here does not widen anything.
const RESOLVED_STATUSES = new Set(['FIXED', 'DISPUTED', 'ACCEPTED_RISK']);

// -- finding identity --------------------------------------------------------
// The schema gives findings no id, so recurrence has to be recognised from
// content. Fingerprint on the stable parts: severity, file, and the problem
// statement normalised for whitespace, case and trailing punctuation. Location
// is deliberately EXCLUDED — a finding that moves from line 412 to line 418
// because the file above it changed is the same finding, and including the
// line number is how a recurrence detector gets defeated by a reformat.
function fingerprint(finding) {
  const sev = String(finding.severity || '').trim().toUpperCase();
  const file = String(finding.file || '').trim();
  const problem = String(finding.problem || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.;,:!?]+$/, '')
    .trim();
  return `${sev} ${file} ${problem}`;
}

function isBlocking(finding) {
  return BLOCKING_SEVERITIES.has(String(finding.severity || '').toUpperCase())
    && !RESOLVED_STATUSES.has(String(finding.status || '').toUpperCase());
}

// -- loading -----------------------------------------------------------------
// Only the top level of reviews/ is evidence, matching collectReviewPaths in
// engineering-os.cjs. Subdirectories are archives — reviews/groups/ holds
// per-group records the gate does not read, and reviews/legacy-unattested/
// holds pre-attestation history. Counting either as a round would inflate the
// cycle count with paperwork that never gated anything.
function loadRecords(dir, opts = {}) {
  if (!fs.existsSync(dir)) return { records: [], problems: [], unavailable: [] };
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'))
      .map((d) => d.name);
  } catch (e) {
    throw new Error(`cannot read ${dir}: ${e.message}`);
  }
  const records = [];
  const problems = [];
  const unavailable = [];
  for (const name of names.sort()) {
    const full = path.join(dir, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      // A packet-specific cycle must not be blocked by malformed history from
      // another packet. Once a parseable record claims this packet, however,
      // it must pass the SAME schema, semantics, and attestation authority as
      // engineering-os before it can influence reviewer issuance.
      if (opts.packetId && parsed.packetId !== opts.packetId) continue;
      let rec = parsed;
      if (typeof opts.validateReview === 'function') {
        const validated = opts.validateReview(full, { packetPath: opts.packetPath });
        if (!validated || !validated.ok) {
          problems.push({
            code: 'RECORD-INVALID', file: full,
            detail: validated && Array.isArray(validated.errors)
              ? validated.errors.join('; ') : 'canonical review validator refused the record',
          });
          continue;
        }
        rec = validated.rec;
      }
      if (rec.disposition === 'UNAVAILABLE') {
        unavailable.push({ reviewId: rec.reviewId, reviewer: rec.reviewer,
          subject: rec.reviewOf && rec.reviewOf.diffSha256,
          reason: rec.unavailableReason || 'reviewer unavailable' });
        continue;
      }
      records.push({ __file: full, ...rec });
    } catch (e) {
      problems.push({ code: 'RECORD-UNPARSEABLE', file: full, detail: e.message });
    }
  }
  return { records, problems, unavailable };
}

// -- rounds ------------------------------------------------------------------
// A round is one subject hash. A supersession can retire a record only when it
// is a same-packet, same-reviewer correction of paperwork for the SAME subject.
// Anything else is untrusted evidence: it does not reduce the round count and
// analyze() fails closed. Without this scope, a Grok record (or a later subject)
// could erase a Codex round merely by naming its reviewId.
function resolveSupersessions(records, packetId) {
  const mine = records.filter((r) => r && r.packetId === packetId);
  const byId = new Map();
  for (const r of records.filter(Boolean)) {
    if (!r.reviewId) continue;
    if (!byId.has(r.reviewId)) byId.set(r.reviewId, []);
    byId.get(r.reviewId).push(r);
  }

  const superseded = new Set();
  const problems = [];
  for (const r of mine) {
    if (!r.supersedes) continue;
    const prefix = `${r.reviewId || '(missing reviewId)'} supersedes ${r.supersedes}`;
    if (!r.reviewId || r.supersedes === r.reviewId) {
      problems.push(`${prefix}: self-supersession or missing replacement reviewId is invalid.`);
      continue;
    }
    const matches = byId.get(r.supersedes) || [];
    if (matches.length !== 1) {
      problems.push(`${prefix}: target must resolve to exactly one review record; found ${matches.length}.`);
      continue;
    }
    const target = matches[0];
    const subject = r.reviewOf && r.reviewOf.diffSha256;
    const targetSubject = target.reviewOf && target.reviewOf.diffSha256;
    if (target.packetId !== packetId) {
      problems.push(`${prefix}: cross-packet supersession is forbidden.`);
      continue;
    }
    if (!r.reviewer || r.reviewer !== target.reviewer) {
      problems.push(`${prefix}: cross-reviewer supersession is forbidden.`);
      continue;
    }
    if (!subject || subject !== targetSubject) {
      problems.push(`${prefix}: cross-subject or unbound supersession is forbidden.`);
      continue;
    }
    superseded.add(target.reviewId);
  }
  return { mine, superseded, problems };
}

function roundsFor(records, packetId) {
  const resolution = resolveSupersessions(records, packetId);
  const live = resolution.mine.filter((r) => !resolution.superseded.has(r.reviewId));

  const byHash = new Map();
  for (const r of live) {
    const hash = (r.reviewOf && r.reviewOf.diffSha256) || null;
    // A record with no subject binding cannot be placed in the sequence. It is
    // reported rather than silently dropped or silently counted.
    const key = hash || ` UNBOUND ${r.reviewId}`;
    if (!byHash.has(key)) byHash.set(key, { subject: hash, records: [] });
    byHash.get(key).records.push(r);
  }

  const rounds = [...byHash.values()].map((round) => {
    const ts = round.records
      .map((r) => String(r.ts || ''))
      .filter(Boolean)
      .sort();
    const findings = [];
    for (const r of round.records) {
      for (const f of (Array.isArray(r.findings) ? r.findings : [])) {
        findings.push({ ...f, __reviewId: r.reviewId, __reviewer: r.reviewer });
      }
    }
    return {
      subject: round.subject,
      firstTs: ts[0] || '',
      reviewIds: round.records.map((r) => r.reviewId),
      reviewers: [...new Set(round.records.map((r) => r.reviewer))],
      dispositions: [...new Set(round.records.map((r) => r.disposition))],
      findings,
      records: round.records,
      blockingCount: findings.filter(isBlocking).length,
    };
  });

  // Order by first timestamp. Ties (or missing timestamps) fall back to the
  // subject hash so the ordering is at least deterministic across machines.
  rounds.sort((a, b) =>
    (a.firstTs || '').localeCompare(b.firstTs || '')
    || String(a.subject || '').localeCompare(String(b.subject || '')));
  rounds.forEach((r, i) => { r.round = i + 1; });
  // Preserve the array API while carrying fail-closed evidence diagnostics to
  // analyze(). This property is intentionally non-enumerable so JSON output of
  // a bare roundsFor() result remains the historical array shape.
  Object.defineProperty(rounds, 'supersessionProblems', {
    value: resolution.problems,
    enumerable: false,
  });
  return rounds;
}

// -- D-20: recurrence --------------------------------------------------------
// "Raised, addressed, and raised again." Recurrence is detected ACROSS rounds
// within one packet, not within a single subject hash: each correction produces
// a new hash, so a finding that came back after a fix necessarily appears under
// a different subject than the one it was first raised against. Reading "same
// subject" as "same hash" would make the rule unfireable, which cannot be what
// a decision written to catch repeat findings meant.
//
// This does not mark anything DISPUTED by itself. The schema requires a
// builderResponse for that status, and this checker has no standing to write
// one. It reports what must be dispositioned — a human or the builder records
// the rationale.
function recurrences(rounds) {
  const lifecycle = new Map();
  const out = [];
  const problems = [];
  const reviewIndex = new Map();
  for (const round of rounds) {
    for (const record of round.records || []) reviewIndex.set(record.reviewId, { record, round });
  }
  for (const round of rounds) {
    const here = new Map();
    for (const f of round.findings) {
      const fp = fingerprint(f);
      if (!here.has(fp)) here.set(fp, []);
      here.get(fp).push(f);
    }

    // Review records are immutable; an old finding is never rewritten to
    // FIXED. A later independent reviewer instead signs an explicit PASS proof
    // in reverifiedFindings. That is the production-reachable "addressed"
    // event. Absence of the finding remains insufficient evidence.
    for (const verifier of round.records || []) {
      for (const proof of (verifier.reverifiedFindings || [])) {
        const sourceEntry = reviewIndex.get(proof.sourceReviewId);
        const sourceFinding = sourceEntry && sourceEntry.record
          && Array.isArray(sourceEntry.record.findings)
          ? sourceEntry.record.findings[proof.findingIndex] : null;
        const fp = sourceFinding ? fingerprint(sourceFinding) : null;
        const state = fp ? lifecycle.get(fp) : null;
        const independent = sourceEntry && verifier.reviewer !== 'claude-self'
          && verifier.reviewer !== sourceEntry.record.reviewer
          && verifier.reviewId !== sourceEntry.record.reviewId;
        const exact = sourceFinding && proof.outcome === 'PASS'
          && typeof proof.evidence === 'string' && proof.evidence.trim() !== ''
          && proof.verificationMethod === sourceFinding.verificationMethod;
        const laterRound = sourceEntry && round.round > sourceEntry.round.round;
        if (!state || !independent || !exact || !laterRound) {
          problems.push(`${verifier.reviewId}: invalid re-verification proof for ${proof.sourceReviewId}[${proof.findingIndex}].`);
          continue;
        }
        if (!state.addressedRound) {
          state.addressedRound = round.round;
          state.addressedReviewId = verifier.reviewId;
        }
      }
    }

    // Evaluate OPEN findings only after every valid proof in this round has
    // been applied. Two required reviewers can legitimately return one
    // addressed proof and one recurrence for the same corrected subject. That
    // is D-20 churn in this round, not something that waits for another hash.
    for (const [fp, findings] of here) {
      const open = findings.find((f) => String(f.status || '').toUpperCase() === 'OPEN');
      let state = lifecycle.get(fp);

      if (!state) {
        if (open) {
          state = {
            round: round.round,
            reviewId: open.__reviewId,
            severity: open.severity,
            file: open.file || null,
            problem: open.problem || '',
            addressedRound: null,
            addressedReviewId: null,
          };
          lifecycle.set(fp, state);
        }
        continue;
      }

      if (state.addressedRound && open && round.round >= state.addressedRound
          && open.__reviewId !== state.addressedReviewId) {
        out.push({
          fingerprint: fp,
          severity: open.severity || state.severity,
          file: open.file || state.file,
          problem: open.problem || state.problem,
          firstRaisedRound: state.round,
          firstRaisedReviewId: state.reviewId,
          addressedRound: state.addressedRound,
          addressedReviewId: state.addressedReviewId,
          raisedAgainRound: round.round,
          raisedAgainReviewId: open.__reviewId,
          priorStatus: 'FIXED',
          currentStatus: 'OPEN',
        });
      }
    }
  }
  // Only report each fingerprint's first recurrence. A finding that came back
  // three times is one dispute, not three.
  const first = new Map();
  for (const r of out) if (!first.has(r.fingerprint)) first.set(r.fingerprint, r);
  const result = [...first.values()];
  Object.defineProperty(result, 'problems', { value: problems, enumerable: false });
  return result;
}

// -- verdict -----------------------------------------------------------------
function analyze({ records, packetId, requiredReviewers = [], currentSubjectSha = null }) {
  const rounds = roundsFor(records, packetId);
  const disputed = recurrences(rounds);
  const supersessionProblems = rounds.supersessionProblems || [];
  const recurrenceProblems = disputed.problems || [];
  const roundCount = rounds.length;
  const last = rounds[roundCount - 1] || null;
  const required = [...new Set((requiredReviewers || []).map(String))];
  const currentRound = currentSubjectSha
    ? rounds.find((round) => round.subject === currentSubjectSha) || null
    : last;
  const currentReviewers = new Set(currentRound ? currentRound.reviewers : []);
  const missingReviewers = required.filter((reviewer) => !currentReviewers.has(reviewer));
  const currentRoundComplete = required.length === 0 || missingReviewers.length === 0;
  const atExistingFinalRound = roundCount === MAX_REVIEW_ROUNDS
    && currentRound && last && currentRound.subject === last.subject;
  const attemptingNewRoundAfterLimit = roundCount >= MAX_REVIEW_ROUNDS
    && currentSubjectSha && (!last || currentSubjectSha !== last.subject);

  const reasons = [];

  if (supersessionProblems.length) {
    reasons.push({
      rule: 'REVIEW-EVIDENCE',
      detail: `${supersessionProblems.length} invalid supersession declaration(s) make the review history untrustworthy: ${supersessionProblems.join(' ')}`,
    });
  }
  if (recurrenceProblems.length) {
    reasons.push({
      rule: 'REVIEW-EVIDENCE',
      detail: `${recurrenceProblems.length} invalid re-verification proof(s) make the churn history untrustworthy: ${recurrenceProblems.join(' ')}`,
    });
  }

  // D-19 / D-14. Two ways to hit the limit, and both STOP.
  //
  // A fourth round should not exist at all — if one does, the limit was already
  // breached before this checker ran, and saying so is more useful than
  // pretending the state is fine.
  if (roundCount > MAX_REVIEW_ROUNDS || attemptingNewRoundAfterLimit) {
    const observed = roundCount > MAX_REVIEW_ROUNDS
      ? `${roundCount} review rounds exist for this packet; the limit is ${MAX_REVIEW_ROUNDS}. Round ${MAX_REVIEW_ROUNDS + 1} should never have been started.`
      : `${MAX_REVIEW_ROUNDS} review rounds already exist for this packet; the limit is ${MAX_REVIEW_ROUNDS}. Round ${MAX_REVIEW_ROUNDS + 1} must not be started.`;
    reasons.push({
      rule: 'D-19',
      detail: observed,
    });
  } else if (roundCount === MAX_REVIEW_ROUNDS && last && currentRoundComplete
      && last.blockingCount > 0) {
    // "On the third set of findings, stop and escalate."
    reasons.push({
      rule: 'D-19',
      detail: `round ${roundCount} of ${MAX_REVIEW_ROUNDS} produced ${last.blockingCount} unresolved CRITICAL/HIGH finding(s). This is the third set of findings.`,
    });
  }

  if (disputed.length > 0) {
    reasons.push({
      rule: 'D-20',
      detail: `${disputed.length} finding(s) were raised, addressed, and raised again. These are DISPUTED immediately and do not wait for the cycle limit.`,
    });
  }

  // A clean third round is success, but it is NOT permission to launch round
  // four. Route to the gate and make the reviewer-launch path stop here.
  const incompleteFinalRound = atExistingFinalRound && !currentRoundComplete;
  const verdict = reasons.length
    ? 'HALT_ESCALATE'
    : roundCount >= MAX_REVIEW_ROUNDS && !incompleteFinalRound
      ? 'COMPLETE_GATE'
      : 'PROCEED';
  const allowedReviewers = verdict === 'PROCEED'
    ? (currentRound ? missingReviewers : required)
    : [];
  return {
    packetId,
    roundCount,
    maxRounds: MAX_REVIEW_ROUNDS,
    roundsRemaining: Math.max(0, MAX_REVIEW_ROUNDS - roundCount),
    verdict,
    requiredReviewers: required,
    missingReviewers,
    allowedReviewers,
    currentRoundComplete,
    reasons,
    disputed,
    supersessionProblems,
    recurrenceProblems,
    rounds: rounds.map((r) => ({
      round: r.round,
      subject: r.subject,
      firstTs: r.firstTs,
      reviewers: r.reviewers,
      dispositions: r.dispositions,
      reviewIds: r.reviewIds,
      findingCount: r.findings.length,
      blockingCount: r.blockingCount,
    })),
  };
}

function packetIdsIn(records) {
  return [...new Set(records.map((r) => r && r.packetId).filter(Boolean))].sort();
}

// -- CLI ---------------------------------------------------------------------
function parseArgs(argv) {
  const args = { packet: null, all: false, json: false, dir: REVIEWS_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--packet') args.packet = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--json') args.json = true;
    else if (a === '--reviews-dir') args.dir = argv[++i];
    else return { error: `unknown argument: ${a}` };
  }
  if (!args.all && !args.packet) return { error: 'one of --packet <id> or --all is required' };
  return args;
}

function render(result, out) {
  const head = result.verdict === 'PROCEED'
    ? 'PROCEED'
    : result.verdict === 'COMPLETE_GATE'
      ? 'REVIEW COMPLETE - PROCEED TO GATE'
      : 'STOP - ESCALATE TO A HUMAN';
  out(`review-cycle: ${head} — ${result.packetId}`);
  out(`  rounds: ${result.roundCount} of ${result.maxRounds} used, ${result.roundsRemaining} remaining`);
  for (const r of result.rounds) {
    out(`    round ${r.round}  ${r.subject ? r.subject.slice(0, 12) : 'UNBOUND'}  ${r.reviewers.join(',') || '-'}  ${r.blockingCount} blocking / ${r.findingCount} finding(s)`);
  }
  for (const reason of result.reasons) {
    out(`  [${reason.rule}] ${reason.detail}`);
  }
  for (const d of result.disputed) {
    out(`  [D-20] DISPUTED: ${d.severity} in ${d.file || '(no file)'} — raised round ${d.firstRaisedRound}, returned round ${d.raisedAgainRound}`);
    out(`         "${d.problem.slice(0, 100)}"`);
  }
  if (result.verdict === 'COMPLETE_GATE') {
    out('');
    out('  D-14: automated review STOPS here. Do not start a fourth round.');
    out('  The next action is the deterministic gate/checkpoint path.');
  } else if (result.verdict !== 'PROCEED') {
    out('');
    out('  D-14: automated review STOPS here. Do not attempt one more pass.');
    out('  The decision required is: accept, override, or abandon the packet.');
  }
}

function main(argv, dependencies = {}) {
  const out = console.log;
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`review-cycle: ${args.error}`);
    console.error('usage: review-cycle.cjs (--packet <id> | --all) [--json] [--reviews-dir <path>]');
    return EXIT_USAGE;
  }

  let loaded;
  try {
    const validateReview = dependencies.validateReview
      || require('./engineering-os.cjs').loadReview;
    loaded = loadRecords(args.dir, {
      validateReview,
      packetPath: dependencies.packetPath,
      packetId: args.all ? null : args.packet,
    });
  } catch (e) {
    console.error(`review-cycle: ${e.message}`);
    return EXIT_USAGE;
  }
  if (loaded.problems.length) {
    // FAIL-CLOSED. One unparseable record means the round count is a guess.
    for (const p of loaded.problems) console.error(`review-cycle: ${p.code} ${p.file}: ${p.detail}`);
    console.error('review-cycle: cycle state cannot be determined with invalid or unreadable evidence present.');
    return EXIT_USAGE;
  }

  const targets = args.all ? packetIdsIn(loaded.records) : [args.packet];
  if (!targets.length) {
    out('review-cycle: no packets found in review evidence.');
    return EXIT_PASS;
  }

  const requiredReviewers = dependencies.requiredReviewers || DEFAULT_REQUIRED_REVIEWERS;
  const results = targets.map((id) => analyze({
    records: loaded.records,
    packetId: id,
    requiredReviewers,
  }));
  if (args.json) {
    out(JSON.stringify(args.all ? results : results[0], null, 2));
  } else {
    results.forEach((r, i) => { if (i) out(''); render(r, out); });
  }
  return results.some((r) => r.verdict !== 'PROCEED') ? EXIT_HALT : EXIT_PASS;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  analyze, roundsFor, recurrences, fingerprint, isBlocking,
  resolveSupersessions,
  loadRecords, packetIdsIn, parseArgs, main,
  MAX_REVIEW_ROUNDS, DEFAULT_REQUIRED_REVIEWERS,
  BLOCKING_SEVERITIES, RESOLVED_STATUSES,
};
