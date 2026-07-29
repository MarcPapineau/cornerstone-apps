# builder-control/hooks — opt-in git enforcement

These hooks close the Sprint 0 "enforcement-by-convention" gap: until now nothing
*forced* an agent to call `gate.cjs`. These scripts route protected writes and
public pushes through the gate at `git commit` / `git push` time.

**They are OPT-IN and MANUAL. Nothing here is auto-installed.** Sprint 1 ships them
tested but inert until a human runs the installer.

## Files

| File | Purpose |
|---|---|
| `pre-commit.sh` | On commit: routes staged **protected-path writes** through `gate.cjs` (op=write). Fail-closed. |
| `pre-push.sh` | On push: routes **public-repo paths** through `gate.cjs` (op=push). Fail-closed. |
| `_filter-sensitive.cjs` | Helper that reuses `gate.cjs matchProtected()` + `boundary-checks.publicPush()` so only sensitive files hit the gate (routine commits stay fast). Defines no new policy. |
| `install.sh` | **Manual** installer. Dry-run by default; symlinks into `.git/hooks` only with `--yes`. |
| `smoke-test.cjs` | Verifies syntax + block/allow behavior without touching real git staging. |

## Install (manual, when you choose to)

```bash
bash builder-control/hooks/install.sh          # dry run — shows what it would do
bash builder-control/hooks/install.sh --yes    # actually symlink the hooks
# uninstall:
rm -f .git/hooks/pre-commit .git/hooks/pre-push
```

## Behavior

- Ordinary files are **not** gated — only paths matching `protected-paths.json`
  (commit) or public-repo paths (push) invoke the full gate.
- A gate block (exit 3) or error (exit 2) **aborts** the commit/push (hook exits 1).
- The only override is a task-packet `authorization{}` — pass it via `BC_PACKET=<path>`.
  There is no `--force`, no skip env-var (the gate refuses those).

## Env overrides

| Var | Effect |
|---|---|
| `BC_AGENT` | agentId attributed to the op (default `claude-code`) |
| `BC_PACKET` | task packet authorizing the protected write / public push |
| `BC_HOOK_FILES` | explicit file list (used by `smoke-test.cjs`; bypasses git for testing) |

## Test

```bash
node builder-control/hooks/smoke-test.cjs
```

Note: smoke tests invoke the real gate, which appends `builder-control/ledger.json`
entries by design (every gate decision is ledgered) — that growth is expected
evidence, not a side effect to suppress.
