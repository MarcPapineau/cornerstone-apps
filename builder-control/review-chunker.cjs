#!/usr/bin/env node
/**
 * review-chunker.cjs — review a subject too large for one reviewer call.
 *
 * THE PROBLEM THIS SOLVES
 * On 2026-08-25 a Codex review of 452,768 bytes across 41 paths hit the 600s
 * ceiling and returned nothing. The obvious "fix" — review less — is not a fix,
 * it is a smaller claim dressed as the same one. The subject must still be
 * covered completely; it just cannot be covered in a single call.
 *
 * So the subject is split into deterministic, COHERENT groups, each reviewed
 * within its own bounded call, and the group verdicts are aggregated under
 * rules strict enough that the aggregate is worth no more than the groups
 * beneath it.
 *
 * DETERMINISM
 * The same subject always produces the same groups. Grouping is a pure function
 * of the sorted path list — no timestamps, no randomness, no balancing that
 * depends on machine speed. If it were not deterministic, a group record could
 * never be matched back to the plan it came from.
 *
 * COHERENCE
 * Paths are grouped by ROLE, not by chopping a sorted list into equal slices. A
 * reviewer handed "the routing policy plus its router plus its adapters" can
 * reason about a mechanism; one handed "eight files that happened to sort
 * together" can only pattern-match.
 *
 * WHAT MAKES THE AGGREGATE CONSUMABLE
 * The gate accepts an aggregate ONLY when all of the following hold:
 *   - the union of group paths equals the subject EXACTLY
 *   - no path appears in two groups (overlap hides disagreement)
 *   - no group carries a path outside the subject (foreign evidence)
 *   - every group is bound to the same subject hash
 *   - every group shares one reviewer identity AND one model
 *   - every group record is signed and verifies
 *   - no group is UNAVAILABLE
 * Any failure produces an UNAVAILABLE aggregate with the reason named. There is
 * no "mostly covered".
 *
 *   node builder-control/review-chunker.cjs --plan   [--base <ref>] [--head <ref>] [--groups N] [--json]
 *   node builder-control/review-chunker.cjs --run    --group <id> --packet <p> [--timeout <s>]
 *   node builder-control/review-chunker.cjs --run-all --packet <p> [--timeout <s>]
 *   node builder-control/review-chunker.cjs --aggregate --packet <p> [--json]
 *
 * Exit: 0 ok · 2 usage · 3 refused / incomplete coverage
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const ENGOS = path.join(HERE, 'engineering-os.cjs');
const ADAPTERS = path.join(HERE, 'review-adapters.cjs');
const REVIEWS_DIR = path.join(HERE, 'reviews');
const GROUPS_DIR = path.join(REVIEWS_DIR, 'groups');
const RAW_DIR = path.join(HERE, 'review-raw');

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_REFUSED = 3;

const DEFAULT_GROUPS = 5;

// GROK G9 FINDING #1: with 7 roles and DEFAULT_GROUPS = 5 the planner only ever
// reached the MERGE branch — the byte-weight split added to fix the timeout was
// unreachable on the default plan. It demonstrably worked at --groups 12 and did
// nothing at --groups 5, which is the plan everyone actually runs.
//
// A target count alone cannot express "no group may be too large for one call",
// so that is now its own rule: any group above this budget is split regardless
// of how many groups the target asked for. The budget is derived from evidence —
// 46KB completed in 14 turns, 101KB exhausted 16 — so the ceiling sits below the
// size that has actually failed.
const MAX_GROUP_BYTES = 60000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── coherence classification ────────────────────────────────────────────────
// Ordered, first-match-wins. Order is part of the contract: moving a rule
// changes grouping for every future subject, so it is deliberately explicit
// rather than derived from directory depth.
const ROLES = [
  { id: 'tests',        re: /(^|\/)test\//,                                    label: 'Tests and fixtures' },
  { id: 'specs-docs',   re: /(^|\/)(specs?|docs?)\/|\.md$/i,                    label: 'Specifications and doctrine' },
  { id: 'ci',           re: /^\.github\//,                                      label: 'CI and reviewer instructions' },
  { id: 'projection',   re: /(aegis-state|knowledge-mirror|connector-registry)|(^|\/)(dashboard|hosting)\//, label: 'Projection, dashboard and hosting' },
  { id: 'routing',      re: /(tool-router|review-adapters|review-sign|review-chunker|MODEL-ROUTING-POLICY|TOOL-CAPABILITY-CANON)/, label: 'Model routing and reviewer adapters' },
  { id: 'control-core', re: /(^|\/)builder-control\//,                          label: 'Control core: gate, ledger, packets' },
  { id: 'other',        re: /.*/,                                               label: 'Everything else' },
];

