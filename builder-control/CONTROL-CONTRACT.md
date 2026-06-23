# BUILDER CONTROL SYSTEM v1 — Canonical Control Contract

**Status:** CONTRACT LOCKED · ARCHITECT pass complete · awaiting builder implementation (B1/B2/B3)
**Home:** `/Users/marcpapineau/.openclaw/workspace/builder-control/`
**Author role:** ARCHITECT (writes the contract + schemas + builder packets; writes zero module code)
**Date:** 2026-06-22

This is the **single source of truth** that all builders (Claude Code, Codex, research, KRITE, protocol-core, visual-QA) implement against. If an implementation disagrees with this file, this file wins and the implementation is the bug.

---

## 0. WHY THIS EXISTS (the one-sentence mandate)

Every AI/agent build in this workspace must pass through **one** control loop — **Registry → Task Packet → Gate → Ledger** — so that no agent can write to a protected path, push to a public repo, invent authority, ship customer-facing copy without KRITE, leak FDA/Health-Canada authority framing, or dose outside canon **without an explicit, logged, packet-authorized exception**.

This is **one control loop, not four parallel systems** (Operational Simplicity — "10 gears, not 60"). Drift = cancer; this is the enforcement organ.

---

## 1. THE CONTROL LOOP (the whole system on one page)

```
                    ┌─────────────────────────────────────────────────────┐
                    │  builder-control/  (system home — ONE control loop)   │
                    └─────────────────────────────────────────────────────┘

   ① REGISTRY                ② TASK PACKET             ③ GATE                 ④ LEDGER
   agent-registry.json  →    task-packet.json    →    gate.cjs          →    ledger.json
   who each agent is,        the authorization:        HARD-BLOCK at          append-only
   what it MAY/MAY NOT       objective, files-         write/commit/push:     proof of every
   touch, what evidence      Allowed, tests, stop-     reads registry +       change: cmds,
   it must produce, what     conditions, agentId,      packet, refuses        tests, SHA,
   paths are protected       authorization scope       (exit≠0) on any        bundle hash,
                                                        unauthorized op        agentId, packetId
        │                          │                        │                      │
        └──────────────┬───────────┴────────────┬───────────┴──────────┬───────────┘
                       ▼                         ▼                      ▼
                  WIRES INTO (reuse, never rebuild — Module 4/6/7):
            ┌─────────────────────────────────────────────────────────────┐
            │ DRIFT      check-drift.cjs · audit-protocol-content-contract │
            │            .mjs · protocol-drafter-guard.js                  │
            │ BRAIN      research-intel/brain.js validateBrain() (v3)      │
            │ SCOUT      research/daniel-tool-scout-*.md → diff sidecar     │
            └─────────────────────────────────────────────────────────────┘
```

**Loop in words:**
1. An agent wants to do work. It must hold a **task packet** that names its `agentId`, the `filesAllowed`, the `sourceOfTruth`, the `testsRequired`, and `stopConditions`. No packet → no write.
2. The **gate** (`gate.cjs`) is invoked before any protected operation (write to protected path, `git commit`, `git push`, external release). It loads the **registry** + the **packet** and the **protected-paths** config, and decides PASS / HARD-BLOCK.
3. On a protected/customer-facing/protocol path, the gate ALSO shells the existing **drift detectors** and (for protocol builds) the **brain** requirement.
4. On PASS, the agent does the work, then writes an **append-only ledger entry** with evidence. On HARD-BLOCK, the gate exits non-zero with a violation message naming **the rule, the agent, the path** — and nothing is written.

---

## 2. SYSTEM HOME & FILE NAMING (decided)

**Home directory:** `builder-control/` at workspace root.

**Why one new dir and not `policy/`:** `policy/` already holds runtime **log** artifacts (`audit.log` 455KB, `alerts.log`, `ledger.json` stub). It is a logging sink, not a contract surface. Consolidating the *control contract* into `policy/` would bury the source-of-truth under churn logs. Instead: `builder-control/` is the **contract + schema + gate** home; the canonical evidence **ledger** is promoted out of the `policy/ledger.json` stub into `builder-control/ledger.json` (B2 migrates the one existing record — see §8). `policy/audit.log` / `alerts.log` remain where they are as raw runtime logs; the ledger is the *governed, structured* record.

