# AEGIS V1 — Owner and Architecture Contract

**Owner:** Marc Papineau  
**Approved:** 2026-08-23  
**Status:** APPROVED FOR INCREMENTAL BUILD  
**Scope:** A generic local-first build operating system. It is not a feature of
any one product.

## 1. Outcome

AEGIS gives the Product Owner control over AI-assisted builds without requiring
him to read long agent transcripts. Within roughly ten seconds he should know:

- what is being built and against which approved requirement;
- the current workflow state, agent, model, tool, and execution mode;
- what failed, what is blocked, and what needs a human decision;
- which checks and reviews actually ran and where their evidence lives;
- whether metered spending occurred;
- the last known-good checkpoint and available rollback action.

The dashboard observes and controls the canonical Workflow Engine. **It does
not own or duplicate workflow state.**

## 2. Local-first boundary

The following live on Marc's machine in V1:

- dashboard application and local control service;
- durable workflow, policy, event, approval, and evidence records;
- SQLite database in WAL mode;
- repositories, isolated worktrees, specifications, and local artifacts;
- watchdog, heartbeats, leases, stale-run detection, and recovery metadata;
- tool/model configuration and budget policy;
- credential references. Secret values belong in macOS Keychain, never the DB,
  prompts, event log, screenshots, or repository.

GitHub, Notion, and cloud AI/media tools remain external services. Local-first
does not mean local inference: relevant context may leave the machine when an
external provider is used. The router must enforce data-classification limits
and record the provider selected.

## 3. Durable control plane

The orchestrator does not remember the state. A durable state machine owns it.
Every transition records actor, timestamp, subject, evidence, and policy
decision. Agents request transitions; policy permits or refuses them.

Minimum states:

`PENDING -> ANALYZING -> PLANNED -> IMPLEMENTING -> DETERMINISTIC_VALIDATION ->
INDEPENDENT_REVIEW -> CORRECTION -> RUNTIME_VALIDATION -> CHECKPOINTING ->
VERIFIED`

`BLOCKED`, `PAUSED`, `CANCELLED`, and `RECOVERY_REQUIRED` are explicit states.
Retries are idempotent. A lease prevents two workers owning one step. A
heartbeat and timeout expose abandoned work. Resume starts from durable state,
not conversation memory.

## 4. Execution modes and money

Every executable capability declares one mode:

1. `SUBSCRIPTION_CLI` — preferred when a supported authenticated CLI uses an
   existing subscription allowance.
2. `BUILT_IN` or `PLUGIN_MCP` — preferred when already available in the active
   surface and suitable for the task.
3. `DESKTOP_ASSISTED` — for attended or semi-attended work such as documents,
   Notion, or a provider UI. It is not trusted as the only unattended control
   path.
4. `API_METERED` — reliable headless execution when authorized.
5. `UNAVAILABLE` — honest terminal state when nothing appropriate can run.

Default metered budget is **$0**. A non-zero metered run requires a named human
approval and a hard cap. Included-plan usage is still tracked because plan
limits are finite.

## 5. Capability-first tool routing

AEGIS routes the task to a verified capability before choosing a model.

- Claude is not a video generator, advertising platform, design application,
  deployment host, or spreadsheet engine merely because it can describe one.
- A specialist-required task cannot fall back silently to a general model.
- Video generation prefers OpenArt when its connector is verified and enabled.
- Advertising requires an enabled advertising specialist selected in the Tool
  Capability Canon. Until one is connected, advertising execution blocks.
- Attachments, MCPs, plugins, APIs, CLIs, desktop tools, and future add-ons are
  all connector types behind the same selection contract.
- Tools may be enabled, disabled, reprioritized, or replaced without rewriting
  workflow doctrine.

Selection considers task match, availability evidence, data classification,
cost authorization, required inputs, output type, and owner preference. If no
eligible specialist exists, return `SPECIALIST_REQUIRED`, not an improvised
output.

## 6. Lean workflow

The ordering rule is **cheapest reliable falsifier first**:

`objective -> pinned acceptance criteria -> risk -> isolated worktree -> build
-> syntax/type/lint/unit/build checks -> independent review -> bounded
correction -> checks again -> PR/CI -> repository review -> runtime evidence ->
risk-gated red team -> watchdog -> checkpoint -> verified documentation sync`

Grok is required for high-risk, novel, security-sensitive, control-system, and
milestone work. It is not called for harmless formatting or tiny documentation
changes. Maximum normal correction cycles: three.

## 7. Tool Capability Canon

