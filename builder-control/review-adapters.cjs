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
 *        --subject-sha <sha> --packet <packet.json> [--base <ref>] [--head <ref>] \
 *        [--timeout <seconds>] [--dry-run]
 *
 * Exit: 0 record written (any disposition) · 2 usage · 3 could not produce a record
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
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
const OPERATOR_GROK_AUTH = path.join(os.homedir(), '.grok', 'auth.json');
const OPERATOR_CODEX_AUTH = path.join(os.homedir(), '.codex', 'auth.json');

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_BLOCK = 3;

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
    bin: '/Users/marcpapineau/.grok/downloads/grok-macos-aarch64',
    label: 'Grok CLI',
    role: 'adversarial red team',
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
function subjectOf(args) {
  const a = [ENGOS, '--subject', '--json'];
  if (args.base) a.push('--base', args.base);
  if (args.head) a.push('--head', args.head);
  const r = spawnSync('node', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`could not compute subject: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout);
}

function subjectDiff(subject, args) {
  const a = ['diff'];
  if (args.base) a.push(`${args.base}..${args.head || 'HEAD'}`);
  else a.push(args.head || 'HEAD');
  a.push('--', ...subject.subjectPaths);
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}

// ── prompts ─────────────────────────────────────────────────────────────────
// Bounded on purpose: the requirement, the authoritative paths, the diff, and
// the exact output contract. No conversation history, and — for Codex — no
// account of what the builder believes. A reviewer handed the author's
// justification reviews the justification.
const RECORD_CONTRACT = `
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
      "impact": "<what breaks — REQUIRED for CRITICAL/HIGH>",
      "requiredCorrection": "<what must change — REQUIRED for CRITICAL/HIGH>",
      "verificationMethod": "<what proves the fix — REQUIRED for CRITICAL/HIGH>",
      "status": "OPEN"
    }
  ],
  "unverified": ["<anything you could not check>"]
}
Rules: a finding with no evidence is an opinion — omit it. Do not manufacture
findings to justify the review; zero findings is a valid, useful result.`;

// CONFIRMED FINDING #6: prompts carried only the objective, paths and diff.
// The packet requires reviewers to receive authoritative paths, test evidence
// and explicit unverified items — without them a reviewer cannot tell an
// intentional design from an accident, and cannot know which claims were
// actually checked. The exact bounded files are copied into the private
// read-only review workspace; this block records their verified digests.
function evidenceBlock(ctx) {
  if (!ctx) return '';
  const lines = [];
  if (ctx.specs && ctx.specs.length) {
    lines.push('', 'PINNED SPECIFICATIONS (authoritative intent, available read-only in the review workspace):');
    for (const sp of ctx.specs) lines.push(`  ${sp.path}  sha256:${sp.sha.slice(0, 16)}…`);
  }
  if (ctx.checks && ctx.checks.length) {
    lines.push('', 'DETERMINISTIC EVIDENCE (already executed against this subject):');
    for (const c of ctx.checks) lines.push(`  exit ${c.exit}  ${c.cmd}`);
    lines.push('', 'Treat a passing check as evidence that the command ran, NOT that the');
    lines.push('requirement is met. If a test passes but a user would still see wrong');
    lines.push('behaviour, that is exactly the finding worth reporting.');
  }
  if (ctx.unverified && ctx.unverified.length) {
    lines.push('', 'EXPLICITLY UNVERIFIED (nobody checked these — do not assume either way):');
    for (const u of ctx.unverified) lines.push(`  - ${u}`);
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

OBJECTIVE (from the approved task packet):
${objective}

SUBJECT PATHS (${subject.subjectPaths.length}):
${subject.subjectPaths.map((p) => '  ' + p).join('\n')}

Look for: architectural drift, incomplete functionality, regression, duplicated
logic, state and concurrency errors, API/contract violations, auth mistakes,
security problems, missing validation, edge cases, mock or hardcoded data,
misleading tests, deleted functionality.

${evidenceBlock(ctx)}

DIFF UNDER REVIEW:
${diff}
${RECORD_CONTRACT}`;
}

