#!/usr/bin/env node
/**
 * gate.cjs — Builder Control System v1, Modules 1 (consume) + 4 (wire-in) + 5 (HARD-BLOCK)
 * ────────────────────────────────────────────────────────────────────────────
 * THE HARD-BLOCK PERMISSION GATE.
 *
 * Loads:  builder-control/agent-registry.json   (governance — who may do what)
 *         <task packet>.json                     (the authorization)
 *         builder-control/protected-paths.json   (the protected list)
 *
 * Decides PASS / HARD-BLOCK per the RULE-ID set in CONTROL-CONTRACT.md §6 and
 * prints the EXACT fixed block message. On EVERY decision (PASS and BLOCK) it
 * appends a ledger entry by SHELLING B2's ledger-writer.cjs (reuse, never write
 * ledger.json directly).
 *
 * REUSE > REBUILD:
 *   - SHELLS the existing drift scripts and uses their exit codes:
 *       peptide-resource-app/scripts/check-drift.cjs        → BC-DRIFT-DETECTED
 *       scripts/audit-protocol-content-contract.mjs --strict[ --require-krite-approved]
 *       peptide-resource-app/research-intel/brain.js validateBrain() (ESM)
 *   - IMPORTS B3's boundary-checks.cjs for the general agent-boundary rules
 *       (gov-leak, invented-authority, dosing-out-of-canon, public-push, customer-copy-no-KRITE).
 *   - SHELLS B2's ledger-writer.cjs --append for every decision.
 * The gate decides the exit; boundary-checks only report; drift scripts only exit-code.
 *
 * Posture: HARD-BLOCK from day one. On any unauthorized write/commit/push/release
 * the gate process.exit(non-zero) and refuses — nothing is written. The ONLY
 * override is a packet authorization{} block (logged). No --force, no skip env-var,
 * no silent bypass. BC-FORBIDDEN-TASK / BC-INVENTED-AUTHORITY / BC-DOSING-OUT-OF-CANON /
 * BC-GOV-AUTHORITY-LEAK are NOT packet-overridable.
 *
 * Exit codes:
 *   0 = PASS (operation permitted; ledger PASS entry appended)
 *   3 = HARD-BLOCK (operation refused; ledger BLOCKED entry appended)
 *   2 = usage / internal error (e.g. drift script missing — treated as hard failure)
 *
 * Source of truth: builder-control/CONTROL-CONTRACT.md §3, §5, §6, §7
 * ────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const boundary = require('./boundary-checks.cjs');

// ─── Paths (resolved relative to this file so cwd never matters) ──────────────
const HERE = __dirname;
const WORKSPACE_ROOT = path.resolve(HERE, '..');
const REGISTRY_FILE = path.join(HERE, 'agent-registry.json');
const PROTECTED_FILE = path.join(HERE, 'protected-paths.json');
const LEDGER_WRITER = path.join(HERE, 'ledger-writer.cjs');

const DRIFT_SCRIPT = path.join(WORKSPACE_ROOT, 'peptide-resource-app', 'scripts', 'check-drift.cjs');
const CONTENT_AUDIT = path.join(WORKSPACE_ROOT, 'scripts', 'audit-protocol-content-contract.mjs');
const BRAIN_MODULE = path.join(WORKSPACE_ROOT, 'peptide-resource-app', 'research-intel', 'brain.js');

// Exit codes
const EXIT_PASS = 0;
const EXIT_BLOCK = 3;
const EXIT_ERROR = 2;

// Sprint 1: OPTIONAL Langfuse trace id, threaded into the ledger entry only when
// supplied (--langfuse-trace-id <id> or BC_LANGFUSE_TRACE_ID). Null by default →
// entries are byte-identical to pre-Sprint-1 behavior (no field added).
let LANGFUSE_TRACE_ID = null;

// ─── Small helpers ───────────────────────────────────────────────────────────
function loadJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function tail(str, n) {
  const lines = String(str || '').trim().split('\n');
  return lines.slice(-n).join('\n');
}

// Glob match supporting * (single segment) and ** (any depth). Mirrors packet-tools.
function globMatch(pattern, str) {
  pattern = String(pattern).replace(/\\/g, '/');
  str = String(str).replace(/\\/g, '/');
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DSTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DSTAR§/g, '.*');
  return new RegExp(`^${escaped}$`).test(str);
}

// Normalize an operation path to workspace-relative forward slashes.
function relPath(p) {
  let s = String(p || '').replace(/\\/g, '/');
  // Strip a leading workspace-root if an absolute path was given.
  const root = WORKSPACE_ROOT.replace(/\\/g, '/') + '/';
  if (s.startsWith(root)) s = s.slice(root.length);
  s = s.replace(/^\.\//, '');
  return s;
}

// ─── CLI parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        a[key] = true;
      } else {
        a[key] = next;
        i++;
      }
    } else {
      a._.push(t);
    }
  }
  return a;
}

// ─── Protected-paths matching ────────────────────────────────────────────────
// Returns { matched, category, overridable, reason } for a given workspace-relative path.
function matchProtected(protectedDoc, targetPath, op) {
  const rel = relPath(targetPath);
  const cats = protectedDoc.categories || {};
  for (const [catName, cat] of Object.entries(cats)) {
    // appliesTo: "push" categories only apply to push operations
    if (cat.appliesTo && cat.appliesTo !== op) continue;
    const paths = Array.isArray(cat.paths) ? cat.paths : [];
    for (const pat of paths) {
      // A bare path entry (no glob) matches exact or prefix-dir; glob entries match by glob.
      if (pat.includes('*')) {
        if (globMatch(pat, rel)) {
          return { matched: true, category: catName, overridable: cat.overridable !== false, reason: cat.reason, pattern: pat };
        }
      } else if (rel === pat || rel.startsWith(pat + '/')) {
        return { matched: true, category: catName, overridable: cat.overridable !== false, reason: cat.reason, pattern: pat };
      }
    }
  }
  return { matched: false };
}

// ─── Drift-script shelling (reuse — never reimplement) ───────────────────────
// Each returns { check, exit, summary, missing }
function runCheckDrift() {
  if (!fs.existsSync(DRIFT_SCRIPT)) {
    return { check: 'check-drift.cjs', exit: 2, summary: `MISSING at ${DRIFT_SCRIPT}`, missing: true };
  }
  const r = spawnSync('node', [DRIFT_SCRIPT], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  return {
    check: 'check-drift.cjs',
    exit: r.status == null ? 2 : r.status,
    summary: tail((r.stdout || '') + (r.stderr || ''), 2),
    missing: false,
  };
}

function runContentAudit(filePath, requireKrite) {
  if (!fs.existsSync(CONTENT_AUDIT)) {
    return { check: 'audit-protocol-content-contract.mjs', exit: 2, summary: `MISSING at ${CONTENT_AUDIT}`, missing: true };
  }
  const args = [CONTENT_AUDIT, '--file', filePath, '--strict'];
  if (requireKrite) args.push('--require-krite-approved');
  const r = spawnSync('node', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  return {
    check: 'audit-protocol-content-contract.mjs --strict' + (requireKrite ? ' --require-krite-approved' : ''),
    exit: r.status == null ? 2 : r.status,
    summary: tail((r.stdout || '') + (r.stderr || ''), 3),
    missing: false,
  };
}

function runValidateBrain() {
  if (!fs.existsSync(BRAIN_MODULE)) {
    return { check: 'validateBrain()', exit: 2, summary: `MISSING at ${BRAIN_MODULE}`, missing: true };
  }
  const brainUrl = 'file://' + BRAIN_MODULE.replace(/\\/g, '/');
  const code =
    `import { validateBrain, BRAIN_PATH } from ${JSON.stringify(brainUrl)};` +
    `import { readFileSync } from 'node:fs';` +
    `const b = JSON.parse(readFileSync(BRAIN_PATH,'utf8'));` +
    `const r = validateBrain(b);` +
    `if (r.ok) { console.log('BRAIN_OK violations=0'); process.exit(0); }` +
    `else { console.error('BRAIN_FAIL ' + JSON.stringify((r.violations||[]).slice(0,3))); process.exit(1); }`;
  const r = spawnSync('node', ['--input-type=module', '-e', code], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  return {
    check: 'validateBrain()',
    exit: r.status == null ? 2 : r.status,
    summary: tail((r.stdout || '') + (r.stderr || ''), 2),
    missing: false,
  };
}

// ─── The fixed HARD-BLOCK message (CONTROL-CONTRACT.md §6) ────────────────────
function printBlock({ rule, agentId, operation, reason, packetId, authorizer }) {
  const lines = [
    'BUILDER-CONTROL HARD-BLOCK',
    `  rule:      ${rule}`,
    `  agentId:   ${agentId || 'UNREGISTERED'}`,
    `  operation: ${operation}`,
    `  reason:    ${reason}`,
    `  packetId:  ${packetId || 'NONE — no task packet present'}`,
    `  override:  add an authorization{} block to a task packet naming this exact path/op,`,
    `             authorized by ${authorizer || '<owner>'}, then re-run. There is no silent bypass.`,
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

// ─── Ledger append via B2's writer (reuse — never write ledger.json directly) ─
function appendLedger(entry) {
  const tmp = path.join(require('os').tmpdir(), `bc-ledger-entry-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(entry, null, 2), 'utf8');
  const r = spawnSync('node', [LEDGER_WRITER, '--append', tmp], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  try { fs.unlinkSync(tmp); } catch (_) { /* best-effort cleanup */ }
  return {
    exit: r.status == null ? 2 : r.status,
    out: tail((r.stdout || '') + (r.stderr || ''), 3),
  };
}

