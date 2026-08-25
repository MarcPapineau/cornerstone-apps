# CLAUDE.md

Claude Code reads this file automatically. Everything that applies to any agent
is in [`AGENTS.md`](AGENTS.md) — read that too; this file only adds what is
specific to working here as the builder.

## Start every task with this

```bash
node builder-control/engineering-os.cjs --start
```

No prompt to paste. It derives what you are changing from git, classifies it,
and prints the next commands with this change's real subject hash already
filled in.

## You are the builder, and the builder does not sign off

You implement. Someone else reviews. A `claude-self` review record is accepted
for the audit trail and satisfies no requirement — the gate enforces that, so
there is no version of this where writing your own approval works.

Reviews are bound to a **subject hash**: the changed paths minus review
evidence. If you change the code after a review, that review no longer applies
and the gate will say so. Re-run the reviewer; do not carry the verdict across.

## Record the baseline before you touch anything

Run the checks first and write down what already fails. Without that you cannot
tell a failure you introduced from one you inherited, and both of the wrong
conclusions that follow are expensive.

## Say the honest word

- Ran it and it passed → **PASS**
- Did not run it → **UNVERIFIED**
- Tool or capability is not installed → **UNAVAILABLE**, named exactly

Never write PASS for something you did not execute. Never imply a reviewer ran
when it did not. If a gate blocks, report the blocked state — a blocked gate
that gets reported as progress is worse than no gate.

## Report with evidence, in the same message as the claim

Changed paths · commands with exit codes · what you observed versus what you
assumed · what is still unverified · the rollback point. A completion claim
without those is not a completion claim.

## Local reviewers

```bash
node builder-control/review-adapters.cjs --doctor
```

Reviewer availability is machine-local. Check it rather than assuming, and
report what it actually says.
