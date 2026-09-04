#!/usr/bin/env node
/**
 * review-adapters.cjs — read-only bridges from a reviewer tool to a review record.
 *
 * WHAT AN ADAPTER IS ALLOWED TO DO
 * Run a reviewer against the bound subject diff, keep its raw output verbatim,
 * and translate that output into a record conforming to
 * schemas/engineering-review.schema.json.
 *
 * WHAT AN ADAPTER MAY NEVER DO
 * Invent a verdict. Every failure path here — tool missing, tool crashed, tool
 * timed out, output unparseable, output failed schema validation — produces
 * disposition UNAVAILABLE with a concrete reason. There is no code path in this
 * file that emits APPROVE without a reviewer having actually said so, and the
 * gate treats UNAVAILABLE as a block, so a broken adapter stops the build
 * rather than waving it through. That asymmetry is the entire design.
 *
 * READ-ONLY IS ENFORCED AT THE TOOL, NOT REQUESTED IN THE PROMPT
 * Codex runs under `--sandbox read-only`. Grok runs with a single-turn `-p`
 * prompt, a path-scoped Read grant, and every execution/write tool removed.
 * Both are wrapped in an OS filesystem profile. Asking a model nicely not to
 * edit files is not a control.
 *
 *   node builder-control/review-adapters.cjs --doctor [--json]
 *   node builder-control/review-adapters.cjs --run --reviewer codex|grok|copilot \
 *        --subject-sha <sha> --packet <packet.json> [--run-id <RUN-...>] \
 *        [--base <ref>] [--head <ref>] \
 *        [--timeout <seconds>] [--dry-run]
 *
 * Exit: 0 record written (any disposition) · 2 usage · 3 could not produce a record
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const {
  strictEnvironment,
  buildMacSandboxProfile,
  sandboxedCommand,
  assertSandboxOperational,
} = require('./sandbox-containment.cjs');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const REVIEWS_DIR = path.join(HERE, 'reviews');
const RAW_DIR = path.join(HERE, 'review-raw');
const ENGOS = path.join(HERE, 'engineering-os.cjs');
const REVIEW_SANDBOX_PREFIX = path.join(os.tmpdir(), 'aegis-bounded-review-');
const MAX_REVIEW_FILES = 64;
const MAX_REVIEW_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_OUTPUT_BYTES = 64 * 1024 * 1024;
// The complete beta subject plus its five pinned specifications is currently
// just over 1 MiB. Keep the exact-file bundle bounded below the separate 2 MiB
// total-input ceiling while allowing that authoritative twelve-path union.
const MAX_CODEX_BUNDLE_BYTES = 1280 * 1024;
const MAX_CODEX_INPUT_BYTES = 2 * 1024 * 1024;
// Codex CLI rejects an initial input above 1,048,576 JavaScript characters.
// Bytes remain a separate defensive bound because UTF-8 can exceed one byte
// per character.
const MAX_CODEX_INPUT_CHARACTERS = 1_048_576;
const REVIEW_KILL_GRACE_MS = 2_000;
const REVIEW_REAPER_TIMEOUT_MS = 10_000;
const GROK_BILLING_PREFLIGHT_TIMEOUT_MS = 10_000;
const GROK_BILLING_MAX_STREAM_BYTES = 1024 * 1024;
const GROK_EXPECTED_VERSION = 'grok 1.0.5 (5115b46bc909) [stable]';
const GROK_EXPECTED_SHA256 = '3dfa7f04fbb5427a8fbead286591543aaecb478b3a0ab222c4329eca1a3b2f86';
const OPERATOR_GROK_AUTH = path.join(os.homedir(), '.grok', 'auth.json');
const OPERATOR_CODEX_AUTH = path.join(os.homedir(), '.codex', 'auth.json');

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_BLOCK = 3;
const CANONICAL_DATA_CLASSES = Object.freeze(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);

// Absolute, verified install locations. These are recorded rather than
// discovered on PATH because neither tool puts itself on PATH here, and a
// `command -v codex` miss previously led to reporting a tool as absent when it
// was installed all along.
const TOOLS = {
  codex: {
    bin: '/Applications/ChatGPT.app/Contents/Resources/codex',
    label: 'Codex CLI (ChatGPT.app)',
    role: 'independent reviewer',
  },
  grok: {
    // Immutable pin remains separate from the updater-controlled ~/.grok/bin
    // symlink. Version plus digest detects replacement at this exact path.
    bin: '/Users/marcpapineau/.grok/downloads/grok-macos-aarch64',
    label: 'Grok CLI',
    role: 'adversarial red team',
    expectedVersion: GROK_EXPECTED_VERSION,
    expectedSha256: GROK_EXPECTED_SHA256,
  },
  // Copilot IS installed locally — it is a real binary, not a GitHub API call.
  // It is also advisory: it holds no approval authority, and authorizeLaunch()
  // refuses it outright, so no code path can turn it into a gate reviewer.
  copilot: {
    bin: '/opt/homebrew/bin/copilot',
    label: 'GitHub Copilot CLI',
    role: 'repository guardian (advisory — cannot approve)',
    advisoryOnly: true,
  },
};

// ── detection ───────────────────────────────────────────────────────────────
function isExecutable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

// The doctor OBSERVES; it does not INFER. It answers exactly one question per
// worker — is this binary here and can this machine execute it — and reports
// that answer verbatim.
//
// It used to do more, and that was the defect. Copilot was reported from
// `gh auth status`: the doctor ran a DIFFERENT tool, found it authenticated,
// and derived a claim about a third thing's plan entitlement. Every word of
// that derivation could be true and the conclusion still wrong. A probe that
// reasons is a probe that can be wrong in a direction nobody checks, so the
// reasoning is gone and no subprocess is spawned here at all.
//
// What the filesystem cannot show — authentication, entitlement, plan, cost —
// is not guessed at here. It is recorded, dated, in TOOL-CAPABILITY-CANON.json
// by whoever actually observed it, and that is the file the launch path reads
// before it starts anything.
function detect() {
  const result = {};
  for (const [name, t] of Object.entries(TOOLS)) {
    const present = fs.existsSync(t.bin);
    const exec = present && isExecutable(t.bin);
    result[name] = {
      status: exec ? 'AVAILABLE' : 'UNAVAILABLE',
      bin: t.bin,
      label: t.label,
      role: t.role,
      advisoryOnly: t.advisoryOnly === true,
      // Entitlement is a CONSTANT here, not a computation, and that is the
      // point. Install presence is observable for free; so is an OAuth token
      // sitting on disk. Neither proves the account may actually run a review,
      // and the only way to find out is to spend something — which this
      // function must never do. A field that is sometimes derived is a field
      // somebody will eventually derive from the nearest available signal, so
      // there is no derivation to reach for. Copilot's stale reading came from
      // exactly that move: `gh auth status` was present, therefore entitled.
      // Dated entitlement evidence lives in TOOL-CAPABILITY-CANON.json.
      entitlement: 'UNVERIFIED',
      entitlementReason: 'the doctor runs nothing and spends nothing; install presence and authentication presence do not prove a plan entitlement, and no review has been performed here',
      observes: 'filesystem presence and the executable bit — nothing else',
      detail: (exec
        ? 'present and executable at the recorded absolute path; authentication, entitlement and plan are NOT observable here — see TOOL-CAPABILITY-CANON.json for dated evidence'
        : present ? 'present but not executable'
        : 'not found at the recorded absolute path')
        + (t.advisoryOnly === true
          ? '. ADVISORY ONLY: this worker holds no approval authority, is never launched as a gate reviewer, and no record it produces can satisfy a required review'
          : ''),
    };
  }
  return result;
}

function cmdDoctor(args) {
  const d = detect();
  if (args.json) { console.log(JSON.stringify(d, null, 2)); return EXIT_PASS; }
  console.log('ENGINEERING OS — REVIEWER DOCTOR');
  console.log('='.repeat(60));
  for (const [name, r] of Object.entries(d)) {
    console.log(`${r.status.padEnd(12)} ${name}  (${r.role})`);
    console.log(`             ${r.bin}`);
    console.log(`             install: ${r.status}   entitlement: ${r.entitlement}`);
    console.log(`             ${r.detail}`);
  }
  console.log('');
  console.log('AVAILABLE here means ONE thing: the binary exists and this machine can');
  console.log('execute it. It does not mean the tool is authenticated, entitled, paid');
  console.log('for, or that any review has run. This doctor only looks at the');
  console.log('filesystem; it runs nothing and infers nothing.');
  console.log('');
  console.log('Entitlement is therefore reported UNVERIFIED for every worker, including');
  console.log('ones that are installed and logged in. Proving entitlement costs credits;');
  console.log('this command spends none, so it does not get to claim one.');
  console.log('');
  console.log('Whether a worker may actually be launched is decided by');
  console.log('TOOL-CAPABILITY-CANON.json, which carries dated evidence and is read');
  console.log('before every launch. A worker that is executable here and BLOCKED');
  console.log('there does not run.');
  return EXIT_PASS;
}

// ── subject resolution (delegates; does not re-implement) ───────────────────
// Dashboard runs execute in an isolated linked worktree. The runtime is the
// authority that validates that worktree and constructs the Git environment;
// the review bridge must consume that coordinate rather than recomputing a
// second, control-checkout subject that merely happens to have similar paths.
function resolveCanonicalRunContext(runId, packetPath, authority) {
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new Error('canonical run review requires a non-empty --run-id');
  }
  const runAuthority = authority || require('./aegis-run.cjs');
  if (typeof runAuthority.loadRun !== 'function' ||
      typeof runAuthority.canonicalGitEnvironment !== 'function') {
    throw new Error('canonical AEGIS run/worktree authority is unavailable');
  }
  const run = runAuthority.loadRun(runId);
  if (!run || run.runId !== runId) {
    throw new Error(`canonical run authority did not return exactly ${runId}`);
  }
  if (typeof run.packet !== 'string' || !run.packet.trim()) {
    throw new Error(`run ${runId} has no canonical packet coordinate`);
  }
  const suppliedPacket = fs.realpathSync(path.resolve(packetPath));
  const recordedPacket = fs.realpathSync(path.resolve(ROOT, run.packet));
  if (suppliedPacket !== recordedPacket) {
    throw new Error(`--packet does not match run ${runId}'s canonical packet`);
  }
  const gitEnv = runAuthority.canonicalGitEnvironment(run);
  const sourceRoot = fs.realpathSync(path.resolve(run.worktree && run.worktree.path || ''));
  let envWorktree;
  try { envWorktree = fs.realpathSync(gitEnv && gitEnv.GIT_WORK_TREE); }
  catch { throw new Error(`run ${runId} did not produce a readable canonical Git worktree`); }
  if (sourceRoot !== envWorktree || sourceRoot === fs.realpathSync(ROOT)) {
    throw new Error(`run ${runId} did not resolve to one isolated canonical worktree`);
  }
  return Object.freeze({ runId, run: Object.freeze(run), sourceRoot,
    gitEnv: Object.freeze({ ...gitEnv, GIT_WORK_TREE: sourceRoot }) });
}

// A run-bound review inherits sensitivity from the canonical intake record.
// A CLI flag may repeat that value for audit readability, but it may never
// weaken or otherwise replace it. Non-run reviews retain the explicit CLI
// class, with INTERNAL only as the absent-value default.
function resolveReviewDataClass(runContext, cliDataClass) {
  const supplied = cliDataClass === undefined || cliDataClass === null ? null : cliDataClass;
  if (runContext && runContext.runId) {
    const canonical = runContext.run && runContext.run.dataClass;
    if (!CANONICAL_DATA_CLASSES.includes(canonical)) {
      throw new Error(`run ${runContext.runId} has no canonical data class (${JSON.stringify(canonical)})`);
    }
    if (supplied !== null && supplied !== canonical) {
      throw new Error(`--data-class ${JSON.stringify(supplied)} conflicts with run ${runContext.runId}'s canonical ${canonical} data class`);
    }
    return canonical;
  }
  const resolved = supplied === null ? 'INTERNAL' : supplied;
  if (!CANONICAL_DATA_CLASSES.includes(resolved)) {
    throw new Error(`review data class must be one of ${CANONICAL_DATA_CLASSES.join(', ')}; received ${JSON.stringify(resolved)}`);
  }
  return resolved;
}

function subjectOf(args, context = {}) {
  const a = [ENGOS, '--subject', '--json'];
  if (args.packet) a.push('--packet', fs.realpathSync(path.resolve(args.packet)));
  if (args.base) a.push('--base', args.base);
  if (args.head) a.push('--head', args.head);
  const r = spawnSync(process.execPath, a, {
    cwd: ROOT, env: context.gitEnv || strictEnvironment({}, process.env),
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`could not compute subject: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout);
}

function subjectDiff(subject, args, context = {}) {
  const a = ['diff'];
  if (args.base) a.push(`${args.base}..${args.head || 'HEAD'}`);
  else a.push(args.head || 'HEAD');
  a.push('--', ...subject.subjectPaths);
  const r = spawnSync('git', a, {
    cwd: context.sourceRoot || ROOT, env: context.gitEnv || strictEnvironment({}, process.env),
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`could not compute exact subject diff: ${(r.stderr || '').trim()}`);
  if (!r.stdout && Number(subject.diffBytes || 0) > 0 && !(subject.untrackedSubjectPaths || []).length) {
    throw new Error('canonical subject reports changed bytes but Git returned an empty exact diff');
  }
  return r.stdout;
}

// ── prompts ─────────────────────────────────────────────────────────────────
// Bounded on purpose: the requirement, the authoritative paths, the diff, and
// the exact output contract. No conversation history, and — for Codex — no
// account of what the builder believes. A reviewer handed the author's
// justification reviews the justification.
function recordContract(reviewer) {
  const codexProof = reviewer === 'codex'
    ? `,
  "inspectionProofs": [
    {
      "path": "<exact challenged repo-relative path>",
      "lineNumber": <exact challenged 1-based line number>,
      "lineText": "<exact complete UTF-8 text on that line, excluding the newline>"
    }
  ]`
    : '';
  return `
Return ONLY a JSON object, no prose around it, with exactly these fields:
{
  "disposition": "APPROVE" | "APPROVE_WITH_NOTES" | "REJECT",
  "findings": [
    {
      "severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"INFORMATIONAL",
      "file": "<repo-relative path>",
      "location": "<line/range/symbol>",
      "problem": "<what is wrong>",
      "evidence": "<the code, output, or spec line that shows it — REQUIRED, non-empty>",
      "impact": "<what breaks; REQUIRED and non-empty for CRITICAL/HIGH, otherwise empty string allowed>",
      "requiredCorrection": "<what must change; REQUIRED and non-empty for CRITICAL/HIGH, otherwise empty string allowed>",
      "verificationMethod": "<what proves the fix; REQUIRED and non-empty for CRITICAL/HIGH, otherwise empty string allowed>",
      "status": "OPEN"
    }
  ],
  "reverifiedFindings": [
    {
      "sourceReviewId": "<exact prior reviewId>",
      "findingIndex": <zero-based prior finding index>,
      "verificationMethod": "<exact prior verificationMethod>",
      "evidence": "<concrete evidence that the method passed>",
      "outcome": "PASS"
    }
  ],
  "unverified": ["<anything you could not check>"]${codexProof}
}
Every listed field is required, including empty arrays. Extra fields are not
allowed. A malformed object is refused as UNAVAILABLE rather than repaired or
defaulted by the adapter. A finding with no evidence is an opinion — omit it.
Do not manufacture findings to justify the review; zero findings is a valid,
useful result. An OPEN CRITICAL or HIGH finding requires REJECT and blocks the
gate. Use APPROVE_WITH_NOTES for MEDIUM, LOW, or INFORMATIONAL findings when
you otherwise approve. If you return REJECT without an OPEN CRITICAL/HIGH
finding, AEGIS preserves that completed reviewer opinion exactly as written but
treats it as advisory; it does not gain blocking authority beyond the severities
of the structured findings.`;
}

// CONFIRMED FINDING #6: prompts carried only the objective, paths and diff.
// The packet requires reviewers to receive authoritative paths, test evidence
// and explicit unverified items — without them a reviewer cannot tell an
// intentional design from an accident, and cannot know which claims were
// actually checked. The exact bounded files are copied into the private
// read-only review workspace; this block records their verified digests.
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createInvocationIdentity(reviewer, date = new Date(), uuid = crypto.randomUUID()) {
  const stamp = date.toISOString().replace(/[^0-9]/g, '').slice(0, 17);
  const nonce = String(uuid).replace(/[^a-zA-Z0-9-]/g, '');
  if (!stamp || !nonce || !/^[a-z0-9-]+$/.test(reviewer)) throw new Error('invalid review invocation identity');
  const base = `${stamp}-${reviewer}-${nonce}`;
  return Object.freeze({ base, reviewId: `REV-${base}`, ts: date.toISOString() });
}

function writeImmutableFile(target, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.linkSync(temporary, target); // atomic publication which refuses EEXIST
  } finally {
    if (fd !== null && fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function isExecutedCheckReceipt(check) {
  return Boolean(check && String(check.status || '').toUpperCase() === 'EXECUTED'
    && typeof check.cmd === 'string' && check.cmd.trim()
    && Number.isInteger(check.exit)
    && typeof check.ranAt === 'string' && Number.isFinite(Date.parse(check.ranAt)));
}

function runnablePacketChecks(packet) {
  return (Array.isArray(packet && packet.testsRequired) ? packet.testsRequired : []).filter((command) => {
    if (typeof command !== 'string') return false;
    const tokens = command.trim().split(/\s+/);
    const entrypoint = tokens[1] && tokens[1].replace(/^\.\//, '');
    return !(tokens[0] === 'node' && entrypoint === 'builder-control/engineering-os.cjs'
      && tokens.includes('--gate-done'));
  });
}

function runnableHostContainmentChecks(packet) {
  const required = packet && packet.packetId === 'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA';
  if (!Array.isArray(packet && packet.hostContainmentRequired)) {
    if (required) throw new Error('canonical operator-beta packet is missing host containment authority');
    return [];
  }
  const commands = packet.hostContainmentRequired
    .filter((command) => typeof command === 'string' && command.trim());
  if (required && (commands.length !== 1 ||
      commands[0] !== 'node builder-control/test/host-containment.test.cjs')) {
    throw new Error('canonical operator-beta packet has ambiguous host containment authority');
  }
  if (required) {
    const requiredFiles = [
      'builder-control/test/host-containment.test.cjs',
      'builder-control/test/review-adapters.test.cjs',
      'builder-control/test/aegis-run.test.cjs',
    ];
    const filesAllowed = Array.isArray(packet.filesAllowed) ? packet.filesAllowed : [];
    const protectedPaths = packet.authorization && Array.isArray(packet.authorization.allowsProtectedPaths)
      ? packet.authorization.allowsProtectedPaths : [];
    for (const requiredFile of requiredFiles) {
      if (!filesAllowed.includes(requiredFile) || !protectedPaths.includes(requiredFile)) {
        throw new Error(`canonical operator-beta packet does not authorize host containment file ${requiredFile}`);
      }
    }
  }
  return commands;
}

function resolveCanonicalCheckReceipt(packetPath, packet, subject, authority, options = {}) {
  const runAuthority = authority || require('./aegis-run.cjs');
  const expectedRunId = options && options.runId;
  if ((!expectedRunId && typeof runAuthority.listRuns !== 'function') ||
      (expectedRunId && typeof runAuthority.loadRun !== 'function') ||
      typeof runAuthority.loadCanonicalCheckReceipt !== 'function' ||
      typeof runAuthority.loadCanonicalPreHostCheckReceipt !== 'function') {
    throw new Error('canonical AEGIS check-receipt authority is unavailable');
  }
  const packetReal = fs.realpathSync(path.resolve(packetPath));
  if (!packetReal.startsWith(fs.realpathSync(ROOT) + path.sep)) {
    throw new Error('packet path escapes the canonical repository');
  }
  const packetRelative = path.relative(ROOT, packetReal).split(path.sep).join('/');
  const packetSha256 = sha256Hex(fs.readFileSync(packetReal));
  // One canonical narrowing policy, shared with runChecks and the review
  // preflight. A receipt for a dashboard-only subject legitimately carries the
  // focused pair rather than the packet's full list, and weighing it against
  // the full list refused a real, current, all-passed receipt as "found 0".
  // The selector is fixed-policy and subject-derived; an authority that cannot
  // supply it leaves the packet's full requirement standing.
  const commands = typeof runAuthority.dashboardSliceCheckCommands === 'function'
    ? runAuthority.dashboardSliceCheckCommands(packet, subject && subject.changedPaths)
    : runnablePacketChecks(packet);
  const hostCommands = runnableHostContainmentChecks(packet);
  if (!commands.length) throw new Error('packet declares no runnable deterministic checks');
  const expected = { packetPath: packetRelative, packetSha256, subject, commands, hostCommands };
  const candidateRuns = expectedRunId
    ? [runAuthority.loadRun(expectedRunId)]
    : runAuthority.listRuns();
  if (expectedRunId && (!candidateRuns[0] || candidateRuns[0].runId !== expectedRunId)) {
    throw new Error(`canonical run authority did not return exactly ${expectedRunId}`);
  }
  const matches = candidateRuns
    .flatMap((run) => {
      if (!run || !run.checks) return [];
      const bound = { ...expected, runId: run.runId };
      const completeReceipt = runAuthority.loadCanonicalCheckReceipt(run.checks, bound);
      const preHostReceipt = runAuthority.loadCanonicalPreHostCheckReceipt(run.checks, bound);
      const candidates = [];
      if (completeReceipt && completeReceipt.outcome === 'PASS' && completeReceipt.complete === true) {
        candidates.push({ run, receipt: completeReceipt, receiptStage: 'COMPLETE' });
      }
      if (preHostReceipt && preHostReceipt.outcome === 'PASS' && preHostReceipt.complete === true &&
          preHostReceipt.receiptType === 'AEGIS_PRE_HOST_CHECK_RECEIPT_V1' &&
          preHostReceipt.hostContainment && preHostReceipt.hostContainment.state === 'PENDING' &&
          Array.isArray(preHostReceipt.hostContainment.commands) &&
          stableJson(preHostReceipt.hostContainment.commands) === stableJson(hostCommands)) {
        candidates.push({ run, receipt: preHostReceipt, receiptStage: 'PRE_HOST' });
      }
      return candidates;
    });
  if (!matches.length) {
    throw new Error(`expected a canonical subject-bound PASS or pre-host snapshot PASS check receipt${expectedRunId ? ` for ${expectedRunId}` : ''}; found 0`);
  }

  // Legacy control-checkout reviews did not carry --run-id. They remain safe
  // only when the canonical evidence identifies one and only one run. Choosing
  // the newest of several matching runs would silently detach a reviewer from
  // the objective/worktree whose lifecycle the operator is controlling.
  const matchingRunIds = [...new Set(matches.map((entry) => entry.run.runId))];
  if (!expectedRunId && matchingRunIds.length !== 1) {
    throw new Error(`ambiguous canonical receipt coordinate across ${matchingRunIds.length} runs; provide --run-id`);
  }

  // Re-running the same deterministic checks for an unchanged subject creates
  // another independently valid receipt; it does not invalidate the earlier
  // evidence. Bind the latest completed receipt. The remaining keys provide a
  // stable order for equal timestamps so listRuns() enumeration order can
  // never change which receipt a reviewer receives.
  matches.sort((left, right) => {
    const completed = Date.parse(right.receipt.completedAt) - Date.parse(left.receipt.completedAt);
    if (completed) return completed;
    const started = Date.parse(right.receipt.startedAt) - Date.parse(left.receipt.startedAt);
    if (started) return started;
    if (right.receiptStage !== left.receiptStage) {
      return right.receiptStage === 'COMPLETE' ? 1 : -1;
    }
    const rightRunId = String(right.run.runId);
    const leftRunId = String(left.run.runId);
    const runId = rightRunId < leftRunId ? -1 : rightRunId > leftRunId ? 1 : 0;
    if (runId) return runId;
    const rightDigest = String(right.receipt.receiptSha256);
    const leftDigest = String(left.receipt.receiptSha256);
    return rightDigest < leftDigest ? -1 : rightDigest > leftDigest ? 1 : 0;
  });
  const selected = matches[0];
  return Object.freeze({ runId: selected.run.runId, receipt: selected.receipt,
    receiptStage: selected.receiptStage,
    packetPath: packetRelative, packetSha256, commands: Object.freeze(commands.slice()),
    hostCommands: Object.freeze(hostCommands.slice()),
    selection: Object.freeze({
      rule: expectedRunId
        ? 'explicit-run-id-then-latest-valid-complete-stage-receipt'
        : 'unique-run-then-latest-valid-complete-stage-receipt',
      candidateCount: matches.length,
    }) });
}

function evidenceBlock(ctx) {
  if (!ctx) return '';
  const lines = [];
  if (ctx.checkReceipt) {
    lines.push('', 'CANONICAL SUBJECT-BOUND CHECK RECEIPT (validated before reviewer launch):');
    lines.push(`  ${stableJson(ctx.checkReceipt)}`);
  }
  if (ctx.specs && ctx.specs.length) {
    lines.push('', 'PINNED SPECIFICATIONS (authoritative intent, available read-only in the review workspace):');
    for (const sp of ctx.specs) lines.push(`  ${sp.path}  sha256:${sp.sha.slice(0, 16)}…`);
  }
  if (ctx.checks && ctx.checks.length) {
    const declaredOnly = ctx.checks.filter((check) =>
      String(check && check.status || '').toUpperCase() === 'DECLARED_ONLY');
    const executed = ctx.checks.filter(isExecutedCheckReceipt);
    const nonExecuted = ctx.checks.filter((check) =>
      String(check && check.status || '').toUpperCase() !== 'DECLARED_ONLY'
      && !isExecutedCheckReceipt(check));
    // Preserve the complete caller-supplied evidence object. Reducing a check
    // to only command + exit silently discarded output/digest/receipt fields
    // that distinguish an observed run from a packet declaration.
    if (executed.length) {
      lines.push('', 'DETERMINISTIC EVIDENCE (executed receipts supplied for this subject):');
      for (const check of executed) lines.push(`  ${stableJson(check)}`);
      lines.push('', 'Treat a passing check as evidence that the command ran, NOT that the');
      lines.push('requirement is met. If a test passes but a user would still see wrong');
      lines.push('behaviour, that is exactly the finding worth reporting.');
    }
    if (declaredOnly.length) {
      lines.push('', 'DECLARED CHECK REQUIREMENTS (not executed evidence; no run receipt was supplied):');
      for (const check of declaredOnly) lines.push(`  ${stableJson(check)}`);
    }
    if (nonExecuted.length) {
      lines.push('', 'NON-EXECUTED CHECK STATUS (not execution evidence; receipt shape is absent or incomplete):');
      for (const check of nonExecuted) lines.push(`  ${stableJson(check)}`);
    }
  }
  if (ctx.unverified && ctx.unverified.length) {
    lines.push('', 'EXPLICITLY UNVERIFIED (nobody checked these — do not assume either way):');
    for (const u of ctx.unverified) lines.push(`  - ${u}`);
  }
  if (ctx.priorFindings && ctx.priorFindings.length) {
    // A prior finding is only an unresolved attack target when current-state
    // proof binds it to THIS subject and THIS check receipt. Everything else
    // is history and is labelled as history, never as a live defect.
    const targets = ctx.priorFindings.filter((finding) =>
      isCurrentOpenReverificationTarget(finding, ctx.checkReceipt));
    const historical = ctx.priorFindings.filter((finding) =>
      !isCurrentOpenReverificationTarget(finding, ctx.checkReceipt));
    if (targets.length) {
      lines.push('', 'PRIOR FINDINGS ELIGIBLE FOR INDEPENDENT RE-VERIFICATION:');
      lines.push('Each entry below is bound by the current-state proof map to this exact');
      lines.push('subject SHA-256 and this deterministic-check receipt, and is classified');
      lines.push('OPEN against the current subject. Return a reverifiedFindings PASS only');
      lines.push('when you independently applied the exact verificationMethod and concrete');
      lines.push('evidence proves it passed. Omit same-reviewer findings and anything you');
      lines.push('did not actually verify.');
      for (const finding of targets) lines.push(`  ${stableJson(finding)}`);
    }
    if (historical.length) {
      lines.push('', 'HISTORICAL FINDING CONTEXT (NOT CURRENT DEFECTS — DO NOT TREAT AS UNRESOLVED):');
      lines.push('These findings were recorded against a DIFFERENT subject hash. Their OPEN');
      lines.push('status is what an older receipt said; no current-state proof binds any of');
      lines.push('them to the frozen subject and its deterministic-check receipt, so none of');
      lines.push('them is evidence that the current subject is defective. Each entry carries');
      lines.push('its deterministic classification and the reason it is not a current target.');
      lines.push('They are audit context only. Do not report one as a current defect and do');
      lines.push('not return one in reverifiedFindings. If the frozen subject itself shows');
      lines.push('the defect, report it as a new finding on your own current evidence.');
      for (const finding of historical) lines.push(`  ${stableJson(finding)}`);
    }
  }
  return lines.join('\n');
}

function codexPrompt(objective, subject, diff, ctx) {
  return `You are an independent senior technical lead reviewing a change.

Do not assume the implementation is correct. Independently determine what
correct behaviour should be from the stated objective, then inspect what was
actually written. The exact bounded subject and specifications are available
read-only at the listed repository-relative paths in the isolated workspace.
Read only those paths. Do not inspect parent directories or unrelated files.

The adapter appends a complete, length- and digest-bound copy of every listed
subject and pinned specification to this same initial stdin message. It also
appends one deterministic line challenge per file. Return every exact challenged
line in inspectionProofs. The adapter independently verifies those responses
against its retained copied bytes; stdin delivery alone is never file coverage.
Use the appended contents as the authoritative review input and do not claim
coverage from filesystem commands.

OBJECTIVE (from the approved task packet):
${objective}

SUBJECT PATHS (${subject.subjectPaths.length}):
${subject.subjectPaths.map((p) => '  ' + p).join('\n')}

Look for: architectural drift, incomplete functionality, regression, duplicated
logic, state and concurrency errors, API/contract violations, auth mistakes,
security problems, missing validation, edge cases, mock or hardcoded data,
misleading tests, deleted functionality.

${evidenceBlock(ctx)}

EXACT CHANGE COORDINATES:
  subject SHA-256: ${subject.subjectSha256 || 'UNAVAILABLE'}
  range: ${subject.range || 'UNAVAILABLE'}
  diff bytes: ${Number.isInteger(subject.diffBytes) ? subject.diffBytes : Buffer.byteLength(String(diff || ''), 'utf8')}

The diff text is deliberately not duplicated here. The digest-bound exact file
bundle appended below is the authoritative subject and preserves every subject
and specification byte while keeping the initial input within the CLI limit.
${recordContract('codex')}`;
}

function grokPrompt(objective, subject, diff, ctx) {
  return `You are the final adversarial reviewer. Assume this change contains a
serious flaw that previous engineers missed, and try to prove it incorrect.

The exact bounded subject and specifications are available read-only at the
listed repository-relative paths in the isolated workspace. Read only those
paths. Do not inspect parent directories or unrelated files.

MANDATORY EVIDENCE SEQUENCE:
1. Before emitting any verdict, invoke the Read tool for EVERY SUBJECT PATH and
   EVERY PINNED SPECIFICATION path listed below.
2. Read EVERY file completely. If Read paginates, continue with additional
   offsets until every line has been returned. The adapter reconstructs each
   file from native receipts and verifies its byte count and SHA-256; a first
   page or ranges containing any gap are recorded as incomplete coverage.
3. Complete those reads and inspect the relevant implementation and tests.
4. Only then emit the final JSON review record.

Do not emit a "pending", "starting", "in progress", or other placeholder
verdict while reads remain. If an authorized read fails, name the exact failed
path in unverified and finish with only evidence you actually inspected.

Attack: requirement interpretation, edge cases, regression paths, authorization,
security, data integrity, state, concurrency, error paths, dependency
assumptions, and the tests themselves. Specifically hunt for cases where the
tests PASS but a user still experiences wrong behaviour.

Do not invent theoretical criticism without evidence.

OBJECTIVE:
${objective}

SUBJECT PATHS (${subject.subjectPaths.length}):
${subject.subjectPaths.map((p) => '  ' + p).join('\n')}

${evidenceBlock(ctx)}

EXACT CHANGE COORDINATES:
  subject SHA-256: ${subject.subjectSha256 || 'UNAVAILABLE'}
  range: ${subject.range || 'UNAVAILABLE'}
  diff bytes: ${Number.isInteger(subject.diffBytes) ? subject.diffBytes : Buffer.byteLength(String(diff || ''), 'utf8')}

The diff is deliberately not placed in argv. The reviewer must inspect the
digest-bound copied files above; this prevents a large subject from exceeding
the operating-system argument limit before the governed process starts.
${recordContract('grok')}`;
}

// ── current-state proof map (BUILD-PROTOCOL §9A) ────────────────────────────
// A finding recorded OPEN against a DIFFERENT subject hash is history, not a
// current defect. Its receipt says OPEN because nobody re-ran it against this
// subject — not because this subject is broken. Presenting it as an unresolved
// attack target is exactly how a stale allegation re-enters a review that
// already has current-hash executable proof elsewhere. A carried-forward
// finding is a current OPEN target only when an explicit current-state proof
// map binds it to THIS subject SHA-256 and THIS deterministic-check receipt
// and classifies it OPEN. No map means no current OPEN: absent proof, history
// stays history. Nothing is deleted — every candidate is still emitted with
// its classification and a deterministic reason, so the record stays auditable
// and no reviewer is told a finding was fixed without proof that it was.
const CURRENT_STATE_CLASSIFICATIONS = Object.freeze(
  ['OPEN', 'CURRENTLY_PROVEN_FIXED', 'SUPERSEDED', 'OUT_OF_SCOPE']);
const UNCLASSIFIED_HISTORICAL = 'UNCLASSIFIED_HISTORICAL';
const NO_MAP_REASON = 'no current-state proof map was supplied for this subject; the prior OPEN status is historical only and is not evidence about the current subject';
const UNMAPPED_REASON = 'the current-state proof map for this subject does not classify this finding; the prior OPEN status is historical only';
const MAX_PRIOR_FINDINGS = 32;

function priorFindingKey(sourceReviewId, findingIndex) {
  return `${sourceReviewId}:${findingIndex}`;
}

// True only for an entry that a current-state proof map bound to this subject
// and check receipt and classified OPEN. Legacy entries carrying no
// classification at all are historical by default — that is the fail-closed
// direction: an unclassified finding is never promoted to a live target.
function isCurrentOpenReverificationTarget(finding, checkReceipt) {
  if (!finding || finding.classification !== 'OPEN') return false;
  const binding = finding.currentStateBinding;
  if (!binding || typeof binding.subjectSha256 !== 'string' || !binding.subjectSha256
    || typeof binding.checkReceiptSha256 !== 'string' || !binding.checkReceiptSha256) return false;
  // Defence in depth: a target must still match the receipt actually shipped in
  // this prompt, not the one the map was written against.
  if (checkReceipt && typeof checkReceipt.receiptSha256 === 'string'
    && checkReceipt.receiptSha256 !== binding.checkReceiptSha256) return false;
  return true;
}

// A supplied map that does not bind to this subject is an operator error, not
// a reason to guess. It throws, and the caller refuses the review; only an
// absent map degrades quietly to "everything is history".
function loadCurrentStateProofMap(source, { subjectSha256, checkReceiptSha256 }) {
  if (source === null || source === undefined) return null;
  let map = source;
  if (typeof source === 'string') {
    const mapPath = path.resolve(source);
    let raw;
    try { raw = fs.readFileSync(mapPath, 'utf8'); }
    catch (error) {
      throw new Error(`current-state proof map is unreadable at ${mapPath}: ${error.message}`);
    }
    try { map = JSON.parse(raw); }
    catch (error) {
      throw new Error(`current-state proof map is not valid JSON at ${mapPath}: ${error.message}`);
    }
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error('current-state proof map must be a JSON object');
  }
  if (map.subjectSha256 !== subjectSha256) {
    throw new Error(`current-state proof map is bound to subject ${map.subjectSha256 || 'UNSPECIFIED'}, not the frozen subject ${subjectSha256}`);
  }
  if (typeof checkReceiptSha256 !== 'string' || !checkReceiptSha256) {
    throw new Error('current-state proof map cannot be honoured without the current deterministic-check receipt digest');
  }
  if (map.checkReceiptSha256 !== checkReceiptSha256) {
    throw new Error(`current-state proof map is bound to check receipt ${map.checkReceiptSha256 || 'UNSPECIFIED'}, not the current receipt ${checkReceiptSha256}`);
  }
  if (!Array.isArray(map.entries)) {
    throw new Error('current-state proof map must carry an entries array');
  }
  const byKey = new Map();
  for (const [index, entry] of map.entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`current-state proof map entry ${index} is not an object`);
    }
    if (typeof entry.sourceReviewId !== 'string' || !entry.sourceReviewId.trim()) {
      throw new Error(`current-state proof map entry ${index} has no sourceReviewId`);
    }
    if (!Number.isInteger(entry.findingIndex) || entry.findingIndex < 0) {
      throw new Error(`current-state proof map entry ${index} has no integer findingIndex`);
    }
    if (!CURRENT_STATE_CLASSIFICATIONS.includes(entry.classification)) {
      throw new Error(`current-state proof map entry ${index} classification ${stableJson(entry.classification)} is not one of ${CURRENT_STATE_CLASSIFICATIONS.join(', ')}`);
    }
    const proof = entry.currentProof;
    if (entry.classification === 'OPEN'
      && (!proof || typeof proof !== 'object' || Array.isArray(proof)
        || typeof proof.command !== 'string' || !proof.command.trim()
        || typeof proof.result !== 'string' || !proof.result.trim())) {
      throw new Error(`current-state proof map entry ${index} classifies OPEN without a currentProof command and result against the current subject`);
    }
    const key = priorFindingKey(entry.sourceReviewId, entry.findingIndex);
    if (byKey.has(key)) {
      throw new Error(`current-state proof map classifies ${key} more than once`);
    }
    byKey.set(key, Object.freeze({
      classification: entry.classification,
      currentProof: proof && typeof proof === 'object' && !Array.isArray(proof)
        ? Object.freeze({ ...proof }) : null,
      rationale: typeof entry.rationale === 'string' && entry.rationale.trim()
        ? entry.rationale.trim() : null,
    }));
  }
  return Object.freeze({ subjectSha256, checkReceiptSha256, byKey });
}

function eligiblePriorFindings(packetPath, packetId, currentSubjectSha, reviewer, reviewsDir = REVIEWS_DIR,
  currentState = {}) {
  const reviewCycle = require('./review-cycle.cjs');
  const canonicalValidator = require('./engineering-os.cjs').loadReview;
  const loaded = reviewCycle.loadRecords(reviewsDir, {
    validateReview: canonicalValidator,
    packetPath,
    packetId,
  });
  if (loaded.problems.length) {
    throw new Error(`prior review evidence is invalid: ${loaded.problems.map((p) => `${p.code} ${path.basename(p.file)}: ${p.detail}`).join('; ')}`);
  }
  const checkReceiptSha256 = typeof currentState.checkReceiptSha256 === 'string'
    ? currentState.checkReceiptSha256 : null;
  const proofMap = loadCurrentStateProofMap(
    currentState.proofMap === undefined ? null : currentState.proofMap,
    { subjectSha256: currentSubjectSha, checkReceiptSha256 });
  const liveRecords = liveReviewRecords(loaded.records, packetId);
  const eligible = [];
  for (const record of liveRecords) {
    if (!record.reviewOf || record.reviewOf.diffSha256 === currentSubjectSha) continue;
    if (record.reviewer === reviewer || record.reviewer === 'claude-self') continue;
    for (const [findingIndex, finding] of (record.findings || []).entries()) {
      if (finding.status !== 'OPEN' || typeof finding.verificationMethod !== 'string'
        || !finding.verificationMethod.trim()) continue;
      const mapped = proofMap
        ? proofMap.byKey.get(priorFindingKey(record.reviewId, findingIndex)) || null
        : null;
      const classification = mapped ? mapped.classification : UNCLASSIFIED_HISTORICAL;
      eligible.push({
        sourceReviewId: record.reviewId,
        findingIndex,
        reviewer: record.reviewer,
        severity: finding.severity,
        file: finding.file || null,
        problem: finding.problem,
        verificationMethod: finding.verificationMethod,
        // Auditability: what the old receipt said, which subject said it, how
        // this subject classifies it now, and why.
        priorStatus: finding.status,
        priorSubjectSha256: record.reviewOf.diffSha256,
        classification,
        classificationReason: mapped
          ? (mapped.rationale
            || `the current-state proof map bound to this subject classifies this finding ${classification}`)
          : (proofMap ? UNMAPPED_REASON : NO_MAP_REASON),
        currentStateBinding: mapped
          ? { subjectSha256: currentSubjectSha, checkReceiptSha256 }
          : null,
        currentProof: mapped ? mapped.currentProof : null,
      });
    }
  }
  // Proven current OPEN targets keep their slots first. The old tail-slice
  // could silently drop the one finding that is actually unresolved on this
  // subject in favour of stale history.
  const targets = eligible.filter((entry) => entry.classification === 'OPEN')
    .slice(-MAX_PRIOR_FINDINGS);
  const historical = eligible.filter((entry) => entry.classification !== 'OPEN');
  const room = MAX_PRIOR_FINDINGS - targets.length;
  return targets.concat(room > 0 ? historical.slice(-room) : []);
}

function liveReviewRecords(records, packetId) {
  const reviewCycle = require('./review-cycle.cjs');
  const resolution = reviewCycle.resolveSupersessions(records, packetId);
  if (resolution.problems.length) {
    throw new Error(`prior review supersession evidence is invalid: ${resolution.problems.join('; ')}`);
  }
  return resolution.mine.filter((record) =>
    !resolution.superseded.has(record.reviewId));
}

function reviewCycleLaunchDecision({ records, packetId, requiredReviewers, currentSubjectSha, reviewer }) {
  const reviewCycle = require('./review-cycle.cjs');
  const cycle = reviewCycle.analyze({ records, packetId, requiredReviewers, currentSubjectSha });
  if (cycle.verdict !== 'PROCEED') {
    const rules = cycle.reasons.map((reason) => `${reason.rule}: ${reason.detail}`).join(' ');
    return Object.freeze({ ok: false, cycle,
      reason: `${cycle.verdict}: ${rules || 'D-14 review-cycle limit reached; no further reviewer launch is permitted'}` });
  }
  if (!cycle.allowedReviewers.includes(reviewer)) {
    return Object.freeze({ ok: false, cycle,
      reason: `reviewer ${reviewer} is not pending for this subject; allowed reviewers: ${cycle.allowedReviewers.join(', ') || 'none'}` });
  }
  return Object.freeze({ ok: true, cycle, reason: null });
}

// ── raw output -> record ────────────────────────────────────────────────────
// Extract the first balanced JSON object. Models wrap JSON in prose and fences
// no matter how firmly the contract says not to; that is a formatting quirk,
// not a reason to discard a real review.
//
// PROVEN DEFECT (2026-08-25): several CLIs return an ENVELOPE — {text,
// stopReason, usage, num_turns} — with the model's actual answer inside `text`.
// extractJson returned the envelope, isUsableReview saw no `disposition` on it,
// and the run was recorded UNAVAILABLE. A genuine REJECT sitting in `text` was
// thrown away, and the reviewer was blamed for "producing no parseable JSON"
// three separate times. The envelope is now unwrapped before giving up.
// Fields a CLI envelope uses to carry the model's own output.
const ENVELOPE_TEXT_FIELDS = ['text', 'output', 'result', 'response', 'content', 'message', 'last_message'];

function topLevelJsonObjects(text) {
  if (typeof text !== 'string') return null;
  const objs = [];
  for (let k = 0; k < text.length; k++) {
    if (text[k] !== '{') continue;
    let depth = 0, inStr = false, esc = false, closed = -1;
    for (let i = k; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { closed = i; break; } }
    }
    if (closed === -1) break;              // unterminated tail — stop scanning
    try { objs.push(JSON.parse(text.slice(k, closed + 1))); } catch { /* not JSON */ }
    k = closed;                            // continue after this object
  }
  return objs;
}