function nextEntryId() {
  const d = new Date().toISOString().slice(0, 10);
  return `LED-${d}-${String(Date.now()).slice(-6)}`;
}

// Build + write a ledger entry, then return so caller can exit.
function ledgerAndExit({ status, blockRule, agentId, packetId, operation, changed, driftChecks, notes, exitCode }) {
  const entry = {
    entryId: nextEntryId(),
    ts: new Date().toISOString(),
    packetId: packetId || null,
    agentId: agentId || 'UNREGISTERED',
    gate: 'control',
    status,
    blockRule: blockRule || null,
    operation: operation || null,
    changed: changed || [],
    commandsRun: [],
    testsRun: [],
    screenshots: [],
    commitSha: null,
    bundleHash: null,
    evidencePaths: [],
    driftChecks: driftChecks || [],
    notes: notes || '',
  };
  if (LANGFUSE_TRACE_ID) entry.langfuseTraceId = LANGFUSE_TRACE_ID;
  const led = appendLedger(entry);
  if (led.exit !== 0) {
    process.stderr.write(`\n[gate] WARNING: ledger append did not succeed (exit ${led.exit}):\n${led.out}\n`);
  } else {
    process.stdout.write(`[gate] ledger entry appended (${entry.entryId}, status=${status}).\n`);
  }
  process.exit(exitCode);
}

