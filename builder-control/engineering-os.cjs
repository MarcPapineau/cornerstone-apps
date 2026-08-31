#!/usr/bin/env node
/**
 * engineering-os.cjs — the deterministic half of the AI Engineering OS.
 *
 * WHAT THIS IS FOR
 * The multi-model loop (Claude builds, Codex reviews, Copilot guards, Grok
 * attacks) is worth nothing if the decision at the end is a judgement call made
 * by one of the participants. So every part of that loop that CAN be decided by
 * arithmetic is decided here instead, with no model in the path:
 *
 *   --subject       the subject paths + hash a review must bind to
 *   --classify      which lane the subject is in, and who must review it
 *   --spec-check    is the intent this build claims to implement actually pinned
 *   --validate-review   is a review record well-formed evidence
 *   --gate-done     fail-closed gate; subject binding is mandatory
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not call any model, hold any credential, or judge code quality. It
 * cannot tell you whether the code is good. It can only tell you whether the
 * process that was supposed to establish that actually happened, on THIS diff.
 * Those are different claims and the whole point is to stop conflating them.
 *
 * IT EXTENDS BUILDER CONTROL — IT DOES NOT FORK IT
 *   registry / protected paths : read from the existing files, never re-declared
 *   packet validation          : shells builder-control/packet-tools.cjs
 *   ledger                     : shells builder-control/ledger-writer.cjs --append
 * There is no second gate, no second ledger, no second packet format here.
 *
 * Exit codes match the rest of the system:
 *   0 = PASS
 *   2 = usage, unreadable input, malformed record
 *   3 = HARD-BLOCK (a rule refused; the reason is named in the output)
 *
 * Source of truth: builder-control/CONTROL-CONTRACT.md and
 * builder-control/AI-ENGINEERING-OS.md. This file adds no doctrine of its own.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const PROTECTED_PATHS = path.join(HERE, 'protected-paths.json');
const REVIEW_SCHEMA = path.join(HERE, 'schemas', 'engineering-review.schema.json');
const PACKET_TOOLS = path.join(HERE, 'packet-tools.cjs');
const LEDGER_WRITER = path.join(HERE, 'ledger-writer.cjs');

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_BLOCK = 3;
const MAX_UNTRACKED_SUBJECT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_UNTRACKED_SUBJECT_TOTAL_BYTES = 64 * 1024 * 1024;

// ── Risk taxonomy ───────────────────────────────────────────────────────────
// Path-shaped, because a path is knowable before anything is read and cannot be
// argued with. This list is deliberately over-broad: the cost of a false FULL
// is one extra review, the cost of a false LIGHT is an unreviewed auth change.
// Section 12 of the protocol (high-risk change classes) is the source for it.
const HIGH_RISK_PATTERNS = [
  { re: /(^|\/|[._-])(auth|authn|authz|login|logout|session|oauth|saml|sso)([._-]|\/|$)/i, why: 'authentication/authorization surface' },
  { re: /(^|\/|[._-])(password|credential|secret|token|apikey|api[._-]?key|keystore|vault)([._-]|\/|$)/i, why: 'secret or credential handling' },
  { re: /(^|\/|[._-])(payment|billing|invoice|checkout|stripe|paypal|charge|subscription)([._-]|\/|$)/i, why: 'payment path' },
  { re: /(^|\/)(migrations?|schema)(\/|$)|\.(sql)$|([._-]migration[._-])/i, why: 'database schema or migration' },
  { re: /(^|\/|[._-])(permission|role|acl|policy|tenant|rbac)([._-]|\/|$)/i, why: 'permission or tenant-isolation surface' },
  { re: /(^|\/|[._-])(crypto|encrypt|decrypt|cipher|hash(ing)?|signature)([._-]|\/|$)/i, why: 'cryptographic code' },
  { re: /(^|\/|[._-])(security|csrf|xss|cors|sanitiz|escape)([._-]|\/|$)/i, why: 'security control' },
  { re: /(^|\/)\.env|(^|\/)secrets?\./i, why: 'environment/secret file' },
  { re: /(^|\/)\.github\/workflows\//i, why: 'CI enforcement — this is the gate itself' },
  { re: /(^|\/)builder-control\//i, why: 'the control system itself' },
  { re: /(^|\/)(Dockerfile|docker-compose|terraform|\.tf$|helm|k8s|kubernetes)/i, why: 'infrastructure definition' },

  // ── control-plane surfaces (PKT-20260825-GOVERNANCE-TRUTH) ───────────────
  // PROVEN HOLE: the light lane is a file-TYPE allow-list, and the files that
  // govern this system are Markdown. `.github/copilot-instructions.md`,
  // `.github/agents/*.md` and `.github/pull_request_template.md` all classified
  // LIGHT with ZERO required reviewers — meaning the instructions handed to the
  // reviewing agents, and the PR checklist a human reads, could be rewritten
  // with no review at all. Rewriting the reviewer's brief is not a docs change;
  // it is a change to the gate, made in a file extension the gate trusted.
  //
  // These are matched on PATH, independently of protected-paths.json. AGENTS.md
  // and CLAUDE.md are listed in that policy today, but a policy is editable and
  // this class must not depend on an entry surviving in it. Two independent
  // reasons to reach FULL is the point, not duplication.
  // CONFIRMED FINDING #2 (REV-20260825234549-codex): this was anchored with
  // `^(AGENTS|CLAUDE)\.md$`, which matched the ROOT charter and nothing else.
  // `luke-app/CLAUDE.md` is a real agent charter in this repository and it
  // classified LIGHT; `docs/AGENTS.md` would have too. A charter governs the
  // agent that reads it regardless of how deep it sits, so the depth anchor is
  // gone. Case-sensitive on purpose: these filenames are spelled in caps by
  // convention, and a case-insensitive match would drag in ordinary prose files
  // like `agents.md` in a docs tree.
  { re: /(^|\/)(AGENTS|CLAUDE)\.md$/, why: 'agent charter — the instructions every agent in this tree runs under' },
  // `.claude/` holds settings, hooks and launch configuration that decide what
  // an agent is permitted to do and what runs on its behalf. `luke-app/.claude/`
  // exists here and contains exactly that. It is control, not configuration
  // trivia, at every depth.
  { re: /(^|\/)\.claude(\/|$)/i, why: 'agent control directory (.claude — settings, hooks, launch config)' },
  { re: /(^|\/)\.github\//i, why: 'repository control surface (.github — agent briefs, PR controls, CI)' },
  { re: /(^|\/)protected-paths[^/]*\.json$/i, why: 'protected-path policy — the file that decides what is protected' },
  { re: /(^|\/)(CODEOWNERS)$/i, why: 'review-ownership control file' },
];

// LIGHT lane is an allow-list, not a deny-list. Anything this does not
// positively recognise as low-risk goes to FULL. Fail toward review.
const LIGHT_LANE_PATTERNS = [
  /\.md$/i,
  /\.txt$/i,
  /(^|\/)\.gitignore$/,
  /(^|\/)(docs?|documentation)\//i,
  /(^|\/)(CHANGELOG|README|LICENSE|CONTRIBUTING)(\.[A-Za-z]+)?$/i,
];

// Size ceilings on the light lane. A 400-line "docs only" change is not a
// trivial change; it is a big change that happens to be in Markdown.
const LIGHT_MAX_FILES = 5;
const LIGHT_MAX_LINES = 150;

// ── who reviews a FULL lane ─────────────────────────────────────────────────
// Two reviewers, two different jobs: Codex reviews the change as an engineer,
// Grok attacks it. One frozen list, so the set cannot be narrowed by a
// conditional somewhere downstream. Copilot is advisory FOREVER — it may block
// on a CRITICAL/HIGH finding, and it may never satisfy a required slot or
// unblock the gate by itself.
const FULL_LANE_REQUIRED_REVIEWERS = Object.freeze(['codex', 'grok']);
const ADVISORY_ONLY_REVIEWERS = Object.freeze(['copilot']);
const REVIEWER_JOB = Object.freeze({
  codex: 'independent engineering review',
  grok: 'adversarial red team',
  copilot: 'repository guardian (advisory — can block, cannot approve)',
});

// ── small helpers ───────────────────────────────────────────────────────────
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function gitBuffer(args) {
  const r = spawnSync('git', args, { cwd: process.env.GIT_WORK_TREE || ROOT,
    env: process.env, encoding: null, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new PolicyError(`git ${args.join(' ')} failed: ${String(r.stderr || '').trim()}`);
  return r.stdout;
}

function out(s) { process.stdout.write(s + '\n'); }

function die(msg, code) {
  process.stderr.write(`\n[engineering-os] ${msg}\n`);
  process.exit(code);
}

// Raised when the protected-path policy cannot be trusted. Separate from a
// usage error because it must always fail closed, never degrade to a default.
class PolicyError extends Error {}

// A PolicyError with its own name, so a refusal to accept a caller-declared
// change is not reported as "the policy file could not be read". Both fail
// closed; they are not the same failure and must not read as one.
class SyntheticInputError extends PolicyError {}

// A path that cannot be reduced to a single canonical spelling. Also a hard
// block, also named for itself.
class PathAliasError extends PolicyError {}

// ── path canonicalisation ───────────────────────────────────────────────────
// CONFIRMED FINDING #2 (REV-20260825234549-codex): every risk pattern here is a
// regex over a path STRING, so two spellings of one file are two different
// files as far as the classifier is concerned. `./AGENTS.md` and
// `dir/../AGENTS.md` are the root agent charter; matched as raw strings they
// are neither. An alias is not a new file, and a classifier that can be fed
// aliases is a classifier that can be told the change is somewhere it is not.
//
// So nothing is classified until it has exactly one spelling:
//   dot segments (`./`, `a/../b`)  -> RESOLVED to the canonical path
//   absolute paths, backslashes    -> REFUSED, because git never emits them;
//                                     their presence means the path did not
//                                     come from the canonical path set
//   escaping the repo root         -> REFUSED, it is not a repository path
//
// Refusal is a hard block, not a downgrade to "unknown". A path this cannot
// reduce to one canonical form is a path whose risk cannot be evaluated, and an
// unevaluated path has never been allowed to reach the light lane here.
function canonicalizePath(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'is not a non-empty string, so it names nothing that can be classified' };
  }
  if (raw.includes('\0')) {
    return { ok: false, reason: 'contains a NUL byte' };
  }
  if (raw.includes('\\')) {
    return { ok: false, reason: 'contains a backslash — git emits `/` separators only, so this did not come from the canonical path set' };
  }
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    return { ok: false, reason: 'is absolute — only repository-relative paths can be classified' };
  }
  const norm = path.posix.normalize(raw).replace(/\/+$/, '');
  if (norm === '' || norm === '.') {
    return { ok: false, reason: 'resolves to the repository root, which is not a changed file' };
  }
  if (norm === '..' || norm.startsWith('../')) {
    return { ok: false, reason: 'escapes the repository root' };
  }
  return { ok: true, path: norm };
}

// Canonicalise a whole set, refusing the batch if any member cannot be reduced.
// `where` names the input so the block says which surface supplied the bad path.
function canonicalizePaths(paths, where) {
  const seen = [];
  for (const raw of paths) {
    const c = canonicalizePath(raw);
    if (!c.ok) {
      throw new PathAliasError(
        `${where}: path ${JSON.stringify(String(raw))} ${c.reason}. ` +
        'Refusing to classify it: a path with more than one spelling can be spelled around every rule below.'
      );
    }
    if (!seen.includes(c.path)) seen.push(c.path);
  }
  return seen.sort();
}

// ── git refs: validated, and never interpolated into a shell ────────────────
// Every git invocation below goes through execFileSync with an ARGUMENT ARRAY.
// No string is ever handed to a shell, so a ref containing ; | & $( ) ` or a
// newline cannot execute anything — the worst it can do is fail to resolve.
//
// The pattern additionally refuses a leading '-' so a ref can never be
// swallowed as a git option, and refuses '..' so a single ref argument cannot
// smuggle a range.
const REF_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,254}$/;

function assertRef(ref, label) {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new PolicyError(`${label}: a git ref is required`);
  }
  if (!REF_RE.test(ref) || ref.includes('..')) {
    throw new PolicyError(
      `${label}: refusing the ref ${JSON.stringify(ref)} — it is not a plain ref name. ` +
      'Allowed: letters, digits, dot, underscore, slash, hyphen; no leading hyphen, no "..".'
    );
  }
  return ref;
}

// Argument-array git. Returns stdout as a string; throws on non-zero.
function git(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
  if (r.error) throw new PolicyError(`git ${args[0]} failed to start: ${r.error.message}`);
  if (r.status !== 0) {
    throw new PolicyError(`git ${args.join(' ')} exited ${r.status}: ${(r.stderr || '').trim()}`);
  }
  return r.stdout;
}

// ── The SUBJECT of a build ──────────────────────────────────────────────────
// The subject is the code under review. It is NOT everything the branch
// touched, because a branch also carries the evidence ABOUT the change:
// review records, raw reviewer transcripts, the task packet, the ledger.
//
// Those must be excluded for two independent reasons:
//
//   1. A review cannot be part of the hash it certifies. If review records were
//      in the subject diff, writing one would change the hash, which would
//      invalidate the record that was just written — no set of reviews could
//      ever satisfy the gate. Excluding them makes adding evidence a no-op on
//      the subject hash, which is what lets the loop terminate at all.
//
//   2. Control metadata must not escalate risk. builder-control/ is high-risk
//      because the control CODE is high-risk. A perfectly ordinary front-end PR
//      that happens to carry its own packet and review records would otherwise
//      inherit "the control system itself" and be forced to HIGH forever.
//
// Control CODE (gate.cjs, engineering-os.cjs, the doctrine) stays in the
// subject and stays high-risk. Only evidence artifacts are excluded.
const EVIDENCE_EXCLUDE = [
  'builder-control/reviews/**',
  'builder-control/review-raw/**',
  'builder-control/packets/**',
  'builder-control/runs/**',
  'builder-control/ledger.json',
  'builder-control/**-BACKUP-*',
];

function isEvidencePath(p) {
  return EVIDENCE_EXCLUDE.some((g) => globToRe(g).test(p));
}

// ── the test-only synthetic-subject boundary ────────────────────────────────
// CONFIRMED FINDING #1 (REV-20260825234549-codex), CRITICAL, reproduced here
// before this fix: in a working tree whose real subject was 9 HIGH-RISK
// builder-control paths, `--gate-done --changed README.md --diff-lines 1
// --subject-sha e3b0c442…` exited 0 with lane LIGHT, no packet and no required
// reviews. The gate was not wrong about the tree; it was never shown the tree.
// The caller handed it a different change and it certified that one.
//
// `--changed` and `--diff-lines` exist because the test-suite has to feed the
// classifier paths that do not exist in any working tree. That is a legitimate
// need and a lethal capability, so it is now a door with a lock on it rather
// than an argument anyone can pass:
//
//   BOTH are required, together:
//     --test-only-synthetic-subject      (explicit at the call site)
//     ENGOS_TEST_ONLY_SYNTHETIC=1        (explicit in the environment)
//
// Two independent gestures, in two different channels, neither of which occurs
// by accident and neither of which is reachable by a CI invocation or a copied
// command line. Without both, `--changed` and `--diff-lines` are not ignored —
// ignoring them would silently certify something other than what was asked
// for — they are a HARD BLOCK naming the rule.
//
// In production there is therefore no narrowing left to enforce equality
// against: the changed-path set and the changed-line count are read from git
// and from nowhere else.
const SYNTHETIC_ENV = 'ENGOS_TEST_ONLY_SYNTHETIC';

function syntheticAllowed(args) {
  return args['test-only-synthetic-subject'] === true && process.env[SYNTHETIC_ENV] === '1';
}

// Resolve what the commands are actually allowed to use. Every command that
// classifies or gates goes through this — there is one answer to "what changed",
// not one per command.
function resolveSubjectInputs(args, operation) {
  const wantsChanged = Array.isArray(args.changed) && args.changed.length > 0;
  const wantsLines = args.diffLines !== undefined && args.diffLines !== null;
  if (!wantsChanged && !wantsLines) {
    return { changed: [], diffLines: undefined, synthetic: false };
  }
  if (!syntheticAllowed(args)) {
    const supplied = [wantsChanged ? '--changed' : null, wantsLines ? '--diff-lines' : null].filter(Boolean).join(' and ');
    throw new SyntheticInputError(
      `${operation} was given ${supplied}, which would let the caller ` +
      'decide what this change consists of. The changed-path set and the changed-line count are read from git, ' +
      `not from arguments. (Test fixtures must pass --test-only-synthetic-subject AND set ${SYNTHETIC_ENV}=1.)`
    );
  }
  return { changed: args.changed.slice(), diffLines: args.diffLines, synthetic: true };
}

// Canonical changed-line count for a set of subject paths, read from git.
// `--numstat` reports added/deleted per file; binary files report `-` and
// contribute 0 lines, which is correct here — a binary blob has no line count
// and inventing one would be the same fabrication this is closing.
function gitChangedLines({ base, head, paths }) {
  if (!paths.length) return 0;
  const h = assertRef(head || 'HEAD', '--head');
  const a = ['diff', '--numstat'];
  if (base) a.push(`${assertRef(base, '--base')}..${h}`);
  else a.push(h);
  a.push('--', ...paths);
  let total = 0;
  for (const line of git(a).split('\n')) {
    if (!line.trim()) continue;
    const [add, del] = line.split('\t');
    total += (add === '-' ? 0 : Number(add) || 0) + (del === '-' ? 0 : Number(del) || 0);
  }
  return total;
}

// Compute subject paths + the hash reviewers bind to.
// changedPaths come from git. They come from `changed` ONLY behind the
// test-only boundary above, which the callers enforce before reaching here.
function packetAuthorizedExactNewLeaves(packetPath, worktreeRoot) {
  if (!packetPath) return new Set();
  const resolved = path.isAbsolute(packetPath)
    ? packetPath
    : path.resolve(worktreeRoot, packetPath);
  let packet;
  try { packet = readJSON(resolved); }
  catch (error) {
    throw new PolicyError(`canonical subject cannot read its authorizing packet: ${error.message}`);
  }
  if (!packet || !Array.isArray(packet.filesAllowed)) {
    throw new PolicyError('canonical subject packet has no filesAllowed authority');
  }
  return new Set(packet.filesAllowed.filter((value) =>
    typeof value === 'string' && value.length > 0 && !/[*?\[\]{}]/.test(value))
    .map((value) => canonicalizePaths([value], 'packet exact new-leaf authority')[0]));
}

function newLeafFrame(relative, mode, body) {
  return Buffer.concat([
    Buffer.from(`\0AEGIS_NEW_LEAF_SUBJECT_V2\0${relative}\0${mode}\0${body.length}\0`, 'utf8'),
    body,
  ]);
}

function captureAuthorizedUntracked(untrackedPaths, packetPath) {
  if (!untrackedPaths.length) return { paths: [], leaves: new Map(), lineCount: 0 };
  const worktreeRoot = fs.realpathSync(process.env.GIT_WORK_TREE || ROOT);
  const allowed = packetAuthorizedExactNewLeaves(packetPath, worktreeRoot);
  const unauthorized = untrackedPaths.filter((value) => !allowed.has(value));
  if (unauthorized.length) {
    throw new PolicyError(
      `canonical subject refuses ${unauthorized.length} unauthorized repository-relevant untracked file(s): ` +
      `${unauthorized.slice(0, 8).join(', ')}${unauthorized.length > 8 ? ', …' : ''}. ` +
      'Authorize each new leaf as an exact filesAllowed path or remove it.');
  }

  const chunks = [];
  const leaves = new Map();
  let total = 0;
  let lineCount = 0;
  for (const relative of untrackedPaths) {
    const absolute = path.resolve(worktreeRoot, ...relative.split('/'));
    if (absolute !== worktreeRoot && !absolute.startsWith(worktreeRoot + path.sep)) {
      throw new PolicyError(`canonical untracked subject escapes the worktree: ${relative}`);
    }
    const before = fs.lstatSync(absolute);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw new PolicyError(`canonical untracked subject must be a regular single-link file: ${relative}`);
    }
    if (before.size > MAX_UNTRACKED_SUBJECT_FILE_BYTES || total + before.size > MAX_UNTRACKED_SUBJECT_TOTAL_BYTES) {
      throw new PolicyError(`canonical untracked subject exceeds the bounded byte authority: ${relative}`);
    }
    const body = fs.readFileSync(absolute);
    const after = fs.lstatSync(absolute);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || !after.isFile() || after.isSymbolicLink() || after.nlink !== 1) {
      throw new PolicyError(`canonical untracked subject changed while it was captured: ${relative}`);
    }
    const mode = before.mode & 0o777;
    const frame = newLeafFrame(relative, mode.toString(8), body);
    chunks.push(frame);
    leaves.set(relative, frame);
    total += body.length;
    lineCount += body.length ? body.toString('utf8').split(/\r?\n/).length - 1 : 0;
  }
  return { paths: untrackedPaths.slice(), leaves, bytes: Buffer.concat(chunks), lineCount };
}

function committedNewLeafFrame(relative, ref) {
  const record = gitBuffer(['ls-tree', '-z', ref, '--', relative]);
  const tab = record.indexOf(0x09);
  if (tab < 0 || record[record.length - 1] !== 0) {
    throw new PolicyError(`cannot resolve committed new-leaf authority for ${relative} at ${ref}`);
  }
  const header = record.subarray(0, tab).toString('utf8').split(' ');
  if (header.length !== 3 || header[1] !== 'blob' || !/^[0-9a-f]{40,64}$/.test(header[2])) {
    throw new PolicyError(`committed new leaf is not one regular blob: ${relative}`);
  }
  const body = gitBuffer(['cat-file', 'blob', header[2]]);
  if (body.length > MAX_UNTRACKED_SUBJECT_FILE_BYTES) {
    throw new PolicyError(`canonical committed new leaf exceeds the bounded byte authority: ${relative}`);
  }
  return newLeafFrame(relative, header[0].slice(-3), body);
}

function worktreeNewLeafFrame(relative) {
  const worktreeRoot = fs.realpathSync(process.env.GIT_WORK_TREE || ROOT);
  const absolute = path.resolve(worktreeRoot, ...relative.split('/'));
  const before = fs.lstatSync(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new PolicyError(`canonical added subject must be a regular single-link file: ${relative}`);
  }
  const body = fs.readFileSync(absolute);
  const after = fs.lstatSync(absolute);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new PolicyError(`canonical added subject changed while it was captured: ${relative}`);
  }
  return newLeafFrame(relative, (before.mode & 0o777).toString(8), body);
}

function computeSubject({ base, head, changed, packet }) {
  let changedPaths;
  let untrackedCapture = { paths: [], leaves: new Map(), bytes: Buffer.alloc(0), lineCount: 0 };
  if (Array.isArray(changed) && changed.length) {
    changedPaths = changed.slice();
  } else {
    const h = assertRef(head || 'HEAD', '--head');
    if (base) {
      const b = assertRef(base, '--base');
      changedPaths = git(['diff', '--name-only', `${b}..${h}`]).split('\n').filter(Boolean);
    } else {
      changedPaths = git(['diff', '--name-only', h]).split('\n').filter(Boolean);
    }

    // `git diff` cannot see untracked files. Exact new-leaf authority is already
    // part of the packet contract, so include those bytes directly instead of
    // requiring an out-of-band `git add` that the contained worker cannot run.
    // Any untracked path not named by one exact filesAllowed entry still blocks.
    const untrackedPaths = canonicalizePaths(
      git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean),
      'untracked path set');
    const untrackedSubjectPaths = untrackedPaths.filter((p) => !isEvidencePath(p));
    untrackedCapture = captureAuthorizedUntracked(untrackedSubjectPaths, packet);
    changedPaths.push(...untrackedCapture.paths);
  }
  // One spelling per path, before anything downstream reads them as strings.
  // Applied to the git-derived set too: git output is already canonical, so
  // this costs nothing there and means no path reaches the hash or the
  // classifier without having passed the same reduction.
  changedPaths = canonicalizePaths([...new Set(changedPaths)], 'changed path set');

  const subjectPaths = changedPaths.filter((p) => !isEvidencePath(p));
  const excluded = changedPaths.filter(isEvidencePath);

  // Encode each new leaf identically before and after commit. A raw Git new-file
  // patch is not byte-equivalent to the pre-commit untracked capture, which
  // made an otherwise exact reviewed checkpoint impossible to establish.
  const h = assertRef(head || 'HEAD', '--head');
  const range = base ? `${assertRef(base, '--base')}..${h}` : h;
  const added = new Set(subjectPaths.length
    ? git(['diff', '--name-only', '--diff-filter=A', range, '--', ...subjectPaths]).split('\n').filter(Boolean)
    : []);
  const chunks = [];
  for (const relative of subjectPaths.slice().sort()) {
    if (untrackedCapture.leaves.has(relative)) chunks.push(untrackedCapture.leaves.get(relative));
    else if (added.has(relative)) chunks.push(base
      ? committedNewLeafFrame(relative, h) : worktreeNewLeafFrame(relative));
    else chunks.push(gitBuffer(['diff', range, '--', relative]));
  }
  const subjectBytes = Buffer.concat(chunks);
  return {
    changedPaths,
    subjectPaths,
    excludedAsEvidence: excluded,
    subjectSha256: sha256(subjectBytes),
    diffBytes: subjectBytes.length,
    untrackedSubjectPaths: untrackedCapture.paths,
    untrackedLineCount: untrackedCapture.lineCount,
    range: base ? `${base}..${head || 'HEAD'}` : (head || 'HEAD'),
  };
}

function parseArgs(argv) {
  const a = { changed: [], review: [], _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--changed') a.changed.push(argv[++i]);
    else if (t === '--review') a.review.push(argv[++i]);
    else if (t === '--packet') a.packet = argv[++i];
    else if (t === '--run-id') a.runId = argv[++i];
    else if (t === '--diff-lines') a.diffLines = Number(argv[++i]);
    else if (t === '--subject-sha') a.subjectSha = argv[++i];
    else if (t === '--diff-sha') a.diffSha = argv[++i];
    else if (t === '--run-checks') a.runChecks = true;
    else if (t === '--base') a.base = argv[++i];
    else if (t === '--head') a.head = argv[++i];
    else if (t === '--milestone') a.milestone = true;
    else if (t === '--novel') a.novel = true;
    else if (t === '--json') a.json = true;
    else if (t === '--ledger') a.ledger = true;
    else if (t.startsWith('--')) a[t.slice(2)] = true;
    else a._.push(t);
  }
  return a;
}

// Collect every protected path from the existing policy file. We read the
// canonical file rather than restating any path here — a second copy of the
// protected list is precisely the duplicate authority the contract forbids.
// Load the protected-path policy. FAIL CLOSED: a missing or unreadable policy
// file is a hard error, never an empty allow-list. Treating "no policy found"
// as "nothing is protected" would mean a deleted or corrupted policy silently
// unprotects the entire repository — the file that exists to say what must not
// be touched would, by vanishing, permit touching everything.
function protectedGlobs() {
  if (!fs.existsSync(PROTECTED_PATHS)) {
    throw new PolicyError(
      `protected-path policy not found at ${path.relative(ROOT, PROTECTED_PATHS)}. ` +
      'Refusing to classify anything: an absent policy is not an empty policy.'
    );
  }
  let pol;
  try {
    pol = readJSON(PROTECTED_PATHS);
  } catch (e) {
    throw new PolicyError(
      `protected-path policy at ${path.relative(ROOT, PROTECTED_PATHS)} is unreadable or not valid JSON: ${e.message}`
    );
  }
  if (!pol || typeof pol !== 'object' || !pol.categories || typeof pol.categories !== 'object') {
    throw new PolicyError('protected-path policy has no "categories" object — it cannot be interpreted, so nothing may proceed.');
  }
  const globs = [];
  for (const cat of Object.values(pol.categories)) {
    for (const p of (cat && cat.paths) || []) globs.push(p);
  }
  if (globs.length === 0) {
    throw new PolicyError('protected-path policy lists zero paths. A policy that protects nothing is almost certainly a broken policy, so this fails closed.');
  }
  return globs;
}

// Minimal glob -> RegExp. Supports ** and *, which is all protected-paths.json
// uses. Anything fancier should change the policy file's vocabulary, not this.
//
// Written as a single left-to-right scan rather than chained .replace() calls.
// The previous version used a placeholder character to stage the ** rewrite and
// embedded two literal NUL bytes in this source file, which made the file
// binary to git, grep and every editor that respects NUL.
function globToRe(g) {
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { out += '.*'; i++; }
    else if (c === '*') { out += '[^/]*'; }
    else if ('.+^${}()|[]\\?'.includes(c)) { out += '\\' + c; }
    else out += c;
  }
  return new RegExp('^' + out + '$');
}

function isProtected(p, globs) {
  return globs.some((g) => globToRe(g).test(p));
}

// The single place any command asks "what changed, and how much of it".
// Production: both answers come from git. Test-only synthetic mode: both come
// from the arguments, and only after resolveSubjectInputs() has confirmed the
// caller opened that door deliberately, twice.
//
// This is also what makes classification a function of the subject alone. In
// production the caller cannot supply a line count, so re-running --classify on
// one subject hash cannot produce a different lane the second time.
function subjectAndLines(args, operation) {
  const si = resolveSubjectInputs(args, operation);
  const subject = computeSubject({ base: args.base, head: args.head, changed: si.changed, packet: args.packet });
  const diffLines = si.synthetic
    ? si.diffLines
    : gitChangedLines({ base: args.base, head: args.head, paths: subject.subjectPaths }) +
      subject.untrackedLineCount;
  return { subject, diffLines };
}

// ── COMMAND: --subject ──────────────────────────────────────────────────────
// The identity of the change under review. Reviews bind to subjectSha256,
// which is what stops a verdict on one diff from clearing another.
function cmdSubject(args) {
  const { subject: s } = subjectAndLines(args, '--subject');
  if (args.json) { out(JSON.stringify(s, null, 2)); return EXIT_PASS; }

  out('ENGINEERING OS — SUBJECT OF THIS CHANGE');
  out('='.repeat(52));
  out(`range          : ${s.range}`);
  out(`subjectSha256  : ${s.subjectSha256}`);
  out(`subject bytes  : ${s.diffBytes}`);
  out('');
  out(`subject paths (${s.subjectPaths.length}) — what review evidence must cover:`);
  for (const p of s.subjectPaths) out(`  ${p}`);
  if (s.excludedAsEvidence.length) {
    out('');
    out(`excluded as evidence (${s.excludedAsEvidence.length}) — deliberately NOT in the hash:`);
    for (const p of s.excludedAsEvidence) out(`  ${p}`);
    out('');
    out('Adding or editing these does not change subjectSha256, which is what');
    out('allows review records to be written without invalidating themselves.');
  }
  if (s.subjectPaths.length === 0) {
    out('');
    out('WARNING: this change has NO subject paths — it is evidence only.');
    out('There is nothing here for a reviewer to review.');
  }

  return EXIT_PASS;
}
// ── COMMAND: --classify ─────────────────────────────────────────────────────
function classify(changedInput, opts = {}) {
  const globs = protectedGlobs();
  const reasons = [];
  const perPath = [];

  // Nothing below reads a path that has not been reduced to one spelling
  // first (finding #2). computeSubject() already did this for every caller in
  // this file; repeating it here is deliberate, because classify() is the
  // function that turns a path into a risk verdict and it must not be possible
  // to reach it with an alias by adding a caller later. A path that cannot be
  // canonicalised throws out of here as a PolicyError — a hard block, never a
  // quiet downgrade to "unknown".
  const changed = canonicalizePaths(changedInput, 'classification input');

  let highRisk = false;
  let anyProtected = false;

  for (const p of changed) {
    const hits = [];
    for (const { re, why } of HIGH_RISK_PATTERNS) {
      if (re.test(p)) { hits.push(why); highRisk = true; }
    }
    const prot = isProtected(p, globs);
    if (prot) { anyProtected = true; hits.push('protected path (protected-paths.json)'); highRisk = true; }
    perPath.push({ path: p, highRisk: hits.length > 0, why: hits });
  }

  if (opts.milestone) { highRisk = true; reasons.push('declared milestone (--milestone)'); }
  if (opts.novel) { highRisk = true; reasons.push('declared novel/greenfield surface (--novel)'); }
  if (anyProtected) reasons.push('touches a protected path');
  for (const pp of perPath) for (const w of pp.why) if (!reasons.includes(w)) reasons.push(w);

  // Light lane: every path recognised as low-risk, nothing high-risk, and small.
  const allLight = changed.length > 0 && changed.every((p) => LIGHT_LANE_PATTERNS.some((re) => re.test(p)));
  const withinFileCap = changed.length <= LIGHT_MAX_FILES;
  const lines = typeof opts.diffLines === 'number' && !Number.isNaN(opts.diffLines) ? opts.diffLines : null;
  // CONFIRMED FINDING (#10): this used to treat a missing line count as
  // "within the cap", which made the documented 150-line LIGHT ceiling
  // optional in exactly the caller that mattered — CI never passed
  // --diff-lines, so any docs-only change of any size took the light lane and
  // skipped both the packet and the independent review. An unknown size is not
  // a small size. Fail toward FULL, consistent with every other unknown here.
  const withinLineCap = lines === null ? false : lines <= LIGHT_MAX_LINES;

  let lane;
  const laneWhy = [];
  if (changed.length === 0) {
    lane = 'FULL';
    laneWhy.push('no changed paths were supplied — refusing to certify an unknown change as trivial');
  } else if (highRisk) {
    lane = 'FULL';
    laneWhy.push('a high-risk signal is present');
  } else if (!allLight) {
    lane = 'FULL';
    laneWhy.push('at least one path is not on the light-lane allow-list');
  } else if (!withinFileCap) {
    lane = 'FULL';
    laneWhy.push(`${changed.length} files exceeds the light-lane cap of ${LIGHT_MAX_FILES}`);
  } else if (lines === null) {
    lane = 'FULL';
    laneWhy.push(`no --diff-lines was supplied, so the ${LIGHT_MAX_LINES}-line light-lane cap could not be checked — an unknown size is not a small size`);
  } else if (!withinLineCap) {
    lane = 'FULL';
    laneWhy.push(`${lines} changed lines exceeds the light-lane cap of ${LIGHT_MAX_LINES}`);
  } else {
    lane = 'LIGHT';
    laneWhy.push(`all paths are on the light-lane allow-list, nothing high-risk, ${changed.length} file(s) and ${lines} line(s) within caps`);
  }

  // Who must review. Copilot is deliberately absent from requiredReviewers: the
  // contract states Copilot comments are not a substitute for a required status
  // check, so it is recorded as advisory. Advisory still BLOCKS on a CRITICAL or
  // HIGH finding — it cannot approve for you, but it can stop you.
  //
  // PROVEN HOLE (PKT-20260825-GOVERNANCE-TRUTH): grok was required only when a
  // high-risk SIGNAL was also present, so an ordinary FULL-lane change — one
  // that reached FULL precisely because nothing here could confidently call it
  // safe — was cleared by a single reviewer. The adversarial pass was strongest
  // exactly where it was skipped: on the changes the classifier could not read.
  // Every FULL lane now requires both, and the set is a frozen constant so the
  // requirement cannot be narrowed by a later conditional.
  const requiredReviewers = lane === 'FULL' ? FULL_LANE_REQUIRED_REVIEWERS.slice() : [];

  // Structural, not advisory. If anyone ever adds copilot to the required set,
  // this throws rather than letting an advisory worker satisfy a required slot.
  for (const r of requiredReviewers) {
    if (ADVISORY_ONLY_REVIEWERS.includes(r)) {
      throw new PolicyError(
        `"${r}" is advisory-only and may never appear in requiredReviewers. ` +
        'An advisory reviewer can block on a CRITICAL/HIGH finding; it can never approve.'
      );
    }
  }

  // The LIGHT lane must actually be cheap or nobody will use it, and a lane
  // nobody uses protects nothing. A genuinely tiny change to an unprotected
  // document needs no task packet and no model review — the deterministic
  // checks are the whole gate. Protected documents and control files never
  // reach here: they are caught as high-risk above and land in FULL.
  const requiresPacket = lane !== 'LIGHT';

  return {
    lane,
    highRisk,
    laneWhy,
    riskReasons: reasons,
    requiredReviewers,
    advisoryReviewers: ['copilot'],
    requiresPacket,
    changed: perPath,
    caps: { maxFiles: LIGHT_MAX_FILES, maxLines: LIGHT_MAX_LINES, filesSeen: changed.length, linesSeen: lines },
  };
}

function cmdClassify(args) {
  // Classify the SUBJECT, never the evidence. When refs are supplied the
  // subject is derived from git; when explicit --changed paths are supplied
  // they are still filtered so a caller cannot accidentally classify its own
  // review records.
  const { subject, diffLines } = subjectAndLines(args, '--classify');
  const r = classify(subject.subjectPaths, { milestone: args.milestone, novel: args.novel, diffLines });
  r.subject = {
    subjectSha256: subject.subjectSha256,
    subjectPaths: subject.subjectPaths,
    excludedAsEvidence: subject.excludedAsEvidence,
  };
  if (args.json) { out(JSON.stringify(r, null, 2)); return EXIT_PASS; }

  out('ENGINEERING OS — CHANGE CLASSIFICATION');
  out('='.repeat(52));
  out(`lane      : ${r.lane}`);
  out(`high-risk : ${r.highRisk ? 'YES' : 'no'}`);
  out(`packet    : ${r.requiresPacket ? 'required' : 'not required for this lane'}`);
  out(`subject   : ${subject.subjectSha256.slice(0, 16)}… (${subject.subjectPaths.length} path(s))`);
  if (subject.excludedAsEvidence.length) {
    out(`excluded  : ${subject.excludedAsEvidence.length} evidence path(s) — not classified, not hashed`);
  }
  out(`reviewers : ${r.requiredReviewers.length ? r.requiredReviewers.join(' + ') + ' (required)' : 'none required — deterministic checks only'}`);
  out(`            copilot (advisory — cannot approve, can block on CRITICAL/HIGH)`);
  out('');
  out('why this lane:');
  for (const w of r.laneWhy) out(`  - ${w}`);
  if (r.riskReasons.length) {
    out('');
    out('risk signals:');
    for (const w of r.riskReasons) out(`  - ${w}`);
  }
  out('');
  out('paths:');
  for (const c of r.changed) out(`  ${c.highRisk ? '!' : ' '} ${c.path}${c.why.length ? '   <- ' + c.why.join('; ') : ''}`);
  return EXIT_PASS;
}

// ── COMMAND: --spec-check ───────────────────────────────────────────────────
// Makes the Notion rule executable. Human product intent may live anywhere, but
// a build packet must say WHICH version of it this build implements. A live URL
// is not a pin: pages change under you and the build silently starts
// implementing something nobody approved.
//
// Convention (reuses the packet's existing sourceOfTruth[] — no schema fork):
//   repo-relative or absolute path  -> PINNED by content hash, computed here
//   "<uri>@<version-or-hash>"       -> PINNED-EXTERNAL, taken at its word
//   "UNVERIFIED: <anything>"        -> UNVERIFIED, allowed but reported
//   anything else that cannot be    -> UNRESOLVED  => BLOCK
//   read and is not marked
function specCheck(packetPath) {
  const packet = readJSON(packetPath);
  const rows = [];
  for (const s of packet.sourceOfTruth || []) {
    if (/^UNVERIFIED:/i.test(s.trim())) {
      rows.push({ source: s, state: 'UNVERIFIED', detail: 'explicitly marked unverified by the packet author' });
      continue;
    }
    const abs = path.isAbsolute(s) ? s : path.join(ROOT, s);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      rows.push({ source: s, state: 'PINNED', detail: `sha256:${sha256(fs.readFileSync(abs))}` });
      continue;
    }
    if (/@[0-9A-Za-z][0-9A-Za-z._:-]*$/.test(s) && /:\/\//.test(s)) {
      rows.push({ source: s, state: 'PINNED-EXTERNAL', detail: 'external source carries an explicit @version/@hash' });
      continue;
    }
    rows.push({
      source: s,
      state: 'UNRESOLVED',
      detail: fs.existsSync(abs)
        ? 'exists but is not a file (directory?) — cannot be hashed, so cannot be pinned'
        : 'not readable here and not pinned with @version and not marked "UNVERIFIED:"',
    });
  }
  const unresolved = rows.filter((r) => r.state === 'UNRESOLVED');
  const unverified = rows.filter((r) => r.state === 'UNVERIFIED');
  return { rows, unresolved, unverified, ok: unresolved.length === 0 };
}

function cmdSpecCheck(args) {
  if (!args.packet) die('usage: --spec-check --packet <packet.json>', EXIT_USAGE);
  if (!fs.existsSync(args.packet)) die(`packet not found: ${args.packet}`, EXIT_USAGE);
  const r = specCheck(args.packet);
  if (args.json) { out(JSON.stringify(r, null, 2)); return r.ok ? EXIT_PASS : EXIT_BLOCK; }

  out('ENGINEERING OS — SPEC PIN CHECK');
  out('='.repeat(52));
  for (const row of r.rows) {
    out(`${row.state.padEnd(16)} ${row.source}`);
    out(`${' '.repeat(16)} ${row.detail}`);
  }
  out('');
  if (r.unverified.length) {
    out(`${r.unverified.length} source(s) marked UNVERIFIED. Allowed — but this build does not`);
    out('get to claim it implements an approved specification for those.');
  }
  if (!r.ok) {
    out('');
    out('SPEC PIN BLOCK');
    out(`  ${r.unresolved.length} source(s) are neither pinnable nor marked UNVERIFIED.`);
    out('  Pin them (a readable path, or "<uri>@<version>") or mark them');
    out('  "UNVERIFIED: <source>" and accept that this build is not spec-governed.');
    return EXIT_BLOCK;
  }
  out('SPEC PIN PASS — every source of truth is pinned or explicitly unverified.');
  return EXIT_PASS;
}

// ── review-record validation ────────────────────────────────────────────────
// A deliberately small draft-07 subset, scoped to THIS schema only.
// packet-tools.cjs has an equivalent validator but exports nothing, and it is
// outside this packet's filesAllowed, so it could not be refactored into a
// shared module here. That is a known, reported duplication rather than a
// hidden one — see the initialization report's gaps section.
function validateAgainst(schema, data, ctx = '#') {
  const errs = [];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    // JSON Schema distinguishes "integer" from "number"; JavaScript does not.
    // Without this, a perfectly valid whole number failed as "expected integer,
    // got number" — a validator rejecting correct data, which is the failure
    // mode that teaches people to bypass validators.
    const actual = data === null ? 'null'
      : Array.isArray(data) ? 'array'
      : (typeof data === 'number' && Number.isInteger(data)) ? 'integer'
      : typeof data;
    const accepted = types.includes(actual) ||
      // an integer satisfies a "number" requirement
      (actual === 'integer' && types.includes('number'));
    if (!accepted) { errs.push(`${ctx}: expected ${types.join('|')}, got ${actual}`); return errs; }
  }
  if (typeof schema.minimum === 'number' && typeof data === 'number' && data < schema.minimum) {
    errs.push(`${ctx}: must be >= ${schema.minimum}, got ${data}`);
  }
  if (schema.enum && !schema.enum.includes(data)) errs.push(`${ctx}: "${data}" is not one of ${schema.enum.join('|')}`);
  if (schema.pattern && typeof data === 'string' && !new RegExp(schema.pattern).test(data)) {
    errs.push(`${ctx}: "${data}" does not match ${schema.pattern}`);
  }
  // minLength / minItems are load-bearing here, not decoration: they are what
  // turn "evidence: ''" and "changedPaths: []" from valid-looking records into
  // refused ones. A validator that silently ignored them would accept an empty
  // review as a complete one.
  if (typeof schema.minLength === 'number' && typeof data === 'string' && data.length < schema.minLength) {
    errs.push(`${ctx}: must be at least ${schema.minLength} character(s) — got ${data.length === 0 ? 'an empty string' : data.length}`);
  }
  if (typeof schema.minItems === 'number' && Array.isArray(data) && data.length < schema.minItems) {
    errs.push(`${ctx}: must have at least ${schema.minItems} item(s) — got ${data.length}`);
  }
  if (schema.required && data && typeof data === 'object' && !Array.isArray(data)) {
    for (const k of schema.required) if (!(k in data)) errs.push(`${ctx}: missing required property "${k}"`);
  }
  if (schema.properties && data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in data) errs.push(...validateAgainst(sub, data[k], `${ctx}/${k}`));
    }
  }
  if (schema.additionalProperties === false && data && typeof data === 'object' && !Array.isArray(data)) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const k of Object.keys(data)) if (!allowed.has(k)) errs.push(`${ctx}: unexpected property "${k}"`);
  }
  if (schema.items && Array.isArray(data)) {
    data.forEach((v, i) => errs.push(...validateAgainst(schema.items, v, `${ctx}[${i}]`)));
  }
  return errs;
}

// Rules the JSON Schema cannot express, but which decide whether a record is
// honest evidence rather than a well-formed shell.
function reviewSemantics(rec) {
  const errs = [];
  if (rec.disposition === 'UNAVAILABLE' && !rec.unavailableReason) {
    errs.push('disposition UNAVAILABLE requires unavailableReason — "it did not run" must say why');
  }
  if (rec.disposition === 'UNAVAILABLE' && (rec.findings || []).length) {
    errs.push('disposition UNAVAILABLE cannot carry findings — a reviewer that did not run cannot have found anything');
  }
  // A record must say WHAT it read. Without changedPaths there is no way to
  // tell a full review from one that glanced at a single file.
  if (!rec.reviewOf || !Array.isArray(rec.reviewOf.changedPaths) || rec.reviewOf.changedPaths.length === 0) {
    if (rec.disposition !== 'UNAVAILABLE') {
      errs.push('reviewOf.changedPaths is required and must be non-empty — a review that cannot say what it read is not evidence');
    }
  }
  for (const [i, f] of (rec.findings || []).entries()) {
    if (typeof f.evidence === 'string' && f.evidence.trim() === '') {
      errs.push(`findings[${i}]: evidence is empty — a finding with no evidence is an opinion`);
    }
    if (f.status === 'DISPUTED' && !f.builderResponse) errs.push(`findings[${i}]: status DISPUTED requires builderResponse`);
    if (f.severity === 'FALSE_POSITIVE' && !f.builderResponse) errs.push(`findings[${i}]: severity FALSE_POSITIVE requires builderResponse`);
    if (f.status === 'ACCEPTED_RISK' && !f.acceptedBy) errs.push(`findings[${i}]: status ACCEPTED_RISK requires acceptedBy (a human — an AI may not accept risk for the Product Owner)`);
    // A CRITICAL/HIGH finding without impact, correction and verification is
    // an alarm with no instructions: it blocks the build and tells nobody how
    // to clear it.
    if (f.severity === 'CRITICAL' || f.severity === 'HIGH') {
      for (const req of ['impact', 'requiredCorrection', 'verificationMethod']) {
        if (!f[req] || String(f[req]).trim() === '') {
          errs.push(`findings[${i}]: ${f.severity} findings require a non-empty ${req}`);
        }
      }
    }
    // FIXED is a claim about work done AFTER the finding was raised. The
    // builder asserting its own fix is exactly the self-approval this system
    // exists to prevent, so FIXED must point at the reviewer record that
    // re-checked it.
    if (f.status === 'FIXED' && !f.verifiedByReviewId) {
      errs.push(`findings[${i}]: status FIXED requires verifiedByReviewId naming a reviewer record that re-verified it. A builder may not mark its own finding fixed.`);
    }
  }
  return errs;
}

function loadReview(p, opts = {}) {
  if (!fs.existsSync(p)) return { path: p, ok: false, errors: [`file not found: ${p}`] };
  let rec;
  try { rec = readJSON(p); } catch (e) { return { path: p, ok: false, errors: [`not valid JSON: ${e.message}`] }; }
  const schema = readJSON(REVIEW_SCHEMA);
  const errors = [...validateAgainst(schema, rec), ...reviewSemantics(rec)];

  // CONFIRMED FINDING #1 (CRITICAL): the gate used to trust any JSON found in
  // reviews/. A builder could write {"reviewer":"codex","disposition":"APPROVE"}
  // and satisfy its own independent-review requirement. Attestation is now
  // verified here, so an unsigned or edited record is not evidence at all.
  //
  // Scope, stated honestly: this is a machine-local HMAC. It detects hand-edited
  // verdicts, records copied between subjects, and fabricated approvals dropped
  // into the directory. It does NOT prove a human approved anything and does not
  // defend against a process that can read the key.
  if (!opts.skipAttestation) {
    try {
      const v = require('./review-sign.cjs').verify(rec, {
        packetPath: opts.packetPath,
        // A canonical aggregate and its active group records share one reviews
        // root. Deriving the directory from the record path preserves that
        // authority for production (`builder-control/reviews/groups`) while
        // allowing isolated fixture roots to exercise the same end-to-end path.
        groupsDir: path.join(path.dirname(path.resolve(p)), 'groups'),
      });
      if (!v.ok || v.gateable === false) errors.push(`${v.code}: ${v.reason}`);
    } catch (e) {
      errors.push(`ATTESTATION-UNVERIFIABLE: ${e.message}`);
    }
  }
  return { path: p, ok: errors.length === 0, errors, rec };
}

function cmdValidateReview(args) {
  const files = args.review.length ? args.review : args._;
  if (!files.length) die('usage: --validate-review <review.json> [more.json ...]', EXIT_USAGE);
  let bad = 0;
  // --packet must reach verification: a record signed against a specific packet
  // can only be checked against that packet. Without this, validating a record
  // whose packet is not resolvable by id reports ATTESTATION-PACKET-MISSING —
  // correct behaviour, but unhelpful when the caller knows exactly which packet
  // it was.
  const results = files.map((f) => loadReview(f, { packetPath: args.packet }));
  if (args.json) {
    out(JSON.stringify(results.map((r) => ({ path: r.path, ok: r.ok, errors: r.errors })), null, 2));
    return results.every((r) => r.ok) ? EXIT_PASS : EXIT_USAGE;
  }
  out('ENGINEERING OS — REVIEW RECORD VALIDATION');
  out('='.repeat(52));
  for (const r of results) {
    if (r.ok) { out(`ok    ${r.path}  (${r.rec.reviewer} / ${r.rec.disposition})`); }
    else { bad++; out(`FAIL  ${r.path}`); for (const e of r.errors) out(`        ${e}`); }
  }
  out('');
  out(bad ? `${bad} invalid record(s).` : `All ${results.length} record(s) valid.`);
  return bad ? EXIT_USAGE : EXIT_PASS;
}

// Gather review records from explicit --review args and from the conventional
// evidence directory, so CI does not have to enumerate them.
function collectReviewPaths(args) {
  const explicit = args.review.slice();
  // A synthetic subject has no conventional evidence directory.
  //
  // reviews/ is resolved from HERE — the control plane's own directory — not
  // from the subject, so it is the SAME directory no matter what subject is
  // being gated. That is correct in production, where the records in it are
  // about the tree the gate just read from git. It is wrong for a synthetic
  // subject, which describes paths that exist in no working tree: those live
  // records are evidence about a real change and a real packet, and pulling
  // them into a fixture run judges them against the fixture's packet, where
  // they read ATTESTATION-PACKET-CHANGED and block a gate they say nothing
  // about. That is not the gate catching something — it is the gate being fed
  // someone else's paperwork.
  //
  // So inside the test-only synthetic boundary, evidence must be named with
  // --review and nothing is discovered implicitly. This cannot loosen
  // production: the boundary needs BOTH the flag and the environment variable
  // (see syntheticAllowed above), neither half is reachable from a CI
  // invocation or a copied command line, and the finding #1 proofs assert that
  // each half alone is a hard block. A production gate run therefore still
  // auto-discovers every record in reviews/ and still fails closed on any one
  // of them that is malformed.
  if (syntheticAllowed(args)) return [...new Set(explicit)];
  const dir = path.join(HERE, 'reviews');
  // Only the top level of reviews/ is evidence. Subdirectories are archives —
  // notably reviews/legacy-unattested/, which holds records produced before
  // attestation existed. Those are history and must not be able to approve or
  // block anything; signing them retroactively would be the builder minting
  // approvals for reviews it did not produce.
  const fromDir = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.json'))
        .map((d) => path.join(dir, d.name))
    : [];
  return [...new Set([...explicit, ...fromDir])];
}

// ── COMMAND: --gate-done ────────────────────────────────────────────────────
// The fail-closed question: given what actually exists on disk, has this change
// earned the right to move forward?
//
// Terminal states are deliberately NOT "DONE". Reviews existing is not the same
// as software being correct, and a word that implies finished invites everyone
// downstream to stop checking.
const STATE_READY_DET = 'READY_FOR_DETERMINISTIC_VALIDATION';
const STATE_READY_PR = 'READY_FOR_PR';

// ── reviewer completeness (PKT-20260825-GOVERNANCE-TRUTH) ───────────────────
// The gate already refused correctly; what it could not do was SAY, in one
// readable shape, what was supposed to happen versus what actually did. A wall
// of ENGOS-* rule names tells a founder that something is wrong and nothing
// about what is missing.
//
// Four words, one row per reviewer:
//   PLANNED   this lane names the reviewer at all
//   REQUIRED  its approval is a condition of the gate (vs ADVISORY)
//   EXECUTED  a review actually ran against the EXACT current subject hash
//   MISSING   nothing bound to this subject exists
//
// EXECUTED is deliberately narrow. A record bound to a different subject hash
// is STALE, never EXECUTED — that is the anti-recycling property, and stating
// it as its own word is what stops "there is a Codex review in the folder"
// from being read as "Codex reviewed this".
//
// `score` is COVERAGE over the exact current subject — how many subject paths
// the record binds to its verdict, out of how many exist. It is UNAVAILABLE when
// no record is bound to this subject, because nothing was measured. There is no
// quality score here: no reviewer emits one, and inventing a number would be
// exactly the fabricated-KPI failure this system exists to prevent.
function buildReviewerCompleteness({ cls, subject, active, foreign }) {
  const subjectPaths = subject.subjectPaths || [];
  const required = cls.requiredReviewers || [];
  const advisory = cls.advisoryReviewers || [];

  const activeBy = new Map();
  for (const r of active) {
    if (!activeBy.has(r.reviewer)) activeBy.set(r.reviewer, []);
    activeBy.get(r.reviewer).push(r);
  }
  const foreignBy = new Map();
  for (const r of foreign) {
    if (!foreignBy.has(r.reviewer)) foreignBy.set(r.reviewer, []);
    foreignBy.get(r.reviewer).push(r);
  }

  // Every reviewer the lane plans for, plus every reviewer that actually left a
  // record. A record from an unplanned reviewer must still be visible — hiding
  // it would make an unexpected verdict disappear.
  const names = [...new Set([...required, ...advisory, ...activeBy.keys(), ...foreignBy.keys()])].sort();

  const rows = names.map((name) => {
    const isRequired = required.includes(name);
    const isAdvisory = advisory.includes(name);
    const planned = isRequired || isAdvisory;
    const recs = activeBy.get(name) || [];
    const stale = (foreignBy.get(name) || []).map((r) => ({
      reviewId: r.reviewId,
      boundToSubject: String((r.reviewOf && r.reviewOf.diffSha256) || 'UNKNOWN'),
    }));

    const row = {
      reviewer: name,
      job: REVIEWER_JOB[name] || 'unclassified reviewer',
      planned: planned ? 'PLANNED' : 'NOT_PLANNED',
      required: isRequired ? 'REQUIRED' : (isAdvisory ? 'ADVISORY' : 'NOT_REQUIRED'),
      executed: 'MISSING',
      disposition: null,
      reviewId: null,
      score: 'UNAVAILABLE',
      coveredPaths: [],
      missingPaths: subjectPaths.slice(),
      stalePaths: [],
      staleRecords: stale,
      reason: '',
    };

    // claude-self is recorded for the audit trail and satisfies nothing. Say so
    // in the row rather than letting a present-looking record read as coverage.
    const selfNote = name === 'claude-self'
      ? ' This is the builder\'s own record: it is kept for the audit trail and satisfies no requirement.'
      : '';

    if (!recs.length) {
      if (stale.length) {
        row.executed = 'STALE';
        row.reason =
          `${name} has ${stale.length} review record(s), but every one of them is bound to a different version of the code ` +
          `(this version is ${subject.subjectSha256.slice(0, 12)}…). The code changed after those reviews, so they do not apply here. ` +
          `Re-run ${name} against the current change.` + selfNote;
      } else {
        row.executed = 'MISSING';
        row.reason = planned
          ? `${name} has not reviewed this change. No record bound to this version of the code exists.` + selfNote
          : `${name} is not part of this lane's plan and has produced no record.`;
      }
      return row;
    }

    if (recs.length > 1) {
      row.executed = 'MISSING';
      row.reason =
        `${name} left ${recs.length} conflicting verdicts for this exact change (${recs.map((r) => r.disposition).join(', ')}). ` +
        'Two verdicts is not one verdict, so none of them counts. One must explicitly supersede the other.' + selfNote;
      return row;
    }

    const rec = recs[0];
    row.disposition = rec.disposition;
    row.reviewId = rec.reviewId;

    const seen = new Set((rec.reviewOf && rec.reviewOf.changedPaths) || []);
    row.coveredPaths = subjectPaths.filter((p) => seen.has(p));
    row.missingPaths = subjectPaths.filter((p) => !seen.has(p));
    row.stalePaths = [...seen].filter((p) => !subjectPaths.includes(p));

    if (rec.disposition === 'UNAVAILABLE') {
      row.executed = 'UNAVAILABLE';
      row.score = 'UNAVAILABLE';
      row.coveredPaths = [];
      row.missingPaths = subjectPaths.slice();
      row.reason =
        `${name} could not be run: ${rec.unavailableReason || 'no reason was recorded'}. ` +
        'That was reported honestly — and it still counts as not reviewed.' + selfNote;
      return row;
    }

    row.executed = 'EXECUTED';
    row.score = `${row.coveredPaths.length}/${subjectPaths.length} subject path(s) covered`;

    const verdictPlain = rec.disposition === 'REJECT'
      ? 'and rejected it'
      : (rec.disposition === 'APPROVE_WITH_NOTES' ? 'and approved it with notes' : 'and approved it');
    if (row.missingPaths.length) {
      row.reason =
        `${name} reviewed this exact version ${verdictPlain}, but its bound evidence covers only ${row.coveredPaths.length} of ${subjectPaths.length} changed file(s). ` +
        `Not covered: ${row.missingPaths.slice(0, 5).join(', ')}${row.missingPaths.length > 5 ? ' …' : ''}. ` +
        'Partial evidence coverage is not approval of the whole change.' + selfNote;
    } else if (row.stalePaths.length) {
      row.reason =
        `${name} reviewed this exact version ${verdictPlain}, but its evidence also claims ${row.stalePaths.length} file(s) ` +
        `that are not part of this change: ${row.stalePaths.slice(0, 5).join(', ')}${row.stalePaths.length > 5 ? ' …' : ''}. ` +
        'The record does not describe this change, so it does not count as coverage of it. ' +
        `Re-run ${name} against this exact change.` + selfNote;
    } else {
      row.reason = `${name}'s bound review evidence covers all ${subjectPaths.length} changed file(s) of this exact version ${verdictPlain}. Coverage proves the subject bound to the verdict, not cognitive completeness.` + selfNote;
    }
    return row;
  });

  // Which subject paths are bound to each REQUIRED review record. A path only
  // counts as covered when EVERY required review record binds it; this is
  // subject/verdict evidence, never a claim to measure cognition.
  const requiredRows = rows.filter((r) => r.required === 'REQUIRED');
  const coveredByAll = subjectPaths.filter((p) =>
    requiredRows.length > 0 && requiredRows.every((r) => r.executed === 'EXECUTED' && r.coveredPaths.includes(p)));
  const notCovered = subjectPaths.filter((p) => !coveredByAll.includes(p));

  // A required reviewer only counts when its record describes THIS change and
  // nothing else: it ran, it covers every changed file, and it claims no file
  // outside the change. Extra paths are not a harmless surplus — a record that
  // covers a wider set than the subject is a record of some other change, and
  // counting it as complete is how a review of the wrong thing reads as done.
  const exactRows = requiredRows.filter((r) =>
    r.executed === 'EXECUTED' && r.missingPaths.length === 0 && r.stalePaths.length === 0);
  const rcComplete = requiredRows.length > 0 && exactRows.length === requiredRows.length;
  const allRequiredApproved = rcComplete && requiredRows.every((row) =>
    row.disposition === 'APPROVE' || row.disposition === 'APPROVE_WITH_NOTES');

  const notExecuted = requiredRows.filter((r) => r.executed !== 'EXECUTED');
  const shortRows = requiredRows.filter((r) => r.executed === 'EXECUTED' && r.missingPaths.length);
  const extraRows = requiredRows.filter((r) => r.executed === 'EXECUTED' && !r.missingPaths.length && r.stalePaths.length);
  const why = [];
  if (!requiredRows.length) why.push('this lane requires no reviewer, so there is no review coverage to be complete');
  if (notExecuted.length) why.push(`${notExecuted.map((r) => r.reviewer).join(' and ')} did not review this exact version of the change`);
  if (shortRows.length) why.push(`${shortRows.map((r) => r.reviewer).join(' and ')} has evidence for only part of the change`);
  if (extraRows.length) {
    why.push(
      `${extraRows.map((r) => r.reviewer).join(' and ')} claims file(s) that are not part of this change ` +
      `(${[...new Set(extraRows.flatMap((r) => r.stalePaths))].slice(0, 5).join(', ')}), so the record describes a different change`);
  }
  const rcCompleteReason = rcComplete
    ? `Every required reviewer (${requiredRows.map((r) => r.reviewer).join(' and ')}) reviewed this exact change and has bound evidence covering all ` +
      `${subjectPaths.length} changed file(s), and no record claims a file outside it. This proves subject coverage, not cognitive completeness.`
    : `Review coverage is INCOMPLETE: ${why.join('; ')}. Re-run the reviewer(s) named above against this exact change.`;

  return {
    subjectSha256: subject.subjectSha256,
    lane: cls.lane,
    planned: rows.filter((r) => r.planned === 'PLANNED').map((r) => r.reviewer),
    required: required.slice(),
    advisory: advisory.slice(),
    executed: rows.filter((r) => r.required === 'REQUIRED' && r.executed === 'EXECUTED').map((r) => r.reviewer),
    missing: rows.filter((r) => r.required === 'REQUIRED' && r.executed !== 'EXECUTED').map((r) => r.reviewer),
    complete: rcComplete,
    completeReason: rcCompleteReason,
    allRequiredApproved,
    approvalReason: allRequiredApproved
      ? `Every required reviewer (${requiredRows.map((r) => r.reviewer).join(' and ')}) recorded APPROVE or APPROVE_WITH_NOTES for this exact change.`
      : `Coverage may be complete, but required reviewer disposition is not unanimous approval (${requiredRows.map((r) => `${r.reviewer}:${r.disposition || r.executed}`).join(', ')}). Advisory REJECT remains visible while structured OPEN CRITICAL/HIGH findings remain the blocking authority.`,
    pathCoverage: {
      total: subjectPaths.length,
      coveredByEveryRequiredReviewer: coveredByAll,
      notCoveredByEveryRequiredReviewer: notCovered,
    },
    rows,
  };
}

function gateDone(args) {
  const problems = [];
  const observed = [];

  // 1. Subject binding is MANDATORY and always enforced. Without it there is
  //    no answer to "reviewed WHAT?", and every downstream check is decoration.
  const { subject, diffLines } = subjectAndLines(args, '--gate-done');
  const claimed = args.subjectSha || args.diffSha || null;
  if (!claimed) {
    problems.push({
      rule: 'ENGOS-NO-SUBJECT-BINDING',
      detail: 'no --subject-sha was supplied. A gate decision with no bound subject certifies nothing. Compute it with `--subject --json` and pass it back.',
    });
  } else if (!/^[0-9a-f]{64}$/.test(claimed)) {
    problems.push({ rule: 'ENGOS-NO-SUBJECT-BINDING', detail: `--subject-sha ${JSON.stringify(claimed)} is not a sha256 hex digest` });
  } else if (claimed !== subject.subjectSha256) {
    problems.push({
      rule: 'ENGOS-SUBJECT-MISMATCH',
      detail: `--subject-sha ${claimed.slice(0, 12)}… does not match the subject computed here (${subject.subjectSha256.slice(0, 12)}…). The tree moved, or the wrong subject was supplied.`,
    });
  } else {
    observed.push(`subject bound: ${subject.subjectSha256.slice(0, 16)}… over ${subject.subjectPaths.length} path(s)`);
  }
  if (subject.excludedAsEvidence.length) {
    observed.push(`${subject.excludedAsEvidence.length} evidence path(s) excluded from the subject — adding review records does not move this hash`);
  }

  // 2. Lane, computed from the SUBJECT only — and, in production, from a line
  //    count git measured over exactly those subject paths.
  const cls = classify(subject.subjectPaths, { milestone: args.milestone, novel: args.novel, diffLines });
  observed.push(`lane ${cls.lane}${cls.highRisk ? ' (high-risk)' : ''}; required reviewers: ${cls.requiredReviewers.join(', ') || 'none'}`);

  // 3. Packet: required for every lane except LIGHT.
  let packetId = null;
  if (cls.requiresPacket) {
    if (!args.packet) {
      problems.push({ rule: 'ENGOS-PACKET-REQUIRED', detail: `lane ${cls.lane} requires a task packet; none was supplied` });
    } else if (!fs.existsSync(args.packet)) {
      problems.push({ rule: 'ENGOS-PACKET-REQUIRED', detail: `packet not found: ${args.packet}` });
    } else {
      const pv = spawnSync('node', [PACKET_TOOLS, '--validate', args.packet], { cwd: ROOT, encoding: 'utf8' });
      if (pv.status !== 0) problems.push({ rule: 'ENGOS-PACKET-INVALID', detail: `packet-tools rejected the packet (exit ${pv.status}). Fix the packet first.` });
      else observed.push('task packet is valid (packet-tools.cjs)');
      try { packetId = readJSON(args.packet).packetId; } catch { /* reported above */ }

      // CONFIRMED FINDING #3: the gate validated the packet's SHAPE but never
      // checked that what actually changed was inside filesAllowed. A packet
      // could authorize five paths while the diff touched fifty, and the gate
      // reported PASS. Authorization is only meaningful if it is compared
      // against the work.
      try {
        const pk = readJSON(args.packet);
        const allowed = pk.filesAllowed || [];
        const outside = subject.subjectPaths.filter((sp2) => !allowed.some((g) => globToRe(g).test(sp2)));
        if (outside.length) {
          problems.push({
            rule: 'ENGOS-PATH-UNAUTHORIZED',
            detail: `${outside.length} changed path(s) are outside the packet's filesAllowed: ${outside.slice(0, 6).join(', ')}${outside.length > 6 ? ' …' : ''}. The packet did not authorize this work.`,
          });
        } else if (subject.subjectPaths.length) {
          observed.push(`all ${subject.subjectPaths.length} subject path(s) are inside the packet's filesAllowed`);
        }
      } catch (e) {
        problems.push({ rule: 'ENGOS-PATH-UNAUTHORIZED', detail: `could not read filesAllowed from the packet: ${e.message}` });
      }

      const sp = specCheck(args.packet);
      if (!sp.ok) problems.push({ rule: 'ENGOS-SPEC-UNPINNED', detail: `${sp.unresolved.length} source(s) of truth are neither pinnable nor marked UNVERIFIED: ${sp.unresolved.map((r) => r.source).join(', ')}` });
      else observed.push(`spec pin: ${sp.rows.length - sp.unverified.length} pinned, ${sp.unverified.length} explicitly UNVERIFIED`);
      var specRows = sp;
    }
  } else {
    observed.push(`lane ${cls.lane}: no task packet required — deterministic checks are the whole gate here`);
  }

  // 4. Load records. Malformed records are errors; they are never skipped.
  const loaded = collectReviewPaths(args).map((rp) => loadReview(rp, { packetPath: args.packet }));
  for (const l of loaded) if (!l.ok) problems.push({ rule: 'ENGOS-REVIEW-MALFORMED', detail: `${l.path}: ${l.errors.join('; ')}` });
  const allValid = loaded.filter((l) => l.ok).map((l) => l.rec);

  // 5. Partition by subject hash BEFORE anything else looks at findings.
  //    A record about a different subject is not "stale evidence to weigh" —
  //    it is evidence about a different thing, and it must not contaminate
  //    this decision in either direction. It cannot approve this change and
  //    its findings cannot block it.
  const bound = [];
  const foreign = [];
  for (const rec of allValid) {
    const sha = rec.reviewOf && rec.reviewOf.diffSha256;
    if (sha === subject.subjectSha256) bound.push(rec);
    else foreign.push(rec);
  }
  if (foreign.length) {
    observed.push(`${foreign.length} review record(s) bound to a different subject were IGNORED (they neither approve nor block this change)`);
  }

  // 6. Supersession — the one documented deterministic replacement rule.
  //    A record may declare `supersedes: <reviewId>`; the named record is
  //    dropped. Anything else that leaves two records for the same reviewer on
  //    the same subject is AMBIGUOUS and blocks, because picking a winner by
  //    timestamp or file order would let whichever record happened to sort
  //    later silently overrule a rejection.
  // CONFIRMED FINDING #4: supersedes was a global Set, so a record from ANY
  // reviewer could retire a record from any other — grok could delete codex's
  // REJECT simply by naming its reviewId. Supersession is a reviewer revising
  // its own verdict, so it is now valid only within the same reviewer, the same
  // subject, and the same packet. Anything else is refused rather than silently
  // honoured.
  const superseded = new Set();
  const byId = new Map(bound.map((r) => [r.reviewId, r]));
  for (const rec of bound) {
    if (!rec.supersedes) continue;
    if (rec.supersedes === rec.reviewId) {
      problems.push({ rule: 'ENGOS-SUPERSEDE-SELF', detail: `${rec.reviewId} declares it supersedes itself.` });
      continue;
    }
    const target = byId.get(rec.supersedes);
    if (!target) {
      problems.push({
        rule: 'ENGOS-SUPERSEDE-UNKNOWN',
        detail: `${rec.reviewId} claims to supersede "${rec.supersedes}", which is not an active record for this subject. A supersession that names nothing retires nothing.`,
      });
      continue;
    }
    if (target.reviewer !== rec.reviewer) {
      problems.push({
        rule: 'ENGOS-SUPERSEDE-CROSS-REVIEWER',
        detail: `${rec.reviewId} (${rec.reviewer}) attempts to supersede ${target.reviewId} (${target.reviewer}). A reviewer may revise only its OWN verdict — otherwise any reviewer could retire another's rejection.`,
      });
      continue;
    }
    if (target.packetId !== rec.packetId) {
      problems.push({
        rule: 'ENGOS-SUPERSEDE-CROSS-PACKET',
        detail: `${rec.reviewId} supersedes a record bound to a different packet (${target.packetId} vs ${rec.packetId}).`,
      });
      continue;
    }
    superseded.add(rec.supersedes);
  }
  const active = bound.filter((r) => !superseded.has(r.reviewId));
  if (superseded.size) observed.push(`${superseded.size} record(s) superseded by an explicit supersedes declaration`);

  const byReviewer = {};
  for (const rec of active) (byReviewer[rec.reviewer] ||= []).push(rec);
  for (const [who, recs] of Object.entries(byReviewer)) {
    if (recs.length > 1) {
      problems.push({
        rule: 'ENGOS-AMBIGUOUS-REVIEWS',
        detail: `${recs.length} active records from "${who}" for this subject (${recs.map((r) => `${r.reviewId}:${r.disposition}`).join(', ')}). Exactly one verdict per reviewer per subject. Resolve by adding "supersedes" to the record that replaces the other.`,
      });
    }
  }

  // 7. Packet binding of records.
  if (packetId) {
    for (const rec of active) {
      if (rec.packetId !== packetId) {
        problems.push({ rule: 'ENGOS-REVIEW-WRONG-PACKET', detail: `${rec.reviewId} is bound to packet ${rec.packetId}, not ${packetId}` });
      }
    }
  }

  // 8. Coverage: a record must bind the WHOLE subject. Subset coverage is the
  //    quiet failure — a verdict covering 3 of 11 files reporting APPROVE
  //    looks identical to one that saw everything.
  const subjectSet = new Set(subject.subjectPaths);
  for (const rec of active) {
    if (rec.disposition === 'UNAVAILABLE') continue;
    const seen = new Set((rec.reviewOf && rec.reviewOf.changedPaths) || []);
    const missing = [...subjectSet].filter((p) => !seen.has(p));
    const extra = [...seen].filter((p) => !subjectSet.has(p));
    if (missing.length) {
      problems.push({
        rule: 'ENGOS-REVIEW-COVERAGE-SHORT',
        detail: `${rec.reviewId} (${rec.reviewer}) did not cover ${missing.length} subject path(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}. Partial coverage is not approval of the whole change.`,
      });
    }
    if (extra.length) {
      problems.push({
        rule: 'ENGOS-REVIEW-COVERAGE-EXTRA',
        detail: `${rec.reviewId} (${rec.reviewer}) claims to have reviewed ${extra.length} path(s) that are not in the subject: ${extra.slice(0, 5).join(', ')}. The record does not describe this change.`,
      });
    }
  }

  // 9. Every required reviewer must complete one exact-subject review. The
  //    finding severity contract is the blocking authority: OPEN CRITICAL/HIGH
  //    findings block in section 10, while MEDIUM/LOW/INFORMATIONAL findings
  //    remain advisory. Treating a model's bare REJECT label as stronger than
  //    its own finding severities created an unbounded review-correction loop.
  if (byReviewer['claude-self']) {
    observed.push('claude-self record present (recorded for traceability; it satisfies no required slot)');
  }
  for (const need of cls.requiredReviewers) {
    const recs = byReviewer[need] || [];
    if (!recs.length) {
      problems.push({ rule: 'ENGOS-REVIEW-MISSING', detail: `${need} is required for lane ${cls.lane}${cls.highRisk ? '/high-risk' : ''} and has no valid review record bound to this subject. Missing evidence is a BLOCK, never an implicit pass.` });
      continue;
    }
    const unavailable = recs.find((r) => r.disposition === 'UNAVAILABLE');
    if (unavailable) {
      problems.push({ rule: 'ENGOS-REVIEWER-UNAVAILABLE', detail: `${need} reported UNAVAILABLE: ${unavailable.unavailableReason}. Reported honestly — and it still blocks, because this lane requires that review.` });
      continue;
    }
    const rejected = recs.find((r) => r.disposition === 'REJECT');
    if (rejected) {
      const hasOpenBlockingFinding = (rejected.findings || []).some((finding) =>
        (finding.severity === 'CRITICAL' || finding.severity === 'HIGH') && finding.status === 'OPEN');
      if (hasOpenBlockingFinding) {
        problems.push({ rule: 'ENGOS-REVIEW-REJECTED', detail: `${need} returned REJECT with an OPEN CRITICAL/HIGH finding (${rejected.reviewId})` });
        continue;
      }
      observed.push(`${need}: REJECT label recorded as nonblocking because it contains no OPEN CRITICAL/HIGH finding`);
      continue;
    }
    observed.push(`${need}: ${recs.map((r) => r.disposition).join(', ')}`);
  }

  // 10. Blocking findings — from ACTIVE, SUBJECT-BOUND records only.
  const blocking = [];
  for (const rec of active) {
    for (const [findingIndex, f] of (rec.findings || []).entries()) {
      if ((f.severity === 'CRITICAL' || f.severity === 'HIGH') && f.status === 'OPEN') {
        blocking.push({ reviewer: rec.reviewer, severity: f.severity, file: f.file || '(unspecified)', problem: f.problem });
      }
      // A FIXED finding must name a re-verifying record that is itself active
      // and bound to this subject, and that reviewer may not be the builder.
      if (f.status === 'FIXED') {
        const v = active.find((r) => r.reviewId === f.verifiedByReviewId);
        if (!v) {
          problems.push({ rule: 'ENGOS-FIX-UNVERIFIED', detail: `${rec.reviewId}: finding marked FIXED cites verifiedByReviewId "${f.verifiedByReviewId}", which is not an active review record for this subject.` });
        } else if (v.reviewer === 'claude-self') {
          problems.push({ rule: 'ENGOS-FIX-SELF-VERIFIED', detail: `${rec.reviewId}: finding marked FIXED is verified only by claude-self (${v.reviewId}). The builder cannot verify its own fix.` });
        } else if (v.reviewId === rec.reviewId || v.reviewer === rec.reviewer) {
          problems.push({
            rule: 'ENGOS-FIX-SELF-VERIFIED',
            detail: `${rec.reviewId}: finding marked FIXED must be re-verified by a different active reviewId and a different reviewer; ${v.reviewId}/${v.reviewer} is not independent of ${rec.reviewId}/${rec.reviewer}.`,
          });
        } else {
          const linked = (v.reverifiedFindings || []).find((proof) =>
            proof.sourceReviewId === rec.reviewId
              && proof.findingIndex === findingIndex
              && proof.outcome === 'PASS'
              && typeof proof.evidence === 'string'
              && proof.evidence.trim() !== ''
              && proof.verificationMethod === f.verificationMethod);
          if (!linked) {
            problems.push({
              rule: 'ENGOS-FIX-VERIFICATION-LINK-MISSING',
              detail: `${rec.reviewId}: finding ${findingIndex} cites ${v.reviewId}, but that verifier carries no signed PASS evidence linked to this exact finding and verification method.`,
            });
          }
        }
      }
    }
  }
  for (const b of blocking) {
    problems.push({ rule: 'ENGOS-OPEN-BLOCKING-FINDING', detail: `${b.severity} from ${b.reviewer} in ${b.file}: ${b.problem}` });
  }

  // 11. Unverified items surfaced, never dropped.
  const unverified = [];
  for (const rec of active) for (const u of rec.unverified || []) unverified.push(`${rec.reviewer}: ${u}`);
  if (typeof specRows !== 'undefined' && specRows) for (const r of specRows.unverified) unverified.push(`spec: ${r.source}`);

  // 12. Deterministic checks. READY_FOR_PR is only reachable when this process
  //     actually executed them — not when a caller asserts they passed.
  let checks = null;
  if (args.runChecks) {
    if (!args.packet) {
      problems.push({ rule: 'ENGOS-CHECKS-NO-PACKET', detail: '--run-checks needs a packet to read testsRequired from' });
    } else if (problems.some((p) => p.rule === 'ENGOS-PACKET-INVALID' || p.rule === 'ENGOS-PACKET-REQUIRED')) {
      // Do not execute commands out of a packet that failed validation. The
      // packet is the authorization record; if it is not valid, nothing it
      // declares has been authorized to run.
      problems.push({ rule: 'ENGOS-CHECKS-NOT-RUN', detail: 'deterministic checks were not executed: the packet failed validation, so its testsRequired carry no authority' });
    } else {
      checks = runDeterministicChecks(args.packet);
      for (const c of checks) if (c.exit !== 0) problems.push({ rule: 'ENGOS-DETERMINISTIC-FAILED', detail: `${c.cmd} exited ${c.exit}` });
      observed.push(`deterministic checks executed here: ${checks.filter((c) => c.exit === 0).length}/${checks.length} passed`);
    }
  }

  // GROK G9 (surfaced inside finding #3's evidence): `checks ? …` treats an
  // EMPTY array as truthy, so a packet with testsRequired: [] reached
  // READY_FOR_PR having executed nothing at all — 0/0 passing read as complete.
  // READY_FOR_PR must mean checks actually ran and passed, so it requires at
  // least one executed check.
  const ranRealChecks = Array.isArray(checks) && checks.length > 0;
  if (Array.isArray(checks) && checks.length === 0) {
    problems.push({
      rule: 'ENGOS-NO-DETERMINISTIC-CHECKS',
      detail: 'the packet declares no runnable testsRequired, so --run-checks executed nothing. Zero checks passing is not evidence; it is the absence of evidence.',
    });
  }
  const ok = problems.length === 0;
  const state = !ok ? 'BLOCKED' : (ranRealChecks ? STATE_READY_PR : STATE_READY_DET);

  // The gate's own decision, re-expressed as a readable completeness table.
  // It DECIDES nothing — `problems` above is still the only thing that blocks.
  // This exists so the answer to "what is missing" is a sentence rather than a
  // rule name, on both the CLI and the dashboard that projects it.
  const reviewerCompleteness = buildReviewerCompleteness({ cls, subject, active, foreign });

  return { ok, state, problems, observed, unverified, classification: cls, subject, reviewerCompleteness, reviewsBound: bound.length, reviewsActive: active.length, reviewsForeign: foreign.length, checks };
}

