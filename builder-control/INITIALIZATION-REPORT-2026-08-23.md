# AI Engineering OS — Initialization Report

**Date:** 2026-08-23
**Worktree:** `/Users/marcpapineau/.openclaw/worktrees/ai-engineering-os-v1`
**Branch:** `codex/ai-engineering-os-v1`
**Baseline / rollback commit:** `4b842f0dc231442cc6983bff4b71e21093453e8c`
**Packet:** `PKT-20260823-ENGINEERING-OS-V1`
**Not committed, not pushed** — as instructed.

This report separates **what was observed** from **what was assumed**. Anything
not actually run is marked UNVERIFIED, and anything not actually available is
marked UNAVAILABLE. Neither is written as PASS.

---

## 1. Baseline, recorded before any edit

Every required check was run against the untouched worktree first, so that any
red afterwards is attributable to this build and not inherited.

| command | exit |
|---|---|
| `node builder-control/packet-tools.cjs --validate …/ENGINEERING-OS-V1.json` | 0 |
| `node builder-control/test/dispatch-preflight.smoke.cjs` | 0 |
| `node builder-control/test/gate.test.cjs` | 0 |
| `node builder-control/test/boundary-checks.test.cjs` | 0 |
| `bash builder-control/test/layer4-telemetry.sh` | 0 |
| `bash scripts/test/doctrine-validators.sh` | 0 |
| `CI=1 node builder-control/single-authority-check.cjs` | 0 |
| `git diff --check` | 0 |

**Known pre-existing failures: none.** The baseline was fully green.

---

## 2. Authorization

```
node builder-control/preflight.cjs --packet builder-control/packets/ENGINEERING-OS-V1.json \
  --op write --path builder-control/schemas/engineering-review.schema.json \
  --path .github/copilot-instructions.md --path .github/agents/repo-guardian.md \
  --path .github/pull_request_template.md --path .github/workflows/builder-control.yml
```

```
[packet-tools] Schema check: PASS
[packet-tools] Registry check: PASS  (agentId="claude-code", all filesAllowed within allowedPathGlobs)
[gate] PASS — agent "claude-code" op "write" … under packet PKT-20260823-ENGINEERING-OS-V1
[gate] ledger entry appended (LED-2026-08-23-574577, status=PASS)
PRE-FLIGHT PASS ✓
```

Writes were authorized **before** they happened, and the decision is in the
ledger.

---

## 3. Workflow backup (required before editing enforcement)

```
cp .github/workflows/builder-control.yml .github/workflows/builder-control.yml.bak-2026-08-23

69862a7a5e3dd9159e7d66f7446be6af2ffe5272d1b1e7761a25c1c7df1b2453  builder-control.yml
69862a7a5e3dd9159e7d66f7446be6af2ffe5272d1b1e7761a25c1c7df1b2453  builder-control.yml.bak-2026-08-23
```

Byte-identical, confirmed by hash before the edit. The backup is **untracked**:
`.gitignore` now carries `.github/workflows/*.bak-*`, verified with
`git check-ignore -v` (`.gitignore:63`). `git status` shows nothing under
`.github/workflows/` other than the modified workflow itself.

---

## 4. What was built

| path | lines | what it is |
|---|---:|---|
| `builder-control/AI-ENGINEERING-OS.md` | 346 | the operating doctrine — lanes, order, roles, trigger phrases, cross-repo install, honest limits |
| `builder-control/engineering-os.cjs` | ~890 | the deterministic CLI — start, subject, classify, spec-check, validate-review, gate-done |
| `builder-control/review-adapters.cjs` | ~380 | read-only Codex/Grok/Copilot bridges; never fabricate a verdict |
| `builder-control/install-engineering-os.cjs` | ~250 | installs the complete package or refuses |
| `builder-control/tool-router.cjs` + `TOOL-CAPABILITY-CANON.json` | — | which tool may do which job, fail-closed on unverified availability |
| `builder-control/specs/AI-ENGINEERING-OS-OWNER-BRIEF-2026-08-23.md` | 150 | repo-pinned owner brief replacing the Mac-only attachment |
| `AGENTS.md` / `CLAUDE.md` | ~70 each | public-safe root routing into this system |
| `builder-control/schemas/engineering-review.schema.json` | 102 | what a usable review record must contain |
| `builder-control/test/engineering-os.test.cjs` | ~470 | 54 fixtures, including 21 CORRECTION PASS 1 red proofs |
| `builder-control/test/{tool-router,review-adapters,install-engineering-os}.test.cjs` | — | 8 + 9 + 7 fixtures |
| `.github/copilot-instructions.md` | 91 | durable repo instructions for Copilot |
| `.github/agents/repo-guardian.md` | 95 | the repository-integrity reviewer definition |
| `.github/pull_request_template.md` | 120 | the human-readable face of the gate |
| `.github/workflows/builder-control.yml` | 88 → ~250 | **extended**, not replaced — 6 Engineering OS steps appended, original 7 intact |
| `.gitignore` | +10 | keeps workflow backups untracked |

