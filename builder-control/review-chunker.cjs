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
 *   node builder-control/review-chunker.cjs --run-all --groups <n> --packet <p> [--timeout <s>]
 *   node builder-control/review-chunker.cjs --aggregate --groups <n> --reviewer <r> --packet <p> [--json]
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
// Grok review groups for the operator beta produced multi-megabyte traces and
// completed between roughly five and ten minutes. A shorter default turned
// healthy in-flight reviews into signed UNAVAILABLE records. Callers may still
// choose a tighter explicit bound for focused tests, but ordinary reviews get
// the proven completion window.
const DEFAULT_REVIEW_TIMEOUT_SEC = 600;
const RUN_ID_RE = /^RUN-\d{8}-[0-9a-f]{8}$/;

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
// Changed bytes remain capped by the reviewer-work evidence above. The total
// payload has a separate ceiling matching the Codex exact-file bundle, because
// every group also carries pinned specifications and deterministic-check proof.
//
// 2026-09-02 — raised 60000 → 70000. The dashboard subject carries one
// INDIVISIBLE 63,232-byte file (builder-control/test/dashboard-slice.test.cjs).
// A single file cannot be split, so a 60,000 changed-byte ceiling did not make
// that subject smaller — it refused to plan it at all, which is not a safety
// outcome, it is a review that never happens. The same subject's largest group
// payload was 715,666 bytes, well under MAX_GROUP_PAYLOAD_BYTES, so nothing
// about the reviewer's actual context load was near a limit.
//
// WHY THE PAYLOAD CAP REMAINS THE SAFETY AUTHORITY
// MAX_GROUP_BYTES is a PLANNING heuristic over changed bytes only — it is a
// proxy for reviewer work, and it does not know what a group actually costs to
// send. MAX_GROUP_PAYLOAD_BYTES is the real ceiling: it counts changed bytes
// PLUS the pinned specifications and deterministic-check proof every group
// carries, and it is matched to the Codex exact-file bundle the reviewer must
// actually receive. Raising the planning proxy therefore cannot make an
// unsendable group sendable — the payload cap is unchanged at 1,310,720 bytes
// and still refuses independently, and the named unsplittable refusal still
// fires for a file genuinely too large under either ceiling.
//
// 70000 is deliberately the smallest round value that admits this bounded
// subject. It stays far below the 101KB that actually exhausted a reviewer's
// turn budget, and above the 46KB that completed in 14 turns.
const MAX_GROUP_BYTES = 70000;
const MAX_GROUP_PAYLOAD_BYTES = 1280 * 1024;
const FIXED_CHECK_OVERHEAD_BYTES = 32 * 1024;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function planningRefusal(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, details);
  return error;
}

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
function planGroups(subjectPaths, target = DEFAULT_GROUPS, sizes = null, planOptions = {}) {
  const paths = [...new Set(subjectPaths)].sort();
  if (!paths.length) return [];
  const options = planOptions && typeof planOptions === 'object' ? planOptions : {};
  const fixedOverheadBytes = Number.isInteger(options.fixedOverheadBytes) && options.fixedOverheadBytes >= 0
    ? options.fixedOverheadBytes : 0;
  if (fixedOverheadBytes > MAX_GROUP_PAYLOAD_BYTES) {
    throw planningRefusal('REVIEW_GROUP_FIXED_OVERHEAD_OVERSIZE',
      `pinned-spec/check overhead ${fixedOverheadBytes} exceeds payload budget ${MAX_GROUP_PAYLOAD_BYTES}`,
      { fixedOverheadBytes, maxPayloadBytes: MAX_GROUP_PAYLOAD_BYTES });
  }

  const byRole = new Map();
  for (const p of paths) {
    const r = roleOf(p);
    if (!byRole.has(r)) byRole.set(r, []);
    byRole.get(r).push(p);
  }

  const weight = (g) => (sizes
    ? g.paths.reduce((n, p) => n + (sizes[p] || 0), 0)
    : g.paths.length);
  const payloadWeight = (g) => fixedOverheadBytes + weight(g);
  const oversize = (g) => sizes &&
    (weight(g) > MAX_GROUP_BYTES || payloadWeight(g) > MAX_GROUP_PAYLOAD_BYTES);

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

  // Oversize split — runs AFTER merge/split-to-target. MAX_GROUP_BYTES is the
  // observed safe reviewer-work budget, so an explicit --groups value is a
  // deterministic minimum/hint, never authority to merge unsafe work back
  // together. Without sizes this is a no-op, which is correct: an unknown size
  // must not be guessed at.
  if (sizes) {
    let guard = 0;
    for (;;) {
      if (++guard > 64) break;                      // structural stop, not a policy
      let idx = -1;
      for (let i = 0; i < groups.length; i++) {
        if (!oversize(groups[i])) continue;
        if (groups[i].paths.length < 2) {
          const onlyPath = groups[i].paths[0];
          throw planningRefusal('REVIEW_GROUP_UNSPLITTABLE_OVERSIZE',
            `${onlyPath} requires ${weight(groups[i])} changed byte(s) and ${payloadWeight(groups[i])} total review byte(s), exceeding the ${MAX_GROUP_BYTES} changed-byte or ${MAX_GROUP_PAYLOAD_BYTES} payload ceiling`,
            { path: onlyPath, changedBytes: weight(groups[i]), totalBytes: payloadWeight(groups[i]),
              fixedOverheadBytes, maxChangedBytes: MAX_GROUP_BYTES,
              maxPayloadBytes: MAX_GROUP_PAYLOAD_BYTES });
        }
        idx = i; break;
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
    changedBytes: sizes ? weight(g) : null,
    fixedOverheadBytes: sizes ? fixedOverheadBytes : null,
    estimatedReviewBytes: sizes ? payloadWeight(g) : null,
  }));
}

