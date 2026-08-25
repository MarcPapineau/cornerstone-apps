# AI ENGINEERING OS — how software gets built here

**Status:** v1 · installable · extends Builder Control
**Applies to:** every repository this is installed into. This is not a feature of
any one product and is not tied to any project.
**Source of truth:** [`CONTROL-CONTRACT.md`](./CONTROL-CONTRACT.md) for the control
loop; this file for the multi-model build process layered on top of it.

---

## 0. The mandate, in one sentence

Make it hard for incorrect software to survive the process — not by getting four
models to agree, but by making each one able to *refuse*, and by deciding
everything decidable with arithmetic instead of opinion.

The failure this exists to stop is not bad code. It is **a green light nobody
earned**: a PASS that came from a model's confidence, a review of a diff that no
longer exists, a test suite that stopped testing, a spec that was quietly edited
to match what got built.

---

## 1. Who decides what

When sources conflict, higher wins:

1. **Product Owner**, explicit and current
2. **Approved specification** for the project (pinned — see §6)
3. **Reproducible runtime behaviour**
4. **Automated tests**
5. **Repository implementation**
6. **AI interpretation** — never above this line
7. **Conversation history** — never authoritative

Two consequences worth stating plainly:

- **GitHub records machine truth, not intent.** What the repo does is a fact.
  What it *should* do is a decision, and decisions come from the Product Owner
  and the approved spec.
- **An AI statement is not evidence, and AI consensus is not evidence.** Four
  models agreeing is four opinions. A failing test is a fact.

**Never launder the spec.** If the implementation diverges, fix the
implementation or get an explicit decision to change the spec. Editing the spec
so accidental behaviour looks compliant is prohibited outright.

---

## 2. Two lanes

Not every change deserves a four-model review, and taxing trivial work is how a
process gets abandoned.

| | LIGHT | FULL |
|---|---|---|
| for | a genuinely tiny change to an **unprotected** document | anything meaningful |
| task packet | **not required** | required |
| required AI review | **none** | Codex |
| adversarial red team | no | only if high-risk (§3) |
| deterministic checks | yes | yes |
| spec pin | n/a (no packet) | yes |

The LIGHT lane has to actually be cheap, or nobody uses it — and a lane nobody
uses protects nothing. So it costs a typo fix nothing at all. Protected
documents and control files never reach it: they are caught as high-risk and
land in FULL.

**You do not choose the lane. The classifier does:**

```bash
node builder-control/engineering-os.cjs --classify --base <ref> --head <ref>
```

It fails toward FULL. A path it does not positively recognise as low-risk is
FULL. No changed paths supplied is FULL — it will not certify an unknown change
as trivial. Light lane also has size caps (5 files, 150 lines): a 400-line
"docs-only" change is a big change that happens to be in Markdown.

---

## 3. What counts as high-risk

Path-shaped, so it is knowable before anything is read and cannot be argued
with: auth/session/SSO · secrets, tokens, credentials · payments · database
migrations and schema · permissions, roles, tenant isolation · cryptography ·
security controls (CSRF, CORS, sanitisation) · `.github/workflows/**` ·
`builder-control/**` · infrastructure definitions · anything on
`protected-paths.json`.

Plus two you declare: `--milestone` and `--novel`.

High-risk adds the red team and nothing else changes.

---

## 4. The order, and why it is that order

```
requirement + spec pin
   ↓                        cheap, and everything downstream is meaningless without it
baseline recorded
   ↓                        so pre-existing failures are never blamed on this change
Claude builds
   ↓
deterministic checks        build · typecheck · lint · tests · gate.sh
   ↓                        ── free. Run before spending a model on review.
Codex reviews independently
   ↓                        given the requirement, spec, diff, tests — NOT Claude's reasoning
corrections (max 3 cycles)
   ↓                        then STOP and escalate; models will optimise against
   ↓                        each other forever if allowed to
PR opened
   ↓
GitHub CI + Copilot guardian
   ↓                        CI blocks. Copilot advises — and can block on CRITICAL/HIGH.
Grok red team               HIGH-RISK / novel / security / milestone ONLY. Read-only.
   ↓
runtime validation          the actual app, the actual request, the actual page
   ↓
checkpoint                  known-good commit + rollback point recorded
```