function roleOf(p) {
  for (const r of ROLES) if (r.re.test(p)) return r.id;
  return 'other';
}

/**
 * Deterministic grouping. Pure function of the sorted path list.
 *
 * Roles are emitted in ROLES order. If there are more populated roles than the
 * target count, the SMALLEST adjacent roles merge (smallest first keeps the
 * large coherent roles intact). If there are fewer, the largest role splits on
 * a stable sort — never on file size, which would vary between machines.
 */
function planGroups(subjectPaths, target = DEFAULT_GROUPS, sizes = null) {
  const paths = [...new Set(subjectPaths)].sort();
  if (!paths.length) return [];

  const byRole = new Map();
  for (const p of paths) {
    const r = roleOf(p);
    if (!byRole.has(r)) byRole.set(r, []);
    byRole.get(r).push(p);
  }

  const weight = (g) => (sizes
    ? g.paths.reduce((n, p) => n + (sizes[p] || 0), 0)
    : g.paths.length);

  let groups = ROLES
    .filter((r) => byRole.has(r.id))
    .map((r) => ({ role: r.id, label: r.label, paths: byRole.get(r.id).slice().sort() }));

  // Too many groups: merge the smallest pair repeatedly. Ties break on role
  // order, so the outcome does not depend on Map iteration order.
  while (groups.length > target) {
    let bestI = 0, bestSize = Infinity;
    for (let i = 0; i < groups.length - 1; i++) {
      const size = groups[i].paths.length + groups[i + 1].paths.length;
      if (size < bestSize) { bestSize = size; bestI = i; }
    }
    const merged = {
      role: `${groups[bestI].role}+${groups[bestI + 1].role}`,
      label: `${groups[bestI].label} + ${groups[bestI + 1].label}`,
      paths: [...groups[bestI].paths, ...groups[bestI + 1].paths].sort(),
    };
    groups.splice(bestI, 2, merged);
  }

  // Too few groups: split the largest. "Largest" means BYTES when sizes are
  // known, and only falls back to path count when they are not.
  //
  // PROVEN DEFECT (2026-08-25): this split purely on path count, so raising
  // --groups from 5 to 12 never touched the group that actually mattered — six
  // enormous source files stayed together at ~100KB while a twelve-file group
  // of small tests split again and again. The one group that kept timing out
  // was the one the splitter would never choose. Size is what a reviewer's
  // context and turn budget are spent on, so size is what must be balanced.
  while (groups.length < target && groups.some((g) => g.paths.length > 1)) {
    let bigI = -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].paths.length < 2) continue;
      if (bigI === -1 || weight(groups[i]) > weight(groups[bigI])) bigI = i;
    }
    if (bigI === -1) break;
    // Split so the two halves are close in WEIGHT rather than in count: with
    // one 60KB file beside five 8KB files, an even count split leaves the
    // problem exactly where it was.
    const src = groups[bigI].paths;
    const half = (() => {
      if (!sizes) return Math.ceil(src.length / 2);
      const total = src.reduce((n, p) => n + (sizes[p] || 0), 0);
      let run = 0;
      for (let i = 0; i < src.length - 1; i++) {
        run += sizes[src[i]] || 0;
        if (run >= total / 2) return i + 1;
      }
      return Math.max(1, src.length - 1);
    })();
    const a = { ...groups[bigI], paths: src.slice(0, half) };
    const b = { ...groups[bigI], role: groups[bigI].role + '-b', label: groups[bigI].label + ' (part 2)', paths: src.slice(half) };
    a.label = a.label.endsWith('(part 2)') ? a.label : a.label + ' (part 1)';
    a.role = a.role.endsWith('-b') ? a.role : a.role + '-a';
    groups.splice(bigI, 1, a, b);
  }

  // Oversize split — runs AFTER merge/split-to-target and is independent of it.
  // Without sizes this is a no-op, which is correct: an unknown size must not be
  // guessed at.
  if (sizes) {
    let guard = 0;
    for (;;) {
      if (++guard > 64) break;                      // structural stop, not a policy
      let idx = -1;
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].paths.length < 2) continue;   // a single path cannot be split
        if (weight(groups[i]) > MAX_GROUP_BYTES) { idx = i; break; }
      }
      if (idx === -1) break;
      const src = groups[idx].paths;
      const total = src.reduce((n, q) => n + (sizes[q] || 0), 0);
      let run = 0, cut = 1;
      for (let i = 0; i < src.length - 1; i++) {
        run += sizes[src[i]] || 0;
        if (run >= total / 2) { cut = i + 1; break; }
        cut = i + 2;
      }
      // Clamp. Without this, `cut` could reach src.length, producing an EMPTY
      // second group while the first stayed oversize — so the loop split again,
      // and again, to the iteration guard. The observed result was 69 groups,
      // most of them empty. A split that does not reduce the thing it split is
      // not a split.
      cut = Math.min(Math.max(cut, 1), src.length - 1);
      const a = { ...groups[idx], paths: src.slice(0, cut) };
      const b = { ...groups[idx], role: groups[idx].role + '-b', label: groups[idx].label + ' (cont.)', paths: src.slice(cut) };
      groups.splice(idx, 1, a, b);
    }
  }

  return groups.map((g, i) => ({
    groupId: `G${i + 1}`,
    role: g.role,
    label: g.label,
    paths: g.paths,
    pathCount: g.paths.length,
    groupDigest: sha256(g.paths.join('\n')),
  }));
}