// ── subject ────────────────────────────────────────────────────────────────
function normalizeRunId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !RUN_ID_RE.test(value)) {
    throw new Error(`${JSON.stringify(value)} is not a canonical RUN-YYYYMMDD-xxxxxxxx id`);
  }
  return value;
}

// Resolve the same run/worktree authority the adapter consumes. The legacy
// no-run-id path remains available because the adapter itself then resolves an
// exact packet+subject check receipt and refuses if more than one run matches;
// it is not a guess or a "latest run" fallback.
function resolveRunContext(args, authority = null) {
  const runId = normalizeRunId(args && args.runId);
  let packetPath = null;
  if (args && args.packet) {
    try { packetPath = fs.realpathSync(path.resolve(args.packet)); }
    catch (error) { throw new Error(`cannot resolve --packet: ${error.message}`); }
  }
  if (!runId) {
    if (packetPath) {
      const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
      if (Array.isArray(packet.hostContainmentRequired) && packet.hostContainmentRequired.length) {
        throw new Error('beta/dashboard chunked review requires a canonical --run-id coordinate');
      }
    }
    return Object.freeze({ runId: null, run: null, sourceRoot: fs.realpathSync(ROOT),
      packetPath, gitEnv: null });
  }
  if (!packetPath) throw new Error('--packet is required with --run-id');

  const runAuthority = authority || require('./aegis-run.cjs');
  if (typeof runAuthority.loadRun !== 'function'
      || typeof runAuthority.canonicalGitEnvironment !== 'function') {
    throw new Error('canonical AEGIS run/worktree authority is unavailable');
  }
  const run = runAuthority.loadRun(runId);
  if (!run || run.runId !== runId) {
    throw new Error(`canonical run authority did not return exactly ${runId}`);
  }
  if (typeof run.packet !== 'string' || !run.packet.trim()) {
    throw new Error(`run ${runId} has no canonical packet coordinate`);
  }
  let recordedPacket;
  try { recordedPacket = fs.realpathSync(path.resolve(ROOT, run.packet)); }
  catch (error) { throw new Error(`run ${runId} packet is unreadable: ${error.message}`); }
  if (packetPath !== recordedPacket) {
    throw new Error(`--packet does not match run ${runId}'s canonical packet`);
  }

  const gitEnv = runAuthority.canonicalGitEnvironment(run);
  let sourceRoot;
  let envWorktree;
  try {
    sourceRoot = fs.realpathSync(path.resolve(run.worktree && run.worktree.path || ''));
    envWorktree = fs.realpathSync(gitEnv && gitEnv.GIT_WORK_TREE);
  } catch {
    throw new Error(`run ${runId} did not produce a readable canonical Git worktree`);
  }
  if (sourceRoot !== envWorktree || sourceRoot === fs.realpathSync(ROOT)) {
    throw new Error(`run ${runId} did not resolve to one isolated canonical worktree`);
  }
  return Object.freeze({ runId, run: Object.freeze(run), sourceRoot, packetPath,
    gitEnv: Object.freeze({ ...gitEnv, GIT_WORK_TREE: sourceRoot }) });
}

