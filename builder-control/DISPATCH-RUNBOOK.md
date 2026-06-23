# DISPATCH RUNBOOK — Builder Control pre-flight (Sprint 16)

**Status:** OPERATIONAL · process-mandatory pre-flight · NOT yet a filesystem interceptor
**Source of truth:** [`CONTROL-CONTRACT.md`](./CONTROL-CONTRACT.md) — this runbook adds **no new doctrine**; it operationalizes the existing contract.
**Date:** 2026-06-22

---

## What this is

There is no single code chokepoint where agents are dispatched in this workspace — dispatch is orchestrator-driven (the Agent tool) and described in `DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md`, `BUILD-PROTOCOL.md`, and `AGENTS.md`. So enforcement is wired in as a **mandatory pre-flight step** that every Claude/Codex task runs **before** risky work, not as a kernel hook on the filesystem.

The pre-flight is one command — [`preflight.cjs`](./preflight.cjs) — that composes the three existing pieces (it reimplements nothing):

```
task packet ──▶ packet-tools.cjs --validate ──▶ gate.cjs (HARD-BLOCK + ledger append)
                  (well-formed, in-scope?)        (refuses unauthorized op, logs decision)
```

---

## The one mandatory command

Before any **risky action** — a write to a protected path, a `git push` to a public repo, a customer-facing **release**, or generating customer-facing **copy** — run:

```bash
node builder-control/preflight.cjs --packet <packet.json> \
     [--op write|commit|push|release] [--path <p> ...] \
     [--text "<candidate copy>" | --text-file <file>]
```

- **exit 0** → PRE-FLIGHT PASS. Proceed with the work.
- **exit 3** → HARD-BLOCK. A control rule refused it. **Do not start the work**; fix what the named rule says. (Override only via a task-packet `authorization{}` block — and the overridable rules only; `BC-GOV-AUTHORITY-LEAK`, `BC-DOSING-OUT-OF-CANON`, `BC-INVENTED-AUTHORITY`, `BC-FORBIDDEN-TASK` are never packet-overridable.)
- **exit 2** → packet invalid / usage / a drift script is missing. Fix and re-run.

With no `--op/--path/--text`, the gate runs in `--check` mode and self-checks the packet's declared `filesAllowed` scope.

Every run appends one decision (PASS or BLOCKED) to [`ledger.json`](./ledger.json) — that is the intended audit trail.

---

## The task-packet contract (what every dispatch must carry)

A task packet (schema: [`schemas/task-packet.schema.json`](./schemas/task-packet.schema.json)) is the unit of authorization. Required fields:

| Field | Meaning |
|---|---|
| `agentId` | must be a key in [`agent-registry.json`](./agent-registry.json) |
| `objective` | one precise sentence — what "done" looks like |
| `filesAllowed[]` | exact paths/globs this task may create or edit (**allowed files**) |
| `constraints[]` | hard rules (reuse>rebuild, anti-theater, no parallel canon …) |
| `sourceOfTruth[]` | authoritative files this work reads/implements against |
| `testsRequired[]` | commands that must run and pass before the ledger entry can be PASS |
| `stopConditions[]` | when the agent must STOP and hand off rather than continue |
| `authorization{}` | the only override surface; each non-default field is logged |

**Forbidden files** are not a packet field — they come from [`protected-paths.json`](./protected-paths.json) (global) plus each agent's `forbiddenTasks[]`/`protectedPaths[]` in the registry. The gate enforces them; a packet may only lift a *protected-path* block by naming the exact path in `authorization.allowsProtectedPaths`, authorized by an owner.

Generate a skeleton packet with: `node builder-control/packet-tools.cjs --new --agent <id> --objective "…"`.

---

## Proof it enforces (run any time)

```bash
node builder-control/test/dispatch-preflight.smoke.cjs
```

Drives four cases through `preflight.cjs` and asserts exit codes + rules — verified 2026-06-22:

| Case | Result |
|---|---|
| safe in-scope write | **PASS** (exit 0) |
| public-repo push | **BLOCK** `BC-PUBLIC-PUSH` (exit 3) |
| gov-authority leak in copy | **BLOCK** `BC-GOV-AUTHORITY-LEAK` (exit 3) |
| protected canon write | **BLOCK** `BC-PROTECTED-WRITE` (exit 3) |

---

## Enforcement level & known limits (be honest)

- **Achieved:** wrapper-script + **mandatory pre-flight by process**. When invoked, the gate hard-blocks unauthorized actions with a named rule and a ledger entry. No silent bypass exists *within* the gate (no `--force`, no skip env-var).
- **Not yet achieved:** filesystem interception. The gate is a **pre-flight check an agent must call** — an agent that writes directly without calling `preflight.cjs` is **not** stopped. This is the deliberate Sprint-16 boundary ("do not auto-block filesystem writes yet").
- **Known bypass (open):** skipping the pre-flight call. Closing it means a Claude Code **PreToolUse hook** (in `settings.json`) that routes `Write`/`Edit`/`Bash(git push…)` through the gate and blocks on non-zero — the natural next step once this pre-flight has run clean across real tasks (operational-loop stability before automation).
