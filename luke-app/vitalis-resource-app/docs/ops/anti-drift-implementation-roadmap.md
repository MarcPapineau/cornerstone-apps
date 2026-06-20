# Vitalis Anti-Drift Implementation Roadmap

Part of the Vitalis anti-drift research sprint · Research lead: Daniel · 2026-06-03 · Research-only — no product code changed.

---

## How to read this document

This is a **phased build plan** for closing the seven documented AI-agent failure modes (F1–F7) that My Vitalis Health has already suffered. It is written to be handed to a developer.

The seven failures, in plain English:

- **F1** — agent ignored the existing protocol/product standard and built something off-pattern.
- **F2** — agent solo-patched a core system instead of routing to read-only specialist phases first.
- **F3** — agent built a *parallel dosing system* instead of reusing the one canonical engine.
- **F4** — agent softened exact protocol content into vague compliance language.
- **F5** — agent claimed DONE on green tests while the visual/product standard still failed.
- **F6** — agent coded/claimed *from memory* instead of reading canonical sources.
- **F7** — agent inconsistently used the right subagents/tooling.

**Three guiding biases** (from Daniel's research verdict):

1. **Reuse > rebuild.** Vitalis already owns 3 of the 4 enforcement primitives the literature prescribes (`check-catalog-guard.cjs` prebuild gate, RD1–RD4 doctrine tests, and the server-authoritative `DRAFT → APPROVED_RESOURCE` gate). This sprint is **extension, not greenfield**.
2. **JS-native only.** The stack is Node/JS + React + Vite + Tailwind + Express + `@vitalis/protocol-core`. Anything Python-only or hosted-SaaS-only is treated as a stack mismatch and pushed to AVOID unless it earns its place.
3. **Close the one real gap first.** There is **no Vitalis visual harness** (verified on disk: `@playwright/test` *is* installed at the outer `luke-app` root with a root `playwright.config.js`, but that config targets a *separate* app at `:3000`, not Vitalis; the Vitalis subproject has no config/baselines of its own), so the doctrine's §8 Visual Acceptance Gate is currently *manual* — the exact surface where "tests pass = done" (F5) recurs.

**Maturity / fit labels** are carried verbatim from Daniel's consolidated KB. `vendor claim` = marketing source. `UNKNOWN` = not verified in live docs. Every tool carries a source link.

**Sequencing principle:** low-complexity, high-impact, JS-native, reuse-first items come first (Phases 1–4). Heavier or "later" items (durable execution, runtime observability, productized governance) come last (Phases 6–7). Anything that is overkill for current scale is marked **[OVERKILL — defer]**.

---

## Phase 0 — What already exists (do not rebuild)

This phase is **read-only**. Before any build, the developer must understand what Vitalis already enforces so they *extend* it rather than duplicate it (duplication is itself F3-class drift).

### Verified existing assets (confirmed against the live codebase)

| Existing asset (path) | What it already enforces | Failure already (partly) covered | How to EXTEND — not replace |
|---|---|---|---|
| **Canonical dosing engine** — `BLEND_SCHEDULES`, `selectedScheduleFor`, `blendScheduleFor` in `packages/protocol-core/data/dosing.js`; consumed by `packages/protocol-core/generator.js` + `document-model.js` | Single dosing authority; verified *consumed, not duplicated* | F3 | Add invocation-count logging (procedure-aware) + a `trajectory:tool-used` assertion that proves the engine was actually called |
| **`packages/protocol-core/research-doctrine.js`** (single-source research doctrine: `EXCLUDED_IDS`, `isEvidenceAuthority=false`, `appFacingRegistry`) gated by **RD1–RD4** in the acceptance suite | Read-then-cite discipline; HIGH-tier claims need explicit confidence/citation | F6, F1 | Use as the "context" payload in a grounding gate (Phase 6); keep RD1–RD4 as hard stops |
| **`scripts/check-catalog-guard.cjs`** — wired as the npm **`prebuild`** hook (confirmed in `package.json`) | Forbidden-string / catalog assertions at build time | F1, F3 | Swap ad-hoc string checks for declared JSON-Schema validation (Ajv standalone); add a grep gate: "no dosing schedule defined outside `protocol-core`" |
| **Approval gate `DRAFT → APPROVED_RESOURCE`** — `gates.clientProtocolProjection`, `CLIENT_VISIBLE_STATUS='APPROVED_RESOURCE'`, server-side whitelist in `packages/protocol-core/gates.js`; acceptance test N3 | Server-authoritative softening **only** at the client boundary; execution-hallucination catcher | F4, F5 | Make it the *resume authority* for a future durable approval pause; optionally require a human-signed token |
| **Plain-node acceptance suite** — `node test/acceptance.js` (verified: 142 KB file, run via `npm test`); honest range/UNKNOWN asserts (e.g. reta `/2–4 mg/`, adipotide UNKNOWN) | Output correctness | F3, F4, F6 | Add tool-use assertions, multi-run (`pass^k`), invocation-count asserts; wire as a **blocking** CI gate on agent PRs |
| **Doctrine docs** — `docs/VITALIS-BUILD-PROTOCOL.md` (Start Gate §2, Agent Routing §3, Visual Gate §8), `docs/VITALIS-AGENT-PROMPT-PREAMBLE.md`, `docs/DEVELOPER-HANDOFF.md` | The human-readable rules | F1, F2, F5, F7 | Mirror into a machine-loaded `AGENTS.md`/`CLAUDE.md`; turn the Start Gate into a validated structured artifact |
| **Telegram bot** (`@NehemiahMarcBot` → chat `8617287533`) | Operator notification channel | F5, F7 | Wire as the dead-letter-queue (DLQ) retry-exhaustion escalation target |
| **Claude Agent SDK** (current runtime) | The agent loop | F1, F2, F3, F6, F7 | Use `allowedTools` read-only scoping + 4-element subagent specs; do **not** rely on subagent hooks (see Phase 5 gotcha) |

**Verified gap:** there is **no Vitalis visual harness** — the `@playwright/test` dependency exists at the outer `luke-app` root but is unwired for Vitalis (its config targets a separate app); Vitalis itself has only the plain-node acceptance suite + the `prebuild` guard. The Vitalis visual harness is the single highest-leverage net-new capability and is the focus of **Phase 4**.

> Hard rule for the developer: if a task touches dosing, schedules, blends, evidence tiers, lab interpretation, supplement/nutrition logic, approval gates, silo organization, billing gates, or the design system, you are in "no solo patching" territory (`VITALIS-BUILD-PROTOCOL.md` §1). Do Phase 0 discovery first, every time.

---

## Phase 1 — Prompt + doctrine enforcement

**What gets built**

1. A root **`AGENTS.md`** (and/or `CLAUDE.md`) "standing orders" file, machine-loaded at session start, that declares the non-negotiables:
   - `blendScheduleFor` / `selectedScheduleFor` are the **only** dosing authorities; `research-doctrine.js` is read-only.
   - The `DRAFT → APPROVED_RESOURCE` approval gate is **server-enforced**; softening happens *only* in the client projection.
   - A forbidden-string list mirroring `check-catalog-guard.cjs`.
   - The four-phase pipeline (Source-Extraction → Current-System-Map → Implementation → QA/Visual) is mandatory and ordered.
   - **Vitalis rules supersede general medical knowledge** (explicit conflict hierarchy).
   - **Rule: update this file after every observed F1/F3/F4/F6.**
2. **Claude Agent SDK read-only tool scoping** — register analysis subagents with `allowedTools` limited to Read + Glob + Grep so a "Source-Extraction" or "Current-System-Map" specialist *structurally cannot* write to `dosing.js` / `research-doctrine.js` / the approval whitelist. Attach the 4-element subagent spec (objective / output format / tools+sources / boundaries) to each.
3. **Anthropic Structured Outputs** (`output_config.format`) on the generation call so the agent's output is grammar-constrained to a schema at generation time (pairs with Phase 2's Zod schema).