function extractJson(text, unwrapDepth = 0) {
  // Verdict parsing is deliberately separate from terminal metadata parsing.
  // A schema-valid structuredOutput can exist inside a cancelled/max-turns
  // envelope, so selecting the verdict must never erase how the tool ended.
  const objs = topLevelJsonObjects(text);
  if (!objs) return null;
  if (!objs.length) return null;

  // PROVEN DEFECT (2026-08-25): --json-schema makes the model emit a
  // schema-conforming object on EVERY turn, so the payload holds several
  // verdicts. Taking the FIRST returned the turn-1 placeholder — a REJECT with
  // zero findings and unverified:["reading the full review prompt"] — while the
  // real verdict with five HIGH findings sat later in the same string. That is
  // the most dangerous failure in this family: unlike a timeout it produces a
  // PLAUSIBLE record, so it reads as a completed review that found nothing.
  //
  // Order of preference:
  //   1. the envelope's structuredOutput — the tool's own authoritative result
  //   2. the LAST conforming object — the model's final word, not its first
  //   3. the last object of any shape, so a caller can still inspect an envelope
  // A tool may emit more than one envelope while it works. The final envelope
  // is authoritative in the same way the final plain verdict below is: an
  // earlier planning/placeholder approval must never outrank a later rejection.
  // Walk backwards so the two representations share one ordering rule.
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (o && typeof o === 'object' && o.structuredOutput) {
      const so = typeof o.structuredOutput === 'string'
        ? extractJson(o.structuredOutput, unwrapDepth + 1)
        : o.structuredOutput;
      if (so && typeof so.disposition === 'string') return so;
    }
  }
  for (let i = objs.length - 1; i >= 0; i--) {
    if (objs[i] && typeof objs[i].disposition === 'string') return objs[i];
  }
  if (unwrapDepth === 0) {
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (!o || typeof o !== 'object') continue;
      // `codex exec --json` carries the final answer in an item.completed
      // event rather than in a top-level text field.
      if (o.type === 'item.completed' && o.item && o.item.type === 'agent_message' &&
          typeof o.item.text === 'string') {
        const inner = extractJson(o.item.text, unwrapDepth + 1);
        if (inner && typeof inner.disposition === 'string') return inner;
      }
      for (const f of ENVELOPE_TEXT_FIELDS) {
        if (typeof o[f] === 'string') {
          const inner = extractJson(o[f], unwrapDepth + 1);
          if (inner && typeof inner.disposition === 'string') return inner;
        }
      }
    }
  }
  return objs[objs.length - 1];
}

// Grok's ordinary JSON output preserves only the final answer. That is not
// enough for a gate reviewer: a model can say it read every bounded file even
// when no read_file call occurred. streaming-json preserves the native ACP
// tool_call/tool_call_update receipts, while text chunks remain the only place
// a reviewer verdict is allowed to originate.
function grokStreamEvents(rawText) {
  if (typeof rawText !== 'string') return [];
  const events = [];
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event && typeof event === 'object' && typeof event.type === 'string') events.push(event);
    } catch { /* stderr and partial lines are not ACP receipts */ }
  }
  return events;
}

function authoritativeGrokSpend(rawText, capUsd) {
  const cap = Number(capUsd);
  if (!Number.isFinite(cap) || cap <= 0) {
    return Object.freeze({ ok: false,
      reason: 'Grok post-run telemetry comparison requires a positive finite authorized telemetry ceiling' });
  }
  const events = grokStreamEvents(rawText);
  const terminals = events.filter((event) => event.type === 'end');
  if (terminals.length !== 1 || terminals[0].stopReason !== 'end_turn'
      || events[events.length - 1] !== terminals[0]) {
    return Object.freeze({ ok: false, telemetryCeilingUsd: cap,
      reason: 'Grok post-run cost telemetry is not bound to exactly one successful terminal stdout event' });
  }
  const terminal = terminals[0];
  const candidates = [terminal.total_cost_usd, terminal.totalCostUsd,
    terminal.usage && terminal.usage.total_cost_usd,
    terminal.usage && terminal.usage.totalCostUsd]
    .filter((value) => value !== undefined && value !== null);
  const distinct = [...new Set(candidates.map(Number))];
  if (distinct.length !== 1 || !Number.isFinite(distinct[0]) || distinct[0] < 0) {
    return Object.freeze({ ok: false, telemetryCeilingUsd: cap,
      reason: 'successful Grok terminal stdout event has missing, conflicting, or invalid cost telemetry' });
  }
  const actualUsd = distinct[0];
  const withinCap = actualUsd <= cap;
  return Object.freeze({
    ok: withinCap,
    telemetryCeilingUsd: cap,
    actualUsd,
    method: 'post-run-credit-equivalent-terminal-stdout',
    authorizationScope: 'post-run-telemetry-only',
    classification: 'credit-equivalent-pricing-telemetry',
    billedSpend: false,
    capEnforcement: false,
    preRunSpendEnforced: false,
    incrementalSpendEnforced: false,
    enforceablePrechargeCap: false,
    possibleEventOvershoot: true,
    observedEventOvershoot: !withinCap,
    reason: withinCap
      ? 'terminal total_cost_usd is post-run credit-equivalent pricing telemetry under a separately proven fresh execution-bound zero-metered billing state; authentication is not usage evidence, this is not billed spend or cap enforcement, and one completed event can overshoot before this comparison'
      : `terminal reported credit-equivalent pricing ${actualUsd} USD exceeds the authorized telemetry ceiling ${cap} USD after completion; an overshoot was observed and the review is unusable`,
  });
}

function grokSpendContract(capUsd) {
  const cap = Number(capUsd);
  if (!Number.isFinite(cap) || cap <= 0) return null;
  return Object.freeze({
    authorizationScope: 'post-run-telemetry-only',
    telemetryCeilingUsd: cap,
    billingRequirement: 'fresh-execution-bound-zero-metered',
    billedSpend: false,
    capEnforcement: false,
    preRunSpendEnforced: false,
    incrementalSpendEnforced: false,
    enforceablePrechargeCap: false,
  });
}

// Only coverage objects created by grokReadReceiptCoverage() in this process
// are eligible to unlock a Grok verdict. This capability boundary prevents a
// caller from fabricating `{ complete: true }` (or a covered-path list) and
// asking buildRecord() to turn prompt claims into gate evidence.
const validatedGrokCoverage = new WeakSet();

function extractGrokStreamingReview(rawText, coverage) {
  if (!coverage || !validatedGrokCoverage.has(coverage) || coverage.complete !== true) return null;
  const text = grokStreamEvents(rawText)
    .filter((event) => event.type === 'text' && typeof event.data === 'string')
    .map((event) => event.data)
    .join('');
  return text ? extractJson(text) : null;
}

