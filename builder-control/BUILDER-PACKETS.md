# BUILDER CONTROL v1 — Builder Task Packets

Three packets the orchestrator hands to three independent builders. Each conforms to `builder-control/schemas/task-packet.schema.json` (the first working examples of the schema) and points `sourceOfTruth` at `builder-control/CONTROL-CONTRACT.md`. Machine-readable copies: `builder-control/packets/B1.json`, `B2.json`, `B3.json`.

**Hand-off discipline (from `DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md`):** each builder returns an evidence packet — files changed, commands run with exit codes, gaps, next action. Completion words are banned without evidence in the same response.

**Do NOT let builders cross scope.** B1 owns the registry + gate. B2 owns the packet tools + ledger. B3 owns the boundary-check generalization + scout sidecar. A builder writing outside its `filesAllowed` is the exact drift this system exists to stop — and once the gate is live (after B1), it is HARD-BLOCKED.

---

## B1 — Registry + Gate (Modules 1, 4, 5)

**Objective.** Write `agent-registry.json` (governance only — `infraRef` pointers, no runtime fields) and build `gate.cjs`, the HARD-BLOCK permission gate: loads registry + task packet + `protected-paths.json`, decides PASS/BLOCK per the RULE-IDs in `CONTROL-CONTRACT.md §6`, and **shells** the existing drift scripts using their exit codes.

**Key constraints.**
- Reuse > rebuild: `gate.cjs` shells `check-drift.cjs`, `audit-protocol-content-contract.mjs`, `protocol-drafter-guard.js`, and `validateBrain()` — it reimplements none of them.
- `agent-registry.json` carries no `agentId`/`environmentId`/`memstoreId`/`cron`/`runtimeType` (those resolve via `infraRef` to `managed-agents-registry.json`).
- HARD-BLOCK from day one; block message follows the fixed §6 format (rule, agentId, operation, reason, packetId, override line).
- The ONLY override is a packet `authorization{}` block. No `--force`, no skip env-var, no silent bypass. `BC-FORBIDDEN-TASK`, `BC-INVENTED-AUTHORITY`, `BC-DOSING-OUT-OF-CANON`, `BC-GOV-AUTHORITY-LEAK` are not packet-overridable.

**filesAllowed.** `builder-control/agent-registry.json`, `builder-control/gate.cjs`, `builder-control/test/**`, `builder-control/packets/**`.

**testsRequired.** gate loads without throwing; self-check PASS for an in-scope write; simulated `BC-PUBLIC-PUSH` and `BC-NO-PACKET` both exit non-zero with named-rule messages; registry asserted free of runtime fields.

**stopConditions.** schema/contract disagreement; a check would require editing protected canon; a drift script missing/non-executable; two failures on the same gate-logic issue; Marc STOP/delegate/canon.

---

## B2 — Packet Generator + Ledger (Modules 2, 3)

**Objective.** Build the task-packet generator/validator (conforms to + validates against `task-packet.schema.json` and the agent's registry record) and the append-only ledger writer (`ledger-entry.schema.json` → `builder-control/ledger.json`); migrate the one existing `policy/ledger.json` record as a back-dated `IMPORTED` entry.

**Key constraints.**
- Ledger is append-only: never mutate/truncate; every entry schema-valid.
- Packet validator rejects unknown `agentId` and `filesAllowed` that escape the agent's `allowedPathGlobs` without authorization.
- Migrate the `agent:main:main` research_report (2026-04-16) preserving `via`/`targetAgent` in `notes`; leave `policy/ledger.json` as a stub pointing at the canonical ledger. No data loss.
- Exactly one ledger going forward. The Gate-D evidence shape folds into entries on import.

**filesAllowed.** `builder-control/packet-tools.cjs`, `builder-control/ledger-writer.cjs`, `builder-control/ledger.json`, `builder-control/test/**`, `policy/ledger.json`.

**Authorization note.** `authorizedBy: "Marc"` — this packet touches `policy/ledger.json` (a migration), logged accordingly. It does not authorize any protected canon path or public push.

**testsRequired.** validate B1/B2 packets exit 0; append grows the array by 1 with prior entries intact; migrate produces one `IMPORTED` entry + a stub; ledger remains valid JSON.

**stopConditions.** migration would lose a field; entry can't be schema-valid without fabrication; concurrent write to `policy/ledger.json`; two failures on the same issue; Marc STOP/delegate/canon.

---

## B3 — Drift Generalization + Scout JSON (Module 4 generalization, Module 7)

**Objective.** Build `boundary-checks.cjs` (pure functions `gate.cjs` imports — gov-authority leak, invented-authority, dosing-out-of-canon, public-push, customer-copy-without-KRITE — adding only what existing scripts don't cover) and `scout-sidecar.cjs` (parses the latest two DANIEL markdown scouts, emits `research/daniel-tool-scout-YYYY-MM-DD.json` per `scout-diff.schema.json` plus the week-over-week diff).

**Key constraints.**
- Do NOT rebuild the DANIEL scout — parse the existing markdown only, emit the sidecar next to it.
- Do NOT rebuild the existing drift scripts — `boundary-checks.cjs` adds only the missing checks; `gate.cjs` still shells the originals.
- Gov-leak suppression list stays aligned with `DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md` (it names the exact terms prior gates missed: ClinicalTrials.gov, NCT…, 503A, 503B, "U.S. regulator", approvalStatus).
- `diffVsPrior` surfaces verdict changes, new items, watchlist promoted/expired, substrate changes — "what changed how Marc builds," not prose.

**filesAllowed.** `builder-control/boundary-checks.cjs`, `builder-control/scout-sidecar.cjs`, `builder-control/test/**`, `research/daniel-tool-scout-2026-06-22.json`.

**testsRequired.** emit + schema-validate the 2026-06-22 sidecar (diff non-empty, substrate item present); gov-leak true on a ClinicalTrials.gov/NCT string, false on an animal-mechanism string; public-push true on a `cornerstoneregroup-site/**` path.

**stopConditions.** DANIEL markdown structure changed and won't parse — record the gap, don't fabricate; a check would duplicate an existing script — wire to it instead; schema/contract disagreement; two failures on the same issue; Marc STOP/delegate/canon.

---

## Build order

1. **B1 first** — once `gate.cjs` + `agent-registry.json` exist, the gate can govern B2 and B3's own writes.
2. **B2 and B3 in parallel** — independent file sets, both import nothing from each other (B3's `boundary-checks.cjs` is imported by B1's `gate.cjs`, not by B2). Wiring `boundary-checks.cjs` into `gate.cjs` is a one-line require B1 leaves a stub for and B3 fills — coordinate that single seam, nothing else.
