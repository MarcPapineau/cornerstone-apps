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
function loadRecords(dir) {
  if (!fs.existsSync(dir)) return { records: [], problems: [] };
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
  for (const name of names.sort()) {
    const full = path.join(dir, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      records.push({ __file: full, ...parsed });
    } catch (e) {
      problems.push({ code: 'RECORD-UNPARSEABLE', file: full, detail: e.message });
    }
  }
  return { records, problems };
}

// -- rounds ------------------------------------------------------------------
// A round is one subject hash. Records superseded by a later record from the
// same reviewer are dropped first: `supersedes` is the one deterministic
// replacement rule in this system, and a superseded record is not an extra
// round, it is a correction of the same round's paperwork.
function roundsFor(records, packetId) {
  const mine = records.filter((r) => r && r.packetId === packetId);
  const superseded = new Set(mine.map((r) => r.supersedes).filter(Boolean));
  const live = mine.filter((r) => !superseded.has(r.reviewId));

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
      blockingCount: findings.filter(isBlocking).length,
    };
  });

  // Order by first timestamp. Ties (or missing timestamps) fall back to the
  // subject hash so the ordering is at least deterministic across machines.
  rounds.sort((a, b) =>
    (a.firstTs || '').localeCompare(b.firstTs || '')
    || String(a.subject || '').localeCompare(String(b.subject || '')));
  rounds.forEach((r, i) => { r.round = i + 1; });
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
  const seen = new Map();
  const out = [];
  for (const round of rounds) {
    const here = new Set();
    for (const f of round.findings) {
      const fp = fingerprint(f);
      if (here.has(fp)) continue;
      here.add(fp);
      if (seen.has(fp)) {
        const prior = seen.get(fp);
        out.push({
          fingerprint: fp,
          severity: f.severity,
          file: f.file || null,
          problem: f.problem || '',
          firstRaisedRound: prior.round,
          firstRaisedReviewId: prior.reviewId,
          raisedAgainRound: round.round,
          raisedAgainReviewId: f.__reviewId,
          priorStatus: prior.status || null,
          currentStatus: f.status || null,
        });
      } else {
        seen.set(fp, { round: round.round, reviewId: f.__reviewId, status: f.status });
      }
    }
  }
  // Only report each fingerprint's first recurrence. A finding that came back
  // three times is one dispute, not three.
  const first = new Map();
  for (const r of out) if (!first.has(r.fingerprint)) first.set(r.fingerprint, r);
  return [...first.values()];
}

// -- verdict -----------------------------------------------------------------
function analyze({ records, packetId }) {
  const rounds = roundsFor(records, packetId);
  const disputed = recurrences(rounds);
  const roundCount = rounds.length;
  const last = rounds[roundCount - 1] || null;

  const reasons = [];

  // D-19 / D-14. Two ways to hit the limit, and both STOP.
  //
  // A fourth round should not exist at all — if one does, the limit was already
  // breached before this checker ran, and saying so is more useful than
  // pretending the state is fine.
  if (roundCount > MAX_REVIEW_ROUNDS) {
    reasons.push({
      rule: 'D-19',
      detail: `${roundCount} review rounds exist for this packet; the limit is ${MAX_REVIEW_ROUNDS}. Round ${MAX_REVIEW_ROUNDS + 1} should never have been started.`,
    });
  } else if (roundCount === MAX_REVIEW_ROUNDS && last && last.blockingCount > 0) {
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

  const verdict = reasons.length ? 'HALT_ESCALATE' : 'PROCEED';
  return {
    packetId,
    roundCount,
    maxRounds: MAX_REVIEW_ROUNDS,
    roundsRemaining: Math.max(0, MAX_REVIEW_ROUNDS - roundCount),
    verdict,
    reasons,
    disputed,
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
  const head = result.verdict === 'PROCEED' ? 'PROCEED' : 'STOP - ESCALATE TO A HUMAN';
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
  if (result.verdict !== 'PROCEED') {
    out('');
    out('  D-14: automated review STOPS here. Do not attempt one more pass.');
    out('  The decision required is: accept, override, or abandon the packet.');
  }
}

function main(argv) {
  const out = console.log;
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`review-cycle: ${args.error}`);
    console.error('usage: review-cycle.cjs (--packet <id> | --all) [--json] [--reviews-dir <path>]');
    return EXIT_USAGE;
  }

  let loaded;
  try {
    loaded = loadRecords(args.dir);
  } catch (e) {
    console.error(`review-cycle: ${e.message}`);
    return EXIT_USAGE;
  }
  if (loaded.problems.length) {
    // FAIL-CLOSED. One unparseable record means the round count is a guess.
    for (const p of loaded.problems) console.error(`review-cycle: ${p.code} ${p.file}: ${p.detail}`);
    console.error('review-cycle: cycle state cannot be determined with unreadable evidence present.');
    return EXIT_USAGE;
  }

  const targets = args.all ? packetIdsIn(loaded.records) : [args.packet];
  if (!targets.length) {
    out('review-cycle: no packets found in review evidence.');
    return EXIT_PASS;
  }

  const results = targets.map((id) => analyze({ records: loaded.records, packetId: id }));
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
  loadRecords, packetIdsIn, parseArgs, main,
  MAX_REVIEW_ROUNDS, BLOCKING_SEVERITIES, RESOLVED_STATUSES,
};