function grokReadReceiptCoverage(rawText, manifest, reviewCwd) {
  const manifestEntries = Array.isArray(manifest) ? manifest : [];
  const expectedEntries = new Map(manifestEntries.map((entry) => [String(entry.path), entry]));
  const expected = new Set(expectedEntries.keys());
  const calls = new Map();
  const failed = new Set();
  const completedReads = new Set();
  const coveredLines = new Map([...expected].map((relative) => [relative, new Map()]));
  const reportedTotalLines = new Map();
  const lexicalCwd = path.resolve(reviewCwd || '.');
  // macOS exposes the same temporary directory through both /var and
  // /private/var. Grok 1.0.5 reports the canonical /private/var path even when
  // Node created and passed a lexical /var cwd. Resolve the live directory
  // first, then apply only that one documented alias for frozen evidence whose
  // ephemeral directory no longer exists. No other aliases are accepted.
  function canonicalMacPath(rawPath) {
    const resolved = path.resolve(rawPath);
    if (resolved === '/var' || resolved.startsWith('/var/')) return `/private${resolved}`;
    return resolved;
  }
  let realCwd = lexicalCwd;
  try {
    const realpath = fs.realpathSync.native || fs.realpathSync;
    realCwd = realpath(lexicalCwd);
  } catch { /* frozen review sandboxes are intentionally already removed */ }
  const cwd = canonicalMacPath(realCwd);
  let terminalCount = 0;
  let terminalStopReason = null;
  let postTerminalEvents = 0;
  let terminalSeen = false;
  let verdictText = '';
  let verdictSeen = false;
  let verdictBeforeCoverage = false;

  const manifestSha256 = sha256Hex(Buffer.from(stableJson(
    [...expectedEntries.values()]
      .map((entry) => ({
        path: String(entry.path),
        lines: entry.lines,
        bytes: entry.bytes,
        sha256: entry.sha256,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  ), 'utf8'));

  function exactRelative(rawPath) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
    const absolute = canonicalMacPath(path.isAbsolute(rawPath)
      ? rawPath : path.resolve(lexicalCwd, rawPath));
    if (absolute !== cwd && !absolute.startsWith(cwd + path.sep)) return null;
    const relative = path.relative(cwd, absolute).split(path.sep).join('/');
    return expected.has(relative) ? relative : null;
  }

  function reconstructedPaths() {
    const successful = new Set();
    for (const [relative, entry] of expectedEntries) {
      if (failed.has(relative) || !completedReads.has(relative)) continue;
      const lines = coveredLines.get(relative) || new Map();
      if (!Number.isInteger(entry.lines) || lines.size !== entry.lines) continue;
      const ordered = [];
      let hasGap = false;
      for (let lineNumber = 1; lineNumber <= entry.lines; lineNumber++) {
        if (!lines.has(lineNumber)) { hasGap = true; break; }
        ordered.push(lines.get(lineNumber));
      }
      if (hasGap) continue;
      const rebuilt = ordered.join('');
      const rebuiltBytes = Buffer.byteLength(rebuilt);
      const rebuiltSha = crypto.createHash('sha256').update(rebuilt).digest('hex');
      const totalLines = reportedTotalLines.get(relative);
      const trailingEmptyLineConvention = totalLines === entry.lines + 1 && rebuilt.endsWith('\n');
      if ((totalLines !== entry.lines && !trailingEmptyLineConvention)
          || rebuiltBytes !== entry.bytes || rebuiltSha !== entry.sha256) continue;
      successful.add(relative);
    }
    return successful;
  }

  for (const event of grokStreamEvents(rawText)) {
    if (terminalSeen) {
      if (event.type === 'end') terminalCount++;
      postTerminalEvents++;
      continue;
    }
    if (event.type === 'end') {
      terminalSeen = true;
      terminalCount++;
      terminalStopReason = typeof event.stopReason === 'string' ? event.stopReason : null;
      continue;
    }
    if (event.type === 'text' && typeof event.data === 'string') {
      verdictText += event.data;
      if (!verdictSeen) {
        const candidate = extractJson(verdictText);
        if (candidate && typeof candidate.disposition === 'string') {
          verdictSeen = true;
          const reconstructed = reconstructedPaths();
          if (reconstructed.size !== expected.size) verdictBeforeCoverage = true;
        }
      }
      continue;
    }
    if (event.type === 'tool_call' && event.toolName === 'read_file' && typeof event.toolCallId === 'string') {
      const legacyRelative = exactRelative(event.rawInput && event.rawInput.path);
      const currentRelative = exactRelative(event.rawInput && event.rawInput.target_file);
      if (legacyRelative && currentRelative && legacyRelative !== currentRelative) continue;
      const relative = legacyRelative || currentRelative;
      if (!relative) continue;
      const rawOffset = event.rawInput && event.rawInput.offset;
      const rawLimit = event.rawInput && event.rawInput.limit;
      calls.set(event.toolCallId, {
        relative,
        offset: Number.isInteger(rawOffset) && rawOffset >= 1 ? rawOffset : null,
        limit: Number.isInteger(rawLimit) && rawLimit >= 1 ? rawLimit : null,
      });
      continue;
    }
    if (event.type !== 'tool_call_update' || typeof event.toolCallId !== 'string') continue;
    const call = calls.get(event.toolCallId);
    if (!call) continue;
    const relative = call.relative;
    if (event.status === 'failed') {
      failed.add(relative);
      continue;
    }
    if (event.status !== 'completed') continue;

    // A completed status or requested range does not prove bytes were returned.
    // Grok 1.0.5 exposes the copied path, exact unannotated raw_output, starting
    // line and total line count. Rebuild each file from those native receipts;
    // only a byte-for-byte manifest digest match proves complete coverage.
    const output = event.rawOutput;
    const fileContent = output && output.type === 'ReadFile' && output.FileContent;
    const entry = expectedEntries.get(relative);
    const totalLines = fileContent && fileContent.total_lines;
    const outputOffset = fileContent && fileContent.offset;
    const outputLimit = fileContent && fileContent.limit;
    const start = Number.isInteger(outputOffset) && outputOffset >= 1
      ? outputOffset : (call.offset || 1);
    const rawOutput = fileContent && fileContent.raw_output;
    const receiptLines = typeof rawOutput === 'string'
      ? (rawOutput.match(/[^\n]*\n|[^\n]+$/g) || [])
      : null;
    const manifestComplete = entry
      && Number.isInteger(entry.lines) && entry.lines >= 0
      && Number.isInteger(entry.bytes) && entry.bytes >= 0
      && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256);
    const previousTotalLines = reportedTotalLines.get(relative);
    const totalsConsistent = previousTotalLines === undefined || previousTotalLines === totalLines;
    const totalConventionKnown = manifestComplete
      && (totalLines === entry.lines || totalLines === entry.lines + 1);
    const offsetAgrees = call.offset
      ? outputOffset === call.offset
      : (!Number.isInteger(outputOffset) || outputOffset === 1);
    const limitAgrees = call.limit
      ? outputLimit === call.limit
      : !Number.isInteger(outputLimit);
    const withinRequestedLimit = !call.limit || (receiptLines && receiptLines.length <= call.limit);
    const withinOutputLimit = !Number.isInteger(outputLimit) || (receiptLines && receiptLines.length <= outputLimit);
    const rangeFits = receiptLines && Number.isInteger(totalLines)
      && start + receiptLines.length - 1 <= totalLines;
    if (!fileContent || typeof fileContent.content !== 'string'
        || exactRelative(fileContent.absolute_path) !== relative
        || !manifestComplete || !totalConventionKnown || !totalsConsistent
        || !offsetAgrees || !limitAgrees || !withinRequestedLimit || !withinOutputLimit || !rangeFits
        || (entry.lines > 0 && receiptLines.length === 0)) {
      failed.add(relative);
      continue;
    }
    reportedTotalLines.set(relative, totalLines);
    completedReads.add(relative);
    const lines = coveredLines.get(relative);
    for (let index = 0; index < receiptLines.length; index++) {
      const lineNumber = start + index;
      const existing = lines.get(lineNumber);
      if (existing !== undefined && existing !== receiptLines[index]) failed.add(relative);
      else lines.set(lineNumber, receiptLines[index]);
    }
  }

  const successful = reconstructedPaths();

  const missingPaths = [...expected].filter((relative) => !successful.has(relative)).sort();
  const failedPaths = [...failed].filter((relative) => !successful.has(relative)).sort();
  // Frozen successful Grok 1.0.5 streaming-json evidence terminates exactly
  // once with {type:"end", stopReason:"end_turn"}. Missing, duplicate,
  // unknown/refusal/interrupted reasons, or any parsed event after that receipt
  // make the protocol incomplete regardless of otherwise valid file digests.
  const terminalValid = terminalCount === 1
    && terminalStopReason === 'end_turn'
    && postTerminalEvents === 0;
  const result = Object.freeze({
    complete: terminalValid && missingPaths.length === 0
      && manifestEntries.length === expectedEntries.size
      && !verdictBeforeCoverage,
    endSeen: terminalCount > 0,
    terminalValid,
    terminalCount,
    terminalStopReason,
    postTerminalEvents,
    verdictSeen,
    verdictBeforeCoverage,
    manifestSha256,
    expectedPaths: [...expected].sort(),
    readPaths: [...successful].sort(),
    missingPaths,
    failedPaths,
  });
  validatedGrokCoverage.add(result);
  return result;
}

function enforceGrokReadReceipts(reviewer, parsed, coverage) {
  if (reviewer !== 'grok') return { parsed, unavailableReason: null };
  if (coverage && coverage.complete) return { parsed, unavailableReason: null };
  const missing = coverage && coverage.missingPaths && coverage.missingPaths.length
    ? coverage.missingPaths.join(', ')
    : '(receipt stream unavailable)';
  const failed = coverage && coverage.failedPaths && coverage.failedPaths.length
    ? ` Failed reads: ${coverage.failedPaths.join(', ')}.`
    : '';
  const terminal = coverage && !coverage.terminalValid
    ? ` The Grok stream does not have exactly one successful terminal end receipt (count=${coverage.terminalCount || 0}, stopReason=${coverage.terminalStopReason || 'missing'}, postTerminalEvents=${coverage.postTerminalEvents || 0}).`
    : '';
  const ordering = coverage && coverage.verdictBeforeCoverage
    ? ' A disposition-bearing verdict was emitted before complete digest-verified read coverage.'
    : '';
  return {
    parsed: null,
    unavailableReason: `Grok read coverage is not proven by successful read_file receipts for every copied subject/spec path. Missing: ${missing}.${failed}${terminal}${ordering}`,
  };
}

// Reviewer protocols are defined on stdout only. Stderr remains in preserved
// raw evidence for diagnosis, but it cannot contribute receipts, a verdict,
// or terminal/abnormal-stop metadata for either Grok or Codex.
function reviewerProtocolText(reviewer, result) {
  if (reviewer === 'grok' || reviewer === 'codex') return String(result && result.stdout || '');
  return String(result && result.raw || '');
}

// A parsed object is only a review if it actually carries a verdict. Some CLIs
// wrap their run in a JSON envelope ({text, stopReason, usage…}); extracting
// that envelope must not be mistaken for extracting a review.
// Stop reasons that mean the run did NOT finish. A verdict produced under any
// of these is a snapshot of an unfinished thought, not a review.
const ABNORMAL_STOP = /^(max_turns|max turns reached|cancelled|canceled|error|timeout|length|aborted)/i;

/**
 * PROVEN DEFECT (2026-08-25, found by actually running it): --json-schema
 * constrains the model to emit conforming JSON on EVERY turn, so a run that is
 * cut off mid-investigation still emits a syntactically perfect verdict. The
 * observed one was:
 *
 *   {"disposition":"REJECT","findings":[{"severity":"HIGH","location":"pending",
 *     "problem":"Full prompt and subject files not yet inspected; starting…"}]}
 *
 * Schema-valid, and completely fake. Structural validity is not semantic
 * validity, and constraining output makes that gap WIDER rather than narrower —
 * the placeholder now passes every syntactic check the record has.
 *
 * So an abnormal stop makes the result UNAVAILABLE regardless of how well-formed
 * the payload looks. A verdict from a run that did not finish is worse than no
 * verdict: it is indistinguishable from a real one at the gate.
 */
function stopWasAbnormal(rawText) {
  if (typeof rawText !== 'string') return null;
  const envelopes = (topLevelJsonObjects(rawText) || [])
    .filter((value) => value && typeof value === 'object' && typeof value.stopReason === 'string');
  const abnormal = envelopes.map((value) => value.stopReason)
    .find((stop) => ABNORMAL_STOP.test(stop));
  if (abnormal) return abnormal;
  if (/^\s*Error:\s*max turns reached/mi.test(rawText)) return 'max turns reached';
  if (/^\s*Error:\s*(timeout|cancelled)/mi.test(rawText)) return 'cancelled';
  const codexFailure = (topLevelJsonObjects(rawText) || []).find((value) => value &&
    typeof value === 'object' && ['turn.failed', 'item.failed', 'error'].includes(value.type));
  if (codexFailure) return codexFailure.type;
  return null;
}

// `codex exec --json` emits JSONL protocol events. A successful run ends with
// exactly one `turn.completed`; it does not emit the Grok/Claude-style
// stopReason envelope the old adapter expected. Verdict parsing stays separate:
// the final agent_message carries the review JSON, while this function proves
// only that the pinned transport completed cleanly and drained its process
// group. Missing, duplicate, failed, or post-terminal protocol events refuse.
function validateCodexTerminalEnvelope(rawText, completionEvidence = null) {
  if (typeof rawText !== 'string') {
    return Object.freeze({ ok: false, reason: 'Codex JSONL terminal protocol is missing' });
  }
  const events = (topLevelJsonObjects(rawText) || [])
    .filter((value) => value && typeof value === 'object' && typeof value.type === 'string');
  const terminals = events.filter((value) => value.type === 'turn.completed' || value.type === 'turn.failed');
  if (terminals.length !== 1) {
    return Object.freeze({ ok: false,
      reason: `Codex JSONL terminal count is ${terminals.length}; exactly one is required` });
  }
  const terminal = terminals[0];
  if (terminal.type !== 'turn.completed') {
    return Object.freeze({ ok: false,
      reason: `Codex JSONL terminal did not complete successfully (${terminal.type})` });
  }
  const terminalIndex = events.indexOf(terminal);
  if (terminalIndex !== events.length - 1) {
    return Object.freeze({ ok: false,
      reason: `Codex JSONL emitted ${events.length - terminalIndex - 1} protocol event(s) after turn.completed` });
  }
  const abnormal = events.find((value) => ['turn.failed', 'item.failed', 'error'].includes(value.type));
  if (abnormal) {
    return Object.freeze({ ok: false, reason: `Codex JSONL contains abnormal event ${abnormal.type}` });
  }
  const c = completionEvidence;
  if (!c || c.authority !== 'review-adapters.cjs runTool' || c.status !== 0 ||
      c.timedOut === true || c.outputOverflow === true || c.error ||
      c.groupDrained !== true || c.inputComplete !== true ||
      c.subjectSnapshotComplete !== true || c.manifestSnapshotComplete !== true ||
      c.complete !== true) {
    return Object.freeze({ ok: false,
      reason: 'Codex process/transport completion evidence is missing or incomplete' });
  }
  return Object.freeze({ ok: true, terminalType: terminal.type, event: terminal });
}

// A findings array whose entries admit they are placeholders is not evidence.
// Cheap, and it catches the exact shape the truncated run produced.
const PLACEHOLDER_LOCATION = /^\s*(pending|not yet inspected|starting (the )?(adversarial )?review|in progress|to be determined|tbd)\s*$/i;
const PLACEHOLDER_PROBLEM = /\b(full prompt and subject files|required subject files?) (?:are )?not yet inspected\b[\s\S]*\bstarting (the )?(adversarial )?review\b/i;
const PLACEHOLDER_UNVERIFIED = /^\s*(required )?reads? (?:are |is )?not yet completed\.?\s*$/i;
function looksUnfinished(parsed) {
  if (!parsed || !Array.isArray(parsed.findings)) return false;
  const unfinishedFinding = parsed.findings.some((f) =>
    PLACEHOLDER_LOCATION.test(String(f && f.location || '')) ||
    PLACEHOLDER_PROBLEM.test(String(f && f.problem || '')));
  const unfinishedAdmission = Array.isArray(parsed.unverified) &&
    parsed.unverified.some((value) => PLACEHOLDER_UNVERIFIED.test(String(value || '')));
  return unfinishedFinding || unfinishedAdmission;
}

const REVIEW_DISPOSITIONS = ['APPROVE', 'APPROVE_WITH_NOTES', 'REJECT'];
const REVIEW_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'];
const REVIEW_KEYS = ['disposition', 'findings', 'unverified'];
const CODEX_REVIEW_KEYS = [...REVIEW_KEYS, 'inspectionProofs'];
const FINDING_KEYS = ['evidence', 'file', 'impact', 'location', 'problem',
  'requiredCorrection', 'severity', 'status', 'verificationMethod'];
const REVERIFICATION_KEYS = ['evidence', 'findingIndex', 'outcome', 'sourceReviewId', 'verificationMethod'];
const INSPECTION_PROOF_KEYS = ['lineNumber', 'lineText', 'path'];

function hasExactKeys(value, expected) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && stableJson(Object.keys(value).sort()) === stableJson(expected.slice().sort());
}

function validateReviewPayload(value, reviewer = null) {
  const expectedKeys = reviewer === 'codex' ? CODEX_REVIEW_KEYS : REVIEW_KEYS;
  const extendedKeys = [...expectedKeys, 'reverifiedFindings'];
  if (!hasExactKeys(value, expectedKeys) && !hasExactKeys(value, extendedKeys)) {
    return { ok: false, reason: `review payload must contain exactly ${expectedKeys.join(', ')} with optional reverifiedFindings` };
  }
  if (!REVIEW_DISPOSITIONS.includes(value.disposition)) {
    return { ok: false, reason: 'review disposition is not recognized' };
  }
  if (!Array.isArray(value.findings) || !Array.isArray(value.unverified)
    || !value.unverified.every((item) => typeof item === 'string')) {
    return { ok: false, reason: 'findings and unverified must be explicit arrays with string unverified entries' };
  }
  if (value.reverifiedFindings !== undefined) {
    if (!Array.isArray(value.reverifiedFindings)) {
      return { ok: false, reason: 'reverifiedFindings must be an explicit array' };
    }
    for (let index = 0; index < value.reverifiedFindings.length; index++) {
      const proof = value.reverifiedFindings[index];
      if (!hasExactKeys(proof, REVERIFICATION_KEYS)
        || typeof proof.sourceReviewId !== 'string' || !proof.sourceReviewId.trim()
        || !Number.isInteger(proof.findingIndex) || proof.findingIndex < 0
        || typeof proof.verificationMethod !== 'string' || !proof.verificationMethod.trim()
        || typeof proof.evidence !== 'string' || !proof.evidence.trim()
        || proof.outcome !== 'PASS') {
        return { ok: false, reason: `re-verification proof ${index + 1} is malformed or lacks concrete PASS evidence` };
      }
    }
  }
  for (let index = 0; index < value.findings.length; index++) {
    const finding = value.findings[index];
    if (!hasExactKeys(finding, FINDING_KEYS)) {
      return { ok: false, reason: `finding ${index + 1} does not match the exact finding contract` };
    }
    if (!REVIEW_SEVERITIES.includes(finding.severity) || finding.status !== 'OPEN') {
      return { ok: false, reason: `finding ${index + 1} has an invalid severity or status` };
    }
    for (const key of FINDING_KEYS.filter((key) => key !== 'severity')) {
      if (typeof finding[key] !== 'string') {
        return { ok: false, reason: `finding ${index + 1}.${key} must be a string` };
      }
    }
    if (!finding.file.trim() || !finding.problem.trim() || !finding.evidence.trim()) {
      return { ok: false, reason: `finding ${index + 1} is missing file, problem, or evidence` };
    }
    if (['CRITICAL', 'HIGH'].includes(finding.severity)
      && (!finding.impact.trim() || !finding.requiredCorrection.trim()
        || !finding.verificationMethod.trim())) {
      return { ok: false, reason: `blocking finding ${index + 1} lacks impact, correction, or verification` };
    }
  }
  const hasBlockingFinding = value.findings.some((finding) =>
    ['CRITICAL', 'HIGH'].includes(finding.severity));
  if (hasBlockingFinding && value.disposition !== 'REJECT') {
    return { ok: false, reason: 'an OPEN CRITICAL or HIGH finding requires disposition REJECT' };
  }
  if (value.findings.length && !hasBlockingFinding
    && !['APPROVE_WITH_NOTES', 'REJECT'].includes(value.disposition)) {
    return { ok: false, reason: 'non-blocking findings require disposition APPROVE_WITH_NOTES or REJECT' };
  }
  if (!value.findings.length && value.disposition === 'APPROVE_WITH_NOTES') {
    return { ok: false, reason: 'APPROVE_WITH_NOTES requires at least one non-blocking finding' };
  }
  if (reviewer === 'codex') {
    if (!Array.isArray(value.inspectionProofs)) {
      return { ok: false, reason: 'Codex inspectionProofs must be an explicit array' };
    }
    for (let index = 0; index < value.inspectionProofs.length; index++) {
      const proof = value.inspectionProofs[index];
      if (!hasExactKeys(proof, INSPECTION_PROOF_KEYS)
        || typeof proof.path !== 'string'
        || !Number.isInteger(proof.lineNumber) || proof.lineNumber < 1
        || typeof proof.lineText !== 'string') {
        return { ok: false, reason: `Codex inspection proof ${index + 1} is malformed` };
      }
    }
  }
  return { ok: true, reason: null };
}

function isUsableReview(o, reviewer = null) {
  return validateReviewPayload(o, reviewer).ok;
}

function codexCoveredPaths(inputDelivery) {
  return inputDelivery && Array.isArray(inputDelivery.coveredPaths)
    ? inputDelivery.coveredPaths.slice()
    : [];
}

// Classify an exact-line mismatch for the failure record. This never accepts a
// proof; it only names which byte-level difference occurred so an operator can
// tell a real coverage gap from a reviewer formatting artefact. Every value it
// reports is derived from the reviewer's own answer or from already-published
// challenge fields, so it discloses nothing that would ease a future forgery.
// Deterministic bounded tail of the challenged line.
//
// RUN-20260902-5226737c: Codex twice returned line 1028 of
// builder-control/test/hosting.test.cjs without its final comma - 101 bytes
// against a 102-byte line. The validator was right to reject it, but nothing
// published let the reviewer catch it before answering: linePrefix constrains
// only the head, leadingWhitespace only the indent, and lineBytes is a count a
// reviewer cannot recompute reliably enough to notice one absent byte. A
// published tail makes trailing punctuation directly self-checkable.
//
// Rule, so the reviewer and this file agree byte for byte:
//   * at most INSPECTION_SUFFIX_MAX UTF-16 code units taken from the end;
//   * never starting inside a surrogate pair - a lone trailing surrogate is
//     half a code point and cannot survive UTF-8 round-tripping, so the window
//     shrinks by one unit rather than publishing it;
//   * never reaching left far enough to meet linePrefix. At least
//     INSPECTION_HIDDEN_MIN code units always stay unpublished, so prefix +
//     suffix + byte count still cannot reconstruct the line for a reviewer
//     that never located it. Where that leaves no room the suffix is '' and
//     imposes no constraint, exactly like the empty-prefix fallback.
const INSPECTION_SUFFIX_MAX = 16;
const INSPECTION_HIDDEN_MIN = 8;

function inspectionLineSuffix(lineText, linePrefix) {
  const prefixLength = typeof linePrefix === 'string' ? linePrefix.length : 0;
  const budget = Math.min(
    INSPECTION_SUFFIX_MAX,
    lineText.length - prefixLength - INSPECTION_HIDDEN_MIN,
  );
  if (budget <= 0) return '';
  let start = lineText.length - budget;
  const startUnit = lineText.charCodeAt(start);
  if (startUnit >= 0xDC00 && startUnit <= 0xDFFF) start += 1;
  return lineText.slice(start);
}

function describeInspectionTextMismatch(lineText, challenge) {
  const receivedBytes = Buffer.byteLength(lineText, 'utf8');
  const receivedLeading = lineText.length - lineText.replace(/^\s+/, '').length;
  const parts = [`returned ${receivedBytes} UTF-8 bytes`];
  if (Number.isInteger(challenge.lineBytes)) parts.push(`challenged line is ${challenge.lineBytes} bytes`);
  if (Number.isInteger(challenge.leadingWhitespace)) {
    parts.push(`leading whitespace ${receivedLeading} vs challenged ${challenge.leadingWhitespace}`);
    // Re-indentation probe: if only the leading run differs, the reviewer had
    // the real content and re-rendered it. That is a reviewer formatting fault,
    // not absent inspection, and the two must not be reported identically.
    const reindented = ' '.repeat(challenge.leadingWhitespace) + lineText.replace(/^\s+/, '');
    if (sha256Hex(Buffer.from(reindented, 'utf8')) === challenge.lineSha256) {
      parts.push('content matches exactly after indent correction, so the reviewer re-rendered the file '
        + 'instead of quoting raw bytes; this is a reviewer formatting fault, not missing inspection');
    }
  } else if (receivedLeading > 0) {
    parts.push(`leading whitespace ${receivedLeading}`);
  }
  if (typeof challenge.linePrefix === 'string' && challenge.linePrefix.length
    && !lineText.startsWith(challenge.linePrefix)) {
    parts.push('the returned line does not begin with the challenged linePrefix');
  }
  // Truncation probe. A returned line that starts correctly and ends wrong has
  // been trimmed or re-punctuated, not invented, and the operator needs to read
  // that as a transport fault rather than as a reviewer that never opened the
  // file. Naming it does not relax the accept test above.
  if (typeof challenge.lineSuffix === 'string' && challenge.lineSuffix.length
    && !lineText.endsWith(challenge.lineSuffix)) {
    parts.push('the returned line does not end with the challenged lineSuffix, so trailing '
      + 'characters were dropped or altered');
  }
  return parts.join('; ');
}

