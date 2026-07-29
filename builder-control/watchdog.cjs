#!/usr/bin/env node
/**
 * watchdog.cjs — Layer 3. The system reports its own state instead of
 * waiting for Marc to remember to check it.
 *
 *   node builder-control/watchdog.cjs            print report
 *   node builder-control/watchdog.cjs --json     machine-readable
 *   node builder-control/watchdog.cjs --quiet    print ONLY if something is wrong
 *
 * Exit 0 = everything green. Exit 1 = at least one finding.
 *
 * Design rule: every check below answers "is enforcement actually running?",
 * not "does a document say enforcement exists". A doc can drift; these can't.
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sh = (cmd, opts = {}) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120000, ...opts }).trim() };
  } catch (e) {
    return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() };
  }
};

const findings = [];
const green = [];
const add = (sev, title, detail, fix) => findings.push({ sev, title, detail, fix });

// readLayer4 is a hoisted declaration below, so it can be exported here.
// Requiring this file gives you the reader WITHOUT running the checks — the
// tests need to drive Layer 4 against fixture repos, and running the real gate
// as a side effect of `require` would make that impossible (and slow).
module.exports = { readLayer4 };
if (require.main !== module) return;

// ── A. Does the app's quality gate pass right now? ──────────────────
(() => {
  const gate = path.join(ROOT, 'luke-app/vitalis-resource-app/scripts/gate.sh');
  if (!fs.existsSync(gate)) {
    return add('RED', 'Quality gate script is missing',
      'luke-app/vitalis-resource-app/scripts/gate.sh does not exist.',
      'Restore it from git history.');
  }
  const r = sh(`bash ${JSON.stringify(gate)}`);
  if (r.ok) green.push('App quality gate passes (catalog guard + acceptance suite)');
  else {
    const lines = r.out.split('\n').filter(l => /✗|FAIL|Error|error:/.test(l)).slice(0, 6);
    add('RED', 'Quality gate is FAILING',
      lines.length ? lines.join('\n   ') : 'gate.sh exited non-zero.',
      'Run: bash luke-app/vitalis-resource-app/scripts/gate.sh');
  }
})();

// ── A2. Do the enforcement's OWN tests still pass? ──────────────────
// Layers 1 and 4 catch other people's mistakes, so nothing fails when they
// quietly stop working. These suites are the only thing that notices.
(() => {
  const suites = [
    ['builder-control/test/bypass-experiment.sh', 'Layer 4 observer placement (post-commit survives --no-verify)'],
    ['builder-control/test/layer4-telemetry.sh', 'Layer 4 bypass telemetry fails closed'],
    ['scripts/test/doctrine-validators.sh', 'Layer 1 doctrine validators fire on their fixtures'],
  ];
  // Cross-lane checks: these are node, not shell suites.
  for (const [cmd, label] of [
    ['node builder-control/single-authority-check.cjs', 'Layer 2 one owner per job (no duplicate authorities)'],
  ]) {
    const r = sh(cmd);
    if (r.ok) green.push(label);
    else add('RED', `Check FAILING: ${cmd}`,
      r.out.split('\n').filter(l => /BLOCK|FAIL|duplicate/.test(l)).slice(0, 4).join('\n   ') || 'exited non-zero',
      `Run: ${cmd}`);
  }
  for (const [rel, label] of suites) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      add('RED', 'Enforcement self-test is missing', `${rel} does not exist — ${label} is unverified.`,
        'Restore it from git history.');
      continue;
    }
    const r = sh(`bash ${JSON.stringify(path.join(ROOT, rel))}`);
    if (r.ok) green.push(label);
    else add('RED', `Enforcement self-test FAILING: ${rel}`,
      r.out.split('\n').filter(l => /FAIL/.test(l)).slice(0, 4).join('\n   ') || 'suite exited non-zero',
      `Run: bash ${rel}`);
  }
})();

// ── A3. Standing doctrine debt across client documents ──────────────
// Reported, never silently cleared. These are violations in documents written
// before the rules became executable; CI blocks NEW drift rather than this
// backlog, so without a standing count the backlog would simply go unmentioned.
(() => {
  const r = sh('node builder-control/doctrine-check.cjs --all --summary');
  let j;
  try { j = JSON.parse(r.out); } catch {
    return add('RED', 'Doctrine rules could not be evaluated',
      (r.out || '').split('\n').slice(0, 3).join('\n   '),
      'Run: node builder-control/doctrine-check.cjs --all');
  }
  if (j.blocking > 0) {
    add('AMBER', `${j.blocking} standing doctrine violation(s) in ${j.filesWithBlocking} client document(s)`,
      'Pre-existing content written before these rules were executable.\n'
      + 'CI blocks new drift; this backlog is not blocked and will not clear itself.',
      'node builder-control/doctrine-check.cjs --all');
  } else {
    green.push(`No standing doctrine violations (${j.scanned} in-scope files)`);
  }
})();

// ── B. Is the enforcement itself committed? ─────────────────────────
// This is the failure that actually happened: gates built, verified, and left
// sitting untracked on one laptop. Enforcement that isn't committed is a
// personal habit, not a system.
(() => {
  const critical = [
    '.github/workflows/vitalis-app.yml',
    '.github/workflows/builder-control.yml',
    'luke-app/vitalis-resource-app/scripts/gate.sh',
    'luke-app/.claude/hooks/post-edit-gate.sh',
    'luke-app/.claude/settings.json',
    'builder-control/hooks/post-commit.sh',
    'builder-control/test/layer4-telemetry.sh',
    'scripts/test/doctrine-validators.sh',
  ];
  const untracked = [], dirty = [];
  for (const f of critical) {
    if (!fs.existsSync(path.join(ROOT, f))) { untracked.push(f + ' (missing)'); continue; }
    if (!sh(`git ls-files --error-unmatch ${JSON.stringify(f)}`).ok) untracked.push(f);
    else if (sh(`git diff --quiet HEAD -- ${JSON.stringify(f)}`).ok === false) dirty.push(f);
  }
  if (untracked.length)
    add('RED', 'Enforcement files are not committed',
      untracked.join('\n   '),
      'These exist only on this Mac. Commit and push them or CI cannot run.');
  if (dirty.length)
    add('AMBER', 'Enforcement files changed but not committed',
      dirty.join('\n   '),
      'Local gate differs from the one CI runs — "green" now means two things.');
  if (!untracked.length && !dirty.length)
    green.push('All enforcement files committed and clean');
})();

// ── C. Does CI actually exist on the remote? ────────────────────────
(() => {
  const remote = sh('git remote get-url origin');
  if (!remote.ok) return add('AMBER', 'No git remote', 'Cannot verify CI.', 'Add a remote.');
  const m = remote.out.match(/[:/]([^/:]+)\/([^/]+?)(\.git)?$/);
  if (!m) return;
  const slug = `${m[1]}/${m[2]}`;
  const r = sh(`gh api repos/${slug}/actions/workflows --jq .total_count`);
  if (!r.ok) return add('AMBER', 'Could not reach GitHub to verify CI', r.out.split('\n')[0] || '', 'Check: gh auth status');
  const count = parseInt(r.out, 10);
  if (!count) add('RED', 'CI does not exist on GitHub',
    `${slug} has 0 workflows registered.`,
    'Push the committed workflow. Until then nothing blocks a bad merge.');
  else {
    green.push(`CI live on ${slug} (${count} workflow${count > 1 ? 's' : ''})`);
    const runs = sh(`gh api "repos/${slug}/actions/runs?per_page=1" --jq '.workflow_runs[0].conclusion // "none"'`);
    if (runs.ok && runs.out === 'failure')
      add('RED', 'Most recent CI run FAILED', `on ${slug}`, `gh run list --repo ${slug}`);
  }
})();

// ── D. Are the local git hooks actually installed and executable? ───
(() => {
  const missing = ['pre-commit', 'pre-push'].filter(h => {
    const p = path.join(ROOT, '.git/hooks', h);
    try { fs.accessSync(p, fs.constants.X_OK); return false; } catch { return true; }
  });
  if (missing.length)
    add('AMBER', 'Local git hooks not installed', missing.join(', '),
      'Run: bash builder-control/hooks/install.sh');
  else green.push('Local pre-commit and pre-push hooks installed');
})();

// ── E. Bypass telemetry ─────────────────────────────────────────────
// Not blocked — blocked bypasses just get routed around. Logged ones get seen.
//
// The previous version of this check said "No gate bypasses recorded" whenever
// builder-control/bypass.log was absent. Nothing wrote that file, so it was
// always absent, so this always reported green. It was not measuring bypasses;
// it was measuring its own ignorance and calling it safety.
//
// readLayer4 now distinguishes the four states that used to collapse into one:
//   OK      observer installed, log readable, no bypasses in window
//   BYPASS  a commit went in with no gate receipt
//   BLIND   observer not installed, or the log cannot be read/written
//   UNKNOWN log missing or malformed — we genuinely cannot tell
// Only OK is green. Exported so builder-control/test/layer4-telemetry.sh can
// drive it against fixture repos instead of trusting it by inspection.
function readLayer4(root) {
  const log = path.join(root, 'builder-control/bypass.log');
  const hook = path.join(root, '.git/hooks/post-commit');

  let observerInstalled = false;
  try { fs.accessSync(hook, fs.constants.X_OK); observerInstalled = true; } catch { /* not installed */ }

  if (!observerInstalled) {
    return { state: 'BLIND', sev: 'RED',
      title: 'Bypass telemetry is not installed',
      detail: '.git/hooks/post-commit is missing. Nothing is watching for --no-verify commits,\n'
            + 'so this section can report nothing trustworthy about them either way.',
      fix: 'bash builder-control/hooks/install.sh --yes' };
  }

  if (!fs.existsSync(log)) {
    return { state: 'UNKNOWN', sev: 'AMBER',
      title: 'Bypass telemetry has never written a line',
      detail: 'The observer is installed but builder-control/bypass.log does not exist.\n'
            + 'Expected after a fresh install; suspicious if commits have happened since.',
      fix: 'Make any commit, then re-run the watchdog — a PASS line should appear.' };
  }

  // A log we cannot write is a log that will stop recording without telling us.
  try { fs.accessSync(log, fs.constants.W_OK); } catch {
    return { state: 'BLIND', sev: 'RED',
      title: 'Bypass log is not writable',
      detail: `${log}\nFuture bypasses will not be recorded, and the file will still look clean.`,
      fix: `chmod u+w ${log}` };
  }

  let raw;
  try { raw = fs.readFileSync(log, 'utf8'); } catch (e) {
    return { state: 'BLIND', sev: 'RED',
      title: 'Bypass log is unreadable', detail: String(e.message),
      fix: 'Inspect permissions on builder-control/bypass.log' };
  }

  const lines = raw.split('\n').filter(l => l.trim());
  const entries = [], malformed = [];
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (!e.ts || !e.verdict || isNaN(Date.parse(e.ts))) malformed.push(l);
      else entries.push(e);
    } catch { malformed.push(l); }
  }

  // Malformed lines are not skipped. Each one is a commit whose status we can no
  // longer establish, which is exactly the condition this layer exists to surface.
  if (malformed.length) {
    return { state: 'UNKNOWN', sev: 'RED',
      title: `${malformed.length} unparseable line(s) in the bypass log`,
      detail: 'Telemetry is corrupt, so bypass history cannot be trusted:\n'
            + malformed.slice(0, 3).map(l => l.slice(0, 90)).join('\n'),
      fix: 'Investigate what wrote these before trusting any green here.' };
  }

  const since = Date.now() - 7 * 864e5;
  const recent = entries.filter(e => Date.parse(e.ts) > since);
  const bypasses = recent.filter(e => e.verdict === 'BYPASS');
  const unknowns = recent.filter(e => e.verdict === 'UNKNOWN');

  if (bypasses.length) {
    return { state: 'BYPASS', sev: 'RED',
      title: `${bypasses.length} ungated commit(s) in the last 7 days`,
      detail: bypasses.slice(-4).map(e => `${e.ts} ${String(e.commit).slice(0, 9)} on ${e.branch} by ${e.author}`).join('\n')
            + '\nEach one is a commit no gate checked.',
      fix: 'git show <commit> — and run the gate against it before trusting that work.' };
  }
  if (unknowns.length) {
    return { state: 'UNKNOWN', sev: 'AMBER',
      title: `${unknowns.length} commit(s) with indeterminate gate status`,
      detail: unknowns.slice(-4).map(e => `${e.ts} ${e.detail || ''}`).join('\n'),
      fix: 'The observer ran but could not establish what happened. Investigate.' };
  }
  return { state: 'OK', sev: null,
    green: `No ungated commits in the last 7 days (${entries.length} commit(s) observed)` };
}

(() => {
  const r = readLayer4(ROOT);
  if (r.state === 'OK') green.push(r.green);
  else add(r.sev, r.title, r.detail, r.fix);
})();

// ── Report ──────────────────────────────────────────────────────────
const reds = findings.filter(f => f.sev === 'RED').length;
const ambers = findings.filter(f => f.sev === 'AMBER').length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ reds, ambers, findings, green }, null, 2));
  process.exit(findings.length ? 1 : 0);
}
if (process.argv.includes('--quiet') && !findings.length) process.exit(0);

const when = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
const out = [];
out.push('BUILD SYSTEM WATCHDOG — ' + when);
out.push('='.repeat(52));
out.push(findings.length
  ? `${reds} needing attention, ${ambers} worth a look`
  : 'Everything green. Nothing needs you.');
if (findings.length) {
  out.push('');
  for (const f of findings) {
    out.push(`[${f.sev}] ${f.title}`);
    out.push('   ' + f.detail.replace(/\n/g, '\n   '));
    out.push('   -> ' + f.fix);
    out.push('');
  }
}
if (green.length) {
  out.push('Working:');
  green.forEach(g => out.push('  - ' + g));
}
console.log(out.join('\n'));
process.exit(findings.length ? 1 : 0);