| Concern | Canonical file (ONE each — Anti-Drift Rule 1) |
|---|---|
| Human-readable contract | `builder-control/CONTROL-CONTRACT.md` (this file) |
| Agent governance registry | `builder-control/agent-registry.json` |
| Task-packet schema | `builder-control/schemas/task-packet.schema.json` |
| Evidence-ledger entry schema | `builder-control/schemas/ledger-entry.schema.json` |
| Agent-registry schema | `builder-control/schemas/agent-registry.schema.json` |
| AI-scout diff schema | `builder-control/schemas/scout-diff.schema.json` |
| Live append-only ledger | `builder-control/ledger.json` |
| Protected-paths policy | `builder-control/protected-paths.json` |
| Gate entrypoint (builder writes) | `builder-control/gate.cjs` |
| Builder task-packets | `builder-control/BUILDER-PACKETS.md` (+ `packets/B1.json`, `B2.json`, `B3.json`) |

---

## 3. REGISTRY-CONSOLIDATION DECISION (the non-negotiable #1 constraint)

**Decision: REFERENCE, do not extend in place. Define ONE workspace-level governance registry (`builder-control/agent-registry.json`) that REFERENCES infra agents by their canonical name. Do NOT add governance fields to `cornerstoneregroup-site/data/managed-agents-registry.json`.**

**Why:**

1. **Two different concerns, two correct lifecycles.** The infra registry (`managed-agents-registry.json`) is a *runtime deployment ledger*: `agentId`, `environmentId`, `memstoreId`, `cron`, `runtimeType`, `sourcePath`. It changes when an agent is **(re)bootstrapped** (and per the immutability rule, agents are recreated → new IDs churn through it). The governance registry changes when Marc changes **what an agent is allowed to do**. Mixing them means a bootstrap rotation could silently drop a `forbiddenTasks` rule, or a permission edit could be clobbered by a redeploy. They must not be able to disagree on a shared field — so they share *no* governance field.

2. **The infra registry lives in a PUBLIC-pushed repo.** `cornerstoneregroup-site` pushes to `https://github.com/MarcPapineau/cornerstoneregroup-site.git`. Putting protected-path lists, forbidden-task rules, and the security posture of the whole agent fleet into a public-pushed file is itself an exposure. The governance registry stays workspace-level (not in a deploy repo).

3. **Single source of truth is preserved, not forked.** This is NOT a second competing registry — it holds **zero** runtime/infra fields. It holds governance fields *keyed by the same canonical agent name* (`daniel`, `karis`, …) and carries an `infraRef` pointer back to `managed-agents-registry.json`. The infra registry remains the ONLY source of `agentId`/`cron`/`runtimeType`. The governance registry is the ONLY source of `allowedTasks`/`forbiddenTasks`/`protectedPaths`/`requiredEvidence`. Neither can contradict the other because neither carries the other's fields.

**Binding rule for builders:** `agent-registry.json` MUST NOT duplicate `agentId`, `environmentId`, `memstoreId`, `cron`, or `runtimeType`. The gate, when it needs a runtime fact, resolves it via `infraRef` → reads `managed-agents-registry.json`. One fact, one home.

---

## 4. THE 7 MODULES (full pass)

### Module 1 — Agent Registry (`agent-registry.json`)
Per-agent governance record: `allowedTasks[]`, `forbiddenTasks[]`, `requiredEvidence[]`, `protectedPaths[]` (agent-scoped extras), `allowedPathGlobs[]`, `allowedOps[]`, and `infraRef` (pointer to the infra registry; null for non-infra agents like Claude Code / Codex which are local CLIs, not managed agents). Agents registered at minimum: **claude-code, codex, daniel** (research), **krite** (compliance/content gate), **protocol-core** (curated domain data), **visual-qa** — plus the infra agents that can write or release (karis, habakkuk where applicable). The registry is **default-deny**: an op not matched by `allowedOps` + `allowedPathGlobs` is blocked unless the packet authorizes an exception.

### Module 2 — Task Packet Generator (`schemas/task-packet.schema.json`)
The unit of authorization. Required fields: `packetId`, `agentId`, `objective`, `constraints[]`, `sourceOfTruth[]`, `filesAllowed[]`, `testsRequired[]`, `stopConditions[]`, `authorization{}`. A packet is the ONLY way an agent earns the right to touch a protected path or run a forbidden-by-default op — and only the **exact** path/op the packet's `authorization` names, logged with who authorized it. **The three builder packets in §9 are themselves the first conformance examples** — they validate against this schema.

### Module 3 — Evidence Ledger (`ledger.json` + `schemas/ledger-entry.schema.json`)
Append-only. Consolidates the `policy/ledger.json` stub shape and the **Gate-D JSON shape** into ONE entry schema: `entryId`, `ts`, `packetId`, `agentId`, `gate` (e.g. "control" / "D"), `status` (PASS/BLOCKED/INCOMPLETE), `changed[]` (paths), `commandsRun[]` (cmd + exit + output-tail), `testsRun[]`, `screenshots[]`, `commitSha`, `bundleHash`, `evidencePaths[]`, `driftChecks[]`, `notes`. Every gate decision — PASS **and** BLOCK — appends an entry. A change with no ledger entry **never happened** (mirrors the memory-file doctrine).