const validatedCodexInspection = new WeakSet();

function validateCodexInspectionProofs(parsed, inputDelivery) {
  const payload = validateReviewPayload(parsed, 'codex');
  if (!payload.ok) return Object.freeze({ complete: false, coveredPaths: [], reason: payload.reason });
  const challenges = inputDelivery && Array.isArray(inputDelivery.inspectionChallenges)
    ? inputDelivery.inspectionChallenges : [];
  if (!challenges.length || parsed.inspectionProofs.length !== challenges.length) {
    return Object.freeze({ complete: false, coveredPaths: [], reason: 'inspection proof count does not match the delivered challenge set' });
  }
  const expected = new Map(challenges.map((challenge) => [challenge.path, challenge]));
  const coveredPaths = [];
  for (const proof of parsed.inspectionProofs) {
    const challenge = expected.get(proof.path);
    // The accept test is unchanged and stays byte-exact: the returned line must
    // hash to the challenged line. Only the failure REASON is classified. An
    // unclassified `inspection proof failed for <path>` cannot distinguish a
    // reviewer that never opened the file from one that read it exactly and
    // then re-rendered it, so it reads as a coverage failure in both cases.
    const reject = (detail) => Object.freeze({
      complete: false,
      coveredPaths: [],
      reason: `inspection proof failed for ${proof.path}: ${detail}`,
    });
    if (!challenge) {
      return reject('the returned path was never challenged');
    }
    if (coveredPaths.includes(proof.path)) {
      return reject('the same path was proven twice');
    }
    if (proof.lineNumber !== challenge.lineNumber) {
      return reject(`lineNumber ${proof.lineNumber} does not match challenged lineNumber ${challenge.lineNumber}`);
    }
    if (sha256Hex(Buffer.from(proof.lineText, 'utf8')) !== challenge.lineSha256) {
      return reject(describeInspectionTextMismatch(proof.lineText, challenge));
    }
    coveredPaths.push(proof.path);
  }
  const attestation = Object.freeze({
    complete: true,
    method: 'exact subject delivery plus deterministic per-file reference challenge; proves bounded file reference, not complete cognitive inspection',
    coveredPaths: Object.freeze(coveredPaths.slice().sort()),
    challengeSha256: inputDelivery.inspectionChallengeSha256,
    responseSha256: sha256Hex(Buffer.from(stableJson(parsed.inspectionProofs), 'utf8')),
  });
  validatedCodexInspection.add(attestation);
  return attestation;
}

// Build a record. `parsed` null/unusable => UNAVAILABLE, never APPROVE.
function buildRecord({ reviewer, reviewerModel, packetId, subject, parsed, unavailableReason, ts,
  coveredPaths, inputDelivery, codexInspection, readCoverage, invocationId, spendAuthorization,
  subjectSnapshot, checkReceipt, priorFindings = [] }) {
  const covered = new Set(codexInspection && Array.isArray(codexInspection.coveredPaths)
    ? codexInspection.coveredPaths : []);
  const codexCoverageComplete = reviewer !== 'codex'
    || (codexInspection && validatedCodexInspection.has(codexInspection)
      && codexInspection.complete === true
      && subject.subjectPaths.every((subjectPath) => covered.has(subjectPath)));
  const grokExpected = new Set(readCoverage && Array.isArray(readCoverage.expectedPaths)
    ? readCoverage.expectedPaths : []);
  const grokRead = new Set(readCoverage && Array.isArray(readCoverage.readPaths)
    ? readCoverage.readPaths : []);
  const grokCoverageComplete = reviewer !== 'grok'
    || (readCoverage && validatedGrokCoverage.has(readCoverage)
      && readCoverage.complete === true
      && readCoverage.terminalValid === true
      && readCoverage.verdictBeforeCoverage === false
      && typeof readCoverage.manifestSha256 === 'string'
      && /^[a-f0-9]{64}$/.test(readCoverage.manifestSha256)
      && subject.subjectPaths.every((subjectPath) =>
        grokExpected.has(subjectPath) && grokRead.has(subjectPath)));
  const base = {
    reviewId: invocationId || `REV-${ts.replace(/[^0-9]/g, '').slice(0, 14)}-${reviewer}`,
    ts,
    reviewer,
    reviewerModel,
    packetId,
    reviewOf: {
      diffSha256: subject.subjectSha256,
      // Paths identify the exact subject delivered to the reviewer for its
      // verdict. Codex additionally must return one unpredictable per-file
      // reference challenge. This is evidence that each bundled file was
      // referenced; it is not a claim that cognition can be cryptographically
      // measured. Grok paths retain their stronger native read-receipt rule.
      changedPaths: (reviewer === 'codex' && !codexCoverageComplete)
        || (reviewer === 'grok' && !grokCoverageComplete)
        ? [] : subject.subjectPaths.slice(),
    },
  };
  const notes = [];
  if (reviewer === 'codex' && inputDelivery) notes.push(`Codex inputDelivery ${stableJson(inputDelivery)}`);
  if (reviewer === 'codex' && codexInspection) notes.push(`Codex inspectionProof ${stableJson(codexInspection)}`);
  if (reviewer === 'grok' && readCoverage) notes.push(`Grok readCoverage ${stableJson(readCoverage)}`);
  if (reviewer === 'grok' && spendAuthorization) notes.push(`Grok postRunSpendTelemetry ${stableJson(spendAuthorization)}`);
  if (subjectSnapshot) notes.push(`subjectSnapshot ${stableJson(subjectSnapshot)}`);
  if (checkReceipt) notes.push(`deterministicCheckReceipt ${stableJson({
    runId: checkReceipt.runId,
    receiptSha256: checkReceipt.receiptSha256,
    subject: checkReceipt.subject,
    packet: checkReceipt.packet,
    hostContainmentReceiptSha256: checkReceipt.hostContainment
      ? checkReceipt.hostContainment.receiptSha256 : null,
  })}`);
  if (notes.length) base.notes = notes.join('\n');
  if (reviewer === 'codex' && !codexCoverageComplete) {
    return {
      ...base,
      disposition: 'UNAVAILABLE',
      unavailableReason: unavailableReason
        || 'Codex inspection coverage was not proven by the deterministic exact-line challenge for every reviewed path',
      findings: [],
    };
  }
  if (reviewer === 'grok' && !grokCoverageComplete) {
    return {
      ...base,
      disposition: 'UNAVAILABLE',
      unavailableReason: unavailableReason
        || 'Grok native read coverage was missing, incomplete, forged, out of order, or not bound to every subject path in the copied manifest',
      findings: [],
    };
  }
  const payload = validateReviewPayload(parsed, reviewer);
  if (!payload.ok) {
    return {
      ...base,
      disposition: 'UNAVAILABLE',
      unavailableReason: unavailableReason || `the reviewer payload was refused: ${payload.reason}`,
      findings: [],
    };
  }
  const findings = parsed.findings;
  const priorByKey = new Map(priorFindings.map((finding) =>
    [`${finding.sourceReviewId}:${finding.findingIndex}`, finding]));
  const reverifiedFindings = Array.isArray(parsed.reverifiedFindings)
    ? parsed.reverifiedFindings : [];
  for (const proof of reverifiedFindings) {
    const prior = priorByKey.get(`${proof.sourceReviewId}:${proof.findingIndex}`);
    // Eligibility here has to be the SAME predicate the prompt used to choose
    // re-verification targets. Membership in priorFindings is not eligibility:
    // that list also carries the historical entries, including ones the
    // current-state proof map already classified CURRENTLY_PROVEN_FIXED,
    // SUPERSEDED or OUT_OF_SCOPE, and ones no map bound to this subject at all.
    // Without this check the prompt correctly labels a stale finding as history
    // and the record still accepts a PASS against it, which republishes the
    // stale allegation as a re-verification performed on the current subject.
    if (!prior || prior.reviewer === reviewer
      || prior.verificationMethod !== proof.verificationMethod
      || !isCurrentOpenReverificationTarget(prior, checkReceipt)) {
      return {
        ...base,
        disposition: 'UNAVAILABLE',
        unavailableReason: 'the reviewer claimed a re-verification that was not an eligible prior finding from a different reviewer with the exact verification method',
        findings: [],
      };
    }
  }
  return {
    ...base,
    disposition: parsed.disposition,
    findings: findings
      // A finding with empty evidence is dropped rather than passed through to
      // fail schema validation and take the whole record down with it. Dropping
      // an unevidenced finding is safe; dropping an evidenced one never happens.
      .filter((f) => f && typeof f.evidence === 'string' && f.evidence.trim() !== '')
      .map((f) => ({
        severity: f.severity || 'INFORMATIONAL',
        file: f.file || '(unspecified)',
        location: f.location || '',
        problem: f.problem || '',
        evidence: f.evidence,
        impact: f.impact || '',
        requiredCorrection: f.requiredCorrection || '',
        verificationMethod: f.verificationMethod || '',
        status: 'OPEN',
      })),
    reverifiedFindings: reverifiedFindings.map((proof) => ({ ...proof })),
    unverified: Array.isArray(parsed.unverified) ? parsed.unverified.map(String) : [],
  };
}

// ── durable evidence redaction ──────────────────────────────────────────────
// Redaction is a PUBLICATION step, not a parsing step.
//
// ROOT CAUSE (observed 2026-09-04): runTool scrubbed reviewer stdout the
// instant the process closed, so everything downstream — extractJson,
// validateCodexInspectionProofs, the terminal-envelope check — read scrubbed
// bytes. The canonical scrubber's last rule treats any unknown opaque run of
// 32+ [A-Za-z0-9_+/=.-] characters as a secret, and a repo-relative path such
// as builder-control/packets/PKT-...-REPAIR.json is exactly that shape. The
// challenged path came back as [REDACTED OPAQUE], the byte-exact challenge
// could not match, and five V3 Codex groups recorded UNAVAILABLE while their
// inspection proofs were in fact correct.
//
// The order is now: parse and validate against the exact unredacted in-memory
// bytes, publish nothing durable until that has happened, then scrub on the
// way to disk.
//
// The scrubber in aegis-run.cjs is NOT modified and NO regex exception is
// added. Preservation is structural: each verbatim token is swapped for a
// nonce placeholder, the unchanged scrubber runs over the whole string, and
// the placeholders are swapped back. A placeholder is delimited by a control
// character and its interior is far shorter than the opaque rule's
// 32-character floor, so the substitution can only make a boundary MORE
// redactable, never less — a secret abutting a preserved path loses the
// character-class lookbehind that used to shield it.
const PRESERVE_SENTINEL = '\u0001';

function redactWithPreservedTokens(value, preserveTokens) {
  const redactor = require('./aegis-run.cjs').redactSecretMarkers;
  const text = String(value == null ? '' : value);
  const tokens = Array.from(new Set((preserveTokens || [])
    .filter((token) => typeof token === 'string' && token.length > 0)))
    .filter((token) => text.includes(token))
    // Longest first so a path that is a prefix of another cannot shadow it.
    .sort((a, b) => b.length - a.length);
  if (!tokens.length) return redactor(text);
  let nonce;
  do { nonce = crypto.randomBytes(6).toString('hex'); } while (text.includes(nonce));
  const placeholders = new Map();
  let masked = '';
  for (let i = 0; i < text.length;) {
    const token = tokens.find((candidate) => text.startsWith(candidate, i));
    if (!token) { masked += text[i]; i += 1; continue; }
    if (!placeholders.has(token)) {
      placeholders.set(token, `${PRESERVE_SENTINEL}p${placeholders.size}${nonce}${PRESERVE_SENTINEL}`);
    }
    masked += placeholders.get(token);
    i += token.length;
  }
  const scrubbed = redactor(masked);
  let restored = scrubbed.text;
  for (const [token, placeholder] of placeholders) restored = restored.split(placeholder).join(token);
  return { text: restored, redactions: scrubbed.redactions };
}

// Model-authored free text in a durable record. Deliberately an allowlist:
// reviewId, ts, reviewer, packetId, disposition, severity, status and
// reviewOf.changedPaths are adapter-authored coordinates, not reviewer prose,
// and scrubbing them would corrupt the gate's own bindings.
const REDACTED_FINDING_TEXT_FIELDS = ['file', 'location', 'problem', 'impact', 'evidence',
  'requiredCorrection', 'verificationMethod', 'builderResponse'];
const REDACTED_REVERIFIED_TEXT_FIELDS = ['verificationMethod', 'evidence'];

// Only an attestation THIS process produced through validateCodexInspectionProofs
// can buy verbatim preservation. A forged {complete:true, coveredPaths:[…]}
// literal is not in the WeakSet, so it preserves nothing and its paths are
// scrubbed like any other model-authored string.
function preservedInspectionPaths(codexInspection) {
  if (!codexInspection || !validatedCodexInspection.has(codexInspection)
    || codexInspection.complete !== true
    || !Array.isArray(codexInspection.coveredPaths)) return [];
  return codexInspection.coveredPaths.filter((p) => typeof p === 'string' && p.length > 0);
}

function redactDurableReviewEvidence({ raw, record, codexInspection } = {}) {
  const preserve = preservedInspectionPaths(codexInspection);
  const rawResult = redactWithPreservedTokens(raw, preserve);
  let structuredRecordRedactions = 0;
  const scrub = (value) => {
    const result = redactWithPreservedTokens(value, preserve);
    structuredRecordRedactions += result.redactions;
    return result.text;
  };
  let redacted = null;
  if (record && typeof record === 'object') {
    redacted = { ...record };
    for (const field of ['unavailableReason', 'notes']) {
      if (typeof redacted[field] === 'string') redacted[field] = scrub(redacted[field]);
    }
    if (Array.isArray(redacted.findings)) {
      redacted.findings = redacted.findings.map((finding) => {
        const out = { ...finding };
        for (const field of REDACTED_FINDING_TEXT_FIELDS) {
          if (typeof out[field] === 'string') out[field] = scrub(out[field]);
        }
        return out;
      });
    }
    if (Array.isArray(redacted.reverifiedFindings)) {
      redacted.reverifiedFindings = redacted.reverifiedFindings.map((proof) => {
        const out = { ...proof };
        for (const field of REDACTED_REVERIFIED_TEXT_FIELDS) {
          if (typeof out[field] === 'string') out[field] = scrub(out[field]);
        }
        return out;
      });
    }
    if (Array.isArray(redacted.unverified)) {
      redacted.unverified = redacted.unverified.map((entry) => scrub(String(entry)));
    }
    // The two counts are recorded SEPARATELY so "the raw transcript carried
    // secrets" and "the reviewer's structured verdict carried secrets" can
    // never be read as one number. They ride the existing free-text `notes`
    // extension point: engineering-review.schema.json is
    // additionalProperties:false at the top level, so a new field would be a
    // schema change and this adds none. The line is adapter-authored digits
    // and is appended AFTER scrubbing, so it cannot be scrubbed away.
    const countsNote = `evidenceRedaction ${stableJson({
      rawOutputRedactions: rawResult.redactions,
      structuredRecordRedactions,
      preservedInspectionPaths: preserve.length,
    })}`;
    redacted.notes = typeof redacted.notes === 'string' && redacted.notes
      ? `${redacted.notes}\n${countsNote}` : countsNote;
  }
  return Object.freeze({
    raw: rawResult.text,
    record: redacted,
    rawOutputRedactions: rawResult.redactions,
    structuredRecordRedactions,
    preservedPaths: Object.freeze(preserve.slice()),
  });
}

function validateRecord(recordPath) {
  const r = spawnSync(process.execPath, [ENGOS, '--validate-review', recordPath, '--json'],
    { cwd: ROOT, encoding: 'utf8' });
  let parsed = [];
  try { parsed = JSON.parse(r.stdout); } catch { /* fall through */ }
  const first = parsed[0] || { ok: false, errors: ['validator produced no result'] };
  return { ok: !!first.ok, errors: first.errors || [] };
}

// ── run ─────────────────────────────────────────────────────────────────────
// CONFIRMED FINDING #4: adapters selected hardcoded binaries directly and
// ignored the Tool Capability Canon, so disabling a reviewer in the canon had
// no effect on what actually ran, and dashboard/router state could disagree
// with execution. The canon is now consulted before any tool is launched.
// CONFIRMED FINDING #5: canonGate only rejected enabled=false / DISABLED, so a
// tool whose availability was UNVERIFIED or BLOCKED still ran, and runTool()
// spawned Grok directly without ever consulting routeRole() — meaning the
// metered authorization, data-class veto and role separation in
// MODEL-ROUTING-POLICY.json governed nothing at execution time. There is now
// ONE authorization path and every launch goes through it.
function authorizeLaunch(reviewer, opts = {}) {
  // Copilot is a real, authenticated, locally installed worker — which is
  // exactly why this refusal is written down rather than left implicit. It is
  // advisory: it may comment, it may not approve, and the gate accepts no
  // record from it. "Available" and "may be launched as a reviewer" are
  // different questions, and the moment a working binary appears next to two
  // reviewer binaries, someone will answer the second by looking at the first.
  if (reviewer === 'copilot') {
    return { ok: false, reason: 'copilot is an ADVISORY repository guardian (approvalAuthority NONE in the Tool Capability Canon); it is never launched as a gate reviewer, and no record it produced would satisfy a required review' };
  }
  const canon = canonGate(reviewer);
  if (!canon.ok) return canon;

  // Availability must be positively AVAILABLE with evidence. UNVERIFIED is not
  // a soft yes — it is the absence of a check.
  const avail = canon.tool.availability;
  if (avail !== 'AVAILABLE') {
    return { ok: false, reason: `${reviewer} availability is ${avail} in the Tool Capability Canon; only AVAILABLE (with evidence) may be launched` };
  }
  if (!canon.tool.availabilityEvidence || !canon.tool.availabilityEvidence.observedAt) {
    return { ok: false, reason: `${reviewer} is marked AVAILABLE but carries no dated availability evidence` };
  }

  // Role routing: data-class veto, metered authorization, role separation.
  const roleId = reviewer === 'grok' ? 'adversarial-review'
    : reviewer === 'codex' ? 'implementation-review'
    : 'repository-guardian';
  let route;
  try {
    route = require('./tool-router.cjs').routeRole(roleId, {
      dataClass: (opts.dataClass === undefined || opts.dataClass === null) ? 'INTERNAL' : opts.dataClass,
      allowMetered: opts.allowMetered,
      approvedBy: opts.approvedBy,
      capUsd: opts.capUsd,
      subscriptionProof: opts.subscriptionProof,
      deferSubscriptionProof: opts.deferSubscriptionProof === true,
      invocationId: opts.invocationId,
      preflightStage: opts.preflightStage,
    });
  } catch (e) {
    return { ok: false, reason: `model routing policy unusable: ${e.message}` };
  }
  if (!route.ok) return { ok: false, reason: `${route.code}: ${route.reason}` };
  const spendContract = reviewer === 'grok' ? grokSpendContract(opts.capUsd) : null;
  if (reviewer === 'grok' && !spendContract) {
    return { ok: false, reason: 'Grok routing requires a positive finite post-run telemetry ceiling' };
  }
  const bounds = reviewer === 'grok' ? Object.freeze({
    ...route.bounds,
    boundsNote: 'maxTurns, timeout, no web access, and no subagents are bounded execution guards; they do not enforce a spend ceiling. Launch additionally requires a fresh execution-bound zero-metered billing proof; authentication is not usage evidence, and terminal cost is compared only as post-run telemetry.',
    maxTurnsPurpose: 'runaway guard only; not a cost control',
  }) : route.bounds;
  return { ok: true, tool: canon.tool,
    route: Object.freeze({ ...route, bounds, spendContract }) };
}

function canonGate(reviewer) {
  const fsx = require('fs');
  const canonPath = require('path').join(HERE, 'TOOL-CAPABILITY-CANON.json');
  if (!fsx.existsSync(canonPath)) {
    return { ok: false, reason: 'TOOL-CAPABILITY-CANON.json is missing — refusing to run a reviewer the canon cannot authorize' };
  }
  let canon;
  try { canon = JSON.parse(fsx.readFileSync(canonPath, 'utf8')); }
  catch (e) { return { ok: false, reason: `tool canon unreadable: ${e.message}` }; }
  const wanted = { codex: 'codex-local', grok: 'grok-cli', copilot: 'copilot-cli' }[reviewer];
  const tool = (canon.tools || []).find((x) => x.toolId === wanted);
  if (!tool) return { ok: false, reason: `${reviewer} is not declared in the Tool Capability Canon` };
  if (tool.enabled === false) return { ok: false, reason: `${reviewer} is DISABLED in the Tool Capability Canon` };
  if (tool.availability === 'DISABLED') return { ok: false, reason: `${reviewer} availability is DISABLED in the canon` };
  return { ok: true, tool };
}

// Reviewer CLIs normally inherit the operator's interactive plugins, MCPs,
// rules and repository context. That is useful interactively and unsafe here:
// a four-file diff review previously initialized Make and wandered across the
// repository until both reviewers hit their wall-clock caps. Run from an empty
// harness with compatibility imports disabled. The entire review subject is
// already carried in the prompt, so no repository access is needed.
function safeReviewPath(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\')) {
    throw new Error(`invalid review path: ${JSON.stringify(rel)}`);
  }
  const normalized = path.posix.normalize(rel);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`review path escapes repository root: ${rel}`);
  }
  if (/(^|\/)(?:\.env(?:\.|$)|auth(?:\.|\/)|credentials?(?:\.|\/)|secrets?(?:\.|\/)|review-raw|ledger\.json$)/i.test(normalized)) {
    throw new Error(`sensitive or runtime review path refused: ${rel}`);
  }
  return normalized;
}

function resolveBoundedReviewPaths(subject, packet, sourceRoot = ROOT) {
  if (!subject || !Array.isArray(subject.subjectPaths) || !packet || !Array.isArray(packet.filesAllowed)) {
    throw new Error('subject paths and packet filesAllowed are required for bounded review');
  }
  const allowed = new Set(packet.filesAllowed.map(safeReviewPath));
  const subjectPaths = subject.subjectPaths.map(safeReviewPath);
  const outsidePacket = subjectPaths.filter((value) => !allowed.has(value));
  if (outsidePacket.length) {
    throw new Error(`review subject is outside packet filesAllowed: ${outsidePacket.join(', ')}`);
  }
  const specs = Array.isArray(packet.sourceOfTruth) ? packet.sourceOfTruth.map(safeReviewPath) : [];
  const combined = [...new Set([...subjectPaths, ...specs])].sort();
  const rootReal = fs.realpathSync(sourceRoot);
  for (const rel of combined) {
    const candidate = path.resolve(rootReal, rel);
    if (!candidate.startsWith(rootReal + path.sep)) throw new Error(`review path escaped worktree: ${rel}`);
    const real = fs.realpathSync(candidate);
    if (!real.startsWith(rootReal + path.sep)) throw new Error(`review path resolves outside worktree: ${rel}`);
    const st = fs.lstatSync(real);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(`review path is not a regular file: ${rel}`);
  }
  return Object.freeze(combined);
}

function validateReviewSources(reviewPaths = [], sourceRoot = ROOT) {
  const rootReal = fs.realpathSync(sourceRoot);
  const uniquePaths = [...new Set(reviewPaths.map(safeReviewPath))].sort();
  if (uniquePaths.length > MAX_REVIEW_FILES) {
    throw new Error(`review file count ${uniquePaths.length} exceeds ${MAX_REVIEW_FILES}`);
  }
  let totalBytes = 0;
  const sources = [];
  for (const rel of uniquePaths) {
    const src = path.resolve(rootReal, rel);
    if (!src.startsWith(rootReal + path.sep)) throw new Error(`review source escaped repository root: ${rel}`);
    const st = fs.lstatSync(src);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(`review source is not a regular file: ${rel}`);
    totalBytes += st.size;
    if (totalBytes > MAX_REVIEW_BYTES) {
      throw new Error(`review payload ${totalBytes} bytes exceeds ${MAX_REVIEW_BYTES}`);
    }
    const sourceBuffer = fs.readFileSync(src);
    const sourceSha = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
    const sourceText = sourceBuffer.toString('utf8');
    const sourceLines = sourceText.length === 0
      ? 0
      : (sourceText.match(/\n/g) || []).length + (sourceText.endsWith('\n') ? 0 : 1);
    sources.push(Object.freeze({ rel, src, bytes: st.size, sourceSha, lines: sourceLines }));
  }
  return Object.freeze({ sources: Object.freeze(sources), totalBytes });
}

