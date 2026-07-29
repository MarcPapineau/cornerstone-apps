"use strict";
/**
 * dispatch-preflight.smoke.cjs — proves the Sprint-16 dispatch hook ENFORCES.
 *
 * Drives 4 cases through preflight.cjs (validate packet → gate) and asserts the
 * exit code + the blocking rule:
 *   1. a safe in-scope task packet PASSES (exit 0)
 *   2. a public-repo push BLOCKS (exit 3, BC-PUBLIC-PUSH)
 *   3. a gov-authority leak BLOCKS (exit 3, BC-GOV-AUTHORITY-LEAK)
 *   4. a protected canon write BLOCKS (exit 3, BC-PROTECTED-WRITE)
 *
 * Scratch packet lives under test/dispatch-scratch/ (gitignored via *-scratch/).
 * Run: node builder-control/test/dispatch-preflight.smoke.cjs   (exit 0 = all pass)
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HERE = __dirname; // builder-control/test
const BC = path.dirname(HERE); // builder-control
const PREFLIGHT = path.join(BC, "preflight.cjs");
const SCRATCH = path.join(HERE, "dispatch-scratch");
fs.mkdirSync(SCRATCH, { recursive: true });

const basePacket = {
  packetId: "SMOKE-dispatch-preflight",
  agentId: "claude-code",
  objective: "Smoke: prove dispatch pre-flight enforcement on a safe luke-app demo write.",
  constraints: ["Reuse existing modules", "No protected-path edits", "Anti-theater: show commands + exit codes"],
  sourceOfTruth: ["builder-control/CONTROL-CONTRACT.md"],
  filesAllowed: ["luke-app/public/preflight-demo.html", "luke-app/public/x.html"],
  testsRequired: ["node builder-control/test/gate.test.cjs"],
  stopConditions: ["gate blocks", "Marc issues STOP"],
  authorization: { authorizedBy: "none", allowsProtectedPaths: [], allowsPublicPush: false, allowsRelease: false },
};
const basePath = path.join(SCRATCH, "smoke-base-packet.json");
fs.writeFileSync(basePath, JSON.stringify(basePacket, null, 2));

function run(label, extraArgs, wantExit, wantRule) {
  const r = spawnSync("node", [PREFLIGHT, "--packet", basePath, ...extraArgs], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const exitOk = r.status === wantExit;
  const ruleOk = !wantRule || out.includes(wantRule);
  const ok = exitOk && ruleOk;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  console.log(`    exit=${r.status} (want ${wantExit})${wantRule ? `  rule "${wantRule}" ${ruleOk ? "seen ✓" : "MISSING ✗"}` : ""}`);
  if (!ok) console.log("    --- captured output ---\n" + out.split("\n").map((l) => "    " + l).join("\n"));
  return ok;
}

console.log("── DISPATCH PRE-FLIGHT SMOKE (Sprint 16) ───────────────────");
let allOk = true;
if (!run("safe in-scope write → PASS", ["--op", "write", "--path", "luke-app/public/preflight-demo.html"], 0, null)) allOk = false;
if (!run("public-repo push → BLOCK", ["--op", "push", "--path", "cornerstoneregroup-site/index.html"], 3, "BC-PUBLIC-PUSH")) allOk = false;
if (!run("gov-authority leak → BLOCK", ["--op", "write", "--path", "luke-app/public/x.html", "--text", "see ClinicalTrials.gov for the trial"], 3, "BC-GOV-AUTHORITY-LEAK")) allOk = false;
if (!run("protected canon write → BLOCK", ["--op", "write", "--path", "packages/protocol-core/data/dosing.js"], 3, "BC-PROTECTED-WRITE")) allOk = false;
console.log("────────────────────────────────────────────────────────────");
console.log(allOk ? "ALL 4 DISPATCH SMOKES PASS" : "SMOKE FAILURE — see captured output above");
process.exit(allOk ? 0 : 1);
