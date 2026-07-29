# Vitalis Build Protocol

This file exists because the platform has already suffered doctrine drift: agents patched
important systems from memory, built parallel logic, and made outputs safer-sounding but less useful.
That is not acceptable for My Vitalis Health.

Vitalis is a vertical research-document operating system. The job is to preserve the existing
protocol standard, reuse the canonical engines, and build new silos from that foundation.

---

## 1. No Solo Patching On Core Systems

If work touches any of the following, the agent must not jump straight into implementation:

- protocol documents
- dosing / schedules / blends
- evidence tiers or source doctrine
- lab interpretation
- supplement logic
- nutrition / meal plan logic
- approval gates or client projections
- provider/client/admin silo organization
- billing or entitlement gates
- design system / document identity

Core-system work requires a discovery-and-routing gate first.

---

## 2. Mandatory Start Gate

Before editing code for a Vitalis core-system task, produce this mini-brief:

```text
TASK CLASS:
CANONICAL SOURCE(S) FOUND:
LEGACY / PRIOR STANDARD READ:
CURRENT IMPLEMENTATION FILES:
WHAT MUST BE REUSED:
WHAT MUST NOT BE REBUILT:
SUBAGENTS / SPECIALISTS USED:
ACCEPTANCE CRITERIA:
VISUAL / BROWSER PROOF REQUIRED:
```

If any field is unknown, stop and discover it before coding.

---

## 3. Required Agent Routing

For non-trivial Vitalis work, the main agent is the conductor, not the whole orchestra.

Use separate read-only specialists where they reduce drift:

1. **Source Extraction Agent**
   - Reads old PDFs, old generated HTML, existing engine/data files, and project docs.
   - Produces the true standard.
   - Does not edit code.

2. **Current-System Map Agent**
   - Maps current components, adapters, server endpoints, gates, and tests.
   - Identifies whether the requested behavior already exists.
   - Does not edit code.

3. **Implementation Agent**
   - Edits only after the extraction and map exist.
   - Reuses canonical engines.
   - Does not create parallel authorities.

4. **QA / Visual Agent**
   - Browser-verifies the actual app.
   - Compares against the old standard where applicable.
   - Screenshots are evidence; passing tests alone is not enough.

If the agent cannot use subagents/tooling, it must explicitly say so and manually perform the same
phases in order. It may not skip the phases.

---

## 4. Drift Triggers

The agent must stop and report `DRIFT DETECTED` if any of these happen:

- It starts inventing a new system where a canonical engine exists.
- It writes from memory instead of reading source.
- It replaces exact protocol content with broad ranges or vague compliance language.
- It passes tests but the screenshot does not match the requested product standard.
- It patches the same class of issue more than twice.
- It discovers another file/session is building the same layer.
- It cannot identify which source owns the behavior.

When drift is detected, do not keep patching. Produce a short drift memo:

```text
DRIFT DETECTED:
WHAT I WAS ABOUT TO DO:
WHAT CANONICAL SOURCE I MISSED:
WHAT I WILL COLLAPSE / REUSE:
WHAT TEST OR VISUAL GATE WILL PREVENT RECURRENCE:
```

---

## 5. Protocol Document Rule

For peptide protocols, the old Vitalis protocol output is the standard.

The agent must read both:

- the PDF reference, such as `02-Eric-Fat-Loss-Optimization-Protocol.pdf`
- the generated source/template behind the PDF, such as the old `02-eric-protocol-guide.html`

The PDF is visual evidence. The generated source is the structural standard.

Section 02 is a protocol schedule, not a compliance reference sheet. It must show exact selected dose,
frequency, timing, onboarding/titration, maintenance, offboarding/reassess, cycle/review, and monitoring.

Ranges belong in the compound-reference/source-context section. They do not replace the selected
protocol schedule.

Compliance language is one framing block. It must never make the protocol useless.

---

## 6. Dosing Ownership

The canonical dosing/schedule engine is the only dosing authority:

- `BLEND_SCHEDULES`
- `selectedScheduleFor`
- `blendScheduleFor`

Adapters and renderers may reshape for display only. They must not infer, synthesize, soften,
overwrite, or complete dosing.

Blend rule: a blend is not `NEEDS_SOURCE` merely because it has multiple compounds. Use the curated
blend schedule if it exists. If it does not exist, report the canonical gap and stop.

---

## 7. Source Doctrine Rule

Peer-reviewed journal literature and DOI/publisher sources are the evidence backbone.

WHO and NIH/NIH-ODS are excluded from the app-facing evidence registry. FDA, Health Canada,
ClinicalTrials.gov, USADA, DoD, and similar government/regulatory sources may be used only as
index/compliance/cross-check context, not efficacy authority.

Expert/practitioner sources such as Huberman Lab, FoundMyFitness, Examine, BioLayne, RP Strength,
and independent labs may be used for discovery, citation mining, and clearly labeled commentary.
Final evidence strength still depends on primary literature or labeled practitioner/community reference.

---

## 8. Visual Acceptance Gate

For any dashboard or document change:

- tests passing is required but insufficient
- build passing is required but insufficient
- browser screenshots are required
- when rebuilding a known standard, include side-by-side comparison against the old standard

If the screenshot does not look like the requested product, the task is not done.

---

## 9. Done Definition

A Vitalis core-system task is done only when:

- canonical sources were identified
- no parallel authority was introduced
- server gates still enforce draft invisibility
- role projections still drop unauthorized fields
- acceptance tests pass
- build passes
- browser screenshots prove the workflow
- any remaining gap is honestly labeled and listed

Never call a task complete because the code compiles.