### Module 4 — Drift Detector (wire-in, do NOT rebuild)
The gate **calls** the existing scripts and **adds** general agent-boundary checks. It does not reimplement them.
- `peptide-resource-app/scripts/check-drift.cjs` — tier-matrix authority + forbidden-SKU/string drift (exit 1 on drift).
- `scripts/audit-protocol-content-contract.mjs --file <guide> --strict` — protocol content-contract structural gate; `--require-krite-approved` for release.
- `scripts/lib/protocol-drafter-guard.js` — STOP/delegate/canon interrupt + handoff-packet enforcement.
- **Brain integrity** (Module 6): `validateBrain()` from `peptide-resource-app/research-intel/brain.js`.

**New general agent-boundary checks the gate adds (§6 lists the rules):** protected-path write, public-repo push, invented authority, customer-facing copy without KRITE, FDA/Health-Canada (+ ClinicalTrials.gov / NCT / 503A / 503B / "U.S. regulator" / approvalStatus) authority leakage, dosing outside canon.

### Module 5 — Agent Permission Model (the HARD-BLOCK gate, `gate.cjs`)
Maps `agentId` → allowed paths/operations (from registry) → refuses unless the packet authorizes the specific op. **Posture = HARD-BLOCK from day one:** on any unauthorized write/commit/push/release the gate `process.exit(non-zero)` and refuses; nothing is written. A block is **debuggable** (the message names the violated rule, the agentId, the path/op, and the packetId if any) and **overridable ONLY** via an explicit `authorization` block inside a task packet — which is itself logged to the ledger. **No silent bypass exists.** There is no env-var, no `--force`, no "skip" flag. The only override is a packet, and a packet leaves a ledger trail.

### Module 6 — Research Brain Expansion Layer (gate REQUIREMENT, not new ingest code)
The v3 brain (`research-intel/brain/research-brain.json`, schema `vitalis.research-brain/v3`, with `compound.discoveryLineage` + `brain.practitionerProfiles`) is wired in as a **gate requirement**, not rebuilt. **Requirement:** any packet whose `objective`/`filesAllowed` touches a customer-facing **protocol** artifact MUST (a) pass `validateBrain()` with `ok:true`, and (b) carry brain-sourced **discoveryLineage** evidence in the ledger entry (`evidencePaths[]` must reference the brain compound slug whose `discoveryLineage.lineageClaims[]` backs the "why this peptide exists" copy). A protocol packet with no discoveryLineage evidence is HARD-BLOCKED. We build/require the BRAIN backend evidence; the dashboard/app stays the devs' surface (per Global Evidence Inclusion Doctrine).

### Module 7 — Weekly AI Scout (JSON sidecar/diff, do NOT rebuild the scout)
The DANIEL Monday scout keeps emitting its markdown (`research/daniel-tool-scout-YYYY-MM-DD.md`). We add a **JSON sidecar** (`research/daniel-tool-scout-YYYY-MM-DD.json`) conforming to `schemas/scout-diff.schema.json`, plus a diff vs. the prior week, so a downstream consumer (the control loop, or a Morning-Brief feed) sees only **"what changed how Marc builds"** — new adopt/test verdicts, substrate changes, watchlist promotions/expirations — without re-reading prose. The scout itself is untouched; B3 adds a thin emitter that reads the latest two markdown files and writes the sidecar + diff.

---

## 5. PROTECTED-PATHS POLICY (real paths in this workspace)

These paths are **default-protected**: no agent may create, edit, delete, move, commit, or push them **unless** its task packet's `authorization` names the exact path and a human/owner authorizer. The gate reads this list from `builder-control/protected-paths.json` (B1 writes the file; this is the authoritative content).

**Canon / doctrine (source-of-truth — drift-sensitive):**
- `peptide-resource-app/netlify/functions/_chat-tier-context.cjs` (TIER_MATRIX_SUMMARY — the ONLY definer; check-drift.cjs CHECK 2)
- `packages/protocol-core/data/dosing.js`
- `packages/protocol-core/data/evidence.json`
- `packages/protocol-core/data/catalog.json`
- `packages/protocol-core/data/research-sources.js`
- `packages/protocol-core/data/protocol-document-standard.js`
- `packages/protocol-core/research-doctrine.js`
- `memory/doctrine_tier_matrix_canonical.md`
- `memory/reference_vitalis_protocol_pricing_canon.md`
- `GOLD-STANDARD-PROTOCOL-CONTENT-CONTRACT-2026-06-18.md`
- `GLOBAL-EVIDENCE-INCLUSION-DOCTRINE.md`
- `AGENTS.md`, `BUILD-PROTOCOL.md`, `CLAUDE.md`