function grokPrompt(objective, subject, diff, ctx) {
  return `You are the final adversarial reviewer. Assume this change contains a
serious flaw that previous engineers missed, and try to prove it incorrect.

The exact bounded subject and specifications are available read-only at the
listed repository-relative paths in the isolated workspace. Read only those
paths. Do not inspect parent directories or unrelated files.

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

DIFF UNDER REVIEW:
${diff}
${RECORD_CONTRACT}`;
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

function extractJson(text, unwrapDepth = 0) {
  if (typeof text !== 'string') return null;

  // Collect EVERY balanced top-level object, not just the first.
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
  for (const o of objs) {
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
  const env = extractJson(rawText, 1);
  const stop = env && typeof env.stopReason === 'string' ? env.stopReason : null;
  if (stop && ABNORMAL_STOP.test(stop)) return stop;
  if (/^\s*Error:\s*max turns reached/mi.test(rawText)) return 'max turns reached';
  if (/^\s*Error:\s*(timeout|cancelled)/mi.test(rawText)) return 'cancelled';
  return null;
}

// A findings array whose entries admit they are placeholders is not evidence.
// Cheap, and it catches the exact shape the truncated run produced.
const PLACEHOLDER = /\b(pending|not yet inspected|starting (the )?(adversarial )?review|in progress|to be determined|tbd)\b/i;
function looksUnfinished(parsed) {
  if (!parsed || !Array.isArray(parsed.findings)) return false;
  return parsed.findings.some((f) =>
    PLACEHOLDER.test(String(f && f.location || '')) ||
    PLACEHOLDER.test(String(f && f.problem || '')));
}

function isUsableReview(o) {
  return !!(o && typeof o === 'object' && typeof o.disposition === 'string');
}

// Build a record. `parsed` null/unusable => UNAVAILABLE, never APPROVE.
function buildRecord({ reviewer, reviewerModel, packetId, subject, parsed, unavailableReason, ts }) {
  const base = {
    reviewId: `REV-${ts.replace(/[^0-9]/g, '').slice(0, 14)}-${reviewer}`,
    ts,
    reviewer,
    reviewerModel,
    packetId,
    reviewOf: {
      diffSha256: subject.subjectSha256,
      changedPaths: subject.subjectPaths.slice(),
    },
  };
  if (!parsed || typeof parsed !== 'object' || !parsed.disposition) {
    return {
      ...base,
      disposition: 'UNAVAILABLE',
      unavailableReason: unavailableReason || 'the reviewer produced no parseable review record',
      findings: [],
    };
  }
  const allowed = ['APPROVE', 'APPROVE_WITH_NOTES', 'REJECT'];
  if (!allowed.includes(parsed.disposition)) {
    return {
      ...base,
      disposition: 'UNAVAILABLE',
      unavailableReason: `the reviewer returned an unrecognised disposition ${JSON.stringify(parsed.disposition)}`,
      findings: [],
    };
  }
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
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
    unverified: Array.isArray(parsed.unverified) ? parsed.unverified.map(String) : [],
  };
}

function validateRecord(recordPath) {
  const r = spawnSync('node', [ENGOS, '--validate-review', recordPath, '--json'],
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
      dataClass: opts.dataClass || 'INTERNAL',
      allowMetered: opts.allowMetered,
      approvedBy: opts.approvedBy,
      capUsd: opts.capUsd,
    });
  } catch (e) {
    return { ok: false, reason: `model routing policy unusable: ${e.message}` };
  }
  if (!route.ok) return { ok: false, reason: `${route.code}: ${route.reason}` };
  return { ok: true, tool: canon.tool, route };
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

function resolveBoundedReviewPaths(subject, packet) {
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
  const rootReal = fs.realpathSync(ROOT);
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

function validateReviewSources(reviewPaths = []) {
  const uniquePaths = [...new Set(reviewPaths.map(safeReviewPath))].sort();
  if (uniquePaths.length > MAX_REVIEW_FILES) {
    throw new Error(`review file count ${uniquePaths.length} exceeds ${MAX_REVIEW_FILES}`);
  }
  let totalBytes = 0;
  const sources = [];
  for (const rel of uniquePaths) {
    const src = path.resolve(ROOT, rel);
    if (!src.startsWith(ROOT + path.sep)) throw new Error(`review source escaped repository root: ${rel}`);
    const st = fs.lstatSync(src);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(`review source is not a regular file: ${rel}`);
    totalBytes += st.size;
    if (totalBytes > MAX_REVIEW_BYTES) {
      throw new Error(`review payload ${totalBytes} bytes exceeds ${MAX_REVIEW_BYTES}`);
    }
    const sourceSha = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
    sources.push(Object.freeze({ rel, src, bytes: st.size, sourceSha }));
  }
  return Object.freeze({ sources: Object.freeze(sources), totalBytes });
}

function prepareReviewSandbox(reviewPaths = []) {
  // Refuse malformed, oversized or unreadable subjects before a temporary
  // directory exists and, critically, before any operator auth is copied.
  const validated = validateReviewSources(reviewPaths);
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
      manifest.push({ path: source.rel, sha256: source.sourceSha, bytes: source.bytes });
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

// Build the exact argument vector a reviewer will be launched with. Exported
// so a test can assert that every bound the policy DECLARES is actually
// PRESENT on the command line — the gap that let maxTurns:1 run 13 turns.
// The review shape, as a JSON Schema. Grok's --json-schema CONSTRAINS the model
// to emit conforming JSON instead of us asking politely in the prompt and hoping.
// Asking produced prose three times; constraining is enforcement rather than
// instruction, which is the same distinction this whole system is built on.
const GROK_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    disposition: { type: 'string', enum: ['APPROVE', 'APPROVE_WITH_NOTES', 'REJECT'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
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
        required: ['severity', 'file', 'problem', 'evidence', 'status'],
      },
    },
    unverified: { type: 'array', items: { type: 'string' } },
  },
  required: ['disposition', 'findings'],
};

