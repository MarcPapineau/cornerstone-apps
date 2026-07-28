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

// ── B. Is the enforcement itself committed? ─────────────────────────
// This is the failure that actually happened: gates built, verified, and left
// sitting untracked on one laptop. Enforcement that isn't committed is a
// personal habit, not a system.
(() => {
  const critical = [
    '.github/workflows/vitalis-app.yml',
    'luke-app/vitalis-resource-app/scripts/gate.sh',
    'luke-app/.claude/hooks/post-edit-gate.sh',
    'luke-app/.claude/settings.json',
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
(() => {
  const log = path.join(ROOT, 'builder-control/bypass.log');
  if (!fs.existsSync(log)) return green.push('No gate bypasses recorded');
  const since = Date.now() - 7 * 864e5;
  const recent = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).filter(l => {
    const t = Date.parse(l.slice(0, 24)); return !isNaN(t) && t > since;
  });
  if (recent.length)
    add('AMBER', `${recent.length} gate bypass(es) in the last 7 days`,
      recent.slice(-4).join('\n   '),
      'Each one is a commit no gate checked.');
  else green.push('No gate bypasses in the last 7 days');
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