The ordering rule underneath it: **cheapest falsifier first**. A typecheck that
takes four seconds should never wait behind a model review that takes four
minutes and costs money.

---

## 5. The roles

**Claude — builder.** Explores, plans, implements, writes tests, coordinates.
**May not approve its own work.** A `claude-self` review record is accepted for
traceability and satisfies no required slot; the gate enforces this.

**Codex — independent reviewer.** Gets the requirement, the specs, the diff, the
tests. Deliberately **not** given Claude's reasoning — a reviewer handed the
author's justification is reviewing the justification. Returns APPROVE /
APPROVE_WITH_NOTES / REJECT.

**Copilot — repository guardian.** Answers the one question the other two
structurally cannot: *did this damage the repository as a whole?* Advisory
standing, and that cuts both ways — it **cannot approve**, it **can block** on a
CRITICAL or HIGH finding. Its comments never substitute for a required status
check or branch protection.

**Grok — adversarial red team.** Read-only. Enters only after the others believe
the change is correct, on high-risk work, with minimally contaminated context.
Never told "everyone thinks this is right". Its job is to find the case where
tests pass and users still get wrong behaviour.

**Tests and runtime — final technical arbiter.** They outrank every model.

Disagreements are never settled by vote. Evidence decides; if evidence cannot,
the Product Owner does.

---

## 6. Pinning intent (the Notion rule)

Human product intent may live in Notion. **A live page is not a pin** — pages
change under you, and the build silently starts implementing something nobody
approved.

Every packet's `sourceOfTruth[]` entry must be one of:

| form | meaning |
|---|---|
| a readable path | PINNED — content hash computed at check time |
| `<uri>@<version-or-hash>` | PINNED-EXTERNAL — taken at its word |
| `UNVERIFIED: <source>` | allowed, and reported as ungoverned |
| anything else | **UNRESOLVED → blocks** |

```bash
node builder-control/engineering-os.cjs --spec-check --packet <packet.json>
```

Marking something UNVERIFIED is always permitted. What is not permitted is
claiming a build implements an approved specification when nothing was pinned.

---

## 7. Reviews bind to a SUBJECT, not to "the branch"

The single most important mechanic here.

The **subject** of a build is the changed paths **minus the evidence about
them** — review records, raw reviewer transcripts, the task packet, the ledger
are all excluded:

```bash
node builder-control/engineering-os.cjs --subject --base <base> --head HEAD --json
```

Two independent reasons the exclusion is not optional:

1. **A review cannot be part of the hash it certifies.** If review records were
   in the subject, writing one would change the hash and invalidate the record
   that was just written. No set of reviews could ever satisfy the gate.
2. **Evidence must not escalate risk.** `builder-control/` is high-risk because
   the control *code* is. An ordinary front-end change that happens to carry its
   own packet and review records would otherwise inherit "the control system
   itself" and be forced to HIGH forever.

Control *code* stays in the subject and stays high-risk. Only evidence is
excluded.

Every review record carries `reviewOf.diffSha256` (the subject hash) and
`reviewOf.changedPaths` (**every** subject path it actually read). The gate
requires exact set equality: a reviewer that saw 3 of 11 files and returned
APPROVE is otherwise indistinguishable from one that saw everything.

Record schema: [`schemas/engineering-review.schema.json`](./schemas/engineering-review.schema.json).
A finding with no evidence is refused. A `ts` without a timezone is refused. A
missing `reviewerModel` is refused. A CRITICAL/HIGH finding with no impact,
correction and verification method is refused — an alarm that blocks the build
and tells nobody how to clear it is not evidence. A finding marked `FIXED` must
name the record that re-verified it, and that record may not be `claude-self`.

**Two records from the same reviewer for the same subject BLOCK as ambiguous.**
There is exactly one documented way to resolve that: the newer record declares
`supersedes: <reviewId>`. Resolution is never by timestamp or file order,
because that would let whichever record happened to sort later silently
overrule a rejection.

Records bound to a *different* subject are ignored entirely — they can neither
approve this change nor block it. Evidence about another thing is evidence about
another thing, in both directions.

## 8. The gate, and what it is allowed to claim