function prepareReviewSandbox(reviewPaths = [], sourceRoot = ROOT) {
  // Refuse malformed, oversized or unreadable subjects before a temporary
  // directory exists and, critically, before any operator auth is copied.
  const validated = validateReviewSources(reviewPaths, sourceRoot);
  // A fresh directory removes two attack surfaces from the old shared path:
  // another process cannot pre-populate reviewer config, and a symlink cannot
  // redirect writes into an operator-owned location. mkdtemp creates the path
  // atomically; the explicit chmod makes the intended boundary reviewable.
  const reviewRoot = fs.mkdtempSync(REVIEW_SANDBOX_PREFIX);
  try {
    const rootStat = fs.lstatSync(reviewRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || fs.readdirSync(reviewRoot).length !== 0) {
      throw new Error('review sandbox was not created as a fresh regular directory');
    }
    fs.chmodSync(reviewRoot, 0o700);
    const reviewCwd = path.join(reviewRoot, 'work');
    const reviewHome = path.join(reviewRoot, 'home');
    const reviewTmp = path.join(reviewRoot, 'tmp');
    fs.mkdirSync(reviewCwd, { mode: 0o700 });
    fs.mkdirSync(reviewHome, { mode: 0o700 });
    fs.mkdirSync(reviewTmp, { mode: 0o700 });
    const grokDir = path.join(reviewHome, '.grok');
    const codexDir = path.join(reviewHome, '.codex');
    fs.mkdirSync(grokDir, { mode: 0o700 });
    fs.mkdirSync(codexDir, { mode: 0o700 });
    const config = [
      '[compat.claude]',
      'skills = false', 'rules = false', 'agents = false', 'mcps = false', 'hooks = false', 'sessions = false',
      '', '[compat.cursor]',
      'skills = false', 'rules = false', 'agents = false', 'mcps = false', 'hooks = false', 'sessions = false',
      '', '[compat.codex]', 'sessions = false',
      '', '[managed_mcps]', 'enabled = false', '',
    ].join('\n');
    const configPath = path.join(grokDir, 'config.toml');
    fs.writeFileSync(configPath, config, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    // Copy and verify the bounded subject before copying credentials. A copy,
    // read or digest failure can therefore leave neither auth nor a sandbox.
    const manifest = [];
    for (const source of validated.sources) {
      const dest = path.join(reviewCwd, source.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source.src, dest, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(dest, 0o400);
      const copiedSha = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
      if (source.sourceSha !== copiedSha) throw new Error(`review copy digest mismatch: ${source.rel}`);
      manifest.push({ path: source.rel, sha256: source.sourceSha, bytes: source.bytes, lines: source.lines });
    }

    // The old shared harness symlinked operator auth into a predictable path.
    // Copy auth last into this private ephemeral directory, force 0400, and
    // remove the whole root on every preparation or subprocess outcome.
    const authPath = path.join(grokDir, 'auth.json');
    if (fs.existsSync(OPERATOR_GROK_AUTH)) {
      fs.copyFileSync(OPERATOR_GROK_AUTH, authPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(authPath, 0o400);
    }
    const codexAuthPath = path.join(codexDir, 'auth.json');
    if (fs.existsSync(OPERATOR_CODEX_AUTH)) {
      fs.copyFileSync(OPERATOR_CODEX_AUTH, codexAuthPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(codexAuthPath, 0o400);
    }
    return Object.freeze({
      root: reviewRoot,
      cwd: reviewCwd,
      home: reviewHome,
      tmp: reviewTmp,
      grokConfigPath: configPath,
      grokAuthPath: fs.existsSync(authPath) ? authPath : null,
      codexAuthPath: fs.existsSync(codexAuthPath) ? codexAuthPath : null,
      manifest,
      totalBytes: validated.totalBytes,
    });
  } catch (error) {
    cleanupReviewSandbox(reviewRoot);
    throw error;
  }
}

function cleanupReviewSandbox(sandbox) {
  const reviewRoot = typeof sandbox === 'string' ? sandbox : sandbox && sandbox.root;
  if (!reviewRoot || !path.resolve(reviewRoot).startsWith(path.resolve(REVIEW_SANDBOX_PREFIX))) {
    throw new Error('refusing to clean a path outside the review sandbox prefix');
  }
  if (fs.existsSync(reviewRoot)) {
    const st = fs.lstatSync(reviewRoot);
    if (!st.isDirectory() || st.isSymbolicLink()) {
      throw new Error('refusing to clean a review sandbox that is not a regular directory');
    }
    fs.rmSync(reviewRoot, { recursive: true, force: true });
  }
}

// Re-attest both authorities behind every manifest entry: the immutable source
// selected by the packet and the private copy exposed to the reviewer. This is
// deliberately independent of Git-subject validation so pinned specifications
// receive the same before/after protection as subject files.
function validateReviewManifestSnapshot(sandbox, phase = 'snapshot', sourceRoot = ROOT) {
  if (!sandbox || !sandbox.cwd || !Array.isArray(sandbox.manifest)) {
    throw new Error('review manifest snapshot requires a prepared sandbox');
  }
  const sourceBase = fs.realpathSync(sourceRoot);
  const copyBase = fs.realpathSync(sandbox.cwd);
  const checkedPaths = [];
  for (const entry of sandbox.manifest) {
    const rel = safeReviewPath(entry.path);
    for (const [kind, base] of [['source', sourceBase], ['copy', copyBase]]) {
      const candidate = path.resolve(base, rel);
      if (!candidate.startsWith(base + path.sep)) throw new Error(`${kind} path escaped manifest root: ${rel}`);
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${kind} is not a regular file: ${rel}`);
      const bytes = fs.readFileSync(candidate);
      if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256) {
        throw new Error(`${kind} digest changed for ${rel}`);
      }
    }
    checkedPaths.push(rel);
  }
  return Object.freeze({ complete: true, phase, checkedPaths: Object.freeze(checkedPaths) });
}

function buildCodexInput(prompt, sandbox, expectedPaths, opts = {}) {
  if (!sandbox || !sandbox.cwd || !Array.isArray(sandbox.manifest)) {
    throw new Error('Codex input bundle requires a prepared private review sandbox and manifest');
  }
  if (typeof prompt !== 'string' || !prompt.length) {
    throw new Error('Codex input bundle requires a non-empty review prompt');
  }
  const bundleLimit = Number.isInteger(opts.bundleLimitBytes)
    ? opts.bundleLimitBytes : MAX_CODEX_BUNDLE_BYTES;
  const inputLimit = Number.isInteger(opts.inputLimitBytes)
    ? opts.inputLimitBytes : MAX_CODEX_INPUT_BYTES;
  // Tests may tighten this limit, but no caller may raise the observed CLI
  // ceiling. A caller-controlled expansion would turn the preflight into a
  // declaration rather than an enforced transport bound.
  const characterLimit = Number.isInteger(opts.inputLimitCharacters)
    ? Math.min(opts.inputLimitCharacters, MAX_CODEX_INPUT_CHARACTERS)
    : MAX_CODEX_INPUT_CHARACTERS;
  if (bundleLimit <= 0 || inputLimit <= 0 || characterLimit <= 0) {
    throw new Error('Codex input limits must be positive integers');
  }

  const expected = [...new Set((expectedPaths || []).map(safeReviewPath))].sort();
  const manifest = sandbox.manifest.map((entry) => ({
    path: safeReviewPath(entry.path),
    bytes: entry.bytes,
    lines: entry.lines,
    sha256: entry.sha256,
  // Use the same deterministic UTF-16 code-unit ordering as the canonical
  // review-path resolver/validator. localeCompare moves uppercase packet paths
  // relative to lowercase paths, which made equal nine-path sets compare
  // unequal despite originating from the same reviewPaths input.
  })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifestPaths = manifest.map((entry) => entry.path);
  if (stableJson(manifestPaths) !== stableJson(expected)) {
    throw new Error(`Codex input manifest does not exactly cover requested review paths (expected ${expected.length}, found ${manifestPaths.length})`);
  }

  const inspectionChallenges = manifest.map((entry) => {
    const copiedPath = path.resolve(sandbox.cwd, entry.path);
    const content = fs.readFileSync(copiedPath, 'utf8');
    const lines = content.split(/\r\n|\n|\r/);
    const allNonEmpty = lines.map((lineText, index) => ({ lineText, lineNumber: index + 1 }))
      .filter((candidate) => candidate.lineText.trim().length > 0);
    const candidates = allNonEmpty.map((candidate) => ({
      ...candidate,
      linePrefix: candidate.lineText.slice(0, Math.min(32, candidate.lineText.length)),
    })).filter((candidate) => candidate.lineText.length >= 48
      && lines.filter((lineText) => lineText.startsWith(candidate.linePrefix)).length === 1);
    const available = candidates.length ? candidates : allNonEmpty.map((candidate) => ({
      ...candidate,
      linePrefix: candidate.lineText.slice(0, Math.min(16, candidate.lineText.length)),
    }));
    if (!available.length) available.push({ lineText: lines[0] || '', lineNumber: 1, linePrefix: '' });
    const selector = Number.parseInt(sha256Hex(Buffer.from(`${entry.path}\0${entry.sha256}`, 'utf8')).slice(0, 8), 16);
    const chosen = available[selector % available.length];
    return Object.freeze({
      path: entry.path,
      lineNumber: chosen.lineNumber,
      linePrefix: chosen.linePrefix,
      // Published shape metrics. These reveal no content the reviewer does not
      // already have to reproduce, but they let a reviewer self-check that it
      // quoted raw file bytes rather than its own re-rendering of the file.
      // A reviewer that parses a .json subject and pretty-prints it at a
      // different indent returns byte-different text for a line it genuinely
      // read; that produced a false UNAVAILABLE on an exact, real inspection.
      lineBytes: Buffer.byteLength(chosen.lineText, 'utf8'),
      leadingWhitespace: chosen.lineText.length - chosen.lineText.replace(/^\s+/, '').length,
      lineSuffix: inspectionLineSuffix(chosen.lineText, chosen.linePrefix),
      lineSha256: sha256Hex(Buffer.from(chosen.lineText, 'utf8')),
    });
  });
  const publicChallenges = inspectionChallenges.map(
    ({ path: challengePath, lineNumber, linePrefix, lineBytes, leadingWhitespace, lineSuffix }) => ({
      path: challengePath,
      lineNumber,
      linePrefix,
      lineBytes,
      leadingWhitespace,
      lineSuffix,
    }));
  const inspectionChallengeSha256 = sha256Hex(Buffer.from(stableJson(inspectionChallenges), 'utf8'));
  const challengeBlock = [
    '<<<AEGIS_CODEX_INSPECTION_CHALLENGES_V1_BEGIN>>>',
    'For every challenge below, locate the unique line beginning with linePrefix in that appended file.',
    'lineNumber is a reference, not a request to count rendered lines. Return the complete exact line',
    'excluding the newline in inspectionProofs. Preserve all whitespace exactly.',
    'Quote the raw bytes as they appear between CONTENT_BEGIN and CONTENT_END. Do not parse, reformat,',
    're-indent, or re-serialise the file first - a re-rendered line fails even when you did read the file.',
    'Self-check before answering: your line must be exactly lineBytes UTF-8 bytes, must begin with',
    'exactly leadingWhitespace whitespace characters, and must start with linePrefix.',
    'When lineSuffix is a non-empty string your line must ALSO end with exactly those characters,',
    'including any trailing comma, semicolon, quote, brace or bracket. Do not drop or add a trailing',
    'character. A line that ends one byte short of lineSuffix is rejected exactly like an unread file.',
    stableJson(publicChallenges),
    '<<<AEGIS_CODEX_INSPECTION_CHALLENGES_V1_END>>>',
  ].join('\n');

  const manifestJson = stableJson(manifest);
  const manifestSha256 = sha256Hex(Buffer.from(manifestJson, 'utf8'));
  const parts = [
    '<<<AEGIS_CODEX_EXACT_BUNDLE_V1_BEGIN>>>\n',
    `MANIFEST_BYTES ${Buffer.byteLength(manifestJson)}\n`,
    `MANIFEST_SHA256 ${manifestSha256}\n`,
    '<<<AEGIS_CODEX_MANIFEST_BEGIN>>>\n',
    manifestJson,
    '\n<<<AEGIS_CODEX_MANIFEST_END>>>\n',
  ];

  for (let index = 0; index < manifest.length; index++) {
    const entry = manifest[index];
    const copiedPath = path.resolve(sandbox.cwd, entry.path);
    if (!copiedPath.startsWith(path.resolve(sandbox.cwd) + path.sep)) {
      throw new Error(`Codex input path escaped copied review tree: ${entry.path}`);
    }
    const st = fs.lstatSync(copiedPath);
    if (!st.isFile() || st.isSymbolicLink()) {
      throw new Error(`Codex input copy is not a regular file: ${entry.path}`);
    }
    const bytes = fs.readFileSync(copiedPath);
    const copiedSha = sha256Hex(bytes);
    if (bytes.length !== entry.bytes || copiedSha !== entry.sha256) {
      throw new Error(`Codex input copy failed manifest verification: ${entry.path}`);
    }
    const content = bytes.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(bytes)) {
      throw new Error(`Codex input copy is not exact UTF-8 text: ${entry.path}`);
    }
    const begin = `<<<AEGIS_CODEX_FILE_${index}_BEGIN_${entry.sha256}>>>`;
    const end = `<<<AEGIS_CODEX_FILE_${index}_END_${entry.sha256}>>>`;
    if (content.includes(begin) || content.includes(end)) {
      throw new Error(`Codex input delimiter collision: ${entry.path}`);
    }
    parts.push(
      `${begin}\nPATH ${JSON.stringify(entry.path)}\nBYTES ${entry.bytes}\nLINES ${entry.lines}\nSHA256 ${entry.sha256}\nCONTENT_BEGIN\n`,
      content,
      `\nCONTENT_END\n${end}\n`,
    );
  }
  parts.push('<<<AEGIS_CODEX_EXACT_BUNDLE_V1_END>>>\n');
  const bundle = parts.join('');
  const bundleBytes = Buffer.byteLength(bundle);
  if (bundleBytes > bundleLimit) {
    throw new Error(`Codex exact bundle ${bundleBytes} bytes exceeds conservative ${bundleLimit}-byte limit; use builder-control/review-chunker.cjs for exact chunked coverage`);
  }
  const input = `${prompt}\n\n${challengeBlock}\n\n${bundle}`;
  if (input.length > characterLimit) {
    throw new Error(`Codex initial input ${input.length} characters exceeds the observed CLI ${characterLimit}-character maximum; use builder-control/review-chunker.cjs for exact chunked coverage`);
  }
  const inputBuffer = Buffer.from(input, 'utf8');
  if (inputBuffer.length > inputLimit) {
    throw new Error(`Codex initial input ${inputBuffer.length} bytes exceeds conservative ${inputLimit}-byte limit; use builder-control/review-chunker.cjs for exact chunked coverage`);
  }
  const bundleSha256 = sha256Hex(Buffer.from(bundle, 'utf8'));
  const inputSha256 = sha256Hex(inputBuffer);
  const attested = {
    version: 'codex-stdin-exact-bundle-v1',
    method: 'complete copied review bundle delivered in initial stdin',
    coveredPaths: manifestPaths,
    manifest,
    manifestSha256,
    bundleBytes,
    bundleSha256,
    inputBytes: inputBuffer.length,
    inputSha256,
    inspectionChallenges,
    inspectionChallengeSha256,
  };
  const inputDelivery = Object.freeze({
    ...attested,
    attestationSha256: sha256Hex(Buffer.from(stableJson(attested), 'utf8')),
  });
  return Object.freeze({ input, inputBuffer, inputDelivery });
}

// Build the exact argument vector a reviewer will be launched with. Exported
// so a test can assert that every bound the policy DECLARES is actually
// PRESENT on the command line — the gap that let maxTurns:1 run 13 turns.
// The review shape, as a JSON Schema. Grok's --json-schema CONSTRAINS the model
// to emit conforming JSON instead of us asking politely in the prompt and hoping.
// Asking produced prose three times; constraining is enforcement rather than
// instruction, which is the same distinction this whole system is built on.
const GROK_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    disposition: { type: 'string', enum: ['APPROVE', 'APPROVE_WITH_NOTES', 'REJECT'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'] },
          file: { type: 'string' },
          location: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          impact: { type: 'string' },
          requiredCorrection: { type: 'string' },
          verificationMethod: { type: 'string' },
          status: { type: 'string', enum: ['OPEN'] },
        },
        required: FINDING_KEYS,
      },
    },
    unverified: { type: 'array', items: { type: 'string' } },
    reverifiedFindings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          sourceReviewId: { type: 'string' }, findingIndex: { type: 'integer', minimum: 0 },
          verificationMethod: { type: 'string' }, evidence: { type: 'string' },
          outcome: { type: 'string', enum: ['PASS'] },
        },
        required: REVERIFICATION_KEYS,
      },
    },
  },
  required: [...REVIEW_KEYS, 'reverifiedFindings'],
};

function buildToolArgv(reviewer, prompt, bounds, reviewCwd) {
  if (reviewer === 'codex') {
    // Codex's read-only mode starts a second sandbox-exec for model-issued
    // reads. macOS refuses that nested sandbox from inside our deny-default
    // outer profile (`sandbox_apply: Operation not permitted`). The CLI's
    // documented external-containment mode leaves every model-issued process
    // inside the already-active outer profile, whose only source read authority
    // is the private copied subject and whose only writes are disposable HOME
    // and TMPDIR. No repository source is writable.
    return ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--ephemeral', '--ignore-user-config',
      '--ignore-rules', '--skip-git-repo-check', '--color', 'never',
      '--disable', 'shell_snapshot', '--disable', 'shell_tool', '--disable', 'unified_exec',
      '--cd', reviewCwd || '.', '-'];
  }
  // Everything-that-is-not-Codex used to fall through to the Grok argv. That
  // was harmless while Grok was the only other entry and became a trap the
  // moment a third, ADVISORY binary joined TOOLS: ask for a Copilot command
  // line and you silently get Grok's, complete with Grok's flags. Refuse
  // instead. runTool() never reaches here for an advisory worker — but the
  // function is exported, and "unreachable today" is not a control.
  if (reviewer !== 'grok') {
    throw new Error(`buildToolArgv: no launch argv is defined for reviewer "${reviewer}" — advisory and unknown workers are never launched, and silently reusing another reviewer's command line would hide that`);
  }
  // Keep the CLI envelope machine-readable without constraining EVERY model
  // turn to the final verdict schema. In Grok 1.0.5, --json-schema can make the
  // first planning turn look like a finished review before read_file runs.
  // The prompt contract, extractJson(), placeholder guard, signed schema
  // validator and exact-subject gate still validate the final record.
  const argv = ['-p', prompt, '--output-format', 'streaming-json',
    '--cwd', reviewCwd, '--no-subagents', '--verbatim',
    '--tools', 'read_file',
    '--allow', `Read(${reviewCwd}/**)`,
    '--deny', `Read(${path.dirname(reviewCwd)}/home/**)`,
    '--deny', 'Read(../**)',
    '--disallowed-tools', 'Grep,Bash,Edit,MCPTool,WebFetch,WebSearch'];
  if (bounds && Number.isInteger(bounds.maxTurns) && bounds.maxTurns > 0) argv.push('--max-turns', String(bounds.maxTurns));
  if (!bounds || bounds.webAccess === false) argv.push('--disable-web-search');
  return argv;
}

function reviewerEnvironment(reviewer, sandbox, source = process.env) {
  const common = {
    HOME: sandbox.home,
    TMPDIR: sandbox.tmp,
  };
  if (reviewer === 'codex') common.CODEX_HOME = path.join(sandbox.home, '.codex');
  if (reviewer === 'grok') {
    common.GROK_MANAGED_MCPS_ENABLED = 'false';
    // Supported by the pinned binary (xai-grok-update); prevents a preflight
    // or review from mutating the executable identity it was authorized to use.
    common.GROK_DISABLE_AUTOUPDATER = '1';
  }
  return strictEnvironment(common, source);
}

function containedReviewerCommand(reviewer, sandbox, argv) {
  const tool = TOOLS[reviewer];
  if (!tool) throw new Error(`unknown reviewer ${reviewer}`);
  const configReads = reviewer === 'grok' ? [sandbox.grokConfigPath] : [];
  const credentialReads = reviewer === 'grok'
    ? [sandbox.grokAuthPath].filter(Boolean)
    : [sandbox.codexAuthPath].filter(Boolean);
  const generated = buildMacSandboxProfile({
    root: sandbox.root,
    executable: tool.bin,
    readPaths: [sandbox.cwd, ...configReads],
    // Both locations are private, one-use copies removed in finally. The
    // subject remains under sandbox.cwd and is never writable.
    writePaths: [sandbox.home, sandbox.tmp],
    processOnlyReadPaths: credentialReads,
    // The pinned CLI may inspect only its one-use HOME/TMP cache trees. Child
    // processes remain denied, and the copied subject is still read-only.
    processOnlyReadDirectoryPaths: [sandbox.home, sandbox.tmp],
    allowNetwork: true,
    reviewerRuntime: true,
  });
  // The generic runtime profile permits process* and ambient outbound network
  // for trusted builders. Independent reviewers are stricter: only the pinned
  // CLI may exec or use the network. Model-issued child processes therefore
  // cannot obtain a shell or exfiltrate through curl even when a CLI flag or
  // prompt contract regresses.
  const executable = generated.executable.replace(/[\\"\n\r]/g, '');
  const profileText = generated.profile
    .replace('(allow process*)', `(allow process-info*)\n(allow process-fork)\n(allow process-exec (literal "${executable}"))`)
    .replace('(allow network-outbound)', `(allow network-outbound (process-path "${executable}"))`);
  const profile = Object.freeze({ ...generated, profile: profileText });
  return Object.freeze({ ...sandboxedCommand(profile, argv), profile });
}

function validateGrokExecutableIdentity(opts = {}) {
  const tool = TOOLS.grok;
  try {
    const stat = fs.lstatSync(tool.bin);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return Object.freeze({ ok: false, reason: 'pinned Grok executable is not a regular immutable-path file' });
    }
    const digestRunner = typeof opts.digestRunner === 'function'
      ? opts.digestRunner : (file) => sha256Hex(fs.readFileSync(file));
    const beforeSha256 = digestRunner(tool.bin);
    if (beforeSha256 !== tool.expectedSha256) {
      return Object.freeze({ ok: false, reason: `pinned Grok executable digest mismatch before version probe: ${beforeSha256}` });
    }
    const runner = typeof opts.versionRunner === 'function' ? opts.versionRunner : spawnSync;
    const result = runner(tool.bin, ['--version'], {
      encoding: 'utf8', timeout: 5_000,
      env: strictEnvironment({ GROK_DISABLE_AUTOUPDATER: '1' }),
    });
    const version = result && typeof result.stdout === 'string' ? result.stdout.trim() : '';
    if (!result || result.status !== 0 || version !== tool.expectedVersion) {
      return Object.freeze({ ok: false,
        reason: `pinned Grok version mismatch: expected ${tool.expectedVersion}, observed ${version || 'UNAVAILABLE'}` });
    }
    const afterSha256 = digestRunner(tool.bin);
    if (afterSha256 !== tool.expectedSha256 || afterSha256 !== beforeSha256) {
      return Object.freeze({ ok: false,
        reason: `pinned Grok executable changed during version probe: before ${beforeSha256}, after ${afterSha256}` });
    }
    return Object.freeze({ ok: true, path: tool.bin, sha256: afterSha256, version,
      updaterDisabled: true });
  } catch (error) {
    return Object.freeze({ ok: false, reason: `pinned Grok identity could not be proven: ${error.message}` });
  }
}

// ACP billing preflight deliberately never creates a session or supplies a
// prompt. It initializes the protocol, asks only the two vendor billing
// extensions, then terminates the isolated process.
function runGrokBillingAcp(contained, opts = {}) {
  const timeoutMs = Math.max(1, Number(opts.timeoutMs) || GROK_BILLING_PREFLIGHT_TIMEOUT_MS);
  const spawnImpl = typeof opts.spawnImpl === 'function' ? opts.spawnImpl : spawn;
  // DEFAULT billing launch: fail-closed OS preflight immediately before the
  // real spawn. It lives here rather than in descriptor construction, so
  // describing a command no longer requires a usable sandbox while every real
  // launch still proves one. The guard is the DEFAULT spawner identity, not a
  // caller flag: a caller that supplies its own spawner is not launching a
  // contained child through us, so there is nothing for the OS probe to prove.
  if (spawnImpl === spawn) assertSandboxOperational();
  const killImpl = typeof opts.killImpl === 'function' ? opts.killImpl : process.kill.bind(process);
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let stopping = false;
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let initialized = false;
    let billing;
    let autoTopup;
    const seenResponseIds = new Set();
    let pendingResult = null;
    let provisionalSuccess = null;
    let timeout = null;
    let hardKill = null;
    let forcedFinish = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(hardKill);
      clearTimeout(forcedFinish);
      resolve(Object.freeze(result));
    };
    const proveGroupDrain = async () => {
      const deadline = Date.now() + REVIEW_KILL_GRACE_MS;
      do {
        try {
          if (processGroupMembers(child.pid).length === 0) return true;
        } catch { return false; }
        await sleep(25);
      } while (Date.now() < deadline);
      try { return processGroupMembers(child.pid).length === 0; }
      catch { return false; }
    };
    const stop = (result) => {
      if (stopping || settled) return;
      stopping = true;
      pendingResult = result;
      try { child.stdin.end(); } catch {}
      try { killImpl(-child.pid, 'SIGTERM'); } catch {}
    };
    try {
      child = spawnImpl(contained.bin, contained.argv, {
        cwd: opts.cwd,
        env: opts.env,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({ ok: false, reason: `Grok billing ACP failed to spawn: ${error.message}`,
        groupDrained: true, retainSandbox: false });
      return;
    }
    const send = (id, method, params) => child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id, method, params,
    })}\n`);
    const boundedUtf8 = (bytes, remaining) => {
      let text = bytes.subarray(0, remaining).toString('utf8');
      while (Buffer.byteLength(text, 'utf8') > remaining) text = text.slice(0, -1);
      return text;
    };
    let buffered = '';
    child.stdout.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      const remaining = Math.max(0, GROK_BILLING_MAX_STREAM_BYTES - stdoutBytes);
      const captured = boundedUtf8(bytes, remaining);
      stdout += captured;
      stdoutBytes += bytes.length;
      if (stdoutBytes > GROK_BILLING_MAX_STREAM_BYTES) {
        stop({ ok: false, reason: 'Grok billing ACP exceeded bounded stdout output', stdout, stderr });
        return;
      }
      buffered += captured;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) {
        if (stopping || settled) return;
        if (!line.trim().startsWith('{')) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        // ACP may interleave ordinary JSON-RPC notifications/events with
        // request responses. A notification has no id, names a method, and
        // cannot carry response-shaped result/error fields. Ignore only that
        // narrow shape; an id-less response remains invalid evidence.
        if (message.id === undefined && message && message.jsonrpc === '2.0'
            && typeof message.method === 'string' && message.method.trim()
            && !Object.prototype.hasOwnProperty.call(message, 'result')
            && !Object.prototype.hasOwnProperty.call(message, 'error')) {
          continue;
        }
        const correlated = !initialized ? message.id === 1 : message.id === 2 || message.id === 3;
        if (!Number.isInteger(message.id) || !correlated || seenResponseIds.has(message.id)) {
          stop({ ok: false,
            reason: `Grok billing ACP received duplicate, uncorrelated, or unexpected response id ${String(message.id)}`,
            stdout, stderr });
          return;
        }
        seenResponseIds.add(message.id);
        if (message.id === 1) {
          if (message.error || !message.result) {
            stop({ ok: false, reason: 'Grok billing ACP initialize failed', stdout, stderr });
            return;
          }
          initialized = true;
          send(2, '_x.ai/billing', {});
          send(3, '_x.ai/auto-topup-rule', {});
        } else if (message.id === 2) {
          if (message.error || !message.result) {
            stop({ ok: false, reason: 'Grok billing ACP billing request failed', stdout, stderr });
            return;
          }
          billing = message.result;
        } else if (message.id === 3) {
          if (message.error || message.result === undefined || message.result === null) {
            stop({ ok: false, reason: 'Grok billing ACP auto-topup request failed', stdout, stderr });
            return;
          }
          autoTopup = message.result;
        }
        if (initialized && billing !== undefined && autoTopup !== undefined) {
          // A valid id=3 is not final until stdout reaches clean process
          // closure. Keep parsing so trailing duplicate/unexpected responses
          // in this or a later chunk can still invalidate the preflight.
          if (!provisionalSuccess) {
            provisionalSuccess = { ok: true, initialized, billing, autoTopup, stdout, stderr };
            try { child.stdin.end(); }
            catch (error) {
              stop({ ok: false, reason: `Grok billing ACP stdin close failed: ${error.message}`, stdout, stderr });
              return;
            }
          }
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      const remaining = Math.max(0, GROK_BILLING_MAX_STREAM_BYTES - stderrBytes);
      stderr += boundedUtf8(bytes, remaining);
      stderrBytes += bytes.length;
      if (stderrBytes > GROK_BILLING_MAX_STREAM_BYTES) {
        stop({ ok: false, reason: 'Grok billing ACP exceeded bounded stderr output', stdout, stderr });
      }
    });
    child.once('error', (error) => stop({ ok: false, reason: `Grok billing ACP process error: ${error.message}`, stdout, stderr }));
    child.once('close', async (status) => {
      const groupDrained = await proveGroupDrain();
      const boundary = { groupDrained, retainSandbox: !groupDrained };
      if (pendingResult) finish({ ...pendingResult, ...boundary });
      else if (provisionalSuccess && status === 0) {
        finish({ ...provisionalSuccess, stdout, stderr, ...boundary });
      }
      else if (provisionalSuccess) {
        finish({ ok: false, reason: `Grok billing ACP exited ${status} after provisional evidence`, stdout, stderr, ...boundary });
      }
      else finish({ ok: false, reason: `Grok billing ACP closed before complete evidence (exit ${status})`, stdout, stderr, ...boundary });
    });
    child.once('spawn', () => send(1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'AEGIS', title: 'AEGIS billing preflight', version: '1' },
    }));
    timeout = setTimeout(() => stop({ ok: false, reason: 'Grok billing ACP timed out before complete evidence', stdout, stderr }), timeoutMs);
    hardKill = setTimeout(() => {
      if (!settled && child && child.pid) {
        try { killImpl(-child.pid, 'SIGKILL'); } catch {}
        forcedFinish = setTimeout(async () => {
          const groupDrained = await proveGroupDrain();
          finish({ ...(pendingResult || { ok: false, reason: 'Grok billing ACP process did not terminate', stdout, stderr }),
            groupDrained, retainSandbox: !groupDrained });
        }, REVIEW_KILL_GRACE_MS);
        forcedFinish.unref();
      }
    }, timeoutMs + 1_000);
  });
}

function validateGrokBillingEvidence(evidence, opts = {}) {
  if (!evidence || evidence.ok !== true || evidence.groupDrained !== true || evidence.initialized !== true
      || !evidence.billing || typeof evidence.billing !== 'object'
      || !Object.prototype.hasOwnProperty.call(evidence, 'autoTopup')) {
    return Object.freeze({ ok: false, reason: 'Grok fresh execution-bound zero-metered billing evidence is missing or incomplete' });
  }
  const billing = evidence.billing;
  const tierPresent = Object.prototype.hasOwnProperty.call(billing, 'subscription_tier');
  const tier = tierPresent ? billing.subscription_tier : null;
  const config = billing.config;
  if (tierPresent && (typeof tier !== 'string' || !tier.trim())) {
    return Object.freeze({ ok: false, reason: 'Grok billing preflight reported a malformed subscription tier' });
  }
  if (!config || typeof config !== 'object' || config.isUnifiedBillingUser !== true) {
    return Object.freeze({ ok: false, reason: 'Grok billing preflight did not prove unified subscription billing' });
  }
  for (const field of ['onDemandCap', 'onDemandUsed', 'prepaidBalance']) {
    if (!config[field] || config[field].val !== 0) {
      return Object.freeze({ ok: false, reason: `Grok billing preflight requires ${field}.val === 0` });
    }
  }
  const autoTopup = evidence.autoTopup;
  const absent = autoTopup && typeof autoTopup === 'object' && Object.keys(autoTopup).length === 0;
  const disabled = autoTopup && typeof autoTopup === 'object' && autoTopup.enabled === false;
  if (!absent && !disabled) {
    return Object.freeze({ ok: false, reason: 'Grok billing preflight did not prove auto-topup absent or disabled' });
  }
  if (typeof opts.invocationId !== 'string' || !opts.invocationId.trim()) {
    return Object.freeze({ ok: false, reason: 'Grok billing preflight is not bound to a review invocation' });
  }
  const observedAt = new Date(Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now()).toISOString();
  const expiresAt = new Date(Date.parse(observedAt) + 5 * 60 * 1000).toISOString();
  const preflightId = `GBPF-${crypto.randomUUID()}`;
  return Object.freeze({ ok: true, mode: 'zero-metered',
    invocationId: opts.invocationId, preflightId, observedAt, expiresAt,
    subscriptionTier: tierPresent ? tier.trim() : null,
    subscriptionTierState: tierPresent ? 'REPORTED' : 'UNREPORTED',
    unifiedBilling: true, onDemandCap: 0, onDemandUsed: 0, prepaidBalance: 0,
    autoTopup: absent ? 'ABSENT' : 'DISABLED' });
}

async function grokBillingPreflight(sandbox, opts = {}) {
  let contained;
  try { contained = containedReviewerCommand('grok', sandbox, ['agent', '--no-leader', 'stdio']); }
  catch (error) { return Object.freeze({ ok: false, reason: `Grok billing containment unavailable: ${error.message}` }); }
  // Prove the immutable pin after every non-invoking preparation step and
  // immediately before the ACP executable is allowed to start.
  const identity = validateGrokExecutableIdentity({
    versionRunner: opts.grokVersionRunner,
    // Threaded exactly as grokVersionRunner already is. The production default
    // remains the real read-and-hash of the pinned path; this only lets a
    // simulated launch that already mocks the version probe also mock the
    // digest, instead of being forced to read the operator's pinned binary.
    digestRunner: opts.grokDigestRunner,
  });
  if (!identity.ok) return Object.freeze({ ok: false, reason: identity.reason, identity });
  const runner = typeof opts.grokBillingRunner === 'function' ? opts.grokBillingRunner : runGrokBillingAcp;
  // Everything above this line is preparation that starts nothing. The next
  // statement may spawn a detached ACP process group, so the uncertainty is
  // published FIRST: an invocation that dies, throws, or refuses from here on
  // must read UNKNOWN, never "no process was launched". This is billing
  // activity and says nothing about review execution or approval.
  noteReviewerLifecycle(opts, 'UNKNOWN', 'grok-billing-preflight-launch-attempted');
  let raw;
  try {
    raw = await runner(contained, {
      timeoutMs: GROK_BILLING_PREFLIGHT_TIMEOUT_MS,
      cwd: sandbox.cwd,
      env: reviewerEnvironment('grok', sandbox),
    });
  } catch (error) {
    // No evidence came back. The UNKNOWN stamped before the spawn stands.
    return Object.freeze({ ok: false, reason: `Grok billing preflight failed: ${error.message}`, identity });
  }
  // Drainage is READ from the runner's own explicit process evidence and from
  // nothing else — not from ok, not from a reason, not from retainSandbox, not
  // from an exit code. A missing or non-boolean flag leaves UNKNOWN standing.
  if (raw && typeof raw.groupDrained === 'boolean') {
    noteReviewerLifecycle(opts, raw.groupDrained ? 'LAUNCHED_DRAINED' : 'LAUNCHED_UNDRAINED',
      'grok-billing-preflight-drainage-evidence');
  }
  if (!raw || raw.ok !== true) {
    return Object.freeze({ ok: false,
      reason: raw && typeof raw.reason === 'string'
        ? raw.reason : 'Grok billing ACP did not produce successful complete evidence',
      identity, retainSandbox: Boolean(raw && raw.retainSandbox),
      transport: Object.freeze({ method: 'ACP initialize + _x.ai/billing + _x.ai/auto-topup-rule',
        sessionCreated: false, promptSent: false }) });
  }
  const validated = validateGrokBillingEvidence(raw, {
    invocationId: opts.invocationId,
    nowMs: opts.nowMs,
  });
  return Object.freeze({ ...validated, identity, retainSandbox: Boolean(raw && raw.retainSandbox),
    transport: Object.freeze({ method: 'ACP initialize + _x.ai/billing + _x.ai/auto-topup-rule',
      sessionCreated: false, promptSent: false }) });
}

function processGroupAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    if (error && error.code === 'EPERM') return true;
    throw error;
  }
}

// A thin adapter-local wrapper over the canonical owner. The previous body
// spawned the setuid system /bin/ps directly, which the immutable check
// boundary refuses with EPERM, so every drainage observation inside a governed
// check threw an OS error instead of observing the group. aegis-run.cjs already
// owns a trusted-inspector-aware processGroupMembers and already exports it; it
// is reached here through the lazy require this module already uses for that
// authority, so no import cycle, new inspector, module or export is introduced.
//
// The invalid-id guard and the adapter timeout are retained exactly. An
// unobservable group is a BOUNDED THROW, never an empty array: turning "I could
// not look" into "nothing is there" would manufacture drainage evidence.
function processGroupMembers(processGroupId, timeoutMs = 1_000) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) return [];
  const observed = require('./aegis-run.cjs').processGroupMembers(processGroupId, timeoutMs);
  if (!Array.isArray(observed)) throw new Error('process-group observation unavailable');
  return observed;
}

function signalProcessGroup(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reapUndrainedReviewerGroup(terminationEvidence, opts = {}) {
  const processGroupId = terminationEvidence && terminationEvidence.processGroupId;
  const membersOf = typeof opts.processGroupMembers === 'function'
    ? opts.processGroupMembers : processGroupMembers;
  const signalGroup = typeof opts.signalProcessGroup === 'function'
    ? opts.signalProcessGroup : signalProcessGroup;
  const wait = typeof opts.sleep === 'function' ? opts.sleep : sleep;
  const clock = typeof opts.now === 'function' ? opts.now : Date.now;
  const timeoutMs = Math.max(1, Number(opts.timeoutMs) || REVIEW_REAPER_TIMEOUT_MS);
  const intervalMs = Math.max(1, Number(opts.intervalMs) || 100);
  const attempts = [];
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) {
    return Object.freeze({ drained: false, retained: true,
      reason: 'reviewer process-group identity is unavailable; signalling is forbidden', attempts });
  }
  const deadline = clock() + timeoutMs;
  do {
    let members;
    try { members = membersOf(processGroupId); }
    catch (error) {
      attempts.push({ action: 'PROBE', ok: false, code: error && error.code || null });
      return Object.freeze({ drained: false, retained: true,
        reason: 'identity-bound process-group probe failed; signalling is forbidden', attempts });
    }
    if (!Array.isArray(members) || members.some((pid) => !Number.isInteger(pid) || pid <= 0)) {
      return Object.freeze({ drained: false, retained: true,
        reason: 'identity-bound process-group probe returned invalid evidence', attempts });
    }
    const unique = Array.from(new Set(members));
    if (unique.length === 0) {
      return Object.freeze({ drained: true, retained: false,
        reason: 'the owned reviewer process group drained during bounded reaping', attempts });
    }
    // The original leader has already closed. A member whose pid equals the
    // old pgid proves numeric process-group reuse, so authority to signal ends.
    if (unique.includes(processGroupId)) {
      return Object.freeze({ drained: false, retained: true,
        reason: 'the reviewer process-group id was reused; signalling authority was relinquished', attempts });
    }
    try {
      const signalled = signalGroup(processGroupId, 'SIGKILL');
      attempts.push({ action: 'SIGKILL', ok: signalled === true, memberCount: unique.length });
    } catch (error) {
      attempts.push({ action: 'SIGKILL', ok: false, code: error && error.code || null });
      return Object.freeze({ drained: false, retained: true,
        reason: 'identity-bound residual reviewer termination failed', attempts });
    }
    await wait(intervalMs);
  } while (clock() < deadline);
  return Object.freeze({ drained: false, retained: true,
    reason: 'bounded identity-bound reviewer reaper expired before positive drainage proof', attempts });
}

/**
 * Run one already-contained reviewer under a real wall-clock watchdog.
 *
 * Node's spawnSync timeout only sends a signal to the immediate child and then
 * waits for that child (and inherited pipes) to close. A CLI that ignores TERM,
 * or a descendant that keeps stdout open, can therefore outlive the declared
 * timeout indefinitely. The reviewer is instead launched as an owned process
 * group: timeout/overflow sends TERM to the whole group, escalates to KILL,
 * and does not report completion until the group has drained or the bounded
 * drain window has expired. The caller always treats an undrained result as a
 * refusal, never as usable review evidence.
 */
// DEFAULT real-review launcher. runTool's default path launches a CONTAINED
// reviewer child, so the sandbox must be proven before that spawn. The proof
// lives here rather than in runContainedWithWatchdog because the generic
// watchdog also supervises already-contained or plain direct children (the
// process.execPath lifecycle fixtures), which must stay capability-free.
//
// This wrapper is selected ONLY as runTool's default. An injected
// watchdogRunner still replaces it wholesale, so simulated launches never
// attempt nested OS profile application. There is no flag and no bypass:
// the default path cannot reach a real contained spawn without this assertion.
function launchContainedReviewWithWatchdog(contained, opts = {}) {
  assertSandboxOperational();
  return runContainedWithWatchdog(contained, opts);
}

function runContainedWithWatchdog(contained, opts = {}) {
  const timeoutMs = Math.max(1, Number(opts.timeoutMs) || 1);
  const activityExtendsTimeout = opts.activityExtendsTimeout === true;
  const hardTimeoutMs = Math.max(timeoutMs, Number(opts.hardTimeoutMs) || timeoutMs);
  const killGraceMs = Math.max(25, Number(opts.killGraceMs) || REVIEW_KILL_GRACE_MS);
  const maxOutputBytes = Math.max(1, Number(opts.maxOutputBytes) || MAX_REVIEW_OUTPUT_BYTES);
  const groupAlive = typeof opts.processGroupAlive === 'function' ? opts.processGroupAlive : processGroupAlive;
  const groupMembers = typeof opts.processGroupMembers === 'function'
    ? opts.processGroupMembers : processGroupMembers;
  const signalGroup = typeof opts.signalProcessGroup === 'function' ? opts.signalProcessGroup : signalProcessGroup;
  const hasStdinInput = opts.stdinInput !== undefined && opts.stdinInput !== null;
  const stdinInput = hasStdinInput
    ? (Buffer.isBuffer(opts.stdinInput) ? opts.stdinInput : Buffer.from(String(opts.stdinInput), 'utf8'))
    : null;
  const stdinWriter = typeof opts.stdinWriter === 'function'
    ? opts.stdinWriter
    : ((stream, input, callback) => stream.end(input, callback));
  let child;
  try {
    child = spawn(contained.bin, contained.argv || [], {
      encoding: 'utf8',
      cwd: opts.cwd,
      detached: process.platform !== 'win32',
      stdio: [hasStdinInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: opts.env,
    });
  } catch (error) {
    const structuredError = {
      code: error && error.code ? String(error.code) : 'SPAWN_FAILED',
      message: error && error.message ? String(error.message) : String(error),
    };
    return Promise.resolve({
      status: null,
      signal: null,
      error: structuredError,
      timedOut: false,
      timeoutReason: null,
      outputOverflow: false,
      terminationSignals: [],
      terminationFailures: [],
      processGroupId: null,
      groupDrained: true,
      stdinDelivery: hasStdinInput ? {
        delivered: false,
        bytes: stdinInput.length,
        sha256: sha256Hex(stdinInput),
        error: structuredError,
      } : null,
      stdout: '',
      stderr: '',
    });
  }
  const ownedChild = child;
  const ownedProcessGroupId = child.pid;

  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let timedOut = false;
    let timeoutReason = null;
    let outputOverflow = false;
    let spawnError = null;
    let terminationStarted = false;
    let childClosed = false;
    let drainageProvenBeforeClose = false;
    let settling = false;
    let settled = false;
    let graceTimer = null;
    let timeout = null;
    let hardStop = null;
    let absoluteStop = null;
    let refreshActivityTimeout = () => {};
    let stdinSettled = !hasStdinInput;
    let stdinDelivered = false;
    let stdinError = null;
    const terminationSignals = [];
    const terminationFailures = [];

    const ownsLiveChild = (allowSettling = false) => !childClosed && !settled
      && (allowSettling || !settling)
      && child === ownedChild && ownedChild.pid === ownedProcessGroupId;

    const probeOwnedGroup = (phase, allowSettling = false) => {
      if (!ownsLiveChild(allowSettling)) return null;
      try {
        const result = groupAlive(ownedProcessGroupId);
        if (result === true || result === false) return result;
        throw new Error(`process-group probe returned non-boolean ${String(result)}`);
      } catch (error) {
        terminationFailures.push({
          signal: 'PROBE', phase,
          code: error && error.code ? String(error.code) : null,
          message: error && error.message ? String(error.message) : String(error),
        });
        return null;
      }
    };

    const attemptSignal = (signal, phase, allowSettling = false) => {
      if (!ownsLiveChild(allowSettling)) return false;
      try {
        if (signalGroup(ownedProcessGroupId, signal)) {
          terminationSignals.push(signal);
          return true;
        }
      } catch (error) {
        terminationFailures.push({
          signal,
          phase,
          code: error && error.code ? String(error.code) : null,
          message: error && error.message ? String(error.message) : String(error),
        });
      }
      return false;
    };

    const listOwnedGroupMembers = (phase) => {
      try {
        const result = groupMembers(ownedProcessGroupId);
        if (!Array.isArray(result)
            || result.some((pid) => !Number.isInteger(pid) || pid <= 0)) {
          throw new Error('process-group member probe returned an invalid member list');
        }
        return Array.from(new Set(result));
      } catch (error) {
        terminationFailures.push({
          signal: 'PROBE', phase,
          code: error && error.code ? String(error.code) : null,
          message: error && error.message ? String(error.message) : String(error),
        });
        return null;
      }
    };

    const recordReusedGroupRefusal = (phase) => {
      terminationFailures.push({
        signal: 'PROBE', phase,
        code: 'PROCESS_GROUP_REUSED',
        message: 'the former reviewer process-group id now has a leader process; signalling authority was relinquished',
      });
    };

    const waitForClosedGroupDrain = async (phase, waitMs) => {
      const deadline = Date.now() + waitMs;
      do {
        const members = listOwnedGroupMembers(phase);
        if (members === null) return false;
        if (members.length === 0) return true;
        // The original leader has already emitted close and cannot still be a
        // member. Seeing pid===pgid therefore proves numeric PGID reuse. Read
        // probes remain safe, but signalling that new group is forbidden.
        if (members.includes(ownedProcessGroupId)) {
          recordReusedGroupRefusal(phase);
          return false;
        }
        await sleep(25);
      } while (Date.now() < deadline);
      const members = listOwnedGroupMembers(`${phase}-final`);
      if (members === null) return false;
      if (members.includes(ownedProcessGroupId)) {
        recordReusedGroupRefusal(`${phase}-final`);
        return false;
      }
      return members.length === 0;
    };

    const signalClosedResidualGroup = (signal, phase) => {
      const members = listOwnedGroupMembers(`${phase}-pre-signal`);
      if (members === null || members.length === 0) return members !== null;
      if (members.includes(ownedProcessGroupId)) {
        recordReusedGroupRefusal(`${phase}-pre-signal`);
        return false;
      }
      try {
        if (signalGroup(ownedProcessGroupId, signal)) terminationSignals.push(signal);
        return true;
      } catch (error) {
        terminationFailures.push({
          signal, phase,
          code: error && error.code ? String(error.code) : null,
          message: error && error.message ? String(error.message) : String(error),
        });
        return false;
      }
    };

    const proveClosedGroupDrain = async () => {
      const members = listOwnedGroupMembers('close-proof');
      if (members === null) return false;
      if (members.length === 0) return true;
      if (members.includes(ownedProcessGroupId)) {
        recordReusedGroupRefusal('close-proof');
        return false;
      }

      // The group still exists after its original leader closed, so these are
      // descendants of the owned review invocation. Drain them before review
      // output can become usable or the disposable sandbox can be removed.
      terminationStarted = true;
      signalClosedResidualGroup('SIGTERM', 'close-residual');
      if (await waitForClosedGroupDrain('close-term-drain', killGraceMs)) return true;
      signalClosedResidualGroup('SIGKILL', 'close-residual');
      return waitForClosedGroupDrain('close-kill-drain', killGraceMs);
    };

    const finish = async (status, signal, source) => {
      if (settled || settling) return;
      settling = true;
      clearTimeout(timeout);
      clearTimeout(hardStop);
      clearTimeout(absoluteStop);
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      // Before close, the immutable ChildProcess lifetime authorises the
      // existing numeric-group probe. After close, use a read-only member
      // snapshot first: an empty list proves drainage, a leader pid proves
      // reuse and forbids signalling, and leaderless members are residual
      // descendants of the still-existing owned group.
      if (source !== 'close') {
        const alive = probeOwnedGroup('finish', true);
        if (alive === true) {
          attemptSignal('SIGKILL', 'finish', true);
          for (let i = 0; i < 20; i++) {
            const stillAlive = probeOwnedGroup('finish-drain', true);
            if (stillAlive === false) {
              drainageProvenBeforeClose = true;
              break;
            }
            if (stillAlive === null) break;
            await sleep(25);
          }
        } else if (alive === false) {
          drainageProvenBeforeClose = true;
        }
      }
      if (childClosed || source === 'close') {
        drainageProvenBeforeClose = await proveClosedGroupDrain();
      }
      if (hasStdinInput && !stdinSettled) {
        stdinSettled = true;
        stdinError = { code: 'STDIN_CLOSED_EARLY', message: 'reviewer process closed before complete stdin delivery was acknowledged' };
        try { child.stdin.destroy(); } catch { /* result remains fail-closed */ }
      }
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      const groupDrained = drainageProvenBeforeClose;
      settled = true;
      settling = false;
      resolve({
        status,
        signal,
        error: spawnError,
        timedOut,
        timeoutReason,
        outputOverflow,
        terminationSignals,
        terminationFailures,
        processGroupId: ownedProcessGroupId,
        groupDrained,
        stdinDelivery: hasStdinInput ? {
          delivered: stdinDelivered,
          bytes: stdinInput.length,
          sha256: sha256Hex(stdinInput),
          error: stdinError,
        } : null,
        stdout: out,
        stderr: err,
      });
    };

    const capture = (bucket, chunk) => {
      if (settled || settling) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = Math.max(0, maxOutputBytes - capturedBytes);
      if (remaining > 0) bucket.push(buffer.subarray(0, remaining));
      capturedBytes += buffer.length;
      refreshActivityTimeout();
      if (capturedBytes > maxOutputBytes && !outputOverflow) {
        outputOverflow = true;
        beginTermination();
      }
    };

    const beginTermination = () => {
      if (settled || settling || childClosed || terminationStarted || !ownedProcessGroupId
          || child !== ownedChild || ownedChild.pid !== ownedProcessGroupId) return;
      terminationStarted = true;
      attemptSignal('SIGTERM', 'initial');
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (settled || settling || childClosed || child !== ownedChild
            || ownedChild.pid !== ownedProcessGroupId) return;
        const alive = probeOwnedGroup('grace');
        if (alive === false) drainageProvenBeforeClose = true;
        else if (alive === true) attemptSignal('SIGKILL', 'grace');
      }, killGraceMs).unref();
      hardStop = setTimeout(() => {
        if (settled || settling || childClosed || child !== ownedChild
            || ownedChild.pid !== ownedProcessGroupId) return;
        if (probeOwnedGroup('hard-stop') === true) attemptSignal('SIGKILL', 'hard-stop');
        child.stdout.destroy();
        child.stderr.destroy();
        setTimeout(() => finish(null, 'SIGKILL', 'hard-stop'), 100).unref();
      }, killGraceMs + 1_000);
    };

    child.stdout.on('data', (chunk) => capture(stdout, chunk));
    child.stderr.on('data', (chunk) => capture(stderr, chunk));
    child.once('error', (error) => {
      if (settled || settling) return;
      spawnError = error;
    });
    child.once('exit', () => {
      if (!terminationStarted || settled || settling || childClosed) return;
      const alive = probeOwnedGroup('exit');
      if (alive === false) drainageProvenBeforeClose = true;
    });

    const triggerTimeout = (reason) => {
      if (settled || settling) return;
      timedOut = true;
      timeoutReason = reason;
      beginTermination();
    };

    const scheduleActivityTimeout = () => {
      if (!activityExtendsTimeout || settled || settling || terminationStarted) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => triggerTimeout('no-output-progress'), timeoutMs);
    };
    refreshActivityTimeout = scheduleActivityTimeout;
    timeout = setTimeout(() => triggerTimeout(activityExtendsTimeout
      ? 'no-output-progress' : 'wall-clock'), timeoutMs);
    if (hardTimeoutMs > timeoutMs) {
      absoluteStop = setTimeout(() => triggerTimeout('hard-cap'), hardTimeoutMs);
    }

    child.once('close', (status, signal) => {
      childClosed = true;
      finish(status, signal, 'close');
    });
    if (hasStdinInput) {
      const settleStdin = (error) => {
        if (settled || settling || stdinSettled) return;
        stdinSettled = true;
        if (error) {
          stdinError = {
            code: error && error.code ? String(error.code) : 'STDIN_WRITE_FAILED',
            message: error && error.message ? String(error.message) : String(error),
          };
          beginTermination();
        } else {
          stdinDelivered = true;
        }
      };
      child.stdin.once('error', settleStdin);
      try { stdinWriter(child.stdin, stdinInput, settleStdin); }
      catch (error) { settleStdin(error); }
    }
  });
}

async function runTool(reviewer, prompt, timeoutSec, opts = {}) {
  const t = TOOLS[reviewer];
  if (!t) return { ok: false, reason: `unknown reviewer ${reviewer}` };
  const gateResult = authorizeLaunch(reviewer, reviewer === 'grok'
    ? { ...opts, invocationId: opts.invocationId,
      deferSubscriptionProof: true, preflightStage: 'adapter-billing-preflight' } : opts);
  if (!gateResult.ok) return { ok: false, reason: gateResult.reason, raw: '' };
  const spendContract = reviewer === 'grok' ? gateResult.route.spendContract : null;
  if (!isExecutable(t.bin)) {
    return { ok: false, reason: `${t.label} is not executable at ${t.bin}`, raw: '' };
  }
  // ONE builder for both reviewers — buildToolArgv() is the same function the
  // red proofs assert against, so the tested argv and the executed argv cannot
  // drift. Duplicating this list is exactly how maxTurns came to be "declared
  // in policy, enforced nowhere".
  const bounds = reviewer === 'codex' ? null : gateResult.route.bounds;
  if (reviewer !== 'codex') {
    // Sub-agents are expressed by OMITTING --agents. If a policy ever turns them
    // on, this adapter refuses rather than silently ignoring the setting.
    if (bounds && bounds.subagents === true) {
      return { ok: false, reason: 'policy enables sub-agents for adversarial-review; this adapter deliberately does not implement that path', raw: '' };
    }
  }
  let sandbox;
  let retainReviewSandbox = false;
  try {
    sandbox = prepareReviewSandbox(opts.reviewPaths || [], opts.sourceRoot || ROOT);
  } catch (error) {
    return { ok: false, reason: `review sandbox preparation failed: ${error.message}`, raw: '' };
  }
  try {
    let manifestSnapshot;
    try { manifestSnapshot = validateReviewManifestSnapshot(sandbox, 'post-copy', opts.sourceRoot || ROOT); }
    catch (error) {
      return { ok: false, reason: `review manifest changed before launch: ${error.message}`,
        raw: '', stdout: '', stderr: '',
        manifestSnapshot: { complete: false, phase: 'post-copy', reason: error.message } };
    }
    if (typeof opts.validateSubjectSnapshot === 'function') {
      try { opts.validateSubjectSnapshot('post-copy', sandbox); }
      catch (error) {
        return { ok: false, reason: `review subject changed before launch: ${error.message}`,
          raw: '', stdout: '', stderr: '', subjectSnapshot: { complete: false, phase: 'post-copy' } };
      }
    }
    let billingPreflight = null;
    if (reviewer === 'grok') {
      billingPreflight = await grokBillingPreflight(sandbox, opts);
      if (!billingPreflight.ok) {
        retainReviewSandbox = billingPreflight.retainSandbox === true;
        return {
          ok: false,
          reason: `Grok zero-metered billing preflight refused launch: ${billingPreflight.reason}`,
          raw: '', stdout: '', stderr: '', billingPreflight, spendContract,
        };
      }
      const finalGate = authorizeLaunch(reviewer, {
        ...opts, invocationId: opts.invocationId, subscriptionProof: billingPreflight,
      });
      if (!finalGate.ok) {
        return { ok: false, reason: `Grok final billing authorization refused launch: ${finalGate.reason}`,
          raw: '', stdout: '', stderr: '', billingPreflight, spendContract };
      }
    }
    let codexInput = null;
    if (reviewer === 'codex') {
      try {
        codexInput = buildCodexInput(prompt, sandbox, opts.reviewPaths || [], {
          bundleLimitBytes: opts.codexBundleLimitBytes,
          inputLimitBytes: opts.codexInputLimitBytes,
          inputLimitCharacters: opts.codexInputLimitCharacters,
        });
      } catch (error) {
        return {
          ok: false,
          reason: `Codex exact input delivery refused before launch: ${error.message}`,
          raw: '', stdout: '', stderr: '',
          inputDelivery: Object.freeze({ complete: false, delivered: false, reason: error.message }),
        };
      }
    }
    const argv = buildToolArgv(reviewer, prompt, bounds, sandbox.cwd);
    let contained;
    try { contained = containedReviewerCommand(reviewer, sandbox, argv); }
    catch (e) { return { ok: false, reason: `OS containment unavailable: ${e.message}`, raw: '' }; }
    const watchdogRunner = typeof opts.watchdogRunner === 'function'
      ? opts.watchdogRunner : launchContainedReviewWithWatchdog;
    let reviewExecutableIdentity = null;
    if (reviewer === 'grok') {
      reviewExecutableIdentity = validateGrokExecutableIdentity({
        versionRunner: opts.grokVersionRunner,
        digestRunner: opts.grokDigestRunner,
      });
      if (!reviewExecutableIdentity.ok) {
        return {
          ok: false,
          reason: `Grok executable identity refused reviewer launch: ${reviewExecutableIdentity.reason}`,
          raw: '', stdout: '', stderr: '', billingPreflight, spendContract, reviewExecutableIdentity,
        };
      }
    }
    // A reviewer launch is about to happen and no drainage evidence exists yet.
    // If this invocation dies here the caller must read UNKNOWN, never "no
    // reviewer was launched".
    noteReviewerLifecycle(opts, 'UNKNOWN', 'runtool-launch-attempted');
    const r = await watchdogRunner(contained, {
      timeoutMs: timeoutSec * 1000,
      activityExtendsTimeout: true,
      hardTimeoutMs: (timeoutSec + Math.min(timeoutSec, 300)) * 1000,
      maxOutputBytes: MAX_REVIEW_OUTPUT_BYTES,
      cwd: sandbox.cwd,
      env: reviewerEnvironment(reviewer, sandbox),
      stdinInput: codexInput ? codexInput.inputBuffer : null,
      stdinWriter: opts.stdinWriter,
    });
    // Reviewer output stays EXACTLY as the process produced it here. Every
    // protocol decision downstream — extractJson, the Grok receipt stream,
    // validateCodexInspectionProofs, the terminal-envelope check — is
    // byte-exact against the reviewer's own bytes, so scrubbing at this point
    // makes those checks read text the reviewer never wrote. Redaction is a
    // PUBLICATION step and belongs at the durable write boundary; see
    // redactDurableReviewEvidence.
    const stdout = r.stdout || '';
    const stderr = r.stderr || '';
    const raw = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '');
    const terminationEvidence = Object.freeze({
      processGroupId: r.processGroupId,
      signals: Array.isArray(r.terminationSignals) ? r.terminationSignals.slice() : [],
      failures: Array.isArray(r.terminationFailures) ? r.terminationFailures.slice() : [],
      groupDrained: r.groupDrained === true,
    });
    noteReviewerLifecycle(opts, reviewerLifecycleFromTermination(terminationEvidence),
      'runtool-watchdog-drainage-evidence');
    const terminationFailureNote = terminationEvidence.failures.length
      ? `; termination signalling failed: ${terminationEvidence.failures.map((failure) =>
        `${failure.phase}/${failure.signal}${failure.code ? ` ${failure.code}` : ''}: ${failure.message}`).join(' | ')}`
      : '';
    const inputDelivery = codexInput ? (() => {
      const transport = r.stdinDelivery || null;
      const delivered = !!(transport && transport.delivered === true
        && transport.bytes === codexInput.inputDelivery.inputBytes
        && transport.sha256 === codexInput.inputDelivery.inputSha256
        && !transport.error);
      const completed = {
        ...codexInput.inputDelivery,
        delivered,
        complete: delivered,
        transport: transport ? {
          bytes: transport.bytes,
          sha256: transport.sha256,
          error: transport.error || null,
        } : null,
      };
      return Object.freeze({
        ...completed,
        deliveryAttestationSha256: sha256Hex(Buffer.from(stableJson(completed), 'utf8')),
      });
    })() : null;
    const readCoverage = reviewer === 'grok'
      ? grokReadReceiptCoverage(stdout, sandbox.manifest, sandbox.cwd)
      : null;
    try { manifestSnapshot = validateReviewManifestSnapshot(sandbox, 'post-run', opts.sourceRoot || ROOT); }
    catch (error) {
      manifestSnapshot = { complete: false, phase: 'post-run', reason: error.message };
    }
    let subjectSnapshot = { complete: true, phase: 'post-run' };
    if (typeof opts.validateSubjectSnapshot === 'function') {
      try { opts.validateSubjectSnapshot('post-run', sandbox); }
      catch (error) {
        subjectSnapshot = { complete: false, phase: 'post-run', reason: error.message };
      }
    }
    const spendAuthorization = reviewer === 'grok'
      ? authoritativeGrokSpend(stdout, opts.capUsd) : null;
    const completionEvidence = reviewer === 'codex' ? Object.freeze({
      authority: 'review-adapters.cjs runTool',
      status: Number.isInteger(r.status) ? r.status : null,
      timedOut: r.timedOut === true,
      outputOverflow: r.outputOverflow === true,
      error: r.error ? String(r.error.message || r.error) : null,
      groupDrained: r.groupDrained === true,
      inputComplete: Boolean(inputDelivery && inputDelivery.complete === true),
      subjectSnapshotComplete: subjectSnapshot && subjectSnapshot.complete === true,
      manifestSnapshotComplete: manifestSnapshot && manifestSnapshot.complete === true,
      complete: r.status === 0 && r.timedOut !== true && r.outputOverflow !== true
        && !r.error && r.groupDrained === true
        && Boolean(inputDelivery && inputDelivery.complete === true)
        && subjectSnapshot && subjectSnapshot.complete === true
        && manifestSnapshot && manifestSnapshot.complete === true,
    }) : null;
    const commonEvidence = { raw, stdout, stderr, readCoverage, inputDelivery,
      terminationEvidence, subjectSnapshot, manifestSnapshot, spendAuthorization,
      spendContract, billingPreflight, reviewExecutableIdentity, completionEvidence };
    if (reviewer === 'codex' && (!inputDelivery || !inputDelivery.complete)) {
      const detail = r.error
        ? `spawn failed: ${r.error.message}`
        : inputDelivery && inputDelivery.transport && inputDelivery.transport.error
        ? `${inputDelivery.transport.error.code || 'STDIN_WRITE_FAILED'}: ${inputDelivery.transport.error.message}`
        : 'the reviewer transport did not acknowledge the exact stdin bytes and digest';
      return { ok: false, reason: `Codex exact input delivery was not proven (${detail})`, ...commonEvidence };
    }
    if (r.timedOut) {
      return { ok: false, reason: `${t.label} exceeded the ${timeoutSec}s timeout${terminationFailureNote}`, ...commonEvidence };
    }
    if (r.outputOverflow) {
      return { ok: false, reason: `${t.label} exceeded the bounded ${MAX_REVIEW_OUTPUT_BYTES}-byte output limit${terminationFailureNote}`, ...commonEvidence };
    }
    if (!r.groupDrained) {
      retainReviewSandbox = true;
      const reaper = await reapUndrainedReviewerGroup(terminationEvidence, opts.reaperOptions || {});
      if (reaper.drained) retainReviewSandbox = false;
      // The bounded reaper's own identity-bound probe is drainage proof of the
      // same kind the watchdog produces. The review stays refused either way.
      noteReviewerLifecycle(opts, reaper.drained ? 'LAUNCHED_DRAINED' : 'LAUNCHED_UNDRAINED',
        'runtool-bounded-reaper-drainage');
      return { ok: false, reason: `${t.label} process group did not drain after forced termination${terminationFailureNote}`, ...commonEvidence,
        sandboxRetention: Object.freeze({ retained: retainReviewSandbox,
          cleanup: 'bounded-identity-bound-reaper', reason: reaper.reason,
          attempts: reaper.attempts.length }) };
    }
    if (!subjectSnapshot.complete) {
      return { ok: false, reason: `review subject changed during execution: ${subjectSnapshot.reason}`, ...commonEvidence };
    }
    if (!manifestSnapshot.complete) {
      return { ok: false, reason: `review manifest changed during execution: ${manifestSnapshot.reason}`, ...commonEvidence };
    }
    if (r.error) return { ok: false, reason: `${t.label} failed to start: ${r.error.message}`, ...commonEvidence };
    if (r.status !== 0) return { ok: false, reason: `${t.label} exited ${r.status}`, ...commonEvidence };
    if (reviewer === 'grok' && (!spendAuthorization || !spendAuthorization.ok)) {
      return { ok: false, reason: `Grok post-run telemetry validation failed: ${spendAuthorization ? spendAuthorization.reason : 'missing terminal cost evidence'}`, ...commonEvidence };
    }
    return { ok: true, ...commonEvidence };
  } finally {
    if (!retainReviewSandbox) cleanupReviewSandbox(sandbox);
  }
}

async function cmdRun(args) {
  const reviewer = args.reviewer;
  if (!reviewer) return usage('--reviewer is required');
  if (!['codex', 'grok', 'copilot'].includes(reviewer)) return usage(`unknown reviewer ${reviewer}`);
  if (!args.packet) return usage('--packet is required');
  if (!fs.existsSync(args.packet)) return usage(`packet not found: ${args.packet}`);

  const packet = JSON.parse(fs.readFileSync(args.packet, 'utf8'));
  if (Array.isArray(packet.hostContainmentRequired) && packet.hostContainmentRequired.length && !args.runId) {
    console.error('[review-adapters] refusing beta/dashboard review without mandatory --run-id canonical coordinate');
    return EXIT_BLOCK;
  }
  let runContext = Object.freeze({ runId: null, sourceRoot: fs.realpathSync(ROOT), gitEnv: null });
  if (args.runId) {
    try { runContext = resolveCanonicalRunContext(args.runId, args.packet); }
    catch (error) {
      console.error(`[review-adapters] refusing invalid canonical run coordinate: ${error.message}`);
      return EXIT_BLOCK;
    }
  }
  let reviewDataClass;
  try { reviewDataClass = resolveReviewDataClass(runContext, args.dataClass); }
  catch (error) {
    console.error(`[review-adapters] refusing review data class: ${error.message}`);
    return EXIT_BLOCK;
  }
  const subject = subjectOf(args, runContext);
  const canonicalSubject = Object.freeze({
    ...subject,
    subjectPaths: Object.freeze(subject.subjectPaths.slice()),
  });

  // The adapter is the execution boundary, so the review-cycle stop belongs
  // here as well as in engineering-os --start. A printed recipe is guidance;
  // this check is enforcement. It also permits only the missing reviewer(s)
  // on an incomplete third subject and refuses duplicates.
  try {
    const reviewCycle = require('./review-cycle.cjs');
    const engos = require('./engineering-os.cjs');
    const classification = engos.classify(canonicalSubject.subjectPaths, {});
    const loaded = reviewCycle.loadRecords(REVIEWS_DIR, {
      validateReview: engos.loadReview,
      packetPath: args.packet,
      packetId: packet.packetId,
    });
    if (loaded.problems.length) {
      throw new Error(`review-cycle evidence is invalid: ${loaded.problems.map((p) => `${p.code} ${path.basename(p.file)}: ${p.detail}`).join('; ')}`);
    }
    const decision = reviewCycleLaunchDecision({
      records: loaded.records,
      packetId: packet.packetId,
      requiredReviewers: classification.requiredReviewers,
      currentSubjectSha: canonicalSubject.subjectSha256,
      reviewer,
    });
    if (!decision.ok) throw new Error(decision.reason);
  } catch (error) {
    console.error(`[review-adapters] refusing review-cycle launch: ${error.message}`);
    return EXIT_BLOCK;
  }

  // Chunked review: the reviewer sees only this group's paths, but the record
  // stays bound to the FULL subject hash. That is what lets several group
  // records aggregate into one verdict about one revision — and what stops a
  // group verdict being reused against a different revision.
  if (args.onlyPaths && args.onlyPaths.length) {
    const inSubject = new Set(subject.subjectPaths);
    const foreign = args.onlyPaths.filter((p) => !inSubject.has(p));
    if (foreign.length) {
      console.error(`[review-adapters] refusing: ${foreign.length} --only-path value(s) are not in the subject: ${foreign.slice(0, 4).join(', ')}`);
      return EXIT_BLOCK;
    }
    subject.subjectPaths = args.onlyPaths.slice().sort();
  }

  if (args.subjectSha && args.subjectSha !== subject.subjectSha256) {
    console.error(`[review-adapters] refusing to review: --subject-sha ${args.subjectSha.slice(0, 12)}… does not match the current subject ${subject.subjectSha256.slice(0, 12)}…`);
    return EXIT_BLOCK;
  }

  let boundedReviewPaths;
  try { boundedReviewPaths = resolveBoundedReviewPaths(subject, packet, runContext.sourceRoot); }
  catch (e) {
    console.error(`[review-adapters] refusing unbounded review: ${e.message}`);
    return EXIT_BLOCK;
  }

  fs.mkdirSync(REVIEWS_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const invocation = createInvocationIdentity(reviewer);
  const ts = invocation.ts;

  // Copilot IS installed and authenticated here — and it still produces
  // UNAVAILABLE, deliberately. The reason is not that the tool is missing; it
  // is that Copilot holds no approval authority (approvalAuthority NONE in the
  // canon), so a record from it could never satisfy a required review. Writing
  // an UNAVAILABLE record with that reason stated keeps the audit trail honest
  // about WHY, which matters more now than it did when the tool was absent: a
  // working binary is far more tempting to count than a missing one.
  if (reviewer === 'copilot') {
    const d = detect().copilot;
    const record = buildRecord({
      reviewer: 'copilot',
      reviewerModel: 'github-copilot-cli (advisory repository guardian)',
      packetId: packet.packetId,
      subject,
      parsed: null,
      unavailableReason:
        `No gate review was collected from Copilot, and none can be. Copilot is an ADVISORY repository guardian with approvalAuthority NONE in the Tool Capability Canon: it may comment, it may not approve, and a required review is never satisfied by it. Local detection reports: ${d.status} — ${d.detail}.`,
      ts,
      invocationId: invocation.reviewId,
    });
    return writeRecord(record, invocation.base, '(no tool invoked — Copilot is advisory and is never launched as a gate reviewer)', { packetPath: args.packet });
  }

  const diff = subjectDiff(subject, args, runContext);
  let checkBinding;
  try {
    checkBinding = resolveCanonicalCheckReceipt(
      args.packet, packet, canonicalSubject, undefined,
      runContext.runId ? { runId: runContext.runId } : {});
  }
  catch (error) {
    console.error(`[review-adapters] refusing review without canonical deterministic evidence: ${error.message}`);
    return EXIT_BLOCK;
  }
  let priorFindings;
  try {
    priorFindings = eligiblePriorFindings(
      args.packet, packet.packetId, canonicalSubject.subjectSha256, reviewer, REVIEWS_DIR,
      {
        checkReceiptSha256: checkBinding.receipt.receiptSha256,
        // Absent flag => no map => no prior finding is presented as currently
        // unresolved. Stale history can only become a live target when an
        // operator supplies proof bound to this subject and this receipt.
        proofMap: args.currentStateProofMap || null,
      });
  } catch (error) {
    console.error(`[review-adapters] refusing review with untrusted prior evidence: ${error.message}`);
    return EXIT_BLOCK;
  }
  const promptContext = {
    specs: (packet.sourceOfTruth || []).filter((p) => fs.existsSync(path.join(runContext.sourceRoot, p))).map((p) => ({
      path: p,
      sha: crypto.createHash('sha256').update(fs.readFileSync(path.join(runContext.sourceRoot, p))).digest('hex'),
    })),
    checks: checkBinding.receipt.results,
    checkReceipt: checkBinding.receipt,
    unverified: packet.stopConditions || [],
    priorFindings,
  };
  const prompt = reviewer === 'codex'
    ? codexPrompt(packet.objective, subject, diff, promptContext)
    : grokPrompt(packet.objective, subject, diff, promptContext);

  if (args.dryRun) {
    console.log(`[review-adapters] DRY RUN — ${reviewer}: would send ${prompt.length} chars over ${subject.subjectPaths.length} subject path(s). No tool invoked.`);
    return EXIT_PASS;
  }

  const timeoutSec = Number(args.timeout) > 0 ? Number(args.timeout) : 900;
  const res = await runTool(reviewer, prompt, timeoutSec, {
    // Absent on the command line; supplied only by the callable entry, which
    // has no terminal to read the reviewer's process evidence from.
    lifecycleSink: args.lifecycleSink,
    invocationId: invocation.reviewId,
    dataClass: reviewDataClass,
    allowMetered: args.allowMetered,
    approvedBy: args.approvedBy,
    capUsd: args.capUsd,
    reviewPaths: boundedReviewPaths,
    sourceRoot: runContext.sourceRoot,
    validateSubjectSnapshot(phase) {
      const current = subjectOf(args, runContext);
      const same = current.subjectSha256 === canonicalSubject.subjectSha256
        && stableJson(current.subjectPaths.slice().sort()) === stableJson(canonicalSubject.subjectPaths.slice().sort())
        && current.diffBytes === canonicalSubject.diffBytes
        && (current.range || null) === (canonicalSubject.range || null);
      if (!same) throw new Error(`${phase}: canonical subject coordinates no longer match the copied snapshot`);
      if (sha256Hex(fs.readFileSync(fs.realpathSync(path.resolve(args.packet)))) !== checkBinding.packetSha256) {
        throw new Error(`${phase}: canonical packet bytes no longer match the validated check receipt`);
      }
    },
  });
  const rawPath = path.join(RAW_DIR, `${invocation.base}.txt`);
  const rawInputDelivery = res.inputDelivery
    ? `\n--- inputDelivery ---\n${JSON.stringify(res.inputDelivery, null, 2)}\n`
    : '';
  const rawControlEvidence = (res.spendAuthorization || res.billingPreflight || res.reviewExecutableIdentity || res.subjectSnapshot || res.manifestSnapshot || res.completionEvidence)
    ? `\n--- controlEvidence ---\n${JSON.stringify({
      spendAuthorization: res.spendAuthorization || null,
      billingPreflight: res.billingPreflight || null,
      reviewExecutableIdentity: res.reviewExecutableIdentity || null,
      subjectSnapshot: res.subjectSnapshot || null,
      manifestSnapshot: res.manifestSnapshot || null,
      completionEvidence: res.completionEvidence || null,
    }, null, 2)}\n`
    : '';
  const rawTranscript = (res.raw || '(no output captured)') + rawInputDelivery + rawControlEvidence;
  // NOTHING durable is written until the reviewer's exact bytes have been
  // parsed and validated. The raw transcript used to be published here, before
  // any of that ran; because the bytes were already scrubbed by then, the
  // byte-exact inspection challenge could not match its own answer. Publication
  // now happens once, below, after validation — and never before it.
  let rawPublished = false;
  const publishRawTranscript = (validatedInspection) => {
    if (rawPublished) return;
    rawPublished = true;
    writeImmutableFile(rawPath, redactDurableReviewEvidence({
      raw: rawTranscript, codexInspection: validatedInspection,
    }).raw);
  };

  // Failed Codex transport still becomes durable UNAVAILABLE evidence. It
  // carries zero verified changedPaths and can never satisfy a reviewer slot,
  // but it lets the operator distinguish a bounded transport refusal from a
  // reviewer that was never launched. The schema permits zero paths only for
  // UNAVAILABLE; engineering-os rejects them for every substantive verdict.

  const protocolText = reviewerProtocolText(reviewer, res);
  let parsed = res.ok
    ? (reviewer === 'grok' ? extractGrokStreamingReview(protocolText, res.readCoverage) : extractJson(protocolText))
    : null;
  // When a tool exits 0 but returns no usable record, "no parseable JSON" is
  // true but unhelpfully vague — and a vague UNAVAILABLE reason is the kind of
  // thing an operator learns to ignore. Several CLIs report why they stopped
  // (cancelled, max turns, context limit); surface that instead when present,
  // because "cancelled after 9 turns" and "returned prose" call for completely
  // different responses.
  let why = res.ok ? 'the reviewer ran but produced no parseable JSON review record' : res.reason;
  let codexInspection = null;

  // Truncation guard — applied BEFORE the payload is trusted.
  if (res.ok) {
    const receiptResult = enforceGrokReadReceipts(reviewer, parsed, res.readCoverage);
    if (!receiptResult.parsed && receiptResult.unavailableReason) {
      why = receiptResult.unavailableReason;
      parsed = null;
    }
  }
  if (res.ok && reviewer === 'codex' && parsed) {
    codexInspection = validateCodexInspectionProofs(parsed, res.inputDelivery);
    if (!codexInspection.complete) {
      why = `Codex inspection coverage was not proven: ${codexInspection.reason}`;
      parsed = null;
    }
  }

  const codexTerminal = reviewer === 'codex'
    ? validateCodexTerminalEnvelope(protocolText, res.completionEvidence)
    : Object.freeze({ ok: true });
  const abnormal = stopWasAbnormal(protocolText);
  if (!codexTerminal.ok) {
    why = `Codex terminal evidence was refused: ${codexTerminal.reason}`;
    parsed = null;
  } else if (abnormal) {
    why = `the reviewer stopped abnormally (${abnormal}) — any verdict in its output describes an unfinished review and is refused`;
    parsed = null;
  } else if (isUsableReview(parsed, reviewer) && looksUnfinished(parsed)) {
    why = 'the reviewer emitted a schema-valid but self-declared PLACEHOLDER verdict (findings marked pending / not yet inspected); refused rather than recorded as a real review';
    parsed = null;
  }
  if (res.ok && !isUsableReview(parsed, reviewer)) {
    const envelope = extractJson(protocolText);
    const stop = envelope && typeof envelope.stopReason === 'string' ? envelope.stopReason : null;
    const turns = envelope && typeof envelope.num_turns === 'number' ? envelope.num_turns : null;
    if (stop && stop !== 'end_turn') {
      why = `the reviewer stopped early (stopReason="${stop}"${turns ? `, ${turns} turns` : ''}) without emitting a review record`;
    }
  }
  // Every byte-exact check against the reviewer's own output has now run. This
  // is the earliest point at which anything may become durable, and it is
  // still before the record is built, so an unexpected failure in record
  // construction cannot cost the operator the transcript.
  //
  // Only an attestation this process produced buys verbatim preservation. When
  // Codex coverage was refused, codexInspection is incomplete and not in the
  // WeakSet, so the transcript is scrubbed with nothing preserved.
  publishRawTranscript(reviewer === 'codex' ? codexInspection : null);

  const record = buildRecord({
    reviewer,
    reviewerModel: reviewer === 'codex' ? 'codex-cli (ChatGPT.app)' : 'grok-cli (grok-macos-aarch64)',
    packetId: packet.packetId,
    subject,
    parsed: isUsableReview(parsed, reviewer) ? parsed : null,
    unavailableReason: why,
    ts,
    coveredPaths: reviewer === 'codex'
      ? codexCoveredPaths(res.inputDelivery)
      : (res.readCoverage && res.readCoverage.complete ? res.readCoverage.readPaths : []),
    inputDelivery: reviewer === 'codex' ? res.inputDelivery : null,
    codexInspection: reviewer === 'codex' ? codexInspection : null,
    readCoverage: reviewer === 'grok' ? res.readCoverage : null,
    invocationId: invocation.reviewId,
    spendAuthorization: res.spendAuthorization || null,
    subjectSnapshot: res.subjectSnapshot || null,
    checkReceipt: checkBinding.receipt,
    priorFindings,
  });
  if (args.groupId) {
    record.group = { groupId: args.groupId, groupDigest: args.groupDigest || null };
  }
  // Group records go into reviews/groups/, which the gate does NOT read. Only
  // the aggregate reaches the gate, and only when every group beneath it
  // covered the subject exactly. A stray group record must never be mistaken
  // for a review of the whole change.
  // The record reaches writeRecord already redacted, so the signature, the
  // quarantine copy, the invalid-record diagnostic and the published file all
  // carry the same scrubbed bytes. writeRecord itself stays generic.
  const durable = redactDurableReviewEvidence({
    raw: rawTranscript, record, codexInspection: reviewer === 'codex' ? codexInspection : null,
  });
  return writeRecord(durable.record, `${invocation.base}${args.groupId ? '-' + args.groupId : ''}`, rawPath,
    { packetPath: args.packet, subdir: args.groupId ? 'groups' : null });
}

// ── reviewer process lifecycle evidence ─────────────────────────────────────
// runTool already owns the process-group watchdog and the drainage proof it
// produces; the callable outcome used to drop that evidence, so a caller could
// read RECORD_WRITTEN and still not know whether the reviewer it started ever
// stopped. These fields carry runTool's existing evidence outward and add no
// second monitor. Drainage is never inferred from an exit code, a reviewer
// verdict, a written record, a dead caller, or absent output: a launch whose
// drainage was not proven inside this invocation stays LAUNCHED_UNDRAINED, and
// a launch whose evidence never arrived stays UNKNOWN. This is process
// evidence, never independent review approval.
const REVIEW_PROCESS_LIFECYCLE_STATES = Object.freeze(
  ['NOT_LAUNCHED', 'LAUNCHED_DRAINED', 'LAUNCHED_UNDRAINED', 'UNKNOWN']);
const REVIEW_PROCESS_LIFECYCLE_PROVENANCE = Object.freeze([
  'callable-entry-before-launch',
  'runtool-launch-attempted',
  'runtool-watchdog-drainage-evidence',
  'runtool-bounded-reaper-drainage',
  // The Grok billing preflight starts a DETACHED ACP process group of its own,
  // before the reviewer watchdog exists. It is process activity and gets its
  // own provenance so it can never be read as review execution or approval.
  'grok-billing-preflight-launch-attempted',
  'grok-billing-preflight-drainage-evidence',
  'unavailable',
]);
const REVIEW_PROCESS_LIFECYCLE_BILLING_PROVENANCE = Object.freeze([
  'grok-billing-preflight-launch-attempted',
  'grok-billing-preflight-drainage-evidence',
]);
// Fixed text selected by state. Nothing here interpolates reviewer output, an
// error message, a prompt, a secret, or a filesystem path.
const REVIEW_PROCESS_LIFECYCLE_DETAIL = Object.freeze({
  NOT_LAUNCHED: 'no reviewer process was launched during this invocation',
  LAUNCHED_DRAINED: 'a reviewer process group was launched and this invocation proved it drained',
  LAUNCHED_UNDRAINED: 'a reviewer process group was launched and this invocation did not prove it drained',
  UNKNOWN: 'reviewer process provenance is unavailable for this invocation',
});
// The same four states, said about billing-preflight process activity only.
// Separate fixed text, no interpolation, and none of it claims a review ran.
const REVIEW_PROCESS_LIFECYCLE_BILLING_DETAIL = Object.freeze({
  NOT_LAUNCHED: 'no billing preflight process was launched during this invocation',
  LAUNCHED_DRAINED: 'a billing preflight process group was launched and proved drained; no review ran',
  LAUNCHED_UNDRAINED: 'a billing preflight process group was launched and was not proved drained',
  UNKNOWN: 'billing preflight process provenance is unavailable for this invocation',
});
// How much uncertainty a state carries. Used ONLY to keep the cumulative
// answer from improving: nothing a later process activity proves about itself
// can retire what an earlier one left unproven.
const REVIEW_PROCESS_LIFECYCLE_RANK = Object.freeze({
  NOT_LAUNCHED: 0, LAUNCHED_DRAINED: 1, UNKNOWN: 2, LAUNCHED_UNDRAINED: 3,
});

function reviewProcessLifecycle(state, provenance) {
  const known = REVIEW_PROCESS_LIFECYCLE_STATES.includes(state)
    && REVIEW_PROCESS_LIFECYCLE_PROVENANCE.includes(provenance);
  const resolved = known ? state : 'UNKNOWN';
  const billing = known && REVIEW_PROCESS_LIFECYCLE_BILLING_PROVENANCE.includes(provenance);
  return Object.freeze({
    state: resolved,
    launched: resolved === 'NOT_LAUNCHED' ? false : resolved === 'UNKNOWN' ? null : true,
    drainageProven: resolved === 'LAUNCHED_DRAINED' ? true
      : resolved === 'LAUNCHED_UNDRAINED' ? false : null,
    provenance: known ? provenance : 'unavailable',
    detail: (billing ? REVIEW_PROCESS_LIFECYCLE_BILLING_DETAIL
      : REVIEW_PROCESS_LIFECYCLE_DETAIL)[resolved],
  });
}

// Which process activity a stamp is about. An invocation can start at most two
// process groups — the billing preflight and the reviewer — and each resolves
// only its OWN provisional UNKNOWN.
function reviewLifecycleActivity(provenance) {
  return REVIEW_PROCESS_LIFECYCLE_BILLING_PROVENANCE.includes(provenance)
    ? 'grok-billing-preflight' : 'reviewer-run';
}

// The only reading of runTool's frozen termination evidence. A missing or
// non-boolean drainage flag is UNKNOWN, never "drained".
function reviewerLifecycleFromTermination(terminationEvidence) {
  if (!terminationEvidence || typeof terminationEvidence.groupDrained !== 'boolean') return 'UNKNOWN';
  return terminationEvidence.groupDrained ? 'LAUNCHED_DRAINED' : 'LAUNCHED_UNDRAINED';
}

function noteReviewerLifecycle(opts, state, provenance) {
  const sink = opts && opts.lifecycleSink;
  if (typeof sink === 'function') sink(reviewProcessLifecycle(state, provenance));
}

// Starts at the one thing the callable knows before it delegates: nothing has
// been launched yet. Only runTool and the billing preflight advance it, so a
// refusal that stopped before either spawn cannot be reported as a drained — or
// merely unknown — reviewer.
//
// An invocation can start TWO detached process groups: the Grok billing
// preflight, then the reviewer. Each keeps its own slot, because later evidence
// resolves the activity it describes and no other. What the caller reads is the
// most uncertain slot, so a reviewer that proved its own drainage cannot retire
// an earlier billing spawn this invocation never accounted for. Ties keep the
// most recent stamp, which leaves the ordinary single-activity path reporting
// exactly the provenance that produced it.
function createReviewLifecycleRecorder() {
  const initial = reviewProcessLifecycle('NOT_LAUNCHED', 'callable-entry-before-launch');
  const activities = new Map();
  let sequence = 0;
  return Object.freeze({
    current: () => {
      let worst = null;
      for (const entry of activities.values()) {
        if (!worst || entry.rank > worst.rank
          || (entry.rank === worst.rank && entry.sequence > worst.sequence)) worst = entry;
      }
      return worst ? worst.lifecycle : initial;
    },
    sink: (lifecycle) => {
      const stamp = lifecycle && REVIEW_PROCESS_LIFECYCLE_STATES.includes(lifecycle.state)
        ? lifecycle : reviewProcessLifecycle('UNKNOWN', 'unavailable');
      sequence += 1;
      activities.set(reviewLifecycleActivity(stamp.provenance), {
        lifecycle: stamp,
        rank: REVIEW_PROCESS_LIFECYCLE_RANK[stamp.state],
        sequence,
      });
    },
  });
}

// ── callable review entry ───────────────────────────────────────────────────
// A dashboard-requested review must reach the SAME orchestration the CLI runs,
// not a second one that happens to resemble it. This entry therefore owns no
// review logic: it validates the request shape, then hands cmdRun the exact
// argument object parseArgs would have produced. Canonical run resolution,
// subject and containment checks, launch authorization, billing evidence and
// the bounded review-cycle stop all stay where they already are, so there is
// nothing here to weaken by calling it from somewhere new.
//
// Three differences from the CLI, all deliberate:
//   1. --run-id is OPTIONAL on the command line for legacy control-checkout
//      reviews. It is REQUIRED here. A caller with no terminal has no way to
//      say which isolated worktree it meant, and "whichever run matched" is
//      exactly the ambiguity a non-interactive requester must never resolve.
//   2. The CLI wrapper turns cmdRun's exit code into process.exit(). A callable
//      host — the authenticated HTTP handler that comes NEXT, not here — must
//      survive a refusal, so every bounded failure, including one thrown deeper
//      in the orchestration, is RETURNED as an outcome carrying the same exit
//      code the CLI would have exited with.
//   3. --dry-run is SUPPORTED on the command line and REFUSED here. It returns
//      the PASS code without writing a record, which an operator reads as the
//      printed "no tool invoked" line but a caller could only read as a review
//      that ran. The CLI flag is untouched; see the refusal below.
//
// This file still exposes no network surface and no browser-reachable action.
// The HTTP endpoint and the dashboard button are a later stage; requiring this
// module does not start a review, and neither does importing it.
const CALLABLE_REVIEW_FIELDS = Object.freeze([
  'runId', 'reviewer', 'packet', 'subjectSha', 'base', 'head', 'timeout',
  'dryRun', 'dataClass', 'allowMetered', 'approvedBy', 'capUsd', 'onlyPaths',
  'groupId', 'groupDigest', 'currentStateProofMap',
]);

function reviewCallOutcome(exitCode, reason, processLifecycle) {
  const code = Number.isInteger(exitCode) ? exitCode : EXIT_BLOCK;
  return Object.freeze({
    ok: code === EXIT_PASS,
    exitCode: code,
    outcome: code === EXIT_PASS ? 'RECORD_WRITTEN'
      : code === EXIT_USAGE ? 'REFUSED_REQUEST' : 'REFUSED',
    reason: reason === undefined || reason === null ? null : String(reason),
    // Reported SEPARATELY from the review result above and never allowed to
    // change it. RECORD_WRITTEN still means only that a record was written —
    // not that the review approved anything, and not that the reviewer stopped.
    processLifecycle: processLifecycle
      && REVIEW_PROCESS_LIFECYCLE_STATES.includes(processLifecycle.state)
      && REVIEW_PROCESS_LIFECYCLE_PROVENANCE.includes(processLifecycle.provenance)
      ? processLifecycle
      : reviewProcessLifecycle('UNKNOWN', 'unavailable'),
  });
}

async function requestCanonicalReview(request) {
  const lifecycle = createReviewLifecycleRecorder();
  const outcome = (exitCode, reason) => reviewCallOutcome(exitCode, reason, lifecycle.current());
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return outcome(EXIT_USAGE, 'a canonical review request object is required');
  }
  // An unrecognised key is refused rather than dropped. A caller that misspells
  // runId would otherwise have its coordinate silently discarded, and the only
  // thing standing between that and an unbound review is this check.
  const unknown = Object.keys(request).filter((key) => !CALLABLE_REVIEW_FIELDS.includes(key));
  if (unknown.length) {
    return outcome(EXIT_USAGE, `unknown review request field(s): ${unknown.sort().join(', ')}`);
  }
  for (const field of ['runId', 'reviewer', 'packet']) {
    if (typeof request[field] !== 'string' || !request[field].trim()) {
      return outcome(EXIT_USAGE,
        `a canonical review request requires a non-empty ${field} coordinate`);
    }
  }
  if (request.onlyPaths !== undefined &&
      (!Array.isArray(request.onlyPaths)
        || request.onlyPaths.some((value) => typeof value !== 'string' || !value.trim()))) {
    return outcome(EXIT_USAGE, 'onlyPaths must be an array of non-empty repository-relative paths');
  }
  // A dry run stops after building the prompt and returns cmdRun's PASS code
  // WITHOUT writing a record. On the command line that is honest: the operator
  // read the line saying no tool was invoked. A caller reading an exit code has
  // no such line, and this entry's only success outcome is RECORD_WRITTEN — so
  // a dry run reaching cmdRun from here could only be reported as a review that
  // happened. The refusal is what keeps that outcome name true; the truthiness
  // test is deliberately the same one cmdRun applies to args.dryRun.
  if (request.dryRun) {
    return outcome(EXIT_USAGE,
      'dryRun is not available on the callable review entry: it writes no review record, '
      + 'so it has no outcome this caller can act on — use the --dry-run CLI flag instead');
  }
  // The sink is not a request field: CALLABLE_REVIEW_FIELDS refuses any key it
  // does not name, so no caller can supply, redirect or suppress it.
  const args = { run: true, lifecycleSink: lifecycle.sink };
  for (const field of CALLABLE_REVIEW_FIELDS) {
    if (request[field] !== undefined) args[field] = request[field];
  }
  try {
    return outcome(await cmdRun(args));
  } catch (error) {
    // A throw after a launch keeps whatever runTool last proved — UNKNOWN when
    // the launch outcome never came back — so a post-launch exception can never
    // be read as a reviewer that was never started or one that stopped.
    return outcome(EXIT_BLOCK, error && error.message ? error.message : error);
  }
}

function writeRecord(record, base, rawPath, opts = {}) {
  const reviewsRoot = opts.reviewsRoot || REVIEWS_DIR;
  const diagnosticsRoot = opts.diagnosticsRoot || path.join(RAW_DIR, 'invalid-review-records');
  const dir = opts.subdir ? path.join(reviewsRoot, opts.subdir) : reviewsRoot;
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${base}.json`);
  // ROOT CAUSE of the 2026-08-25 report: the adapter wrote records UNSIGNED, so
  // every one it produced — including a timeout's UNAVAILABLE — landed in
  // reviews/ as invalid active evidence. The gate then reported
  // ENGOS-REVIEW-MALFORMED instead of the true state ("the reviewer timed out"),
  // which is a worse diagnosis than the thing that actually happened.
  //
  // An UNAVAILABLE is attested exactly like any other outcome. "The reviewer
  // could not run" is a real, useful, gateable fact and deserves the same
  // integrity guarantee as an approval — otherwise the only records that carry
  // provenance are the convenient ones.
  const incomplete = [];
  for (const [index, finding] of (Array.isArray(record && record.findings) ? record.findings : []).entries()) {
    if (!finding || !['CRITICAL', 'HIGH'].includes(String(finding.severity || '').toUpperCase())) continue;
    for (const field of ['impact', 'requiredCorrection', 'verificationMethod']) {
      if (typeof finding[field] !== 'string' || !finding[field].trim()) {
        incomplete.push(`findings[${index}].${field}`);
      }
    }
  }
  if (incomplete.length) {
    fs.mkdirSync(diagnosticsRoot, { recursive: true, mode: 0o700 });
    const diagnosticPath = path.join(diagnosticsRoot, `${base}.pre-sign.json`);
    writeImmutableFile(diagnosticPath, JSON.stringify({
      reason: 'structurally incomplete blocking finding refused before signing',
      incomplete,
      record,
    }, null, 2) + '\n');
    process.stderr.write(`[review-adapters] REFUSING structurally incomplete blocking finding before signing: ${incomplete.join(', ')}\n`);
    process.stderr.write(`[review-adapters] diagnostic retained outside the active gate at ${path.relative(ROOT, diagnosticPath)}\n`);
    return EXIT_BLOCK;
  }
  let signed;
  try {
    signed = require('./review-sign.cjs').sign(record, { packetPath: opts.packetPath });
  } catch (e) {
    process.stderr.write(`[review-adapters] REFUSING to write an unsigned record: ${e.message}\n`);
    return EXIT_BLOCK;
  }
  record = signed;
  // Never validate inside the active reviews tree. A signed record can still
  // be schema-invalid (for example a HIGH finding without impact/correction),
  // and engineering-os intentionally treats every JSON file in reviews/ as
  // active evidence. Validate the exact signed bytes in a private 0700
  // quarantine, then publish by a single hard-link only after validation.
  const quarantineRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-review-record-'));
  const quarantinePath = path.join(quarantineRoot, `${base}.json`);
  let v;
  try {
    writeImmutableFile(quarantinePath, JSON.stringify(signed, null, 2) + '\n');
    v = (opts.validateRecord || validateRecord)(quarantinePath);
    if (v.ok) {
      fs.linkSync(quarantinePath, outPath); // atomic publication; refuses EEXIST
    } else {
      fs.mkdirSync(diagnosticsRoot, { recursive: true, mode: 0o700 });
      const diagnosticPath = path.join(diagnosticsRoot, `${base}.json`);
      fs.linkSync(quarantinePath, diagnosticPath);
      process.stderr.write(`[review-adapters] invalid signed record retained outside the active gate at ${path.relative(ROOT, diagnosticPath)}\n`);
    }
  } finally {
    fs.rmSync(quarantineRoot, { recursive: true, force: true });
  }
  console.log(`[review-adapters] reviewer   : ${record.reviewer} (${record.reviewerModel})`);
  console.log(`[review-adapters] disposition: ${record.disposition}`);
  if (record.unavailableReason) console.log(`[review-adapters] reason     : ${record.unavailableReason}`);
  console.log(`[review-adapters] findings   : ${(record.findings || []).length}`);
  console.log(`[review-adapters] raw output : ${rawPath}`);
  if (v.ok) console.log(`[review-adapters] record     : ${path.relative(ROOT, outPath)}`);
  if (!v.ok) {
    console.error('[review-adapters] the produced record FAILED schema validation:');
    for (const e of v.errors) console.error(`    ${e}`);
    console.error('[review-adapters] no active review file was published. Diagnostic evidence was retained outside the gated directory.');
    return EXIT_BLOCK;
  }
  console.log('[review-adapters] record is SIGNED and validates against engineering-review.schema.json');
  return EXIT_PASS;
}

function usage(msg) {
  if (msg) process.stderr.write(`\n[review-adapters] ${msg}\n`);
  process.stderr.write(`
review-adapters.cjs — read-only reviewer bridges

  --doctor [--json]
        Which reviewers are actually installed, at which absolute path.

  --run --reviewer codex|grok|copilot --packet <p> [--run-id <RUN-...>]
        [--subject-sha <sha>] [--base <ref>] [--head <ref>]
        [--timeout <seconds>] [--dry-run]
        [--current-state-proof-map <p>]
        Run a reviewer read-only against the bound subject diff, preserve raw
        output under review-raw/, and write a validated record under reviews/.

  --current-state-proof-map <p>
        Optional BUILD-PROTOCOL 9A map, bound to this subject SHA-256 and this
        deterministic-check receipt, classifying each carried-forward finding
        OPEN | CURRENTLY_PROVEN_FIXED | SUPERSEDED | OUT_OF_SCOPE. Without it no
        prior finding is presented to a reviewer as currently unresolved.

No path in this file emits APPROVE unless a reviewer actually said so.
`);
  return EXIT_USAGE;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--reviewer') a.reviewer = argv[++i];
    else if (t === '--packet') a.packet = argv[++i];
    else if (t === '--run-id') a.runId = argv[++i];
    else if (t === '--subject-sha') a.subjectSha = argv[++i];
    else if (t === '--base') a.base = argv[++i];
    else if (t === '--head') a.head = argv[++i];
    else if (t === '--timeout') a.timeout = argv[++i];
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--data-class') a.dataClass = argv[++i];
    else if (t === '--allow-metered') a.allowMetered = true;
    else if (t === '--approved-by') a.approvedBy = argv[++i];
    else if (t === '--cap-usd') a.capUsd = argv[++i];
    else if (t === '--only-path') (a.onlyPaths = a.onlyPaths || []).push(argv[++i]);
    else if (t === '--group-id') a.groupId = argv[++i];
    else if (t === '--group-digest') a.groupDigest = argv[++i];
    else if (t === '--current-state-proof-map') a.currentStateProofMap = argv[++i];
    else if (t === '--json') a.json = true;
    else if (t === '--doctor') a.doctor = true;
    else if (t === '--run') a.run = true;
  }
  return a;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  (async () => {
    let code;
    try {
      if (args.doctor) code = cmdDoctor(args);
      else if (args.run) code = await cmdRun(args);
      else code = usage();
    } catch (e) {
      process.stderr.write(`\n[review-adapters] ${e.message}\n`);
      code = EXIT_BLOCK;
    }
    process.exit(code);
  })();
}

module.exports = { requestCanonicalReview, CALLABLE_REVIEW_FIELDS, reviewCallOutcome,
  reviewProcessLifecycle, reviewerLifecycleFromTermination, createReviewLifecycleRecorder,
  REVIEW_PROCESS_LIFECYCLE_STATES, REVIEW_PROCESS_LIFECYCLE_PROVENANCE, detect, extractJson, extractGrokStreamingReview, grokStreamEvents, grokReadReceiptCoverage, enforceGrokReadReceipts, authoritativeGrokSpend, grokSpendContract, reviewerProtocolText, buildRecord, codexPrompt, grokPrompt, eligiblePriorFindings, loadCurrentStateProofMap, isCurrentOpenReverificationTarget, CURRENT_STATE_CLASSIFICATIONS, liveReviewRecords, reviewCycleLaunchDecision, isUsableReview, validateReviewPayload, validateCodexInspectionProofs, redactDurableReviewEvidence, codexCoveredPaths, stopWasAbnormal, validateCodexTerminalEnvelope, looksUnfinished, canonGate, authorizeLaunch, buildToolArgv, evidenceBlock, buildCodexInput, runTool, runContainedWithWatchdog, reapUndrainedReviewerGroup, processGroupAlive, prepareReviewSandbox, validateReviewManifestSnapshot, cleanupReviewSandbox, safeReviewPath, resolveBoundedReviewPaths, reviewerEnvironment, containedReviewerCommand, validateGrokExecutableIdentity, runGrokBillingAcp, validateGrokBillingEvidence, grokBillingPreflight, createInvocationIdentity, writeImmutableFile, writeRecord, runnablePacketChecks, resolveCanonicalCheckReceipt, resolveCanonicalRunContext, resolveReviewDataClass, REVIEW_SANDBOX_PREFIX, MAX_REVIEW_FILES, MAX_REVIEW_BYTES, MAX_REVIEW_OUTPUT_BYTES, MAX_CODEX_BUNDLE_BYTES, MAX_CODEX_INPUT_BYTES, MAX_CODEX_INPUT_CHARACTERS, REVIEW_KILL_GRACE_MS, REVIEW_REAPER_TIMEOUT_MS, GROK_BILLING_PREFLIGHT_TIMEOUT_MS, GROK_BILLING_MAX_STREAM_BYTES, GROK_EXPECTED_VERSION, GROK_EXPECTED_SHA256, GROK_REVIEW_SCHEMA, TOOLS };