**Research brain (curated knowledge base — UPSERT-only, never freehand edit):**
- `peptide-resource-app/research-intel/brain/research-brain.json`
- `peptide-resource-app/research-intel/brain.js`
- `peptide-resource-app/research-intel/scoring.js`

**Customer-facing catalog / pricing (live commercial data):**
- `luke-app/public/catalog-data.json`
- `peptide-resource-app/public/catalog-data.json` (if present)
- any `**/catalog-data.json` (the drift checker already enumerates these; the gate protects writes to them)

**Public-repo paths (push = exposure — release-gated):**
- everything under `cornerstoneregroup-site/` (pushes to `github.com/MarcPapineau/cornerstoneregroup-site`)
- everything under `peptide-resource-app/` AND `packages/` that is tracked by the `cornerstone-apps` remote (`github.com/MarcPapineau/cornerstone-apps`)
- → a `git push` touching these requires a packet whose `authorization.allowsPublicPush === true`

**Control system itself (self-protection):**
- `builder-control/agent-registry.json`
- `builder-control/protected-paths.json`
- `builder-control/CONTROL-CONTRACT.md`
- `builder-control/schemas/*.json`
- (the gate may APPEND to `builder-control/ledger.json` — append is allowed; rewrite/truncate is protected)

**Customer-facing protocol artifacts (KRITE-gated):**
- `01-CORNERSTONE-RESEARCH-GROUP/**/*protocol*.html` and `**/*protocol-guide*.html` — writing/releasing requires the protocol content-contract audit to pass; external release requires `--require-krite-approved` to pass.

---

## 6. HARD-BLOCK RULE SET (what the gate refuses, and the message it prints)

Every rule below exits non-zero and refuses the operation. The block message format is fixed so false positives are debuggable:

```
BUILDER-CONTROL HARD-BLOCK
  rule:      <RULE-ID>
  agentId:   <agentId or "UNREGISTERED">
  operation: <write|commit|push|release> <path-or-ref>
  reason:    <one-line plain-English reason>
  packetId:  <packetId or "NONE — no task packet present">
  override:  add an authorization{} block to a task packet naming this exact path/op,
             authorized by <owner>, then re-run. There is no silent bypass.
```

| RULE-ID | Trigger | Override path |
|---|---|---|
| `BC-PROTECTED-WRITE` | write/edit/delete/move a `protected-paths.json` entry | packet `authorization.allowsProtectedPaths[]` names the exact path |
| `BC-PUBLIC-PUSH` | `git push` touching a public-repo path | packet `authorization.allowsPublicPush === true` |
| `BC-NO-PACKET` | any protected op with no resolvable task packet | create a conforming task packet |
| `BC-FORBIDDEN-TASK` | op matches the agent's `forbiddenTasks[]` | not overridable by packet — requires Marc to amend the registry |
| `BC-INVENTED-AUTHORITY` | output asserts a source-of-truth / dosing / evidence-tier the agent is not the canonical owner of (per registry `forbiddenTasks`) | route to canonical owner; not packet-overridable |
| `BC-CUSTOMER-COPY-NO-KRITE` | release of a customer-facing protocol artifact without KRITE markers | pass `audit-protocol-content-contract.mjs … --require-krite-approved` |
| `BC-GOV-AUTHORITY-LEAK` | customer-facing text contains FDA / Health Canada / ClinicalTrials.gov / NCT##### / 503A / 503B / "U.S. regulator" / approvalStatus as a value-authority | remove leakage (this is a content fix, not an override) |
| `BC-DOSING-OUT-OF-CANON` | dosing/schedule/blend not sourced from `protocol-core` canon (inferred from memory) | source from canon; not packet-overridable |
| `BC-DRIFT-DETECTED` | `check-drift.cjs` / content-contract / brain `validateBrain()` exits non-zero | fix the drift the script names |
| `BC-PROTOCOL-NO-LINEAGE` | protocol packet with no discoveryLineage brain evidence in ledger | add brain-sourced lineage evidence (Module 6) |

`BC-FORBIDDEN-TASK`, `BC-INVENTED-AUTHORITY`, `BC-DOSING-OUT-OF-CANON`, `BC-GOV-AUTHORITY-LEAK` are **NOT** packet-overridable by design — these are the "no parallel canon / no invented authority" non-negotiables from `DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md`. Only Marc amending the registry can change them.