```bash
node builder-control/engineering-os.cjs --gate-done \
  --subject-sha <sha> [--packet <packet.json>] \
  [--base <ref>] [--head <ref>] [--review <record.json> ...] [--run-checks]
```

`--subject-sha` is **mandatory**. A gate decision with no bound subject
certifies nothing, so its absence is itself a block.

Fail-closed on: no subject binding · a subject hash that does not match the tree
· an invalid packet · unpinned intent · a missing required review · a review
bound to another subject or another packet · short or over-claimed coverage ·
a reviewer that was unavailable · a self-verified fix · two conflicting records ·
any OPEN CRITICAL or HIGH finding from *any* reviewer, advisory included.

There is no `--force`, no skip env-var, and no report-only mode. The only
override is a packet `authorization{}` block, which leaves a ledger trail.

**The terminal states are deliberately not "DONE":**

| state | means |
|---|---|
| `READY_FOR_DETERMINISTIC_VALIDATION` | required review evidence is present and bound to this subject |
| `READY_FOR_PR` | the above, **and** this process executed the packet's deterministic checks and they passed (`--run-checks`) |

Nothing here is a claim that the software is correct, and neither state implies
runtime validation or deployment. Those are separate and unclaimed. "Done" is a
word that invites everyone downstream to stop checking.

## 9. How this activates — what Marc actually says

**Start any task with one command. There is nothing to paste.**

```bash
node builder-control/engineering-os.cjs --start
```

It derives the subject from git, classifies it, and prints the next commands
with this change's real subject hash already filled in.

### Automatic, no prompt required

| surface | what fires | binding? |
|---|---|---|
| every push and PR | rule/router/adapter/installer fixtures, spec pin on changed packets, one-packet binding, classification, and the review-evidence gate | **yes — all of it fails the job** |
| every PR | the PR template asks for lane, baseline, evidence, review records | template, not enforcement |
| Copilot in this repo | `.github/copilot-instructions.md` + `.github/agents/repo-guardian.md` load automatically | advisory; can block on CRITICAL/HIGH |
| Claude Code / Codex locally | root `CLAUDE.md` and `AGENTS.md` route normal build requests here | instructions, not enforcement |

There is **no `ENGOS_ENFORCE` opt-in and no report-only mode**. A gate that can
be switched off from repository settings is a suggestion, and the moment it
matters is exactly the moment someone is tempted to switch it off.

### Trigger phrases — say one of these to change the lane

Say nothing and the classifier decides, which is the intended default.

| what Marc says | effect |
|---|---|
| *"full build"* / *"meaningful build"* / *"do this properly"* | force FULL lane |
| *"high risk"* / *"red team this"* / *"milestone"* | force FULL + red team (`--milestone`) |
| *"new surface"* / *"greenfield"* | force FULL + red team (`--novel`) |
| *"quick fix"* / *"light lane"* / *"trivial"* | **request** LIGHT — granted only if the classifier agrees. It overrides you toward more review, never toward less. |
| *"baseline first"* | record the baseline and stop for review before building |
| *"gate this"* | run `--gate-done` and report the verdict |
| **STOP** / **delegate** / **canon** / **source of truth** | hard interrupt — stop and hand off |

### When Marc gets interrupted

Deliberately rare. Normal technical calls are resolved from evidence. He is
interrupted only for: genuinely ambiguous product intent · two valid
implementations with materially different product behaviour · a material
architecture change · a destructive action needing authorization · a security
decision that is a business decision · **three correction cycles that did not
resolve** (a hard stop) · a requirement conflicting with another approved
requirement · a material cost or infrastructure change.

## 10. Running the reviewers

```bash
node builder-control/review-adapters.cjs --doctor
node builder-control/review-adapters.cjs --run --reviewer codex|grok|copilot \
  --packet <p> --subject-sha <sha> [--base <ref>] [--head <ref>]
```

Adapters run a reviewer **read-only** against the bound subject diff, preserve
raw output under `review-raw/`, and write a schema-validated record under
`reviews/`. Read-only is enforced at the tool — Codex runs under
`--sandbox read-only`, Grok in single-turn print mode with no approval flags.
Asking a model nicely not to edit files is not a control.