function buildSubjectInvocation(args, context) {
  const a = [ENGOS, '--subject', '--json'];
  if (context.packetPath) a.push('--packet', context.packetPath);
  if (args.base) a.push('--base', args.base);
  if (args.head) a.push('--head', args.head);
  return Object.freeze({ argv: Object.freeze(a), cwd: ROOT,
    env: context.gitEnv || process.env });
}

function subjectOf(args, context = resolveRunContext(args)) {
  const invocation = buildSubjectInvocation(args, context);
  const r = spawnSync('node', invocation.argv, {
    cwd: invocation.cwd, env: invocation.env,
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`could not compute subject: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout);
}

function groupBytes(g, args, context = resolveRunContext(args)) {
  const a = ['diff'];
  if (args.base) a.push(`${args.base}..${args.head || 'HEAD'}`);
  else a.push(args.head || 'HEAD');
  a.push('--', ...g.paths);
  const r = spawnSync('git', a, {
    cwd: ROOT, env: context.gitEnv || process.env,
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw planningRefusal('REVIEW_GROUP_DIFF_UNAVAILABLE',
      `git diff failed while sizing ${g.paths.join(', ')}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return Buffer.byteLength(r.stdout || '', 'utf8');
}

function pathSizes(subject, args, context = resolveRunContext(args)) {
  const sizes = {};
  const untracked = new Set(Array.isArray(subject.untrackedSubjectPaths)
    ? subject.untrackedSubjectPaths : []);
  const sourceRoot = fs.realpathSync(context.sourceRoot || ROOT);
  for (const p of subject.subjectPaths) {
    if (!untracked.has(p)) {
      sizes[p] = groupBytes({ paths: [p] }, args, context);
      continue;
    }
    const candidate = path.resolve(sourceRoot, p);
    if (!candidate.startsWith(sourceRoot + path.sep)) {
      throw planningRefusal('REVIEW_GROUP_UNTRACKED_PATH_ESCAPE', `${p} escapes the canonical source root`);
    }
    let stat;
    try { stat = fs.lstatSync(candidate); }
    catch (error) {
      throw planningRefusal('REVIEW_GROUP_UNTRACKED_UNREADABLE', `${p} cannot be sized: ${error.message}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw planningRefusal('REVIEW_GROUP_UNTRACKED_NOT_FILE', `${p} is not a regular canonical untracked file`);
    }
    sizes[p] = stat.size;
  }
  return sizes;
}

function fixedReviewOverheadBytes(args = {}, context = null) {
  const packetPath = (context && context.packetPath) || (args.packet && fs.realpathSync(path.resolve(args.packet)));
  if (!packetPath) return FIXED_CHECK_OVERHEAD_BYTES;
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const sourceRoot = fs.realpathSync(context && context.sourceRoot || ROOT);
  let pinnedSpecBytes = 0;
  for (const rel of [...new Set(Array.isArray(packet.sourceOfTruth) ? packet.sourceOfTruth : [])].sort()) {
    const candidate = path.resolve(sourceRoot, rel);
    if (!candidate.startsWith(sourceRoot + path.sep)) {
      throw planningRefusal('REVIEW_GROUP_PINNED_SPEC_ESCAPE', `${rel} escapes the canonical source root`);
    }
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw planningRefusal('REVIEW_GROUP_PINNED_SPEC_NOT_FILE', `${rel} is not a regular pinned specification`);
    }
    pinnedSpecBytes += stat.size;
  }
  return pinnedSpecBytes + FIXED_CHECK_OVERHEAD_BYTES;
}

// One canonical planner for every executable path and for the release-path
// capacity proof. Calling planGroups directly without the per-path diff sizes
// is a valid pure-unit fallback, but it is not the plan that --plan, --run, and
// --aggregate execute. Keeping target parsing and size collection here prevents
// a test from certifying a count-only approximation while release uses a
// different byte-aware plan.
function planSubjectGroups(subject, args = {}, measuredSizes = null, context = null) {
  if (!subject || !Array.isArray(subject.subjectPaths) || !subject.subjectPaths.length) {
    throw new Error('cannot plan a review without a non-empty canonical subject path list');
  }
  const target = Number(args.groups) > 0 ? Number(args.groups) : DEFAULT_GROUPS;
  const runId = normalizeRunId(args.runId);
  const resolvedContext = context || resolveRunContext(args);
  const sizes = measuredSizes || pathSizes(subject, args, resolvedContext);
  const overhead = fixedReviewOverheadBytes(args, resolvedContext);
  const groups = planGroups(subject.subjectPaths, target, sizes,
    { fixedOverheadBytes: overhead });
  if (!runId) return groups;
  // There is no unsigned runId field in a group record. Bind the coordinate in
  // the signed groupDigest instead: a group from another run with identical
  // paths can no longer satisfy this plan's checkPlanBinding().
  return groups.map((group) => ({ ...group,
    groupDigest: sha256(`${runId}\0${group.paths.join('\n')}`),
  }));
}

function cmdPlan(args) {
  const context = resolveRunContext(args);
  const subject = subjectOf(args, context);
  const groups = planSubjectGroups(subject, args, null, context);

  // Coverage is asserted on the PLAN too, not only on the evidence. A planner
  // that could emit an incomplete plan would produce group records that can
  // never aggregate, and the failure would surface hours later.
  const cov = checkCoverage(groups, subject.subjectPaths);
  if (!cov.ok) throw new Error(`the plan does not cover the subject: ${cov.reason}`);

  const out = {
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.packetPath ? { packet: path.relative(ROOT, context.packetPath) } : {}),
    subjectSha256: subject.subjectSha256,
    subjectPathCount: subject.subjectPaths.length,
    groupCount: groups.length,
    groups: groups.map((g) => ({ ...g, diffBytes: g.changedBytes })),
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

// A reviewer rerun may overlap another reviewer's publication. Directory
// creation time alone cannot establish ownership: both records are "new" to
// the caller's snapshot. Partition by the immutable lane coordinates before
// verification or quarantine so Codex can never move Grok's record (or vice
// versa). An unreadable record is foreign/ambiguous and remains active for the
// aggregate to fail closed on; it is never guessed into this invocation.
function partitionCreatedLaneRecords({ groupsDir, names, lane }) {
  const owned = [];
  const foreign = [];
  for (const name of names || []) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(groupsDir, name), 'utf8')); }
    catch { foreign.push(name); continue; }
    (matchesLane(rec, lane) ? owned : foreign).push(name);
  }
  return { owned: owned.sort(), foreign: foreign.sort() };
}

function quarantineCreatedLaneRecords({ groupsDir, names }) {
  if (!(names || []).length) return [];
  const failed = path.join(groupsDir, 'failed-reruns');
  fs.mkdirSync(failed, { recursive: true });
  const moved = [];
  for (const name of names) {
    fs.renameSync(path.join(groupsDir, name), path.join(failed, name));
    moved.push(name);
  }
  fsyncDirectory(failed);
  fsyncDirectory(groupsDir);
  return moved;
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

// A run-all invocation is also the recovery command after a partial transport
// failure. Repeating a paid, already-complete review on the same exact subject
// is waste: retain one valid signed substantive verdict and run only lanes that
// are missing, ambiguous, invalid, or explicitly UNAVAILABLE. A targeted
// --run --group remains the operator's deliberate replacement mechanism.
function reusableCompletedGroupRecord(records, lane, verifyRecord) {
  const matching = records.filter((rec) => matchesLane(rec, lane));
  if (matching.length !== 1) return null;
  const candidate = matching[0];
  if (candidate.disposition === 'UNAVAILABLE') return null;
  let verified;
  try { verified = verifyRecord(candidate); } catch { return null; }
  return verified && verified.ok === true && verified.gateable === true
    ? candidate : null;
}

// Aggregate replacement is scoped just as narrowly as group replacement. An
// aggregate from another required reviewer is independent evidence, not a
// predecessor. Archiving it would make a two-reviewer FULL gate impossible:
// whichever aggregate was written second would erase the first reviewer.
//
// Unreadable and legacy records deliberately do not match. Guessing that a
// malformed record belongs to this lane would let publication hide evidence it
// cannot attribute; leaving it top-level makes the canonical gate fail closed.
function matchesAggregateLane(rec, { reviewer, subjectSha }) {
  return Boolean(rec && rec.aggregate && rec.reviewer === reviewer &&
    rec.reviewOf && rec.reviewOf.diffSha256 === subjectSha);
}

function selectAggregateRetention(records, lane) {
  const superseded = [];
  const preserved = [];
  for (const item of records) {
    if (matchesAggregateLane(item && item.rec, lane)) superseded.push(item);
    else preserved.push(item);
  }
  return { superseded, preserved };
}

function checkPlanBinding(records, plan) {
  const problems = [];
  const expected = new Map((plan || []).map((group) => [group.groupId, group]));
  const seen = new Set();
  for (const record of records || []) {
    const group = record && record.group;
    const groupId = group && group.groupId;
    if (!groupId || !expected.has(groupId)) {
      problems.push({ code: 'GROUP-PLAN-UNKNOWN', detail: `record ${record && record.reviewId || '(unknown)'} is not bound to a current planned group` });
      continue;
    }
    if (seen.has(groupId)) {
      problems.push({ code: 'GROUP-PLAN-DUPLICATE', detail: `current plan has more than one record for ${groupId}` });
      continue;
    }
    seen.add(groupId);
    const planned = expected.get(groupId);
    if (group.groupDigest !== planned.groupDigest) {
      problems.push({ code: 'GROUP-PLAN-DIGEST-MISMATCH', detail: `${groupId} digest does not match the current deterministic plan` });
    }
    const recordedPaths = ((record.reviewOf && record.reviewOf.changedPaths) || []).slice().sort();
    if (JSON.stringify(recordedPaths) !== JSON.stringify(planned.paths.slice().sort())) {
      problems.push({ code: 'GROUP-PLAN-PATH-MISMATCH', detail: `${groupId} paths do not match the current deterministic plan` });
    }
  }
  for (const group of plan || []) {
    if (!seen.has(group.groupId)) {
      problems.push({ code: 'GROUP-PLAN-MISSING', detail: `current deterministic plan has no record for ${group.groupId}` });
    }
  }
  return { ok: problems.length === 0, problems };
}

function normalizeAggregateReviewer(value) {
  if (!value) throw new Error('--reviewer is required for aggregation');
  if (!['codex', 'grok'].includes(value)) throw new Error(`unsupported aggregate reviewer ${value}`);
  return value;
}

function fsyncDirectory(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function publishAggregateReplacement({ reviewsDir, filename, signed, predecessors = [] }) {
  const bytes = JSON.stringify(signed, null, 2) + '\n';
  const outPath = path.join(reviewsDir, filename);
  const tempPath = path.join(reviewsDir, `.${filename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, bytes, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, outPath);
    fsyncDirectory(reviewsDir);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* original publication error wins */ }
    }
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    throw error;
  }

  const attic = path.join(reviewsDir, 'superseded-aggregates');
  const moved = [];
  try {
    if (predecessors.length) fs.mkdirSync(attic, { recursive: true });
    for (const prior of predecessors) {
      const from = path.join(reviewsDir, prior.file);
      const to = path.join(attic, prior.file);
      fs.renameSync(from, to);
      moved.push({ from, to, prior });
    }
    if (predecessors.length) {
      fsyncDirectory(attic);
      fsyncDirectory(reviewsDir);
    }
  } catch (error) {
    // Restore the previously active authority before withdrawing the failed
    // replacement. Every move is recoverable and remains on the same volume.
    for (const item of moved.reverse()) {
      try { if (!fs.existsSync(item.from) && fs.existsSync(item.to)) fs.renameSync(item.to, item.from); }
      catch { /* the gate now sees ambiguity and therefore fails closed */ }
    }
    const failures = path.join(reviewsDir, 'publication-failures');
    try {
      fs.mkdirSync(failures, { recursive: true });
      if (fs.existsSync(outPath)) fs.renameSync(outPath, path.join(failures, filename));
      fsyncDirectory(reviewsDir);
    } catch { /* preserve both active files rather than delete evidence */ }
    throw error;
  }
  return { outPath, archived: predecessors.map((prior) => prior.file) };
}

// ── per-group review ────────────────────────────────────────────────────────
function cmdRun(args) {
  if (!args.packet) return usage('--packet is required');
  const context = resolveRunContext(args);
  const effectiveArgs = { ...args, packet: context.packetPath || args.packet };
  const subject = subjectOf(effectiveArgs, context);
  const groups = planSubjectGroups(subject, effectiveArgs, null, context);
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
  let worst = 0;
  for (const g of wanted) {
    const candidates = fs.readdirSync(GROUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'));
    const stale = [];
    const laneRecords = [];
    for (const d of candidates) {
      let rec;
      try { rec = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, d.name), 'utf8')); }
      catch { continue; } // unreadable — ambiguous, left in place rather than guessed at
      if (matchesLane(rec, { groupId: g.groupId, reviewer: reviewerLane, subjectSha: subject.subjectSha256 })) {
        stale.push(d.name);
        laneRecords.push({ ...rec, __file: path.join(GROUPS_DIR, d.name) });
      }
    }
    if (args.all) {
      const reusable = reusableCompletedGroupRecord(laneRecords, {
        groupId: g.groupId, reviewer: reviewerLane, subjectSha: subject.subjectSha256,
      }, (rec) => require('./review-sign.cjs').verify(rec, { packetPath: effectiveArgs.packet }));
      if (reusable) {
        console.log(`[review-chunker] keeping completed ${reviewerLane} ${g.groupId} for unchanged subject ${subject.subjectSha256.slice(0, 12)}…`);
        continue;
      }
    }
    const before = new Set(candidates.map((entry) => entry.name));
    console.log(`\n── ${g.groupId}  ${g.label}  (${g.pathCount} path(s)) ──`);
    const rc = runGroup(g, subject, effectiveArgs);
    worst = Math.max(worst, rc);
    const created = fs.readdirSync(GROUPS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !before.has(entry.name))
      .map((entry) => entry.name).sort();
    const createdByLane = partitionCreatedLaneRecords({
      groupsDir: GROUPS_DIR,
      names: created,
      lane: { groupId: g.groupId, reviewer: reviewerLane, subjectSha: subject.subjectSha256 },
    });
    let replacement = null;
    if (rc === EXIT_PASS && createdByLane.owned.length === 1) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, createdByLane.owned[0]), 'utf8'));
        const v = require('./review-sign.cjs').verify(rec, { packetPath: effectiveArgs.packet });
        if (v.ok === true && v.gateable === true
            && rec.disposition !== 'UNAVAILABLE'
            && matchesLane(rec, { groupId: g.groupId, reviewer: reviewerLane, subjectSha: subject.subjectSha256 })) {
          replacement = createdByLane.owned[0];
        }
      } catch { /* invalid replacement is quarantined below */ }
    }
    if (!replacement) {
      quarantineCreatedLaneRecords({ groupsDir: GROUPS_DIR, names: createdByLane.owned });
      worst = Math.max(worst, EXIT_REFUSED);
      continue;
    }
    publishGroupReplacement({ groupsDir: GROUPS_DIR, replacement, predecessors: stale });
    for (const name of stale) console.log(`[review-chunker] archived superseded record for ${reviewerLane} ${g.groupId}: ${name}`);
  }
  return worst;
}

