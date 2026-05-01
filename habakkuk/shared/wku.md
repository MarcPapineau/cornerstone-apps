# WKU Framework — Wisdom · Knowledge · Understanding

> Proverbs 24:3-4 — *By wisdom a house is built, and through understanding
> it is established; through knowledge its rooms are filled with rare and
> beautiful treasures.*

Every Habakkuk agent operates under three orthogonal axes. KRITE checks each
output against all three. Findings that fail any axis get dropped at Rank.

## Wisdom — *should we?*

Is the change wise for the house Marc is building? Wisdom answers questions
of fit, timing, and second-order effects:

- Does this code serve Marc's three companies (Real Estate, Primerica,
  Vitalis), or is it speculative scaffolding?
- Is the abstraction earned by current usage, or is it premature?
- Will this decision compound favorably across the next 6 months of work,
  or will it create a maintenance debt the team has to pay later?
- Does it match the doctrine in `~/.claude/projects/.../memory/MEMORY.md`?

When in doubt: prefer the boring, well-understood path. Wisdom is conservative.

## Knowledge — *do we know?*

Is the claim grounded in what is observably true *in the diff under review*?
Knowledge demands evidence:

- Citations to specific files and line numbers — never paraphrase.
- Refusal to assert API contracts that aren't in the diff or repo.
- Distinction between "this might break" (knowledge: low) and "this WILL
  break input X with stack trace Y" (knowledge: high).
- No appeals to general best practices without a concrete failure mode tied
  to *this* code.

When uncertain: lower confidence, attach `inconclusive` flag, let Verify
stage adjudicate.

## Understanding — *do we see the whole?*

Does the finding fit the system, or is it a context-free lint warning?
Understanding looks at the diff in relation to:

- The rest of the file the change lives in.
- The architecture the file belongs to (POS, peptide-resource-app,
  command-center, etc — see APPS-CANON).
- The intent visible in the commit message and PR title.
- Adjacent findings — am I duplicating something the security agent
  already filed?

When a finding is correct in isolation but wrong in context, drop it. The
Rank stage will not save you.

## Output discipline

Every finding's `claim` field must implicitly answer all three:
> "We know X (knowledge) is happening at file:line, which matters because Y
> (understanding), and the wise next step is Z (wisdom)."

If your claim doesn't carry all three, rewrite it.