function buildToolArgv(reviewer, prompt, bounds, reviewCwd) {
  if (reviewer === 'codex') {
    return ['exec', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config',
      '--ignore-rules', '--skip-git-repo-check', '--color', 'never',
      '--cd', reviewCwd || '.', prompt];
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
  // --json-schema implies --output-format json AND constrains the model's
  // output to this shape, so a verdict cannot come back as prose.
  const argv = ['-p', prompt, '--json-schema', JSON.stringify(GROK_REVIEW_SCHEMA),
    '--cwd', reviewCwd, '--no-subagents', '--verbatim',
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
  if (reviewer === 'grok') common.GROK_MANAGED_MCPS_ENABLED = 'false';
  return strictEnvironment(common, source);
}

function containedReviewerCommand(reviewer, sandbox, argv) {
  const tool = TOOLS[reviewer];
  if (!tool) throw new Error(`unknown reviewer ${reviewer}`);
  const configReads = reviewer === 'grok' ? [sandbox.grokConfigPath] : [];
  const credentialReads = reviewer === 'grok'
    ? [sandbox.grokAuthPath].filter(Boolean)
    : [sandbox.codexAuthPath].filter(Boolean);
  const profile = buildMacSandboxProfile({
    root: sandbox.root,
    executable: tool.bin,
    readPaths: [sandbox.cwd, ...configReads],
    // Both locations are private, one-use copies removed in finally. The
    // subject remains under sandbox.cwd and is never writable.
    writePaths: [sandbox.home, sandbox.tmp],
    processOnlyReadPaths: credentialReads,
    allowNetwork: true,
    reviewerRuntime: true,
  });
  assertSandboxOperational();
  return Object.freeze({ ...sandboxedCommand(profile, argv), profile });
}

function runTool(reviewer, prompt, timeoutSec, opts = {}) {
  const t = TOOLS[reviewer];
  if (!t) return { ok: false, reason: `unknown reviewer ${reviewer}` };
  const gateResult = authorizeLaunch(reviewer, opts);
  if (!gateResult.ok) return { ok: false, reason: gateResult.reason, raw: '' };
  if (!isExecutable(t.bin)) {
    return { ok: false, reason: `${t.label} is not executable at ${t.bin}`, raw: '' };
  }
  // ONE builder for both reviewers — buildToolArgv() is the same function the
  // red proofs assert against, so the tested argv and the executed argv cannot
  // drift. Duplicating this list is exactly how maxTurns came to be "declared
  // in policy, enforced nowhere".
  let bounds = null;
  if (reviewer !== 'codex') {
    try {
      bounds = (require('./tool-router.cjs').loadPolicy().roles['adversarial-review'] || {}).bounds || null;
    } catch { /* an absent policy is handled by the router's own refusal above */ }
    // Sub-agents are expressed by OMITTING --agents. If a policy ever turns them
    // on, this adapter refuses rather than silently ignoring the setting.
    if (bounds && bounds.subagents === true) {
      return { ok: false, reason: 'policy enables sub-agents for adversarial-review; this adapter deliberately does not implement that path', raw: '' };
    }
  }
  let sandbox;
  try {
    sandbox = prepareReviewSandbox(opts.reviewPaths || []);
  } catch (error) {
    return { ok: false, reason: `review sandbox preparation failed: ${error.message}`, raw: '' };
  }
  try {
    const argv = buildToolArgv(reviewer, prompt, bounds, sandbox.cwd);
    let contained;
    try { contained = containedReviewerCommand(reviewer, sandbox, argv); }
    catch (e) { return { ok: false, reason: `OS containment unavailable: ${e.message}`, raw: '' }; }
    const r = spawnSync(contained.bin, contained.argv, {
      encoding: 'utf8',
      timeout: timeoutSec * 1000,
      maxBuffer: 64 * 1024 * 1024,
      cwd: sandbox.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: reviewerEnvironment(reviewer, sandbox),
    });
    const raw = (r.stdout || '') + (r.stderr ? `\n--- stderr ---\n${r.stderr}` : '');
    if (r.error && r.error.code === 'ETIMEDOUT') {
      return { ok: false, reason: `${t.label} exceeded the ${timeoutSec}s timeout`, raw };
    }
    if (r.error) return { ok: false, reason: `${t.label} failed to start: ${r.error.message}`, raw };
    if (r.status !== 0) return { ok: false, reason: `${t.label} exited ${r.status}`, raw };
    return { ok: true, raw };
  } finally {
    cleanupReviewSandbox(sandbox);
  }
}

function cmdRun(args) {
  const reviewer = args.reviewer;
  if (!reviewer) return usage('--reviewer is required');
  if (!['codex', 'grok', 'copilot'].includes(reviewer)) return usage(`unknown reviewer ${reviewer}`);
  if (!args.packet) return usage('--packet is required');
  if (!fs.existsSync(args.packet)) return usage(`packet not found: ${args.packet}`);

  const packet = JSON.parse(fs.readFileSync(args.packet, 'utf8'));
  const subject = subjectOf(args);

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
  try { boundedReviewPaths = resolveBoundedReviewPaths(subject, packet); }
  catch (e) {
    console.error(`[review-adapters] refusing unbounded review: ${e.message}`);
    return EXIT_BLOCK;
  }

  fs.mkdirSync(REVIEWS_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const stamp = ts.replace(/[^0-9]/g, '').slice(0, 14);

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
    });
    return writeRecord(record, `${stamp}-copilot`, '(no tool invoked — Copilot is advisory and is never launched as a gate reviewer)', { packetPath: args.packet });
  }

  const diff = subjectDiff(subject, args);
  const promptContext = {
    specs: (packet.sourceOfTruth || []).filter((p) => fs.existsSync(path.join(ROOT, p))).map((p) => ({
      path: p,
      sha: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex'),
    })),
    checks: (packet.testsRequired || []).map((cmd) => ({ cmd, exit: 'declared; verify from gate evidence' })),
    unverified: packet.stopConditions || [],
  };
  const prompt = reviewer === 'codex'
    ? codexPrompt(packet.objective, subject, diff, promptContext)
    : grokPrompt(packet.objective, subject, diff, promptContext);

  if (args.dryRun) {
    console.log(`[review-adapters] DRY RUN — ${reviewer}: would send ${prompt.length} chars over ${subject.subjectPaths.length} subject path(s). No tool invoked.`);
    return EXIT_PASS;
  }

  const timeoutSec = Number(args.timeout) > 0 ? Number(args.timeout) : 900;
  const res = runTool(reviewer, prompt, timeoutSec, {
    dataClass: args.dataClass || 'INTERNAL',
    allowMetered: args.allowMetered,
    approvedBy: args.approvedBy,
    capUsd: args.capUsd,
    reviewPaths: boundedReviewPaths,
  });
  const rawPath = path.join(RAW_DIR, `${stamp}-${reviewer}.txt`);
  fs.writeFileSync(rawPath, res.raw || '(no output captured)', 'utf8');

  let parsed = res.ok ? extractJson(res.raw) : null;
  // When a tool exits 0 but returns no usable record, "no parseable JSON" is
  // true but unhelpfully vague — and a vague UNAVAILABLE reason is the kind of
  // thing an operator learns to ignore. Several CLIs report why they stopped
  // (cancelled, max turns, context limit); surface that instead when present,
  // because "cancelled after 9 turns" and "returned prose" call for completely
  // different responses.
  let why = res.ok ? 'the reviewer ran but produced no parseable JSON review record' : res.reason;

  // Truncation guard — applied BEFORE the payload is trusted.
  const abnormal = stopWasAbnormal(res.raw);
  if (abnormal) {
    why = `the reviewer stopped abnormally (${abnormal}) — any verdict in its output describes an unfinished review and is refused`;
    parsed = null;
  } else if (isUsableReview(parsed) && looksUnfinished(parsed)) {
    why = 'the reviewer emitted a schema-valid but self-declared PLACEHOLDER verdict (findings marked pending / not yet inspected); refused rather than recorded as a real review';
    parsed = null;
  }
  if (res.ok && !isUsableReview(parsed)) {
    const envelope = extractJson(res.raw);
    const stop = envelope && typeof envelope.stopReason === 'string' ? envelope.stopReason : null;
    const turns = envelope && typeof envelope.num_turns === 'number' ? envelope.num_turns : null;
    if (stop && stop !== 'end_turn') {
      why = `the reviewer stopped early (stopReason="${stop}"${turns ? `, ${turns} turns` : ''}) without emitting a review record`;
    }
  }
  const record = buildRecord({
    reviewer,
    reviewerModel: reviewer === 'codex' ? 'codex-cli (ChatGPT.app)' : 'grok-cli (grok-macos-aarch64)',
    packetId: packet.packetId,
    subject,
    parsed: isUsableReview(parsed) ? parsed : null,
    unavailableReason: why,
    ts,
  });
  if (args.groupId) {
    record.group = { groupId: args.groupId, groupDigest: args.groupDigest || null };
  }
  // Group records go into reviews/groups/, which the gate does NOT read. Only
  // the aggregate reaches the gate, and only when every group beneath it
  // covered the subject exactly. A stray group record must never be mistaken
  // for a review of the whole change.
  return writeRecord(record, `${stamp}-${reviewer}${args.groupId ? '-' + args.groupId : ''}`, rawPath,
    { packetPath: args.packet, subdir: args.groupId ? 'groups' : null });
}