// ── subject ────────────────────────────────────────────────────────────────
function subjectOf(args) {
  const a = [ENGOS, '--subject', '--json'];
  if (args.base) a.push('--base', args.base);
  if (args.head) a.push('--head', args.head);
  const r = spawnSync('node', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`could not compute subject: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout);
}

function groupBytes(g, args) {
  const a = ['diff'];
  if (args.base) a.push(`${args.base}..${args.head || 'HEAD'}`);
  else a.push(args.head || 'HEAD');
  a.push('--', ...g.paths);
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.length : 0;
}

function pathSizes(subject, args) {
  const sizes = {};
  for (const p of subject.subjectPaths) sizes[p] = groupBytes({ paths: [p] }, args);
  return sizes;
}

function cmdPlan(args) {
  const subject = subjectOf(args);
  const target = Number(args.groups) > 0 ? Number(args.groups) : DEFAULT_GROUPS;
  const groups = planGroups(subject.subjectPaths, target, pathSizes(subject, args));

  // Coverage is asserted on the PLAN too, not only on the evidence. A planner
  // that could emit an incomplete plan would produce group records that can
  // never aggregate, and the failure would surface hours later.
  const cov = checkCoverage(groups, subject.subjectPaths);
  if (!cov.ok) throw new Error(`the plan does not cover the subject: ${cov.reason}`);

  const out = {
    subjectSha256: subject.subjectSha256,
    subjectPathCount: subject.subjectPaths.length,
    groupCount: groups.length,
    groups: groups.map((g) => ({ ...g, diffBytes: groupBytes(g, args) })),
  };
  if (args.json) { console.log(JSON.stringify(out, null, 2)); return EXIT_PASS; }

  console.log('AEGIS — CHUNKED REVIEW PLAN');
  console.log('='.repeat(64));
  console.log(`subject : ${out.subjectSha256}`);
  console.log(`paths   : ${out.subjectPathCount} across ${out.groupCount} group(s)`);
  console.log('');
  for (const g of out.groups) {
    console.log(`${g.groupId}  ${g.label}`);
    console.log(`    ${g.pathCount} path(s), ${g.diffBytes} diff bytes`);
    for (const p of g.paths) console.log(`      ${p}`);
    console.log('');
  }
  console.log('Coverage: exact — every subject path appears in exactly one group.');
  return EXIT_PASS;
}

// ── coverage: the whole point ───────────────────────────────────────────────
function checkCoverage(groups, subjectPaths) {
  const subject = new Set(subjectPaths);
  const seen = new Map();
  const foreign = [];
  const overlap = [];

  for (const g of groups) {
    for (const p of g.paths) {
      if (!subject.has(p)) { foreign.push({ path: p, groupId: g.groupId }); continue; }
      if (seen.has(p)) overlap.push({ path: p, groups: [seen.get(p), g.groupId] });
      else seen.set(p, g.groupId);
    }
  }
  const missing = [...subject].filter((p) => !seen.has(p));

  if (missing.length) {
    return { ok: false, code: 'COVERAGE-GAP', reason: `${missing.length} subject path(s) are in no group: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}` };
  }
  if (overlap.length) {
    return { ok: false, code: 'COVERAGE-OVERLAP', reason: `${overlap.length} path(s) appear in more than one group (${overlap.slice(0, 3).map((o) => `${o.path} in ${o.groups.join(' and ')}`).join('; ')}). Overlap lets two reviewers disagree about the same code without the disagreement being visible.` };
  }
  if (foreign.length) {
    return { ok: false, code: 'COVERAGE-FOREIGN', reason: `${foreign.length} path(s) are reviewed but not in the subject: ${foreign.slice(0, 5).map((f) => `${f.path} (${f.groupId})`).join(', ')}` };
  }
  return { ok: true, covered: seen.size };
}

// ── lane isolation ──────────────────────────────────────────────────────────
// A group record belongs to a lane (one groupId, one reviewer, one subject)
// only when ALL THREE match exactly. A record missing a field — a legacy or
// malformed record — does not "probably" match; it simply fails the check.
// This is what stops a Codex G1 rerun from archiving Grok's G1, or a G1 left
// over from a different subject: those are different lanes, not the same one
// with fewer facts.
function matchesLane(rec, lane) {
  if (!rec) return false;
  if (lane.groupId != null && (!rec.group || rec.group.groupId !== lane.groupId)) return false;
  if (lane.reviewer != null && rec.reviewer !== lane.reviewer) return false;
  if (lane.subjectSha != null && (!rec.reviewOf || rec.reviewOf.diffSha256 !== lane.subjectSha)) return false;
  return true;
}

// Splits an already-verified record list into the requested reviewer's lane
// for the current subject, plus what was excluded and why. Pure — no fs, no
// signing — so the aggregation policy can be proven without writing evidence
// to disk. `reviewer: null` means "no lane filter", matching the pre-existing
// mixed-reviewer detection behaviour when --reviewer is not supplied.
function selectAggregationLane(records, { subjectSha, reviewer }) {
  const usable = [];
  const excludedSubject = [];
  const excludedReviewer = [];
  for (const rec of records) {
    if (!rec.reviewOf || rec.reviewOf.diffSha256 !== subjectSha) { excludedSubject.push(rec); continue; }
    if (reviewer && rec.reviewer !== reviewer) { excludedReviewer.push(rec); continue; }
    usable.push(rec);
  }
  return { usable, excludedSubject, excludedReviewer };
}

// ── per-group review ────────────────────────────────────────────────────────
function cmdRun(args) {
  if (!args.packet) return usage('--packet is required');
  const subject = subjectOf(args);
  const groups = planGroups(subject.subjectPaths, Number(args.groups) > 0 ? Number(args.groups) : DEFAULT_GROUPS, pathSizes(subject, args));
  const wanted = args.group
    ? groups.filter((g) => g.groupId === args.group)
    : groups;
  if (args.group && !wanted.length) return usage(`unknown group ${args.group}`);

  fs.mkdirSync(GROUPS_DIR, { recursive: true });
  // GROK G9 FINDING #2: the documented recovery — "re-run that group, then
  // --aggregate" — could not work. A new record was written alongside the old
  // one, leaving two records for the same groupId. Aggregation then saw either
  // a duplicate or the stale verdict, so a fixed group could never actually
  // clear. A re-run REPLACES its predecessor: the superseded record is archived
  // rather than deleted, because discarding evidence to make a gate pass is the
  // thing this system exists to prevent.
  //
  // "predecessor" means the SAME groupId, the SAME reviewer, and the SAME
  // subject — matched by reading each candidate's content, not by filename
  // suffix. A filename-suffix match (old behaviour) archived any file ending
  // in "-G1.json", which could not tell Codex's G1 from Grok's G1, nor this
  // subject's G1 from a G1 left over from a previous one.
  const reviewerLane = args.reviewer || 'codex';
  for (const g of wanted) {
    const candidates = fs.readdirSync(GROUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'));
    const stale = [];
    for (const d of candidates) {
      let rec;
      try { rec = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, d.name), 'utf8')); }
      catch { continue; } // unreadable — ambiguous, left in place rather than guessed at
      if (matchesLane(rec, { groupId: g.groupId, reviewer: reviewerLane, subjectSha: subject.subjectSha256 })) {
        stale.push(d.name);
      }
    }
    if (stale.length) {
      const attic = path.join(GROUPS_DIR, 'superseded');
      fs.mkdirSync(attic, { recursive: true });
      for (const f of stale) {
        fs.renameSync(path.join(GROUPS_DIR, f), path.join(attic, f));
        console.log(`[review-chunker] archived superseded record for ${reviewerLane} ${g.groupId}: ${f}`);
      }
    }
  }
  let worst = 0;
  for (const g of wanted) {
    console.log(`\n── ${g.groupId}  ${g.label}  (${g.pathCount} path(s)) ──`);
    const rc = runGroup(g, subject, args);
    worst = Math.max(worst, rc);
  }
  return worst;
}

// One bounded reviewer call for one group. The adapter does the signing; this
// only narrows what it is pointed at, and records which group it was.
// Exported so a red proof can assert the metered flags are actually forwarded,
// rather than trusting that they are.
function buildGroupArgv(group, subject, args) {
  const a = [ADAPTERS, '--run',
    '--reviewer', args.reviewer || 'codex',
    '--packet', args.packet,
    '--timeout', String(args.timeout || 420)];
  if (args.base) a.push('--base', args.base);
  if (args.head) a.push('--head', args.head);
  if (args.allowMetered) a.push('--allow-metered');
  if (args.approvedBy) a.push('--approved-by', args.approvedBy);
  if (args.capUsd) a.push('--cap-usd', String(args.capUsd));
  if (args.dataClass) a.push('--data-class', args.dataClass);
  for (const p of group.paths) a.push('--only-path', p);
  a.push('--group-id', group.groupId, '--group-digest', group.groupDigest,
         '--subject-sha', subject.subjectSha256);
  return a;
}

function runGroup(group, subject, args) {
  // Uses buildGroupArgv — the SAME function the red proofs assert against. A
  // second copy of this argument list would let the tested path and the
  // executed path drift apart, which is precisely how maxTurns came to be
  // "declared 1, enforced never".
  const a = buildGroupArgv(group, subject, args);
  const r = spawnSync('node', a, {
    cwd: ROOT, encoding: 'utf8', stdio: 'inherit',
    timeout: (Number(args.timeout || 420) + 120) * 1000,
  });
  return r.status === null ? EXIT_REFUSED : r.status;
}

// ── aggregation ─────────────────────────────────────────────────────────────
function loadGroupRecords() {
  if (!fs.existsSync(GROUPS_DIR)) return [];
  return fs.readdirSync(GROUPS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json'))
    .map((d) => d.name)
    .sort()
    .map((f) => {
      const p = path.join(GROUPS_DIR, f);
      try { return { path: p, rec: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
      catch (e) { return { path: p, rec: null, error: e.message }; }
    });
}

function aggregate(args) {
  const subject = subjectOf(args);
  const plan = planGroups(subject.subjectPaths, Number(args.groups) > 0 ? Number(args.groups) : DEFAULT_GROUPS, pathSizes(subject, args));
  const loaded = loadGroupRecords();
  const problems = [];

  // GROK G11 FINDING #3: a leftover group record bound to a different subject
  // pushed GROUP-STALE-SUBJECT into `problems`, and `ok` requires problems to be
  // empty — so a stale file from a previous subject permanently blocked every
  // future aggregate. Evidence about a DIFFERENT subject is not a problem with
  // THIS one; it is simply not about it.
  //
  // Stale records are moved to an archive directory rather than deleted. The
  // audit trail keeps them; the aggregation stops tripping over them.
  const staleArchive = path.join(GROUPS_DIR, 'other-subjects');
  const setAside = [];
  for (const l of loaded) {
    if (!l.rec) continue;
    const sha = l.rec.reviewOf && l.rec.reviewOf.diffSha256;
    if (sha && sha !== subject.subjectSha256) {
      try {
        fs.mkdirSync(staleArchive, { recursive: true });
        fs.renameSync(l.path, path.join(staleArchive, path.basename(l.path)));
        setAside.push({ file: path.basename(l.path), boundTo: sha.slice(0, 12) });
      } catch { /* leave it; the loop below still ignores it */ }
      l.stale = true;
    }
  }

  const wantedReviewer = args.reviewer || null;
  const verified = [];
  for (const l of loaded) {
    if (l.stale) continue;
    if (!l.rec) { problems.push({ code: 'GROUP-UNREADABLE', detail: `${path.basename(l.path)}: ${l.error}` }); continue; }
    // Every group record must be signed and verify. An unsigned group is not a
    // smaller piece of evidence — it is no evidence.
    const v = require('./review-sign.cjs').verify(l.rec, { packetPath: args.packet });
    if (!v.ok) { problems.push({ code: 'GROUP-UNSIGNED', detail: `${path.basename(l.path)}: ${v.code} — ${v.reason}` }); continue; }
    verified.push(l.rec);
  }

  // --aggregate --reviewer X loads only that reviewer's lane for this subject.
  // A record bound to another reviewer is not mixed in and not a problem — it
  // simply was never asked for. Records bound to another subject are excluded
  // the same way (normally already archived above; this is the fallback for
  // when archiving could not happen).
  const lane = selectAggregationLane(verified, { subjectSha: subject.subjectSha256, reviewer: wantedReviewer });
  const usable = lane.usable;

  // One reviewer, one model, across every group. Mixing them produces an
  // aggregate nobody can attribute — "Codex approved it" would be true of some
  // groups and false of others.
  const reviewers = [...new Set(usable.map((r) => r.reviewer))];
  const models = [...new Set(usable.map((r) => r.reviewerModel))];
  if (reviewers.length > 1) problems.push({ code: 'GROUP-MIXED-REVIEWER', detail: `groups were reviewed by different reviewers: ${reviewers.join(', ')}` });
  if (models.length > 1) problems.push({ code: 'GROUP-MIXED-MODEL', detail: `groups were reviewed by different models: ${models.join(', ')}` });

  const unavailable = usable.filter((r) => r.disposition === 'UNAVAILABLE');
  if (unavailable.length) {
    problems.push({ code: 'GROUP-UNAVAILABLE', detail: `${unavailable.length} group(s) could not be reviewed: ${unavailable.map((r) => (r.group && r.group.groupId) || r.reviewId).join(', ')}. A timeout on one group leaves that code unreviewed; the aggregate cannot cover for it.` });
  }

  const cov = checkCoverage(
    usable.map((r) => ({ groupId: (r.group && r.group.groupId) || r.reviewId, paths: (r.reviewOf && r.reviewOf.changedPaths) || [] })),
    subject.subjectPaths
  );
  if (!cov.ok) problems.push({ code: cov.code, detail: cov.reason });

  const blocking = problems.filter((p) => !p.informational);
  const ok = blocking.length === 0 && usable.length > 0;
  if (setAside.length) {
    // Reported, never hidden — an operator must be able to see what was moved.
    problems.push({ code: 'GROUPS-ARCHIVED-OTHER-SUBJECT', detail: `${setAside.length} group record(s) bound to a different subject were archived to groups/other-subjects/ (${setAside.map((x) => `${x.file}@${x.boundTo}`).join(', ')}). They neither approve nor block this subject.`, informational: true });
  }
  if (wantedReviewer && lane.excludedReviewer.length) {
    const others = [...new Set(lane.excludedReviewer.map((r) => r.reviewer))];
    problems.push({ code: 'GROUPS-EXCLUDED-OTHER-REVIEWER', detail: `${lane.excludedReviewer.length} group record(s) reviewed by ${others.join(', ')} were excluded from the ${wantedReviewer} aggregation lane for this subject. They neither approve nor block it.`, informational: true });
  }
  const findings = usable.flatMap((r) => r.findings || []);
  const disposition = !ok ? 'UNAVAILABLE'
    : usable.some((r) => r.disposition === 'REJECT') ? 'REJECT'
    : usable.some((r) => r.disposition === 'APPROVE_WITH_NOTES') ? 'APPROVE_WITH_NOTES'
    : 'APPROVE';

  return { ok, problems, usable, plan, subject, disposition, findings, cov };
}

function cmdAggregate(args) {
  if (!args.packet) return usage('--packet is required');
  const a = aggregate(args);
  const ts = new Date().toISOString();

  const record = {
    reviewId: `REV-${ts.replace(/[^0-9]/g, '').slice(0, 14)}-aggregate`,
    ts,
    reviewer: a.usable.length ? a.usable[0].reviewer : (args.reviewer || 'codex'),
    reviewerModel: a.usable.length ? a.usable[0].reviewerModel : 'unknown',
    packetId: (() => { try { return JSON.parse(fs.readFileSync(args.packet, 'utf8')).packetId; } catch { return 'unknown'; } })(),
    reviewOf: { diffSha256: a.subject.subjectSha256, changedPaths: a.subject.subjectPaths.slice() },
    disposition: a.disposition,
    findings: a.ok ? a.findings : [],
    aggregate: {
      groupCount: a.usable.length,
      plannedGroupCount: a.plan.length,
      // Each group's own attestation digest is embedded. Editing a group record
      // after aggregation changes its digest and this aggregate stops matching,
      // so an aggregate cannot outlive the evidence it was built from.
      groups: a.usable.map((r) => ({
        groupId: (r.group && r.group.groupId) || null,
        groupDigest: (r.group && r.group.groupDigest) || null,
        pathCount: ((r.reviewOf && r.reviewOf.changedPaths) || []).length,
        disposition: r.disposition,
        reviewId: r.reviewId,
        attestationDigest: (r.attestation && r.attestation.payloadDigest) || null,
      })),
      coverage: a.cov.ok ? 'EXACT' : a.cov.code,
      problems: a.problems,
    },
  };
  if (!a.ok) {
    record.unavailableReason = `chunked review did not produce consumable evidence: ${a.problems.map((p) => p.code).join(', ')}`;
  }

  fs.mkdirSync(REVIEWS_DIR, { recursive: true });

  // GROK G11 FINDING #2: archiving superseded GROUP records did not help,
  // because the record the gate actually reads is the top-level aggregate — and
  // cmdAggregate always wrote a NEW one beside the old. Two aggregates for one
  // reviewer on one subject is exactly the ambiguity the gate refuses, so a
  // re-run could never clear. The new aggregate now supersedes its predecessors
  // explicitly AND they are archived, so the gate sees exactly one authority
  // while the audit trail keeps every version.
  const priorAggregates = fs.readdirSync(REVIEWS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('-aggregate.json'))
    .map((d) => d.name).sort();
  let supersedesId = null;
  if (priorAggregates.length) {
    const attic = path.join(REVIEWS_DIR, 'superseded-aggregates');
    fs.mkdirSync(attic, { recursive: true });
    for (const f of priorAggregates) {
      const full = path.join(REVIEWS_DIR, f);
      try {
        const prior = JSON.parse(fs.readFileSync(full, 'utf8'));
        // Name the most recent predecessor, so supersession is an explicit,
        // signed claim rather than an inference from file order.
        if (prior.reviewId) supersedesId = prior.reviewId;
      } catch { /* unreadable predecessor still gets archived */ }
      fs.renameSync(full, path.join(attic, f));
      console.log(`[review-chunker] superseded prior aggregate: ${f}`);
    }
  }
  if (supersedesId) record.supersedes = supersedesId;

  const signed = require('./review-sign.cjs').sign(record, { packetPath: args.packet });
  const outPath = path.join(REVIEWS_DIR, `${ts.replace(/[^0-9]/g, '').slice(0, 14)}-aggregate.json`);
  fs.writeFileSync(outPath, JSON.stringify(signed, null, 2) + '\n', 'utf8');

  if (args.json) { console.log(JSON.stringify(signed, null, 2)); return a.ok ? EXIT_PASS : EXIT_REFUSED; }

  console.log('AEGIS — AGGREGATE REVIEW VERDICT');
  console.log('='.repeat(64));
  console.log(`subject     : ${a.subject.subjectSha256.slice(0, 16)}…`);
  console.log(`groups      : ${a.usable.length} usable of ${a.plan.length} planned`);
  console.log(`coverage    : ${a.cov.ok ? 'EXACT' : a.cov.code}`);
  console.log(`disposition : ${a.disposition}`);
  console.log(`findings    : ${record.findings.length}`);
  console.log(`record      : ${path.relative(ROOT, outPath)}  (signed)`);
  if (a.problems.length) {
    console.log('');
    console.log('NOT CONSUMABLE:');
    for (const p of a.problems) { console.log(`  ${p.code}`); console.log(`    ${p.detail}`); }
    console.log('');
    console.log('The aggregate is written as UNAVAILABLE so the failure is recorded');
    console.log('evidence rather than an absence. It will block the gate.');
  }
  return a.ok ? EXIT_PASS : EXIT_REFUSED;
}

function usage(msg) {
  if (msg) process.stderr.write(`\n[review-chunker] ${msg}\n`);
  process.stderr.write(`
review-chunker.cjs — chunked review for subjects too large for one call

  --plan [--groups N] [--base <ref>] [--head <ref>] [--json]
  --run --group <G1..Gn> --packet <p> [--reviewer codex|grok] [--timeout <s>]
        [--allow-metered --approved-by "<name>" --cap-usd <n>] [--data-class <c>]
  --run-all --packet <p> [--reviewer codex|grok] [--timeout <s>]
        [--allow-metered --approved-by "<name>" --cap-usd <n>] [--data-class <c>]

A METERED reviewer (grok) needs all three of --allow-metered, --approved-by and
--cap-usd. Without them the adapter refuses — deliberately, and before spending.
  --aggregate --packet <p> [--json]

An aggregate is consumable only on EXACT coverage with every group signed.
`);
  return EXIT_USAGE;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--plan') a.plan = true;
    else if (t === '--run') a.run = true;
    else if (t === '--run-all') { a.run = true; a.all = true; }
    else if (t === '--aggregate') a.aggregate = true;
    else if (t === '--group') a.group = argv[++i];
    else if (t === '--groups') a.groups = argv[++i];
    else if (t === '--packet') a.packet = argv[++i];
    else if (t === '--reviewer') a.reviewer = argv[++i];
    else if (t === '--timeout') a.timeout = argv[++i];
    else if (t === '--base') a.base = argv[++i];
    else if (t === '--head') a.head = argv[++i];
    else if (t === '--json') a.json = true;
    else if (t === '--allow-metered') a.allowMetered = true;
    else if (t === '--approved-by') a.approvedBy = argv[++i];
    else if (t === '--cap-usd') a.capUsd = argv[++i];
    else if (t === '--data-class') a.dataClass = argv[++i];
  }
  return a;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let code;
  try {
    if (args.plan) code = cmdPlan(args);
    else if (args.run) code = cmdRun(args);
    else if (args.aggregate) code = cmdAggregate(args);
    else code = usage();
  } catch (e) {
    process.stderr.write(`\n[review-chunker] ${e.message}\n`);
    code = EXIT_REFUSED;
  }
  process.exit(code);
}

module.exports = { planGroups, checkCoverage, aggregate, buildGroupArgv, roleOf, ROLES, DEFAULT_GROUPS, MAX_GROUP_BYTES, matchesLane, selectAggregationLane };