function publishGroupReplacement({ groupsDir, replacement, predecessors }) {
  const attic = path.join(groupsDir, 'superseded');
  const moved = [];
  try {
    if (predecessors.length) fs.mkdirSync(attic, { recursive: true });
    for (const name of predecessors) {
      const from = path.join(groupsDir, name);
      const to = path.join(attic, name);
      fs.renameSync(from, to);
      moved.push({ from, to });
    }
    if (predecessors.length) fsyncDirectory(attic);
    fsyncDirectory(groupsDir);
  } catch (error) {
    for (const item of moved.reverse()) {
      try { if (fs.existsSync(item.to) && !fs.existsSync(item.from)) fs.renameSync(item.to, item.from); } catch {}
    }
    const failed = path.join(groupsDir, 'publication-failures');
    try {
      fs.mkdirSync(failed, { recursive: true });
      const source = path.join(groupsDir, replacement);
      if (fs.existsSync(source)) fs.renameSync(source, path.join(failed, replacement));
      fsyncDirectory(groupsDir);
    } catch {}
    throw error;
  }
  return { replacement, archived: predecessors.slice() };
}

// One bounded reviewer call for one group. The adapter does the signing; this
// only narrows what it is pointed at, and records which group it was.
// Exported so a red proof can assert the metered flags are actually forwarded,
// rather than trusting that they are.
function buildGroupArgv(group, subject, args) {
  const a = [ADAPTERS, '--run',
    '--reviewer', args.reviewer || 'codex',
    '--packet', args.packet,
    '--timeout', String(args.timeout || DEFAULT_REVIEW_TIMEOUT_SEC)];
  if (args.runId) a.push('--run-id', normalizeRunId(args.runId));
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
    timeout: (Number(args.timeout || DEFAULT_REVIEW_TIMEOUT_SEC) + 120) * 1000,
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

// Reviewer limitations are evidence too. An aggregate that carries the
// findings but drops what individual groups could not verify overstates the
// review. Preserve every signed entry (including duplicates, which can show
// that more than one group hit the same limit) and sort by JavaScript code-unit
// order so publication is independent of directory order and host locale.
function mergeGroupUnverified(records) {
  const values = [];
  const problems = [];
  for (const record of records || []) {
    const entries = record && record.unverified === undefined ? [] : record && record.unverified;
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
      problems.push({
        code: 'GROUP-UNVERIFIED-MALFORMED',
        detail: `record ${(record && record.reviewId) || '(unknown)'} has a non-string unverified evidence list`,
      });
      continue;
    }
    values.push(...entries);
  }
  values.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return { values, problems };
}

