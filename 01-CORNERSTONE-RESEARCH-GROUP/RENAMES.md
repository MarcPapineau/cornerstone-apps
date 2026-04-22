# CRG Rename Registry

Canonical log of every rename executed across the workspace. Append-only. Every
row represents one atomic propagation. Rule 6 (Rename-Propagation Gate,
ratified 2026-04-22) requires that:

1. Any canonical rename (agent, rubric, netlify function, memory file, doc)
   runs through `scripts/rename-propagate.sh <old> <new>`.
2. The rename is logged here on the same PR.
3. CI (`.github/workflows/rename-propagation.yml` in each repo that cares)
   reads this file and runs `scripts/rename-verify.sh <old>` for each row with
   `verified: false`. Merge fails if any stale reference survives.

## Format

| Date       | Old name                       | New name                       | Scope                   | Verified | Notes |
|------------|--------------------------------|--------------------------------|-------------------------|----------|-------|
| YYYY-MM-DD | `old-identifier`               | `new-identifier`               | workspace / site / cc   | true/false | freeform |

## Log

| Date       | Old name                       | New name                       | Scope      | Verified | Notes |
|------------|--------------------------------|--------------------------------|------------|----------|-------|
| 2026-04-21 | `Judge`                        | `Samuel`                       | workspace  | true     | Agent rename — prophet-judge doctrine. Re-verified clean 2026-04-22. |
| 2026-04-21 | `Riley`                        | `Lazarus`                      | workspace  | true     | Agent rename — resurrected call-recovery agent. |
| 2026-04-21 | `agent-judge-background`       | `samuel-background`            | site       | true     | Netlify function rename following Samuel agent rename. |

## Pending (verified: false)

_No pending renames as of 2026-04-22._

---

**Maintenance:** when a rename's verify run returns 0 (zero stale refs), flip
`Verified` to `true`. Rows marked `true` stay in the log for traceability —
this file is a ledger, not a todo list.
