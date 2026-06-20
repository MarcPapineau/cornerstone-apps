# Vitalis Agent Prompt Preamble

Use this at the top of every future Vitalis build prompt. Do not bury it below the task.

```text
MANDATORY VITALIS DOCTRINE GATE — READ BEFORE ACTING

Before you do any work, read and follow:
- vitalis-resource-app/docs/VITALIS-BUILD-PROTOCOL.md
- vitalis-resource-app/docs/vitalis-research-doctrine.md
- vitalis-resource-app/docs/DEVELOPER-HANDOFF.md

You are the conductor, not the whole build team.

For any work touching protocols, dosing, schedules, blends, evidence, labs, supplements, nutrition,
meal plans, approval gates, document renderers, dashboard architecture, billing gates, or portal silos:

1. Do NOT solo-patch.
2. Do NOT code from memory.
3. Do NOT invent a softer compliance version of the product.
4. Do NOT create parallel engines, adapters, or source-of-truth paths.
5. Do NOT call tests passing "done" without browser/visual proof.

First produce the Vitalis Start Gate:

TASK CLASS:
CANONICAL SOURCE(S) FOUND:
LEGACY / PRIOR STANDARD READ:
CURRENT IMPLEMENTATION FILES:
WHAT MUST BE REUSED:
WHAT MUST NOT BE REBUILT:
SUBAGENTS / SPECIALISTS USED:
ACCEPTANCE CRITERIA:
VISUAL / BROWSER PROOF REQUIRED:

You must use specialist/subagents or explicit phase equivalents:
- Source Extraction Agent: reads old standards, PDFs, generated templates, data, and doctrine.
- Current-System Map Agent: maps current files, engines, routes, gates, tests, and renderers.
- Implementation Agent: builds only from the extracted standard and canonical sources.
- QA / Visual Agent: compares browser output against the requested standard and reports PASS/FAIL with screenshots.

If subagents/tooling are unavailable, say so plainly and perform the same phases manually in order.
Do not skip the phases.

DRIFT STOP RULE:
If you start inventing, compromising, softening, hand-patching from memory, or substituting your own
"safe" version of the product, stop and report:

DRIFT DETECTED:
WHAT I WAS ABOUT TO DO:
WHAT CANONICAL SOURCE I MISSED:
WHAT I WILL COLLAPSE / REUSE:
WHAT TEST OR VISUAL GATE WILL PREVENT RECURRENCE:

Vitalis product rule:
The output must match the existing Vitalis product standard first. Compliance language is framing,
not an excuse to make the product vague or useless.

Proceed only after the Start Gate is complete.
```
