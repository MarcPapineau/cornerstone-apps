#!/usr/bin/env node
/**
 * single-authority-check.cjs — Layer 2 drift protection.
 *
 * SCOPE, STATED HONESTLY: this is NOT "the doctrine diet". No document in this
 * workspace defines a doctrine diet or its acceptance criteria — the phrase
 * returns zero hits repo-wide — so the removal half of Layer 2 has no authority
 * to act under and has not been performed. Deleting doctrine on a guess is the
 * failure this system exists to prevent.
 *
 * What IS enforceable without that ruling is the invariant underneath it: for
 * each job, exactly one thing does it. Duplicate authorities are how "passing"
 * quietly starts meaning two different things — the same way a local gate and a
 * CI gate drift apart until green stops being a fact.
 *
 * Each rule below records a decision that has ALREADY been made and proven, and
 * fails if a second owner reappears.
 *
 *   node builder-control/single-authority-check.cjs
 *   node builder-control/single-authority-check.cjs --json
 *
 * Exit 0 = one owner per job. Exit 1 = a duplicate authority is back.
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rel = p => path.relative(ROOT, p) || p;
const exists = p => fs.existsSync(path.join(ROOT, p));

const sh = cmd => {
  try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

// Find candidate owners for a job, ignoring vendored/backup/history copies —
// an archived duplicate is history, not a competing authority.
const IGNORE = /(^|\/)(node_modules|\.git|_backups?|backups?|archive|\.session-archive[^/]*|\.session-restore[^/]*|dist|build)(\/|$)/;
function findFiles(nameRe) {
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (IGNORE.test(rel(full))) continue;
      if (e.isDirectory()) walk(full);
      else if (nameRe.test(e.name)) out.push(rel(full));
    }
  })(ROOT);
  return out.sort();
}

const rules = [
  {
    id: 'AUTH-1',
    job: 'the app quality gate — the definition of "green"',
    owner: 'luke-app/vitalis-resource-app/scripts/gate.sh',
    why: 'CI, the Claude Code post-edit hook and Marc all run this one file, so "it passes" means exactly one thing in three places. A second gate.sh would let two of them disagree.',
    check: () => {
      const found = findFiles(/^gate\.sh$/);
      return found.length === 1 && found[0] === 'luke-app/vitalis-resource-app/scripts/gate.sh'
        ? { ok: true, detail: found[0] }
        : { ok: false, detail: `expected exactly 1 gate.sh, found ${found.length}: ${found.join(', ') || 'none'}` };
    },
  },
  {
    id: 'AUTH-2',
    job: 'the protocol doctrine engine',
    owner: 'scripts/audit-protocol-content-contract.mjs',
    why: 'CLAUDE.md mandates this file by name and builder-control/gate.cjs shells it. Layer 1 added its validators HERE rather than building a second engine, so there is one place where a doctrine rule becomes executable.',
    check: () => {
      const found = findFiles(/^audit-protocol-content-contract\.mjs$/);
      if (found.length !== 1) return { ok: false, detail: `expected 1, found ${found.length}: ${found.join(', ') || 'none'}` };
      // Untracked enforcement is the 2026-07-28 failure class: it exists on one
      // Mac, so CI cannot run it and only that laptop is actually gated.
      const tracked = sh(`git ls-files --error-unmatch ${JSON.stringify(found[0])}`);
      return tracked
        ? { ok: true, detail: `${found[0]} (tracked)` }
        : { ok: false, detail: `${found[0]} exists but is NOT tracked by git — CI cannot run it` };
    },
  },
  {
    id: 'AUTH-3',
    job: 'the watchdog schedule',
    owner: 'launchd — com.cornerstone.builder-control.watchdog',
    why: 'COLLAPSED 2026-07-28: watchdog-install.sh previously wrote a crontab line. cron is deprecated on current macOS and fails silently without Full Disk Access. Two schedulers would mean two answers to "is the watchdog running?".',
    check: () => {
      const cron = sh('crontab -l 2>/dev/null');
      if (/builder-control-watchdog/.test(cron))
        return { ok: false, detail: 'a crontab entry for the watchdog is back — cron and launchd would both claim the schedule' };
      // Test the CODE, not the prose. The installer explains in a comment why it
      // stopped using cron; a check that fired on that would be punishing the
      // documentation of the very decision it exists to protect.
      const code = fs.readFileSync(path.join(ROOT, 'builder-control/watchdog-install.sh'), 'utf8')
        .split('\n')
        .filter(l => !/^\s*#/.test(l))
        .join('\n');
      if (/\bcrontab\b/.test(code))
        return { ok: false, detail: 'watchdog-install.sh calls crontab again (executable line, not a comment)' };
      return { ok: true, detail: 'launchd only; no crontab owner' };
    },
  },
  {
    id: 'AUTH-4',
    job: 'the protected-paths policy',
    owner: 'builder-control/protected-paths.json',
    why: 'gate.cjs reads exactly this file to decide what is protected. A second copy would create paths that are protected in one reader and open in another.',
    check: () => {
      const found = findFiles(/^protected-paths\.json$/);
      return found.length === 1
        ? { ok: true, detail: found[0] }
        : { ok: false, detail: `expected 1, found ${found.length}: ${found.join(', ')}` };
    },
  },
  {
    id: 'AUTH-5',
    job: 'the bypass observer',
    owner: 'builder-control/hooks/post-commit.sh',
    why: 'Layer 4 depends on exactly one hook writing bypass.log. Two writers would interleave and the log could no longer be read as a sequence of commits.',
    check: () => {
      // Two different questions, and conflating them broke CI on the first run.
      // Repo-side: does one observer script exist and does the installer wire
      // it? That is portable and belongs in CI. Machine-side: is it symlinked
      // into .git/hooks? That is per-clone state a fresh CI checkout can never
      // have, so asserting it there fails every honest build.
      const script = 'builder-control/hooks/post-commit.sh';
      if (!exists(script)) return { ok: false, detail: `${script} is missing — Layer 4 has no observer` };
      const installer = fs.readFileSync(path.join(ROOT, 'builder-control/hooks/install.sh'), 'utf8');
      if (!/post-commit\.sh/.test(installer))
        return { ok: false, detail: 'install.sh no longer installs the observer — new clones would be blind' };

      const hook = path.join(ROOT, '.git/hooks/post-commit');
      if (!fs.existsSync(hook)) {
        // On a working machine this is a real finding; in CI it is expected.
        return process.env.CI
          ? { ok: true, detail: `${script} present and wired by install.sh (CI: no local hook expected)` }
          : { ok: false, detail: '.git/hooks/post-commit not installed — Layer 4 is blind on THIS machine. Run: bash builder-control/hooks/install.sh --yes' };
      }
      const target = fs.lstatSync(hook).isSymbolicLink() ? fs.readlinkSync(hook) : hook;
      return /builder-control\/hooks\/post-commit\.sh$/.test(target)
        ? { ok: true, detail: `.git/hooks/post-commit -> ${rel(target)}` }
        : { ok: false, detail: `.git/hooks/post-commit points at ${target}, not the builder-control observer` };
    },
  },
];

const results = rules.map(r => ({ ...r, result: r.check() }));
const failed = results.filter(r => !r.result.ok);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ failed: failed.length, results: results.map(r => ({ id: r.id, job: r.job, owner: r.owner, ok: r.result.ok, detail: r.result.detail })) }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

console.log('SINGLE-AUTHORITY CHECK — one owner per job');
console.log('='.repeat(52));
for (const r of results) {
  console.log(`${r.result.ok ? 'ok  ' : 'FAIL'} ${r.id}  ${r.job}`);
  console.log(`       owner : ${r.owner}`);
  console.log(`       found : ${r.result.detail}`);
  if (!r.result.ok) console.log(`       why   : ${r.why}`);
}
console.log('');
if (failed.length) {
  console.log(`${failed.length} duplicate authority/authorities detected.`);
  console.log('Collapse to one owner before adding behaviour to either.');
  process.exit(1);
}
console.log(`All ${results.length} jobs have exactly one owner.`);
console.log('NOTE: the removal half of Layer 2 (retiring stale doctrine) is BLOCKED —');
console.log('no canonical definition of the doctrine diet exists to act under.');
