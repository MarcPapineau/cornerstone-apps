"use strict";
/**
 * preflight.cjs — Builder Control dispatch pre-flight wrapper (Sprint 16).
 *
 * The SMALLEST SAFE dispatch hook. It REUSES the existing pieces and reimplements
 * nothing:
 *   1. packet-tools.cjs --validate   → the task packet must be well-formed and in-scope.
 *   2. gate.cjs                        → the HARD-BLOCK decision for the declared risky
 *                                        action (write / commit / push / release / text),
 *                                        which itself appends a ledger entry on every call.
 *
 * Run this BEFORE any risky agent action (protected-path write, public-repo push,
 * customer-facing release, or customer-copy generation). Proceed with the work ONLY
 * on exit 0. This is mandatory PRE-FLIGHT enforcement — it does NOT yet intercept the
 * filesystem; an agent that never calls it is not stopped by it (see DISPATCH-RUNBOOK.md).
 *
 * Usage:
 *   node builder-control/preflight.cjs --packet <packet.json> \
 *        [--op write|commit|push|release|read] [--path <p> ...] \
 *        [--text "<candidate text>" | --text-file <file>] [--agent <id>]
 *
 *   With no --op/--path/--text, the gate runs in --check mode and self-checks the
 *   packet's declared filesAllowed scope.
 *
 * Exit codes (propagated from the gate so callers can branch on them):
 *   0 = PRE-FLIGHT PASS  — cleared to proceed.
 *   3 = HARD-BLOCK       — a control rule refused the action. Do NOT start the work.
 *   2 = usage / internal — bad args, packet not found, packet invalid, drift script missing.
 *
 * Source of truth: builder-control/CONTROL-CONTRACT.md. This wrapper adds NO new
 * doctrine; it operationalizes the existing contract.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const HERE = __dirname;
const PACKET_TOOLS = path.join(HERE, "packet-tools.cjs");
const GATE = path.join(HERE, "gate.cjs");

const EXIT_PASS = 0;
const EXIT_BLOCK = 3;
const EXIT_USAGE = 2;

function parseArgs(argv) {
  const out = { path: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--packet") out.packet = argv[++i];
    else if (a === "--op") out.op = argv[++i];
    else if (a === "--path") out.path.push(argv[++i]);
    else if (a === "--text") out.text = argv[++i];
    else if (a === "--text-file") out.textFile = argv[++i];
    else if (a === "--agent") out.agent = argv[++i];
  }
  return out;
}

function fail(msg, code) {
  process.stderr.write(`\n[preflight] ${msg}\n`);
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));

if (!args.packet) {
  fail(
    "Usage: node builder-control/preflight.cjs --packet <packet.json> " +
      "[--op X] [--path P ...] [--text ... | --text-file F] [--agent id]",
    EXIT_USAGE
  );
}
const packetPath = path.resolve(args.packet);
if (!fs.existsSync(packetPath)) {
  fail(`task packet not found: ${args.packet}`, EXIT_USAGE);
}

process.stdout.write("── BUILDER-CONTROL DISPATCH PRE-FLIGHT ─────────────────────\n");
process.stdout.write(`packet: ${args.packet}\n`);

// ── STEP 1: validate the task packet (packet-tools.cjs) ─────────────────────
process.stdout.write("\n[1/2] validating task packet (structure + in-scope filesAllowed) …\n");
const v = spawnSync("node", [PACKET_TOOLS, "--validate", packetPath], { stdio: "inherit" });
if (v.status !== 0) {
  fail(
    `PRE-FLIGHT BLOCKED — task packet is invalid (packet-tools exit ${v.status}). ` +
      "Fix the packet before dispatch.",
    v.status || EXIT_USAGE
  );
}

// ── STEP 2: HARD-BLOCK gate for the declared risky action (appends ledger) ──
process.stdout.write("\n[2/2] gate pre-flight (HARD-BLOCK decision + ledger append) …\n");
const gateArgs = [GATE, "--packet", packetPath];
if (args.agent) gateArgs.push("--agent", args.agent);

const hasExplicitAction =
  args.path.length > 0 || typeof args.text === "string" || typeof args.textFile === "string" || !!args.op;

if (!hasExplicitAction) {
  // No specific action named → self-check the packet's declared scope.
  gateArgs.push("--check");
} else {
  gateArgs.push("--op", args.op || "write");
  for (const p of args.path) gateArgs.push("--path", p);
  if (args.textFile) gateArgs.push("--text-file", args.textFile);
  else if (typeof args.text === "string") gateArgs.push("--text", args.text);
}

const g = spawnSync("node", gateArgs, { stdio: "inherit" });

process.stdout.write("────────────────────────────────────────────────────────────\n");
if (g.status === 0) {
  process.stdout.write("PRE-FLIGHT PASS ✓ — agent cleared to proceed. (decision logged to ledger)\n");
  process.exit(EXIT_PASS);
}
process.stdout.write(
  `PRE-FLIGHT BLOCKED ✗ — gate refused (exit ${g.status}). ` +
    "Do NOT start the work; resolve the rule shown above. (decision logged to ledger)\n"
);
process.exit(g.status || EXIT_BLOCK);