function gateableGroupProblem(verification, filename = '(unknown group)') {
  if (verification && verification.ok === true && verification.gateable === true) return null;
  return {
    code: 'GROUP-NON-GATEABLE',
    detail: `${filename}: ${(verification && verification.code) || 'ATTESTATION-NON-GATEABLE'} — ` +
      `${(verification && verification.reason) || 'constituent verification did not grant current gate authority'}`,
  };
}

function aggregate(args) {
  const context = resolveRunContext(args);
  const effectiveArgs = { ...args, packet: context.packetPath || args.packet };
  const subject = subjectOf(effectiveArgs, context);
  const plan = planSubjectGroups(subject, effectiveArgs, null, context);
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
    const verificationProblem = gateableGroupProblem(v, path.basename(l.path));
    if (verificationProblem) { problems.push(verificationProblem); continue; }
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

  const planBinding = checkPlanBinding(usable, plan);
  problems.push(...planBinding.problems);

  const mergedUnverified = mergeGroupUnverified(usable);
  problems.push(...mergedUnverified.problems);

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

  return {
    ok, problems, usable, plan, planBinding, subject, disposition, findings,
    unverified: mergedUnverified.values, cov, runId: context.runId,
    packetPath: context.packetPath,
  };
}

// `informational` is an operator-only control flag used while deciding whether
// aggregation may proceed. It is deliberately not part of the signed review
// record: the engineering-review schema permits only the durable problem code
// and explanation. Keeping the projection explicit prevents an otherwise valid
// aggregate from becoming schema-invalid merely because another reviewer lane
// or an older subject was observed during aggregation.
function schemaAggregateProblems(problems) {
  return (problems || []).map((problem) => ({
    code: problem.code,
    detail: problem.detail,
  }));
}