// ─── Main decision ───────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));

  // Sprint 1: capture optional Langfuse trace id (string only; a bare flag is ignored).
  LANGFUSE_TRACE_ID =
    (typeof args['langfuse-trace-id'] === 'string' ? args['langfuse-trace-id'] : null) ||
    process.env.BC_LANGFUSE_TRACE_ID ||
    null;

  // Hard rule: there is no bypass. Refuse any flag that smells like one.
  for (const bad of ['force', 'skip', 'no-verify', 'bypass']) {
    if (args[bad]) {
      process.stderr.write(`[gate] "--${bad}" is not a recognized flag. There is no silent bypass — the only override is a task packet authorization{} block.\n`);
      process.exit(EXIT_ERROR);
    }
  }
  if (process.env.BC_SKIP_GATE || process.env.BC_FORCE) {
    process.stderr.write('[gate] skip/force env-vars are not honored. There is no silent bypass.\n');
    process.exit(EXIT_ERROR);
  }

  // --check mode: validate the gate can load its inputs and (optionally) self-check a packet.
  const checkMode = !!args.check;

  // Load registry + protected-paths (these are mandatory for any decision).
  let registry, protectedDoc;
  try {
    registry = loadJSON(REGISTRY_FILE);
  } catch (e) {
    process.stderr.write(`[gate] FATAL: cannot load registry ${REGISTRY_FILE}: ${e.message}\n`);
    process.exit(EXIT_ERROR);
  }
  try {
    protectedDoc = loadJSON(PROTECTED_FILE);
  } catch (e) {
    process.stderr.write(`[gate] FATAL: cannot load protected-paths ${PROTECTED_FILE}: ${e.message}\n`);
    process.exit(EXIT_ERROR);
  }
  const agents = registry.agents || {};

  // Resolve the packet (if any).
  let packet = null;
  if (args.packet) {
    try {
      packet = loadJSON(path.resolve(args.packet));
    } catch (e) {
      process.stderr.write(`[gate] FATAL: cannot load packet ${args.packet}: ${e.message}\n`);
      process.exit(EXIT_ERROR);
    }
  }
  const packetId = packet ? packet.packetId : null;
  const authz = (packet && packet.authorization) || {};

  // Resolve the agent. Operation agentId beats packet agentId; both fall back to UNREGISTERED.
  const agentId = args.agent || (packet && packet.agentId) || null;
  const agentRecord = agentId && agents[agentId] ? Object.assign({ agentId }, agents[agentId]) : null;

  // Determine the operation. Default in --check mode: a self-check "write" of the packet's filesAllowed.
  const op = (args.op || 'write').toLowerCase(); // write | commit | push | release | read
  let targetPaths = [];
  if (args.path) {
    targetPaths = Array.isArray(args.path) ? args.path : [args.path];
  } else if (checkMode && packet && Array.isArray(packet.filesAllowed)) {
    targetPaths = packet.filesAllowed.slice();
  }

  const operationLabel = `${op} ${targetPaths.join(', ') || (args.ref || '(no path)')}`;

  // ── RULE: BC-NO-PACKET — any protected op with no resolvable task packet ────
  // We only require a packet for state-changing ops on protected/public/protocol paths.
  // Read ops never require a packet.
  const isStateChanging = ['write', 'commit', 'push', 'release'].includes(op);

  // Pre-scan: classify every target path against protected-paths + public/protocol.
  const classifications = targetPaths.map((p) => {
    const m = matchProtected(protectedDoc, p, op);
    const pub = boundary.publicPush(p); // { violated } => is a public-repo path
    return { path: relPath(p), protected: m, isPublic: pub.violated };
  });

  // ── RULE: BC-PUBLIC-PUSH (checked FIRST for push ops) ────────────────────────
  // A push touching a public-repo path is the most specific, contract-named rule
  // for that case (§6). Evaluate it before the generic allowedOps gate so the
  // debuggable named rule fires for the canonical public-push exposure.
  if (op === 'push') {
    const publicHitsEarly = classifications.filter((c) => c.isPublic);
    if (publicHitsEarly.length && authz.allowsPublicPush !== true) {
      const first = publicHitsEarly[0];
      printBlock({
        rule: 'BC-PUBLIC-PUSH', agentId, operation: operationLabel,
        reason: `Push touches public-repo path "${first.path}"; packet authorization.allowsPublicPush is not true.`,
        packetId, authorizer: authz.authorizedBy,
      });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: 'BC-PUBLIC-PUSH', agentId, packetId,
        operation: operationLabel, changed: publicHitsEarly.map((c) => c.path),
        notes: `public-repo push without allowsPublicPush; ${publicHitsEarly.length} public path(s).`,
        exitCode: EXIT_BLOCK,
      });
    }
  }

  // ── RULE: BC-FORBIDDEN-TASK (NOT packet-overridable) ─────────────────────────
  // If the operation matches a forbiddenTasks entry by op/keyword, block.
  // We detect the clear-cut structural cases: push without authorization is also
  // BC-PUBLIC-PUSH; "edit protected without auth" is BC-PROTECTED-WRITE. The
  // forbidden-task rule here covers an agent whose registry forbids the op class itself.
  if (agentRecord) {
    const forbidden = (agentRecord.forbiddenTasks || []).map((t) => String(t).toLowerCase());
    // allowedOps gate: an op not in the agent's allowedOps is a forbidden task (default-deny).
    const allowedOps = agentRecord.allowedOps || [];
    if (isStateChanging && !allowedOps.includes(op)) {
      printBlock({
        rule: 'BC-FORBIDDEN-TASK',
        agentId,
        operation: operationLabel,
        reason: `Agent "${agentId}" is not permitted op "${op}" (allowedOps: ${allowedOps.join(', ') || 'none'}). Not packet-overridable; Marc must amend the registry.`,
        packetId,
      });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: 'BC-FORBIDDEN-TASK', agentId, packetId,
        operation: operationLabel, driftChecks: [],
        notes: `op "${op}" outside agent allowedOps [${allowedOps.join(', ')}]; not packet-overridable.`,
        exitCode: EXIT_BLOCK,
      });
    }
    void forbidden; // keyword forbidden-tasks are surfaced by boundary-checks below.
  }

  // ── Content checks: gov-leak / invented-authority / dosing-out-of-canon ──────
  // These run on AGENT-GENERATED candidate text (--text / --text-file) and are
  // NOT packet-overridable. They use B3's boundary-checks (the gate decides exit).
  //
  // Scoping (deliberate, to avoid false positives):
  //   • Explicit candidate text (the agent's GENERATION): run ALL THREE checks —
  //     gov-leak, invented-authority, dosing-out-of-canon. dosing-out-of-canon /
  //     invented-authority are about an agent INVENTING dosing/authority in its
  //     output, so they belong on generation text only.
  //   • A release-artifact BODY (a finished, KRITE-bound customer guide loaded
  //     from disk): only gov-leak is appropriate — a finished guide legitimately
  //     contains dosing, so dosing-out-of-canon would false-positive on every real
  //     guide. The content-contract audit + brain validation (below) govern the
  //     finished artifact; gov-authority leakage is still a real release concern.
  let candidateText = '';
  let candidateIsGeneration = false;
  if (args['text-file']) {
    try { candidateText = fs.readFileSync(path.resolve(args['text-file']), 'utf8'); candidateIsGeneration = true; } catch (_) { candidateText = ''; }
  } else if (typeof args.text === 'string') {
    candidateText = args.text;
    candidateIsGeneration = true;
  } else if (op === 'release' && targetPaths.length === 1) {
    // Release-artifact body — scanned for gov-leak only (not generation text).
    try { candidateText = fs.readFileSync(path.resolve(WORKSPACE_ROOT, classifications[0].path), 'utf8'); } catch (_) { candidateText = ''; }
  }

  if (candidateText) {
    // gov-leak applies to BOTH generation text and release-artifact bodies.
    const gov = boundary.govLeak(candidateText);
    if (gov.violated) {
      printBlock({ rule: gov.rule, agentId, operation: operationLabel, reason: gov.reason, packetId });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: gov.rule, agentId, packetId,
        operation: operationLabel, notes: gov.reason + ' (NOT packet-overridable — content fix required).',
        exitCode: EXIT_BLOCK,
      });
    }
    // invented-authority + dosing-out-of-canon apply to GENERATION text only.
    if (candidateIsGeneration) {
      const inv = boundary.inventedAuthority(candidateText, agentRecord);
      if (inv.violated) {
        printBlock({ rule: inv.rule, agentId, operation: operationLabel, reason: inv.reason, packetId });
        return ledgerAndExit({
          status: 'BLOCKED', blockRule: inv.rule, agentId, packetId,
          operation: operationLabel, notes: inv.reason + ' (NOT packet-overridable).',
          exitCode: EXIT_BLOCK,
        });
      }
      const dose = boundary.dosingOutOfCanon(candidateText);
      if (dose.violated) {
        printBlock({ rule: dose.rule, agentId, operation: operationLabel, reason: dose.reason, packetId });
        return ledgerAndExit({
          status: 'BLOCKED', blockRule: dose.rule, agentId, packetId,
          operation: operationLabel, notes: dose.reason + ' (NOT packet-overridable).',
          exitCode: EXIT_BLOCK,
        });
      }
    }
  }

  // ── RULE: BC-PUBLIC-PUSH — push touching a public-repo path ──────────────────
  if (op === 'push') {
    const publicHits = classifications.filter((c) => c.isPublic);
    if (publicHits.length && authz.allowsPublicPush !== true) {
      const first = publicHits[0];
      printBlock({
        rule: 'BC-PUBLIC-PUSH', agentId, operation: operationLabel,
        reason: `Push touches public-repo path "${first.path}"; packet authorization.allowsPublicPush is not true.`,
        packetId, authorizer: authz.authorizedBy,
      });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: 'BC-PUBLIC-PUSH', agentId, packetId,
        operation: operationLabel, changed: publicHits.map((c) => c.path),
        notes: `public-repo push without allowsPublicPush; ${publicHits.length} public path(s).`,
        exitCode: EXIT_BLOCK,
      });
    }
  }

  // ── Per-path checks for state-changing ops ──────────────────────────────────
  if (isStateChanging && targetPaths.length === 0 && !checkMode) {
    // A state-changing op with no path and no packet to scope it → BC-NO-PACKET.
    if (!packet) {
      printBlock({
        rule: 'BC-NO-PACKET', agentId, operation: operationLabel,
        reason: 'A protected operation was attempted with no resolvable task packet and no path to scope it.',
        packetId,
      });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: 'BC-NO-PACKET', agentId, packetId: null,
        operation: operationLabel, notes: 'no packet, no path; refused.', exitCode: EXIT_BLOCK,
      });
    }
  }

  let touchedProtocol = false; // tracks whether any path is a customer-facing protocol artifact

  for (const c of classifications) {
    const m = c.protected;

    // Customer-facing protocol artifact?
    const isProtocolArtifact = m.matched && m.category === 'customerFacingProtocol';
    if (isProtocolArtifact) touchedProtocol = true;

    if (!m.matched) continue; // not protected → allowed by path (registry glob still applies below)

    // Protected & state-changing → needs authorization (unless non-overridable category).
    if (isStateChanging) {
      // BC-NO-PACKET: protected write with no packet at all.
      if (!packet) {
        printBlock({
          rule: 'BC-NO-PACKET', agentId, operation: `${op} ${c.path}`,
          reason: `"${c.path}" is a protected path (${m.category}); a write/commit/push/release here requires a task packet.`,
          packetId,
        });
        return ledgerAndExit({
          status: 'BLOCKED', blockRule: 'BC-NO-PACKET', agentId, packetId: null,
          operation: `${op} ${c.path}`, changed: [c.path],
          notes: `protected path ${c.path} (${m.category}) with no packet.`, exitCode: EXIT_BLOCK,
        });
      }

      // Non-overridable category (customer-facing protocol): no authorization can bypass the KRITE gate.
      // It is enforced by the content-audit shell below — but a non-protocol non-overridable
      // protected category would block outright here. (protected-paths marks customerFacingProtocol
      // overridable:false; release is handled by the content audit.)
      if (m.overridable === false && m.category !== 'customerFacingProtocol') {
        printBlock({
          rule: 'BC-PROTECTED-WRITE', agentId, operation: `${op} ${c.path}`,
          reason: `"${c.path}" is in non-overridable protected category "${m.category}". Not packet-overridable.`,
          packetId,
        });
        return ledgerAndExit({
          status: 'BLOCKED', blockRule: 'BC-PROTECTED-WRITE', agentId, packetId,
          operation: `${op} ${c.path}`, changed: [c.path],
          notes: `non-overridable protected category ${m.category}.`, exitCode: EXIT_BLOCK,
        });
      }

      // Overridable protected path: requires authorization.allowsProtectedPaths to name it exactly.
      if (m.category !== 'customerFacingProtocol' && m.category !== 'publicRepoPush') {
        const allowed = Array.isArray(authz.allowsProtectedPaths) ? authz.allowsProtectedPaths : [];
        const named = allowed.includes(c.path) || allowed.some((a) => globMatch(a, c.path));
        if (!named) {
          printBlock({
            rule: 'BC-PROTECTED-WRITE', agentId, operation: `${op} ${c.path}`,
            reason: `"${c.path}" is a protected path (${m.category}); packet authorization.allowsProtectedPaths does not name it.`,
            packetId, authorizer: authz.authorizedBy,
          });
          return ledgerAndExit({
            status: 'BLOCKED', blockRule: 'BC-PROTECTED-WRITE', agentId, packetId,
            operation: `${op} ${c.path}`, changed: [c.path],
            notes: `protected path ${c.path} (${m.category}) not named in allowsProtectedPaths.`, exitCode: EXIT_BLOCK,
          });
        }
      }
    }
  }

  // ── Registry default-deny: state-changing op path must fall in agent allowedPathGlobs ──
  // (unless the packet authorizes the exact protected path, already handled above)
  if (isStateChanging && agentRecord) {
    const globs = agentRecord.allowedPathGlobs || [];
    const authPaths = Array.isArray(authz.allowsProtectedPaths) ? authz.allowsProtectedPaths : [];
    for (const c of classifications) {
      const inGlobs = globs.some((g) => globMatch(g, c.path));
      const authorized = authPaths.includes(c.path) || authPaths.some((a) => globMatch(a, c.path));
      if (!inGlobs && !authorized) {
        printBlock({
          rule: 'BC-FORBIDDEN-TASK', agentId, operation: `${op} ${c.path}`,
          reason: `Path "${c.path}" is outside agent "${agentId}" allowedPathGlobs [${globs.join(', ')}] and not packet-authorized (default-deny).`,
          packetId,
        });
        return ledgerAndExit({
          status: 'BLOCKED', blockRule: 'BC-FORBIDDEN-TASK', agentId, packetId,
          operation: `${op} ${c.path}`, changed: [c.path],
          notes: `default-deny: path outside allowedPathGlobs, not authorized.`, exitCode: EXIT_BLOCK,
        });
      }
    }
  } else if (isStateChanging && !agentRecord && targetPaths.length) {
    // Unregistered agent attempting a state-changing op on any path.
    printBlock({
      rule: 'BC-NO-PACKET', agentId, operation: operationLabel,
      reason: `Agent "${agentId || 'UNREGISTERED'}" is not in agent-registry.json; default-deny.`,
      packetId,
    });
    return ledgerAndExit({
      status: 'BLOCKED', blockRule: 'BC-NO-PACKET', agentId, packetId,
      operation: operationLabel, notes: 'unregistered agent, state-changing op.', exitCode: EXIT_BLOCK,
    });
  }

  // ── DRIFT WIRE-IN (Module 4): run on any protected/protocol/public state change ─
  const driftChecks = [];
  const touchesSensitive =
    isStateChanging &&
    classifications.some((c) => c.protected.matched || c.isPublic);

  if (touchesSensitive || op === 'release' || touchedProtocol) {
    const cd = runCheckDrift();
    driftChecks.push({ check: cd.check, exit: cd.exit, summary: cd.summary });
    if (cd.missing) {
      process.stderr.write(`[gate] FATAL: drift script missing (${cd.summary}). Not fabricating a pass.\n`);
      printBlock({
        rule: 'BC-DRIFT-DETECTED', agentId, operation: operationLabel,
        reason: `Required drift script is missing/non-executable: ${cd.summary}.`, packetId,
      });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: 'BC-DRIFT-DETECTED', agentId, packetId,
        operation: operationLabel, driftChecks, notes: 'drift script missing — hard failure.', exitCode: EXIT_BLOCK,
      });
    }
    if (cd.exit !== 0) {
      printBlock({
        rule: 'BC-DRIFT-DETECTED', agentId, operation: operationLabel,
        reason: `check-drift.cjs exited ${cd.exit}: ${cd.summary}`, packetId,
      });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: 'BC-DRIFT-DETECTED', agentId, packetId,
        operation: operationLabel, driftChecks, notes: 'check-drift.cjs nonzero.', exitCode: EXIT_BLOCK,
      });
    }
  }

  // ── Customer-facing protocol artifact: content-contract + KRITE on release ───
  if (touchedProtocol) {
    for (const c of classifications.filter((x) => x.protected.matched && x.protected.category === 'customerFacingProtocol')) {
      const requireKrite = op === 'release' || authz.allowsRelease === true;
      const audit = runContentAudit(path.join(WORKSPACE_ROOT, c.path), requireKrite);
      driftChecks.push({ check: audit.check, exit: audit.exit, summary: audit.summary });

      if (audit.missing) {
        printBlock({
          rule: 'BC-CUSTOMER-COPY-NO-KRITE', agentId, operation: `${op} ${c.path}`,
          reason: `Required content-contract audit script is missing: ${audit.summary}.`, packetId,
        });
        return ledgerAndExit({
          status: 'BLOCKED', blockRule: 'BC-CUSTOMER-COPY-NO-KRITE', agentId, packetId,
          operation: `${op} ${c.path}`, driftChecks, notes: 'content-audit script missing.', exitCode: EXIT_BLOCK,
        });
      }
      if (audit.exit !== 0) {
        const rule = requireKrite ? 'BC-CUSTOMER-COPY-NO-KRITE' : 'BC-DRIFT-DETECTED';
        printBlock({
          rule, agentId, operation: `${op} ${c.path}`,
          reason: `content-contract audit exited ${audit.exit}${requireKrite ? ' (release gate / KRITE markers)' : ' (--strict)'}: ${audit.summary}`,
          packetId,
        });
        return ledgerAndExit({
          status: 'BLOCKED', blockRule: rule, agentId, packetId,
          operation: `${op} ${c.path}`, driftChecks, notes: 'content-contract audit nonzero.', exitCode: EXIT_BLOCK,
        });
      }
    }

    // Module 6: protocol packet MUST carry brain-sourced discoveryLineage evidence + brain ok.
    const vb = runValidateBrain();
    driftChecks.push({ check: vb.check, exit: vb.exit, summary: vb.summary });
    if (vb.missing || vb.exit !== 0) {
      printBlock({
        rule: 'BC-DRIFT-DETECTED', agentId, operation: operationLabel,
        reason: `validateBrain() ${vb.missing ? 'module missing' : 'failed'}: ${vb.summary}`, packetId,
      });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: 'BC-DRIFT-DETECTED', agentId, packetId,
        operation: operationLabel, driftChecks, notes: 'brain integrity failed.', exitCode: EXIT_BLOCK,
      });
    }
    const evidence = (packet && Array.isArray(packet.evidencePaths)) ? packet.evidencePaths : [];
    const hasLineage = evidence.some((e) => /brain-compound:/i.test(String(e)));
    if (!hasLineage) {
      printBlock({
        rule: 'BC-PROTOCOL-NO-LINEAGE', agentId, operation: operationLabel,
        reason: 'Protocol packet carries no brain-sourced discoveryLineage evidence (evidencePaths needs a brain-compound: reference).',
        packetId,
      });
      return ledgerAndExit({
        status: 'BLOCKED', blockRule: 'BC-PROTOCOL-NO-LINEAGE', agentId, packetId,
        operation: operationLabel, driftChecks, notes: 'no discoveryLineage evidence.', exitCode: EXIT_BLOCK,
      });
    }
  }

  // ── PASS ─────────────────────────────────────────────────────────────────────
  process.stdout.write(`[gate] PASS — agent "${agentId || '(none)'}" op "${op}" on [${targetPaths.map(relPath).join(', ') || '(none)'}]${packetId ? ` under packet ${packetId}` : ''}.\n`);
  return ledgerAndExit({
    status: 'PASS', blockRule: null, agentId, packetId,
    operation: operationLabel, changed: targetPaths.map(relPath), driftChecks,
    notes: checkMode ? 'self-check PASS for in-scope op.' : 'authorized op passed all gate rules.',
    exitCode: EXIT_PASS,
  });
}

// Only run main() when invoked directly (so `require('./gate.cjs')` loads cleanly for tests).
if (require.main === module) {
  main();
}

module.exports = { globMatch, matchProtected, relPath, parseArgs };