`builder-control/TOOL-CAPABILITY-CANON.json` is the versioned seed catalog for
task-to-tool policy. The live dashboard will store current probe results in its
local DB, but may not silently rewrite the canon.

Each tool profile names:

- supported task types and capabilities;
- preferred execution modes;
- availability and evidence;
- strengths and explicit exclusions;
- required inputs and output artifacts;
- cost class, approval rule, and data-classification ceiling;
- verification required before its output is accepted.

## 8. V1 vertical slice

V1 proves one complete local loop:

1. text objective entered;
2. acceptance criteria and risk recorded;
3. tool/model route selected from verified capabilities;
4. isolated worktree created;
5. builder runs;
6. deterministic checks run;
7. independent review binds to the exact subject;
8. corrections are bounded and rechecked;
9. watchdog proves the policy sequence;
10. checkpoint and rollback point recorded;
11. dashboard displays evidence, costs, blockers, and controls.

Notion begins as approved-intake plus one-way post-checkpoint synchronization.
Bi-directional conflict resolution, voice, cinematic visualization, historical
model learning, and dynamic optimization are later versions.

## 9. Anti-theatre acceptance

AEGIS V1 is not complete until the vertical slice is executed end-to-end and a
deliberate negative case proves each control blocks: missing specialist, stale
review, unavailable builder, failed deterministic check, skipped workflow step,
unauthorized metered spend, stale lease, and rollback from a known-good point.


---

# AMENDMENT — SCOPE REDUCTION (2026-08-24)

**Raised by:** Codex finding #11, correction cycle 2 · **Status:** the claimed V1
contract is hereby **reduced** to what is actually built.

## Why this section exists

The sections above described a durable control plane: a workflow state machine,
a SQLite WAL store, leases, heartbeats, stale-run recovery, objective intake,
isolated-worktree execution, watchdog sequencing, cost tracking, and
checkpoint/rollback controls. Codex verified against the repository and found
those facilities absent. That is correct.

There were two honest ways forward — build it, or stop claiming it. Leaving the
contract as written while shipping less is the third option, and it is the one
that produces a document nobody can trust. A contract that overstates what
exists is worse than no contract: it makes every future audit start from a false
baseline.

So the claim is reduced here, in writing, rather than quietly.

## What V1 actually is

**A deterministic evidence gate, plus a read-only projection of it.**

| built and tested | status |
|---|---|
| subject computation and binding | built |
| lane classification and risk taxonomy | built |
| task packet validation, spec pinning, `filesAllowed` authorization | built |
| review record schema, semantics, and **attestation** | built |
| fail-closed gate with no override | built |
| atomic, idempotent, append-only ledger | built |
| capability/cost/data-class model routing with hard budgets | built |
| read-only reviewer adapters (Codex, Grok) | built |
| knowledge mirror with conflict semantics — **no network** | built |
| connector registry and health projection — **declared, not probed** | built |
| authenticated, data-minimized local dashboard host | built |

## What V1 is NOT — explicitly withdrawn from the claim

- **No durable workflow state machine.** State lives in git, the ledger, and
  review records. There is no run table, no lease, no heartbeat.
- **No SQLite WAL store.** The ledger is a JSON file made atomic with a lock.
  Adequate for one machine and one operator; it is not a durable multi-writer
  store and must not be described as one.
- **No stale-run recovery**, because there are no runs to recover.
- **No objective intake.** Work starts from a hand-written task packet.
- **No isolated-worktree execution.** The operator creates the worktree.
- **No watchdog process.** Sequencing is enforced by the gate at decision time,
  not observed by anything at runtime.
- **No cost tracking.** Budgets are enforced *before* a metered call; actual
  spend is not recorded or accumulated. The $0.16 and $0.87 figures in the
  reports were read out of tool output by a human, not tracked by AEGIS.
- **No checkpoint or rollback control.** The rollback point is a git commit an
  operator notes down.
- **No runtime validation.** Nothing here executes the built software and
  observes it behaving correctly. `READY_FOR_PR` is deliberately named to avoid
  implying otherwise.

## Consequence for the terminal states

`READY_FOR_DETERMINISTIC_VALIDATION` and `READY_FOR_PR` mean exactly what they
say: the required process ran and left evidence. Neither means the software
works. With no runtime validation in V1, **no state produced by this system is a
statement about the behaviour of the built product.**

## Restoring the withdrawn scope

Each withdrawn item is a real requirement, not a bad idea. Restoring one means
building it and re-approving this contract — not editing this section. Order of
value if resumed: durable run records first (they unblock recovery, cost
tracking, and honest dashboard history at once), then runtime validation, then
checkpoint/rollback, then the watchdog.