function cmdAggregate(args) {
  if (!args.packet) return usage('--packet is required');
  let reviewer;
  try { reviewer = normalizeAggregateReviewer(args.reviewer); }
  catch (error) { return usage(error.message); }
  const a = aggregate(args);
  const ts = new Date().toISOString();

  const recordStamp = ts.replace(/[^0-9]/g, '');
  const runSuffix = a.runId ? `-${a.runId}` : '';
  const record = {
    // reviewId is attested, so the explicit run coordinate is durable without
    // adding an unsigned parallel authority to the review schema.
    reviewId: `REV-${recordStamp}-${reviewer}${runSuffix}-aggregate`,
    ts,
    reviewer,
    reviewerModel: a.usable.length ? a.usable[0].reviewerModel : 'unknown',
    packetId: (() => { try { return JSON.parse(fs.readFileSync(a.packetPath || args.packet, 'utf8')).packetId; } catch { return 'unknown'; } })(),
    reviewOf: { diffSha256: a.subject.subjectSha256, changedPaths: a.subject.subjectPaths.slice() },
    disposition: a.disposition,
    findings: a.ok ? a.findings : [],
    unverified: a.unverified,
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
      problems: schemaAggregateProblems(a.problems),
    },
  };
  if (!a.ok) {
    record.unavailableReason = `chunked review did not produce consumable evidence: ${a.problems.map((p) => p.code).join(', ')}`;
  }

  fs.mkdirSync(REVIEWS_DIR, { recursive: true });
  const signed = require('./review-sign.cjs').sign(record, { packetPath: a.packetPath || args.packet });

  // A rerun replaces only the aggregate in the SAME reviewer + exact-subject
  // lane. Codex and Grok are separate required authorities, so both aggregates
  // must remain discoverable at the top level regardless of publication order.
  // A predecessor moved to the archive is no longer an active gate record, so
  // the replacement must not carry a `supersedes` pointer to that invisible
  // record; engineering-os correctly refuses pointers whose target is absent.
  const priorAggregates = fs.readdirSync(REVIEWS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('-aggregate.json'))
    .map((d) => {
      const file = d.name;
      try { return { file, rec: JSON.parse(fs.readFileSync(path.join(REVIEWS_DIR, file), 'utf8')) }; }
      catch { return { file, rec: null }; }
    })
    .sort((left, right) => left.file.localeCompare(right.file));
  const retention = selectAggregateRetention(priorAggregates, {
    reviewer: record.reviewer,
    subjectSha: a.subject.subjectSha256,
  });
  const filename = `${recordStamp}-${reviewer}${runSuffix}-aggregate.json`;
  const publication = publishAggregateReplacement({
    reviewsDir: REVIEWS_DIR,
    filename,
    signed,
    predecessors: retention.superseded,
  });
  const outPath = publication.outPath;
  for (const prior of retention.superseded) {
    console.log(`[review-chunker] superseded prior ${record.reviewer} aggregate for ${a.subject.subjectSha256.slice(0, 12)}…: ${prior.file}`);
  }

  if (args.json) { console.log(JSON.stringify(signed, null, 2)); return a.ok ? EXIT_PASS : EXIT_REFUSED; }

  console.log('AEGIS — AGGREGATE REVIEW VERDICT');
  console.log('='.repeat(64));
  console.log(`subject     : ${a.subject.subjectSha256.slice(0, 16)}…`);
  if (a.runId) console.log(`run         : ${a.runId}`);
  console.log(`groups      : ${a.usable.length} usable of ${a.plan.length} planned`);
  console.log(`coverage    : ${a.cov.ok ? 'EXACT' : a.cov.code}`);
  console.log(`disposition : ${a.disposition}`);
  console.log(`findings    : ${record.findings.length}`);
  console.log(`unverified  : ${record.unverified.length}`);
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

  --plan [--groups N] [--run-id <RUN-...> --packet <p>] [--base <ref>] [--head <ref>] [--json]
  --run --group <G1..Gn> --packet <p> [--run-id <RUN-...>] [--reviewer codex|grok] [--timeout <s>]
        [--allow-metered --approved-by "<name>" --cap-usd <n>] [--data-class <c>]
  --run-all --groups <N> --packet <p> [--run-id <RUN-...>] [--reviewer codex|grok] [--timeout <s>]
        [--allow-metered --approved-by "<name>" --cap-usd <n>] [--data-class <c>]

A METERED reviewer (grok) needs all three of --allow-metered, --approved-by and
--cap-usd. Without them the adapter refuses — deliberately, and before spending.
  --aggregate --groups <N> --reviewer codex|grok --packet <p> [--run-id <RUN-...>] [--json]

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
    else if (t === '--run-id') a.runId = argv[++i];
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

module.exports = { planGroups, planSubjectGroups, pathSizes, groupBytes, fixedReviewOverheadBytes, checkCoverage, checkPlanBinding, aggregate, mergeGroupUnverified, gateableGroupProblem, schemaAggregateProblems, buildGroupArgv, roleOf, ROLES, DEFAULT_GROUPS, DEFAULT_REVIEW_TIMEOUT_SEC, MAX_GROUP_BYTES, MAX_GROUP_PAYLOAD_BYTES, FIXED_CHECK_OVERHEAD_BYTES, matchesLane, reusableCompletedGroupRecord, partitionCreatedLaneRecords, quarantineCreatedLaneRecords, selectAggregationLane, matchesAggregateLane, selectAggregateRetention, normalizeAggregateReviewer, normalizeRunId, resolveRunContext, buildSubjectInvocation, parseArgs, publishAggregateReplacement, publishGroupReplacement };