Only `filesAllowed` paths were touched. No application code, no Vitalis canon,
no customer-facing artifact, and nothing in the primary workspace or on
`codex/builder-control-system-v1`.

**No empty scaffolding documents were created.** The architecture attachment
lists `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`,
`API_CONTRACTS.md`, `DESIGN_SYSTEM.md`, `SECURITY_RULES.md` and others. None
were created, for two reasons: they are not in `filesAllowed`, and this is a
cross-repo operating system rather than a project — there is no product here to
specify. Creating nine empty headers to satisfy a checklist is the theatre this
system exists to prevent. §6 of the doctrine defines how a *consuming* project
pins its own spec instead.

---

## 5. Evidence — every required test, after the build

| command | exit |
|---|---|
| `node builder-control/packet-tools.cjs --validate …/ENGINEERING-OS-V1.json` | 0 |
| `node builder-control/preflight.cjs --packet … --op write --path …` (5 paths) | 0 |
| `node builder-control/test/engineering-os.test.cjs` | 0 — **54 passed, 0 failed** |
| `node builder-control/test/tool-router.test.cjs` | 0 — 8 passed |
| `node builder-control/test/review-adapters.test.cjs` | 0 — 9 passed |
| `node builder-control/test/install-engineering-os.test.cjs` | 0 — 7 passed |
| `node builder-control/test/dispatch-preflight.smoke.cjs` | 0 |
| `node builder-control/test/gate.test.cjs` | 0 |
| `node builder-control/test/boundary-checks.test.cjs` | 0 |
| `bash builder-control/test/layer4-telemetry.sh` | 0 |
| `bash scripts/test/doctrine-validators.sh` | 0 |
| `CI=1 node builder-control/single-authority-check.cjs` | 0 — all 5 jobs still have one owner |
| `git diff --check` | 0 |

**All 12 required checks pass (78 individual fixtures). Baseline preserved —
nothing regressed.**

Workflow validated beyond "it looks right":

- YAML parses (`yaml.safe_load`) — 13 steps, the original 7 intact.
- Every `run:` block passes `bash -n`.
- The new scripted steps were **executed locally**, not just parsed.
- `node --check` passes on all 22 `.cjs` files; zero NUL bytes repo-wide.

---

## 6. Observed facts about enforcement

**The new CI steps are binding on `main`.** Verified, not assumed:

```
$ gh api repos/MarcPapineau/cornerstone-apps/branches/main/protection --jq '.required_status_checks.contexts[]'
catalog guard + acceptance suite
doctrine validators + bypass telemetry
```

The job in `builder-control.yml` has display name
`doctrine validators + bypass telemetry` — an exact match. Three of the four new
steps hard-fail, so from the moment this branch merges, a change that breaks the
rule fixtures, or adds a packet with unpinned intent, **cannot merge to main**.

**CORRECTED 2026-08-23 (Correction Pass 1):** the review-evidence step was
originally shipped report-only behind an `ENGOS_ENFORCE` repository variable.
That opt-in has been **removed entirely**. A gate that can be switched off from
repository settings is a suggestion, and the moment it matters is exactly the
moment someone is tempted to switch it off. Every Engineering OS step now fails
the job when it fails.