// Execute the packet's declared testsRequired. These are command strings from a
// packet that has already passed packet-tools validation and the Builder
// Control gate; they are run through `bash -lc` because that is what they are —
// commands. No caller-supplied data is interpolated into them.
function runDeterministicChecks(packetPath) {
  let pkt;
  try { pkt = readJSON(packetPath); } catch { return []; }
  const cmds = (pkt.testsRequired || []).filter((c) => !/--gate-done/.test(c));
  const results = [];
  for (const cmd of cmds) {
    // A blank/whitespace command is `bash -lc ""`, which exits 0 and would be
    // recorded as a passing deterministic check having verified nothing.
    if (typeof cmd !== 'string' || cmd.trim() === '') {
      results.push({ cmd: JSON.stringify(cmd), exit: 1, tail: 'blank testsRequired entry: a whitespace-only command verifies nothing and cannot count as a passing check' });
      continue;
    }
    const r = spawnSync('bash', ['-lc', cmd], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    results.push({ cmd, exit: r.status === null ? 1 : r.status, tail: ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join('\n') });
  }
  return results;
}

function cmdGateDone(args) {
  const r = gateDone(args);
  if (args.json) { out(JSON.stringify(r, null, 2)); return r.ok ? EXIT_PASS : EXIT_BLOCK; }

  out('ENGINEERING OS — GATE');
  out('='.repeat(52));
  out(`lane            : ${r.classification.lane}${r.classification.highRisk ? ' (HIGH-RISK)' : ''}`);
  out(`subject         : ${r.subject.subjectSha256.slice(0, 16)}… (${r.subject.subjectPaths.length} path(s))`);
  out(`required        : ${r.classification.requiredReviewers.join(' + ') || 'none — deterministic checks only'}`);
  out(`review records  : ${r.reviewsActive} active / ${r.reviewsBound} bound / ${r.reviewsForeign} ignored (other subject)`);

  // REVIEWER COMPLETENESS — planned vs required vs executed vs missing, in
  // words. A rule name tells you a rule fired; this tells you what to do.
  const rc = r.reviewerCompleteness;
  if (rc) {
    out('');
    out('REVIEWER COMPLETENESS (against this exact subject):');
    out(`  ${'REVIEWER'.padEnd(12)}${'PLANNED'.padEnd(13)}${'REQUIRED'.padEnd(14)}${'EXECUTED'.padEnd(14)}SCORE`);
    for (const row of rc.rows) {
      out(`  ${row.reviewer.padEnd(12)}${row.planned.padEnd(13)}${row.required.padEnd(14)}${row.executed.padEnd(14)}${row.score}`);
    }
    out('');
    for (const row of rc.rows) out(`  - ${row.reason}`);
    out('');
    out(`  complete                   : ${rc.complete ? 'YES' : 'NO'}`);
    if (rc.completeReason) out(`  ${rc.completeReason}`);
    out('');
    out(`  files changed              : ${rc.pathCoverage.total}`);
    out(`  read by EVERY required rev.: ${rc.pathCoverage.coveredByEveryRequiredReviewer.length}`);
    if (rc.pathCoverage.notCoveredByEveryRequiredReviewer.length) {
      out(`  NOT fully reviewed         : ${rc.pathCoverage.notCoveredByEveryRequiredReviewer.slice(0, 8).join(', ')}${rc.pathCoverage.notCoveredByEveryRequiredReviewer.length > 8 ? ' …' : ''}`);
    }
  }
  out('');
  out('OBSERVED:');
  for (const o of r.observed) out(`  - ${o}`);
  if (r.checks) {
    out('');
    out('DETERMINISTIC CHECKS (executed by this process):');
    for (const c of r.checks) out(`  exit ${String(c.exit).padEnd(3)} ${c.cmd}`);
  }
  if (r.unverified.length) {
    out('');
    out('UNVERIFIED (not failures — things nobody actually checked):');
    for (const u of r.unverified) out(`  - ${u}`);
  }
  out('');
  if (!r.ok) {
    out('RESULT: BLOCKED');
    out('');
    for (const p of r.problems) { out(`  rule   : ${p.rule}`); out(`  reason : ${p.detail}`); out(''); }
    out('No override flag exists here by design. Resolve the rule, or amend the');
    out('packet authorization — which itself leaves a ledger trail.');
    return EXIT_BLOCK;
  }
  out(`RESULT: ${r.state}`);
  out('');
  if (r.state === STATE_READY_DET) {
    out('Required review evidence is present and bound to this subject.');
    out('Deterministic checks were NOT run by this process — run them, or use');
    out('--run-checks, before treating this as ready for a pull request.');
  } else {
    out('Required review evidence is present and bound to this subject, and the');
    out("packet's deterministic checks were executed here and passed.");
  }
  out('');
  out('This is NOT a claim that the software is correct, and NOT a runtime or');
  out('deploy verdict. Runtime validation is a separate step that has not run.');
  return EXIT_PASS;
}
// ── ledger append (reuses the ONE ledger) ───────────────────────────────────
function appendLedger(entry) {
  const tmp = path.join(require('os').tmpdir(), `engos-ledger-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(entry, null, 2));
  const r = spawnSync('node', [LEDGER_WRITER, '--append', tmp], { cwd: ROOT, encoding: 'utf8' });
  try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  return r;
}

// ── COMMAND: --start ────────────────────────────────────────────────────────
// The one command to run when picking up a task. It answers the three questions
// you actually have at the start — what am I changing, how much review does it
// need, and what exactly do I type next — and prints the next commands already
// filled in with this change's real subject hash. Nothing to look up, nothing
// to remember, no prompt to paste.
function cmdStart(args) {
  const { subject, diffLines } = subjectAndLines(args, '--start');
  const cls = classify(subject.subjectPaths, { milestone: args.milestone, novel: args.novel, diffLines });
  const sha = subject.subjectSha256;
  const pkt = args.packet || '<your-packet>.json';
  const runCoordinate = ` --run-id ${args.runId || '<RUN-ID>'}`;
  const refs = (args.base ? ` --base ${args.base}` : '') + (args.head ? ` --head ${args.head}` : '');

  if (args.json) { out(JSON.stringify({ subject, classification: cls }, null, 2)); return EXIT_PASS; }

  out('ENGINEERING OS — START');
  out('='.repeat(60));
  out(`subject     : ${sha}`);
  out(`paths       : ${subject.subjectPaths.length}`);
  for (const p of subject.subjectPaths.slice(0, 12)) out(`              ${p}`);
  if (subject.subjectPaths.length > 12) out(`              … ${subject.subjectPaths.length - 12} more`);
  if (subject.excludedAsEvidence.length) out(`evidence    : ${subject.excludedAsEvidence.length} path(s) excluded from the subject`);
  out('');
  out(`lane        : ${cls.lane}${cls.highRisk ? ' (HIGH-RISK)' : ''}`);
  out(`packet      : ${cls.requiresPacket ? 'REQUIRED' : 'not required'}`);
  out(`reviewers   : ${cls.requiredReviewers.join(' + ') || 'none required'}`);
  out('');
  out('NEXT:');
  if (cls.lane === 'LIGHT') {
    out('  This is the light lane. Run your deterministic checks and open the PR.');
    out('  No packet and no model review are required for a change this small.');
    out('');
    out(`  node builder-control/engineering-os.cjs --gate-done --subject-sha ${sha}${refs}`);
  } else {
    let step = 1;
    if (!args.packet) {
      out(`  ${step++}. Create a task packet naming this work, then re-run --start --packet <p>.`);
      out('     node builder-control/packet-tools.cjs --new --agent claude-code --objective "…"');
    }
    for (const r of cls.requiredReviewers) {
      out(`  ${step++}. Run the ${r} review (read-only, bound to this subject):`);
      out(`     node builder-control/review-adapters.cjs --run --reviewer ${r} \\`);
      out(`       --packet ${pkt}${runCoordinate} --subject-sha ${sha}${refs}${r === 'grok'
        ? ' --allow-metered --approved-by "Marc Papineau" --cap-usd 5'
        : ''}`);
    }
    out(`  ${step++}. Gate it:`);
    out(`     node builder-control/engineering-os.cjs --gate-done --packet ${pkt} \\`);
    out(`       --subject-sha ${sha}${refs} --run-checks`);
  }
  out('');
  out('Reviewer availability on this machine:');
  out('  node builder-control/review-adapters.cjs --doctor');
  return EXIT_PASS;
}

// ── dispatch ────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
let code;

// Every command runs inside this guard. A PolicyError means a rule could not be
// evaluated safely — a missing protected-path policy, an unusable git ref. That
// is a HARD BLOCK (exit 3), never a warning and never a default, because the
// alternative is proceeding while blind to what is protected.
try {
  if (args.start) code = cmdStart(args);
  else if (args.subject) code = cmdSubject(args);
  else if (args.classify) code = cmdClassify(args);
  else if (args['spec-check']) code = cmdSpecCheck(args);
  else if (args['validate-review']) code = cmdValidateReview(args);
  else if (args['gate-done']) code = cmdGateDone(args);
  else {
    process.stderr.write(`
engineering-os.cjs — deterministic half of the AI Engineering OS

  --subject [--base <ref>] [--head <ref>] [--json]
        Compute the SUBJECT of this change: the changed paths minus review
        evidence, and the sha256 every review must bind to.

  --classify [--base <ref>] [--head <ref>] [--milestone] [--novel] [--json]
        Which lane, who must review. Classifies the subject. Fails toward FULL.
        The changed-line count is measured by git over the subject paths.

  --spec-check --packet <packet.json> [--json]
        Is the intent pinned? Exit 3 if a source is neither pinnable nor
        explicitly marked "UNVERIFIED:".

  --validate-review <review.json> [...] [--json]
        Is this record usable evidence?

  --gate-done --subject-sha <sha> [--packet <p>] [--review <r> ...]
              [--base <ref>] [--head <ref>]
              [--run-checks] [--milestone] [--novel] [--json]
        Fail-closed gate. --subject-sha is MANDATORY. Exit 3 on any unmet rule.
        Reaches READY_FOR_DETERMINISTIC_VALIDATION, or READY_FOR_PR when
        --run-checks actually executed the packet's checks here.

WHAT CHANGED IS NOT AN ARGUMENT
  --changed and --diff-lines are a TEST-ONLY facility. Supplying either to any
  command above is a hard block (ENGOS-SYNTHETIC-INPUT-REFUSED) unless BOTH
  --test-only-synthetic-subject is passed AND ENGOS_TEST_ONLY_SYNTHETIC=1 is set
  in the environment. In every other invocation the changed-path set and the
  changed-line count are read from git, so a caller cannot name a smaller change
  than the one it is asking to certify.

Exit: 0 pass · 2 usage/malformed · 3 hard-block
`);
    code = EXIT_USAGE;
  }
} catch (e) {
  if (e instanceof PolicyError) {
    // Name the rule that actually fired. All three fail closed, but "the policy
    // file is unreadable", "you tried to declare your own change" and "that
    // path has two spellings" are three different problems with three different
    // fixes, and collapsing them into one label is how a block gets misread as
    // an environment glitch and worked around.
    const rule = e instanceof SyntheticInputError ? 'ENGOS-SYNTHETIC-INPUT-REFUSED'
      : e instanceof PathAliasError ? 'ENGOS-PATH-NOT-CANONICAL'
      : 'ENGOS-POLICY-UNAVAILABLE';
    process.stderr.write(`
ENGINEERING-OS HARD-BLOCK
  rule:   ${rule}
  reason: ${e.message}

Nothing was evaluated. This fails closed on purpose: a rule that cannot be
read is not a rule that passes.
`);
    code = EXIT_BLOCK;
  } else {
    throw e;
  }
}

if (args.ledger && (args['gate-done'] || args.classify)) {
  const stamp = new Date().toISOString();
  appendLedger({
    entryId: `LED-ENGOS-${stamp.replace(/[^0-9]/g, '').slice(0, 14)}`,
    ts: stamp,
    agentId: 'claude-code',
    gate: 'engineering-os',
    status: code === EXIT_PASS ? 'PASS' : 'BLOCKED',
    notes: `engineering-os exit ${code}`,
  });
}

process.exit(code);