---

## 7. WIRING MAP TO EXISTING ASSETS (reuse > rebuild — nothing here is rebuilt)

| Control-loop need | Existing asset wired in | How the gate uses it |
|---|---|---|
| Tier-matrix / SKU / string drift | `peptide-resource-app/scripts/check-drift.cjs` | `node scripts/check-drift.cjs`; exit≠0 → `BC-DRIFT-DETECTED` |
| Protocol content contract | `scripts/audit-protocol-content-contract.mjs` | `--file <guide> --strict` (build) / `--require-krite-approved` (release) |
| STOP/delegate/canon interrupt | `scripts/lib/protocol-drafter-guard.js` | `evaluateProtocolDrafterInstruction()` on the packet objective; blocked → require handoff packet |
| Brain integrity + lineage | `peptide-resource-app/research-intel/brain.js` (`validateBrain`, schema v3) | `validateBrain()` ok + lineage evidence for protocol packets (Module 6) |
| Weekly scout source | `research/daniel-tool-scout-*.md`, `skills/crg/nightly-research.md` | B3 emits JSON sidecar + diff (Module 7); scout untouched |
| Existing ledger record | `policy/ledger.json` | B2 migrates the single existing record into `builder-control/ledger.json` |
| Gate-D evidence shape | `01-CORNERSTONE-RESEARCH-GROUP/build-agent-v1/runtime-evidence/*.json` | `gate`/`status`/`trace_id`/`evidence_paths`/`notes` fields folded into the ledger-entry schema |
| Dispatch template | `DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md` | TASK/OWNER/OBJECTIVE/CONSTRAINTS/OUTPUT/SUCCESS/NEXT shape is the human-readable face of a task packet |
| Infra agent facts | `cornerstoneregroup-site/data/managed-agents-registry.json` | resolved via `infraRef` only; never duplicated (§3) |
| Permission allow-list | `luke-app/.claude/settings.local.json` | the CLI permission layer is the *coarse* allow-list; the gate is the *fine* governance layer. They are complementary: settings.local.json gates tool calls in one app; the gate governs writes/pushes/releases workspace-wide. The gate does NOT replace it. |

---

## 8. LEDGER MIGRATION NOTE (one existing record)

`policy/ledger.json` currently holds one record under key `agent:main:main` (a `research_report` artifact spawned to daniel on 2026-04-16). B2 migrates this into the new `builder-control/ledger.json` as a single back-dated entry (`gate:"legacy-import"`, `status:"IMPORTED"`, `notes` preserving the original `via`/`targetAgent`). After migration, `policy/ledger.json` is left as a stub with a pointer comment to the canonical ledger. No data is lost; there is exactly one ledger going forward.

---

## 9. THE THREE BUILDER PACKETS (summary — full packets in `BUILDER-PACKETS.md` and `packets/*.json`)

All three conform to `schemas/task-packet.schema.json` and point `sourceOfTruth` at this contract.

- **B1 — Registry + Gate.** Writes `agent-registry.json`, `protected-paths.json`, and `gate.cjs` (the HARD-BLOCK permission model + drift wire-in). Owns Modules 1, 4, 5.
- **B2 — Packet Generator + Ledger.** Writes the task-packet generator/validator and the append-only ledger writer; migrates `policy/ledger.json`. Owns Modules 2, 3.
- **B3 — Drift Generalization + Scout JSON.** Adds the general agent-boundary checks (gov-leak, invented-authority, dosing-canon, public-push) as a reusable module the gate imports, and the DANIEL scout JSON sidecar + diff emitter. Owns the Module 4 *generalization* and Module 7.

---

## 10. SUCCESS CRITERIA FOR THE WHOLE SYSTEM (how Marc knows it's real)

1. An unregistered agent attempting any protected write is HARD-BLOCKED with a named-rule message. (anti-theater: show the exit code + message)
2. A registered agent with a conforming packet authorizing the exact path PASSES, and a ledger entry with evidence is appended.
3. A `git push` to `cornerstoneregroup-site/**` without `allowsPublicPush` is HARD-BLOCKED.
4. A protocol guide release without KRITE markers is HARD-BLOCKED by the existing content-contract release gate, invoked through the gate.
5. The existing drift scripts run unchanged and their exit codes drive the gate.
6. There is exactly ONE registry, ONE ledger, ONE packet schema, ONE protected-paths file. No forks.
7. No silent bypass exists anywhere in the codebase (no `--force`, no skip env-var).