**Why it matters (ties to F1–F7)**

- **F1 / F6:** standing-orders + structured output force the agent to anchor to the canonical standard and emit schema-valid output instead of free-form text from memory.
- **F2 / F7:** read-only `allowedTools` scoping makes the "conductor, not the whole orchestra" rule a *permission-layer fact*, not a prompt suggestion — specialists can't implement.
- **F3:** the standing-orders file names the single dosing authority up front and is re-read JIT each session (context-rot mitigation), so the agent doesn't "remember" a parallel path.

**Complexity:** **low.** `AGENTS.md` is plain Markdown; `allowedTools` and `output_config` are config on calls Vitalis already makes (it is Claude-native).

**Expected impact:** **high, immediate.** This is the cheapest layer and reduces the *frequency* of all drift classes before any heavier gate runs. It does not, by itself, *catch* drift — that is what Phases 2–5 add (prompts are suggestions; framework hooks are enforcement).

**Tools recommended (with sources)**

- **`AGENTS.md` open standard** — a widely-adopted open standard since Aug 2025, stewarded by the Agentic AI Foundation (Linux Foundation); supported by Claude Code in practice (note: the agents.md compatible-agents list does not explicitly enumerate every tool). [agents.md](https://agents.md/) · context: [InfoQ, 2025-08](https://www.infoq.com/news/2025/08/agents-md/). Maturity: **established**.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — `allowedTools` scoping + named subagents; v0.3.162 (Jun 3 2026). [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview). Maturity: **production**. Fit **HIGH** → F1/F2/F3/F6/F7. **GOTCHA:** hooks reportedly do **not** fire for subagent tool calls (issue #34692) — enforce read-only at the tool-access-list level, not via PreToolUse hooks. (UNKNOWN: the live SDK page did not restate this limitation — verify current behavior before designing around hooks.)
- **Anthropic Structured Outputs** (`output_config.format`) — grammar-constrained JSON-schema enforcement; **GA on Opus 4.8** (verified), no extra deps. [platform.claude.com/docs/.../structured-outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Maturity: **production**. Fit **HIGH** → F1/F6.
- **Doctrine anchors (already in repo, no install):** standing-orders pattern — [Anthropic context engineering, 2025-09-29](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents); read-only-by-default tool scoping — [Anthropic safe agents framework, 2025-08-04](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents); domain-guideline-over-pretraining grounding — [GuideBench, arXiv 2505.11368](https://arxiv.org/abs/2505.11368) (**preprint** — directional).

**Success criteria (concrete / testable)**

- A root `AGENTS.md` exists, names the two dosing authorities + forbidden-string list, and is referenced by the agent at session start.
- At least one analysis subagent is registered with `allowedTools` excluding Write/Edit; attempting a write from that subagent is denied.
- The generation call sets `output_config.format` to a schema; a deliberately malformed object is rejected before render.
- After any observed drift event, the `AGENTS.md` is updated in the same PR (enforced by review checklist).

---

## Phase 2 — Source-of-truth registry + required preflight

**What gets built**

1. **One canonical schema** (Zod v4) that expresses the shape of `BLEND_SCHEDULES` *and* the approval whitelist. `z.infer` gives the TS type; `safeParse()` rejects any off-schema object. Export it to JSON Schema via `z.toJSONSchema()` (verified: targets Draft 2020-12 / draft-07 / draft-04).
2. **Ajv standalone validation inside `check-catalog-guard.cjs`** — compile the JSON Schema to a pure-JS function shippable inside the existing CommonJS prebuild gate, upgrading it from ad-hoc string checks to declared-schema validation. Add a **grep-based forbidden-pattern gate**: fail the build if any file *outside* `packages/protocol-core` defines a dosing schedule constant.
3. **A machine-checkable Start Gate artifact** — turn `VITALIS-BUILD-PROTOCOL.md` §2 (the `TASK CLASS / CANONICAL SOURCE(S) FOUND / LEGACY-PRIOR STANDARD READ / CURRENT IMPL FILES / WHAT MUST BE REUSED / WHAT MUST NOT BE REBUILT / …` brief) into a structured (Zod-validated) artifact whose required fields must be non-empty or explicitly `UNKNOWN`-flagged. **Work is blocked while any field is UNKNOWN.**
4. **Knip** as a CI step to surface orphaned **parallel dosing files** an agent created that nothing imports.
5. **Changesets** gate on `protocol-core`: every change requires a human-written changeset declaring semver + rationale — an anti-solo-patch (F2) paper trail.
6. **Spectral** ruleset to domain-lint the catalog JSON + agent output artifacts ("every compound has `evidence_tier`", "no CJC + Tesa together").

**Why it matters (ties to F1–F7)**

- **F3 / F4 / F6:** the schema makes "agent invented its own structure" or "agent dropped a required field (softening)" a **hard build failure**, not a review catch. Knip catches the parallel file even if it produces correct output.
- **F1 / F2:** Changesets blocks an agent silently bumping `protocol-core` with no declared reason; the validated Start Gate forces the agent to *name the canonical source it read* before editing.
- **F1 / F4:** Spectral enforces domain invariants on the catalog the same way `check-catalog-guard.cjs` enforces forbidden strings.

**Complexity:** **low–medium.** Zod, Ajv, Knip, Changesets are single-purpose npm installs. The Start-Gate-as-artifact is small. Spectral needs a ruleset authored (medium).

**Expected impact:** **high.** This is where structural source-of-truth drift (F1/F3/F6 — the dominant theme) becomes machine-checkable with **no architecture change**. Both Zod and Ajv ship CommonJS, so they fit the `.cjs` server/prebuild gate.

**Tools recommended (with sources)**

- **Zod v4** — single source of truth for TS types + runtime validation; `z.toJSONSchema()` confirmed (Draft 2020-12 / draft-07 / draft-04). [github.com/colinhacks/zod](https://github.com/colinhacks/zod) (v4.4.3, May 2026) · [zod.dev/json-schema](https://zod.dev/json-schema). Maturity: **production**. Fit **HIGH** → F3/F4/F6. ESM **+ CJS**.
- **Ajv (standalone mode)** — fastest JSON-Schema validator; CommonJS `require()` confirmed; compiles schemas to pure-JS functions shippable in the prebuild gate. [github.com/ajv-validator/ajv](https://github.com/ajv-validator/ajv) (v8.20.0, Apr 2026). Maturity: **production**. Fit **HIGH** → F1/F3.
- **Knip** — finds unused files/exports/deps; ts-prune successor (ts-prune archived 2025, recommends Knip); Vite/Vitest plugins. [knip.dev](https://knip.dev/) · [github.com/webpro-nl/knip](https://github.com/webpro-nl/knip). Maturity: **production**. Fit **HIGH** → F3.
- **Changesets** — human-written changeset per `protocol-core` change; blocks silent agent bumps. [github.com/changesets/changesets](https://github.com/changesets/changesets) (May 2026). Maturity: **production**. Fit **HIGH** → F1/F2. (Vitalis already has a `packages/protocol-core` monorepo.)
- **Spectral** — lints any JSON/YAML against a custom ruleset in CI; Node CLI + library. [github.com/stoplightio/spectral](https://github.com/stoplightio/spectral) (v6.15, Apr 2025). Maturity: **production**. Fit **HIGH** → F1/F4. Pairs with Ajv.
- **Doctrine anchors:** spec-as-executable-truth — [Spec-Driven Development, 2026-02-04](https://medium.com/@nprasads/spec-driven-development-in-the-age-of-ai-from-specs-as-documents-to-specs-as-executable-truth-9b9e066712b1) (**emerging**); living spec with protected-decision markers — [Augment Code living specs, 2026-03-20](https://www.augmentcode.com/guides/living-specs-for-ai-agent-development) (**emerging**) → optionally add `DECISIONS.json` / `locked:true` markers to `BLEND_SCHEDULES` params.

**Success criteria (concrete / testable)**

- A Zod schema for `BLEND_SCHEDULES` + approval whitelist exists; `z.toJSONSchema()` emits a JSON Schema consumed by Ajv standalone inside `check-catalog-guard.cjs`.
- The prebuild gate **fails** when (a) a dosing schedule constant is defined outside `protocol-core`, or (b) a `BLEND_SCHEDULES` object is missing a required field.
- A Start-Gate artifact with any `UNKNOWN` field blocks the build/PR.
- `npx knip` reports zero orphaned files in `protocol-core` on a clean tree; a planted unimported `dosing-v2.js` is flagged.
- A `protocol-core` PR with no changeset is blocked.
- Spectral fails on a catalog entry missing `evidence_tier`.

---

## Phase 3 — Automated evals / test expansion

**What gets built**

1. **promptfoo** wired into the existing `node test/acceptance.js` pattern, using:
   - **`trajectory:tool-used`** (and, where the path matters, `trajectory:tool-sequence` / `trajectory:tool-args-match`) to **assert the agent called the canonical dosing engine, not a parallel one**.
   - **agent-rubric / llm-rubric** graders to catch softened compliance language (F4) in generated sections.
2. **Procedure-aware invocation-count assertions** — instrument `selectedScheduleFor` / `blendScheduleFor` to log invocation counts per generation job, and assert `invocation_count > 0` for every generation. This catches F3 **even when a parallel path accidentally produces the correct answer** ("corrupt success").
3. **`pass^k` multi-run reliability** — run any suite test touching dosing/compound/protocol text **5+ times**, require a consistent pass, and track variance. A single stochastic green is not evidence of reliable canonical-standard adherence.
4. **Section-02 degradation tests** — FAIL if Section 02 collapses into prose-only dosing, substitutes broad ranges for the selected schedule, or replaces specifics with generic compliance text. Preserve the **one** legitimate softening boundary (the `APPROVED_RESOURCE` client projection — acceptance test N3 already encodes operator-full / client-softened).
5. Wire the whole suite as a **blocking CI gate on agent PRs**.

**Why it matters (ties to F1–F7)**

- **F3 / F1:** `trajectory:tool-used` + invocation-count is the closest off-the-shelf match to Vitalis's worst failure — it *mechanically proves* the canonical engine ran.
- **F4:** rubric graders + Section-02 degradation tests catch "safer-sounding but less useful" softening that string checks miss.
- **F5 / F1:** `pass^k` kills "it passed once = done"; peer-reviewed evidence (tau-bench) shows even strong models fall well below 25% on multi-trial rule-following.

**Complexity:** **low–medium.** promptfoo is MIT, JS-native, runs via `npx`, slots into the existing suite. Invocation logging and `pass^k` are small test-harness changes.

**Expected impact:** **high.** This is the layer that converts "the engine should be used" into "the engine *was* used, provably, 5/5 times." Together with Phase 2 it closes the F3 source-of-truth theme.

**Tools recommended (with sources)**

- **promptfoo** — declarative YAML/JS eval + CI gate; `trajectory:tool-used` / tool-sequence + agent-rubric graders; `--fail-on-error` exits non-zero. MIT; OpenAI-acquired (March 2026) but still OSS; used by OpenAI + Anthropic. [github.com/promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) (v0.121.14, Jun 2 2026) · trajectory/model-graded docs: [promptfoo.dev/docs/.../model-graded](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/). Maturity: **production**. Fit **HIGH** → F1/F3/F4/F5. **Verification note:** the live repo shows **MIT, v0.121.14, "Used by OpenAI and Anthropic", ~21.8k GitHub stars** (confirmed). The KB's "350k+ developers" is a community/marketing figure **not reproducible from the repo** (repo shows ~21.8k stars) — treat the star/usage scale as directional, not load-bearing; the *capability* (`trajectory:tool-used`) is what matters and is documented.
- **Doctrine anchors:** procedure-aware "corrupt success" detection — [Cao et al., arXiv 2603.03116](https://arxiv.org/abs/2603.03116) (**preprint**; study: 27–78% of benchmark successes violate procedure); `pass^k` multi-trial reliability — [tau-bench, Yao et al., arXiv 2406.12045](https://arxiv.org/abs/2406.12045) (**ICLR, peer-reviewed** — the strongest anchor here); evaluator-optimizer caution / use deterministic linters — [Anthropic, Building Effective Agents, 2024-12-19](https://www.anthropic.com/research/building-effective-agents); LLM-judge bias control (length/budget constraints) — [Soumik, arXiv 2604.23178](https://arxiv.org/abs/2604.23178) (**preprint**) + [Shi et al., arXiv 2406.07791](https://arxiv.org/abs/2406.07791) (**AACL-IJCNLP 2025, peer-reviewed**).

> Guardrail on the LLM graders: Vitalis's deterministic gates (the acceptance suite, `check-catalog-guard.cjs`, RD1–RD4) ARE the primary evaluator. Use LLM-as-judge **only** for non-verifiable voice/specificity, **cap at 2 rounds**, and give the judge explicit length/budget constraints so a style-biased judge doesn't rate verbose hedged text (the F4 failure) as higher quality. An LLM-evaluator stacked on top of already-passing deterministic tests is itself an F5 risk.

**Success criteria (concrete / testable)**

- A promptfoo config asserts `trajectory:tool-used` for the canonical dosing engine on at least one generation eval; it **fails** when a stubbed parallel path is substituted.
- `selectedScheduleFor` / `blendScheduleFor` log invocation counts; a generation with `invocation_count === 0` fails the suite.
- Dosing/compound tests run 5+ times in CI and require consistent pass; variance is reported.
- A Section-02 fixture degraded to prose-only / broad-range / generic-compliance **fails**; the `APPROVED_RESOURCE` client-projection softening still passes.
- The suite is a required (blocking) check on agent PRs.

---

## Phase 4 — Browser visual QA + screenshot diffs

> **This is the #1 net-new capability.** It requires **no new browser-automation dependency** — `@playwright/test` is already present at the `luke-app` root (its root config targets a separate app, so a Vitalis-targeted config + baselines are the actual new work) — and it directly closes the manual §8 Visual Acceptance Gate where "tests pass = done" (F5) recurs. **Do this early** (it is sequenced after Phases 1–3 only because those are even cheaper, but it is the highest-leverage *new* build).

**What gets built**

1. A **`playwright.config`** + a small visual-QA harness using **`toHaveScreenshot`** to pixel-diff rendered React pages (the protocol document surface) against committed baselines. On mismatch, Playwright uploads expected/actual/diff and the run exits non-zero, gating CI.
2. **Side-by-side baselines vs the established standard** — capture the LIVE peptide dossier / the Eric PDF reference as the "north star" baseline so that *rebuilding a known standard* is checked against it (per `VITALIS-BUILD-PROTOCOL.md` §5 + §8).
3. Tune `maxDiffPixels` / `maxDiffPixelRatio` / `threshold` and mask volatile regions with `stylePath` to control flakiness.
4. **(ADOPT-LATER, optional layer)** **Argos CI** to make visual pass/fail a first-class GitHub PR status check on top of the Playwright screenshots — no committed baselines to manage.

**Why it matters (ties to F1–F7)**

- **F5:** this is the direct fix. DONE stops meaning "green tests" and starts meaning "green tests **+** a browser-rendered screenshot that matches the standard." A "tests pass" signal alone is rejected.
- **F4 (supporting):** a rendered-document snapshot catches softened wording / missing compounds / changed dosing that a unit test might not surface visually.
- **F7:** the QA/Visual phase finally emits a structured PASS/FAIL + screenshots, completing the four-phase pipeline's last leg consistently instead of manually.

**Complexity:** **low.** Playwright is free, JS-native, and the single most standard React visual-diff tool. The only real work is authoring baselines and stabilizing flakiness.

**Expected impact:** **highest of any net-new item.** It converts the doctrine-mandated manual visual gate into an automated, CI-blocking one — the exact gap Daniel's research flags as #1.

**Tools recommended (with sources)**

- **Playwright `toHaveScreenshot`** — pixel-diffs rendered pages vs baselines; exit-1 gates CI; `maxDiffPixels` + `stylePath` masking confirmed on the [test-snapshots page](https://playwright.dev/docs/test-snapshots), and `maxDiffPixelRatio` (0–1) + `threshold` (default 0.2) confirmed on the [SnapshotAssertions API page](https://playwright.dev/docs/api/class-snapshotassertions). Maturity: **production**. Fit **HIGH** → F5. **OPEN UNKNOWN (carry Daniel's #10):** issue [#30112](https://github.com/microsoft/playwright/issues/30112) reports `maxDiffPixelRatio` / `maxDiffPixels` are not always honored in some configs — **confirm behavior against the installed Playwright version** when configuring the harness.
- **Argos CI** *(optional layer)* — hosted diff-review UI + GitHub PR status check on top of Playwright; no committed baselines; cheaper / more JS-native than Chromatic or Percy. [github.com/argos-ci/argos](https://github.com/argos-ci/argos). Maturity: **production**. Fit **HIGH (optional)** → F5.
- **Doctrine anchor:** golden-file / snapshot drift gates (a snapshot update = a human-reviewed drift event) — [Jest snapshot docs](https://jestjs.io/docs/snapshot-testing). Apply the *concept* (rendered-doc snapshot per indication × tier; updating a baseline requires explicit human approval) — implemented via Playwright, not Jest.

**[OVERKILL — defer]** BackstopJS, Chromatic, Percy, Applitools, Storybook Visual Tests, jest-image-snapshot. BackstopJS adds a **second** browser-automation stack (Consolidation Discipline warns against this when Playwright exists). Vitalis has **no Storybook** (Chromatic / Storybook-VT need it) and **no Jest** (`jest-image-snapshot` mismatches the plain-node suite). Sources: [BackstopJS](https://github.com/garris/BackstopJS), [Chromatic](https://www.chromatic.com/pricing) *(vendor claim)*, [Percy](https://www.browserstack.com/docs/percy/overview/plans-and-billing), [Applitools](https://applitools.com/platform/eyes/) *(vendor claim)*, [Storybook VT](https://storybook.js.org/docs/writing-tests/visual-testing), [jest-image-snapshot](https://github.com/americanexpress/jest-image-snapshot).

**Success criteria (concrete / testable)**

- A `playwright.config` exists; `npx playwright test` runs the visual suite and exits non-zero on a deliberately altered page.
- At least one baseline captures the protocol document surface; a side-by-side baseline exists for the known peptide-dossier standard.
- A document change that visually degrades Section 02 produces a diff artifact and fails CI.
- Completion of a document/dashboard task requires an attached screenshot + a structured PASS/FAIL (no "tests pass = done").

---

## Phase 5 — Agent workflow logging + recovery

**What gets built**

1. **Write-ahead intent log** — immediately *before* each canonical tool call, append a structured intent entry (e.g. "about to call `blendScheduleFor(client, indication, tier)`"); update it with the result after. The acceptance suite asserts the intent log contains a `blendScheduleFor()` entry on every generation run — if absent, the agent bypassed the engine. This distinguishes "intended" from "actually called."
2. **Structured trace logging** via lightweight middleware wrapping tool calls (tools called, order, returns, "canonical engine invoked?") — a deterministic rule check confirms correct delegation/sequencing (catches F7/F2).
3. **Retry-exhaustion DLQ + Telegram escalation** — on retry exhaustion, persist the failed generation (client / indication / tier) to a `failed_generations` table, alert via the existing `@NehemiahMarcBot`, and expose a reprocess endpoint. This kills silent failure where a client gets no protocol *and* no notification.
4. **Same-class-patch hard stop** — if the agent patches the same class of issue a 3rd time, hard-stop into the `DRIFT DETECTED` memo format (`VITALIS-BUILD-PROTOCOL.md` §4) instead of continuing.

**Why it matters (ties to F1–F7)**

- **F5 / F6 / F3:** the intent log is the forensic record that separates "the agent meant to use the engine" from "the engine actually ran" — directly attacking corrupt success and memory-over-source.
- **F2 / F7:** trace logging makes a skipped or mis-sequenced phase, or a solo-patch, *detectable* rather than silently tolerated.
- **F5 / F7:** the DLQ + Telegram escalation removes the silent-failure surface entirely.

**Complexity:** **low.** This is **plain Node + one new table + one Telegram call** — no new framework. Reuses the existing bot.

**Expected impact:** **medium–high.** High forensic value for catching the *procedural* failures (F2/F3/F5/F7) and a real operational win (no more silent dropped generations).

**Tools recommended (with sources)**

- *(No new product dependency — plain Node + existing Telegram bot.)*
- **Doctrine anchors:** write-ahead intent log — [LogAct, arXiv 2604.07988](https://arxiv.org/html/2604.07988v1) (**preprint, Meta** — directional); retry-exhaustion DLQ with human-review escalation — [LittleHorse retries/DLQ, 2024-12-13](https://littlehorse.io/blog/retries-and-dlq) (**established**); granular agent-trace inspection (planning/coordination are highest-impact failures) — [Patronus TRAIL, arXiv 2505.08638](https://arxiv.org/abs/2505.08638) (**preprint**); framework-level guardrails LLMs cannot bypass — [AWS/DEV neurosymbolic guardrails, 2025-03-10](https://dev.to/aws/ai-agent-guardrails-rules-that-llms-cannot-bypass-596d) (**emerging**).

**Success criteria (concrete / testable)**

- Every generation run produces an intent-log entry containing a `blendScheduleFor()` / `selectedScheduleFor()` call; a run missing it fails the suite.
- A simulated retry exhaustion writes a `failed_generations` row and fires a Telegram alert to `8617287533`; a reprocess endpoint re-runs it.
- A 3rd same-class patch attempt produces a `DRIFT DETECTED` memo and halts.

---

## Phase 6 — Observability / hallucination monitoring

> **ADOPT-LATER.** Real value, but only load-bearing once runtime drift detection and grounding scoring are actually needed. Do **not** start here.

**What gets built**

1. **OpenTelemetry GenAI spans** via **OpenLLMetry-js** (`@traceloop/...`) — emit one span per generation run recording *which dosing function was called*, so a rogue/parallel path can be alerted on at runtime (a runtime extension of the `check-catalog-guard.cjs` idea).
2. **Langfuse (self-hosted)** as the backend — OTel-compatible tracing **+ prompt versioning** so "which prompt did the agent use" becomes auditable, and the production-labelled prompt is the canonical one agents pull (not memory). Self-hosting keeps protocol data local.
3. **Patronus Lynx** as a **post-generation grounding gate** before `DRAFT → APPROVED_RESOURCE` — scores protocol text against `research-doctrine.js` content as context; binary pass/fail.

**Why it matters (ties to F1–F7)**

- **F3 / F7:** runtime spans that record the dosing function fired give continuous detection of parallel-path usage beyond CI.
- **F1 / F6:** prompt-version pinning (Langfuse) makes the canonical prompt the *pulled* prompt; Lynx scores whether the generated text is grounded in the doctrine before it can be approved.

**Complexity:** **medium.** OpenLLMetry-js is a low-friction install but has an **import-order gotcha** (the SDK must load before the LLM module). Langfuse self-host is a Docker service. Lynx is usage-based.

**Expected impact:** **medium (later).** Strong for *standing* observability and a grounding gate, but it does not close a failure that Phases 1–5 leave open — it deepens detection. Sequence it after the CI/visual gates are in place.

**Tools recommended (with sources)**

- **OpenTelemetry GenAI Semantic Conventions** — shared `gen_ai.*` attribute vocabulary so backends are swappable. [opentelemetry.io/blog/2026/genai-observability](https://opentelemetry.io/blog/2026/genai-observability/). Maturity: **emerging** (attrs still experimental). Fit **HIGH (standard, not a tool)** → F3/F6/F7.
- **OpenLLMetry-js / Traceloop** — drop-in OTel auto-instrumentation for Node LLM calls (Anthropic supported); `withWorkflow()` wraps canonical-engine calls; CJS + ESM. [github.com/traceloop/openllmetry-js](https://github.com/traceloop/openllmetry-js) (v0.27, May 2026). Maturity: **production**. Fit **HIGH (LATER)** → F3/F7. **GOTCHA:** SDK must load before the LLM module.
- **Langfuse** — OTel-compatible tracing + prompt versioning + LLM-as-judge; self-host via Docker. [github.com/langfuse/langfuse](https://github.com/langfuse/langfuse) (v3.178, Jun 2026; acquired by ClickHouse May 2026). Maturity: **production**. Fit **HIGH (LATER)** → F6/F1. Prefer over Agenta/PromptLayer to avoid duplication (PromptLayer JS SDK **UNKNOWN** — Python-primary).
- **Patronus Lynx** — 8B/70B RAG-hallucination model; binary pass/fail vs context; official TS SDK (v0.3.0) + REST; 8B open-weights for self-host. [docs.patronus.ai/.../Lynx/base](https://docs.patronus.ai/docs/research_and_differentiators/Lynx/base). Maturity: **production**. Fit **HIGH (LATER)** → F6/F1.
- **Pydantic Logfire (logfire-js)** *(alternative)* — OTel tracing with **SQL-queryable spans** ("did any agent call a dosing fn other than the canonical two this week?"). [github.com/pydantic/logfire-js](https://github.com/pydantic/logfire-js) (v0.15, May 2026). Maturity: **emerging (pre-1.0)**. Fit **MEDIUM** → F3/F6.
- **OpenLIT** *(alternative)* — one-line OTel-native instrumentation + built-in eval types. [github.com/openlit/openlit](https://github.com/openlit/openlit). Maturity: **production**. Fit **MEDIUM** → F1/F3/F4/F6. **UNKNOWN:** confirm CommonJS `require()` interop in the Vitalis `.cjs` server before committing.

**[OVERKILL — defer / wrong stack]** Galileo "Context Adherence" reliance — JS SDK is real (Apache-2.0, v2.2.0, May 2026) but the specific Context-Adherence metric is **UNVERIFIED** in live JS docs (only `correctness`/`output_tone` surfaced); do **not** build on it until confirmed. [github.com/rungalileo/galileo-js](https://github.com/rungalileo/galileo-js). Also defer: Datadog LLM Observability (cost-prohibitive greenfield), Arize Phoenix (Python sidecar server), Vectara HHEM / TruLens / Cleanlab / Ragas (Python-only or not-RAG). Honeycomb Agent Timeline is **Early Access** *(vendor claim)* — not a load-bearing dependency.

**Success criteria (concrete / testable)**

- Each generation emits an OTel span recording the dosing function name; a query can answer "did any run call a non-canonical dosing path this week?"
- The canonical prompt is pulled from the Langfuse production label, not hard-coded from memory.
- A protocol draft that is ungrounded vs `research-doctrine.js` is flagged by Lynx before it can reach `APPROVED_RESOURCE`.

---

## Phase 7 — Productized governance layer

> **ADOPT-LATER / partly [OVERKILL — defer].** Build the *server-side pre-action authorization* concept (it extends an enforcement point Vitalis already has). Treat durable-execution frameworks as **deferred until generation regularly exceeds ~5 minutes**.

**What gets built**

1. **Server-side pre-action authorization gateway** — extend the existing whitelist projection so any agent call to `blendScheduleFor` / `selectedScheduleFor` / a doc-write passes through **Express middleware the agent cannot modify**, validating against `research-doctrine.js` + the drift gate **before** executing; reject anything that would bypass the canonical engine. Optionally require a **human-signed token** to set `APPROVED_RESOURCE`. This is "prompts are suggestions — framework hooks are enforcement," implemented at infrastructure, not prompt.
2. **Durable approval pause (LangGraph.js `interrupt()` + Postgres checkpointer)** — freeze agent state and return proposed content to the Express endpoint so that **only the server resumes** (`thread_id` = document ID), making the existing `DRAFT → APPROVED_RESOURCE` gate a durable, resumable checkpoint.
3. **Single-task specialist chain + Reconciler** — decompose the Builder into Compound-Selector (read-only) → Schedule-Fetcher (read-only, canonical engine only) → Narrative-Writer (write, structured input) → Compliance-Checker (read-only, vs `research-doctrine.js`), with the approval gate acting as Reconciler. Inject the *serialized human-readable schedule object* into every prompt (not just the function name).
4. **(Defer)** durable multi-step execution (Inngest AgentKit / Temporal TS) **only if** generation regularly exceeds ~5 min.

**Why it matters (ties to F1–F7)**

- **F1 / F2 / F3 / F6:** the pre-action gateway is the strongest structural defense — it makes bypassing the canonical engine *impossible at runtime*, not just discouraged.
- **F1 / F2 / F4:** `interrupt()` makes the server the sole resume authority for approvals, hardening the existing gate.
- **F1 / F2 / F3 / F6 / F7:** the specialist chain + Reconciler enforces single-responsibility lanes and isolates each agent's context from prior (possibly drifted) trajectories.

**Complexity:** **medium–high.** The Express middleware gateway is medium (it extends existing code). LangGraph.js and the specialist-chain refactor are higher-effort architecture changes. Durable-execution frameworks are high and premature.

**Expected impact:** **high ceiling, but later.** This is the "make drift structurally impossible" layer. It is correctly *last* because Phases 1–5 already make drift *detectable and blocked* at much lower cost; this phase raises the floor from "caught" to "can't happen."

**Tools recommended (with sources)**

- **LangGraph.js** (`@langchain/langgraph`) — graph topology + `interrupt()` + Postgres checkpointer for a durable, server-resumed approval gate. [github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) (v1.x, Jun 2026) · pattern: [LangChain interrupt blog, 2024-12-14](https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt). Maturity: **production**. Fit **HIGH (LATER)** → F1/F2/F4. **GOTCHA / OPEN UNKNOWN:** JS lags Python; HITL-resume-with-checkpoint had an open issue (#1308) — **reproduce on the target version** before committing.
- **Doctrine anchors:** server-side pre-action authorization gateway — [arXiv 2603.20953](https://arxiv.org/pdf/2603.20953) (2026-03-24, **preprint, not peer-reviewed**); single-task specialist chain + Reconciler / Enhanced Data Registry — [Freeman et al., arXiv 2603.10047](https://arxiv.org/abs/2603.10047) (**preprint**); inherited goal-drift defense (isolate each agent's context) — [Menon et al., arXiv 2603.03258](https://arxiv.org/abs/2603.03258) (**preprint**); orchestrator-workers + canonical-source injection — [Anthropic multi-agent research system, 2025-06-13](https://www.anthropic.com/engineering/multi-agent-research-system) (**established**); trust-skepticism (treat subagent output as tool output) — [Anthropic, how-we-contain-Claude, 2026-05-25](https://www.anthropic.com/engineering/how-we-contain-claude) (**established**).

**[OVERKILL — defer]** Durable-execution frameworks until generation routinely exceeds ~5 min: **Inngest AgentKit** [github.com/inngest/agent-kit](https://github.com/inngest/agent-kit) (v0.13.2, **emerging**; verify npm version vs marketing) gives ~80% of the value at ~20% setup and is the first choice if needed; **Temporal TS** [temporal.io/blog/replay-2026-product-announcements](https://temporal.io/blog/replay-2026-product-announcements) *(vendor claim; TS SDK mentioned only peripherally)* is high-complexity overkill for current scale. Also defer: **mem0** [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0) as a *soft* session-start grounding layer only — never as authority (re-introduces memory-as-truth if treated as one); **OpenAI Agents SDK JS** [github.com/openai/openai-agents-js](https://github.com/openai/openai-agents-js) (OpenAI-model-tied — Vitalis is Claude-native); **Mastra** full backend (conflicts with the existing Express server). Avoid entirely: **AG2 (AutoGen)** [github.com/ag2ai/ag2](https://github.com/ag2ai/ag2) (Python-only).

**Success criteria (concrete / testable)**

- An agent call that bypasses `blendScheduleFor` / `selectedScheduleFor` is **rejected by Express middleware** before execution (return `BLOCKED`).
- Setting `APPROVED_RESOURCE` requires a human-signed token; an unsigned attempt is rejected.
- An approval pause survives a process restart and resumes only via the server endpoint (if `interrupt()` adopted and the resume issue is verified fixed).

---

## Sequencing rationale + summary table

**Why this order:**

- **Phases 1–3 first** because they are **low-complexity, JS-native, reuse-first**, and close the dominant *source-of-truth* theme (F1/F3/F6) plus content-fidelity (F4) with **no architecture change**. Prompts/standing-orders reduce drift *frequency*; schema + registry + evals make the remaining drift a *hard build failure*.
- **Phase 4 is the single highest-leverage net-new build** (closes F5 — the #1 documented gap) and is JS-native (Playwright), so it lands immediately after the cheapest gates.
- **Phase 5** adds the plain-Node forensic/recovery layer (intent log + DLQ) that catches *procedural* failures (F2/F3/F5/F7) and removes silent failure — cheap, high operational value.
- **Phases 6–7 last** because they are heavier (Docker services, durable execution, middleware refactors) and **deepen** detection / raise the floor rather than close an otherwise-open failure. They are explicitly ADOPT-LATER; durable-execution frameworks are OVERKILL until generation exceeds ~5 min.

**Production-ready vs experimental:** every **ADOPT-NOW** tool (Playwright, promptfoo, Zod v4, Ajv, Knip, Changesets, Spectral, `AGENTS.md`, Claude Agent SDK, Anthropic Structured Outputs) is **production-maturity and verified**. The **doctrine practices** that lack peer review (the pre-action-auth, write-ahead-log, goal-drift, procedure-aware, specialist-chain, TRAIL, judge-bias, GuideBench arXiv preprints) are labeled **preprint/directional**; the peer-reviewed anchors that hold are **tau-bench (ICLR)** and the **position-bias study (AACL-IJCNLP 2025)**.

| Phase | Closes (F#) | Net-new build | Headline tools (verified) | Complexity | Impact | When |
|---|---|---|---|---|---|---|
| **0 — What exists** | (all) | none (read-only) | dosing engine, `research-doctrine.js`+RD1–RD4, `check-catalog-guard.cjs`, approval gate, acceptance suite | — | foundation | **First** |
| **1 — Prompt + doctrine** | F1, F2, F3, F6, F7 | `AGENTS.md`, read-only `allowedTools`, `output_config` | [AGENTS.md](https://agents.md/), [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | low | high (freq.↓) | **Now** |
| **2 — SoT registry + preflight** | F1, F2, F3, F4, F6 | Zod schema, Ajv-in-guard, Start-Gate artifact, Knip, Changesets, Spectral | [Zod v4](https://github.com/colinhacks/zod), [Ajv](https://github.com/ajv-validator/ajv), [Knip](https://knip.dev/), [Changesets](https://github.com/changesets/changesets), [Spectral](https://github.com/stoplightio/spectral) | low–med | high | **Now** |
| **3 — Evals / tests** | F1, F3, F4, F5 | promptfoo trajectory, invocation-count, `pass^k`, §02 degradation tests | [promptfoo](https://github.com/promptfoo/promptfoo), [tau-bench](https://arxiv.org/abs/2406.12045) | low–med | high | **Now** |
| **4 — Visual QA** | F5 (F4, F7) | `playwright.config` + `toHaveScreenshot` + baselines | [Playwright](https://playwright.dev/docs/test-snapshots), [Argos](https://github.com/argos-ci/argos) *(opt.)* | low | **highest net-new** | **Now (priority)** |
| **5 — Logging + recovery** | F2, F3, F5, F6, F7 | write-ahead intent log, trace middleware, DLQ + Telegram | plain Node + [LittleHorse DLQ](https://littlehorse.io/blog/retries-and-dlq) | low | med–high | **Now/Next** |
| **6 — Observability / hallucination** | F1, F3, F6, F7 | OTel spans, Langfuse self-host, Lynx grounding gate | [OpenLLMetry-js](https://github.com/traceloop/openllmetry-js), [Langfuse](https://github.com/langfuse/langfuse), [Patronus Lynx](https://docs.patronus.ai/docs/research_and_differentiators/Lynx/base) | med | med | **Later** |
| **7 — Productized governance** | F1, F2, F3, F4, F6, F7 | pre-action auth middleware, `interrupt()` approval, specialist chain | [LangGraph.js](https://github.com/langchain-ai/langgraphjs) + preprints | med–high | high ceiling | **Later** |

**Bottom line for Marc:** the first four phases are cheap, JS-native, mostly extend tools Vitalis already runs, and close five of the seven failures (F1, F3, F4, F5, F6) — with **Phase 4 (Playwright visual QA) as the one new build that pays back the most**. Phases 5–7 are sequenced after because they deepen detection and raise the structural floor, not because they fix something the early phases leave open. Nothing recommended requires a Python process boundary, honoring Operational Simplicity and System Consolidation Discipline.