function writeRecord(record, base, rawPath, opts = {}) {
  const dir = opts.subdir ? path.join(REVIEWS_DIR, opts.subdir) : REVIEWS_DIR;
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
  let signed;
  try {
    signed = require('./review-sign.cjs').sign(record, { packetPath: opts.packetPath });
  } catch (e) {
    process.stderr.write(`[review-adapters] REFUSING to write an unsigned record: ${e.message}\n`);
    return EXIT_BLOCK;
  }
  fs.writeFileSync(outPath, JSON.stringify(signed, null, 2) + '\n', 'utf8');
  record = signed;
  const v = validateRecord(outPath);
  console.log(`[review-adapters] reviewer   : ${record.reviewer} (${record.reviewerModel})`);
  console.log(`[review-adapters] disposition: ${record.disposition}`);
  if (record.unavailableReason) console.log(`[review-adapters] reason     : ${record.unavailableReason}`);
  console.log(`[review-adapters] findings   : ${(record.findings || []).length}`);
  console.log(`[review-adapters] raw output : ${rawPath}`);
  console.log(`[review-adapters] record     : ${path.relative(ROOT, outPath)}`);
  if (!v.ok) {
    console.error('[review-adapters] the produced record FAILED schema validation:');
    for (const e of v.errors) console.error(`    ${e}`);
    console.error('[review-adapters] the record is left on disk for inspection. The gate will refuse it.');
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

  --run --reviewer codex|grok|copilot --packet <p>
        [--subject-sha <sha>] [--base <ref>] [--head <ref>]
        [--timeout <seconds>] [--dry-run]
        Run a reviewer read-only against the bound subject diff, preserve raw
        output under review-raw/, and write a validated record under reviews/.

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
    else if (t === '--json') a.json = true;
    else if (t === '--doctor') a.doctor = true;
    else if (t === '--run') a.run = true;
  }
  return a;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let code;
  try {
    if (args.doctor) code = cmdDoctor(args);
    else if (args.run) code = cmdRun(args);
    else code = usage();
  } catch (e) {
    process.stderr.write(`\n[review-adapters] ${e.message}\n`);
    code = EXIT_BLOCK;
  }
  process.exit(code);
}

module.exports = { detect, extractJson, buildRecord, codexPrompt, grokPrompt, isUsableReview, stopWasAbnormal, looksUnfinished, canonGate, authorizeLaunch, buildToolArgv, evidenceBlock, runTool, prepareReviewSandbox, cleanupReviewSandbox, safeReviewPath, resolveBoundedReviewPaths, reviewerEnvironment, containedReviewerCommand, REVIEW_SANDBOX_PREFIX, MAX_REVIEW_FILES, MAX_REVIEW_BYTES, GROK_REVIEW_SCHEMA, TOOLS };