**No code path in the adapters emits APPROVE unless a reviewer actually said
so.** Tool missing, crashed, timed out, unparseable output, failed schema
validation — every one of those produces `UNAVAILABLE` with a concrete reason,
and the gate treats UNAVAILABLE as a block. A broken adapter stops the build
rather than waving it through.

## 11. Which tool is allowed to do which job

```bash
node builder-control/tool-router.cjs --task <taskId> [--data-class …] [--allow-metered]
```

The [Tool Capability Canon](./TOOL-CAPABILITY-CANON.json) maps task types to
tools, with each tool's availability backed by dated evidence. It is
fail-closed and switchable:

- A tool is selectable only when its availability is **verified with evidence**.
  Installed, mentioned, or seen in a screenshot is not executable.
- Where the canon requires a specialist, a general model may not imitate one.
  The route blocks instead.
- The default metered budget is **zero**. Subscription CLI, built-in, plugin and
  desktop-assisted execution are preferred; metered execution requires explicit
  authorization.
- Tools can be enabled, disabled or replaced without touching workflow doctrine.

## 12. Installing this in another repository

Do **not** hand-copy files. This CLI calls `packet-tools.cjs`,
`ledger-writer.cjs` and `protected-paths.json` at runtime; copying only the
"Engineering OS" files produces something that looks installed and fails at the
first gate.

```bash
node builder-control/install-engineering-os.cjs --doctor --target /path/to/other-repo
node builder-control/install-engineering-os.cjs --install --target /path/to/other-repo
```

It installs the **complete required package** or refuses and names what is
missing. There is no partial install, because a partial install of a gate is
indistinguishable from a working one until it matters.

After installing:

1. Verify: `node builder-control/test/engineering-os.test.cjs` (and the router,
   adapter and installer suites). If they do not pass, the install is
   incomplete — do not "fix" it by deleting a fixture.
2. Copy the `Engineering OS —` steps into the target repo's CI workflow.
3. **Rewrite `protected-paths.json` for the target.** It is copied from the
   source and lists *source* paths, so until it is rewritten the target
   protects files it does not have and misses its own.
4. Reviewer binaries are machine-local and are not installed by this. Run
   `review-adapters.cjs --doctor` on each machine.

## 13. Correction loops and drift audits

**Maximum three correction cycles.** After three unresolved cycles, stop looping
and escalate with both positions, the evidence, and a recommended resolution.
Reviewers will optimise against each other indefinitely if permitted.

**Periodic fresh-context drift audit** after roughly five substantial features or
one milestone: compare the application that *should* exist (from approved docs)
against the one that *does* (from repo and runtime).

Both of these are **documented manual practices**. Nothing in this system counts
cycles, schedules an audit, or enforces either. Calling them automated would be
the exact overclaim this document exists to prevent.

## 14. Honest limits

Read this before trusting the system.

- **Local auto-activation is instructions, not enforcement.** Root `CLAUDE.md`
  and `AGENTS.md` route work here, and an agent that ignores them is not
  stopped. CI is the layer that actually blocks.

- **This gate is a pre-flight, not a filesystem interceptor.** An agent that
  never calls it is not stopped by it. Inherited from `DISPATCH-RUNBOOK.md`.

- **Copilot integration is unproven.** The instructions and guardian definition
  exist and load. Whether this account can request a Copilot review is
  **UNVERIFIED** — confirming it needs an open PR and a GitHub mutation.

- **Reviewer availability is machine-local.** Codex and Grok are verified
  present on Marc's Mac at absolute paths; a GitHub runner has neither. Records
  are produced locally and committed as evidence; CI verifies binding and
  completeness rather than re-running the reviewers.

- **The classifier reads paths, not content.** A secret hardcoded inside
  `utils/format.ts` is not detected by name. Path-shaped risk is a cheap first
  filter, not a scanner.

- **`--subject` cannot see untracked files.** It warns when they exist. `git add`
  before binding reviews, or reviewers are bound to a diff missing the new code.

- **The headless `claude` CLI is currently BLOCKED** (not logged in), so
  `software.build` does not route to it. An interactive Claude Code session is a
  different execution path and is not evidence for that canon entry.