| step | binding? |
|---|---|
| Engineering OS — rule fixtures still fire | **yes, blocks** |
| Engineering OS — router, adapter and installer fixtures | **yes, blocks** |
| Engineering OS — compute the subject once | **yes, blocks** |
| Engineering OS — bind to exactly one task packet | **yes, blocks** (two changed packets = ambiguous authorization) |
| Engineering OS — classify the subject | **yes, blocks**; writes the lane to the job summary |
| Engineering OS — required review evidence (binding) | **yes, blocks** — `--subject-sha` is passed explicitly and is mandatory in the CLI |

Note also: `enforce_admins` is **disabled** on `main`, so an admin can bypass
these required checks. That is pre-existing repository configuration, outside
this packet's scope, and stated here so the enforcement is not overread.

---

## 7. Reviewer availability — CORRECTED 2026-08-23 (Correction Pass 1)

**The original version of this section was wrong and is retracted.** It reported
Codex and Grok as UNAVAILABLE on the strength of `command -v codex` and
`command -v grok` returning nothing. Neither tool puts itself on `PATH` on this
machine, so that probe was measuring the wrong thing — a classic instrument
boundary reported as a finding. Both are installed.

Re-measured by direct absolute-path probe:

| capability | status | evidence |
|---|---|---|
| Codex CLI | **AVAILABLE** | `/Applications/ChatGPT.app/Contents/Resources/codex` — Mach-O arm64, executable; `--help` exits 0 and offers `exec`, `review`, `--sandbox read-only` |
| Grok CLI | **AVAILABLE** | `/Users/marcpapineau/.grok/downloads/grok-macos-aarch64` — Mach-O arm64, executable; `--help` exits 0 and offers `-p` single-turn, `--output-format json`, `--json-schema` |
| GitHub Copilot review | **UNVERIFIED** | `gh` is installed and authenticated, which is necessary but not sufficient. Copilot review requires a plan entitlement that cannot be confirmed without requesting a review on a real PR — a GitHub mutation this pass forbids. |
| Copilot CLI extension | **UNAVAILABLE** | `gh copilot --version` → "Copilot CLI not installed"; `gh extension list` empty |
| headless `claude` CLI | **BLOCKED** | `claude --print "…"` → "Not logged in · Please run /login". The Tool Capability Canon previously recorded this as "Credit balance is too low", which is not what the probe returns; the canon entry has been corrected. An interactive Claude Code session is a different execution path and is not evidence for that entry. |
| `gh` CLI | AVAILABLE | `/opt/homebrew/bin/gh`, authenticated as MarcPapineau |
| Node | AVAILABLE | v25.8.1 locally; CI pins Node 22 |

Verified continuously by `builder-control/test/review-adapters.test.cjs`, which
asserts the absolute paths, requires the doctor's status to agree with
`existsSync`, and fails if Copilot is ever reported as anything but UNVERIFIED.

**What this does and does not mean.** Codex and Grok can now actually be run,
read-only, against a bound subject diff by
`builder-control/review-adapters.cjs`, which preserves raw output and writes a
schema-validated record. That is a real integration, not an instruction file.

It still does not mean any review has been run. No adapter has been executed
against this change — doing so costs model time and was not part of this pass.
Reviewer availability is also machine-local: a GitHub runner has neither binary,
so records are produced locally and committed as evidence, and CI verifies their
binding and completeness rather than re-running the reviewers.

Copilot remains **UNVERIFIED**, not UNAVAILABLE and not integrated. Do not read
"Copilot guardian configured" as "Copilot is reviewing this repo".

## 8. Design decisions worth reviewing

**Copilot cannot approve, but can block.** The packet forbids Copilot comments
substituting for a required status check, so `copilot` is absent from
`requiredReviewers`. But an OPEN CRITICAL/HIGH finding from *any* reviewer,
advisory included, blocks `--gate-done`. Advisory means it cannot say yes — not
that it cannot say no.

**Reviews bind to a diff hash.** `reviewOf.diffSha256` is required, and
`--gate-done --diff-sha` refuses a record bound to a different diff. This is the
main anti-theatre property: it stops an approval being carried across a change.

**Spec pinning reuses `sourceOfTruth[]`.** The Notion rule needed a per-packet
pin, but `task-packet.schema.json` has `additionalProperties: false` and is not
in `filesAllowed`. Rather than fork the packet schema, pinning is expressed in
the existing array: a readable path is hashed, `<uri>@<version>` is taken as
pinned, and `UNVERIFIED: <source>` is allowed and reported. No second packet
format was created.

