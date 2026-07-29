# Incident — 178 staged files destroyed, 2026-07-28

## What happened

A test commit was made with `git commit --no-verify` to simulate a gate bypass,
then removed with `git reset --hard HEAD~1`. The reset discarded 178 staged
files along with the test commit — roughly 43.5 MB of research-intel work
(the 28k-line research brain, per-peptide data, generated PDFs, doctrine
documents and three memory files).

Nothing reported a problem. Every local check was green throughout.

## Why nothing caught it

Three failures lined up, and each one was invisible on its own.

**1. The bypass was undetectable by design.** `git commit --no-verify` skips
pre-commit. The gate lived in pre-commit. A gate cannot observe the flag that
skips it, so the bypass left no trace anywhere.

**2. The watchdog reported the absence of evidence as evidence of absence.**
Its Layer 4 check read:

```js
if (!fs.existsSync(log)) return green.push('No gate bypasses recorded');
```

Nothing in the system ever wrote `bypass.log`. The file was therefore always
absent, so this always printed green. It was not measuring bypasses. It was
measuring its own ignorance and reporting it as safety.

**3. `reset --hard` discards staged work with no confirmation and no undo.**
Staged-but-uncommitted content is not recoverable from the index once the index
is overwritten. The only reason this incident was survivable is that the work
had been committed first — by the very test commit that was then reset away.

## How it was recovered

Recovery was exact, not reconstructed. No blob matching, no content-heading
guessing, no ambiguous files, no exceptions.

The reset-away commit `1006a5f` was still reachable through the reflog. Its tree
preserved all 178 paths with their original names. The proof of exactness is the
tree hash: after restoring, the index tree was
`f7c705dcb6dd223f820d4deff085715739a9764a` — byte-identical to `1006a5f^{tree}`.

Order of operations:

1. Pinned the dangling commit at `refs/recovery/2026-07-28-bypass-test` so it
   could not be garbage-collected.
2. Copied the entire 284 MB `.git` directory outside the repo before touching
   anything.
3. Materialized the commit's full 644-file tree to an external directory.
4. Backed up the one existing file that would be overwritten.
5. Restored, then verified all 178 files hash-matched their recovered blobs.

Everything is held at `~/Desktop/Marc HQ/RECOVERY-2026-07-28-GIT-FREEZE/`,
including a per-file manifest with blob SHA, size, source and collision status.

**No destructive command was used at any point in the recovery.** In particular
the four protected paths among the 178 went *through* the gate under an
authorization packet, not around it — the bypass that caused this incident was
not the tool used to repair it.

## What changed so it cannot recur silently

**Detection moved to a hook that `--no-verify` cannot skip.** This is measured,
not assumed, and the measurement is re-runnable
(`bash builder-control/test/bypass-experiment.sh`) — including in CI, against
whatever git version is current:

| | pre-commit | commit-msg | prepare-commit-msg | post-commit |
|---|---|---|---|---|
| normal commit | runs | runs | runs | runs |
| `--no-verify` | **SKIPPED** | **SKIPPED** | runs | runs |

`pre-commit` now issues a receipt naming the exact tree it approved.
`post-commit` checks whether the tree that actually landed carries one. Receipts
are keyed by tree hash, so a receipt cannot be replayed for a different commit.

The observer records; it never blocks. A blocked bypass just gets routed around,
and then nothing is learned.

**The watchdog's four states are no longer collapsed into one.** OK / BYPASS /
BLIND (observer missing, or log unwritable) / UNKNOWN (log absent or malformed).
Only OK is green. Malformed lines are findings, not skipped rows.

**CI reruns the gate server-side**, so a local bypass cannot purchase a remote
green. It runs on every branch now, not only `main`.

**The watchdog runs on a schedule that can be proven loaded** — a launchd agent,
verified against `launchctl print` rather than against its own exit code.

Seven failure modes are covered by tests, each exercised in a throwaway repo:
normal commit, `--no-verify`, missing log, unwritable log, stale receipt,
malformed telemetry, CI independence.

## It works — including on operations nobody thought about

Within an hour of going live the observer flagged two commits that no gate had
checked. Both were `git cherry-pick`, which does not run pre-commit. That was
not anticipated when the receipt scheme was designed; the check found it anyway,
because it asks "does this tree carry a receipt?" rather than "did someone use
the bad flag?".

## What this incident exposed beyond itself

- **231 client-facing protocol guides are untracked by git.** The doctrine
  checker's `--all` mode originally listed files via `git ls-files` and reported
  zero violations across the entire client corpus — because git could not see
  any of it. "Nothing is tracked" and "nothing is wrong" printed identically.
  Same failure class as the bug above, found the same day.
- **`scripts/audit-protocol-content-contract.mjs` was untracked** — the doctrine
  engine CLAUDE.md mandates by name and `gate.cjs` shells on every protocol
  write existed on one Mac only. CI could never have run it. Now committed.
- **The app could not boot from a clean checkout.** `data/` contains only
  gitignored runtime state, so a fresh clone has no such directory and the first
  save died on the missing directory. Every machine that had ever run the app
  already had it, so this was green locally and red on the runner. CI caught it
  on its first run.
- **105 standing doctrine violations** in 47 client documents, written before
  these rules were executable. Reported by the watchdog daily so the backlog
  cannot quietly become permanent.

## Standing risk that has not been fixed

`git reset --hard` still destroys staged work with no confirmation. Nothing
added here prevents that. What changed is that the *bypass* is now visible and
the *loss* is now recoverable-by-default, because enforcement is committed and
pushed rather than living on one laptop.

The habit worth keeping: commit before experimenting. This incident was
survivable only because the work had been committed first.
