# AGENTS.md

Instructions for any AI agent working in this repository. Short on purpose:
rules that a machine can check live in code, not in prose, because prose drifts
and a check cannot.

## Before you change anything, run this

```bash
node builder-control/engineering-os.cjs --start
```

It tells you what you are changing, how much review that requires, and the exact
commands to run next. Run it first. Do not assign a lane by hand — the
classifier decides, and it deliberately fails toward more review, not less.

## The rule

Every meaningful change follows [`builder-control/AI-ENGINEERING-OS.md`](builder-control/AI-ENGINEERING-OS.md).

- **LIGHT lane** — a genuinely tiny change to an unprotected document. No task
  packet, no model review. Deterministic checks are the whole gate.
- **FULL lane** — everything else. Requires a task packet and an independent
  review bound to this exact change.
- **HIGH-RISK** — auth, secrets, payments, migrations, permissions, crypto,
  CI workflows, or the control system itself. Adds an adversarial review.

## What "done" means here

Not "the code looks right" and not "a model approved it". A change is gated by:

```bash
node builder-control/engineering-os.cjs --gate-done --subject-sha <sha> [--packet <p>]
```

It fails closed. Missing review evidence blocks. A review bound to a different
version of the change blocks. An unavailable reviewer blocks and is reported as
UNAVAILABLE — never quietly upgraded to a pass.

The best state this gate can report is `READY_FOR_PR`. That means the process
ran, not that the software is correct. Runtime and deployment are separate and
are never implied.

## Non-negotiables

1. Never weaken a test, delete a failing one, or suppress an error to get green.
2. Never replace working logic with mock, placeholder, or hardcoded data.
3. Never change an API contract, database schema, or auth behaviour silently.
4. Never remove functionality that was not explicitly in scope.
5. Never edit a specification so that accidental behaviour looks compliant.
6. Anything you did not actually run is **UNVERIFIED**, never PASS. Anything not
   installed is **UNAVAILABLE**, named exactly.
7. Distinguish observed fact from inference from assumption. Do not present the
   second or third as the first.
8. The builder does not approve its own work.

## Escalate instead of guessing

Stop and ask when product intent is genuinely ambiguous, when architecture must
materially change, when a destructive action needs authorization, or when three
correction cycles have not resolved an issue. Three is a hard stop — reviewers
will optimise against each other indefinitely if allowed to.