**CI checks changed packets, not all packets.** A repo-wide sweep was written
first and then **rejected on evidence**: it failed immediately because B1, B2 and
B3 cite workspace paths absent from this repository
(`scripts/lib/protocol-drafter-guard.js`, `policy/ledger.json`,
`peptide-resource-app/research-intel/brain.js`, `DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md`,
two `research/daniel-tool-scout-*.md`). Scoping to changed packets follows the
precedent the Layer 1 step already set in this same workflow, and for the same
stated reason: a permanently-red gate is one people route around.

**Review evidence is staged, not silently weakened.** Report-only mode prints
the identical verdict text and suppresses only the exit code, with a loud banner
saying so. It does not rewrite BLOCK into PASS.

---

## 9. Gaps — what is NOT done (rewritten after Correction Pass 1)

**Closed since the first draft:** local auto-activation (root `AGENTS.md` and
`CLAUDE.md` now route work here), reviewer integration (real read-only Codex and
Grok adapters), the `ENGOS_ENFORCE` opt-in (removed — the gate is unconditional),
the Mac-only source pin (replaced by a repo-pinned owner brief), and the two NUL
bytes in `engineering-os.cjs`.

Still open:

1. **No review has actually been run.** The adapters exist, are verified
   read-only, and resolve both binaries — but no Codex or Grok review was
   executed against this change. Running them costs model time and was not part
   of this pass. **The gate correctly reports this change as BLOCKED for missing
   review evidence.** That is the system working, not a defect.

2. **Copilot integration is UNVERIFIED, not done.** Instructions and a guardian
   definition exist and load. Whether this account can request a Copilot review
   needs an open PR and a GitHub mutation, both forbidden this pass.

3. **Root routing files are instructions, not enforcement.** `AGENTS.md` and
   `CLAUDE.md` route a compliant agent. An agent that ignores them is not
   stopped. CI is the layer that actually blocks.

4. **Three historical packets cite unresolvable sources.** Outside
   `filesAllowed`; rewriting completed sprint history to satisfy a new checker
   would be backwards. CI checks only *changed* packets. Backlog.

5. **A JSON-Schema validator exists in two places.** `packet-tools.cjs` has an
   equivalent draft-07 subset but exports nothing and is outside `filesAllowed`,
   so it could not be shared. Reported rather than hidden.

6. **The classifier reads paths, not content.** A hardcoded secret inside
   `utils/format.ts` is not caught by name.

7. **Correction-loop limit and drift audit are manual.** Doctrine §13 documents
   both. Nothing counts cycles or schedules an audit. They are practices, and
   calling them automated would be the overclaim this system exists to prevent.

8. **No runtime validation.** There is no application in this change to launch;
   it is process tooling. No runtime PASS is claimed. **UNVERIFIED.**

9. **CI has not run.** Everything here was executed locally on Node v25.8.1; CI
   pins Node 22. Nothing has been observed on a GitHub runner, because the
   instruction was not to push. **CI status: UNVERIFIED.**

10. **`enforce_admins` is off on `main`** — an admin can merge past every
    required check. Pre-existing, out of scope, stated so the guarantees are not
    overread.

11. **`software.build` does not route.** The Tool Capability Canon records the
    headless `claude` CLI as BLOCKED (not logged in), so the router refuses to
    route a build to it. Accurate, and it means the router is currently useful
    for review/red-team routing but not for build routing.

---

## 10. Checkpoint

- **Branch:** `codex/ai-engineering-os-v1`
- **Rollback commit:** `4b842f0dc231442cc6983bff4b71e21093453e8c`
- **Working tree:** modified, **uncommitted, unpushed** by instruction
- **Backup:** `.github/workflows/builder-control.yml.bak-2026-08-23` — untracked,
  gitignored; delete once the workflow change is confirmed good in CI
- **To revert everything:** `git checkout -- .github/workflows/builder-control.yml .gitignore`
  and delete the seven new files

**Confidence: MEDIUM.** High on the deterministic core — 33 fixtures and 9
required checks pass, and the binding relationship to branch protection was
verified against the live API rather than assumed. Medium overall because the
three model integrations are unverified by construction, CI has not run, and the
auto-activation requirement is only partly met.
