#!/usr/bin/env node
/**
 * install-engineering-os.cjs — install the Engineering OS into another repo,
 * or refuse and say exactly what is missing.
 *
 * WHY THIS EXISTS
 * The first version of the install instructions were a `cp` list in a Markdown
 * file. That was dishonest by omission: engineering-os.cjs shells out to
 * packet-tools.cjs, ledger-writer.cjs and protected-paths.json, so copying the
 * five "Engineering OS" files into a repo without those produces a CLI that
 * looks installed, runs, and fails at the first gate — or worse, appears to
 * work because the failure is on a path nobody exercised yet.
 *
 * So this installs the COMPLETE required package, or it refuses. There is no
 * partial install, because a partial install of a gate is indistinguishable
 * from a working one right up until it matters.
 *
 *   node builder-control/install-engineering-os.cjs --doctor [--target <dir>] [--json]
 *   node builder-control/install-engineering-os.cjs --install --target <dir> [--force]
 *
 * Exit: 0 ok · 2 usage · 3 refused (prerequisites absent, or target unsafe)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SOURCE_ROOT = path.resolve(HERE, '..');

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_REFUSED = 3;

// The canonical Builder Control pieces this CLI actually calls at runtime.
// Every entry here is a real dependency, verified by reading the source: each
// is either require()d, spawned, or read by engineering-os.cjs or the code it
// invokes. Nothing is listed aspirationally.
const PREREQS = [
  { p: 'builder-control/packet-tools.cjs', why: 'engineering-os spawns it to validate a task packet' },
  { p: 'builder-control/ledger-writer.cjs', why: 'engineering-os spawns it to append ledger entries' },
  { p: 'builder-control/protected-paths.json', why: 'the risk classifier reads it; absent = hard block by design' },
  { p: 'builder-control/agent-registry.json', why: 'packet-tools validates agentId against it' },
  { p: 'builder-control/schemas/task-packet.schema.json', why: 'packet validation contract' },
  { p: 'builder-control/schemas/ledger-entry.schema.json', why: 'ledger append contract' },
  { p: 'builder-control/gate.cjs', why: 'the HARD-BLOCK gate the pre-flight composes' },
  { p: 'builder-control/preflight.cjs', why: 'the one mandatory dispatch pre-flight command' },
  { p: 'builder-control/boundary-checks.cjs', why: 'gate.cjs requires it' },
];

// The Engineering OS layer itself.
const OS_FILES = [
  'builder-control/engineering-os.cjs',
  'builder-control/review-adapters.cjs',
  'builder-control/install-engineering-os.cjs',
  'builder-control/tool-router.cjs',
  'builder-control/TOOL-CAPABILITY-CANON.json',
  'builder-control/schemas/engineering-review.schema.json',
  'builder-control/AI-ENGINEERING-OS.md',
  'builder-control/specs/AEGIS-V1-ARCHITECTURE-CONTRACT-2026-08-23.md',
  'builder-control/test/engineering-os.test.cjs',
  'builder-control/test/tool-router.test.cjs',
  'builder-control/test/review-adapters.test.cjs',
  'builder-control/test/install-engineering-os.test.cjs',
  // CONFIRMED FINDING #9: the installer described itself as shipping the
  // complete package while omitting the AEGIS projector, connector registry,
  // dashboard, routing policy, knowledge mirror and hosting. A "successful"
  // install then lacked the command centre entirely and failed the moment the
  // current workflow steps were copied across.
  'builder-control/aegis-state.cjs',
  'builder-control/knowledge-mirror.cjs',
  'builder-control/connector-registry.json',
  'builder-control/MODEL-ROUTING-POLICY.json',
  'builder-control/dashboard/index.html',
  'builder-control/hosting/server.cjs',
  'builder-control/specs/AEGIS-AMENDMENT-INTEGRATION-BUS-2026-08-23.md',
  'builder-control/specs/AEGIS-JARVIS-VISUAL-ARCHITECTURE-2026-08-23.md',
  'builder-control/specs/AEGIS-AMENDMENT-KNOWLEDGE-MIRROR-2026-08-24.md',
  'builder-control/test/aegis-state.test.cjs',
  'builder-control/test/dashboard-slice.test.cjs',
  'builder-control/test/knowledge-mirror.test.cjs',
  'builder-control/test/model-routing.test.cjs',
  'builder-control/test/hosting.test.cjs',
  // CONFIRMED FINDING #10: the installed test suite hardcodes this packet path
  // and the recommended post-install verification therefore failed on a fresh
  // install. Fixtures a test depends on are part of the package.
  'builder-control/packets/ENGINEERING-OS-V1.json',
  'builder-control/review-sign.cjs',
  'builder-control/hosting/README.md',
  'builder-control/test/ledger-atomicity.test.cjs',
  'builder-control/test/review-sign.test.cjs',
  'builder-control/specs/AI-ENGINEERING-OS-OWNER-BRIEF-2026-08-23.md',
  '.github/workflows/builder-control.yml',
  '.github/copilot-instructions.md',
  '.github/agents/repo-guardian.md',
  '.github/pull_request_template.md',
  'AGENTS.md',
  'CLAUDE.md',
];

const exists = (root, rel) => fs.existsSync(path.join(root, rel));

function auditSource() {
  return {
    prereqs: PREREQS.map((d) => ({ ...d, present: exists(SOURCE_ROOT, d.p) })),
    osFiles: OS_FILES.map((p) => ({ p, present: exists(SOURCE_ROOT, p) })),
  };
}

function auditTarget(target) {
  return {
    isDir: fs.existsSync(target) && fs.statSync(target).isDirectory(),
    isGit: fs.existsSync(path.join(target, '.git')),
    prereqs: PREREQS.map((d) => ({ ...d, present: exists(target, d.p) })),
    osFiles: OS_FILES.map((p) => ({ p, present: exists(target, p) })),
  };
}

function cmdDoctor(args) {
  const src = auditSource();
  const tgt = args.target ? auditTarget(args.target) : null;
  const missingSrcPrereq = src.prereqs.filter((d) => !d.present);
  const missingSrcOs = src.osFiles.filter((d) => !d.present);

  if (args.json) {
    console.log(JSON.stringify({ source: src, target: tgt, ok: missingSrcPrereq.length === 0 }, null, 2));
    return missingSrcPrereq.length ? EXIT_REFUSED : EXIT_PASS;
  }

  console.log('ENGINEERING OS — INSTALL DOCTOR');
  console.log('='.repeat(64));
  console.log(`source: ${SOURCE_ROOT}`);
  console.log('');
  console.log('Builder Control prerequisites (this CLI calls these at runtime):');
  for (const d of src.prereqs) {
    console.log(`  ${d.present ? 'ok     ' : 'MISSING'} ${d.p}`);
    if (!d.present) console.log(`          ${d.why}`);
  }
  console.log('');
  console.log('Engineering OS layer:');
  for (const d of src.osFiles) console.log(`  ${d.present ? 'ok     ' : 'MISSING'} ${d.p}`);

  if (tgt) {
    console.log('');
    console.log(`target: ${args.target}`);
    console.log(`  directory : ${tgt.isDir ? 'yes' : 'NO — does not exist'}`);
    console.log(`  git repo  : ${tgt.isGit ? 'yes' : 'no (not fatal, but the gate binds to git refs)'}`);
    const tMissing = tgt.prereqs.filter((d) => !d.present);
    console.log(`  prereqs   : ${tgt.prereqs.length - tMissing.length}/${tgt.prereqs.length} present`);
    const tOs = tgt.osFiles.filter((d) => d.present);
    console.log(`  OS layer  : ${tOs.length}/${tgt.osFiles.length} present`);
  }

  console.log('');
  if (missingSrcPrereq.length) {
    console.log(`REFUSED: ${missingSrcPrereq.length} prerequisite(s) missing from the SOURCE repo.`);
    console.log('There is nothing complete here to install.');
    return EXIT_REFUSED;
  }
  if (missingSrcOs.length) {
    console.log(`WARNING: ${missingSrcOs.length} Engineering OS file(s) not present in the source.`);
    console.log('An install would copy an incomplete layer. Fix the source first.');
    return EXIT_REFUSED;
  }
  console.log('Source is complete. An install would copy the full required package.');
  return EXIT_PASS;
}

function cmdInstall(args) {
  if (!args.target) { process.stderr.write('\n[install] --target <dir> is required\n'); return EXIT_USAGE; }
  const target = path.resolve(args.target);

  if (path.resolve(target) === path.resolve(SOURCE_ROOT)) {
    process.stderr.write('\n[install] REFUSED: target is the source repo.\n');
    return EXIT_REFUSED;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    process.stderr.write(`\n[install] REFUSED: target is not an existing directory: ${target}\n`);
    return EXIT_REFUSED;
  }

  // Refuse on an incomplete source rather than produce a half-installed gate.
  const src = auditSource();
  const missing = [...src.prereqs.filter((d) => !d.present), ...src.osFiles.filter((d) => !d.present)];
  if (missing.length) {
    process.stderr.write('\n[install] REFUSED — the source repo is missing required files:\n');
    for (const d of missing) process.stderr.write(`    ${d.p}${d.why ? `  (${d.why})` : ''}\n`);
    process.stderr.write('\nA partial install of a gate is indistinguishable from a working one\nuntil it matters. Nothing was copied.\n');
    return EXIT_REFUSED;
  }

  const all = [...PREREQS.map((d) => d.p), ...OS_FILES];
  const wrote = [];
  const skipped = [];
  for (const rel of all) {
    const from = path.join(SOURCE_ROOT, rel);
    const to = path.join(target, rel);
    if (fs.existsSync(to) && !args.force) { skipped.push(rel); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    try { fs.chmodSync(to, fs.statSync(from).mode); } catch { /* best effort */ }
    wrote.push(rel);
  }

  console.log('ENGINEERING OS — INSTALL');
  console.log('='.repeat(64));
  console.log(`target: ${target}`);
  console.log(`copied : ${wrote.length}`);
  for (const w of wrote) console.log(`  + ${w}`);
  if (skipped.length) {
    console.log(`kept   : ${skipped.length} existing file(s) left untouched (use --force to overwrite)`);
    for (const s of skipped) console.log(`  = ${s}`);
  }
  console.log('');
  console.log('NEXT — none of this is done for you, and none of it is claimed:');
  console.log('  1. Verify:  node builder-control/test/engineering-os.test.cjs');
  console.log('               node builder-control/test/tool-router.test.cjs');
  console.log('  2. Copy the "Engineering OS —" steps into the target CI workflow.');
  console.log('  3. Review protected-paths.json: it was copied from the source repo');
  console.log('     and lists SOURCE paths. It must be rewritten for the target, or');
  console.log('     the target will protect files it does not have and miss its own.');
  console.log('  4. Reviewer binaries are machine-local and were NOT installed.');
  console.log('  5. The attestation key is machine-local and was NOT copied.');
  console.log('     The first signed review generates one at builder-control/.attestation-key');
  console.log('     Add that path to the target .gitignore before signing anything.');
  console.log('     Run: node builder-control/review-adapters.cjs --doctor');
  return EXIT_PASS;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--target') a.target = argv[++i];
    else if (t === '--install') a.install = true;
    else if (t === '--doctor') a.doctor = true;
    else if (t === '--force') a.force = true;
    else if (t === '--json') a.json = true;
  }
  return a;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let code;
  if (args.doctor) code = cmdDoctor(args);
  else if (args.install) code = cmdInstall(args);
  else {
    process.stderr.write(`
install-engineering-os.cjs

  --doctor [--target <dir>] [--json]
        What is present, what is missing, whether an install could succeed.

  --install --target <dir> [--force]
        Copy the COMPLETE required package (Builder Control prerequisites +
        Engineering OS layer) into the target repo, or refuse and say why.

Exit: 0 ok · 2 usage · 3 refused
`);
    code = EXIT_USAGE;
  }
  process.exit(code);
}

module.exports = { PREREQS, OS_FILES, auditSource, auditTarget, SOURCE_ROOT };
