# Owner Brief — AI Development Operating System

**Product Owner:** Marc Papineau
**Date:** 2026-08-23
**Status:** APPROVED — this file is the pinned, in-repo statement of intent.

## Why this file exists

The original statement of this system's intent lived at
`/Users/marcpapineau/.codex/attachments/…/pasted-text.txt` — a path on one Mac.
A source of truth that only resolves on one machine cannot be verified by CI, by
a fresh clone, or by anyone else, which makes every "spec-governed" claim
unfalsifiable. This file replaces it. It is tracked, hashable, and resolves in a
clean checkout.

## Scope

A **generic build operating system for any repository**. Not a feature of any
product, not tied to any application. It governs *how software gets built here*,
in this repo and in every future one.

## Authority hierarchy

When sources conflict, higher wins:

1. Product Owner, explicit and current
2. Approved specification for the project being built
3. Reproducible runtime behaviour
4. Automated tests
5. Repository implementation
6. AI interpretation — never above this line
7. Conversation history — never authoritative

**GitHub records machine truth, not intent.** What the repo does is a fact; what
it should do is a decision. **An AI statement is not evidence, and AI consensus
is not evidence.**

**Specification laundering is prohibited.** Editing a spec so that accidental
implementation behaviour looks compliant is forbidden outright. Fix the
implementation, or get an explicit decision to change the spec.

## Roles

| role | who | authority |
|---|---|---|
| Builder / orchestrator | Claude | builds; **may not approve its own work** |
| Independent reviewer | Codex | APPROVE / APPROVE_WITH_NOTES / REJECT; not given the builder's reasoning |
| Repository guardian | GitHub Copilot | advisory — **cannot approve, can block** on CRITICAL/HIGH |
| Adversarial red team | Grok | read-only; high-risk/novel/security/milestone only |
| Final technical arbiter | tests + runtime | outranks every model |
| Final product authority | Product Owner | decides ambiguity |

Disagreements are never settled by vote. Evidence decides; if evidence cannot,
the Product Owner does.

## The loop

```
requirement + pinned spec → baseline → build → deterministic checks
→ independent review → corrections (max 3) → PR
→ CI + repository guardian → red team (high-risk only)
→ runtime validation → checkpoint
```

Ordering rule: **cheapest falsifier first.** A four-second typecheck never waits
behind a four-minute model review.

**Maximum 3 correction cycles.** After three unresolved cycles, stop looping and
escalate with both positions, the evidence, and a recommended resolution.
Models will optimise against each other indefinitely if permitted.

## Anti-drift rules

1. Never silently alter architecture to make the current task easier.
2. Never remove existing functionality unless explicitly required.
3. Never replace working logic with mock data, placeholders, or hardcoded values.
4. Never rewrite unrelated systems while implementing a scoped change.
5. Prefer the smallest coherent correct change.
6. Never change an API contract silently.
7. Never change a database schema silently.
8. Never weaken authentication or authorization to make something work.
9. Never delete or weaken a failing test to obtain a pass.
10. Never suppress legitimate errors to obtain a green build.
11. Compilation is not correctness.
12. Passing tests are not correctness if they do not check the requirement.
13. Visual appearance is not functional correctness.
14. AI agreement is not correctness.
15. Never modify a specification to make accidental behaviour appear compliant.
16. Always distinguish OBSERVED FACT / INFERENCE / ASSUMPTION / RECOMMENDATION.

## Evidence rules

- Anything not actually run is **UNVERIFIED**, never PASS.
- A capability that is absent is **UNAVAILABLE**, reported by name.
- Every finding carries evidence, impact, required correction, and a
  verification method. A finding without evidence is an opinion.
- A review is bound to the exact **subject diff** it read. A verdict on one diff
  never transfers to another.

## Severity

**CRITICAL** — security breach, data destruction, catastrophic regression,
authorization failure. Blocks.
**HIGH** — core functionality failure, major regression, serious architecture or
contract violation. Blocks.
**MEDIUM** — real defect, bounded impact. Evaluate before shipping.
**LOW / INFORMATIONAL** — record; never allowed to create review loops.

## High-risk change classes

Auth · secrets and credentials · payments · database migrations and schema ·
permissions and tenant isolation · cryptography · security controls · CI
workflow definitions · the control system itself · infrastructure definitions ·
public API contracts · major dependency migrations.

These require the full lane including an adversarial red-team pass.

## Definition of done

A change is not "done" because reviews exist. The terminal states are:

- **READY_FOR_DETERMINISTIC_VALIDATION** — required review evidence is present
  and bound to this subject diff.
- **READY_FOR_PR** — the above, plus the packet's deterministic checks have been
  executed and passed.

**Runtime validation and deployment are separate and are never implied by
either state.**

## Product Owner interruption policy

Resolve normal technical matters autonomously from evidence. Interrupt only for:
genuinely ambiguous product intent · two valid implementations with materially
different product behaviour · a material architecture change · a destructive
action needing authorization · a security decision that is a business decision ·
three correction cycles that did not resolve · a requirement conflicting with
another approved requirement · a material cost or infrastructure change.

## Periodic drift audit

After roughly five substantial features or one milestone, run a fresh-context
audit comparing the application that *should* exist (from approved docs) against
the one that *does* (from repo and runtime), scoring specification fidelity,
architectural fidelity, test confidence, and security confidence.

**This audit is a documented manual practice. It is not automated, and nothing in
this system schedules or runs it.**

## Human product intent and external sources

Human product intent may live outside the repo (for example in Notion). A live
page is **not** a pin — pages change and the build silently starts implementing
something nobody approved. Every packet source must be a readable path, an
external source carrying an explicit `@version`, or explicitly marked
`UNVERIFIED:`. Claiming spec governance without a pin is prohibited.
